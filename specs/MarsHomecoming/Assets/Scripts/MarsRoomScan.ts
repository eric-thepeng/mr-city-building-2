// MarsRoomScan — turns the real surface under the board into a height grid, once, at the start
// of a game. Rays go straight down through the World Mesh over the board's grid; each point keeps
// its last few hits and uses the median, so noise and a passing hand drop out.
// Owns: the surface sources (World Mesh on Specs, a test room in Preview, which has no depth) and
// building the BoardLayout from the samples. Must not: know the game rules.

import {BoardLayout, ResourceDef} from "./MarsData"
import {layoutResources, RoomGrid} from "./MarsRoomLayout"

export interface SurfaceHit {
  position: vec3
  normal: vec3
}

export interface SurfaceSource {
  readonly available: boolean
  start(): void
  stop(): void
  /** The surface the player is looking at. */
  aim(from: vec3, direction: vec3): SurfaceHit | null
  /** The first upward-facing surface on a straight-down ray. */
  castDown(from: vec3, to: vec3): SurfaceHit | null
}

const AIM_RANGE = 350
/** A surface facing at least this much upwards can hold something. */
const UP_FACING = 0.25

/** The real thing: Specs' World Mesh. */
export class WorldMeshSource implements SurfaceSource {
  constructor(private tracking: DeviceTracking | null) {}

  get available(): boolean {
    try {
      return !!this.tracking && this.tracking.worldTrackingCapabilities.sceneReconstructionSupported
    } catch {
      return false
    }
  }

  start(): void {
    if (this.tracking) this.tracking.worldOptions.enableWorldMeshesTracking = true
  }

  stop(): void {
    if (this.tracking) this.tracking.worldOptions.enableWorldMeshesTracking = false
  }

  aim(from: vec3, direction: vec3): SurfaceHit | null {
    const hits = WorldRaycast.raycastWorldMesh(from, from.add(direction.uniformScale(AIM_RANGE)))
    return hits.length ? {position: hits[0].position, normal: hits[0].normal} : null
  }

  castDown(from: vec3, to: vec3): SurfaceHit | null {
    for (const h of WorldRaycast.raycastWorldMesh(from, to)) {
      if (h.normal.y > UP_FACING) return {position: h.position, normal: h.normal}
    }
    return null
  }
}

/** A box on the test table, in cm: r = to the right, f = away from the player. */
interface TestBox {
  r: number
  f: number
  w: number
  d: number
  h: number
}

const TEST_BOXES: TestBox[] = [
  {r: -17, f: -7, w: 18, d: 14, h: 6}, // a stack of books
  {r: 15, f: 7, w: 9, d: 9, h: 12}, // a mug
  {r: 5, f: -17, w: 14, d: 12, h: 18}, // a box
]
/** Half size of the test table in cm: a little larger than the board. */
const TEST_TABLE = {r: 40, f: 34}

/** Preview has no depth: a table with three objects in front of the camera, with a little noise. */
export class TestRoomSource implements SurfaceSource {
  readonly available = true
  readonly center: vec3
  readonly right: vec3
  readonly forward: vec3
  readonly boxes = TEST_BOXES

  constructor(camera: vec3, forward: vec3, distance: number, below: number) {
    this.forward = forward
    this.right = forward.cross(vec3.up()).normalize()
    const c = camera.add(forward.uniformScale(distance))
    this.center = new vec3(c.x, camera.y - below, c.z)
  }

  start(): void {}
  stop(): void {}

  aim(): SurfaceHit {
    return {position: this.center, normal: vec3.up()}
  }

  castDown(from: vec3): SurfaceHit | null {
    const d = from.sub(this.center)
    const r = d.dot(this.right)
    const f = d.dot(this.forward)
    if (Math.abs(r) > TEST_TABLE.r || Math.abs(f) > TEST_TABLE.f) return null
    if (Math.random() < 0.08) return null // the mesh has gaps
    let h = 0
    for (const b of this.boxes) {
      if (Math.abs(r - b.r) <= b.w / 2 && Math.abs(f - b.f) <= b.d / 2) h = Math.max(h, b.h)
    }
    const y = this.center.y + h + (Math.random() - 0.5) * 0.4
    return {position: new vec3(from.x, y, from.z), normal: vec3.up()}
  }
}

/** Grid spacing in game units (4 cm). */
const STEP = 0.08
const RAYS_PER_FRAME = 40
/** Hits remembered per grid point. */
const KEEP = 5
/** Highest and lowest surface a ray looks for, around the aimed surface (game units). */
const RAY_TOP = 0.7
const RAY_BOTTOM = -0.2
const MIN_SCAN_TIME = 4
const MAX_SCAN_TIME = 14
/** Done early once this share of the grid is seen... */
const GOOD_COVERAGE = 0.9
/** ...or once nothing new has been seen for this long, with enough of it mapped. */
const STALE_TIME = 3
const STALE_COVERAGE = 0.4
/** Hits needed before a grid point counts as seen. */
const MIN_HITS = 2
/** Differences smaller than this (1.5 cm) are noise: the surface is flat there. */
const FLAT = 0.03
/** A point this far below the base surface (2 cm) is off the edge. */
const DROP = 0.04
/** Share of the grid that must be buildable for a game. */
const MIN_PLAYABLE = 0.4

export interface ScanResult {
  board: BoardLayout
  /** how far the base surface is above the aimed point, in game units */
  base: number
}

export class RoomScanner {
  readonly nx: number
  readonly nz: number
  readonly x0: number
  readonly z0: number
  private samples: Float32Array
  private hits: Uint16Array
  private next = 0
  private seen = 0
  private elapsed = 0
  private lastNew = 0

  constructor(private source: SurfaceSource, private board: SceneObject, width: number, depth: number) {
    this.nx = Math.round(width / STEP) + 1
    this.nz = Math.round(depth / STEP) + 1
    this.x0 = (-(this.nx - 1) * STEP) / 2
    this.z0 = (-(this.nz - 1) * STEP) / 2
    const cells = this.nx * this.nz
    this.samples = new Float32Array(cells * KEEP)
    this.hits = new Uint16Array(cells)
  }

  /** Share of the grid seen so far, 0 to 1. */
  get coverage(): number {
    return this.seen / (this.nx * this.nz)
  }

  /** Casts this frame's rays. Returns true when the scan is over. */
  update(dt: number): boolean {
    this.elapsed += dt
    const t = this.board.getTransform()
    const toWorld = t.getWorldTransform()
    const toBoard = t.getInvertedWorldTransform()
    const cells = this.nx * this.nz
    for (let n = 0; n < Math.min(RAYS_PER_FRAME, cells); n++) {
      const c = this.next
      this.next = (c + 1) % cells
      const x = this.x0 + (c % this.nx) * STEP
      const z = this.z0 + Math.floor(c / this.nx) * STEP
      const hit = this.source.castDown(toWorld.multiplyPoint(new vec3(x, RAY_TOP, z)), toWorld.multiplyPoint(new vec3(x, RAY_BOTTOM, z)))
      if (!hit) continue
      this.samples[c * KEEP + (this.hits[c] % KEEP)] = toBoard.multiplyPoint(hit.position).y
      this.hits[c]++
      if (this.hits[c] === MIN_HITS) {
        this.seen++
        this.lastNew = this.elapsed
      }
    }
    if (this.elapsed < MIN_SCAN_TIME) return false
    if (this.coverage >= GOOD_COVERAGE || this.elapsed >= MAX_SCAN_TIME) return true
    return this.coverage >= STALE_COVERAGE && this.elapsed - this.lastNew >= STALE_TIME
  }

  /** The surface as seen so far (also used to draw the grid while scanning). */
  grid(): {grid: RoomGrid; base: number} {
    const {nx, nz} = this
    const cells = nx * nz
    const medians: number[] = new Array(cells).fill(NaN)
    for (let c = 0; c < cells; c++) {
      if (this.hits[c] < MIN_HITS) continue
      const list = Array.from(this.samples.subarray(c * KEEP, c * KEEP + Math.min(this.hits[c], KEEP))).sort((a, b) => a - b)
      medians[c] = list[list.length >> 1]
    }
    const base = baseLevel(medians)
    const heights: number[] = new Array(cells).fill(0)
    const blocked: boolean[] = new Array(cells).fill(true)
    for (let c = 0; c < cells; c++) {
      const v = medians[c]
      if (isNaN(v) || v < base - DROP) continue
      blocked[c] = false
      const h = v - base
      heights[c] = h < FLAT ? 0 : h
    }
    fillGaps(heights, blocked, medians, nx, nz)
    return {grid: {x0: this.x0, z0: this.z0, step: STEP, nx, nz, heights, blocked}, base}
  }

  /** The finished board, or null when too little of it can be built on. */
  result(baked: ResourceDef[]): ScanResult | null {
    const {grid, base} = this.grid()
    const free = grid.blocked.filter((b) => !b).length
    if (free / (this.nx * this.nz) < MIN_PLAYABLE) return null
    const resources = layoutResources(grid, baked, Math.floor(Math.random() * 1e9))
    return {
      base,
      board: {
        real: true,
        width: (this.nx - 1) * STEP,
        depth: (this.nz - 1) * STEP,
        resources,
        heightfield: {x0: grid.x0, z0: grid.z0, step: STEP, nx: this.nx, nz: this.nz, heights: grid.heights, blocked: grid.blocked},
      },
    }
  }
}

/** The height most of the grid sits at (in 1 cm bins): the table top or the floor. */
function baseLevel(values: number[]): number {
  const bins = new Map<number, {n: number; sum: number}>()
  for (const v of values) {
    if (isNaN(v)) continue
    const k = Math.round(v / 0.02)
    const b = bins.get(k) ?? {n: 0, sum: 0}
    b.n++
    b.sum += v
    bins.set(k, b)
  }
  let best: {n: number; sum: number} | null = null
  bins.forEach((b) => {
    if (!best || b.n > best.n) best = b
  })
  const top = best as {n: number; sum: number} | null
  return top ? top.sum / top.n : 0
}

/** Small holes in the mesh: a never-seen point with mostly seen neighbours takes their median. */
function fillGaps(heights: number[], blocked: boolean[], seen: number[], nx: number, nz: number): void {
  for (let pass = 0; pass < 2; pass++) {
    const fills: [number, number][] = []
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i
        if (!blocked[k] || !isNaN(seen[k])) continue
        const near: number[] = []
        for (let b = -1; b <= 1; b++) {
          for (let a = -1; a <= 1; a++) {
            const x = i + a
            const y = j + b
            if ((a || b) && x >= 0 && y >= 0 && x < nx && y < nz && !blocked[y * nx + x]) near.push(heights[y * nx + x])
          }
        }
        if (near.length >= 5) fills.push([k, near.sort((p, q) => p - q)[near.length >> 1]])
      }
    }
    for (const [k, h] of fills) {
      heights[k] = h
      blocked[k] = false
    }
  }
}
