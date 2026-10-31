/**
 * server/iconStudio.js — Atelier d'icônes IA du panel admin (#40).
 *
 * Une seule interface pour TOUTES les icônes du jeu : blocs (minerais, pierres, coffres, gemmes —
 * catalogue #37), objets de collection et reliques (#39) et pictogrammes d'interface (profil,
 * paramètres, navigation — application en jeu avec #41). Badges : à brancher quand #38 existera.
 *
 * Cycle d'une icône :
 *   brief (sujet/détails/palette, modifiable) → génération IA d'UNE image par action (consigne
 *   facultative, « Refaire » = nouvelle proposition, l'ancienne est conservée ; refonte UX du
 *   31/10 : plus de lots ni de variantes multiples) ou téléversement manuel → contrôles (vrai alpha, marges 12 %, recadrage, lisibilité sur fond
 *   sombre : tools/icons/process.js) → aperçu taille réelle → « Appliquer au brouillon » du
 *   catalogue concerné → publication par l'admin dans l'onglet Blocs / Collections (recette).
 *   Rien n'est jamais publié ici ; le jeu ne change qu'à la publication du brouillon.
 *
 * Garde-fous :
 *   - icône VALIDÉE (bibliothèque v1 #22 ou validée dans l'atelier) : jamais remplacée sans
 *     confirmation explicite (`override`), tracée ;
 *   - clé API uniquement côté serveur (infrastructure #22 : ~/.config/dig/openai.env, clé lue sur
 *     place, jamais renvoyée ni journalisée) ; erreurs masquées ;
 *   - une génération à la fois, quota d'images par 24 h, double plafond de dépense : plafond global
 *     de la configuration (journal partagé ~/.local/state/dig-icons/ledger.jsonl) ET plafond propre
 *     à l'atelier, réglable dans ⚙ Config → Budget IA (jamais au-delà du global, jamais relevé automatiquement) ;
 *   - stockage dans la base (sauvegardée avec elle), en ajout seul : images (WebP 256, URL
 *     immuable /media/icons/<sha>.webp), provenance (prompt, modèle, référence, contrôles, coût),
 *     historique des actions (génération, téléversement, choix, application, retour, validation).
 *   Retour arrière : réappliquer une icône précédente de l'historique (ou l'emoji d'origine), ou
 *   « Revenir à vN » dans le catalogue.
 */

'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const db = require('./db');
const blockCatalog = require('./blockCatalog');
const collectionCatalog = require('./collectionCatalog');

const ROOT = path.join(__dirname, '..');
const MAX_IMAGES_PER_DAY = 40;
const INSTRUCTION_MAX = 300;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const SHA_RE = /^[a-f0-9]{16}$/;
const KEY_RE = /^(block|item|ui):([a-z][a-z0-9_]{1,39})$/;

/** Pictogrammes d'interface (#41 pour l'application en jeu). Profil ≠ paramètres ≠ améliorations. */
const UI_TARGETS = [
  { id: 'profil', emoji: '👤', name: 'Profil / compte', subject: 'A friendly miner\'s portrait bust silhouette wearing a mining helmet with a small lamp', details: 'Head and shoulders only, clearly a PERSON (profile/account), never a gear or tool.', palette: 'Palette: warm amber helmet, slate-blue clothing, soft skin tone.' },
  { id: 'parametres', emoji: '⚙', name: 'Paramètres', subject: 'A single settings gear combined with two small slider knobs', details: 'One cog wheel with six chunky teeth and two short horizontal slider bars in front: clearly SETTINGS, distinct from the profile portrait and from the upgrades pickaxe.', palette: 'Palette: cool steel gray with a teal accent on the slider knobs.' },
  { id: 'ameliorations', emoji: '⚙', name: 'Améliorations', subject: 'A pickaxe with a glowing upward arrow', details: 'Short sturdy pickaxe crossed by a bold upward arrow meaning UPGRADE; must not look like a gear.', palette: 'Palette: wooden handle, steel head, bright golden arrow.' },
  { id: 'creuser', emoji: '⛏', name: 'Creuser', subject: 'A single sturdy pickaxe', details: 'Classic miner\'s pickaxe, diagonal, chunky steel head and wooden handle.', palette: 'Palette: steel gray head, warm brown handle.' },
  { id: 'collection', emoji: '📦', name: 'Collection', subject: 'A small open treasure crate showing a few collectible relics', details: 'Wooden crate, lid open, a fossil bone and a blue crystal peeking out.', palette: 'Palette: warm wood, hints of blue and bone white.' },
  { id: 'quotidien', emoji: '📅', name: 'Récompense quotidienne', subject: 'A small calendar page with a gift ribbon', details: 'Single calendar sheet with a check mark and a red ribbon bow.', palette: 'Palette: off-white page, red ribbon, gold check.' },
  { id: 'boutique', emoji: '🛒', name: 'Boutique', subject: 'A small mine cart full of gold coins', details: 'Rail mine cart seen in three-quarter view, heaped with coins.', palette: 'Palette: dark iron cart, shiny gold coins.' },
  { id: 'logo', emoji: '⛏', name: 'Logo DIG! — emblème compact', subject: 'A compact square emblem for the DIG! mining game: a chunky faceted stone block with a golden pickaxe planted in its top', details: 'Badge-like square emblem that stays readable at 32 to 40 pixels in a phone header, placed just before the word DIG!; no text, no letters, no ribbon, no wide shape.', palette: 'Palette: cool stone gray block like the reference stone, bright gold pickaxe head, warm wooden handle.' },
  { id: 'saison', emoji: '🏆', name: 'Saison / classement', subject: 'A golden trophy cup', details: 'Two-handled cup on a short base, faceted gold.', palette: 'Palette: rich gold with warm highlights.' },
];

const KIND_LABELS = { block: 'Bloc', item: 'Objet / relique', ui: 'Interface' };

class StudioError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

const conn = () => db.getDb();

// ── Schéma (ajout seul pour images, appels et historique) ─────────────────────

function init() {
  conn().exec(`
    CREATE TABLE IF NOT EXISTS icon_studio_assets (
      sha         TEXT    PRIMARY KEY,
      target      TEXT    NOT NULL,
      source      TEXT    NOT NULL CHECK (source IN ('ai', 'upload')),
      mime        TEXT    NOT NULL,
      bytes       BLOB    NOT NULL,
      meta        TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_icon_studio_assets_target ON icon_studio_assets(target);
    CREATE TABLE IF NOT EXISTS icon_studio_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      target      TEXT    NOT NULL,
      action      TEXT    NOT NULL,
      asset_sha   TEXT,
      details     TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_icon_studio_events_target ON icon_studio_events(target);
    CREATE TABLE IF NOT EXISTS icon_studio_calls (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      target      TEXT    NOT NULL,
      model       TEXT,
      ok          INTEGER NOT NULL,
      error       TEXT,
      cost_usd    REAL    NOT NULL DEFAULT 0,
      cost_basis  TEXT,
      duration_ms INTEGER,
      usage       TEXT
    );
    CREATE TABLE IF NOT EXISTS icon_studio_briefs (
      target      TEXT    PRIMARY KEY,
      subject     TEXT    NOT NULL,
      details     TEXT    NOT NULL,
      palette     TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS icon_studio_settings (
      key         TEXT    PRIMARY KEY,
      value       TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TRIGGER IF NOT EXISTS trg_icon_studio_assets_no_update BEFORE UPDATE ON icon_studio_assets
      BEGIN SELECT RAISE(ABORT, 'icon_studio_assets est en ajout seul (#40)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_icon_studio_assets_no_delete BEFORE DELETE ON icon_studio_assets
      BEGIN SELECT RAISE(ABORT, 'icon_studio_assets est en ajout seul (#40)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_icon_studio_events_no_update BEFORE UPDATE ON icon_studio_events
      BEGIN SELECT RAISE(ABORT, 'icon_studio_events est en ajout seul (#40)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_icon_studio_events_no_delete BEFORE DELETE ON icon_studio_events
      BEGIN SELECT RAISE(ABORT, 'icon_studio_events est en ajout seul (#40)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_icon_studio_calls_no_update BEFORE UPDATE ON icon_studio_calls
      BEGIN SELECT RAISE(ABORT, 'icon_studio_calls est en ajout seul (#40)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_icon_studio_calls_no_delete BEFORE DELETE ON icon_studio_calls
      BEGIN SELECT RAISE(ABORT, 'icon_studio_calls est en ajout seul (#40)'); END;
  `);
}

// ── Configuration, transport, budget ──────────────────────────────────────────

let _oa = null;
const oa = () => (_oa ??= require('../tools/icons/openai-images'));

/** Transport de test : { image: async ({ prompt, target }) => ({ png, usage }) }. Aucune dépense. */
let _fake = null;
function setFakeTransport(fake) { _fake = fake; }
if (process.env.DIG_AI_FAKE === '1' && process.env.NODE_ENV !== 'production') {
  _fake = { image: async () => ({ png: await fakeIconPng(), usage: null }) };
}

/** PNG RGBA 1024 « plausible » (disque anti-crénelé sur fond transparent) : passe les contrôles. */
async function fakeIconPng(hue = Math.floor(Math.random() * 360)) {
  const sharp = require('sharp');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><defs><radialGradient id="g" cx="40%" cy="35%" r="70%">
    <stop offset="0" stop-color="hsl(${hue},70%,75%)"/><stop offset="1" stop-color="hsl(${hue},60%,30%)"/></radialGradient></defs>
    <polygon points="512,150 820,330 860,640 560,880 230,760 170,420" fill="url(#g)"/></svg>`;
  return sharp(Buffer.from(svg)).ensureAlpha().png().toBuffer();
}

function config() {
  if (_fake) return { fake: true, model: 'fake-image', editModel: '', budgetUsd: 1, estCostUsd: 0.01 };
  return oa().loadConfig();
}

function _sharpAvailable() {
  try { require.resolve('sharp'); return true; } catch (_) { return false; }
}

const _setting = key => conn().prepare('SELECT value FROM icon_studio_settings WHERE key = ?').get(key)?.value ?? null;

function _studioSpent() {
  return conn().prepare('SELECT COALESCE(SUM(cost_usd), 0) s FROM icon_studio_calls').get().s;
}

function _globalSpent() {
  if (_fake) {
    const other = (() => { try { return conn().prepare('SELECT COALESCE(SUM(cost_usd), 0) s FROM block_ai_calls').get().s; } catch (_) { return 0; } })();
    return _studioSpent() + other;
  }
  return oa().spentUsd(oa().readLedger());
}

function _imagesToday() {
  return conn().prepare("SELECT COUNT(*) n FROM icon_studio_calls WHERE created_at >= datetime('now', '-1 day')").get().n;
}

/** Budgets : global (configuration, partagé #22/#37) et propre à l'atelier (panel). Jamais de secret. */
function budget(cfg = config()) {
  const studioCap = _setting('studio_budget_usd');
  const globalSpent = _globalSpent(), studioSpent = _studioSpent();
  const globalRemaining = cfg.budgetUsd - globalSpent;
  const studioRemaining = studioCap == null ? Infinity : Number(studioCap) - studioSpent;
  return {
    globalCapUsd: cfg.budgetUsd, globalSpentUsd: +globalSpent.toFixed(4),
    studioCapUsd: studioCap == null ? null : Number(studioCap), studioSpentUsd: +studioSpent.toFixed(4),
    remainingUsd: +Math.max(0, Math.min(globalRemaining, studioRemaining)).toFixed(4),
    estImageUsd: cfg.estCostUsd,
    // Plafond qui limite en premier : celui de l'atelier (panel) ou celui du serveur (fichier de configuration)
    limitedBy: studioRemaining < globalRemaining ? 'studio' : 'global',
    budgetReached: Math.min(globalRemaining, studioRemaining) + 1e-9 < cfg.estCostUsd,
  };
}

function status() {
  try {
    const cfg = config();
    if (!cfg.fake) {
      if (!cfg.keyFile) throw new Error('DIG_OPENAI_KEY_FILE absent de la configuration');
      if (!fs.existsSync(cfg.keyFile)) throw new Error('fichier de clé introuvable');
    }
    return { configured: true, fake: !!cfg.fake, imageModel: cfg.editModel || cfg.model, imageProcessing: _sharpAvailable(),
      imagesToday: _imagesToday(), maxImagesPerDay: MAX_IMAGES_PER_DAY, ...budget(cfg),
      reference: _reference() ? path.relative(ROOT, _reference()) : null };
  } catch (err) {
    let studioCapUsd = null;
    try { studioCapUsd = _setting('studio_budget_usd'); } catch (_) { /* table absente */ }
    return { configured: false, reason: oa().redact(String(err.message).replace(os.homedir(), '~')), studioCapUsd: studioCapUsd == null ? null : Number(studioCapUsd) };
  }
}

/** Plafond propre à l'atelier (USD, null = plafond global seul). Ne peut pas dépasser le global. */
function setStudioBudget(value) {
  if (value === null || value === '') {
    conn().prepare('DELETE FROM icon_studio_settings WHERE key = ?').run('studio_budget_usd');
    return status();
  }
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0 || v > 1000) throw new StudioError(400, 'Plafond attendu entre 0 et 1000 USD (vide = plafond global seul).');
  conn().prepare(`INSERT INTO icon_studio_settings (key, value, updated_at) VALUES ('studio_budget_usd', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(String(Math.round(v * 100) / 100));
  return status();
}

// ── Cibles (inventaire de toutes les icônes du jeu) ───────────────────────────

let _materials = null;
function _materialBriefs() {
  if (!_materials) {
    try { _materials = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'icons', 'materials.json'), 'utf8')).materials ?? {}; }
    catch (_) { _materials = {}; }
  }
  return _materials;
}

function _libraryV1() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'icons', 'library.json'), 'utf8')).libraries?.v1 ?? null; }
  catch (_) { return null; }
}

const _blockTypes = () => blockCatalog.getDraft()?.types ?? blockCatalog.getPublished().types;
const _collectionContent = () => collectionCatalog.getDraft() ?? collectionCatalog.getPublished();
/** Image actuellement en jeu (catalogue publié), pour distinguer « brouillon » et « publié ». */
const _publishedImage = (kind, id) => (kind === 'block'
  ? blockCatalog.getPublished().types.find(t => t.id === id)
  : collectionCatalog.getPublished().items.find(i => i.id === id))?.image ?? null;

function _defaultBrief(kind, src) {
  const en = src.names?.en || src.names?.fr || src.id;
  if (kind === 'ui') return { subject: src.subject, details: src.details, palette: src.palette };
  if (kind === 'block') {
    const m = _materialBriefs()[src.id];
    if (m?.subject) return { subject: m.subject, details: m.details ?? '', palette: m.palette ?? '' };
    const what = { coffre: 'small closed treasure chest', gemme: 'raw faceted gemstone', minerai: 'irregular chunk of ore', terre: 'irregular clump', pierre: 'irregular rock' }[src.category] ?? 'game resource';
    return { subject: `A single ${en.toLowerCase()} (${what})`, details: `Same silhouette scale as the reference stone; material clearly recognisable as ${en.toLowerCase()}.`, palette: '' };
  }
  const story = String(src.stories?.en ?? '').slice(0, 220);
  return { subject: `A single ${en.toLowerCase()} collectible`, details: story ? `Inspired by its story: ${story}` : 'Precious collectible object found while digging.', palette: '' };
}

/** Icône verrouillée : validée en v1 (#22) ou validée dans l'atelier. */
function _validation(key, v1Entry) {
  const ev = conn().prepare("SELECT asset_sha, created_at FROM icon_studio_events WHERE target = ? AND action = 'validated' ORDER BY id DESC LIMIT 1").get(key);
  if (ev) return { by: 'atelier', at: ev.created_at, sha: ev.asset_sha };
  if (v1Entry?.validated) return { by: 'v1', at: v1Entry.validated };
  return null;
}

function _target(key) {
  const m = KEY_RE.exec(String(key));
  if (!m) throw new StudioError(400, 'Cible invalide.');
  const [, kind, id] = m;
  let src = null, current = null, applicable = true;
  if (kind === 'block') {
    src = _blockTypes().find(t => t.id === id);
    if (src) current = { emoji: src.icon, image: src.image ?? null, name: src.names?.fr ?? id, extra: `${src.category} · ${src.rarity} · dès ${src.minDepth} m` };
  } else if (kind === 'item') {
    src = _collectionContent().items.find(i => i.id === id);
    if (src) current = { emoji: src.icon, image: src.image ?? null, name: src.names?.fr ?? id, extra: `${src.seriesId} · ${src.rarity}` };
  } else {
    src = UI_TARGETS.find(u => u.id === id);
    if (src) current = { emoji: src.emoji, image: null, name: src.name, extra: 'pictogramme d\'interface' };
    applicable = false;
  }
  if (!src) throw new StudioError(404, 'Cible introuvable.');
  if (applicable) current.publishedImage = _publishedImage(kind, id);
  const lib = kind === 'block' ? _libraryV1() : null;
  const v1Entry = lib?.materials?.[id] ?? null;
  const v1 = v1Entry ? { url: `/${lib.base}${v1Entry.webp['256']}`, status: v1Entry.validated ? 'validée' : (v1Entry.status ?? 'pilote') } : null;
  return { key, kind, id, src, current, applicable, v1, validation: _validation(key, v1Entry) };
}

function _briefFor(t) {
  const row = conn().prepare('SELECT subject, details, palette, updated_at FROM icon_studio_briefs WHERE target = ?').get(t.key);
  return row ? { subject: row.subject, details: row.details, palette: row.palette, custom: true, updatedAt: row.updated_at }
    : { ..._defaultBrief(t.kind, t.src), custom: false };
}

function _assetCounts() {
  const out = {};
  for (const r of conn().prepare('SELECT target, COUNT(*) n FROM icon_studio_assets GROUP BY target').all()) out[r.target] = r.n;
  return out;
}

function _summary(t, counts) {
  return { key: t.key, kind: t.kind, kindLabel: KIND_LABELS[t.kind], id: t.id, ...t.current, applicable: t.applicable,
    v1: t.v1, validated: t.validation, candidates: counts[t.key] ?? 0,
    background: t.kind === 'block' ? { color: t.src.color, accent: t.src.accent } : null,
    state: t.validation ? 'validée' : t.current.image ? 'image' : t.v1 ? `v1 ${t.v1.status}` : 'emoji provisoire',
    // Image du brouillon pas encore publiée (ou retour à l'emoji en attente) : publication à faire dans Blocs/Collections
    unpublished: t.applicable && (t.current.image ?? null) !== (t.current.publishedImage ?? null) };
}

/** Inventaire de toutes les cibles (blocs du brouillon/catalogue, objets, pictogrammes). */
function listTargets() {
  const counts = _assetCounts();
  const keys = [
    ..._blockTypes().map(t => `block:${t.id}`),
    ..._collectionContent().items.map(i => `item:${i.id}`),
    ...UI_TARGETS.map(u => `ui:${u.id}`),
  ];
  return keys.map(k => _summary(_target(k), counts));
}

// ── Images : stockage, contrôles ──────────────────────────────────────────────

const imageUrl = sha => `/media/icons/${sha}.webp`;

function getImage(sha) {
  return SHA_RE.test(String(sha)) ? conn().prepare('SELECT mime, bytes FROM icon_studio_assets WHERE sha = ?').get(sha) ?? null : null;
}

function _event(target, action, sha = null, details = null) {
  conn().prepare('INSERT INTO icon_studio_events (target, action, asset_sha, details) VALUES (?, ?, ?, ?)')
    .run(target, action, sha, details ? JSON.stringify(details) : null);
}

/** Contrôle + normalisation (process.js #22) d'un PNG source → WebP 256 et mesures. */
async function _process(png) {
  if (!_sharpAvailable()) throw new StudioError(503, 'Traitement d\'image indisponible (module sharp absent).');
  const proc = require('../tools/icons/process');
  const sharp = require('sharp');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-icon-studio-'));
  try {
    const raw = path.join(tmp, 'source.png');
    fs.writeFileSync(raw, png);
    const check = await proc.checkSource(raw);
    if (!check.ok) throw new StudioError(422, `Image refusée par les contrôles : ${check.problems.join(' ; ')}.`, check.problems);
    const done = await proc.processIcon(raw, tmp, 'icone');
    const webp = fs.readFileSync(done.files.webp256);
    const master = await sharp(done.files.png).webp({ lossless: true }).toBuffer();
    return { webp, checks: { margins: done.margins, legibility: done.legibility, source: { width: check.width, height: check.height,
      transparentRatio: +check.stats.transparentRatio.toFixed(3), partialRatio: +check.stats.partialRatio.toFixed(4) } },
      masterSha256: crypto.createHash('sha256').update(master).digest('hex') };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function _store(target, source, webp, meta) {
  const sha = crypto.createHash('sha256').update(webp).digest('hex').slice(0, 16);
  const r = conn().prepare('INSERT OR IGNORE INTO icon_studio_assets (sha, target, source, mime, bytes, meta) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sha, target, source, 'image/webp', webp, JSON.stringify(meta));
  return { sha, duplicate: r.changes === 0 };
}

// ── Prompt ────────────────────────────────────────────────────────────────────

function _reference() {
  const dir = path.join(ROOT, 'art', 'icons', 'v1', 'reference');
  const refs = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort() : [];
  return refs.length ? path.join(dir, refs[0]) : null;
}

/** Gabarit par famille : bloc = prompt maître #22 inchangé ; objet et interface = variantes v1.1. */
function buildPrompt(kind, brief, instruction = '') {
  const master = fs.readFileSync(path.join(ROOT, 'tools', 'icons', 'prompt-master.md'), 'utf8');
  const between = tag => {
    const m = master.match(new RegExp(`<!-- ${tag} -->\\n([\\s\\S]*?)\\n<!-- /${tag} -->`));
    if (!m) throw new Error(`gabarit ${tag} absent de prompt-master.md`);
    return m[1].trim();
  };
  const [tpl, ref] = kind === 'block' ? ['PROMPT', 'REFERENCE'] : kind === 'item' ? ['PROMPT_OBJECT', 'REFERENCE_OBJECT'] : ['PROMPT_UI', 'REFERENCE_OBJECT'];
  return between(tpl)
    .replace('{{SUBJECT}}', brief.subject)
    .replace('{{DETAILS}}', brief.details || '')
    .replace('{{PALETTE}}', brief.palette || '')
    .replace('{{REFERENCE}}', _reference() ? ` ${between(ref)}` : '')
    .replace(/\s{2,}/g, ' ')
    + (instruction ? ` Specific adjustment requested for this attempt (keep the same common style): ${instruction}` : '');
}

// ── Génération : une seule image par action de l'admin ────────────────────────

let _job = null;     // génération en cours ou dernière terminée (mémoire du processus)
let _jobSeq = 0;

const _clean = (v, max) => String(v ?? '').replace(/[<>\u0000-\u001f]/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);

function setBrief(key, input = {}) {
  const t = _target(key);
  if (input.reset) {
    conn().prepare('DELETE FROM icon_studio_briefs WHERE target = ?').run(key);
  } else {
    const b = { subject: _clean(input.subject, 300), details: _clean(input.details, 600), palette: _clean(input.palette, 300) };
    if (b.subject.length < 3) throw new StudioError(400, 'Sujet requis (3 à 300 caractères, en anglais de préférence).');
    conn().prepare(`INSERT INTO icon_studio_briefs (target, subject, details, palette, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(target) DO UPDATE SET subject = excluded.subject, details = excluded.details, palette = excluded.palette, updated_at = excluded.updated_at`)
      .run(key, b.subject, b.details, b.palette);
  }
  _event(key, 'brief', null, input.reset ? { reset: true } : null);
  return _briefFor(t);
}

function _checkBudget(images) {
  if (_imagesToday() + images > MAX_IMAGES_PER_DAY) {
    throw new StudioError(429, `Quota : ${MAX_IMAGES_PER_DAY} images par 24 h (${_imagesToday()} déjà générées).`);
  }
  let cfg;
  try { cfg = config(); } catch (err) { throw new StudioError(503, `API d'images non configurée : ${oa().redact(String(err.message).replace(os.homedir(), '~'))}`); }
  const b = budget(cfg);
  const planned = images * cfg.estCostUsd;
  if (planned > b.remainingUsd + 1e-9) {
    throw new StudioError(402, `Plafond de dépense IA atteint : une image coûte environ ${planned.toFixed(2)} USD, il reste ${b.remainingUsd.toFixed(2)} USD. `
      + (b.limitedBy === 'studio'
        ? `Pour continuer, relevez la limite de l'atelier dans ⚙ Config → Budget IA (${b.studioSpentUsd.toFixed(2)} / ${b.studioCapUsd} USD).`
        : `Pour continuer, relevez le plafond du serveur (${b.globalSpentUsd.toFixed(2)} / ${b.globalCapUsd} USD) : DIG_IMAGE_BUDGET_USD dans ~/.config/dig/openai.env, pris en compte sans redémarrage.`));
  }
  return { cfg, planned };
}

function _logCall({ target, model, ok, error = null, cost, durationMs, usage = null }) {
  conn().prepare(`INSERT INTO icon_studio_calls (target, model, ok, error, cost_usd, cost_basis, duration_ms, usage) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(target, model ?? null, ok ? 1 : 0, error, cost.cost_usd, cost.basis, durationMs, usage ? JSON.stringify(usage) : null);
  if (!_fake) {
    oa().appendLedger({ at: new Date().toISOString(), source: 'admin-icons', target, model, ok, error: error ?? undefined,
      cost_usd: cost.cost_usd, cost_basis: cost.basis, duration_ms: durationMs, usage: usage ?? undefined });
  }
}

/** Un appel image + contrôles + stockage. Rend { sha } ou lève. Toujours journalisé. */
async function _generateOne(t, brief, { instruction = '', basedOn = null } = {}) {
  const { cfg } = _checkBudget(1);
  const prompt = buildPrompt(t.kind, brief, instruction);
  const started = Date.now();
  let png, usage = null, model, cost, params = null;
  try {
    if (_fake) {
      const r = await _fake.image({ prompt, target: t.key });
      png = r.png; usage = r.usage ?? null; model = 'fake-image'; cost = { cost_usd: cfg.estCostUsd, basis: 'test' };
    } else {
      const req = oa().buildRequest(cfg, { prompt, reference: _reference() });
      params = req.params;
      const out = await oa().callImages(cfg, req);
      png = out.png; usage = out.usage; model = req.params.model; cost = oa().costFromUsage(cfg, out.usage);
    }
  } catch (err) {
    const msg = oa().redact(String(err.message || err)).slice(0, 300);
    _logCall({ target: t.key, model: cfg.editModel || cfg.model, ok: false, error: msg, cost: { cost_usd: 0, basis: 'échec' }, durationMs: Date.now() - started });
    throw new StudioError(502, `Échec de la génération : ${msg}`);
  }
  // L'image a été facturée : l'appel est journalisé avec son coût, même si les contrôles la refusent.
  _logCall({ target: t.key, model, ok: true, cost, durationMs: Date.now() - started, usage });
  const done = await _process(png);
  const meta = { kind: t.kind, prompt, promptVersion: t.kind === 'block' ? 'v1.0' : 'v1.1', brief: { subject: brief.subject, details: brief.details, palette: brief.palette },
    model, params, reference: _reference() ? path.relative(ROOT, _reference()) : null, instruction: instruction || null, basedOn,
    costUsd: cost.cost_usd, costBasis: cost.basis,
    durationMs: Date.now() - started, checks: done.checks, masterSha256: done.masterSha256 };
  const { sha } = _store(t.key, 'ai', done.webp, meta);
  _event(t.key, 'generated', sha, { costUsd: cost.cost_usd, ...(instruction ? { instruction } : {}), ...(basedOn ? { basedOn } : {}) });
  return { sha, costUsd: cost.cost_usd };
}

/**
 * Génère UNE image pour une cible, en arrière-plan (un appel ≈ 1 min : plus long que le délai du
 * proxy, d'où le suivi par GET /api/admin/icons/job). Consigne facultative (« plus sombre »…) ajoutée
 * au prompt ; « basedOn » = proposition refaite (provenance seulement, l'ancienne est conservée).
 * Budget, quota et configuration vérifiés AVANT l'appel ; une seule génération à la fois.
 */
function generate(key, { instruction = '', basedOn = null } = {}) {
  if (_job && _job.status === 'running') throw new StudioError(429, 'Une image est déjà en cours de génération : patientez.');
  const t = _target(key);
  const consigne = _clean(instruction, INSTRUCTION_MAX);
  const from = basedOn ? _asset(key, String(basedOn)) : null;
  const { planned } = _checkBudget(1);
  const job = { id: ++_jobSeq, status: 'running', target: key, name: t.current.name, startedAt: new Date().toISOString(), finishedAt: null,
    estimatedUsd: +planned.toFixed(4), spentUsd: 0, instruction: consigne || null, basedOn: from, result: null, error: null };
  _job = job;
  job.promise = (async () => {
    try {
      const r = await _generateOne(t, _briefFor(t), { instruction: consigne, basedOn: from });
      job.result = { sha: r.sha, url: imageUrl(r.sha) };
      job.spentUsd = r.costUsd;
      job.status = 'done';
    } catch (err) {
      job.error = err.message;
      job.status = 'failed';
    }
    job.finishedAt = new Date().toISOString();
  })();
  return jobView();
}

function jobView() {
  if (!_job) return null;
  const { promise, ...v } = _job;
  return structuredClone(v);
}

/** Attendre la fin de la génération en cours (tests). */
async function waitJob() { if (_job?.promise) await _job.promise; return jobView(); }

// ── Téléversement manuel ──────────────────────────────────────────────────────

async function upload(key, dataUrl) {
  const t = _target(key);
  const m = /^(?:data:image\/(png|webp|jpeg);base64,)?([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl ?? ''));
  if (!m) throw new StudioError(400, 'Image attendue (PNG ou WebP avec fond transparent).');
  const buf = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
  if (!buf.length || buf.length > MAX_UPLOAD_BYTES) throw new StudioError(413, `Image vide ou trop lourde (maximum ${MAX_UPLOAD_BYTES / 1024 / 1024} Mo).`);
  const isPng = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP';
  if (!isPng && !isWebp) throw new StudioError(415, 'Format refusé : PNG ou WebP avec transparence (un JPEG n\'a pas de fond transparent).');
  const sharp = require('sharp');
  let png;
  try {
    const meta = await sharp(buf).metadata();
    if (meta.width > 4096 || meta.height > 4096 || meta.width < 128 || meta.height < 128) throw new StudioError(400, 'Dimensions attendues entre 128 et 4096 px.');
    if (!meta.hasAlpha) throw new StudioError(422, 'Image sans canal alpha : un fond transparent est requis.');
    png = await sharp(buf).png().toBuffer();
  } catch (err) {
    if (err instanceof StudioError) throw err;
    throw new StudioError(400, 'Image illisible.');
  }
  const done = await _process(png);
  const { sha, duplicate } = _store(t.key, 'upload', done.webp, { kind: t.kind, source: 'téléversement manuel', bytes: buf.length,
    checks: done.checks, masterSha256: done.masterSha256, uploadSha256: crypto.createHash('sha256').update(buf).digest('hex') });
  if (!duplicate) _event(t.key, 'uploaded', sha);
  return { url: imageUrl(sha), sha, duplicate };
}

// ── Détail, choix, application, retour arrière ────────────────────────────────

function _assetStatus(key) {
  const out = {};
  for (const e of conn().prepare("SELECT asset_sha, action FROM icon_studio_events WHERE target = ? AND action IN ('rejected', 'chosen', 'validated', 'restored') ORDER BY id").all(key)) {
    out[e.asset_sha] = e.action === 'restored' ? 'candidate' : e.action;
  }
  return out;
}

function getTarget(key) {
  const t = _target(key);
  const statuses = _assetStatus(key);
  const assets = conn().prepare('SELECT sha, source, meta, created_at FROM icon_studio_assets WHERE target = ? ORDER BY created_at DESC, rowid DESC').all(key)
    .map(a => {
      const meta = JSON.parse(a.meta);
      return { sha: a.sha, url: imageUrl(a.sha), source: a.source, createdAt: a.created_at, status: statuses[a.sha] ?? 'candidate',
        model: meta.model ?? null, costUsd: meta.costUsd ?? 0, checks: meta.checks ?? null, prompt: meta.prompt ?? null,
        instruction: meta.instruction ?? null, basedOn: meta.basedOn ?? null,
        inDraft: imageUrl(a.sha) === t.current.image, published: imageUrl(a.sha) === t.current.publishedImage };
    });
  const history = conn().prepare('SELECT id, action, asset_sha, details, created_at FROM icon_studio_events WHERE target = ? ORDER BY id DESC LIMIT 100').all(key)
    .map(e => ({ id: e.id, action: e.action, url: e.asset_sha ? imageUrl(e.asset_sha) : null, sha: e.asset_sha, details: e.details ? JSON.parse(e.details) : null, at: e.created_at }));
  const spent = conn().prepare('SELECT COALESCE(SUM(cost_usd), 0) s, COUNT(*) n FROM icon_studio_calls WHERE target = ?').get(key);
  return { ..._summary(t, { [key]: assets.length }), brief: _briefFor(t), prompt: buildPrompt(t.kind, _briefFor(t)), assets, history,
    costUsd: +spent.s.toFixed(4), calls: spent.n, story: t.kind === 'item' ? t.src.stories?.fr ?? null : null };
}

function _asset(key, sha) {
  if (!SHA_RE.test(String(sha))) throw new StudioError(400, 'Image invalide.');
  const a = conn().prepare('SELECT sha FROM icon_studio_assets WHERE sha = ? AND target = ?').get(sha, key);
  if (!a) throw new StudioError(404, 'Image introuvable pour cette icône.');
  return a.sha;
}

/** Statut d'une image : retenue (« chosen »), rejetée, remise en candidate, ou VALIDÉE (verrou). */
function mark(key, sha, status) {
  _target(key);
  const action = { chosen: 'chosen', rejected: 'rejected', candidate: 'restored', validated: 'validated' }[status];
  if (!action) throw new StudioError(400, 'Statut : chosen, rejected, candidate ou validated.');
  _event(key, action, _asset(key, sha));
  return getTarget(key);
}

/**
 * Applique une image (ou l'emoji d'origine si `sha` est null) au BROUILLON du catalogue concerné.
 * Refusé sans `override` si l'icône actuelle est validée. Jamais publié ici.
 */
function apply(key, { sha = null, override = false } = {}) {
  const t = _target(key);
  if (!t.applicable) throw new StudioError(409, 'Pictogramme d\'interface : application en jeu prévue avec le ticket #41 (stocké et prêt ici).');
  if (t.validation && !override) {
    throw new StudioError(409, `Icône validée (${t.validation.by === 'v1' ? 'bibliothèque v1' : 'atelier'}, ${t.validation.at}) : remplacement refusé sans accord explicite (« override »).`);
  }
  const url = sha ? imageUrl(_asset(key, sha)) : null;
  const before = t.current.image;
  if (t.kind === 'block') blockCatalog.upsertDraftType({ ...t.src, image: url });
  else collectionCatalog.upsertDraftItem({ ...t.src, image: url });
  _event(key, sha ? 'applied' : 'reverted_to_emoji', sha, { before, after: url, override: !!override && !!t.validation });
  return { target: getTarget(key), draft: true, catalog: t.kind === 'block' ? 'blocks' : 'collections' };
}

function listCalls(limit = 50) {
  return conn().prepare('SELECT id, created_at, target, model, ok, error, cost_usd, cost_basis, duration_ms FROM icon_studio_calls ORDER BY id DESC LIMIT ?')
    .all(limit).map(c => ({ ...c, ok: !!c.ok }));
}

function overview() {
  return { status: status(), targets: listTargets(), job: jobView(), calls: listCalls(),
    references: _references() };
}

/** Icônes validées servant d'étalon de cohérence (affichées à côté de chaque proposition). */
function _references() {
  const lib = _libraryV1();
  if (!lib) return [];
  return Object.entries(lib.materials).filter(([, e]) => e.validated).map(([id, e]) => ({ id, url: `/${lib.base}${e.webp['256']}`, validated: e.validated }));
}

module.exports = {
  StudioError, UI_TARGETS, init, status, setStudioBudget, listTargets, getTarget, setBrief, generate, jobView, waitJob,
  upload, mark, apply, listCalls, overview, getImage, buildPrompt, setFakeTransport, fakeIconPng, imageUrl,
};
