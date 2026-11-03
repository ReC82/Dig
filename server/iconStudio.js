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
const badges = require('./badges');
const { APP_VERSION } = require('./version');

const ROOT = path.join(__dirname, '..');
const MAX_IMAGES_PER_DAY = 40;
const INSTRUCTION_MAX = 1000;   // consigne artistique réelle (recette du 02/11 : 300 trop court)
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const SHA_RE = /^[a-f0-9]{16}$/;
const KEY_RE = /^(block|item|badge|ui):([a-z][a-z0-9_]{1,39})$/;

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

// v1.2 : identité du catalogue en tête ; v1.3 : forme réelle de l'objet imposée (gabarit et consigne par défaut)
const PROMPT_VERSION = 'v1.3';
// Contrôle du sujet : appel texte (vision) peu coûteux, réservé avant chaque image d'objet ou de badge
const CHECK_EST_USD = 0.01;

const KIND_LABELS = { block: 'Bloc', item: 'Objet / relique', badge: 'Badge', ui: 'Interface' };

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
  // DIG_AI_FAKE_DELAY_MS : durée simulée d'un appel (essais navigateur d'une génération en cours)
  const delay = Math.min(60000, Number(process.env.DIG_AI_FAKE_DELAY_MS) || 0);
  _fake = { image: async () => { await new Promise(r => setTimeout(r, delay)); return { png: await fakeIconPng(), usage: null }; } };
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
  // Les contrôles du sujet (appels texte, cible « check:… ») ne sont pas des images
  return conn().prepare("SELECT COUNT(*) n FROM icon_studio_calls WHERE created_at >= datetime('now', '-1 day') AND target NOT LIKE 'check:%'").get().n;
}

// Réservation par image (retour du 03/11) : l'estimation configurée (0,25 USD) triplait le coût réel
// constaté (≈ 0,082 USD) et bloquait les lots bien avant le plafond. Dès 2 images réellement facturées,
// la réservation devient le plus cher des 5 derniers coûts mesurés + 25 % (arrondi au cent supérieur),
// sans jamais dépasser l'estimation configurée. Le plafond, lui, ne change pas : dépensé + réservation ≤ plafond.
const RESERVE_SAMPLES = 5, RESERVE_MIN_SAMPLES = 2, RESERVE_MARGIN = 1.25;
function _imageReserve(cfg) {
  const rows = conn().prepare(`SELECT cost_usd FROM icon_studio_calls WHERE ok = 1 AND target NOT LIKE 'check:%' AND cost_basis LIKE 'usage%'
    AND created_at >= datetime('now', '-30 days') ORDER BY id DESC LIMIT ?`).all(RESERVE_SAMPLES);
  return reserveFromCosts(rows.map(r => r.cost_usd), cfg.estCostUsd);
}
function reserveFromCosts(costs, configuredUsd) {
  if (costs.length < RESERVE_MIN_SAMPLES) return { usd: configuredUsd, basis: 'configured', configuredUsd, measuredMaxUsd: null, samples: costs.length };
  const measuredMaxUsd = Math.max(...costs);
  const usd = Math.min(configuredUsd, Math.ceil(measuredMaxUsd * RESERVE_MARGIN * 100 - 1e-9) / 100);
  return { usd, basis: usd < configuredUsd ? 'measured' : 'configured', configuredUsd, measuredMaxUsd, samples: costs.length };
}

/** Coût réel de la dernière image générée par l'atelier (affiché à part du cumul). */
function _lastImageCost() {
  return conn().prepare("SELECT target, cost_usd, created_at FROM icon_studio_calls WHERE ok = 1 AND target NOT LIKE 'check:%' ORDER BY id DESC LIMIT 1").get() ?? null;
}

/** Budgets : global (configuration, partagé #22/#37) et propre à l'atelier (panel). Jamais de secret. */
function budget(cfg = config()) {
  const studioCap = _setting('studio_budget_usd');
  const globalSpent = _globalSpent(), studioSpent = _studioSpent();
  const globalRemaining = cfg.budgetUsd - globalSpent;
  const studioRemaining = studioCap == null ? Infinity : Number(studioCap) - studioSpent;
  const reserve = _imageReserve(cfg);
  return {
    globalCapUsd: cfg.budgetUsd, globalSpentUsd: +globalSpent.toFixed(4),
    studioCapUsd: studioCap == null ? null : Number(studioCap), studioSpentUsd: +studioSpent.toFixed(4),
    remainingUsd: +Math.max(0, Math.min(globalRemaining, studioRemaining)).toFixed(4),
    estImageUsd: reserve.usd, reserve, perImageUsd: +(reserve.usd + _checkEst()).toFixed(4), lastImage: _lastImageCost(),
    // Plafond qui limite en premier : celui de l'atelier (panel) ou celui du serveur (fichier de configuration)
    limitedBy: studioRemaining < globalRemaining ? 'studio' : 'global',
    budgetReached: Math.min(globalRemaining, studioRemaining) + 1e-9 < reserve.usd + _checkEst(),
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
// Badge (#38) : pas de brouillon, l'image enregistrée sur le badge est celle du jeu (badge actif) ou de sa fiche.
const _publishedImage = (kind, id) => (kind === 'block'
  ? blockCatalog.getPublished().types.find(t => t.id === id)
  : kind === 'badge' ? badges.getBadgeRow(id)
  : collectionCatalog.getPublished().items.find(i => i.id === id))?.image ?? null;

function _defaultBrief(kind, src) {
  const en = src.names?.en || src.names?.fr || src.id;
  if (kind === 'ui') return { subject: src.subject, details: src.details, palette: src.palette };
  if (kind === 'badge') {
    const what = String(src.descriptions?.en || src.descriptions?.fr || '').slice(0, 160);
    return { subject: `A round honorary medal emblem for the achievement "${en}"`, details: `No text or letters; a single clear symbol in the centre${what ? `, evoking: ${what}` : ''}.`, palette: '' };
  }
  if (kind === 'block') {
    const m = _materialBriefs()[src.id];
    if (m?.subject) return { subject: m.subject, details: m.details ?? '', palette: m.palette ?? '' };
    const what = { coffre: 'small closed treasure chest', gemme: 'raw faceted gemstone', minerai: 'irregular chunk of ore', terre: 'irregular clump', pierre: 'irregular rock' }[src.category] ?? 'game resource';
    return { subject: `A single ${en.toLowerCase()} (${what})`, details: `Same silhouette scale as the reference stone; material clearly recognisable as ${en.toLowerCase()}.`, palette: '' };
  }
  // Prompt v1.3 (recette réelle du 02/11 : « a single golden token collectible » + « found wedged under a
  // rounded stone » a donné une pépite facettée) : le sujet est l'objet seul, l'histoire ne donne que
  // l'usure et l'ambiance, jamais un autre objet à dessiner.
  const story = String(src.stories?.en ?? '').slice(0, 220);
  return { subject: `A single ${en.toLowerCase()}, shown with its usual real-world shape`,
    details: story ? `Its story only suggests wear and mood (draw nothing else it mentions): ${story}` : 'Precious collectible object found while digging.', palette: '' };
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
  } else if (kind === 'badge') {
    src = badges.getBadgeRow(id);
    if (src) current = { emoji: src.icon, image: src.image ?? null, name: src.names?.fr ?? id, extra: `badge · ${src.status}` };
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

// Objets et badges : une consigne décrit UN seul objet. Même sujet + mêmes détails (casse ignorée) chez
// plusieurs cibles de la même famille = consigne répétée (recette #40 du 02/11 : la consigne « lanterne »
// importée pour les 6 objets d'une collection a produit une lanterne pour le crayon).
const _BRIEF_UNIQUE = new Set(['item', 'badge']);
const _briefSig = b => `${String(b.subject ?? '').trim().toLowerCase()}\n${String(b.details ?? '').trim().toLowerCase()}`;

/** Autres cibles de la même famille ayant enregistré exactement la même consigne. */
function _briefTwins(key, b) {
  const sig = _briefSig(b);
  const prefix = `${key.split(':')[0]}:`;
  return conn().prepare('SELECT target, subject, details, updated_at FROM icon_studio_briefs WHERE substr(target, 1, ?) = ? AND target <> ?')
    .all(prefix.length, prefix, key).filter(r => _briefSig(r) === sig && _exists(r.target));
}
const _exists = key => { try { _target(key); return true; } catch (_) { return false; } };

/**
 * Consigne utilisée pour générer. Une consigne répétée chez d'autres objets n'est retenue que pour la
 * cible qui l'a enregistrée en dernier, seule (correction manuelle après une importation) ; sinon elle
 * est ignorée (conservée en base, signalée) et la fiche repart du nom et de l'histoire de l'objet.
 */
function _briefFor(t) {
  const row = conn().prepare('SELECT subject, details, palette, updated_at FROM icon_studio_briefs WHERE target = ?').get(t.key);
  if (!row) return { ..._defaultBrief(t.kind, t.src), custom: false };
  const own = { subject: row.subject, details: row.details, palette: row.palette, custom: true, updatedAt: row.updated_at };
  if (!_BRIEF_UNIQUE.has(t.kind)) return own;
  const twins = _briefTwins(t.key, row);
  if (!twins.length || twins.every(r => r.updated_at < row.updated_at)) return { ...own, sharedWith: twins.map(r => r.target.slice(t.kind.length + 1)) };
  return { ..._defaultBrief(t.kind, t.src), custom: false,
    ignored: { subject: row.subject, details: row.details, palette: row.palette, sharedWith: twins.map(r => r.target.slice(t.kind.length + 1)) } };
}

/** Identité de l'objet, tirée du catalogue (jamais de la consigne) : ce que l'image doit représenter. */
function _identity(t) {
  if (!_BRIEF_UNIQUE.has(t.kind)) return null;
  const en = String(t.src.names?.en || '').trim(), fr = String(t.src.names?.fr || '').trim();
  const name = en || fr || t.id;
  return { name, fr: fr && fr !== name ? fr : null };
}

// ── Sujet : l'image représente l'objet du catalogue, jamais un autre ─────────
// Recette du 02/11 (2e retour) : une précision « remplace la lanterne par un CRAYON DE MINEUR » restée
// dans un ancien onglet a été envoyée pour le Jeton doré, qui est devenu un crayon. Toute mention d'un
// AUTRE objet de la même famille dans la précision ou la consigne d'illustration bloque la dépense.

const _norm = s => ` ${String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
const _has = (hay, term) => hay.includes(` ${term} `) || hay.includes(` ${term}s `);
// Mots trop courants pour désigner à eux seuls un autre objet (« coin », « dent » en anglais, « relic »…)
const _GENERIC_HEADS = new Set(['fragment', 'piece', 'relic', 'relique', 'objet', 'object']);
/** Nom principal d'un objet : premier mot du nom français, dernier mot du nom anglais (5 lettres et plus). */
function _heads(names = {}) {
  const fr = _norm(names.fr).trim().split(' ')[0] ?? '';
  const en = _norm(names.en).trim().split(' ').pop() ?? '';
  return [...new Set([fr, en].filter(w => w.length >= 5 && !_GENERIC_HEADS.has(w)))];
}

/** Autres cibles de la même famille (objets de collection, ou badges non archivés). */
function _peers(t) {
  if (t.kind === 'item') return _collectionContent().items.filter(i => i.id !== t.id);
  if (t.kind === 'badge') {
    try { return badges.listBadges().filter(b => b.status !== 'archived' && b.id !== t.id); } catch (_) { return []; }
  }
  return [];
}

// Recettes du 02 et 03/11 : « cohérent avec la boussole et la lanterne » (référence de style) et
// « embroidered royal crown » (motif brodé) étaient refusés. Chaque mention est lue dans sa
// proposition : une demande de remplacer ou de dessiner un autre objet bloque toujours ; une
// référence de style ou un motif/décor autour du nom est autorisé (et expliqué) ; sinon la règle
// d'avant s'applique (nom complet = conflit certain, nom principal = conflit probable).
const _phrases = list => list.map(p => _norm(p));
// Changement de sujet explicite. Le sens compte : ce qui suit « au lieu de » est l'objet à RETIRER,
// ce qui suit « remplace … par » ou « transforme en » est le NOUVEAU sujet (« remplace la lanterne par
// un crayon » est juste sur la fiche du crayon, refusé sur celle du jeton).
const _INSTEAD = _phrases(['instead of', 'rather than', 'in place of', 'a la place', 'au lieu', 'plutot que', 'plutot qu']);
const _REPLACE = _phrases(['replace', 'replaced', 'replacing', 'swap', 'remplace', 'remplacer', 'remplacez', 'remplacee']);
const _REPLACE_BY = new Set(['par', 'with', 'by', 'avec']);
const _BECOME = _phrases(['turn into', 'turn it into', 'transform', 'transforme', 'transformer', 'transformez', 'devient', 'becomes',
  'change into', 'change en', 'changer en']);
const _CONTEXT_LABELS = { style: 'référence de style', detail: 'motif ou décor', replace: 'demande de dessiner un autre objet',
  removed: 'objet à retirer de l\'image' };
/** Position (en mots) de la première expression trouvée, ou -1. */
function _at(words, phrases) {
  const text = ` ${words.join(' ')} `;
  for (const p of phrases) {
    const i = text.indexOf(p);
    if (i >= 0) return text.slice(0, i + 1).trim().split(' ').filter(Boolean).length;
  }
  return -1;
}
// Verbe qui fait de la mention le sujet de l'image (« dessine une boussole », « draw a broken crown »)
const _DEPICT = new Set(['draw', 'dessine', 'dessiner', 'dessinez', 'depict', 'represente', 'representer', 'representez', 'show', 'montre', 'montrer',
  'montrez', 'paint', 'peins', 'peindre', 'peignez', 'illustrate', 'illustre', 'illustrer', 'illustrez', 'render', 'generate', 'genere', 'generer',
  'generez', 'create', 'cree', 'creer', 'creez', 'make', 'fais', 'faites', 'faire']);
const _DESCRIBED = new Set(['image', 'images', 'icone', 'icon', 'proposition', 'picture', 'it', 'elle', 'il', 'cela', 'ca', 'this', 'that']);
// Référence de style placée avant la mention dans la même proposition
const _STYLE = _phrases(['coherent avec', 'coherente avec', 'coherents avec', 'coherent with', 'consistent with', 'matching', 'match', 'matches', 'same style',
  'meme style', 'style de', 'style des', 'style du', 'style of', 'style as', 'in the style', 'like the', 'comme la', 'comme le', 'comme les',
  'comme l', 'a la maniere', 'dans l esprit', 'assorti', 'assortie', 'assortis', 'harmonise', 'harmonisee', 'harmonious with', 'en harmonie', 'meme rendu',
  'meme palette', 'same palette', 'same rendering', 'same look', 'fits with', 'va avec', 'aligned with', 'aligne sur', 'reference', 'references']);
// Motif, décor ou ornement collé à la mention (3 mots avant ou après)
const _DETAIL = new Set(['embroidered', 'embroidery', 'brode', 'brodee', 'brodes', 'brodees', 'broderie', 'motif', 'motifs', 'pattern', 'patterned',
  'engraved', 'engraving', 'grave', 'gravee', 'graves', 'gravure', 'embossed', 'stamped', 'estampe', 'estampee', 'estampille', 'frappe', 'frappee',
  'emblem', 'embleme', 'crest', 'blason', 'ecusson', 'insignia', 'insigne', 'monogram', 'monogramme', 'logo', 'symbol', 'symbole', 'printed', 'imprime',
  'imprimee', 'decor', 'decore', 'decoree', 'decorated', 'decoration', 'ornament', 'ornamental', 'ornate', 'orne', 'ornee', 'ornement', 'effigie',
  'effigy', 'inlaid', 'incruste', 'incrustee', 'sewn', 'cousu', 'cousue', 'appliqued', 'applique', 'silhouette', 'shaped', 'etched', 'stitched',
  'woven', 'tisse', 'tissee', 'relief', 'medallion', 'medaillon', 'heraldic', 'heraldique']);
const _IN = (hay, p) => hay.includes(p);

/** Lecture d'une mention dans sa proposition : 'replace' | 'removed' | 'style' | 'detail' | 'mention'. */
function _mentionContext(words, at, len, ownWords) {
  const instead = _at(words, _INSTEAD);
  if (instead >= 0) return at < instead ? 'replace' : 'removed';
  const repl = _at(words, _REPLACE);
  if (repl >= 0) {
    const by = words.findIndex((w, i) => i > repl && _REPLACE_BY.has(w));
    return by >= 0 && at > by ? 'replace' : at > repl ? 'removed' : 'replace';
  }
  const become = _at(words, _BECOME);
  if (become >= 0) return at > become ? 'replace' : 'removed';
  for (let j = Math.max(0, at - 3); j < at; j++) {
    // « L'image précédente représente une lanterne » décrit l'ancienne image : ce n'est pas une demande
    const described = words.slice(Math.max(0, j - 3), j).some(w => _DESCRIBED.has(w));
    if (_DEPICT.has(words[j]) && !described && !words.slice(j + 1, at).some(w => ownWords.has(w))) return 'replace';
  }
  const before = ` ${words.slice(0, at).join(' ')} `;
  if (_STYLE.some(p => _IN(before, p))) return 'style';
  if (words.slice(Math.max(0, at - 3), at + len + 3).some(w => _DETAIL.has(w))) return 'detail';
  return 'mention';
}

/** Positions d'un terme (pluriel en « s » admis) dans une liste de mots. */
function _findTerm(words, term) {
  const tw = term.split(' ');
  const out = [];
  for (let i = 0; i + tw.length <= words.length; i++) {
    if (tw.every((w, k) => words[i + k] === w || (k === tw.length - 1 && words[i + k] === `${w}s`))) out.push(i);
  }
  return out;
}

/**
 * Mentions d'un autre objet dans des textes ({ where, text }), lues en contexte. Rend
 * { conflicts, references } : `conflicts` bloque la dépense (`strict` = jamais contournable :
 * demande de remplacement, ou nom complet cité sans contexte ; sinon contournable par confirmation),
 * `references` liste les mentions autorisées et pourquoi (affichées dans l'atelier).
 */
function _subjectAnalysis(t, sources) {
  if (!_BRIEF_UNIQUE.has(t.kind)) return { conflicts: [], references: [] };
  const own = [t.src.names?.fr, t.src.names?.en, t.id.replace(/_/g, ' ')].map(_norm).join(' ');
  const ownWords = new Set(own.trim().split(/\s+/).filter(w => w.length >= 4));
  const conflicts = [], references = [];
  for (const p of _peers(t)) {
    const full = [p.names?.fr, p.names?.en].map(n => _norm(n).trim()).filter(n => n.length >= 3 && !_has(own, n));
    const heads = _heads(p.names).filter(w => !_has(own, w));
    const name = p.names?.fr || p.names?.en || p.id;
    let worst = null, ref = null;
    for (const { where, text } of sources) {
      // Une proposition = un morceau entre ponctuations (« vue de trois quarts, cohérent avec la boussole »)
      for (const part of String(text ?? '').split(/[.,;:!?\n()[\]«»"]+|\s[-–—]\s/)) {
        const words = _norm(part).trim().split(' ').filter(Boolean);
        for (const [term, isFull] of [...full.map(n => [n, true]), ...heads.map(w => [w, false])]) {
          for (const at of _findTerm(words, term)) {
            const ctx = _mentionContext(words, at, term.split(' ').length, ownWords);
            if (ctx === 'style' || ctx === 'detail') { ref ??= { id: p.id, name, term, where, context: ctx, reason: _CONTEXT_LABELS[ctx] }; continue; }
            // Objet à retirer : conflit probable (confirmation), même cité en entier
            const c = { id: p.id, name, term, where, strict: ctx === 'replace' || (isFull && ctx !== 'removed'), context: ctx,
              ...(_CONTEXT_LABELS[ctx] ? { reason: _CONTEXT_LABELS[ctx] } : {}) };
            if (!worst || (c.strict && !worst.strict)) worst = c;
          }
        }
      }
    }
    if (worst) conflicts.push(worst);
    else if (ref) references.push(ref);
  }
  return { conflicts: conflicts.sort((a, b) => b.strict - a.strict), references };   // conflit certain cité en premier
}
const _subjectConflicts = (t, sources) => _subjectAnalysis(t, sources).conflicts;

/** Textes envoyés à l'IA qui décrivent le sujet : précision de cette génération et consigne d'illustration. */
const _subjectSources = (instruction, brief) => [
  { where: 'précision', text: instruction ?? '' },
  // Consigne tirée du nom et de l'histoire (catalogue) : non vérifiée, une histoire peut citer un autre objet
  { where: 'consigne d\'illustration', text: brief.custom === false ? '' : `${brief.subject ?? ''} ${brief.details ?? ''}` },
];

/** Proposition douteuse : sa provenance demandait un autre objet (ancien correctif, précision polluée…). */
function _assetWarning(t, meta) {
  if (!meta?.brief && !meta?.instruction) return null;
  // Conflit probable confirmé par l'admin au moment de générer (tracé dans la provenance) : pas douteux
  const ack = new Set(meta.acknowledgedConflicts ?? []);
  const c = _subjectConflicts(t, _subjectSources(meta.instruction, meta.brief ?? {})).filter(x => x.strict || !ack.has(x.term));
  return c.length ? { conflicts: c, text: `Proposition douteuse : sa ${c[0].where} demandait « ${c[0].term} » (objet « ${c[0].name} »), pas « ${t.current.name} ».` } : null;
}

function _conflictMessage(t, list) {
  const parts = list.map(c => `« ${c.term} » (objet « ${c.name} ») dans la ${c.where}${c.context === 'replace' ? ', lu comme une demande de dessiner cet autre objet' : ''}`).join(', ');
  return `Conflit de sujet : cette fiche est « ${t.current.name} », mais la demande mentionne ${parts}. `
    + 'Aucune image n\'a été générée et rien n\'a été dépensé. Retirez cette mention'
    + (list.some(c => c.strict) ? '.' : ', ou confirmez qu\'il ne s\'agit pas d\'un autre objet.')
    + ' Une référence de style (« cohérent avec la boussole ») ou un motif (« couronne brodée ») est accepté.';
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

/** Badges non archivés (#38) ; aucun si le module des badges n'est pas initialisé (tests isolés). */
function _badgeKeys() {
  try { return badges.listBadges().filter(b => b.status !== 'archived').map(b => `badge:${b.id}`); }
  catch (err) { if (/no such table/.test(err.message)) return []; throw err; }
}

/** Inventaire de toutes les cibles (blocs du brouillon/catalogue, objets, pictogrammes). */
function listTargets() {
  const counts = _assetCounts();
  const keys = [
    ..._blockTypes().map(t => `block:${t.id}`),
    ..._collectionContent().items.map(i => `item:${i.id}`),
    ..._badgeKeys(),
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
/**
 * Prompt en trois parties distinctes : identité de l'objet (catalogue), description visuelle (consigne
 * de l'objet), contraintes communes de style (gabarit + référence pierre, qui ne donne que le style).
 */
function buildPrompt(kind, brief, instruction = '', identity = null) {
  const master = fs.readFileSync(path.join(ROOT, 'tools', 'icons', 'prompt-master.md'), 'utf8');
  const between = tag => {
    const m = master.match(new RegExp(`<!-- ${tag} -->\\n([\\s\\S]*?)\\n<!-- /${tag} -->`));
    if (!m) throw new Error(`gabarit ${tag} absent de prompt-master.md`);
    return m[1].trim();
  };
  const [tpl, ref] = kind === 'block' ? ['PROMPT', 'REFERENCE'] : kind === 'item' || kind === 'badge' ? ['PROMPT_OBJECT', 'REFERENCE_OBJECT'] : ['PROMPT_UI', 'REFERENCE_OBJECT'];
  const who = identity
    ? `Object to depict: "${identity.name}"${identity.fr ? ` (French name: "${identity.fr}")` : ''}; the icon shows this exact object and nothing else. Visual description: `
    : '';
  return who + between(tpl)
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
    if (_BRIEF_UNIQUE.has(t.kind)) {
      // Refus seulement si la même consigne est retenue ailleurs ; une consigne répétée et ignorée
      // (importation d'avant le 02/11) peut être reprise ici : elle devient celle de cet objet seul.
      const held = _briefTwins(key, b).filter(r => !_briefFor(_target(r.target)).ignored);
      if (held.length) {
        const names = held.map(r => `« ${_target(r.target).current.name} »`).join(', ');
        throw new StudioError(409, `Consigne identique à celle de ${names} : décrivez la forme et la matière propres à « ${t.current.name} ».`);
      }
    }
    conn().prepare(`INSERT INTO icon_studio_briefs (target, subject, details, palette, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(target) DO UPDATE SET subject = excluded.subject, details = excluded.details, palette = excluded.palette, updated_at = excluded.updated_at`)
      .run(key, b.subject, b.details, b.palette);
  }
  _event(key, 'brief', null, input.reset ? { reset: true } : null);
  return _briefFor(t);
}

function _checkBudget(images, extraUsd = 0) {
  if (_imagesToday() + images > MAX_IMAGES_PER_DAY) {
    throw new StudioError(429, `Quota : ${MAX_IMAGES_PER_DAY} images par 24 h (${_imagesToday()} déjà générées).`);
  }
  let cfg;
  try { cfg = config(); } catch (err) { throw new StudioError(503, `API d'images non configurée : ${oa().redact(String(err.message).replace(os.homedir(), '~'))}`); }
  const b = budget(cfg);
  const planned = images * b.reserve.usd + extraUsd;
  if (planned > b.remainingUsd + 1e-9) {
    const how = b.reserve.basis === 'measured'
      ? `${b.reserve.usd.toFixed(2)} USD réservés par image (plus cher des derniers coûts réels, ${b.reserve.measuredMaxUsd.toFixed(3)} USD, + 25 %)`
      : `${b.reserve.usd.toFixed(2)} USD réservés par image (estimation configurée DIG_IMAGE_EST_COST_USD)`;
    throw new StudioError(402, `Plafond de dépense IA atteint : la prochaine image n'est pas lancée. Il reste ${b.remainingUsd.toFixed(2)} USD sous le plafond, `
      + `il faut ${planned.toFixed(2)} USD (${how}${extraUsd ? ', contrôle du sujet compris' : ''}). Ce n'est pas le coût d'une image : `
      + `le cumul (${b.globalSpentUsd.toFixed(2)} USD) additionne toutes les générations depuis le début, scripts #22 et blocs compris. `
      + (b.limitedBy === 'studio'
        ? `Pour continuer, relevez la limite de l'atelier dans ⚙ Config → Budget IA (${b.studioSpentUsd.toFixed(2)} / ${b.studioCapUsd} USD).`
        : `Pour continuer, relevez le plafond du serveur (${b.globalSpentUsd.toFixed(2)} / ${b.globalCapUsd} USD) : DIG_IMAGE_BUDGET_USD dans ~/.config/dig/openai.env, pris en compte sans redémarrage.`));
  }
  return { cfg, planned };
}

function _logCall({ target, model, ok, error = null, cost, durationMs, usage = null, ledger = true }) {
  conn().prepare(`INSERT INTO icon_studio_calls (target, model, ok, error, cost_usd, cost_basis, duration_ms, usage) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(target, model ?? null, ok ? 1 : 0, error, cost.cost_usd, cost.basis, durationMs, usage ? JSON.stringify(usage) : null);
  if (!_fake && ledger) {
    oa().appendLedger({ at: new Date().toISOString(), source: 'admin-icons', target, model, ok, error: error ?? undefined,
      cost_usd: cost.cost_usd, cost_basis: cost.basis, duration_ms: durationMs, usage: usage ?? undefined });
  }
}

/** Un appel image + contrôles + stockage. Rend { sha } ou lève. Toujours journalisé. */
async function _generateOne(t, brief, { instruction = '', basedOn = null, acknowledged, batch = null } = {}) {
  const { cfg } = _checkBudget(1, _identity(t) ? _checkEst() : 0);
  const identity = _identity(t);
  const prompt = buildPrompt(t.kind, brief, instruction, identity);
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
  const meta = { kind: t.kind, prompt, promptVersion: t.kind === 'block' ? 'v1.0' : identity ? PROMPT_VERSION : 'v1.1', identity,
    brief: { subject: brief.subject, details: brief.details, palette: brief.palette, custom: !!brief.custom },
    model, params, reference: _reference() ? path.relative(ROOT, _reference()) : null, instruction: instruction || null, basedOn,
    ...(acknowledged ? { acknowledgedConflicts: acknowledged } : {}),
    costUsd: cost.cost_usd, costBasis: cost.basis,
    durationMs: Date.now() - started, checks: done.checks, masterSha256: done.masterSha256 };
  const { sha } = _store(t.key, 'ai', done.webp, meta);
  _event(t.key, 'generated', sha, { costUsd: cost.cost_usd, ...(identity ? { identity: identity.name } : {}), ...(instruction ? { instruction } : {}), ...(basedOn ? { basedOn } : {}), ...(batch ? { batch } : {}) });
  const check = identity ? await _checkSubject(t, sha, done.webp, brief) : null;
  return { sha, costUsd: cost.cost_usd + (check?.costUsd ?? 0), imageUsd: cost.cost_usd, durationMs: Date.now() - started, check };
}

// ── Contrôle du sujet : l'image représente-t-elle l'objet demandé ? ──────────
// Demande du propriétaire du 02/11 : réduire le temps d'intervention humaine. Chaque image d'objet ou de
// badge est décrite par un modèle texte avec vision (≈ 0,002 USD) ; une image qui ne correspond pas est
// signalée « à revoir ». Le contrôle n'empêche rien et ne décide rien : l'admin garde le dernier mot.

const _checkEst = () => {
  if (_fake) return 0;
  try { return require('./blockAi').status().estTextUsd ?? CHECK_EST_USD; } catch (_) { return CHECK_EST_USD; }
};

const CHECK_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['seen', 'matches', 'confidence'],
  properties: {
    seen: { type: 'string', description: 'What the image shows, in a few English words.' },
    matches: { type: 'boolean' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
};

async function _checkSubject(t, sha, webp, brief) {
  const id = _identity(t);
  const png = await require('sharp')(webp).png().toBuffer();
  const messages = [
    { role: 'system', content: 'You check icons for a mining video game. Judge only WHAT object is depicted, not the art style (stylized low-poly 3D facets are expected). '
      + 'Be strict about the characteristic shape: the right colour or material with the wrong shape does not match (for example a round faceted lump is a nugget, not a token or coin, which is a flat disc).' },
    { role: 'user', content: [
      { type: 'text', text: `Requested object: "${id.name}"${id.fr ? ` (French name: "${id.fr}")` : ''}. Visual description given to the artist: ${String(brief.subject ?? '').slice(0, 300)}. `
        + 'In seen, name the object a player would see and its overall shape, in a few words. '
        + 'matches = true if a player would immediately name the main kind of object with its usual shape (pencil, token, lantern, key…); '
        + 'ignore qualifiers such as worn, golden, miner\'s, pocket or ancient, and colours.' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}`, detail: 'low' } },
    ] },
  ];
  const started = Date.now();
  let out;
  try {
    if (_fake) {
      const r = _fake.check ? await _fake.check({ target: t.key, identity: id }) : { seen: 'test image', matches: true, confidence: 'high' };
      out = { data: r, model: 'fake-text', cost: { cost_usd: 0, basis: 'test' } };
    } else {
      out = await require('./blockAi').guardedJson({ kind: 'icon-subject-check', source: 'admin-icons', name: 'dig_icon_subject', schema: CHECK_SCHEMA, messages });
    }
  } catch (err) {
    const error = oa().redact(String(err.message || err)).slice(0, 200);
    _event(t.key, 'subject_check', sha, { error });
    return { error, costUsd: 0 };
  }
  // Coût déjà inscrit au journal partagé par blockAi : compté ici dans le budget de l'atelier seulement
  _logCall({ target: `check:${t.key}`, model: out.model, ok: true, cost: out.cost, durationMs: Date.now() - started, usage: out.usage ?? null, ledger: false });
  const d = out.data ?? {};
  const check = { matches: d.matches === true, seen: String(d.seen ?? '').slice(0, 160), confidence: ['high', 'medium', 'low'].includes(d.confidence) ? d.confidence : 'low',
    model: out.model, costUsd: out.cost.cost_usd };
  _event(t.key, 'subject_check', sha, check);
  return check;
}

/** Contrôle du sujet d'une image existante (propositions antérieures au contrôle automatique). */
async function checkAsset(key, sha) {
  const t = _target(key);
  if (!_identity(t)) throw new StudioError(400, 'Contrôle du sujet réservé aux objets et badges.');
  const row = conn().prepare('SELECT bytes FROM icon_studio_assets WHERE sha = ? AND target = ?').get(String(sha), key);
  if (!row) throw new StudioError(404, 'Image introuvable pour cette icône.');
  return _checkSubject(t, row.sha ?? String(sha), row.bytes, _briefFor(t));
}

/** Dernier contrôle du sujet de chaque image d'une cible. */
function _subjectChecks(key) {
  const out = {};
  for (const e of conn().prepare("SELECT asset_sha, details FROM icon_studio_events WHERE target = ? AND action = 'subject_check' ORDER BY id").all(key)) {
    out[e.asset_sha] = JSON.parse(e.details);
  }
  return out;
}

/**
 * Génère UNE image pour une cible, en arrière-plan (un appel ≈ 1 min : plus long que le délai du
 * proxy, d'où le suivi par GET /api/admin/icons/job). Consigne facultative (« plus sombre »…) ajoutée
 * au prompt ; « basedOn » = proposition refaite (provenance seulement, l'ancienne est conservée).
 * Budget, quota et configuration vérifiés AVANT l'appel ; une seule génération à la fois.
 */
function generate(key, { instruction = '', basedOn = null, acknowledge = [], client = null } = {}) {
  // Panel HTTP : la page doit être celle de la version en ligne (un onglet ouvert avant un déploiement
  // garde l'ancien code du panel, recette du 02/11) et viser la fiche affichée.
  _assertClient(client, key);
  _assertIdle();
  const t = _target(key);
  const consigne = _clean(instruction, INSTRUCTION_MAX);
  const from = basedOn ? _asset(key, String(basedOn)) : null;
  const brief = _briefFor(t);
  const ack = new Set((Array.isArray(acknowledge) ? acknowledge : []).map(String));
  const conflicts = _subjectConflicts(t, _subjectSources(consigne, brief));
  const blocking = conflicts.filter(c => c.strict || !ack.has(c.id));
  if (blocking.length) throw new StudioError(409, _conflictMessage(t, blocking), { code: 'subject_conflict', conflicts: blocking });
  const { planned } = _checkBudget(1, _identity(t) ? _checkEst() : 0);
  const job = { id: ++_jobSeq, kind: 'single', status: 'running', target: key, name: t.current.name, startedAt: new Date().toISOString(), finishedAt: null,
    estimatedUsd: +planned.toFixed(4), spentUsd: 0, instruction: consigne || null, basedOn: from, result: null, error: null,
    identity: _identity(t), acknowledged: conflicts.length ? conflicts.map(c => c.term) : undefined };
  _job = job;
  job.promise = (async () => {
    try {
      const r = await _generateOne(t, brief, { instruction: consigne, basedOn: from, acknowledged: job.acknowledged });
      job.result = { sha: r.sha, url: imageUrl(r.sha), check: r.check };
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

function _assertIdle() {
  if (_job && _job.status === 'running') {
    throw new StudioError(429, _job.kind === 'series' ? `Génération de la collection « ${_job.name} » en cours : patientez ou arrêtez-la.` : 'Une image est déjà en cours de génération : patientez.');
  }
}

function _assertClient(client, target) {
  if (!client) return;
  if (client.build !== APP_VERSION) {
    throw new StudioError(409, `Le panel affiché date d'une version précédente (${client.build || 'inconnue'} ; en ligne : ${APP_VERSION}). `
      + 'Rechargez la page (F5) puis relancez : aucune image n\'a été générée, rien n\'a été dépensé.', { code: 'stale_client', version: APP_VERSION });
  }
  if (client.target !== target) throw new StudioError(409, 'La demande ne correspond pas à la fiche affichée : rien n\'a été généré. Rouvrez la fiche.', { code: 'target_mismatch' });
}

// ── Collection entière : une image par objet, enchaînées (demande du 02/11) ──
// Seuls les objets sans image utilisable sont générés ; chaque objet est contrôlé comme une génération
// unitaire (conflit de sujet = ignoré sans dépense, plafond vérifié avant CHAQUE image, arrêt propre au
// plafond, jamais relevé). L'admin ne corrige ensuite que les objets signalés.

const _isV13 = v => typeof v === 'string' && /^v\d+\.\d+$/.test(v) && v.localeCompare(PROMPT_VERSION, undefined, { numeric: true }) >= 0;

/** Raison de ne pas générer un objet de la collection (null = à générer). */
function _seriesSkip(t) {
  if (t.current.image) return { state: 'has_image', text: 'image déjà dans le brouillon' };
  const statuses = _assetStatus(t.key), checks = _subjectChecks(t.key);
  for (const a of conn().prepare('SELECT sha, source, meta FROM icon_studio_assets WHERE target = ?').all(t.key)) {
    if (statuses[a.sha] === 'rejected') continue;
    const meta = JSON.parse(a.meta);
    if (_assetWarning(t, meta) || checks[a.sha]?.matches === false) continue;
    // Une proposition de l'ancien prompt ne compte pas : elle reste visible dans la fiche
    if (a.source === 'upload' || _isV13(meta.promptVersion)) return { state: 'has_proposal', text: 'proposition à examiner' };
  }
  const conflicts = _subjectConflicts(t, _subjectSources('', _briefFor(t)));
  if (conflicts.length) return { state: 'conflict', text: _conflictMessage(t, conflicts) };
  return null;
}

/** Plan d'une collection : objets à générer, objets ignorés (raison), coût estimé, budget. */
function seriesPlan(seriesId) {
  const c = _collectionContent();
  const series = c.series.find(s => s.id === seriesId);
  if (!series) throw new StudioError(404, 'Collection introuvable.');
  const items = c.items.filter(i => i.seriesId === seriesId && i.active !== false).map(i => {
    const t = _target(`item:${i.id}`);
    const skip = _seriesSkip(t);
    return { key: t.key, id: i.id, name: t.current.name, image: t.current.image, state: skip?.state ?? 'todo', reason: skip?.text ?? null };
  });
  const todo = items.filter(i => i.state === 'todo').length;
  let cfg = null, b = null;
  try { cfg = config(); b = budget(cfg); } catch (_) { /* API non configurée : signalé par status() */ }
  const perImage = cfg ? _imageReserve(cfg).usd + _checkEst() : null;
  const avg = conn().prepare("SELECT AVG(cost_usd) c, AVG(duration_ms) d FROM (SELECT cost_usd, duration_ms FROM icon_studio_calls WHERE ok = 1 AND target NOT LIKE 'check:%' ORDER BY id DESC LIMIT 20)").get();
  return { seriesId, name: series.names?.fr || seriesId, icon: series.icon, items, todo,
    estPerImageUsd: perImage, estTotalUsd: perImage == null ? null : +(todo * perImage).toFixed(2),
    measuredPerImageUsd: avg.c == null ? null : +avg.c.toFixed(4), measuredSeconds: avg.d == null ? null : Math.round(avg.d / 1000),
    remainingUsd: b?.remainingUsd ?? null, limitedBy: b?.limitedBy ?? null,
    // Images que le plafond permet avant l'arrêt (estimation configurée, prudente)
    affordable: perImage ? Math.min(todo, Math.floor((b.remainingUsd + 1e-9) / perImage)) : 0 };
}

function generateSeries(seriesId, { client = null } = {}) {
  _assertClient(client, `series:${seriesId}`);
  _assertIdle();
  const plan = seriesPlan(seriesId);
  if (!plan.todo) throw new StudioError(409, 'Aucun objet à générer dans cette collection : chaque objet a déjà une image ou une proposition à examiner.');
  _checkBudget(1, _checkEst());      // au moins une image possible, sinon refus immédiat expliqué
  const job = { id: ++_jobSeq, kind: 'series', status: 'running', target: `series:${seriesId}`, seriesId, name: plan.name,
    startedAt: new Date().toISOString(), finishedAt: null, estimatedUsd: plan.estTotalUsd, spentUsd: 0, cancelRequested: false, stopReason: null,
    items: plan.items.map(i => ({ key: i.key, name: i.name, state: i.state === 'todo' ? 'pending' : i.state, reason: i.reason,
      sha: null, url: null, costUsd: 0, durationMs: null, check: null, error: null })) };
  _job = job;
  job.promise = (async () => {
    for (const it of job.items) {
      if (it.state !== 'pending') continue;
      if (job.cancelRequested) { it.state = 'cancelled'; continue; }
      if (job.stopReason) { it.state = 'not_run'; it.reason = job.stopReason; continue; }
      it.state = 'running';
      try {
        const t = _target(it.key);
        const brief = _briefFor(t);
        // Consigne modifiée depuis le plan : mêmes contrôles qu'une génération unitaire
        const conflicts = _subjectConflicts(t, _subjectSources('', brief));
        if (conflicts.length) { it.state = 'conflict'; it.reason = _conflictMessage(t, conflicts); continue; }
        const r = await _generateOne(t, brief, { batch: job.id });
        Object.assign(it, { sha: r.sha, url: imageUrl(r.sha), costUsd: r.costUsd, durationMs: r.durationMs, check: r.check,
          state: r.check?.matches === false ? 'review' : 'done' });
        job.spentUsd = +(job.spentUsd + r.costUsd).toFixed(4);
      } catch (err) {
        if (err.status === 402 || err.status === 429 || err.status === 503) {
          // Plafond, quota ou API indisponible : arrêt propre, rien n'est relevé automatiquement
          it.state = 'not_run'; it.reason = err.message; job.stopReason = err.message;
        } else {
          it.state = 'failed'; it.error = err.message;
        }
      }
    }
    job.status = job.cancelRequested ? 'cancelled' : job.stopReason ? 'stopped' : 'done';
    job.finishedAt = new Date().toISOString();
  })();
  return jobView();
}

/** Arrêter une collection en cours après l'image en cours (aucun appel n'est interrompu ni perdu). */
function cancelJob() {
  if (!_job || _job.status !== 'running' || _job.kind !== 'series') throw new StudioError(409, 'Aucune génération de collection en cours.');
  _job.cancelRequested = true;
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
  const statuses = _assetStatus(key), checks = _subjectChecks(key);
  const assets = conn().prepare('SELECT sha, source, meta, created_at FROM icon_studio_assets WHERE target = ? ORDER BY created_at DESC, rowid DESC').all(key)
    .map(a => {
      const meta = JSON.parse(a.meta);
      return { sha: a.sha, url: imageUrl(a.sha), source: a.source, createdAt: a.created_at, status: statuses[a.sha] ?? 'candidate',
        model: meta.model ?? null, costUsd: meta.costUsd ?? 0, checks: meta.checks ?? null, prompt: meta.prompt ?? null,
        instruction: meta.instruction ?? null, basedOn: meta.basedOn ?? null,
        identity: meta.identity ?? null, promptVersion: meta.promptVersion ?? null, brief: meta.brief ?? null, warning: _assetWarning(t, meta),
        subjectCheck: checks[a.sha] ?? null, currentPrompt: _isV13(meta.promptVersion) || a.source === 'upload' || !meta.identity,
        inDraft: imageUrl(a.sha) === t.current.image, published: imageUrl(a.sha) === t.current.publishedImage };
    });
  const history = conn().prepare('SELECT id, action, asset_sha, details, created_at FROM icon_studio_events WHERE target = ? ORDER BY id DESC LIMIT 100').all(key)
    .map(e => ({ id: e.id, action: e.action, url: e.asset_sha ? imageUrl(e.asset_sha) : null, sha: e.asset_sha, details: e.details ? JSON.parse(e.details) : null, at: e.created_at }));
  const spent = conn().prepare('SELECT COALESCE(SUM(cost_usd), 0) s, COUNT(*) n FROM icon_studio_calls WHERE target = ?').get(key);
  const brief = _briefFor(t);
  // Objet de collection (#39) : consigne de repli tirée du nom et de l'histoire, et autres objets portant
  // exactement la même consigne enregistrée (une IA qui répète la même consigne pour toute une série).
  const itemExtra = t.kind === 'item' ? {
    defaultBrief: _defaultBrief('item', t.src),
    neverPublished: !collectionCatalog.getPublished().items.some(i => i.id === t.id),
    briefSharedWith: [...(brief.ignored?.sharedWith ?? brief.sharedWith ?? [])].sort(),
    briefIgnored: !!brief.ignored,
  } : {};
  const { conflicts: subjectConflicts, references: subjectReferences } = _subjectAnalysis(t, _subjectSources('', brief));
  return { ..._summary(t, { [key]: assets.length }), brief, prompt: buildPrompt(t.kind, brief, '', _identity(t)), identity: _identity(t), subjectConflicts, subjectReferences,
    assets, history, ...itemExtra,
    costUsd: +spent.s.toFixed(4), calls: spent.n, story: t.kind === 'item' ? t.src.stories?.fr ?? null : t.kind === 'badge' ? t.src.descriptions?.fr ?? null : null };
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
function apply(key, { sha = null, override = false, live = false, doubtful = false } = {}) {
  const t = _target(key);
  if (sha) {
    const row = conn().prepare('SELECT meta FROM icon_studio_assets WHERE sha = ? AND target = ?').get(String(sha), key);
    const w = row && _assetWarning(t, JSON.parse(row.meta));
    if (w && !doubtful) throw new StudioError(409, `${w.text} Conservation refusée sans confirmation explicite.`, { code: 'doubtful_asset' });
  }
  if (!t.applicable) throw new StudioError(409, 'Pictogramme d\'interface : application en jeu prévue avec le ticket #41 (stocké et prêt ici).');
  if (t.validation && !override) {
    throw new StudioError(409, `Icône validée (${t.validation.by === 'v1' ? 'bibliothèque v1' : 'atelier'}, ${t.validation.at}) : remplacement refusé sans accord explicite (« override »).`);
  }
  const url = sha ? imageUrl(_asset(key, sha)) : null;
  const before = t.current.image;
  // Badge (#38) : sans brouillon, l'image d'un badge ACTIF est visible tout de suite → accord explicite (« live »).
  if (t.kind === 'badge' && t.src.status === 'active' && !live) {
    throw new StudioError(409, 'Badge actif : la nouvelle image sera visible immédiatement par les joueurs. Confirmez (« live ») ou désactivez d\'abord le badge.');
  }
  if (t.kind === 'block') blockCatalog.upsertDraftType({ ...t.src, image: url });
  else if (t.kind === 'badge') badges.updateBadge(t.id, { image: url });
  else collectionCatalog.upsertDraftItem({ ...t.src, image: url });
  _event(key, sha ? 'applied' : 'reverted_to_emoji', sha, { before, after: url, override: !!override && !!t.validation, ...(doubtful ? { doubtful: true } : {}), ...(t.kind === 'badge' ? { live: t.src.status === 'active' } : {}) });
  if (t.kind === 'badge') return { target: getTarget(key), draft: t.src.status !== 'active', catalog: 'badges' };
  return { target: getTarget(key), draft: true, catalog: t.kind === 'block' ? 'blocks' : 'collections' };
}

function listCalls(limit = 50) {
  return conn().prepare('SELECT id, created_at, target, model, ok, error, cost_usd, cost_basis, duration_ms FROM icon_studio_calls ORDER BY id DESC LIMIT ?')
    .all(limit).map(c => ({ ...c, ok: !!c.ok }));
}

function overview() {
  return { status: status(), targets: listTargets(), job: jobView(), calls: listCalls(),
    series: _collectionContent().series.filter(x => x.active !== false).map(x => seriesPlan(x.id)),
    references: _references() };
}

/** Icônes validées servant d'étalon de cohérence (affichées à côté de chaque proposition). */
function _references() {
  const lib = _libraryV1();
  if (!lib) return [];
  return Object.entries(lib.materials).filter(([, e]) => e.validated).map(([id, e]) => ({ id, url: `/${lib.base}${e.webp['256']}`, validated: e.validated }));
}

/**
 * Lecture du sujet pendant la saisie (aucun appel IA, aucune écriture) : précision et consigne en cours
 * de frappe, analysées par la même règle que la génération. Le serveur reste seul juge au moment de générer.
 */
function subjectCheck(key, { instruction = '', subject = null, details = null } = {}) {
  const t = _target(key);
  const saved = _briefFor(t);
  const brief = subject === null && details === null ? saved
    : { custom: true, subject: _clean(subject ?? saved.subject, 300), details: _clean(details ?? saved.details, 600) };
  return _subjectAnalysis(t, _subjectSources(_clean(instruction, INSTRUCTION_MAX), brief));
}

module.exports = {
  StudioError, UI_TARGETS, init, status, setStudioBudget, listTargets, getTarget, setBrief, generate, jobView, waitJob,
  upload, mark, apply, subjectCheck, reserveFromCosts, listCalls, overview, seriesPlan, generateSeries, cancelJob, checkAsset, PROMPT_VERSION, getImage, buildPrompt, setFakeTransport, fakeIconPng, imageUrl,
};
