/**
 * tools/i18n/check.js — Contrôles qualité automatiques des traductions (#59)
 *
 * Erreurs (texte exclu du fichier publié, la clé retombe sur le français) :
 *   variable {x} perdue/ajoutée, balise HTML différente, texte vide, mauvaise écriture (latin/cyrillique),
 *   pluriel sans forme « other ».
 * Avertissements (revue humaine conseillée) :
 *   texte identique au français (oubli ?), trop long pour mobile, emoji perdu, même traduction pour
 *   deux sources différentes, langue improbable (mots outils d'une autre langue).
 */
'use strict';

const lib = require('./lib');

const forms = v => (lib.isPlural(v) ? Object.entries(v).filter(([k]) => k !== '$n').map(([, s]) => s) : [v]);
// Les marques de pluriel {s}, {s1}… dépendent de la grammaire de chaque langue : facultatives
const varsOf = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).filter(v => !/^s\d?$/.test(v));
const varSet = v => [...new Set(forms(v).flatMap(varsOf))].sort().join(',');
const tagsOf = v => forms(v).flatMap(s => String(s).match(/<\/?[a-z][^>]*>/gi) || []).map(t => t.toLowerCase().replace(/\s+/g, ' ')).sort().join('');
const EMOJI = /\p{Extended_Pictographic}/gu;
const emojis = v => [...new Set(forms(v).flatMap(s => String(s).match(EMOJI) || []))].sort().join('');
const plain = v => forms(v).join(' ');

// Mots outils distinctifs (les mots communs à plusieurs langues — la, le, con, una… — sont exclus)
const STOP = {
  fr: ['les', 'des', 'du', 'est', 'pour', 'avec', 'une', 'dans', 'pas', 'ton', 'tes', 'sur', 'et', 'aux', 'ce', 'vous'],
  en: ['the', 'and', 'your', 'you', 'with', 'for', 'is', 'of', 'to', 'this', 'not'],
  nl: ['het', 'een', 'van', 'je', 'jouw', 'met', 'voor', 'niet', 'op', 'ook'],
  es: ['el', 'los', 'las', 'y', 'para', 'tus', 'es', 'por', 'muy', 'cuando'],
  it: ['il', 'gli', 'della', 'dei', 'per', 'tuo', 'tua', 'tuoi', 'è', 'non', 'di', 'che', 'sono'],
  ru: ['и', 'в', 'не', 'на', 'что', 'с', 'твой', 'для'],
};
function guessLang(text) {
  const words = String(text).toLowerCase().replace(/\{\w+\}/g, ' ').split(/[^\p{L}']+/u).filter(Boolean);
  const score = Object.fromEntries(Object.entries(STOP).map(([l, list]) => [l, words.filter(w => list.includes(w)).length]));
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return { best: best[0], score };
}

function letters(text, re) { return (String(text).replace(/\{\w+\}/g, '').match(re) || []).length; }

/** Contrôle d'une traduction ; renvoie { errors: [], warnings: [] }. */
function checkEntry(code, key, fr, text, { builtins } = {}) {
  const m = lib.LANGS.get(code) || { script: 'Latn' };
  const errors = [];
  const warnings = [];
  if (text == null || (typeof text !== 'string' && !lib.isPlural(text))) return { errors: ['texte absent ou de forme invalide'], warnings };
  if (forms(text).some(s => typeof s !== 'string' || !s.trim())) errors.push('texte vide');
  if (varSet(text) !== varSet(fr)) errors.push(`variables {…} différentes du français (attendu : ${varSet(fr) || 'aucune'} ; trouvé : ${varSet(text) || 'aucune'})`);
  if (tagsOf(text) !== tagsOf(fr)) errors.push('balises HTML différentes du français');
  const latin = letters(plain(text), /\p{Script=Latin}/gu);
  const cyr = letters(plain(text), /\p{Script=Cyrillic}/gu);
  if (m.script === 'Cyrl' && latin + cyr >= 4 && cyr < (latin + cyr) / 2) errors.push('écriture cyrillique attendue');
  if (m.script === 'Latn' && cyr > 0) errors.push('caractères cyrilliques inattendus');
  if (errors.length) return { errors, warnings };

  const frPlain = plain(fr);
  const tPlain = plain(text);
  const sameInOthers = builtins && ['en', 'nl', 'es'].some(l => builtins[l]?.[key] === fr);
  if (tPlain === frPlain && /\p{L}{3}/u.test(frPlain.replace(/\{\w+\}/g, '')) && !sameInOthers) warnings.push('identique au français (oubli ?)');
  const short = frPlain.length <= 24 && /^(nav|stats|ui\.btn|settings|season\.(title|leaderboard))/.test(key);
  if (short && tPlain.length > Math.max(frPlain.length * 1.4, frPlain.length + 8)) warnings.push(`long pour mobile (${tPlain.length} car. contre ${frPlain.length} en FR)`);
  if (emojis(fr) && emojis(text) !== emojis(fr)) warnings.push('emoji différent du français');
  const g = guessLang(tPlain);
  if (STOP[code] && g.best !== code && g.score[g.best] >= 2 && g.score[g.best] > (g.score[code] || 0)) warnings.push(`langue improbable (ressemble à : ${g.best})`);
  return { errors, warnings };
}

/** Rapport complet d'une langue. */
function report(code, src = lib.source(), store = lib.loadStore(code)) {
  const all = lib.builtinDictionaries();
  const builtins = Object.fromEntries(Object.keys(all).map(l => [l, lib.flatten(all[l])]));
  const rows = lib.status(code, src, store);
  const issues = [];
  const byText = new Map();
  for (const r of rows) {
    if (r.state === 'orphan' || !r.entry) continue;
    const { errors, warnings } = checkEntry(code, r.key, r.fr, r.entry.text, { builtins });
    if (errors.length || warnings.length) issues.push({ key: r.key, errors, warnings, origin: r.entry.origin });
    if (typeof r.entry.text === 'string') {
      const t = r.entry.text.trim().toLowerCase();
      if (!byText.has(t)) byText.set(t, []);
      byText.get(t).push(r);
    }
  }
  const duplicates = [...byText.values()]
    .filter(list => list.length > 1 && new Set(list.map(r => typeof r.fr === 'string' ? r.fr.trim().toLowerCase() : JSON.stringify(r.fr))).size > 1)
    .map(list => ({ text: list[0].entry.text, keys: list.map(r => r.key) }));
  const count = s => rows.filter(r => r.state === s).length;
  const total = Object.keys(src).length;
  const errorKeys = new Set(issues.filter(i => i.errors.length).map(i => i.key));
  const ok = rows.filter(r => r.state === 'ok' && !errorKeys.has(r.key)).length;
  return {
    lang: code, total, ok, coverage: total ? Math.round((ok / total) * 1000) / 10 : 100,
    missing: count('missing'), stale: count('stale'), review: count('review'), orphan: count('orphan'),
    human: rows.filter(r => r.entry?.origin === 'human').length,
    errors: issues.filter(i => i.errors.length).length,
    warnings: issues.filter(i => i.warnings.length).length,
    issues, duplicates,
    reviewKeys: rows.filter(r => r.state === 'review').map(r => r.key),
  };
}

function errorsByKey(code, src, store) {
  const all = lib.builtinDictionaries();
  const builtins = Object.fromEntries(Object.keys(all).map(l => [l, lib.flatten(all[l])]));
  const out = {};
  for (const r of lib.status(code, src, store)) {
    if (!r.entry || r.state === 'orphan') continue;
    const { errors } = checkEntry(code, r.key, r.fr, r.entry.text, { builtins });
    if (errors.length) out[r.key] = errors;
  }
  return out;
}

/**
 * Textes oubliés côté code : clés littérales utilisées (t('…'), data-i18n*="…") absentes du français.
 * Un joueur verrait la clé technique : à corriger avant toute activation. Clés dynamiques (`…${x}`) ignorées.
 */
function scanCode(src = lib.source()) {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(lib.ROOT, 'public');
  const files = ['index.html', ...fs.readdirSync(path.join(dir, 'js')).filter(f => f.endsWith('.js') && f !== 'i18n.js').map(f => `js/${f}`)];
  const missing = [];
  const re = /(?:\bt\(\s*|I18n\.t\(\s*)'([a-z_]+(?:\.[A-Za-z0-9_]+)+)'|data-i18n(?:-aria|-title|-placeholder)?="([a-z_]+(?:\.[A-Za-z0-9_]+)+)"/g;
  let used = 0;
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of text.matchAll(re)) {
      used++;
      const key = m[1] || m[2];
      const v = src[key];
      if (v === undefined) missing.push({ file: f, key });
    }
  }
  return { used, missing };
}

module.exports = { checkEntry, report, errorsByKey, guessLang, varSet, scanCode };
