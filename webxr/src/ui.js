// World-space text labels drawn on canvases (stand-ins for the Unity TextMeshPro UI).
import * as THREE from 'three';

const DPR = 2;

export class Label {
  /**
   * @param {object} opts
   * @param {number} opts.height   world height of the label in metres
   * @param {string} opts.bg       CSS background colour
   * @param {string} opts.fg       CSS text colour
   * @param {boolean} opts.billboard  face the camera every frame
   */
  constructor({ height = 0.02, bg = 'rgba(20,24,38,0.85)', fg = '#fff', font = 600, billboard = true, depthTest = true, renderOrder = 10 } = {}) {
    this.height = height;
    this.bg = bg;
    this.fg = fg;
    this.font = font;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest, depthWrite: false, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.renderOrder = renderOrder;
    this.mesh.userData.billboard = billboard;
    this.mesh.raycast = () => {};
    this.text = null;
  }

  set(text, { fg, bg } = {}) {
    fg = fg ?? this.fg;
    bg = bg ?? this.bg;
    const key = `${text}|${fg}|${bg}`;
    if (key === this.text) return this;
    this.text = key;
    const lines = String(text).split('\n');
    const px = 40 * DPR;
    const ctx = this.ctx;
    ctx.font = `${this.font} ${px}px system-ui, -apple-system, Segoe UI, sans-serif`;
    const pad = 16 * DPR;
    const lineH = px * 1.2;
    const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2);
    const h = Math.ceil(lineH * lines.length + pad * 1.2);
    this.canvas.width = w;
    this.canvas.height = h;
    ctx.font = `${this.font} ${px}px system-ui, -apple-system, Segoe UI, sans-serif`;
    ctx.fillStyle = bg;
    roundRect(ctx, 0, 0, w, h, 14 * DPR);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, w / 2, pad * 0.6 + lineH * (i + 0.5)));
    this.texture.dispose();
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh.material.map = this.texture;
    const lineWorld = this.height;
    const worldH = lineWorld * (h / lineH);
    this.mesh.scale.set(worldH * (w / h), worldH, 1);
    return this;
  }

  set visible(v) { this.mesh.visible = v; }
  get visible() { return this.mesh.visible; }
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
export function updateBillboards(root, camera) {
  const camPos = new THREE.Vector3();
  camera.getWorldPosition(camPos);
  const q = new THREE.Quaternion();
  camera.getWorldQuaternion(q);
  const parentQ = new THREE.Quaternion();
  root.traverseVisible((o) => {
    if (!o.userData.billboard) return;
    o.parent.getWorldQuaternion(parentQ);
    o.quaternion.copy(parentQ.invert().multiply(q));
  });
}
