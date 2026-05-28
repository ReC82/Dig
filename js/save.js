/**
 * save.js
 * Persistance via localStorage avec versioning et migration.
 * Dépend de : GameState
 *
 * Versions :
 *   v0 — coins, depth, pickaxeLevel, damage
 *   v1 — + gems, stats
 *   v2 — + upgrades { luck, bag, autodig }
 *   v3 — + collection[], quests{}, stats.totalUpgradesBought
 *   v4 — + daily{}, coinBoost{}
 *   v5 — + monetization{ adLastWatched, pickaxeSkin }
 *   v6 — + relicFragments
 *   v7 — + dailyMissions{ date, missions[], baselineStats }
 *   v8 — + relics[] (relicBonuses non sauvegardé — calculé au chargement)
 *   v9 — + lastSaveTime (timestamp, non stocké dans GameState)
 */
const Save = {

  KEY:          'dig_save_v1',
  SAVE_VERSION: 9,

  onSave: null,

  /** Timestamp de la dernière sauvegarde, lu au chargement pour les gains offline. */
  loadedSaveTime: null,

  // ── Sauvegarde ────────────────────────────────────────────────────────────

  save() {
    try {
      const data = {
        saveVersion:  this.SAVE_VERSION,
        lastSaveTime: Date.now(),
        coins:        GameState.coins,
        gems:         GameState.gems,
        depth:        GameState.depth,
        pickaxeLevel: GameState.pickaxeLevel,
        damage:       GameState.damage,
        upgrades:     { ...GameState.upgrades },
        collection:   [...GameState.collection],
        quests:       { ...GameState.quests },
        stats:        { ...GameState.stats },
        daily:        { ...GameState.daily },
        coinBoost:    { ...GameState.coinBoost },
        monetization:   { ...GameState.monetization },
        relicFragments: GameState.relicFragments,
        relics:         [...GameState.relics],
        dailyMissions: {
          date:     GameState.dailyMissions.date,
          missions: GameState.dailyMissions.missions.map(m => ({
            id:      m.id,
            target:  m.target,
            reward:  { coins: m.reward.coins, gems: m.reward.gems },
            claimed: m.claimed,
          })),
          baselineStats: GameState.dailyMissions.baselineStats
            ? { ...GameState.dailyMissions.baselineStats } : null,
        },
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

      this.loadedSaveTime = data.lastSaveTime ?? null;

      GameState.coins        = data.coins        ?? 0;
      GameState.gems         = data.gems          ?? 0;
      GameState.depth        = data.depth         ?? 1;
      GameState.pickaxeLevel = data.pickaxeLevel  ?? 1;
      GameState.damage       = data.damage        ?? 1;

      const u = data.upgrades ?? {};
      GameState.upgrades.luck    = u.luck    ?? 0;
      GameState.upgrades.bag     = u.bag     ?? 0;
      GameState.upgrades.autodig = u.autodig ?? 0;

      GameState.collection = Array.isArray(data.collection) ? data.collection : [];
      GameState.quests     = (data.quests && typeof data.quests === 'object') ? data.quests : {};

      const s = data.stats ?? {};
      GameState.stats.blocksDestroyed     = s.blocksDestroyed     ?? 0;
      GameState.stats.totalCoinsEarned    = s.totalCoinsEarned    ?? 0;
      GameState.stats.gemsFound           = s.gemsFound           ?? 0;
      GameState.stats.chestsFound         = s.chestsFound         ?? 0;
      GameState.stats.totalUpgradesBought = s.totalUpgradesBought ?? 0;

      const dd = data.daily ?? {};
      GameState.daily.lastClaimDate = dd.lastClaimDate ?? null;
      GameState.daily.streakDay     = dd.streakDay     ?? 0;

      const cb = data.coinBoost ?? {};
      GameState.coinBoost.multiplier = cb.multiplier ?? 1;
      GameState.coinBoost.expiresAt  = cb.expiresAt  ?? 0;

      const m = data.monetization ?? {};
      GameState.monetization.adLastWatched = m.adLastWatched ?? 0;
      GameState.monetization.pickaxeSkin   = m.pickaxeSkin   ?? null;

      GameState.relicFragments = data.relicFragments ?? 0;
      GameState.relics = Array.isArray(data.relics)
        ? data.relics.filter(id => typeof id === 'string')
        : [];
      // relicBonuses est un cache : recalculé par Relics.applyBonuses() dans init()

      const dm = data.dailyMissions ?? {};
      GameState.dailyMissions.date = dm.date ?? null;
      GameState.dailyMissions.missions = Array.isArray(dm.missions)
        ? dm.missions.map(m => ({
            id:      String(m.id ?? ''),
            target:  Number(m.target ?? 0),
            reward:  { coins: Number(m.reward?.coins ?? 0), gems: Number(m.reward?.gems ?? 0) },
            claimed: Boolean(m.claimed),
          }))
        : [];
      GameState.dailyMissions.baselineStats =
        (dm.baselineStats && typeof dm.baselineStats === 'object')
          ? { ...dm.baselineStats } : null;

      return true;
    } catch (_) {
      return false;
    }
  },

  // ── Reset ─────────────────────────────────────────────────────────────────

  reset() {
    // On conserve la clé mais on sauvegarde juste la progression game
    // (GameState.reset() ne touche pas monetization, donc les skins persistent)
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
    if (v < 3) {
      data.collection = [];
      data.quests     = {};
      if (data.stats) data.stats.totalUpgradesBought = 0;
      data.saveVersion = 3;
    }
    if (v < 4) {
      data.daily     = { lastClaimDate: null, streakDay: 0 };
      data.coinBoost = { multiplier: 1, expiresAt: 0 };
      data.saveVersion = 4;
    }
    if (v < 5) {
      data.monetization = { adLastWatched: 0, pickaxeSkin: null };
      data.saveVersion = 5;
    }
    if (v < 6) {
      data.relicFragments = 0;
      data.saveVersion = 6;
    }
    if (v < 7) {
      data.dailyMissions = { date: null, missions: [], baselineStats: null };
      data.saveVersion = 7;
    }
    if (v < 8) {
      data.relics = [];
      data.saveVersion = 8;
    }
    if (v < 9) {
      // lastSaveTime est un champ hors-GameState : aucune migration nécessaire
      data.saveVersion = 9;
    }

    // if (v < 10) { /* futures migrations */ }

    return data;
  },
};
