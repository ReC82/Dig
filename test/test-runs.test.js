/**
 * Essais de test d'un joueur (#75) : instantané complet, « recommencer un test à zéro », anciens
 * onglets / PWA / clients sans révision, transaction interrompue, rejeu, classement à 3 joueurs,
 * ligue, registre de gemmes, saisons clôturées intactes, restauration, export et audit chaîné.
 * Serveur lancé sur un port de test avec une base temporaire (hors server/data/) : aucun compte réel.
 * Lancer : npm test
 */

'use strict';

const test     = require('node:test');
const assert   = require('node:assert');
const Database = require('better-sqlite3');
const crypto   = require('crypto');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const { spawn } = require('child_process');

const ROOT  = path.join(__dirname, '..');
const PORT  = process.env.DIG_TEST_PORT_TESTRUNS || '3141';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let dir, dbPath, server, db, season;

async function startServer() {
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: dbPath, ADMIN_SECRET: ADMIN, SESSION_SECRET: crypto.randomBytes(16).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', d => { log += d; });
  server.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${BASE}/api/version`); return; } catch (_) {}
    if (server.exitCode !== null) break;
    await sleep(100);
  }
  throw new Error(`Serveur de test non démarré :\n${log}`);
}

function client() {
  let cookie = '';
  return async (method, url, body, headers = {}) => {
    const res = await fetch(BASE + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (_) {}
    return { status: res.status, body: json, text, headers: res.headers };
  };
}
const adminCall = client();
const admin = (method, url, body) => adminCall(method, url, body, { Authorization: `Bearer ${ADMIN}` });

async function newPlayer(name) {
  const call = client();
  const r = await call('POST', '/api/register', { username: name, email: `${name}@example.invalid`, password: 'secret123' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  return { call, id: r.body.user.id };
}

const ss = (extra = {}) => ({ seasonId: season.id, maxDepth: 0, manualBlocks: 0, autoBlocks: 0, manualClicks: 0, suspiciousScore: 0, ...extra });
const saveRow = id => db.prepare('SELECT data, version FROM user_saves WHERE user_id = ?').get(id);
const rankRow = (sid, id) => db.prepare('SELECT * FROM season_rankings WHERE season_id = ? AND user_id = ?').get(sid, id);
const count = (table, id) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(id).n;
const ctrl = () => crypto.randomBytes(12).toString('hex');
const reqId = () => crypto.randomBytes(12).toString('hex');

/** Joueur classé honnêtement par le serveur : sauvegarde à zéro, puis `blocks` blocs manuels. */
async function playRanked(p, controllerId, blocks, extra = {}) {
  let r = await p.call('POST', '/api/me/save', { data: { lastSaveTime: Date.now(), depth: 1, seasonStats: ss() }, baseRevision: saveRow(p.id)?.version ?? null, controllerId });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  await sleep(1100);
  r = await p.call('POST', '/api/me/save', {
    data: { lastSaveTime: Date.now(), depth: blocks + 1, ...extra, seasonStats: ss({ maxDepth: blocks + 1, manualBlocks: blocks, manualClicks: blocks * 2, isActive: true }) },
    baseRevision: r.body.revision, controllerId,
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  return r.body.revision;
}

const leaderboard = async () => (await (await fetch(`${BASE}/api/seasons/active/leaderboard`)).json()).leaderboard;

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-testruns-'));
  dbPath = path.join(dir, 'testruns.sqlite');
  await startServer();
  db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');
  season = (await (await fetch(`${BASE}/api/seasons/current`)).json()).season;
  assert.ok(season?.id, 'saison active de test');
});

test.after(() => {
  if (db) db.close();
  if (server) server.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('recommencer un test à zéro : 3 joueurs, anciens onglets, rejeu, transaction interrompue, restauration', async () => {
  const tester = await newPlayer('tester75');
  const other1 = await newPlayer('other75a');
  const other2 = await newPlayer('other75b');
  const tabOld = ctrl();

  const progress = { coins: 500, gems: 7, pickaxeLevel: 6, damage: 6, relics: { eye_of_miner: 3 }, upgrades: { luck: 2, bag: 1, autodig: 3, fragment_shop: 0, block_reroll: 4 },
    stats: { blocksDestroyed: 40, totalCoinsEarned: 9000, gemsFound: 7, chestsFound: 2, totalUpgradesBought: 9, minedByType: { pierre: 30 } },
    collection: ['fossil'], daily: { lastClaimDate: '2026-11-05', streakDay: 2 }, monetization: { adLastWatched: 123, pickaxeSkin: null },
    dailyMissions: { date: '2026-11-05', missions: [{ id: 'm1', target: 10, reward: { coins: 5, gems: 1 }, claimed: true }], baselineStats: { blocksDestroyed: 35, depth: 3 } } };
  await playRanked(tester, tabOld, 3, progress);
  await playRanked(other1, ctrl(), 2);
  await playRanked(other2, ctrl(), 1);

  // Essai n° 1 « gonflé » comme en production (1 011 m, 57 blocs validés), traces anti-bot et état serveur
  db.prepare('UPDATE season_rankings SET max_depth = 1011, manual_blocks = 57, effective_manual_blocks = 57 WHERE season_id = ? AND user_id = ?').run(season.id, tester.id);
  db.prepare(`INSERT INTO risk_scores (user_id, season_id, components, score, level, updated_ms) VALUES (?, ?, '{"cps":70}', 74.9, 2, ?)
      ON CONFLICT(user_id, season_id) DO UPDATE SET score = 74.9, level = 2`).run(tester.id, season.id, Date.now());
  db.prepare(`INSERT INTO anticheat_logs (user_id, username, season_id, period_clicks, inferred_cps, action_taken) VALUES (?, 'tester75', ?, 500, 42, 'flagged')`).run(tester.id, season.id);
  db.prepare(`INSERT INTO security_events (type, user_id, season_id, details) VALUES ('cps_flagged', ?, ?, '{}')`).run(tester.id, season.id);
  db.prepare(`INSERT INTO player_badges (user_id, badge_id, earned_at, value) VALUES (?, 'profondeur_100', datetime('now'), 100)`).run(tester.id);
  db.prepare(`INSERT OR REPLACE INTO badge_player_stats (user_id, stat, value) VALUES (?, 'blocks:pierre', 30)`).run(tester.id);
  db.prepare(`INSERT INTO collection_pity (user_id, item_id, fails, found_at) VALUES (?, 'fossil', 0, datetime('now'))`).run(tester.id);
  db.prepare(`INSERT INTO gem_accounts (user_id, balance, opening, season_id, ref_blocks, ref_declared, ref_autodig, last_client, last_revision)
      VALUES (?, 7, 0, ?, '{"rubis":3}', '{}', 3, 7, 2)`).run(tester.id, season.id);
  // Saison clôturée : jamais touchée
  const closed = db.prepare(`INSERT INTO seasons (name, start_at, end_at, status, closed_at) VALUES ('Ancienne', '2026-09-01 00:00:00', '2026-09-07 23:59:59', 'closed', '2026-09-08 00:00:00')`).run().lastInsertRowid;
  db.prepare(`INSERT INTO season_rankings (season_id, user_id, max_depth, manual_blocks, is_active) VALUES (?, ?, 222, 22, 1)`).run(closed, tester.id);
  // Ligue au-dessus de la plus basse (si plusieurs ligues existent)
  const leagues = db.prepare('SELECT id FROM leagues ORDER BY level ASC, sort_order ASC').all();
  if (leagues.length > 1) db.prepare('UPDATE users SET league_id = ? WHERE id = ?').run(leagues[1].id, tester.id);
  const leagueBefore = db.prepare('SELECT league_id FROM users WHERE id = ?').get(tester.id).league_id;

  let lb = await leaderboard();
  assert.strictEqual(lb[0].username, 'tester75', JSON.stringify(lb));
  const othersBefore = [rankRow(season.id, other1.id), rankRow(season.id, other2.id)];

  // ── Aperçu ──
  const pv = await admin('GET', `/api/admin/players/${tester.id}/test-runs/reset-preview`);
  assert.strictEqual(pv.status, 200, pv.text);
  const rev0 = saveRow(tester.id).version;
  assert.strictEqual(pv.body.expectedRevision, rev0);
  assert.strictEqual(pv.body.current.rankedMaxDepth, 1011);
  assert.strictEqual(pv.body.current.manualBlocksValidated, 57);
  assert.strictEqual(pv.body.currentRunNo, 1);

  const body = extra => ({ confirmUsername: 'tester75', expectedRevision: rev0, requestId: reqId(), reason: 'Essai de résistance n° 2', ...extra });
  const url = `/api/admin/players/${tester.id}/test-runs/reset`;
  const untouched = () => {
    assert.strictEqual(saveRow(tester.id).version, rev0);
    assert.strictEqual(rankRow(season.id, tester.id).max_depth, 1011);
    assert.strictEqual(count('player_test_runs', tester.id), 0);
    assert.strictEqual(count('player_depth_tracking', tester.id), 1);
  };

  // ── Confirmations fortes, refus sans effet ──
  assert.strictEqual((await fetch(BASE + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body()) })).status, 401);
  assert.strictEqual((await admin('POST', url, body({ confirmUsername: 'Tester75' }))).status, 400);
  assert.strictEqual((await admin('POST', url, body({ reason: '' }))).status, 400);
  assert.strictEqual((await admin('POST', url, body({ requestId: 'x' }))).status, 400);
  const stale = await admin('POST', url, body({ expectedRevision: rev0 - 1 }));
  assert.strictEqual(stale.status, 409); assert.strictEqual(stale.body.code, 'stale_preview');
  untouched();

  // ── Transaction interrompue au milieu : rien de partiel ──
  db.exec(`CREATE TRIGGER t75_fail BEFORE DELETE ON player_depth_tracking BEGIN SELECT RAISE(ABORT, 'panne simulée'); END;`);
  const broken = await admin('POST', url, body());
  assert.strictEqual(broken.status, 500, broken.text);
  db.exec('DROP TRIGGER t75_fail');
  untouched();
  assert.strictEqual(db.prepare(`SELECT COUNT(*) AS n FROM gem_ledger WHERE user_id = ? AND reason = 'test_reset'`).get(tester.id).n, 0);
  assert.ok(!db.prepare('SELECT controller_id FROM play_controllers WHERE user_id = ?').get(tester.id).controller_id.startsWith('reset_'));

  // ── Reset réussi, puis rejeu de la même requête (double clic, réseau) ──
  const okBody = body();
  const done = await admin('POST', url, okBody);
  assert.strictEqual(done.status, 200, done.text);
  assert.strictEqual(done.body.runNo, 1);
  assert.strictEqual(done.body.newRunNo, 2);
  assert.strictEqual(done.body.revision, rev0 + 1);
  const again = await admin('POST', url, okBody);
  assert.strictEqual(again.status, 200);
  assert.strictEqual(again.body.replayed, true);
  assert.strictEqual(again.body.testRunId, done.body.testRunId);
  assert.strictEqual(saveRow(tester.id).version, rev0 + 1, 'aucun second reset');
  assert.strictEqual(count('player_test_runs', tester.id), 1);

  // ── État d'un nouveau personnage ──
  const fresh = JSON.parse(saveRow(tester.id).data);
  assert.deepStrictEqual([fresh.depth, fresh.coins, fresh.gems, fresh.pickaxeLevel, fresh.damage, fresh.relicFragments], [1, 0, 0, 1, 1, 0]);
  assert.deepStrictEqual(fresh.upgrades, { luck: 0, bag: 0, autodig: 0, fragment_shop: 0, block_reroll: 0 });
  assert.deepStrictEqual(fresh.relics, {});
  assert.deepStrictEqual(fresh.collection, []);
  assert.strictEqual(fresh.stats.blocksDestroyed, 0);
  assert.strictEqual(fresh.seasonStats.seasonId, season.id);
  assert.strictEqual(fresh.seasonStats.maxDepth, 0);
  assert.strictEqual(fresh.seasonStats.manualClicks, 0);
  assert.deepStrictEqual(fresh.daily, progress.daily, 'récompense quotidienne déjà prise : pas de second gain');
  assert.strictEqual(fresh.dailyMissions.missions[0].claimed, true, 'mission réclamée : pas de second gain');
  assert.deepStrictEqual(fresh.dailyMissions.baselineStats, { blocksDestroyed: -5, depth: 0 }, 'progression du jour gardée (B11)');
  assert.deepStrictEqual(fresh.monetization, progress.monetization);
  assert.strictEqual(rankRow(season.id, tester.id), undefined, 'non classé pour la saison active');
  assert.strictEqual(rankRow(closed, tester.id).max_depth, 222, 'saison clôturée intacte');
  for (const t of ['player_depth_tracking', 'player_click_tracking', 'risk_scores', 'player_badges', 'badge_player_stats', 'collection_pity']) {
    assert.strictEqual(count(t, tester.id), 0, t);
  }
  assert.strictEqual(count('anticheat_logs', tester.id), 1, 'preuves anti-bot conservées');
  assert.ok(db.prepare(`SELECT 1 FROM security_events WHERE user_id = ? AND type = 'cps_flagged'`).get(tester.id));
  const se = db.prepare(`SELECT * FROM security_events WHERE user_id = ? AND type = 'admin_test_reset'`).get(tester.id);
  assert.strictEqual(se.score_before, 74.9, 'le reset du score de risque est journalisé, pas silencieux');
  assert.ok(db.prepare(`SELECT 1 FROM user_events WHERE user_id = ? AND event_type = 'admin_test_reset'`).get(tester.id));
  const gem = db.prepare('SELECT * FROM gem_accounts WHERE user_id = ?').get(tester.id);
  assert.deepStrictEqual([gem.balance, gem.ref_autodig, gem.ref_blocks, gem.last_revision], [0, 0, '{}', rev0 + 1]);
  assert.strictEqual(db.prepare(`SELECT delta FROM gem_ledger WHERE user_id = ? AND reason = 'test_reset'`).get(tester.id).delta, -7);
  assert.strictEqual(db.prepare('SELECT league_id FROM users WHERE id = ?').get(tester.id).league_id, leagues[0]?.id ?? null);
  assert.deepStrictEqual([rankRow(season.id, other1.id), rankRow(season.id, other2.id)], othersBefore, 'les deux autres joueurs ne bougent pas');
  lb = await leaderboard();
  assert.ok(!lb.some(x => x.username === 'tester75'), JSON.stringify(lb));
  assert.deepStrictEqual(lb.map(x => x.username), ['other75a', 'other75b']);

  // ── Ancien onglet / PWA / sauvegarde différée : aucune réinjection ──
  const oldState = { lastSaveTime: Date.now(), ...progress, depth: 4, seasonStats: ss({ maxDepth: 1011, manualBlocks: 57, manualClicks: 9999 }) };
  let r = await tester.call('POST', '/api/me/save', { data: oldState, baseRevision: rev0, controllerId: tabOld });
  assert.strictEqual(r.status, 409); assert.strictEqual(r.body.adminReset, true);
  r = await tester.call('POST', '/api/me/play/heartbeat', { controllerId: tabOld });
  assert.strictEqual(r.body.active, false); assert.strictEqual(r.body.adminReset, true);
  r = await tester.call('POST', '/api/me/save', { data: oldState }); // client d'avant #18, bail du reset encore frais
  assert.strictEqual(r.status, 409);
  db.prepare('UPDATE play_controllers SET heartbeat_ms = 0 WHERE user_id = ?').run(tester.id); // bail expiré
  r = await tester.call('POST', '/api/me/save', { data: oldState }); // sans révision : refusé par la garde
  assert.strictEqual(r.status, 409); assert.strictEqual(r.body.conflict, true);
  assert.strictEqual(r.body.save.data.depth, 1);
  assert.strictEqual(saveRow(tester.id).version, rev0 + 1);

  // ── Rechargement (F5) : la page reprend la main et lit l'état réinitialisé ──
  const tabNew = ctrl();
  r = await tester.call('POST', '/api/me/play/claim', { controllerId: tabNew });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.save.revision, rev0 + 1);
  assert.strictEqual(r.body.save.data.depth, 1);
  r = await tester.call('POST', '/api/me/play/heartbeat', { controllerId: tabOld });
  assert.ok(!r.body.adminReset, 'après reprise par une vraie page : verrou ordinaire');

  // ── Un bloc cassé à la main : total 1, nouvelle profondeur, rang recalculé ──
  await playRanked(tester, tabNew, 1);
  const nr = rankRow(season.id, tester.id);
  assert.deepStrictEqual([nr.max_depth, nr.manual_blocks, Math.min(nr.effective_manual_blocks, nr.manual_blocks)], [2, 1, 1]);
  lb = await leaderboard();
  const me = lb.find(x => x.username === 'tester75');
  assert.ok(me && me.manualBlocks === 1 && me.rank > 1, JSON.stringify(lb));
  r = await tester.call('GET', '/api/me/save');
  assert.strictEqual(r.body.save.data.upgrades?.autodig ?? 0, 0, 'Auto-Dig précédent absent');

  // ── Historique, export, audit ──
  const runs = await admin('GET', `/api/admin/players/${tester.id}/test-runs`);
  assert.strictEqual(runs.status, 200, runs.text);
  assert.strictEqual(runs.body.runs.length, 1);
  const r1 = runs.body.runs[0];
  assert.deepStrictEqual([r1.runNo, r1.endKind, r1.stats.rankedMaxDepth, r1.stats.manualBlocksValidated, r1.stats.autodigLevelEnd, r1.stats.riskScore, r1.stats.coins],
    [1, 'test_reset', 1011, 57, 3, 74.9, 500]);
  assert.strictEqual(r1.stats.anticheatActions.flagged, 1);
  assert.strictEqual(runs.body.current.runNo, 2);
  assert.strictEqual(runs.body.current.stats.manualBlocksValidated, 1);
  assert.strictEqual(runs.body.current.stats.serverDecisions.cps_flagged, undefined, 'les preuves de l\'essai 1 ne comptent pas dans l\'essai 2');
  assert.strictEqual(runs.body.auditChain.ok, true);
  const csv = await admin('GET', `/api/admin/players/${tester.id}/test-runs/export?format=csv`);
  assert.strictEqual(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.strictEqual(csv.text.trim().split('\n').length, 3, csv.text);
  const full = await admin('GET', `/api/admin/players/${tester.id}/test-runs/export?format=json&full=1`);
  const snap = full.body.runs[0].snapshot;
  assert.strictEqual(snap.save.data.coins, 500);
  assert.strictEqual(snap.evidence.anticheat_logs.rows.length, 1);
  assert.ok(snap.evidence.security_events.rows.every(x => !('ip_hash' in x)), 'aucune empreinte d\'IP exportée');
  assert.throws(() => db.prepare(`UPDATE player_test_run_audit SET actor = 'x'`).run(), /ajout seul/);
  assert.throws(() => db.prepare(`DELETE FROM player_test_runs`).run(), /conservées/);
  assert.throws(() => db.prepare(`UPDATE player_test_runs SET reason = 'x'`).run(), /non modifiables/);

  // ── Restauration de l'essai 1 (l'essai 2 est archivé, pas détruit) ──
  const rp = await admin('GET', `/api/admin/players/${tester.id}/test-runs/${r1.id}/restore-preview`);
  assert.strictEqual(rp.status, 200, rp.text);
  assert.strictEqual(rp.body.sameSeason, true);
  assert.deepStrictEqual(rp.body.diff.find(d => d.key === 'rankedMaxDepth'), { key: 'rankedMaxDepth', current: 2, restored: 1011 });
  const rurl = `/api/admin/players/${tester.id}/test-runs/${r1.id}/restore`;
  const rbody = { confirmUsername: 'tester75', expectedRevision: rp.body.expectedRevision, requestId: reqId(), reason: 'Retour à l\'essai 1' };
  assert.strictEqual((await admin('POST', rurl, { ...rbody, expectedRevision: 1 })).status, 409);
  const rest = await admin('POST', rurl, rbody);
  assert.strictEqual(rest.status, 200, rest.text);
  assert.strictEqual(rest.body.runNo, 2);
  const restored = JSON.parse(saveRow(tester.id).data);
  assert.deepStrictEqual([restored.coins, restored.upgrades.autodig, restored.relics.eye_of_miner], [500, 3, 3]);
  assert.strictEqual(rankRow(season.id, tester.id).max_depth, 1011);
  assert.strictEqual(rankRow(closed, tester.id).max_depth, 222);
  assert.strictEqual(db.prepare('SELECT balance FROM gem_accounts WHERE user_id = ?').get(tester.id).balance, 7);
  assert.strictEqual(db.prepare('SELECT league_id FROM users WHERE id = ?').get(tester.id).league_id, leagueBefore);
  assert.strictEqual(count('player_badges', tester.id), 1);
  assert.deepStrictEqual([rankRow(season.id, other1.id), rankRow(season.id, other2.id)], othersBefore);
  const after = (await admin('GET', `/api/admin/players/${tester.id}/test-runs`)).body;
  assert.deepStrictEqual(after.runs.map(x => [x.runNo, x.endKind]), [[1, 'test_reset'], [2, 'restore']]);
  assert.strictEqual(after.runs[1].stats.manualBlocksValidated, 1, 'essai 2 archivé avec ses chiffres');
  assert.strictEqual(after.auditChain.ok, true);
  r = await tester.call('POST', '/api/me/save', { data: oldState, baseRevision: rev0 + 3, controllerId: tabNew });
  assert.strictEqual(r.status, 409, 'la page de l\'essai 2 ne peut pas écraser la restauration');
  assert.strictEqual(r.body.adminReset, true);
});

test('réinitialisation saisonnière partielle : instantané archivé avant écriture', async () => {
  const p = await newPlayer('partial75');
  await playRanked(p, ctrl(), 2, { coins: 42 });
  const r = await admin('POST', `/api/admin/players/${p.id}/season-reset`, { confirm: true });
  assert.strictEqual(r.status, 200, r.text);
  assert.match(r.body.message, /partielle/);
  const runs = (await admin('GET', `/api/admin/players/${p.id}/test-runs`)).body.runs;
  assert.deepStrictEqual(runs.map(x => x.endKind), ['season_reset_partial']);
  assert.strictEqual(runs[0].stats.coins, 42);
  assert.strictEqual(JSON.parse(saveRow(p.id).data).coins, 0);
});
