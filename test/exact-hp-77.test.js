/**
 * Ticket #77 — PV réels des blocs recalculés par le serveur (server/blockHp.js, validateDepth).
 * - Le serveur rejoue le tirage du client à l'identique (vrai code public/js/blocks.js).
 * - Joueurs honnêtes simulés avec le vrai client (graine, n° de bloc, rerolls, sauvegardes perdues,
 *   sauvegarde pendant l'animation, rechargement, second appareil, saison suivante, anciens clients) :
 *   aucune profondeur perdue, en shadow comme en enforce.
 * - Client modifié au rythme de l'incident #74 : simulation avant / après.
 * - Triche sur les n° de blocs, la graine, les PV du bloc courant : bornée et journalisée (0 point).
 * Base temporaire hors server/data/ ; aucun serveur lancé.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const vm     = require('vm');

const ROOT = path.join(__dirname, '..');
const dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-exact-hp-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db           = require('../server/db');
const seasons      = require('../server/seasons');
const antibot      = require('../server/antibot');
const blockHp      = require('../server/blockHp');
const blockCatalog = require('../server/blockCatalog');

const T0 = Date.UTC(2026, 10, 5, 12, 0, 0);
const BASE_CFG = { depth_validation_enabled: 'true', depth_max_cps: '20', damage_budget_mode: 'enforce', antibot_mode: 'shadow' };
const SHADOW  = { ...BASE_CFG, exact_hp_mode: 'shadow' };
const ENFORCE = { ...BASE_CFG, exact_hp_mode: 'enforce' };
let seasonId, season2Id;
let userSeq = 0;

function newUser() {
  return db.getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(`xhp_${++userSeq}`, 'x').lastInsertRowid;
}
const secEvents = u => db.getDb().prepare('SELECT * FROM security_events WHERE user_id = ? ORDER BY id').all(u);
const riskRow   = u => db.getDb().prepare('SELECT * FROM risk_scores WHERE user_id = ?').get(u);
const OBS_TYPES = ['exact_hp_budget', 'block_hp_mismatch', 'block_seed_changed', 'block_seq_skips'];
/** Observations #77 : journalisées sans aucun point de risque. */
function assertZeroPoints(u) {
  for (const e of secEvents(u).filter(x => OBS_TYPES.includes(x.type))) {
    assert.strictEqual(e.score_after, e.score_before, `${e.type} a changé le score`);
  }
}

// ── Vrai code du client (blocks.js) ──────────────────────────────────────────

function loadClient() {
  const ctx = { Math: Object.create(Math), t: k => k, console };
  ctx.GameState = { upgrades: { luck: 0 }, relicBonuses: { hpReduction: 0, luckPct: 0 }, blockSeed: 0, blockSeq: 0 };
  vm.createContext(ctx);
  const code = fs.readFileSync(path.join(ROOT, 'public/js/blocks.js'), 'utf8');
  vm.runInContext(`${code}\n;this.Blocks = Blocks;`, ctx);
  return ctx;
}
const client = loadClient();

/** Générateur déterministe (mulberry32) pour les simulations. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Partie simulée avec le vrai client : chaque bloc est tiré par Blocks.spawn (graine + n°), chaque
 * sauvegarde est contrôlée par validateDepth avec la sauvegarde complète.
 * @param {object} o  secs, cps, damage, autoDps, hpReduction, seed, saveEvery, lost [[a,b[], rerollEvery,
 *                    luck, reloadAt [s] (bloc repris), midSaveEvery (sauvegarde pendant l'animation)
 * @param {Function} [tamper]  (save, sim) → save modifiée (client modifié)
 */
function play(userId, o, config, tamper = null, sid = seasonId) {
  const G = client.GameState, B = client.Blocks;
  G.blockSeed = o.seed ?? 12345;
  G.blockSeq = 0;
  G.relicBonuses.hpReduction = o.hpReduction ?? 0;
  G.upgrades.luck = o.luck ?? 0;
  client.Math.random = prng(o.seed ?? 12345);
  const sim = { depth: 1, maxDepth: 0, clicks: 0, manualBlocks: 0, autoBlocks: 0, rerolls: 0 };
  B.spawn(1);
  let destroyedPending = false;
  const hit = (dmg, manual) => {
    if (destroyedPending) { destroyedPending = false; B.spawn(sim.depth); }
    B.current.hp = Math.max(0, B.current.hp - dmg);
    if (B.current.hp === 0) {
      if (manual) sim.manualBlocks++; else sim.autoBlocks++;
      sim.depth++;
      sim.maxDepth = Math.max(sim.maxDepth, sim.depth);
      destroyedPending = true;          // le bloc suivant est tiré après l'animation
      if (!o.midSaveEvery) { destroyedPending = false; B.spawn(sim.depth); }
    }
  };
  const saves = [];
  const save = (t, extra = {}) => {
    if ((o.lost ?? []).some(([a, b]) => t >= a && t < b)) return;
    let data = {
      blockSeed: G.blockSeed, blockSeq: G.blockSeq, block: B.snapshot(), blockCatalog: 0,
      upgrades: { block_reroll: sim.rerolls }, ...extra,
    };
    const stats = { maxDepth: sim.maxDepth, manualClicks: sim.clicks, manualBlocks: sim.manualBlocks, autoBlocks: sim.autoBlocks, regularityScore: 0.2 };
    if (tamper) ({ data } = tamper({ data, stats, t }) ?? { data });
    const r = seasons.validateDepth(userId, sid, stats, config, 'sim', T0 + t * 1000, data);
    antibot.recordSignals(userId, sid, r.signals, { config, nowMs: T0 + t * 1000 });
    saves.push({ t, claimed: stats.maxDepth, accepted: r.acceptedDepth, exact: r.exactDepth, budget: r.budgetDepth, path: r.exactPath, signals: r.signals });
  };
  save(0);
  let carry = 0;
  for (let s = 1; s <= o.secs; s++) {
    carry += o.cps;
    const n = Math.floor(carry);
    carry -= n;
    for (let i = 0; i < n; i++) { sim.clicks++; hit(o.damage, true); }
    if (o.autoDps > 0) hit(o.autoDps, false);
    if (o.rerollEvery && s % o.rerollEvery === 0 && sim.rerolls < 99) {
      if (destroyedPending) { destroyedPending = false; B.spawn(sim.depth); }
      sim.rerolls++; B.spawn(sim.depth);           // reroll : nouveau n° à la même profondeur
    }
    if (o.reloadAt?.includes(s)) {
      // Rechargement : le bloc sauvegardé est repris (même n°), ou tiré à nouveau s'il était détruit
      const snap = B.snapshot();
      B.current = null;
      if (destroyedPending) { destroyedPending = false; }
      B.resume(snap, sim.depth);
    }
    if (s % (o.saveEvery ?? 12) === 0) save(s);
  }
  if (o.secs % (o.saveEvery ?? 12) !== 0) save(o.secs);
  return { saves, sim };
}

function assertNoLoss(saves, label) {
  for (const s of saves.slice(1)) {
    assert.strictEqual(s.accepted, s.claimed, `${label} : t=${s.t}s déclaré ${s.claimed} retenu ${s.accepted}`);
    assert.strictEqual(s.exact, s.claimed, `${label} : t=${s.t}s déclaré ${s.claimed} PV réels ${s.exact} (${s.path})`);
  }
}
const eventTypes = u => secEvents(u).map(e => e.type);

test.before(() => {
  db.initDb();
  blockCatalog.init();
  seasonId  = db.createSeason('Test #77', '2026-11-02 00:00:00', '2026-11-08 23:59:59', 'closed').id;
  season2Id = db.createSeason('Test #77 bis', '2026-11-09 00:00:00', '2026-11-15 23:59:59', 'closed').id;
});

test.after(() => {
  db.getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── Rejeu exact du tirage du client ──────────────────────────────────────────

test('PV recalculés = PV du client (réduction max), ≤ PV du client sinon — catalogue intégré et publié', () => {
  const G = client.GameState, B = client.Blocks;
  const builtin = blockHp.variantsFor(0).slice(0, 1);
  for (const seed of [1, 777, 0x7fffffff, 0xfffffffe, 3141592653]) {
    G.blockSeed = seed; G.blockSeq = 0;
    for (let i = 0; i < 400; i++) {
      const depth = 1 + ((i * 37) % 1500);
      G.relicBonuses.hpReduction = 0.5;
      const b = B.spawn(depth);
      assert.strictEqual(blockHp.blockHp(seed, b.seq, depth, builtin, 0.5), b.maxHp, `graine ${seed} n° ${b.seq} à ${depth} m`);
      G.blockSeq--; G.relicBonuses.hpReduction = 0.17;
      const b2 = B.spawn(depth);
      assert.ok(b2.maxHp >= blockHp.blockHp(seed, b2.seq, depth, builtin, 0.5));
    }
  }
  // Catalogue publié (étape B) appliqué tel que le client le reçoit
  const pub = blockCatalog.publicCatalog({ format: 2 });
  const saved = B.TYPES;
  assert.ok(B.applyCatalog(pub));
  try {
    G.blockSeed = 4242; G.blockSeq = 0; G.relicBonuses.hpReduction = 0.5;
    const vars = blockHp.variantsFor(pub.version);
    for (let i = 0; i < 500; i++) {
      const depth = 1 + ((i * 53) % 3000);
      const b = B.spawn(depth);
      const lb = blockHp.blockHp(4242, b.seq, depth, vars, 0.5);
      assert.ok(lb <= b.maxHp, `n° ${b.seq} à ${depth} m : ${lb} > ${b.maxHp}`);
    }
  } finally { B.TYPES = saved; B.catalogVersion = 0; }
});

test('PV réels : nettement plus stricts que la borne « bloc le plus faible » (rapport #74 : 5 à 7×)', () => {
  const vars = blockHp.variantsFor(0);
  let real = 0, min = 0;
  for (let d = 900; d < 1003; d++) { real += blockHp.blockHp(99, d, d, vars, 0.5); min += antibot.minBlockHp(d); }
  assert.ok(real / min > 3, `rapport PV réels / borne minimale à ~1 000 m : ${(real / min).toFixed(2)}`);
});

test('coût minimal avec sauts : jamais au-dessus du coût de la vraie suite, sauts bornés', () => {
  const vars = blockHp.variantsFor(0);
  const hp = (seq, d) => blockHp.blockHp(7, seq, d, vars, 0.5);
  // Suite réelle : 1 bloc sauté (reroll) à la 3ᵉ profondeur
  const seqs = [10, 11, 13, 14, 15];
  const real = seqs.reduce((s, q, j) => s + hp(q, 200 + j), 0);
  const w = blockHp.minCostWalk({ seed: 7, lowSeq: 10, skips: 1, from: 200, credit: real, target: 205, variants: vars, maxReduction: 0.5 });
  assert.strictEqual(w.depth, 205);
  assert.ok(w.spent <= real);
  // Sans saut, le coût minimal est exactement celui de la suite sans reroll
  const noSkip = [10, 11, 12, 13, 14].reduce((s, q, j) => s + hp(q, 200 + j), 0);
  const w0 = blockHp.minCostWalk({ seed: 7, lowSeq: 10, skips: 0, from: 200, credit: 1e12, target: 205, variants: vars, maxReduction: 0.5 });
  assert.strictEqual(w0.spent, noSkip);
});

// ── Joueurs honnêtes : aucune perte, en shadow et en enforce ─────────────────

for (const [label, cfg] of [['shadow', SHADOW], ['enforce', ENFORCE]]) {
  test(`honnête (${label}) : maximum théorique 12 coups/s × 25 dégâts + Auto-Dig max, réduction max, 20 min`, () => {
    const u = newUser();
    const { saves } = play(u, { secs: 1200, cps: 12, damage: 25, autoDps: 20, hpReduction: 0.5, seed: 101 }, cfg);
    assertNoLoss(saves, label);
    assert.ok(saves.at(-1).claimed > 150);
    assert.deepStrictEqual(eventTypes(u), []);
  });
}

test('honnête (enforce) : mobile 6 coups/s, pioche moyenne, sans relique, sauvegardes perdues 2 min', () => {
  const u = newUser();
  const { saves } = play(u, { secs: 900, cps: 6, damage: 9, autoDps: 3, seed: 202, lost: [[300, 420]] }, ENFORCE);
  assertNoLoss(saves, 'mobile');
  assert.deepStrictEqual(eventTypes(u), []);
});

test('honnête (enforce) : rerolls fréquents, Chance 12 (nature tirée avec Chance, PV sans)', () => {
  const u = newUser();
  const { saves, sim } = play(u, { secs: 1200, cps: 10, damage: 25, autoDps: 20, hpReduction: 0.5, seed: 303, rerollEvery: 15, luck: 12 }, ENFORCE);
  assert.ok(sim.rerolls >= 70);
  assertNoLoss(saves, 'rerolls');
  assert.deepStrictEqual(eventTypes(u), []);
});

test('honnête (enforce) : rafale de 30 rerolls entre deux sauvegardes', () => {
  const u = newUser();
  const { saves } = play(u, { secs: 600, cps: 10, damage: 25, autoDps: 20, hpReduction: 0.5, seed: 304, rerollEvery: 1, saveEvery: 30 }, ENFORCE);
  assertNoLoss(saves, 'rafale de rerolls');
});

test('honnête (enforce) : sauvegarde pendant l\'animation de destruction et rechargements de page', () => {
  const u = newUser();
  const { saves } = play(u, { secs: 900, cps: 11, damage: 20, autoDps: 10, hpReduction: 0.3, seed: 404, midSaveEvery: 1, saveEvery: 7, reloadAt: [100, 250, 251, 600] }, ENFORCE);
  assertNoLoss(saves, 'animation / rechargement');
  assert.deepStrictEqual(eventTypes(u), []);
});

test('honnête : second appareil (même sauvegarde), redémarrage du serveur (état en base), saison suivante', () => {
  const u = newUser();
  const a = play(u, { secs: 300, cps: 10, damage: 25, autoDps: 20, hpReduction: 0.5, seed: 505 }, ENFORCE);
  assertNoLoss(a.saves, 'appareil A');
  // Redémarrage : catalogues rechargés, l'état vient de la base
  blockCatalog.refreshAntibot();
  const row = db.getDepthTracking(u);
  assert.ok(JSON.parse(row.xhp_state).seed === 505);
  // Saison suivante : nouvelle ligne de suivi, aucune pénalité au départ
  const b = play(u, { secs: 300, cps: 10, damage: 25, autoDps: 20, hpReduction: 0.5, seed: 505 }, ENFORCE, null, season2Id);
  assertNoLoss(b.saves, 'saison suivante');
  assert.deepStrictEqual(eventTypes(u), []);
});

test('ancien client (sans bloc courant ni graine) : ancienne borne, aucune perte, simple observation', () => {
  const u = newUser();
  const { saves } = play(u, { secs: 600, cps: 12, damage: 25, autoDps: 20, hpReduction: 0.5, seed: 606 }, ENFORCE,
    ({ data }) => ({ data: { upgrades: data.upgrades } }));
  for (const s of saves.slice(1)) {
    assert.strictEqual(s.accepted, s.claimed);
    assert.strictEqual(s.path, 'min');
  }
  assert.deepStrictEqual(eventTypes(u), []);
  assert.strictEqual(riskRow(u), undefined, 'aucun score de risque créé ni modifié');
});

test('ligne de suivi antérieure à #77 (xhp_state NULL) : reprise à la profondeur retenue, sans perte', () => {
  const u = newUser();
  const a = play(u, { secs: 240, cps: 10, damage: 25, autoDps: 20, hpReduction: 0.5, seed: 707 }, { ...BASE_CFG, exact_hp_mode: 'off' });
  assert.strictEqual(db.getDepthTracking(u).xhp_state, null);
  // Déploiement de #77 en cours de partie : la suite continue depuis la même graine
  const G = client.GameState;
  const before = a.saves.at(-1).accepted;
  const r = seasons.validateDepth(u, seasonId, { maxDepth: before, manualClicks: a.sim.clicks, manualBlocks: a.sim.manualBlocks, autoBlocks: a.sim.autoBlocks },
    ENFORCE, 'sim', T0 + 250_000, { blockSeed: G.blockSeed, block: client.Blocks.snapshot(), upgrades: { block_reroll: 0 }, blockCatalog: 0 });
  assert.strictEqual(r.acceptedDepth, before);
  assert.strictEqual(r.exactDepth, before);
});

// ── Client modifié au rythme de l'incident #74 : avant / après ───────────────

/** Minutes nécessaires pour atteindre `depth` (retenue) ; null si jamais atteint. */
const minutesTo = (saves, depth) => { const s = saves.find(x => x.accepted >= depth); return s ? +(s.t / 60).toFixed(1) : null; };

test('incident #74 rejoué : client modifié 40 coups/s × 25 dégâts, 77 min — PV minimum vs PV réels', () => {
  const o = { secs: 77 * 60, cps: 40, damage: 25, autoDps: 20, hpReduction: 0.5, seed: 7474 };
  const before = play(newUser(), o, { ...BASE_CFG, exact_hp_mode: 'off' }).saves;
  const shadowUser = newUser();
  const shadow = play(shadowUser, o, SHADOW).saves;
  const after  = play(newUser(), o, ENFORCE).saves;
  const at = (saves, min) => saves.find(s => s.t >= min * 60)?.accepted;
  const table = [10, 30, 77].map(m => ({ min: m, claimed: before.find(s => s.t >= m * 60).claimed, before: at(before, m), after: at(after, m) }));
  console.log('[#77] avant / après (profondeur retenue) :', JSON.stringify(table),
    '— 1 003 m atteints en', minutesTo(before, 1003), 'min avant,', minutesTo(after, 1003), 'min après');
  // Shadow : la profondeur retenue ne change pas, l'écart est journalisé une fois (0 point)
  assert.deepStrictEqual(shadow.map(s => s.accepted), before.map(s => s.accepted));
  assert.ok(shadow.at(-1).exact < shadow.at(-1).accepted, `PV réels ${shadow.at(-1).exact} / retenu ${shadow.at(-1).accepted}`);
  assert.ok(eventTypes(shadowUser).includes('exact_hp_budget'), eventTypes(shadowUser).join(','));
  // Enforce : nettement plus lent que l'ancienne borne
  assert.ok(table[2].after < table[2].before * 0.8, `77 min : ${table[2].after} vs ${table[2].before}`);
  // … mais jamais moins qu'un joueur honnête au maximum théorique (12 coups/s) pendant la même durée
  const honest = play(newUser(), { ...o, cps: 12 }, ENFORCE).saves;
  assert.ok(table[2].after >= honest.at(-1).claimed, `${table[2].after} < honnête ${honest.at(-1).claimed}`);
});

test('sauvegardes forgées (profondeur déclarée sans jouer, n° cohérents) : avant / après', () => {
  const forge = config => {
    const u = newUser();
    const out = [];
    for (let t = 0; t <= 77 * 60; t += 12) {
      const depth = 1 + Math.floor(t * 3);                  // 3 m/s déclarés, 40 coups/s déclarés
      const stats = { maxDepth: depth, manualClicks: t * 40, manualBlocks: depth - 1, autoBlocks: 0, regularityScore: 0.2 };
      const save = { blockSeed: 31337, block: { name: 'block.pierre', hp: 5, maxHp: 99999, reward: 1, depth, seq: depth }, upgrades: { block_reroll: 0 }, blockCatalog: 0 };
      const r = seasons.validateDepth(u, seasonId, stats, config, 'forge', T0 + t * 1000, save);
      out.push({ t, accepted: r.acceptedDepth });
    }
    return out;
  };
  const before = forge({ ...BASE_CFG, exact_hp_mode: 'off' });
  const after  = forge(ENFORCE);
  const at = (saves, m) => saves.find(s => s.t >= m * 60).accepted;
  console.log('[#77] forgé, profondeur retenue à 10 / 30 / 77 min — avant', [10, 30, 77].map(m => at(before, m)),
    'après', [10, 30, 77].map(m => at(after, m)), '— 1 003 m en', minutesTo(before, 1003), 'min avant,', minutesTo(after, 1003), 'min après');
  assert.ok(minutesTo(after, 1003) > 2 * minutesTo(before, 1003));
});

// ── Triche sur les n° de blocs, la graine et les PV ──────────────────────────

test('client modifié : n° de blocs qui sautent vers une zone de blocs faibles → ignorés, journalisés', () => {
  const o = { secs: 1800, cps: 40, damage: 25, autoDps: 20, hpReduction: 0.5, seed: 8080 };
  const honestSeq = play(newUser(), o, ENFORCE).saves.at(-1).accepted;
  const u = newUser();
  let jump = 0;
  const { saves } = play(u, o, ENFORCE, ({ data }) => {
    jump += 500;
    return { data: { ...data, block: data.block && { ...data.block, seq: data.block.seq + jump }, upgrades: { block_reroll: 0 } } };
  });
  assert.ok(saves.at(-1).accepted <= honestSeq * 1.05, `${saves.at(-1).accepted} vs ${honestSeq}`);
  assert.ok(eventTypes(u).includes('block_seq_skips'));
  assertZeroPoints(u);
});

test('client modifié : bloc courant omis après l\'ancrage → suite du serveur conservée (pas de repli)', () => {
  const o = { secs: 1800, cps: 40, damage: 25, autoDps: 20, hpReduction: 0.5, seed: 9090 };
  const ref = play(newUser(), o, ENFORCE).saves.at(-1).accepted;
  const u = newUser();
  const { saves } = play(u, o, ENFORCE, ({ data, t }) => (t > 0 ? { data: { upgrades: data.upgrades } } : { data }));
  const minOnly = play(newUser(), o, { ...BASE_CFG, exact_hp_mode: 'off' }).saves.at(-1).accepted;
  assert.ok(saves.at(-1).accepted < minOnly * 0.8, `${saves.at(-1).accepted} vs borne minimale ${minOnly}`);
  assert.ok(saves.at(-1).accepted <= ref * 1.1, `${saves.at(-1).accepted} vs bloc déclaré ${ref}`);
  assert.strictEqual(secEvents(u).filter(e => e.type === 'block_seq_skips' && JSON.parse(e.details).missingBlock).length, 1);
  assertZeroPoints(u);
});

test('graine changée : 3 fois admises (repli sur la borne minimale), puis la graine épinglée est gardée', () => {
  const u = newUser();
  let n = 0;
  play(u, { secs: 900, cps: 40, damage: 25, autoDps: 20, hpReduction: 0.5, seed: 1111 }, ENFORCE,
    ({ data }) => ({ data: { ...data, blockSeed: 5000 + (++n) } }));
  const ev = secEvents(u).filter(e => e.type === 'block_seed_changed').map(e => JSON.parse(e.details));
  assert.deepStrictEqual(ev.map(d => d.accepted), [true, true, true, false]);
  assert.strictEqual(JSON.parse(db.getDepthTracking(u).xhp_state).seed, 5004);
  assertZeroPoints(u);
});

test('PV max du bloc courant falsifiés → block_hp_mismatch (une fois par bloc, 0 point)', () => {
  const u = newUser();
  play(u, { secs: 60, cps: 5, damage: 3, autoDps: 0, seed: 1212 }, SHADOW,
    ({ data }) => ({ data: { ...data, block: data.block && { ...data.block, maxHp: 1, hp: 1 } } }));
  const ev = secEvents(u).filter(e => e.type === 'block_hp_mismatch');
  assert.ok(ev.length >= 1);
  assert.strictEqual(new Set(ev.map(e => JSON.parse(e.details).seq)).size, ev.length);
  assertZeroPoints(u);
  assert.strictEqual(riskRow(u), undefined, 'aucun score de risque créé');
});

// ── Réglages ─────────────────────────────────────────────────────────────────

test('réglage exact_hp_mode : shadow par défaut, validé, coupé avec le budget de dégâts ou ANTIBOT=off', () => {
  assert.strictEqual(db.getAdminConfig().exact_hp_mode, 'shadow');
  assert.strictEqual(antibot.getExactHpMode({}), 'shadow');
  assert.strictEqual(antibot.getExactHpMode({ exact_hp_mode: 'enforce' }), 'enforce');
  assert.strictEqual(antibot.getExactHpMode({ exact_hp_mode: 'n/importe' }), 'shadow');
  assert.strictEqual(antibot.getExactHpMode({ exact_hp_mode: 'enforce', damage_budget_mode: 'off' }), 'off');
  assert.strictEqual(antibot.getExactHpMode({ exact_hp_mode: 'enforce' }, { ANTIBOT: 'off' }), 'off');
  assert.deepStrictEqual(antibot.validateConfigValue('exact_hp_mode', ' Enforce '), { value: 'enforce' });
  assert.ok(antibot.validateConfigValue('exact_hp_mode', 'max').error);
});

test('performance : une sauvegarde de client modifié (fenêtre large, sauts max) reste rapide', () => {
  const vars = blockHp.variantsFor(undefined);
  const t = process.hrtime.bigint();
  blockHp.minCostWalk({ seed: 3, lowSeq: 1, skips: blockHp.MAX_DP_SKIPS, from: 1, credit: 1e12, target: 600, variants: vars, maxReduction: 0.5 });
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  assert.ok(ms < 500, `${ms.toFixed(0)} ms`);
});
