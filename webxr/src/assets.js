// Loads the FBX models exported from the Unity project and rebuilds
// Unity renderers (mesh + materials + transform) as three.js objects.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// Unity (left-handed) mesh vertex -> three.js (right-handed) is a mirror on X
// (Unity's FBX import) followed by our scene-wide mirror on Z. Together that is
// a 180° turn around Y, plus the FBX unit scale Unity applies on import.
function importFix(k) {
  return new THREE.Matrix4().makeScale(-k, k, -k);
}

const ERROR_TINT = new THREE.Color(1, 0.29, 0.29);

export class AssetLibrary {
  constructor(data) {
    this.data = data;
    this.fbx = new Map(); // web path -> THREE.Group
    this.textures = new Map();
    this.materials = new Map();
    this.gradient = makeToonGradient();
  }

  async load(onProgress = () => {}) {
    const paths = new Set();
    const collect = (list) => list.forEach((r) => paths.add(r.fbx));
    collect(this.data.environment.static);
    this.data.environment.resources.forEach((r) => collect(r.meshes));
    Object.values(this.data.blocks).forEach((b) => collect(b.meshes));

    const texPaths = new Set(
      Object.values(this.data.materials).map((m) => m.map).filter(Boolean),
    );

    // FBX files reference their textures next to themselves; ours live in assets/Textures
    // (and the materials are rebuilt from the Unity .mat data anyway).
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) =>
      /\.(png|jpe?g|tga)$/i.test(url) && !url.includes('/Textures/') && !url.startsWith('data:') && !url.startsWith('blob:')
        ? `assets/Textures/${url.split('/').pop()}`
        : url);
    const loader = new FBXLoader(manager);
    const texLoader = new THREE.TextureLoader();
    const total = paths.size + texPaths.size;
    let done = 0;
    const tick = () => onProgress(++done / total);

    await Promise.all([
      ...[...paths].map(async (p) => {
        const obj = await loader.loadAsync(p);
        obj.updateMatrixWorld(true);
        this.fbx.set(p, obj);
        tick();
      }),
      ...[...texPaths].map(async (p) => {
        const tex = await texLoader.loadAsync(p);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = true;
        this.textures.set(p, tex);
        tick();
      }),
    ]);
  }

  material(name, { error = false, vertexColors = false } = {}) {
    const key = `${name}|${error}|${vertexColors}`;
    if (this.materials.has(key)) return this.materials.get(key);
    const def = this.data.materials[name] || { color: [1, 1, 1, 1], map: null };
    const color = new THREE.Color().setRGB(def.color[0], def.color[1], def.color[2], THREE.SRGBColorSpace);
    if (error) color.multiply(ERROR_TINT);
    const alpha = def.color[3];
    const mat = new THREE.MeshToonMaterial({
      color,
      map: def.map ? this.textures.get(def.map) : null,
      gradientMap: this.gradient,
      vertexColors,
      transparent: alpha < 0.99,
      opacity: alpha < 0.99 ? Math.max(alpha, 0.25) : 1,
      depthWrite: alpha >= 0.99,
    });
    mat.name = name;
    this.materials.set(key, mat);
    return mat;
  }

  /** Meshes (with transforms relative to the FBX root) for one renderer entry. */
  _sourceMeshes(entry) {
    const root = this.fbx.get(entry.fbx);
    const meshes = [];
    let node = null;
    if (entry.node) {
      const wanted = THREE.PropertyBinding.sanitizeNodeName(entry.node);
      root.traverse((o) => {
        if (!node && (o.name === entry.node || o.name === wanted)) node = o;
      });
    }
    if (node && node.isMesh) {
      // A Unity MeshFilter references exactly this node's mesh, in its local space.
      meshes.push({ mesh: node, matrix: new THREE.Matrix4() });
    } else {
      const all = [];
      root.traverse((o) => o.isMesh && all.push(o));
      if (entry.node && all.length === 1) {
        meshes.push({ mesh: all[0], matrix: new THREE.Matrix4() });
      } else {
        const base = node || root;
        const baseInv = new THREE.Matrix4().copy(base.matrixWorld).invert();
        base.traverse((o) => {
          if (o.isMesh) meshes.push({ mesh: o, matrix: baseInv.clone().multiply(o.matrixWorld) });
        });
      }
    }
    return meshes;
  }

  /**
   * Build a group from a list of exported renderer entries.
   * Matrices in the entries are already in three.js space.
   */
  build(entries, { error = false, castShadow = true, receiveShadow = true, fallbackMat = 'M_Building' } = {}) {
    const group = new THREE.Group();
    for (const entry of entries) {
      const k = this.data.fbxUnitScale[entry.fbx] ?? 1;
      const fix = importFix(k);
      const m = new THREE.Matrix4().fromArray(entry.m);
      for (const { mesh, matrix } of this._sourceMeshes(entry)) {
        const geo = mesh.geometry;
        const hasVC = !!geo.attributes.color;
        const listed = entry.mats.filter(Boolean);
        const names = listed.length ? listed : [fallbackMat];
        const groups = geo.groups.length ? geo.groups.length : 1;
        const mats = [];
        for (let i = 0; i < groups; i++) {
          mats.push(this.material(names[Math.min(i, names.length - 1)], { error, vertexColors: hasVC }));
        }
        const out = new THREE.Mesh(geo, mats.length === 1 ? mats[0] : mats);
        out.matrixAutoUpdate = false;
        out.matrix.copy(m).multiply(fix).multiply(matrix);
        out.matrix.decompose(out.position, out.quaternion, out.scale);
        out.castShadow = castShadow;
        out.receiveShadow = receiveShadow;
        group.add(out);
      }
    }
    return group;
  }
}

function makeToonGradient() {
  const data = new Uint8Array([90, 170, 255]);
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
