/**
 * chests.js
 * Tables de récompenses des coffres et logique d'ouverture.
 * Dépend de : GameState
 *
 * Chaque coffre correspond à un rarityKey de blocks.js :
 *   commun  → Vieille caisse
 *   rare    → Coffre en bois
 *   epique  → Coffre en fer
 */
const Chests = {

  // ── Tables de récompenses ─────────────────────────────────────────────────
  // Chaque entrée : { weight, type, + champs selon type }
  //   coins  → { min, max }   (coins aléatoires dans [min, max])
  //   relics → { amount }     (fragments de relique fixes)
  //   boost  → { mult, minutes }
  TABLES: {
    commun: [
      { weight: 50, type: 'coins',  min:  80, max:  180 },
      { weight: 30, type: 'coins',  min: 200, max:  400 },
      { weight: 20, type: 'relics', amount: 1 },
    ],
    rare: [
      { weight: 40, type: 'coins',  min: 300, max:  600 },
      { weight: 30, type: 'relics', amount: 1 },
      { weight: 20, type: 'boost',  mult: 2, minutes: 3 },
      { weight: 10, type: 'relics', amount: 2 },
    ],
    epique: [
      { weight: 30, type: 'coins',  min: 600, max: 1200 },
      { weight: 25, type: 'boost',  mult: 3, minutes: 5 },
      { weight: 25, type: 'relics', amount: 2 },
      { weight: 20, type: 'relics', amount: 3 },
    ],
  },

  // ── Utilitaires ───────────────────────────────────────────────────────────

  _rand(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  },

  _pick(table) {
    const total = table.reduce((s, r) => s + r.weight, 0);
    let rand = Math.random() * total;
    for (const row of table) {
      rand -= row.weight;
      if (rand <= 0) return row;
    }
    return table[table.length - 1];
  },

  // ── Ouverture ─────────────────────────────────────────────────────────────

  /**
   * Tire une récompense, l'applique à GameState et la retourne.
   * @param {string} rarityKey  'commun' | 'rare' | 'epique'
   * @returns {{ type: string, amount?: number, mult?: number, minutes?: number }}
   */
  open(rarityKey) {
    const table  = this.TABLES[rarityKey] ?? this.TABLES.commun;
    const entry  = this._pick(table);
    const result = { type: entry.type };

    if (entry.type === 'coins') {
      result.amount = this._rand(entry.min, entry.max);
      GameState.addCoins(result.amount);
      GameState.stats.totalCoinsEarned += result.amount;

    } else if (entry.type === 'relics') {
      result.amount = entry.amount + (GameState.relicBonuses?.relicFragmentBonus ?? 0);
      GameState.relicFragments += result.amount;

    } else if (entry.type === 'boost') {
      result.mult    = entry.mult;
      result.minutes = entry.minutes;
      GameState.setCoinBoost(entry.mult, entry.minutes * 60_000);
    }

    return result;
  },

  // ── Libellé ───────────────────────────────────────────────────────────────

  /** Retourne le texte affiché dans la popup de coffre. */
  rewardLabel(reward) {
    if (reward.type === 'coins')
      return t('ui.chest_reward_coins', { amount: reward.amount });
    if (reward.type === 'relics')
      return t('ui.chest_reward_relics', { amount: reward.amount, s: reward.amount > 1 ? 's' : '' });
    if (reward.type === 'boost')
      return t('ui.chest_reward_boost', { mult: reward.mult, minutes: reward.minutes });
    return '';
  },
};
