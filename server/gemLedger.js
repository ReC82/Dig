/**
 * server/gemLedger.js — Registre de gemmes de référence côté serveur (#49, lot 1, décision du 04/11).
 *
 * Aujourd'hui le navigateur calcule les gemmes et les écrit dans la sauvegarde (POST /api/me/save) :
 * un client modifié peut en écrire autant qu'il veut. Ce module tient, à côté de la sauvegarde,
 * un SOLDE DE RÉFÉRENCE par joueur et un JOURNAL append-only de chaque mouvement.
 *
 * Modes (réglage `gem_ledger_settings.mode`, journalisé ; défaut `off`) :
 *   - `off`     : rien n'est lu ni écrit (comportement d'avant #49) ;
 *   - `observe` : à chaque sauvegarde acceptée, le serveur met à jour le solde de référence et
 *                 note les écarts avec le solde déclaré par le client. La sauvegarde n'est JAMAIS
 *                 modifiée et le joueur ne voit rien ;
 *   - `enforce` : le solde de référence fait foi : il remplace `gems` dans la sauvegarde renvoyée au
 *                 client (lecture et réponse d'écriture), sans réécrire la sauvegarde stockée.
 *                 Activation réservée au propriétaire, après recette du mode `observe`.
 *
 * Crédits « selon preuves » :
 *   - blocs gemmes : blocs VALIDÉS par le serveur (statistiques fiables de #38, bornées par la
 *     profondeur retenue et le budget de dégâts) × gemmes par bloc (1 par défaut, `gemReward: false`
 *     → 0, barème publié ensuite) ; jamais le compteur déclaré ;
 *   - autres sources calculées par le navigateur (série quotidienne, missions, objectifs) : écart
 *     déclaré, crédité dans la limite d'une allocation par jour (Europe/Brussels) ; le surplus est
 *     noté comme anomalie et n'est pas crédité ;
 *   - dépenses : déduites de la montée du niveau Auto-Dig (coûts de public/js/balance.js) et, plus
 *     tard, des achats en gemmes (spend(), atomique et idempotent).
 *
 * Migration : à la première observation d'un joueur, le solde de référence = gemmes de sa sauvegarde
 * (« ouverture ») : aucune gemme déjà acquise n'est retirée. Le solde de référence ne baisse que par
 * une dépense ou le plafond de fin de saison (`gems_cap`) ; une baisse inexpliquée côté client est
 * notée (perte côté client), jamais reportée sur le solde de référence.
 *
 * Idempotence : chaque mouvement porte une clé unique par joueur (`op_key`) ; un rejeu renvoie le
 * mouvement déjà enregistré. Tout passe par runTransaction (une seule écriture SQLite à la fois) :
 * deux achats simultanés ne peuvent pas dépenser deux fois le même solde.
 */

'use strict';

const db = require('./db');

const MODES = ['off', 'observe', 'enforce'];
const TZ = 'Europe/Brussels';
/** Coûts en gemmes de l'Auto-Dig par niveau atteint (public/js/balance.js AUTODIG, vérifié par test). */
const AUTODIG_GEM_COST = { 1: 0, 2: 0, 3: 4, 4: 8, 5: 18, 6: 35 };
/**
 * Allocation par jour pour les sources calculées par le navigateur. Barème actuel : série (jour 7 :
 * 4) + mission « trouver des gemmes » (1) + mission « ouvrir des coffres » (1) + objectif « première
 * gemme » (1) = 7 ; +1 de marge pour le bonus « trois missions » du barème A.
 */
const DEFAULT_DAILY_ALLOWANCE = 8;
const MAX_TYPES = 200;
const ID_RE = /^[a-z][a-z0-9_]{1,39}$/;
const OPKEY_RE = /^[A-Za-z0-9:_\-.]{1,80}$/;

class GemError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

const conn = () => db.getDb();

/** Tables en ajout seul. Idempotent. */
function init() {
  conn().exec(`
    CREATE TABLE IF NOT EXISTS gem_accounts (
      user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      balance        INTEGER NOT NULL,
      opening        INTEGER NOT NULL,
      season_id      INTEGER,
      ref_blocks     TEXT    NOT NULL DEFAULT '{}',
      ref_declared   TEXT    NOT NULL DEFAULT '{}',
      ref_autodig    INTEGER NOT NULL DEFAULT 0,
      last_client    INTEGER NOT NULL,
      last_revision  INTEGER NOT NULL DEFAULT 0,
      allowance_day  TEXT,
      allowance_used INTEGER NOT NULL DEFAULT 0,
      drift          INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS gem_ledger (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      op_key        TEXT    NOT NULL,
      delta         INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      reason        TEXT    NOT NULL,
      details       TEXT,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, op_key)
    );
    CREATE INDEX IF NOT EXISTS idx_gem_ledger_user ON gem_ledger(user_id, id);
    CREATE TABLE IF NOT EXISTS gem_anomalies (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind       TEXT    NOT NULL,
      amount     INTEGER NOT NULL,
      details    TEXT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_gem_anomalies_user ON gem_anomalies(user_id, id);
    CREATE TABLE IF NOT EXISTS gem_ledger_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS gem_ledger_audit (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      action     TEXT NOT NULL,
      old_value  TEXT,
      new_value  TEXT,
      note       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  conn().prepare(`INSERT INTO gem_ledger_settings (key, value) VALUES ('mode', 'off') ON CONFLICT(key) DO NOTHING`).run();
  conn().prepare(`INSERT INTO gem_ledger_settings (key, value) VALUES ('daily_allowance', ?) ON CONFLICT(key) DO NOTHING`)
    .run(String(DEFAULT_DAILY_ALLOWANCE));
}

// ── Réglages ─────────────────────────────────────────────────────────────────

function _setting(key) { return conn().prepare('SELECT value FROM gem_ledger_settings WHERE key = ?').get(key)?.value ?? null; }

function getMode() {
  const m = _setting('mode');
  return MODES.includes(m) ? m : 'off';
}

function dailyAllowance() {
  const n = parseInt(_setting('daily_allowance') ?? '', 10);
  return Number.isSafeInteger(n) && n >= 0 ? n : DEFAULT_DAILY_ALLOWANCE;
}

/** Changement de mode par l'admin, journalisé. */
function setMode(mode, { note = '' } = {}) {
  if (!MODES.includes(mode)) throw new GemError(400, `Mode inconnu : ${mode}.`, 'bad_mode');
  return db.runTransaction(() => {
    const old = getMode();
    if (old === mode) return { mode, changed: false };
    conn().prepare(`UPDATE gem_ledger_settings SET value = ?, updated_at = datetime('now') WHERE key = 'mode'`).run(mode);
    conn().prepare('INSERT INTO gem_ledger_audit (action, old_value, new_value, note) VALUES (?, ?, ?, ?)')
      .run('mode', old, mode, String(note ?? '').slice(0, 300));
    return { mode, changed: true };
  });
}

// ── Gemmes par bloc (barème) ─────────────────────────────────────────────────

/**
 * Gemmes rapportées par bloc pour chaque type publié de catégorie gemme. Barème actuel : 1, ou 0
 * pour `gemReward: false`. `overrides` (barème publié plus tard, ex. A) remplace la valeur par type.
 */
function gemValues(overrides = null) {
  const blockCatalog = require('./blockCatalog');
  const out = {};
  for (const t of blockCatalog.getPublished().types) {
    if (t.category !== 'gemme') continue;
    out[t.id] = overrides && Number.isSafeInteger(overrides[t.id]) && overrides[t.id] >= 0 ? overrides[t.id]
      : (t.gemReward === false ? 0 : 1);
  }
  return out;
}

// ── Journal ──────────────────────────────────────────────────────────────────

function _account(userId) { return conn().prepare('SELECT * FROM gem_accounts WHERE user_id = ?').get(userId) ?? null; }

/** Écrit un mouvement ; idempotent par (user_id, op_key). Retourne { entry, replayed }. */
function _entry(userId, opKey, delta, balanceAfter, reason, details = null) {
  const prev = conn().prepare('SELECT * FROM gem_ledger WHERE user_id = ? AND op_key = ?').get(userId, opKey);
  if (prev) return { entry: prev, replayed: true };
  conn().prepare('INSERT INTO gem_ledger (user_id, op_key, delta, balance_after, reason, details) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, opKey, delta, balanceAfter, reason, details ? JSON.stringify(details) : null);
  return { entry: conn().prepare('SELECT * FROM gem_ledger WHERE user_id = ? AND op_key = ?').get(userId, opKey), replayed: false };
}

function _anomaly(userId, kind, amount, details) {
  conn().prepare('INSERT INTO gem_anomalies (user_id, kind, amount, details) VALUES (?, ?, ?, ?)')
    .run(userId, kind, amount, details ? JSON.stringify(details) : null);
}

function _day(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

function _int(v) { return Number.isSafeInteger(v) && v >= 0 ? v : 0; }

function _counts(raw, ids) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (n++ >= MAX_TYPES) break;
    if (ID_RE.test(k) && ids.has(k) && Number.isSafeInteger(v) && v >= 0) out[k] = v;
  }
  return out;
}

function _validatedGemBlocks(userId, values) {
  const badges = require('./badges');
  const out = {};
  for (const [k, v] of Object.entries(badges.validatedStats(userId))) {
    if (k.startsWith('blocks:') && Object.hasOwn(values, k.slice(7))) out[k.slice(7)] = v;
  }
  return out;
}

function _autodigCost(from, to) {
  let c = 0;
  for (let l = from + 1; l <= to; l++) c += AUTODIG_GEM_COST[l] ?? 0;
  return c;
}

/**
 * Observe une sauvegarde acceptée (après badges.processSave, qui valide les blocs).
 * Ne modifie jamais `data`. Sans effet en mode `off`.
 * @param {number} userId
 * @param {object} data      sauvegarde écrite
 * @param {object} opts      { revision (révision écrite : clé d'idempotence), nowMs, force (tests) }
 * @returns {null | { balance, credited, debited, excess, loss }}
 */
function observeSave(userId, data, { revision, nowMs = Date.now(), force = false, gemsCap = null, values = null } = {}) {
  if (!force && getMode() === 'off') return null;
  if (!Number.isSafeInteger(revision)) throw new GemError(400, 'Révision manquante.', 'no_revision');
  const vals = values ?? gemValues();
  const ids = new Set(Object.keys(vals));
  const clientGems = _int(data?.gems);
  const autodig = Math.min(6, _int(data?.upgrades?.autodig));
  const seasonId = Number.isSafeInteger(data?.seasonStats?.seasonId) ? data.seasonStats.seasonId : null;
  const declared = _counts(data?.stats?.minedByType, ids);
  const cap = gemsCap ?? parseInt(db.getAdminConfig().gems_cap ?? '100', 10);
  const allowance = dailyAllowance();
  const day = _day(nowMs);

  return db.runTransaction(() => {
    const validated = _validatedGemBlocks(userId, vals);
    let a = _account(userId);
    const key = `save:${revision}`;
    if (!a) {
      // Ouverture : on reprend le solde du joueur tel quel (aucune gemme retirée)
      conn().prepare(`INSERT INTO gem_accounts (user_id, balance, opening, season_id, ref_blocks, ref_declared, ref_autodig, last_client, last_revision)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(userId, clientGems, clientGems, seasonId, JSON.stringify(validated), JSON.stringify(declared), autodig, clientGems, revision);
      _entry(userId, 'opening', clientGems, clientGems, 'opening', { revision, seasonId, autodig });
      return { balance: clientGems, credited: 0, debited: 0, excess: 0, loss: 0, opened: true };
    }
    // Rejeu ou réponse arrivée dans le désordre : une révision déjà traitée ne compte jamais deux fois
    if (revision <= a.last_revision) {
      return { balance: a.balance, credited: 0, debited: 0, excess: 0, loss: 0, replayed: true };
    }

    let balance = a.balance;
    let refAutodig = a.ref_autodig;
    let lastClient = a.last_client;
    let used = a.allowance_day === day ? a.allowance_used : 0;
    const refBlocks = JSON.parse(a.ref_blocks || '{}');
    const refDeclared = JSON.parse(a.ref_declared || '{}');
    let credited = 0, debited = 0, excess = 0, loss = 0;

    // Nouvelle saison : plafond de fin de saison appliqué une fois, Auto-Dig remis à zéro
    if (seasonId !== null && a.season_id !== null && seasonId !== a.season_id) {
      if (balance > cap) {
        const d = cap - balance;
        balance = cap;
        _entry(userId, `season_cap:${seasonId}`, d, balance, 'season_cap', { from: a.season_id, to: seasonId, cap });
      }
      refAutodig = 0;
      lastClient = Math.min(lastClient, cap);
    }
    // Réinitialisation (admin, appareil) : un compteur ou un niveau qui baisse devient la nouvelle référence
    if (autodig < refAutodig) refAutodig = autodig;
    for (const [id, v] of Object.entries(declared)) if ((refDeclared[id] ?? 0) > v) refDeclared[id] = v;

    // 1. Blocs gemmes validés par le serveur
    let blockGems = 0;
    for (const [id, v] of Object.entries(validated)) {
      const d = v - (refBlocks[id] ?? 0);
      if (d > 0) blockGems += d * (vals[id] ?? 0);
      refBlocks[id] = v;
    }
    if (blockGems > 0) {
      balance += blockGems; credited += blockGems;
      _entry(userId, `${key}:blocks`, blockGems, balance, 'blocks', { validated });
    }

    // 2. Dépenses Auto-Dig (montée de niveau dans la saison)
    const spent = _autodigCost(refAutodig, autodig);
    if (spent > 0) {
      const d = Math.min(spent, balance);
      balance -= d; debited += d;
      _entry(userId, `${key}:autodig`, -d, balance, 'autodig', { from: refAutodig, to: autodig, cost: spent });
      if (d < spent) _anomaly(userId, 'spend_over_balance', spent - d, { revision, from: refAutodig, to: autodig });
    }
    refAutodig = Math.max(refAutodig, autodig);

    // 3. Autres sources déclarées : écart client − blocs gemmes déclarés + dépenses
    let declaredBlockGems = 0;
    for (const [id, v] of Object.entries(declared)) {
      const d = v - (refDeclared[id] ?? 0);
      if (d > 0) declaredBlockGems += d * (vals[id] ?? 0);
      refDeclared[id] = v;
    }
    const other = (clientGems - lastClient) + spent - declaredBlockGems;
    if (other > 0) {
      const room = Math.max(0, allowance - used);
      const ok = Math.min(other, room);
      if (ok > 0) {
        balance += ok; credited += ok; used += ok;
        _entry(userId, `${key}:declared`, ok, balance, 'declared', { day, used, allowance });
      }
      if (other > ok) { excess = other - ok; _anomaly(userId, 'excess_declared', excess, { revision, day, allowance }); }
    } else if (other < 0) {
      loss = -other;
      _anomaly(userId, 'client_loss', loss, { revision });
    }

    // En mode `enforce`, le client reprend le solde de référence renvoyé par le serveur
    const enforce = getMode() === 'enforce';
    const drift = enforce ? 0 : clientGems - balance;
    conn().prepare(`UPDATE gem_accounts SET balance = ?, season_id = COALESCE(?, season_id), ref_blocks = ?, ref_declared = ?,
        ref_autodig = ?, last_client = ?, last_revision = ?, allowance_day = ?, allowance_used = ?, drift = ?, updated_at = datetime('now')
        WHERE user_id = ?`)
      .run(balance, seasonId, JSON.stringify(refBlocks), JSON.stringify(refDeclared), refAutodig,
        enforce ? balance : clientGems, revision, day, used, drift, userId);
    return { balance, credited, debited, excess, loss, drift };
  });
}

/**
 * Transaction IMMEDIATE : verrou d'écriture pris AVANT la lecture du solde. En WAL, une transaction
 * différée qui lit puis écrit échoue en SQLITE_BUSY_SNAPSHOT si un autre processus a écrit entre-temps
 * (refus parasite, jamais de dépense en trop) ; observé 2 fois sur 12 dans le test à 4 processus.
 */
const _immediate = fn => db.getDb().transaction(fn).immediate();

/**
 * Dépense atomique et idempotente (boutique en gemmes, plus tard). Le même `opKey` rejoué renvoie le
 * même résultat sans redébiter. Solde insuffisant → 409, rien n'est écrit.
 */
function spend(userId, amount, opKey, { reason = 'purchase', details = null } = {}) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new GemError(400, 'Montant invalide.', 'bad_amount');
  if (typeof opKey !== 'string' || !OPKEY_RE.test(opKey)) throw new GemError(400, 'Clé d\'opération invalide.', 'bad_key');
  return _immediate(() => {
    const key = `spend:${opKey}`;
    const prev = conn().prepare('SELECT * FROM gem_ledger WHERE user_id = ? AND op_key = ?').get(userId, key);
    if (prev) return { balance: prev.balance_after, replayed: true, entryId: prev.id };
    const a = _account(userId);
    if (!a) throw new GemError(409, 'Aucun solde de gemmes de référence pour ce joueur.', 'no_account');
    if (a.balance < amount) throw new GemError(409, 'Gemmes insuffisantes.', 'insufficient');
    const balance = a.balance - amount;
    const { entry } = _entry(userId, key, -amount, balance, reason, details);
    // Le client retire la même somme de son côté : ce n'est pas une perte à signaler
    conn().prepare(`UPDATE gem_accounts SET balance = ?, last_client = MAX(0, last_client - ?), updated_at = datetime('now') WHERE user_id = ?`)
      .run(balance, amount, userId);
    return { balance, replayed: false, entryId: entry.id };
  });
}

/** Crédit administratif ou de compensation, idempotent (jamais appelé par le jeu aujourd'hui). */
function credit(userId, amount, opKey, { reason = 'admin_credit', details = null } = {}) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new GemError(400, 'Montant invalide.', 'bad_amount');
  if (typeof opKey !== 'string' || !OPKEY_RE.test(opKey)) throw new GemError(400, 'Clé d\'opération invalide.', 'bad_key');
  return _immediate(() => {
    const key = `credit:${opKey}`;
    const prev = conn().prepare('SELECT * FROM gem_ledger WHERE user_id = ? AND op_key = ?').get(userId, key);
    if (prev) return { balance: prev.balance_after, replayed: true, entryId: prev.id };
    const a = _account(userId);
    if (!a) throw new GemError(409, 'Aucun solde de gemmes de référence pour ce joueur.', 'no_account');
    const balance = a.balance + amount;
    const { entry } = _entry(userId, key, amount, balance, reason, details);
    conn().prepare(`UPDATE gem_accounts SET balance = ?, last_client = last_client + ?, updated_at = datetime('now') WHERE user_id = ?`)
      .run(balance, amount, userId);
    return { balance, replayed: false, entryId: entry.id };
  });
}

/** Réinitialisation saisonnière d'un joueur par l'admin : même plafond que la fin de saison. */
function onAdminSeasonReset(userId, cap, { revision } = {}) {
  if (getMode() === 'off') return null;
  return db.runTransaction(() => {
    const a = _account(userId);
    if (!a) return null;
    const balance = Math.min(a.balance, cap);
    if (balance < a.balance) _entry(userId, `admin_reset:${revision ?? Date.now()}`, balance - a.balance, balance, 'season_cap', { cap, admin: true });
    conn().prepare(`UPDATE gem_accounts SET balance = ?, ref_autodig = 0, last_client = MIN(last_client, ?), updated_at = datetime('now') WHERE user_id = ?`)
      .run(balance, cap, userId);
    return { balance };
  });
}

/**
 * Essai de test (#75) : solde de référence ramené à `balance` (0 pour un nouveau personnage) par un
 * mouvement tracé, références remises à l'état d'un nouveau compte (ou à celles de l'instantané
 * restauré `account`). Dans tous les modes, à appeler dans la transaction du reset. Le journal des
 * mouvements n'est jamais effacé ; `last_revision` = révision écrite, une ancienne révision rejouée
 * ne compte donc jamais.
 */
function onTestReset(userId, { revision, runId, balance = 0, account = null, reason = 'test_reset' } = {}) {
  const a = _account(userId);
  const ref = account ?? { ref_blocks: '{}', ref_declared: '{}', ref_autodig: 0, season_id: a?.season_id ?? null };
  if (!a) {
    if (!account) return null;
    conn().prepare(`INSERT INTO gem_accounts (user_id, balance, opening, season_id, ref_blocks, ref_declared, ref_autodig, last_client, last_revision)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(userId, balance, account.opening ?? balance, account.season_id ?? null, account.ref_blocks ?? '{}', account.ref_declared ?? '{}',
        account.ref_autodig ?? 0, balance, revision);
    _entry(userId, `${reason}:${runId}`, balance, balance, reason, { runId, revision });
    return { balance };
  }
  _entry(userId, `${reason}:${runId}`, balance - a.balance, balance, reason, { runId, revision, from: a.balance });
  conn().prepare(`UPDATE gem_accounts SET balance = ?, season_id = ?, ref_blocks = ?, ref_declared = ?, ref_autodig = ?, last_client = ?,
      last_revision = ?, drift = 0, updated_at = datetime('now') WHERE user_id = ?`)
    .run(balance, ref.season_id ?? a.season_id, ref.ref_blocks ?? '{}', ref.ref_declared ?? '{}', ref.ref_autodig ?? 0, balance, revision, userId);
  return { balance };
}

/**
 * Solde qui fait foi pour le client : seulement en mode `enforce` et si le joueur a un compte de
 * référence. Sinon null (la sauvegarde garde ses gemmes).
 */
function authoritativeBalance(userId) {
  if (getMode() !== 'enforce') return null;
  return _account(userId)?.balance ?? null;
}

/** Injecte le solde de référence dans une sauvegarde renvoyée au client (mode `enforce` seulement). */
function mergeInto(userId, data) {
  const b = authoritativeBalance(userId);
  if (b !== null && data && typeof data === 'object') data.gems = b;
  return b;
}

// ── Admin ────────────────────────────────────────────────────────────────────

function adminSummary({ limit = 50 } = {}) {
  const c = conn();
  const totals = c.prepare(`SELECT COUNT(*) AS accounts, COALESCE(SUM(balance), 0) AS balance, COALESCE(SUM(opening), 0) AS opening,
      COALESCE(SUM(CASE WHEN drift > 0 THEN 1 ELSE 0 END), 0) AS aboveReference, COALESCE(MAX(drift), 0) AS maxDrift FROM gem_accounts`).get();
  const byReason = c.prepare(`SELECT reason, COUNT(*) AS n, COALESCE(SUM(delta), 0) AS total FROM gem_ledger GROUP BY reason ORDER BY reason`).all();
  const anomalies = c.prepare(`SELECT a.id, a.user_id AS userId, u.username, a.kind, a.amount, a.details, a.created_at AS createdAt
      FROM gem_anomalies a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ?`).all(limit);
  const anomalyTotals = c.prepare('SELECT kind, COUNT(*) AS n, SUM(amount) AS total FROM gem_anomalies GROUP BY kind').all();
  const audit = c.prepare('SELECT * FROM gem_ledger_audit ORDER BY id DESC LIMIT 20').all();
  return { mode: getMode(), modes: MODES, dailyAllowance: dailyAllowance(), totals, byReason, anomalyTotals, anomalies, audit };
}

function playerLedger(userId, { limit = 100 } = {}) {
  const a = _account(userId);
  const entries = conn().prepare('SELECT id, op_key AS opKey, delta, balance_after AS balanceAfter, reason, details, created_at AS createdAt FROM gem_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit);
  return { account: a ? { balance: a.balance, opening: a.opening, seasonId: a.season_id, lastClient: a.last_client, drift: a.drift, updatedAt: a.updated_at } : null, entries };
}

module.exports = {
  init, getMode, setMode, dailyAllowance, gemValues, observeSave, spend, credit, onAdminSeasonReset, onTestReset,
  authoritativeBalance, mergeInto, adminSummary, playerLedger,
  GemError, MODES, AUTODIG_GEM_COST, DEFAULT_DAILY_ALLOWANCE,
};
