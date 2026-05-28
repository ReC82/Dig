/**
 * quests.js
 * Définition et vérification des objectifs.
 * Dépend de : GameState
 *
 * Les objectifs sont one-shot : une fois complétés, ils ne se redéclenchent pas.
 * La récompense est attribuée automatiquement dans checkAll().
 */
const Quests = {

  DEFS: [
    {
      id: 'break10',
      icon: '⛏',
      name: 'Premier coup',
      desc: 'Casser 10 blocs',
      reward: { coins: 50, gems: 0 },
      check() { return GameState.stats.blocksDestroyed >= 10; },
    },
    {
      id: 'depth25',
      icon: '🗺',
      name: 'Explorateur',
      desc: 'Atteindre la profondeur 25m',
      reward: { coins: 100, gems: 0 },
      check() { return GameState.depth >= 25; },
    },
    {
      id: 'coins100',
      icon: '💰',
      name: 'Premier trésor',
      desc: 'Gagner 100 coins au total',
      reward: { coins: 30, gems: 0 },
      check() { return GameState.stats.totalCoinsEarned >= 100; },
    },
    {
      id: 'find_gem',
      icon: '💎',
      name: 'Gemme !',
      desc: 'Trouver un bloc gemme',
      reward: { coins: 200, gems: 1 },
      check() { return GameState.stats.gemsFound >= 1; },
    },
    {
      id: 'upgrade5',
      icon: '🔧',
      name: 'Artisan',
      desc: 'Acheter 5 améliorations',
      reward: { coins: 150, gems: 0 },
      check() { return GameState.stats.totalUpgradesBought >= 5; },
    },
  ],

  isCompleted(id) {
    return GameState.quests[id] === true;
  },

  /**
   * Vérifie tous les objectifs non complétés et attribue les récompenses.
   * @param {boolean} silent — si true, retourne un tableau vide (pas de notifications)
   * @returns {object[]} objectifs nouvellement complétés
   */
  checkAll(silent = false) {
    const newlyCompleted = [];

    for (const def of this.DEFS) {
      if (!this.isCompleted(def.id) && def.check()) {
        GameState.quests[def.id] = true;
        if (def.reward.coins > 0) GameState.addCoins(def.reward.coins);
        if (def.reward.gems  > 0) GameState.gems += def.reward.gems;
        if (!silent) newlyCompleted.push(def);
      }
    }

    return newlyCompleted;
  },
};
