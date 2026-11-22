// MarsTerrain — rebuilds the baked terrain mesh for the WebXR look: flat-shaded faces and rock
// bands on the cliff walls. Port of `flatShading` + addRockStrata in webxr/src/assets.js, without
// a custom shader: each face gets its own normal, and a small lookup texture
// (Assets/Textures/terrain_strata.png, made by specs/tools/gen-strata.py) holds the bands.
//   texture U = how cliff-like the face is (0 = ground, 1 = wall)
//   texture V = height on the board
// Must not: hold game state.

/** Height covered by the strata texture: 14 bands of 0.034 game units (see gen-strata.py). */
const STRATA_TOP = 0.034 * 14
/** Lookup texture width in pixels, to sample the middle of a column. */
const STRATA_W = 32
/** Ground colour under the lights (the WebXR hemisphere light gives it this cool grey). */
const GROUND_TINT = [0.46, 0.48, 0.55]

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function buildTerrainMesh(src: RenderMesh): RenderMesh {
  const p = src.getVertexDataForAttribute("position")
  const col = src.getVertexDataForAttribute("color")
  const idx = src.getIndexBuffer()
  const count = p.length / 3
  const colSize = col.length ? Math.round(col.length / count) : 0

  const out: number[] = []
  const indices: number[] = []
  for (let f = 0; f + 2 < idx.length; f += 3) {
    const a = idx[f] * 3
    const b = idx[f + 1] * 3
    const c = idx[f + 2] * 3
    const ux = p[b] - p[a]
    const uy = p[b + 1] - p[a + 1]
    const uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a]
    const vy = p[c + 1] - p[a + 1]
    const vz = p[c + 2] - p[a + 2]
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
    nx /= len
    ny /= len
    nz /= len
    const cliff = smoothstep(0.45, 0.75, 1 - Math.abs(ny))
    const u = (cliff * (STRATA_W - 1) + 0.5) / STRATA_W
    for (const k of [idx[f], idx[f + 1], idx[f + 2]]) {
      const r = colSize ? col[k * colSize] : 1
      const g = colSize ? col[k * colSize + 1] : 1
      const bl = colSize ? col[k * colSize + 2] : 1
      const y = p[k * 3 + 1]
      out.push(p[k * 3], y, p[k * 3 + 2], nx, ny, nz, u, Math.min(0.999, Math.max(0.001, y / STRATA_TOP)))
      // walls take their colour from the bands; ground keeps its baked colour
      out.push(
        r * GROUND_TINT[0] * (1 - cliff) + cliff,
        g * GROUND_TINT[1] * (1 - cliff) + cliff,
        bl * GROUND_TINT[2] * (1 - cliff) + cliff,
        1,
      )
      indices.push(indices.length)
    }
  }

  const mb = new MeshBuilder([
    {name: "position", components: 3},
    {name: "normal", components: 3, normalized: true},
    {name: "texture0", components: 2},
    {name: "color", components: 4},
  ])
  mb.topology = MeshTopology.Triangles
  mb.indexType = MeshIndexType.UInt16
  mb.appendVerticesInterleaved(out)
  mb.appendIndices(indices)
  mb.updateMesh()
  return mb.getMesh()
}
