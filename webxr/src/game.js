// Game rules, ported from the Unity scripts on `main`:
//   BuildingBase.cs, SupportBeam.cs, ScoringIdentifier.cs,
//   HandManager.cs, MoneyManager.cs, SO_BuildingIdentifier / SO_HandPreset.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Label } from './ui.js';
import { layerBoxes, overlap, poseOf, OVERLAP_TOL } from './collision.js';

export const State = Object.freeze({ WAITING: 'WAITING', ONGOING: 'ONGOING', COMPLETE: 'COMPLETE' });

// The whole sandbox (and every building) is shown at this fraction of the Unity size.
export const BOARD_SCALE = 0.5;
const DOWN = new THREE.Vector3(0, -1, 0);
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const poseA = {};
const poseB = {};

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
    this.label.set(`Budget: ${this.amount}`, { fg: this.amount < 0 ? '#ff6b6b' : '#ffe27a' });
    this.game.events.dispatchEvent({ type: 'money', amount: this.amount });
    if (this.amount < 0) this.game.endGame?.();
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

  /** Lines up a hand's buildings in the row at the front. */
  deal(preset) {
    this.preset = preset;
    this.built = 0;
    this.game.money.gain(preset.freeMoney);
    const spawn = this.game.spawnCenter;
    const spacing = this.game.data.buildingSpawn.spacing;
    const total = this.total;
    let i = 0;
    for (const [key, count] of Object.entries(preset.buildings)) {
      for (let n = 0; n < count; n++) {
        const pos = spawn.clone().setX(spawn.x + spacing * (i - (total - 1) / 2));
        this.game.addBuilding(new Building(this.game, key, { position: pos }));
        i++;
      }
    }
    this.game.events.dispatchEvent({ type: 'hand', preset });
  }

  /** The first hand of a game is random; after that the player picks one of two. */
  dealRandom() {
    const pool = this.game.progress.pool();
    this.deal(pool[Math.floor(Math.random() * pool.length)]);
  }

  buildOne() {
    this.built += 1;
    if (this.built < this.total) return;
    this.preset = null;
    this.game.progress.offerHands();
  }
}

// ------------------------------------------------------------------ Progress
// Score and milestones (shown on the budget sign), and the choice panel in the hand row:
// when a hand is used up the player picks the next one from two cards, in a framed panel
// where the hand stood, so it reads as a choice and not as buildings to drag.
// Milestones unlock a random building pack; its card joins the next choice.
// Score = every point placements earned, minus the ones they lost; the budget is separate.
// width of one building on a choice card, in board units (before game.ui)
const MODEL_SLOT = 0.066;
const SCORE_CARD_BG = 'rgba(18,30,52,0.96)';

class Progress {
  constructor(game) {
    this.game = game;
    this.unlockAll = false;
    const ui = game.ui;
    // --- on the budget sign: score, points to the next unlock, and short messages
    const sign = game.money.anchor;
    this.scoreLabel = new Label({ height: 0.02 * ui, bg: 'rgba(16,20,34,0.88)', fg: '#9fe0ff', font: 800, billboard: false });
    this.scoreLabel.mesh.position.set(0, 0.06 * ui, 0);
    this.untilLabel = new Label({ height: 0.012 * ui, bg: 'rgba(16,20,34,0.75)', fg: '#cfe9ff', billboard: false });
    this.untilLabel.mesh.position.set(0, 0.034 * ui, 0);
    this.message = new Label({ height: 0.014 * ui, bg: 'rgba(255,196,0,0.95)', fg: '#1b1b1b', font: 800, billboard: false });
    this.message.mesh.position.set(0, 0.095 * ui, 0);
    this.message.visible = false;
    sign.add(this.scoreLabel.mesh, this.untilLabel.mesh, this.message.mesh);

    // --- the choice panel, standing in the hand row in front of the player
    const anchor = this.anchor = new THREE.Group();
    anchor.name = 'Choice';
    anchor.position.copy(game.spawnCenter).setY(game.spawnCenter.y - 0.03);
    anchor.scale.setScalar(0.75); // it stands close to the player
    anchor.visible = false;
    game.board.add(anchor);
    this.frameBorder = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
      color: 0xffc400, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false,
    }));
    this.frameFill = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
      // writes depth, so badges and labels behind the panel don't show through it
      color: 0x10162a, transparent: true, opacity: 0.85, depthWrite: true, toneMapped: false,
    }));
    for (const [m, z] of [[this.frameBorder, -0.004], [this.frameFill, -0.003]]) {
      m.position.z = z * ui;
      m.renderOrder = 5;
      m.raycast = () => {};
      anchor.add(m);
    }
    // the panel stops pointers, so nothing behind it gets hovered or pressed through it
    this.frameFill.raycast = THREE.Mesh.prototype.raycast;
    this.frameFill.userData.building = { onHoverStart() {}, onHoverEnd() {}, onStartGrab: () => false };
    // score tooltip for the small buildings on the cards (the panel is scaled, so undo that)
    this.tip = new Label({
      height: (0.0085 / anchor.scale.x) * ui, bg: SCORE_CARD_BG, depthTest: false, renderOrder: 14,
    });
    this.tip.visible = false;
    this.tipOwner = null;
    this.title = new Label({ height: 0.013 * ui, bg: 'rgba(255,196,0,0.95)', fg: '#1b1b1b', font: 800, billboard: false, depthTest: false, renderOrder: 13 });
    anchor.add(this.title.mesh);
    // a card with small copies of buildings turning on top of it
    const card = (bg) => {
      const c = new Label({ height: 0.0105 * ui, bg, fg: '#ffffff', accent: '#ffe27a', align: 'left', billboard: false });
      c.visible = false;
      const models = new THREE.Group();
      models.visible = false;
      anchor.add(c.mesh, models);
      return { card: c, models };
    };
    this.notice = card('rgba(30,42,70,0.96)'); // only the Continue button closes it
    this.continueBtn = new Label({ height: 0.013 * ui, bg: 'rgba(45,108,223,0.95)', font: 800, billboard: false });
    this.continueBtn.mesh.raycast = THREE.Mesh.prototype.raycast;
    this.continueBtn.visible = false;
    anchor.add(this.continueBtn.mesh);
    game.addButton(this.continueBtn, () => this.closeNotice());
    this.hands = [0, 1].map(() => {
      const o = card('rgba(28,70,160,0.95)');
      o.preset = null;
      o.card.mesh.raycast = THREE.Mesh.prototype.raycast; // labels ignore rays by default
      game.addButton(o.card, () => { if (o.preset) this.pickHand(o.preset); });
      return o;
    });
    // buildings that were in the game before the expansion (their packs add bonuses to them)
    this.base = new Set(game.data.handPresets.flatMap((p) => Object.keys(p.buildings)));
    this.reset();
  }

  reset() {
    this.score = 0;
    this.level = 0;
    this.unlocked = new Set(this.unlockAll ? this.game.data.packs.map((p) => p.name) : []);
    this.fresh = []; // packs just unlocked: their card and first hand come with the next pick
    this.freshPick = null; // the pack whose hand joins the choice after its card is closed
    this.awaitingHands = false;
    this.messageUntil = 0;
    this.hideHands();
    this.closeNotice();
    this.refreshMessage();
    this.updateUI();
  }

  get nextAt() {
    const m = this.game.data.milestones;
    if (!m.length) return Infinity;
    return this.level < m.length ? m[this.level] : m[m.length - 1] + 80 * (this.level - m.length + 1);
  }

  /** Hand presets that can be dealt: Unity's, plus those of every unlocked pack. */
  pool() {
    const out = [...this.game.data.handPresets];
    for (const pack of this.game.data.packs) if (this.unlocked.has(pack.name)) out.push(...pack.presets);
    return out;
  }

  locked() { return this.game.data.packs.filter((p) => !this.unlocked.has(p.name)); }

  add(points) {
    this.score += points;
    while (this.score >= this.nextAt) {
      this.level++;
      this.reach();
    }
    this.updateUI();
  }

  /** A milestone: a random locked pack joins the deck (or, once all are in, some budget). */
  reach() {
    this.game.sfx('milestone');
    const locked = this.locked();
    if (!locked.length) {
      const n = this.game.data.milestoneBonus;
      this.game.money.gain(n);
      this.flash(`Milestone! +${n} budget`, 2.5);
      return;
    }
    const pack = locked[Math.floor(Math.random() * locked.length)];
    this.unlocked.add(pack.name);
    this.fresh.push(pack);
    this.flash(`Milestone! New pack: ${pack.displayName}`, 3);
    this.game.events.dispatchEvent({ type: 'pack', pack });
  }

  // --- card text ---------------------------------------------------------
  name(k) {
    // "LivingPod" -> "Living Pod"
    return (this.game.data.buildingInfo[k]?.displayName ?? k).replace(/([a-z])([A-Z])/g, '$1 $2');
  }

  /** The new buildings of a pack (the ones the base game does not have). */
  newBuildings(pack) {
    const keys = [...new Set(pack.presets.flatMap((p) => Object.keys(p.buildings)))];
    return keys.filter((k) => !this.base.has(k));
  }

  /** A table of what a building scores: what it likes on the left, what it dislikes on the right. */
  scoreTable(k) {
    const b = this.game.data.buildingInfo[k];
    const row = ([o, v]) => [this.name(o), `${v > 0 ? '+' : '\u2212'}${Math.abs(v)}`];
    const entries = Object.entries(b.scoring);
    const good = entries.filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]).map(row);
    const bad = entries.filter(([, v]) => v < 0).sort((x, y) => x[1] - y[1]).map(row);
    if (b.altitude) good.push([`Height per ${this.cm(b.altitude.per)} cm`, `+${b.altitude.points}`]);
    return good.length || bad.length ? { good, bad } : null;
  }

  cm(v) { return +(v * BOARD_SCALE * 100).toFixed(1); }

  /** The hover card of a building: name, range, score table, and its special rule. */
  scoreCard(k) {
    const b = this.game.data.buildingInfo[k];
    const blocks = [{ title: this.name(k) }];
    if (b.detectDistance > 0) blocks.push({ sub: `Range ${this.cm(b.detectDistance)} cm` });
    const table = this.scoreTable(k);
    if (table) blocks.push(table);
    if (b.note) blocks.push({ sub: b.note });
    return blocks;
  }

  /** The card of a new pack: each new building's table, what it adds to old ones, its hands. */
  describe(pack) {
    const info = this.game.data.buildingInfo;
    const fresh = this.newBuildings(pack);
    const blocks = [{ sub: pack.blurb ?? pack.summary }];
    for (const k of fresh) {
      const b = info[k];
      blocks.push({ heading: b.detectDistance > 0 ? `${this.name(k)} \u00b7 range ${this.cm(b.detectDistance)} cm` : this.name(k) });
      const table = this.scoreTable(k);
      if (table) blocks.push(table);
      if (b.note) blocks.push({ sub: b.note });
    }
    // old buildings that now earn next to the new ones
    const liked = [];
    for (const [k, b] of Object.entries(info)) {
      if (!this.base.has(k)) continue;
      for (const n of fresh) if ((b.scoring[n] ?? 0) > 0) liked.push([`${this.name(k)} near ${this.name(n)}`, `+${b.scoring[n]}`]);
    }
    if (liked.length) blocks.push({ heading: 'Also' }, { good: liked, bad: [] });
    blocks.push({ heading: 'Hands' });
    for (const p of pack.presets) blocks.push({ text: this.handLine(p) });
    return blocks;
  }

  handLine(preset) {
    return Object.entries(preset.buildings).map(([k, n]) => `${n > 1 ? `${n}× ` : ''}${this.name(k)}`).join(' + ');
  }

  /** Small copies of buildings on a card, fixed to it and turned 45 degrees. */
  fillModels(group, keys) {
    this.tip.mesh.removeFromParent();
    this.tip.visible = false;
    this.tipOwner = null;
    for (const c of [...group.children]) c.removeFromParent();
    const ui = this.game.ui;
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    const gap = MODEL_SLOT * ui;
    keys.forEach((k, i) => {
      const m = this.game.assets.instance(`block_${k}`);
      m.traverse((o) => { o.raycast = () => {}; }); // only the cards are buttons
      box.setFromObject(m, true);
      m.position.sub(box.getCenter(center)); // turn around its own middle
      // seen from one corner and 45 degrees above (the panel itself faces the player)
      const turn = new THREE.Group();
      turn.rotation.set(Math.PI / 4, Math.PI / 4, 0);
      turn.add(m);
      turn.updateMatrixWorld(true);
      // fit what the player actually sees, then stand it on the card
      box.setFromObject(turn, true);
      box.getSize(size);
      box.getCenter(center);
      const s = Math.min(1.3, (MODEL_SLOT * 0.92 * ui) / Math.max(size.x, 0.001), (0.056 * ui) / Math.max(size.y, 0.001));
      turn.scale.setScalar(s);
      turn.position.set(-center.x * s, -box.min.y * s, -center.z * s);
      const holder = new THREE.Group();
      holder.position.x = (i - (keys.length - 1) / 2) * gap;
      holder.add(turn);
      // an invisible box: pointing at it shows what this building scores
      const top = size.y * s;
      const hit = new THREE.Mesh(this.game.boxGeometry, this.game.colliderMaterial);
      hit.scale.set(gap * 0.95, top, 0.06 * ui);
      hit.position.y = top / 2;
      hit.userData.building = {
        onHoverStart: () => this.showTip(k, holder, top),
        onHoverEnd: () => { if (this.tipOwner === holder) this.tip.visible = false; },
        onStartGrab: () => false,
      };
      holder.userData.hit = hit;
      holder.add(hit);
      group.add(holder);
    });
  }

  showTip(k, holder, top) {
    const t = this.tip;
    t.setCard(this.scoreCard(k));
    t.mesh.position.set(0, top + 0.004 * this.game.ui + t.h / 2, 0.012 * this.game.ui);
    holder.add(t.mesh);
    this.tipOwner = holder;
    t.visible = true;
  }

  /** Adds what a pointer can hover on the panel: the frame and the buildings on the cards. */
  addHoverTargets(out) {
    if (!this.anchor.visible) return;
    out.push(this.frameFill);
    for (const o of [this.notice, ...this.hands]) {
      if (o.models.visible) for (const h of o.models.children) out.push(h.userData.hit);
    }
  }

  showNotice(pack) {
    const n = this.notice;
    n.pack = pack;
    n.card.setCard(this.describe(pack));
    this.fillModels(n.models, this.newBuildings(pack));
    n.card.visible = true;
    n.models.visible = true;
  }

  closeNotice() {
    const n = this.notice;
    n.pack = null;
    n.card.visible = false;
    n.models.visible = false;
    this.continueBtn.visible = false;
    if (this.awaitingHands) {
      // the new pack's card was its own step; now the hand choice
      this.awaitingHands = false;
      this.showHands();
      return;
    }
    this.layout();
  }

  // --- the choice ----------------------------------------------------------
  /** The hand is used up: offer two hands (a just-unlocked pack's hand is always one of them). */
  offerHands() {
    if (this.game.over) return;
    this.freshPick = this.fresh.shift() ?? null;
    if (this.freshPick) {
      // a pack was unlocked: show its card on its own first, the hands after "Continue"
      this.showNotice(this.freshPick);
      this.continueBtn.set('Continue');
      this.continueBtn.visible = true;
      this.awaitingHands = true;
      this.layout();
      return;
    }
    this.showHands();
  }

  showHands() {
    const picks = [];
    const freshPack = this.freshPick;
    this.freshPick = null;
    if (freshPack) picks.push({ preset: freshPack.presets[0], pack: freshPack });
    const pool = this.pool().filter((p) => !picks.some((q) => q.preset === p));
    while (picks.length < 2 && pool.length) picks.push({ preset: pool.splice(Math.floor(Math.random() * pool.length), 1)[0], pack: null });
    this.hands.forEach((o, i) => {
      const pick = picks[i];
      o.preset = pick?.preset ?? null;
      o.card.visible = !!pick;
      o.models.visible = !!pick;
      if (!pick) return;
      const p = pick.preset;
      const lines = [`#${p.name.replace('_', ' ')}${pick.pack ? ` · NEW (${pick.pack.displayName})` : ''}`];
      for (const [k, n] of Object.entries(p.buildings)) lines.push(`  ${n}× ${this.name(k)}`);
      if (p.freeMoney) lines.push(`  +${p.freeMoney} budget`);
      o.card.set(lines.join('\n'));
      this.fillModels(o.models, Object.keys(p.buildings));
    });
    this.choosing = true;
    this.layout();
  }

  pickHand(preset) {
    if (this.game.over) return;
    this.hideHands();
    this.closeNotice();
    this.game.sfx('build');
    this.game.hand.deal(preset);
  }

  hideHands() {
    this.choosing = false;
    for (const o of this.hands) {
      o.preset = null;
      o.card.visible = false;
      o.models.visible = false;
    }
    this.layout();
  }

  /** The game is over (budget below 0): clear the choice and say so on the sign. */
  gameOver() {
    this.awaitingHands = false;
    this.hideHands();
    this.closeNotice();
    this.refreshMessage();
  }

  /** Lays the visible cards out in a row (from their real sizes), with the title and a frame. */
  layout() {
    const ui = this.game.ui;
    const items = [this.notice, ...this.hands].filter((o) => o.card.wanted);
    this.anchor.visible = items.length > 0;
    if (!items.length) return;
    const gap = 0.012 * ui;
    const pad = 0.01 * ui;
    // each card gets a slot at least as wide as the row of models standing on it
    const slot = (o) => Math.max(o.card.w, o.models.children.length * MODEL_SLOT * ui);
    const total = items.reduce((a, o) => a + slot(o), 0) + gap * (items.length - 1);
    let x = -total / 2;
    let top = 0;
    // the Continue button under the new pack's card
    const btn = this.continueBtn;
    const btnH = btn.wanted ? btn.h + 0.008 * ui : 0;
    if (btn.wanted) btn.mesh.position.set(0, -btnH / 2, 0);
    for (const o of items) {
      const w = slot(o);
      const h = o.card.h;
      o.card.mesh.position.set(x + w / 2, h / 2, 0);
      // in front of the frame, so a turned building is never cut by it
      o.models.position.set(x + w / 2, h + 0.006 * ui, 0.04 * ui);
      x += w + gap;
      top = Math.max(top, h);
    }
    this.title.set(this.notice.pack ? `New pack unlocked: ${this.notice.pack.displayName}` : 'Pick your next hand');
    this.title.visible = true;
    const titleY = top + 0.08 * ui + this.title.mesh.scale.y / 2;
    this.title.mesh.position.set(0, titleY, 0);
    // the frame around everything
    const w = Math.max(total, this.title.mesh.scale.x) + pad * 2;
    const y0 = -pad - btnH;
    const y1 = titleY + this.title.mesh.scale.y / 2 + pad;
    const border = 0.003 * ui;
    const cy = (y0 + y1) / 2;
    const fill = roundedRect(new THREE.Shape(), w, y1 - y0, 0.01 * ui);
    const ring = roundedRect(new THREE.Shape(), w + border * 2, y1 - y0 + border * 2, 0.012 * ui);
    ring.holes.push(roundedRect(new THREE.Path(), w, y1 - y0, 0.01 * ui)); // a border, not a backing
    for (const [mesh, shape] of [[this.frameFill, fill], [this.frameBorder, ring]]) {
      mesh.geometry.dispose();
      mesh.geometry = new THREE.ShapeGeometry(shape, 4);
      mesh.position.y = cy;
    }
  }

  // --- the budget sign -------------------------------------------------------
  /** A short message above the score for a few seconds. */
  flash(text, seconds) {
    this.messageText = text;
    this.messageUntil = this.game.time + seconds;
    this.refreshMessage();
  }

  refreshMessage() {
    const m = this.message;
    if (this.game.over) {
      m.set('Game over · tap New game', { bg: 'rgba(214,58,58,0.95)', fg: '#ffffff' });
      m.visible = true;
    } else if (this.game.time < this.messageUntil) {
      m.set(this.messageText);
      m.visible = true;
    } else {
      m.visible = false;
    }
  }

  update(dt) {
    if (this.messageUntil && this.game.time >= this.messageUntil) {
      this.messageUntil = 0;
      this.refreshMessage();
    }
  }

  updateUI() {
    this.scoreLabel.set(`Score: ${this.score}`);
    const left = this.nextAt - this.score;
    this.untilLabel.set(`${left} until next ${this.locked().length ? 'unlock' : 'bonus'}`);
    this.game.events.dispatchEvent({ type: 'score', score: this.score, next: this.nextAt });
  }
}

/** Traces a rounded rectangle centred on the origin into a Shape or Path. */
function roundedRect(s, w, h, r) {
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
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
    this.isAir = !!resource?.air; // ice clouds: drawn on their own (they fade and move), never ground
    this.resource = resource;
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
    // Collision follows the model in layers (see collision.js); the box above stays for grabbing
    this.layers = resource ? [] : game.layersFor(this.modelName, this.regular, this.root);
    // what other buildings' beams can land on once this one is finished
    this.solids = [];
    // (clouds are not ground: beams pass through them)
    if (resource) { if (!resource.air) this.regular.traverse((o) => o.isMesh && this.solids.push(o)); }
    else if (!this.layers.length) this.solids.push(this.collider);
    for (const l of this.layers) {
      const solid = new THREE.Mesh(game.boxGeometry, game.colliderMaterial);
      solid.scale.set(l.x1 - l.x0, l.y1 - l.y0, l.z1 - l.z0);
      solid.position.set((l.x0 + l.x1) / 2, (l.y0 + l.y1) / 2, (l.z0 + l.z1) / 2);
      solid.userData.building = this;
      this.root.add(solid);
      this.solids.push(solid);
    }
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
      this.nameLabel.set(this.game.progress.name(this.key));
    }
  }

  get grabbable() { return this.state !== State.COMPLETE && !this.tween && !this.game.over; }

  // --- XRGrabInteractable events --------------------------------------
  onStartGrab() {
    if (this.state === State.COMPLETE) return false;
    this.cancelTween();
    if (this.state === State.WAITING) this.state = State.ONGOING;
    this.freeSpot = null; // the last carried position that cut into nothing
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
      this.pop();
      this.game.puff(this.root.position);
      this.game.tickClouds();
      this.game.hand.buildOne();
    } else {
      this.setDisplayState(true);
      this.resetToWaiting();
      this.game.sfx('fail');
    }
  }

  onHoverStart() {
    if (this.isResource) return this.showNodeTip();
    if (this.state === State.COMPLETE) return this.showTip(`#${this.game.progress.name(this.key)}`);
    if (this.state !== State.WAITING) return;
    const panel = this.game.infoPanel;
    panel.setCard(this.game.progress.scoreCard(this.key));
    // bottom edge just above the name label, so the panel grows upwards
    panel.mesh.position.set(0, this.top + 0.02 * this.game.ui + panel.mesh.scale.y / 2, 0);
    this.root.add(panel.mesh);
    panel.visible = true;
  }

  /** Tooltip on a resource node: what it is and which buildings earn next to it. */
  showNodeTip() {
    const game = this.game;
    const info = game.data.buildingInfo;
    const pool = new Set(game.progress.pool().flatMap((p) => Object.keys(p.buildings)));
    const lines = [`#${this.info.displayName}`];
    if (this.info.about) lines.push(this.info.about);
    const users = Object.entries(info)
      .filter(([, b]) => (b.scoring?.[this.key] ?? 0) > 0)
      .sort((a, b) => b[1].scoring[this.key] - a[1].scoring[this.key]);
    if (users.length) lines.push('#Build next to it:');
    for (const [k, b] of users) {
      const used = b.consumes?.includes(this.key) ? ', uses it up' : '';
      const locked = pool.has(k) ? '' : ' (not unlocked yet)';
      lines.push(`  ${game.progress.name(k)} +${b.scoring[this.key]}${used}${locked}`);
    }
    this.showTip(lines.join('\n'));
  }

  /** The tooltip above a resource node or a finished building. */
  showTip(text) {
    const panel = this.game.nodePanel;
    panel.set(text);
    panel.mesh.position.set(0, this.localBox.max.y + 0.01 * this.game.ui + panel.mesh.scale.y / 2, 0);
    this.root.add(panel.mesh);
    panel.visible = true;
  }

  onHoverEnd() {
    for (const panel of [this.game.infoPanel, this.game.nodePanel]) {
      if (panel.mesh.parent === this.root) panel.visible = false;
    }
  }

  // --- per-frame -------------------------------------------------------
  update() {
    if (this.state !== State.ONGOING) return;
    let canBuild = true;
    let total = 0;
    this.blockedBy = null;
    this.overlaps = this.findOverlap();
    if (this.overlaps) canBuild = false;
    for (const beam of this.beams) {
      const len = this.calculateSupportBeam(beam);
      if (len === -1) canBuild = false;
      total += len;
    }
    const money = this.game.money;
    if (!canBuild) {
      this.currentCost = -1;
      // a beam would be longer than this building allows (too high, or over a cliff edge)
      this.nameLabel.set(this.overlaps
        ? `too close to ${this.game.progress.name(this.overlaps.building.key)}`
        : this.blockedBy
        ? `can't stand on ${this.game.progress.name(this.blockedBy.key)}`
        : `beams too long (max ${+(this.maxBeamLength * BOARD_SCALE * 100).toFixed(1)} cm)`, { fg: '#ff5a5a' });
      this.setDisplayState(false);
    } else {
      this.currentCost = Math.trunc(total * (this.def.beamCost ?? 100)); // money per game unit of beam
      const affordable = this.currentCost <= money.amount;
      this.setDisplayState(affordable);
      const lifted = this.lift > 0.001 ? ` · lifted ${+(this.lift * BOARD_SCALE * 100).toFixed(1)} cm` : '';
      this.nameLabel.set(`cost: ${this.currentCost}${lifted}`, { fg: affordable ? '#ffffff' : '#ff5a5a' });
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
    // a finished building that is not a platform: the beam may not stand on it
    const other = hit?.object.userData.building;
    if (other && !other.isResource && !other.info.standOn) {
      this.blockedBy = other;
      beam.body.material = this.game.beamErrorMaterial;
      return -1;
    }
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

  /**
   * The finished building this one cuts deepest into (touching is fine), as
   * { building, x, z, depth, up } (see collision.js overlap), or null.
   */
  findOverlap() {
    const me = poseOf(this.root, poseA);
    let worst = null;
    for (const b of this.game.buildings) {
      if (b === this || b.isResource || b.state !== State.COMPLETE) continue;
      const hit = overlap(this.layers, me, b.layers, poseOf(b.root, poseB));
      if (hit && (!worst || hit.depth > worst.depth)) worst = Object.assign(hit, { building: b });
    }
    return worst;
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
    // never animate back from a broken position (it would stay NaN and the building would vanish)
    const p = this.root.position;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) p.copy(this.initialPosition);
    for (const beam of this.beams) this.adjustBeam(beam, 0);
    this.nameLabel.set(this.game.progress.name(this.key));
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
        if (harvest) {
          other.sendAndAddScore(s);
          if (s > 0 && this.info.consumes?.includes(other.key)) this.game.depleteCloud(other, this);
        }
      } else {
        other.hideBadge();
      }
    }
    // some buildings (wind turbines) also earn for how high they stand above the valley floor
    const alt = this.info.altitude;
    if (alt) {
      const a = Math.max(0, Math.floor((me.y - this.game.groundBase) / alt.per)) * alt.points;
      sum += a;
      if (harvest && a) this.sendAndAddScore(a);
    }
    if (harvest) this.game.progress.add(sum);
    this.showBadge(sum, true);
    return sum;
  }

  harvestScore() { this.calculateScoring(true); }

  /** A quick squash-and-stretch when a building lands. */
  pop() {
    this.game.addTween({
      duration: 0.35,
      update: (t) => this.root.scale.setScalar(1 + 0.18 * Math.sin(Math.PI * t) * (1 - t)),
      done: () => this.root.scale.setScalar(1),
    });
  }

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
    const hf = assets.heightfield;
    let maxH = 0;
    let minH = Infinity;
    let nearH = 0; // highest point of the near rows, under the hand row
    hf.h.forEach((h, k) => {
      maxH = Math.max(maxH, h);
      minH = Math.min(minH, h);
      if (Math.floor(k / hf.nx) >= hf.nz - 6) nearH = Math.max(nearH, h);
    });
    this.boardTop = maxH;
    // what "height" is measured from (a building standing on the valley floor is at 0)
    this.groundBase = minH + 0.02;
    // hand row: just outside the near (+z) edge, a little above the terrain there
    this.spawnCenter = new THREE.Vector3(0, nearH + 0.08, layout.depth / 2 + 0.12);

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
    // every gas puff is in step, so they all share one material
    this.gasMaterial = new THREE.MeshBasicMaterial({ color: 0x9cf5c4, transparent: true, opacity: 0.55, depthWrite: false });
    this.infoPanel = new Label({ height: 0.0085 * this.ui, bg: SCORE_CARD_BG, depthTest: false, renderOrder: 14 });
    this.infoPanel.visible = false;
    this.nodePanel = new Label({
      height: 0.0085 * this.ui, bg: 'rgba(255,255,255,0.92)', fg: '#1b2030', accent: '#1d5fd1', align: 'left', renderOrder: 12,
    });
    this.nodePanel.visible = false;
    this.over = false; // budget fell below 0

    this.ringGeometry = new THREE.RingGeometry(0.6, 1, 24).rotateX(-Math.PI / 2);
    this.buttons = []; // in-world buttons, pressed by hands, controllers or the mouse (see addButton)
    this.time = 0;
    this.group = this.board; // buildings live on the board
    this._grab = [];
    this._solid = [];

    this.money = new MoneyManager(this, data.startingMoney);
    // budget sign floating over the far edge of the sandbox
    this.money.anchor.position.set(0, maxH + 0.32, -layout.depth / 2 - 0.02);
    this.board.add(this.money.anchor);

    this.progress = new Progress(this);
    this.hand = new HandManager(this);

    for (const res of layout.resources) this.addBuilding(new Building(this, res.type, { resource: res }));
    this.mergeResourceVisuals();
    this.clouds = this.buildings.filter((b) => b.isAir);
    this.clouds.forEach((c, i) => {
      c.home = c.root.position.clone();
      c.phase = i * 1.7;
    });
    this.reforms = []; // { cloud, wait }: used-up clouds, re-forming after `wait` more buildings
    this.gasVents = makeGasVents(this, this.buildings.filter((b) => b.resource?.vfx));
    this.board.add(this.gasVents);
  }

  start() { this.hand.dealRandom(); }

  /** Budget below 0: the game is lost. Waiting buildings can no longer be picked up. */
  endGame() {
    if (this.over) return;
    this.over = true;
    this.sfx('fail');
    this.progress.gameOver();
    this.events.dispatchEvent({ type: 'over', score: this.progress.score });
  }

  restart() {
    for (const b of [...this.buildings]) {
      if (!b.isResource) {
        b.dispose();
        this.buildings.splice(this.buildings.indexOf(b), 1);
      }
    }
    this.tweens.length = 0;
    this.over = false;
    this.money.amount = this.data.startingMoney;
    this.money.updateUI();
    for (const r of this.reforms) this.removeGhost(r.ghost);
    this.reforms.length = 0;
    for (const c of this.clouds) {
      c.root.position.copy(c.home);
      c.regular.rotation.y = 0;
      c.regular.scale.setScalar(1);
      c.regular.visible = true;
      c.depleted = false;
      c.canScore = true;
    }
    this.progress.reset();
    this.cancelAllBadges();
    this.hand.dealRandom();
  }

  addButton(label, onPress) {
    this.buttons.push({ label, mesh: label.mesh, onPress, hover: new Set(), down: false, k: 1 });
  }

  /** `owner` (the mouse or one hand) now points at `btn`, or at no button. */
  hoverButton(owner, btn) {
    for (const b of this.buttons) if (b !== btn) b.hover.delete(owner);
    btn?.hover.add(owner);
  }

  /** Buttons grow and brighten under a pointer, and shrink and darken while pressed. */
  updateButtons(dt) {
    for (const b of this.buttons) {
      if (!b.mesh.visible) {
        b.down = false;
        b.hover.clear();
        if (b.k !== 1) {
          b.k = 1;
          b.label.setPop(1);
          b.mesh.material.color.setScalar(1);
        }
        continue;
      }
      const on = b.hover.size > 0;
      const goal = b.down ? 0.94 : on ? 1.07 : 1;
      if (b.k !== goal) {
        b.k += (goal - b.k) * Math.min(1, dt * 22);
        if (Math.abs(goal - b.k) < 0.002) b.k = goal;
        b.label.setPop(b.k);
      }
      b.mesh.material.color.setScalar(b.down ? 0.78 : on ? 1.35 : 1);
    }
  }

  /** What a press can land on: visible buttons, and the choice panel that stops presses behind it. */
  buttonTargets() {
    const out = this._btn ??= [];
    out.length = 0;
    for (const b of this.buttons) if (b.mesh.visible) out.push(b.mesh);
    if (this.progress.anchor.visible) out.push(this.progress.frameFill);
    return out;
  }

  /**
   * A Weather Station took this cloud: it is pulled into the station and vanishes. A faint
   * outline shows where it will form again, with a countdown of buildings.
   */
  depleteCloud(c, by) {
    if (c.depleted) return;
    c.depleted = true;
    c.canScore = false;
    c.hideBadge();
    const from = c.root.position.clone();
    const to = by.root.position.clone();
    to.y += by.top;
    const spot = this.cloudSpot(c);
    const wait = 3;
    const ghost = this.cloudGhost(c, spot, wait);
    const entry = { cloud: c, wait, ghost };
    this.reforms.push(entry);
    this.sfx('cloud');
    this.addTween({
      duration: 1.3,
      update: (t) => {
        const e = t * t;
        c.root.position.lerpVectors(from, to, e);
        c.regular.scale.setScalar(1 - 0.97 * e);
        c.regular.rotation.y = t * 7;
      },
      done: () => {
        c.regular.visible = false;
        c.regular.rotation.y = 0;
        c.root.position.copy(spot);
        if (this.reforms.includes(entry)) ghost.visible = true;
      },
    });
  }

  /** A free spot in the air: above the terrain, away from the other clouds. */
  cloudSpot(c) {
    const hf = this.assets.heightfield;
    const p = new THREE.Vector3();
    const taken = [
      ...this.clouds.filter((o) => o !== c && !o.depleted).map((o) => o.root.position),
      ...this.reforms.map((r) => r.ghost.position),
    ];
    for (let tries = 0; tries < 40; tries++) {
      p.set(-0.5 + Math.random(), 0.26 + Math.random() * 0.3, -0.45 + Math.random() * 0.83);
      if (p.y > hf.at(p.x, p.z) + 0.12 && taken.every((q) => q.distanceTo(p) > 0.2)) break;
    }
    return p;
  }

  /** A see-through copy of the cloud and a "back in N builds" sign. */
  cloudGhost(c, spot, wait) {
    this.ghostMaterial ??= new THREE.MeshBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.4, depthWrite: false });
    const g = new THREE.Group();
    const model = this.assets.instance(c.modelName);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.material = this.ghostMaterial;
      o.raycast = () => {};
    });
    const label = new Label({ height: 0.011 * this.ui, bg: 'rgba(16,20,34,0.85)', fg: '#cfe9ff' });
    label.mesh.position.y = 0.045;
    g.add(model, label.mesh);
    g.userData.label = label;
    g.position.copy(spot);
    g.visible = false;
    this.board.add(g);
    this.setGhostText(g, wait);
    return g;
  }

  setGhostText(g, wait) {
    g.userData.label.set(`Cloud forms here in ${wait} build${wait > 1 ? 's' : ''}`);
  }

  removeGhost(g) {
    g.removeFromParent();
    g.userData.label.dispose();
  }

  tickClouds() {
    for (let i = this.reforms.length - 1; i >= 0; i--) {
      const r = this.reforms[i];
      if (--r.wait > 0) {
        this.setGhostText(r.ghost, r.wait);
        continue;
      }
      this.removeGhost(r.ghost);
      this.reformCloud(r.cloud, r.ghost.position);
      this.reforms.splice(i, 1);
    }
  }

  reformCloud(c, spot) {
    c.root.position.copy(spot);
    c.regular.visible = true;
    c.depleted = false;
    c.canScore = true;
    this.sfx('cloud');
    this.addTween({ duration: 1.2, update: (t) => c.regular.scale.setScalar(0.01 + 0.99 * easeOutQuad(t)) });
  }

  /** A dust ring where a building lands. */
  puff(pos) {
    const m = new THREE.Mesh(this.ringGeometry, new THREE.MeshBasicMaterial({ color: 0xffe9c4, transparent: true, opacity: 0.7, depthWrite: false }));
    m.position.copy(pos);
    m.position.y -= 0.02;
    m.raycast = () => {};
    this.board.add(m);
    this.addTween({
      duration: 0.5,
      update: (t) => { m.scale.setScalar(0.03 + 0.07 * t); m.material.opacity = 0.7 * (1 - t); },
      done: () => { m.removeFromParent(); m.material.dispose(); },
    });
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
      if (!b.isResource || b.isAir) continue;
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

  /** Collision layers of a model, made once and shared by every building that uses it. */
  layersFor(modelName, object, root) {
    const cache = (this._layers ??= new Map());
    if (!cache.has(modelName)) cache.set(modelName, layerBoxes(object, root));
    return cache.get(modelName);
  }

  /**
   * The lowest height (board space) a building can be at here: its support beam feet on the
   * terrain, or on finished buildings and nodes the beams may stand on, measured the way the
   * beams measure it. `fallback` is used where a foot is off the terrain.
   */
  restHeight(b, fallback = -Infinity) {
    const board = this.board;
    const k = board.scale.y;
    const hf = this.assets.heightfield;
    const solids = this.obstacleTargets(b);
    const probe = (this._probe ??= new THREE.Raycaster());
    b.root.updateMatrixWorld(true);
    let top = -Infinity;
    const feet = b.beams.length ? b.beams.map((beam) => beam.holder) : [b.root];
    for (const foot of feet) {
      foot.getWorldPosition(tmpV);
      board.worldToLocal(tmpV2.copy(tmpV));
      let h = hf.at(tmpV2.x, tmpV2.z);
      if (!Number.isFinite(h)) h = fallback;
      probe.set(tmpV.setY(board.position.y + 100 * k), DOWN); // board: only yawed and evenly scaled
      const hit = probe.intersectObjects(solids, false)[0];
      const on = hit?.object.userData.building;
      if (hit && (!on || on.isResource || on.info.standOn)) h = Math.max(h, (hit.point.y - board.position.y) / k);
      top = Math.max(top, h);
    }
    if (!Number.isFinite(top)) top = fallback;
    const beamDrop = b.beams.length ? -b.beams[0].holder.position.y : 0;
    // +0.001: resting exactly on the ground can read as just below it (float precision)
    return top + beamDrop + 0.001;
  }

  /**
   * Moves a carried building to worldPos, but never below its resting height and never into a
   * finished building: it is pushed out sideways (or, held in the air, up onto the roof it
   * touches), and if that does not free it, it stays at the last free spot nearby.
   * lift: a number rests it that high above the ground (mouse); null keeps the height it is
   * held at, but not lower than resting (hands and controllers).
   */
  carry(b, worldPos, lift = null, fallback = -Infinity) {
    const p = b.root.position;
    this.board.worldToLocal(p.copy(worldPos));
    let want = p.y;
    const settle = () => {
      const rest = this.restHeight(b, fallback);
      p.y = lift === null ? Math.max(want, rest) : rest + lift;
    };
    settle();
    const target = (this._carryTarget ??= new THREE.Vector3()).copy(p);
    let hit = b.findOverlap();
    for (let i = 0; hit && i < 4; i++) {
      const side = hit.depth - OVERLAP_TOL + 0.0005;
      if (lift === null && hit.up < side) {
        want = p.y + hit.up + 0.0005; // fully clear, so its beams land on that roof
      } else {
        p.x += hit.x * side;
        p.z += hit.z * side;
      }
      settle();
      hit = b.findOverlap();
    }
    if (!hit) (b.freeSpot ??= new THREE.Vector3()).copy(p);
    else if (b.freeSpot && b.freeSpot.distanceTo(target) < 0.3) p.copy(b.freeSpot);
  }

  /** What a pointer can hover: hand buildings, plus nodes, finished buildings and the choice panel (tooltips). */
  hoverables() {
    const out = this._hover ??= [];
    out.length = 0;
    for (const b of this.buildings) {
      if (b.grabbable || ((b.isResource || b.state === State.COMPLETE) && !b.depleted)) out.push(b.collider);
    }
    this.progress.addHoverTargets(out);
    return out;
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
    this.time += dt;
    for (const c of this.clouds) c.regular.position.y = Math.sin(this.time * 0.8 + c.phase) * 0.005;
    for (const b of this.buildings) b.update(dt);
    this.progress.update(dt);
    this.updateButtons(dt);
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
/**
 * Gas vents: around each vent a few puffs drift back and forth, and others rise into the
 * air, swell and thin out. All puffs on the board are one instanced mesh (one draw call).
 */
function makeGasVents(game, vents) {
  const LOW = 4;
  const RISE = 2;
  const per = LOW + RISE;
  const mesh = new THREE.InstancedMesh(game.gasGeometry, game.gasMaterial, Math.max(1, vents.length * per));
  mesh.count = vents.length * per;
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  const homes = vents.map((v) => v.root.position.clone());
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  mesh.userData.animated = true;
  mesh.userData.update = (time) => {
    homes.forEach((home, v) => {
      const seed = v * 1.93;
      for (let i = 0; i < per; i++) {
        let size;
        if (i < LOW) {
          // the cloud itself: a few puffs churning around the vent mouth
          const a = time * (0.8 + 0.2 * i) + seed + i * 1.6;
          p.set(Math.sin(a) * 0.01, 0.008 + 0.003 * Math.sin(a * 1.7), Math.cos(a * 0.8) * 0.008);
          size = 0.012 + 0.003 * Math.sin(a * 1.3);
        } else {
          // now and then a small wisp drifts up a little and fades
          const t = (time * 0.22 + seed + (i - LOW) / RISE) % 1;
          p.set(Math.sin(time * 0.6 + seed + i) * 0.006 * t, 0.012 + t * 0.035, 0);
          size = (0.006 + 0.004 * t) * Math.min(1, (1 - t) * 2.5);
        }
        p.add(home);
        sc.setScalar(Math.max(size, 0.0001));
        mesh.setMatrixAt(v * per + i, m.compose(p, q, sc));
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  mesh.userData.update(0);
  return mesh;
}
