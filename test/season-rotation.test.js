/**
 * Tests de la rotation continue des saisons, ticket #16.
 * - calendrier : semaines ISO, dates normalisées ;
 * - rotation planifiée sur 3 semaines avec horloge simulée (mock timers) : saisons contiguës,
 *   une seule active, aucun score hors période ;
 * - routes admin HTTP (serveur de test, port ≠ 3000, base temporaire hors server/data/).
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
const PORT  = process.env.DIG_TEST_PORT_SEASONS || '3116';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-seasons-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const cal     = require('../server/seasonCalendar');
const db      = require('../server/db');
const seasons = require('../server/seasons');

const MIN  = 60_000;
const HOUR = 60 * MIN;
const DAY  = 24 * HOUR;
// Mercredi 4 novembre 2026, 10:00 UTC (semaine ISO 45)
const T0   = Date.UTC(2026, 10, 4, 10, 0, 0);

const allSeasons = () => db.getDb().prepare('SELECT * FROM seasons ORDER BY start_at, id').all();
const ranking    = (seasonId, userId) => db.getDb()
  .prepare('SELECT * FROM season_rankings WHERE season_id = ? AND user_id = ?').get(seasonId, userId);

let userSeq = 0;
function newUser() {
  return db.getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(`season_user_${++userSeq}`, 'x').lastInsertRowid;
}

/** Sauvegarde de jeu plausible pour la saison donnée. */
function stats(seasonId, n) {
  return { seasonId, maxDepth: 1 + n, manualBlocks: n, autoBlocks: 0, manualClicks: n * 3, regularityScore: 0.2 };
}

/** Vérifie la contiguïté : chaque saison commence 1 s après la fin de la précédente. */
function assertContiguous(list) {
  for (let i = 1; i < list.length; i++) {
    const prevEnd = cal.parseUtc(list[i - 1].end_at).getTime();
    const start   = cal.parseUtc(list[i].start_at).getTime();
    assert.strictEqual(start - prevEnd, 1000, `trou/chevauchement entre ${list[i - 1].name} et ${list[i].name}`);
  }
}

// ── Calendrier ────────────────────────────────────────────────────────────────

test('semaines ISO 8601 (y compris changements d\'année)', () => {
  const w = (y, m, d) => cal.isoWeek(new Date(Date.UTC(y, m - 1, d)));
  assert.deepStrictEqual(w(2026, 1, 1),   { year: 2026, week: 1 });   // jeudi
  assert.deepStrictEqual(w(2026, 6, 22),  { year: 2026, week: 26 });  // audit B11 : « Saison 4-2026 »
  assert.deepStrictEqual(w(2026, 10, 26), { year: 2026, week: 44 });
  assert.deepStrictEqual(w(2026, 12, 28), { year: 2026, week: 53 });
  assert.deepStrictEqual(w(2027, 1, 3),   { year: 2026, week: 53 });  // dimanche, encore 2026-W53
  assert.deepStrictEqual(w(2027, 1, 4),   { year: 2027, week: 1 });
  assert.deepStrictEqual(w(2024, 12, 30), { year: 2025, week: 1 });   // lundi, déjà 2025-W01
  assert.strictEqual(cal.seasonName(new Date(Date.UTC(2026, 10, 2))), 'Saison 45-2026');
});

test('dates : lecture et normalisation UTC, dates invalides refusées', () => {
  assert.strictEqual(cal.normalizeDate('2026-11-01 23:59:59'),   '2026-11-01 23:59:59');
  assert.strictEqual(cal.normalizeDate('2026-11-01T23:59:59Z'),  '2026-11-01 23:59:59');   // audit B11 : « Z »
  assert.strictEqual(cal.normalizeDate('2026-11-01T23:59:59.000Z'), '2026-11-01 23:59:59');
  assert.strictEqual(cal.normalizeDate('2026-11-02T01:00+01:00'), '2026-11-02 00:00:00');
  assert.strictEqual(cal.normalizeDate('2026-11-02'),            '2026-11-02 00:00:00');
  for (const bad of ['', 'demain', '2026-02-31 00:00:00', '2026-11-01 25:00:00', null, 42]) {
    assert.strictEqual(cal.normalizeDate(bad), null, String(bad));
  }
  const b = cal.weekBounds(new Date(T0));
  assert.strictEqual(cal.fmtUtc(b.start), '2026-11-02 00:00:00');
  assert.strictEqual(cal.fmtUtc(b.end),   '2026-11-08 23:59:59');
});

// ── Rotation planifiée, horloge simulée ───────────────────────────────────────

test('rotation planifiée sur 3 semaines : saisons contiguës, une seule active, aucun score hors période', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 });
  db.initDb();

  const first = db.getActiveSeason();
  assert.strictEqual(first.name, 'Saison 45-2026');
  assert.strictEqual(first.start_at, '2026-11-02 00:00:00');
  assert.strictEqual(first.end_at,   '2026-11-08 23:59:59');

  seasons.startSeasonScheduler();
  const u = newUser();
  const expectedRows = [];

  // Avance minute par minute ; joue une sauvegarde chaque jour à 12:00 UTC
  const end = T0 + 21 * DAY;
  let maxLagMs = 0;
  while (Date.now() < end) {
    t.mock.timers.tick(MIN);
    const now    = Date.now();
    const active = db.getActiveSeason();
    // Invariant permanent : exactement une saison active, qui contient l'instant présent
    assert.strictEqual(db.getDb().prepare("SELECT COUNT(*) AS n FROM seasons WHERE status='active'").get().n, 1);
    if (!seasons.isWithinSeason(active, now)) {
      maxLagMs = Math.max(maxLagMs, now - cal.parseUtc(active.end_at).getTime());
    }
    if (new Date(now).getUTCHours() === 12 && new Date(now).getUTCMinutes() === 0) {
      const day = Math.round((now - T0) / DAY);
      seasons.syncPlayerRanking(u, stats(active.id, 10 + day));
      expectedRows.push(active.id);
    }
  }
  seasons.stopSeasonScheduler();
  assert.strictEqual(maxLagMs, 0, 'la rotation (chaque minute) doit suivre la fin de saison');

  const list = allSeasons();
  assert.deepStrictEqual(list.map(s => s.name), ['Saison 45-2026', 'Saison 46-2026', 'Saison 47-2026', 'Saison 48-2026']);
  assert.deepStrictEqual(list.map(s => s.status), ['closed', 'closed', 'closed', 'active']);
  assertContiguous(list);
  assert.strictEqual(list[1].start_at, '2026-11-09 00:00:00');
  assert.strictEqual(list[3].end_at,   '2026-11-29 23:59:59');
  for (const s of list.slice(0, 3)) {
    const lag = cal.parseUtc(s.closed_at) - cal.parseUtc(s.end_at);
    assert.ok(lag > 0 && lag <= MIN, `${s.name} clôturée ${lag} ms après sa fin`);
    assert.strictEqual(JSON.parse(s.config).promotionApplied, true);
  }

  // Chaque saison n'a compté que ses propres sauvegardes, toutes faites dans sa période
  for (const s of list.slice(0, 3)) {
    const row = ranking(s.id, u);
    assert.ok(row && row.is_active === 1, `score attendu pour ${s.name}`);
  }
  assert.ok(new Set(expectedRows).size === 4, 'des sauvegardes dans chacune des 4 saisons');

  // Une sauvegarde portant l'ancienne saison après rotation est ignorée
  const old = list[2];
  const before = ranking(old.id, u);
  seasons.syncPlayerRanking(u, stats(old.id, 999));
  assert.deepStrictEqual(ranking(old.id, u), before);
});

test('aucun score avant start_at (saison active dont le début est futur — état B7)', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 + 22 * DAY });
  const active = db.getActiveSeason();
  const saved  = { start_at: active.start_at };
  db.updateSeason(active.id, { start_at: '2026-12-31 00:00:00' });
  try {
    const u = newUser();
    seasons.syncPlayerRanking(u, stats(active.id, 5));
    assert.strictEqual(ranking(active.id, u), undefined);
  } finally {
    db.updateSeason(active.id, saved);
  }
  const u2 = newUser();
  seasons.syncPlayerRanking(u2, stats(active.id, 5));
  assert.strictEqual(ranking(active.id, u2).is_active, 1);
});

test('aucun score après end_at, même avant le passage du planificateur', (t) => {
  const active = db.getActiveSeason();
  t.mock.timers.enable({ apis: ['Date'], now: cal.parseUtc(active.end_at).getTime() + 30_000 });
  const u = newUser();
  seasons.syncPlayerRanking(u, stats(active.id, 5));
  assert.strictEqual(ranking(active.id, u), undefined);
  assert.strictEqual(db.getActiveSeason().id, active.id, 'pas de rotation implicite dans syncPlayerRanking');
});

test('serveur arrêté 3 semaines : rattrapage semaine par semaine, sans trou', (t) => {
  const lastEnd = cal.parseUtc(db.getActiveSeason().end_at).getTime();
  t.mock.timers.enable({ apis: ['Date'], now: lastEnd + 2 * 7 * DAY + 3 * DAY });
  const active = seasons.checkAndRotateSeason(new Date());
  const list   = allSeasons();
  assert.deepStrictEqual(list.slice(-4).map(s => s.name), ['Saison 48-2026', 'Saison 49-2026', 'Saison 50-2026', 'Saison 51-2026']);
  assert.strictEqual(active.name, 'Saison 51-2026');
  assert.ok(seasons.isWithinSeason(active, Date.now()));
  assertContiguous(list);
  // Idempotent
  assert.strictEqual(seasons.checkAndRotateSeason(new Date()).id, active.id);
  assert.strictEqual(allSeasons().length, list.length);
});

test('clôture anticipée (admin) : fin ramenée à l\'instant de clôture, suite immédiate et nom unique', (t) => {
  const active = db.getActiveSeason();
  const now    = cal.parseUtc(active.start_at).getTime() + 2 * DAY + 5 * HOUR;
  t.mock.timers.enable({ apis: ['Date'], now });
  const { closedSeason, newSeason } = seasons.closeActiveSeason(active.id, new Date());
  assert.strictEqual(closedSeason.end_at, cal.fmtUtc(new Date(now - 1000)));
  assert.strictEqual(JSON.parse(closedSeason.config).plannedEndAt, active.end_at);
  assert.strictEqual(newSeason.start_at, cal.fmtUtc(new Date(now)));
  assert.ok(seasons.isWithinSeason(newSeason, now), 'la suivante compte immédiatement');
  assert.strictEqual(newSeason.end_at, active.end_at);
  assert.strictEqual(newSeason.name, `${active.name} · 2`);
  assertContiguous(allSeasons());
});

test('saison programmée : la rotation s\'arrête juste avant elle puis l\'active à sa date', (t) => {
  const active = db.getActiveSeason();
  const end    = cal.parseUtc(active.end_at).getTime();
  const sched  = db.createSeason('Saison spéciale', cal.fmtUtc(new Date(end + 3 * DAY + 1000)),
    cal.fmtUtc(new Date(end + 10 * DAY)), 'scheduled');

  t.mock.timers.enable({ apis: ['Date'], now: end + 1000 });
  const filler = seasons.checkAndRotateSeason(new Date());
  assert.strictEqual(filler.end_at, cal.fmtUtc(new Date(end + 3 * DAY)));

  t.mock.timers.setTime(end + 3 * DAY + 2000);
  const now = seasons.checkAndRotateSeason(new Date());
  assert.strictEqual(now.id, sched.id);
  assert.strictEqual(now.status, 'active');
  assertContiguous(allSeasons().filter(s => s.status !== 'scheduled'));
});

test('base : une seconde saison active est refusée (index unique)', () => {
  assert.throws(() => db.createSeason('Doublon', '2027-01-01 00:00:00', '2027-01-07 23:59:59'),
    e => e.code === 'SQLITE_CONSTRAINT_UNIQUE');
  assert.strictEqual(db.getDb().prepare("SELECT COUNT(*) AS n FROM seasons WHERE status='active'").get().n, 1);
});

test('end_at illisible : pas de clôture « par erreur »', () => {
  const active = db.getActiveSeason();
  db.updateSeason(active.id, { end_at: 'n/a' });
  try {
    assert.strictEqual(seasons.checkAndRotateSeason(new Date()).id, active.id);
    assert.strictEqual(db.getSeasonById(active.id).status, 'active');
  } finally {
    db.updateSeason(active.id, { end_at: active.end_at });
  }
});

// ── Routes admin (serveur de test) ────────────────────────────────────────────

test('routes admin : dates normalisées, statut programmé, une seule saison active', async (t) => {
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

  const call = async (method, url, body) => {
    const res = await fetch(BASE + url, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN}` },
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  const cur = (await (await fetch(`${BASE}/api/seasons/current`)).json()).season;
  assert.ok(seasons.isWithinSeason({ start_at: cur.startAt, end_at: cur.endAt }, Date.now()), 'saison courante en cours');
  assert.match(cur.name, /^Saison \d{1,2}-\d{4}$/);

  let r = await call('POST', '/api/admin/seasons', { name: 'X', start_at: 'demain', end_at: '2030-01-01' });
  assert.strictEqual(r.status, 400);
  r = await call('POST', '/api/admin/seasons', { name: 'X', start_at: '2020-01-01 00:00:00', end_at: '2030-01-01 00:00:00' });
  assert.strictEqual(r.status, 409, 'deuxième saison active refusée');
  r = await call('POST', '/api/admin/seasons', { name: 'Futur', start_at: '2030-01-07T00:00:00Z', end_at: '2030-01-13T23:59:59Z' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.season.status, 'scheduled');
  assert.strictEqual(r.body.season.start_at, '2030-01-07 00:00:00');
  const futureId = r.body.season.id;

  r = await call('PUT', `/api/admin/seasons/${futureId}`, { status: 'active' });
  assert.strictEqual(r.status, 409);
  r = await call('PUT', `/api/admin/seasons/${futureId}`, { status: 'bidon' });
  assert.strictEqual(r.status, 400);
  r = await call('PUT', `/api/admin/seasons/${futureId}`, { end_at: '2029-01-01 00:00:00' });
  assert.strictEqual(r.status, 400, 'fin avant début refusée');

  // Clôture manuelle (sans promotion) : fin ramenée à maintenant ; la saison suivante s'ouvre
  r = await call('PUT', `/api/admin/seasons/${cur.id}`, { status: 'closed' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.ok(cal.parseUtc(r.body.season.end_at).getTime() <= Date.now());
  const next = (await (await fetch(`${BASE}/api/seasons/current`)).json()).season;
  assert.notStrictEqual(next.id, cur.id);
  assert.strictEqual(cal.parseUtc(next.startAt) - cal.parseUtc(r.body.season.end_at), 1000);
});

test.after(() => {
  seasons.stopSeasonScheduler();
  try { db.getDb().close(); } catch (_) {}
  fs.rmSync(dir, { recursive: true, force: true });
});
