/**
 * server/badges.js — Badges et succès honorifiques (#38).
 *
 * Purement honorifiques : aucun badge ne donne de pièces, gemmes, fragments, reliques, points de
 * récompense ni place au classement. Ce module n'écrit dans aucune table économique.
 *
 * Statistiques fiables (aucun compteur déclaré par le client n'est cru tel quel) :
 *   - `max_depth`      : profondeur RETENUE par le serveur (player_depth_tracking.accepted_depth,
 *                        validée par #9 et bornée par le budget de dégâts #25) ;
 *   - `blocks:<id>`    : blocs d'un type minés. Le client déclare des compteurs cumulés
 *                        (`stats.minedByType`) ; le serveur ne crédite que l'écart depuis la dernière
 *                        valeur vue, borné par les mètres nouvellement retenus (un bloc détruit = un
 *                        mètre), seulement pour un type publié du catalogue (#37) dont la profondeur
 *                        d'apparition est atteinte. Le surplus reste en attente (jamais crédité
 *                        sans mètre validé) ;
 *   - `blocks_total`   : somme des blocs crédités ; `chests_opened` : blocs crédités de catégorie
 *                        « coffre » ; `distinct_types` : types crédités au moins une fois ;
 *   - `play_days`      : jours distincts (Europe/Brussels) avec au moins un bloc crédité.
 * Tout démarre à l'activation de #38 : aucune statistique ni badge rétroactif.
 *
 * Attribution : une seule fois par joueur et par badge (clé primaire, INSERT OR IGNORE), dans la
 * même transaction que la mise à jour des statistiques. Un badge archivé ou désactivé reste dans la
 * collection de ceux qui l'ont obtenu. Badge d'événement (dates de début/fin) : attribuable
 * seulement pendant la période ; ses compteurs partent de la valeur du joueur au début de sa
 * participation (aucun crédit de ce qui a été fait avant l'événement).
 */

'use strict';

const db           = require('./db');
const blockCatalog = require('./blockCatalog');

const CONDITIONS = ['max_depth', 'blocks_total', 'blocks_of_type', 'distinct_types', 'chests_opened', 'play_days'];
const STATUSES   = ['active', 'inactive', 'archived'];
const VISIBILITY = ['visible', 'hidden'];
const CATEGORIES = ['profondeur', 'minage', 'exploration', 'coffres', 'fidelite', 'evenement'];
const LANGS      = ['fr', 'en', 'nl', 'es'];
const MAX_BADGES = 300;
const MAX_TYPES_PER_SAVE = 200;
const MAX_THRESHOLD = 1e9;
const TZ = 'Europe/Brussels';

const ID_RE    = /^[a-z][a-z0-9_]{1,39}$/;
const IMAGE_RE = /^(\/assets\/[A-Za-z0-9_\-/.]+\.(webp|png|svg)|\/media\/(blocks|icons)\/[a-f0-9]{16}\.webp|\/api\/collections\/images\/[0-9a-f]{64}\.(png|jpg|webp))$/;
const DATE_RE  = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?Z$/;

class BadgeError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

const conn = () => db.getDb();

// ── Première série (proposée) ─────────────────────────────────────────────────
// Seuls les deux exemples demandés par le propriétaire sont actifs ; les autres paliers sont des
// brouillons désactivés, à activer depuis le panel après validation (aucun barème imposé).

const SEED = [
  { id: 'profondeur_100', status: 'active', category: 'profondeur', icon: '🕳️', condition: 'max_depth', threshold: 100,
    names: { fr: 'Cent mètres sous terre', en: 'A hundred metres down', nl: 'Honderd meter diep', es: 'Cien metros bajo tierra' },
    descriptions: { fr: 'Atteindre 100 m de profondeur.', en: 'Reach a depth of 100 m.', nl: 'Bereik een diepte van 100 m.', es: 'Alcanza 100 m de profundidad.' } },
  { id: 'pierre_100', status: 'active', category: 'minage', icon: '🪨', condition: 'blocks_of_type', blockId: 'pierre', threshold: 100,
    names: { fr: 'Tailleur de pierre', en: 'Stonecutter', nl: 'Steenhouwer', es: 'Cantero' },
    descriptions: { fr: 'Miner 100 blocs de pierre.', en: 'Mine 100 stone blocks.', nl: 'Hak 100 stenen blokken.', es: 'Pica 100 bloques de piedra.' } },
  { id: 'profondeur_500', status: 'inactive', category: 'profondeur', icon: '⛰️', condition: 'max_depth', threshold: 500,
    names: { fr: 'Cinq cents mètres', en: 'Five hundred metres', nl: 'Vijfhonderd meter', es: 'Quinientos metros' },
    descriptions: { fr: 'Atteindre 500 m de profondeur.', en: 'Reach a depth of 500 m.', nl: 'Bereik een diepte van 500 m.', es: 'Alcanza 500 m de profundidad.' } },
  { id: 'profondeur_1000', status: 'inactive', category: 'profondeur', icon: '🌋', condition: 'max_depth', threshold: 1000,
    names: { fr: 'Le kilomètre', en: 'The kilometre', nl: 'De kilometer', es: 'El kilómetro' },
    descriptions: { fr: 'Atteindre 1 000 m de profondeur.', en: 'Reach a depth of 1,000 m.', nl: 'Bereik een diepte van 1.000 m.', es: 'Alcanza 1000 m de profundidad.' } },
  { id: 'blocs_1000', status: 'inactive', category: 'minage', icon: '⛏️', condition: 'blocks_total', threshold: 1000,
    names: { fr: 'Mille coups de pioche', en: 'A thousand swings', nl: 'Duizend houwen', es: 'Mil golpes de pico' },
    descriptions: { fr: 'Miner 1 000 blocs.', en: 'Mine 1,000 blocks.', nl: 'Hak 1.000 blokken.', es: 'Pica 1000 bloques.' } },
  { id: 'explorateur_10', status: 'inactive', category: 'exploration', icon: '🧭', condition: 'distinct_types', threshold: 10,
    names: { fr: 'Explorateur', en: 'Explorer', nl: 'Ontdekkingsreiziger', es: 'Explorador' },
    descriptions: { fr: 'Miner 10 types de blocs différents.', en: 'Mine 10 different block types.', nl: 'Hak 10 verschillende soorten blokken.', es: 'Pica 10 tipos de bloques distintos.' } },
  { id: 'premier_coffre', status: 'inactive', category: 'coffres', icon: '🧰', condition: 'chests_opened', threshold: 1,
    names: { fr: 'Premier trésor', en: 'First treasure', nl: 'Eerste schat', es: 'Primer tesoro' },
    descriptions: { fr: 'Ouvrir un coffre en minant.', en: 'Open a chest while mining.', nl: 'Open een kist tijdens het hakken.', es: 'Abre un cofre mientras picas.' } },
  { id: 'fidele_7', status: 'inactive', category: 'fidelite', icon: '📆', condition: 'play_days', threshold: 7,
    names: { fr: 'Une semaine à la mine', en: 'A week in the mine', nl: 'Een week in de mijn', es: 'Una semana en la mina' },
    descriptions: { fr: 'Miner pendant 7 jours différents.', en: 'Mine on 7 different days.', nl: 'Hak op 7 verschillende dagen.', es: 'Pica durante 7 días distintos.' } },
];

// ── Schéma ────────────────────────────────────────────────────────────────────

/** Tables en ajout seul et première série (une seule fois). Idempotent. */
function init() {
  conn().exec(`
    CREATE TABLE IF NOT EXISTS badges (
      id           TEXT    PRIMARY KEY,
      status       TEXT    NOT NULL DEFAULT 'inactive',
      category     TEXT    NOT NULL,
      visibility   TEXT    NOT NULL DEFAULT 'visible',
      icon         TEXT    NOT NULL,
      image        TEXT,
      condition    TEXT    NOT NULL,
      block_id     TEXT,
      threshold    INTEGER NOT NULL,
      names        TEXT    NOT NULL,
      descriptions TEXT    NOT NULL,
      starts_at    TEXT,
      ends_at      TEXT,
      sort         INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS player_badges (
      user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      badge_id  TEXT    NOT NULL,
      earned_at TEXT    NOT NULL,
      value     INTEGER NOT NULL,
      PRIMARY KEY (user_id, badge_id)
    );
    CREATE INDEX IF NOT EXISTS idx_player_badges_badge ON player_badges (badge_id);
    CREATE TABLE IF NOT EXISTS badge_player_stats (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      stat    TEXT    NOT NULL,
      value   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, stat)
    );
    CREATE TABLE IF NOT EXISTS badge_tracking (
      user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      season_id  INTEGER,
      ref_depth  INTEGER NOT NULL DEFAULT 0,
      ref_counts TEXT    NOT NULL DEFAULT '{}',
      last_day   TEXT,
      updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS badge_event_baselines (
      user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      badge_id TEXT    NOT NULL,
      base     INTEGER NOT NULL,
      PRIMARY KEY (user_id, badge_id)
    );
    CREATE TABLE IF NOT EXISTS badge_audit (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      action     TEXT    NOT NULL,
      badge_id   TEXT,
      details    TEXT
    );
    CREATE TABLE IF NOT EXISTS badge_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  const seeded = conn().prepare("SELECT value FROM badge_meta WHERE key = 'seeded'").get();
  if (!seeded) {
    db.runTransaction(() => {
      SEED.forEach((b, i) => {
        if (!getBadgeRow(b.id)) _insert(normalizeBadge({ ...b, sort: (i + 1) * 10 }));
      });
      conn().prepare("INSERT INTO badge_meta (key, value) VALUES ('seeded', ?)").run(new Date().toISOString());
      conn().prepare("INSERT OR IGNORE INTO badge_meta (key, value) VALUES ('activated_at', ?)").run(new Date().toISOString());
      _audit('seed', null, { ids: SEED.map(b => b.id) });
    });
  }
}

function activatedAt() {
  return conn().prepare("SELECT value FROM badge_meta WHERE key = 'activated_at'").get()?.value ?? null;
}

function _audit(action, badgeId, details) {
  conn().prepare('INSERT INTO badge_audit (action, badge_id, details) VALUES (?, ?, ?)')
    .run(action, badgeId, details ? JSON.stringify(details) : null);
}

// ── Lecture / normalisation ───────────────────────────────────────────────────

function _row(r) {
  if (!r) return null;
  return {
    id: r.id, status: r.status, category: r.category, visibility: r.visibility, icon: r.icon, image: r.image ?? null,
    condition: r.condition, blockId: r.block_id ?? null, threshold: r.threshold,
    names: JSON.parse(r.names), descriptions: JSON.parse(r.descriptions),
    startsAt: r.starts_at ?? null, endsAt: r.ends_at ?? null, sort: r.sort,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function getBadgeRow(id) { return _row(conn().prepare('SELECT * FROM badges WHERE id = ?').get(id)); }
function listBadges() { return conn().prepare('SELECT * FROM badges ORDER BY sort, id').all().map(_row); }

function _str(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }

function _localized(input, max, label, errors) {
  const out = {};
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  for (const l of LANGS) { const s = _str(src[l], max); if (s) out[l] = s; }
  if (!out.fr) errors.push(`${label} : le français est obligatoire.`);
  return out;
}

function _date(v, label, errors) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !DATE_RE.test(v) || Number.isNaN(Date.parse(v))) {
    errors.push(`${label} : date ISO UTC attendue (ex. 2026-10-31T00:00:00Z).`);
    return null;
  }
  return new Date(v).toISOString();
}

/**
 * Valide et normalise un badge saisi. Lève BadgeError(400) avec la liste des erreurs.
 * `knownBlockIds` : types publiés au moins une fois (catalogue #37).
 */
function normalizeBadge(input, { knownBlockIds = _knownBlockIds() } = {}) {
  const errors = [];
  const b = input && typeof input === 'object' ? input : {};
  const id = _str(b.id, 40);
  if (!ID_RE.test(id)) errors.push('Identifiant : 2 à 40 caractères, minuscules, chiffres et « _ », commençant par une lettre.');
  const status = b.status ?? 'inactive';
  if (!STATUSES.includes(status)) errors.push('Statut inconnu.');
  if (!CATEGORIES.includes(b.category)) errors.push(`Catégorie : ${CATEGORIES.join(', ')}.`);
  const visibility = b.visibility ?? 'visible';
  if (!VISIBILITY.includes(visibility)) errors.push('Visibilité : visible ou hidden.');
  const icon = _str(b.icon, 16);
  if (!icon || /[<>"'&]/.test(icon)) errors.push('Icône : un emoji (16 caractères au plus).');
  const image = b.image ? _str(b.image, 200) : null;
  if (image && !IMAGE_RE.test(image)) errors.push('Image : chemin /assets/…, /media/blocks|icons/… ou /api/collections/images/… attendu.');
  if (!CONDITIONS.includes(b.condition)) errors.push(`Condition : ${CONDITIONS.join(', ')}.`);
  let blockId = null;
  if (b.condition === 'blocks_of_type') {
    blockId = _str(b.blockId, 40);
    if (!knownBlockIds.has(blockId)) errors.push('Type de bloc : identifiant stable du catalogue de blocs attendu.');
  }
  const threshold = Number(b.threshold);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > MAX_THRESHOLD) errors.push('Seuil : entier de 1 à 1 000 000 000.');
  const names = _localized(b.names, 60, 'Nom', errors);
  const descriptions = _localized(b.descriptions, 200, 'Description', errors);
  const startsAt = _date(b.startsAt, 'Début', errors);
  const endsAt   = _date(b.endsAt, 'Fin', errors);
  if (startsAt && endsAt && endsAt <= startsAt) errors.push('La fin doit être postérieure au début.');
  const sort = Number.isInteger(b.sort) ? Math.max(0, Math.min(1e6, b.sort)) : 0;
  if (errors.length) throw new BadgeError(400, 'Badge invalide.', errors);
  return { id, status, category: b.category, visibility, icon, image, condition: b.condition, blockId, threshold,
    names, descriptions, startsAt, endsAt, sort };
}

function _knownBlockIds() {
  const ids = blockCatalog.publishedIds();
  for (const t of blockCatalog.getPublished().types) ids.add(t.id);
  return ids;
}

function _insert(b) {
  conn().prepare(`INSERT INTO badges (id, status, category, visibility, icon, image, condition, block_id, threshold,
      names, descriptions, starts_at, ends_at, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(b.id, b.status, b.category, b.visibility, b.icon, b.image, b.condition, b.blockId, b.threshold,
      JSON.stringify(b.names), JSON.stringify(b.descriptions), b.startsAt, b.endsAt, b.sort);
}

// ── Administration ────────────────────────────────────────────────────────────

function createBadge(input) {
  const b = normalizeBadge(input);
  return db.runTransaction(() => {
    if (getBadgeRow(b.id)) throw new BadgeError(409, 'Un badge porte déjà cet identifiant.');
    if (conn().prepare('SELECT COUNT(*) AS n FROM badges').get().n >= MAX_BADGES) throw new BadgeError(400, 'Nombre maximal de badges atteint.');
    _insert(b);
    _audit('create', b.id, { after: b });
    return getBadgeRow(b.id);
  });
}

/** Modifie un badge (l'identifiant ne change jamais). Les badges déjà obtenus sont conservés. */
function updateBadge(id, input) {
  return db.runTransaction(() => {
    const before = getBadgeRow(id);
    if (!before) throw new BadgeError(404, 'Badge introuvable.');
    const b = normalizeBadge({ ...before, ...input, id, status: input?.status ?? before.status });
    conn().prepare(`UPDATE badges SET status = ?, category = ?, visibility = ?, icon = ?, image = ?, condition = ?,
        block_id = ?, threshold = ?, names = ?, descriptions = ?, starts_at = ?, ends_at = ?, sort = ?,
        updated_at = datetime('now') WHERE id = ?`)
      .run(b.status, b.category, b.visibility, b.icon, b.image, b.condition, b.blockId, b.threshold,
        JSON.stringify(b.names), JSON.stringify(b.descriptions), b.startsAt, b.endsAt, b.sort, id);
    // Changement de condition ou de période : les bases d'événement repartent de zéro
    if (before.condition !== b.condition || before.blockId !== b.blockId || before.startsAt !== b.startsAt) {
      conn().prepare('DELETE FROM badge_event_baselines WHERE badge_id = ?').run(id);
    }
    const { createdAt, updatedAt, ...prev } = before;
    _audit('update', id, { before: prev, after: b });
    return getBadgeRow(id);
  });
}

/** Active, désactive ou archive (jamais de suppression : les badges obtenus restent). */
function setStatus(id, status) {
  if (!STATUSES.includes(status)) throw new BadgeError(400, 'Statut inconnu.');
  return db.runTransaction(() => {
    const before = getBadgeRow(id);
    if (!before) throw new BadgeError(404, 'Badge introuvable.');
    conn().prepare("UPDATE badges SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
    _audit('status', id, { from: before.status, to: status });
    return getBadgeRow(id);
  });
}

function earnedCounts() {
  const out = {};
  for (const r of conn().prepare('SELECT badge_id, COUNT(*) AS n FROM player_badges GROUP BY badge_id').all()) out[r.badge_id] = r.n;
  return out;
}

function _statKey(b) {
  return b.condition === 'blocks_of_type' ? `blocks:${b.blockId}` : b.condition;
}

/**
 * Prévisualisation d'un badge saisi (sans l'enregistrer) : validation, nombre de joueurs qui
 * rempliraient déjà la condition avec les statistiques suivies, et répartition de la progression.
 */
function previewBadge(input) {
  const b = normalizeBadge({ ...input, id: input?.id || 'apercu' });
  const players = conn().prepare('SELECT COUNT(DISTINCT user_id) AS n FROM badge_tracking').get().n;
  let reached = 0, halfway = 0;
  if (b.condition === 'distinct_types') {
    const rows = conn().prepare("SELECT user_id, COUNT(*) AS n FROM badge_player_stats WHERE stat LIKE 'blocks:%' AND value > 0 GROUP BY user_id").all();
    for (const r of rows) { if (r.n >= b.threshold) reached++; else if (r.n * 2 >= b.threshold) halfway++; }
  } else {
    const rows = conn().prepare('SELECT value FROM badge_player_stats WHERE stat = ?').all(_statKey(b));
    for (const r of rows) { if (r.value >= b.threshold) reached++; else if (r.value * 2 >= b.threshold) halfway++; }
  }
  const windowed = !!(b.startsAt || b.endsAt);
  return {
    badge: b, playersTracked: players, wouldEarnNow: windowed ? 0 : reached, halfway,
    note: windowed
      ? "Badge d'événement : seule la progression réalisée pendant la période compte (aucun joueur ne l'obtient d'office)."
      : 'Joueurs remplissant déjà la condition : ils recevront le badge à leur prochaine sauvegarde si le badge est actif.',
  };
}

function listAudit({ limit = 100 } = {}) {
  const n = Math.max(1, Math.min(500, Number(limit) || 100));
  return conn().prepare('SELECT * FROM badge_audit ORDER BY id DESC LIMIT ?').all(n)
    .map(r => ({ id: r.id, createdAt: r.created_at, action: r.action, badgeId: r.badge_id, details: r.details ? JSON.parse(r.details) : null }));
}

function adminSummary() {
  const counts = earnedCounts();
  return {
    activatedAt: activatedAt(),
    conditions: CONDITIONS, categories: CATEGORIES, statuses: STATUSES, visibilities: VISIBILITY, langs: LANGS,
    blockTypes: blockCatalog.getPublished().types.map(t => ({ id: t.id, name: t.names?.fr ?? t.id, icon: t.icon, category: t.category })),
    playersTracked: conn().prepare('SELECT COUNT(*) AS n FROM badge_tracking').get().n,
    badges: listBadges().map(b => ({ ...b, earnedCount: counts[b.id] ?? 0 })),
  };
}

// ── Statistiques fiables et attribution ───────────────────────────────────────

function _getStats(userId) {
  const out = {};
  for (const r of conn().prepare('SELECT stat, value FROM badge_player_stats WHERE user_id = ?').all(userId)) out[r.stat] = r.value;
  return out;
}

function _statValue(stats, key) {
  if (key === 'distinct_types') return Object.keys(stats).filter(k => k.startsWith('blocks:') && stats[k] > 0).length;
  return stats[key] ?? 0;
}

function _dayInTz(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

/** Compteurs cumulés déclarés par le client : { id: entier ≥ 0 }, ids bien formés seulement. */
function sanitizeCounts(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (n >= MAX_TYPES_PER_SAVE) break;
    if (!ID_RE.test(k) || !Number.isSafeInteger(v) || v < 0) continue;
    out[k] = v; n++;
  }
  return out;
}

function _inWindow(b, nowIso) {
  return (!b.startsAt || nowIso >= b.startsAt) && (!b.endsAt || nowIso < b.endsAt);
}

/**
 * Traite une sauvegarde acceptée : crédite les statistiques fiables et attribue les badges.
 * Ne lève jamais vers l'appelant pour une donnée client invalide (ignorée).
 * @returns {Array<{id, icon, names}>} badges obtenus par cette sauvegarde
 */
function processSave(userId, data, { nowMs = Date.now() } = {}) {
  const season = db.getActiveSeason();
  const tracking = db.getDepthTracking(userId);
  return db.runTransaction(() => {
    const before = _getStats(userId);
    const after = { ...before };
    let t = conn().prepare('SELECT * FROM badge_tracking WHERE user_id = ?').get(userId);
    const reported = sanitizeCounts(data?.stats?.minedByType);
    if (!t) t = { user_id: userId, season_id: null, ref_depth: 0, ref_counts: '{}', last_day: null };
    const refCounts = JSON.parse(t.ref_counts || '{}');

    // Profondeur retenue par le serveur pour la saison active (jamais la valeur déclarée)
    const accepted = season && tracking && tracking.season_id === season.id ? tracking.accepted_depth : null;
    let seasonId = t.season_id, refDepth = t.ref_depth;
    if (accepted !== null && seasonId !== season.id) { seasonId = season.id; refDepth = 0; }

    // Compteur remis à zéro côté client (réinitialisation, autre appareil) : nouvelle référence
    for (const [id, v] of Object.entries(reported)) if ((refCounts[id] ?? 0) > v) refCounts[id] = v;

    let credited = 0;
    if (accepted !== null) {
      let budget = Math.max(0, accepted - refDepth);
      const types = new Map(blockCatalog.getPublished().types.map(x => [x.id, x]));
      const ids = Object.keys(reported).filter(id => reported[id] > (refCounts[id] ?? 0)).sort();
      for (const id of ids) {
        const type = types.get(id);
        if (!type || type.minDepth > accepted) continue;   // type inconnu ou hors de portée : jamais crédité
        const n = Math.min(reported[id] - (refCounts[id] ?? 0), budget);
        if (n <= 0) break;
        refCounts[id] = (refCounts[id] ?? 0) + n;
        budget -= n;
        credited += n;
        after[`blocks:${id}`] = (after[`blocks:${id}`] ?? 0) + n;
        if (type.category === 'coffre') after.chests_opened = (after.chests_opened ?? 0) + n;
      }
      refDepth += credited;
      if (accepted > (after.max_depth ?? 0)) after.max_depth = accepted;
    }
    let lastDay = t.last_day;
    if (credited > 0) {
      after.blocks_total = (after.blocks_total ?? 0) + credited;
      const day = _dayInTz(nowMs);
      if (day !== lastDay) { after.play_days = (after.play_days ?? 0) + 1; lastDay = day; }
    }

    conn().prepare(`INSERT INTO badge_tracking (user_id, season_id, ref_depth, ref_counts, last_day, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET season_id = excluded.season_id, ref_depth = excluded.ref_depth,
          ref_counts = excluded.ref_counts, last_day = excluded.last_day, updated_at = excluded.updated_at`)
      .run(userId, seasonId, refDepth, JSON.stringify(refCounts), lastDay);
    const upsert = conn().prepare(`INSERT INTO badge_player_stats (user_id, stat, value) VALUES (?, ?, ?)
        ON CONFLICT(user_id, stat) DO UPDATE SET value = excluded.value`);
    for (const [k, v] of Object.entries(after)) if (before[k] !== v) upsert.run(userId, k, v);

    return _award(userId, before, after, nowMs);
  });
}

function _award(userId, before, after, nowMs) {
  const nowIso = new Date(nowMs).toISOString();
  const owned = new Set(conn().prepare('SELECT badge_id FROM player_badges WHERE user_id = ?').all(userId).map(r => r.badge_id));
  const getBase = conn().prepare('SELECT base FROM badge_event_baselines WHERE user_id = ? AND badge_id = ?');
  const setBase = conn().prepare('INSERT OR IGNORE INTO badge_event_baselines (user_id, badge_id, base) VALUES (?, ?, ?)');
  const insert  = conn().prepare('INSERT OR IGNORE INTO player_badges (user_id, badge_id, earned_at, value) VALUES (?, ?, ?, ?)');
  const earned = [];
  for (const b of listBadges()) {
    if (b.status !== 'active' || owned.has(b.id) || !_inWindow(b, nowIso)) continue;
    const key = _statKey(b);
    let value = _statValue(after, key);
    if ((b.startsAt || b.endsAt) && b.condition !== 'max_depth') {
      // Événement : seule la progression faite pendant la période compte
      let base = getBase.get(userId, b.id)?.base;
      if (base === undefined) { base = _statValue(before, key); setBase.run(userId, b.id, base); }
      value -= base;
    }
    if (value >= b.threshold && insert.run(userId, b.id, nowIso, value).changes === 1) {
      earned.push({ id: b.id, icon: b.icon, image: b.image, names: b.names });
    }
  }
  return earned;
}

/** Vue joueur : badges visibles, obtenus ou non, avec progression chiffrée. */
function playerView(userId, { nowMs = Date.now() } = {}) {
  const nowIso = new Date(nowMs).toISOString();
  const stats = _getStats(userId);
  const owned = new Map(conn().prepare('SELECT * FROM player_badges WHERE user_id = ?').all(userId).map(r => [r.badge_id, r]));
  const bases = new Map(conn().prepare('SELECT badge_id, base FROM badge_event_baselines WHERE user_id = ?').all(userId).map(r => [r.badge_id, r.base]));
  const badges = [];
  for (const b of listBadges()) {
    const got = owned.get(b.id);
    const windowed = !!(b.startsAt || b.endsAt);
    const open = b.status === 'active' && _inWindow(b, nowIso);
    if (!got && !open) continue;   // désactivé, archivé, événement hors période : visible seulement si obtenu
    const hidden = !got && b.visibility === 'hidden';
    let value = _statValue(stats, _statKey(b));
    if (windowed && b.condition !== 'max_depth') value = bases.has(b.id) ? value - bases.get(b.id) : 0;
    badges.push({
      id: b.id, category: b.category, icon: hidden ? '❔' : b.icon, image: hidden ? null : b.image,
      names: hidden ? null : b.names, descriptions: hidden ? null : b.descriptions, hidden,
      earned: !!got, earnedAt: got?.earned_at ?? null,
      progress: got ? null : { value: Math.min(Math.max(0, value), b.threshold), target: b.threshold },
      event: windowed ? { startsAt: b.startsAt, endsAt: b.endsAt } : null,
      archived: b.status === 'archived',
    });
  }
  return { activatedAt: activatedAt(), earnedCount: owned.size, badges };
}

module.exports = {
  init, BadgeError, CONDITIONS, CATEGORIES, STATUSES, VISIBILITY, LANGS, SEED,
  normalizeBadge, listBadges, getBadgeRow, createBadge, updateBadge, setStatus, previewBadge, listAudit, adminSummary,
  sanitizeCounts, processSave, playerView, activatedAt,
};
