/**
 * Événements mensuels (#56) — transition automatique de mois (décisions du propriétaire du 08/11/2026) :
 * un événement mensuel public = un mois civil entier, début INCLUS le 1er à 00:01 et fin EXCLUE le 1er
 * du mois suivant à 00:00 (heure de Bruxelles). Horloge simulée 30/11 23:59:59 → 01/12 00:00 (aucun
 * événement) → 00:01 (décembre seul), 31/12 → 01/01, 2028 bissextile, heure d'été/hiver, redémarrage,
 * décisions écrites appliquées une seule fois, tableau « Préparation du mois prochain » (états, tâches
 * bloquantes, rappels J-14/J-7/J-1), calendrier annuel, souvenirs conservés. Base temporaire.
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-events-month-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');
process.env.DIG_AI_FAKE = '1';

const db           = require('../server/db');
const blockCatalog = require('../server/blockCatalog');
const badges       = require('../server/badges');
const ev           = require('../server/monthlyEvents');

const B = (local) => Date.parse(ev.brusselsToUtc(local));      // « AAAA-MM-JJTHH:MM » Bruxelles → ms
const tx = s => ({ fr: s, en: `${s} EN`, nl: `${s} NL`, es: `${s} ES` });
const item = (id, extra = {}) => ({ id, icon: '🎁', rarity: 'commun', chancePct: 50, minDepth: 0, dropFrom: [], names: tx(`Objet ${id}`), descs: tx(`Desc ${id}`), ...extra });
const ALWAYS = () => 0;
let season, userSeq = 0;
const newUser = () => db.getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(`month_user_${++userSeq}`, 'x').lastInsertRowid;

function mine(userId, depth, minedByType) {
  db.upsertDepthTracking(userId, { season_id: season.id, ref_clicks: 0, ref_auto: 0, hand_tokens: 0, auto_tokens: 0,
    accepted_depth: depth, last_gap: 0, updated_ms: Date.now(), dmg_depth: null, dmg_credit: null, dmg_ref_clicks: null, dmg_gap: 0 });
  badges.processSave(userId, { stats: { minedByType } });
}

/** Brouillon public d'un mois (dates du mois civil, mais au format historique 00:00 comme Noël préparé). */
function draftMonth(id, year, month, items = [item(`${id}_a`)]) {
  const b = ev.monthBounds(year, month);
  return ev.createEvent({ id, icon: '🎊', audience: 'public', names: tx(`Mois ${id}`), taglines: tx('Accroche'), startsAt: b.monthStartAt, endsAt: b.endsAt, items });
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

test('bornes du mois civil : 1er 00:01 inclus → 1er suivant 00:00 exclu, 28/29/30/31 jours, heure d\'été/hiver, changement d\'année', () => {
  const nov = ev.monthBounds(2026, 11);
  assert.deepStrictEqual([nov.startsLocal, nov.endsLocal, nov.startsAt, nov.endsAt, nov.days], ['2026-11-01T00:01', '2026-12-01T00:00', '2026-10-31T23:01:00Z', '2026-11-30T23:00:00Z', 30]);
  const dec = ev.monthBounds(2026, 12);
  assert.deepStrictEqual([dec.endsLocal, dec.endsAt, dec.days], ['2027-01-01T00:00', '2026-12-31T23:00:00Z', 31]);
  assert.strictEqual(ev.monthBounds(2027, 2).days, 28);
  const feb28 = ev.monthBounds(2028, 2);
  assert.deepStrictEqual([feb28.days, feb28.endsAt], [29, '2028-02-29T23:00:00Z'], '2028 bissextile : le 29/02 est couvert');
  // Heure d'été (dernier dimanche de mars) : mars commence en UTC+1 et se termine en UTC+2
  const mar = ev.monthBounds(2027, 3);
  assert.deepStrictEqual([mar.startsAt, mar.endsAt], ['2027-02-28T23:01:00Z', '2027-03-31T22:00:00Z']);
  // Heure d'hiver (dernier dimanche d'octobre) : octobre commence en UTC+2 et se termine en UTC+1
  const oct = ev.monthBounds(2027, 10);
  assert.deepStrictEqual([oct.startsAt, oct.endsAt], ['2027-09-30T22:01:00Z', '2027-10-31T23:00:00Z']);
  // Mois consécutifs : la fin de l'un est le 1er 00:00, le début du suivant 00:01 (une minute sans événement, jamais de chevauchement)
  for (let y = 2026; y <= 2028; y++) for (let m = 1; m <= 12; m++) {
    const a = ev.monthBounds(y, m), b = ev.monthBounds(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1);
    assert.strictEqual(Date.parse(b.startsAt) - Date.parse(a.endsAt), 60_000, `${y}-${m}`);
    assert.strictEqual(b.monthStartAt, a.endsAt);
  }
  assert.match(ev.frRange(dec.startsAt, dec.endsAt), /^du 1er décembre 2026 à 00 h 01 au 31 décembre 2026 à 23 h 59, heure de Bruxelles$/);
  assert.doesNotMatch(ev.frRange(dec.startsAt, dec.endsAt), /minuit/);
});

test('décisions écrites : planification au mois entier une seule fois, contrôles de « Planifier », jamais rejouée ni forcée', () => {
  const now = B('2026-11-08T16:00');
  draftMonth('nov_t', 2026, 11);
  draftMonth('dec_t', 2026, 12);
  draftMonth('jan_t', 2027, 1, []);                       // 0 objet : incomplet
  draftMonth('oct_t', 2026, 10);                          // mois terminé
  ev.setItemImage('dec_t', 'dec_t_a', '/media/icons/0123456789abcdef.webp');   // image conservée dans la fiche
  const list = [
    { id: 't-nov', eventId: 'nov_t', revision: 1, year: 2026, month: 11 },
    { id: 't-dec', eventId: 'dec_t', revision: 2, year: 2026, month: 12 },
    { id: 't-jan', eventId: 'jan_t', revision: 1, year: 2027, month: 1 },
    { id: 't-oct', eventId: 'oct_t', revision: 1, year: 2026, month: 10 },
    { id: 't-absent', eventId: 'nexiste_pas', revision: 1, year: 2027, month: 2 },
    { id: 't-modifie', eventId: 'nov_t', revision: 1, year: 2026, month: 11 },
  ];
  const out = ev.applyOwnerDecisions(list.slice(0, 5), now);
  assert.deepStrictEqual(out.map(o => [o.decision, o.outcome]), [['t-nov', 'applied'], ['t-dec', 'applied'], ['t-jan', 'skipped'], ['t-oct', 'skipped'], ['t-absent', 'skipped']]);
  assert.match(out[2].reason, /incomplète/);
  assert.match(out[3].reason, /terminé/);
  for (const [id, y, m] of [['nov_t', 2026, 11], ['dec_t', 2026, 12]]) {
    const e = ev.getEvent(id, now), b = ev.monthBounds(y, m);
    assert.deepStrictEqual([e.status, e.startsAt, e.endsAt], ['scheduled', b.startsAt, b.endsAt], id);
    assert.ok(ev.isFullMonth(e));
  }
  assert.strictEqual(ev.getEvent('nov_t', now).state, 'active');
  assert.strictEqual(ev.getEvent('dec_t', now).state, 'planned');
  assert.strictEqual(ev.getEvent('dec_t', now).items[0].publishedImage, null, 'images de la fiche jamais publiées par une décision');
  assert.strictEqual(ev.getEvent('jan_t', now).status, 'draft', 'fiche incomplète : jamais planifiée');
  // Redémarrage : rien n'est rejoué ; une fiche modifiée depuis la décision n'est pas touchée
  assert.deepStrictEqual(ev.applyOwnerDecisions(list.slice(0, 5), now), []);
  const skipped = ev.applyOwnerDecisions([list[5]], now);
  assert.match(skipped[0].reason, /modifiée/);
  // Le propriétaire repasse décembre en brouillon : un redémarrage ne le replanifie pas
  ev.unscheduleEvent('dec_t');
  assert.deepStrictEqual(ev.applyOwnerDecisions(list, now), []);
  assert.strictEqual(ev.getEvent('dec_t', now).status, 'draft');
  const log = ev.listLog(100).filter(l => /^owner_decision/.test(l.action)).map(l => l.action);
  assert.ok(log.includes('owner_decision_applied') && log.includes('owner_decision_skipped') && log.includes('owner_decision_dates'));
  ev.scheduleEvent('dec_t', { confirmRates: true, confirmPublic: true, nowMs: now });   // remis pour la suite
});

test('horloge 30/11 23:59:59 → 01/12 00:00:00 (aucun événement) → 00:01 (décembre seul), drops jamais hors dates', () => {
  assert.deepStrictEqual(ev.publicActiveAt(B('2026-11-30T23:59') + 59_999), ['nov_t']);
  assert.deepStrictEqual(ev.publicActiveAt(B('2026-12-01T00:00')), []);
  assert.deepStrictEqual(ev.publicActiveAt(B('2026-12-01T00:00') + 59_999), []);
  assert.deepStrictEqual(ev.publicActiveAt(B('2026-12-01T00:01')), ['dec_t']);
  const prev = ev.transitionPreview(2026, 12);
  assert.deepStrictEqual(prev.map(t => [t.local, t.active]), [
    ['2026-11-30T23:59:00', ['nov_t']], ['2026-11-30T23:59:59', ['nov_t']], ['2026-12-01T00:00:00', []],
    ['2026-12-01T00:00:30', []], ['2026-12-01T00:01:00', ['dec_t']], ['2026-12-01T00:01:30', ['dec_t']]]);

  // Drops : un joueur mine pendant novembre, pendant la minute vide, puis en décembre
  const u = newUser();
  mine(u, 5, { pierre: 5 });
  ev.processSave(u, { nowMs: B('2026-11-30T23:58'), rand: ALWAYS });           // curseur de novembre
  mine(u, 6, { pierre: 6 });   // le crédit suit la profondeur retenue
  const lastNov = ev.processSave(u, { nowMs: B('2026-11-30T23:59') + 59_000, rand: ALWAYS });
  assert.deepStrictEqual(lastNov.map(f => f.eventId), ['nov_t'], 'la minute 23:59 du dernier jour compte');
  mine(u, 7, { pierre: 7 });
  assert.deepStrictEqual(ev.processSave(u, { nowMs: B('2026-12-01T00:00') + 30_000, rand: ALWAYS }), [], 'minute vide : aucun drop');
  const first = ev.processSave(u, { nowMs: B('2026-12-01T00:01'), rand: ALWAYS });
  assert.deepStrictEqual(first, [], 'premier passage de décembre : curseur seulement, le minage d\'avant ne compte pas');
  mine(u, 8, { pierre: 8 });
  assert.deepStrictEqual(ev.processSave(u, { nowMs: B('2026-12-01T00:02'), rand: ALWAYS }).map(f => f.eventId), ['dec_t']);
  // Rejeu (redémarrage, requêtes concurrentes) : aucun doublon
  mine(u, 9, { pierre: 9 });
  assert.deepStrictEqual(ev.processSave(u, { nowMs: B('2026-12-01T00:03'), rand: ALWAYS }), []);
  const finds = db.getDb().prepare('SELECT event_id, COUNT(*) n FROM monthly_event_finds WHERE user_id = ? GROUP BY event_id ORDER BY 1').all(u);
  assert.deepStrictEqual(finds.map(r => [r.event_id, r.n]), [['dec_t', 1], ['nov_t', 1]]);
  // Souvenirs : novembre terminé reste dans l'inventaire, pour toujours
  const view = ev.publicView(u, B('2027-06-01T12:00'));
  assert.deepStrictEqual(view.souvenirs.map(s => s.id).sort(), ['dec_t', 'nov_t']);
  assert.deepStrictEqual(view.active, []);
});

test('31/12 → 01/01 et février 2028 bissextile : bascules exactes, rien d\'inventé ni de prolongé', () => {
  draftMonth('jan27_t', 2027, 1);
  draftMonth('feb28_t', 2028, 2);
  const now = B('2026-11-08T16:00');
  ev.applyOwnerDecisions([
    { id: 't-jan27', eventId: 'jan27_t', revision: 1, year: 2027, month: 1 },
    { id: 't-feb28', eventId: 'feb28_t', revision: 1, year: 2028, month: 2 }], now);
  assert.deepStrictEqual(ev.publicActiveAt(B('2026-12-31T23:59') + 59_999), ['dec_t']);
  assert.deepStrictEqual(ev.publicActiveAt(B('2027-01-01T00:00')), []);
  assert.deepStrictEqual(ev.publicActiveAt(B('2027-01-01T00:01')), ['jan27_t']);
  // Février 2027 sans événement : janvier n'est pas prolongé, rien n'est inventé
  assert.deepStrictEqual(ev.publicActiveAt(B('2027-02-01T00:01')), []);
  assert.deepStrictEqual(ev.publicActiveAt(B('2027-02-15T12:00')), []);
  assert.deepStrictEqual(ev.publicActiveAt(B('2028-02-29T23:59') + 59_999), ['feb28_t'], '29/02/2028 couvert jusqu\'à 23:59:59');
  assert.deepStrictEqual(ev.publicActiveAt(B('2028-03-01T00:00')), []);
  // Heure d'été 2027 (28/03) : aucun effet sur un événement en cours ni sur la bascule
  assert.deepStrictEqual(ev.publicActiveAt(B('2027-01-31T23:59')), ['jan27_t']);
});

test('« Préparation du mois prochain » : états, tâches bloquantes, avertissements, rappels J-14/J-7/J-1, lecture seule', () => {
  const rows = () => db.getDb().prepare('SELECT (SELECT COUNT(*) FROM monthly_event_log) + (SELECT COUNT(*) FROM monthly_events) + (SELECT COUNT(*) FROM monthly_event_revisions) n').get().n;
  const before = rows();
  // 08/11/2026 : novembre actif, décembre planifié
  let p = ev.preparation(B('2026-11-08T16:00'));
  assert.deepStrictEqual([p.current.state, p.next.state, p.level], ['active', 'planned', 'ok']);
  assert.match(p.headline, /décembre 2026 : .* planifié, actif automatiquement du 1er décembre 2026 à 00 h 01 au 31 décembre 2026 à 23 h 59/);
  assert.strictEqual(p.next.reminder, null, 'planifié : pas de rappel');
  assert.strictEqual(p.previous.event.id, 'oct_t');
  assert.deepStrictEqual(p.previous.blocking, [], 'mois passé : information, plus une tâche');
  // décembre replanifié par le bouton « Planifier » (test précédent) : l'image de la fiche est partie avec
  assert.deepStrictEqual(p.next.counts, { items: 1, enabled: 1, images: { published: 1, draft: 0, none: 0 }, translated: 1 });
  // Mois suivant absent : J-14, J-7, J-1 de plus en plus visibles ; rien d'inventé
  p = ev.preparation(B('2027-02-15T12:00'));
  assert.strictEqual(p.next.state, 'absent');
  assert.strictEqual(p.next.reminder, 'J-14');
  assert.match(p.next.blocking[0], /Aucun événement prévu pour mars 2027 : le jeu reste jouable sans événement mensuel/);
  assert.strictEqual(p.level, 'warn');
  assert.strictEqual(ev.preparation(B('2027-02-23T12:00')).next.reminder, 'J-7');
  const j1 = ev.preparation(B('2027-02-28T12:00'));
  assert.deepStrictEqual([j1.next.reminder, j1.level], ['J-1', 'urgent']);
  assert.strictEqual(ev.preparation(B('2027-02-05T12:00')).next.reminder, null, 'plus de 14 jours : pas encore de rappel');
  const mar = ev.preparation(B('2027-03-15T12:00'));
  assert.deepStrictEqual([mar.previous.state, mar.previous.blocking], ['absent', []], 'mois passé sans événement : information, pas une tâche');
  // Brouillon : à compléter (0 objet) puis complet mais non planifié — jamais activé seul
  draftMonth('mar27_t', 2027, 3, []);
  p = ev.preparation(B('2027-02-23T12:00'));
  assert.strictEqual(p.next.state, 'incomplete');
  assert.ok(p.next.blocking.some(x => /0 objet/.test(x)));
  ev.updateEvent('mar27_t', { ...ev.getEvent('mar27_t'), items: [item('mar27_a')] });
  p = ev.preparation(B('2027-02-23T12:00'));
  assert.strictEqual(p.next.state, 'unscheduled');
  assert.ok(p.next.blocking.some(x => /NON planifié/.test(x)));
  assert.ok(p.next.warnings.some(x => /mois entier/.test(x)), 'dates 00:00 : rappel de la règle du mois entier 00:01');
  assert.ok(p.next.warnings.some(x => /Aucune image publiée : les 1 objets affichent leur emoji \(non bloquant\)/.test(x)), 'image manquante : avertissement, jamais bloquant');
  assert.deepStrictEqual(ev.publicActiveAt(B('2027-03-10T12:00')), [], 'brouillon non planifié : jamais actif');
  // Lecture seule : la simulation n'écrit rien
  const after = rows();
  ev.preparation(B('2030-01-01T00:00'));
  assert.strictEqual(rows(), after);
  assert.ok(after > before);
});

test('calendrier annuel : chaque mois = mois civil entier (00:01 → 1er suivant 00:00), fête = inspiration, années navigables', () => {
  const now = B('2026-11-08T16:00');
  for (const y of [2026, 2027, 2028]) {
    const cal = ev.proposeCalendar(y, now);
    assert.strictEqual(cal.months.length, 12);
    for (const m of cal.months) {
      const b = ev.monthBounds(y, m.month);
      assert.deepStrictEqual(m.suggested, { startsAt: b.startsLocal, endsAt: b.endsLocal }, `${y}-${m.month}`);
    }
  }
  const c28 = ev.proposeCalendar(2028, now);
  assert.strictEqual(c28.months[1].days, 29);
  assert.strictEqual(c28.months[1].state, 'planned');
  const c26 = ev.proposeCalendar(2026, now);
  assert.strictEqual(c26.months[11].holiday.key, 'noel');
  assert.deepStrictEqual(c26.months[11].suggested, { startsAt: '2026-12-01T00:01', endsAt: '2027-01-01T00:00' }, 'Noël inspire décembre sans raccourcir la durée');
  assert.deepStrictEqual([c26.months[10].state, c26.months[11].state], ['active', 'planned']);
  assert.strictEqual(c26.months[11].prepareBy, '2026-11-17');
  const c27 = ev.proposeCalendar(2027, now);
  assert.strictEqual(c27.months[2].holiday.key, 'paques');   // Pâques 2027 : 28 mars
  assert.deepStrictEqual(c27.months[3].suggested, { startsAt: '2027-04-01T00:01', endsAt: '2027-05-01T00:00' });
  assert.strictEqual(c27.months[1].state, 'absent');
});
