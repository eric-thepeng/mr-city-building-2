// Bakes everything the game draws into data/world.glb and the sandbox layout
// into data/board.json, so the headset never parses FBX files or the 130k-triangle
// Unity terrain.
// Run: python webxr/tools/bake_server.py, then open http://localhost:8124/tools/bake.html
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { FbxLibrary } from './fbx-library.js';

// The sandbox: the part of the Unity landscape that holds the resource nodes,
// squeezed into a small board. All units here are game units (Unity metres).
// The game then shows the whole board at half size in front of the player.
const SANDBOX = {
  region: { x: [-1.8, 1.7], z: [-1.6, 1.6] }, // source area of the Unity terrain
  horizontal: 0.35, // squeeze the layout sideways ...
  vertical: 0.15, // ... and flatten the hills a lot more (slopes become a third as steep)
  floatScale: 0.4, // gas nodes hover above the ground: keep 40% of that height
  base: 0.04, // thickness of the sandbox under the lowest point
  cells: 56, // grid cells along the longer side
  chunk: 64, // one mesh: the sandbox is small, one draw call is cheaper than culling
};

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
  for (const [key, def] of Object.entries(data.blocks)) {
    const g = lib.build(def.meshes);
    g.name = `block_${key}`;
    root.add(g);
  }
  data.environment.resources.forEach((res, i) => {
    const g = lib.build(res.meshes);
    g.name = `resource_${i}`;
    root.add(g);
  });

  // ---- sample the Unity terrain over the region
  const colliders = lib.build(data.environment.static, { fallbackMat: 'MT_Terrain_01' });
  colliders.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const sample = (x, z) => {
    ray.set(new THREE.Vector3(x, 20, z), down);
    const hit = ray.intersectObject(colliders, true)[0];
    if (!hit) return { h: 0, mat: 'MT_Terrain_01' };
    const m = Array.isArray(hit.object.material) ? hit.object.material[hit.face.materialIndex] : hit.object.material;
    return { h: hit.point.y, mat: m.name };
  };

  const S = SANDBOX;
  const [sx0, sx1] = S.region.x;
  const [sz0, sz1] = S.region.z;
  const cx = (sx0 + sx1) / 2;
  const cz = (sz0 + sz1) / 2;
  const width = (sx1 - sx0) * S.horizontal; // board size in game units
  const depth = (sz1 - sz0) * S.horizontal;
  const step = Math.max(width, depth) / S.cells;
  const nx = Math.round(width / step) + 1;
  const nz = Math.round(depth / step) + 1;
  const x0 = -width / 2;
  const z0 = -depth / 2;
  const toSource = (bx, bz) => [cx + bx / S.horizontal, cz + bz / S.horizontal];

  const raw = new Float32Array(nx * nz);
  const mats = [];
  let hMin = Infinity;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const [x, z] = toSource(x0 + i * step, z0 + j * step);
      const s = sample(x, z);
      raw[j * nx + i] = s.h;
      mats.push(s.mat);
      hMin = Math.min(hMin, s.h);
    }
  }
  const heights = raw.map((h) => S.base + (h - hMin) * S.vertical);
  log(`sandbox ${width.toFixed(2)} x ${depth.toFixed(2)} game units, grid ${nx}x${nz}, ` +
    `height ${S.base} .. ${Math.max(...heights).toFixed(3)}`);

  // ---- terrain mesh (chunked) + side walls
  const color = new THREE.Color();
  const colorOf = (k) => {
    const c = data.materials[mats[k]]?.color ?? [1, 1, 1];
    return color.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
  };
  const terrain = new THREE.Group();
  terrain.name = 'terrain';
  const terrainMat = lib.placeholder('Terrain');
  for (let cj = 0; cj < nz - 1; cj += S.chunk) {
    for (let ci = 0; ci < nx - 1; ci += S.chunk) {
      const w = Math.min(S.chunk, nx - 1 - ci) + 1;
      const h = Math.min(S.chunk, nz - 1 - cj) + 1;
      const pos = new Float32Array(w * h * 3);
      const col = new Float32Array(w * h * 3);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const k = (cj + y) * nx + (ci + x);
          const v = y * w + x;
          pos.set([x0 + (ci + x) * step, heights[k], z0 + (cj + y) * step], v * 3);
          const c = colorOf(k);
          col.set([c.r, c.g, c.b], v * 3);
        }
      }
      const idx = [];
      for (let y = 0; y < h - 1; y++) {
        for (let x = 0; x < w - 1; x++) {
          const a = y * w + x;
          idx.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, terrainMat);
      mesh.name = `terrain_${ci}_${cj}`;
      terrain.add(mesh);
    }
  }
  // sandbox walls: from the terrain edge down to y = 0, plus the bottom
  const wallPos = [];
  const edge = (list) => {
    for (let e = 0; e < list.length - 1; e++) {
      const [ax, az, ah] = list[e];
      const [bx, bz, bh] = list[e + 1];
      wallPos.push(ax, ah, az, ax, 0, az, bx, bh, bz, bx, bh, bz, ax, 0, az, bx, 0, bz);
    }
  };
  const H = (i, j) => heights[j * nx + i];
  const X = (i) => x0 + i * step;
  const Z = (j) => z0 + j * step;
  edge([...Array(nx).keys()].map((i) => [X(i), Z(nz - 1), H(i, nz - 1)])); // near side (+z)
  edge([...Array(nx).keys()].reverse().map((i) => [X(i), Z(0), H(i, 0)])); // far side
  edge([...Array(nz).keys()].reverse().map((j) => [X(nx - 1), Z(j), H(nx - 1, j)])); // right
  edge([...Array(nz).keys()].map((j) => [X(0), Z(j), H(0, j)])); // left
  const xa = X(0);
  const xb = X(nx - 1);
  const za = Z(0);
  const zb = Z(nz - 1);
  wallPos.push(xa, 0, za, xb, 0, za, xa, 0, zb, xb, 0, za, xb, 0, zb, xa, 0, zb);
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
  wallGeo.computeVertexNormals();
  const walls = new THREE.Mesh(wallGeo, lib.placeholder('SandboxWall'));
  walls.name = 'terrain_walls';
  terrain.add(walls);
  root.add(terrain);

  // ---- resource nodes moved onto the sandbox
  const hAt = (bx, bz) => {
    const i = Math.round((bx - x0) / step);
    const j = Math.round((bz - z0) / step);
    return heights[Math.max(0, Math.min(nz - 1, j)) * nx + Math.max(0, Math.min(nx - 1, i))];
  };
  const resources = [];
  data.environment.resources.forEach((res, index) => {
    const m = new THREE.Matrix4().fromArray(res.m);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    m.decompose(p, q, new THREE.Vector3());
    const bx = (p.x - cx) * S.horizontal;
    const bz = (p.z - cz) * S.horizontal;
    if (Math.abs(bx) > width / 2 || Math.abs(bz) > depth / 2) return; // outside the board
    const ground = sample(p.x, p.z).h;
    const hover = Math.max(0, p.y - ground) * (res.type === 'GasNode' ? S.floatScale : 0);
    const y = hAt(bx, bz) + hover;
    resources.push({ index, type: res.type, vfx: res.vfx, p: [bx, y, bz].map((v) => +v.toFixed(4)), q: q.toArray().map((v) => +v.toFixed(5)) });
  });
  log(`${resources.length} resource nodes on the board`);

  const glb = await new GLTFExporter().parseAsync(root, { binary: true });
  await save('data/world.glb', glb);
  const board = {
    width: +width.toFixed(4),
    depth: +depth.toFixed(4),
    heightfield: { x0, z0, step, nx, nz, heights: Array.from(heights, (v) => Math.round(v * 10000) / 10000) },
    resources,
  };
  await save('data/board.json', new TextEncoder().encode(JSON.stringify(board)));

  let tris = 0;
  root.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  log(`done: ${tris | 0} triangles in world.glb`);
  document.title = 'bake done';
}

main().catch((e) => { log(`ERROR ${e.stack || e}`); document.title = 'bake failed'; });
