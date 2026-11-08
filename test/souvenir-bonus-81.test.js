/**
 * #81 — demande du propriétaire du 08/11/2026 : bonus des souvenirs d'événements.
 *
 * Vérifie, sans rien activer :
 *   1. la règle proposée « un seul bonus par TYPE de souvenir et par joueur », quel que soit le
 *      nombre d'exemplaires (doubles #93) ;
 *   2. le transfert d'un exemplaire (échanges #93) : réévaluation immédiate et idempotente, perte au
 *      dernier exemplaire, aucun gain pour un receveur qui possède déjà le type, aucune rétroactivité ;
 *   3. la fiche admin : état « inactif », variantes chiffrées cohérentes avec le simulateur audité,
 *      cumul 30 + 31 souvenirs et plafonds ; aucune écriture en base, aucun bonus transmis au jeu.
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-sb-81-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db           = require('../server/db');
const blockCatalog = require('../server/blockCatalog');
const badges       = require('../server/badges');
const ev           = require('../server/monthlyEvents');
const drafts       = require('../server/microBonusDrafts');
const sb           = require('../server/souvenirBonus');
const MicroBonus   = require('../public/js/microBonus');

const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'server/content/events', f), 'utf8'));
const NOV = read('novembre-histoire-2026.json');
const NOEL = read('noel-2026.json');
const THU = Date.parse('2026-11-12T11:00:00Z');   // jeudi 12/11/2026, 12:00 à Bruxelles
const FRI = Date.parse('2026-11-13T11:00:00Z');
const K1 = 'novembre_histoire_2026/a', K2 = 'novembre_histoire_2026/b', K3 = 'noel_2026/c';
const B = (key, value, schedule = {}) => {
  const [eventId, itemId] = key.split('/');
  return { kind: 'damage_flat', value, target: { type: 'all' }, schedule, source: { eventId, itemId } };
};

test.before(() => {
  db.initDb();
  blockCatalog.init();
  badges.init();
  ev.init();
  drafts.init();
  ev.createEvent(NOV);
  ev.createEvent(NOEL);
  // Noël en production : 5 souvenirs publiés + 26 proposés = 31 (la fiche compte les deux)
  for (let k = 0; k < 26; k++) {
    ev.addProposal('noel_2026', { ...NOEL.items[0], id: `noel_prop_${String(k).padStart(2, '0')}`, icon: '🎄' });
  }
});

test.after(() => {
  db.getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('un seul bonus par type : 1 ou 12 exemplaires donnent le même bonus', () => {
  const bonuses = [B(K1, 0.03), B(K2, 0.02)];
  const one = sb.resolve({ [K1]: 1 }, bonuses, { nowMs: THU });
  const many = sb.resolve({ [K1]: 12 }, bonuses, { nowMs: THU });
  assert.strictEqual(one.total, 0.03);
  assert.strictEqual(many.total, 0.03, 'les doubles n\'ajoutent rien');
  assert.strictEqual(sb.resolve({ [K1]: 3, [K2]: 2 }, bonuses, { nowMs: THU }).total, 0.05, 'types différents : s\'additionnent');
  assert.strictEqual(sb.resolve({}, bonuses, { nowMs: THU }).total, 0);
  assert.strictEqual(sb.resolve({ [K1]: 0, [K2]: -1, x: 'abc' }, bonuses, { nowMs: THU }).total, 0, 'quantités nulles ou invalides ignorées');
  // deux brouillons liés au même type : le premier compte, le second est signalé
  const dup = sb.resolve({ [K1]: 1 }, [B(K1, 0.03), B(K1, 0.5)], { nowMs: THU });
  assert.strictEqual(dup.total, 0.03);
  assert.deepStrictEqual(dup.ignored, [K1]);
});

test('plafond du cumul et calendrier (jeudi, heure de Bruxelles)', () => {
  const owned = Object.fromEntries(Array.from({ length: 30 }, (_, k) => [`novembre_histoire_2026/i${k}`, 1]));
  const thursday = Object.keys(owned).map(k => B(k, 0.03, { weekdays: [4] }));
  const r = sb.resolve(owned, thursday, { nowMs: THU, cap: 0.10 });
  assert.strictEqual(r.raw, 0.9);
  assert.strictEqual(r.total, 0.1);
  assert.strictEqual(r.capped, true);
  assert.strictEqual(sb.resolve(owned, thursday, { nowMs: FRI, cap: 0.10 }).total, 0, 'vendredi : suspendu, objets toujours possédés');
  // jeudi 00:00 et mercredi 23:59 à Bruxelles (heure d'hiver UTC+1)
  assert.strictEqual(sb.resolve(owned, thursday, { nowMs: Date.parse('2026-11-11T23:00:00Z'), cap: 0.1 }).total, 0.1);
  assert.strictEqual(sb.resolve(owned, thursday, { nowMs: Date.parse('2026-11-11T22:59:00Z'), cap: 0.1 }).total, 0);
  // le plafond demandé ne dépasse jamais le plafond technique STACK_CAP
  const big = Object.keys(owned).map(k => B(k, 1));
  assert.strictEqual(sb.resolve(owned, big, { nowMs: THU, cap: 5 }).total, MicroBonus.STACK_CAP);
  // cible : un bonus « pierre » ne compte pas sur un autre bloc
  const stone = { ...B(K1, 0.25), target: { type: 'block', id: 'pierre' } };
  assert.strictEqual(sb.resolve({ [K1]: 1 }, [stone], { nowMs: THU, block: { id: 'pierre', category: 'pierre' } }).total, 0.25);
  assert.strictEqual(sb.resolve({ [K1]: 1 }, [stone], { nowMs: THU, block: { id: 'argile', category: 'terre' } }).total, 0);
});

test('transfert : donneur garde le bonus tant qu\'il lui reste un exemplaire, le perd avec le dernier', () => {
  const bonuses = [B(K1, 0.03), B(K3, 0.02)];
  let alice = { [K1]: 2, [K3]: 1 }, bob = {};
  const before = { a: sb.resolve(alice, bonuses, { nowMs: THU }), b: sb.resolve(bob, bonuses, { nowMs: THU }) };
  assert.deepStrictEqual([before.a.total, before.b.total], [0.05, 0]);

  ({ from: alice, to: bob } = sb.transfer(alice, bob, K1));             // un double donné
  assert.deepStrictEqual(alice, { [K1]: 1, [K3]: 1 });
  assert.strictEqual(sb.resolve(alice, bonuses, { nowMs: THU }).total, 0.05, 'donneur : bonus intact (il garde un exemplaire)');
  assert.strictEqual(sb.resolve(bob, bonuses, { nowMs: THU }).total, 0.03, 'receveur : bonus immédiat');

  ({ from: alice, to: bob } = sb.transfer(alice, bob, K1));             // dernier exemplaire
  assert.deepStrictEqual(alice, { [K3]: 1 });
  assert.strictEqual(sb.resolve(alice, bonuses, { nowMs: THU }).total, 0.02, 'donneur : perd ce bonus avec le dernier exemplaire');
  assert.strictEqual(bob[K1], 2);
  assert.strictEqual(sb.resolve(bob, bonuses, { nowMs: THU }).total, 0.03, 'receveur qui l\'avait déjà : aucun gain par la quantité');

  // idempotence : réévaluer plusieurs fois le même inventaire donne le même résultat
  const r1 = sb.resolve(bob, bonuses, { nowMs: THU }), r2 = sb.resolve(bob, bonuses, { nowMs: THU });
  assert.deepStrictEqual(r1, r2);
  // la puissance totale du « système » ne croît jamais par les échanges : au plus un bonus par type et par joueur
  const sum = (sb.resolve(alice, bonuses, { nowMs: THU }).raw + sb.resolve(bob, bonuses, { nowMs: THU }).raw);
  assert.ok(sum <= 0.05 + 1e-9);

  assert.throws(() => sb.transfer(alice, bob, K1), /non possédé/, 'impossible de donner un exemplaire déjà donné');
  assert.throws(() => sb.transfer(bob, alice, K1, 3), /non possédé/);
  assert.throws(() => sb.transfer(bob, alice, K1, 0), /Quantité/);
  // inventaires d'entrée jamais modifiés (pur)
  const frozen = { [K1]: 1 };
  sb.transfer(frozen, {}, K1);
  assert.deepStrictEqual(frozen, { [K1]: 1 });
});

test('aucune rétroactivité : le résultat ne dépend que de l\'inventaire et de l\'instant courants', () => {
  const bonuses = [B(K1, 0.03, { weekdays: [4] })];
  const { to } = sb.transfer({ [K1]: 1 }, {}, K1);
  // reçu un vendredi : rien ce jour-là ; actif au jeudi suivant ; rien n'est « rattrapé »
  assert.strictEqual(sb.resolve(to, bonuses, { nowMs: FRI }).total, 0);
  assert.strictEqual(sb.resolve(to, bonuses, { nowMs: Date.parse('2026-11-19T11:00:00Z') }).total, 0.03);
  assert.strictEqual(sb.resolve.length, 2, 'aucune entrée d\'historique : signature (inventaire, bonus, options)');
});

test('fiche admin : aucun bonus défini, variantes cohérentes avec le simulateur, cumul 30 + 31', () => {
  const nov = ev.getEvent('novembre_histoire_2026').items[0];
  const s = sb.itemSheet('novembre_histoire_2026', nov.id, { nowMs: THU });
  assert.match(s.status, /Aucun bonus défini — inactif en jeu/);
  assert.deepStrictEqual(s.drafts, []);
  assert.strictEqual(s.variants.length, 2);
  // même résultat que le simulateur #81 audité
  const sim = drafts.simulate({ kind: 'damage_flat', value: 0.03, target: { type: 'all' }, schedule: {} }, { depth: 50, bases: [1, 2, 5] });
  const g50 = s.variants.find(v => v.key === 'thursday').gains.find(g => g.depth === 50);
  assert.deepStrictEqual(g50.cells.map(c => c.pct), sim.rows.map(r => r.moreBlocksPct));
  assert.match(s.variants[1].text, /jeudis/);
  // à 1 m, +0,01 ne fait gagner aucun coup (PV entiers trop petits) : vrai zéro
  assert.ok(s.variants[0].gains.find(g => g.depth === 1).cells.every(c => c.zero));

  const c = s.cumulative;
  assert.deepStrictEqual(c.events.map(e => [e.id, e.count, e.proposals]), [['novembre_histoire_2026', 30, 0], ['noel_2026', 31, 26]]);
  assert.strictEqual(c.totalSouvenirs, 61);
  const A = c.variants.find(v => v.key === 'constant'), Bv = c.variants.find(v => v.key === 'thursday');
  const row = (v, n) => v.rows.find(r => r.count === n);
  assert.ok(row(A, 30) && row(A, 61), 'lignes 30 (Novembre) et 61 (Novembre + Noël)');
  assert.strictEqual(row(A, 30).raw, 0.3);
  assert.strictEqual(row(A, 61).effective, 0.05);
  assert.strictEqual(row(Bv, 61).effective, 0.1);
  assert.ok(row(Bv, 61).capped);
  // au-delà du plafond, plus aucun avantage supplémentaire
  assert.strictEqual(row(A, 30).gains[1].pct, row(A, 61).gains[1].pct);
  // moyenne semaine de la variante jeudi = gain du jeudi ÷ 7
  assert.strictEqual(row(Bv, 61).week50, +(row(Bv, 61).gains[1].pct / 7).toFixed(2));
  assert.ok(row(A, 61).uncapped50 > row(A, 61).gains[1].pct * 5, 'sans plafond, l\'écart vétéran exploserait');
  assert.deepStrictEqual(c.linked, { drafts: 0, types: 0, ignored: [], rawNow: 0, totalNow: 0, stackCap: 1 });
});

test('fiche admin : brouillon lié affiché, toujours brouillon ; lecture sans aucune écriture', () => {
  const nov = ev.getEvent('novembre_histoire_2026').items[1];
  const d = drafts.create({ label: 'Lié', effect: { value: 0.03, target: { type: 'all' }, schedule: { weekdays: [4] }, source: { eventId: 'novembre_histoire_2026', itemId: nov.id } } });
  const dump = () => ['micro_bonus_drafts', 'micro_bonus_draft_log', 'monthly_events', 'monthly_event_items', 'monthly_event_finds']
    .map(t => JSON.stringify(db.getDb().prepare(`SELECT * FROM ${t} ORDER BY rowid`).all())).join('|');
  const before = dump();
  const s = sb.itemSheet('novembre_histoire_2026', nov.id, { nowMs: FRI });
  assert.strictEqual(dump(), before, 'la fiche ne modifie rien');
  assert.match(s.status, /Brouillon — inactif en jeu/);
  assert.strictEqual(s.drafts.length, 1);
  assert.strictEqual(s.drafts[0].id, d.id);
  assert.strictEqual(s.drafts[0].kind, 'Calendaire');
  assert.match(s.drafts[0].calendar, /jeudis/);
  assert.match(s.drafts[0].wouldNow, /inactif/);
  assert.match(s.drafts[0].next, /prochain créneau le 19\/11\/2026/);
  assert.strictEqual(s.cumulative.linked.drafts, 1);
  assert.strictEqual(drafts.get(d.id).status, 'draft');
  // un deuxième brouillon lié au même souvenir : signalé, ignoré par la règle
  drafts.create({ label: 'Lié 2', effect: { value: 0.5, target: { type: 'all' }, schedule: {}, source: { eventId: 'novembre_histoire_2026', itemId: nov.id } } });
  const s2 = sb.itemSheet('novembre_histoire_2026', nov.id, { nowMs: FRI });
  assert.match(s2.multipleWarning, /seul le premier/);
  assert.deepStrictEqual(s2.drafts.map(x => x.counted), [true, false]);
});

test('aucun bonus transmis au jeu : aucune route joueur, route admin en lecture seule', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8');
  const routes = src.split('\n').filter(l => /souvenirBonus\.|souvenir-bonus/.test(l) && /app\.(get|post|put|delete)/.test(l));
  assert.deepStrictEqual(routes.map(l => /requireAdmin/.test(l)), [true]);
  assert.ok(/app\.get\('\/api\/admin\/souvenir-bonus\//.test(routes[0]), 'GET seulement');
  const game = ['public/js/main.js', 'public/js/gameState.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  assert.ok(!/souvenir-bonus|souvenirBonus/.test(game));
});
