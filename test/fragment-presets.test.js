/**
 * Préréglages « rareté des fragments » (#49, demande du propriétaire du 06/11), sur base isolée :
 * - valides avec les prix de production (800 / 15 000 / 80 000), sans boucle de profit ;
 * - charger un préréglage ne remplit que le brouillon : version en vigueur, tirage serveur et
 *   tables publiques inchangés ; recharger le même préréglage ne change rien (idempotent) ;
 * - après publication (base de test seulement) : limite par saison appliquée par le serveur,
 *   aucun fragment déjà gagné retiré, retour arrière vers v1 ;
 * - outil de simulation : reproductible, sans effet sur les règles du jeu.
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-frag-presets-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db        = require('../server/db');
const rewards   = require('../server/rewardTables');
const chestShop = require('../server/chestShop');

db.initDb();
rewards.init();

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const COSTS = { simple: 800, rare: 15000, antique: 80000 };
const IDS = Object.keys(rewards.PRESETS);

test('préréglages P et R : valides aux prix de production, fragments en baisse dans chaque coffre', () => {
  assert.deepStrictEqual(IDS, ['fragments_prudente', 'fragments_rare']);
  const origin = rewards.originTables();
  const frag = (t) => rewards.tableStats(t).expectedFragments;
  for (const id of IDS) {
    const v = rewards.validateTables(rewards.presetTables(id), { costs: COSTS });
    assert.deepStrictEqual(v.errors, [], id);
    assert.deepStrictEqual(v.warnings, [], id);
    for (const k of rewards.MINED_IDS) assert.ok(frag(v.tables.mined[k]) < frag(origin.mined[k]), `${id} miné ${k}`);
    for (const k of rewards.SHOP_IDS) {
      assert.ok(frag(v.tables.shop[k].table) < frag(origin.shop[k].table), `${id} boutique ${k}`);
      assert.ok(Number.isInteger(v.tables.shop[k].maxPerSeason), `${id} boutique ${k} limitée`);
      assert.ok(rewards.tableStats(v.tables.shop[k].table).expectedCoins < COSTS[k] * 0.8, `${id} ${k} sans boucle de profit`);
    }
  }
  // R : plus aucun fragment dans le coffre simple ; R plus rare que P partout
  const r = rewards.presetTables('fragments_rare'), p = rewards.presetTables('fragments_prudente');
  assert.strictEqual(frag(r.shop.simple.table), 0);
  for (const k of rewards.MINED_IDS) assert.ok(frag(r.mined[k]) < frag(p.mined[k]), k);
  // Les préréglages exportés sont des copies (pas de modification par l'appelant)
  rewards.presetTables('fragments_rare').mined.commun[0].weight = 1;
  assert.notStrictEqual(rewards.presetTables('fragments_rare').mined.commun[0].weight, 1);
});

test('charger un préréglage = brouillon seulement : jeu, tirage serveur et tables publiques inchangés', () => {
  const before = rewards.getPublished();
  const descBefore = chestShop.describeChests({});
  const out = rewards.applyPreset('fragments_rare', { costs: COSTS });
  assert.ok(out.draft, 'brouillon créé');
  assert.deepStrictEqual(out.errors, []);
  assert.strictEqual(rewards.getPublished().version, before.version);
  assert.deepStrictEqual(rewards.getPublished().tables, before.tables);
  assert.deepStrictEqual(chestShop.describeChests({}), descBefore);
  assert.deepStrictEqual(rewards.publicMined(), before.tables.mined);
  // Idempotent : recharger le même préréglage laisse le même brouillon
  const again = rewards.applyPreset('fragments_rare', { costs: COSTS });
  assert.deepStrictEqual(again.draft.tables, out.draft.tables);
  assert.strictEqual(rewards.listVersions().length, 1);
  // Un autre préréglage remplace le brouillon ; préréglage inconnu refusé sans rien toucher
  rewards.applyPreset('fragments_prudente', { costs: COSTS });
  assert.deepStrictEqual(rewards.getDraft().tables, rewards.presetTables('fragments_prudente'));
  assert.throws(() => rewards.applyPreset('tout_gratuit', { costs: COSTS }), e => e.status === 400);
  assert.deepStrictEqual(rewards.getDraft().tables, rewards.presetTables('fragments_prudente'));
  const actions = rewards.listAudit().map(a => a.action);
  assert.ok(actions.filter(a => a === 'draft_preset').length >= 3);
  assert.ok(!actions.includes('publish'));
  assert.ok(rewards.discardDraft());
  assert.strictEqual(rewards.getDraft(), null);
});

test('après publication (base de test) : limite saisonnière serveur, fragments acquis conservés, retour à v1', () => {
  rewards.applyPreset('fragments_rare', { costs: COSTS });
  const { version } = rewards.publishDraft({ note: 'test', costs: COSTS });
  assert.strictEqual(version, 2);
  const save = { coins: 10_000_000, relicFragments: 1234, relics: { shard_magnet: 5 }, shopChestsBought: {} };
  let frags = 0;
  for (let i = 0; i < 20; i++) {
    const r = chestShop.rollChest('simple', save, {});
    assert.notStrictEqual(r.reward.type, 'relics', 'R : le coffre simple ne donne plus de fragments');
  }
  assert.throws(() => chestShop.rollChest('simple', save, {}), /Limite saisonnière/);
  for (let i = 0; i < 10; i++) {
    const before = save.relicFragments;
    chestShop.rollChest('rare', save, {});
    assert.ok(save.relicFragments >= before, 'aucun fragment retiré');
    frags += save.relicFragments - before;
  }
  assert.throws(() => chestShop.rollChest('rare', save, {}), /Limite saisonnière/);
  assert.ok(save.relicFragments >= 1234);
  assert.ok(frags <= 10 * 7 + 10 * 5, 'au plus (2 + Aimant 5) par ligne ou 5 de consolation');
  // Retour arrière : nouvelle version au contenu de v1, version 2 conservée
  const rb = rewards.rollbackTo(1, { costs: COSTS });
  assert.strictEqual(rb.version, 3);
  assert.deepStrictEqual(rewards.getPublished().tables, rewards.getVersion(1).tables);
  assert.strictEqual(rewards.listVersions().length, 3);
  const fresh = { coins: 10_000_000, relicFragments: 0, shopChestsBought: {} };
  for (let i = 0; i < 25; i++) chestShop.rollChest('simple', fresh, {});   // v1 : illimité
  assert.strictEqual(fresh.shopChestsBought.simple, 25);
});

test('fragment-rarity-sim : reproductible, variantes conformes aux préréglages, jeu inchangé', () => {
  const sim = require('../tools/balance/fragment-rarity-sim');
  const core = require('../tools/balance/economy-sim');
  const tablesBefore = JSON.stringify(core.G.Chests.TABLES);
  const prod = sim.variantRules('actuel');
  assert.strictEqual(prod.fragmentShop, false, 'boutique de fragments suspendue en production (05/11)');
  assert.strictEqual(prod.shopLimits.simple, null);
  const r = sim.variantRules('R');
  assert.deepStrictEqual(r.mineTables, rewards.presetTables('fragments_rare').mined);
  assert.strictEqual(r.shopLimits.rare, 10);
  assert.deepStrictEqual(sim.variantRules('R+A').magnet, [1, 1, 2, 2, 3]);
  const a = sim.seasonsFor('debutant', 'R', true, 30), b = sim.seasonsFor('debutant', 'R', true, 30);
  assert.deepStrictEqual(a, b);
  const now = sim.seasonsFor('debutant', 'actuel', false, 30);
  assert.ok(a[0].frags.p50 < now[0].frags.p50 + 1e-9 || a[0].frags.mean < now[0].frags.mean);
  assert.strictEqual(JSON.stringify(core.G.Chests.TABLES), tablesBefore);
  assert.strictEqual(sim.RELIC_LEVELS, 30);
});
