// MarsGame — the game rules around the buildings. Port of `Game`, `MoneyManager` and
// `HandManager` in webxr/src/game.js (Unity: MoneyManager.cs, HandManager.cs).
// Owns: the budget, the hand, the list of buildings and resource nodes, ice clouds (used up by
// Weather Stations, re-forming after 3 builds), tweens, the dust ring, gas puffs, tooltips and
// flying scores. Pushes state to a GameView (implemented by MarsMain over the UI modules).
// Must not: create panels or buttons (MarsSignUI / MarsChoiceUI do).
// Size reason: deliberately large, the port of Game + MoneyManager + HandManager kept together so it diffs against webxr/src/game.js.

import {Building, CM_PER_UNIT, State} from "./MarsBuilding"
import {GameData, HandPreset, Heightfield, displayName} from "./MarsData"
import {ModelLibrary} from "./MarsModels"
import {GasPuffs} from "./MarsMeshes"
import {buildTerrainMesh} from "./MarsTerrain"
import {ChoiceState, Progress} from "./MarsProgress"
import {WorldLabel, rgba} from "./MarsLabelsUI"
import {ScoreCard} from "./MarsScoreCardUI"

export interface Tween {
  duration: number
  update: (t: number) => void
  done?: () => void
  elapsed?: number
  cancelled?: boolean
  /** cleans up transient objects when the game restarts mid-tween */
  dispose?: () => void
}

export type Sfx = "build" | "fail" | "coin" | "milestone" | "cloud"

/** What the game shows outside the board (implemented by MarsMain over the UI Kit modules). */
export interface GameView {
  setBudget(amount: number): void
  setScore(score: number, untilText: string): void
  setMessage(text: string | null, kind: "info" | "over"): void
  showChoice(state: ChoiceState | null): void
  /** world position the flying scores travel to (the budget sign) */
  budgetWorldPosition(): vec3
  sfx(name: Sfx): void
}

export interface SharedMeshes {
  beam: RenderMesh
  sphere: RenderMesh
  ring: RenderMesh
}

export class MoneyManager {
  amount: number

  constructor(private game: Game, amount: number) {
    this.amount = amount
  }

  has(n: number): boolean {
    return this.amount >= n
  }

  spend(n: number): boolean {
    if (!this.has(n)) return false
    this.amount -= n
    this.updateUI()
    return true
  }

  gain(n: number): void {
    this.amount += n
    this.updateUI()
  }

  updateUI(): void {
    this.game.view.setBudget(this.amount)
    if (this.amount < 0) this.game.endGame()
  }
}

export class HandManager {
  preset: HandPreset | null = null
  built = 0

  constructor(private game: Game) {}

  get total(): number {
    if (!this.preset) return 0
    return Object.keys(this.preset.buildings).reduce((a, k) => a + this.preset!.buildings[k], 0)
  }

  /** Lines up a hand's buildings in the row at the front. */
  deal(preset: HandPreset): void {
    this.preset = preset
    this.built = 0
    this.game.money.gain(preset.freeMoney)
    const spawn = this.game.spawnCenter
    const spacing = this.game.data.buildingSpawn.spacing
    const total = this.total
    let i = 0
    for (const key of Object.keys(preset.buildings)) {
      for (let n = 0; n < preset.buildings[key]; n++) {
        const pos = new vec3(spawn.x + spacing * (i - (total - 1) / 2), spawn.y, spawn.z)
        this.game.addBuilding(new Building(this.game, key, {position: pos}))
        i++
      }
    }
  }

  /** The first hand of a game is random; after that the player picks one of two. */
  dealRandom(): void {
    const pool = this.game.progress.pool()
    this.deal(pool[Math.floor(Math.random() * pool.length)])
  }

  buildOne(): void {
    this.built += 1
    if (this.built < this.total) return
    this.preset = null
    this.game.progress.offerHands()
  }
}

interface Reform {
  cloud: Building
  wait: number
  ghost: SceneObject
  label: WorldLabel
}

export class Game {
  readonly heightfield: Heightfield
  readonly buildings: Building[] = []
  readonly money: MoneyManager
  readonly hand: HandManager
  readonly progress: Progress
  readonly boardTop: number
  /** what "height" is measured from (a building standing on the valley floor is at 0) */
  readonly groundBase: number
  /** hand row: just outside the near (+z) edge, a little above the terrain there */
  readonly spawnCenter: vec3
  readonly signPosition: vec3
  over = false
  time = 0
  debugColliders = false
  private tweens: Tween[] = []
  private clouds: Building[] = []
  private reforms: Reform[] = []
  private gas: GasPuffs | null = null
  private infoCard: ScoreCard
  private nodePanel: WorldLabel
  private tipOwner: Building | null = null
  private grabbing = 0

  /**
   * @param board  scaled board object (CM_PER_UNIT cm per game unit); buildings live under it
   * @param uiRoot unscaled sandbox root (cm); flying scores live under it
   */
  constructor(
    readonly data: GameData,
    readonly models: ModelLibrary,
    readonly meshes: SharedMeshes,
    readonly board: SceneObject,
    readonly uiRoot: SceneObject,
    readonly view: GameView,
  ) {
    this.heightfield = new Heightfield(data.board.heightfield)
    const hf = this.heightfield
    let maxH = 0
    let minH = Infinity
    let nearH = 0 // highest point of the near rows, under the hand row
    hf.h.forEach((h, k) => {
      maxH = Math.max(maxH, h)
      minH = Math.min(minH, h)
      if (Math.floor(k / hf.nx) >= hf.nz - 6) nearH = Math.max(nearH, h)
    })
    this.boardTop = maxH
    this.groundBase = minH + 0.02
    this.spawnCenter = new vec3(0, nearH + 0.08, data.board.depth / 2 + 0.12)
    // budget sign floating over the far edge of the sandbox
    this.signPosition = new vec3(0, maxH + 0.32, -data.board.depth / 2 - 0.02)

    this.infoCard = new ScoreCard(board, CM_PER_UNIT, {material: models.mats.cardBg, lineCm: 0.85, color: rgba("#121e34", 0.96), billboard: true, order: 30}, "InfoCard")
    this.nodePanel = new WorldLabel(board, CM_PER_UNIT, {height: 0.85, fg: rgba("#1b2030"), bg: rgba("#ffffff", 0.92), align: "left", renderOrder: 12}, "NodePanel")

    this.money = new MoneyManager(this, data.startingMoney)
    this.progress = new Progress(this)
    this.hand = new HandManager(this)

    // terrain
    const terrain = models.instance("terrain", board)
    models.forEachVisual(terrain, (v) => {
      // flat-shaded faces and rock bands on the walls, as in WebXR
      if (v.mainMaterial === models.mats.regular.Terrain) v.mesh = buildTerrainMesh(v.mesh)
    })
    // resource nodes, crystal veins and ice clouds
    for (const res of data.board.resources) this.addBuilding(new Building(this, res.type, {resource: res}))
    models.mergeStatic(
      this.buildings.filter((b) => !b.isAir).map((b) => b.model),
      board,
    )
    this.clouds = this.buildings.filter((b) => b.isAir)
    this.clouds.forEach((c, i) => {
      c.home = c.position
      c.phase = i * 1.7
    })
    // gas vents: every puff is one mesh
    const vents = this.buildings.filter((b) => b.resource?.vfx).map((b) => b.position)
    if (vents.length) {
      this.gas = new GasPuffs(vents)
      const o = global.scene.createSceneObject("GasPuffs")
      o.setParent(board)
      const v = o.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      v.mesh = this.gas.mesh
      v.mainMaterial = models.mats.gas
    }
  }

  /**
   * @param atMilestone debug: start at the first score milestone (a pack unlocks, its card
   * shows, then the hand choice) instead of dealing a random first hand
   */
  start(atMilestone = false, firstHand = ""): void {
    this.money.updateUI()
    this.progress.reset()
    const all = [...this.data.handPresets, ...this.data.packs.flatMap((p) => p.presets)]
    const preset = firstHand ? all.find((p) => p.name === firstHand) : undefined
    if (atMilestone) {
      this.progress.add(this.progress.nextAt)
      this.progress.offerHands()
    } else if (preset) this.hand.deal(preset)
    else this.hand.dealRandom()
  }

  /** Budget below 0: the game is lost. Waiting buildings can no longer be picked up. */
  endGame(): void {
    if (this.over) return
    this.over = true
    this.sfx("fail")
    this.progress.gameOver()
  }

  restart(): void {
    for (const b of [...this.buildings]) {
      if (!b.isResource) {
        b.dispose()
        this.buildings.splice(this.buildings.indexOf(b), 1)
      }
    }
    for (const t of this.tweens) t.dispose?.()
    this.tweens.length = 0
    this.grabbing = 0
    this.hideTip(null)
    this.over = false
    this.money.amount = this.data.startingMoney
    this.money.updateUI()
    for (const r of this.reforms) this.removeGhost(r)
    this.reforms.length = 0
    for (const c of this.clouds) {
      c.rootT.setLocalPosition(c.home!)
      c.modelT.setLocalRotation(quat.quatIdentity())
      c.modelT.setLocalScale(vec3.one())
      c.model.enabled = true
      c.depleted = false
      c.canScore = true
    }
    this.progress.reset()
    this.cancelAllBadges()
    this.hand.dealRandom()
  }

  addBuilding(b: Building): void {
    this.buildings.push(b)
  }

  cancelAllBadges(): void {
    for (const b of this.buildings) b.hideBadge()
  }

  sfx(name: Sfx): void {
    this.view.sfx(name)
  }

  // --- grabbing (counts only; the hand row stays put while carrying) ---------
  onGrabStart(_b: Building): void {
    this.grabbing++
    this.hideTip(null)
  }

  onGrabEnd(_b: Building): void {
    this.grabbing = Math.max(0, this.grabbing - 1)
  }

  // --- tooltips ----------------------------------------------------------------
  /** A waiting hand building: what it likes (left, green) and dislikes (right, red). */
  showBuildingTip(b: Building): void {
    if (this.grabbing) return
    this.hideTip(null)
    const card = this.infoCard
    card.setBlocks(this.progress.scoreCard(b.key))
    // bottom edge just above the name label, so the card grows upwards
    card.setLocalPosition(b.position.add(new vec3(0, b.top + 0.04 + card.h / 2 / CM_PER_UNIT, 0)))
    card.visible = true
    this.tipOwner = b
  }

  /** A finished building: just its name. */
  showFinishedTip(b: Building): void {
    if (this.grabbing) return
    this.showTip(this.nodePanel, b, `#${displayName(this.data, b.key)}`, b.top + 0.02)
  }

  /** A resource node: what it is and which buildings earn next to it. */
  showNodeTip(b: Building): void {
    if (this.grabbing) return
    const info = this.data.buildingInfo
    const pool = new Set<string>()
    for (const p of this.progress.pool()) for (const k of Object.keys(p.buildings)) pool.add(k)
    const lines = [`#${b.info.displayName}`]
    if (b.info.about) lines.push(b.info.about)
    const users = Object.keys(info)
      .filter((k) => (info[k].scoring?.[b.key] ?? 0) > 0)
      .sort((x, y) => info[y].scoring[b.key] - info[x].scoring[b.key])
    if (users.length) lines.push("#Build next to it:")
    for (const k of users) {
      const used = info[k].consumes?.includes(b.key) ? ", uses it up" : ""
      const locked = pool.has(k) ? "" : " (not unlocked yet)"
      lines.push(`  ${displayName(this.data, k)} +${info[k].scoring[b.key]}${used}${locked}`)
    }
    this.showTip(this.nodePanel, b, lines.join("\n"), b.top + 0.02)
  }

  private showTip(panel: WorldLabel, b: Building, text: string, bottom: number): void {
    this.hideTip(null)
    panel.set(text)
    // bottom edge just above the object, so the panel grows upwards
    const half = (panel.lineCount * 0.85 + 0.4) / 2 / CM_PER_UNIT
    panel.setLocalPosition(b.position.add(new vec3(0, bottom + half, 0)))
    panel.visible = true
    panel.centerBlock()
    this.tipOwner = b
  }

  /** Hides the tooltip (only if it belongs to `b`, or always when b is null). */
  hideTip(b: Building | null): void {
    if (b && this.tipOwner !== b) return
    this.infoCard.visible = false
    this.nodePanel.visible = false
    this.tipOwner = null
  }

  // --- flying scores -------------------------------------------------------------
  flyScore(from: Building, score: number): void {
    const fly = new WorldLabel(this.uiRoot, 1, {height: 1.6, bold: true, fg: rgba("#1b1b1b"), bg: rgba("#ffc400", 0.95), depthTest: false, renderOrder: 20}, "FlyScore")
    fly.set(`${score > 0 ? "+" : ""}${score}`)
    fly.visible = true
    const t = fly.object.getTransform()
    const start = from.topWorldPosition()
    t.setWorldPosition(start)
    this.addTween({
      duration: 1,
      update: (k) => {
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
        t.setWorldPosition(vec3.lerp(start, this.view.budgetWorldPosition(), e))
      },
      done: () => {
        fly.destroy()
        this.money.gain(score)
        this.sfx("coin")
      },
      dispose: () => fly.destroy(),
    })
  }

  // --- ice clouds ------------------------------------------------------------------
  /**
   * A Weather Station took this cloud: it is pulled into the station and vanishes. A faint
   * outline shows where it will form again, with a countdown of buildings.
   */
  depleteCloud(c: Building, by: Building): void {
    if (c.depleted) return
    c.depleted = true
    c.canScore = false
    c.hideBadge()
    c.syncTargets()
    const from = c.position
    const to = by.position.add(new vec3(0, by.top, 0))
    const spot = this.cloudSpot(c)
    const entry = this.cloudGhost(c, spot, 3)
    this.reforms.push(entry)
    this.sfx("cloud")
    this.addTween({
      duration: 1.3,
      update: (t) => {
        const e = t * t
        c.rootT.setLocalPosition(vec3.lerp(from, to, e))
        const s = 1 - 0.97 * e
        c.modelT.setLocalScale(new vec3(s, s, s))
        c.modelT.setLocalRotation(quat.angleAxis(t * 7, vec3.up()))
      },
      done: () => {
        c.model.enabled = false
        c.modelT.setLocalRotation(quat.quatIdentity())
        c.rootT.setLocalPosition(spot)
        if (this.reforms.includes(entry)) entry.ghost.enabled = true
      },
    })
  }

  /** A free spot in the air: above the terrain, away from the other clouds. */
  private cloudSpot(c: Building): vec3 {
    const hf = this.heightfield
    const taken = [
      ...this.clouds.filter((o) => o !== c && !o.depleted).map((o) => o.position),
      ...this.reforms.map((r) => r.ghost.getTransform().getLocalPosition()),
    ]
    let p = new vec3(0, 0.4, 0)
    for (let tries = 0; tries < 40; tries++) {
      p = new vec3(-0.5 + Math.random(), 0.26 + Math.random() * 0.3, -0.45 + Math.random() * 0.83)
      if (p.y > hf.at(p.x, p.z) + 0.12 && taken.every((q) => q.distance(p) > 0.2)) break
    }
    return p
  }

  /** A see-through copy of the cloud and a "forms here in N builds" sign. */
  private cloudGhost(c: Building, spot: vec3, wait: number): Reform {
    const g = global.scene.createSceneObject("CloudGhost")
    g.setParent(this.board)
    g.getTransform().setLocalPosition(spot)
    const model = this.models.instance(c.modelName, g)
    this.models.setAllMaterials(model, this.models.mats.ghost)
    const label = new WorldLabel(g, CM_PER_UNIT, {height: 1.1, fg: rgba("#cfe9ff"), bg: rgba("#101422", 0.85)}, "GhostLabel")
    label.setLocalPosition(new vec3(0, 0.045, 0))
    label.visible = true
    g.enabled = false
    const entry: Reform = {cloud: c, wait, ghost: g, label}
    this.setGhostText(entry)
    return entry
  }

  private setGhostText(r: Reform): void {
    r.label.set(`Cloud forms here in ${r.wait} build${r.wait > 1 ? "s" : ""}`)
  }

  private removeGhost(r: Reform): void {
    r.label.destroy()
    r.ghost.destroy()
  }

  tickClouds(): void {
    for (let i = this.reforms.length - 1; i >= 0; i--) {
      const r = this.reforms[i]
      if (--r.wait > 0) {
        this.setGhostText(r)
        continue
      }
      const spot = r.ghost.getTransform().getLocalPosition()
      this.removeGhost(r)
      this.reformCloud(r.cloud, spot)
      this.reforms.splice(i, 1)
    }
  }

  private reformCloud(c: Building, spot: vec3): void {
    c.rootT.setLocalPosition(spot)
    c.model.enabled = true
    c.depleted = false
    c.canScore = true
    c.syncTargets()
    this.sfx("cloud")
    this.addTween({
      duration: 1.2,
      update: (t) => {
        const s = 0.01 + 0.99 * (1 - (1 - t) * (1 - t))
        c.modelT.setLocalScale(new vec3(s, s, s))
      },
    })
  }

  // --- effects ------------------------------------------------------------------------
  /** A dust ring where a building lands. */
  puff(pos: vec3): void {
    const o = global.scene.createSceneObject("Dust")
    o.setParent(this.board)
    const t = o.getTransform()
    t.setLocalPosition(pos.add(new vec3(0, -0.02, 0)))
    const v = o.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    v.mesh = this.meshes.ring
    const mat = this.models.mats.dust.clone()
    v.mainMaterial = mat
    const base = mat.mainPass.baseColorFactor as vec4
    this.addTween({
      duration: 0.5,
      update: (k) => {
        const s = 0.03 + 0.07 * k
        t.setLocalScale(new vec3(s, s, s))
        mat.mainPass.baseColorFactor = new vec4(base.x, base.y, base.z, 0.7 * (1 - k))
      },
      done: () => o.destroy(),
      dispose: () => o.destroy(),
    })
  }

  addTween(t: Tween): Tween {
    t.elapsed = 0
    this.tweens.push(t)
    return t
  }

  update(dt: number): void {
    this.time += dt
    for (const c of this.clouds) {
      if (!c.depleted) c.modelT.setLocalPosition(new vec3(0, Math.sin(this.time * 0.8 + c.phase) * 0.005, 0))
    }
    for (const b of this.buildings) {
      b.update()
      b.syncTargets()
    }
    this.progress.update()
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const t = this.tweens[i]
      if (t.cancelled) {
        this.tweens.splice(i, 1)
        continue
      }
      t.elapsed! += dt
      const k = Math.min(t.elapsed! / t.duration, 1)
      t.update(k)
      if (k >= 1) {
        const j = this.tweens.indexOf(t)
        if (j >= 0) this.tweens.splice(j, 1)
        t.done?.()
      }
    }
    this.gas?.update(this.time)
  }

  /** Buildings that are still waiting in the hand (for tests and the README). */
  get handBuildings(): Building[] {
    return this.buildings.filter((b) => !b.isResource && b.state !== State.COMPLETE)
  }
}
