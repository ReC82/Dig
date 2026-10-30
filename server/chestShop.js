/**
 * server/chestShop.js
 * Source de vérité pour les coffres achetables : coûts, limites et tables de probabilités.
 * Le serveur tire ici les coffres des joueurs connectés ; la même table est publiée en lecture
 * seule par GET /api/shop/chests (describeChests) pour la fenêtre « Récompenses et chances » et
 * pour le tirage des joueurs anonymes : aucun pourcentage n'est recopié côté client.
 *
 * Tables (option A validée par le propriétaire le 30/10/2026, #20) — poids = % exacts :
 *
 * 📦 simple  (2 000 pièces, illimité/saison)
 *   45% → 💰 500–1 000 pièces
 *   30% → 🔮 1 fragment
 *   15% → ⚡ Boost ×2, 5 min
 *   10% → 💰 2 000–3 500 pièces (gros lot)
 *
 * 💎 rare    (15 000 pièces, illimité/saison)
 *   40% → 💰 5 000–9 000 pièces
 *   30% → 🔮 4 fragments
 *   12% → 🔮 7 fragments
 *    8% → ⚡ Boost ×2, 15 min
 *    8% → 📿 Objet de collection
 *    2% → 💰 15 000–25 000 pièces (gros lot)
 *
 * 🏺 antique (80 000 pièces, max 5/saison)
 *   30% → 💰 25 000–40 000 pièces
 *   25% → 🔮 20 fragments
 *   18% → 🔮 30 fragments
 *   10% → ⚡ Boost ×3, 20 min
 *   12% → 📿 Objet de collection
 *    4% → 🔮 50 fragments
 *    1% → 💰 100 000–150 000 pièces (gros lot)
 *
 * Un tirage de pièces rend toujours au moins un quart du prix par défaut ; l'espérance en pièces
 * reste inférieure au prix (pas de boucle de profit, cf. test/chest-shop-odds.test.js).
 */

const { DEFAULT_CHEST_COSTS, SHARD_MAGNET_BONUS, getEconomy, relicFragmentBonus } = require('./economy');

const COLLECTION_ITEM_IDS = [
  'fossil', 'crystal', 'ancient_coin', 'relic',
  'broken_crown', 'monster_tooth', 'map_fragment', 'mystic_orb',
];

/** Repli si toute la collection d'origine est déjà possédée (fragments fixes, sans bonus). */
const COLLECTION_CONSOLATION_FRAGMENTS = 5;

const SHOP_CHESTS = {
  simple: {
    cost:         DEFAULT_CHEST_COSTS.simple,
    maxPerSeason: null,
    table: [
      { weight: 45, type: 'coins',  min:   500, max: 1_000 },
      { weight: 30, type: 'relics', amount: 1 },
      { weight: 15, type: 'boost',  mult: 2, minutes: 5 },
      { weight: 10, type: 'coins',  min: 2_000, max: 3_500, jackpot: true },
    ],
  },
  rare: {
    cost:         DEFAULT_CHEST_COSTS.rare,
    maxPerSeason: null,
    table: [
      { weight: 40, type: 'coins',      min:  5_000, max:  9_000 },
      { weight: 30, type: 'relics',     amount: 4 },
      { weight: 12, type: 'relics',     amount: 7 },
      { weight:  8, type: 'boost',      mult: 2, minutes: 15 },
      { weight:  8, type: 'collection', amount: 1 },
      { weight:  2, type: 'coins',      min: 15_000, max: 25_000, jackpot: true },
    ],
  },
  antique: {
    cost:         DEFAULT_CHEST_COSTS.antique,
    maxPerSeason: 5,
    table: [
      { weight: 30, type: 'coins',      min:  25_000, max:  40_000 },
      { weight: 25, type: 'relics',     amount: 20 },
      { weight: 18, type: 'relics',     amount: 30 },
      { weight: 10, type: 'boost',      mult: 3, minutes: 20 },
      { weight: 12, type: 'collection', amount:  1 },
      { weight:  4, type: 'relics',     amount: 50 },
      { weight:  1, type: 'coins',      min: 100_000, max: 150_000, jackpot: true },
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
 * @returns {{ reward: object, boughtThisSeason: number, cost: number }}
 * @throws {Error}  Message lisible si la validation échoue
 */
function rollChest(chestId, data, config = {}) {
  const def = SHOP_CHESTS[chestId];
  if (!def) throw new Error('Coffre inconnu.');

  // Coût et multiplicateur de fragments réglables dans l'admin (bornés, cf. economy.js)
  const economy = getEconomy(config);
  const cost    = economy.chestCosts[chestId] ?? def.cost;

  const coins = data.coins ?? 0;
  if (coins < cost) throw new Error('Coins insuffisants.');

  if (!data.shopChestsBought) data.shopChestsBought = {};
  const alreadyBought = data.shopChestsBought[chestId] ?? 0;
  if (def.maxPerSeason !== null && alreadyBought >= def.maxPerSeason) {
    throw new Error('Limite saisonnière atteinte.');
  }

  const fragMult = economy.fragmentDropMultiplier;

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
    const bonus   = relicFragmentBonus(data);
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
      reward.amount = COLLECTION_CONSOLATION_FRAGMENTS;
      data.relicFragments = (data.relicFragments ?? 0) + COLLECTION_CONSOLATION_FRAGMENTS;
    }
  }

  return { reward, boughtThisSeason, cost };
}

/**
 * Description publique et en lecture seule des coffres (GET /api/shop/chests) : coût effectif,
 * limite saisonnière et table exacte (probabilité en %, plages, durées), plus les règles de
 * quantité des fragments et de sélection des objets. Sert à l'affichage des chances ET au tirage
 * des joueurs anonymes, pour que le client n'ait aucune probabilité recopiée en dur.
 */
function describeChests(config = {}) {
  const economy = getEconomy(config);
  const chests = Object.entries(SHOP_CHESTS).map(([id, def]) => {
    const total = def.table.reduce((s, r) => s + r.weight, 0);
    return {
      id,
      cost:         economy.chestCosts[id] ?? def.cost,
      maxPerSeason: def.maxPerSeason,
      table: def.table.map(row => ({ ...row, chance: Math.round(row.weight / total * 1e6) / 1e4 })),
    };
  });
  return {
    chests,
    fragments: {
      shardMagnetBonus: SHARD_MAGNET_BONUS,
      multiplier:       economy.fragmentDropMultiplier,
      minimum:          1,
    },
    collection: {
      itemIds:               COLLECTION_ITEM_IDS,
      consolationFragments:  COLLECTION_CONSOLATION_FRAGMENTS,
    },
  };
}

module.exports = { SHOP_CHESTS, rollChest, describeChests, COLLECTION_ITEM_IDS, COLLECTION_CONSOLATION_FRAGMENTS };
