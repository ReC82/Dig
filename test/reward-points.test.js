/**
 * Tests des points de récompense saisonniers, ticket #33 :
 * - barème : validation, catégories exclusives, pourcentages, minimum d'éligibles, ex æquo,
 *   bonus de ligue, filtre anti-bot optionnel ;
 * - simulation par défaut : points calculés à la clôture, jamais crédités ;
 * - mode live : crédit idempotent (une fois par saison et par joueur), pas de rétroactivité ;
 * - registre : ajout seul, solde jamais négatif, double dépense impossible, cadeaux réels
 *   verrouillés, remboursement, contrôle de cohérence ;
 * - routes HTTP joueur et admin (serveur de test, port ≠ 3000, base temporaire).
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
const PORT  = process.env.DIG_TEST_PORT_POINTS || '3135';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-points-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');
delete process.env.CONTEST_REAL_PRIZES;

const cal       = require('../server/seasonCalendar');
const db        = require('../server/db');
const seasons   = require('../server/seasons');
const points    = require('../server/rewardPoints');

db.initDb();
const conn = () => db.getDb();

let userSeq = 0;
function newUser() {
  return conn().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(`points_user_${++userSeq}`, 'x').lastInsertRowid;
}

function putRanking(seasonId, userId, { depth, blocks, reachedAt = null, leagueId = null }) {
  conn().prepare(`
    INSERT INTO season_rankings (season_id, user_id, league_id, max_depth, reported_max_depth, manual_blocks,
                                 effective_manual_blocks, is_active, max_depth_reached_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`)
    .run(seasonId, userId, leagueId, depth, depth, blocks, blocks, reachedAt);
}

/** Clôture la saison active (après sa fin) et renvoie son identifiant. */
function closeActive() {
  const season = db.getActiveSeason();
  seasons.closeActiveSeason(season.id, new Date(cal.parseUtc(season.end_at).getTime() + 30_000));
  return season.id;
}

const SCALE = points.validateScale(points.PROPOSED_SCALE);
const rowsOf = list => list.map(([user_id, max_depth, blocks, eligible = 1, risk = 0, league_id = null], i) => ({
  position: i + 1, user_id, max_depth, effective_manual_blocks: blocks, manual_blocks: blocks, eligible, risk_level: risk, league_id,
}));

// ── Barème (pur) ──────────────────────────────────────────────────────────────

test('validateScale : refuse les barèmes incohérents, normalise le barème proposé', () => {
  assert.strictEqual(SCALE.tiers.length, 7);
  assert.strictEqual(SCALE.tiesShareTier, true);
  for (const bad of [
    null, {}, { tiers: [] },
    { tiers: [{ id: 'a', points: -1 }] },
    { tiers: [{ id: 'a', points: 1.5 }] },
    { tiers: [{ id: 'a', points: 1 }, { id: 'a', points: 2 }] },
    { tiers: [{ id: 'A B', points: 1 }] },
    { tiers: [{ id: 'a', points: 1, rankMax: 1, percentMax: 5 }] },
    { tiers: [{ id: 'a', points: 1, percentMax: 0 }] },
    { tiers: [{ id: 'a', points: 1, percentMax: 101 }] },
    { tiers: [{ id: 'a', points: 1 }], leagueBonusPctPerLevel: 500 },
  ]) assert.throws(() => points.validateScale(bad), points.PointsError, JSON.stringify(bad));
});

test('tierForRank : catégories exclusives, pourcentages arrondis au-dessus, minimum d\'éligibles', () => {
  const tier = (rank, n) => points.tierForRank(SCALE, rank, n)?.id ?? null;
  // 1 seul éligible : le « 1er » exige 3 éligibles, les pourcentages fins 10 → participant
  assert.strictEqual(tier(1, 1), 'active');
  // 2 éligibles : top 50 % = 1er
  assert.deepStrictEqual([tier(1, 2), tier(2, 2)], ['top50', 'active']);
  // 4 éligibles : 1er, top 25 % = rang 1 (déjà pris par « 1er »), top 50 % = rang 2
  assert.deepStrictEqual([1, 2, 3, 4].map(r => tier(r, 4)), ['first', 'top50', 'active', 'active']);
  // 100 éligibles : bornes exactes
  assert.deepStrictEqual([1, 2, 5, 6, 10, 11, 25, 26, 50, 51, 100].map(r => tier(r, 100)),
    ['first', 'top5', 'top5', 'top10', 'top10', 'top25', 'top25', 'top50', 'top50', 'active', 'active']);
  // 1000 éligibles : top 1 % = rangs 2 à 10
  assert.deepStrictEqual([2, 10, 11].map(r => tier(r, 1000)), ['top1', 'top1', 'top5']);
  assert.strictEqual(tier(0, 10), null);
  assert.strictEqual(points.percentCutoff(10, 30), 3);
  assert.strictEqual(points.percentCutoff(1, 5), 1);
});

test('computeAwards : ex æquo parfaits partagent la meilleure catégorie, bonus de ligue, filtre anti-bot', () => {
  // 4 éligibles : rangs 2 et 3 ex æquo parfaits → tous deux top50 ; un non-éligible ignoré
  const rows = rowsOf([[1, 90, 50], [2, 50, 20], [3, 50, 20], [4, 10, 5], [5, 0, 1, 0]]);
  let r = points.computeAwards(SCALE, rows);
  assert.strictEqual(r.eligible, 4);
  assert.deepStrictEqual(r.awards.map(a => [a.user_id, a.rank, a.tier?.id, a.points]),
    [[1, 1, 'first', 100], [2, 2, 'top50', 12], [3, 3, 'top50', 12], [4, 4, 'active', 5]]);

  const noTies = points.validateScale({ ...SCALE, tiesShareTier: false });
  assert.strictEqual(points.computeAwards(noTies, rows).awards[2].tier.id, 'active');

  const bonus = points.validateScale({ ...SCALE, leagueBonusPctPerLevel: 10 });
  r = points.computeAwards(bonus, rowsOf([[1, 90, 50, 1, 0, 7], [2, 50, 20, 1, 0, 8]]), new Map([[7, 2], [8, 0]]));
  assert.deepStrictEqual(r.awards.map(a => a.points), [Math.floor(12 * 1.2), 5]);

  const risk = points.validateScale({ ...SCALE, maxRiskLevel: 2 });
  r = points.computeAwards(risk, rowsOf([[1, 90, 50, 1, 3], [2, 50, 20, 1, 1]]));
  assert.deepStrictEqual(r.awards.map(a => [a.user_id, a.rank]), [[2, 1]], 'risque > seuil : écarté');

  assert.deepStrictEqual(points.computeAwards(SCALE, []), { eligible: 0, awards: [] });
});

// ── Simulation par défaut ─────────────────────────────────────────────────────

let simSeason, players;

test('par défaut : barème proposé en simulation, clôture → points calculés mais jamais crédités', () => {
  const s = points.getSettings();
  assert.strictEqual(s.mode, 'simulation');
  assert.strictEqual(s.scaleVersion, 1);
  assert.match(s.scaleNote, /non validée/);

  const season = db.getActiveSeason();
  players = Array.from({ length: 4 }, newUser);
  putRanking(season.id, players[0], { depth: 100, blocks: 80, reachedAt: '2026-11-04 10:00:00.000' });
  putRanking(season.id, players[1], { depth: 60,  blocks: 40, reachedAt: '2026-11-04 10:00:00.000' });
  putRanking(season.id, players[2], { depth: 30,  blocks: 20, reachedAt: '2026-11-04 10:00:00.000' });
  putRanking(season.id, players[3], { depth: 0,   blocks: 1 });
  simSeason = closeActive();

  const runs = conn().prepare('SELECT * FROM reward_point_runs WHERE season_id = ?').all(simSeason);
  assert.deepStrictEqual(runs.map(r => [r.mode, r.eligible, r.recipients, r.total_points]), [['simulation', 3, 3, 100 + 12 + 5]]);
  const awards = conn().prepare("SELECT user_id, tier, points, ledger_id FROM reward_point_awards WHERE season_id = ? ORDER BY rank").all(simSeason);
  assert.deepStrictEqual(awards.map(a => [a.user_id, a.tier, a.points, a.ledger_id]),
    [[players[0], 'first', 100, null], [players[1], 'top50', 12, null], [players[2], 'active', 5, null]]);
  assert.strictEqual(conn().prepare('SELECT COUNT(*) AS n FROM reward_point_ledger').get().n, 0, 'aucun crédit en simulation');
  assert.strictEqual(points.getWallet(players[0]).balance, 0);

  // Idempotent : rejouer l'attribution ou le rattrapage ne crée rien
  assert.deepStrictEqual(points.awardSeason(simSeason), { simulation: null, live: null });
  assert.strictEqual(points.awardMissingSeasons(), 0);
});

// ── Mode live ─────────────────────────────────────────────────────────────────

test('live : crédit à la clôture suivante, une fois par joueur, sans rétroactivité', () => {
  const active = db.getActiveSeason();
  points.setMode('live', new Date(cal.parseUtc(active.start_at).getTime() + 1000));
  assert.strictEqual(points.awardMissingSeasons(), 0, 'la saison simulée avant l\'activation n\'est pas créditée');

  putRanking(active.id, players[0], { depth: 50, blocks: 30, reachedAt: '2026-11-11 10:00:00.000' });
  putRanking(active.id, players[1], { depth: 70, blocks: 30, reachedAt: '2026-11-11 10:00:00.000' });
  const liveSeason = closeActive();

  const runs = conn().prepare('SELECT mode, recipients, total_points FROM reward_point_runs WHERE season_id = ? ORDER BY mode').all(liveSeason);
  assert.deepStrictEqual(runs.map(r => [r.mode, r.recipients, r.total_points]), [['live', 2, 17], ['simulation', 2, 17]]);
  assert.strictEqual(points.getWallet(players[1]).balance, 12, '1er de 2 éligibles : top 50 %');
  assert.strictEqual(points.getWallet(players[0]).balance, 5);
  const entry = conn().prepare('SELECT * FROM reward_point_ledger WHERE user_id = ?').get(players[1]);
  assert.strictEqual(entry.idem_key, `season:${liveSeason}:user:${players[1]}`);
  assert.strictEqual(entry.kind, 'season_award');
  assert.strictEqual(entry.season_id, liveSeason);

  // Rejouer : aucun double crédit
  points.awardSeason(liveSeason);
  points.awardMissingSeasons();
  assert.strictEqual(points.getWallet(players[1]).balance, 12);
  assert.strictEqual(conn().prepare('SELECT COUNT(*) AS n FROM reward_point_ledger').get().n, 2);

  // Les points survivent au changement de saison (portefeuille hors sauvegarde de jeu)
  const summary = points.buildPlayerSummary(players[1]);
  assert.strictEqual(summary.balance, 12);
  assert.strictEqual(summary.mode, 'live');
  assert.strictEqual(summary.history[0].delta, 12);
  assert.ok(summary.awards.some(a => a.seasonId === simSeason && a.mode === 'simulation'), 'simulation passée visible');
  assert.ok(summary.potential, 'récompense potentielle de la saison en cours');
  assert.strictEqual(points.verifyLedger().ok, true);

  points.setMode('simulation');
});

test('saison sans éligible : exécution vide enregistrée, aucun crédit', () => {
  points.setMode('live', new Date(cal.parseUtc(db.getActiveSeason().start_at).getTime() + 1000));
  const id = closeActive();
  const run = conn().prepare("SELECT * FROM reward_point_runs WHERE season_id = ? AND mode = 'live'").get(id);
  assert.deepStrictEqual([run.eligible, run.recipients, run.total_points], [0, 0, 0]);
  points.setMode('simulation');
});

test('récompense potentielle (saison en cours) : même catégorie que la clôture, ex æquo compris', () => {
  const season = db.getActiveSeason();
  const [a, b, c, d] = [newUser(), newUser(), newUser(), newUser()];
  putRanking(season.id, a, { depth: 40, blocks: 30, reachedAt: '2026-11-20 10:00:00.000' });
  putRanking(season.id, b, { depth: 40, blocks: 30, reachedAt: '2026-11-20 11:00:00.000' });   // ex æquo parfait de a
  putRanking(season.id, c, { depth: 20, blocks: 10 });
  putRanking(season.id, d, { depth: 0, blocks: 3 });                                          // non éligible
  const pot = u => { const p = points.potentialFor(u); return [p.rank, p.eligibleCount, p.tier, p.points]; };
  assert.deepStrictEqual(pot(a), [1, 3, 'first', 100]);
  assert.deepStrictEqual(pot(b), [2, 3, 'first', 100], 'ex æquo parfait : catégorie du premier');
  assert.deepStrictEqual(pot(c), [3, 3, 'active', 5]);
  assert.deepStrictEqual(pot(d), [null, 3, null, 0]);
  const id = closeActive();
  const awarded = conn().prepare("SELECT user_id, tier, points FROM reward_point_awards WHERE season_id = ? AND mode = 'simulation' ORDER BY rank").all(id);
  assert.deepStrictEqual(awarded.map(x => [x.user_id, x.tier, x.points]), [[a, 'first', 100], [b, 'first', 100], [c, 'active', 5]],
    'la clôture confirme l\'aperçu');
});

// ── Registre ──────────────────────────────────────────────────────────────────

test('registre : dépense idempotente, solde jamais négatif, cadeaux réels verrouillés, remboursement', () => {
  const u = players[1];                     // solde 12
  const first = points.spend(u, 10, { idemKey: 'order:1', reason: 'avatar' });
  assert.strictEqual(first.duplicate, false);
  assert.strictEqual(first.entry.balance_after, 2);
  // Même commande rejouée (double clic, nouvelle tentative réseau) : aucun second débit
  const again = points.spend(u, 10, { idemKey: 'order:1' });
  assert.strictEqual(again.duplicate, true);
  assert.strictEqual(points.getWallet(u).balance, 2);
  // Même clé, autre montant : refus
  assert.throws(() => points.spend(u, 1, { idemKey: 'order:1' }), e => e.status === 409);
  // Solde insuffisant : refus, rien n'est écrit
  assert.throws(() => points.spend(u, 3, { idemKey: 'order:2' }), e => e.status === 409);
  assert.strictEqual(conn().prepare("SELECT COUNT(*) AS n FROM reward_point_ledger WHERE idem_key = 'order:2'").get().n, 0);
  // Cadeau réel : verrouillé tant que CONTEST_REAL_PRIZES ≠ on (#27)
  assert.throws(() => points.spend(u, 1, { idemKey: 'order:3', use: 'real' }), e => e.status === 403);
  // Remboursement borné au montant de la dépense
  assert.throws(() => points.refund(u, 11, { idemKey: 'refund:1', spendId: first.entry.id }), e => e.status === 400);
  points.refund(u, 10, { idemKey: 'refund:1', spendId: first.entry.id });
  assert.strictEqual(points.getWallet(u).balance, 12);
  assert.deepStrictEqual([points.getWallet(u).earnedTotal, points.getWallet(u).spentTotal], [22, 10]);

  // Ajustement admin : motif obligatoire, débit borné par le solde
  assert.throws(() => points.adminAdjust(u, 5, { reason: '' }), e => e.status === 400);
  assert.throws(() => points.adminAdjust(u, -50, { reason: 'correction' }), e => e.status === 409);
  points.adminAdjust(u, -2, { reason: 'correction test' });
  assert.strictEqual(points.getWallet(u).balance, 10);
  assert.strictEqual(points.verifyLedger().ok, true);
});

test('registre, barèmes et attributions en ajout seul ; solde négatif refusé par la base', () => {
  for (const sql of [
    'UPDATE reward_point_ledger SET delta = 999',
    'DELETE FROM reward_point_ledger',
    'UPDATE reward_point_scales SET scale = \'{}\'',
    'DELETE FROM reward_point_scales',
    'UPDATE reward_point_awards SET points = 999',
    'DELETE FROM reward_point_awards',
    'DELETE FROM reward_point_runs',
  ]) assert.throws(() => conn().prepare(sql).run(), /ajout seul/, sql);
  assert.throws(() => conn().prepare('UPDATE reward_point_wallets SET balance = -1').run(), /CHECK/);
});

test('barème : nouvelle version conservée, aperçu sur une saison figée, migration rejouable', () => {
  const before = points.getSettings().scaleVersion;
  const s = points.setScale({ tiers: [{ id: 'all', label: 'Tous', points: 7 }] }, 'test');
  assert.strictEqual(s.scaleVersion, before + 1);
  assert.strictEqual(points.listScales().length, before + 1);
  const p = points.previewScale({ tiers: [{ id: 'all', points: 3 }] }, simSeason);
  assert.deepStrictEqual([p.eligible, p.total], [3, 9]);
  // Les attributions déjà faites gardent leur version de barème
  assert.strictEqual(conn().prepare('SELECT DISTINCT scale_version AS v FROM reward_point_awards WHERE season_id = ?').get(simSeason).v, 1);
  db.initDb();
  points.ensureDefaults();
  assert.strictEqual(points.getSettings().scaleVersion, before + 1, 'redémarrage : barème choisi conservé');
});

// ── Routes HTTP ───────────────────────────────────────────────────────────────

test('routes : portefeuille joueur, barème public, administration', async (t) => {
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
  const call = async (method, url, body, { auth = true, cookie } = {}) => {
    const res = await fetch(BASE + url, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${ADMIN}` } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  let r = await call('GET', '/api/points/scale', undefined, { auth: false });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.mode, 'simulation');
  assert.strictEqual(r.body.tiers[0].id, 'first');
  r = await call('GET', '/api/points/me', undefined, { auth: false });
  assert.strictEqual(r.status, 401);

  const reg = await fetch(`${BASE}/api/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'pointeur', email: 'pointeur@example.test', password: 'motdepasse-solide-33' }),
  });
  assert.strictEqual(reg.status, 200, 'inscription');
  const cookie = reg.headers.get('set-cookie').split(';')[0];
  const cur = (await (await fetch(`${BASE}/api/seasons/current`)).json()).season;
  const sdb = new (require('better-sqlite3'))(httpDb);
  const uid = sdb.prepare("SELECT id FROM users WHERE username = 'pointeur'").get().id;
  sdb.prepare(`INSERT INTO season_rankings (season_id, user_id, max_depth, reported_max_depth, manual_blocks, effective_manual_blocks, is_active, max_depth_reached_at)
               VALUES (?, ?, 40, 40, 30, 30, 1, '2026-11-04 10:00:00.000')`).run(cur.id, uid);
  sdb.close();

  r = await call('GET', '/api/points/me', undefined, { auth: false, cookie });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual([r.body.balance, r.body.mode, r.body.potential.rank, r.body.potential.tier, r.body.potential.points],
    [0, 'simulation', 1, 'active', 5]);

  r = await call('GET', '/api/admin/points', undefined, { auth: false });
  assert.strictEqual(r.status, 401);
  r = await call('PUT', '/api/admin/points/mode', { mode: 'turbo' });
  assert.strictEqual(r.status, 400);
  r = await call('PUT', '/api/admin/points/scale', { scale: { tiers: [] } });
  assert.strictEqual(r.status, 400);
  r = await call('POST', '/api/admin/points/adjust', { userId: uid, amount: 4, reason: 'geste commercial test' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.wallet.balance, 4);
  r = await call('POST', '/api/admin/points/adjust', { userId: uid, amount: -9, reason: 'trop' });
  assert.strictEqual(r.status, 409);
  r = await call('POST', '/api/admin/points/adjust', { userId: 'x', amount: 1, reason: 'abc' });
  assert.strictEqual(r.status, 400);
  r = await call('GET', '/api/admin/points');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.verification.ok, true);
  assert.strictEqual(r.body.totals.balance, 4);

  // Clôture admin manuelle : le planificateur fige puis attribue (simulation) ; on force ici le rattrapage
  r = await call('POST', `/api/admin/seasons/${cur.id}/close`, {});
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  r = await call('GET', `/api/admin/points/seasons/${cur.id}`);
  assert.deepStrictEqual(r.body.awards.map(a => [a.mode, a.username, a.tier, a.points, a.ledger_id]), [['simulation', 'pointeur', 'active', 5, null]]);
  r = await call('POST', '/api/admin/points/scale/preview', { seasonId: cur.id, scale: { tiers: [{ id: 'x', points: 2 }] } });
  assert.deepStrictEqual([r.status, r.body.total], [200, 2]);
  r = await call('GET', '/api/points/me', undefined, { auth: false, cookie });
  assert.strictEqual(r.body.balance, 4, 'simulation : solde inchangé');
  assert.strictEqual(r.body.awards[0].mode, 'simulation');
});

test.after(() => {
  seasons.stopSeasonScheduler();
  try { db.getDb().close(); } catch (_) {}
  fs.rmSync(dir, { recursive: true, force: true });
});
