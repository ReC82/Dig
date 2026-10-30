/**
 * Tests de la date de fin configurable de la saison active, ticket #44 :
 * - fuseau Europe/Brussels : conversion locale → UTC, heures d'été/hiver (sautées, ambiguës) ;
 * - bornes, confirmation explicite, concurrence (fin attendue), annulation, journal en ajout seul ;
 * - horloge simulée : clôture exceptionnelle un vendredi 16:00 Bruxelles → classement figé,
 *   points crédités une seule fois, une seule saison courte jusqu'au dimanche, puis reprise du
 *   calendrier hebdomadaire lundi sans double clôture ni crédit répété ; 0, 1 et plusieurs joueurs ;
 * - routes HTTP admin (serveur de test, port ≠ 3000, base temporaire hors server/data/).
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
const PORT  = process.env.DIG_TEST_PORT_SEASON_END || '3144';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-season-end-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const cal       = require('../server/seasonCalendar');
const db        = require('../server/db');
const seasons   = require('../server/seasons');
const standings = require('../server/standings');
const points    = require('../server/rewardPoints');
const seasonEnd = require('../server/seasonEnd');

db.initDb();
const conn = () => db.getDb();

const MIN = 60_000;
const at  = iso => new Date(iso);

let userSeq = 0;
function newUser() {
  return conn().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(`end_user_${++userSeq}`, 'x').lastInsertRowid;
}
function putRanking(seasonId, userId, depth, blocks) {
  conn().prepare(`
    INSERT INTO season_rankings (season_id, user_id, max_depth, reported_max_depth, manual_blocks,
                                 effective_manual_blocks, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)`).run(seasonId, userId, depth, depth, blocks, blocks);
}
const ledgerCount = () => conn().prepare('SELECT COUNT(*) AS n FROM reward_point_ledger').get().n;
const activeCount = () => conn().prepare("SELECT COUNT(*) AS n FROM seasons WHERE status = 'active'").get().n;
const status = fn => { try { fn(); return 200; } catch (err) { if (err.status) return err.status; throw err; } };

// ── Fuseau horaire ────────────────────────────────────────────────────────────

test('Europe/Brussels : conversion locale → UTC, heure d\'été/hiver', () => {
  assert.strictEqual(cal.localToUtc('2026-10-30T16:00').date.toISOString(), '2026-10-30T15:00:00.000Z');
  assert.strictEqual(cal.localToUtc('2026-07-01 16:00').date.toISOString(), '2026-07-01T14:00:00.000Z');
  assert.strictEqual(cal.localToUtc('2026-10-25T02:30').error, 'ambiguous', 'heure répétée (retour à l\'heure d\'hiver)');
  assert.strictEqual(cal.localToUtc('2026-03-29T02:30').error, 'nonexistent', 'heure sautée (heure d\'été)');
  assert.strictEqual(cal.localToUtc('2026-02-30T10:00').error, 'invalid');
  assert.strictEqual(cal.localToUtc('demain').error, 'invalid');
  assert.strictEqual(cal.fmtLocal(at('2026-10-30T15:00:00Z')), '2026-10-30 16:00:00 (UTC+1)');
  assert.strictEqual(cal.fmtLocal(at('2026-07-01T14:00:00Z')), '2026-07-01 16:00:00 (UTC+2)');
});

// ── Scénario complet, horloge simulée ─────────────────────────────────────────

test('fin exceptionnelle vendredi 16:00 Bruxelles : clôture unique, points une fois, saison courte puis calendrier', () => {
  const t0 = at('2026-10-30T13:00:00Z');                        // vendredi 14:00 Bruxelles
  points.applyOwnerDecision(at('2026-10-26T00:00:01Z'));         // crédit réel (#33) actif
  const s44 = seasons.checkAndRotateSeason(t0);
  assert.strictEqual(s44.name, 'Saison 44-2026');
  assert.strictEqual(s44.end_at, '2026-11-01 23:59:59');
  const [a, b, c] = [newUser(), newUser(), newUser()];
  putRanking(s44.id, a, 50, 500);
  putRanking(s44.id, b, 30, 300);
  putRanking(s44.id, c, 10, 100);

  const end = seasonEnd.parseRequestedEnd({ end_local: '2026-10-30T16:00' });
  assert.strictEqual(cal.fmtUtc(end), '2026-10-30 15:00:00');

  // Bornes : passé, trop proche, trop loin, inchangé
  assert.strictEqual(status(() => seasonEnd.preview(s44.id, at('2026-10-30T12:00:00Z'), t0)), 400, 'rétroactif refusé');
  assert.strictEqual(status(() => seasonEnd.preview(s44.id, at('2026-10-30T13:05:00Z'), t0)), 400, 'moins de 10 min refusé');
  assert.strictEqual(status(() => seasonEnd.preview(s44.id, at('2026-11-09T00:00:00Z'), t0)), 400, '> fin + 7 j refusé');
  assert.strictEqual(status(() => seasonEnd.preview(s44.id, at('2026-11-01T23:59:59Z'), t0)), 400, 'déjà cette date');
  assert.strictEqual(status(() => seasonEnd.preview(s44.id + 99, end, t0)), 409, 'mauvaise saison');

  const p = seasonEnd.preview(s44.id, end, t0);
  assert.strictEqual(p.newEnd.local, '2026-10-30 16:00:00 (UTC+1)');
  assert.strictEqual(p.points.liveCredit, true);
  assert.strictEqual(p.nextSeason.start.utc, '2026-10-30 15:00:01');
  assert.strictEqual(p.nextSeason.end.utc, '2026-11-01 23:59:59', 'saison courte jusqu\'au dimanche');
  assert.strictEqual(p.activePlayers, 3);
  assert.strictEqual(db.getSeasonById(s44.id).end_at, '2026-11-01 23:59:59', 'aperçu sans écriture');

  // Confirmation et concurrence
  assert.strictEqual(status(() => seasonEnd.setEnd(s44.id, end, { confirm: 'oui', expectedEndAt: p.expectedEndAt, now: t0 })), 400);
  assert.strictEqual(status(() => seasonEnd.setEnd(s44.id, end, { confirm: s44.name, expectedEndAt: '2026-11-02 00:00:00', now: t0 })), 409);
  assert.strictEqual(status(() => seasonEnd.setEnd(s44.id, end, { confirm: s44.name, now: t0 })), 409);

  // Programmer, annuler, reprogrammer
  let st = seasonEnd.setEnd(s44.id, at('2026-10-30T16:00:00Z'), { confirm: s44.name, expectedEndAt: p.expectedEndAt, reason: 'essai', now: t0 });
  assert.strictEqual(st.season.endAt.utc, '2026-10-30 16:00:00');
  assert.strictEqual(st.exceptional, true);
  st = seasonEnd.cancel(s44.id, { expectedEndAt: st.expectedEndAt, now: t0 });
  assert.strictEqual(st.season.endAt.utc, '2026-11-01 23:59:59', 'retour à la fin hebdomadaire');
  assert.strictEqual(st.exceptional, false);
  assert.strictEqual(status(() => seasonEnd.cancel(s44.id, { now: t0 })), 409, 'rien à annuler');
  st = seasonEnd.setEnd(s44.id, end, { confirm: s44.name, expectedEndAt: st.expectedEndAt, reason: 'clôture exceptionnelle', now: t0 });
  assert.strictEqual(st.history.length, 3);
  assert.strictEqual(st.weeklyEnd.utc, '2026-11-01 23:59:59');
  assert.strictEqual(status(() => seasonEnd.cancel(s44.id, { now: at('2026-10-30T14:59:00Z') })), 409, 'annulation verrouillée près de l\'échéance');

  // Journal en ajout seul
  assert.throws(() => conn().prepare('UPDATE season_end_changes SET reason = NULL').run(), /ajout seul/);
  assert.throws(() => conn().prepare('DELETE FROM season_end_changes').run(), /ajout seul/);

  // Une seconde avant : rien ne se passe
  assert.strictEqual(seasons.checkAndRotateSeason(at('2026-10-30T14:59:59Z')).id, s44.id);

  // Échéance : un seul passage clôt, les suivants (collision de jobs, relance) sont sans effet
  const tick = now => { seasons.checkAndRotateSeason(now); standings.freezeMissingSnapshots(now); points.awardMissingSeasons(now); };
  const before = ledgerCount();
  tick(at('2026-10-30T15:00:30Z'));
  const closed = db.getSeasonById(s44.id);
  assert.strictEqual(closed.status, 'closed');
  assert.strictEqual(closed.end_at, '2026-10-30 15:00:00');
  assert.ok(standings.getSnapshot(s44.id), 'classement figé');
  assert.strictEqual(ledgerCount() - before, 3, 'trois crédits réels');
  const wallets = [a, b, c].map(u => points.getWallet(u).balance);
  assert.ok(wallets[0] >= wallets[1] && wallets[1] >= wallets[2] && wallets[2] > 0, `soldes ${wallets}`);
  for (let i = 0; i < 3; i++) tick(at('2026-10-30T15:01:30Z'));
  assert.strictEqual(ledgerCount() - before, 3, 'aucun crédit répété');
  assert.strictEqual(activeCount(), 1);

  const short = db.getActiveSeason();
  assert.strictEqual(short.start_at, '2026-10-30 15:00:01');
  assert.strictEqual(short.end_at, '2026-11-01 23:59:59');
  assert.strictEqual(short.name, 'Saison 44-2026 · 2');
  assert.strictEqual(status(() => seasonEnd.preview(s44.id, at('2026-10-31T12:00:00Z'), at('2026-10-30T15:02:00Z'))), 409, 'saison close : plus modifiable');
  assert.strictEqual(seasonEnd.state(at('2026-10-30T15:02:00Z')).exceptional, false, 'nouvelle saison : fin hebdomadaire');

  // Saison courte : un joueur ; lundi, reprise hebdomadaire, une seule clôture
  const d = newUser();
  putRanking(short.id, d, 5, 20);
  const beforeMonday = ledgerCount();
  tick(at('2026-11-02T00:00:30Z'));
  tick(at('2026-11-02T00:01:30Z'));
  assert.strictEqual(db.getSeasonById(short.id).status, 'closed');
  assert.strictEqual(ledgerCount() - beforeMonday, 1, 'un seul crédit pour la saison courte');
  const s45 = db.getActiveSeason();
  assert.strictEqual(s45.name, 'Saison 45-2026');
  assert.strictEqual(s45.start_at, '2026-11-02 00:00:00');
  assert.strictEqual(s45.end_at, '2026-11-08 23:59:59');

  // Saison sans joueur : clôture sans crédit, sans erreur
  const beforeEmpty = ledgerCount();
  tick(at('2026-11-09T00:00:30Z'));
  assert.strictEqual(db.getSeasonById(s45.id).status, 'closed');
  assert.strictEqual(ledgerCount(), beforeEmpty);

  const list = conn().prepare('SELECT * FROM seasons ORDER BY start_at, id').all();
  for (let i = 1; i < list.length; i++) {
    assert.strictEqual(cal.parseUtc(list[i].start_at) - cal.parseUtc(list[i - 1].end_at), 1000, 'saisons contiguës');
  }
  assert.strictEqual(points.verifyLedger().ok, true);
});

test('saison programmée : la nouvelle fin doit la précéder', () => {
  const now = at('2026-11-10T10:00:00Z');
  const active = seasons.checkAndRotateSeason(now);
  db.createSeason('Programmée', '2026-11-12 00:00:00', '2026-11-15 23:59:59', 'scheduled');
  assert.strictEqual(status(() => seasonEnd.preview(active.id, at('2026-11-12T12:00:00Z'), now)), 409);
  assert.strictEqual(seasonEnd.preview(active.id, at('2026-11-11T12:00:00Z'), now).nextSeason.end.utc, '2026-11-11 23:59:59');
});

// ── Routes HTTP ───────────────────────────────────────────────────────────────

test('routes admin : droits, aperçu, confirmation, annulation, route générique bloquée', async (t) => {
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: path.join(dir, 'http.sqlite'),
      ADMIN_SECRET: ADMIN, SESSION_SECRET: crypto.randomBytes(16).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', x => { log += x; });
  server.stderr.on('data', x => { log += x; });
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

  assert.strictEqual((await call('GET', '/api/admin/seasons/active/end', undefined, false)).status, 401);
  assert.strictEqual((await call('PUT', '/api/admin/seasons/active/end', {}, false)).status, 401);
  let r = await call('GET', '/api/admin/seasons/active/end');
  assert.strictEqual(r.status, 200);
  const st = r.body;
  assert.strictEqual(st.timeZone, 'Europe/Brussels');
  assert.match(st.season.endAt.local, /\(UTC[+-]\d/);

  // Route générique : fin de la saison active refusée
  r = await call('PUT', `/api/admin/seasons/${st.season.id}`, { end_at: '2030-01-01 00:00:00' });
  assert.strictEqual(r.status, 409);

  const weekly = cal.parseUtc(st.season.endAt.utc).getTime();
  const target = Math.max(Date.now() + 30 * MIN, cal.parseUtc(st.season.startAt.utc).getTime() + 2 * 60 * MIN);
  if (target < weekly - MIN) {
    const endAt = cal.fmtUtc(new Date(Math.floor(target / MIN) * MIN));
    assert.strictEqual((await call('POST', '/api/admin/seasons/active/end/preview', { end_local: 'n/a' })).status, 400);
    r = await call('POST', '/api/admin/seasons/active/end/preview', { seasonId: st.season.id, end_at: endAt });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.consequences.length >= 4);
    r = await call('PUT', '/api/admin/seasons/active/end', { seasonId: st.season.id, end_at: endAt, expectedEndAt: st.expectedEndAt, confirm: 'x' });
    assert.strictEqual(r.status, 400);
    r = await call('PUT', '/api/admin/seasons/active/end', { seasonId: st.season.id, end_at: endAt, expectedEndAt: st.expectedEndAt, confirm: st.season.name, reason: 'test' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.season.endAt.utc, endAt);
    const cur = (await (await fetch(`${BASE}/api/seasons/current`)).json()).season;
    assert.strictEqual(cur.endAt, endAt, 'joueurs : nouvelle date de fin');
    r = await call('PUT', '/api/admin/seasons/active/end', { seasonId: st.season.id, end_at: endAt, expectedEndAt: st.expectedEndAt, confirm: st.season.name });
    assert.strictEqual(r.status, 400, 'même date');
    r = await call('DELETE', '/api/admin/seasons/active/end', { seasonId: st.season.id, expectedEndAt: st.expectedEndAt });
    assert.strictEqual(r.status, 409, 'fin attendue périmée');
    r = await call('DELETE', '/api/admin/seasons/active/end', { seasonId: st.season.id, expectedEndAt: endAt });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.season.endAt.utc, st.season.endAt.utc);
    assert.strictEqual(r.body.history.length, 2);
  }
});

test('outil en ligne de commande : état, aperçu sans écriture, confirmation obligatoire, annulation', () => {
  const { execFileSync } = require('child_process');
  const env = { ...process.env, DB_FILE: path.join(dir, 'cli.sqlite') };
  const run = (...a) => {
    try { return { code: 0, out: execFileSync(process.execPath, ['scripts/season-end.js', ...a], { cwd: ROOT, env, encoding: 'utf8', stdio: 'pipe' }) }; }
    catch (err) { return { code: err.status, out: String(err.stdout) + String(err.stderr) }; }
  };
  const st = JSON.parse(run().out);
  assert.ok(st.season?.name);
  const target = new Date(Math.max(Date.now() + 30 * MIN, cal.parseUtc(st.season.startAt.utc).getTime() + 2 * 60 * MIN));
  if (target.getTime() >= cal.parseUtc(st.season.endAt.utc).getTime() - MIN) return;
  const local = cal.fmtLocal(target).slice(0, 16).replace(' ', 'T');
  let r = run('--at', local);
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(JSON.parse(run().out).expectedEndAt, st.expectedEndAt, 'aperçu sans écriture');
  r = run('--at', local, '--apply', '--confirm', 'mauvais');
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /Confirmation requise/);
  r = run('--at', local, '--apply', '--confirm', st.season.name, '--reason', 'test CLI');
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(JSON.parse(r.out).exceptional, true);
  r = run('--cancel', '--apply');
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(JSON.parse(r.out).season.endAt.utc, st.season.endAt.utc);
});

test.after(() => {
  seasons.stopSeasonScheduler();
  try { db.getDb().close(); } catch (_) {}
  fs.rmSync(dir, { recursive: true, force: true });
});
