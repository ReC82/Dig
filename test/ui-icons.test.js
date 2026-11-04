/**
 * Tests des pictogrammes d'interface appliqués depuis l'atelier d'icônes, ticket #67 (aucun appel IA :
 * transport factice ; images factices insérées directement dans la table des images) :
 * - registre : identifiants stables et uniques, zones, emplacements, raccordement réel dans le jeu ;
 * - prompt : nom exact (« Collection ») et emplacement dans le jeu transmis à l'IA (ui-v1.2) ;
 * - application : jamais automatique (génération ≠ application), accord « live » obligatoire, logo
 *   stockable seulement, réutilisation de l'image d'un autre pictogramme, retour arrière A → B → A →
 *   origine, historique, images jamais supprimées, catalogues publiés inchangés ;
 * - jeu : GET /api/ui-icons sans cache, module client (repli emoji, aperçu ?uiicon=, URL filtrées).
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
const PORT  = process.env.DIG_TEST_PORT_UI_ICONS || '3196';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-ui-icons-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db      = require('../server/db');
const blocks  = require('../server/blockCatalog');
const blockAi = require('../server/blockAi');
const coll    = require('../server/collectionCatalog');
const studio  = require('../server/iconStudio');
const { UI_TARGETS, ZONES } = require('../server/uiIcons');
const UiIcons = require('../public/js/uiIcons.js');

db.initDb();
blocks.init();
blockAi.init();
coll.init();
studio.init();
const conn = () => db.getDb();
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const prompts = [];
studio.setFakeTransport({ image: async ({ prompt, target }) => { prompts.push({ prompt, target }); return { png: await studio.fakeIconPng(prompts.length * 41) }; } });

let _n = 0;
/** Image factice rattachée à `target` (aucune génération, aucun traitement). */
function fakeAsset(target, meta = {}) {
  const sha = crypto.createHash('sha256').update(`ui67-${++_n}`).digest('hex').slice(0, 16);
  conn().prepare("INSERT INTO icon_studio_assets (sha, target, source, mime, bytes, meta) VALUES (?, ?, 'ai', 'image/webp', x'00', ?)").run(sha, target, JSON.stringify(meta));
  return sha;
}
const url = sha => `/media/icons/${sha}.webp`;

test('registre : identifiants stables et uniques, zones, ids existants conservés', () => {
  const ids = UI_TARGETS.map(u => u.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'identifiants uniques');
  for (const id of ['profil', 'parametres', 'ameliorations', 'creuser', 'collection', 'quotidien', 'boutique', 'logo', 'saison']) {
    assert.ok(ids.includes(id), `identifiant historique conservé : ${id} (images déjà générées)`);
  }
  for (const u of UI_TARGETS) {
    assert.match(u.id, /^[a-z][a-z0-9_]{1,39}$/);
    assert.ok(ZONES[u.zone], `zone connue pour ${u.id}`);
    assert.ok(u.emoji && u.name && u.en && u.where && u.context && u.subject, `fiche complète : ${u.id}`);
  }
  assert.strictEqual(UI_TARGETS.find(u => u.id === 'logo').deployable, false, 'logo (#41) : stockage seulement');
  assert.ok(UI_TARGETS.filter(u => u.deployable).length >= 24, 'inventaire étendu (navigation, en-tête, monnaies, classement, améliorations, objectifs)');
  const keys = studio.listTargets().filter(t => t.kind === 'ui');
  assert.strictEqual(keys.length, UI_TARGETS.length);
  const col = keys.find(t => t.key === 'ui:collection');
  assert.deepStrictEqual([col.zone, col.deployable, col.applicable, col.image], ['nav', true, true, null]);
});

test('raccordement : chaque pictogramme déployable est lu par le jeu au bon endroit (aucune cible orpheline)', () => {
  const html = read('public/index.html');
  const main = read('public/js/main.js');
  const upgrades = read('public/js/upgrades.js'), quests = read('public/js/quests.js'), missions = read('public/js/dailyMissions.js');
  for (const u of UI_TARGETS.filter(x => x.deployable)) {
    let wired;
    if (u.zone === 'nav' || u.zone === 'header') wired = new RegExp(`data-ui-icon="${u.id}"`).test(html);
    else if (u.zone === 'upgrades') wired = /UiIcons\.html\(`upgrade_\$\{def\.id\}`/.test(main) && upgrades.includes(`id: '${u.id.slice(8)}'`);
    else if (u.zone === 'quests') wired = /UiIcons\.html\(`quete_\$\{def\.id\}`/.test(main) && quests.includes(`id: '${u.id.slice(6)}'`);
    else wired = main.includes(`'${u.id}'`);
    assert.ok(wired, `pictogramme raccordé au jeu : ${u.id}`);
  }
  // Missions du jour : emblèmes du catalogue #68 (mission:<id>), lus par le jeu sous mission_<id>, sans doublon ui:
  assert.ok(!UI_TARGETS.some(u => u.id.startsWith('mission_')), 'pas de cible ui:mission_* (doublon de #68)');
  assert.match(main, /UiIcons\.html\(`mission_\$\{def\.id\}`/);
  for (const id of ['break_blocks', 'earn_coins', 'open_chests', 'buy_upgrades', 'find_gems', 'depth_gain']) assert.ok(missions.includes(`id: '${id}'`));
  // Emplacements exacts : la cible Collection est l'onglet de navigation, pas un objet de collection
  assert.match(html, /data-view="collection"[\s\S]{0,200}<span class="nav-icon" data-ui-icon="collection">📦<\/span>/);
  assert.match(html, /id="btn-account"[\s\S]{0,400}data-ui-icon="profil"/);
  assert.match(html, /id="btn-settings"[\s\S]{0,400}data-ui-icon="parametres"/);
  assert.match(html, /<script src="js\/uiIcons\.js"><\/script>[\s\S]*<script src="js\/main\.js">/);
  // Logo et images de blocs : jamais touchés par ce module
  assert.doesNotMatch(html, /id="game-logo"[^>]*data-ui-icon/);
  assert.doesNotMatch(read('public/js/uiIcons.js'), /game-logo|IconLibrary|block-/);
});

test('prompt : nom exact « Collection » et emplacement dans le jeu transmis à l\'IA', async () => {
  const t = studio.getTarget('ui:collection');
  assert.match(t.prompt, /^Interface pictogram to depict: "Collection" \(French label: "Collection"\), the "Collection" tab button of the bottom navigation bar/);
  assert.match(t.prompt, /collection of found objects/);
  assert.match(t.promptSummary.object, /Collection \(onglet « Collection » de la barre du bas\)/);
  const before = studio.uiIconMap();
  studio.generate('ui:collection');
  const job = await studio.waitJob();
  assert.strictEqual(job.status, 'done', job.error);
  assert.match(prompts.at(-1).prompt, /Interface pictogram to depict: "Collection"/);
  const after = studio.getTarget('ui:collection');
  const a = after.assets.find(x => x.sha === job.result.sha);
  assert.strictEqual(a.promptVersion, studio.UI_PROMPT_VERSION);
  assert.ok(a.currentPrompt);
  assert.strictEqual(a.uiTarget.name, 'Collection');
  // Une proposition n'est JAMAIS appliquée automatiquement
  assert.deepStrictEqual(studio.uiIconMap(), before);
  assert.strictEqual(after.image, null);
  assert.strictEqual(a.published, false);
  // Ancienne proposition (prompt v1.1, sans nom) : conservée, signalée comme ancienne version
  const old = fakeAsset('ui:collection', { kind: 'ui', promptVersion: 'v1.1', prompt: 'old' });
  const o = studio.getTarget('ui:collection').assets.find(x => x.sha === old);
  assert.strictEqual(o.currentPrompt, false);
});

test('application : accord « live » obligatoire, retour arrière A → B → A → origine, historique', () => {
  const pubBlocks = JSON.stringify(blocks.getPublished()), pubColl = JSON.stringify(coll.getPublished());
  const A = fakeAsset('ui:medaille_or'), B = fakeAsset('ui:medaille_or');
  assert.throws(() => studio.apply('ui:medaille_or', { sha: A }), e => e.status === 409 && e.details?.code === 'live_required');
  assert.strictEqual(studio.uiIconMap().icons.medaille_or, undefined, 'rien appliqué sans accord');

  const r1 = studio.apply('ui:medaille_or', { sha: A, live: true });
  assert.deepStrictEqual([r1.catalog, r1.draft, r1.target.image, r1.target.unpublished], ['ui', false, url(A), false]);
  assert.strictEqual(studio.uiIconMap().icons.medaille_or, url(A));
  assert.throws(() => studio.apply('ui:medaille_or', { sha: A, live: true }), e => e.status === 409, 'déjà en jeu');
  studio.apply('ui:medaille_or', { sha: B, live: true });
  assert.strictEqual(studio.uiIconMap().icons.medaille_or, url(B));
  const last = studio.getTarget('ui:medaille_or').history.find(h => h.action === 'applied');
  assert.deepStrictEqual([last.details.before, last.details.after, last.details.live], [url(A), url(B), true]);
  // « Revenir à l'icône précédente » = application de l'image d'avant
  studio.apply('ui:medaille_or', { sha: A, live: true });
  assert.strictEqual(studio.uiIconMap().icons.medaille_or, url(A));
  // « Revenir au pictogramme d'origine »
  studio.apply('ui:medaille_or', { sha: null, live: true });
  assert.strictEqual(studio.uiIconMap().icons.medaille_or, undefined);
  const t = studio.getTarget('ui:medaille_or');
  assert.strictEqual(t.image, null);
  assert.deepStrictEqual(t.history.filter(h => ['applied', 'reverted_to_emoji'].includes(h.action)).map(h => h.action),
    ['reverted_to_emoji', 'applied', 'applied', 'applied']);
  assert.strictEqual(t.assets.length, 2, 'aucune image supprimée');
  // Les autres pictogrammes et les catalogues publiés ne changent pas
  assert.strictEqual(studio.uiIconMap().icons.collection, undefined);
  assert.strictEqual(JSON.stringify(blocks.getPublished()), pubBlocks);
  assert.strictEqual(JSON.stringify(coll.getPublished()), pubColl);
  assert.throws(() => db.getDb().prepare("DELETE FROM icon_studio_events WHERE target = 'ui:medaille_or'").run(), /ajout seul/);
});

test('réutilisation : l\'image d\'un autre pictogramme sans nouvelle génération ; image d\'une autre famille refusée', () => {
  const n = prompts.length;
  const C = fakeAsset('ui:medaille_argent');
  const t = studio.getTarget('ui:quete_find_gem');
  assert.ok(t.reusable.some(r => r.sha === C && r.target === 'ui:medaille_argent'));
  const r = studio.apply('ui:quete_find_gem', { sha: C, live: true });
  assert.strictEqual(r.target.image, url(C));
  assert.strictEqual(r.target.history[0].details.reusedFrom, 'ui:medaille_argent');
  assert.strictEqual(studio.uiIconMap().icons.medaille_argent, undefined, 'la source n\'est pas appliquée pour autant');
  const item = fakeAsset('item:relic');
  assert.throws(() => studio.apply('ui:quete_find_gem', { sha: item, live: true }), e => e.status === 404);
  assert.strictEqual(prompts.length, n, 'aucune génération');
  studio.apply('ui:quete_find_gem', { sha: null, live: true });
});

test('logo : stockage seulement, jamais appliqué ; message à jour (plus de renvoi à #41 clôturé pour les pictogrammes)', () => {
  const L = fakeAsset('ui:logo');
  assert.throws(() => studio.apply('ui:logo', { sha: L, live: true }), e => e.status === 409 && /stockée ici/.test(e.message));
  assert.strictEqual(studio.uiIconMap().icons.logo, undefined);
  const admin = read('public/admin/admin.js');
  assert.doesNotMatch(admin, /viendra avec le logo et la navigation \(#41\)/);
  assert.match(admin, /Appliquer cette image dans le jeu…/);
  assert.match(admin, /Revenir à l\\'icône précédente/);
  assert.match(admin, /Prévisualiser dans le jeu ↗/);
});

test('client : repli emoji, URL filtrées, aperçu ?uiicon= non mémorisé', () => {
  assert.strictEqual(UiIcons.html('collection', '📦'), '📦');
  assert.strictEqual(UiIcons.html('x', '<b>'), '&lt;b&gt;');
  assert.deepStrictEqual(UiIcons._clean({ collection: '/media/icons/0123456789abcdef.webp', a: 'javascript:alert(1)', 'B!': '/media/icons/0123456789abcdef.webp', saison: 'https://evil/x.webp' }),
    { collection: '/media/icons/0123456789abcdef.webp' });
  assert.deepStrictEqual(UiIcons._parsePreview('?uiicon=collection:0123456789abcdef,bad:zz,medaille_or:fedcba9876543210'),
    { collection: '/media/icons/0123456789abcdef.webp', medaille_or: '/media/icons/fedcba9876543210.webp' });
  const src = read('public/js/uiIcons.js');
  assert.match(src, /cache: 'no-store'/);
  assert.doesNotMatch(src, /setItem\([^)]*preview/, 'aperçu jamais mémorisé');
});

test('route publique GET /api/ui-icons : sans cache, seulement les pictogrammes appliqués', async (t) => {
  const httpDb = path.join(dir, 'http.sqlite');
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, DIG_AI_FAKE: '1', NODE_ENV: 'test', SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: httpDb,
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
  const r0 = await fetch(`${BASE}/api/ui-icons`);
  assert.strictEqual(r0.status, 200);
  assert.strictEqual(r0.headers.get('cache-control'), 'no-store');
  assert.deepStrictEqual((await r0.json()).icons, {});
  const H = { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' };
  // Image téléversée pour « Collection », puis application confirmée par la route du panel
  const sharp = require('sharp');
  const png = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect x="200" y="260" width="620" height="500" rx="40" fill="#a0602a"/></svg>')).png().toBuffer();
  const up1 = await (await fetch(`${BASE}/api/admin/icons/targets/ui:collection/upload`, { method: 'POST', headers: H, body: JSON.stringify({ data: png.toString('base64') }) })).json();
  assert.ok(up1.sha, JSON.stringify(up1));
  const refused = await fetch(`${BASE}/api/admin/icons/targets/ui:collection/apply`, { method: 'POST', headers: H, body: JSON.stringify({ sha: up1.sha }) });
  assert.strictEqual(refused.status, 409);
  assert.strictEqual((await fetch(`${BASE}/api/admin/icons/targets/ui:collection/apply`, { method: 'POST', body: JSON.stringify({ sha: up1.sha, live: true }) })).status, 401);
  const ok = await fetch(`${BASE}/api/admin/icons/targets/ui:collection/apply`, { method: 'POST', headers: H, body: JSON.stringify({ sha: up1.sha, live: true }) });
  assert.strictEqual(ok.status, 200);
  const map = await (await fetch(`${BASE}/api/ui-icons`)).json();
  assert.deepStrictEqual(map.icons, { collection: up1.url });
  assert.match(map.rev, /^[a-f0-9]{12}$/);
  assert.strictEqual((await fetch(`${BASE}${up1.url}`)).status, 200);
  // Retour au pictogramme d'origine : la liste servie au jeu redevient vide
  await fetch(`${BASE}/api/admin/icons/targets/ui:collection/apply`, { method: 'POST', headers: H, body: JSON.stringify({ sha: null, live: true }) });
  assert.deepStrictEqual((await (await fetch(`${BASE}/api/ui-icons`)).json()).icons, {});
});

test('missions du jour (#68) : emblème publié servi au jeu seulement quand le catalogue est actif en jeu', () => {
  const missionCatalog = require('../server/missionCatalog');
  const orig = { isLive: missionCatalog.isLive, getPublished: missionCatalog.getPublished };
  const img = url(fakeAsset('mission:break_blocks'));
  const withImg = { missions: [{ id: 'break_blocks', icon: '⛏', image: img }, { id: 'earn_coins', icon: '💰', image: null }] };
  try {
    missionCatalog.getPublished = () => withImg;
    assert.strictEqual(studio.uiIconMap().icons.mission_break_blocks, undefined, 'catalogue #68 inactif en jeu : rien ne change pour les joueurs');
    missionCatalog.isLive = () => true;
    assert.strictEqual(studio.uiIconMap().icons.mission_break_blocks, img);
    assert.strictEqual(studio.uiIconMap().icons.mission_earn_coins, undefined, 'sans image : emoji d\'origine');
  } finally { Object.assign(missionCatalog, orig); }
  assert.strictEqual(studio.uiIconMap().icons.mission_break_blocks, undefined);
});
