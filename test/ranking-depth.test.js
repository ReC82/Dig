/**
 * Tests de la validation serveur du classement (profondeur), ticket #9.
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
const PORT = process.env.DIG_TEST_PORT_RANKING || '3110';
const BASE = `http://127.0.0.1:${PORT}`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-ranking-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db      = require('../server/db');
const seasons = require('../server/seasons');

const CONFIG = { depth_validation_enabled: 'true', depth_max_cps: '20' };
const T0     = Date.UTC(2026, 9, 29, 12, 0, 0);
let seasonId;
let userSeq = 0;

function newUser() {
  const name = `depth_user_${++userSeq}`;
  return db.getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(name, 'x').lastInsertRowid;
}

/** Joue une suite de sauvegardes { t (s), clicks, auto, depth } ; retourne les résultats. */
function play(userId, steps, config = CONFIG) {
  return steps.map(s => seasons.validateDepth(
    userId, seasonId,
    { maxDepth: s.depth, manualClicks: s.clicks, autoBlocks: s.auto ?? 0, regularityScore: 0.2 },
    config, 'tester', T0 + s.t * 1000,
  ));
}

/** Jeu légitime : `cps` clics/s, un bloc tous les `clicksPerBlock` clics, autodig 1 bloc/`autoEvery` s. */
function legitSteps({ from = 0, saves, every = 12, cps = 5, clicksPerBlock = 3, autoEvery = 2, start = {} }) {
  const steps = [];
  for (let i = 0; i <= saves; i++) {
    const t      = from + i * every;
    const clicks = (start.clicks ?? 0) + Math.round((t - from) * cps);
    const auto   = (start.auto ?? 0) + Math.floor((t - from) / autoEvery);
    const blocks = (start.blocks ?? 0) + Math.floor((clicks - (start.clicks ?? 0)) / clicksPerBlock);
    steps.push({ t, clicks, auto, depth: 1 + blocks + auto });
  }
  return steps;
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

test('jeu normal (5 CPS + autodig, sauvegardes toutes les 12 s) : profondeur retenue = déclarée, aucun log', () => {
  const u = newUser();
  const steps = legitSteps({ saves: 30 });
  const r = play(u, steps);
  for (let i = 0; i < r.length; i++) assert.strictEqual(r[i].acceptedDepth, steps[i].depth, `sauvegarde ${i}`);
  assert.strictEqual(logs(u).length, 0);
});

test('jeu rapide (12 CPS, un bloc par clic, autodig au maximum) : pas de pénalité', () => {
  const u = newUser();
  const steps = legitSteps({ saves: 50, cps: 12, clicksPerBlock: 1, autoEvery: 1 });
  const r = play(u, steps);
  assert.strictEqual(r.at(-1).acceptedDepth, steps.at(-1).depth);
  assert.ok(r.every(x => x.action === 'none' || x.action === 'init'), JSON.stringify(r.filter(x => x.action !== 'none')));
  assert.strictEqual(logs(u).length, 0);
});

test('première sauvegarde avec de la progression : retenue partiellement puis rattrapée', () => {
  const u = newUser();
  const r = play(u, [
    { t: 0,  clicks: 30, auto: 0, depth: 11 },   // premier envoi : aucun jeton encore
    { t: 12, clicks: 90, auto: 0, depth: 31 },
  ]);
  assert.strictEqual(r[0].acceptedDepth, 1);
  assert.strictEqual(r[1].acceptedDepth, 31);
  assert.strictEqual(logs(u).length, 0);
});

test('sauvegardes perdues (60 s hors ligne à 8 CPS) : rattrapage sans perte ni rejet', () => {
  const u = newUser();
  const steps = [
    ...legitSteps({ saves: 2, cps: 8, clicksPerBlock: 1, autoEvery: 1 }),
  ];
  const last = steps.at(-1);
  // 60 s sans sauvegarde réussie, puis reprise normale
  steps.push(...legitSteps({ from: last.t + 60, saves: 15, cps: 8, clicksPerBlock: 1, autoEvery: 1,
    start: { clicks: last.clicks + 480, auto: last.auto + 60, blocks: last.depth - 1 - last.auto + 480 } }));
  const r = play(u, steps);
  assert.ok(r[3].acceptedDepth < steps[3].depth, 'la rafale est d\'abord plafonnée');
  assert.strictEqual(r.at(-1).acceptedDepth, steps.at(-1).depth, 'puis rattrapée');
  assert.ok(!logs(u).some(l => l.action_taken === 'depth_rejected'));
});

test('POST maxDepth = 1e9 (compteurs gonflés) : profondeur non retenue et entrée anti-triche', () => {
  const u = newUser();
  const r = play(u, [{ t: 0, clicks: 1e9, auto: 1e9, depth: 1e9 }]);
  assert.ok(r[0].acceptedDepth <= 1, `retenue ${r[0].acceptedDepth}`);
  const l = logs(u);
  assert.strictEqual(l.length, 1);
  assert.strictEqual(l[0].action_taken, 'depth_rejected');
  const d = JSON.parse(l[0].details);
  assert.strictEqual(d.reportedDepth, 1e9);
  assert.ok(d.discardedClicks > 0);
  // Les sauvegardes suivantes (mêmes compteurs) ne débloquent rien et ne relogguent pas
  const r2 = play(u, [{ t: 12, clicks: 1e9, auto: 1e9, depth: 1e9 }, { t: 24, clicks: 1e9, auto: 1e9, depth: 1e9 }]);
  assert.ok(r2[1].acceptedDepth <= 1);
  assert.strictEqual(logs(u).length, 1);
});

test('POST maxDepth = 1e9 avec des compteurs cohérents : plafonnée au nombre de blocs possibles', () => {
  const u = newUser();
  const r = play(u, [
    { t: 0,  clicks: 0,  depth: 0 },
    { t: 12, clicks: 10, depth: 1e9 },
  ]);
  assert.ok(r[1].acceptedDepth <= 11, `retenue ${r[1].acceptedDepth}`);
  assert.strictEqual(logs(u).at(-1).action_taken, 'depth_capped');
});

test('joueur existant inactif 1 h puis triche : gain borné par la capacité du seau', () => {
  const u = newUser();
  const steps = legitSteps({ saves: 5 });
  const last  = steps.at(-1);
  const r = play(u, [...steps, { t: last.t + 3600, clicks: last.clicks + 1e6, auto: last.auto + 1e6, depth: 1e9 }]);
  const gain = r.at(-1).acceptedDepth - r.at(-2).acceptedDepth;
  assert.ok(gain <= 20 * 20 + 25, `gain ${gain}`);
  assert.strictEqual(logs(u).at(-1).action_taken, 'depth_rejected');
});

test('rafale de sauvegardes : le rythme maximal ne peut pas être dépassé', () => {
  const u = newUser();
  const steps = [{ t: 0, clicks: 0, depth: 0 }];
  // 100 sauvegardes en 1 s, +50 clics et +50 m chacune (5 000 CPS déclarés)
  for (let i = 1; i <= 100; i++) steps.push({ t: 30 + i * 0.01, clicks: i * 50, depth: 1 + i * 50 });
  const r = play(u, steps);
  // seau plein (20 s × 20 CPS) + 1 s de recharge
  assert.ok(r.at(-1).acceptedDepth <= 1 + 400 + 20 + 1, `retenue ${r.at(-1).acceptedDepth}`);
});

test('ligne de classement antérieure à la validation : conservée, sans crédit supplémentaire', () => {
  const u = newUser();
  db.upsertSeasonRanking(seasonId, u, 300, 200, null, 900, 0, null);
  db.updateAutoBlocksOnly(seasonId, u, 50);
  const r = play(u, [
    { t: 0,  clicks: 905, auto: 51, depth: 1e6 },  // première sauvegarde après déploiement
    { t: 12, clicks: 965, auto: 63, depth: 1e6 },
  ]);
  assert.strictEqual(r[0].acceptedDepth, 300);
  assert.ok(r[1].acceptedDepth <= 300 + (965 - 900) + (63 - 50), `retenue ${r[1].acceptedDepth}`);
});

test('compteurs revenus en arrière (autre appareil) : profondeur conservée, aucun crédit', () => {
  const u = newUser();
  const steps = legitSteps({ saves: 3 });
  const r = play(u, [...steps, { t: 48, clicks: 5, auto: 1, depth: 4 }, { t: 60, clicks: 65, auto: 7, depth: 30 }]);
  const kept = r[steps.length - 1].acceptedDepth;
  assert.strictEqual(r[steps.length].acceptedDepth, kept);
  assert.strictEqual(r.at(-1).acceptedDepth, kept);
});

test('validation désactivée par l\'admin : profondeur déclarée retenue', () => {
  const u = newUser();
  const r = play(u, [{ t: 0, clicks: 1, depth: 5000 }], { ...CONFIG, depth_validation_enabled: 'false' });
  assert.strictEqual(r[0].acceptedDepth, 5000);
  assert.strictEqual(logs(u).length, 0);
});

test('syncPlayerRanking : max_depth = profondeur retenue, reported_max_depth = déclarée', () => {
  const u = newUser();
  const active = db.getActiveSeason();
  seasons.syncPlayerRanking(u, { seasonId: active.id, maxDepth: 1e9, manualBlocks: 5, manualClicks: 1e9, autoBlocks: 0 });
  const row = db.getPlayerSeasonEntry(active.id, u);
  assert.ok(row.max_depth <= 1, `max_depth ${row.max_depth}`);
  assert.strictEqual(row.reported_max_depth, 1e9);
  assert.strictEqual(row.effective_manual_blocks, 0, 'blocs effectifs bornés par la profondeur retenue');
});

test('syncPlayerRanking : blocs manuels effectifs ≤ profondeur retenue − 1 (départage)', () => {
  const u = newUser();
  const active = db.getActiveSeason();
  // Profondeur cohérente mais blocs gonflés : 1e9 blocs pour 1e9 clics, 40 m déclarés
  seasons.syncPlayerRanking(u, { seasonId: active.id, maxDepth: 0, manualBlocks: 0, manualClicks: 0, autoBlocks: 0 });
  db.getDb().prepare('UPDATE player_depth_tracking SET hand_tokens = 400, auto_tokens = 25 WHERE user_id = ?').run(u);
  seasons.syncPlayerRanking(u, { seasonId: active.id, maxDepth: 40, manualBlocks: 1e9, manualClicks: 1e9, autoBlocks: 0 });
  const row = db.getPlayerSeasonEntry(active.id, u);
  assert.ok(row.max_depth <= 40);
  assert.ok(row.effective_manual_blocks <= row.max_depth - 1, JSON.stringify(row));
});

// ── Scénario HTTP : triche, classement public, correction admin ─────────────────────────────

test('HTTP : POST maxDepth=1e9 ne change pas le classement ; outil admin de correction', async () => {
  const httpDb = path.join(dir, 'http.sqlite');
  const adminSecret = crypto.randomBytes(16).toString('hex');
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: httpDb, ADMIN_SECRET: adminSecret, SESSION_SECRET: crypto.randomBytes(16).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', d => { log += d; });
  server.stderr.on('data', d => { log += d; });
  const admin = { Authorization: `Bearer ${adminSecret}`, 'Content-Type': 'application/json' };
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      try { await fetch(`${BASE}/api/version`); up = true; } catch (_) { await new Promise(r => setTimeout(r, 100)); }
    }
    assert.ok(up, log);

    const register = async name => {
      const reg = await fetch(`${BASE}/api/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name, email: `${name}@example.invalid`, password: 'secret123' }),
      });
      assert.strictEqual(reg.status, 200);
      return reg.headers.get('set-cookie').split(';')[0];
    };
    const season = (await (await fetch(`${BASE}/api/seasons/current`)).json()).season;
    const save = (cookie, ss) => fetch(`${BASE}/api/me/save`, {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { lastSaveTime: Date.now(), seasonStats: { seasonId: season.id, ...ss } } }),
    });

    // Joueur légitime : deux sauvegardes espacées (jetons disponibles à la seconde)
    const honest = await register('honest');
    assert.strictEqual((await save(honest, { maxDepth: 0, manualBlocks: 0, manualClicks: 0, autoBlocks: 0 })).status, 200);
    await new Promise(r => setTimeout(r, 1100));
    assert.strictEqual((await save(honest, { maxDepth: 4, manualBlocks: 3, manualClicks: 6, autoBlocks: 0 })).status, 200);

    // Tricheur : une seule requête avec maxDepth = 1e9
    const cheater = await register('cheater');
    const r = await save(cheater, { maxDepth: 1e9, manualBlocks: 1e9, manualClicks: 1e9, autoBlocks: 1e9 });
    assert.strictEqual(r.status, 200, 'la sauvegarde elle-même reste acceptée');

    const lb = await (await fetch(`${BASE}/api/seasons/active/leaderboard`)).json();
    assert.strictEqual(lb.leaderboard[0].username, 'honest', JSON.stringify(lb.leaderboard));
    assert.strictEqual(lb.leaderboard[0].maxDepth, 4);
    const cheatRow = lb.leaderboard.find(x => x.username === 'cheater');
    assert.ok(cheatRow.maxDepth <= 1, JSON.stringify(cheatRow));
    assert.strictEqual(cheatRow.reportedMaxDepth, undefined, 'valeur déclarée absente de l\'API publique');
    assert.strictEqual(cheatRow.manualBlocks, 0, 'blocs effectifs non gonflés');

    const acl = await (await fetch(`${BASE}/api/admin/anticheat/logs`, { headers: admin })).json();
    assert.ok(acl.logs.some(l => l.username === 'cheater' && l.action_taken === 'depth_rejected'), JSON.stringify(acl.logs));

    // Vue admin : profondeur déclarée visible
    const alb = await (await fetch(`${BASE}/api/admin/seasons/${season.id}/leaderboard`, { headers: admin })).json();
    const adminRow = alb.leaderboard.find(x => x.username === 'cheater');
    assert.strictEqual(adminRow.reportedMaxDepth, 1e9);

    // Correction admin : sans authentification → 401 ; valeurs invalides → 400 ; ligne absente → 404
    const url = `${BASE}/api/admin/seasons/${season.id}/rankings/${adminRow.userId}`;
    assert.strictEqual((await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"maxDepth":0}' })).status, 401);
    assert.strictEqual((await fetch(url, { method: 'PUT', headers: admin, body: JSON.stringify({ maxDepth: -3 }) })).status, 400);
    assert.strictEqual((await fetch(url, { method: 'PUT', headers: admin, body: JSON.stringify({}) })).status, 400);
    assert.strictEqual((await fetch(`${BASE}/api/admin/seasons/${season.id}/rankings/99999`, { method: 'PUT', headers: admin, body: JSON.stringify({ maxDepth: 0 }) })).status, 404);

    const fix = await fetch(url, { method: 'PUT', headers: admin, body: JSON.stringify({ maxDepth: 0, effectiveManualBlocks: 0, reason: 'test <b>' }) });
    assert.strictEqual(fix.status, 200);
    const fixed = await fix.json();
    assert.strictEqual(fixed.ranking.maxDepth, 0);
    assert.strictEqual(fixed.ranking.effectiveManualBlocks, 0);

    // La sauvegarde suivante du tricheur ne rétablit pas les anciennes valeurs
    await save(cheater, { maxDepth: 1e9, manualBlocks: 1e9, manualClicks: 1e9, autoBlocks: 1e9 });
    const after = (await (await fetch(`${BASE}/api/admin/seasons/${season.id}/leaderboard`, { headers: admin })).json())
      .leaderboard.find(x => x.username === 'cheater');
    assert.ok(after.maxDepth <= 1, JSON.stringify(after));
    assert.ok(after.manualBlocks <= 1, JSON.stringify(after));

    const acl2 = await (await fetch(`${BASE}/api/admin/anticheat/logs`, { headers: admin })).json();
    const fixLog = acl2.logs.find(l => l.action_taken === 'admin_fix');
    assert.ok(fixLog, 'correction journalisée');
    assert.strictEqual(JSON.parse(fixLog.details).reason, 'test <b>');
  } finally {
    server.kill();
  }
});
