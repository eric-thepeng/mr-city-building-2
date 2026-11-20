// Bakes everything the game draws into data/world.glb and the sandbox layout
// into data/board.json, so the headset never parses FBX files or the 130k-triangle
// Unity terrain.
// Run: python webxr/tools/bake_server.py, then open http://localhost:8124/tools/bake.html
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FbxLibrary } from './fbx-library.js';
import { mergeExpansion } from '../src/expansion.js';

// The sandbox: the part of the Unity landscape that holds the resource nodes,
// squeezed into a small board. All units here are game units (Unity metres).
// The game then shows the whole board at half size in front of the player.
const SANDBOX = {
  region: { x: [-1.8, 1.7], z: [-1.6, 1.6] }, // source area of the Unity terrain
  horizontal: 0.35, // squeeze the layout sideways ...
  vertical: 0.15, // ... and flatten the hills a lot more (slopes become a third as steep)
  floatScale: 0.4, // gas nodes hover above the ground: keep 40% of that height
  base: 0.04, // thickness of the sandbox under the lowest point
  cells: 72, // grid cells along the longer side (fine enough for steep cliff faces)
  chunk: 80, // one mesh: the sandbox is small, one draw call is cheaper than culling
};

// ---- vertical shapes added on top of the Unity landscape (board space, game units)
// Two mesas along the far edge with a canyon between them, a ledge on the far left,
// and a rock pillar in the valley. Crystal veins sit on their walls; ice clouds float above.
const sstep = (e0, e1, v) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const EDGE = 0.012; // half-width of a cliff face: about 1.5 grid cells, so nearly vertical
function cliffHeight(x, z, h0) {
  const zf = -0.27 + 0.025 * Math.sin(x * 11 + 0.7) + 0.012 * Math.sin(x * 29 + 2.1); // mesa front face
  const cj = 0.015 * Math.sin(z * 17 + 1.3);
  const outsideCanyon = Math.max(sstep(-0.08 + cj + EDGE, -0.08 + cj - EDGE, x), sstep(0.25 - cj - EDGE, 0.25 - cj + EDGE, x));
  const left = x < 0.08;
  // far left: a ledge at 0.22 in front of the upper wall
  const ledge = left ? 0.1 * sstep(-0.26, -0.34, x) : 0;
  const top = left ? 0.4 : 0.36;
  const mid = left ? 0.22 : top;
  let level = (mid * sstep(zf + EDGE, zf - EDGE, z) + (top - mid) * sstep(zf - ledge + EDGE, zf - ledge - EDGE, z)) * outsideCanyon;
  // rock pillar in the valley
  const a = Math.atan2(z - 0.06, x + 0.17);
  const rr = 0.075 + 0.01 * Math.sin(a * 5 + 0.4);
  const r = Math.hypot(x + 0.17, z - 0.06);
  level = Math.max(level, 0.3 * sstep(rr + EDGE, rr - EDGE, r));
  return level > 0.001 ? Math.max(h0, level + 0.25 * (h0 - 0.12) * Math.min(1, level / 0.2)) : h0;
}

// Crystal veins: start inside the rock at `from`, walk along `dir` (out of the wall) at height y.
const VEINS = [
  { from: [-0.52, -0.42], dir: [0, 1], y: 0.18 }, // ledge face, far left
  { from: [-0.45, -0.52], dir: [0, 1], y: 0.33 }, // upper wall behind the ledge
  { from: [-0.2, -0.45], dir: [0, 1], y: 0.27 }, // left mesa front
  { from: [-0.2, -0.42], dir: [1, 0], y: 0.24 }, // canyon, left wall
  { from: [0.4, -0.36], dir: [-1, 0], y: 0.17 }, // canyon, right wall
  { from: [0.4, -0.5], dir: [-1, 0], y: 0.3 }, // canyon, right wall, high
  { from: [0.45, -0.45], dir: [0, 1], y: 0.23 }, // right mesa front
  { from: [-0.17, 0.06], dir: [1, 0], y: 0.18 }, // pillar, valley side
  { from: [-0.17, 0.06], dir: [-0.6, 0.8], y: 0.25 }, // pillar, towards the player
];
// Ice clouds (board-space centre)
const CLOUDS = [
  [0.08, 0.55, -0.38], // over the canyon
  [-0.17, 0.48, 0.06], // over the pillar
  [0.12, 0.36, -0.05], // over the valley
  [-0.42, 0.58, -0.25], // by the left mesa
  [0.42, 0.42, 0.12], // right
  [-0.4, 0.3, 0.32], // near left, low
];

const log = (s) => { document.getElementById('log').textContent += `${s}\n`; };

async function save(path, body) {
  const res = await fetch(`/save?path=${encodeURIComponent(path)}`, { method: 'POST', body });
  if (!res.ok) throw new Error(`save ${path}: ${res.status}`);
  log(`saved ${path} (${(body.byteLength ?? body.length) / 1000 | 0} kB)`);
}

async function main() {
  const data = await (await fetch('../data/game-data.json')).json();
  mergeExpansion(data, await (await fetch('../data/expansion.json')).json());
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
  const flat = raw.map((h) => S.base + (h - hMin) * S.vertical);
  const heights = flat.map((h, k) => cliffHeight(x0 + (k % nx) * step, z0 + Math.floor(k / nx) * step, h));
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
  const slopeAt = (bx, bz) => {
    const d = step;
    return Math.max(Math.abs(hAt(bx + d, bz) - hAt(bx - d, bz)), Math.abs(hAt(bx, bz + d) - hAt(bx, bz - d))) / (2 * d);
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
    if (slopeAt(bx, bz) > 1.2) { log(`node ${index} dropped: it would sit on a cliff face`); return; }
    const y = hAt(bx, bz) + hover;
    resources.push({ index, type: res.type, vfx: res.vfx, p: [bx, y, bz].map((v) => +v.toFixed(4)), q: q.toArray().map((v) => +v.toFixed(5)) });
  });
  // ---- crystal veins on the walls and ice clouds in the air (made here, low-poly)
  const rng = mulberry32(7);
  const vq = new THREE.Quaternion();
  VEINS.forEach((v, i) => {
    const dir = new THREE.Vector3(v.dir[0], 0, v.dir[1]).normalize();
    let x = v.from[0];
    let z = v.from[1];
    for (let n = 0; n < 200 && hAt(x, z) > v.y; n++) { x += dir.x * 0.004; z += dir.z * 0.004; }
    const g = makeVein(rng);
    const index = 100 + i;
    g.name = `resource_${index}`;
    root.add(g);
    vq.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    const p = [x - dir.x * 0.006, v.y, z - dir.z * 0.006];
    resources.push({ index, type: 'CrystalVein', p: p.map((t) => +t.toFixed(4)), q: vq.toArray().map((t) => +t.toFixed(5)) });
  });
  CLOUDS.forEach((c, i) => {
    const g = makeCloud(rng);
    const index = 200 + i;
    g.name = `resource_${index}`;
    root.add(g);
    resources.push({ index, type: 'IceCloud', air: true, p: c, q: [0, 0, 0, 1] });
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

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A cluster of crystals growing out of a wall towards +z. */
function makeVein(rng) {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.OctahedronGeometry(1, 0);
    const len = 0.016 + rng() * 0.014;
    g.scale(0.0055 + rng() * 0.003, len, 0.0055 + rng() * 0.003);
    g.translate(0, len * 0.8, 0);
    const tilt = new THREE.Euler(Math.PI / 2 - 0.5 + (rng() - 0.5) * 0.9, 0, (rng() - 0.5) * 1.6);
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(tilt));
    g.translate((rng() - 0.5) * 0.02, (rng() - 0.5) * 0.016, 0);
    parts.push(g);
  }
  return meshOf(parts, 'Crystal');
}

/** A low-poly puff cloud, about 10 x 5 cm in game units. */
function makeCloud(rng) {
  const parts = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const r = 0.022 + rng() * 0.014;
    const g = new THREE.IcosahedronGeometry(r, 0);
    g.scale(1, 0.8, 1);
    const t = i / (n - 1) - 0.5;
    g.translate(t * 0.085 + (rng() - 0.5) * 0.01, (0.5 - Math.abs(t)) * 0.022 + (rng() - 0.5) * 0.008, (rng() - 0.5) * 0.035);
    parts.push(g);
  }
  return meshOf(parts, 'Cloud');
}

function meshOf(parts, material) {
  const geo = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false);
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ name: material }));
  mesh.material.name = material;
  group.add(mesh);
  return group;
}

main().catch((e) => { log(`ERROR ${e.stack || e}`); document.title = 'bake failed'; });
