/**
 * Fenêtre de découverte d'un souvenir d'événement (#56, décision du propriétaire du 10/11/2026) :
 *   - serveur : une ligne « à présenter » par acquisition RÉELLE, écrite dans la transaction du tirage,
 *     jamais pour un rejeu ni pour les trouvailles d'avant ; liste des découvertes non fermées
 *     (F5, coupure, autre appareil) ; acquittement idempotent, limité au joueur ; image publiée seulement ;
 *   - jeu : vraie section de public/js/main.js exécutée en vm — une fenêtre à la fois, jamais deux fois
 *     la même découverte, fermeture manuelle (un clic à côté ne ferme pas), acquittement à la fermeture,
 *     aperçu admin jamais envoyé au serveur, coups manuels ignorés pendant l'affichage.
 * Base temporaire hors server/data/ ; aucun taux ni contenu modifié. Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const vm     = require('vm');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-events-disc-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');
process.env.DIG_AI_FAKE = '1';

const db           = require('../server/db');
const blockCatalog = require('../server/blockCatalog');
const badges       = require('../server/badges');
const ev           = require('../server/monthlyEvents');

const HOUR = 3_600_000, DAY = 24 * HOUR;
let season;
let seq = 0;
const newUser = () => db.getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(`disc_user_${++seq}`, 'x').lastInsertRowid;
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const tx = s => ({ fr: s, en: `${s} EN`, nl: `${s} NL`, es: `${s} ES` });
const item = (id, extra = {}) => ({ id, icon: '🎁', rarity: 'rare', chancePct: 50, minDepth: 0, dropFrom: [], names: tx(`Objet ${id}`), descs: tx(`Desc ${id}`), ...extra });
const ALWAYS = () => 0;

function mine(userId, depth, minedByType) {
  db.upsertDepthTracking(userId, { season_id: season.id, ref_clicks: 0, ref_auto: 0, hand_tokens: 0, auto_tokens: 0,
    accepted_depth: depth, last_gap: 0, updated_ms: Date.now(), dmg_depth: null, dmg_credit: null, dmg_ref_clicks: null, dmg_gap: 0 });
  badges.processSave(userId, { stats: { minedByType } });
}
function publicEvent(id, from, to, items) {
  ev.createEvent({ id, icon: '🎊', audience: 'public', names: tx(`Fête ${id}`), taglines: tx('Accroche'), startsAt: iso(from), endsAt: iso(to), items });
  return ev.scheduleEvent(id, { confirmRates: true, confirmPublic: true, confirmElapsed: true });
}

test.before(() => {
  db.initDb();
  blockCatalog.init();
  badges.init();
  require('../server/blockAi').init();
  ev.init();
  season = db.getActiveSeason();
  assert.ok(season);
});
test.after(() => { db.getDb().close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('serveur : une découverte par acquisition réelle, présentée jusqu\'à fermeture, jamais rejouée', () => {
  const now = Date.UTC(2038, 0, 10, 12);
  publicEvent('disc_a', now - HOUR, now + 5 * DAY, [item('da_one'), item('da_two', { rarity: 'legendaire', icon: '👑' })]);
  ev.init();   // idempotent (redémarrage)
  const u = newUser(), other = newUser();
  mine(u, 10, { pierre: 10 });
  assert.deepStrictEqual(ev.processSave(u, { nowMs: now, rand: ALWAYS }), [], 'premier passage : curseur seulement');
  mine(u, 12, { pierre: 14 });
  const finds = ev.processSave(u, { nowMs: now, rand: ALWAYS });
  assert.deepStrictEqual(finds.map(f => f.itemId), ['da_one', 'da_two']);
  for (const f of finds) {
    assert.ok(Number.isSafeInteger(f.discoveryId) && f.discoveryId > 0);
    assert.strictEqual(f.eventIcon, '🎊');
    assert.strictEqual(f.image, null, 'aucune image publiée : emoji');
    assert.deepStrictEqual(Object.keys(f.descs).sort(), ['en', 'es', 'fr', 'nl']);
    assert.ok(!('chancePct' in f) && !('brief' in f), 'aucune donnée admin envoyée au joueur');
  }
  // Rejeu (même sauvegarde renvoyée, F5) : aucun nouveau tirage, aucune nouvelle découverte
  assert.deepStrictEqual(ev.processSave(u, { nowMs: now, rand: ALWAYS }), []);
  mine(u, 12, { pierre: 30 });
  assert.deepStrictEqual(ev.processSave(u, { nowMs: now, rand: ALWAYS }), [], 'objet déjà possédé : jamais une 2e découverte');

  let pending = ev.pendingDiscoveries(u);
  assert.deepStrictEqual(pending.map(p => p.discoveryId), finds.map(f => f.discoveryId), 'non fermées : présentées au prochain chargement');
  assert.strictEqual(pending[1].rarity, 'legendaire');
  assert.deepStrictEqual(ev.pendingDiscoveries(other), [], 'jamais celles d\'un autre joueur');
  assert.strictEqual(ev.ackDiscoveries(other, [finds[0].discoveryId]), 0, 'un joueur ne peut pas fermer celles d\'un autre');
  assert.strictEqual(ev.ackDiscoveries(u, [finds[0].discoveryId, 'x', -3, 1.5]), 1);
  assert.strictEqual(ev.ackDiscoveries(u, [finds[0].discoveryId]), 0, 'idempotent (deux onglets, double clic)');
  pending = ev.pendingDiscoveries(u);
  assert.deepStrictEqual(pending.map(p => p.itemId), ['da_two']);
  assert.strictEqual(ev.ackDiscoveries(u, null), 0);
  ev.ackDiscoveries(u, [pending[0].discoveryId]);
  assert.deepStrictEqual(ev.pendingDiscoveries(u), []);
  // Les trouvailles restent acquises (la fenêtre ne touche jamais à la collection)
  assert.strictEqual(db.getDb().prepare('SELECT COUNT(*) AS n FROM monthly_event_finds WHERE user_id = ?').get(u).n, 2);
});

test('serveur : trouvailles d\'avant la fonctionnalité jamais présentées ; image publiée seulement ; objet retiré ignoré', () => {
  const now = Date.UTC(2038, 2, 10, 12);
  publicEvent('disc_b', now - HOUR, now + 5 * DAY, [item('db_old'), item('db_new', { image: '/media/icons/0123456789abcdef.webp' })]);
  const u = newUser();
  db.getDb().prepare('INSERT INTO monthly_event_finds (user_id, event_id, item_id, found_at, depth) VALUES (?,?,?,?,?)').run(u, 'disc_b', 'db_old', iso(now - HOUR), 3);
  assert.deepStrictEqual(ev.pendingDiscoveries(u), [], 'trouvaille antérieure : aucune fenêtre a posteriori');
  mine(u, 10, { pierre: 10 });
  ev.processSave(u, { nowMs: now, rand: ALWAYS });
  mine(u, 12, { pierre: 14 });
  const [f] = ev.processSave(u, { nowMs: now, rand: ALWAYS });
  assert.strictEqual(f.itemId, 'db_new');
  assert.strictEqual(f.image, '/media/icons/0123456789abcdef.webp', 'image publiée à la planification : utilisée');
  // Nouvelle image dans la fiche (brouillon) : jamais montrée au joueur avant publication
  db.getDb().prepare("UPDATE monthly_event_items SET image = '/media/icons/fedcba9876543210.webp' WHERE event_id = 'disc_b' AND id = 'db_new'").run();
  assert.strictEqual(ev.pendingDiscoveries(u)[0].image, '/media/icons/0123456789abcdef.webp');
  // Ligne vers un objet introuvable : ignorée sans erreur (et conservée)
  db.getDb().prepare('INSERT INTO monthly_event_discoveries (user_id, event_id, item_id, created_at) VALUES (?,?,?,?)').run(u, 'disc_b', 'disparu', iso(now));
  assert.deepStrictEqual(ev.pendingDiscoveries(u).map(p => p.itemId), ['db_new']);
});

test('serveur : nombre de fenêtres en attente borné', () => {
  const u = newUser();
  const now = Date.UTC(2038, 4, 10, 12);
  publicEvent('disc_c', now - HOUR, now + DAY, [item('dc_x')]);
  const ins = db.getDb().prepare('INSERT INTO monthly_event_discoveries (user_id, event_id, item_id, created_at) VALUES (?,?,?,?)');
  for (let i = 0; i < 15; i++) ins.run(u, 'disc_c', 'dc_x', iso(now));
  assert.strictEqual(ev.pendingDiscoveries(u).length, ev.MAX_PENDING_DISCOVERIES);
});

test('routes : lecture et acquittement réservés au joueur connecté, branchés au chargement du jeu', () => {
  const idx = fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8');
  assert.match(idx, /app\.get\('\/api\/me\/event-discoveries'[\s\S]{0,200}if \(!req\.session\.userId\) return res\.status\(401\)/);
  assert.match(idx, /app\.post\('\/api\/me\/event-discoveries\/ack'[\s\S]{0,200}if \(!req\.session\.userId\) return res\.status\(401\)/);
  const main = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
  assert.match(main, /AntibotGate\.refresh\(\);[^\n]*\n\s*_loadPendingDiscoveries\(\);/, 'découvertes en attente chargées après connexion');
  assert.match(main, /function onBlockHit[^\n]*\n[^\n]*\n\s*if \(discoveryOpen\(\)\) return;/, 'aucun coup manuel sous la fenêtre');
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.match(html, /id="discovery-modal" hidden role="dialog" aria-modal="true" aria-labelledby="discovery-title" aria-describedby="discovery-desc"/);
});

// ── Jeu : section réelle de public/js/main.js ─────────────────────────────────

function gameWindow({ search = '', hash = '', stored = {} } = {}) {
  const els = new Map();
  const mk = id => {
    const e = { id, hidden: id === 'discovery-modal', textContent: '', className: '', children: [], focused: 0,
      appendChild(c) { this.children.push(c); }, replaceChildren(...c) { this.children = c; }, focus() { doc.activeElement = this; this.focused++; } };
    els.set(id, e);
    return e;
  };
  const doc = { activeElement: null, getElementById: id => els.get(id) || mk(id), createElement: tag => ({ tag }), contains: () => true,
    documentElement: {}, querySelectorAll: () => [], head: { appendChild: () => {} } };
  const store = new Map(Object.entries(stored));
  const calls = [];
  const ctx = vm.createContext({
    console, Intl, Date, JSON, Math, Object, Array, Number, String, Boolean, Set, Map, Promise, RegExp,
    setTimeout: fn => fn(),
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    navigator: { language: 'fr-BE', languages: ['fr-BE'] },
    location: { search, hash, pathname: '/', href: `https://dig.example/${search}${hash}` },
    history: { replaceState: (a, b, url) => calls.push(['replace', url]) },
    document: doc,
  });
  ctx.window = ctx;
  for (const f of ['languages.js', 'i18n.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/js', f), 'utf8') + (f === 'i18n.js' ? '\nthis.I18n = I18n; this.t = t;' : ''), ctx);
  }
  const main = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
  const cut = (from, to) => { const a = main.indexOf(from), b = main.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return main.slice(a, b); };
  Object.assign(ctx, {
    _account: { id: 1 }, isViewActive: () => false, renderEvents: () => {}, setNavBadge: () => {}, showAchievement: (...a) => calls.push(['toast', ...a]),
    _apiFetch: async (method, url, body) => { calls.push([method, url, body]); return { ok: true, data: { discoveries: ctx.__pending || [] } }; },
  });
  vm.runInContext([
    cut('function _badgeText(map)', '/** Critère d\'un badge'),
    cut('function _onEventFinds(list)', 'let _eventsReq = 0;'),
    'this._onEventFinds = _onEventFinds; this._loadPendingDiscoveries = _loadPendingDiscoveries; this.discoveryOpen = discoveryOpen;',
    'this._discoveryPreviewFromAdmin = _discoveryPreviewFromAdmin; this._closeDiscovery = _closeDiscovery;',
  ].join('\n'), ctx);
  return { ctx, el: id => doc.getElementById(id), calls, store, doc };
}

const D = (id, extra = {}) => ({ discoveryId: id, eventId: 'nov', itemId: `it${id}`, icon: '🪶', image: null, names: tx(`Plume ${id}`), descs: tx('Une plume.'),
  rarity: 'epique', eventIcon: '📜', eventNames: tx('Novembre'), ...extra });

test('jeu : une fenêtre à la fois, jamais deux fois la même découverte, fermeture manuelle puis acquittement', async () => {
  const g = gameWindow();
  g.ctx.I18n.setLang('fr');
  g.ctx._onEventFinds([D(7), D(8, { rarity: 'legendaire', image: '/assets/events/plume.png' })]);
  assert.ok(g.ctx.discoveryOpen());
  assert.strictEqual(g.el('discovery-modal').hidden, false);
  assert.strictEqual(g.el('discovery-title').textContent, 'Plume 7');
  assert.strictEqual(g.el('discovery-kicker').textContent, '✨ Découverte épique !');
  assert.strictEqual(g.el('discovery-inner').className, 'disc-rarity-epique');
  assert.strictEqual(g.el('discovery-art').textContent, '🪶', 'sans image : emoji');
  assert.match(g.el('discovery-event').textContent, /📜 Novembre/);
  assert.strictEqual(g.el('discovery-desc').textContent, 'Une plume.');
  assert.strictEqual(g.el('discovery-more').hidden, false, 'autre découverte annoncée');
  assert.strictEqual(g.doc.activeElement, g.el('btn-discovery-close'), 'focus sur « Continuer »');
  assert.ok(!g.calls.some(c => c[0] === 'toast'), 'plus de simple toast éphémère');
  // Un clic à côté ne ferme pas ; Tab reste sur le bouton
  assert.strictEqual(g.el('discovery-modal').onclick, null);
  let prevented = 0;
  g.el('discovery-modal').onkeydown({ key: 'Tab', preventDefault: () => prevented++ });
  assert.strictEqual(prevented, 1);
  assert.ok(g.ctx.discoveryOpen());
  // F5 / chargement : la liste du serveur contient encore 7 et 8 → aucune deuxième fenêtre
  g.ctx.__pending = [D(7), D(8)];
  await g.ctx._loadPendingDiscoveries();
  g.el('btn-discovery-close').onclick();
  assert.strictEqual(JSON.stringify(g.calls.filter(c => c[0] === 'POST')), JSON.stringify([['POST', '/api/me/event-discoveries/ack', { ids: [7] }]]));
  assert.strictEqual(g.el('discovery-title').textContent, 'Plume 8', 'la suivante');
  assert.strictEqual(g.el('discovery-art').children[0].src, '/assets/events/plume.png', 'image publiée');
  assert.strictEqual(g.el('discovery-more').hidden, true);
  g.el('discovery-modal').onkeydown({ key: 'Escape', preventDefault: () => {} });
  assert.strictEqual(g.ctx.discoveryOpen(), false);
  assert.strictEqual(g.el('discovery-modal').hidden, true);
  assert.strictEqual(JSON.stringify(g.calls.filter(c => c[0] === 'POST').map(c => c[2].ids[0])), '[7,8]');
  g.ctx._onEventFinds([D(8)]);
  assert.strictEqual(g.ctx.discoveryOpen(), false, 'même acquisition renvoyée : pas de doublon');
});

test('jeu : découverte non acquittée présentée au chargement ; textes traduits ; données en texte seul', async () => {
  const g = gameWindow();
  g.ctx.I18n.setLang('nl');
  g.ctx.__pending = [D(21, { names: { fr: '<img src=x onerror=alert(1)>' }, rarity: 'commun', duplicate: true, qty: 2, image: 'javascript:alert(1)' })];
  await g.ctx._loadPendingDiscoveries();
  assert.ok(g.ctx.discoveryOpen());
  assert.strictEqual(g.el('discovery-title').textContent, '<img src=x onerror=alert(1)>', 'texte, jamais du HTML');
  assert.strictEqual(g.el('discovery-art').textContent, '🪶', 'adresse d\'image non locale refusée');
  assert.strictEqual(g.el('discovery-kicker').textContent, '✨ Nieuw aandenken!');
  assert.strictEqual(g.el('discovery-note').textContent, 'Nieuw exemplaar: je hebt er nu 2.');
  assert.strictEqual(g.el('btn-discovery-close').textContent, 'Verder');
  for (const lang of ['fr', 'en', 'nl', 'es']) {
    for (const k of ['disc_commun', 'disc_peu_commun', 'disc_rare', 'disc_epique', 'disc_legendaire', 'disc_event', 'disc_dup', 'disc_keep', 'disc_continue', 'disc_more', 'disc_preview']) {
      assert.ok(g.ctx.I18n.get(`events.${k}`, lang), `${lang} events.${k}`);
    }
  }
});

test('jeu : aperçu admin affiché une fois, marqué, jamais envoyé au serveur ni stocké', () => {
  const admin = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
  assert.match(admin, /window\.open\(`\/\?apercu-decouverte=1#apercu=\$\{encodeURIComponent\(JSON\.stringify\(d\)\)\}`, '_blank', 'noopener'\)/);
  const payload = JSON.stringify({ icon: '🔔', image: null, names: tx('Cloche'), descs: tx('Ding.'), rarity: 'rare', eventIcon: '🎄', eventNames: tx('Noël') });
  const g = gameWindow({ search: '?apercu-decouverte=1', hash: `#apercu=${encodeURIComponent(payload)}` });
  g.ctx.I18n.setLang('fr');
  g.ctx._discoveryPreviewFromAdmin();
  assert.ok(g.ctx.discoveryOpen());
  assert.strictEqual(g.el('discovery-preview').hidden, false);
  assert.match(g.el('discovery-preview').textContent, /rien n.est ajouté/);
  assert.strictEqual(g.el('discovery-title').textContent, 'Cloche');
  assert.strictEqual(JSON.stringify(g.calls), '[["replace","/"]]', 'fragment effacé de l\'adresse (pas de nouvel affichage après F5)');
  g.ctx._closeDiscovery();
  assert.strictEqual(g.calls.length, 1, 'aucun appel serveur');
  const h = gameWindow({ search: '', hash: `#apercu=${encodeURIComponent(payload)}` });
  h.ctx._discoveryPreviewFromAdmin();
  assert.strictEqual(h.ctx.discoveryOpen(), false, 'sans le paramètre : rien');
});
