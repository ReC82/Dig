/**
 * Tests des améliorations administrables et de la suspension d'urgence, ticket #69 :
 * - migration : la version 1 reprend à l'identique les six améliorations du client (prix par
 *   niveau, niveaux, effet par niveau du Sac et de la Chance, reroll) et leurs noms ; idempotente ;
 * - validation : ensemble fixe d'améliorations, verrous anti-bot (#25), bornes, nombre de niveaux
 *   jamais en baisse ;
 * - prix en gemmes de l'Auto-Dig éditables (recette du 06/11, base isolée) : brouillon sans effet,
 *   publication lue par le registre serveur (#49, débit exact), achat au prix périmé refusé,
 *   retour arrière ; client : confirmation serveur avant débit ;
 * - brouillon → publication explicite avec note, version périmée refusée, retour arrière, journal
 *   en ajout seul ;
 * - suspension (recette sur base isolée) : aperçu sans effet, motif, confirmation par l'identifiant,
 *   effet immédiat non suspendable, carte masquée ⇒ achats bloqués, limite de fréquence,
 *   réactivation, journal en ajout seul ; sauvegardes des joueurs jamais modifiées ;
 * - client : barème appliqué, achats bloqués, effets calculés au niveau de départ puis rétablis,
 *   niveaux possédés intacts, barème invalide refusé ;
 * - routes HTTP : catalogue public, administration protégée (serveur de test, port ≠ 3000).
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
const PORT  = process.env.DIG_TEST_PORT_UPGRADES || '3193';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-upgrades-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db      = require('../server/db');
const catalog = require('../server/upgradeCatalog');

db.initDb();
catalog.init();

function loadClient(extra = {}) {
  const ctx = { console, Math, JSON, Number, Object, Array, String, Set, Map, Promise, t: k => k, I18n: { getCurrent: () => 'fr', has: () => false }, ...extra };
  vm.createContext(ctx);
  for (const f of ['gameState.js', 'balance.js', 'blocks.js', 'upgrades.js', 'relics.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8'), ctx, { filename: f });
  }
  return vm.runInContext('({ GameState, Balance, Blocks, Upgrades, Relics })', ctx);
}

const code = fn => { try { fn(); return 0; } catch (e) { if (!(e instanceof catalog.CatalogError)) throw e; return e.status; } };
const clone = x => JSON.parse(JSON.stringify(x));
const pubOf = id => clone(catalog.getPublished().upgrades.find(u => u.id === id));

test('version 1 : les six améliorations du jeu à l\'identique', () => {
  const { Upgrades, Blocks } = loadClient();
  const pub = catalog.getPublished();
  assert.strictEqual(pub.version, 1);
  assert.strictEqual(pub.source, 'origin');
  assert.deepStrictEqual(pub.upgrades.map(u => u.id), ['pickaxe', 'luck', 'bag', 'autodig', 'fragment_shop', 'block_reroll']);
  for (const def of Upgrades.DEFS) {
    const u = pub.upgrades.find(x => x.id === def.id);
    assert.strictEqual(u.maxLevel, def.maxLevel, def.id);
    assert.strictEqual(u.icon, def.icon);
    const first = def.id === 'pickaxe' ? 1 : 0;
    for (let lvl = first; lvl < (def.id === 'block_reroll' ? 40 : def.maxLevel); lvl++) {
      const c = def.getCost(lvl);
      if (u.reroll) assert.strictEqual(u.reroll.base * 2 ** Math.floor(lvl / u.reroll.every), c.coins, `${def.id} ${lvl}`);
      else {
        assert.strictEqual(u.costs[lvl - first], c.coins, `${def.id} ${lvl}`);
        assert.strictEqual(u.gems ? u.gems[lvl - first] : 0, c.gems, `${def.id} ${lvl} gemmes`);
      }
    }
  }
  assert.strictEqual(pub.upgrades.find(u => u.id === 'bag').perLevel, 0.3);
  assert.strictEqual(pub.upgrades.find(u => u.id === 'luck').perLevel, Blocks.LUCK_PER_LEVEL);
  assert.deepStrictEqual(pub.upgrades.find(u => u.id === 'pickaxe').names, { fr: 'Pioche', en: 'Pickaxe', nl: 'Houweel', es: 'Pico' });
  // Idempotent ; aucune suspension
  catalog.init();
  assert.strictEqual(catalog.listVersions().length, 1);
  assert.deepStrictEqual(catalog.publicCatalog().controls, {});
  // Gemmes de l'Auto-Dig = registre serveur (#49)
  const { AUTODIG_GEM_COST } = require('../server/gemLedger');
  assert.deepStrictEqual(pub.upgrades.find(u => u.id === 'autodig').gems, [1, 2, 3, 4, 5, 6].map(l => AUTODIG_GEM_COST[l]));
});

test('validation : verrous moteur, bornes, niveaux jamais en baisse', () => {
  const pick = pubOf('pickaxe'), auto = pubOf('autodig'), bag = pubOf('bag'), luck = pubOf('luck'), rr = pubOf('block_reroll');
  assert.strictEqual(code(() => catalog.normalizeUpgrade({ ...pick, id: 'turbo' })), 400, 'type inconnu');
  assert.strictEqual(code(() => catalog.normalizeUpgrade({ ...pick, maxLevel: 16, costs: [...pick.costs, 900000] })), 400, 'pioche verrouillée à 15 (anti-bot)');
  assert.strictEqual(code(() => catalog.normalizeUpgrade({ ...auto, maxLevel: 7, costs: [...auto.costs, 0], gems: [...auto.gems, 50] })), 400, 'Auto-Dig verrouillé à 6 niveaux (anti-bot)');
  for (const g of [[0, 0, -1, 8, 18, 35], [0, 0, 4.5, 8, 18, 35], [0, 0, 4, 8, 18, 1001], [0, 0, 4, 8, 18], [0, 0, 4, 8, 18, 'x']]) {
    assert.strictEqual(code(() => catalog.normalizeUpgrade({ ...auto, gems: g })), 400, `gemmes hors bornes : ${g}`);
  }
  assert.strictEqual(code(() => catalog.normalizeUpgrade({ ...auto, gems: [0, 0, 0, 8, 18, 35] })), 400, 'niveau gratuit (0 pièce, 0 gemme) refusé');
  assert.deepStrictEqual(catalog.normalizeUpgrade({ ...auto, gems: [0, 0, 6, 8, 18, 35] }).gems, [0, 0, 6, 8, 18, 35], 'gemmes éditables');
  assert.deepStrictEqual(catalog.normalizeUpgrade({ ...auto, costs: [800, 3000, 0, 0, 0, 500], gems: [0, 0, 4, 8, 18, 0] }).gems, [0, 0, 4, 8, 18, 0], 'niveau passé en pièces');
  assert.match(catalog.validateCatalog(clone(catalog.getPublished().upgrades).map(u => (u.id === 'autodig' ? { ...u, gems: [0, 0, 4, 8, 30, 20] } : u))).warnings.join(' '),
    /gemmes du niveau 6 est inférieur/);
  assert.strictEqual(code(() => catalog.normalizeUpgrade({ ...bag, perLevel: 2 })), 400, 'effet du Sac borné');
  assert.strictEqual(code(() => catalog.normalizeUpgrade({ ...luck, costs: luck.costs.slice(1) })), 400, 'un prix par niveau');
  assert.strictEqual(code(() => catalog.normalizeUpgrade({ ...bag, costs: [0, ...bag.costs.slice(1)] })), 400, 'prix nul refusé');
  assert.strictEqual(code(() => catalog.normalizeUpgrade({ ...rr, reroll: { base: 400, every: 0 } })), 400);
  assert.strictEqual(code(() => catalog.normalizeUpgrade({ ...bag, names: { ...bag.names, fr: '' } })), 400);
  // Autorisé : Sac sur 14 niveaux, Auto-Dig à 0 pièce sur les niveaux payés en gemmes (origine)
  assert.strictEqual(catalog.normalizeUpgrade({ ...bag, maxLevel: 14, costs: [...bag.costs, 300000, 400000] }).maxLevel, 14);
  assert.deepStrictEqual(catalog.normalizeUpgrade(auto).costs, [800, 3000, 0, 0, 0, 0]);
  // Catalogue complet : les six obligatoires, niveaux publiés jamais en baisse
  const all = clone(catalog.getPublished().upgrades);
  assert.match(catalog.validateCatalog(all.filter(u => u.id !== 'bag')).errors.join(' '), /manquante/);
  const shorter = all.map(u => (u.id === 'luck' ? { ...u, maxLevel: 12 } : u));
  assert.match(catalog.validateCatalog(shorter, { maxLevels: new Map([['luck', 14]]) }).errors.join(' '), /ne peut pas baisser/);
  assert.deepStrictEqual(catalog.validateCatalog(all).errors, []);
});

test('brouillon → publication (note), version périmée, retour arrière, journal en ajout seul', () => {
  const before = clone(catalog.publicCatalog());
  const bag = pubOf('bag');
  const r = catalog.upsertDraftUpgrade({ ...bag, costs: bag.costs.map((c, i) => (i === 0 ? 150 : c)) });
  assert.strictEqual(r.draftDropped, false);
  assert.deepStrictEqual(catalog.publicCatalog(), before, 'le brouillon ne touche pas au jeu');
  const view = catalog.buildAdminView();
  assert.deepStrictEqual(view.draft.changes, [{ id: 'bag', kind: 'changed', fields: [{ field: 'costs', before: bag.costs, after: [150, ...bag.costs.slice(1)] }] }]);
  // Remettre la valeur d'origine supprime le brouillon
  assert.strictEqual(catalog.upsertDraftUpgrade(bag).draftDropped, true);
  assert.strictEqual(catalog.getDraft(), null);
  // Recette : modifier puis abandonner → rien de publié
  catalog.upsertDraftUpgrade({ ...bag, perLevel: 0.35 });
  assert.strictEqual(catalog.discardDraft(), true);
  assert.deepStrictEqual(catalog.publicCatalog(), before);
  // Publication : note obligatoire, version périmée refusée
  catalog.upsertDraftUpgrade({ ...bag, perLevel: 0.35 });
  assert.strictEqual(code(() => catalog.publishDraft({ note: '' })), 400);
  assert.strictEqual(code(() => catalog.publishDraft({ note: 'essai isolé', expectedBasedOn: 0 })), 409);
  const p = catalog.publishDraft({ note: 'essai isolé', expectedBasedOn: 1 });
  assert.strictEqual(p.version, 2);
  assert.strictEqual(catalog.publicCatalog().upgrades.find(u => u.id === 'bag').perLevel, 0.35);
  // Retour arrière : nouvelle version au contenu de la v1
  const rb = catalog.rollbackTo(1);
  assert.deepStrictEqual(rb, { version: 3, restored: 1 });
  assert.deepStrictEqual(catalog.publicCatalog().upgrades, before.upgrades);
  assert.throws(() => db.getDb().prepare('DELETE FROM upgrade_catalog_versions').run(), /ajout seul/);
  assert.throws(() => db.getDb().prepare("UPDATE upgrade_catalog_audit SET action = 'x'").run(), /ajout seul/);
  assert.deepStrictEqual(catalog.listAudit().slice(0, 2).map(a => a.action), ['rollback', 'publish']);
});

test('suspension d\'urgence (base isolée) : aperçu, motif, confirmation, réactivation, sauvegardes intactes', () => {
  const conn = db.getDb();
  conn.prepare("INSERT INTO users (username, password_hash) VALUES ('joueur69', 'x')").run();
  const uid = conn.prepare("SELECT id FROM users WHERE username = 'joueur69'").get().id;
  const save = JSON.stringify({ pickaxeLevel: 6, upgrades: { luck: 2, bag: 3, autodig: 1, fragment_shop: 0, block_reroll: 4 } });
  conn.prepare('INSERT INTO user_saves (user_id, data) VALUES (?, ?)').run(uid, save);
  catalog._resetRateForTests();

  const h = catalog.holders();
  assert.deepStrictEqual([h.saves, h.byUpgrade.pickaxe, h.byUpgrade.bag, h.byUpgrade.fragment_shop], [1, { 6: 1 }, { 3: 1 }, {}]);

  // Aperçu : conséquences, rien d'appliqué
  const p = catalog.previewControl('bag', { effects: true });
  assert.deepStrictEqual(p.changed, ['effects']);
  assert.strictEqual(p.holders, 1);
  assert.strictEqual(p.requiresConfirm, true);
  assert.match(p.consequences.join(' '), /niveau 0/);
  assert.deepStrictEqual(catalog.publicCatalog().controls, {});

  // Motif et confirmation obligatoires
  assert.strictEqual(code(() => catalog.setControl('bag', { effects: true }, { reason: '' , confirm: 'bag' })), 400);
  assert.strictEqual(code(() => catalog.setControl('bag', { effects: true }, { reason: 'Sac trop fort', confirm: 'sac' })), 400);
  assert.strictEqual(code(() => catalog.setControl('fragment_shop', { effects: true }, { reason: 'test isolé', confirm: 'fragment_shop' })), 400, 'effet immédiat');
  assert.strictEqual(code(() => catalog.setControl('nope', { purchases: true }, { reason: 'test isolé' })), 404);
  // Achats seuls : motif suffit
  const a = catalog.setControl('pickaxe', { purchases: true }, { reason: 'test isolé achats', via: 'key' });
  assert.deepStrictEqual(a.after, { purchases: true, effects: false, hidden: false });
  assert.strictEqual(code(() => catalog.setControl('pickaxe', { purchases: true }, { reason: 'test isolé achats' })), 409, 'déjà en vigueur');
  // Effets du Sac
  const rev0 = catalog.publicCatalog().controlsRev;
  catalog.setControl('bag', { effects: true }, { reason: 'Sac trop fort (test)', confirm: 'bag' });
  // Carte masquée ⇒ achats bloqués aussi
  const hid = catalog.setControl('block_reroll', { hidden: true }, { reason: 'reroll bugué (test)', confirm: 'block_reroll' });
  assert.deepStrictEqual(hid.after, { purchases: true, effects: false, hidden: true });
  const pc = catalog.publicCatalog();
  assert.ok(pc.controlsRev > rev0);
  assert.deepStrictEqual(pc.controls, {
    pickaxe: { purchases: true, effects: false, hidden: false },
    bag: { purchases: false, effects: true, hidden: false },
    block_reroll: { purchases: true, effects: false, hidden: true },
  });
  assert.ok(!JSON.stringify(pc).includes('test'), 'le motif reste interne');

  // Réactivation complète
  for (const id of ['pickaxe', 'bag', 'block_reroll']) catalog.setControl(id, {}, { reason: 'fin du test isolé' });
  assert.deepStrictEqual(catalog.publicCatalog().controls, {});
  assert.strictEqual(catalog.listControlAudit().length, 6);
  assert.throws(() => conn.prepare('DELETE FROM upgrade_control_audit').run(), /ajout seul/);
  // Sauvegarde du joueur strictement identique
  assert.strictEqual(conn.prepare('SELECT data FROM user_saves WHERE user_id = ?').get(uid).data, save);

  // Limite de fréquence
  catalog._resetRateForTests();
  const t0 = Date.now();
  for (let i = 0; i < 30; i++) catalog.setControl('luck', { purchases: i % 2 === 0 }, { reason: 'rafale de test', now: t0 });
  assert.strictEqual(code(() => catalog.setControl('luck', { purchases: true }, { reason: 'rafale de test', now: t0 })), 429);
  assert.strictEqual(catalog.setControl('luck', { purchases: true }, { reason: 'rafale de test', now: t0 + 61 * 60_000 }).after.purchases, true, 'fenêtre glissante');
  catalog.setControl('luck', {}, { reason: 'fin de la rafale', now: t0 + 61 * 60_000 });
  catalog._resetRateForTests();
});

test('gemmes de l\'Auto-Dig (recette base isolée) : brouillon sans effet, débit serveur exact, prix périmé refusé, retour arrière', () => {
  const gems = require('../server/gemLedger');
  require('../server/blockCatalog').init();
  require('../server/badges').init();
  gems.init();
  const conn = db.getDb();
  const v0 = catalog.getPublished().version;
  const auto = pubOf('autodig');
  assert.deepStrictEqual(auto.gems, [0, 0, 4, 8, 18, 35]);
  const uid = conn.prepare("INSERT INTO users (username, password_hash) VALUES ('gemmes69', 'x')").run().lastInsertRowid;
  const season = db.getActiveSeason()?.id ?? null;
  let rev = 0;
  const observe = (g, autodig) => gems.observeSave(uid, { gems: g, upgrades: { autodig }, stats: { minedByType: {} }, seasonStats: { seasonId: season } },
    { revision: ++rev, force: true, nowMs: Date.parse('2026-11-06T10:00:00Z') });
  const lastDebit = () => conn.prepare("SELECT delta, details FROM gem_ledger WHERE user_id = ? AND reason = 'autodig' ORDER BY id DESC LIMIT 1").get(uid);
  observe(100, 2);   // ouverture : 100 gemmes, Auto-Dig niveau 2

  // 1. Brouillon : niveau 3 à 6 gemmes → aucun effet sur le jeu, le contrôle d'achat ni le registre
  catalog.upsertDraftUpgrade({ ...auto, gems: [0, 0, 6, 8, 18, 35] });
  assert.deepStrictEqual(catalog.publicCatalog().upgrades.find(u => u.id === 'autodig').gems, [0, 0, 4, 8, 18, 35], 'jeu inchangé');
  assert.deepStrictEqual(catalog.autodigGemCosts(), { version: v0, costs: { 1: 0, 2: 0, 3: 4, 4: 8, 5: 18, 6: 35 } }, 'registre inchangé');
  assert.strictEqual(catalog.checkPurchase({ id: 'autodig', level: 3, gems: 4 }).ok, true);
  assert.strictEqual(catalog.checkPurchase({ id: 'autodig', level: 3, gems: 6 }).code, 'stale_price', 'prix du brouillon refusé');
  const view = catalog.buildAdminView();
  assert.deepStrictEqual(view.draft.changes, [{ id: 'autodig', kind: 'changed', fields: [{ field: 'gems', before: [0, 0, 4, 8, 18, 35], after: [0, 0, 6, 8, 18, 35] }] }]);
  assert.strictEqual(view.limits.gemMax, 1000);

  // 2. Publication (base de test) : le jeu ET le registre lisent la même version, mêmes prix
  const p = catalog.publishDraft({ note: 'essai gemmes isolé', expectedBasedOn: v0 });
  const pubCat = catalog.publicCatalog();
  assert.strictEqual(pubCat.version, p.version);
  assert.deepStrictEqual(pubCat.upgrades.find(u => u.id === 'autodig').gems, [0, 0, 6, 8, 18, 35]);
  assert.deepStrictEqual(catalog.autodigGemCosts(), { version: p.version, costs: { 1: 0, 2: 0, 3: 6, 4: 8, 5: 18, 6: 35 } });
  // Client périmé (prix 4) : refusé avec le barème à jour ; prix publié (6) : accepté
  const stale = catalog.checkPurchase({ id: 'autodig', level: 3, gems: 4, version: v0 });
  assert.deepStrictEqual([stale.ok, stale.code, stale.gems, stale.version], [false, 'stale_price', 6, p.version]);
  assert.deepStrictEqual(stale.catalog, pubCat);
  assert.deepStrictEqual(catalog.checkPurchase({ id: 'autodig', level: 3, gems: 6, version: p.version }), { ok: true, version: p.version, level: 3, gems: 6 });
  for (const bad of [{ id: 'bag', level: 1, gems: 0 }, { id: 'autodig', level: 7, gems: 0 }, { id: 'autodig', level: 0, gems: 0 }]) {
    assert.strictEqual(code(() => catalog.checkPurchase(bad)), 400, JSON.stringify(bad));
  }
  // Débit serveur exact au prix publié (niveau 2 → 3 : 6 gemmes), version notée dans le journal
  const r = observe(94, 3);
  assert.strictEqual(r.debited, 6);
  assert.strictEqual(r.balance, 94);
  assert.deepStrictEqual([lastDebit().delta, JSON.parse(lastDebit().details).catalogVersion], [-6, p.version]);
  // Rejeu de la même révision : jamais débité deux fois
  assert.strictEqual(gems.observeSave(uid, { gems: 94, upgrades: { autodig: 3 }, stats: { minedByType: {} }, seasonStats: { seasonId: season } }, { revision: rev, force: true }).replayed, true);

  // 3. Retour arrière : prix d'origine pour le jeu, le contrôle d'achat et le registre
  const rb = catalog.rollbackTo(v0, { note: 'fin essai gemmes' });
  assert.deepStrictEqual(catalog.autodigGemCosts().costs, { 1: 0, 2: 0, 3: 4, 4: 8, 5: 18, 6: 35 });
  assert.strictEqual(catalog.autodigGemCosts().version, rb.version);
  assert.strictEqual(catalog.checkPurchase({ id: 'autodig', level: 4, gems: 8 }).ok, true);
  assert.strictEqual(catalog.checkPurchase({ id: 'autodig', level: 3, gems: 6 }).code, 'stale_price');
  assert.strictEqual(observe(86, 4).debited, 8, 'niveau 4 débité au prix d\'origine');
  // Achats suspendus : refus explicite
  catalog.setControl('autodig', { purchases: true }, { reason: 'essai gemmes' });
  assert.strictEqual(catalog.checkPurchase({ id: 'autodig', level: 5, gems: 18 }).code, 'suspended');
  catalog.setControl('autodig', {}, { reason: 'fin essai gemmes' });
  catalog._resetRateForTests();
  assert.deepStrictEqual(catalog.publicCatalog().upgrades, catalog.getVersion(v0).upgrades, 'barème final = origine');
});

test('client : barème appliqué, achats bloqués, effets suspendus puis rétablis sans toucher aux niveaux', () => {
  const { GameState, Balance, Blocks, Upgrades, Relics } = loadClient();
  const cat = clone(catalog.publicCatalog());
  assert.strictEqual(Upgrades.applyCatalog(cat), true);
  assert.deepStrictEqual(clone(Balance.PICKAXE), cat.upgrades[0].costs);
  // Barème modifié : prix, effet par niveau, reroll
  const mod = clone(cat);
  mod.version = 99;
  mod.upgrades.find(u => u.id === 'bag').costs[0] = 999;
  mod.upgrades.find(u => u.id === 'bag').perLevel = 0.4;
  mod.upgrades.find(u => u.id === 'luck').perLevel = 0.12;
  mod.upgrades.find(u => u.id === 'block_reroll').reroll = { base: 500, every: 5 };
  assert.strictEqual(Upgrades.applyCatalog(mod), true);
  assert.deepStrictEqual(clone(Upgrades.getCost('bag')), { coins: 999, gems: 0 });
  assert.strictEqual(Blocks.LUCK_PER_LEVEL, 0.12);
  assert.strictEqual(Balance.getRerollCost(5).coins, 1000);

  GameState.coins = 1e9; GameState.gems = 1000;
  GameState.pickaxeLevel = 6;
  Object.assign(GameState.upgrades, { luck: 2, bag: 3, autodig: 2 });
  Relics.applyBonuses();
  assert.strictEqual(GameState.damage, 6);
  assert.strictEqual(Upgrades.getRewardMultiplier(), 1 + 3 * 0.4);
  assert.strictEqual(Upgrades.getAutoDigDamage(), 2);

  // Suspension : achats de la pioche, effets du Sac / Auto-Dig / pioche / Chance, reroll masqué
  const sus = clone(mod);
  sus.controlsRev = 5;
  sus.controls = { pickaxe: { purchases: true, effects: true }, bag: { effects: true }, autodig: { effects: true }, luck: { effects: true }, block_reroll: { hidden: true } };
  assert.strictEqual(Upgrades.applyCatalog(sus), true);
  Relics.applyBonuses();
  assert.strictEqual(Upgrades.canAfford('pickaxe'), false);
  assert.strictEqual(Upgrades.buy('pickaxe'), false);
  assert.strictEqual(Upgrades.canAfford('block_reroll'), false, 'carte masquée : achat bloqué');
  assert.strictEqual(Upgrades.isHidden('block_reroll'), true);
  assert.strictEqual(GameState.damage, 1, 'pioche : dégâts du niveau 1');
  assert.strictEqual(Upgrades.getRewardMultiplier(), 1, 'Sac : ×1');
  assert.strictEqual(Upgrades.getAutoDigDamage(), 0);
  assert.strictEqual(Blocks.luckMultiplier(), 1);
  assert.strictEqual(Upgrades.canAfford('bag'), true, 'effet suspendu : achat toujours possible');
  assert.deepStrictEqual([GameState.pickaxeLevel, GameState.upgrades.luck, GameState.upgrades.bag, GameState.upgrades.autodig], [6, 2, 3, 2], 'niveaux intacts');

  // Réactivation : tout revient
  assert.strictEqual(Upgrades.applyCatalog({ ...mod, controlsRev: 6, controls: {} }), true);
  Relics.applyBonuses();
  assert.strictEqual(GameState.damage, 6);
  assert.strictEqual(Upgrades.getRewardMultiplier(), 1 + 3 * 0.4);
  assert.strictEqual(Upgrades.getAutoDigDamage(), 2);
  assert.strictEqual(Upgrades.canAfford('pickaxe'), true);

  // Barème invalide : refusé, rien ne change
  const bad = clone(mod);
  bad.upgrades.find(u => u.id === 'luck').costs.pop();
  assert.strictEqual(Upgrades.applyCatalog({ ...bad, version: 100 }), false);
  assert.strictEqual(Upgrades.catalogVersion, 99);
});

test('client : achat Auto-Dig confirmé par le serveur avant débit, prix périmé refusé', async () => {
  let reply = null;
  const calls = [];
  const store = {};
  const fetch = async (url, opts) => { calls.push([url, JSON.parse(opts.body)]); return reply(); };
  const localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  const { GameState, Upgrades } = loadClient({ fetch, localStorage });
  const cat = clone(catalog.publicCatalog());
  Upgrades.applyCatalog(cat);
  GameState.gems = 100; GameState.coins = 1e6;
  GameState.upgrades.autodig = 2;
  const res = (status, data) => () => Promise.resolve({ status, json: async () => data });

  // Prix confirmé : le jeu peut débiter (4 gemmes)
  reply = res(200, { ok: true, version: cat.version, level: 3, gems: 4 });
  assert.deepStrictEqual(clone(await Upgrades.confirmPurchase('autodig')), { ok: true });
  assert.deepStrictEqual(calls.at(-1), ['/api/upgrades/purchase-check', { id: 'autodig', level: 3, gems: 4, version: cat.version }]);
  assert.strictEqual(GameState.gems, 100, 'la confirmation ne débite rien');

  // Prix périmé : barème à jour appliqué et mémorisé, achat refusé, rien débité
  const fresh = clone(cat);
  fresh.version = cat.version + 1;
  fresh.upgrades.find(u => u.id === 'autodig').gems = [0, 0, 6, 8, 18, 35];
  reply = res(409, { ok: false, code: 'stale_price', version: fresh.version, level: 3, gems: 6, catalog: fresh });
  assert.deepStrictEqual(clone(await Upgrades.confirmPurchase('autodig')), { ok: false, code: 'stale_price', gems: 6 });
  assert.strictEqual(Upgrades.catalogVersion, fresh.version);
  assert.deepStrictEqual(clone(Upgrades.getCost('autodig')), { coins: 0, gems: 6 });
  assert.strictEqual(JSON.parse(store[Upgrades.CATALOG_STORAGE_KEY]).version, fresh.version);
  assert.deepStrictEqual([GameState.gems, GameState.upgrades.autodig], [100, 2]);
  // Le nouvel essai annonce le prix à jour
  reply = res(200, { ok: true });
  assert.strictEqual((await Upgrades.confirmPurchase('autodig')).ok, true);
  assert.strictEqual(calls.at(-1)[1].gems, 6);
  assert.strictEqual(Upgrades.buy('autodig'), true);
  assert.deepStrictEqual([GameState.gems, GameState.upgrades.autodig], [94, 3]);

  // Sans réseau : niveau en gemmes refusé ; niveau en pièces (1 → 2) acheté comme avant
  reply = () => Promise.reject(new Error('hors ligne'));
  assert.deepStrictEqual(clone(await Upgrades.confirmPurchase('autodig')), { ok: false, code: 'offline' });
  GameState.upgrades.autodig = 1;
  assert.deepStrictEqual(clone(await Upgrades.confirmPurchase('autodig')), { ok: true });
  // Réponse serveur inattendue (500) : même règle
  reply = res(500, { error: 'x' });
  GameState.upgrades.autodig = 3;
  assert.strictEqual((await Upgrades.confirmPurchase('autodig')).code, 'offline');
});

test('routes : catalogue public, administration protégée, suspension puis réactivation', async (t) => {
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

  const pub = await call('GET', '/api/upgrades/catalog', undefined, { auth: false });
  assert.strictEqual(pub.status, 200);
  assert.deepStrictEqual([pub.body.version, pub.body.upgrades.length, pub.body.controls], [1, 6, {}]);
  for (const [m, u] of [['GET', '/api/admin/upgrades'], ['PUT', '/api/admin/upgrades/draft/upgrades/bag'], ['POST', '/api/admin/upgrades/publish'],
    ['POST', '/api/admin/upgrades/rollback'], ['DELETE', '/api/admin/upgrades/draft'], ['GET', '/api/admin/upgrades/audit'],
    ['POST', '/api/admin/upgrades/draft/upgrades/bag/revert'], ['POST', '/api/admin/upgrades/bag/controls/preview'], ['POST', '/api/admin/upgrades/bag/controls']]) {
    assert.strictEqual((await call(m, u, m === 'GET' ? undefined : {}, { auth: false })).status, 401, `${m} ${u}`);
  }
  const view = await call('GET', '/api/admin/upgrades');
  assert.strictEqual(view.status, 200);
  assert.deepStrictEqual(Object.keys(view.body.types), ['pickaxe', 'luck', 'bag', 'autodig', 'fragment_shop', 'block_reroll']);
  assert.strictEqual(typeof view.body.pictos, 'object');
  const bag = pub.body.upgrades.find(u => u.id === 'bag');
  assert.strictEqual((await call('PUT', '/api/admin/upgrades/draft/upgrades/luck', { upgrade: bag })).status, 400, 'identifiant incohérent');
  assert.strictEqual((await call('PUT', '/api/admin/upgrades/draft/upgrades/bag', { upgrade: { ...bag, perLevel: 9 } })).status, 400);
  assert.strictEqual((await call('PUT', '/api/admin/upgrades/draft/upgrades/bag', { upgrade: { ...bag, perLevel: 0.32 } })).status, 200);
  assert.strictEqual((await call('DELETE', '/api/admin/upgrades/draft')).body.discarded, true);

  const prev = await call('POST', '/api/admin/upgrades/autodig/controls/preview', { controls: { effects: true } });
  assert.strictEqual(prev.status, 200);
  assert.strictEqual(prev.body.requiresConfirm, true);
  assert.strictEqual((await call('POST', '/api/admin/upgrades/autodig/controls', { controls: { effects: true }, reason: 'test HTTP' })).status, 400, 'confirmation manquante');
  const set = await call('POST', '/api/admin/upgrades/autodig/controls', { controls: { effects: true }, reason: 'test HTTP', confirm: 'autodig' });
  assert.strictEqual(set.status, 200, JSON.stringify(set.body));
  assert.deepStrictEqual((await call('GET', '/api/upgrades/catalog', undefined, { auth: false })).body.controls, { autodig: { purchases: false, effects: true, hidden: false } });
  assert.strictEqual((await call('POST', '/api/admin/upgrades/autodig/controls', { controls: {}, reason: 'fin du test HTTP' })).status, 200);
  // Confirmation d'achat en gemmes (#69), publique : prix publié accepté, périmé refusé (409 + barème)
  const ok = await call('POST', '/api/upgrades/purchase-check', { id: 'autodig', level: 3, gems: 4, version: 1 }, { auth: false });
  assert.deepStrictEqual([ok.status, ok.body.ok, ok.body.gems], [200, true, 4]);
  const stale = await call('POST', '/api/upgrades/purchase-check', { id: 'autodig', level: 3, gems: 2, version: 1 }, { auth: false });
  assert.deepStrictEqual([stale.status, stale.body.code, stale.body.gems, stale.body.catalog.version], [409, 'stale_price', 4, 1]);
  assert.strictEqual((await call('POST', '/api/upgrades/purchase-check', { id: 'bag', level: 1, gems: 0 }, { auth: false })).status, 400);
  const after = (await call('GET', '/api/upgrades/catalog', undefined, { auth: false })).body;
  assert.deepStrictEqual([after.version, after.controls, after.upgrades], [1, {}, pub.body.upgrades], 'rien de publié, aucune suspension restante');
  const audit = await call('GET', '/api/admin/upgrades/audit');
  assert.deepStrictEqual(audit.body.controls.map(c => [c.upgrade_id, c.via]), [['autodig', 'key'], ['autodig', 'key']]);
});
