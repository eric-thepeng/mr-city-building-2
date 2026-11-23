// MarsChoiceUI — the choice panel that stands in the hand row when a hand is used up (UI Kit
// Frame): a title and two hand cards (UI Kit Buttons: pinch, poke or point at one to deal it)
// with small copies of their buildings, fixed to the panel and seen from a corner, 45 degrees
// above. Pointing at one of them shows what it scores. A new pack gets its own card with a
// Continue button. Port of the choice panel in Progress (webxr/src/game.js).
// Public API: show(state), hide(), setModelMaker(fn), setScoreCards(material, fn);
// events onPickHand(index), onContinue.
// Must not: decide which hands are offered (MarsProgress does).

import {Interactable} from "InteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import Event from "InteractionKit.lspkg/Utils/Event"
import {CardBlock} from "./MarsData"
import {ScoreCard} from "./MarsScoreCardUI"
import {
  addButton,
  contentHost,
  dynamicText,
  flexChild,
  flexColumn,
  flexRow,
  makeFixedFrame,
  obj,
  Button,
  FlexAlign,
  FlexJustify,
  Frame,
} from "./UIKitHelpers"

export interface ChoiceCardView {
  text: string
  /** a formatted card (the new pack's); replaces `text` */
  blocks?: CardBlock[]
  models: string[]
  isNew?: boolean
}

export interface ChoiceView {
  title: string
  notice: ChoiceCardView | null
  hands: ChoiceCardView[]
  showContinue: boolean
}

/** Makes a model of a building under `parent`; box = [minX,minY,minZ,maxX,maxY,maxZ] in its own units. */
export type ModelMaker = (key: string, parent: SceneObject) => {object: SceneObject; box: number[]}

const WHITE = new vec4(1, 1, 1, 1)
const DARK = new vec4(0.106, 0.106, 0.106, 1)
const GOLD = new vec4(1, 0.77, 0, 0.95)
const PACK_CARD = new vec4(0.118, 0.165, 0.275, 0.96)
const TIP_CARD = new vec4(0.07, 0.118, 0.204, 0.96)
/** Frame border around the content, in cm (UI Kit's default of 4 is a lot of empty panel here). */
const PANEL_MARGIN = 1.2
/** Frames a replaced card row stays (hidden) before it is destroyed. */
const RETIRE_FRAMES = 10
/** Seconds after new cards appear before a press on them counts. */
const ARM_DELAY = 0.35
/** ...and frames: after a slow frame the old press can land on a new card past ARM_DELAY. */
const ARM_FRAMES = 12
/** Width of one building's slot on a card, relative to the model height. */
const SLOT_PER_HEIGHT = 1.28
/** The pack's card holds the most text: slightly smaller lines keep the panel in view. */
const PACK_LINE = 0.88
/** Largest model scale (cm per game unit), so small buildings don't get blown up on the card. */
const MAX_MODEL_SCALE = 48

@component
export class MarsChoiceUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">MarsChoiceUI – pick the next hand / new pack card</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Line height of the card text in cm")
  @widget(new SliderWidget(0.6, 2, 0.05))
  lineHeight: number = 0.75

  @input
  @hint("Width of a hand card in cm")
  @widget(new SliderWidget(10, 30, 0.5))
  handCardWidth: number = 10.5

  @input
  @hint("Height of the building models above each card in cm")
  @widget(new SliderWidget(2, 8, 0.25))
  modelHeight: number = 3.6
  @ui.group_end
  readonly onPickHand = new Event<number>()
  readonly onContinue = new Event<void>()

  private frame: Frame
  private content: SceneObject
  private column: SceneObject | null = null
  private retired: {object: SceneObject; frames: number}[] = []
  private armedAt = 0
  private armFrames = 0
  private size = new vec2(30, 20)
  private ready = false
  private makeModel: ModelMaker | null = null
  private cardMaterial: Material | null = null
  private scoreCardFor: ((key: string) => CardBlock[]) | null = null
  private tip: ScoreCard | null = null
  private tipOwner: SceneObject | null = null

  onAwake(): void {
    const host = this.getSceneObject()
    this.frame = makeFixedFrame(host)
    this.content = contentHost(host)
    this.frame.onInitialized.add(() => {
      this.ready = true
      this.frame.margin = PANEL_MARGIN
      this.frame.innerSize = this.size
    })
    this.createEvent("UpdateEvent").bind(() => {
      if (this.armFrames > 0) this.armFrames--
      this.sweepRetired()
    })
    host.enabled = false
  }

  /**
   * Runs `action` on release, but only for a press that began after this content appeared. New
   * cards open right under the hand that pressed the last button, and must not catch that press.
   */
  private onFreshPress(button: Button, action: () => void): void {
    let fresh = false
    button.onTriggerDown.add(() => (fresh = getTime() >= this.armedAt && this.armFrames <= 0))
    button.onTriggerUp.add(() => {
      if (fresh) action()
      fresh = false
    })
  }

  private sweepRetired(): void {
    for (let i = this.retired.length - 1; i >= 0; i--) {
      const r = this.retired[i]
      if (--r.frames > 0) continue
      if (!isNull(r.object)) r.object.destroy()
      this.retired.splice(i, 1)
    }
  }

  /** Outer size of the panel in cm (inner size plus the frame's margin). */
  get panelSize(): vec2 {
    return new vec2(this.size.x + PANEL_MARGIN * 2, this.size.y + PANEL_MARGIN * 2)
  }

  setModelMaker(fn: ModelMaker): void {
    this.makeModel = fn
  }

  /** The card background material, and what a building's hover card says. */
  setScoreCards(material: Material, fn: (key: string) => CardBlock[]): void {
    this.cardMaterial = material
    this.scoreCardFor = fn
  }

  hide(): void {
    this.hideTip(null)
    this.getSceneObject().enabled = false
  }

  show(state: ChoiceView): void {
    // show() can run inside a card's own trigger event: hide the old row now and destroy it a
    // few frames later, once Interaction Kit has let go of its buttons.
    if (this.column) {
      this.column.enabled = false
      this.retired.push({object: this.column, frames: RETIRE_FRAMES})
      this.column = null
    }
    this.hideTip(null)
    this.armedAt = getTime() + ARM_DELAY
    this.armFrames = ARM_FRAMES
    this.getSceneObject().enabled = true // text can only be measured while enabled

    const lh = this.lineHeight
    const gap = 0.8
    const slot = this.modelHeight * SLOT_PER_HEIGHT
    const modelsH = this.modelHeight + 1
    const packCard =
      state.notice?.blocks && this.cardMaterial
        ? new ScoreCard(this.content, 1, {material: this.cardMaterial, lineCm: lh * PACK_LINE, color: PACK_CARD, align: "left", order: 6}, "PackCard")
        : null
    if (packCard) {
      packCard.setBlocks(state.notice!.blocks!)
      packCard.visible = true
    }
    const cards: {card: ChoiceCardView; pick: number}[] = []
    if (state.notice) cards.push({card: state.notice, pick: -1})
    state.hands.forEach((c, i) => cards.push({card: c, pick: i}))
    const sizes = cards.map(({card, pick}) => {
      if (pick < 0 && packCard) return {w: Math.max(packCard.w, card.models.length * slot), h: packCard.h}
      return {w: Math.max(this.handCardWidth, card.models.length * slot), h: card.text.split("\n").length * lh + 1.6}
    })
    const rowW = sizes.reduce((a, s) => a + s.w, 0) + gap * Math.max(0, sizes.length - 1)
    const rowH = Math.max(...sizes.map((s) => s.h)) + modelsH
    const titleH = 1.6
    const btnH = state.showContinue ? 2.4 : 0
    const w = Math.max(rowW, 14)
    const h = titleH + rowH + btnH + gap * (state.showContinue ? 2 : 1)

    const col = flexColumn(this.content, w, h, {gap, justify: FlexJustify.Center, align: FlexAlign.Center})
    this.column = col
    const title = dynamicText(col, state.title, "Callout", w, titleH, DARK)
    const tbg = title.backgroundSettings
    tbg.enabled = true
    tbg.cornerRadius = 0.3
    tbg.fill.color = GOLD
    tbg.margins = Rect.create(0.8, 0.8, 0.22, 0.22)

    const row = flexRow(col, rowW, rowH, {gap, justify: FlexJustify.Center, align: FlexAlign.End})
    cards.forEach(({card, pick}, i) => {
      const s = sizes[i]
      flexChild(row, {w: s.w, h: rowH}, (cell) => this.buildCard(cell, card, pick, s.w, s.h, rowH, packCard))
    })
    if (state.showContinue) {
      const {button} = addButton(col, "Continue", 9, 2.4, () => {}, {variant: {shape: "Capsule", style: "Primary"}})
      this.onFreshPress(button, () => this.onContinue.invoke())
    }
    this.size = new vec2(w + 2, h + 2)
    if (this.ready) this.frame.innerSize = this.size
  }

  /** One card: its plate and text (a Button for hands, a score card for a new pack) and models on top. */
  private buildCard(
    cell: SceneObject,
    card: ChoiceCardView,
    pick: number,
    w: number,
    h: number,
    cellH: number,
    packCard: ScoreCard | null,
  ): void {
    const cardY = -cellH / 2 + h / 2
    if (pick < 0 && packCard) {
      packCard.object.setParent(cell)
      packCard.setLocalPosition(new vec3(0, cardY, 0.1))
    } else {
      const plate = obj(cell, `HandCard${pick}`, new vec3(0, cardY, 0))
      const btn = plate.createComponent(Button.getTypeName()) as Button
      // the two hands are equal choices, so they look the same
      btn.setVariant({theme: "System3", shape: "Rectangle", style: "Primary"})
      btn.size = new vec3(w, h, 1)
      btn.onInitialized.add(() => (btn.size = new vec3(w, h, 1)))
      this.onFreshPress(btn, () => this.onPickHand.invoke(pick))
      const textObj = obj(plate, "CardText", new vec3(0, 0, 0.6))
      const t = textObj.createComponent("Component.Text") as Text
      t.enableRichText = true
      t.text = card.text
        .split("\n")
        .map((l) => (l.startsWith("#") ? `<b>${l.slice(1)}</b>` : l))
        .join("\n")
      t.size = (this.lineHeight / 1.25) * 48 * 0.9
      t.textFill.color = WHITE
      t.horizontalAlignment = HorizontalAlignment.Left
      t.verticalAlignment = VerticalAlignment.Center
      t.horizontalOverflow = HorizontalOverflow.Overflow
      t.verticalOverflow = VerticalOverflow.Overflow
      t.layoutRect = Rect.create(-w / 2 + 0.8, w / 2 - 0.8, -h / 2 + 0.5, h / 2 - 0.5)
      t.depthTest = true
    }
    const n = card.models.length
    const slot = this.modelHeight * SLOT_PER_HEIGHT
    card.models.forEach((key, i) => this.addModel(cell, key, (i - (n - 1) / 2) * slot, cardY + h / 2 + 0.35, slot))
  }

  /** A small building fixed to the panel, seen from one corner and 45 degrees above. */
  private addModel(cell: SceneObject, key: string, x: number, y: number, slot: number): void {
    if (!this.makeModel) return
    const holder = obj(cell, `Model-${key}`, new vec3(x, y, 2))
    const turn = obj(holder, "Turn")
    const m = this.makeModel(key, turn)
    const b = m.box
    const c = new vec3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2)
    m.object.getTransform().setLocalPosition(c.uniformScale(-1)) // turn around its own middle

    // fit what the player actually sees, then stand it on the card
    const q = quat.angleAxis(Math.PI / 4, vec3.right()).multiply(quat.angleAxis(Math.PI / 4, vec3.up()))
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (let i = 0; i < 8; i++) {
      const p = q.multiplyVec3(new vec3((i & 1 ? b[3] : b[0]) - c.x, (i & 2 ? b[4] : b[1]) - c.y, (i & 4 ? b[5] : b[2]) - c.z))
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y)
      maxY = Math.max(maxY, p.y)
      minZ = Math.min(minZ, p.z)
      maxZ = Math.max(maxZ, p.z)
    }
    const s = Math.min(MAX_MODEL_SCALE, (slot * 0.92) / Math.max(maxX - minX, 0.001), this.modelHeight / Math.max(maxY - minY, 0.001))
    const t = turn.getTransform()
    t.setLocalRotation(q)
    t.setLocalScale(new vec3(s, s, s))
    t.setLocalPosition(new vec3((-(minX + maxX) / 2) * s, -minY * s, (-(minZ + maxZ) / 2) * s))

    // an invisible box: pointing at it shows what this building scores
    const top = (maxY - minY) * s
    const hit = obj(holder, "ModelHit", new vec3(0, top / 2, 0))
    const collider = hit.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = new vec3(slot * 0.95, top, 3)
    collider.shape = shape
    collider.fitVisual = false
    const interactable = hit.createComponent(Interactable.getTypeName()) as Interactable
    interactable.targetingMode = 3
    interactable.onHoverEnter.add(() => this.showTip(key, holder, top))
    interactable.onHoverExit.add(() => this.hideTip(holder))
  }

  private showTip(key: string, holder: SceneObject, top: number): void {
    if (!this.cardMaterial || !this.scoreCardFor) return
    this.tip ??= new ScoreCard(this.content, 1, {material: this.cardMaterial, lineCm: 0.85, color: TIP_CARD, order: 30}, "CardTip")
    const tip = this.tip
    tip.setBlocks(this.scoreCardFor(key))
    const p = this.content.getTransform().getInvertedWorldTransform().multiplyPoint(holder.getTransform().getWorldPosition())
    // above the building, unless that would leave the panel (Specs has a narrow view): then below it
    const above = p.y + top + 0.3 + tip.h / 2
    const fits = above + tip.h / 2 <= this.size.y / 2 + PANEL_MARGIN
    // and kept inside the panel's width, for the buildings near its edges
    const room = Math.max(0, this.size.x / 2 + PANEL_MARGIN - tip.w / 2)
    const x = Math.max(-room, Math.min(room, p.x))
    tip.setLocalPosition(new vec3(x, fits ? above : p.y - 0.3 - tip.h / 2, p.z + 1))
    tip.visible = true
    this.tipOwner = holder
  }

  /** Hides the tooltip (only if it belongs to `holder`, or always when holder is null). */
  private hideTip(holder: SceneObject | null): void {
    if (holder && this.tipOwner !== holder) return
    if (this.tip) this.tip.visible = false
    this.tipOwner = null
  }
}
