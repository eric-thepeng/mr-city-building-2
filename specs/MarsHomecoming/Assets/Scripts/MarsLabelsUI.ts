// MarsLabelsUI — small world-space text labels (Lens Text with a rounded background), the
// stand-in for the canvas labels in webxr/src/ui.js: building names / costs, score badges,
// the hover tooltips, flying "+N" scores and the cloud countdown.
// Owns: Text components and billboarding of labels (faced to the camera by MarsMain each frame).
// Must not: hold game state. Panels with buttons are UI Kit modules (MarsSignUI, MarsChoiceUI).

/** World height of one text line, in cm, when the label object's world scale is 1 and Text.size = TEXT_SIZE. */
export const LINE_CM = 1.25
const TEXT_SIZE = 48

export function rgba(hex: string, a = 1): vec4 {
  const n = parseInt(hex.replace("#", ""), 16)
  return new vec4(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a)
}

export interface LabelStyle {
  /** world line height in cm */
  height: number
  fg?: vec4
  bg?: vec4
  align?: "center" | "left"
  bold?: boolean
  billboard?: boolean
  depthTest?: boolean
  renderOrder?: number
}

const DEFAULT_BG = new vec4(20 / 255, 24 / 255, 38 / 255, 0.85)
const WHITE = new vec4(1, 1, 1, 1)

export class WorldLabel {
  static billboards: WorldLabel[] = []
  readonly object: SceneObject
  readonly text: Text
  billboard: boolean
  private key = ""
  private fg: vec4
  private bg: vec4
  private bold: boolean

  /**
   * @param parent    the object the label hangs off
   * @param unitScale world size of one local unit of `parent` in cm (labels under the board: 50)
   */
  constructor(parent: SceneObject, unitScale: number, style: LabelStyle, name = "Label") {
    this.object = global.scene.createSceneObject(name)
    this.object.setParent(parent)
    this.object.layer = parent.layer
    const s = style.height / LINE_CM / unitScale
    this.object.getTransform().setLocalScale(new vec3(s, s, s))
    this.text = this.object.createComponent("Component.Text") as Text
    this.text.size = TEXT_SIZE
    this.text.enableRichText = true
    this.text.horizontalAlignment = style.align === "left" ? HorizontalAlignment.Left : HorizontalAlignment.Center
    this.text.verticalAlignment = VerticalAlignment.Center
    this.text.horizontalOverflow = HorizontalOverflow.Overflow
    this.text.verticalOverflow = VerticalOverflow.Overflow
    this.text.depthTest = style.depthTest !== false
    this.text.twoSided = true
    if (style.renderOrder !== undefined) this.text.setRenderOrder(style.renderOrder)
    this.fg = style.fg ?? WHITE
    this.bg = style.bg ?? DEFAULT_BG
    this.bold = !!style.bold
    const bgs = this.text.backgroundSettings
    bgs.enabled = true
    bgs.cornerRadius = 0.25
    const m = Rect.create(0.35, 0.35, 0.2, 0.2) // how far the background extends past the text on each side
    bgs.margins = m
    this.billboard = style.billboard !== false
    if (this.billboard) WorldLabel.billboards.push(this)
    this.object.enabled = false
  }

  /**
   * Shows text. Lines starting with '#' are headings (bold). Repeated calls with the same
   * text and colours do nothing.
   */
  set(text: string, fg?: vec4, bg?: vec4): this {
    const f = fg ?? this.fg
    const b = bg ?? this.bg
    const key = `${text}|${f}|${b}`
    if (key === this.key) return this
    this.key = key
    const lines = text.split("\n").map((l) => {
      const safe = l.replace(/</g, "‹").replace(/>/g, "›")
      if (safe.startsWith("#")) return `<b>${safe.slice(1)}</b>`
      return this.bold ? `<b>${safe}</b>` : safe
    })
    this.text.text = lines.join("\n")
    this.text.textFill.color = f
    this.text.backgroundSettings.fill.color = b
    return this
  }

  get visible(): boolean {
    return this.object.enabled
  }

  set visible(v: boolean) {
    if (this.object.enabled !== v) this.object.enabled = v
  }

  setLocalPosition(p: vec3): void {
    this.object.getTransform().setLocalPosition(p)
  }

  setParent(parent: SceneObject): void {
    if (this.object.getParent() !== parent) this.object.setParent(parent)
  }

  /** Lines of text currently shown (for stacking a tooltip above an object). */
  get lineCount(): number {
    return this.text.text.split("\n").length
  }

  destroy(): void {
    const i = WorldLabel.billboards.indexOf(this)
    if (i >= 0) WorldLabel.billboards.splice(i, 1)
    if (!isNull(this.object)) this.object.destroy()
  }

  /** Gives every visible billboard label the camera's rotation, so text stays level (as in WebXR). */
  static faceCamera(camRot: quat): void {
    for (const l of WorldLabel.billboards) {
      if (!l.object.enabled || !l.object.isEnabledInHierarchy) continue
      l.object.getTransform().setWorldRotation(camRot)
    }
  }
}
