// Loads the pre-baked world (data/world.glb + data/terrain.json, made by
// tools/bake.html from the Unity FBX assets) and hands out building / resource
// models with the game's materials.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const ERROR_TINT = new THREE.Color(1, 0.29, 0.29);

export class AssetLibrary {
  constructor(data) {
    this.data = data;
    this.textures = new Map();
    this.materials = new Map();
    this.gradient = makeToonGradient();
    this.world = null;
    this.heightfield = null;
  }

  async load(onProgress = () => {}) {
    const texPaths = [...new Set(Object.values(this.data.materials).map((m) => m.map).filter(Boolean))];
    const total = texPaths.length + 2;
    let done = 0;
    const tick = () => onProgress(++done / total);
    const texLoader = new THREE.TextureLoader();
    await Promise.all([
      new GLTFLoader().loadAsync('data/world.glb').then((g) => { this.world = g.scene; tick(); }),
      fetch('data/terrain.json').then((r) => r.json()).then((h) => { this.heightfield = new Heightfield(h); tick(); }),
      ...texPaths.map(async (p) => {
        const tex = await texLoader.loadAsync(p);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = true; // the baked UVs keep three.js (FBX) orientation
        this.textures.set(p, tex);
        tick();
      }),
    ]);
  }

  material(name, { error = false, vertexColors = false } = {}) {
    const key = `${name}|${error}|${vertexColors}`;
    if (this.materials.has(key)) return this.materials.get(key);
    let mat;
    if (name === 'Terrain') {
      // cheap faceted look; toon materials have no flatShading
      mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    } else {
      const def = this.data.materials[name] || { color: [1, 1, 1, 1], map: null };
      const color = new THREE.Color().setRGB(def.color[0], def.color[1], def.color[2], THREE.SRGBColorSpace);
      if (error) color.multiply(ERROR_TINT);
      const alpha = def.color[3];
      mat = new THREE.MeshToonMaterial({
        color,
        map: def.map ? this.textures.get(def.map) : null,
        gradientMap: this.gradient,
        vertexColors,
        transparent: alpha < 0.99,
        opacity: alpha < 0.99 ? Math.max(alpha, 0.25) : 1,
        depthWrite: alpha >= 0.99,
      });
    }
    mat.name = name;
    this.materials.set(key, mat);
    return mat;
  }

  /** A copy of a baked model (geometry shared) with the game's materials applied. */
  instance(nodeName, { error = false } = {}) {
    const src = this.world.getObjectByName(nodeName);
    if (!src) return new THREE.Group();
    const copy = src.clone(true);
    copy.position.set(0, 0, 0);
    copy.quaternion.identity();
    copy.scale.set(1, 1, 1);
    copy.traverse((o) => {
      if (!o.isMesh) return;
      const vc = !!o.geometry.attributes.color;
      o.material = this.material(o.material.name, { error, vertexColors: vc && o.material.name !== 'Terrain' ? true : false });
      o.raycast = THREE.Mesh.prototype.raycast;
    });
    return copy;
  }

  terrain() {
    const t = this.instance('terrain');
    t.traverse((o) => { if (o.isMesh) o.material = this.material('Terrain'); });
    return t;
  }
}

/** Ground height lookup on the baked grid (bilinear), used for support beams. */
export class Heightfield {
  constructor({ x0, z0, step, n, heights }) {
    Object.assign(this, { x0, z0, step, n });
    this.h = Float32Array.from(heights);
  }

  /** Height at (x, z), or -Infinity outside the terrain. */
  at(x, z) {
    const fx = (x - this.x0) / this.step;
    const fz = (z - this.z0) / this.step;
    if (fx < 0 || fz < 0 || fx > this.n - 1 || fz > this.n - 1) return -Infinity;
    const i = Math.min(Math.floor(fx), this.n - 2);
    const j = Math.min(Math.floor(fz), this.n - 2);
    const u = fx - i;
    const v = fz - j;
    const n = this.n;
    const h = this.h;
    // match the baked triangles (diagonal from (i+1, j) to (i, j+1))
    if (u + v <= 1) {
      return h[j * n + i] + (h[j * n + i + 1] - h[j * n + i]) * u + (h[(j + 1) * n + i] - h[j * n + i]) * v;
    }
    const d = h[(j + 1) * n + i + 1];
    return d + (h[(j + 1) * n + i] - d) * (1 - u) + (h[j * n + i + 1] - d) * (1 - v);
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
