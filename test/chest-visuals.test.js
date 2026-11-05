/**
 * Tests des visuels des six coffres dans l'atelier d'icônes, ticket #66 (aucun appel IA : transport
 * factice ; images factices insérées directement dans la table des images, base isolée) :
 * - six cibles stables et nommées : chest:simple|rare|antique (boutique), block:vieille_caisse|coffre_bois|
 *   coffre_fer (minage), consigne préremplie et style commun de l'atelier (gabarit objet + référence) ;
 * - boutique : génération ≠ application, accord « live » obligatoire, retour arrière A → B → A → emoji,
 *   historique, images jamais supprimées, servi au jeu sous chest_<id> seulement après application ;
 * - minage : « Conserver » va au BROUILLON du catalogue de blocs, version publiée inchangée ;
 * - aucune modification des tables de récompenses, prix ou probabilités ;
 * - raccordement : jeu (carte de la boutique, fenêtre d'ouverture), panel (Coffres & drops → atelier).
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
const PORT  = process.env.DIG_TEST_PORT_CHEST_VISUALS || '3197';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-chest-visuals-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db      = require('../server/db');
const blocks  = require('../server/blockCatalog');
const blockAi = require('../server/blockAi');
const coll    = require('../server/collectionCatalog');
const rewards = require('../server/rewardTables');
const studio  = require('../server/iconStudio');
const { CHEST_TARGETS, SHOP_CHEST_VISUALS } = require('../server/chestVisuals');

db.initDb();
blocks.init();
blockAi.init();
coll.init();
rewards.init();
studio.init();
const conn = () => db.getDb();
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const prompts = [];
studio.setFakeTransport({ image: async ({ prompt, target }) => { prompts.push({ prompt, target }); return { png: await studio.fakeIconPng(prompts.length * 53) }; } });

let _n = 0;
function fakeAsset(target) {
  const sha = crypto.createHash('sha256').update(`chest66-${++_n}`).digest('hex').slice(0, 16);
  conn().prepare("INSERT INTO icon_studio_assets (sha, target, source, mime, bytes, meta) VALUES (?, ?, 'upload', 'image/webp', x'00', '{}')").run(sha, target);
  return sha;
}
const url = sha => `/media/icons/${sha}.webp`;
const rewardSnapshot = () => JSON.stringify(rewards.getPublished?.() ?? conn().prepare('SELECT * FROM reward_table_versions ORDER BY version').all());

test('six cibles stables et nommées, présentes dans l\'atelier', () => {
  assert.deepStrictEqual(CHEST_TARGETS.map(c => c.key),
    ['chest:simple', 'chest:rare', 'chest:antique', 'block:vieille_caisse', 'block:coffre_bois', 'block:coffre_fer']);
  assert.deepStrictEqual(CHEST_TARGETS.filter(c => c.family === 'mined').map(c => c.id), ['commun', 'rare', 'epique'], 'raretés des tables #37');
  const keys = studio.listTargets().map(t => t.key);
  for (const c of CHEST_TARGETS) assert.ok(keys.includes(c.key), `cible de l'atelier : ${c.key}`);
  const list = studio.chestTargets();
  assert.strictEqual(list.length, 6);
  for (const c of list) assert.ok(c.target && !c.error, c.key);
  const simple = list[0].target;
  assert.deepStrictEqual([simple.kind, simple.kindLabel, simple.name, simple.emoji, simple.image, simple.gameIconId, simple.applicable],
    ['chest', 'Coffre de boutique', 'Coffre simple', '📦', null, 'chest_simple', true]);
  // Emojis d'origine = ceux du jeu (public/js/balance.js)
  const balance = read('public/js/balance.js');
  for (const c of SHOP_CHEST_VISUALS) assert.match(balance, new RegExp(`id:\\s+'${c.id}',\\s+icon:\\s+'${c.emoji}'`));
});

test('consigne préremplie et style commun de l\'atelier (gabarit objet, référence pierre, nom du coffre)', () => {
  const t = studio.getTarget('chest:antique');
  assert.strictEqual(t.brief.custom, false);
  assert.match(t.brief.subject, /ancient ornate closed treasure chest/);
  assert.match(t.prompt, /^Object to depict: "Antique chest" \(French name: "Coffre antique"\)/);
  assert.strictEqual(t.prompt, studio.buildPrompt('item', t.brief, '', { name: 'Antique chest', fr: 'Coffre antique' }), 'même gabarit que les objets');
  assert.match(t.promptSummary.style, /Rendu 3D low-poly/);
  // Consigne corrigible, puis retour à la consigne par défaut
  studio.setBrief('chest:antique', { subject: 'A very old bronze chest', details: 'domed lid', palette: '' });
  assert.match(studio.getTarget('chest:antique').prompt, /A very old bronze chest/);
  studio.setBrief('chest:antique', { reset: true });
  assert.strictEqual(studio.getTarget('chest:antique').brief.custom, false);
  // Coffre miné : consigne du bloc (gabarit #22 inchangé)
  const fer = studio.getTarget('block:coffre_fer');
  assert.strictEqual(fer.kind, 'block');
  assert.ok(fer.prompt.length > 50);
});

test('boutique : une image par clic, jamais appliquée seule ; live obligatoire ; A → B → A → emoji', async () => {
  const before = rewardSnapshot();
  const blocksPub = JSON.stringify(blocks.getPublished());
  studio.generate('chest:rare');
  const job = await studio.waitJob();
  assert.strictEqual(job.status, 'done', job.error);
  assert.strictEqual(prompts.length, 1, 'une seule image');
  assert.match(prompts[0].prompt, /Object to depict: "Rare chest"/);
  assert.deepStrictEqual(studio.uiIconMap().icons, {}, 'proposition jamais appliquée automatiquement');
  // « Refaire » ciblé : nouvelle proposition, l'ancienne conservée
  studio.generate('chest:rare', { instruction: 'gemme plus grosse', basedOn: job.result.sha });
  const job2 = await studio.waitJob();
  assert.strictEqual(job2.status, 'done', job2.error);
  assert.strictEqual(studio.getTarget('chest:rare').assets.length, 2);

  const A = fakeAsset('chest:rare'), B = fakeAsset('chest:rare');
  assert.throws(() => studio.apply('chest:rare', { sha: A }), e => e.status === 409 && e.details?.code === 'live_required');
  assert.throws(() => studio.apply('chest:rare', { sha: fakeAsset('chest:simple'), live: true }), e => e.status === 404, 'image d\'un autre coffre refusée');
  assert.throws(() => studio.apply('chest:rare', { sha: fakeAsset('ui:collection'), live: true }), e => e.status === 404, 'pas de réutilisation des pictogrammes');
  const r1 = studio.apply('chest:rare', { sha: A, live: true });
  assert.strictEqual(r1.catalog, 'chests');
  assert.strictEqual(r1.draft, false);
  assert.deepStrictEqual(studio.uiIconMap().icons, { chest_rare: url(A) });
  studio.apply('chest:rare', { sha: B, live: true });
  assert.deepStrictEqual(studio.uiIconMap().icons, { chest_rare: url(B) });
  let t = studio.getTarget('chest:rare');
  assert.strictEqual(t.image, url(B));
  assert.strictEqual(t.publishedImage, url(B));
  assert.strictEqual(t.unpublished, false, 'pas de brouillon : appliquée = en jeu');
  const last = t.history.find(h => h.action === 'applied');
  assert.deepStrictEqual([last.details.before, last.details.after, last.details.live], [url(A), url(B), true]);
  assert.ok(t.assets.find(a => a.sha === B).published && !t.assets.find(a => a.sha === A).published);
  studio.apply('chest:rare', { sha: A, live: true });                       // « Revenir à l'icône précédente »
  assert.deepStrictEqual(studio.uiIconMap().icons, { chest_rare: url(A) });
  assert.throws(() => studio.apply('chest:rare', { sha: A, live: true }), e => e.status === 409, 'déjà en jeu');
  studio.apply('chest:rare', { sha: null, live: true });                    // « Revenir à l'emoji d'origine »
  assert.deepStrictEqual(studio.uiIconMap().icons, {});
  t = studio.getTarget('chest:rare');
  assert.strictEqual(t.image, null);
  assert.strictEqual(t.emoji, '💎');
  assert.strictEqual(t.assets.length, 4, 'aucune image supprimée');
  assert.deepStrictEqual(t.history.filter(h => h.action === 'applied' || h.action === 'reverted_to_emoji').map(h => h.action),
    ['reverted_to_emoji', 'applied', 'applied', 'applied']);
  // Verrou : image validée remplacée seulement avec accord explicite
  studio.apply('chest:rare', { sha: A, live: true });
  studio.mark('chest:rare', A, 'validated');
  assert.throws(() => studio.apply('chest:rare', { sha: B, live: true }), e => e.status === 409 && /validée/.test(e.message));
  studio.apply('chest:rare', { sha: B, live: true, override: true });
  studio.apply('chest:rare', { sha: null, live: true, override: true });
  // Rien d'autre n'a bougé : tables de récompenses, prix, catalogue de blocs publié
  assert.strictEqual(rewardSnapshot(), before);
  assert.strictEqual(JSON.stringify(blocks.getPublished()), blocksPub);
  assert.deepStrictEqual(studio.uiIconMap().icons, {});
});

test('minage : « Conserver » va au brouillon des blocs, version publiée et tables inchangées', () => {
  const before = rewardSnapshot();
  const pub = JSON.stringify(blocks.getPublished());
  const sha = fakeAsset('block:coffre_bois');
  // Image v1 validée (#22) : verrouillée, remplacée seulement avec accord explicite
  assert.strictEqual(studio.getTarget('block:coffre_bois').validated.by, 'v1');
  assert.throws(() => studio.apply('block:coffre_bois', { sha }), e => e.status === 409 && /validée/.test(e.message));
  const r = studio.apply('block:coffre_bois', { sha, override: true });
  assert.deepStrictEqual([r.catalog, r.draft], ['blocks', true]);
  assert.strictEqual(JSON.stringify(blocks.getPublished()), pub, 'jeu inchangé avant publication');
  const v = studio.chestTargets().find(c => c.key === 'block:coffre_bois').target;
  assert.deepStrictEqual([v.image, v.publishedImage ?? null, v.unpublished], [url(sha), null, true]);
  studio.apply('block:coffre_bois', { sha: null, override: true });
  assert.strictEqual(rewardSnapshot(), before);
  assert.deepStrictEqual(studio.uiIconMap().icons, {}, 'un bloc coffre n\'est jamais servi comme pictogramme');
});

test('raccordement jeu et panel', () => {
  const main = read('public/js/main.js');
  assert.match(main, /<span class="shop-chest-icon">\$\{UiIcons\.html\(`chest_\$\{def\.id\}`, def\.icon\)\}<\/span>/);
  assert.match(main, /iconEl\.innerHTML\s+= UiIcons\.html\(`chest_\$\{def\.id\}`, def\.icon\)/);
  assert.match(main, /IconLibrary\.render\(iconEl, chestType\)/, 'coffre miné : image du catalogue de blocs');
  const UiIcons = require('../public/js/uiIcons.js');
  assert.strictEqual(UiIcons.html('chest_simple', '📦'), '📦', 'sans image : emoji d\'origine');
  assert.deepStrictEqual(UiIcons._parsePreview('?uiicon=chest_rare:0123456789abcdef'), { chest_rare: '/media/icons/0123456789abcdef.webp' });
  const html = read('public/admin/index.html'), admin = read('public/admin/admin.js');
  assert.match(html, /id="rw-visuals-card"[\s\S]*id="rw-visuals"/);
  assert.match(html, /<option value="chest">Coffres de boutique<\/option>/);
  assert.match(admin, /api\('GET', '\/api\/admin\/icons\/chests'\)/);
  assert.match(admin, /_icFrom = \{ kind: 'rewards', key \};\s+icOpen\(key\);/);
  assert.match(admin, /← Retour à Coffres & drops/);
  assert.match(admin, /t\.kind === 'ui' \|\| t\.kind === 'chest'\) icUiActions/);
  assert.match(admin, /uiicon=\$\{encodeURIComponent\(t\.gameIconId \?\? t\.id\)\}/);
});

test('routes : 401 sans session admin, liste des six coffres, application servie au jeu', async t => {
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
  assert.strictEqual((await fetch(`${BASE}/api/admin/icons/chests`)).status, 401);
  const H = { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' };
  const list = await (await fetch(`${BASE}/api/admin/icons/chests`, { headers: H })).json();
  assert.deepStrictEqual(list.chests.map(c => [c.key, !!c.target]), CHEST_TARGETS.map(c => [c.key, true]));
  const chests0 = await (await fetch(`${BASE}/api/shop/chests`)).text();
  const sharp = require('sharp');
  const png = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect x="200" y="300" width="620" height="440" rx="30" fill="#8a5a2b"/></svg>')).png().toBuffer();
  const up1 = await (await fetch(`${BASE}/api/admin/icons/targets/chest:simple/upload`, { method: 'POST', headers: H, body: JSON.stringify({ data: png.toString('base64') }) })).json();
  assert.ok(up1.sha, JSON.stringify(up1));
  assert.deepStrictEqual((await (await fetch(`${BASE}/api/ui-icons`)).json()).icons, {}, 'téléversée ≠ appliquée');
  assert.strictEqual((await fetch(`${BASE}/api/admin/icons/targets/chest:simple/apply`, { method: 'POST', headers: H, body: JSON.stringify({ sha: up1.sha }) })).status, 409);
  assert.strictEqual((await fetch(`${BASE}/api/admin/icons/targets/chest:simple/apply`, { method: 'POST', headers: H, body: JSON.stringify({ sha: up1.sha, live: true }) })).status, 200);
  assert.deepStrictEqual((await (await fetch(`${BASE}/api/ui-icons`)).json()).icons, { chest_simple: up1.url });
  await fetch(`${BASE}/api/admin/icons/targets/chest:simple/apply`, { method: 'POST', headers: H, body: JSON.stringify({ sha: null, live: true }) });
  assert.deepStrictEqual((await (await fetch(`${BASE}/api/ui-icons`)).json()).icons, {});
  assert.strictEqual(await (await fetch(`${BASE}/api/shop/chests`)).text(), chests0, 'tables et prix servis au jeu inchangés');
});

test.after(() => { try { db.getDb().close(); } catch (_) {} fs.rmSync(dir, { recursive: true, force: true }); });
