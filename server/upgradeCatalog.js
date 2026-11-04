/**
 * server/upgradeCatalog.js — Améliorations administrables et suspension d'urgence (#69).
 *
 * Deux mécanismes distincts :
 *
 * 1. Barème versionné (même principe que les reliques #64 et les blocs #37) :
 *   - versions publiées en ajout seul (`upgrade_catalog_versions`) ; la version 1 est la conversion
 *     à l'identique des six améliorations du jeu, relues dans public/js/upgrades.js, balance.js et
 *     blocks.js (prix, niveaux, effet par niveau) et i18n.js (noms FR/EN/NL/ES) ;
 *   - un brouillon unique validé côté serveur, comparé à la version en vigueur, publié
 *     explicitement (note), retour arrière par republication ; journal en ajout seul ;
 *   - l'ensemble des améliorations est FIXE : chacune correspond à du code moteur (un nouveau type
 *     d'effet exige du code, un champ sans effet réel est exclu par le ticket) ;
 *   - seuls les champs que le moteur lit sont éditables : prix en pièces, nombre de niveaux (jamais
 *     en baisse, borné par l'anti-bot #25 pour la pioche et l'Auto-Dig), effet par niveau du Sac et
 *     de la Chance, paliers du reroll, noms, emoji de repli. Les prix en gemmes de l'Auto-Dig sont
 *     verrouillés : le registre de gemmes serveur (#49, gemLedger.js) les applique.
 *
 * 2. Suspension d'urgence (`upgrade_controls`), immédiate, sans brouillon ni redéploiement :
 *   - trois interrupteurs indépendants par amélioration : nouveaux achats, effets, affichage ;
 *   - niveaux et sauvegardes des joueurs JAMAIS modifiés : l'effet suspendu est calculé comme au
 *     niveau de départ et revient tel quel à la réactivation ;
 *   - motif obligatoire, confirmation par l'identifiant pour les effets et l'affichage, limite de
 *     fréquence, journal en ajout seul (`upgrade_control_audit`) ;
 *   - le jeu relit l'état toutes les minutes (GET /api/upgrades/catalog), sans déconnexion ni
 *     perte du bloc en cours.
 *
 * À la livraison, aucune amélioration n'est suspendue et la version 1 reproduit le jeu : aucun
 * changement économique.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const db = require('./db');

const LANGS = [...require('./languages').CONTENT_LANGS];   // registre des langues (#59)
const COST_MAX = 10_000_000;
const IDS = ['pickaxe', 'luck', 'bag', 'autodig', 'fragment_shop', 'block_reroll'];

/**
 * Description moteur de chaque amélioration : niveau de départ, bornes du nombre de niveaux, effet
 * réel (calcul, paramètre éditable éventuel) et comportement quand ses effets sont suspendus.
 */
const TYPES = {
  pickaxe: {
    label: 'Pioche', kind: 'seasonal', firstLevel: 1, levels: [15, 15],
    effect: 'Dégâts par clic', unit: 'dégâts/clic',
    formula: 'Dégâts d\'un clic = niveau de pioche + bonus « dégâts par clic » des reliques.',
    locked: 'Nombre de niveaux et dégâts par niveau verrouillés : l\'anti-bot (#25) suppose au plus 15 + 10 = 25 dégâts par clic.',
    suspend: 'Dégâts calculés comme au niveau 1 (+ reliques) ; le niveau possédé reste enregistré.',
  },
  luck: {
    label: 'Chance', kind: 'seasonal', firstLevel: 0, levels: [12, 20],
    effect: 'Poids des blocs rares', unit: 'poids/niveau', perLevel: { min: 0.01, max: 0.2 },
    formula: 'Poids des blocs rares, épiques et légendaires × (1 + niveau × effet par niveau + bonus des reliques).',
    suspend: 'Tirage calculé comme au niveau 0 (reliques conservées) ; s\'applique aux blocs suivants.',
  },
  bag: {
    label: 'Sac', kind: 'seasonal', firstLevel: 0, levels: [12, 20],
    effect: 'Pièces des blocs', unit: '×/niveau', perLevel: { min: 0.05, max: 0.5 },
    formula: 'Pièces d\'un bloc × (1 + niveau × effet par niveau) × (1 + bonus des reliques) × réglage admin × boost.',
    suspend: 'Pièces calculées comme au niveau 0 (multiplicateur ×1).',
  },
  autodig: {
    label: 'Auto-Dig', kind: 'seasonal', firstLevel: 0, levels: [6, 6], gems: true,
    effect: 'Dégâts automatiques', unit: 'dégâts/s',
    formula: 'Dégâts automatiques par seconde = niveau d\'Auto-Dig + bonus « auto-dig » des reliques (gains hors ligne compris).',
    locked: 'Nombre de niveaux et prix en gemmes verrouillés : anti-bot (#25, 6 + 14 = 20 dégâts/s) et registre de gemmes serveur (#49).',
    suspend: 'Auto-Dig calculé comme au niveau 0 (reliques conservées), gains hors ligne compris.',
  },
  fragment_shop: {
    label: 'Fragments', kind: 'instant', firstLevel: 0, levels: [10, 20],
    effect: 'Fragment de relique', unit: 'fragment/achat',
    formula: 'Chaque achat donne immédiatement 1 fragment de relique ; compteur remis à zéro chaque saison.',
    suspend: null,
  },
  block_reroll: {
    label: 'Reroll bloc', kind: 'instant', firstLevel: 0, levels: [99, 99], reroll: true,
    effect: 'Nouveau bloc', unit: 'bloc/achat',
    formula: 'Chaque achat remplace immédiatement le bloc courant ; prix = base × 2^(achats ÷ palier), arrondi au palier inférieur.',
    suspend: null,
  },
};
const REROLL_LIMITS = { base: [1, 1_000_000], every: [1, 99] };

/** Suspension : trois interrupteurs (true = suspendu). */
const CONTROL_KEYS = ['purchases', 'effects', 'hidden'];
const CONTROL_LABELS = { purchases: 'nouveaux achats', effects: 'effets', hidden: 'affichage' };
const CONTROL_RATE = { max: 30, windowMs: 60 * 60_000 };   // changements d'état par heure (toutes améliorations)

class CatalogError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

const conn = () => db.getDb();

// ── Barème d'origine (code du jeu) ────────────────────────────────────────────

let _origin = null;

function _load(files, names) {
  const ctx = { window: {}, navigator: { language: 'fr' }, GameState: { upgrades: {}, relicBonuses: {} }, t: k => k, Math, Object, Array, Number, String, JSON };
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8'), ctx, { filename: f });
  return vm.runInContext(`({ ${names.join(', ')} })`, ctx);
}

/** Les six améliorations du jeu, au format catalogue (valeurs identiques). */
function originUpgrades() {
  if (!_origin) {
    const { Balance, Upgrades, Blocks } = _load(['balance.js', 'blocks.js', 'upgrades.js'], ['Balance', 'Upgrades', 'Blocks']);
    const { I18n } = _load(['i18n.js'], ['I18n']);
    const names = key => Object.fromEntries(LANGS.map(l => [l, I18n.get(key, l) ?? '']));
    _origin = Upgrades.DEFS.map(d => {
      const ty = TYPES[d.id];
      const u = { id: d.id, icon: d.icon, names: names(d.name), maxLevel: d.maxLevel };
      if (ty.reroll) {
        u.reroll = { base: Balance.getRerollCost(0).coins, every: 10 };
        return u;
      }
      const costs = [], gems = [];
      for (let lvl = ty.firstLevel; lvl < d.maxLevel; lvl++) {
        const c = d.getCost(lvl);
        costs.push(c.coins);
        gems.push(c.gems);
      }
      u.costs = costs;
      if (ty.gems) u.gems = gems;
      if (d.id === 'bag') u.perLevel = Math.round((d.effect(1) - d.effect(0)) * 10000) / 10000;
      if (d.id === 'luck') u.perLevel = Blocks.LUCK_PER_LEVEL;
      return u;
    });
  }
  return JSON.parse(JSON.stringify(_origin));
}

// ── Schéma ────────────────────────────────────────────────────────────────────

/** Tables (ajout seul) et version 1 = barème d'origine. Idempotent. */
function init() {
  conn().exec(`
    CREATE TABLE IF NOT EXISTS upgrade_catalog_versions (
      version      INTEGER PRIMARY KEY,
      upgrades     TEXT    NOT NULL,
      source       TEXT    NOT NULL CHECK (source IN ('origin', 'publish', 'rollback')),
      note         TEXT,
      from_version INTEGER,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS upgrade_catalog_draft (
      id          INTEGER PRIMARY KEY CHECK (id = 1),
      upgrades    TEXT    NOT NULL,
      based_on    INTEGER NOT NULL,
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS upgrade_catalog_audit (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      action      TEXT    NOT NULL,
      version     INTEGER,
      details     TEXT
    );
    CREATE TABLE IF NOT EXISTS upgrade_controls (
      upgrade_id  TEXT    PRIMARY KEY,
      purchases   INTEGER NOT NULL DEFAULT 0,
      effects     INTEGER NOT NULL DEFAULT 0,
      hidden      INTEGER NOT NULL DEFAULT 0,
      reason      TEXT,
      via         TEXT,
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS upgrade_control_audit (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      upgrade_id  TEXT    NOT NULL,
      before      TEXT    NOT NULL,
      after       TEXT    NOT NULL,
      reason      TEXT    NOT NULL,
      via         TEXT,
      holders     INTEGER
    );
    CREATE TRIGGER IF NOT EXISTS trg_upgrade_catalog_versions_no_update BEFORE UPDATE ON upgrade_catalog_versions
      BEGIN SELECT RAISE(ABORT, 'upgrade_catalog_versions est en ajout seul (#69)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_upgrade_catalog_versions_no_delete BEFORE DELETE ON upgrade_catalog_versions
      BEGIN SELECT RAISE(ABORT, 'upgrade_catalog_versions est en ajout seul (#69)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_upgrade_catalog_audit_no_update BEFORE UPDATE ON upgrade_catalog_audit
      BEGIN SELECT RAISE(ABORT, 'upgrade_catalog_audit est en ajout seul (#69)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_upgrade_catalog_audit_no_delete BEFORE DELETE ON upgrade_catalog_audit
      BEGIN SELECT RAISE(ABORT, 'upgrade_catalog_audit est en ajout seul (#69)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_upgrade_control_audit_no_update BEFORE UPDATE ON upgrade_control_audit
      BEGIN SELECT RAISE(ABORT, 'upgrade_control_audit est en ajout seul (#69)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_upgrade_control_audit_no_delete BEFORE DELETE ON upgrade_control_audit
      BEGIN SELECT RAISE(ABORT, 'upgrade_control_audit est en ajout seul (#69)'); END;
  `);
  conn().transaction(() => {
    if (conn().prepare('SELECT 1 FROM upgrade_catalog_versions LIMIT 1').get()) return;
    conn().prepare("INSERT INTO upgrade_catalog_versions (version, upgrades, source, note) VALUES (1, ?, 'origin', ?)")
      .run(JSON.stringify(originUpgrades()), 'Conversion à l\'identique des six améliorations du jeu (#69)');
    _audit('migrate', 1, { upgrades: IDS.length });
  })();
  _invalidate();
}

function _audit(action, version, details) {
  conn().prepare('INSERT INTO upgrade_catalog_audit (action, version, details) VALUES (?, ?, ?)')
    .run(action, version, details == null ? null : JSON.stringify(details));
}

// ── Lecture ───────────────────────────────────────────────────────────────────

let _published = null;
let _controls = null;
let _public = null;
function _invalidate() { _published = null; _controls = null; _public = null; }

function _row(r) {
  return r ? { version: r.version, upgrades: JSON.parse(r.upgrades), source: r.source, note: r.note, fromVersion: r.from_version, createdAt: r.created_at } : null;
}

function getPublished() {
  if (!_published) _published = _row(conn().prepare('SELECT * FROM upgrade_catalog_versions ORDER BY version DESC LIMIT 1').get());
  return _published ?? { version: 0, upgrades: originUpgrades(), source: 'origin' };
}

function getVersion(version) {
  return _row(conn().prepare('SELECT * FROM upgrade_catalog_versions WHERE version = ?').get(Number(version)));
}

function listVersions() {
  return conn().prepare('SELECT version, source, note, from_version AS fromVersion, created_at AS createdAt FROM upgrade_catalog_versions ORDER BY version DESC').all();
}

function getDraft() {
  const r = conn().prepare('SELECT * FROM upgrade_catalog_draft WHERE id = 1').get();
  return r ? { upgrades: JSON.parse(r.upgrades), basedOn: r.based_on, updatedAt: r.updated_at } : null;
}

/** Niveau maximum publié par amélioration (toutes versions) : le nombre de niveaux ne baisse jamais. */
function _publishedMaxLevels() {
  const max = new Map();
  for (const r of conn().prepare('SELECT upgrades FROM upgrade_catalog_versions').all()) {
    for (const x of JSON.parse(r.upgrades)) max.set(x.id, Math.max(max.get(x.id) ?? 0, x.maxLevel));
  }
  return max;
}

const _noControl = () => ({ purchases: false, effects: false, hidden: false });

/** État de suspension de chaque amélioration (toutes présentes, false par défaut). */
function getControls() {
  if (!_controls) {
    _controls = Object.fromEntries(IDS.map(id => [id, { ..._noControl(), reason: null, updatedAt: null }]));
    for (const r of conn().prepare('SELECT * FROM upgrade_controls').all()) {
      if (!_controls[r.upgrade_id]) continue;
      _controls[r.upgrade_id] = { purchases: !!r.purchases, effects: !!r.effects, hidden: !!r.hidden, reason: r.reason, updatedAt: r.updated_at };
    }
  }
  return _controls;
}

/**
 * Catalogue public consommé par le jeu (GET /api/upgrades/catalog) : barème en vigueur et
 * suspensions (sans motif : il reste interne). `controlsRev` change à chaque bascule.
 */
function publicCatalog() {
  if (!_public) {
    const p = getPublished();
    const controls = {};
    for (const [id, c] of Object.entries(getControls())) {
      if (c.purchases || c.effects || c.hidden) controls[id] = { purchases: c.purchases, effects: c.effects, hidden: c.hidden };
    }
    const rev = conn().prepare('SELECT MAX(id) AS n FROM upgrade_control_audit').get().n ?? 0;
    _public = { version: p.version, controlsRev: rev, upgrades: p.upgrades, controls };
  }
  return _public;
}

// ── Validation ────────────────────────────────────────────────────────────────

const _round = (n) => Math.round(n * 10000) / 10000;
function _text(v, max) { return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max); }

/** Normalise une amélioration saisie ; lève CatalogError au premier défaut bloquant. */
function normalizeUpgrade(input) {
  if (!input || typeof input !== 'object') throw new CatalogError(400, 'Amélioration invalide.');
  const id = String(input.id ?? '');
  const ty = TYPES[id];
  if (!ty) throw new CatalogError(400, `« ${id} » : amélioration inconnue (un nouveau type d'amélioration exige du code moteur).`);
  const where = `« ${ty.label} »`;
  const origin = originUpgrades().find(u => u.id === id);
  const maxLevel = Number(input.maxLevel);
  const [lo, hi] = ty.levels;
  if (!Number.isInteger(maxLevel) || maxLevel < lo || maxLevel > hi) {
    throw new CatalogError(400, lo === hi ? `${where} : ${lo} niveaux (verrouillé). ${ty.locked ?? ''}`.trim() : `${where} : nombre de niveaux entier de ${lo} à ${hi}.`);
  }
  const names = {};
  for (const l of LANGS) names[l] = _text(input.names?.[l], 40);
  if (!names.fr) throw new CatalogError(400, `${where} : nom français obligatoire.`);
  const icon = _text(input.icon, 8);
  if (!icon) throw new CatalogError(400, `${where} : icône (emoji) obligatoire, elle sert de repli au pictogramme.`);
  const out = { id, icon, names, maxLevel };
  if (ty.reroll) {
    const base = Number(input.reroll?.base), every = Number(input.reroll?.every);
    if (!Number.isInteger(base) || base < REROLL_LIMITS.base[0] || base > REROLL_LIMITS.base[1]) throw new CatalogError(400, `${where} : prix de base entier de ${REROLL_LIMITS.base[0]} à ${REROLL_LIMITS.base[1]}.`);
    if (!Number.isInteger(every) || every < REROLL_LIMITS.every[0] || every > REROLL_LIMITS.every[1]) throw new CatalogError(400, `${where} : palier de doublement entier de ${REROLL_LIMITS.every[0]} à ${REROLL_LIMITS.every[1]} achats.`);
    out.reroll = { base, every };
    return out;
  }
  const n = maxLevel - ty.firstLevel;
  const costs = Array.isArray(input.costs) ? input.costs.map(Number) : [];
  if (costs.length !== n) throw new CatalogError(400, `${where} : un prix par niveau à acheter (${n}).`);
  const gems = ty.gems ? origin.gems : null;
  costs.forEach((c, i) => {
    const lvl = ty.firstLevel + i + 1;
    const min = gems && gems[i] > 0 ? 0 : 1;   // niveau payé en gemmes : 0 pièce admis
    if (!Number.isInteger(c) || c < min || c > COST_MAX) throw new CatalogError(400, `${where} : prix du niveau ${lvl} entier de ${min} à ${COST_MAX.toLocaleString('fr-FR')} pièces.`);
  });
  out.costs = costs;
  if (ty.gems) {
    const g = Array.isArray(input.gems) ? input.gems.map(Number) : [];
    if (JSON.stringify(g) !== JSON.stringify(gems)) throw new CatalogError(400, `${where} : prix en gemmes verrouillés (${gems.join(' / ')}). ${ty.locked}`);
    out.gems = [...gems];
  }
  if (ty.perLevel) {
    const p = Number(input.perLevel);
    if (!Number.isFinite(p) || p < ty.perLevel.min || p > ty.perLevel.max) throw new CatalogError(400, `${where} : effet par niveau de ${ty.perLevel.min} à ${ty.perLevel.max}.`);
    out.perLevel = _round(p);
  }
  return out;
}

/**
 * Valide un barème complet (brouillon avant publication).
 * @returns {{ errors: string[], warnings: string[], upgrades: object[] }}
 */
function validateCatalog(raw, { maxLevels = _publishedMaxLevels() } = {}) {
  const errors = [], warnings = [];
  if (!Array.isArray(raw)) return { errors: ['Barème vide.'], warnings, upgrades: [] };
  const upgrades = [];
  const seen = new Set();
  for (const r of raw) {
    try {
      const x = normalizeUpgrade(r);
      if (seen.has(x.id)) { errors.push(`« ${x.id} » en double.`); continue; }
      seen.add(x.id);
      upgrades.push(x);
    } catch (err) {
      if (!(err instanceof CatalogError)) throw err;
      errors.push(err.message);
    }
  }
  for (const id of IDS) if (!seen.has(id)) errors.push(`« ${TYPES[id].label} » manquante : les six améliorations du moteur sont obligatoires.`);
  for (const x of upgrades) {
    const prev = maxLevels.get(x.id);
    if (prev && x.maxLevel < prev) errors.push(`« ${TYPES[x.id].label} » : ${prev} niveaux déjà publiés, le nombre de niveaux ne peut pas baisser (niveaux possédés).`);
    for (const l of LANGS) if (!x.names[l]) warnings.push(`« ${TYPES[x.id].label} » : nom ${l.toUpperCase()} manquant (repli sur la traduction intégrée).`);
    if (x.costs) {
      const drop = x.costs.findIndex((c, i) => i > 0 && c > 0 && x.costs[i - 1] > c);
      if (drop > 0) warnings.push(`« ${TYPES[x.id].label} » : le prix du niveau ${TYPES[x.id].firstLevel + drop + 1} est inférieur au précédent.`);
    }
  }
  upgrades.sort((a, b) => IDS.indexOf(a.id) - IDS.indexOf(b.id));
  return { errors, warnings, upgrades };
}

/** Écarts entre deux barèmes, champ par champ. */
function diff(from, to) {
  const before = new Map(from.map(x => [x.id, x]));
  const changes = [];
  for (const x of to) {
    const b = before.get(x.id);
    if (!b) { changes.push({ id: x.id, kind: 'added' }); continue; }
    const fields = Object.keys(x).filter(k => JSON.stringify(x[k] ?? null) !== JSON.stringify(b[k] ?? null))
      .map(k => ({ field: k, before: b[k] ?? null, after: x[k] ?? null }));
    if (fields.length) changes.push({ id: x.id, kind: 'changed', fields });
  }
  return changes;
}

/**
 * Usage par amélioration et par niveau (sauvegardes cloud, lecture seule) : mesure l'impact d'une
 * modification ou d'une suspension. La pioche compte à partir du niveau 2 (le niveau 1 est gratuit).
 */
function holders() {
  const out = Object.fromEntries(IDS.map(id => [id, {}]));
  let saves = 0;
  for (const r of conn().prepare('SELECT data FROM user_saves').iterate()) {
    let data;
    try { data = JSON.parse(r.data); } catch (_) { continue; }
    saves++;
    for (const id of IDS) {
      const level = Number(id === 'pickaxe' ? data?.pickaxeLevel : data?.upgrades?.[id]);
      if (!Number.isInteger(level) || level <= TYPES[id].firstLevel) continue;
      out[id][level] = (out[id][level] ?? 0) + 1;
    }
  }
  return { saves, byUpgrade: out };
}
const _holderTotal = (h, id) => Object.values(h.byUpgrade[id] ?? {}).reduce((s, n) => s + n, 0);

// ── Brouillon, publication, retour arrière ────────────────────────────────────

function _saveDraft(upgrades, basedOn) {
  conn().prepare(`INSERT INTO upgrade_catalog_draft (id, upgrades, based_on, updated_at) VALUES (1, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET upgrades = excluded.upgrades, based_on = excluded.based_on, updated_at = excluded.updated_at`)
    .run(JSON.stringify(upgrades), basedOn);
}

function _dropIfClean() {
  const draft = getDraft();
  const current = getPublished();
  if (!draft || draft.basedOn !== current.version || diff(current.upgrades, draft.upgrades).length) return false;
  conn().prepare('DELETE FROM upgrade_catalog_draft WHERE id = 1').run();
  _audit('draft_clean', null, null);
  return true;
}

/** Modifie une amélioration dans le brouillon (créé depuis la version en vigueur si absent). */
function upsertDraftUpgrade(input) {
  const x = normalizeUpgrade(input);
  return conn().transaction(() => {
    const current = getPublished();
    const draft = getDraft() ?? { upgrades: JSON.parse(JSON.stringify(current.upgrades)), basedOn: current.version };
    const i = draft.upgrades.findIndex(r => r.id === x.id);
    const before = i >= 0 ? draft.upgrades[i] : null;
    if (i >= 0) draft.upgrades[i] = x; else draft.upgrades.push(x);
    _saveDraft(draft.upgrades, draft.basedOn);
    _audit('draft_update', null, { id: x.id, changes: before ? diff([before], [x])[0]?.fields ?? [] : null });
    return { upgrade: x, draftDropped: _dropIfClean() };
  })();
}

/** Remet UNE amélioration à son état en vigueur dans le brouillon. */
function revertDraftUpgrade(id) {
  return conn().transaction(() => {
    const draft = getDraft();
    const pub = getPublished().upgrades.find(r => r.id === id);
    const i = draft && pub ? draft.upgrades.findIndex(r => r.id === id) : -1;
    if (i < 0 || !diff([pub], [draft.upgrades[i]]).length) throw new CatalogError(409, `« ${id} » n'a aucune modification dans le brouillon.`);
    draft.upgrades[i] = pub;
    _saveDraft(draft.upgrades, draft.basedOn);
    _audit('draft_revert', null, { id });
    return { upgrade: pub, draftDropped: _dropIfClean() };
  })();
}

function discardDraft() {
  const r = conn().prepare('DELETE FROM upgrade_catalog_draft WHERE id = 1').run();
  if (r.changes) _audit('draft_discard', null, null);
  return r.changes > 0;
}

function _insertVersion(version, upgrades, source, note, from) {
  conn().prepare('INSERT INTO upgrade_catalog_versions (version, upgrades, source, note, from_version) VALUES (?, ?, ?, ?, ?)')
    .run(version, JSON.stringify(upgrades), source, note, from);
  conn().prepare('DELETE FROM upgrade_catalog_draft WHERE id = 1').run();
}

/** Publication atomique du brouillon (refusée si invalide ou si la version a changé entre-temps). */
function publishDraft({ note, expectedBasedOn } = {}) {
  const result = conn().transaction(() => {
    const draft = getDraft();
    if (!draft) throw new CatalogError(409, 'Aucun brouillon à publier.');
    const current = getPublished();
    if (draft.basedOn !== current.version || (expectedBasedOn != null && Number(expectedBasedOn) !== current.version)) {
      throw new CatalogError(409, `Le brouillon part de la version ${draft.basedOn}, la version en vigueur est la ${current.version} : rechargez.`);
    }
    const v = validateCatalog(draft.upgrades);
    if (v.errors.length) throw new CatalogError(400, 'Brouillon invalide.', v.errors);
    const changes = diff(current.upgrades, v.upgrades);
    if (!changes.length) throw new CatalogError(409, 'Aucun changement par rapport à la version en vigueur.');
    const text = _text(note, 300);
    if (text.length < 5) throw new CatalogError(400, 'Note de publication obligatoire (raison, accord du propriétaire).');
    const version = current.version + 1;
    _insertVersion(version, v.upgrades, 'publish', text, current.version);
    _audit('publish', version, { changes });
    return { version, changes, warnings: v.warnings };
  })();
  _invalidate();
  return result;
}

/**
 * Retour arrière : publie une NOUVELLE version reprenant une version antérieure. Le nombre de
 * niveaux ne baisse jamais : une amélioration allongée depuis garde ses niveaux et prix au-delà.
 */
function rollbackTo(target, { note } = {}) {
  const result = conn().transaction(() => {
    const old = getVersion(target);
    if (!old) throw new CatalogError(404, 'Version introuvable.');
    const current = getPublished();
    if (old.version === current.version) throw new CatalogError(409, 'Cette version est déjà en vigueur.');
    const now = new Map(current.upgrades.map(x => [x.id, x]));
    const upgrades = old.upgrades.map(x => {
      const cur = now.get(x.id);
      if (!cur || !x.costs || cur.maxLevel <= x.maxLevel) return x;
      const keep = x.maxLevel - TYPES[x.id].firstLevel;
      return { ...x, maxLevel: cur.maxLevel, costs: [...x.costs, ...cur.costs.slice(keep)] };
    });
    const v = validateCatalog(upgrades);
    if (v.errors.length) throw new CatalogError(400, 'Retour arrière impossible.', v.errors);
    const version = current.version + 1;
    _insertVersion(version, v.upgrades, 'rollback', _text(note, 300) || `Retour à la version ${old.version}`, old.version);
    _audit('rollback', version, { to: old.version, changes: diff(current.upgrades, v.upgrades) });
    return { version, restored: old.version };
  })();
  _invalidate();
  return result;
}

function listAudit(limit = 100) {
  return conn().prepare('SELECT * FROM upgrade_catalog_audit ORDER BY id DESC LIMIT ?').all(limit)
    .map(a => ({ ...a, details: a.details ? JSON.parse(a.details) : null }));
}

// ── Suspension d'urgence ──────────────────────────────────────────────────────

function _normControl(input, id) {
  const ty = TYPES[id];
  const c = {};
  for (const k of CONTROL_KEYS) c[k] = input?.[k] === true;
  if (c.effects && !ty.suspend) {
    throw new CatalogError(400, `« ${ty.label} » : effet immédiat à l'achat, rien à suspendre après coup — suspendez les nouveaux achats.`);
  }
  if (c.hidden) c.purchases = true;   // une carte masquée ne peut pas être achetée
  return c;
}

/**
 * Conséquences d'un changement de suspension, sans rien appliquer (aperçu du panel et des tests).
 * @returns {{ id, before, after, changed: string[], holders: number, consequences: string[], requiresConfirm: boolean }}
 */
function previewControl(id, input, h = holders()) {
  const ty = TYPES[id];
  if (!ty) throw new CatalogError(404, 'Amélioration inconnue.');
  const cur = getControls()[id];
  const before = { purchases: cur.purchases, effects: cur.effects, hidden: cur.hidden };
  const after = _normControl(input, id);
  const changed = CONTROL_KEYS.filter(k => before[k] !== after[k]);
  const owners = _holderTotal(h, id);
  const out = [];
  if (after.purchases && !before.purchases) out.push(`Nouveaux achats bloqués pour tous les joueurs (bouton « Suspendu »). ${owners} joueur(s) gardent leur niveau.`);
  if (!after.purchases && before.purchases) out.push('Nouveaux achats de nouveau possibles au prix du barème en vigueur.');
  if (after.effects && !before.effects) out.push(`Effet suspendu pour ${owners} joueur(s) : ${ty.suspend} Niveaux et sauvegardes inchangés.`);
  if (!after.effects && before.effects) out.push(`Effet rétabli pour ${owners} joueur(s), au niveau qu'ils possèdent.`);
  if (after.hidden && !before.hidden) out.push('Carte masquée dans l\'onglet Améliorations (achats bloqués) ; niveaux conservés, effets inchangés sauf suspension des effets.');
  if (!after.hidden && before.hidden) out.push('Carte de nouveau affichée.');
  if (changed.length) out.push('Appliqué par le jeu en moins d\'une minute, sans déconnexion ni perte du bloc en cours ; réversible à tout moment.');
  const requiresConfirm = (after.effects && !before.effects) || (after.hidden && !before.hidden);
  return { id, before, after, changed, holders: owners, consequences: out, requiresConfirm };
}

const _controlHits = [];

/**
 * Applique une suspension (ou une réactivation) immédiatement. Motif obligatoire ; suspendre les
 * effets ou l'affichage exige de recopier l'identifiant ; au plus CONTROL_RATE.max bascules par heure.
 */
function setControl(id, input, { reason, confirm, via = null, now = Date.now() } = {}) {
  const h = holders();
  const p = previewControl(id, input, h);
  if (!p.changed.length) throw new CatalogError(409, 'Aucun changement : cet état est déjà en vigueur.');
  const why = _text(reason, 300);
  if (why.length < 5) throw new CatalogError(400, 'Motif obligatoire (au moins 5 caractères) : il figure au journal.');
  if (p.requiresConfirm && String(confirm ?? '').trim() !== id) {
    throw new CatalogError(400, `Confirmation : recopiez l'identifiant « ${id} » pour suspendre les effets ou l'affichage.`);
  }
  while (_controlHits.length && now - _controlHits[0] > CONTROL_RATE.windowMs) _controlHits.shift();
  if (_controlHits.length >= CONTROL_RATE.max) throw new CatalogError(429, `Trop de bascules (${CONTROL_RATE.max} par heure) : réessayez plus tard.`);
  conn().transaction(() => {
    conn().prepare(`INSERT INTO upgrade_controls (upgrade_id, purchases, effects, hidden, reason, via, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(upgrade_id) DO UPDATE SET purchases = excluded.purchases, effects = excluded.effects, hidden = excluded.hidden,
        reason = excluded.reason, via = excluded.via, updated_at = excluded.updated_at`)
      .run(id, +p.after.purchases, +p.after.effects, +p.after.hidden, why, via);
    conn().prepare('INSERT INTO upgrade_control_audit (upgrade_id, before, after, reason, via, holders) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, JSON.stringify(p.before), JSON.stringify(p.after), why, via, p.holders);
  })();
  _controlHits.push(now);
  _invalidate();
  return { ...p, reason: why };
}

function listControlAudit(limit = 100) {
  return conn().prepare('SELECT * FROM upgrade_control_audit ORDER BY id DESC LIMIT ?').all(limit)
    .map(a => ({ ...a, before: JSON.parse(a.before), after: JSON.parse(a.after) }));
}

/** Vue admin : barème en vigueur, brouillon validé, versions, usage, suspensions, moteur. */
function buildAdminView() {
  const published = getPublished();
  const draft = getDraft();
  const validation = draft ? validateCatalog(draft.upgrades) : null;
  const changes = draft ? diff(published.upgrades, validation.upgrades) : [];
  const pending = draft && (changes.length || draft.basedOn !== published.version);
  const cfg = db.getAdminConfig();
  const mult = Number(cfg.upgrade_cost_multiplier ?? 1);
  return {
    published,
    draft: pending ? { ...draft, errors: validation.errors, warnings: validation.warnings, changes } : null,
    publishedMaxLevels: Object.fromEntries(_publishedMaxLevels()),
    versions: listVersions(),
    holders: holders(),
    controls: getControls(),
    controlAudit: listControlAudit(50),
    types: TYPES,
    controlLabels: CONTROL_LABELS,
    costMultiplier: Number.isFinite(mult) && mult > 0 ? mult : 1,
    langs: LANGS,
    limits: { costMax: COST_MAX, reroll: REROLL_LIMITS, controlRate: CONTROL_RATE },
  };
}

function _resetRateForTests() { _controlHits.length = 0; }

module.exports = {
  CatalogError, TYPES, IDS, LANGS, CONTROL_KEYS,
  init, originUpgrades, getPublished, getVersion, getDraft, listVersions, publicCatalog, getControls,
  normalizeUpgrade, validateCatalog, diff, holders,
  upsertDraftUpgrade, revertDraftUpgrade, discardDraft, publishDraft, rollbackTo, listAudit,
  previewControl, setControl, listControlAudit, buildAdminView, _resetRateForTests,
};
