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
 * un défi (jamais une suspension). Récidive (décision du propriétaire du 08/11, option A) : émettre
 * ou résoudre un défi remet à zéro la SEULE série continue ; les cumuls 6 h / 24 h glissants sont
 * conservés (un automate supervisé ne « blanchit » pas son historique en résolvant un défi). Tant
 * qu'un cumul reste au-dessus de son seuil, il redéclenche un défi au plus tôt `ab_cooldown_min`
 * après le précédent (émission, résolution ou annulation). Le temps bloqué pendant un défi ou une
 * suspension (Appliqué) n'est jamais compté comme minage, ni comme pause.
 *
 * Modes (config antibot_response_mode) : off | observe | enforce (Désactivé / Observation / Appliqué),
 * défaut observe : défis « simulés » journalisés, rien n'est montré ni retiré au joueur.
 * Essai sur un compte consentant : force_mode = 'enforce' (admin) ; global off reste prioritaire.
 * Variable d'environnement ANTIBOT=off : tout #25 désactivé.
 */

const crypto = require('crypto');
const { getDb } = require('./db');
const antibot = require('./antibot');
const detector = require('./autoclickDetector');

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
  ab_puzzle_seconds:  { def: 30,  range: [10, 300],  label: 'Temps pour résoudre une énigme visuelle (s)' },
  ab_puzzle_text_seconds: { def: 60, range: [10, 600], label: 'Temps pour résoudre la version accessible (s)' },
};

/** Une pause de 3 min sans minage manuel coupe la série continue. */
const PAUSE_SECS = 180;
/** Cadence humaine minimale supposée pour convertir des clics en temps actif. */
const ACTIVE_CPS = 2;
const BUCKET_MS = 10 * 60_000;
const DAY_MS = 86_400_000;

/**
 * Défi maison : délai minimal de réponse, plafond d'énigmes. Chrono (#25, demande du 08/11) : la
 * durée d'une énigme (ab_puzzle_seconds / ab_puzzle_text_seconds) part de sa demande, faite par le
 * jeu quand la fenêtre est réellement affichée ; le serveur ajoute une marge réseau. Une énigme
 * expirée ne sanctionne jamais : le joueur en demande une autre (plafond par fenêtre de 10 min).
 */
const PUZZLE_GRACE_MS = 5_000;
const PUZZLE_MIN_ANSWER_MS = 1200;
const PUZZLE_WINDOW_MS = 10 * 60_000;
const PUZZLE_MAX_PER_WINDOW = 15;
/** Symboles de l'énigme (noms localisés par le client : antibot.sym_<id>). */
const SYMBOLS = ['pickaxe', 'gem', 'key', 'star', 'heart', 'fire', 'drop', 'moon', 'clover', 'coin', 'bell', 'leaf'];
const SYMBOL_ICONS = { pickaxe: '⛏️', gem: '💎', key: '🔑', star: '⭐', heart: '❤️', fire: '🔥', drop: '💧', moon: '🌙', clover: '🍀', coin: '🪙', bell: '🔔', leaf: '🍃' };
const GRID_SIZE = 6;

/**
 * Recette autoclicker (#25, 07/11) : seuil « minage continu » raccourci pour le SEUL compte en
 * essai Appliqué, pour vérifier défi et gel du classement sans attendre 60 min ni toucher au
 * réglage global. Garde-fous : borné 1–10 min, ignoré hors essai, expire seul après 2 h,
 * effacé par la fin de l'essai.
 */
const TEST_STREAK_RANGE = [1, 10];
const TEST_STREAK_TTL_MS = 2 * 3600_000;
/** Au-delà, la fiche dit « aucune mesure récente » (le jeu n'envoie rien : onglet fermé, hors ligne…). */
const STALE_MEASURE_MS = 15 * 60_000;
const GRID_TARGETS = 2;
/** Indice de reprise après un défi : clics minimaux d'une fenêtre de sauvegarde pour parler de reprise. */
const RESUME_MIN_CLICKS = 5;

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
      force_mode, violation_level, last_violation_ms, last_challenge_ms, rebase_clicks, rebase_blocks, tel_h, last_window, test_streak_min, test_started_ms, test_snapshot, rebase_ms, fast_state, updated_ms)
    VALUES (@user_id, @season_id, @last_ms, @last_clicks, @last_blocks, @streak_active_s, @pause_s, @buckets,
      @force_mode, @violation_level, @last_violation_ms, @last_challenge_ms, @rebase_clicks, @rebase_blocks, @tel_h, @last_window, @test_streak_min, @test_started_ms, @test_snapshot, @rebase_ms, @fast_state, @updated_ms)
    ON CONFLICT(user_id) DO UPDATE SET season_id = excluded.season_id, last_ms = excluded.last_ms,
      last_clicks = excluded.last_clicks, last_blocks = excluded.last_blocks, streak_active_s = excluded.streak_active_s,
      pause_s = excluded.pause_s, buckets = excluded.buckets, force_mode = excluded.force_mode,
      violation_level = excluded.violation_level, last_violation_ms = excluded.last_violation_ms,
      last_challenge_ms = excluded.last_challenge_ms, rebase_clicks = excluded.rebase_clicks,
      rebase_blocks = excluded.rebase_blocks, tel_h = excluded.tel_h, last_window = excluded.last_window,
      test_streak_min = excluded.test_streak_min, test_started_ms = excluded.test_started_ms,
      test_snapshot = excluded.test_snapshot, rebase_ms = excluded.rebase_ms, fast_state = excluded.fast_state, updated_ms = excluded.updated_ms
  `).run({
    user_id: userId, season_id: s.season_id ?? null, last_ms: s.last_ms ?? null, last_clicks: s.last_clicks ?? null,
    last_blocks: s.last_blocks ?? null, streak_active_s: s.streak_active_s ?? 0, pause_s: s.pause_s ?? 0,
    buckets: JSON.stringify(s.buckets ?? []), force_mode: s.force_mode ?? null, violation_level: s.violation_level ?? 0,
    last_violation_ms: s.last_violation_ms ?? null, last_challenge_ms: s.last_challenge_ms ?? null,
    rebase_clicks: s.rebase_clicks ?? null, rebase_blocks: s.rebase_blocks ?? null,
    tel_h: s.tel ? JSON.stringify(s.tel) : null,
    last_window: s.last_window ? JSON.stringify(s.last_window) : null,
    test_streak_min: s.test_streak_min ?? null, test_started_ms: s.test_started_ms ?? null,
    test_snapshot: s.test_snapshot ? JSON.stringify(s.test_snapshot) : null, rebase_ms: s.rebase_ms ?? null,
    fast_state: s.fast ? JSON.stringify(s.fast) : null, updated_ms: s.updated_ms ?? Date.now(),
  });
}

function _blank(userId) {
  return { user_id: userId, season_id: null, last_ms: null, last_clicks: null, last_blocks: null, streak_active_s: 0,
    pause_s: 0, buckets: [], force_mode: null, violation_level: 0, last_violation_ms: null, last_challenge_ms: null,
    rebase_clicks: null, rebase_blocks: null, rebase_ms: null, tel: null, last_window: null, test_streak_min: null, test_started_ms: null, test_snapshot: null, fast: null };
}

function _load(userId) {
  const row = _state(userId);
  if (!row) return _blank(userId);
  const json = raw => { try { return raw ? JSON.parse(raw) : null; } catch (_) { return null; } };
  return { ...row, buckets: _buckets(row), tel: json(row.tel_h), last_window: json(row.last_window), test_snapshot: json(row.test_snapshot), fast: json(row.fast_state) };
}

/** Mode effectif pour un joueur : global, sauf essai « Appliqué » sur ce compte (jamais si global off). */
function getUserMode(userId, config = {}, env = process.env) {
  const g = getGlobalMode(config, env);
  if (g === 'off') return 'off';
  const row = _state(userId);
  return row?.force_mode === 'enforce' ? 'enforce' : g;
}

/** Seuil court d'essai effectif (minutes) ou null : uniquement en essai Appliqué, avant expiration. */
function testStreakMin(s, nowMs) {
  if (s?.force_mode !== 'enforce' || s.test_streak_min == null || !s.test_started_ms) return null;
  return nowMs - s.test_started_ms < TEST_STREAK_TTL_MS ? s.test_streak_min : null;
}

/**
 * Recette autoclicker en cours sur ce compte (essai Appliqué + seuil court actif) : le jeu récupère
 * seul la récompense d'un coffre pour que l'autoclicker à position fixe ne soit pas interrompu.
 * Récompense et taux de coffres inchangés ; aucun effet hors de ce compte ni après l'essai.
 */
function recipeActive(userId, config = {}, nowMs = Date.now()) {
  if (getGlobalMode(config) === 'off') return false;
  const row = _state(userId);
  return !!row && testStreakMin(row, nowMs) != null;
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
function _measure(s, seasonId, claimedClicks, claimedBlocks, nowMs, { frozen = false } = {}) {
  const rebase = s.season_id !== seasonId || s.last_ms == null || s.last_clicks == null || claimedClicks < s.last_clicks;
  const dClicks = rebase ? 0 : claimedClicks - s.last_clicks;
  const dt = rebase ? 0 : Math.max(0, (nowMs - s.last_ms) / 1000);
  // Pendant un défi / une suspension (Appliqué) : la base avance, rien n'est compté (ni minage, ni pause)
  const active = frozen ? 0 : Math.min(dt, dClicks / ACTIVE_CPS);
  const idle = dt - active;
  // Changement de saison, compteur inférieur (nouvel appareil, réinitialisation) : fenêtre non
  // mesurée, cumuls 6 h / 24 h conservés (fenêtres de temps, pas de saison) ; seule une vraie
  // absence (≥ 3 min depuis la dernière mesure) coupe la série
  if (rebase && (s.last_ms == null || nowMs - s.last_ms >= PAUSE_SECS * 1000)) { s.streak_active_s = 0; s.pause_s = 0; s.tel = null; }
  if (!frozen) {
    if (idle >= dt / 2 && dt > 0) s.pause_s = (s.pause_s ?? 0) + idle; else if (dt > 0) s.pause_s = 0;
    if (s.pause_s >= PAUSE_SECS) { s.streak_active_s = 0; s.tel = null; }
  }
  s.streak_active_s = (s.streak_active_s ?? 0) + active;
  if (active > 0) {
    const key = Math.floor(nowMs / BUCKET_MS) * BUCKET_MS;
    const last = s.buckets[s.buckets.length - 1];
    if (last && last[0] === key) last[1] += active; else s.buckets.push([key, active]);
  }
  s.buckets = s.buckets.filter(([t]) => t + BUCKET_MS > nowMs - DAY_MS).map(([t, v]) => [t, Math.round(v * 10) / 10]);
  s.season_id = seasonId; s.last_ms = nowMs; s.last_clicks = claimedClicks; s.last_blocks = claimedBlocks;
  // Dernière fenêtre mesurée (fiche admin : « ce que le serveur a vu »)
  s.last_window = { atMs: nowMs, secs: Math.round(dt * 10) / 10, clicks: dClicks, activeSecs: Math.round(active * 10) / 10, ...(frozen ? { frozen: true } : {}) };
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
      startsAt: _iso(susp.starts_ms), endsAt: _iso(susp.ends_ms), reason: _json(susp.reason)?.code ?? null } : null,
    manualRanked: false,   // clics manuels non crédités au classement tant que l'état dure
  };
}


/**
 * Suspension du minage manuel au palier suivant (après décroissance). Raisons : clics pendant un
 * défi affiché (#25) ou automatisation corroborée revue juste après une vérification résolue (#91).
 */
function _startSuspension(userId, seasonId, s, { challengeId, reason, params, nowMs, ip }) {
  const level = effectiveViolationLevel(s, nowMs, params) + 1;
  const ladder = params.ab_suspension_ladder;
  const minutes = ladder[Math.min(level, ladder.length) - 1];
  const id = getDb().prepare(`
    INSERT INTO antibot_suspensions (user_id, season_id, challenge_id, level, starts_ms, ends_ms, status, origin, reason)
    VALUES (?, ?, ?, ?, ?, ?, 'active', 'auto', ?)
  `).run(userId, seasonId, challengeId, level, nowMs, nowMs + minutes * 60_000, JSON.stringify(reason)).lastInsertRowid;
  s.violation_level = level; s.last_violation_ms = nowMs;
  const { code, ...rest } = reason;
  antibot.logSecurityEvent('suspension_started', { userId, seasonId, ip,
    details: { suspensionId: Number(id), challengeId, level, minutes, reason: code, ...rest, applied: true } });
  return { level, minutes };
}

// ── Détection rapide des autoclickers (#91) ──────────────────────────────────

/** Fenêtres serveur conservées pour la cadence stable (≈ 2 min). */
const FAST_WINDOW_KEEP_MS = 120_000;

/**
 * Qualifie la fenêtre de sauvegarde (server/autoclickDetector.js) et garde l'état pour la fiche
 * admin. Pendant un défi ou une suspension (Appliqué), rien n'est évalué et la cadence repart.
 */
function _fastEvaluate(s, tel, m, config, nowMs, frozen) {
  const settings = detector.getSettings(config);
  if (settings.ab_fast_mode === 'off') return null;
  const st = s.fast && typeof s.fast === 'object' ? s.fast : {};
  let w = frozen ? [] : (Array.isArray(st.w) ? st.w : []).filter(x => Array.isArray(x) && nowMs - x[0] < FAST_WINDOW_KEEP_MS);
  if (!frozen && m.dt > 0) w.push([nowMs, Math.round(m.dt * 10) / 10, m.dClicks]);
  w = w.slice(-6);
  const v = frozen || !tel ? null : detector.evaluate(tel, w, settings);
  const last = v ? { atMs: nowMs, regular: v.regular, regularKnown: v.regularKnown, fixed: v.fixed, still: v.still,
    untrusted: v.untrusted, steady: v.steady, automation: v.automation, evidence: v.evidence } : (st.last ?? null);
  // autoSince : fenêtres corroborées consécutives depuis la dernière vérification (règle 3)
  s.fast = { w, last, lastAutomationMs: v?.automation ? nowMs : (st.lastAutomationMs ?? null),
    detections: (st.detections ?? 0) + (v?.automation ? 1 : 0),
    autoSince: v ? (v.automation ? (st.autoSince ?? 0) + 1 : 0) : (st.autoSince ?? 0) };
  return v ? { ...v, settings } : null;
}

/** Dernière vérification #91 (même pixel ou automatisation), résolue (Appliqué) ou simulée (Observation), depuis `sinceMs`. */
function _lastFastChallenge(userId, mode, sinceMs) {
  return getDb().prepare(`
    SELECT id, resolved_ms FROM antibot_challenges
    WHERE user_id = ? AND status = ? AND resolved_ms >= ?
      AND (reasons LIKE '%"autoclick_corroborated"%' OR reasons LIKE '%"same_pixel"%')
    ORDER BY id DESC LIMIT 1
  `).get(userId, mode === 'enforce' ? 'solved' : 'shadow', sinceMs) ?? null;
}

// ── Pipeline de sauvegarde ────────────────────────────────────────────────────

/**
 * Avant la validation de la sauvegarde : mesure l'activité, confirme une violation éventuelle,
 * et dit si les clics manuels de cette fenêtre doivent être retenus hors classement.
 * @returns {{ mode, hold: boolean, rebase: { clicks, blocks } | null, metrics, violation: object|null }}
 */
function beforeSave(userId, seasonId, { claimedClicks, claimedBlocks, telemetry = null, config = {}, nowMs = Date.now(), ip = null } = {}) {
  const mode = getUserMode(userId, config);
  if (mode === 'off') return { mode, hold: false, held: null, rebase: null, metrics: null, violation: null, signals: [], fast: null };
  const params = getParams(config);
  const db = getDb();
  return db.transaction(() => {
    const s = _load(userId);
    const prevStreak = s.streak_active_s ?? 0;
    const frozen = mode === 'enforce' && !!(_pendingChallenge(userId) || _activeSuspension(userId, nowMs));
    const m = _measure(s, seasonId, claimedClicks, claimedBlocks, nowMs, { frozen });
    const signals = _activitySignals(s, prevStreak, telemetry, params);
    const fast = _fastEvaluate(s, telemetry, m, config, nowMs, frozen);
    let hold = false;
    let rebase = null;
    let violation = null;
    let held = null;
    if (mode === 'enforce') {
      const ch = _pendingChallenge(userId);
      let susp = _activeSuspension(userId, nowMs);
      // Violation confirmée : clics déclarés au-delà du compteur relevé quand le défi était affiché
      if (ch && ch.seen_ms && !susp && Number.isSafeInteger(ch.seen_clicks) && claimedClicks - ch.seen_clicks >= params.ab_violation_clicks) {
        const clicks = claimedClicks - ch.seen_clicks;
        violation = _startSuspension(userId, seasonId, s, { challengeId: ch.id, params, nowMs, ip,
          reason: { code: 'clicks_during_challenge', clicksAfterShown: clicks } });
        // Le défi reste à résoudre après la suspension ; il devra être réaffiché (nouveau relevé)
        db.prepare('UPDATE antibot_challenges SET seen_ms = NULL, seen_clicks = NULL, violations = violations + 1 WHERE id = ?').run(ch.id);
        susp = _activeSuspension(userId, nowMs);
      }
      if (ch || susp) {
        hold = true;
        held = { challengeId: ch?.id ?? null, suspensionId: susp?.id ?? null };
        rebase = { clicks: claimedClicks, blocks: claimedBlocks };
        if (m.dClicks > 0) {
          db.prepare('UPDATE antibot_challenges SET held_clicks = held_clicks + ? WHERE id = ?').run(m.dClicks, ch?.id ?? -1);
          if (susp) db.prepare('UPDATE antibot_suspensions SET held_clicks = held_clicks + ? WHERE id = ?').run(m.dClicks, susp.id);
        }
      } else if (s.rebase_clicks != null) {
        // Première sauvegarde après un défi résolu : seuls les clics postérieurs à la résolution comptent
        // sinceMs : la fenêtre anti-autoclic de la reprise part de la résolution, pas de la dernière
        // sauvegarde retenue (des clics non déclarés pendant le défi ne se diluent pas dans sa durée)
        rebase = { clicks: Math.min(claimedClicks, s.rebase_clicks), blocks: Math.min(claimedBlocks, s.rebase_blocks ?? claimedBlocks),
          sinceMs: s.rebase_ms ?? null };
        s.rebase_clicks = null; s.rebase_blocks = null; s.rebase_ms = null;
      }
    }
    s.updated_ms = nowMs;
    _saveState(userId, s);
    return { mode, hold, held, rebase, metrics: metrics(s, nowMs), violation, dClicks: m.dClicks, signals, fast };
  })();
}

/**
 * Sauvegarde retenue pendant un défi ou une suspension (appelée après la validation des blocs) :
 * compte la sauvegarde et, si des blocs validés avaient tout de même progressé (aucun chemin
 * connu ne le permet), les retire de nouveau et le journalise. Rend le nombre de blocs validés à garder.
 */
function recordHoldSave(userId, seasonId, held, { before, after, nowMs = Date.now(), ip = null } = {}) {
  if (!held) return after;
  const clamped = Math.max(0, (after ?? 0) - (before ?? 0));
  const db = getDb();
  if (held.challengeId != null) {
    db.prepare('UPDATE antibot_challenges SET pending_saves = pending_saves + 1, pending_last_ms = ?, clamped_blocks = clamped_blocks + ? WHERE id = ?')
      .run(nowMs, clamped, held.challengeId);
  }
  if (clamped > 0) {
    antibot.logSecurityEvent('freeze_clamped', { userId, seasonId, ip,
      details: { challengeId: held.challengeId, suspensionId: held.suspensionId, before, after, clamped } });
  }
  return clamped > 0 ? before : after;
}

/** Déclencheurs d'un défi (au moins un) — jamais une sanction. */
function _triggers(s, risk, params, nowMs, fast = null) {
  const m = metrics(s, nowMs);
  const out = [];
  const cooling = s.last_challenge_ms && nowMs - s.last_challenge_ms < params.ab_cooldown_min * 60_000;
  // #91 : automatisation corroborée (régularité machine + même pixel + 3ᵉ indice) → tout de suite ;
  // même pixel seul → au plus une vérification par délai minimal (joueur immobile : pas de boucle)
  if (fast?.automation) {
    out.push({ code: 'autoclick_corroborated', value: fast.evidence.samePixelRun, threshold: fast.evidence.samePixelThreshold,
      signals: ['regular', 'same_pixel', ...(fast.still ? ['still'] : []), ...(fast.untrusted ? ['untrusted'] : []), ...(fast.steady ? ['steady'] : [])],
      evidence: fast.evidence });
  } else if (fast?.samePixel && fast.settings.ab_same_pixel_mode === 'on' && !cooling) {
    out.push({ code: 'same_pixel', value: fast.evidence.samePixelRun, threshold: fast.evidence.samePixelThreshold, evidence: fast.evidence });
  }
  if (risk && risk.score >= params.ab_challenge_score && !cooling) out.push({ code: 'risk_score', value: Math.round(risk.score * 10) / 10, threshold: params.ab_challenge_score });
  const testMin = testStreakMin(s, nowMs);
  const streakMin = testMin ?? params.ab_streak_min;
  if (m.streakMin >= streakMin) out.push({ code: 'continuous_mining', value: m.streakMin, threshold: streakMin, ...(testMin != null ? { test: true } : {}) });
  // Cumuls glissants conservés après un défi : au-dessus du seuil, au plus un défi par délai minimal
  if (m.active6hMin >= params.ab_active6h_min && !cooling) out.push({ code: 'active_6h', value: m.active6hMin, threshold: params.ab_active6h_min });
  if (m.active24hMin >= params.ab_active24h_min && !cooling) out.push({ code: 'active_24h', value: m.active24hMin, threshold: params.ab_active24h_min });
  return { reasons: out, metrics: m };
}

/** Option A (08/11) : seule la série continue repart de zéro ; cumuls 6 h / 24 h (buckets) conservés. */
function _resetStreak(s, nowMs) {
  s.streak_active_s = 0; s.pause_s = 0; s.tel = null; s.last_challenge_ms = nowMs;
  if (s.fast) s.fast.autoSince = 0;
}

/**
 * Crée un défi (enforce : en attente, minage manuel non crédité jusqu'à résolution ;
 * observe : « simulé », journalisé et résolu d'office pour mesurer la fréquence réelle).
 */
function issueChallenge(userId, seasonId, { mode, reasons, metrics: m, origin = 'auto', nowMs = Date.now(), ip = null }) {
  const db = getDb();
  const status = mode === 'enforce' ? 'pending' : 'shadow';
  const id = Number(db.prepare(`
    INSERT INTO antibot_challenges (user_id, season_id, status, mode, origin, reasons, created_ms, resolved_ms, issued_snapshot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, seasonId, status, mode, origin, JSON.stringify({ reasons, metrics: m }), nowMs, status === 'shadow' ? nowMs : null,
    // Relevé à l'émission (Appliqué) : base de la preuve du gel jusqu'à la résolution
    status === 'pending' ? JSON.stringify(progressSnapshot(userId, seasonId, nowMs)) : null).lastInsertRowid);
  const ev = { userId, seasonId, ip, details: { challengeId: id, origin, reasons: reasons.map(r => r.code), metrics: m, applied: mode === 'enforce' } };
  if (mode === 'enforce') antibot.logSecurityEvent('challenge_issued', ev);
  else antibot.logSecurityEvent('challenge_shadow', ev);
  return id;
}

/**
 * Après la validation : décide d'un défi selon les mesures et le score de risque à jour.
 * @returns {object|null} État joueur à renvoyer (null : rien à afficher)
 */
function afterSave(userId, seasonId, { config = {}, nowMs = Date.now(), ip = null, fast = null } = {}) {
  const mode = getUserMode(userId, config);
  if (mode === 'off') return null;
  const params = getParams(config);
  const db = getDb();
  db.transaction(() => {
    // Un défi réel en attente (Appliqué) ne bloque pas la mesure en Observation (mode repassé en observe)
    if (mode === 'enforce' && (_pendingChallenge(userId) || _activeSuspension(userId, nowMs))) return;
    const s = _load(userId);
    if (s.season_id !== seasonId) return;
    // #91 règle 3 : automatisation corroborée peu après une vérification #91 résolue → suspension, mais
    // seulement après 2 fenêtres consécutives (≈ 24 s) ; la 1ʳᵉ attend sa confirmation
    const recent = fast?.automation && fast.settings.ab_fast_suspend === 'on'
      ? _lastFastChallenge(userId, mode, nowMs - fast.settings.ab_fast_repeat_min * 60_000) : null;
    const confirmed = !!recent && (s.fast?.autoSince ?? 0) >= detector.REPEAT_WINDOWS;
    let { reasons, metrics: m } = _triggers(s, antibot.getRisk(userId, seasonId, nowMs), params, nowMs, fast);
    if (recent && !confirmed) reasons = reasons.filter(r => r.code !== 'autoclick_corroborated' && r.code !== 'same_pixel');
    if (!reasons.length) return;
    const repeat = confirmed ? recent : null;
    const chId = issueChallenge(userId, seasonId, { mode, reasons, metrics: m, nowMs, ip });
    if (repeat) {
      const reason = { code: 'autoclick_repeat', previousChallengeId: repeat.id,
        minutesSinceSolved: Math.round((nowMs - repeat.resolved_ms) / 6000) / 10, evidence: fast.evidence };
      if (mode === 'enforce') _startSuspension(userId, seasonId, s, { challengeId: chId, reason, params, nowMs, ip });
      else antibot.logSecurityEvent('suspension_shadow', { userId, seasonId, ip,
        details: { challengeId: chId, ...reason, wouldBeMinutes: params.ab_suspension_ladder[Math.min(effectiveViolationLevel(s, nowMs, params) + 1, params.ab_suspension_ladder.length) - 1], applied: false } });
    }
    _resetStreak(s, nowMs);
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
function newPuzzle(userId, challengeId, { kind = 'grid', config = {}, nowMs = Date.now() } = {}) {
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
  const params = getParams(config);
  const seconds = kind === 'text' ? params.ab_puzzle_text_seconds : params.ab_puzzle_seconds;
  const expiresMs = nowMs + seconds * 1000 + PUZZLE_GRACE_MS;
  db.prepare(`
    UPDATE antibot_challenges SET puzzle_id = ?, puzzle_hash = ?, puzzle_kind = ?, puzzle_issued_ms = ?, puzzle_expires_ms = ?,
      puzzle_window_ms = ?, puzzle_count = ?, expirations = expirations + ? WHERE id = ?
  `).run(id, _hash(id, answer), puzzle.kind, nowMs, expiresMs, windowStart, count + 1, expired, ch.id);
  // seconds : durée affichée par le chrono (relative, insensible à l'horloge du navigateur)
  return { challengeId: ch.id, puzzleId: id, expiresAt: _iso(expiresMs), seconds, ...puzzle };
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
    db.prepare(`UPDATE antibot_challenges SET status = 'solved', resolved_ms = ?, resolved_snapshot = ? WHERE id = ?`)
      .run(nowMs, ch.season_id != null ? JSON.stringify(progressSnapshot(userId, ch.season_id, nowMs)) : null, ch.id);
    const s = _load(userId);
    _resetStreak(s, nowMs);
    // Seuls les clics postérieurs à la résolution compteront (jamais en deçà du dernier relevé serveur)
    const clicks = Number.isSafeInteger(manualClicks) && manualClicks >= 0 ? manualClicks : null;
    const blocks = Number.isSafeInteger(manualBlocks) && manualBlocks >= 0 ? manualBlocks : null;
    s.rebase_clicks = Math.max(clicks ?? 0, s.last_clicks ?? 0);
    s.rebase_blocks = Math.max(blocks ?? 0, s.last_blocks ?? 0);
    s.rebase_ms = nowMs;
    // La mesure suivante part de la résolution : ni le temps bloqué ni les clics d'avant ne comptent
    if (s.season_id === ch.season_id && s.last_ms != null) { s.last_ms = nowMs; s.last_clicks = s.rebase_clicks; s.last_blocks = s.rebase_blocks; }
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
  // Fin d'essai : le seuil court et le relevé de départ disparaissent avec lui
  if (!enforce) { s.test_streak_min = null; s.test_started_ms = null; s.test_snapshot = null; }
  s.updated_ms = nowMs;
  _saveState(userId, s);
  return s.force_mode;
}

/**
 * Relevé de progression classée d'un compte pour une saison : blocs manuels validés (ceux du
 * classement), clics manuels déclarés et rang par blocs manuels (#73). Lecture seule.
 */
function progressSnapshot(userId, seasonId, nowMs = Date.now()) {
  if (seasonId == null) return null;
  const db = getDb();
  const r = db.prepare('SELECT manual_blocks, effective_manual_blocks, manual_clicks FROM season_rankings WHERE season_id = ? AND user_id = ?').get(seasonId, userId);
  const validated = r ? Math.min(r.effective_manual_blocks ?? r.manual_blocks ?? 0, r.manual_blocks ?? 0) : 0;
  const ahead = db.prepare(`
    SELECT COUNT(*) AS n FROM season_rankings
    WHERE season_id = ? AND user_id <> ? AND MIN(COALESCE(effective_manual_blocks, manual_blocks, 0), COALESCE(manual_blocks, 0)) > ?
  `).get(seasonId, userId, validated).n;
  return { atMs: nowMs, seasonId, manualBlocks: validated, manualClicks: r?.manual_clicks ?? 0, rank: r ? ahead + 1 : null };
}

/**
 * Active (minutes) ou retire (null) le seuil court d'essai sur le compte en essai Appliqué.
 * L'activation remet la série à zéro et relève la progression classée de départ.
 */
function setTestThreshold(userId, minutes, { seasonId = null, nowMs = Date.now() } = {}) {
  const s = _load(userId);
  if (minutes == null) {
    s.test_streak_min = null; s.test_started_ms = null; s.test_snapshot = null;
  } else {
    if (s.force_mode !== 'enforce') return { error: 'Lancez d\'abord l\'essai sur ce compte (étape 2).' };
    const [min, max] = TEST_STREAK_RANGE;
    if (!(Number.isFinite(minutes) && minutes >= min && minutes <= max)) return { error: `Seuil d'essai de ${min} à ${max} minutes attendu.` };
    s.test_streak_min = minutes; s.test_started_ms = nowMs;
    s.test_snapshot = progressSnapshot(userId, seasonId, nowMs);
    s.streak_active_s = 0; s.pause_s = 0;
  }
  s.updated_ms = nowMs;
  _saveState(userId, s);
  return { testStreakMin: s.test_streak_min, snapshot: s.test_snapshot };
}

/**
 * « Ce que le serveur a vu » (fiche admin) : distingue aucune mesure reçue, activité mesurée sous
 * le seuil, anomalie journalisée, défi simulé (Observation) et défi réel, sur 24 h.
 */
function observation(userId, s, params, mode, nowMs) {
  const db = getDb();
  const since = nowMs - DAY_MS;
  const m = metrics(s, nowMs);
  const testMin = testStreakMin(s, nowMs);
  const streakThreshold = testMin ?? params.ab_streak_min;
  const sinceSql = new Date(since).toISOString().replace('T', ' ').slice(0, 19);
  const anomalyTypes = antibot.EVENT_GROUPS.player;
  const an = db.prepare(`
    SELECT COUNT(*) AS n, MAX(created_at) AS last FROM security_events
    WHERE user_id = ? AND created_at >= ? AND type IN (${anomalyTypes.map(() => '?').join(',')})
  `).get(userId, sinceSql, ...anomalyTypes);
  const lastAn = an.n ? db.prepare(`
    SELECT type FROM security_events WHERE user_id = ? AND created_at >= ? AND type IN (${anomalyTypes.map(() => '?').join(',')})
    ORDER BY id DESC LIMIT 1
  `).get(userId, sinceSql, ...anomalyTypes) : null;
  const ch = db.prepare(`
    SELECT SUM(status = 'shadow') AS shadow, SUM(status <> 'shadow' AND origin <> 'admin') AS real,
           MAX(CASE WHEN status = 'shadow' THEN created_ms END) AS lastShadow
    FROM antibot_challenges WHERE user_id = ? AND created_ms >= ?
  `).get(userId, since);
  const lastMs = s.last_ms ?? null;
  const w = s.last_window;
  return {
    lastMeasureAt: _iso(lastMs),
    stale: !lastMs || nowMs - lastMs > STALE_MEASURE_MS,
    lastWindow: w ? { at: _iso(w.atMs), secs: w.secs, clicks: w.clicks, activeSecs: w.activeSecs,
      cps: w.secs > 0 ? Math.round(w.clicks / w.secs * 10) / 10 : null } : null,
    streak: { valueMin: m.streakMin, thresholdMin: streakThreshold, testThreshold: testMin != null,
      pct: Math.min(100, Math.round(m.streakMin / streakThreshold * 100)) },
    active6h: { valueMin: m.active6hMin, thresholdMin: params.ab_active6h_min },
    active24h: { valueMin: m.active24hMin, thresholdMin: params.ab_active24h_min },
    anomalies24h: an.n ?? 0, lastAnomaly: lastAn ? { type: lastAn.type, at: an.last ? an.last.replace(' ', 'T') + 'Z' : null } : null,
    shadowChallenges24h: ch.shadow ?? 0, lastShadowAt: _iso(ch.lastShadow),
    realChallenges24h: ch.real ?? 0,
    mode,
  };
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
  const ch = getDb().prepare(`SELECT user_id, season_id FROM antibot_challenges WHERE id = ? AND status = 'pending'`).get(id);
  if (!ch) return false;
  const snap = ch.season_id != null ? JSON.stringify(progressSnapshot(ch.user_id, ch.season_id, nowMs)) : null;
  const r = getDb().prepare(`UPDATE antibot_challenges SET status = 'cancelled', resolved_ms = ?, resolved_snapshot = ?, admin_note = ? WHERE id = ? AND status = 'pending'`)
    .run(nowMs, snap, note ? String(note).slice(0, 200) : null, id);
  if (r.changes > 0) {
    // Délai minimal avant un nouveau défi de cumul : compté depuis l'annulation ; série repartie de zéro
    const s = _load(ch.user_id);
    _resetStreak(s, nowMs);
    if (s.last_ms != null) s.last_ms = Math.max(s.last_ms, nowMs);
    s.updated_ms = nowMs;
    _saveState(ch.user_id, s);
  }
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
    fails: r.fails, expirations: r.expirations, heldClicks: r.held_clicks, violations: r.violations,
    freeze: r.mode === 'enforce' && r.status !== 'shadow' ? _freezeProof(r) : null };
}

const _json = raw => { try { return raw ? JSON.parse(raw) : null; } catch (_) { return null; } };

/**
 * Preuve du gel d'un défi réel : relevés à l'émission et à la résolution (heure serveur), sauvegardes
 * retenues pendant le défi, clics retenus, blocs refusés par le garde-fou. delta = blocs validés
 * gagnés entre émission et résolution (attendu : 0). En attente : comparé à maintenant.
 * Défis antérieurs au 08/11 : pas de relevé (verdict « unknown »).
 */
function _freezeProof(r, nowMs = Date.now()) {
  const issued = _json(r.issued_snapshot);
  if (!issued) return { verdict: 'unknown', pendingSaves: r.pending_saves ?? 0, clampedBlocks: r.clamped_blocks ?? 0 };
  const end = r.status === 'pending' ? progressSnapshot(r.user_id, r.season_id, nowMs) : _json(r.resolved_snapshot);
  const delta = end ? end.manualBlocks - issued.manualBlocks : null;
  return {
    verdict: delta == null ? 'unknown' : delta <= 0 ? 'frozen' : 'leak',
    open: r.status === 'pending',
    issued: { ...issued, at: _iso(issued.atMs) },
    end: end ? { ...end, at: _iso(end.atMs) } : null,
    deltaBlocks: delta, deltaClicks: end ? end.manualClicks - issued.manualClicks : null,
    pendingSaves: r.pending_saves ?? 0, lastHeldSaveAt: _iso(r.pending_last_ms), clampedBlocks: r.clamped_blocks ?? 0,
  };
}

/**
 * Reprise après le dernier défi réel résolu (indice de bot supervisé, AUCUN effet) : délai avant le
 * premier clic manuel déclaré après la résolution, cadence de cette reprise, clics non fiables
 * (isTrusted=false) journalisés depuis, défis réels résolus sur 24 h. Lecture seule.
 */
function recidivism(userId, nowMs = Date.now()) {
  const db = getDb();
  const solved24h = db.prepare(`SELECT COUNT(*) AS n FROM antibot_challenges WHERE user_id = ? AND status = 'solved' AND mode = 'enforce' AND resolved_ms >= ?`)
    .get(userId, nowMs - DAY_MS).n;
  const last = db.prepare(`SELECT id, season_id, resolved_ms FROM antibot_challenges WHERE user_id = ? AND status = 'solved' AND mode = 'enforce' ORDER BY resolved_ms DESC LIMIT 1`).get(userId);
  if (!last) return { solved24h, last: null };
  const base = db.prepare(`SELECT manual_clicks FROM antibot_save_samples WHERE user_id = ? AND season_id = ? AND at_ms <= ? ORDER BY at_ms DESC LIMIT 1`)
    .get(userId, last.season_id, last.resolved_ms);
  // Reprise = première fenêtre de sauvegarde après la résolution avec au moins 5 clics (un clic en vol ne compte pas)
  let next = null;
  let prev = base ? { at_ms: last.resolved_ms, manual_clicks: base.manual_clicks } : null;
  if (base) {
    const rows = db.prepare(`SELECT at_ms, manual_clicks FROM antibot_save_samples WHERE user_id = ? AND season_id = ? AND at_ms > ? ORDER BY at_ms LIMIT 500`)
      .all(userId, last.season_id, last.resolved_ms);
    for (const r of rows) {
      if (r.manual_clicks - prev.manual_clicks >= RESUME_MIN_CLICKS) { next = r; break; }
      prev = r;
    }
  }
  if (!next) prev = null;
  const winS = prev ? (next.at_ms - prev.at_ms) / 1000 : 0;
  const sinceSql = new Date(last.resolved_ms).toISOString().replace('T', ' ').slice(0, 19);
  const untrusted = db.prepare(`SELECT COUNT(*) AS n FROM security_events WHERE user_id = ? AND type = 'untrusted_clicks' AND created_at >= ?`).get(userId, sinceSql).n;
  return {
    solved24h,
    last: { challengeId: last.id, resolvedAt: _iso(last.resolved_ms),
      resumedAfterSecs: next ? Math.max(0, Math.round((next.at_ms - last.resolved_ms) / 1000)) : null,
      resumeCps: prev && winS > 0 ? Math.round((next.manual_clicks - prev.manual_clicks) / winS * 10) / 10 : null,
      untrustedSince: untrusted },
  };
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
    fast: detector.getSettings(config),
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
  const testMin = testStreakMin(s, nowMs);
  return {
    mode, globalMode: getGlobalMode(config), testEnforce: s.force_mode === 'enforce',
    // Recette autoclicker : seuil court d'essai, relevé de départ et relevé actuel (preuve de gel)
    testThreshold: testMin != null ? { minutes: testMin, startedAt: _iso(s.test_started_ms),
      expiresAt: _iso(s.test_started_ms + TEST_STREAK_TTL_MS),
      before: s.test_snapshot ?? null, now: progressSnapshot(userId, s.test_snapshot?.seasonId ?? s.season_id, nowMs) } : null,
    observation: observation(userId, s, params, mode, nowMs),
    recidivism: recidivism(userId, nowMs),
    // #91 : dernier verdict de la détection rapide (preuves lisibles dans la fiche)
    fast: { settings: detector.getSettings(config), last: s.fast?.last ? { ...s.fast.last, at: _iso(s.fast.last.atMs) } : null,
      lastAutomationAt: _iso(s.fast?.lastAutomationMs), detections: s.fast?.detections ?? 0 },
    progressNow: s.season_id != null ? progressSnapshot(userId, s.season_id, nowMs) : null,
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
  PUZZLE_GRACE_MS, PUZZLE_MIN_ANSWER_MS, PUZZLE_MAX_PER_WINDOW, SYMBOLS, TEST_STREAK_RANGE, TEST_STREAK_TTL_MS,
  getParams, getGlobalMode, getUserMode, validateConfigValue, effectiveViolationLevel, metrics,
  beforeSave, recordHoldSave, afterSave, playerStatus, issueChallenge, newPuzzle, markSeen, answer,
  setForceMode, setTestThreshold, progressSnapshot, recidivism, recipeActive, testStreakMin, adminIssueChallenge, cancelChallenge, liftSuspension, setViolationLevel, adminSummary, playerSection,
};
