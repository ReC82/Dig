/**
 * server/seasonCalendar.js
 * Calendrier des saisons (ticket #16) : semaines ISO 8601, bornes UTC et format des dates.
 * Module pur (aucun accès à la base) : utilisé par db.js (seed) et seasons.js (rotation).
 *
 * Convention de stockage : "YYYY-MM-DD HH:MM:SS" en UTC, bornes incluses à la seconde.
 * Une saison hebdomadaire va du lundi 00:00:00 au dimanche 23:59:59 ; la suivante commence
 * à end_at + 1 s, ce qui garantit l'enchaînement sans trou.
 */

'use strict';

const SEC_MS  = 1000;
const DAY_MS  = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Formate une Date en "YYYY-MM-DD HH:MM:SS" UTC (format SQLite). */
function fmtUtc(d) {
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

/**
 * Lit une date stockée ou saisie et la retourne en Date UTC, ou null si invalide.
 * Formats acceptés : "YYYY-MM-DD", "YYYY-MM-DD HH:MM[:SS]", "YYYY-MM-DDTHH:MM[:SS[.mmm]]",
 * avec suffixe optionnel "Z" ou décalage "+HH:MM". Sans fuseau, la date est lue en UTC
 * (convention historique de la table seasons).
 */
function parseUtc(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
  if (typeof value !== 'string') return null;
  const m = value.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i,
  );
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00', tz] = m;
  const fields = [+y, +mo - 1, +d, +h, +mi, +s];
  let ms = Date.UTC(...fields);
  const back = new Date(ms);
  // Rejette les dates impossibles (31/02, 25:00…) que Date.UTC normaliserait silencieusement
  if (back.getUTCFullYear() !== fields[0] || back.getUTCMonth() !== fields[1] || back.getUTCDate() !== fields[2]
      || back.getUTCHours() !== fields[3] || back.getUTCMinutes() !== fields[4] || back.getUTCSeconds() !== fields[5]) {
    return null;
  }
  if (tz && tz.toUpperCase() !== 'Z') {
    const sign = tz[0] === '-' ? -1 : 1;
    const digits = tz.slice(1).replace(':', '');
    ms -= sign * (parseInt(digits.slice(0, 2), 10) * 60 + parseInt(digits.slice(2), 10)) * 60_000;
  }
  return new Date(ms);
}

/**
 * Fin effective d'une saison arrêtée à `now` : la seconde précédant la seconde en cours,
 * pour que la suivante (fin + 1 s) commence au plus tard maintenant, sans trou ni attente.
 */
function endBefore(now) {
  return new Date(Math.floor(now.getTime() / SEC_MS) * SEC_MS - SEC_MS);
}

/** Normalise une date saisie vers le format stocké, ou null si invalide. */
function normalizeDate(value) {
  const d = parseUtc(value);
  return d ? fmtUtc(d) : null;
}

/** Lundi 00:00:00 UTC de la semaine ISO contenant `date`. */
function weekStart(date) {
  const day = (date.getUTCDay() + 6) % 7; // 0 = lundi … 6 = dimanche
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day));
}

/** Bornes { start, end } (lundi 00:00:00 → dimanche 23:59:59 UTC) de la semaine contenant `date`. */
function weekBounds(date) {
  const start = weekStart(date);
  return { start, end: new Date(start.getTime() + WEEK_MS - SEC_MS) };
}

/** Semaine ISO 8601 { year, week } : la semaine 1 est celle qui contient le premier jeudi. */
function isoWeek(date) {
  const thursday = new Date(weekStart(date).getTime() + 3 * DAY_MS);
  const year     = thursday.getUTCFullYear();
  const jan1     = Date.UTC(year, 0, 1);
  return { year, week: 1 + Math.floor((thursday.getTime() - jan1) / WEEK_MS) };
}

/** Nom d'une saison commençant à `start` : "Saison <semaine ISO>-<année ISO>". */
function seasonName(start) {
  const { year, week } = isoWeek(start);
  return `Saison ${week}-${year}`;
}

/**
 * Période de la saison qui suit une saison terminée à `prevEnd` (inclus) :
 * début = prevEnd + 1 s ; fin = dimanche 23:59:59 de cette semaine. Si une saison
 * précédente se terminait en cours de semaine et qu'il resterait moins de 24 h,
 * la saison absorbe aussi la semaine suivante (pas de saison quasi vide).
 */
function nextSeasonPeriod(prevEnd) {
  const start = new Date(prevEnd.getTime() + SEC_MS);
  let   end   = weekBounds(start).end;
  if (end.getTime() - start.getTime() < DAY_MS - SEC_MS) end = new Date(end.getTime() + WEEK_MS);
  return { start, end };
}

/** Fuseau de référence du propriétaire et des joueurs (affichage et saisie admin, #44). */
const LOCAL_TZ = 'Europe/Brussels';

const _tzFormatters = new Map();
function _tzParts(date, tz) {
  let f = _tzFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    _tzFormatters.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  return [+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second];
}

/** Décalage (ms) du fuseau `tz` par rapport à UTC à l'instant `date` (+3 600 000 pour UTC+1). */
function tzOffsetMs(date, tz = LOCAL_TZ) {
  const ms = Math.floor(date.getTime() / SEC_MS) * SEC_MS;
  return Date.UTC(..._tzParts(new Date(ms), tz)) - ms;
}

/** Formate une Date en heure locale `tz` : "YYYY-MM-DD HH:MM:SS (UTC+1)". */
function fmtLocal(date, tz = LOCAL_TZ) {
  const [y, mo, d, h, mi, s] = _tzParts(date, tz);
  const pad = n => String(n).padStart(2, '0');
  const off = tzOffsetMs(date, tz) / 60_000;
  const offTxt = `UTC${off < 0 ? '-' : '+'}${Math.floor(Math.abs(off) / 60)}${Math.abs(off) % 60 ? ':' + pad(Math.abs(off) % 60) : ''}`;
  return `${y}-${pad(mo + 1)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(s)} (${offTxt})`;
}

/**
 * Convertit une heure locale "YYYY-MM-DD[T ]HH:MM[:SS]" du fuseau `tz` en Date UTC.
 * Retourne { date } ou { error: 'invalid' | 'nonexistent' | 'ambiguous' } : une heure sautée
 * (passage à l'heure d'été) ou répétée (retour à l'heure d'hiver) est refusée plutôt que devinée.
 */
function localToUtc(value, tz = LOCAL_TZ) {
  const m = typeof value === 'string'
    && value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return { error: 'invalid' };
  const fields = [+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)];
  const naive = Date.UTC(...fields);
  const back = new Date(naive);
  if (back.getUTCFullYear() !== fields[0] || back.getUTCMonth() !== fields[1] || back.getUTCDate() !== fields[2]
      || back.getUTCHours() !== fields[3] || back.getUTCMinutes() !== fields[4] || back.getUTCSeconds() !== fields[5]) {
    return { error: 'invalid' };
  }
  const offsets = new Set([tzOffsetMs(new Date(naive - DAY_MS), tz), tzOffsetMs(new Date(naive + DAY_MS), tz)]);
  const hits = [...offsets].map(o => naive - o)
    .filter(t => _tzParts(new Date(t), tz).every((v, i) => v === fields[i]));
  if (!hits.length) return { error: 'nonexistent' };
  if (hits.length > 1) return { error: 'ambiguous' };
  return { date: new Date(hits[0]) };
}

module.exports = {
  SEC_MS, DAY_MS, WEEK_MS,
  fmtUtc, parseUtc, normalizeDate, endBefore,
  weekStart, weekBounds, isoWeek, seasonName, nextSeasonPeriod,
  LOCAL_TZ, tzOffsetMs, fmtLocal, localToUtc,
};
