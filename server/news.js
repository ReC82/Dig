/**
 * server/news.js — Centre d'actualités Dig (#50, demande du propriétaire du 02/11/2026).
 *
 * Distinct de l'historique personnel des notifications (#26, local au navigateur) : ici, des
 * annonces publiques, les mêmes pour tous, servies par le serveur.
 *
 *   - Annonces (`news_items`) : titre, résumé, texte FR/EN/NL/ES, catégorie, icône, lien https
 *     facultatif, date d'événement facultative (« À venir » tant qu'elle est future), date de
 *     publication (programmation) et d'expiration. États : brouillon, publiée (programmée tant
 *     que la date de publication est future), archivée. Rien n'est jamais supprimé ; chaque action
 *     est inscrite au journal `news_log`.
 *   - Admin : création manuelle ou « Mise en forme avec l'IA » depuis un texte brut. La consigne IA
 *     interdit d'ajouter un fait absent du texte (date, chiffre, récompense…) et fait lister ce qui
 *     manque ; une annonce issue de l'IA est TOUJOURS enregistrée en brouillon, la publication est
 *     une action séparée de l'admin. Infrastructure IA de #37 (blockAi.guardedJson : clé côté
 *     serveur, un appel à la fois, quota, plafond, journal ; appel en arrière-plan).
 *   - Lu / non lu par compte : `news_reads.seen_at` (dernière ouverture du panneau). Invités : le jeu
 *     garde la même date dans le navigateur.
 *   - Annonces automatiques de saison (#48), réglage `news_auto_seasons` (activé) : saison suivante
 *     dès l'annonce J-1 du thème, début de saison, fin de saison (après le classement figé #29,
 *     chiffres agrégés uniquement, et seulement à partir de 3 classés). Clé `auto_key` unique : jamais de doublon, rejouable après un
 *     redémarrage. Seuls les événements des 48 dernières heures sont annoncés (pas de rattrapage
 *     de l'historique au déploiement).
 *   - Faits joueurs, réglage `news_player_events` (DÉSACTIVÉ par défaut) : profondeur validée par le
 *     serveur (paliers configurables, 200 m) et classement final (top N du classement figé, éligibles
 *     seulement). Uniquement pour les joueurs qui ont accepté d'être cités (opt-in `news_prefs`,
 *     retirable : leurs annonces disparaissent aussitôt), pseudonyme public seulement, joueur à
 *     risque anti-bot ≥ 2 jamais cité, plafond quotidien d'annonces joueurs.
 *   - Discord : le lien est celui de la configuration de la bêta (#57), jamais inventé.
 *
 * Aucune influence sur le jeu : une panne ici est tracée et ignorée par l'appelant.
 */

'use strict';

const db = require('./db');

const LANGS = ['fr', 'en', 'nl', 'es'];
const LANG_LABELS = { fr: 'French', en: 'English', nl: 'Dutch', es: 'Spanish' };
const CATEGORIES = ['news', 'season', 'event', 'update', 'maintenance', 'community', 'player'];
const STATUSES = ['draft', 'published', 'archived'];
const MAX = { title: 90, summary: 280, body: 2000, url: 300, label: 40, raw: 4000 };
const AUTO_WINDOW_MS = 48 * 3_600_000;
const PUBLIC_LIMIT = 30;
const END_MIN_RANKED = 3;   // fin de saison : chiffres agrégés seulement à partir de 3 classés
const URL_RE = /^https:\/\/[^\s<>"']{3,290}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?Z?$/;

const DEFAULTS = {
  news_auto_seasons: 'true', news_player_events: 'false',
  news_depth_milestones: '200', news_rank_top: '3', news_player_daily_max: '5',
};
const CONFIG_RULES = {
  news_auto_seasons:     ['true ou false attendu', v => v === 'true' || v === 'false'],
  news_player_events:    ['true ou false attendu', v => v === 'true' || v === 'false'],
  news_depth_milestones: ['liste de profondeurs en mètres séparées par des virgules (50 à 100000, 10 au plus), vide = aucune',
    v => v === '' || (v.split(',').length <= 10 && v.split(',').every(x => /^\d+$/.test(x.trim()) && +x >= 50 && +x <= 100000))],
  news_rank_top:         ['entier de 0 à 10 attendu (0 = aucun classement cité)', v => /^\d+$/.test(v) && +v <= 10],
  news_player_daily_max: ['entier de 0 à 50 attendu', v => /^\d+$/.test(v) && +v <= 50],
};

const INTERRUPTED = 'Mise en forme interrompue (serveur redémarré pendant l\'appel) : relancez-la.';

class NewsError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

let _initFor = null;
const conn = () => { const c = db.getDb(); if (_initFor !== c) { _initFor = c; init(c); } return c; };

function init(c = db.getDb()) {
  _initFor = c;
  c.exec(`
    CREATE TABLE IF NOT EXISTS news_items (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      status          TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
      source          TEXT    NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai', 'auto')),
      category        TEXT    NOT NULL DEFAULT 'news',
      icon            TEXT    NOT NULL DEFAULT '📰',
      titles          TEXT    NOT NULL,
      summaries       TEXT    NOT NULL DEFAULT '{}',
      bodies          TEXT    NOT NULL DEFAULT '{}',
      link_url        TEXT,
      link_labels     TEXT    NOT NULL DEFAULT '{}',
      event_at        TEXT,
      publish_at      TEXT,
      expires_at      TEXT,
      auto_key        TEXT    UNIQUE,
      subject_user_id INTEGER,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_news_public ON news_items (status, publish_at);
    CREATE TABLE IF NOT EXISTS news_log (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      news_id  INTEGER,
      action   TEXT    NOT NULL,
      details  TEXT,
      at       TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS news_reads (
      user_id  INTEGER PRIMARY KEY,
      seen_at  TEXT    NOT NULL
    );
    CREATE TABLE IF NOT EXISTS news_prefs (
      user_id         INTEGER PRIMARY KEY,
      public_mentions INTEGER NOT NULL DEFAULT 0,
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS news_ai_proposals (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_text    TEXT    NOT NULL,
      status      TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'open', 'error', 'used', 'discarded')),
      data        TEXT,
      error       TEXT,
      news_id     INTEGER,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

// ── Dates (UTC, format SQLite « YYYY-MM-DD HH:MM:SS ») ────────────────────────

const fmt = d => d.toISOString().slice(0, 19).replace('T', ' ');
function parse(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!DATE_RE.test(s)) return null;
  const d = new Date(s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? null : d;
}
const iso = v => { const d = parse(v); return d ? d.toISOString().replace('.000Z', 'Z') : null; };

// ── Réglages ──────────────────────────────────────────────────────────────────

function validateConfigValue(key, raw) {
  const rule = CONFIG_RULES[key];
  if (!rule) return null;
  const v = String(raw ?? '').trim();
  return rule[1](v) ? { value: v } : { error: `${key} : ${rule[0]}` };
}

function settings(config = db.getAdminConfig()) {
  const get = k => config[k] ?? DEFAULTS[k];
  return {
    autoSeasons: get('news_auto_seasons') === 'true',
    playerEvents: get('news_player_events') === 'true',
    depthMilestones: String(get('news_depth_milestones')).split(',').map(x => +x.trim()).filter(x => x >= 50).sort((a, b) => a - b),
    rankTop: +get('news_rank_top') || 0,
    playerDailyMax: +get('news_player_daily_max') || 0,
  };
}

function updateSettings(input = {}) {
  const map = { autoSeasons: 'news_auto_seasons', playerEvents: 'news_player_events', depthMilestones: 'news_depth_milestones',
    rankTop: 'news_rank_top', playerDailyMax: 'news_player_daily_max' };
  const out = [];
  for (const [k, key] of Object.entries(map)) {
    if (input[k] === undefined) continue;
    const raw = Array.isArray(input[k]) ? input[k].join(',') : String(input[k]);
    const r = validateConfigValue(key, raw);
    if (r.error) throw new NewsError(400, r.error);
    out.push([key, r.value]);
  }
  for (const [key, v] of out) db.setAdminConfig(key, v);
  if (out.length) _log(null, 'settings', Object.fromEntries(out));
  return settings();
}

// ── Normalisation ─────────────────────────────────────────────────────────────

const _clean = (v, max) => String(v ?? '').replace(/[<>\u0000-\u0008\u000b-\u001f]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
const _line = (v, max) => _clean(v, max).replace(/\s*\n\s*/g, ' ');

function _texts(t, max, multiline = false) {
  const out = {};
  for (const l of LANGS) out[l] = multiline ? _clean(t?.[l], max) : _line(t?.[l], max);
  return out;
}

function _emoji(v, d) {
  const e = String(v ?? '').trim();
  return e && [...e].length <= 4 && !/[<>&"'\s\w]/.test(e) ? e : d;
}

/** Champs d'une annonce (saisie admin ou proposition IA). Lève NewsError si invalide. */
function normalizeInput(input = {}, { partial = null } = {}) {
  const src = partial ? { ...partial, ...input } : input;
  const errors = [];
  const item = {
    category: CATEGORIES.includes(src.category) ? src.category : 'news',
    icon: _emoji(src.icon, '📰'),
    titles: _texts(src.titles, MAX.title),
    summaries: _texts(src.summaries, MAX.summary),
    bodies: _texts(src.bodies, MAX.body, true),
    linkUrl: _line(src.linkUrl, MAX.url) || null,
    linkLabels: _texts(src.linkLabels, MAX.label),
    eventAt: null, publishAt: null, expiresAt: null,
  };
  if (!item.titles.fr) errors.push('Titre français obligatoire.');
  if (item.linkUrl && !URL_RE.test(item.linkUrl)) errors.push('Lien invalide : adresse https://… complète attendue.');
  for (const k of ['eventAt', 'publishAt', 'expiresAt']) {
    const raw = src[k];
    if (raw === null || raw === undefined || raw === '') continue;
    const d = parse(raw);
    if (!d) errors.push(`Date ${k} invalide (UTC attendu, ex. 2026-11-05T18:00:00Z).`);
    else item[k] = fmt(d);
  }
  if (item.publishAt && item.expiresAt && item.expiresAt <= item.publishAt) errors.push('La date d\'expiration doit suivre la publication.');
  if (errors.length) throw new NewsError(400, errors[0], errors);
  return item;
}

function _warnings(item) {
  const w = [];
  const miss = LANGS.filter(l => l !== 'fr' && !item.titles[l]);
  if (miss.length) w.push(`Titre manquant en ${miss.join(', ').toUpperCase()} : le français sera affiché.`);
  if (!item.summaries.fr && !item.bodies.fr) w.push('Ni résumé ni texte : seul le titre sera affiché.');
  return w;
}

// ── Lignes ────────────────────────────────────────────────────────────────────

const J = (s, d = {}) => { try { return s ? JSON.parse(s) : d; } catch (_) { return d; } };

function _row(r) {
  if (!r) return null;
  return {
    id: r.id, status: r.status, source: r.source, category: r.category, icon: r.icon,
    titles: J(r.titles), summaries: J(r.summaries), bodies: J(r.bodies),
    linkUrl: r.link_url, linkLabels: J(r.link_labels),
    eventAt: iso(r.event_at), publishAt: iso(r.publish_at), expiresAt: iso(r.expires_at),
    autoKey: r.auto_key, subjectUserId: r.subject_user_id, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  };
}

function _log(newsId, action, details = null) {
  conn().prepare('INSERT INTO news_log (news_id, action, details) VALUES (?, ?, ?)')
    .run(newsId, action, details == null ? null : JSON.stringify(details).slice(0, 1000));
}

const getItem = id => _row(conn().prepare('SELECT * FROM news_items WHERE id = ?').get(id));

function _insert(item, { status = 'draft', source = 'manual', autoKey = null, subjectUserId = null }) {
  return conn().prepare(`INSERT INTO news_items (status, source, category, icon, titles, summaries, bodies, link_url, link_labels,
      event_at, publish_at, expires_at, auto_key, subject_user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(status, source, item.category, item.icon, JSON.stringify(item.titles), JSON.stringify(item.summaries),
      JSON.stringify(item.bodies), item.linkUrl, JSON.stringify(item.linkLabels), item.eventAt, item.publishAt,
      item.expiresAt, autoKey, subjectUserId).lastInsertRowid;
}

// ── Vue joueur ────────────────────────────────────────────────────────────────

/** Annonces visibles maintenant ; les faits joueurs dont l'auteur a retiré son accord sont exclus. */
function _visible(now) {
  const n = fmt(now);
  return conn().prepare(`SELECT i.* FROM news_items i
      LEFT JOIN news_prefs p ON p.user_id = i.subject_user_id
     WHERE i.status = 'published' AND i.publish_at IS NOT NULL AND i.publish_at <= ?
       AND (i.expires_at IS NULL OR i.expires_at > ?)
       AND (i.subject_user_id IS NULL OR p.public_mentions = 1)
     ORDER BY i.publish_at DESC, i.id DESC LIMIT 200`).all(n, n);
}

const _public = r => ({
  id: r.id, category: r.category, icon: r.icon, titles: J(r.titles), summaries: J(r.summaries), bodies: J(r.bodies),
  link: r.link_url ? { url: r.link_url, labels: J(r.link_labels) } : null,
  eventAt: iso(r.event_at), publishAt: iso(r.publish_at),
});

function _discordUrl() {
  try { return require('./beta').publicConfig().discordUrl || null; } catch (_) { return null; }
}

/** GET /api/news : « À venir » (date d'événement future) et « Dernières actualités ». */
function publicView(userId = null, now = new Date()) {
  const rows = _visible(now);
  const n = fmt(now);
  const upcoming = rows.filter(r => r.event_at && r.event_at > n).sort((a, b) => a.event_at.localeCompare(b.event_at)).map(_public);
  const latest = rows.filter(r => !(r.event_at && r.event_at > n)).slice(0, PUBLIC_LIMIT).map(_public);
  const out = { upcoming, latest, discordUrl: _discordUrl(), mentions: settings().playerEvents, serverTime: iso(n) };
  if (userId) {
    const seen = conn().prepare('SELECT seen_at FROM news_reads WHERE user_id = ?').get(userId)?.seen_at ?? null;
    out.seenAt = iso(seen);
    out.unread = rows.filter(r => !seen || r.publish_at > seen).length;
    out.prefs = getPrefs(userId);
  }
  return out;
}

/** Panneau ouvert : tout ce qui est publié jusqu'ici est lu (jamais de recul). */
function markSeen(userId, now = new Date()) {
  const v = fmt(now);
  conn().prepare(`INSERT INTO news_reads (user_id, seen_at) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET seen_at = MAX(seen_at, excluded.seen_at)`).run(userId, v);
  return { seenAt: iso(v) };
}

function getPrefs(userId) {
  const r = conn().prepare('SELECT public_mentions FROM news_prefs WHERE user_id = ?').get(userId);
  return { publicMentions: r?.public_mentions === 1 };
}

function setPrefs(userId, input = {}) {
  if (typeof input.publicMentions !== 'boolean') throw new NewsError(400, 'Champ publicMentions (booléen) attendu.');
  conn().prepare(`INSERT INTO news_prefs (user_id, public_mentions, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET public_mentions = excluded.public_mentions, updated_at = excluded.updated_at`)
    .run(userId, input.publicMentions ? 1 : 0);
  return getPrefs(userId);
}

// ── Admin : annonces ──────────────────────────────────────────────────────────

function listAdmin({ status = 'all', now = new Date() } = {}) {
  const where = STATUSES.includes(status) ? 'WHERE status = ?' : '';
  const rows = conn().prepare(`SELECT * FROM news_items ${where} ORDER BY COALESCE(publish_at, created_at) DESC, id DESC LIMIT 300`)
    .all(...(where ? [status] : []));
  const n = fmt(now);
  const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));
  for (const r of conn().prepare('SELECT status, COUNT(*) AS c FROM news_items GROUP BY status').all()) counts[r.status] = r.c;
  const items = rows.map(r => {
    const it = _row(r);
    it.state = r.status !== 'published' ? r.status
      : r.publish_at > n ? 'scheduled' : (r.expires_at && r.expires_at <= n) ? 'expired' : 'live';
    if (r.subject_user_id) it.subject = conn().prepare('SELECT username FROM users WHERE id = ?').get(r.subject_user_id)?.username ?? null;
    it.warnings = _warnings(it);
    return it;
  });
  return { items, counts, settings: settings(), discordUrl: _discordUrl(), categories: CATEGORIES,
    log: conn().prepare('SELECT * FROM news_log ORDER BY id DESC LIMIT 40').all().map(l => ({ ...l, at: iso(l.at), details: J(l.details, null) })) };
}

/** Création : toujours un brouillon (la publication est une action séparée). */
function createItem(input = {}) {
  const item = normalizeInput(input);
  let source = 'manual';
  const pid = input.aiProposalId != null ? Number(input.aiProposalId) : null;
  if (pid) {
    const p = getProposal(pid);
    if (!p || p.status !== 'open') throw new NewsError(409, 'Proposition IA introuvable ou déjà utilisée.');
    source = 'ai';
  }
  const id = db.runTransaction(() => {
    const nid = _insert(item, { status: 'draft', source });
    if (pid) conn().prepare("UPDATE news_ai_proposals SET status = 'used', news_id = ?, updated_at = datetime('now') WHERE id = ?").run(nid, pid);
    _log(nid, 'create', { source, ...(pid ? { aiProposalId: pid } : {}) });
    return nid;
  });
  return getItem(id);
}

function _get(id) {
  const it = getItem(id);
  if (!it) throw new NewsError(404, 'Annonce introuvable.');
  return it;
}

function updateItem(id, input = {}) {
  const cur = _get(id);
  if (cur.source === 'auto' && cur.status !== 'draft') throw new NewsError(409, 'Annonce automatique : archivez-la plutôt que de la modifier.');
  const item = normalizeInput(input, { partial: cur });
  conn().prepare(`UPDATE news_items SET category = ?, icon = ?, titles = ?, summaries = ?, bodies = ?, link_url = ?, link_labels = ?,
      event_at = ?, publish_at = ?, expires_at = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(item.category, item.icon, JSON.stringify(item.titles), JSON.stringify(item.summaries), JSON.stringify(item.bodies),
      item.linkUrl, JSON.stringify(item.linkLabels), item.eventAt, item.publishAt, item.expiresAt, id);
  _log(id, 'update', { fields: Object.keys(input).filter(k => k !== 'aiProposalId').slice(0, 12) });
  return getItem(id);
}

/** Publie maintenant ou à une date future (programmée). */
function publishItem(id, { at = null, now = new Date() } = {}) {
  const cur = _get(id);
  if (cur.status === 'archived') throw new NewsError(409, 'Annonce archivée : restaurez-la en brouillon d\'abord.');
  let when = now;
  if (at) { when = parse(at); if (!when) throw new NewsError(400, 'Date de publication invalide (UTC attendu).'); }
  if (when < now) when = now;
  if (cur.expiresAt && parse(cur.expiresAt) <= when) throw new NewsError(400, 'L\'annonce expirerait avant sa publication : corrigez l\'expiration.');
  conn().prepare("UPDATE news_items SET status = 'published', publish_at = ?, updated_at = datetime('now') WHERE id = ?").run(fmt(when), id);
  _log(id, when > now ? 'schedule' : 'publish', { at: iso(fmt(when)) });
  return getItem(id);
}

function unpublishItem(id) {
  _get(id);
  conn().prepare("UPDATE news_items SET status = 'draft', updated_at = datetime('now') WHERE id = ?").run(id);
  _log(id, 'unpublish');
  return getItem(id);
}

function archiveItem(id) {
  _get(id);
  conn().prepare("UPDATE news_items SET status = 'archived', updated_at = datetime('now') WHERE id = ?").run(id);
  _log(id, 'archive');
  return getItem(id);
}

// ── Admin : mise en forme IA ──────────────────────────────────────────────────

function _schema() {
  const str = { type: 'string' };
  const texts = { type: 'object', additionalProperties: false, required: LANGS, properties: Object.fromEntries(LANGS.map(l => [l, str])) };
  return {
    type: 'object', additionalProperties: false,
    required: ['category', 'icon', 'titles', 'summaries', 'bodies', 'eventAt', 'linkUrl', 'linkLabels', 'missing', 'doubts'],
    properties: {
      category: { type: 'string', enum: CATEGORIES }, icon: str,
      titles: texts, summaries: texts, bodies: texts,
      eventAt: str, linkUrl: str, linkLabels: texts,
      missing: { type: 'array', items: str }, doubts: { type: 'array', items: str },
    },
  };
}

function _messages(raw, nowIso) {
  const langs = LANGS.map(l => `${l} (${LANG_LABELS[l]})`).join(', ');
  const system = [
    'You format announcements for DIG!, an idle clicker mining game for all ages, shown in an in-game news panel.',
    'The game admin gives you RAW NOTES. Turn them into one clear, friendly announcement.',
    'STRICT RULE: use ONLY facts present in the notes. NEVER invent or guess a date, time, number, reward, prize, feature, price, URL or name.',
    'If something a player would need is absent or ambiguous (date, time zone, duration, conditions…), do not fill it in: list it in "missing" (short French sentences).',
    'List in "doubts" (short French sentences) any statement in the notes that seems contradictory, risky (promise of real prizes, personal data) or unclear.',
    `Write every text natively and idiomatically in ${langs}. titles: max 80 chars. summaries: one sentence, max 200 chars. bodies: 1-3 short paragraphs separated by a blank line, max 1200 chars, plain text (no markdown, no HTML).`,
    `category: one of ${CATEGORIES.join(', ')} ("player" is reserved for automatic player facts: do not use it).`,
    'icon: exactly one emoji fitting the topic.',
    `eventAt: if the notes give an explicit date AND time of an upcoming event, the UTC ISO time (like 2026-12-24T18:00:00Z, Belgian time is UTC+1 in winter, UTC+2 in summer); otherwise "". Current date (UTC): ${nowIso}.`,
    'linkUrl: an https URL copied verbatim from the notes, otherwise "". linkLabels: short button label per language if linkUrl is set, otherwise "".',
  ];
  return [{ role: 'system', content: system.join('\n') }, { role: 'user', content: `Raw notes from the admin:\n${raw}` }];
}

function _fake(raw) {
  return {
    category: 'news', icon: '📣',
    titles: { fr: 'Annonce de test', en: 'Test announcement', nl: 'Testaankondiging', es: 'Anuncio de prueba' },
    summaries: { fr: String(raw).slice(0, 120), en: 'Test summary.', nl: 'Testsamenvatting.', es: 'Resumen de prueba.' },
    bodies: { fr: String(raw).slice(0, 400), en: 'Test body.', nl: 'Testtekst.', es: 'Texto de prueba.' },
    eventAt: '', linkUrl: '', linkLabels: { fr: '', en: '', nl: '', es: '' },
    missing: ['Proposition de test : aucune IA appelée.'], doubts: [],
  };
}

/** Proposition normalisée. Un lien absent du texte brut est retiré (jamais d'adresse inventée). */
function _normalizeProposal(out, raw) {
  const r = out ?? {};
  const linkUrl = _line(r.linkUrl, MAX.url);
  const keepLink = linkUrl && URL_RE.test(linkUrl) && raw.includes(linkUrl);
  const eventAt = iso(r.eventAt);
  const missing = (Array.isArray(r.missing) ? r.missing : []).map(x => _line(x, 200)).filter(Boolean).slice(0, 8);
  if (linkUrl && !keepLink) missing.push('Lien proposé par l\'IA absent du texte brut : retiré.');
  return {
    item: {
      category: CATEGORIES.includes(r.category) && r.category !== 'player' ? r.category : 'news',
      icon: _emoji(r.icon, '📰'),
      titles: _texts(r.titles, MAX.title), summaries: _texts(r.summaries, MAX.summary), bodies: _texts(r.bodies, MAX.body, true),
      linkUrl: keepLink ? linkUrl : null, linkLabels: keepLink ? _texts(r.linkLabels, MAX.label) : _texts({}, 1),
      eventAt, publishAt: null, expiresAt: null,
    },
    missing,
    doubts: (Array.isArray(r.doubts) ? r.doubts : []).map(x => _line(x, 200)).filter(Boolean).slice(0, 8),
  };
}

const _jobs = new Map();

function _proposalRow(r) {
  if (!r) return null;
  let status = r.status, error = r.error;
  if (status === 'pending' && !_jobs.has(r.id)) { status = 'error'; error = INTERRUPTED; }
  return { id: r.id, rawText: r.raw_text, status, error, newsId: r.news_id, data: J(r.data, null), createdAt: iso(r.created_at) };
}

function getProposal(id) {
  return _proposalRow(conn().prepare('SELECT * FROM news_ai_proposals WHERE id = ?').get(id));
}

function listProposals(limit = 10) {
  return conn().prepare("SELECT * FROM news_ai_proposals WHERE status IN ('pending', 'open', 'error') ORDER BY id DESC LIMIT ?").all(limit).map(_proposalRow);
}

function startProposal({ text, nowMs = Date.now() } = {}) {
  const raw = _clean(text, MAX.raw);
  if (raw.length < 10) throw new NewsError(400, 'Collez le texte brut de l\'annonce (10 à 4000 caractères).');
  const blockAi = require('./blockAi');
  try { blockAi.precheckText(); } catch (err) { throw new NewsError(err.status ?? 503, err.message); }
  const id = conn().prepare('INSERT INTO news_ai_proposals (raw_text) VALUES (?)').run(raw).lastInsertRowid;
  const job = (async () => {
    try {
      const out = await blockAi.guardedJson({ kind: 'news-text', source: 'admin-news', name: 'dig_news',
        schema: _schema(), messages: _messages(raw, new Date(nowMs).toISOString().slice(0, 16) + 'Z'), fake: () => _fake(raw) });
      const data = _normalizeProposal(out.data, raw);
      conn().prepare("UPDATE news_ai_proposals SET status = 'open', data = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(data), id);
    } catch (err) {
      conn().prepare("UPDATE news_ai_proposals SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?")
        .run(String(err.message || err).slice(0, 400), id);
      throw err;
    } finally {
      _jobs.delete(id);
    }
  })();
  _jobs.set(id, job);
  job.catch(() => { /* état « error » enregistré */ });
  return { proposal: getProposal(id), job };
}

function discardProposal(id) {
  const p = getProposal(id);
  if (!p) throw new NewsError(404, 'Proposition introuvable.');
  if (p.status === 'pending') throw new NewsError(409, 'Mise en forme en cours : patientez.');
  conn().prepare("UPDATE news_ai_proposals SET status = 'discarded', updated_at = datetime('now') WHERE id = ?").run(id);
}

// ── Annonces automatiques ─────────────────────────────────────────────────────

const T = {
  next_title:   { fr: 'Prochaine saison : {name}', en: 'Next season: {name}', nl: 'Volgend seizoen: {name}', es: 'Próxima temporada: {name}' },
  next_coll:    { fr: 'Nouvelle collection : {name} ({n} objets à trouver).', en: 'New collection: {name} ({n} items to find).',
                  nl: 'Nieuwe collectie: {name} ({n} voorwerpen te vinden).', es: 'Nueva colección: {name} ({n} objetos por encontrar).' },
  next_body:    { fr: 'La nouvelle saison commence bientôt : le classement repart de zéro.', en: 'The new season starts soon: the leaderboard starts from scratch.',
                  nl: 'Het nieuwe seizoen begint binnenkort: het klassement begint opnieuw.', es: 'La nueva temporada empieza pronto: la clasificación vuelve a cero.' },
  start_title:  { fr: 'La saison {name} a commencé', en: 'Season {name} has begun', nl: 'Seizoen {name} is begonnen', es: 'Ha empezado la temporada {name}' },
  start_sum:    { fr: 'Nouveau classement : à toi de creuser !', en: 'Fresh leaderboard: time to dig!', nl: 'Nieuw klassement: graven maar!', es: 'Clasificación nueva: ¡a excavar!' },
  end_title:    { fr: 'Fin de la saison {name}', en: 'Season {name} is over', nl: 'Seizoen {name} is afgelopen', es: 'Fin de la temporada {name}' },
  end_sum:      { fr: '{n} mineurs classés · record de la saison : {d} m.', en: '{n} ranked miners · season record: {d} m.',
                  nl: '{n} mijnwerkers in het klassement · seizoensrecord: {d} m.', es: '{n} mineros clasificados · récord de la temporada: {d} m.' },
  end_few:      { fr: 'Le classement final est consultable dans l\'onglet Saison.', en: 'The final ranking is available in the Season tab.',
                  nl: 'Het eindklassement staat in het tabblad Seizoen.', es: 'La clasificación final está en la pestaña Temporada.' },
  depth_title:  { fr: '{user} a atteint {d} m', en: '{user} reached {d} m', nl: '{user} bereikte {d} m', es: '{user} ha llegado a {d} m' },
  depth_sum:    { fr: 'Profondeur validée par le serveur pendant la saison {name}.', en: 'Depth validated by the server during season {name}.',
                  nl: 'Diepte bevestigd door de server tijdens seizoen {name}.', es: 'Profundidad validada por el servidor durante la temporada {name}.' },
  rank_title:   { fr: '{user} a fini {pos} de la saison {name}', en: '{user} finished {pos} in season {name}',
                  nl: '{user} eindigde als {pos} in seizoen {name}', es: '{user} terminó {pos} en la temporada {name}' },
  rank_sum:     { fr: 'Classement figé de fin de saison : {d} m.', en: 'Frozen end-of-season ranking: {d} m.',
                  nl: 'Vastgelegd eindklassement: {d} m.', es: 'Clasificación final congelada: {d} m.' },
};

// Événements mensuels (#56)
Object.assign(T, {
  event_next_title:  { fr: 'Bientôt : {name}', en: 'Coming soon: {name}', nl: 'Binnenkort: {name}', es: 'Muy pronto: {name}' },
  event_start_title: { fr: 'L\'événement {name} a commencé', en: 'The {name} event has begun', nl: 'Het evenement {name} is begonnen', es: 'Ha empezado el evento {name}' },
  event_sum:         { fr: '{n} objets exclusifs à déterrer jusqu\'au {end}.', en: '{n} exclusive items to dig up until {end}.',
                       nl: '{n} exclusieve voorwerpen op te graven tot {end}.', es: '{n} objetos exclusivos por desenterrar hasta el {end}.' },
});

const ORD = {
  fr: n => (n === 1 ? '1er' : `${n}e`),
  en: n => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th')}`,
  nl: n => `${n}e`, es: n => `${n}.º`,
};

function _tpl(key, vars = {}) {
  const out = {};
  for (const l of LANGS) {
    out[l] = T[key][l].replace(/\{(\w+)\}/g, (_, k) => {
      const v = typeof vars[k] === 'function' ? vars[k](l) : vars[k];
      return v && typeof v === 'object' ? (v[l] || v.fr || '') : String(v ?? '');
    });
  }
  return out;
}

const _empty = () => ({ fr: '', en: '', nl: '', es: '' });

/** Nom public d'une saison : thème (#48) dans chaque langue, sinon le nom technique. */
function _seasonNames(season) {
  try {
    const th = require('./seasonThemes').themeForSeason(season.id);
    if (th?.names?.fr) return th.names;
  } catch (_) { /* thèmes indisponibles */ }
  const n = String(season.name).replace(/^saison\s+/i, '');   // « Saison 44-2026 » → « la saison 44-2026 »
  return { fr: n, en: n, nl: n, es: n };
}

/** Crée une annonce automatique publiée si la clé n'existe pas encore (rejouable). */
function _auto(key, fields, { publishAt, subjectUserId = null, status = 'published' }) {
  if (conn().prepare('SELECT 1 FROM news_items WHERE auto_key = ?').get(key)) return false;
  const item = { category: 'season', icon: '📰', titles: _empty(), summaries: _empty(), bodies: _empty(),
    linkUrl: null, linkLabels: _empty(), eventAt: null, expiresAt: null, ...fields, publishAt };
  const r = conn().prepare('INSERT OR IGNORE INTO news_items (status, source, category, icon, titles, summaries, bodies, link_url, link_labels, event_at, publish_at, expires_at, auto_key, subject_user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(status, 'auto', item.category, item.icon, JSON.stringify(item.titles), JSON.stringify(item.summaries), JSON.stringify(item.bodies),
      item.linkUrl, JSON.stringify(item.linkLabels), item.eventAt, item.publishAt, item.expiresAt, key, subjectUserId);
  if (r.changes) _log(r.lastInsertRowid, status === 'published' ? 'auto' : 'auto_skipped', { key });
  return r.changes > 0;
}

const _recent = (d, now) => d && d <= now && now - d < AUTO_WINDOW_MS;

function _seasonAnnouncements(now) {
  let created = 0;
  const active = db.getActiveSeason();
  const themes = require('./seasonThemes');
  if (active) {
    const start = parse(active.start_at);
    // Prochaine saison : dès que le thème est annoncé (J-1) dans la vue publique #48
    const pv = themes.publicView(active, now);
    if (pv.next?.theme?.names?.fr) {
      const nextStart = parse(pv.next.startAt);
      const coll = pv.next.collection;
      created += _auto(`season_next:${fmt(nextStart)}`, {
        icon: pv.next.theme.icon || '🗓️', titles: _tpl('next_title', { name: pv.next.theme.names }),
        summaries: coll ? _tpl('next_coll', { name: coll.names, n: coll.count }) : _texts(pv.next.theme.taglines, MAX.summary),
        bodies: _tpl('next_body'), eventAt: fmt(nextStart), expiresAt: fmt(nextStart),
      }, { publishAt: fmt(now) });
    }
    if (_recent(start, now)) {
      const th = themes.themeForSeason(active.id);
      created += _auto(`season_start:${active.id}`, {
        icon: th?.icon || '⛏️', titles: _tpl('start_title', { name: _seasonNames(active) }),
        summaries: th?.taglines?.fr ? _texts(th.taglines, MAX.summary) : _tpl('start_sum'),
        expiresAt: fmt(new Date(start.getTime() + 7 * 86_400_000)),
      }, { publishAt: fmt(start) });
    }
  }
  // Fin de saison : seulement après le classement figé (#29), chiffres agrégés
  const closed = conn().prepare(`SELECT s.* FROM seasons s JOIN season_snapshots p ON p.season_id = s.id
    WHERE s.status != 'active' ORDER BY s.end_at DESC LIMIT 3`).all();
  for (const s of closed) {
    const end = parse(s.end_at);
    if (!_recent(end, now)) continue;
    const agg = conn().prepare('SELECT COUNT(*) AS n, MAX(max_depth) AS d FROM season_standings WHERE season_id = ? AND eligible = 1').get(s.id);
    if (!agg.n) continue;
    created += _auto(`season_end:${s.id}`, {
      icon: '🏁', titles: _tpl('end_title', { name: _seasonNames(s) }),
      // Moins de 3 classés : un agrégat révélerait le résultat d'un joueur sans son accord
      summaries: agg.n >= END_MIN_RANKED ? _tpl('end_sum', { n: agg.n, d: agg.d }) : _tpl('end_few'),
      expiresAt: fmt(new Date(end.getTime() + 7 * 86_400_000)),
    }, { publishAt: fmt(now) });
  }
  return created;
}

/**
 * Événements mensuels publics planifiés (#56) : « Bientôt » dès J-7, « a commencé » au début.
 * Événement repassé en brouillon : ses annonces automatiques sont archivées (rien n'est supprimé).
 */
function _eventAnnouncements(now) {
  let created = 0;
  const ev = require('./monthlyEvents');
  const DAY_FMT = { fr: 'fr-BE', en: 'en-GB', nl: 'nl-BE', es: 'es-ES' };
  const endFmt = e => l => new Date(e.endsAt).toLocaleDateString(DAY_FMT[l], { day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' });
  for (const e of ev.listEvents(now.getTime())) {
    const key = `event_next:${e.id}`, keyStart = `event_start:${e.id}`;
    if (e.audience !== 'public' || e.status !== 'scheduled') {
      const rows = conn().prepare("SELECT id FROM news_items WHERE auto_key IN (?, ?) AND status = 'published'").all(key, keyStart);
      for (const r of rows) { conn().prepare("UPDATE news_items SET status = 'archived', updated_at = datetime('now') WHERE id = ?").run(r.id); _log(r.id, 'auto_archived', { reason: 'event_unscheduled', eventId: e.id }); }
      continue;
    }
    const start = parse(e.startsAt), end = parse(e.endsAt);
    const n = e.items.filter(i => i.enabled).length;
    const fields = { category: 'event', icon: e.icon, summaries: _tpl('event_sum', { n, end: endFmt(e) }), bodies: _texts(e.taglines, MAX.body, true), expiresAt: fmt(end) };
    if (now < start && start - now <= 7 * 86_400_000) {
      created += _auto(key, { ...fields, titles: _tpl('event_next_title', { name: e.names }), eventAt: fmt(start), expiresAt: fmt(start) }, { publishAt: fmt(now) });
    }
    if (now >= start && now < end) created += _auto(keyStart, { ...fields, titles: _tpl('event_start_title', { name: e.names }) }, { publishAt: fmt(start) });
  }
  return created;
}

/** Fait joueur : accord donné, pas de risque anti-bot, plafond quotidien. Rend true si publié. */
function _playerFact(key, userId, seasonId, fields, s, now) {
  if (!getPrefs(userId).publicMentions) return false;
  if (conn().prepare('SELECT 1 FROM news_items WHERE auto_key = ?').get(key)) return false;
  try { if (require('./antibot').getRisk(userId, seasonId, now.getTime()).level >= 2) return false; } catch (_) { /* anti-bot indisponible : prudence */ return false; }
  const today = fmt(now).slice(0, 10);
  const n = conn().prepare("SELECT COUNT(*) AS c FROM news_items WHERE source = 'auto' AND subject_user_id IS NOT NULL AND status = 'published' AND substr(publish_at, 1, 10) = ?").get(today).c;
  const status = n >= s.playerDailyMax ? 'archived' : 'published';   // plafond : tracé, jamais publié plus tard
  return _auto(key, { category: 'player', expiresAt: fmt(new Date(now.getTime() + 7 * 86_400_000)), ...fields },
    { publishAt: fmt(now), subjectUserId: userId, status }) && status === 'published';
}

function _username(userId) {
  return conn().prepare('SELECT username FROM users WHERE id = ?').get(userId)?.username ?? null;
}

function _rankFacts(s, now) {
  if (!s.playerEvents || !s.rankTop) return 0;
  let created = 0;
  const closed = conn().prepare(`SELECT s.* FROM seasons s JOIN season_snapshots p ON p.season_id = s.id
    WHERE s.status != 'active' ORDER BY s.end_at DESC LIMIT 1`).all();
  for (const season of closed) {
    if (!_recent(parse(season.end_at), now)) continue;
    const rows = conn().prepare('SELECT user_id, rank, max_depth FROM season_standings WHERE season_id = ? AND eligible = 1 AND rank <= ? ORDER BY rank').all(season.id, s.rankTop);
    for (const r of rows) {
      const user = _username(r.user_id);
      if (!user) continue;
      if (_playerFact(`rank:${season.id}:${r.user_id}`, r.user_id, season.id, {
        icon: r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : '🏆',
        titles: _tpl('rank_title', { user, pos: l => ORD[l](r.rank), name: _seasonNames(season) }),
        summaries: _tpl('rank_sum', { d: r.max_depth }),
      }, s, now)) created++;
    }
  }
  return created;
}

/**
 * Passe du planificateur (chaque minute, idempotente) : annonces de saison et classements finaux.
 * Ne lève jamais : rend { created } ou { error }.
 */
function sync(now = new Date()) {
  try {
    const s = settings();
    let created = 0;
    if (s.autoSeasons) created += _seasonAnnouncements(now);
    if (s.autoSeasons) {
      try { created += _eventAnnouncements(now); } catch (err) { console.error('[news] événements', err.message); }
    }
    created += _rankFacts(s, now);
    return { created };
  } catch (err) {
    console.error('[news] sync', err.message);
    return { error: err.message };
  }
}

/** Après une sauvegarde : palier de profondeur VALIDÉE par le serveur (jamais la valeur déclarée). */
function onSave(userId, now = new Date()) {
  const s = settings();
  if (!s.playerEvents || !s.depthMilestones.length) return 0;
  const season = db.getActiveSeason();
  const t = db.getDepthTracking(userId);
  if (!season || !t || t.season_id !== season.id) return 0;
  const reached = s.depthMilestones.filter(m => t.accepted_depth >= m);
  if (!reached.length) return 0;
  const m = reached[reached.length - 1];   // seulement le palier le plus haut atteint : jamais une rafale
  const user = _username(userId);
  if (!user) return 0;
  return _playerFact(`depth:${season.id}:${userId}:${m}`, userId, season.id, {
    icon: '⛏️', titles: _tpl('depth_title', { user, d: m }), summaries: _tpl('depth_sum', { name: _seasonNames(season) }),
  }, s, now) ? 1 : 0;
}

function waitJob(id) { return _jobs.get(id) ?? Promise.resolve(); }

module.exports = {
  NewsError, LANGS, CATEGORIES, DEFAULTS, init, settings, updateSettings, validateConfigValue, normalizeInput,
  publicView, markSeen, getPrefs, setPrefs, listAdmin, getItem, createItem, updateItem, publishItem, unpublishItem,
  archiveItem, startProposal, getProposal, listProposals, discardProposal, sync, onSave, waitJob,
};
