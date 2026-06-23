/**
 * relics.js
 * Catalogue multi-niveaux des reliques et logique de déverrouillage/amélioration.
 * Dépend de : GameState
 *
 * Stockage : GameState.relics = { id: level, … }
 *   — clé absente ou niveau 0 = verrouillée
 *   — niveau 1 = débloquée (base)
 *   — niveau maxLevel = niveau maximum
 *
 * Resources permanentes (jamais reset par les saisons) :
 *   GameState.relicFragments   — fragments accumulés
 *   GameState.relics           — reliques et leurs niveaux
 *   GameState.relicBonuses     — cache calculé par applyBonuses()
 *
 * Appeler Relics.applyBonuses() après tout changement de GameState.relics.
 */
const Relics = {

  DEFS: [
    {
      id:       'eye_of_miner',
      icon:     '👁',
      name:     'relic.eye_of_miner.name',
      desc:     'relic.eye_of_miner.desc',
      maxLevel: 5,
      // costs[i] = fragments pour passer du niveau i au niveau i+1
      // index 0 = déverrouillage (L0 → L1)
      costs: [5, 12, 22, 35, 55],
      bonus: {
        type:   'damage_flat',
        values: [2, 4, 6, 8, 10],   // bonus total au niveau L (index L-1)
      },
    },
    {
      id:       'golden_heart',
      icon:     '💛',
      name:     'relic.golden_heart.name',
      desc:     'relic.golden_heart.desc',
      maxLevel: 5,
      costs: [8, 18, 35, 55, 80],
      bonus: {
        type:   'coins_pct',
        values: [0.15, 0.30, 0.50, 0.75, 1.00],
      },
    },
    {
      id:       'shard_magnet',
      icon:     '🧲',
      name:     'relic.shard_magnet.name',
      desc:     'relic.shard_magnet.desc',
      maxLevel: 5,
      costs: [12, 25, 40, 60, 85],
      bonus: {
        type:   'relic_fragment_bonus',
        values: [1, 2, 3, 4, 5],
      },
    },
    {
      id:       'cracked_lens',
      icon:     '🔭',
      name:     'relic.cracked_lens.name',
      desc:     'relic.cracked_lens.desc',
      maxLevel: 5,
      costs: [15, 30, 50, 75, 110],
      bonus: {
        type:   'luck_pct',
        values: [0.20, 0.40, 0.65, 0.95, 1.30],
      },
    },
    {
      id:       'obsidian_claw',
      icon:     '🖤',
      name:     'relic.obsidian_claw.name',
      desc:     'relic.obsidian_claw.desc',
      maxLevel: 5,
      costs: [20, 40, 65, 95, 130],
      bonus: {
        type:   'hp_reduction',
        values: [0.10, 0.20, 0.30, 0.40, 0.50],
      },
    },
    {
      id:       'ancient_engine',
      icon:     '⚗️',
      name:     'relic.ancient_engine.name',
      desc:     'relic.ancient_engine.desc',
      maxLevel: 5,
      costs: [25, 50, 80, 120, 165],
      bonus: {
        type:   'autodig_bonus',
        values: [2, 4, 7, 10, 14],
      },
    },
  ],

  // ── Lecture ───────────────────────────────────────────────────────────────

  getLevel(id) {
    return GameState.relics[id] ?? 0;
  },

  isUnlocked(id) {
    return this.getLevel(id) >= 1;
  },

  canUnlock(id) {
    const def = this.DEFS.find(r => r.id === id);
    return !!def && this.getLevel(id) === 0 && GameState.relicFragments >= def.costs[0];
  },

  canUpgrade(id) {
    const def = this.DEFS.find(r => r.id === id);
    if (!def) return false;
    const level = this.getLevel(id);
    if (level < 1 || level >= def.maxLevel) return false;
    return GameState.relicFragments >= def.costs[level];
  },

  /** Coût en fragments pour le prochain niveau (débloquage OU amélioration). */
  getUpgradeCost(id) {
    const def = this.DEFS.find(r => r.id === id);
    if (!def) return null;
    const level = this.getLevel(id);
    return def.costs[level] ?? null;
  },

  // ── Déverrouillage ────────────────────────────────────────────────────────

  unlock(id) {
    if (!this.canUnlock(id)) return false;
    const def = this.DEFS.find(r => r.id === id);
    GameState.relicFragments -= def.costs[0];
    GameState.relics[id] = 1;
    this.applyBonuses();
    return true;
  },

  // ── Amélioration ──────────────────────────────────────────────────────────

  upgrade(id) {
    if (!this.canUpgrade(id)) return false;
    const def   = this.DEFS.find(r => r.id === id);
    const level = this.getLevel(id);
    GameState.relicFragments -= def.costs[level];
    GameState.relics[id] = level + 1;
    this.applyBonuses();
    return true;
  },

  // ── Calcul des bonus ──────────────────────────────────────────────────────

  /**
   * Recalcule l'intégralité des bonus de reliques et met à jour GameState.relicBonuses.
   * Met également à jour GameState.damage (qui dépend de damageFlat).
   * À appeler après : Save.load(), Relics.unlock(), Relics.upgrade(), GameState.reset().
   */
  applyBonuses() {
    const b = GameState.relicBonuses;
    b.damageFlat         = 0;
    b.coinsPct           = 0;
    b.relicFragmentBonus = 0;
    b.luckPct            = 0;
    b.hpReduction        = 0;
    b.autodigBonus       = 0;

    for (const [id, level] of Object.entries(GameState.relics)) {
      if (!level || level < 1) continue;
      const def = this.DEFS.find(r => r.id === id);
      if (!def) continue;
      const value = def.bonus.values[level - 1];
      if (value === undefined || value === null) continue;
      const { type } = def.bonus;
      if (type === 'damage_flat')          b.damageFlat         += value;
      if (type === 'coins_pct')            b.coinsPct           += value;
      if (type === 'relic_fragment_bonus') b.relicFragmentBonus += value;
      if (type === 'luck_pct')             b.luckPct            += value;
      if (type === 'hp_reduction')         b.hpReduction        += value;
      if (type === 'autodig_bonus')        b.autodigBonus       += value;
    }

    // Sécurité : la réduction de HP ne peut pas excéder 90%
    b.hpReduction = Math.min(b.hpReduction, 0.90);

    // GameState.damage est dérivé de pickaxeLevel + bonus plat permanent
    GameState.damage = GameState.pickaxeLevel + b.damageFlat;
  },

  // ── Formatage du bonus ────────────────────────────────────────────────────

  /**
   * Retourne la chaîne de bonus affichable pour un niveau donné.
   * Si level = 0, retourne le bonus du niveau 1 (pour preview sur relique verrouillée).
   */
  formatBonus(def, level) {
    const displayLevel = Math.max(1, level);
    const raw = def.bonus.values[displayLevel - 1];
    if (raw === undefined) return '';
    const { type } = def.bonus;

    if (type === 'damage_flat') {
      return t('relic.bonus_types.damage_flat', { n: raw, s: raw > 1 ? 's' : '' });
    }
    if (type === 'coins_pct') {
      return t('relic.bonus_types.coins_pct', { n: Math.round(raw * 100) });
    }
    if (type === 'relic_fragment_bonus') {
      return t('relic.bonus_types.relic_fragment_bonus', { n: raw, s: raw > 1 ? 's' : '' });
    }
    if (type === 'luck_pct') {
      return t('relic.bonus_types.luck_pct', { n: Math.round(raw * 100) });
    }
    if (type === 'hp_reduction') {
      return t('relic.bonus_types.hp_reduction', { n: Math.round(raw * 100) });
    }
    if (type === 'autodig_bonus') {
      return t('relic.bonus_types.autodig_bonus', { n: raw, s: raw > 1 ? 's' : '' });
    }
    return '';
  },
};
