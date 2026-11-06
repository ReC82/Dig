/**
 * Tests du ticket #86 — « Novembre déterre l'Histoire » : 30 souvenirs préparés en brouillon
 * (contenu complet FR/EN/NL/ES, date de référence et inspiration réservées à l'admin), import
 * unique et sans écrasement, migration en ajout seul, aucun drop ni aucune donnée exposée tant que
 * l'événement est en brouillon, limite de 40 objets, importation groupée du panel, calendrier des
 * micro-bonus (jours du mois, prochain créneau, changements d'heure), simulateur de drops.
 * Base temporaire hors server/data/.
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-nov86-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db           = require('../server/db');
const blockCatalog = require('../server/blockCatalog');
const badges       = require('../server/badges');
const ev           = require('../server/monthlyEvents');
const MicroBonus   = require('../public/js/microBonus');

const FILE = path.join(ROOT, 'server/content/events/novembre-histoire-2026.json');
const NOV = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const LANGS = ['fr', 'en', 'nl', 'es'];
let season;

test.before(() => {
  db.initDb();
  blockCatalog.init();
  badges.init();
  ev.init();
  season = db.getActiveSeason();
});

test.after(() => {
  db.getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('contenu préparé : 30 souvenirs distincts, un par date du 01 au 30/11, complets en 4 langues', () => {
  assert.strictEqual(NOV.id, 'novembre_histoire_2026');
  assert.strictEqual(NOV.names.fr, "Novembre déterre l'Histoire");
  assert.strictEqual(NOV.status, undefined, 'aucun statut dans le fichier : import toujours en brouillon');
  const e = ev.normalizeEvent(NOV);
  assert.strictEqual(e.items.length, 30);
  assert.deepStrictEqual(e.items.map(i => i.refDate), Array.from({ length: 30 }, (_, k) => `11-${String(k + 1).padStart(2, '0')}`));
  assert.strictEqual(new Set(e.items.map(i => i.id)).size, 30);
  assert.strictEqual(new Set(e.items.map(i => i.icon)).size, 30, 'un emoji provisoire distinct par objet');
  assert.strictEqual(new Set(e.items.map(i => i.brief)).size, 30, 'une consigne d\'image distincte par objet');
  for (const [k, it] of e.items.entries()) {
    const raw = NOV.items[k];
    for (const l of LANGS) {
      assert.ok(it.names[l] && it.descs[l], `${it.id} : texte ${l} présent`);
      assert.strictEqual(it.names[l], raw.names[l], `${it.id} : nom ${l} non tronqué`);
      assert.strictEqual(it.descs[l], raw.descs[l], `${it.id} : description ${l} non tronquée`);
    }
    assert.strictEqual(it.inspiration, raw.inspiration, `${it.id} : inspiration non tronquée`);
    assert.ok(it.inspiration.length > 20 && it.brief.length > 20);
    assert.ok(/^nov26_\d{2}_[a-z0-9_]+$/.test(it.id), it.id);
    assert.ok(it.id.startsWith(`nov26_${it.refDate.slice(3)}_`), 'identifiant stable lisible par date');
    assert.deepStrictEqual(it.dropFrom, [], 'trouvable sur tous les blocs, quel que soit le jour');
    assert.ok(ev.RARITIES.includes(it.rarity));
  }
  const byFr = Object.fromEntries(e.items.map(i => [i.refDate, i]));
  assert.strictEqual(byFr['11-01'].names.fr, "L'échelle de Michel-Ange");
  assert.strictEqual(byFr['11-09'].names.fr, 'La brique de la liberté');
  assert.strictEqual(byFr['11-09'].rarity, 'epique');
  assert.strictEqual(byFr['11-11'].names.fr, 'Le coquelicot de mémoire');
  assert.strictEqual(byFr['11-23'].rarity, 'legendaire');
  assert.strictEqual(byFr['11-30'].names.fr, 'Le nœud papillon de Churchill');
  const count = r => e.items.filter(i => i.rarity === r).length;
  assert.deepStrictEqual(ev.RARITIES.map(count), [5, 9, 9, 5, 2], 'raretés du ticket (commun → légendaire)');
  assert.deepStrictEqual(ev.readiness({ ...e, testers: [] }).blocking, [], 'aucun texte manquant');
});

test('import au démarrage : brouillon public, dates de Bruxelles, une seule fois, jamais d\'écrasement', () => {
  const tmp = fs.mkdtempSync(path.join(dir, 'prep-'));
  fs.copyFileSync(FILE, path.join(tmp, 'novembre-histoire-2026.json'));
  assert.deepStrictEqual(ev.importPrepared(tmp), ['novembre_histoire_2026']);
  assert.deepStrictEqual(ev.importPrepared(tmp), [], 'jamais réimporté');
  const nov = ev.getEvent('novembre_histoire_2026');
  assert.strictEqual(nov.status, 'draft');
  assert.strictEqual(nov.state, 'draft');
  assert.strictEqual(nov.audience, 'public');
  assert.strictEqual(nov.startsAt, '2026-10-31T23:00:00Z', '01/11 00:00 Bruxelles');
  assert.strictEqual(nov.endsAt, '2026-11-30T23:00:00Z', 'fin exclue = 30/11 23:59:59 Bruxelles inclus');
  assert.strictEqual(nov.items.length, 30);
  assert.strictEqual(nov.items[8].refDate, '11-09');
  assert.match(nov.items[8].inspiration, /mur de Berlin/);
  assert.ok(nov.items.every(i => i.image === null && i.publishedImage === null), 'aucune image : emoji provisoire');

  // Un événement de même identifiant modifié par l'admin n'est jamais écrasé par le fichier
  const edited = ev.updateEvent('novembre_histoire_2026', { ...NOV, names: { ...NOV.names, fr: 'Titre modifié' } });
  assert.strictEqual(edited.names.fr, 'Titre modifié');
  db.getDb().prepare("DELETE FROM monthly_event_meta WHERE key = 'prepared:novembre-histoire-2026.json'").run();
  assert.deepStrictEqual(ev.importPrepared(tmp), ['novembre_histoire_2026']);
  assert.strictEqual(ev.getEvent('novembre_histoire_2026').names.fr, 'Titre modifié', 'existant conservé');
  assert.throws(() => ev.createEvent(NOV), e => e.status === 409, 'importation du panel : identifiant déjà pris refusé');
});

test('brouillon : aucun drop, rien d\'annoncé, ni date de référence ni inspiration envoyées au joueur', () => {
  const uid = db.getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('nov86_joueur', 'x').lastInsertRowid;
  db.upsertDepthTracking(uid, { season_id: season.id, ref_clicks: 0, ref_auto: 0, hand_tokens: 0, auto_tokens: 0,
    accepted_depth: 80, last_gap: 0, updated_ms: Date.now(), dmg_depth: null, dmg_credit: null, dmg_ref_clicks: null, dmg_gap: 0 });
  badges.processSave(uid, { stats: { minedByType: { terre: 500, pierre: 500 } } });
  const mid = Date.parse('2026-11-15T12:00:00Z');
  assert.deepStrictEqual(ev.activeFor(uid, mid).filter(e => e.id === 'novembre_histoire_2026'), []);
  assert.deepStrictEqual(ev.processSave(uid, { nowMs: mid, rand: () => 0 }), [], 'brouillon : aucun souvenir, même avec un tirage forcé');
  assert.strictEqual(db.getDb().prepare("SELECT COUNT(*) n FROM monthly_event_finds WHERE event_id = 'novembre_histoire_2026'").get().n, 0);
  const view = JSON.stringify(ev.publicView(uid, mid));
  assert.ok(!view.includes('novembre_histoire_2026') && !view.includes('Michel-Ange'), 'invisible du joueur');
  // Même un objet trouvé (cas futur) n'expose ni la date de référence ni l'inspiration
  db.getDb().prepare("INSERT INTO monthly_event_finds (user_id, event_id, item_id, found_at) VALUES (?, 'novembre_histoire_2026', 'nov26_09_brique_liberte', '2026-11-09T10:00:00Z')").run(uid);
  const pv = ev.publicView(uid, mid);
  const sv = pv.souvenirs.find(s => s.id === 'novembre_histoire_2026');
  assert.ok(sv && sv.items.length === 1);
  assert.strictEqual(sv.items[0].refDate, undefined);
  assert.strictEqual(sv.items[0].inspiration, undefined);
  db.getDb().prepare("DELETE FROM monthly_event_finds WHERE user_id = ?").run(uid);
});

test('limites : 40 objets au plus (le mois n\'impose pas 30), date de référence MM-JJ validée', () => {
  const base = { id: 'lim_86', names: { fr: 'Limite' }, startsAt: '2027-03-01T00:00', endsAt: '2027-03-10T00:00' };
  const mk = n => Array.from({ length: n }, (_, k) => ({ id: `lim_${k}_x`, names: { fr: `O${k}` }, chancePct: 1 }));
  assert.strictEqual(ev.normalizeEvent({ ...base, items: mk(3) }).items.length, 3, 'un mois peut prévoir moins de 30 objets');
  assert.strictEqual(ev.normalizeEvent({ ...base, items: mk(40) }).items.length, 40);
  assert.throws(() => ev.normalizeEvent({ ...base, items: mk(41) }), /40 objets au plus/);
  for (const bad of ['11-31x', '13-01', '11-32', '1-9', '11/09']) {
    assert.throws(() => ev.normalizeEvent({ ...base, items: [{ ...mk(1)[0], refDate: bad }] }), /MM-JJ/, bad);
  }
  assert.strictEqual(ev.normalizeEvent({ ...base, items: [{ ...mk(1)[0], refDate: '' }] }).items[0].refDate, '');
});

test('migration : colonnes ajoutées à une table existante, idempotente, lignes conservées', () => {
  const Database = require('better-sqlite3');
  const c = new Database(path.join(dir, 'old.sqlite'));
  c.exec(`CREATE TABLE monthly_event_items (event_id TEXT NOT NULL, id TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, icon TEXT NOT NULL,
    image TEXT, brief TEXT NOT NULL DEFAULT '', names TEXT NOT NULL, descs TEXT NOT NULL, rarity TEXT NOT NULL, chance_pct REAL NOT NULL,
    min_depth INTEGER NOT NULL DEFAULT 0, drop_from TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (event_id, id));
    INSERT INTO monthly_event_items (event_id, id, icon, names, descs, rarity, chance_pct) VALUES ('old', 'old_item', '🪨', '{"fr":"Vieux"}', '{}', 'rare', 1);`);
  ev.init(c);
  ev.init(c);
  const cols = c.prepare('PRAGMA table_info(monthly_event_items)').all().map(x => x.name);
  assert.ok(cols.includes('ref_date') && cols.includes('inspiration'));
  const row = c.prepare("SELECT * FROM monthly_event_items WHERE id = 'old_item'").get();
  assert.strictEqual(row.ref_date, '');
  assert.strictEqual(row.inspiration, '');
  assert.strictEqual(row.chance_pct, 1);
  c.close();
});

test('micro-bonus (#81) : jours du mois, prochain créneau, bornes inclusives et changements d\'heure', () => {
  const first = MicroBonus.normalize({ value: 0.05, schedule: { monthDays: '1-7' } });
  assert.deepStrictEqual(first.schedule.monthDays, [1, 2, 3, 4, 5, 6, 7]);
  assert.strictEqual(MicroBonus.describe(first, 'fr'), '+0,05 dégât par coup sur tous les blocs — du 1er au 7 de chaque mois');
  const br = (ymdHm) => Date.parse(`${ymdHm}:00+01:00`);   // heure d'hiver
  assert.strictEqual(MicroBonus.isActiveAt(first, br('2026-11-07T23:59')), true, 'le 7 inclus jusqu\'à 23:59 Bruxelles');
  assert.strictEqual(MicroBonus.isActiveAt(first, br('2026-11-08T00:00')), false);
  assert.deepStrictEqual(MicroBonus.nextChange(first, br('2026-11-06T20:00')), { code: 'until', ymd: '2026-11-07' });
  assert.deepStrictEqual(MicroBonus.nextChange(first, br('2026-11-09T10:00')), { code: 'next', ymd: '2026-12-01' });
  assert.strictEqual(MicroBonus.describeNext(first, br('2026-11-09T10:00')), 'prochain créneau le 01/12/2026');
  // Jeudi : se réactive chaque semaine, y compris à travers le passage à l'heure d'été (dim. 28/03/2027)
  const thu = MicroBonus.normalize({ value: 0.03, schedule: { weekdays: [4] } });
  assert.deepStrictEqual(MicroBonus.nextChange(thu, br('2027-03-27T12:00')), { code: 'next', ymd: '2027-04-01' });
  assert.strictEqual(MicroBonus.isActiveAt(thu, Date.parse('2027-04-01T00:00:00+02:00')), true, 'jeudi 00:00 heure d\'été');
  assert.strictEqual(MicroBonus.isActiveAt(thu, Date.parse('2027-03-31T23:59:00+02:00')), false);
  assert.strictEqual(MicroBonus.nextChange(MicroBonus.normalize({ value: 0.01 }), Date.now()), null, 'constant : aucun changement');
  assert.throws(() => MicroBonus.normalize({ value: 0.01, schedule: { monthDays: '0-3' } }), /Jours du mois/);
  assert.throws(() => MicroBonus.normalize({ value: 0.01, schedule: { monthDays: [32] } }), /Jours du mois/);
  // Le jeu ne reçoit toujours aucun bonus : total d'une liste vide = 0
  assert.strictEqual(MicroBonus.total([], { block: { id: 'pierre', category: 'pierre' } }), 0);
});

test('panel admin : champs date de référence / inspiration, importation JSON, jours du mois', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
  for (const id of ['evi-refdate', 'evi-inspiration', 'btn-ev-add-import', 'ev-import-file', 'mb-monthdays']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(js, /refDate: document\.getElementById\('evi-refdate'\)/);
  assert.match(js, /const \{ status: _s, \.\.\.body \} = raw;/, 'statut jamais importé');
  assert.match(js, /api\('POST', '\/api\/admin\/events', body\)/, 'import = création en brouillon (409 si existant)');
});

test('simulateur de drops : 30 objets, déterministe, progression croissante', () => {
  const sim = require('../tools/balance/november-event-sim');
  const a = sim.run(sim.PROFILES.regulier, { runs: 8 });
  const b = sim.run(sim.PROFILES.regulier, { runs: 8 });
  assert.deepStrictEqual(a, b, 'graine fixe');
  assert.strictEqual(a.count, 30);
  for (let k = 1; k < a.byDay.length; k++) assert.ok(a.byDay[k].mean >= a.byDay[k - 1].mean);
  assert.ok(a.byDay[0].mean > 0 && a.byDay[a.byDay.length - 1].mean <= 30);
  const guest = sim.run(sim.PROFILES.entrant, { runs: 4 });
  assert.strictEqual(guest.days, 22, 'invité du 09/11 : 22 jours');
});
