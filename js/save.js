/**
 * save.js
 * Sauvegarde et chargement via localStorage.
 * Dépend de : GameState
 */
const Save = {

  KEY: 'dig_save_v1',

  /** Sauvegarde l'état courant. */
  save() {
    try {
      const data = {
        coins:        GameState.coins,
        depth:        GameState.depth,
        pickaxeLevel: GameState.pickaxeLevel,
        damage:       GameState.damage,
      };
      localStorage.setItem(this.KEY, JSON.stringify(data));
    } catch (_) { /* localStorage indisponible */ }
  },

  /**
   * Charge la sauvegarde dans GameState.
   * @returns {boolean} true si une sauvegarde existait
   */
  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      GameState.coins        = data.coins        ?? 0;
      GameState.depth        = data.depth        ?? 1;
      GameState.pickaxeLevel = data.pickaxeLevel ?? 1;
      GameState.damage       = data.damage       ?? 1;
      return true;
    } catch (_) {
      return false;
    }
  },

  /** Efface la sauvegarde et remet l'état à zéro. */
  reset() {
    localStorage.removeItem(this.KEY);
    GameState.coins        = 0;
    GameState.depth        = 1;
    GameState.pickaxeLevel = 1;
    GameState.damage       = 1;
  }
};
