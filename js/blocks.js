/**
 * blocks.js
 * Catalogue des blocs et logique de spawn / frappe.
 * Dépend de : rien (GameState lit la profondeur en dehors)
 */
const Blocks = {

  /**
   * Catalogue complet.
   * - rarityKey  : utilisé comme suffixe CSS (.rarity-<key>)
   * - accent     : couleur des particules à la destruction
   * - weight     : poids dans le tirage aléatoire à la profondeur donnée
   * - isGem/isChest : déclenchent des effets spéciaux dans main.js
   */
  TYPES: [
    // ── Terre ────────────────────────────────────────────────────────────────
    {
      category: 'terre', name: 'Terre meuble', icon: '🟤',
      rarity: 'Commun', rarityKey: 'commun',
      color:  'linear-gradient(145deg,#78350f,#431407)',
      accent: '#92400e',
      hpBase: 3,  reward: 1,
      minDepth: 1, maxDepth: 12, weight: 70,
    },
    {
      category: 'terre', name: 'Argile', icon: '🟫',
      rarity: 'Commun', rarityKey: 'commun',
      color:  'linear-gradient(145deg,#92400e,#6b2d08)',
      accent: '#b45309',
      hpBase: 6,  reward: 2,
      minDepth: 4, maxDepth: 22, weight: 45,
    },

    // ── Pierre ───────────────────────────────────────────────────────────────
    {
      category: 'pierre', name: 'Pierre', icon: '🪨',
      rarity: 'Commun', rarityKey: 'commun',
      color:  'linear-gradient(145deg,#4b5563,#374151)',
      accent: '#6b7280',
      hpBase: 12, reward: 5,
      minDepth: 5, maxDepth: 9999, weight: 60,
    },
    {
      category: 'pierre', name: 'Grès', icon: '🏔',
      rarity: 'Commun', rarityKey: 'commun',
      color:  'linear-gradient(145deg,#78716c,#57534e)',
      accent: '#a8a29e',
      hpBase: 20, reward: 8,
      minDepth: 12, maxDepth: 9999, weight: 40,
    },
    {
      category: 'pierre', name: 'Granite', icon: '⬛',
      rarity: 'Peu commun', rarityKey: 'peu-commun',
      color:  'linear-gradient(145deg,#3f3f46,#27272a)',
      accent: '#71717a',
      hpBase: 38, reward: 16,
      minDepth: 25, maxDepth: 9999, weight: 28,
    },

    // ── Minerai ──────────────────────────────────────────────────────────────
    {
      category: 'minerai', name: 'Charbon', icon: '🖤',
      rarity: 'Peu commun', rarityKey: 'peu-commun',
      color:  'linear-gradient(145deg,#292524,#1c1917)',
      accent: '#78716c',
      hpBase: 28, reward: 22,
      minDepth: 8, maxDepth: 9999, weight: 22,
    },
    {
      category: 'minerai', name: 'Minerai de fer', icon: '⚙',
      rarity: 'Peu commun', rarityKey: 'peu-commun',
      color:  'linear-gradient(145deg,#52637a,#334155)',
      accent: '#94a3b8',
      hpBase: 55, reward: 50,
      minDepth: 20, maxDepth: 9999, weight: 15,
    },
    {
      category: 'minerai', name: "Minerai d'or", icon: '🟡',
      rarity: 'Rare', rarityKey: 'rare',
      color:  'linear-gradient(145deg,#d97706,#92400e)',
      accent: '#fbbf24',
      hpBase: 90, reward: 110,
      minDepth: 40, maxDepth: 9999, weight: 8,
    },

    // ── Coffre ───────────────────────────────────────────────────────────────
    {
      category: 'coffre', name: 'Coffre en bois', icon: '📦',
      rarity: 'Rare', rarityKey: 'rare',
      color:  'linear-gradient(145deg,#92400e,#78350f)',
      accent: '#d97706',
      hpBase: 18, reward: 160,
      minDepth: 5, maxDepth: 9999, weight: 6,
      isChest: true,
    },
    {
      category: 'coffre', name: 'Coffre en fer', icon: '🗃',
      rarity: 'Épique', rarityKey: 'epique',
      color:  'linear-gradient(145deg,#475569,#1e293b)',
      accent: '#94a3b8',
      hpBase: 40, reward: 420,
      minDepth: 30, maxDepth: 9999, weight: 3,
      isChest: true,
    },

    // ── Gemme ────────────────────────────────────────────────────────────────
    {
      category: 'gemme', name: 'Rubis', icon: '🔴',
      rarity: 'Épique', rarityKey: 'epique',
      color:  'linear-gradient(145deg,#dc2626,#7f1d1d)',
      accent: '#f87171',
      hpBase: 110, reward: 650,
      minDepth: 35, maxDepth: 9999, weight: 4,
      isGem: true,
    },
    {
      category: 'gemme', name: 'Émeraude', icon: '💚',
      rarity: 'Légendaire', rarityKey: 'legendaire',
      color:  'linear-gradient(145deg,#16a34a,#14532d)',
      accent: '#4ade80',
      hpBase: 200, reward: 1400,
      minDepth: 70, maxDepth: 9999, weight: 2,
      isGem: true,
    },
    {
      category: 'gemme', name: 'Diamant', icon: '💎',
      rarity: 'Légendaire', rarityKey: 'legendaire',
      color:  'linear-gradient(145deg,#0ea5e9,#1e3a5f)',
      accent: '#7dd3fc',
      hpBase: 350, reward: 3200,
      minDepth: 120, maxDepth: 9999, weight: 1,
      isGem: true,
    },
  ],

  current: null,

  /** Tirage aléatoire pondéré parmi les blocs disponibles à cette profondeur. */
  _pickType(depth) {
    const pool = this.TYPES.filter(t => depth >= t.minDepth && depth <= t.maxDepth);
    if (pool.length === 0) return this.TYPES[2]; // fallback : Pierre

    const total = pool.reduce((s, t) => s + t.weight, 0);
    let rand = Math.random() * total;
    for (const t of pool) {
      rand -= t.weight;
      if (rand <= 0) return t;
    }
    return pool[pool.length - 1];
  },

  /** Crée un nouveau bloc et le stocke dans `current`. */
  spawn(depth) {
    const type   = this._pickType(depth);
    const scale  = 1 + (depth - 1) * 0.12;
    const hp     = Math.ceil(type.hpBase * scale);
    const reward = Math.ceil(type.reward  * (1 + (depth - 1) * 0.05));
    this.current = { type, hp, maxHp: hp, reward };
    return this.current;
  },

  /** Applique des dégâts. Retourne true si le bloc est détruit. */
  hit(damage) {
    if (!this.current) return false;
    this.current.hp = Math.max(0, this.current.hp - damage);
    return this.current.hp === 0;
  },

  /** Ratio HP restants (0..1). */
  hpRatio() {
    if (!this.current) return 0;
    return this.current.hp / this.current.maxHp;
  },
};
