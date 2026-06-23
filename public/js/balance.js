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
  // Les probabilités réelles vivent dans server/chestShop.js.
  // Ce tableau n'est utilisé que pour l'affichage UI (coût, icône, limite).
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
};
