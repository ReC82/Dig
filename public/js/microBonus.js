/**
 * microBonus.js — Micro-bonus de dégâts fractionnaires (#81, étape C : BROUILLONS seulement).
 * Partagé par le jeu (navigateur) et le serveur (validation, aperçu admin) : aucune dépendance.
 *
 * Modèle déclaratif (un bonus = une ligne de configuration, jamais du code par objet) :
 *   { kind: 'damage_flat', value: 0,01–1 (au centième),
 *     target:   { type: 'all' } | { type: 'category', id: 'pierre' } | { type: 'block', id: 'pierre' },
 *     schedule: { from?: 'AAAA-MM-JJ', to?: 'AAAA-MM-JJ', months?: [1–12], weekdays?: [1–7 (lundi = 1)],
 *                 monthDays?: [1–31] (jours du mois, ex. 1–7 = première semaine de chaque mois, #86) },
 *     source?:  { eventId, itemId } }   // souvenir d'événement qui porterait l'effet (lien seul)
 * Toutes les conditions du calendrier se combinent (ET), évaluées sur la date civile de
 * Europe/Brussels ; calendrier vide = toujours. L'effet s'ajoute aux dégâts d'un COUP MANUEL
 * (pas à l'Auto-Dig, pas à la pioche émoussée #71) ; plusieurs bonus actifs s'additionnent, total
 * plafonné à STACK_CAP. Posséder l'objet est permanent ; seule la période d'ACTIVITÉ de l'effet varie.
 *
 * Rien n'active un bonus en production : le serveur n'enregistre que des brouillons et n'en
 * transmet aucun au jeu (GameState.eventBonuses reste vide) tant que le propriétaire n'a pas
 * décidé valeurs, durées et règle d'équité.
 */
(function (root) {
  'use strict';

  const TZ = 'Europe/Brussels';
  const KINDS = ['damage_flat'];
  const CATEGORIES = ['terre', 'pierre', 'minerai', 'coffre', 'gemme'];
  /** Bornes d'un bonus et du cumul (dégâts par coup). */
  const VALUE_MIN = 0.01;
  const VALUE_MAX = 1;
  const STACK_CAP = 1;
  const ID_RE = /^[a-z][a-z0-9_]{1,39}$/;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  const cents = v => Math.round(Number(v) * 100);

  class MicroBonusError extends Error {
    constructor(message) { super(message); this.status = 400; }
  }

  function _date(v, label) {
    if (v == null || v === '') return null;
    const s = String(v);
    const d = new Date(`${s}T00:00:00Z`);
    if (!DATE_RE.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
      throw new MicroBonusError(`${label} : date AAAA-MM-JJ attendue.`);
    }
    return s;
  }

  function _ints(list, min, max, label) {
    if (list == null || list === '') return null;
    // Saisie texte : « 1-7 » ou « 1, 15 » (plages inclusives, #86)
    const words = Array.isArray(list) ? list : String(list).split(/[;,\s]+/).filter(Boolean);
    const arr = [];
    for (const w of words) {
      const m = typeof w === 'string' && /^(\d+)\s*[-–]\s*(\d+)$/.exec(w);
      if (m && Number(m[2]) >= Number(m[1]) && Number(m[2]) - Number(m[1]) < 31) for (let n = Number(m[1]); n <= Number(m[2]); n++) arr.push(n);
      else arr.push(Number(w));
    }
    if (!arr.length) return null;
    if (arr.some(n => !Number.isInteger(n) || n < min || n > max)) throw new MicroBonusError(`${label} : entiers de ${min} à ${max}.`);
    return [...new Set(arr)].sort((a, b) => a - b);
  }

  /**
   * Bonus saisi → bonus normalisé (lève MicroBonusError si invalide).
   * La valeur est ramenée au centième ; une valeur hors bornes est refusée (jamais tronquée en silence).
   */
  function normalize(input) {
    const b = input && typeof input === 'object' ? input : {};
    const kind = b.kind ?? 'damage_flat';
    if (!KINDS.includes(kind)) throw new MicroBonusError('Type d\'effet inconnu (seul « dégâts par coup » existe).');
    const raw = Number(b.value);
    if (!Number.isFinite(raw)) throw new MicroBonusError('Intensité : nombre attendu.');
    const c = cents(raw);
    if (Math.abs(raw * 100 - c) > 1e-6) throw new MicroBonusError('Intensité : au plus 2 décimales (ex. 0,25).');
    if (c < cents(VALUE_MIN) || c > cents(VALUE_MAX)) throw new MicroBonusError(`Intensité : de ${VALUE_MIN} à ${VALUE_MAX} dégât par coup.`);

    const t = b.target && typeof b.target === 'object' ? b.target : { type: 'all' };
    let target;
    if (!t.type || t.type === 'all') target = { type: 'all' };
    else if (t.type === 'category') {
      if (!CATEGORIES.includes(t.id)) throw new MicroBonusError('Cible : catégorie de blocs inconnue.');
      target = { type: 'category', id: t.id };
    } else if (t.type === 'block') {
      if (typeof t.id !== 'string' || !ID_RE.test(t.id)) throw new MicroBonusError('Cible : identifiant de bloc invalide.');
      target = { type: 'block', id: t.id };
    } else throw new MicroBonusError('Cible : tous les blocs, une catégorie ou un bloc.');

    const s = b.schedule && typeof b.schedule === 'object' ? b.schedule : {};
    const schedule = {};
    const from = _date(s.from, 'Début'), to = _date(s.to, 'Fin');
    if (from) schedule.from = from;
    if (to) schedule.to = to;
    if (from && to && to < from) throw new MicroBonusError('Fin avant le début.');
    const months = _ints(s.months, 1, 12, 'Mois');
    const weekdays = _ints(s.weekdays, 1, 7, 'Jours de la semaine');
    if (months) schedule.months = months;
    if (weekdays) schedule.weekdays = weekdays;
    const monthDays = _ints(s.monthDays, 1, 31, 'Jours du mois');
    if (monthDays) schedule.monthDays = monthDays;

    const out = { kind, value: c / 100, target, schedule };
    if (b.source && typeof b.source === 'object' && (b.source.eventId || b.source.itemId)) {
      const { eventId, itemId } = b.source;
      if (!ID_RE.test(String(eventId ?? '')) || !ID_RE.test(String(itemId ?? ''))) {
        throw new MicroBonusError('Souvenir lié : identifiants d\'événement et d\'objet attendus.');
      }
      out.source = { eventId, itemId };
    }
    return out;
  }

  /** Date civile à Bruxelles : { ymd: 'AAAA-MM-JJ', month: 1–12, weekday: 1–7 (lundi = 1) }. */
  function brusselsDay(nowMs) {
    const parts = {};
    for (const p of new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
      .formatToParts(new Date(nowMs))) parts[p.type] = p.value;
    const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday) + 1;
    return { ymd: `${parts.year}-${parts.month}-${parts.day}`, month: Number(parts.month), day: Number(parts.day), weekday };
  }

  /** Le calendrier du bonus est-il ouvert à cet instant (heure de Bruxelles) ? */
  function isActiveAt(bonus, nowMs) {
    const s = bonus.schedule || {};
    const d = brusselsDay(nowMs);
    if (s.from && d.ymd < s.from) return false;
    if (s.to && d.ymd > s.to) return false;
    if (s.months && !s.months.includes(d.month)) return false;
    if (s.weekdays && !s.weekdays.includes(d.weekday)) return false;
    if (s.monthDays && !s.monthDays.includes(d.day)) return false;
    return true;
  }

  /** Le bonus vise-t-il ce type de bloc ({ id | name, category }) ? */
  function appliesTo(bonus, blockType) {
    const t = bonus.target || { type: 'all' };
    if (t.type === 'all') return true;
    if (!blockType) return false;
    if (t.type === 'category') return blockType.category === t.id;
    const id = blockType.id || String(blockType.name || '').replace(/^block\./, '');
    return id === t.id;
  }

  /** Bonus total (au centième, plafonné) des bonus actifs pour ce bloc à cet instant. */
  function total(bonuses, { block, nowMs = Date.now() } = {}) {
    if (!Array.isArray(bonuses) || !bonuses.length) return 0;
    let sum = 0;
    for (const b of bonuses) {
      if (!b || !KINDS.includes(b.kind) || !(b.value > 0)) continue;
      if (appliesTo(b, block) && isActiveAt(b, nowMs)) sum += Math.min(cents(b.value), cents(VALUE_MAX));
    }
    return Math.min(sum, cents(STACK_CAP)) / 100;
  }

  /** Dégâts d'un coup manuel à pleine puissance : base + bonus actifs, au centième. */
  function clickDamage(base, bonuses, ctx) {
    return Math.max(0, cents(base) + cents(total(bonuses, ctx))) / 100;
  }

  // ── Textes (aperçu admin ; fiche objet du joueur le jour où un effet sera activé) ──────────────

  const TXT = {
    fr: {
      gain: (v, n) => `+${v} dégât${n < 2 ? '' : 's'} par coup`,
      all: 'sur tous les blocs', cat: n => `sur les blocs de la catégorie « ${n} »`, block: n => `sur le bloc « ${n} »`,
      always: 'toujours', from: d => `à partir du ${d}`, to: d => `jusqu'au ${d}`, range: (a, b) => `du ${a} au ${b}`,
      months: m => `en ${m}`, weekdays: w => `les ${w}`,
      dayRange: (a, b) => `du ${a === 1 ? '1er' : a} au ${b} de chaque mois`, days: l => `le${l.includes(',') || l.includes(' et ') ? 's' : ''} ${l} de chaque mois`,
      next: d => `prochain créneau le ${d}`, until: d => `jusqu'au ${d} inclus`,
      and: ' et ', active: 'Actif actuellement', inactive: w => `Inactif — actif ${w}`, ended: d => `Terminé le ${d}`, soon: d => `Commence le ${d}`,
      monthNames: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
      dayNames: ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'],
    },
    en: {
      gain: v => `+${v} damage per hit`,
      all: 'on every block', cat: n => `on “${n}” blocks`, block: n => `on “${n}”`,
      always: 'always', from: d => `from ${d}`, to: d => `until ${d}`, range: (a, b) => `from ${a} to ${b}`,
      months: m => `in ${m}`, weekdays: w => `on ${w}`,
      dayRange: (a, b) => `on days ${a}–${b} of each month`, days: l => `on day${l.includes(',') || l.includes(' and ') ? 's' : ''} ${l} of each month`,
      next: d => `next window on ${d}`, until: d => `until ${d} included`,
      and: ' and ', active: 'Active now', inactive: w => `Inactive — active ${w}`, ended: d => `Ended on ${d}`, soon: d => `Starts on ${d}`,
      monthNames: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
      dayNames: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    },
  };

  function _num(v, lang) {
    try { return Number(v).toLocaleString(lang, { maximumFractionDigits: 2, useGrouping: false }); }
    catch (_) { return String(v); }
  }

  function _list(items, x) {
    if (items.length < 2) return items.join('');
    return `${items.slice(0, -1).join(', ')}${x.and}${items[items.length - 1]}`;
  }

  function _day(ymd, lang) {
    const [y, m, d] = ymd.split('-');
    return lang === 'en' ? `${y}-${m}-${d}` : `${d}/${m}/${y}`;
  }

  /** Période d'activité lisible (« les lundis en novembre », « du 01/11/2026 au 30/11/2026 »…). */
  function describeSchedule(schedule = {}, lang = 'fr') {
    const x = TXT[lang] || TXT.en;
    const bits = [];
    if (schedule.weekdays) {
      bits.push(x.weekdays(_list(schedule.weekdays.map(n => `${x.dayNames[n - 1]}s`), x)));
    }
    if (schedule.monthDays) {
      const m = schedule.monthDays;
      const contiguous = m.length > 2 && m[m.length - 1] - m[0] === m.length - 1;
      bits.push(contiguous ? x.dayRange(m[0], m[m.length - 1]) : x.days(_list(m.map(String), x)));
    }
    if (schedule.months) bits.push(x.months(_list(schedule.months.map(n => x.monthNames[n - 1]), x)));
    if (schedule.from && schedule.to) bits.push(x.range(_day(schedule.from, lang), _day(schedule.to, lang)));
    else if (schedule.from) bits.push(x.from(_day(schedule.from, lang)));
    else if (schedule.to) bits.push(x.to(_day(schedule.to, lang)));
    return bits.length ? bits.join(' ') : x.always;
  }

  /**
   * Texte d'effet : « +0,25 dégât par coup sur le bloc « Pierre » — les lundis ».
   * @param {object} names  { blocks: { id: nom }, categories: { id: nom } } (facultatif)
   */
  function describe(bonus, lang = 'fr', names = {}) {
    const x = TXT[lang] || TXT.en;
    const t = bonus.target || { type: 'all' };
    const where = t.type === 'category' ? x.cat(names.categories?.[t.id] || t.id)
      : t.type === 'block' ? x.block(names.blocks?.[t.id] || t.id) : x.all;
    const when = describeSchedule(bonus.schedule, lang);
    return `${x.gain(_num(bonus.value, lang), bonus.value)} ${where}${when === x.always ? '' : ` — ${when}`}`;
  }

  /** État à cet instant : { code: active | inactive | ended | upcoming, text }. */
  function stateAt(bonus, nowMs = Date.now(), lang = 'fr') {
    const x = TXT[lang] || TXT.en;
    const s = bonus.schedule || {};
    const d = brusselsDay(nowMs);
    if (s.to && d.ymd > s.to) return { code: 'ended', text: x.ended(_day(s.to, lang)) };
    if (s.from && d.ymd < s.from) return { code: 'upcoming', text: x.soon(_day(s.from, lang)) };
    if (isActiveAt(bonus, nowMs)) return { code: 'active', text: x.active };
    return { code: 'inactive', text: x.inactive(describeSchedule(s, lang)) };
  }

  /**
   * Prochaine bascule du calendrier (#86, « actif actuellement / prochain créneau ») : jour civil de
   * Bruxelles où l'état change. Actif → dernier jour actif (`until`) ; inactif → premier jour actif
   * (`next`). null si l'état ne change plus (toujours actif, ou plus jamais actif). Le calcul avance
   * de jour civil en jour civil (midi UTC) : indépendant des changements d'heure.
   */
  function nextChange(bonus, nowMs = Date.now(), { maxDays = 800 } = {}) {
    const today = brusselsDay(nowMs).ymd;
    const noon = ymd => Date.parse(`${ymd}T12:00:00Z`);
    const was = isActiveAt(bonus, noon(today));
    let prev = today;
    for (let k = 1; k <= maxDays; k++) {
      const ymd = new Date(noon(today) + k * 86_400_000).toISOString().slice(0, 10);
      if (isActiveAt(bonus, noon(ymd)) !== was) return was ? { code: 'until', ymd: prev } : { code: 'next', ymd };
      prev = ymd;
    }
    return null;
  }

  /** Texte « prochain créneau le 03/12/2026 » / « jusqu'au 07/12/2026 inclus » ('' si aucun changement). */
  function describeNext(bonus, nowMs = Date.now(), lang = 'fr') {
    const x = TXT[lang] || TXT.en;
    const n = nextChange(bonus, nowMs);
    return n ? x[n.code](_day(n.ymd, lang)) : '';
  }

  const MicroBonus = {
    TZ, KINDS, CATEGORIES, VALUE_MIN, VALUE_MAX, STACK_CAP, MicroBonusError,
    normalize, brusselsDay, isActiveAt, appliesTo, total, clickDamage, describe, describeSchedule, stateAt, nextChange, describeNext,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = MicroBonus;
  else root.MicroBonus = MicroBonus;
})(typeof globalThis !== 'undefined' ? globalThis : this);
