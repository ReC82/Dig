/**
 * Tutoriel de première partie (#79) :
 * - état par compte dans une table à part (ajout seul), validé et borné, sans toucher aux sauvegardes ;
 * - routes /api/me/tutorial réservées au joueur connecté ;
 * - textes : toutes les langues, une phrase par étape, aucun chiffre d'équilibrage ;
 * - aucune action de jeu depuis tutorial.js (ni sauvegarde, ni achat, ni changement d'onglet, ni gain) ;
 * - proposé seulement à une partie neuve, après la session connue ; entrée dans l'Aide (#78).
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

const ROOT = path.join(__dirname, '..');
const PORT = process.env.DIG_TEST_PORT_TUTORIAL || '3179';
const BASE = `http://127.0.0.1:${PORT}`;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-tutorial-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db       = require('../server/db');
const tutorial = require('../server/tutorial');

db.initDb();
tutorial.init();
const conn = () => db.getDb();

test('état par compte : absent, en cours, passé, terminé ; validation ; sauvegarde intacte', () => {
  const uid = conn().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('tuto_user', 'x').lastInsertRowid;
  conn().prepare('INSERT INTO user_saves (user_id, data) VALUES (?, ?)').run(uid, '{"coins":5}');
  const before = conn().prepare('SELECT * FROM user_saves WHERE user_id = ?').get(uid);

  assert.strictEqual(tutorial.get(uid), null, 'jamais commencé');
  let r = tutorial.set(uid, { v: 1, state: 'started', step: 2 });
  assert.deepStrictEqual([r.v, r.state, r.step], [1, 'started', 2]);
  assert.match(r.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  r = tutorial.set(uid, { v: 1, state: 'skipped', step: 2 });
  assert.strictEqual(r.state, 'skipped');
  r = tutorial.set(uid, { v: 1, state: 'done', step: 6 });
  assert.strictEqual(r.state, 'done');
  assert.strictEqual(conn().prepare('SELECT COUNT(*) AS n FROM player_tutorial WHERE user_id = ?').get(uid).n, 1, 'une ligne par compte');

  for (const bad of [{}, { v: 0, state: 'done' }, { v: 1, state: 'won' }, { v: 1, state: 'done', step: -1 },
    { v: 1, state: 'done', step: 999 }, { v: '1', state: 'done' }, { v: 1.5, state: 'done' }])
    assert.throws(() => tutorial.set(uid, bad), e => e.status === 400, JSON.stringify(bad));

  assert.deepStrictEqual(conn().prepare('SELECT * FROM user_saves WHERE user_id = ?').get(uid), before, 'sauvegarde jamais touchée');
  const cols = conn().prepare('PRAGMA table_info(users)').all().map(c => c.name);
  assert.ok(!cols.some(c => /tuto/i.test(c)), 'aucune colonne ajoutée à users');
  tutorial.init();   // idempotent
  assert.strictEqual(tutorial.get(uid).state, 'done');
});

// ── HTTP ──────────────────────────────────────────────────────────────────────

let server;
const httpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-tutorial-http-'));

test('HTTP : invité refusé, joueur lit et écrit son état', async () => {
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'test', PORT, DB_FILE: path.join(httpDir, 'http.sqlite'),
      SESSION_SECRET: crypto.randomBytes(32).toString('hex'), SESSIONS_DIR: path.join(httpDir, 'sessions'), RATE_LIMIT: 'off' },
  });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { up = (await fetch(`${BASE}/health`)).ok; } catch (_) { await new Promise(r => setTimeout(r, 100)); }
  }
  assert.ok(up, 'serveur démarré');
  assert.strictEqual((await fetch(`${BASE}/api/me/tutorial`)).status, 401);
  assert.strictEqual((await fetch(`${BASE}/api/me/tutorial`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"v":1,"state":"done"}' })).status, 401);

  const jar = {};
  const call = async (method, p, body) => {
    const res = await fetch(`${BASE}${p}`, { method, headers: { 'Content-Type': 'application/json', ...(jar.c ? { Cookie: jar.c } : {}) }, body: body && JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) jar.c = sc.split(';')[0];
    return res;
  };
  let r = await call('POST', '/api/register', { username: 'tutofan', email: 'tutofan@example.test', password: 'motdepasse-solide' });
  assert.ok(r.ok, `inscription : ${r.status}`);
  r = await call('GET', '/api/me/tutorial');
  assert.strictEqual(r.headers.get('cache-control'), 'no-store');
  assert.strictEqual((await r.json()).tutorial, null);
  r = await call('PUT', '/api/me/tutorial', { v: 1, state: 'started', step: 3 });
  assert.strictEqual((await r.json()).tutorial.step, 3);
  assert.strictEqual((await call('PUT', '/api/me/tutorial', { v: 1, state: 'nope' })).status, 400);
  r = await call('PUT', '/api/me/tutorial', { v: 1, state: 'skipped', step: 3 });
  assert.strictEqual((await (await call('GET', '/api/me/tutorial')).json()).tutorial.state, 'skipped');
});

test('HTTP : arrêt', () => { server?.kill(); });

// ── Textes ──────────────────────────────────────────────────────────────────────

function loadI18n() {
  const store = {};
  const ctx = { console, localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    navigator: { language: 'fr' }, document: { documentElement: {}, querySelectorAll: () => [] } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('public/js/languages.js'), ctx);
  vm.runInContext(`${read('public/js/i18n.js')}\n;this.I18n = I18n; this.t = t;`, ctx);
  vm.runInContext(read('public/js/locales/it.js'), ctx);
  return ctx;
}

const STEP_IDS = ['tap', 'hp', 'coins', 'autodig', 'ranking', 'more'];
const KEYS = ['title', 'offer_title', 'offer_text', 'start', 'skip', 'back', 'next', 'finish', 'progress',
  'help_title', 'help_start', 'help_resume', 'help_restart', ...STEP_IDS.map(s => `steps.${s}`)];

test('textes : FR/EN/NL/ES/IT complets, une phrase par étape, aucun chiffre figé', () => {
  const { I18n } = loadI18n();
  for (const lang of ['fr', 'en', 'nl', 'es', 'it']) {
    for (const k of KEYS) assert.ok(I18n.has(`tutorial.${k}`, lang), `${lang} : tutorial.${k}`);
  }
  const src = read('public/js/i18n.js');
  const it = JSON.parse(read('i18n/it.json')).entries;
  for (const s of STEP_IDS) assert.ok(it[`tutorial.steps.${s}`], `italien : ${s}`);
  // Une phrase : aucun point, ! ou ? suivi d'un autre texte au milieu
  const steps = [...src.matchAll(/^ {10}(tap|hp|coins|autodig|ranking|more): '((?:[^'\\]|\\.)*)',$/gm)].map(m => m[2]);
  assert.strictEqual(steps.length, STEP_IDS.length * 4, 'six étapes × quatre langues intégrées');
  for (const s of [...steps, ...STEP_IDS.map(k => it[`tutorial.steps.${k}`].text)]) {
    assert.ok(!/[.!?]\s+\S/.test(s.replace(/\?\s+(en haut|at the top|bovenaan|de arriba|in alto)/, '')), `une seule phrase : ${s}`);
    assert.ok(!/\d/.test(s), `aucun chiffre : ${s}`);
    assert.ok(s.length <= 130, `court : ${s}`);
  }
  // Le classement est décrit comme dans le jeu : blocs cassés à la main, pas la profondeur
  assert.match(src, /ranking: 'Au classement de la saison, seuls les blocs cassés à la main comptent, pas la profondeur\.'/);
});

// ── Client ──────────────────────────────────────────────────────────────────────

test('tutorial.js : aucune action de jeu, aucun gain, aucun changement d\'onglet', () => {
  const code = read('public/js/tutorial.js').replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const re of [/Save\.(save|load|purge|write)/, /switchView/, /\.click\(\)/, /purchase|buy\(|Upgrades\.(buy|purchase)/,
    /GameState\.\w+(\.\w+)*\s*(=|\+=|-=|\+\+|--)(?!=)/, /Blocks\.(hit|spawn|damage)/, /\/api\/(?!me\/tutorial)/])
    assert.ok(!re.test(code), `tutorial.js ne doit pas contenir ${re}`);
  assert.match(code, /pointer-events|tuto-ring/, 'cadre lumineux');
  const css = read('public/css/style.css');
  assert.match(css, /\.tuto-ring \{[^}]*pointer-events: none/, 'le cadre ne capte aucun clic');
  assert.ok(!/\.tuto-card[^{]*\{[^}]*inset: 0/.test(css), 'pas de voile plein écran');
});

test('chargement : après help.js et avant main.js ; proposé après la session connue, partie neuve seulement', () => {
  const html = read('public/index.html');
  const i = html.indexOf('js/tutorial.js');
  assert.ok(i > html.indexOf('js/help.js') && i < html.indexOf('js/main.js'));
  const main = read('public/js/main.js');
  assert.match(main, /_tutoFresh = GameState\.stats\.blocksDestroyed === 0 && GameState\.depth <= 1;/, 'partie neuve mesurée à l\'ouverture');
  assert.ok(main.indexOf('_tutoFresh = GameState') > main.indexOf('Save.load();'), 'après la reprise de la sauvegarde locale');
  assert.match(main, /_applyCloudSave\(cloud\);\s*\n\s*_tutoCloudAdopted = true;/, 'sauvegarde du compte reprise : compte déjà joué');
  const fetchMe = main.slice(main.indexOf('async function _fetchMe'), main.indexOf('async function _doRegister'));
  assert.ok(fetchMe.indexOf('DigTutorial.boot') > fetchMe.indexOf('_syncAfterLogin'), 'décision après la reprise du compte');
  assert.match(main, /DigTutorial\.onLogout\(\)/);
  const tuto = read('public/js/tutorial.js');
  assert.match(tuto, /if \(!_rec && fresh\) \{ _pendingOffer = true;/, 'proposé seulement sans état enregistré et partie neuve');
  assert.match(tuto, /const VERSION = 1;/);
  const help = read('public/js/help.js');
  assert.match(help, /DigTutorial\.helpEntryHtml\(\)/, 'entrée dans l\'Aide');
  assert.match(help, /DigTutorial\.onHelpClick\(e, close\)/);
});

test.after(() => {
  server?.kill();
  try { db.getDb().close(); } catch (_) { /* déjà fermée */ }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(httpDir, { recursive: true, force: true });
});
