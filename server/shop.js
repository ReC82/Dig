/**
 * server/shop.js — Boutique de cadeaux : catalogue, échange de points et suivi des commandes (#34).
 *
 * Règles (phase 1, décisions du propriétaire du 30/10/2026, #27 et #33) :
 *   - les articles se paient en points de récompense saisonniers (#33), jamais en pièces,
 *     gemmes ni argent ; aucun tirage, aucune boîte mystère : le joueur choisit l'article ;
 *   - deux sortes d'articles : `virtual` (récompense virtuelle, remise manuelle par l'admin) et
 *     `real` (cadeau réel : carte cadeau…). Les échanges `real` sont **refusés** tant que
 *     CONTEST_REAL_PRIZES ≠ « on » (le registre des points le refuse aussi) ; l'interface les
 *     présente comme « bientôt » ;
 *   - échange atomique et idempotent : dans UNE transaction, contrôle de l'article (visible,
 *     disponible, période de validité, stock, limite par joueur), débit du portefeuille avec la
 *     clé `shop:<userId>:<requestId>`, décrément du stock, création de la commande et journal.
 *     Rejouer la même requête (double clic, réseau) renvoie la même commande sans second débit ;
 *   - commandes : en attente → en préparation → remise ; annulation possible avant la remise
 *     (par le joueur tant qu'elle est en attente, par l'admin ensuite) : remboursement des points
 *     (mouvement `refund` lié au débit) et remise en stock, une seule fois ;
 *   - aucun code cadeau ni e-mail n'est stocké dans les tables de la boutique ni journalisé (les
 *     notes qui en ressemblent sont refusées) ; articles et commandes ne sont jamais supprimés,
 *     le journal `shop_audit` est en ajout seul.
 */

'use strict';

const db           = require('./db');
const cal          = require('./seasonCalendar');
const rewardPoints = require('./rewardPoints');

const KINDS = ['virtual', 'real'];
const LANGS = ['fr', 'en', 'nl'];

/** Transitions des commandes (admin). Le joueur ne peut qu'annuler une commande en attente. */
const TRANSITIONS = {
  pending:    ['processing', 'delivered', 'cancelled'],
  processing: ['delivered', 'cancelled'],
  delivered:  [],
  cancelled:  [],
};
const STATUSES = Object.keys(TRANSITIONS);
const ORDER_HISTORY_LIMIT = 30;

class ShopError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const conn = () => db.getDb();

function realPrizesUnlocked() {
  return process.env.CONTEST_REAL_PRIZES === 'on';
}

// Mêmes garde-fous que les notes du concours (#30) : pas d'e-mail ni de code cadeau en clair.
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const CODE_RE  = /\b(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9]{4,}(?:-[A-Z0-9]{3,}){2,}\b/;

function _safeNote(note, max = 300) {
  const s = String(note ?? '').trim().slice(0, max);
  if (EMAIL_RE.test(s)) throw new ShopError(400, 'La note ne doit pas contenir d\'adresse e-mail.');
  if (CODE_RE.test(s)) throw new ShopError(400, 'La note ne doit pas contenir de code cadeau.');
  return s || null;
}

function _audit(actor, action, { itemId = null, orderId = null, userId = null, details = null } = {}) {
  conn().prepare('INSERT INTO shop_audit (actor, action, item_id, order_id, user_id, details) VALUES (?, ?, ?, ?, ?, ?)')
    .run(actor, action, itemId, orderId, userId, details ? JSON.stringify(details) : null);
}

// ── Réglages ──────────────────────────────────────────────────────────────────

function getSettings() {
  const r = conn().prepare('SELECT * FROM shop_settings WHERE id = 1').get();
  return { exchangesOpen: !!r.exchanges_open, notice: r.notice ?? '', realEnabled: realPrizesUnlocked(), updatedAt: r.updated_at };
}

function updateSettings(input = {}) {
  return conn().transaction(() => {
    const before = getSettings();
    const open   = input.exchangesOpen === undefined ? before.exchangesOpen : !!input.exchangesOpen;
    const notice = input.notice === undefined ? before.notice : String(input.notice ?? '').trim().slice(0, 300);
    conn().prepare("UPDATE shop_settings SET exchanges_open = ?, notice = ?, updated_at = datetime('now') WHERE id = 1")
      .run(open ? 1 : 0, notice || null);
    const after = getSettings();
    _audit('admin', 'settings', { details: { before: { exchangesOpen: before.exchangesOpen, notice: before.notice },
                                             after:  { exchangesOpen: after.exchangesOpen,  notice: after.notice } } });
    return after;
  })();
}

// ── Catalogue ─────────────────────────────────────────────────────────────────

const _optInt = (v, min, max, what) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new ShopError(400, `${what} : entier entre ${min} et ${max}, ou vide.`);
  return n;
};

function _optDate(v, what) {
  if (v === null || v === undefined || v === '') return null;
  const d = cal.parseUtc(v);
  if (!d) throw new ShopError(400, `${what} : date UTC invalide (AAAA-MM-JJ HH:MM:SS).`);
  return cal.fmtUtc(d);
}

function _imageUrl(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  // Image du site (chemin absolu, sans « // ») ou URL https ; jamais de javascript:, data:, http:.
  if (/^\/(?!\/)[A-Za-z0-9._~\/%-]{1,200}$/.test(s)) return s;
  if (/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?\/[^\s"'<>]{0,300}$/.test(s)) return s;
  throw new ShopError(400, 'Image : chemin du site (/…) ou URL https.');
}

function _texts(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const lang of LANGS) {
    const t = src[lang] && typeof src[lang] === 'object' ? src[lang] : {};
    const title = String(t.title ?? '').trim().slice(0, 80);
    const description = String(t.description ?? '').trim().slice(0, 500);
    const conditions = String(t.conditions ?? '').trim().slice(0, 1000);
    if (title || description || conditions) out[lang] = { title, description, conditions };
  }
  if (!out.fr?.title) throw new ShopError(400, 'Titre français obligatoire.');
  return out;
}

/**
 * Valide un article (création complète, ou fusion avec l'existant pour une mise à jour).
 * @returns {object} colonnes normalisées de shop_items
 */
function validateItem(input, base = null) {
  if (!input || typeof input !== 'object') throw new ShopError(400, 'Article manquant.');
  const v = (k, def) => (input[k] !== undefined ? input[k] : (base ? base[k] : def));
  const kind = v('kind', 'virtual');
  if (!KINDS.includes(kind)) throw new ShopError(400, `Sorte d'article invalide (${KINDS.join(' | ')}).`);
  const cost = Number(v('cost'));
  if (!Number.isInteger(cost) || cost < 1 || cost > 1_000_000) throw new ShopError(400, 'Coût : entier de 1 à 1 000 000 points.');
  const currency = String(v('currency', '') ?? '').trim().toUpperCase();
  if (currency && !/^[A-Z]{3}$/.test(currency)) throw new ShopError(400, 'Devise : code ISO à 3 lettres (EUR…).');
  const territories = String(v('territories', '') ?? '').toUpperCase().split(/[\s,;]+/).filter(Boolean);
  if (territories.some(x => !/^[A-Z]{2}$/.test(x)) || territories.length > 50) throw new ShopError(400, 'Territoires : codes pays à 2 lettres séparés par des virgules (vide = non précisé).');
  const icon = String(v('icon', '') ?? '').trim();
  if ([...icon].length > 4) throw new ShopError(400, 'Icône : un emoji (4 caractères max).');
  const item = {
    kind, cost, currency: currency || null,
    texts:            _texts(v('texts')),
    icon:             icon || null,
    image_url:        _imageUrl(v('image_url')),
    stock_remaining:  _optInt(v('stock_remaining'), 0, 1_000_000, 'Stock'),
    max_per_user:     _optInt(v('max_per_user'), 1, 1000, 'Limite par joueur'),
    face_value_cents: _optInt(v('face_value_cents'), 0, 1_000_000, 'Valeur faciale (centimes)'),
    territories:      territories.length ? [...new Set(territories)].join(',') : null,
    min_age:          _optInt(v('min_age'), 0, 99, 'Âge minimal'),
    valid_from:       _optDate(v('valid_from'), 'Début de validité'),
    valid_until:      _optDate(v('valid_until'), 'Fin de validité'),
    visible:          v('visible', false) ? 1 : 0,
    unavailable:      v('unavailable', false) ? 1 : 0,
    sort:             _optInt(v('sort', 0), -1000, 1000, 'Ordre') ?? 0,
  };
  if (item.valid_from && item.valid_until && item.valid_until <= item.valid_from) {
    throw new ShopError(400, 'La fin de validité doit suivre le début.');
  }
  return item;
}

const COLS = ['kind', 'texts', 'icon', 'image_url', 'cost', 'stock_remaining', 'max_per_user', 'face_value_cents',
  'currency', 'territories', 'min_age', 'valid_from', 'valid_until', 'visible', 'unavailable', 'sort'];

function _rowToItem(r) {
  return r ? { ...r, texts: JSON.parse(r.texts), visible: !!r.visible, unavailable: !!r.unavailable } : null;
}

function getItem(id) {
  return _rowToItem(conn().prepare('SELECT * FROM shop_items WHERE id = ?').get(id));
}

function listItems() {
  return conn().prepare('SELECT * FROM shop_items ORDER BY sort, id').all().map(_rowToItem);
}

function _dbValues(item) {
  return COLS.map(c => (c === 'texts' ? JSON.stringify(item.texts) : item[c]));
}

function createItem(input) {
  const item = validateItem(input);
  return conn().transaction(() => {
    const info = conn().prepare(`INSERT INTO shop_items (${COLS.join(', ')}) VALUES (${COLS.map(() => '?').join(', ')})`)
      .run(..._dbValues(item));
    _audit('admin', 'item_create', { itemId: info.lastInsertRowid, details: { after: item } });
    return getItem(info.lastInsertRowid);
  })();
}

function updateItem(id, input) {
  return conn().transaction(() => {
    const before = getItem(id);
    if (!before) throw new ShopError(404, 'Article introuvable.');
    const item = validateItem(input, before);
    conn().prepare(`UPDATE shop_items SET ${COLS.map(c => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
      .run(..._dbValues(item), id);
    const after = getItem(id);
    const changed = {};
    for (const c of COLS) {
      const a = JSON.stringify(before[c]), b = JSON.stringify(after[c]);
      if (a !== b) changed[c] = { before: before[c], after: after[c] };
    }
    if (Object.keys(changed).length) _audit('admin', 'item_update', { itemId: id, details: changed });
    return after;
  })();
}

/** Raison pour laquelle un article n'est pas échangeable maintenant (null = échangeable). */
function _blockReason(item, settings, nowStr) {
  if (!item.visible) return 'hidden';
  if (item.unavailable) return 'unavailable';
  if (item.kind === 'real' && !settings.realEnabled) return 'real_locked';
  if (!settings.exchangesOpen) return 'closed';
  if (item.valid_from && nowStr < item.valid_from) return 'not_started';
  if (item.valid_until && nowStr > item.valid_until) return 'expired';
  if (item.stock_remaining !== null && item.stock_remaining <= 0) return 'out_of_stock';
  return null;
}

/** Catalogue public (articles visibles, sans données internes). */
function publicCatalog(now = new Date()) {
  const settings = getSettings();
  const nowStr = cal.fmtUtc(now);
  const items = listItems().filter(i => i.visible && !(i.valid_until && nowStr > i.valid_until)).map(i => ({
    id: i.id, kind: i.kind, texts: i.texts, icon: i.icon, imageUrl: i.image_url, cost: i.cost,
    stock: i.stock_remaining, maxPerUser: i.max_per_user,
    faceValueCents: i.face_value_cents, currency: i.currency,
    territories: i.territories ? i.territories.split(',') : [], minAge: i.min_age,
    validFrom: i.valid_from, validUntil: i.valid_until,
    blocked: _blockReason(i, settings, nowStr),
  }));
  return { exchangesOpen: settings.exchangesOpen, realEnabled: settings.realEnabled, notice: settings.notice, items };
}

// ── Commandes ─────────────────────────────────────────────────────────────────

function _orderRow(id) {
  return conn().prepare('SELECT * FROM shop_orders WHERE id = ?').get(id) ?? null;
}

function _publicOrder(o) {
  const snap = JSON.parse(o.item_snapshot);
  return {
    id: o.id, createdAt: o.created_at, updatedAt: o.updated_at, itemId: o.item_id, kind: o.kind,
    cost: o.cost, status: o.status, texts: snap.texts, icon: snap.icon,
  };
}

/**
 * Échange de points contre un article (joueur connecté). Idempotent par (joueur, requestId).
 * @returns {{ order: object, duplicate: boolean, wallet: object }}
 */
function placeOrder(userId, itemId, requestId, { now = new Date() } = {}) {
  if (!Number.isInteger(userId) || userId < 1) throw new ShopError(401, 'Non connecté.');
  if (!Number.isInteger(itemId) || itemId < 1) throw new ShopError(400, 'Article invalide.');
  const rid = String(requestId ?? '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(rid)) throw new ShopError(400, 'Identifiant de requête invalide.');
  const key = `shop:${userId}:${rid}`;

  return conn().transaction(() => {
    const prev = conn().prepare('SELECT * FROM shop_orders WHERE request_key = ?').get(key);
    if (prev) {
      if (prev.item_id !== itemId) throw new ShopError(409, 'Requête déjà utilisée pour un autre article.');
      return { order: _publicOrder(prev), duplicate: true, wallet: rewardPoints.getWallet(userId) };
    }
    const item = getItem(itemId);
    if (!item || !item.visible) throw new ShopError(404, 'Article introuvable.');
    const settings = getSettings();
    const reason = _blockReason(item, settings, cal.fmtUtc(now));
    const MESSAGES = {
      unavailable:  [409, 'Article momentanément indisponible.'],
      real_locked:  [403, 'Les cadeaux réels ne sont pas encore ouverts à l\'échange.'],
      closed:       [409, 'Les échanges sont momentanément fermés.'],
      not_started:  [409, 'Article pas encore disponible.'],
      expired:      [409, 'Article expiré.'],
      out_of_stock: [409, 'Rupture de stock.'],
    };
    if (reason) throw new ShopError(...MESSAGES[reason]);
    if (item.kind === 'real') {
      const u = db.getUserAuth(userId);
      if (!u?.email_verified_at) throw new ShopError(403, 'Adresse e-mail vérifiée requise pour un cadeau réel.');
    }
    if (item.max_per_user) {
      const n = conn().prepare("SELECT COUNT(*) AS n FROM shop_orders WHERE user_id = ? AND item_id = ? AND status <> 'cancelled'")
        .get(userId, itemId).n;
      if (n >= item.max_per_user) throw new ShopError(409, `Limite atteinte pour cet article (${item.max_per_user} par joueur).`);
    }
    // Débit (solde insuffisant → 409, rien n'est écrit : la transaction entière est annulée).
    let spent;
    try {
      spent = rewardPoints.spend(userId, item.cost, {
        idemKey: key, use: item.kind, reason: `Boutique : ${item.texts.fr.title}`.slice(0, 200), meta: { itemId },
      });
    } catch (err) {
      if (err instanceof rewardPoints.PointsError) throw new ShopError(err.status, err.message);
      throw err;
    }
    if (item.stock_remaining !== null) {
      const r = conn().prepare('UPDATE shop_items SET stock_remaining = stock_remaining - 1 WHERE id = ? AND stock_remaining > 0').run(itemId);
      if (r.changes !== 1) throw new ShopError(409, 'Rupture de stock.');
    }
    const snapshot = { texts: item.texts, icon: item.icon, kind: item.kind, cost: item.cost,
                       faceValueCents: item.face_value_cents, currency: item.currency };
    const info = conn().prepare(`
      INSERT INTO shop_orders (user_id, item_id, kind, cost, request_key, spend_ledger_id, item_snapshot)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(userId, itemId, item.kind, item.cost, key, spent.entry.id, JSON.stringify(snapshot));
    _audit('player', 'order_create', { itemId, orderId: info.lastInsertRowid, userId, details: { cost: item.cost, ledgerId: spent.entry.id } });
    return { order: _publicOrder(_orderRow(info.lastInsertRowid)), duplicate: false, wallet: rewardPoints.getWallet(userId) };
  })();
}

/** Annulation (remboursement + remise en stock), dans la transaction appelante. */
function _cancel(o, actor, note) {
  const refund = rewardPoints.refund(o.user_id, o.cost, {
    idemKey: `shop-refund:${o.id}`, spendId: o.spend_ledger_id, reason: `Boutique : commande #${o.id} annulée`,
  });
  conn().prepare('UPDATE shop_items SET stock_remaining = stock_remaining + 1 WHERE id = ? AND stock_remaining IS NOT NULL').run(o.item_id);
  conn().prepare("UPDATE shop_orders SET status = 'cancelled', refund_ledger_id = ?, note = COALESCE(?, note), updated_at = datetime('now') WHERE id = ?")
    .run(refund.entry.id, note, o.id);
  _audit(actor, 'order_cancel', { itemId: o.item_id, orderId: o.id, userId: o.user_id, details: { refundLedgerId: refund.entry.id, from: o.status } });
}

/** Le joueur annule sa commande tant qu'elle est en attente. Idempotent (déjà annulée = OK). */
function cancelByPlayer(userId, orderId) {
  return conn().transaction(() => {
    const o = _orderRow(orderId);
    if (!o || o.user_id !== userId) throw new ShopError(404, 'Commande introuvable.');
    if (o.status === 'cancelled') return { order: _publicOrder(o), wallet: rewardPoints.getWallet(userId) };
    if (o.status !== 'pending') throw new ShopError(409, 'Commande déjà en préparation : contacte le support pour l\'annuler.');
    _cancel(o, 'player', null);
    return { order: _publicOrder(_orderRow(orderId)), wallet: rewardPoints.getWallet(userId) };
  })();
}

/** Changement de statut par l'admin (annulation = remboursement et remise en stock). */
function transition(orderId, to, note) {
  if (!STATUSES.includes(to)) throw new ShopError(400, `Statut invalide (${STATUSES.join(' | ')}).`);
  const safe = _safeNote(note);
  return conn().transaction(() => {
    const o = _orderRow(orderId);
    if (!o) throw new ShopError(404, 'Commande introuvable.');
    if (!TRANSITIONS[o.status].includes(to)) throw new ShopError(409, `Transition ${o.status} → ${to} interdite.`);
    if (to === 'cancelled') _cancel(o, 'admin', safe);
    else {
      conn().prepare("UPDATE shop_orders SET status = ?, note = COALESCE(?, note), updated_at = datetime('now') WHERE id = ?").run(to, safe, orderId);
      _audit('admin', 'order_status', { itemId: o.item_id, orderId, userId: o.user_id, details: { from: o.status, to, note: safe } });
    }
    return _adminOrder(_orderRow(orderId));
  })();
}

function _adminOrder(o) {
  const u = db.getUserById(o.user_id);
  return { ..._publicOrder(o), userId: o.user_id, username: u ? u.username : null, note: o.note,
           spendLedgerId: o.spend_ledger_id, refundLedgerId: o.refund_ledger_id, transitions: TRANSITIONS[o.status] };
}

function listOrders({ status = null, limit = 100 } = {}) {
  const rows = status
    ? conn().prepare('SELECT * FROM shop_orders WHERE status = ? ORDER BY id DESC LIMIT ?').all(status, limit)
    : conn().prepare('SELECT * FROM shop_orders ORDER BY id DESC LIMIT ?').all(limit);
  return rows.map(_adminOrder);
}

function listAudit({ limit = 100 } = {}) {
  return conn().prepare('SELECT * FROM shop_audit ORDER BY id DESC LIMIT ?').all(limit)
    .map(a => ({ ...a, details: a.details ? JSON.parse(a.details) : null }));
}

/** Vue joueur : solde, commandes récentes. */
function buildPlayerView(userId) {
  const orders = conn().prepare('SELECT * FROM shop_orders WHERE user_id = ? ORDER BY id DESC LIMIT ?')
    .all(userId, ORDER_HISTORY_LIMIT).map(_publicOrder);
  const u = db.getUserAuth(userId);
  return { balance: rewardPoints.getWallet(userId).balance, emailVerified: !!u?.email_verified_at, orders };
}

/** Vue admin : réglages, catalogue complet, commandes, totaux et contrôle du registre. */
function buildAdminSummary({ status = null } = {}) {
  const totals = conn().prepare(`
    SELECT status, COUNT(*) AS n, COALESCE(SUM(cost), 0) AS points FROM shop_orders GROUP BY status`).all();
  return {
    settings: getSettings(), statuses: STATUSES, transitions: TRANSITIONS,
    items: listItems(), orders: listOrders({ status }), totals,
    ledger: rewardPoints.verifyLedger(),
  };
}

module.exports = {
  KINDS, LANGS, STATUSES, TRANSITIONS, ShopError,
  getSettings, updateSettings, validateItem, getItem, listItems, createItem, updateItem,
  publicCatalog, placeOrder, cancelByPlayer, transition, listOrders, listAudit,
  buildPlayerView, buildAdminSummary,
};
