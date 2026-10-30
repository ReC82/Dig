/**
 * Tests des ligues et promotions, ticket #19.
 * Comportement ACTUEL (promotion seule, sans relégation ni récompense) sur 3 ligues × 30 joueurs
 * simulés, plus le départage déterministe (user_id) et les index de tri.
 * Base temporaire hors server/data/, aucun serveur HTTP.
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-leagues-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db      = require('../server/db');
const seasons = require('../server/seasons');

db.initDb();
const sql = () => db.getDb();

// Les logs de clôture sont verbeux : on les coupe pendant les clôtures.
function quiet(fn) {
  const log = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = log; }
}

let userSeq = 0;
function newUser(leagueId) {
  return sql().prepare('INSERT INTO users (username, password_hash, league_id) VALUES (?, ?, ?)')
    .run(`league_user_${++userSeq}`, 'x', leagueId).lastInsertRowid;
}

/** Ligne de classement saisonnier « active » (comme après une sauvegarde validée). */
function rank(seasonId, userId, leagueId, depth, blocks, { active = 1 } = {}) {
  sql().prepare(`
    INSERT INTO season_rankings
      (season_id, user_id, league_id, max_depth, reported_max_depth, manual_blocks,
       effective_manual_blocks, manual_clicks, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(seasonId, userId, leagueId, depth, depth, blocks, blocks, blocks * 2, active);
}

const leagueOf = (userId) => sql().prepare('SELECT league_id FROM users WHERE id = ?').get(userId).league_id;

/** Empreinte des données joueurs : la clôture ne doit rien réécrire hormis users.league_id. */
function fingerprint() {
  return {
    users:    sql().prepare('SELECT id, username, password_hash, email, created_at FROM users ORDER BY id').all(),
    rankings: sql().prepare('SELECT * FROM season_rankings ORDER BY id').all(),
    saves:    sql().prepare('SELECT * FROM user_saves ORDER BY user_id').all(),
  };
}

function setConfig(key, value) {
  sql().prepare('INSERT OR REPLACE INTO admin_config (key, value) VALUES (?, ?)').run(key, String(value));
}

// ── 3 ligues × 30 joueurs ────────────────────────────────────────────────────

test('3 ligues × 30 joueurs : promus par ligue, ligue supérieure créée, aucune double promotion', () => {
  const season = db.getActiveSeason();
  const mimosa = db.getLeagueByLevel(0);
  const bronze = db.createLeague('Bronze', '🥉', 1, 1, null, 1);
  const argent = db.createLeague('Argent', '🥈', 2, 1, null, 2);
  const tiers  = [mimosa, bronze, argent];

  // Joueurs : profondeur décroissante avec l'ordre de création (le 1er est le meilleur).
  const players = {};
  for (const league of tiers) {
    players[league.id] = [];
    for (let i = 0; i < 30; i++) {
      const uid = newUser(league.id);
      rank(season.id, uid, league.id, 1000 - i * 10, 500 - i);
      players[league.id].push(uid);
    }
  }
  // Un inactif (aucun bloc manuel) par ligue : ne compte ni dans l'effectif ni dans la promotion.
  const idle = tiers.map(l => { const u = newUser(l.id); rank(season.id, u, l.id, 5000, 0, { active: 0 }); return u; });

  const before = fingerprint();
  const { report, closedSeason, newSeason } = quiet(() => seasons.closeActiveSeason(season.id, new Date()));

  // promotion_rate 0.50, difficulty 0.45 : floor(30 × 0.5 / (1 + level × 0.45))
  const expected = [15, 10, 7];
  tiers.forEach((league, lvl) => {
    const r = report.find(x => x.leagueId === league.id);
    assert.ok(r && !r.skipped, `ligue ${league.name} traitée`);
    assert.strictEqual(r.activePlayers, 30, `${league.name} : 30 actifs (inactif exclu)`);
    assert.strictEqual(r.promoted, expected[lvl], `${league.name} : ${expected[lvl]} promus`);
    assert.ok(r.promoted >= 1, 'au moins un promu par ligue éligible');
    // Les promus sont exactement les meilleurs du tri de classement.
    assert.deepStrictEqual(r.promotedUsers.map(p => p.userId), players[league.id].slice(0, expected[lvl]));
  });

  // Ligue 4 créée à la volée : pas de limite au nombre de ligues.
  const or = db.getLeagueByLevel(3);
  assert.ok(or, 'ligue de niveau 3 créée');
  assert.strictEqual(or.name, 'Or');

  // Chaque joueur monte d'au plus un niveau ; les non-promus restent (pas de relégation actuellement).
  const next = { [mimosa.id]: bronze.id, [bronze.id]: argent.id, [argent.id]: or.id };
  tiers.forEach((league, lvl) => {
    players[league.id].forEach((uid, i) => {
      const want = i < expected[lvl] ? next[league.id] : league.id;
      assert.strictEqual(leagueOf(uid), want, `joueur ${i + 1} de ${league.name}`);
    });
  });
  idle.forEach((uid, lvl) => assert.strictEqual(leagueOf(uid), tiers[lvl].id, 'inactif non promu'));

  // Aucune donnée joueur réécrite : seuls users.league_id a changé.
  assert.deepStrictEqual(fingerprint(), before);

  assert.strictEqual(closedSeason.status, 'closed');
  assert.strictEqual(JSON.parse(closedSeason.config).promotionApplied, true);
  assert.strictEqual(newSeason.status, 'active');
  assert.throws(() => seasons.closeActiveSeason(season.id, new Date()), /déjà/, 'double clôture refusée');
});

test('seuil min_active_players_per_league : 9 actifs → aucune promotion, 10 → au moins un promu', () => {
  setConfig('min_active_players_per_league', 10);
  const season = db.getActiveSeason();
  const low  = db.getLeagueByLevel(0);
  const high = db.getLeagueByLevel(3);  // « Or », créée au test précédent
  const lowIds  = Array.from({ length: 9 },  (_, i) => { const u = newUser(low.id);  rank(season.id, u, low.id,  100 - i, 10); return u; });
  const highIds = Array.from({ length: 10 }, (_, i) => { const u = newUser(high.id); rank(season.id, u, high.id, 100 - i, 10); return u; });

  const { report } = quiet(() => seasons.closeActiveSeason(season.id, new Date()));
  const rLow  = report.find(r => r.leagueId === low.id);
  const rHigh = report.find(r => r.leagueId === high.id);
  assert.strictEqual(rLow.skipped, true);
  assert.strictEqual(rLow.reason, 'not_enough_players');
  lowIds.forEach(u => assert.strictEqual(leagueOf(u), low.id));
  // 10 × 0.5 / (1 + 3 × 0.45) = 2.13 → 2 promus vers le niveau 4 (créé)
  assert.strictEqual(rHigh.promoted, 2);
  assert.strictEqual(leagueOf(highIds[0]), db.getLeagueByLevel(4).id);
  assert.strictEqual(leagueOf(highIds[2]), high.id);
});

// ── Départage déterministe ───────────────────────────────────────────────────

test('ex æquo parfaits départagés par user_id croissant, quel que soit l\'ordre d\'insertion', () => {
  setConfig('min_active_players_per_league', 2);
  setConfig('promotion_rate', 0.5);
  const season = db.getActiveSeason();
  const league = db.createLeague('Test ex æquo', '🧪', 50, 1, null, 50);
  const a = newUser(league.id);  // id le plus petit
  const b = newUser(league.id);
  const c = newUser(league.id);
  const d = newUser(league.id);
  // Insertions dans le désordre ; b, a, c à égalité parfaite ; d dernier.
  rank(season.id, d, league.id, 10, 5);
  rank(season.id, c, league.id, 20, 7);
  rank(season.id, b, league.id, 20, 7);
  rank(season.id, a, league.id, 20, 7);

  const board = db.getLeagueLeaderboard(season.id, league.id, 10, 0);
  assert.deepStrictEqual(board.map(r => r.user_id), [a, b, c, d]);
  assert.deepStrictEqual(board.map(r => r.rank_in_league), [1, 2, 3, 4]);
  assert.strictEqual(db.getPlayerLeagueRank(season.id, b, league.id), 2);
  assert.strictEqual(db.getPlayerLeagueRank(season.id, c, league.id), 3);

  const global = db.getSeasonLeaderboard(season.id, 100, 0).filter(r => r.league_id === league.id);
  assert.deepStrictEqual(global.map(r => r.user_id), [a, b, c, d]);
  const ga = db.getPlayerSeasonRank(season.id, a).rank_global;
  const gb = db.getPlayerSeasonRank(season.id, b).rank_global;
  assert.ok(ga < gb, 'rang global : a avant b');

  // floor(4 × 0.5 / (1 + 50 × 0.45)) = 0 → max(1, 0) = 1 promu : a (et non b ni c).
  const { report } = quiet(() => seasons.closeActiveSeason(season.id, new Date()));
  const r = report.find(x => x.leagueId === league.id);
  assert.deepStrictEqual(r.promotedUsers.map(p => p.userId), [a]);
});

// ── Index ────────────────────────────────────────────────────────────────────

test('index de tri présents et utilisés par le classement de ligue', () => {
  const names = sql().prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='season_rankings'")
    .all().map(r => r.name);
  assert.ok(names.includes('idx_rankings_sort'));
  assert.ok(names.includes('idx_rankings_league_sort'));
  // Les anciens index sont conservés (ajout seul).
  assert.ok(names.includes('idx_rankings'));

  const plan = sql().prepare(`
    EXPLAIN QUERY PLAN
    SELECT user_id FROM season_rankings
    WHERE season_id = 1 AND league_id = 1 AND is_active = 1 AND manual_blocks > 0
    ORDER BY max_depth DESC, effective_manual_blocks DESC, user_id ASC
  `).all().map(r => r.detail).join(' | ');
  assert.match(plan, /idx_rankings_league_sort/);
  assert.doesNotMatch(plan, /TEMP B-TREE/, 'tri sans table temporaire');

  // initDb rejouée : idempotente.
  assert.doesNotThrow(() => db.initDb());
});

test.after(() => {
  try { db.getDb().close(); } catch (_) {}
  fs.rmSync(dir, { recursive: true, force: true });
});
