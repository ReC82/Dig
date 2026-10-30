/**
 * server/seasons.js
 * Logique métier des saisons : rotation automatique, ranking, attribution de ligue.
 */

const db = require('./db');
const {
  getDb,
  getActiveSeason, getSeasonById, createSeason, updateSeason,
  getAdminConfig, getAllLeagues, getLeagueById, getLeagueByLevel, getHighestLeague,
  getLeagueForRank, getLowestLeague, createLeague,
  getUserLeague, getUserById, setUserLeague, getAllActivePlayersInLeague,
  upsertSeasonRanking,
  getSeasonLeaderboard, countSeasonActivePlayers, getPlayerSeasonRank,
  getLeagueLeaderboard, countLeaguePlayers, getPlayerLeagueRank,
  getPlayerSeasonEntry, getOrCreateSeasonEntry, updateAutoBlocksOnly,
  getClickTracking, upsertClickTracking, insertAntiCheatLog, updateEffectiveBlocks,
  getDepthTracking, upsertDepthTracking,
} = db;
const { getEconomy } = require('./economy');

const cal = require('./seasonCalendar');
const { fmtUtc } = cal;

/** Limite de rattrapage : nombre maximal de saisons enchaînées en une passe (serveur arrêté longtemps). */
const MAX_CATCHUP_SEASONS = 520;
/** Intervalle du planificateur de rotation (ms). */
const SCHEDULER_INTERVAL_MS = 60_000;

/** Nom de saison libre : "Saison 44-2026", sinon "Saison 44-2026 · 2"… (clôture anticipée). */
function _uniqueSeasonName(start) {
  const base = cal.seasonName(start);
  let name = base;
  for (let i = 2; db.seasonNameExists(name); i++) name = `${base} · ${i}`;
  return name;
}

/**
 * Ouvre la saison qui suit une saison terminée à `prevEnd` (null : aucune saison antérieure).
 * À appeler dans une transaction, après la clôture de la précédente.
 *  - début = prevEnd + 1 s (sans trou) ; sinon lundi de la semaine de `now` ;
 *  - fin   = dimanche 23:59:59 de la semaine ISO du début ;
 *  - une saison programmée par l'admin (status 'scheduled') prend le relais à sa date :
 *    activée si elle a commencé, sinon la saison créée s'arrête juste avant elle.
 */
function _openNextSeason(prevEnd, now) {
  let { start, end } = prevEnd ? cal.nextSeasonPeriod(prevEnd) : cal.weekBounds(now);

  const scheduled = db.getNextScheduledSeason();
  const schedStart = scheduled ? cal.parseUtc(scheduled.start_at) : null;
  if (scheduled && schedStart && schedStart <= start) {
    console.log(`[seasons] Saison programmée activée : ${scheduled.name} (id=${scheduled.id})`);
    return updateSeason(scheduled.id, { status: 'active' });
  }
  if (schedStart && schedStart <= end) end = new Date(schedStart.getTime() - cal.SEC_MS);

  const season = createSeason(_uniqueSeasonName(start), fmtUtc(start), fmtUtc(end));
  console.log(`[seasons] Nouvelle saison : ${season.name} (id=${season.id}, ${season.start_at} → ${season.end_at})`);
  return season;
}

// ── Noms / icônes pour les ligues auto-créées ─────────────────────────────────
// level 0 = Mimosa (seed), level 1 = Bronze, level 2 = Argent, …
const AUTO_LEAGUE_NAMES = ['Bronze', 'Argent', 'Or', 'Platine', 'Diamant', 'Émeraude', 'Maître', 'Grand Maître'];
const AUTO_LEAGUE_ICONS = ['🥉',    '🥈',    '🥇', '💎',      '💠',      '💚',       '🔮',    '👑'];

/**
 * Retourne la ligue du niveau supérieur à `currentLeague`.
 * La crée automatiquement si elle n'existe pas encore.
 */
function _getOrCreateLeagueAbove(currentLeague) {
  const nextLevel = currentLeague.level + 1;
  const existing  = getLeagueByLevel(nextLevel);
  if (existing) return existing;

  const idx  = nextLevel - 1; // level 1 → index 0 = Bronze
  const name = AUTO_LEAGUE_NAMES[idx] ?? `Ligue ${nextLevel}`;
  const icon = AUTO_LEAGUE_ICONS[idx] ?? '🏆';

  const newLeague = createLeague(name, icon, nextLevel, 1, null, nextLevel);
  console.log(`[seasons] Ligue créée automatiquement : ${icon} ${name} (level=${nextLevel}, id=${newLeague.id})`);
  return newLeague;
}

/**
 * Calcule et applique les promotions pour toutes les ligues d'une saison.
 * Retourne le rapport de promotion (tableau par ligue).
 *
 * Formule :
 *   promotionPct = promotion_rate / (1 + league.level * difficulty_coefficient)
 *   promotedCount = max(1, floor(activePlayers * promotionPct))
 */
function _applyPromotions(season, config) {
  const promotionRate = parseFloat(config.promotion_rate               ?? '0.50');
  const difficulty    = parseFloat(config.difficulty_coefficient        ?? '0.45');
  const minPlayers    = parseInt (config.min_active_players_per_league  ?? '10', 10);

  const leagues = getAllLeagues().sort((a, b) => a.level - b.level);
  const report  = [];

  for (const league of leagues) {
    const players = getAllActivePlayersInLeague(season.id, league.id);
    const total   = players.length;

    if (total === 0) {
      console.log(`[seasons][close] ${league.icon} ${league.name} — aucun joueur actif, ignorée`);
      continue;
    }

    if (total < minPlayers) {
      console.log(`[seasons][close] ${league.icon} ${league.name} — ${total} joueurs < min=${minPlayers}, pas de promotion`);
      report.push({ leagueId: league.id, leagueName: league.name, leagueLevel: league.level,
        activePlayers: total, promoted: 0, skipped: true, reason: 'not_enough_players' });
      continue;
    }

    // Taux de promotion décroissant avec le niveau
    const promotionPct  = promotionRate / (1 + league.level * difficulty);
    const promotedCount = Math.max(1, Math.floor(total * promotionPct));
    const toPromote     = players.slice(0, promotedCount);

    const nextLeague = _getOrCreateLeagueAbove(league);

    // Mise à jour des ligues utilisateur (en dehors de la transaction pour la lisibilité)
    for (const p of toPromote) {
      setUserLeague(p.user_id, nextLeague.id);
    }

    console.log(`[seasons][close] ${league.icon} ${league.name} — ${promotedCount}/${total} promus vers ${nextLeague.icon} ${nextLeague.name} (${Math.round(promotionPct * 100)}%)`);

    report.push({
      leagueId:       league.id,
      leagueName:     league.name,
      leagueLevel:    league.level,
      activePlayers:  total,
      promotionPct:   Math.round(promotionPct * 100) + '%',
      promoted:       promotedCount,
      skipped:        false,
      nextLeagueId:   nextLeague.id,
      nextLeagueName: nextLeague.name,
      promotedUsers:  toPromote.map(p => ({ userId: p.user_id, username: p.username, maxDepth: p.max_depth })),
    });
  }

  return report;
}

/**
 * Clôture une saison active :
 *  1. Validation : la saison doit être `active` (protection contre double-clôture).
 *  2. Calcul et application des promotions par ligue.
 *  3. Marquage de la saison comme `closed` + stockage du rapport dans `config`.
 *  4. Création automatique de la saison suivante.
 *
 * @param {number} seasonId  ID de la saison à clôturer
 * @returns {{ closedSeason, newSeason, report }}
 * @throws {Error} si la saison n'est pas active ou si elle n'existe pas
 */
function closeActiveSeason(seasonId, now = new Date()) {
  const season = getSeasonById(seasonId);
  if (!season) throw new Error(`Saison ${seasonId} introuvable.`);
  if (season.status !== 'active') {
    throw new Error(`La saison ${seasonId} est déjà "${season.status}" — clôture impossible.`);
  }

  console.log(`[seasons][close] Début de clôture : ${season.name} (id=${season.id})`);

  const config = getAdminConfig();
  const report = [];

  // ── Tout dans une transaction SQLite pour garantir l'atomicité ────────────
  const db = getDb();
  const closeTx = db.transaction(() => {
    // 1. Appliquer les promotions (setUserLeague est synchrone, compatible tx)
    const promotionReport = _applyPromotions(season, config);
    report.push(...promotionReport);

    const closedAt = fmtUtc(now);

    // 2. Marquer la saison comme fermée + stocker le rapport.
    // Clôture anticipée (admin) ou end_at illisible : la fin effective devient l'instant de
    // clôture, pour que la saison suivante s'enchaîne sans trou ni chevauchement (#16).
    const plannedEnd = cal.parseUtc(season.end_at);
    const end        = plannedEnd && plannedEnd <= now ? plannedEnd : cal.endBefore(now);
    const closePayload = {
      promotionApplied: true,
      closedAt,
      gemsCap:          parseInt(config.gems_cap ?? '100', 10),
      report,
    };
    if (fmtUtc(end) !== season.end_at) closePayload.plannedEndAt = season.end_at;
    updateSeason(season.id, {
      status:    'closed',
      closed_at: closedAt,
      end_at:    fmtUtc(end),
      config:    JSON.stringify(closePayload),
    });

    // 3. Ouvrir la saison suivante, qui commence à la seconde suivant la fin (#16)
    return _openNextSeason(end, now);
  });

  const newSeason = closeTx();

  console.log(`[seasons][close] Clôture terminée. Promotions : ${report.filter(r => !r.skipped).reduce((s, r) => s + r.promoted, 0)} joueur(s) promu(s).`);

  return {
    closedSeason: getSeasonById(season.id),
    newSeason,
    report,
  };
}

/**
 * Rotation des saisons (#16) : clôture la saison active expirée (avec promotions) et ouvre la
 * suivante à end_at + 1 s. Rattrape plusieurs semaines si le serveur a été arrêté, chaque
 * semaine gardant sa propre saison : l'historique reste contigu.
 * Appelée par le planificateur (chaque minute), au démarrage, sur POST /api/me/save et
 * GET /api/seasons/current. Idempotente.
 * @param {Date} [now]  Horloge injectable (tests)
 * @returns {object} La saison active après rotation éventuelle.
 */
function checkAndRotateSeason(now = new Date()) {
  for (let i = 0; i < MAX_CATCHUP_SEASONS; i++) {
    const season = getActiveSeason();

    if (!season) {
      // Aucune saison active (base existante sans saison active, clôture admin…) :
      // reprise à la fin de la dernière saison terminée, sinon semaine courante.
      getDb().transaction(() => {
        if (getActiveSeason()) return;
        const last = db.getLastEndedSeason();
        const lastEnd = last ? cal.parseUtc(last.end_at) : null;
        _openNextSeason(lastEnd, now);
      })();
      continue;
    }

    const end = cal.parseUtc(season.end_at);
    if (!end) {
      // Date illisible : ne jamais clôturer « par erreur » (ancien comportement) — à corriger via l'admin.
      console.warn(`[seasons] end_at illisible pour la saison ${season.id} (${season.end_at}) : rotation suspendue`);
      return season;
    }
    if (end > now) return season;

    try {
      closeActiveSeason(season.id, now);
    } catch (err) {
      console.warn(`[seasons] checkAndRotateSeason : ${err.message}`);
      return getActiveSeason() ?? season;
    }
  }
  console.warn(`[seasons] Rattrapage interrompu après ${MAX_CATCHUP_SEASONS} saisons`);
  return getActiveSeason();
}

/** Vrai si `nowMs` est dans la période [start_at, end_at] de la saison. */
function isWithinSeason(season, nowMs = Date.now()) {
  const start = cal.parseUtc(season?.start_at);
  const end   = cal.parseUtc(season?.end_at);
  return !!(start && end && nowMs >= start.getTime() && nowMs <= end.getTime());
}

let _schedulerTimer = null;

/**
 * Lance la rotation planifiée côté serveur : une passe immédiate puis une par minute.
 * Le timer est `unref()` : il n'empêche pas l'arrêt du processus.
 */
function startSeasonScheduler(intervalMs = SCHEDULER_INTERVAL_MS) {
  if (_schedulerTimer) return _schedulerTimer;
  const tick = () => {
    try { checkAndRotateSeason(new Date()); }
    catch (err) { console.error('[seasons][scheduler]', err.message); }
  };
  tick();
  _schedulerTimer = setInterval(tick, intervalMs);
  if (typeof _schedulerTimer.unref === 'function') _schedulerTimer.unref();
  return _schedulerTimer;
}

function stopSeasonScheduler() {
  if (_schedulerTimer) clearInterval(_schedulerTimer);
  _schedulerTimer = null;
}

// ── Anti-autoclicker (validation serveur) ─────────────────────────────────────

/** Fenêtre minimale de mesure : en dessous, les clics restent en attente et sont cumulés. */
const AC_MIN_WINDOW_SECS = 3;
/** Fenêtre maximale retenue : une longue absence ne peut pas « diluer » une rafale de clics. */
const AC_MAX_WINDOW_SECS = 120;

/** Compteur client → entier ≥ 0 (valeur absente, négative ou non numérique → 0). */
function _toCount(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, Number.MAX_SAFE_INTEGER) : 0;
}

/**
 * Analyse les clics reçus dans le lot de sauvegarde et retourne le nombre de blocs
 * effectivement acceptés après application du plafond CPS côté serveur.
 *
 * Logique (fenêtre glissante entre deux mesures, table player_click_tracking) :
 *  1. Δclics / Δblocs / Δt depuis la dernière mesure retenue.
 *  2. Δt < 3 s → rien n'est décidé : la référence n'est pas avancée, les clics sont cumulés
 *     et évalués à la sauvegarde suivante (plus de contournement par sauvegardes rapprochées).
 *  3. Δblocs > Δclics est impossible (un bloc manuel exige un clic) : l'excédent est refusé,
 *     en particulier Δclics = 0 avec Δblocs > 0 (manualClicks inchangé).
 *  4. CPS = Δclics / min(Δt, 120 s) ; au-delà de max_effective_cps → réduction proportionnelle.
 *  5. Journalise l'événement si réduit ou refusé.
 *
 * @param {number} userId
 * @param {number} seasonId
 * @param {object} seasonStats  Objet complet du client (manualClicks, manualBlocks, regularityScore…)
 * @param {object} config       Config admin (max_effective_cps, anti_autoclick_enabled…)
 * @param {string} [username]   Pour le log
 * @param {number} [nowMs]      Horloge injectable (tests)
 * @returns {{ effectiveManualBlocks: number, action: string, effectiveRatio?: number }}
 */
function processAntiCheat(userId, seasonId, seasonStats, config, username, nowMs = Date.now()) {
  const maxCps  = parseFloat(config.max_effective_cps ?? config.cps_limit ?? '8');
  const enabled = String(config.anti_autoclick_enabled ?? 'true').toLowerCase() !== 'false';

  const newClicks      = _toCount(seasonStats.manualClicks);
  const newBlocks      = _toCount(seasonStats.manualBlocks);
  const clientRegScore = Number(seasonStats.regularityScore) || 0;
  const nowIso         = fmtUtc(new Date(nowMs));

  const tracking = getClickTracking(userId);

  // Première sauvegarde ou changement de saison → initialiser sans pénalité
  // (sans dépasser le nombre de clics : un bloc manuel exige un clic)
  if (!tracking || tracking.season_id !== seasonId) {
    const initial = enabled ? Math.min(newBlocks, newClicks) : newBlocks;
    upsertClickTracking(userId, seasonId, newClicks, newBlocks, nowIso, initial);
    return { effectiveManualBlocks: initial, action: 'init' };
  }

  const accepted = tracking.accepted_blocks;

  // Compteurs revenus en arrière (réinitialisation locale, autre appareil) → nouvelle référence
  if (newClicks < tracking.last_manual_clicks || newBlocks < tracking.last_blocks) {
    upsertClickTracking(userId, seasonId, newClicks, newBlocks, nowIso, accepted);
    return { effectiveManualBlocks: accepted, action: 'rebase' };
  }

  const deltaClicks = newClicks - tracking.last_manual_clicks;
  const deltaBlocks = newBlocks - tracking.last_blocks;
  const deltaSecs   = Math.max(0, (nowMs - new Date(tracking.last_save_at + 'Z').getTime()) / 1000);

  // Aucune activité manuelle : on avance la référence (l'inactivité ne compte pas dans la fenêtre)
  if (deltaClicks === 0 && deltaBlocks === 0) {
    upsertClickTracking(userId, seasonId, newClicks, newBlocks, nowIso, accepted);
    return { effectiveManualBlocks: accepted, action: 'none' };
  }

  if (!enabled) {
    upsertClickTracking(userId, seasonId, newClicks, newBlocks, nowIso, accepted + deltaBlocks);
    return { effectiveManualBlocks: accepted + deltaBlocks, action: 'none' };
  }

  // Fenêtre trop courte → cumul : la référence n'est pas avancée, décision à la prochaine mesure
  if (deltaSecs < AC_MIN_WINDOW_SECS) {
    return { effectiveManualBlocks: accepted, action: 'pending' };
  }

  const validBlocks    = Math.min(deltaBlocks, deltaClicks);
  const windowSecs     = Math.min(deltaSecs, AC_MAX_WINDOW_SECS);
  const inferredCps    = deltaClicks / windowSecs;
  // Minimum 10 % pour ne jamais bloquer totalement un joueur
  const cpsRatio       = inferredCps <= maxCps ? 1 : Math.max(0.10, maxCps / inferredCps);
  const effectiveDelta = Math.floor(validBlocks * cpsRatio);
  const newAccepted    = accepted + effectiveDelta;

  upsertClickTracking(userId, seasonId, newClicks, newBlocks, nowIso, newAccepted);

  if (cpsRatio === 1 && validBlocks === deltaBlocks) {
    return { effectiveManualBlocks: newAccepted, action: 'none' };
  }

  const effectiveRatio = deltaBlocks > 0 ? effectiveDelta / deltaBlocks : cpsRatio;
  const action = cpsRatio < 1
    ? (cpsRatio < 0.40 ? 'flagged' : 'reduced')
    : 'rejected'; // CPS normal mais plus de blocs que de clics

  insertAntiCheatLog(
    userId,
    username ?? `user_${userId}`,
    seasonId,
    parseFloat(deltaSecs.toFixed(2)),
    deltaClicks,
    parseFloat(inferredCps.toFixed(2)),
    parseFloat(clientRegScore.toFixed(3)),
    parseFloat(effectiveRatio.toFixed(3)),
    action
  );

  console.log(`[anticheat] ${username ?? userId} : ${inferredCps.toFixed(1)} CPS (seuil=${maxCps}), ${deltaBlocks} blocs/${deltaClicks} clics → ${effectiveDelta} acceptés — ${action}`);

  return { effectiveManualBlocks: newAccepted, action, effectiveRatio };
}

// ── Validation serveur de la profondeur (ticket #9) ───────────────────────────
//
// Côté client, chaque bloc détruit (clic ou autodig) fait descendre d'un mètre :
// maxDepth ≤ 1 + blocs détruits, un bloc détruit à la main exige au moins un clic, et
// l'autodig frappe une fois par seconde (≤ 1 bloc/s). La profondeur retenue pour le
// classement est donc plafonnée par les clics et blocs auto « plausibles » au vu du temps
// réel écoulé côté serveur (seaux de jetons) :
//   profondeur retenue ≤ profondeur retenue précédente + clics acceptés + blocs auto acceptés
// Les compteurs qui dépassent le rythme maximal restent en attente et sont acceptés plus
// tard (gigue réseau, sauvegardes perdues) ; au-delà de 10 min de jeu au rythme maximal,
// l'excédent est rejeté et journalisé.

/** Clics/s maximum retenus pour la progression (surchargeable : config depth_max_cps). */
const DEPTH_MAX_CPS_DEFAULT = 20;
/**
 * Blocs/s maximum retenus pour l'autodig : autoDigTick frappe toutes les 1 s (au plus un bloc
 * par coup) ; marge de 25 % pour pouvoir rattraper un retard (sauvegardes perdues).
 */
const AUTODIG_MAX_BPS = 1.25;
/** Capacité des seaux : temps de jeu au rythme maximal accumulable entre deux sauvegardes. */
const DEPTH_BUCKET_SECS = 20;
/** Au-delà de ce temps de jeu au rythme maximal en attente, l'excédent est rejeté. */
const DEPTH_PENDING_MAX_SECS = 600;
/** Écart déclaré − retenu à partir duquel un plafonnement est journalisé. */
const DEPTH_LOG_GAP = 50;

/**
 * Accepte une partie des compteurs en attente selon les jetons disponibles.
 * @returns {{ ok: number, tokens: number, ref: number, discarded: number }}
 */
function _drainCounter(claimed, ref, tokens, rate) {
  if (claimed < ref) return { ok: 0, tokens, ref: claimed, discarded: 0 }; // compteur revenu en arrière
  const pending = claimed - ref;
  const ok      = Math.min(pending, Math.floor(tokens));
  let newRef    = ref + ok;
  let discarded = 0;
  if (pending - ok > rate * DEPTH_PENDING_MAX_SECS) {
    discarded = pending - ok;
    newRef    = claimed;
  }
  return { ok, tokens: tokens - ok, ref: newRef, discarded };
}

/**
 * Calcule la profondeur maximale retenue pour le classement à partir de la sauvegarde.
 *
 * @param {number} userId
 * @param {number} seasonId
 * @param {object} seasonStats  Objet du client (maxDepth, manualClicks, autoBlocks, regularityScore…)
 * @param {object} config       Config admin (depth_validation_enabled, depth_max_cps)
 * @param {string} [username]   Pour le log
 * @param {number} [nowMs]      Horloge injectable (tests)
 * @returns {{ acceptedDepth: number, reportedDepth: number, action: string }}
 *          action : none | init | capped | depth_capped | depth_rejected | disabled
 */
function validateDepth(userId, seasonId, seasonStats, config, username, nowMs = Date.now()) {
  const enabled  = String(config.depth_validation_enabled ?? 'true').toLowerCase() !== 'false';
  const cfgRate  = parseFloat(config.depth_max_cps);
  const handRate = Number.isFinite(cfgRate) && cfgRate > 0 ? cfgRate : DEPTH_MAX_CPS_DEFAULT;

  const claimedDepth  = _toCount(seasonStats.maxDepth);
  const claimedClicks = _toCount(seasonStats.manualClicks);
  const claimedAuto   = _toCount(seasonStats.autoBlocks);

  let t = getDepthTracking(userId);
  let action = 'none';
  if (!t || t.season_id !== seasonId) {
    action = 'init';
    // Ligne de classement antérieure à la validation (données existantes) : on la reprend
    // telle quelle et on repart des derniers compteurs enregistrés, sans crédit.
    const entry = getPlayerSeasonEntry(seasonId, userId);
    t = entry && entry.max_depth > 0
      ? { ref_clicks: entry.manual_clicks, ref_auto: entry.auto_blocks, accepted_depth: entry.max_depth }
      : { ref_clicks: 0, ref_auto: 0, accepted_depth: 0 };
    Object.assign(t, { season_id: seasonId, hand_tokens: 0, auto_tokens: 0, last_gap: 0, updated_ms: nowMs });
  }

  if (!enabled) {
    const accepted = Math.max(t.accepted_depth, claimedDepth);
    upsertDepthTracking(userId, { ...t, ref_clicks: claimedClicks, ref_auto: claimedAuto,
      hand_tokens: 0, auto_tokens: 0, accepted_depth: accepted, last_gap: 0, updated_ms: nowMs });
    return { acceptedDepth: accepted, reportedDepth: claimedDepth, action: 'disabled' };
  }

  // Recharge des seaux selon le temps réel écoulé (plafonnée : l'inactivité ne s'accumule pas)
  const dtSecs     = Math.max(0, (nowMs - t.updated_ms) / 1000);
  const handTokens = Math.min(handRate * DEPTH_BUCKET_SECS, t.hand_tokens + handRate * dtSecs);
  const autoTokens = Math.min(AUTODIG_MAX_BPS * DEPTH_BUCKET_SECS, t.auto_tokens + AUTODIG_MAX_BPS * dtSecs);

  const pendingClicks = Math.max(0, claimedClicks - t.ref_clicks);
  const hand = _drainCounter(claimedClicks, t.ref_clicks, handTokens, handRate);
  const auto = _drainCounter(claimedAuto,   t.ref_auto,   autoTokens, AUTODIG_MAX_BPS);

  const ceiling  = Math.max(t.accepted_depth, 1) + hand.ok + auto.ok;
  const accepted = Math.max(t.accepted_depth, Math.min(claimedDepth, ceiling));
  const gap      = Math.max(0, claimedDepth - accepted);

  upsertDepthTracking(userId, {
    season_id: seasonId, ref_clicks: hand.ref, ref_auto: auto.ref,
    hand_tokens: hand.tokens, auto_tokens: auto.tokens,
    accepted_depth: accepted, last_gap: gap, updated_ms: nowMs,
  });

  let logAction = null;
  if (hand.discarded > 0 || auto.discarded > 0) logAction = 'depth_rejected';
  else if (gap >= DEPTH_LOG_GAP && t.last_gap < DEPTH_LOG_GAP) logAction = 'depth_capped';

  if (logAction) {
    const cps = dtSecs > 0 ? pendingClicks / dtSecs : pendingClicks;
    insertAntiCheatLog(
      userId, username ?? `user_${userId}`, seasonId,
      parseFloat(dtSecs.toFixed(2)),
      pendingClicks,
      parseFloat(cps.toFixed(2)),
      parseFloat((Number(seasonStats.regularityScore) || 0).toFixed(3)),
      parseFloat((claimedDepth > 0 ? accepted / claimedDepth : 1).toFixed(3)),
      logAction,
      { reportedDepth: claimedDepth, acceptedDepth: accepted,
        discardedClicks: hand.discarded, discardedAutoBlocks: auto.discarded },
    );
    console.log(`[anticheat] ${username ?? userId} : profondeur déclarée ${claimedDepth} → retenue ${accepted} — ${logAction}`);
    return { acceptedDepth: accepted, reportedDepth: claimedDepth, action: logAction };
  }

  return { acceptedDepth: accepted, reportedDepth: claimedDepth, action: gap > 0 ? 'capped' : action };
}

// ── Utilitaires de stats saisonnières ────────────────────────────────────────

/**
 * Garantit l'existence d'une ligne de stats pour ce joueur dans cette saison.
 * La ligne est créée inactive (is_active = 0) — le joueur n'est pas encore classé.
 * @returns {object} L'entrée season_rankings (existante ou nouvelle)
 */
function getOrCreateSeasonStats(userId, seasonId, leagueId) {
  return getOrCreateSeasonEntry(seasonId, userId, leagueId);
}

/**
 * Enregistre un bris de bloc MANUEL.
 * — Met à jour max_depth, manual_blocks, manual_clicks, suspicious_score.
 * — Marque le joueur comme actif (is_active = 1) → il apparaît dans le classement.
 * — L'autodig n'appelle JAMAIS cette fonction.
 *
 * @param {number} userId
 * @param {object} season      Ligne de la table seasons
 * @param {object} opts
 * @param {number} opts.maxDepth          Profondeur validée côté serveur (classement)
 * @param {number} [opts.reportedMaxDepth] Profondeur déclarée par le client (audit)
 * @param {number} opts.manualBlocks
 * @param {number} opts.manualClicks   Total de clics (y compris sans destruction)
 * @param {number} opts.suspiciousScore Clics suspects détectés côté client
 * @param {number|null} opts.leagueId  Ligue actuelle du joueur
 */
function recordManualBreaks(userId, season, { maxDepth, reportedMaxDepth, manualBlocks, manualClicks, suspiciousScore, leagueId }) {
  if (manualBlocks < 1) return;
  upsertSeasonRanking(
    season.id, userId,
    maxDepth, manualBlocks,
    null,            // auto_blocks : géré exclusivement par recordAutoBreaks
    manualClicks  ?? 0,
    suspiciousScore ?? 0,
    leagueId ?? null,
    reportedMaxDepth ?? maxDepth
  );
}

/**
 * Enregistre des blocs cassés par l'AUTO-DIG.
 * — Met à jour UNIQUEMENT auto_blocks.
 * — NE marque PAS le joueur actif.
 * — NE contribue PAS au classement, au tie-break ni à la promotion.
 *
 * @param {number} userId
 * @param {number} seasonId
 * @param {number} autoBlocks
 */
function recordAutoBreaks(userId, seasonId, autoBlocks) {
  if (autoBlocks <= 0) return;
  updateAutoBlocksOnly(seasonId, userId, autoBlocks);
}

/**
 * Coordinateur appelé depuis POST /api/me/save.
 * Dispatch vers recordManualBreaks ou recordAutoBreaks selon la source du bloc.
 * Appelle processAntiCheat pour calculer les blocs effectivement acceptés.
 */
function syncPlayerRanking(userId, seasonStats) {
  if (!seasonStats || typeof seasonStats !== 'object') return;
  const { seasonId, maxDepth, manualBlocks, autoBlocks, manualClicks, suspiciousScore } = seasonStats;

  // Validation minimale
  if (!seasonId || typeof maxDepth !== 'number' || typeof manualBlocks !== 'number') return;

  // Vérifie que la saison active existe et correspond à ce que le client envoie
  const season = getActiveSeason();
  if (!season) {
    console.warn('[seasons] syncPlayerRanking : aucune saison active');
    return;
  }
  if (season.id !== seasonId) {
    console.warn(`[seasons] syncPlayerRanking : décalage de saison client=${seasonId} serveur=${season.id}`);
    return;
  }
  // Aucun score hors de la période de la saison (avant start_at ou après end_at) — #16
  if (!isWithinSeason(season)) {
    console.warn(`[seasons] syncPlayerRanking : saison ${season.id} hors période (${season.start_at} → ${season.end_at}), score ignoré`);
    return;
  }

  const user       = getUserById(userId);
  const userLeague = getUserLeague(userId);
  const leagueId   = userLeague ? userLeague.id : null;
  const config     = getAdminConfig();

  // ── Profondeur : validée côté serveur à chaque sauvegarde (ticket #9) ─────
  const { acceptedDepth, reportedDepth } = validateDepth(userId, season.id, seasonStats, config, user?.username);

  // ── Blocs auto (jamais comptés dans le classement) ────────────────────────
  if ((autoBlocks ?? 0) > 0) {
    recordAutoBreaks(userId, season.id, autoBlocks);
  }

  // ── Blocs manuels + validation anti-autoclicker ───────────────────────────
  if (manualBlocks >= 1) {
    // Enregistre les stats brutes (audit) — marque le joueur actif
    recordManualBreaks(userId, season, {
      maxDepth:         acceptedDepth,
      reportedMaxDepth: reportedDepth,
      manualBlocks,
      manualClicks:    manualClicks    ?? 0,
      suspiciousScore: suspiciousScore ?? 0,
      leagueId,
    });

    // Calcule les blocs effectifs validés côté serveur
    const { effectiveManualBlocks } = processAntiCheat(
      userId, season.id, seasonStats, config, user?.username
    );

    // Met à jour le compteur effectif (utilisé pour le classement et les promotions).
    // Chaque bloc manuel fait descendre d'un mètre : blocs manuels ≤ profondeur retenue − 1.
    updateEffectiveBlocks(season.id, userId, Math.min(effectiveManualBlocks, Math.max(0, acceptedDepth - 1)));
  }
}

const PAGE_SIZE = 50;

/**
 * Formate une ligne brute de season_rankings en objet API normalisé.
 * `admin` : ajoute les valeurs déclarées par le client (audit), absentes de l'API publique.
 */
function _formatRow(r, leagueMap, admin = false) {
  const league = r.league_id ? (leagueMap[r.league_id] ?? null) : null;
  const audit  = admin ? { reportedMaxDepth: r.reported_max_depth ?? null, manualClicks: r.manual_clicks ?? null } : {};
  return {
    ...audit,
    rank:                 r.rank ?? r.rank_in_league ?? null,
    userId:               r.user_id,
    username:             r.username,
    leagueId:             r.league_id ?? null,
    league:               league ? { id: league.id, name: league.name, icon: league.icon } : null,
    maxDepth:             r.max_depth,
    manualBlocks:         r.effective_manual_blocks ?? r.manual_blocks, // classement basé sur l'effectif
    manualBlocksBroken:   r.manual_blocks,          // total brut revendiqué par le client
    effectiveBlocks:      r.effective_manual_blocks, // validé côté serveur
    autoBlocksBroken:     r.auto_blocks,             // informatif uniquement
  };
}

/**
 * Construit la réponse pour GET /api/seasons/current.
 * Inclut le rang global ET le rang intraligue du joueur connecté.
 */
function buildCurrentSeasonResponse(userId = null) {
  const season = checkAndRotateSeason();
  const config = getAdminConfig();
  const leagues = getAllLeagues();
  const leagueMap = Object.fromEntries(leagues.map(l => [l.id, l]));

  let playerInfo = null;
  if (userId) {
    const entry = getPlayerSeasonEntry(season.id, userId);
    if (entry && entry.is_active) {
      // Rang global (tous joueurs actifs confondus)
      const globalRankRow = getPlayerSeasonRank(season.id, userId);
      const rankGlobal    = globalRankRow ? globalRankRow.rank_global : null;

      // Rang intraligue (parmi les joueurs de la même ligue)
      const leagueId   = entry.league_id;
      const rankLeague = leagueId ? getPlayerLeagueRank(season.id, userId, leagueId) : null;
      const league     = leagueId ? (leagueMap[leagueId] ?? null) : (rankGlobal ? getLeagueForRank(rankGlobal) : null);

      playerInfo = {
        maxDepth:      entry.max_depth,
        manualBlocks:  entry.manual_blocks,
        autoBlocks:    entry.auto_blocks,
        isActive:      true,
        rankGlobal,
        rankInLeague:  rankLeague,
        rank:          rankLeague ?? rankGlobal, // rétrocompat — préférer rankInLeague
        league:        league ? { id: league.id, name: league.name, icon: league.icon } : null,
      };
    }
  }

  return {
    season: {
      id:      season.id,
      name:    season.name,
      startAt: season.start_at,
      endAt:   season.end_at,
      status:  season.status,
    },
    config: {
      gemsCap:              parseInt(config.gems_cap          ?? '100',  10),
      cpsLimit:             parseInt(config.max_effective_cps ?? config.cps_limit ?? '8', 10),
      antiAutoclickEnabled: (config.anti_autoclick_enabled ?? 'true') === 'true',
      economy:              getEconomy(config),
    },
    player: playerInfo,
  };
}

/**
 * Classement global paginé d'une saison (ancienne route).
 * Rétrocompat — la réponse `{ leaderboard }` est conservée.
 */
function buildLeaderboard(seasonId, page = 1) {
  const offset  = (page - 1) * PAGE_SIZE;
  const rows    = getSeasonLeaderboard(seasonId, PAGE_SIZE, offset);
  const total   = countSeasonActivePlayers(seasonId);
  const leagues = getAllLeagues();
  const leagueMap = Object.fromEntries(leagues.map(l => [l.id, l]));

  return rows.map(r => _formatRow(r, leagueMap));
}

/**
 * Classement global paginé — réponse enrichie avec totaux et pagination.
 */
function buildGlobalLeaderboard(seasonId, page = 1, { admin = false } = {}) {
  const offset  = (page - 1) * PAGE_SIZE;
  const rows    = getSeasonLeaderboard(seasonId, PAGE_SIZE, offset);
  const total   = countSeasonActivePlayers(seasonId);
  const leagues = getAllLeagues();
  const leagueMap = Object.fromEntries(leagues.map(l => [l.id, l]));

  return {
    page,
    pageSize:   PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    leaderboard: rows.map(r => _formatRow(r, leagueMap, admin)),
  };
}

/**
 * Classement intraligue paginé.
 * Règles strictes :
 *  1. Uniquement les joueurs avec manual_blocks > 0 (is_active = 1).
 *  2. Tri : max_depth DESC, manual_blocks DESC.
 *  3. auto_blocks jamais utilisé pour le tri.
 *
 * @param {number} seasonId
 * @param {number} leagueId
 * @param {number} [page=1]
 */
function buildLeagueLeaderboard(seasonId, leagueId, page = 1) {
  const offset  = (page - 1) * PAGE_SIZE;
  const rows    = getLeagueLeaderboard(seasonId, leagueId, PAGE_SIZE, offset);
  const total   = countLeaguePlayers(seasonId, leagueId);
  const leagues = getAllLeagues();
  const leagueMap = Object.fromEntries(leagues.map(l => [l.id, l]));

  return {
    page,
    pageSize:   PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    leaderboard: rows.map(r => ({
      rank:               r.rank_in_league,
      userId:             r.user_id,
      username:           r.username,
      leagueId:           r.league_id ?? null,
      league:             leagueMap[r.league_id] ? {
        id:   leagueMap[r.league_id].id,
        name: leagueMap[r.league_id].name,
        icon: leagueMap[r.league_id].icon,
      } : null,
      maxDepth:           r.max_depth,
      manualBlocksBroken: r.manual_blocks,
      autoBlocksBroken:   r.auto_blocks,  // informatif uniquement
    })),
  };
}

/**
 * Classement de la saison active, global ou filtré par ligue.
 * Sans leagueId → global enrichi. Avec leagueId → intraligue.
 *
 * @param {number|null} leagueId
 * @param {number}      page
 */
function buildActiveSeasonLeaderboard(leagueId = null, page = 1) {
  const season = getActiveSeason();
  if (!season) return null;

  const base = { season: { id: season.id, name: season.name, status: season.status } };

  if (leagueId) {
    return { ...base, ...buildLeagueLeaderboard(season.id, leagueId, page) };
  }
  return { ...base, ...buildGlobalLeaderboard(season.id, page) };
}

module.exports = {
  checkAndRotateSeason,
  isWithinSeason,
  startSeasonScheduler,
  stopSeasonScheduler,
  closeActiveSeason,
  syncPlayerRanking,
  processAntiCheat,
  validateDepth,
  getOrCreateSeasonStats,
  recordManualBreaks,
  recordAutoBreaks,
  buildCurrentSeasonResponse,
  buildLeaderboard,           // rétrocompat
  buildGlobalLeaderboard,
  buildLeagueLeaderboard,
  buildActiveSeasonLeaderboard,
};
