/**
 * server/fragmentPack.js — Lot de 10 fragments en euros (#85), DÉSACTIVÉ et NON ACHETABLE.
 *
 * Décision du propriétaire du 06/11 : préparer un seul lot facultatif (10 🔮) pour une possible
 * boutique après arbitrage, désactivé pour la bêta du 09/11. Aucun montant, plafond ni effet
 * n'est approuvé : 0,99 € TTC et « 1 par compte, 1 par saison » sont des HYPOTHÈSES de simulation.
 * L'achat de fragments en pièces reste interdit (décision #49 du 04/11) : rien ici n'y touche.
 *
 * Ce module ne contient AUCUN paiement : pas de prestataire, pas de collecte bancaire, pas de
 * crédit de fragments. Verrous :
 *   1. drapeau `enabled` = 0 par défaut ; son passage à 1 est REFUSÉ tant qu'aucun prestataire de
 *      paiement n'est branché (PAYMENT_PROVIDER = null, constante du code, pas un réglage) ;
 *   2. `checkout()` refuse toujours (403) : même un drapeau forcé en base ne permet aucun achat ;
 *   3. la vue joueur ne renvoie que { open: false } : rien n'est affiché en jeu.
 * L'admin règle le prix (centimes TTC) et les plafonds (par compte et par saison, jamais
 * illimités) ; chaque changement est journalisé (tables en ajout seul).
 *
 * La table `fragment_pack_orders` est le modèle des futures commandes (référence du prestataire
 * unique = idempotence des webhooks, saison, montant TTC, statut). Elle reste vide : aucune
 * fonction n'y écrit tant que l'intégration réelle (webhooks signés, livraison atomique côté
 * serveur, remboursement) n'est pas faite et validée — voir docs/claude-reports/…ticket-85….
 */

'use strict';

const db = require('./db');

/** Prestataire de paiement branché : aucun. Changer cette valeur exige une intégration réelle. */
const PAYMENT_PROVIDER = null;

/** Le produit : un seul lot, quantité fixe (pas d'autre pack). */
const PACK = Object.freeze({ id: 'fragments_10', fragments: 10, currency: 'EUR' });

/** Hypothèses de simulation (non approuvées) et bornes des réglages admin. */
const DEFAULTS = Object.freeze({ price_cents: 99, limit_per_account: 1, limit_per_season: 1 });
const BOUNDS = Object.freeze({ price_cents: [49, 999], limit_per_account: [1, 10], limit_per_season: [1, 10] });

class FragmentPackError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

const conn = () => db.getDb();

function init() {
  conn().exec(`
    CREATE TABLE IF NOT EXISTS fragment_pack_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO fragment_pack_settings (key, value) VALUES ('enabled', '0');
    INSERT OR IGNORE INTO fragment_pack_settings (key, value) VALUES ('price_cents', '${DEFAULTS.price_cents}');
    INSERT OR IGNORE INTO fragment_pack_settings (key, value) VALUES ('limit_per_account', '${DEFAULTS.limit_per_account}');
    INSERT OR IGNORE INTO fragment_pack_settings (key, value) VALUES ('limit_per_season', '${DEFAULTS.limit_per_season}');
    CREATE TABLE IF NOT EXISTS fragment_pack_orders (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      season_id     INTEGER,
      pack_id       TEXT    NOT NULL,
      fragments     INTEGER NOT NULL,
      amount_cents  INTEGER NOT NULL,
      currency      TEXT    NOT NULL,
      provider      TEXT    NOT NULL,
      provider_ref  TEXT    NOT NULL,
      status        TEXT    NOT NULL,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (provider, provider_ref)
    );
    CREATE INDEX IF NOT EXISTS idx_fragment_pack_orders_user ON fragment_pack_orders(user_id, season_id);
    CREATE TABLE IF NOT EXISTS fragment_pack_audit (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      action     TEXT    NOT NULL,
      old_value  TEXT,
      new_value  TEXT,
      note       TEXT
    );
    CREATE TRIGGER IF NOT EXISTS trg_fragment_pack_orders_no_update BEFORE UPDATE ON fragment_pack_orders
      BEGIN SELECT RAISE(ABORT, 'fragment_pack_orders est en ajout seul (#85)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_fragment_pack_orders_no_delete BEFORE DELETE ON fragment_pack_orders
      BEGIN SELECT RAISE(ABORT, 'fragment_pack_orders est en ajout seul (#85)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_fragment_pack_audit_no_update BEFORE UPDATE ON fragment_pack_audit
      BEGIN SELECT RAISE(ABORT, 'fragment_pack_audit est en ajout seul (#85)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_fragment_pack_audit_no_delete BEFORE DELETE ON fragment_pack_audit
      BEGIN SELECT RAISE(ABORT, 'fragment_pack_audit est en ajout seul (#85)'); END;
  `);
}

function _get(key) {
  return conn().prepare('SELECT value FROM fragment_pack_settings WHERE key = ?').get(key)?.value;
}

function flagEnabled() { return _get('enabled') === '1'; }

/** Offre ouverte aux joueurs : drapeau ET prestataire branché. Aujourd'hui : toujours faux. */
function isOpen() { return flagEnabled() && PAYMENT_PROVIDER !== null; }

function settings() {
  const n = k => { const v = parseInt(_get(k), 10); return Number.isFinite(v) ? v : DEFAULTS[k]; };
  return { enabled: flagEnabled(), priceCents: n('price_cents'), limitPerAccount: n('limit_per_account'), limitPerSeason: n('limit_per_season') };
}

function _audit(action, oldValue, newValue, note) {
  conn().prepare('INSERT INTO fragment_pack_audit (action, old_value, new_value, note) VALUES (?, ?, ?, ?)')
    .run(action, oldValue, newValue, String(note ?? '').slice(0, 300));
}

/** Activation : refusée tant qu'aucun prestataire de paiement n'est branché (voir l'en-tête). */
function setEnabled(enabled, { note = '' } = {}) {
  enabled = enabled === true;
  return db.runTransaction(() => {
    const old = flagEnabled();
    if (old === enabled) return { enabled, changed: false };
    if (enabled && PAYMENT_PROVIDER === null) {
      throw new FragmentPackError(409, 'Activation refusée : aucun prestataire de paiement n\'est branché. Il faut d\'abord l\'analyse de conformité, l\'intégration du paiement et le feu vert écrit du propriétaire (#85).', 'no_payment_provider');
    }
    conn().prepare("UPDATE fragment_pack_settings SET value = ?, updated_at = datetime('now') WHERE key = 'enabled'").run(enabled ? '1' : '0');
    _audit('enabled', old ? '1' : '0', enabled ? '1' : '0', note);
    return { enabled, changed: true };
  });
}

/**
 * Prix TTC (centimes) et plafonds : entiers bornés, jamais illimités. Seules les valeurs
 * modifiées sont journalisées. Aucun effet en jeu (offre fermée).
 */
function updateSettings(patch, { note = '' } = {}) {
  const map = { priceCents: 'price_cents', limitPerAccount: 'limit_per_account', limitPerSeason: 'limit_per_season' };
  const changes = [];
  for (const [field, key] of Object.entries(map)) {
    if (patch?.[field] === undefined) continue;
    const v = patch[field];
    const [min, max] = BOUNDS[key];
    if (!Number.isInteger(v) || v < min || v > max) throw new FragmentPackError(400, `${field} : entier de ${min} à ${max} attendu.`, 'bad_value');
    changes.push([key, v]);
  }
  if (!changes.length) throw new FragmentPackError(400, 'Aucune valeur à modifier.', 'empty');
  const cur = settings();
  if ((patch.limitPerSeason ?? cur.limitPerSeason) > (patch.limitPerAccount ?? cur.limitPerAccount)) {
    throw new FragmentPackError(400, 'Le plafond par saison ne peut pas dépasser le plafond par compte.', 'bad_limits');
  }
  return db.runTransaction(() => {
    let changed = 0;
    for (const [key, v] of changes) {
      const old = _get(key);
      if (old === String(v)) continue;
      conn().prepare("UPDATE fragment_pack_settings SET value = ?, updated_at = datetime('now') WHERE key = ?").run(String(v), key);
      _audit(key, old, String(v), note);
      changed++;
    }
    return { changed, settings: settings() };
  });
}

/** Lots déjà achetés (commandes payées) : sur le compte et dans la saison donnée. */
function purchasedCount(userId, seasonId) {
  const paid = "status = 'paid'";
  const account = conn().prepare(`SELECT COUNT(*) AS n FROM fragment_pack_orders WHERE user_id = ? AND ${paid}`).get(userId).n;
  const season = seasonId == null ? 0
    : conn().prepare(`SELECT COUNT(*) AS n FROM fragment_pack_orders WHERE user_id = ? AND season_id = ? AND ${paid}`).get(userId, seasonId).n;
  return { account, season };
}

/** Lots encore achetables : min(reste du compte, reste de la saison), jamais négatif. */
function remainingFor(userId, seasonId) {
  const s = settings();
  const c = purchasedCount(userId, seasonId);
  return Math.max(0, Math.min(s.limitPerAccount - c.account, s.limitPerSeason - c.season));
}

/** Présentation de l'offre (mêmes champs que la future vue joueur ouverte). */
function offer() {
  const s = settings();
  return { ...PACK, priceCents: s.priceCents, limitPerAccount: s.limitPerAccount, limitPerSeason: s.limitPerSeason };
}

/** Vue joueur : fermée → seulement { open: false } (rien n'est affiché en jeu). */
function playerView(userId, seasonId) {
  if (!isOpen()) return { open: false };
  return { open: true, offer: offer(), remaining: remainingFor(userId, seasonId) };
}

/** Paiement : refusé tant que l'offre n'est pas ouverte, et il n'existe aucun chemin de crédit. */
function checkout() {
  if (!isOpen()) throw new FragmentPackError(403, 'Le lot de fragments n\'est pas disponible.', 'closed');
  throw new FragmentPackError(501, 'Paiement non intégré.', 'not_implemented');
}

function adminSummary() {
  return {
    flag: flagEnabled(), open: isOpen(), provider: PAYMENT_PROVIDER,
    offer: offer(), bounds: BOUNDS, defaults: DEFAULTS,
    orders: conn().prepare("SELECT status, COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents FROM fragment_pack_orders GROUP BY status").all(),
    audit: conn().prepare('SELECT * FROM fragment_pack_audit ORDER BY id DESC LIMIT 30').all(),
  };
}

module.exports = { FragmentPackError, PAYMENT_PROVIDER, PACK, DEFAULTS, BOUNDS, init, flagEnabled, isOpen, settings,
  setEnabled, updateSettings, purchasedCount, remainingFor, offer, playerView, checkout, adminSummary };
