/**
 * Tests du ticket #83 — une mission quotidienne n'est payée qu'UNE fois par joueur et par jour,
 * quel que soit le moteur (navigateur en mode OFF, serveur en mode pilote / tous) :
 * - pilote → OFF (incident du 06/11) : la mission payée par le serveur reste « réclamée » (vue OFF
 *   `paid`, sauvegarde renvoyée marquée `serverPaid`) ; une sauvegarde qui la réclame à nouveau côté
 *   navigateur est refusée (409, version serveur reprise) : exactement un crédit ;
 * - OFF → pilote : une mission déjà réclamée par le navigateur n'est pas payée par le serveur ;
 * - comptes hors pilote et autres journées : réclamations du navigateur inchangées ;
 * - client (public/js/dailyMissions.js) : marquage sans crédit local, réclamation locale impossible.
 * Lancer : npm test
 */

'use strict';

const test     = require('node:test');
const assert   = require('node:assert');
const crypto   = require('crypto');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const vm       = require('vm');
const { spawn } = require('child_process');

const ROOT  = path.join(__dirname, '..');
const PORT  = process.env.DIG_TEST_PORT_MISSIONS_83 || '3198';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-missions-83-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db      = require('../server/db');
const blocks  = require('../server/blockCatalog');
const catalog = require('../server/missionCatalog');
const live    = require('../server/missionsLive');

db.initDb();
blocks.init();
catalog.init();
live.init();

const T0 = Date.parse('2026-11-06T10:00:00Z');
const DAY0 = '2026-11-06';
const errCode = fn => { try { fn(); return null; } catch (e) { if (!(e instanceof live.MissionError)) throw e; return e.code; } };
const save = (userId, data) => db.upsertUserSave(userId, JSON.stringify(data));
const load = userId => JSON.parse(db.getUserSave(userId).data);
const { DailyMissions: ClientDM } = catalog.clientMissions();
/** Missions du navigateur pour `day` (même tirage que le jeu), avec un état « réclamé » par identifiant. */
const browserDm = (day, claimed = {}) => ({
  date: day,
  missions: JSON.parse(JSON.stringify(ClientDM._generate(day))).map(m => ({ ...m, ...(claimed[m.id] ?? {}) })),
  baselineStats: { blocksDestroyed: 500, totalCoinsEarned: 9000, chestsFound: 4, totalUpgradesBought: 6, gemsFound: 3, depth: 40 },
});
const baseSave = (day = DAY0, extra = {}) => ({ coins: 100, gems: 2, depth: 40, pickaxeLevel: 3, upgrades: { luck: 1, bag: 1, autodig: 0, fragment_shop: 0 },
  stats: { blocksDestroyed: 500, totalCoinsEarned: 9000, gemsFound: 3, chestsFound: 4, totalUpgradesBought: 6 }, dailyMissions: browserDm(day), ...extra });
const progressed = d => ({ ...d, depth: d.depth + 200, stats: { ...d.stats, blocksDestroyed: d.stats.blocksDestroyed + 1000,
  totalCoinsEarned: d.stats.totalCoinsEarned + 100_000, gemsFound: d.stats.gemsFound + 10, chestsFound: d.stats.chestsFound + 10,
  totalUpgradesBought: d.stats.totalUpgradesBought + 10 } });
let n = 0;
const newUser = () => { n++; return db.createUser(`m83joueur${n}`, `m83joueur${n}@example.invalid`, 'x').id; };
const nameOf = id => db.getUserById(id).username;
const claimsOf = id => db.getDb().prepare('SELECT COUNT(*) AS c FROM daily_mission_claims WHERE user_id = ?').get(id).c;

/** Le joueur réclame la mission `slot` via le serveur (mode pilote), puis le drapeau repasse OFF. */
function paidThenOff(u) {
  live.setSettings({ mode: 'pilot', pilots: [nameOf(u)] });
  const v = live.playerView(u, { nowMs: T0 });   // attribution du jour sur la sauvegarde de départ
  const s1 = progressed(baseSave());
  save(u, s1);
  live.observeSave(u, s1, { nowMs: T0 });
  const r = live.claim(u, { slot: 0, nowMs: T0 });
  live.setSettings({ mode: 'off', pilots: [] });
  return { mission: v.missions[0], reward: r.reward, s1 };
}

test('pilote → OFF : mission payée par le serveur listée et marquée réclamée, jamais repayée par le navigateur', () => {
  const u = newUser();
  save(u, baseSave());
  const { mission, reward } = paidThenOff(u);
  assert.ok(reward.coins > 0);
  const paidCoins = 100 + reward.coins;
  assert.strictEqual(load(u).coins, paidCoins);
  // La sauvegarde écrite par la réclamation marque déjà la mission du navigateur (#83)
  const stored = load(u).dailyMissions.missions.find(m => m.id === mission.id);
  assert.deepStrictEqual([stored.claimed, stored.serverPaid], [true, true]);

  // Vue OFF : liste des missions payées par le serveur (aujourd'hui et hier, Bruxelles)
  assert.deepStrictEqual(live.playerView(u, { nowMs: T0 }), { live: false, paid: { [DAY0]: [mission.id] } });

  // Ancien client resté en mode pilote : sauvegarde son état local (non réclamé) → acceptée, aucun crédit
  const prev = load(u);
  const oldLocal = { ...prev, dailyMissions: browserDm(DAY0) };
  assert.strictEqual(live.guardSave(u, prev, oldLocal), null);
  save(u, oldLocal);
  // Sauvegarde renvoyée au client : la mission y apparaît réclamée (mergeInto), sans rien écrire
  const sent = load(u);
  assert.strictEqual(live.mergeInto(u, sent), 1);
  assert.deepStrictEqual(sent.dailyMissions.missions.filter(m => m.claimed).map(m => m.id), [mission.id]);
  assert.strictEqual(load(u).dailyMissions.missions.find(m => m.id === mission.id).claimed, false, 'mergeInto n\'écrit rien');

  // Réclamation du navigateur (ancien client OFF) : refusée par la frontière serveur
  const doubled = { ...load(u), coins: paidCoins + reward.coins, dailyMissions: browserDm(DAY0, { [mission.id]: { claimed: true } }) };
  assert.deepStrictEqual(live.guardSave(u, load(u), doubled), { day: DAY0, missions: [mission.id] });
  // Même refus si la sauvegarde précédente portait le marqueur serveur
  const marked = { ...load(u), dailyMissions: browserDm(DAY0, { [mission.id]: { claimed: true, serverPaid: true } }) };
  assert.deepStrictEqual(live.guardSave(u, marked, doubled), { day: DAY0, missions: [mission.id] });
  // Nouveau client : mission marquée payée par le serveur, sans crédit → acceptée
  assert.strictEqual(live.guardSave(u, load(u), marked), null);
  // Autres missions du jour : réclamation du navigateur toujours possible (rien d'autre n'a été payé)
  const other = browserDm(DAY0).missions.find(m => m.id !== mission.id).id;
  assert.strictEqual(live.guardSave(u, marked, { ...marked, dailyMissions: browserDm(DAY0, { [mission.id]: { claimed: true, serverPaid: true }, [other]: { claimed: true } }) }), null);
  // Autre journée (missions du lendemain) : aucune interférence
  assert.strictEqual(live.guardSave(u, marked, { ...marked, dailyMissions: browserDm('2026-11-07', { [mission.id]: { claimed: true } }) }), null);
  assert.strictEqual(claimsOf(u), 1);
});

test('OFF → pilote : mission déjà réclamée par le navigateur affichée réclamée, jamais payée par le serveur', () => {
  const u = newUser();
  const first = browserDm(DAY0).missions[0];
  // Mode OFF : le navigateur réclame la mission 0 (crédit local sauvegardé)
  const s = progressed(baseSave(DAY0, { coins: 100 + first.reward.coins, dailyMissions: browserDm(DAY0, { [first.id]: { claimed: true } }) }));
  save(u, s);
  live.setSettings({ mode: 'pilot', pilots: [nameOf(u)] });
  const v = live.playerView(u, { nowMs: T0 });
  const m = v.missions.find(x => x.id === first.id);
  assert.ok(m, 'rotation d\'origine : même mission côté serveur');
  assert.deepStrictEqual([m.claimed, m.claimedBy, m.progress], [true, 'browser', m.target]);
  live.observeSave(u, progressed(s), { nowMs: T0 });
  assert.strictEqual(errCode(() => live.claim(u, { slot: m.slot, nowMs: T0 })), 'already_claimed');
  assert.strictEqual(load(u).coins, 100 + first.reward.coins, 'aucun second crédit');
  assert.strictEqual(claimsOf(u), 0);
  // Les autres missions restent réclamables par le serveur
  const other = v.missions.find(x => x.id !== first.id);
  save(u, progressed(progressed(s)));
  live.observeSave(u, progressed(progressed(s)), { nowMs: T0 });
  assert.strictEqual(live.claim(u, { slot: other.slot, nowMs: T0 }).replayed, false);
  // La réclamation serveur ne transforme pas la réclamation navigateur en « payée par le serveur »
  const dm = load(u).dailyMissions.missions;
  assert.deepStrictEqual(dm.find(x => x.id === first.id), { ...browserDm(DAY0).missions[0], claimed: true });
  live.setSettings({ mode: 'off', pilots: [] });
});

test('isolation : comptes jamais pilotes et OFF sans réclamation serveur → vue et sauvegardes inchangées', () => {
  const u = newUser();
  save(u, baseSave());
  assert.deepStrictEqual(live.playerView(u, { nowMs: T0 }), { live: false });
  const first = browserDm(DAY0).missions[0];
  const claimed = { ...baseSave(), coins: 100 + first.reward.coins, dailyMissions: browserDm(DAY0, { [first.id]: { claimed: true } }) };
  assert.strictEqual(live.guardSave(u, load(u), claimed), null);
  const copy = JSON.parse(JSON.stringify(claimed));
  assert.strictEqual(live.mergeInto(u, copy), 0);
  assert.deepStrictEqual(copy, claimed);
  // Sauvegardes sans missions / anciennes formes : jamais refusées
  assert.strictEqual(live.guardSave(u, null, {}), null);
  assert.strictEqual(live.guardSave(u, null, { dailyMissions: { date: null, missions: [] } }), null);
});

test('vue OFF : réclamation serveur de la veille (minuit Bruxelles) toujours listée', () => {
  const u = newUser();
  save(u, baseSave());
  const { mission } = paidThenOff(u);
  // 00:30 Bruxelles le lendemain : le navigateur peut encore afficher la journée précédente
  const next = Date.parse('2026-11-06T23:30:00Z');
  assert.deepStrictEqual(live.playerView(u, { nowMs: next }).paid, { [DAY0]: [mission.id] });
  assert.deepStrictEqual(live.playerView(u, { nowMs: next + 2 * 864e5 }), { live: false });
});

test('client : missions payées par le serveur marquées réclamées sans crédit, réclamation locale impossible', () => {
  const day = '2026-11-06';
  const GameState = {
    coins: 0, gems: 0, depth: 300,
    stats: { blocksDestroyed: 10_000, totalCoinsEarned: 1e6, chestsFound: 100, totalUpgradesBought: 100, gemsFound: 100 },
    dailyMissions: browserDm(day),
    addCoins(c) { this.coins += c; },
  };
  const ctx = { window: {}, navigator: { language: 'fr' }, t: k => k, GameState, Daily: { getToday: () => day } };
  vm.createContext(ctx);
  vm.runInContext(`${fs.readFileSync(path.join(ROOT, 'public', 'js', 'dailyMissions.js'), 'utf8')}\n;this.DailyMissions = DailyMissions;`, ctx);
  const DM = ctx.DailyMissions;
  const [m0, m1] = GameState.dailyMissions.missions;
  // Réclamation navigateur antérieure de m1 : reste une réclamation navigateur
  m1.claimed = true;
  assert.strictEqual(DM.setLive({ live: false, paid: { [day]: [m0.id, m1.id] } }), true);
  assert.deepStrictEqual([m0.claimed, m0.serverPaid], [true, true]);
  assert.deepStrictEqual([m1.claimed, m1.serverPaid], [true, undefined]);
  assert.strictEqual(DM.claim(0), null);
  assert.strictEqual(GameState.coins, 0, 'aucun crédit local');
  assert.strictEqual(DM.setLive({ live: false, paid: { [day]: [m0.id] } }), false, 'idempotent');
  // Vue serveur (pilote) : seules les missions payées par le serveur sont reportées
  GameState.dailyMissions = browserDm(day);
  const [a, b, c] = GameState.dailyMissions.missions;
  DM.setLive({ live: true, day, missions: [
    { slot: 0, id: a.id, type: a.id, target: a.target, reward: a.reward, progress: a.target, base: 0, claimed: true },
    { slot: 1, id: b.id, type: b.id, target: b.target, reward: b.reward, progress: b.target, base: 0, claimed: true, claimedBy: 'browser' },
    { slot: 2, id: c.id, type: c.id, target: c.target, reward: c.reward, progress: 0, base: 0, claimed: false },
  ] });
  assert.deepStrictEqual(GameState.dailyMissions.missions.map(m => [m.claimed, !!m.serverPaid]), [[true, true], [false, false], [false, false]]);
  // Réclamation serveur de c : la mission du navigateur suit ; retour OFF sans liste (réseau) : état conservé
  DM.markServerClaimed(DM._live.missions[2]);
  assert.deepStrictEqual([c.claimed, c.serverPaid], [true, true]);
  DM.setLive({ live: false });
  assert.strictEqual(DM.claim(2), null);
  assert.strictEqual(GameState.coins, 0);
  // Nouveau jour : nouvelles missions, marquées si le serveur les a déjà payées ce jour-là
  DM._paid = { '2026-11-07': [ClientDM._generate('2026-11-07')[0].id] };
  ctx.Daily.getToday = () => '2026-11-07';
  DM.refresh();
  assert.strictEqual(GameState.dailyMissions.missions[0].serverPaid, true);
  assert.strictEqual(GameState.dailyMissions.missions.filter(m => m.claimed).length, 1);
});

test('HTTP : incident pilote → OFF rejoué, exactement un crédit ; OFF → pilote refusé', async (t) => {
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
  const day = live.today();   // journée réelle (Bruxelles) du serveur de test
  const player = async name => {
    const c = client();
    const reg = await c('POST', '/api/register', { username: name, email: `${name}@example.invalid`, password: 'secret123' });
    assert.strictEqual(reg.status, 200, JSON.stringify(reg.body));
    const id = crypto.randomBytes(9).toString('base64url');
    assert.strictEqual((await c('POST', '/api/me/play/claim', { controllerId: id })).status, 200);
    let rev = null;
    const push = async (data, expect = 200) => {
      const r = await c('POST', '/api/me/save', { data, baseRevision: rev, controllerId: id });
      assert.strictEqual(r.status, expect, JSON.stringify(r.body));
      if (r.status === 200) rev = r.body.revision; else rev = r.body.save?.revision ?? rev;
      return r;
    };
    return { c, id, push, setRev: r => { rev = r; } };
  };

  // ── Incident #83 : réclamation serveur en pilote, retour OFF, l'ancien client tente de réclamer ──
  const p = await player('testeur83');
  const s0 = baseSave(day);
  await p.push(s0);
  assert.strictEqual((await adm('PUT', '/api/admin/missions/live', { mode: 'pilot', pilots: ['testeur83'] }, { admin: true })).status, 200);
  const v = await p.c('GET', '/api/me/missions');
  await p.push(progressed(s0));
  const m0 = v.body.missions[0];
  const cl = await p.c('POST', '/api/me/missions/claim', { slot: 0, day: v.body.day, controllerId: p.id });
  assert.strictEqual(cl.status, 200, JSON.stringify(cl.body));
  const paidCoins = 100 + m0.reward.coins;
  assert.strictEqual(cl.body.newCoins, paidCoins);
  p.setRev(cl.body.revision);   // comme le jeu (_setCloudMeta) après une réclamation serveur
  // L'ancien client garde son état local (mission non réclamée) et sauvegarde : accepté
  const local = { ...progressed(s0), coins: paidCoins };
  const ok = await p.push(local);
  assert.strictEqual(ok.status, 200);
  // Retour OFF
  assert.strictEqual((await adm('PUT', '/api/admin/missions/live', { mode: 'off' }, { admin: true })).status, 200);
  const off = await p.c('GET', '/api/me/missions');
  assert.deepStrictEqual(off.body, { live: false, paid: { [day]: [m0.id] } });
  // Rechargement (F5 / autre appareil) : la sauvegarde renvoyée affiche la mission « réclamée »
  const reload = await p.c('GET', '/api/me/save');
  const shown = reload.body.save.data.dailyMissions.missions.find(m => m.id === m0.id);
  assert.deepStrictEqual([shown.claimed, shown.serverPaid], [true, true]);
  // Ancien client : réclamation locale (+ récompense) → 409, version serveur reprise, rien crédité
  const dbl = await p.push({ ...local, coins: paidCoins + m0.reward.coins, dailyMissions: browserDm(day, { [m0.id]: { claimed: true } }) }, 409);
  assert.strictEqual(dbl.body.conflict, true);
  assert.strictEqual(dbl.body.save.data.coins, paidCoins);
  assert.strictEqual(dbl.body.save.data.dailyMissions.missions.find(m => m.id === m0.id).claimed, true);
  // Double envoi : même refus
  await p.push({ ...local, coins: paidCoins + m0.reward.coins, dailyMissions: browserDm(day, { [m0.id]: { claimed: true } }) }, 409);
  // Nouveau client : mission marquée payée par le serveur, aucun crédit → accepté
  await p.push({ ...local, dailyMissions: browserDm(day, { [m0.id]: { claimed: true, serverPaid: true } }) });
  // Retour pilote : la réclamation serveur est rejouée, pas recréditée
  await adm('PUT', '/api/admin/missions/live', { mode: 'pilot', pilots: ['testeur83'] }, { admin: true });
  const again = await p.c('POST', '/api/me/missions/claim', { slot: 0, day, controllerId: p.id });
  assert.strictEqual(again.body.replayed, true);
  const final = await p.c('GET', '/api/me/save');
  assert.strictEqual(final.body.save.data.coins, paidCoins, 'exactement un crédit');
  const insp = await adm('GET', '/api/admin/missions/live/player?username=testeur83', undefined, { admin: true });
  assert.strictEqual(insp.body.today.missions.filter(m => m.claimed).length, 1);

  // ── OFF → pilote : réclamée par le navigateur avant le passage, refusée par le serveur ──
  await adm('PUT', '/api/admin/missions/live', { mode: 'off' }, { admin: true });
  const q = await player('autre83');
  const first = browserDm(day).missions[0];
  const sq = progressed(baseSave(day));
  await q.push(sq);
  await q.push({ ...sq, coins: 100 + first.reward.coins, dailyMissions: browserDm(day, { [first.id]: { claimed: true } }) });
  assert.deepStrictEqual((await q.c('GET', '/api/me/missions')).body, { live: false }, 'compte hors pilote : vue inchangée');
  await adm('PUT', '/api/admin/missions/live', { mode: 'pilot', pilots: ['autre83'] }, { admin: true });
  const vq = await q.c('GET', '/api/me/missions');
  const mq = vq.body.missions.find(m => m.id === first.id);
  assert.deepStrictEqual([mq.claimed, mq.claimedBy], [true, 'browser']);
  const rq = await q.c('POST', '/api/me/missions/claim', { slot: mq.slot, day, controllerId: q.id });
  assert.deepStrictEqual([rq.status, rq.body.code], [409, 'already_claimed']);
  assert.strictEqual((await q.c('GET', '/api/me/save')).body.save.data.coins, 100 + first.reward.coins);
  await adm('PUT', '/api/admin/missions/live', { mode: 'off', pilots: [] }, { admin: true });
  assert.ok(!/Error|TypeError/.test(log), log);
});
