// Bake-time only: loads the FBX models exported from the Unity project and
// rebuilds Unity renderers (mesh + material names + transform) as three.js objects.
// The game itself loads the baked data/world.glb, never these FBX files.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// Unity (left-handed) mesh vertex -> three.js (right-handed) is a mirror on X
// (Unity's FBX import) followed by our scene-wide mirror on Z. Together that is
// a 180° turn around Y, plus the FBX unit scale Unity applies on import.
function importFix(k) {
  return new THREE.Matrix4().makeScale(-k, k, -k);
}

const KEEP_ATTRS = ['position', 'normal', 'uv', 'color'];

export class FbxLibrary {
  constructor(data, base = '../') {
    this.data = data;
    this.base = base;
    this.fbx = new Map();
    this.placeholders = new Map();
    this.cleanGeos = new Map();
  }

  async load(onProgress = () => {}) {
    const paths = new Set();
    const collect = (list) => list.forEach((r) => paths.add(r.fbx));
    collect(this.data.environment.static);
    this.data.environment.resources.forEach((r) => collect(r.meshes));
    Object.values(this.data.blocks).forEach((b) => collect(b.meshes));
    // Skip the textures the FBX files reference: materials are rebuilt from Unity data.
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => (/\.(png|jpe?g|tga)$/i.test(url)
      ? 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' : url));
    const loader = new FBXLoader(manager);
    let done = 0;
    await Promise.all([...paths].map(async (p) => {
      const obj = await loader.loadAsync(this.base + p);
      obj.updateMatrixWorld(true);
      this.fbx.set(p, obj);
      onProgress(++done / paths.size);
    }));
  }

  /** A stand-in material that only carries the Unity material name. */
  placeholder(name) {
    if (!this.placeholders.has(name)) {
      const m = new THREE.MeshBasicMaterial();
      m.name = name;
      this.placeholders.set(name, m);
    }
    return this.placeholders.get(name);
  }

  /** The geometry with only the attributes the game uses (shared per source). */
  clean(geo) {
    if (!this.cleanGeos.has(geo.uuid)) {
      const g = new THREE.BufferGeometry();
      for (const a of KEEP_ATTRS) if (geo.attributes[a]) g.setAttribute(a, geo.attributes[a]);
      if (geo.index) g.setIndex(geo.index);
      for (const grp of geo.groups) g.addGroup(grp.start, grp.count, grp.materialIndex);
      this.cleanGeos.set(geo.uuid, g);
    }
    return this.cleanGeos.get(geo.uuid);
  }

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

  /** Build a group from exported renderer entries (matrices already in three.js space). */
  build(entries, { fallbackMat = 'M_Building' } = {}) {
    const group = new THREE.Group();
    for (const entry of entries) {
      const fix = importFix(this.data.fbxUnitScale[entry.fbx] ?? 1);
      const m = new THREE.Matrix4().fromArray(entry.m);
      for (const { mesh, matrix } of this._sourceMeshes(entry)) {
        const geo = this.clean(mesh.geometry);
        const listed = entry.mats.filter(Boolean);
        const names = listed.length ? listed : [fallbackMat];
        const n = geo.groups.length || 1;
        const mats = [];
        for (let i = 0; i < n; i++) mats.push(this.placeholder(names[Math.min(i, names.length - 1)]));
        const out = new THREE.Mesh(geo, mats.length === 1 ? mats[0] : mats);
        out.matrix.copy(m).multiply(fix).multiply(matrix);
        out.matrix.decompose(out.position, out.quaternion, out.scale);
        group.add(out);
      }
    }
    return group;
  }
}
