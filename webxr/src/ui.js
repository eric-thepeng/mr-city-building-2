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
    Label.all.add(this);
  }

  set(text, { fg, bg } = {}) {
    fg = fg ?? this.fg;
    bg = bg ?? this.bg;
    const key = `${text}|${fg}|${bg}`;
    if (key === this.text) return this;
    this.text = key;
    const shared = !!Label.renderer;
    let canvas;
    let ctx;
    if (shared) {
      scratch ??= document.createElement('canvas');
      scratchCtx ??= scratch.getContext('2d');
      canvas = scratch;
      ctx = scratchCtx;
    } else {
      this.canvas ??= document.createElement('canvas');
      canvas = this.canvas;
      ctx = canvas.getContext('2d');
    }
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
    ctx.font = font;
    ctx.fillStyle = bg;
    roundRect(ctx, 0, 0, w, h, 14 * DPR);
    ctx.fill();
    const left = this.align === 'left';
    ctx.textAlign = left ? 'left' : 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => {
      ctx.font = l.font;
      ctx.fillStyle = l.fg ?? fg;
      ctx.fillText(l.text, left ? pad : w / 2, pad * 0.6 + lineH * (i + 0.5));
    });
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
    if (shared) Label.renderer.initTexture(this.texture);
    // show only the drawn w x h corner of the texture (top-left; textures are flipped in Y)
    this.texture.repeat.set(w / cw, h / ch);
    this.texture.offset.set(0, 1 - h / ch);
    const worldH = this.height * (h / lineH);
    this.mesh.scale.set(worldH * (w / h), worldH, 1);
    this.mesh.visible = this.wanted && !Label.hidden;
    return this;
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
