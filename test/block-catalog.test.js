/**
 * Tests du catalogue de blocs administrable, ticket #37 (étape A) :
 * - migration : la version 1 reprend à l'identique les 14 blocs du client (mêmes probabilités
 *   à toutes les profondeurs, avec et sans Chance), idempotente ;
 * - validation : nom FR des nouveaux blocs, pas de profondeur maximale, poids > 0, aucun bloc
 *   publié supprimé, au moins un bloc à chaque profondeur, couleurs et images sûres ;
 * - brouillon → publication atomique, version périmée refusée, retour arrière, journal en ajout seul ;
 * - budget anti-bot (#25) : PV minimum = minimum sur toutes les versions, jamais plus strict ;
 * - client : catalogue publié appliqué, nouveau bloc tiré dès sa profondeur, bloc désactivé
 *   repris tel quel (#35), nom affiché ;
 * - simulation 100 000 tirages ≈ probabilités théoriques ;
 * - routes HTTP : catalogue public, routes admin protégées (serveur de test, port ≠ 3000).
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
const PORT  = process.env.DIG_TEST_PORT_BLOCKS || '3148';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-blocks-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db      = require('../server/db');
const antibot = require('../server/antibot');
const catalog = require('../server/blockCatalog');

db.initDb();
catalog.init({ contentMigrations: false });
const conn = () => db.getDb();

function loadClient() {
  const ctx = { Math: Object.create(Math), t: k => k, console, I18n: { getCurrent: () => 'en' } };
  ctx.GameState = { upgrades: { luck: 0 }, relicBonuses: { hpReduction: 0 }, blockSeq: 0, blockSeed: 12345 };
  vm.createContext(ctx);
  const code = fs.readFileSync(path.join(ROOT, 'public/js/blocks.js'), 'utf8');
  vm.runInContext(`${code}\n;this.Blocks = Blocks;`, ctx);
  return ctx;
}

const code = fn => { try { fn(); } catch (e) { return e.status ?? e.message; } return 'ok'; };
const NEW = { id: 'basalte', names: { fr: 'Basalte', en: 'Basalt' }, category: 'minerai', icon: '🟣', rarity: 'rare',
  color: 'linear-gradient(145deg,#4c1d95,#1e1b4b)', accent: '#a78bfa', hpBase: 400, reward: 900, minDepth: 260, weight: 3 };

test('migration : version 1 = les 14 blocs du client, probabilités identiques, idempotente', () => {
  catalog.init({ contentMigrations: false });
  assert.strictEqual(conn().prepare('SELECT COUNT(*) n FROM block_catalog_versions').get().n, 1);
  const v1 = catalog.getPublished();
  assert.strictEqual(v1.version, 1);
  assert.strictEqual(v1.types.length, 14);
  const client = loadClient();
  const B = client.Blocks;
  assert.deepStrictEqual(v1.types.map(t => `block.${t.id}`), [...B.TYPES.map(t => t.name)]);
  for (const [i, t] of v1.types.entries()) {
    const c = B.TYPES[i];
    assert.strictEqual(JSON.stringify([t.hpBase, t.reward, t.minDepth, t.weight, t.fadeFrom, t.fadeWeight, t.rarity, t.category, t.icon, t.color, t.accent]),
      JSON.stringify([c.hpBase, c.reward, c.minDepth, c.weight, c.fadeFrom, c.fadeWeight, c.rarityKey, c.category, c.icon, c.color, c.accent]), t.id);
  }
  // Aucune profondeur maximale (#22) : terre meuble et argile seulement atténuées au-delà de 12 / 22 m
  assert.ok(v1.types.every(t => t.maxDepth === null));
  assert.deepStrictEqual(v1.types.filter(t => t.fadeFrom != null).map(t => [t.id, t.fadeFrom, t.fadeWeight]),
    [['terre_meuble', 12, 2.1], ['argile', 22, 1.35]]);
  // Même tirage que le client, après application du catalogue publié, à toutes les profondeurs
  assert.ok(B.applyCatalog(catalog.publicCatalog({ format: 2 })));
  for (const luck of [0, 5]) {
    for (let d = 1; d <= 600; d += 1) {
      const server = catalog.odds(v1.types, d, luck);
      const cl = B.blockOdds(d, luck).map(e => ({ id: B.idOf(e.type), p: e.p }));
      assert.strictEqual(server.length, cl.length, `${d} m`);
      for (const [j, e] of server.entries()) {
        assert.strictEqual(e.id, cl[j].id);
        assert.ok(Math.abs(e.p - cl[j].p) < 1e-12, `${d} m, Chance ${luck}, ${e.id}`);
      }
    }
  }
  assert.strictEqual(catalog.validateCatalog(v1.types).errors.length, 0);
});

test('validation : nouveaux blocs, profondeur maximale, poids, suppression, couverture', () => {
  const v1 = catalog.getPublished().types;
  assert.strictEqual(code(() => catalog.normalizeType({ ...NEW, names: null })), 400, 'nom FR obligatoire');
  assert.strictEqual(code(() => catalog.normalizeType({ ...NEW, maxDepth: 500 })), 400, 'pas de profondeur maximale');
  for (const bad of [{ weight: 0 }, { weight: -1 }, { hpBase: 0 }, { hpBase: 1.5 }, { minDepth: 0 }, { reward: -1 },
    { id: 'Bad Id' }, { id: 'x' }, { category: 'lave' }, { rarity: 'mythique' }, { icon: '' }, { icon: '<b>' },
    { color: 'red;background:url(x)' }, { accent: 'javascript:1' }, { image: 'https://evil.test/x.png' },
    { image: '/assets/../server/data/dig.sqlite.png' }, { names: { fr: '<img src=x>' } }]) {
    assert.strictEqual(code(() => catalog.normalizeType({ ...NEW, ...bad })), 400, JSON.stringify(bad));
  }
  assert.strictEqual(catalog.normalizeType({ ...NEW, image: '/assets/icons/v1/basalte.webp' }).image, '/assets/icons/v1/basalte.webp');
  // Aucune profondeur maximale, même pour un bloc d'origine (#22)
  assert.strictEqual(code(() => catalog.normalizeType({ ...v1[0], fadeFrom: null, maxDepth: 15 })), 400, 'pas de borne sur un bloc d\'origine');
  // Aucun bloc publié supprimé ; chaque profondeur couverte
  const removed = catalog.validateCatalog(v1.filter(t => t.id !== 'rubis'));
  assert.ok(removed.errors.some(e => e.includes('rubis')));
  const empty = catalog.validateCatalog(v1.map(t => ({ ...t, active: ['diamant'].includes(t.id) })));
  assert.ok(empty.errors.some(e => e.includes('Aucun bloc actif à 1 m')));
  const dup = catalog.validateCatalog([...v1, v1[3]]);
  assert.ok(dup.errors.some(e => e.includes('double')));
});

test('brouillon → publication atomique, version périmée, retour arrière, journal en ajout seul', () => {
  assert.strictEqual(code(() => catalog.publishDraft()), 409, 'aucun brouillon');
  catalog.upsertDraftType(NEW);
  assert.strictEqual(catalog.getPublished().types.length, 14, 'le brouillon ne touche pas la version publiée');
  const view = catalog.buildAdminView();
  assert.deepStrictEqual(view.draft.changes, [{ id: 'basalte', kind: 'added' }]);
  assert.strictEqual(code(() => catalog.publishDraft({ expectedBasedOn: 7 })), 409, 'version attendue périmée');
  const pub = catalog.publishDraft({ note: 'Ajout basalte' });
  assert.strictEqual(pub.version, 2);
  assert.strictEqual(catalog.getDraft(), null);
  assert.strictEqual(catalog.getPublished().types.length, 15);
  // Un bloc publié ne se retire pas du brouillon : il se désactive
  catalog.upsertDraftType({ ...NEW, active: false });
  assert.strictEqual(code(() => catalog.removeDraftType('basalte')), 409);
  catalog.discardDraft();
  // Brouillon basé sur une version remplacée entre-temps : refusé
  catalog.upsertDraftType({ ...NEW, weight: 4 });
  assert.strictEqual(code(() => catalog.rollbackTo(99)), 404);
  assert.strictEqual(code(() => catalog.rollbackTo(2)), 409, 'déjà en vigueur');
  const rb = catalog.rollbackTo(1, { note: 'test' });
  assert.deepStrictEqual(rb, { version: 3, restored: 1 });
  const after = catalog.getPublished();
  assert.strictEqual(after.types.length, 15, 'le bloc ajouté reste présent');
  assert.strictEqual(after.types.find(t => t.id === 'basalte').active, false, '… mais désactivé');
  assert.strictEqual(code(() => catalog.publishDraft()), 409, 'brouillon basé sur v2, version en vigueur v3');
  catalog.discardDraft();
  assert.throws(() => conn().prepare('UPDATE block_catalog_audit SET action = ?').run('x'), /ajout seul/);
  assert.throws(() => conn().prepare('DELETE FROM block_catalog_versions').run(), /ajout seul/);
  assert.deepStrictEqual(catalog.listAudit().map(a => a.action).slice(0, 3), ['draft_discard', 'rollback', 'draft_update']);
});

test('anti-bot : PV minimum = minimum sur toutes les versions, jamais plus strict que l\'origine', () => {
  const origin = antibot.MIN_HP_SEGMENTS;
  const before = d => antibot.minBlockHp(d);
  const ref = [1, 12, 13, 22, 23, 300].map(before);
  // Bloc d'origine rendu plus résistant : le budget ne se resserre pas (anciens clients)
  const terre = catalog.getPublished().types.find(t => t.id === 'terre_meuble');
  catalog.upsertDraftType({ ...terre, hpBase: 30 });
  catalog.publishDraft();
  assert.deepStrictEqual([1, 12, 13, 22, 23, 300].map(before), ref);
  // Bloc plus faible et sans borne : le budget suit (plus permissif)
  catalog.upsertDraftType({ ...NEW, id: 'poussiere', names: { fr: 'Poussière' }, category: 'terre', rarity: 'commun', hpBase: 2, minDepth: 100, active: true });
  catalog.publishDraft();
  assert.ok(antibot.minBlockHp(150) < ref[5]);
  assert.strictEqual(antibot.minBlockHp(1), ref[0]);
  for (const s of antibot.getMinHpSegments()) {
    const o = origin.find(x => s.from >= x.from && s.from <= x.to);
    assert.ok(s.hpBase <= o.hpBase, `segment ${s.from} : ${s.hpBase} > ${o.hpBase}`);
  }
});

test('client : catalogue publié appliqué, nouveau bloc dès sa profondeur, bloc désactivé repris', () => {
  const client = loadClient();
  const B = client.Blocks;
  const pub = catalog.publicCatalog();
  assert.ok(B.applyCatalog(pub));
  assert.strictEqual(B.catalogVersion, pub.version);
  assert.strictEqual(B.byId('poussiere').minDepth, 100);
  assert.ok(!B.blockOdds(99, 0).some(e => e.type.id === 'poussiere'));
  assert.ok(B.blockOdds(5000, 0).some(e => e.type.id === 'poussiere' && e.p > 0), 'aucune profondeur maximale');
  assert.ok(!B.blockOdds(500, 0).some(e => e.type.id === 'basalte'), 'désactivé : plus tiré');
  assert.strictEqual(B.displayName(B.byId('poussiere'), 'nl'), 'Poussière', 'repli sur le nom FR');
  assert.strictEqual(B.displayName(B.byId('pierre'), 'fr'), 'block.pierre', 'bloc d\'origine : traduction intégrée');
  // Bloc désactivé sauvegardé : repris à l'identique (#35)
  client.GameState.blockSeq = 10;
  const saved = { name: 'block.basalte', hp: 50, maxHp: 900, reward: 1200, depth: 300, seq: 10 };
  assert.strictEqual(B.resume(saved, 300), true);
  assert.strictEqual(B.current.type.id, 'basalte');
  // Catalogue invalide ignoré
  assert.strictEqual(B.applyCatalog({ version: 99, types: [{ id: 'x' }] }), false);
  assert.strictEqual(B.applyCatalog({ version: 99, types: pub.types.map(t => ({ ...t, active: false })) }), false);
  assert.strictEqual(B.catalogVersion, pub.version);
});

test('simulation : 100 000 tirages ≈ probabilités théoriques, paramètres bornés', () => {
  const types = catalog.getPublished().types;
  const [r] = catalog.simulate(types, { depths: [250], n: 100000, luckLevel: 3 });
  const sum = r.types.reduce((s, x) => s + x.p, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  for (const x of r.types) assert.ok(Math.abs(x.p - x.observed) < 0.01, `${x.id} : ${x.p} vs ${x.observed}`);
  assert.ok(r.avgHp > 0 && r.avgReward > 0);
  assert.strictEqual(code(() => catalog.simulate(types, { n: 5 })), 400);
  assert.strictEqual(code(() => catalog.simulate(types, { depths: [0] })), 400);
});

test('routes : catalogue public, administration protégée', async (t) => {
  const httpDb = path.join(dir, 'http.sqlite');
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: httpDb, ADMIN_SECRET: ADMIN, SESSION_SECRET: crypto.randomBytes(16).toString('hex') },
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

  const pub = await call('GET', '/api/blocks/catalog', undefined, { auth: false });
  assert.strictEqual(pub.status, 200);
  // Serveur complet (base neuve) : v1 (origine, déjà sans borne, #22) + v2 (8 minerais de l'étape B)
  assert.deepStrictEqual([pub.body.version, pub.body.types.length], [2, 22]);
  assert.ok(pub.body.types.every(t => t.maxDepth === null), 'aucune profondeur maximale (format 1 compris)');

  for (const [m, u] of [['GET', '/api/admin/blocks'], ['PUT', '/api/admin/blocks/draft/types/basalte'], ['POST', '/api/admin/blocks/publish'],
    ['POST', '/api/admin/blocks/rollback'], ['POST', '/api/admin/blocks/simulate'], ['DELETE', '/api/admin/blocks/draft'], ['GET', '/api/admin/blocks/audit']]) {
    assert.strictEqual((await call(m, u, m === 'GET' ? undefined : {}, { auth: false })).status, 401, `${m} ${u}`);
  }
  assert.strictEqual((await call('PUT', '/api/admin/blocks/draft/types/autre', { type: NEW })).status, 400, 'identifiant incohérent');
  assert.strictEqual((await call('PUT', '/api/admin/blocks/draft/types/basalte', { type: NEW })).status, 200);
  const sim = await call('POST', '/api/admin/blocks/simulate', { source: 'draft', n: 10000, depths: [300], luckLevel: 0 });
  assert.strictEqual(sim.status, 200);
  assert.ok(sim.body.results[0].types.some(x => x.id === 'basalte'));
  const p = await call('POST', '/api/admin/blocks/publish', { note: 'test', basedOn: 2 });
  assert.deepStrictEqual([p.status, p.body.version], [200, 3]);
  const pub2 = await call('GET', '/api/blocks/catalog', undefined, { auth: false });
  assert.deepStrictEqual([pub2.body.version, pub2.body.types.length], [3, 23]);
  const rb = await call('POST', '/api/admin/blocks/rollback', { version: 2 });
  assert.deepStrictEqual([rb.status, rb.body.version], [200, 4]);
  const admin = await call('GET', '/api/admin/blocks');
  assert.strictEqual(admin.body.published.types.find(x => x.id === 'basalte').active, false);
  assert.ok(admin.body.antibotSegments.length >= 3);
  const audit = await call('GET', '/api/admin/blocks/audit');
  assert.deepStrictEqual(audit.body.audit.map(a => a.action), ['rollback', 'publish', 'draft_add', 'content:surface-fade', 'content:step-b-ores', 'migrate']);
});

test.after(() => {
  try { db.getDb().close(); } catch (_) {}
  fs.rmSync(dir, { recursive: true, force: true });
});
