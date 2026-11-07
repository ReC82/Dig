/**
 * #25 — Recette autoclicker du propriétaire (07/11/2026, OP Auto Clicker Windows à 8 clics/s).
 *
 * 1. L'essai réel (8 clics/s pendant ≈ 40 s) reste sous le seuil : la fiche le dit en clair
 *    (« activité mesurée, sous les seuils »), pas « aucun contrôle » ni « défi ».
 * 2. Longue durée simulée, 8 clics/s fixes et bruités : défi simulé ≈ 1 par heure en Observation ;
 *    humains avec pauses : aucun faux positif.
 * 3. Seuil court d'essai, limité au compte en essai Appliqué : défi en ≈ 2 min, gel des blocs
 *    manuels classés (relevé avant / maintenant), autres comptes et réglage global inchangés,
 *    garde-fous (essai requis, bornes, expiration 2 h, effacé à la fin de l'essai).
 * Base isolée, horloge simulée (une sauvegarde toutes les 12 s comme le jeu).
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-antibot-ac-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db        = require('../server/db');
const seasons   = require('../server/seasons');
const antibot   = require('../server/antibot');
const responses = require('../server/antibotResponses');

const SAVE_SECS = 12;
let T0 = Date.UTC(2026, 10, 7, 16, 0, 0);
let seasonId;
let seq = 0;

const newUser = () => Number(db.getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(`acr_${++seq}`, 'x').lastInsertRowid);
const setMode = mode => db.setAdminConfig('antibot_response_mode', mode);
const cfg = () => db.getAdminConfig();

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

function ranked(userId) {
  const r = db.getDb().prepare('SELECT effective_manual_blocks AS e, manual_blocks AS m FROM season_rankings WHERE season_id = ? AND user_id = ?').get(seasonId, userId);
  return r ? Math.min(r.e, r.m) : 0;
}

/**
 * Joueur simulé, sauvegarde toutes les 12 s. `cpsAt(t)` : clics/s tentés ; `jitter` : bruit relatif
 * de la cadence par fenêtre. Le client officiel ne compte aucun coup pendant un défi affiché.
 * `onStep(t, st)` : rappel après chaque sauvegarde.
 */
function run({ userId = newUser(), cpsAt, secs, jitter = 0, official = true, untrusted = false, rng = seeded(7), onStep = null, start = T0 }) {
  const st0 = { clicks: 0, blocks: 0 };
  const p = run.state.get(userId) ?? { clicks: 0, blocks: 0, frac: 0, carry: 0, hp: Math.ceil(2 * antibot.minBlockHp(1)), shown: null };
  run.state.set(userId, p);
  st0.clicks = p.clicks; st0.blocks = p.blocks;
  let last = null;
  for (let t = SAVE_SECS; t <= secs; t += SAVE_SECS) {
    const now = start + t * 1000;
    const base = cpsAt(t - SAVE_SECS / 2);
    const cps = official && p.shown ? 0 : Math.min(12, Math.max(0, base * (1 + jitter * (rng() * 2 - 1))));
    const n = Math.floor(cps * SAVE_SECS + p.frac);
    p.frac = cps * SAVE_SECS + p.frac - n;
    p.clicks += n;
    let dmg = n * antibot.MAX_CLICK_DAMAGE + p.carry;
    while (dmg >= p.hp) { dmg -= p.hp; p.blocks++; p.hp = Math.ceil(2 * antibot.minBlockHp(1 + p.blocks)); }
    p.carry = dmg;
    last = seasons.syncPlayerRanking(userId, { seasonId, maxDepth: 1 + p.blocks, manualBlocks: p.blocks, autoBlocks: 0,
      manualClicks: p.clicks, suspiciousScore: 0 }, { nowMs: now,
      // Télémétrie du jeu : intervalles réguliers (classe 100–150 ms à 8 clics/s), clics isTrusted = false
      telemetry: n ? { n, h: [0, 0, 0, 0, n, 0, 0, 0], u: untrusted ? n : 0, x: 0, p: { m: n, t: 0, k: 0, o: 0 } } : null });
    if (last?.challenge && !last.suspension) {
      if (!last.challenge.seen) responses.markSeen(userId, last.challenge.id, { manualClicks: p.clicks, nowMs: now });
      p.shown = last.challenge.id;
    } else if (!last?.suspension) p.shown = null;
    onStep?.(t, last, p);
  }
  return { userId, p, last, end: start + secs * 1000 };
}
run.state = new Map();

/** Blocs classés pour le même profil, réponses anti-bot (lot C) désactivées : référence sans défi. */
function rankedWithoutResponses(opts) {
  const mode = cfg().antibot_response_mode;
  setMode('off');
  try { return ranked(run(opts).userId); } finally { setMode(mode); }
}

const challenges = userId => db.getDb().prepare('SELECT status, origin, reasons FROM antibot_challenges WHERE user_id = ? ORDER BY id').all(userId);

test.before(() => {
  db.initDb();
  const s = db.getActiveSeason() ?? db.createSeason('Test recette', '2026-11-01 00:00:00', '2026-11-30 23:59:59', 'active');
  db.getDb().prepare(`UPDATE seasons SET start_at = '2026-11-01 00:00:00', end_at = '2026-11-30 23:59:59' WHERE id = ?`).run(s.id);
  seasonId = s.id;
});

test.after(() => {
  db.getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migration : colonnes ajoutées seules, idempotente', () => {
  const cols = db.getDb().prepare('PRAGMA table_info(antibot_activity)').all().map(r => r.name);
  for (const c of ['last_window', 'test_streak_min', 'test_started_ms', 'test_snapshot']) assert.ok(cols.includes(c), c);
  db.initDb();
  assert.strictEqual(db.getDb().prepare('PRAGMA table_info(antibot_activity)').all().length, cols.length);
});

test('essai réel du 07/11 : 8 clics/s pendant ≈ 40 s → « activité mesurée, sous les seuils », aucun défi', () => {
  setMode('observe');
  for (const jitter of [0, 0.3]) {
    const r = run({ cpsAt: t => (t <= 40 ? 8 : 0), secs: 60, jitter });
    const L = responses.playerSection(r.userId, { config: cfg(), nowMs: r.end });
    const o = L.observation;
    assert.strictEqual(challenges(r.userId).length, 0, 'aucun défi, même simulé');
    assert.strictEqual(o.stale, false, 'mesure récente reçue');
    assert.ok(o.streak.valueMin > 0.3 && o.streak.valueMin < 1, `série ${o.streak.valueMin} min`);
    assert.strictEqual(o.streak.thresholdMin, 60);
    assert.ok(o.streak.pct <= 2);
    assert.strictEqual(o.shadowChallenges24h, 0);
    assert.strictEqual(o.realChallenges24h, 0);
    assert.ok(r.p.clicks >= 250 && r.p.clicks <= 450, `clics ${r.p.clicks}`);
    // Mesures relevées pour la dernière fenêtre (inactive ici)
    assert.ok(o.lastWindow && o.lastWindow.secs > 0);
    if (jitter === 0) {
      assert.strictEqual(o.anomalies24h, 0, '8 clics/s exacts : aucune anomalie');
      assert.strictEqual(ranked(r.userId), r.p.blocks, 'tout est classé');
    } else {
      // Gigue : une fenêtre de 12 s peut dépasser 8 clics/s → #10 journalise cps_reduced (blocs en excès non crédités)
      const types = db.getDb().prepare('SELECT DISTINCT type FROM security_events WHERE user_id = ?').all(r.userId).map(x => x.type);
      assert.ok(types.every(t => t === 'cps_reduced'), types.join(','));
      assert.strictEqual(o.anomalies24h, db.getDb().prepare('SELECT COUNT(*) AS n FROM security_events WHERE user_id = ?').get(r.userId).n);
    }
    // 3 min de pause : la série retombe à zéro
    const r2 = run({ userId: r.userId, cpsAt: () => 0, secs: 200, start: r.end });
    assert.strictEqual(responses.playerSection(r.userId, { config: cfg(), nowMs: r2.end }).observation.streak.valueMin, 0);
    // Puis plus aucune sauvegarde : « aucun contrôle reçu » au bout de 15 min
    assert.strictEqual(responses.playerSection(r.userId, { config: cfg(), nowMs: r2.end + 16 * 60_000 }).observation.stale, true);
  }
});

test('clics marqués isTrusted = false (constaté le 07/11) : « anomalie journalisée », score sous le seuil, aucun défi', () => {
  setMode('observe');
  const r = run({ cpsAt: t => (t <= 36 ? 8 : 0), secs: 60, untrusted: true });
  const o = responses.playerSection(r.userId, { config: cfg(), nowMs: r.end }).observation;
  assert.strictEqual(o.anomalies24h, 3);
  assert.strictEqual(o.lastAnomaly.type, 'untrusted_clicks');
  assert.strictEqual(o.shadowChallenges24h, 0);
  const risk = antibot.getRisk(r.userId, seasonId, r.end);
  assert.ok(risk.score < responses.getParams(cfg()).ab_challenge_score, `score ${risk.score}`);
  assert.strictEqual(challenges(r.userId).length, 0);
});

test('fenêtre courante en plein autoclic : cadence ≈ 8 clics/s affichée', () => {
  setMode('observe');
  const r = run({ cpsAt: () => 8, secs: 120 });
  const o = responses.playerSection(r.userId, { config: cfg(), nowMs: r.end }).observation;
  assert.ok(Math.abs(o.lastWindow.cps - 8) < 0.5, `cps ${o.lastWindow.cps}`);
  assert.strictEqual(o.lastWindow.secs, 12);
});

test('longue durée, Observation : 8 clics/s fixes et bruités ±30 % pendant 3 h → défi simulé ≈ 1/h', () => {
  setMode('observe');
  for (const jitter of [0, 0.3]) {
    const r = run({ cpsAt: () => 8, secs: 3 * 3600, jitter, rng: seeded(11) });
    const rows = challenges(r.userId);
    assert.ok(rows.length >= 2 && rows.length <= 3, `jitter ${jitter} : ${rows.length} défis simulés`);
    assert.ok(rows.every(c => c.status === 'shadow'));
    assert.strictEqual(responses.playerStatus(r.userId, { config: cfg(), nowMs: r.end }), null, 'rien de montré');
    // Observation : classement identique à « réponses Désactivé » (seuls #9/#10, inchangés, plafonnent)
    assert.strictEqual(ranked(r.userId), rankedWithoutResponses({ cpsAt: () => 8, secs: 3 * 3600, jitter, rng: seeded(11) }));
    assert.strictEqual(db.getDb().prepare('SELECT COALESCE(SUM(held_clicks), 0) AS n FROM antibot_challenges WHERE user_id = ?').get(r.userId).n, 0);
    assert.ok(responses.playerSection(r.userId, { config: cfg(), nowMs: r.end }).observation.shadowChallenges24h >= 2);
  }
});

test('faux positifs : humains 3 h avec pauses de 4–5 min (même à 8 clics/s) → aucun défi, même en Appliqué', () => {
  setMode('enforce');
  const profiles = [
    t => (t % 1500 < 1200 ? 6 : 0),   // 20 min / 5 min
    t => (t % 840 < 600 ? 8 : 0),     // 10 min / 4 min
    t => (t % 600 < 30 ? 12 : t % 600 < 360 ? 4 : 0),
  ];
  for (const cpsAt of profiles) {
    const r = run({ cpsAt, secs: 3 * 3600, jitter: 0.5, rng: seeded(3) });
    assert.strictEqual(challenges(r.userId).length, 0);
    assert.strictEqual(ranked(r.userId), rankedWithoutResponses({ cpsAt, secs: 3 * 3600, jitter: 0.5, rng: seeded(3) }));
  }
  setMode('observe');
});

test('recette : seuil court 2 min sur le compte en essai → défi réel en ≈ 2 min, blocs classés figés ; autres comptes inchangés', () => {
  setMode('observe');
  const before = { ...cfg() };
  const a = newUser(), b = newUser();
  // Un peu de minage normal avant le test (relevé de départ non nul)
  run({ userId: a, cpsAt: () => 4, secs: 60, start: T0 });
  responses.setForceMode(a, true);
  const set = responses.setTestThreshold(a, 2, { seasonId, nowMs: T0 + 70_000 });
  assert.strictEqual(set.testStreakMin, 2);
  assert.strictEqual(set.snapshot.manualBlocks, ranked(a));
  assert.ok(set.snapshot.rank >= 1);
  let challengedAt = null, rankedAtChallenge = null;
  const ra = run({ userId: a, cpsAt: () => 8, secs: 15 * 60, start: T0 + 70_000, onStep: (t, st) => {
    if (st?.challenge && challengedAt == null) { challengedAt = t; rankedAtChallenge = ranked(a); }
  } });
  // Série mesurée depuis la sauvegarde précédente (≈ 22 s avant l'activation) : défi entre 1 min 40 et 2 min 30
  assert.ok(challengedAt >= 100 && challengedAt <= 150, `défi après ${challengedAt} s`);
  const rows = challenges(a);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].status, 'pending');
  const why = JSON.parse(rows[0].reasons).reasons[0];
  assert.deepStrictEqual([why.code, why.threshold, why.test], ['continuous_mining', 2, true]);
  // Gel : l'autoclicker continue 13 min, plus aucun bloc manuel classé
  assert.strictEqual(ranked(a), rankedAtChallenge);
  const L = responses.playerSection(a, { config: cfg(), nowMs: ra.end });
  assert.strictEqual(L.state, 'challenge');
  assert.strictEqual(L.manualRanked, false);
  assert.strictEqual(L.testThreshold.minutes, 2);
  assert.strictEqual(L.testThreshold.now.manualBlocks, rankedAtChallenge);
  assert.ok(L.testThreshold.now.manualBlocks > L.testThreshold.before.manualBlocks, 'progression avant le défi visible');
  assert.strictEqual(L.observation.streak.testThreshold, true);
  // Même autoclicker sur un autre compte, sans essai : aucun défi en 15 min
  run({ userId: b, cpsAt: () => 8, secs: 15 * 60, start: T0 + 70_000 });
  assert.strictEqual(challenges(b).length, 0);
  assert.strictEqual(responses.playerSection(b, { config: cfg(), nowMs: ra.end }).observation.streak.thresholdMin, 60);
  // Fin du test : seuil et relevé effacés, réglages globaux intacts
  responses.cancelChallenge(db.getDb().prepare(`SELECT id FROM antibot_challenges WHERE user_id = ? AND status = 'pending'`).get(a).id);
  responses.setForceMode(a, false);
  const end = responses.playerSection(a, { config: cfg(), nowMs: ra.end });
  assert.strictEqual(end.testThreshold, null);
  assert.strictEqual(end.testEnforce, false);
  assert.strictEqual(end.observation.streak.thresholdMin, 60);
  const after = cfg();
  for (const k of ['antibot_response_mode', ...Object.keys(responses.PARAMS)]) assert.strictEqual(after[k], before[k], k);
  const row = db.getDb().prepare('SELECT test_streak_min, test_started_ms, test_snapshot FROM antibot_activity WHERE user_id = ?').get(a);
  assert.deepStrictEqual({ ...row }, { test_streak_min: null, test_started_ms: null, test_snapshot: null });
});

test('recette, client modifié qui continue à cliquer pendant le défi : suspension du seul compte d\'essai', () => {
  setMode('observe');
  const a = newUser();
  responses.setForceMode(a, true);
  responses.setTestThreshold(a, 1, { seasonId, nowMs: T0 });
  let suspendedAt = null;
  run({ userId: a, cpsAt: () => 8, secs: 6 * 60, official: false, start: T0, onStep: (t, st) => {
    if (st?.suspension && suspendedAt == null) suspendedAt = t;
  } });
  assert.ok(suspendedAt != null && suspendedAt <= 120, `suspension après ${suspendedAt} s`);
  const s = db.getDb().prepare('SELECT level, ends_ms - starts_ms AS d FROM antibot_suspensions WHERE user_id = ?').get(a);
  assert.deepStrictEqual([s.level, s.d], [1, 5 * 60_000]);
});

test('garde-fous : essai requis, bornes 1–10 min, expiration 2 h, sans effet hors essai ou en Désactivé', () => {
  setMode('observe');
  const a = newUser();
  assert.ok(responses.setTestThreshold(a, 2, { seasonId, nowMs: T0 }).error, 'essai requis');
  responses.setForceMode(a, true);
  assert.ok(responses.setTestThreshold(a, 0.5, { seasonId, nowMs: T0 }).error);
  assert.ok(responses.setTestThreshold(a, 11, { seasonId, nowMs: T0 }).error);
  assert.ok(responses.setTestThreshold(a, NaN, { seasonId, nowMs: T0 }).error);
  assert.strictEqual(responses.setTestThreshold(a, 3, { seasonId, nowMs: T0 }).testStreakMin, 3);
  const st = db.getDb().prepare('SELECT * FROM antibot_activity WHERE user_id = ?').get(a);
  assert.strictEqual(responses.testStreakMin(st, T0 + 3600_000), 3);
  assert.strictEqual(responses.testStreakMin(st, T0 + responses.TEST_STREAK_TTL_MS), null, 'expire seul après 2 h');
  assert.strictEqual(responses.playerSection(a, { config: cfg(), nowMs: T0 + responses.TEST_STREAK_TTL_MS + 1 }).testThreshold, null);
  assert.strictEqual(responses.testStreakMin({ ...st, force_mode: null }, T0), null, 'hors essai : aucun effet');
  // Global Désactivé : aucune mesure ni aucun défi, même avec le seuil court
  db.setAdminConfig('antibot_response_mode', 'off');
  run({ userId: a, cpsAt: () => 8, secs: 6 * 60, start: T0 });
  assert.strictEqual(challenges(a).length, 0);
  setMode('observe');
  // Retrait explicite
  assert.strictEqual(responses.setTestThreshold(a, null, { nowMs: T0 }).testStreakMin, null);
});
