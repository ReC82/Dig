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
} = db;

/**
 * Calcule le lundi et le dimanche de la semaine suivant une date donnée.
 * @param {Date} ref  Date de référence
 */
function nextWeekBounds(ref) {
  const day        = ref.getUTCDay(); // 0=dim … 6=sam
  const diffToNext = (day === 0 ? 1 : 8 - day);
  const monday     = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate() + diffToNext));
  const sunday     = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000 - 1000);
  return { monday, sunday };
}

/** Formate une Date en "YYYY-MM-DD HH:MM:SS" UTC (format SQLite). */
function fmtUtc(d) {
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

/** Numéro de semaine ISO approximatif pour le nom de la saison. */
function weekLabel(monday) {
  const start = new Date(Date.UTC(monday.getUTCFullYear(), 0, 1));
  const week  = Math.ceil(((monday - start) / 86_400_000 + start.getUTCDay() + 1) / 7);
  return `Saison ${week}-${monday.getUTCFullYear()}`;
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
function closeActiveSeason(seasonId) {
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

    const now = fmtUtc(new Date());

    // 2. Marquer la saison comme fermée + stocker le rapport
    const closePayload = {
      promotionApplied: true,
      closedAt:         now,
      gemsCap:          parseInt(config.gems_cap ?? '100', 10),
      report,
    };
    updateSeason(season.id, {
      status:    'closed',
      closed_at: now,
      config:    JSON.stringify(closePayload),
    });

    // 3. Créer la saison suivante (lundi prochain → dimanche)
    const { monday, sunday } = nextWeekBounds(new Date());
    const newSeason = createSeason(weekLabel(monday), fmtUtc(monday), fmtUtc(sunday));
    console.log(`[seasons][close] Nouvelle saison créée : ${newSeason.name} (id=${newSeason.id})`);
    return newSeason;
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
 * Vérifie si la saison active est expirée ; si oui, la clôture (avec promotions) et crée la suivante.
 * Appelée sur chaque POST /api/me/save et GET /api/seasons/current.
 * @returns {object} La saison active après rotation éventuelle.
 */
function checkAndRotateSeason() {
  let season = getActiveSeason();

  if (season && new Date(season.end_at + 'Z') > new Date()) {
    return season; // saison en cours, rien à faire
  }

  if (season) {
    // Clôture avec promotions + création de la suivante
    try {
      const { newSeason } = closeActiveSeason(season.id);
      return newSeason;
    } catch (err) {
      // La saison était déjà clôturée (race condition) — récupère la nouvelle active
      console.warn(`[seasons] checkAndRotateSeason : ${err.message}`);
      const active = getActiveSeason();
      if (active) return active;
    }
  }

  // Aucune saison active — en créer une maintenant
  const { monday, sunday } = nextWeekBounds(new Date());
  season = createSeason(weekLabel(monday), fmtUtc(monday), fmtUtc(sunday));
  console.log(`[seasons] Saison initiale créée : ${season.name}`);
  return season;
}

// ── Anti-autoclicker (validation serveur) ─────────────────────────────────────

/** Fenêtre minimale de mesure : en dessous, les clics restent en attente et sont cumulés. */
const AC_MIN_WINDOW_SECS = 3;
/** Fenêtre maximale retenue : une longue absence ne peut pas « diluer » une rafale de clics. */
const AC_MAX_WINDOW_SECS = 120;

/** Compteur client → entier ≥ 0 (valeur absente, négative ou non numérique → 0). */
function _toCount(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
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
 * @param {number} opts.maxDepth
 * @param {number} opts.manualBlocks
 * @param {number} opts.manualClicks   Total de clics (y compris sans destruction)
 * @param {number} opts.suspiciousScore Clics suspects détectés côté client
 * @param {number|null} opts.leagueId  Ligue actuelle du joueur
 */
function recordManualBreaks(userId, season, { maxDepth, manualBlocks, manualClicks, suspiciousScore, leagueId }) {
  if (manualBlocks < 1) return;
  upsertSeasonRanking(
    season.id, userId,
    maxDepth, manualBlocks,
    null,            // auto_blocks : géré exclusivement par recordAutoBreaks
    manualClicks  ?? 0,
    suspiciousScore ?? 0,
    leagueId ?? null
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

  const user       = getUserById(userId);
  const userLeague = getUserLeague(userId);
  const leagueId   = userLeague ? userLeague.id : null;

  // ── Blocs auto (jamais comptés dans le classement) ────────────────────────
  if ((autoBlocks ?? 0) > 0) {
    recordAutoBreaks(userId, season.id, autoBlocks);
  }

  // ── Blocs manuels + validation anti-autoclicker ───────────────────────────
  if (manualBlocks >= 1) {
    // Enregistre les stats brutes (audit) — marque le joueur actif
    recordManualBreaks(userId, season, {
      maxDepth, manualBlocks,
      manualClicks:    manualClicks    ?? 0,
      suspiciousScore: suspiciousScore ?? 0,
      leagueId,
    });

    // Calcule les blocs effectifs validés côté serveur
    const config = getAdminConfig();
    const { effectiveManualBlocks } = processAntiCheat(
      userId, season.id, seasonStats, config, user?.username
    );

    // Met à jour le compteur effectif (utilisé pour le classement et les promotions)
    updateEffectiveBlocks(season.id, userId, effectiveManualBlocks);
  }
}

const PAGE_SIZE = 50;

/** Formate une ligne brute de season_rankings en objet API normalisé. */
function _formatRow(r, leagueMap) {
  const league = r.league_id ? (leagueMap[r.league_id] ?? null) : null;
  return {
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
function buildGlobalLeaderboard(seasonId, page = 1) {
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
    leaderboard: rows.map(r => _formatRow(r, leagueMap)),
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
  closeActiveSeason,
  syncPlayerRanking,
  processAntiCheat,
  getOrCreateSeasonStats,
  recordManualBreaks,
  recordAutoBreaks,
  buildCurrentSeasonResponse,
  buildLeaderboard,           // rétrocompat
  buildGlobalLeaderboard,
  buildLeagueLeaderboard,
  buildActiveSeasonLeaderboard,
};
