/**
 * Saisons thématiques automatiques (#48).
 *
 * Base temporaire hors server/data/, horloge simulée, packs de saison réels (server/content/seasons).
 * Scénario calqué sur la production du 03/11/2026 (« Saison 45-2026 » active, ligue unique Mimosa) :
 *   - la saison en cours reçoit un nom de repli, la suivante est préparée tout de suite avec un pack
 *     (nom, accroche, collection en brouillon, drops inactifs, consignes d'illustration) ;
 *   - annonce exactement 24 h avant, collection jamais évoquée tant qu'elle n'est pas publiée ;
 *   - 52 rotations hebdomadaires (passage à l'heure d'hiver 2027 compris) : un thème par saison, noms
 *     tous différents (clé normalisée), packs utilisés une seule fois et à leur semaine ;
 *   - redémarrage (initDb rejoué) sans doublon ; aucune IA, aucun réseau, aucune dépense d'image ;
 *   - exclusions, noms de ligue refusés, édition et « Autre nom » atomiques ;
 *   - une panne des thèmes n'empêche ni la rotation ni la réponse de GET /api/seasons/current.
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-themes-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');
process.env.DIG_SEASON_PACKS = path.join(__dirname, '..', 'server', 'content', 'seasons');

const cal       = require('../server/seasonCalendar');
const db        = require('../server/db');
const seasons   = require('../server/seasons');
const themes    = require('../server/seasonThemes');
const catalog   = require('../server/collectionCatalog');
const ai        = require('../server/collectionAi');
const studio    = require('../server/iconStudio');
const blockAi   = require('../server/blockAi');

const conn = () => db.getDb();
const at   = iso => new Date(iso);
const H    = 3_600_000;

function quiet(fn) {
  const log = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = log; }
}

/** Passage du planificateur (rotation puis thèmes), rejoué deux fois pour l'idempotence. */
function tick(now) {
  let active;
  for (let i = 0; i < 2; i++) {
    active = quiet(() => seasons.checkAndRotateSeason(now));
    quiet(() => themes.sync(now));
  }
  return active;
}

const themeCount = () => conn().prepare('SELECT COUNT(*) n FROM season_themes').get().n;

// Aucune IA, aucun réseau : tout appel ferait échouer le test
let aiCalls = 0;
blockAi.guardedJson = async () => { aiCalls++; throw new Error('appel IA interdit dans ce test'); };
const realFetch = global.fetch;
global.fetch = async () => { aiCalls++; throw new Error('réseau interdit dans ce test'); };
test.after(() => { global.fetch = realFetch; fs.rmSync(dir, { recursive: true, force: true }); });

test('clé de nom : accents, casse, articles et ordre des mots ignorés', () => {
  assert.strictEqual(themes.nameKey('Taupes et Lanternes'), themes.nameKey('lanternes ET taupes'));
  assert.strictEqual(themes.nameKey('La Saison des Géants'), themes.nameKey('saison des GEANTS'));
  assert.strictEqual(themes.nameKey('The Season of Giants'), 'giants');
  assert.notStrictEqual(themes.nameKey('Lanternes'), themes.nameKey('Lanternes et taupes'));
});

test('packs de saison : textes complets, consignes d\'illustration propres à chaque objet', () => {
  const packs = themes.loadPacks(process.env.DIG_SEASON_PACKS);
  assert.ok(packs.length >= 3, 'au moins trois saisons rédigées');
  const keys = new Set(), itemIds = new Set();
  for (const p of packs) {
    assert.ok(!keys.has(themes.nameKey(p.names.fr)), `nom de pack unique : ${p.names.fr}`);
    keys.add(themes.nameKey(p.names.fr));
    const c = p.collection;
    assert.ok(c && c.items.length >= 5, `${p.pack} : collection d'au moins 5 objets`);
    for (const i of c.items) {
      assert.ok(!itemIds.has(i.id), `identifiant d'objet unique entre packs : ${i.id}`);
      itemIds.add(i.id);
      for (const l of themes.LANGS) {
        assert.ok(i.names[l] && i.stories[l], `${i.id} : nom et histoire ${l}`);
        assert.ok(i.stories[l].length <= 420, `${i.id} : histoire ${l} courte (${i.stories[l].length})`);
      }
      assert.ok(i.image.subject && i.image.details && /^Palette:/.test(i.image.palette), `${i.id} : consigne d'illustration complète`);
      assert.ok(i.reference, `${i.id} : clin d'œil documenté`);
    }
    const rar = c.items.map(i => i.rarity);
    assert.ok(rar.filter(r => r === 'legendaire').length <= 1 && rar.filter(r => r === 'epique').length <= 1, `${p.pack} : au plus un épique et un légendaire`);
  }
});

test('production simulée : saison en cours, préparation J-7, annonce J-1, 52 rotations, redémarrage', (t) => {
  const T0 = at('2026-11-03T02:00:00Z');   // mardi : « Saison 45-2026 » active, comme en production
  t.mock.timers.enable({ apis: ['Date'], now: T0.getTime() });
  db.initDb();
  studio.init(); catalog.init(); ai.init(); themes.init();

  // Qualité des packs AVANT import (base neuve) : aucun avertissement de la relecture #39
  for (const p of themes.loadPacks()) assert.deepStrictEqual(ai.proposalWarnings(p.collection), [], `${p.pack} : relecture sans avertissement`);

  const s45 = tick(T0);
  assert.strictEqual(s45.name, 'Saison 45-2026');
  const mimosa = db.getLeagueByLevel(0);
  assert.strictEqual(mimosa.name, 'Mimosa', 'Mimosa = ligue de départ, jamais renommée');

  // Saison déjà commencée sans thème : nom de repli, aucun pack consommé, pas de collection
  const cur = themes.themeForSeason(s45.id);
  assert.strictEqual(cur.source, 'fallback');
  assert.strictEqual(cur.status, 'active');
  assert.strictEqual(cur.seriesId, null);
  assert.notStrictEqual(themes.nameKey(cur.names.fr), themes.nameKey('Mimosa'));

  // Saison suivante préparée tout de suite (≥ J-3) avec le pack de sa semaine
  const adm = themes.adminView(T0);
  assert.strictEqual(adm.next.startAt, '2026-11-09 00:00:00');
  assert.strictEqual(adm.next.weekKey, '2026-W46');
  const n46 = adm.next.theme;
  assert.strictEqual(n46.pack, 'saison_lanternes_v1');
  assert.strictEqual(n46.status, 'prepared');
  assert.strictEqual(n46.seriesId, 'tresors_saint_martin');
  // Collection : brouillon seulement, drops inactifs, jamais publiée ; consignes transmises à l'atelier
  assert.ok(!catalog.getPublished().series.some(s => s.id === 'tresors_saint_martin'), 'non publiée');
  const draftItems = catalog.getDraft().items.filter(i => i.seriesId === 'tresors_saint_martin');
  assert.strictEqual(draftItems.length, 6);
  assert.ok(draftItems.every(i => i.dropEnabled === false && i.image === null), 'drops inactifs, aucune image');
  const plan = studio.seriesPlan('tresors_saint_martin');
  assert.deepStrictEqual(plan.items.map(i => i.state), Array(6).fill('todo'), 'aucun conflit de sujet entre objets');
  assert.strictEqual(n46.collection.toGenerate, 6);

  // Annonce : 24 h avant le début, pas avant ; jamais la collection non publiée
  const pv = now => themes.publicView(db.getActiveSeason(), now);
  assert.strictEqual(pv(at('2026-11-07T23:59:59Z')).next, null);
  const ann = pv(at('2026-11-08T00:00:00Z')).next;
  assert.strictEqual(ann.theme.names.fr, 'La Saison des Lanternes');
  assert.strictEqual(ann.startAt, '2026-11-09 00:00:00');
  assert.strictEqual(ann.collection, null, 'collection en brouillon : non évoquée');
  assert.ok(!JSON.stringify(ann).includes('chance') && !JSON.stringify(ann).includes('drop'), 'aucune probabilité exposée');
  assert.strictEqual(pv(T0).theme.names.fr, cur.names.fr);

  // Rotation : le thème annoncé commence avec la saison, la série est rattachée à la saison (brouillon)
  let now = at('2026-11-09T00:00:30Z');
  t.mock.timers.setTime(now.getTime());
  const s46 = tick(now);
  assert.strictEqual(s46.name, 'Saison 46-2026');
  assert.strictEqual(themes.themeForSeason(s46.id).id, n46.id);
  assert.strictEqual(themes.getTheme(cur.id).status, 'archived');
  assert.strictEqual(catalog.getDraft().series.find(s => s.id === 'tresors_saint_martin').seasonId, s46.id);
  const hist = pv(now).history;
  assert.strictEqual(hist[0].name, 'Saison 45-2026');
  assert.strictEqual(hist[0].theme.names.fr, cur.names.fr, 'archives : thème conservé');

  // Collection publiée par l'admin → visible côté joueur (nom, nombre d'objets, rien d'autre)
  for (const i of catalog.getDraft().items.filter(x => x.seriesId === 'tresors_saint_martin')) {
    catalog.upsertDraftItem({ ...i, image: `/assets/test/${i.id}.webp`, dropEnabled: true });
  }
  quiet(() => catalog.publishSeries('tresors_saint_martin', { confirmDrops: true }));
  const col = pv(now).collection;
  assert.deepStrictEqual(Object.keys(col).sort(), ['count', 'icon', 'id', 'names']);
  assert.strictEqual(col.count, 6);

  // 51 rotations de plus (jusqu'au passage à l'heure d'hiver 2027 inclus)
  for (let w = 1; w <= 51; w++) {
    now = new Date(at('2026-11-09T00:00:30Z').getTime() + w * 7 * 24 * H);
    t.mock.timers.setTime(now.getTime());
    tick(now);
  }
  const all = conn().prepare('SELECT s.id, s.name, s.start_at, t.name_key, t.pack, t.source FROM seasons s LEFT JOIN season_themes t ON t.season_id = s.id ORDER BY s.id').all();
  assert.ok(all.length >= 53);
  assert.ok(all.every(r => r.name_key), 'chaque saison a un thème');
  assert.strictEqual(new Set(all.map(r => r.name_key)).size, all.length, 'noms de thème tous différents');
  const byName = Object.fromEntries(all.map(r => [r.name, r]));
  assert.strictEqual(byName['Saison 47-2026'].pack, 'saison_geants_v1', 'pack sans semaine : premier disponible');
  assert.strictEqual(byName['Saison 48-2026'].source, 'fallback', 'aucun pack libre pour cette semaine : repli');
  assert.strictEqual(byName['Saison 49-2026'].pack, 'saison_saint_nicolas_v1', 'pack daté : à sa semaine');
  const packUses = all.filter(r => r.pack).map(r => r.pack);
  assert.strictEqual(new Set(packUses).size, packUses.length, 'chaque pack une seule fois');
  // Registre : une clé par thème, aucune perdue
  assert.strictEqual(conn().prepare("SELECT COUNT(*) n FROM season_theme_names WHERE reason = 'assigned'").get().n, themeCount());

  // Heure d'hiver 2027 (dimanche 31/10, 03:00 → 02:00) : annonce 24 h réelles avant le lundi 01/11 00:00 UTC
  const sOct = conn().prepare("SELECT * FROM seasons WHERE start_at = '2027-10-25 00:00:00'").get();
  assert.ok(sOct, 'saison de la semaine du changement d\'heure');
  const dstNext = themes.nextStart(sOct, at('2027-10-30T12:00:00Z'));
  assert.strictEqual(cal.fmtUtc(dstNext), '2027-11-01 00:00:00');
  assert.strictEqual(cal.fmtLocal(new Date(dstNext.getTime() - 24 * H)), '2027-10-31 02:00:00 (UTC+2)', 'annonce à 02:00 heure d\'été');
  assert.strictEqual(cal.fmtLocal(dstNext), '2027-11-01 01:00:00 (UTC+1)', 'début à 01:00 heure d\'hiver');

  // Redémarrage : migrations et préparation rejouées sans aucun doublon
  const before = themeCount();
  db.initDb();
  themes.init();
  tick(now);
  assert.strictEqual(themeCount(), before, 'aucun thème créé en double après redémarrage');
  assert.strictEqual(conn().prepare("SELECT COUNT(*) n FROM season_themes WHERE status = 'active'").get().n, 1);

  // Aucune IA, aucun réseau, aucune dépense d'image
  assert.strictEqual(aiCalls, 0);
  assert.strictEqual(conn().prepare('SELECT COUNT(*) n FROM icon_studio_calls').get().n, 0);
  t.mock.timers.reset();
});

test('exclusions, noms de ligue, édition et « Autre nom » : unicité durable et atomicité', () => {
  const active = db.getActiveSeason();
  const next = themes.adminView(new Date()).next?.theme
    ?? (quiet(() => themes.sync(new Date(), { force: true })), themes.adminView(new Date()).next.theme);
  assert.ok(next, 'saison suivante préparée');

  // Nom de ligue refusé, nom déjà utilisé refusé, ligne inchangée
  const used = themes.themeForSeason(active.id).names.fr;
  for (const fr of ['Mimosa', used, used.toUpperCase()]) {
    assert.throws(() => themes.updateTheme(next.id, { names: { fr } }), e => e.status === 409, fr);
  }
  assert.strictEqual(themes.getTheme(next.id).names.fr, next.names.fr, 'édition refusée : rien n\'a changé');

  // Renommage manuel : le nouveau nom est réservé, l'ancien le reste aussi
  const renamed = themes.updateTheme(next.id, { names: { fr: 'Les Taupes Philosophes' } });
  assert.strictEqual(renamed.names.fr, 'Les Taupes Philosophes');
  const reserved = new Set(conn().prepare('SELECT name_key FROM season_theme_names').all().map(r => r.name_key));
  assert.ok(reserved.has(themes.nameKey(next.names.fr)) && reserved.has(themes.nameKey('taupes philosophes')));

  // « Autre nom » + exclusion : l'ancien est rejeté et exclu, la collection suit le nouveau
  const r = themes.rerollTheme(next.id, { exclude: true });
  assert.notStrictEqual(r.id, next.id);
  assert.strictEqual(themes.getTheme(next.id).status, 'rejected');
  assert.strictEqual(r.seriesId, next.seriesId);
  assert.strictEqual(r.source, 'fallback');
  assert.throws(() => themes.rerollTheme(themes.themeForSeason(active.id).id), e => e.status === 409, 'thème en cours : pas d\'autre nom');

  // Mot exclu : plus jamais proposé par le repli (quel que soit l'ordre ou la casse)
  themes.addExclusion('Dragons');
  for (let k = 0; k < 40; k++) {
    const f = themes.fallbackTheme(`test-${k}`);
    assert.ok(!/dragon/i.test(f.names.fr), f.names.fr);
  }
  // L'exclusion se retire ; un nom attribué, jamais
  themes.removeExclusion(themes.nameKey('Dragons'));
  assert.throws(() => themes.removeExclusion(themes.nameKey(used)), e => e.status === 404);

});

test('une panne des thèmes ne bloque ni la rotation ni la réponse saison', () => {
  const sync = themes.sync, view = themes.publicView;
  themes.sync = () => { throw new Error('panne simulée'); };
  const err = console.error;
  console.error = () => {};
  try {
    const r = seasons.buildCurrentSeasonResponse(null);
    assert.ok(r.season.id, 'saison toujours servie');
    assert.strictEqual(r.season.theme, null);
    assert.deepStrictEqual(r.history, []);
  } finally {
    themes.sync = sync; themes.publicView = view; console.error = err;
  }
  // Masquage par le réglage : aucune information de thème côté joueur
  conn().prepare("UPDATE admin_config SET value = 'false' WHERE key = 'season_themes_public'").run();
  const hidden = seasons.buildCurrentSeasonResponse(null);
  assert.strictEqual(hidden.season.theme, null);
  assert.strictEqual(hidden.next, null);
  conn().prepare("UPDATE admin_config SET value = 'true' WHERE key = 'season_themes_public'").run();
  assert.ok(seasons.buildCurrentSeasonResponse(null).season.theme, 'thème de nouveau affiché');
});

test('réglages : bornes validées', () => {
  assert.deepStrictEqual(themes.validateConfigValue('season_prep_days', '3'), { value: '3' });
  assert.ok(themes.validateConfigValue('season_prep_days', '2').error, 'jamais moins de J-3');
  assert.ok(themes.validateConfigValue('season_announce_hours', '200').error);
  assert.deepStrictEqual(themes.validateConfigValue('season_announce_hours', '0'), { value: '0' });
  assert.ok(themes.validateConfigValue('season_themes_public', 'oui').error);
  assert.strictEqual(themes.validateConfigValue('promotion_rate', '0.5'), null, 'clé étrangère : non traitée');
});
