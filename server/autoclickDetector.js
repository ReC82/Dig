'use strict';
/**
 * autoclickDetector.js — Détection rapide des autoclickers basiques (#91, lot 1, décisions du
 * propriétaire du 08/11/2026). S'appuie sur les défis et suspensions du minage manuel (#25 lot C,
 * server/antibotResponses.js) : ce module ne sanctionne rien lui-même, il qualifie chaque fenêtre de
 * sauvegarde (≈ 12 s) et propose un déclencheur.
 *
 * Mesures du navigateur (télémétrie `f`, falsifiable : indices, jamais preuve seule) :
 *   - même pixel  : plus longue série de coups consécutifs aux mêmes coordonnées exactes (souris ou
 *                   tactile ; clavier et coups sans coordonnées exclus) ;
 *   - régularité  : sur ≥ 40 intervalles, écart robuste (1,4826 × MAD / médiane) ≤ 5 % ou ≥ 80 % des
 *                   intervalles dans les 3 classes de 4 ms les plus remplies (minuterie à paliers). Un
 *                   humain rapide varie de 8 à 20 % ; la gigue d'un autoclicker dans le navigateur reste
 *                   sous 5 ms. Inutilisable si l'horloge du navigateur est grossière (protection
 *                   anti-empreinte) : signal alors « inconnu » ;
 *   - immobilité  : coups de souris sans aucun déplacement du pointeur depuis le coup précédent ;
 *   - non fiables : coups générés par script (isTrusted = false, déjà mesuré par #25).
 * Mesure du serveur (horloge serveur, compteurs déclarés) :
 *   - cadence stable : clics par seconde identiques à ±2 % sur au moins 4 des 5 dernières fenêtres.
 *
 * Règles (aucun signal isolé ne suspend) :
 *   1. Même pixel ≥ ab_same_pixel_clicks (25)            → vérification (CAPTCHA), jamais suspension ;
 *      au plus une par ab_cooldown_min après la précédente (pas de boucle pour un joueur immobile).
 *   2. Automatisation corroborée = régularité machine + même pixel + un 3ᵉ indice (immobilité,
 *      clics non fiables ou cadence stable serveur)      → vérification immédiate ;
 *   3. Automatisation corroborée sur 2 fenêtres consécutives (≈ 24 s) moins de ab_fast_repeat_min
 *      après une vérification #91 RÉSOLUE (même pixel ou automatisation) → suspension du minage
 *      manuel (palier suivant 5 → 15 → 30 → 60 → 120 → 720 → 1440 min) + nouvelle vérification.
 * Une erreur ou l'expiration d'une énigme, une cadence élevée seule ou un pointeur immobile seul ne
 * suspendent jamais. Interrupteurs admin : ab_fast_mode (tout), ab_same_pixel_mode (règle 1),
 * ab_fast_suspend (règle 3). Le mode global des réponses (Désactivé / Observation / Appliqué) reste
 * prioritaire : en Observation, tout est simulé et journalisé.
 */

const SWITCHES = {
  ab_fast_mode:       { def: 'on', label: 'Détection rapide des autoclickers (#91)' },
  ab_same_pixel_mode: { def: 'on', label: 'Vérification après N clics au même pixel' },
  ab_fast_suspend:    { def: 'on', label: 'Suspension si automatisation corroborée répétée' },
};

const PARAMS = {
  ab_same_pixel_clicks: { def: 25, range: [10, 1000], label: 'Clics consécutifs au même pixel → vérification' },
  ab_fast_repeat_min:   { def: 60, range: [5, 1440],  label: 'Récidive : automatisation revue moins de N min après une vérification résolue → suspension' },
};

/** Seuils fixes de la corroboration (documentés dans le rapport #91). */
const REG_MIN_INTERVALS = 40;
const REG_TOP3_SHARE    = 0.8;
const REG_ROBUST_CV     = 0.05;
/** Fenêtres corroborées consécutives exigées pour une suspension (règle 3). */
const REPEAT_WINDOWS    = 2;
const REG_MAX_MEDIAN_MS = 1000;
const STILL_MIN_HITS    = 20;
const STILL_SHARE       = 0.9;
const UNTRUSTED_MIN     = 20;
const UNTRUSTED_SHARE   = 0.5;
const STEADY_WINDOWS    = 5;
const STEADY_MATCH      = 4;
const STEADY_TOLERANCE  = 0.02;
const STEADY_MIN_CPS    = 2;
const STEADY_MIN_SECS   = 8;

/** Taille des classes d'intervalles (ms) pour la régularité, partagée avec le client. */
const BIN_MS = 4;

function getSettings(config = {}) {
  const out = {};
  for (const [k, d] of Object.entries(SWITCHES)) {
    const v = String(config[k] ?? d.def).toLowerCase();
    out[k] = v === 'off' ? 'off' : 'on';
  }
  for (const [k, d] of Object.entries(PARAMS)) {
    const n = Number(config[k]);
    out[k] = Number.isFinite(n) && n >= d.range[0] && n <= d.range[1] ? n : d.def;
  }
  return out;
}

function validateConfigValue(key, raw) {
  const v = String(raw).trim().toLowerCase();
  if (Object.hasOwn(SWITCHES, key)) return v === 'on' || v === 'off' ? { value: v } : { error: `${key} : on ou off attendu.` };
  if (Object.hasOwn(PARAMS, key)) {
    const [min, max] = PARAMS[key].range;
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? { value: String(n) } : { error: `${key} : entier de ${min} à ${max} attendu.` };
  }
  return null;
}

/**
 * Normalise la partie `f` de la télémétrie (jamais crue : bornée, entiers ou parts 0..1).
 * @returns {{ k, t3, med, coarse, sp, run, mc, mm, still } | null}
 */
function normalizeFast(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return null;
  const int = v => (Number.isSafeInteger(v) && v >= 0 ? Math.min(v, 1e6) : 0);
  const share = v => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null);
  const med = typeof f.med === 'number' && Number.isFinite(f.med) && f.med > 0 ? Math.min(f.med, 1e6) : null;
  const mm = int(f.mm);
  const mad = typeof f.mad === 'number' && Number.isFinite(f.mad) && f.mad >= 0 ? Math.min(f.mad, 1e6) : null;
  return { k: int(f.k), t3: share(f.t3), med, mad, coarse: f.coarse === 1 || f.coarse === true,
    sp: int(f.sp), run: int(f.run), mc: int(f.mc), mm, still: Math.min(int(f.still), mm) };
}

/** Cadence stable mesurée par le serveur sur les dernières fenêtres [[atMs, secs, clicks], …]. */
function steadyRate(windows) {
  const w = (windows ?? []).slice(-STEADY_WINDOWS).filter(([, secs, clicks]) => secs >= STEADY_MIN_SECS && clicks / secs >= STEADY_MIN_CPS);
  if (w.length < STEADY_MATCH) return { steady: false, cps: null, windows: w.length };
  const rates = w.map(([, secs, clicks]) => clicks / secs).sort((a, b) => a - b);
  const med = rates[Math.floor(rates.length / 2)];
  const match = rates.filter(r => Math.abs(r - med) <= med * STEADY_TOLERANCE).length;
  return { steady: match >= STEADY_MATCH, cps: Math.round(med * 100) / 100, windows: w.length, match };
}

/**
 * Qualifie une fenêtre de sauvegarde. `tel` : télémétrie normalisée (#25) avec `f` normalisé.
 * @returns {{ regular, fixed, still, untrusted, steady, automation, samePixel, evidence }}
 */
function evaluate(tel, windows, settings) {
  const f = tel?.f ?? null;
  const st = steadyRate(windows);
  const regularKnown = !!f && !f.coarse && f.k >= REG_MIN_INTERVALS && f.med != null && (f.t3 != null || f.mad != null);
  const robustCv = regularKnown && f.mad != null ? 1.4826 * f.mad / f.med : null;
  const regular = regularKnown && f.med <= REG_MAX_MEDIAN_MS
    && ((robustCv != null && robustCv <= REG_ROBUST_CV) || (f.t3 != null && f.t3 >= REG_TOP3_SHARE));
  const sp = f ? Math.max(f.sp, f.run) : 0;
  const fixed = sp >= settings.ab_same_pixel_clicks;
  const still = !!f && f.mm >= STILL_MIN_HITS && f.still / f.mm >= STILL_SHARE;
  const untrusted = !!tel && tel.n >= UNTRUSTED_MIN && tel.u / tel.n >= UNTRUSTED_SHARE;
  const third = still || untrusted || st.steady;
  const evidence = {
    clicks: tel?.n ?? 0, samePixelRun: sp, samePixelThreshold: settings.ab_same_pixel_clicks,
    intervals: f?.k ?? 0, top3Share: f?.t3 ?? null, medianMs: f?.med ?? null,
    robustCv: robustCv == null ? null : Math.round(robustCv * 1000) / 1000, coarseTimer: !!f?.coarse,
    mouseHits: f?.mm ?? 0, stillHits: f?.still ?? 0, untrusted: tel?.u ?? 0,
    serverCps: st.cps, steadyWindows: st.steady ? st.match : 0,
  };
  return {
    regular, regularKnown, fixed, still, untrusted, steady: st.steady,
    automation: regular && fixed && third,
    samePixel: fixed,
    evidence,
  };
}

module.exports = {
  SWITCHES, PARAMS, BIN_MS, REG_MIN_INTERVALS, REG_TOP3_SHARE, REG_ROBUST_CV, REPEAT_WINDOWS, STILL_SHARE, UNTRUSTED_SHARE, STEADY_TOLERANCE,
  getSettings, validateConfigValue, normalizeFast, steadyRate, evaluate,
};
