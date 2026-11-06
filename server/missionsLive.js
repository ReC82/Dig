/**
 * server/missionsLive.js — Missions quotidiennes attribuées et réclamées par le serveur (#68, étape B).
 *
 * DRAPEAU OFF PAR DÉFAUT : tant que `mission_live_settings.mode` vaut `off`, rien n'est lu ni écrit
 * et le jeu garde ses missions calculées par le navigateur (public/js/dailyMissions.js). Activation
 * réservée au propriétaire, après ses choix de barème (questions de #68, coordination #49).
 *
 * Modes (journalisés, en ajout seul) :
 *   - `off`   : comportement d'avant #68 (défaut) ;
 *   - `pilot` : seulement pour les comptes listés (recette sur un compte testeur) ;
 *   - `on`    : tous les joueurs connectés.
 *
 * Principe, pour un joueur concerné :
 *   - Attribution : au premier accès de la journée (Europe/Brussels), les missions du jour sont
 *     tirées depuis la version PUBLIÉE du catalogue (missionCatalog.planDay : rotation d'origine ou
 *     adaptative, profil = sauvegarde serveur, anti-répétition = jours précédents du joueur) et
 *     enregistrées une fois pour toutes (clé primaire joueur + jour) : F5, autre onglet, autre
 *     appareil → mêmes missions, mêmes objectifs, mêmes récompenses. Publier une nouvelle version
 *     ne modifie pas les missions déjà attribuées.
 *   - Progression : compteurs de la SAUVEGARDE SERVEUR (jamais une valeur envoyée à part), cumulés
 *     à chaque sauvegarde acceptée : une hausse s'ajoute, une baisse (fin de saison, réinitialisation,
 *     autre appareil) ne retire rien (même règle que B11). Le gain de blocs/mètres déclaré au-delà
 *     des blocs validés par le serveur (#38) est noté (observation seule, jamais bloquant).
 *   - Réclamation : transaction unique (contrôleur de partie #35, progression, ligne de réclamation
 *     joueur + jour + emplacement en clé primaire, crédit dans la sauvegarde, nouvelle révision) :
 *     une seconde réclamation (double clic, F5, deux appareils) renvoie la première sans recréditer.
 *
 * Un seul paiement par joueur, jour et mission, QUEL QUE SOIT LE MOTEUR (#83) : identité canonique
 * joueur + jour + identifiant de mission, partagée par les deux moteurs.
 *   - Missions payées par le serveur → marquées « réclamées » (`serverPaid`) dans la sauvegarde
 *     renvoyée au client (mergeInto) et listées dans la vue OFF (`paid`) : au retour en mode OFF, le
 *     jeu affiche « Réclamé » au lieu de reproposer la récompense.
 *   - Une sauvegarde qui passe à « réclamée » côté navigateur une mission déjà payée par le serveur
 *     est refusée (guardSave → 409 conflit, la version serveur est reprise) : aucun crédit local.
 *   - Une mission déjà réclamée par le navigateur aujourd'hui (sauvegarde serveur) n'est pas payée
 *     une seconde fois par le serveur (passage OFF → pilote / tous).
 */

'use strict';

const db = require('./db');
const missionCatalog = require('./missionCatalog');

const MODES = ['off', 'pilot', 'on'];
const TZ = 'Europe/Brussels';
const MAX_PILOTS = 50;
const HISTORY_DAYS = 7;

/** Compteur de la sauvegarde suivi par chaque type (missionCatalog.TYPES[type].stat). */
const COUNTERS = {
  break_blocks: d => d?.stats?.blocksDestroyed,
  earn_coins:   d => d?.stats?.totalCoinsEarned,
  open_chests:  d => d?.stats?.chestsFound,
  buy_upgrades: d => d?.stats?.totalUpgradesBought,
  find_gems:    d => d?.stats?.gemsFound,
  depth_gain:   d => d?.depth,
};
/** Types dont le gain est comparé aux blocs validés par le serveur (observation, #38). */
const BLOCK_BOUND = new Set(['break_blocks', 'depth_gain']);

class MissionError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

const conn = () => db.getDb();

/** Tables en ajout seul. Idempotent. Aucune table existante modifiée. */
function init() {
  conn().exec(`
    CREATE TABLE IF NOT EXISTS mission_live_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS mission_live_audit (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      action     TEXT NOT NULL,
      details    TEXT
    );
    CREATE TRIGGER IF NOT EXISTS trg_mission_live_audit_no_update BEFORE UPDATE ON mission_live_audit
      BEGIN SELECT RAISE(ABORT, 'mission_live_audit est en ajout seul (#68)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_mission_live_audit_no_delete BEFORE DELETE ON mission_live_audit
      BEGIN SELECT RAISE(ABORT, 'mission_live_audit est en ajout seul (#68)'); END;
    CREATE TABLE IF NOT EXISTS daily_mission_days (
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day             TEXT    NOT NULL,
      catalog_version INTEGER NOT NULL,
      missions        TEXT    NOT NULL,
      counters        TEXT    NOT NULL,
      profile         TEXT    NOT NULL,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, day)
    );
    CREATE TABLE IF NOT EXISTS daily_mission_claims (
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day         TEXT    NOT NULL,
      slot        INTEGER NOT NULL,
      mission_id  TEXT    NOT NULL,
      target      INTEGER NOT NULL,
      coins       INTEGER NOT NULL,
      gems        INTEGER NOT NULL,
      progress    INTEGER NOT NULL,
      revision    INTEGER,
      details     TEXT,
      claimed_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, day, slot)
    );
    CREATE TRIGGER IF NOT EXISTS trg_daily_mission_claims_no_update BEFORE UPDATE ON daily_mission_claims
      BEGIN SELECT RAISE(ABORT, 'daily_mission_claims est en ajout seul (#68)'); END;
  `);
  _cache = null;
}

// ── Réglages ──────────────────────────────────────────────────────────────────

let _cache = null;
function getSettings() {
  if (!_cache) {
    const rows = Object.fromEntries(conn().prepare('SELECT key, value FROM mission_live_settings').all().map(r => [r.key, r.value]));
    let pilots = [];
    try { pilots = JSON.parse(rows.pilots ?? '[]'); } catch (_) { pilots = []; }
    _cache = { mode: MODES.includes(rows.mode) ? rows.mode : 'off', pilots: Array.isArray(pilots) ? pilots.filter(Number.isSafeInteger) : [] };
  }
  return _cache;
}

function getMode() { return getSettings().mode; }

/** Le jeu de CE joueur lit-il les missions du serveur ? */
function isLiveFor(userId) {
  const s = getSettings();
  if (s.mode === 'on') return !!userId;
  if (s.mode === 'pilot') return s.pilots.includes(Number(userId));
  return false;
}

function _audit(action, details) {
  conn().prepare('INSERT INTO mission_live_audit (action, details) VALUES (?, ?)').run(action, details == null ? null : JSON.stringify(details));
}

/**
 * Change le mode et/ou la liste des comptes pilotes (noms d'utilisateur). Journalisé.
 * `on` exige une note (décision du propriétaire), comme tout changement visible des joueurs.
 */
function setSettings({ mode, pilots, note = '' } = {}) {
  const cur = getSettings();
  const next = { mode: mode ?? cur.mode, pilots: cur.pilots };
  if (!MODES.includes(next.mode)) throw new MissionError(400, 'Mode inconnu (off, pilot ou on).', 'bad_mode');
  const text = String(note ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (next.mode === 'on' && cur.mode !== 'on' && text.length < 3) {
    throw new MissionError(400, 'Activation pour tous : note obligatoire (décision du propriétaire, #68).', 'note_required');
  }
  let names = null;
  if (pilots !== undefined) {
    if (!Array.isArray(pilots) || pilots.length > MAX_PILOTS) throw new MissionError(400, `Comptes pilotes : liste de ${MAX_PILOTS} noms au plus.`, 'bad_pilots');
    const ids = [];
    names = [];
    for (const raw of pilots) {
      // Pseudo exact (ancien format) ou { id } choisi dans la liste de suggestions (#68-E)
      let u;
      if (raw && typeof raw === 'object') {
        const id = Number(raw.id);
        u = Number.isSafeInteger(id) && id > 0 ? db.getUserById(id) : null;
        if (!u) throw new MissionError(400, `Compte pilote introuvable (ID ${String(raw.id ?? '?').slice(0, 12)}).`, 'unknown_user');
      } else {
        const name = String(raw ?? '').trim().toLowerCase();
        if (!name) continue;
        u = db.getUserByUsername(name);
        if (!u) throw new MissionError(400, `Compte pilote inconnu : « ${name.slice(0, 40)} ».`, 'unknown_user');
      }
      if (!ids.includes(u.id)) { ids.push(u.id); names.push(u.username); }
    }
    next.pilots = ids;
  }
  db.runTransaction(() => {
    const put = conn().prepare(`INSERT INTO mission_live_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);
    put.run('mode', next.mode);
    put.run('pilots', JSON.stringify(next.pilots));
    _audit('settings', { from: cur.mode, to: next.mode, pilots: names ?? undefined, note: text || undefined });
  });
  _cache = null;
  return adminSettings();
}

function adminSettings() {
  const s = getSettings();
  const accounts = s.pilots.map(id => ({ id, username: db.getUserById(id)?.username })).filter(a => a.username);
  return { mode: s.mode, pilots: accounts.map(a => a.username), pilotAccounts: accounts, modes: MODES, timezone: TZ, today: today() };
}

function listAudit(limit = 50) {
  return conn().prepare('SELECT id, created_at AS createdAt, action, details FROM mission_live_audit ORDER BY id DESC LIMIT ?')
    .all(limit).map(r => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));
}

// ── Journée, profil, compteurs ────────────────────────────────────────────────

function today(nowMs = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs));
}

const _nat = v => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** Valeur de chaque compteur suivi + blocs validés par le serveur (#38), depuis la sauvegarde serveur. */
function _readCounters(userId, data) {
  const out = {};
  for (const [type, get] of Object.entries(COUNTERS)) out[type] = _nat(Number(get(data)));
  let validated = 0;
  try { validated = conn().prepare("SELECT value FROM badge_player_stats WHERE user_id = ? AND stat = 'blocks_total'").get(userId)?.value ?? 0; }
  catch (_) { validated = 0; }
  out._validated = _nat(validated);
  return out;
}

/** Profil de la rotation adaptative tiré de la sauvegarde serveur et de l'ancienneté du compte. */
function _profile(userId, data, nowMs) {
  const u = data?.upgrades ?? {};
  const user = db.getUserById(userId);
  const created = user?.created_at ? Date.parse(`${String(user.created_at).replace(' ', 'T')}Z`) : NaN;
  const accountDays = Number.isFinite(created) ? Math.max(0, Math.floor((nowMs - created) / 86_400_000)) : 0;
  return {
    depth: Math.max(1, _nat(Number(data?.depth)) || 1),
    accountDays: Math.min(accountDays, 3650),
    upgrades: { pickaxe: _nat(Number(data?.pickaxeLevel)) || 1, luck: _nat(Number(u.luck)), bag: _nat(Number(u.bag)),
      autodig: _nat(Number(u.autodig)), fragment_shop: _nat(Number(u.fragment_shop)) },
  };
}

function _saveData(userId) {
  const row = db.getUserSave(userId);
  if (!row) return { row: null, data: null };
  try { return { row, data: JSON.parse(row.data) }; } catch (_) { return { row, data: null }; }
}

function _dayRow(userId, day) {
  const r = conn().prepare('SELECT * FROM daily_mission_days WHERE user_id = ? AND day = ?').get(userId, day);
  if (!r) return null;
  return { ...r, missions: JSON.parse(r.missions), counters: JSON.parse(r.counters), profile: JSON.parse(r.profile) };
}

/** Historique anti-répétition : identifiants des missions des jours précédents (J-1 en premier). */
function _history(userId, day) {
  return conn().prepare('SELECT missions FROM daily_mission_days WHERE user_id = ? AND day < ? ORDER BY day DESC LIMIT ?')
    .all(userId, day, HISTORY_DAYS).map(r => JSON.parse(r.missions).map(m => m.id));
}

/**
 * Missions du jour du joueur : relues si déjà attribuées, sinon tirées et enregistrées (une seule
 * fois : INSERT OR IGNORE sur joueur + jour). Sans sauvegarde serveur : rien (le joueur n'a pas joué).
 */
function ensureDay(userId, { nowMs = Date.now() } = {}) {
  const day = today(nowMs);
  const existing = _dayRow(userId, day);
  if (existing) return existing;
  const { data } = _saveData(userId);
  if (!data) return null;
  const catalog = missionCatalog.getPublished();
  const profile = _profile(userId, data, nowMs);
  const plan = missionCatalog.planDay(catalog, { date: day, profile, playerKey: String(userId), history: _history(userId, day) });
  const missions = plan.missions.map((m, slot) => ({ slot, id: m.id, type: m.type, target: m.target, reward: m.reward }));
  const raw = _readCounters(userId, data);
  // Compteurs : `last` = dernière valeur vue, `gained` = progression cumulée du jour (jamais en baisse)
  const counters = {};
  for (const k of Object.keys(raw)) counters[k] = { last: raw[k], gained: 0 };
  conn().prepare(`INSERT OR IGNORE INTO daily_mission_days (user_id, day, catalog_version, missions, counters, profile)
      VALUES (?, ?, ?, ?, ?, ?)`)
    .run(userId, day, catalog.version, JSON.stringify(missions), JSON.stringify(counters), JSON.stringify(profile));
  return _dayRow(userId, day);
}

/** Cumule la progression du jour depuis la sauvegarde serveur (hausse ajoutée, baisse ignorée). */
function _accumulate(userId, dayRow, data) {
  const raw = _readCounters(userId, data);
  const counters = { ...dayRow.counters };
  let changed = false;
  for (const [k, v] of Object.entries(raw)) {
    const c = counters[k] ?? { last: v, gained: 0 };
    const next = { last: v, gained: c.gained + Math.max(0, v - c.last) };
    if (next.last !== c.last || next.gained !== c.gained || !counters[k]) changed = true;
    counters[k] = next;
  }
  if (changed) {
    conn().prepare("UPDATE daily_mission_days SET counters = ?, updated_at = datetime('now') WHERE user_id = ? AND day = ?")
      .run(JSON.stringify(counters), userId, dayRow.day);
  }
  return { ...dayRow, counters };
}

/** À chaque sauvegarde acceptée (POST /api/me/save) : progression du jour mise à jour. Sans effet si OFF. */
function observeSave(userId, data, { nowMs = Date.now() } = {}) {
  if (!isLiveFor(userId)) return null;
  return db.runTransaction(() => {
    const row = ensureDay(userId, { nowMs });
    return row ? _accumulate(userId, row, data) : null;
  });
}

// ── Paiement unique quel que soit le moteur (#83) ─────────────────────────────

const _isDay = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

/** Identifiants de missions payées par le serveur, par jour : { 'YYYY-MM-DD': ['earn_coins', …] }. */
function paidByServer(userId, days) {
  const out = {};
  const q = conn().prepare('SELECT mission_id FROM daily_mission_claims WHERE user_id = ? AND day = ? ORDER BY slot');
  for (const day of new Set(days.filter(_isDay))) {
    const ids = q.all(userId, day).map(r => r.mission_id);
    if (ids.length) out[day] = [...new Set(ids)];
  }
  return out;
}

/** Missions réclamées (et créditées) par le navigateur pour `day` dans une sauvegarde. */
function browserClaimed(data, day) {
  const dm = data?.dailyMissions;
  if (!dm || dm.date !== day || !Array.isArray(dm.missions)) return new Set();
  return new Set(dm.missions.filter(m => m && m.claimed === true && m.serverPaid !== true).map(m => String(m.id)));
}

/**
 * Marque « réclamées par le serveur » les missions du navigateur déjà payées par le serveur le
 * même jour (sauvegarde RENVOYÉE au client ; jamais écrite ici). Retourne le nombre de missions marquées.
 */
function mergeInto(userId, data) {
  const dm = data?.dailyMissions;
  if (!dm || !_isDay(dm.date) || !Array.isArray(dm.missions)) return 0;
  const paid = new Set(paidByServer(userId, [dm.date])[dm.date] ?? []);
  let marked = 0;
  for (const m of dm.missions) {
    // Déjà réclamée par le navigateur : laissée telle quelle (elle reste une réclamation navigateur)
    if (m && paid.has(String(m.id)) && m.claimed !== true) { m.claimed = true; m.serverPaid = true; marked++; }
  }
  return marked;
}

/**
 * Frontière serveur (POST /api/me/save, dans la transaction d'écriture) : refuse une sauvegarde qui
 * fait passer à « réclamée par le navigateur » une mission déjà payée par le serveur le même jour
 * (ancien client, retour en mode OFF, autre appareil). `prevData` = sauvegarde serveur actuelle.
 * @returns {null | { day, missions: string[] }}  null = sauvegarde acceptée
 */
function guardSave(userId, prevData, nextData) {
  const dm = nextData?.dailyMissions;
  if (!dm || !_isDay(dm.date) || !Array.isArray(dm.missions)) return null;
  const claimedNow = browserClaimed(nextData, dm.date);
  if (!claimedNow.size) return null;
  const paid = paidByServer(userId, [dm.date])[dm.date];
  if (!paid) return null;
  const before = browserClaimed(prevData, dm.date);
  const doubled = paid.filter(id => claimedNow.has(id) && !before.has(id));
  return doubled.length ? { day: dm.date, missions: doubled } : null;
}

function _progress(dayRow, m) {
  return Math.min(m.target, dayRow.counters[m.type]?.gained ?? 0);
}

function _claims(userId, day) {
  return new Map(conn().prepare('SELECT * FROM daily_mission_claims WHERE user_id = ? AND day = ?').all(userId, day).map(c => [c.slot, c]));
}

/**
 * Vue joueur : missions du jour, progression serveur, état réclamé, textes et visuel du catalogue.
 * `base` = compteurs à la dernière sauvegarde serveur : le navigateur affiche `progress` + ce qu'il a
 * gagné depuis (compteur local − base), sans jamais pouvoir réclamer sur cette estimation.
 */
function playerView(userId, { nowMs = Date.now() } = {}) {
  if (!isLiveFor(userId)) {
    // Missions du navigateur : celles déjà payées par le serveur (aujourd'hui, hier) restent « réclamées » (#83)
    const paid = paidByServer(userId, [today(nowMs), today(nowMs - 86_400_000)]);
    return Object.keys(paid).length ? { live: false, paid } : { live: false };
  }
  const row = db.runTransaction(() => ensureDay(userId, { nowMs }));
  if (!row) return { live: true, pilot: getMode() === 'pilot', day: today(nowMs), missions: [] };
  const claims = _claims(userId, row.day);
  // Réclamées plus tôt aujourd'hui par le navigateur (mode OFF) : déjà payées, jamais reproposées (#83)
  const byBrowser = browserClaimed(_saveData(userId).data, row.day);
  const version = missionCatalog.getVersion(row.catalog_version) ?? missionCatalog.getPublished();
  const defs = new Map((version.missions ?? []).map(m => [m.id, m]));
  return {
    live: true,
    // Mode pilote : le jeu peut afficher un repère discret « mode test » (seuls les comptes listés reçoivent live:true)
    pilot: getMode() === 'pilot',
    day: row.day,
    catalogVersion: row.catalog_version,
    missions: row.missions.map(m => {
      const def = defs.get(m.id) ?? {};
      const c = claims.get(m.slot);
      const done = !!c || byBrowser.has(m.id);
      return {
        slot: m.slot, id: m.id, type: m.type, target: m.target, reward: c ? { coins: c.coins, gems: c.gems } : m.reward,
        progress: done ? m.target : _progress(row, m), base: row.counters[m.type]?.last ?? 0, claimed: done,
        ...(!c && done ? { claimedBy: 'browser' } : {}),
        icon: def.icon ?? '🎯', image: def.image ?? null, names: def.names ?? {}, descs: def.descs ?? {},
      };
    }),
  };
}

/**
 * Réclamation d'une mission du jour. À appeler dans la route, qui fournit `mayWrite` (contrôleur de
 * partie #35) et `writeSave` (upsertUserSave). Tout se fait dans UNE transaction.
 * @returns {{ replayed, reward, coins, gems, revision, slot }}
 */
function claim(userId, { slot, day = null, mayWrite = () => true, nowMs = Date.now() } = {}) {
  if (!isLiveFor(userId)) throw new MissionError(409, 'Missions du serveur désactivées.', 'not_live');
  if (!Number.isInteger(slot) || slot < 0 || slot > 9) throw new MissionError(400, 'Mission inconnue.', 'bad_slot');
  const current = today(nowMs);
  if (day != null && day !== current) throw new MissionError(409, 'Journée terminée : les missions ont changé.', 'day_over');
  return db.runTransaction(() => {
    if (!mayWrite()) throw new MissionError(409, 'Partie ouverte sur un autre appareil.', 'not_controller');
    const { row: saveRow, data } = _saveData(userId);
    if (!saveRow || !data) throw new MissionError(404, 'Sauvegarde introuvable.', 'no_save');
    let dayRow = ensureDay(userId, { nowMs });
    const m = dayRow.missions.find(x => x.slot === slot);
    if (!m) throw new MissionError(400, 'Mission inconnue.', 'bad_slot');
    const prev = conn().prepare('SELECT * FROM daily_mission_claims WHERE user_id = ? AND day = ? AND slot = ?').get(userId, current, slot);
    if (prev) {
      return { replayed: true, slot, reward: { coins: prev.coins, gems: prev.gems }, coins: data.coins, gems: data.gems, revision: saveRow.version };
    }
    // Déjà réclamée aujourd'hui par le navigateur (avant le passage en mode serveur) : pas de second paiement (#83)
    if (browserClaimed(data, current).has(m.id)) throw new MissionError(409, 'Mission déjà réclamée aujourd\'hui.', 'already_claimed');
    dayRow = _accumulate(userId, dayRow, data);
    const progress = _progress(dayRow, m);
    if (progress < m.target) throw new MissionError(409, 'Mission pas encore terminée.', 'not_done');

    // Observation anti-fraude (#38) : gain déclaré de blocs/mètres au-delà des blocs validés ; jamais bloquant
    const details = {};
    if (BLOCK_BOUND.has(m.type)) {
      const validated = dayRow.counters._validated?.gained ?? 0;
      if (dayRow.counters[m.type].gained > validated) details.overValidated = { declared: dayRow.counters[m.type].gained, validated };
    }
    const reward = { coins: _nat(m.reward?.coins), gems: _nat(m.reward?.gems) };
    data.coins = _nat(Number(data.coins)) + reward.coins;
    data.gems = _nat(Number(data.gems)) + reward.gems;
    // Mémo dans la sauvegarde (affichage hors ligne, anciens écrans) ; la table des réclamations fait foi
    const dm = data.dailyMissions && typeof data.dailyMissions === 'object' ? data.dailyMissions : {};
    data.dailyMissions = { ...dm, server: { day: current, claimed: [...new Set([...(dm.server?.day === current ? dm.server.claimed ?? [] : []), slot])] } };
    // Même mission côté navigateur marquée payée par le serveur : un retour en mode OFF ne la repropose pas (#83)
    if (dm.date === current && Array.isArray(dm.missions)) {
      data.dailyMissions.missions = dm.missions.map(x => (x && String(x.id) === m.id && x.claimed !== true ? { ...x, claimed: true, serverPaid: true } : x));
    }
    const { version } = db.upsertUserSave(userId, JSON.stringify(data));
    conn().prepare(`INSERT INTO daily_mission_claims (user_id, day, slot, mission_id, target, coins, gems, progress, revision, details)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(userId, current, slot, m.id, m.target, reward.coins, reward.gems, progress, version, Object.keys(details).length ? JSON.stringify(details) : null);
    db.logUserEvent(userId, 'daily_mission_claim', { day: current, slot, missionId: m.id, target: m.target, ...reward });
    return { replayed: false, slot, reward, coins: data.coins, gems: data.gems, revision: version };
  });
}

/**
 * Source des missions d'un compte (#68-E) : serveur ou navigateur, et pourquoi.
 * `reason` : on (tous les joueurs), pilot (compte listé), off (drapeau désactivé), not_pilot (pilote, compte non listé).
 */
function sourceFor(userId) {
  const s = getSettings();
  const live = isLiveFor(userId);
  const reason = s.mode === 'on' ? 'on' : s.mode === 'pilot' ? (live ? 'pilot' : 'not_pilot') : 'off';
  return { source: live ? 'server' : 'browser', reason, mode: s.mode };
}

/**
 * Vue admin d'un joueur (lecture seule) : source des missions, attribution du jour, progression,
 * réclamations. Par ID stable (choisi dans les suggestions) ou par pseudo exact. Ne crée aucune attribution.
 */
function inspectPlayer(query, { nowMs = Date.now() } = {}) {
  const q = query && typeof query === 'object' ? query : { username: query };
  let u = null;
  if (q.userId != null && String(q.userId).trim() !== '') {
    const id = Number(q.userId);
    u = Number.isSafeInteger(id) && id > 0 ? db.getUserById(id) : null;
  } else {
    const name = String(q.username ?? '').trim().toLowerCase();
    if (!name) throw new MissionError(400, 'Choisissez un joueur.', 'no_user');
    u = db.getUserByUsername(name);
  }
  if (!u) throw new MissionError(404, 'Compte inexistant : aucun joueur ne porte ce pseudo. Tapez 2 lettres et choisissez-le dans la liste.', 'unknown_user');
  const day = today(nowMs);
  const row = _dayRow(u.id, day);
  const claims = row ? _claims(u.id, day) : new Map();
  const meta = conn().prepare('SELECT created_at AS createdAt, updated_at AS updatedAt FROM daily_mission_days WHERE user_id = ? AND day = ?').get(u.id, day) ?? null;
  const version = row ? (missionCatalog.getVersion(row.catalog_version) ?? null) : null;
  const defs = new Map((version?.missions ?? []).map(m => [m.id, m]));
  // Historique : identifiants techniques conservés (« id:objectif »), plus les noms du catalogue de la version du jour (#68-F)
  const nameIn = (v, id) => missionCatalog.getVersion(v)?.missions?.find(m => m.id === id)?.names?.fr ?? null;
  const days = conn().prepare('SELECT day, catalog_version AS catalogVersion, missions FROM daily_mission_days WHERE user_id = ? ORDER BY day DESC LIMIT 7')
    .all(u.id).map(r => {
      const list = JSON.parse(r.missions);
      return { ...r, missions: list.map(m => `${m.id}:${m.target}`), items: list.map(m => ({ id: m.id, target: m.target, name: nameIn(r.catalogVersion, m.id) })) };
    });
  const src = sourceFor(u.id);
  return {
    id: u.id, username: u.username, live: src.source === 'server', ...src, day, timezone: TZ,
    today: row ? {
      catalogVersion: row.catalog_version, profile: row.profile,
      assignedAt: meta?.createdAt ?? null, updatedAt: meta?.updatedAt ?? null,
      missions: row.missions.map(m => {
        const c = claims.get(m.slot);
        const def = defs.get(m.id);
        // Nom et objectif tels que le joueur les lit (textes FR du catalogue de la version attribuée), icône du catalogue (#68-F)
        return { ...m, name: def?.names?.fr ?? null, text: def?.descs?.fr ? def.descs.fr.replace(/\{t\}/g, m.target).replace(/\{s\}/g, m.target > 1 ? 's' : '') : null,
          icon: def?.icon ?? '🎯', image: def?.image ?? null, progress: c ? m.target : _progress(row, m), claimed: !!c,
          claimedAt: c?.claimed_at ?? null, claimReward: c ? { coins: c.coins, gems: c.gems } : null,
          claimDetails: c?.details ? JSON.parse(c.details) : null };
      }),
    } : null,
    history: days,
  };
}

module.exports = { MissionError, MODES, TZ, init, getSettings, getMode, isLiveFor, setSettings, adminSettings, listAudit,
  today, ensureDay, observeSave, playerView, claim, sourceFor, inspectPlayer, paidByServer, browserClaimed, mergeInto, guardSave };
