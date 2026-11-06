/**
 * Dégâts décimaux et PV précis (#81) : calcul en centièmes (Blocks.hit), conversion exacte des
 * entiers, sauvegarde/reprise, affichage arrondi ou précis (NumFmt), modèle de micro-bonus
 * (MicroBonus : cibles, calendrier Europe/Brussels, cumul plafonné) et brouillons admin
 * (server/microBonusDrafts : jamais d'autre statut que `draft`, rien transmis au jeu).
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const vm     = require('vm');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-decimal-81-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db = require('../server/db');
const MicroBonus = require('../public/js/microBonus');
const drafts = require('../server/microBonusDrafts');

/** Scripts du jeu dans un contexte isolé (un « appareil »). */
function device(lang = 'fr') {
  const store = new Map();
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const ctx = vm.createContext({ localStorage, Date, JSON, Math, Object, Array, Number, String, Boolean, Set, Map, Intl,
    I18n: { getCurrent: () => lang } });
  for (const f of ['gameState.js', 'numFmt.js', 'microBonus.js', 'blocks.js', 'chests.js', 'collection.js', 'save.js', 'relics.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/js', f), 'utf8'), ctx, { filename: f });
  }
  return vm.runInContext('({ GameState, NumFmt, MicroBonus, Blocks, Save, Relics })', ctx);
}

const at = iso => Date.parse(iso);

// ── Moteur ────────────────────────────────────────────────────────────────────

test('entiers : Blocks.hit donne exactement le résultat d\'avant (max(0, PV − dégâts))', () => {
  const { Blocks } = device();
  for (let hp = 1; hp <= 400; hp += 7) {
    for (const dmg of [1, 2, 3, 5, 11, 25]) {
      Blocks.current = { type: Blocks.TYPES[0], hp, maxHp: hp, reward: 1, depth: 1, seq: 1 };
      let hits = 0, old = hp, destroyed = false;
      while (!destroyed) {
        destroyed = Blocks.hit(dmg); hits++;
        old = Math.max(0, old - dmg);
        assert.strictEqual(Blocks.current.hp, old);
        assert.ok(Number.isInteger(Blocks.current.hp));
      }
      assert.strictEqual(hits, Math.ceil(hp / dmg));
      assert.strictEqual(Blocks.hitsToBreak(hp, dmg), hits);
    }
  }
});

test('fractionnaire : nombre de coups exact, sans résidu flottant (0,1 × 10 = 1)', () => {
  const { Blocks } = device();
  const run = (hp, dmg) => {
    Blocks.current = { type: Blocks.TYPES[0], hp, maxHp: hp, reward: 1, depth: 1, seq: 1 };
    let n = 0;
    while (!Blocks.hit(dmg)) { n++; assert.ok(n < 10_000); }
    return n + 1;
  };
  assert.strictEqual(run(1, 0.1), 10);          // en flottants : 0,1 × 10 laisse 1,4e-16 → 11 coups
  assert.strictEqual(run(3, 1.25), 3);          // 3 − 1,25 − 1,25 = 0,5 → 3e coup
  assert.strictEqual(run(2.5, 1.25), 2);        // seuil exact : 0 PV pile au 2e coup
  assert.strictEqual(run(12, 1.3), 10);         // 9 × 1,3 = 11,7 < 12 ; 10 × 1,3 = 13
  assert.strictEqual(run(0.3, 0.1), 3);
  Blocks.current = { type: Blocks.TYPES[0], hp: 10, maxHp: 10, reward: 1, depth: 1, seq: 1 };
  Blocks.hit(1.25);
  assert.strictEqual(Blocks.current.hp, 8.75);
  for (const bad of [-5, NaN, 'abc', null, undefined, 0.004]) {
    assert.strictEqual(Blocks.hit(bad), false);
    assert.strictEqual(Blocks.current.hp, 8.75, `dégâts ${bad} : aucun effet`);
  }
  assert.strictEqual(Blocks.hitsToBreak(8.75, 0), Infinity);
});

test('PV max des blocs inchangés (entiers) et dégâts des reliques ramenés au centième', () => {
  const { GameState, Blocks, Relics } = device();
  GameState.blockSeed = 12345;
  for (let d = 1; d <= 300; d += 13) {
    const b = Blocks.spawn(d);
    assert.ok(Number.isInteger(b.maxHp) && b.hp === b.maxHp);
  }
  GameState.pickaxeLevel = 3;
  Relics.DEFS = [{ id: 'a', maxLevel: 1, costs: [1], bonus: { type: 'damage_flat', values: [0.1] } },
    { id: 'b', maxLevel: 1, costs: [1], bonus: { type: 'damage_flat', values: [0.2] } }];
  GameState.relics = { a: 1, b: 1 };
  Relics.applyBonuses();
  assert.strictEqual(GameState.damage, 3.3);     // 3 + 0,1 + 0,2 = 3,3000000000000003 en flottants
  GameState.relics = {};
  Relics.applyBonuses();
  assert.strictEqual(GameState.damage, 3);
});

test('sauvegarde / F5 : PV restants fractionnaires repris à l\'identique, anciennes sauvegardes entières inchangées', () => {
  const pc = device();
  pc.GameState.depth = 40;
  pc.Blocks.spawn(40);
  pc.Blocks.hit(1.25);
  const before = { hp: pc.Blocks.current.hp, maxHp: pc.Blocks.current.maxHp, seq: pc.Blocks.current.seq };
  assert.ok(!Number.isInteger(before.hp));
  const data = JSON.parse(JSON.stringify(pc.Save.serialize(1)));
  assert.strictEqual(data.block.hp, before.hp);
  assert.ok(!('eventBonuses' in data), 'les micro-bonus ne sont jamais sauvegardés');
  const phone = device();
  phone.Save.loadFromData(data);
  assert.strictEqual(phone.Blocks.resume(data.block, 40), true);
  assert.deepStrictEqual({ hp: phone.Blocks.current.hp, maxHp: phone.Blocks.current.maxHp, seq: phone.Blocks.current.seq }, before);
  // Sauvegarde d'avant #81 : PV entiers repris tels quels
  const old = device();
  old.GameState.blockSeq = 5;
  assert.strictEqual(old.Blocks.resume({ name: 'block.pierre', hp: 7, maxHp: 30, reward: 9, depth: 12, seq: 5 }, 12), true);
  assert.strictEqual(old.Blocks.current.hp, 7);
  // PV résiduels invalides : bloc suivant tiré (jamais un bloc à 0 PV)
  const odd = device();
  odd.GameState.blockSeq = 5;
  assert.strictEqual(odd.Blocks.resume({ name: 'block.pierre', hp: 0.001, maxHp: 30, reward: 9, depth: 12, seq: 5 }, 12), false);
});

// ── Affichage ─────────────────────────────────────────────────────────────────

test('affichage : entier par défaut, précis avec l\'option (séparateur de la langue), jamais 0 pour un reste positif', () => {
  const fr = device('fr'), en = device('en');
  assert.strictEqual(fr.NumFmt.isPrecise(), false, 'OFF par défaut');
  assert.strictEqual(fr.NumFmt.damage(1.25), '1');
  assert.strictEqual(fr.NumFmt.damage(1.5), '2');
  assert.strictEqual(fr.NumFmt.damage(7), '7');
  assert.strictEqual(fr.NumFmt.damage(0.5), '0,5');         // jamais « 0 » pour des dégâts positifs
  assert.strictEqual(fr.NumFmt.hp(0.25), '1');               // bloc encore debout : jamais « 0 PV »
  assert.strictEqual(fr.NumFmt.hp(11.25), '12');
  assert.strictEqual(fr.NumFmt.hp(12), '12');
  assert.strictEqual(fr.NumFmt.hp(0), '0');
  fr.NumFmt.setPrecise(true);
  assert.strictEqual(fr.NumFmt.isPrecise(), true);
  assert.strictEqual(fr.NumFmt.damage(1.25), '1,25');
  assert.strictEqual(fr.NumFmt.damage(1.5), '1,5');          // pas de zéro inutile
  assert.strictEqual(fr.NumFmt.damage(2), '2');
  assert.strictEqual(fr.NumFmt.hp(1234.5), '1234,5');
  assert.strictEqual(en.NumFmt.damage(1.25, true), '1.25');
  assert.strictEqual(en.NumFmt.exact(3.3000000000000003), '3.3');
  fr.NumFmt.setPrecise(false);
  assert.strictEqual(fr.NumFmt.damage(1.25), '1');
});

test('jeu : option dans Paramètres, scripts chargés, affichage du bloc et des dégâts par NumFmt', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const order = ['gameState.js', 'numFmt.js', 'microBonus.js', 'blocks.js', 'upgrades.js', 'relics.js', 'main.js'].map(f => html.indexOf(`js/${f}`));
  assert.ok(order.every(i => i > 0) && order.every((v, i) => i === 0 || v > order[i - 1]), 'ordre de chargement');
  const main = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
  assert.match(main, /id="opt-precise"/);
  assert.match(main, /NumFmt\.hp\(b\.hp\)/);
  assert.match(main, /MicroBonus\.clickDamage\(GameState\.damage, GameState\.eventBonuses/);
  const i18n = fs.readFileSync(path.join(ROOT, 'public/js/i18n.js'), 'utf8');
  assert.strictEqual((i18n.match(/precise_label:/g) || []).length, 4, 'FR, EN, NL, ES');
});

// ── Micro-bonus ───────────────────────────────────────────────────────────────

test('micro-bonus : validation stricte (bornes, 2 décimales, cible, dates)', () => {
  const ok = MicroBonus.normalize({ value: '0.25', target: { type: 'block', id: 'pierre' }, schedule: { months: '11', weekdays: [1, 1] } });
  assert.deepStrictEqual(ok, { kind: 'damage_flat', value: 0.25, target: { type: 'block', id: 'pierre' }, schedule: { months: [11], weekdays: [1] } });
  for (const bad of [
    { value: 0 }, { value: -0.1 }, { value: 1.01 }, { value: 0.001 }, { value: 0.125 }, { value: 'x' },
    { value: 0.1, kind: 'coins' }, { value: 0.1, target: { type: 'category', id: 'lave' } },
    { value: 0.1, schedule: { from: '2026-02-30' } }, { value: 0.1, schedule: { from: '2026-12-01', to: '2026-11-01' } },
    { value: 0.1, schedule: { weekdays: [0] } }, { value: 0.1, schedule: { months: [13] } },
  ]) assert.throws(() => MicroBonus.normalize(bad), MicroBonus.MicroBonusError, JSON.stringify(bad));
});

test('micro-bonus : calendrier à Bruxelles (lundi↔mardi, octobre↔novembre, heure d\'hiver)', () => {
  const monday = MicroBonus.normalize({ value: 0.1, schedule: { weekdays: [1] } });
  assert.strictEqual(MicroBonus.isActiveAt(monday, at('2026-11-02T22:59:59Z')), true);    // lun. 23:59:59 Bruxelles
  assert.strictEqual(MicroBonus.isActiveAt(monday, at('2026-11-02T23:00:00Z')), false);   // mar. 00:00 Bruxelles
  assert.strictEqual(MicroBonus.isActiveAt(monday, at('2026-11-01T23:00:00Z')), true);    // lun. 00:00 Bruxelles (UTC : dimanche)
  const november = MicroBonus.normalize({ value: 0.2, schedule: { months: [11] } });
  assert.strictEqual(MicroBonus.isActiveAt(november, at('2026-10-31T22:59:59Z')), false); // 31/10 23:59:59 (UTC+1)
  assert.strictEqual(MicroBonus.isActiveAt(november, at('2026-10-31T23:00:00Z')), true);  // 01/11 00:00
  assert.strictEqual(MicroBonus.isActiveAt(november, at('2026-11-30T22:59:59Z')), true);
  assert.strictEqual(MicroBonus.isActiveAt(november, at('2026-11-30T23:00:00Z')), false); // 01/12
  // Passage à l'heure d'été (29/03/2026) : minuit Bruxelles = 22:00 UTC la veille
  const range = MicroBonus.normalize({ value: 0.1, schedule: { from: '2026-03-30', to: '2026-03-30' } });
  assert.strictEqual(MicroBonus.isActiveAt(range, at('2026-03-29T21:59:59Z')), false);
  assert.strictEqual(MicroBonus.isActiveAt(range, at('2026-03-29T22:00:00Z')), true);
  assert.strictEqual(MicroBonus.stateAt(range, at('2026-04-02T10:00:00Z')).code, 'ended');
  assert.strictEqual(MicroBonus.stateAt(range, at('2026-03-01T10:00:00Z')).code, 'upcoming');
  assert.strictEqual(MicroBonus.stateAt(monday, at('2026-11-03T10:00:00Z')).text, 'Inactif — actif les lundis');
  assert.strictEqual(MicroBonus.stateAt(monday, at('2026-11-02T10:00:00Z')).text, 'Actif actuellement');
});

test('micro-bonus : cible, cumul plafonné, coups manuels seulement', () => {
  const stone = { name: 'block.pierre', category: 'pierre' };
  const coal = { id: 'charbon', category: 'minerai' };
  const now = at('2026-11-02T10:00:00Z');   // lundi de novembre
  const list = [
    MicroBonus.normalize({ value: 0.25, target: { type: 'block', id: 'pierre' } }),
    MicroBonus.normalize({ value: 0.15, target: { type: 'category', id: 'minerai' } }),
    MicroBonus.normalize({ value: 0.1, schedule: { weekdays: [1] } }),
    MicroBonus.normalize({ value: 0.2, schedule: { months: [10] } }),   // inactif en novembre
  ];
  assert.strictEqual(MicroBonus.total(list, { block: stone, nowMs: now }), 0.35);
  assert.strictEqual(MicroBonus.total(list, { block: coal, nowMs: now }), 0.25);
  assert.strictEqual(MicroBonus.clickDamage(1, list, { block: stone, nowMs: now }), 1.35);
  assert.strictEqual(MicroBonus.clickDamage(3, [], { block: stone, nowMs: now }), 3, 'aucun bonus : dégâts inchangés');
  const many = Array.from({ length: 8 }, () => MicroBonus.normalize({ value: 0.5 }));
  assert.strictEqual(MicroBonus.total(many, { block: stone, nowMs: now }), MicroBonus.STACK_CAP);
  assert.strictEqual(MicroBonus.describe(list[0], 'fr', { blocks: { pierre: 'Pierre' } }), '+0,25 dégât par coup sur le bloc « Pierre »');
  // L'Auto-Dig ne passe pas par MicroBonus (main.js : autoDigTick → Upgrades.getAutoDigDamage)
  const main = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
  const tick = main.slice(main.indexOf('function autoDigTick'), main.indexOf('function autoDigTick') + 400);
  assert.doesNotMatch(tick, /MicroBonus/);
});

// ── Brouillons admin ──────────────────────────────────────────────────────────

test('brouillons : création, modification, archivage journalisés ; aucun autre statut possible', () => {
  db.initDb();
  drafts.init();
  const d = drafts.create({ label: 'Souvenir de novembre', effect: { value: 0.2, schedule: { months: [11] } } });
  assert.strictEqual(d.status, 'draft');
  const u = drafts.update(d.id, { label: 'Souvenir de novembre', effect: { value: 0.25, target: { type: 'block', id: 'pierre' } } });
  assert.strictEqual(u.effect.value, 0.25);
  assert.throws(() => drafts.create({ label: 'x', status: 'active', effect: { value: 0.1 } }), /Activation impossible/);
  assert.throws(() => drafts.update(d.id, { label: 'x', status: 'on', effect: { value: 0.1 } }), /Activation impossible/);
  assert.throws(() => drafts.create({ label: 'x', effect: { value: 5 } }), drafts.DraftError);
  assert.throws(() => db.getDb().prepare("UPDATE micro_bonus_drafts SET status = 'active' WHERE id = ?").run(d.id), /CHECK/);
  assert.strictEqual(drafts.setArchived(d.id, true).archived, true);
  assert.strictEqual(drafts.list().length, 0);
  assert.strictEqual(drafts.list({ archived: true }).length, 1);
  assert.deepStrictEqual(drafts.listLog().map(l => l.action).reverse(), ['create', 'update', 'archive']);
  drafts.init();   // idempotent
});

test('aperçu : textes, dates repères et simulation exacte (aucun bonus = aucun gain)', () => {
  const p = drafts.preview({ value: 0.25, target: { type: 'block', id: 'pierre' } }, { depth: 5, nowMs: at('2026-11-02T10:00:00Z') });
  assert.match(p.text.fr, /^\+0,25 dégât par coup sur le bloc/);
  assert.strictEqual(p.state.code, 'active');
  assert.ok(p.warnings.some(w => /permanent/.test(w)));
  assert.strictEqual(p.samples.length, 5);
  const row1 = p.simulation.rows.find(r => r.base === 1);
  assert.ok(row1.hitsAfter < row1.hitsBefore && row1.fewerHitsPct > 0 && row1.targetShare > 0);
  const none = drafts.simulate({ value: 0.25, target: { type: 'block', id: 'inexistant' }, schedule: {} }, { depth: 50 });
  assert.ok(none.rows.every(r => r.zero && r.fewerHitsPct === 0 && r.hitsAfter === r.hitsBefore));
});

test('aucune route joueur ne transmet de micro-bonus (admin seulement)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8');
  const routes = src.match(/app\.(get|post|put|delete)\('[^']*micro[^']*'[^\n]*/g) || [];
  assert.ok(routes.length >= 4);
  for (const r of routes) {
    assert.match(r, /'\/api\/admin\/micro-bonuses/, r);
    assert.match(r, /requireAdmin/, r);
  }
  assert.doesNotMatch(src.replace(/require\('\.\/microBonusDrafts'\)/, ''), /microBonusDrafts\.(list|get)\(/, 'aucune lecture hors panel');
});
