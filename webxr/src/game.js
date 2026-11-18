// Game rules, ported from the Unity scripts on `main`:
//   BuildingBase.cs, SupportBeam.cs, ScoringIdentifier.cs,
//   HandManager.cs, MoneyManager.cs, SO_BuildingIdentifier / SO_HandPreset.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Label } from './ui.js';

export const State = Object.freeze({ WAITING: 'WAITING', ONGOING: 'ONGOING', COMPLETE: 'COMPLETE' });

// The whole sandbox (and every building) is shown at this fraction of the Unity size.
export const BOARD_SCALE = 0.5;
const DOWN = new THREE.Vector3(0, -1, 0);
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

// ------------------------------------------------------------------ Money
class MoneyManager {
  constructor(game, amount) {
    this.game = game;
    this.amount = amount;
    this.label = new Label({ height: 0.03 * game.ui, bg: 'rgba(16,20,34,0.88)', fg: '#ffe27a', billboard: false });
    this.anchor = new THREE.Object3D();
    this.anchor.add(this.label.mesh);
    this.updateUI();
  }
  has(n) { return this.amount >= n; }
  spend(n) {
    if (!this.has(n)) return false;
    this.amount -= n;
    this.updateUI();
    return true;
  }
  gain(n) {
    this.amount += n;
    this.updateUI();
  }
  updateUI() {
    this.label.set(`Budget: ${this.amount}`);
    this.game.events.dispatchEvent({ type: 'money', amount: this.amount });
  }
  uiPosition(target) { return this.label.mesh.getWorldPosition(target); }
}

// ------------------------------------------------------------------ Hand
class HandManager {
  constructor(game) {
    this.game = game;
    this.preset = null;
    this.built = 0;
  }
  get total() { return Object.values(this.preset.buildings).reduce((a, b) => a + b, 0); }
  refresh() {
    const presets = this.game.data.handPresets;
    this.preset = presets[Math.floor(Math.random() * presets.length)];
    this.built = 0;
    this.game.money.gain(this.preset.freeMoney);
    const spawn = this.game.spawnCenter;
    const spacing = this.game.data.buildingSpawn.spacing;
    const total = this.total;
    let i = 0;
    for (const [key, count] of Object.entries(this.preset.buildings)) {
      for (let n = 0; n < count; n++) {
        const pos = spawn.clone().add(new THREE.Vector3(spacing * (i - (total - 1) / 2), 0, 0));
        this.game.addBuilding(new Building(this.game, key, { position: pos }));
        i++;
      }
    }
    this.game.events.dispatchEvent({ type: 'hand', preset: this.preset });
  }
  buildOne() {
    this.built += 1;
    if (this.built === this.total) this.refresh();
  }
}

// ------------------------------------------------------------------ Building
export class Building {
  /**
   * @param {Game} game
   * @param {string} key   block key (e.g. "Farm") or resource type ("OreNode"/"GasNode")
   */
  constructor(game, key, { position, matrix, resource = null } = {}) {
    this.game = game;
    this.key = key;
    this.isResource = !!resource;
    this.info = game.data.buildingInfo[key];
    const assets = game.assets;

    this.root = new THREE.Group();
    this.root.name = `Building:${key}`;
    this.root.userData.building = this;

    let def;
    if (resource) {
      def = { beams: [], maxBeamLength: 0 };
      this.root.position.fromArray(resource.p);
      this.root.quaternion.fromArray(resource.q);
      if (resource.vfx) this.root.add(makeGasVfx(game));
    } else {
      def = game.data.blocks[key];
      this.root.position.copy(position);
    }
    this.def = def;
    this.maxBeamLength = def.maxBeamLength;

    // visuals (Regular Object; the red Error Object is made on first use)
    this.modelName = resource ? `resource_${resource.index}` : `block_${key}`;
    this.regular = assets.instance(this.modelName);
    this.error = null;
    this.root.add(this.regular);

    // collider proxy used for grabbing and as ground for other buildings' beams
    // (root's world matrix is still identity here, so this box is in root-local space)
    const box = new THREE.Box3().setFromObject(this.regular, true);
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(0.04, 0.04, 0.04));
    if (!resource) {
      // Unity's BuildingBase cube is 4 cm wide; keep at least that much to grab
      box.union(new THREE.Box3(new THREE.Vector3(-0.02, -0.02, -0.02), new THREE.Vector3(0.02, 0.02, 0.02)));
    }
    this.localBox = box;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    this.collider = new THREE.Mesh(game.boxGeometry, game.colliderMaterial);
    this.collider.scale.copy(size);
    this.collider.position.copy(center);
    this.collider.userData.building = this;
    this.root.add(this.collider);
    // what other buildings' beams can land on once this one is finished
    this.solids = [];
    if (resource) this.regular.traverse((o) => o.isMesh && this.solids.push(o));
    else this.solids.push(this.collider);
    const top = box.max.y;

    // support beams
    this.beams = def.beams.map((anchor) => {
      const holder = new THREE.Object3D();
      holder.position.fromArray(anchor);
      const body = new THREE.Mesh(game.beamGeometry, game.beamMaterial);
      body.visible = false;
      holder.add(body);
      this.root.add(holder);
      return { holder, body, length: 0 };
    });

    // UI (labels only allocate a texture once they show text; the hover info
    // panel is one shared label that moves to whichever building is hovered)
    this.top = top;
    const ui = game.ui;
    this.nameLabel = new Label({ height: 0.009 * ui });
    this.nameLabel.mesh.position.y = top + 0.01 * ui;
    this.badge = new Label({ height: 0.011 * ui, font: 800 });
    this.badge.mesh.position.y = top + 0.026 * ui;
    this.badge.visible = false;
    this.root.add(this.nameLabel.mesh, this.badge.mesh);

    // DistanceDetectIndication
    const r = this.info?.detectDistance ?? 0;
    this.detectSphere = new THREE.Mesh(game.sphereGeometry, game.detectMaterial);
    this.detectSphere.scale.setScalar(Math.max(r, 0.001));
    this.detectSphere.visible = false;
    this.detectSphere.raycast = () => {};
    this.root.add(this.detectSphere);

    this.state = resource ? State.COMPLETE : State.WAITING;
    // Unity sets canScore=false on every BuildingBase in Start(), which also
    // switched resource nodes off ("working except resource scoring").
    // Resource nodes are scorable here so Excavator / Gas Extractor bonuses work.
    this.canScore = !!resource;
    this.currentCost = 0;
    this.displayState = true;
    this.initialPosition = this.root.position.clone();
    this.initialQuaternion = this.root.quaternion.clone();

    if (resource) {
      this.nameLabel.visible = false;
    } else {
      this.nameLabel.set(this.info.displayName);
    }
  }

  get grabbable() { return this.state !== State.COMPLETE && !this.tween; }

  // --- XRGrabInteractable events --------------------------------------
  onStartGrab() {
    if (this.state === State.COMPLETE) return false;
    this.cancelTween();
    if (this.state === State.WAITING) this.state = State.ONGOING;
    this.onHoverEnd();
    this.detectSphere.visible = true;
    return true;
  }

  onRelease() {
    if (this.state !== State.ONGOING) return;
    this.detectSphere.visible = false;
    const money = this.game.money;
    if (this.currentCost !== -1 && money.has(this.currentCost)) {
      money.spend(this.currentCost);
      this.nameLabel.visible = false;
      this.state = State.COMPLETE;
      this.harvestScore();
      this.game.cancelAllBadges();
      this.canScore = true;
      this.game.sfx('build');
      this.game.hand.buildOne();
    } else {
      this.setDisplayState(true);
      this.resetToWaiting();
      this.game.sfx('fail');
    }
  }

  onHoverStart() {
    if (this.state !== State.WAITING) return;
    const lines = [this.info.displayName];
    for (const [k, v] of Object.entries(this.info.scoring)) {
      lines.push(`${this.game.data.buildingInfo[k]?.displayName ?? k} ${v > 0 ? '+' : ''}${v}`);
    }
    const panel = this.game.infoPanel;
    panel.set(lines.join('\n'));
    panel.mesh.position.set(0, this.top + 0.024 * this.game.ui, 0);
    this.root.add(panel.mesh);
    panel.visible = true;
  }

  onHoverEnd() {
    const panel = this.game.infoPanel;
    if (panel.mesh.parent === this.root) panel.visible = false;
  }

  // --- per-frame -------------------------------------------------------
  update() {
    if (this.state !== State.ONGOING) return;
    let canBuild = true;
    let total = 0;
    for (const beam of this.beams) {
      const len = this.calculateSupportBeam(beam);
      if (len === -1) canBuild = false;
      total += len;
    }
    const money = this.game.money;
    if (!canBuild) {
      this.currentCost = -1;
      this.nameLabel.set('can not build here', { fg: '#ff5a5a' });
      this.setDisplayState(false);
    } else {
      this.currentCost = Math.trunc(total * 100);
      const affordable = this.currentCost <= money.amount;
      this.setDisplayState(affordable);
      this.nameLabel.set(`cost: ${this.currentCost}`, { fg: affordable ? '#ffffff' : '#ff5a5a' });
    }
    this.calculateScoring(false);
  }

  // SupportBeam.CalculateSupportBeam
  calculateSupportBeam(beam) {
    const game = this.game;
    beam.holder.getWorldPosition(tmpV);
    // terrain: O(1) lookup on the baked heightfield (board space = game units)
    game.board.worldToLocal(tmpV2.copy(tmpV));
    const ground = game.assets.heightfield.at(tmpV2.x, tmpV2.z);
    let distance = tmpV2.y >= ground ? tmpV2.y - ground : Infinity;
    // other buildings and resource nodes: a short ray (in world units)
    const k = game.board.scale.y;
    const ray = game.raycaster;
    ray.set(tmpV, DOWN);
    ray.near = 0;
    ray.far = Math.min(this.maxBeamLength, distance) * k;
    const hit = ray.intersectObjects(game.obstacleTargets(this), false)[0];
    if (hit) distance = hit.distance / k;
    this.adjustBeam(beam, distance);
    return distance > this.maxBeamLength ? -1 : distance;
  }

  adjustBeam(beam, height) {
    const h = Math.min(height, this.maxBeamLength);
    beam.length = h;
    beam.body.visible = h > 0.0005;
    beam.body.scale.set(1, h, 1);
    beam.body.position.y = -h / 2;
    beam.body.material = height > this.maxBeamLength ? this.game.beamErrorMaterial : this.game.beamMaterial;
  }

  setDisplayState(ok, force = false) {
    if (!force && this.displayState === ok) return;
    this.displayState = ok;
    if (!ok && !this.error) {
      this.error = this.game.assets.instance(this.modelName, { error: true });
      this.root.add(this.error);
    }
    this.regular.visible = ok;
    if (this.error) this.error.visible = !ok;
  }

  resetToWaiting() {
    this.state = State.WAITING;
    for (const beam of this.beams) this.adjustBeam(beam, 0);
    this.nameLabel.set(this.info.displayName);
    this.game.cancelAllBadges();
    this.tweenTo(this.initialPosition, this.initialQuaternion, 0.5);
  }

  // ScoringIdentifier.CalculateScoring
  calculateScoring(harvest) {
    let sum = 0;
    const me = this.root.position;
    for (const other of this.game.buildings) {
      if (other === this || !other.canScore) continue;
      if (other.root.position.distanceTo(me) <= this.info.detectDistance) {
        const s = this.info.scoring[other.key] ?? 0;
        sum += s;
        other.showBadge(s, false);
        if (harvest) other.sendAndAddScore(s);
      } else {
        other.hideBadge();
      }
    }
    this.showBadge(sum, true);
    return sum;
  }

  harvestScore() { this.calculateScoring(true); }

  showBadge(score, active) {
    if (score === 0) return this.hideBadge();
    this.badge.set(`${score > 0 ? '+' : ''}${score}`, {
      bg: active ? 'rgba(255,196,0,0.95)' : 'rgba(35,40,60,0.85)',
      fg: active ? '#1b1b1b' : score > 0 ? '#9dff9d' : '#ff8080',
    });
    this.badge.visible = true;
  }

  hideBadge() { this.badge.visible = false; }

  sendAndAddScore(score) {
    this.hideBadge();
    if (score === 0) return;
    const fly = new Label({ height: 0.016, font: 800, bg: 'rgba(255,196,0,0.95)', fg: '#1b1b1b', depthTest: false, renderOrder: 20 });
    fly.set(`${score > 0 ? '+' : ''}${score}`);
    this.root.getWorldPosition(fly.mesh.position);
    fly.mesh.position.y += this.localBox.max.y + 0.03;
    this.game.scene.add(fly.mesh);
    const from = fly.mesh.position.clone();
    this.game.addTween({
      duration: 1,
      update: (t) => {
        const to = this.game.money.uiPosition(tmpV2);
        fly.mesh.position.lerpVectors(from, to, easeInOut(t));
      },
      done: () => {
        this.game.scene.remove(fly.mesh);
        fly.dispose();
        this.game.money.gain(score);
        this.game.sfx('coin');
      },
    });
  }

  tweenTo(pos, quat, duration) {
    const fromP = this.root.position.clone();
    const fromQ = this.root.quaternion.clone();
    this.tween = this.game.addTween({
      duration,
      update: (t) => {
        const e = easeOutQuad(t);
        this.root.position.lerpVectors(fromP, pos, e);
        this.root.quaternion.slerpQuaternions(fromQ, quat, e);
      },
      done: () => { this.tween = null; },
    });
  }

  cancelTween() {
    if (this.tween) this.tween.cancelled = true;
    this.tween = null;
  }

  dispose() {
    this.onHoverEnd();
    this.root.removeFromParent();
    this.nameLabel.dispose();
    this.badge.dispose();
  }
}

// ------------------------------------------------------------------ Game
export class Game {
  constructor({ data, assets, scene, terrain }) {
    this.data = data;
    this.assets = assets;
    this.scene = scene;
    this.terrain = terrain;
    this.events = new THREE.EventDispatcher();
    this.raycaster = new THREE.Raycaster();
    this.buildings = [];
    this.tweens = [];
    this.audio = null;

    // The sandbox board holds terrain, resources and buildings in game units
    // (Unity metres) and is shown at BOARD_SCALE in front of the player. Labels
    // on the board are scaled up by this.ui so they keep a readable size.
    this.board = new THREE.Group();
    this.board.name = 'Board';
    this.board.scale.setScalar(BOARD_SCALE);
    this.ui = 1 / BOARD_SCALE;
    this.board.add(terrain);
    scene.add(this.board);
    const layout = assets.board;
    let maxH = 0;
    for (const h of assets.heightfield.h) maxH = Math.max(maxH, h);
    this.boardTop = maxH;
    // hand row: just outside the near (+z) edge, a little above the terrain
    this.spawnCenter = new THREE.Vector3(0, maxH + 0.08, layout.depth / 2 + 0.12);

    this.beamGeometry = new THREE.CylinderGeometry(0.003, 0.003, 1, 6);
    this.beamMaterial = new THREE.MeshLambertMaterial({ color: 0xc8cdd8, emissive: 0x404448 });
    this.beamErrorMaterial = new THREE.MeshLambertMaterial({ color: 0xff4a4a, emissive: 0x601010 });
    this.sphereGeometry = new THREE.SphereGeometry(1, 24, 12);
    this.detectMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.61, 0.82, 0.59), transparent: true, opacity: 0.12, depthWrite: false,
    });
    this.boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.colliderMaterial = new THREE.MeshBasicMaterial({ visible: false });
    this.gasGeometry = new THREE.SphereGeometry(1, 8, 6);
    this.infoPanel = new Label({ height: 0.0085 * this.ui, bg: 'rgba(255,255,255,0.92)', fg: '#1b2030', renderOrder: 12 });
    this.infoPanel.visible = false;

    this.group = this.board; // buildings live on the board
    this._grab = [];
    this._solid = [];

    this.money = new MoneyManager(this, data.startingMoney);
    // budget sign floating over the far edge of the sandbox
    this.money.anchor.position.set(0, maxH + 0.32, -layout.depth / 2 - 0.02);
    this.board.add(this.money.anchor);

    this.hand = new HandManager(this);

    for (const res of layout.resources) this.addBuilding(new Building(this, res.type, { resource: res }));
    this.mergeResourceVisuals();
  }

  start() { this.hand.refresh(); }

  restart() {
    for (const b of [...this.buildings]) {
      if (!b.isResource) {
        b.dispose();
        this.buildings.splice(this.buildings.indexOf(b), 1);
      }
    }
    this.tweens.length = 0;
    this.money.amount = this.data.startingMoney;
    this.money.updateUI();
    this.cancelAllBadges();
    this.hand.refresh();
  }

  addBuilding(b) {
    this.buildings.push(b);
    this.group.add(b.root);
  }

  /**
   * Resource nodes never move, so draw all of them as one mesh per material
   * (36 nodes -> a couple of draw calls). Their own meshes stay, hidden, for rays.
   */
  mergeResourceVisuals() {
    this.board.updateMatrixWorld(true);
    const toBoard = new THREE.Matrix4().copy(this.board.matrixWorld).invert();
    const buckets = new Map();
    for (const b of this.buildings) {
      if (!b.isResource) continue;
      b.regular.updateMatrixWorld(true);
      b.regular.traverse((o) => {
        if (!o.isMesh) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', o.geometry.attributes.position);
        g.setAttribute('normal', o.geometry.attributes.normal);
        if (o.geometry.index) g.setIndex(o.geometry.index);
        const baked = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(toBoard.clone().multiply(o.matrixWorld));
        if (!buckets.has(o.material)) buckets.set(o.material, []);
        buckets.get(o.material).push(baked);
      });
      b.regular.visible = false;
    }
    for (const [material, geos] of buckets) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = 'Resources';
      mesh.raycast = () => {};
      this.board.add(mesh);
    }
  }

  /** Place the board: world position of its centre (at its base) and a yaw. */
  placeBoard(position, yaw) {
    this.board.position.copy(position);
    this.board.rotation.set(0, yaw, 0);
    this.board.updateMatrixWorld(true);
  }

  /** Move a building to a world position (converted to board space). */
  setWorldPosition(b, worldPos) {
    b.root.position.copy(this.board.worldToLocal(tmpV.copy(worldPos)));
  }

  // The two lists below are rebuilt into reused arrays (no per-frame garbage).
  grabbables() {
    const out = this._grab;
    out.length = 0;
    for (const b of this.buildings) if (b.grabbable) out.push(b.collider);
    return out;
  }

  /** Things other than terrain a support beam can stand on: resource nodes and finished buildings. */
  obstacleTargets(except) {
    const out = this._solid;
    out.length = 0;
    for (const b of this.buildings) {
      if (b !== except && b.state === State.COMPLETE) for (const m of b.solids) out.push(m);
    }
    return out;
  }

  /** Everything a building can rest on, including the terrain mesh (mouse dragging). */
  groundTargets(except) {
    return [...this._flatten([this.terrain]), ...this.obstacleTargets(except)];
  }

  _flatten(list) {
    const out = [];
    for (const o of list) o.traverse((c) => c.isMesh && out.push(c));
    return out;
  }

  cancelAllBadges() { for (const b of this.buildings) b.hideBadge(); }

  addTween(t) {
    t.elapsed = 0;
    this.tweens.push(t);
    return t;
  }

  sfx(name) { this.audio?.play(name); }

  update(dt) {
    for (const b of this.buildings) b.update(dt);
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const t = this.tweens[i];
      if (t.cancelled) { this.tweens.splice(i, 1); continue; }
      t.elapsed += dt;
      const k = Math.min(t.elapsed / t.duration, 1);
      t.update(k);
      if (k >= 1) {
        this.tweens.splice(i, 1);
        t.done?.();
      }
    }
  }
}

function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }
function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

// Stand-in for the Unity VFX Graph gas plume: one rising, fading puff (cheap on Specs).
function makeGasVfx(game) {
  const group = new THREE.Group();
  const puffs = [0].map((phase) => {
    const m = new THREE.Mesh(game.gasGeometry, new THREE.MeshBasicMaterial({
      color: 0x9cf5c4, transparent: true, opacity: 0.5, depthWrite: false,
    }));
    m.raycast = () => {};
    group.add(m);
    return { m, phase };
  });
  group.userData.update = (time) => {
    for (const p of puffs) {
      const t = (time * 0.35 + p.phase) % 1;
      p.m.position.set(0, 0.005 + t * 0.06, 0);
      p.m.scale.setScalar(0.005 + t * 0.01);
      p.m.material.opacity = 0.5 * (1 - t);
    }
  };
  group.userData.animated = true;
  return group;
}
