/**
 * Nettoyage, i18n et robustesse (ticket #24, audit B11 et risques P3).
 *  - pagination : ?page=abc, ?limit=xyz ne donnent plus NaN ;
 *  - corps illisibles (encodage « br », JSON invalide) : 4xx JSON et une ligne de journal ;
 *  - exception non gérée : le processus s'arrête (systemd le relance) ;
 *  - mission quotidienne « profondeur » jamais négative après un reset de saison ;
 *  - traductions FR/EN/NL complètes et sans chaîne FR codée en dur connue.
 * Serveur sur un port ≠ 3000 et base temporaire hors server/data/.
 * Lancer : npm test
 */

'use strict';

const test     = require('node:test');
const assert   = require('node:assert');
const crypto   = require('crypto');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const vm       = require('vm');
const { spawn } = require('child_process');

const { intParam } = require('../server/validation');

const ROOT  = path.join(__dirname, '..');
const PORT  = process.env.DIG_TEST_PORT_ROBUST || '3120';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(24).toString('hex');

// ── Unitaires ────────────────────────────────────────────────────────────────

test('intParam : valeur par défaut si absente ou non numérique, bornes respectées', () => {
  const page = v => intParam(v, { def: 1, min: 1 });
  assert.strictEqual(page(undefined), 1);
  assert.strictEqual(page('abc'), 1);
  assert.strictEqual(page(''), 1);
  assert.strictEqual(page('2abc'), 1);
  assert.strictEqual(page(['2', '3']), 1);
  assert.strictEqual(page('0'), 1);
  assert.strictEqual(page('-4'), 1);
  assert.strictEqual(page('3'), 3);
  assert.strictEqual(page('99999999999999999999'), 1e9);
  const limit = v => intParam(v, { def: 100, min: 1, max: 500 });
  assert.strictEqual(limit('xyz'), 100);
  assert.strictEqual(limit('9000'), 500);
  assert.strictEqual(limit('20'), 20);
});

function loadBrowser(files, extra = {}) {
  const store = new Map();
  const ctx = vm.createContext({
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    document: { documentElement: {}, querySelectorAll: () => [] },
    Date, JSON, Math, Object, Array, Number, String, Boolean,
    ...extra,
  });
  for (const [file, name, patch] of files) {
    let src = fs.readFileSync(path.join(ROOT, 'public', 'js', file), 'utf8');
    if (patch) src = patch(src);
    vm.runInContext(`${src}\nthis.${name} = ${name};`, ctx);
  }
  return ctx;
}

test('mission « profondeur » : jamais négative, progression du jour conservée au reset de saison', () => {
  const ctx = loadBrowser([
    ['gameState.js', 'GameState'],
    ['dailyMissions.js', 'DailyMissions'],
  ], { Daily: { getToday: () => '2026-10-30' }, t: k => k });
  const { GameState, DailyMissions } = ctx;
  GameState.depth = 100;
  DailyMissions.refresh();
  const dm = GameState.dailyMissions;
  dm.missions = [{ id: 'depth_gain', target: 20, claimed: false }];

  GameState.depth = 110;                       // +10 aujourd'hui
  assert.strictEqual(DailyMissions.getProgress(0), 10);

  DailyMissions.rebase('depth', 1);            // reset de saison : profondeur → 1
  GameState.depth = 1;
  assert.strictEqual(DailyMissions.getProgress(0), 10, 'progression conservée');
  GameState.depth = 11;
  assert.strictEqual(DailyMissions.getProgress(0), 20);
  assert.ok(DailyMissions.isDone(0));

  // Baisse sans rebase (save cloud, reset admin) : 0, jamais négatif
  dm.baselineStats.depth = 500;
  assert.strictEqual(DailyMissions.getProgress(0), 0);
});

test('i18n : EN et NL ont toutes les clés FR, et les clés utilisées existent', () => {
  const ctx = loadBrowser([['i18n.js', 'I18n', s => s.replace('return { init,', 'return { _T: T, init,')]]);
  const T = ctx.I18n._T;
  const flat = (o, p = '', out = {}) => {
    for (const [k, v] of Object.entries(o)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === 'object') flat(v, key, out); else out[key] = v;
    }
    return out;
  };
  const F = Object.fromEntries(Object.keys(T).map(l => [l, flat(T[l])]));
  for (const lang of ['en', 'nl']) {
    assert.deepStrictEqual(Object.keys(F.fr).filter(k => !(k in F[lang])), [], `clés absentes en ${lang}`);
  }
  const used = new Set();
  const files = fs.readdirSync(path.join(ROOT, 'public/js')).map(f => path.join(ROOT, 'public/js', f))
    .concat(path.join(ROOT, 'public/index.html'));
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/\bt\(\s*['"]([a-z0-9_]+\.[a-z0-9_.]*[a-z0-9_])['"]/g)) used.add(m[1]);
    for (const m of s.matchAll(/data-i18n(?:-aria|-placeholder)?="([a-z0-9_.]+)"/g)) used.add(m[1]);
  }
  assert.deepStrictEqual([...used].filter(k => !(k in F.fr)), [], 'clés utilisées mais non définies');
});

test('i18n : plus de chaîne FR codée en dur connue (classement vide, navigation, bannière)', () => {
  const main = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
  assert.doesNotMatch(main, /Aucun joueur actif/);
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.match(html, /<nav id="bottom-nav"[^>]*data-i18n-aria="nav\.main_aria"/);
  assert.match(html, /id="update-banner-text" data-i18n="ui\.update_available"/);
  assert.match(html, /id="update-banner-btn"[^>]*data-i18n="ui\.update_reload"/);
  assert.match(html, /id="ad-mock-sub" data-i18n="ui\.ad_mock_sub"/);
});

// ── Serveur ──────────────────────────────────────────────────────────────────

async function startServer(t, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-robust-'));
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, NODE_ENV: 'test', PORT, SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: path.join(dir, 't.sqlite'),
      SESSION_SECRET: crypto.randomBytes(32).toString('hex'), ADMIN_SECRET: ADMIN, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const state = { log: '', child };
  child.stdout.on('data', d => { state.log += d; });
  child.stderr.on('data', d => { state.log += d; });
  state.exited = new Promise(r => child.on('exit', code => r(code)));
  t.after(async () => {
    if (child.exitCode === null) child.kill('SIGTERM');
    await state.exited;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/api/version`)).status < 500) break; } catch (_) {}
    await new Promise(r => setTimeout(r, 100));
  }
  return state;
}

test('serveur : pagination invalide, corps illisibles et 404 JSON', async (t) => {
  const srv = await startServer(t);

  const cur = await (await fetch(`${BASE}/api/seasons/current`)).json();
  assert.ok(cur.season?.id, srv.log);

  for (const url of [
    '/api/seasons/active/leaderboard?page=abc',
    `/api/seasons/${cur.season.id}/leaderboard?page=abc`,
    `/api/seasons/${cur.season.id}/leaderboard?page=-3`,
  ]) {
    const r = await fetch(BASE + url);
    assert.strictEqual(r.status, 200, `${url}\n${srv.log}`);
    assert.strictEqual((await r.json()).page, 1, url);
  }
  const auth = { Authorization: `Bearer ${ADMIN}` };
  const logs = await fetch(`${BASE}/api/admin/anticheat/logs?limit=abc&offset=zz`, { headers: auth });
  assert.strictEqual(logs.status, 200, srv.log);
  const body = await logs.json();
  assert.strictEqual(body.limit, 100);
  assert.strictEqual(body.offset, 0);
  const adminLb = await fetch(`${BASE}/api/admin/seasons/abc/leaderboard?page=abc`, { headers: auth });
  assert.strictEqual(adminLb.status, 400);

  // Encodage « br » : 415 JSON et une seule ligne de journal (plus de pile complète)
  const before = srv.log.length;
  const br = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'br' }, body: 'xxxx',
  });
  assert.strictEqual(br.status, 415);
  assert.deepStrictEqual(await br.json(), { error: 'Requête invalide.' });
  const bad = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.strictEqual(bad.status, 400);
  assert.deepStrictEqual(await bad.json(), { error: 'Requête invalide.' });
  await new Promise(r => setTimeout(r, 200));
  const added = srv.log.slice(before);
  assert.match(added, /\[http\] 415 POST \/api\/login — encoding\.unsupported/);
  assert.match(added, /\[http\] 400 POST \/api\/login — entity\.parse\.failed/);
  assert.doesNotMatch(added, /\n\s+at /, 'aucune pile d\'appels dans le journal');

  const unknown = await fetch(`${BASE}/api/inconnue`);
  assert.strictEqual(unknown.status, 404);
  assert.ok(srv.child.exitCode === null, 'le serveur tourne toujours');
});

test('serveur : une exception non gérée arrête le processus (relancé par systemd)', async (t) => {
  // Le préchargement lève une exception asynchrone une fois le serveur démarré.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-robust-pre-'));
  const pre = path.join(dir, 'boom.js');
  fs.writeFileSync(pre, "setTimeout(() => { throw new Error('boom-test-24'); }, 1500);\n");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const srv = await startServer(t, { NODE_OPTIONS: `--require ${pre}` });
  const code = await Promise.race([srv.exited, new Promise(r => setTimeout(() => r('timeout'), 10000))]);
  assert.strictEqual(code, 1, srv.log);
  assert.match(srv.log, /\[uncaughtException\] arrêt du processus/);
  assert.match(srv.log, /boom-test-24/);
});
