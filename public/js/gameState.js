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
    luck:          0,
    bag:           0,
    autodig:       0,
    fragment_shop: 0,   // fragments achetés cette saison
    block_reroll:  0,   // rerolls utilisés cette saison
  },

  // ── Bloc courant reproductible (#35) ─────────
  // blockSeed : graine propre à la sauvegarde ; blockSeq : numéro du dernier bloc tiré.
  // Le bloc courant lui-même (type, PV restants…) est sauvegardé via Blocks.snapshot().
  blockSeed: 0,
  blockSeq:  0,

  // ── Coffres achetés cette saison ─────────────
  shopChestsBought: { simple: 0, rare: 0, antique: 0 },

  // ── Collection & Objectifs ───────────────────
  collection: [],
  collectionMeta: {},   // { id: { at, n, season } } — date/quantité trouvées (#39)
  quests:     {},

  // ── Statistiques ────────────────────────────
  stats: {
    blocksDestroyed:     0,
    totalCoinsEarned:    0,
    gemsFound:           0,
    chestsFound:         0,
    totalUpgradesBought: 0,
    minedByType:         {},   // { idBloc: n } cumulé — badges #38 (crédité par le serveur, borné)
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

  // ── Reliques ──────────────────────────────────
  relics: {},             // { [id]: level } — 0/absent = verrouillée, 1–5 = niveau
  relicBonuses: {         // cache calculé — NON sauvegardé, recalculé par Relics.applyBonuses()
    damageFlat:          0,   // dégâts supplémentaires par clic
    coinsPct:            0,   // multiplicateur de pièces (ex. 0.25 = +25%)
    relicFragmentBonus:  0,   // fragments supplémentaires par coffre
    luckPct:             0,   // bonus de luck pour blocs rares
    hpReduction:         0,   // réduction de HP des blocs (ex. 0.15 = -15%)
    autodigBonus:        0,   // dégâts auto supplémentaires par seconde
  },

  // ── Micro-bonus d'événement (#81) ─────────────
  // Bonus de dégâts fractionnaires actifs (modèle public/js/microBonus.js). NON sauvegardé et
  // toujours vide : aucun bonus n'est transmis au jeu sans décision du propriétaire.
  eventBonuses: [],

  // ── Monétisation ─────────────────────────────
  // Note : non réinitialisé par reset() — les achats sont persistants.
  monetization: {
    adLastWatched: 0,     // timestamp ms ; cooldown publicité
    pickaxeSkin:   null,  // null | 'golden' | 'diamond'
  },

  // ── Pioche à charges (#71) ────────────────────
  // Réserve de coups et arbres permanents en gemmes ; conservés par reset() (comme les achats) et par
  // le changement de saison. charges/at à null : réserve pleine à la première activation.
  pickaxe: {
    charges: null, at: 0, depleted: false,
    capLevel: 0, speedLevel: 0,
    fullHits: 0, refilled: 0, refillCoins: 0,
  },

  // ── Saison compétitive ────────────────────────
  seasonStats: {
    seasonId:       0,     // ID de la saison active au dernier sync serveur
    maxDepth:       0,     // profondeur maximale atteinte pendant la saison
    manualBlocks:   0,     // blocs détruits manuellement (hors autodig) pendant la saison
    autoBlocks:     0,     // blocs détruits par l'autodig pendant la saison
    manualClicks:   0,     // total de clics sur le bloc (y compris sans destruction)
    suspiciousScore: 0,     // cumul de clics suspects détectés par l'anti-autoclicker
    suspiciousBlocks: 0,    // blocs cassés par un coup suspect (ni manuels ni auto, #74)
    throttledHits:   0,     // coups au-delà de la cadence maximale, sans dégât (#74)
    regularityScore: 0,     // régularité des intervalles (0=humain, 1=robotique)
    isActive:        false, // true dès le 1er bloc manuel → joueur actif dans la saison
  },

  // ── Helpers ──────────────────────────────────

  // Précision des dégâts et PV (#81) : calculs en centièmes entiers (virgule fixe), jamais en
  // flottants accumulés. Une valeur a au plus 2 décimales ; 0,1 + 0,2 donne exactement 0,3.
  toCents(v)   { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : 0; },
  fromCents(c) { return c / 100; },
  /** Quantité de dégâts/PV ramenée au centième, jamais négative (entiers inchangés). */
  normAmount(v) { return Math.max(0, this.toCents(v)) / 100; },

  addCoins(amount)   { this.coins += amount; },
  spendCoins(amount) { this.coins -= amount; },
  spendGems(amount)  { this.gems  -= amount; },
  nextDepth() {
    this.depth += 1;
    if (this.depth > this.seasonStats.maxDepth) this.seasonStats.maxDepth = this.depth;
  },

  recordDestroy(reward, type) {
    this.stats.blocksDestroyed  += 1;
    this.stats.totalCoinsEarned += reward;
    if (type.isGem)   { this.gems += 1; this.stats.gemsFound   += 1; }
    if (type.isChest) { this.stats.chestsFound += 1; }
  },

  getCoinBoostMultiplier() {
    return (this.coinBoost.expiresAt > Date.now()) ? this.coinBoost.multiplier : 1;
  },

  /**
   * Accorde un boost de pièces (coffre, pub, bonus quotidien, boutique).
   * Un nouveau boost ne réduit JAMAIS la durée restante (#47) : sa durée
   * s'ajoute au temps restant, et le multiplicateur le plus fort est conservé
   * (même règle que le bouton pub, qui prolongeait déjà le boost actif).
   */
  setCoinBoost(multiplier, durationMs, now = Date.now()) {
    const mult = Number(multiplier);
    const ms   = Number(durationMs);
    if (!Number.isFinite(mult) || mult <= 1 || !Number.isFinite(ms) || ms <= 0) return;
    const active = this.coinBoost.expiresAt > now;
    this.coinBoost.multiplier = active ? Math.max(this.coinBoost.multiplier, mult) : mult;
    this.coinBoost.expiresAt  = (active ? this.coinBoost.expiresAt : now) + ms;
  },

  reset() {
    this.coins          = 0;
    this.gems           = 0;
    this.relicFragments = 0;
    this.depth          = 1;
    this.pickaxeLevel = 1;
    this.damage       = 1;
    this.upgrades          = { luck: 0, bag: 0, autodig: 0, fragment_shop: 0, block_reroll: 0 };
    this.shopChestsBought  = { simple: 0, rare: 0, antique: 0 };
    this.collection        = [];
    this.collectionMeta    = {};
    this.quests       = {};
    this.stats        = {
      blocksDestroyed: 0, totalCoinsEarned: 0,
      gemsFound: 0, chestsFound: 0, totalUpgradesBought: 0, minedByType: {},
    };
    this.daily        = { lastClaimDate: null, streakDay: 0 };
    this.relics        = {};
    this.relicBonuses  = { damageFlat: 0, coinsPct: 0, relicFragmentBonus: 0, luckPct: 0, hpReduction: 0, autodigBonus: 0 };
    this.dailyMissions = { date: null, missions: [], baselineStats: null };
    this.coinBoost    = { multiplier: 1, expiresAt: 0 };
    // blockSeed/blockSeq préservés : la suite des blocs continue (aucune relance, #35)
    // monetization intentionnellement préservé (achats et cooldown persistants)
    // pickaxe préservé (#71) : niveaux achetés en gemmes et réserve de coups
  },
};
