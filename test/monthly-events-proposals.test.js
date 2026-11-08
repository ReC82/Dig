/**
 * Événements mensuels (#56) — recette #56-K du 08/11/2026 : souvenirs PROPOSÉS (ajoutés à un événement en
 * brouillon ou déjà planifié sans le repasser en brouillon, jamais tirés ni montrés avant « Publier les
 * propositions »), objectif éditorial distinct de l'état technique, alertes hiérarchisées, 26 propositions
 * de Noël importées une seule fois sans toucher aux 5 objets planifiés.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-events-prop-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');
process.env.DIG_AI_FAKE = '1';

const db           = require('../server/db');
const blockCatalog = require('../server/blockCatalog');
const badges       = require('../server/badges');
const ev           = require('../server/monthlyEvents');

const B = (local) => Date.parse(ev.brusselsToUtc(local));
const tx = s => ({ fr: s, en: `${s} EN`, nl: `${s} NL`, es: `${s} ES` });
const item = (id, extra = {}) => ({ id, icon: '🎁', rarity: 'commun', chancePct: 50, minDepth: 0, dropFrom: [], names: tx(`Objet ${id}`), descs: tx(`Desc ${id}`), ...extra });
const ALWAYS = () => 0;
let season, userSeq = 0;
const newUser = () => db.getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(`prop_user_${++userSeq}`, 'x').lastInsertRowid;
const PROPOSALS = path.join(__dirname, '..', 'server', 'content', 'event-proposals');
const EVENTS = path.join(__dirname, '..', 'server', 'content', 'events');

function mine(userId, n) {
  db.upsertDepthTracking(userId, { season_id: season.id, ref_clicks: 0, ref_auto: 0, hand_tokens: 0, auto_tokens: 0,
    accepted_depth: 100, last_gap: 0, updated_ms: Date.now(), dmg_depth: null, dmg_credit: null, dmg_ref_clicks: null, dmg_gap: 0 });
  const cur = badges.validatedStats(userId)['blocks:pierre'] ?? 0;
  badges.processSave(userId, { stats: { minedByType: { pierre: cur + n } } });
}

/** Événement public actif maintenant (planifié), 1 objet publié. */
function activeEvent(id) {
  const now = Date.now();
  ev.createEvent({ id, icon: '🎊', audience: 'public', names: tx(`Ev ${id}`), taglines: tx('Accroche'),
    startsAt: new Date(now + 60_000).toISOString(), endsAt: new Date(now + 3 * 86_400_000).toISOString(), items: [item(`${id}_a`, { chancePct: 0.001 })] });
  ev.scheduleEvent(id, { confirmRates: true, confirmPublic: true, nowMs: now });
  return id;
}

test.before(() => {
  db.initDb();
  blockCatalog.init();
  badges.init();
  require('../server/news').init();
  require('../server/blockAi').init();
  ev.init();
  season = db.getActiveSeason();
});

test.after(() => {
  db.getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('schéma : colonnes ajoutées (proposal, item_target), idempotent', () => {
  ev.init();
  const cols = db.getDb().prepare('PRAGMA table_info(monthly_event_items)').all().map(c => c.name);
  assert.ok(cols.includes('proposal'));
  assert.ok(db.getDb().prepare('PRAGMA table_info(monthly_events)').all().some(c => c.name === 'item_target'));
});

test('événement PLANIFIÉ et actif : « + Ajouter un souvenir » → proposition, statut inchangé, jamais tirée ni montrée', () => {
  const id = activeEvent('prop_actif');
  const before = ev.getEvent(id);
  const user = newUser();
  mine(user, 1);                                                  // curseur posé avant l'ajout
  const after = ev.addProposal(id, item('prop_actif_new', { chancePct: 100 }));
  assert.strictEqual(after.status, 'scheduled', 'pas repassé en brouillon');
  assert.strictEqual(after.startsAt, before.startsAt);
  assert.strictEqual(after.items.find(i => i.id === 'prop_actif_a').chancePct, 0.001, 'objet publié inchangé');
  assert.strictEqual(after.items.find(i => i.id === 'prop_actif_new').proposal, true);
  const nowMs = Date.now() + 120_000;
  mine(user, 50);
  const got = ev.processSave(user, { nowMs, rand: ALWAYS });
  assert.ok(!got.some(g => g.itemId === 'prop_actif_new'), 'proposition jamais tirée');
  const pv = ev.publicView(user, nowMs).active.find(e => e.id === id);
  assert.ok(pv && !pv.items.some(i => i.id === 'prop_actif_new'), 'proposition invisible des joueurs');
  assert.ok(ev.readiness(after).ready, 'les propositions ne comptent pas dans la vérification');
  // Mise à jour et retrait d'une proposition ; un objet publié reste figé
  ev.updateProposal(id, 'prop_actif_new', item('prop_actif_new', { chancePct: 0.2 }));
  assert.strictEqual(ev.getEvent(id).items.find(i => i.id === 'prop_actif_new').chancePct, 0.2);
  assert.throws(() => ev.updateProposal(id, 'prop_actif_a', item('prop_actif_a')), e => e.status === 409);
  assert.throws(() => ev.addProposal(id, item('prop_actif_a')), e => e.status === 409, 'identifiant déjà pris');
  ev.removeProposal(id, 'prop_actif_new');
  assert.ok(!ev.getEvent(id).items.some(i => i.id === 'prop_actif_new'));
  assert.throws(() => ev.removeProposal(id, 'prop_actif_a'), e => e.status === 409);
});

test('publication des propositions : barème confirmé, textes complets, atomique, journalisée ; retour arrière tant que non trouvé', () => {
  const id = activeEvent('prop_pub');
  ev.addProposal(id, item('prop_pub_b', { chancePct: 100 }));
  ev.addProposal(id, { ...item('prop_pub_c'), names: { fr: 'Incomplet' }, descs: { fr: 'x' } });
  assert.throws(() => ev.publishProposals(id, { itemIds: ['prop_pub_b'] }), e => e.status === 409 && /barème/.test(e.message));
  assert.throws(() => ev.publishProposals(id, { itemIds: ['prop_pub_b', 'prop_pub_c'], confirmRates: true }), e => e.status === 409 && /EN manquant/.test(e.message));
  assert.strictEqual(ev.getEvent(id).items.find(i => i.id === 'prop_pub_b').proposal, true, 'échec : rien de publié (atomique)');
  const rev = ev.getEvent(id).revision;
  const r = ev.publishProposals(id, { itemIds: ['prop_pub_b'], confirmRates: true });
  assert.deepStrictEqual(r.published, ['prop_pub_b']);
  assert.strictEqual(r.event.status, 'scheduled');
  assert.strictEqual(r.event.revision, rev + 1);
  assert.ok(ev.listLog(10).some(l => l.action === 'proposals_published' && l.details.revisionBefore === rev));
  // Retour arrière possible avant toute trouvaille
  ev.unpublishProposals(id, { itemIds: ['prop_pub_b'] });
  assert.strictEqual(ev.getEvent(id).items.find(i => i.id === 'prop_pub_b').proposal, true);
  ev.publishProposals(id, { itemIds: ['prop_pub_b'], confirmRates: true });
  const user = newUser();
  mine(user, 1);
  const nowMs = Date.now() + 120_000;
  ev.processSave(user, { nowMs, rand: ALWAYS });
  mine(user, 5);
  const got = ev.processSave(user, { nowMs, rand: ALWAYS });
  assert.ok(got.some(g => g.itemId === 'prop_pub_b'), 'publié : tiré comme les autres');
  assert.throws(() => ev.unpublishProposals(id, { itemIds: ['prop_pub_b'] }), e => e.status === 409 && /déjà été trouvé/.test(e.message));
  assert.throws(() => ev.unpublishProposals(id, { itemIds: ['prop_pub_a', 'prop_pub_b'] }), e => e.status === 409);
});

test('brouillon : proposition conservée à l\'enregistrement (jamais publiée en douce), planification sans elle', () => {
  const b = ev.monthBounds(2027, 2);
  ev.createEvent({ id: 'prop_draft', icon: '🎊', audience: 'public', names: tx('Février'), taglines: tx('A'), startsAt: b.startsAt, endsAt: b.endsAt, items: [item('prop_draft_a')] });
  ev.addProposal('prop_draft', item('prop_draft_p'));
  const cur = ev.getEvent('prop_draft');
  ev.updateEvent('prop_draft', { ...cur, items: cur.items.map(i => ({ ...i, proposal: false })) });
  assert.strictEqual(ev.getEvent('prop_draft').items.find(i => i.id === 'prop_draft_p').proposal, true, 'état serveur conservé');
  ev.updateEvent('prop_draft', { ...cur, items: [...cur.items, { ...item('prop_draft_new'), proposal: true }] });
  assert.strictEqual(ev.getEvent('prop_draft').items.find(i => i.id === 'prop_draft_new').proposal, true);
  const s = ev.scheduleEvent('prop_draft', { confirmRates: true, confirmPublic: true });
  assert.strictEqual(s.items.filter(i => i.proposal).length, 2, 'propositions toujours en attente après planification');
});

test('préparation éditoriale : objectif, « Contenu à compléter », alertes manquants / admissibles, état technique « Planifié » distinct', () => {
  const b = ev.monthBounds(2027, 4);
  ev.createEvent({ id: 'prop_target', icon: '🎊', audience: 'public', names: tx('Avril'), taglines: tx('A'), startsAt: b.startsAt, endsAt: b.endsAt,
    items: [item('prop_target_a'), item('prop_target_b')], itemTarget: 30 });
  ev.addProposal('prop_target', item('prop_target_p'));
  ev.scheduleEvent('prop_target', { confirmRates: true, confirmPublic: true });
  const c = ev.contentChecks(ev.getEvent('prop_target'));
  assert.deepStrictEqual([c.target, c.published, c.proposals, c.complete, c.label], [30, 2, 1, false, '2 préparé(s) / objectif 30']);
  assert.match(c.missing[0], /Contenu à compléter : 2 souvenir\(s\) publié\(s\) \/ objectif 30 — 1 proposition\(s\) à valider/);
  assert.ok(c.missing.some(x => /« Pourquoi cet objet \? » sans source vérifiée/.test(x)));
  assert.ok(c.acceptable.some(x => /affichent leur emoji \(non bloquant\)/.test(x)), 'emoji : admissible, pas manquant');
  assert.ok(!c.missing.some(x => /emoji/.test(x)));
  const m = ev.monthStatus(2027, 4, B('2027-03-20T12:00'));
  assert.deepStrictEqual([m.state, m.stateLabel], ['planned', 'Planifié']);
  assert.strictEqual(m.content.complete, false);
  assert.deepStrictEqual([m.counts.items, m.counts.proposals, m.counts.target], [2, 1, 30]);
  assert.ok(m.missing.length && m.acceptable.length && m.warnings.length === m.missing.length + m.acceptable.length);
  const p = ev.preparation(B('2027-03-20T12:00'));
  assert.match(p.headline, /planifié, actif automatiquement .* Contenu à compléter : 2 préparé\(s\) \/ objectif 30, 1 proposition\(s\) à valider/);
  assert.strictEqual(p.level, 'ok', 'état technique inchangé');
  assert.strictEqual(p.following.label, 'mai 2027');
  assert.strictEqual(p.following.state, 'absent');
  // Objectif modifiable dans tous les états, sans toucher aux drops
  const rev = ev.getEvent('prop_target').revision;
  ev.setItemTarget('prop_target', 2);
  assert.strictEqual(ev.getEvent('prop_target').revision, rev, 'objectif : pas de nouvelle révision des drops');
  assert.throws(() => ev.setItemTarget('prop_target', 99), e => e.status === 400);
});

test('Noël 2026 : 26 propositions importées une seule fois, 5 objets planifiés intacts, objectif 31, transition de décembre', () => {
  ev.importPrepared(EVENTS);
  ev.applyOwnerDecisions(ev.OWNER_DECISIONS, B('2026-11-08T16:00'));
  // Base neuve : novembre (révision différente de la décision) planifié ici comme en production
  const nov = ev.getEvent('novembre_histoire_2026'), nb = ev.monthBounds(2026, 11);
  ev.updateEvent(nov.id, { ...nov, startsAt: nb.startsAt, endsAt: nb.endsAt });
  ev.scheduleEvent(nov.id, { confirmRates: true, confirmPublic: true, nowMs: B('2026-10-20T12:00') });
  const before = ev.getEvent('noel_2026');
  assert.strictEqual(before.status, 'scheduled');
  assert.strictEqual(before.items.length, 5);
  const done = ev.importProposals(PROPOSALS);
  assert.ok(done.some(d => d.eventId === 'noel_2026' && d.added === 26));
  const after = ev.getEvent('noel_2026');
  assert.strictEqual(after.status, 'scheduled', 'toujours planifié');
  assert.deepStrictEqual([after.startsAt, after.endsAt], [before.startsAt, before.endsAt]);
  assert.strictEqual(after.itemTarget, 31);
  assert.deepStrictEqual(after.items.filter(i => !i.proposal).map(({ proposal, ...i }) => i), before.items.map(({ proposal, ...i }) => i), '5 objets planifiés : chances, profondeurs, textes inchangés');
  const props = after.items.filter(i => i.proposal);
  assert.strictEqual(props.length, 26);
  assert.ok(props.every(i => ev.proposalBlocking(i).length === 0), 'textes FR/EN/NL/ES complets');
  assert.strictEqual(new Set(after.items.map(i => i.refDate).filter(Boolean)).size, 26, 'une date de référence par proposition');
  assert.strictEqual(ev.importProposals(PROPOSALS).length, 0, 'jamais rejoué');
  // Décembre : 5 préparés / objectif 31, contenu à compléter ; bascule inchangée
  const m = ev.monthStatus(2026, 12, B('2026-11-08T16:00'));
  assert.strictEqual(m.content.label, '5 préparé(s) / objectif 31');
  assert.strictEqual(m.content.proposals, 26);
  const tr = ev.transitionPreview(2026, 12);
  const at = l => tr.find(t => t.local === l).active;
  assert.deepStrictEqual(at('2026-11-30T23:59:59'), ['novembre_histoire_2026']);
  assert.deepStrictEqual(at('2026-12-01T00:00:00'), []);
  assert.deepStrictEqual(at('2026-12-01T00:01:00'), ['noel_2026']);
  assert.strictEqual(ev.preparation(B('2026-11-08T16:00')).following.state, 'absent', 'janvier 2027 : rien d\'inventé');
  // Aucun drop des propositions en décembre
  const user = newUser();
  const dec = B('2026-12-10T12:00');
  mine(user, 1); ev.processSave(user, { nowMs: dec, rand: ALWAYS });
  mine(user, 30);
  const got = ev.processSave(user, { nowMs: dec, rand: ALWAYS });
  assert.ok(got.length && got.every(g => !props.some(p => p.id === g.itemId)), 'seuls les 5 objets planifiés tombent');
});

test('panel : bouton « Tester le passage au mois suivant », « ＋ Nouvel événement », « ＋ Ajouter un souvenir », routes des propositions', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public', 'admin', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'public', 'admin', 'admin.js'), 'utf8');
  const srv = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');
  assert.match(html, /<button class="btn btn-primary" type="button" id="btn-ev-transition">🧪 Tester le passage au mois suivant<\/button>/);
  assert.match(html, /<dialog id="ev-transition-dialog"[\s\S]*Simulation en lecture seule/);
  assert.doesNotMatch(html, /<details class="ev-prep-sim">\s*<summary>⏱ Aperçu d'un changement de mois/, 'plus de ligne repliée discrète');
  assert.match(html, /id="btn-ev-add"[^>]*>＋ Nouvel événement</);
  assert.match(html, /id="btn-ev-item-add" type="button">＋ Ajouter un souvenir</);
  assert.match(html, /Bonus des souvenirs : aucun bonus défini ni actif/);
  for (const r of ["'/api/admin/events/:id/proposals'", "'/api/admin/events/:id/proposals/:itemId'", "'/api/admin/events/:id/proposals-publish'",
    "'/api/admin/events/:id/proposals-unpublish'", "'/api/admin/events/:id/target'"]) assert.ok(srv.includes(r), r);
  assert.match(js, /'proposals-publish'[\s\S]{0,200}confirmRates: true/);
  assert.match(js, /cb\('＋ Ajouter un objet'/, 'calendrier : action directe');
  assert.match(js, /cb\('👁 Voir ses objets'/);
  assert.ok(srv.indexOf('monthlyEvents.applyOwnerDecisions()') < srv.indexOf('monthlyEvents.importProposals()'), 'décisions avant import des propositions');
});
