/**
 * server/chestShop.js
 * Source de vérité pour les coffres achetables : coûts, limites et tables de probabilités.
 * Importé par server/index.js — jamais exposé au client.
 *
 * Tables de probabilités :
 *
 * 📦 simple  (2 000 coins, illimité/saison)
 *   50% → 💰 80–200 coins
 *   25% → 💰 200–500 coins
 *   20% → 🔮 1 fragment
 *    5% → ⚡ Boost ×2, 3 min
 *
 * 💎 rare    (15 000 coins, illimité/saison)
 *   30% → 💰 1 000–3 000 coins
 *   20% → 💰 3 000–8 000 coins
 *   25% → 🔮 2 fragments
 *   12% → 🔮 3 fragments
 *    8% → ⚡ Boost ×2, 10 min
 *    5% → 📿 Objet de collection
 *
 * 🏺 antique (80 000 coins, max 5/saison)
 *   25% → 💰 10 000–25 000 coins
 *   25% → 🔮 5 fragments
 *   15% → 🔮 10 fragments
 *   13% → ⚡ Boost ×3, 15 min
 *   12% → 📿 Objet de collection
 *    7% → 🔮 20 fragments (jackpot)
 *    3% → 🔮 30 fragments (ultra-rare)
 */

const COLLECTION_ITEM_IDS = [
  'fossil', 'crystal', 'ancient_coin', 'relic',
  'broken_crown', 'monster_tooth', 'map_fragment', 'mystic_orb',
];

const SHOP_CHESTS = {
  simple: {
    cost:         2_000,
    maxPerSeason: null,
    table: [
      { weight: 50, type: 'coins',  min:  80, max:  200 },
      { weight: 25, type: 'coins',  min: 200, max:  500 },
      { weight: 20, type: 'relics', amount: 1 },
      { weight:  5, type: 'boost',  mult: 2, minutes: 3 },
    ],
  },
  rare: {
    cost:         15_000,
    maxPerSeason: null,
    table: [
      { weight: 30, type: 'coins',      min: 1_000, max: 3_000 },
      { weight: 20, type: 'coins',      min: 3_000, max: 8_000 },
      { weight: 25, type: 'relics',     amount: 2 },
      { weight: 12, type: 'relics',     amount: 3 },
      { weight:  8, type: 'boost',      mult: 2, minutes: 10 },
      { weight:  5, type: 'collection', amount: 1 },
    ],
  },
  antique: {
    cost:         80_000,
    maxPerSeason: 5,
    table: [
      { weight: 25, type: 'coins',      min: 10_000, max: 25_000 },
      { weight: 25, type: 'relics',     amount:  5 },
      { weight: 15, type: 'relics',     amount: 10 },
      { weight: 13, type: 'boost',      mult: 3, minutes: 15 },
      { weight: 12, type: 'collection', amount:  1 },
      { weight:  7, type: 'relics',     amount: 20 },
      { weight:  3, type: 'relics',     amount: 30 },
    ],
  },
};

function _rand(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function _pick(table) {
  const total = table.reduce((s, r) => s + r.weight, 0);
  let r = Math.random() * total;
  for (const row of table) {
    r -= row.weight;
    if (r <= 0) return row;
  }
  return table[table.length - 1];
}

/**
 * Valide l'achat, tire la récompense et met à jour le blob de sauvegarde en place.
 *
 * @param {string}  chestId   'simple' | 'rare' | 'antique'
 * @param {object}  data      Blob JSON parsé de la sauvegarde (modifié en place)
 * @param {object}  [config]  admin_config key→value (pour overrides coûts/multiplicateurs)
 * @returns {{ reward: object, boughtThisSeason: number }}
 * @throws {Error}  Message lisible si la validation échoue
 */
function rollChest(chestId, data, config = {}) {
  const def = SHOP_CHESTS[chestId];
  if (!def) throw new Error('Coffre inconnu.');

  // Coût overridé par admin_config si présent
  const configCost = parseInt(config[`chest_cost_${chestId}`] ?? '', 10);
  const cost = (!isNaN(configCost) && configCost > 0) ? configCost : def.cost;

  const coins = data.coins ?? 0;
  if (coins < cost) throw new Error('Coins insuffisants.');

  if (!data.shopChestsBought) data.shopChestsBought = {};
  const alreadyBought = data.shopChestsBought[chestId] ?? 0;
  if (def.maxPerSeason !== null && alreadyBought >= def.maxPerSeason) {
    throw new Error('Limite saisonnière atteinte.');
  }

  // Multiplicateur de fragments
  const fragMult = Math.max(0.1, parseFloat(config.fragment_drop_multiplier ?? '1') || 1);

  // Déduire le coût
  data.coins = coins - cost;

  // Enregistrer l'achat
  data.shopChestsBought[chestId] = alreadyBought + 1;
  const boughtThisSeason = data.shopChestsBought[chestId];

  // Tirer la récompense
  const entry  = _pick(def.table);
  const reward = { type: entry.type };

  if (entry.type === 'coins') {
    reward.amount = _rand(entry.min, entry.max);
    data.coins   += reward.amount;
    if (data.stats) data.stats.totalCoinsEarned = (data.stats.totalCoinsEarned ?? 0) + reward.amount;

  } else if (entry.type === 'relics') {
    const bonus   = data.relicBonuses?.relicFragmentBonus ?? 0;
    reward.amount = Math.max(1, Math.round((entry.amount + bonus) * fragMult));
    data.relicFragments = (data.relicFragments ?? 0) + reward.amount;

  } else if (entry.type === 'boost') {
    reward.mult    = entry.mult;
    reward.minutes = entry.minutes;
    // Le boost sera appliqué côté client (GameState.setCoinBoost)

  } else if (entry.type === 'collection') {
    const have    = Array.isArray(data.collection) ? data.collection : [];
    const missing = COLLECTION_ITEM_IDS.filter(id => !have.includes(id));
    if (missing.length > 0) {
      reward.itemId    = missing[Math.floor(Math.random() * missing.length)];
      data.collection  = [...have, reward.itemId];
    } else {
      // Collection complète : fragments de consolation
      reward.type   = 'relics';
      reward.amount = 5;
      data.relicFragments = (data.relicFragments ?? 0) + 5;
    }
  }

  return { reward, boughtThisSeason };
}

module.exports = { SHOP_CHESTS, rollChest, COLLECTION_ITEM_IDS };
