/**
 * Tests de l'étape B du catalogue de blocs, ticket #37 (décision du propriétaire du 30/10/2026) :
 * - migrations de contenu : v2 = 8 nouveaux minerais (chiffres du rapport), v3 = terre meuble et
 *   argile sans borne maximale mais atténuées ; une seule fois (idempotent), v1 intacte ;
 * - probabilités : tout type actif débloqué garde une probabilité > 0 à toute profondeur ;
 *   surface ≈ 2 % en profondeur ; client et serveur identiques (format 2) ;
 * - clients non rechargés (format 1) : aucune borne maximale non plus (#22) ;
 * - aucune gemme pour saphir / améthyste / cristal ancien (gemReward: false) ;
 * - budget anti-bot (#25) inchangé par l'atténuation.
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-blocks-b-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db      = require('../server/db');
const antibot = require('../server/antibot');
const catalog = require('../server/blockCatalog');

db.initDb();
const conn = () => db.getDb();

function loadClient() {
  const ctx = { Math: Object.create(Math), t: k => k, console, I18n: { getCurrent: () => 'nl' } };
  ctx.GameState = { upgrades: { luck: 0 }, relicBonuses: { hpReduction: 0 }, blockSeq: 0, blockSeed: 777, gems: 0 };
  vm.createContext(ctx);
  vm.runInContext(`${fs.readFileSync(path.join(ROOT, 'public/js/blocks.js'), 'utf8')}\n;this.Blocks = Blocks;`, ctx);
  return ctx.Blocks;
}

const EXPECTED = [
  ['quartz', 150, 45, 70, 14], ['obsidienne', 200, 60, 40, 16], ['minerai_argent', 260, 95, 260, 7],
  ['saphir', 330, 150, 1900, 2.5], ['minerai_platine', 420, 120, 520, 5], ['amethyste', 520, 170, 2600, 2],
  ['fer_meteorique', 650, 220, 5200, 1], ['cristal_ancien', 800, 300, 9000, 0.6],
];

test('migrations de contenu : v2 = 8 minerais, atténuation de surface déjà dans l\'origine, une seule fois', () => {
  catalog.init();
  catalog.init();
  const versions = conn().prepare('SELECT version, source FROM block_catalog_versions ORDER BY version').all();
  // Base neuve : l'origine (blocks.js) est déjà sans borne (#22), la migration « surface-fade » n'a rien à publier
  assert.deepStrictEqual(versions.map(v => v.version), [1, 2]);
  assert.strictEqual(catalog.getVersion(1).types.length, 14, 'v1 intacte');
  const v2 = catalog.getVersion(2).types;
  assert.strictEqual(v2.length, 22);
  for (const [id, minDepth, hpBase, reward, weight] of EXPECTED) {
    const t = v2.find(x => x.id === id);
    assert.deepStrictEqual([t.minDepth, t.hpBase, t.reward, t.weight, t.maxDepth, t.active], [minDepth, hpBase, reward, weight, null, true], id);
    for (const l of ['fr', 'en', 'nl']) assert.ok(t.names[l], `${id} : nom ${l}`);
    assert.notStrictEqual(t.names.nl, t.names.fr, `${id} : traduction NL réelle, pas le français recopié`);
  }
  // v2 : les 14 blocs d'origine inchangés
  assert.deepStrictEqual(catalog.diff(catalog.getVersion(1).types, v2).map(c => c.kind), Array(8).fill('added'));
  const v3 = catalog.getPublished();
  assert.strictEqual(v3.version, 2);
  const terre = v3.types.find(t => t.id === 'terre_meuble'), argile = v3.types.find(t => t.id === 'argile');
  assert.deepStrictEqual([terre.maxDepth, terre.fadeFrom, terre.fadeWeight], [null, 12, 2.1]);
  assert.deepStrictEqual([argile.maxDepth, argile.fadeFrom, argile.fadeWeight], [null, 22, 1.35]);
  assert.strictEqual(catalog.validateCatalog(v3.types).errors.length, 0);
  assert.deepStrictEqual(catalog.listAudit().filter(a => a.action.startsWith('content:')).map(a => [a.action, a.version]),
    [['content:surface-fade', null], ['content:step-b-ores', 2]]);
});

test('probabilités : bloc débloqué toujours possible, surface ≈ 2 % en profondeur, client = serveur', () => {
  const types = catalog.getPublished().types;
  for (const d of [1, 12, 13, 22, 23, 100, 249, 800, 5000]) {
    const o = catalog.odds(types, d);
    for (const t of types.filter(x => x.active && d >= x.minDepth)) {
      assert.ok(o.find(e => e.id === t.id)?.p > 0, `${t.id} à ${d} m`);
    }
  }
  const surface = d => catalog.odds(types, d).filter(e => ['terre_meuble', 'argile'].includes(e.id)).reduce((s, e) => s + e.p, 0);
  assert.ok(surface(249) > 0.01 && surface(249) < 0.025, `surface à 249 m : ${surface(249)}`);
  assert.ok(surface(1000) > 0.005 && surface(1000) < 0.025);
  // Identique à l'ancien catalogue au-dessus de 12 m (rien ne change pour un débutant)
  const v1 = catalog.getVersion(1).types;
  for (let d = 1; d <= 12; d++) assert.deepStrictEqual(catalog.odds(types, d), catalog.odds(v1, d), `${d} m`);
  // Client au format 2 : mêmes probabilités que le serveur
  const B = loadClient();
  assert.ok(B.applyCatalog(catalog.publicCatalog({ format: 2 })));
  for (const luck of [0, 4]) {
    for (let d = 1; d <= 900; d += 7) {
      const s = catalog.odds(types, d, luck);
      const c = B.blockOdds(d, luck);
      assert.strictEqual(s.length, c.length, `${d} m`);
      s.forEach((e, i) => assert.ok(e.id === B.idOf(c[i].type) && Math.abs(e.p - c[i].p) < 1e-12, `${d} m ${e.id}`));
    }
  }
  assert.strictEqual(B.displayName(B.byId('minerai_argent')), 'Zilvererts');
  assert.ok(B.TYPES.filter(t => t.category === 'gemme' && t.isGem).map(t => t.id).join() === 'rubis,emeraude,diamant',
    'saphir, améthyste et cristal ancien ne rapportent pas de gemme');
});

test('clients non rechargés (format 1) : aucune borne maximale (#22), aucune gemme nouvelle', () => {
  const legacy = catalog.publicCatalog();
  assert.ok(legacy.types.every(t => t.maxDepth === null), 'aucune profondeur maximale, même pour un ancien client');
  assert.ok(legacy.types.every(t => t.fadeFrom === undefined && t.gemReward === undefined));
  assert.deepStrictEqual(legacy.types.filter(t => t.category === 'gemme').map(t => t.id), ['rubis', 'emeraude', 'diamant']);
  // Ancien client : terre et argile restent possibles en profondeur (poids normal, faute d'atténuation)
  const projected = legacy.types.map(t => ({ ...t, active: t.active !== false }));
  for (const d of [13, 30, 249, 700, 100000]) {
    const o = catalog.odds(projected, d);
    for (const id of ['terre_meuble', 'argile']) assert.ok(o.find(e => e.id === id)?.p > 0, `${id} à ${d} m`);
  }
});

test('validation de l\'atténuation et anti-bot inchangé', () => {
  const terre = catalog.getPublished().types.find(t => t.id === 'terre_meuble');
  const code = fn => { try { fn(); } catch (e) { return e.status; } return 'ok'; };
  assert.strictEqual(code(() => catalog.normalizeType({ ...terre, fadeWeight: 0 })), 400, 'poids atténué > 0');
  assert.strictEqual(code(() => catalog.normalizeType({ ...terre, fadeWeight: 70 })), 400, 'poids atténué < poids');
  assert.strictEqual(code(() => catalog.normalizeType({ ...terre, maxDepth: 12 })), 400, 'aucune profondeur maximale');
  assert.strictEqual(code(() => catalog.normalizeType({ ...terre, fadeFrom: 0 })), 400);
  assert.strictEqual(code(() => catalog.normalizeType({ ...terre, fadeFrom: '' })), 'ok', 'atténuation retirable');
  // Budget : identique aux valeurs d'origine (3 / 6 / 8) — l'atténuation ne le relâche pas
  assert.deepStrictEqual(antibot.getMinHpSegments(), antibot.MIN_HP_SEGMENTS);
});

test.after(() => {
  try { db.getDb().close(); } catch (_) {}
  fs.rmSync(dir, { recursive: true, force: true });
});
