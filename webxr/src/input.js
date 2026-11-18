// Grabbing for WebXR controllers / hands and for mouse on desktop.
// Replaces XR Interaction Toolkit's XRGrabInteractable + ray/direct interactors.
import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';

const DIRECT_GRAB_RADIUS = 0.05;
const tmpM = new THREE.Matrix4();
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const yawOnly = (q) => {
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(0, e.y, 0, 'YXZ'));
};

export class XRInput {
  constructor(renderer, scene, game) {
    this.renderer = renderer;
    this.game = game;
    this.raycaster = new THREE.Raycaster();
    this.hands = [];
    const controllerModels = new XRControllerModelFactory();
    const handModels = new XRHandModelFactory();

    for (let i = 0; i < 2; i++) {
      const controller = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      grip.add(controllerModels.createControllerModel(grip));
      const hand = renderer.xr.getHand(i);
      hand.add(handModels.createHandModel(hand, 'mesh'));

      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }),
      );
      line.scale.z = 2;
      line.raycast = () => {};
      controller.add(line);

      const state = { controller, grip, hand, line, grabbed: null, offset: new THREE.Matrix4(), hovered: null, inputSource: null, yawStart: null, objYawStart: null };
      controller.addEventListener('connected', (e) => {
        state.inputSource = e.data;
        line.visible = e.data.targetRayMode === 'tracked-pointer';
      });
      controller.addEventListener('disconnected', () => {
        this.release(state);
        state.inputSource = null;
      });
      controller.addEventListener('selectstart', () => this.grab(state));
      controller.addEventListener('selectend', () => this.release(state));
      controller.addEventListener('squeezestart', () => this.grab(state));
      controller.addEventListener('squeezeend', () => this.release(state));

      scene.add(controller, grip, hand);
      this.hands.push(state);
    }
  }

  /** Point used for direct (near) grabs: index-finger tip for hands, grip for controllers. */
  _nearPoint(state, target) {
    const tip = state.hand.joints?.['index-finger-tip'];
    if (state.inputSource?.hand && tip) return tip.getWorldPosition(target);
    return state.grip.getWorldPosition(target);
  }

  _pick(state) {
    const colliders = this.game.grabbables();
    // direct grab first
    const p = this._nearPoint(state, new THREE.Vector3());
    let best = null;
    let bestD = DIRECT_GRAB_RADIUS;
    for (const c of colliders) {
      const b = c.userData.building;
      const box = b.localBox.clone().applyMatrix4(b.root.matrixWorld);
      const d = box.distanceToPoint(p);
      if (d < bestD) { best = b; bestD = d; }
    }
    if (best) return { building: best, distance: 0 };
    // then the ray
    tmpM.identity().extractRotation(state.controller.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(state.controller.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tmpM);
    this.raycaster.far = 10;
    const hit = this.raycaster.intersectObjects(colliders, false)[0];
    return hit ? { building: hit.object.userData.building, distance: hit.distance } : null;
  }

  grab(state) {
    if (state.grabbed) return;
    const pick = this._pick(state);
    if (!pick) return;
    const b = pick.building;
    if (this.hands.some((h) => h.grabbed === b)) return;
    if (!b.onStartGrab()) return;
    b.onHoverEnd();
    state.grabbed = b;
    // keep the object where it is relative to the controller (position only);
    // rotation follows the controller's yaw so buildings stay upright.
    state.controller.updateMatrixWorld();
    state.offset.copy(state.controller.matrixWorld).invert();
    state.localPos = b.root.position.clone().applyMatrix4(state.offset);
    state.yawStart = yawOnly(state.controller.getWorldQuaternion(new THREE.Quaternion()));
    state.objYawStart = b.root.quaternion.clone();
    this._pulse(state, 0.4, 30);
  }

  release(state) {
    const b = state.grabbed;
    if (!b) return;
    state.grabbed = null;
    b.onRelease();
    this._pulse(state, 0.6, 50);
  }

  _pulse(state, intensity, ms) {
    const actuator = state.inputSource?.gamepad?.hapticActuators?.[0];
    actuator?.pulse?.(intensity, ms);
  }

  update(dt) {
    for (const state of this.hands) {
      if (!state.inputSource) continue;
      const b = state.grabbed;
      if (b) {
        // thumbstick pushes / pulls a ray-grabbed building
        const axes = state.inputSource.gamepad?.axes;
        if (axes && axes.length >= 4 && Math.abs(axes[3]) > 0.2) {
          const len = state.localPos.length();
          if (len > 0.08 || axes[3] > 0) {
            state.localPos.multiplyScalar(Math.max(0.05, len + axes[3] * dt * 0.8) / Math.max(len, 1e-4));
          }
        }
        b.root.position.copy(state.localPos).applyMatrix4(state.controller.matrixWorld);
        const yawNow = yawOnly(state.controller.getWorldQuaternion(tmpQ));
        const delta = yawNow.multiply(state.yawStart.clone().invert());
        b.root.quaternion.copy(delta.multiply(state.objYawStart));
        state.line.scale.z = state.localPos.length();
        continue;
      }
      // hover (XRI hover -> BuildingBase.OnStartHover / OnExitHover)
      const pick = this._pick(state);
      const hovered = pick?.building ?? null;
      if (hovered !== state.hovered) {
        state.hovered?.onHoverEnd();
        hovered?.onHoverStart();
        state.hovered = hovered;
      }
      state.line.scale.z = pick && pick.distance > 0 ? pick.distance : 2;
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
      // follow the ground under the cursor, hovering `lift` metres above it
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
