/**
 * Tables des coffres de la boutique (option A validée le 30/10/2026, #20) et transparence des
 * chances : sommes à 100 %, bornes, absence de boucle de profit, fréquences réellement tirées,
 * cohérence entre la table du serveur, la description publique et le client (tirage anonyme,
 * quantités de fragments avec Aimant à éclats et multiplicateur admin), aperçu avant/après des
 * améliorations et récompense décomposée avec Cœur d'or, bonus et grands nombres.
 * Sans serveur ni base. Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');

const { SHOP_CHESTS, rollChest, describeChests, COLLECTION_ITEM_IDS, COLLECTION_CONSOLATION_FRAGMENTS } = require('../server/chestShop');
const economy = require('../server/economy');

const ROOT = path.join(__dirname, '..');

function loadBrowser(files, exportsList, lang = 'fr') {
  const ctx = vm.createContext({
    Math, Object, Array, Number, String, Boolean, JSON, Date, t: k => k,
    I18n: { getCurrent: () => lang },
  });
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8'), ctx, { filename: f });
  }
  return vm.runInContext(`({ ${exportsList.join(', ')} })`, ctx);
}

/** Objet du contexte vm → objet ordinaire (comparaisons deepStrictEqual). */
const plain = o => JSON.parse(JSON.stringify(o));

const expectedCoins = table => {
  const total = table.reduce((s, r) => s + r.weight, 0);
  return table.filter(r => r.type === 'coins').reduce((s, r) => s + r.weight / total * (r.min + r.max) / 2, 0);
};

// ── Tables ───────────────────────────────────────────────────────────────────

test('tables A : probabilités = 100 % exactement, prix inchangés, limite antique 5/saison', () => {
  for (const [id, def] of Object.entries(SHOP_CHESTS)) {
    assert.strictEqual(def.table.reduce((s, r) => s + r.weight, 0), 100, id);
    assert.strictEqual(def.cost, economy.DEFAULT_CHEST_COSTS[id]);
  }
  assert.deepStrictEqual(Object.fromEntries(Object.entries(SHOP_CHESTS).map(([id, d]) => [id, d.cost])),
    { simple: 2000, rare: 15000, antique: 80000 });
  assert.strictEqual(SHOP_CHESTS.antique.maxPerSeason, 5);
  assert.strictEqual(SHOP_CHESTS.simple.maxPerSeason, null);
  assert.strictEqual(SHOP_CHESTS.rare.maxPerSeason, null);

  // Table du coffre simple telle que proposée et validée
  assert.deepStrictEqual(SHOP_CHESTS.simple.table, [
    { weight: 45, type: 'coins',  min:   500, max: 1_000 },
    { weight: 30, type: 'relics', amount: 1 },
    { weight: 15, type: 'boost',  mult: 2, minutes: 5 },
    { weight: 10, type: 'coins',  min: 2_000, max: 3_500, jackpot: true },
  ]);
});

test('tirages de pièces : jamais moins d\'un quart du prix ; espérance < prix (pas de boucle de profit)', () => {
  const ratios = {};
  for (const [id, def] of Object.entries(SHOP_CHESTS)) {
    for (const row of def.table.filter(r => r.type === 'coins')) {
      assert.ok(Number.isInteger(row.min) && Number.isInteger(row.max) && row.min <= row.max, `${id} plage`);
      assert.ok(row.min >= def.cost / 4, `${id} : ${row.min} < ¼ de ${def.cost}`);
    }
    for (const row of def.table) {
      if (row.type === 'relics') assert.ok(Number.isInteger(row.amount) && row.amount >= 1);
      if (row.type === 'boost')  assert.ok(row.mult >= 2 && row.minutes > 0);
    }
    const ev = expectedCoins(def.table);
    assert.ok(ev < def.cost, `${id} : espérance ${ev} ≥ prix`);
    ratios[id] = Math.round(ev / def.cost * 1000) / 10;
  }
  // Rendement moyen en pièces annoncé dans la proposition A (31 %, 21 %, 14 %)
  assert.deepStrictEqual(ratios, { simple: 30.6, rare: 21.3, antique: 13.8 });
});

test('rollChest : fréquences tirées conformes aux probabilités, montants dans les bornes', (t) => {
  // Générateur déterministe (graine fixe) : le test ne dépend pas du hasard
  let seed = 42;
  t.mock.method(Math, 'random', () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; });
  const N = 20000;
  for (const [id, def] of Object.entries(SHOP_CHESTS)) {
    const counts = new Map();
    for (let i = 0; i < N; i++) {
      const data = { coins: def.cost, relicFragments: 0, collection: [], shopChestsBought: {} };
      const { reward } = rollChest(id, data);
      let key;
      if (reward.type === 'coins') {
        const row = def.table.find(r => r.type === 'coins' && reward.amount >= r.min && reward.amount <= r.max);
        assert.ok(row, `${id} : ${reward.amount} hors plage`);
        assert.strictEqual(data.coins, reward.amount, 'débit puis crédit');
        key = `coins:${row.min}`;
      } else if (reward.type === 'relics') {
        key = `relics:${reward.amount}`;
        assert.strictEqual(data.relicFragments, reward.amount);
      } else if (reward.type === 'boost') {
        key = `boost:${reward.mult}:${reward.minutes}`;
      } else {
        assert.ok(COLLECTION_ITEM_IDS.includes(reward.itemId));
        key = 'collection';
      }
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const row of def.table) {
      const key = row.type === 'coins' ? `coins:${row.min}` : row.type === 'relics' ? `relics:${row.amount}`
        : row.type === 'boost' ? `boost:${row.mult}:${row.minutes}` : 'collection';
      const freq = (counts.get(key) ?? 0) / N * 100;
      assert.ok(Math.abs(freq - row.weight) < 1.2, `${id} ${key} : ${freq.toFixed(2)} % au lieu de ${row.weight} %`);
    }
  }
});

test('describeChests : chances publiées = poids réels, coûts et multiplicateur admin appliqués', () => {
  const pub = describeChests({});
  assert.deepStrictEqual(pub.chests.map(c => c.id), ['simple', 'rare', 'antique']);
  for (const c of pub.chests) {
    assert.strictEqual(c.cost, SHOP_CHESTS[c.id].cost);
    assert.strictEqual(c.maxPerSeason, SHOP_CHESTS[c.id].maxPerSeason);
    assert.strictEqual(c.table.reduce((s, r) => s + r.chance, 0), 100);
    c.table.forEach((row, i) => {
      const { chance, ...rest } = row;
      assert.deepStrictEqual(rest, SHOP_CHESTS[c.id].table[i]);
      assert.strictEqual(chance, rest.weight);
    });
  }
  assert.deepStrictEqual(pub.fragments, { shardMagnetBonus: economy.SHARD_MAGNET_BONUS, multiplier: 1, minimum: 1 });
  assert.deepStrictEqual(pub.collection, { itemIds: COLLECTION_ITEM_IDS, consolationFragments: COLLECTION_CONSOLATION_FRAGMENTS });

  const tuned = describeChests({ chest_cost_rare: '12000', fragment_drop_multiplier: '1.5' });
  assert.strictEqual(tuned.chests.find(c => c.id === 'rare').cost, 12000);
  assert.strictEqual(tuned.fragments.multiplier, 1.5);
});

// ── Client ───────────────────────────────────────────────────────────────────

test('client : aucune probabilité recopiée en dur ; table et règles reçues du serveur', () => {
  const main = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
  assert.doesNotMatch(main, /weight:\s*\d/, 'main.js ne contient plus de table de coffre');
  const balance = fs.readFileSync(path.join(ROOT, 'public/js/balance.js'), 'utf8');
  assert.doesNotMatch(balance, /weight:\s*\d/);

  const { Balance } = loadBrowser(['gameState.js', 'balance.js'], ['Balance']);
  assert.strictEqual(Balance.SHOP_CHESTS.every(c => !c.table), true, 'rien avant la réponse du serveur');
  assert.strictEqual(Balance.applyChestCatalog(null), false);
  assert.strictEqual(Balance.applyChestCatalog({ chests: [] , fragments: {}, collection: {} }), false);

  const pub = JSON.parse(JSON.stringify(describeChests({ chest_cost_antique: '90000' })));
  assert.strictEqual(Balance.applyChestCatalog(pub), true);
  for (const c of Balance.SHOP_CHESTS) {
    assert.deepStrictEqual(c.table, pub.chests.find(p => p.id === c.id).table);
  }
  assert.strictEqual(Balance.SHOP_CHESTS.find(c => c.id === 'antique').cost, 90000);
  assert.strictEqual(Balance.SHOP_CHESTS.find(c => c.id === 'antique').maxPerSeason, 5);
});

test('client : fragments affichés/tirés = formule serveur (Aimant à éclats 0–5 × multiplicateur admin)', () => {
  for (const mult of ['1', '1.5', '2', '0.5']) {
    const config = { fragment_drop_multiplier: mult };
    const { Balance } = loadBrowser(['gameState.js', 'balance.js'], ['Balance']);
    Balance.applyChestCatalog(JSON.parse(JSON.stringify(describeChests(config))));
    for (let level = 0; level <= 5; level++) {
      for (const [id, def] of Object.entries(SHOP_CHESTS)) {
        for (const row of def.table.filter(r => r.type === 'relics')) {
          const data = { coins: def.cost, relicFragments: 0, relics: level ? { shard_magnet: level } : {}, shopChestsBought: {} };
          const total = def.table.reduce((s, r) => s + r.weight, 0);
          const before = def.table.slice(0, def.table.indexOf(row)).reduce((s, r) => s + r.weight, 0);
          const orig = Math.random;
          Math.random = () => (before + row.weight / 2) / total;
          try { rollChest(id, data, config); } finally { Math.random = orig; }
          assert.strictEqual(Balance.chestFragmentAmount(row.amount, level), data.relicFragments,
            `${id} ${row.amount} fragments, Aimant ${level}, ×${mult}`);
        }
      }
    }
  }
});

// ── Aperçu des améliorations (avant → après) ─────────────────────────────────

test('aperçu des améliorations : niveau et effet avant → après, y compris reliques', () => {
  const { Upgrades, GameState } = loadBrowser(
    ['gameState.js', 'balance.js', 'upgrades.js'], ['Upgrades', 'GameState']);

  GameState.upgrades.bag = 8;
  let p = Upgrades.getLevelPreview('bag');
  assert.deepStrictEqual({ cur: p.cur, next: p.next }, { cur: 8, next: 9 });
  assert.strictEqual(Upgrades.formatMult(p.effect.cur), '3,4');
  assert.strictEqual(Upgrades.formatMult(p.effect.next), '3,7');

  GameState.pickaxeLevel = 3;
  GameState.relicBonuses.damageFlat = 4;   // Œil du mineur niveau 2
  p = plain(Upgrades.getLevelPreview('pickaxe'));
  assert.deepStrictEqual(p, { cur: 3, next: 4, effect: { cur: 7, next: 8 } });

  GameState.upgrades.autodig = 4;
  GameState.relicBonuses.autodigBonus = 2;
  p = plain(Upgrades.getLevelPreview('autodig'));
  assert.deepStrictEqual(p, { cur: 4, next: 5, effect: { cur: 6, next: 7 } });
  assert.strictEqual(Upgrades.getAutoDigDamage(), p.effect.cur, 'effet actuel = dégâts réellement appliqués');

  GameState.upgrades.luck = 3;
  assert.deepStrictEqual(plain(Upgrades.getLevelPreview('luck')), { cur: 3, next: 4, effect: null });

  GameState.upgrades.bag = 12;   // niveau maximal
  assert.deepStrictEqual(plain(Upgrades.getLevelPreview('bag')), { cur: 12, next: null, effect: null });
});

test('aperçu : multiplicateurs lisibles en FR, EN et NL', () => {
  for (const [lang, want] of [['fr', '3,7'], ['en', '3.7'], ['nl', '3,7']]) {
    const { Upgrades } = loadBrowser(['gameState.js', 'balance.js', 'upgrades.js'], ['Upgrades'], lang);
    assert.strictEqual(Upgrades.formatMult(1 + 9 * 0.3), want);
  }
});

// ── Récompense décomposée : Cœur d'or, bonus temporaire, grands nombres ──────

test('récompense : Cœur d\'or (niveaux 0–5) + Sac + bonus + réglage admin, grands nombres = montant crédité', () => {
  const { Balance, Upgrades, GameState, Relics } = loadBrowser(
    ['gameState.js', 'balance.js', 'upgrades.js', 'relics.js'], ['Balance', 'Upgrades', 'GameState', 'Relics']);
  // Même expression que la destruction d'un bloc normal (public/js/main.js)
  const credited = (r, boost) => Math.ceil(r * Upgrades.getRewardMultiplier() * boost);
  const heart = Relics.DEFS.find(r => r.id === 'golden_heart');
  assert.deepStrictEqual([...heart.bonus.values], [0.15, 0.30, 0.50, 0.75, 1.00]);

  for (const eco of [1, 1.5, 2.25]) {
    Balance.economy.coinGainMultiplier = eco;
    for (let level = 0; level <= 5; level++) {
      GameState.relics = level ? { golden_heart: level } : {};
      Relics.applyBonuses();
      for (const bag of [0, 1, 8, 12]) {
        GameState.upgrades.bag = bag;
        for (const boost of [1, 2, 3]) {
          for (const base of [1, 47, 154, 9_999, 123_456, 7_654_321]) {
            const bd = Upgrades.getRewardBreakdown(base, boost);
            assert.strictEqual(bd.total, credited(base, boost), `cœur ${level}, sac ${bag}, ×${boost}, éco ${eco}, base ${base}`);
            assert.ok(Number.isSafeInteger(bd.total));
            // Produit des facteurs affichés = multiplicateur appliqué (aucun facteur compté deux fois)
            const product = bd.factors.reduce((p, f) => p * f.mult, 1);
            assert.ok(Math.abs(product - Upgrades.getRewardMultiplier() * boost) < 1e-9);
            const relic = bd.factors.find(f => f.key === 'relic');
            assert.strictEqual(relic ? relic.mult : 1, 1 + (level ? heart.bonus.values[level - 1] : 0));
          }
        }
      }
    }
  }
  // Exemple : Sac 8 (×3,4), Cœur d'or 2 (×1,3), bonus ×2 → 154 × 3,4 × 1,3 × 2 = 1 362
  Balance.economy.coinGainMultiplier = 1;
  GameState.relics = { golden_heart: 2 }; Relics.applyBonuses();
  GameState.upgrades.bag = 8;
  const bd = Upgrades.getRewardBreakdown(154, 2);
  assert.strictEqual(bd.factors.map(f => f.key).join(','), 'bag,relic,boost');
  assert.strictEqual(bd.total, Math.ceil(154 * 3.4 * 1.3 * 2));
});

test('ligne de récompense : « = total » insécable, calcul autorisé à passer à la ligne (mobile)', () => {
  const css  = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
  const main = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
  assert.match(main, /<span class="reward-result"><span class="reward-eq">=<\/span> <span class="reward-final">/);
  assert.match(css, /#block-reward \.reward-result\s*\{\s*white-space: nowrap;/);
  const blockReward = [...css.matchAll(/#block-reward\s*\{([^}]*)\}/g)].map(m => m[1]).join(';');
  assert.doesNotMatch(blockReward, /white-space:\s*nowrap|overflow:\s*hidden|text-overflow/);
  // Montants jamais abrégés (pas de notation compacte « 1,2 M » ambiguë)
  assert.doesNotMatch(main, /notation:\s*'compact'/);
});
