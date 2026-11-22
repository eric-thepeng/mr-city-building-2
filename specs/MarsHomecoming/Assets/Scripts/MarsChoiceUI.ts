// MarsChoiceUI — the choice panel that stands in the hand row when a hand is used up (UI Kit
// Frame): a title, two hand cards (UI Kit Buttons: pinch, poke or point at one to deal it) with
// small copies of their buildings turning on top, or a new pack's green card with a Continue
// button. Port of the choice panel in Progress (webxr/src/game.js).
// Public API: show(state), hide(), setModelMaker(fn); events onPickHand(index), onContinue.
// Must not: decide which hands are offered (MarsProgress does).

import Event from "InteractionKit.lspkg/Utils/Event"
import {
  addButton,
  contentHost,
  dynamicText,
  flexChild,
  flexColumn,
  flexRow,
  makeCardRect,
  makeFixedFrame,
  obj,
  Button,
  FlexAlign,
  FlexJustify,
  Frame,
} from "./UIKitHelpers"

export interface ChoiceCardView {
  text: string
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
const GOLD = new vec4(1, 0.77, 0, 1)
/** Frame border around the content, in cm (UI Kit's default of 4 is a lot of empty panel here). */
const PANEL_MARGIN = 1.2
/** Frames a replaced card row stays (hidden) before it is destroyed. */
const RETIRE_FRAMES = 10
/** Seconds after new cards appear before a press on them counts. */
const ARM_DELAY = 0.35
const GREEN = new vec4(0.07, 0.44, 0.33, 0.95)

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
  @hint("Width of the new pack's card in cm")
  @widget(new SliderWidget(14, 40, 0.5))
  packCardWidth: number = 19

  @input
  @hint("Height of the turning building models above each card in cm")
  @widget(new SliderWidget(2, 8, 0.25))
  modelHeight: number = 2.4

  @input
  @hint("Turning speed of the models (radians per second)")
  @widget(new SliderWidget(0, 3, 0.1))
  spinSpeed: number = 0.8
  @ui.group_end
  readonly onPickHand = new Event<number>()
  readonly onContinue = new Event<void>()

  private frame: Frame
  private content: SceneObject
  private column: SceneObject | null = null
  private spinners: Transform[] = []
  private retired: {object: SceneObject; frames: number}[] = []
  private armedAt = 0
  private size = new vec2(30, 20)
  private ready = false
  private makeModel: ModelMaker | null = null

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
      this.sweepRetired()
      if (!host.enabled || !this.spinners.length) return
      const q = quat.angleAxis(getDeltaTime() * this.spinSpeed, vec3.up())
      for (const t of this.spinners) t.setLocalRotation(q.multiply(t.getLocalRotation()))
    })
    host.enabled = false
  }

  /**
   * Runs `action` on release, but only for a press that began after this content appeared. New
   * cards open right under the hand that pressed the last button, and must not catch that press.
   */
  private onFreshPress(button: Button, action: () => void): void {
    let fresh = false
    button.onTriggerDown.add(() => (fresh = getTime() >= this.armedAt))
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

  hide(): void {
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
    this.spinners = []
    this.armedAt = getTime() + ARM_DELAY
    const lh = this.lineHeight
    const gap = 0.8
    const modelsH = this.modelHeight + 1
    const cards: {card: ChoiceCardView; pick: number}[] = []
    if (state.notice) cards.push({card: state.notice, pick: -1})
    state.hands.forEach((c, i) => cards.push({card: c, pick: i}))
    const sizes = cards.map(({card, pick}) => {
      const lines = card.text.split("\n").length
      const w = Math.max(pick < 0 ? this.packCardWidth : this.handCardWidth, card.models.length * (this.modelHeight + 1.2))
      return {w, h: lines * lh + 1.6}
    })
    const rowW = sizes.reduce((a, s) => a + s.w, 0) + gap * Math.max(0, sizes.length - 1)
    const rowH = Math.max(...sizes.map((s) => s.h)) + modelsH
    const titleH = 1.6
    const btnH = state.showContinue ? 2.4 : 0
    const w = Math.max(rowW, 14)
    const h = titleH + rowH + btnH + gap * (state.showContinue ? 2 : 1)

    const col = flexColumn(this.content, w, h, {gap, justify: FlexJustify.Center, align: FlexAlign.Center})
    this.column = col
    dynamicText(col, state.title, "Callout", w, titleH, GOLD)

    const row = flexRow(col, rowW, rowH, {gap, justify: FlexJustify.Center, align: FlexAlign.End})
    cards.forEach(({card, pick}, i) => {
      const s = sizes[i]
      flexChild(row, {w: s.w, h: rowH}, (cell) => this.buildCard(cell, card, pick, s.w, s.h, rowH))
    })
    if (state.showContinue) {
      const {button} = addButton(col, "Continue", 9, 2.4, () => {}, {variant: {shape: "Capsule", style: "Primary"}})
      this.onFreshPress(button, () => this.onContinue.invoke())
    }
    this.size = new vec2(w + 2, h + 2)
    if (this.ready) this.frame.innerSize = this.size
    this.getSceneObject().enabled = true
  }

  /** One card: a plate (a Button for hands, a green card for a new pack), its text, and models on top. */
  private buildCard(cell: SceneObject, card: ChoiceCardView, pick: number, w: number, h: number, cellH: number): void {
    const cardY = -cellH / 2 + h / 2
    const plate = obj(cell, pick < 0 ? "PackCard" : `HandCard${pick}`, new vec3(0, cardY, 0))
    if (pick < 0) {
      makeCardRect(plate, w, h, {color: GREEN, cornerRadius: 0.8})
    } else {
      const btn = plate.createComponent(Button.getTypeName()) as Button
      btn.setVariant({theme: "System3", shape: "Rectangle", style: "Primary"})
      btn.size = new vec3(w, h, 1)
      btn.onInitialized.add(() => (btn.size = new vec3(w, h, 1)))
      this.onFreshPress(btn, () => this.onPickHand.invoke(pick))
    }
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

    // small copies of the buildings, standing on the card and turning slowly
    if (!this.makeModel) return
    const n = card.models.length
    const spacing = this.modelHeight + 1.2
    card.models.forEach((key, i) => {
      const holder = obj(cell, `Model-${key}`, new vec3((i - (n - 1) / 2) * spacing, cardY + h / 2 + 0.3, 1.5))
      const m = this.makeModel!(key, holder)
      const b = m.box
      const sizeY = Math.max(b[4] - b[1], 0.001)
      const sizeXZ = Math.max(b[3] - b[0], b[5] - b[2], 0.001)
      const s = Math.min(this.modelHeight / sizeY, (this.modelHeight + 0.5) / sizeXZ)
      const mt = m.object.getTransform()
      mt.setLocalScale(new vec3(s, s, s))
      mt.setLocalPosition(new vec3(0, -b[1] * s, 0)) // stand on the card
      this.spinners.push(holder.getTransform())
    })
  }
}
