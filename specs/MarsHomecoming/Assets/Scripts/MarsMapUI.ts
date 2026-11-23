// MarsMapUI — the panel shown before a game starts: pick the Mars map or the real space, then
// the prompts of the room scan (UI Kit Frame, a title, a body and up to two buttons).
// Public API: show(title, body, first?, second?), setBody, setFirstEnabled, hide; events onFirst, onSecond.
// Must not: run the scan or decide the steps (MarsMapFlow does).

import Event from "InteractionKit.lspkg/Utils/Event"
import {FlexItem} from "UIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {FlexLayout} from "UIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {addButton, contentHost, dynamicText, flexColumn, flexRow, makeFixedFrame, Button, FlexAlign, FlexJustify, Frame} from "./UIKitHelpers"

const WIDTH = 24
const BUTTON_WIDTH = 11
const BUTTON_GAP = 2
const GOLD = new vec4(1, 0.886, 0.478, 1)
const PALE = new vec4(0.812, 0.914, 1, 1)
/** Seconds after a step appears before its buttons count: they stay under the hand that pressed the last one. */
const ARM_DELAY = 0.35

export class MapPanel {
  readonly object: SceneObject
  readonly onFirst = new Event<void>()
  readonly onSecond = new Event<void>()

  private frame: Frame
  private title: Text
  private body: Text
  private row: SceneObject
  private first: Button
  private second: Button
  private firstLabel: {text: string}
  private secondLabel: {text: string}
  private armedAt = 0

  constructor(parent: SceneObject) {
    const host = global.scene.createSceneObject("MapPanel")
    host.setParent(parent)
    host.layer = parent.layer
    this.object = host
    this.frame = makeFixedFrame(host)
    const content = contentHost(host)
    const col = flexColumn(content, WIDTH, 12, {gap: 0.7, justify: FlexJustify.Center, align: FlexAlign.Center})
    this.title = dynamicText(col, "", "Headline1", WIDTH, 2.4, GOLD)
    this.body = dynamicText(col, "", "Callout", WIDTH, 4.6, PALE)
    this.row = flexRow(col, WIDTH, 3.2, {gap: BUTTON_GAP, justify: FlexJustify.Center, align: FlexAlign.Center})
    // the two choices are equal, so both buttons have the same style
    const a = addButton(this.row, "First", BUTTON_WIDTH, 3.2, () => this.press(this.onFirst), {variant: {shape: "Capsule", style: "Primary"}})
    const b = addButton(this.row, "Second", BUTTON_WIDTH, 3.2, () => this.press(this.onSecond), {variant: {shape: "Capsule", style: "Primary"}})
    this.first = a.button
    this.second = b.button
    this.firstLabel = a.content
    this.secondLabel = b.content
    this.frame.onInitialized.add(() => {
      this.frame.margin = 1.2
      this.frame.innerSize = new vec2(WIDTH + 2, 13)
    })
  }

  private press(event: Event<void>): void {
    if (getTime() >= this.armedAt) event.invoke()
  }

  /** A step of the flow; without button names the button row is hidden. */
  show(title: string, body: string, first?: string, second?: string): void {
    this.object.enabled = true
    this.armedAt = getTime() + ARM_DELAY
    this.title.text = title
    this.body.text = body
    this.row.enabled = !!first
    this.first.getSceneObject().enabled = !!first
    const secondObject = this.second.getSceneObject()
    secondObject.enabled = !!second
    // a disabled item still takes up its place in the row: collapse it, so one button is centred
    ;(secondObject.getComponent(FlexItem.getTypeName()) as FlexItem).overrideWidth = second ? BUTTON_WIDTH : 0.01
    const flex = this.row.getComponent(FlexLayout.getTypeName()) as FlexLayout
    flex.columnGap = second ? BUTTON_GAP : 0
    flex.markDirty()
    if (first) this.firstLabel.text = first
    if (second) this.secondLabel.text = second
    this.first.inactive = false
  }

  setBody(body: string): void {
    if (this.body.text !== body) this.body.text = body
  }

  setFirstEnabled(on: boolean): void {
    if (this.first.inactive === on) this.first.inactive = !on
  }

  hide(): void {
    this.object.enabled = false
  }
}
