// MarsScoreCardUI — a small info card drawn from a list of blocks: port of `Label.setCard` in
// webxr/src/ui.js. Used for the hover card of a building and for a new pack's card: what a
// building likes is listed on the left in green, what it dislikes on the right in red.
// Text widths are measured, so every line fits inside the card.
// Must not: hold game state (MarsProgress makes the blocks).

import {CardBlock} from "./MarsData"
import {panelMesh, PanelRect} from "./MarsMeshes"
import {rgba, WorldLabel} from "./MarsLabelsUI"

/** Text.size per cm of em height. */
const SIZE_PER_CM = 43.886

const WHITE = rgba("#ffffff")
const GOOD = rgba("#86f5a2")
const BAD = rgba("#ff9c9c")
const MUTED = rgba("#c4cde0")
const ACCENT = rgba("#ffe27a")

/** The glTF material takes linear colours; the card colours are written in sRGB, as in WebXR. */
function toLinear(c: vec4): vec4 {
  const f = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  return new vec4(f(c.x), f(c.y), f(c.z), c.w)
}

export interface ScoreCardOptions {
  /** the card background material (unlit, blended); cloned for this card */
  material: Material
  /** height of one text line in cm */
  lineCm: number
  /** background colour (sRGB) */
  color: vec4
  align?: "center" | "left"
  billboard?: boolean
  /** render order of the background; lines and text draw just above it */
  order: number
}

interface Piece {
  t: Text
  w: number
}

interface Row {
  n: Piece
  v: Piece
}

export class ScoreCard {
  readonly object: SceneObject
  /** size of the card in cm */
  w = 0
  h = 0
  private bg: RenderMeshVisual
  private lines: RenderMeshVisual
  private textRoot: SceneObject
  private texts: Text[] = []
  private used = 0
  private key = ""
  private px: number

  /** @param unitScale world size of one local unit of `parent` in cm (under the board: 50) */
  constructor(
    parent: SceneObject,
    unitScale: number,
    private opts: ScoreCardOptions,
    name = "ScoreCard",
  ) {
    this.px = opts.lineCm / 1.2
    this.object = global.scene.createSceneObject(name)
    this.object.setParent(parent)
    this.object.layer = parent.layer
    const s = 1 / unitScale
    this.object.getTransform().setLocalScale(new vec3(s, s, s))
    const mat = opts.material.clone()
    mat.mainPass.baseColorFactor = toLinear(opts.color)
    this.bg = this.visual("Background", 0, opts.order, mat)
    const lineMat = opts.material.clone()
    lineMat.mainPass.baseColorFactor = new vec4(1, 1, 1, 0.55)
    this.lines = this.visual("Lines", 0.01, opts.order + 1, lineMat)
    this.textRoot = global.scene.createSceneObject("Text")
    this.textRoot.setParent(this.object)
    this.textRoot.layer = parent.layer
    this.textRoot.getTransform().setLocalPosition(new vec3(0, 0, 0.02))
    if (opts.billboard) WorldLabel.billboards.push(this)
    this.object.enabled = false
  }

  private visual(name: string, z: number, order: number, mat: Material): RenderMeshVisual {
    const o = global.scene.createSceneObject(name)
    o.setParent(this.object)
    o.layer = this.object.layer
    o.getTransform().setLocalPosition(new vec3(0, 0, z))
    const v = o.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    v.mainMaterial = mat
    v.setRenderOrder(order)
    return v
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

  destroy(): void {
    const i = WorldLabel.billboards.indexOf(this)
    if (i >= 0) WorldLabel.billboards.splice(i, 1)
    if (!isNull(this.object)) this.object.destroy()
  }

  private take(): Text {
    let t = this.texts[this.used]
    if (!t) {
      const o = global.scene.createSceneObject("CardText")
      o.setParent(this.textRoot)
      o.layer = this.object.layer
      t = o.createComponent("Component.Text") as Text
      t.horizontalOverflow = HorizontalOverflow.Overflow
      t.verticalOverflow = VerticalOverflow.Overflow
      t.verticalAlignment = VerticalAlignment.Center
      t.depthTest = false
      t.setRenderOrder(this.opts.order + 2)
      this.texts.push(t)
    }
    t.getSceneObject().enabled = true
    this.used++
    return t
  }

  /** A line of text at `scale` of the base size, measured. */
  private piece(s: string, scale: number, weight: number, color: vec4): Piece {
    const t = this.take()
    t.text = s
    t.size = this.px * scale * SIZE_PER_CM
    t.weight = weight
    t.textFill.color = color
    let w = 0
    try {
      w = t.getBoundingBox().getSize().x
    } catch {
      w = 0
    }
    // not measurable yet (a hidden object): a safe estimate of this font's average glyph width
    if (!(w > 0)) w = s.length * this.px * scale * 0.6
    return {t, w}
  }

  private place(p: Piece, x0: number, x1: number, cy: number, align: HorizontalAlignment): void {
    const half = this.px
    p.t.horizontalAlignment = align
    p.t.layoutRect = Rect.create(x0, x1, cy - half, cy + half)
  }

  /** Draws the card; `w` and `h` are valid afterwards. Same blocks: nothing to do. */
  setBlocks(blocks: CardBlock[]): this {
    const key = JSON.stringify(blocks)
    if (key === this.key) return this
    this.key = key
    // the text measures reliably only while it is enabled
    const wasVisible = this.object.enabled
    this.object.enabled = true
    this.used = 0
    const px = this.px
    const pad = px * 0.6875
    const rowH = px * 1.28
    const colGap = px * 1.5
    const nameGap = px * 0.8

    // 1. make and measure every line
    const made = blocks.map((b) => {
      if (b.title) return {b, one: this.piece(b.title, 1.25, 800, WHITE)}
      if (b.sub) return {b, one: this.piece(b.sub, 0.85, 500, MUTED)}
      if (b.heading) return {b, one: this.piece(b.heading, 1, 800, ACCENT)}
      if (b.text) return {b, one: this.piece(b.text, 1, 600, WHITE)}
      const rows = (list: [string, string][] | undefined, color: vec4): Row[] =>
        (list ?? []).map(([n, v]) => ({n: this.piece(n, 1, 600, color), v: this.piece(v, 1, 800, color)}))
      return {b, good: rows(b.good, GOOD), bad: rows(b.bad, BAD)}
    })
    for (let i = this.used; i < this.texts.length; i++) this.texts[i].getSceneObject().enabled = false

    // 2. the two-sided tables on a card share one column width, so their dividers line up
    const ownW = (rows: Row[]) => rows.reduce((m, r) => Math.max(m, r.n.w + nameGap + r.v.w), 0)
    const isSplit = (m: (typeof made)[number]) => !!m.good?.length && !!m.bad?.length
    let colW = 0
    for (const m of made) if (isSplit(m)) colW = Math.max(colW, ownW([...m.good!, ...m.bad!]))
    const sideW = (m: (typeof made)[number]) => (isSplit(m) ? colW : ownW([...(m.good ?? []), ...(m.bad ?? [])]))
    const tableW = (m: (typeof made)[number]) => (isSplit(m) ? colW * 2 + colGap : sideW(m))
    const heightOf = (m: (typeof made)[number]) => {
      if (m.b.title) return px * 2.05
      if (m.b.sub) return px * 1.2
      if (m.b.heading) return px * 1.45
      if (m.b.text) return px * 1.25
      return Math.max(m.good!.length, m.bad!.length) * rowH + px * 0.15
    }

    let contentW = 0
    let contentH = 0
    for (const m of made) {
      contentH += heightOf(m)
      contentW = Math.max(contentW, m.one ? m.one.w + (m.b.title ? px * 1.5 : 0) : tableW(m))
    }
    const w = Math.ceil((contentW + pad * 2) * 100) / 100
    const h = Math.ceil((contentH + pad * 1.6) * 100) / 100
    this.w = w
    this.h = h

    // 3. place everything, top to bottom
    const left = this.opts.align === "left"
    const L = -w / 2 + pad
    const R = w / 2 - pad
    const rects: PanelRect[] = []
    let y = h / 2 - pad * 0.8
    for (const m of made) {
      const bh = heightOf(m)
      if (m.one) {
        if (m.b.title) {
          this.place(m.one, L, R, y - px * 0.8, HorizontalAlignment.Center)
          const rule = m.one.w + px * 1.5
          rects.push({x: 0, y: y - px * 1.72, w: rule, h: Math.max(0.03, px * 0.05), r: 0})
        } else {
          const cy = y - (m.b.heading ? bh * 0.55 : bh / 2)
          this.place(m.one, L, R, cy, left ? HorizontalAlignment.Left : HorizontalAlignment.Center)
        }
      } else {
        const tw = tableW(m)
        const x = left ? L : -tw / 2
        const side = sideW(m)
        const column = (rows: Row[], cx: number) =>
          rows.forEach((r, i) => {
            const cy = y - rowH * (i + 0.5)
            this.place(r.n, cx, cx + side, cy, HorizontalAlignment.Left)
            this.place(r.v, cx, cx + side, cy, HorizontalAlignment.Right)
          })
        column(m.good!, x)
        column(m.bad!, isSplit(m) ? x + side + colGap : x)
        if (isSplit(m)) {
          const n = Math.max(m.good!.length, m.bad!.length)
          rects.push({x: x + side + colGap / 2, y: y - (n * rowH) / 2, w: Math.max(0.03, px * 0.05), h: n * rowH - px * 0.2, r: 0})
        }
      }
      y -= bh
    }

    this.bg.mesh = panelMesh([{x: 0, y: 0, w, h, r: px * 0.55}])
    const lineObj = this.lines.getSceneObject()
    lineObj.enabled = rects.length > 0
    if (rects.length) this.lines.mesh = panelMesh(rects)
    this.object.enabled = wasVisible
    return this
  }
}
