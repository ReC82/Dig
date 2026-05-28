/**
 * save.js
 * Persistance via localStorage avec versioning et migration.
 * Dépend de : GameState
 *
 * Versioning :
 *   v0 (implicite) — champs initiaux : coins, depth, pickaxeLevel, damage
 *   v1             — ajout : gems, stats
 *   (futures versions : ajouter un bloc `if (v < N)` dans _migrate)
 */
const Save = {

  KEY:          'dig_save_v1',
  SAVE_VERSION: 1,

  /**
   * Callback déclenché après chaque sauvegarde réussie.
   * Assigné par main.js : Save.onSave = () => { ... }
   */
  onSave: null,

  // ── Sauvegarde ────────────────────────────────────────────────────────────

  save() {
    try {
      const data = {
        saveVersion:  this.SAVE_VERSION,

        // Ressources
        coins: GameState.coins,
        gems:  GameState.gems,

        // Progression
        depth:        GameState.depth,
        pickaxeLevel: GameState.pickaxeLevel,
        damage:       GameState.damage,

        // Statistiques
        stats: { ...GameState.stats },
      };

      localStorage.setItem(this.KEY, JSON.stringify(data));

      if (typeof this.onSave === 'function') this.onSave();
    } catch (_) {
      // localStorage indisponible (navigation privée, quota dépassé…)
    }
  },

  // ── Chargement ────────────────────────────────────────────────────────────

  /**
   * Charge et migre la sauvegarde dans GameState.
   * @returns {boolean} true si une sauvegarde existait
   */
  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return false;

      const data = this._migrate(JSON.parse(raw));

      // Ressources
      GameState.coins = data.coins ?? 0;
      GameState.gems  = data.gems  ?? 0;

      // Progression
      GameState.depth        = data.depth        ?? 1;
      GameState.pickaxeLevel = data.pickaxeLevel ?? 1;
      GameState.damage       = data.damage       ?? 1;

      // Statistiques
      const s = data.stats ?? {};
      GameState.stats.blocksDestroyed  = s.blocksDestroyed  ?? 0;
      GameState.stats.totalCoinsEarned = s.totalCoinsEarned ?? 0;
      GameState.stats.gemsFound        = s.gemsFound        ?? 0;
      GameState.stats.chestsFound      = s.chestsFound      ?? 0;

      return true;
    } catch (_) {
      // Sauvegarde corrompue — on repart de zéro
      return false;
    }
  },

  // ── Reset ─────────────────────────────────────────────────────────────────

  /** Supprime la sauvegarde et remet GameState à zéro. */
  reset() {
    localStorage.removeItem(this.KEY);
    GameState.reset();
  },

  // ── Migration ─────────────────────────────────────────────────────────────

  /**
   * Applique les migrations nécessaires pour amener les données
   * à la version courante. Modifie `data` en place et le retourne.
   *
   * @param {object} data - données brutes issues de localStorage
   * @returns {object}    - données migrées
   */
  _migrate(data) {
    const v = data.saveVersion ?? 0;

    if (v < 1) {
      // v0 → v1 : ajout des gemmes et des statistiques
      data.gems  = 0;
      data.stats = { blocksDestroyed: 0, totalCoinsEarned: 0, gemsFound: 0, chestsFound: 0 };
      data.saveVersion = 1;
    }

    // Template pour les versions futures :
    // if (v < 2) {
    //   data.newField = defaultValue;
    //   data.saveVersion = 2;
    // }

    return data;
  },
};
