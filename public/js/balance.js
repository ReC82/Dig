/**
 * balance.js
 * Source unique de vérité pour tous les paramètres d'économie du jeu.
 * Modifier ce fichier pour ajuster la courbe de progression sans toucher la logique.
 *
 * Philosophie de progression :
 *   Niveaux  1–5  : quelques minutes  (début de saison fluide)
 *   Niveaux  6–10 : quelques heures   (progression régulière)
 *   Niveaux 11–15 : plusieurs jours   (objectif de fin de saison)
 */
const Balance = {

  // ── Pioche ────────────────────────────────────────────────────────────────
  // 14 entrées → niveaux 1→2 (index 0) jusqu'à 14→15 (index 13)
  // Total : ~1 946 000 coins pour le niveau max
  PICKAXE: [
    100,     250,     600,    1_500,    3_500,   //  1→ 5  (total :  ~6 k)
    7_500,  16_000,  32_000,  65_000, 120_000,   //  6→10  (total : ~247 k)
    200_000, 320_000, 480_000, 700_000,           // 11→15  (total : ~1946 k)
  ],

  // ── Chance (Luck) ─────────────────────────────────────────────────────────
  // 12 entrées → niveaux 0→1 (index 0) jusqu'à 11→12 (index 11)
  // Total : ~520 000 coins pour le niveau max
  LUCK: [
    100,    250,    600,   1_400,   3_200,          //  0→ 4  (total :   ~6 k)
    7_000, 14_500, 28_000,                          //  5→ 7  (total :  ~55 k)
    52_000, 88_000, 135_000, 190_000,               //  8→11  (total : ~520 k)
  ],

  // ── Sac (Bag) ────────────────────────────────────────────────────────────
  // 12 entrées → niveaux 0→1 (index 0) jusqu'à 11→12 (index 11)
  // Total : ~622 000 coins pour le niveau max
  BAG: [
    120,    300,    750,   1_800,   4_200,           //  0→ 4  (total :   ~7 k)
    9_000, 18_000, 35_000,                           //  5→ 7  (total :  ~69 k)
    63_000, 105_000, 160_000, 225_000,               //  8→11  (total : ~622 k)
  ],

  // ── Auto-Dig ──────────────────────────────────────────────────────────────
  // 6 entrées → niveaux 0→1 (index 0) jusqu'à 5→6 (index 5)
  // Premiers niveaux en coins, suivants en gemmes
  AUTODIG: [
    { coins:   800, gems:  0 },   // L0→L1
    { coins: 3_000, gems:  0 },   // L1→L2
    { coins:     0, gems:  4 },   // L2→L3
    { coins:     0, gems:  8 },   // L3→L4
    { coins:     0, gems: 18 },   // L4→L5
    { coins:     0, gems: 35 },   // L5→L6
  ],

  // ── Boutique de fragments (coin sink, max 10 achats/saison) ───────────────
  // Coût croissant à chaque achat saisonnier
  // Total si tout acheté : ~1 895 000 coins
  FRAGMENT_SHOP: [
      5_000,  12_000,  25_000,  48_000,   85_000,
    140_000, 210_000, 310_000, 440_000,  620_000,
  ],

  // ── Reroll de bloc (coin sink, ~illimité) ─────────────────────────────────
  // Coût doublé tous les 10 achats saisonniers.
  // Exemples : achats 0-9 : 400 🪙 | 10-19 : 800 🪙 | 20-29 : 1 600 🪙 …
  getRerollCost(level) {
    if (level >= 99) return null;
    const tier = Math.floor(level / 10);
    return { coins: 400 * Math.pow(2, tier), gems: 0 };
  },

  // ── Coffres achetables (coin sinks, récompenses aléatoires côté serveur) ───
  // Les probabilités réelles vivent dans server/chestShop.js et arrivent par GET /api/shop/chests
  // (applyChestCatalog) : `table` et `chestRules` restent vides tant que le serveur n'a pas répondu.
  // `cost` est remplacé par le coût réglé dans l'admin (applyEconomy / applyChestCatalog).
  SHOP_CHESTS: [
    {
      id:           'simple',
      icon:         '📦',
      nameKey:      'shop_chest.simple.name',
      descKey:      'shop_chest.simple.desc',
      cost:          2_000,
      maxPerSeason:  null,   // illimité
    },
    {
      id:           'rare',
      icon:         '💎',
      nameKey:      'shop_chest.rare.name',
      descKey:      'shop_chest.rare.desc',
      cost:         15_000,
      maxPerSeason:  null,
    },
    {
      id:           'antique',
      icon:         '🏺',
      nameKey:      'shop_chest.antique.name',
      descKey:      'shop_chest.antique.desc',
      cost:         80_000,
      maxPerSeason:  5,
    },
  ],

  // ── Paramètres réglables dans l'admin (ticket #20) ────────────────────────
  // Reçus de GET /api/seasons/current (config.economy) au chargement puis toutes les 5 min.
  // Valeurs neutres tant que le serveur n'a pas répondu (hors ligne : jeu inchangé).
  economy: {
    upgradeCostMultiplier:  1,
    coinGainMultiplier:     1,
    fragmentDropMultiplier: 1,
  },

  /**
   * Applique les paramètres économiques envoyés par le serveur.
   * Les valeurs absentes ou invalides sont ignorées (la valeur courante est conservée).
   * @returns {boolean} true si un paramètre a changé (l'interface doit être redessinée)
   */
  applyEconomy(eco) {
    if (!eco || typeof eco !== 'object') return false;
    let changed = false;
    const valid = v => typeof v === 'number' && Number.isFinite(v) && v > 0;
    for (const key of ['upgradeCostMultiplier', 'coinGainMultiplier', 'fragmentDropMultiplier']) {
      if (valid(eco[key]) && eco[key] !== this.economy[key]) {
        this.economy[key] = eco[key];
        changed = true;
      }
    }
    for (const chest of this.SHOP_CHESTS) {
      const cost = eco.chestCosts?.[chest.id];
      if (valid(cost) && Number.isInteger(cost) && cost !== chest.cost) {
        chest.cost = cost;
        changed = true;
      }
    }
    return changed;
  },

  /** Règles de quantité reçues du serveur (fragments, objets de collection) ; null = pas encore chargées. */
  chestRules: null,

  /**
   * Applique la description publique des coffres (GET /api/shop/chests) : coût, limite et table
   * exacte de chaque coffre, règles de fragments et d'objets. Réponse invalide → rien n'est modifié.
   * @returns {boolean} true si le catalogue a été appliqué
   */
  applyChestCatalog(catalog) {
    if (!catalog || !Array.isArray(catalog.chests) || !catalog.fragments || !catalog.collection) return false;
    for (const chest of this.SHOP_CHESTS) {
      const src = catalog.chests.find(c => c && c.id === chest.id);
      if (!src || !Array.isArray(src.table) || src.table.length === 0) return false;
    }
    for (const chest of this.SHOP_CHESTS) {
      const src = catalog.chests.find(c => c.id === chest.id);
      if (Number.isInteger(src.cost) && src.cost > 0) chest.cost = src.cost;
      chest.maxPerSeason = Number.isInteger(src.maxPerSeason) ? src.maxPerSeason : null;
      chest.table = src.table;
    }
    this.chestRules = { fragments: catalog.fragments, collection: catalog.collection };
    return true;
  },

  /**
   * Fragments réellement reçus pour une ligne « fragments » d'un coffre, avec la même formule que
   * le serveur (chestShop.rollChest) : max(minimum, arrondi((quantité + bonus Aimant) × multiplicateur)).
   * @param {number} amount           quantité de la ligne
   * @param {number} shardMagnetLevel niveau de la relique Aimant à éclats (0 = absente)
   */
  chestFragmentAmount(amount, shardMagnetLevel) {
    const f = this.chestRules?.fragments;
    if (!f) return amount;
    const level = Math.min(Math.max(0, Math.floor(shardMagnetLevel || 0)), f.shardMagnetBonus.length);
    const bonus = level > 0 ? f.shardMagnetBonus[level - 1] : 0;
    return Math.max(f.minimum, Math.round((amount + bonus) * f.multiplier));
  },

  /** Coût en pièces d'une amélioration après le multiplicateur admin (arrondi supérieur). */
  scaleUpgradeCoins(coins) {
    return coins > 0 ? Math.ceil(coins * this.economy.upgradeCostMultiplier) : coins;
  },
};
