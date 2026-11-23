// MarsBuilding — one building or resource node on the board. Port of `Building` in
// webxr/src/game.js (Unity: BuildingBase.cs, SupportBeam.cs, ScoringIdentifier.cs).
// Owns: its SceneObjects (model, beams, detect sphere, labels), grab / hover wiring through
// InteractionKit (Interactable + InteractableManipulation, near pinch and far ray), support-beam
// length and cost, overlap test, scoring and the state machine WAITING -> ONGOING -> COMPLETE.
// Positions are in board space (game units); the board object is scaled to cm.
// Must not: decide hands, milestones or UI layout (MarsGame / MarsProgress do).
// Size reason: deliberately large, a 1:1 port of one WebXR class kept whole so it diffs against webxr/src/game.js.

import {Interactable} from "InteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {
  InteractableManipulation,
  RotationAxis,
} from "InteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation"
import type {Game, Tween} from "./MarsGame"
import {BlockDef, BuildingInfo, ResourceDef, displayName} from "./MarsData"
import {Box, boxExpandPoint, boxIsEmpty, emptyBox} from "./MarsModels"
import {WorldLabel, rgba} from "./MarsLabelsUI"

export enum State {
  WAITING = "WAITING",
  ONGOING = "ONGOING",
  COMPLETE = "COMPLETE",
}

/** Board scale: how many cm one game unit is shown as (Unity metres at half size). */
export const CM_PER_UNIT = 50
const cm = (units: number) => +(units * CM_PER_UNIT).toFixed(1)

const RED = rgba("#ff5a5a")
const WHITE = rgba("#ffffff")

interface Beam {
  anchor: vec3
  holder: SceneObject
  body: SceneObject
  bodyT: Transform
  visual: RenderMeshVisual
  length: number
}

/** Box `local` (in an object's space) moved by position p and rotation q, as an axis-aligned box. */
export function placedBox(local: Box, p: vec3, q: quat, shrink = 0): Box {
  const out = emptyBox()
  for (let i = 0; i < 8; i++) {
    const c = new vec3(i & 1 ? local[3] : local[0], i & 2 ? local[4] : local[1], i & 4 ? local[5] : local[2])
    boxExpandPoint(out, q.multiplyVec3(c).add(p))
  }
  if (shrink) {
    for (let i = 0; i < 3; i++) {
      out[i] += shrink
      out[i + 3] -= shrink
    }
  }
  return out
}

function boxesIntersect(a: Box, b: Box): boolean {
  return a[0] <= b[3] && a[3] >= b[0] && a[1] <= b[4] && a[4] >= b[1] && a[2] <= b[5] && a[5] >= b[2]
}

export class Building {
  readonly key: string
  readonly isResource: boolean
  readonly isAir: boolean
  readonly resource: ResourceDef | null
  readonly info: BuildingInfo
  readonly def: BlockDef
  readonly root: SceneObject
  readonly rootT: Transform
  readonly modelName: string
  readonly model: SceneObject
  readonly localBox: Box
  readonly top: number
  readonly maxBeamLength: number
  state: State
  canScore: boolean
  currentCost = 0
  displayState = true
  lift = 0
  tween: Tween | null = null
  /** finished buildings and resources: where they stand, for beams and overlaps */
  boardBox: Box | null = null
  blockedBy: Building | null = null
  overlaps: Building | null = null
  // clouds
  depleted = false
  home: vec3 | null = null
  phase = 0

  private beams: Beam[] = []
  private nameLabel: WorldLabel | null = null
  private badge: WorldLabel
  private detect: SceneObject | null = null
  private grab: SceneObject | null = null
  private manip: InteractableManipulation | null = null
  private hoverObj: SceneObject | null = null
  private initialPos: vec3
  private initialRot: quat
  private hovered = false

  constructor(
    private game: Game,
    key: string,
    opts: {position?: vec3; resource?: ResourceDef},
  ) {
    this.key = key
    const resource = opts.resource ?? null
    this.resource = resource
    this.isResource = !!resource
    this.isAir = !!resource?.air
    this.info = game.data.buildingInfo[key] ?? {displayName: key, detectDistance: 0, scoring: {}}
    this.def = resource ? {key, maxBeamLength: 0, beams: []} : game.data.blocks[key]
    this.maxBeamLength = this.def.maxBeamLength

    this.root = global.scene.createSceneObject(`Building:${key}`)
    this.root.setParent(game.board)
    this.rootT = this.root.getTransform()
    if (resource) {
      this.rootT.setLocalPosition(new vec3(resource.p[0], resource.p[1], resource.p[2]))
      this.rootT.setLocalRotation(new quat(resource.q[3], resource.q[0], resource.q[1], resource.q[2]))
    } else {
      this.rootT.setLocalPosition(opts.position ?? vec3.zero())
    }

    this.modelName = resource ? `resource_${resource.index}` : `block_${key}`
    this.model = game.models.instance(this.modelName, this.root)

    // the box used for grabbing, overlaps and as ground for other buildings' beams
    let box = game.models.localBox(this.model, this.root)
    if (boxIsEmpty(box)) box = [-0.02, -0.02, -0.02, 0.02, 0.02, 0.02]
    if (!resource) {
      // Unity's BuildingBase cube is 4 cm wide; keep at least that much to grab
      box = [Math.min(box[0], -0.02), Math.min(box[1], -0.02), Math.min(box[2], -0.02), Math.max(box[3], 0.02), Math.max(box[4], 0.02), Math.max(box[5], 0.02)]
    }
    this.localBox = box
    this.top = box[4]

    // support beams
    for (const a of this.def.beams) {
      const holder = global.scene.createSceneObject("Beam")
      holder.setParent(this.root)
      holder.getTransform().setLocalPosition(new vec3(a[0], a[1], a[2]))
      const body = global.scene.createSceneObject("BeamBody")
      body.setParent(holder)
      const visual = body.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      visual.mesh = game.meshes.beam
      visual.mainMaterial = game.models.mats.beam
      body.enabled = false
      this.beams.push({anchor: new vec3(a[0], a[1], a[2]), holder, body, bodyT: body.getTransform(), visual, length: 0})
    }

    // labels (the hover info panel is one shared label owned by the game)
    if (!resource) {
      this.nameLabel = new WorldLabel(this.root, CM_PER_UNIT, {height: 0.9}, "NameLabel")
      this.nameLabel.setLocalPosition(new vec3(0, this.top + 0.02, 0))
      this.nameLabel.set(displayName(game.data, key))
      this.nameLabel.visible = true
    }
    this.badge = new WorldLabel(this.root, CM_PER_UNIT, {height: 1.1, bold: true}, "Badge")
    this.badge.setLocalPosition(new vec3(0, this.top + 0.052, 0))

    // DistanceDetectIndication (only for buildings that can be carried)
    if (!resource) {
      const detect = global.scene.createSceneObject("DetectRange")
      detect.setParent(this.root)
      const r = Math.max(this.info.detectDistance ?? 0, 0.001)
      detect.getTransform().setLocalScale(new vec3(r, r, r))
      const dv = detect.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      dv.mesh = game.meshes.sphere
      dv.mainMaterial = game.models.mats.detect
      detect.enabled = false
      this.detect = detect
    }

    this.state = resource ? State.COMPLETE : State.WAITING
    // Unity sets canScore=false on every BuildingBase (resource nodes included); here resource
    // nodes score, so Excavator / Gas Extractor bonuses work (as in the WebXR version).
    this.canScore = !!resource
    this.initialPos = this.rootT.getLocalPosition()
    this.initialRot = this.rootT.getLocalRotation()

    if (resource) {
      if (!this.isAir) this.boardBox = placedBox(box, this.initialPos, this.initialRot)
      this.makeHoverTarget()
    } else {
      this.makeGrabTarget()
    }
  }

  get grabbable(): boolean {
    return this.state !== State.COMPLETE && !this.tween && !this.game.over
  }

  get position(): vec3 {
    return this.rootT.getLocalPosition()
  }

  // --- InteractionKit wiring --------------------------------------------
  private colliderChild(name: string): SceneObject {
    const b = this.localBox
    const o = global.scene.createSceneObject(name)
    o.setParent(this.root)
    o.getTransform().setLocalPosition(new vec3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2))
    const collider = o.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = new vec3(b[3] - b[0], b[4] - b[1], b[5] - b[2])
    collider.shape = shape
    collider.fitVisual = false
    collider.debugDrawEnabled = this.game.debugColliders
    return o
  }

  /** Hand buildings: pinch up close or point and pinch to carry them (yaw only, no scaling). */
  private makeGrabTarget(): void {
    const o = this.colliderChild("Grab")
    const interactable = o.createComponent(Interactable.getTypeName()) as Interactable
    interactable.targetingMode = 3 // direct (near pinch) + indirect (ray)
    const manip = o.createComponent(InteractableManipulation.getTypeName()) as InteractableManipulation
    manip.setManipulateRoot(this.rootT)
    manip.setCanScale(false)
    manip.rotationAxis = RotationAxis.Y
    manip.onManipulationStart.add(() => this.onStartGrab())
    manip.onManipulationEnd.add(() => this.onRelease())
    interactable.onHoverEnter.add(() => this.setHovered(true))
    interactable.onHoverExit.add(() => this.setHovered(false))
    this.grab = o
    this.manip = manip
  }

  /** Resource nodes: pointing at them shows what they are and who earns next to them. */
  private makeHoverTarget(): void {
    const o = this.colliderChild("Hover")
    const interactable = o.createComponent(Interactable.getTypeName()) as Interactable
    interactable.targetingMode = 3
    interactable.onHoverEnter.add(() => this.setHovered(true))
    interactable.onHoverExit.add(() => this.setHovered(false))
    this.hoverObj = o
  }

  private setHovered(on: boolean): void {
    if (this.hovered === on) return
    this.hovered = on
    if (on) this.onHoverStart()
    else this.onHoverEnd()
  }

  /** Keeps grab / hover targets in step with the state (finished, tweening, game over, used-up cloud). */
  syncTargets(): void {
    if (this.grab) {
      // finished buildings stay hoverable (they show their name) but can't be picked up
      const carry = this.grabbable || this.state === State.ONGOING
      const want = carry || this.state === State.COMPLETE
      if (this.grab.enabled !== want) this.grab.enabled = want
      if (this.manip && this.manip.enabled !== carry) {
        this.manip.setCanTranslate(carry)
        this.manip.setCanRotate(carry)
        this.manip.enabled = carry
      }
    }
    if (this.hoverObj) {
      const want = !this.depleted
      if (this.hoverObj.enabled !== want) this.hoverObj.enabled = want
    }
  }

  // --- XRGrabInteractable events ------------------------------------------
  onStartGrab(): void {
    if (this.state === State.COMPLETE || this.game.over) return
    this.cancelTween()
    if (this.state === State.WAITING) this.state = State.ONGOING
    this.setHovered(false)
    if (this.detect) this.detect.enabled = true
    this.game.onGrabStart(this)
  }

  onRelease(): void {
    if (this.state !== State.ONGOING) return
    if (this.detect) this.detect.enabled = false
    this.game.onGrabEnd(this)
    const money = this.game.money
    if (this.currentCost !== -1 && money.has(this.currentCost)) {
      money.spend(this.currentCost)
      if (this.nameLabel) this.nameLabel.visible = false
      this.state = State.COMPLETE
      this.boardBox = placedBox(this.localBox, this.position, this.rootT.getLocalRotation())
      this.harvestScore()
      this.game.cancelAllBadges()
      this.canScore = true
      this.game.sfx("build")
      this.pop()
      this.game.puff(this.position)
      this.game.tickClouds()
      this.syncTargets()
      this.game.hand.buildOne()
    } else {
      this.setDisplayState(true)
      this.resetToWaiting()
      this.game.sfx("fail")
    }
  }

  onHoverStart(): void {
    if (this.isResource) return this.game.showNodeTip(this)
    if (this.state === State.COMPLETE) return this.game.showFinishedTip(this)
    if (this.state !== State.WAITING) return
    this.game.showBuildingTip(this)
  }

  onHoverEnd(): void {
    this.game.hideTip(this)
  }

  // --- per-frame -------------------------------------------------------------
  update(): void {
    if (this.state !== State.ONGOING) return
    let canBuild = true
    let total = 0
    this.blockedBy = null
    this.overlaps = this.findOverlap()
    if (this.overlaps) canBuild = false
    for (const beam of this.beams) {
      const len = this.calculateSupportBeam(beam)
      if (len === -1) canBuild = false
      total += len
    }
    // how far above the ground it is held (shown on the label, like the mouse lift in WebXR)
    this.lift = this.beams.length ? Math.max(0, Math.min(...this.beams.map((b) => b.length))) : 0
    const label = this.nameLabel
    if (!canBuild) {
      this.currentCost = -1
      label?.set(
        this.overlaps
          ? `too close to ${displayName(this.game.data, this.overlaps.key)}`
          : this.blockedBy
            ? `can't stand on ${displayName(this.game.data, this.blockedBy.key)}`
            : `beams too long (max ${cm(this.maxBeamLength)} cm)`,
        RED,
      )
      this.setDisplayState(false)
    } else {
      this.currentCost = Math.trunc(total * (this.def.beamCost ?? 100)) // money per game unit of beam
      const affordable = this.currentCost <= this.game.money.amount
      this.setDisplayState(affordable)
      const lifted = this.lift > 0.001 ? ` · lifted ${cm(this.lift)} cm` : ""
      label?.set(`cost: ${this.currentCost}${lifted}`, affordable ? WHITE : RED)
    }
    this.calculateScoring(false)
  }

  // SupportBeam.CalculateSupportBeam
  private calculateSupportBeam(beam: Beam): number {
    const game = this.game
    const p = this.rootT.getLocalRotation().multiplyVec3(beam.anchor).add(this.position)
    // terrain: O(1) lookup on the baked heightfield
    const ground = game.heightfield.at(p.x, p.z)
    let distance = p.y >= ground ? p.y - ground : Infinity
    // finished buildings and resource nodes: the closest box straight below, within reach
    const far = Math.min(this.maxBeamLength, distance)
    let hit: Building | null = null
    for (const other of game.buildings) {
      if (other === this || other.state !== State.COMPLETE || !other.boardBox) continue
      const b = other.boardBox
      if (p.x < b[0] || p.x > b[3] || p.z < b[2] || p.z > b[5] || p.y < b[4] - 1e-4) continue
      const d = Math.max(0, p.y - b[4])
      if (d <= far && d < distance) {
        distance = d
        hit = other
      }
    }
    this.adjustBeam(beam, distance)
    // a finished building that is not a platform: the beam may not stand on it
    if (hit && !hit.isResource && !hit.info.standOn) {
      this.blockedBy = hit
      beam.visual.mainMaterial = game.models.mats.beamError
      return -1
    }
    return distance > this.maxBeamLength ? -1 : distance
  }

  private adjustBeam(beam: Beam, height: number): void {
    const h = Math.min(height, this.maxBeamLength)
    beam.length = h
    const show = h > 0.0005
    if (beam.body.enabled !== show) beam.body.enabled = show
    if (show) {
      beam.bodyT.setLocalScale(new vec3(1, h, 1))
      beam.bodyT.setLocalPosition(new vec3(0, -h / 2, 0))
    }
    beam.visual.mainMaterial = height > this.maxBeamLength ? this.game.models.mats.beamError : this.game.models.mats.beam
  }

  /** A finished building whose box this one would cut into (touching is fine). */
  private findOverlap(): Building | null {
    const mine = placedBox(this.localBox, this.position, this.rootT.getLocalRotation(), 0.003)
    for (const b of this.game.buildings) {
      if (b === this || b.isResource || b.state !== State.COMPLETE || !b.boardBox) continue
      if (boxesIntersect(mine, b.boardBox)) return b
    }
    return null
  }

  setDisplayState(ok: boolean, force = false): void {
    if (!force && this.displayState === ok) return
    this.displayState = ok
    this.game.models.setError(this.model, !ok)
  }

  resetToWaiting(): void {
    this.state = State.WAITING
    for (const beam of this.beams) this.adjustBeam(beam, 0)
    this.nameLabel?.set(displayName(this.game.data, this.key), WHITE)
    this.game.cancelAllBadges()
    this.tweenTo(this.initialPos, this.initialRot, 0.5)
  }

  // ScoringIdentifier.CalculateScoring
  calculateScoring(harvest: boolean): number {
    let sum = 0
    const me = this.position
    for (const other of this.game.buildings) {
      if (other === this || !other.canScore) continue
      if (other.position.distance(me) <= this.info.detectDistance) {
        const s = this.info.scoring[other.key] ?? 0
        sum += s
        other.showBadge(s, false)
        if (harvest) {
          other.sendAndAddScore(s)
          if (s > 0 && this.info.consumes?.includes(other.key)) this.game.depleteCloud(other, this)
        }
      } else {
        other.hideBadge()
      }
    }
    // some buildings (wind turbines) also earn for how high they stand above the valley floor
    const alt = this.info.altitude
    if (alt) {
      const a = Math.max(0, Math.floor((me.y - this.game.groundBase) / alt.per)) * alt.points
      sum += a
      if (harvest && a) this.sendAndAddScore(a)
    }
    if (harvest) this.game.progress.add(sum)
    this.showBadge(sum, true)
    return sum
  }

  harvestScore(): void {
    this.calculateScoring(true)
  }

  /** A quick squash-and-stretch when a building lands. */
  private pop(): void {
    this.game.addTween({
      duration: 0.35,
      update: (t) => {
        const s = 1 + 0.18 * Math.sin(Math.PI * t) * (1 - t)
        this.rootT.setLocalScale(new vec3(s, s, s))
      },
      done: () => this.rootT.setLocalScale(vec3.one()),
    })
  }

  showBadge(score: number, active: boolean): void {
    if (score === 0) return this.hideBadge()
    this.badge.set(
      `${score > 0 ? "+" : ""}${score}`,
      active ? rgba("#1b1b1b") : score > 0 ? rgba("#9dff9d") : rgba("#ff8080"),
      active ? rgba("#ffc400", 0.95) : rgba("#23283c", 0.85),
    )
    this.badge.visible = true
  }

  hideBadge(): void {
    this.badge.visible = false
  }

  /** A "+N" flies from the building to the budget sign, then the money arrives. */
  sendAndAddScore(score: number): void {
    this.hideBadge()
    if (score === 0) return
    this.game.flyScore(this, score)
  }

  /** World position just above the building (for the flying score). */
  topWorldPosition(): vec3 {
    return this.rootT.getWorldTransform().multiplyPoint(new vec3(0, this.top + 0.03, 0))
  }

  tweenTo(pos: vec3, rot: quat, duration: number): void {
    const fromP = this.position
    const fromQ = this.rootT.getLocalRotation()
    this.tween = this.game.addTween({
      duration,
      update: (t) => {
        const e = 1 - (1 - t) * (1 - t)
        this.rootT.setLocalPosition(vec3.lerp(fromP, pos, e))
        this.rootT.setLocalRotation(quat.slerp(fromQ, rot, e))
      },
      done: () => {
        this.tween = null
      },
    })
  }

  cancelTween(): void {
    if (this.tween) this.tween.cancelled = true
    this.tween = null
  }

  /** Model scale / bob helpers for clouds. */
  get modelT(): Transform {
    return this.model.getTransform()
  }

  dispose(): void {
    this.onHoverEnd()
    this.nameLabel?.destroy()
    this.badge.destroy()
    this.root.destroy()
  }
}
