// Grabbing for WebXR controllers / hands and for mouse on desktop.
// Replaces XR Interaction Toolkit's XRGrabInteractable + ray/direct interactors.
import * as THREE from 'three';

const DIRECT_GRAB_RADIUS = 0.04;
// Pinch detection by joint distance. This works on Spectacles, where hands are the
// only input, and on Quest hand tracking. The gap between the two values avoids flicker.
const PINCH_START = 0.02;
const PINCH_END = 0.04;
const tmpM = new THREE.Matrix4();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const tmpQ = new THREE.Quaternion();
const tmpBox = new THREE.Box3();
const tmpP = new THREE.Vector3();
const tmpPinch = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);
const tmpQ2 = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const targets = []; // reused ray target list
/** Writes the yaw part of q into target (no allocation). */
const yawOnly = (q, target) => {
  tmpE.setFromQuaternion(q, 'YXZ');
  tmpE.set(0, tmpE.y, 0, 'YXZ');
  return target.setFromEuler(tmpE);
};

/**
 * One hand or controller. A grabbed building follows a "pose": the target ray,
 * or for a hand grabbing up close, the pinch point between thumb and index tips.
 */
class Pointer {
  constructor(index, renderer) {
    this.index = index;
    this.controller = renderer.xr.getController(index);
    this.grip = renderer.xr.getControllerGrip(index);
    this.hand = renderer.xr.getHand(index);
    this.handModel = null;
    this.line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }),
    );
    this.line.scale.z = 2;
    this.line.raycast = () => {};
    this.controller.add(this.line);
    this.cursor = new THREE.Mesh(
      new THREE.RingGeometry(0.006, 0.009, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }),
    );
    this.cursor.renderOrder = 30;
    this.cursor.visible = false;
    this.cursor.raycast = () => {};
    this.inputSource = null;
    this.grabbed = null;
    this.pressing = null; // the in-world button held down (it fires on release)
    this.grabMode = null; // 'ray' | 'pinch'
    this.hovered = null;
    this.pinching = false;
    this.localPos = new THREE.Vector3();
    this.yawStart = new THREE.Quaternion();
    this.objYawStart = new THREE.Quaternion();
    this.pose = new THREE.Matrix4();
  }

  get isHand() { return !!this.inputSource?.hand; }

  /** Hand joints are tracked this frame (the hand-tracking feature was granted). */
  get hasJoints() {
    const t = this.hand.joints?.['thumb-tip'];
    const i = this.hand.joints?.['index-finger-tip'];
    return !!(this.isHand && t && i && t.visible !== false && i.visible !== false);
  }

  pinchPoint(target) {
    const t = this.hand.joints['thumb-tip'].getWorldPosition(tmpV2);
    return this.hand.joints['index-finger-tip'].getWorldPosition(target).add(t).multiplyScalar(0.5);
  }

  pinchDistance() {
    const t = this.hand.joints['thumb-tip'].getWorldPosition(tmpV2);
    return this.hand.joints['index-finger-tip'].getWorldPosition(tmpV).distanceTo(t);
  }

  /** World matrix the grabbed building follows. */
  currentPose(target) {
    if (this.grabMode === 'pinch' && this.hasJoints) {
      const p = this.pinchPoint(tmpPinch);
      const wrist = this.hand.joints.wrist;
      const q = wrist ? yawOnly(wrist.getWorldQuaternion(tmpQ), tmpQ) : tmpQ.identity();
      return target.compose(p, q, ONE);
    }
    return target.copy(this.controller.matrixWorld);
  }

  nearPoint(target) {
    if (this.hasJoints) return this.pinchPoint(target);
    return this.grip.getWorldPosition(target);
  }
}

export class XRInput {
  constructor(renderer, parent, game, { models = true } = {}) {
    this.renderer = renderer;
    this.game = game;
    this.raycaster = new THREE.Raycaster();
    this.hands = [0, 1].map((i) => {
      const s = new Pointer(i, renderer);
      s.controller.addEventListener('connected', (e) => {
        s.inputSource = e.data;
        s.line.visible = e.data.targetRayMode === 'tracked-pointer';
      });
      s.controller.addEventListener('disconnected', () => {
        if (s.pressing) s.pressing.down = false;
        s.pressing = null;
        this.game.hoverButton(s, null);
        this.release(s);
        s.inputSource = null;
        s.pinching = false;
      });
      // Controllers, and hands without joint data, use the runtime's select / squeeze events.
      const start = () => { if (!s.hasJoints) this.press(s, 'ray'); };
      const end = () => { if (!s.hasJoints || s.grabMode === 'ray' || (s.pressing && !s.pinching)) this.release(s); };
      s.controller.addEventListener('selectstart', start);
      s.controller.addEventListener('selectend', end);
      s.controller.addEventListener('squeezestart', start);
      s.controller.addEventListener('squeezeend', end);
      parent.add(s.controller, s.grip, s.hand, s.cursor); // parent: the player rig
      return s;
    });
    if (models) this._loadModels();
  }

  /**
   * Controller / hand meshes (Quest). The modules and meshes are only fetched when
   * wanted; on Specs they are never loaded (no controllers, you see your own hands).
   */
  async _loadModels() {
    const [{ XRControllerModelFactory }, { XRHandModelFactory }] = await Promise.all([
      import('three/addons/webxr/XRControllerModelFactory.js'),
      import('three/addons/webxr/XRHandModelFactory.js'),
    ]);
    const controllerModels = new XRControllerModelFactory();
    const handModels = new XRHandModelFactory();
    for (const s of this.hands) {
      s.grip.add(controllerModels.createControllerModel(s.grip));
      s.handModel = handModels.createHandModel(s.hand, 'mesh');
      s.handModel.visible = this._handModelsVisible ?? true;
      s.hand.add(s.handModel);
    }
  }

  /** Show hand meshes in VR. In AR the real hands are already visible. */
  setHandModelsVisible(v) {
    this._handModelsVisible = v;
    for (const s of this.hands) if (s.handModel) s.handModel.visible = v;
  }

  addButton(mesh, onPress) { this.game.addButton(mesh, onPress); }

  get buttons() { return this.game.buttons; }

  _rayFrom(s) {
    tmpM.identity().extractRotation(s.controller.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(s.controller.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tmpM);
    this.raycaster.near = 0;
    this.raycaster.far = 10;
    return this.raycaster;
  }

  /** What this pointer would act on: a building or a button. Near targets win, then the ray. */
  _pick(s) {
    const colliders = this.game.grabbables();
    const p = s.nearPoint(tmpP);
    let best = null;
    let bestD = DIRECT_GRAB_RADIUS;
    for (const c of colliders) {
      const b = c.userData.building;
      const d = tmpBox.copy(b.localBox).applyMatrix4(b.root.matrixWorld).distanceToPoint(p);
      if (d < bestD) { best = { building: b, distance: 0, near: true }; bestD = d; }
    }
    for (const btn of this.buttons) {
      if (!btn.mesh.visible) continue;
      const d = tmpBox.setFromObject(btn.mesh).distanceToPoint(p);
      if (d < bestD) { best = { button: btn, distance: 0, near: true }; bestD = d; }
    }
    if (best) return best;
    const ray = this._rayFrom(s);
    targets.length = 0;
    for (const c of this.game.hoverables()) targets.push(c); // resource nodes: hover only, for their tooltip
    for (const b of this.buttons) if (b.mesh.visible) targets.push(b.mesh);
    const hit = ray.intersectObjects(targets, false)[0];
    if (!hit) return null;
    const btn = this.buttons.find((b) => b.mesh === hit.object);
    return btn
      ? { button: btn, distance: hit.distance, point: hit.point }
      : { building: hit.object.userData.building, distance: hit.distance, point: hit.point };
  }

  /** Start a grab or press a button. `how` is 'ray' for select events and 'pinch' for joint pinches. */
  press(s, how) {
    if (s.grabbed || s.pressing) return;
    const pick = this._pick(s);
    if (!pick) return;
    if (pick.button) {
      s.pressing = pick.button;
      pick.button.down = true;
      this._pulse(s, 0.5, 40);
      return;
    }
    const b = pick.building;
    if (this.hands.some((h) => h.grabbed === b)) return;
    if (!b.onStartGrab()) return;
    b.onHoverEnd();
    s.hovered = null;
    s.grabbed = b;
    // Up close, a pinching hand carries the building at the pinch point. Otherwise the
    // building hangs off the target ray at the distance it was picked up from.
    s.grabMode = how === 'pinch' && pick.near ? 'pinch' : 'ray';
    s.controller.updateMatrixWorld();
    const pose = s.currentPose(s.pose);
    s.localPos.copy(b.root.getWorldPosition(tmpV)).applyMatrix4(tmpM.copy(pose).invert());
    yawOnly(tmpQ2.setFromRotationMatrix(pose), s.yawStart);
    s.objYawStart.copy(b.root.quaternion);
    this._pulse(s, 0.4, 30);
  }

  release(s) {
    const btn = s.pressing;
    if (btn) {
      s.pressing = null;
      btn.down = false;
      if (btn.mesh.visible) btn.onPress();
      this._pulse(s, 0.6, 30);
      return;
    }
    const b = s.grabbed;
    if (!b) return;
    s.grabbed = null;
    s.grabMode = null;
    b.onRelease();
    this._pulse(s, 0.6, 50);
  }

  _pulse(s, intensity, ms) {
    s.inputSource?.gamepad?.hapticActuators?.[0]?.pulse?.(intensity, ms);
  }

  update(dt) {
    for (const s of this.hands) {
      if (!s.inputSource) {
        s.cursor.visible = false;
        continue;
      }
      // polled pinch for tracked hands
      if (s.hasJoints) {
        const d = s.pinchDistance();
        if (!s.pinching && d < PINCH_START) {
          s.pinching = true;
          this.press(s, 'pinch');
        } else if (s.pinching && d > PINCH_END) {
          s.pinching = false;
          this.release(s);
        }
      }

      const b = s.grabbed;
      if (b) {
        // the thumbstick pushes or pulls a ray-grabbed building
        const axes = s.inputSource.gamepad?.axes;
        if (s.grabMode === 'ray' && axes && axes.length >= 4 && Math.abs(axes[3]) > 0.2) {
          const len = s.localPos.length();
          if (len > 0.08 || axes[3] > 0) {
            s.localPos.multiplyScalar(Math.max(0.05, len + axes[3] * dt * 0.8) / Math.max(len, 1e-4));
          }
        }
        const pose = s.currentPose(s.pose);
        this.game.setWorldPosition(b, tmpV.copy(s.localPos).applyMatrix4(pose));
        const yawNow = yawOnly(tmpQ2.setFromRotationMatrix(pose), tmpQ2);
        b.root.quaternion.copy(tmpQ.copy(s.yawStart).invert()).premultiply(yawNow).multiply(s.objYawStart);
        s.line.scale.z = s.grabMode === 'ray' ? s.localPos.length() : 0.05;
        s.cursor.visible = false;
        continue;
      }
      // hover (XRI hover -> BuildingBase.OnStartHover / OnExitHover)
      const pick = this._pick(s);
      const hovered = pick?.building ?? null;
      if (hovered !== s.hovered) {
        s.hovered?.onHoverEnd();
        hovered?.onHoverStart();
        s.hovered = hovered;
      }
      this.game.hoverButton(s, pick?.button ?? null);
      s.line.scale.z = pick && pick.distance > 0 ? pick.distance : 2;
      // a small ring where the ray lands, which helps on see-through displays
      if (pick?.point) {
        s.cursor.visible = true;
        s.cursor.parent.worldToLocal(s.cursor.position.copy(pick.point));
        s.cursor.lookAt(this.renderer.xr.getCamera().getWorldPosition(tmpV));
      } else {
        s.cursor.visible = false;
      }
    }
  }
}

// Left mouse: drag buildings and press in-world buttons. A dragged building snaps onto
// the ground (its support beams at zero length); the wheel lifts it from there. Wheel down
// stops at the ground, wheel up has no limit (higher costs more beam).
export class MouseInput {
  constructor(camera, dom, game) {
    this.camera = camera;
    this.dom = dom;
    this.game = game;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.dragging = null;
    this.hovered = null;
    this.lift = 0; // game units above the snapped ground position
    this.probe = new THREE.Raycaster();
    this.last = null; // where the building is carried on screen, kept while the camera flies
    this.offset = new THREE.Vector2(); // how far the real cursor drifted from it during a camera turn
    this.pressing = null; // the in-world button held down (it fires on release over the same button)
    this.cameraBusy = null; // set by main.js: true while the right / middle button moves the camera
    this.enabled = true;
    dom.addEventListener('pointerdown', (e) => this.down(e), { capture: true });
    dom.addEventListener('pointermove', (e) => this.onPointer(e));
    window.addEventListener('pointerup', (e) => { if (!(e.buttons & 1)) this.up(e); });
    dom.addEventListener('wheel', (e) => {
      if (!this.dragging) return;
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      this.lift = Math.max(0, this.lift - dy * 0.0002); // one notch = 0.02 game units (1 cm on the board)
      this.move(this.last);
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (!this.dragging) return;
      // Z / X turn the dragged building (Q / E always move the camera)
      if (e.code === 'KeyZ') this.dragging.root.rotateY(Math.PI / 12);
      if (e.code === 'KeyX') this.dragging.root.rotateY(-Math.PI / 12);
    });
  }

  _ray(e) {
    const r = this.dom.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.raycaster.far = 50;
  }

  down(e) {
    if (!this.enabled || e.button !== 0) return;
    this._ray(e);
    // in-world buttons (the hand choice, Continue, New game...) fire when released
    const btn = this._buttonAt();
    if (btn) {
      this.pressing = btn;
      btn.down = true;
      e.stopImmediatePropagation();
      return;
    }
    const hit = this.raycaster.intersectObjects(this.game.grabbables(), false)[0];
    if (!hit) return;
    const b = hit.object.userData.building;
    if (!b.onStartGrab()) return;
    b.onHoverEnd();
    this.hovered = null;
    this.dragging = b;
    this.lift = 0; // snap to the ground
    b.lift = 0;
    this.last = { clientX: e.clientX, clientY: e.clientY };
    this.offset.set(0, 0);
    e.stopImmediatePropagation();
  }

  _buttonAt() {
    const hit = this.raycaster.intersectObjects(this.game.buttonTargets(), false)[0];
    return hit ? this.game.buttons.find((b) => b.mesh === hit.object) ?? null : null;
  }

  /** The pointer moved. While the camera turns or pans, a carried building holds its spot on screen. */
  onPointer(e) {
    if (!this.enabled) return;
    // the left button came up while another one is still down: that is only a pointermove
    if ((this.dragging || this.pressing) && !(e.buttons & 1)) this.up(e);
    if (this.dragging && this.cameraBusy?.()) {
      this.offset.set(this.last.clientX - e.clientX, this.last.clientY - e.clientY);
      this.dom.classList.add('carrying'); // the real cursor is elsewhere now, so hide it
    } else if (this.dragging) {
      const r = this.dom.getBoundingClientRect();
      this.last = {
        clientX: THREE.MathUtils.clamp(e.clientX + this.offset.x, r.left, r.right),
        clientY: THREE.MathUtils.clamp(e.clientY + this.offset.y, r.top, r.bottom),
      };
    } else {
      this.last = { clientX: e.clientX, clientY: e.clientY };
    }
    this.move(this.last);
  }

  move(e) {
    if (!this.enabled) return;
    this._ray(e);
    const b = this.dragging;
    if (b) {
      // follow the ground under the cursor
      const targets = this.game.groundTargets(b);
      const ground = this.raycaster.intersectObjects(targets, false)[0];
      const board = this.game.board;
      const k = board.scale.y;
      if (ground) {
        // rest the building just above the highest ground under its support beams
        this.game.setWorldPosition(b, ground.point);
        // Snap: the highest ground under the support beams, measured the way the beams
        // measure it (baked heightfield, plus finished buildings and nodes they can stand on).
        const hf = this.game.assets.heightfield;
        const solids = this.game.obstacleTargets(b);
        let top = -Infinity;
        b.root.updateMatrixWorld(true);
        const feet = b.beams.length ? b.beams.map((beam) => beam.holder) : [b.root];
        const hitY = (ground.point.y - board.position.y) / k; // where the cursor ray landed, in board units
        for (const foot of feet) {
          foot.getWorldPosition(tmpV);
          board.worldToLocal(tmpV2.copy(tmpV));
          let h = hf.at(tmpV2.x, tmpV2.z);
          // off the heightfield (e.g. the ray hit the board's side wall): use the hit point itself
          if (!Number.isFinite(h)) h = hitY;
          this.probe.set(tmpV.setY(board.position.y + 100 * k), DOWN);
          const hit = this.probe.intersectObjects(solids, false)[0];
          const on = hit?.object.userData.building;
          if (hit && (!on || on.isResource || on.info.standOn)) h = Math.max(h, (hit.point.y - board.position.y) / k);
          top = Math.max(top, h);
        }
        // board is only yawed and uniformly scaled, so heights convert directly
        const beamDrop = b.beams.length ? -b.beams[0].holder.position.y : 0;
        // +0.001: resting exactly on the ground can read as just below it (float precision)
        if (!Number.isFinite(top)) top = hitY;
        b.root.position.y = top + beamDrop + 0.001 + this.lift;
        b.lift = this.lift;
      } else {
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -b.root.getWorldPosition(tmpV2).y);
        if (this.raycaster.ray.intersectPlane(plane, tmpV)) {
          const y = b.root.position.y;
          this.game.setWorldPosition(b, tmpV);
          b.root.position.y = y;
        }
      }
      return;
    }
    if (this.cameraBusy?.()) return;
    const btn = this._buttonAt();
    this.game.hoverButton(this, btn);
    const hit = btn ? null : this.raycaster.intersectObjects(this.game.hoverables(), false)[0];
    const hovered = hit ? hit.object.userData.building : null;
    if (hovered !== this.hovered) {
      this.hovered?.onHoverEnd();
      hovered?.onHoverStart();
      this.hovered = hovered;
    }
    this.dom.style.cursor = btn ? 'pointer' : hovered?.grabbable ? 'grab' : '';
  }

  /** Called every frame: keeps a dragged building under the cursor while the camera moves. */
  update() {
    if (this.dragging && this.last) this.move(this.last);
  }

  up(e) {
    const btn = this.pressing;
    if (btn) {
      this.pressing = null;
      btn.down = false;
      if (e) {
        this._ray(e);
        if (this._buttonAt() === btn) btn.onPress();
      }
      return;
    }
    const b = this.dragging;
    if (!b) return;
    this.dragging = null;
    this.offset.set(0, 0);
    this.dom.classList.remove('carrying');
    b.lift = 0;
    b.onRelease();
  }
}
