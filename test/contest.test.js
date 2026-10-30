/**
 * Tests du concours au mérite et de son administration, ticket #30 :
 * - réglages : validation, audit avant/après, calendrier ;
 * - aperçu : critères (profondeur min., risque max., exclusion motivée, délai entre deux gains),
 *   saison active indicative seulement, aucun hasard ;
 * - attribution : premiers éligibles de l'instantané figé, double attribution interdite,
 *   cadeaux réels verrouillés, stock ;
 * - suivi des gagnants : transitions autorisées/interdites, journal en ajout seul, notes sans
 *   e-mail ni code cadeau, consultation des coordonnées journalisée sans l'adresse ;
 * - routes HTTP admin (serveur de test, port ≠ 3000, base temporaire).
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
const PORT  = process.env.DIG_TEST_PORT_CONTEST || '3134';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-contest-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');
delete process.env.CONTEST_REAL_PRIZES;

const cal       = require('../server/seasonCalendar');
const db        = require('../server/db');
const standings = require('../server/standings');
const contest   = require('../server/contest');

db.initDb();
const conn = () => db.getDb();
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

let userSeq = 0;
function newUser(email = null) {
  return conn().prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)')
    .run(`contest_user_${++userSeq}`, email, 'x').lastInsertRowid;
}

function putRanking(seasonId, userId, depth, blocks = Math.max(depth, 1), reachedAt = null) {
  conn().prepare(`
    INSERT INTO season_rankings (season_id, user_id, max_depth, reported_max_depth, manual_blocks,
                                 effective_manual_blocks, is_active, max_depth_reached_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)`).run(seasonId, userId, depth, depth, blocks, blocks, reachedAt);
}

let weekSeq = 0;
function pastSeason() {
  const start = new Date(Date.UTC(2025, 0, 6) + (weekSeq++) * 7 * 86400_000);
  const end   = new Date(start.getTime() + 7 * 86400_000 - 1000);
  return db.createSeason(`Saison test ${weekSeq}`, cal.fmtUtc(start), cal.fmtUtc(end), 'closed');
}

/** Saison close et figée avec les profondeurs données (dans l'ordre des utilisateurs). */
function frozenSeason(rows) {
  const s = pastSeason();
  for (const [userId, depth] of rows) putRanking(s.id, userId, depth);
  standings.freezeSeasonStandings(s.id);
  return s;
}

const errStatus = (fn) => { try { fn(); } catch (e) { return [e.status, e.message]; } return [null, null]; };

const auditRows = () => conn().prepare('SELECT * FROM contest_audit ORDER BY id').all();

// ── Réglages ──────────────────────────────────────────────────────────────────

test('réglages : valeurs par défaut prudentes (désactivé, simulation, stock vide, 5 € Amazon)', () => {
  const s = contest.getSettings();
  assert.strictEqual(s.enabled, false);
  assert.strictEqual(s.realPrizesUnlocked, false);
  assert.deepStrictEqual(s.prize, { label: 'Carte cadeau Amazon', provider: 'Amazon', valueCents: 500, currency: 'EUR', stock: 0 });
  assert.strictEqual(s.lotsPerSeason, 1);
  assert.strictEqual(s.maxRiskLevel, null, 'aucune exclusion anti-bot par défaut (#25 lot C non décidé)');
  assert.deepStrictEqual(s.realEligibility, {}, 'éligibilité des cadeaux réels vide par défaut (#27)');
});

test('réglages : validation, champs inconnus refusés, audit avant/après', () => {
  assert.strictEqual(errStatus(() => contest.updateSettings({ foo: 1 }))[0], 400);
  assert.strictEqual(errStatus(() => contest.updateSettings({ prizeCurrency: 'euro' }))[0], 400);
  assert.strictEqual(errStatus(() => contest.updateSettings({ lotsPerSeason: 0 }))[0], 400);
  assert.strictEqual(errStatus(() => contest.updateSettings({ maxRiskLevel: 9 }))[0], 400);
  assert.strictEqual(errStatus(() => contest.updateSettings({ enabled: 'yes' }))[0], 400);
  assert.strictEqual(errStatus(() => contest.updateSettings({ realEligibility: { countries: ['be'] } }))[0], 400);
  assert.strictEqual(errStatus(() => contest.updateSettings({ startsAt: '2026-02-01 00:00:00', endsAt: '2026-01-01 00:00:00' }))[0], 400);
  assert.strictEqual(contest.getSettings().startsAt, null, 'refus = rien d\'écrit (transaction annulée)');

  const after = contest.updateSettings({ prizeStock: 3, description: 'Lot de la semaine', realEligibility: { countries: ['BE', 'FR'], minAge: null, parentalConsent: true } });
  assert.strictEqual(after.prize.stock, 3);
  assert.deepStrictEqual(after.realEligibility.countries, ['BE', 'FR']);
  const last = auditRows().at(-1);
  assert.strictEqual(last.action, 'settings_updated');
  assert.deepStrictEqual(JSON.parse(last.details).prizeStock, { from: 0, to: 3 });
  contest.updateSettings({ prizeStock: 0, realEligibility: {} });
});

// ── Notes ─────────────────────────────────────────────────────────────────────

test('notes du journal : ni e-mail ni code cadeau', () => {
  assert.strictEqual(contest.checkNote('Contacté via la messagerie'), 'Contacté via la messagerie');
  assert.strictEqual(contest.checkNote(''), null);
  assert.strictEqual(errStatus(() => contest.checkNote('écrit à joueur@example.com'))[0], 400);
  assert.strictEqual(errStatus(() => contest.checkNote('code AQ7D-4KXM2P-ZT9Q envoyé'))[0], 400);
  assert.strictEqual(errStatus(() => contest.checkNote('code: 7HD92KSL0QWE'))[0], 400);
  assert.strictEqual(errStatus(() => contest.checkNote('x'.repeat(301)))[0], 400);
});

// ── Aperçu et attribution ─────────────────────────────────────────────────────

test('aperçu : ordre au mérite et critères du concours, sans rien écrire', () => {
  const [a, b, c, d] = [newUser(), newUser(), newUser(), newUser()];
  const s = frozenSeason([[a, 300], [b, 200], [c, 5], [d, 0]]);

  contest.updateSettings({ minDepth: 10, lotsPerSeason: 2 });
  contest.setExclusion(s.id, a, 'multi-compte avéré');
  assert.strictEqual(errStatus(() => contest.setExclusion(s.id, a, 'encore'))[0], 409);
  assert.strictEqual(errStatus(() => contest.setExclusion(s.id, b, ''))[0], 400, 'motif obligatoire');

  const before = conn().prepare('SELECT COUNT(*) AS n FROM contest_winners').get().n;
  const p = contest.preview(s.id);
  assert.strictEqual(p.source, 'snapshot');
  assert.deepStrictEqual(p.participants.map(x => [x.userId, x.reason, x.lotNo]), [
    [a, 'admin_excluded', null],
    [b, null, 1],
    [c, 'below_min_depth', null],
    [d, 'depth_zero', null],
  ]);
  assert.strictEqual(p.counts.lots, 1, '2 lots prévus, 1 seul éligible');
  assert.ok(p.attributable);
  assert.strictEqual(conn().prepare('SELECT COUNT(*) AS n FROM contest_winners').get().n, before, 'aperçu sans écriture');

  contest.removeExclusion(s.id, a);
  assert.deepStrictEqual(contest.preview(s.id).participants.filter(x => x.lotNo).map(x => x.userId), [a, b]);
  contest.updateSettings({ minDepth: 1, lotsPerSeason: 1 });
});

test('aperçu : niveau de risque maximal (aucune exclusion par défaut)', () => {
  const [a, b] = [newUser(), newUser()];
  const s = pastSeason();
  putRanking(s.id, a, 100);
  putRanking(s.id, b, 50);
  // Risque de niveau 3 (score 85) mesuré à la fin de la saison, figé dans l'instantané.
  conn().prepare('INSERT INTO risk_scores (user_id, season_id, components, score, level, updated_ms) VALUES (?, ?, ?, 85, 3, ?)')
    .run(a, s.id, JSON.stringify({ test: 85 }), cal.parseUtc(s.end_at).getTime());
  standings.freezeSeasonStandings(s.id);
  assert.deepStrictEqual(contest.preview(s.id).participants.map(x => [x.riskLevel, x.reason, x.lotNo]), [[3, null, 1], [0, null, null]]);
  contest.updateSettings({ maxRiskLevel: 2 });
  assert.deepStrictEqual(contest.preview(s.id).participants.map(x => [x.reason, x.lotNo]), [['risk_level', null], [null, 1]]);
  contest.updateSettings({ maxRiskLevel: null });
});

test('saison active : aperçu indicatif sur le classement vivant, jamais attribuable', () => {
  const now = new Date();
  const s = db.getActiveSeason() ?? db.createSeason('Saison active test', cal.fmtUtc(new Date(now.getTime() - 86400_000)), cal.fmtUtc(new Date(now.getTime() + 86400_000)), 'active');
  const u = newUser();
  putRanking(s.id, u, 42);
  const p = contest.preview(s.id);
  assert.strictEqual(p.source, 'live');
  assert.strictEqual(p.participants[0].lotNo, 1);
  assert.ok(p.blockers.includes('season_not_frozen'));
  assert.strictEqual(p.attributable, false);
  assert.strictEqual(errStatus(() => contest.attribute(s.id))[0], 409);
});

test('attribution : premier éligible, idempotence refusée (double attribution), audit', () => {
  const [a, b] = [newUser(), newUser()];
  const s = frozenSeason([[a, 80], [b, 120]]);
  const winners = contest.attribute(s.id);
  assert.strictEqual(winners.length, 1);
  assert.strictEqual(winners[0].userId, b, 'le plus profond gagne');
  assert.strictEqual(winners[0].status, 'designated');
  assert.strictEqual(winners[0].mode, 'simulation');
  assert.strictEqual(winners[0].prize.valueCents, 500);
  assert.strictEqual(winners[0].snapshotHash, standings.getSnapshot(s.id).snapshot_hash);
  assert.strictEqual(contest.getSettings().prize.stock, 0, 'simulation : aucun stock consommé');

  const [st, msg] = errStatus(() => contest.attribute(s.id));
  assert.strictEqual(st, 409);
  assert.match(msg, /double attribution/);
  assert.ok(contest.preview(s.id).blockers.includes('already_attributed'));

  // Garde-fou en base : même saison/mode/lot ou même joueur deux fois → refus.
  assert.throws(() => conn().prepare(`INSERT INTO contest_winners (season_id, mode, lot_no, user_id, rank, max_depth, snapshot_hash, prize, expires_at)
    VALUES (?, 'simulation', 2, ?, 1, 1, 'h', '{}', '2099-01-01 00:00:00')`).run(s.id, b), /UNIQUE/);
  assert.throws(() => conn().prepare('DELETE FROM contest_winners WHERE id = ?').run(winners[0].id), /aucune suppression/);

  const ev = auditRows().filter(r => r.action === 'winner_designated' && r.season_id === s.id);
  assert.strictEqual(ev.length, 1);
  assert.throws(() => conn().prepare('DELETE FROM contest_audit').run(), /ajout seul/);
  assert.throws(() => conn().prepare("UPDATE contest_audit SET action = 'x'").run(), /ajout seul/);
});

test('saison sans éligible : aucun lot attribué', () => {
  const s = frozenSeason([[newUser(), 0]]);
  assert.strictEqual(contest.preview(s.id).attributable, false);
  assert.strictEqual(errStatus(() => contest.attribute(s.id))[0], 409);
});

test('délai entre deux gains : le gagnant récent passe la main au suivant', () => {
  const [a, b] = [newUser(), newUser()];
  const s1 = frozenSeason([[a, 500], [b, 100]]);
  contest.attribute(s1.id);
  const s2 = frozenSeason([[a, 600], [b, 200]]);
  assert.strictEqual(contest.preview(s2.id).participants.find(x => x.lotNo).userId, a, 'délai 0 : le premier gagne toujours');
  contest.updateSettings({ cooldownSeasons: 2 });
  const p = contest.preview(s2.id);
  assert.deepStrictEqual(p.participants.map(x => [x.userId, x.reason, x.lotNo]), [[a, 'cooldown', null], [b, null, 1]]);
  contest.updateSettings({ cooldownSeasons: 0 });
});

test('calendrier : saison hors fenêtre non attribuable', () => {
  const s = frozenSeason([[newUser(), 10]]);
  contest.updateSettings({ startsAt: '2030-01-01 00:00:00' });
  assert.ok(contest.preview(s.id).blockers.includes('outside_calendar'));
  assert.strictEqual(errStatus(() => contest.attribute(s.id))[0], 409);
  contest.updateSettings({ startsAt: null });
  assert.ok(contest.preview(s.id).attributable);
});

test('cadeaux réels verrouillés sans CONTEST_REAL_PRIZES=on, même concours activé et stock rempli', () => {
  const s = frozenSeason([[newUser(), 10]]);
  contest.updateSettings({ enabled: true, prizeStock: 5 });
  const p = contest.preview(s.id, { mode: 'real' });
  assert.ok(p.blockers.includes('real_prizes_locked'));
  assert.strictEqual(errStatus(() => contest.attribute(s.id, { mode: 'real' }))[0], 409);
  assert.strictEqual(contest.getSettings().prize.stock, 5);
  assert.strictEqual(conn().prepare("SELECT COUNT(*) AS n FROM contest_winners WHERE mode = 'real'").get().n, 0);
  contest.updateSettings({ enabled: false, prizeStock: 0 });
});

test('mode réel déverrouillé (simulé dans le test) : stock consommé, rendu à l\'expiration', () => {
  process.env.CONTEST_REAL_PRIZES = 'on';
  try {
    const s = frozenSeason([[newUser(), 10]]);
    contest.updateSettings({ prizeStock: 0, enabled: true });
    assert.ok(contest.preview(s.id, { mode: 'real' }).blockers.includes('insufficient_stock'));
    contest.updateSettings({ prizeStock: 1 });
    contest.updateSettings({ enabled: false });
    assert.ok(contest.preview(s.id, { mode: 'real' }).blockers.includes('contest_disabled'));
    contest.updateSettings({ enabled: true });
    const [w] = contest.attribute(s.id, { mode: 'real' });
    assert.strictEqual(contest.getSettings().prize.stock, 0);
    contest.transition(w.id, 'expired', 'pas de réponse');
    assert.strictEqual(contest.getSettings().prize.stock, 1, 'lot non remis : retour au stock');
  } finally {
    delete process.env.CONTEST_REAL_PRIZES;
    contest.updateSettings({ enabled: false, prizeStock: 0 });
  }
});

// ── Suivi des gagnants ────────────────────────────────────────────────────────

test('suivi : désigné → contacté → identité vérifiée → envoyé → confirmé, transitions contrôlées', () => {
  const s = frozenSeason([[newUser(), 33]]);
  const [w] = contest.attribute(s.id);
  assert.deepStrictEqual(w.next, ['contacted', 'expired']);
  assert.strictEqual(errStatus(() => contest.transition(w.id, 'sent'))[0], 409, 'pas d\'envoi avant vérification');
  assert.strictEqual(errStatus(() => contest.transition(w.id, 'bogus'))[0], 400);
  assert.strictEqual(errStatus(() => contest.transition(w.id, 'contacted', 'mail à x@y.be'))[0], 400);
  assert.strictEqual(contest.listWinners({ seasonId: s.id })[0].status, 'designated', 'refus = statut inchangé');
  for (const to of ['contacted', 'identity_verified', 'sent', 'confirmed']) {
    assert.strictEqual(contest.transition(w.id, to, `étape ${to}`).status, to);
  }
  assert.strictEqual(errStatus(() => contest.transition(w.id, 'expired'))[0], 409, 'confirmé = final');
  const journal = contest.listAudit({ winnerId: w.id }).events.reverse();
  assert.deepStrictEqual(journal.map(e => [e.action, e.from, e.to]), [
    ['winner_designated', null, 'designated'],
    ['winner_status', 'designated', 'contacted'],
    ['winner_status', 'contacted', 'identity_verified'],
    ['winner_status', 'identity_verified', 'sent'],
    ['winner_status', 'sent', 'confirmed'],
  ]);
  assert.strictEqual(errStatus(() => contest.transition(999999, 'contacted'))[0], 404);
});

test('suivi : expiration et retard signalé', () => {
  const s = frozenSeason([[newUser(), 7]]);
  const [w] = contest.attribute(s.id, { now: new Date(Date.UTC(2025, 0, 1)) });
  assert.strictEqual(contest.listWinners({ seasonId: s.id })[0].overdue, true, 'délai de 30 jours dépassé');
  assert.strictEqual(contest.transition(w.id, 'expired').status, 'expired');
  assert.strictEqual(contest.listWinners({ seasonId: s.id })[0].overdue, false);
  assert.ok(contest.preview(s.id).blockers.includes('already_attributed'), 'un lot expiré n\'est pas réattribué automatiquement');
});

test('coordonnées : lues à la demande, consultation journalisée sans l\'adresse', () => {
  const u = newUser('gagnant.contest@example.com');
  const s = frozenSeason([[u, 9]]);
  const [w] = contest.attribute(s.id);
  const c = contest.contact(w.id);
  assert.strictEqual(c.email, 'gagnant.contest@example.com');
  assert.strictEqual(c.emailVerified, false);
  const all = JSON.stringify(conn().prepare('SELECT * FROM contest_audit').all()) +
              JSON.stringify(conn().prepare('SELECT * FROM contest_winners').all());
  assert.doesNotMatch(all, /@example\.com/, 'aucune adresse dans les tables du concours');
  assert.strictEqual(auditRows().at(-1).action, 'contact_viewed');
});

// ── Routes HTTP ───────────────────────────────────────────────────────────────

test('routes admin du concours (auth, aperçu, attribution, statut, coordonnées, journal)', async (t) => {
  const u = newUser('http.contest@example.com');
  const s = frozenSeason([[u, 15]]);
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, NODE_ENV: 'test', PORT, SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: process.env.DB_FILE,
      ADMIN_SECRET: ADMIN, SESSION_SECRET: crypto.randomBytes(16).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', d => { log += d; });
  server.stderr.on('data', d => { log += d; });
  const exited = new Promise(r => server.on('exit', r));
  t.after(async () => { server.kill('SIGTERM'); await exited; });
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

  assert.strictEqual((await call('GET', '/api/admin/contest', undefined, false)).status, 401);
  assert.strictEqual((await call('POST', `/api/admin/contest/seasons/${s.id}/attribute`, {}, false)).status, 401);

  let r = await call('GET', '/api/admin/contest');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.settings.realPrizesUnlocked, false);
  assert.ok(r.body.seasons.some(x => x.id === s.id && x.frozen));

  r = await call('PUT', '/api/admin/contest/settings', { lotsPerSeason: 99 });
  assert.strictEqual(r.status, 400);
  r = await call('GET', `/api/admin/contest/seasons/abc/preview`);
  assert.strictEqual(r.status, 400);
  r = await call('GET', `/api/admin/contest/seasons/999999/preview`);
  assert.strictEqual(r.status, 404);

  r = await call('GET', `/api/admin/contest/seasons/${s.id}/preview?mode=real`);
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.blockers.includes('real_prizes_locked'));
  r = await call('POST', `/api/admin/contest/seasons/${s.id}/attribute`, { mode: 'real' });
  assert.strictEqual(r.status, 409);

  r = await call('POST', `/api/admin/contest/seasons/${s.id}/attribute`, { mode: 'simulation' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const w = r.body.winners[0];
  assert.strictEqual(w.userId, u);
  r = await call('POST', `/api/admin/contest/seasons/${s.id}/attribute`, {});
  assert.strictEqual(r.status, 409);

  r = await call('POST', `/api/admin/contest/winners/${w.id}/status`, { status: 'contacted', note: 'message privé envoyé' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.winner.status, 'contacted');
  r = await call('POST', `/api/admin/contest/winners/${w.id}/status`, { status: 'confirmed' });
  assert.strictEqual(r.status, 409);

  r = await call('GET', '/api/admin/contest/winners?mode=simulation');
  assert.ok(r.body.winners.some(x => x.id === w.id));
  assert.doesNotMatch(JSON.stringify(r.body), /@example\.com/, 'liste des gagnants sans e-mail');

  r = await call('POST', `/api/admin/contest/winners/${w.id}/contact`, {});
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.email, 'http.contest@example.com');

  r = await call('GET', `/api/admin/contest/audit?winnerId=${w.id}`);
  assert.deepStrictEqual(r.body.events.map(e => e.action), ['contact_viewed', 'winner_status', 'winner_designated']);
  assert.doesNotMatch(JSON.stringify(r.body), /@example\.com/);

  r = await call('POST', `/api/admin/contest/seasons/${s.id}/exclusions`, { userId: u, reason: 'test' });
  assert.strictEqual(r.status, 200);
  r = await call('DELETE', `/api/admin/contest/seasons/${s.id}/exclusions/${u}`);
  assert.strictEqual(r.status, 200);

  assert.doesNotMatch(log, /@example\.com/, 'aucune adresse dans les journaux du serveur');
});
