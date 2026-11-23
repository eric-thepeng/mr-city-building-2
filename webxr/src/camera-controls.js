// Desktop camera that works like the Unity Scene view:
//   right mouse drag   look around (the camera turns in place)
//   middle mouse drag  pan
//   W A S D / arrows   fly forward, left, back, right (Shift = faster)
//   Q / E              down / up
//   wheel              move forward / back (when no building is being dragged; then it sets the height)
// All of it also works while the left button is carrying a building.
import * as THREE from 'three';

const KEYS = {
  KeyW: [0, 0, -1], ArrowUp: [0, 0, -1],
  KeyS: [0, 0, 1], ArrowDown: [0, 0, 1],
  KeyA: [-1, 0, 0], ArrowLeft: [-1, 0, 0],
  KeyD: [1, 0, 0], ArrowRight: [1, 0, 0],
  KeyQ: [0, -1, 0], KeyE: [0, 1, 0],
};
const tmp = new THREE.Vector3();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');

export class EditorCamera {
  /**
   * @param {THREE.Camera} camera
   * @param {HTMLElement} dom
   * @param {object} opts
   * @param {THREE.Vector3} opts.target  what the idle turntable circles around
   * @param {() => boolean} opts.busy     true while a building is being dragged
   */
  constructor(camera, dom, { target, busy = () => false }) {
    this.camera = camera;
    this.dom = dom;
    this.target = target.clone();
    this.busy = busy;
    this.enabled = true;
    this.autoRotate = false;
    this.autoRotateSpeed = 0.063; // radians per second (about 100 s a turn)
    this.speed = 0.6; // metres per second
    this.lookSpeed = 0.004; // radians per pixel
    this.held = new Set();
    this.mode = null; // 'look' | 'pan'
    this.yaw = 0;
    this.pitch = 0;
    this.camera.lookAt(this.target);
    this.syncAngles();

    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    // A second mouse button pressed during a drag sends no pointerdown or pointerup, only a
    // pointermove with new `buttons`, so the mode is read from `buttons` every time.
    const syncMode = (e) => {
      const want = !this.active ? null : e.buttons & 2 ? 'look' : e.buttons & 4 ? 'pan' : null;
      if (want === this.mode) return;
      if (want && !this.mode) {
        this.syncAngles();
        this.dom.setPointerCapture(e.pointerId);
      }
      this.mode = want;
      this.dom.style.cursor = want === 'look' ? 'none' : want === 'pan' ? 'move' : '';
    };
    dom.addEventListener('pointerdown', (e) => {
      if (e.button === 1 || e.button === 2) e.preventDefault();
      syncMode(e);
    });
    dom.addEventListener('pointermove', (e) => {
      syncMode(e);
      if (!this.mode) return;
      if (this.mode === 'look') {
        this.yaw -= e.movementX * this.lookSpeed;
        this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * this.lookSpeed, -1.55, 1.55);
        this.applyAngles();
      } else {
        const k = 0.0012; // metres per pixel
        tmp.set(-e.movementX * k, e.movementY * k, 0).applyQuaternion(this.camera.quaternion);
        this.camera.position.add(tmp);
      }
    });
    dom.addEventListener('pointerup', syncMode);
    dom.addEventListener('pointercancel', () => { this.mode = null; this.dom.style.cursor = ''; });
    dom.addEventListener('wheel', (e) => {
      if (!this.active || this.busy()) return;
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      this.camera.getWorldDirection(tmp);
      this.camera.position.addScaledVector(tmp, -dy * 0.0012);
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
      if (KEYS[e.code] || e.code.startsWith('Shift')) {
        this.held.add(e.code);
        if (e.code.startsWith('Arrow')) e.preventDefault(); // don't scroll the page
      }
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
  }

  get active() { return this.enabled && !this.autoRotate; }

  /** Read yaw and pitch back from the camera (after something else moved it). */
  syncAngles() {
    euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = euler.y;
    this.pitch = euler.x;
  }

  applyAngles() {
    euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
  }

  update(dt) {
    if (!this.enabled) return;
    const cam = this.camera;
    if (this.autoRotate) {
      // landing page: circle slowly around the board, looking at it
      tmp.subVectors(cam.position, this.target);
      tmp.applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.autoRotateSpeed * dt);
      cam.position.copy(this.target).add(tmp);
      cam.lookAt(this.target);
      this.syncAngles();
      return;
    }
    tmp.set(0, 0, 0);
    for (const code of this.held) {
      const d = KEYS[code];
      if (!d) continue;
      tmp.x += d[0];
      tmp.y += d[1];
      tmp.z += d[2];
    }
    if (tmp.lengthSq() === 0) return;
    const fast = this.held.has('ShiftLeft') || this.held.has('ShiftRight') ? 3 : 1;
    const up = tmp.y;
    tmp.y = 0;
    tmp.normalize().applyQuaternion(cam.quaternion); // forward follows where you look, like Unity
    cam.position.addScaledVector(tmp, this.speed * fast * dt);
    cam.position.y += up * this.speed * fast * dt;
    this.moved = true;
  }
}
