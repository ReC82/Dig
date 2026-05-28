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
      name:       "Œil du mineur",
      desc:       "La vision d'un mineur légendaire. Chaque coup frappe plus fort.",
      cost:       5,
      bonus:      { type: 'damage_flat', value: 2 },
      bonusLabel: '+2 dégâts par clic',
    },
    {
      id:         'golden_heart',
      icon:       '💛',
      name:       "Cœur d'or",
      desc:       "Un cœur façonné en or pur. Les pièces affluent davantage.",
      cost:       8,
      bonus:      { type: 'coins_pct', value: 0.25 },
      bonusLabel: '+25% pièces',
    },
    {
      id:         'shard_magnet',
      icon:       '🧲',
      name:       'Aimant à éclats',
      desc:       "Attire les fragments depuis les profondeurs. Les coffres en donnent davantage.",
      cost:       12,
      bonus:      { type: 'relic_fragment_bonus', value: 1 },
      bonusLabel: '+1 fragment par coffre',
    },
    {
      id:         'cracked_lens',
      icon:       '🔭',
      name:       'Lentille fissurée',
      desc:       "Même brisée, elle révèle les minerais les plus rares.",
      cost:       20,
      bonus:      { type: 'luck_pct', value: 0.30 },
      bonusLabel: '+30% blocs rares',
    },
    {
      id:         'obsidian_claw',
      icon:       '🖤',
      name:       "Griffe d'obsidienne",
      desc:       "Née dans les profondeurs. Les blocs s'effritent sous sa pression.",
      cost:       30,
      bonus:      { type: 'hp_reduction', value: 0.15 },
      bonusLabel: '-15% HP des blocs',
    },
    {
      id:         'ancient_engine',
      icon:       '⚗️',
      name:       'Moteur antique',
      desc:       "Une machine hors d'âge qui creuse sans relâche.",
      cost:       50,
      bonus:      { type: 'autodig_bonus', value: 3 },
      bonusLabel: '+3 dégâts auto/sec',
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
