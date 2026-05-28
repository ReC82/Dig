/**
 * save.js
 * Persistance via localStorage avec versioning et migration.
 * Dépend de : GameState
 *
 * Versions :
 *   v0 (implicite) — coins, depth, pickaxeLevel, damage
 *   v1             — + gems, stats
 *   v2             — + upgrades { luck, bag, autodig }
 */
const Save = {

  KEY:          'dig_save_v1',
  SAVE_VERSION: 2,

  /** Callback déclenché après chaque sauvegarde réussie (assigné par main.js). */
  onSave: null,

  // ── Sauvegarde ────────────────────────────────────────────────────────────

  save() {
    try {
      const data = {
        saveVersion:  this.SAVE_VERSION,
        coins:        GameState.coins,
        gems:         GameState.gems,
        depth:        GameState.depth,
        pickaxeLevel: GameState.pickaxeLevel,
        damage:       GameState.damage,
        upgrades:     { ...GameState.upgrades },
        stats:        { ...GameState.stats },
      };
      localStorage.setItem(this.KEY, JSON.stringify(data));
      if (typeof this.onSave === 'function') this.onSave();
    } catch (_) { /* localStorage indisponible */ }
  },

  // ── Chargement ────────────────────────────────────────────────────────────

  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return false;

      const data = this._migrate(JSON.parse(raw));

      GameState.coins        = data.coins        ?? 0;
      GameState.gems         = data.gems          ?? 0;
      GameState.depth        = data.depth         ?? 1;
      GameState.pickaxeLevel = data.pickaxeLevel  ?? 1;
      GameState.damage       = data.damage        ?? 1;

      const u = data.upgrades ?? {};
      GameState.upgrades.luck    = u.luck    ?? 0;
      GameState.upgrades.bag     = u.bag     ?? 0;
      GameState.upgrades.autodig = u.autodig ?? 0;

      const s = data.stats ?? {};
      GameState.stats.blocksDestroyed  = s.blocksDestroyed  ?? 0;
      GameState.stats.totalCoinsEarned = s.totalCoinsEarned ?? 0;
      GameState.stats.gemsFound        = s.gemsFound        ?? 0;
      GameState.stats.chestsFound      = s.chestsFound      ?? 0;

      return true;
    } catch (_) {
      return false;
    }
  },

  // ── Reset ─────────────────────────────────────────────────────────────────

  reset() {
    localStorage.removeItem(this.KEY);
    GameState.reset();
  },

  // ── Migration ─────────────────────────────────────────────────────────────

  _migrate(data) {
    const v = data.saveVersion ?? 0;

    if (v < 1) {
      data.gems  = 0;
      data.stats = { blocksDestroyed: 0, totalCoinsEarned: 0, gemsFound: 0, chestsFound: 0 };
      data.saveVersion = 1;
    }

    if (v < 2) {
      data.upgrades = { luck: 0, bag: 0, autodig: 0 };
      data.saveVersion = 2;
    }

    // if (v < 3) { /* futures migrations */ }

    return data;
  },
};
