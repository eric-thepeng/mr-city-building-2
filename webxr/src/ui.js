// World-space text labels drawn on canvases (stand-ins for the Unity TextMeshPro UI).
import * as THREE from 'three';

const PLANE = new THREE.PlaneGeometry(1, 1);

export class Label {
  /** Canvas pixels per text pixel. Lowered on memory-tight devices (Specs). */
  static resolution = 1.5;

  /**
   * Labels are lazy: no canvas or GPU texture exists until set() is first called.
   * @param {object} opts
   * @param {number} opts.height   world height of one text line in metres
   * @param {string} opts.bg       CSS background colour
   * @param {string} opts.fg       CSS text colour
   * @param {boolean} opts.billboard  face the camera every frame
   */
  constructor({ height = 0.02, bg = 'rgba(20,24,38,0.85)', fg = '#fff', font = 600, billboard = true, depthTest = true, renderOrder = 10 } = {}) {
    this.height = height;
    this.bg = bg;
    this.fg = fg;
    this.font = font;
    this.canvas = null;
    this.texture = null;
    const mat = new THREE.MeshBasicMaterial({ transparent: true, depthTest, depthWrite: false, toneMapped: false });
    this.mesh = new THREE.Mesh(PLANE, mat);
    this.mesh.renderOrder = renderOrder;
    this.mesh.userData.billboard = billboard;
    this.mesh.raycast = () => {};
    this.mesh.visible = false;
    this.wanted = true;
    this.text = null;
  }

  set(text, { fg, bg } = {}) {
    fg = fg ?? this.fg;
    bg = bg ?? this.bg;
    const key = `${text}|${fg}|${bg}`;
    if (key === this.text) return this;
    this.text = key;
    this.canvas ??= document.createElement('canvas');
    this.ctx ??= this.canvas.getContext('2d');
    const DPR = Label.resolution;
    const lines = String(text).split('\n');
    const px = 32 * DPR;
    const ctx = this.ctx;
    ctx.font = `${this.font} ${px}px system-ui, -apple-system, Segoe UI, sans-serif`;
    const pad = 16 * DPR;
    const lineH = px * 1.2;
    const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2);
    const h = Math.ceil(lineH * lines.length + pad * 1.2);
    // Reuse the canvas and GPU texture when the new text fits (a cost label changes
    // many times a second while carrying a building). Only grow when needed.
    const grow = !this.texture || w > this.canvas.width || h > this.canvas.height;
    if (grow) {
      this.canvas.width = Math.max(w, this.texture ? this.canvas.width : 0);
      this.canvas.height = Math.max(h, this.texture ? this.canvas.height : 0);
    }
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    ctx.font = `${this.font} ${px}px system-ui, -apple-system, Segoe UI, sans-serif`;
    ctx.fillStyle = bg;
    roundRect(ctx, 0, 0, w, h, 14 * DPR);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, w / 2, pad * 0.6 + lineH * (i + 0.5)));
    if (grow) {
      this.texture?.dispose();
      this.texture = new THREE.CanvasTexture(this.canvas);
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.texture.generateMipmaps = false; // a third less memory; labels are viewed up close
      this.texture.minFilter = THREE.LinearFilter;
      this.mesh.material.map = this.texture;
      this.mesh.material.needsUpdate = true;
    } else {
      this.texture.needsUpdate = true;
    }
    // show only the drawn w x h corner of the canvas (top-left; textures are flipped in Y)
    this.texture.repeat.set(w / cw, h / ch);
    this.texture.offset.set(0, 1 - h / ch);
    const lineWorld = this.height;
    const worldH = lineWorld * (h / lineH);
    this.mesh.scale.set(worldH * (w / h), worldH, 1);
    this.mesh.visible = this.wanted;
    return this;
  }

  /** Shows the label once it has text; until then it stays hidden. */
  set visible(v) {
    this.wanted = v;
    this.mesh.visible = v && !!this.texture;
  }

  get visible() { return this.mesh.visible; }

  dispose() {
    this.texture?.dispose();
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
