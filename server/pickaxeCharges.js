/**
 * server/pickaxeCharges.js — Pioche à charges (#71, bêta, décision du propriétaire du 04/11/2026).
 *
 * Principe : la pioche a une RÉSERVE DE COUPS. Chaque frappe manuelle à pleine puissance consomme
 * 1 charge, quels que soient les PV du bloc ou la profondeur. À 0, la pioche est « émoussée » : 1 dégât
 * par coup, sans les bonus de la pioche (niveau de pioche, relique Œil du mineur), et les coups ne
 * consomment plus rien jusqu'à ce que la réserve remonte au SEUIL DE REPRISE (part de la capacité),
 * ce qui évite le yo-yo « 1 charge / 1 gros coup ». Recharge automatique continue, y compris hors
 * ligne. Jamais de blocage : on mine toujours. L'Auto-Dig, les bonus de pièces (Sac, reliques, boosts)
 * et la Chance ne sont pas concernés. Il n'existe pas de bombe dans le jeu (rien à exclure).
 *
 * Le moteur est côté navigateur (public/js/pickaxeCharges.js), comme le reste du jeu. Le serveur :
 *   - porte les RÉGLAGES (admin, journalisés) et le DRAPEAU : `off` (défaut, jeu inchangé), `testers`
 *     (seulement les comptes listés, pour la recette du propriétaire) ou `on` (tout le monde) ;
 *   - publie la configuration effective par joueur (GET /api/pickaxe/config) ;
 *   - OBSERVE chaque sauvegarde acceptée (anti-fraude) : réserve au-dessus de la capacité, recharge
 *     plus rapide que le temps SERVEUR écoulé, coups à pleine puissance au-delà des charges
 *     disponibles, niveaux d'arbre hors barème. Les écarts sont journalisés (admin) ; la sauvegarde
 *     n'est JAMAIS modifiée (même règle que le registre de gemmes en mode observation, #49).
 *
 * Arbres permanents en gemmes (capacité, vitesse de recharge) : niveaux dans la sauvegarde
 * (`pickaxe.capLevel`, `pickaxe.speedLevel`), conservés par le reset joueur, le changement de saison
 * et le reset admin partiel ; cloud = même compte sur tous les appareils. Les dépenses sont déduites
 * par le registre de gemmes (gemLedger.js) à partir de la montée des niveaux, comme l'Auto-Dig.
 * Recharges partielles en pièces (+10/25/50 % de la capacité) : coût proportionnel aux charges
 * RÉELLEMENT ajoutées (jamais de surfacturation près du maximum), prix par charge indexé sur la
 * profondeur comme la récompense des blocs (1 + 5 %/m).
 *
 * Valeurs par défaut = valeurs de DÉPART PRUDENTES de la bêta, choisies après simulation
 * (tools/balance/pickaxe-charges-sim.js, rapport docs/claude-reports/2026-11-05_ticket-71-…). Elles ne
 * sont PAS validées par le propriétaire : toutes réglables dans l'admin.
 */

'use strict';

const db = require('./db');

const MODES = ['off', 'testers', 'on'];
const MAX_LEVELS = 12;
const MAX_TESTERS = 50;

/** Réglages par défaut (bêta, à valider). Les arbres sont des multiplicateurs de la base. */
const DEFAULTS = Object.freeze({
  mode: 'off',
  testers: [],
  capacity: 1500,               // coups à pleine puissance, réserve pleine
  regenSeconds: 3,              // secondes par charge rechargée
  resumeThreshold: 0.10,        // bonus de retour à 10 % de la réserve après une panne
  capacityMult: [1, 1.5, 2.25, 3.25, 4.75, 7, 10, 15],    // ratios de l'étude exploratoire (100 → 1 500)
  capacityPrices: [5, 10, 20, 40, 80, 150, 300],          // gemmes pour passer au niveau 1, 2, …
  speedMult: [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3],      // durée de recharge (10 s → 3 s dans l'étude)
  speedPrices: [5, 10, 20, 40, 80, 150, 300],
  refillPacks: [10, 25, 50],    // % de la capacité
  refillCoinsPerCharge: 3,      // pièces par charge à 1 m (× 1 + 5 %/m, comme les blocs)
  refillEnabled: true,
});

const LIMITS = {
  capacity: [10, 1_000_000], regenSeconds: [0.2, 3600], resumeThreshold: [0, 0.5],
  capacityMult: [1, 1000], speedMult: [0.01, 1], price: [0, 1_000_000], pack: [1, 100], coins: [0, 1_000_000],
};

class PickaxeError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const conn = () => db.getDb();

/** Tables en ajout seul (journal, écarts) + réglages clé/valeur. Idempotent, sans effet sur l'existant. */
function init() {
  conn().exec(`
    CREATE TABLE IF NOT EXISTS pickaxe_charge_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS pickaxe_charge_audit (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      old_value  TEXT,
      new_value  TEXT    NOT NULL,
      note       TEXT
    );
    CREATE TABLE IF NOT EXISTS pickaxe_charge_state (
      user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      charges      REAL    NOT NULL,
      full_hits    INTEGER NOT NULL DEFAULT 0,
      refilled     INTEGER NOT NULL DEFAULT 0,
      cap_level    INTEGER NOT NULL DEFAULT 0,
      speed_level  INTEGER NOT NULL DEFAULT 0,
      observed_ms  INTEGER NOT NULL,
      revision     INTEGER NOT NULL DEFAULT 0,
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS pickaxe_charge_anomalies (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind       TEXT    NOT NULL,
      amount     REAL    NOT NULL,
      details    TEXT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pickaxe_charge_anomalies_user ON pickaxe_charge_anomalies(user_id, id);
    CREATE TRIGGER IF NOT EXISTS trg_pickaxe_charge_audit_no_update BEFORE UPDATE ON pickaxe_charge_audit
      BEGIN SELECT RAISE(ABORT, 'pickaxe_charge_audit est en ajout seul (#71)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_pickaxe_charge_audit_no_delete BEFORE DELETE ON pickaxe_charge_audit
      BEGIN SELECT RAISE(ABORT, 'pickaxe_charge_audit est en ajout seul (#71)'); END;
  `);
  conn().prepare(`INSERT INTO pickaxe_charge_settings (key, value) VALUES ('config', ?) ON CONFLICT(key) DO NOTHING`)
    .run(JSON.stringify(DEFAULTS));
}

// ── Réglages ─────────────────────────────────────────────────────────────────

function getSettings() {
  let raw = null;
  // Table absente (module pas encore initialisé, ex. registre de gemmes seul) : valeurs par défaut
  try { raw = conn().prepare("SELECT value FROM pickaxe_charge_settings WHERE key = 'config'").get()?.value; }
  catch { raw = null; }
  let stored = {};
  try { stored = raw ? JSON.parse(raw) : {}; } catch { stored = {}; }
  // Une clé ajoutée plus tard prend sa valeur par défaut ; une valeur stockée invalide aussi
  try { return validate({ ...DEFAULTS, ...stored }); }
  catch { return { ...DEFAULTS, testers: [] }; }
}

const _num = (v, [lo, hi], label) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < lo || n > hi) {
    throw new PickaxeError(400, `${label} : valeur entre ${lo} et ${hi} attendue.`);
  }
  return n;
};
/** Liste saisie dans l'admin : « 1 ; 1,5 ; 2 » ou « 1 1.5 2 » (virgule décimale admise), ou tableau JSON. */
const _list = (v, label, sep = /[;\s]+/) => {
  const arr = typeof v === 'string' ? v.split(sep).map(s => s.trim()).filter(Boolean) : v;
  if (!Array.isArray(arr)) throw new PickaxeError(400, `${label} : liste attendue.`);
  return arr;
};

/**
 * Valide un jeu complet de réglages (toutes les clés). Lève PickaxeError(400) avec un message lisible.
 * Arbres : multiplicateurs (niveau 0 = 1, capacité croissante, durée de recharge décroissante) et un
 * prix par niveau acheté (longueur = niveaux − 1).
 */
function validate(s) {
  const out = {};
  if (!MODES.includes(s.mode)) throw new PickaxeError(400, 'Mode inconnu (off, testers ou on).');
  out.mode = s.mode;
  const testers = _list(s.testers ?? [], 'Testeurs').map(Number);
  if (testers.length > MAX_TESTERS || testers.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new PickaxeError(400, `Testeurs : au plus ${MAX_TESTERS} comptes.`);
  }
  out.testers = [...new Set(testers)];
  out.capacity = Math.round(_num(s.capacity, LIMITS.capacity, 'Capacité de base'));
  out.regenSeconds = _num(s.regenSeconds, LIMITS.regenSeconds, 'Recharge (s par coup)');
  out.resumeThreshold = _num(s.resumeThreshold, LIMITS.resumeThreshold, 'Seuil de reprise');
  for (const [mk, pk, lim, label, dir] of [
    ['capacityMult', 'capacityPrices', LIMITS.capacityMult, 'Arbre capacité', 1],
    ['speedMult', 'speedPrices', LIMITS.speedMult, 'Arbre vitesse', -1],
  ]) {
    const mult = _list(s[mk], label).map((v, i) => _num(v, lim, `${label}, niveau ${i}`));
    if (mult.length < 1 || mult.length > MAX_LEVELS) throw new PickaxeError(400, `${label} : 1 à ${MAX_LEVELS} niveaux.`);
    if (mult[0] !== 1) throw new PickaxeError(400, `${label} : le niveau 0 vaut 1 (valeur de base).`);
    for (let i = 1; i < mult.length; i++) {
      if ((mult[i] - mult[i - 1]) * dir <= 0) {
        throw new PickaxeError(400, `${label} : chaque niveau doit ${dir > 0 ? 'augmenter' : 'réduire'} la valeur du précédent.`);
      }
    }
    const prices = _list(s[pk], `${label} (prix)`).map((v, i) => Math.round(_num(v, LIMITS.price, `${label}, prix du niveau ${i + 1}`)));
    if (prices.length !== mult.length - 1) throw new PickaxeError(400, `${label} : ${mult.length - 1} prix attendus (un par niveau acheté).`);
    out[mk] = mult;
    out[pk] = prices;
  }
  const packs = _list(s.refillPacks, 'Recharges').map(v => Math.round(_num(v, LIMITS.pack, 'Recharge (% de la capacité)')));
  if (packs.length > 5) throw new PickaxeError(400, 'Recharges : au plus 5 formules.');
  out.refillPacks = [...new Set(packs)].sort((a, b) => a - b);
  out.refillCoinsPerCharge = _num(s.refillCoinsPerCharge, LIMITS.coins, 'Prix d\'une charge (pièces)');
  out.refillEnabled = s.refillEnabled !== false && s.refillEnabled !== 'false';
  return out;
}

/**
 * Enregistre des réglages (fusion avec les réglages actuels), journalisé avec l'ancienne valeur.
 * `testers` peut contenir des pseudos : ils sont résolus en identifiants (pseudo inconnu → 400).
 */
function saveSettings(patch, { note = '' } = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new PickaxeError(400, 'Réglages invalides.');
  const cur = getSettings();
  const next = { ...cur };
  for (const k of Object.keys(DEFAULTS)) if (Object.hasOwn(patch, k)) next[k] = patch[k];
  if (Object.hasOwn(patch, 'testers')) next.testers = resolveTesters(patch.testers);
  const valid = validate(next);
  return db.runTransaction(() => {
    const old = JSON.stringify(cur);
    const neu = JSON.stringify(valid);
    if (old === neu) return { settings: valid, changed: false };
    conn().prepare(`INSERT INTO pickaxe_charge_settings (key, value, updated_at) VALUES ('config', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(neu);
    conn().prepare('INSERT INTO pickaxe_charge_audit (old_value, new_value, note) VALUES (?, ?, ?)')
      .run(old, neu, String(note ?? '').slice(0, 300));
    return { settings: valid, changed: true };
  });
}

/** Pseudos ou identifiants → identifiants de comptes existants. */
function resolveTesters(list) {
  const items = _list(list ?? [], 'Testeurs', /[;,\s]+/);
  if (items.length > MAX_TESTERS) throw new PickaxeError(400, `Testeurs : au plus ${MAX_TESTERS} comptes.`);
  const ids = [];
  for (const raw of items) {
    const s = String(raw).trim();
    if (!s) continue;
    const row = /^\d+$/.test(s)
      ? conn().prepare('SELECT id FROM users WHERE id = ?').get(Number(s))
      : conn().prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(s);
    if (!row) throw new PickaxeError(400, `Testeur inconnu : « ${s.slice(0, 40)} ».`);
    ids.push(row.id);
  }
  return [...new Set(ids)];
}

function isEnabledFor(userId, settings = getSettings()) {
  if (settings.mode === 'on') return true;
  if (settings.mode === 'testers') return Number.isSafeInteger(userId) && settings.testers.includes(userId);
  return false;
}

// ── Calculs partagés (mêmes formules que public/js/pickaxeCharges.js, vérifiées par test) ──

const _lvl = (v, max) => (Number.isSafeInteger(v) && v >= 0 ? Math.min(v, max) : 0);
function capacityAt(settings, capLevel) {
  return Math.round(settings.capacity * settings.capacityMult[_lvl(capLevel, settings.capacityMult.length - 1)]);
}
function regenSecondsAt(settings, speedLevel) {
  return settings.regenSeconds * settings.speedMult[_lvl(speedLevel, settings.speedMult.length - 1)];
}
/** Prix en pièces de `add` charges à la profondeur `depth` (indexé comme la récompense des blocs). */
function refillCost(settings, add, depth) {
  const d = Number.isFinite(depth) && depth >= 1 ? Math.floor(depth) : 1;
  return Math.ceil(add * settings.refillCoinsPerCharge * (1 + (d - 1) * 0.05));
}
/** Gemmes dépensées pour passer de `from` à `to` dans un arbre. */
function treeCost(prices, from, to) {
  let c = 0;
  for (let l = Math.max(0, from) + 1; l <= to; l++) c += prices[l - 1] ?? 0;
  return c;
}

/** Configuration publique pour ce joueur (rien d'autre que ce que le jeu affiche). */
function publicConfig(userId) {
  const s = getSettings();
  if (!isEnabledFor(userId ?? null, s)) return { enabled: false };
  return {
    enabled: true,
    capacity: s.capacity, regenSeconds: s.regenSeconds, resumeThreshold: s.resumeThreshold,
    capacityMult: s.capacityMult, capacityPrices: s.capacityPrices,
    speedMult: s.speedMult, speedPrices: s.speedPrices,
    refillPacks: s.refillEnabled ? s.refillPacks : [], refillCoinsPerCharge: s.refillCoinsPerCharge,
  };
}

// ── Observation des sauvegardes (anti-fraude, sans effet sur la sauvegarde) ───

const _int = v => (Number.isSafeInteger(v) && v >= 0 ? v : 0);
const ANOMALY_MIN_GAP_MS = 60_000;   // au plus un écart du même type par minute et par joueur

function _anomaly(userId, kind, amount, details, nowMs) {
  const last = conn().prepare('SELECT created_at FROM pickaxe_charge_anomalies WHERE user_id = ? AND kind = ? ORDER BY id DESC LIMIT 1').get(userId, kind);
  if (last && nowMs - Date.parse(`${last.created_at}Z`) < ANOMALY_MIN_GAP_MS) return;
  conn().prepare('INSERT INTO pickaxe_charge_anomalies (user_id, kind, amount, details, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, kind, Math.round(amount * 100) / 100, JSON.stringify(details ?? {}), new Date(nowMs).toISOString().slice(0, 19).replace('T', ' '));
}

/**
 * Observe une sauvegarde acceptée. Sans effet si la pioche à charges n'est pas active pour ce joueur
 * ou si la sauvegarde ne contient pas encore de réserve. Ne modifie jamais `data`.
 * Contrôles (temps du SERVEUR, pas l'horloge du navigateur) :
 *   over_capacity : réserve > capacité du niveau déclaré ;
 *   fast_regen    : réserve remontée plus vite que la recharge sur le temps écoulé + recharges achetées ;
 *   full_hits     : coups à pleine puissance > charges disponibles (réserve précédente + recharge + achats) ;
 *   tree_level    : niveau d'arbre au-delà du barème.
 * @returns {null | { anomalies: string[] }}
 */
function observeSave(userId, data, { revision = 0, nowMs = Date.now() } = {}) {
  const s = getSettings();
  if (!isEnabledFor(userId, s)) return null;
  const p = data?.pickaxe;
  if (!p || typeof p !== 'object' || !Number.isFinite(p.charges)) return null;
  const capLevel = _int(p.capLevel), speedLevel = _int(p.speedLevel);
  const charges = Math.max(0, p.charges);
  const fullHits = _int(p.fullHits), refilled = _int(p.refilled);
  const cap = capacityAt(s, capLevel);
  const regen = regenSecondsAt(s, speedLevel);
  const found = [];
  return db.runTransaction(() => {
    const prev = conn().prepare('SELECT * FROM pickaxe_charge_state WHERE user_id = ?').get(userId);
    if (capLevel > s.capacityMult.length - 1 || speedLevel > s.speedMult.length - 1) {
      found.push('tree_level');
      _anomaly(userId, 'tree_level', Math.max(capLevel, speedLevel), { capLevel, speedLevel, revision }, nowMs);
    }
    if (charges > cap + 1) {
      found.push('over_capacity');
      _anomaly(userId, 'over_capacity', charges - cap, { charges, cap, revision }, nowMs);
    }
    // Compteurs cumulés : une baisse (reset, autre appareil plus ancien) devient la nouvelle référence
    if (prev && fullHits >= prev.full_hits && refilled >= prev.refilled) {
      const elapsedS = Math.max(0, (nowMs - prev.observed_ms) / 1000);
      const bought = refilled - prev.refilled;
      // Tolérance : 2 charges + 15 s de recharge (requêtes retardées, horloges, arrondis)
      const margin = 2 + 15 / regen;
      const gainMax = elapsedS / regen + bought + margin;
      const used = fullHits - prev.full_hits;
      const available = Math.min(prev.charges + elapsedS / regen, cap) + bought + margin;
      if (charges - prev.charges + used > gainMax) {
        found.push('fast_regen');
        _anomaly(userId, 'fast_regen', charges - prev.charges - gainMax + used, { from: prev.charges, to: charges, elapsedS: Math.round(elapsedS), bought, used, revision }, nowMs);
      }
      if (used > available) {
        found.push('full_hits');
        _anomaly(userId, 'full_hits', used - available, { used, available: Math.floor(available), elapsedS: Math.round(elapsedS), revision }, nowMs);
      }
    }
    conn().prepare(`INSERT INTO pickaxe_charge_state (user_id, charges, full_hits, refilled, cap_level, speed_level, observed_ms, revision, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET charges = excluded.charges, full_hits = excluded.full_hits, refilled = excluded.refilled,
          cap_level = excluded.cap_level, speed_level = excluded.speed_level, observed_ms = excluded.observed_ms,
          revision = excluded.revision, updated_at = excluded.updated_at`)
      .run(userId, Math.min(charges, cap), fullHits, refilled, capLevel, speedLevel, nowMs, _int(revision));
    return { anomalies: found };
  });
}

// ── Admin ────────────────────────────────────────────────────────────────────

function adminSummary() {
  const s = getSettings();
  const names = s.testers.length
    ? conn().prepare(`SELECT id, username FROM users WHERE id IN (${s.testers.map(() => '?').join(',')})`).all(...s.testers)
    : [];
  const byId = Object.fromEntries(names.map(r => [r.id, r.username]));
  return {
    settings: s,
    defaults: DEFAULTS,
    testers: s.testers.map(id => ({ id, username: byId[id] ?? `#${id}` })),
    preview: {
      capacity: s.capacityMult.map((m, i) => ({ level: i, value: Math.round(s.capacity * m), price: i ? s.capacityPrices[i - 1] : 0 })),
      speed: s.speedMult.map((m, i) => ({ level: i, value: Math.round(s.regenSeconds * m * 100) / 100, price: i ? s.speedPrices[i - 1] : 0 })),
      fullRefillMinutes: Math.round(s.capacity * s.regenSeconds / 60),
      refill100m: s.refillPacks.map(pct => {
        const add = Math.round(s.capacity * pct / 100);
        return { pct, add, coins: refillCost(s, add, 100) };
      }),
    },
    players: conn().prepare(`SELECT st.user_id, u.username, st.charges, st.full_hits, st.refilled, st.cap_level, st.speed_level, st.updated_at
        FROM pickaxe_charge_state st LEFT JOIN users u ON u.id = st.user_id ORDER BY st.updated_at DESC LIMIT 50`).all(),
    anomalies: conn().prepare(`SELECT a.id, a.user_id, u.username, a.kind, a.amount, a.details, a.created_at
        FROM pickaxe_charge_anomalies a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 50`).all(),
    audit: conn().prepare('SELECT id, created_at, note, new_value FROM pickaxe_charge_audit ORDER BY id DESC LIMIT 20').all(),
  };
}

module.exports = {
  PickaxeError, DEFAULTS, MODES, init, getSettings, validate, saveSettings, resolveTesters, isEnabledFor,
  capacityAt, regenSecondsAt, refillCost, treeCost, publicConfig, observeSave, adminSummary,
};
