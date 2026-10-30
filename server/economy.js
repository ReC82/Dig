/**
 * server/economy.js
 * Paramètres économiques réglables depuis l'admin (ticket #20) : lecture bornée de
 * admin_config, validation des saisies admin et bonus de reliques recalculés côté serveur.
 * Module pur (aucun accès à la base) : utilisé par chestShop.js, seasons.js et index.js.
 *
 * Valeur absente ou invalide en base → valeur par défaut (1.0, ou coût par défaut du coffre) :
 * une mauvaise saisie ne peut ni casser le jeu ni rendre un coffre gratuit.
 */

'use strict';

/** Coûts par défaut des coffres (utilisés par chestShop.js ; surchargés par chest_cost_*). */
const DEFAULT_CHEST_COSTS = { simple: 2_000, rare: 15_000, antique: 80_000 };

const MULTIPLIER_MIN = 0.1;
const MULTIPLIER_MAX = 10;
const CHEST_COST_MAX = 1_000_000_000;

/** Clés économiques et leur type de valeur. */
const ECONOMY_KEYS = {
  upgrade_cost_multiplier:  'multiplier',
  coin_gain_multiplier:     'multiplier',
  fragment_drop_multiplier: 'multiplier',
  chest_cost_simple:        'cost',
  chest_cost_rare:          'cost',
  chest_cost_antique:       'cost',
};

/**
 * Bonus de fragments de la relique Shard Magnet par niveau (index = niveau - 1).
 * DOIT rester identique à public/js/relics.js (vérifié par test/economy.test.js).
 */
const SHARD_MAGNET_BONUS = [1, 2, 3, 4, 5];

/**
 * Valide une valeur saisie dans l'admin pour une clé économique.
 * @returns {{ value: string } | { error: string }}  value normalisée (chaîne stockée)
 */
function validateEconomyValue(key, raw) {
  const kind = ECONOMY_KEYS[key];
  if (!kind) return { value: String(raw) };
  const text = String(raw).trim();
  const n = Number(text);
  if (text === '' || !Number.isFinite(n)) return { error: `${key} : nombre attendu.` };
  if (kind === 'multiplier') {
    if (n < MULTIPLIER_MIN || n > MULTIPLIER_MAX) {
      return { error: `${key} : valeur entre ${MULTIPLIER_MIN} et ${MULTIPLIER_MAX} attendue.` };
    }
    return { value: String(n) };
  }
  if (!Number.isInteger(n) || n < 1 || n > CHEST_COST_MAX) {
    return { error: `${key} : entier entre 1 et ${CHEST_COST_MAX} attendu.` };
  }
  return { value: String(n) };
}

function _multiplier(value) {
  const n = parseFloat(value);
  return (Number.isFinite(n) && n >= MULTIPLIER_MIN && n <= MULTIPLIER_MAX) ? n : 1;
}

function _cost(value, fallback) {
  const n = Number(value);
  return (Number.isInteger(n) && n >= 1 && n <= CHEST_COST_MAX) ? n : fallback;
}

/**
 * Paramètres économiques effectifs à partir de admin_config (clé → valeur texte).
 * Exposés au client par GET /api/seasons/current (champ config.economy).
 */
function getEconomy(config = {}) {
  const chestCosts = {};
  for (const [id, fallback] of Object.entries(DEFAULT_CHEST_COSTS)) {
    chestCosts[id] = _cost(config[`chest_cost_${id}`], fallback);
  }
  return {
    upgradeCostMultiplier:  _multiplier(config.upgrade_cost_multiplier),
    coinGainMultiplier:     _multiplier(config.coin_gain_multiplier),
    fragmentDropMultiplier: _multiplier(config.fragment_drop_multiplier),
    chestCosts,
  };
}

/**
 * Bonus de fragments par coffre, recalculé depuis le niveau de Shard Magnet de la sauvegarde
 * (le cache client relicBonuses n'est pas sauvegardé, cf. audit B8).
 */
function relicFragmentBonus(data) {
  const relics = data?.relics;
  // Sauvegardes antérieures à v14 : liste d'identifiants débloqués (= niveau 1)
  const level = Array.isArray(relics)
    ? (relics.includes('shard_magnet') ? 1 : 0)
    : Number(relics?.shard_magnet ?? 0);
  if (!Number.isInteger(level) || level < 1) return 0;
  return SHARD_MAGNET_BONUS[Math.min(level, SHARD_MAGNET_BONUS.length) - 1];
}

module.exports = {
  DEFAULT_CHEST_COSTS, ECONOMY_KEYS, SHARD_MAGNET_BONUS,
  validateEconomyValue, getEconomy, relicFragmentBonus,
};
