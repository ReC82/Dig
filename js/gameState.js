/**
 * gameState.js
 * Source unique de vérité pour l'état du joueur.
 * Aucune dépendance sur d'autres modules.
 */
const GameState = {

  // ── Ressources ──────────────────────────────
  coins:          0,
  gems:           0,
  relicFragments: 0,

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
  collection: [],
  quests:     {},

  // ── Statistiques ────────────────────────────
  stats: {
    blocksDestroyed:     0,
    totalCoinsEarned:    0,
    gemsFound:           0,
    chestsFound:         0,
    totalUpgradesBought: 0,
  },

  // ── Récompense quotidienne ────────────────────
  daily: {
    lastClaimDate: null,
    streakDay:     0,
  },

  // ── Missions quotidiennes ─────────────────────
  // missions[] : [{ id, target, reward: {coins,gems}, claimed }]
  // baselineStats : snapshot des stats au moment de génération (progression = actuel - baseline)
  dailyMissions: {
    date:          null,
    missions:      [],
    baselineStats: null,
  },

  // ── Boost temporaire ──────────────────────────
  coinBoost: {
    multiplier: 1,
    expiresAt:  0,
  },

  // ── Monétisation ─────────────────────────────
  // Note : non réinitialisé par reset() — les achats sont persistants.
  monetization: {
    adLastWatched: 0,     // timestamp ms ; cooldown publicité
    pickaxeSkin:   null,  // null | 'golden' | 'diamond'
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

  getCoinBoostMultiplier() {
    return (this.coinBoost.expiresAt > Date.now()) ? this.coinBoost.multiplier : 1;
  },

  setCoinBoost(multiplier, durationMs) {
    this.coinBoost.multiplier = multiplier;
    this.coinBoost.expiresAt  = Date.now() + durationMs;
  },

  reset() {
    this.coins          = 0;
    this.gems           = 0;
    this.relicFragments = 0;
    this.depth          = 1;
    this.pickaxeLevel = 1;
    this.damage       = 1;
    this.upgrades     = { luck: 0, bag: 0, autodig: 0 };
    this.collection   = [];
    this.quests       = {};
    this.stats        = {
      blocksDestroyed: 0, totalCoinsEarned: 0,
      gemsFound: 0, chestsFound: 0, totalUpgradesBought: 0,
    };
    this.daily        = { lastClaimDate: null, streakDay: 0 };
    this.dailyMissions = { date: null, missions: [], baselineStats: null };
    this.coinBoost    = { multiplier: 1, expiresAt: 0 };
    // monetization intentionnellement préservé (achats et cooldown persistants)
  },
};
