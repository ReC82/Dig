/**
 * tools/i18n/lib.js — Bibliothèque commune des traductions extensibles (#59)
 *
 * Source de vérité : le dictionnaire français intégré à public/js/i18n.js (T.fr).
 * Mémoire de traduction par langue : i18n/<code>.json (versionnée), une entrée par clé :
 *   { text, src, origin: 'ai' | 'human', by, at }
 *   - src    : empreinte du texte français traduit → une source modifiée remet la clé en file ;
 *   - origin : 'human' = correction d'un locuteur natif, JAMAIS écrasée par l'IA (signalée « à revoir »
 *              si le français change ensuite).
 * Fichier publié pour le navigateur : public/js/locales/<code>.js (généré par `build`).
 */
'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');

const ROOT  = path.join(__dirname, '..', '..');
const LANGS = require(path.join(ROOT, 'public', 'js', 'languages.js'));
// Lus à chaque appel : les tests travaillent dans un dossier temporaire
const storeDir  = () => process.env.DIG_I18N_DIR || path.join(ROOT, 'i18n');
const publicDir = () => process.env.DIG_I18N_PUBLIC_DIR || path.join(ROOT, 'public', 'js', 'locales');

/** Dictionnaires intégrés (fr, en, nl, es) lus depuis i18n.js, sans navigateur. */
function builtinDictionaries() {
  const code = fs.readFileSync(path.join(ROOT, 'public', 'js', 'i18n.js'), 'utf8')
    .replace('return { init,', 'return { _T: T, init,');
  const ctx = { console, localStorage: { getItem: () => null, setItem() {} }, document: { documentElement: {}, querySelectorAll: () => [] } };
  vm.createContext(ctx);
  vm.runInContext(`${code}\n;this.I18n = I18n;`, ctx);
  return JSON.parse(JSON.stringify(ctx.I18n._T));
}

const isPlural = v => !!v && typeof v === 'object' && typeof v.other === 'string';

/** Aplatit { a: { b: 'x' } } → { 'a.b': 'x' } (un pluriel { one, other } reste une feuille). */
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !isPlural(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

function unflatten(flat) {
  const out = {};
  for (const key of Object.keys(flat).sort()) {
    const parts = key.split('.');
    let o = out;
    for (const p of parts.slice(0, -1)) o = (o[p] ??= {});
    o[parts.at(-1)] = flat[key];
  }
  return out;
}

const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 12);

/** Textes sources (français) : { clé: texte }. */
function source() { return flatten(builtinDictionaries()[LANGS.FALLBACK]); }

function assertTranslatable(code) {
  const m = LANGS.get(code);
  if (!m || m.code !== code) throw new Error(`langue inconnue du registre : ${code}`);
  if (m.builtin) throw new Error(`${code} est intégrée à i18n.js : rien à générer`);
  return m;
}

const storeFile = code => path.join(storeDir(), `${code}.json`);

function loadStore(code) {
  const f = storeFile(code);
  if (!fs.existsSync(f)) return { lang: code, source: LANGS.FALLBACK, entries: {} };
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

/** Écriture atomique (reprise sûre après interruption). Clés triées : diff Git lisible. */
function saveStore(code, store) {
  fs.mkdirSync(storeDir(), { recursive: true });
  const entries = Object.fromEntries(Object.keys(store.entries).sort().map(k => [k, store.entries[k]]));
  const f = storeFile(code);
  fs.writeFileSync(`${f}.tmp`, JSON.stringify({ ...store, entries }, null, 1) + '\n');
  fs.renameSync(`${f}.tmp`, f);
}

/**
 * État de chaque clé : 'ok', 'missing' (jamais traduite), 'stale' (source FR modifiée, IA → à retraduire),
 * 'review' (source FR modifiée mais correction humaine → à revoir par un humain, jamais écrasée),
 * 'orphan' (clé supprimée du français).
 */
function status(code, src = source(), store = loadStore(code)) {
  const rows = [];
  for (const [key, fr] of Object.entries(src)) {
    const e = store.entries[key];
    let state = 'ok';
    if (!e) state = 'missing';
    else if (e.src !== hash(fr)) state = e.origin === 'human' ? 'review' : 'stale';
    rows.push({ key, fr, entry: e || null, state });
  }
  for (const key of Object.keys(store.entries)) if (!(key in src)) rows.push({ key, fr: null, entry: store.entries[key], state: 'orphan' });
  return rows;
}

/** File de traduction IA : seulement les clés manquantes ou dont la source a changé (hors corrections humaines). */
function queue(code, src, store) {
  return status(code, src, store).filter(r => r.state === 'missing' || r.state === 'stale');
}

/** Fichier navigateur : I18n.registerLocale('<code>', {...}) — clés à jour et sans erreur bloquante. */
function build(code, { check } = {}) {
  const m = assertTranslatable(code);
  const src = source();
  const store = loadStore(code);
  const flat = {};
  const errors = check ? check.errorsByKey(code, src, store) : {};
  for (const r of status(code, src, store)) {
    if (r.state === 'orphan' || !r.entry || errors[r.key]) continue;
    flat[r.key] = r.entry.text; // une traduction « stale » reste meilleure qu'un repli FR en attendant la file
  }
  const body = JSON.stringify(unflatten(flat), null, 1);
  const out = `/* Généré par tools/i18n (#59) depuis i18n/${code}.json — ne pas modifier à la main. */\n`
    + `/* ${m.englishName} (${m.status}) : ${Object.keys(flat).length}/${Object.keys(src).length} textes. Absents → français. */\n`
    + `I18n.registerLocale(${JSON.stringify(code)}, ${body});\n`;
  const file = path.join(publicDir(), `${code}.js`);
  fs.mkdirSync(publicDir(), { recursive: true });
  fs.writeFileSync(file, out);
  return { file, count: Object.keys(flat).length, total: Object.keys(src).length };
}

module.exports = { ROOT, LANGS, storeDir, publicDir, builtinDictionaries, flatten, unflatten, hash, isPlural, source,
  assertTranslatable, loadStore, saveStore, storeFile, status, queue, build };
