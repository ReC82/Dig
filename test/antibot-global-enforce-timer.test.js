/**
 * Ticket #25 — décisions du propriétaire du 08/11/2026 (issuecomment-6722088344, -6722134355,
 * -6721915229) :
 *   1. défis et suspensions du minage manuel « Appliqué » pour tous, une seule fois, par la
 *      décision de réglage journalisée (admin_config_decisions) ; l'arrêt d'urgence (retour à
 *      Observation depuis le panel) n'est jamais écrasé par un redémarrage ;
 *   2. chrono de l'énigme : 30 s (visuelle) / 60 s (accessible) par défaut, réglables et bornés,
 *      expiration serveur fiable (+ marge réseau), jamais de sanction pour un temps écoulé.
 * Base temporaire hors server/data/, horloge simulée, aucun serveur HTTP.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-antibot-enforce-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db        = require('../server/db');
const responses = require('../server/antibotResponses');

const KEY      = 'antibot_response_mode';
const DECISION = 'issue25-global-enforce-2026-11-08';
const T0 = Date.UTC(2026, 10, 9, 8, 0, 0);

function quiet(fn) {
  const log = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = log; }
}

quiet(() => db.initDb());
const sql = () => db.getDb();
const value    = () => sql().prepare('SELECT value FROM admin_config WHERE key = ?').get(KEY).value;
const decision = () => sql().prepare('SELECT * FROM admin_config_decisions WHERE id = ?').get(DECISION);
const otherKeys = () => sql().prepare('SELECT key, value FROM admin_config WHERE key <> ? ORDER BY key').all(KEY);

function beforeDecision(v) {
  sql().prepare('DELETE FROM admin_config_decisions WHERE id = ?').run(DECISION);
  sql().prepare('UPDATE admin_config SET value = ? WHERE key = ?').run(v, KEY);
}

let seq = 0;
const newUser = () => Number(sql().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(`enf_${++seq}`, 'x').lastInsertRowid);

// ── 1. Activation globale ───────────────────────────────────────────────────────

test('base en Observation : passage en Appliqué une seule fois, autres réglages identiques', () => {
  beforeDecision('observe');
  const others = otherKeys();
  quiet(() => db.initDb());
  assert.strictEqual(value(), 'enforce');
  assert.strictEqual(decision().outcome, 'applied');
  assert.strictEqual(decision().old_value, 'observe');
  assert.deepStrictEqual(otherKeys(), others, 'seuils, paliers et autres modes inchangés');
  assert.strictEqual(responses.getGlobalMode(db.getAdminConfig(), {}), 'enforce');
});

test('arrêt d\'urgence (retour à Observation) conservé après redémarrage', () => {
  beforeDecision('observe');
  quiet(() => db.initDb());
  db.setAdminConfig(KEY, 'observe');
  quiet(() => db.initDb());
  quiet(() => db.initDb());
  assert.strictEqual(value(), 'observe', 'la décision n\'est jamais rejouée');
});

test('réglage modifié entre-temps (Désactivé) : respecté, décision notée « skipped »', () => {
  beforeDecision('off');
  quiet(() => db.initDb());
  assert.strictEqual(value(), 'off');
  assert.strictEqual(decision().outcome, 'skipped');
});

test('ANTIBOT=off coupe toujours tout, même en Appliqué', () => {
  assert.strictEqual(responses.getGlobalMode({ antibot_response_mode: 'enforce' }, { ANTIBOT: 'off' }), 'off');
});

// ── 2. Chrono de l'énigme ───────────────────────────────────────────────────────

function pendingChallenge(config) {
  const season = db.getActiveSeason() ?? db.createSeason('Test #25 chrono', '2026-11-01 00:00:00', '2026-11-30 23:59:59', 'active');
  const u = newUser();
  responses.setForceMode(u, true, T0);
  responses.issueChallenge(u, season.id, { mode: 'enforce', reasons: ['admin_test'], metrics: {}, origin: 'admin', nowMs: T0 });
  const ch = sql().prepare("SELECT id FROM antibot_challenges WHERE user_id = ? AND status = 'pending'").get(u);
  assert.ok(ch, 'défi en attente');
  return { u, id: ch.id };
}

test('défauts 30 s / 60 s, marge réseau de 5 s, aucune sanction à l\'expiration', () => {
  const config = db.getAdminConfig();
  assert.strictEqual(config.ab_puzzle_seconds, '30');
  assert.strictEqual(config.ab_puzzle_text_seconds, '60');
  const { u, id } = pendingChallenge(config);
  let p = responses.newPuzzle(u, id, { config, nowMs: T0 });
  assert.strictEqual(p.seconds, 30);
  assert.strictEqual(Date.parse(p.expiresAt), T0 + 30_000 + responses.PUZZLE_GRACE_MS);
  const good = p.targets.map(t => p.tiles.findIndex(x => x.sym === t)).join(',');
  // Juste avant la limite (latence) : accepté
  assert.strictEqual(responses.answer(u, id, p.puzzleId, good, { nowMs: T0 + 34_000 }).solved, true);

  const b = pendingChallenge(config);
  p = responses.newPuzzle(b.u, b.id, { kind: 'text', config, nowMs: T0 });
  assert.strictEqual(p.seconds, 60);
  assert.strictEqual(responses.answer(b.u, b.id, p.puzzleId, String(p.a + p.b), { nowMs: T0 + 65_001 }).reason, 'expired');
  // Nouvelle énigme : chrono complet, résolue ; aucune suspension, aucun palier
  p = responses.newPuzzle(b.u, b.id, { kind: 'text', config, nowMs: T0 + 70_000 });
  assert.strictEqual(responses.answer(b.u, b.id, p.puzzleId, String(p.a + p.b), { nowMs: T0 + 80_000 }).solved, true);
  assert.strictEqual(sql().prepare('SELECT COUNT(*) AS n FROM antibot_suspensions WHERE user_id = ?').get(b.u).n, 0);
  assert.strictEqual(sql().prepare('SELECT violation_level FROM antibot_activity WHERE user_id = ?').get(b.u).violation_level, 0);
});

test('durée réglable et bornée ; renouvellement plafonné (pas de chrono infini)', () => {
  assert.deepStrictEqual(responses.validateConfigValue('ab_puzzle_seconds', '45'), { value: '45' });
  assert.ok(responses.validateConfigValue('ab_puzzle_seconds', '5').error);
  assert.ok(responses.validateConfigValue('ab_puzzle_text_seconds', '9999').error);
  const config = { ...db.getAdminConfig(), ab_puzzle_seconds: '45', ab_puzzle_text_seconds: 'abc' };
  const { u, id } = pendingChallenge(config);
  assert.strictEqual(responses.newPuzzle(u, id, { config, nowMs: T0 }).seconds, 45);
  assert.strictEqual(responses.newPuzzle(u, id, { kind: 'text', config, nowMs: T0 + 1 }).seconds, 60, 'valeur invalide → défaut');
  let last;
  for (let i = 2; i < responses.PUZZLE_MAX_PER_WINDOW + 2; i++) last = responses.newPuzzle(u, id, { config, nowMs: T0 + i });
  assert.strictEqual(last.error, 'too_many');
});
