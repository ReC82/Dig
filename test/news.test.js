/**
 * Centre d'actualités (#50) :
 * - annonces : création toujours en brouillon, publication, programmation, expiration, archivage,
 *   « À venir » (événement futur) / « Dernières », validations, journal ;
 * - lu / non lu par compte ; préférences de mention publique (opt-in, retrait immédiat) ;
 * - mise en forme IA (transport factice) : lien inventé retiré, annonce issue de l'IA en brouillon,
 *   proposition à usage unique, échec tracé ;
 * - annonces automatiques de saison idempotentes et désactivables, fin de saison après le classement
 *   figé seulement, aucun rattrapage de l'historique ;
 * - faits joueurs désactivés par défaut ; activés : profondeur VALIDÉE, accord du joueur, plafond ;
 * - routes HTTP (joueur, invité, admin protégé) et éléments de l'interface.
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
const PORT  = process.env.DIG_TEST_PORT_NEWS || '3171';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-news-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const cal       = require('../server/seasonCalendar');
const db        = require('../server/db');
const blockAi   = require('../server/blockAi');
const standings = require('../server/standings');
const news      = require('../server/news');

db.initDb();
blockAi.init();
news.init();
const conn = () => db.getDb();

let seq = 0;
const newUser = () => conn().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(`news_user_${++seq}`, 'x').lastInsertRowid;
const H = 3_600_000;
const T4 = (fr, en = '', nl = '', es = '') => ({ fr, en, nl, es });
const ago = (ms, now = new Date()) => new Date(now.getTime() - ms);

test('annonce : brouillon à la création, publication, programmation, expiration, archivage', () => {
  const now = new Date();
  const a = news.createItem({ titles: T4('Maintenance <b>ce soir</b>', 'Maintenance tonight'), summaries: T4('Courte coupure.'), category: 'maintenance', status: 'published' });
  assert.strictEqual(a.status, 'draft', 'jamais publiée à la création');
  assert.strictEqual(a.titles.fr, 'Maintenance bce soir/b', 'balises retirées');
  assert.strictEqual(news.publicView(null, now).latest.length, 0);
  news.publishItem(a.id, { now });
  let v = news.publicView(null, new Date(now.getTime() + 1000));
  assert.deepStrictEqual(v.latest.map(x => x.id), [a.id]);
  assert.ok(!('status' in v.latest[0]) && !('autoKey' in v.latest[0]), 'aucun champ d\'administration exposé');

  const b = news.createItem({ titles: T4('Plus tard'), eventAt: new Date(now.getTime() + 48 * H).toISOString() });
  news.publishItem(b.id, { at: new Date(now.getTime() + 2 * H).toISOString(), now });
  v = news.publicView(null, new Date(now.getTime() + H));
  assert.ok(!v.upcoming.some(x => x.id === b.id), 'programmée : invisible avant sa date');
  v = news.publicView(null, new Date(now.getTime() + 3 * H));
  assert.deepStrictEqual(v.upcoming.map(x => x.id), [b.id], 'événement futur → « À venir »');
  v = news.publicView(null, new Date(now.getTime() + 50 * H));
  assert.ok(v.latest.some(x => x.id === b.id) && !v.upcoming.length, 'événement passé → « Dernières »');

  news.updateItem(a.id, { expiresAt: new Date(now.getTime() + 10 * H).toISOString() });
  assert.ok(!news.publicView(null, new Date(now.getTime() + 11 * H)).latest.some(x => x.id === a.id), 'expirée : masquée');
  news.archiveItem(b.id);
  assert.ok(!news.publicView(null, new Date(now.getTime() + 50 * H)).latest.some(x => x.id === b.id));
  assert.throws(() => news.publishItem(b.id), e => e.status === 409);
  const adm = news.listAdmin({ now: new Date(now.getTime() + 11 * H) });
  assert.strictEqual(adm.items.find(x => x.id === a.id).state, 'expired');
  assert.ok(adm.log.some(l => l.action === 'archive' && l.news_id === b.id), 'journal');
});

test('validations : titre FR, lien https, dates, expiration après publication', () => {
  assert.throws(() => news.createItem({ titles: T4('') }), /Titre français/);
  assert.throws(() => news.createItem({ titles: T4('x'), linkUrl: 'javascript:alert(1)' }), /Lien invalide/);
  assert.throws(() => news.createItem({ titles: T4('x'), eventAt: 'demain' }), /Date/);
  assert.throws(() => news.createItem({ titles: T4('x'), publishAt: '2026-11-05T10:00:00Z', expiresAt: '2026-11-04T10:00:00Z' }), /expiration/);
  const ok = news.createItem({ titles: T4('Rejoins-nous'), icon: '<script>', linkUrl: 'https://example.org/page' });
  assert.deepStrictEqual([ok.icon, ok.linkUrl], ['📰', 'https://example.org/page']);
});

test('lu / non lu par compte ; préférences de mention (opt-in)', () => {
  const u = newUser();
  const now = new Date(Date.now() + 100 * H);
  news.publishItem(news.createItem({ titles: T4('Lue ?') }).id, { now: ago(H, now) });
  let v = news.publicView(u, now);
  assert.ok(v.unread >= 1 && v.seenAt === null);
  assert.deepStrictEqual(v.prefs, { publicMentions: false }, 'aucune mention sans accord');
  news.markSeen(u, now);
  assert.strictEqual(news.publicView(u, now).unread, 0);
  news.markSeen(u, ago(10 * H, now));
  assert.strictEqual(news.publicView(u, now).unread, 0, 'jamais de recul');
  const c = news.createItem({ titles: T4('Nouvelle') });
  news.publishItem(c.id, { now: new Date(now.getTime() + 1000) });
  assert.strictEqual(news.publicView(u, new Date(now.getTime() + 2000)).unread, 1);
  assert.throws(() => news.setPrefs(u, { publicMentions: 'oui' }), e => e.status === 400);
  assert.deepStrictEqual(news.setPrefs(u, { publicMentions: true }), { publicMentions: true });
});

test('IA : mise en forme sans lien inventé, brouillon obligatoire, proposition à usage unique', async () => {
  let answer = {
    category: 'player', icon: '🎉', titles: T4('Soirée minage', 'Mining night', 'Mijnavond', 'Noche minera'),
    summaries: T4('Rendez-vous vendredi.'), bodies: T4('Venez nombreux.\n\nÀ vendredi !'),
    eventAt: '2026-11-06T19:00:00Z', linkUrl: 'https://discord.gg/invente', linkLabels: T4('Discord'),
    missing: ['Heure de fin absente.', 'm2', 'm3', 'm4', 'm5', 'm6'], doubts: [], suggestions: ['Durée de la soirée ?'],
  };
  let lastMessages = null;
  blockAi.setFakeTransport({ json: async ({ messages }) => { lastMessages = messages; return { data: answer, usage: {} }; } });
  assert.throws(() => news.startProposal({ text: 'court' }), e => e.status === 400);
  const { proposal, job } = news.startProposal({ text: 'Soirée minage vendredi 6 novembre à 20h (heure belge). Venez nombreux' });
  assert.strictEqual(proposal.status, 'pending');
  await job;
  const p = news.getProposal(proposal.id);
  assert.strictEqual(p.status, 'open');
  assert.strictEqual(p.data.item.linkUrl, null, 'lien absent du texte brut : retiré');
  assert.ok(p.data.missing.some(m => /absent du texte brut/.test(m)));
  assert.strictEqual(p.data.item.category, 'news', 'catégorie réservée refusée');
  assert.strictEqual(p.data.item.eventAt, '2026-11-06T19:00:00Z');
  assert.match(lastMessages[0].content, /NEVER invent/);
  // Recette #50-C : lacunes bloquantes limitées, suggestions à part (repliées), registre unique par langue
  assert.ok(p.data.missing.length <= 5 && p.data.missing.includes('Heure de fin absente.'), 'au plus 4 lacunes + le lien retiré');
  assert.deepStrictEqual(p.data.suggestions, ['Durée de la soirée ?']);
  assert.match(lastMessages[0].content, /"suggestions"/);
  assert.match(lastMessages[0].content, /European Spanish "tú" \(never "vosotros", "vuestro" or "usted"\)/);
  assert.match(lastMessages[0].content, /Never mix registers/);
  const item = news.createItem({ ...p.data.item, aiProposalId: p.id });
  assert.deepStrictEqual([item.status, item.source], ['draft', 'ai']);
  assert.strictEqual(news.getProposal(p.id).status, 'used');
  assert.throws(() => news.createItem({ ...p.data.item, aiProposalId: p.id }), e => e.status === 409);

  blockAi.setFakeTransport({ json: async () => { throw new Error('boom'); } });
  const r = news.startProposal({ text: 'Une autre annonce assez longue' });
  await r.job.catch(() => {});
  assert.strictEqual(news.getProposal(r.proposal.id).status, 'error');
  news.discardProposal(r.proposal.id);
  answer = null;
});

test('annonces de saison : début récent, idempotent, désactivable, pas de rattrapage', () => {
  const now = new Date();
  const active = db.getActiveSeason();
  conn().prepare('UPDATE seasons SET start_at = ? WHERE id = ?').run(cal.fmtUtc(ago(2 * H, now)), active.id);
  db.setAdminConfig('news_auto_seasons', 'false');
  news.sync(now);
  assert.ok(!conn().prepare("SELECT 1 FROM news_items WHERE auto_key = ?").get(`season_start:${active.id}`), 'désactivé : rien');
  db.setAdminConfig('news_auto_seasons', 'true');
  news.sync(now); news.sync(now);
  const rows = conn().prepare("SELECT * FROM news_items WHERE auto_key = ?").all(`season_start:${active.id}`);
  assert.strictEqual(rows.length, 1, 'une seule annonce, rejouable');
  assert.strictEqual(rows[0].status, 'published');
  assert.match(JSON.parse(rows[0].titles).fr, /a commencé/);

  // Saison close il y a longtemps, classement figé : pas d'annonce (aucun rattrapage)
  const old = db.createSeason('Saison ancienne', cal.fmtUtc(ago(30 * 24 * H, now)), cal.fmtUtc(ago(23 * 24 * H, now)), 'closed');
  standings.freezeSeasonStandings(old.id ?? old, { source: 'test', now });
  news.sync(now);
  assert.ok(!conn().prepare("SELECT 1 FROM news_items WHERE auto_key LIKE 'season_end:%'").get());
});

test('fin de saison et faits joueurs : classement figé, accord, risque, plafond ; désactivés par défaut', () => {
  const now = new Date();
  const s = db.createSeason('Saison test fin', cal.fmtUtc(ago(8 * 24 * H, now)), cal.fmtUtc(ago(H, now)), 'closed');
  const sid = s.id ?? s;
  const [u1, u2, u3] = [newUser(), newUser(), newUser()];
  for (const [u, d] of [[u1, 420], [u2, 300], [u3, 120]]) {
    conn().prepare(`INSERT INTO season_rankings (season_id, user_id, max_depth, reported_max_depth, manual_blocks, effective_manual_blocks, is_active)
      VALUES (?, ?, ?, ?, 50, 50, 1)`).run(sid, u, d, d);
  }
  news.sync(now);
  assert.ok(!conn().prepare('SELECT 1 FROM news_items WHERE auto_key = ?').get(`season_end:${sid}`), 'pas avant le classement figé');
  standings.freezeSeasonStandings(sid, { source: 'test', now });
  news.sync(now);
  const end = conn().prepare('SELECT * FROM news_items WHERE auto_key = ?').get(`season_end:${sid}`);
  assert.ok(end, 'fin de saison annoncée');
  assert.match(JSON.parse(end.summaries).fr, /3 mineurs classés · record de la saison : 420 m/);
  assert.strictEqual(JSON.parse(end.titles).fr, 'Fin de la saison test fin', 'nom technique sans « Saison » répété');
  assert.ok(!conn().prepare("SELECT 1 FROM news_items WHERE auto_key LIKE 'rank:%'").get(), 'faits joueurs désactivés par défaut');

  db.setAdminConfig('news_player_events', 'true');
  news.setPrefs(u2, { publicMentions: true });
  news.sync(now);
  const ranks = conn().prepare("SELECT * FROM news_items WHERE auto_key LIKE 'rank:%'").all();
  assert.deepStrictEqual(ranks.map(r => r.subject_user_id), [u2], 'seul le joueur qui a accepté est cité');
  assert.match(JSON.parse(ranks[0].titles).fr, /news_user_\d+ a fini 2e de la saison/);
  assert.match(JSON.parse(ranks[0].titles).en, /finished 2nd/);
  assert.ok(news.publicView(null, new Date(now.getTime() + 1000)).latest.some(x => x.id === ranks[0].id));
  news.setPrefs(u2, { publicMentions: false });
  assert.ok(!news.publicView(null, new Date(now.getTime() + 1000)).latest.some(x => x.id === ranks[0].id), 'accord retiré : masqué aussitôt');

  // Moins de 3 classés : aucun chiffre (il révélerait le résultat d'un joueur)
  const few = db.createSeason('Saison 77-2026', cal.fmtUtc(ago(9 * 24 * H, now)), cal.fmtUtc(ago(2 * H, now)), 'closed');
  const u0 = newUser();
  conn().prepare(`INSERT INTO season_rankings (season_id, user_id, max_depth, reported_max_depth, manual_blocks, effective_manual_blocks, is_active)
    VALUES (?, ?, 55, 55, 10, 10, 1)`).run(few.id, u0);
  standings.freezeSeasonStandings(few.id, { source: 'test', now });
  news.sync(now);
  const fewItem = conn().prepare('SELECT * FROM news_items WHERE auto_key = ?').get(`season_end:${few.id}`);
  assert.strictEqual(JSON.parse(fewItem.titles).fr, 'Fin de la saison 77-2026');
  assert.doesNotMatch(JSON.parse(fewItem.summaries).fr, /55|mineurs/);

  // Profondeur : valeur validée par le serveur uniquement, palier le plus haut, une seule fois
  const active = db.getActiveSeason();
  const u4 = newUser();
  news.setPrefs(u4, { publicMentions: true });
  db.upsertDepthTracking(u4, { season_id: active.id, ref_clicks: 0, ref_auto: 0, hand_tokens: 0, auto_tokens: 0, accepted_depth: 150,
    last_gap: 0, updated_ms: 0, dmg_depth: 0, dmg_credit: 0, dmg_ref_clicks: 0, dmg_gap: 0 });
  assert.strictEqual(news.onSave(u4, now), 0, 'sous le palier');
  conn().prepare('UPDATE player_depth_tracking SET accepted_depth = 230 WHERE user_id = ?').run(u4);
  assert.strictEqual(news.onSave(u4, now), 1);
  assert.strictEqual(news.onSave(u4, now), 0, 'dédupliqué');
  const u5 = newUser();
  db.upsertDepthTracking(u5, { season_id: active.id, ref_clicks: 0, ref_auto: 0, hand_tokens: 0, auto_tokens: 0, accepted_depth: 900,
    last_gap: 0, updated_ms: 0, dmg_depth: 0, dmg_credit: 0, dmg_ref_clicks: 0, dmg_gap: 0 });
  assert.strictEqual(news.onSave(u5, now), 0, 'sans accord : jamais cité');
  db.setAdminConfig('news_player_daily_max', '0');
  news.setPrefs(u5, { publicMentions: true });
  assert.strictEqual(news.onSave(u5, now), 0, 'plafond atteint : tracé, non publié');
  assert.strictEqual(conn().prepare('SELECT status FROM news_items WHERE subject_user_id = ?').get(u5).status, 'archived');
  db.setAdminConfig('news_player_events', 'false');
  assert.throws(() => news.updateSettings({ depthMilestones: '10' }), e => e.status === 400);
  assert.deepStrictEqual(news.updateSettings({ depthMilestones: '500, 200' }).depthMilestones, [200, 500]);
});

// ── HTTP ──────────────────────────────────────────────────────────────────────

let server;
const httpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-news-http-'));

test('HTTP : démarrage', async () => {
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'test', PORT, DB_FILE: path.join(httpDir, 'http.sqlite'), ADMIN_SECRET: ADMIN,
      SESSION_SECRET: crypto.randomBytes(32).toString('hex'), SESSIONS_DIR: path.join(httpDir, 'sessions'), RATE_LIMIT: 'off' },
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) return; } catch (_) { /* pas encore prêt */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('serveur non démarré');
});

test('HTTP : invité, joueur, admin protégé', async () => {
  const adm = (method, p, body) => fetch(`${BASE}${p}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN}` }, body: body && JSON.stringify(body) });
  let r = await fetch(`${BASE}/api/news`);
  assert.strictEqual(r.status, 200);
  let v = await r.json();
  assert.ok(Array.isArray(v.upcoming) && Array.isArray(v.latest) && !('unread' in v));
  assert.strictEqual(v.discordUrl, null, 'aucun lien Discord inventé');
  assert.strictEqual((await fetch(`${BASE}/api/admin/news`)).status, 401);
  assert.strictEqual((await fetch(`${BASE}/api/news/seen`, { method: 'POST' })).status, 401);
  r = await adm('POST', '/api/admin/news', { titles: T4('Bienvenue', 'Welcome'), summaries: T4('Le centre d\'actualités ouvre.') });
  const { item } = await r.json();
  assert.strictEqual(item.status, 'draft');
  r = await adm('POST', `/api/admin/news/${item.id}/publish`, {});
  assert.strictEqual((await r.json()).item.status, 'published');
  v = await (await fetch(`${BASE}/api/news`)).json();
  assert.ok(v.latest.some(x => x.id === item.id));
  r = await adm('GET', '/api/admin/news');
  const a = await r.json();
  assert.ok(a.items.length && a.settings && Array.isArray(a.proposals));
  r = await adm('PUT', '/api/admin/news/settings', { rankTop: 99 });
  assert.strictEqual(r.status, 400);

  // Joueur : inscription, non lu, lu
  const jar = {};
  const call = async (method, p, body) => {
    const res = await fetch(`${BASE}${p}`, { method, headers: { 'Content-Type': 'application/json', ...(jar.c ? { Cookie: jar.c } : {}) }, body: body && JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) jar.c = sc.split(';')[0];
    return res;
  };
  r = await call('POST', '/api/register', { username: 'newsfan', email: 'newsfan@example.test', password: 'motdepasse-solide' });
  assert.ok(r.ok, `inscription : ${r.status}`);
  v = await (await call('GET', '/api/news')).json();
  assert.ok(v.unread >= 1);
  assert.strictEqual((await call('POST', '/api/news/seen')).status, 200);
  v = await (await call('GET', '/api/news')).json();
  assert.strictEqual(v.unread, 0);
  r = await call('PUT', '/api/news/prefs', { publicMentions: true });
  assert.deepStrictEqual((await r.json()).prefs, { publicMentions: true });
});

test('HTTP : arrêt', () => { server?.kill(); });

test('interface : cloche à gauche du logo, panneau, onglet admin sans fiche ouverte par défaut', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(html.indexOf('id="btn-news"') < html.indexOf('id="game-logo"'), 'cloche avant le logo');
  assert.match(html, /id="news-badge"[^>]*hidden/);
  assert.match(html, /<script src="js\/news.js"><\/script>/);
  const admin = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');
  assert.match(admin, /data-tab="news"/);
  assert.match(admin, /<dialog id="news-dialog"/, 'fiche d\'ajout dans une boîte de dialogue fermée');
  const i18n = fs.readFileSync(path.join(ROOT, 'public/js/i18n.js'), 'utf8');
  assert.strictEqual((i18n.match(/^\s+news: \{/gm) || []).length, 4, 'textes FR/EN/NL/ES');
});

test.after(() => {
  server?.kill();
  try { db.getDb().close(); } catch (_) { /* déjà fermée */ }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(httpDir, { recursive: true, force: true });
});
