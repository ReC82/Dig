/**
 * collectionPity.js — chance croissante des objets de collection (#39, décision du propriétaire du 04/11).
 *
 * Un objet dont le drop porte `pityStep` > 0 n'est PAS tiré par le jeu (Collection.tryDrop) mais par
 * le serveur, après chaque sauvegarde acceptée, sur les blocs VALIDÉS (badges.validatedStats, bornés
 * par la profondeur retenue — #38) minés depuis la sauvegarde précédente :
 *   - tirage éligible = bloc d'une catégorie source détruit pendant la saison de la série, profondeur
 *     retenue du joueur ≥ minDepth, objet pas encore possédé ;
 *   - chance du (k+1)e tirage éligible = min(100 %, chance + pityStep × k), k = tirages éligibles
 *     ratés jusque-là (compteur par joueur ET par objet, table collection_pity) ;
 *   - trouvé : le compteur est figé (found_at) et l'objet n'est plus jamais tiré pour ce joueur
 *     (un seul exemplaire, clé primaire user_id + item_id : aucune double attribution).
 * Rejouer une sauvegarde ne retire rien : les blocs validés n'augmentent pas, le curseur
 * (collection_pity_cursor) ne voit aucun nouveau bloc. Premier passage, nouvelle publication ou
 * changement de saison : le curseur est recalé SANS tirage (rien d'attribué rétroactivement).
 * L'objet trouvé est renvoyé au client (`collectionFinds`) et réinjecté dans chaque sauvegarde
 * lue ou écrite (mergeInto) : il ne peut pas être perdu par un onglet qui aurait manqué la réponse.
 *
 * Aucun objet publié ne porte de chance croissante tant que le propriétaire n'a pas publié une série
 * qui en a : sans objet concerné, processSave ne fait rien (aucune écriture).
 */

'use strict';

const crypto = require('crypto');
const path   = require('path');
const db     = require('./db');

const conn = () => db.getDb();
const MAX_BLOCKS_PER_SAVE = 2000;   // au-delà, le curseur avance sans tirage (aucune rafale d'objets)

function init() {
  conn().exec(`
    CREATE TABLE IF NOT EXISTS collection_pity (
      user_id     INTEGER NOT NULL,
      item_id     TEXT NOT NULL,
      fails       INTEGER NOT NULL DEFAULT 0,
      found_at    TEXT,
      season_id   INTEGER,
      depth       INTEGER,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_collection_pity_item ON collection_pity(item_id);
    CREATE TABLE IF NOT EXISTS collection_pity_cursor (
      user_id     INTEGER PRIMARY KEY,
      scope       TEXT NOT NULL,
      ref_counts  TEXT NOT NULL,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function _rand() { return crypto.randomInt(0, 2 ** 32) / 2 ** 32; }

/** Chance du prochain tirage après `fails` tirages éligibles ratés (bornée à 100 %). */
function chanceAt(drop, fails) {
  return Math.min(1, drop.chance + (drop.pityStep ?? 0) * Math.max(0, fails));
}

/** Objets publiés à chance croissante qui peuvent tomber maintenant (même règle que Collection.canDrop). */
function liveItems(season = db.getActiveSeason()) {
  const catalog = require('./collectionCatalog');
  const p = catalog.getPublished();
  const series = new Map(p.series.map(s => [s.id, s]));
  return p.items.filter(i => {
    if (!catalog.isServerDrop(i) || !i.active || !i.dropEnabled) return false;
    const s = series.get(i.seriesId);
    if (!s || s.active === false) return false;
    const eff = catalog.effectiveSeason(s);
    if (eff.pending) return false;
    return eff.seasonId == null || (season != null && eff.seasonId === season.id);
  });
}

/** Objets trouvés par le serveur pour un joueur. */
function serverFinds(userId) {
  return conn().prepare('SELECT item_id, found_at, season_id FROM collection_pity WHERE user_id = ? AND found_at IS NOT NULL ORDER BY found_at')
    .all(userId);
}

/**
 * Sauvegarde (objet `data`, modifié en place) : ajoute les objets trouvés par le serveur qui y
 * manquent et, avec `strip`, retire ceux que seul le serveur peut donner sans les avoir donnés
 * (sauvegarde falsifiée). Un objet déjà tombé dans le jeu avant sa chance croissante est conservé.
 */
function mergeInto(userId, data, { strip = false } = {}) {
  if (!data || typeof data !== 'object') return data;
  const finds = serverFinds(userId);
  if (strip && Array.isArray(data.collection)) {
    const only = require('./collectionCatalog').serverOnlyIds();
    if (only.size) {
      const mine = new Set(finds.map(f => f.item_id));
      const forged = data.collection.filter(id => only.has(id) && !mine.has(id));
      if (forged.length) {
        data.collection = data.collection.filter(id => !forged.includes(id));
        if (data.collectionMeta && typeof data.collectionMeta === 'object') for (const id of forged) delete data.collectionMeta[id];
      }
    }
  }
  if (!finds.length) return data;
  if (!Array.isArray(data.collection)) data.collection = [];
  if (!data.collectionMeta || typeof data.collectionMeta !== 'object' || Array.isArray(data.collectionMeta)) data.collectionMeta = {};
  for (const f of finds) {
    if (!data.collection.includes(f.item_id)) data.collection.push(f.item_id);
    if (!data.collectionMeta[f.item_id]) {
      data.collectionMeta[f.item_id] = { at: Date.parse(`${f.found_at.replace(' ', 'T')}Z`) || Date.now(), n: 1, season: f.season_id ?? null };
    }
  }
  return data;
}

/**
 * Après une sauvegarde acceptée ET le crédit des statistiques fiables (badges.processSave) : tire
 * les objets à chance croissante sur les blocs validés depuis le passage précédent.
 * @param {object} data — sauvegarde écrite (objets déjà possédés : jamais tirés)
 * @returns {Array<{itemId, seriesId, icon, image, names, rarity}>}
 */
function processSave(userId, data, { nowMs = Date.now(), rand = _rand } = {}) {
  const season = db.getActiveSeason();
  const items = liveItems(season);
  if (!items.length) return [];
  const blockCatalog = require('./blockCatalog');
  const badges = require('./badges');
  const catOf = new Map(blockCatalog.getPublished().types.map(t => [t.id, t.category]));
  const t = db.getDepthTracking(userId);
  const depth = t && season && t.season_id === season.id ? t.accepted_depth : 0;
  const scope = JSON.stringify({ season: season?.id ?? null, items: items.map(i => i.id).sort() });
  const owned = new Set(Array.isArray(data?.collection) ? data.collection : []);
  const foundAt = new Date(nowMs).toISOString().slice(0, 19).replace('T', ' ');
  return db.runTransaction(() => {
    const counts = {};
    for (const [k, v] of Object.entries(badges.validatedStats(userId))) if (k.startsWith('blocks:')) counts[k.slice(7)] = v;
    const cur = conn().prepare('SELECT scope, ref_counts FROM collection_pity_cursor WHERE user_id = ?').get(userId);
    conn().prepare(`INSERT INTO collection_pity_cursor (user_id, scope, ref_counts) VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET scope = excluded.scope, ref_counts = excluded.ref_counts, updated_at = datetime('now')`)
      .run(userId, scope, JSON.stringify(counts));
    if (!cur || cur.scope !== scope) return [];      // recalage sans tirage : rien de rétroactif
    const ref = JSON.parse(cur.ref_counts);
    const byCat = {};
    let total = 0;
    for (const [id, v] of Object.entries(counts)) {
      const d = v - (ref[id] ?? 0);
      if (d <= 0) continue;
      const c = catOf.get(id);
      if (c) byCat[c] = (byCat[c] ?? 0) + d;
      total += d;
    }
    if (!total || total > MAX_BLOCKS_PER_SAVE) return [];
    const out = [];
    const getRow = conn().prepare('SELECT fails, found_at FROM collection_pity WHERE user_id = ? AND item_id = ?');
    const upsert = conn().prepare(`INSERT INTO collection_pity (user_id, item_id, fails, found_at, season_id, depth) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, item_id) DO UPDATE SET fails = excluded.fails, found_at = excluded.found_at, season_id = excluded.season_id,
          depth = excluded.depth, updated_at = datetime('now') WHERE collection_pity.found_at IS NULL`);
    for (const it of items) {
      if (owned.has(it.id) || depth < it.drop.minDepth) continue;
      const row = getRow.get(userId, it.id);
      if (row?.found_at) continue;
      const n = it.drop.from.reduce((a, c) => a + (byCat[c] ?? 0), 0);
      if (!n) continue;
      let fails = row?.fails ?? 0, found = false;
      for (let k = 0; k < n && !found; k++) {
        if (rand() < chanceAt(it.drop, fails)) found = true;
        else fails++;
      }
      const r = upsert.run(userId, it.id, fails, found ? foundAt : null, season?.id ?? null, depth);
      if (found && r.changes) out.push({ itemId: it.id, seriesId: it.seriesId, icon: it.icon, image: it.image, names: it.names, rarity: it.rarity });
    }
    return out;
  });
}

/** Résumé des compteurs pour l'admin : par objet, joueurs en cours, objets trouvés, échecs médian et max. */
function adminStats() {
  const rows = conn().prepare(`SELECT item_id, COUNT(*) AS players, SUM(found_at IS NOT NULL) AS found, MAX(fails) AS maxFails
    FROM collection_pity GROUP BY item_id`).all();
  return Object.fromEntries(rows.map(r => [r.item_id, { players: r.players, found: r.found, maxFails: r.maxFails }]));
}

// ── Simulation comparative (admin) ────────────────────────────────────────────
// Le simulateur #49/#39 (tools/balance/collection-drop-sim.js) tourne dans un processus enfant de
// basse priorité : la partie des joueurs n'est jamais ralentie, la requête répond tout de suite
// (nginx coupe à 60 s) et l'admin suit l'avancement. Un seul calcul à la fois ; résultat en mémoire.

const SIM_PATH = path.join(__dirname, '..', 'tools', 'balance', 'collection-drop-sim.js');
const SIM_TIMEOUT_MS = 15 * 60_000;
let _sim = null;

class PityError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/**
 * Barèmes comparés pour une série : version publiée (si elle existe), brouillon, brouillon sans
 * hausse (s'il en a une) et modèle « chance croissante ». Les barèmes identiques sont fusionnés.
 */
function simulationScales(seriesId) {
  const catalog = require('./collectionCatalog');
  const draft = catalog.getDraft() ?? catalog.getPublished();
  const mine = draft.items.filter(i => i.seriesId === seriesId);
  if (!mine.length) throw new PityError(400, `Série « ${seriesId} » sans objet dans le brouillon.`);
  const toSim = list => list.map(i => ({ id: i.id, rarity: i.rarity, from: i.drop.from, minDepth: i.drop.minDepth, chance: i.drop.chance,
    ...(i.drop.pityStep ? { pityStep: i.drop.pityStep } : {}) }));
  const order = new Map(mine.map((i, k) => [i.id, k]));
  const published = catalog.getPublished().items.filter(i => i.seriesId === seriesId).sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
  const candidates = [];
  if (published.length) candidates.push({ key: 'PUBLIE', label: 'Version publiée', items: toSim(published) });
  candidates.push({ key: 'BROUILLON', label: 'Brouillon (tel qu\'enregistré)', items: toSim(mine) });
  if (mine.some(catalog.isServerDrop)) {
    candidates.push({ key: 'SANS_HAUSSE', label: 'Brouillon sans hausse (chances fixes)',
      items: toSim(mine.map(i => { const { pityStep: _p, ...drop } = i.drop; return { ...i, drop }; })) });
  }
  candidates.push({ key: 'CROISSANT', label: catalog.PITY_PRESETS.croissant.label, items: toSim(catalog.presetItems(mine, 'croissant')) });
  const seen = new Map(), scales = [];
  for (const c of candidates) {
    const sig = JSON.stringify(c.items);
    if (seen.has(sig)) { seen.get(sig).also.push(c.label); continue; }
    const s = { ...c, also: [] };
    seen.set(sig, s); scales.push(s);
  }
  return scales;
}

/** Lance la simulation comparative d'une série (2 000 joueurs par profil par défaut). */
function startSimulation(seriesId, { runs = 2000 } = {}) {
  if (_sim?.status === 'running') throw new PityError(409, 'Une simulation est déjà en cours : patientez.');
  const n = Number(runs);
  if (!Number.isInteger(n) || n < 50 || n > 5000) throw new PityError(400, 'Nombre de joueurs simulés : 50 à 5 000 par profil.');
  const scales = simulationScales(String(seriesId));
  const { fork } = require('child_process');
  const child = fork(SIM_PATH, ['--ipc'], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  try { require('os').setPriority(child.pid, 15); } catch (_) { /* priorité inchangée */ }
  const job = _sim = { id: Date.now(), seriesId: String(seriesId), runs: n, status: 'running', startedAt: new Date().toISOString(),
    scales: scales.map(({ key, label, also, items }) => ({ key, label, also, items })), progress: null, result: null, error: null };
  let stderr = '';
  child.stderr.on('data', b => { stderr = (stderr + b).slice(-2000); });
  const timer = setTimeout(() => { child.kill('SIGKILL'); if (job.status === 'running') Object.assign(job, { status: 'error', error: 'Simulation trop longue : arrêtée.' }); }, SIM_TIMEOUT_MS);
  child.on('message', m => {
    if (m?.progress) job.progress = m.progress;
    if (m?.result) Object.assign(job, { status: 'done', result: m.result, finishedAt: new Date().toISOString() });
    if (m?.error) Object.assign(job, { status: 'error', error: String(m.error).slice(0, 300) });
  });
  child.on('exit', code => {
    clearTimeout(timer);
    if (job.status === 'running') Object.assign(job, { status: 'error', error: `Simulation interrompue (code ${code}). ${stderr.slice(-300)}`.trim() });
  });
  child.send({ runs: n, scales: Object.fromEntries(scales.map(s => [s.key, { label: s.label, items: s.items }])) });
  return simulationStatus();
}

function simulationStatus() {
  return { simulation: _sim };
}

module.exports = {
  init, chanceAt, liveItems, serverFinds, mergeInto, processSave, adminStats,
  simulationScales, startSimulation, simulationStatus, PityError, MAX_BLOCKS_PER_SAVE,
};
