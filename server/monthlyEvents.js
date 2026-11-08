/**
 * server/monthlyEvents.js — Événements mensuels (#56, demande du propriétaire du 02/11/2026).
 *
 * Distincts des saisons hebdomadaires (#16/#48) : un événement a ses propres dates (heure de
 * Bruxelles), ses objets exclusifs et ses souvenirs, qui ne sont JAMAIS remis à zéro par une
 * saison. Aucun gain économique : un objet d'événement est un souvenir (ni pièces, ni gemmes).
 *
 *   - Événement (`monthly_events`) : identifiant, icône, noms et accroches FR/EN/NL/ES, début/fin
 *     (UTC en base, saisis en heure de Bruxelles dans l'admin), public ou TEST (réservé à une liste
 *     de comptes), statut enregistré `draft` | `scheduled`. État affiché : brouillon, planifié
 *     (avant le début), actif, terminé. Rien n'est supprimé ; chaque modification ajoute une
 *     révision (`monthly_event_revisions`) restaurable et une ligne au journal.
 *   - Objets (`monthly_event_items`) : icône, image facultative, consigne d'illustration, noms et
 *     descriptions humoristiques FR/EN/NL/ES, rareté, chance en % PAR BLOC ÉLIGIBLE, profondeur
 *     minimale, catégories de blocs (vide = toutes), activé ; pour l'admin seulement (#86) : date de
 *     référence « MM-JJ » et inspiration historique (jamais une condition de drop, jamais envoyées au joueur).
 *   - « Pourquoi cet objet ? » (#86, demande du propriétaire du 08/11/2026) : explication factuelle FR/EN/NL/ES,
 *     date historique, source HTTPS (`monthly_event_item_lore`). Table à part : modifiable même quand
 *     l'événement est planifié (aucun effet sur les drops ni sur les révisions). Le joueur ne la reçoit
 *     qu'APRÈS avoir trouvé l'objet, et seulement si elle est marquée vérifiée.
 *   - Drop côté serveur uniquement, à la sauvegarde : seuls les blocs VALIDÉS par le serveur
 *     (compteurs `blocks:<type>` de #38, bornés par la profondeur retenue #9/#25) minés depuis le
 *     dernier passage comptent ; tirage par `crypto` (le client ne peut ni choisir ni rejouer).
 *     Curseur par joueur et par événement initialisé au premier passage pendant l'événement :
 *     la progression d'avant l'événement ne compte pas. Chaque objet s'obtient une seule fois par
 *     joueur (clé primaire), même en cas de requêtes simultanées ou de redémarrage.
 *   - Planifier = l'événement est figé (modification impossible sans le repasser en brouillon) ;
 *     public : barème confirmé explicitement. Repasser en brouillon arrête aussitôt les drops ;
 *     les objets déjà trouvés restent acquis.
 *   - Calendrier : une proposition par mois (fêtes calculées : Nouvel An, Nouvel An chinois,
 *     carnaval, Pâques, Halloween, Noël… ; mois sans fête : « thème à choisir », jamais imposé),
 *     date limite de préparation, lien vers l'événement existant.
 *   - IA (#37, blockAi.guardedJson : clé côté serveur, quota, plafond, journal) : proposition de
 *     thème, objets et traductions, TOUJOURS enregistrée en brouillon de test.
 *   - Contenu préparé (`server/content/events/*.json`) importé une seule fois en brouillon.
 *   - Images des objets (#65) : `monthly_event_items.image` est l'image de la FICHE (brouillon,
 *     remplie par l'atelier d'icônes #40 — cible `event:<événement>/<objet>` — ou le téléversement) ;
 *     le joueur ne voit que l'image PUBLIÉE (`monthly_event_item_images`), copiée par une action
 *     explicite de l'événement : « Publier les images », ou sa planification. Sans image publiée :
 *     emoji. États : sans image, proposition (atelier), conservée dans le brouillon, publiée.
 */

'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const db = require('./db');

const conn = () => db.getDb();

const LANGS = [...require('./languages').CONTENT_LANGS];
const LANG_LABELS = require('./languages').ENGLISH_NAMES;
const TZ = 'Europe/Brussels';
const RARITIES = ['commun', 'peu-commun', 'rare', 'epique', 'legendaire'];
const CATEGORIES = ['terre', 'pierre', 'minerai', 'coffre', 'gemme'];
const ID_RE = /^[a-z][a-z0-9_]{2,39}$/;
const MAX = { explain: 420, sourceTitle: 120, sourceUrl: 300, name: 60, tagline: 240, desc: 320, brief: 600, inspiration: 400, items: 40, testers: 20, durationDays: 62, concept: 600 };
const MAX_BLOCKS_PER_SAVE = 2000;   // au-delà, le curseur avance sans tirage (aucune rafale d'objets)
const ANNOUNCE_DAYS = 7;            // annonce « à venir » dans le centre d'actualités (#50)
const CONTENT_DIR = path.join(__dirname, 'content', 'events');
const LORE_DIR = path.join(__dirname, 'content', 'event-lore');
const PROPOSALS_DIR = path.join(__dirname, 'content', 'event-proposals');

class EventError extends Error {
  constructor(status, message, code = null) { super(message); this.status = status; this.code = code; }
}

const J = (v, d) => { try { return v == null ? d : JSON.parse(v); } catch (_) { return d; } };

// ── Schéma (ajout seul, idempotent) ───────────────────────────────────────────

function init(c = conn()) {
  require('./souvenirInventory').init(c);   // #93 : doubles et échanges (ajout seul, tout OFF)
  c.exec(`
    CREATE TABLE IF NOT EXISTS monthly_events (
      id          TEXT PRIMARY KEY,
      status      TEXT NOT NULL DEFAULT 'draft',
      audience    TEXT NOT NULL DEFAULT 'test',
      icon        TEXT NOT NULL DEFAULT '🎉',
      names       TEXT NOT NULL,
      taglines    TEXT NOT NULL,
      starts_at   TEXT NOT NULL,
      ends_at     TEXT NOT NULL,
      testers     TEXT NOT NULL DEFAULT '[]',
      source      TEXT NOT NULL DEFAULT 'manual',
      revision    INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS monthly_event_items (
      event_id    TEXT NOT NULL,
      id          TEXT NOT NULL,
      sort        INTEGER NOT NULL DEFAULT 0,
      icon        TEXT NOT NULL,
      image       TEXT,
      brief       TEXT NOT NULL DEFAULT '',
      names       TEXT NOT NULL,
      descs       TEXT NOT NULL,
      rarity      TEXT NOT NULL,
      chance_pct  REAL NOT NULL,
      min_depth   INTEGER NOT NULL DEFAULT 0,
      drop_from   TEXT NOT NULL DEFAULT '[]',
      enabled     INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (event_id, id)
    );
    CREATE TABLE IF NOT EXISTS monthly_event_finds (
      user_id   INTEGER NOT NULL,
      event_id  TEXT NOT NULL,
      item_id   TEXT NOT NULL,
      found_at  TEXT NOT NULL,
      depth     INTEGER,
      PRIMARY KEY (user_id, event_id, item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_monthly_event_finds_event ON monthly_event_finds(event_id, item_id);
    CREATE TABLE IF NOT EXISTS monthly_event_cursors (
      user_id     INTEGER NOT NULL,
      event_id    TEXT NOT NULL,
      ref_counts  TEXT NOT NULL,
      blocks      INTEGER NOT NULL DEFAULT 0,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, event_id)
    );
    CREATE TABLE IF NOT EXISTS monthly_event_revisions (
      event_id  TEXT NOT NULL,
      revision  INTEGER NOT NULL,
      content   TEXT NOT NULL,
      action    TEXT NOT NULL,
      at        TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (event_id, revision)
    );
    CREATE TABLE IF NOT EXISTS monthly_event_log (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      at        TEXT NOT NULL DEFAULT (datetime('now')),
      event_id  TEXT,
      action    TEXT NOT NULL,
      details   TEXT
    );
    CREATE TABLE IF NOT EXISTS monthly_event_ai (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      concept     TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      error       TEXT,
      event_id    TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS monthly_event_meta (
      key    TEXT PRIMARY KEY,
      value  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS monthly_event_item_images (
      event_id      TEXT NOT NULL,
      item_id       TEXT NOT NULL,
      image         TEXT,
      published_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (event_id, item_id)
    );
    CREATE TABLE IF NOT EXISTS monthly_event_item_lore (
      event_id       TEXT NOT NULL,
      item_id        TEXT NOT NULL,
      explains       TEXT NOT NULL DEFAULT '{}',
      historic_date  TEXT NOT NULL DEFAULT '',
      source_url     TEXT NOT NULL DEFAULT '',
      source_title   TEXT NOT NULL DEFAULT '',
      verified       INTEGER NOT NULL DEFAULT 0,
      updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (event_id, item_id)
    );
  `);
  // #86 : date de référence (« MM-JJ », calendrier d'inspiration) et inspiration historique — admin seulement
  const cols = new Set(c.prepare('PRAGMA table_info(monthly_event_items)').all().map(x => x.name));
  if (!cols.has('ref_date')) c.exec("ALTER TABLE monthly_event_items ADD COLUMN ref_date TEXT NOT NULL DEFAULT ''");
  if (!cols.has('inspiration')) c.exec("ALTER TABLE monthly_event_items ADD COLUMN inspiration TEXT NOT NULL DEFAULT ''");
  // Recette #56-K : souvenir PROPOSÉ (ajouté, pas encore publié) — jamais tiré, jamais montré au joueur, aussi sur un événement planifié
  if (!cols.has('proposal')) c.exec('ALTER TABLE monthly_event_items ADD COLUMN proposal INTEGER NOT NULL DEFAULT 0');
  // Recette #56-K : objectif éditorial (nombre de souvenirs visé, 0 = aucun) — information admin, jamais une condition technique
  const evCols = new Set(c.prepare('PRAGMA table_info(monthly_events)').all().map(x => x.name));
  if (!evCols.has('item_target')) c.exec('ALTER TABLE monthly_events ADD COLUMN item_target INTEGER NOT NULL DEFAULT 0');
  // #65 : avant, l'image de la fiche était montrée telle quelle aux joueurs. Une seule fois, elle devient
  // l'image publiée (aucun visuel déjà affiché ne disparaît) ; ensuite, publication explicite seulement.
  if (!c.prepare("SELECT 1 FROM monthly_event_meta WHERE key = 'published_images_v1'").get()) {
    c.transaction(() => {
      c.prepare(`INSERT OR IGNORE INTO monthly_event_item_images (event_id, item_id, image)
          SELECT event_id, id, image FROM monthly_event_items WHERE image IS NOT NULL`).run();
      c.prepare("INSERT INTO monthly_event_meta (key, value) VALUES ('published_images_v1', ?)").run(new Date().toISOString());
    })();
  }
}

function _log(eventId, action, details = null) {
  conn().prepare('INSERT INTO monthly_event_log (event_id, action, details) VALUES (?, ?, ?)')
    .run(eventId, action, details ? JSON.stringify(details) : null);
}

// ── Dates (heure de Bruxelles) ────────────────────────────────────────────────

const _iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

function _tzOffsetMs(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}

/** « 2026-12-01T00:00 » (heure de Bruxelles) → ISO UTC. */
function brusselsToUtc(local) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(String(local ?? '').trim());
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let ms = guess - _tzOffsetMs(guess);
  ms = guess - _tzOffsetMs(ms);   // changement d'heure : second passage
  return Number.isFinite(ms) ? _iso(ms) : null;
}

/** ISO UTC → « 2026-12-01T00:00 » (heure de Bruxelles). */
function utcToBrussels(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms + _tzOffsetMs(ms)).toISOString().slice(0, 16);
}

function _date(v, label) {
  if (typeof v !== 'string') throw new EventError(400, `${label} : date manquante.`);
  const utc = /Z$/.test(v) ? (Number.isFinite(Date.parse(v)) ? _iso(Date.parse(v)) : null) : brusselsToUtc(v);
  if (!utc) throw new EventError(400, `${label} : date invalide (AAAA-MM-JJTHH:MM, heure de Bruxelles).`);
  return utc;
}

// ── Validation ────────────────────────────────────────────────────────────────

const _str = (v, max) => String(v ?? '').replace(/[<>\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, max);

function _texts(raw, max) {
  const out = {};
  for (const l of LANGS) out[l] = _str(raw?.[l], max);
  return out;
}

function _emoji(v, d) {
  const s = _str(v, 16);
  return s && !/[A-Za-z0-9]/.test(s) ? s : d;
}

// Date de référence d'un objet (#86) : mois-jour d'inspiration, jamais une condition de drop
const REF_DATE_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const IMAGE_RE = /^\/(api\/collections\/images\/[0-9a-f]{64}\.(png|jpg|webp)|media\/icons\/[a-f0-9]{16}\.webp)$/;

function normalizeItem(input, where) {
  const id = String(input?.id ?? '').trim();
  if (!ID_RE.test(id)) throw new EventError(400, `${where} : identifiant invalide (minuscules, chiffres, _ ; 3 à 40 caractères).`);
  const names = _texts(input.names, MAX.name);
  if (!names.fr) throw new EventError(400, `${where} : nom FR obligatoire.`);
  const rarity = String(input.rarity ?? 'commun');
  if (!RARITIES.includes(rarity)) throw new EventError(400, `${where} : rareté invalide (${RARITIES.join(', ')}).`);
  const chance = Number(input.chancePct);
  if (!Number.isFinite(chance) || chance < 0.001 || chance > 100) throw new EventError(400, `${where} : chance entre 0,001 et 100 % par bloc.`);
  const minDepth = Number(input.minDepth ?? 0);
  if (!Number.isInteger(minDepth) || minDepth < 0 || minDepth > 100000) throw new EventError(400, `${where} : profondeur minimale entière de 0 à 100000.`);
  const dropFrom = Array.isArray(input.dropFrom) ? [...new Set(input.dropFrom.map(String))] : [];
  if (dropFrom.some(c => !CATEGORIES.includes(c))) throw new EventError(400, `${where} : catégories de blocs : ${CATEGORIES.join(', ')}.`);
  const refDate = String(input.refDate ?? '').trim();
  if (refDate && !REF_DATE_RE.test(refDate)) throw new EventError(400, `${where} : date de référence attendue au format MM-JJ (ex. 11-09).`);
  const image = input.image ? String(input.image) : null;
  if (image && !IMAGE_RE.test(image)) throw new EventError(400, `${where} : image attendue depuis l'atelier ou le téléversement admin.`);
  return {
    id, icon: _emoji(input.icon, '🎁'), image, brief: _str(input.brief, MAX.brief), names, descs: _texts(input.descs, MAX.desc),
    rarity, chancePct: Math.round(chance * 1000) / 1000, minDepth, dropFrom: CATEGORIES.filter(c => dropFrom.includes(c)), enabled: input.enabled !== false,
    refDate, inspiration: _str(input.inspiration, MAX.inspiration), proposal: input.proposal === true,
  };
}

/** Objectif éditorial : entier de 0 (aucun) au nombre maximal d'objets. */
function _itemTarget(v) {
  const n = Number(v ?? 0);
  if (!Number.isInteger(n) || n < 0 || n > MAX.items) throw new EventError(400, `Objectif éditorial : nombre entier de 0 (aucun) à ${MAX.items}.`);
  return n;
}

function normalizeEvent(input = {}) {
  const id = String(input.id ?? '').trim();
  if (!ID_RE.test(id)) throw new EventError(400, 'Identifiant d\'événement invalide (minuscules, chiffres, _ ; 3 à 40 caractères).');
  const names = _texts(input.names, MAX.name);
  if (!names.fr) throw new EventError(400, 'Nom FR de l\'événement obligatoire.');
  const startsAt = _date(input.startsAt, 'Début');
  const endsAt = _date(input.endsAt, 'Fin');
  const dur = Date.parse(endsAt) - Date.parse(startsAt);
  if (dur < 10 * 60_000) throw new EventError(400, 'La fin doit suivre le début d\'au moins 10 minutes.');
  if (dur > MAX.durationDays * 86_400_000) throw new EventError(400, `Durée maximale : ${MAX.durationDays} jours.`);
  const audience = input.audience === 'public' ? 'public' : 'test';
  const testers = resolveTesters(input.testers);
  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length > MAX.items) throw new EventError(400, `${MAX.items} objets au plus.`);
  const norm = items.map((it, i) => normalizeItem(it, `Objet ${i + 1}`));
  const ids = new Set();
  for (const it of norm) {
    if (ids.has(it.id)) throw new EventError(400, `Objet « ${it.id} » en double.`);
    ids.add(it.id);
  }
  return { id, icon: _emoji(input.icon, '🎉'), names, taglines: _texts(input.taglines, MAX.tagline), startsAt, endsAt, audience, testers, items: norm,
    itemTarget: _itemTarget(input.itemTarget) };
}

// ── Testeurs (recette #56-B) : identifiant de compte stable, pseudo seulement affiché ─────────────
// Forme enregistrée : [{ id, username }]. Les anciens événements ([« pseudo »]) restent lisibles :
// le pseudo est résolu à la lecture, sans réécrire la ligne (seule une action admin l'enregistre).

/** Entrées admin (ID, { id }, ou pseudo hérité) → [{ id, username }] ; compte inconnu = erreur 400. */
function resolveTesters(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new EventError(400, 'Liste de testeurs invalide.');
  const byId = conn().prepare('SELECT id, username FROM users WHERE id = ?');
  const byName = conn().prepare('SELECT id, username FROM users WHERE username = ? COLLATE NOCASE');
  const out = new Map();
  for (const x of raw) {
    const id = typeof x === 'number' ? x : (x && typeof x === 'object' ? Number(x.id) : null);
    const u = Number.isInteger(id) && id > 0 ? byId.get(id) : (typeof x === 'string' && x.trim() ? byName.get(x.trim().slice(0, 40)) : null);
    if (!u) {
      const label = typeof x === 'string' ? x.trim().slice(0, 40) : (x?.username ?? x?.id ?? x);
      throw new EventError(400, `Testeur introuvable : « ${label} ». Choisissez un compte dans la liste.`);
    }
    out.set(u.id, { id: u.id, username: u.username });
  }
  if (out.size > MAX.testers) throw new EventError(400, `${MAX.testers} testeurs au plus.`);
  return [...out.values()];
}

/** Lecture d'une ligne : pseudo courant (renommage) ; entrée héritée par pseudo résolue si le compte existe. */
function _readTesters(raw) {
  const list = J(raw, []);
  if (!Array.isArray(list) || !list.length) return [];
  const byId = conn().prepare('SELECT username FROM users WHERE id = ?');
  const byName = conn().prepare('SELECT id, username FROM users WHERE username = ? COLLATE NOCASE');
  return list.map(x => {
    if (x && typeof x === 'object') { const u = byId.get(Number(x.id)); return { id: Number(x.id), username: u?.username ?? x.username ?? `#${x.id}`, missing: !u }; }
    const u = byName.get(String(x));
    return u ? { id: u.id, username: u.username, legacy: true } : { id: null, username: String(x), legacy: true, missing: true };
  });
}

/** Comptes proposés pour un événement TEST : inscrits de la bêta (#57) et testeurs déjà utilisés. Ni e-mail ni autre donnée. */
function testerSuggestions() {
  const seen = new Map();
  const add = (id, username, why) => { if (id && !seen.has(id)) seen.set(id, { id, username, why }); };
  try {
    for (const r of conn().prepare(`SELECT u.id, u.username FROM beta_invite_uses x JOIN users u ON u.id = x.user_id ORDER BY x.id DESC LIMIT 50`).all()) add(r.id, r.username, 'bêta');
  } catch (_) { /* table bêta absente (base ancienne) */ }
  for (const r of conn().prepare("SELECT testers FROM monthly_events WHERE audience = 'test' ORDER BY updated_at DESC LIMIT 50").all()) {
    for (const t of _readTesters(r.testers)) if (!t.missing) add(t.id, t.username, 'déjà testeur');
  }
  return [...seen.values()].slice(0, 30);
}

/** Points à régler avant de planifier (bloquants) et avertissements. */
/** Objets publiés de la fiche (les propositions #56-K ne tombent pas et ne sont pas vues des joueurs). */
const published = ev => ev.items.filter(i => !i.proposal);

function readiness(evIn) {
  const ev = { ...evIn, items: published(evIn) };
  const blocking = [], warnings = [];
  if (!ev.items.length) blocking.push('Aucun objet.');
  if (!ev.items.some(i => i.enabled)) blocking.push('Aucun objet activé : rien ne tomberait.');
  for (const l of LANGS) {
    if (!ev.names[l]) blocking.push(`Nom de l'événement ${l.toUpperCase()} manquant.`);
    for (const it of ev.items) {
      if (!it.names[l]) blocking.push(`« ${it.names.fr || it.id} » : nom ${l.toUpperCase()} manquant.`);
      if (!it.descs[l]) blocking.push(`« ${it.names.fr || it.id} » : description ${l.toUpperCase()} manquante.`);
    }
  }
  if (ev.audience === 'test' && !ev.testers.length) blocking.push('Événement TEST sans testeur : personne ne le verrait.');
  for (const t of ev.testers) if (t.missing) blocking.push(`Testeur « ${t.username} » introuvable : retirez-le ou choisissez un compte existant.`);
  if (ev.audience === 'public') {
    for (const it of ev.items) if (!it.image) warnings.push(`« ${it.names.fr} » : pas d'illustration (l'icône emoji sera affichée).`);
    if (Date.parse(ev.startsAt) - Date.now() < ANNOUNCE_DAYS * 86_400_000) warnings.push(`Début dans moins de ${ANNOUNCE_DAYS} jours : annonce tardive.`);
  }
  for (const it of ev.items) if (it.enabled && it.chancePct > 5 && ev.audience === 'public') warnings.push(`« ${it.names.fr} » : ${it.chancePct} % par bloc, très élevé pour un événement public.`);
  return { ready: blocking.length === 0, blocking, warnings };
}

// ── Lecture ───────────────────────────────────────────────────────────────────

function _itemRow(r) {
  return { id: r.id, icon: r.icon, image: r.image, brief: r.brief, names: J(r.names, {}), descs: J(r.descs, {}), rarity: r.rarity,
    chancePct: r.chance_pct, minDepth: r.min_depth, dropFrom: J(r.drop_from, []), enabled: !!r.enabled,
    refDate: r.ref_date ?? '', inspiration: r.inspiration ?? '', proposal: !!r.proposal,
    publishedImage: r.published_image ?? null };
}

/** État de l'image d'un objet (#65) : sans image, conservée dans le brouillon (pas encore vue des joueurs), publiée. */
function imageState(it) {
  if ((it.image ?? null) === (it.publishedImage ?? null)) return it.image ? 'published' : 'none';
  return 'draft';
}

function stateOf(ev, nowMs = Date.now()) {
  if (ev.status !== 'scheduled') return 'draft';
  if (nowMs < Date.parse(ev.startsAt)) return 'planned';
  if (nowMs < Date.parse(ev.endsAt)) return 'active';
  return 'ended';
}

function _eventRow(r, nowMs = Date.now()) {
  if (!r) return null;
  const ev = { id: r.id, status: r.status, audience: r.audience, icon: r.icon, names: J(r.names, {}), taglines: J(r.taglines, {}),
    startsAt: r.starts_at, endsAt: r.ends_at, testers: _readTesters(r.testers), source: r.source, revision: r.revision, itemTarget: r.item_target ?? 0,
    createdAt: r.created_at, updatedAt: r.updated_at,
    items: conn().prepare(`SELECT i.*, p.image AS published_image FROM monthly_event_items i
        LEFT JOIN monthly_event_item_images p ON p.event_id = i.event_id AND p.item_id = i.id
        WHERE i.event_id = ? ORDER BY i.sort, i.id`).all(r.id).map(_itemRow) };
  ev.state = stateOf(ev, nowMs);
  return ev;
}

function getEvent(id, nowMs) { return _eventRow(conn().prepare('SELECT * FROM monthly_events WHERE id = ?').get(id), nowMs); }
function listEvents(nowMs) { return conn().prepare('SELECT * FROM monthly_events ORDER BY starts_at DESC, id').all().map(r => _eventRow(r, nowMs)); }

const _content = ev => ({ id: ev.id, icon: ev.icon, names: ev.names, taglines: ev.taglines, startsAt: ev.startsAt, endsAt: ev.endsAt,
  audience: ev.audience, testers: ev.testers.map(t => (t.id ? { id: t.id, username: t.username } : t.username)), itemTarget: ev.itemTarget ?? 0,
  items: ev.items.map(({ publishedImage, ...it }) => it) });   // image publiée : hors révision (table à part)

// ── Écriture ──────────────────────────────────────────────────────────────────

function _write(ev, { status, source, action }) {
  const c = conn();
  const prev = c.prepare('SELECT revision FROM monthly_events WHERE id = ?').get(ev.id);
  const revision = prev ? prev.revision + 1 : 1;
  c.prepare(`INSERT INTO monthly_events (id, status, audience, icon, names, taglines, starts_at, ends_at, testers, source, revision, item_target)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, audience = excluded.audience, icon = excluded.icon, names = excluded.names,
        taglines = excluded.taglines, starts_at = excluded.starts_at, ends_at = excluded.ends_at, testers = excluded.testers,
        revision = excluded.revision, item_target = excluded.item_target, updated_at = datetime('now')`)
    .run(ev.id, status, ev.audience, ev.icon, JSON.stringify(ev.names), JSON.stringify(ev.taglines), ev.startsAt, ev.endsAt,
      JSON.stringify(_content(ev).testers), source, revision, ev.itemTarget ?? 0);
  c.prepare('DELETE FROM monthly_event_items WHERE event_id = ?').run(ev.id);   // objets de la fiche (définition admin, jamais les trouvailles)
  const ins = c.prepare(`INSERT INTO monthly_event_items (event_id, id, sort, icon, image, brief, names, descs, rarity, chance_pct, min_depth, drop_from, enabled, ref_date, inspiration, proposal)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  ev.items.forEach((it, i) => ins.run(ev.id, it.id, i, it.icon, it.image, it.brief, JSON.stringify(it.names), JSON.stringify(it.descs),
    it.rarity, it.chancePct, it.minDepth, JSON.stringify(it.dropFrom), it.enabled ? 1 : 0, it.refDate ?? '', it.inspiration ?? '', it.proposal ? 1 : 0));
  c.prepare('INSERT INTO monthly_event_revisions (event_id, revision, content, action) VALUES (?,?,?,?)')
    .run(ev.id, revision, JSON.stringify({ ..._content(ev), status }), action);
  _log(ev.id, action, { revision });
  return revision;
}

function _assertItemsNotReused(ev) {
  // Un objet déjà trouvé ne peut ni disparaître ni changer d'identifiant : le souvenir doit rester affichable
  const found = conn().prepare('SELECT DISTINCT item_id FROM monthly_event_finds WHERE event_id = ?').all(ev.id).map(r => r.item_id);
  const ids = new Set(ev.items.map(i => i.id));
  const lost = found.filter(id => !ids.has(id));
  if (lost.length) throw new EventError(409, `Objets déjà trouvés par des joueurs, impossibles à retirer : ${lost.join(', ')} (désactivez-les plutôt).`);
}

function createEvent(input, { source = 'manual' } = {}) {
  const ev = normalizeEvent(input);
  return db.runTransaction(() => {
    if (conn().prepare('SELECT 1 FROM monthly_events WHERE id = ?').get(ev.id)) throw new EventError(409, `L'événement « ${ev.id} » existe déjà.`);
    _write(ev, { status: 'draft', source, action: 'create' });
    return getEvent(ev.id);
  });
}

function updateEvent(id, input) {
  const ev = normalizeEvent({ ...input, id });
  return db.runTransaction(() => {
    const cur = getEvent(id);
    if (!cur) throw new EventError(404, 'Événement introuvable.');
    if (cur.status !== 'draft') throw new EventError(409, 'Événement planifié : repassez-le en brouillon pour le modifier (les drops s\'arrêtent).');
    _assertItemsNotReused(ev);
    // #56-K : publier une proposition = action explicite (« Publier les propositions ») ; l'enregistrement du brouillon garde l'état connu
    const known = new Map(cur.items.map(i => [i.id, i.proposal]));
    ev.items = ev.items.map(it => (known.has(it.id) ? { ...it, proposal: known.get(it.id) } : it));
    _write(ev, { status: 'draft', source: cur.source, action: 'update' });
    return getEvent(id);
  });
}

/**
 * Planifie (publie) un événement : figé, visible et actif à ses dates.
 * Public : barème confirmé (`confirmRates`) et confirmation de publication (`confirmPublic`).
 */
function scheduleEvent(id, { confirmRates = false, confirmPublic = false, confirmElapsed = false, nowMs = Date.now() } = {}) {
  return db.runTransaction(() => {
    const ev = getEvent(id, nowMs);
    if (!ev) throw new EventError(404, 'Événement introuvable.');
    if (ev.status === 'scheduled') return ev;
    if (Date.parse(ev.endsAt) <= nowMs) {
      throw new EventError(409, ev.audience === 'test'
        ? 'Période expirée : utilisez « Démarrer le test maintenant » ou changez les dates.'
        : 'Date de fin passée : changez les dates.', 'expired');
    }
    if (Date.parse(ev.startsAt) < nowMs && !confirmElapsed) {
      const left = Math.round((Date.parse(ev.endsAt) - nowMs) / 60_000);
      throw new EventError(409, `La période a déjà commencé : il ne reste que ${left} min. Confirmez, ou démarrez maintenant pour une durée complète.`, 'elapsed');
    }
    const r = readiness(ev);
    if (!r.ready) throw new EventError(409, `Événement incomplet : ${r.blocking.join(' ')}`);
    if (ev.audience === 'public' && !(confirmRates && confirmPublic)) {
      throw new EventError(409, 'Événement public : cochez « barème validé » et « publication validée par le propriétaire ».');
    }
    _write(ev, { status: 'scheduled', source: ev.source, action: ev.audience === 'public' ? 'schedule_public' : 'schedule_test' });
    _publishImages(ev);   // planifier = action explicite de publication : les images de la fiche partent avec
    return getEvent(id, nowMs);
  });
}

/**
 * Recette #56-C : « Démarrer le test maintenant pour N minutes » — événement TEST en brouillon
 * uniquement ; bornes recalées sur maintenant et planification dans la même transaction (audience
 * TEST conservée, jamais élargie). Les anciennes dates restent dans la révision précédente.
 */
function startTestNow(id, { minutes = 60, nowMs = Date.now() } = {}) {
  return db.runTransaction(() => {
    const cur = getEvent(id, nowMs);
    if (!cur) throw new EventError(404, 'Événement introuvable.');
    if (cur.audience !== 'test') throw new EventError(409, 'Réservé aux événements TEST : un événement public se planifie à ses dates.');
    if (cur.status !== 'draft') throw new EventError(409, 'Événement déjà planifié : repassez-le en brouillon d\'abord.');
    const dur = Math.round(Number(minutes));
    if (!Number.isFinite(dur) || dur < 10 || dur > 7 * 24 * 60) throw new EventError(400, 'Durée : de 10 minutes à 7 jours.');
    const ev = { ...cur, startsAt: _iso(nowMs), endsAt: _iso(nowMs + dur * 60_000) };
    const r = readiness(ev);
    if (!r.ready) throw new EventError(409, `Événement incomplet : ${r.blocking.join(' ')}`);
    _write(ev, { status: 'scheduled', source: cur.source, action: 'start_test_now' });
    _log(id, 'start_test_now_dates', { minutes: dur, previous: { startsAt: cur.startsAt, endsAt: cur.endsAt } });
    _publishImages(cur);
    return getEvent(id, nowMs);
  });
}

/** Repasse en brouillon : drops arrêtés aussitôt, objets trouvés conservés. */
function unscheduleEvent(id) {
  return db.runTransaction(() => {
    const ev = getEvent(id);
    if (!ev) throw new EventError(404, 'Événement introuvable.');
    if (ev.status === 'draft') return ev;
    _write(ev, { status: 'draft', source: ev.source, action: 'unschedule' });
    return getEvent(id);
  });
}

// ── Images des objets (#65) ───────────────────────────────────────────────────

/** Copie l'image de la fiche de chaque objet vers l'image vue des joueurs (seulement celles qui diffèrent). */
function _publishImages(ev) {
  const changed = ev.items.filter(it => !it.proposal && imageState(it) === 'draft');   // proposition (#56-K) : image publiée avec elle, plus tard
  const up = conn().prepare(`INSERT INTO monthly_event_item_images (event_id, item_id, image) VALUES (?, ?, ?)
      ON CONFLICT(event_id, item_id) DO UPDATE SET image = excluded.image, published_at = datetime('now')`);
  for (const it of changed) up.run(ev.id, it.id, it.image ?? null);
  if (changed.length) _log(ev.id, 'publish_images', { items: changed.map(it => ({ id: it.id, before: it.publishedImage ?? null, after: it.image ?? null })) });
  return changed.map(it => it.id);
}

/**
 * « Publier les images » : action explicite de l'événement, quel que soit son état (un souvenir déjà
 * trouvé d'un événement TEST repassé en brouillon reçoit aussi son image). Ne change ni le statut,
 * ni les dates, ni les drops ; retour arrière = remettre l'ancienne image dans la fiche puis republier.
 */
function publishImages(id) {
  return db.runTransaction(() => {
    const ev = getEvent(id);
    if (!ev) throw new EventError(404, 'Événement introuvable.');
    const published = _publishImages(ev);
    return { event: getEvent(id), published };
  });
}

/**
 * Atelier d'icônes (#40 → #65) : « Conserver » écrit l'image dans la FICHE de l'objet (révision ajoutée),
 * jamais dans l'image publiée. Seule l'image change, aussi sur un événement planifié : elle n'a aucun effet
 * sur les drops, et les joueurs ne la voient qu'après « Publier les images ».
 */
function setItemImage(eventId, itemId, image) {
  const url = image ? String(image) : null;
  if (url && !IMAGE_RE.test(url)) throw new EventError(400, 'Image attendue depuis l\'atelier ou le téléversement admin.');
  return db.runTransaction(() => {
    const cur = getEvent(eventId);
    if (!cur) throw new EventError(404, 'Événement introuvable.');
    const it = cur.items.find(i => i.id === itemId);
    if (!it) throw new EventError(404, 'Objet introuvable dans cet événement.');
    if ((it.image ?? null) === url) return getEvent(eventId);
    const ev = { ...cur, items: cur.items.map(i => (i.id === itemId ? { ...i, image: url } : i)) };
    _write(ev, { status: cur.status, source: cur.source, action: 'image' });
    _log(eventId, 'item_image', { itemId, before: it.image ?? null, after: url });
    return getEvent(eventId);
  });
}

// ── Souvenirs proposés (recette #56-K du 08/11/2026) ──────────────────────────
// « + Ajouter un souvenir » : sur un événement en brouillon OU déjà planifié, l'objet est enregistré comme
// PROPOSITION. Il ne tombe pas, n'est pas montré aux joueurs, ne compte ni dans la vérification ni dans le
// barème affiché ; le statut, les dates et les objets publiés ne changent pas (l'événement ne repasse pas en
// brouillon). « Publier les propositions » (barème confirmé) les rend actives d'un bloc, dans une transaction
// journalisée (révision avant/après) ; « Retirer de la publication » les remet en proposition tant que
// personne ne les a trouvées.

function _proposalTarget(eventId) {
  const cur = getEvent(eventId);
  if (!cur) throw new EventError(404, 'Événement introuvable.');
  if (cur.state === 'ended') throw new EventError(409, 'Événement terminé : plus aucun souvenir à proposer.');
  return cur;
}

/** Ajoute un souvenir proposé (non publié) à un événement en brouillon ou planifié. */
function addProposal(eventId, input) {
  const it = normalizeItem({ ...input, proposal: true }, 'Souvenir proposé');
  return db.runTransaction(() => {
    const cur = _proposalTarget(eventId);
    if (cur.items.some(i => i.id === it.id)) throw new EventError(409, `Un objet utilise déjà l'identifiant « ${it.id} ».`);
    if (cur.items.length >= MAX.items) throw new EventError(409, `${MAX.items} objets au plus par événement.`);
    _write({ ...cur, items: [...cur.items, it] }, { status: cur.status, source: cur.source, action: 'proposal_add' });
    _log(eventId, 'proposal_add_item', { itemId: it.id, chancePct: it.chancePct, rarity: it.rarity });
    return getEvent(eventId);
  });
}

/** Modifie un souvenir encore PROPOSÉ (un objet publié d'un événement planifié reste figé). */
function updateProposal(eventId, itemId, input) {
  const it = normalizeItem({ ...input, id: itemId, proposal: true }, 'Souvenir proposé');
  return db.runTransaction(() => {
    const cur = _proposalTarget(eventId);
    const old = cur.items.find(i => i.id === itemId);
    if (!old) throw new EventError(404, 'Objet introuvable dans cet événement.');
    if (!old.proposal) throw new EventError(409, 'Objet déjà publié : il se modifie dans la fiche (en brouillon seulement).');
    _write({ ...cur, items: cur.items.map(i => (i.id === itemId ? { ...it, image: 'image' in (input ?? {}) ? it.image : old.image } : i)) }, { status: cur.status, source: cur.source, action: 'proposal_update' });
    return getEvent(eventId);
  });
}

/** Retire un souvenir proposé (jamais tombé : personne ne peut l'avoir trouvé). */
function removeProposal(eventId, itemId) {
  return db.runTransaction(() => {
    const cur = _proposalTarget(eventId);
    const old = cur.items.find(i => i.id === itemId);
    if (!old) throw new EventError(404, 'Objet introuvable dans cet événement.');
    if (!old.proposal) throw new EventError(409, 'Objet publié : il ne se retire pas ici.');
    if (conn().prepare('SELECT 1 FROM monthly_event_finds WHERE event_id = ? AND item_id = ?').get(eventId, itemId)) throw new EventError(409, 'Objet déjà trouvé : impossible de le retirer.');
    _write({ ...cur, items: cur.items.filter(i => i.id !== itemId) }, { status: cur.status, source: cur.source, action: 'proposal_remove' });
    return getEvent(eventId);
  });
}

/** Points à régler avant de publier une proposition (textes dans toutes les langues). */
function proposalBlocking(it) {
  const out = [];
  for (const l of LANGS) {
    if (!it.names[l]) out.push(`« ${it.names.fr || it.id} » : nom ${l.toUpperCase()} manquant.`);
    if (!it.descs[l]) out.push(`« ${it.names.fr || it.id} » : description ${l.toUpperCase()} manquante.`);
  }
  return out;
}

/**
 * Publie des propositions : elles deviennent des objets de l'événement (tirés dès que l'événement est actif).
 * Barème confirmé obligatoire ; les chances des objets déjà publiés ne changent pas.
 */
function publishProposals(eventId, { itemIds = [], confirmRates = false } = {}) {
  if (!confirmRates) throw new EventError(409, 'Cochez « barème des nouveaux souvenirs validé par le propriétaire ».');
  const ids = [...new Set((Array.isArray(itemIds) ? itemIds : []).map(String))];
  if (!ids.length) throw new EventError(400, 'Aucune proposition choisie.');
  return db.runTransaction(() => {
    const cur = _proposalTarget(eventId);
    const pick = ids.map(id => cur.items.find(i => i.id === id));
    if (pick.some(i => !i)) throw new EventError(404, 'Proposition introuvable dans cet événement.');
    if (pick.some(i => !i.proposal)) throw new EventError(409, 'Objet déjà publié dans la liste choisie.');
    const blocking = pick.flatMap(proposalBlocking);
    if (blocking.length) throw new EventError(409, `Propositions incomplètes : ${blocking.slice(0, 6).join(' ')}`);
    const before = cur.revision;
    const set = new Set(ids);
    const revision = _write({ ...cur, items: cur.items.map(i => (set.has(i.id) ? { ...i, proposal: false } : i)) },
      { status: cur.status, source: cur.source, action: 'proposals_publish' });
    _log(eventId, 'proposals_published', { items: pick.map(i => ({ id: i.id, rarity: i.rarity, chancePct: i.chancePct, minDepth: i.minDepth, dropFrom: i.dropFrom })),
      revisionBefore: before, revision, state: cur.state });
    return { event: getEvent(eventId), published: ids };
  });
}

/** Retour arrière d'une publication : remet en proposition les objets choisis, si personne ne les a trouvés. */
function unpublishProposals(eventId, { itemIds = [] } = {}) {
  const ids = [...new Set((Array.isArray(itemIds) ? itemIds : []).map(String))];
  if (!ids.length) throw new EventError(400, 'Aucun objet choisi.');
  return db.runTransaction(() => {
    const cur = _proposalTarget(eventId);
    const found = new Set(conn().prepare('SELECT DISTINCT item_id FROM monthly_event_finds WHERE event_id = ?').all(eventId).map(r => r.item_id));
    for (const id of ids) {
      const it = cur.items.find(i => i.id === id);
      if (!it) throw new EventError(404, `Objet « ${id} » introuvable.`);
      if (found.has(id)) throw new EventError(409, `« ${it.names.fr} » a déjà été trouvé : il reste publié (désactivez-le en brouillon à la place).`);
    }
    const set = new Set(ids);
    const items = cur.items.map(i => (set.has(i.id) ? { ...i, proposal: true } : i));
    if (cur.status === 'scheduled' && !items.some(i => !i.proposal && i.enabled)) throw new EventError(409, 'Un événement planifié doit garder au moins un objet publié.');
    const revision = _write({ ...cur, items }, { status: cur.status, source: cur.source, action: 'proposals_unpublish' });
    _log(eventId, 'proposals_unpublished', { items: ids, revision });
    return { event: getEvent(eventId), unpublished: ids };
  });
}

/** Objectif éditorial (nombre de souvenirs visé) : information admin, modifiable dans tous les états. */
function setItemTarget(eventId, value) {
  const n = _itemTarget(value);
  return db.runTransaction(() => {
    const cur = getEvent(eventId);
    if (!cur) throw new EventError(404, 'Événement introuvable.');
    if (cur.itemTarget === n) return cur;
    conn().prepare("UPDATE monthly_events SET item_target = ?, updated_at = datetime('now') WHERE id = ?").run(n, eventId);
    _log(eventId, 'item_target', { before: cur.itemTarget, after: n });
    return getEvent(eventId);
  });
}

/**
 * Préparation ÉDITORIALE d'un événement (distincte de l'état technique « Planifié ») : objectif, objets
 * publiés, propositions, et alertes hiérarchisées — `missing` = contenu réellement à compléter,
 * `acceptable` = admissible tel quel (emoji à la place d'une image, consigne d'illustration absente).
 */
function contentChecks(ev, lore = getLore(ev.id)) {
  const pub = published(ev), props = ev.items.filter(i => i.proposal);
  const target = ev.itemTarget || 0;
  const missing = [], acceptable = [];
  if (target && pub.length < target) {
    missing.push(`Contenu à compléter : ${pub.length} souvenir(s) publié(s) / objectif ${target}${props.length ? ` — ${props.length} proposition(s) à valider` : ''}.`);
  } else if (props.length) missing.push(`${props.length} proposition(s) de souvenir en attente de validation (non publiées).`);
  const noLore = pub.filter(i => !lore[i.id]?.verified);
  if (noLore.length) missing.push(`${noLore.length} « Pourquoi cet objet ? » sans source vérifiée (${noLore.slice(0, 3).map(i => i.names.fr || i.id).join(', ')}${noLore.length > 3 ? '…' : ''}) : rien n'est montré aux joueurs.`);
  const untranslated = pub.filter(it => !LANGS.every(l => it.names[l] && it.descs[l])).length;
  if (untranslated) missing.push(`${untranslated} objet(s) pas encore traduit(s) dans toutes les langues.`);
  const img = { published: 0, draft: 0, none: 0 };
  for (const it of pub) img[imageState(it)]++;
  if (img.draft) missing.push(`${img.draft} image(s) conservée(s) dans la fiche mais pas encore publiée(s) (« Publier les images »).`);
  if (pub.length && img.published < pub.length) {
    acceptable.push(img.published ? `${img.published}/${pub.length} objets ont une image publiée ; les ${pub.length - img.published} autres affichent leur emoji (non bloquant).`
      : `Aucune image publiée : les ${pub.length} objets affichent leur emoji (non bloquant).`);
  }
  const noBrief = pub.filter(it => !it.brief).length;
  if (noBrief) acceptable.push(`${noBrief} objet(s) sans consigne d'image pour l'atelier (non bloquant).`);
  return { target, published: pub.length, proposals: props.length, complete: !missing.length, images: img,
    label: target ? `${pub.length} préparé(s) / objectif ${target}` : `${pub.length} objet(s)`, missing, acceptable };
}

function listRevisions(id) {
  return conn().prepare('SELECT revision, action, at, content FROM monthly_event_revisions WHERE event_id = ? ORDER BY revision DESC LIMIT 50').all(id)
    .map(r => { const c = J(r.content, {}); return { revision: r.revision, action: r.action, at: r.at, status: c.status, items: (c.items || []).length, startsAt: c.startsAt, endsAt: c.endsAt }; });
}

/** Restaure le contenu d'une révision, en brouillon (jamais une planification automatique). */
function restoreRevision(id, revision) {
  return db.runTransaction(() => {
    const cur = getEvent(id);
    if (!cur) throw new EventError(404, 'Événement introuvable.');
    if (cur.status !== 'draft') throw new EventError(409, 'Repassez d\'abord l\'événement en brouillon.');
    const row = conn().prepare('SELECT content FROM monthly_event_revisions WHERE event_id = ? AND revision = ?').get(id, revision);
    if (!row) throw new EventError(404, 'Révision introuvable.');
    const ev = normalizeEvent(J(row.content, {}));
    _assertItemsNotReused(ev);
    _write(ev, { status: 'draft', source: cur.source, action: `restore_${revision}` });
    return getEvent(id);
  });
}

function listLog(limit = 100) {
  return conn().prepare('SELECT * FROM monthly_event_log ORDER BY id DESC LIMIT ?').all(limit)
    .map(r => ({ at: r.at, eventId: r.event_id, action: r.action, details: J(r.details, null) }));
}

// ── « Pourquoi cet objet ? » (#86) ────────────────────────────────────────────

// Date historique : « AAAA-MM-JJ » (événement daté) ou « MM-JJ » (journée célébrée chaque année)
const HISTORIC_DATE_RE = /^(\d{4}-)?(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** URL de source : HTTPS uniquement, sans identifiants ni espaces ; null si invalide. */
function safeSourceUrl(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (s.length > MAX.sourceUrl || /\s/.test(s)) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) return null;
    return u.href;
  } catch (_) { return null; }
}

function normalizeLore(input = {}, where = 'Explication') {
  const explains = _texts(input.explains, MAX.explain);
  const historicDate = String(input.historicDate ?? '').trim();
  if (historicDate && !HISTORIC_DATE_RE.test(historicDate)) throw new EventError(400, `${where} : date historique attendue au format AAAA-MM-JJ ou MM-JJ.`);
  const sourceUrl = safeSourceUrl(input.sourceUrl);
  if (sourceUrl === null) throw new EventError(400, `${where} : la source doit être une adresse https:// complète.`);
  const sourceTitle = _str(input.sourceTitle, MAX.sourceTitle);
  const verified = input.verified === true;
  if (verified) {
    const miss = LANGS.filter(l => !explains[l]).map(l => l.toUpperCase());
    if (miss.length) throw new EventError(400, `${where} : explication ${miss.join(', ')} manquante pour la marquer vérifiée.`);
    if (!sourceUrl || !sourceTitle || !historicDate) throw new EventError(400, `${where} : date historique, source et titre de source obligatoires pour la marquer vérifiée.`);
  }
  return { explains, historicDate, sourceUrl, sourceTitle, verified };
}

const _loreRow = r => ({ explains: J(r.explains, {}), historicDate: r.historic_date, sourceUrl: r.source_url, sourceTitle: r.source_title,
  verified: !!r.verified, updatedAt: r.updated_at });

/** Explications d'un événement : { itemId → lore } (admin). */
function getLore(eventId) {
  return Object.fromEntries(conn().prepare('SELECT * FROM monthly_event_item_lore WHERE event_id = ?').all(eventId).map(r => [r.item_id, _loreRow(r)]));
}

/** Enregistre l'explication d'un objet — possible même si l'événement est planifié (aucun effet sur les drops). */
function setItemLore(eventId, itemId, input) {
  const lore = normalizeLore(input);
  return db.runTransaction(() => {
    const ev = getEvent(eventId);
    if (!ev) throw new EventError(404, 'Événement introuvable.');
    if (!ev.items.some(i => i.id === itemId)) throw new EventError(404, 'Objet introuvable dans cet événement.');
    conn().prepare(`INSERT INTO monthly_event_item_lore (event_id, item_id, explains, historic_date, source_url, source_title, verified)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(event_id, item_id) DO UPDATE SET explains = excluded.explains, historic_date = excluded.historic_date,
          source_url = excluded.source_url, source_title = excluded.source_title, verified = excluded.verified, updated_at = datetime('now')`)
      .run(eventId, itemId, JSON.stringify(lore.explains), lore.historicDate, lore.sourceUrl, lore.sourceTitle, lore.verified ? 1 : 0);
    _log(eventId, 'lore_update', { itemId, verified: lore.verified, sourceUrl: lore.sourceUrl });
    return getLore(eventId)[itemId];
  });
}

/** Vue joueur : seulement une explication vérifiée, avec une source HTTPS valide. */
function _publicLore(l) {
  if (!l || !l.verified || !safeSourceUrl(l.sourceUrl)) return null;
  return { explains: l.explains, historicDate: l.historicDate, sourceUrl: l.sourceUrl, sourceTitle: l.sourceTitle };
}

/** Points de préparation des explications (admin) : objets sans explication vérifiée. */
function loreReadiness(ev, lore = getLore(ev.id)) {
  const pub = published(ev);
  const missing = pub.filter(i => !lore[i.id]?.verified).map(i => i.names.fr || i.id);
  return { verified: pub.length - missing.length, total: pub.length, missing };
}

/**
 * Explications préparées (`server/content/event-lore/*.json` : { eventId, items: { itemId: lore } }) :
 * ajoutées seulement pour les objets existants SANS explication — une saisie admin n'est jamais écrasée.
 */
function importLore(dir = LORE_DIR) {
  if (!fs.existsSync(dir)) return 0;
  let added = 0;
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const ev = getEvent(String(raw.eventId ?? ''));
      if (!ev) continue;
      const ids = new Set(ev.items.map(i => i.id));
      const norm = Object.entries(raw.items ?? {}).filter(([id]) => ids.has(id)).map(([id, l]) => [id, normalizeLore(l, `${f} / ${id}`)]);
      const n = db.runTransaction(() => {
        const ins = conn().prepare(`INSERT OR IGNORE INTO monthly_event_item_lore (event_id, item_id, explains, historic_date, source_url, source_title, verified)
            VALUES (?,?,?,?,?,?,?)`);
        let k = 0;
        for (const [id, l] of norm) k += ins.run(ev.id, id, JSON.stringify(l.explains), l.historicDate, l.sourceUrl, l.sourceTitle, l.verified ? 1 : 0).changes;
        if (k) _log(ev.id, 'lore_import', { file: f, added: k });
        return k;
      });
      if (n) console.log(`[events] ${n} explication(s) « Pourquoi cet objet ? » ajoutée(s) à « ${ev.id} » (${f})`);
      added += n;
    } catch (err) {
      console.error(`[events] explications de ${f} impossibles à importer :`, err.message);
    }
  }
  return added;
}

// ── Drops (serveur) ───────────────────────────────────────────────────────────

function _isTester(ev, userId) { return ev.testers.some(t => t.id === userId && !t.missing); }

/** Événements actifs visibles par ce joueur (public, ou TEST dont il est testeur). */
function activeFor(userId, nowMs = Date.now()) {
  return conn().prepare("SELECT * FROM monthly_events WHERE status = 'scheduled' AND starts_at <= ? AND ends_at > ?").all(_iso(nowMs), _iso(nowMs))
    .map(r => _eventRow(r, nowMs)).filter(ev => ev.audience === 'public' || (userId && _isTester(ev, userId)));
}

function _rand() { return crypto.randomInt(0, 2 ** 32) / 2 ** 32; }

/**
 * Après une sauvegarde acceptée ET le crédit des statistiques fiables (badges.processSave) :
 * tire les objets des événements actifs sur les blocs validés minés depuis le dernier passage.
 * Ne lève jamais vers l'appelant pour une donnée client (aucune n'est lue ici).
 * @returns {Array<{eventId, itemId, icon, image, names, eventNames}>}
 */
function processSave(userId, { nowMs = Date.now(), rand = _rand } = {}) {
  const events = activeFor(userId, nowMs);
  if (!events.length) return [];
  const blockCatalog = require('./blockCatalog');
  const badges = require('./badges');
  const souvenirs = require('./souvenirInventory');
  const catOf = new Map(blockCatalog.getPublished().types.map(t => [t.id, t.category]));
  const t = db.getDepthTracking(userId);
  const season = db.getActiveSeason();
  const depth = t && season && t.season_id === season.id ? t.accepted_depth : 0;
  return db.runTransaction(() => {
    const stats = badges.validatedStats(userId);
    const counts = {};
    for (const [k, v] of Object.entries(stats)) if (k.startsWith('blocks:')) counts[k.slice(7)] = v;
    const out = [];
    for (const ev of events) {
      const cur = conn().prepare('SELECT * FROM monthly_event_cursors WHERE user_id = ? AND event_id = ?').get(userId, ev.id);
      const ref = cur ? J(cur.ref_counts, {}) : null;
      const delta = {};
      let total = 0;
      if (ref) for (const [id, v] of Object.entries(counts)) { const d = v - (ref[id] ?? 0); if (d > 0) { delta[id] = d; total += d; } }
      conn().prepare(`INSERT INTO monthly_event_cursors (user_id, event_id, ref_counts, blocks) VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, event_id) DO UPDATE SET ref_counts = excluded.ref_counts, blocks = blocks + excluded.blocks, updated_at = datetime('now')`)
        .run(userId, ev.id, JSON.stringify(counts), total);
      if (!total || total > MAX_BLOCKS_PER_SAVE) {
        if (total > MAX_BLOCKS_PER_SAVE) _log(ev.id, 'skip_burst', { userId, blocks: total });
        continue;
      }
      const owned = new Set(conn().prepare('SELECT item_id FROM monthly_event_finds WHERE user_id = ? AND event_id = ?').all(userId, ev.id).map(r => r.item_id));
      // #93 : un type reçu par échange compte comme possédé (jamais une « première découverte » en plus).
      for (const k of souvenirs.extraTypes(userId, ev.id)) owned.add(k.slice(ev.id.length + 1));
      // #93 : doubles seulement si le drapeau global ET une règle de l'événement l'autorisent ; sinon null,
      // et le tirage est exactement celui d'avant (aucun appel à rand() de plus).
      const dup = souvenirs.dupPlanFor(ev.id);
      for (const it of ev.items) {
        if (!it.enabled || it.proposal || depth < it.minDepth) continue;
        const rule = owned.has(it.id) ? (dup && dup.left > 0 ? dup.ruleFor(it.id) : null) : undefined;
        if (rule === null) continue;
        let n = 0;
        for (const [id, d] of Object.entries(delta)) if (!it.dropFrom.length || it.dropFrom.includes(catOf.get(id))) n += d;
        if (!n) continue;
        const pAny = 1 - Math.pow(1 - (it.chancePct / 100) * (rule ? rule.factor : 1), n);
        if (rand() >= pAny) continue;
        if (rule) {
          const qty = souvenirs.mintDuplicate(userId, ev.id, it.id, rule, { nowMs, depth });
          if (qty) { dup.left -= 1; out.push({ eventId: ev.id, itemId: it.id, icon: it.icon, image: it.publishedImage, names: it.names, rarity: it.rarity, eventNames: ev.names, duplicate: true, qty }); }
          continue;
        }
        const r = conn().prepare('INSERT OR IGNORE INTO monthly_event_finds (user_id, event_id, item_id, found_at, depth) VALUES (?,?,?,?,?)')
          .run(userId, ev.id, it.id, _iso(nowMs), depth);
        if (r.changes) out.push({ eventId: ev.id, itemId: it.id, icon: it.icon, image: it.publishedImage, names: it.names, rarity: it.rarity, eventNames: ev.names });
      }
    }
    return out;
  });
}

// ── Vue joueur ────────────────────────────────────────────────────────────────

/**
 * Événements en cours (objets : trouvé ou « ? »), à venir (publics, annoncés J-7) et souvenirs
 * de TOUS les événements (y compris terminés ou repassés en brouillon).
 */
function publicView(userId = null, nowMs = Date.now()) {
  // #93 : possession = première découverte OU exemplaire reçu ; quantité affichée seulement au-delà de 1.
  const inv = userId ? require('./souvenirInventory').inventory(userId).items : {};
  const finds = Object.values(inv).sort((a, b) => (a.firstAt < b.firstAt ? -1 : 1)).map(i => ({ event_id: i.eventId, item_id: i.itemId, found_at: i.firstAt }));
  const foundAt = new Map(finds.map(f => [`${f.event_id}/${f.item_id}`, f.found_at]));
  const loreOf = new Map();
  const itemView = (ev, it) => {
    const at = foundAt.get(`${ev.id}/${it.id}`) ?? null;
    if (!at) return { id: it.id, found: false, rarity: it.rarity };
    // Image PUBLIÉE seulement (#65) : celle du brouillon n'est jamais montrée au joueur ; sinon l'emoji.
    // « Pourquoi cet objet ? » (#86) : seulement après découverte, et seulement vérifiée.
    if (!loreOf.has(ev.id)) loreOf.set(ev.id, getLore(ev.id));
    const lore = _publicLore(loreOf.get(ev.id)[it.id]);
    const q = inv[`${ev.id}/${it.id}`];
    return { id: it.id, found: true, foundAt: at, icon: it.icon, image: it.publishedImage, names: it.names, descs: it.descs, rarity: it.rarity, ...(lore ? { lore } : {}),
      ...(q && q.qty > 1 ? { qty: q.qty, tradeable: q.tradeable } : {}) };
  };
  const active = activeFor(userId, nowMs).map(ev => ({ id: ev.id, icon: ev.icon, names: ev.names, taglines: ev.taglines, startsAt: ev.startsAt,
    endsAt: ev.endsAt, test: ev.audience === 'test', items: ev.items.filter(i => (i.enabled && !i.proposal) || foundAt.has(`${ev.id}/${i.id}`)).map(i => itemView(ev, i)) }));
  const activeIds = new Set(active.map(e => e.id));
  const upcoming = conn().prepare("SELECT * FROM monthly_events WHERE status = 'scheduled' AND audience = 'public' AND starts_at > ? AND starts_at <= ? ORDER BY starts_at")
    .all(_iso(nowMs), _iso(nowMs + ANNOUNCE_DAYS * 86_400_000)).map(r => _eventRow(r, nowMs))
    .map(ev => ({ id: ev.id, icon: ev.icon, names: ev.names, taglines: ev.taglines, startsAt: ev.startsAt, endsAt: ev.endsAt, count: ev.items.filter(i => i.enabled && !i.proposal).length }));
  const souvenirs = [];
  for (const evId of [...new Set(finds.map(f => f.event_id))]) {
    if (activeIds.has(evId)) continue;
    const ev = getEvent(evId, nowMs);
    if (!ev) continue;
    souvenirs.push({ id: ev.id, icon: ev.icon, names: ev.names, endsAt: ev.endsAt,
      items: ev.items.filter(i => foundAt.has(`${ev.id}/${i.id}`)).map(i => itemView(ev, i)) });
  }
  return { active, upcoming, souvenirs };
}

// ── Simulation ────────────────────────────────────────────────────────────────

/** Part des blocs d'une catégorie à une profondeur donnée (poids du catalogue publié, atténuation comprise). */
function categoryShare(depth) {
  const types = require('./blockCatalog').getPublished().types.filter(t => (t.minDepth ?? 0) <= depth);
  const w = t => (t.fadeFrom != null && depth >= t.fadeFrom ? (t.fadeWeight ?? t.weight) : t.weight) || 0;
  const total = types.reduce((s, t) => s + w(t), 0) || 1;
  const share = Object.fromEntries(CATEGORIES.map(c => [c, 0]));
  for (const t of types) share[t.category] = (share[t.category] ?? 0) + w(t) / total;
  return share;
}

/**
 * Pour chaque objet, à une profondeur donnée : blocs nécessaires en moyenne / médiane, et chance
 * de l'obtenir pour un joueur qui mine `blocksPerDay` blocs validés pendant toute la durée.
 */
function simulate(input, { depth = 50, blocksPerDay = 300 } = {}) {
  const ev = input.items ? { ...input, items: input.items.map((it, i) => normalizeItem(it, `Objet ${i + 1}`)) } : input;
  const days = Math.max(0, (Date.parse(ev.endsAt) - Date.parse(ev.startsAt)) / 86_400_000) || 0;
  const share = categoryShare(depth);
  return {
    depth, blocksPerDay, days: Math.round(days * 10) / 10,
    items: ev.items.map(it => {
      const elig = depth < it.minDepth ? 0 : (it.dropFrom.length ? it.dropFrom.reduce((s, c) => s + (share[c] || 0), 0) : 1);
      const p = (it.chancePct / 100) * elig;
      const blocks = Math.round(blocksPerDay * days);
      return { id: it.id, name: it.names.fr, eligibleShare: Math.round(elig * 1000) / 1000, perBlock: p,
        meanBlocks: p > 0 ? Math.round(1 / p) : null, medianBlocks: p > 0 ? Math.round(Math.log(2) / -Math.log1p(-p)) : null,
        chanceOverEvent: p > 0 ? Math.round((1 - Math.pow(1 - p, blocks)) * 1000) / 10 : 0 };
    }),
  };
}

function stats(id) {
  const rows = conn().prepare('SELECT item_id, COUNT(*) AS n FROM monthly_event_finds WHERE event_id = ? GROUP BY item_id').all(id);
  const players = conn().prepare('SELECT COUNT(*) AS n FROM monthly_event_cursors WHERE event_id = ?').get(id).n;
  return { players, finds: Object.fromEntries(rows.map(r => [r.item_id, r.n])) };
}

// ── Calendrier proposé ────────────────────────────────────────────────────────

function _easter(y) {   // algorithme grégorien anonyme
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}

// Nouvel An chinois (dates publiées, aucun calcul astronomique ici)
const CHINESE_NEW_YEAR = { 2026: '02-17', 2027: '02-06', 2028: '01-26', 2029: '02-13', 2030: '02-03', 2031: '01-23', 2032: '02-11' };

const _d = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const _ymd = dt => dt.toISOString().slice(0, 10);
const _add = (dt, days) => new Date(dt.getTime() + days * 86_400_000);

/** Fêtes de l'année : { key, month, date, fr, window: [début, fin[ par défaut } */
function holidays(y) {
  const easter = _easter(y);
  const mardiGras = _add(easter, -47);
  const list = [
    { key: 'nouvel_an', fr: 'Nouvel An', date: _d(y, 1, 1), window: [_d(y, 1, 1), _d(y, 1, 15)] },
    { key: 'carnaval', fr: 'Carnaval (Mardi gras)', date: mardiGras, window: [_add(mardiGras, -12), _add(mardiGras, 2)] },
    { key: 'saint_valentin', fr: 'Saint-Valentin', date: _d(y, 2, 14), window: [_d(y, 2, 7), _d(y, 2, 16)] },
    { key: 'paques', fr: 'Pâques', date: easter, window: [_add(easter, -10), _add(easter, 2)] },
    { key: 'poisson_avril', fr: 'Poisson d\'avril', date: _d(y, 4, 1), window: [_d(y, 4, 1), _d(y, 4, 3)] },
    { key: 'fete_musique', fr: 'Fête de la musique', date: _d(y, 6, 21), window: [_d(y, 6, 14), _d(y, 6, 23)] },
    { key: 'fete_nationale', fr: 'Fête nationale belge', date: _d(y, 7, 21), window: [_d(y, 7, 14), _d(y, 7, 23)] },
    { key: 'rentree', fr: 'Rentrée', date: _d(y, 9, 1), window: [_d(y, 8, 28), _d(y, 9, 12)] },
    { key: 'halloween', fr: 'Halloween', date: _d(y, 10, 31), window: [_d(y, 10, 17), _d(y, 11, 3)] },
    { key: 'saint_nicolas', fr: 'Saint-Nicolas', date: _d(y, 12, 6), window: [_d(y, 11, 29), _d(y, 12, 8)] },
    { key: 'noel', fr: 'Noël', date: _d(y, 12, 25), window: [_d(y, 12, 1), _d(y + 1, 1, 1)] },
  ];
  if (CHINESE_NEW_YEAR[y]) {
    const cny = new Date(`${y}-${CHINESE_NEW_YEAR[y]}T00:00:00Z`);
    list.push({ key: 'nouvel_an_chinois', fr: 'Nouvel An chinois', date: cny, window: [_add(cny, -5), _add(cny, 9)] });
  }
  return list.map(h => ({ ...h, month: h.date.getUTCMonth() + 1 })).sort((a, b) => a.date - b.date);
}

// Fête retenue en priorité pour un mois qui en compte plusieurs (les autres restent des alternatives)
const PRIORITY = ['noel', 'halloween', 'paques', 'carnaval', 'nouvel_an_chinois', 'nouvel_an', 'fete_nationale', 'fete_musique', 'rentree', 'saint_valentin', 'saint_nicolas', 'poisson_avril'];
// Mois sans grande fête : idées à valider, jamais imposées
const IDEAS = {
  5: ['Fossiles et dinosaures', 'Jardin souterrain en fleurs'], 6: ['Fête de la musique souterraine'],
  8: ['Nuit des étoiles filantes (Perséides)', 'Trésor des pirates'], 9: ['Rentrée des mineurs', 'Champignons des bois'],
  11: ['Brouillard et lanternes', 'Mines englouties'],
};

// ── Mois civil et préparation du mois suivant (#56, décisions du propriétaire du 08/11/2026) ──────
// Un événement mensuel PUBLIC = un mois civil entier, heure de Bruxelles : début INCLUS le 1er à 00:01,
// fin EXCLUE le 1er du mois suivant à 00:00 (la minute 23:59 du dernier jour est couverte ; une minute
// sans événement entre deux mois, jamais de chevauchement). Aucune tâche planifiée : un événement planifié
// est actif dès que l'heure du serveur est dans ses bornes (activeFor), donc un redémarrage, une absence
// du serveur ou un changement d'heure ne déclenchent rien deux fois et n'en ratent aucun. Rien n'est
// jamais inventé ni prolongé : un mois sans événement planifié reste sans événement.

const DAY_MS = 86_400_000;
const REMIND_DAYS = [14, 7, 1];      // rappels de préparation : J-14, J-7, J-1 avant le début du mois
const _pad = n => String(n).padStart(2, '0');

/** Bornes d'un mois civil : { startsLocal 'AAAA-MM-01T00:01', endsLocal '1er du mois suivant T00:00', en UTC, début civil 00:00 }. */
function monthBounds(year, month) {
  const ny = month === 12 ? year + 1 : year, nm = month === 12 ? 1 : month + 1;
  const startsLocal = `${year}-${_pad(month)}-01T00:01`, endsLocal = `${ny}-${_pad(nm)}-01T00:00`;
  return { year, month, startsLocal, endsLocal, startsAt: brusselsToUtc(startsLocal), endsAt: brusselsToUtc(endsLocal),
    monthStartAt: brusselsToUtc(`${year}-${_pad(month)}-01T00:00`), days: new Date(Date.UTC(year, month, 0)).getUTCDate() };
}

/** Mois civil (Bruxelles) d'un instant. */
function monthOf(ms) { const l = utcToBrussels(_iso(ms)); return { year: +l.slice(0, 4), month: +l.slice(5, 7) }; }
function shiftMonth({ year, month }, delta) { const i = year * 12 + (month - 1) + delta; return { year: Math.floor(i / 12), month: (i % 12) + 1 }; }

/** Vrai si l'événement couvre exactement le mois civil de son début (règle du 08/11). */
function isFullMonth(ev) {
  const { year, month } = monthOf(Date.parse(ev.startsAt) + 60_000);
  const b = monthBounds(year, month);
  return ev.startsAt === b.startsAt && ev.endsAt === b.endsAt;
}

const MONTH_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTH_STATES = { absent: 'Absent', incomplete: 'À compléter', unscheduled: 'Brouillon non planifié', planned: 'Planifié', active: 'Actif', ended: 'Terminé' };

/** « du 1er décembre 2026 à 00 h 01 au 31 décembre 2026 à 23 h 59, heure de Bruxelles » (aucun « minuit » ambigu). */
function frRange(startsAt, endsAt) {
  const f = ms => { const l = utcToBrussels(_iso(ms)); const d = +l.slice(8, 10);
    return `${d === 1 ? '1er' : d} ${MONTH_FR[+l.slice(5, 7) - 1]} ${l.slice(0, 4)} à ${l.slice(11, 13)} h ${l.slice(14, 16)}`; };
  return `du ${f(Date.parse(startsAt))} au ${f(Date.parse(endsAt) - 60_000)}, heure de Bruxelles`;
}

/**
 * État d'un mois pour l'admin : événement public qui le couvre (planifié d'abord), état explicite,
 * tâches bloquantes, avertissements non bloquants, compteurs (objets, images, traductions) et rappel J-14/J-7/J-1.
 * Lecture seule : `nowMs` peut simuler une autre heure sans rien modifier.
 */
function monthStatus(year, month, nowMs = Date.now(), events = listEvents(nowMs)) {
  const b = monthBounds(year, month);
  const label = `${MONTH_FR[month - 1]} ${year}`;
  const mStart = Date.parse(b.monthStartAt), mEnd = Date.parse(b.endsAt);
  const covering = events.filter(e => e.audience === 'public' && Date.parse(e.startsAt) < mEnd && Date.parse(e.endsAt) > mStart)
    .map(e => ({ ...e, state: stateOf(e, nowMs) }))
    .sort((x, y) => (y.status === 'scheduled') - (x.status === 'scheduled') || Date.parse(x.startsAt) - Date.parse(y.startsAt));
  const ev = covering[0] ?? null;
  const blocking = [], warnings = [];
  let state = 'absent', counts = null, content = null;
  const acceptable = [];
  const past = mEnd <= nowMs;
  if (!ev) {
    (past ? warnings : blocking).push(past ? `Aucun événement public en ${label}.`
      : `Aucun événement prévu pour ${label} : le jeu reste jouable sans événement mensuel. Rien ne sera inventé ni prolongé.`);
  } else {
    const r = readiness(ev);
    state = ev.status === 'scheduled' ? ev.state : (r.ready ? 'unscheduled' : 'incomplete');
    if (ev.status !== 'scheduled') {
      if (!ev.items.length) blocking.push('0 objet : ajoutez les objets.');
      blocking.push(...r.blocking.filter(x => x !== 'Aucun objet.'));
      if (r.ready) blocking.push('Brouillon complet mais NON planifié : il ne démarrera pas tout seul. « Vérifier / Planifier ».');
    }
    // #56-K : objets PUBLIÉS seulement (les propositions sont comptées à part) ; alertes hiérarchisées
    const pub = published(ev);
    content = contentChecks(ev);
    const translated = pub.filter(it => LANGS.every(l => it.names[l] && it.descs[l])).length;
    counts = { items: pub.length, enabled: pub.filter(i => i.enabled).length, images: content.images, translated, proposals: content.proposals, target: content.target };
    warnings.push(...content.missing);
    acceptable.push(...content.acceptable);
    if (!isFullMonth(ev)) warnings.push(`Dates ${frRange(ev.startsAt, ev.endsAt)} : un événement mensuel couvre le mois entier, ${frRange(b.startsAt, b.endsAt)}.`);
    if (covering.filter(e => e.status === 'scheduled').length > 1) warnings.push('Plusieurs événements publics planifiés se chevauchent sur ce mois.');
    const started = Date.parse(b.startsAt) <= nowMs;
    for (const w of r.warnings) if (!/pas d'illustration/.test(w) && !(started && /annonce tardive/.test(w)) && !warnings.includes(w)) warnings.push(w);
  }
  if (past) blocking.length = 0;   // mois terminé : plus aucune tâche à faire
  const missing = past ? [] : [...warnings];   // mois terminé : information, plus rien « à compléter »
  if (past) acceptable.unshift(...warnings.splice(0));
  warnings.push(...acceptable);   // compatibilité : `warnings` = manquants puis admissibles
  const daysLeft = Math.ceil((Date.parse(b.startsAt) - nowMs) / DAY_MS);
  const settled = ['planned', 'active', 'ended'].includes(state);
  const reminder = settled || daysLeft <= 0 ? null : (REMIND_DAYS.slice().reverse().find(d => daysLeft <= d) ?? null);
  return {
    year, month, label, state, stateLabel: MONTH_STATES[state], period: frRange(b.startsAt, b.endsAt),
    startsAt: b.startsAt, endsAt: b.endsAt, startsLocal: b.startsLocal, endsLocal: b.endsLocal, days: b.days, daysLeft,
    reminder: reminder ? `J-${reminder}` : null,
    event: ev ? { id: ev.id, icon: ev.icon, name: ev.names.fr, status: ev.status, state: ev.state, revision: ev.revision,
      startsAt: ev.startsAt, endsAt: ev.endsAt, startsLocal: utcToBrussels(ev.startsAt), endsLocal: utcToBrussels(ev.endsAt), fullMonth: isFullMonth(ev),
      period: frRange(ev.startsAt, ev.endsAt) } : null,
    others: covering.slice(1).map(e => ({ id: e.id, icon: e.icon, name: e.names.fr, state: e.state })),
    counts, blocking, warnings, missing, acceptable,
    content: content ? { target: content.target, published: content.published, proposals: content.proposals, complete: content.complete, label: content.label } : null,
  };
}

/** Événements publics actifs à un instant (lecture seule) — sert à l'aperçu d'un changement de mois. */
function publicActiveAt(ms) {
  return conn().prepare("SELECT id FROM monthly_events WHERE status = 'scheduled' AND audience = 'public' AND starts_at <= ? AND ends_at > ? ORDER BY starts_at")
    .all(_iso(ms), _iso(ms)).map(r => r.id);
}

/**
 * Aperçu du passage au mois `year`/`month` (simulation d'horloge, aucune écriture) : événements publics
 * actifs la veille à 23:59:00 et 23:59:59, à 00:00:00, 00:00:30, puis 00:01:00 et 00:01:30.
 */
function transitionPreview(year, month) {
  const b = monthBounds(year, month);
  const m0 = Date.parse(b.monthStartAt);
  return [-60_000, -1000, 0, 30_000, 60_000, 90_000].map(d => ({ at: _iso(m0 + d), local: utcToBrussels(_iso(m0 + d)) + (d % 60_000 ? `:${_pad(((d % 60_000) + 60_000) % 60_000 / 1000)}` : ':00'),
    active: publicActiveAt(m0 + d) }));
}

/** Tableau de bord « Préparation du mois prochain » : mois précédent / en cours / suivant + rappel. */
function preparation(nowMs = Date.now()) {
  const events = listEvents(nowMs);
  const cur = monthOf(nowMs);
  const [previous, current, next, following] = [-1, 0, 1, 2].map(d => { const m = shiftMonth(cur, d); return monthStatus(m.year, m.month, nowMs, events); });
  let level = 'ok';
  if (!['planned', 'active'].includes(next.state)) level = next.reminder === 'J-1' ? 'urgent' : next.reminder ? 'warn' : 'info';
  const todo = next.content && !next.content.complete ? ` Contenu à compléter : ${next.content.label}${next.content.proposals ? `, ${next.content.proposals} proposition(s) à valider` : ''}.` : '';
  const headline = ['planned', 'active'].includes(next.state)
    ? `${next.label} : ${next.event.icon} ${next.event.name} planifié, actif automatiquement ${next.event.period}.${todo}`
    : next.state === 'absent' ? `Aucun événement prévu pour ${next.label} (dans ${next.daysLeft} j) : le jeu reste jouable sans événement mensuel.`
      : `${next.label} : ${next.event.icon} ${next.event.name} — ${next.stateLabel.toLowerCase()}, il ne démarrera pas tout seul (dans ${next.daysLeft} j).`;
  return { now: _iso(nowMs), nowLocal: utcToBrussels(_iso(nowMs)), timezone: TZ, remindDays: REMIND_DAYS, previous, current, next, level, headline,
    transition: transitionPreview(next.year, next.month),
    // « Tester le passage au mois suivant » (#56-K) : le mois d'après, pour montrer qu'il n'est rien inventé
    following: { year: following.year, month: following.month, label: following.label, state: following.state, stateLabel: following.stateLabel,
      event: following.event ? { id: following.event.id, icon: following.event.icon, name: following.event.name, state: following.event.state } : null } };
}

/**
 * Calendrier de l'année : un mois civil entier par mois (00:01 → 1er suivant 00:00), la fête du mois
 * comme INSPIRATION du thème (jamais une durée raccourcie), l'état de préparation du mois, l'échéance
 * de préparation (J-14) et l'annonce « Bientôt » (J-7).
 */
function proposeCalendar(year, nowMs = Date.now()) {
  const hs = holidays(year);
  const events = listEvents(nowMs);
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const inMonth = hs.filter(h => h.month === m).sort((a, b) => PRIORITY.indexOf(a.key) - PRIORITY.indexOf(b.key));
    const main = inMonth[0] ?? null;
    const b = monthBounds(year, m);
    const st = monthStatus(year, m, nowMs, events);
    const monthStart = Date.parse(b.monthStartAt), monthEnd = Date.parse(b.endsAt);
    const covering = events.filter(e => Date.parse(e.startsAt) < monthEnd && Date.parse(e.endsAt) > monthStart)
      .map(e => ({ id: e.id, icon: e.icon, name: e.names.fr, state: e.state, audience: e.audience, fullMonth: isFullMonth(e) }));
    const startMs = Date.parse(b.startsAt);
    months.push({
      month: m, year, days: b.days,
      holiday: main ? { key: main.key, name: main.fr, date: _ymd(main.date) } : null,
      alternatives: inMonth.slice(1).map(h => ({ key: h.key, name: h.fr, date: _ymd(h.date) })),
      ideas: main ? [] : (IDEAS[m] ?? ['Thème original à choisir']),
      suggested: { startsAt: b.startsLocal, endsAt: b.endsLocal },
      period: st.period,
      prepareBy: _ymd(new Date(startMs - REMIND_DAYS[0] * DAY_MS + _tzOffsetMs(startMs))),
      announceAt: _ymd(new Date(startMs - ANNOUNCE_DAYS * DAY_MS + _tzOffsetMs(startMs))),
      late: nowMs > startMs - REMIND_DAYS[0] * DAY_MS && !['planned', 'active', 'ended'].includes(st.state) && nowMs < monthEnd,
      state: st.state, stateLabel: st.stateLabel, counts: st.counts, blocking: st.blocking.length, warnings: st.warnings.length, missing: st.missing.length, content: st.content,
      main: st.event,
      events: covering,
    });
  }
  return { year, timezone: TZ, prepDays: REMIND_DAYS[0], announceDays: ANNOUNCE_DAYS, months };
}

// ── Décisions écrites du propriétaire, appliquées une seule fois au démarrage ────────────────────
// Le propriétaire n'a pas accès au panel (08/11/2026) et a autorisé par écrit la planification de
// novembre et de Noël 2026 « via le workflow légitime ». Chaque décision passe par les mêmes contrôles
// que le bouton « Planifier » (fiche complète, période non terminée) et n'est appliquée que si la fiche
// est encore EXACTEMENT celle relue (brouillon, même révision) ; sinon elle est ignorée et journalisée.
// Jamais rejouée (clé dans monthly_event_meta) : un « Repasser en brouillon » du propriétaire reste acquis.
// Les images de la fiche ne sont PAS publiées par ces décisions (emoji affichés ; « Publier les images » reste un clic admin).
const OWNER_DECISIONS = [
  // #56 issuecomment-6722406304 et #86 issuecomment-6722405932 (08/11/2026) : novembre 01/11 00:01 → 01/12 00:00,
  // barème validé #86 issuecomment-6720004334 (0,25 / 0,15 / 0,08 / 0,05 dès 10 m / 0,03 % dès 20 m), aucun drop rétroactif.
  { id: 'issue56-novembre-histoire-2026-planifie', eventId: 'novembre_histoire_2026', revision: 3, year: 2026, month: 11 },
  // #56 issuecomment-6722406304 : Noël « sous la mine » planifié pour le 01/12 00:01 → 01/01 00:00, barème de la fiche inchangé.
  { id: 'issue56-noel-2026-planifie', eventId: 'noel_2026', revision: 1, year: 2026, month: 12 },
];

function applyOwnerDecisions(list = OWNER_DECISIONS, nowMs = Date.now()) {
  const out = [];
  for (const d of list) {
    const key = `decision:${d.id}`;
    if (conn().prepare('SELECT 1 FROM monthly_event_meta WHERE key = ?').get(key)) continue;
    const res = db.runTransaction(() => {
      if (conn().prepare('SELECT 1 FROM monthly_event_meta WHERE key = ?').get(key)) return null;
      const cur = getEvent(d.eventId, nowMs);
      const b = monthBounds(d.year, d.month);
      let outcome = 'applied', reason = '';
      if (!cur) { outcome = 'skipped'; reason = 'événement absent'; }
      else if (cur.status !== 'draft' || cur.revision !== d.revision) { outcome = 'skipped'; reason = `fiche modifiée depuis la décision (${cur.status}, rév. ${cur.revision}, attendue brouillon rév. ${d.revision})`; }
      else if (cur.audience !== 'public') { outcome = 'skipped'; reason = 'événement non public'; }
      else if (Date.parse(b.endsAt) <= nowMs) { outcome = 'skipped'; reason = 'mois déjà terminé'; }
      else {
        const ev = { ...cur, startsAt: b.startsAt, endsAt: b.endsAt };
        const r = readiness(ev);
        if (!r.ready) { outcome = 'skipped'; reason = `fiche incomplète : ${r.blocking.slice(0, 3).join(' ')}`; }
        else {
          if (cur.startsAt !== b.startsAt || cur.endsAt !== b.endsAt) {
            _write(ev, { status: 'draft', source: cur.source, action: 'owner_decision_dates' });
            _log(d.eventId, 'owner_decision_dates', { decision: d.id, previous: { startsAt: cur.startsAt, endsAt: cur.endsAt }, startsAt: b.startsAt, endsAt: b.endsAt });
          }
          _write(ev, { status: 'scheduled', source: cur.source, action: 'schedule_public_owner_decision' });
        }
      }
      const rec = { decision: d.id, eventId: d.eventId, outcome, reason, at: _iso(nowMs) };
      conn().prepare('INSERT INTO monthly_event_meta (key, value) VALUES (?, ?)').run(key, JSON.stringify(rec));
      _log(d.eventId, `owner_decision_${outcome}`, rec);
      return rec;
    });
    if (res) {
      out.push(res);
      console.log(`[events] Décision ${d.id} : ${res.outcome === 'applied' ? `« ${d.eventId} » planifié ${frRange(monthBounds(d.year, d.month).startsAt, monthBounds(d.year, d.month).endsAt)}` : `ignorée (${res.reason})`}`);
    }
  }
  return out;
}

// ── Événement TEST (gabarit) ──────────────────────────────────────────────────

/**
 * Gabarit d'un événement TEST non public : 3 objets à probabilités FORTES (test uniquement),
 * réservé aux comptes donnés, de `minutes` minutes à partir de maintenant. Créé en brouillon.
 */
function createTestEvent({ testers = [], minutes = 120, nowMs = Date.now() } = {}) {
  const stamp = new Date(nowMs).toISOString().replace(/\D/g, '').slice(2, 12);
  const dur = Math.min(Math.max(Number(minutes) || 120, 10), 7 * 24 * 60);
  const tx = (fr, en, nl, es) => ({ fr, en, nl, es });
  return createEvent({
    id: `test_${stamp}`, icon: '🧪', audience: 'test', testers,
    names: tx('Événement test', 'Test event', 'Testevenement', 'Evento de prueba'),
    taglines: tx('Réservé aux testeurs : probabilités augmentées.', 'Testers only: boosted odds.', 'Alleen voor testers: verhoogde kansen.', 'Solo para testers: probabilidades aumentadas.'),
    startsAt: _iso(nowMs), endsAt: _iso(nowMs + dur * 60_000),
    items: [
      { id: 'test_caillou', icon: '🪨', rarity: 'commun', chancePct: 25, minDepth: 0, dropFrom: [],
        names: tx('Caillou de test', 'Test pebble', 'Testkiezel', 'Guijarro de prueba'),
        descs: tx('Il ne sert à rien, et c\'est justement ce qu\'on teste.', 'It does nothing, which is exactly what we are testing.', 'Het doet niets, en dat is precies wat we testen.', 'No sirve para nada, y eso es justo lo que probamos.') },
      { id: 'test_boulon', icon: '🔩', rarity: 'rare', chancePct: 10, minDepth: 0, dropFrom: ['pierre', 'minerai'],
        names: tx('Boulon de test', 'Test bolt', 'Testbout', 'Tornillo de prueba'),
        descs: tx('Tombe seulement de la pierre ou du minerai.', 'Only drops from stone or ore.', 'Valt alleen uit steen of erts.', 'Solo cae de piedra o mineral.') },
      { id: 'test_ticket', icon: '🎟️', rarity: 'epique', chancePct: 40, minDepth: 0, dropFrom: ['coffre'],
        names: tx('Ticket de test', 'Test ticket', 'Testticket', 'Billete de prueba'),
        descs: tx('Tombe seulement d\'un coffre.', 'Only drops from a chest.', 'Valt alleen uit een kist.', 'Solo cae de un cofre.') },
    ],
  }, { source: 'test' });
}

// ── Contenu préparé (une seule fois, en brouillon) ────────────────────────────

function importPrepared(dir = CONTENT_DIR) {
  if (!fs.existsSync(dir)) return [];
  const done = [];
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
    const key = `prepared:${f}`;
    if (conn().prepare('SELECT 1 FROM monthly_event_meta WHERE key = ?').get(key)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      db.runTransaction(() => {
        if (!conn().prepare('SELECT 1 FROM monthly_events WHERE id = ?').get(raw.id)) createEvent(raw, { source: 'prepared' });
        conn().prepare('INSERT INTO monthly_event_meta (key, value) VALUES (?, ?)').run(key, new Date().toISOString());
      });
      done.push(raw.id);
      console.log(`[events] événement préparé « ${raw.id} » ajouté en brouillon (${f})`);
    } catch (err) {
      console.error(`[events] import de ${f} impossible :`, err.message);
    }
  }
  return done;
}

/**
 * Souvenirs proposés préparés (`server/content/event-proposals/*.json` : { eventId, itemTarget, items }) —
 * recette #56-K. Une seule fois par fichier : ajoute en PROPOSITION (jamais publiée, jamais tirée) les objets
 * dont l'identifiant n'existe pas encore, sans toucher au statut, aux dates ni aux objets existants ;
 * l'objectif éditorial n'est posé que s'il n'y en a pas déjà un.
 */
function importProposals(dir = PROPOSALS_DIR) {
  if (!fs.existsSync(dir)) return [];
  const done = [];
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
    const key = `proposals:${f}`;
    if (conn().prepare('SELECT 1 FROM monthly_event_meta WHERE key = ?').get(key)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const items = (raw.items ?? []).map((it, i) => normalizeItem({ ...it, proposal: true }, `${f} / objet ${i + 1}`));
      const target = _itemTarget(raw.itemTarget);
      const res = db.runTransaction(() => {
        if (conn().prepare('SELECT 1 FROM monthly_event_meta WHERE key = ?').get(key)) return null;
        const cur = getEvent(String(raw.eventId ?? ''));
        let rec;
        if (!cur) rec = { outcome: 'skipped', reason: 'événement absent' };
        else if (cur.state === 'ended') rec = { outcome: 'skipped', reason: 'événement terminé' };
        else {
          const have = new Set(cur.items.map(i => i.id));
          const add = items.filter(i => !have.has(i.id)).slice(0, Math.max(0, MAX.items - cur.items.length));
          const next = { ...cur, itemTarget: cur.itemTarget || target, items: [...cur.items, ...add] };
          if (add.length || next.itemTarget !== cur.itemTarget) _write(next, { status: cur.status, source: cur.source, action: 'proposal_import' });
          rec = { outcome: 'applied', added: add.length, itemTarget: next.itemTarget, status: cur.status };
        }
        conn().prepare('INSERT INTO monthly_event_meta (key, value) VALUES (?, ?)').run(key, JSON.stringify({ ...rec, at: new Date().toISOString() }));
        _log(raw.eventId ?? null, `proposal_import_${rec.outcome}`, { file: f, ...rec });
        return rec;
      });
      if (res) {
        done.push({ file: f, eventId: raw.eventId, ...res });
        console.log(`[events] ${f} : ${res.outcome === 'applied' ? `${res.added} souvenir(s) PROPOSÉ(S) ajouté(s) à « ${raw.eventId} » (non publiés, aucun drop)` : `ignoré (${res.reason})`}`);
      }
    } catch (err) {
      console.error(`[events] propositions de ${f} impossibles à importer :`, err.message);
    }
  }
  return done;
}

// ── IA : proposition de thème, objets et traductions ─────────────────────────

const _jobs = new Map();
const INTERRUPTED = 'Génération interrompue (redémarrage du serveur) : relancez-la.';

function _aiSchema() {
  const str = { type: 'string' };
  const texts = { type: 'object', additionalProperties: false, required: LANGS, properties: Object.fromEntries(LANGS.map(l => [l, str])) };
  return {
    type: 'object', additionalProperties: false, required: ['id', 'icon', 'names', 'taglines', 'items', 'review'],
    properties: {
      id: str, icon: str, names: texts, taglines: texts, review: str,
      items: { type: 'array', items: { type: 'object', additionalProperties: false,
        required: ['id', 'icon', 'names', 'descs', 'rarity', 'brief', 'dropFrom'],
        properties: { id: str, icon: str, names: texts, descs: texts, brief: str, rarity: { type: 'string', enum: RARITIES },
          dropFrom: { type: 'array', items: { type: 'string', enum: CATEGORIES } } } } },
    },
  };
}

function _aiMessages(concept, count) {
  const langs = LANGS.map(l => `${l} (${LANG_LABELS[l]})`).join(', ');
  const system = [
    'You design a limited-time monthly EVENT for DIG!, an idle clicker mining game for all ages: players dig blocks (dirt, stone, ore, chests, gems) and may unearth exclusive collectible souvenirs.',
    `Create ${count} collectible items fitting the theme given by the admin. Items are absurd but recognisable, rooted in the folklore, traditions, songs or pop culture of the theme; each item has its OWN joke and a different silhouette.`,
    'Real facts only if true; any invented anecdote is told as a legend ("it is said that…"). Protected works are only evoked, never named or copied; no brands, no living people.',
    `Write every text natively and idiomatically in ${langs}. names: max 40 chars. descs: 1-2 funny sentences, max 260 chars. taglines: one sentence announcing the event, max 160 chars.`,
    'brief: concrete English image prompt for ONE game icon of the item (shape, material, colours, one funny detail), no text in the image.',
    'rarity: spread from commun to legendaire (one rarest item). dropFrom: block categories where it is buried (empty = any).',
    'id: lowercase snake_case, 3-40 chars, starting with a letter; item ids prefixed by the event id. icon: exactly one emoji.',
    'review: one short French paragraph reviewing variety, humour and any sensitive reference.',
  ];
  return [{ role: 'system', content: system.join('\n') }, { role: 'user', content: `Theme / brief from the admin:\n${concept}` }];
}

function _aiFake(concept) {
  const tx = s => ({ fr: s, en: s, nl: s, es: s });
  return { id: 'ia_test', icon: '🎉', names: tx(`Test IA : ${concept.slice(0, 30)}`), taglines: tx('Proposition de test.'), review: 'Proposition de test : aucune IA appelée.',
    items: [1, 2, 3].map(i => ({ id: `ia_test_obj${i}`, icon: '🎁', names: tx(`Objet ${i}`), descs: tx(`Description ${i}.`), brief: `test item ${i}`, rarity: RARITIES[i], dropFrom: [] })) };
}

/** Rend un identifiant libre : base, base_2, base_3… */
function _freeId(base) {
  let id = ID_RE.test(base) ? base : 'evenement_ia';
  for (let n = 2; conn().prepare('SELECT 1 FROM monthly_events WHERE id = ?').get(id); n++) id = `${base.slice(0, 36)}_${n}`;
  return id;
}

const DEFAULT_CHANCE = { commun: 1, 'peu-commun': 0.6, rare: 0.3, epique: 0.15, legendaire: 0.05 };

/**
 * Lance une proposition IA (arrière-plan). Résultat : un événement TEST en brouillon, dates
 * proposées (`startsAt`/`endsAt`, heure de Bruxelles), barème par défaut selon la rareté.
 */
function startAiDraft({ concept, startsAt, endsAt, itemCount = 4 } = {}) {
  const text = _str(concept, MAX.concept);
  if (text.length < 5) throw new EventError(400, 'Décrivez le thème (5 à 600 caractères).');
  const s = _date(startsAt, 'Début'), e = _date(endsAt, 'Fin');
  const count = Math.min(Math.max(Number(itemCount) || 4, 2), 8);
  const blockAi = require('./blockAi');
  try { blockAi.precheckText(); } catch (err) { throw new EventError(err.status ?? 503, err.message); }
  const id = conn().prepare('INSERT INTO monthly_event_ai (concept) VALUES (?)').run(text).lastInsertRowid;
  const job = (async () => {
    try {
      const out = await blockAi.guardedJson({ kind: 'event-text', source: 'admin-events', name: 'dig_event', schema: _aiSchema(),
        messages: _aiMessages(text, count), fake: () => _aiFake(text) });
      const r = out.data ?? {};
      const evId = _freeId(String(r.id ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]+/, '').slice(0, 30));
      const seen = new Set();
      const items = (Array.isArray(r.items) ? r.items : []).slice(0, count).map((it, i) => {
        let iid = String(it.id ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]+/, '').slice(0, 40);
        if (!ID_RE.test(iid) || seen.has(iid)) iid = `${evId.slice(0, 30)}_obj${i + 1}`;
        seen.add(iid);
        const rarity = RARITIES.includes(it.rarity) ? it.rarity : 'commun';
        return { id: iid, icon: it.icon, names: it.names, descs: it.descs, brief: it.brief, rarity, chancePct: DEFAULT_CHANCE[rarity],
          minDepth: 0, dropFrom: Array.isArray(it.dropFrom) ? it.dropFrom.filter(c => CATEGORIES.includes(c)) : [], enabled: true };
      });
      const ev = createEvent({ id: evId, icon: r.icon, names: r.names, taglines: r.taglines, startsAt: s, endsAt: e, audience: 'test', testers: [], items }, { source: 'ai' });
      _log(ev.id, 'ai_review', { review: _str(r.review, 600) });
      conn().prepare("UPDATE monthly_event_ai SET status = 'done', event_id = ?, updated_at = datetime('now') WHERE id = ?").run(ev.id, id);
    } catch (err) {
      conn().prepare("UPDATE monthly_event_ai SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?").run(String(err.message || err).slice(0, 400), id);
      throw err;
    } finally {
      _jobs.delete(id);
    }
  })();
  _jobs.set(id, job);
  job.catch(() => { /* état « error » enregistré */ });
  return { job: getAiJob(id), promise: job };
}

function getAiJob(id) {
  const r = conn().prepare('SELECT * FROM monthly_event_ai WHERE id = ?').get(id);
  if (!r) return null;
  const interrupted = r.status === 'pending' && !_jobs.has(r.id);
  return { id: r.id, concept: r.concept, status: interrupted ? 'error' : r.status, error: interrupted ? INTERRUPTED : r.error, eventId: r.event_id, createdAt: r.created_at };
}

function listAiJobs(limit = 5) {
  return conn().prepare('SELECT id FROM monthly_event_ai ORDER BY id DESC LIMIT ?').all(limit).map(r => getAiJob(r.id));
}

// ── Admin : vue d'ensemble ────────────────────────────────────────────────────

/** Clé stable de l'objet dans l'atelier d'icônes (#65). */
const studioKey = (eventId, itemId) => `event:${eventId}/${itemId}`;

/** Nombre d'images de l'atelier par cible `event:…` (0 si l'atelier n'est pas initialisé). */
function _studioProposals() {
  try {
    return Object.fromEntries(conn().prepare("SELECT target, COUNT(*) n FROM icon_studio_assets WHERE target LIKE 'event:%' GROUP BY target").all().map(r => [r.target, r.n]));
  } catch (err) { if (/no such table/.test(err.message)) return {}; throw err; }
}

function adminView(nowMs = Date.now()) {
  const proposals = _studioProposals();
  const events = listEvents(nowMs).map(ev => { const lore = getLore(ev.id); return { ...ev, startsLocal: utcToBrussels(ev.startsAt), endsLocal: utcToBrussels(ev.endsAt),
    readiness: readiness(ev), stats: stats(ev.id), lore, loreReadiness: loreReadiness(ev, lore), content: contentChecks(ev, lore),
    items: ev.items.map(it => {
      const key = studioKey(ev.id, it.id), state = imageState(it), n = proposals[key] ?? 0;
      // « proposition » : l'atelier a des images pour cet objet, aucune n'est encore dans la fiche
      return { ...it, studioKey: key, proposals: n, imageState: state === 'none' && n ? 'proposal' : state };
    }) }; });
  const y = monthOf(nowMs).year;
  return { timezone: TZ, now: _iso(nowMs), rarities: RARITIES, categories: CATEGORIES, langs: LANGS, events, testerSuggestions: testerSuggestions(),
    calendar: [proposeCalendar(y, nowMs), proposeCalendar(y + 1, nowMs)], preparation: preparation(nowMs), ai: listAiJobs(), log: listLog(60) };
}

module.exports = {
  EventError, LANGS, RARITIES, CATEGORIES, init, brusselsToUtc, utcToBrussels, normalizeEvent, readiness, stateOf,
  getEvent, listEvents, createEvent, updateEvent, scheduleEvent, startTestNow, unscheduleEvent, resolveTesters, testerSuggestions, listRevisions, restoreRevision, listLog,
  activeFor, processSave, publicView, categoryShare, simulate, stats, holidays, proposeCalendar, createTestEvent, importPrepared,
  startAiDraft, getAiJob, listAiJobs, adminView, MAX_BLOCKS_PER_SAVE,
  imageState, publishImages, setItemImage, studioKey, ID_RE,
  normalizeLore, safeSourceUrl, getLore, setItemLore, loreReadiness, importLore,
  addProposal, updateProposal, removeProposal, publishProposals, unpublishProposals, proposalBlocking, setItemTarget, contentChecks, importProposals,
  monthBounds, monthOf, isFullMonth, frRange, monthStatus, preparation, transitionPreview, publicActiveAt, applyOwnerDecisions, OWNER_DECISIONS,
};
