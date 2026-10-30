/**
 * Tests de l'anti-autoclic serveur (processAntiCheat) et de la route de sauvegarde, ticket #10.
 * Base temporaire hors server/data/, serveur de test sur un port ≠ 3000.
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

const ROOT = path.join(__dirname, '..');
const PORT = process.env.DIG_TEST_PORT_ANTICHEAT || '3109';
const BASE = `http://127.0.0.1:${PORT}`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-anticheat-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db      = require('../server/db');
const seasons = require('../server/seasons');

const CONFIG = { max_effective_cps: '8', anti_autoclick_enabled: 'true' };
let seasonId;
let userSeq = 0;

function newUser() {
  const name = `ac_user_${++userSeq}`;
  return db.getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(name, 'x').lastInsertRowid;
}

/** Joue une suite de sauvegardes { t (s), clicks, blocks } ; retourne les résultats. */
function play(userId, steps, config = CONFIG) {
  const t0 = Date.UTC(2026, 9, 29, 12, 0, 0);
  return steps.map(s => seasons.processAntiCheat(
    userId, seasonId, { manualClicks: s.clicks, manualBlocks: s.blocks, regularityScore: 0.5 },
    config, 'tester', t0 + s.t * 1000,
  ));
}

const logs = userId => db.getDb().prepare('SELECT * FROM anticheat_logs WHERE user_id = ? ORDER BY id').all(userId);

test.before(() => {
  db.initDb();
  seasonId = db.createSeason('Test', '2026-10-26 00:00:00', '2026-11-01 23:59:59', 'closed').id; // la saison active est celle du seed (#16)
});

test.after(() => {
  db.getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('jeu normal (5 CPS, sauvegardes toutes les 12 s) : tout est accepté, aucun log', () => {
  const u = newUser();
  const r = play(u, [
    { t: 0,  clicks: 0,   blocks: 0 },
    { t: 12, clicks: 60,  blocks: 20 },
    { t: 24, clicks: 120, blocks: 40 },
  ]);
  assert.deepStrictEqual(r.map(x => x.action), ['init', 'none', 'none']);
  assert.strictEqual(r[2].effectiveManualBlocks, 40);
  assert.strictEqual(logs(u).length, 0);
});

test('sauvegarde à chaque clic à 20 CPS : les clics sont cumulés et le CPS est détecté', () => {
  const u = newUser();
  const steps = [{ t: 0, clicks: 0, blocks: 0 }];
  // 20 CPS pendant 6 s, une sauvegarde par clic (comportement du client avant #10)
  for (let i = 1; i <= 120; i++) steps.push({ t: i * 0.05, clicks: i, blocks: Math.floor(i / 2) });
  const r = play(u, steps);
  assert.ok(r.some(x => x.action === 'pending'), 'les sauvegardes < 3 s doivent être cumulées');
  assert.ok(r.some(x => x.action === 'reduced' || x.action === 'flagged'), JSON.stringify(r.slice(-3)));
  const l = logs(u);
  assert.ok(l.length >= 1);
  assert.ok(l[0].inferred_cps > 8, `CPS loggé ${l[0].inferred_cps}`);
  assert.ok(r.at(-1).effectiveManualBlocks < 60, `blocs acceptés ${r.at(-1).effectiveManualBlocks}`);
});

test('Δclics = 0 avec Δblocs > 0 : blocs refusés et journalisés', () => {
  const u = newUser();
  const r = play(u, [
    { t: 0,  clicks: 100, blocks: 30 },
    { t: 10, clicks: 100, blocks: 500 },
  ]);
  assert.strictEqual(r[1].action, 'rejected');
  assert.strictEqual(r[1].effectiveManualBlocks, 30);
  assert.strictEqual(logs(u)[0].action_taken, 'rejected');
  assert.strictEqual(logs(u)[0].effective_ratio, 0);
});

test('plus de blocs que de clics : excédent refusé', () => {
  const u = newUser();
  const r = play(u, [
    { t: 0,  clicks: 0,  blocks: 0 },
    { t: 10, clicks: 10, blocks: 50 },
  ]);
  assert.strictEqual(r[1].effectiveManualBlocks, 10);
  assert.strictEqual(r[1].action, 'rejected');
});

test('première sauvegarde de saison : blocs plafonnés au nombre de clics', () => {
  const u = newUser();
  const [r] = play(u, [{ t: 0, clicks: 5, blocks: 999 }]);
  assert.strictEqual(r.action, 'init');
  assert.strictEqual(r.effectiveManualBlocks, 5);
});

test('une longue absence ne dilue pas une rafale (fenêtre plafonnée à 120 s)', () => {
  const u = newUser();
  const r = play(u, [
    { t: 0,     clicks: 0,    blocks: 0 },
    { t: 36000, clicks: 6000, blocks: 3000 }, // 10 h plus tard, 6000 clics d'un coup
  ]);
  assert.strictEqual(r[1].action, 'flagged');
  // 6000 clics / 120 s = 50 CPS → ratio 8/50 → 480 blocs sur 3000 (et non 3000 dilués sur 10 h)
  assert.strictEqual(r[1].effectiveManualBlocks, 480);
});

test('inactivité puis jeu normal : pas de faux positif', () => {
  const u = newUser();
  const r = play(u, [
    { t: 0,   clicks: 0,  blocks: 0 },
    { t: 600, clicks: 0,  blocks: 0 },   // 10 min sans clic : la référence avance
    { t: 612, clicks: 60, blocks: 20 },  // 5 CPS
  ]);
  assert.deepStrictEqual(r.map(x => x.action), ['init', 'none', 'none']);
  assert.strictEqual(r[2].effectiveManualBlocks, 20);
});

test('anti-autoclic désactivé : blocs acceptés sans contrôle', () => {
  const u = newUser();
  const r = play(u, [
    { t: 0, clicks: 0,   blocks: 0 },
    { t: 1, clicks: 500, blocks: 200 },
  ], { ...CONFIG, anti_autoclick_enabled: 'false' });
  assert.strictEqual(r[1].effectiveManualBlocks, 200);
  assert.strictEqual(logs(u).length, 0);
});

// ── Recette #10 (30/10) : cadences déterministes, horloge injectée ───────────────────────

/**
 * Simule `secs` secondes de clics à `cps` (un bloc tous les `clicksPerBlock` clics), avec une
 * sauvegarde toutes les `every` s. Retourne { r, total } (total = blocs effectivement acceptés).
 */
function simulate(cps, { secs = 120, every = 12, clicksPerBlock = 3, config = CONFIG } = {}) {
  const u = newUser();
  const steps = [{ t: 0, clicks: 0, blocks: 0 }];
  for (let t = every; t <= secs + 1e-9; t += every) {
    const clicks = Math.round(cps * t);
    steps.push({ t, clicks, blocks: Math.floor(clicks / clicksPerBlock) });
  }
  const r = play(u, steps, config);
  return { u, r, steps, total: r.at(-1).effectiveManualBlocks };
}

for (const cps of [1, 3, 5, 6.5, 8]) {
  test(`clics légitimes à ${cps} CPS pendant 2 min : 100 % des blocs acceptés, aucun log`, () => {
    const { u, r, steps, total } = simulate(cps);
    assert.ok(r.slice(1).every(x => x.action === 'none'), JSON.stringify(r.map(x => x.action)));
    assert.strictEqual(total, steps.at(-1).blocks);
    assert.strictEqual(logs(u).length, 0);
  });
}

test('rafale humaine (8 CPS pendant 10 s, pause, reprise) avec sauvegarde à chaque clic : rien n\'est refusé', () => {
  const u = newUser();
  const steps = [{ t: 0, clicks: 0, blocks: 0 }];
  let clicks = 0;
  for (const [start, dur] of [[0, 10], [25, 10], [50, 10]]) {
    for (let i = 1; i <= 8 * dur; i++) {
      clicks++;
      steps.push({ t: start + i / 8, clicks, blocks: Math.floor(clicks / 2) });
    }
  }
  steps.push({ t: 75, clicks, blocks: Math.floor(clicks / 2) }); // sauvegarde finale (sortie d'onglet)
  const r = play(u, steps);
  assert.strictEqual(r.at(-1).effectiveManualBlocks, Math.floor(clicks / 2));
  assert.strictEqual(logs(u).length, 0);
});

for (const cps of [12, 20, 50, 100, 1000]) {
  test(`autoclic à ${cps} CPS pendant 2 min : blocs plafonnés à max_effective_cps × durée et journalisés`, () => {
    const { u, r, total } = simulate(cps, { clicksPerBlock: 1 });
    assert.ok(total <= 8 * 120, `${total} blocs acceptés en 120 s (max 960)`);
    assert.ok(total > 0, 'jamais bloqué totalement');
    assert.ok(r.slice(1).every(x => x.action === 'reduced' || x.action === 'flagged'), JSON.stringify(r.map(x => x.action)));
    assert.strictEqual(logs(u).length, 10);
  });
}

test('autoclic avec sauvegardes rapprochées (toutes les 0,5 s) : même plafond, pas de contournement', () => {
  const { total, r } = simulate(50, { every: 0.5, clicksPerBlock: 1 });
  assert.ok(r.some(x => x.action === 'pending'));
  assert.ok(total <= 8 * 120, `${total} blocs acceptés en 120 s`);
});

test('autoclic avec sauvegardes espacées (toutes les 10 min) : plafond de la fenêtre de 120 s', () => {
  const { total } = simulate(30, { secs: 3600, every: 600, clicksPerBlock: 1 });
  assert.ok(total <= 6 * 8 * 120, `${total} blocs acceptés`);
});

// ── Route HTTP : sauvegarde finale envoyée par sendBeacon (Blob application/json) ──────────

test('POST /api/me/save accepte le corps d\'un sendBeacon et ne journalise plus chaque sauvegarde', async () => {
  const httpDb = path.join(dir, 'http.sqlite');
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: httpDb, ADMIN_SECRET: crypto.randomBytes(16).toString('hex'), SESSION_SECRET: crypto.randomBytes(16).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', d => { log += d; });
  server.stderr.on('data', d => { log += d; });
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      try { await fetch(`${BASE}/api/version`); up = true; } catch (_) { await new Promise(r => setTimeout(r, 100)); }
    }
    assert.ok(up, log);

    const reg = await fetch(`${BASE}/api/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'beacon', email: 'beacon@example.invalid', password: 'secret123' }),
    });
    assert.strictEqual(reg.status, 200);
    const cookie = reg.headers.get('set-cookie').split(';')[0];
    const season = (await (await fetch(`${BASE}/api/seasons/current`)).json()).season;
    assert.ok(season?.id, 'saison active attendue');

    const before = log.length;
    for (const [clicks, blocks] of [[10, 3], [20, 6], [30, 9]]) {
      // Même requête que navigator.sendBeacon(url, new Blob([json], { type: 'application/json' }))
      const body = new Blob([JSON.stringify({ data: { lastSaveTime: Date.now(), coins: 1, seasonStats: { seasonId: season.id, maxDepth: 5, manualBlocks: blocks, autoBlocks: 0, manualClicks: clicks } } })], { type: 'application/json' });
      const r = await fetch(`${BASE}/api/me/save`, { method: 'POST', headers: { Cookie: cookie }, body });
      assert.strictEqual(r.status, 200);
    }
    await new Promise(r => setTimeout(r, 200));
    assert.doesNotMatch(log.slice(before), /recordManualBreaks|getOrCreateSeasonStats|recordAutoBreaks/);

    const check = new Database(httpDb, { readonly: true });
    const row = check.prepare('SELECT data, version FROM user_saves').get();
    check.close();
    assert.strictEqual(row.version, 3);
    assert.strictEqual(JSON.parse(row.data).seasonStats.manualClicks, 30);
  } finally {
    server.kill();
  }
});
