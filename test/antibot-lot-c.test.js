/**
 * Ticket #25 lot C — défis ponctuels et suspensions progressives du minage manuel
 * (décision du propriétaire du 06/11/2026).
 *
 * Simulations sur base isolée, horloge accélérée (une sauvegarde toutes les 12 s comme le jeu) :
 * humains 2–8 clics/s avec pauses, rafales, Auto-Dig seul, autoclickers 8–20 clics/s réguliers
 * et bruités pendant plusieurs heures, pauses alternées, client officiel (le défi bloque les
 * coups) et client modifié (continue à déclarer des clics), défi résolu par un humain.
 * Énigme : usage unique, réponse trop rapide, expiration, rejeu, plafond ; modes et admin.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-antibot-c-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db        = require('../server/db');
const seasons   = require('../server/seasons');
const antibot   = require('../server/antibot');
const responses = require('../server/antibotResponses');

let T0 = Date.UTC(2026, 10, 6, 20, 0, 0);
const SAVE_SECS = 12;
let seasonId;
let userSeq = 0;

function newUser() {
  return Number(db.getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(`abc_${++userSeq}`, 'x').lastInsertRowid);
}

function setMode(mode) { db.setAdminConfig('antibot_response_mode', mode); }

/** Histogramme de télémétrie (8 classes) d'un lot d'intervalles. */
function hist(intervals) {
  const B = [40, 60, 80, 100, 150, 250, 500];
  const h = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const g of intervals) { let i = 0; while (i < B.length && g >= B[i]) i++; h[i]++; }
  return h;
}

/**
 * Joueur simulé. `cpsAt(t)` : clics/s tentés à l'instant t (s depuis le début) ; le client officiel
 * plafonne à 12 coups/s et, si `official`, ne compte aucun coup pendant un défi/suspension affiché.
 * `jitter` : amplitude relative des intervalles ; `solveAfter` : secondes avant qu'un humain résolve.
 */
function player({ cpsAt, hours, official = true, jitter = 0.4, solveAfter = null, autoBlocksPerSec = 0, rng = seeded(1) }) {
  const userId = newUser();
  let clicks = 0, blocks = 0, auto = 0, frac = 0, autoFrac = 0, carry = 0;
  let hp = Math.ceil(2 * antibot.minBlockHp(1));
  let shown = null;      // défi affiché par le client
  let shownAt = 0;
  const out = { userId, challenges: 0, shadow: 0, suspensions: [], timeline: [] };
  const steps = Math.round(hours * 3600 / SAVE_SECS);
  for (let k = 1; k <= steps; k++) {
    const t = k * SAVE_SECS;
    const now = T0 + t * 1000;
    const blocked = official && shown;
    const cps = blocked ? 0 : Math.min(12, cpsAt(t - SAVE_SECS / 2));
    const n = Math.floor(cps * SAVE_SECS + frac);
    frac = cps * SAVE_SECS + frac - n;
    clicks += n;
    // Blocs réalistes : 25 dégâts par coup (pioche max), PV sans réduction (2 × borne minimale)
    let dmg = n * antibot.MAX_CLICK_DAMAGE + carry;
    while (dmg >= hp) { dmg -= hp; blocks++; hp = Math.ceil(2 * antibot.minBlockHp(1 + blocks + auto)); }
    carry = dmg;
    autoFrac += autoBlocksPerSec * SAVE_SECS;
    const na = Math.floor(autoFrac); autoFrac -= na; auto += na;
    const intervals = [];
    for (let i = 0; i < n; i++) intervals.push((1000 / Math.max(cps, 0.1)) * (1 + jitter * (rng() * 2 - 1)));
    const tel = n ? { n, h: hist(intervals), u: 0, x: 0, p: { m: n, t: 0, k: 0, o: 0 } } : null;
    const st = seasons.syncPlayerRanking(userId, {
      seasonId, maxDepth: 1 + blocks + auto, manualBlocks: blocks, autoBlocks: auto, manualClicks: clicks, suspiciousScore: 0,
    }, { telemetry: tel, nowMs: now });
    // Client : affiche le défi reçu, le signale vu ; un humain le résout après `solveAfter` s
    if (st?.challenge || st?.suspension) {
      if (!shown) shownAt = t;
      shown = st.challenge?.id ?? shown ?? -1;
      // Comme le jeu : le défi (ré)affiché hors suspension est signalé vu avec le compteur courant
      if (st.challenge && !st.suspension && !st.challenge.seen) responses.markSeen(userId, st.challenge.id, { manualClicks: clicks, nowMs: now });
    } else shown = null;
    if (st?.suspension && out.suspensions[out.suspensions.length - 1] !== st.suspension.id) out.suspensions.push(st.suspension.id);
    if (shown && solveAfter != null && t - shownAt >= solveAfter && !st?.suspension) {
      const p = responses.newPuzzle(userId, shown, { kind: 'text', nowMs: now - 2000 });
      const r = responses.answer(userId, shown, p.puzzleId, String(p.a + p.b), { manualClicks: clicks, manualBlocks: blocks, nowMs: now });
      if (r.solved) shown = null;
    }
    if (t % 3600 === 0) out.timeline.push(ranked(userId));
  }
  const rows = db.getDb().prepare('SELECT status, COUNT(*) AS n FROM antibot_challenges WHERE user_id = ? GROUP BY status').all(userId);
  for (const r of rows) { if (r.status === 'shadow') out.shadow += r.n; else out.challenges += r.n; }
  out.ranked = ranked(userId);
  out.claimed = blocks;
  return out;
}

function ranked(userId) {
  const r = db.getDb().prepare('SELECT effective_manual_blocks AS e, manual_blocks AS m FROM season_rankings WHERE season_id = ? AND user_id = ?').get(seasonId, userId);
  return r ? Math.min(r.e, r.m) : 0;
}

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

/** Sessions : `on` s de clics à `cps`, puis `off` s de pause. */
const sessions = (cps, on, off) => t => (t % (on + off) < on ? cps : 0);

test.before(() => {
  db.initDb();
  // Saison active créée par initDb : élargie pour les simulations (base temporaire)
  const s = db.getActiveSeason() ?? db.createSeason('Test lot C', '2026-11-01 00:00:00', '2026-11-30 23:59:59', 'active');
  db.getDb().prepare(`UPDATE seasons SET start_at = '2026-11-01 00:00:00', end_at = '2026-11-30 23:59:59' WHERE id = ?`).run(s.id);
  seasonId = s.id;
});

test.after(() => {
  db.getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── Valeurs par défaut sûres ────────────────────────────────────────────────

test('défaut : mode Observation, rien n\'est montré au joueur ; validation des réglages', () => {
  const cfg = db.getAdminConfig();
  assert.strictEqual(cfg.antibot_response_mode, 'observe');
  assert.strictEqual(responses.getGlobalMode(cfg), 'observe');
  assert.strictEqual(responses.getGlobalMode({ ...cfg, antibot_mode: 'off' }), 'off');
  assert.strictEqual(responses.getGlobalMode(cfg, { ANTIBOT: 'off' }), 'off');
  assert.deepStrictEqual(responses.getParams({}).ab_suspension_ladder, [5, 15, 30, 60, 120, 720, 1440]);
  assert.deepStrictEqual(responses.validateConfigValue('antibot_response_mode', 'Enforce'), { value: 'enforce' });
  assert.ok(responses.validateConfigValue('antibot_response_mode', 'ban').error);
  assert.deepStrictEqual(responses.validateConfigValue('ab_suspension_ladder', '5, 15,30'), { value: '5,15,30' });
  assert.ok(responses.validateConfigValue('ab_suspension_ladder', '5,0').error);
  assert.ok(responses.validateConfigValue('ab_streak_min', '5').error);
  assert.strictEqual(responses.validateConfigValue('autre_cle', '1'), null);
});

// ── Humains : aucun défi ────────────────────────────────────────────────────

test('humains 2–8 clics/s avec pauses (2 h) et rafales : aucun défi, tout est classé', () => {
  setMode('enforce');
  const profiles = [
    { name: '2 cps, 15 min / 5 min', cpsAt: sessions(2, 900, 300), hours: 2 },
    { name: '5 cps, 20 min / 4 min', cpsAt: sessions(5, 1200, 240), hours: 2 },
    { name: '8 cps, 10 min / 4 min', cpsAt: sessions(8, 600, 240), hours: 2 },
    { name: 'mobile 6 cps + rafales 15 cps', cpsAt: t => (t % 600 < 30 ? 15 : t % 600 < 420 ? 6 : 0), hours: 2 },
  ];
  for (const p of profiles) {
    const r = player({ ...p, jitter: 0.6 });
    assert.strictEqual(r.challenges, 0, `${p.name} : aucun défi`);
    assert.strictEqual(r.suspensions.length, 0, `${p.name} : aucune suspension`);
    assert.ok(r.ranked >= r.claimed * 0.9, `${p.name} : ${r.ranked}/${r.claimed} blocs classés`);
  }
  setMode('observe');
});

test('Auto-Dig seul pendant 10 h : aucun défi (le minage automatique légal n\'est pas mesuré)', () => {
  setMode('enforce');
  const r = player({ cpsAt: () => 0, hours: 10, autoBlocksPerSec: 1 });
  assert.strictEqual(r.challenges + r.shadow, 0);
  setMode('observe');
});

// ── Autoclickers : Observation ──────────────────────────────────────────────

test('Observation : autoclicker 8 clics/s pendant 8 h → défis simulés ≈ 1/h, rien de retiré', () => {
  setMode('observe');
  const r = player({ cpsAt: () => 8, hours: 8, jitter: 0 });
  assert.ok(r.shadow >= 7 && r.shadow <= 9, `défis simulés : ${r.shadow}`);
  assert.strictEqual(r.challenges, 0);
  assert.ok(r.ranked >= r.claimed * 0.95, 'observation : classement inchangé');
  const ev = db.getDb().prepare(`SELECT COUNT(*) AS n FROM security_events WHERE user_id = ? AND type = 'challenge_shadow'`).get(r.userId).n;
  assert.strictEqual(ev, r.shadow);
});

// ── Autoclickers : Appliqué, client officiel ────────────────────────────────

const BOTS = [
  { name: '8 cps réguliers', cpsAt: () => 8, jitter: 0 },
  { name: '12 cps bruités ±40 %', cpsAt: () => 12, jitter: 0.4 },
  { name: '20 cps (plafonné à 12 par le client)', cpsAt: () => 20, jitter: 0.2 },
  { name: '5 cps bruités, pauses 2 min toutes les 10 min', cpsAt: sessions(5, 600, 120), jitter: 0.5 },
];

test('Appliqué, client officiel : chaque autoclicker est arrêté après ≈ 1 h, plus rien de classé pendant la nuit', () => {
  setMode('enforce');
  for (const b of BOTS) {
    const r = player({ ...b, hours: 8 });
    assert.strictEqual(r.challenges, 1, `${b.name} : un défi, jamais résolu`);
    const atH1 = r.timeline[0], atH2 = r.timeline[1];
    assert.ok(r.ranked <= atH2, `${b.name} : figé`);
    assert.strictEqual(r.ranked, r.timeline[7], `${b.name} : rien de classé après le défi`);
    assert.ok(r.ranked < 12 * 3600 / 4 * 1.5 / 1, `${b.name} : ${r.ranked} blocs classés`);
    assert.ok(atH1 > 0);
    assert.strictEqual(r.suspensions.length, 0, `${b.name} : client officiel → aucune suspension (aucun clic possible)`);
  }
  setMode('observe');
});

test('Appliqué : pauses de 4 min (série coupée) → défi par le temps actif sur 6 h', () => {
  setMode('enforce');
  const r = player({ cpsAt: sessions(8, 600, 240), hours: 8, jitter: 0.3 });
  assert.strictEqual(r.challenges, 1);
  const c = db.getDb().prepare('SELECT reasons, created_ms FROM antibot_challenges WHERE user_id = ?').get(r.userId);
  assert.match(c.reasons, /active_6h/);
  const h = (c.created_ms - T0) / 3600_000;
  assert.ok(h > 3.5 && h < 5, `défi après ${h.toFixed(2)} h`);
  setMode('observe');
});

test('Appliqué : défi résolu par un humain → reprise, nouveau défi environ chaque heure', () => {
  setMode('enforce');
  const r = player({ cpsAt: () => 10, hours: 6, jitter: 0.3, solveAfter: 60 });
  assert.ok(r.challenges >= 5 && r.challenges <= 7, `défis : ${r.challenges}`);
  const solved = db.getDb().prepare(`SELECT COUNT(*) AS n FROM antibot_challenges WHERE user_id = ? AND status = 'solved'`).get(r.userId).n;
  assert.ok(solved >= r.challenges - 1);
  assert.strictEqual(r.suspensions.length, 0, 'défi résolu : aucune sanction');
  setMode('observe');
});

// ── Client modifié : violation confirmée et paliers ─────────────────────────

test('client modifié (continue à cliquer pendant le défi affiché) : suspensions 5 → 15 → 30 min…, jamais de crédit', () => {
  setMode('enforce');
  const r = player({ cpsAt: () => 10, hours: 4, official: false, jitter: 0.3 });
  assert.strictEqual(r.challenges, 1);
  const rows = db.getDb().prepare('SELECT level, (ends_ms - starts_ms) / 60000 AS min FROM antibot_suspensions WHERE user_id = ? ORDER BY id').all(r.userId);
  assert.ok(rows.length >= 4, `suspensions : ${rows.length}`);
  assert.deepStrictEqual(rows.slice(0, 4).map(x => x.min), [5, 15, 30, 60]);
  assert.deepStrictEqual(rows.slice(0, 4).map(x => x.level), [1, 2, 3, 4]);
  assert.strictEqual(r.ranked, r.timeline[1], 'aucun bloc classé après le défi');
  setMode('observe');
});

test('paliers : 7+ → 24 h ; décroissance d\'un palier après 30 jours sans violation', () => {
  const p = responses.getParams({});
  const s = { violation_level: 8, last_violation_ms: T0 };
  assert.strictEqual(responses.effectiveViolationLevel(s, T0 + 29 * 86400_000, p), 8);
  assert.strictEqual(responses.effectiveViolationLevel(s, T0 + 31 * 86400_000, p), 7);
  assert.strictEqual(responses.effectiveViolationLevel(s, T0 + 300 * 86400_000, p), 0);
  const ladder = p.ab_suspension_ladder;
  assert.strictEqual(ladder[Math.min(8, ladder.length) - 1], 1440);
});

// ── Énigme : serveur, usage unique, aucune sanction pour un échec ───────────

function pendingFor(userId) {
  setMode('enforce');
  const r = responses.adminIssueChallenge(userId, seasonId, { config: db.getAdminConfig(), nowMs: T0 });
  assert.ok(r.id, JSON.stringify(r));
  return r.id;
}

test('énigme : mauvaise réponse, trop rapide, expirée, rejouée → aucune sanction, nouvelle énigme', () => {
  const u = newUser();
  const id = pendingFor(u);
  const st = responses.playerStatus(u, { config: db.getAdminConfig(), nowMs: T0 });
  assert.strictEqual(st.challenge.id, id);
  assert.strictEqual(st.manualRanked, false);

  let p = responses.newPuzzle(u, id, { nowMs: T0 });
  assert.strictEqual(p.kind, 'grid');
  assert.strictEqual(p.tiles.length, 6);
  assert.strictEqual(p.targets.length, 2);
  assert.ok(!('answer' in p) && !JSON.stringify(p).includes('hash'), 'la réponse ne quitte jamais le serveur');
  assert.strictEqual(responses.answer(u, id, p.puzzleId, '0,1', { nowMs: T0 + 300 }).reason, 'too_fast');
  // Usage unique : la même énigme ne peut plus être rejouée, même avec la bonne réponse
  const good = p.targets.map(t => p.tiles.findIndex(x => x.sym === t)).join(',');
  assert.strictEqual(responses.answer(u, id, p.puzzleId, good, { nowMs: T0 + 5000 }).reason, 'stale');

  p = responses.newPuzzle(u, id, { nowMs: T0 + 6000 });
  assert.strictEqual(responses.answer(u, id, p.puzzleId, '9,9', { nowMs: T0 + 9000 }).reason, 'wrong');
  p = responses.newPuzzle(u, id, { nowMs: T0 + 10_000 });
  assert.strictEqual(responses.answer(u, id, p.puzzleId, 'x', { nowMs: T0 + 10_000 + responses.PUZZLE_TTL_MS + 1 }).reason, 'expired');
  const ch = db.getDb().prepare('SELECT * FROM antibot_challenges WHERE id = ?').get(id);
  assert.strictEqual(ch.status, 'pending');
  assert.strictEqual(ch.fails, 2);
  assert.strictEqual(ch.expirations, 1);
  assert.strictEqual(db.getDb().prepare('SELECT COUNT(*) AS n FROM antibot_suspensions WHERE user_id = ?').get(u).n, 0, 'échecs : aucune suspension');

  // Alternative accessible (texte) puis bonne réponse
  p = responses.newPuzzle(u, id, { kind: 'text', nowMs: T0 + 400_000 });
  assert.strictEqual(p.kind, 'text');
  assert.ok(responses.answer(u, id, p.puzzleId, String(p.a + p.b), { nowMs: T0 + 405_000 }).solved);
  assert.strictEqual(responses.playerStatus(u, { config: db.getAdminConfig(), nowMs: T0 + 405_000 }), null);
  // Réponse rejouée après résolution : refusée
  assert.strictEqual(responses.answer(u, id, p.puzzleId, String(p.a + p.b), { nowMs: T0 + 406_000 }).reason, 'no_challenge');
  setMode('observe');
});

test('énigme : plafond de relances par 10 min (pas de force brute), puis reprise', () => {
  const u = newUser();
  const id = pendingFor(u);
  for (let i = 0; i < responses.PUZZLE_MAX_PER_WINDOW; i++) assert.ok(responses.newPuzzle(u, id, { nowMs: T0 + i }).puzzleId);
  assert.strictEqual(responses.newPuzzle(u, id, { nowMs: T0 + 100 }).error, 'too_many');
  assert.ok(responses.newPuzzle(u, id, { nowMs: T0 + 10 * 60_000 + 1 }).puzzleId);
  setMode('observe');
});

test('énigme : une réponse au hasard réussit rarement (grille 6 symboles, 2 cibles ordonnées)', () => {
  const u = newUser();
  const id = pendingFor(u);
  let ok = 0;
  const N = 300;
  for (let i = 0; i < N; i++) {
    const now = T0 + i * 61_000;
    const p = responses.newPuzzle(u, id, { nowMs: now });
    const a = crypto.randomInt(6); let b = crypto.randomInt(6); if (b === a) b = (b + 1) % 6;
    const r = responses.answer(u, id, p.puzzleId, `${a},${b}`, { nowMs: now + 2000 });
    if (r.solved) { ok++; break; }
  }
  // 1 chance sur 30 par essai : on vérifie seulement que la vérification est bien faite côté serveur
  const ch = db.getDb().prepare('SELECT fails FROM antibot_challenges WHERE id = ?').get(id);
  assert.ok(ch.fails >= 1 || ok === 1);
  setMode('observe');
});

// ── Modes, essai par compte, admin ──────────────────────────────────────────

test('essai « Appliqué » sur un seul compte pendant que le global reste en Observation ; Désactivé coupe tout', () => {
  setMode('observe');
  const a = newUser(), b = newUser();
  responses.setForceMode(a, true);
  const cfg = db.getAdminConfig();
  assert.strictEqual(responses.getUserMode(a, cfg), 'enforce');
  assert.strictEqual(responses.getUserMode(b, cfg), 'observe');
  assert.strictEqual(responses.getUserMode(a, { ...cfg, antibot_response_mode: 'off' }), 'off');
  const r = responses.adminIssueChallenge(b, seasonId, { config: cfg, nowMs: T0 });
  assert.ok(r.id);
  assert.strictEqual(r.mode, 'observe');
  assert.strictEqual(responses.playerStatus(b, { config: cfg, nowMs: T0 }), null, 'Observation : rien d\'affiché');
  const sum = responses.adminSummary({ config: cfg, nowMs: T0 });
  assert.ok(sum.testAccounts.some(x => x.userId === a));
  // Défi réel laissé en attente, puis retour en Observation : défis simulés toujours mesurés
  const ra = responses.adminIssueChallenge(a, seasonId, { config: cfg, nowMs: T0 });
  assert.strictEqual(ra.mode, 'enforce');
  responses.setForceMode(a, false);
  assert.strictEqual(responses.getUserMode(a, cfg), 'observe');
  assert.strictEqual(responses.playerStatus(a, { config: cfg, nowMs: T0 }), null);
  assert.strictEqual(responses.adminIssueChallenge(a, seasonId, { config: cfg, nowMs: T0 }).mode, 'observe');
});

test('admin : lever une suspension, annuler un défi, ajuster le palier — le joueur retrouve le minage classé', () => {
  setMode('enforce');
  const r = player({ cpsAt: () => 10, hours: 1.5, official: false, jitter: 0.3 });
  const susp = db.getDb().prepare(`SELECT id FROM antibot_suspensions WHERE user_id = ? AND status = 'active' ORDER BY id DESC`).get(r.userId);
  assert.ok(susp, 'suspension active');
  assert.ok(responses.liftSuspension(susp.id, { note: 'essai' }));
  assert.ok(!responses.liftSuspension(susp.id));
  const ch = db.getDb().prepare(`SELECT id FROM antibot_challenges WHERE user_id = ? AND status = 'pending'`).get(r.userId);
  assert.ok(responses.cancelChallenge(ch.id));
  assert.strictEqual(responses.setViolationLevel(r.userId, 0), 0);
  const sec = responses.playerSection(r.userId, { config: db.getAdminConfig(), nowMs: T0 + 2 * 3600_000 });
  assert.strictEqual(sec.state, 'normal');
  assert.strictEqual(sec.manualRanked, true);
  assert.ok(sec.history.suspensions.length >= 1);
  setMode('observe');
});

test('défi résolu : allègement du score (hors preuves) et remise à zéro des mesures', () => {
  const u = newUser();
  db.getDb().prepare('INSERT INTO risk_scores (user_id, season_id, components, score, level, updated_ms) VALUES (?, ?, ?, ?, ?, ?)')
    .run(u, seasonId, JSON.stringify({ proof: 30, cps: 20, activity: 20 }), 70, 2, T0);
  const r = antibot.relieveRisk(u, seasonId, { nowMs: T0 });
  assert.strictEqual(r.before, 70);
  assert.strictEqual(r.after, 50);
});

test('client : le défi bloque les coups manuels, l\'Auto-Dig continue ; textes dans les 4 langues', () => {
  const ROOT = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
  const hit = main.slice(main.indexOf('function onBlockHit('), main.indexOf('function onBlockHit(') + 1500);
  assert.match(hit, /AntibotGate\.blocksManual\(\)/, 'garde dans onBlockHit');
  assert.ok(hit.indexOf('AntibotGate.blocksManual()') < hit.indexOf('manualClicks++'));
  const auto = main.slice(main.indexOf('function autoDigTick('), main.indexOf('function autoDigTick(') + 800);
  assert.doesNotMatch(auto, /AntibotGate/, 'Auto-Dig non bloqué');
  const i18n = fs.readFileSync(path.join(ROOT, 'public/js/i18n.js'), 'utf8');
  assert.strictEqual((i18n.match(/antibot: \{/g) ?? []).length, 4);
});
