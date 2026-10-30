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
 * @returns {{ depth: number, credit: number, refClicks: number, pendingClicks: number }}
 */
function applyDamageBudget({ fromDepth, credit, claimedClicks, refClicks, dtSecs, target, handRate, uncapped = false }) {
  const dt       = Math.max(0, dtSecs);
  const ref      = claimedClicks < refClicks ? claimedClicks : refClicks; // compteur revenu en arrière
  const pending  = claimedClicks - ref;
  const credited = uncapped ? pending : Math.min(pending, Math.floor(handRate * CLICK_MARGIN * dt));
  const cap      = uncapped ? Infinity : maxDamageRate(handRate) * CLICK_MARGIN * DAMAGE_POOL_SECS;
  const avail    = Math.min(cap, Math.max(0, credit)
    + credited * MAX_CLICK_DAMAGE
    + dt * MAX_AUTODIG_DPS * AUTODIG_MARGIN);
  const from     = Math.max(1, fromDepth);
  const r        = reachableDepth(from, avail, target);
  return { depth: r.depth, credit: avail - r.spent, refClicks: ref + credited, pendingClicks: pending - credited };
}

// ── Interrupteurs ────────────────────────────────────────────────────────────

const ANTIBOT_MODES = ['off', 'shadow'];
const BUDGET_MODES  = ['off', 'shadow', 'enforce'];

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
 * Validation des clés de config #25 (PUT /api/admin/config).
 * @returns {{ value: string } | { error: string } | null}  null : clé non concernée
 */
function validateConfigValue(key, raw) {
  const v = String(raw).trim().toLowerCase();
  if (key === 'antibot_mode') {
    if (v === 'enforce') return { error: 'antibot_mode : « enforce » (sanctions, lot C) n\'est pas encore disponible — off ou shadow.' };
    return ANTIBOT_MODES.includes(v) ? { value: v } : { error: 'antibot_mode : off ou shadow attendu.' };
  }
  if (key === 'damage_budget_mode') {
    return BUDGET_MODES.includes(v) ? { value: v } : { error: 'damage_budget_mode : off, shadow ou enforce attendu.' };
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
const CATEGORY_CAPS = { proof: 100, cps: 25, untrusted: 25, burst: 15, regularity: 10 };

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
  regular_clicks:  { cat: 'regularity', points: 2  }, // rythme quasi parfait et long (jamais seul)
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

// ── Lot A : signaux tirés de la sauvegarde ───────────────────────────────────

const COUNTER_FIELDS = ['maxDepth', 'manualClicks', 'manualBlocks', 'autoBlocks'];
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
  return { n, h, u: Math.min(int(t.u), n), p, cv };
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

/** Résumé pour le panel admin : modes, comptes par niveau, événements récents par type. */
function buildSummary(seasonId, config, nowMs = Date.now()) {
  const db = getDb();
  const rows = seasonId == null ? [] : db.prepare(`
    SELECT r.user_id, r.components, r.updated_ms, u.username
    FROM risk_scores r LEFT JOIN users u ON u.id = r.user_id
    WHERE r.season_id = ?
  `).all(seasonId);
  const levels = [0, 0, 0, 0, 0];
  const accounts = rows.map(r => {
    let comps = {};
    try { comps = JSON.parse(r.components) ?? {}; } catch (_) {}
    const c = _decayed(comps, nowMs - r.updated_ms);
    const score = _total(c);
    const level = riskLevel(score);
    levels[level] += 1;
    const round = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Math.round(v * 10) / 10]));
    return { userId: r.user_id, username: r.username ?? `user_${r.user_id}`, score: Math.round(score * 10) / 10, level, components: round };
  }).filter(a => a.score > 0).sort((a, b) => b.score - a.score).slice(0, 50);

  const byType = db.prepare(`
    SELECT type, COUNT(*) AS n FROM security_events
    WHERE created_at >= datetime('now', '-7 days') GROUP BY type ORDER BY n DESC
  `).all();

  return {
    antibotMode:      getAntibotMode(config),
    damageBudgetMode: getDamageBudgetMode(config),
    envOverride:      _envOff(process.env),
    seasonId,
    levels,            // nombre de comptes de la saison par niveau 0..4 (non appliqués)
    accounts,          // comptes au score > 0, du plus élevé au plus faible (50 max)
    eventsLast7Days: byType,
    timings: getTimings(),
  };
}

/** Événements de sécurité, du plus récent au plus ancien. */
function listEvents({ limit = 100, offset = 0, type = null, userId = null } = {}) {
  const where = [];
  const args  = [];
  if (type)   { where.push('e.type = ?');    args.push(type); }
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

module.exports = {
  // Lot B
  MAX_CLICK_DAMAGE, MAX_AUTODIG_DPS, AUTODIG_MARGIN, CLICK_MARGIN, MAX_HP_REDUCTION, HP_SCALE_PER_M,
  MIN_HP_SEGMENTS, DAMAGE_POOL_SECS, DAMAGE_LOG_GAP, setMinHpSegments, getMinHpSegments,
  damageCost, minBlockHp, reachableDepth, maxDamageRate, applyDamageBudget,
  // Interrupteurs
  getAntibotMode, getDamageBudgetMode, validateConfigValue,
  // Lot A
  configure, hashIp, logSecurityEvent, purgeOldEvents, startPurgeScheduler,
  SIGNALS, CATEGORY_CAPS, riskLevel, getRisk, recordSignals,
  forgedCounters, normalizeTelemetry, telemetrySignals, TELEMETRY_BINS,
  recordTiming, getTimings, buildSummary, listEvents,
};
