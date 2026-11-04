/**
 * Audit des points de récompense à la clôture d'une saison (ticket #33, demande du 03/11/2026).
 *
 * Environnement isolé : bases temporaires hors server/data/, horloge injectée, serveur de test
 * sur un port ≠ 3000. Aucune saison ni aucun portefeuille de production n'est touché, le barème
 * en vigueur (v1 validé le 30/10) n'est pas modifié hors de ces bases de test.
 * Scénarios :
 *   - clôture ordinaire : points recalculés à la main depuis le classement figé (ex æquo,
 *     joueur non éligible), registre = attributions, rejouer ne crédite rien de plus ;
 *   - scores reçus après la clôture : sans effet sur le classement figé ni les points ;
 *   - panne entre la clôture et l'attribution, panne au milieu de l'attribution : rien de
 *     partiel, le rattrapage crédite une seule fois ;
 *   - classement figé falsifié : attribution refusée, contrôle en écart ;
 *   - barème modifié après coup : saisons closes jamais recréditées ;
 *   - saison sans participant ;
 *   - vrais redémarrages du serveur (kill -9) autour d'une échéance de saison, consultation
 *     joueur par l'API : crédit unique, historique et rang figé visibles.
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
const PORT  = process.env.DIG_TEST_PORT_POINTS_AUDIT || '3137';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-points-audit-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');
delete process.env.CONTEST_REAL_PRIZES;

const cal       = require('../server/seasonCalendar');
const db        = require('../server/db');
const seasons   = require('../server/seasons');
const standings = require('../server/standings');
const points    = require('../server/rewardPoints');

db.initDb();
const conn = () => db.getDb();

function quiet(fn) {
  const { log, error, warn } = console;
  console.log = console.error = console.warn = () => {};
  try { return fn(); } finally { Object.assign(console, { log, error, warn }); }
}

let userSeq = 0;
const newUser = () => conn().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
  .run(`audit_user_${++userSeq}`, 'x').lastInsertRowid;

/** Rang = blocs manuels validés (#73) ; reachedAt = instant où ce total a été atteint. */
function putRanking(seasonId, userId, depth, blocks, reachedAt = '2027-01-05 10:00:00.000', effective = blocks) {
  conn().prepare(`
    INSERT INTO season_rankings (season_id, user_id, max_depth, reported_max_depth, manual_blocks,
                                 effective_manual_blocks, is_active, max_depth_reached_at, manual_blocks_reached_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(seasonId, userId, depth, depth, blocks, effective, reachedAt, reachedAt);
}

/** Clôture la saison active 30 s après sa fin (comme le planificateur). */
function closeActive({ awardFails = false } = {}) {
  const season = db.getActiveSeason();
  const now = new Date(cal.parseUtc(season.end_at).getTime() + 30_000);
  const real = points.awardSeason;
  if (awardFails) points.awardSeason = () => { throw new Error('panne simulée avant attribution'); };
  try { quiet(() => seasons.closeActiveSeason(season.id, now)); }
  finally { points.awardSeason = real; }
  return season.id;
}

const ledgerOf = seasonId => conn().prepare(
  "SELECT user_id, delta FROM reward_point_ledger WHERE season_id = ? AND kind = 'season_award' ORDER BY user_id").all(seasonId);
const runsOf = seasonId => conn().prepare(
  'SELECT mode, eligible, recipients, total_points FROM reward_point_runs WHERE season_id = ? ORDER BY mode').all(seasonId);
const balances = users => users.map(u => points.getWallet(u).balance);

const T0 = new Date('2027-01-04T08:00:00Z');
let s1, players;

test('clôture ordinaire : points = recalcul manuel depuis le classement figé, crédit unique', () => {
  points.applyOwnerDecision(T0);                 // crédit réel, barème v1 validé (comme en production)
  quiet(() => seasons.checkAndRotateSeason(T0));
  const season = db.getActiveSeason();
  players = Array.from({ length: 13 }, newUser);
  // 12 éligibles (dont un ex æquo parfait aux rangs 6-7) + 1 joueur sans bloc manuel validé
  // (non éligible) ; profondeurs inversées : sans effet sur le rang (#73)
  const blocks = [120, 110, 100, 90, 80, 70, 70, 60, 50, 40, 30, 20];
  blocks.forEach((b, i) => putRanking(season.id, players[i], 200 - b, b, i === 6 ? '2027-01-06 10:00:00.000' : undefined));
  putRanking(season.id, players[12], 900, 5, undefined, 0);
  s1 = closeActive();

  // Barème v1 sur 12 éligibles : 1er 100 ; top 10 % (≤ rang 2) 30 ; top 25 % (≤ 3) 20 ;
  // top 50 % (≤ 6) 12 ; ex æquo du rang 6 → 12 ; autres participants 5.
  const expected = [100, 30, 20, 12, 12, 12, 12, 5, 5, 5, 5, 5, 0];
  assert.deepStrictEqual(balances(players), expected);
  const snap = standings.getSnapshot(s1);
  assert.strictEqual(snap.eligible, 12);
  const awards = conn().prepare("SELECT user_id, rank, tier, points FROM reward_point_awards WHERE season_id = ? AND mode = 'live' ORDER BY rank").all(s1);
  assert.deepStrictEqual(awards.map(a => a.user_id), players.slice(0, 12), 'ordre = classement figé');
  assert.deepStrictEqual(awards.map(a => a.tier), ['first', 'top10', 'top25', 'top50', 'top50', 'top50', 'top50', 'active', 'active', 'active', 'active', 'active']);
  assert.deepStrictEqual(runsOf(s1), [
    { mode: 'live', eligible: 12, recipients: 12, total_points: 223 },
    { mode: 'simulation', eligible: 12, recipients: 12, total_points: 223 },
  ]);
  assert.strictEqual(ledgerOf(s1).length, 12, 'un seul mouvement par joueur crédité');

  const audit = points.auditSeason(s1);
  assert.deepStrictEqual([audit.ok, audit.snapshotOk, audit.problems], [true, true, []]);
  assert.deepStrictEqual(audit.runs.find(r => r.mode === 'live').credited, 223);

  // Rejouer : attribution, rattrapage, nouvelle clôture → rien de plus
  for (let i = 0; i < 3; i++) {
    assert.deepStrictEqual(points.awardSeason(s1), { simulation: null, live: null });
    assert.strictEqual(quiet(() => points.awardMissingSeasons()), 0);
  }
  assert.throws(() => seasons.closeActiveSeason(s1), /déjà/);
  assert.deepStrictEqual(balances(players), expected);
});

test('scores reçus après la clôture : classement figé et points inchangés', () => {
  conn().prepare('UPDATE season_rankings SET max_depth = 999, effective_manual_blocks = 999 WHERE season_id = ? AND user_id = ?')
    .run(s1, players[11]);
  assert.strictEqual(standings.verifySnapshot(s1).ok, true);
  assert.strictEqual(quiet(() => points.awardMissingSeasons()), 0);
  assert.strictEqual(points.getWallet(players[11]).balance, 5);
  assert.strictEqual(points.auditSeason(s1).ok, true);
});

test('panne entre la clôture et l\'attribution : rattrapage au redémarrage, une seule fois', () => {
  const season = db.getActiveSeason();
  const trio = players.slice(0, 3);
  trio.forEach((u, i) => putRanking(season.id, u, 10, 30 - i * 10));
  const before = balances(trio);
  const sid = closeActive({ awardFails: true });
  assert.strictEqual(db.getSeasonById(sid).status, 'closed');
  assert.ok(standings.getSnapshot(sid), 'classement figé malgré la panne');
  assert.deepStrictEqual([runsOf(sid), ledgerOf(sid)], [[], []], 'rien attribué');
  assert.deepStrictEqual(points.auditSeason(sid).runs, []);

  // Redémarrage : le planificateur rattrape (plusieurs passages)
  assert.strictEqual(quiet(() => points.awardMissingSeasons()), 1);
  assert.strictEqual(quiet(() => points.awardMissingSeasons()), 0);
  assert.deepStrictEqual(balances(trio).map((b, i) => b - before[i]), [100, 12, 5]);
  assert.strictEqual(ledgerOf(sid).length, 3);
  assert.strictEqual(points.auditSeason(sid).ok, true);
});

test('panne au milieu de l\'attribution : aucun crédit partiel, reprise complète ensuite', () => {
  const season = db.getActiveSeason();
  const trio = players.slice(3, 6);
  trio.forEach((u, i) => putRanking(season.id, u, 10, 30 - i * 10));
  const sid = closeActive({ awardFails: true });
  const before = balances(trio);
  // Le 3e joueur fait échouer l'écriture alors que les deux premiers sont déjà crédités dans la transaction
  conn().exec(`CREATE TEMP TRIGGER fail_award BEFORE INSERT ON reward_point_awards
               WHEN NEW.user_id = ${trio[2]} AND NEW.mode = 'live' BEGIN SELECT RAISE(ABORT, 'panne simulée'); END`);
  assert.strictEqual(quiet(() => points.awardMissingSeasons()), 0);
  assert.deepStrictEqual([runsOf(sid), ledgerOf(sid)], [[], []], 'transaction annulée en entier');
  assert.deepStrictEqual(balances(trio), before);
  assert.strictEqual(points.verifyLedger().ok, true);

  conn().exec('DROP TRIGGER temp.fail_award');
  assert.strictEqual(quiet(() => points.awardMissingSeasons()), 1);
  assert.deepStrictEqual(balances(trio).map((b, i) => b - before[i]), [100, 12, 5]);
  assert.strictEqual(points.auditSeason(sid).ok, true);
});

test('classement figé falsifié : attribution refusée, contrôle en écart, reprise une fois restauré', () => {
  const season = db.getActiveSeason();
  const duo = players.slice(6, 8);
  duo.forEach((u, i) => putRanking(season.id, u, 10, 20 - i * 10));
  const sid = closeActive({ awardFails: true });
  const before = balances(duo);
  const trig = conn().prepare("SELECT sql FROM sqlite_master WHERE name = 'trg_standings_no_update'").get().sql;
  conn().exec('DROP TRIGGER trg_standings_no_update');
  const setDepth = d => conn().prepare('UPDATE season_standings SET max_depth = ? WHERE season_id = ? AND position = 2').run(d, sid);
  setDepth(500);

  assert.strictEqual(quiet(() => points.awardMissingSeasons()), 0);
  assert.throws(() => points.awardSeason(sid), /empreinte du classement figé invalide/);
  assert.deepStrictEqual([runsOf(sid), ledgerOf(sid), balances(duo)], [[], [], before]);
  const audit = points.auditSeason(sid);
  assert.strictEqual(audit.ok, false);
  assert.match(audit.problems.join(), /empreinte/);
  assert.strictEqual(points.auditAllSeasons().ok, false, 'visible dans le contrôle global (panel admin)');

  setDepth(10);
  conn().exec(trig);
  assert.strictEqual(quiet(() => points.awardMissingSeasons()), 1);
  assert.deepStrictEqual(balances(duo).map((b, i) => b - before[i]), [12, 5], '2 éligibles : premier non attribué (3 requis), top 50 % = rang 1, puis participant');
  assert.strictEqual(points.auditSeason(sid).ok, true);
});

test('barème modifié après coup : saisons closes jamais recréditées, contrôle sur la version utilisée', () => {
  const totalBefore = balances(players).reduce((a, b) => a + b, 0);
  points.setScale({ tiers: [{ id: 'everyone', label: 'Tous', points: 1000 }] }, 'barème de test');
  assert.strictEqual(quiet(() => points.awardMissingSeasons()), 0);
  assert.strictEqual(balances(players).reduce((a, b) => a + b, 0), totalBefore);
  assert.strictEqual(points.auditAllSeasons().ok, true);
});

test('saison sans participant : exécution vide, aucun crédit ; registre global cohérent', () => {
  const sid = closeActive();
  assert.deepStrictEqual(runsOf(sid), [
    { mode: 'live', eligible: 0, recipients: 0, total_points: 0 },
    { mode: 'simulation', eligible: 0, recipients: 0, total_points: 0 },
  ]);
  assert.strictEqual(points.auditSeason(sid).ok, true);

  const all = points.auditAllSeasons();
  const closed = conn().prepare("SELECT COUNT(*) AS n FROM seasons WHERE status = 'closed'").get().n;
  assert.deepStrictEqual([all.ok, all.checked], [true, closed], 'toutes les saisons closes contrôlées');
  assert.strictEqual(points.verifyLedger().ok, true);
  const credited = conn().prepare("SELECT COALESCE(SUM(total_points), 0) AS s FROM reward_point_runs WHERE mode = 'live'").get().s;
  assert.strictEqual(balances(players).reduce((a, b) => a + b, 0), credited, 'soldes = somme des exécutions réelles');
  const dup = conn().prepare("SELECT COUNT(*) AS n FROM (SELECT 1 FROM reward_point_ledger WHERE kind = 'season_award' GROUP BY season_id, user_id HAVING COUNT(*) > 1)").get().n;
  assert.strictEqual(dup, 0, 'aucun double crédit');
  assert.strictEqual(points.buildAdminSummary().audit.ok, true);
});

// ── Vrai serveur : redémarrages brutaux autour de l'échéance ─────────────────

test('serveur réel : échéance pendant un arrêt, kill -9 répétés, crédit unique visible côté joueur', async (t) => {
  const httpDb = path.join(dir, 'http.sqlite');
  const env = { ...process.env, PORT, SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: httpDb, ADMIN_SECRET: ADMIN,
                SESSION_SECRET: crypto.randomBytes(16).toString('hex') };
  let server = null, log = '';
  const start = async () => {
    server = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', d => { log += d; });
    server.stderr.on('data', d => { log += d; });
    for (let i = 0; i < 100; i++) {
      try { await fetch(`${BASE}/api/version`); return; } catch (_) { await new Promise(r => setTimeout(r, 100)); }
    }
    assert.fail(`serveur de test non démarré :\n${log}`);
  };
  const kill9 = () => new Promise(res => { server.once('exit', res); server.kill('SIGKILL'); });
  t.after(() => { try { server.kill('SIGKILL'); } catch (_) {} });

  await start();
  const reg = await fetch(`${BASE}/api/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'mineur33', email: 'mineur33@example.test', password: 'motdepasse-solide-33' }),
  });
  assert.strictEqual(reg.status, 200, 'inscription');
  const cookie = reg.headers.get('set-cookie').split(';')[0];
  const me = async () => (await fetch(`${BASE}/api/points/me`, { headers: { Cookie: cookie } })).json();
  await new Promise(r => setTimeout(r, 2100));   // échéance postérieure à l'activation du crédit réel
  await kill9();

  // Pendant l'arrêt : scores de la saison puis échéance dépassée
  const Database = require('better-sqlite3');
  let sdb = new Database(httpDb);
  const sid = sdb.prepare("SELECT id FROM seasons WHERE status = 'active'").get().id;
  const uid = sdb.prepare("SELECT id FROM users WHERE username = 'mineur33'").get().id;
  // Rang aux blocs manuels validés (#73), profondeur identique pour tous
  const ins = sdb.prepare(`INSERT INTO season_rankings (season_id, user_id, max_depth, reported_max_depth, manual_blocks,
                           effective_manual_blocks, is_active, max_depth_reached_at) VALUES (?, ?, 30, 30, ?, ?, 1, '2026-01-01 10:00:00.000')`);
  for (const [name, blocks] of [['rival_a', 100], ['rival_b', 40], ['rival_c', 20]]) {
    const id = sdb.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(name, 'x').lastInsertRowid;
    ins.run(sid, id, blocks, blocks);
  }
  ins.run(sid, uid, 60, 60);
  sdb.prepare('UPDATE seasons SET end_at = ? WHERE id = ?').run(cal.fmtUtc(new Date(Date.now() - 1000)), sid);
  sdb.close();

  const state = () => {
    const c = new Database(httpDb, { readonly: true });
    try {
      return {
        ledger: c.prepare('SELECT id, user_id, delta, idem_key FROM reward_point_ledger ORDER BY id').all(),
        runs:   c.prepare('SELECT season_id, mode, total_points FROM reward_point_runs ORDER BY season_id, mode').all(),
        active: c.prepare("SELECT COUNT(*) AS n FROM seasons WHERE status = 'active'").get().n,
      };
    } finally { c.close(); }
  };

  await start();   // démarrage après l'échéance : clôture, figement et crédit avant d'accepter les requêtes
  const first = state();
  assert.deepStrictEqual(first.runs, [{ season_id: sid, mode: 'live', total_points: 100 + 12 + 5 + 5 },
                                      { season_id: sid, mode: 'simulation', total_points: 122 }]);
  assert.strictEqual(first.ledger.length, 4);
  assert.strictEqual(first.active, 1, 'saison suivante ouverte');
  let r = await me();
  assert.strictEqual(r.balance, 12, '2e sur 4 éligibles : top 50 %');
  assert.deepStrictEqual(r.history.map(h => [h.kind, h.delta, h.seasonId]), [['season_award', 12, sid]]);
  assert.ok(r.history[0].seasonName, 'nom de la saison affiché');
  assert.deepStrictEqual(r.awards.filter(a => a.mode === 'live').map(a => [a.seasonId, a.rank, a.eligibleCount, a.tier, a.points]),
    [[sid, 2, 4, 'top50', 12]]);

  for (let i = 0; i < 2; i++) {   // kill -9 puis redémarrage : rien de plus
    await kill9();
    await start();
    assert.deepStrictEqual(state(), first, `redémarrage ${i + 1} : registre et exécutions inchangés`);
  }
  r = await me();
  assert.strictEqual(r.balance, 12);
  const adm = await (await fetch(`${BASE}/api/admin/points`, { headers: { Authorization: `Bearer ${ADMIN}` } })).json();
  assert.deepStrictEqual([adm.verification.ok, adm.audit.ok, adm.audit.checked], [true, true, 1]);
  assert.doesNotMatch(log, /Points non attribués|non attribuée/);
});

test.after(() => {
  seasons.stopSeasonScheduler();
  try { db.getDb().close(); } catch (_) {}
  fs.rmSync(dir, { recursive: true, force: true });
});
