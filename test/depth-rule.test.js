/**
 * Règle « aucune profondeur maximale » (#22, décision du propriétaire du 30/10/2026) : chaque type
 * de bloc, coffres compris, apparaît « dès X m » puis reste possible (P > 0) à toute profondeur.
 * - chaque bloc : absent juste avant son seuil, possible au seuil, à 500, 5 000 et 100 000 m
 *   (serveur et client, catalogue d'origine et catalogue publié, Chance 0 et 10) ;
 * - historique de production (versions 1-2 avec bornes 12 / 22 m) : un retour arrière ne
 *   réintroduit aucune borne, le budget anti-bot reste 3 / 6 / 8 PV ;
 * - saisie admin d'une borne refusée ; ancien catalogue mémorisé avec borne ignoré par le client.
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const vm     = require('vm');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-depth-rule-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db      = require('../server/db');
const antibot = require('../server/antibot');
const catalog = require('../server/blockCatalog');

db.initDb();
const conn = () => db.getDb();

function loadClient() {
  const ctx = { Math: Object.create(Math), t: k => k, console, I18n: { getCurrent: () => 'fr' } };
  ctx.GameState = { upgrades: { luck: 0 }, relicBonuses: { hpReduction: 0 }, blockSeq: 0, blockSeed: 777, gems: 0 };
  vm.createContext(ctx);
  vm.runInContext(`${fs.readFileSync(path.join(ROOT, 'public/js/blocks.js'), 'utf8')}\n;this.Blocks = Blocks;`, ctx);
  return ctx.Blocks;
}

const FAR = [500, 5000, 100000];
/** Copie dans ce contexte (les objets du client viennent d'un autre contexte vm). */
const plain = v => JSON.parse(JSON.stringify(v));

/** Vérifie la règle pour un tirage `odds(depth, luck)` → Map id → p. */
function checkRule(types, oddsAt, label) {
  for (const luck of [0, 10]) {
    for (const t of types.filter(x => x.active !== false)) {
      const id = t.id;
      if (t.minDepth > 1) assert.ok(!(oddsAt(t.minDepth - 1, luck).get(id) > 0), `${label} : ${id} absent à ${t.minDepth - 1} m`);
      for (const d of [t.minDepth, t.minDepth + 1, ...FAR.filter(x => x >= t.minDepth)]) {
        assert.ok(oddsAt(d, luck).get(id) > 0, `${label} : ${id} possible à ${d} m (Chance ${luck})`);
      }
    }
    for (const d of [1, ...FAR]) {
      const sum = [...oddsAt(d, luck).values()].reduce((s, p) => s + p, 0);
      assert.ok(Math.abs(sum - 1) < 1e-9, `${label} : somme = 1 à ${d} m`);
    }
  }
}

test('client, catalogue d\'origine (avant réception du catalogue publié) : 14 blocs dès X m, sans maximum', () => {
  const B = loadClient();
  assert.strictEqual(B.TYPES.length, 14);
  assert.ok(B.TYPES.every(t => t.maxDepth === undefined), 'aucune borne dans blocks.js');
  const types = B.TYPES.map(t => ({ ...t, id: B.idOf(t) }));
  checkRule(types, (d, luck) => new Map(B.blockOdds(d, luck).map(e => [B.idOf(e.type), e.p])), 'origine');
  // Coffres compris
  assert.deepStrictEqual(plain(types.filter(t => t.category === 'coffre').map(t => t.id).sort()), ['coffre_bois', 'coffre_fer', 'vieille_caisse']);
});

test('historique de production (bornes 12 / 22 m en v1) : migrations et retour arrière sans borne, budget inchangé', () => {
  // Reproduit la base de production : v1 = blocs d'origine avec les anciennes bornes, sans atténuation
  const legacyV1 = plain(catalog.originTypes()).map(t => {
    const { fadeFrom, fadeWeight, ...rest } = t;
    return fadeFrom != null ? { ...rest, maxDepth: fadeFrom } : rest;
  });
  assert.deepStrictEqual(legacyV1.filter(t => t.maxDepth != null).map(t => [t.id, t.maxDepth]), [['terre_meuble', 12], ['argile', 22]]);
  assert.deepStrictEqual(legacyV1.map(catalog.liftLegacyBound), plain(catalog.originTypes()).map(t => {
    const { fadeFrom, fadeWeight, ...rest } = t;
    return fadeFrom != null ? { ...rest, maxDepth: null, fadeFrom, fadeWeight } : rest;
  }), 'mêmes atténuations que la décision du 30/10 (2,1 et 1,35)');
  // Borne inconnue : atténuation à 3 % du poids, jamais nulle
  assert.deepStrictEqual(catalog.liftLegacyBound({ id: 'x', weight: 0.01, maxDepth: 40 }), { id: 'x', weight: 0.01, maxDepth: null, fadeFrom: 40, fadeWeight: 0.001 });
  const v = catalog.validateCatalog(legacyV1, { requiredIds: new Set() });
  assert.deepStrictEqual(v.errors, []);
  assert.ok(v.types.every(t => t.maxDepth === null));
  assert.ok(v.warnings.some(w => w.includes('terre_meuble') && w.includes('convertie')));

  conn().exec(`CREATE TABLE block_catalog_versions (
      version INTEGER PRIMARY KEY, types TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('origin', 'publish', 'rollback')),
      note TEXT, from_version INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  conn().prepare("INSERT INTO block_catalog_versions (version, types, source, note) VALUES (1, ?, 'origin', 'v1 de production')")
    .run(JSON.stringify(legacyV1));
  catalog.init();
  assert.ok(catalog.getVersion(1).types.some(t => t.maxDepth === 12), 'historique v1 intact (ajout seul)');
  assert.ok(catalog.getPublished().types.every(t => t.maxDepth === null), 'migrations : aucune borne publiée');
  const v2 = catalog.getPublished().version;
  catalog.rollbackTo(1);
  const back = catalog.getPublished();
  assert.ok(back.types.every(t => t.maxDepth === null), 'retour arrière vers v1 : aucune borne republiée');
  const terre = back.types.find(t => t.id === 'terre_meuble');
  assert.deepStrictEqual([terre.fadeFrom, terre.fadeWeight], [12, 2.1]);
  checkRule(back.types, (d, luck) => new Map(catalog.odds(back.types, d, luck).map(e => [e.id, e.p])), 'après retour arrière');
  // Budget anti-bot : versions à bornes et atténuées confondues, toujours 3 / 6 / 8 PV
  assert.deepStrictEqual(antibot.getMinHpSegments(), antibot.MIN_HP_SEGMENTS);
  catalog.rollbackTo(v2);
});

test('serveur et client, catalogue publié (22 types) : dès X m, P > 0 à 500 / 5 000 / 100 000 m', () => {
  const pub = catalog.getPublished();
  assert.strictEqual(pub.types.length, 22);
  assert.ok(pub.types.every(t => t.maxDepth === null));
  checkRule(pub.types, (d, luck) => new Map(catalog.odds(pub.types, d, luck).map(e => [e.id, e.p])), 'serveur');
  const B = loadClient();
  assert.ok(B.applyCatalog(catalog.publicCatalog({ format: 2 })));
  checkRule(pub.types, (d, luck) => new Map(B.blockOdds(d, luck).map(e => [B.idOf(e.type), e.p])), 'client publié');
  // Format 1 (client non rechargé) : aucune borne non plus
  const B1 = loadClient();
  assert.ok(B1.applyCatalog(catalog.publicCatalog()));
  checkRule(pub.types, (d, luck) => new Map(B1.blockOdds(d, luck).map(e => [B1.idOf(e.type), e.p])), 'client format 1');
});

test('client : un ancien catalogue mémorisé avec borne maximale est appliqué sans la borne', () => {
  const B = loadClient();
  const types = catalog.getPublished().types.map(t => (t.id === 'terre_meuble' ? { ...t, fadeFrom: undefined, fadeWeight: undefined, maxDepth: 12 } : t));
  const storage = { getItem: () => JSON.stringify({ version: 2, types }) };
  assert.ok(B.loadCached(storage));
  for (const d of [13, ...FAR]) assert.ok(B.blockOdds(d, 0).some(e => B.idOf(e.type) === 'terre_meuble' && e.p > 0), `${d} m`);
});

test('admin : une profondeur maximale est refusée à la saisie, même pour un bloc d\'origine', () => {
  const pierre = catalog.getPublished().types.find(t => t.id === 'pierre');
  assert.throws(() => catalog.upsertDraftType({ ...pierre, maxDepth: 300 }), e => e.status === 400 && /aucune profondeur maximale/.test(e.message));
  assert.strictEqual(catalog.getDraft(), null, 'brouillon inchangé');
});

test.after(() => {
  try { db.getDb().close(); } catch (_) {}
  fs.rmSync(dir, { recursive: true, force: true });
});
