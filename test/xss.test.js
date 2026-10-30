/**
 * XSS stockée dans le panel admin et le classement (ticket #15).
 * Tests sans navigateur : échappement, validation e-mail, inspection statique
 * des rendus innerHTML, et refus des e-mails piégés par l'API (port ≠ 3000,
 * base temporaire hors server/data/).
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

const { escapeHtml }   = require('../public/js/escapeHtml');
const { isValidEmail } = require('../server/validation');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.DIG_TEST_PORT_XSS || '3115';
const BASE = `http://127.0.0.1:${PORT}`;

const PAYLOADS = [
  '<img src=x onerror=alert(1)>',
  '"><script>alert(1)</script>',
  "');alert(1);//",
  '<svg/onload=alert(1)>',
];

test('escapeHtml neutralise les caractères HTML', () => {
  assert.strictEqual(escapeHtml('<img src=x onerror="a(\'1\')">`'),
    '&lt;img src=x onerror=&quot;a(&#39;1&#39;)&quot;&gt;&#96;');
  assert.strictEqual(escapeHtml('a & b'), 'a &amp; b');
  assert.strictEqual(escapeHtml(null), '');
  assert.strictEqual(escapeHtml(undefined), '');
  assert.strictEqual(escapeHtml(42), '42');
  for (const p of PAYLOADS) assert.doesNotMatch(escapeHtml(p), /[<>"'`]/);
});

test('isValidEmail accepte les adresses courantes', () => {
  for (const e of ['alice@example.com', 'a.b+tag@sub.example.co.uk', "o'brien@example.be", 'x_y-z@ex-ample.org', '  bob@example.fr  ']) {
    assert.ok(isValidEmail(e), e);
  }
});

test('isValidEmail refuse les adresses piégées ou malformées', () => {
  const bad = [
    ...PAYLOADS.map(p => `${p}@example.com`),
    'a@b.c<img src=x onerror=alert(1)>',
    'x@example.com"onmouseover="alert(1)',
    'a<b@example.com', 'a@exa>mple.com', 'a\\b@example.com', 'a"b@example.com',
    'a@b', 'a@b.c', '@example.com', 'a@', 'a@.example.com', 'a..b@example.com', '.a@example.com',
    'a@-example.com', 'a@example-.com', 'a b@example.com', 'a@exa mple.com', 'a\n@example.com',
    'a@example.com\u0000', `${'a'.repeat(65)}@example.com`, `a@${'b'.repeat(250)}.com`,
    '', null, undefined, 42, {},
  ];
  for (const e of bad) assert.ok(!isValidEmail(e), JSON.stringify(e));
});

test('admin.js : innerHTML ne reçoit que des chaînes statiques, aucun onclick inline', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
  const code = src.replace(/^\s*\/\/.*$/gm, '');
  const assigns = [...code.matchAll(/\.innerHTML\s*=\s*([\s\S]*?);/g)].map(m => m[1].trim());
  assert.ok(assigns.length > 0);
  for (const rhs of assigns) assert.match(rhs, /^'[^'\\]*'$/, `innerHTML dynamique : ${rhs.slice(0, 80)}`);
  assert.doesNotMatch(code, /onclick\s*=/i);
  assert.doesNotMatch(code, /insertAdjacentHTML|outerHTML|document\.write/);
});

test('main.js : le classement et la saison échappent les données serveur', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
  for (const expr of ['row.username', 'row.league.icon', 'season.name', 'player.league.name', 'player.league.icon', '_account.username']) {
    const re = new RegExp(`\\$\\{${expr.replace(/\./g, '\\.')}\\}`);
    assert.doesNotMatch(src, re, `${expr} inséré sans escapeHtml`);
  }
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(html.indexOf('js/escapeHtml.js') !== -1 && html.indexOf('js/escapeHtml.js') < html.indexOf('js/main.js'),
    'escapeHtml.js doit être chargé avant main.js');
});

test('POST /api/register refuse un e-mail piégé', async (t) => {
  const dir   = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-xss-'));
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, NODE_ENV: 'test', PORT, SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: path.join(dir, 't.sqlite'),
      SESSION_SECRET: crypto.randomBytes(32).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const exited = new Promise(r => child.on('exit', r));
  t.after(async () => { child.kill('SIGTERM'); await exited; fs.rmSync(dir, { recursive: true, force: true }); });

  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/api/version`)).status < 500) break; } catch (_) {}
    await new Promise(r => setTimeout(r, 100));
  }

  const post = (body) => fetch(`${BASE}/api/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const bad = await post({ username: 'xss_probe', email: 'a@b.c<img src=x onerror=alert(1)>', password: 'secret123' });
  assert.strictEqual(bad.status, 400, log);
  assert.match((await bad.json()).error, /e-mail/);
  const good = await post({ username: 'xss_ok', email: 'xss.ok@example.com', password: 'secret123' });
  assert.strictEqual(good.status, 200, log);
});
