/**
 * Tests des missions quotidiennes attribuées et réclamées par le serveur, ticket #68 (étape B) :
 * - drapeau OFF par défaut : rien n'est lu ni écrit, le jeu garde ses missions (vue { live: false }) ;
 * - mode pilote limité aux comptes listés, activation pour tous avec note obligatoire, journal en ajout seul ;
 * - attribution unique par joueur et par jour (Europe/Brussels) : F5 / autre appareil → mêmes missions ;
 *   une publication du catalogue ne change pas les missions déjà attribuées ; la v1 en rotation
 *   d'origine donne exactement les missions du jeu actuel pour la date ;
 * - progression = compteurs de la sauvegarde serveur, cumulée (une baisse ne retire rien) ;
 * - réclamation : refusée si pas terminée, créditée une seule fois (rejeu, requêtes simultanées,
 *   deux appareils), refusée hors contrôleur de partie (#35), journée terminée refusée ;
 * - rotation adaptative par joueur avec anti-répétition sur l'historique du joueur ;
 * - routes HTTP (port ≠ 3000) : vue joueur, réclamation concurrente, administration protégée.
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

const ROOT  = path.join(__dirname, '..');
const PORT  = process.env.DIG_TEST_PORT_MISSIONS_LIVE || '3196';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-missions-live-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db      = require('../server/db');
const blocks  = require('../server/blockCatalog');
const catalog = require('../server/missionCatalog');
const live    = require('../server/missionsLive');

db.initDb();
blocks.init();
catalog.init();
live.init();

const T0 = Date.parse('2026-11-05T10:00:00Z');
const DAY = 864e5;
const conn = () => db.getDb();
const errCode = fn => { try { fn(); return null; } catch (e) { if (!(e instanceof live.MissionError)) throw e; return e.code; } };
const save = (userId, data) => db.upsertUserSave(userId, JSON.stringify(data));
const load = userId => JSON.parse(db.getUserSave(userId).data);
const baseSave = extra => ({ coins: 100, gems: 2, depth: 40, pickaxeLevel: 3, upgrades: { luck: 1, bag: 1, autodig: 0, fragment_shop: 0 },
  stats: { blocksDestroyed: 500, totalCoinsEarned: 9000, gemsFound: 3, chestsFound: 4, totalUpgradesBought: 6 }, ...extra });
/** Tous les compteurs nettement au-dessus de n'importe quel objectif de la v1. */
const progressed = (d, k = 1) => ({ ...d, depth: d.depth + 200 * k, stats: { ...d.stats, blocksDestroyed: d.stats.blocksDestroyed + 1000 * k,
  totalCoinsEarned: d.stats.totalCoinsEarned + 100_000 * k, gemsFound: d.stats.gemsFound + 10 * k, chestsFound: d.stats.chestsFound + 10 * k,
  totalUpgradesBought: d.stats.totalUpgradesBought + 10 * k } });
let n = 0;
const newUser = () => { n++; return db.createUser(`joueur${n}`, `joueur${n}@example.invalid`, 'x').id; };
const nameOf = id => db.getUserById(id).username;
const rows = table => conn().prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;

test('drapeau OFF par défaut : aucune lecture ni écriture, missions du navigateur inchangées', () => {
  const u = newUser();
  save(u, baseSave());
  assert.strictEqual(live.getMode(), 'off');
  assert.strictEqual(live.isLiveFor(u), false);
  assert.strictEqual(catalog.isLive(), false);
  assert.deepStrictEqual(live.playerView(u, { nowMs: T0 }), { live: false });
  assert.strictEqual(live.observeSave(u, progressed(baseSave()), { nowMs: T0 }), null);
  assert.strictEqual(errCode(() => live.claim(u, { slot: 0, nowMs: T0 })), 'not_live');
  assert.strictEqual(rows('daily_mission_days'), 0);
  assert.strictEqual(rows('daily_mission_claims'), 0);
  assert.strictEqual(load(u).coins, 100);
});

test('pilote : comptes listés seulement ; « on » exige une note ; journal en ajout seul', () => {
  const a = newUser(), b = newUser();
  assert.strictEqual(errCode(() => live.setSettings({ mode: 'pilot', pilots: ['inconnu_zz'] })), 'unknown_user');
  assert.strictEqual(errCode(() => live.setSettings({ mode: 'bientot' })), 'bad_mode');
  const s = live.setSettings({ mode: 'pilot', pilots: [` ${nameOf(a).toUpperCase()} `] });
  assert.strictEqual(s.mode, 'pilot');
  assert.deepStrictEqual(s.pilots, [nameOf(a)]);
  assert.strictEqual(live.isLiveFor(a), true);
  assert.strictEqual(live.isLiveFor(b), false);
  assert.strictEqual(catalog.isLive(), false, 'pilote : le manifeste d\'icônes de tous les joueurs reste inchangé');
  assert.strictEqual(errCode(() => live.setSettings({ mode: 'on' })), 'note_required');
  assert.strictEqual(live.getMode(), 'pilot');
  assert.throws(() => conn().prepare('UPDATE mission_live_audit SET action = ?').run('x'), /ajout seul/);
  assert.throws(() => conn().prepare('DELETE FROM mission_live_audit').run(), /ajout seul/);
  assert.ok(live.listAudit().some(e => e.details.to === 'pilot'));
  live.setSettings({ mode: 'off', pilots: [] });
  assert.strictEqual(live.isLiveFor(a), false);
});

test('attribution : une fois par jour Bruxelles, identique au jeu (v1), inchangée par une publication', () => {
  const u = newUser();
  live.setSettings({ mode: 'pilot', pilots: [nameOf(u)] });
  save(u, baseSave());
  const v1 = live.playerView(u, { nowMs: T0 });
  assert.strictEqual(v1.live, true);
  assert.strictEqual(v1.day, '2026-11-05');
  assert.strictEqual(v1.missions.length, 3);
  // Rotation d'origine de la v1 = DailyMissions._generate du navigateur pour la même date
  const { DailyMissions } = catalog.clientMissions();
  const expected = JSON.parse(JSON.stringify(DailyMissions._generate('2026-11-05').map(m => ({ id: m.id, target: m.target, reward: m.reward }))));
  assert.deepStrictEqual(v1.missions.map(m => ({ id: m.id, target: m.target, reward: m.reward })), expected);
  assert.ok(v1.missions.every(m => m.progress === 0 && !m.claimed && m.names.fr && m.descs.fr.includes('{t}')));
  // 23:30 Bruxelles = même journée ; F5 = mêmes missions, aucune nouvelle ligne
  assert.deepStrictEqual(live.playerView(u, { nowMs: Date.parse('2026-11-05T22:30:00Z') }).missions.map(m => m.id), v1.missions.map(m => m.id));
  assert.strictEqual(conn().prepare('SELECT COUNT(*) AS c FROM daily_mission_days WHERE user_id = ?').get(u).c, 1);
  // Publication d'une nouvelle version : les missions déjà attribuées restent celles du matin
  const draftMission = { ...catalog.getPublished().missions.find(m => m.id === v1.missions[0].id) };
  draftMission.reward = { ...draftMission.reward, coinsPerUnit: draftMission.reward.coinsPerUnit + 1 };
  catalog.upsertDraftMission(draftMission);
  catalog.publishDraft({ note: 'test' });
  assert.deepStrictEqual(live.playerView(u, { nowMs: T0 }).missions.map(m => m.reward), v1.missions.map(m => m.reward));
  catalog.rollbackTo(1, { note: 'test' });
  // 00:30 Bruxelles le lendemain (23:30 UTC) : nouvelle journée
  assert.strictEqual(live.playerView(u, { nowMs: Date.parse('2026-11-05T23:30:00Z') }).day, '2026-11-06');
  live.setSettings({ mode: 'off', pilots: [] });
});

test('progression cumulée et réclamation unique : pas terminée, crédit, rejeu, baisse, contrôleur', () => {
  const u = newUser();
  live.setSettings({ mode: 'pilot', pilots: [nameOf(u)] });
  const s0 = baseSave();
  save(u, s0);
  live.playerView(u, { nowMs: T0 });
  assert.strictEqual(errCode(() => live.claim(u, { slot: 0, nowMs: T0 })), 'not_done');
  assert.strictEqual(errCode(() => live.claim(u, { slot: 7, nowMs: T0 })), 'bad_slot');
  // La sauvegarde serveur progresse puis la profondeur retombe (fin de saison) : rien n'est perdu
  const s1 = progressed(s0);
  save(u, s1); live.observeSave(u, s1, { nowMs: T0 });
  const s2 = { ...s1, depth: 1 };
  save(u, s2); live.observeSave(u, s2, { nowMs: T0 });
  const view = live.playerView(u, { nowMs: T0 });
  assert.ok(view.missions.every(m => m.progress === m.target), JSON.stringify(view.missions));
  assert.strictEqual(view.missions.find(m => m.type === 'depth_gain')?.base ?? 1, 1);
  // Hors contrôleur de partie : refus, rien d'écrit
  const rev0 = db.getUserSave(u).version;
  assert.strictEqual(errCode(() => live.claim(u, { slot: 0, nowMs: T0, mayWrite: () => false })), 'not_controller');
  assert.strictEqual(db.getUserSave(u).version, rev0);
  // Réclamation : crédit dans la sauvegarde, nouvelle révision
  const m0 = view.missions[0];
  const r1 = live.claim(u, { slot: 0, day: '2026-11-05', nowMs: T0 });
  assert.strictEqual(r1.replayed, false);
  assert.deepStrictEqual(r1.reward, m0.reward);
  assert.strictEqual(load(u).coins, 100 + m0.reward.coins);
  assert.strictEqual(load(u).gems, 2 + m0.reward.gems);
  assert.strictEqual(r1.revision, rev0 + 1);
  // Rejeu (double clic, F5, autre appareil) : même résultat, aucun nouveau crédit
  const r2 = live.claim(u, { slot: 0, nowMs: T0 });
  assert.strictEqual(r2.replayed, true);
  assert.strictEqual(load(u).coins, 100 + m0.reward.coins);
  assert.strictEqual(db.getUserSave(u).version, rev0 + 1);
  assert.strictEqual(conn().prepare('SELECT COUNT(*) AS c FROM daily_mission_claims WHERE user_id = ?').get(u).c, 1);
  assert.throws(() => conn().prepare('UPDATE daily_mission_claims SET coins = 0').run(), /ajout seul/);
  assert.strictEqual(live.playerView(u, { nowMs: T0 }).missions[0].claimed, true);
  // Le lendemain : une réclamation datée de la veille est refusée, les missions ont changé
  assert.strictEqual(errCode(() => live.claim(u, { slot: 1, day: '2026-11-05', nowMs: T0 + DAY })), 'day_over');
  const next = live.playerView(u, { nowMs: T0 + DAY });
  assert.strictEqual(next.day, '2026-11-06');
  assert.ok(next.missions.every(m => !m.claimed && m.progress === 0));
  const insp = live.inspectPlayer(nameOf(u), { nowMs: T0 });
  assert.strictEqual(insp.today.missions[0].claimed, true);
  assert.strictEqual(insp.history.length, 2);
  live.setSettings({ mode: 'off', pilots: [] });
});

test('#68-E : source des missions, pilotes par ID, inspection sans attribution, repère pilote', () => {
  const a = newUser(), b = newUser();
  save(a, baseSave()); save(b, baseSave());
  const daysBefore = rows('daily_mission_days');
  // Drapeau OFF : navigateur pour tous, raison « off »
  live.setSettings({ mode: 'off', pilots: [] });
  let ia = live.inspectPlayer({ userId: a }, { nowMs: T0 });
  assert.deepStrictEqual([ia.source, ia.reason, ia.today, ia.id], ['browser', 'off', null, a]);
  // Pilote choisi par ID stable (liste de suggestions) ; ID inconnu refusé
  assert.strictEqual(errCode(() => live.setSettings({ mode: 'pilot', pilots: [{ id: 999999 }] })), 'unknown_user');
  const st = live.setSettings({ mode: 'pilot', pilots: [{ id: a }, nameOf(a)] });
  assert.deepStrictEqual(st.pilotAccounts, [{ id: a, username: nameOf(a) }], 'pas de doublon pseudo/ID');
  ia = live.inspectPlayer({ userId: a }, { nowMs: T0 });
  assert.deepStrictEqual([ia.source, ia.reason, ia.today], ['server', 'pilot', null], 'aucune attribution encore');
  const ib = live.inspectPlayer({ username: ` ${nameOf(b).toUpperCase()} ` }, { nowMs: T0 });
  assert.deepStrictEqual([ib.source, ib.reason], ['browser', 'not_pilot'], 'joueur non autorisé au pilote');
  assert.strictEqual(rows('daily_mission_days'), daysBefore, 'l\'inspection ne crée aucune attribution');
  assert.strictEqual(errCode(() => live.inspectPlayer({ username: 'inexistant_zz' })), 'unknown_user');
  assert.strictEqual(errCode(() => live.inspectPlayer({ userId: 'abc' })), 'unknown_user');
  assert.strictEqual(errCode(() => live.inspectPlayer({ username: '  ' })), 'no_user');
  // Vue joueur : repère « pilote » pour le compte listé seulement ; F5 = mêmes missions, une seule attribution
  const v1 = live.playerView(a, { nowMs: T0 });
  assert.strictEqual(v1.pilot, true);
  assert.deepStrictEqual(live.playerView(b, { nowMs: T0 }), { live: false });
  assert.deepStrictEqual(live.playerView(a, { nowMs: T0 + 60e3 }).missions.map(m => m.id), v1.missions.map(m => m.id));
  assert.strictEqual(conn().prepare('SELECT COUNT(*) AS c FROM daily_mission_days WHERE user_id = ?').get(a).c, 1);
  ia = live.inspectPlayer({ userId: a }, { nowMs: T0 });
  assert.ok(ia.today.assignedAt && ia.today.catalogVersion >= 1);
  assert.ok(ia.today.missions.every(m => typeof m.name === 'string' && m.claimedAt === null));
  // Tous les joueurs : source serveur, raison « on », pas de repère de test dans le jeu
  live.setSettings({ mode: 'on', note: 'test #68-E' });
  assert.strictEqual(live.inspectPlayer({ userId: b }, { nowMs: T0 }).reason, 'on');
  assert.strictEqual(live.playerView(a, { nowMs: T0 }).pilot, false);
  live.setSettings({ mode: 'off', pilots: [] });
});

test('#68-F : inspection lisible — noms et objectifs du jeu (catalogue FR), icône, historique nommé ; lecture seule', () => {
  const a = newUser();
  save(a, baseSave());
  live.setSettings({ mode: 'pilot', pilots: [{ id: a }] });
  const view = live.playerView(a, { nowMs: T0 });
  const before = rows('daily_mission_days');
  const ia = live.inspectPlayer({ userId: a }, { nowMs: T0 });
  assert.strictEqual(rows('daily_mission_days'), before, 'l\'inspection n\'attribue rien');
  const fill = (s, n) => s.replace(/\{t\}/g, n).replace(/\{s\}/g, n > 1 ? 's' : '');
  ia.today.missions.forEach((m, i) => {
    const v = view.missions[i];
    assert.strictEqual(m.id, v.id);
    assert.strictEqual(m.name, v.names.fr, 'même nom que le jeu (FR)');
    assert.strictEqual(m.text, fill(v.descs.fr, v.target), 'même objectif que le jeu (FR)');
    assert.strictEqual(m.icon, v.icon);
    assert.ok(!/\{t\}/.test(m.text));
  });
  const h = ia.history.find(x => x.day === ia.day);
  assert.deepStrictEqual(h.missions, view.missions.map(m => `${m.id}:${m.target}`), 'identifiants techniques conservés');
  assert.deepStrictEqual(h.items.map(x => x.name), view.missions.map(m => m.names.fr));
  live.setSettings({ mode: 'off', pilots: [] });
});

test('#68-G : bouton Réclamer sans HTML de pictogramme dans un attribut ; une seule coche « Récompense réclamée »', () => {
  const main = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
  // L'image des pièces (<img … alt="">) dans aria-label coupait l'attribut : « 500"> Réclamer »
  const aria = /aria-label="\$\{([^\n]*?btn_mission_claim_aria[^\n]*?)\}">/.exec(main);
  assert.ok(aria, 'libellé accessible du bouton de mission');
  assert.match(aria[1], /^escapeHtml\(/);
  assert.doesNotMatch(aria[1], /rewardParts/);
  const block = main.slice(main.indexOf('const rewardLabel'), main.indexOf('\n', main.indexOf('const rewardLabel')));
  assert.doesNotMatch(block, /UiIcons/, 'libellé en texte seul');
  // Pastille ✓ + message traduit qui commence déjà par ✓ → une seule coche affichée
  assert.match(main, /<span class="claimed-check">✓<\/span>\$\{t\('ui\.daily_claimed_msg'\)\.replace\(\/\^\\s\*✓\\s\*\/, ''\)\}/);
});

test('rotation adaptative : par joueur, adaptée à la profondeur, anti-répétition sur l\'historique du joueur', () => {
  catalog.loadProposalIntoDraft();
  catalog.publishDraft({ note: 'proposition (test)' });
  const rot = catalog.getPublished().rotation;
  assert.strictEqual(rot.mode, 'adaptive');
  const deb = newUser(), adv = newUser();
  live.setSettings({ mode: 'pilot', pilots: [nameOf(deb), nameOf(adv)] });
  save(deb, baseSave({ depth: 20, pickaxeLevel: 1, upgrades: { luck: 0, bag: 0, autodig: 0, fragment_shop: 0 } }));
  save(adv, baseSave({ depth: 250, pickaxeLevel: 15, upgrades: { luck: 12, bag: 12, autodig: 6, fragment_shop: 10 } }));
  const ids = [];
  for (let d = 0; d < 6; d++) {
    const a = live.playerView(deb, { nowMs: T0 + d * DAY }).missions;
    const b = live.playerView(adv, { nowMs: T0 + d * DAY }).missions;
    assert.ok(!a.some(m => m.type === 'find_gems'), 'aucune gemme à 20 m');
    assert.ok(!b.some(m => m.type === 'buy_upgrades'), 'améliorations au maximum');
    ids.push(a.map(m => m.id).sort().join());
  }
  assert.ok(new Set(ids).size > 1, 'journées différentes');
  // Même joueur, même jour → mêmes missions (relecture) ; historique utilisé (lignes des jours précédents)
  assert.strictEqual(conn().prepare('SELECT COUNT(*) AS c FROM daily_mission_days WHERE user_id = ?').get(deb).c, 6);
  catalog.rollbackTo(1, { note: 'retour (test)' });
  live.setSettings({ mode: 'off', pilots: [] });
});

test('routes HTTP : OFF par défaut, pilote, réclamation concurrente créditée une seule fois, admin protégé', async (t) => {
  const httpDb = path.join(dir, 'http.sqlite');
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, NODE_ENV: 'test', SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: httpDb, ADMIN_SECRET: ADMIN,
      SESSION_SECRET: crypto.randomBytes(16).toString('hex'), RATE_SAVE_MAX: '1000', RATE_PLAY_MAX: '1000', RATE_CHEST_MAX: '1000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', d => { log += d; });
  server.stderr.on('data', d => { log += d; });
  t.after(() => server.kill());
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { await fetch(`${BASE}/api/version`); up = true; } catch (_) { await new Promise(r => setTimeout(r, 100)); }
  }
  assert.ok(up, `serveur de test non démarré :\n${log}`);
  const client = (cookie = '') => async (method, url, body, { admin = false } = {}) => {
    const res = await fetch(BASE + url, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(admin ? { Authorization: `Bearer ${ADMIN}` } : {}) },
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const adm = client();
  for (const [m, u] of [['GET', '/api/admin/missions/live'], ['PUT', '/api/admin/missions/live'], ['GET', '/api/admin/missions/live/player?username=x']]) {
    assert.strictEqual((await adm(m, u, m === 'GET' ? undefined : {})).status, 401, `${m} ${u}`);
  }
  assert.strictEqual((await client()('GET', '/api/me/missions')).status, 401);

  const pc = client(), phone = client();
  const reg = await pc('POST', '/api/register', { username: 'pilote1', email: 'pilote1@example.invalid', password: 'secret123' });
  assert.strictEqual(reg.status, 200, JSON.stringify(reg.body));
  assert.strictEqual((await phone('POST', '/api/login', { username: 'pilote1', password: 'secret123' })).status, 200);
  const pcId = crypto.randomBytes(9).toString('base64url');
  assert.strictEqual((await pc('POST', '/api/me/play/claim', { controllerId: pcId })).status, 200);
  let rev = null;
  const push = async data => {
    const r = await pc('POST', '/api/me/save', { data, baseRevision: rev, controllerId: pcId });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    rev = r.body.revision;
  };
  const s0 = baseSave();
  await push(s0);
  assert.deepStrictEqual((await pc('GET', '/api/me/missions')).body, { live: false }, 'OFF par défaut');
  assert.strictEqual((await pc('POST', '/api/me/missions/claim', { slot: 0, controllerId: pcId })).body.code, 'not_live');

  const set = await adm('PUT', '/api/admin/missions/live', { mode: 'pilot', pilots: ['pilote1'] }, { admin: true });
  assert.strictEqual(set.status, 200, JSON.stringify(set.body));
  assert.deepStrictEqual(set.body.settings.pilots, ['pilote1']);
  assert.strictEqual((await adm('PUT', '/api/admin/missions/live', { mode: 'on' }, { admin: true })).status, 400, 'note obligatoire');

  const v = await pc('GET', '/api/me/missions');
  assert.strictEqual(v.body.live, true);
  assert.deepStrictEqual((await phone('GET', '/api/me/missions')).body.missions.map(m => m.id), v.body.missions.map(m => m.id), 'autre appareil : mêmes missions');
  assert.strictEqual((await pc('POST', '/api/me/missions/claim', { slot: 0, controllerId: pcId })).body.code, 'not_done');
  await push(progressed(s0));
  // Le téléphone n'a pas la main : refus
  const ph = await phone('POST', '/api/me/missions/claim', { slot: 0, controllerId: crypto.randomBytes(9).toString('base64url') });
  assert.strictEqual(ph.status, 409);
  assert.strictEqual(ph.body.notController, true);
  // Trois réclamations simultanées de la même mission : un seul crédit
  const m0 = v.body.missions[0];
  const rs = await Promise.all([0, 1, 2].map(() => pc('POST', '/api/me/missions/claim', { slot: 0, day: v.body.day, controllerId: pcId })));
  assert.ok(rs.every(r => r.status === 200), JSON.stringify(rs.map(r => r.body)));
  assert.strictEqual(rs.filter(r => !r.body.replayed).length, 1);
  assert.ok(rs.every(r => r.body.newCoins === 100 + m0.reward.coins));
  const after = await pc('GET', '/api/me/save');
  assert.strictEqual(after.body.save.data.coins, 100 + m0.reward.coins);
  // Ancienne révision du client après la réclamation : refusée (409), pas d'écrasement du crédit
  const stale = await pc('POST', '/api/me/save', { data: progressed(s0), baseRevision: rev, controllerId: pcId });
  assert.strictEqual(stale.status, 409);
  const insp = await adm('GET', '/api/admin/missions/live/player?username=pilote1', undefined, { admin: true });
  assert.strictEqual(insp.status, 200);
  assert.strictEqual(insp.body.today.missions[0].claimed, true);
  // #68-E : recherche par ID (suggestions), source affichée, compte inexistant distinct, réclamation datée
  assert.strictEqual(v.body.pilot, true);
  const byId = await adm('GET', `/api/admin/missions/live/player?userId=${insp.body.id}`, undefined, { admin: true });
  assert.strictEqual(byId.status, 200);
  assert.deepStrictEqual([byId.body.username, byId.body.source, byId.body.reason], ['pilote1', 'server', 'pilot']);
  assert.ok(byId.body.today.missions[0].claimedAt);
  assert.strictEqual((await adm('GET', '/api/admin/missions/live/player?username=nexistepas', undefined, { admin: true })).status, 404);
  assert.strictEqual((await adm('GET', '/api/admin/missions/live/player?userId=1', undefined)).status, 401);
  const sug = await adm('GET', '/api/admin/players/suggest?q=lote', undefined, { admin: true });
  assert.deepStrictEqual(sug.body.users.map(u => Object.keys(u).sort()), [['id', 'username']], 'suggestion partielle sans e-mail');
  const byIdSet = await adm('PUT', '/api/admin/missions/live', { mode: 'pilot', pilots: [{ id: insp.body.id }] }, { admin: true });
  assert.deepStrictEqual(byIdSet.body.settings.pilotAccounts, [{ id: insp.body.id, username: 'pilote1' }]);
  const audit = await adm('GET', '/api/admin/missions/live', undefined, { admin: true });
  assert.strictEqual(audit.body.settings.mode, 'pilot');
  assert.ok(audit.body.audit.length >= 1);
});
