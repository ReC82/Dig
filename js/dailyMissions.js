/**
 * dailyMissions.js
 * 3 missions quotidiennes générées de façon déterministe depuis la date locale.
 * Dépend de : GameState, Daily (pour Daily.getToday())
 *
 * Principe :
 *   – Au premier accès de la journée, on génère 3 missions depuis un pool de 6.
 *   – On prend un snapshot des stats (baselineStats) pour mesurer la progression
 *     faite AUJOURD'HUI (pas depuis le début de la partie).
 *   – La progression = stat_actuelle – stat_baseline, plafonnée à target.
 *   – Les missions persistent dans GameState.dailyMissions et sont sauvegardées.
 */
const DailyMissions = {

  // ── Pool de missions disponibles ──────────────────────────────────────────
  // statKey 'depth' est un cas spécial : pointe sur GameState.depth, pas stats.
  POOL: [
    {
      id: 'break_blocks',
      icon: '⛏',
      name: 'Briseur',
      descFn:   (t) => `Casser ${t} blocs`,
      targets:  [20, 40, 75, 100, 150],
      statKey:  'blocksDestroyed',
      rewardFn: (t) => ({ coins: t * 4, gems: 0 }),
    },
    {
      id: 'earn_coins',
      icon: '💰',
      name: 'Accumulateur',
      descFn:   (t) => `Gagner ${t} pièces`,
      targets:  [200, 500, 800, 1200, 2000],
      statKey:  'totalCoinsEarned',
      rewardFn: (t) => ({ coins: Math.round(t * 0.25), gems: 0 }),
    },
    {
      id: 'open_chests',
      icon: '📦',
      name: 'Chercheur de trésors',
      descFn:   (t) => `Ouvrir ${t} coffre${t > 1 ? 's' : ''}`,
      targets:  [1, 2, 3, 4, 5],
      statKey:  'chestsFound',
      rewardFn: (t) => ({ coins: t * 120, gems: t >= 4 ? 1 : 0 }),
    },
    {
      id: 'buy_upgrades',
      icon: '⚙',
      name: 'Bricoleur',
      descFn:   (t) => `Acheter ${t} amélioration${t > 1 ? 's' : ''}`,
      targets:  [1, 2, 3, 4, 5],
      statKey:  'totalUpgradesBought',
      rewardFn: (t) => ({ coins: t * 80, gems: 0 }),
    },
    {
      id: 'find_gems',
      icon: '💎',
      name: 'Gemmologue',
      descFn:   (t) => `Trouver ${t} gemme${t > 1 ? 's' : ''}`,
      targets:  [1, 2, 3],
      statKey:  'gemsFound',
      rewardFn: (t) => ({ coins: t * 200, gems: 1 }),
    },
    {
      id: 'depth_gain',
      icon: '🗺',
      name: 'Explorateur du jour',
      descFn:   (t) => `Creuser ${t}\u202fm de plus`,
      targets:  [10, 20, 30, 50, 75],
      statKey:  'depth',
      rewardFn: (t) => ({ coins: t * 8, gems: 0 }),
    },
  ],

  // ── Génération déterministe ───────────────────────────────────────────────

  /** Hash stable d'une chaîne → entier non signé 32 bits. */
  _hash(str) {
    let h = 0xdeadbeef;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 0x9e3779b9);
      h ^= h >>> 16;
    }
    return h >>> 0;
  },

  /** LCG (Linear Congruential Generator) : entier → prochain entier pseudo-aléatoire. */
  _lcg(n) {
    return ((n * 1664525 + 1013904223) >>> 0);
  },

  /** Tire 3 missions distinctes + leur objectif à partir de la date. Même date → mêmes missions. */
  _generate(dateStr) {
    let rng  = this._hash(dateStr);
    const pool = [...this.POOL];   // copie pour éviter de muter l'original lors du splice
    const missions = [];

    for (let i = 0; i < 3; i++) {
      rng = this._lcg(rng);
      const def = pool.splice(rng % pool.length, 1)[0];

      rng = this._lcg(rng);
      const target = def.targets[rng % def.targets.length];

      missions.push({
        id:      def.id,
        target,
        reward:  def.rewardFn(target),
        claimed: false,
      });
    }

    return missions;
  },

  // ── Accès / rafraîchissement ──────────────────────────────────────────────

  /**
   * Génère les missions du jour si ce n'est pas encore fait (ou si le jour a changé).
   * Idempotent : peut être appelé à tout moment sans effet de bord si le jour n'a pas changé.
   */
  refresh() {
    const today = Daily.getToday();
    const dm    = GameState.dailyMissions;

    if (dm.date === today) return;   // déjà à jour

    dm.date     = today;
    dm.missions = this._generate(today);
    dm.baselineStats = {
      blocksDestroyed:     GameState.stats.blocksDestroyed,
      totalCoinsEarned:    GameState.stats.totalCoinsEarned,
      chestsFound:         GameState.stats.chestsFound,
      totalUpgradesBought: GameState.stats.totalUpgradesBought,
      gemsFound:           GameState.stats.gemsFound,
      depth:               GameState.depth,
    };
  },

  // ── Progression ───────────────────────────────────────────────────────────

  /** Retourne la progression actuelle pour la mission à l'index `idx` (plafonnée à target). */
  getProgress(idx) {
    const dm   = GameState.dailyMissions;
    const m    = dm.missions[idx];
    const base = dm.baselineStats;
    if (!m || !base) return 0;

    const def = this.POOL.find(p => p.id === m.id);
    if (!def) return 0;

    const current = (def.statKey === 'depth')
      ? GameState.depth
      : (GameState.stats[def.statKey] ?? 0);

    return Math.min(current - (base[def.statKey] ?? 0), m.target);
  },

  isDone(idx) {
    const m = GameState.dailyMissions.missions[idx];
    return !!m && this.getProgress(idx) >= m.target;
  },

  /** Retourne true si au moins une mission est terminée et non encore réclamée. */
  hasUnclaimedCompleted() {
    return GameState.dailyMissions.missions.some((_, i) => !GameState.dailyMissions.missions[i].claimed && this.isDone(i));
  },

  // ── Réclamation ───────────────────────────────────────────────────────────

  /**
   * Réclame la récompense de la mission `idx`.
   * @returns {{ coins, gems } | null}  null si non éligible ou déjà réclamée.
   */
  claim(idx) {
    const m = GameState.dailyMissions.missions[idx];
    if (!m || m.claimed || !this.isDone(idx)) return null;

    m.claimed = true;
    if (m.reward.coins > 0) GameState.addCoins(m.reward.coins);
    if (m.reward.gems  > 0) GameState.gems += m.reward.gems;

    return m.reward;
  },

  // ── Méta ─────────────────────────────────────────────────────────────────

  getDef(id) {
    return this.POOL.find(p => p.id === id);
  },
};
