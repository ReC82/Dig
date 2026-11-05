/**
 * Tests du catalogue de missions quotidiennes administrable, ticket #68 (étape A) :
 * - migration : la version 1 reprend à l'identique les six missions du client (objectifs,
 *   récompenses, textes FR/EN/NL/ES) ; idempotente ; la rotation d'origine du catalogue donne
 *   EXACTEMENT les missions de public/js/dailyMissions.js pour chaque date ;
 * - validation : types = compteurs du moteur, bornes, {t}, suppression d'une mission publiée refusée ;
 * - brouillon → publication explicite, version périmée refusée, retour arrière, journal en ajout seul,
 *   proposition adaptative chargée dans le brouillon seulement sur demande ;
 * - rotation adaptative : reproductible, adaptée à la profondeur (débutant 20 m / avancé 250 m),
 *   missions impossibles écartées (gemmes avant 35 m, améliorations toutes au maximum), objectifs
 *   plafonnés à la journée de référence, deux journées successives différentes, anti-répétition ;
 * - le jeu n'est pas modifié (drapeau OFF, missions du client inchangées) ;
 * - atelier d'icônes : cible « mission: », image conservée dans le brouillon uniquement ;
 * - routes HTTP : administration protégée, aperçu, simulateur sans écriture (port ≠ 3000).
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
const PORT  = process.env.DIG_TEST_PORT_MISSIONS || '3194';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-missions-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db      = require('../server/db');
const blocks  = require('../server/blockCatalog');
const catalog = require('../server/missionCatalog');
const coll    = require('../server/collectionCatalog');
const relics  = require('../server/relicCatalog');
const studio  = require('../server/iconStudio');

db.initDb();
blocks.init();
catalog.init();
coll.init();
relics.init();
studio.init();

const code = fn => { try { fn(); return 0; } catch (e) { if (!(e instanceof catalog.CatalogError)) throw e; return e.status; } };
const clone = x => JSON.parse(JSON.stringify(x));
const pubMission = id => clone(catalog.getPublished().missions.find(m => m.id === id));
const profile = id => clone(catalog.PROFILES.find(p => p.id === id));
const dates = (start, n) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${start}T12:00:00Z`) + i * 864e5).toISOString().slice(0, 10));

test('version 1 : les six missions du jeu à l\'identique, textes FR/EN/NL/ES, migration idempotente', () => {
  const { DailyMissions, I18n } = catalog.clientMissions();
  const pub = catalog.getPublished();
  assert.strictEqual(pub.version, 1);
  assert.strictEqual(pub.source, 'origin');
  assert.deepStrictEqual(pub.rotation, catalog.ORIGIN_ROTATION);
  assert.deepStrictEqual(pub.missions.map(m => m.id), clone(DailyMissions.POOL.map(d => d.id)));
  for (const def of DailyMissions.POOL) {
    const m = pub.missions.find(x => x.id === def.id);
    assert.deepStrictEqual(m.bands, [{ fromDepth: 1, targets: clone(def.targets) }]);
    assert.strictEqual(m.icon, def.icon);
    for (const n of def.targets) {
      assert.deepStrictEqual(catalog.rewardFor(m, n), clone(def.rewardFn(n)), `${def.id} × ${n} : récompense identique`);
    }
    for (const l of catalog.LANGS) {
      assert.strictEqual(m.names[l], I18n.get(`mission.${def.id}.name`, l) ?? '');
      assert.strictEqual(m.descs[l], I18n.get(`mission.${def.id}.desc`, l) ?? '');
    }
  }
  assert.strictEqual(pubMission('open_chests').names.fr, 'Chercheur de trésors');
  catalog.init();
  assert.strictEqual(catalog.listVersions().length, 1, 'idempotente');
  assert.strictEqual(catalog.isLive(), false, 'le jeu n\'utilise pas encore ce catalogue');
});

test('rotation d\'origine : mêmes missions que le jeu pour chaque date (400 jours)', () => {
  const { DailyMissions } = catalog.clientMissions();
  const pub = catalog.getPublished();
  for (const d of dates('2026-01-01', 400)) {
    const game = clone(DailyMissions._generate(d).map(m => ({ id: m.id, target: m.target, reward: { coins: m.reward.coins, gems: m.reward.gems } })));
    const cat = catalog.planDay(pub, { date: d, profile: profile('debutant') }).missions.map(m => ({ id: m.id, target: m.target, reward: m.reward }));
    assert.deepStrictEqual(cat, game, d);
  }
});

test('validation : compteurs du moteur, bornes, {t}, suppression refusée, archivage', () => {
  const m = pubMission('find_gems');
  assert.strictEqual(code(() => catalog.normalizeMission({ ...m, type: 'collect_fragments' })), 400, 'type sans compteur');
  assert.strictEqual(code(() => catalog.normalizeMission({ ...m, bands: [{ fromDepth: 1, targets: [31] }] })), 400, 'au-delà du plafond');
  assert.strictEqual(code(() => catalog.normalizeMission({ ...m, bands: [{ fromDepth: 1, targets: [1] }, { fromDepth: 1, targets: [2] }] })), 400);
  assert.strictEqual(code(() => catalog.normalizeMission({ ...m, descs: { ...m.descs, fr: 'Trouver des gemmes' } })), 400, '{t} obligatoire');
  assert.strictEqual(code(() => catalog.normalizeMission({ ...m, reward: { coinsPerUnit: 1, gems: 9, gemsFromTarget: 1 } })), 400);
  assert.strictEqual(code(() => catalog.normalizeMission({ ...m, image: 'https://exemple.test/x.png' })), 400, 'image de l\'atelier seulement');
  assert.deepStrictEqual(catalog.normalizeMission({ ...m, bands: [{ fromDepth: 120, targets: [3, 1] }, { fromDepth: 35, targets: [2, 1] }] }).bands,
    [{ fromDepth: 35, targets: [1, 2] }, { fromDepth: 120, targets: [1, 3] }], 'tranches et objectifs triés');
  const all = catalog.getPublished().missions;
  const v = catalog.validateCatalog(all.filter(x => x.id !== 'depth_gain'), catalog.ORIGIN_ROTATION);
  assert.ok(v.errors.some(e => /depth_gain.*archivée/.test(e)), 'suppression refusée');
  const arch = catalog.validateCatalog(all.map(x => (x.id === 'depth_gain' ? { ...x, active: false } : x)), catalog.ORIGIN_ROTATION);
  assert.deepStrictEqual(arch.errors, []);
  assert.ok(arch.warnings.some(w => /archivée/.test(w)));
  const few = catalog.validateCatalog(all.map((x, i) => ({ ...x, active: i < 2 })), catalog.ORIGIN_ROTATION);
  assert.ok(few.errors.some(e => /3 missions par jour/.test(e)));
});

test('brouillon : ajout, publication explicite, version périmée refusée, retour arrière, journal en ajout seul', () => {
  const before = clone(catalog.getPublished());
  const extra = { ...pubMission('break_blocks'), id: 'casse_cailloux', names: { fr: 'Casse-cailloux' }, descs: { fr: 'Casser {t} blocs de plus' }, weight: 5 };
  catalog.upsertDraftMission(extra);
  assert.deepStrictEqual(catalog.getPublished(), before, 'rien de publié');
  assert.strictEqual(catalog.buildAdminView().draft.changes[0].kind, 'added');
  catalog.setDraftRotation({ ...catalog.ORIGIN_ROTATION, perDay: 4 });
  const pub = catalog.publishDraft({ note: 'test', expectedBasedOn: 1 });
  assert.strictEqual(pub.version, 2);
  assert.ok(pub.changes.some(c => c.kind === 'rotation'));
  catalog.upsertDraftMission({ ...extra, weight: 7 });
  assert.strictEqual(code(() => catalog.publishDraft({ expectedBasedOn: 1 })), 409, 'version périmée');
  assert.strictEqual(code(() => catalog.removeDraftMission('casse_cailloux')), 409, 'publiée : archivage seulement');
  catalog.discardDraft();
  const rb = catalog.rollbackTo(1);
  assert.deepStrictEqual(rb, { version: 3, restored: 1 });
  const now = catalog.getPublished();
  assert.strictEqual(now.rotation.perDay, 3);
  assert.strictEqual(now.missions.find(m => m.id === 'casse_cailloux').active, false, 'mission ajoutée depuis : archivée');
  assert.throws(() => db.getDb().prepare('DELETE FROM mission_catalog_versions').run(), /ajout seul/);
  assert.throws(() => db.getDb().prepare("UPDATE mission_catalog_audit SET action = 'x'").run(), /ajout seul/);
  const actions = catalog.listAudit().map(a => a.action);
  for (const a of ['migrate', 'draft_add', 'draft_rotation', 'publish', 'draft_discard', 'rollback']) assert.ok(actions.includes(a), a);
});

test('proposition adaptative : chargée dans le brouillon seulement sur demande, récompenses par unité inchangées', () => {
  const pubBefore = clone(catalog.getPublished());
  assert.strictEqual(catalog.getDraft(), null);
  catalog.simulate({ source: 'proposal', days: 2, start: '2026-11-05' });
  assert.strictEqual(catalog.getDraft(), null, 'le simulateur n\'écrit rien');
  catalog.loadProposalIntoDraft();
  const d = catalog.getDraft();
  assert.strictEqual(d.rotation.mode, 'adaptive');
  for (const m of d.missions) {
    const p = pubBefore.missions.find(x => x.id === m.id);
    assert.deepStrictEqual(m.reward, p.reward, `${m.id} : récompense inchangée`);
    assert.deepStrictEqual([m.names, m.descs, m.icon], [p.names, p.descs, p.icon]);
  }
  assert.deepStrictEqual(catalog.getPublished(), pubBefore, 'rien de publié');
  catalog.discardDraft();
});

test('rotation adaptative : débutant 20 m / avancé 250 m, deux journées, objectifs adaptés et missions impossibles écartées', () => {
  const sim = catalog.simulate({ source: 'proposal', days: 2, start: '2026-11-05', profiles: [{ id: 'debutant' }, { id: 'avance' }] });
  const [deb, adv] = sim.profiles;
  assert.deepStrictEqual([deb.profile.depth, adv.profile.depth], [20, 250]);
  for (const p of [deb, adv]) {
    assert.strictEqual(p.plan.length, 2);
    for (const day of p.plan) {
      assert.strictEqual(day.missions.length, 3);
      assert.strictEqual(new Set(day.missions.map(m => m.id)).size, 3, 'missions distinctes');
    }
    assert.notDeepStrictEqual(p.plan[0].missions.map(m => `${m.id}:${m.target}`), p.plan[1].missions.map(m => `${m.id}:${m.target}`), 'deux journées différentes');
  }
  // Débutant : aucune gemme avant 35 m ; avancé : toutes les améliorations au maximum
  for (const day of deb.plan) {
    assert.ok(!day.missions.some(m => m.type === 'find_gems'));
    assert.ok(day.excluded.some(x => x.id === 'find_gems' && /35 m/.test(x.reason)));
  }
  for (const day of adv.plan) {
    assert.ok(!day.missions.some(m => m.type === 'buy_upgrades'));
    assert.ok(day.excluded.some(x => x.id === 'buy_upgrades' && /maximum/.test(x.reason)));
  }
  // Objectifs selon la tranche de profondeur
  const prop = catalog.PROPOSAL.missions;
  const all = (p, type) => p.plan.flatMap(d => d.missions).filter(m => m.type === type).map(m => m.target);
  const deep = catalog.simulate({ source: 'proposal', days: 14, start: '2026-11-05', profiles: [{ id: 'debutant' }, { id: 'avance' }] });
  for (const t of all(deep.profiles[0], 'earn_coins')) assert.ok(prop.earn_coins.bands[0].targets.includes(t));
  for (const t of all(deep.profiles[1], 'earn_coins')) assert.ok(prop.earn_coins.bands[2].targets.includes(t), `250 m → tranche 150 m (${t})`);
  assert.ok(deep.profiles.every(p => p.stats.distinctDays >= 10), 'variété sur 14 jours');
  // Reproductible
  assert.deepStrictEqual(catalog.simulate({ source: 'proposal', days: 2, start: '2026-11-05', profiles: [{ id: 'debutant' }, { id: 'avance' }] }), sim);
});

test('rotation adaptative : plafond de la journée de référence, anti-répétition, rotation par joueur', () => {
  const missions = catalog.getPublished().missions.filter(m => m.active).map(m => ({ ...m, ...clone(catalog.PROPOSAL.missions[m.id]) }));
  const rot = { ...catalog.PROPOSAL.rotation };
  const p = profile('regulier');
  // Une journée de 10 blocs ne permet ni 20 blocs ni 20 m : objectifs écartés ou plafonnés
  const tiny = catalog.eligibility(missions.find(m => m.id === 'break_blocks'), p, { ...rot, dayBlocks: 10 });
  assert.strictEqual(tiny.ok, false);
  assert.match(tiny.reason, /atteignable/);
  const up = catalog.eligibility(missions.find(m => m.id === 'buy_upgrades'), { ...p, upgrades: { pickaxe: 15, luck: 12, bag: 12, autodig: 6, fragment_shop: 8 } }, rot);
  assert.deepStrictEqual([up.ok, up.cap, up.targets], [true, 2, [2]], 'au plus 2 achats restants');
  // Anti-répétition stricte (facteur 0) : aucune reprise de la veille quand assez de missions restent
  const strict = { missions, rotation: { ...rot, repeatDays: 1, repeatFactor: 0, maxPerCategory: 3 } };
  const hist = [];
  for (const d of dates('2026-11-05', 10)) {
    const day = catalog.planDay(strict, { date: d, profile: p, playerKey: 'a', history: hist }).missions.map(m => m.id);
    if (hist[0]) assert.ok(!day.some(id => hist[0].includes(id)), `${d} : aucune reprise de la veille`);
    hist.unshift(day);
  }
  // Par joueur : deux joueurs n'ont pas tous les jours les mêmes missions ; commune sinon
  const plan = (key, perPlayer) => dates('2026-11-05', 10).map(d => catalog.planDay({ missions, rotation: { ...rot, perPlayer } }, { date: d, profile: p, playerKey: key }).missions.map(m => m.id).join());
  assert.notDeepStrictEqual(plan('a', true), plan('b', true));
  assert.deepStrictEqual(plan('a', false), plan('b', false));
});

test('bonus trois missions (05/11) : désactivé par défaut, validé, brouillon → publication, simulé, sans effet sur les missions', () => {
  const pubBefore = clone(catalog.getPublished());
  assert.deepStrictEqual(pubBefore.setBonus, { enabled: false, bands: [] }, 'versions sans réglage = aucun bonus');
  // Validation : premier palier à 1 m (débutants compris), paliers croissants, gemmes ≤ 3, activé ⇒ une récompense
  const ok = { enabled: false, bands: [{ fromDepth: 1, coins: 300, gems: 1 }, { fromDepth: 150, coins: 10000, gems: 2 }] };
  assert.deepStrictEqual(catalog.normalizeSetBonus(ok), ok);
  for (const bad of [{ bands: [{ fromDepth: 35, coins: 1, gems: 0 }] }, { bands: [{ fromDepth: 1, coins: 1, gems: 4 }] },
    { bands: [{ fromDepth: 1, coins: 1, gems: 0 }, { fromDepth: 1, coins: 2, gems: 0 }] }, { bands: [{ fromDepth: 1, coins: -5, gems: 0 }] },
    { enabled: true, bands: [{ fromDepth: 1, coins: 0, gems: 0 }] }, { bands: Array.from({ length: 7 }, (_, i) => ({ fromDepth: i + 1, coins: 1, gems: 0 })) }]) {
    assert.strictEqual(code(() => catalog.normalizeSetBonus(bad)), 400, JSON.stringify(bad));
  }
  assert.deepStrictEqual(catalog.setBonusFor(ok, 20), { fromDepth: 1, coins: 300, gems: 1 });
  assert.deepStrictEqual(catalog.setBonusFor(ok, 500), { fromDepth: 150, coins: 10000, gems: 2 });
  // Proposition : paliers chargés, toujours désactivés
  catalog.loadProposalIntoDraft();
  assert.deepStrictEqual(catalog.getDraft().setBonus, catalog.PROPOSAL.setBonus);
  assert.strictEqual(catalog.getDraft().setBonus.enabled, false);
  catalog.discardDraft();
  // Brouillon seul : écart visible, rien de publié ; identique à la version en vigueur → brouillon supprimé
  assert.strictEqual(catalog.setDraftSetBonus(ok).draftDropped, false);
  assert.deepStrictEqual(catalog.getPublished(), pubBefore, 'rien de publié');
  assert.ok(catalog.buildAdminView().draft.changes.some(c => c.kind === 'setBonus'));
  assert.strictEqual(catalog.setDraftSetBonus({ enabled: false, bands: [] }).draftDropped, true);
  // Simulation : coût chiffré (même désactivé), missions identiques avec ou sans bonus
  catalog.setDraftSetBonus(ok);
  const sim = catalog.simulate({ source: 'draft', days: 3, start: '2026-11-09', profiles: [{ id: 'debutant' }] });
  const pub = catalog.simulate({ source: 'published', days: 3, start: '2026-11-09', profiles: [{ id: 'debutant' }] });
  const sb = sim.profiles[0].stats.setBonus;
  assert.strictEqual(sb.enabled, false);
  assert.deepStrictEqual(sb.band, { fromDepth: 1, coins: 300, gems: 1 });
  const full = sim.profiles[0].plan.filter(d => d.allDone).length;
  assert.strictEqual(sb.daysAllDone, full);
  assert.deepStrictEqual([sb.coins, sb.gems], [300 * full, full]);
  assert.deepStrictEqual(sim.profiles[0].plan.map(d => d.missions.map(m => [m.id, m.target, m.reward])), pub.profiles[0].plan.map(d => d.missions.map(m => [m.id, m.target, m.reward])));
  assert.strictEqual(pub.profiles[0].stats.setBonus.band, null);
  // Publication (avertissement : non appliqué en jeu) puis retour arrière : réglage suivi par version
  catalog.setDraftSetBonus({ ...ok, enabled: true });
  const p = catalog.publishDraft({ note: 'test bonus' });
  assert.ok(p.warnings.some(w => /ne l'applique pas/.test(w)));
  assert.deepStrictEqual(catalog.getPublished().setBonus, { ...ok, enabled: true });
  assert.deepStrictEqual(catalog.getPublished().missions, pubBefore.missions, 'missions inchangées');
  catalog.rollbackTo(pubBefore.version);
  assert.deepStrictEqual(catalog.getPublished().setBonus, { enabled: false, bands: [] });
  assert.ok(catalog.listAudit().some(a => a.action === 'draft_set_bonus'));
  // Le moteur serveur (missionsLive) ne lit pas ce réglage
  assert.ok(!/setBonus/.test(fs.readFileSync(path.join(ROOT, 'server', 'missionsLive.js'), 'utf8')));
});

test('le jeu n\'est pas modifié : missions du client et sauvegarde inchangées', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'dailyMissions.js'), 'utf8');
  assert.ok(!/api\/missions|missionCatalog/.test(src), 'le client ne lit pas le catalogue');
  const { DailyMissions } = catalog.clientMissions();
  assert.deepStrictEqual(clone(DailyMissions.POOL.map(d => d.id)), ['break_blocks', 'earn_coins', 'open_chests', 'buy_upgrades', 'find_gems', 'depth_gain']);
});

test('atelier d\'icônes : cible « mission: », image conservée dans le brouillon seulement', async () => {
  const key = 'mission:open_chests';
  const t = studio.getTarget(key);
  assert.deepStrictEqual([t.kind, t.kindLabel, t.name, t.emoji, t.applicable], ['mission', 'Mission quotidienne', 'Chercheur de trésors', '📦', true]);
  assert.match(t.prompt, /treasure chest/i);
  assert.ok(studio.listTargets().some(x => x.key === 'mission:depth_gain'));
  const png = await studio.fakeIconPng(140);
  const up = await studio.upload(key, `data:image/png;base64,${png.toString('base64')}`);
  const before = clone(catalog.getPublished());
  const r = studio.apply(key, { sha: up.sha });
  assert.deepStrictEqual([r.draft, r.catalog], [true, 'missions']);
  assert.match(catalog.getDraft().missions.find(m => m.id === 'open_chests').image, /^\/media\/icons\/[a-f0-9]{16}\.webp$/);
  assert.deepStrictEqual(catalog.getPublished(), before, 'rien de publié');
  assert.strictEqual(studio.getTarget(key).unpublished, true);
  studio.apply(key, { sha: null });
  assert.strictEqual(catalog.getDraft(), null, 'retour à l\'emoji : brouillon identique supprimé');
});

test('routes : administration protégée, aperçu et simulateur sans écriture', async (t) => {
  const httpDb = path.join(dir, 'http.sqlite');
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, NODE_ENV: 'test', SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: httpDb, ADMIN_SECRET: ADMIN,
      SESSION_SECRET: crypto.randomBytes(16).toString('hex') },
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
  const call = async (method, url, body, { auth = true } = {}) => {
    const res = await fetch(BASE + url, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${ADMIN}` } : {}) },
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  for (const [m, u] of [['GET', '/api/admin/missions'], ['PUT', '/api/admin/missions/draft/missions/find_gems'], ['POST', '/api/admin/missions/publish'],
    ['POST', '/api/admin/missions/rollback'], ['DELETE', '/api/admin/missions/draft'], ['GET', '/api/admin/missions/audit'],
    ['PUT', '/api/admin/missions/draft/rotation'], ['PUT', '/api/admin/missions/draft/set-bonus'], ['POST', '/api/admin/missions/draft/proposal'], ['POST', '/api/admin/missions/preview'],
    ['POST', '/api/admin/missions/simulate'], ['POST', '/api/admin/missions/draft/missions/find_gems/revert'], ['DELETE', '/api/admin/missions/draft/missions/x_y']]) {
    assert.strictEqual((await call(m, u, m === 'GET' ? undefined : {}, { auth: false })).status, 401, `${m} ${u}`);
  }
  const view = await call('GET', '/api/admin/missions');
  assert.strictEqual(view.status, 200);
  assert.strictEqual(view.body.live, false);
  assert.deepStrictEqual(Object.keys(view.body.types).sort(), ['break_blocks', 'buy_upgrades', 'depth_gain', 'earn_coins', 'find_gems', 'open_chests']);
  assert.ok(view.body.unavailable.length >= 3);
  const gems = view.body.published.missions.find(m => m.id === 'find_gems');
  assert.strictEqual((await call('PUT', '/api/admin/missions/draft/missions/autre', { mission: gems })).status, 400, 'identifiant incohérent');
  const prev = await call('POST', '/api/admin/missions/preview', { mission: gems });
  assert.strictEqual(prev.status, 200);
  assert.deepStrictEqual(prev.body.rows.map(r => r.profile.depth), [20, 100, 250, 500]);
  assert.strictEqual(prev.body.rows[0].ok, false, 'pas de gemme à 20 m');
  assert.ok(prev.body.rows[1].ok);
  const sim = await call('POST', '/api/admin/missions/simulate', { source: 'proposal', days: 2, start: '2026-11-05', profiles: [{ id: 'debutant' }, { id: 'avance' }] });
  assert.strictEqual(sim.status, 200);
  assert.deepStrictEqual(sim.body.profiles.map(p => p.plan.length), [2, 2]);
  assert.strictEqual((await call('POST', '/api/admin/missions/simulate', { days: 99 })).status, 400);
  const after = await call('GET', '/api/admin/missions');
  assert.strictEqual(after.body.draft, null, 'aperçu et simulateur : aucune écriture');
  assert.strictEqual(after.body.versions.length, 1);
  const icons = await call('GET', '/api/admin/icons');
  assert.ok(icons.body.targets.some(x => x.key === 'mission:find_gems'));
});
