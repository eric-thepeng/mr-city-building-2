// MarsRoomLayout — places the resource nodes on a scanned room: ore at the foot of real objects,
// crystal on top of them, gas in the open, ice clouds above. Uses the same nodes (models, counts,
// rotations) as the baked Mars board, so the game's scoring stays comparable.
// Must not: touch the scene.

import {Heightfield, ResourceDef} from "./MarsData"

/** The scanned surface on the board's grid, in game units. */
export interface RoomGrid {
  x0: number
  z0: number
  step: number
  nx: number
  nz: number
  heights: number[]
  /** grid points with no usable surface (off the table, or never seen) */
  blocked: boolean[]
}

/** Height above the base surface from which a grid point counts as a real object (3 cm). */
export const OBJECT_HEIGHT = 0.06

/** Smallest distance between two nodes of each kind, in game units. */
const SPACING: Record<string, number> = {OreNode: 0.07, CrystalVein: 0.1, GasNode: 0.14, IceCloud: 0.22}
const CLOUD_CLEARANCE = 0.2
const CLOUD_VARIATION = 0.12
const CLOUD_RADIUS = 0.12

/** Small seeded generator (mulberry32), so one scan always gives one layout. */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled<T>(list: T[], random: () => number): T[] {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const t = a[i]
    a[i] = a[j]
    a[j] = t
  }
  return a
}

export function layoutResources(g: RoomGrid, baked: ResourceDef[], seed: number): ResourceDef[] {
  const random = makeRandom(seed)
  const hf = new Heightfield(g)
  const {nx, nz, heights, blocked} = g
  const usable = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < nz && !blocked[j * nx + i]
  const isObject = (i: number, j: number) => usable(i, j) && heights[j * nx + i] >= OBJECT_HEIGHT

  const foot: number[] = []
  const top: number[] = []
  const open: number[] = []
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      if (!usable(i, j)) continue
      const k = j * nx + i
      if (isObject(i, j)) {
        // a flat top: the four neighbours are about as high
        const flat = [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([a, b]) => usable(i + a, j + b) && Math.abs(heights[(j + b) * nx + i + a] - heights[k]) < 0.03)
        if (flat) top.push(k)
        continue
      }
      let nearObject = false
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) nearObject = nearObject || isObject(i + a, j + b)
      ;(nearObject ? foot : open).push(k)
    }
  }
  const everywhere = [...top, ...foot, ...open]
  const pools: Record<string, number[][]> = {
    CrystalVein: [top, foot, open],
    GasNode: [open, foot],
    OreNode: [foot, open],
    IceCloud: [top, everywhere],
  }

  const out: ResourceDef[] = []
  const onGround: {x: number; z: number}[] = []
  const inAir: {x: number; z: number}[] = []

  const place = (res: ResourceDef): void => {
    const air = !!res.air
    const taken = air ? inAir : onGround
    const spacing = SPACING[res.type] ?? 0.08
    for (const reach of [spacing, spacing * 0.6]) {
      for (const pool of pools[res.type] ?? [everywhere]) {
        for (const k of shuffled(pool, random)) {
          const x = g.x0 + (k % nx) * g.step + (random() - 0.5) * g.step * 0.4
          const z = g.z0 + Math.floor(k / nx) * g.step + (random() - 0.5) * g.step * 0.4
          if (taken.some((p) => Math.hypot(p.x - x, p.z - z) < reach)) continue
          taken.push({x, z})
          const y = air ? highestNear(hf, x, z, g.step) + CLOUD_CLEARANCE + random() * CLOUD_VARIATION : hf.at(x, z)
          out.push({...res, p: [x, y, z]})
          return
        }
      }
    }
  }

  // the kinds with the fewest good spots first
  for (const type of ["CrystalVein", "GasNode", "OreNode", "IceCloud"]) {
    for (const res of baked) if (res.type === type) place(res)
  }
  for (const res of baked) if (!pools[res.type]) place(res)
  return out
}

function highestNear(hf: Heightfield, x: number, z: number, step: number): number {
  let top = 0
  for (let dz = -CLOUD_RADIUS; dz <= CLOUD_RADIUS; dz += step) {
    for (let dx = -CLOUD_RADIUS; dx <= CLOUD_RADIUS; dx += step) {
      const h = hf.at(x + dx, z + dz)
      if (h > top) top = h
    }
  }
  return top
}
