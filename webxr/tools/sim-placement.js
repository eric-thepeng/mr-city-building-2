// Placement bot for balance testing. Paste into the browser console on the running game
// (it uses window.__game), then: await __simRun({ games: 10, hands: 24, strategy: 'greedy', patch: {...} })
//
// It plays real games through the game's own rules (overlap, support beams, cost, scoring,
// milestones, packs, clouds). Only the choice of where to put each building is the bot's:
//   greedy  the spot with the best (score - beam cost) for the best building in the hand
//   casual  a random spot that does not lose points (the best spot if every spot loses)
// `patch` adds scoring entries for the run only, e.g. { LivingPod: { Factory: -4 } }.
// `price: { start, rise }` charges for every hand after the first (the "buy a hand" proposal);
// the game then ends as "broke" when the budget cannot pay for the next hand.
// Returns averages per hand, per building type, and how the games ended.
window.__simRun = async function (cfg) {
  const g = window.__game;
  const info = g.data.buildingInfo;
  const hf = g.assets.heightfield;
  const L = g.assets.board;
  const saved = {};
  for (const [k, add] of Object.entries(cfg.patch || {})) {
    saved[k] = { ...info[k].scoring };
    Object.assign(info[k].scoring, add);
  }
  const step = cfg.step || 0.06;
  const COMPLETE = g.buildings.find((b) => b.isResource).state;
  const price = cfg.price || null; // { start, rise }: what a hand after the first costs

  const scoreAt = (b) => {
    let sum = 0;
    const me = b.root.position;
    for (const o of g.buildings) {
      if (o === b || !o.canScore) continue;
      if (o.root.position.distanceTo(me) <= b.info.detectDistance) sum += b.info.scoring[o.key] ?? 0;
    }
    const alt = b.info.altitude;
    if (alt) sum += Math.max(0, Math.floor((me.y - g.groundBase) / alt.per)) * alt.points;
    return sum;
  };
  const evalAt = (b, x, y, z) => {
    b.root.position.set(x, y, z);
    b.root.updateMatrixWorld(true);
    b.blockedBy = null;
    if (b.findOverlap()) return null;
    let total = 0;
    for (const beam of b.beams) {
      const len = b.calculateSupportBeam(beam);
      if (len === -1) return null;
      total += len;
    }
    const cost = Math.trunc(total * (b.def.beamCost ?? 100));
    if (cost > g.money.amount) return null;
    const score = scoreAt(b);
    return { x, y, z, cost, score, net: score - cost };
  };
  const candidates = (b) => {
    const out = [];
    const anchors = b.def.beams;
    const mb = b.maxBeamLength;
    const jx = (Math.random() - 0.5) * step;
    const jz = (Math.random() - 0.5) * step;
    for (let x = -L.width / 2 + 0.05 + jx; x <= L.width / 2 - 0.05; x += step) {
      for (let z = -L.depth / 2 + 0.05 + jz; z <= L.depth / 2 - 0.05; z += step) {
        let base = -Infinity;
        for (const a of anchors) base = Math.max(base, hf.at(x + a[0], z + a[2]) - a[1]);
        for (const lift of [0.001, mb * 0.45, mb * 0.9]) {
          const c = evalAt(b, x, base + lift, z);
          if (c) out.push(c);
        }
      }
    }
    // on top of finished platforms
    for (const p of g.buildings) {
      if (p.isResource || p.state !== COMPLETE || !p.info.standOn) continue;
      const top = p.root.position.y + p.localBox.max.y;
      const ay = Math.min(...anchors.map((a) => a[1]));
      const c = evalAt(b, p.root.position.x, top - ay + 0.001, p.root.position.z);
      if (c) out.push(c);
    }
    return out;
  };
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const choose = (cands) => {
    if (!cands.length) return null;
    const best = cands.reduce((a, c) => (c.net > a.net ? c : a));
    if (cfg.strategy === 'casual') {
      const ok = cands.filter((c) => c.net >= (cfg.floor ?? 0)); // floor: -999 = any valid spot
      return ok.length ? pick(ok) : best;
    }
    return pick(cands.filter((c) => c.net === best.net));
  };

  const games = [];
  for (let n = 0; n < cfg.games; n++) {
    g.restart();
    g.update(1.3);
    const rec = { hands: [], end: 'limit', bought: 0 };
    for (let h = 0; h < cfg.hands; h++) {
      const s0 = g.progress.score;
      let spent = 0;
      const places = [];
      let left = g.buildings.filter((b) => !b.isResource && b.state !== COMPLETE);
      const preset = g.hand.preset?.name ?? '?';
      while (left.length && !g.over) {
        let chosen = null;
        const order = cfg.strategy === 'casual' ? [left[0]] : left;
        for (const b of order) {
          b.onStartGrab();
          const c = choose(candidates(b));
          if (c && (!chosen || c.net > chosen.c.net)) chosen = { b, c };
        }
        if (!chosen) { rec.end = 'stuck'; break; }
        const { b, c } = chosen;
        b.root.position.set(c.x, c.y, c.z);
        b.root.updateMatrixWorld(true);
        b.currentCost = c.cost;
        b.onRelease();
        g.update(1.3);
        spent += c.cost;
        places.push({ k: b.key, s: c.score, c: c.cost });
        left = left.filter((x) => x !== b);
      }
      rec.hands.push({ preset, ds: g.progress.score - s0, spent, budget: g.money.amount, places });
      if (g.over) { rec.end = 'over'; break; }
      if (rec.end === 'stuck') break;
      if (g.progress.awaitingHands) g.progress.closeNotice();
      const opts = g.progress.hands.filter((o) => o.preset);
      if (!opts.length) { rec.end = 'nohand'; break; }
      if (price) {
        const p = price.start + price.rise * rec.bought;
        if (g.money.amount < p) { rec.end = 'broke'; break; }
        g.money.spend(p);
        rec.bought++;
      }
      g.progress.pickHand(pick(opts).preset);
      g.update(0.1);
      await new Promise((r) => setTimeout(r, 0));
    }
    rec.score = g.progress.score;
    rec.budget = g.money.amount;
    games.push(rec);
  }
  for (const [k, s] of Object.entries(saved)) info[k].scoring = s;

  // summary
  const avg = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
  const byHand = [];
  for (let h = 0; h < cfg.hands; h++) {
    const hs = games.map((r) => r.hands[h]).filter(Boolean);
    if (!hs.length) break;
    byHand.push({ hand: h + 1, games: hs.length, score: avg(hs.map((x) => x.ds)), beams: avg(hs.map((x) => x.spent)), budget: avg(hs.map((x) => x.budget)) });
  }
  const byKey = {};
  let negative = 0;
  let placed = 0;
  for (const r of games) for (const hnd of r.hands) for (const p of hnd.places) {
    (byKey[p.k] ??= []).push(p.s - p.c);
    placed++;
    if (p.s - p.c < 0) negative++;
  }
  const allHands = games.flatMap((r) => r.hands);
  return {
    strategy: cfg.strategy,
    games: games.length,
    ends: games.reduce((o, r) => ((o[r.end] = (o[r.end] || 0) + 1), o), {}),
    handsPlayed: avg(games.map((r) => r.hands.length)),
    finalScore: avg(games.map((r) => r.score)),
    finalBudget: avg(games.map((r) => r.budget)),
    scorePerHand: avg(allHands.map((x) => x.ds)),
    netPerHand: avg(allHands.map((x) => x.ds - x.spent)),
    negativePlacements: `${negative} / ${placed}`,
    byKey: Object.fromEntries(Object.entries(byKey).map(([k, v]) => [k, { n: v.length, net: avg(v) }])),
    byHand,
  };
};
