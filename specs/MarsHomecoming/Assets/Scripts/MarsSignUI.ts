// MarsSignUI — the budget sign over the far edge of the sandbox (UI Kit Frame): a message line
// (milestones, game over), score, points until the next unlock, the budget, and the
// New game / Recenter buttons. Port of the MoneyManager label + Progress sign labels + the
// in-world buttons in webxr/src/main.js.
// Public API: setBudget, setScore, setMessage, budgetWorldPosition; events onNewGame, onRecenter.
// Must not: hold game state (MarsMain pushes it in).

import Event from "InteractionKit.lspkg/Utils/Event"
import {
  addButton,
  dynamicText,
  flexColumn,
  flexRow,
  contentHost,
  makeFixedFrame,
  FlexAlign,
  FlexJustify,
  Frame,
} from "./UIKitHelpers"

const GOLD = new vec4(1, 0.886, 0.478, 1)
const RED = new vec4(1, 0.42, 0.42, 1)
const SKY = new vec4(0.624, 0.878, 1, 1)
const PALE = new vec4(0.812, 0.914, 1, 1)
const DARK = new vec4(0.106, 0.106, 0.106, 1)

@component
export class MarsSignUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">MarsSignUI – budget sign with New game / Recenter</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Inner width of the sign in cm")
  @widget(new SliderWidget(14, 40, 1))
  width: number = 22

  @input
  @hint("Size of the New game / Recenter buttons in cm (width, height)")
  buttonSize: vec2 = new vec2(9, 3)
  @ui.group_end
  readonly onNewGame = new Event<void>()
  readonly onRecenter = new Event<void>()

  private frame: Frame
  private message: Text
  private score: Text
  private until: Text
  private budget: Text

  onAwake(): void {
    const w = this.width > 0 ? this.width : 22
    const host = this.getSceneObject()
    this.frame = makeFixedFrame(host)
    const content = contentHost(host)
    const col = flexColumn(content, w, 14.6, {gap: 0.6, justify: FlexJustify.Center, align: FlexAlign.Center})
    this.message = dynamicText(col, "", "Callout", w, 2, DARK)
    const bg = this.message.backgroundSettings
    bg.enabled = false
    bg.cornerRadius = 0.3
    bg.margins = Rect.create(-0.6, 0.6, -0.25, 0.25)
    this.score = dynamicText(col, "Score: 0", "Headline1", w, 2.2, SKY)
    this.until = dynamicText(col, "", "Caption", w, 1.4, PALE)
    this.budget = dynamicText(col, "Budget: 100", "Title2", w, 3.2, GOLD)
    const bs = this.buttonSize
    const row = flexRow(col, w, bs.y, {gap: 3, justify: FlexJustify.Center, align: FlexAlign.Center})
    addButton(row, "New game", bs.x, bs.y, () => this.onNewGame.invoke(), {variant: {shape: "Capsule", style: "Primary"}})
    addButton(row, "Recenter", bs.x, bs.y, () => this.onRecenter.invoke(), {variant: {shape: "Capsule", style: "Secondary"}})
    this.frame.onInitialized.add(() => {
      this.frame.innerSize = new vec2(w + 2, 16)
    })
  }

  setBudget(amount: number): void {
    this.budget.text = `Budget: ${amount}`
    this.budget.textFill.color = amount < 0 ? RED : GOLD
  }

  setScore(score: number, untilText: string): void {
    this.score.text = `Score: ${score}`
    this.until.text = untilText
  }

  /** A short message line (milestone in gold, game over in red); null hides it. */
  setMessage(text: string | null, kind: "info" | "over"): void {
    const bg = this.message.backgroundSettings
    if (!text) {
      this.message.text = ""
      bg.enabled = false
      return
    }
    this.message.text = text
    bg.enabled = true
    bg.fill.color = kind === "over" ? new vec4(0.84, 0.23, 0.23, 0.95) : new vec4(1, 0.77, 0, 0.95)
    this.message.textFill.color = kind === "over" ? new vec4(1, 1, 1, 1) : DARK
  }

  /** Where flying scores land. */
  budgetWorldPosition(): vec3 {
    return this.budget.getSceneObject().getTransform().getWorldPosition()
  }
}
