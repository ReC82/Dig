/**
 * server/collectionAi.js — Création de collections assistée par IA dans le panel admin (#39,
 * demande du propriétaire du 31/10/2026).
 *
 * Description libre → UNE proposition texte (série : noms FR/EN/NL/ES, icône, thème ; objets :
 * noms, histoires FR/EN/NL/ES, rareté, emoji, consigne d'illustration) → corrections dans le panel →
 * « Enregistrer dans le brouillon » des collections → publication séparée par l'admin. Rien n'est
 * jamais publié ici. Aucune image n'est générée : chaque illustration se demande ensuite, une à la
 * fois, dans l'atelier d'icônes (#40), qui reçoit la consigne d'illustration proposée.
 *
 * Drops : la proposition porte des paramètres de drop par défaut selon la rareté (barème PROPOSÉ,
 * non validé par le propriétaire), toujours INACTIFS ; la publication d'un drop reste soumise à la
 * case « barème validé » du catalogue.
 *
 * Infrastructure IA réutilisée de #37 (blockAi.guardedJson) : clé côté serveur, un appel à la fois,
 * quota journalier, plafond et journal partagés. L'appel texte (≈ 30–60 s) tourne en arrière-plan
 * (délai de 60 s du proxy) ; l'état `pending` d'un appel interrompu par un redémarrage est affiché
 * comme tel, sans relance automatique (une relance coûte).
 */

'use strict';

const db = require('./db');
const blockAi = require('./blockAi');
const catalog = require('./collectionCatalog');

const LANGS = catalog.LANGS;
const LANG_LABELS = { fr: 'French', en: 'English', nl: 'Dutch', es: 'Spanish' };
const CONCEPT_MAX = 800;
const ITEMS_MIN = 3, ITEMS_MAX = 8;
const ID_RE = /^[a-z][a-z0-9_]{1,39}$/;

/** Paramètres de drop proposés par rareté (non validés : le drop reste inactif). */
const DEFAULT_DROPS = {
  'commun':     { from: ['terre', 'pierre'], minDepth: 5, chance: 0.03 },
  'peu-commun': { from: ['pierre', 'minerai'], minDepth: 20, chance: 0.02 },
  'rare':       { from: ['minerai'], minDepth: 40, chance: 0.015 },
  'epique':     { from: ['coffre'], minDepth: 60, chance: 0.08 },
  'legendaire': { from: ['gemme'], minDepth: 100, chance: 0.05 },
};

const INTERRUPTED = 'Génération interrompue (serveur redémarré pendant l\'appel) : aucune proposition reçue, relancez-la.';

class CollectionAiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const conn = () => db.getDb();

function init() {
  conn().exec(`
    CREATE TABLE IF NOT EXISTS collection_ai_proposals (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      concept     TEXT    NOT NULL,
      params      TEXT,
      status      TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'open', 'error', 'in_draft', 'discarded')),
      data        TEXT,
      error       TEXT,
      series_id   TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

// ── Texte ─────────────────────────────────────────────────────────────────────

function _schema() {
  const str = { type: 'string' };
  const texts = { type: 'object', additionalProperties: false, required: LANGS, properties: Object.fromEntries(LANGS.map(l => [l, str])) };
  return {
    type: 'object', additionalProperties: false,
    required: ['series', 'items', 'rationale'],
    properties: {
      series: { type: 'object', additionalProperties: false, required: ['idSuggestion', 'names', 'icon', 'theme'],
        properties: { idSuggestion: str, names: texts, icon: str, theme: str } },
      items: { type: 'array', items: { type: 'object', additionalProperties: false,
        required: ['idSuggestion', 'names', 'stories', 'rarity', 'icon', 'image'],
        properties: { idSuggestion: str, names: texts, stories: texts, rarity: { type: 'string', enum: catalog.RARITIES }, icon: str,
          image: { type: 'object', additionalProperties: false, required: ['subject', 'details', 'palette'], properties: { subject: str, details: str, palette: str } } } } },
      rationale: str,
    },
  };
}

function _existingSummary() {
  const c = catalog.getDraft() ?? catalog.getPublished();
  return c.series.map(s => `${s.id} (${s.names?.fr ?? s.id}) : ${c.items.filter(i => i.seriesId === s.id).map(i => `${i.names?.fr ?? i.id} [${i.rarity}]`).join(', ')}`).join('\n');
}

/** Exemple de ton : l'histoire FR d'un objet d'origine. */
function _toneSample() {
  return catalog.ORIGIN_ITEMS.slice(0, 2).map(i => `${i.names.fr} : ${i.stories.fr}`).join('\n');
}

function _messages(concept, { itemCount, seasonName }) {
  const langs = LANGS.map(l => `${l} (${LANG_LABELS[l]})`).join(', ');
  const system = [
    'You design collectible content for DIG!, an idle clicker mining game for all ages: the player digs down block after block and sometimes finds collectible objects.',
    'A collection is a themed series of objects. Each object has a card with a large picture, its rarity, and a short original story.',
    `Return ONLY the JSON object requested, with exactly ${itemCount} items. Every text must exist in ${langs}, written natively and idiomatically in each language (never a copied French word unless correct).`,
    'Series name: max 40 chars. Object names: short, max 30 chars, evocative, all distinct, and distinct from existing objects.',
    'Stories: 2 to 3 sentences (max 320 chars per language), warm, witty and family-friendly, original (no existing brands, characters or real people), in the same tone as these examples:',
    _toneSample(),
    `Rarities: mix them sensibly for ${itemCount} objects (mostly commun/peu-commun, few rare, at most one epique and one legendaire); allowed values: ${catalog.RARITIES.join(', ')}.`,
    'icon: exactly one emoji for the series and for each object.',
    'idSuggestion: lowercase ascii snake_case derived from the French name (2-40 chars, starts with a letter).',
    'theme: one French sentence summarising the visual and narrative theme of the series.',
    'image: English art direction for ONE isolated collectible object icon (subject; details of shape/material; palette sentence starting with "Palette:"), consistent across the series.',
    'rationale: 1-2 French sentences explaining the theme and rarity choices.',
    'Do NOT propose drop rates, prices or rewards: they are set by the game owner.',
    `Existing collections (avoid duplicates):\n${_existingSummary()}`,
  ];
  const user = `Collection concept from the game admin: ${concept}${seasonName ? `\nThis series belongs to the season "${seasonName}".` : ''}`;
  return [{ role: 'system', content: system.join('\n') }, { role: 'user', content: user }];
}

function _fake(_kind, concept, itemCount) {
  const rar = ['commun', 'commun', 'peu-commun', 'rare', 'epique', 'legendaire', 'peu-commun', 'commun'];
  return {
    series: { idSuggestion: 'tresors_givre', names: { fr: 'Trésors du givre', en: 'Frost treasures', nl: 'Schatten van de rijp', es: 'Tesoros de la escarcha' },
      icon: '❄️', theme: `Série de test pour « ${String(concept).slice(0, 40)} ».` },
    items: Array.from({ length: itemCount }, (_, k) => ({
      idSuggestion: `flocon_${k + 1}`,
      names: { fr: `Flocon n° ${k + 1}`, en: `Snowflake #${k + 1}`, nl: `Sneeuwvlok nr. ${k + 1}`, es: `Copo n.º ${k + 1}` },
      stories: { fr: 'Il est tombé du ciel un jour de grand froid et ne veut plus fondre.', en: 'It fell from the sky on a freezing day and refuses to melt.',
        nl: 'Hij viel op een ijskoude dag uit de lucht en weigert te smelten.', es: 'Cayó del cielo un día helado y se niega a derretirse.' },
      rarity: rar[k % rar.length], icon: '❄️',
      image: { subject: 'A single crystalline snowflake charm', details: 'Six thin branches, frosty edges.', palette: 'Palette: ice blue, white.' },
    })),
    rationale: 'Proposition de test.',
  };
}

// ── Normalisation (texte IA ou corrections de l'admin) ────────────────────────

const _clean = (v, max) => String(v ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, max);

function _slug(s) {
  const x = String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return /^[a-z]/.test(x) ? x : (x ? `c_${x}`.slice(0, 40) : '');
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

function _drop(rarity, d) {
  const def = DEFAULT_DROPS[rarity] ?? DEFAULT_DROPS.commun;
  if (!d || typeof d !== 'object') return { ...def, from: [...def.from] };
  const from = Array.isArray(d.from) ? [...new Set(d.from.map(String))].filter(c => catalog.CATEGORIES.includes(c)) : [];
  const minDepth = Number(d.minDepth), chance = Number(d.chance);
  return {
    from: from.length ? from : [...def.from],
    minDepth: Number.isInteger(minDepth) && minDepth >= 1 ? minDepth : def.minDepth,
    chance: Number.isFinite(chance) && chance > 0 && chance <= 0.5 ? chance : def.chance,
  };
}

/** Proposition normalisée : identifiants uniques et propres, textes bornés, drops inactifs. */
function _normalize(raw, { seasonId = null } = {}) {
  const s = raw?.series ?? {};
  const series = {
    id: _slug(s.id ?? s.idSuggestion) || 'nouvelle_serie',
    names: _texts(s.names, 60), icon: _emoji(s.icon, '📦'), theme: _clean(s.theme, 300),
    seasonId: seasonId ?? (s.seasonId === undefined || s.seasonId === null || s.seasonId === '' ? null : Number(s.seasonId)),
  };
  const seen = new Set();
  const items = (Array.isArray(raw?.items) ? raw.items : []).slice(0, ITEMS_MAX).map((i, k) => {
    let id = _slug(i.id ?? i.idSuggestion) || `objet_${k + 1}`;
    while (seen.has(id)) id = `${id.slice(0, 36)}_${k + 1}`;
    seen.add(id);
    const rarity = catalog.RARITIES.includes(i.rarity) ? i.rarity : 'commun';
    return {
      id, names: _texts(i.names, 60), stories: _texts(i.stories, 1200), rarity, icon: _emoji(i.icon, series.icon),
      image: { subject: _clean(i.image?.subject, 300), details: _clean(i.image?.details, 600), palette: _clean(i.image?.palette, 300) },
      drop: _drop(rarity, i.drop),
    };
  });
  return { series, items, rationale: _clean(raw?.rationale, 600) };
}

// ── Propositions ──────────────────────────────────────────────────────────────

const _jobs = new Map();

function _warnings(data) {
  if (!data) return [];
  const w = [];
  const c = catalog.getDraft() ?? catalog.getPublished();
  const ids = { series: new Set(c.series.map(s => s.id)), items: new Set(c.items.map(i => i.id)) };
  if (ids.series.has(data.series.id)) w.push(`Identifiant de série « ${data.series.id} » déjà utilisé : changez-le.`);
  for (const l of LANGS) if (!data.series.names[l]) w.push(`Nom de série ${l.toUpperCase()} manquant.`);
  for (const i of data.items) {
    if (ids.items.has(i.id)) w.push(`Identifiant d'objet « ${i.id} » déjà utilisé : changez-le.`);
    const miss = LANGS.filter(l => !i.names[l] || !i.stories[l]);
    if (miss.length) w.push(`« ${i.names.fr || i.id} » : nom ou histoire manquant en ${miss.join(', ').toUpperCase()}.`);
  }
  return w;
}

function _row(r) {
  if (!r) return null;
  let status = r.status, error = r.error;
  if (status === 'pending' && !_jobs.has(r.id)) { status = 'error'; error = INTERRUPTED; }
  const data = r.data ? JSON.parse(r.data) : null;
  return { id: r.id, concept: r.concept, params: r.params ? JSON.parse(r.params) : {}, status, error, seriesId: r.series_id,
    createdAt: r.created_at, updatedAt: r.updated_at, data, warnings: status === 'open' ? _warnings(data) : [] };
}

function getProposal(id) {
  return _row(conn().prepare('SELECT * FROM collection_ai_proposals WHERE id = ?').get(id));
}

function listProposals(limit = 20) {
  return conn().prepare("SELECT * FROM collection_ai_proposals WHERE status != 'discarded' ORDER BY id DESC LIMIT ?").all(limit).map(_row);
}

function _seasonName(seasonId) {
  if (seasonId == null) return null;
  const s = conn().prepare('SELECT name FROM seasons WHERE id = ?').get(seasonId);
  if (!s) throw new CollectionAiError(400, `Saison ${seasonId} introuvable.`);
  return s.name;
}

/**
 * Lance une proposition. Les garde-fous (appel en cours, quota, plafond, configuration) sont vérifiés
 * tout de suite ; l'appel texte tourne ensuite en arrière-plan (état `pending`, puis `open` ou `error`).
 * Rend `{ proposal, job }` : les routes n'attendent pas `job`, les tests peuvent l'attendre.
 */
function startProposal({ concept, itemCount = 6, seasonId = null } = {}) {
  const c = _clean(concept, CONCEPT_MAX);
  if (c.length < 3) throw new CollectionAiError(400, 'Décrivez la collection (3 à 800 caractères).');
  const n = Number(itemCount);
  if (!Number.isInteger(n) || n < ITEMS_MIN || n > ITEMS_MAX) throw new CollectionAiError(400, `Nombre d'objets entre ${ITEMS_MIN} et ${ITEMS_MAX}.`);
  const sid = seasonId === null || seasonId === undefined || seasonId === '' ? null : Number(seasonId);
  const seasonName = _seasonName(sid);
  try { blockAi.precheckText(); } catch (err) { throw new CollectionAiError(err.status ?? 503, err.message); }
  const params = { itemCount: n, seasonId: sid };
  const id = conn().prepare('INSERT INTO collection_ai_proposals (concept, params) VALUES (?, ?)').run(c, JSON.stringify(params)).lastInsertRowid;
  const job = (async () => {
    try {
      const out = await blockAi.guardedJson({ kind: 'collection-text', source: 'admin-collections', name: 'dig_collection',
        schema: _schema(), messages: _messages(c, { itemCount: n, seasonName }), fake: k => _fake(k, c, n) });
      const data = _normalize(out.data, { seasonId: sid });
      if (!data.items.length) throw new Error('aucun objet proposé');
      conn().prepare("UPDATE collection_ai_proposals SET status = 'open', data = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(data), id);
    } catch (err) {
      conn().prepare("UPDATE collection_ai_proposals SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?")
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
  if (!p) throw new CollectionAiError(404, 'Proposition introuvable.');
  if (p.status !== 'open') {
    throw new CollectionAiError(409, { pending: 'Proposition en cours de génération.', in_draft: 'Proposition déjà enregistrée dans le brouillon : modifiez la série et les objets dans le catalogue.',
      discarded: 'Proposition abandonnée.', error: 'Proposition en échec : relancez une nouvelle proposition.' }[p.status] ?? 'Proposition indisponible.');
  }
  return p;
}

/** Corrections de l'admin (sans coût) : série, objets (retrait possible), saison. */
function updateProposal(id, input = {}) {
  const p = _open(id);
  const sid = input.series && 'seasonId' in input.series ? input.series.seasonId : p.data.series.seasonId;
  const next = _normalize({ series: { ...p.data.series, ...(input.series ?? {}) }, items: Array.isArray(input.items) ? input.items : p.data.items,
    rationale: p.data.rationale }, { seasonId: sid === '' || sid == null ? null : Number(sid) });
  if (next.series.seasonId != null) _seasonName(next.series.seasonId);
  if (!next.items.length) throw new CollectionAiError(400, 'Gardez au moins un objet.');
  conn().prepare("UPDATE collection_ai_proposals SET data = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(next), id);
  return getProposal(id);
}

/**
 * Enregistre la série et ses objets dans le BROUILLON des collections (jamais publiés ici), drops
 * inactifs ; la consigne d'illustration de chaque objet est reprise par l'atelier d'icônes.
 */
function addToDraft(id) {
  const p = _open(id);
  const { series, items } = p.data;
  const c = catalog.getDraft() ?? catalog.getPublished();
  if (!ID_RE.test(series.id)) throw new CollectionAiError(400, 'Identifiant de série invalide (a-z, 0-9, _).');
  if (c.series.some(s => s.id === series.id)) throw new CollectionAiError(409, `La série « ${series.id} » existe déjà : changez l'identifiant.`);
  const taken = items.filter(i => c.items.some(x => x.id === i.id)).map(i => i.id);
  if (taken.length) throw new CollectionAiError(409, `Identifiant(s) déjà utilisé(s) : ${taken.join(', ')}.`);
  const toSeries = { id: series.id, names: series.names, seasonId: series.seasonId, icon: series.icon, active: true };
  const toItems = items.map(i => ({ id: i.id, seriesId: series.id, names: i.names, stories: i.stories, rarity: i.rarity, icon: i.icon,
    image: null, drop: i.drop, dropEnabled: false, active: true }));
  // Validation complète d'abord (mêmes règles que les fiches manuelles), puis écriture
  catalog.normalizeSeries(toSeries);
  toItems.forEach(catalog.normalizeItem);
  conn().transaction(() => {
    catalog.upsertDraftSeries(toSeries);
    for (const it of toItems) catalog.upsertDraftItem(it);
    conn().prepare("UPDATE collection_ai_proposals SET status = 'in_draft', series_id = ?, updated_at = datetime('now') WHERE id = ?").run(series.id, id);
  })();
  // Consignes d'illustration pour l'atelier (#40) : aucune image générée ici
  const studio = require('./iconStudio');
  for (const i of items) {
    if (!i.image?.subject) continue;
    try { studio.setBrief(`item:${i.id}`, i.image); } catch (err) { console.warn('[collectionAi] consigne atelier', i.id, err.message); }
  }
  return { proposal: getProposal(id), series: toSeries, items: toItems.map(i => i.id) };
}

function discardProposal(id) {
  const p = getProposal(id);
  if (!p) throw new CollectionAiError(404, 'Proposition introuvable.');
  if (p.status === 'pending') throw new CollectionAiError(409, 'Proposition en cours de génération : patientez.');
  conn().prepare("UPDATE collection_ai_proposals SET status = 'discarded', updated_at = datetime('now') WHERE id = ?").run(id);
}

function waitJob(id) { return _jobs.get(id) ?? Promise.resolve(); }

module.exports = {
  CollectionAiError, DEFAULT_DROPS, ITEMS_MIN, ITEMS_MAX, init, startProposal, getProposal, listProposals,
  updateProposal, addToDraft, discardProposal, waitJob,
};
