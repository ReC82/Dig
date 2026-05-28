/**
 * gameState.js
 * Source unique de vérité pour l'état du joueur.
 * Aucune dépendance sur d'autres modules.
 */
const GameState = {

  // ── Ressources ──────────────────────────────
  coins: 0,
  gems:  0,

  // ── Progression ─────────────────────────────
  depth:        1,
  pickaxeLevel: 1,
  damage:       1,

  // ── Niveaux d'upgrades ───────────────────────
  upgrades: {
    luck:    0,
    bag:     0,
    autodig: 0,
  },

  // ── Collection & Objectifs ───────────────────
  collection: [],   // IDs des trouvailles obtenues
  quests:     {},   // { questId: true } pour chaque objectif complété

  // ── Statistiques ────────────────────────────
  stats: {
    blocksDestroyed:    0,
    totalCoinsEarned:   0,
    gemsFound:          0,
    chestsFound:        0,
    totalUpgradesBought: 0,
  },

  // ── Helpers ──────────────────────────────────

  addCoins(amount)   { this.coins += amount; },
  spendCoins(amount) { this.coins -= amount; },
  spendGems(amount)  { this.gems  -= amount; },
  nextDepth()        { this.depth += 1; },

  recordDestroy(reward, type) {
    this.stats.blocksDestroyed  += 1;
    this.stats.totalCoinsEarned += reward;
    if (type.isGem)   { this.gems += 1; this.stats.gemsFound   += 1; }
    if (type.isChest) { this.stats.chestsFound += 1; }
  },

  reset() {
    this.coins        = 0;
    this.gems         = 0;
    this.depth        = 1;
    this.pickaxeLevel = 1;
    this.damage       = 1;
    this.upgrades     = { luck: 0, bag: 0, autodig: 0 };
    this.collection   = [];
    this.quests       = {};
    this.stats        = {
      blocksDestroyed: 0, totalCoinsEarned: 0,
      gemsFound: 0, chestsFound: 0, totalUpgradesBought: 0,
    };
  },
};
