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
      name: 'mission.break_blocks.name',
      descFn:   (n) => t('mission.break_blocks.desc', { t: n }),
      targets:  [20, 40, 75, 100, 150],
      statKey:  'blocksDestroyed',
      rewardFn: (n) => ({ coins: n * 4, gems: 0 }),
    },
    {
      id: 'earn_coins',
      icon: '💰',
      name: 'mission.earn_coins.name',
      descFn:   (n) => t('mission.earn_coins.desc', { t: n }),
      targets:  [200, 500, 800, 1200, 2000],
      statKey:  'totalCoinsEarned',
      rewardFn: (n) => ({ coins: Math.round(n * 0.25), gems: 0 }),
    },
    {
      id: 'open_chests',
      icon: '📦',
      name: 'mission.open_chests.name',
      descFn:   (n) => t('mission.open_chests.desc', { t: n, s: n > 1 ? 's' : '' }),
      targets:  [1, 2, 3, 4, 5],
      statKey:  'chestsFound',
      rewardFn: (n) => ({ coins: n * 120, gems: n >= 4 ? 1 : 0 }),
    },
    {
      id: 'buy_upgrades',
      icon: '⚙',
      name: 'mission.buy_upgrades.name',
      descFn:   (n) => t('mission.buy_upgrades.desc', { t: n, s: n > 1 ? 's' : '' }),
      targets:  [1, 2, 3, 4, 5],
      statKey:  'totalUpgradesBought',
      rewardFn: (n) => ({ coins: n * 80, gems: 0 }),
    },
    {
      id: 'find_gems',
      icon: '💎',
      name: 'mission.find_gems.name',
      descFn:   (n) => t('mission.find_gems.desc', { t: n, s: n > 1 ? 's' : '' }),
      targets:  [1, 2, 3],
      statKey:  'gemsFound',
      rewardFn: (n) => ({ coins: n * 200, gems: 1 }),
    },
    {
      id: 'depth_gain',
      icon: '🗺',
      name: 'mission.depth_gain.name',
      descFn:   (n) => t('mission.depth_gain.desc', { t: n }),
      targets:  [10, 20, 30, 50, 75],
      statKey:  'depth',
      rewardFn: (n) => ({ coins: n * 8, gems: 0 }),
    },
  ],

  // ── Missions attribuées par le serveur (#68, étape B) ─────────────────────
  // `_live` = vue de GET /api/me/missions quand le drapeau serveur est actif pour ce joueur ; sinon
  // null et tout le reste de ce fichier fonctionne comme avant (missions calculées ici).
  _live: null,

  /** Compteur local suivi par un type de mission du catalogue serveur. */
  _COUNTER: { break_blocks: 'blocksDestroyed', earn_coins: 'totalCoinsEarned', open_chests: 'chestsFound',
    buy_upgrades: 'totalUpgradesBought', find_gems: 'gemsFound', depth_gain: 'depth' },

  // Missions déjà payées par le serveur, par jour (#83) : { 'YYYY-MM-DD': ['earn_coins', …] }. Reçues en
  // mode OFF (`paid`) ou déduites des missions serveur réclamées : la mission du navigateur de même
  // identifiant, le même jour, devient « réclamée » sans crédit local (aucun second paiement).
  _paid: {},

  /** @returns {boolean} true si des missions du navigateur viennent d'être marquées payées. */
  setLive(view) {
    this._live = view && view.live === true && Array.isArray(view.missions) ? view : null;
    if (view && view.paid && typeof view.paid === 'object') this._paid = view.paid;
    else if (this._live) this._paid = { [this._live.day]: this._live.missions.filter(m => m.claimed && !m.claimedBy).map(m => m.id) };
    else this._paid = {};
    return this._applyPaid();
  },

  /** Marque « réclamées » (serverPaid) les missions du navigateur déjà payées par le serveur. */
  _applyPaid() {
    const dm = GameState.dailyMissions;
    const ids = (this._paid && this._paid[dm.date]) || [];
    let changed = false;
    for (const m of dm.missions) {
      // Déjà réclamée par le navigateur : reste une réclamation navigateur (le serveur ne la paiera pas)
      if (ids.includes(m.id) && !m.claimed) { m.claimed = true; m.serverPaid = true; changed = true; }
    }
    return changed;
  },

  /** Marque une mission serveur réclamée et la mission du navigateur de même identifiant (#83). */
  markServerClaimed(m) {
    const day = this._live?.day;
    if (!day) return;
    const list = (this._paid[day] = this._paid[day] || []);
    if (!list.includes(m.id)) list.push(m.id);
    this._applyPaid();
  },
  isLive() { return !!this._live; },

  _counter(type) {
    const k = this._COUNTER[type];
    if (!k) return 0;
    return k === 'depth' ? GameState.depth : (GameState.stats[k] ?? 0);
  },

  /** Texte du catalogue dans la langue courante (repli : français), {t} = objectif, {s} = pluriel. */
  _text(map, n) {
    const lang = (typeof I18n !== 'undefined' && I18n.getCurrent) ? I18n.getCurrent() : 'fr';
    const str = (map && (map[lang] || map.fr)) || '';
    return str.replace(/\{t\}/g, n).replace(/\{s\}/g, n > 1 ? 's' : '');
  },

  /** Missions à afficher (serveur ou navigateur), même forme pour le rendu. */
  items() {
    if (this._live) {
      return this._live.missions.map((m, idx) => ({
        idx, id: m.id, icon: m.icon, image: m.image, name: this._text(m.names, m.target), desc: this._text(m.descs, m.target),
        target: m.target, reward: m.reward, claimed: m.claimed,
      }));
    }
    return GameState.dailyMissions.missions.map((m, idx) => {
      const def = this.getDef(m.id);
      if (!def) return null;
      return { idx, id: def.id, icon: def.icon, image: null, name: t(def.name), desc: def.descFn(m.target), target: m.target, reward: m.reward, claimed: m.claimed };
    }).filter(Boolean);
  },

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
    if (this._live) return;   // missions du serveur : rechargées par main.js (_loadLiveMissions)
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
    this._applyPaid();   // nouveau jour : missions déjà payées par le serveur ce jour-là (#83)
  },

  // ── Progression ───────────────────────────────────────────────────────────

  /** Retourne la progression actuelle pour la mission à l'index `idx` (plafonnée à target). */
  getProgress(idx) {
    if (this._live) {
      // Progression serveur (dernière sauvegarde) + gain local depuis ; la réclamation est vérifiée par le serveur
      const m = this._live.missions[idx];
      if (!m) return 0;
      if (m.claimed) return m.target;
      return Math.max(0, Math.min(m.progress + Math.max(0, this._counter(m.type) - m.base), m.target));
    }
    const dm   = GameState.dailyMissions;
    const m    = dm.missions[idx];
    const base = dm.baselineStats;
    if (!m || !base) return 0;

    const def = this.POOL.find(p => p.id === m.id);
    if (!def) return 0;

    const current = (def.statKey === 'depth')
      ? GameState.depth
      : (GameState.stats[def.statKey] ?? 0);

    // Jamais négative : la profondeur peut baisser (reset de saison ou admin, save cloud) (B11)
    return Math.max(0, Math.min(current - (base[def.statKey] ?? 0), m.target));
  },

  /**
   * À appeler juste avant qu'une stat suivie ne baisse (reset de saison : profondeur → 1).
   * La progression du jour déjà acquise est conservée au lieu de devenir négative (B11).
   */
  rebase(statKey, newValue) {
    if (this._live) {
      // Gain local pas encore sauvegardé conservé ; le serveur ne retire jamais une progression acquise
      for (const m of this._live.missions) {
        if (this._COUNTER[m.type] !== statKey) continue;
        m.progress = Math.min(m.target, m.progress + Math.max(0, this._counter(m.type) - m.base));
        m.base = newValue;
      }
    }
    const base = GameState.dailyMissions.baselineStats;
    if (!base || !(statKey in base)) return;
    const current = (statKey === 'depth') ? GameState.depth : (GameState.stats[statKey] ?? 0);
    const gained  = Math.max(0, current - (base[statKey] ?? 0));
    base[statKey] = newValue - gained;
  },

  isDone(idx) {
    if (this._live) { const m = this._live.missions[idx]; return !!m && this.getProgress(idx) >= m.target; }
    const m = GameState.dailyMissions.missions[idx];
    return !!m && this.getProgress(idx) >= m.target;
  },

  /** Retourne true si au moins une mission est terminée et non encore réclamée. */
  hasUnclaimedCompleted() {
    if (this._live) return this._live.missions.some((m, i) => !m.claimed && this.isDone(i));
    return GameState.dailyMissions.missions.some((_, i) => !GameState.dailyMissions.missions[i].claimed && this.isDone(i));
  },

  // ── Réclamation ───────────────────────────────────────────────────────────

  /**
   * Réclame la récompense de la mission `idx`.
   * @returns {{ coins, gems } | null}  null si non éligible ou déjà réclamée.
   */
  claim(idx) {
    if (this._live) return null;   // réclamation par le serveur uniquement (POST /api/me/missions/claim)
    const m = GameState.dailyMissions.missions[idx];
    if (!m || m.claimed || m.serverPaid || !this.isDone(idx)) return null;

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
