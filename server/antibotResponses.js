'use strict';
/**
 * antibotResponses.js — #25 lot C : défis ponctuels et suspensions progressives du MINAGE MANUEL.
 * Décision du propriétaire du 06/11/2026 (issue #25). Conception : docs/ANTI-BOT.md § 11.
 *
 * Principe : la source de vérité est le serveur. Un défi ne « prouve » rien : tant qu'il est en
 * attente, les clics manuels ne créditent plus la progression classée (blocs manuels validés,
 * profondeur hors Auto-Dig). Une suspension n'est créée qu'après une violation CONFIRMÉE :
 * des clics manuels déclarés alors que le jeu officiel affichait le défi (il bloque les coups).
 *
 * Mesures (temps serveur, compteurs déclarés — sous-déclarer ne rapporte rien au tricheur) :
 *   - série de minage manuel sans pause (≥ 3 min sans clic coupe la série) ;
 *   - temps de minage manuel actif sur 6 h et 24 h glissantes (paquets de 10 min) ;
 *   - score de risque #25 (multi-signal, demi-vie 24 h).
 * Une cadence modérée ou un jitter aléatoire n'exonèrent de rien : la durée suffit à déclencher
 * un défi (jamais une suspension). Résoudre un défi remet les mesures à zéro (≈ 1 défi par heure
 * de minage continu pour un automate, aucune nuit entière sans humain).
 *
 * Modes (config antibot_response_mode) : off | observe | enforce (Désactivé / Observation / Appliqué),
 * défaut observe : défis « simulés » journalisés, rien n'est montré ni retiré au joueur.
 * Essai sur un compte consentant : force_mode = 'enforce' (admin) ; global off reste prioritaire.
 * Variable d'environnement ANTIBOT=off : tout #25 désactivé.
 */

const crypto = require('crypto');
const { getDb } = require('./db');
const antibot = require('./antibot');

// ── Paramètres (config admin, bornés) ─────────────────────────────────────────

const RESPONSE_MODES = ['off', 'observe', 'enforce'];
const RESPONSE_MODE_DEFAULT = 'observe';

/** Paliers de suspension du minage manuel (minutes) : 1 → 5 min … 7+ → 24 h. */
const LADDER_DEFAULT = [5, 15, 30, 60, 120, 720, 1440];

const PARAMS = {
  ab_challenge_score: { def: 60,  range: [20, 100],  label: 'Score de risque déclenchant un défi' },
  ab_streak_min:      { def: 60,  range: [10, 600],  label: 'Minage manuel continu sans pause (min)' },
  ab_active6h_min:    { def: 180, range: [30, 360],  label: 'Minage manuel actif sur 6 h (min)' },
  ab_active24h_min:   { def: 360, range: [60, 1440], label: 'Minage manuel actif sur 24 h (min)' },
  ab_cooldown_min:    { def: 30,  range: [0, 240],   label: 'Délai minimal entre deux défis (min)' },
  ab_violation_clicks:{ def: 30,  range: [5, 1000],  label: 'Clics pendant un défi affiché = violation' },
  ab_decay_days:      { def: 30,  range: [1, 365],   label: 'Jours sans violation pour redescendre d\'un palier' },
};

/** Une pause de 3 min sans minage manuel coupe la série continue. */
const PAUSE_SECS = 180;
/** Cadence humaine minimale supposée pour convertir des clics en temps actif. */
const ACTIVE_CPS = 2;
const BUCKET_MS = 10 * 60_000;
const DAY_MS = 86_400_000;

/** Défi maison : validité d'une énigme, délai minimal de réponse, plafond d'énigmes. */
const PUZZLE_TTL_MS = 5 * 60_000;
const PUZZLE_MIN_ANSWER_MS = 1200;
const PUZZLE_WINDOW_MS = 10 * 60_000;
const PUZZLE_MAX_PER_WINDOW = 15;
/** Symboles de l'énigme (noms localisés par le client : antibot.sym_<id>). */
const SYMBOLS = ['pickaxe', 'gem', 'key', 'star', 'heart', 'fire', 'drop', 'moon', 'clover', 'coin', 'bell', 'leaf'];
const SYMBOL_ICONS = { pickaxe: '⛏️', gem: '💎', key: '🔑', star: '⭐', heart: '❤️', fire: '🔥', drop: '💧', moon: '🌙', clover: '🍀', coin: '🪙', bell: '🔔', leaf: '🍃' };
const GRID_SIZE = 6;
const GRID_TARGETS = 2;

function _num(raw, { def, range: [min, max] }) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : def;
}

function _ladder(raw) {
  if (raw == null || raw === '') return LADDER_DEFAULT.slice();
  const parts = String(raw).split(',').map(s => Number(s.trim()));
  return parts.length >= 1 && parts.length <= 12 && parts.every(n => Number.isInteger(n) && n >= 1 && n <= 10_080)
    ? parts : LADDER_DEFAULT.slice();
}

/** Paramètres effectifs (valeurs admin bornées, défauts sinon). */
function getParams(config = {}) {
  const out = {};
  for (const [k, def] of Object.entries(PARAMS)) out[k] = _num(config[k], def);
  out.ab_suspension_ladder = _ladder(config.ab_suspension_ladder);
  return out;
}

/** Mode global : off | observe | enforce. Le mode anti-bot off (ou ANTIBOT=off) coupe tout. */
function getGlobalMode(config = {}, env = process.env) {
  if (antibot.getAntibotMode(config, env) === 'off') return 'off';
  const v = String(config.antibot_response_mode ?? RESPONSE_MODE_DEFAULT).toLowerCase();
  return RESPONSE_MODES.includes(v) ? v : RESPONSE_MODE_DEFAULT;
}

/** Validation des clés de config du lot C (null : clé non concernée). */
function validateConfigValue(key, raw) {
  const v = String(raw).trim().toLowerCase();
  if (key === 'antibot_response_mode') {
    return RESPONSE_MODES.includes(v) ? { value: v } : { error: 'antibot_response_mode : off, observe ou enforce attendu.' };
  }
  if (key === 'ab_suspension_ladder') {
    const parts = v.split(',').map(s => Number(s.trim()));
    return parts.length >= 1 && parts.length <= 12 && parts.every(n => Number.isInteger(n) && n >= 1 && n <= 10_080)
      ? { value: parts.join(',') } : { error: 'ab_suspension_ladder : 1 à 12 durées en minutes (1 à 10080), séparées par des virgules.' };
  }
  if (Object.hasOwn(PARAMS, key)) {
    const [min, max] = PARAMS[key].range;
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? { value: String(n) } : { error: `${key} : nombre de ${min} à ${max} attendu.` };
  }
  return null;
}

// ── État par joueur ───────────────────────────────────────────────────────────

function _state(userId) {
  return getDb().prepare('SELECT * FROM antibot_activity WHERE user_id = ?').get(userId) ?? null;
}

function _buckets(row) {
  try { const b = JSON.parse(row?.buckets ?? '[]'); return Array.isArray(b) ? b : []; } catch (_) { return []; }
}

function _saveState(userId, s) {
  getDb().prepare(`
    INSERT INTO antibot_activity (user_id, season_id, last_ms, last_clicks, last_blocks, streak_active_s, pause_s, buckets,
      force_mode, violation_level, last_violation_ms, last_challenge_ms, rebase_clicks, rebase_blocks, tel_h, updated_ms)
    VALUES (@user_id, @season_id, @last_ms, @last_clicks, @last_blocks, @streak_active_s, @pause_s, @buckets,
      @force_mode, @violation_level, @last_violation_ms, @last_challenge_ms, @rebase_clicks, @rebase_blocks, @tel_h, @updated_ms)
    ON CONFLICT(user_id) DO UPDATE SET season_id = excluded.season_id, last_ms = excluded.last_ms,
      last_clicks = excluded.last_clicks, last_blocks = excluded.last_blocks, streak_active_s = excluded.streak_active_s,
      pause_s = excluded.pause_s, buckets = excluded.buckets, force_mode = excluded.force_mode,
      violation_level = excluded.violation_level, last_violation_ms = excluded.last_violation_ms,
      last_challenge_ms = excluded.last_challenge_ms, rebase_clicks = excluded.rebase_clicks,
      rebase_blocks = excluded.rebase_blocks, tel_h = excluded.tel_h, updated_ms = excluded.updated_ms
  `).run({
    user_id: userId, season_id: s.season_id ?? null, last_ms: s.last_ms ?? null, last_clicks: s.last_clicks ?? null,
    last_blocks: s.last_blocks ?? null, streak_active_s: s.streak_active_s ?? 0, pause_s: s.pause_s ?? 0,
    buckets: JSON.stringify(s.buckets ?? []), force_mode: s.force_mode ?? null, violation_level: s.violation_level ?? 0,
    last_violation_ms: s.last_violation_ms ?? null, last_challenge_ms: s.last_challenge_ms ?? null,
    rebase_clicks: s.rebase_clicks ?? null, rebase_blocks: s.rebase_blocks ?? null,
    tel_h: s.tel ? JSON.stringify(s.tel) : null, updated_ms: s.updated_ms ?? Date.now(),
  });
}

function _blank(userId) {
  return { user_id: userId, season_id: null, last_ms: null, last_clicks: null, last_blocks: null, streak_active_s: 0,
    pause_s: 0, buckets: [], force_mode: null, violation_level: 0, last_violation_ms: null, last_challenge_ms: null,
    rebase_clicks: null, rebase_blocks: null, tel: null };
}

function _load(userId) {
  const row = _state(userId);
  if (!row) return _blank(userId);
  let tel = null;
  try { tel = row.tel_h ? JSON.parse(row.tel_h) : null; } catch (_) { tel = null; }
  return { ...row, buckets: _buckets(row), tel };
}

/** Mode effectif pour un joueur : global, sauf essai « Appliqué » sur ce compte (jamais si global off). */
function getUserMode(userId, config = {}, env = process.env) {
  const g = getGlobalMode(config, env);
  if (g === 'off') return 'off';
  const row = _state(userId);
  return row?.force_mode === 'enforce' ? 'enforce' : g;
}

/** Palier de violation après décroissance (−1 par période sans violation confirmée). */
function effectiveViolationLevel(s, nowMs, params) {
  const lvl = s.violation_level ?? 0;
  if (!lvl || !s.last_violation_ms) return 0;
  const steps = Math.floor((nowMs - s.last_violation_ms) / (params.ab_decay_days * DAY_MS));
  return Math.max(0, lvl - Math.max(0, steps));
}

function _activeSum(buckets, nowMs, windowMs) {
  const from = nowMs - windowMs;
  return buckets.reduce((sum, [t, secs]) => (t + BUCKET_MS > from ? sum + secs : sum), 0);
}

/**
 * Mesure de l'activité manuelle d'une fenêtre de sauvegarde (temps serveur).
 * Temps actif = min(durée, clics / 2) : un humain qui clique 5 s dans une fenêtre de 12 s compte
 * ≈ 5 s ; un automate qui clique sans arrêt compte toute la fenêtre.
 */
function _measure(s, seasonId, claimedClicks, claimedBlocks, nowMs) {
  const rebase = s.season_id !== seasonId || s.last_ms == null || s.last_clicks == null || claimedClicks < s.last_clicks;
  const dClicks = rebase ? 0 : claimedClicks - s.last_clicks;
  const dt = rebase ? 0 : Math.max(0, (nowMs - s.last_ms) / 1000);
  const active = Math.min(dt, dClicks / ACTIVE_CPS);
  const idle = dt - active;
  if (s.season_id !== seasonId) { s.streak_active_s = 0; s.pause_s = 0; s.buckets = []; }
  if (idle >= dt / 2 && dt > 0) s.pause_s = (s.pause_s ?? 0) + idle; else if (dt > 0) s.pause_s = 0;
  if (s.pause_s >= PAUSE_SECS) { s.streak_active_s = 0; s.tel = null; }
  s.streak_active_s = (s.streak_active_s ?? 0) + active;
  if (active > 0) {
    const key = Math.floor(nowMs / BUCKET_MS) * BUCKET_MS;
    const last = s.buckets[s.buckets.length - 1];
    if (last && last[0] === key) last[1] += active; else s.buckets.push([key, active]);
  }
  s.buckets = s.buckets.filter(([t]) => t + BUCKET_MS > nowMs - DAY_MS).map(([t, v]) => [t, Math.round(v * 10) / 10]);
  s.season_id = seasonId; s.last_ms = nowMs; s.last_clicks = claimedClicks; s.last_blocks = claimedBlocks;
  return { dClicks, dt, active };
}

function metrics(s, nowMs) {
  return {
    streakMin:    Math.round((s.streak_active_s ?? 0) / 6) / 10,
    active6hMin:  Math.round(_activeSum(s.buckets ?? [], nowMs, 6 * 3600_000) / 6) / 10,
    active24hMin: Math.round(_activeSum(s.buckets ?? [], nowMs, DAY_MS) / 6) / 10,
  };
}

/**
 * Indices du score de risque tirés de l'activité (jamais une sanction à eux seuls) :
 *   sustained_activity : la série continue dépasse la moitié du seuil de défi ;
 *   narrow_jitter : sur ≥ 3 000 intervalles d'une même série, presque aucune pause ≥ 500 ms et
 *   ≥ 95 % des intervalles dans deux classes voisines (gigue synthétique). Télémétrie falsifiable.
 */
function _activitySignals(s, prevStreak, tel, params) {
  const out = [];
  const half = params.ab_streak_min * 30;   // secondes
  if (prevStreak < half && s.streak_active_s >= half) {
    out.push({ type: 'sustained_activity', details: { streakMin: Math.round(s.streak_active_s / 6) / 10, threshold: params.ab_streak_min } });
  }
  if (tel?.h && tel.h.length === 8) {
    const agg = s.tel && Array.isArray(s.tel.h) && s.tel.h.length === 8 ? s.tel : { h: [0, 0, 0, 0, 0, 0, 0, 0], f: 0 };
    agg.h = agg.h.map((v, i) => v + tel.h[i]);
    const total = agg.h.reduce((a, b) => a + b, 0);
    if (!agg.f && total >= 3000) {
      let pair = 0;
      for (let i = 0; i < 7; i++) pair = Math.max(pair, agg.h[i] + agg.h[i + 1]);
      if (agg.h[7] / total < 0.002 && pair / total >= 0.95) {
        agg.f = 1;
        out.push({ type: 'narrow_jitter', details: { intervals: total, over500ms: agg.h[7], twoBinsShare: Math.round(pair / total * 1000) / 1000 } });
      }
    }
    s.tel = agg;
  }
  return out;
}

// ── Défis et suspensions (lecture) ────────────────────────────────────────────

function _pendingChallenge(userId) {
  return getDb().prepare(`SELECT * FROM antibot_challenges WHERE user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`).get(userId) ?? null;
}

function _activeSuspension(userId, nowMs) {
  return getDb().prepare(`SELECT * FROM antibot_suspensions WHERE user_id = ? AND status = 'active' AND ends_ms > ? ORDER BY id DESC LIMIT 1`).get(userId, nowMs) ?? null;
}

const _iso = ms => (ms ? new Date(ms).toISOString() : null);

/** État envoyé au joueur (null : rien à afficher). Uniquement en mode Appliqué. */
function playerStatus(userId, { config = {}, nowMs = Date.now() } = {}) {
  if (getUserMode(userId, config) !== 'enforce') return null;
  const susp = _activeSuspension(userId, nowMs);
  const ch = _pendingChallenge(userId);
  if (!susp && !ch) return null;
  return {
    mode: 'enforce',
    challenge: ch ? { id: ch.id, issuedAt: _iso(ch.created_ms), seen: !!ch.seen_ms } : null,
    suspension: susp ? { id: susp.id, level: susp.level, minutes: Math.round((susp.ends_ms - susp.starts_ms) / 60_000),
      startsAt: _iso(susp.starts_ms), endsAt: _iso(susp.ends_ms) } : null,
    manualRanked: false,   // clics manuels non crédités au classement tant que l'état dure
  };
}

// ── Pipeline de sauvegarde ────────────────────────────────────────────────────

/**
 * Avant la validation de la sauvegarde : mesure l'activité, confirme une violation éventuelle,
 * et dit si les clics manuels de cette fenêtre doivent être retenus hors classement.
 * @returns {{ mode, hold: boolean, rebase: { clicks, blocks } | null, metrics, violation: object|null }}
 */
function beforeSave(userId, seasonId, { claimedClicks, claimedBlocks, telemetry = null, config = {}, nowMs = Date.now(), ip = null } = {}) {
  const mode = getUserMode(userId, config);
  if (mode === 'off') return { mode, hold: false, rebase: null, metrics: null, violation: null, signals: [] };
  const params = getParams(config);
  const db = getDb();
  return db.transaction(() => {
    const s = _load(userId);
    const prevStreak = s.streak_active_s ?? 0;
    const m = _measure(s, seasonId, claimedClicks, claimedBlocks, nowMs);
    const signals = _activitySignals(s, prevStreak, telemetry, params);
    let hold = false;
    let rebase = null;
    let violation = null;
    if (mode === 'enforce') {
      const ch = _pendingChallenge(userId);
      let susp = _activeSuspension(userId, nowMs);
      // Violation confirmée : clics déclarés au-delà du compteur relevé quand le défi était affiché
      if (ch && ch.seen_ms && !susp && Number.isSafeInteger(ch.seen_clicks) && claimedClicks - ch.seen_clicks >= params.ab_violation_clicks) {
        const from = effectiveViolationLevel(s, nowMs, params);
        const level = from + 1;
        const ladder = params.ab_suspension_ladder;
        const minutes = ladder[Math.min(level, ladder.length) - 1];
        const clicks = claimedClicks - ch.seen_clicks;
        const id = db.prepare(`
          INSERT INTO antibot_suspensions (user_id, season_id, challenge_id, level, starts_ms, ends_ms, status, origin, reason)
          VALUES (?, ?, ?, ?, ?, ?, 'active', 'auto', ?)
        `).run(userId, seasonId, ch.id, level, nowMs, nowMs + minutes * 60_000,
          JSON.stringify({ code: 'clicks_during_challenge', clicksAfterShown: clicks })).lastInsertRowid;
        s.violation_level = level; s.last_violation_ms = nowMs;
        // Le défi reste à résoudre après la suspension ; il devra être réaffiché (nouveau relevé)
        db.prepare('UPDATE antibot_challenges SET seen_ms = NULL, seen_clicks = NULL, violations = violations + 1 WHERE id = ?').run(ch.id);
        antibot.logSecurityEvent('suspension_started', { userId, seasonId, ip,
          details: { suspensionId: Number(id), challengeId: ch.id, level, minutes, clicksAfterShown: clicks, applied: true } });
        violation = { level, minutes };
        susp = _activeSuspension(userId, nowMs);
      }
      if (ch || susp) {
        hold = true;
        rebase = { clicks: claimedClicks, blocks: claimedBlocks };
        if (m.dClicks > 0) {
          db.prepare('UPDATE antibot_challenges SET held_clicks = held_clicks + ? WHERE id = ?').run(m.dClicks, ch?.id ?? -1);
          if (susp) db.prepare('UPDATE antibot_suspensions SET held_clicks = held_clicks + ? WHERE id = ?').run(m.dClicks, susp.id);
        }
      } else if (s.rebase_clicks != null) {
        // Première sauvegarde après un défi résolu : seuls les clics postérieurs à la résolution comptent
        rebase = { clicks: Math.min(claimedClicks, s.rebase_clicks), blocks: Math.min(claimedBlocks, s.rebase_blocks ?? claimedBlocks) };
        s.rebase_clicks = null; s.rebase_blocks = null;
      }
    }
    s.updated_ms = nowMs;
    _saveState(userId, s);
    return { mode, hold, rebase, metrics: metrics(s, nowMs), violation, dClicks: m.dClicks, signals };
  })();
}

/** Déclencheurs d'un défi (au moins un) — jamais une sanction. */
function _triggers(s, risk, params, nowMs) {
  const m = metrics(s, nowMs);
  const out = [];
  const cooling = s.last_challenge_ms && nowMs - s.last_challenge_ms < params.ab_cooldown_min * 60_000;
  if (risk && risk.score >= params.ab_challenge_score && !cooling) out.push({ code: 'risk_score', value: Math.round(risk.score * 10) / 10, threshold: params.ab_challenge_score });
  if (m.streakMin >= params.ab_streak_min) out.push({ code: 'continuous_mining', value: m.streakMin, threshold: params.ab_streak_min });
  if (m.active6hMin >= params.ab_active6h_min) out.push({ code: 'active_6h', value: m.active6hMin, threshold: params.ab_active6h_min });
  if (m.active24hMin >= params.ab_active24h_min) out.push({ code: 'active_24h', value: m.active24hMin, threshold: params.ab_active24h_min });
  return { reasons: out, metrics: m };
}

function _resetActivity(s, nowMs) {
  s.streak_active_s = 0; s.pause_s = 0; s.buckets = []; s.tel = null; s.last_challenge_ms = nowMs;
}

/**
 * Crée un défi (enforce : en attente, minage manuel non crédité jusqu'à résolution ;
 * observe : « simulé », journalisé et résolu d'office pour mesurer la fréquence réelle).
 */
function issueChallenge(userId, seasonId, { mode, reasons, metrics: m, origin = 'auto', nowMs = Date.now(), ip = null }) {
  const db = getDb();
  const status = mode === 'enforce' ? 'pending' : 'shadow';
  const id = Number(db.prepare(`
    INSERT INTO antibot_challenges (user_id, season_id, status, mode, origin, reasons, created_ms, resolved_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, seasonId, status, mode, origin, JSON.stringify({ reasons, metrics: m }), nowMs, status === 'shadow' ? nowMs : null).lastInsertRowid);
  const ev = { userId, seasonId, ip, details: { challengeId: id, origin, reasons: reasons.map(r => r.code), metrics: m, applied: mode === 'enforce' } };
  if (mode === 'enforce') antibot.logSecurityEvent('challenge_issued', ev);
  else antibot.logSecurityEvent('challenge_shadow', ev);
  return id;
}

/**
 * Après la validation : décide d'un défi selon les mesures et le score de risque à jour.
 * @returns {object|null} État joueur à renvoyer (null : rien à afficher)
 */
function afterSave(userId, seasonId, { config = {}, nowMs = Date.now(), ip = null } = {}) {
  const mode = getUserMode(userId, config);
  if (mode === 'off') return null;
  const params = getParams(config);
  const db = getDb();
  db.transaction(() => {
    // Un défi réel en attente (Appliqué) ne bloque pas la mesure en Observation (mode repassé en observe)
    if (mode === 'enforce' && (_pendingChallenge(userId) || _activeSuspension(userId, nowMs))) return;
    const s = _load(userId);
    if (s.season_id !== seasonId) return;
    const { reasons, metrics: m } = _triggers(s, antibot.getRisk(userId, seasonId, nowMs), params, nowMs);
    if (!reasons.length) return;
    issueChallenge(userId, seasonId, { mode, reasons, metrics: m, nowMs, ip });
    _resetActivity(s, nowMs);
    s.updated_ms = nowMs;
    _saveState(userId, s);
  })();
  return playerStatus(userId, { config, nowMs });
}

// ── Énigme maison (décidée et vérifiée par le serveur) ────────────────────────

const _hash = (id, answer) => crypto.createHash('sha256').update(`${id}:${answer}`).digest('hex');

function _shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Nouvelle énigme pour le défi en attente (relance permise, plafonnée). */
function newPuzzle(userId, challengeId, { kind = 'grid', nowMs = Date.now() } = {}) {
  const db = getDb();
  const ch = _pendingChallenge(userId);
  if (!ch || ch.id !== challengeId) return { error: 'no_challenge' };
  let windowStart = ch.puzzle_window_ms ?? nowMs;
  let count = ch.puzzle_count ?? 0;
  if (nowMs - windowStart >= PUZZLE_WINDOW_MS) { windowStart = nowMs; count = 0; }
  if (count >= PUZZLE_MAX_PER_WINDOW) {
    return { error: 'too_many', retryAt: _iso(windowStart + PUZZLE_WINDOW_MS) };
  }
  // Énigme précédente jamais résolue ni envoyée et arrivée à expiration : comptée « expirée »
  const expired = ch.puzzle_id && ch.puzzle_expires_ms && ch.puzzle_expires_ms <= nowMs ? 1 : 0;
  const id = crypto.randomBytes(16).toString('hex');
  let puzzle;
  let answer;
  if (kind === 'text') {
    const a = 2 + crypto.randomInt(8);
    const b = 1 + crypto.randomInt(9);
    puzzle = { kind: 'text', a, b };
    answer = String(a + b);
  } else {
    const syms = _shuffle(SYMBOLS.slice()).slice(0, GRID_SIZE);
    const targets = _shuffle(syms.slice()).slice(0, GRID_TARGETS);
    puzzle = { kind: 'grid', tiles: syms.map(sym => ({ sym, icon: SYMBOL_ICONS[sym] })), targets };
    answer = targets.map(t => syms.indexOf(t)).join(',');
  }
  db.prepare(`
    UPDATE antibot_challenges SET puzzle_id = ?, puzzle_hash = ?, puzzle_kind = ?, puzzle_issued_ms = ?, puzzle_expires_ms = ?,
      puzzle_window_ms = ?, puzzle_count = ?, expirations = expirations + ? WHERE id = ?
  `).run(id, _hash(id, answer), puzzle.kind, nowMs, nowMs + PUZZLE_TTL_MS, windowStart, count + 1, expired, ch.id);
  return { challengeId: ch.id, puzzleId: id, expiresAt: _iso(nowMs + PUZZLE_TTL_MS), ...puzzle };
}

/** Le joueur voit le défi : relevé du compteur de clics (base de la violation confirmée). */
function markSeen(userId, challengeId, { manualClicks, nowMs = Date.now() } = {}) {
  const ch = _pendingChallenge(userId);
  if (!ch || ch.id !== challengeId) return false;
  if (ch.seen_ms) return true;
  const declared = Number.isSafeInteger(manualClicks) && manualClicks >= 0 ? manualClicks : null;
  const s = _state(userId);
  // Jamais en deçà du dernier compteur reçu par le serveur
  const base = Math.max(declared ?? 0, s?.last_clicks ?? 0);
  getDb().prepare('UPDATE antibot_challenges SET seen_ms = ?, seen_clicks = ? WHERE id = ?').run(nowMs, base, ch.id);
  return true;
}

/**
 * Réponse à l'énigme : usage unique (toute réponse consomme l'énigme), délai minimal, expiration.
 * Un échec, une expiration ou une réponse trop rapide ne sanctionnent jamais : nouvelle énigme.
 * @returns {{ ok: true, solved: boolean, reason?: string }}
 */
function answer(userId, challengeId, puzzleId, value, { manualClicks, manualBlocks, config = {}, nowMs = Date.now(), ip = null } = {}) {
  const db = getDb();
  return db.transaction(() => {
    const ch = _pendingChallenge(userId);
    if (!ch || ch.id !== challengeId) return { ok: false, solved: false, reason: 'no_challenge' };
    if (!ch.puzzle_id || ch.puzzle_id !== String(puzzleId ?? '')) return { ok: true, solved: false, reason: 'stale' };
    let reason = null;
    if (ch.puzzle_expires_ms <= nowMs) reason = 'expired';
    else if (nowMs - ch.puzzle_issued_ms < PUZZLE_MIN_ANSWER_MS) reason = 'too_fast';
    else if (_hash(ch.puzzle_id, String(value ?? '').trim().slice(0, 40)) !== ch.puzzle_hash) reason = 'wrong';
    // Usage unique : l'énigme est consommée quelle que soit l'issue (anti-rejeu)
    db.prepare('UPDATE antibot_challenges SET puzzle_id = NULL, puzzle_hash = NULL WHERE id = ?').run(ch.id);
    if (reason) {
      db.prepare(`UPDATE antibot_challenges SET ${reason === 'expired' ? 'expirations' : 'fails'} = ${reason === 'expired' ? 'expirations' : 'fails'} + 1 WHERE id = ?`).run(ch.id);
      return { ok: true, solved: false, reason };
    }
    if (_activeSuspension(userId, nowMs)) return { ok: true, solved: false, reason: 'suspended' };
    db.prepare(`UPDATE antibot_challenges SET status = 'solved', resolved_ms = ? WHERE id = ?`).run(nowMs, ch.id);
    const s = _load(userId);
    _resetActivity(s, nowMs);
    // Seuls les clics postérieurs à la résolution compteront (jamais en deçà du dernier relevé serveur)
    const clicks = Number.isSafeInteger(manualClicks) && manualClicks >= 0 ? manualClicks : null;
    const blocks = Number.isSafeInteger(manualBlocks) && manualBlocks >= 0 ? manualBlocks : null;
    s.rebase_clicks = Math.max(clicks ?? 0, s.last_clicks ?? 0);
    s.rebase_blocks = Math.max(blocks ?? 0, s.last_blocks ?? 0);
    s.updated_ms = nowMs;
    _saveState(userId, s);
    const relief = ch.season_id != null ? antibot.relieveRisk(userId, ch.season_id, { nowMs }) : null;
    antibot.logSecurityEvent('challenge_solved', { userId, seasonId: ch.season_id, ip,
      scoreBefore: relief?.before ?? null, scoreAfter: relief?.after ?? null,
      details: { challengeId: ch.id, kind: ch.puzzle_kind, fails: ch.fails, expirations: ch.expirations,
        heldClicks: ch.held_clicks, secondsToSolve: Math.round((nowMs - ch.created_ms) / 1000) } });
    return { ok: true, solved: true };
  })();
}

// ── Admin ─────────────────────────────────────────────────────────────────────

/** Essai « Appliqué » sur un seul compte (consentant), réversible. */
function setForceMode(userId, enforce, nowMs = Date.now()) {
  const s = _load(userId);
  s.force_mode = enforce ? 'enforce' : null;
  s.updated_ms = nowMs;
  _saveState(userId, s);
  return s.force_mode;
}

/** Défi émis à la main par l'admin (essai) : selon le mode effectif du compte. */
function adminIssueChallenge(userId, seasonId, { config = {}, nowMs = Date.now() } = {}) {
  const mode = getUserMode(userId, config);
  if (mode === 'off') return { error: 'Mode Désactivé : aucun défi.' };
  if (mode === 'enforce' && _pendingChallenge(userId)) return { error: 'Un défi est déjà en attente pour ce compte.' };
  const s = _load(userId);
  const id = issueChallenge(userId, seasonId, { mode, reasons: [{ code: 'admin_test' }], metrics: metrics(s, nowMs), origin: 'admin', nowMs });
  return { id, mode };
}

function cancelChallenge(id, { note = null, nowMs = Date.now() } = {}) {
  const r = getDb().prepare(`UPDATE antibot_challenges SET status = 'cancelled', resolved_ms = ?, admin_note = ? WHERE id = ? AND status = 'pending'`)
    .run(nowMs, note ? String(note).slice(0, 200) : null, id);
  return r.changes > 0;
}

function liftSuspension(id, { note = null, nowMs = Date.now() } = {}) {
  const r = getDb().prepare(`UPDATE antibot_suspensions SET status = 'lifted', lifted_ms = ?, admin_note = ? WHERE id = ? AND status = 'active'`)
    .run(nowMs, note ? String(note).slice(0, 200) : null, id);
  return r.changes > 0;
}

/** Ajuste le palier de violation (0 = remise à zéro). */
function setViolationLevel(userId, level, nowMs = Date.now()) {
  const s = _load(userId);
  s.violation_level = Math.max(0, Math.min(50, Math.floor(level)));
  s.last_violation_ms = s.violation_level > 0 ? nowMs : null;
  s.updated_ms = nowMs;
  _saveState(userId, s);
  return s.violation_level;
}

function _challengeRow(r) {
  let reasons = null;
  try { reasons = JSON.parse(r.reasons); } catch (_) {}
  return { id: r.id, userId: r.user_id, username: r.username ?? `user_${r.user_id}`, status: r.status, mode: r.mode, origin: r.origin,
    reasons: reasons?.reasons?.map(x => x.code) ?? [], metrics: reasons?.metrics ?? null,
    createdAt: _iso(r.created_ms), seenAt: _iso(r.seen_ms), resolvedAt: _iso(r.resolved_ms),
    fails: r.fails, expirations: r.expirations, heldClicks: r.held_clicks, violations: r.violations };
}

function _suspRow(r, nowMs) {
  let reason = null;
  try { reason = JSON.parse(r.reason); } catch (_) {}
  const active = r.status === 'active' && r.ends_ms > nowMs;
  return { id: r.id, userId: r.user_id, username: r.username ?? `user_${r.user_id}`, level: r.level, origin: r.origin,
    status: active ? 'active' : (r.status === 'active' ? 'ended' : r.status),
    startsAt: _iso(r.starts_ms), endsAt: _iso(r.ends_ms), remainingMin: active ? Math.ceil((r.ends_ms - nowMs) / 60_000) : 0,
    reason: reason?.code ?? null, clicksAfterShown: reason?.clicksAfterShown ?? null, heldClicks: r.held_clicks,
    liftedAt: _iso(r.lifted_ms), note: r.admin_note ?? null };
}

/** Vue admin : mode, paramètres, compteurs 7 j, défis et suspensions récents. */
function adminSummary({ config = {}, nowMs = Date.now() } = {}) {
  const db = getDb();
  const since = nowMs - 7 * DAY_MS;
  const c = db.prepare(`
    SELECT SUM(status <> 'shadow') AS issued, SUM(status = 'shadow') AS shadow, SUM(status = 'solved') AS solved,
           SUM(status = 'pending') AS pending, SUM(status = 'cancelled') AS cancelled,
           COALESCE(SUM(fails), 0) AS fails, COALESCE(SUM(expirations), 0) AS expirations,
           COALESCE(SUM(held_clicks), 0) AS heldClicks, COUNT(DISTINCT user_id) AS players
    FROM antibot_challenges WHERE created_ms >= ?
  `).get(since);
  const s = db.prepare(`
    SELECT COUNT(*) AS total, SUM(status = 'active' AND ends_ms > ?) AS active, SUM(status = 'lifted') AS lifted
    FROM antibot_suspensions WHERE starts_ms >= ?
  `).get(nowMs, since);
  const challenges = db.prepare(`
    SELECT c.*, u.username FROM antibot_challenges c LEFT JOIN users u ON u.id = c.user_id ORDER BY c.id DESC LIMIT 50
  `).all().map(_challengeRow);
  const suspensions = db.prepare(`
    SELECT s.*, u.username FROM antibot_suspensions s LEFT JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 50
  `).all().map(r => _suspRow(r, nowMs));
  const testAccounts = db.prepare(`
    SELECT a.user_id, u.username FROM antibot_activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.force_mode = 'enforce'
  `).all().map(r => ({ userId: r.user_id, username: r.username ?? `user_${r.user_id}` }));
  return {
    mode: getGlobalMode(config), modeDefault: RESPONSE_MODE_DEFAULT, params: getParams(config),
    paramDefs: Object.fromEntries(Object.entries(PARAMS).map(([k, d]) => [k, { label: d.label, def: d.def, min: d.range[0], max: d.range[1] }])),
    ladderDefault: LADDER_DEFAULT, testAccounts,
    last7d: { ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v ?? 0])),
      suspensions: s.total ?? 0, activeSuspensions: s.active ?? 0, liftedSuspensions: s.lifted ?? 0 },
    challenges, suspensions,
  };
}

/** Bloc « réponses » de la fiche joueur. */
function playerSection(userId, { config = {}, nowMs = Date.now() } = {}) {
  const db = getDb();
  const s = _load(userId);
  const params = getParams(config);
  const ch = _pendingChallenge(userId);
  const susp = _activeSuspension(userId, nowMs);
  const mode = getUserMode(userId, config);
  return {
    mode, globalMode: getGlobalMode(config), testEnforce: s.force_mode === 'enforce',
    metrics: metrics(s, nowMs), thresholds: { streakMin: params.ab_streak_min, active6hMin: params.ab_active6h_min,
      active24hMin: params.ab_active24h_min, challengeScore: params.ab_challenge_score },
    violationLevel: s.violation_level ?? 0, effectiveViolationLevel: effectiveViolationLevel(s, nowMs, params),
    nextSuspensionMin: params.ab_suspension_ladder[Math.min(effectiveViolationLevel(s, nowMs, params) + 1, params.ab_suspension_ladder.length) - 1],
    lastChallengeAt: _iso(s.last_challenge_ms),
    // Distinction exigée : détecté (défi simulé) / défi imposé / minage refusé / sanction
    state: susp ? 'suspended' : ch ? 'challenge' : 'normal',
    manualRanked: !(mode === 'enforce' && (susp || ch)),
    challenge: ch ? _challengeRow(ch) : null,
    suspension: susp ? _suspRow(susp, nowMs) : null,
    history: {
      challenges: db.prepare('SELECT * FROM antibot_challenges WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(userId).map(_challengeRow),
      suspensions: db.prepare('SELECT * FROM antibot_suspensions WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(userId).map(r => _suspRow(r, nowMs)),
    },
  };
}

module.exports = {
  RESPONSE_MODES, RESPONSE_MODE_DEFAULT, LADDER_DEFAULT, PARAMS, PAUSE_SECS, ACTIVE_CPS,
  PUZZLE_TTL_MS, PUZZLE_MIN_ANSWER_MS, PUZZLE_MAX_PER_WINDOW, SYMBOLS,
  getParams, getGlobalMode, getUserMode, validateConfigValue, effectiveViolationLevel, metrics,
  beforeSave, afterSave, playerStatus, issueChallenge, newPuzzle, markSeen, answer,
  setForceMode, adminIssueChallenge, cancelChallenge, liftSuspension, setViolationLevel, adminSummary, playerSection,
};
