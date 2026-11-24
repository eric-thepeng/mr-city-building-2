// Building colliders that follow the model. The model is cut into a few horizontal layers and
// each layer gets the box around the part of the model inside it, so a dome, a rocket or a
// turbine on a thin mast is not treated as one big block. Buildings only turn about the
// vertical axis, so two layers overlap when their heights overlap and their turned rectangles
// overlap seen from above (a 2D separating-axis test, which also says how to push them apart).
import * as THREE from 'three';

const LAYER = 0.012; // about one layer per 1.2 cm of model height (game units)
const MAX_LAYERS = 8;
const MERGE = 0.003; // neighbouring layers this close in size become one box
/** Buildings may touch: they only count as overlapping past this depth (game units). */
export const OVERLAP_TOL = 0.003;

/**
 * The layer boxes of `object` in the space of `root` (its building), as
 * { x0, x1, y0, y1, z0, z1 }. Each layer clips the model's triangles to its height range,
 * so long triangles that cross a layer without a vertex in it still count.
 */
export function layerBoxes(object, root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const pts = []; // three corners (9 numbers) per triangle
  object.traverse((o) => {
    const pos = o.isMesh ? o.geometry?.attributes.position : null;
    if (!pos) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    const index = o.geometry.index;
    const n = index ? index.count : pos.count;
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(m);
      pts.push(v.x, v.y, v.z);
    }
  });
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 1; i < pts.length; i += 3) { lo = Math.min(lo, pts[i]); hi = Math.max(hi, pts[i]); }
  if (!(hi > lo)) return [];

  const count = THREE.MathUtils.clamp(Math.round((hi - lo) / LAYER), 1, MAX_LAYERS);
  const step = (hi - lo) / count;
  const layers = Array.from({ length: count }, (_, k) => ({
    x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, y0: lo + k * step, y1: lo + (k + 1) * step,
  }));
  const add = (l, x, z) => {
    if (x < l.x0) l.x0 = x;
    if (x > l.x1) l.x1 = x;
    if (z < l.z0) l.z0 = z;
    if (z > l.z1) l.z1 = z;
  };
  for (let t = 0; t < pts.length; t += 9) {
    const ys = [pts[t + 1], pts[t + 4], pts[t + 7]];
    const ymin = Math.min(...ys);
    const ymax = Math.max(...ys);
    for (const l of layers) {
      if (ymin > l.y1 || ymax < l.y0) continue;
      // the triangle cut to this layer: its corners inside, plus where its edges cross the planes
      for (let j = 0; j < 3; j++) {
        const a = t + j * 3;
        if (pts[a + 1] >= l.y0 && pts[a + 1] <= l.y1) add(l, pts[a], pts[a + 2]);
        const b = t + ((j + 1) % 3) * 3;
        for (const y of [l.y0, l.y1]) {
          const da = pts[a + 1] - y;
          const db = pts[b + 1] - y;
          if (da * db < 0) {
            const f = da / (da - db);
            add(l, pts[a] + (pts[b] - pts[a]) * f, pts[a + 2] + (pts[b + 2] - pts[a + 2]) * f);
          }
        }
      }
    }
  }
  const out = [];
  for (const l of layers) {
    if (l.x0 > l.x1) continue; // nothing of the model at this height
    const last = out[out.length - 1];
    const same = last && Math.abs(last.x0 - l.x0) < MERGE && Math.abs(last.x1 - l.x1) < MERGE
      && Math.abs(last.z0 - l.z0) < MERGE && Math.abs(last.z1 - l.z1) < MERGE;
    if (same && last.y1 >= l.y0 - 1e-6) {
      last.y1 = l.y1;
      last.x0 = Math.min(last.x0, l.x0); last.x1 = Math.max(last.x1, l.x1);
      last.z0 = Math.min(last.z0, l.z0); last.z1 = Math.max(last.z1, l.z1);
    } else {
      out.push(l);
    }
  }
  // how far the layers reach from the building's centre seen from above (a quick first test)
  out.reach = Math.max(0, ...out.map((l) => Math.hypot(Math.max(-l.x0, l.x1), Math.max(-l.z0, l.z1))));
  return out;
}

/** Position and facing of a building (its parent's space; it only turns about the vertical axis). */
export function poseOf(object, out = {}) {
  const p = object.position;
  const q = object.quaternion;
  // the building's own x axis seen from above, (cos, -sin) of its yaw
  const ax = 1 - 2 * (q.y * q.y + q.z * q.z);
  const az = 2 * (q.x * q.z - q.w * q.y);
  const len = Math.hypot(ax, az) || 1;
  out.x = p.x; out.y = p.y; out.z = p.z;
  out.c = ax / len; out.s = -az / len;
  return out;
}

const axes = [0, 0, 0, 0, 0, 0, 0, 0];

/**
 * Whether two buildings' layers overlap (deeper than OVERLAP_TOL). If they do, returns
 * { x, z, depth, up }: moving `a` by (x, z) * depth separates the deepest pair of layers
 * sideways, and moving it up by `up` lifts it clear of everything it cuts into.
 */
export function overlap(layersA, pa, layersB, pb) {
  if (!layersA.length || !layersB.length) return null;
  const dx = pb.x - pa.x;
  const dz = pb.z - pa.z;
  const reach = layersA.reach + layersB.reach;
  if (dx * dx + dz * dz > reach * reach) return null;
  // each side's x and z axes seen from above
  axes[0] = pa.c; axes[1] = -pa.s; axes[2] = pa.s; axes[3] = pa.c;
  axes[4] = pb.c; axes[5] = -pb.s; axes[6] = pb.s; axes[7] = pb.c;
  let best = null;
  let up = 0;
  for (const A of layersA) {
    const ay0 = pa.y + A.y0;
    const ay1 = pa.y + A.y1;
    const acx = (A.x0 + A.x1) / 2;
    const acz = (A.z0 + A.z1) / 2;
    const ahx = (A.x1 - A.x0) / 2;
    const ahz = (A.z1 - A.z0) / 2;
    const cax = pa.x + acx * axes[0] + acz * axes[2];
    const caz = pa.z + acx * axes[1] + acz * axes[3];
    for (const B of layersB) {
      const by1 = pb.y + B.y1;
      if (Math.min(ay1, by1) - Math.max(ay0, pb.y + B.y0) <= OVERLAP_TOL) continue;
      const bcx = (B.x0 + B.x1) / 2;
      const bcz = (B.z0 + B.z1) / 2;
      const bhx = (B.x1 - B.x0) / 2;
      const bhz = (B.z1 - B.z0) / 2;
      const ddx = pb.x + bcx * axes[4] + bcz * axes[6] - cax;
      const ddz = pb.z + bcx * axes[5] + bcz * axes[7] - caz;
      let depth = Infinity;
      let nx = 0;
      let nz = 0;
      for (let i = 0; i < 8; i += 2) {
        const lx = axes[i];
        const lz = axes[i + 1];
        const d = ddx * lx + ddz * lz;
        const ra = ahx * Math.abs(axes[0] * lx + axes[1] * lz) + ahz * Math.abs(axes[2] * lx + axes[3] * lz);
        const rb = bhx * Math.abs(axes[4] * lx + axes[5] * lz) + bhz * Math.abs(axes[6] * lx + axes[7] * lz);
        const o = ra + rb - Math.abs(d);
        if (o <= OVERLAP_TOL) { depth = -1; break; }
        if (o < depth) {
          depth = o;
          // push a away from b
          nx = d > 0 ? -lx : lx;
          nz = d > 0 ? -lz : lz;
        }
      }
      if (depth < 0) continue;
      up = Math.max(up, by1 - ay0);
      if (!best || depth > best.depth) best = { x: nx, z: nz, depth };
    }
  }
  if (best) best.up = up;
  return best;
}
