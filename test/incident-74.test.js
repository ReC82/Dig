/**
 * Ticket #74 — incident du 04/11 (test de résistance d'un compte invité, ~78 000 clics en 77 min,
 * 30 à 51 clics/s soutenus, 1 003 m atteints alors que 30 blocs seulement étaient comptés manuels).
 *
 * Rejoue sur base isolée :
 * - le limiteur de frappes du client (code réel de public/js/main.js) : humain rapide, mobile
 *   multi-doigts, rafales, autoclicker 40 clics/s, autoclicker régulier ;
 * - les compteurs : un bloc cassé par un coup suspect n'est plus perdu (suspiciousBlocks) ;
 * - la validation serveur : un client modifié qui déclare la cadence de l'incident n'est crédité
 *   qu'à la cadence maximale de frappe, profondeur sautée / compteurs forgés bornés ;
 * - la configuration (bornes, exposition au client).
 * Base temporaire hors server/data/, aucun serveur lancé.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const vm     = require('vm');

const ROOT = path.join(__dirname, '..');
const dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-incident74-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db      = require('../server/db');
const seasons = require('../server/seasons');
const antibot = require('../server/antibot');

const MAIN = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
const T0   = Date.UTC(2026, 10, 4, 21, 45, 0);
let seasonId;
let userSeq = 0;

function newUser() {
  return db.getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(`i74_${++userSeq}`, 'x').lastInsertRowid;
}

/** Extrait une fonction de premier niveau de main.js (code réel du client). */
function fnSource(name) {
  const start = MAIN.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} absent de main.js`);
  let i = MAIN.indexOf(') {', start) + 2, depth = 0;   // corps (après les paramètres)
  for (; i < MAIN.length; i++) {
    if (MAIN[i] === '{') depth++;
    else if (MAIN[i] === '}' && --depth === 0) break;
  }
  return MAIN.slice(start, i + 1);
}

/** Limiteur du client dans un contexte isolé, horloge simulée. */
function limiter(config = {}) {
  const decl = MAIN.match(/let _hitRate[\s\S]*?let _hitFloatMs = 0;/)[0];
  const ctx = { clock: 0, GameState: { seasonStats: { regularityScore: 0 } } };
  ctx.performance = { now: () => ctx.clock };
  vm.createContext(ctx);
  vm.runInContext(`${decl}\n${fnSource('_applyHitLimits')}\n${fnSource('_takeHitToken')}\n` +
    'this.take = _takeHitToken; this.apply = _applyHitLimits;', ctx);
  ctx.apply(config);
  /** Frappe `cps` coups/s pendant `secs` s (intervalles réguliers ou fournis) ; renvoie les coups portés. */
  ctx.play = (cps, secs, { regularity = 0 } = {}) => {
    ctx.GameState.seasonStats.regularityScore = regularity;
    let ok = 0;
    const n = Math.round(cps * secs);
    for (let i = 0; i < n; i++) { ctx.clock += 1000 / cps; if (ctx.take()) ok++; }
    return ok;
  };
  return ctx;
}

test.before(() => {
  db.initDb();
  seasonId = db.createSeason('Test #74', '2026-11-02 00:00:00', '2026-11-08 23:59:59', 'closed').id;
});

test.after(() => {
  db.getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── Client : limiteur de frappes ─────────────────────────────────────────────

test('limiteur : joueur humain (6–10 coups/s) et rafales courtes jamais freinés', () => {
  const c = limiter();
  assert.strictEqual(c.play(6, 600), 3600, '6 coups/s pendant 10 min');
  assert.strictEqual(c.play(10, 300), 3000, '10 coups/s pendant 5 min');
  c.clock += 10_000;                                   // pause : seau rempli
  assert.strictEqual(c.play(20, 3), 60, 'rafale 20 coups/s pendant 3 s (mobile multi-doigts)');
  c.clock += 10_000;
  assert.strictEqual(c.play(15, 6), 90, 'rafale 15 coups/s pendant 6 s');
});

test('limiteur : autoclicker de l\'incident (40 coups/s, 77 min) ramené à 12 coups/s', () => {
  const c = limiter();
  const secs = 77 * 60;
  const ok = c.play(40, secs);
  assert.ok(ok <= 12 * secs + 36, `coups portés ${ok}`);
  assert.ok(ok >= 12 * secs - 1, `coups portés ${ok}`);
  // 184 800 coups tentés → environ 55 000 portés : × 0,30
  assert.ok(ok / (40 * secs) < 0.31);
});

test('limiteur : rythme robotique (régularité > 0,92) → recharge réduite de moitié', () => {
  const c = limiter();
  const ok = c.play(12, 600, { regularity: 0.99 });
  assert.ok(ok <= 6 * 600 + 36, `coups portés ${ok}`);
  const h = limiter();
  assert.strictEqual(h.play(12, 600, { regularity: 0.3 }), 7200, 'même cadence, rythme humain : tout passe');
});

test('limiteur : cadence fournie par le serveur, valeurs illisibles ignorées', () => {
  const c = limiter({ hitRate: 8, hitBurst: 10 });
  const ok = c.play(20, 60);
  assert.ok(ok <= 8 * 60 + 10 && ok >= 8 * 60 - 1, `coups portés ${ok}`);
  const d = limiter({ hitRate: 'x', hitBurst: -1 });
  assert.ok(d.play(40, 60) <= 12 * 60 + 36);
});

test('client : un coup au-delà de la cadence ne fait ni dégât ni gain et n\'est pas compté comme clic', () => {
  const hit = fnSource('onBlockHit');
  const iTok = hit.indexOf('_takeHitToken()');
  assert.ok(iTok > 0);
  assert.ok(iTok < hit.indexOf('manualClicks++'), 'clic compté seulement s\'il porte');
  assert.ok(iTok < hit.indexOf('Blocks.hit('), 'aucun dégât sans jeton');
  assert.match(hit, /throttledHits/);
  assert.match(hit, /_tele\.x\+\+/);
});

test('client : un bloc cassé par un coup suspect est compté (suspiciousBlocks), jamais comme manuel', () => {
  const hit = fnSource('onBlockHit');
  assert.match(hit, /handleBlockDestroyed\(cx, cy, \{ isManual: !suspicious, isSuspicious: suspicious \}\)/);
  const destroyed = fnSource('handleBlockDestroyed');
  assert.match(destroyed, /else if \(isSuspicious\)[\s\S]*?suspiciousBlocks/);
  const gs = fs.readFileSync(path.join(ROOT, 'public/js/gameState.js'), 'utf8');
  assert.match(gs, /suspiciousBlocks: 0/);
  const save = fs.readFileSync(path.join(ROOT, 'public/js/save.js'), 'utf8');
  assert.match(save, /seasonStats\.suspiciousBlocks = ss\.suspiciousBlocks \?\? 0/);
});

// ── Serveur : validation des sauvegardes ─────────────────────────────────────

const CFG_BEFORE = { depth_validation_enabled: 'true', depth_max_cps: '20', damage_budget_mode: 'enforce', antibot_mode: 'shadow', manual_hit_rate: '30' };
const CFG_AFTER  = { depth_validation_enabled: 'true', depth_max_cps: '20', damage_budget_mode: 'enforce', antibot_mode: 'shadow' };

/**
 * Client modifié qui déclare la progression de l'incident : 40 clics/s, pioche max (25 dégâts),
 * profondeur déclarée = celle que permettent ses dégâts sur les blocs les plus faibles.
 */
function replayIncident(config, secs = 77 * 60) {
  const u = newUser();
  let depth = 14, credit = 0, clicks = 157, last;
  seasons.validateDepth(u, seasonId, { maxDepth: depth, manualClicks: clicks, manualBlocks: 13, autoBlocks: 0 }, config, 'i74', T0);
  for (let t = 12; t <= secs; t += 12) {
    clicks += 40 * 12;
    credit += 40 * 12 * 25;
    const r = antibot.reachableDepth(depth, credit, 100_000);
    credit -= r.spent; depth = r.depth;
    last = seasons.validateDepth(u, seasonId, { maxDepth: depth, manualClicks: clicks, manualBlocks: 30, autoBlocks: 18 },
      config, 'i74', T0 + t * 1000);
  }
  return { claimed: depth, accepted: last.acceptedDepth };
}

test('serveur : rejeu de l\'incident — la profondeur retenue suit la cadence max de frappe, pas celle déclarée', () => {
  const before = replayIncident(CFG_BEFORE);
  const after  = replayIncident(CFG_AFTER);
  assert.ok(after.accepted < before.accepted, `avant ${before.accepted} m, après ${after.accepted} m`);
  // Retenu ≤ budget d'un joueur à 12 coups/s × marge 1,25 (blocs les plus faibles)
  const cap = antibot.reachableDepth(14, 12 * 1.25 * 25 * 77 * 60 + 25 * 77 * 60, 100_000).depth;
  assert.ok(after.accepted <= cap, `retenu ${after.accepted} > borne ${cap}`);
  assert.ok(after.claimed > after.accepted);
});

test('serveur : sauvegarde forgée (saut de 5 000 m, 1 million de clics en 12 s) bornée', () => {
  const u = newUser();
  seasons.validateDepth(u, seasonId, { maxDepth: 10, manualClicks: 50, manualBlocks: 9, autoBlocks: 0 }, CFG_AFTER, 'forge', T0);
  const r = seasons.validateDepth(u, seasonId, { maxDepth: 5000, manualClicks: 1_000_000, manualBlocks: 4000, autoBlocks: 0 }, CFG_AFTER, 'forge', T0 + 12_000);
  assert.ok(r.acceptedDepth <= 10 + 12 * 1.25 * 12 + 15, `retenu ${r.acceptedDepth}`);
  assert.ok(r.signals.some(s => s.type === 'depth_rejected'));
});

test('serveur : compteurs suspiciousBlocks / throttledHits falsifiés détectés', () => {
  assert.deepStrictEqual(antibot.forgedCounters({ suspiciousBlocks: -4, throttledHits: 1.5, manualClicks: 3 }), ['suspiciousBlocks', 'throttledHits']);
  assert.deepStrictEqual(antibot.forgedCounters({ suspiciousBlocks: 12, throttledHits: 500 }), []);
});

test('télémétrie : coups au-delà de la cadence → indice throttled_hits (observation seule)', () => {
  const bot = antibot.normalizeTelemetry({ v: 1, n: 480, x: 336, h: [470, 5, 5, 0, 0, 0, 0, 0], u: 0, p: { m: 0, t: 480, k: 0, o: 0 }, cv: 0.3 });
  assert.ok(antibot.telemetrySignals(bot).some(s => s.type === 'throttled_hits'));
  const human = antibot.normalizeTelemetry({ v: 1, n: 120, x: 4, h: [20, 10, 15, 20, 25, 20, 7, 2], u: 0, p: { m: 0, t: 120, k: 0, o: 0 }, cv: 0.6 });
  assert.deepStrictEqual(antibot.telemetrySignals(human), []);
  assert.strictEqual(antibot.normalizeTelemetry({ n: 5, x: 99 }).x, 5);
});

test('config : manual_hit_rate / manual_hit_burst bornés, valeurs par défaut 12 / 36, exposées au client', () => {
  assert.deepStrictEqual(antibot.validateConfigValue('manual_hit_rate', '10'), { value: '10' });
  assert.ok(antibot.validateConfigValue('manual_hit_rate', '3').error);
  assert.ok(antibot.validateConfigValue('manual_hit_rate', '31').error);
  assert.ok(antibot.validateConfigValue('manual_hit_burst', 'abc').error);
  assert.deepStrictEqual(antibot.getHitLimits({}), { rate: 12, burst: 36 });
  assert.deepStrictEqual(antibot.getHitLimits({ manual_hit_rate: '99', manual_hit_burst: '0' }), { rate: 12, burst: 36 });
  const cfg = db.getAdminConfig();
  assert.strictEqual(cfg.manual_hit_rate, '12');
  assert.strictEqual(cfg.manual_hit_burst, '36');
  const src = fs.readFileSync(path.join(ROOT, 'server/seasons.js'), 'utf8');
  assert.match(src, /hitRate:\s+antibot\.getHitLimits\(config\)\.rate/);
  assert.strictEqual((MAIN.match(/_applyHitLimits\(data\.config\)/g) ?? []).length, 2);
});
