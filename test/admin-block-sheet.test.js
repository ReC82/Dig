/**
 * Fiche d'un bloc (#37, recette du propriétaire du 02/11) :
 * - « Annuler les modifications de ce bloc » : le bloc reprend sa version publiée dans le brouillon,
 *   les autres blocs du brouillon ne bougent pas, rien n'est publié, action journalisée ;
 * - un brouillon redevenu identique à la version publiée n'est plus présenté comme changement ;
 * - traductions manquantes par IA : proposition seulement (rien n'est enregistré), langues demandées
 *   uniquement, contrôle de qualité (recopie du FR signalée) ;
 * - route d'annulation protégée ; balisage de la fiche (sections, aide, confirmation de fermeture).
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
const PORT  = process.env.DIG_TEST_PORT_BLOCK_SHEET || '3167';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-block-sheet-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db      = require('../server/db');
const catalog = require('../server/blockCatalog');
const ai      = require('../server/blockAi');

db.initDb();
catalog.init();
ai.init();

const code = fn => { try { fn(); return 0; } catch (e) { return e.status; } };
const pubType = id => catalog.getPublished().types.find(t => t.id === id);

test('annuler les modifications d\'un bloc : version publiée rétablie pour lui seul, rien publié', () => {
  const v0 = catalog.getPublished().version;
  const charbon = pubType('charbon');
  const pierre = pubType('pierre');
  catalog.upsertDraftType({ ...charbon, reward: charbon.reward + 1 });
  catalog.upsertDraftType({ ...pierre, weight: pierre.weight + 1 });
  assert.strictEqual(catalog.buildAdminView().draft.changes.length, 2);

  const r = catalog.revertDraftType('charbon');
  assert.strictEqual(r.draftDropped, false, 'la pierre reste modifiée : brouillon conservé');
  assert.strictEqual(r.type.reward, charbon.reward);
  const view = catalog.buildAdminView();
  assert.deepStrictEqual(view.draft.changes.map(c => c.id), ['pierre']);
  assert.strictEqual(catalog.getPublished().version, v0, 'aucune publication');
  assert.strictEqual(catalog.listAudit()[0].action, 'draft_revert');
  assert.deepStrictEqual(catalog.listAudit()[0].details.changes, [{ field: 'reward', before: charbon.reward + 1, after: charbon.reward }]);

  // Bloc sans modification ou jamais publié : refus explicite
  assert.strictEqual(code(() => catalog.revertDraftType('charbon')), 409);
  catalog.upsertDraftType({ id: 'basalte_test', names: { fr: 'Basalte test' }, category: 'pierre', rarity: 'rare', icon: '🪨',
    color: '#334155', accent: '#94a3b8', hpBase: 50, reward: 40, minDepth: 30, weight: 2, active: true });
  assert.strictEqual(code(() => catalog.revertDraftType('basalte_test')), 409, 'nouveau bloc : se retire, ne s\'annule pas');
  catalog.removeDraftType('basalte_test');

  // Dernière modification annulée : le brouillon, identique au publié, disparaît
  const r2 = catalog.revertDraftType('pierre');
  assert.strictEqual(r2.draftDropped, true);
  assert.strictEqual(catalog.getDraft(), null);
  assert.strictEqual(catalog.buildAdminView().draft, null);
  assert.strictEqual(catalog.getPublished().version, v0);
});

test('brouillon remis à la main aux valeurs publiées (22 → 23 → 22) : plus de changement en attente', () => {
  const charbon = pubType('charbon');
  catalog.upsertDraftType({ ...charbon, reward: charbon.reward + 1 });
  assert.ok(catalog.getDraft());
  catalog.upsertDraftType({ ...charbon });
  assert.strictEqual(catalog.getDraft(), null, 'brouillon identique supprimé');
  assert.strictEqual(catalog.listAudit()[0].action, 'draft_clean');
  // Un brouillon réellement modifié n'est jamais nettoyé
  catalog.upsertDraftType({ ...charbon, active: true, weight: charbon.weight + 2 });
  assert.ok(catalog.getDraft());
  catalog.discardDraft();
});

test('traductions manquantes par IA : proposition non enregistrée, langues demandées seulement, contrôle qualité', async () => {
  const seen = [];
  ai.setFakeTransport({ json: async ({ kind, messages }) => {
    seen.push({ kind, user: messages[1].content });
    return { data: { nl: 'Maanbasalt', es: 'Basalte lunaire' }, usage: { prompt_tokens: 100, completion_tokens: 20 } };
  } });
  const before = catalog.getDraft();
  const r = await ai.translateNames({ id: 'basalte', names: { fr: 'Basalte lunaire', en: 'Lunar basalt' }, category: 'pierre', langs: ['nl', 'es', 'fr', 'xx'] });
  assert.deepStrictEqual(r.names, { nl: 'Maanbasalt', es: 'Basalte lunaire' });
  assert.ok(r.warnings.some(w => /ES identique au français/.test(w)), r.warnings.join(' '));
  assert.strictEqual(seen[0].kind, 'block-translate');
  assert.match(seen[0].user, /Existing translations: English: Lunar basalt/);
  assert.deepStrictEqual(catalog.getDraft(), before, 'rien n\'est enregistré');
  await assert.rejects(ai.translateNames({ id: 'x', names: {}, langs: ['en'] }), e => e.status === 400);
  await assert.rejects(ai.translateNames({ id: 'x', names: { fr: 'X' }, langs: ['fr'] }), e => e.status === 400);
  ai.setFakeTransport(null);
});

test('route d\'annulation protégée et fonctionnelle (serveur de test)', async (t) => {
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
  assert.ok(up, `serveur de test non démarré :\n${log}`);
  const call = async (method, url, body, { auth = true } = {}) => {
    const res = await fetch(BASE + url, { method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${ADMIN}` } : {}) } });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  assert.strictEqual((await call('POST', '/api/admin/blocks/draft/types/charbon/revert', {}, { auth: false })).status, 401);
  assert.strictEqual((await call('POST', '/api/admin/blocks/translate', {}, { auth: false })).status, 401);
  const view = (await call('GET', '/api/admin/blocks')).body;
  const charbon = view.published.types.find(x => x.id === 'charbon');
  assert.strictEqual((await call('PUT', '/api/admin/blocks/draft/types/charbon', { type: { ...charbon, reward: charbon.reward + 1 } })).status, 200);
  const r = await call('POST', '/api/admin/blocks/draft/types/charbon/revert', {});
  assert.deepStrictEqual([r.status, r.body.draftDropped, r.body.type.reward], [200, true, charbon.reward]);
  assert.strictEqual((await call('GET', '/api/admin/blocks')).body.draft, null);
  assert.strictEqual((await call('POST', '/api/admin/blocks/draft/types/charbon/revert', {})).status, 409);
  const tr = await call('POST', '/api/admin/blocks/translate', { id: 'x', names: { fr: 'Basalte lunaire' }, category: 'pierre', langs: ['en', 'nl'] });
  assert.strictEqual(tr.status, 200, JSON.stringify(tr.body));
  assert.deepStrictEqual(Object.keys(tr.body.names).sort(), ['en', 'nl']);
});

test('balisage de la fiche : sections, aide, annulation par bloc / tout le brouillon, confirmation de fermeture', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');
  const sheet = html.slice(html.indexOf('<dialog id="bk-dialog"'), html.indexOf('</dialog>', html.indexOf('<dialog id="bk-dialog"')));
  for (const legend of ['Apparition et probabilités', 'Points de vie et récompense', 'Identifiant et traductions', 'Visuel', 'Avancé']) {
    assert.ok(sheet.includes(`<span class="bk-acc-title">${legend}</span>`), legend);
  }
  for (const id of ['btn-bk-revert', 'btn-bk-discard-all', 'btn-bk-translate', 'bk-eff', 'bk-name-src-en', 'bk-h-weight', 'bk-h-fade', 'bk-h-rarity', 'bk-h-cat']) {
    assert.ok(sheet.includes(`id="${id}"`), id);
  }
  // Chaque ⓘ pilote une aide existante
  for (const [, id] of sheet.matchAll(/class="bk-info"[^>]*aria-controls="([^"]+)"/g)) assert.ok(sheet.includes(`id="${id}"`), id);
  assert.match(html, /id="bk-leave-dialog"[\s\S]*Continuer à modifier[\s\S]*Abandonner les modifications/);
  const js = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
  assert.match(js, /getElementById\('bk-dialog'\)\.addEventListener\('cancel', e => \{ e\.preventDefault\(\); bkRequestClose\(\); \}\)/, 'Échap passe par la confirmation');
  assert.match(js, /e\.key !== 'Escape'[\s\S]{0,120}bkRequestClose\(\)/, 'Échap intercepté dès la touche (#61)');
  assert.match(js, /if \(down && admOnBackdrop\(dlg, e\)\) bkRequestClose\(\)/, 'clic sur le fond passe par la confirmation');
  assert.match(js, /'beforeunload'/);
});

test('fiche simplifiée (recette du 03/11) : synthèse, accordéons, une langue et une aide à la fois, pied fixe, réglages conservés', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');
  const sheet = html.slice(html.indexOf('<dialog id="bk-dialog"'), html.indexOf('</dialog>', html.indexOf('<dialog id="bk-dialog"')));
  // Synthèse lisible sans défiler, avant toute section
  const ov = sheet.indexOf('class="bk-overview"');
  assert.ok(ov > 0 && ov < sheet.indexOf('<details'), 'synthèse en tête');
  for (const id of ['bk-ov-thumb', 'bk-ov-name', 'bk-ov-cat', 'bk-ov-rarity', 'bk-ov-min', 'bk-ov-depth', 'bk-ov-odds', 'bk-ov-hp', 'bk-ov-reward']) {
    assert.ok(sheet.includes(`id="${id}"`), id);
  }
  // Tableau détaillé repliable dans « Apparition et probabilités »
  assert.match(sheet, /id="bk-acc-spawn"[\s\S]*<details class="bk-sub" id="bk-acc-eff">[\s\S]*id="bk-eff-detail"[\s\S]*id="bk-fade-from"[\s\S]*id="bk-fade-weight"/);
  // Une langue à la fois
  assert.match(sheet, /id="bk-langs"[\s\S]*data-lang="es"/);
  assert.strictEqual((sheet.match(/class="bk-field bk-lang-field hidden"/g) || []).length, 3, 'FR seul visible à l\'ouverture');
  // Aucun paragraphe d'explication permanent hors aides repliées et aide complète facultative
  assert.ok(!/<small class="muted">/.test(sheet), 'plus de grands paragraphes fixes');
  assert.match(sheet, /id="bk-help-full"/);
  // Pied d'action fixe : enregistrer, annuler, indicateur de modification, message
  const foot = sheet.slice(sheet.indexOf('class="bk-sheet-actions"'));
  for (const id of ['btn-bk-save', 'btn-bk-cancel', 'bk-dirty', 'bk-form-msg']) assert.ok(foot.includes(`id="${id}"`), id);
  const css = fs.readFileSync(path.join(ROOT, 'public/admin/admin.css'), 'utf8');
  assert.match(css, /\.bk-sheet-actions \{ position: sticky; bottom:/);
  // Aucun réglage supprimé : tous les champs lus par bkReadForm existent toujours
  const js = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
  const read = js.slice(js.indexOf('function bkReadForm()'), js.indexOf('function bkFillList'));
  for (const [, id] of read.matchAll(/(?:getElementById\(|num\()'(bk-[a-z-]+)'/g)) assert.ok(sheet.includes(`id="${id}"`), id);
  for (const l of ['fr', 'en', 'nl', 'es']) assert.ok(sheet.includes(`id="bk-name-${l}"`));
  // Une seule aide ouverte à la fois ; Annuler passe par la confirmation
  assert.match(js, /une seule aide à la fois/);
  assert.match(js, /'btn-bk-cancel'\)\.addEventListener\('click', \(\) => bkRequestClose\(\)\)/);
});

test('brouillon déjà identique en base (remis à la main avant le correctif) : vue « aucun brouillon », sans écriture', () => {
  const pub = catalog.getPublished();
  db.getDb().prepare(`INSERT INTO block_catalog_draft (id, types, based_on, updated_at) VALUES (1, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET types = excluded.types, based_on = excluded.based_on`).run(JSON.stringify(pub.types), pub.version);
  assert.strictEqual(catalog.buildAdminView().draft, null);
  assert.ok(catalog.getDraft(), 'consultation sans écriture');
  catalog.discardDraft();
});
