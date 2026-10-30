/**
 * Tests du classement saisonnier figé, ticket #29 :
 * - calcul pur (éligibilité, rangs global et de ligue, départage) ;
 * - horodatage « premier arrivé » posé seulement quand la profondeur augmente ;
 * - clôture : instantané créé dans la transaction, idempotent, immuable, empreintes chaînées,
 *   indépendant des corrections admin ultérieures, saison sans participant ;
 * - panne pendant le figement : la rotation continue, rattrapage par le planificateur ;
 * - déterminisme : 200 ordres d'insertion aléatoires donnent le même classement et la même empreinte ;
 * - routes HTTP publique et admin (serveur de test, port ≠ 3000, base temporaire).
 * Lancer : npm test
 */

'use strict';

const test     = require('node:test');
const assert   = require('node:assert');
const crypto   = require('crypto');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const { spawn } = require('child_process');

const ROOT  = path.join(__dirname, '..');
const PORT  = process.env.DIG_TEST_PORT_STANDINGS || '3129';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-standings-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const cal       = require('../server/seasonCalendar');
const db        = require('../server/db');
const seasons   = require('../server/seasons');
const standings = require('../server/standings');

db.initDb();
const conn = () => db.getDb();

let userSeq = 0;
function newUser() {
  return conn().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(`standings_user_${++userSeq}`, 'x').lastInsertRowid;
}

/** Ligne de classement imposée (valeurs exactes, y compris l'instant d'arrivée). */
function putRanking(seasonId, userId, { depth, blocks, reachedAt = null, leagueId = null, active = 1 }) {
  conn().prepare(`
    INSERT INTO season_rankings (season_id, user_id, league_id, max_depth, reported_max_depth, manual_blocks,
                                 effective_manual_blocks, is_active, max_depth_reached_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(seasonId, userId, leagueId, depth, depth, blocks, blocks, active, reachedAt);
}

/** Crée une saison terminée (hors rotation) et la renvoie. */
function pastSeason(name, weeksAgo) {
  const start = new Date(Date.UTC(2025, 0, 6) + weeksAgo * 7 * 86400_000);
  const end   = new Date(start.getTime() + 7 * 86400_000 - 1000);
  return db.createSeason(name, cal.fmtUtc(start), cal.fmtUtc(end), 'closed');
}

// ── Calcul pur ────────────────────────────────────────────────────────────────

test('computeStandings : éligibilité, rangs global et de ligue, exclusions visibles', () => {
  const rows = standings.computeStandings([
    { user_id: 1, league_id: 10, max_depth: 600, effective_manual_blocks: 500, manual_blocks: 500, user_exists: 1 },
    { user_id: 2, league_id: 20, max_depth: 300, effective_manual_blocks: 200, manual_blocks: 200, user_exists: 1 },
    { user_id: 3, league_id: 10, max_depth: 100, effective_manual_blocks: 50,  manual_blocks: 50,  user_exists: 1 },
    { user_id: 4, league_id: 10, max_depth: 0,   effective_manual_blocks: 0,   manual_blocks: 3,   user_exists: 1 },
  ], id => (id === 2 ? 3 : 0));
  assert.deepStrictEqual(rows.map(r => [r.position, r.rank, r.rank_in_league, r.eligible, r.exclusion_reason]), [
    [1, 1, 1, 1, null],
    [2, 2, 1, 1, null],
    [3, 3, 2, 1, null],
    [4, null, null, 0, 'depth_zero'],
  ]);
  assert.strictEqual(rows[1].risk_level, 3, 'niveau de risque enregistré pour l\'audit');
  assert.strictEqual(rows[1].eligible, 1, 'risque observé : aucune exclusion automatique (sanctions non décidées, #25 lot C)');
  assert.deepStrictEqual(standings.computeStandings([]), []);
});

// ── Horodatage « premier arrivé » ─────────────────────────────────────────────

test('max_depth_reached_at : posé à la première atteinte, inchangé à profondeur égale, mis à jour si elle augmente', async () => {
  const season = db.getActiveSeason();
  const u = newUser();
  const get = () => db.getPlayerSeasonEntry(season.id, u);
  db.upsertSeasonRanking(season.id, u, 10, 5, null, 10, 0, null, 10);
  const t1 = get().max_depth_reached_at;
  assert.match(t1, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}$/, 'horodatage UTC à la milliseconde');
  await new Promise(r => setTimeout(r, 15));
  db.upsertSeasonRanking(season.id, u, 10, 6, null, 12, 0, null, 10);
  assert.strictEqual(get().max_depth_reached_at, t1, 'même profondeur : premier instant conservé');
  db.upsertSeasonRanking(season.id, u, 8, 7, null, 14, 0, null, 8);
  assert.strictEqual(get().max_depth_reached_at, t1, 'profondeur inférieure : rien ne change');
  await new Promise(r => setTimeout(r, 15));
  db.upsertSeasonRanking(season.id, u, 12, 8, null, 16, 0, null, 12);
  assert.ok(get().max_depth_reached_at > t1, 'nouvelle profondeur max : nouvel instant');
  assert.strictEqual(get().max_depth, 12);
});

// ── Clôture : instantané ──────────────────────────────────────────────────────

let closedId;

test('clôture : classement figé au mérite, départage déterministe, idempotent, preuve vérifiable', () => {
  const season = db.getActiveSeason();
  conn().prepare('DELETE FROM season_rankings WHERE season_id = ?').run(season.id);
  const [a, b, c, d, e, f] = [newUser(), newUser(), newUser(), newUser(), newUser(), newUser()];
  // b et c : même profondeur et mêmes blocs ; c (identifiant plus grand) est arrivé le premier.
  putRanking(season.id, a, { depth: 600, blocks: 500, reachedAt: '2026-11-04 10:00:00.000' });
  putRanking(season.id, b, { depth: 300, blocks: 200, reachedAt: '2026-11-04 12:00:00.500' });
  putRanking(season.id, c, { depth: 300, blocks: 200, reachedAt: '2026-11-04 12:00:00.100' });
  putRanking(season.id, d, { depth: 300, blocks: 200, reachedAt: null });              // sans date : après
  putRanking(season.id, e, { depth: 0,   blocks: 1 });                                  // profondeur nulle
  putRanking(season.id, f, { depth: 900, blocks: 0 });                                  // non participant (aucun bloc manuel)

  const now = new Date(cal.parseUtc(season.end_at).getTime() + 30_000);
  const result = seasons.closeActiveSeason(season.id, now);
  closedId = season.id;
  assert.ok(result.standings, 'résumé de l\'instantané renvoyé par la clôture');

  const snap = standings.getSnapshot(season.id);
  assert.strictEqual(snap.source, 'close');
  assert.strictEqual(snap.algorithm, standings.ALGORITHM);
  assert.strictEqual(snap.prize_mode, 'simulation', 'aucun prix réel : mode simulation');
  assert.strictEqual(snap.participants, 5);
  assert.strictEqual(snap.eligible, 4);
  assert.strictEqual(snap.leader_user_id, a);
  assert.strictEqual(snap.season_end, db.getSeasonById(season.id).end_at);

  const rows = conn().prepare('SELECT * FROM season_standings WHERE season_id = ? ORDER BY position').all(season.id);
  assert.deepStrictEqual(rows.map(r => [r.user_id, r.rank, r.eligible]), [
    [a, 1, 1], [c, 2, 1], [b, 3, 1], [d, 4, 1], [e, null, 0],
  ]);
  assert.ok(!rows.some(r => r.user_id === f), 'joueur sans bloc manuel exclu');

  // Le classement vivant suit le même ordre (ce que voyaient les joueurs à la clôture)
  assert.deepStrictEqual(db.getSeasonLeaderboard(season.id, 50, 0).map(r => r.user_id), [a, c, b, d, e]);

  assert.deepStrictEqual(standings.verifySnapshot(season.id), { ok: true, rowsHashOk: true, snapshotHashOk: true, chainOk: true });

  // Idempotence : un second figement ne change rien
  const again = standings.freezeSeasonStandings(season.id, { source: 'backfill' });
  assert.strictEqual(again.created, false);
  assert.strictEqual(again.snapshot.snapshot_hash, snap.snapshot_hash);
  assert.strictEqual(conn().prepare('SELECT COUNT(*) n FROM season_standings WHERE season_id = ?').get(season.id).n, 5);
  assert.strictEqual(standings.freezeMissingSnapshots(now), 0);

  // Correction admin après la clôture : sans effet sur le résultat figé
  db.correctSeasonRanking(season.id, e, { maxDepth: 5000 });
  assert.strictEqual(standings.getSnapshot(season.id).leader_user_id, a);
  assert.strictEqual(standings.buildStandings(season.id).standings[0].userId, a);
  assert.ok(standings.verifySnapshot(season.id).ok);
});

test('instantané immuable : modification et suppression refusées par la base', () => {
  assert.throws(() => conn().prepare('UPDATE season_standings SET rank = 1 WHERE season_id = ?').run(closedId), /immuable/);
  assert.throws(() => conn().prepare('DELETE FROM season_standings WHERE season_id = ?').run(closedId), /immuable/);
  assert.throws(() => conn().prepare('UPDATE season_snapshots SET leader_user_id = 0').run(), /immuable/);
  assert.throws(() => conn().prepare('DELETE FROM season_snapshots').run(), /immuable/);
  assert.throws(() => standings.freezeSeasonStandings(db.getActiveSeason().id), /non figeable/, 'saison active non figeable');
});

test('falsification détectée : lignes et chaîne d\'empreintes', () => {
  // Hors cadre normal : on retire le déclencheur sur une copie pour simuler une écriture directe.
  const copy = path.join(dir, 'tamper.sqlite');
  conn().prepare('VACUUM INTO ?').run(copy);
  const Database = require('better-sqlite3');
  const t = new Database(copy);
  t.exec('DROP TRIGGER trg_standings_no_update');
  t.prepare('UPDATE season_standings SET max_depth = 99999 WHERE season_id = ? AND position = 5').run(closedId);
  const rows = t.prepare('SELECT * FROM season_standings WHERE season_id = ? ORDER BY position').all(closedId);
  const snap = t.prepare('SELECT * FROM season_snapshots WHERE season_id = ?').get(closedId);
  t.close();
  const original = conn().prepare('SELECT * FROM season_standings WHERE season_id = ? ORDER BY position').all(closedId);
  assert.notDeepStrictEqual(rows, original);
  // Recalcul de l'empreinte des lignes falsifiées : elle ne correspond plus
  const ROW_FIELDS = ['position', 'rank', 'rank_in_league', 'user_id', 'league_id', 'max_depth',
    'effective_manual_blocks', 'manual_blocks', 'max_depth_reached_at', 'eligible', 'exclusion_reason', 'risk_level'];
  const h = r => crypto.createHash('sha256').update(JSON.stringify(r.map(x => ROW_FIELDS.map(k => x[k] ?? null)))).digest('hex');
  assert.strictEqual(h(original), snap.rows_hash, 'forme canonique documentée = empreinte stockée');
  assert.notStrictEqual(h(rows), snap.rows_hash, 'falsification visible');
});

test('saison sans participant : instantané vide, aucun leader, chaîné au précédent', () => {
  const active = db.getActiveSeason();
  const now = new Date(cal.parseUtc(active.end_at).getTime() + 30_000);
  seasons.closeActiveSeason(active.id, now);
  const snap = standings.getSnapshot(active.id);
  assert.strictEqual(snap.participants, 0);
  assert.strictEqual(snap.eligible, 0);
  assert.strictEqual(snap.leader_user_id, null);
  assert.strictEqual(JSON.parse(snap.details).status, 'no_eligible_participant');
  assert.strictEqual(snap.prev_hash, standings.getSnapshot(closedId).snapshot_hash, 'chaîne d\'empreintes');
  assert.ok(standings.verifySnapshot(active.id).ok);
});

test('panne pendant le figement : la saison se clôt et la suivante s\'ouvre, rattrapage ensuite', () => {
  const active = db.getActiveSeason();
  const u = newUser();
  putRanking(active.id, u, { depth: 42, blocks: 41, reachedAt: '2026-11-20 08:00:00.000' });
  const now = new Date(cal.parseUtc(active.end_at).getTime() + 30_000);
  const orig = db.getSeasonParticipantsRanked;
  db.getSeasonParticipantsRanked = () => { throw new Error('disque plein (simulé)'); };
  try {
    const res = seasons.closeActiveSeason(active.id, now);
    assert.strictEqual(res.closedSeason.status, 'closed');
    assert.ok(res.newSeason && res.newSeason.status === 'active', 'rotation non bloquée');
    assert.strictEqual(res.standings, null);
    assert.strictEqual(standings.getSnapshot(active.id), null, 'aucun instantané partiel');
    assert.strictEqual(conn().prepare('SELECT COUNT(*) n FROM season_standings WHERE season_id = ?').get(active.id).n, 0);
    const ev = conn().prepare("SELECT * FROM security_events WHERE type = 'standings_freeze_failed' AND season_id = ?").get(active.id);
    assert.ok(ev, 'échec journalisé');
    assert.strictEqual(standings.freezeMissingSnapshots(now), 0, 'panne persistante : toujours rien, sans exception');
  } finally {
    db.getSeasonParticipantsRanked = orig;
  }
  assert.strictEqual(standings.freezeMissingSnapshots(now), 1, 'rattrapage par le planificateur');
  const snap = standings.getSnapshot(active.id);
  assert.strictEqual(snap.source, 'backfill');
  assert.strictEqual(snap.leader_user_id, u);
  assert.ok(standings.verifySnapshot(active.id).ok);
});

test('saisons closes avant #29 : figées par rattrapage, dans l\'ordre chronologique', () => {
  const s1 = pastSeason('Ancienne A', 0);
  const s2 = pastSeason('Ancienne B', 1);
  const u = newUser();
  putRanking(s2.id, u, { depth: 30, blocks: 29 });
  assert.strictEqual(standings.freezeMissingSnapshots(), 2);
  const a = standings.getSnapshot(s1.id), b = standings.getSnapshot(s2.id);
  assert.ok(a.seq < b.seq, 'ordre par date de fin');
  assert.strictEqual(b.prev_hash, a.snapshot_hash);
  assert.strictEqual(b.leader_user_id, u);
  assert.strictEqual(JSON.parse(b.details).withoutReachTime, 1, 'lignes sans instant d\'arrivée signalées');
});

// ── Déterminisme ──────────────────────────────────────────────────────────────

test('déterminisme : 200 ordres d\'insertion aléatoires → même classement et même empreinte', () => {
  // Joueurs à fortes égalités : 4 profondeurs × 3 nombres de blocs × instants partagés ou absents
  const specs = [];
  for (let i = 0; i < 40; i++) {
    specs.push({
      depth: [50, 100, 100, 200][i % 4], blocks: [10, 20, 20][i % 3],
      reachedAt: i % 5 === 0 ? null : `2026-11-0${1 + (i % 3)} 10:00:00.${String(i % 2).padStart(3, '0')}`,
    });
  }
  const users = specs.map(() => newUser());
  const ref = new Set();
  const orders = new Set();
  for (let run = 0; run < 200; run++) {
    const s = pastSeason(`Déterminisme ${run}`, 100 + run);
    const idx = users.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    for (const i of idx) putRanking(s.id, users[i], specs[i]);
    const rows = standings.computeStandings(db.getSeasonParticipantsRanked(s.id));
    orders.add(rows.map(r => r.user_id).join(','));
    ref.add(crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex'));
  }
  assert.strictEqual(orders.size, 1, 'un seul ordre possible');
  assert.strictEqual(ref.size, 1, 'une seule empreinte');
  const order = [...orders][0].split(',').map(Number);
  const byUser = new Map(users.map((u, i) => [u, specs[i]]));
  for (let k = 1; k < order.length; k++) {
    const p = byUser.get(order[k - 1]), q = byUser.get(order[k]);
    const key = s => [-s.depth, -s.blocks, s.reachedAt === null ? 1 : 0, s.reachedAt ?? ''];
    const kp = key(p), kq = key(q);
    const cmp = kp[0] - kq[0] || kp[1] - kq[1] || kp[2] - kq[2] || (kp[3] < kq[3] ? -1 : kp[3] > kq[3] ? 1 : 0)
             || order[k - 1] - order[k];
    assert.ok(cmp < 0, `ordre au mérite respecté entre ${order[k - 1]} et ${order[k]}`);
  }
});

// ── Routes HTTP ───────────────────────────────────────────────────────────────

test('routes : classement figé public et admin (vérification des empreintes)', async (t) => {
  const httpDb = path.join(dir, 'http.sqlite');
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: httpDb, ADMIN_SECRET: ADMIN, SESSION_SECRET: crypto.randomBytes(16).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', d => { log += d; });
  server.stderr.on('data', d => { log += d; });
  t.after(() => server.kill());
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { await fetch(`${BASE}/api/version`); up = true; } catch (_) { await new Promise(r => setTimeout(r, 100)); }
  }
  assert.ok(up, `serveur de test non démarré :\n${log}`);
  const call = async (method, url, body, auth = true) => {
    const res = await fetch(BASE + url, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${ADMIN}` } : {}) },
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  let r = await call('GET', '/api/seasons/last/standings', undefined, false);
  assert.strictEqual(r.status, 404, 'aucune saison figée');
  r = await call('GET', '/api/seasons/abc/standings', undefined, false);
  assert.strictEqual(r.status, 400);

  // Joueur via l'API (inscription + sauvegarde), puis clôture manuelle admin
  const reg = await fetch(`${BASE}/api/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'figeur', email: 'figeur@example.test', password: 'motdepasse-solide-29' }),
  });
  assert.strictEqual(reg.status, 200, 'inscription');
  const cookie = reg.headers.get('set-cookie').split(';')[0];
  const cur = (await (await fetch(`${BASE}/api/seasons/current`)).json()).season;
  const sdb = new (require('better-sqlite3'))(httpDb);
  const uid = sdb.prepare("SELECT id FROM users WHERE username = 'figeur'").get().id;
  sdb.prepare(`INSERT INTO season_rankings (season_id, user_id, max_depth, reported_max_depth, manual_blocks, effective_manual_blocks, is_active, max_depth_reached_at)
               VALUES (?, ?, 77, 77, 70, 70, 1, '2026-11-04 10:00:00.000')`).run(cur.id, uid);
  sdb.close();

  r = await call('PUT', `/api/admin/seasons/${cur.id}`, { status: 'closed' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));

  r = await call('GET', '/api/seasons/last/standings', undefined, false);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.season.id, cur.id);
  assert.strictEqual(r.body.snapshot.source, 'admin_close');
  assert.strictEqual(r.body.snapshot.prizeMode, 'simulation');
  assert.match(r.body.snapshot.hash, /^[0-9a-f]{64}$/);
  assert.deepStrictEqual(r.body.standings.map(s => [s.rank, s.username, s.maxDepth, s.eligible]), [[1, 'figeur', 77, true]]);
  assert.strictEqual(r.body.standings[0].riskLevel, undefined, 'pas de donnée d\'audit en public');
  assert.strictEqual(r.body.me, null, 'visiteur anonyme');
  const mine = await (await fetch(`${BASE}/api/seasons/${cur.id}/standings`, { headers: { Cookie: cookie } })).json();
  assert.strictEqual(mine.me?.rank, 1, 'ligne du joueur connecté');

  r = await call('GET', `/api/admin/seasons/${cur.id}/standings`, undefined, false);
  assert.strictEqual(r.status, 401);
  r = await call('GET', `/api/admin/seasons/${cur.id}/standings`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.verification.ok, true);
  assert.strictEqual(r.body.standings[0].riskLevel, 0);
  r = await call('GET', '/api/admin/seasons/999999/standings');
  assert.strictEqual(r.status, 404);
});

test.after(() => {
  seasons.stopSeasonScheduler();
  try { db.getDb().close(); } catch (_) {}
  fs.rmSync(dir, { recursive: true, force: true });
});
