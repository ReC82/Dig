/**
 * server/collectionCatalog.js — Collections saisonnières administrables (#39, étape A).
 *
 * Principes (mêmes garanties que le catalogue de blocs #37) :
 *   - contenu = { series, items } versionné : chaque publication (ou retour arrière) ajoute une
 *     version complète à `collection_catalog_versions` (ajout seul) ; la plus récente est en vigueur.
 *     La version 1 reprend à l'identique les 8 trouvailles d'origine (public/js/collection.js : mêmes
 *     blocs sources, profondeurs, chances et ordre de tirage) dans la série permanente « origines »,
 *     enrichies de noms FR/EN/NL/ES, d'une rareté et d'une petite histoire ;
 *   - brouillon unique → publication atomique (refusée si invalide ou si la version a changé) ;
 *     journal `collection_catalog_audit` en ajout seul ;
 *   - une série ou un objet publié n'est jamais supprimé (les sauvegardes y font référence) : il se
 *     désactive. Les objets acquis restent dans la sauvegarde du joueur (aucune réécriture) ;
 *   - une série est permanente (seasonId null) ou rattachée à une saison : ses objets ne tombent que
 *     pendant cette saison, puis passent en « archives » consultables ;
 *   - aucun nouveau drop sans validation du barème : publier un objet dont le drop est activé ou
 *     modifié exige une confirmation explicite (`confirmDrops`) — tracée au journal ;
 *   - images téléversées stockées dans la base (`collection_images`, couvertes par les sauvegardes),
 *     servies sous /api/collections/images/<sha256>.<ext>, contrôlées par signature (PNG/JPEG/WebP).
 */

'use strict';

const crypto = require('crypto');
const db     = require('./db');

const CATEGORIES = ['terre', 'pierre', 'minerai', 'coffre', 'gemme'];
const RARITIES   = ['commun', 'peu-commun', 'rare', 'epique', 'legendaire'];
const LANGS      = ['fr', 'en', 'nl', 'es'];
const MAX_ITEMS  = 400;
const MAX_SERIES = 60;
const MAX_IMAGE_BYTES = 350 * 1024;
const MAX_CHANCE = 0.5;

const ID_RE    = /^[a-z][a-z0-9_]{1,39}$/;
const IMAGE_RE = /^(\/assets\/[A-Za-z0-9_\-/.]+\.(webp|png|svg)|\/api\/collections\/images\/[0-9a-f]{64}\.(png|jpg|webp))$/;

class CatalogError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

const conn = () => db.getDb();

// ── Contenu d'origine (v1) ────────────────────────────────────────────────────

const ORIGIN_SERIES = [{
  id: 'origines',
  names: { fr: 'Collection des origines', en: 'Origins collection', nl: 'Collectie van de oorsprong', es: 'Colección de los orígenes' },
  seasonId: null,
  icon: '📦',
  active: true,
}];

/** Les 8 trouvailles d'origine — drops identiques à public/js/collection.js (testé). */
const ORIGIN_ITEMS = [
  { id: 'fossil', icon: '🦴', rarity: 'commun', drop: { from: ['pierre'], minDepth: 8, chance: 0.04 },
    names: { fr: 'Fossile', en: 'Fossil', nl: 'Fossiel', es: 'Fósil' },
    stories: {
      fr: "Ce brave os appartenait à un petit dinosaure qui creusait déjà des tunnels, il y a 70 millions d'années. Il n'a jamais trouvé de diamant, mais il est fier de te l'avoir laissé : la relève est assurée.",
      en: 'This brave bone belonged to a tiny dinosaur who was already digging tunnels 70 million years ago. It never found a diamond, but it is proud to pass the shovel on to you.',
      nl: 'Dit dappere bot was van een klein dinosaurusje dat 70 miljoen jaar geleden al tunnels groef. Het vond nooit een diamant, maar geeft de schop met trots aan jou door.',
      es: 'Este valiente hueso perteneció a un pequeño dinosaurio que ya cavaba túneles hace 70 millones de años. Nunca encontró un diamante, pero está orgulloso de pasarte la pala.',
    } },
  { id: 'crystal', icon: '💠', rarity: 'peu-commun', drop: { from: ['minerai'], minDepth: 12, chance: 0.05 },
    names: { fr: 'Cristal bleu', en: 'Blue Crystal', nl: 'Blauw kristal', es: 'Cristal azul' },
    stories: {
      fr: "Il a passé dix mille ans écrasé sous la roche à rêver du ciel. À force d'y penser, il en a pris la couleur. Tiens-le à la lumière : il fredonne doucement, un peu faux.",
      en: 'It spent ten thousand years squashed under the rock, dreaming of the sky — until it took on its colour. Hold it up to the light: it hums softly, slightly off-key.',
      nl: 'Het lag tienduizend jaar onder de rots te dromen van de hemel, tot het de kleur ervan aannam. Houd het tegen het licht: het neuriet zachtjes, een beetje vals.',
      es: 'Pasó diez mil años aplastado bajo la roca soñando con el cielo, hasta que tomó su color. Míralo a contraluz: tararea bajito, un poco desafinado.',
    } },
  { id: 'ancient_coin', icon: '🪙', rarity: 'peu-commun', drop: { from: ['terre', 'pierre'], minDepth: 18, chance: 0.03 },
    names: { fr: 'Pièce ancienne', en: 'Ancient Coin', nl: 'Oude munt', es: 'Moneda antigua' },
    stories: {
      fr: "Frappée par un royaume oublié pour payer… une pelle. Un côté montre un roi très sérieux, l'autre une taupe qui lui tire la langue. Les historiens se disputent encore pour savoir lequel est « pile ».",
      en: 'Minted by a forgotten kingdom to pay for… a shovel. One side shows a very serious king, the other a mole sticking its tongue out at him. Historians still argue which side is heads.',
      nl: 'Geslagen door een vergeten koninkrijk om… een schop te betalen. Op de ene kant een heel ernstige koning, op de andere een mol die zijn tong uitsteekt. Historici ruziën nog over wat kop is.',
      es: 'Acuñada por un reino olvidado para pagar… una pala. Una cara muestra a un rey muy serio; la otra, un topo sacándole la lengua. Los historiadores aún discuten cuál es la cara.',
    } },
  { id: 'relic', icon: '⚱️', rarity: 'rare', drop: { from: ['coffre'], minDepth: 10, chance: 0.15 },
    names: { fr: 'Relique', en: 'Relic', nl: 'Relikwie', es: 'Reliquia' },
    stories: {
      fr: "Un vase ébréché qui contenait, d'après l'étiquette, « la meilleure soupe du royaume ». La recette est perdue, l'odeur pas tout à fait. Les archéologues conseillent de ne pas le renifler.",
      en: 'A chipped vase that, according to its label, once held "the finest soup in the kingdom". The recipe is lost; the smell, not entirely. Archaeologists advise against sniffing it.',
      nl: 'Een geschilferde vaas die volgens het etiket ooit "de lekkerste soep van het rijk" bevatte. Het recept is verloren, de geur niet helemaal. Archeologen raden af eraan te snuffelen.',
      es: 'Un jarrón desportillado que, según su etiqueta, contenía «la mejor sopa del reino». La receta se perdió; el olor, no del todo. Los arqueólogos aconsejan no olerlo.',
    } },
  { id: 'broken_crown', icon: '👑', rarity: 'epique', drop: { from: ['coffre'], minDepth: 35, chance: 0.20 },
    names: { fr: 'Couronne brisée', en: 'Broken Crown', nl: 'Gebroken kroon', es: 'Corona rota' },
    stories: {
      fr: "Le roi Gontran le Distrait l'a perdue en cherchant ses lunettes au fond d'une mine. Il a régné quarante ans de plus avec une casserole sur la tête, et personne n'a osé le lui dire.",
      en: 'King Gontran the Absent-minded lost it while looking for his glasses at the bottom of a mine. He reigned forty more years with a saucepan on his head, and nobody dared tell him.',
      nl: 'Koning Gontran de Verstrooide verloor haar toen hij onderin een mijn zijn bril zocht. Hij regeerde nog veertig jaar met een steelpan op zijn hoofd, en niemand durfde het te zeggen.',
      es: 'El rey Gontrán el Despistado la perdió buscando sus gafas en el fondo de una mina. Reinó cuarenta años más con una cacerola en la cabeza y nadie se atrevió a decírselo.',
    } },
  { id: 'monster_tooth', icon: '🦷', rarity: 'rare', drop: { from: ['gemme'], minDepth: 35, chance: 0.10 },
    names: { fr: 'Dent de monstre', en: 'Monster Tooth', nl: 'Monstertand', es: 'Diente de monstruo' },
    stories: {
      fr: "Elle vient d'un monstre souterrain qui croquait des gemmes comme des bonbons. Résultat : une carie légendaire. Quelque part dans les profondeurs, il attend toujours la petite souris.",
      en: 'It comes from an underground monster who crunched gems like sweets. The result: a legendary cavity. Somewhere in the depths, it is still waiting for the tooth fairy.',
      nl: 'Hij komt van een ondergronds monster dat edelstenen at als snoepjes. Gevolg: een legendarisch gaatje. Ergens in de diepte wacht het nog steeds op de tandenfee.',
      es: 'Viene de un monstruo subterráneo que masticaba gemas como caramelos. Resultado: una caries legendaria. En algún lugar de las profundidades, aún espera al Ratoncito Pérez.',
    } },
  { id: 'map_fragment', icon: '🗺', rarity: 'rare', drop: { from: ['pierre', 'minerai'], minDepth: 55, chance: 0.035 },
    names: { fr: 'Fragment de carte', en: 'Map Fragment', nl: 'Kaartfragment', es: 'Fragmento de mapa' },
    stories: {
      fr: "Un bout de carte au trésor où l'on lit seulement « …creuser encore un peu… ». Son auteur a dessiné la croix sur la partie que tu n'as pas. Classique.",
      en: 'A scrap of treasure map that only says "…dig a little further…". Its author drew the X on the part you do not have. Typical.',
      nl: 'Een stukje schatkaart waarop alleen staat: "…nog een beetje dieper graven…". De maker tekende het kruisje op het stuk dat jij niet hebt. Typisch.',
      es: 'Un trozo de mapa del tesoro que solo dice «…cava un poco más…». Su autor dibujó la X en la parte que tú no tienes. Típico.',
    } },
  { id: 'mystic_orb', icon: '🔮', rarity: 'legendaire', drop: { from: ['gemme'], minDepth: 70, chance: 0.08 },
    names: { fr: 'Orbe mystérieux', en: 'Mysterious Orb', nl: 'Mysterieuze bol', es: 'Orbe misterioso' },
    stories: {
      fr: "À l'intérieur tourne une galaxie entière. Si tu colles l'oreille dessus, tu entends des milliards d'étoiles se demander qui vient de les déterrer. Fais coucou.",
      en: 'A whole galaxy swirls inside. Put your ear to it and you will hear billions of stars wondering who just dug them up. Wave hello.',
      nl: 'Binnenin draait een heel sterrenstelsel. Leg je oor ertegen en je hoort miljarden sterren zich afvragen wie hen net heeft opgegraven. Zwaai maar even.',
      es: 'Dentro gira una galaxia entera. Si pegas la oreja, oirás a miles de millones de estrellas preguntarse quién acaba de desenterrarlas. Saluda.',
    } },
];

function originContent() {
  return structuredClone({
    series: ORIGIN_SERIES,
    items: ORIGIN_ITEMS.map(i => ({ id: i.id, seriesId: 'origines', names: i.names, stories: i.stories, rarity: i.rarity,
      icon: i.icon, image: null, drop: i.drop, dropEnabled: true, active: true })),
  });
}

// ── Schéma et migration ───────────────────────────────────────────────────────

/** Tables (ajout seul) et version 1 = trouvailles d'origine. Idempotent. */
function init() {
  conn().exec(`
    CREATE TABLE IF NOT EXISTS collection_catalog_versions (
      version      INTEGER PRIMARY KEY,
      content      TEXT    NOT NULL,
      source       TEXT    NOT NULL CHECK (source IN ('origin', 'publish', 'rollback')),
      note         TEXT,
      from_version INTEGER,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS collection_catalog_draft (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      content    TEXT    NOT NULL,
      based_on   INTEGER NOT NULL,
      updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS collection_catalog_audit (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      action     TEXT    NOT NULL,
      version    INTEGER,
      details    TEXT
    );
    CREATE TABLE IF NOT EXISTS collection_images (
      sha256     TEXT    PRIMARY KEY,
      mime       TEXT    NOT NULL,
      ext        TEXT    NOT NULL,
      bytes      INTEGER NOT NULL,
      data       BLOB    NOT NULL,
      label      TEXT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TRIGGER IF NOT EXISTS trg_collection_catalog_versions_no_update BEFORE UPDATE ON collection_catalog_versions
      BEGIN SELECT RAISE(ABORT, 'collection_catalog_versions est en ajout seul (#39)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_collection_catalog_versions_no_delete BEFORE DELETE ON collection_catalog_versions
      BEGIN SELECT RAISE(ABORT, 'collection_catalog_versions est en ajout seul (#39)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_collection_catalog_audit_no_update BEFORE UPDATE ON collection_catalog_audit
      BEGIN SELECT RAISE(ABORT, 'collection_catalog_audit est en ajout seul (#39)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_collection_catalog_audit_no_delete BEFORE DELETE ON collection_catalog_audit
      BEGIN SELECT RAISE(ABORT, 'collection_catalog_audit est en ajout seul (#39)'); END;
  `);
  conn().transaction(() => {
    if (conn().prepare('SELECT 1 FROM collection_catalog_versions LIMIT 1').get()) return;
    const content = originContent();
    conn().prepare("INSERT INTO collection_catalog_versions (version, content, source, note) VALUES (1, ?, 'origin', ?)")
      .run(JSON.stringify(content), 'Reprise à l\'identique des 8 trouvailles d\'origine (#39)');
    _audit('migrate', 1, { series: content.series.length, items: content.items.length });
  })();
  _invalidate();
}

function _audit(action, version, details) {
  conn().prepare('INSERT INTO collection_catalog_audit (action, version, details) VALUES (?, ?, ?)')
    .run(action, version ?? null, details ? JSON.stringify(details) : null);
}

// ── Lecture ───────────────────────────────────────────────────────────────────

let _publishedCache = null;
function _invalidate() { _publishedCache = null; }

function _row(r) {
  return r && { version: r.version, ...JSON.parse(r.content), source: r.source, note: r.note,
    fromVersion: r.from_version, createdAt: r.created_at };
}

function getPublished() {
  if (!_publishedCache) {
    _publishedCache = _row(conn().prepare('SELECT * FROM collection_catalog_versions ORDER BY version DESC LIMIT 1').get());
  }
  return structuredClone(_publishedCache);
}

function getVersion(version) {
  return _row(conn().prepare('SELECT * FROM collection_catalog_versions WHERE version = ?').get(version));
}

function listVersions(limit = 50) {
  return conn().prepare('SELECT version, source, note, from_version, created_at, content FROM collection_catalog_versions ORDER BY version DESC LIMIT ?')
    .all(limit).map(r => {
      const c = JSON.parse(r.content);
      return { version: r.version, source: r.source, note: r.note, fromVersion: r.from_version, createdAt: r.created_at,
        series: c.series.length, items: c.items.length, dropping: c.items.filter(i => i.active && i.dropEnabled).length };
    });
}

function getDraft() {
  const r = conn().prepare('SELECT * FROM collection_catalog_draft WHERE id = 1').get();
  return r ? { ...JSON.parse(r.content), basedOn: r.based_on, updatedAt: r.updated_at } : null;
}

function _seasonInfo(ids) {
  const out = {};
  const stmt = conn().prepare('SELECT id, name, status, start_at, end_at FROM seasons WHERE id = ?');
  for (const id of ids) {
    const s = stmt.get(id);
    if (s) out[id] = { id: s.id, name: s.name, status: s.status, startAt: s.start_at, endAt: s.end_at };
  }
  return out;
}

/** Catalogue public (jeu) : version en vigueur + saisons référencées (nom, statut). */
function publicCatalog() {
  const p = getPublished();
  const seasonIds = [...new Set(p.series.map(s => s.seasonId).filter(id => id != null))];
  return { version: p.version, series: p.series, items: p.items, seasons: _seasonInfo(seasonIds) };
}

function _publishedIds() {
  const series = new Set(), items = new Set();
  for (const r of conn().prepare('SELECT content FROM collection_catalog_versions').all()) {
    const c = JSON.parse(r.content);
    for (const s of c.series) series.add(s.id);
    for (const i of c.items) items.add(i.id);
  }
  return { series, items };
}

// ── Validation ────────────────────────────────────────────────────────────────

const _int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

function _texts(input, where, label, maxLen) {
  if (!input || typeof input !== 'object') return null;
  const out = {};
  for (const l of LANGS) {
    const v = String(input[l] ?? '').trim().slice(0, maxLen);
    if (/[<>]/.test(v)) throw new CatalogError(400, `${where} : ${label} ${l} invalide (caractères < > interdits).`);
    if (v) out[l] = v;
  }
  return Object.keys(out).length ? out : null;
}

function _icon(v, where) {
  const icon = String(v ?? '').trim();
  if (!icon || [...icon].length > 4 || /[<>&"'\s]/.test(icon)) throw new CatalogError(400, `${where} : icône (emoji, 1 à 4 caractères) invalide.`);
  return icon;
}

function normalizeSeries(input) {
  if (!input || typeof input !== 'object') throw new CatalogError(400, 'Série manquante.');
  const id = String(input.id ?? '').trim();
  const where = `Série « ${id || '?'} »`;
  if (!ID_RE.test(id)) throw new CatalogError(400, `${where} : identifiant invalide (2 à 40 caractères a-z, 0-9, _).`);
  const names = _texts(input.names, where, 'nom', 60);
  if (!names?.fr) throw new CatalogError(400, `${where} : nom FR obligatoire.`);
  let seasonId = input.seasonId === null || input.seasonId === undefined || input.seasonId === '' ? null : Number(input.seasonId);
  if (seasonId !== null) {
    if (!_int(seasonId, 1, 1e9)) throw new CatalogError(400, `${where} : saison invalide.`);
    if (!conn().prepare('SELECT 1 FROM seasons WHERE id = ?').get(seasonId)) throw new CatalogError(400, `${where} : saison ${seasonId} introuvable.`);
  }
  return { id, names, seasonId, icon: _icon(input.icon, where), active: input.active !== false };
}

function normalizeItem(input) {
  if (!input || typeof input !== 'object') throw new CatalogError(400, 'Objet manquant.');
  const id = String(input.id ?? '').trim();
  const where = `Objet « ${id || '?'} »`;
  if (!ID_RE.test(id)) throw new CatalogError(400, `${where} : identifiant invalide (2 à 40 caractères a-z, 0-9, _).`);
  const seriesId = String(input.seriesId ?? '').trim();
  if (!ID_RE.test(seriesId)) throw new CatalogError(400, `${where} : série obligatoire.`);
  const names = _texts(input.names, where, 'nom', 60);
  if (!names?.fr) throw new CatalogError(400, `${where} : nom FR obligatoire.`);
  const stories = _texts(input.stories, where, 'histoire', 1200);
  const rarity = String(input.rarity ?? '');
  if (!RARITIES.includes(rarity)) throw new CatalogError(400, `${where} : rareté invalide (${RARITIES.join(', ')}).`);
  const image = input.image ? String(input.image).trim() : null;
  if (image && (!IMAGE_RE.test(image) || image.includes('..'))) throw new CatalogError(400, `${where} : image attendue (téléversée, ou /assets/… .webp/.png/.svg).`);
  const d = input.drop && typeof input.drop === 'object' ? input.drop : {};
  const from = Array.isArray(d.from) ? [...new Set(d.from.map(String))] : [];
  if (!from.length || from.some(c => !CATEGORIES.includes(c))) throw new CatalogError(400, `${where} : blocs sources (au moins une catégorie parmi ${CATEGORIES.join(', ')}).`);
  const minDepth = Number(d.minDepth), chance = Number(d.chance);
  if (!_int(minDepth, 1, 1e6)) throw new CatalogError(400, `${where} : profondeur minimale entière ≥ 1.`);
  if (!(Number.isFinite(chance) && chance > 0 && chance <= MAX_CHANCE)) throw new CatalogError(400, `${where} : chance par bloc entre 0 et ${MAX_CHANCE} (ex. 0.03 = 3 %).`);
  return { id, seriesId, names, stories, rarity, icon: _icon(input.icon, where), image,
    drop: { from, minDepth, chance: Math.round(chance * 1e5) / 1e5 },
    dropEnabled: input.dropEnabled === true, active: input.active !== false };
}

/** Valide un contenu complet. @returns {{ errors, warnings, series, items }} */
function validateContent(raw, { required = _publishedIds() } = {}) {
  const errors = [], warnings = [];
  const series = [], items = [];
  const seenS = new Set(), seenI = new Set();
  const rawSeries = Array.isArray(raw?.series) ? raw.series : [];
  const rawItems = Array.isArray(raw?.items) ? raw.items : [];
  if (rawSeries.length > MAX_SERIES) errors.push(`Au plus ${MAX_SERIES} séries.`);
  if (rawItems.length > MAX_ITEMS) errors.push(`Au plus ${MAX_ITEMS} objets.`);
  for (const r of rawSeries) {
    try {
      const s = normalizeSeries(r);
      if (seenS.has(s.id)) { errors.push(`Série « ${s.id} » en double.`); continue; }
      seenS.add(s.id); series.push(s);
    } catch (err) { if (!(err instanceof CatalogError)) throw err; errors.push(err.message); }
  }
  for (const r of rawItems) {
    try {
      const i = normalizeItem(r);
      if (seenI.has(i.id)) { errors.push(`Objet « ${i.id} » en double.`); continue; }
      if (!seenS.has(i.seriesId)) errors.push(`Objet « ${i.id} » : série « ${i.seriesId} » inconnue.`);
      seenI.add(i.id); items.push(i);
    } catch (err) { if (!(err instanceof CatalogError)) throw err; errors.push(err.message); }
  }
  for (const id of required.series) if (!seenS.has(id)) errors.push(`Série « ${id} » déjà publiée : elle ne peut pas être supprimée, seulement désactivée.`);
  for (const id of required.items) if (!seenI.has(id)) errors.push(`Objet « ${id} » déjà publié (sauvegardes) : il ne peut pas être supprimé, seulement désactivé.`);
  for (const s of series) {
    if (!s.active) warnings.push(`Série « ${s.id} » désactivée : ses objets ne tombent plus (les objets acquis restent visibles).`);
    if (!items.some(i => i.seriesId === s.id)) warnings.push(`Série « ${s.id} » sans objet.`);
  }
  for (const i of items) {
    if (!i.stories?.fr) warnings.push(`Objet « ${i.id} » sans histoire FR.`);
    const missing = LANGS.filter(l => !i.names[l]);
    if (missing.length) warnings.push(`Objet « ${i.id} » : nom manquant en ${missing.join(', ')} (le FR est affiché).`);
  }
  return { errors, warnings, series, items };
}

/** Écarts entre deux contenus, champ par champ. */
function diff(from, to) {
  const changes = [];
  for (const kind of ['series', 'items']) {
    const before = new Map((from[kind] ?? []).map(x => [x.id, x]));
    for (const x of to[kind] ?? []) {
      const b = before.get(x.id);
      if (!b) { changes.push({ kind, id: x.id, change: 'added' }); continue; }
      const fields = Object.keys(x).filter(k => JSON.stringify(x[k] ?? null) !== JSON.stringify(b[k] ?? null))
        .map(k => ({ field: k, before: b[k] ?? null, after: x[k] ?? null }));
      if (fields.length) changes.push({ kind, id: x.id, change: 'changed', fields });
    }
  }
  return changes;
}

/**
 * Drops nouveaux ou modifiés par rapport à la version en vigueur : objet actif dont le drop est
 * activé et (nouveau, ou drop jusque-là inactif, ou barème/série changé). Exige `confirmDrops`.
 */
function dropChanges(from, to) {
  const before = new Map(from.items.map(i => [i.id, i]));
  const seriesBefore = new Map(from.series.map(s => [s.id, s]));
  const seriesAfter = new Map(to.series.map(s => [s.id, s]));
  const live = (i, sMap) => i && i.active && i.dropEnabled && sMap.get(i.seriesId)?.active !== false;
  const out = [];
  for (const i of to.items) {
    if (!live(i, seriesAfter)) continue;
    const b = before.get(i.id);
    const sA = seriesAfter.get(i.seriesId), sB = b && seriesBefore.get(b.seriesId);
    if (!live(b, seriesBefore) || JSON.stringify(b.drop) !== JSON.stringify(i.drop) || b.seriesId !== i.seriesId
        || (sB?.seasonId ?? null) !== (sA?.seasonId ?? null)) {
      out.push({ id: i.id, drop: i.drop, seasonId: sA?.seasonId ?? null });
    }
  }
  return out;
}

// ── Brouillon, publication, retour arrière ────────────────────────────────────

function _saveDraft(content, basedOn) {
  conn().prepare(`INSERT INTO collection_catalog_draft (id, content, based_on, updated_at) VALUES (1, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET content = excluded.content, based_on = excluded.based_on, updated_at = excluded.updated_at`)
    .run(JSON.stringify({ series: content.series, items: content.items }), basedOn);
}

function _draftOrPublished() {
  const d = getDraft();
  if (d) return d;
  const p = getPublished();
  return { series: p.series, items: p.items, basedOn: p.version };
}

function _upsert(kind, normalize, input, max) {
  const x = normalize(input);
  return conn().transaction(() => {
    const draft = _draftOrPublished();
    const list = draft[kind];
    const i = list.findIndex(e => e.id === x.id);
    if (i < 0 && list.length >= max) throw new CatalogError(400, `Au plus ${max} éléments.`);
    const before = i >= 0 ? list[i] : null;
    if (i >= 0) list[i] = x; else list.push(x);
    _saveDraft(draft, draft.basedOn);
    _audit(i >= 0 ? `draft_update_${kind}` : `draft_add_${kind}`, null,
      { id: x.id, changes: before ? diff({ [kind]: [before] }, { [kind]: [x] })[0]?.fields ?? [] : null });
    return x;
  })();
}

const upsertDraftSeries = input => _upsert('series', normalizeSeries, input, MAX_SERIES);
const upsertDraftItem = input => _upsert('items', normalizeItem, input, MAX_ITEMS);

function removeDraftEntry(kind, id) {
  if (!['series', 'items'].includes(kind)) throw new CatalogError(400, 'Type invalide.');
  return conn().transaction(() => {
    if (_publishedIds()[kind].has(id)) throw new CatalogError(409, `« ${id} » est déjà publié : désactivez-le au lieu de le supprimer.`);
    const draft = getDraft();
    if (!draft || !draft[kind].some(e => e.id === id)) throw new CatalogError(404, 'Élément absent du brouillon.');
    if (kind === 'series' && draft.items.some(i => i.seriesId === id)) throw new CatalogError(409, 'Série encore utilisée par des objets du brouillon.');
    draft[kind] = draft[kind].filter(e => e.id !== id);
    _saveDraft(draft, draft.basedOn);
    _audit(`draft_remove_${kind}`, null, { id });
  })();
}

function discardDraft() {
  const r = conn().prepare('DELETE FROM collection_catalog_draft WHERE id = 1').run();
  if (r.changes) _audit('draft_discard', null, null);
  return r.changes > 0;
}

function publishDraft({ note, expectedBasedOn, confirmDrops } = {}) {
  const result = conn().transaction(() => {
    const draft = getDraft();
    if (!draft) throw new CatalogError(409, 'Aucun brouillon à publier.');
    const current = getPublished();
    if (draft.basedOn !== current.version || (expectedBasedOn != null && expectedBasedOn !== current.version)) {
      throw new CatalogError(409, `Le brouillon part de la version ${draft.basedOn}, la version en vigueur est la ${current.version} : rechargez.`);
    }
    const v = validateContent(draft);
    if (v.errors.length) throw new CatalogError(400, 'Brouillon invalide.', v.errors);
    const changes = diff(current, v);
    if (!changes.length) throw new CatalogError(409, 'Aucun changement par rapport à la version en vigueur.');
    const drops = dropChanges(current, v);
    if (drops.length && confirmDrops !== true) {
      throw new CatalogError(409, 'Nouveaux drops ou barème modifié : cochez « barème validé » pour publier.', drops.map(d => `${d.id} : ${JSON.stringify(d.drop)}`));
    }
    const version = current.version + 1;
    conn().prepare("INSERT INTO collection_catalog_versions (version, content, source, note, from_version) VALUES (?, ?, 'publish', ?, ?)")
      .run(version, JSON.stringify({ series: v.series, items: v.items }), String(note ?? '').trim().slice(0, 300) || null, current.version);
    conn().prepare('DELETE FROM collection_catalog_draft WHERE id = 1').run();
    _audit('publish', version, { changes, dropsConfirmed: drops.length ? drops : undefined });
    return { version, changes, drops, warnings: v.warnings };
  })();
  _invalidate();
  return result;
}

/**
 * Retour arrière : publie une NOUVELLE version au contenu d'une version antérieure. Séries et objets
 * ajoutés depuis restent présents mais désactivés (objets acquis toujours affichés).
 */
function rollbackTo(target, { note } = {}) {
  const result = conn().transaction(() => {
    const old = getVersion(target);
    if (!old) throw new CatalogError(404, 'Version introuvable.');
    const current = getPublished();
    if (old.version === current.version) throw new CatalogError(409, 'Cette version est déjà en vigueur.');
    const keep = (kind) => {
      const ids = new Set(old[kind].map(x => x.id));
      return [...old[kind], ...current[kind].filter(x => !ids.has(x.id)).map(x => ({ ...x, active: false }))];
    };
    const content = { series: keep('series'), items: keep('items') };
    const v = validateContent(content);
    if (v.errors.length) throw new CatalogError(400, 'Retour arrière impossible.', v.errors);
    const version = current.version + 1;
    conn().prepare("INSERT INTO collection_catalog_versions (version, content, source, note, from_version) VALUES (?, ?, 'rollback', ?, ?)")
      .run(version, JSON.stringify({ series: v.series, items: v.items }), String(note ?? '').trim().slice(0, 300) || `Retour à la version ${old.version}`, old.version);
    _audit('rollback', version, { to: old.version, changes: diff(current, v) });
    return { version, restored: old.version };
  })();
  _invalidate();
  return result;
}

function listAudit(limit = 100) {
  return conn().prepare('SELECT * FROM collection_catalog_audit ORDER BY id DESC LIMIT ?').all(limit)
    .map(a => ({ ...a, details: a.details ? JSON.parse(a.details) : null }));
}

// ── Images ────────────────────────────────────────────────────────────────────

const SIGNATURES = [
  { mime: 'image/png',  ext: 'png',  test: b => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: 'jpg',  test: b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/webp', ext: 'webp', test: b => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
];

/** Téléverse une image (data URL ou base64). Contenu vérifié par signature ; dédoublonné par SHA-256. */
function storeImage(dataUrl, label) {
  const m = /^(?:data:image\/(?:png|jpeg|webp);base64,)?([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl ?? ''));
  if (!m) throw new CatalogError(400, 'Image attendue en PNG, JPEG ou WebP (base64).');
  const buf = Buffer.from(m[1].replace(/\s/g, ''), 'base64');
  if (!buf.length) throw new CatalogError(400, 'Image vide.');
  if (buf.length > MAX_IMAGE_BYTES) throw new CatalogError(413, `Image trop lourde (${Math.round(buf.length / 1024)} Ko, maximum ${MAX_IMAGE_BYTES / 1024} Ko).`);
  const sig = SIGNATURES.find(s => s.test(buf));
  if (!sig) throw new CatalogError(400, 'Format non reconnu : PNG, JPEG ou WebP uniquement.');
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const cleanLabel = String(label ?? '').replace(/[<>]/g, '').trim().slice(0, 80) || null;
  const r = conn().prepare('INSERT OR IGNORE INTO collection_images (sha256, mime, ext, bytes, data, label) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sha256, sig.mime, sig.ext, buf.length, buf, cleanLabel);
  if (r.changes) _audit('image_upload', null, { sha256, bytes: buf.length, mime: sig.mime, label: cleanLabel });
  return { url: `/api/collections/images/${sha256}.${sig.ext}`, sha256, bytes: buf.length, mime: sig.mime, duplicate: r.changes === 0 };
}

function getImage(sha256, ext) {
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
  const r = conn().prepare('SELECT mime, ext, data FROM collection_images WHERE sha256 = ?').get(sha256);
  return r && r.ext === ext ? r : null;
}

function listImages(limit = 100) {
  return conn().prepare('SELECT sha256, mime, ext, bytes, label, created_at FROM collection_images ORDER BY created_at DESC LIMIT ?').all(limit)
    .map(r => ({ ...r, url: `/api/collections/images/${r.sha256}.${r.ext}` }));
}

// ── Vue admin ─────────────────────────────────────────────────────────────────

function buildAdminView() {
  const published = getPublished();
  const draft = getDraft();
  const validation = draft ? validateContent(draft) : null;
  const ids = _publishedIds();
  return {
    published,
    draft: draft && { ...draft, errors: validation.errors, warnings: validation.warnings,
      changes: diff(published, validation), drops: dropChanges(published, validation) },
    publishedIds: { series: [...ids.series], items: [...ids.items] },
    versions: listVersions(),
    seasons: conn().prepare('SELECT id, name, status, start_at, end_at FROM seasons ORDER BY id DESC LIMIT 60').all(),
    images: listImages(),
    categories: CATEGORIES,
    rarities: RARITIES,
    langs: LANGS,
  };
}

module.exports = {
  CatalogError, CATEGORIES, RARITIES, LANGS, ORIGIN_ITEMS,
  init, originContent, getPublished, getVersion, getDraft, listVersions, publicCatalog,
  normalizeSeries, normalizeItem, validateContent, diff, dropChanges,
  upsertDraftSeries, upsertDraftItem, removeDraftEntry, discardDraft, publishDraft, rollbackTo, listAudit,
  storeImage, getImage, listImages, buildAdminView,
};
