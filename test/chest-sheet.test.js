/**
 * Fiche unique des coffres, ticket #88 (constat du propriétaire du 07/11) :
 * - reproduction du refus « 863 pièces en moyenne pour un prix de 800 » avec le brouillon réel
 *   (poids des fragments baissés à la main, PAS le préréglage P) et le vrai prix (override 800,
 *   défaut du code 2 000) ; conseils chiffrés de correction (prix ou part des tirages sans pièces) ;
 * - prix dans le brouillon : aucun effet avant publication ; publication = version + admin_config
 *   dans la même transaction ; retour arrière qui restaure les prix mémorisés (v1 : prix gardés) ;
 * - préréglage S sans fragments dans la boutique ; P et R signalés non conformes (#49) ;
 * - brouillon remplacé ou abandonné conservé dans le journal ;
 * - panel : six cartes, fiche avec prix, Économie et Config en lecture seule pour les prix.
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-chest-sheet-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db        = require('../server/db');
const rewards   = require('../server/rewardTables');
const chestShop = require('../server/chestShop');
const { getEconomy } = require('../server/economy');

db.initDb();
rewards.init();
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const costsNow = () => getEconomy(db.getAdminConfig()).chestCosts;
// Prix de production relevés le 07/11 (overrides admin_config) : simple 800, défaut du code 2 000
db.setAdminConfig('chest_cost_simple', '800');

/** Brouillon réel du 07/11 (8 enregistrements manuels, aucun préréglage) : poids des fragments 30 → 1, etc. */
function ownerDraft() {
  const t = rewards.originTables();
  t.shop.simple.table[1].weight = 1;
  return t;
}

test('863 / 800 reproduit : fragments retirés à la main → la part des pièces monte, conseils chiffrés', () => {
  const v = rewards.validateTables(ownerDraft(), { costs: costsNow() });
  assert.strictEqual(v.errors.length, 1);
  assert.match(v.errors[0], /coûte 800 pièces mais rend en moyenne 863 pièces — on pourrait gagner des pièces en l'achetant en boucle \(boucle de profit\)\./);
  const [iss] = v.issues;
  assert.deepStrictEqual({ id: iss.id, kind: iss.kind, cost: iss.cost, expectedCoins: iss.expectedCoins, coinShare: iss.coinShare,
    minPrice: iss.minPrice, priceUnder80: iss.priceUnder80, minNonCoinShare: iss.minNonCoinShare, nonCoinShareUnder80: iss.nonCoinShareUnder80 },
  { id: 'simple', kind: 'profit', cost: 800, expectedCoins: 863, coinShare: 77.5, minPrice: 864, priceUnder80: 1100, minNonCoinShare: 28.3, nonCoinShareUnder80: 42.6 });
  // Les deux corrections proposées suffisent réellement
  assert.deepStrictEqual(rewards.validateTables(ownerDraft(), { costs: { ...costsNow(), simple: iss.minPrice } }).errors, []);
  const fixed = ownerDraft();
  fixed.shop.simple.table[2].weight = 21;   // boost 15 → 21 : 22 tirages sans pièces sur 77 = 28,6 %
  assert.deepStrictEqual(rewards.validateTables(fixed, { costs: costsNow() }).errors, []);
  // Avec le défaut du code (2 000), même table acceptée : le contrôle utilise bien le prix réel
  assert.deepStrictEqual(rewards.validateTables(ownerDraft(), { costs: { ...costsNow(), simple: 2000 } }).errors, []);
  // Le préréglage P, lui, ne crée pas de boucle au prix réel (613 / 800)
  const p = rewards.validateTables(rewards.presetTables('fragments_prudente'), { costs: costsNow() });
  assert.deepStrictEqual(p.errors, []);
  assert.strictEqual(rewards.tableStats(p.tables.shop.simple.table).expectedCoins, 613);
});

test('prix dans le brouillon : rien en jeu avant publication, publication atomique, retour arrière des prix', () => {
  const before = costsNow();
  const t = rewards.getPublished().tables;
  // Prix identique au prix en vigueur : pas gardé, pas de brouillon
  t.shop.simple.cost = 800;
  assert.strictEqual(rewards.saveDraft(t, { costs: before }).draft, null);
  // Prix proposé : seulement dans le brouillon
  t.shop.simple.cost = 1000;
  t.shop.rare.maxPerSeason = 10;
  const saved = rewards.saveDraft(t, { costs: before });
  assert.deepStrictEqual(saved.changes.find(c => c.id === 'simple').cost, [800, 1000]);
  assert.strictEqual(costsNow().simple, 800);
  assert.strictEqual(chestShop.describeChests(db.getAdminConfig()).chests[0].cost, 800);
  const view = rewards.buildAdminView({ costs: before });
  assert.strictEqual(view.draft.costs.simple, 1000);
  assert.strictEqual(view.published.tables.shop.simple.cost, 800);
  // Le contrôle de boucle utilise le prix proposé
  const cheap = structuredClone(t); cheap.shop.simple.cost = 500;
  assert.match(rewards.validateTables(cheap, { costs: before }).errors.join(' '), /coûte 500 pièces/);
  // Version périmée : rien n'est écrit, prix inchangé
  assert.throws(() => rewards.publishDraft({ expectedBasedOn: 99, costs: before }), e => e.status === 409);
  assert.strictEqual(costsNow().simple, 800);
  // Publication : version (avec prix) + admin_config + brouillon retiré + journal
  const pub = rewards.publishDraft({ note: 'prix', costs: before });
  assert.deepStrictEqual(pub.priceChanges, [{ id: 'simple', before: 800, after: 1000 }]);
  assert.strictEqual(costsNow().simple, 1000);
  assert.strictEqual(rewards.getPublished().tables.shop.simple.cost, 1000);
  assert.strictEqual(rewards.getPublished().tables.shop.rare.cost, 15000);
  assert.strictEqual(rewards.getDraft(), null);
  assert.deepStrictEqual(rewards.listAudit()[0].details.priceChanges, pub.priceChanges);
  const save = { coins: 1000, shopChestsBought: {} };
  assert.strictEqual(chestShop.rollChest('simple', save, db.getAdminConfig()).cost, 1000);
  // Retour à la version précédente (v1, sans prix mémorisés) : prix gardés
  const rb1 = rewards.rollbackTo(pub.version - 1, { costs: costsNow() });
  assert.strictEqual(rb1.pricesKept, true);
  assert.strictEqual(costsNow().simple, 1000);
  // Retour à la version publiée avec prix : prix restaurés (même transaction)
  db.setAdminConfig('chest_cost_simple', '800');   // simule un prix ancien en vigueur
  const rb2 = rewards.rollbackTo(pub.version, { costs: costsNow() });
  assert.deepStrictEqual(rb2.priceChanges, [{ id: 'simple', before: 800, after: 1000 }]);
  assert.strictEqual(costsNow().simple, 1000);
  db.setAdminConfig('chest_cost_simple', '800');
});

test('préréglages : S sans fragments en boutique (conforme), P et R signalés non conformes', () => {
  const S = rewards.validateTables(rewards.presetTables('boutique_sans_fragments'), { costs: costsNow() });
  assert.deepStrictEqual(S.errors, []);
  assert.deepStrictEqual(S.warnings, []);
  assert.deepStrictEqual(S.notices, []);
  for (const id of rewards.SHOP_IDS) {
    assert.ok(!S.tables.shop[id].table.some(r => r.type === 'relics'), id);
    assert.ok(Number.isInteger(S.tables.shop[id].maxPerSeason), `${id} limité`);
  }
  assert.deepStrictEqual(S.tables.mined, rewards.presetTables('fragments_prudente').mined);
  for (const id of ['fragments_prudente', 'fragments_rare']) {
    assert.strictEqual(rewards.PRESETS[id].conform, false);
    assert.ok(rewards.validateTables(rewards.presetTables(id), { costs: costsNow() }).notices.length > 0, id);
  }
  assert.strictEqual(rewards.PRESETS.boutique_sans_fragments.conform, true);
  // La v1 (en jeu) est signalée : simple, rare et antique donnent des fragments contre des pièces
  const view = rewards.buildAdminView({ costs: costsNow() });
  assert.deepStrictEqual(view.published.notices.map(n => n.id), view.published.version === 1 ? ['simple', 'rare', 'antique'] : view.published.notices.map(n => n.id));
  assert.ok(view.presets.every(p => typeof p.conform === 'boolean' && p.note));
});

test('brouillon du propriétaire jamais perdu en silence : remplacé ou abandonné, copie dans le journal', () => {
  const mine = ownerDraft();
  rewards.saveDraft(mine, { costs: costsNow() });
  const kept = rewards.getDraft().tables;
  rewards.applyPreset('boutique_sans_fragments', { costs: costsNow() });
  const a = rewards.listAudit().find(x => x.action === 'draft_preset');
  assert.deepStrictEqual(a.details.replacedDraft, kept);
  const s = rewards.getDraft().tables;
  assert.ok(rewards.discardDraft());
  const d = rewards.listAudit().find(x => x.action === 'draft_discard');
  assert.deepStrictEqual(d.details.discardedDraft, s);
  // Le jeu n'a pas bougé
  assert.strictEqual(costsNow().simple, 800);
});

test('simulation d\'un brouillon en boucle de profit possible (pour comprendre), publication refusée', () => {
  rewards.saveDraft(ownerDraft(), { costs: costsNow() });
  const v = rewards.validateTables(rewards.getDraft().tables, { costs: costsNow() });
  const res = rewards.simulate(rewards.withCosts(v.tables, costsNow()), { n: 20_000 });
  const simple = res.find(r => r.family === 'shop' && r.id === 'simple');
  assert.strictEqual(simple.cost, 800);
  assert.ok(Math.abs(simple.observedCoins - 863) < 40, String(simple.observedCoins));
  assert.throws(() => rewards.publishDraft({ costs: costsNow() }), e => e.status === 400 && /boucle de profit/.test(e.details.join(' ')));
  assert.strictEqual(costsNow().simple, 800);
  rewards.discardDraft();
});

test('panel : six cartes, fiche avec prix et chances en %, prix en lecture seule ailleurs', () => {
  const html = read('public/admin/index.html'), js = read('public/admin/admin.js');
  const tab = html.slice(html.indexOf('<section id="tab-rewards"'), html.indexOf('<section id="tab-collections"'));
  for (const id of ['rw-cards', 'rw-problems', 'btn-rw-simulate', 'btn-rw-publish', 'btn-rw-discard', 'btn-rw-restore', 'rw-dlg-cost', 'rw-dlg-max',
    'rw-dlg-balance', 'rw-dlg-compare', 'btn-rw-normalize', 'rw-advanced', 'rw-visuals-card']) assert.match(tab, new RegExp(`id="${id}"`), id);
  assert.match(tab, /<details class="overview-card" id="rw-visuals-card">/, 'images repliées');
  assert.match(tab, /<details class="overview-card" id="rw-advanced">[\s\S]*id="rw-versions"[\s\S]*id="rw-audit"/, 'versions et journal repliés');
  assert.match(js, /Aujourd'hui en jeu/);
  assert.match(js, /Publication impossible : \$\{blocking\} problème/);
  assert.match(js, /on pourrait gagner des pièces en l'achetant en boucle/);
  // Économie : plus de saisie de prix ; Config : prix en lecture seule
  assert.doesNotMatch(html, /id="eco-cost-(simple|rare|antique)"/);
  assert.match(html, /id="btn-eco-chest-costs"/);
  assert.doesNotMatch(js, /key: 'chest_cost_simple',\s+inputId/);
  for (const k of ['simple', 'rare', 'antique']) assert.match(js, new RegExp(`chest_cost_${k}:\\s+\\{[^}]*readOnly: true`), k);
});
