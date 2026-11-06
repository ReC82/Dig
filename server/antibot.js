'use strict';
/**
 * antibot.js — Protection anti-bot, ticket #25 (lots A et B). Conception : docs/ANTI-BOT.md.
 *
 * Lot B — « budget de dégâts » : descendre d'un mètre exige de détruire un bloc, donc de lui
 *   infliger ses PV. Le serveur borne la profondeur classée par les dégâts maximum qu'un joueur
 *   peut avoir infligés (clics acceptés × dégâts max par clic + temps réel × Auto-Dig max),
 *   comparés aux PV MINIMUM des blocs (bloc le plus faible, réduction de PV maximale). Ces bornes
 *   supposent tout au maximum : elles ne peuvent pas freiner un joueur honnête.
 *
 * Lot A — observation : journal `security_events`, score de risque par compte et par saison
 *   (décroissant, demi-vie 24 h), télémétrie client résumée, audit des actions admin.
 *   Mode `shadow` : tout est calculé et journalisé, AUCUNE réponse n'est appliquée au joueur
 *   (les sanctions graduelles sont le lot C, non réalisé).
 *
 * Interrupteurs (config admin, effet immédiat) :
 *   antibot_mode       = off | shadow            (défaut shadow ; enforce réservé au lot C)
 *   damage_budget_mode = off | shadow | enforce  (défaut enforce)
 *   exact_hp_mode      = off | shadow | enforce  (défaut shadow) — budget aux PV RÉELS de chaque
 *                        bloc, recalculés depuis la graine et le n° du bloc (#77, server/blockHp.js)
 *   Variable d'environnement ANTIBOT=off : désactive tout #25, prioritaire sur l'admin.
 */

const crypto = require('crypto');
const { getDb } = require('./db');

// ── Lot B : budget de dégâts ──────────────────────────────────────────────────
// Valeurs maximales du jeu (public/js/upgrades.js, relics.js, blocks.js), vérifiées par
// test/antibot.test.js contre les fichiers du client : un changement d'équilibrage qui les
// dépasse fait échouer les tests.

/** Dégâts max d'un clic : pioche niveau 15 + Œil du mineur niveau 5 (+10). */
const MAX_CLICK_DAMAGE = 25;
/** Dégâts auto max par seconde : Auto-Dig niveau 6 + Moteur ancien niveau 5 (+14), 1 coup/s. */
const MAX_AUTODIG_DPS = 20;
/** Marge sur l'Auto-Dig (minuteries du navigateur en rattrapage), comme #9. */
const AUTODIG_MARGIN = 1.25;
/** Marge sur le rythme de clics crédité (gigue réseau entre deux sauvegardes). */
const CLICK_MARGIN = 1.25;
/** Réduction de PV maximale : Griffe d'obsidienne niveau 5. */
const MAX_HP_REDUCTION = 0.5;
/** PV d'un bloc à la profondeur d : ceil(hpBase × (1 + 0,12 (d − 1)) × (1 − réduction)). */
const HP_SCALE_PER_M = 0.12;
/**
 * Plus petit hpBase tirable selon la profondeur (blocks.js) :
 * terre meuble 3 (1–12 m), argile 6 (4–22 m), vieille caisse 8 (toutes profondeurs).
 */
const MIN_HP_SEGMENTS = [
  { from: 1,  to: 12,       hpBase: 3 },
  { from: 13, to: 22,       hpBase: 6 },
  { from: 23, to: Infinity, hpBase: 8 },
];
/**
 * Segments réellement utilisés par le budget. Le catalogue de blocs administrable (#37) les
 * remplace via setMinHpSegments() par le minimum, profondeur par profondeur, des hpBase de
 * TOUTES les versions publiées du catalogue (un client resté sur une ancienne version ne peut
 * donc jamais être freiné), et jamais au-dessus de MIN_HP_SEGMENTS (valeurs d'origine).
 */
let _minHpSegments = MIN_HP_SEGMENTS;

/** Plus petit hpBase des segments à la profondeur d (Infinity si aucun). */
function _segmentsMinAt(segs, d) {
  let m = Infinity;
  for (const s of segs) if (d >= s.from && d <= s.to && s.hpBase < m) m = s.hpBase;
  return m;
}

/**
 * Remplace les segments de PV minimum (#37). Chaque segment est borné par les valeurs d'origine
 * (minimum point par point) : un catalogue ne peut que rendre le budget plus permissif.
 * @param {{ from: number, to: number, hpBase: number }[]} segs  Segments contigus depuis 1 m
 */
function setMinHpSegments(segs) {
  if (!Array.isArray(segs) || !segs.length) { _minHpSegments = MIN_HP_SEGMENTS; return _minHpSegments; }
  const cuts = new Set([1]);
  for (const s of [...segs, ...MIN_HP_SEGMENTS]) {
    if (!(Number.isInteger(s.from) && s.from >= 1 && (s.to === Infinity || Number.isInteger(s.to)) && s.to >= s.from
      && Number.isFinite(s.hpBase) && s.hpBase > 0)) throw new Error('setMinHpSegments : segment invalide');
    cuts.add(s.from);
    if (s.to !== Infinity) cuts.add(s.to + 1);
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    const from = sorted[i];
    const to   = i + 1 < sorted.length ? sorted[i + 1] - 1 : Infinity;
    const hpBase = Math.min(_segmentsMinAt(segs, from), _segmentsMinAt(MIN_HP_SEGMENTS, from));
    const last = out[out.length - 1];
    if (last && last.hpBase === hpBase) last.to = to; else out.push({ from, to, hpBase });
  }
  _minHpSegments = out;
  return out;
}

function getMinHpSegments() { return _minHpSegments.map(s => ({ ...s })); }

/** Crédit de dégâts non dépensé conservé : 10 min au rythme maximal théorique. */
const DAMAGE_POOL_SECS = 600;
/** Écart (m) à partir duquel un plafonnement par le budget est journalisé. */
const DAMAGE_LOG_GAP = 5;

/** Somme des PV minimum (borne inférieure, sans arrondi) des blocs aux profondeurs a..b. */
function _minHpSum(a, b) {
  let sum = 0;
  for (const s of _minHpSegments) {
    const lo = Math.max(a, s.from);
    const hi = Math.min(b, s.to);
    if (hi < lo) continue;
    const n = hi - lo + 1;
    // Σ (1 + 0,12 (d − 1)) pour d = lo..hi
    sum += s.hpBase * (1 - MAX_HP_REDUCTION) * (n + HP_SCALE_PER_M * n * (lo - 1 + hi - 1) / 2);
  }
  // Marge infime contre les écarts d'arrondi flottant entre client et serveur
  return sum * (1 - 1e-9);
}

/** PV minimum à infliger pour passer de la profondeur `from` à `to` (blocs from..to−1). */
function damageCost(from, to) {
  if (!(to > from)) return 0;
  return _minHpSum(from, to - 1);
}

/** PV minimum (borne inférieure) d'un bloc à la profondeur d. */
function minBlockHp(d) {
  return _minHpSum(d, d);
}

/**
 * Profondeur maximale atteignable depuis `from` avec `credit` PV, sans dépasser `target`.
 * @returns {{ depth: number, spent: number }}
 */
function reachableDepth(from, credit, target) {
  if (!(target > from) || !(credit > 0)) return { depth: from, spent: 0 };
  let lo = from;          // atteignable
  let hi = target;        // borne haute
  if (damageCost(from, hi) <= credit) return { depth: hi, spent: damageCost(from, hi) };
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (damageCost(from, mid) <= credit) lo = mid; else hi = mid;
  }
  return { depth: lo, spent: damageCost(from, lo) };
}

/** Crédit de dégâts maximal par seconde : clics au rythme `handRate` + Auto-Dig. */
function maxDamageRate(handRate) {
  return handRate * MAX_CLICK_DAMAGE + MAX_AUTODIG_DPS * AUTODIG_MARGIN;
}

/**
 * Applique le budget de dégâts à une sauvegarde.
 *
 * Les clics sont crédités selon le temps réel écoulé (≤ handRate × 1,25 clics/s), avec leur
 * propre référence : contrairement aux seaux de #9 (1 clic = au plus 1 m, 20 s de capacité),
 * des clics restés en attente après des sauvegardes perdues sont crédités dès que le temps
 * écoulé les couvre — le budget ne retarde jamais le rattrapage d'un joueur honnête.
 *
 * @param {object} p
 * @param {number} p.fromDepth    Profondeur déjà couverte par le budget
 * @param {number} p.credit       Crédit de dégâts non dépensé (PV)
 * @param {number} p.claimedClicks Compteur de clics déclaré (saison)
 * @param {number} p.refClicks    Clics déjà crédités (référence du budget)
 * @param {number} p.dtSecs       Temps serveur écoulé depuis la sauvegarde précédente
 * @param {number} p.target       Profondeur visée (déclarée, déjà bornée par #9)
 * @param {number} p.handRate     Clics/s max (depth_max_cps)
 * @param {boolean} [p.uncapped]  Sans limite de temps ni plafond (estimation de l'écart « expliqué »)
 * @param {Function} [p.reach]    (from, crédit, target) → { depth, spent } : coût des blocs
 *                                (défaut : PV minimum ; #77 : PV réels recalculés)
 * @returns {{ depth: number, credit: number, refClicks: number, pendingClicks: number }}
 */
function applyDamageBudget({ fromDepth, credit, claimedClicks, refClicks, dtSecs, target, handRate, uncapped = false, reach = reachableDepth }) {
  const dt       = Math.max(0, dtSecs);
  const ref      = claimedClicks < refClicks ? claimedClicks : refClicks; // compteur revenu en arrière
  const pending  = claimedClicks - ref;
  const credited = uncapped ? pending : Math.min(pending, Math.floor(handRate * CLICK_MARGIN * dt));
  const cap      = uncapped ? Infinity : maxDamageRate(handRate) * CLICK_MARGIN * DAMAGE_POOL_SECS;
  const avail    = Math.min(cap, Math.max(0, credit)
    + credited * MAX_CLICK_DAMAGE
    + dt * MAX_AUTODIG_DPS * AUTODIG_MARGIN);
  const from     = Math.max(1, fromDepth);
  const r        = reach(from, avail, target);
  return { depth: r.depth, credit: avail - r.spent, refClicks: ref + credited, pendingClicks: pending - credited };
}

// ── Interrupteurs ────────────────────────────────────────────────────────────

/**
 * Cadence de frappe manuelle (#74) : au-delà, le client ne fait aucun dégât et le serveur ne
 * crédite aucun clic (budget de dégâts, profondeur). Rafale tolérée = capacité du seau client.
 */
const HIT_RATE_DEFAULT  = 12;
const HIT_BURST_DEFAULT = 36;
const HIT_RATE_RANGE    = [4, 30];
const HIT_BURST_RANGE   = [1, 200];

function _cfgNum(raw, def, [min, max]) {
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : def;
}

/** Limites de frappe effectives (config manual_hit_rate / manual_hit_burst). */
function getHitLimits(config = {}) {
  return {
    rate:  _cfgNum(config.manual_hit_rate,  HIT_RATE_DEFAULT,  HIT_RATE_RANGE),
    burst: _cfgNum(config.manual_hit_burst, HIT_BURST_DEFAULT, HIT_BURST_RANGE),
  };
}

const ANTIBOT_MODES = ['off', 'shadow'];
const BUDGET_MODES  = ['off', 'shadow', 'enforce'];
/** PV réels (#77) : observation par défaut (aucun joueur freiné avant décision du propriétaire). */
const EXACT_HP_DEFAULT = 'shadow';

function _envOff(env) {
  return String(env.ANTIBOT ?? '').toLowerCase() === 'off';
}

/** Mode d'observation (lot A) : off | shadow. */
function getAntibotMode(config, env = process.env) {
  if (_envOff(env)) return 'off';
  const v = String(config?.antibot_mode ?? 'shadow').toLowerCase();
  return ANTIBOT_MODES.includes(v) ? v : 'shadow';
}

/** Mode du budget de dégâts (lot B) : off | shadow | enforce. */
function getDamageBudgetMode(config, env = process.env) {
  if (_envOff(env)) return 'off';
  const v = String(config?.damage_budget_mode ?? 'enforce').toLowerCase();
  return BUDGET_MODES.includes(v) ? v : 'enforce';
}

/**
 * Mode du budget aux PV réels (#77) : off | shadow | enforce. Jamais plus actif que le budget de
 * dégâts (#25) : budget off → off ; ANTIBOT=off → off.
 */
function getExactHpMode(config, env = process.env) {
  if (getDamageBudgetMode(config, env) === 'off') return 'off';
  const v = String(config?.exact_hp_mode ?? EXACT_HP_DEFAULT).toLowerCase();
  return BUDGET_MODES.includes(v) ? v : EXACT_HP_DEFAULT;
}

/**
 * Validation des clés de config #25 (PUT /api/admin/config).
 * @returns {{ value: string } | { error: string } | null}  null : clé non concernée
 */
function validateConfigValue(key, raw) {
  const v = String(raw).trim().toLowerCase();
  if (key === 'antibot_mode') {
    if (v === 'enforce') return { error: 'antibot_mode : « enforce » (sanctions, lot C) n\'est pas encore disponible — off ou shadow.' };
    return ANTIBOT_MODES.includes(v) ? { value: v } : { error: 'antibot_mode : off ou shadow attendu.' };
  }
  if (key === 'manual_hit_rate' || key === 'manual_hit_burst') {
    const [min, max] = key === 'manual_hit_rate' ? HIT_RATE_RANGE : HIT_BURST_RANGE;
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? { value: String(n) } : { error: `${key} : nombre de ${min} à ${max} attendu.` };
  }
  if (key === 'damage_budget_mode' || key === 'exact_hp_mode') {
    return BUDGET_MODES.includes(v) ? { value: v } : { error: `${key} : off, shadow ou enforce attendu.` };
  }
  return null;
}

// ── Lot A : journal de sécurité ──────────────────────────────────────────────

/** Rétention du journal de sécurité (les comptes et sauvegardes ne sont jamais purgés). */
const EVENT_RETENTION_DAYS = 90;

let _ipKey = null;
/** Clé du hachage des IP (dérivée du secret de session) : aucune IP n'est stockée en clair. */
function configure({ ipSecret } = {}) {
  _ipKey = ipSecret ? crypto.createHmac('sha256', String(ipSecret)).update('dig-antibot-ip').digest() : null;
}

/** IP hachée (HMAC tronqué) ou null. */
function hashIp(ip) {
  if (!ip) return null;
  const key = _ipKey ?? (_ipKey = crypto.randomBytes(32));
  return crypto.createHmac('sha256', key).update(String(ip)).digest('hex').slice(0, 16);
}

/** Insère un événement de sécurité. `details` : objet sérialisé en JSON. */
function logSecurityEvent(type, { userId = null, seasonId = null, scoreBefore = null, scoreAfter = null, details = null, ip = null } = {}) {
  getDb().prepare(`
    INSERT INTO security_events (type, user_id, season_id, score_before, score_after, details, ip_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(String(type).slice(0, 40), userId, seasonId,
         scoreBefore == null ? null : Math.round(scoreBefore * 10) / 10,
         scoreAfter  == null ? null : Math.round(scoreAfter  * 10) / 10,
         details == null ? null : JSON.stringify(details).slice(0, 2000),
         hashIp(ip));
}

/** Supprime les événements de sécurité de plus de 90 jours (journal uniquement). */
function purgeOldEvents() {
  const r = getDb().prepare(
    `DELETE FROM security_events WHERE created_at < datetime('now', ?)`
  ).run(`-${EVENT_RETENTION_DAYS} days`);
  if (r.changes > 0) console.log(`[antibot] ${r.changes} événement(s) de sécurité de plus de ${EVENT_RETENTION_DAYS} jours purgé(s)`);
  getDb().prepare('DELETE FROM antibot_save_samples WHERE at_ms < ?').run(Date.now() - EVENT_RETENTION_DAYS * 86400_000);
  return r.changes;
}

let _purgeTimer = null;
function startPurgeScheduler(intervalMs = 12 * 3600_000) {
  try { purgeOldEvents(); } catch (err) { console.error('[antibot] purge', err.message); }
  _purgeTimer = setInterval(() => {
    try { purgeOldEvents(); } catch (err) { console.error('[antibot] purge', err.message); }
  }, intervalMs);
  _purgeTimer.unref?.();
}

// ── Lot A : score de risque ──────────────────────────────────────────────────

const HALF_LIFE_MS = 24 * 3600_000;

/**
 * Catégories de signaux et plafond de chacune : un seul type d'indice ne peut pas dépasser
 * le niveau 1 (30). Seules les preuves (impossibilités physiques) peuvent aller au-delà.
 */
const CATEGORY_CAPS = { proof: 100, cps: 25, untrusted: 25, burst: 15, regularity: 10, activity: 20, pattern: 10 };

/** Points par signal. */
const SIGNALS = {
  forged_counters: { cat: 'proof',      points: 40 }, // compteurs négatifs, non entiers, démesurés
  depth_rejected:  { cat: 'proof',      points: 35 }, // #9 : excédent rejeté (> 10 min au rythme max)
  damage_budget:   { cat: 'proof',      points: 30 }, // lot B : profondeur au-delà du budget de dégâts
  blocks_gt_clicks:{ cat: 'proof',      points: 15 }, // #10 : plus de blocs manuels que de clics
  cps_flagged:     { cat: 'cps',        points: 6  }, // #10 : CPS > 2,5 × seuil
  cps_reduced:     { cat: 'cps',        points: 2  }, // #10 : CPS au-dessus du seuil
  untrusted_clicks:{ cat: 'untrusted',  points: 10 }, // clics générés par script (isTrusted = false)
  burst_clicks:    { cat: 'burst',      points: 4  }, // rafales > 25 clics/s
  throttled_hits:  { cat: 'burst',      points: 4  }, // #74 : coups au-delà de la cadence maximale (sans effet en jeu)
  regular_clicks:  { cat: 'regularity', points: 2  }, // rythme quasi parfait et long (jamais seul)
  // Lot C (06/11) : durée de minage mesurée par le serveur et gigue synthétique (indices seulement)
  sustained_activity:{ cat: 'activity', points: 10 }, // série de minage manuel sans pause ≥ ½ seuil de défi
  narrow_jitter:   { cat: 'pattern',    points: 5  }, // ≥ 3 000 intervalles quasi sans pause, 2 classes voisines
  // PV réels (#77) : observation seule, 0 point — journalisés sans changer le score de risque
  exact_hp_budget: { cat: 'proof',      points: 0  }, // profondeur au-delà des PV réels recalculés
  block_hp_mismatch:{ cat: 'proof',     points: 0  }, // PV max du bloc courant < PV recalculés
  block_seed_changed:{ cat: 'proof',    points: 0  }, // graine des blocs changée en cours de saison
  block_seq_skips: { cat: 'proof',      points: 0  }, // plus de blocs sautés que de rerolls déclarés
};

/** Niveaux de réponse (docs/ANTI-BOT.md § 5) — en mode shadow, aucun n'est appliqué. */
function riskLevel(score) {
  if (score >= 90) return 4;
  if (score >= 80) return 3;
  if (score >= 60) return 2;
  if (score >= 30) return 1;
  return 0;
}

function _decayed(components, dtMs) {
  const f = dtMs > 0 ? Math.pow(0.5, dtMs / HALF_LIFE_MS) : 1;
  const out = {};
  for (const [k, v] of Object.entries(components)) {
    const n = Number(v) * f;
    if (Number.isFinite(n) && n >= 0.05) out[k] = n;
  }
  return out;
}

function _total(components) {
  return Math.min(100, Object.values(components).reduce((s, v) => s + v, 0));
}

/** Score courant (décru à `nowMs`) d'un compte pour une saison. */
function getRisk(userId, seasonId, nowMs = Date.now()) {
  const row = getDb().prepare('SELECT * FROM risk_scores WHERE user_id = ? AND season_id = ?').get(userId, seasonId);
  if (!row) return { score: 0, level: 0, components: {} };
  let comps = {};
  try { comps = JSON.parse(row.components) ?? {}; } catch (_) { comps = {}; }
  const c = _decayed(comps, nowMs - row.updated_ms);
  const score = _total(c);
  return { score, level: riskLevel(score), components: c };
}

/**
 * Ajoute des signaux au score de risque du compte et journalise.
 * Mode off : rien. Mode shadow : journal + score, aucune réponse appliquée.
 * @param {Array<{ type: string, details?: object }>} signals
 * @returns {{ score: number, level: number } | null}
 */
function recordSignals(userId, seasonId, signals, { config, nowMs = Date.now(), ip = null } = {}) {
  if (!signals?.length || getAntibotMode(config) === 'off') return null;
  const db = getDb();
  return db.transaction(() => {
    const before = getRisk(userId, seasonId, nowMs);
    // Observations à 0 point (#77) : journal seul, le score de risque n'est ni modifié ni créé
    const scored = signals.filter(s => SIGNALS[s.type]?.points !== 0);
    for (const s of signals) {
      if (SIGNALS[s.type]?.points !== 0) continue;
      logSecurityEvent(s.type, { userId, seasonId, scoreBefore: before.score, scoreAfter: before.score, details: s.details ?? null, ip });
    }
    if (!scored.length) return { score: before.score, level: before.level };
    signals = scored;
    const comps  = { ...before.components };
    let score    = before.score;
    for (const s of signals) {
      const def = SIGNALS[s.type];
      if (!def) continue;
      const cur  = comps[def.cat] ?? 0;
      const next = Math.min(CATEGORY_CAPS[def.cat], cur + def.points);
      // Indice déjà au plafond de sa catégorie : rien de nouveau, pas d'événement
      if (next - cur < 0.05 && def.cat !== 'proof') continue;
      comps[def.cat] = next;
      const after = _total(comps);
      logSecurityEvent(s.type, { userId, seasonId, scoreBefore: score, scoreAfter: after, details: s.details ?? null, ip });
      score = after;
    }
    const level = riskLevel(score);
    db.prepare(`
      INSERT INTO risk_scores (user_id, season_id, components, score, level, updated_ms)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, season_id) DO UPDATE SET
        components = excluded.components, score = excluded.score,
        level = excluded.level, updated_ms = excluded.updated_ms
    `).run(userId, seasonId, JSON.stringify(comps), score, level, nowMs);
    if (level > before.level) {
      logSecurityEvent('risk_level', { userId, seasonId, scoreBefore: before.score, scoreAfter: score,
        details: { from: before.level, to: level, applied: false } });
    }
    return { score, level };
  })();
}

/**
 * Défi résolu (lot C) : allègement à court terme — les indices (hors preuves) sont divisés par deux.
 * Une activité suspecte qui persiste les fait remonter et peut redéclencher un défi.
 */
function relieveRisk(userId, seasonId, { nowMs = Date.now(), factor = 0.5 } = {}) {
  const db = getDb();
  const before = getRisk(userId, seasonId, nowMs);
  if (!(before.score > 0)) return { before: 0, after: 0 };
  const comps = {};
  for (const [k, v] of Object.entries(before.components)) comps[k] = k === 'proof' ? v : v * factor;
  const score = _total(comps);
  db.prepare('UPDATE risk_scores SET components = ?, score = ?, level = ?, updated_ms = ? WHERE user_id = ? AND season_id = ?')
    .run(JSON.stringify(comps), score, riskLevel(score), nowMs, userId, seasonId);
  return { before: before.score, after: score };
}

// ── Lot A : signaux tirés de la sauvegarde ───────────────────────────────────

const COUNTER_FIELDS = ['maxDepth', 'manualClicks', 'manualBlocks', 'autoBlocks', 'suspiciousBlocks', 'throttledHits'];
/** Au-delà, un compteur de saison est irréaliste (≈ 1 an à 30 clics/s). */
const COUNTER_MAX = 1e9;

/** Compteurs de saison qu'aucun client honnête ne peut produire (négatifs, non entiers…). */
function forgedCounters(seasonStats) {
  const bad = [];
  for (const f of COUNTER_FIELDS) {
    const v = seasonStats?.[f];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > COUNTER_MAX) bad.push(f);
  }
  return bad;
}

/** Classes d'intervalles entre clics (ms) de la télémétrie : <40, <60, <80, <100, <150, <250, <500, ≥500. */
const TELEMETRY_BINS = 8;

/**
 * Normalise le résumé de télémétrie envoyé par le client (jamais cru : indices seulement).
 * @returns {{ n, h, u, p, cv } | null}
 */
function normalizeTelemetry(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
  const int = v => (Number.isSafeInteger(v) && v >= 0 ? Math.min(v, 1e6) : 0);
  const n = int(t.n);
  if (n === 0) return null;
  const h = Array.isArray(t.h) && t.h.length === TELEMETRY_BINS ? t.h.map(int) : null;
  const p = t.p && typeof t.p === 'object' ? { m: int(t.p.m), t: int(t.p.t), k: int(t.p.k), o: int(t.p.o) } : null;
  const cv = typeof t.cv === 'number' && Number.isFinite(t.cv) && t.cv >= 0 ? Math.min(t.cv, 10) : null;
  return { n, h, u: Math.min(int(t.u), n), x: Math.min(int(t.x), n), p, cv };
}

/** Indices tirés de la télémétrie (seuils prudents : tactile multi-doigts, accessibilité). */
function telemetrySignals(tel) {
  if (!tel) return [];
  const out = [];
  if (tel.n >= 20 && tel.u / tel.n >= 0.5) {
    out.push({ type: 'untrusted_clicks', details: { clicks: tel.n, untrusted: tel.u } });
  }
  if (tel.h) {
    const intervals = tel.h.reduce((s, v) => s + v, 0);
    if (tel.h[0] >= 50 && intervals > 0 && tel.h[0] / intervals >= 0.3) {
      out.push({ type: 'burst_clicks', details: { clicks: tel.n, under40ms: tel.h[0], intervals } });
    }
  }
  // Coups au-delà de la cadence maximale, sans effet en jeu (#74) : indice de rafale soutenue
  if (tel.x >= 50 && tel.x / tel.n >= 0.3) {
    out.push({ type: 'throttled_hits', details: { clicks: tel.n, throttled: tel.x } });
  }
  if (tel.cv != null && tel.n >= 200 && tel.cv < 0.03) {
    out.push({ type: 'regular_clicks', details: { clicks: tel.n, cv: tel.cv } });
  }
  return out;
}

// ── Instrumentation ──────────────────────────────────────────────────────────

const _perf = { count: 0, totalMs: 0, maxMs: 0, since: new Date().toISOString() };
function recordTiming(ms) {
  _perf.count += 1;
  _perf.totalMs += ms;
  if (ms > _perf.maxMs) _perf.maxMs = ms;
}
function getTimings() {
  return { saves: _perf.count, avgMs: _perf.count ? _perf.totalMs / _perf.count : 0, maxMs: _perf.maxMs, since: _perf.since };
}

// ── Vue admin ────────────────────────────────────────────────────────────────

/**
 * Familles d'événements du journal de sécurité (filtres et synthèse admin). Seules les
 * anomalies sont journalisées : une sauvegarde normale ne crée AUCUN événement (le dernier
 * contrôle de chaque joueur se lit dans les états de validation, voir `checks`).
 */
const EVENT_GROUPS = {
  player: [...Object.keys(SIGNALS), 'risk_level'],
  // Lot C : défis (simulés en Observation) et suspensions du minage manuel
  responses: ['challenge_shadow', 'challenge_issued', 'challenge_solved', 'suspension_started', 'antibot_admin'],
  admin:  ['admin_action', 'admin_config', 'admin_login', 'admin_login_failed'],
  system: ['standings_frozen', 'standings_freeze_failed'],
};

/** Périodes proposées par le filtre du journal (jours ; null = tout l'historique conservé). */
const EVENT_PERIODS = [1, 7, 30];

/** Dernier contrôle serveur de chaque joueur de la saison (profondeur #9/#25, anti-autoclic #10). */
function _seasonChecks(seasonId, riskByUser) {
  const rows = getDb().prepare(`
    SELECT d.user_id, u.username, d.updated_ms, d.accepted_depth, d.last_gap, d.dmg_gap,
           c.last_save_at AS ac_at, c.last_manual_clicks, c.accepted_blocks
    FROM player_depth_tracking d
    LEFT JOIN users u ON u.id = d.user_id
    LEFT JOIN player_click_tracking c ON c.user_id = d.user_id AND c.season_id = d.season_id
    WHERE d.season_id = ?
    ORDER BY d.updated_ms DESC
  `).all(seasonId);
  return rows.map(r => {
    const risk = riskByUser.get(r.user_id);
    return {
      userId:        r.user_id,
      username:      r.username ?? `user_${r.user_id}`,
      lastCheck:     new Date(r.updated_ms).toISOString(),
      acceptedDepth: r.accepted_depth,
      depthGap:      r.last_gap ?? 0,                     // profondeur déclarée − retenue (m)
      budgetGap:     Math.round((r.dmg_gap ?? 0) * 10) / 10, // écart inexpliqué du budget (m)
      clicks:        r.last_manual_clicks ?? null,
      acceptedBlocks: r.accepted_blocks ?? null,
      score:         risk ? Math.round(risk.score * 10) / 10 : 0,
      level:         risk ? risk.level : 0,
    };
  });
}

/** Résumé pour le panel admin : modes, comptes par niveau, événements récents par type. */
function buildSummary(seasonId, config, nowMs = Date.now()) {
  const db = getDb();
  const rows = seasonId == null ? [] : db.prepare(`
    SELECT r.user_id, r.components, r.updated_ms, u.username
    FROM risk_scores r LEFT JOIN users u ON u.id = r.user_id
    WHERE r.season_id = ?
  `).all(seasonId);
  const levels = [0, 0, 0, 0, 0];
  const riskByUser = new Map();
  const accounts = rows.map(r => {
    let comps = {};
    try { comps = JSON.parse(r.components) ?? {}; } catch (_) {}
    const c = _decayed(comps, nowMs - r.updated_ms);
    const score = _total(c);
    const level = riskLevel(score);
    levels[level] += 1;
    riskByUser.set(r.user_id, { score, level });
    const round = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Math.round(v * 10) / 10]));
    return { userId: r.user_id, username: r.username ?? `user_${r.user_id}`, score: Math.round(score * 10) / 10, level, components: round };
  }).filter(a => a.score > 0).sort((a, b) => b.score - a.score).slice(0, 50);

  const byType = db.prepare(`
    SELECT type, COUNT(*) AS n FROM security_events
    WHERE created_at >= datetime('now', '-7 days') GROUP BY type ORDER BY n DESC
  `).all();

  // Événements par famille et par période (24 h, 7 j, 30 j, tout l'historique conservé)
  const groupCase = Object.entries(EVENT_GROUPS)
    .map(([g, types]) => `WHEN type IN (${types.map(t => `'${t}'`).join(',')}) THEN '${g}'`).join(' ');
  const periodRows = db.prepare(`
    SELECT CASE ${groupCase} ELSE 'other' END AS grp,
           SUM(created_at >= datetime('now', '-1 days'))  AS d1,
           SUM(created_at >= datetime('now', '-7 days'))  AS d7,
           SUM(created_at >= datetime('now', '-30 days')) AS d30,
           COUNT(*) AS total
    FROM security_events GROUP BY grp
  `).all();
  const eventsByGroup = {};
  for (const g of [...Object.keys(EVENT_GROUPS), 'other']) eventsByGroup[g] = { d1: 0, d7: 0, d30: 0, total: 0 };
  for (const r of periodRows) eventsByGroup[r.grp] = { d1: r.d1 ?? 0, d7: r.d7 ?? 0, d30: r.d30 ?? 0, total: r.total };

  const checks = seasonId == null ? [] : _seasonChecks(seasonId, riskByUser);
  const dayAgo = nowMs - 24 * 3600_000;

  return {
    antibotMode:      getAntibotMode(config),
    damageBudgetMode: getDamageBudgetMode(config),
    envOverride:      _envOff(process.env),
    seasonId,
    levels,            // nombre de comptes de la saison par niveau 0..4 (non appliqués)
    accounts,          // comptes au score > 0, du plus élevé au plus faible (50 max)
    eventsLast7Days: byType,
    eventGroups:      EVENT_GROUPS,
    eventsByGroup,     // { player, admin, system, other } × { d1, d7, d30, total }
    trackedAccounts:  checks.length,
    checkedLast24h:   checks.filter(c => Date.parse(c.lastCheck) >= dayAgo).length,
    checks:           checks.slice(0, 50), // dernier contrôle par joueur, du plus récent au plus ancien
    sanctionsApplied: false,               // lot C non réalisé : aucun niveau n'est appliqué
    timings: getTimings(),
  };
}

/** Événements de sécurité, du plus récent au plus ancien. */
function listEvents({ limit = 100, offset = 0, type = null, group = null, sinceDays = null, userId = null } = {}) {
  const where = [];
  const args  = [];
  if (type)   { where.push('e.type = ?');    args.push(type); }
  else if (group && EVENT_GROUPS[group]) {
    where.push(`e.type IN (${EVENT_GROUPS[group].map(() => '?').join(',')})`);
    args.push(...EVENT_GROUPS[group]);
  }
  if (sinceDays) { where.push(`e.created_at >= datetime('now', ?)`); args.push(`-${sinceDays} days`); }
  if (userId) { where.push('e.user_id = ?'); args.push(userId); }
  const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const events = db.prepare(`
    SELECT e.id, e.created_at, e.type, e.user_id, u.username, e.season_id,
           e.score_before, e.score_after, e.details, e.ip_hash
    FROM security_events e LEFT JOIN users u ON u.id = e.user_id
    ${sqlWhere} ORDER BY e.id DESC LIMIT ? OFFSET ?
  `).all(...args, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM security_events e ${sqlWhere}`).get(...args).n;
  return { events, total, limit, offset };
}

// ── Fiche joueur (#25, demande du propriétaire du 04/11) ─────────────────────

/** Échantillons conservés par joueur (≈ 1 par sauvegarde ; les plus anciens sont retirés). */
const SAMPLES_PER_USER = 500;

const _sampleInt = v => (Number.isSafeInteger(v) && v >= 0 && v <= COUNTER_MAX ? v : null);

/**
 * Une ligne agrégée par sauvegarde contrôlée : compteurs déclarés, profondeur retenue et résumé
 * de télémétrie normalisé. Sert uniquement au diagnostic admin (aucun effet sur le jeu).
 */
function recordSaveSample(userId, seasonId, { reportedDepth, acceptedDepth, budgetDepth, exactDepth, seasonStats, blocksDestroyed, autodigLevel, acAction, telemetry }, nowMs = Date.now()) {
  const db = getDb();
  db.prepare(`
    INSERT INTO antibot_save_samples (user_id, season_id, at_ms, reported_depth, accepted_depth, budget_depth, exact_depth,
      manual_clicks, manual_blocks, auto_blocks, blocks_destroyed, autodig_level, ac_action, tel)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, seasonId, nowMs, _sampleInt(reportedDepth), _sampleInt(acceptedDepth), _sampleInt(budgetDepth), _sampleInt(exactDepth),
         _sampleInt(seasonStats?.manualClicks), _sampleInt(seasonStats?.manualBlocks), _sampleInt(seasonStats?.autoBlocks),
         _sampleInt(blocksDestroyed), _sampleInt(autodigLevel), acAction ? String(acAction).slice(0, 20) : null,
         telemetry ? JSON.stringify(telemetry) : null);
  db.prepare(`
    DELETE FROM antibot_save_samples WHERE user_id = ? AND id <= (
      SELECT id FROM antibot_save_samples WHERE user_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)
  `).run(userId, userId, SAMPLES_PER_USER);
}

/** Joueur cherché par identifiant (« 12 », « #12 ») ou pseudo exact (insensible à la casse). */
function findPlayer(query) {
  const q = String(query ?? '').trim().replace(/^#/, '');
  if (!q || q.length > 40) return null;
  const db = getDb();
  if (/^\d{1,10}$/.test(q)) {
    const byId = db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(parseInt(q, 10));
    if (byId) return byId;
  }
  return db.prepare('SELECT id, username, created_at FROM users WHERE username = ?').get(q.toLowerCase()) ?? null;
}

const _r1 = v => (v == null ? null : Math.round(v * 10) / 10);
const _utc = ms => (ms ? new Date(ms).toISOString() : null);
const _json = t => { try { return t ? JSON.parse(t) : null; } catch (_) { return null; } };

/** Niveau d'une amélioration dans la sauvegarde (nombre ou { level }). */
const _lvl = v => (typeof v === 'number' ? v : (v && typeof v === 'object' && typeof v.level === 'number' ? v.level : 0));

/**
 * Fiche diagnostique d'un joueur pour une saison (lecture seule). Chaque valeur est qualifiée :
 *   server  = calculé ou mesuré par le serveur (horloge serveur, validations) ;
 *   client  = déclaré par la sauvegarde du navigateur (non vérifié) ;
 *   tele    = télémétrie du navigateur (indice, falsifiable).
 */
function playerReport(userId, { seasonId = null, config = {}, nowMs = Date.now() } = {}) {
  const db = getDb();
  const user = db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const active = db.prepare(`SELECT * FROM seasons WHERE status = 'active' ORDER BY id DESC LIMIT 1`).get();
  const seasons = db.prepare(`
    SELECT s.id, s.name, s.status FROM seasons s
    WHERE s.id IN (SELECT season_id FROM season_rankings WHERE user_id = ?
                   UNION SELECT season_id FROM security_events WHERE user_id = ? AND season_id IS NOT NULL
                   UNION SELECT season_id FROM antibot_save_samples WHERE user_id = ?)
       OR s.id = ?
    ORDER BY s.id DESC
  `).all(userId, userId, userId, active?.id ?? -1);
  const sid = seasonId ?? active?.id ?? seasons[0]?.id ?? null;
  const season = sid == null ? null : db.prepare('SELECT id, name, status, start_at, end_at FROM seasons WHERE id = ?').get(sid);

  const ranking = sid == null ? null : db.prepare(`
    SELECT max_depth, reported_max_depth, manual_blocks, effective_manual_blocks, auto_blocks, manual_clicks,
           suspicious_score, is_active, created_at, updated_at
    FROM season_rankings WHERE season_id = ? AND user_id = ?
  `).get(sid, userId) ?? null;

  const dt = db.prepare('SELECT * FROM player_depth_tracking WHERE user_id = ?').get(userId);
  const ct = db.prepare('SELECT * FROM player_click_tracking WHERE user_id = ?').get(userId);
  const depth = dt && dt.season_id === sid ? {
    lastCheck: _utc(dt.updated_ms), acceptedDepth: dt.accepted_depth, depthGap: dt.last_gap ?? 0,
    budgetDepth: dt.dmg_depth, budgetGap: _r1(dt.dmg_gap ?? 0), budgetCredit: _r1(dt.dmg_credit),
    refClicks: dt.ref_clicks, refAuto: dt.ref_auto,
    // PV réels (#77) : profondeur couverte, écart à la dernière sauvegarde, graine épinglée connue
    ...(() => {
      const x = _json(dt.xhp_state);
      return x ? { exactDepth: x.depth ?? null, exactGap: x.gap ?? 0, exactCredit: _r1(x.credit), exactSeedPinned: x.seed != null,
        exactSeedChanges: x.seedChanges ?? 0 } : {};
    })(),
  } : null;
  const clicks = ct && ct.season_id === sid ? {
    lastSave: ct.last_save_at ? ct.last_save_at.replace(' ', 'T') + 'Z' : null,
    lastManualClicks: ct.last_manual_clicks, lastBlocks: ct.last_blocks, acceptedBlocks: ct.accepted_blocks,
  } : null;

  // Sauvegarde actuelle (déclarée par le client ; écrasée à chaque envoi, aucun historique)
  const saveRow = db.prepare('SELECT data, version, saved_at FROM user_saves WHERE user_id = ?').get(userId);
  let save = null;
  const sd = _json(saveRow?.data);
  if (sd && typeof sd === 'object') {
    const ups = sd.upgrades && typeof sd.upgrades === 'object' ? sd.upgrades : {};
    const rel = sd.relics && typeof sd.relics === 'object' ? sd.relics : {};
    const st  = sd.stats && typeof sd.stats === 'object' ? sd.stats : {};
    const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    save = {
      revision: saveRow.version, savedAt: saveRow.saved_at.replace(' ', 'T') + 'Z',
      depth: num(sd.depth), coins: num(sd.coins), gems: num(sd.gems), relicFragments: num(sd.relicFragments),
      pickaxeLevel: num(sd.pickaxeLevel), damage: num(sd.damage),
      upgrades: Object.fromEntries(Object.entries(ups).slice(0, 30).map(([k, v]) => [k.slice(0, 30), _lvl(v)])),
      relics: Object.fromEntries(Object.entries(rel).slice(0, 30).map(([k, v]) => [k.slice(0, 30), _lvl(v)])),
      blocksDestroyed: num(st.blocksDestroyed), totalCoinsEarned: num(st.totalCoinsEarned),
      totalUpgradesBought: num(st.totalUpgradesBought), chestsFound: num(st.chestsFound), gemsFound: num(st.gemsFound),
      seasonStats: sd.seasonStats?.seasonId === sid ? {
        maxDepth: num(sd.seasonStats.maxDepth), manualBlocks: num(sd.seasonStats.manualBlocks),
        autoBlocks: num(sd.seasonStats.autoBlocks), manualClicks: num(sd.seasonStats.manualClicks),
        suspiciousScore: num(sd.seasonStats.suspiciousScore),
        // blocs cassés par un coup suspect : compteur séparé depuis #74 (absent des sauvegardes plus anciennes)
        suspiciousBlocks: num(sd.seasonStats.suspiciousBlocks),
      } : null,
    };
  }

  // Score de risque : composantes décroissantes, plafonds par catégorie
  const risk = sid == null ? { score: 0, level: 0, components: {} } : getRisk(userId, sid, nowMs);
  const riskRow = sid == null ? null : db.prepare('SELECT updated_ms FROM risk_scores WHERE user_id = ? AND season_id = ?').get(userId, sid);

  const evWhere = sid == null ? 'user_id = ?' : 'user_id = ? AND (season_id = ? OR season_id IS NULL)';
  const evArgs  = sid == null ? [userId] : [userId, sid];
  const byType = db.prepare(`
    SELECT type, COUNT(*) AS n, MIN(created_at) AS first, MAX(created_at) AS last
    FROM security_events WHERE ${evWhere} GROUP BY type ORDER BY n DESC
  `).all(...evArgs);
  const recent = db.prepare(`
    SELECT id, created_at, type, score_before, score_after, details
    FROM security_events WHERE ${evWhere} ORDER BY id DESC LIMIT 100
  `).all(...evArgs);

  // Rafales déjà journalisées (seule trace de télémétrie avant les échantillons)
  const burst = { batches: 0, clicks: 0, under40ms: 0, intervals: 0 };
  for (const e of recent) {
    if (e.type !== 'burst_clicks') continue;
    const d = _json(e.details);
    if (!d) continue;
    burst.batches += 1;
    burst.clicks += d.clicks ?? 0;
    burst.under40ms += d.under40ms ?? 0;
    burst.intervals += d.intervals ?? 0;
  }

  const acByAction = sid == null ? [] : db.prepare(`
    SELECT action_taken AS action, COUNT(*) AS n, SUM(period_clicks) AS clicks, SUM(period_seconds) AS secs,
           MAX(inferred_cps) AS maxCps, MIN(logged_at) AS first, MAX(logged_at) AS last
    FROM anticheat_logs WHERE user_id = ? AND season_id = ? GROUP BY action_taken ORDER BY n DESC
  `).all(userId, sid);
  const acRecent = sid == null ? [] : db.prepare(`
    SELECT logged_at, action_taken AS action, period_seconds AS secs, period_clicks AS clicks,
           inferred_cps AS cps, effective_ratio AS ratio
    FROM anticheat_logs WHERE user_id = ? AND season_id = ? ORDER BY id DESC LIMIT 30
  `).all(userId, sid);

  // Échantillons par sauvegarde (depuis leur mise en service) : deltas calculés entre deux lignes
  const sRows = sid == null ? [] : db.prepare(`
    SELECT * FROM antibot_save_samples WHERE user_id = ? AND season_id = ? ORDER BY id DESC LIMIT 200
  `).all(userId, sid).reverse();
  const tel = { saves: 0, clicks: 0, untrusted: 0, h: new Array(TELEMETRY_BINS).fill(0), p: { m: 0, t: 0, k: 0, o: 0 } };
  const samples = sRows.map((r, i) => {
    const prev = i > 0 ? sRows[i - 1] : null;
    const d = (a, b) => (prev && r[a] != null && prev[a] != null ? r[a] - prev[a] : null);
    const t = _json(r.tel);
    if (t) {
      tel.saves += 1;
      tel.clicks += t.n ?? 0;
      tel.untrusted += t.u ?? 0;
      if (Array.isArray(t.h)) t.h.forEach((v, j) => { tel.h[j] += v; });
      if (t.p) for (const k of Object.keys(tel.p)) tel.p[k] += t.p[k] ?? 0;
    }
    const dtSecs = prev ? (r.at_ms - prev.at_ms) / 1000 : null;
    const dClicks = d('manual_clicks');
    return {
      at: _utc(r.at_ms), dtSecs: _r1(dtSecs),
      reportedDepth: r.reported_depth, acceptedDepth: r.accepted_depth, budgetDepth: r.budget_depth, exactDepth: r.exact_depth ?? null,
      dDepth: d('accepted_depth'), dClicks, dManualBlocks: d('manual_blocks'), dAutoBlocks: d('auto_blocks'),
      dBlocksDestroyed: d('blocks_destroyed'),
      serverCps: dtSecs > 0 && dClicks != null ? _r1(dClicks / dtSecs) : null,
      autodigLevel: r.autodig_level, acAction: r.ac_action,
      tel: t ? { n: t.n, u: t.u, under40: t.h?.[0] ?? null, p: t.p ?? null } : null,
    };
  });

  const declared = save?.seasonStats ?? null;
  const uncountedBlocks = save?.blocksDestroyed != null && declared?.manualBlocks != null && declared?.autoBlocks != null
    ? Math.max(0, save.blocksDestroyed - declared.manualBlocks - declared.autoBlocks) : null;
  // Origine des blocs détruits (#76, lecture seule) : « blocksDestroyed » couvre la partie entière
  // (jamais remis à zéro) ; manuels / Auto-Dig / suspects repartent à 0 à chaque saison. Le reste
  // vient donc surtout des saisons précédentes (et, avant #74, des blocs cassés par un coup suspect).
  const blockOrigin = uncountedBlocks == null ? null : (() => {
    const suspicious = declared.suspiciousBlocks ?? null;
    const season = declared.manualBlocks + declared.autoBlocks + (suspicious ?? 0);
    return {
      total: save.blocksDestroyed, manual: declared.manualBlocks, auto: declared.autoBlocks, suspicious,
      season, outsideSeason: Math.max(0, save.blocksDestroyed - season),
      // la profondeur repart à 1 en début de saison : ~1 bloc détruit par mètre gagné
      seasonDepthBlocks: declared.maxDepth != null ? Math.max(0, declared.maxDepth - 1) : null,
    };
  })();

  const budgetMode = getDamageBudgetMode(config);
  const abMode = getAntibotMode(config);
  const depthOn = String(config.depth_validation_enabled ?? 'true').toLowerCase() !== 'false';
  const acOn = String(config.anti_autoclick_enabled ?? 'true').toLowerCase() !== 'false';
  const count = type => byType.find(e => e.type === type)?.n ?? 0;
  const acCount = a => acByAction.find(x => x.action === a)?.n ?? 0;
  const notRanked = ranking ? Math.max(0, ranking.manual_blocks - ranking.effective_manual_blocks) : null;

  // Tableau « contrôle → observation → action prévue → action effectivement appliquée »
  const responses = [
    { control: 'Validation de la profondeur (#9, seaux de jetons)', mode: depthOn ? 'actif' : 'désactivé',
      observation: `${count('depth_rejected')} rejet(s) journalisé(s) ; écart actuel déclaré − retenu : ${depth?.depthGap ?? 0} m`,
      planned: 'Borne la profondeur CLASSÉE par le temps serveur (clics ≤ depth_max_cps, Auto-Dig ≤ 1 bloc/s).',
      applied: depthOn ? 'Profondeur classée plafonnée si l’écart > 0. La partie du joueur (profondeur affichée, pièces, achats) n’est pas modifiée.' : 'Aucune.' },
    { control: 'Budget de dégâts (#25 lot B)', mode: budgetMode,
      observation: `${count('damage_budget')} dépassement(s) journalisé(s), ${acCount('damage_capped')} plafonnement(s) ; écart inexpliqué actuel : ${_r1(depth?.budgetGap ?? 0)} m`,
      planned: 'Borne la profondeur CLASSÉE par les dégâts maximum possibles (25 PV/clic, 20 PV/s Auto-Dig) contre les PV minimum des blocs.',
      applied: budgetMode === 'enforce' ? 'Profondeur classée plafonnée en cas de dépassement. Ne réduit ni les coups, ni les gains, ni les achats.' : 'Aucune (calcul et journal seulement).' },
    { control: 'Anti-autoclic (#10)', mode: acOn ? 'actif' : 'désactivé',
      observation: `${acCount('flagged')} fenêtre(s) « flagged », ${acCount('reduced')} « reduced », ${acCount('rejected')} « rejected » ; blocs manuels déclarés non retenus : ${notRanked ?? '—'}`,
      planned: 'Au-delà de max_effective_cps, réduit les blocs manuels VALIDÉS (classement #73).',
      applied: acOn ? 'Blocs manuels classés réduits. Les clics, les dégâts, la profondeur et les gains de la partie ne sont pas réduits.' : 'Aucune.' },
    { control: 'Clic suspect côté navigateur (_isSuspiciousCPS)', mode: 'client',
      observation: `${declared?.suspiciousScore ?? ranking?.suspicious_score ?? '—'} clic(s) jugés suspects (déclaré) ; blocs détruits ni manuels ni Auto-Dig : ${uncountedBlocks ?? 'non disponible'}`,
      planned: 'Un bloc détruit par un clic suspect n’est pas compté comme manuel.',
      applied: 'Le bloc rapporte quand même profondeur et gains (faille suivie dans #74).' },
    { control: 'Score de risque (lot A)', mode: abMode,
      observation: `Score ${_r1(risk.score)} — niveau N${risk.level}`,
      planned: 'Niveaux N1 journaliser · N2 limiter · N3 défi · N4 suspension (lot C, non réalisé).',
      applied: 'Aucune : mode shadow, applied:false (aucun niveau n’est appliqué).' },
    { control: 'Économie (pièces, améliorations, reliques, coffres)', mode: 'non validée',
      observation: save ? `Déclaré : ${save.coins ?? '—'} pièces, Auto-Dig niv. ${save.upgrades.autodig ?? 0}, pioche niv. ${save.pickaxeLevel ?? '—'}` : 'Aucune sauvegarde.',
      planned: 'Aucun contrôle serveur des gains et achats aujourd’hui (gemmes : registre #49, mode réglable).',
      applied: 'Aucune : la sauvegarde du navigateur est acceptée telle quelle (correctif P0 suivi dans #74).' },
  ];

  return {
    player: { userId: user.id, username: user.username, createdAt: user.created_at.replace(' ', 'T') + 'Z' },
    season: season ? { id: season.id, name: season.name, status: season.status, startAt: season.start_at, endAt: season.end_at } : null,
    seasons,
    modes: { antibotMode: abMode, damageBudgetMode: budgetMode, exactHpMode: getExactHpMode(config), depthValidation: depthOn, antiAutoclick: acOn,
             maxEffectiveCps: parseFloat(config.max_effective_cps ?? config.cps_limit ?? '8'),
             depthMaxCps: parseFloat(config.depth_max_cps ?? '20'), sanctionsApplied: false },
    ranking: ranking ? {
      acceptedDepth: ranking.max_depth, reportedDepth: ranking.reported_max_depth,
      manualBlocks: ranking.manual_blocks, validatedManualBlocks: Math.min(ranking.effective_manual_blocks, ranking.manual_blocks),
      autoBlocks: ranking.auto_blocks, manualClicks: ranking.manual_clicks, suspiciousClicks: ranking.suspicious_score,
      isActive: !!ranking.is_active,
      firstSeen: ranking.created_at.replace(' ', 'T') + 'Z', lastUpdate: ranking.updated_at.replace(' ', 'T') + 'Z',
    } : null,
    depth, clicks, save, uncountedBlocks, blockOrigin,
    risk: {
      score: _r1(risk.score), level: risk.level, updatedAt: _utc(riskRow?.updated_ms),
      components: Object.entries(CATEGORY_CAPS).map(([cat, cap]) => ({
        cat, value: _r1(risk.components[cat] ?? 0), cap,
        signals: Object.entries(SIGNALS).filter(([, d]) => d.cat === cat).map(([t, d]) => `${t} +${d.points}`),
      })),
      halfLifeHours: HALF_LIFE_MS / 3600_000,
      thresholds: { 1: 30, 2: 60, 3: 80, 4: 90 },
    },
    events: { byType, recent },
    burstFromEvents: burst,
    anticheat: { byAction: acByAction, recent: acRecent },
    samples: { rows: samples, telemetry: tel.saves ? tel : null, since: samples[0]?.at ?? null },
    responses,
  };
}

module.exports = {
  recordSaveSample, findPlayer, playerReport, SAMPLES_PER_USER,
  // Lot B
  MAX_CLICK_DAMAGE, MAX_AUTODIG_DPS, AUTODIG_MARGIN, CLICK_MARGIN, MAX_HP_REDUCTION, HP_SCALE_PER_M,
  MIN_HP_SEGMENTS, DAMAGE_POOL_SECS, DAMAGE_LOG_GAP, setMinHpSegments, getMinHpSegments,
  damageCost, minBlockHp, reachableDepth, maxDamageRate, applyDamageBudget,
  // Interrupteurs
  getAntibotMode, getDamageBudgetMode, getExactHpMode, validateConfigValue, getHitLimits, HIT_RATE_DEFAULT, HIT_BURST_DEFAULT,
  // Lot A
  configure, hashIp, logSecurityEvent, purgeOldEvents, startPurgeScheduler,
  SIGNALS, CATEGORY_CAPS, riskLevel, getRisk, recordSignals, relieveRisk,
  forgedCounters, normalizeTelemetry, telemetrySignals, TELEMETRY_BINS,
  recordTiming, getTimings, buildSummary, listEvents, EVENT_GROUPS, EVENT_PERIODS,
};
