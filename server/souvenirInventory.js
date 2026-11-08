/**
 * server/souvenirInventory.js — Souvenirs d'événements : exemplaires en double et échanges entre
 * joueurs (#93, demande du propriétaire du 08/11/2026). TOUT est désactivé par défaut : sans décision
 * du propriétaire, aucun double n'est tiré et aucun échange n'est possible.
 *
 * Modèle (ajout seul, aucune donnée existante réécrite) :
 *   - Type de souvenir : identifiant stable `événement/objet` (monthly_event_items).
 *   - Première découverte : `monthly_event_finds` (inchangée, une ligne par joueur et par type,
 *     jamais déplacée). Elle compte pour UN exemplaire, conservé : on n'échange que des doubles.
 *   - Exemplaires supplémentaires : `souvenir_copies`, une ligne par exemplaire physique, avec son
 *     propriétaire actuel (`user_id`), son origine (`duplicate` = tiré pendant l'événement), son premier
 *     propriétaire, sa date de création (toujours PENDANT l'événement : aucune copie n'est créée après
 *     la fin) et sa réservation éventuelle par un échange en cours (`trade_id`).
 *   - Quantité possédée = découverte (0/1) + exemplaires supplémentaires ; réservée = exemplaires
 *     bloqués par un échange en attente ; échangeable = quantité − 1 − réservée (le dernier exemplaire
 *     ne part jamais). Version d'inventaire par joueur, incrémentée à chaque changement.
 *   - Journal `souvenir_copy_log` : chaque création, réservation, libération, transfert, annulation admin.
 *
 * Doubles (drapeau global `duplicates_enabled` = 0 ET règle explicite par événement/objet) :
 *   tirés par monthlyEvents.processSave sur les mêmes blocs validés que les premières découvertes,
 *   chance par bloc = chance de l'objet × `factor` (≤ 1), au plus `maxCopies` exemplaires créés par
 *   joueur et par type, au plus MAX_DUPS_PER_SAVE doubles par sauvegarde. Rien de rétroactif : le
 *   curseur de l'événement ne voit que les blocs minés depuis le passage précédent.
 *
 * Échanges (drapeau `trades_enabled` = 0) : 1 exemplaire contre 1 exemplaire d'un AUTRE type, jamais
 * contre pièces/gemmes/fragments. Proposition (réserve l'exemplaire offert) → acceptation par le
 * destinataire (choisit son exemplaire, échange atomique) ou contre-proposition / refus / annulation /
 * expiration (libère). Chaque étape est une transaction SQLite qui revérifie propriété, réservation,
 * statut et version : un double appel, un rejeu ou deux onglets ne peuvent ni dupliquer ni perdre.
 */

'use strict';

const db = require('./db');

const conn = () => db.getDb();

const KEY_RE = /^[a-z][a-z0-9_]{2,39}$/;
const MAX_DUPS_PER_SAVE = 3;     // doubles tirés au plus par sauvegarde (aucune rafale)
const HARD_MAX_COPIES = 10;      // plafond absolu d'exemplaires créés par joueur et par type
const SETTINGS_DEFAULT = {
  duplicates_enabled: '0',       // OFF : décision du propriétaire (#93)
  trades_enabled: '0',           // OFF : décision du propriétaire (#93)
  trade_ttl_hours: '48',
  trade_min_account_days: '7',
  trade_min_blocks: '500',       // blocs validés (#38) minimum pour échanger
  trade_max_pending: '5',        // propositions en attente par joueur (envoyées)
  trade_daily_max: '10',         // échanges conclus par joueur et par 24 h
};
const SETTING_BOUNDS = {
  duplicates_enabled: [0, 1], trades_enabled: [0, 1], trade_ttl_hours: [1, 336], trade_min_account_days: [0, 365],
  trade_min_blocks: [0, 1_000_000], trade_max_pending: [1, 50], trade_daily_max: [1, 100],
};

class SouvenirError extends Error {
  constructor(status, message, code = null) { super(message); this.status = status; this.code = code; }
}

const _iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const J = (v, d) => { try { return v == null ? d : JSON.parse(v); } catch (_) { return d; } };

// ── Schéma (ajout seul, idempotent) ───────────────────────────────────────────

function init(c = conn()) {
  c.exec(`
    CREATE TABLE IF NOT EXISTS souvenir_copies (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id        TEXT    NOT NULL,
      item_id         TEXT    NOT NULL,
      user_id         INTEGER NOT NULL,
      origin          TEXT    NOT NULL,
      origin_key      TEXT    NOT NULL UNIQUE,
      first_owner_id  INTEGER NOT NULL,
      created_at      TEXT    NOT NULL,
      owner_since     TEXT    NOT NULL,
      depth           INTEGER,
      trade_id        INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_souvenir_copies_owner ON souvenir_copies(user_id, event_id, item_id);
    CREATE INDEX IF NOT EXISTS idx_souvenir_copies_trade ON souvenir_copies(trade_id);
    CREATE TABLE IF NOT EXISTS souvenir_copy_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      at         TEXT    NOT NULL DEFAULT (datetime('now')),
      copy_id    INTEGER,
      action     TEXT    NOT NULL,
      from_user  INTEGER,
      to_user    INTEGER,
      trade_id   INTEGER,
      details    TEXT
    );
    CREATE TABLE IF NOT EXISTS souvenir_inventory_versions (
      user_id  INTEGER PRIMARY KEY,
      version  INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS souvenir_settings (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS souvenir_dup_rules (
      event_id    TEXT    NOT NULL,
      item_id     TEXT    NOT NULL DEFAULT '*',
      allowed     INTEGER NOT NULL DEFAULT 0,
      factor      REAL    NOT NULL DEFAULT 0,
      max_copies  INTEGER NOT NULL DEFAULT 1,
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (event_id, item_id)
    );
    CREATE TABLE IF NOT EXISTS souvenir_trades (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user      INTEGER NOT NULL,
      to_user        INTEGER NOT NULL,
      offer_event    TEXT    NOT NULL,
      offer_item     TEXT    NOT NULL,
      offer_copy_id  INTEGER NOT NULL,
      want_event     TEXT    NOT NULL,
      want_item      TEXT    NOT NULL,
      want_copy_id   INTEGER,
      status         TEXT    NOT NULL DEFAULT 'pending',
      parent_id      INTEGER,
      request_id     TEXT,
      version        INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT    NOT NULL,
      expires_at     TEXT    NOT NULL,
      updated_at     TEXT    NOT NULL,
      UNIQUE (from_user, request_id)
    );
    CREATE INDEX IF NOT EXISTS idx_souvenir_trades_from ON souvenir_trades(from_user, status);
    CREATE INDEX IF NOT EXISTS idx_souvenir_trades_to ON souvenir_trades(to_user, status);
    CREATE TABLE IF NOT EXISTS souvenir_admin_log (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      at       TEXT NOT NULL DEFAULT (datetime('now')),
      action   TEXT NOT NULL,
      details  TEXT
    );
  `);
  const ins = c.prepare('INSERT OR IGNORE INTO souvenir_settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(SETTINGS_DEFAULT)) ins.run(k, v);
}

// ── Réglages ──────────────────────────────────────────────────────────────────

function settings() {
  const out = {};
  for (const [k, v] of Object.entries(SETTINGS_DEFAULT)) out[k] = Number(v);
  for (const r of conn().prepare('SELECT key, value FROM souvenir_settings').all()) if (r.key in out) out[r.key] = Number(r.value);
  return out;
}
const duplicatesEnabled = () => settings().duplicates_enabled === 1;
const tradesEnabled = () => settings().trades_enabled === 1;

function _adminLog(action, details) {
  conn().prepare('INSERT INTO souvenir_admin_log (action, details) VALUES (?, ?)').run(action, details == null ? null : JSON.stringify(details));
}

/**
 * Modifie des réglages. Activer les doubles ou les échanges exige `confirm: true` (décision du
 * propriétaire) ; désactiver est toujours possible et ne supprime aucun exemplaire.
 */
function updateSettings(input = {}, { confirm = false } = {}) {
  const cur = settings();
  const next = { ...cur };
  for (const [k, v] of Object.entries(input || {})) {
    if (!(k in SETTING_BOUNDS)) throw new SouvenirError(400, `Réglage inconnu : ${k}.`);
    const n = typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
    const [lo, hi] = SETTING_BOUNDS[k];
    if (!Number.isInteger(n) || n < lo || n > hi) throw new SouvenirError(400, `${k} : entier entre ${lo} et ${hi} attendu.`);
    next[k] = n;
  }
  const turningOn = ['duplicates_enabled', 'trades_enabled'].filter(k => next[k] === 1 && cur[k] !== 1);
  if (turningOn.length && !confirm) {
    throw new SouvenirError(409, 'Activation des doubles ou des échanges : décision du propriétaire, confirmation explicite requise.', 'confirm_required');
  }
  const changed = Object.keys(next).filter(k => next[k] !== cur[k]);
  if (!changed.length) return settings();
  db.runTransaction(() => {
    const up = conn().prepare(`INSERT INTO souvenir_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);
    for (const k of changed) up.run(k, String(next[k]));
    _adminLog('settings', Object.fromEntries(changed.map(k => [k, { from: cur[k], to: next[k] }])));
    // Désactiver les échanges libère aussitôt les exemplaires réservés (aucun objet supprimé).
    if (cur.trades_enabled === 1 && next.trades_enabled === 0) _closePending('disabled', Date.now());
  });
  return settings();
}

// ── Règles des doubles ────────────────────────────────────────────────────────

function _rule(r) { return { eventId: r.event_id, itemId: r.item_id, allowed: !!r.allowed, factor: r.factor, maxCopies: r.max_copies, updatedAt: r.updated_at }; }
function listRules(eventId = null) {
  const rows = eventId ? conn().prepare('SELECT * FROM souvenir_dup_rules WHERE event_id = ? ORDER BY item_id').all(eventId)
    : conn().prepare('SELECT * FROM souvenir_dup_rules ORDER BY event_id, item_id').all();
  return rows.map(_rule);
}

/**
 * Règle de doubles pour un événement (`itemId` = '*') ou un objet. `factor` : multiplicateur de la
 * chance de l'objet pour un double (0 à 1) ; `maxCopies` : exemplaires au plus par joueur (1 = aucun
 * double, découverte comprise). Enregistrer une règle autorisant des doubles exige `confirm: true`.
 * Aucun effet tant que le drapeau global est OFF ; n'altère ni l'événement ni ses révisions.
 */
function setRule(eventId, itemId = '*', input = {}, { confirm = false } = {}) {
  const ev = require('./monthlyEvents').getEvent(String(eventId || ''));
  if (!ev) throw new SouvenirError(404, 'Événement introuvable.');
  const item = itemId === '*' ? '*' : String(itemId || '');
  if (item !== '*' && !ev.items.some(i => i.id === item)) throw new SouvenirError(404, 'Objet introuvable dans cet événement.');
  const allowed = input.allowed === true;
  const factor = Number(input.factor ?? 0);
  const maxCopies = Number(input.maxCopies ?? 1);
  if (!(factor >= 0 && factor <= 1)) throw new SouvenirError(400, 'Facteur des doubles : entre 0 et 1.');
  if (!Number.isInteger(maxCopies) || maxCopies < 1 || maxCopies > HARD_MAX_COPIES) throw new SouvenirError(400, `Exemplaires au plus : entier entre 1 et ${HARD_MAX_COPIES}.`);
  if (allowed && factor > 0 && maxCopies > 1 && !confirm) {
    throw new SouvenirError(409, 'Barème des doubles : décision du propriétaire, confirmation explicite requise.', 'confirm_required');
  }
  conn().prepare(`INSERT INTO souvenir_dup_rules (event_id, item_id, allowed, factor, max_copies, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(event_id, item_id) DO UPDATE SET allowed = excluded.allowed, factor = excluded.factor, max_copies = excluded.max_copies, updated_at = excluded.updated_at`)
    .run(ev.id, item, allowed ? 1 : 0, factor, maxCopies);
  _adminLog('rule', { eventId: ev.id, itemId: item, allowed, factor, maxCopies });
  return listRules(ev.id);
}

/**
 * Règles effectives d'un événement pour le tirage des doubles, ou null (drapeau OFF ou aucune règle
 * autorisée) : dans ce cas monthlyEvents.processSave se comporte exactement comme avant #93.
 */
function dupPlanFor(eventId) {
  if (!duplicatesEnabled()) return null;
  const rules = listRules(eventId);
  if (!rules.some(r => r.allowed && r.factor > 0 && r.maxCopies > 1)) return null;
  const byItem = new Map(rules.map(r => [r.itemId, r]));
  return {
    left: MAX_DUPS_PER_SAVE,
    ruleFor(itemId) {
      const r = byItem.get(itemId) ?? byItem.get('*');
      return r && r.allowed && r.factor > 0 && r.maxCopies > 1 ? r : null;
    },
  };
}

// ── Inventaire ────────────────────────────────────────────────────────────────

function _bump(userId) {
  conn().prepare(`INSERT INTO souvenir_inventory_versions (user_id, version) VALUES (?, 1)
      ON CONFLICT(user_id) DO UPDATE SET version = version + 1`).run(userId);
}
function inventoryVersion(userId) {
  return conn().prepare('SELECT version FROM souvenir_inventory_versions WHERE user_id = ?').get(userId)?.version ?? 0;
}
function _copyLog(copyId, action, { from = null, to = null, tradeId = null, details = null } = {}) {
  conn().prepare('INSERT INTO souvenir_copy_log (copy_id, action, from_user, to_user, trade_id, details) VALUES (?, ?, ?, ?, ?, ?)')
    .run(copyId, action, from, to, tradeId, details == null ? null : JSON.stringify(details));
}

/** Types possédés par un joueur via un exemplaire supplémentaire (reçu ou double) : Set 'événement/objet'. */
function extraTypes(userId, eventId = null) {
  const rows = eventId ? conn().prepare('SELECT DISTINCT event_id, item_id FROM souvenir_copies WHERE user_id = ? AND event_id = ?').all(userId, eventId)
    : conn().prepare('SELECT DISTINCT event_id, item_id FROM souvenir_copies WHERE user_id = ?').all(userId);
  return new Set(rows.map(r => `${r.event_id}/${r.item_id}`));
}

/**
 * Inventaire d'un joueur : { version, items: { 'événement/objet': { eventId, itemId, qty, duplicates,
 * reserved, tradeable, discovered, firstAt } } }. Lecture seule.
 */
function inventory(userId) {
  const items = {};
  const get = (e, i) => (items[`${e}/${i}`] ??= { eventId: e, itemId: i, qty: 0, duplicates: 0, reserved: 0, tradeable: 0, discovered: false, firstAt: null });
  for (const f of conn().prepare('SELECT event_id, item_id, found_at FROM monthly_event_finds WHERE user_id = ?').all(userId)) {
    const it = get(f.event_id, f.item_id);
    it.qty += 1; it.discovered = true; it.firstAt = f.found_at;
  }
  for (const c of conn().prepare('SELECT event_id, item_id, owner_since, trade_id FROM souvenir_copies WHERE user_id = ? ORDER BY owner_since').all(userId)) {
    const it = get(c.event_id, c.item_id);
    it.qty += 1;
    if (c.trade_id) it.reserved += 1;
    if (!it.firstAt || c.owner_since < it.firstAt) it.firstAt = c.owner_since;
  }
  for (const it of Object.values(items)) {
    it.duplicates = Math.max(0, it.qty - 1);
    it.tradeable = Math.max(0, it.qty - 1 - it.reserved);
  }
  return { version: inventoryVersion(userId), items };
}

/** Quantités { 'événement/objet': n } (pour souvenirBonus.resolve : un bonus par TYPE, jamais × quantité). */
function quantities(userId) {
  return Object.fromEntries(Object.entries(inventory(userId).items).map(([k, v]) => [k, v.qty]));
}

/**
 * Crée un double pendant l'événement (appelé par monthlyEvents.processSave, DANS sa transaction).
 * Borne : au plus `rule.maxCopies − 1` doubles créés par ce joueur pour ce type, quel que soit le
 * nombre d'exemplaires échangés depuis (un échange ne permet pas de refarmer).
 * @returns {number|null} nouvelle quantité possédée, ou null si la borne est atteinte.
 */
function mintDuplicate(userId, eventId, itemId, rule, { nowMs = Date.now(), depth = null } = {}) {
  const minted = conn().prepare("SELECT COUNT(*) AS n FROM souvenir_copies WHERE first_owner_id = ? AND event_id = ? AND item_id = ? AND origin = 'duplicate'")
    .get(userId, eventId, itemId).n;
  if (minted >= Math.min(rule.maxCopies, HARD_MAX_COPIES) - 1) return null;
  const at = _iso(nowMs);
  const r = conn().prepare(`INSERT OR IGNORE INTO souvenir_copies (event_id, item_id, user_id, origin, origin_key, first_owner_id, created_at, owner_since, depth)
      VALUES (?, ?, ?, 'duplicate', ?, ?, ?, ?, ?)`)
    .run(eventId, itemId, userId, `dup:${userId}:${eventId}:${itemId}:${minted + 1}`, userId, at, at, depth);
  if (!r.changes) return null;
  _copyLog(r.lastInsertRowid, 'mint', { to: userId, details: { depth } });
  _bump(userId);
  return inventory(userId).items[`${eventId}/${itemId}`]?.qty ?? null;
}

// ── Échanges ──────────────────────────────────────────────────────────────────

const _typeKey = t => `${t.eventId}/${t.itemId}`;
function _type(raw, label) {
  const eventId = String(raw?.eventId ?? ''), itemId = String(raw?.itemId ?? '');
  if (!KEY_RE.test(eventId) || !KEY_RE.test(itemId)) throw new SouvenirError(400, `${label} : souvenir invalide.`);
  const ev = require('./monthlyEvents').getEvent(eventId);
  const it = ev && ev.items.find(i => i.id === itemId);
  if (!it || it.proposal) throw new SouvenirError(404, `${label} : souvenir introuvable.`);
  return { eventId, itemId };
}

function _user(id) { return conn().prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(id); }

/** Conditions de déblocage (compte ancien, minage validé, pas de suspension anti-bot active). */
function eligibility(userId, nowMs = Date.now()) {
  const s = settings();
  const u = _user(userId);
  const reasons = [];
  if (!u) return { ok: false, reasons: ['account_missing'] };
  const ageDays = (nowMs - Date.parse(String(u.created_at).replace(' ', 'T') + 'Z')) / 86_400_000;
  if (!(ageDays >= s.trade_min_account_days)) reasons.push('account_too_new');
  let blocks = 0;
  try {
    const stats = require('./badges').validatedStats(userId);
    for (const [k, v] of Object.entries(stats)) if (k.startsWith('blocks:')) blocks += v;
  } catch (_) { /* statistiques absentes : 0 */ }
  if (blocks < s.trade_min_blocks) reasons.push('not_enough_blocks');
  try {
    if (conn().prepare("SELECT 1 FROM antibot_suspensions WHERE user_id = ? AND status = 'active' AND ends_ms > ?").get(userId, nowMs)) reasons.push('suspended');
  } catch (_) { /* table absente */ }
  return { ok: !reasons.length, reasons, ageDays: Math.floor(ageDays), blocks };
}

function _assertOn() {
  if (!tradesEnabled()) throw new SouvenirError(403, 'Les échanges de souvenirs ne sont pas encore ouverts.', 'trades_disabled');
}
function _assertEligible(userId, who, nowMs) {
  const e = eligibility(userId, nowMs);
  if (!e.ok) throw new SouvenirError(403, `${who} ne peut pas encore échanger (${e.reasons.join(', ')}).`, 'not_eligible');
}

/** Un exemplaire supplémentaire libre de ce type, si le joueur en garde au moins un autre. */
function _freeCopy(userId, t) {
  const inv = inventory(userId).items[_typeKey(t)];
  if (!inv || inv.tradeable < 1) return null;
  return conn().prepare('SELECT * FROM souvenir_copies WHERE user_id = ? AND event_id = ? AND item_id = ? AND trade_id IS NULL ORDER BY created_at, id LIMIT 1')
    .get(userId, t.eventId, t.itemId) ?? null;
}

function _release(tradeId, userId) {
  const rows = conn().prepare('SELECT id FROM souvenir_copies WHERE trade_id = ?').all(tradeId);
  conn().prepare('UPDATE souvenir_copies SET trade_id = NULL WHERE trade_id = ?').run(tradeId);
  for (const r of rows) _copyLog(r.id, 'release', { from: userId, tradeId });
  if (rows.length && userId) _bump(userId);
}

function _setStatus(tr, status, nowMs) {
  conn().prepare('UPDATE souvenir_trades SET status = ?, version = version + 1, updated_at = ? WHERE id = ?').run(status, _iso(nowMs), tr.id);
}

/** Ferme les propositions en attente : expirées (ou toutes, quand les échanges sont désactivés). */
function _closePending(reason, nowMs) {
  const rows = reason === 'disabled'
    ? conn().prepare("SELECT * FROM souvenir_trades WHERE status = 'pending'").all()
    : conn().prepare("SELECT * FROM souvenir_trades WHERE status = 'pending' AND expires_at <= ?").all(_iso(nowMs));
  for (const tr of rows) { _release(tr.id, tr.from_user); _setStatus(tr, reason === 'disabled' ? 'cancelled' : 'expired', nowMs); }
  // Réservation orpheline (ex. exemplaire restauré par un reset de test #75) : libérée, jamais bloquée à vie.
  const orphans = conn().prepare(`SELECT c.id, c.user_id FROM souvenir_copies c LEFT JOIN souvenir_trades t ON t.id = c.trade_id
      WHERE c.trade_id IS NOT NULL AND (t.id IS NULL OR t.status <> 'pending' OR t.from_user <> c.user_id)`).all();
  for (const o of orphans) { conn().prepare('UPDATE souvenir_copies SET trade_id = NULL WHERE id = ?').run(o.id); _copyLog(o.id, 'release_orphan', { from: o.user_id }); }
  return rows.length;
}
function expireTrades(nowMs = Date.now()) { return db.runTransaction(() => _closePending('expired', nowMs)); }

function _get(id) { return conn().prepare('SELECT * FROM souvenir_trades WHERE id = ?').get(id); }

function _tradeView(tr, viewerId) {
  return { id: tr.id, status: tr.status, version: tr.version, mine: tr.from_user === viewerId,
    from: _user(tr.from_user)?.username ?? null, to: _user(tr.to_user)?.username ?? null,
    offer: { eventId: tr.offer_event, itemId: tr.offer_item }, want: { eventId: tr.want_event, itemId: tr.want_item },
    parentId: tr.parent_id, createdAt: tr.created_at, expiresAt: tr.expires_at, updatedAt: tr.updated_at };
}

/**
 * Proposition : `fromId` offre UN double de `offer` à `to` (pseudo) contre UN double de `want`.
 * Réserve aussitôt l'exemplaire offert. `requestId` rend la proposition idempotente (double clic,
 * rejeu, deux onglets) : la même proposition est renvoyée, rien n'est réservé deux fois.
 */
function propose(fromId, { to, offer, want, requestId = null, parentId = null } = {}, { nowMs = Date.now() } = {}) {
  _assertOn();
  const s = settings();
  const o = _type(offer, 'Souvenir offert'), w = _type(want, 'Souvenir demandé');
  if (_typeKey(o) === _typeKey(w)) throw new SouvenirError(400, 'Échange d\'un souvenir contre le même souvenir : refusé.', 'same_type');
  const rid = requestId == null ? null : String(requestId).slice(0, 64);
  expireTrades(nowMs);   // transaction à part : validée même si la suite est refusée
  return db.runTransaction(() => {
    if (rid) {
      const prev = conn().prepare('SELECT * FROM souvenir_trades WHERE from_user = ? AND request_id = ?').get(fromId, rid);
      if (prev) return _tradeView(prev, fromId);
    }
    const dest = conn().prepare('SELECT id FROM users WHERE username = ?').get(String(to ?? '').trim().toLowerCase());
    if (!dest) throw new SouvenirError(404, 'Joueur introuvable.', 'no_user');
    if (dest.id === fromId) throw new SouvenirError(400, 'Échange avec soi-même : refusé.', 'self_trade');
    _assertEligible(fromId, 'Vous', nowMs);
    _assertEligible(dest.id, 'Ce joueur', nowMs);
    const pending = conn().prepare("SELECT COUNT(*) AS n FROM souvenir_trades WHERE from_user = ? AND status = 'pending'").get(fromId).n;
    if (pending >= s.trade_max_pending) throw new SouvenirError(429, 'Trop de propositions en attente.', 'too_many_pending');
    const copy = _freeCopy(fromId, o);
    if (!copy) throw new SouvenirError(409, 'Aucun double libre de ce souvenir à offrir.', 'no_free_copy');
    const at = _iso(nowMs);
    const r = conn().prepare(`INSERT INTO souvenir_trades (from_user, to_user, offer_event, offer_item, offer_copy_id, want_event, want_item,
        parent_id, request_id, created_at, expires_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(fromId, dest.id, o.eventId, o.itemId, copy.id, w.eventId, w.itemId, parentId, rid, at, _iso(nowMs + s.trade_ttl_hours * 3_600_000), at);
    const u = conn().prepare('UPDATE souvenir_copies SET trade_id = ? WHERE id = ? AND user_id = ? AND trade_id IS NULL').run(r.lastInsertRowid, copy.id, fromId);
    if (u.changes !== 1) throw new SouvenirError(409, 'Exemplaire déjà réservé.', 'race');
    _copyLog(copy.id, 'reserve', { from: fromId, to: dest.id, tradeId: r.lastInsertRowid });
    _bump(fromId);
    return _tradeView(_get(r.lastInsertRowid), fromId);
  });
}

function _pendingFor(id, userId, role, version) {
  const tr = _get(Number(id));
  if (!tr || (tr.from_user !== userId && tr.to_user !== userId)) throw new SouvenirError(404, 'Échange introuvable.', 'no_trade');
  if (role === 'to' && tr.to_user !== userId) throw new SouvenirError(403, 'Seul le destinataire peut répondre.', 'not_recipient');
  if (role === 'from' && tr.from_user !== userId) throw new SouvenirError(403, 'Seul l\'auteur peut annuler.', 'not_author');
  if (tr.status !== 'pending') throw new SouvenirError(409, `Échange déjà ${tr.status}.`, 'not_pending');
  if (version != null && Number(version) !== tr.version) throw new SouvenirError(409, 'Échange modifié entre-temps : rechargez.', 'stale');
  return tr;
}

/**
 * Acceptation par le destinataire : échange atomique de l'exemplaire réservé de l'auteur contre un
 * double libre du destinataire. Tout est revérifié dans la transaction ; un deuxième appel trouve
 * l'échange conclu (409) et ne transfère rien.
 */
function accept(userId, tradeId, { version = null, nowMs = Date.now() } = {}) {
  _assertOn();
  const s = settings();
  // Échec qui CLÔT l'échange (exemplaire offert disparu) : validé, puis signalé hors transaction.
  let closed = null;
  expireTrades(nowMs);
  const res = db.runTransaction(() => {
    const tr = _pendingFor(tradeId, userId, 'to', version);
    _assertEligible(tr.from_user, 'L\'auteur', nowMs);
    _assertEligible(tr.to_user, 'Vous', nowMs);
    const since = _iso(nowMs - 86_400_000);
    for (const u of [tr.from_user, tr.to_user]) {
      const n = conn().prepare("SELECT COUNT(*) AS n FROM souvenir_trades WHERE status = 'completed' AND (from_user = ? OR to_user = ?) AND updated_at > ?").get(u, u, since).n;
      if (n >= s.trade_daily_max) throw new SouvenirError(429, 'Limite quotidienne d\'échanges atteinte.', 'daily_limit');
    }
    const offered = conn().prepare('SELECT * FROM souvenir_copies WHERE id = ?').get(tr.offer_copy_id);
    if (!offered || offered.user_id !== tr.from_user || offered.trade_id !== tr.id) {
      _release(tr.id, tr.from_user); _setStatus(tr, 'failed', nowMs);
      closed = new SouvenirError(409, 'L\'exemplaire offert n\'est plus disponible : échange annulé.', 'offer_gone');
      return null;
    }
    const fromInv = inventory(tr.from_user).items[`${tr.offer_event}/${tr.offer_item}`];
    if (!fromInv || fromInv.qty < 2) {
      _release(tr.id, tr.from_user); _setStatus(tr, 'failed', nowMs);
      closed = new SouvenirError(409, 'Inventaire incohérent : échange annulé.', 'inconsistent');
      return null;
    }
    const mine = _freeCopy(userId, { eventId: tr.want_event, itemId: tr.want_item });
    if (!mine) throw new SouvenirError(409, 'Vous n\'avez pas de double libre du souvenir demandé.', 'no_free_copy');
    const at = _iso(nowMs);
    const a = conn().prepare('UPDATE souvenir_copies SET user_id = ?, owner_since = ?, trade_id = NULL WHERE id = ? AND user_id = ? AND trade_id = ?')
      .run(tr.to_user, at, offered.id, tr.from_user, tr.id);
    const b = conn().prepare('UPDATE souvenir_copies SET user_id = ?, owner_since = ? WHERE id = ? AND user_id = ? AND trade_id IS NULL')
      .run(tr.from_user, at, mine.id, userId);
    if (a.changes !== 1 || b.changes !== 1) throw new SouvenirError(409, 'Exemplaire modifié pendant l\'échange : rien n\'a été transféré.', 'race');
    conn().prepare("UPDATE souvenir_trades SET status = 'completed', want_copy_id = ?, version = version + 1, updated_at = ? WHERE id = ?").run(mine.id, at, tr.id);
    _copyLog(offered.id, 'transfer', { from: tr.from_user, to: tr.to_user, tradeId: tr.id });
    _copyLog(mine.id, 'transfer', { from: tr.to_user, to: tr.from_user, tradeId: tr.id });
    _bump(tr.from_user); _bump(tr.to_user);
    try { db.logUserEvent(tr.from_user, 'souvenir_trade_completed', { tradeId: tr.id }); db.logUserEvent(tr.to_user, 'souvenir_trade_completed', { tradeId: tr.id }); } catch (_) { /* journal facultatif */ }
    return _tradeView(_get(tr.id), userId);
  });
  if (closed) throw closed;
  return res;
}

/** Refus (destinataire) ou annulation (auteur) : libère l'exemplaire réservé. */
function decline(userId, tradeId, { version = null, nowMs = Date.now() } = {}) {
  expireTrades(nowMs);
  return db.runTransaction(() => {
    const tr = _pendingFor(tradeId, userId, 'to', version);
    _release(tr.id, tr.from_user); _setStatus(tr, 'declined', nowMs);
    return _tradeView(_get(tr.id), userId);
  });
}
function cancel(userId, tradeId, { version = null, nowMs = Date.now() } = {}) {
  expireTrades(nowMs);
  return db.runTransaction(() => {
    const tr = _pendingFor(tradeId, userId, 'from', version);
    _release(tr.id, tr.from_user); _setStatus(tr, 'cancelled', nowMs);
    return _tradeView(_get(tr.id), userId);
  });
}

/**
 * Contre-proposition du destinataire : l'échange initial est clos (`countered`, exemplaire libéré) et
 * une nouvelle proposition part dans l'autre sens — il offre le souvenir demandé, contre `want`.
 */
function counter(userId, tradeId, { want, version = null, requestId = null } = {}, { nowMs = Date.now() } = {}) {
  _assertOn();
  expireTrades(nowMs);
  return db.runTransaction(() => {
    const tr = _pendingFor(tradeId, userId, 'to', version);
    const author = _user(tr.from_user);
    if (!author) throw new SouvenirError(404, 'Joueur introuvable.', 'no_user');
    _release(tr.id, tr.from_user); _setStatus(tr, 'countered', nowMs);
    return propose(userId, { to: author.username, offer: { eventId: tr.want_event, itemId: tr.want_item },
      want: want ?? { eventId: tr.offer_event, itemId: tr.offer_item }, requestId, parentId: tr.id }, { nowMs });
  });
}

function listTrades(userId, { nowMs = Date.now() } = {}) {
  expireTrades(nowMs);
  return conn().prepare('SELECT * FROM souvenir_trades WHERE from_user = ? OR to_user = ? ORDER BY id DESC LIMIT 50').all(userId, userId).map(tr => _tradeView(tr, userId));
}

/**
 * Retour arrière admin d'un échange conclu : chaque exemplaire revient à son propriétaire précédent,
 * seulement s'il est toujours chez le receveur et libre (sinon refus, rien n'est modifié).
 */
function adminRollback(tradeId, { reason = '', nowMs = Date.now() } = {}) {
  return db.runTransaction(() => {
    const tr = _get(Number(tradeId));
    if (!tr) throw new SouvenirError(404, 'Échange introuvable.');
    if (tr.status !== 'completed') throw new SouvenirError(409, 'Seul un échange conclu peut être annulé.');
    const at = _iso(nowMs);
    const a = conn().prepare('UPDATE souvenir_copies SET user_id = ?, owner_since = ? WHERE id = ? AND user_id = ? AND trade_id IS NULL').run(tr.from_user, at, tr.offer_copy_id, tr.to_user);
    const b = conn().prepare('UPDATE souvenir_copies SET user_id = ?, owner_since = ? WHERE id = ? AND user_id = ? AND trade_id IS NULL').run(tr.to_user, at, tr.want_copy_id, tr.from_user);
    if (a.changes !== 1 || b.changes !== 1) throw new SouvenirError(409, 'Exemplaires déjà déplacés ou réservés : retour arrière impossible, rien n\'a changé.', 'moved');
    _setStatus(tr, 'rolled_back', nowMs);
    _copyLog(tr.offer_copy_id, 'rollback', { from: tr.to_user, to: tr.from_user, tradeId: tr.id, details: { reason: String(reason).slice(0, 200) } });
    _copyLog(tr.want_copy_id, 'rollback', { from: tr.from_user, to: tr.to_user, tradeId: tr.id, details: { reason: String(reason).slice(0, 200) } });
    _bump(tr.from_user); _bump(tr.to_user);
    _adminLog('rollback', { tradeId: tr.id, reason: String(reason).slice(0, 200) });
    return { trade: _tradeView(_get(tr.id), null) };
  });
}

// ── Contrôles et vue admin ────────────────────────────────────────────────────

/**
 * Audit d'intégrité (lecture seule) : réservations orphelines, exemplaire en double avec sa propre
 * découverte… Doit toujours renvoyer des listes vides.
 */
function audit() {
  const c = conn();
  return {
    orphanReservations: c.prepare(`SELECT c.id FROM souvenir_copies c LEFT JOIN souvenir_trades t ON t.id = c.trade_id
        WHERE c.trade_id IS NOT NULL AND (t.id IS NULL OR t.status <> 'pending' OR t.from_user <> c.user_id)`).all().map(r => r.id),
    pendingWithoutReservation: c.prepare(`SELECT t.id FROM souvenir_trades t LEFT JOIN souvenir_copies c ON c.id = t.offer_copy_id AND c.trade_id = t.id
        WHERE t.status = 'pending' AND c.id IS NULL`).all().map(r => r.id),
    overMinted: c.prepare(`SELECT first_owner_id AS u, event_id AS e, item_id AS i, COUNT(*) AS n FROM souvenir_copies WHERE origin = 'duplicate'
        GROUP BY 1, 2, 3 HAVING n > ${HARD_MAX_COPIES - 1}`).all(),
  };
}

function adminView() {
  const c = conn();
  const count = (sql, ...a) => c.prepare(sql).get(...a).n;
  return {
    settings: settings(),
    rules: listRules(),
    totals: {
      discoveries: count('SELECT COUNT(*) AS n FROM monthly_event_finds'),
      extraCopies: count('SELECT COUNT(*) AS n FROM souvenir_copies'),
      reserved: count('SELECT COUNT(*) AS n FROM souvenir_copies WHERE trade_id IS NOT NULL'),
      tradesPending: count("SELECT COUNT(*) AS n FROM souvenir_trades WHERE status = 'pending'"),
      tradesCompleted: count("SELECT COUNT(*) AS n FROM souvenir_trades WHERE status = 'completed'"),
    },
    audit: audit(),
    recent: c.prepare('SELECT id, at, action, details FROM souvenir_admin_log ORDER BY id DESC LIMIT 20').all().map(r => ({ ...r, details: J(r.details, null) })),
  };
}

// ── Simulation des doubles (aucune écriture) ──────────────────────────────────

/** PRNG déterministe (mulberry32) : simulation reproductible. */
function _prng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Tirage géométrique : rang (≥ 1) du premier succès de probabilité p, Infinity si p = 0. */
const _geom = (p, r) => (p > 0 ? Math.ceil(Math.log(1 - r()) / Math.log1p(-p)) || 1 : Infinity);

/** Profils de joueurs : part de la population, blocs validés par jour, profondeur retenue. */
const PROFILES = [
  { key: 'occasionnel', share: 0.5, blocksPerDay: 100, depth: 8, days: 10 },
  { key: 'regulier', share: 0.3, blocksPerDay: 300, depth: 25, days: 20 },
  { key: 'assidu', share: 0.15, blocksPerDay: 800, depth: 50, days: 28 },
  { key: 'acharne', share: 0.05, blocksPerDay: 2000, depth: 80, days: 30 },
];

/**
 * Simule `players` joueurs (répartis selon PROFILES) sur un événement, avec un barème de doubles :
 * { factor, maxCopies } (même règle pour tous les objets, sinon `byRarity`). Probabilité par bloc
 * = chance de l'objet × part des blocs éligibles (monthlyEvents.simulate). Renvoie par profil : types
 * distincts trouvés, doubles obtenus, part des joueurs ayant au moins un double échangeable, part
 * ayant la collection complète, exemplaires au total (pour borner l'inventaire).
 */
function simulateDuplicates(ev, { players = 10_000, factor = 0, maxCopies = 1, byRarity = null, seed = 93, profiles = PROFILES } = {}) {
  const me = require('./monthlyEvents');
  const r = _prng(seed);
  const items = ev.items.filter(i => i.enabled !== false && !i.proposal);
  const pCache = new Map();
  const pOf = depth => {
    if (!pCache.has(depth)) pCache.set(depth, me.simulate({ ...ev, items }, { depth, blocksPerDay: 1 }).items.map(x => x.perBlock));
    return pCache.get(depth);
  };
  const out = [];
  for (const pr of profiles) {
    const n = Math.max(1, Math.round(players * pr.share));
    const ps = pOf(pr.depth);
    const blocks = pr.blocksPerDay * pr.days;
    let distinct = 0, dups = 0, withDup = 0, complete = 0, maxCopiesSeen = 0;
    const dist = [];
    for (let k = 0; k < n; k++) {
      let d = 0, du = 0;
      items.forEach((it, idx) => {
        const rule = byRarity?.[it.rarity] ?? { factor, maxCopies };
        const t = _geom(ps[idx], r);
        if (t > blocks) return;
        d += 1;
        let left = blocks - t, got = 0;
        const pd = ps[idx] * rule.factor;
        while (got < rule.maxCopies - 1) { const g = _geom(pd, r); if (g > left) break; left -= g; got += 1; }
        du += got;
        if (got + 1 > maxCopiesSeen) maxCopiesSeen = got + 1;
      });
      distinct += d; dups += du; if (du > 0) withDup += 1; if (d === items.length) complete += 1;
      dist.push(d);
    }
    dist.sort((a, b) => a - b);
    out.push({ profile: pr.key, players: n, blocks, depth: pr.depth,
      avgDistinct: Math.round(distinct / n * 10) / 10, medianDistinct: dist[Math.floor(n / 2)],
      avgDuplicates: Math.round(dups / n * 10) / 10, withDuplicatePct: Math.round(withDup / n * 1000) / 10,
      completePct: Math.round(complete / n * 1000) / 10, maxCopiesSeen });
  }
  return { items: items.length, factor, maxCopies, byRarity, profiles: out };
}

module.exports = {
  SouvenirError, SETTINGS_DEFAULT, MAX_DUPS_PER_SAVE, HARD_MAX_COPIES, PROFILES,
  init, settings, updateSettings, duplicatesEnabled, tradesEnabled,
  listRules, setRule, dupPlanFor, mintDuplicate, extraTypes,
  inventory, inventoryVersion, quantities, eligibility,
  propose, accept, decline, cancel, counter, listTrades, expireTrades, adminRollback,
  audit, adminView, simulateDuplicates,
};
