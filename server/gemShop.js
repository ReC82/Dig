/**
 * server/gemShop.js — Boutique en gemmes (#49, lot 2.6), DÉSACTIVÉE par défaut.
 *
 * Décision du propriétaire du 04/11 : développer derrière un drapeau OFF les articles à l'étude
 * (pioche dorée, pioche diamant — cosmétiques ; ramassage automatique des coffres de la mine —
 * confort ; boost ×2 pièces 30 min — temporaire), avec les prix de SIMULATION du rapport #49
 * (150 / 350 / 30 / 8 💎, lus dans les règles économiques publiées, economyRules.js). Aucun
 * paiement réel, aucune dépense ni crédit de test en production.
 *
 * Ouverture : drapeau `gem_shop_settings.enabled` = 1 (journalisé, double confirmation côté admin)
 * ET registre de gemmes en mode `enforce` (le solde de référence du serveur fait foi : un solde
 * écrit par le navigateur ne peut rien acheter). Sinon tout achat est refusé (403).
 *
 * Achat atomique et idempotent : une transaction contrôle l'article (actif, déjà possédé pour un
 * article permanent), débite le registre (gemLedger.spend, clé `gemshop:<userId>:<requestId>`) et
 * enregistre l'achat. Rejouer la même requête renvoie le même achat sans second débit. Achats et
 * journal en ajout seul. L'effet en jeu (skin, ramassage, boost) reste à brancher côté client,
 * après validation des prix (lot suivant).
 */

'use strict';

const db           = require('./db');
const gemLedger    = require('./gemLedger');
const economyRules = require('./economyRules');

const REQ_RE = /^[A-Za-z0-9_-]{8,48}$/;
/** Effet de chaque article (id → effet). Les articles permanents ne s'achètent qu'une fois. */
const EFFECTS = {
  skin_golden:   { permanent: true,  effect: { type: 'skin', value: 'golden' } },
  skin_diamond:  { permanent: true,  effect: { type: 'skin', value: 'diamond' } },
  auto_collect:  { permanent: true,  effect: { type: 'auto_collect' } },
  coin_boost_30: { permanent: false, effect: { type: 'boost', mult: 2, minutes: 30 } },
};

class GemShopError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

const conn = () => db.getDb();

function init() {
  conn().exec(`
    CREATE TABLE IF NOT EXISTS gem_shop_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO gem_shop_settings (key, value) VALUES ('enabled', '0');
    CREATE TABLE IF NOT EXISTS gem_shop_purchases (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_id     TEXT    NOT NULL,
      price       INTEGER NOT NULL,
      op_key      TEXT    NOT NULL,
      ledger_id   INTEGER,
      rules_version INTEGER NOT NULL,
      effect      TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, op_key)
    );
    CREATE INDEX IF NOT EXISTS idx_gem_shop_purchases_user ON gem_shop_purchases(user_id, item_id);
    CREATE TABLE IF NOT EXISTS gem_shop_audit (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      action     TEXT    NOT NULL,
      old_value  TEXT,
      new_value  TEXT,
      note       TEXT
    );
    CREATE TRIGGER IF NOT EXISTS trg_gem_shop_purchases_no_update BEFORE UPDATE ON gem_shop_purchases
      BEGIN SELECT RAISE(ABORT, 'gem_shop_purchases est en ajout seul (#49)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_gem_shop_purchases_no_delete BEFORE DELETE ON gem_shop_purchases
      BEGIN SELECT RAISE(ABORT, 'gem_shop_purchases est en ajout seul (#49)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_gem_shop_audit_no_update BEFORE UPDATE ON gem_shop_audit
      BEGIN SELECT RAISE(ABORT, 'gem_shop_audit est en ajout seul (#49)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_gem_shop_audit_no_delete BEFORE DELETE ON gem_shop_audit
      BEGIN SELECT RAISE(ABORT, 'gem_shop_audit est en ajout seul (#49)'); END;
  `);
}

function flagEnabled() {
  return conn().prepare("SELECT value FROM gem_shop_settings WHERE key = 'enabled'").get()?.value === '1';
}

/** Boutique ouverte aux joueurs : drapeau ET registre de gemmes faisant foi. */
function isOpen() {
  return flagEnabled() && gemLedger.getMode() === 'enforce';
}

/** Drapeau changé par l'admin, journalisé ; l'ouverture exige le registre en mode « fait foi ». */
function setEnabled(enabled, { note = '' } = {}) {
  enabled = enabled === true;
  return db.runTransaction(() => {
    const old = flagEnabled();
    if (old === enabled) return { enabled, changed: false };
    if (enabled && gemLedger.getMode() !== 'enforce') {
      throw new GemShopError(409, 'Ouverture refusée : le registre de gemmes doit d\'abord être en mode « fait foi ».', 'ledger_not_enforced');
    }
    conn().prepare("UPDATE gem_shop_settings SET value = ?, updated_at = datetime('now') WHERE key = 'enabled'").run(enabled ? '1' : '0');
    conn().prepare('INSERT INTO gem_shop_audit (action, old_value, new_value, note) VALUES (?, ?, ?, ?)')
      .run('enabled', old ? '1' : '0', enabled ? '1' : '0', String(note ?? '').slice(0, 300));
    return { enabled, changed: true };
  });
}

/** Articles et prix de la version publiée des règles économiques. */
function catalog() {
  const { version, rules } = economyRules.getPublished();
  const items = Object.entries(economyRules.GEM_SHOP_ITEMS).map(([id, def]) => ({
    id, kind: def.kind, price: rules.gemShop.items[id]?.price ?? def.price,
    enabled: rules.gemShop.items[id]?.enabled !== false,
    permanent: EFFECTS[id].permanent, effect: EFFECTS[id].effect,
  }));
  return { version, items };
}

function _purchaseRow(r) {
  return r && { id: r.id, itemId: r.item_id, price: r.price, rulesVersion: r.rules_version,
    effect: JSON.parse(r.effect), createdAt: r.created_at };
}

function ownedItems(userId) {
  return conn().prepare('SELECT DISTINCT item_id FROM gem_shop_purchases WHERE user_id = ?').all(userId).map(r => r.item_id)
    .filter(id => EFFECTS[id]?.permanent);
}

/** Vue joueur : fermée → seulement { open: false } (rien n'est affiché en jeu). */
function playerView(userId) {
  if (!isOpen()) return { open: false };
  return { open: true, ...catalog(), owned: ownedItems(userId), balance: gemLedger.authoritativeBalance(userId) };
}

/** Achat atomique et idempotent (voir l'en-tête). */
function buy(userId, itemId, requestId) {
  if (!isOpen()) throw new GemShopError(403, 'La boutique en gemmes n\'est pas ouverte.', 'closed');
  if (typeof requestId !== 'string' || !REQ_RE.test(requestId)) throw new GemShopError(400, 'Identifiant de requête invalide.', 'bad_request_id');
  if (!EFFECTS[itemId]) throw new GemShopError(404, 'Article inconnu.', 'unknown_item');
  const opKey = `gemshop:${userId}:${requestId}`;
  return db.runTransaction(() => {
    const prev = conn().prepare('SELECT * FROM gem_shop_purchases WHERE user_id = ? AND op_key = ?').get(userId, opKey);
    if (prev) {
      if (prev.item_id !== itemId) throw new GemShopError(409, 'Identifiant de requête déjà utilisé pour un autre article.', 'request_reused');
      return { purchase: _purchaseRow(prev), balance: gemLedger.authoritativeBalance(userId), replayed: true };
    }
    const { version, items } = catalog();
    const item = items.find(i => i.id === itemId);
    if (!item.enabled) throw new GemShopError(409, 'Article indisponible.', 'item_disabled');
    if (item.permanent && ownedItems(userId).includes(itemId)) throw new GemShopError(409, 'Article déjà possédé.', 'owned');
    const spent = gemLedger.spend(userId, item.price, opKey, { reason: 'gem_shop', details: { item: itemId, rulesVersion: version } });
    const info = conn().prepare(`INSERT INTO gem_shop_purchases (user_id, item_id, price, op_key, ledger_id, rules_version, effect)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(userId, itemId, item.price, opKey, spent.entryId, version, JSON.stringify(item.effect));
    const row = conn().prepare('SELECT * FROM gem_shop_purchases WHERE id = ?').get(info.lastInsertRowid);
    return { purchase: _purchaseRow(row), balance: spent.balance, replayed: false };
  });
}

function adminSummary() {
  return {
    flag: flagEnabled(), open: isOpen(), ledgerMode: gemLedger.getMode(),
    ...catalog(),
    totals: conn().prepare('SELECT item_id, COUNT(*) AS n, SUM(price) AS gems FROM gem_shop_purchases GROUP BY item_id').all(),
    audit: conn().prepare('SELECT * FROM gem_shop_audit ORDER BY id DESC LIMIT 30').all(),
  };
}

module.exports = { GemShopError, EFFECTS, init, flagEnabled, isOpen, setEnabled, catalog, ownedItems, playerView, buy, adminSummary };
