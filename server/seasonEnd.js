/**
 * server/seasonEnd.js — Date de fin configurable de la saison active (#44).
 *
 * L'admin avance (ou repousse) la fin de la saison active ; la clôture elle-même reste celle de
 * la rotation habituelle (#16) : à l'échéance, le planificateur (chaque minute) clôt la saison,
 * fige le classement (#29), crédite les points (#33) et ouvre une seule saison suivante, qui
 * finit le dimanche 23:59:59 UTC (calendrier hebdomadaire, #16). Ce module ne clôt rien.
 *
 * Protections :
 *   - bornes : au moins MIN_LEAD_MS dans le futur, après le début de la saison, au plus
 *     MAX_EXTEND_MS après la fin hebdomadaire d'origine, avant une saison programmée ;
 *   - confirmation explicite : le nom exact de la saison doit être renvoyé ;
 *   - concurrence : la fin actuelle attendue (`expectedEndAt`) doit correspondre, sinon 409
 *     (mise à jour conditionnelle dans une transaction) ;
 *   - annulation tant que l'échéance n'est pas atteinte (au moins CANCEL_LOCK_MS avant) :
 *     retour à la fin hebdomadaire d'origine ;
 *   - journal d'audit en ajout seul (`season_end_changes`), en plus du journal admin global.
 */

'use strict';

const db      = require('./db');
const cal     = require('./seasonCalendar');
const seasons = require('./seasons');
const rewardPoints = require('./rewardPoints');

/** Délai minimal entre maintenant et la nouvelle fin (temps de vérifier et d'annuler). */
const MIN_LEAD_MS    = 10 * 60_000;
/** Annulation refusée à moins de 2 min de l'échéance (le planificateur passe chaque minute). */
const CANCEL_LOCK_MS = 2 * 60_000;
/** Prolongation maximale au-delà de la fin hebdomadaire d'origine. */
const MAX_EXTEND_MS  = cal.WEEK_MS;
/** Durée minimale d'une saison. */
const MIN_DURATION_MS = 60 * 60_000;

class SeasonEndError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const conn = () => db.getDb();

function _history(seasonId) {
  return conn().prepare('SELECT * FROM season_end_changes WHERE season_id = ? ORDER BY id').all(seasonId);
}

/** Fin hebdomadaire d'origine : la fin avant le premier changement, sinon la fin actuelle. */
function _weeklyEnd(season, history = _history(season.id)) {
  return history.length ? history[0].weekly_end : season.end_at;
}

function _active(seasonId) {
  const season = db.getActiveSeason();
  if (!season) throw new SeasonEndError(404, 'Aucune saison active.');
  if (seasonId != null && season.id !== seasonId) {
    throw new SeasonEndError(409, `La saison ${seasonId} n'est plus la saison active (saison active : ${season.name}).`);
  }
  return season;
}

const _both = d => ({ utc: cal.fmtUtc(d), local: cal.fmtLocal(d) });

/** Lit la nouvelle fin : `end_local` (heure de Bruxelles) ou `end_at` (UTC ou avec décalage). */
function parseRequestedEnd({ end_local: endLocal, end_at: endAt } = {}) {
  if (endLocal) {
    const r = cal.localToUtc(String(endLocal));
    if (r.error === 'nonexistent') throw new SeasonEndError(400, 'Heure inexistante à Bruxelles (passage à l\'heure d\'été).');
    if (r.error === 'ambiguous')   throw new SeasonEndError(400, 'Heure ambiguë à Bruxelles (retour à l\'heure d\'hiver) : choisissez une autre heure ou saisissez-la en UTC.');
    if (r.error) throw new SeasonEndError(400, 'Date locale invalide (format attendu : AAAA-MM-JJTHH:MM, heure de Bruxelles).');
    return new Date(Math.floor(r.date.getTime() / cal.SEC_MS) * cal.SEC_MS);
  }
  const d = endAt ? cal.parseUtc(String(endAt)) : null;
  if (!d) throw new SeasonEndError(400, 'Date de fin requise : end_local (heure de Bruxelles) ou end_at (UTC).');
  return new Date(Math.floor(d.getTime() / cal.SEC_MS) * cal.SEC_MS);
}

/**
 * Vérifie une nouvelle fin et décrit ses conséquences, sans rien modifier.
 * @returns {object} aperçu (fins actuelle/demandée/hebdomadaire, saison suivante, points)
 */
function preview(seasonId, newEnd, now = new Date()) {
  const season = _active(seasonId);
  const history = _history(season.id);
  const weeklyEnd = cal.parseUtc(_weeklyEnd(season, history));
  const start = cal.parseUtc(season.start_at);
  const currentEnd = cal.parseUtc(season.end_at);
  if (!start || !currentEnd || !weeklyEnd) throw new SeasonEndError(409, 'Dates de la saison active illisibles.');

  if (newEnd.getTime() < now.getTime() + MIN_LEAD_MS) {
    throw new SeasonEndError(400, `La nouvelle fin doit être au moins ${MIN_LEAD_MS / 60_000} min dans le futur (pas de clôture immédiate ni rétroactive).`);
  }
  if (newEnd.getTime() < start.getTime() + MIN_DURATION_MS) {
    throw new SeasonEndError(400, 'La nouvelle fin doit être au moins 1 h après le début de la saison.');
  }
  if (newEnd.getTime() > weeklyEnd.getTime() + MAX_EXTEND_MS) {
    throw new SeasonEndError(400, 'La nouvelle fin ne peut pas dépasser de plus de 7 jours la fin hebdomadaire d\'origine.');
  }
  if (cal.fmtUtc(newEnd) === season.end_at) throw new SeasonEndError(400, 'La saison se termine déjà à cette date.');

  const next = seasons.planNextSeason(newEnd, now);
  const scheduled = db.getNextScheduledSeason();
  const schedStart = scheduled ? cal.parseUtc(scheduled.start_at) : null;
  if (schedStart && newEnd >= schedStart) {
    throw new SeasonEndError(409, `La nouvelle fin doit précéder la saison programmée « ${scheduled.name} ».`);
  }

  const points = rewardPoints.getSettings();
  const liveCredit = points.mode === 'live' && !!points.liveSince && cal.fmtUtc(newEnd) >= points.liveSince;
  return {
    season:     { id: season.id, name: season.name, startAt: _both(start) },
    currentEnd: _both(currentEnd),
    weeklyEnd:  _both(weeklyEnd),
    newEnd:     _both(newEnd),
    expectedEndAt: season.end_at,
    timeZone:   cal.LOCAL_TZ,
    activePlayers: db.countSeasonActivePlayers(season.id),
    nextSeason: next.scheduled
      ? { scheduled: true, id: next.scheduled.id, name: next.scheduled.name, start: _both(next.start), end: next.end ? _both(next.end) : null }
      : { scheduled: false, name: cal.seasonName(next.start), start: _both(next.start), end: _both(next.end),
          durationHours: Math.round((next.end - next.start + cal.SEC_MS) / 3_600_000 * 10) / 10 },
    points: { mode: points.mode, liveSince: points.liveSince, scaleVersion: points.scaleVersion, liveCredit },
    consequences: [
      `À ${cal.fmtLocal(newEnd)} (${cal.fmtUtc(newEnd)} UTC), le planificateur clôt « ${season.name} » (dans la minute qui suit).`,
      'Classement figé immuable (#29) puis attribution des points, une seule fois par saison et par joueur (#33).',
      liveCredit
        ? `Crédit RÉEL des points au portefeuille (barème v${points.scaleVersion}, seuils et activité requise inchangés).`
        : 'Points en SIMULATION seulement : aucun crédit réel (mode de points non « live »).',
      next.scheduled
        ? `Puis la saison programmée « ${next.scheduled.name} » est activée.`
        : `Puis une seule nouvelle saison s'ouvre de ${cal.fmtLocal(next.start)} à ${cal.fmtLocal(next.end)} (calendrier hebdomadaire habituel ensuite).`,
      'Annulation possible jusqu\'à 2 min avant l\'échéance ; une clôture exécutée est définitive.',
    ],
  };
}

/**
 * Programme une nouvelle fin pour la saison active. `confirm` doit être le nom exact de la
 * saison ; `expectedEndAt` la fin actuelle lue dans l'aperçu (protection de concurrence).
 */
function setEnd(seasonId, newEnd, { confirm, expectedEndAt, reason = null, now = new Date() } = {}) {
  const p = preview(seasonId, newEnd, now);
  if (confirm !== p.season.name) {
    throw new SeasonEndError(400, `Confirmation requise : saisissez exactement le nom de la saison (« ${p.season.name} »).`);
  }
  if (!expectedEndAt || cal.normalizeDate(String(expectedEndAt)) !== p.expectedEndAt) {
    throw new SeasonEndError(409, 'La date de fin a changé entre-temps : rechargez l\'aperçu.');
  }
  return _apply(p.season.id, 'set', p.expectedEndAt, cal.fmtUtc(newEnd), reason, now);
}

/** Annule la fin programmée : retour à la fin hebdomadaire d'origine. */
function cancel(seasonId, { expectedEndAt, reason = null, now = new Date() } = {}) {
  const season = _active(seasonId);
  const history = _history(season.id);
  const weeklyEnd = _weeklyEnd(season, history);
  if (season.end_at === weeklyEnd) throw new SeasonEndError(409, 'Aucune fin exceptionnelle à annuler.');
  const currentEnd = cal.parseUtc(season.end_at);
  if (!currentEnd || currentEnd.getTime() - now.getTime() < CANCEL_LOCK_MS) {
    throw new SeasonEndError(409, 'Échéance trop proche ou dépassée : annulation impossible (la clôture est en cours ou faite).');
  }
  if (cal.parseUtc(weeklyEnd).getTime() < now.getTime() + MIN_LEAD_MS) {
    throw new SeasonEndError(409, 'La fin hebdomadaire d\'origine est trop proche : annulation impossible.');
  }
  if (expectedEndAt && cal.normalizeDate(String(expectedEndAt)) !== season.end_at) {
    throw new SeasonEndError(409, 'La date de fin a changé entre-temps : rechargez la page.');
  }
  return _apply(season.id, 'cancel', season.end_at, weeklyEnd, reason, now);
}

function _apply(seasonId, action, oldEnd, newEnd, reason, now) {
  return conn().transaction(() => {
    const season = db.getSeasonById(seasonId);
    const weeklyEnd = _weeklyEnd(season);
    const r = conn().prepare(`UPDATE seasons SET end_at = ? WHERE id = ? AND status = 'active' AND end_at = ?`)
      .run(newEnd, seasonId, oldEnd);
    if (r.changes !== 1) throw new SeasonEndError(409, 'La saison a changé entre-temps (clôturée ou date modifiée) : rechargez.');
    conn().prepare(`INSERT INTO season_end_changes (season_id, action, old_end_at, new_end_at, weekly_end, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(seasonId, action, oldEnd, newEnd, weeklyEnd, reason ? String(reason).slice(0, 300) : null, cal.fmtUtc(now));
    console.log(`[seasons][fin] ${action === 'set' ? 'Fin programmée' : 'Fin annulée'} : saison ${seasonId}, ${oldEnd} → ${newEnd} UTC`);
    return state(now);
  })();
}

/** État pour le panel : saison active, fins (UTC + Bruxelles), historique des changements. */
function state(now = new Date()) {
  const season = db.getActiveSeason();
  if (!season) return { season: null, timeZone: cal.LOCAL_TZ, serverNow: _both(now) };
  const history = _history(season.id);
  const weeklyEnd = _weeklyEnd(season, history);
  const end = cal.parseUtc(season.end_at);
  const fmt = v => { const d = cal.parseUtc(v); return d ? _both(d) : { utc: v, local: null }; };
  return {
    season: { id: season.id, name: season.name, startAt: fmt(season.start_at), endAt: fmt(season.end_at) },
    expectedEndAt: season.end_at,
    weeklyEnd: fmt(weeklyEnd),
    exceptional: season.end_at !== weeklyEnd,
    cancellable: season.end_at !== weeklyEnd && !!end && end.getTime() - now.getTime() >= CANCEL_LOCK_MS,
    timeZone: cal.LOCAL_TZ,
    serverNow: _both(now),
    minLeadMinutes: MIN_LEAD_MS / 60_000,
    history: history.map(h => ({
      action: h.action, oldEnd: fmt(h.old_end_at), newEnd: fmt(h.new_end_at), reason: h.reason, createdAt: fmt(h.created_at),
    })),
  };
}

module.exports = {
  SeasonEndError, MIN_LEAD_MS, CANCEL_LOCK_MS,
  parseRequestedEnd, preview, setEnd, cancel, state,
};
