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
 *   v10 — + seasonStats { seasonId, maxDepth, manualBlocks, isActive }
 *   v11 — + seasonStats { autoBlocks, manualClicks, suspiciousScore }
 *   v12 — + seasonStats { regularityScore }
 *   v13 — + upgrades { fragment_shop, block_reroll }
 *   v14 — relics[] → relics{} (multi-niveaux : { id: level })
 *   v15 — + shopChestsBought { simple, rare, antique }
 */
const Save = {

  KEY:          'dig_save_v1',
  SAVE_VERSION: 15,

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
        relicFragments:   GameState.relicFragments,
        relics:           { ...GameState.relics },
        shopChestsBought: { ...GameState.shopChestsBought },
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
        seasonStats: { ...GameState.seasonStats },
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
      this._applyParsed(this._migrate(JSON.parse(raw)));
      return true;
    } catch (_) {
      return false;
    }
  },

  /**
   * Applique un objet save (déjà parsé + migré) à GameState.
   * Utilisé par load() et loadFromData().
   */
  _applyParsed(data) {
    this.loadedSaveTime = data.lastSaveTime ?? null;

    GameState.coins        = data.coins        ?? 0;
    GameState.gems         = data.gems          ?? 0;
    GameState.depth        = data.depth         ?? 1;
    GameState.pickaxeLevel = data.pickaxeLevel  ?? 1;
    GameState.damage       = data.damage        ?? 1;

    const u = data.upgrades ?? {};
    GameState.upgrades.luck          = u.luck          ?? 0;
    GameState.upgrades.bag           = u.bag           ?? 0;
    GameState.upgrades.autodig       = u.autodig       ?? 0;
    GameState.upgrades.fragment_shop = u.fragment_shop ?? 0;
    GameState.upgrades.block_reroll  = u.block_reroll  ?? 0;

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

    const scb = data.shopChestsBought ?? {};
    GameState.shopChestsBought.simple  = scb.simple  ?? 0;
    GameState.shopChestsBought.rare    = scb.rare     ?? 0;
    GameState.shopChestsBought.antique = scb.antique  ?? 0;

    const rawRelics = data.relics;
    if (rawRelics && typeof rawRelics === 'object' && !Array.isArray(rawRelics)) {
      GameState.relics = {};
      for (const [id, level] of Object.entries(rawRelics)) {
        if (typeof level === 'number' && level >= 1) GameState.relics[id] = level;
      }
    } else {
      GameState.relics = {};
    }
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

    const ss = data.seasonStats ?? {};
    GameState.seasonStats.seasonId         = ss.seasonId         ?? 0;
    GameState.seasonStats.maxDepth         = ss.maxDepth         ?? 0;
    GameState.seasonStats.manualBlocks     = ss.manualBlocks     ?? 0;
    GameState.seasonStats.autoBlocks       = ss.autoBlocks       ?? 0;
    GameState.seasonStats.manualClicks     = ss.manualClicks     ?? 0;
    GameState.seasonStats.suspiciousScore  = ss.suspiciousScore  ?? 0;
    GameState.seasonStats.regularityScore  = ss.regularityScore  ?? 0;
    GameState.seasonStats.isActive         = ss.isActive         ?? false;
  },

  /**
   * Charge une sauvegarde depuis un objet brut (sauvegarde cloud).
   * Applique les mêmes migrations que load().
   * @param   {object} rawData  Objet JS non stringifié (ex: réponse de /api/me/save)
   * @returns {boolean}
   */
  loadFromData(rawData) {
    try {
      this._applyParsed(this._migrate(rawData));
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
    if (v < 10) {
      data.seasonStats = { seasonId: 0, maxDepth: 0, manualBlocks: 0, isActive: false };
      data.saveVersion = 10;
    }
    if (v < 11) {
      data.seasonStats = {
        ...(data.seasonStats ?? {}),
        autoBlocks:      0,
        manualClicks:    0,
        suspiciousScore: 0,
      };
      data.saveVersion = 11;
    }
    if (v < 12) {
      data.seasonStats = { ...(data.seasonStats ?? {}), regularityScore: 0 };
      data.saveVersion = 12;
    }
    if (v < 13) {
      if (data.upgrades) {
        data.upgrades.fragment_shop = data.upgrades.fragment_shop ?? 0;
        data.upgrades.block_reroll  = data.upgrades.block_reroll  ?? 0;
      }
      data.saveVersion = 13;
    }
    if (v < 14) {
      // Ancien format : tableau de strings → objet { id: niveau }
      if (Array.isArray(data.relics)) {
        const obj = {};
        for (const id of data.relics) {
          if (typeof id === 'string') obj[id] = 1;
        }
        data.relics = obj;
      } else if (!data.relics || typeof data.relics !== 'object') {
        data.relics = {};
      }
      data.saveVersion = 14;
    }
    if (v < 15) {
      data.shopChestsBought = { simple: 0, rare: 0, antique: 0 };
      data.saveVersion = 15;
    }

    return data;
  },
};
