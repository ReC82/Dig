/**
 * server/economyRules.js
 * Règles économiques versionnées (#49, lot 1.2 — Admin → Économie), sur le modèle des tables de
 * récompenses (#37, rewardTables.js) : version 1 = valeurs en vigueur relevées à la migration,
 * brouillon unique → validation → simulation comparative → publication explicite avec note →
 * retour arrière (nouvelle version au contenu d'une ancienne) ; versions et journal en ajout seul.
 *
 * IMPORTANT (décision du propriétaire du 04/11) : ces règles sont une RÉFÉRENCE pilotable. Le jeu
 * ne les lit pas encore : gemmes par bloc, coffres de la mine, série, missions, Auto-Dig et courbe
 * des pièces restent ceux du code du jeu ; plafond et limites des coffres restent ceux de ⚙ Config
 * (#20) et des tables de récompenses (#37). Publier une version n'a donc AUCUN effet en jeu ;
 * l'application effective sera un changement séparé, après validation des résultats. Seule la
 * boutique en gemmes (gemShop.js, désactivée par défaut) lit ses prix ici.
 *
 * Contenu :
 *   gems:   { perBlock: {id: n}, mineChest: {commun|rare|epique: {chance %, gems}}, missionSetBonus,
 *             dailyStreak: [7 × n], seasonCap, autodig: {"3".."6": n} }
 *   coins:  { curve: [{ until: m | null, slope }] }  ([] = actuelle : +5 %/m sans limite)
 *   shopChests: { simple|rare|antique: { maxPerSeason: n | null } }
 *   gemShop: { items: { <id>: { price, enabled } } }
 */

'use strict';

const db = require('./db');

const MINE_CHESTS = ['commun', 'rare', 'epique'];
const SHOP_CHESTS = ['simple', 'rare', 'antique'];
const AUTODIG_LEVELS = ['3', '4', '5', '6'];
/** Articles de la boutique en gemmes à l'étude (décision du 04/11) ; prix = simulation seulement. */
const GEM_SHOP_ITEMS = {
  skin_golden:   { kind: 'cosmetic', price: 150 },
  skin_diamond:  { kind: 'cosmetic', price: 350 },
  auto_collect:  { kind: 'comfort',  price: 30 },
  coin_boost_30: { kind: 'boost',    price: 8, mult: 2, minutes: 30 },
};
const LIMITS = {
  perBlock: [0, 20], chance: [0, 100], chestGems: [0, 20], missionSetBonus: [0, 20], streak: [0, 50],
  seasonCap: [0, 10_000], autodig: [0, 1_000], slope: [0, 0.2], until: [2, 100_000],
  maxPerSeason: [1, 1000], price: [1, 100_000], curveSegments: 4,
};

class EconomyRulesError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

const conn = () => db.getDb();

// ── Valeurs en vigueur (lues dans le code du jeu et les réglages) ─────────────

/** Règles telles qu'appliquées aujourd'hui par le jeu : base de la version 1. */
function currentValues() {
  const gemLedger    = require('./gemLedger');
  const rewardTables = require('./rewardTables');
  const { Daily, Balance } = _gameScripts();
  const cap = parseInt(db.getAdminConfig().gems_cap ?? '100', 10);
  const shop = rewardTables.getPublished().tables.shop;
  return {
    gems: {
      perBlock: gemLedger.gemValues(),
      mineChest: Object.fromEntries(MINE_CHESTS.map(id => [id, { chance: 0, gems: 0 }])),
      missionSetBonus: 0,
      dailyStreak: Daily.REWARDS.map(r => r.gems),
      seasonCap: Number.isSafeInteger(cap) && cap >= 0 ? cap : 100,
      autodig: Object.fromEntries(AUTODIG_LEVELS.map(l => [l, Balance.AUTODIG[Number(l) - 1].gems])),
    },
    coins: { curve: [] },
    shopChests: Object.fromEntries(SHOP_CHESTS.map(id => [id, { maxPerSeason: shop[id]?.maxPerSeason ?? null }])),
    gemShop: { items: Object.fromEntries(Object.entries(GEM_SHOP_ITEMS).map(([id, d]) => [id, { price: d.price, enabled: true }])) },
  };
}

let _scripts = null;
function _gameScripts() {
  if (!_scripts) {
    const fs = require('fs'), path = require('path'), vm = require('vm');
    const ctx = vm.createContext({ Math, Object, Array, Number, String, JSON, Date, GameState: {}, t: k => k });
    for (const f of ['balance.js', 'daily.js']) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8'), ctx, { filename: f });
    }
    _scripts = JSON.parse(vm.runInContext('JSON.stringify({ Daily: { REWARDS: Daily.REWARDS }, Balance: { AUTODIG: Balance.AUTODIG } })', ctx));
  }
  return _scripts;
}

/**
 * Préréglages applicables au brouillon (rapport #49 du 03/11 et décision du 04/11). Ils ne
 * modifient que les champs indiqués ; rien n'est publié.
 */
const PRESETS = {
  bareme_a: {
    label: 'Barème A (direction cible du 04/11)',
    apply: r => {
      Object.assign(r.gems.perBlock, { rubis: 1, saphir: 1, emeraude: 2, amethyste: 2, diamant: 3, cristal_ancien: 3 });
      r.gems.mineChest.epique = { chance: 10, gems: 1 };
      r.gems.missionSetBonus = 1;
      r.gems.seasonCap = 150;
    },
  },
  limites_20_10: { label: 'Limites des coffres 20 / 10 par saison', apply: r => { r.shopChests.simple.maxPerSeason = 20; r.shopChests.rare.maxPerSeason = 10; } },
  courbe_b: { label: 'Courbe b : +5 %/m jusqu\'à 200 m puis +2 %/m', apply: r => { r.coins.curve = [{ until: 200, slope: 0.05 }, { until: null, slope: 0.02 }]; } },
  courbe_c: { label: 'Courbe c : +5 %/m jusqu\'à 200 m puis +1 %/m', apply: r => { r.coins.curve = [{ until: 200, slope: 0.05 }, { until: null, slope: 0.01 }]; } },
  courbe_actuelle: { label: 'Courbe actuelle (+5 %/m sans limite)', apply: r => { r.coins.curve = []; } },
};

// ── Base ──────────────────────────────────────────────────────────────────────

function init() {
  conn().exec(`
    CREATE TABLE IF NOT EXISTS economy_rule_versions (
      version      INTEGER PRIMARY KEY,
      rules        TEXT    NOT NULL,
      source       TEXT    NOT NULL CHECK (source IN ('origin', 'publish', 'rollback')),
      note         TEXT,
      from_version INTEGER,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS economy_rule_draft (
      id          INTEGER PRIMARY KEY CHECK (id = 1),
      rules       TEXT    NOT NULL,
      based_on    INTEGER NOT NULL,
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS economy_rule_audit (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      action      TEXT    NOT NULL,
      version     INTEGER,
      details     TEXT
    );
    CREATE TRIGGER IF NOT EXISTS trg_economy_rule_versions_no_update BEFORE UPDATE ON economy_rule_versions
      BEGIN SELECT RAISE(ABORT, 'economy_rule_versions est en ajout seul (#49)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_economy_rule_versions_no_delete BEFORE DELETE ON economy_rule_versions
      BEGIN SELECT RAISE(ABORT, 'economy_rule_versions est en ajout seul (#49)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_economy_rule_audit_no_update BEFORE UPDATE ON economy_rule_audit
      BEGIN SELECT RAISE(ABORT, 'economy_rule_audit est en ajout seul (#49)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_economy_rule_audit_no_delete BEFORE DELETE ON economy_rule_audit
      BEGIN SELECT RAISE(ABORT, 'economy_rule_audit est en ajout seul (#49)'); END;
  `);
  conn().transaction(() => {
    if (conn().prepare('SELECT 1 FROM economy_rule_versions LIMIT 1').get()) return;
    const origin = currentValues();
    conn().prepare("INSERT INTO economy_rule_versions (version, rules, source, note) VALUES (1, ?, 'origin', ?)")
      .run(JSON.stringify(origin), 'Valeurs en vigueur relevées à la migration (#49) — aucune règle changée');
    _audit('migrate', 1, null);
    // Barème A préparé en BROUILLON (décision du 04/11) : jamais publié automatiquement
    const draft = structuredClone(origin);
    PRESETS.bareme_a.apply(draft);
    conn().prepare("INSERT INTO economy_rule_draft (id, rules, based_on) VALUES (1, ?, 1)").run(JSON.stringify(draft));
    _audit('draft_preset', null, { preset: 'bareme_a', changes: diff(origin, draft) });
  })();
  _invalidate();
}

function _audit(action, version, details) {
  conn().prepare('INSERT INTO economy_rule_audit (action, version, details) VALUES (?, ?, ?)')
    .run(action, version ?? null, details ? JSON.stringify(details) : null);
}

let _publishedCache = null;
function _invalidate() { _publishedCache = null; }

function _row(r) {
  return r && { version: r.version, rules: JSON.parse(r.rules), source: r.source, note: r.note,
    fromVersion: r.from_version, createdAt: r.created_at };
}

function getPublished() {
  if (!_publishedCache) {
    _publishedCache = _row(conn().prepare('SELECT * FROM economy_rule_versions ORDER BY version DESC LIMIT 1').get());
  }
  return structuredClone(_publishedCache);
}

function getVersion(version) {
  return _row(conn().prepare('SELECT * FROM economy_rule_versions WHERE version = ?').get(version));
}

function listVersions(limit = 50) {
  return conn().prepare('SELECT version, source, note, from_version, created_at FROM economy_rule_versions ORDER BY version DESC LIMIT ?')
    .all(limit).map(r => ({ version: r.version, source: r.source, note: r.note, fromVersion: r.from_version, createdAt: r.created_at }));
}

function getDraft() {
  const r = conn().prepare('SELECT * FROM economy_rule_draft WHERE id = 1').get();
  return r ? { rules: JSON.parse(r.rules), basedOn: r.based_on, updatedAt: r.updated_at } : null;
}

// ── Validation ────────────────────────────────────────────────────────────────

const _num = (v, [min, max]) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const _int = (v, range) => Number.isInteger(v) && _num(v, range);
const _obj = v => v && typeof v === 'object' && !Array.isArray(v);

/** Normalise un contenu complet ; `errors` bloque l'enregistrement et la publication. */
function validateRules(raw) {
  const errors = [], warnings = [];
  if (!_obj(raw) || !_obj(raw.gems) || !_obj(raw.coins) || !_obj(raw.shopChests) || !_obj(raw.gemShop)) {
    return { rules: null, errors: ['Contenu invalide : { gems, coins, shopChests, gemShop } attendu.'], warnings };
  }
  const int = (v, range, label) => {
    const n = Number(v);
    if (v === '' || v == null || !_int(n, range)) { errors.push(`${label} : entier entre ${range[0]} et ${range[1]} attendu.`); return range[0]; }
    return n;
  };
  const g = raw.gems;
  const known = Object.keys(currentValues().gems.perBlock);
  const perBlock = {};
  for (const id of known) perBlock[id] = int(g.perBlock?.[id], LIMITS.perBlock, `Gemmes par bloc « ${id} »`);
  const extra = Object.keys(g.perBlock ?? {}).filter(k => !known.includes(k));
  if (extra.length) warnings.push(`Blocs ignorés (pas des gemmes du catalogue publié) : ${extra.join(', ')}.`);
  const mineChest = {};
  for (const id of MINE_CHESTS) {
    const c = g.mineChest?.[id] ?? {};
    const chance = Number(c.chance);
    if (!_num(chance, LIMITS.chance)) errors.push(`Coffre de la mine ${id} : chance entre 0 et 100 %.`);
    mineChest[id] = { chance: _num(chance, LIMITS.chance) ? Math.round(chance * 100) / 100 : 0,
      gems: int(c.gems, LIMITS.chestGems, `Coffre de la mine ${id} : gemmes`) };
    if (mineChest[id].chance > 0 && mineChest[id].gems === 0) warnings.push(`Coffre de la mine ${id} : chance > 0 mais 0 gemme.`);
  }
  if (!Array.isArray(g.dailyStreak) || g.dailyStreak.length !== 7) errors.push('Série quotidienne : 7 valeurs attendues.');
  const dailyStreak = Array.from({ length: 7 }, (_, i) => int(g.dailyStreak?.[i], LIMITS.streak, `Série quotidienne, jour ${i + 1}`));
  const autodig = Object.fromEntries(AUTODIG_LEVELS.map(l => [l, int(g.autodig?.[l], LIMITS.autodig, `Auto-Dig niveau ${l}`)]));
  const rules = {
    gems: {
      perBlock, mineChest, dailyStreak, autodig,
      missionSetBonus: int(g.missionSetBonus, LIMITS.missionSetBonus, 'Bonus trois missions'),
      seasonCap: int(g.seasonCap, LIMITS.seasonCap, 'Plafond de fin de saison'),
    },
    coins: { curve: [] },
    shopChests: {},
    gemShop: { items: {} },
  };
  const curve = raw.coins.curve;
  if (!Array.isArray(curve) || curve.length > LIMITS.curveSegments) errors.push(`Courbe des pièces : au plus ${LIMITS.curveSegments} segments.`);
  else {
    let prev = 1;
    curve.forEach((s, i) => {
      const last = i === curve.length - 1;
      const until = s?.until == null || s.until === '' ? null : Number(s.until);
      const slope = Number(s?.slope);
      if (!_num(slope, LIMITS.slope)) errors.push(`Courbe, segment ${i + 1} : pente entre 0 et ${LIMITS.slope[1]} par mètre.`);
      if (until === null && !last) errors.push(`Courbe, segment ${i + 1} : seul le dernier segment peut être sans limite.`);
      if (until !== null && (!_int(until, LIMITS.until) || until <= prev)) errors.push(`Courbe, segment ${i + 1} : profondeur de fin entière > ${prev}.`);
      if (last && until !== null) errors.push('Courbe : le dernier segment doit être sans limite (jusqu\'au fond).');
      rules.coins.curve.push({ until, slope: Math.round(slope * 10_000) / 10_000 });
      if (until !== null) prev = until;
    });
  }
  for (const id of SHOP_CHESTS) {
    const v = raw.shopChests[id]?.maxPerSeason;
    const max = v == null || v === '' ? null : Number(v);
    if (max !== null && !_int(max, LIMITS.maxPerSeason)) errors.push(`Coffre ${id} : limite vide (illimité) ou entière entre 1 et ${LIMITS.maxPerSeason[1]}.`);
    rules.shopChests[id] = { maxPerSeason: max };
  }
  for (const id of Object.keys(GEM_SHOP_ITEMS)) {
    const it = raw.gemShop.items?.[id] ?? {};
    rules.gemShop.items[id] = { price: int(it.price, LIMITS.price, `Boutique en gemmes « ${id} » : prix`), enabled: it.enabled !== false };
  }
  if (rules.gems.autodig['3'] > rules.gems.seasonCap) warnings.push('Auto-Dig niveau 3 plus cher que le plafond de saison.');
  return { rules, errors, warnings };
}

// ── Écarts ────────────────────────────────────────────────────────────────────

/** Écarts lisibles champ par champ : [{ path, before, after }]. */
function diff(from, to) {
  const out = [];
  const walk = (a, b, p) => {
    if (_obj(a) && _obj(b)) {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], p ? `${p}.${k}` : k);
    } else if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) {
      out.push({ path: p, before: a ?? null, after: b ?? null });
    }
  };
  walk(from, to, '');
  return out;
}

// ── Brouillon, publication, retour arrière ────────────────────────────────────

function saveDraft(raw) {
  const v = validateRules(raw);
  if (!v.rules) throw new EconomyRulesError(400, 'Contenu invalide.', v.errors);
  if (v.errors.length) throw new EconomyRulesError(400, 'Brouillon refusé.', v.errors);
  return conn().transaction(() => {
    const current = getPublished();
    const basedOn = getDraft()?.basedOn ?? current.version;
    const changes = diff(current.rules, v.rules);
    if (!changes.length && basedOn === current.version) {
      const dropped = conn().prepare('DELETE FROM economy_rule_draft WHERE id = 1').run().changes;
      if (dropped) _audit('draft_clean', null, null);
      return { draft: null, warnings: v.warnings, changes };
    }
    conn().prepare(`INSERT INTO economy_rule_draft (id, rules, based_on, updated_at) VALUES (1, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET rules = excluded.rules, based_on = excluded.based_on, updated_at = excluded.updated_at`)
      .run(JSON.stringify(v.rules), basedOn);
    _audit('draft_save', null, { changes });
    return { draft: getDraft(), warnings: v.warnings, changes };
  })();
}

/** Applique un préréglage au brouillon (ou à la version publiée s'il n'y a pas de brouillon). */
function applyPreset(id) {
  const preset = PRESETS[id];
  if (!preset) throw new EconomyRulesError(400, `Préréglage inconnu : ${id}.`);
  const base = getDraft()?.rules ?? getPublished().rules;
  preset.apply(base);
  const out = saveDraft(base);
  _audit('draft_preset', null, { preset: id });
  return out;
}

function discardDraft() {
  const r = conn().prepare('DELETE FROM economy_rule_draft WHERE id = 1').run();
  if (r.changes) _audit('draft_discard', null, null);
  return r.changes > 0;
}

function _note(note) { return String(note ?? '').trim().slice(0, 300) || null; }

/** Publication explicite : note obligatoire (référence ; sans effet en jeu, voir l'en-tête). */
function publishDraft({ note, expectedBasedOn } = {}) {
  if (!_note(note)) throw new EconomyRulesError(400, 'Une note de publication est obligatoire.');
  const result = conn().transaction(() => {
    const draft = getDraft();
    if (!draft) throw new EconomyRulesError(409, 'Aucun brouillon à publier.');
    const current = getPublished();
    if (draft.basedOn !== current.version || (expectedBasedOn != null && expectedBasedOn !== current.version)) {
      throw new EconomyRulesError(409, `Le brouillon part de la version ${draft.basedOn}, la version en vigueur est la ${current.version} : rechargez.`);
    }
    const v = validateRules(draft.rules);
    if (v.errors.length) throw new EconomyRulesError(400, 'Brouillon invalide.', v.errors);
    const changes = diff(current.rules, v.rules);
    if (!changes.length) throw new EconomyRulesError(409, 'Aucun changement par rapport à la version en vigueur.');
    const version = current.version + 1;
    conn().prepare("INSERT INTO economy_rule_versions (version, rules, source, note, from_version) VALUES (?, ?, 'publish', ?, ?)")
      .run(version, JSON.stringify(v.rules), _note(note), current.version);
    conn().prepare('DELETE FROM economy_rule_draft WHERE id = 1').run();
    _audit('publish', version, { changes });
    return { version, changes, warnings: v.warnings };
  })();
  _invalidate();
  return result;
}

function rollbackTo(target, { note } = {}) {
  const result = conn().transaction(() => {
    const old = getVersion(target);
    if (!old) throw new EconomyRulesError(404, 'Version introuvable.');
    const current = getPublished();
    if (old.version === current.version) throw new EconomyRulesError(409, 'Cette version est déjà en vigueur.');
    const v = validateRules(old.rules);
    if (v.errors.length) throw new EconomyRulesError(400, 'Retour arrière impossible.', v.errors);
    const version = current.version + 1;
    conn().prepare("INSERT INTO economy_rule_versions (version, rules, source, note, from_version) VALUES (?, ?, 'rollback', ?, ?)")
      .run(version, JSON.stringify(v.rules), _note(note) || `Retour à la version ${old.version}`, old.version);
    _audit('rollback', version, { to: old.version, changes: diff(current.rules, v.rules) });
    return { version, restored: old.version };
  })();
  _invalidate();
  return result;
}

function listAudit(limit = 100) {
  return conn().prepare('SELECT * FROM economy_rule_audit ORDER BY id DESC LIMIT ?').all(limit)
    .map(a => ({ ...a, details: a.details ? JSON.parse(a.details) : null }));
}

// ── Simulation comparative (processus séparé : le serveur de jeu n'est jamais bloqué) ─────────

const SIM_TIMEOUT_MS = 45_000;
let _simRunning = false;

/**
 * Lance tools/balance/economy-rules-sim.js dans un processus enfant : `before` et `after` (règles
 * validées) simulés sur les mêmes graines, `runs` joueurs par profil (bornés).
 */
function simulateCompare(before, after, { runs = 300, seasons = 1 } = {}) {
  if (_simRunning) return Promise.reject(new EconomyRulesError(409, 'Une simulation est déjà en cours.'));
  runs = Math.min(Math.max(Number.isInteger(runs) ? runs : 300, 50), 2000);
  seasons = Math.min(Math.max(Number.isInteger(seasons) ? seasons : 1, 1), 4);
  const { execFile } = require('child_process');
  const path = require('path');
  _simRunning = true;
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [path.join(__dirname, '..', 'tools', 'balance', 'economy-rules-sim.js')],
      { timeout: SIM_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, env: { PATH: process.env.PATH, NODE_ENV: 'simulation' } },
      (err, stdout) => {
        _simRunning = false;
        if (err) return reject(new EconomyRulesError(500, err.killed ? 'Simulation trop longue (interrompue).' : 'Échec de la simulation.'));
        try { resolve(JSON.parse(stdout)); } catch { reject(new EconomyRulesError(500, 'Résultat de simulation illisible.')); }
      });
    child.stdin.end(JSON.stringify({ before, after, runs, seasons }));
  });
}

// ── Vue admin ─────────────────────────────────────────────────────────────────

/** Version publiée, brouillon (validé, écarts), écarts entre la version publiée et le jeu actuel. */
function buildAdminView() {
  const published = getPublished();
  const draft = getDraft();
  let draftView = null;
  if (draft) {
    const v = validateRules(draft.rules);
    draftView = { rules: draft.rules, basedOn: draft.basedOn, updatedAt: draft.updatedAt, errors: v.errors,
      warnings: v.warnings, changes: v.rules ? diff(published.rules, v.rules) : [] };
  }
  return {
    appliedToGame: false,
    published,
    draft: draftView,
    // Ce que le jeu applique réellement aujourd'hui, comparé à la version publiée
    gameValues: currentValues(),
    gameVsPublished: diff(currentValues(), published.rules),
    versions: listVersions(),
    presets: Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label })),
    gemShopItems: GEM_SHOP_ITEMS,
    limits: LIMITS,
  };
}

module.exports = {
  EconomyRulesError, MINE_CHESTS, SHOP_CHESTS, AUTODIG_LEVELS, GEM_SHOP_ITEMS, LIMITS, PRESETS,
  init, currentValues, getPublished, getVersion, getDraft, listVersions,
  validateRules, diff, saveDraft, applyPreset, discardDraft, publishDraft, rollbackTo, listAudit,
  simulateCompare, buildAdminView,
};
