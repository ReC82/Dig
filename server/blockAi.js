/**
 * server/blockAi.js — Création de blocs assistée par IA dans le panel admin (#37, décision du
 * propriétaire du 30/10/2026).
 *
 * Pipeline : concept saisi par l'admin → proposition IA (noms localisés, catégorie, paramètres,
 * icône générée dans la direction artistique validée #22) → corrections manuelles par langue,
 * régénérations ciblées (noms seuls, image seule, tout le texte) → « Ajouter au brouillon » du
 * catalogue → simulation → publication par l'admin (blockCatalog). Rien n'est jamais publié
 * automatiquement : une proposition n'entre dans le jeu qu'après la publication du brouillon.
 *
 * Infrastructure réutilisée (#22) : configuration ~/.config/dig/openai.env (DIG_OPENAI_CONFIG),
 * clé lue sur place par tools/icons/openai-images.js (jamais exposée au navigateur ni journalisée),
 * plafond de dépense et journal partagés avec l'outil d'icônes, prompt maître
 * tools/icons/prompt-master.md + référence art/icons/v1/reference/*.png, traitement process.js.
 * Le texte utilise l'API Chat Completions (modèle DIG_TEXT_MODEL de la configuration).
 *
 * Données : propositions, images (WebP 256 px, servies sous /media/blocks/<sha>.webp — stockées
 * dans la base : sauvegardées avec elle, URL persistante) et journal d'appels (modèle, durée,
 * usage, coût estimé, erreur sans secret), ces deux derniers en ajout seul.
 */

'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const db = require('./db');
const catalog = require('./blockCatalog');

const ROOT = path.join(__dirname, '..');
const API = 'https://api.openai.com/v1';
const LANGS = catalog.LANGS;
const LANG_LABELS = { fr: 'French', en: 'English', nl: 'Dutch', es: 'Spanish', de: 'German' };
const MAX_CALLS_PER_DAY = 40;
const CONCEPT_MAX = 500;
const IMAGE_URL_RE = /^\/media\/blocks\/([a-f0-9]{16})\.webp$/;

class AiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const conn = () => db.getDb();

// ── Schéma (ajout seul pour images et appels) ─────────────────────────────────

function init() {
  conn().exec(`
    CREATE TABLE IF NOT EXISTS block_ai_proposals (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      concept     TEXT    NOT NULL,
      status      TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_draft', 'discarded')),
      data        TEXT    NOT NULL,
      image_sha   TEXT,
      block_id    TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS block_ai_images (
      sha         TEXT    PRIMARY KEY,
      mime        TEXT    NOT NULL,
      bytes       BLOB    NOT NULL,
      proposal_id INTEGER,
      meta        TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS block_ai_calls (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      proposal_id INTEGER,
      kind        TEXT    NOT NULL,
      model       TEXT,
      ok          INTEGER NOT NULL,
      error       TEXT,
      cost_usd    REAL    NOT NULL DEFAULT 0,
      cost_basis  TEXT,
      duration_ms INTEGER,
      usage       TEXT
    );
    CREATE TRIGGER IF NOT EXISTS trg_block_ai_images_no_update BEFORE UPDATE ON block_ai_images
      BEGIN SELECT RAISE(ABORT, 'block_ai_images est en ajout seul (#37)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_block_ai_images_no_delete BEFORE DELETE ON block_ai_images
      BEGIN SELECT RAISE(ABORT, 'block_ai_images est en ajout seul (#37)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_block_ai_calls_no_update BEFORE UPDATE ON block_ai_calls
      BEGIN SELECT RAISE(ABORT, 'block_ai_calls est en ajout seul (#37)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_block_ai_calls_no_delete BEFORE DELETE ON block_ai_calls
      BEGIN SELECT RAISE(ABORT, 'block_ai_calls est en ajout seul (#37)'); END;
  `);
}

// ── Configuration et transport ────────────────────────────────────────────────

let _oa = null;
const oa = () => (_oa ??= require('../tools/icons/openai-images'));

/** Transport de test (DIG_AI_FAKE=1 hors production, ou injecté par les tests unitaires). */
let _fake = null;
function setFakeTransport(fake) { _fake = fake; }
if (process.env.DIG_AI_FAKE === '1' && process.env.NODE_ENV !== 'production') {
  _fake = {
    text: async ({ kind, concept }) => ({ data: fakeText(kind, concept), usage: { prompt_tokens: 900, completion_tokens: 300 } }),
    image: async () => ({ png: fakePng(), usage: null }),
  };
}

function fakeText(kind, concept) {
  const names = { fr: 'Basalte lunaire', en: 'Lunar basalt', nl: 'Maanbasalt' };
  if (kind === 'names') return { names };
  return {
    names, idSuggestion: 'basalte_lunaire', category: 'pierre', rarity: 'rare', icon: '🌑',
    color1: '#334155', color2: '#0f172a', accent: '#94a3b8', hpBase: 140, reward: 600, minDepth: 450, weight: 4,
    rationale: `Proposition de test pour « ${String(concept).slice(0, 40)} ».`,
    image: { subject: 'A chunk of lunar basalt', details: 'Grey porous rock with tiny silver specks.', palette: 'Palette: slate grey, silver.' },
  };
}

function fakePng() {
  // PNG 1×1 transparent : suffisant pour les tests (le traitement est simulé avec le transport factice)
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
}

/** Configuration (sans aucune valeur secrète) : modèles, plafond, tarifs. Lève si absente. */
function config() {
  if (_fake) {
    return { fake: true, model: 'fake-image', textModel: 'fake-text', budgetUsd: 1, estCostUsd: 0.01, textEstCostUsd: 0.001, textPrices: { input: 0, output: 0 } };
  }
  const cfg = oa().loadConfig();
  const raw = oa().parseEnvFile(oa().CONFIG_FILE);
  const num = (k, d) => (raw[k] === undefined || raw[k] === '' ? d : Number(raw[k]));
  return {
    ...cfg,
    textModel: raw.DIG_TEXT_MODEL || 'gpt-5-mini',
    textEstCostUsd: num('DIG_TEXT_EST_COST_USD', 0.01),
    textPrices: { input: num('DIG_TEXT_PRICE_INPUT_PER_M', 0.25), output: num('DIG_TEXT_PRICE_OUTPUT_PER_M', 2) },
  };
}

function _spent() {
  if (_fake) return conn().prepare('SELECT COALESCE(SUM(cost_usd), 0) s FROM block_ai_calls').get().s;
  return oa().spentUsd(oa().readLedger());
}

/** État affiché dans le panel : configurée ou non (raison), modèles, budget restant. Jamais de secret. */
function status() {
  try {
    const cfg = config();
    if (!cfg.fake) {
      if (!cfg.keyFile) throw new Error('DIG_OPENAI_KEY_FILE absent de la configuration');
      if (!fs.existsSync(cfg.keyFile)) throw new Error('fichier de clé introuvable');
    }
    const spent = _spent();
    return {
      configured: true, fake: !!cfg.fake, imageModel: cfg.editModel || cfg.model, textModel: cfg.textModel,
      budgetUsd: cfg.budgetUsd, spentUsd: Number(spent.toFixed(4)), remainingUsd: Number((cfg.budgetUsd - spent).toFixed(4)),
      estImageUsd: cfg.estCostUsd, estTextUsd: cfg.textEstCostUsd, imageProcessing: _sharpAvailable(),
      callsToday: _callsToday(), maxCallsPerDay: MAX_CALLS_PER_DAY,
    };
  } catch (err) {
    return { configured: false, reason: oa().redact(err.message.replace(os.homedir(), '~')) };
  }
}

function _sharpAvailable() {
  try { require.resolve('sharp'); return true; } catch (_) { return false; }
}

function _callsToday() {
  return conn().prepare("SELECT COUNT(*) n FROM block_ai_calls WHERE created_at >= datetime('now', '-1 day')").get().n;
}

/** Garde-fous avant tout appel payant : un seul appel à la fois, quota journalier, plafond. */
let _busy = false;
async function _guarded(kind, proposalId, estUsd, fn) {
  if (_busy) throw new AiError(429, 'Une génération est déjà en cours : patientez.');
  if (_callsToday() >= MAX_CALLS_PER_DAY) throw new AiError(429, `Quota atteint : ${MAX_CALLS_PER_DAY} appels IA par 24 h.`);
  let cfg;
  try { cfg = config(); } catch (err) { throw new AiError(503, `API IA non configurée : ${oa().redact(err.message.replace(os.homedir(), '~'))}`); }
  const spent = _spent();
  if (spent + estUsd > cfg.budgetUsd + 1e-9) {
    throw new AiError(402, `Plafond de dépense IA atteint (${spent.toFixed(2)} / ${cfg.budgetUsd} USD) : relever DIG_IMAGE_BUDGET_USD dans la configuration.`);
  }
  _busy = true;
  const started = Date.now();
  try {
    const out = await fn(cfg);
    _logCall({ proposalId, kind, model: out.model, ok: true, cost: out.cost, durationMs: Date.now() - started, usage: out.usage });
    return out;
  } catch (err) {
    const msg = oa().redact(String(err.message || err)).slice(0, 300);
    _logCall({ proposalId, kind, model: kind === 'image' ? (cfg.editModel || cfg.model) : cfg.textModel, ok: false, error: msg,
      cost: { cost_usd: 0, basis: 'échec' }, durationMs: Date.now() - started });
    if (err instanceof AiError) throw err;
    throw new AiError(502, `Échec de l'appel IA (${kind}) : ${msg}`);
  } finally {
    _busy = false;
  }
}

function _logCall({ proposalId, kind, model, ok, error = null, cost, durationMs, usage = null }) {
  conn().prepare(`INSERT INTO block_ai_calls (proposal_id, kind, model, ok, error, cost_usd, cost_basis, duration_ms, usage)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(proposalId ?? null, kind, model ?? null, ok ? 1 : 0, error, cost.cost_usd, cost.basis, durationMs,
    usage ? JSON.stringify(usage) : null);
  // Journal partagé avec l'outil d'icônes (#22) : le plafond couvre aussi les appels du panel
  if (!_fake) {
    oa().appendLedger({ at: new Date().toISOString(), source: 'admin-blocks', kind, proposal: proposalId ?? null, model, ok,
      error: error ?? undefined, cost_usd: cost.cost_usd, cost_basis: cost.basis, duration_ms: durationMs, usage: usage ?? undefined });
  }
}

// ── Texte : noms localisés et paramètres ──────────────────────────────────────

function _textSchema(kind) {
  const names = { type: 'object', additionalProperties: false, required: LANGS, properties: Object.fromEntries(LANGS.map(l => [l, { type: 'string' }])) };
  if (kind === 'names') return { type: 'object', additionalProperties: false, required: ['names'], properties: { names } };
  const str = { type: 'string' }, int = { type: 'integer' };
  return {
    type: 'object', additionalProperties: false,
    required: ['names', 'idSuggestion', 'category', 'rarity', 'icon', 'color1', 'color2', 'accent', 'hpBase', 'reward', 'minDepth', 'weight', 'rationale', 'image'],
    properties: {
      names, idSuggestion: str, category: { type: 'string', enum: catalog.CATEGORIES }, rarity: { type: 'string', enum: catalog.RARITIES },
      icon: str, color1: str, color2: str, accent: str, hpBase: int, reward: int, minDepth: int, weight: { type: 'number' }, rationale: str,
      image: { type: 'object', additionalProperties: false, required: ['subject', 'details', 'palette'], properties: { subject: str, details: str, palette: str } },
    },
  };
}

function _catalogSummary() {
  return catalog.getPublished().types.filter(t => t.active).map(t =>
    `${t.id} (${t.names?.fr ?? t.id}) : ${t.category}/${t.rarity}, dès ${t.minDepth} m, PV ${t.hpBase}, récompense ${t.reward}, poids ${t.weight}`).join('\n');
}

function _textMessages(kind, concept, current) {
  const langs = LANGS.map(l => `${l} (${LANG_LABELS[l] ?? l})`).join(', ');
  const system = [
    'You design content for DIG!, an idle clicker mining game: the player digs down block after block; deeper blocks have more HP and give more coins.',
    `Return ONLY the JSON object requested. Names: short (max 30 chars), natural and idiomatic in each language: ${langs}.`,
    'Each name must be a genuine native translation used by native speakers (e.g. mining/mineralogy terminology), never the French word copied unless that is truly the correct term in that language. Keep terminology consistent with the existing catalogue (e.g. "Minerai de X" / "X ore" / "X-erts").',
  ];
  if (kind === 'names') {
    return [{ role: 'system', content: system.join('\n') },
      { role: 'user', content: `Block concept: ${concept}\nCurrent French name: ${current?.names?.fr ?? '(none)'}\nPropose names in ${langs}.` }];
  }
  system.push(
    'Balance rules: HP and reward are BASE values (the game multiplies HP by 1+0.12×(depth−1) and reward by 1+0.05×(depth−1)).',
    'Stay consistent with blocks of similar depth and rarity in the catalogue below; rarer = lower weight and higher reward; never more than 2x the HP or reward of the closest comparable block.',
    'minDepth ≥ 1 (no maximum depth exists). weight > 0 (typical 0.5 to 20). category must fit the concept; "coffre" for chests, "gemme" for gems.',
    'icon: one emoji. color1/color2: dark-to-darker hex colours for the block background; accent: lighter hex border colour.',
    'idSuggestion: lowercase ascii snake_case from the French name (2-40 chars, starts with a letter).',
    'rationale: 1-2 sentences in French explaining the balance choice.',
    'image: English art direction for a single isolated object icon (subject, details of shape/material, palette sentence starting with "Palette:").',
    `Existing catalogue:\n${_catalogSummary()}`,
  );
  return [{ role: 'system', content: system.join('\n') }, { role: 'user', content: `Block concept from the game admin: ${concept}` }];
}

async function _callText(cfg, kind, concept, current) {
  if (_fake) {
    const r = await _fake.text({ kind, concept, current });
    return { data: r.data, usage: r.usage, model: 'fake-text', cost: { cost_usd: 0.001, basis: 'test' } };
  }
  const body = {
    model: cfg.textModel,
    messages: _textMessages(kind, concept, current),
    response_format: { type: 'json_schema', json_schema: { name: `dig_block_${kind}`, strict: true, schema: _textSchema(kind) } },
  };
  const key = oa().loadKey(cfg);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  let res;
  try {
    res = await fetch(`${API}/chat/completions`, { method: 'POST', signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } finally { clearTimeout(timer); }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* réponse non JSON */ }
  if (!res.ok) {
    const e = json?.error || {};
    throw new Error(`OpenAI ${res.status} ${e.type || ''} ${e.code || ''} : ${oa().redact(String(e.message || text).slice(0, 300), key)}`);
  }
  const content = json?.choices?.[0]?.message?.content;
  let data;
  try { data = JSON.parse(content); } catch (_) { throw new Error('réponse texte non JSON'); }
  const u = json.usage || {};
  const cost = u.prompt_tokens != null
    ? { cost_usd: Number(((u.prompt_tokens * cfg.textPrices.input + (u.completion_tokens ?? 0) * cfg.textPrices.output) / 1e6).toFixed(5)), basis: 'usage API × tarifs configurés (estimation)' }
    : { cost_usd: cfg.textEstCostUsd, basis: 'forfait (usage absent)' };
  return { data, usage: { prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens }, model: json.model || cfg.textModel, cost };
}

const _clean = (v, max) => String(v ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, max);
const _hex = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(String(v)) ? String(v).toLowerCase() : d);
const _clampInt = (v, min, max, d) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : d);

function _names(raw) {
  const names = {};
  for (const l of LANGS) names[l] = _clean(raw?.[l], 40);
  return names;
}

/** Avertissements de traduction : langue vide ou recopie du français (à vérifier par l'admin). */
function nameWarnings(names) {
  const w = [];
  for (const l of LANGS) {
    if (!names?.[l]) w.push(`Nom ${l.toUpperCase()} manquant.`);
    else if (l !== 'fr' && names.fr && names[l].toLowerCase() === names.fr.toLowerCase()) w.push(`Nom ${l.toUpperCase()} identique au français : à vérifier.`);
  }
  return w;
}

function _slug(s) {
  const id = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return /^[a-z][a-z0-9_]{1,39}$/.test(id) ? id : null;
}

/** Normalise la proposition texte de l'IA (données, jamais instructions) en champs de bloc. */
function _fromText(d) {
  const icon = [...String(d.icon ?? '')].slice(0, 2).join('').replace(/[<>&"'\s]/g, '') || '⬜';
  const c1 = _hex(d.color1, '#4b5563'), c2 = _hex(d.color2, '#1f2937');
  return {
    names: _names(d.names),
    idSuggestion: _slug(d.idSuggestion) || _slug(d.names?.fr) || 'nouveau_bloc',
    category: catalog.CATEGORIES.includes(d.category) ? d.category : 'minerai',
    rarity: catalog.RARITIES.includes(d.rarity) ? d.rarity : 'rare',
    icon,
    color: `linear-gradient(145deg,${c1},${c2})`,
    accent: _hex(d.accent, '#9ca3af'),
    hpBase: _clampInt(d.hpBase, 1, 1e6, 50),
    reward: _clampInt(d.reward, 0, 1e9, 50),
    minDepth: _clampInt(d.minDepth, 1, 1e6, 100),
    weight: Math.min(1e6, Math.max(0.001, Math.round((Number(d.weight) || 1) * 1000) / 1000)),
    rationale: _clean(d.rationale, 400),
    art: { subject: _clean(d.image?.subject, 200), details: _clean(d.image?.details, 400), palette: _clean(d.image?.palette, 200) },
  };
}

// ── Image ─────────────────────────────────────────────────────────────────────

function _imagePrompt(art, concept) {
  const master = fs.readFileSync(path.join(ROOT, 'tools', 'icons', 'prompt-master.md'), 'utf8');
  const between = tag => master.match(new RegExp(`<!-- ${tag} -->\\n([\\s\\S]*?)\\n<!-- /${tag} -->`))[1].trim();
  return between('PROMPT')
    .replace('{{SUBJECT}}', art.subject || concept)
    .replace('{{DETAILS}}', art.details || '')
    .replace('{{PALETTE}}', art.palette || '')
    .replace('{{REFERENCE}}', ` ${between('REFERENCE')}`);
}

function _reference() {
  const dir = path.join(ROOT, 'art', 'icons', 'v1', 'reference');
  const refs = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort() : [];
  return refs.length ? path.join(dir, refs[0]) : null;
}

async function _callImage(cfg, prompt) {
  if (_fake) {
    const r = await _fake.image({ prompt });
    return { webp: r.webp ?? r.png, mime: r.webp ? 'image/webp' : 'image/png', meta: { fake: true }, usage: null, model: 'fake-image', cost: { cost_usd: 0.01, basis: 'test' } };
  }
  if (!_sharpAvailable()) throw new AiError(503, 'Traitement d\'image indisponible (module sharp absent).');
  const req = oa().buildRequest(cfg, { prompt, reference: _reference() });
  const out = await oa().callImages(cfg, req);
  const cost = oa().costFromUsage(cfg, out.usage);
  // Contrôles et normalisation de l'outil d'icônes (#22) : fond transparent, marges, WebP 256 px
  const { processIcon } = require('../tools/icons/process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-block-ai-'));
  try {
    const raw = path.join(tmp, 'brut.png');
    fs.writeFileSync(raw, out.png);
    const done = await processIcon(raw, tmp, 'bloc');
    return { webp: fs.readFileSync(done.files.webp256), mime: 'image/webp', usage: out.usage, model: req.params.model, cost,
      meta: { margins: done.margins, legibility: done.legibility, reference: req.params.reference ?? null } };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function _storeImage(bytes, mime, proposalId, meta) {
  const sha = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  conn().prepare('INSERT OR IGNORE INTO block_ai_images (sha, mime, bytes, proposal_id, meta) VALUES (?, ?, ?, ?, ?)')
    .run(sha, mime, bytes, proposalId, JSON.stringify(meta ?? null));
  return sha;
}

/** Image servie au jeu et au panel (null si inconnue). */
function getImage(sha) {
  return /^[a-f0-9]{16}$/.test(sha) ? conn().prepare('SELECT mime, bytes FROM block_ai_images WHERE sha = ?').get(sha) ?? null : null;
}

const imageUrl = sha => (sha ? `/media/blocks/${sha}.webp` : null);

// ── Propositions ──────────────────────────────────────────────────────────────

function _row(r) {
  if (!r) return null;
  const data = JSON.parse(r.data);
  return { id: r.id, concept: r.concept, status: r.status, blockId: r.block_id, image: imageUrl(r.image_sha),
    createdAt: r.created_at, updatedAt: r.updated_at, ...data, warnings: nameWarnings(data.names) };
}

function getProposal(id) {
  return _row(conn().prepare('SELECT * FROM block_ai_proposals WHERE id = ?').get(id));
}

function listProposals(limit = 30) {
  return conn().prepare("SELECT * FROM block_ai_proposals WHERE status != 'discarded' ORDER BY id DESC LIMIT ?").all(limit).map(_row);
}

function _save(id, data, imageSha) {
  const { warnings, id: _i, concept, status: _s, blockId, image, createdAt, updatedAt, ...rest } = data;
  conn().prepare("UPDATE block_ai_proposals SET data = ?, image_sha = COALESCE(?, image_sha), updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(rest), imageSha ?? null, id);
}

function _open(id) {
  const p = getProposal(id);
  if (!p) throw new AiError(404, 'Proposition introuvable.');
  if (p.status === 'discarded') throw new AiError(409, 'Proposition abandonnée.');
  return p;
}

/** Nouvelle proposition : texte (noms + paramètres) puis, si demandé, image. */
async function createProposal({ concept, withImage = true } = {}) {
  const c = _clean(concept, CONCEPT_MAX);
  if (c.length < 3) throw new AiError(400, 'Décrivez le bloc (3 à 500 caractères).');
  const cfgEst = (() => { try { return config(); } catch (_) { return { textEstCostUsd: 0.01 }; } })();
  const id = conn().prepare('INSERT INTO block_ai_proposals (concept, data) VALUES (?, ?)').run(c, JSON.stringify({ pending: true })).lastInsertRowid;
  try {
    const t = await _guarded('text', id, cfgEst.textEstCostUsd, cfg => _callText(cfg, 'full', c));
    _save(id, _fromText(t.data));
  } catch (err) {
    conn().prepare("UPDATE block_ai_proposals SET status = 'discarded', updated_at = datetime('now') WHERE id = ?").run(id);
    throw err;
  }
  if (withImage) {
    try { await regenerate(id, 'image'); } catch (err) { return { ...getProposal(id), imageError: err.message }; }
  }
  return getProposal(id);
}

/** Régénération ciblée : `names` (noms/traductions seuls), `text` (noms + paramètres), `image`. */
async function regenerate(id, what) {
  const p = _open(id);
  if (p.status !== 'open') throw new AiError(409, 'Proposition déjà ajoutée au brouillon : modifiez le bloc dans le catalogue.');
  if (!['names', 'text', 'image'].includes(what)) throw new AiError(400, 'Régénération : names, text ou image.');
  const cfgEst = (() => { try { return config(); } catch (_) { return { textEstCostUsd: 0.01, estCostUsd: 0.25 }; } })();
  if (what === 'image') {
    const img = await _guarded('image', id, cfgEst.estCostUsd, cfg => _callImage(cfg, _imagePrompt(p.art ?? {}, p.concept)));
    const sha = _storeImage(img.webp, img.mime, id, img.meta);
    _save(id, { ...p, imageMeta: img.meta }, sha);
  } else {
    const t = await _guarded('text', id, cfgEst.textEstCostUsd, cfg => _callText(cfg, what === 'names' ? 'names' : 'full', p.concept, p));
    const next = what === 'names' ? { ...p, names: _names(t.data.names) } : { ...p, ..._fromText(t.data) };
    _save(id, next);
  }
  return getProposal(id);
}

/** Corrections manuelles (indépendantes par langue) et paramètres. Ne coûte rien. */
function updateProposal(id, input = {}) {
  const p = _open(id);
  if (p.status !== 'open') throw new AiError(409, 'Proposition déjà ajoutée au brouillon : modifiez le bloc dans le catalogue.');
  const next = { ...p };
  if (input.names && typeof input.names === 'object') {
    next.names = { ...p.names };
    for (const l of LANGS) if (input.names[l] !== undefined) next.names[l] = _clean(input.names[l], 40);
  }
  for (const k of ['category', 'rarity', 'icon', 'color', 'accent', 'idSuggestion']) if (input[k] !== undefined) next[k] = _clean(input[k], 120);
  for (const k of ['hpBase', 'reward', 'minDepth', 'weight']) if (input[k] !== undefined) next[k] = Number(input[k]);
  // Validation complète par le catalogue (même règles que le formulaire manuel)
  catalog.normalizeType(_toType(next, next.idSuggestion));
  _save(id, next);
  return getProposal(id);
}

function _toType(p, blockId) {
  return { id: blockId, names: p.names, category: p.category, icon: p.icon, image: imageUrl(conn().prepare('SELECT image_sha FROM block_ai_proposals WHERE id = ?').get(p.id)?.image_sha),
    rarity: p.rarity, color: p.color, accent: p.accent, hpBase: p.hpBase, reward: p.reward, minDepth: p.minDepth, maxDepth: null, weight: p.weight,
    active: true, ...(p.category === 'gemme' ? { gemReward: false } : {}) };
}

/**
 * Impact avant ajout : catalogue en vigueur comparé au catalogue + proposition, aux profondeurs
 * clés (probabilité du nouveau bloc, PV et récompense moyens). Théorique, sans tirage.
 */
function impact(id) {
  const p = _open(id);
  const base = catalog.getPublished().types;
  const t = catalog.normalizeType(_toType(p, p.idSuggestion));
  const withIt = [...base.filter(x => x.id !== t.id), t];
  const depths = [...new Set([t.minDepth, t.minDepth + 50, t.minDepth + 200, Math.max(t.minDepth * 2, t.minDepth + 400)])];
  const sim = types => catalog.simulate(types, { depths, n: 10000 });
  const a = sim(base), b = sim(withIt);
  return depths.map((depth, i) => ({
    depth,
    share: b[i].types.find(x => x.id === t.id)?.p ?? 0,
    avgHp: [a[i].avgHp, b[i].avgHp],
    avgReward: [a[i].avgReward, b[i].avgReward],
  }));
}

/** Ajoute la proposition au BROUILLON du catalogue (jamais publiée ici). */
function addToDraft(id, { blockId } = {}) {
  const p = _open(id);
  if (p.status !== 'open') throw new AiError(409, 'Proposition déjà ajoutée au brouillon.');
  const bid = _slug(blockId || p.idSuggestion);
  if (!bid) throw new AiError(400, 'Identifiant technique invalide (a-z, 0-9, _).');
  const existing = new Set([...(catalog.getDraft()?.types ?? catalog.getPublished().types).map(t => t.id), ...catalog.publishedIds()]);
  if (existing.has(bid)) throw new AiError(409, `L'identifiant « ${bid} » existe déjà : choisissez-en un autre.`);
  const missing = LANGS.filter(l => !p.names?.[l]);
  if (missing.length) throw new AiError(400, `Noms manquants : ${missing.join(', ').toUpperCase()}.`);
  const type = catalog.upsertDraftType(_toType(p, bid));
  conn().prepare("UPDATE block_ai_proposals SET status = 'in_draft', block_id = ?, updated_at = datetime('now') WHERE id = ?").run(bid, id);
  return { type, proposal: getProposal(id) };
}

function discardProposal(id) {
  _open(id);
  conn().prepare("UPDATE block_ai_proposals SET status = 'discarded', updated_at = datetime('now') WHERE id = ?").run(id);
}

function listCalls(limit = 50) {
  return conn().prepare('SELECT id, created_at, proposal_id, kind, model, ok, error, cost_usd, cost_basis, duration_ms FROM block_ai_calls ORDER BY id DESC LIMIT ?')
    .all(limit).map(c => ({ ...c, ok: !!c.ok }));
}

module.exports = {
  AiError, IMAGE_URL_RE, init, status, setFakeTransport, createProposal, regenerate, updateProposal, addToDraft,
  discardProposal, getProposal, listProposals, listCalls, impact, getImage, nameWarnings,
};
