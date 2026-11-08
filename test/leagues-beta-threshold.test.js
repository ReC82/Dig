/**
 * Seuil bêta des promotions (ticket #19, décision du propriétaire du 04/11/2026) :
 * min_active_players_per_league passe de 10 à 3, une seule fois, sans toucher aux autres réglages.
 * Couvre : décision appliquée une seule fois (redémarrages), retour arrière à 10 conservé, réglage
 * modifié entre-temps respecté ; moteur de promotion au seuil 3 (0, 1, 2 actifs → aucun promu ;
 * 3 et plus → formule actuelle, au moins un promu), égalités, auto-dig exclu, double clôture refusée.
 * Base temporaire hors server/data/, aucun serveur HTTP.
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-leagues-beta-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db      = require('../server/db');
const seasons = require('../server/seasons');

const KEY      = 'min_active_players_per_league';
const DECISION = 'issue19-beta-min-active-3';

function quiet(fn) {
  const log = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = log; }
}

quiet(() => db.initDb());
const sql = () => db.getDb();

const value     = () => sql().prepare('SELECT value FROM admin_config WHERE key = ?').get(KEY).value;
const decision  = () => sql().prepare('SELECT * FROM admin_config_decisions WHERE id = ?').get(DECISION);
const otherKeys = () => sql().prepare('SELECT key, value FROM admin_config WHERE key <> ? ORDER BY key').all(KEY);

/** Remet la base dans l'état d'avant la décision (seuil donné, décision jamais journalisée). */
function beforeDecision(v) {
  sql().prepare('DELETE FROM admin_config_decisions WHERE id = ?').run(DECISION);
  sql().prepare('UPDATE admin_config SET value = ? WHERE key = ?').run(v, KEY);
}

let userSeq = 0;
function newUser(leagueId) {
  return sql().prepare('INSERT INTO users (username, password_hash, league_id) VALUES (?, ?, ?)')
    .run(`beta_user_${++userSeq}`, 'x', leagueId).lastInsertRowid;
}

function play(seasonId, userId, depth, blocks, { reachedAt = null, autoBlocks = 0 } = {}) {
  const leagueId = sql().prepare('SELECT league_id FROM users WHERE id = ?').get(userId).league_id;
  sql().prepare(`
    INSERT INTO season_rankings
      (season_id, user_id, league_id, max_depth, reported_max_depth, manual_blocks,
       effective_manual_blocks, manual_clicks, auto_blocks, is_active, max_depth_reached_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(seasonId, userId, leagueId, depth, depth, blocks, blocks, blocks * 2, autoBlocks, reachedAt);
}

const levelOf = uid => sql().prepare(
  'SELECT l.level FROM users u JOIN leagues l ON l.id = u.league_id WHERE u.id = ?').get(uid).level;
const leagueAt = level => db.getLeagueByLevel(level);

function close() {
  const season = db.getActiveSeason();
  const { report } = quiet(() => seasons.closeActiveSeason(season.id, new Date()));
  return Object.fromEntries(report.map(r => [r.leagueLevel, r]));
}

// ── Décision de réglage ─────────────────────────────────────────────────────────

test('base au seuil 10 : passage à 3 une seule fois, autres réglages identiques', () => {
  beforeDecision('10');
  const others = otherKeys();
  quiet(() => db.initDb());
  assert.strictEqual(value(), '3');
  assert.strictEqual(decision().outcome, 'applied');
  assert.strictEqual(decision().old_value, '10');
  assert.deepStrictEqual(otherKeys(), others, 'aucun autre réglage modifié');
  assert.strictEqual(seasons.leagueSettings(db.getAdminConfig()).minPlayers, 3, 'le moteur lit le nouveau seuil');

  quiet(() => db.initDb());
  assert.strictEqual(value(), '3');
  assert.strictEqual(sql().prepare('SELECT COUNT(*) n FROM admin_config_decisions WHERE id = ?').get(DECISION).n, 1);
});

test('retour arrière à 10 depuis le panel : conservé après redémarrage', () => {
  db.setAdminConfig(KEY, '10');
  quiet(() => db.initDb());
  assert.strictEqual(value(), '10');
  assert.strictEqual(seasons.leagueSettings(db.getAdminConfig()).minPlayers, 10);
  db.setAdminConfig(KEY, '3');
});

test('seuil déjà modifié dans le panel avant la décision : laissé tel quel', () => {
  beforeDecision('5');
  quiet(() => db.initDb());
  assert.strictEqual(value(), '5');
  assert.strictEqual(decision().outcome, 'skipped');
  beforeDecision('10');
  quiet(() => db.initDb());
  assert.strictEqual(value(), '3');
});

// ── Moteur de promotion au seuil 3 (formule inchangée) ──────────────────────────

test('0, 1, 2 actifs : aucune promotion ; 3 actifs : un promu', () => {
  const lvl = leagueAt(0);
  assert.strictEqual(close()[0], undefined, '0 actif : ligue ignorée');

  for (const n of [1, 2]) {
    const season = db.getActiveSeason();
    const ids = Array.from({ length: n }, (_, i) => { const u = newUser(lvl.id); play(season.id, u, 100 - i, 5); return u; });
    const r = close()[0];
    assert.strictEqual(r.skipped, true, `${n} actif(s)`);
    assert.strictEqual(r.reason, 'not_enough_players');
    assert.strictEqual(r.promoted, 0);
    ids.forEach(u => assert.strictEqual(levelOf(u), 0));
  }

  const season = db.getActiveSeason();
  const ids = Array.from({ length: 3 }, (_, i) => { const u = newUser(lvl.id); play(season.id, u, 300 - i, 5); return u; });
  const r = close()[0];
  assert.strictEqual(r.promoted, 1, 'floor(3 × 0,5) = 1');
  assert.deepStrictEqual(ids.map(levelOf), [1, 0, 0]);
});

test('3 actifs et plus : formule actuelle par niveau', () => {
  const cases = [[4, 0, 2], [7, 0, 3], [3, 1, 1], [7, 1, 2]];   // [actifs, niveau, promus attendus]
  for (const [n, level, want] of cases) {
    const lvl = leagueAt(level) ?? leagueAt(0);
    const season = db.getActiveSeason();
    Array.from({ length: n }, (_, i) => { const u = newUser(lvl.id); play(season.id, u, 500 - i, 5); return u; });
    const r = close()[lvl.level];
    assert.strictEqual(r.promoted, Math.min(n, Math.max(1, Math.floor(n * 0.5 / (1 + lvl.level * 0.45)))));
    if (lvl.level === level) assert.strictEqual(r.promoted, want, `${n} actifs, niveau ${level}`);
  }
});

test('seuil 3 (#73) : promotion aux blocs manuels validés, profondeur et auto-dig ignorés ; double clôture refusée', () => {
  const lvl = leagueAt(0);
  const season = db.getActiveSeason();
  const a = newUser(lvl.id), b = newUser(lvl.id), c = newUser(lvl.id), d = newUser(lvl.id);
  play(season.id, a, 400, 10, { autoBlocks: 50000 });
  play(season.id, b, 400, 11);
  play(season.id, c, 399, 90);
  play(season.id, d, 100, 1);
  // Compte 100 % auto-dig : ni actif ni promu.
  const bot = newUser(lvl.id);
  db.updateAutoBlocksOnly(season.id, bot, 90000);
  sql().prepare('UPDATE season_rankings SET max_depth = 99999 WHERE season_id = ? AND user_id = ?').run(season.id, bot);

  const r = close()[0];
  assert.strictEqual(r.activePlayers, 4);
  assert.deepStrictEqual(r.promotedUsers.map(p => p.userId), [c, b], 'c (90 blocs, 399 m) devant les plus profonds');
  assert.deepStrictEqual(r.promotedUsers.map(p => p.manualBlocks), [90, 11]);
  assert.strictEqual(levelOf(a), 0, 'profondeur 400 m + énorme auto-dig : non promu');
  assert.strictEqual(levelOf(bot), 0);
  assert.throws(() => seasons.closeActiveSeason(season.id, new Date()), /déjà/);
  assert.deepStrictEqual([a, b, c, d].map(levelOf), [0, 1, 1, 0]);
});

test.after(() => {
  try { db.getDb().close(); } catch { /* déjà fermée */ }
  fs.rmSync(dir, { recursive: true, force: true });
});
