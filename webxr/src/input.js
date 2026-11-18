// Grabbing for WebXR controllers / hands and for mouse on desktop.
// Replaces XR Interaction Toolkit's XRGrabInteractable + ray/direct interactors.
import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';

const DIRECT_GRAB_RADIUS = 0.05;
// Pinch detection by joint distance. This works on Spectacles, where hands are the
// only input, and on Quest hand tracking. The gap between the two values avoids flicker.
const PINCH_START = 0.02;
const PINCH_END = 0.04;
const tmpM = new THREE.Matrix4();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const yawOnly = (q) => {
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(0, e.y, 0, 'YXZ'));
};

/**
 * One hand or controller. A grabbed building follows a "pose": the target ray,
 * or for a hand grabbing up close, the pinch point between thumb and index tips.
 */
class Pointer {
  constructor(index, renderer, controllerModels, handModels) {
    this.index = index;
    this.controller = renderer.xr.getController(index);
    this.grip = renderer.xr.getControllerGrip(index);
    this.hand = renderer.xr.getHand(index);
    this.handModel = null;
    // Controller / hand meshes are downloaded from a CDN when an input connects.
    // They are skipped on Specs (no controllers; you see your own hands).
    if (controllerModels) this.grip.add(controllerModels.createControllerModel(this.grip));
    if (handModels) {
      this.handModel = handModels.createHandModel(this.hand, 'mesh');
      this.hand.add(this.handModel);
    }
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
      const p = this.pinchPoint(new THREE.Vector3());
      const wrist = this.hand.joints.wrist;
      const q = wrist ? yawOnly(wrist.getWorldQuaternion(tmpQ)) : new THREE.Quaternion();
      return target.compose(p, q, new THREE.Vector3(1, 1, 1));
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
    this.buttons = []; // { mesh, onPress }
    const controllerModels = models ? new XRControllerModelFactory() : null;
    const handModels = models ? new XRHandModelFactory() : null;
    this.hands = [0, 1].map((i) => {
      const s = new Pointer(i, renderer, controllerModels, handModels);
      s.controller.addEventListener('connected', (e) => {
        s.inputSource = e.data;
        s.line.visible = e.data.targetRayMode === 'tracked-pointer';
      });
      s.controller.addEventListener('disconnected', () => {
        this.release(s);
        s.inputSource = null;
        s.pinching = false;
      });
      // Controllers, and hands without joint data, use the runtime's select / squeeze events.
      const start = () => { if (!s.hasJoints) this.press(s, 'ray'); };
      const end = () => { if (!s.hasJoints || s.grabMode === 'ray') this.release(s); };
      s.controller.addEventListener('selectstart', start);
      s.controller.addEventListener('selectend', end);
      s.controller.addEventListener('squeezestart', start);
      s.controller.addEventListener('squeezeend', end);
      parent.add(s.controller, s.grip, s.hand, s.cursor); // parent: the player rig
      return s;
    });
  }

  /** Show hand meshes in VR. In AR the real hands are already visible. */
  setHandModelsVisible(v) {
    for (const s of this.hands) if (s.handModel) s.handModel.visible = v;
  }

  addButton(mesh, onPress) {
    this.buttons.push({ mesh, onPress });
  }

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
    const p = s.nearPoint(new THREE.Vector3());
    let best = null;
    let bestD = DIRECT_GRAB_RADIUS;
    for (const c of colliders) {
      const b = c.userData.building;
      const d = b.localBox.clone().applyMatrix4(b.root.matrixWorld).distanceToPoint(p);
      if (d < bestD) { best = { building: b, distance: 0, near: true }; bestD = d; }
    }
    for (const btn of this.buttons) {
      if (!btn.mesh.visible) continue;
      const d = new THREE.Box3().setFromObject(btn.mesh).distanceToPoint(p);
      if (d < bestD) { best = { button: btn, distance: 0, near: true }; bestD = d; }
    }
    if (best) return best;
    const ray = this._rayFrom(s);
    const buttonMeshes = this.buttons.filter((b) => b.mesh.visible).map((b) => b.mesh);
    const hit = ray.intersectObjects([...colliders, ...buttonMeshes], false)[0];
    if (!hit) return null;
    const btn = this.buttons.find((b) => b.mesh === hit.object);
    return btn
      ? { button: btn, distance: hit.distance, point: hit.point }
      : { building: hit.object.userData.building, distance: hit.distance, point: hit.point };
  }

  /** Start a grab or press a button. `how` is 'ray' for select events and 'pinch' for joint pinches. */
  press(s, how) {
    if (s.grabbed) return;
    const pick = this._pick(s);
    if (!pick) return;
    if (pick.button) {
      pick.button.onPress();
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
    s.localPos.copy(b.root.position).applyMatrix4(tmpM.copy(pose).invert());
    s.yawStart.copy(yawOnly(new THREE.Quaternion().setFromRotationMatrix(pose)));
    s.objYawStart.copy(b.root.quaternion);
    this._pulse(s, 0.4, 30);
  }

  release(s) {
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
        b.root.position.copy(s.localPos).applyMatrix4(pose);
        const yawNow = yawOnly(new THREE.Quaternion().setFromRotationMatrix(pose));
        b.root.quaternion.copy(yawNow.multiply(s.yawStart.clone().invert()).multiply(s.objYawStart));
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

export class MouseInput {
  constructor(camera, dom, game, controls) {
    this.camera = camera;
    this.dom = dom;
    this.game = game;
    this.controls = controls;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.dragging = null;
    this.hovered = null;
    this.lift = 0.008;
    this.enabled = true;
    dom.addEventListener('pointerdown', (e) => this.down(e), { capture: true });
    dom.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', () => this.up());
    dom.addEventListener('wheel', (e) => {
      if (!this.dragging) return;
      e.preventDefault();
      this.lift = THREE.MathUtils.clamp(this.lift - e.deltaY * 0.0002, 0.002, 0.4);
      this.move(e);
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (!this.dragging) return;
      if (e.key === 'q' || e.key === 'Q') this.dragging.root.rotateY(Math.PI / 12);
      if (e.key === 'e' || e.key === 'E') this.dragging.root.rotateY(-Math.PI / 12);
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
    const hit = this.raycaster.intersectObjects(this.game.grabbables(), false)[0];
    if (!hit) return;
    const b = hit.object.userData.building;
    if (!b.onStartGrab()) return;
    b.onHoverEnd();
    this.hovered = null;
    this.dragging = b;
    this.lift = 0.008;
    this.controls.enabled = false;
    e.stopImmediatePropagation();
  }

  move(e) {
    if (!this.enabled) return;
    this._ray(e);
    const b = this.dragging;
    if (b) {
      // follow the ground under the cursor
      const targets = this.game.groundTargets(b);
      const ground = this.raycaster.intersectObjects(targets, false)[0];
      if (ground) {
        // rest the building just above the highest ground under its support beams
        b.root.position.copy(ground.point);
        let top = ground.point.y;
        const down = new THREE.Vector3(0, -1, 0);
        const probe = new THREE.Raycaster();
        b.root.updateMatrixWorld(true);
        for (const beam of b.beams) {
          beam.holder.getWorldPosition(tmpV);
          probe.set(tmpV.setY(ground.point.y + 2), down);
          const h = probe.intersectObjects(targets, false)[0];
          if (h) top = Math.max(top, h.point.y);
        }
        const beamDrop = b.beams.length ? -b.beams[0].holder.position.y : 0;
        b.root.position.y = top + beamDrop + this.lift;
      } else {
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -b.root.position.y);
        if (this.raycaster.ray.intersectPlane(plane, tmpV)) b.root.position.copy(tmpV);
      }
      return;
    }
    const hit = this.raycaster.intersectObjects(this.game.grabbables(), false)[0];
    const hovered = hit ? hit.object.userData.building : null;
    if (hovered !== this.hovered) {
      this.hovered?.onHoverEnd();
      hovered?.onHoverStart();
      this.hovered = hovered;
      this.dom.style.cursor = hovered ? 'grab' : '';
    }
  }

  up() {
    const b = this.dragging;
    if (!b) return;
    this.dragging = null;
    this.controls.enabled = true;
    b.onRelease();
  }
}
