/**
 * Outillage de test et isolation de la production (ticket #17, audit B10 / B11).
 * - seed-test.js refuse de tourner sans DB_FILE explicite ou sur dig.sqlite ;
 * - test-season.js (62 contrôles historiques) passe et ne laisse ni base ni -wal / -shm ;
 * - SESSIONS_DIR envoie les sessions d'un serveur de test hors de server/data/sessions.
 * Tout se fait dans des dossiers temporaires, serveur sur un port ≠ 3000.
 * Lancer : npm test
 */

'use strict';

const test     = require('node:test');
const assert   = require('node:assert');
const crypto   = require('crypto');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const { spawn, spawnSync } = require('child_process');

const { resolveTestDbPath } = require('../server/testDbGuard');

const ROOT   = path.join(__dirname, '..');
const SEED   = path.join(ROOT, 'server', 'seed-test.js');
const SEASON = path.join(ROOT, 'server', 'test-season.js');
const PORT   = process.env.DIG_TEST_PORT_TOOLING || '3117';
const BASE   = `http://127.0.0.1:${PORT}`;

let dir;
test.before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-tooling-')); });
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

// cwd temporaire : aucun .env du dépôt n'est chargé par dotenv.
function run(script, args, env, cwd = dir) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 120000,
  });
}

// ── Garde-fou de la base ──────────────────────────────────────────────────────

test('resolveTestDbPath : DB_FILE obligatoire, dig.sqlite refusé', () => {
  const data = path.join(dir, 'data');
  assert.throws(() => resolveTestDbPath({}, data), /DB_FILE absent/);
  assert.throws(() => resolveTestDbPath({ DB_FILE: '  ' }, data), /DB_FILE absent/);
  assert.throws(() => resolveTestDbPath({ DB_FILE: 'dig.sqlite' }, data), /production/);
  assert.throws(() => resolveTestDbPath({ DB_FILE: 'DIG.sqlite' }, data), /production/);
  assert.throws(() => resolveTestDbPath({ DB_FILE: '/home/ubuntu/Dig/server/data/dig.sqlite' }, data), /production/);
  assert.throws(() => resolveTestDbPath({ DB_FILE: '../data/dig.sqlite' }, data), /production/);
  assert.strictEqual(resolveTestDbPath({ DB_FILE: 'seed.sqlite' }, data), path.join(data, 'seed.sqlite'));
  assert.strictEqual(resolveTestDbPath({ DB_FILE: '/tmp/x.sqlite' }, data), '/tmp/x.sqlite');
});

test('seed-test.js sans DB_FILE, ou sur dig.sqlite, se termine en erreur sans rien créer', () => {
  const cwd = fs.mkdtempSync(path.join(dir, 'seed-ko-'));
  for (const env of [{}, { DB_FILE: 'dig.sqlite' }, { DB_FILE: path.join(cwd, 'dig.sqlite') }]) {
    for (const args of [[], ['--check'], ['--clean'], ['--close-season']]) {
      const r = run(SEED, args, env, cwd);
      assert.strictEqual(r.status, 2, `${JSON.stringify(env)} ${args}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /DB_FILE absent|production/);
    }
  }
  assert.deepStrictEqual(fs.readdirSync(cwd), []);
});

test('seed-test.js ignore un DB_FILE venant de .env', () => {
  const cwd = fs.mkdtempSync(path.join(dir, 'seed-env-'));
  fs.writeFileSync(path.join(cwd, '.env'), `DB_FILE=${path.join(cwd, 'from-env.sqlite')}\n`);
  const r = run(SEED, [], {}, cwd);
  assert.strictEqual(r.status, 2, r.stdout + r.stderr);
  assert.deepStrictEqual(fs.readdirSync(cwd), ['.env']);
});

test('seed-test.js sur une base temporaire : seed, --check, --clean, sans -wal / -shm résiduels', () => {
  const cwd = fs.mkdtempSync(path.join(dir, 'seed-ok-'));
  const env = { DB_FILE: path.join(cwd, 'seed.sqlite') };
  const seeded = run(SEED, [], env, cwd);
  assert.strictEqual(seeded.status, 0, seeded.stdout + seeded.stderr);
  assert.match(seeded.stdout, /Seed terminé/);
  const check = run(SEED, ['--check'], env, cwd);
  assert.strictEqual(check.status, 0, check.stdout + check.stderr);
  assert.match(check.stdout, /testplayer_alpha/);
  const clean = run(SEED, ['--clean'], env, cwd);
  assert.strictEqual(clean.status, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /joueur\(s\) de test supprimé/);
  assert.deepStrictEqual(fs.readdirSync(cwd), ['seed.sqlite']);
});

// ── Tests historiques des saisons ─────────────────────────────────────────────

test('server/test-season.js : 62 contrôles verts, aucun fichier laissé', () => {
  const tmp = fs.mkdtempSync(path.join(dir, 'season-'));
  const dataDir = path.join(ROOT, 'server', 'data');
  const before = fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : [];
  const r = run(SEASON, [], { TMPDIR: tmp });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Tous les tests passent \(\d+\/\d+\)/);
  assert.deepStrictEqual(fs.readdirSync(tmp), [], 'base, -wal ou -shm résiduel');
  const after = fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : [];
  assert.deepStrictEqual(after, before, 'test-season.js ne doit rien écrire dans server/data/');
});

// ── Sessions du serveur de test ───────────────────────────────────────────────

test('SESSIONS_DIR : les sessions du serveur de test restent dans le dossier temporaire', async () => {
  const sessions = path.join(dir, 'sessions');
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, NODE_ENV: 'test', PORT, DB_FILE: path.join(dir, 'http.sqlite'),
      SESSIONS_DIR: sessions, SESSION_SECRET: crypto.randomBytes(32).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const exited = new Promise(r => child.on('exit', r));
  try {
    let up = false;
    for (let i = 0; i < 100 && !up && child.exitCode === null; i++) {
      try { await fetch(`${BASE}/health`); up = true; } catch (_) { await new Promise(r => setTimeout(r, 100)); }
    }
    assert.ok(up, `serveur non démarré :\n${log}`);
    const res = await fetch(`${BASE}/api/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'tooling_user', email: 'tooling@example.com', password: 'secret123' }),
    });
    assert.strictEqual(res.status, 200, await res.text());
    let files = [];
    for (let i = 0; i < 20 && !files.length; i++) {
      files = fs.existsSync(sessions) ? fs.readdirSync(sessions).filter(f => f.endsWith('.json')) : [];
      if (!files.length) await new Promise(r => setTimeout(r, 100));
    }
    assert.strictEqual(files.length, 1, `session absente de ${sessions}`);
  } finally {
    child.kill();
    await exited;
  }
});
