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
 *   - publication ciblée d'UNE série (03/11) : la nouvelle version = version en vigueur + cette
 *     série et ses objets tirés du brouillon ; le reste du brouillon (autres séries) reste en
 *     brouillon. Refusée tant que la série n'est pas complète (`seriesReadiness`). La publication
 *     globale refuse aussi une série incomplète, sauf acceptation explicite (`confirmIncomplete`) ;
 *   - une série ou un objet publié n'est jamais supprimé (les sauvegardes y font référence) : il se
 *     désactive. Les objets acquis restent dans la sauvegarde du joueur (aucune réécriture) ;
 *   - une série est permanente (seasonId null) ou rattachée à une saison : ses objets ne tombent que
 *     pendant cette saison, puis passent en « archives » consultables ;
 *   - saison future pas encore créée (03/11) : `seasonWeek` (« 2026-W46 », semaine ISO) rattache la
 *     série à la saison qui commencera cette semaine-là. Tant que cette saison n'existe pas en base, la
 *     série et ses objets sont RETIRÉS du catalogue public (ni visibles ni obtenables : aucun client,
 *     même ancien, ne peut les traiter comme permanents) ; dès qu'elle existe, le catalogue public
 *     expose `seasonId` = cette saison (résolution à la lecture, sans réécrire les versions publiées).
 *     Résolution : saison attachée au thème #48 de cette semaine, sinon la première saison qui commence
 *     dans la semaine (lundi 00:00 → dimanche 23:59:59 UTC). Un `seasonId` explicite l'emporte ;
 *   - aucun nouveau drop sans validation du barème : publier un objet dont le drop est activé ou
 *     modifié exige une confirmation explicite (`confirmDrops`) — tracée au journal ;
 *   - images téléversées stockées dans la base (`collection_images`, couvertes par les sauvegardes),
 *     servies sous /api/collections/images/<sha256>.<ext>, contrôlées par signature (PNG/JPEG/WebP).
 */

'use strict';

const crypto = require('crypto');
const db     = require('./db');
const cal    = require('./seasonCalendar');

const CATEGORIES = ['terre', 'pierre', 'minerai', 'coffre', 'gemme'];
const RARITIES   = ['commun', 'peu-commun', 'rare', 'epique', 'legendaire'];
const LANGS      = [...require('./languages').CONTENT_LANGS];
const MAX_ITEMS  = 400;
const MAX_SERIES = 60;
const MAX_IMAGE_BYTES = 350 * 1024;
const MAX_CHANCE = 0.5;
const MAX_PITY_STEP = 0.05;   // chance croissante (#39, 04/11) : au plus +5 points par tirage raté

const ID_RE    = /^[a-z][a-z0-9_]{1,39}$/;
const WEEK_RE  = /^(\d{4})-W(\d{2})$/;
const IMAGE_RE = /^(\/assets\/[A-Za-z0-9_\-/.]+\.(webp|png|svg)|\/api\/collections\/images\/[0-9a-f]{64}\.(png|jpg|webp)|\/media\/icons\/[a-f0-9]{16}\.webp)$/;

class CatalogError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

const conn = () => db.getDb();

// ── Contenu d'origine (v1) ────────────────────────────────────────────────────

const ORIGIN_SERIES = [{
  id: 'origines',
  names: { fr: 'Collection des origines', en: 'Origins collection', nl: 'Oorsprongscollectie', es: 'Colección de los orígenes' },
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

/**
 * Objets à chance croissante qui n'ont JAMAIS pu tomber dans le jeu (aucune version publiée ne les
 * a eus en drop actif sans hausse) : seul le serveur peut les donner, une sauvegarde qui les
 * contient sans trouvaille serveur est falsifiée (collectionPity.mergeInto les retire).
 */
let _serverOnly = null;
function serverOnlyIds() {
  const v = getPublished().version;
  if (_serverOnly?.version === v) return _serverOnly.ids;
  const pity = new Set(getPublished().items.filter(isServerDrop).map(i => i.id));
  for (const r of conn().prepare('SELECT content FROM collection_catalog_versions').all()) {
    for (const i of JSON.parse(r.content).items) if (pity.has(i.id) && i.dropEnabled && !isServerDrop(i)) pity.delete(i.id);
  }
  for (const id of ORIGIN_ITEMS.map(i => i.id)) pity.delete(id);   // coffres de la boutique (chestShop.js)
  _serverOnly = { version: v, ids: pity };
  return pity;
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

// ── Saison future par semaine ISO (03/11) ─────────────────────────────────────

/** Lundi 00:00:00 UTC de la semaine ISO « 2026-W46 », ou null si la clé est invalide. */
function weekMonday(weekKey) {
  const m = WEEK_RE.exec(String(weekKey ?? ''));
  if (!m) return null;
  const year = +m[1], week = +m[2];
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 864e5 + (week - 1) * 7 * 864e5);
  // Semaine 53 inexistante (ex. 2026-W53) : le lundi calculé tombe dans l'année ISO suivante
  const thu = new Date(monday.getTime() + 3 * 864e5);
  return week >= 1 && thu.getUTCFullYear() === year ? monday : null;
}

const _sqlUtc = d => d.toISOString().slice(0, 19).replace('T', ' ');

/**
 * Saison réelle d'une semaine ISO (lecture seule) : celle du thème #48 de cette semaine si elle lui
 * est attachée, sinon la première saison qui commence dans la semaine. null tant qu'elle n'existe pas.
 */
function weekSeasonId(weekKey) {
  const monday = weekMonday(weekKey);
  if (!monday) return null;
  try {
    const t = conn().prepare('SELECT season_id FROM season_themes WHERE week_key = ? AND season_id IS NOT NULL ORDER BY id LIMIT 1').get(weekKey);
    if (t?.season_id != null && conn().prepare('SELECT 1 FROM seasons WHERE id = ?').get(t.season_id)) return t.season_id;
  } catch (_) { /* table des thèmes absente (bases de test) */ }
  const s = conn().prepare('SELECT id FROM seasons WHERE start_at >= ? AND start_at < ? ORDER BY start_at, id LIMIT 1')
    .get(_sqlUtc(monday), _sqlUtc(new Date(monday.getTime() + 7 * 864e5)));
  return s?.id ?? null;
}

/** Saison effective : `seasonId` explicite, sinon saison résolue de `seasonWeek` ; `pending` = semaine sans saison réelle. */
function effectiveSeason(series) {
  if (series.seasonId != null) return { seasonId: series.seasonId, pending: false };
  if (!series.seasonWeek) return { seasonId: null, pending: false };
  const id = weekSeasonId(series.seasonWeek);
  return { seasonId: id, pending: id == null };
}

/**
 * Catalogue public (jeu) : version en vigueur + saisons référencées (nom, statut). Une série en
 * attente de sa saison future (et ses objets) n'y figure pas ; une série résolue y porte `seasonId`.
 */
function publicCatalog() {
  const p = getPublished();
  const pending = new Set();
  const series = [];
  for (const s of p.series) {
    const eff = effectiveSeason(s);
    if (eff.pending) { pending.add(s.id); continue; }
    series.push(eff.seasonId === s.seasonId ? s : { ...s, seasonId: eff.seasonId });
  }
  // Objet à chance croissante : tiré par le serveur (collectionPity.js). `dropEnabled: false` pour le
  // client, y compris un onglet resté sur une ancienne version du jeu : jamais de second tirage local.
  const items = (pending.size ? p.items.filter(i => !pending.has(i.seriesId)) : p.items)
    .map(i => (isServerDrop(i) ? { ...i, dropEnabled: false, serverDrop: i.dropEnabled === true } : i));
  const seasonIds = [...new Set(series.map(s => s.seasonId).filter(id => id != null))];
  return { version: p.version, series, items, seasons: _seasonInfo(seasonIds) };
}

/** Objet tiré côté serveur (chance croissante) plutôt que par Collection.tryDrop. */
const isServerDrop = item => (item?.drop?.pityStep ?? 0) > 0;

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
  // Semaine d'une saison future : seulement sans saison explicite (le seasonId l'emporte et la remplace)
  const week = seasonId === null && input.seasonWeek ? String(input.seasonWeek).trim() : null;
  if (week && !weekMonday(week)) throw new CatalogError(400, `${where} : semaine de saison invalide (format 2026-W46 attendu).`);
  return { id, names, seasonId, ...(week ? { seasonWeek: week } : {}), icon: _icon(input.icon, where), active: input.active !== false };
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
  if (image && (!IMAGE_RE.test(image) || image.includes('..'))) throw new CatalogError(400, `${where} : image attendue (téléversée, atelier d'icônes /media/icons/…, ou /assets/… .webp/.png/.svg).`);
  const d = input.drop && typeof input.drop === 'object' ? input.drop : {};
  const from = Array.isArray(d.from) ? [...new Set(d.from.map(String))] : [];
  if (!from.length || from.some(c => !CATEGORIES.includes(c))) throw new CatalogError(400, `${where} : blocs sources (au moins une catégorie parmi ${CATEGORIES.join(', ')}).`);
  const minDepth = Number(d.minDepth), chance = Number(d.chance);
  if (!_int(minDepth, 1, 1e6)) throw new CatalogError(400, `${where} : profondeur minimale entière ≥ 1.`);
  if (!(Number.isFinite(chance) && chance > 0 && chance <= MAX_CHANCE)) throw new CatalogError(400, `${where} : chance par bloc entre 0 et ${MAX_CHANCE} (ex. 0.03 = 3 %).`);
  // Chance croissante (#39, décision du 04/11) : + pityStep par tirage éligible raté, tirée par le serveur
  const pityStep = d.pityStep === undefined || d.pityStep === null || d.pityStep === '' ? 0 : Number(d.pityStep);
  if (!(Number.isFinite(pityStep) && pityStep >= 0 && pityStep <= MAX_PITY_STEP)) throw new CatalogError(400, `${where} : hausse par tirage raté entre 0 et ${MAX_PITY_STEP} (ex. 0.001 = +0,1 point).`);
  const step = Math.round(pityStep * 1e5) / 1e5;
  return { id, seriesId, names, stories, rarity, icon: _icon(input.icon, where), image,
    drop: { from, minDepth, chance: Math.round(chance * 1e5) / 1e5, ...(step > 0 ? { pityStep: step } : {}) },
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
        || (sB?.seasonId ?? null) !== (sA?.seasonId ?? null) || (sB?.seasonWeek ?? null) !== (sA?.seasonWeek ?? null)) {
      out.push({ id: i.id, drop: i.drop, seasonId: sA?.seasonId ?? null, seasonWeek: sA?.seasonWeek ?? null });
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

/**
 * Barème « chance croissante » choisi par le propriétaire le 04/11 (#39) : communs 4 %, rare 2 %
 * + 0,1 point par tirage éligible raté, légendaire 3 % + 0,3 point par gemme éligible ratée. Les
 * autres raretés (peu commun, épique) gardent leur taux : aucun taux inventé.
 */
const PITY_PRESETS = {
  croissant: {
    label: 'Chance croissante (choix du propriétaire, 04/11)',
    rarities: { commun: { chance: 0.04 }, rare: { chance: 0.02, pityStep: 0.001 }, legendaire: { chance: 0.03, pityStep: 0.003 } },
  },
};

/** Objets d'une série avec un modèle de barème appliqué (sources, profondeur, drop activé inchangés). */
function presetItems(items, presetId) {
  const preset = PITY_PRESETS[presetId];
  if (!preset) throw new CatalogError(400, 'Modèle de barème inconnu.');
  return items.map(i => {
    const r = preset.rarities[i.rarity];
    if (!r) return i;
    const { pityStep: _old, ...drop } = i.drop;
    return { ...i, drop: { ...drop, chance: r.chance, ...(r.pityStep ? { pityStep: r.pityStep } : {}) } };
  });
}

/**
 * Applique un modèle aux objets d'une série DANS LE BROUILLON (rien n'est publié ni activé : la
 * case « Drop activé » et les images ne changent pas). @returns {{ changed: Array<{id, before, after}> }}
 */
function applyPresetToDraft(seriesId, presetId) {
  return conn().transaction(() => {
    const draft = _draftOrPublished();
    if (!draft.series.some(s => s.id === seriesId)) throw new CatalogError(404, `Série « ${seriesId} » absente du brouillon.`);
    const mine = draft.items.filter(i => i.seriesId === seriesId);
    if (!mine.length) throw new CatalogError(400, `Série « ${seriesId} » sans objet.`);
    const next = new Map(presetItems(mine, presetId).map(i => [i.id, normalizeItem(i)]));
    const changed = [];
    draft.items = draft.items.map(i => {
      const n = next.get(i.id);
      if (!n || JSON.stringify(n.drop) === JSON.stringify(i.drop)) return i;
      changed.push({ id: i.id, before: i.drop, after: n.drop });
      return n;
    });
    if (changed.length) {
      _saveDraft(draft, draft.basedOn);
      _audit('draft_preset', null, { seriesId, preset: presetId, changes: changed });
    }
    return { changed, preset: presetId };
  })();
}

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

function publishDraft({ note, expectedBasedOn, confirmDrops, confirmIncomplete } = {}) {
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
    const incomplete = _touchedSeries(changes, v).map(id => seriesReadiness(v, id, { published: current }))
      .filter(r => r && r.blocking.length);
    if (incomplete.length && confirmIncomplete !== true) {
      throw new CatalogError(409, 'Le brouillon contient des séries incomplètes : publiez la série prête seule (publication ciblée), ou acceptez explicitement de publier des éléments incomplets.',
        incomplete.flatMap(r => r.blocking.map(b => `${r.seriesId} : ${b}`)));
    }
    const drops = dropChanges(current, v);
    if (drops.length && confirmDrops !== true) {
      throw new CatalogError(409, 'Nouveaux drops ou barème modifié : cochez « barème validé » pour publier.', drops.map(d => `${d.id} : ${JSON.stringify(d.drop)}`));
    }
    const version = current.version + 1;
    conn().prepare("INSERT INTO collection_catalog_versions (version, content, source, note, from_version) VALUES (?, ?, 'publish', ?, ?)")
      .run(version, JSON.stringify({ series: v.series, items: v.items }), String(note ?? '').trim().slice(0, 300) || null, current.version);
    conn().prepare('DELETE FROM collection_catalog_draft WHERE id = 1').run();
    _audit('publish', version, { changes, dropsConfirmed: drops.length ? drops : undefined,
      incompleteConfirmed: incomplete.length ? incomplete.map(r => r.seriesId) : undefined });
    return { version, changes, drops, warnings: v.warnings };
  })();
  _invalidate();
  return result;
}

// ── Complétude d'une série et publication ciblée (03/11) ──────────────────────

const _fmtDate = v => String(v ?? '').slice(0, 16);

/** « 2026-W46 (semaine du 09/11/2026) » */
function _weekLabel(week) {
  const m = weekMonday(week);
  return m ? `${week} (semaine du ${m.toISOString().slice(0, 10).split('-').reverse().join('/')})` : week;
}

/**
 * Semaines futures proposées dans le choix de saison (admin) : thèmes #48 préparés et semaines à
 * venir sans saison créée, jusqu'à `weeks` semaines. Une semaine dont la saison existe déjà n'y
 * figure pas (la saison elle-même est proposée).
 */
function futureWeeks(now = new Date(), weeks = 8) {
  let themes = [];
  try {
    themes = conn().prepare("SELECT week_key, planned_start, names, series_id FROM season_themes WHERE status = 'prepared' AND season_id IS NULL").all();
  } catch (_) { /* table des thèmes absente */ }
  const byWeek = new Map(themes.map(t => [t.week_key, t]));
  const out = [];
  const keys = new Set(themes.map(t => t.week_key));
  for (let k = 0; k <= weeks; k++) {
    const { year, week } = cal.isoWeek(new Date(now.getTime() + k * 7 * 864e5));
    keys.add(`${year}-W${String(week).padStart(2, '0')}`);
  }
  for (const key of [...keys].sort()) {
    const monday = weekMonday(key);
    if (!monday || monday.getTime() <= now.getTime() || weekSeasonId(key) != null) continue;   // semaines à venir seulement
    const t = byWeek.get(key);
    let name = null;
    try { name = t ? JSON.parse(t.names).fr : null; } catch (_) { /* thème illisible */ }
    out.push({ week: key, monday: _sqlUtc(monday), label: _weekLabel(key), themeName: name, themeSeriesId: t?.series_id ?? null });
  }
  return out;
}

/**
 * État de publication d'une série dans un contenu (brouillon ou version cible), par rapport à ce
 * qui a déjà été publié. `blocking` vide = la série peut être publiée seule sans exposer de contenu
 * incomplet. `needsPermanent` : nouvelle série sans saison → la rendre permanente est une décision
 * métier (confirmation `confirmPermanent`).
 */
function seriesReadiness(content, seriesId, { published = getPublished(), ids = _publishedIds(), now = new Date() } = {}) {
  const s = (content.series ?? []).find(x => x.id === seriesId);
  if (!s) return null;
  const isNew = !ids.series.has(s.id);
  const blocking = [], warnings = [], info = [];
  let season = null, schedule, needsPermanent = false;
  const eff = effectiveSeason(s);
  const week = s.seasonId == null && s.seasonWeek ? s.seasonWeek : null;
  const weekLabel = week ? _weekLabel(week) : null;
  if (week && eff.pending) {
    const monday = weekMonday(week);
    if (monday.getTime() + 7 * 864e5 <= now.getTime()) {
      schedule = 'unknown';
      blocking.push(`Semaine ${weekLabel} passée sans saison créée : rattachez la série à une saison existante ou à une semaine future.`);
    } else {
      schedule = 'future';
      if (monday.getTime() <= now.getTime()) warnings.push(`Semaine ${weekLabel} commencée mais saison pas encore créée (rotation en attente) : la série reste invisible et sans drop.`);
      info.push(`Saison future ${weekLabel} : pas encore créée. Série invisible des joueurs et sans drop jusqu'à la création de cette saison `
        + '(rotation automatique), puis rattachement automatique : drops pendant cette saison seulement, archives ensuite.');
    }
  } else if (eff.seasonId == null) {
    schedule = 'permanent';
    if (isNew) {
      needsPermanent = true;
      blocking.push('Permanente : aucune saison choisie. Publiée ainsi, ses objets tomberaient chaque semaine, sans fin (comme la collection des origines). '
        + 'Rattachez-la à une saison (en cours, programmée ou future — semaine), ou confirmez qu\'elle doit être permanente.');
    } else {
      info.push('Série permanente : ses objets tombent quelle que soit la saison.');
    }
  } else {
    season = _seasonInfo([eff.seasonId])[eff.seasonId] ?? null;
    if (week) info.push(`Semaine ${weekLabel} : saison créée (n° ${eff.seasonId}), rattachement automatique effectif.`);
    if (!season) {
      schedule = 'unknown';
      blocking.push(`Saison ${eff.seasonId} introuvable.`);
    } else if (season.status === 'closed' || season.status === 'archived') {
      schedule = 'over';
      (isNew ? blocking : warnings).push(`Saison « ${season.name} » terminée : ses objets ne tomberont plus (archives seulement).`);
    } else if (season.status === 'scheduled') {
      schedule = 'scheduled';
      info.push(`Saison programmée « ${season.name} » : série invisible des joueurs et sans drop jusqu'au ${_fmtDate(season.startAt)} UTC, puis drops jusqu'au ${_fmtDate(season.endAt)} UTC.`);
    } else {
      schedule = 'live';
      info.push(`Saison en cours « ${season.name} » : visible dès la publication, drops jusqu'au ${_fmtDate(season.endAt)} UTC.`);
    }
  }
  if (!s.active) warnings.push('Série désactivée : ses objets ne tombent pas.');
  const items = (content.items ?? []).filter(i => i.seriesId === s.id);
  const active = items.filter(i => i.active);
  if (!active.length) blocking.push('Aucun objet activé.');
  const pubItems = new Map((published.items ?? []).map(i => [i.id, i]));
  const missing = { image: [], names: [], stories: [] };
  for (const i of active) {
    if (ids.items.has(i.id)) continue;   // déjà publié : ses manques éventuels existent déjà en jeu
    if (!i.image) missing.image.push(i.id);
    if (LANGS.some(l => !i.names?.[l])) missing.names.push(i.id);
    if (LANGS.some(l => !i.stories?.[l])) missing.stories.push(i.id);
  }
  if (missing.image.length) blocking.push(`Sans illustration : ${missing.image.join(', ')}.`);
  if (missing.names.length) blocking.push(`Nom manquant dans une langue (${LANGS.join('/').toUpperCase()}) : ${missing.names.join(', ')}.`);
  if (missing.stories.length) blocking.push(`Histoire manquante dans une langue (${LANGS.join('/').toUpperCase()}) : ${missing.stories.join(', ')}.`);
  for (const i of items) {
    const p = pubItems.get(i.id);
    if (p?.image && p.image !== i.image) warnings.push(`Objet « ${i.id} » : l'illustration publiée serait ${i.image ? 'remplacée' : 'retirée'}.`);
  }
  const dropping = active.filter(i => i.dropEnabled);
  if (active.length && !dropping.length) {
    blocking.push('Aucun drop activé : les objets seraient visibles mais introuvables. Activez les drops après validation du barème.');
  } else if (dropping.length < active.length) {
    warnings.push(`Drop inactif : ${active.filter(i => !i.dropEnabled).map(i => i.id).join(', ')}.`);
  }
  return { seriesId: s.id, isNew, schedule, season, needsPermanent, blocking, warnings, info,
    items: items.length, active: active.length, illustrated: active.filter(i => i.image).length, dropping: dropping.length };
}

/** Séries touchées par des changements (série modifiée/ajoutée ou objet modifié/ajouté). */
function _touchedSeries(changes, content) {
  const out = new Set();
  for (const c of changes) {
    if (c.kind === 'series') out.add(c.id);
    else out.add(content.items.find(i => i.id === c.id)?.seriesId);
  }
  out.delete(undefined);
  return [...out];
}

/**
 * Publication ciblée : nouvelle version = version en vigueur + la série `seriesId` et ses objets tels
 * qu'ils sont dans le brouillon. Les autres changements restent en brouillon (rebasé sur la nouvelle
 * version). Refusée si la série n'est pas complète, si la version a changé, ou sans confirmation des
 * drops nouveaux (`confirmDrops`) et du statut permanent d'une nouvelle série (`confirmPermanent`).
 */
function publishSeries(seriesId, { note, expectedBasedOn, confirmDrops, confirmPermanent } = {}) {
  const result = conn().transaction(() => {
    const draft = getDraft();
    if (!draft) throw new CatalogError(409, 'Aucun brouillon à publier.');
    const current = getPublished();
    if (draft.basedOn !== current.version || (expectedBasedOn != null && expectedBasedOn !== current.version)) {
      throw new CatalogError(409, `Le brouillon part de la version ${draft.basedOn}, la version en vigueur est la ${current.version} : rechargez.`);
    }
    const ds = draft.series.find(s => s.id === seriesId);
    if (!ds) throw new CatalogError(404, `Série « ${seriesId} » absente du brouillon.`);
    const draftItems = draft.items.filter(i => i.seriesId === seriesId);
    const byId = new Map(draftItems.map(i => [i.id, i]));
    const curIds = new Set(current.items.map(i => i.id));
    const target = {
      series: current.series.some(s => s.id === seriesId)
        ? current.series.map(s => (s.id === seriesId ? ds : s)) : [...current.series, ds],
      items: [...current.items.map(i => byId.get(i.id) ?? i), ...draftItems.filter(i => !curIds.has(i.id))],
    };
    const v = validateContent(target);
    if (v.errors.length) throw new CatalogError(400, 'Série invalide.', v.errors);
    const changes = diff(current, v);
    if (!changes.length) throw new CatalogError(409, `Aucun changement de la série « ${seriesId} » par rapport à la version en vigueur.`);
    const ready = seriesReadiness(v, seriesId, { published: current });
    const blocking = ready.blocking.filter(b => !(ready.needsPermanent && confirmPermanent === true && b.startsWith('Permanente')));
    if (blocking.length) throw new CatalogError(409, `Série « ${seriesId} » incomplète : publication refusée (rien n'a changé en jeu).`, blocking);
    const drops = dropChanges(current, v);
    if (drops.length && confirmDrops !== true) {
      throw new CatalogError(409, 'Nouveaux drops ou barème modifié : cochez « barème validé » pour publier.', drops.map(d => `${d.id} : ${JSON.stringify(d.drop)}`));
    }
    const version = current.version + 1;
    conn().prepare("INSERT INTO collection_catalog_versions (version, content, source, note, from_version) VALUES (?, ?, 'publish', ?, ?)")
      .run(version, JSON.stringify({ series: v.series, items: v.items }),
        String(note ?? '').trim().slice(0, 300) || `Publication ciblée : série ${seriesId}`, current.version);
    // Le reste du brouillon reste en brouillon, rebasé ; supprimé s'il ne contient plus aucun écart
    if (diff(v, { series: draft.series, items: draft.items }).length) _saveDraft(draft, version);
    else conn().prepare('DELETE FROM collection_catalog_draft WHERE id = 1').run();
    _audit('publish_series', version, { seriesId, changes, dropsConfirmed: drops.length ? drops : undefined,
      permanentConfirmed: ready.needsPermanent || undefined });
    return { version, seriesId, changes, drops, warnings: ready.warnings, info: ready.info };
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
    draft: draft && (() => {
      const changes = diff(published, validation);
      return { ...draft, errors: validation.errors, warnings: validation.warnings, changes, drops: dropChanges(published, validation),
        readiness: _touchedSeries(changes, validation).map(id => seriesReadiness(validation, id, { published, ids })).filter(Boolean) };
    })(),
    publishedIds: { series: [...ids.series], items: [...ids.items] },
    versions: listVersions(),
    seasons: conn().prepare('SELECT id, name, status, start_at, end_at FROM seasons ORDER BY id DESC LIMIT 60').all(),
    futureWeeks: futureWeeks(),
    images: listImages(),
    categories: CATEGORIES,
    rarities: RARITIES,
    pityPresets: PITY_PRESETS,
    maxPityStep: MAX_PITY_STEP,
    langs: LANGS,
  };
}

module.exports = {
  CatalogError, CATEGORIES, RARITIES, LANGS, ORIGIN_ITEMS,
  init, originContent, getPublished, weekMonday, weekSeasonId, effectiveSeason, futureWeeks, getVersion, getDraft, listVersions, publicCatalog,
  normalizeSeries, normalizeItem, validateContent, diff, dropChanges,
  upsertDraftSeries, upsertDraftItem, removeDraftEntry, discardDraft, publishDraft, publishSeries, seriesReadiness, rollbackTo, listAudit,
  storeImage, getImage, listImages, buildAdminView,
  MAX_PITY_STEP, PITY_PRESETS, isServerDrop, serverOnlyIds, presetItems, applyPresetToDraft,
};
