// World-space text labels drawn on canvases (stand-ins for the Unity TextMeshPro UI).
import * as THREE from 'three';

const PLANE = new THREE.PlaneGeometry(1, 1);
const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif';
// One scratch canvas for every label. A label draws into it and is uploaded to its
// own GPU texture right away, so labels keep no canvas or 2D context of their own
// (one canvas instead of ~50 on a full board).
let scratch = null;
let scratchCtx = null;

export class Label {
  /** Canvas pixels per text pixel. Lowered on memory-tight devices (Specs). */
  static resolution = 1.5;
  /** Set by main.js. Labels upload through it; without it each label keeps its own canvas. */
  static renderer = null;
  static all = new Set();
  /** True on the landing page, where the board is shown without any signs. */
  static hidden = false;

  static setHidden(hidden) {
    Label.hidden = hidden;
    for (const l of Label.all) l.mesh.visible = l.wanted && !!l.texture && !hidden;
  }

  /**
   * Labels are lazy: no GPU texture exists until set() is first called.
   * @param {object} opts
   * @param {number} opts.height   world height of one text line in metres
   * @param {string} opts.bg       CSS background colour
   * @param {string} opts.fg       CSS text colour
   * @param {boolean} opts.billboard  face the camera every frame
   * @param {'center'|'left'} opts.align  text alignment
   * @param {string} opts.accent  heading colour: a line starting with '#' is drawn bold in it
   */
  constructor({ height = 0.02, bg = 'rgba(20,24,38,0.85)', fg = '#fff', font = 600, billboard = true, depthTest = true, renderOrder = 10, align = 'center', accent = null } = {}) {
    this.height = height;
    this.align = align;
    this.accent = accent;
    this.bg = bg;
    this.fg = fg;
    this.font = font;
    this.canvas = null; // only used when there is no renderer to upload through
    this.texture = null;
    this.texW = 0; // allocated texture size in pixels
    this.texH = 0;
    const mat = new THREE.MeshBasicMaterial({ transparent: true, depthTest, depthWrite: false, toneMapped: false });
    this.mesh = new THREE.Mesh(PLANE, mat);
    this.mesh.renderOrder = renderOrder;
    this.mesh.userData.billboard = billboard;
    this.mesh.raycast = () => {};
    this.mesh.visible = false;
    this.wanted = true;
    this.text = null;
    this.w = 0; // world size of the drawn label, before any hover / press scaling
    this.h = 0;
    this.popScale = 1;
    Label.all.add(this);
  }

  set(text, { fg, bg } = {}) {
    fg = fg ?? this.fg;
    bg = bg ?? this.bg;
    const key = `${text}|${fg}|${bg}`;
    if (key === this.text) return this;
    this.text = key;
    const { canvas, ctx } = this._surface();
    const DPR = Label.resolution;
    const px = Math.round(32 * DPR);
    const font = `${this.font} ${px}px ${FONT}`;
    const headFont = `800 ${px}px ${FONT}`;
    const lines = String(text).split('\n').map((l) => (l.startsWith('#') && this.accent
      ? { text: l.slice(1), font: headFont, fg: this.accent }
      : { text: l, font, fg: null }));
    const pad = 16 * DPR;
    const lineH = px * 1.2;
    let textW = 0;
    for (const l of lines) {
      ctx.font = l.font;
      textW = Math.max(textW, ctx.measureText(l.text).width);
    }
    const w = Math.ceil(textW + pad * 2);
    const h = Math.ceil(lineH * lines.length + pad * 1.2);
    const left = this.align === 'left';
    this._present(canvas, ctx, w, h, lineH, bg, () => {
      ctx.textAlign = left ? 'left' : 'center';
      ctx.textBaseline = 'middle';
      lines.forEach((l, i) => {
        ctx.font = l.font;
        ctx.fillStyle = l.fg ?? fg;
        ctx.fillText(l.text, left ? pad : w / 2, pad * 0.6 + lineH * (i + 0.5));
      });
    });
    return this;
  }

  /**
   * A small info card, drawn from a list of blocks, top to bottom:
   *   { title }            big, centred, with a line under it
   *   { sub }              small and muted
   *   { heading }          bold, in the accent colour
   *   { text }             a plain line
   *   { good, bad }        a table of [name, value] rows: good on the left in green, bad on the right in red
   */
  setCard(blocks, { bg } = {}) {
    bg = bg ?? this.bg;
    const key = `card|${JSON.stringify(blocks)}|${bg}`;
    if (key === this.text) return this;
    this.text = key;
    const { canvas, ctx } = this._surface();
    const DPR = Label.resolution;
    const px = Math.round(32 * DPR);
    const pad = 22 * DPR;
    const lineH = px * 1.2;
    const fonts = {
      title: `800 ${Math.round(px * 1.25)}px ${FONT}`,
      heading: `800 ${px}px ${FONT}`,
      sub: `500 ${Math.round(px * 0.85)}px ${FONT}`,
      text: `600 ${px}px ${FONT}`,
      value: `800 ${px}px ${FONT}`,
    };
    const widthOf = (font, s) => { ctx.font = font; return ctx.measureText(s).width; };
    const rowH = px * 1.28;
    const colGap = px * 1.5;
    const ownW = (b) => [...b.good, ...b.bad].reduce(
      (m, [n, v]) => Math.max(m, widthOf(fonts.text, n) + px * 0.8 + widthOf(fonts.value, v)), 0);
    const split = (b) => b.good?.length > 0 && b.bad?.length > 0;
    // the two-sided tables on a card share one column width, so their dividers line up
    let colW = 0;
    for (const b of blocks) if (split(b)) colW = Math.max(colW, ownW(b));
    const sideW = (b) => (split(b) ? colW : ownW(b));
    const tableW = (b) => (split(b) ? colW * 2 + colGap : ownW(b));
    const rows = (b) => Math.max(b.good.length, b.bad.length);
    const heightOf = (b) => {
      if (b.title) return px * 2.05;
      if (b.sub) return px * 1.2;
      if (b.heading) return px * 1.45;
      if (b.text) return px * 1.25;
      return rows(b) * rowH + px * 0.15;
    };
    let contentW = 0;
    let contentH = 0;
    for (const b of blocks) {
      contentH += heightOf(b);
      contentW = Math.max(contentW, b.title ? widthOf(fonts.title, b.title) + px * 1.5
        : b.sub ? widthOf(fonts.sub, b.sub)
          : b.heading ? widthOf(fonts.heading, b.heading)
            : b.text ? widthOf(fonts.text, b.text) : tableW(b));
    }
    const w = Math.ceil(contentW + pad * 2);
    const h = Math.ceil(contentH + pad * 1.6);
    const left = this.align === 'left';
    const startX = (width) => (left ? pad : (w - width) / 2);
    const column = (list, x, y, width, color) => {
      list.forEach(([n, v], i) => {
        const cy = y + rowH * (i + 0.5);
        ctx.fillStyle = color;
        ctx.font = fonts.text;
        ctx.textAlign = 'left';
        ctx.fillText(n, x, cy);
        ctx.font = fonts.value;
        ctx.textAlign = 'right';
        ctx.fillText(v, x + width, cy);
      });
    };
    this._present(canvas, ctx, w, h, lineH, bg, () => {
      ctx.textBaseline = 'middle';
      let y = pad * 0.8;
      for (const b of blocks) {
        const bh = heightOf(b);
        ctx.textAlign = left ? 'left' : 'center';
        const tx = left ? pad : w / 2;
        if (b.title) {
          ctx.textAlign = 'center';
          ctx.font = fonts.title;
          ctx.fillStyle = '#ffffff';
          ctx.fillText(b.title, w / 2, y + px * 0.8);
          const rule = widthOf(fonts.title, b.title) + px * 1.5;
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.fillRect((w - rule) / 2, y + px * 1.68, rule, Math.max(2, 2 * DPR));
        } else if (b.sub) {
          ctx.font = fonts.sub;
          ctx.fillStyle = '#c4cde0';
          ctx.fillText(b.sub, tx, y + bh / 2);
        } else if (b.heading) {
          ctx.font = fonts.heading;
          ctx.fillStyle = this.accent ?? '#ffe27a';
          ctx.fillText(b.heading, tx, y + bh * 0.55);
        } else if (b.text) {
          ctx.font = fonts.text;
          ctx.fillStyle = '#ffffff';
          ctx.fillText(b.text, tx, y + bh / 2);
        } else {
          const x = startX(tableW(b));
          const side = sideW(b);
          if (b.good.length) column(b.good, x, y, side, '#86f5a2');
          if (b.bad.length) column(b.bad, split(b) ? x + side + colGap : x, y, side, '#ff9c9c');
          if (split(b)) {
            ctx.fillStyle = 'rgba(255,255,255,0.45)';
            ctx.fillRect(x + side + colGap / 2 - DPR, y + px * 0.1, Math.max(2, 2 * DPR), rows(b) * rowH - px * 0.2);
          }
        }
        y += bh;
      }
    });
    return this;
  }

  /** The canvas and 2D context to draw into. */
  _surface() {
    if (Label.renderer) {
      scratch ??= document.createElement('canvas');
      scratchCtx ??= scratch.getContext('2d');
      return { canvas: scratch, ctx: scratchCtx };
    }
    this.canvas ??= document.createElement('canvas');
    return { canvas: this.canvas, ctx: this.canvas.getContext('2d') };
  }

  /** Clears to a rounded background, runs `paint`, uploads the result and sizes the mesh. */
  _present(canvas, ctx, w, h, lineH, bg, paint) {
    const DPR = Label.resolution;
    // Reuse the GPU texture when the new text fits (a cost label changes many
    // times a second while carrying a building). Only grow when needed.
    const grow = !this.texture || w > this.texW || h > this.texH;
    if (grow) {
      this.texW = Math.max(w, this.texW);
      this.texH = Math.max(h, this.texH);
    }
    const cw = this.texW;
    const ch = this.texH;
    // the uploaded image must match the texture's allocated size exactly
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = bg;
    roundRect(ctx, 0, 0, w, h, 14 * DPR);
    ctx.fill();
    paint();
    if (grow) {
      this.texture?.dispose();
      this.texture = new THREE.Texture(canvas);
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.texture.generateMipmaps = false; // a third less memory; labels are viewed up close
      this.texture.minFilter = THREE.LinearFilter;
      this.mesh.material.map = this.texture;
      this.mesh.material.needsUpdate = true;
    }
    this.texture.image = canvas;
    this.texture.needsUpdate = true;
    // upload now, before another label redraws the scratch canvas
    if (Label.renderer) Label.renderer.initTexture(this.texture);
    // show only the drawn w x h corner of the texture (top-left; textures are flipped in Y)
    this.texture.repeat.set(w / cw, h / ch);
    this.texture.offset.set(0, 1 - h / ch);
    const worldH = this.height * (h / lineH);
    this.w = worldH * (w / h);
    this.h = worldH;
    this.mesh.scale.set(this.w * this.popScale, this.h * this.popScale, 1);
    this.mesh.visible = this.wanted && !Label.hidden;
  }

  /** Hover / press feedback on a button: scales the label without changing its layout size. */
  setPop(k) {
    this.popScale = k;
    this.mesh.scale.set(this.w * k, this.h * k, 1);
  }

  /** Shows the label once it has text; until then it stays hidden. */
  set visible(v) {
    this.wanted = v;
    this.mesh.visible = v && !!this.texture && !Label.hidden;
  }

  get visible() { return this.mesh.visible; }

  dispose() {
    Label.all.delete(this);
    this.texture?.dispose();
    this.texture = null;
    this.canvas = null;
    this.mesh.material.dispose();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Rotate every billboard label under `root` to face the camera. */
const camQ = new THREE.Quaternion();
const parentQ = new THREE.Quaternion();
const faceCamera = (o) => {
  if (!o.userData.billboard) return;
  o.parent.getWorldQuaternion(parentQ);
  o.quaternion.copy(parentQ.invert().multiply(camQ));
};

export function updateBillboards(root, camera) {
  camera.getWorldQuaternion(camQ);
  root.traverseVisible(faceCamera);
}
