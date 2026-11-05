'use strict';
/**
 * blockHp.js — PV réels des blocs recalculés par le serveur (ticket #77, suite de #74 / #25 lot B).
 *
 * Le client tire la résistance de chaque bloc de façon reproductible (#35) :
 *   type « PV » = _pickType(profondeur, Chance neutre, rng(graine, n° du bloc, 'hp'))
 *   PV          = ceil(hpBase × (1 + 0,12 (profondeur − 1)) × (1 − réduction de PV))
 * Le serveur rejoue ici exactement le même calcul (même générateur, même pool, même ordre des
 * opérations flottantes) pour chaque bloc qu'une sauvegarde déclare détruit. Seuls les éléments
 * vérifiables sont pris tels quels (graine épinglée par le serveur, numéro du bloc, profondeur,
 * catalogue) ; les bonus non vérifiables sont pris au maximum en faveur du joueur :
 *   - réduction de PV : 50 % (plafond des reliques, antibot.MAX_HP_REDUCTION) → borne inférieure ;
 *   - catalogue : minimum sur les variantes que le client peut avoir chargées.
 * Le résultat est donc une borne INFÉRIEURE des PV réellement infligés, égale aux PV réels d'un
 * joueur qui possède la réduction maximale.
 *
 * Correspondance n° de bloc ↔ profondeur : chaque destruction tire le bloc suivant (n° + 1) ; un
 * « reroll » (ou une reprise impossible au chargement) consomme un n° sans descendre. Entre deux
 * sauvegardes, les blocs détruits aux profondeurs D0..D1−1 ont donc des n° strictement croissants
 * pris dans une fenêtre de largeur (D1 − D0) + k, k = n° « sautés ». minCostWalk() calcule le coût
 * minimal sur TOUTES les façons de placer au plus K sauts (programmation dynamique) : aucun joueur
 * honnête ne peut avoir infligé moins.
 */

const HP_SCALE_PER_M = 0.12;

/** Au-delà de ce nombre de sauts dans une fenêtre, le calcul exact laisse place à la borne minimale. */
const MAX_DP_SKIPS = 32;

// ── Catalogues que le client peut utiliser ───────────────────────────────────

/**
 * Type du catalogue → champs utiles au tirage, avec la sémantique exacte de Blocks._fromCatalog
 * (public/js/blocks.js). null si le client refuserait ce type (le catalogue entier est alors refusé).
 */
function _fromCatalog(c, { fade = true } = {}) {
  if (!c || typeof c.id !== 'string' || !/^[a-z][a-z0-9_]{1,39}$/.test(c.id)) return null;
  const num = (v, min) => (Number.isFinite(v) && v >= min ? v : null);
  const hpBase = num(c.hpBase, 1), reward = num(c.reward, 0), minDepth = num(c.minDepth, 1), weight = num(c.weight, 0);
  if (hpBase === null || reward === null || minDepth === null || weight === null) return null;
  const fadeFrom = num(c.fadeFrom, minDepth), fadeWeight = num(c.fadeWeight, 0);
  const keepFade = fade && fadeFrom !== null && fadeWeight > 0;
  return { id: c.id, hpBase, minDepth, weight, fadeFrom: keepFade ? fadeFrom : null, fadeWeight: keepFade ? fadeWeight : 0, active: c.active !== false };
}

/** Variante de catalogue (tableau de types) ou null si le client la refuserait (Blocks.applyCatalog). */
function _variant(types, opts) {
  if (!Array.isArray(types) || !types.length) return null;
  const out = types.map(t => _fromCatalog(t, opts));
  if (out.some(x => !x) || !out.some(x => x.active)) return null;
  return { types: out, pools: new Map() };
}

let _builtin = null;              // catalogue intégré au jeu (Blocks.TYPES, version 0)
let _versions = new Map();        // version publiée → { f2, f1 } (format 2 / projection format 1)
let _latest = 0;

/**
 * Enregistre les catalogues connus (appelé par blockCatalog.refreshAntibot à chaque publication).
 * @param {object[]} builtinTypes  Blocks.TYPES du client, au format catalogue
 * @param {{ version: number, types: object[] }[]} versions  Toutes les versions publiées
 */
function setCatalogs(builtinTypes, versions = []) {
  _builtin = _variant(builtinTypes);
  _versions = new Map();
  _latest = 0;
  for (const v of versions) {
    // Format 1 (client d'avant l'étape B) : ni atténuation ni gemReward (blockCatalog.publicCatalog)
    const f2 = _variant(v.types), f1 = _variant(v.types, { fade: false });
    if (f2 || f1) _versions.set(v.version, { f2, f1 });
    if (v.version > _latest) _latest = v.version;
  }
}

/**
 * Variantes à considérer pour une sauvegarde.
 * - version déclarée connue (client à jour) : catalogue intégré (premier bloc avant réception du
 *   catalogue), version en vigueur et version déclarée ;
 * - sinon (ancien client, version inconnue) : catalogue intégré et toutes les versions publiées.
 * Chaque variante est évaluée séparément par l'appelant (un seul catalogue par fenêtre).
 */
function variantsFor(claimedVersion) {
  const out = new Set();
  if (_builtin) out.add(_builtin);
  const known = Number.isInteger(claimedVersion) && (claimedVersion === 0 || _versions.has(claimedVersion));
  if (known) {
    const latest = _versions.get(_latest);
    if (latest?.f2) out.add(latest.f2);
    const claimed = _versions.get(claimedVersion);
    if (claimed?.f2) out.add(claimed.f2);
  } else {
    // Version non déclarée (client d'avant #77) : toutes les versions publiées, telles que le jeu
    // actuel les reçoit (format 2). Le format 1 (sans atténuation, clients d'avant l'étape B) est
    // réservé au contrôle du bloc courant : il rendrait la terre meuble (3 PV) courante partout.
    for (const v of _versions.values()) if (v.f2) out.add(v.f2);
  }
  return [...out];
}

/** Toutes les variantes connues, formats 1 et 2 (contrôle du bloc courant, le plus tolérant). */
function allVariants() {
  const out = new Set(variantsFor(undefined));
  for (const v of _versions.values()) if (v.f1) out.add(v.f1);
  return [...out];
}

function isReady() { return !!_builtin; }

/** Catalogue intégré chargé à la demande (scripts et tests qui n'initialisent pas blockCatalog). */
function ensureReady() {
  if (!_builtin) {
    try { setCatalogs(require('./blockCatalog').originTypes(), []); }
    catch (err) { console.error('[blockHp] catalogue intégré', err.message); }
  }
  return isReady();
}

// ── Tirage (copie exacte de public/js/blocks.js) ─────────────────────────────

/** Premier tirage du générateur rng(seq, salt) du client (Blocks.rng, mulberry32). */
function firstRandom(seed, seq, salt) {
  let h = 2166136261 ^ seed;
  for (const ch of `${seq}:${salt}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let a = h >>> 0;
  a = (a + 0x6D2B79F5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const POOL_CACHE_MAX = 20_000;

/** Pool neutre (Chance 1) à la profondeur d : Blocks._pool(depth, 1). */
function _pool(variant, depth) {
  let p = variant.pools.get(depth);
  if (p) return p;
  const entries = [];
  for (const t of variant.types) {
    if (!(t.active !== false && depth >= t.minDepth)) continue;
    // weightAt × 1 (raretés boostées : multiplicateur neutre, x × 1 === x)
    entries.push({ hpBase: t.hpBase, w: t.fadeFrom != null && depth > t.fadeFrom ? t.fadeWeight : t.weight });
  }
  const total = entries.reduce((s, e) => s + e.w, 0);
  const fallback = (variant.types.find(t => t.id === 'pierre') || variant.types[0]).hpBase;
  p = { entries, total, fallback };
  if (variant.pools.size >= POOL_CACHE_MAX) variant.pools.clear();
  variant.pools.set(depth, p);
  return p;
}

/** hpBase tiré par Blocks._pickType(depth, 1, random) pour le premier tirage `r`. */
function _pickHpBase(variant, depth, r) {
  const { entries, total, fallback } = _pool(variant, depth);
  if (entries.length === 0) return fallback;
  let rand = r * total;
  for (const e of entries) {
    rand -= e.w;
    if (rand <= 0) return e.hpBase;
  }
  return entries[entries.length - 1].hpBase;
}

/**
 * PV minimum du bloc n° `seq` tiré à la profondeur `depth` (réduction de PV `maxReduction`,
 * minimum sur les variantes). Même ordre d'opérations que Blocks.spawn : un joueur qui a cette
 * réduction a exactement ces PV ; avec moins de réduction, il en a davantage.
 */
function blockHp(seed, seq, depth, variants, maxReduction, r = firstRandom(seed, seq, 'hp')) {
  const scale = 1 + (depth - 1) * HP_SCALE_PER_M;
  let min = Infinity;
  for (const v of variants) {
    const hp = Math.ceil(_pickHpBase(v, depth, r) * scale * (1 - maxReduction));
    if (hp < min) min = hp;
  }
  return min;
}

// ── Coût minimal d'une suite de blocs ────────────────────────────────────────

/**
 * Profondeur maximale atteignable depuis `from` avec `credit` PV, sans dépasser `target`, en
 * payant les PV réels (bornés inférieurement) des blocs from..depth−1.
 * Le bloc à la profondeur from + j porte le n° lowSeq + j + s, s = sauts déjà faits (0 ≤ s ≤ K),
 * s croissant avec j. Coût minimal sur tous les placements : f_j(s) = PV(j, s) + min_{s' ≤ s} f_{j−1}(s').
 *
 * @returns {{ depth: number, spent: number, steps: number }}
 */
function minCostWalk({ seed, lowSeq, skips, from, credit, target, variants, maxReduction }) {
  const K = Math.max(0, Math.min(MAX_DP_SKIPS, Math.floor(skips)));
  if (!(target > from) || !(credit > 0)) return { depth: from, spent: 0, steps: 0 };
  let f = new Float64Array(K + 1);            // f_0 = 0
  const rCache = new Map();
  const rAt = seq => {
    let r = rCache.get(seq);
    if (r === undefined) { r = firstRandom(seed, seq, 'hp'); rCache.set(seq, r); }
    return r;
  };
  let depth = from, spent = 0, steps = 0;
  while (depth < target) {
    const j = depth - from;
    const next = new Float64Array(K + 1);
    let prefix = Infinity, best = Infinity;
    for (let s = 0; s <= K; s++) {
      if (f[s] < prefix) prefix = f[s];
      const seq = lowSeq + j + s;
      next[s] = prefix + blockHp(seed, seq, depth, variants, maxReduction, rAt(seq));
      if (next[s] < best) best = next[s];
    }
    steps++;
    if (best > credit) break;
    f = next;
    spent = best;
    depth++;
    if (rCache.size > 4 * (K + 1)) rCache.clear();
  }
  return { depth, spent, steps };
}

module.exports = {
  HP_SCALE_PER_M, MAX_DP_SKIPS,
  setCatalogs, variantsFor, allVariants, isReady, ensureReady,
  firstRandom, blockHp, minCostWalk,
  _fromCatalog,
};
