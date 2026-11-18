// Bakes everything the game draws into data/world.glb plus a terrain heightfield,
// so the headset never parses FBX files or holds the 130k-triangle Unity terrain.
// Run: python webxr/tools/bake_server.py, then open http://localhost:8124/tools/bake.html
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { FbxLibrary } from './fbx-library.js';

// Simplified terrain: a heightfield sampled from the Unity terrain around the
// player (the area all resource nodes and the hand row sit in).
const TERRAIN = { x0: -3, z0: -3, size: 6, cells: 80, chunk: 16 };

const log = (s) => { document.getElementById('log').textContent += `${s}\n`; };

async function save(path, body) {
  const res = await fetch(`/save?path=${encodeURIComponent(path)}`, { method: 'POST', body });
  if (!res.ok) throw new Error(`save ${path}: ${res.status}`);
  log(`saved ${path} (${(body.byteLength ?? body.length) / 1000 | 0} kB)`);
}

async function main() {
  const data = await (await fetch('../data/game-data.json')).json();
  const lib = new FbxLibrary(data, '../');
  await lib.load((p) => { document.title = `bake ${(p * 100) | 0}%`; });
  log('FBX loaded');

  const root = new THREE.Scene();

  // building models
  for (const [key, def] of Object.entries(data.blocks)) {
    const g = lib.build(def.meshes);
    g.name = `block_${key}`;
    root.add(g);
  }
  // resource nodes (each has its own scale / pieces)
  data.environment.resources.forEach((res, i) => {
    const g = lib.build(res.meshes);
    g.name = `resource_${i}`;
    root.add(g);
  });

  // terrain heightfield
  const colliders = lib.build(data.environment.static, { fallbackMat: 'MT_Terrain_01' });
  colliders.updateMatrixWorld(true);
  const { x0, z0, size, cells, chunk } = TERRAIN;
  const n = cells + 1;
  const step = size / cells;
  const heights = new Float32Array(n * n);
  const colors = new Float32Array(n * n * 3);
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const color = new THREE.Color();
  let misses = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      ray.set(new THREE.Vector3(x0 + i * step, 20, z0 + j * step), down);
      const hit = ray.intersectObject(colliders, true)[0];
      const k = j * n + i;
      if (!hit) { heights[k] = 0; misses++; color.setRGB(0.9, 0.9, 0.9); } else {
        heights[k] = hit.point.y;
        const mat = Array.isArray(hit.object.material)
          ? hit.object.material[hit.face.materialIndex] : hit.object.material;
        const c = data.materials[mat.name]?.color ?? [1, 1, 1];
        color.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
      }
      colors.set([color.r, color.g, color.b], k * 3);
    }
  }
  log(`heightfield ${n}x${n}, ${misses} misses`);

  const terrain = new THREE.Group();
  terrain.name = 'terrain';
  const terrainMat = lib.placeholder('Terrain');
  for (let cj = 0; cj < cells; cj += chunk) {
    for (let ci = 0; ci < cells; ci += chunk) {
      const w = Math.min(chunk, cells - ci) + 1;
      const h = Math.min(chunk, cells - cj) + 1;
      const pos = new Float32Array(w * h * 3);
      const col = new Float32Array(w * h * 3);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const k = (cj + y) * n + (ci + x);
          const v = y * w + x;
          pos.set([x0 + (ci + x) * step, heights[k], z0 + (cj + y) * step], v * 3);
          col.set(colors.subarray(k * 3, k * 3 + 3), v * 3);
        }
      }
      const idx = [];
      for (let y = 0; y < h - 1; y++) {
        for (let x = 0; x < w - 1; x++) {
          const a = y * w + x;
          const b = a + 1;
          const c = a + w;
          const d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals(); // the lit shaders read normals even with flatShading
      const mesh = new THREE.Mesh(geo, terrainMat);
      mesh.name = `terrain_${ci / chunk}_${cj / chunk}`;
      terrain.add(mesh);
    }
  }
  root.add(terrain);

  const glb = await new GLTFExporter().parseAsync(root, { binary: true });
  await save('data/world.glb', glb);
  const json = JSON.stringify({ x0, z0, step, n, heights: Array.from(heights, (v) => Math.round(v * 1000) / 1000) });
  await save('data/terrain.json', new TextEncoder().encode(json));

  let tris = 0;
  root.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  log(`done: ${tris | 0} triangles in world.glb (terrain ${2 * cells * cells})`);
  document.title = 'bake done';
}

main().catch((e) => { log(`ERROR ${e.stack || e}`); document.title = 'bake failed'; });
