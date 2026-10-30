/**
 * Tests de l'atelier d'icônes IA du panel, ticket #40 (transport factice : aucun appel réel,
 * aucune dépense ; traitement d'image RÉEL par tools/icons/process.js) :
 * - inventaire : blocs, objets/reliques, pictogrammes (profil ≠ paramètres), icônes v1 validées verrouillées ;
 * - prompts : gabarit bloc #22 inchangé, gabarits objet/interface, référence de style jointe ;
 * - lot : variantes, coût estimé avant, plafond de l'atelier et quota, journal, provenance ;
 * - téléversement : contrôles (alpha réel, JPEG refusé), normalisation ;
 * - application au BROUILLON seulement (version publiée inchangée), verrou des icônes validées,
 *   historique et retour à l'emoji ; tables en ajout seul ;
 * - routes : 401 sans clé admin, image servie sous /media/icons/<sha>.webp, corps de 4 Mo accepté
 *   seulement après la clé admin.
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
const sharp    = require('sharp');

const ROOT  = path.join(__dirname, '..');
const PORT  = process.env.DIG_TEST_PORT_ICON_STUDIO || '3152';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-icon-studio-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db      = require('../server/db');
const blocks  = require('../server/blockCatalog');
const blockAi = require('../server/blockAi');
const coll    = require('../server/collectionCatalog');
const studio  = require('../server/iconStudio');

db.initDb();
blocks.init();
blockAi.init();
coll.init();
studio.init();
const conn = () => db.getDb();

const prompts = [];
let failNext = false;
studio.setFakeTransport({
  image: async ({ prompt, target }) => {
    prompts.push({ prompt, target });
    if (failNext) { failNext = false; throw new Error('OpenAI 500 server_error : boom sk-proj-abcdefgh1234'); }
    return { png: await studio.fakeIconPng(prompts.length * 37) };
  },
});

test('inventaire : blocs, objets, pictogrammes ; v1 validées verrouillées', () => {
  const list = studio.listTargets();
  const keys = list.map(t => t.key);
  assert.ok(keys.includes('block:pierre') && keys.includes('block:coffre_bois') && keys.includes('block:diamant'));
  assert.ok(keys.includes('item:relic') && keys.includes('item:mystic_orb'));
  assert.ok(keys.includes('ui:profil') && keys.includes('ui:parametres'));
  const pierre = list.find(t => t.key === 'block:pierre');
  assert.strictEqual(pierre.validated.by, 'v1', 'pierre validée (#22) : verrouillée');
  assert.strictEqual(list.find(t => t.key === 'block:diamant').validated.by, 'v1', 'lot v1 validé (30/10) : diamant verrouillé');
  assert.strictEqual(list.find(t => t.key === 'item:relic').state, 'emoji provisoire');
  const ui = studio.UI_TARGETS;
  const profil = ui.find(u => u.id === 'profil'), param = ui.find(u => u.id === 'parametres');
  assert.notStrictEqual(profil.subject, param.subject);
  assert.match(profil.details, /PERSON/);
  assert.match(param.details, /SETTINGS/);
});

test('prompts : gabarit bloc #22 inchangé, objet et interface dans le même style', () => {
  const b = studio.buildPrompt('block', { subject: 'A single irregular gray stone', details: 'D.', palette: 'P.' });
  assert.match(b, /premium stylized 3D low-poly game resource icon/);
  assert.match(b, /only the material changes/);
  const o = studio.buildPrompt('item', { subject: 'A chipped soup vase', details: '', palette: '' });
  assert.match(o, /collectible item icon/);
  assert.match(o, /keep only its visual style, never its shape/);
  assert.match(o, /warm golden-white key light from the upper left/, 'même lumière que les blocs');
  const u = studio.buildPrompt('ui', { subject: 'A gear', details: '', palette: '' });
  assert.match(u, /interface pictogram/);
  assert.match(u, /24 to 32 pixels/);
  assert.doesNotMatch(u, /\{\{/);
});

test('lot : variantes, estimation, provenance, contrôles réels, journal', async () => {
  const before = blocks.getPublished();
  const job = studio.startJob({ targets: ['item:relic', 'block:diamant'], variants: 2 });
  assert.strictEqual(job.total, 4);
  assert.strictEqual(job.estimatedUsd, 0.04);
  assert.throws(() => studio.startJob({ targets: ['item:fossil'] }), e => e.status === 429, 'un lot à la fois');
  const done = await studio.waitJob();
  assert.strictEqual(done.status, 'done', JSON.stringify(done));
  assert.strictEqual(done.items[0].results.length, 2);
  assert.strictEqual(done.spentUsd, 0.04);
  const relic = studio.getTarget('item:relic');
  assert.strictEqual(relic.assets.length, 2);
  const a = relic.assets[0];
  assert.match(a.url, /^\/media\/icons\/[a-f0-9]{16}\.webp$/);
  assert.ok(a.checks.margins.coverage > 0.7 && a.checks.margins.coverage < 0.8, 'marge 12 % appliquée');
  assert.match(a.prompt, /collectible item icon/);
  const img = studio.getImage(a.sha);
  const meta = await sharp(img.bytes).metadata();
  assert.deepStrictEqual([meta.format, meta.width, meta.hasAlpha], ['webp', 256, true]);
  assert.strictEqual(prompts.find(p => p.target === 'block:diamant') && /resource icon/.test(prompts.find(p => p.target === 'block:diamant').prompt), true);
  assert.strictEqual(studio.listCalls().length, 4);
  assert.deepStrictEqual(blocks.getPublished(), before, 'catalogue publié inchangé');
  assert.strictEqual(blocks.getDraft(), null, 'aucun brouillon créé par une génération');
});

test('plafond de l\'atelier, quota, échec journalisé sans secret', async () => {
  studio.setStudioBudget(0.05);       // 0,04 déjà dépensés
  assert.throws(() => studio.startJob({ targets: ['item:fossil'], variants: 2 }), e => e.status === 402 && /Plafond/.test(e.message));
  assert.throws(() => studio.setStudioBudget(-1), e => e.status === 400);
  studio.setStudioBudget(null);
  failNext = true;
  studio.startJob({ targets: ['item:fossil'], variants: 1 });
  const j = await studio.waitJob();
  assert.match(j.items[0].errors[0], /Échec de la génération/);
  assert.doesNotMatch(JSON.stringify(studio.listCalls()), /sk-proj-abcdefgh/, 'clé masquée dans le journal');
  assert.strictEqual(studio.listCalls()[0].ok, false);
  assert.strictEqual(studio.listCalls()[0].cost_usd, 0);
  assert.throws(() => studio.startJob({ targets: ['item:fossil'], variants: 4 }), e => e.status === 400);
  assert.throws(() => studio.startJob({ targets: ['block:inconnu'] }), e => e.status === 404);
});

test('téléversement : alpha réel exigé, JPEG refusé, image normalisée', async () => {
  const jpeg = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#888' } }).jpeg().toBuffer();
  await assert.rejects(studio.upload('item:crystal', jpeg.toString('base64')), e => e.status === 415);
  const flat = await sharp({ create: { width: 300, height: 300, channels: 4, background: { r: 9, g: 9, b: 9, alpha: 1 } } }).png().toBuffer();
  await assert.rejects(studio.upload('item:crystal', `data:image/png;base64,${flat.toString('base64')}`), e => e.status === 422 && /coins non transparents/.test(e.message));
  const good = await studio.fakeIconPng(200);
  const r = await studio.upload('item:crystal', `data:image/png;base64,${good.toString('base64')}`);
  assert.match(r.url, /^\/media\/icons\//);
  const again = await studio.upload('item:crystal', good.toString('base64'));
  assert.strictEqual(again.duplicate, true);
  assert.strictEqual(studio.getTarget('item:crystal').assets[0].source, 'upload');
});

test('application au brouillon seulement, verrou des validées, retour à l\'emoji, ajout seul', () => {
  const pubBlocks = blocks.getPublished(), pubColl = coll.getPublished();
  const relic = studio.getTarget('item:relic');
  const sha = relic.assets[0].sha;
  const r = studio.apply('item:relic', { sha });
  assert.strictEqual(r.catalog, 'collections');
  assert.strictEqual(coll.getDraft().items.find(i => i.id === 'relic').image, `/media/icons/${sha}.webp`);
  assert.deepStrictEqual(coll.getPublished(), pubColl, 'collections publiées inchangées');
  // Retour à l'emoji d'origine
  studio.apply('item:relic', { sha: null });
  assert.strictEqual(coll.getDraft().items.find(i => i.id === 'relic').image, null);
  assert.strictEqual(coll.getDraft().items.find(i => i.id === 'relic').icon, '⚱️');
  // Bloc : brouillon du catalogue, publié inchangé
  const dsha = studio.getTarget('block:diamant').assets[0].sha;
  assert.throws(() => studio.apply('block:diamant', { sha: dsha }), e => e.status === 409, 'v1 validée : accord explicite requis');
  studio.apply('block:diamant', { sha: dsha, override: true });
  assert.strictEqual(blocks.getDraft().types.find(t => t.id === 'diamant').image, `/media/icons/${dsha}.webp`);
  assert.deepStrictEqual(blocks.getPublished(), pubBlocks);
  // Icône validée (v1) : refus sans accord explicite ; image d'une autre cible refusée
  assert.throws(() => studio.apply('block:pierre', { sha: null }), e => e.status === 409 && /validée/.test(e.message));
  assert.throws(() => studio.apply('block:pierre', { sha: dsha, override: true }), e => e.status === 404, 'image d\'une autre icône refusée');
  // Validation dans l'atelier → verrou
  studio.mark('block:diamant', dsha, 'validated');
  assert.throws(() => studio.apply('block:diamant', { sha: null }), e => e.status === 409);
  const ok = studio.apply('block:diamant', { sha: null, override: true });
  assert.strictEqual(ok.target.history[0].details.override, true, 'remplacement d\'une validée tracé');
  // Pictogramme d'interface : stocké, application avec #41
  assert.throws(() => studio.apply('ui:profil', { sha: null }), e => e.status === 409 && /#41/.test(e.message));
  // Ajout seul
  assert.throws(() => conn().prepare('DELETE FROM icon_studio_assets').run(), /ajout seul/);
  assert.throws(() => conn().prepare('UPDATE icon_studio_events SET action = 1').run(), /ajout seul/);
  assert.throws(() => conn().prepare('DELETE FROM icon_studio_calls').run(), /ajout seul/);
  // Le catalogue de blocs accepte l'image de l'atelier ; le jeu l'affiche
  const IconLibrary = require('../public/js/iconLibrary');
  assert.strictEqual(IconLibrary.catalogImage({ image: `/media/icons/${dsha}.webp` }), `/media/icons/${dsha}.webp`);
  assert.strictEqual(IconLibrary.catalogImage({ image: '/media/icons/../x.webp' }), null);
});

test('brief : personnalisé, nettoyé, rétabli', () => {
  const b = studio.setBrief('item:fossil', { subject: 'A small <b>dinosaur</b> bone', details: 'x', palette: 'Palette: bone.' });
  assert.strictEqual(b.subject, 'A small b dinosaur /b bone');
  assert.strictEqual(b.custom, true);
  assert.match(studio.getTarget('item:fossil').prompt, /dinosaur/);
  assert.throws(() => studio.setBrief('item:fossil', { subject: '' }), e => e.status === 400);
  assert.strictEqual(studio.setBrief('item:fossil', { reset: true }).custom, false);
});

test('routes : protégées, image servie, gros corps seulement après la clé admin', async (t) => {
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, DIG_AI_FAKE: '1', NODE_ENV: 'test', SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: path.join(dir, 'http.sqlite'),
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
  assert.ok(up, log);
  const H = { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' };
  assert.strictEqual((await fetch(`${BASE}/api/admin/icons`)).status, 401);
  const big = JSON.stringify({ data: 'A'.repeat(2 * 1024 * 1024) });
  const anon = await fetch(`${BASE}/api/admin/icons/targets/item:relic/upload`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: big });
  assert.strictEqual(anon.status, 401, 'corps lourd refusé avant lecture sans clé');
  assert.strictEqual((await fetch(`${BASE}/api/admin/icons/budget`, { method: 'PUT', headers: H, body: JSON.stringify({ studioBudgetUsd: 'x'.repeat(600 * 1024) }) })).status, 413,
    'limite de 512 Ko conservée ailleurs');

  const ov = await (await fetch(`${BASE}/api/admin/icons`, { headers: H })).json();
  assert.strictEqual(ov.status.configured, true);
  assert.strictEqual(ov.status.fake, true);
  assert.ok(ov.targets.length >= 14 + 8 + 8);
  assert.ok(ov.references.some(r => r.id === 'pierre'));

  const png = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><circle cx="512" cy="512" r="380" fill="#c08040"/></svg>')).png().toBuffer();
  const up1 = await fetch(`${BASE}/api/admin/icons/targets/item:relic/upload`, { method: 'POST', headers: H, body: JSON.stringify({ data: png.toString('base64') }) });
  const u = await up1.json();
  assert.strictEqual(up1.status, 200, JSON.stringify(u));
  const img = await fetch(`${BASE}${u.url}`);
  assert.strictEqual(img.status, 200);
  assert.strictEqual(img.headers.get('content-type'), 'image/webp');
  assert.match(img.headers.get('cache-control'), /immutable/);
  assert.strictEqual((await fetch(`${BASE}/media/icons/0000000000000000.webp`)).status, 404);

  const job = await (await fetch(`${BASE}/api/admin/icons/jobs`, { method: 'POST', headers: H, body: JSON.stringify({ targets: ['ui:parametres'], variants: 1 }) })).json();
  assert.strictEqual(job.job.total, 1);
  let j;
  for (let i = 0; i < 100; i++) {
    j = (await (await fetch(`${BASE}/api/admin/icons/job`, { headers: H })).json()).job;
    if (j.status !== 'running') break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.strictEqual(j.status, 'done', JSON.stringify(j));
  const ap = await fetch(`${BASE}/api/admin/icons/targets/item:relic/apply`, { method: 'POST', headers: H, body: JSON.stringify({ sha: u.sha }) });
  assert.strictEqual(ap.status, 200);
  const pub = await (await fetch(`${BASE}/api/collections/catalog`)).json();
  assert.strictEqual(pub.items.find(i => i.id === 'relic').image, null, 'rien de publié pour les joueurs');
  const bad = await fetch(`${BASE}/api/admin/icons/targets/..%2Fx/apply`, { method: 'POST', headers: H, body: '{}' });
  assert.strictEqual(bad.status, 400);
});

test.after(() => {
  try { db.getDb().close(); } catch (_) { /* déjà fermée */ }
  fs.rmSync(dir, { recursive: true, force: true });
});
