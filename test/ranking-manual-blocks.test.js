/**
 * Tests du classement aux blocs détruits manuellement, ticket #73 (décision du 04/11/2026) :
 * - rang = blocs manuels validés par le serveur ; la profondeur ne compte ni au score ni au
 *   départage (classement global, ligue, rang du joueur, promotions, instantané figé) ;
 * - 0 bloc manuel (Auto-Dig seul) ou blocs refusés par l'anti-autoclic : aucun rang ;
 * - égalités : premier à avoir atteint le total, puis identifiant ; date posée seulement quand
 *   le total validé change (une sauvegarde rejouée ne déplace personne) ;
 * - instantanés « merit-v1 » existants : toujours vérifiables, jamais recalculés ;
 * - points : ex æquo = mêmes blocs validés (v2), mêmes blocs ET profondeur (v1, historique).
 * Base temporaire hors server/data/, aucun serveur lancé. Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-manual-rank-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const cal       = require('../server/seasonCalendar');
const db        = require('../server/db');
const seasons   = require('../server/seasons');
const standings = require('../server/standings');
const points    = require('../server/rewardPoints');

db.initDb();
const conn = () => db.getDb();

let userSeq = 0;
function newUser() {
  return conn().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(`manual_rank_${++userSeq}`, 'x').lastInsertRowid;
}

function putRanking(seasonId, userId, { depth, blocks, effective = blocks, reachedAt = null, depthReachedAt = null, leagueId = null, auto = 0 }) {
  conn().prepare(`
    INSERT INTO season_rankings (season_id, user_id, league_id, max_depth, reported_max_depth, manual_blocks,
                                 effective_manual_blocks, auto_blocks, is_active, max_depth_reached_at, manual_blocks_reached_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
    .run(seasonId, userId, leagueId, depth, depth, blocks, effective, auto, depthReachedAt, reachedAt);
}

function pastSeason(name, weeksAgo) {
  const start = new Date(Date.UTC(2025, 0, 6) + weeksAgo * 7 * 86400_000);
  const end   = new Date(start.getTime() + 7 * 86400_000 - 1000);
  return db.createSeason(name, cal.fmtUtc(start), cal.fmtUtc(end), 'closed');
}

const league = db.getLowestLeague();

test('migration #73 : colonnes et index ajoutés, idempotente', () => {
  const cols = t => conn().prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
  assert.ok(cols('season_rankings').includes('manual_blocks_reached_at'));
  assert.ok(cols('season_standings').includes('manual_blocks_reached_at'));
  const idx = conn().prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(r => r.name);
  assert.ok(idx.includes('idx_rankings_blocks_sort') && idx.includes('idx_rankings_league_blocks_sort'));
  db.initDb(); // deuxième passage sans erreur
});

test('tableau à 3 joueurs : le stress test du 04/11 (589 m avec 17 blocs manuels) ne prend pas la tête', () => {
  const s = pastSeason('Trois joueurs', 1);
  const deep = newUser(), manual = newUser(), mid = newUser();
  putRanking(s.id, deep,   { depth: 589, blocks: 25, effective: 17, auto: 600, leagueId: league.id });
  putRanking(s.id, manual, { depth: 145, blocks: 116, leagueId: league.id });
  putRanking(s.id, mid,    { depth: 114, blocks: 65, leagueId: league.id });

  const expected = [manual, mid, deep];
  assert.deepStrictEqual(db.getSeasonLeaderboard(s.id).map(r => r.user_id), expected);
  assert.deepStrictEqual(db.getSeasonLeaderboard(s.id).map(r => r.rank), [1, 2, 3]);
  assert.deepStrictEqual(db.getLeagueLeaderboard(s.id, league.id).map(r => r.user_id), expected);
  assert.deepStrictEqual(db.getAllActivePlayersInLeague(s.id, league.id).map(r => r.user_id), expected, 'promotions');
  assert.deepStrictEqual(db.getSeasonParticipantsRanked(s.id).map(r => r.user_id), expected, 'instantané figé');
  assert.strictEqual(db.getPlayerSeasonRank(s.id, deep).rank_global, 3);
  assert.strictEqual(db.getPlayerLeagueRank(s.id, deep, league.id), 3);
  assert.strictEqual(db.getPlayerSeasonRank(s.id, manual).rank_global, 1);

  // Réponses API (global et ligue) : rang, blocs validés affichés, profondeur en donnée secondaire
  assert.deepStrictEqual(seasons.buildGlobalLeaderboard(s.id, 1).leaderboard.map(r => [r.rank, r.manualBlocks, r.maxDepth]),
    [[1, 116, 145], [2, 65, 114], [3, 17, 589]]);
  assert.deepStrictEqual(seasons.buildLeagueLeaderboard(s.id, league.id, 1).leaderboard.map(r => [r.rank, r.userId]),
    [[1, manual], [2, mid], [3, deep]]);
});

test('profondeur sans effet : même nombre de blocs → premier arrivé, puis identifiant, jamais la profondeur', () => {
  const s = pastSeason('Égalités', 2);
  const a = newUser(), b = newUser(), c = newUser(), d = newUser(), e = newUser();
  putRanking(s.id, a, { depth: 900, blocks: 40, reachedAt: '2025-02-01 10:00:05.000' });
  putRanking(s.id, b, { depth: 41,  blocks: 40, reachedAt: '2025-02-01 10:00:01.000' });
  putRanking(s.id, c, { depth: 300, blocks: 40, reachedAt: null }); // total atteint avant la règle
  putRanking(s.id, d, { depth: 50,  blocks: 40, reachedAt: '2025-02-01 10:00:01.000' }); // même instant que b
  putRanking(s.id, e, { depth: 5000, blocks: 39 });
  assert.deepStrictEqual(db.getSeasonLeaderboard(s.id).map(r => r.user_id), [c, b, d, a, e]);
  // Ordre indépendant de l'ordre d'insertion
  const rows = standings.computeStandings(db.getSeasonParticipantsRanked(s.id));
  assert.deepStrictEqual(rows.map(r => [r.user_id, r.rank]), [[c, 1], [b, 2], [d, 3], [a, 4], [e, 5]]);
});

test('0 bloc manuel validé : Auto-Dig seul ou blocs refusés → aucun rang ; instantané : exclu avec motif', () => {
  const s = pastSeason('Sans blocs validés', 3);
  const ok = newUser(), refused = newUser(), autoOnly = newUser();
  putRanking(s.id, ok,      { depth: 20,  blocks: 3 });
  putRanking(s.id, refused, { depth: 800, blocks: 50, effective: 0 });
  // Auto-Dig seul : jamais actif (recordManualBreaks n'est pas appelé)
  conn().prepare('INSERT INTO season_rankings (season_id, user_id, max_depth, auto_blocks, is_active) VALUES (?, ?, 700, 700, 0)').run(s.id, autoOnly);

  assert.deepStrictEqual(db.getSeasonLeaderboard(s.id).map(r => r.user_id), [ok]);
  assert.strictEqual(db.countSeasonActivePlayers(s.id), 1);
  assert.strictEqual(db.getPlayerSeasonRank(s.id, refused), null);
  assert.strictEqual(db.getPlayerSeasonRank(s.id, autoOnly), null);

  const rows = standings.computeStandings(db.getSeasonParticipantsRanked(s.id));
  assert.deepStrictEqual(rows.map(r => [r.user_id, r.eligible, r.exclusion_reason]),
    [[ok, 1, null], [refused, 0, 'no_validated_blocks']]);
});

test('sauvegardes réelles : Auto-Dig seul non classé, compteur forgé refusé, sauvegarde rejouée sans gain', () => {
  const active = db.getActiveSeason();
  const t0 = Date.now();
  const autoOnly = newUser(), forged = newUser(), human = newUser();

  // Auto-Dig seul : 120 blocs automatiques, aucun bloc manuel
  seasons.syncPlayerRanking(autoOnly, { seasonId: active.id, maxDepth: 121, manualBlocks: 0, autoBlocks: 120, manualClicks: 0 });
  assert.strictEqual(db.getPlayerSeasonRank(active.id, autoOnly), null);
  assert.strictEqual(db.getPlayerSeasonEntry(active.id, autoOnly)?.is_active ?? 0, 0);

  // Compteur forgé : 50 « blocs manuels » sans aucun clic → 0 validé, pas de rang
  seasons.syncPlayerRanking(forged, { seasonId: active.id, maxDepth: 51, manualBlocks: 50, autoBlocks: 0, manualClicks: 0 });
  assert.strictEqual(db.getPlayerSeasonEntry(active.id, forged).effective_manual_blocks, 0);
  assert.strictEqual(db.getPlayerSeasonRank(active.id, forged), null);

  // Joueur humain : 5 blocs pour 15 clics (la validation de profondeur #9 peut différer une
  // partie des blocs à la sauvegarde suivante : jamais plus que déclaré)
  const save = { seasonId: active.id, maxDepth: 6, manualBlocks: 5, autoBlocks: 0, manualClicks: 15 };
  seasons.syncPlayerRanking(human, save);
  const e1 = db.getPlayerSeasonEntry(active.id, human);
  assert.strictEqual(e1.is_active, 1);
  assert.ok(e1.effective_manual_blocks <= 5, `validés=${e1.effective_manual_blocks}`);
  // Même sauvegarde rejouée : ni bloc en plus, ni date déplacée
  seasons.syncPlayerRanking(human, save);
  const e2 = db.getPlayerSeasonEntry(active.id, human);
  assert.strictEqual(e2.effective_manual_blocks, e1.effective_manual_blocks);
  assert.strictEqual(e2.manual_blocks_reached_at, e1.manual_blocks_reached_at);
  assert.ok(Date.now() - t0 < 60_000);
});

test('updateEffectiveBlocks : jamais plus que les blocs déclarés ; date seulement si le total change', () => {
  const s = pastSeason('Date du total', 4);
  const u = newUser();
  putRanking(s.id, u, { depth: 30, blocks: 10, effective: 0 });
  db.updateEffectiveBlocks(s.id, u, 25);
  let e = db.getPlayerSeasonEntry(s.id, u);
  assert.strictEqual(e.effective_manual_blocks, 10, 'plafonné aux blocs déclarés');
  const first = e.manual_blocks_reached_at;
  assert.ok(first);
  db.updateEffectiveBlocks(s.id, u, 10);
  e = db.getPlayerSeasonEntry(s.id, u);
  assert.strictEqual(e.manual_blocks_reached_at, first, 'total inchangé : date conservée');
  // Correction admin : la date suit le nouveau total
  db.correctSeasonRanking(s.id, u, { effectiveManualBlocks: 4 });
  e = db.getPlayerSeasonEntry(s.id, u);
  assert.strictEqual(e.effective_manual_blocks, 4);
  assert.ok(e.manual_blocks_reached_at >= first);
});

test('instantané merit-v2 : ordre aux blocs, départage figé, empreintes valides ; merit-v1 toujours vérifiable', () => {
  // Instantané historique « merit-v1 » (forme canonique d'avant #73), inséré tel quel
  const old = pastSeason('Historique v1', 10);
  const u1 = newUser(), u2 = newUser();
  const v1rows = [
    { position: 1, rank: 1, rank_in_league: 1, user_id: u1, league_id: null, max_depth: 500, effective_manual_blocks: 5,
      manual_blocks: 5, max_depth_reached_at: null, eligible: 1, exclusion_reason: null, risk_level: 0 },
    { position: 2, rank: 2, rank_in_league: 2, user_id: u2, league_id: null, max_depth: 100, effective_manual_blocks: 90,
      manual_blocks: 90, max_depth_reached_at: null, eligible: 1, exclusion_reason: null, risk_level: 0 },
  ];
  const F = standings.ROW_FIELDS_V1;
  for (const r of v1rows) {
    conn().prepare(`INSERT INTO season_standings (season_id, ${F.join(', ')}) VALUES (?, ${F.map(() => '?').join(', ')})`)
      .run(old.id, ...F.map(f => r[f]));
  }
  const sha = x => crypto.createHash('sha256').update(x).digest('hex');
  const snap = { season_id: old.id, created_at: '2025-03-20 00:00:00', source: 'close', algorithm: 'merit-v1',
    season_start: old.start_at, season_end: old.end_at, participants: 2, eligible: 2, leader_user_id: u1,
    prize_mode: 'simulation', rows_hash: sha(JSON.stringify(v1rows.map(r => F.map(f => r[f] ?? null)))), prev_hash: null };
  snap.snapshot_hash = sha(JSON.stringify([snap.season_id, snap.created_at, snap.source, snap.algorithm, snap.season_start,
    snap.season_end, snap.participants, snap.eligible, snap.leader_user_id, snap.prize_mode, snap.rows_hash, snap.prev_hash]));
  const cols = Object.keys(snap);
  conn().prepare(`INSERT INTO season_snapshots (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map(c => snap[c]));
  assert.deepStrictEqual(standings.verifySnapshot(old.id), { ok: true, rowsHashOk: true, snapshotHashOk: true, chainOk: true });
  // Le résultat historique n'est pas réécrit : u1 (profondeur) reste 1er
  assert.strictEqual(standings.buildStandings(old.id).standings[0].userId, u1);
  assert.strictEqual(standings.buildStandings(old.id).snapshot.algorithm, 'merit-v1');

  // Nouvelle clôture : merit-v2
  const s = pastSeason('Clôture v2', 5);
  const deep = newUser(), manual = newUser();
  putRanking(s.id, deep,   { depth: 900, blocks: 10, reachedAt: '2025-02-10 08:00:00.000' });
  putRanking(s.id, manual, { depth: 60,  blocks: 59, reachedAt: '2025-02-10 09:00:00.000' });
  const { snapshot, created } = standings.freezeSeasonStandings(s.id);
  assert.ok(created);
  assert.strictEqual(snapshot.algorithm, 'merit-v2');
  assert.strictEqual(snapshot.leader_user_id, manual);
  const frozen = conn().prepare('SELECT * FROM season_standings WHERE season_id = ? ORDER BY position').all(s.id);
  assert.deepStrictEqual(frozen.map(r => [r.user_id, r.rank]), [[manual, 1], [deep, 2]]);
  assert.strictEqual(frozen[0].manual_blocks_reached_at, '2025-02-10 09:00:00.000', 'départage figé');
  assert.ok(standings.verifySnapshot(s.id).ok);
  assert.ok(standings.verifySnapshot(old.id).ok, 'chaîne : v1 toujours valide après un v2');
  // Correction ultérieure du classement vivant : aucun effet sur l'instantané
  db.correctSeasonRanking(s.id, deep, { effectiveManualBlocks: 9999 });
  assert.strictEqual(standings.buildStandings(s.id).standings[0].userId, manual);
});

test('points : ex æquo = mêmes blocs validés (v2) ; v1 historique : même profondeur aussi', () => {
  const SCALE = points.validateScale({ tiers: [
    { id: 'first', label: '1er', points: 100, rankMax: 1 },
    { id: 'top50', label: 'Top 50 %', points: 12, percentMax: 50 },
    { id: 'active', label: 'Actif', points: 5 },
  ] });
  const row = (pos, uid, depth, blocks) => ({ position: pos, user_id: uid, eligible: 1, max_depth: depth,
    effective_manual_blocks: blocks, manual_blocks: blocks, risk_level: 0, league_id: null });
  const rows = [row(1, 1, 10, 80), row(2, 2, 900, 30), row(3, 3, 20, 30), row(4, 4, 5, 2)];
  const v2 = points.computeAwards(SCALE, rows, new Map(), 'merit-v2');
  assert.deepStrictEqual(v2.awards.map(a => a.tier?.id), ['first', 'top50', 'top50', 'active'], 'profondeur ignorée');
  const v1 = points.computeAwards(SCALE, rows, new Map(), 'merit-v1');
  assert.deepStrictEqual(v1.awards.map(a => a.tier?.id), ['first', 'top50', 'active', 'active'], 'règle historique');
  assert.deepStrictEqual(points.computeAwards(SCALE, rows).awards.map(a => a.tier?.id), v2.awards.map(a => a.tier?.id),
    'défaut = algorithme courant');
});

test.after(() => { try { conn().close(); } catch (_) {} fs.rmSync(dir, { recursive: true, force: true }); });
