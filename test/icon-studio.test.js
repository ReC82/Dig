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

test('génération : une image par action, consigne « Refaire », provenance, contrôles réels, journal', async () => {
  const before = blocks.getPublished();
  const job = studio.generate('item:relic');
  assert.strictEqual(job.estimatedUsd, 0.01);
  assert.strictEqual(job.target, 'item:relic');
  assert.throws(() => studio.generate('item:fossil'), e => e.status === 429, 'une génération à la fois');
  let done = await studio.waitJob();
  assert.strictEqual(done.status, 'done', JSON.stringify(done));
  assert.match(done.result.url, /^\/media\/icons\/[a-f0-9]{16}\.webp$/);
  assert.strictEqual(done.spentUsd, 0.01);
  const first = done.result.sha;
  // « Refaire » : nouvelle proposition, l'ancienne est conservée ; la consigne entre dans le prompt
  studio.generate('item:relic', { instruction: 'plus sombre <b>', basedOn: first });
  done = await studio.waitJob();
  assert.strictEqual(done.status, 'done', JSON.stringify(done));
  assert.strictEqual(done.instruction, 'plus sombre b');
  const relic = studio.getTarget('item:relic');
  assert.strictEqual(relic.assets.length, 2, 'aucune proposition écrasée');
  const a = relic.assets.find(x => x.sha === done.result.sha);
  assert.strictEqual(a.instruction, 'plus sombre b');
  assert.strictEqual(a.basedOn, first);
  assert.match(a.prompt, /Specific adjustment requested for this attempt .*plus sombre b$/);
  assert.strictEqual(a.inDraft, false);
  assert.ok(a.checks.margins.coverage > 0.7 && a.checks.margins.coverage < 0.8, 'marge 12 % appliquée');
  assert.match(a.prompt, /collectible item icon/);
  const img = studio.getImage(a.sha);
  const meta = await sharp(img.bytes).metadata();
  assert.deepStrictEqual([meta.format, meta.width, meta.hasAlpha], ['webp', 256, true]);
  assert.throws(() => studio.generate('item:relic', { basedOn: '0000000000000000' }), e => e.status === 404);
  studio.generate('block:diamant');
  await studio.waitJob();
  assert.strictEqual(/resource icon/.test(prompts.find(p => p.target === 'block:diamant').prompt), true);
  assert.strictEqual(studio.listCalls().filter(c => !c.target.startsWith('check:')).length, 3, '3 images');
  assert.deepStrictEqual(studio.listCalls().filter(c => c.target.startsWith('check:')).map(c => c.target), ['check:item:relic', 'check:item:relic'], 'sujet des objets contrôlé, pas celui des blocs');
  assert.deepStrictEqual(blocks.getPublished(), before, 'catalogue publié inchangé');
  assert.strictEqual(blocks.getDraft(), null, 'aucun brouillon créé par une génération');
  assert.strictEqual(typeof studio.startJob, 'undefined', 'plus de génération par lot');
});

test('plafond de l\'atelier, quota, échec journalisé sans secret', async () => {
  studio.setStudioBudget(0.034);      // 0,03 déjà dépensés : une image de 0,01 dépasserait
  assert.strictEqual(studio.status().studioCapUsd, 0.03, 'arrondi au centime');
  assert.throws(() => studio.generate('item:fossil'), e => e.status === 402 && /Plafond/.test(e.message) && /Config → Budget IA/.test(e.message));
  assert.strictEqual(studio.status().studioCapUsd, 0.03, 'jamais relevé automatiquement');
  assert.throws(() => studio.setStudioBudget(-1), e => e.status === 400);
  studio.setStudioBudget(null);
  failNext = true;
  studio.generate('item:fossil');
  const j = await studio.waitJob();
  assert.strictEqual(j.status, 'failed');
  assert.match(j.error, /Échec de la génération/);
  assert.doesNotMatch(JSON.stringify(studio.listCalls()), /sk-proj-abcdefgh/, 'clé masquée dans le journal');
  assert.strictEqual(studio.listCalls()[0].ok, false);
  assert.strictEqual(studio.listCalls()[0].cost_usd, 0);
  assert.throws(() => studio.generate('block:inconnu'), e => e.status === 404);
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

test('recette du 02/11 : générations successives d\'objets distincts, consigne répétée neutralisée', async () => {
  const lantern = { subject: 'Worn brass miner\'s lantern', details: 'A small tarnished brass lantern with a frosted glass globe.', palette: 'Palette: warm amber.' };
  // Cas de la production : la même consigne écrite en une fois pour plusieurs objets par une importation
  const ins = conn().prepare("INSERT OR REPLACE INTO icon_studio_briefs (target, subject, details, palette, updated_at) VALUES (?, ?, ?, ?, '2026-11-02 14:33:58')");
  for (const k of ['crystal', 'fossil', 'mystic_orb']) ins.run(`item:${k}`, lantern.subject, lantern.details, lantern.palette);
  const before = Object.fromEntries(['crystal', 'fossil', 'mystic_orb'].map(k => [k, studio.getTarget(`item:${k}`).assets.length]));
  const fossil = studio.getTarget('item:fossil');
  assert.deepStrictEqual([fossil.briefIgnored, fossil.brief.custom, fossil.briefSharedWith], [true, false, ['crystal', 'mystic_orb']]);
  assert.strictEqual(fossil.brief.ignored.subject, lantern.subject, 'consigne enregistrée conservée, seulement ignorée');
  const sent = {};
  for (const [k, instruction] of [['crystal', 'plus sombre'], ['fossil', ''], ['mystic_orb', '']]) {
    const n = prompts.length;
    studio.generate(`item:${k}`, { instruction });
    const j = await studio.waitJob();
    assert.strictEqual(j.status, 'done', JSON.stringify(j));
    assert.strictEqual(prompts.length, n + 1);
    assert.strictEqual(prompts[n].target, `item:${k}`);
    sent[k] = prompts[n].prompt;
  }
  assert.match(sent.crystal, /^Object to depict: "Blue Crystal" \(French name: "Cristal bleu"\); the icon shows this exact object and nothing else\. Visual description: A single blue crystal, shown with its usual real-world shape/);
  assert.match(sent.fossil, /^Object to depict: "Fossil" \(French name: "Fossile"\)/);
  assert.match(sent.mystic_orb, /^Object to depict: "Mysterious Orb"/);
  for (const p of Object.values(sent)) assert.doesNotMatch(p, /lantern/i, 'aucune consigne répétée transmise');
  assert.doesNotMatch(sent.fossil, /plus sombre|Crystal|Cristal/, 'rien de la génération précédente');
  assert.strictEqual(new Set(Object.values(sent)).size, 3);
  for (const k of Object.keys(sent)) {
    const t = studio.getTarget(`item:${k}`);
    assert.strictEqual(t.assets.length, before[k] + 1, 'propositions existantes conservées');
    const meta = JSON.parse(conn().prepare('SELECT meta FROM icon_studio_assets WHERE sha = ?').get(t.assets[0].sha).meta);
    assert.deepStrictEqual([meta.reference, meta.basedOn, meta.promptVersion], ['art/icons/v1/reference/pierre.png', null, 'v1.3'], 'seule la référence de style pierre');
    assert.strictEqual(meta.identity.name, { crystal: 'Blue Crystal', fossil: 'Fossil', mystic_orb: 'Mysterious Orb' }[k]);
  }
  // Correction manuelle : la consigne « lanterne » reprise pour UN objet devient la sienne, les autres restent neutralisés
  const b = studio.setBrief('item:crystal', lantern);
  assert.deepStrictEqual([b.custom, b.ignored], [true, undefined]);
  assert.match(studio.getTarget('item:crystal').prompt, /^Object to depict: "Blue Crystal".*Worn brass miner's lantern/);
  assert.strictEqual(studio.getTarget('item:fossil').briefIgnored, true);
  // Et plus jamais deux objets distincts avec la même consigne (casse et espaces ignorés)
  assert.throws(() => studio.setBrief('item:relic', { ...lantern, subject: '  WORN BRASS miner\'s lantern ' }), e => e.status === 409 && /Cristal bleu/.test(e.message));
  assert.throws(() => studio.setBrief('item:fossil', lantern), e => e.status === 409);
  assert.strictEqual(studio.setBrief('item:fossil', { ...lantern, subject: 'A small ammonite fossil' }).custom, true, 'consigne propre acceptée');
  assert.strictEqual(studio.setBrief('item:crystal', lantern).custom, true, 'réenregistrer sa propre consigne reste possible');
  studio.setBrief('item:fossil', { reset: true });
});

test('recette du 02/11 (2) : une demande qui cite un autre objet est refusée avant toute dépense', async () => {
  const calls = () => conn().prepare('SELECT COUNT(*) n FROM icon_studio_calls').get().n;
  const count = k => studio.getTarget(`item:${k}`).assets.length;
  const [n0, c0, a0] = [prompts.length, calls(), count('fossil')];
  // Cas de la production : la précision écrite pour un autre objet (crayon) envoyée depuis la fiche du jeton
  const polluted = 'L\'image précédente représente une lanterne, c\'est une erreur. Remplace entièrement la lanterne par un CRISTAL BLEU : aucun élément de lanterne.';
  assert.throws(() => studio.generate('item:fossil', { instruction: polluted }),
    e => e.status === 409 && e.details.code === 'subject_conflict' && /Fossile/.test(e.message) && /rien n'a été dépensé/.test(e.message)
      && e.details.conflicts.length === 1 && e.details.conflicts[0].id === 'crystal' && e.details.conflicts[0].strict && e.details.conflicts[0].where === 'précision');
  assert.throws(() => studio.generate('item:fossil', { instruction: polluted, acknowledge: ['crystal'] }), e => e.status === 409, 'nom complet : jamais contournable');
  assert.deepStrictEqual([prompts.length, calls(), count('fossil'), studio.jobView()?.target === 'item:fossil' && studio.jobView()?.status === 'running'], [n0, c0, a0, false],
    'aucun appel, aucun coût, aucune image');
  // Nom principal seul (« crystal », pluriel compris) : conflit probable, confirmable explicitement
  assert.throws(() => studio.generate('item:fossil', { instruction: 'entouré de petits crystals' }), e => e.status === 409 && !e.details.conflicts[0].strict);
  studio.generate('item:fossil', { instruction: 'entouré de petits crystals', acknowledge: ['crystal'] });
  let j = await studio.waitJob();
  assert.strictEqual(j.status, 'done', JSON.stringify(j));
  assert.match(prompts.at(-1).prompt, /^Object to depict: "Fossil"/);
  const meta = sha => JSON.parse(conn().prepare('SELECT meta FROM icon_studio_assets WHERE sha = ?').get(sha).meta);
  assert.deepStrictEqual(meta(j.result.sha).acknowledgedConflicts, ['crystal'], 'confirmation tracée dans la provenance');
  // Son propre nom, accents et casse ignorés : aucun conflit
  studio.generate('item:fossil', { instruction: 'FOSSILE plus sombre, pierre usée' });
  j = await studio.waitJob();
  assert.strictEqual(j.status, 'done', JSON.stringify(j));
  // Consigne d'illustration enregistrée qui décrit un autre objet : signalée sur la fiche et bloquante
  studio.setBrief('item:relic', { subject: 'A mysterious orb glowing softly', details: 'Round glass sphere.', palette: '' });
  assert.deepStrictEqual(studio.getTarget('item:relic').subjectConflicts.map(c => [c.id, c.where]), [['mystic_orb', 'consigne d\'illustration']]);
  assert.throws(() => studio.generate('item:relic'), e => e.status === 409 && /consigne d'illustration/.test(e.message));
  studio.setBrief('item:relic', { reset: true });
  // Consigne par défaut (histoire du catalogue) : jamais bloquante
  assert.deepStrictEqual(studio.getTarget('item:relic').subjectConflicts, []);

  // Proposition antérieure douteuse (ancienne consigne d'un autre objet) : signalée, conservation refusée sans confirmation
  const bad = { kind: 'item', prompt: 'A blue crystal shard', promptVersion: 'v1.1', brief: { subject: 'A blue crystal shard', details: '', palette: '' }, instruction: null };
  const png = await studio.fakeIconPng(10);
  const webp = await sharp(png).resize(256, 256).webp().toBuffer();
  const sha = crypto.createHash('sha256').update(webp).digest('hex').slice(0, 16);
  conn().prepare("INSERT INTO icon_studio_assets (sha, target, source, mime, bytes, meta, created_at) VALUES (?, 'item:fossil', 'ai', 'image/webp', ?, ?, '2026-11-02 19:48:05')")
    .run(sha, webp, JSON.stringify(bad));
  const tf = studio.getTarget('item:fossil');
  const a = tf.assets.find(x => x.sha === sha);
  assert.match(a.warning.text, /Proposition douteuse/);
  assert.strictEqual(a.identity, null);
  assert.strictEqual(tf.assets.find(x => x.sha === j.result.sha).warning, null, 'proposition correcte non signalée');
  assert.strictEqual(tf.assets.find(x => x.sha === j.result.sha).identity.name, 'Fossil');
  assert.throws(() => studio.apply('item:fossil', { sha }), e => e.status === 409 && e.details.code === 'doubtful_asset');
  const r = studio.apply('item:fossil', { sha, doubtful: true });
  assert.strictEqual(r.target.history[0].details.doubtful, true);
  studio.apply('item:fossil', { sha: null });
});

test('recettes des 02 et 03/11 : référence de style et motif autorisés, changement de sujet refusé sans dépense', async () => {
  const calls = () => conn().prepare('SELECT COUNT(*) n FROM icon_studio_calls').get().n;
  // Cas « Jeton doré » : la consigne cite d'autres objets comme référence de style (boussole, lanterne)
  const style = 'Jeton plat vu de trois quarts, relief 3D stylisé, cohérent avec le fossile et la couronne brisée, bord net et lisible en petit.';
  const s1 = studio.subjectCheck('item:crystal', { instruction: style });
  assert.deepStrictEqual(s1.conflicts, []);
  assert.deepStrictEqual(s1.references.map(r => [r.id, r.context]).sort(), [['broken_crown', 'style'], ['fossil', 'style']]);
  studio.generate('item:crystal', { instruction: style });
  let j = await studio.waitJob();
  assert.strictEqual(j.status, 'done', JSON.stringify(j));
  assert.match(prompts.at(-1).prompt, /^Object to depict: "Blue Crystal"/);
  // Consigne longue (texte intégral, au-delà de l'ancienne limite de 300 caractères) transmise entière
  const long = `${style} ${'Patine chaude, reflets doux sur le rebord, ombre portée légère. '.repeat(8)}`.trim();
  assert.ok(long.length > 400 && long.length < 1000);
  studio.generate('item:crystal', { instruction: long });
  j = await studio.waitJob();
  assert.strictEqual(j.status, 'done', JSON.stringify(j));
  assert.ok(prompts.at(-1).prompt.includes(long), 'précision complète transmise');

  // Cas « culotte du roi Dagobert » : couronne brodée = motif, pas un autre objet (consigne enregistrée)
  studio.setBrief('item:relic', { subject: 'A pair of baggy medieval royal breeches',
    details: 'Puffy knee-length royal breeches in crimson velvet, gold trim at the cuffs, ornate embroidered royal crown, one small clothing label sewn on the outside.',
    palette: 'Palette: crimson red velvet, gold trim.' });
  const relic = studio.getTarget('item:relic');
  assert.deepStrictEqual(relic.subjectConflicts, []);
  assert.deepStrictEqual(relic.subjectReferences.map(r => [r.id, r.term, r.context]), [['broken_crown', 'crown', 'detail']]);
  assert.deepStrictEqual(studio.subjectCheck('item:relic', { instruction: 'embroidered crown on breeches' }).conflicts, []);
  assert.deepStrictEqual(studio.subjectCheck('item:relic', { instruction: 'une couronne brodée sur la ceinture' }).conflicts, []);
  studio.generate('item:relic', { instruction: 'embroidered crown on breeches' });
  j = await studio.waitJob();
  assert.strictEqual(j.status, 'done', JSON.stringify(j));
  assert.strictEqual(studio.getTarget('item:relic').assets.find(a => a.sha === j.result.sha).warning, null, 'proposition non marquée douteuse');

  // Vrais changements de sujet : refusés avant tout appel, jamais contournables
  const c0 = calls(), p0 = prompts.length;
  for (const [instruction, id] of [['draw a broken crown instead of breeches', 'broken_crown'], ['Dessine une couronne.', 'broken_crown'],
    ['remplace par un fossile, cohérent avec le cristal bleu', 'fossil'], ['show a crown', 'broken_crown']]) {
    assert.throws(() => studio.generate('item:relic', { instruction, acknowledge: [id] }),
      e => e.status === 409 && e.details.code === 'subject_conflict' && e.details.conflicts[0].id === id && e.details.conflicts[0].strict
        && e.details.conflicts[0].context === 'replace' && /dessiner cet autre objet/.test(e.message), instruction);
  }
  // Sens du remplacement : « remplace la couronne par une culotte » retire la couronne (confirmable) ;
  // « une couronne au lieu de la culotte » en fait le sujet (refusé) ; une description de l'ancienne image n'est pas une demande
  const removed = studio.subjectCheck('item:relic', { instruction: 'Remplace la couronne par une culotte' }).conflicts[0];
  assert.deepStrictEqual([removed.id, removed.strict, removed.context], ['broken_crown', false, 'removed']);
  assert.strictEqual(studio.subjectCheck('item:relic', { instruction: 'replace the broken crown with breeches' }).conflicts[0].strict, false, 'nom complet à retirer : confirmable');
  assert.strictEqual(studio.subjectCheck('item:relic', { instruction: 'une couronne au lieu de la culotte' }).conflicts[0].strict, true);
  assert.strictEqual(studio.subjectCheck('item:relic', { instruction: 'la culotte devient une couronne' }).conflicts[0].strict, true);
  assert.strictEqual(studio.subjectCheck('item:relic', { instruction: 'L\'image précédente représente une couronne' }).conflicts[0].strict, false);
  // Mention nue du nom principal : toujours un conflit probable, confirmable (règle inchangée)
  assert.throws(() => studio.generate('item:relic', { instruction: 'une couronne posée à côté' }), e => e.status === 409 && !e.details.conflicts[0].strict);
  // Une référence de style n'excuse pas une demande de remplacement dans la même phrase
  assert.ok(studio.subjectCheck('item:relic', { instruction: 'cohérent avec le fossile mais remplace la culotte par un fossile' }).conflicts[0].strict);
  assert.deepStrictEqual([calls(), prompts.length], [c0, p0], 'aucun appel ni coût pour les refus');
  // Lecture pendant la saisie : consigne en cours de frappe (non enregistrée) analysée de même
  assert.strictEqual(studio.subjectCheck('item:relic', { subject: 'A broken crown', details: '' }).conflicts[0].strict, true);
  studio.setBrief('item:relic', { reset: true });
});

test('réservation par image (03/11) : coûts réels mesurés, jamais au-delà de l\'estimation configurée', () => {
  // Coûts constatés en production le 02/11 : 0,0818 à 0,0823 USD → 0,11 réservé au lieu de 0,25
  assert.deepStrictEqual(studio.reserveFromCosts([0.0818, 0.0823, 0.0822], 0.25), { usd: 0.11, basis: 'measured', configuredUsd: 0.25, measuredMaxUsd: 0.0823, samples: 3 });
  assert.strictEqual(studio.reserveFromCosts([0.0822], 0.25).basis, 'configured', 'une seule mesure : estimation configurée');
  assert.strictEqual(studio.reserveFromCosts([0.3, 0.2], 0.25).usd, 0.25, 'jamais au-delà de l\'estimation configurée');
  assert.strictEqual(studio.reserveFromCosts([0.08, 0.08], 0.25).usd, 0.1);
  // Plafond de 3 USD, 2,7961 USD cumulés (état du 03/11) : 2 images possibles, la 3e refusée
  let left = 3 - 2.7961, n = 0;
  while (left + 1e-9 >= 0.11 + 0.01) { left -= 0.0822 + 0.0005; n++; }
  assert.strictEqual(n, 2);
  const s = studio.status();
  assert.ok(s.reserve && 'lastImage' in s && s.perImageUsd >= s.estImageUsd, JSON.stringify(s));
});

test('collection entière (02/11) : une image par objet, enchaînées, plafond respecté, échecs seuls à corriger', async () => {
  const seen = [];
  const badCheck = new Set(['monster_tooth']);
  const fakeImage = async ({ prompt, target }) => { prompts.push({ prompt, target }); seen.push(target); return { png: await studio.fakeIconPng(seen.length * 53) }; };
  studio.setFakeTransport({ image: fakeImage,
    check: async ({ target, identity }) => ({ seen: badCheck.has(target.slice(5)) ? 'a golden nugget' : `a ${identity.name.toLowerCase()}`, matches: !badCheck.has(target.slice(5)), confidence: 'high' }) });
  studio.setBrief('item:map_fragment', { subject: 'A mysterious orb on a parchment scrap', details: '', palette: '' });
  const draftBefore = JSON.stringify(coll.getDraft());
  const plan = studio.seriesPlan('origines');
  const st = Object.fromEntries(plan.items.map(i => [i.id, i.state]));
  assert.deepStrictEqual(['ancient_coin', 'broken_crown', 'monster_tooth'].map(k => st[k]), ['todo', 'todo', 'todo']);
  assert.strictEqual(st.map_fragment, 'conflict', 'conflit de sujet : ignoré sans dépense');
  assert.strictEqual(st.relic, 'has_proposal', 'proposition v1.3 à examiner : pas de nouvelle dépense');
  assert.deepStrictEqual([plan.todo, plan.estTotalUsd], [3, 0.03]);
  assert.throws(() => studio.seriesPlan('inconnue'), e => e.status === 404);
  // Mêmes protections qu'une fiche : panel obsolète, cible différente
  assert.throws(() => studio.generateSeries('origines', { client: { build: 'ancien', target: 'series:origines' } }), e => e.details?.code === 'stale_client');
  assert.throws(() => studio.generateSeries('origines', { client: { build: require('../server/version').APP_VERSION, target: 'item:relic' } }), e => e.details?.code === 'target_mismatch');

  // Plafond de l'atelier : 2 images possibles, la 3e n'est pas lancée, le plafond n'est jamais relevé
  const spent = () => studio.status().studioSpentUsd;
  studio.setStudioBudget(+(spent() + 0.02).toFixed(2));    // coût factice : 0,01 par image, contrôle gratuit
  const cap = studio.status().studioCapUsd;
  const job = studio.generateSeries('origines');
  assert.deepStrictEqual([job.kind, job.status, job.target], ['series', 'running', 'series:origines']);
  assert.throws(() => studio.generate('item:relic'), e => e.status === 429 && /collection/.test(e.message), 'une seule génération à la fois');
  let j = await studio.waitJob();
  const by = id => j.items.find(i => i.key === `item:${id}`);
  assert.strictEqual(j.status, 'stopped', JSON.stringify(j));
  assert.deepStrictEqual(['ancient_coin', 'broken_crown', 'monster_tooth', 'map_fragment', 'relic'].map(k => by(k).state), ['done', 'done', 'not_run', 'conflict', 'has_proposal']);
  assert.match(by('monster_tooth').reason, /Plafond/);
  assert.deepStrictEqual(seen, ['item:ancient_coin', 'item:broken_crown'], 'un appel par objet, aucun pour les objets ignorés');
  assert.deepStrictEqual([by('ancient_coin').check.matches, by('ancient_coin').check.seen], [true, 'a ancient coin']);
  assert.strictEqual(studio.status().studioCapUsd, cap, 'plafond inchangé');
  assert.throws(() => studio.generateSeries('origines'), e => e.status === 402, 'plafond atteint : refus immédiat');

  // Budget relevé par l'admin : l'objet restant est généré ; le contrôle du sujet le signale « à revoir »
  studio.setStudioBudget(cap + 0.05);
  studio.generateSeries('origines');
  j = await studio.waitJob();
  assert.strictEqual(j.status, 'done');
  assert.deepStrictEqual([by('monster_tooth').state, by('monster_tooth').check.seen, by('ancient_coin').state], ['review', 'a golden nugget', 'has_proposal']);
  const mt = studio.getTarget('item:monster_tooth').assets[0];
  assert.deepStrictEqual([mt.subjectCheck.matches, mt.currentPrompt, mt.inDraft], [false, true, false]);
  assert.strictEqual(studio.seriesPlan('origines').items.find(i => i.id === 'monster_tooth').state, 'todo', 'image refusée par le contrôle : reste à faire');

  // Arrêt demandé : l'image en cours se termine, les suivantes ne sont pas lancées
  badCheck.clear();
  studio.setBrief('item:map_fragment', { reset: true });
  studio.generateSeries('origines');
  studio.cancelJob();
  j = await studio.waitJob();
  assert.deepStrictEqual([j.status, by('monster_tooth').state, by('map_fragment').state], ['cancelled', 'done', 'cancelled']);
  assert.throws(() => studio.cancelJob(), e => e.status === 409);
  const ev = conn().prepare("SELECT details FROM icon_studio_events WHERE target = 'item:monster_tooth' AND action = 'generated' ORDER BY id DESC").get();
  assert.strictEqual(typeof JSON.parse(ev.details).batch, 'number', 'génération tracée comme partie d\'une collection');
  assert.strictEqual(JSON.stringify(coll.getDraft()), draftBefore, 'rien appliqué au brouillon ni publié');
  studio.setStudioBudget(null);
  studio.setFakeTransport({ image: fakeImage });
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

  assert.strictEqual((await fetch(`${BASE}/api/admin/icons/jobs`, { method: 'POST', headers: H, body: JSON.stringify({ targets: ['ui:parametres'] }) })).status, 404,
    'route des lots retirée');
  // Onglet ouvert avant un déploiement (aucun en-tête, ou ancienne version) ou fiche différente : refus sans dépense
  const version = (await (await fetch(`${BASE}/api/version`)).json()).version;
  const gen = (key, body, build) => fetch(`${BASE}/api/admin/icons/targets/${key}/generate`, { method: 'POST',
    headers: build === undefined ? H : { ...H, 'X-Dig-Admin-Build': build }, body: JSON.stringify(body) });
  for (const build of [undefined, '1.0.0+029e6cf']) {
    const res = await gen('ui:parametres', { target: 'ui:parametres' }, build);
    const body = await res.json();
    assert.deepStrictEqual([res.status, body.details?.code, body.details?.version], [409, 'stale_client', version], JSON.stringify(body));
    assert.match(body.error, /Rechargez la page/);
  }
  const mism = await gen('ui:parametres', { target: 'item:relic' }, version);
  assert.deepStrictEqual([mism.status, (await mism.json()).details?.code], [409, 'target_mismatch']);
  const conflict = await gen('item:fossil', { target: 'item:fossil', instruction: 'Remplace par un Cristal bleu' }, version);
  const cbody = await conflict.json();
  assert.deepStrictEqual([conflict.status, cbody.details?.code, cbody.details?.conflicts?.[0]?.id], [409, 'subject_conflict', 'crystal']);
  assert.strictEqual((await (await fetch(`${BASE}/api/admin/icons/job`, { headers: H })).json()).job, null, 'aucune génération lancée');
  // Lecture du sujet pendant la saisie : protégée, sans appel ni écriture
  const sc = body => fetch(`${BASE}/api/admin/icons/targets/item:fossil/subject-check`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  assert.strictEqual((await fetch(`${BASE}/api/admin/icons/targets/item:fossil/subject-check`, { method: 'POST', body: '{}' })).status, 401);
  const ok1 = await (await sc({ instruction: 'vue de trois quarts, cohérent avec le cristal bleu' })).json();
  assert.deepStrictEqual([ok1.conflicts.length, ok1.references[0]?.context], [0, 'style'], JSON.stringify(ok1));
  const ko1 = await (await sc({ instruction: 'dessine un cristal bleu' })).json();
  assert.deepStrictEqual([ko1.conflicts[0]?.id, ko1.conflicts[0]?.strict], ['crystal', true]);
  // Collection entière : plan lisible, mêmes refus (panel obsolète, cible), arrêt sans génération en cours
  assert.strictEqual((await fetch(`${BASE}/api/admin/icons/series/origines`)).status, 401);
  const plan = await (await fetch(`${BASE}/api/admin/icons/series/origines`, { headers: H })).json();
  assert.ok(plan.plan.items.length === 8 && plan.plan.todo > 0, JSON.stringify(plan));
  const sg = (body, build) => fetch(`${BASE}/api/admin/icons/series/origines/generate`, { method: 'POST', headers: build === undefined ? H : { ...H, 'X-Dig-Admin-Build': build }, body: JSON.stringify(body) });
  assert.strictEqual((await (await sg({ target: 'series:origines' })).json()).details?.code, 'stale_client');
  assert.strictEqual((await (await sg({ target: 'item:fossil' }, version)).json()).details?.code, 'target_mismatch');
  assert.strictEqual((await fetch(`${BASE}/api/admin/icons/job/cancel`, { method: 'POST', headers: H, body: '{}' })).status, 409);
  assert.ok(Array.isArray((await (await fetch(`${BASE}/api/admin/icons`, { headers: H })).json()).series), 'plans des collections dans la vue d\'ensemble');
  const job = await (await gen('ui:parametres', { target: 'ui:parametres', instruction: 'engrenage plus fin' }, version)).json();
  assert.strictEqual(job.job.target, 'ui:parametres', JSON.stringify(job));
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
