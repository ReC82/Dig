/**
 * Tests des paramètres économiques réglables (ticket #20) : validation et lecture bornée
 * (server/economy.js), bonus Shard Magnet recalculé côté serveur (audit B8), application
 * côté client (balance.js, upgrades.js) et effet d'un changement admin sans redéploiement.
 * Serveur sur un port de test avec une base temporaire (hors server/data/).
 * Lancer : npm test
 */

'use strict';

const test     = require('node:test');
const assert   = require('node:assert');
const Database = require('better-sqlite3');
const crypto   = require('crypto');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const vm       = require('vm');
const { spawn } = require('child_process');

const economy = require('../server/economy');
const { rollChest } = require('../server/chestShop');

const ROOT  = path.join(__dirname, '..');
const PORT  = process.env.DIG_TEST_PORT_ECONOMY || '3119';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

// ── Scripts du navigateur dans un contexte vm ────────────────────────────────

function loadBrowser(files, exportsList) {
  const ctx = vm.createContext({ Math, Object, Array, Number, String, Boolean, JSON, Date, t: k => k });
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8'), ctx, { filename: f });
  }
  return vm.runInContext(`({ ${exportsList.join(', ')} })`, ctx);
}

// ── Unitaires serveur ────────────────────────────────────────────────────────

test('validateEconomyValue : bornes des multiplicateurs et des coûts, autres clés libres', () => {
  const v = economy.validateEconomyValue;
  assert.deepStrictEqual(v('coin_gain_multiplier', '2.5'), { value: '2.5' });
  assert.deepStrictEqual(v('upgrade_cost_multiplier', ' 1.0 '), { value: '1' });
  for (const bad of ['0', '0.05', '11', 'abc', '', '-1', 'Infinity']) {
    assert.ok(v('fragment_drop_multiplier', bad).error, `multiplicateur ${bad} refusé`);
  }
  assert.deepStrictEqual(v('chest_cost_rare', '12000'), { value: '12000' });
  for (const bad of ['0', '-5', '1.5', 'x', '2000000000']) {
    assert.ok(v('chest_cost_simple', bad).error, `coût ${bad} refusé`);
  }
  assert.deepStrictEqual(v('promotion_rate', '0.3'), { value: '0.3' });
});

test('getEconomy : valeurs neutres par défaut, valeurs invalides en base ignorées', () => {
  const def = economy.getEconomy({});
  assert.deepStrictEqual(def, {
    upgradeCostMultiplier: 1, coinGainMultiplier: 1, fragmentDropMultiplier: 1,
    chestCosts: { simple: 2000, rare: 15000, antique: 80000 },
  });
  const eco = economy.getEconomy({
    upgrade_cost_multiplier: '2', coin_gain_multiplier: 'abc', fragment_drop_multiplier: '50',
    chest_cost_simple: '500', chest_cost_rare: '0', chest_cost_antique: '1.5',
  });
  assert.strictEqual(eco.upgradeCostMultiplier, 2);
  assert.strictEqual(eco.coinGainMultiplier, 1);
  assert.strictEqual(eco.fragmentDropMultiplier, 1);
  assert.deepStrictEqual(eco.chestCosts, { simple: 500, rare: 15000, antique: 80000 });
});

test('relicFragmentBonus : recalculé depuis le niveau de Shard Magnet (B8)', () => {
  const b = economy.relicFragmentBonus;
  assert.strictEqual(b({}), 0);
  assert.strictEqual(b({ relics: {} }), 0);
  assert.strictEqual(b({ relics: { shard_magnet: 0 } }), 0);
  assert.strictEqual(b({ relics: { shard_magnet: 3 } }), 3);
  assert.strictEqual(b({ relics: { shard_magnet: 99 } }), 5);
  assert.strictEqual(b({ relics: ['shard_magnet'] }), 1);
  // Le cache client relicBonuses (falsifiable, jamais sauvegardé) n'est plus lu
  assert.strictEqual(b({ relicBonuses: { relicFragmentBonus: 50 } }), 0);
});

test('rollChest : coût admin, multiplicateur et bonus de relique appliqués au tirage', (t) => {
  t.mock.method(Math, 'random', () => 0.6); // simple : 2e ligne (poids 45→75) → 1 fragment
  const data = { coins: 1000, relicFragments: 0, relics: { shard_magnet: 2 }, shopChestsBought: {} };
  const { reward, cost } = rollChest('simple', data, { chest_cost_simple: '700', fragment_drop_multiplier: '2' });
  assert.strictEqual(cost, 700);
  assert.deepStrictEqual(reward, { type: 'relics', amount: 6 }); // (1 + 2) × 2
  assert.strictEqual(data.coins, 300);
  assert.strictEqual(data.relicFragments, 6);
});

test('serveur et client partagent les mêmes valeurs (Shard Magnet, coûts des coffres)', () => {
  const { Relics, Balance } = loadBrowser(['gameState.js', 'balance.js', 'relics.js'], ['Relics', 'Balance']);
  const magnet = Relics.DEFS.find(r => r.id === 'shard_magnet');
  assert.deepStrictEqual([...magnet.bonus.values], economy.SHARD_MAGNET_BONUS);
  for (const c of Balance.SHOP_CHESTS) assert.strictEqual(c.cost, economy.DEFAULT_CHEST_COSTS[c.id]);
});

// ── Client ───────────────────────────────────────────────────────────────────

test('client : décomposition de la récompense = montant réellement crédité (base × sac × … = total)', () => {
  const { Balance, Upgrades, GameState } = loadBrowser(
    ['gameState.js', 'balance.js', 'upgrades.js'], ['Balance', 'Upgrades', 'GameState']);
  // Même expression que la destruction d'un bloc normal (public/js/main.js)
  const credited = (r, boost) => Math.ceil(r * Upgrades.getRewardMultiplier() * boost);
  const keys     = bd => bd.factors.map(f => f.key).join(',');

  // Sans sac ni bonus : aucun facteur, total = base
  let bd = Upgrades.getRewardBreakdown(150, 1);
  assert.deepStrictEqual({ base: bd.base, n: bd.factors.length, total: bd.total }, { base: 150, n: 0, total: 150 });

  // Bonus seul
  bd = Upgrades.getRewardBreakdown(150, 2);
  assert.strictEqual(keys(bd), 'boost');
  assert.strictEqual(bd.total, 300);

  // Exemple de la recette : sac niveau 8 (×3,4) et bonus ×2 → 150 × 3,4 × 2 = 1 020 (sac compté une seule fois)
  GameState.upgrades.bag = 8;
  bd = Upgrades.getRewardBreakdown(150, 2);
  assert.strictEqual(keys(bd), 'bag,boost');
  assert.strictEqual(Number(bd.factors[0].mult.toFixed(2)), 3.4);
  assert.strictEqual(bd.base, 150);
  assert.strictEqual(bd.total, 1020);

  // Tous niveaux de sac, avec et sans bonus, bases variées : total affiché = montant crédité
  for (let bag = 0; bag <= 12; bag++) {
    GameState.upgrades.bag = bag;
    for (const boost of [1, 2, 3]) {
      for (const r of [1, 2, 7, 23, 151, 3360]) {
        bd = Upgrades.getRewardBreakdown(r, boost);
        assert.strictEqual(bd.total, credited(r, boost), `sac ${bag}, ×${boost}, base ${r}`);
        assert.strictEqual(bd.factors.some(f => f.key === 'bag'), bag > 0);
        assert.strictEqual(bd.factors.some(f => f.key === 'boost'), boost > 1);
      }
    }
  }

  // Relique de pièces et réglage admin apparaissent comme facteurs distincts
  GameState.upgrades.bag = 2;
  GameState.relicBonuses = { coinsPct: 0.1 };
  Balance.applyEconomy({ coinGainMultiplier: 1.5 });
  bd = Upgrades.getRewardBreakdown(40, 2);
  assert.strictEqual(keys(bd), 'bag,relic,event,boost');
  assert.strictEqual(bd.total, credited(40, 2));
});

test('client : applyEconomy modifie coûts des améliorations, gains et coûts des coffres', () => {
  const { Balance, Upgrades, GameState } = loadBrowser(
    ['gameState.js', 'balance.js', 'upgrades.js'], ['Balance', 'Upgrades', 'GameState']);
  const base     = Upgrades.getCost('pickaxe').coins;
  const baseMult = Upgrades.getRewardMultiplier();

  assert.strictEqual(Balance.applyEconomy(undefined), false, 'serveur muet : rien ne change');
  assert.strictEqual(Balance.applyEconomy(economy.getEconomy({})), false, 'valeurs par défaut : rien ne change');

  assert.strictEqual(Balance.applyEconomy(economy.getEconomy({
    upgrade_cost_multiplier: '1.5', coin_gain_multiplier: '3', chest_cost_antique: '40000',
  })), true);
  assert.strictEqual(Upgrades.getCost('pickaxe').coins, Math.ceil(base * 1.5));
  assert.strictEqual(Upgrades.getRewardMultiplier(), baseMult * 3);
  assert.strictEqual(Balance.SHOP_CHESTS.find(c => c.id === 'antique').cost, 40000);

  // canAfford suit le coût multiplié
  GameState.coins = base;
  assert.strictEqual(Upgrades.canAfford('pickaxe'), false);
  GameState.coins = Math.ceil(base * 1.5);
  assert.strictEqual(Upgrades.canAfford('pickaxe'), true);

  // Valeurs invalides ignorées
  assert.strictEqual(Balance.applyEconomy({ coinGainMultiplier: -1, chestCosts: { simple: 0 } }), false);
  assert.strictEqual(Balance.economy.coinGainMultiplier, 3);
});

// ── HTTP : changement admin visible sans redéploiement ───────────────────────

let dir, dbPath, server, db;

async function startServer() {
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: dbPath, ADMIN_SECRET: ADMIN, SESSION_SECRET: crypto.randomBytes(16).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', d => { log += d; });
  server.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${BASE}/api/version`); return; } catch (_) {}
    if (server.exitCode !== null) break;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Serveur de test non démarré :\n${log}`);
}

function client() {
  let cookie = '';
  return async (method, url, body, headers = {}) => {
    const res = await fetch(BASE + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}

const admin = (key, value) => client()('PUT', '/api/admin/config', { key, value }, { Authorization: `Bearer ${ADMIN}` });

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-economy-test-'));
  dbPath = path.join(dir, 'economy-test.sqlite');
  await startServer();
  db = new Database(dbPath, { readonly: true });
});

test.after(() => {
  if (db) db.close();
  if (server) server.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('HTTP : /api/seasons/current expose config.economy et suit l\'admin sans redémarrage', async () => {
  const anon = client();
  let r = await anon('GET', '/api/seasons/current');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.config.economy, economy.getEconomy({}));

  assert.strictEqual((await admin('coin_gain_multiplier', '2')).status, 200);
  assert.strictEqual((await admin('chest_cost_simple', '500')).status, 200);
  r = await anon('GET', '/api/seasons/current');
  assert.strictEqual(r.body.config.economy.coinGainMultiplier, 2);
  assert.strictEqual(r.body.config.economy.chestCosts.simple, 500);
});

test('HTTP : saisie admin invalide refusée (400) et valeur précédente conservée', async () => {
  const r = await admin('upgrade_cost_multiplier', '0');
  assert.strictEqual(r.status, 400);
  assert.match(r.body.error, /upgrade_cost_multiplier/);
  assert.strictEqual((await admin('chest_cost_rare', '-1')).status, 400);
  const row = db.prepare(`SELECT value FROM admin_config WHERE key='upgrade_cost_multiplier'`).get();
  assert.strictEqual(row.value, '1.0');
});

test('HTTP : l\'achat d\'un coffre applique le coût réglé dans l\'admin', async () => {
  const call = client();
  const reg = await call('POST', '/api/register', { username: 'eco_buyer', email: 'eco_buyer@example.invalid', password: 'secret123' });
  assert.strictEqual(reg.status, 200, JSON.stringify(reg.body));
  const s = await call('POST', '/api/me/save', { data: { coins: 600, relicFragments: 0, collection: [], shopChestsBought: {} } });
  assert.strictEqual(s.status, 200, JSON.stringify(s.body));

  const r = await call('POST', '/api/me/shop/chest/open', { chestId: 'simple' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.cost, 500);
  const gained = r.body.reward.type === 'coins' ? r.body.reward.amount : 0;
  assert.strictEqual(r.body.newCoins, 100 + gained);
});
