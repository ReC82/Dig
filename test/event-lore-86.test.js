/**
 * Tests du ticket #86 (recette du propriétaire du 08/11/2026) — « Pourquoi cet objet ? » :
 * explication factuelle FR/EN/NL/ES, date historique et source HTTPS pour chaque souvenir de
 * novembre ; table à part (modifiable quand l'événement est planifié, sans effet sur les drops ni
 * sur les révisions) ; envoyée au joueur seulement après découverte et si vérifiée ; import des
 * explications préparées sans jamais écraser une saisie admin ; confirmation de publication lisible.
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-lore86-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db           = require('../server/db');
const blockCatalog = require('../server/blockCatalog');
const badges       = require('../server/badges');
const ev           = require('../server/monthlyEvents');

const NOV = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/content/events/novembre-histoire-2026.json'), 'utf8'));
const LORE_FILE = path.join(ROOT, 'server/content/event-lore/novembre_histoire_2026.json');
const LORE = JSON.parse(fs.readFileSync(LORE_FILE, 'utf8'));
const LANGS = ['fr', 'en', 'nl', 'es'];
const EID = 'novembre_histoire_2026';
const BRICK = 'nov26_09_brique_liberte';
let season, uid;

test.before(() => {
  db.initDb();
  blockCatalog.init();
  badges.init();
  ev.init();
  season = db.getActiveSeason();
  ev.createEvent(NOV, { source: 'prepared' });
  uid = db.getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('lore86_joueur', 'x').lastInsertRowid;
});

test.after(() => {
  db.getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('contenu : 30 explications vérifiées, 4 langues, 1 à 3 phrases, source HTTPS Wikipédia/UNESCO, date cohérente', () => {
  assert.strictEqual(LORE.eventId, EID);
  const ids = NOV.items.map(i => i.id);
  assert.deepStrictEqual(Object.keys(LORE.items).sort(), [...ids].sort(), 'une explication par objet, aucune en trop');
  for (const it of NOV.items) {
    const l = ev.normalizeLore(LORE.items[it.id], it.id);
    assert.strictEqual(l.verified, true, `${it.id} vérifiée`);
    for (const lang of LANGS) {
      const n = (l.explains[lang].match(/[.!?](\s|$)/g) ?? []).length;
      assert.ok(n >= 1 && n <= 3, `${it.id} ${lang} : 1 à 3 phrases (${n})`);
    }
    const u = new URL(l.sourceUrl);
    assert.strictEqual(u.protocol, 'https:');
    assert.match(u.hostname, /^(fr|en)\.wikipedia\.org$|^www\.unesco\.org$/, `${it.id} : source connue`);
    assert.ok(l.sourceTitle.length > 5);
    // Date historique : même jour que la date de référence, sauf la Sixtine (inaugurée le 31/10, la veille de la Toussaint)
    const md = l.historicDate.slice(-5);
    if (it.id === 'nov26_01_echelle_michel_ange') assert.strictEqual(l.historicDate, '1512-10-31');
    else assert.strictEqual(md, it.refDate, `${it.id} : ${l.historicDate} ↔ ${it.refDate}`);
    // L'année citée dans l'inspiration admin se retrouve dans la date historique (pas de date inventée)
    const y = /^(\d{4})-/.exec(l.historicDate)?.[1];
    if (y) assert.ok(it.inspiration.includes(y), `${it.id} : année ${y} présente dans l'inspiration`);
  }
  // Exemple du propriétaire : Élisabeth Ire, 17 novembre 1558, lien vers la page de la reine
  const eli = LORE.items.nov26_17_couronne_elisabeth;
  assert.strictEqual(eli.historicDate, '1558-11-17');
  assert.match(eli.explains.fr, /17 novembre 1558/);
  assert.match(decodeURIComponent(eli.sourceUrl), /wiki\/Élisabeth_Ire_\(reine_d'Angleterre\)$/);
});

test('validation : https seulement, date AAAA-MM-JJ ou MM-JJ, « vérifiée » exige les 4 langues et la source', () => {
  const ok = { explains: { fr: 'a.', en: 'b.', nl: 'c.', es: 'd.' }, historicDate: '1989-11-09', sourceUrl: 'https://fr.wikipedia.org/wiki/X', sourceTitle: 'Wikipédia — X', verified: true };
  assert.strictEqual(ev.normalizeLore(ok).verified, true);
  assert.strictEqual(ev.normalizeLore({ ...ok, historicDate: '11-13' }).historicDate, '11-13');
  for (const bad of ['http://fr.wikipedia.org/wiki/X', 'javascript:alert(1)', 'https://user:pw@example.com/x', 'https://exa mple.com', 'data:text/html,x', '//fr.wikipedia.org/x']) {
    assert.throws(() => ev.normalizeLore({ ...ok, sourceUrl: bad }), e => e.status === 400, bad);
  }
  assert.throws(() => ev.normalizeLore({ ...ok, historicDate: '09/11/1989' }), e => e.status === 400);
  assert.throws(() => ev.normalizeLore({ ...ok, explains: { fr: 'a.' } }), /NL|EN/);
  assert.throws(() => ev.normalizeLore({ ...ok, sourceUrl: '' }), e => e.status === 400);
  // Brouillon : incomplet admis, jamais montré au joueur
  assert.strictEqual(ev.normalizeLore({ explains: { fr: 'à finir' } }).verified, false);
  assert.strictEqual(ev.normalizeLore({ explains: { fr: '<b>x</b>' } }).explains.fr, 'bx/b', 'aucun HTML');
});

test('import : 30 explications ajoutées une fois, une saisie admin n\'est jamais écrasée', () => {
  const tmp = fs.mkdtempSync(path.join(dir, 'lore-'));
  fs.copyFileSync(LORE_FILE, path.join(tmp, 'novembre_histoire_2026.json'));
  assert.strictEqual(ev.importLore(tmp), 30);
  assert.strictEqual(ev.importLore(tmp), 0, 'idempotent');
  ev.setItemLore(EID, BRICK, { ...LORE.items[BRICK], explains: { ...LORE.items[BRICK].explains, fr: 'Texte corrigé par l\'admin.' } });
  db.getDb().prepare('DELETE FROM monthly_event_item_lore WHERE event_id = ? AND item_id = ?').run(EID, 'nov26_30_noeud_churchill');
  assert.strictEqual(ev.importLore(tmp), 1, 'seul l\'objet sans explication est complété');
  assert.strictEqual(ev.getLore(EID)[BRICK].explains.fr, 'Texte corrigé par l\'admin.');
  const r = ev.loreReadiness(ev.getEvent(EID));
  assert.deepStrictEqual([r.verified, r.total, r.missing.length], [30, 30, 0]);
  // Événement inconnu ou objet absent : ignoré sans erreur
  fs.writeFileSync(path.join(tmp, 'zz.json'), JSON.stringify({ eventId: 'absent_99', items: { x: {} } }));
  assert.strictEqual(ev.importLore(tmp), 0);
});

test('événement planifié : explication modifiable sans révision ni effet sur la fiche ; objet inconnu refusé', () => {
  ev.scheduleEvent(EID, { confirmRates: true, confirmPublic: true, confirmElapsed: true, nowMs: Date.parse('2026-11-08T15:10:00Z') });
  const before = ev.getEvent(EID);
  assert.strictEqual(before.status, 'scheduled');
  const l = ev.setItemLore(EID, BRICK, { ...LORE.items[BRICK] });
  assert.strictEqual(l.verified, true);
  const after = ev.getEvent(EID);
  assert.strictEqual(after.status, 'scheduled', 'toujours planifié : les drops continuent');
  assert.strictEqual(after.revision, before.revision, 'aucune révision : la fiche n\'est pas réécrite');
  assert.deepStrictEqual(after.items, before.items);
  assert.throws(() => ev.setItemLore(EID, 'nov26_99_inconnu', LORE.items[BRICK]), e => e.status === 404);
  assert.throws(() => ev.setItemLore('absent_99', BRICK, LORE.items[BRICK]), e => e.status === 404);
  assert.ok(db.getDb().prepare("SELECT 1 FROM monthly_event_log WHERE event_id = ? AND action = 'lore_update'").get(EID), 'journalisé');
  // Repasser en brouillon puis modifier la fiche ne supprime pas les explications
  ev.unscheduleEvent(EID);
  ev.updateEvent(EID, { ...NOV, names: { ...NOV.names, fr: 'Titre modifié' } });
  assert.strictEqual(Object.keys(ev.getLore(EID)).length, 30);
  ev.scheduleEvent(EID, { confirmRates: true, confirmPublic: true, confirmElapsed: true, nowMs: Date.parse('2026-11-08T15:10:00Z') });
});

test('vue joueur : rien avant découverte ; après, explication vérifiée seulement, jamais l\'inspiration admin', () => {
  const mid = Date.parse('2026-11-15T12:00:00Z');
  const t0 = JSON.stringify(ev.publicView(uid, mid));
  assert.ok(t0.includes(EID), 'événement actif visible');
  assert.ok(!t0.includes('Gimnasio') && !t0.includes('wikipedia') && !t0.includes('Pourquoi'), 'aucune explication ni source avant découverte');
  const act = ev.publicView(uid, mid).active.find(e => e.id === EID);
  assert.strictEqual(act.items.length, 30);
  assert.ok(act.items.every(i => !i.found && i.lore === undefined && i.names === undefined));

  db.getDb().prepare('INSERT INTO monthly_event_finds (user_id, event_id, item_id, found_at) VALUES (?, ?, ?, ?)').run(uid, EID, BRICK, '2026-11-09T10:00:00Z');
  db.getDb().prepare('INSERT INTO monthly_event_finds (user_id, event_id, item_id, found_at) VALUES (?, ?, ?, ?)').run(uid, EID, 'nov26_29_ballon_1899', '2026-11-09T10:00:00Z');
  ev.setItemLore(EID, 'nov26_29_ballon_1899', { ...LORE.items.nov26_29_ballon_1899, verified: false });
  const items = ev.publicView(uid, mid).active.find(e => e.id === EID).items;
  const brick = items.find(i => i.id === BRICK);
  assert.strictEqual(brick.found, true);
  assert.deepStrictEqual(Object.keys(brick.lore).sort(), ['explains', 'historicDate', 'sourceTitle', 'sourceUrl']);
  assert.strictEqual(brick.lore.historicDate, '1989-11-09');
  assert.match(brick.lore.sourceUrl, /^https:\/\/fr\.wikipedia\.org\/wiki\/Chute_du_mur_de_Berlin$/);
  assert.strictEqual(brick.inspiration, undefined);
  assert.strictEqual(brick.refDate, undefined);
  assert.strictEqual(items.find(i => i.id === 'nov26_29_ballon_1899').lore, undefined, 'non vérifiée : invisible');
  const others = items.filter(i => !i.found);
  assert.strictEqual(others.length, 28);
  assert.ok(others.every(i => i.lore === undefined));
  // Après la fin de l'événement : le souvenir garde son explication
  const sv = ev.publicView(uid, Date.parse('2026-12-05T12:00:00Z')).souvenirs.find(s => s.id === EID);
  assert.ok(sv.items.find(i => i.id === BRICK).lore);
});

test('aucun effet sur les drops : le tirage ignore les explications', () => {
  db.upsertDepthTracking(uid, { season_id: season.id, ref_clicks: 0, ref_auto: 0, hand_tokens: 0, auto_tokens: 0,
    accepted_depth: 80, last_gap: 0, updated_ms: Date.now(), dmg_depth: null, dmg_credit: null, dmg_ref_clicks: null, dmg_gap: 0 });
  const mid = Date.parse('2026-11-15T12:00:00Z');
  badges.processSave(uid, { stats: { minedByType: { terre: 10, pierre: 10 } } });
  ev.processSave(uid, { nowMs: mid, rand: () => 0.999999 });   // curseur
  badges.processSave(uid, { stats: { minedByType: { terre: 60, pierre: 60 } } });
  const out = ev.processSave(uid, { nowMs: mid, rand: () => 0.999999 });
  assert.deepStrictEqual(out, [], 'tirage défavorable : rien');
  assert.ok(out.every(x => x.lore === undefined));
});

test('migration : table ajoutée, init idempotent, explications conservées', () => {
  const n = db.getDb().prepare('SELECT COUNT(*) n FROM monthly_event_item_lore').get().n;
  ev.init();
  ev.init();
  assert.strictEqual(db.getDb().prepare('SELECT COUNT(*) n FROM monthly_event_item_lore').get().n, n);
});

test('panel et jeu : confirmation lisible (résumé + tableau replié), champs d\'explication, lien sûr côté joueur', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
  for (const id of ['evi-lore-fs', 'evi-lore-text', 'evi-lore-date', 'evi-lore-url', 'evi-lore-title', 'evi-lore-verified', 'btn-evi-lore-save']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(js, /details = null \}\) \{/, 'admConfirm accepte un tableau repliable');
  assert.match(js, /det\.open = false;/, 'tableau fermé par défaut');
  assert.match(js, /Aucun bonus : ni bonus permanent, ni bonus temporaire/);
  assert.match(js, /sans attribution rétroactive/);
  assert.match(js, /les souvenirs déjà trouvés restent acquis/);
  assert.match(js, /Étape 1 sur 2/);
  assert.match(js, /api\('PUT', `\/api\/admin\/events\/\$\{encodeURIComponent\(ev\.id\)\}\/items\/\$\{encodeURIComponent\(it\.id\)\}\/lore`/);
  assert.ok(!/ev-items[\s\S]{0,200}innerHTML/.test(js));
  const main = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
  assert.match(main, /a\.rel = 'noopener noreferrer nofollow';/);
  assert.match(main, /\/\^https:\\\/\\\/\[\^\\s\]\+\$\/\.test\(lore\.sourceUrl/);
  assert.match(main, /lore: it\.found \? it\.lore : null/);
  const idx = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(idx.includes('id="find-modal-lore"'));
  const i18n = fs.readFileSync(path.join(ROOT, 'public/js/i18n.js'), 'utf8');
  assert.strictEqual((i18n.match(/lore_title:/g) ?? []).length, 4, 'FR/EN/NL/ES');
  const srv = fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8');
  assert.match(srv, /app\.put\('\/api\/admin\/events\/:id\/items\/:itemId\/lore', requireAdmin,/);
});
