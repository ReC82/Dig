/**
 * gameState.js
 * Source unique de vérité pour l'état du joueur.
 * Aucune dépendance sur d'autres modules.
 */
const GameState = {
  coins:        0,
  depth:        1,
  pickaxeLevel: 1,
  damage:       1,

  /** Coût de la prochaine amélioration de pioche. */
  getUpgradeCost() {
    return Math.floor(10 * Math.pow(2, this.pickaxeLevel - 1));
  },

  canAffordUpgrade() {
    return this.coins >= this.getUpgradeCost();
  },

  addCoins(amount) {
    this.coins += amount;
  },

  spendCoins(amount) {
    this.coins -= amount;
  },

  nextDepth() {
    this.depth += 1;
  }
};
