/**
 * Tests de la protection anti-bot, ticket #25 (lots A et B).
 * - Constantes du budget de dégâts vérifiées contre le code du client (public/js).
 * - Joueurs honnêtes simulés avec la physique réelle du jeu (PV des blocs, pioche, reliques,
 *   Auto-Dig, sauvegardes toutes les 12 s, sauvegardes perdues…) : aucune profondeur retenue
 *   en moins, aucun signal.
 * - Bots et requêtes forgées : profondeur bornée par le budget, signaux journalisés.
 * - Score de risque (plafonds, décroissance, mode off), télémétrie, routes admin, audit.
 * Base temporaire hors server/data/, serveur de test sur un port ≠ 3000.
 */

'use strict';

const test     = require('node:test');
const assert   = require('node:assert');
const crypto   = require('crypto');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const vm       = require('vm');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.DIG_TEST_PORT_ANTIBOT || '3131';
const BASE = `http://127.0.0.1:${PORT}`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-antibot-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db      = require('../server/db');
const seasons = require('../server/seasons');
const antibot = require('../server/antibot');

const CONFIG = { depth_validation_enabled: 'true', depth_max_cps: '20', damage_budget_mode: 'enforce', antibot_mode: 'shadow' };
const T0     = Date.UTC(2026, 9, 29, 12, 0, 0);
let seasonId;
let userSeq = 0;

function newUser() {
  const name = `ab_user_${++userSeq}`;
  return db.getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(name, 'x').lastInsertRowid;
}
const acLogs = u => db.getDb().prepare('SELECT * FROM anticheat_logs WHERE user_id = ? ORDER BY id').all(u);
const secEvents = u => db.getDb().prepare('SELECT * FROM security_events WHERE user_id = ? ORDER BY id').all(u);

// ── Code du client chargé tel quel (blocks, reliques, améliorations) ─────────

function loadClient() {
  const ctx = { Math: Object.create(Math), t: k => k, console };
  ctx.GameState = { upgrades: { luck: 0, autodig: 0 }, relicBonuses: { hpReduction: 0 }, relics: {}, pickaxeLevel: 1 };
  vm.createContext(ctx);
  for (const f of ['blocks.js', 'relics.js', 'upgrades.js']) {
    const code = fs.readFileSync(path.join(ROOT, 'public/js', f), 'utf8');
    const name = { 'blocks.js': 'Blocks', 'relics.js': 'Relics', 'upgrades.js': 'Upgrades' }[f];
    vm.runInContext(`${code}\n;this.${name} = ${name};`, ctx);
  }
  return ctx;
}
const client = loadClient();

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Simule une partie avec le vrai code de spawn du client (PV réels) et envoie une sauvegarde
 * toutes les `saveEvery` s à validateDepth. Retourne les sauvegardes (déclaré / retenu).
 * @param {object} o
 * @param {number} o.secs        Durée de jeu (s)
 * @param {number} o.cps         Clics/s (0 = Auto-Dig seul)
 * @param {number} o.damage      Dégâts par clic
 * @param {number} o.autoDps     Dégâts Auto-Dig par seconde
 * @param {number} o.hpReduction Réduction de PV (relique)
 * @param {boolean} o.weakest    true : toujours le bloc le plus faible (pire cas pour le serveur)
 * @param {number} [o.saveEvery] Intervalle entre sauvegardes (s)
 * @param {Array<[number, number]>} [o.lost] Fenêtres [début, fin[ sans sauvegarde réussie
 */
function simulate(userId, o, config = CONFIG) {
  const rand = rng(o.seed ?? 42);
  client.Math.random = rand;
  client.GameState.relicBonuses.hpReduction = o.hpReduction ?? 0;
  const B = client.Blocks;
  const pick = o.weakest
    ? depth => B.TYPES.filter(t => depth >= t.minDepth && depth <= t.maxDepth).sort((a, b) => a.hpBase - b.hpBase)[0]
    : depth => B._pickType(depth);
  const spawn = depth => {
    const type = pick(depth);
    const scale = 1 + (depth - 1) * 0.12;
    return Math.ceil(type.hpBase * scale * (1 - client.GameState.relicBonuses.hpReduction));
  };
  let depth = 1, maxDepth = 0, clicks = 0, manualBlocks = 0, autoBlocks = 0;
  let hp = spawn(depth);
  const hit = (dmg, manual) => {
    hp = Math.max(0, hp - dmg);
    if (hp === 0) {
      if (manual) manualBlocks++; else autoBlocks++;
      depth++;
      if (depth > maxDepth) maxDepth = depth;
      hp = spawn(depth);
    }
  };
  const saves = [];
  const every = o.saveEvery ?? 12;
  const save = t => {
    const lost = (o.lost ?? []).some(([a, b]) => t >= a && t < b);
    if (lost) return;
    const r = seasons.validateDepth(userId, seasonId,
      { maxDepth, manualClicks: clicks, manualBlocks, autoBlocks, regularityScore: 0.2 }, config, 'sim', T0 + t * 1000);
    antibot.recordSignals(userId, seasonId, r.signals, { config, nowMs: T0 + t * 1000 });
    saves.push({ t, claimed: maxDepth, accepted: r.acceptedDepth, action: r.action, signals: r.signals });
  };
  save(0);
  let carry = 0;
  for (let s = 1; s <= o.secs; s++) {
    carry += o.cps;
    const n = Math.floor(carry);
    carry -= n;
    for (let i = 0; i < n; i++) { clicks++; hit(o.damage, true); }
    if (o.autoDps > 0) hit(o.autoDps, false);
    if (s % every === 0) save(s);
  }
  if (o.secs % every !== 0) save(o.secs);
  return saves;
}

test.before(() => {
  db.initDb();
  seasonId = db.createSeason('Test anti-bot', '2026-10-26 00:00:00', '2026-11-01 23:59:59', 'closed').id;
});

test.after(() => {
  db.getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── Lot B : constantes conformes au jeu ──────────────────────────────────────

test('budget : dégâts max par clic et par seconde = valeurs max du client', () => {
  const up = id => client.Upgrades.DEFS.find(d => d.id === id);
  const relicMax = type => client.Relics.DEFS.filter(r => r.bonus.type === type)
    .reduce((s, r) => s + Math.max(...r.bonus.values), 0);
  assert.strictEqual(antibot.MAX_CLICK_DAMAGE, up('pickaxe').maxLevel + relicMax('damage_flat'));
  assert.strictEqual(antibot.MAX_AUTODIG_DPS, up('autodig').maxLevel + relicMax('autodig_bonus'));
  assert.ok(antibot.MAX_HP_REDUCTION >= Math.min(0.9, relicMax('hp_reduction')));
  // Une seule source de dégâts par type : clic (GameState.damage) et Auto-Dig (1 coup par seconde)
  const main = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
  assert.deepStrictEqual([...main.matchAll(/Blocks\.hit\(([^)]*)\)/g)].map(m => m[1]).sort(), ['GameState.damage', 'dmg']);
  assert.match(main, /setInterval\(autoDigTick,\s*1_000\)/);
});

test('budget : PV minimum serveur ≤ PV réels minimum du client à chaque profondeur (1–12 000 m)', () => {
  for (let d = 1; d <= 12_000; d++) {
    const types = client.Blocks.TYPES.filter(t => d >= t.minDepth && d <= t.maxDepth);
    const minBase = types.length ? Math.min(...types.map(t => t.hpBase)) : client.Blocks.TYPES[2].hpBase;
    const realMin = Math.ceil(minBase * (1 + (d - 1) * 0.12) * (1 - antibot.MAX_HP_REDUCTION));
    assert.ok(antibot.minBlockHp(d) <= realMin, `profondeur ${d} : ${antibot.minBlockHp(d)} > ${realMin}`);
    // Au-delà de 9 999 m, le client retombe sur la pierre (12) : borne volontairement plus lâche
    if (d <= 9999) assert.ok(antibot.minBlockHp(d) > realMin - 1, `profondeur ${d} : borne trop lâche`);
  }
  // Coût cumulé = somme des PV minimum, et recherche de profondeur cohérente
  let sum = 0;
  for (let d = 1; d < 500; d++) sum += antibot.minBlockHp(d);
  assert.ok(Math.abs(antibot.damageCost(1, 500) - sum) < 1e-6 * sum);
  const r = antibot.reachableDepth(1, sum, 10_000);
  assert.strictEqual(r.depth, 500);
});

test('budget : temps minimum théorique pour atteindre une profondeur (table de docs/ANTI-BOT.md)', () => {
  const rate = antibot.maxDamageRate(20);
  const mins = d => antibot.damageCost(1, d) / rate / 60;
  assert.ok(mins(1000) > 7 && mins(1000) < 9, `1000 m : ${mins(1000)} min`);
  assert.ok(mins(5000) > 180, `5000 m : ${mins(5000)} min`);
});

// ── Lot B : joueurs honnêtes (aucune perte) ──────────────────────────────────

function assertNoLoss(saves, label) {
  for (const s of saves.slice(1)) {
    assert.strictEqual(s.accepted, s.claimed, `${label} : t=${s.t}s déclaré ${s.claimed} retenu ${s.accepted}`);
  }
}

/**
 * Propriété de non-régression du lot B : la même partie, validée avec le budget (enforce) et
 * sans (#9 seul), donne la même profondeur retenue à CHAQUE sauvegarde, sans signal de budget.
 */
function assertBudgetNeutral(o, label) {
  const withBudget = newUser();
  const without    = newUser();
  const a = simulate(withBudget, o);
  const b = simulate(without, o, { ...CONFIG, damage_budget_mode: 'off' });
  assert.strictEqual(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    assert.strictEqual(a[i].accepted, b[i].accepted, `${label} : t=${a[i].t}s avec budget ${a[i].accepted}, sans ${b[i].accepted}`);
  }
  assert.ok(!acLogs(withBudget).some(l => l.action_taken === 'damage_capped'), label);
  assert.ok(!secEvents(withBudget).some(e => e.type === 'damage_budget'), label);
  return a;
}

test('honnête, maximum théorique : 20 clics/s, pioche 15 + relique, Auto-Dig 20, PV −50 %, blocs les plus faibles, 30 min', () => {
  const u = newUser();
  const saves = simulate(u, { secs: 1800, cps: 20, damage: 25, autoDps: 20, hpReduction: 0.5, weakest: true });
  assertNoLoss(saves, 'max');
  assert.ok(saves.at(-1).claimed > 600, `profondeur ${saves.at(-1).claimed}`);
  assert.deepStrictEqual(acLogs(u), []);
  assert.deepStrictEqual(secEvents(u), []);
  assertBudgetNeutral({ secs: 1800, cps: 20, damage: 25, autoDps: 20, hpReduction: 0.5, weakest: true, seed: 11 }, 'max (bis)');
});

test('honnête, joueur typique : 6 clics/s, pioche 5, sans relique, blocs aléatoires, Auto-Dig 3, 30 min', () => {
  const u = newUser();
  const saves = simulate(u, { secs: 1800, cps: 6, damage: 5, autoDps: 3, hpReduction: 0, weakest: false, seed: 7 });
  assertNoLoss(saves, 'typique');
  assert.deepStrictEqual(acLogs(u), []);
});

test('honnête, Auto-Dig seul au maximum pendant 8 h, onglet ouvert sans clic', () => {
  const u = newUser();
  const saves = simulate(u, { secs: 8 * 3600, cps: 0, damage: 25, autoDps: 20, hpReduction: 0.5, weakest: true });
  assertNoLoss(saves, 'autodig 8 h');
  assert.deepStrictEqual(secEvents(u), []);
});

test('honnête, Auto-Dig avec sauvegardes espacées (1/min, onglet en arrière-plan) : le budget ne change rien', () => {
  assertBudgetNeutral({ secs: 2 * 3600, cps: 0, damage: 25, autoDps: 20, hpReduction: 0.5, weakest: true, saveEvery: 60 }, 'autodig 1/min');
  assertBudgetNeutral({ secs: 2 * 3600, cps: 0, damage: 1, autoDps: 1, hpReduction: 0, weakest: false, saveEvery: 60, seed: 5 }, 'autodig faible');
});

test('honnête, clics + pauses : alternance 2 min de jeu / 3 min de pause, 1 h', () => {
  const u = newUser();
  // Pauses : le joueur ne clique pas (cps 0) mais l'Auto-Dig continue ; simulé par segments
  client.Math.random = rng(3);
  const saves = [];
  let state = null;
  // Rejoue la simulation avec un cps variable via des fenêtres
  const o = { secs: 3600, damage: 15, autoDps: 6, hpReduction: 0.3, weakest: true };
  const cpsAt = s => (Math.floor(s / 300) % 1 === 0 && s % 300 < 120 ? 9 : 0);
  // Simulation inline (cps variable)
  let depth = 1, maxDepth = 0, clicks = 0, mb = 0, ab = 0;
  const spawn = d => Math.ceil(Math.min(...client.Blocks.TYPES.filter(t => d >= t.minDepth && d <= t.maxDepth).map(t => t.hpBase)) * (1 + (d - 1) * 0.12) * (1 - o.hpReduction));
  let hp = spawn(1);
  const hit = (dmg, manual) => { hp = Math.max(0, hp - dmg); if (hp === 0) { manual ? mb++ : ab++; depth++; maxDepth = Math.max(maxDepth, depth); hp = spawn(depth); } };
  const save = t => {
    const r = seasons.validateDepth(u, seasonId, { maxDepth, manualClicks: clicks, manualBlocks: mb, autoBlocks: ab }, CONFIG, 'sim', T0 + t * 1000);
    saves.push({ t, claimed: maxDepth, accepted: r.acceptedDepth });
  };
  save(0);
  for (let s = 1; s <= o.secs; s++) {
    for (let i = 0; i < cpsAt(s); i++) { clicks++; hit(o.damage, true); }
    hit(o.autoDps, false);
    if (s % 12 === 0) save(s);
  }
  state = saves;
  assertNoLoss(state, 'pauses');
  assert.deepStrictEqual(secEvents(u), []);
});

test('honnête, réseau instable : 5 min sans sauvegarde réussie puis reprise — rattrapé, aucun signal', () => {
  const u = newUser();
  const saves = simulate(u, { secs: 1800, cps: 10, damage: 25, autoDps: 20, hpReduction: 0.5, weakest: true,
    lost: [[600, 900]] });
  // Les seaux de #9 rattrapent l'attente en quelques minutes ; le budget n'y ajoute rien
  assert.strictEqual(saves.at(-1).accepted, saves.at(-1).claimed, 'rattrapé à la fin');
  assertBudgetNeutral({ secs: 1800, cps: 10, damage: 25, autoDps: 20, hpReduction: 0.5, weakest: true, lost: [[600, 900]] }, 'coupure 5 min');
  assertBudgetNeutral({ secs: 3600, cps: 14, damage: 8, autoDps: 4, hpReduction: 0.1, weakest: false, seed: 9, lost: [[300, 1200], [2000, 2100]] }, 'coupures, blocs réels');
  assert.ok(!acLogs(u).some(l => l.action_taken === 'damage_capped' || l.action_taken === 'depth_rejected'), JSON.stringify(acLogs(u)));
  assert.ok(!secEvents(u).some(e => e.type === 'damage_budget'), JSON.stringify(secEvents(u)));
});

test('honnête, sauvegardes très rapprochées (toutes les 3 s) et très espacées (5 min)', () => {
  const u1 = newUser();
  assertNoLoss(simulate(u1, { secs: 900, cps: 12, damage: 20, autoDps: 10, hpReduction: 0.4, weakest: true, saveEvery: 3 }), '3 s');
  const u2 = newUser();
  const s2 = simulate(u2, { secs: 3600, cps: 1, damage: 25, autoDps: 20, hpReduction: 0.5, weakest: true, saveEvery: 300 });
  assertNoLoss(s2, '5 min');
  assertBudgetNeutral({ secs: 3600, cps: 8, damage: 25, autoDps: 20, hpReduction: 0.5, weakest: true, saveEvery: 300 }, '5 min, 8 clics/s');
});

test('honnête, 50 profils aléatoires (clics 0–20/s, équipement, blocs réels, sauvegardes 3–90 s, coupures) : budget neutre', () => {
  const r = rng(2026);
  for (let i = 0; i < 50; i++) {
    const lostStart = Math.floor(r() * 1500);
    const o = {
      secs: 1200 + Math.floor(r() * 1200),
      cps: Math.round(r() * 200) / 10,
      damage: 1 + Math.floor(r() * 25),
      autoDps: Math.floor(r() * 21),
      hpReduction: Math.floor(r() * 6) / 10,
      weakest: r() < 0.5,
      saveEvery: 3 + Math.floor(r() * 88),
      lost: r() < 0.5 ? [[lostStart, lostStart + Math.floor(r() * 600)]] : [],
      seed: i + 100,
    };
    assertBudgetNeutral(o, `profil ${i} ${JSON.stringify(o)}`);
  }
});

// ── Lot B : bots et requêtes forgées ─────────────────────────────────────────

/** Bot : compteurs cohérents pour #9 (≤ 20 clics/s, un bloc par clic) mais sans les dégâts. */
function forgedSteps(secs, every = 12) {
  const steps = [{ t: 0, clicks: 0, depth: 0 }];
  for (let t = every; t <= secs; t += every) steps.push({ t, clicks: 20 * t, depth: 1 + 20 * t });
  return steps;
}
function playSteps(u, steps, config = CONFIG) {
  return steps.map(s => {
    const r = seasons.validateDepth(u, seasonId,
      { maxDepth: s.depth, manualClicks: s.clicks, manualBlocks: s.clicks, autoBlocks: 0 }, config, 'bot', T0 + s.t * 1000);
    antibot.recordSignals(u, seasonId, r.signals, { config, nowMs: T0 + s.t * 1000 });
    return r;
  });
}

test('bot « cohérent » (20 clics/s, un bloc par clic sans dégâts) : profondeur bornée par le budget, journalisé une fois', () => {
  const u = newUser();
  const r = playSteps(u, forgedSteps(240));
  const last = r.at(-1);
  // Sans budget (#9 seul), ≈ 4 800 m en 4 min ; avec le budget : ce que 4 min de dégâts max permettent
  const credit = 240 * antibot.maxDamageRate(20);
  const bound  = antibot.reachableDepth(1, credit, 1e9).depth;
  assert.ok(last.acceptedDepth <= bound, `retenue ${last.acceptedDepth} > borne ${bound}`);
  assert.ok(last.acceptedDepth < 1000, `retenue ${last.acceptedDepth}`);
  const capped = acLogs(u).filter(l => l.action_taken === 'damage_capped');
  assert.strictEqual(capped.length, 1);
  const ev = secEvents(u).filter(e => e.type === 'damage_budget');
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(JSON.parse(ev[0].details).mode, 'enforce');
  // Aucune sanction : le score monte (preuve) mais rien n'est appliqué
  const risk = antibot.getRisk(u, seasonId, T0 + 240_000);
  assert.ok(risk.components.proof > 29, JSON.stringify(risk)); // preuve de 30 pts, à peine décrue
});

test('mode shadow : la profondeur retenue reste celle de #9, l\'écart est seulement journalisé', () => {
  const u = newUser();
  const cfg = { ...CONFIG, damage_budget_mode: 'shadow' };
  const r = playSteps(u, forgedSteps(240), cfg);
  const ref = newUser();
  const r9  = playSteps(ref, forgedSteps(240), { ...CONFIG, damage_budget_mode: 'off' });
  assert.strictEqual(r.at(-1).acceptedDepth, r9.at(-1).acceptedDepth);
  assert.ok(!acLogs(u).some(l => l.action_taken === 'damage_capped'));
  const ev = secEvents(u).filter(e => e.type === 'damage_budget');
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(JSON.parse(ev[0].details).mode, 'shadow');
  // Passage shadow → enforce : la profondeur déjà retenue n'est jamais retirée
  const before = r.at(-1).acceptedDepth;
  const next = seasons.validateDepth(u, seasonId, { maxDepth: before + 5000, manualClicks: 20 * 252, manualBlocks: 20 * 252, autoBlocks: 0 }, CONFIG, 'bot', T0 + 252_000);
  assert.ok(next.acceptedDepth >= before);
});

test('mode off et ANTIBOT=off : aucun budget', () => {
  assert.strictEqual(antibot.getDamageBudgetMode({ damage_budget_mode: 'off' }), 'off');
  assert.strictEqual(antibot.getDamageBudgetMode({}, { ANTIBOT: 'off' }), 'off');
  assert.strictEqual(antibot.getAntibotMode({ antibot_mode: 'shadow' }, { ANTIBOT: 'OFF' }), 'off');
  assert.strictEqual(antibot.getDamageBudgetMode({}), 'enforce');
  assert.strictEqual(antibot.getAntibotMode({}), 'shadow');
  assert.strictEqual(antibot.getDamageBudgetMode({ damage_budget_mode: 'n importe quoi' }), 'enforce');
});

test('bot qui attend puis déclare d\'un coup : crédit plafonné à 10 min de dégâts max', () => {
  const u = newUser();
  playSteps(u, [{ t: 0, clicks: 0, depth: 0 }]);
  // Une semaine plus tard, une seule sauvegarde : 20 jetons de clic max (seau #9) + crédit plafonné
  const r = seasons.validateDepth(u, seasonId, { maxDepth: 50_000, manualClicks: 400, manualBlocks: 400, autoBlocks: 50_000 }, CONFIG, 'bot', T0 + 7 * 86400_000);
  const cap = antibot.maxDamageRate(20) * antibot.DAMAGE_POOL_SECS;
  assert.ok(r.acceptedDepth <= antibot.reachableDepth(1, cap, 1e9).depth);
});

test('correction admin : la profondeur imposée sert aussi de base au budget', () => {
  const u = newUser();
  playSteps(u, forgedSteps(120));
  db.getDb().prepare('INSERT OR IGNORE INTO season_rankings (season_id, user_id, max_depth) VALUES (?, ?, 300)').run(seasonId, u);
  db.correctSeasonRanking(seasonId, u, { maxDepth: 10 });
  const t = db.getDepthTracking(u);
  assert.strictEqual(t.accepted_depth, 10);
  assert.strictEqual(t.dmg_depth, 10);
});

test('ligne de suivi antérieure à #25 (colonnes dmg_* NULL) : reprise à la profondeur retenue, sans pénalité', () => {
  const u = newUser();
  db.upsertDepthTracking(u, { season_id: seasonId, ref_clicks: 1000, ref_auto: 0, hand_tokens: 0, auto_tokens: 0,
    accepted_depth: 800, last_gap: 0, updated_ms: T0 });
  const t = db.getDepthTracking(u);
  assert.strictEqual(t.dmg_depth, null);
  // Jeu honnête qui reprend à 800 m : quelques mètres de plus en 12 s
  const r = seasons.validateDepth(u, seasonId, { maxDepth: 801, manualClicks: 1240, manualBlocks: 1, autoBlocks: 0 }, CONFIG, 'x', T0 + 12_000);
  assert.strictEqual(r.acceptedDepth, 801);
});

// ── Lot A : score de risque, signaux, télémétrie ─────────────────────────────

test('score : un seul type d\'indice ne dépasse jamais le niveau 1 ; preuves plus lourdes', () => {
  const u = newUser();
  for (let i = 0; i < 50; i++) antibot.recordSignals(u, seasonId, [{ type: 'cps_reduced' }], { config: CONFIG, nowMs: T0 + i * 12_000 });
  let r = antibot.getRisk(u, seasonId, T0 + 600_000);
  assert.ok(r.score <= antibot.CATEGORY_CAPS.cps + 1e-9 && r.level === 0, JSON.stringify(r));
  for (let i = 0; i < 50; i++) antibot.recordSignals(u, seasonId, [{ type: 'regular_clicks' }], { config: CONFIG, nowMs: T0 + 600_000 });
  r = antibot.getRisk(u, seasonId, T0 + 600_000);
  assert.ok(r.components.regularity <= 10);
  // Les événements ne sont plus écrits une fois le plafond atteint
  const n = secEvents(u).length;
  antibot.recordSignals(u, seasonId, [{ type: 'regular_clicks' }], { config: CONFIG, nowMs: T0 + 600_000 });
  assert.strictEqual(secEvents(u).length, n);
  antibot.recordSignals(u, seasonId, [{ type: 'forged_counters' }], { config: CONFIG, nowMs: T0 + 600_000 });
  r = antibot.getRisk(u, seasonId, T0 + 600_000);
  assert.ok(r.level >= 2, JSON.stringify(r));
  assert.ok(secEvents(u).some(e => e.type === 'risk_level' && JSON.parse(e.details).applied === false));
});

test('score : décroissance de moitié en 24 h ; mode off n\'enregistre rien', () => {
  const u = newUser();
  antibot.recordSignals(u, seasonId, [{ type: 'forged_counters' }], { config: CONFIG, nowMs: T0 });
  const a = antibot.getRisk(u, seasonId, T0).score;
  const b = antibot.getRisk(u, seasonId, T0 + 86400_000).score;
  assert.ok(Math.abs(b - a / 2) < 0.01, `${a} → ${b}`);
  const v = newUser();
  assert.strictEqual(antibot.recordSignals(v, seasonId, [{ type: 'forged_counters' }], { config: { antibot_mode: 'off' } }), null);
  assert.strictEqual(secEvents(v).length, 0);
});

test('compteurs forgés : négatifs, non entiers, démesurés, mauvais type', () => {
  assert.deepStrictEqual(antibot.forgedCounters({ maxDepth: 10, manualClicks: 30, manualBlocks: 5, autoBlocks: 0 }), []);
  assert.deepStrictEqual(antibot.forgedCounters({ maxDepth: -1, manualClicks: 1.5, manualBlocks: 2e9, autoBlocks: '3' }),
    ['maxDepth', 'manualClicks', 'manualBlocks', 'autoBlocks']);
});

test('télémétrie : souris, tactile multi-doigts et accessibilité régulière ne donnent pas plus que le niveau 0', () => {
  const human = antibot.normalizeTelemetry({ v: 1, n: 80, h: [0, 1, 3, 8, 20, 30, 12, 5], u: 0, p: { m: 80, t: 0, k: 0, o: 0 }, cv: 0.42 });
  assert.deepStrictEqual(antibot.telemetrySignals(human), []);
  // Tactile à deux doigts : quelques intervalles < 40 ms isolés
  const touch = antibot.normalizeTelemetry({ v: 1, n: 120, h: [20, 10, 15, 20, 25, 20, 7, 2], u: 0, p: { m: 0, t: 120, k: 0, o: 0 }, cv: 0.6 });
  assert.deepStrictEqual(antibot.telemetrySignals(touch), []);
  // Contacteur d'accessibilité à 5 clics/s, très régulier, longue durée : indice faible seulement
  const access = antibot.normalizeTelemetry({ v: 1, n: 600, h: [0, 0, 0, 0, 0, 599, 0, 0], u: 0, p: { m: 600, t: 0, k: 0, o: 0 }, cv: 0.01 });
  assert.deepStrictEqual(antibot.telemetrySignals(access).map(s => s.type), ['regular_clicks']);
  const u = newUser();
  for (let i = 0; i < 100; i++) antibot.recordSignals(u, seasonId, antibot.telemetrySignals(access), { config: CONFIG, nowMs: T0 + i * 12_000 });
  assert.strictEqual(antibot.getRisk(u, seasonId, T0 + 1_200_000).level, 0);
  // Script : clics non isTrusted, rafales < 40 ms
  const bot = antibot.normalizeTelemetry({ v: 1, n: 400, h: [399, 0, 0, 0, 0, 0, 0, 0], u: 400, p: { m: 0, t: 0, k: 0, o: 400 }, cv: 0.02 });
  assert.deepStrictEqual(antibot.telemetrySignals(bot).map(s => s.type).sort(), ['burst_clicks', 'regular_clicks', 'untrusted_clicks']);
  // Données illisibles : ignorées
  assert.strictEqual(antibot.normalizeTelemetry('x'), null);
  assert.strictEqual(antibot.normalizeTelemetry({ n: -3 }), null);
  assert.deepStrictEqual(antibot.normalizeTelemetry({ n: 5, h: [1, 2], u: 99 }), { n: 5, h: null, u: 5, p: null, cv: null });
});

test('client : la télémétrie est jointe aux sauvegardes cloud et chaque coup de pioche passe son événement', () => {
  const main = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
  assert.match(main, /telemetry: _telePayload\(tele\)/);
  assert.strictEqual((main.match(/onBlockHit\([^)]*, e\);/g) ?? []).length, 3);
  assert.match(main, /_teleRecord\(ev\)/);
});

test('validation des interrupteurs : enforce refusé pour antibot_mode (lot C non réalisé)', () => {
  assert.ok(antibot.validateConfigValue('antibot_mode', 'enforce').error);
  assert.deepStrictEqual(antibot.validateConfigValue('antibot_mode', ' Shadow '), { value: 'shadow' });
  assert.deepStrictEqual(antibot.validateConfigValue('damage_budget_mode', 'shadow'), { value: 'shadow' });
  assert.ok(antibot.validateConfigValue('damage_budget_mode', 'on').error);
  assert.strictEqual(antibot.validateConfigValue('gems_cap', '5'), null);
});

test('purge : seuls les événements de plus de 90 jours sont supprimés', () => {
  const d = db.getDb();
  d.prepare(`INSERT INTO security_events (type, created_at) VALUES ('old_test', datetime('now', '-91 days'))`).run();
  d.prepare(`INSERT INTO security_events (type, created_at) VALUES ('recent_test', datetime('now', '-89 days'))`).run();
  antibot.purgeOldEvents();
  assert.strictEqual(d.prepare(`SELECT COUNT(*) AS n FROM security_events WHERE type = 'old_test'`).get().n, 0);
  assert.strictEqual(d.prepare(`SELECT COUNT(*) AS n FROM security_events WHERE type = 'recent_test'`).get().n, 1);
});

test('performance : calcul par sauvegarde en O(1) (profondeur 1e9 déclarée)', () => {
  const u = newUser();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 200; i++) {
    seasons.validateDepth(u, seasonId, { maxDepth: 1e9, manualClicks: 20 * 12 * i, manualBlocks: 0, autoBlocks: 0 }, CONFIG, 'p', T0 + i * 12_000);
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 200;
  assert.ok(ms < 5, `${ms} ms par sauvegarde`);
});

// ── HTTP : sauvegarde avec télémétrie, admin, audit, limite des coffres ──────

test('HTTP : télémétrie, résumé admin, audit de config, interrupteurs, limite des coffres', async () => {
  const httpDb = path.join(dir, 'http.sqlite');
  const adminSecret = crypto.randomBytes(16).toString('hex');
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: httpDb, ADMIN_SECRET: adminSecret,
      SESSION_SECRET: crypto.randomBytes(16).toString('hex'), RATE_CHEST_MAX: '3', ANTIBOT: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', d => { log += d; });
  server.stderr.on('data', d => { log += d; });
  const admin = { Authorization: `Bearer ${adminSecret}`, 'Content-Type': 'application/json' };
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      try { await fetch(`${BASE}/api/version`); up = true; } catch (_) { await new Promise(r => setTimeout(r, 100)); }
    }
    assert.ok(up, log);

    const reg = await fetch(`${BASE}/api/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'scripted', email: 'scripted@example.invalid', password: 'secret123' }),
    });
    assert.strictEqual(reg.status, 200);
    const cookie = reg.headers.get('set-cookie').split(';')[0];
    const season = (await (await fetch(`${BASE}/api/seasons/current`)).json()).season;
    const save = (ss, telemetry) => fetch(`${BASE}/api/me/save`, {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { lastSaveTime: Date.now(), seasonStats: { seasonId: season.id, ...ss } }, telemetry }),
    });
    assert.strictEqual((await save({ maxDepth: 0, manualBlocks: 0, manualClicks: 0, autoBlocks: 0 })).status, 200);
    const bot = { v: 1, n: 400, h: [399, 0, 0, 0, 0, 0, 0, 0], u: 400, p: { m: 0, t: 0, k: 0, o: 400 }, cv: 0.02 };
    assert.strictEqual((await save({ maxDepth: 3, manualBlocks: 2, manualClicks: 400, autoBlocks: 0 }, bot)).status, 200);
    // Télémétrie illisible : la sauvegarde passe quand même
    assert.strictEqual((await save({ maxDepth: 3, manualBlocks: 2, manualClicks: 400, autoBlocks: 0 }, 'garbage')).status, 200);

    // Admin : sans clé → 401 ; résumé et journal
    assert.strictEqual((await fetch(`${BASE}/api/admin/security/summary`)).status, 401);
    const sum = await (await fetch(`${BASE}/api/admin/security/summary`, { headers: admin })).json();
    assert.strictEqual(sum.antibotMode, 'shadow');
    assert.strictEqual(sum.damageBudgetMode, 'enforce');
    assert.strictEqual(sum.accounts[0].username, 'scripted');
    assert.ok(sum.timings.saves >= 3);
    const ev = await (await fetch(`${BASE}/api/admin/security/events?type=untrusted_clicks`, { headers: admin })).json();
    assert.strictEqual(ev.events.length, 1);
    assert.strictEqual(ev.events[0].username, 'scripted');
    assert.match(ev.events[0].ip_hash, /^[0-9a-f]{16}$/);

    // Interrupteurs : enforce refusé, shadow accepté et audité (ancienne/nouvelle valeur)
    const put = (key, value) => fetch(`${BASE}/api/admin/config`, { method: 'PUT', headers: admin, body: JSON.stringify({ key, value }) });
    assert.strictEqual((await put('antibot_mode', 'enforce')).status, 400);
    assert.strictEqual((await put('damage_budget_mode', 'shadow')).status, 200);
    assert.strictEqual((await put('damage_budget_mode', 'shadow')).status, 200); // inchangé : pas de 2e audit
    const audit = await (await fetch(`${BASE}/api/admin/security/events?type=admin_config`, { headers: admin })).json();
    assert.strictEqual(audit.events.length, 1);
    assert.deepStrictEqual(JSON.parse(audit.events[0].details), { key: 'damage_budget_mode', old: 'enforce', new: 'shadow' });
    const actions = await (await fetch(`${BASE}/api/admin/security/events?type=admin_action`, { headers: admin })).json();
    assert.ok(actions.events.length >= 3);
    // Requête admin non authentifiée : pas d'entrée d'audit
    await fetch(`${BASE}/api/admin/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const actions2 = await (await fetch(`${BASE}/api/admin/security/events?type=admin_action`, { headers: admin })).json();
    assert.strictEqual(actions2.total, actions.total);

    // Coffres : limite par compte (RATE_CHEST_MAX=3 pour le test)
    const codes = [];
    for (let i = 0; i < 4; i++) {
      const r = await fetch(`${BASE}/api/me/shop/chest/open`, {
        method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ chestId: 'simple' }),
      });
      codes.push(r.status);
    }
    assert.notStrictEqual(codes[0], 429);
    assert.strictEqual(codes[3], 429);
  } finally {
    server.kill();
    await new Promise(r => server.once('exit', r));
  }
});
