/**
 * upgrades.js
 * Catalogue des améliorations et logique d'achat.
 * Dépend de : GameState
 *
 * Chaque définition expose :
 *   id          — identifiant unique
 *   icon        — emoji affiché sur la carte
 *   name        — nom affiché
 *   maxLevel    — niveau maximum (inclus)
 *   describe(level)  — texte décrivant l'effet au niveau courant
 *   getCost(level)   — { coins, gems } pour passer au niveau suivant,
 *                      ou null si niveau max atteint
 */
const Upgrades = {

  DEFS: [
    // ── Pioche ────────────────────────────────────────────────────────────────
    // Augmente les dégâts par clic. Part de niveau 1.
    // Coûts : 10 → 20 → 40 → 80 → … (×2 à chaque niveau)
    {
      id: 'pickaxe',
      icon: '⛏',
      name: 'Pioche',
      maxLevel: 15,
      describe(level) {
        return `${level} dégât${level > 1 ? 's' : ''} par clic`;
      },
      getCost(level) {
        if (level >= 15) return null;
        return { coins: Math.floor(10 * Math.pow(2, level - 1)), gems: 0 };
      },
    },

    // ── Chance ────────────────────────────────────────────────────────────────
    // Multiplie le poids des blocs rares/épiques/légendaires.
    // Coûts : 25 → 47 → 89 → 170 → … (×1.9 à chaque niveau)
    {
      id: 'luck',
      icon: '🍀',
      name: 'Chance',
      maxLevel: 8,
      describe(level) {
        if (level === 0) return 'Aucun bonus de rareté';
        return `+${level * 20}% chance de blocs rares`;
      },
      getCost(level) {
        if (level >= 8) return null;
        return { coins: Math.floor(25 * Math.pow(1.9, level)), gems: 0 };
      },
    },

    // ── Sac ───────────────────────────────────────────────────────────────────
    // Multiplie les récompenses en coins à la destruction d'un bloc.
    // Coûts : 40 → 80 → 160 → 320 → … (×2 à chaque niveau)
    {
      id: 'bag',
      icon: '🎒',
      name: 'Sac',
      maxLevel: 8,
      describe(level) {
        if (level === 0) return 'Récompenses normales';
        return `Récompenses \u00d7${(1 + level * 0.3).toFixed(1)}`;
      },
      getCost(level) {
        if (level >= 8) return null;
        return { coins: Math.floor(40 * Math.pow(2, level)), gems: 0 };
      },
    },

    // ── Auto-Dig ──────────────────────────────────────────────────────────────
    // Inflige automatiquement des dégâts toutes les secondes.
    // Niveaux 1-2 : coins seulement. Niveaux 3-6 : gemmes requises.
    {
      id: 'autodig',
      icon: '⚙',
      name: 'Auto-Dig',
      maxLevel: 6,
      describe(level) {
        if (level === 0) return 'Inactif';
        return `${level} dégât${level > 1 ? 's' : ''} automatique/sec`;
      },
      getCost(level) {
        const table = [
          { coins: 80,  gems: 0  }, // 0 → 1
          { coins: 280, gems: 0  }, // 1 → 2
          { coins: 0,   gems: 2  }, // 2 → 3
          { coins: 0,   gems: 5  }, // 3 → 4
          { coins: 0,   gems: 12 }, // 4 → 5
          { coins: 0,   gems: 25 }, // 5 → 6
        ];
        return table[level] ?? null;
      },
    },
  ],

  // ── Accès aux niveaux ─────────────────────────────────────────────────────

  getLevel(id) {
    if (id === 'pickaxe') return GameState.pickaxeLevel;
    return GameState.upgrades[id] ?? 0;
  },

  getCost(id) {
    const def = this.DEFS.find(d => d.id === id);
    return def ? def.getCost(this.getLevel(id)) : null;
  },

  /** Vérifie si le joueur a assez de ressources pour l'upgrade. */
  canAfford(id) {
    const cost = this.getCost(id);
    if (!cost) return false;
    if (cost.coins > 0 && GameState.coins < cost.coins) return false;
    if (cost.gems  > 0 && GameState.gems  < cost.gems)  return false;
    return true;
  },

  // ── Achat ─────────────────────────────────────────────────────────────────

  /**
   * Tente d'acheter un niveau d'upgrade.
   * @param {string} id
   * @returns {boolean} true si l'achat a réussi
   */
  buy(id) {
    if (!this.canAfford(id)) return false;

    const cost = this.getCost(id);
    if (cost.coins > 0) GameState.spendCoins(cost.coins);
    if (cost.gems  > 0) GameState.spendGems(cost.gems);

    if (id === 'pickaxe') {
      GameState.pickaxeLevel += 1;
      GameState.damage = GameState.pickaxeLevel;
    } else {
      GameState.upgrades[id] += 1;
    }

    return true;
  },

  // ── Effets actifs ─────────────────────────────────────────────────────────

  /** Multiplicateur appliqué aux récompenses (Sac). */
  getRewardMultiplier() {
    return 1 + GameState.upgrades.bag * 0.3;
  },

  /** Dégâts automatiques par seconde (0 = inactif). */
  getAutoDigDamage() {
    return GameState.upgrades.autodig;
  },
};
