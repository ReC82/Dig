/**
 * Debug joueur (#37, recette du propriétaire du 03/11) :
 * - autocomplétion des pseudos : saisie partielle, préfixes d'abord, identifiant stable,
 *   jamais d'e-mail, jokers LIKE pris au pied de la lettre, route protégée ;
 * - fiche : coffres simples/rares/antiques libellés, « Save V. » remplacé par format de
 *   sauvegarde + révision serveur + date de dernière sauvegarde.
 * Serveur de test sur un port ≠ 3000, base temporaire hors server/data/.
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
const PORT  = process.env.DIG_TEST_PORT_PLAYER_SUGGEST || '3173';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-player-suggest-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db = require('../server/db');
db.initDb();

for (const name of ['Testeur', 'montest', 'test_2', 'testXa', 'autre', 'a%b']) db.createUser(name, `${name.replace('%', '')}@example.test`, 'x');

test('suggestions : saisie partielle, préfixes d\'abord, id + pseudo seulement', () => {
  const r = db.suggestUsers('test');
  assert.deepStrictEqual(r.map(u => u.username), ['test_2', 'Testeur', 'testXa', 'montest']);
  for (const u of r) assert.deepStrictEqual(Object.keys(u).sort(), ['id', 'username'], 'aucun e-mail');
  assert.ok(r.every(u => Number.isInteger(u.id)));
  assert.deepStrictEqual(db.suggestUsers('TEST').map(u => u.id), r.map(u => u.id), 'insensible à la casse');
  assert.deepStrictEqual(db.suggestUsers('  ').length, 0);
  assert.strictEqual(db.suggestUsers('test', 2).length, 2);
});

test('suggestions : jokers % et _ pris au pied de la lettre', () => {
  assert.deepStrictEqual(db.suggestUsers('%').map(u => u.username), ['a%b']);
  assert.deepStrictEqual(db.suggestUsers('t_').map(u => u.username), ['test_2']);
});

test('route /api/admin/players/suggest protégée, sans e-mail ; fiche avec révision', async (t) => {
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, NODE_ENV: 'test', SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: path.join(dir, 'unit.sqlite'),
      ADMIN_SECRET: ADMIN, SESSION_SECRET: crypto.randomBytes(16).toString('hex') },
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
  const call = async (url, { auth = true } = {}) => {
    const res = await fetch(BASE + url, { headers: auth ? { Authorization: `Bearer ${ADMIN}` } : {} });
    return { status: res.status, body: await res.json().catch(() => null), text: res.status };
  };
  assert.strictEqual((await call('/api/admin/players/suggest?q=test', { auth: false })).status, 401);
  const r = await call('/api/admin/players/suggest?q=tes');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.users[0].username, 'test_2');
  assert.ok(!JSON.stringify(r.body).includes('@'), 'aucune adresse e-mail dans les suggestions');
  assert.deepStrictEqual((await call('/api/admin/players/suggest?q=')).body.users, []);

  const uid = r.body.users.find(u => u.username === 'Testeur').id;
  db.upsertUserSave(uid, JSON.stringify({ coins: 5, saveVersion: 16, shopChestsBought: { simple: 1, rare: 2, antique: 3 } }));
  db.upsertUserSave(uid, JSON.stringify({ coins: 6, saveVersion: 16, shopChestsBought: { simple: 1, rare: 2, antique: 3 } }));
  const s = (await call(`/api/admin/players/${uid}/save`)).body.save;
  assert.deepStrictEqual([s.saveVersion, s.revision, s.shopChestsBought.antique], [16, 2, 3]);
  assert.match(s.updatedAt, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
});

test('balisage : combobox accessible, coffres libellés, format / révision / dernière sauvegarde', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');
  assert.match(html, /id="player-search-input"[^>]*role="combobox"[^>]*aria-controls="player-search-suggest"/);
  assert.match(html, /id="player-search-suggest"[^>]*role="listbox"/);
  for (const label of ['Coffres simples achetés', 'Coffres rares achetés', 'Coffres antiques achetés', 'Dernière sauvegarde', 'Révision serveur', 'Format de sauvegarde']) {
    assert.ok(html.includes(label), label);
  }
  assert.ok(!html.includes('Save v.'), 'ancien libellé ambigu retiré');
  const js = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
  assert.match(js, /function attachPlayerAutocomplete\(/);
  assert.match(js, /\/api\/admin\/players\/suggest\?q=/);
  assert.match(js, /onSelect: u => viewPlayerSave\(u\.id, u\.username\)/, 'sélection par identifiant');
});
