/**
 * pickaxeCharges.js — Pioche à charges (#71, bêta).
 * Dépend de : GameState
 *
 * Réserve de coups : chaque coup MANUEL à pleine puissance consomme 1 charge (quels que soient les PV
 * du bloc ou la profondeur). À 0, la pioche est émoussée : 1 dégât par coup, sans les bonus de la
 * pioche (niveau, relique Œil du mineur), et les coups ne consomment plus rien jusqu'à ce que la
 * réserve remonte au seuil de reprise. Recharge continue, y compris hors ligne (calculée à partir de
 * l'horodatage `at`). L'Auto-Dig et les bonus de pièces ne sont pas concernés. Jamais de blocage.
 *
 * Inactif tant que le serveur ne l'active pas pour ce joueur (GET /api/pickaxe/config, drapeau OFF par
 * défaut) : le jeu est alors strictement inchangé, la réserve sauvegardée n'est pas touchée.
 * Mêmes formules que server/pickaxeCharges.js (vérifiées par test).
 *
 * État sauvegardé (GameState.pickaxe) :
 *   charges    : réserve (décimale : la recharge est continue)
 *   at         : horodatage (ms) de la dernière mise à jour de la réserve
 *   depleted   : true après une panne, jusqu'au seuil de reprise
 *   capLevel, speedLevel : niveaux des arbres permanents achetés en gemmes
 *   fullHits   : coups à pleine puissance (cumul, contrôle serveur)
 *   refilled   : charges achetées en pièces (cumul, contrôle serveur) ; refillCoins : pièces dépensées
 */
const PickaxeCharges = {

  /** Configuration effective (null = inactif). */
  config: null,

  isActive() { return !!this.config?.enabled; },

  /** Applique la configuration reçue du serveur. @returns {boolean} true si l'état actif a changé */
  applyConfig(cfg, now = Date.now()) {
    const was = this.isActive();
    this.config = cfg && cfg.enabled === true && Number.isFinite(cfg.capacity) && Number.isFinite(cfg.regenSeconds)
      && Array.isArray(cfg.capacityMult) && Array.isArray(cfg.speedMult) ? cfg : null;
    if (this.isActive()) this._ensureState(now);
    return was !== this.isActive();
  },

  _ensureState(now) {
    const p = GameState.pickaxe;
    // Première activation : réserve pleine
    if (!Number.isFinite(p.charges) || !Number.isFinite(p.at) || p.at <= 0) {
      p.charges = this.capacity();
      p.at = now;
      p.depleted = false;
    }
  },

  _level(v, list) {
    return Number.isSafeInteger(v) && v >= 0 ? Math.min(v, list.length - 1) : 0;
  },

  capacity(capLevel = GameState.pickaxe.capLevel) {
    const c = this.config;
    return c ? Math.round(c.capacity * c.capacityMult[this._level(capLevel, c.capacityMult)]) : 0;
  },

  regenSeconds(speedLevel = GameState.pickaxe.speedLevel) {
    const c = this.config;
    return c ? c.regenSeconds * c.speedMult[this._level(speedLevel, c.speedMult)] : 0;
  },

  /** Réserve à recharger avant le retour des bonus après une panne. */
  resumeAt() {
    return Math.max(1, Math.ceil((this.config?.resumeThreshold ?? 0) * this.capacity()));
  },

  /** Recharge jusqu'à `now` (horloge locale ; une date future est ignorée) et fin de panne au seuil. */
  sync(now = Date.now()) {
    if (!this.isActive()) return;
    const p = GameState.pickaxe;
    this._ensureState(now);
    const cap = this.capacity();
    if (now > p.at) {
      p.charges = Math.min(cap, p.charges + (now - p.at) / 1000 / this.regenSeconds());
      p.at = now;
    } else if (now < p.at - 60_000) {
      p.at = now;   // horloge reculée (autre appareil) : pas de recharge négative ni d'attente
    }
    if (p.charges > cap) p.charges = cap;
    if (p.depleted && p.charges >= this.resumeAt()) p.depleted = false;
  },

  /** true si le prochain coup est à pleine puissance. */
  isFull(now = Date.now()) {
    if (!this.isActive()) return true;
    this.sync(now);
    return !GameState.pickaxe.depleted && GameState.pickaxe.charges >= 1;
  },

  /**
   * Coup manuel : consomme une charge si possible et renvoie les dégâts du coup.
   * @param {number} fullDamage  dégâts normaux (GameState.damage)
   * @returns {{ damage: number, full: boolean, emptied: boolean }}
   */
  hit(fullDamage, now = Date.now()) {
    if (!this.isActive()) return { damage: fullDamage, full: true, emptied: false };
    const p = GameState.pickaxe;
    if (!this.isFull(now)) return { damage: 1, full: false, emptied: false };
    p.charges -= 1;
    p.fullHits = (p.fullHits || 0) + 1;
    let emptied = false;
    if (p.charges < 1) { p.depleted = true; emptied = true; }
    return { damage: fullDamage, full: true, emptied };
  },

  /** Millisecondes avant le retour des bonus (0 si la pioche n'est pas émoussée). */
  msUntilResume(now = Date.now()) {
    if (!this.isActive()) return 0;
    this.sync(now);
    const p = GameState.pickaxe;
    if (!p.depleted) return 0;
    return Math.max(0, (this.resumeAt() - p.charges) * this.regenSeconds() * 1000);
  },

  /** Millisecondes avant la réserve pleine. */
  msUntilFull(now = Date.now()) {
    if (!this.isActive()) return 0;
    this.sync(now);
    return Math.max(0, (this.capacity() - GameState.pickaxe.charges) * this.regenSeconds() * 1000);
  },

  // ── Recharges partielles en pièces ─────────────────────────────────────────

  /** Prix en pièces de `add` charges à cette profondeur (indexé comme la récompense des blocs). */
  refillCost(add, depth = GameState.depth) {
    const d = Number.isFinite(depth) && depth >= 1 ? Math.floor(depth) : 1;
    return Math.ceil(add * (this.config?.refillCoinsPerCharge ?? 0) * (1 + (d - 1) * 0.05));
  },

  /**
   * Offre d'une formule (+pct % de la capacité) : charges RÉELLEMENT ajoutées (plafonnées par la place
   * libre) et coût proportionnel, jamais de surfacturation près du maximum.
   * @returns {{ pct, add, cost, affordable }}
   */
  refillOffer(pct, now = Date.now()) {
    this.sync(now);
    const cap = this.capacity();
    const room = Math.max(0, Math.floor(cap - GameState.pickaxe.charges));
    const add = Math.min(room, Math.round(cap * pct / 100));
    const cost = this.refillCost(add);
    return { pct, add, cost, affordable: add > 0 && GameState.coins >= cost };
  },

  /** Achète une recharge partielle. @returns {object|null} l'offre appliquée, null si refusée */
  buyRefill(pct, now = Date.now()) {
    if (!this.isActive() || !(this.config.refillPacks || []).includes(pct)) return null;
    const o = this.refillOffer(pct, now);
    if (!o.affordable) return null;
    const p = GameState.pickaxe;
    GameState.spendCoins(o.cost);
    p.charges = Math.min(this.capacity(), p.charges + o.add);
    p.refilled = (p.refilled || 0) + o.add;
    p.refillCoins = (p.refillCoins || 0) + o.cost;
    if (p.depleted && p.charges >= this.resumeAt()) p.depleted = false;
    return o;
  },

  // ── Arbres permanents en gemmes ─────────────────────────────────────────────

  /**
   * Prochain niveau d'un arbre ('cap' ou 'speed') : valeur actuelle, suivante et prix ; null au maximum.
   * @returns {{ kind, level, price, now, next, affordable } | null}
   */
  treeNext(kind) {
    if (!this.isActive()) return null;
    const c = this.config;
    const p = GameState.pickaxe;
    const isCap = kind === 'cap';
    const mult = isCap ? c.capacityMult : c.speedMult;
    const prices = isCap ? c.capacityPrices : c.speedPrices;
    const level = this._level(isCap ? p.capLevel : p.speedLevel, mult);
    if (level >= mult.length - 1) return null;
    const price = prices[level];
    const now  = isCap ? this.capacity(level) : this.regenSeconds(level);
    const next = isCap ? this.capacity(level + 1) : this.regenSeconds(level + 1);
    return { kind, level, maxLevel: mult.length - 1, price, now, next, affordable: GameState.gems >= price };
  },

  /** Achète le niveau suivant d'un arbre (gemmes). La réserve gagnée en capacité n'est pas remplie. */
  buyTree(kind, now = Date.now()) {
    const o = this.treeNext(kind);
    if (!o || !o.affordable) return null;
    this.sync(now);   // recharge acquise à l'ancienne vitesse
    GameState.spendGems(o.price);
    if (kind === 'cap') GameState.pickaxe.capLevel = o.level + 1;
    else GameState.pickaxe.speedLevel = o.level + 1;
    return o;
  },
};
