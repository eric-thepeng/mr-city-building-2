// MarsModels — the baked world (Assets/Models/world.glb, from webxr/data/world.glb) as a model
// library, plus the game's materials. Port of AssetLibrary in webxr/src/assets.js.
// Owns: finding nodes by name (block_<Key>, resource_<index>, terrain), cloning them with the
// game's materials, the red "can't build" look (a material swap instead of a second model),
// and local bounding boxes.
// Expects: the instantiated (disabled) world prefab root, and the materials from Assets/Materials.
// Must not: hold game state.

/** An axis-aligned box as [minX, minY, minZ, maxX, maxY, maxZ]. */
export type Box = number[]

export function emptyBox(): Box {
  return [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
}

export function boxExpandPoint(b: Box, p: vec3): void {
  b[0] = Math.min(b[0], p.x)
  b[1] = Math.min(b[1], p.y)
  b[2] = Math.min(b[2], p.z)
  b[3] = Math.max(b[3], p.x)
  b[4] = Math.max(b[4], p.y)
  b[5] = Math.max(b[5], p.z)
}

export function boxIsEmpty(b: Box): boolean {
  return !(b[0] <= b[3])
}

/** The material names used inside world.glb, mapped to this project's materials. */
const MATERIAL_KEYS: Record<string, string> = {
  M_Building: "Building",
  M_Building_Extra: "BuildingExtra",
  M_Sign: "Sign",
  M_Glass: "Glass",
  M_Ore: "Ore",
  Terrain: "Terrain",
  SandboxWall: "SandboxWall",
  Crystal: "Crystal",
  Cloud: "Cloud",
}

export interface MaterialSet {
  regular: Record<string, Material>
  error: Record<string, Material>
  beam: Material
  beamError: Material
  detect: Material
  ghost: Material
  dust: Material
  gas: Material
}

export class ModelLibrary {
  private nodes: Record<string, SceneObject> = {}
  /** regular material -> its red error variant */
  private toError = new Map<Material, Material>()
  private toRegular = new Map<Material, Material>()
  private warned: Record<string, boolean> = {}

  constructor(private worldRoot: SceneObject, readonly mats: MaterialSet) {
    this.index(worldRoot)
    for (const k of Object.keys(mats.error)) {
      const r = mats.regular[k]
      const e = mats.error[k]
      if (r && e) {
        this.toError.set(r, e)
        this.toRegular.set(e, r)
      }
    }
  }

  private index(o: SceneObject): void {
    const name = o.name
    if (name.startsWith("block_") || name.startsWith("resource_") || name === "terrain") this.nodes[name] = o
    for (let i = 0; i < o.getChildrenCount(); i++) this.index(o.getChild(i))
  }

  has(name: string): boolean {
    return !!this.nodes[name]
  }

  /** A copy of a baked model under `parent`, at the parent's origin, with the game's materials. */
  instance(name: string, parent: SceneObject): SceneObject {
    const src = this.nodes[name]
    if (!src) {
      const empty = global.scene.createSceneObject(name)
      empty.setParent(parent)
      return empty
    }
    const copy = parent.copyWholeHierarchy(src)
    copy.enabled = true
    const t = copy.getTransform()
    t.setLocalPosition(vec3.zero())
    t.setLocalRotation(quat.quatIdentity())
    t.setLocalScale(vec3.one())
    this.forEachVisual(copy, (v) => {
      const mat = this.materialFor(v.mainMaterial)
      if (mat) v.mainMaterial = mat
    })
    return copy
  }

  /** Every material on a model, swapped to (or back from) the red "can't build" variant. */
  setError(model: SceneObject, on: boolean): void {
    this.forEachVisual(model, (v) => {
      const m = v.mainMaterial
      const swap = on ? this.toError.get(m) : this.toRegular.get(m)
      if (swap) v.mainMaterial = swap
    })
  }

  /** Replace every material on a model (ghost clouds). */
  setAllMaterials(model: SceneObject, mat: Material): void {
    this.forEachVisual(model, (v) => (v.mainMaterial = mat))
  }

  /**
   * Bounding box of a model in the space of `space` (an ancestor), from the meshes' own boxes.
   * Call while `space` holds only this model (e.g. right after instancing).
   */
  localBox(model: SceneObject, space: SceneObject): Box {
    const box = emptyBox()
    const inv = space.getTransform().getInvertedWorldTransform()
    this.forEachVisual(model, (v) => {
      const mesh = v.mesh
      if (!mesh) return
      const a = mesh.aabbMin
      const b = mesh.aabbMax
      const m = inv.mult(v.getSceneObject().getTransform().getWorldTransform())
      for (let i = 0; i < 8; i++) {
        const c = new vec3(i & 1 ? b.x : a.x, i & 2 ? b.y : a.y, i & 4 ? b.z : a.z)
        boxExpandPoint(box, m.multiplyPoint(c))
      }
    })
    return box
  }

  /**
   * Resource nodes never move, so draw them all as one mesh per material (port of
   * mergeResourceVisuals in webxr/src/game.js: ~45 draw calls -> 2). The source models are
   * switched off; their buildings keep their boxes and hover targets.
   */
  mergeStatic(models: SceneObject[], space: SceneObject): SceneObject {
    const root = global.scene.createSceneObject("MergedResources")
    root.setParent(space)
    const inv = space.getTransform().getInvertedWorldTransform()
    const buckets = new Map<Material, {pos: number[]; idx: number[]}>()
    for (const model of models) {
      this.forEachVisual(model, (v) => {
        const mesh = v.mesh
        if (!mesh || mesh.topology !== MeshTopology.Triangles) return
        const m = inv.mult(v.getSceneObject().getTransform().getWorldTransform())
        const p = mesh.getVertexDataForAttribute("position")
        const n = mesh.getVertexDataForAttribute("normal")
        const idx = mesh.getIndexBuffer()
        let b = buckets.get(v.mainMaterial)
        if (!b) buckets.set(v.mainMaterial, (b = {pos: [], idx: []}))
        const base = b.pos.length / 6
        for (let i = 0; i < p.length / 3; i++) {
          const wp = m.multiplyPoint(new vec3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]))
          let wn = n.length ? m.multiplyDirection(new vec3(n[i * 3], n[i * 3 + 1], n[i * 3 + 2])) : vec3.up()
          wn = wn.lengthSquared > 0 ? wn.normalize() : vec3.up()
          b.pos.push(wp.x, wp.y, wp.z, wn.x, wn.y, wn.z)
        }
        for (const k of idx) b.idx.push(base + k)
      })
      model.enabled = false
    }
    buckets.forEach((b, mat) => {
      const mb = new MeshBuilder([
        {name: "position", components: 3},
        {name: "normal", components: 3, normalized: true},
      ])
      mb.topology = MeshTopology.Triangles
      mb.indexType = MeshIndexType.UInt16 // the resource nodes are a few thousand vertices
      mb.appendVerticesInterleaved(b.pos)
      mb.appendIndices(b.idx)
      mb.updateMesh()
      const o = global.scene.createSceneObject(`Merged-${mat.name}`)
      o.setParent(root)
      const rmv = o.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      rmv.mesh = mb.getMesh()
      rmv.mainMaterial = mat
    })
    return root
  }

  forEachVisual(o: SceneObject, fn: (v: RenderMeshVisual) => void): void {
    const visuals = o.getComponents("Component.RenderMeshVisual") as RenderMeshVisual[]
    for (const v of visuals) fn(v)
    for (let i = 0; i < o.getChildrenCount(); i++) this.forEachVisual(o.getChild(i), fn)
  }

  private materialFor(imported: Material): Material | null {
    if (!imported) return null
    // "Crystal3" / "Cloud1": numbered copies made by the importer
    // runtime names carry the folder inside the GLB ("Materials/Crystal3")
    const name = imported.name.replace(/^.*\//, "").replace(/\d+$/, "")
    const key = MATERIAL_KEYS[name]
    if (!key && !this.warned[imported.name]) {
      this.warned[imported.name] = true
      print(`MarsModels: no game material for "${imported.name}"`)
    }
    return key ? this.mats.regular[key] ?? null : null
  }
}
