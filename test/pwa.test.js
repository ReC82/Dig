/**
 * PWA, ergonomie mobile et accessibilité (ticket #21).
 * Serveur de test sur un port ≠ 3000, base temporaire hors server/data/.
 * Lancer : npm test
 */

'use strict';

const test      = require('node:test');
const assert    = require('node:assert');
const crypto    = require('crypto');
const fs        = require('fs');
const os        = require('os');
const path      = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.DIG_TEST_PORT_PWA || '3127';
const BASE = `http://127.0.0.1:${PORT}`;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let dir, child;

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-pwa-'));
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH, NODE_ENV: 'production', PORT,
      SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
      SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: path.join(dir, 'pwa.sqlite'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.log = '';
  child.stdout.on('data', d => { child.log += d; });
  child.stderr.on('data', d => { child.log += d; });
  child.exited = new Promise(r => child.on('exit', r));
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${BASE}/health`); return; } catch (_) {}
    if (child.exitCode !== null) break;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`serveur non démarré :\n${child.log}`);
});

test.after(async () => {
  if (child) { child.kill(); await child.exited; }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('page d\'accueil : viewport-fit=cover, zoom autorisé, manifest, theme-color, icônes', async () => {
  const html = await (await fetch(`${BASE}/`)).text();
  const viewport = html.match(/<meta name="viewport" content="([^"]+)"/)[1];
  assert.match(viewport, /viewport-fit=cover/);
  assert.doesNotMatch(viewport, /user-scalable=no|maximum-scale/);
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(html, /<meta name="theme-color" content="#0f0f1a">/);
  assert.match(html, /apple-touch-icon" href="assets\/pwa\/apple-touch-icon\.png\?v=/);
});

test('manifest : installable (nom, start_url, standalone, icônes 192/512/maskable présentes) et non mis en cache longue durée', async () => {
  const res = await fetch(`${BASE}/manifest.webmanifest`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /manifest\+json|json/);
  assert.match(res.headers.get('cache-control'), /no-cache/);
  const m = await res.json();
  assert.ok(m.name && m.short_name && m.start_url && m.scope === '/');
  assert.strictEqual(m.display, 'standalone');
  const sizes = m.icons.map(i => `${i.sizes}:${i.purpose}`);
  for (const s of ['192x192:any', '512x512:any', '512x512:maskable']) assert.ok(sizes.includes(s), s);
  for (const icon of m.icons) {
    const r = await fetch(`${BASE}${icon.src}`);
    assert.strictEqual(r.status, 200, icon.src);
    const buf = Buffer.from(await r.arrayBuffer());
    assert.strictEqual(buf.subarray(1, 4).toString(), 'PNG', icon.src);
    const [w, h] = icon.sizes.split('x').map(Number);
    assert.deepStrictEqual([buf.readUInt32BE(16), buf.readUInt32BE(20)], [w, h], icon.src);
  }
});

test('service worker : version injectée, sans cache HTTP, API jamais interceptée', async () => {
  const res = await fetch(`${BASE}/sw.js`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  assert.match(res.headers.get('cache-control'), /no-cache/);
  const { version } = await (await fetch(`${BASE}/api/version`)).json();
  const src = await res.text();
  assert.ok(src.includes(`const VERSION = '${version}'`), 'version injectée');
  assert.ok(!src.includes('__APP_VERSION__'));
  assert.match(src, /startsWith\('\/api\/'\)/);
  assert.match(src, /req\.method !== 'GET'/);
  assert.doesNotThrow(() => new Function(src));
});

test('accessibilité : bloc jouable au clavier, focus visible, mouvements réduits sans casser les fins d\'animation', () => {
  const html = read('public/index.html');
  assert.match(html, /<div id="block" role="button" tabindex="0"/);
  const main = read('public/js/main.js');
  assert.match(main, /elBlock\.addEventListener\('keydown'/);
  assert.match(main, /if \(e\.repeat\) return;/, 'touche maintenue ignorée (anti-autoclic)');
  const css = read('public/css/style.css');
  assert.match(css, /:focus-visible/);
  const rm = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.ok(rm.length > 40, 'bloc prefers-reduced-motion présent');
  // Le jeu attend animationend sur ces éléments : jamais « animation: none » pour eux.
  const block = rm.slice(0, rm.indexOf('\n}\n'));
  for (const sel of ['#block.anim-break', '#block.anim-spawn', '#block.anim-hit', '.float-text', '.particle']) {
    const line = block.split('\n').find(l => l.includes(sel)) || '';
    assert.doesNotMatch(line, /animation:\s*none/, sel);
  }
  assert.match(css, /safe-area-inset-top/);
});

test('i18n : libellé du bloc traduit dans toutes les langues', () => {
  const src = read('public/js/i18n.js');
  assert.strictEqual((src.match(/block_aria:/g) || []).length, 3);
});
