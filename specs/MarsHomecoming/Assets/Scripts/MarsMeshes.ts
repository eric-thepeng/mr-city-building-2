// MarsMeshes — small procedural meshes (MeshBuilder): beam cylinder, detect sphere, dust ring,
// and the gas-vent puffs, which are all one mesh rewritten each frame (one draw call, the
// stand-in for the WebXR InstancedMesh in makeGasVents).
// Must not: hold game state.

function newBuilder(): MeshBuilder {
  const b = new MeshBuilder([
    {name: "position", components: 3},
    {name: "normal", components: 3, normalized: true},
  ])
  b.topology = MeshTopology.Triangles
  b.indexType = MeshIndexType.UInt16
  return b
}

/** Unit-height cylinder centred on the origin (y from -0.5 to 0.5). */
export function cylinderMesh(radius: number, segments: number): RenderMesh {
  const b = newBuilder()
  const v: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2
    const x = Math.cos(a)
    const z = Math.sin(a)
    v.push(x * radius, -0.5, z * radius, x, 0, z)
    v.push(x * radius, 0.5, z * radius, x, 0, z)
  }
  for (let i = 0; i < segments; i++) {
    const k = i * 2
    idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
  }
  b.appendVerticesInterleaved(v)
  b.appendIndices(idx)
  b.updateMesh()
  return b.getMesh()
}

/** UV sphere of radius 1. */
export function sphereMesh(segments: number, rings: number): RenderMesh {
  const b = newBuilder()
  const v: number[] = []
  const idx: number[] = []
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI
    for (let s = 0; s <= segments; s++) {
      const th = (s / segments) * Math.PI * 2
      const x = Math.sin(phi) * Math.cos(th)
      const y = Math.cos(phi)
      const z = Math.sin(phi) * Math.sin(th)
      v.push(x, y, z, x, y, z)
    }
  }
  const row = segments + 1
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * row + s
      idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row)
    }
  }
  b.appendVerticesInterleaved(v)
  b.appendIndices(idx)
  b.updateMesh()
  return b.getMesh()
}

/** Flat ring in the XZ plane from `inner` to radius 1, facing up (draw it two-sided). */
export function ringMesh(inner: number, segments: number): RenderMesh {
  const b = newBuilder()
  const v: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2
    const x = Math.cos(a)
    const z = Math.sin(a)
    v.push(x * inner, 0, z * inner, 0, 1, 0)
    v.push(x, 0, z, 0, 1, 0)
  }
  for (let i = 0; i < segments; i++) {
    const k = i * 2
    idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3)
  }
  b.appendVerticesInterleaved(v)
  b.appendIndices(idx)
  b.updateMesh()
  return b.getMesh()
}

// An icosahedron: 12 vertices per puff keeps the per-frame rewrite cheap.
const T = (1 + Math.sqrt(5)) / 2
const ICO_V = [
  [-1, T, 0], [1, T, 0], [-1, -T, 0], [1, -T, 0],
  [0, -1, T], [0, 1, T], [0, -1, -T], [0, 1, -T],
  [T, 0, -1], [T, 0, 1], [-T, 0, -1], [-T, 0, 1],
].map((p) => {
  const l = Math.hypot(p[0], p[1], p[2])
  return [p[0] / l, p[1] / l, p[2] / l]
})
const ICO_F = [
  0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
  3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
]

/**
 * Gas vents: around each vent a few puffs churn, and others rise, swell and thin out.
 * Every puff on the board is in one mesh (board space, game units), rewritten in update().
 */
export class GasPuffs {
  static readonly LOW = 4
  static readonly RISE = 2
  private builder: MeshBuilder
  private vert: number[] = new Array(6).fill(0)

  constructor(private homes: vec3[]) {
    this.builder = newBuilder()
    const per = GasPuffs.LOW + GasPuffs.RISE
    const v: number[] = []
    const idx: number[] = []
    for (let n = 0; n < homes.length * per; n++) {
      for (const p of ICO_V) v.push(0, 0, 0, p[0], p[1], p[2])
      for (const f of ICO_F) idx.push(n * 12 + f)
    }
    this.builder.appendVerticesInterleaved(v)
    this.builder.appendIndices(idx)
    this.update(0)
  }

  get mesh(): RenderMesh {
    return this.builder.getMesh()
  }

  update(time: number): void {
    const LOW = GasPuffs.LOW
    const RISE = GasPuffs.RISE
    const per = LOW + RISE
    const out = this.vert
    this.homes.forEach((home, vent) => {
      const seed = vent * 1.93
      for (let i = 0; i < per; i++) {
        let x: number
        let y: number
        let z: number
        let size: number
        if (i < LOW) {
          // the cloud itself: a few puffs churning around the vent mouth
          const a = time * (0.8 + 0.2 * i) + seed + i * 1.6
          x = Math.sin(a) * 0.01
          y = 0.008 + 0.003 * Math.sin(a * 1.7)
          z = Math.cos(a * 0.8) * 0.008
          size = 0.012 + 0.003 * Math.sin(a * 1.3)
        } else {
          // now and then a small wisp drifts up a little and fades
          const t = (time * 0.22 + seed + (i - LOW) / RISE) % 1
          x = Math.sin(time * 0.6 + seed + i) * 0.006 * t
          y = 0.012 + t * 0.035
          z = 0
          size = (0.006 + 0.004 * t) * Math.min(1, (1 - t) * 2.5)
        }
        size = Math.max(size, 0.0001)
        const base = (vent * per + i) * 12
        for (let k = 0; k < 12; k++) {
          const n = ICO_V[k]
          out[0] = home.x + x + n[0] * size
          out[1] = home.y + y + n[1] * size
          out[2] = home.z + z + n[2] * size
          out[3] = n[0]
          out[4] = n[1]
          out[5] = n[2]
          this.builder.setVertexInterleaved(base + k, out)
        }
      }
    })
    this.builder.updateMesh()
  }
}
