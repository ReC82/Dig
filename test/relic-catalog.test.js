/**
 * Tests du catalogue de reliques administrable, ticket #64 (étape A) :
 * - migration : la version 1 reprend à l'identique les six reliques du client (coûts, niveaux,
 *   effets) et leurs textes FR/EN/NL/ES ; idempotente ;
 * - validation : effets réels seulement, bornes, plafonds anti-bot (#25), bonus croissants,
 *   aucune relique publiée supprimée, nombre de niveaux jamais en baisse ;
 * - brouillon → publication explicite, version périmée refusée, abandon sans effet (recette :
 *   modifier Cœur d'or puis abandonner), retour arrière, journal en ajout seul ;
 * - serveur : l'Aimant à éclats publié pilote le bonus de fragments des coffres ;
 * - client : catalogue appliqué, relique archivée (ni déblocage ni amélioration, bonus gardé) ;
 * - routes HTTP : catalogue public, administration protégée, cible « relic: » de l'atelier
 *   d'icônes (serveur de test, port ≠ 3000, aucune génération d'image).
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

const ROOT  = path.join(__dirname, '..');
const PORT  = process.env.DIG_TEST_PORT_RELICS || '3192';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-relics-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db      = require('../server/db');
const catalog = require('../server/relicCatalog');
const economy = require('../server/economy');

db.initDb();
catalog.init();

function loadClient() {
  const ctx = { console, Math, JSON, Number, Object, Array, String, t: k => k, I18n: { getCurrent: () => 'fr', has: () => false } };
  vm.createContext(ctx);
  for (const f of ['gameState.js', 'relics.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8'), ctx, { filename: f });
  }
  return vm.runInContext('({ GameState, Relics })', ctx);
}

const code = fn => { try { fn(); return 0; } catch (e) { if (!(e instanceof catalog.CatalogError)) throw e; return e.status; } };
const clone = x => JSON.parse(JSON.stringify(x));
const heart = () => clone(catalog.getPublished().relics.find(r => r.id === 'golden_heart'));

test('version 1 : les six reliques du jeu à l\'identique, textes FR/EN/NL/ES', () => {
  const { Relics } = loadClient();
  const pub = catalog.getPublished();
  assert.strictEqual(pub.version, 1);
  assert.strictEqual(pub.source, 'origin');
  assert.deepStrictEqual(pub.relics.map(r => r.id), clone(Relics.DEFS.map(d => d.id)));
  for (const d of Relics.DEFS) {
    const r = pub.relics.find(x => x.id === d.id);
    assert.deepStrictEqual([r.maxLevel, r.costs, r.effect, r.values, r.icon, r.active],
      clone([d.maxLevel, d.costs, d.bonus.type, d.bonus.values, d.icon, true]), d.id);
    for (const l of catalog.LANGS) assert.ok(r.names[l] && r.descs[l], `${d.id} ${l}`);
  }
  assert.strictEqual(heart().names.fr, 'Cœur d\'or');
  assert.deepStrictEqual(heart().values, [0.15, 0.30, 0.50, 0.75, 1.00]);
  assert.deepStrictEqual(catalog.validateCatalog(pub.relics).errors, []);
  catalog.init();
  assert.strictEqual(catalog.listVersions().length, 1, 'idempotent');
  assert.deepStrictEqual(catalog.shardMagnetValues(), economy.SHARD_MAGNET_BONUS);
});

test('validation : effets réels, bornes, plafonds anti-bot, suppressions et baisse de niveaux refusées', () => {
  const all = clone(catalog.getPublished().relics);
  const withRelic = (id, patch) => all.map(r => (r.id === id ? { ...r, ...patch } : r));
  const errs = list => catalog.validateCatalog(list).errors;
  assert.strictEqual(code(() => catalog.normalizeRelic({ ...heart(), effect: 'gems_pct' })), 400, 'effet inconnu');
  assert.strictEqual(code(() => catalog.normalizeRelic({ ...heart(), values: [0.15, 0.1, 0.5, 0.75, 1] })), 400, 'bonus décroissant');
  assert.strictEqual(code(() => catalog.normalizeRelic({ ...heart(), costs: [8, 18, 35, 55] })), 400, 'un coût par niveau');
  assert.strictEqual(code(() => catalog.normalizeRelic({ ...heart(), values: [0.15, 0.3, 0.5, 0.75, 6] })), 400, 'borne max');
  assert.strictEqual(code(() => catalog.normalizeRelic({ ...heart(), id: 'Bad Id' })), 400);
  assert.strictEqual(code(() => catalog.normalizeRelic({ ...heart(), image: 'https://evil.example/x.png' })), 400);
  assert.strictEqual(code(() => catalog.normalizeRelic({ ...heart(), id: 'magnet2', effect: 'relic_fragment_bonus', values: [1, 2, 3, 4, 5] })), 400,
    'bonus de fragments réservé à l\'Aimant (calcul serveur)');
  // Œil du mineur au-delà de +10 dégâts : budget anti-bot (#25) dépassé
  assert.ok(errs(withRelic('eye_of_miner', { values: [2, 4, 6, 8, 11] })).some(e => /de 1 à 10/.test(e)));
  // Deux reliques de dégâts : la somme compte
  const extra = { ...clone(all[0]), id: 'eye_two', names: { fr: 'Œil bis' }, values: [1, 1, 1, 1, 1] };
  assert.ok(errs([...all, extra]).some(e => /plafond 10/.test(e)));
  assert.ok(errs(withRelic('obsidian_claw', { values: [0.1, 0.2, 0.3, 0.4, 0.6] })).length, 'réduction de PV > 50 %');
  assert.ok(errs(all.filter(r => r.id !== 'cracked_lens')).some(e => /archivée/.test(e)), 'suppression refusée');
  assert.ok(errs(withRelic('golden_heart', { maxLevel: 4, costs: [8, 18, 35, 55], values: [0.15, 0.3, 0.5, 0.75] }))
    .some(e => /ne peut pas baisser/.test(e)));
  const archived = catalog.validateCatalog(withRelic('golden_heart', { active: false }));
  assert.deepStrictEqual(archived.errors, []);
  assert.ok(archived.warnings.some(w => /détenteurs gardent/.test(w)));
});

test('recette : modifier Cœur d\'or dans un brouillon puis l\'abandonner ne change rien en jeu', () => {
  const before = JSON.stringify(catalog.publicCatalog());
  const h = heart();
  h.values = [0.2, 0.3, 0.5, 0.75, 1];
  catalog.upsertDraftRelic(h);
  const view = catalog.buildAdminView();
  assert.ok(view.draft);
  assert.deepStrictEqual(view.draft.changes.map(c => [c.id, c.fields.map(f => f.field)]), [['golden_heart', ['values']]]);
  assert.strictEqual(JSON.stringify(catalog.publicCatalog()), before, 'brouillon invisible des joueurs');
  assert.strictEqual(catalog.discardDraft(), true);
  assert.strictEqual(catalog.buildAdminView().draft, null);
  assert.strictEqual(JSON.stringify(catalog.publicCatalog()), before);
  // Valeur remise à l'identique : brouillon supprimé de lui-même
  catalog.upsertDraftRelic(h);
  const r = catalog.upsertDraftRelic(heart());
  assert.strictEqual(r.draftDropped, true);
  assert.strictEqual(catalog.getDraft(), null);
});

test('publication explicite, version périmée refusée, retour arrière, journal en ajout seul', () => {
  const magnet = clone(catalog.getPublished().relics.find(r => r.id === 'shard_magnet'));
  magnet.values = [1, 2, 3, 5, 7];
  catalog.upsertDraftRelic(magnet);
  assert.strictEqual(code(() => catalog.publishDraft({ expectedBasedOn: 0 })), 409);
  const p = catalog.publishDraft({ note: 'test', expectedBasedOn: 1 });
  assert.strictEqual(p.version, 2);
  assert.deepStrictEqual(catalog.shardMagnetValues(), [1, 2, 3, 5, 7]);
  // Le serveur suit l'Aimant publié (boutique de coffres)
  assert.strictEqual(economy.relicFragmentBonus({ relics: { shard_magnet: 5 } }), 7);
  assert.strictEqual(economy.relicFragmentBonus({ relics: { shard_magnet: 99 } }), 7);
  assert.strictEqual(code(() => catalog.publishDraft()), 409, 'aucun brouillon');

  // Nouvelle relique (brouillon → publication), puis retour à v1 : gardée mais archivée
  const fresh = { id: 'lucky_coin', active: true, icon: '🪙', image: null, names: { fr: 'Pièce chanceuse' }, descs: {},
    maxLevel: 3, costs: [5, 10, 20], effect: 'coins_pct', values: [0.05, 0.1, 0.2] };
  catalog.upsertDraftRelic(fresh);
  assert.strictEqual(code(() => catalog.removeDraftRelic('golden_heart')), 409);
  catalog.publishDraft({ note: 'ajout' });
  assert.strictEqual(code(() => catalog.removeDraftRelic('lucky_coin')), 409, 'publiée : archiver, pas supprimer');
  const rb = catalog.rollbackTo(1);
  assert.deepStrictEqual(rb, { version: 4, restored: 1 });
  const now = catalog.getPublished();
  assert.strictEqual(now.relics.find(r => r.id === 'lucky_coin').active, false);
  assert.deepStrictEqual(now.relics.find(r => r.id === 'shard_magnet').values, [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(catalog.shardMagnetValues(), economy.SHARD_MAGNET_BONUS);
  assert.throws(() => db.getDb().prepare('DELETE FROM relic_catalog_versions').run(), /ajout seul/);
  assert.throws(() => db.getDb().prepare("UPDATE relic_catalog_audit SET action = 'x'").run(), /ajout seul/);
  const actions = catalog.listAudit().map(a => a.action);
  for (const a of ['migrate', 'draft_update', 'draft_discard', 'publish', 'rollback', 'draft_add']) assert.ok(actions.includes(a), a);
});

test('client : catalogue publié appliqué, relique archivée sans perte pour son détenteur', () => {
  const { GameState, Relics } = loadClient();
  const cat = clone(catalog.publicCatalog());
  const h = cat.relics.find(r => r.id === 'golden_heart');
  h.active = false;
  h.names.fr = 'Cœur d\'or (archivé)';
  assert.strictEqual(Relics.applyCatalog(cat), true);
  assert.strictEqual(Relics.catalogVersion, cat.version);
  GameState.relicFragments = 1000;
  GameState.relics = { golden_heart: 2 };
  Relics.applyBonuses();
  assert.strictEqual(GameState.relicBonuses.coinsPct, 0.30, 'bonus gardé');
  assert.strictEqual(Relics.canUpgrade('golden_heart'), false);
  GameState.relics = {};
  assert.strictEqual(Relics.canUnlock('golden_heart'), false);
  assert.strictEqual(Relics.isVisible(Relics.DEFS.find(d => d.id === 'golden_heart')), false);
  assert.strictEqual(Relics.canUnlock('eye_of_miner'), true);
  assert.strictEqual(Relics.displayName(Relics.DEFS.find(d => d.id === 'golden_heart')), 'Cœur d\'or (archivé)');
  // Catalogue invalide : refusé, définitions inchangées
  assert.strictEqual(Relics.applyCatalog({ version: 9, relics: [{ id: 'x', maxLevel: 2, costs: [1], values: [1, 2], effect: 'coins_pct' }] }), false);
  assert.strictEqual(Relics.catalogVersion, cat.version);
});

test('routes : catalogue public, administration protégée, cible relique de l\'atelier d\'icônes', async (t) => {
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
    const res = await fetch(BASE + url, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${ADMIN}` } : {}) },
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  const pub = await call('GET', '/api/relics/catalog', undefined, { auth: false });
  assert.strictEqual(pub.status, 200);
  assert.deepStrictEqual([pub.body.version, pub.body.relics.length], [1, 6]);
  for (const [m, u] of [['GET', '/api/admin/relics'], ['PUT', '/api/admin/relics/draft/relics/golden_heart'], ['POST', '/api/admin/relics/publish'],
    ['POST', '/api/admin/relics/rollback'], ['DELETE', '/api/admin/relics/draft'], ['GET', '/api/admin/relics/audit'],
    ['POST', '/api/admin/relics/draft/relics/golden_heart/revert'], ['DELETE', '/api/admin/relics/draft/relics/x_y']]) {
    assert.strictEqual((await call(m, u, m === 'GET' ? undefined : {}, { auth: false })).status, 401, `${m} ${u}`);
  }
  const view = await call('GET', '/api/admin/relics');
  assert.strictEqual(view.status, 200);
  assert.deepStrictEqual(Object.keys(view.body.effects).sort(), ['autodig_bonus', 'coins_pct', 'damage_flat', 'hp_reduction', 'luck_pct', 'relic_fragment_bonus']);
  assert.strictEqual(view.body.holders.saves, 0);
  const h = pub.body.relics.find(r => r.id === 'golden_heart');
  assert.strictEqual((await call('PUT', '/api/admin/relics/draft/relics/autre', { relic: h })).status, 400, 'identifiant incohérent');
  const bad = await call('PUT', '/api/admin/relics/draft/relics/golden_heart', { relic: { ...h, values: [0.15, 0.3, 0.5, 0.75, 9] } });
  assert.strictEqual(bad.status, 400);
  const put = await call('PUT', '/api/admin/relics/draft/relics/golden_heart', { relic: { ...h, costs: [9, 18, 35, 55, 80] } });
  assert.strictEqual(put.status, 200);
  assert.strictEqual((await call('GET', '/api/admin/relics')).body.draft.changes[0].id, 'golden_heart');
  assert.strictEqual((await call('DELETE', '/api/admin/relics/draft')).body.discarded, true);
  assert.deepStrictEqual((await call('GET', '/api/relics/catalog', undefined, { auth: false })).body, pub.body, 'rien de publié');

  // Atelier d'icônes (#40) : la relique est une cible, sans génération ni brouillon créé
  const target = await call('GET', '/api/admin/icons/targets/relic%3Agolden_heart');
  assert.strictEqual(target.status, 200, JSON.stringify(target.body));
  const tg = target.body.target;
  assert.deepStrictEqual([tg.kind, tg.name, tg.applicable, tg.emoji], ['relic', 'Cœur d\'or', true, '💛']);
  assert.match(tg.prompt, /Golden Heart/);
  const icons = await call('GET', '/api/admin/icons');
  assert.ok(icons.body.targets.some(x => x.key === 'relic:shard_magnet'));
  assert.strictEqual((await call('GET', '/api/admin/relics')).body.draft, null);
});
