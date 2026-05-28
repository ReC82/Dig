/**
 * blocks.js
 * Définition des types de blocs et logique de création / frappe.
 * Dépend de : GameState (pour la profondeur au moment du spawn)
 */
const Blocks = {

  /** Catalogue des types de blocs, du plus superficiel au plus profond. */
  TYPES: [
    { name: 'Pierre',   icon: '🪨', color: 'linear-gradient(145deg,#555c6b,#374151)', hpBase:  5,  reward:  1  },
    { name: 'Calcaire', icon: '🟫', color: 'linear-gradient(145deg,#92400e,#6b2d08)', hpBase: 12,  reward:  3  },
    { name: 'Fer',      icon: '⚙️',  color: 'linear-gradient(145deg,#52637a,#334155)', hpBase: 28,  reward:  9  },
    { name: 'Or',       icon: '🟡', color: 'linear-gradient(145deg,#d97706,#92400e)', hpBase: 55,  reward: 25  },
    { name: 'Rubis',    icon: '🔴', color: 'linear-gradient(145deg,#dc2626,#7f1d1d)', hpBase: 100, reward: 60  },
    { name: 'Émeraude', icon: '💚', color: 'linear-gradient(145deg,#16a34a,#14532d)', hpBase: 180, reward: 140 },
    { name: 'Diamant',  icon: '💎', color: 'linear-gradient(145deg,#0ea5e9,#1e3a5f)', hpBase: 300, reward: 320 },
  ],

  /** Bloc actuellement affiché. */
  current: null,

  /** Choisit le type de bloc en fonction de la profondeur. */
  _typeFor(depth) {
    if (depth < 5)   return this.TYPES[0];
    if (depth < 12)  return this.TYPES[1];
    if (depth < 25)  return this.TYPES[2];
    if (depth < 45)  return this.TYPES[3];
    if (depth < 75)  return this.TYPES[4];
    if (depth < 120) return this.TYPES[5];
    return this.TYPES[6];
  },

  /**
   * Crée et retourne un nouveau bloc adapté à la profondeur donnée.
   * @param {number} depth
   */
  spawn(depth) {
    const type   = this._typeFor(depth);
    const hp     = Math.ceil(type.hpBase * (1 + (depth - 1) * 0.14));
    const reward = Math.ceil(type.reward  * (1 + (depth - 1) * 0.07));
    this.current = { type, hp, maxHp: hp, reward };
    return this.current;
  },

  /**
   * Applique des dégâts au bloc courant.
   * @returns {boolean} true si le bloc est détruit
   */
  hit(damage) {
    if (!this.current) return false;
    this.current.hp = Math.max(0, this.current.hp - damage);
    return this.current.hp === 0;
  },

  /** Pourcentage de HP restants (0..1). */
  hpRatio() {
    if (!this.current) return 0;
    return this.current.hp / this.current.maxHp;
  }
};
