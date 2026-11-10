/**
 * Événements mensuels (#56) — tests complémentaires demandés le 05/11 (propriétaire) :
 * activation par les dates seules (bornes exactes, annonce J-7, minage d'avant le début ignoré),
 * drops événementiels (public pour tous, bornes de profondeur et de probabilité, objet désactivé,
 * testeur supprimé, deux événements simultanés, contenu de Noël tiré dans une base de TEST),
 * conservation des souvenirs (reset complet #75 puis restauration, fin, objet désactivé),
 * traduction et rendu joueur (panneau réel de public/js/main.js exécuté en vm, 5 langues).
 * Aucun taux, aucune récompense ni aucun contenu n'est modifié : base temporaire hors server/data/.
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-events-cov-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');
process.env.DIG_AI_FAKE = '1';

const db           = require('../server/db');
const blockCatalog = require('../server/blockCatalog');
const badges       = require('../server/badges');
const news         = require('../server/news');
const gemLedger    = require('../server/gemLedger');
const testRuns     = require('../server/testRuns');
const ev           = require('../server/monthlyEvents');

const NOEL = require('../server/content/events/noel-2026.json');
const HOUR = 3_600_000, DAY = 24 * HOUR;
let season;
let userSeq = 0;

const newUser = (name = `cov_user_${++userSeq}`) => db.getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(name, 'x').lastInsertRowid;
const nameOf = id => db.getDb().prepare('SELECT username FROM users WHERE id = ?').get(id).username;
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const tx = s => ({ fr: s, en: `${s} EN`, nl: `${s} NL`, es: `${s} ES` });
const item = (id, extra = {}) => ({ id, icon: '🎁', rarity: 'commun', chancePct: 50, minDepth: 0, dropFrom: [], names: tx(`Objet ${id}`), descs: tx(`Desc ${id}`), ...extra });
const ALWAYS = () => 0;
const findsOf = u => db.getDb().prepare('SELECT event_id || \'/\' || item_id AS k FROM monthly_event_finds WHERE user_id = ? ORDER BY k').all(u).map(r => r.k);

function setAccepted(userId, depth) {
  db.upsertDepthTracking(userId, { season_id: season.id, ref_clicks: 0, ref_auto: 0, hand_tokens: 0, auto_tokens: 0,
    accepted_depth: depth, last_gap: 0, updated_ms: Date.now(), dmg_depth: null, dmg_credit: null, dmg_ref_clicks: null, dmg_gap: 0 });
}
/** Minage validé : profondeur retenue + compteurs déclarés, crédités par badges.processSave (#38). */
function mine(userId, depth, minedByType) {
  setAccepted(userId, depth);
  badges.processSave(userId, { stats: { minedByType } });
}

/** Événement public planifié dans la base de TEST (les deux confirmations exigées en production). */
function publicEvent(id, from, to, items, extra = {}) {
  ev.createEvent({ id, icon: '🎊', audience: 'public', names: tx(`Public ${id}`), taglines: tx('Accroche'), startsAt: iso(from), endsAt: iso(to), items, ...extra });
  return ev.scheduleEvent(id, { confirmRates: true, confirmPublic: true, confirmElapsed: true });
}

test.before(() => {
  db.initDb();
  blockCatalog.init();
  badges.init();
  news.init();
  gemLedger.init();
  testRuns.init();
  require('../server/blockAi').init();
  ev.init();
  season = db.getActiveSeason();
  assert.ok(season, 'saison active du seed');
});

test.after(() => {
  db.getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── Activation par les dates ──────────────────────────────────────────────────

test('dates : planifié → actif à la milliseconde du début → terminé à la fin, sans aucune action', () => {
  // Années lointaines : aucun recouvrement avec les autres tests ni avec Noël
  const start = Date.UTC(2031, 5, 10, 8), end = start + 3 * DAY;
  publicEvent('dates_a', start, end, [item('dta_a')]);
  const state = ms => ev.getEvent('dates_a', ms).state;
  assert.strictEqual(state(start - 1), 'planned');
  assert.strictEqual(state(start), 'active', 'début inclus');
  assert.strictEqual(state(end - 1), 'active');
  assert.strictEqual(state(end), 'ended', 'fin exclue');

  const u = newUser();
  const ids = ms => ev.activeFor(u, ms).map(e => e.id).filter(id => id === 'dates_a');
  assert.deepStrictEqual(ids(start - 1), []);
  assert.deepStrictEqual(ids(start), ['dates_a']);
  assert.deepStrictEqual(ids(end), []);
  // Invité : un événement public actif est visible, sans objet trouvé
  const guest = ev.publicView(null, start).active.find(e => e.id === 'dates_a');
  assert.ok(guest && !guest.test);
  assert.deepStrictEqual(guest.items, [{ id: 'dta_a', found: false, rarity: 'commun' }]);
});

test('dates : « Bientôt » visible à J-7 exactement, pas avant ; disparaît des annonces au début', () => {
  const start = Date.UTC(2032, 2, 1, 9), end = start + DAY;
  publicEvent('dates_b', start, end, [item('dtb_a'), item('dtb_off', { enabled: false })]);
  const up = ms => ev.publicView(null, ms).upcoming.filter(e => e.id === 'dates_b');
  assert.deepStrictEqual(up(start - 7 * DAY - 1), [], 'J-7 moins 1 ms : rien');
  const at = up(start - 7 * DAY);
  assert.strictEqual(at.length, 1);
  assert.strictEqual(at[0].count, 1, 'objets désactivés non comptés');
  assert.deepStrictEqual(up(start), [], 'au début : passe dans « en cours »');
  assert.ok(ev.publicView(null, start).active.some(e => e.id === 'dates_b'));
});

test('dates : le minage d\'avant le début ne compte jamais ; la première sauvegarde pendant l\'événement sert de référence', () => {
  const start = Date.UTC(2033, 0, 5, 12), end = start + DAY;
  publicEvent('dates_c', start, end, [item('dtc_a', { chancePct: 100 })]);
  const u = newUser();
  mine(u, 10, { pierre: 50 });
  assert.deepStrictEqual(ev.processSave(u, { rand: ALWAYS, nowMs: start - 1 }), [], 'planifié : aucun tirage');
  assert.strictEqual(db.getDb().prepare("SELECT COUNT(*) AS n FROM monthly_event_cursors WHERE user_id = ? AND event_id = 'dates_c'").get(u).n, 0,
    'aucun curseur avant le début');
  assert.deepStrictEqual(ev.processSave(u, { rand: ALWAYS, nowMs: start }), [], '50 blocs d\'avant : référence seulement');
  mine(u, 11, { pierre: 51 });
  assert.deepStrictEqual(ev.processSave(u, { rand: ALWAYS, nowMs: start + HOUR }).map(f => f.itemId), ['dtc_a']);
});

// ── Drops événementiels ───────────────────────────────────────────────────────

test('drops publics : tout compte connecté, bornes de profondeur et de probabilité, objet désactivé', () => {
  const start = Date.UTC(2034, 3, 1), end = start + 10 * DAY, now = start + DAY;
  publicEvent('drops_pub', start, end, [
    item('dp_prob', { chancePct: 10 }),
    item('dp_deep', { chancePct: 100, minDepth: 30 }),
    item('dp_off', { chancePct: 100, enabled: false }),
  ]);
  const a = newUser(), b = newUser();
  for (const u of [a, b]) { mine(u, 29, { pierre: 1 }); ev.processSave(u, { nowMs: now }); }

  // 3 blocs à 10 % : P(au moins un) = 1 − 0,9³ = 0,271 — le tirage est comparé à cette valeur
  const p = 1 - Math.pow(0.9, 3);
  mine(a, 29, { pierre: 4 });   // profondeur inchangée : 0 bloc crédité
  mine(a, 32, { pierre: 4 });
  // a : 29 → 32 m, 3 blocs ; b : idem
  mine(b, 32, { pierre: 4 });
  const ga = ev.processSave(a, { nowMs: now, rand: () => p - 1e-9 });
  assert.deepStrictEqual(ga.map(f => f.itemId).sort(), ['dp_deep', 'dp_prob'], 'juste sous la probabilité : trouvé ; profondeur 32 ≥ 30 ; désactivé jamais');
  const gb = ev.processSave(b, { nowMs: now, rand: () => p + 1e-9 });
  assert.deepStrictEqual(gb.map(f => f.itemId), ['dp_deep'], 'juste au-dessus : dp_prob raté ; dp_deep à 100 % toujours trouvé');

  // Profondeur exactement minimale
  const c = newUser();
  mine(c, 29, { pierre: 1 });
  ev.processSave(c, { nowMs: now });
  mine(c, 29, { pierre: 2 });
  assert.deepStrictEqual(ev.processSave(c, { nowMs: now, rand: ALWAYS }).map(f => f.itemId), ['dp_prob'], '29 m < 30 m : objet profond exclu');
  mine(c, 30, { pierre: 3 });
  assert.deepStrictEqual(ev.processSave(c, { nowMs: now, rand: ALWAYS }).map(f => f.itemId), ['dp_deep'], '30 m = minimum : éligible');

  // Barème de la fiche inchangé par les tirages
  const e = ev.getEvent('drops_pub');
  assert.deepStrictEqual(e.items.map(i => [i.id, i.chancePct, i.minDepth, i.enabled]),
    [['dp_prob', 10, 0, true], ['dp_deep', 100, 30, true], ['dp_off', 100, 0, false]]);
});

test('drops : testeur dont le compte a disparu → plus rien ; deux événements simultanés ont des curseurs indépendants', () => {
  const now = Date.UTC(2035, 6, 1, 12);
  const gone = newUser(), keep = newUser();
  ev.createEvent({ id: 'drops_t', icon: '🧪', audience: 'test', testers: [{ id: gone }, { id: keep }], names: tx('T'), taglines: tx('t'),
    startsAt: iso(now - HOUR), endsAt: iso(now + HOUR), items: [item('dt_a', { chancePct: 100 })] });
  ev.scheduleEvent('drops_t', { confirmElapsed: true, nowMs: now });
  publicEvent('drops_p2', now - HOUR, now + HOUR, [item('dp2_a', { chancePct: 100, dropFrom: ['coffre'] })]);

  db.getDb().pragma('foreign_keys = OFF');
  db.getDb().prepare('DELETE FROM users WHERE id = ?').run(gone);
  db.getDb().pragma('foreign_keys = ON');
  assert.ok(ev.getEvent('drops_t').testers.find(t => t.id === gone).missing, 'compte introuvable signalé');
  assert.deepStrictEqual(ev.activeFor(gone, now).map(e => e.id).filter(id => id.startsWith('drops_')), ['drops_p2'], 'TEST retiré, public conservé');

  mine(keep, 10, { pierre: 10 });
  ev.processSave(keep, { nowMs: now });
  const chest = blockCatalog.getPublished().types.find(t => t.category === 'coffre').id;
  mine(keep, 11, { pierre: 11 });
  assert.deepStrictEqual(ev.processSave(keep, { nowMs: now, rand: ALWAYS }).map(f => f.itemId), ['dt_a'], 'pierre : seul l\'objet « tout bloc »');
  mine(keep, 12, { pierre: 11, [chest]: 1 });
  assert.deepStrictEqual(ev.processSave(keep, { nowMs: now, rand: ALWAYS }).map(f => f.itemId), ['dp2_a'], 'coffre : objet du second événement');
  const cur = db.getDb().prepare("SELECT event_id, blocks FROM monthly_event_cursors WHERE user_id = ? AND event_id LIKE 'drops_%' ORDER BY event_id").all(keep);
  assert.deepStrictEqual(cur.map(r => [r.event_id, r.blocks]), [['drops_p2', 2], ['drops_t', 2]]);
});

test('Noël 2026 (base de TEST) : actif du 1/12 00:00 au 1/1 00:00 Bruxelles, objets tirés selon catégorie et profondeur', () => {
  const tmp = fs.mkdtempSync(path.join(dir, 'prep-'));
  fs.copyFileSync(path.join(ROOT, 'server/content/events/noel-2026.json'), path.join(tmp, 'noel-2026.json'));
  assert.deepStrictEqual(ev.importPrepared(tmp), ['noel_2026']);
  assert.strictEqual(ev.getEvent('noel_2026').status, 'draft');
  // Planifié ICI SEULEMENT (base temporaire) pour exercer le câblage complet ; la production reste en brouillon
  ev.scheduleEvent('noel_2026', { confirmRates: true, confirmPublic: true, nowMs: Date.UTC(2026, 10, 5) });
  const open = Date.parse('2026-11-30T23:00:00Z'), close = Date.parse('2026-12-31T23:00:00Z');
  assert.strictEqual(ev.getEvent('noel_2026', open - 1).state, 'planned', '30/11 23:59:59 Bruxelles');
  assert.strictEqual(ev.getEvent('noel_2026', open).state, 'active');
  assert.strictEqual(ev.getEvent('noel_2026', close).state, 'ended', '1/1 00:00 Bruxelles');
  assert.ok(ev.publicView(null, open - 6 * DAY).upcoming.some(e => e.id === 'noel_2026'), 'annoncé le 25/11');

  const u = newUser(), mid = Date.parse('2026-12-10T12:00:00Z');
  mine(u, 30, { pierre: 5, charbon: 5 });
  ev.processSave(u, { nowMs: mid });
  mine(u, 31, { pierre: 6, charbon: 6, coffre_bois: 1 });
  const got = ev.processSave(u, { nowMs: mid, rand: ALWAYS }).map(f => f.itemId).sort();
  // 31 m : charbon (minerai), guirlande (≥ 10 m, tout bloc), clochette (pierre, ≥ 25 m) ;
  // boule à neige (coffre, ≥ 40 m) et carte du traîneau (≥ 80 m) trop profondes
  assert.deepStrictEqual(got, ['noel26_charbon', 'noel26_clochette', 'noel26_guirlande']);
  const toast = ev.processSave(u, { nowMs: mid, rand: ALWAYS });
  assert.deepStrictEqual(toast, [], 'sans nouveau bloc : rien');
  mine(u, 41, { pierre: 6, charbon: 6, coffre_bois: 2 });
  assert.deepStrictEqual(ev.processSave(u, { nowMs: close, rand: ALWAYS }), [], 'après la fin : plus aucun objet');
  const souv = ev.publicView(u, close).souvenirs.find(s => s.id === 'noel_2026');
  assert.deepStrictEqual(souv.items.map(i => i.id).sort(), got, 'souvenirs après la fin');
  // Barème du fichier préparé intact
  assert.deepStrictEqual(ev.getEvent('noel_2026').items.map(i => [i.id, i.chancePct, i.minDepth]),
    NOEL.items.map(i => [i.id, i.chancePct, i.minDepth]));
  ev.unscheduleEvent('noel_2026');
});

// ── Conservation des souvenirs ────────────────────────────────────────────────

test('souvenirs : reset complet #75 les archive, la restauration les rend ; jamais de second exemplaire', () => {
  const now = Date.now();
  publicEvent('souv_reset', now - HOUR, now + DAY, [item('sr_a', { chancePct: 100 }), item('sr_b', { chancePct: 100, minDepth: 50 })]);
  const u = newUser('souv_tester');
  db.upsertUserSave(u, JSON.stringify({ coins: 5, depth: 3 }));
  mine(u, 10, { pierre: 10 });   // pierre : à partir de 5 m (catalogue publié)
  ev.processSave(u);
  mine(u, 11, { pierre: 11 });
  assert.deepStrictEqual(ev.processSave(u, { rand: ALWAYS }).map(f => f.itemId), ['sr_a']);
  const kept = findsOf(u);

  const rev = db.getUserSave(u).version;
  const r = testRuns.resetPlayer(u, { confirmUsername: 'souv_tester', expectedRevision: rev, requestId: 'cov56-reset-1', reason: 'test #56' });
  assert.deepStrictEqual(findsOf(u), [], 'nouvel essai : souvenirs archivés dans l\'instantané');
  const snap = JSON.parse(db.getDb().prepare('SELECT snapshot FROM player_test_runs WHERE id = ?').get(r.runId).snapshot);
  assert.deepStrictEqual(snap.tables.monthly_event_finds.map(x => `${x.event_id}/${x.item_id}`), kept);
  // Nouvel essai : la référence repart de zéro, le joueur peut retrouver l'objet pendant l'événement
  mine(u, 6, { pierre: 1 });
  assert.deepStrictEqual(ev.processSave(u, { rand: ALWAYS }), [], 'première sauvegarde de l\'essai : référence');

  const rev2 = db.getUserSave(u).version;
  testRuns.restoreRun(u, r.runId, { confirmUsername: 'souv_tester', expectedRevision: rev2, requestId: 'cov56-restore-1', reason: 'test #56' });
  assert.deepStrictEqual(findsOf(u), kept, 'restauration : souvenirs revenus à l\'identique');
  mine(u, 12, { pierre: 12 });
  assert.deepStrictEqual(ev.processSave(u, { rand: ALWAYS }), [], 'objet déjà possédé : pas de second exemplaire');
  assert.strictEqual(findsOf(u).length, 1);
  ev.unscheduleEvent('souv_reset');
});

test('souvenirs : objet désactivé ou événement terminé → toujours visibles, images publiées seulement', () => {
  const now = Date.UTC(2036, 1, 1, 12);
  publicEvent('souv_off', now - HOUR, now + HOUR, [item('so_a', { chancePct: 100 }), item('so_b', { chancePct: 100, dropFrom: ['coffre'] })]);
  const u = newUser();
  mine(u, 10, { pierre: 10 });
  ev.processSave(u, { nowMs: now });
  mine(u, 11, { pierre: 11 });
  assert.deepStrictEqual(ev.processSave(u, { nowMs: now, rand: ALWAYS }).map(f => f.itemId), ['so_a']);
  // Désactivation (via brouillon) puis replanification : l'objet trouvé reste affiché, l'autre disparaît s'il est désactivé
  ev.unscheduleEvent('souv_off');
  const e = ev.getEvent('souv_off');
  // Au moins un objet actif reste exigé pour planifier : so_c ajouté
  ev.updateEvent('souv_off', { ...e, items: [...e.items.map(i => ({ ...i, enabled: false })), item('so_c', { chancePct: 1 })] });
  ev.scheduleEvent('souv_off', { confirmRates: true, confirmPublic: true, confirmElapsed: true, nowMs: now });
  const act = ev.publicView(u, now).active.find(x => x.id === 'souv_off');
  assert.deepStrictEqual(act.items.map(i => [i.id, i.found]), [['so_a', true], ['so_c', false]], 'trouvé mais désactivé : visible ; non trouvé désactivé : masqué');
  const ended = ev.publicView(u, now + 2 * HOUR);
  assert.ok(!ended.active.some(x => x.id === 'souv_off'));
  const s = ended.souvenirs.find(x => x.id === 'souv_off');
  assert.deepStrictEqual(s.items.map(i => i.id), ['so_a']);
  assert.strictEqual(s.items[0].image, null, 'aucune image publiée : emoji');
  assert.deepStrictEqual(Object.keys(s.items[0].names).sort(), ['en', 'es', 'fr', 'nl'], 'souvenir traduit dans les 4 langues');
});

// ── Traduction et rendu joueur ────────────────────────────────────────────────

/** Panneau Événements réel (public/js/main.js) exécuté dans un contexte vm avec i18n.js + it.js. */
function playerPanel(payload) {
  const store = new Map();
  const el = { hidden: true, innerHTML: '', querySelectorAll: () => [] };
  const ctx = vm.createContext({
    console, Intl, Date, JSON, Math, Object, Array, Number, String, Boolean, Set, Map, Promise, setTimeout,
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    navigator: { language: 'fr-BE', languages: ['fr-BE'] },
    UiIcons: require('../public/js/uiIcons.js'),   // pictogrammes de l'atelier (#67) : emoji d'origine ici
    location: { search: '', href: 'https://dig.example/' },
    document: { documentElement: {}, querySelectorAll: () => [], getElementById: id => (id === 'events-panel' ? el : null),
      head: { appendChild: () => {} }, createElement: () => ({}) },
  });
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/js/escapeHtml.js'), 'utf8'), ctx);
  for (const f of ['languages.js', 'i18n.js', 'locales/it.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/js', f), 'utf8') + (f === 'i18n.js' ? '\nthis.I18n = I18n; this.t = t;' : ''), ctx);
  }
  const main = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
  const cut = (from, to) => { const a = main.indexOf(from), b = main.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return main.slice(a, b); };
  vm.runInContext([
    cut('function _badgeText(map)', '/** Critère d\'un badge'),
    cut('let _eventsReq = 0;', '/** Fiche dédiée d\'un objet d\'événement'),
    'this.renderEvents = renderEvents; this._badgeText = _badgeText;',
  ].join('\n'), Object.assign(ctx, { _apiFetch: async () => ({ ok: true, data: payload }) }));
  return {
    async render(lang) { ctx.I18n.setLang(lang); await ctx.renderEvents(); return el; },
    t: (k, p) => ctx.t(k, p),
    text: m => ctx._badgeText(m),
    own: (k, lang) => ctx.I18n.get(k, lang),
  };
}

test('rendu joueur : panneau traduit en FR/EN/NL/ES (IT : textes du jeu traduits, contenu en repli FR), objets inconnus masqués, données échappées', async () => {
  const now = Date.UTC(2037, 4, 1, 12);
  publicEvent('rendu', now - HOUR, now + 2 * DAY,
    [item('rd_found', { chancePct: 100, names: { ...tx('Clochette'), fr: 'Clochette "fêlée" & cie' } }), item('rd_secret', { chancePct: 100, minDepth: 999, names: tx('Secret absolu') })],
    { names: tx('Fête'), taglines: tx('Creusez !') });
  publicEvent('rendu_next', now + 3 * DAY, now + 4 * DAY, [item('rn_a')], { names: tx('Bientôt-là') });
  const u = newUser();
  mine(u, 10, { pierre: 10 });
  ev.processSave(u, { nowMs: now });
  mine(u, 11, { pierre: 11 });
  assert.deepStrictEqual(ev.processSave(u, { nowMs: now, rand: ALWAYS }).map(f => f.itemId), ['rd_found']);
  const view = ev.publicView(u, now);
  // Le serveur ne divulgue rien d'un objet non trouvé (ni nom, ni description, ni icône)
  const secret = view.active.find(e => e.id === 'rendu').items.find(i => i.id === 'rd_secret');
  assert.deepStrictEqual(secret, { id: 'rd_secret', found: false, rarity: 'commun' });
  // On garde seulement nos deux événements pour un rendu déterministe
  const payload = JSON.parse(JSON.stringify({ active: view.active.filter(e => e.id === 'rendu'),
    upcoming: view.upcoming.filter(e => e.id === 'rendu_next'), souvenirs: [] }));
  payload.souvenirs = [{ id: 'old', icon: '🎃', names: { fr: 'Ancien <script>x</script>' }, endsAt: iso(now - 30 * DAY),
    items: [{ id: 'o1', found: true, foundAt: iso(now - 31 * DAY), icon: '🕯️', image: '/img/x.png" onerror="alert(1)', names: { fr: 'Bougie' }, descs: {}, rarity: 'rare' }] }];
  const panel = playerPanel(payload);

  for (const [lang, fete] of [['fr', 'Fête'], ['en', 'Fête EN'], ['nl', 'Fête NL'], ['es', 'Fête ES'], ['it', 'Fête']]) {
    const el = await panel.render(lang);
    const html = el.innerHTML;
    assert.strictEqual(el.hidden, false, lang);
    assert.ok(html.includes(`🎊 ${fete} · `), `${lang} : nom de l'événement dans la langue (repli FR pour IT)`);
    for (const key of ['events.section', 'events.souvenirs', 'events.keep']) {
      const txt = panel.t(key);
      assert.ok(txt && txt !== key, `${lang} : ${key} traduit`);
      assert.ok(html.includes(txt.replace(/&/g, '&amp;').replace(/'/g, '&#39;')), `${lang} : ${key} affiché`);
    }
    assert.ok(html.includes(panel.t('events.count', { n: 1, total: 2 })), `${lang} : compteur 1 / 2`);
    assert.ok(html.includes('???'), `${lang} : objet non trouvé en « ??? »`);
    assert.ok(!/Secret absolu/.test(html));
    assert.ok(!/events\.\w+/.test(html), `${lang} : aucune clé technique`);
    assert.ok(html.includes(lang === 'it' || lang === 'fr' ? 'Bientôt-là' : `Bientôt-là ${lang.toUpperCase()}`), `${lang} : annonce à venir`);
  }
  const fr = (await panel.render('fr')).innerHTML;
  assert.ok(fr.includes('<div class="find-name">Clochette &quot;fêlée&quot; &amp; cie</div>'), 'nom de la carte échappé');
  assert.ok(fr.includes('aria-label="Clochette &quot;fêlée&quot; &amp; cie"'), 'libellé accessible échappé');
  assert.ok(!fr.includes('"fêlée"'), 'aucun guillemet brut');
  assert.ok(fr.includes('Ancien &lt;script&gt;'), 'souvenir échappé');
  assert.ok(!fr.includes('<script>') && !fr.includes('" onerror='), 'aucune injection');
  assert.ok(fr.includes('src="/img/x.png&quot; onerror=&quot;alert(1)"'), 'image publiée en <img>, attribut échappé');
  assert.ok(!fr.includes('TEST'), 'événement public : pas de mention TEST');

  // Rien à afficher : panneau masqué
  const empty = playerPanel({ active: [], upcoming: [], souvenirs: [] });
  const el = await empty.render('fr');
  assert.strictEqual(el.hidden, true);
  assert.strictEqual(el.innerHTML, '');
  // Repli des textes d'événement : langue absente → français, carte vide → ''
  assert.strictEqual(empty.text({ fr: 'Bonjour' }), 'Bonjour');
  assert.strictEqual(empty.text(null), '');
});

test('traductions : toutes les clés events.* propres à FR/EN/NL/ES et à la locale IT générée (sans repli)', () => {
  const panel = playerPanel({ active: [], upcoming: [], souvenirs: [] });
  const keys = ['section', 'until', 'upcoming', 'souvenirs', 'test', 'count', 'unknown', 'found_on', 'toast', 'keep', 'ended'];
  for (const lang of ['fr', 'en', 'nl', 'es', 'it']) {
    for (const k of keys) assert.ok(panel.own(`events.${k}`, lang), `${lang} : events.${k}`);
    assert.notStrictEqual(panel.own('events.keep', lang), lang === 'fr' ? null : panel.own('events.keep', 'fr'), `${lang} : texte réellement traduit`);
  }
});
