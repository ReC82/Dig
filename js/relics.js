/**
 * relics.js
 * Catalogue des reliques et logique de déverrouillage.
 * Dépend de : GameState
 *
 * Les reliques sont achetées avec des fragments (GameState.relicFragments).
 * Leurs bonus sont stockés dans GameState.relicBonuses (cache calculé).
 * Appeler Relics.applyBonuses() après tout changement de GameState.relics.
 */
const Relics = {

  DEFS: [
    {
      id:         'eye_of_miner',
      icon:       '👁',
      name:       'relic.eye_of_miner.name',
      desc:       'relic.eye_of_miner.desc',
      cost:       5,
      bonus:      { type: 'damage_flat', value: 2 },
      bonusLabel: 'relic.eye_of_miner.bonus',
    },
    {
      id:         'golden_heart',
      icon:       '💛',
      name:       'relic.golden_heart.name',
      desc:       'relic.golden_heart.desc',
      cost:       8,
      bonus:      { type: 'coins_pct', value: 0.25 },
      bonusLabel: 'relic.golden_heart.bonus',
    },
    {
      id:         'shard_magnet',
      icon:       '🧲',
      name:       'relic.shard_magnet.name',
      desc:       'relic.shard_magnet.desc',
      cost:       12,
      bonus:      { type: 'relic_fragment_bonus', value: 1 },
      bonusLabel: 'relic.shard_magnet.bonus',
    },
    {
      id:         'cracked_lens',
      icon:       '🔭',
      name:       'relic.cracked_lens.name',
      desc:       'relic.cracked_lens.desc',
      cost:       20,
      bonus:      { type: 'luck_pct', value: 0.30 },
      bonusLabel: 'relic.cracked_lens.bonus',
    },
    {
      id:         'obsidian_claw',
      icon:       '🖤',
      name:       'relic.obsidian_claw.name',
      desc:       'relic.obsidian_claw.desc',
      cost:       30,
      bonus:      { type: 'hp_reduction', value: 0.15 },
      bonusLabel: 'relic.obsidian_claw.bonus',
    },
    {
      id:         'ancient_engine',
      icon:       '⚗️',
      name:       'relic.ancient_engine.name',
      desc:       'relic.ancient_engine.desc',
      cost:       50,
      bonus:      { type: 'autodig_bonus', value: 3 },
      bonusLabel: 'relic.ancient_engine.bonus',
    },
  ],

  // ── Lecture ───────────────────────────────────────────────────────────────

  isUnlocked(id) {
    return GameState.relics.includes(id);
  },

  canUnlock(id) {
    const def = this.DEFS.find(r => r.id === id);
    return !!def && !this.isUnlocked(id) && GameState.relicFragments >= def.cost;
  },

  // ── Déverrouillage ────────────────────────────────────────────────────────

  unlock(id) {
    if (!this.canUnlock(id)) return false;
    const def = this.DEFS.find(r => r.id === id);
    GameState.relicFragments -= def.cost;
    GameState.relics.push(id);
    this.applyBonuses();
    return true;
  },

  // ── Calcul des bonus ──────────────────────────────────────────────────────

  /**
   * Recalcule l'intégralité des bonus de reliques et met à jour GameState.relicBonuses.
   * Met également à jour GameState.damage (qui dépend de damageFlat).
   * À appeler après : Save.load(), Relics.unlock(), GameState.reset().
   */
  applyBonuses() {
    const b = GameState.relicBonuses;
    b.damageFlat         = 0;
    b.coinsPct           = 0;
    b.relicFragmentBonus = 0;
    b.luckPct            = 0;
    b.hpReduction        = 0;
    b.autodigBonus       = 0;

    for (const id of GameState.relics) {
      const def = this.DEFS.find(r => r.id === id);
      if (!def) continue;
      const { type, value } = def.bonus;
      if (type === 'damage_flat')          b.damageFlat         += value;
      if (type === 'coins_pct')            b.coinsPct           += value;
      if (type === 'relic_fragment_bonus') b.relicFragmentBonus += value;
      if (type === 'luck_pct')             b.luckPct            += value;
      if (type === 'hp_reduction')         b.hpReduction        += value;
      if (type === 'autodig_bonus')        b.autodigBonus       += value;
    }

    // Sécurité : la réduction de HP ne peut pas excéder 90%
    b.hpReduction = Math.min(b.hpReduction, 0.90);

    // GameState.damage est dérivé de pickaxeLevel + bonus plat
    GameState.damage = GameState.pickaxeLevel + b.damageFlat;
  },
};
