/**
 * Tests des badges et succès honorifiques (ticket #38) : première série, statistiques bornées par
 * la profondeur retenue par le serveur, attribution unique, archivage sans perte, événements,
 * validation et journal admin, absence de toute récompense économique, routes HTTP.
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
const PORT = process.env.DIG_TEST_PORT_BADGES || '3163';
const BASE = `http://127.0.0.1:${PORT}`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-badges-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db           = require('../server/db');
const blockCatalog = require('../server/blockCatalog');
const badges       = require('../server/badges');

let season;
let userSeq = 0;
const T0 = Date.UTC(2026, 9, 30, 12, 0, 0);

function newUser() {
  return db.getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(`badge_user_${++userSeq}`, 'x').lastInsertRowid;
}

/** Profondeur retenue par le serveur (#9/#25) pour la saison donnée. */
function setAccepted(userId, depth, seasonId = season.id) {
  db.upsertDepthTracking(userId, { season_id: seasonId, ref_clicks: 0, ref_auto: 0, hand_tokens: 0, auto_tokens: 0,
    accepted_depth: depth, last_gap: 0, updated_ms: T0, dmg_depth: null, dmg_credit: null, dmg_ref_clicks: null, dmg_gap: 0 });
}

const rawSave = (userId, minedByType, nowMs = T0) => badges.processSave(userId, { stats: { minedByType } }, { nowMs });
/** Sauvegarde + confirmation d'affichage par le client (comme le jeu) : ne renvoie que les nouveaux badges. */
const save = (userId, minedByType, nowMs = T0) => {
  const r = rawSave(userId, minedByType, nowMs);
  badges.markNotified(userId, r.map(b => b.id));
  return r;
};
const stats = userId => Object.fromEntries(db.getDb().prepare('SELECT stat, value FROM badge_player_stats WHERE user_id = ?').all(userId).map(r => [r.stat, r.value]));
const owned = userId => db.getDb().prepare('SELECT badge_id FROM player_badges WHERE user_id = ? ORDER BY badge_id').all(userId).map(r => r.badge_id);

test.before(() => {
  db.initDb();
  blockCatalog.init();
  badges.init();
  season = db.getActiveSeason();
  assert.ok(season, 'saison active du seed');
});

test.after(() => {
  db.getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('première série : seuls « 100 m » et « pierre ×100 » sont actifs ; init idempotent sans écraser l\'admin', () => {
  const list = badges.listBadges();
  assert.strictEqual(list.length, badges.SEED.length);
  assert.deepStrictEqual(list.filter(b => b.status === 'active').map(b => b.id).sort(), ['pierre_100', 'profondeur_100']);
  const stone = list.find(b => b.id === 'pierre_100');
  assert.strictEqual(stone.condition, 'blocks_of_type');
  assert.strictEqual(stone.blockId, 'pierre');
  for (const b of list) for (const l of ['fr', 'en', 'nl']) assert.ok(b.names[l] && b.descriptions[l], `${b.id} ${l}`);
  badges.setStatus('profondeur_1000', 'archived');
  badges.init();
  assert.strictEqual(badges.listBadges().length, badges.SEED.length);
  assert.strictEqual(badges.getBadgeRow('profondeur_1000').status, 'archived');
  badges.setStatus('profondeur_1000', 'inactive');
});

test('pierre ×100 : crédit borné par les mètres retenus, badge attribué une seule fois', () => {
  const u = newUser();
  setAccepted(u, 60);
  assert.deepStrictEqual(save(u, { pierre: 150 }), []);
  assert.strictEqual(stats(u)['blocks:pierre'], 60, 'jamais plus de blocs crédités que de mètres retenus');
  setAccepted(u, 130);
  const earned = rawSave(u, { pierre: 150 });
  assert.deepStrictEqual(earned.map(b => b.id).sort(), ['pierre_100', 'profondeur_100']);
  assert.strictEqual(stats(u)['blocks:pierre'], 130);
  assert.strictEqual(stats(u).max_depth, 130);
  // Réponse perdue (F5, réseau) : la notification est renvoyée tant que le client ne l'a pas confirmée
  assert.deepStrictEqual(rawSave(u, { pierre: 150 }).map(b => b.id).sort(), ['pierre_100', 'profondeur_100']);
  assert.strictEqual(badges.markNotified(u, ['pierre_100', 'profondeur_100', 'inconnu', 42]), 2);
  assert.strictEqual(badges.markNotified(u, ['pierre_100']), 0, 'confirmation rejouée : sans effet');
  // Rejouer, renvoyer, monter encore : jamais une seconde attribution ni une seconde notification
  setAccepted(u, 400);
  assert.deepStrictEqual(save(u, { pierre: 150 }), []);
  assert.deepStrictEqual(save(u, { pierre: 150 }), []);
  assert.deepStrictEqual(owned(u), ['pierre_100', 'profondeur_100']);
  assert.strictEqual(stats(u)['blocks:pierre'], 150);
});

test('notification de déblocage : badges déjà obtenus avant la colonne = notifiés, migration idempotente', () => {
  const u = newUser();
  // Ligne telle qu'écrite avant la recette #38-E (sans valeur pour notified)
  db.getDb().prepare('INSERT INTO player_badges (user_id, badge_id, earned_at, value) VALUES (?, ?, ?, ?)').run(u, 'profondeur_100', new Date(T0).toISOString(), 100);
  assert.deepStrictEqual(badges.pendingNotifications(u), [], 'aucun toast rétroactif');
  badges.init();
  badges.init();
  assert.strictEqual(db.getDb().prepare('PRAGMA table_info(player_badges)').all().filter(c => c.name === 'notified').length, 1);
  assert.deepStrictEqual(owned(u), ['profondeur_100']);
  // Autre joueur : sa notification ne peut pas être confirmée par quelqu'un d'autre
  const v = newUser();
  setAccepted(v, 120);
  assert.deepStrictEqual(rawSave(v, {}).map(b => b.id), ['profondeur_100']);
  assert.strictEqual(badges.markNotified(u, ['profondeur_100']), 0);
  assert.deepStrictEqual(badges.pendingNotifications(v).map(b => b.id), ['profondeur_100']);
  assert.deepStrictEqual(Object.keys(badges.pendingNotifications(v)[0]).sort(), ['icon', 'id', 'image', 'names']);
});

test('vue joueur : critère exposé pour la fiche, jamais pour un badge secret non obtenu', () => {
  const u = newUser();
  const view = badges.playerView(u);
  assert.deepStrictEqual(view.badges.find(b => b.id === 'profondeur_100').criterion, { condition: 'max_depth', blockId: null, threshold: 100 });
  assert.deepStrictEqual(view.badges.find(b => b.id === 'pierre_100').criterion, { condition: 'blocks_of_type', blockId: 'pierre', threshold: 100 });
  for (const b of view.badges.filter(x => x.hidden)) assert.strictEqual(b.criterion, null);
});

test('compteurs forgés : type inconnu, type hors de portée et profondeur déclarée ignorés', () => {
  const u = newUser();
  setAccepted(u, 50);
  const r = badges.processSave(u, { stats: { minedByType: { inconnu_x: 999, diamant: 40, pierre: -3, 'Bad Id': 5, granite: 2.5 } },
    seasonStats: { maxDepth: 1e9 } }, { nowMs: T0 });
  assert.deepStrictEqual(r, []);
  assert.deepStrictEqual(stats(u), { max_depth: 50 }, 'diamant (dès 120 m) jamais crédité à 50 m');
  // Aucune profondeur retenue pour la saison active : rien n'est crédité
  const v = newUser();
  setAccepted(v, 500, season.id + 999);
  assert.deepStrictEqual(save(v, { pierre: 200 }), []);
  assert.deepStrictEqual(stats(v), {});
});

test('compteur remis à zéro côté client : nouvelle référence, aucun crédit en double', () => {
  const u = newUser();
  setAccepted(u, 40);
  save(u, { pierre: 30 });
  assert.strictEqual(stats(u)['blocks:pierre'], 30);
  setAccepted(u, 100);
  save(u, { pierre: 5 });                       // réinitialisation de la partie
  assert.strictEqual(stats(u)['blocks:pierre'], 30);
  save(u, { pierre: 25 });
  assert.strictEqual(stats(u)['blocks:pierre'], 50);
});

test('total, coffres, types distincts et jours de jeu (Europe/Brussels)', () => {
  const u = newUser();
  setAccepted(u, 40);
  save(u, { terre_meuble: 10, pierre: 5, vieille_caisse: 2, coffre_bois: 1 }, T0);
  save(u, { terre_meuble: 12, pierre: 5, vieille_caisse: 2, coffre_bois: 1 }, T0 + 3600e3);   // même jour
  setAccepted(u, 60);
  save(u, { terre_meuble: 13, pierre: 5, vieille_caisse: 2, coffre_bois: 1 }, T0 + 86400e3);  // lendemain
  save(u, { terre_meuble: 13, pierre: 5, vieille_caisse: 2, coffre_bois: 1 }, T0 + 2 * 86400e3); // rien de miné
  const s = stats(u);
  assert.strictEqual(s.blocks_total, 21);
  assert.strictEqual(s.chests_opened, 3);
  assert.strictEqual(s.play_days, 2, 'un jour sans bloc crédité ne compte pas');
  const view = badges.playerView(u);
  const pv = b => view.badges.find(x => x.id === b);
  assert.deepStrictEqual(pv('pierre_100').progress, { value: 5, target: 100 });
  assert.deepStrictEqual(pv('profondeur_100').progress, { value: 60, target: 100 });
  assert.strictEqual(pv('fidele_7'), undefined, 'badge désactivé non obtenu : invisible');
});

test('aucune récompense économique : ni sauvegarde, ni compte, ni classement modifiés', () => {
  const u = newUser();
  db.upsertUserSave(u, JSON.stringify({ coins: 77, gems: 3, relicFragments: 5 }));
  const snap = () => JSON.stringify([
    db.getDb().prepare('SELECT * FROM users WHERE id = ?').get(u),
    db.getDb().prepare('SELECT data, version, saved_at FROM user_saves WHERE user_id = ?').get(u),
    db.getDb().prepare('SELECT * FROM season_rankings WHERE user_id = ?').all(u),
  ]);
  const before = snap();
  setAccepted(u, 200);
  assert.strictEqual(save(u, { pierre: 150 }).length, 2);
  assert.strictEqual(snap(), before);
});

test('archivage et désactivation : badges obtenus conservés, plus aucune attribution', () => {
  badges.createBadge({ id: 'test_archive', category: 'minage', icon: '🧪', condition: 'blocks_total', threshold: 5, status: 'active',
    names: { fr: 'Archive' }, descriptions: { fr: 'Test' } });
  const a = newUser(), b = newUser();
  setAccepted(a, 20); setAccepted(b, 20);
  assert.ok(save(a, { pierre: 6 }).some(x => x.id === 'test_archive'));
  badges.setStatus('test_archive', 'archived');
  assert.ok(!save(b, { pierre: 6 }).some(x => x.id === 'test_archive'));
  assert.ok(owned(a).includes('test_archive'));
  const va = badges.playerView(a).badges.find(x => x.id === 'test_archive');
  assert.ok(va.earned && va.archived && va.earnedAt);
  assert.strictEqual(badges.playerView(b).badges.find(x => x.id === 'test_archive'), undefined);
  // Réactivé : le joueur b l'obtient avec ses statistiques suivies
  badges.setStatus('test_archive', 'active');
  assert.ok(save(b, { pierre: 6 }).some(x => x.id === 'test_archive'));
});

test('événement : seule la progression pendant la période compte ; badge conservé après la fin', () => {
  const start = new Date(T0 + 3600e3).toISOString();
  const end = new Date(T0 + 3 * 3600e3).toISOString();
  badges.createBadge({ id: 'test_event', category: 'evenement', icon: '🎃', condition: 'blocks_total', threshold: 10, status: 'active',
    startsAt: start, endsAt: end, visibility: 'hidden', names: { fr: 'Halloween' }, descriptions: { fr: 'Miner 10 blocs pendant Halloween' } });
  const u = newUser();
  setAccepted(u, 100);
  save(u, { pierre: 50 }, T0);                          // avant l'événement
  assert.strictEqual(badges.playerView(u, { nowMs: T0 }).badges.find(x => x.id === 'test_event'), undefined);
  assert.deepStrictEqual(save(u, { pierre: 50 }, T0 + 3700e3).map(x => x.id), []);   // début : base = 50
  const hidden = badges.playerView(u, { nowMs: T0 + 3700e3 }).badges.find(x => x.id === 'test_event');
  assert.ok(hidden.hidden && hidden.names === null && hidden.icon === '❔');
  assert.strictEqual(hidden.criterion, null, 'critère d’un badge secret non obtenu jamais exposé');
  assert.deepStrictEqual(save(u, { pierre: 59 }, T0 + 4000e3).map(x => x.id), []);
  assert.deepStrictEqual(save(u, { pierre: 60 }, T0 + 4100e3).map(x => x.id), ['test_event']);
  const after = badges.playerView(u, { nowMs: T0 + 5 * 3600e3 }).badges.find(x => x.id === 'test_event');
  assert.ok(after.earned && after.names.fr === 'Halloween', 'toujours dans la collection après la fin');
  const late = newUser();
  setAccepted(late, 100);
  assert.deepStrictEqual(save(late, { pierre: 80 }, T0 + 4 * 3600e3).map(x => x.id).filter(x => x === 'test_event'), []);
});

test('admin : validation, identifiant unique, aperçu, modification et journal', () => {
  assert.throws(() => badges.createBadge({ id: 'X', category: 'nope', icon: '', condition: 'blocks_of_type', blockId: 'inexistant',
    threshold: 0, names: {}, descriptions: {}, image: 'https://evil.example/x.png', startsAt: '2026-11-02T00:00:00Z', endsAt: '2026-11-01T00:00:00Z' }),
  err => err instanceof badges.BadgeError && err.status === 400 && err.details.length >= 7);
  assert.throws(() => badges.createBadge({ ...badges.SEED[0] }), err => err.status === 409);
  const p = badges.previewBadge({ category: 'minage', icon: '🪨', condition: 'blocks_of_type', blockId: 'pierre', threshold: 100,
    names: { fr: 'P' }, descriptions: { fr: 'D' } });
  assert.ok(p.playersTracked > 0 && p.wouldEarnNow >= 1, JSON.stringify(p));
  const up = badges.updateBadge('pierre_100', { threshold: 120, names: { fr: 'Tailleur', en: 'Cutter' } });
  assert.strictEqual(up.threshold, 120);
  assert.strictEqual(up.status, 'active');
  assert.throws(() => badges.updateBadge('absent', {}), err => err.status === 404);
  assert.throws(() => badges.setStatus('pierre_100', 'deleted'), err => err.status === 400);
  const actions = badges.listAudit().map(a => a.action);
  for (const a of ['seed', 'create', 'update', 'status']) assert.ok(actions.includes(a), a);
  badges.updateBadge('pierre_100', { threshold: 100, names: badges.SEED[1].names });
});

// ── HTTP : sauvegarde réelle, toast, vue joueur, panel ────────────────────────

test('HTTP : badge obtenu via /api/me/save, vue joueur, routes admin protégées', async () => {
  const httpDb = path.join(dir, 'http.sqlite');
  const adminSecret = crypto.randomBytes(16).toString('hex');
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: httpDb, ADMIN_SECRET: adminSecret, SESSION_SECRET: crypto.randomBytes(16).toString('hex') },
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

    assert.strictEqual((await fetch(`${BASE}/api/admin/badges`)).status, 401);
    const cr = await fetch(`${BASE}/api/admin/badges`, { method: 'POST', headers: admin, body: JSON.stringify({
      id: 'http_terre', category: 'minage', icon: '🟫', condition: 'blocks_of_type', blockId: 'terre_meuble', threshold: 2, status: 'active',
      names: { fr: 'Terrassier <b>', en: 'Digger' }, descriptions: { fr: 'Miner 2 blocs de terre' } }) });
    assert.strictEqual(cr.status, 200, await cr.clone().text());
    const bad = await fetch(`${BASE}/api/admin/badges`, { method: 'POST', headers: admin, body: JSON.stringify({ id: 'x' }) });
    assert.strictEqual(bad.status, 400);
    assert.ok(Array.isArray((await bad.json()).details));

    const reg = await fetch(`${BASE}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'badgehttp', email: 'badgehttp@example.invalid', password: 'secret123' }) });
    assert.strictEqual(reg.status, 200);
    const cookie = reg.headers.get('set-cookie').split(';')[0];
    assert.strictEqual((await fetch(`${BASE}/api/me/badges`)).status, 401);

    const seasonId = (await (await fetch(`${BASE}/api/seasons/current`)).json()).season.id;
    const send = (ss, mined) => fetch(`${BASE}/api/me/save`, {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { coins: 10, lastSaveTime: Date.now(), stats: { minedByType: mined }, seasonStats: { seasonId, ...ss } } }),
    }).then(r => r.json());
    await send({ maxDepth: 0, manualBlocks: 0, manualClicks: 0, autoBlocks: 0 }, {});
    await new Promise(r => setTimeout(r, 1100));
    const r1 = await send({ maxDepth: 4, manualBlocks: 3, manualClicks: 6, autoBlocks: 0 }, { terre_meuble: 3 });
    assert.ok(r1.ok);
    assert.deepStrictEqual((r1.badgesEarned || []).map(b => b.id), ['http_terre'], JSON.stringify(r1));
    const r2 = await send({ maxDepth: 4, manualBlocks: 3, manualClicks: 6, autoBlocks: 0 }, { terre_meuble: 3 });
    assert.deepStrictEqual((r2.badgesEarned || []).map(b => b.id), ['http_terre'], 'non confirmée : renvoyée');
    assert.strictEqual((await fetch(`${BASE}/api/me/badges/seen`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"ids":["http_terre"]}' })).status, 401);
    const seen = await fetch(`${BASE}/api/me/badges/seen`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ['http_terre'] }) });
    assert.deepStrictEqual(await seen.json(), { ok: true, marked: 1 });
    const r3 = await send({ maxDepth: 4, manualBlocks: 3, manualClicks: 6, autoBlocks: 0 }, { terre_meuble: 3 });
    assert.strictEqual(r3.badgesEarned, undefined, 'une seule attribution, une seule notification');

    const view = await (await fetch(`${BASE}/api/me/badges`, { headers: { Cookie: cookie } })).json();
    const got = view.badges.find(b => b.id === 'http_terre');
    assert.ok(got.earned && got.earnedAt && got.names.fr === 'Terrassier <b>');
    assert.deepStrictEqual(view.badges.find(b => b.id === 'profondeur_100').progress, { value: 4, target: 100 });

    const saved = await (await fetch(`${BASE}/api/me/save`, { headers: { Cookie: cookie } })).json();
    assert.strictEqual(saved.save.data.coins, 10, 'aucune pièce ajoutée');

    const summary = await (await fetch(`${BASE}/api/admin/badges`, { headers: admin })).json();
    assert.strictEqual(summary.badges.find(b => b.id === 'http_terre').earnedCount, 1);
    assert.ok(summary.blockTypes.some(t => t.id === 'pierre'));
    const st = await fetch(`${BASE}/api/admin/badges/http_terre/status`, { method: 'POST', headers: admin, body: JSON.stringify({ status: 'archived' }) });
    assert.strictEqual(st.status, 200);
    const view2 = await (await fetch(`${BASE}/api/me/badges`, { headers: { Cookie: cookie } })).json();
    assert.ok(view2.badges.find(b => b.id === 'http_terre').earned, 'badge archivé conservé');
    const audit = await (await fetch(`${BASE}/api/admin/badges/audit`, { headers: admin })).json();
    assert.ok(audit.entries.some(a => a.action === 'status' && a.badgeId === 'http_terre'));
  } finally {
    const done = new Promise(r => server.once('exit', r));
    server.kill();
    await done;
  }
});

test('client : compteur par type, section Badges, textes FR/EN/NL, rendu échappé', () => {
  const main = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
  const i18n = fs.readFileSync(path.join(ROOT, 'public/js/i18n.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const saveJs = fs.readFileSync(path.join(ROOT, 'public/js/save.js'), 'utf8');
  assert.match(main, /GameState\.stats\.minedByType\[minedId\]/);
  assert.match(main, /badgesEarned/);
  assert.match(html, /id="badges-panel"/);
  assert.match(saveJs, /minedByType/);
  assert.strictEqual((i18n.match(/toast: '(Badge débloqué|Badge unlocked|Badge vrijgespeeld|Insignia desbloqueada)/g) || []).length, 4);
  const fn = main.slice(main.indexOf('async function renderBadges'), main.indexOf('// ── Rendu collection'));
  for (const field of ['name', 'desc', 'b.icon']) assert.ok(fn.includes(`escapeHtml(${field})`), field);
});

test('recette #38-C/E : critère traduit dans toutes les langues, fiche au clic, notification confirmée', () => {
  const main = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
  const admin = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const i18n = fs.readFileSync(path.join(ROOT, 'public/js/i18n.js'), 'utf8');
  const it = fs.readFileSync(path.join(ROOT, 'public/js/locales/it.js'), 'utf8');
  // Un modèle de critère par condition et par langue (FR/EN/NL/ES intégrées + pilote italien)
  for (const c of badges.CONDITIONS) {
    assert.strictEqual((i18n.match(new RegExp(`\\b${c}: '[^']*\\{n\\}`, 'g')) || []).length, 4, c);
    assert.match(it, new RegExp(`"${c}": "[^"]*\\{n\\}`), `it ${c}`);
  }
  assert.match(i18n, /max_depth: 'Depth ≥ \{n\} m'/);
  assert.match(admin, /bgCondLabel\(f, l\)/, 'aperçu admin : critère dans la langue éditée');
  assert.match(html, /id="find-modal-extra"/);
  const sheet = main.slice(main.indexOf('function _openItemSheet'), main.indexOf('// ── Rendu quotidien'));
  assert.ok(!/innerHTML\s*=\s*[^'`]/.test(sheet.replace("rarity.innerHTML = '';", '')), 'fiche : texte seul');
  assert.match(main, /class="badge-card[^"]*" data-badge=/);
  assert.match(main, /showBadgeSheet\(b, card\)/);
  assert.match(main, /'\/api\/me\/badges\/seen'/);
  assert.match(main, /showAchievement\('🏅', t\('badges\.toast'/);
});
