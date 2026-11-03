/**
 * Tests des événements mensuels (ticket #56) : dates de Bruxelles et calendrier, fiche et
 * planification, drops côté serveur sur le minage validé (testeurs seulement, dates, catégories,
 * profondeur, unicité, rafale), souvenirs conservés après la fin et le retour en brouillon,
 * révisions, contenu préparé de Noël, annonces #50, IA factice, routes HTTP de bout en bout.
 * Base temporaire hors server/data/.
 * Lancer : npm test
 */

'use strict';

const test     = require('node:test');
const assert   = require('node:assert');
const crypto   = require('crypto');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.DIG_TEST_PORT_EVENTS || '3172';
const BASE = `http://127.0.0.1:${PORT}`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-events-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');
process.env.DIG_AI_FAKE = '1';

const db            = require('../server/db');
const blockCatalog  = require('../server/blockCatalog');
const badges        = require('../server/badges');
const news          = require('../server/news');
const ev            = require('../server/monthlyEvents');

const NOEL = require('../server/content/events/noel-2026.json');
const HOUR = 3_600_000;
let season;
let userSeq = 0;

function newUser(name = `ev_user_${++userSeq}`) {
  return db.getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(name, 'x').lastInsertRowid;
}
const nameOf = id => db.getDb().prepare('SELECT username FROM users WHERE id = ?').get(id).username;

function setAccepted(userId, depth) {
  db.upsertDepthTracking(userId, { season_id: season.id, ref_clicks: 0, ref_auto: 0, hand_tokens: 0, auto_tokens: 0,
    accepted_depth: depth, last_gap: 0, updated_ms: Date.now(), dmg_depth: null, dmg_credit: null, dmg_ref_clicks: null, dmg_gap: 0 });
}

/** Minage validé : profondeur retenue + compteurs déclarés, crédités par badges.processSave (#38). */
function mine(userId, depth, minedByType) {
  setAccepted(userId, depth);
  badges.processSave(userId, { stats: { minedByType } });
}

const tx = s => ({ fr: s, en: `${s} EN`, nl: `${s} NL`, es: `${s} ES` });
const item = (id, extra = {}) => ({ id, icon: '🎁', rarity: 'commun', chancePct: 50, minDepth: 0, dropFrom: [], names: tx(`Objet ${id}`), descs: tx(`Desc ${id}`), ...extra });
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

function scheduledTest(id, testers, items, { from = Date.now() - HOUR, to = Date.now() + HOUR } = {}) {
  ev.createEvent({ id, icon: '🧪', audience: 'test', testers, names: tx(`Test ${id}`), taglines: tx('t'), startsAt: iso(from), endsAt: iso(to), items });
  return ev.scheduleEvent(id);
}

const ALWAYS = () => 0;   // tirage forcé : réussit dès que la probabilité est > 0
const NEVER = () => 0.999999;

test.before(() => {
  db.initDb();
  blockCatalog.init();
  badges.init();
  news.init();
  require('../server/blockAi').init();
  ev.init();
  season = db.getActiveSeason();
  assert.ok(season, 'saison active du seed');
});

test.after(() => {
  db.getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── Dates et calendrier ───────────────────────────────────────────────────────

test('heure de Bruxelles : hiver, été, jour du changement d\'heure, aller-retour', () => {
  assert.strictEqual(ev.brusselsToUtc('2026-12-01T00:00'), '2026-11-30T23:00:00Z');
  assert.strictEqual(ev.brusselsToUtc('2026-07-01T00:00'), '2026-06-30T22:00:00Z');
  assert.strictEqual(ev.brusselsToUtc('2027-03-28T03:30'), '2027-03-28T01:30:00Z');
  assert.strictEqual(ev.brusselsToUtc('2026-10-25T12:00'), '2026-10-25T11:00:00Z');
  assert.strictEqual(ev.utcToBrussels('2026-11-30T23:00:00Z'), '2026-12-01T00:00');
  assert.strictEqual(ev.brusselsToUtc('n\'importe quoi'), null);
});

test('calendrier : une proposition par mois, fêtes calculées, idées sans thème imposé', () => {
  const cal = ev.proposeCalendar(2027, Date.UTC(2026, 10, 3));
  assert.strictEqual(cal.months.length, 12);
  const m = n => cal.months[n - 1];
  assert.deepStrictEqual(m(3).holiday, { key: 'paques', name: 'Pâques', date: '2027-03-28' });
  assert.strictEqual(m(2).holiday.key, 'carnaval');
  assert.strictEqual(m(2).holiday.date, '2027-02-09');
  assert.ok(m(2).alternatives.some(a => a.key === 'nouvel_an_chinois' && a.date === '2027-02-06'));
  assert.strictEqual(m(10).holiday.key, 'halloween');
  assert.strictEqual(m(12).holiday.key, 'noel');
  assert.deepStrictEqual(m(12).suggested, { startsAt: '2027-12-01T00:00', endsAt: '2028-01-01T00:00' });
  assert.strictEqual(m(12).prepareBy, '2027-11-10');
  assert.strictEqual(m(5).holiday, null);
  assert.ok(m(5).ideas.length >= 1 && m(5).suggested === null, 'mois sans fête : idées seulement');
  // Pâques 2026 = 5 avril, 2028 = 16 avril
  assert.strictEqual(ev.holidays(2026).find(h => h.key === 'paques').date.toISOString().slice(0, 10), '2026-04-05');
  assert.strictEqual(ev.holidays(2028).find(h => h.key === 'paques').date.toISOString().slice(0, 10), '2028-04-16');
});

// ── Fiche, validation, planification ─────────────────────────────────────────

test('fiche : validation, brouillon par défaut, readiness, planification TEST et PUBLIC protégée', () => {
  assert.throws(() => ev.createEvent({ id: 'X', names: tx('a'), startsAt: '2026-12-01T00:00', endsAt: '2026-12-02T00:00' }), /Identifiant/);
  assert.throws(() => ev.createEvent({ id: 'bad_dates', names: tx('a'), startsAt: '2026-12-02T00:00', endsAt: '2026-12-01T00:00' }), /fin doit suivre/);
  assert.throws(() => ev.createEvent({ id: 'too_long', names: tx('a'), startsAt: '2026-12-01T00:00', endsAt: '2027-03-01T00:00' }), /Durée maximale/);
  assert.throws(() => ev.createEvent({ id: 'bad_item', names: tx('a'), startsAt: '2026-12-01T00:00', endsAt: '2026-12-02T00:00', items: [item('aaa', { chancePct: 0 })] }), /chance/);
  assert.throws(() => ev.createEvent({ id: 'dup_item', names: tx('a'), startsAt: '2026-12-01T00:00', endsAt: '2026-12-02T00:00', items: [item('aaa'), item('aaa')] }), /double/);
  assert.throws(() => ev.createEvent({ id: 'bad_img', names: tx('a'), startsAt: '2026-12-01T00:00', endsAt: '2026-12-02T00:00', items: [item('aaa', { image: 'https://evil.example/x.png' })] }), /image/);

  const later = Date.now() + 30 * 86_400_000;
  const e = ev.createEvent({ id: 'fiche_pub', audience: 'public', names: { fr: 'Fiche' }, startsAt: iso(later), endsAt: iso(later + 86_400_000), items: [item('fiche_a')] });
  assert.strictEqual(e.status, 'draft');
  assert.strictEqual(e.state, 'draft');
  assert.ok(!ev.readiness(e).ready);
  assert.ok(ev.readiness(e).blocking.some(b => /EN manquant/.test(b)));
  assert.throws(() => ev.scheduleEvent('fiche_pub'), /incomplet/);
  ev.updateEvent('fiche_pub', { ...e, names: tx('Fiche'), startsAt: e.startsAt, endsAt: e.endsAt, items: [item('fiche_a')] });
  assert.throws(() => ev.scheduleEvent('fiche_pub'), /barème validé/, 'public : deux confirmations exigées');
  assert.throws(() => ev.scheduleEvent('fiche_pub', { confirmRates: true }), /publication validée/);
  const s = ev.scheduleEvent('fiche_pub', { confirmRates: true, confirmPublic: true });
  assert.strictEqual(s.state, 'planned');
  assert.throws(() => ev.updateEvent('fiche_pub', { ...s, items: [] }), /repassez-le en brouillon/);
  assert.strictEqual(ev.unscheduleEvent('fiche_pub').status, 'draft');

  ev.createEvent({ id: 'no_tester', names: tx('x'), startsAt: iso(later), endsAt: iso(later + HOUR), items: [item('nt_a')] });
  assert.throws(() => ev.scheduleEvent('no_tester'), /sans testeur/);
});

// ── Drops serveur ─────────────────────────────────────────────────────────────

test('drops : testeur seulement, premier passage = référence, blocs validés, objet unique, souvenir permanent', () => {
  const tester = newUser(), other = newUser();
  scheduledTest('drops_a', [nameOf(tester)], [item('da_any'), item('da_chest', { dropFrom: ['coffre'] }), item('da_deep', { minDepth: 500 })]);
  for (const u of [tester, other]) mine(u, 10, { pierre: 10 });

  // Premier passage : la progression d'avant (10 blocs) ne compte pas
  assert.deepStrictEqual(ev.processSave(tester, { rand: ALWAYS }), []);
  assert.deepStrictEqual(ev.processSave(other, { rand: ALWAYS }), [], 'non-testeur : rien');
  assert.deepStrictEqual(ev.publicView(other).active, [], 'non-testeur : événement invisible');

  mine(tester, 15, { pierre: 15 });
  mine(other, 15, { pierre: 15 });
  const got = ev.processSave(tester, { rand: ALWAYS });
  assert.deepStrictEqual(got.map(f => f.itemId), ['da_any'], 'pierre : ni coffre, ni objet trop profond');
  assert.deepStrictEqual(ev.processSave(other, { rand: ALWAYS }), []);

  // Pas de blocs validés nouveaux : aucun tirage (sauvegarde rejouée, faux compteurs)
  badges.processSave(tester, { stats: { minedByType: { pierre: 9999 } } });   // profondeur retenue inchangée : rien de crédité
  assert.deepStrictEqual(ev.processSave(tester, { rand: ALWAYS }), []);

  // Unicité : déjà possédé → jamais deux fois
  mine(tester, 20, { pierre: 20 });
  assert.deepStrictEqual(ev.processSave(tester, { rand: ALWAYS }), []);
  assert.strictEqual(db.getDb().prepare("SELECT COUNT(*) AS n FROM monthly_event_finds WHERE user_id = ? AND item_id = 'da_any'").get(tester).n, 1);

  // Fin de l'événement (dates dépassées) : plus de drop, souvenir conservé
  const after = Date.now() + 2 * HOUR;
  mine(tester, 25, { pierre: 20, coffre_bois: 5 });
  assert.deepStrictEqual(ev.processSave(tester, { rand: ALWAYS, nowMs: after }), []);
  const view = ev.publicView(tester, after);
  assert.deepStrictEqual(view.active, []);
  assert.strictEqual(view.souvenirs.length, 1);
  assert.deepStrictEqual(view.souvenirs[0].items.map(i => i.id), ['da_any']);
  assert.ok(view.souvenirs[0].items[0].found && view.souvenirs[0].items[0].names.fr);
});

test('drops : catégorie coffre, tirage raté puis réussi, retour en brouillon arrête tout sans rien retirer', () => {
  const u = newUser();
  scheduledTest('drops_b', [nameOf(u)], [item('db_chest', { dropFrom: ['coffre'] })]);
  mine(u, 5, { pierre: 5 });
  ev.processSave(u);
  const chestId = blockCatalog.getPublished().types.find(t => t.category === 'coffre');
  mine(u, 6, { pierre: 5, [chestId.id]: 1 });
  assert.deepStrictEqual(ev.processSave(u, { rand: NEVER }), [], 'tirage raté');
  mine(u, 7, { pierre: 5, [chestId.id]: 2 });
  assert.deepStrictEqual(ev.processSave(u, { rand: ALWAYS }).map(f => f.itemId), ['db_chest']);

  ev.unscheduleEvent('drops_b');
  assert.deepStrictEqual(ev.publicView(u).active.filter(e => e.id === 'drops_b'), []);
  assert.ok(ev.publicView(u).souvenirs.some(s => s.id === 'drops_b'), 'objet conservé après retour en brouillon');
  // Un objet trouvé ne peut plus être retiré de la fiche
  const e = ev.getEvent('drops_b');
  assert.throws(() => ev.updateEvent('drops_b', { ...e, items: [] }), /déjà trouvés/);
  ev.updateEvent('drops_b', { ...e, items: [{ ...e.items[0], enabled: false }] });
});

test('drops : rafale de blocs au-delà du plafond ignorée (curseur avancé, journal)', () => {
  const u = newUser();
  scheduledTest('drops_c', [nameOf(u)], [item('dc_any')]);
  mine(u, 1, { pierre: 1 });
  ev.processSave(u);
  const n = ev.MAX_BLOCKS_PER_SAVE + 10;
  mine(u, 1 + n, { pierre: 1 + n });
  assert.deepStrictEqual(ev.processSave(u, { rand: ALWAYS }), []);
  assert.ok(ev.listLog().some(l => l.eventId === 'drops_c' && l.action === 'skip_burst'));
  mine(u, 2 + n, { pierre: 2 + n });
  assert.strictEqual(ev.processSave(u, { rand: ALWAYS }).length, 1, 'ensuite, tirage normal');
});

test('nouvelle saison pendant l\'événement : souvenirs et curseur indépendants de la saison', () => {
  const u = newUser();
  scheduledTest('drops_d', [nameOf(u)], [item('dd_a'), item('dd_b', { minDepth: 30 })]);
  mine(u, 10, { pierre: 10 });
  ev.processSave(u);
  mine(u, 12, { pierre: 12 });
  assert.deepStrictEqual(ev.processSave(u, { rand: ALWAYS }).map(f => f.itemId), ['dd_a']);
  // Rotation : nouvelle saison active, profondeur retenue repart de zéro
  const old = season;
  db.updateSeason(old.id, { status: 'closed' });
  const nid = db.createSeason('Saison test 56', iso(Date.now() - HOUR), iso(Date.now() + 7 * 24 * HOUR), 'active');
  season = db.getActiveSeason();
  assert.notStrictEqual(season.id, old.id, String(nid));
  mine(u, 31, { pierre: 43 });
  assert.deepStrictEqual(ev.processSave(u, { rand: ALWAYS }).map(f => f.itemId), ['dd_b'], 'profondeur de la nouvelle saison');
  const v = ev.publicView(u);
  assert.deepStrictEqual(v.active.find(e => e.id === 'drops_d').items.filter(i => i.found).map(i => i.id), ['dd_a', 'dd_b']);
});

test('requêtes simultanées : INSERT OR IGNORE, un seul exemplaire', () => {
  const u = newUser();
  scheduledTest('drops_e', [nameOf(u)], [item('de_a')]);
  mine(u, season ? 1 : 1, { pierre: 100 });
  ev.processSave(u);
  // Deux curseurs « en retard » rejoués : la table des trouvailles garde un seul exemplaire
  db.getDb().prepare("INSERT OR IGNORE INTO monthly_event_finds (user_id, event_id, item_id, found_at) VALUES (?, 'drops_e', 'de_a', ?)").run(u, iso(Date.now()));
  db.getDb().prepare("INSERT OR IGNORE INTO monthly_event_finds (user_id, event_id, item_id, found_at) VALUES (?, 'drops_e', 'de_a', ?)").run(u, iso(Date.now()));
  assert.strictEqual(db.getDb().prepare("SELECT COUNT(*) AS n FROM monthly_event_finds WHERE user_id = ? AND event_id = 'drops_e'").get(u).n, 1);
});

// ── Révisions, redémarrage, contenu préparé ───────────────────────────────────

test('révisions : chaque écriture tracée, restauration en brouillon uniquement', () => {
  const later = Date.now() + 40 * 86_400_000;
  const base = { id: 'rev_a', names: tx('Rév'), startsAt: iso(later), endsAt: iso(later + HOUR), testers: ['x'], items: [item('ra_a', { chancePct: 1 })] };
  ev.createEvent(base);
  ev.updateEvent('rev_a', { ...base, items: [item('ra_a', { chancePct: 2 }), item('ra_b')] });
  const revs = ev.listRevisions('rev_a');
  assert.deepStrictEqual(revs.map(r => r.revision), [2, 1]);
  ev.scheduleEvent('rev_a');
  assert.throws(() => ev.restoreRevision('rev_a', 1), /brouillon/);
  ev.unscheduleEvent('rev_a');
  const r = ev.restoreRevision('rev_a', 1);
  assert.strictEqual(r.status, 'draft');
  assert.deepStrictEqual(r.items.map(i => [i.id, i.chancePct]), [['ra_a', 1]]);
  assert.strictEqual(r.revision, 5);
});

test('redémarrage : init idempotent, données conservées ; contenu préparé importé une seule fois', () => {
  const before = ev.listEvents().length;
  ev.init();
  assert.strictEqual(ev.listEvents().length, before);
  const tmp = fs.mkdtempSync(path.join(dir, 'prep-'));
  fs.copyFileSync(path.join(ROOT, 'server/content/events/noel-2026.json'), path.join(tmp, 'noel-2026.json'));
  assert.deepStrictEqual(ev.importPrepared(tmp), ['noel_2026']);
  assert.deepStrictEqual(ev.importPrepared(tmp), [], 'jamais réimporté');
  const noel = ev.getEvent('noel_2026');
  assert.strictEqual(noel.status, 'draft', 'Noël reste en brouillon : aucune publication sans le propriétaire');
  assert.strictEqual(noel.audience, 'public');
  assert.strictEqual(noel.startsAt, '2026-11-30T23:00:00Z');
  assert.strictEqual(noel.endsAt, '2026-12-31T23:00:00Z');
  assert.deepStrictEqual(ev.readiness(noel).blocking, [], 'Noël complet en 4 langues');
});

test('Noël 2026 : contenu préparé complet, humoristique, consignes d\'image distinctes', () => {
  const e = ev.normalizeEvent(NOEL);
  assert.ok(e.items.length >= 3 && e.items.length <= 6);
  const names = e.items.map(i => i.names.fr);
  for (const want of ['Clochette fêlée de renne', 'Bout de guirlande souterraine', 'Charbon du Père Noël']) assert.ok(names.includes(want), want);
  for (const it of NOEL.items) {
    for (const l of ev.LANGS) {
      assert.ok(it.names[l] && it.descs[l], `${it.id} ${l}`);
      assert.ok(it.descs[l].length <= 320, `${it.id} ${l} trop long`);
    }
    assert.ok(it.brief.length > 40);
  }
  assert.strictEqual(new Set(NOEL.items.map(i => i.brief)).size, NOEL.items.length);
  assert.strictEqual(new Set(NOEL.items.map(i => i.rarity)).size, NOEL.items.length, 'une rareté par objet');
  const sim = ev.simulate(e, { depth: 100, blocksPerDay: 300 });
  assert.strictEqual(sim.days, 31);
  for (const s of sim.items) assert.ok(s.perBlock > 0 && s.medianBlocks > 0 && s.chanceOverEvent > 0 && s.chanceOverEvent <= 100, s.id);
  const shallow = ev.simulate(e, { depth: 5 });
  assert.strictEqual(shallow.items.find(i => i.id === 'noel26_carte_traineau').chanceOverEvent, 0, 'trop profond à 5 m');
});

// ── Annonces #50 ──────────────────────────────────────────────────────────────

test('actualités : « Bientôt » à J-7 pour un événement public planifié, archivée s\'il repasse en brouillon', () => {
  const start = Date.now() + 3 * 86_400_000;
  ev.createEvent({ id: 'annonce_a', audience: 'public', icon: '🎊', names: tx('Fête'), taglines: tx('Accroche'), startsAt: iso(start), endsAt: iso(start + 5 * 86_400_000), items: [item('aa_a')] });
  ev.createEvent({ id: 'annonce_test', audience: 'test', testers: ['x'], names: tx('Secret'), startsAt: iso(start), endsAt: iso(start + HOUR), items: [item('at_a')] });
  ev.scheduleEvent('annonce_a', { confirmRates: true, confirmPublic: true });
  ev.scheduleEvent('annonce_test');
  news.sync(new Date());
  const keyed = k => db.getDb().prepare('SELECT status, category FROM news_items WHERE auto_key = ?').get(k);
  assert.deepStrictEqual({ ...keyed('event_next:annonce_a') }, { status: 'published', category: 'event' });
  assert.strictEqual(keyed('event_next:annonce_test'), undefined, 'événement TEST jamais annoncé');
  news.sync(new Date());
  assert.strictEqual(db.getDb().prepare("SELECT COUNT(*) AS n FROM news_items WHERE auto_key = 'event_next:annonce_a'").get().n, 1, 'pas de doublon');
  // Début : « a commencé »
  news.sync(new Date(start + HOUR));
  assert.strictEqual(keyed('event_start:annonce_a').status, 'published');
  ev.unscheduleEvent('annonce_a');
  news.sync(new Date(start + 2 * HOUR));
  assert.strictEqual(keyed('event_next:annonce_a').status, 'archived');
  assert.strictEqual(keyed('event_start:annonce_a').status, 'archived');
});

// ── Événement TEST et IA ──────────────────────────────────────────────────────

test('gabarit TEST : brouillon, 3 objets, testeurs ; IA factice : brouillon TEST, barème par défaut', async () => {
  const t = ev.createTestEvent({ testers: ['proprio'], minutes: 60 });
  assert.strictEqual(t.status, 'draft');
  assert.strictEqual(t.audience, 'test');
  assert.strictEqual(t.items.length, 3);
  assert.deepStrictEqual(t.testers, ['proprio']);
  assert.strictEqual(Date.parse(t.endsAt) - Date.parse(t.startsAt), 60 * 60_000);

  const { job, promise } = ev.startAiDraft({ concept: 'Carnaval de Binche', startsAt: '2027-01-28T00:00', endsAt: '2027-02-11T00:00', itemCount: 3 });
  assert.strictEqual(job.status, 'pending');
  await promise;
  const done = ev.getAiJob(job.id);
  assert.strictEqual(done.status, 'done', done.error);
  const e = ev.getEvent(done.eventId);
  assert.strictEqual(e.status, 'draft');
  assert.strictEqual(e.audience, 'test');
  assert.strictEqual(e.source, 'ai');
  assert.strictEqual(e.items.length, 3);
  assert.ok(e.items.every(i => i.chancePct > 0 && i.chancePct <= 1));
  assert.throws(() => ev.startAiDraft({ concept: 'x', startsAt: '2027-01-28T00:00', endsAt: '2027-02-11T00:00' }), /thème/);
});

// ── HTTP de bout en bout ──────────────────────────────────────────────────────

test('HTTP : admin protégé, événement TEST planifié, objet tiré à la sauvegarde, vue joueur, aucune pièce', async () => {
  const httpDb = path.join(dir, 'http.sqlite');
  const adminSecret = crypto.randomBytes(16).toString('hex');
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, NODE_ENV: 'test', SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: httpDb, ADMIN_SECRET: adminSecret, SESSION_SECRET: crypto.randomBytes(16).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', d => { log += d; });
  server.stderr.on('data', d => { log += d; });
  const admin = { Authorization: `Bearer ${adminSecret}`, 'Content-Type': 'application/json' };
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      try { await fetch(`${BASE}/api/version`); up = true; } catch (_) { await new Promise(r => setTimeout(r, 100)); }
    }
    assert.ok(up, log);
    assert.strictEqual((await fetch(`${BASE}/api/admin/events`)).status, 401);
    const guest = await (await fetch(`${BASE}/api/events`)).json();
    assert.deepStrictEqual(guest, { active: [], upcoming: [], souvenirs: [] });

    const reg = await fetch(`${BASE}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'evhttp', email: 'evhttp@example.invalid', password: 'secret123' }) });
    assert.strictEqual(reg.status, 200);
    const cookie = reg.headers.get('set-cookie').split(';')[0];

    const body = { id: 'http_test', audience: 'test', testers: ['EVHTTP'], names: tx('HTTP <b>'), taglines: tx('t'),
      startsAt: iso(Date.now() - HOUR), endsAt: iso(Date.now() + HOUR), items: [item('ht_sure', { chancePct: 100 })] };
    const cr = await fetch(`${BASE}/api/admin/events`, { method: 'POST', headers: admin, body: JSON.stringify(body) });
    assert.strictEqual(cr.status, 200, await cr.clone().text());
    const sim = await (await fetch(`${BASE}/api/admin/events/simulate`, { method: 'POST', headers: admin, body: JSON.stringify({ event: body, depth: 10 }) })).json();
    assert.strictEqual(sim.items[0].perBlock, 1);
    const sc = await fetch(`${BASE}/api/admin/events/http_test/schedule`, { method: 'POST', headers: admin, body: '{}' });
    assert.strictEqual(sc.status, 200, await sc.clone().text());
    const view = await (await fetch(`${BASE}/api/admin/events`, { headers: admin })).json();
    assert.strictEqual(view.events.find(e => e.id === 'http_test').state, 'active');
    assert.strictEqual(view.calendar.length, 2);

    const seasonId = (await (await fetch(`${BASE}/api/seasons/current`)).json()).season.id;
    const send = (ss, mined) => fetch(`${BASE}/api/me/save`, {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { coins: 10, lastSaveTime: Date.now(), stats: { minedByType: mined }, seasonStats: { seasonId, ...ss } } }),
    }).then(r => r.json());
    const r0 = await send({ maxDepth: 0, manualBlocks: 0, manualClicks: 0, autoBlocks: 0 }, {});
    assert.strictEqual(r0.eventFinds, undefined);
    await new Promise(r => setTimeout(r, 1100));
    const r1 = await send({ maxDepth: 4, manualBlocks: 3, manualClicks: 6, autoBlocks: 0 }, { terre_meuble: 3 });
    assert.deepStrictEqual((r1.eventFinds || []).map(f => f.itemId), ['ht_sure'], JSON.stringify(r1));
    const r2 = await send({ maxDepth: 4, manualBlocks: 3, manualClicks: 6, autoBlocks: 0 }, { terre_meuble: 3 });
    assert.strictEqual(r2.eventFinds, undefined, 'un seul exemplaire');

    const pv = await (await fetch(`${BASE}/api/events`, { headers: { Cookie: cookie } })).json();
    assert.strictEqual(pv.active[0].id, 'http_test');
    assert.ok(pv.active[0].test);
    assert.ok(pv.active[0].items[0].found);
    assert.strictEqual(pv.active[0].names.fr, 'HTTP b', 'chevrons retirés à l\'enregistrement');
    assert.deepStrictEqual((await (await fetch(`${BASE}/api/events`)).json()).active, [], 'invité : événement TEST invisible');

    const saved = await (await fetch(`${BASE}/api/me/save`, { headers: { Cookie: cookie } })).json();
    assert.strictEqual(saved.save.data.coins, 10, 'aucune pièce ajoutée');
    const un = await fetch(`${BASE}/api/admin/events/http_test/unschedule`, { method: 'POST', headers: admin, body: '{}' });
    assert.strictEqual(un.status, 200);
    const pv2 = await (await fetch(`${BASE}/api/events`, { headers: { Cookie: cookie } })).json();
    assert.deepStrictEqual(pv2.active, []);
    assert.strictEqual(pv2.souvenirs[0].items[0].id, 'ht_sure');
    const revs = await (await fetch(`${BASE}/api/admin/events/http_test/revisions`, { headers: admin })).json();
    assert.deepStrictEqual(revs.revisions.map(r => r.action), ['unschedule', 'schedule_test', 'create']);
  } finally {
    const done = new Promise(r => server.once('exit', r));
    server.kill();
    await done;
  }
});

test('client et admin : panneau Événements, toast, textes 4 langues, rendu échappé', () => {
  const main = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const adminHtml = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');
  const adminJs = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
  assert.match(html, /id="events-panel"/);
  assert.match(main, /eventFinds/);
  assert.match(main, /escapeHtml\(_badgeText\(ev\.names\)\)|escapeHtml\(title\)/);
  assert.match(adminHtml, /data-tab="events"/);
  assert.match(adminJs, /loadEvents\(\)/);
  assert.doesNotMatch(adminJs.slice(adminJs.indexOf('// ── Événements mensuels (#56)')), /innerHTML/, 'admin : DOM uniquement (#15)');
});
