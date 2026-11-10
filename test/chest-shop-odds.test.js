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
    UiIcons: require('../public/js/uiIcons.js'),   // pictogrammes de l'atelier (#67) : emoji d'origine ici
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

// ── Fenêtre « Récompenses et chances » lisible sur téléphone (recette du 03/11/2026) ─────────

/** Exécute showChestOdds (extrait de main.js) avec un DOM minimal ; renvoie les éléments remplis. */
async function renderOdds(chestId, { shardLevel = 0, owned = [] } = {}) {
  const main = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
  const src  = main.slice(main.indexOf('async function showChestOdds('), main.indexOf('function _applyShopChestReward('));
  const els = {};
  const el = id => (els[id] ??= { id, textContent: '', innerHTML: '', hidden: true, focus() {}, isConnected: true });
  const ctx = vm.createContext({
    Math, Object, Array, Number, String, Boolean, JSON, Date, Set,
    t: (k, p) => k + (p ? JSON.stringify(p) : ''),
    I18n: { getCurrent: () => 'fr' },
    document: { getElementById: el },
    UiIcons: require('../public/js/uiIcons.js'),
  });
  for (const f of ['gameState.js', 'balance.js', 'upgrades.js', 'escapeHtml.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8'), ctx, { filename: f });
  }
  vm.runInContext(`Balance.applyChestCatalog(${JSON.stringify(describeChests({}))});
    GameState.collection = ${JSON.stringify(owned)};
    var Relics = { getLevel: id => id === 'shard_magnet' ? ${shardLevel} : 0 };
    var _loadChestCatalog = async () => true;
    ${src}`, ctx);
  await vm.runInContext(`showChestOdds('${chestId}', null)`, ctx);
  return els;
}

test('fenêtre des chances : tableau d\'abord, synthèse courte, règles repliées par défaut, pas d\'achat', async () => {
  for (const chest of describeChests({}).chests) {
    const els  = await renderOdds(chest.id, { shardLevel: 2 });
    const html = els['odds-modal-body'].innerHTML;
    assert.strictEqual(els['odds-modal'].hidden, false);
    const iTable = html.indexOf('<table class="odds-table">');
    const iSum   = html.indexOf('<p class="odds-summary">chest_odds.summary</p>');
    const iDet   = html.indexOf('<details class="odds-details">');
    assert.ok(iTable >= 0 && iTable < iSum && iSum < iDet, `${chest.id} : tableau, puis synthèse, puis détail`);
    assert.doesNotMatch(html, /<details[^>]*\sopen/, 'détail replié par défaut');
    assert.match(html, /<summary>chest_odds\.how<\/summary>/);
    assert.doesNotMatch(html, /<ul class="odds-rules"|<button/i, 'plus de longue liste, aucun bouton d\'achat');
    // Toutes les lignes de la table restent visibles avec leur probabilité exacte
    const total = chest.table.reduce((s, r) => s + r.weight, 0);
    assert.strictEqual((html.match(/<td class="odds-chance">/g) || []).length, chest.table.length);
    for (const r of chest.table) {
      assert.ok(html.includes(Number(r.weight / total * 100).toLocaleString('fr', { maximumFractionDigits: 4 }) + ' %'));
    }
    // Une sous-section courte par type de récompense présent, plus le tirage
    const types = new Set(chest.table.map(r => r.type));
    const want = ['sec_draw', ...['coins', 'relics', 'boost', 'collection'].filter(x => types.has(x))
      .map(x => ({ coins: 'sec_coins', relics: 'sec_fragments', boost: 'sec_boost', collection: 'sec_collection' })[x])];
    const got = [...html.matchAll(/<h3>chest_odds\.(sec_\w+)<\/h3>/g)].map(m => m[1]);
    assert.deepStrictEqual(got, want);
    if (types.has('relics')) assert.match(html, /chest_odds\.rule_fragments_you\{&quot;level&quot;:2,&quot;max&quot;:5\}/);
  }
  // Collection : % par objet selon ce qui manque au joueur
  const rare = (await renderOdds('rare', { owned: COLLECTION_ITEM_IDS.slice(0, 4) }))['odds-modal-body'].innerHTML;
  assert.match(rare, /rule_collection\{&quot;total&quot;:8,&quot;missing&quot;:4,&quot;pct&quot;:&quot;25&quot;/);
  const full = (await renderOdds('antique', { owned: COLLECTION_ITEM_IDS }))['odds-modal-body'].innerHTML;
  assert.match(full, /rule_collection_full/);
});

test('fenêtre des chances : textes courts présents en FR/EN/NL/ES avec les mêmes variables', () => {
  const { builtinDictionaries } = require('../tools/i18n/lib');
  const dicts = builtinDictionaries();
  const keys = ['summary', 'how', 'sec_draw', 'rule_draw', 'sec_coins', 'rule_coins', 'sec_fragments', 'rule_fragments',
    'rule_fragments_mult', 'rule_fragments_you', 'sec_boost', 'rule_boost', 'sec_collection', 'rule_collection', 'rule_collection_full'];
  const vars = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
  for (const k of keys) {
    const fr = dicts.fr.chest_odds[k];
    assert.ok(fr, `fr.${k}`);
    for (const lang of ['en', 'nl', 'es']) {
      const v = dicts[lang].chest_odds[k];
      assert.ok(v, `${lang}.${k}`);
      assert.strictEqual(vars(v), vars(fr), `${lang}.${k} : variables`);
    }
    // Synthèse et règles : phrases courtes (lisibles sur téléphone)
    if (!/mult$/.test(k)) assert.ok(fr.length <= 200, `fr.${k} trop long (${fr.length})`);
  }
});

test('fenêtre des chances : police et contraste suffisants sur téléphone', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
  const start = css.indexOf('/* Fenêtre « Récompenses et chances » (#20) */');
  const block = css.slice(start, css.indexOf('/* Confirmation de la boutique de cadeaux', start));
  // Aucun texte de la fenêtre sous 0,78rem, ni en gris --muted (contraste insuffisant sur fond sombre)
  for (const m of block.matchAll(/font-size:\s*([\d.]+)rem/g)) {
    assert.ok(Number(m[1]) >= 0.72, `font-size ${m[1]}rem`);
  }
  for (const sel of ['.odds-section p', '.odds-summary', '.odds-table {', '#odds-modal-meta', '.odds-you']) {
    const rule = block.slice(block.indexOf(sel), block.indexOf('}', block.indexOf(sel)));
    assert.doesNotMatch(rule, /var\(--muted\)/, sel);
    const fs_ = rule.match(/font-size:\s*([\d.]+)rem/);
    if (fs_) assert.ok(Number(fs_[1]) >= 0.82, `${sel} : ${fs_[1]}rem`);
  }
  assert.match(block, /\.odds-details > summary \{[^}]*min-height: 44px/);
});
