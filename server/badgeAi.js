/**
 * server/badgeAi.js — Création de badges assistée par IA dans le panel admin (#38, demande du
 * propriétaire du 31/10/2026).
 *
 * Description libre → UNE proposition texte (identifiant, catégorie, emoji, noms et descriptions
 * FR/EN/NL/ES, critère de déblocage, période d'événement facultative, consigne d'illustration) →
 * corrections dans le panel → « Enregistrer comme badge désactivé » (brouillon) → activation
 * séparée par l'admin. Rien n'est jamais activé ici.
 *
 * Critères : UNIQUEMENT les métriques réellement suivies par server/badges.js (CONDITIONS, types de
 * blocs publiés). Tout ce que la description demande d'autre (série de jours consécutifs, pièces,
 * achats, classement…) est listé comme « non pris en charge » : aucun suivi ni attribution n'est
 * inventé, et une proposition sans critère pris en charge ne peut pas être enregistrée.
 *
 * Visuel : emoji proposé + consigne d'illustration transmise à l'atelier d'icônes (#40), où l'image
 * se génère une par une, sur action explicite. Aucune image n'est générée ici.
 *
 * Infrastructure IA de #37 (blockAi.guardedJson) : clé côté serveur, un appel à la fois, quota
 * journalier, plafond et journal partagés ; appel en arrière-plan (délai de 60 s du proxy), état
 * `pending` d'un appel interrompu par un redémarrage affiché comme tel, sans relance automatique.
 */

'use strict';

const db      = require('./db');
const blockAi = require('./blockAi');
const badges  = require('./badges');
const blockCatalog = require('./blockCatalog');

const LANGS = badges.LANGS;
const LANG_LABELS = { fr: 'French', en: 'English', nl: 'Dutch', es: 'Spanish' };
const CONCEPT_MAX = 800;
const UNSUPPORTED = 'unsupported';

/** Ce que chaque condition mesure, tel que le serveur le suit réellement (repris dans la consigne IA et le panel). */
const METRICS = {
  max_depth:      'maximum depth reached, in metres, as validated by the server (threshold = metres)',
  blocks_total:   'total number of blocks mined (threshold = blocks)',
  blocks_of_type: 'number of blocks of ONE given block type mined (blockId required, threshold = blocks)',
  distinct_types: 'number of different block types mined at least once (threshold = types)',
  chests_opened:  'chests opened WHILE MINING (chest blocks broken underground; chests bought in the shop do NOT count)',
  play_days:      'number of distinct calendar days (not necessarily consecutive) with at least one block mined',
};

const INTERRUPTED = 'Génération interrompue (serveur redémarré pendant l\'appel) : aucune proposition reçue, relancez-la.';

class BadgeAiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

const conn = () => db.getDb();

function init() {
  conn().exec(`
    CREATE TABLE IF NOT EXISTS badge_ai_proposals (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      concept     TEXT    NOT NULL,
      status      TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'open', 'error', 'in_draft', 'discarded')),
      data        TEXT,
      error       TEXT,
      badge_id    TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

const _blockTypes = () => blockCatalog.getPublished().types.map(t => ({ id: t.id, name: t.names?.fr ?? t.id, en: t.names?.en ?? '', category: t.category, minDepth: t.minDepth }));

// ── Texte ─────────────────────────────────────────────────────────────────────

function _schema() {
  const str = { type: 'string' };
  const texts = { type: 'object', additionalProperties: false, required: LANGS, properties: Object.fromEntries(LANGS.map(l => [l, str])) };
  return {
    type: 'object', additionalProperties: false,
    required: ['idSuggestion', 'category', 'icon', 'visibility', 'names', 'descriptions', 'criterion', 'event', 'unsupported', 'image', 'rationale'],
    properties: {
      idSuggestion: str,
      category: { type: 'string', enum: badges.CATEGORIES },
      icon: str,
      visibility: { type: 'string', enum: badges.VISIBILITY },
      names: texts,
      descriptions: texts,
      criterion: { type: 'object', additionalProperties: false, required: ['condition', 'blockId', 'threshold'],
        properties: { condition: { type: 'string', enum: [...badges.CONDITIONS, UNSUPPORTED] }, blockId: str, threshold: { type: 'integer' } } },
      event: { type: 'object', additionalProperties: false, required: ['startsAt', 'endsAt'], properties: { startsAt: str, endsAt: str } },
      unsupported: { type: 'array', items: str },
      image: { type: 'object', additionalProperties: false, required: ['subject', 'details', 'palette'], properties: { subject: str, details: str, palette: str } },
      rationale: str,
    },
  };
}

function _existingSummary() {
  return badges.listBadges().map(b => `${b.id} (${b.names.fr}) : ${b.condition}${b.blockId ? `:${b.blockId}` : ''} ≥ ${b.threshold} [${b.status}]`).join('\n');
}

function _messages(concept, nowIso) {
  const langs = LANGS.map(l => `${l} (${LANG_LABELS[l]})`).join(', ');
  const system = [
    'You design honorary badges (achievements) for DIG!, an idle clicker mining game for all ages: the player digs down block after block.',
    'Badges are purely honorary: they never give coins, gems, items, points or ranking. Never mention a reward.',
    'The server can ONLY track these metrics (criterion.condition):',
    ...Object.entries(METRICS).map(([k, v]) => `- ${k}: ${v}`),
    `Block types available for blocks_of_type (use the id exactly): ${_blockTypes().map(t => `${t.id} (${t.name}${t.en ? ` / ${t.en}` : ''}, from ${t.minDepth} m)`).join(', ')}.`,
    'Optional event window (event.startsAt / event.endsAt, ISO UTC like 2026-12-24T00:00:00Z, or empty strings): only progress made during the window counts.',
    `Current date (UTC): ${nowIso}. Use an event window only if the description asks for a time-limited badge.`,
    'NEVER invent tracking. If the description asks for anything the metrics above cannot measure exactly (e.g. consecutive-day streaks, coins or gems earned or spent, purchases, upgrades, prestige, leaderboard rank or league, collections or relics, clicks, time played, friends, ads, daily rewards),',
    'list each such request in "unsupported" (short French sentences explaining why it cannot be tracked). If a supported metric is a faithful approximation, use it and say so in rationale; otherwise set criterion.condition to "unsupported", blockId "" and threshold 1.',
    'blockId: a block id from the list for blocks_of_type, otherwise "". threshold: a positive integer, reachable and sensible for the metric.',
    `Every name and description must exist in ${langs}, written natively and idiomatically. Name: max 40 chars, evocative and fun. Description: one short sentence (max 120 chars) that states the exact condition in plain words, matching the criterion.`,
    'icon: exactly one emoji. idSuggestion: lowercase ascii snake_case derived from the French name (2-40 chars, starts with a letter), distinct from existing badges.',
    `category: one of ${badges.CATEGORIES.join(', ')}. visibility: "hidden" only for a surprise/secret badge, otherwise "visible".`,
    'image: English art direction for ONE isolated badge emblem icon (round medal or shield emblem, no text or letters): subject; details of shape/material; palette sentence starting with "Palette:".',
    'rationale: 1-2 French sentences explaining the criterion choice.',
    `Existing badges (avoid duplicates):\n${_existingSummary()}`,
  ];
  return [{ role: 'system', content: system.join('\n') }, { role: 'user', content: `Badge idea from the game admin: ${concept}` }];
}

function _fake(_kind, concept) {
  return {
    idSuggestion: 'mineur_du_dimanche', category: 'fidelite', icon: '🌞', visibility: 'visible',
    names: { fr: 'Mineur du dimanche', en: 'Sunday miner', nl: 'Zondagse mijnwerker', es: 'Minero de domingo' },
    descriptions: { fr: 'Miner pendant 5 jours différents.', en: 'Mine on 5 different days.', nl: 'Hak op 5 verschillende dagen.', es: 'Pica durante 5 días distintos.' },
    criterion: { condition: 'play_days', blockId: '', threshold: 5 },
    event: { startsAt: '', endsAt: '' },
    unsupported: /affil|cons[ée]cutif|streak/i.test(String(concept)) ? ['Jours consécutifs : seuls les jours distincts sont suivis.'] : [],
    image: { subject: 'A round bronze medal with a small smiling sun', details: 'Thick rim, soft bevel.', palette: 'Palette: warm bronze, sunny yellow.' },
    rationale: `Proposition de test pour « ${String(concept).slice(0, 40)} ».`,
  };
}

// ── Normalisation (texte IA ou corrections de l'admin) ────────────────────────

const _clean = (v, max) => String(v ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, max);

function _slug(s) {
  const x = String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return /^[a-z]/.test(x) ? x : (x ? `b_${x}`.slice(0, 40) : '');
}

function _texts(t, max) {
  const out = {};
  for (const l of LANGS) out[l] = _clean(t?.[l], max);
  return out;
}

function _emoji(v, d) {
  const e = String(v ?? '').trim();
  return e && [...e].length <= 4 && !/[<>&"'\s]/.test(e) ? e : d;
}

/** Proposition normalisée. `badge.condition` vaut null si aucun critère pris en charge n'a été retenu. */
function _normalize(raw) {
  const b = raw?.badge ?? raw ?? {};
  const crit = b.criterion ?? b;
  const condition = badges.CONDITIONS.includes(crit.condition) ? crit.condition : null;
  const threshold = Math.round(Number(crit.threshold));
  const ev = b.event ?? b;
  const date = v => _clean(v, 30) || null;
  const badge = {
    id: _slug(b.id ?? b.idSuggestion) || 'nouveau_badge',
    category: badges.CATEGORIES.includes(b.category) ? b.category : 'minage',
    icon: _emoji(b.icon, '🏅'),
    visibility: badges.VISIBILITY.includes(b.visibility) ? b.visibility : 'visible',
    names: _texts(b.names, 60), descriptions: _texts(b.descriptions, 200),
    condition, blockId: condition === 'blocks_of_type' ? _clean(crit.blockId, 40) || null : null,
    threshold: Number.isFinite(threshold) && threshold >= 1 ? Math.min(threshold, 1e9) : 1,
    startsAt: date(ev.startsAt), endsAt: date(ev.endsAt),
    image: typeof b.image === 'string' ? _clean(b.image, 200) || null : null,
  };
  const img = raw?.image ?? {};
  return {
    badge,
    image: { subject: _clean(img.subject, 300), details: _clean(img.details, 600), palette: _clean(img.palette, 300) },
    unsupported: (Array.isArray(raw?.unsupported) ? raw.unsupported : []).map(u => _clean(u, 200)).filter(Boolean).slice(0, 8),
    rationale: _clean(raw?.rationale, 600),
  };
}

/** Problèmes bloquants (l'enregistrement est refusé tant qu'il en reste). */
function _errors(data) {
  const e = [];
  if (!data.badge.condition) e.push('Aucun critère pris en charge : choisissez une condition parmi celles que le serveur suit réellement.');
  if (badges.getBadgeRow(data.badge.id)) e.push(`Identifiant « ${data.badge.id} » déjà utilisé : changez-le.`);
  if (data.badge.condition) {
    try { badges.normalizeBadge({ ...data.badge, status: 'inactive' }); } catch (err) { e.push(...(err.details ?? [err.message])); }
  }
  return e;
}

function _warnings(data) {
  const w = data.unsupported.map(u => `Non pris en charge : ${u}`);
  const miss = LANGS.filter(l => l !== 'fr' && (!data.badge.names[l] || !data.badge.descriptions[l]));
  if (miss.length) w.push(`Nom ou description manquant en ${miss.join(', ').toUpperCase()} (le français sera affiché).`);
  return w;
}

// ── Propositions ──────────────────────────────────────────────────────────────

const _jobs = new Map();

function _row(r) {
  if (!r) return null;
  let status = r.status, error = r.error;
  if (status === 'pending' && !_jobs.has(r.id)) { status = 'error'; error = INTERRUPTED; }
  const data = r.data ? JSON.parse(r.data) : null;
  const open = status === 'open' && data;
  return { id: r.id, concept: r.concept, status, error, badgeId: r.badge_id, createdAt: r.created_at, updatedAt: r.updated_at,
    data, errors: open ? _errors(data) : [], warnings: open ? _warnings(data) : [] };
}

function getProposal(id) {
  return _row(conn().prepare('SELECT * FROM badge_ai_proposals WHERE id = ?').get(id));
}

function listProposals(limit = 20) {
  return conn().prepare("SELECT * FROM badge_ai_proposals WHERE status != 'discarded' ORDER BY id DESC LIMIT ?").all(limit).map(_row);
}

/**
 * Lance une proposition. Garde-fous (appel en cours, quota, plafond, configuration) vérifiés tout de
 * suite ; l'appel texte tourne en arrière-plan (`pending`, puis `open` ou `error`).
 * Rend `{ proposal, job }` : les routes n'attendent pas `job`, les tests peuvent l'attendre.
 */
function startProposal({ concept, nowMs = Date.now() } = {}) {
  const c = _clean(concept, CONCEPT_MAX);
  if (c.length < 3) throw new BadgeAiError(400, 'Décrivez le badge (3 à 800 caractères).');
  try { blockAi.precheckText(); } catch (err) { throw new BadgeAiError(err.status ?? 503, err.message); }
  const id = conn().prepare('INSERT INTO badge_ai_proposals (concept) VALUES (?)').run(c).lastInsertRowid;
  const job = (async () => {
    try {
      const out = await blockAi.guardedJson({ kind: 'badge-text', source: 'admin-badges', name: 'dig_badge',
        schema: _schema(), messages: _messages(c, new Date(nowMs).toISOString().slice(0, 10)), fake: k => _fake(k, c) });
      const data = _normalize(out.data);
      conn().prepare("UPDATE badge_ai_proposals SET status = 'open', data = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(data), id);
    } catch (err) {
      conn().prepare("UPDATE badge_ai_proposals SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?")
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

function _open(id) {
  const p = getProposal(id);
  if (!p) throw new BadgeAiError(404, 'Proposition introuvable.');
  if (p.status !== 'open') {
    throw new BadgeAiError(409, { pending: 'Proposition en cours de génération.', in_draft: 'Proposition déjà enregistrée comme badge : modifiez-le dans la liste des badges.',
      discarded: 'Proposition abandonnée.', error: 'Proposition en échec : relancez une nouvelle proposition.' }[p.status] ?? 'Proposition indisponible.');
  }
  return p;
}

/** Corrections de l'admin (sans coût) : champs du badge, consigne d'illustration. */
function updateProposal(id, input = {}) {
  const p = _open(id);
  const cur = p.data;
  const b = { ...cur.badge, ...(input.badge ?? {}) };
  const next = _normalize({
    badge: { ...b, criterion: { condition: b.condition, blockId: b.blockId, threshold: b.threshold }, event: { startsAt: b.startsAt, endsAt: b.endsAt } },
    image: { ...cur.image, ...(input.image ?? {}) }, unsupported: cur.unsupported, rationale: cur.rationale,
  });
  conn().prepare("UPDATE badge_ai_proposals SET data = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(next), id);
  return getProposal(id);
}

/**
 * Enregistre la proposition comme badge DÉSACTIVÉ (brouillon) : jamais attribuable tant que l'admin
 * ne l'a pas activé. La consigne d'illustration est reprise par l'atelier d'icônes (#40).
 */
function addToDraft(id) {
  const p = _open(id);
  const errors = _errors(p.data);
  if (errors.length) throw new BadgeAiError(400, 'Proposition incomplète.', errors);
  const maxSort = conn().prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM badges').get().m;
  let badge;
  try {
    badge = badges.createBadge({ ...p.data.badge, status: 'inactive', sort: maxSort + 10 });
  } catch (err) {
    if (err instanceof badges.BadgeError) throw new BadgeAiError(err.status, err.message, err.details);
    throw err;
  }
  conn().prepare("UPDATE badge_ai_proposals SET status = 'in_draft', badge_id = ?, updated_at = datetime('now') WHERE id = ?").run(badge.id, id);
  if (p.data.image?.subject) {
    try { require('./iconStudio').setBrief(`badge:${badge.id}`, p.data.image); } catch (err) { console.warn('[badgeAi] consigne atelier', badge.id, err.message); }
  }
  return { proposal: getProposal(id), badge };
}

function discardProposal(id) {
  const p = getProposal(id);
  if (!p) throw new BadgeAiError(404, 'Proposition introuvable.');
  if (p.status === 'pending') throw new BadgeAiError(409, 'Proposition en cours de génération : patientez.');
  conn().prepare("UPDATE badge_ai_proposals SET status = 'discarded', updated_at = datetime('now') WHERE id = ?").run(id);
}

function waitJob(id) { return _jobs.get(id) ?? Promise.resolve(); }

module.exports = {
  BadgeAiError, METRICS, init, startProposal, getProposal, listProposals, updateProposal, addToDraft, discardProposal, waitJob,
};
