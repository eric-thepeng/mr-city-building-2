// MarsMapFlow — what happens before a game: pick the Mars map or the real space; for the real
// space, look at a table or the floor, scan it once, and hand the finished board to MarsMain.
// Owns: the steps, the panel's position, the outline and grid drawn on the real surface.
// Expects: the sandbox root and Board, the camera. Must not: create the Game (MarsMain does).

import {CM_PER_UNIT} from "./MarsBuilding"
import {BoardLayout} from "./MarsData"
import {MapPanel} from "./MarsMapUI"
import {boxMesh, outlineMesh, roomGridMesh} from "./MarsMeshes"
import {OBJECT_HEIGHT, RoomGrid} from "./MarsRoomLayout"
import {RoomScanner, SurfaceHit, SurfaceSource, TestRoomSource, WorldMeshSource} from "./MarsRoomScan"

type Step = "menu" | "aim" | "scan" | "failed"

export interface MapFlowOptions {
  root: SceneObject
  board: SceneObject
  camera: SceneObject
  /** a material to tint for the lines drawn on real surfaces */
  lineMaterial: Material
  baked: BoardLayout
  /** Lens Studio Preview: no depth, the real space is a test room */
  inPreview: boolean
  boardDistance: number
  boardBelowEyes: number
  /** the chosen board: null = the Mars map */
  onDone: (board: BoardLayout | null) => void
}

const PANEL_AHEAD = 70
const PANEL_UP = 8
const PANEL_FOLLOW = 3
const AIM_FOLLOW = 10
/** A surface this level (normal.y) can be the base. */
const LEVEL = 0.85
/** How far ahead the aimed surface may be, in cm. */
const MIN_AIM = 45
const MAX_AIM = 220
/** The surface must be this far below the eyes, in cm. */
const MIN_BELOW = 15
/** Seconds the last good aim is kept when the mesh flickers. */
const AIM_GRACE = 0.6
const GRID_REFRESH = 0.5

const MENU_BODY = "Mars Map: the built-in terrain.\nReal Space: scan the table or floor in front of you."
const AIM_BODY = "Look at a clear table or the floor.\nThe outline shows where the game will be."
const AIM_WAIT = "Look around slowly so the glasses can see the surface."

export class MapFlow {
  private step: Step = "menu"
  private panel: MapPanel
  private pressed: "first" | "second" | null = null
  private source: SurfaceSource | null = null
  private scanner: RoomScanner | null = null
  private camT: Transform
  private rootT: Transform
  private outline: SceneObject
  private groundLines: RenderMeshVisual
  private objectLines: RenderMeshVisual
  private testObjects: SceneObject | null = null
  private boxMaterial: Material
  private placed = false
  private lastGoodAim = -Infinity
  private aimOk = false
  private frame = 0
  private gridTimer = 0
  private shownPercent = -1
  private panelPlaced = false

  constructor(private o: MapFlowOptions) {
    this.camT = o.camera.getTransform()
    this.rootT = o.root.getTransform()
    this.panel = new MapPanel(o.root)
    this.panel.onFirst.add(() => (this.pressed = "first"))
    this.panel.onSecond.add(() => (this.pressed = "second"))

    const ground = lineMaterial(o.lineMaterial, new vec3(0.35, 0.85, 1), 0.75)
    const object = lineMaterial(o.lineMaterial, new vec3(1, 0.72, 0.25), 0.95)
    this.boxMaterial = lineMaterial(o.lineMaterial, new vec3(0.5, 0.55, 0.65), 0.28)
    this.outline = this.addVisual("ScanOutline", ground).getSceneObject()
    ;(this.outline.getComponent("Component.RenderMeshVisual") as RenderMeshVisual).mesh = outlineMesh(o.baked.width, o.baked.depth, 0.008)
    this.outline.getTransform().setLocalPosition(new vec3(0, 0.006, 0))
    this.outline.enabled = false
    this.groundLines = this.addVisual("RoomGrid", ground)
    this.objectLines = this.addVisual("RoomObjects", object)
    this.showMenu()
  }

  private addVisual(name: string, material: Material): RenderMeshVisual {
    const s = global.scene.createSceneObject(name)
    s.setParent(this.o.board)
    s.layer = this.o.board.layer
    const v = s.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    v.mainMaterial = material
    s.enabled = name === "ScanOutline"
    return v
  }

  update(dt: number): void {
    this.followPanel(dt)
    const pressed = this.pressed
    this.pressed = null
    if (this.step === "menu") {
      if (pressed === "first") this.finish(null)
      else if (pressed === "second") this.startAim()
    } else if (this.step === "aim") {
      this.updateAim(dt, pressed)
    } else if (this.step === "scan") {
      this.updateScan(dt)
    } else if (pressed === "first") {
      if (this.source?.available) this.startAim()
      else this.finish(null)
    } else if (pressed === "second") {
      this.finish(null)
    }
  }

  // --- steps -------------------------------------------------------------------
  private showMenu(): void {
    this.step = "menu"
    this.stopSource()
    this.clearSurface()
    this.outline.enabled = false
    const note = this.o.inPreview ? "\n(Preview has no depth: Real Space uses a test room.)" : ""
    this.panel.show("Choose your map", MENU_BODY + note, "Mars Map", "Real Space")
  }

  private startAim(): void {
    this.clearSurface()
    if (!this.source) this.source = this.makeSource()
    if (!this.source.available) {
      this.step = "failed"
      this.panel.show("Real Space is not available", "This device can't map its surroundings.", "Mars Map")
      return
    }
    this.source.start()
    this.step = "aim"
    this.placed = false
    this.aimOk = false
    this.lastGoodAim = -Infinity
    this.outline.enabled = false
    this.panel.show("Find a surface", AIM_WAIT, "Scan Here", "Back")
    this.panel.setFirstEnabled(false)
  }

  private makeSource(): SurfaceSource {
    if (!this.o.inPreview) {
      const tracking = this.o.camera.getComponent("Component.DeviceTracking") as DeviceTracking | null
      return new WorldMeshSource(tracking)
    }
    const test = new TestRoomSource(this.camT.getWorldPosition(), this.flatForward(), this.o.boardDistance, this.o.boardBelowEyes)
    this.showTestObjects(test)
    return test
  }

  private updateAim(dt: number, pressed: "first" | "second" | null): void {
    if (pressed === "second") return this.showMenu()
    if (pressed === "first" && this.aimOk) return this.startScan()
    // the mesh is only worth asking every few frames
    if (++this.frame % 3 === 0) {
      const from = this.camT.getWorldPosition()
      const dir = this.camT.getWorldRotation().multiplyVec3(new vec3(0, 0, -1))
      const hit = this.safeAim(from, dir)
      if (hit && this.isGoodSurface(from, hit)) {
        this.lastGoodAim = getTime()
        this.moveBoardTo(hit.position, dt)
      }
    }
    const ok = getTime() - this.lastGoodAim <= AIM_GRACE
    if (ok !== this.aimOk) {
      this.aimOk = ok
      this.outline.enabled = ok
      this.panel.setFirstEnabled(ok)
      this.panel.setBody(ok ? AIM_BODY : AIM_WAIT)
    }
  }

  private safeAim(from: vec3, dir: vec3): SurfaceHit | null {
    try {
      return this.source!.aim(from, dir)
    } catch (e) {
      print(`MarsMapFlow: aim failed: ${e}`)
      return null
    }
  }

  private isGoodSurface(eye: vec3, hit: SurfaceHit): boolean {
    if (hit.normal.y < LEVEL) return false
    const away = hit.position.sub(eye)
    const flat = Math.hypot(away.x, away.z)
    return flat >= MIN_AIM && flat <= MAX_AIM && -away.y >= MIN_BELOW
  }

  private moveBoardTo(point: vec3, dt: number): void {
    const eye = this.camT.getWorldPosition()
    const d = new vec3(point.x - eye.x, 0, point.z - eye.z).normalize()
    const k = this.placed ? 1 - Math.exp(-AIM_FOLLOW * Math.max(dt * 3, 0.01)) : 1
    const p = vec3.lerp(this.rootT.getWorldPosition(), point, k)
    this.rootT.setWorldPosition(p)
    this.rootT.setWorldRotation(quat.fromEulerAngles(0, Math.atan2(-d.x, -d.z), 0))
    this.placed = true
  }

  private startScan(): void {
    this.step = "scan"
    this.scanner = new RoomScanner(this.source!, this.o.board, this.o.baked.width, this.o.baked.depth)
    this.gridTimer = 0
    this.shownPercent = -1
    this.panel.show("Mapping your space", "Look slowly around the outlined area.\nMapped 0%")
  }

  private updateScan(dt: number): void {
    const scanner = this.scanner!
    let over = false
    try {
      over = scanner.update(dt)
    } catch (e) {
      print(`MarsMapFlow: scan failed: ${e}`)
      return this.fail()
    }
    const percent = Math.round(scanner.coverage * 100)
    if (percent !== this.shownPercent) {
      this.shownPercent = percent
      this.panel.setBody(`Look slowly around the outlined area.\nMapped ${percent}%`)
    }
    this.gridTimer -= dt
    if (this.gridTimer <= 0) {
      this.gridTimer = GRID_REFRESH
      this.drawSurface(scanner.grid().grid)
    }
    if (!over) return
    const result = scanner.result(this.o.baked.resources)
    if (!result) return this.fail()
    print(`MarsMapFlow: scanned ${percent}% of ${scanner.nx}x${scanner.nz} points`)
    // the board's zero height is the surface most of the area sits on
    const p = this.rootT.getWorldPosition()
    this.rootT.setWorldPosition(new vec3(p.x, p.y + result.base * CM_PER_UNIT, p.z))
    const hf = result.board.heightfield
    this.drawSurface({x0: hf.x0, z0: hf.z0, step: hf.step, nx: hf.nx, nz: hf.nz, heights: hf.heights, blocked: hf.blocked!})
    this.outline.enabled = false
    this.finish(result.board)
  }

  private fail(): void {
    this.step = "failed"
    this.stopSource()
    this.clearSurface()
    this.outline.enabled = false
    this.panel.show("Couldn't map this surface", "Try a clear, well-lit surface with some texture,\nor play on the Mars map.", "Try Again", "Mars Map")
  }

  private finish(board: BoardLayout | null): void {
    this.stopSource()
    this.panel.hide()
    if (!board) {
      this.clearSurface()
      this.outline.enabled = false
      if (this.testObjects) this.testObjects.destroy()
      this.testObjects = null
    }
    this.o.onDone(board)
  }

  private stopSource(): void {
    this.source?.stop()
  }

  // --- what is drawn -----------------------------------------------------------
  private drawSurface(g: RoomGrid): void {
    setLines(this.groundLines, roomGridMesh(g, OBJECT_HEIGHT, false))
    setLines(this.objectLines, roomGridMesh(g, OBJECT_HEIGHT, true))
  }

  private clearSurface(): void {
    this.groundLines.getSceneObject().enabled = false
    this.objectLines.getSceneObject().enabled = false
  }

  /** Preview only: shows the test room's table objects, which stand in for real ones. */
  private showTestObjects(test: TestRoomSource): void {
    const root = global.scene.createSceneObject("TestRoomObjects")
    root.layer = this.o.root.layer
    const mesh = boxMesh()
    const yaw = quat.lookAt(test.forward.uniformScale(-1), vec3.up())
    for (const b of test.boxes) {
      const s = global.scene.createSceneObject("TestObject")
      s.setParent(root)
      s.layer = root.layer
      const t = s.getTransform()
      t.setWorldPosition(test.center.add(test.right.uniformScale(b.r)).add(test.forward.uniformScale(b.f)).add(new vec3(0, b.h / 2, 0)))
      t.setWorldRotation(yaw)
      t.setWorldScale(new vec3(b.w, b.h, b.d))
      const v = s.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      v.mesh = mesh
      v.mainMaterial = this.boxMaterial
    }
    this.testObjects = root
  }

  /** The panel floats ahead of the eyes and catches up slowly, so it can be pressed. */
  private followPanel(dt: number): void {
    const eye = this.camT.getWorldPosition()
    const q = this.camT.getWorldRotation()
    const target = eye.add(q.multiplyVec3(new vec3(0, PANEL_UP, -PANEL_AHEAD)))
    const t = this.panel.object.getTransform()
    const k = this.panelPlaced ? 1 - Math.exp(-PANEL_FOLLOW * dt) : 1
    const p = vec3.lerp(t.getWorldPosition(), target, k)
    this.panelPlaced = true
    t.setWorldPosition(p)
    const back = eye.sub(p)
    if (back.lengthSquared > 1e-6) t.setWorldRotation(quat.lookAt(back.normalize(), vec3.up()))
  }

  private flatForward(): vec3 {
    const f = this.camT.getWorldRotation().multiplyVec3(new vec3(0, 0, -1))
    const flat = new vec3(f.x, 0, f.z)
    return flat.lengthSquared < 1e-6 ? new vec3(0, 0, -1) : flat.normalize()
  }
}

/** A bright, flat-looking copy of a transparent material. */
function lineMaterial(source: Material, color: vec3, alpha: number): Material {
  const m = source.clone()
  const pass = m.mainPass as any
  pass.baseColorFactor = new vec4(color.x, color.y, color.z, alpha)
  pass.emissiveFactor = color
  pass.twoSided = true
  return m
}

function setLines(visual: RenderMeshVisual, mesh: RenderMesh | null): void {
  const s = visual.getSceneObject()
  if (mesh) visual.mesh = mesh
  s.enabled = !!mesh
}
