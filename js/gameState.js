/**
 * gameState.js
 * Source unique de vérité pour l'état du joueur.
 * Aucune dépendance sur d'autres modules.
 */
const GameState = {

  // ── Ressources ──────────────────────────────
  coins: 0,
  gems:  0,   // gemmes collectées (blocs "gemme" détruits)

  // ── Progression ─────────────────────────────
  depth:        1,
  pickaxeLevel: 1,
  damage:       1,

  // ── Statistiques de session ──────────────────
  stats: {
    blocksDestroyed:  0,
    totalCoinsEarned: 0,
    gemsFound:        0,
    chestsFound:      0,
  },

  // ── Helpers ──────────────────────────────────

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
  },

  /**
   * Enregistre la destruction d'un bloc :
   * met à jour les stats et incrémente les gemmes si besoin.
   * @param {number} reward - coins gagnés
   * @param {object} type   - type du bloc (Blocks.TYPES[i])
   */
  recordDestroy(reward, type) {
    this.stats.blocksDestroyed  += 1;
    this.stats.totalCoinsEarned += reward;
    if (type.isGem)   { this.gems += 1; this.stats.gemsFound  += 1; }
    if (type.isChest) { this.stats.chestsFound += 1; }
  },

  /** Remet toutes les valeurs à leur état initial. */
  reset() {
    this.coins        = 0;
    this.gems         = 0;
    this.depth        = 1;
    this.pickaxeLevel = 1;
    this.damage       = 1;
    this.stats = { blocksDestroyed: 0, totalCoinsEarned: 0, gemsFound: 0, chestsFound: 0 };
  },
};
