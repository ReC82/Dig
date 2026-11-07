/**
 * server/rewardTables.js
 * Tables de récompenses administrables (#37, objectif 4) : contenu des coffres de la boutique
 * (tirés par le serveur, chestShop.js) et des coffres trouvés en minant (tirés par le jeu,
 * public/js/chests.js, table reçue par GET /api/shop/chests).
 *
 * Même cycle que le catalogue de blocs : version 1 = conversion à l'identique des tables codées
 * (aucune probabilité changée), brouillon unique → validation → simulation → publication
 * atomique, retour arrière (nouvelle version au contenu d'une ancienne), journal en ajout seul.
 * Prix des coffres de la boutique (#88) : la valeur appliquée en jeu reste admin_config.chest_cost_*
 * (lue par economy.js / chestShop.js, overrides existants conservés). Elle ne se modifie plus que
 * par ce module : un prix proposé va dans le brouillon (`shop[id].cost`) avec les récompenses, et la
 * publication écrit, dans la MÊME transaction SQLite, la nouvelle version (prix effectifs inclus) et
 * admin_config. Le retour arrière vers une version qui mémorise ses prix les restaure aussi (la v1,
 * antérieure à #88, n'en a pas : le prix actuel est gardé). Une table dont l'espérance en pièces
 * atteint son prix est refusée (boucle de profit).
 *
 * Contenu : { shop: { simple|rare|antique: { cost?, maxPerSeason, table } }, mined: { commun|rare|epique: table } }
 * Ligne : { weight, type: coins{min,max,jackpot?} | relics{amount} | boost{mult,minutes} | collection{amount:1} }
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const db        = require('./db');
const chestShop = require('./chestShop');
const { getEconomy } = require('./economy');

const SHOP_IDS  = ['simple', 'rare', 'antique'];
const MINED_IDS = ['commun', 'rare', 'epique'];
const SHOP_TYPES  = ['coins', 'relics', 'boost', 'collection'];
const MINED_TYPES = ['coins', 'relics', 'boost'];
const MAX_ROWS = 20;
const LIMITS = {
  weight: [0.0001, 1_000_000], coins: [1, 1_000_000_000], relics: [1, 10_000],
  mult: [1.1, 5], minutes: [1, 240], maxPerSeason: [1, 1000], cost: [1, 1_000_000_000],
};
/** Au-delà de cette part du prix rendue en pièces, avertissement (la boucle de profit est à 100 %). */
const HIGH_RATIO = 0.8;

class RewardError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

const conn = () => db.getDb();

// ── Tables d'origine ──────────────────────────────────────────────────────────

let _origin = null;

/** Tables en vigueur avant #37 : chestShop.SHOP_CHESTS et Chests.TABLES de public/js/chests.js. */
function originTables() {
  if (!_origin) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'chests.js'), 'utf8');
    const ctx = vm.createContext({ Math });
    vm.runInContext(`${src}\n;this.__tables = JSON.parse(JSON.stringify(Chests.TABLES));`, ctx);
    _origin = {
      shop: Object.fromEntries(SHOP_IDS.map(id => [id,
        { maxPerSeason: chestShop.SHOP_CHESTS[id].maxPerSeason, table: chestShop.SHOP_CHESTS[id].table }])),
      mined: Object.fromEntries(MINED_IDS.map(id => [id, ctx.__tables[id]])),
    };
  }
  return structuredClone(_origin);
}

// ── Préréglages « rareté des fragments » (#49, demande du propriétaire du 06/11) ──────────────

/**
 * Barèmes proposés pour rendre les fragments plus rares, chiffrés par
 * tools/balance/fragment-rarity-sim.js. Un préréglage ne fait que REMPLIR LE BROUILLON : rien
 * n'est publié, le jeu garde la version en vigueur tant que l'administrateur ne publie pas.
 * Gemmes inchangées (elles relèvent d'Admin → Économie) ; le poids retiré aux fragments passe
 * aux pièces et aux boosts ; l'espérance en pièces d'un coffre de boutique reste < 80 % de son prix.
 *  - prudente (P) : ≈ −50 % de fragments par coffre miné, boutique limitée à 20 / 10 / 5 par saison
 *    avec des quantités divisées par deux ;
 *  - rare (R)     : ≈ −70 % par coffre miné, plus aucun fragment dans le coffre simple, coffre rare
 *    et antique limités et fortement réduits : la conversion pièces → fragments est bornée à
 *    ≈ 2 % des besoins des reliques par saison.
 */
const NON_CONFORM = 'Non conforme à la décision du 04/11 (#49, rappelée le 07/11) : des coffres achetés avec des pièces y donnent encore des fragments.';
const PRESETS = {
  fragments_prudente: {
    label: 'Fragments — variante prudente (P)',
    conform: false, note: NON_CONFORM,
    tables: {
      shop: {
        simple:  { maxPerSeason: 20, table: [
          { weight: 45, type: 'coins',  min: 500, max: 1000 },
          { weight: 15, type: 'relics', amount: 1 },
          { weight: 30, type: 'boost',  mult: 2, minutes: 5 },
          { weight: 10, type: 'coins',  min: 2000, max: 3500, jackpot: true },
        ] },
        rare:    { maxPerSeason: 10, table: [
          { weight: 40, type: 'coins',      min: 5000, max: 9000 },
          { weight: 30, type: 'relics',     amount: 2 },
          { weight: 12, type: 'relics',     amount: 4 },
          { weight:  8, type: 'boost',      mult: 2, minutes: 15 },
          { weight:  8, type: 'collection', amount: 1 },
          { weight:  2, type: 'coins',      min: 15000, max: 25000, jackpot: true },
        ] },
        antique: { maxPerSeason: 5, table: [
          { weight: 30, type: 'coins',      min: 25000, max: 40000 },
          { weight: 25, type: 'relics',     amount: 10 },
          { weight: 18, type: 'relics',     amount: 15 },
          { weight: 10, type: 'boost',      mult: 3, minutes: 20 },
          { weight: 12, type: 'collection', amount: 1 },
          { weight:  4, type: 'relics',     amount: 25 },
          { weight:  1, type: 'coins',      min: 100000, max: 150000, jackpot: true },
        ] },
      },
      mined: {
        commun: [
          { weight: 55, type: 'coins',  min: 80,  max: 180 },
          { weight: 35, type: 'coins',  min: 200, max: 400 },
          { weight: 10, type: 'relics', amount: 1 },
        ],
        rare: [
          { weight: 50, type: 'coins',  min: 300, max: 600 },
          { weight: 15, type: 'relics', amount: 1 },
          { weight: 30, type: 'boost',  mult: 2, minutes: 3 },
          { weight:  5, type: 'relics', amount: 2 },
        ],
        epique: [
          { weight: 35, type: 'coins',  min: 600, max: 1200 },
          { weight: 30, type: 'boost',  mult: 3, minutes: 5 },
          { weight: 20, type: 'relics', amount: 1 },
          { weight: 15, type: 'relics', amount: 2 },
        ],
      },
    },
  },
  fragments_rare: {
    label: 'Fragments — variante nettement plus rare (R)',
    conform: false, note: NON_CONFORM,
    tables: {
      shop: {
        simple:  { maxPerSeason: 20, table: [
          { weight: 45, type: 'coins',  min: 500, max: 1000 },
          { weight: 45, type: 'boost',  mult: 2, minutes: 5 },
          { weight: 10, type: 'coins',  min: 2000, max: 3500, jackpot: true },
        ] },
        rare:    { maxPerSeason: 10, table: [
          { weight: 45, type: 'coins',      min: 5000, max: 9000 },
          { weight: 25, type: 'relics',     amount: 1 },
          { weight:  5, type: 'relics',     amount: 2 },
          { weight: 15, type: 'boost',      mult: 2, minutes: 15 },
          { weight:  8, type: 'collection', amount: 1 },
          { weight:  2, type: 'coins',      min: 15000, max: 25000, jackpot: true },
        ] },
        antique: { maxPerSeason: 5, table: [
          { weight: 35, type: 'coins',      min: 25000, max: 40000 },
          { weight: 25, type: 'relics',     amount: 4 },
          { weight: 15, type: 'relics',     amount: 6 },
          { weight: 18, type: 'boost',      mult: 3, minutes: 20 },
          { weight:  6, type: 'collection', amount: 1 },
          { weight:  1, type: 'coins',      min: 100000, max: 150000, jackpot: true },
        ] },
      },
      mined: {
        commun: [
          { weight: 60, type: 'coins',  min: 80,  max: 180 },
          { weight: 35, type: 'coins',  min: 200, max: 400 },
          { weight:  5, type: 'relics', amount: 1 },
        ],
        rare: [
          { weight: 55, type: 'coins',  min: 300, max: 600 },
          { weight: 12, type: 'relics', amount: 1 },
          { weight: 30, type: 'boost',  mult: 2, minutes: 3 },
          { weight:  3, type: 'relics', amount: 2 },
        ],
        epique: [
          { weight: 40, type: 'coins',  min: 600, max: 1200 },
          { weight: 35, type: 'boost',  mult: 3, minutes: 5 },
          { weight: 15, type: 'relics', amount: 1 },
          { weight: 10, type: 'relics', amount: 2 },
        ],
      },
    },
  },
  // #88 (07/11) : aucun fragment dans les trois coffres de la boutique (décision du 04/11) ; le poids
  // des fragments passe aux boosts et aux objets de collection, l'espérance en pièces reste < 80 % du
  // prix de production ; coffres minés = P (seule source de fragments avec le minage).
  boutique_sans_fragments: {
    label: 'Boutique sans fragments (S) — conforme à la décision du 04/11',
    conform: true,
    note: 'Aucun fragment dans les coffres simple, rare et antique ; coffres trouvés en minant comme P. Seule exception codée : un objet de collection tiré alors que la collection est complète rend 5 fragments.',
    tables: {
      shop: {
        simple:  { maxPerSeason: 20, table: [
          { weight: 45, type: 'coins',  min: 500, max: 1000 },
          { weight: 45, type: 'boost',  mult: 2, minutes: 5 },
          { weight: 10, type: 'coins',  min: 2000, max: 3500, jackpot: true },
        ] },
        rare:    { maxPerSeason: 10, table: [
          { weight: 45, type: 'coins',      min: 5000, max: 9000 },
          { weight: 35, type: 'boost',      mult: 2, minutes: 15 },
          { weight: 18, type: 'collection', amount: 1 },
          { weight:  2, type: 'coins',      min: 15000, max: 25000, jackpot: true },
        ] },
        antique: { maxPerSeason: 5, table: [
          { weight: 35, type: 'coins',      min: 25000, max: 40000 },
          { weight: 30, type: 'boost',      mult: 3, minutes: 20 },
          { weight: 20, type: 'collection', amount: 1 },
          { weight: 14, type: 'coins',      min: 45000, max: 60000 },
          { weight:  1, type: 'coins',      min: 100000, max: 150000, jackpot: true },
        ] },
      },
      mined: null,   // rempli ci-dessous : mêmes coffres minés que P
    },
  },
};
PRESETS.boutique_sans_fragments.tables.mined = structuredClone(PRESETS.fragments_prudente.tables.mined);

/** Tables complètes d'un préréglage (copie). */
function presetTables(id) {
  const p = PRESETS[id];
  if (!p) throw new RewardError(400, `Préréglage inconnu : ${id}.`);
  return structuredClone(p.tables);
}

/**
 * Remplace le brouillon par les tables d'un préréglage (aucune publication). Recharger le même
 * préréglage ne change rien ; le brouillon reste abandonnable et la version en vigueur intacte.
 */
function applyPreset(id, { costs } = {}) {
  const tables = presetTables(id);
  return conn().transaction(() => {
    const previous = getDraft();   // #88 : brouillon remplacé conservé dans le journal (récupérable)
    const out = saveDraft(tables, { costs });
    _audit('draft_preset', null, { preset: id, ...(previous ? { replacedDraft: previous.tables } : {}) });
    return out;
  })();
}

// ── Base ──────────────────────────────────────────────────────────────────────

function init() {
  conn().exec(`
    CREATE TABLE IF NOT EXISTS reward_table_versions (
      version      INTEGER PRIMARY KEY,
      tables       TEXT    NOT NULL,
      source       TEXT    NOT NULL CHECK (source IN ('origin', 'publish', 'rollback')),
      note         TEXT,
      from_version INTEGER,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reward_table_draft (
      id          INTEGER PRIMARY KEY CHECK (id = 1),
      tables      TEXT    NOT NULL,
      based_on    INTEGER NOT NULL,
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reward_table_audit (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      action      TEXT    NOT NULL,
      version     INTEGER,
      details     TEXT
    );
    CREATE TRIGGER IF NOT EXISTS trg_reward_table_versions_no_update BEFORE UPDATE ON reward_table_versions
      BEGIN SELECT RAISE(ABORT, 'reward_table_versions est en ajout seul (#37)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_reward_table_versions_no_delete BEFORE DELETE ON reward_table_versions
      BEGIN SELECT RAISE(ABORT, 'reward_table_versions est en ajout seul (#37)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_reward_table_audit_no_update BEFORE UPDATE ON reward_table_audit
      BEGIN SELECT RAISE(ABORT, 'reward_table_audit est en ajout seul (#37)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_reward_table_audit_no_delete BEFORE DELETE ON reward_table_audit
      BEGIN SELECT RAISE(ABORT, 'reward_table_audit est en ajout seul (#37)'); END;
  `);
  conn().transaction(() => {
    if (conn().prepare('SELECT 1 FROM reward_table_versions LIMIT 1').get()) return;
    conn().prepare("INSERT INTO reward_table_versions (version, tables, source, note) VALUES (1, ?, 'origin', ?)")
      .run(JSON.stringify(originTables()), 'Conversion à l\'identique des tables de coffres d\'origine (#37)');
    _audit('migrate', 1, null);
  })();
  _invalidate();
  chestShop.setTablesProvider(() => getPublished().tables);
}

function _audit(action, version, details) {
  conn().prepare('INSERT INTO reward_table_audit (action, version, details) VALUES (?, ?, ?)')
    .run(action, version ?? null, details ? JSON.stringify(details) : null);
}

let _publishedCache = null;
function _invalidate() { _publishedCache = null; }

function _row(r) {
  return r && { version: r.version, tables: JSON.parse(r.tables), source: r.source, note: r.note,
    fromVersion: r.from_version, createdAt: r.created_at };
}

function getPublished() {
  if (!_publishedCache) {
    _publishedCache = _row(conn().prepare('SELECT * FROM reward_table_versions ORDER BY version DESC LIMIT 1').get());
  }
  return structuredClone(_publishedCache);
}

function getVersion(version) {
  return _row(conn().prepare('SELECT * FROM reward_table_versions WHERE version = ?').get(version));
}

function listVersions(limit = 50) {
  return conn().prepare('SELECT version, source, note, from_version, created_at FROM reward_table_versions ORDER BY version DESC LIMIT ?')
    .all(limit).map(r => ({ version: r.version, source: r.source, note: r.note, fromVersion: r.from_version, createdAt: r.created_at }));
}

function getDraft() {
  const r = conn().prepare('SELECT * FROM reward_table_draft WHERE id = 1').get();
  return r ? { tables: JSON.parse(r.tables), basedOn: r.based_on, updatedAt: r.updated_at } : null;
}

/** Tables des coffres minés publiées (jeu : GET /api/shop/chests, champ `mined`). */
function publicMined() {
  return getPublished().tables.mined;
}

// ── Validation ────────────────────────────────────────────────────────────────

const _num = (v, [min, max]) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const _int = (v, range) => Number.isInteger(v) && _num(v, range);

/** Normalise une ligne (seuls les champs utiles à son type sont gardés) ; erreurs ajoutées à `errors`. */
function _normRow(row, where, allowed, errors) {
  if (!row || typeof row !== 'object') { errors.push(`${where} : ligne invalide.`); return null; }
  const type = String(row.type ?? '');
  if (!allowed.includes(type)) { errors.push(`${where} : type « ${type} » non autorisé (${allowed.join(', ')}).`); return null; }
  const weight = Number(row.weight);
  if (!_num(weight, LIMITS.weight)) errors.push(`${where} : poids > 0 attendu (au plus ${LIMITS.weight[1]}).`);
  const out = { weight: Math.round(weight * 10_000) / 10_000, type };
  if (type === 'coins') {
    out.min = Number(row.min); out.max = Number(row.max);
    if (!_int(out.min, LIMITS.coins) || !_int(out.max, LIMITS.coins)) errors.push(`${where} : pièces min et max entières entre 1 et ${LIMITS.coins[1]}.`);
    else if (out.min > out.max) errors.push(`${where} : pièces min (${out.min}) > max (${out.max}).`);
    if (row.jackpot === true) out.jackpot = true;
  } else if (type === 'relics') {
    out.amount = Number(row.amount);
    if (!_int(out.amount, LIMITS.relics)) errors.push(`${where} : fragments entiers entre 1 et ${LIMITS.relics[1]}.`);
  } else if (type === 'boost') {
    out.mult = Number(row.mult); out.minutes = Number(row.minutes);
    if (!_num(out.mult, LIMITS.mult)) errors.push(`${where} : multiplicateur de boost entre ${LIMITS.mult[0]} et ${LIMITS.mult[1]}.`);
    if (!_int(out.minutes, LIMITS.minutes)) errors.push(`${where} : durée de boost entière entre 1 et ${LIMITS.minutes[1]} minutes.`);
  } else if (type === 'collection') {
    out.amount = 1;
  }
  return out;
}

function _normTable(table, where, allowed, errors) {
  if (!Array.isArray(table) || table.length === 0) { errors.push(`${where} : au moins une ligne.`); return []; }
  if (table.length > MAX_ROWS) errors.push(`${where} : au plus ${MAX_ROWS} lignes.`);
  return table.slice(0, MAX_ROWS).map((r, i) => _normRow(r, `${where}, ligne ${i + 1}`, allowed, errors)).filter(Boolean);
}

/** Probabilité (%), pièces et fragments moyens par ouverture (hors bonus Aimant et multiplicateur). */
function tableStats(table) {
  const total = table.reduce((s, r) => s + r.weight, 0) || 1;
  let coins = 0, fragments = 0, jackpot = 0;
  const rows = table.map(r => {
    const p = r.weight / total;
    if (r.type === 'coins') coins += p * (r.min + r.max) / 2;
    if (r.type === 'relics') fragments += p * r.amount;
    if (r.jackpot) jackpot += p;
    return { ...r, chance: Math.round(p * 1e6) / 1e4 };
  });
  return { rows, expectedCoins: Math.round(coins), expectedFragments: Math.round(fragments * 100) / 100,
    jackpotChance: Math.round(jackpot * 1e6) / 1e4 };
}

/**
 * Équilibre d'un coffre de boutique (#88) : ce qu'il rend en pièces par rapport à son prix et,
 * s'il rend trop, les deux façons de corriger, chiffrées (prix minimal, ou part minimale des
 * tirages sans pièces — fragments, boost, objet — en gardant les lignes de pièces telles quelles).
 */
function balanceAdvice(table, cost) {
  const st = tableStats(table);
  const total = table.reduce((s, r) => s + r.weight, 0) || 1;
  const coinW = table.filter(r => r.type === 'coins').reduce((s, r) => s + r.weight, 0);
  const coinShare = coinW / total;
  const perCoinDraw = coinW ? table.filter(r => r.type === 'coins').reduce((s, r) => s + r.weight * (r.min + r.max) / 2, 0) / coinW : 0;
  const pct = x => Math.round(x * 1000) / 10;
  const out = { cost, expectedCoins: st.expectedCoins, ratio: cost ? pct(st.expectedCoins / cost) : null,
    coinShare: pct(coinShare), level: 'ok' };
  if (!cost) return out;
  if (st.expectedCoins >= cost) out.level = 'profit';
  else if (st.expectedCoins >= cost * HIGH_RATIO) out.level = 'high';
  if (out.level !== 'ok') {
    // Prix : sans boucle dès espérance + 1 ; sous 80 % au premier multiple de 50 au-dessus d'espérance / 0,8
    out.minPrice = st.expectedCoins + 1;
    out.priceUnder80 = Math.floor(st.expectedCoins / HIGH_RATIO / 50) * 50 + 50;
    // Récompenses : part des tirages sans pièces nécessaire (lignes de pièces gardées telles quelles), +0,1 point de marge
    if (perCoinDraw > 0) {
      out.minNonCoinShare = Math.round((pct(Math.max(0, 1 - cost / perCoinDraw)) + 0.1) * 10) / 10;
      out.nonCoinShareUnder80 = Math.round((pct(Math.max(0, 1 - cost * HIGH_RATIO / perCoinDraw)) + 0.1) * 10) / 10;
    }
  }
  return out;
}

const _fr = n => Number(n).toLocaleString('fr-BE');

/**
 * Valide un contenu complet. `costs` : prix en vigueur des coffres (⚙ admin_config) ; un prix
 * proposé dans le brouillon (`shop[id].cost`) le remplace pour les contrôles. Une table de boutique
 * dont l'espérance en pièces atteint le prix est refusée (pas de boucle de profit, #20).
 * `notices` (#88) : remarques non bloquantes de conformité aux décisions (fragments contre pièces).
 */
function validateTables(raw, { costs = getEconomy({}).chestCosts } = {}) {
  const errors = [], warnings = [], issues = [], notices = [];
  const tables = { shop: {}, mined: {} };
  if (!raw || typeof raw !== 'object' || !raw.shop || !raw.mined) {
    return { tables: null, errors: ['Contenu invalide : { shop, mined } attendu.'], warnings, issues, notices };
  }
  for (const id of SHOP_IDS) {
    const src = raw.shop[id];
    if (!src) { errors.push(`Coffre de boutique « ${id} » manquant.`); continue; }
    const max = src.maxPerSeason == null || src.maxPerSeason === '' ? null : Number(src.maxPerSeason);
    if (max !== null && !_int(max, LIMITS.maxPerSeason)) errors.push(`Boutique ${id} : limite par saison vide (illimité) ou entière entre 1 et ${LIMITS.maxPerSeason[1]}.`);
    let cost = null;
    if (src.cost != null && src.cost !== '') {
      cost = Number(src.cost);
      if (!_int(cost, LIMITS.cost)) { errors.push(`Boutique ${id} : prix entier entre 1 et ${_fr(LIMITS.cost[1])} pièces attendu.`); cost = null; }
    }
    const table = _normTable(src.table, `Boutique ${id}`, SHOP_TYPES, errors);
    tables.shop[id] = { ...(cost != null ? { cost } : {}), maxPerSeason: max, table };
    const price = cost ?? costs[id];
    if (!table.length || !price) continue;
    const adv = balanceAdvice(table, price);
    if (adv.level === 'profit') {
      errors.push(`Boutique ${id} : ce coffre coûte ${_fr(price)} pièces mais rend en moyenne ${_fr(adv.expectedCoins)} pièces — on pourrait gagner des pièces en l'achetant en boucle (boucle de profit).`);
      issues.push({ family: 'shop', id, kind: 'profit', ...adv });
    } else if (adv.level === 'high') {
      warnings.push(`Boutique ${id} : ${_fr(adv.expectedCoins)} pièces rendues en moyenne, ≥ 80 % du prix (${_fr(price)}).`);
      issues.push({ family: 'shop', id, kind: 'high', ...adv });
    }
    const st = tableStats(table);
    const fragChance = st.rows.filter(r => r.type === 'relics').reduce((a, r) => a + r.chance, 0);
    if (fragChance > 0) {
      notices.push({ family: 'shop', id, kind: 'fragments', chance: Math.round(fragChance * 100) / 100,
        text: `Boutique ${id} : ${_fr(Math.round(fragChance * 100) / 100)} % de chance d'obtenir des fragments pour un coffre acheté avec des pièces — non conforme à la décision du 04/11 (#49).` });
    }
  }
  for (const id of MINED_IDS) {
    tables.mined[id] = _normTable(raw.mined[id], `Coffre miné ${id}`, MINED_TYPES, errors);
  }
  const extra = [...Object.keys(raw.shop).filter(k => !SHOP_IDS.includes(k)), ...Object.keys(raw.mined).filter(k => !MINED_IDS.includes(k))];
  if (extra.length) errors.push(`Coffres inconnus : ${extra.join(', ')} (ajout de coffre non pris en charge).`);
  return { tables, errors, warnings, issues, notices };
}

/** Copie de `tables` dont chaque coffre de boutique porte son prix effectif (`override` : prix en vigueur imposés). */
function withCosts(tables, costs, { override = false } = {}) {
  const t = structuredClone(tables);
  for (const id of SHOP_IDS) if (t.shop[id]) t.shop[id].cost = override ? costs[id] : (t.shop[id].cost ?? costs[id]);
  return t;
}

// ── Écarts, simulation ────────────────────────────────────────────────────────

const _fmt = r => r ? JSON.stringify(r) : '—';

/** Écarts coffre par coffre et ligne par ligne (journal, détails avancés). */
function diff(from, to) {
  const out = [];
  const one = (key, a, b) => {
    const rows = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (_fmt(a[i]) !== _fmt(b[i])) rows.push({ row: i + 1, before: a[i] ?? null, after: b[i] ?? null });
    }
    return rows;
  };
  for (const id of SHOP_IDS) {
    const a = from.shop[id], b = to.shop[id];
    const rows = one(id, a?.table ?? [], b?.table ?? []);
    const maxChanged = (a?.maxPerSeason ?? null) !== (b?.maxPerSeason ?? null);
    // Prix (#88) : comparé seulement si les deux côtés le portent (voir withCosts)
    const costChanged = a?.cost != null && b?.cost != null && a.cost !== b.cost;
    if (rows.length || maxChanged || costChanged) out.push({ family: 'shop', id, rows,
      ...(maxChanged ? { maxPerSeason: [a?.maxPerSeason ?? null, b?.maxPerSeason ?? null] } : {}),
      ...(costChanged ? { cost: [a.cost, b.cost] } : {}) });
  }
  for (const id of MINED_IDS) {
    const rows = one(id, from.mined[id] ?? [], to.mined[id] ?? []);
    if (rows.length) out.push({ family: 'mined', id, rows });
  }
  return out;
}

function _rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** n ouvertures simulées par coffre : fréquence observée par ligne et pièces/fragments moyens. */
function simulate(tables, { n = 10_000, seed = 37 } = {}) {
  n = Math.min(Math.max(Number.isInteger(n) ? n : 10_000, 100), 100_000);
  const rnd = _rng(seed);
  const one = (family, id, table) => {
    const total = table.reduce((s, r) => s + r.weight, 0);
    const hits = table.map(() => 0);
    let coins = 0, fragments = 0;
    for (let k = 0; k < n; k++) {
      let r = rnd() * total, i = 0;
      for (; i < table.length - 1; i++) { r -= table[i].weight; if (r <= 0) break; }
      hits[i]++;
      const row = table[i];
      if (row.type === 'coins') coins += row.min + Math.floor(rnd() * (row.max - row.min + 1));
      if (row.type === 'relics') fragments += row.amount;
    }
    const st = tableStats(table);
    return { family, id, n, rows: st.rows.map((row, i) => ({ ...row, observed: Math.round(hits[i] / n * 1e6) / 1e4 })),
      expectedCoins: st.expectedCoins, observedCoins: Math.round(coins / n),
      expectedFragments: st.expectedFragments, observedFragments: Math.round(fragments / n * 100) / 100 };
  };
  return [
    ...SHOP_IDS.map(id => ({ ...one('shop', id, tables.shop[id].table), cost: tables.shop[id].cost ?? null })),
    ...MINED_IDS.map(id => one('mined', id, tables.mined[id])),
  ];
}

// ── Brouillon, publication, retour arrière ────────────────────────────────────

/**
 * Remplace le brouillon par un contenu complet (validé à la lecture, refusé seulement s'il est
 * illisible). Un prix proposé égal au prix en vigueur n'est pas gardé (rien à publier pour lui).
 */
function saveDraft(raw, { costs = getEconomy({}).chestCosts } = {}) {
  const v = validateTables(raw, { costs });
  if (!v.tables) throw new RewardError(400, 'Contenu invalide.', v.errors);
  for (const id of SHOP_IDS) if (v.tables.shop[id]?.cost === costs[id]) delete v.tables.shop[id].cost;
  return conn().transaction(() => {
    const current = getPublished();
    const basedOn = getDraft()?.basedOn ?? current.version;
    const changes = diff(withCosts(current.tables, costs, { override: true }), withCosts(v.tables, costs));
    if (!changes.length && basedOn === current.version) {
      const dropped = conn().prepare('DELETE FROM reward_table_draft WHERE id = 1').run().changes;
      if (dropped) _audit('draft_clean', null, null);
      return { draft: null, errors: v.errors, warnings: v.warnings, issues: v.issues, notices: v.notices, changes };
    }
    conn().prepare(`INSERT INTO reward_table_draft (id, tables, based_on, updated_at) VALUES (1, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET tables = excluded.tables, based_on = excluded.based_on, updated_at = excluded.updated_at`)
      .run(JSON.stringify(v.tables), basedOn);
    _audit('draft_save', null, { changes });
    return { draft: getDraft(), errors: v.errors, warnings: v.warnings, issues: v.issues, notices: v.notices, changes };
  })();
}

function discardDraft() {
  return conn().transaction(() => {
    const previous = getDraft();   // #88 : contenu abandonné conservé dans le journal
    const r = conn().prepare('DELETE FROM reward_table_draft WHERE id = 1').run();
    if (r.changes) _audit('draft_discard', null, previous ? { discardedDraft: previous.tables } : null);
    return r.changes > 0;
  })();
}

function _note(note) { return String(note ?? '').trim().slice(0, 300) || null; }

/**
 * Écrit les prix d'une version dans admin_config (même transaction que la version). Renvoie les
 * changements { id, before, after } ; `costs` = prix en vigueur avant l'écriture.
 */
function _applyCosts(tables, costs) {
  const changed = [];
  for (const id of SHOP_IDS) {
    const next = tables.shop[id]?.cost;
    if (next == null || next === costs[id]) continue;
    db.setAdminConfig(`chest_cost_${id}`, String(next));
    changed.push({ id, before: costs[id], after: next });
  }
  return changed;
}

/**
 * Publie le brouillon : version (prix effectifs inclus) + prix dans admin_config + suppression du
 * brouillon + journal, en une seule transaction. `priceChanges` permet à l'appelant de journaliser.
 */
function publishDraft({ note, expectedBasedOn, costs = getEconomy({}).chestCosts } = {}) {
  const result = conn().transaction(() => {
    const draft = getDraft();
    if (!draft) throw new RewardError(409, 'Aucun brouillon à publier.');
    const current = getPublished();
    if (draft.basedOn !== current.version || (expectedBasedOn != null && expectedBasedOn !== current.version)) {
      throw new RewardError(409, `Le brouillon part de la version ${draft.basedOn}, la version en vigueur est la ${current.version} : rechargez.`);
    }
    const v = validateTables(draft.tables, { costs });
    if (v.errors.length) throw new RewardError(400, 'Publication impossible : à corriger d\'abord.', v.errors);
    const next = withCosts(v.tables, costs);
    const changes = diff(withCosts(current.tables, costs, { override: true }), next);
    if (!changes.length) throw new RewardError(409, 'Aucun changement par rapport à la version en vigueur.');
    const version = current.version + 1;
    conn().prepare("INSERT INTO reward_table_versions (version, tables, source, note, from_version) VALUES (?, ?, 'publish', ?, ?)")
      .run(version, JSON.stringify(next), _note(note), current.version);
    const priceChanges = _applyCosts(next, costs);
    conn().prepare('DELETE FROM reward_table_draft WHERE id = 1').run();
    _audit('publish', version, { changes, ...(priceChanges.length ? { priceChanges } : {}) });
    return { version, changes, warnings: v.warnings, priceChanges };
  })();
  _invalidate();
  return result;
}

/**
 * Publie une NOUVELLE version au contenu d'une version antérieure (les versions ne sont jamais
 * modifiées). Si l'ancienne version mémorise ses prix (publiée depuis #88), ils sont restaurés
 * aussi ; sinon (v1) les prix en vigueur sont gardés.
 */
function rollbackTo(target, { note, costs = getEconomy({}).chestCosts } = {}) {
  const result = conn().transaction(() => {
    const old = getVersion(target);
    if (!old) throw new RewardError(404, 'Version introuvable.');
    const current = getPublished();
    if (old.version === current.version) throw new RewardError(409, 'Cette version est déjà en vigueur.');
    const v = validateTables(old.tables, { costs });
    if (v.errors.length) throw new RewardError(400, 'Retour arrière impossible avec les prix actuels.', v.errors);
    const next = withCosts(v.tables, costs);
    const version = current.version + 1;
    conn().prepare("INSERT INTO reward_table_versions (version, tables, source, note, from_version) VALUES (?, ?, 'rollback', ?, ?)")
      .run(version, JSON.stringify(next), _note(note) || `Retour à la version ${old.version}`, old.version);
    const priceChanges = _applyCosts(next, costs);
    _audit('rollback', version, { to: old.version, changes: diff(withCosts(current.tables, costs, { override: true }), next),
      ...(priceChanges.length ? { priceChanges } : {}) });
    return { version, restored: old.version, priceChanges, pricesKept: SHOP_IDS.every(id => old.tables.shop[id]?.cost == null) };
  })();
  _invalidate();
  return result;
}

function listAudit(limit = 100) {
  return conn().prepare('SELECT * FROM reward_table_audit ORDER BY id DESC LIMIT ?').all(limit)
    .map(a => ({ ...a, details: a.details ? JSON.parse(a.details) : null }));
}

/**
 * Vue admin : version en vigueur (avec probabilités, prix en vigueur et équilibre), brouillon validé
 * (prix proposés, problèmes bloquants `issues`, remarques de conformité `notices`, écarts), versions.
 */
function buildAdminView({ costs = getEconomy({}).chestCosts } = {}) {
  const published = getPublished();
  const draft = getDraft();
  const withStats = t => ({
    shop: Object.fromEntries(SHOP_IDS.map(id => [id, { ...t.shop[id],
      stats: tableStats(t.shop[id].table), balance: balanceAdvice(t.shop[id].table, t.shop[id].cost) }])),
    mined: Object.fromEntries(MINED_IDS.map(id => [id, { table: t.mined[id], stats: tableStats(t.mined[id]) }])),
  });
  const pubTables = withCosts(published.tables, costs, { override: true });
  const pubCheck = validateTables(pubTables, { costs });
  let draftView = null;
  if (draft) {
    const v = validateTables(draft.tables, { costs });
    draftView = { tables: draft.tables, basedOn: draft.basedOn, updatedAt: draft.updatedAt, errors: v.errors,
      warnings: v.warnings, issues: v.issues, notices: v.notices,
      costs: Object.fromEntries(SHOP_IDS.map(id => [id, draft.tables.shop?.[id]?.cost ?? costs[id]])),
      changes: v.tables ? diff(pubTables, withCosts(v.tables, costs)) : [],
      stats: v.tables ? withStats(withCosts(v.tables, costs)) : null };
  }
  return {
    published: { ...published, tables: pubTables, stats: withStats(pubTables), notices: pubCheck.notices },
    draft: draftView,
    versions: listVersions(),
    costs,
    shopIds: SHOP_IDS, minedIds: MINED_IDS, shopTypes: SHOP_TYPES, minedTypes: MINED_TYPES, limits: LIMITS,
    presets: Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label, conform: p.conform, note: p.note })),
  };
}

module.exports = {
  RewardError, SHOP_IDS, MINED_IDS, LIMITS, PRESETS, presetTables, applyPreset,
  init, originTables, getPublished, getVersion, getDraft, listVersions, publicMined,
  validateTables, tableStats, balanceAdvice, withCosts, diff, simulate,
  saveDraft, discardDraft, publishDraft, rollbackTo, listAudit, buildAdminView,
};
