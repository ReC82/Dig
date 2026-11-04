/**
 * Images IA des objets souvenirs d'événement, ticket #65 (transport factice : aucun appel réel,
 * aucune dépense ; traitement d'image réel par tools/icons/process.js) :
 * - cibles `event:<événement>/<objet>` de l'atelier pour TOUS les événements (TEST, public en
 *   brouillon), distinctes des objets de collection, fiche préremplie (nom, description, thème, consigne) ;
 * - « Conserver » écrit dans la FICHE de l'événement (révision), jamais dans l'image vue des joueurs ;
 * - publication explicite (« Publier les images » ou planification) ; statut et drops inchangés ;
 * - états sans image / proposition / brouillon / publiée ; souvenir déjà trouvé conservé, emoji en repli ;
 * - images existantes avant #65 conservées comme publiées (migration en ajout seul, idempotente) ;
 * - routes : 401 sans clé admin, cible lisible par l'URL encodée, publication.
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
const PORT  = process.env.DIG_TEST_PORT_EVENT_IMAGES || '3193';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-event-images-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db     = require('../server/db');
const blocks = require('../server/blockCatalog');
const coll   = require('../server/collectionCatalog');
const ev     = require('../server/monthlyEvents');
const studio = require('../server/iconStudio');

db.initDb();
blocks.init();
coll.init();
studio.init();
ev.init();
const conn = () => db.getDb();

const prompts = [];
studio.setFakeTransport({ image: async ({ prompt, target }) => { prompts.push({ prompt, target }); return { png: await studio.fakeIconPng(prompts.length * 41) }; } });

const tx = s => ({ fr: s, en: `${s} EN`, nl: `${s} NL`, es: `${s} ES` });
const item = (id, extra = {}) => ({ id, icon: '🪨', rarity: 'commun', chancePct: 25, minDepth: 0, dropFrom: [], names: tx(`Objet ${id}`), descs: tx(`Il ne sert à rien ${id}`), ...extra });
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const HOUR = 3_600_000;

function user(name) { return conn().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(name, 'x').lastInsertRowid; }
function find(userId, eventId, itemId) {
  conn().prepare('INSERT INTO monthly_event_finds (user_id, event_id, item_id, found_at, depth) VALUES (?,?,?,?,0)').run(userId, eventId, itemId, iso(Date.now()));
}
const souvenir = (userId, eventId, itemId) => ev.publicView(userId).souvenirs.find(s => s.id === eventId)?.items.find(i => i.id === itemId);

const tester = user('ev_img_tester');
ev.createEvent({ id: 'test_img', icon: '🧪', audience: 'test', testers: [tester], names: tx('Événement test'), taglines: tx('t'),
  startsAt: iso(Date.now() - 3 * HOUR), endsAt: iso(Date.now() - HOUR), items: [item('test_caillou'), item('test_boulon', { icon: '🔩' })] });
ev.createEvent({ id: 'noel_img', icon: '🎄', audience: 'public', testers: [], names: tx('Noël'), taglines: tx('n'),
  startsAt: iso(Date.now() + 30 * 24 * HOUR), endsAt: iso(Date.now() + 40 * 24 * HOUR),
  items: [item('noel_charbon', { brief: 'A single glossy lump of black coal tied with a small red ribbon bow.' })] });
find(tester, 'test_img', 'test_caillou');   // « Caillou de test » déjà trouvé, événement TEST en brouillon

test('atelier : objets de tous les événements, clé stable, fiche préremplie, distincts des collections', () => {
  const keys = studio.listTargets().map(t => t.key);
  for (const k of ['event:test_img/test_caillou', 'event:test_img/test_boulon', 'event:noel_img/noel_charbon']) assert.ok(keys.includes(k), k);
  assert.ok(!keys.some(k => k.startsWith('item:test_') || k.startsWith('item:noel_')), 'aucun mélange avec les objets de collection');
  assert.strictEqual(ev.studioKey('noel_img', 'noel_charbon'), 'event:noel_img/noel_charbon');
  const t = studio.getTarget('event:noel_img/noel_charbon');
  assert.strictEqual(t.kind, 'event');
  assert.strictEqual(t.kindLabel, 'Objet d\'événement');
  assert.strictEqual(t.name, 'Objet noel_charbon');
  assert.match(t.extra, /Noël \(public, brouillon\)/);
  assert.strictEqual(t.story, 'Il ne sert à rien noel_charbon', 'description humoristique');
  assert.match(t.brief.subject, /souvenir of the "Noël EN" event/, 'thème');
  assert.strictEqual(t.brief.details, 'A single glossy lump of black coal tied with a small red ribbon bow.', 'consigne spécifique de l\'événement');
  assert.deepStrictEqual(t.event, { id: 'noel_img', itemId: 'noel_charbon', name: 'Noël', state: 'draft', audience: 'public', imageState: 'none' });
  assert.match(t.prompt, /Object to depict: "Objet noel_charbon EN"/);
  // Consigne modifiable, enregistrée pour cette seule cible
  studio.setBrief('event:test_img/test_boulon', { subject: 'A single rusty bolt', details: 'Big hex head.', palette: '' });
  assert.strictEqual(studio.getTarget('event:test_img/test_boulon').brief.subject, 'A single rusty bolt');
  assert.strictEqual(studio.getTarget('event:test_img/test_caillou').brief.custom, false);
  for (const bad of ['event:test_img', 'event:test_img/', 'event:../x/y', 'event:test_img/inconnu']) assert.throws(() => studio.getTarget(bad), e => e.status === 400 || e.status === 404, bad);
  assert.strictEqual(prompts.length, 0, 'aucune image générée sans action');
});

test('une image par action, conservée dans le brouillon, invisible du joueur jusqu\'à la publication', async () => {
  const key = 'event:test_img/test_caillou';
  const job = studio.generate(key, { instruction: 'caillou gris rond' });
  const done = await studio.waitJob();
  assert.ok(job && done.status !== 'error', JSON.stringify(done));
  assert.strictEqual(prompts.length, 1, 'une seule image');
  let t = studio.getTarget(key);
  assert.strictEqual(t.assets.length, 1);
  assert.strictEqual(ev.adminView().events.find(e => e.id === 'test_img').items.find(i => i.id === 'test_caillou').imageState, 'proposal');
  assert.strictEqual(souvenir(tester, 'test_img', 'test_caillou').image, null, 'proposition : emoji pour le joueur');

  const rev = ev.getEvent('test_img').revision;
  const r = studio.apply(key, { sha: t.assets[0].sha });
  assert.deepStrictEqual([r.draft, r.catalog], [true, 'events']);
  const e1 = ev.getEvent('test_img');
  assert.strictEqual(e1.revision, rev + 1, 'révision ajoutée');
  assert.strictEqual(e1.status, 'draft');
  const it = e1.items.find(i => i.id === 'test_caillou');
  assert.strictEqual(it.image, t.assets[0].url);
  assert.strictEqual(ev.imageState(it), 'draft');
  assert.strictEqual(studio.getTarget(key).unpublished, true);
  const s = souvenir(tester, 'test_img', 'test_caillou');
  assert.deepStrictEqual([s.found, s.icon, s.image], [true, '🪨', null], 'souvenir conservé, image du brouillon jamais montrée');

  const p = ev.publishImages('test_img');
  assert.deepStrictEqual(p.published, ['test_caillou']);
  assert.strictEqual(p.event.status, 'draft', 'publier les images ne planifie rien');
  assert.strictEqual(souvenir(tester, 'test_img', 'test_caillou').image, t.assets[0].url);
  t = studio.getTarget(key);
  assert.strictEqual(t.unpublished, false);
  assert.strictEqual(t.assets[0].published, true);
  assert.strictEqual(ev.adminView().events.find(e => e.id === 'test_img').items.find(i => i.id === 'test_caillou').imageState, 'published');
  assert.deepStrictEqual(ev.publishImages('test_img').published, [], 'rien de plus à publier');

  // Retour arrière : emoji dans la fiche, puis publication → emoji pour le joueur ; l'image reste dans l'historique
  studio.apply(key, { sha: null });
  assert.strictEqual(souvenir(tester, 'test_img', 'test_caillou').image, t.assets[0].url, 'avant publication : image publiée inchangée');
  ev.publishImages('test_img');
  assert.strictEqual(souvenir(tester, 'test_img', 'test_caillou').image, null);
  assert.strictEqual(studio.getTarget(key).assets.length, 1, 'historique conservé');
  assert.ok(ev.listLog().some(l => l.action === 'publish_images' && l.eventId === 'test_img'));
  assert.ok(conn().prepare('SELECT COUNT(*) n FROM monthly_event_finds').get().n === 1, 'aucun faux souvenir');
});

test('planifier publie les images de la fiche ; drops et barème inchangés', async () => {
  const key = 'event:test_img/test_boulon';
  const png = await studio.fakeIconPng(120);
  const up = await studio.upload(key, `data:image/png;base64,${png.toString('base64')}`);
  studio.apply(key, { sha: up.sha });
  const before = ev.getEvent('test_img').items.find(i => i.id === 'test_boulon');
  assert.strictEqual(ev.imageState(before), 'draft');
  const live = ev.startTestNow('test_img', { minutes: 30 });
  const after = live.items.find(i => i.id === 'test_boulon');
  assert.strictEqual(after.publishedImage, before.image, 'démarrage = publication explicite');
  assert.deepStrictEqual([after.chancePct, after.dropFrom, after.enabled], [before.chancePct, before.dropFrom, before.enabled]);
  // Événement planifié : seule l'image de la fiche peut encore changer, sans effet joueur avant publication
  studio.apply(key, { sha: null });
  const ev2 = ev.getEvent('test_img');
  assert.strictEqual(ev2.status, 'scheduled', 'reste planifié');
  assert.strictEqual(ev2.items.find(i => i.id === 'test_boulon').publishedImage, before.image);
  assert.throws(() => ev.setItemImage('test_img', 'test_boulon', 'https://evil.example/x.png'), e => e.status === 400);
  ev.unscheduleEvent('test_img');
});

test('Noël reste en brouillon ; images antérieures à #65 conservées comme publiées (migration idempotente)', () => {
  assert.strictEqual(ev.getEvent('noel_img').status, 'draft');
  // Base d'avant #65 : image enregistrée directement sur l'objet, aucune image publiée
  const legacy = '/media/icons/0123456789abcdef.webp';
  conn().prepare("UPDATE monthly_event_items SET image = ? WHERE event_id = 'noel_img'").run(legacy);
  conn().prepare("DELETE FROM monthly_event_meta WHERE key = 'published_images_v1'").run();
  ev.init();
  assert.strictEqual(ev.getEvent('noel_img').items[0].publishedImage, legacy);
  conn().prepare("UPDATE monthly_event_items SET image = NULL WHERE event_id = 'noel_img'").run();
  ev.init();   // déjà migré : rien n'est recopié
  assert.strictEqual(ev.getEvent('noel_img').items[0].publishedImage, legacy);
  assert.strictEqual(ev.imageState(ev.getEvent('noel_img').items[0]), 'draft', 'retrait de l\'image en attente de publication');
});

test('routes : protégées, cible encodée dans l\'URL, publication des images', async (t) => {
  const httpDb = path.join(dir, 'http.sqlite');
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, NODE_ENV: 'test', SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: httpDb, ADMIN_SECRET: ADMIN,
      SESSION_SECRET: crypto.randomBytes(16).toString('hex') },
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
  const call = async (method, url, body, { auth = true } = {}) => {
    const res = await fetch(BASE + url, { method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${ADMIN}` } : {}) } });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const created = await call('POST', '/api/admin/events', { id: 'http_ev', icon: '🧪', audience: 'test', names: tx('H'), taglines: tx('h'),
    startsAt: '2027-01-01T10:00', endsAt: '2027-01-02T10:00', items: [item('http_obj')] });
  assert.strictEqual(created.status, 200, JSON.stringify(created.body));
  const key = encodeURIComponent('event:http_ev/http_obj');
  assert.strictEqual((await call('GET', `/api/admin/icons/targets/${key}`, undefined, { auth: false })).status, 401);
  assert.strictEqual((await call('POST', '/api/admin/events/http_ev/publish-images', {}, { auth: false })).status, 401);
  const tg = await call('GET', `/api/admin/icons/targets/${key}`);
  assert.strictEqual(tg.status, 200, JSON.stringify(tg.body));
  assert.strictEqual(tg.body.target.event.id, 'http_ev');
  const list = await call('GET', '/api/admin/events');
  const it = list.body.events.find(e => e.id === 'http_ev').items[0];
  assert.deepStrictEqual([it.studioKey, it.imageState, it.proposals], ['event:http_ev/http_obj', 'none', 0]);
  const pub = await call('POST', '/api/admin/events/http_ev/publish-images', {});
  assert.deepStrictEqual([pub.status, pub.body.published, pub.body.event.status], [200, [], 'draft']);
  assert.strictEqual((await call('POST', '/api/admin/events/inconnu/publish-images', {})).status, 404);
  assert.strictEqual((await call('POST', `/api/admin/icons/targets/${encodeURIComponent('event:http_ev/absent')}/apply`, {})).status, 404);
});
