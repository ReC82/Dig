/**
 * upgrades.js
 * Logique d'amélioration de la pioche.
 * Dépend de : GameState
 */
const Upgrades = {

  /**
   * Tente d'améliorer la pioche.
   * @returns {boolean} true si l'amélioration a réussi
   */
  upgradePickaxe() {
    if (!GameState.canAffordUpgrade()) return false;

    const cost = GameState.getUpgradeCost();
    GameState.spendCoins(cost);
    GameState.pickaxeLevel += 1;
    GameState.damage = GameState.pickaxeLevel;
    return true;
  }
};
