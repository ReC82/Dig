/**
 * Essai navigateur #68 — étape B : missions attribuées et réclamées par le serveur (base de TEST uniquement).
 *   Admin → Missions → carte « Activation en jeu » : désactivé par défaut → mode Pilote pour un compte
 *   de test → jeu (ce compte) : onglet Quotidien, missions du serveur terminées → réclamer → crédit,
 *   carte « réclamée », F5 : toujours réclamée, pièces non recréditées → admin : inspection du joueur →
 *   retour à « Désactivé » → #83 : F5 en mode OFF, la mission payée reste « Réclamé », un ancien état local
 *   ne crédite rien, une sauvegarde d'ancienne page qui la réclame est refusée (409). Pilotes et joueur inspecté choisis par saisie partielle (#68-E). Ordinateur 1280×900 et smartphone 390×844 (un compte par format).
 *
 * Lancer (serveur de test démarré, base jetable) :
 *   PW=/chemin/node_modules/playwright-core BASE=http://127.0.0.1:3101 ADMIN=<secret> SHOTS=/tmp/dossier \
 *   node test/e2e/missions-live.e2e.js
 */

'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const { chromium } = require(process.env.PW);
const { admOpenTab } = require('./_admin-nav');

const { BASE, ADMIN } = process.env;
const SHOTS = process.env.SHOTS || '/tmp';
const log = (...a) => console.log('✓', ...a);

/** Client HTTP qui garde le cookie (joueur créé hors navigateur, puis cookie injecté). */
function client() {
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const res = await fetch(BASE + url, { method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers } });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  call.cookie = () => cookie;
  return call;
}
const admin = (method, url, body) => client()(method, url, body, { Authorization: `Bearer ${ADMIN}` });

const save0 = () => ({ coins: 100, gems: 2, depth: 40, pickaxeLevel: 3, upgrades: { luck: 1, bag: 1, autodig: 0, fragment_shop: 0, block_reroll: 0 },
  stats: { blocksDestroyed: 500, totalCoinsEarned: 9000, gemsFound: 3, chestsFound: 4, totalUpgradesBought: 6, minedByType: {} }, lastSaveTime: Date.now() });
const progressed = d => ({ ...d, depth: d.depth + 200, stats: { ...d.stats, blocksDestroyed: d.stats.blocksDestroyed + 1000,
  totalCoinsEarned: d.stats.totalCoinsEarned + 100000, gemsFound: d.stats.gemsFound + 10, chestsFound: d.stats.chestsFound + 10,
  totalUpgradesBought: d.stats.totalUpgradesBought + 10 }, lastSaveTime: Date.now() });

/** Saisie partielle (3 dernières lettres) puis choix du compte exact dans la liste de suggestions. */
async function pickPlayer(page, input, list, name) {
  await page.fill(input, '');
  await page.type(input, name.slice(-3));
  const opt = page.locator(`${list} [role=option]`).filter({ has: page.locator('strong', { hasText: new RegExp(`^${name}$`) }) });
  await opt.waitFor();
  await opt.dispatchEvent('mousedown');
}

async function adminSetMode(page, mode, pilots) {
  await page.selectOption('#mq-act-mode', mode);
  // Pastilles (#68-E) : retirer les comptes en place, puis choisir chaque pilote dans les suggestions
  while (await page.locator('#mq-act-pilots .ev-chip-x').count()) await page.locator('#mq-act-pilots .ev-chip-x').first().click();
  for (const p of pilots) await pickPlayer(page, '#mq-act-pilots input', '#mq-act-pilots [role=listbox]', p);
  await page.click('#btn-mq-act-save');
  await page.waitForSelector('#adm-confirm[open]');
  await page.click('#adm-confirm-yes');
  await page.waitForFunction(m => document.querySelector('#mq-act-mode').value === m && /Enregistré/.test(document.querySelector('#mq-act-msg').textContent), mode);
}

async function steps(browser, tag, viewport) {
  const errors = [];
  const name = `mqlive${tag}${crypto.randomBytes(2).toString('hex')}`;
  const player = client();
  const reg = await player('POST', '/api/register', { username: name, email: `${name}@example.invalid`, password: 'secret123' });
  assert.strictEqual(reg.status, 200, JSON.stringify(reg.body));
  let r = await player('POST', '/api/me/save', { data: save0(), baseRevision: null });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  let rev = r.body.revision;

  // ── Admin : désactivé par défaut → pilote pour ce compte ──
  const adm = await browser.newPage({ viewport });
  adm.on('pageerror', e => errors.push(`admin: ${e}`));
  await adm.goto(`${BASE}/admin/`);
  await adm.fill('#secret-input', ADMIN);
  await adm.click('#secret-btn');
  await admOpenTab(adm, 'missions');
  await adm.waitForFunction(() => /désactivé/.test(document.querySelector('#mq-act-state').textContent));
  await adm.locator('#mq-act').scrollIntoViewIfNeeded();
  await adm.screenshot({ path: `${SHOTS}/${tag}-1-activation-off.png` });
  log(`${tag} : carte « Activation en jeu » — désactivé par défaut`);
  await adminSetMode(adm, 'pilot', [name]);
  assert.match(await adm.textContent('#mq-act-state'), /pilote/);
  assert.match(await adm.textContent('#mq-live'), new RegExp(`Mode pilote : seuls ${name}`));
  log(`${tag} : mode Pilote enregistré pour ${name} (confirmation Dig)`);

  // Attribution du jour, puis progression enregistrée dans la sauvegarde serveur
  const view = (await player('GET', '/api/me/missions')).body;
  assert.strictEqual(view.live, true);
  r = await player('POST', '/api/me/save', { data: progressed(save0()), baseRevision: rev });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  rev = r.body.revision;

  // ── Jeu : ce compte voit les missions du serveur, terminées ──
  const ctx = await browser.newContext({ viewport });
  const ck = player.cookie(), eq = ck.indexOf('=');
  await ctx.addCookies([{ name: ck.slice(0, eq), value: ck.slice(eq + 1), url: BASE }]);
  await ctx.addInitScript(() => localStorage.setItem('dig_lang', 'fr'));
  const game = await ctx.newPage();
  game.on('pageerror', e => errors.push(`jeu: ${e}`));
  await game.goto(`${BASE}/`);
  await game.waitForFunction(() => typeof DailyMissions !== 'undefined' && DailyMissions.isLive(), null, { timeout: 15000 });
  await game.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  await game.click('.nav-btn[data-view="daily"]');
  await game.waitForSelector('#daily-missions-list .mission-card');
  assert.strictEqual(await game.locator('#daily-missions-list .mission-card').count(), 3);
  const names = await game.locator('#daily-missions-list .mission-name').allTextContents();
  assert.deepStrictEqual(names.length, 3);
  assert.strictEqual(await game.locator('#daily-missions-list .mission-claim-btn:not([disabled])').count(), 3, 'trois missions terminées');
  await game.screenshot({ path: `${SHOTS}/${tag}-2-jeu-missions-serveur.png` });
  log(`${tag} : jeu — 3 missions du serveur terminées (${names.join(', ')})`);

  const coins0 = await game.evaluate(() => GameState.coins);
  const reward = view.missions[0].reward.coins;
  await game.locator('#daily-missions-list .mission-claim-btn').first().click();
  await game.waitForSelector('#daily-missions-list .mission-card.mission-claimed');
  const coins1 = await game.evaluate(() => GameState.coins);
  assert.ok(coins1 - coins0 >= reward, `crédit ${coins1 - coins0} ≥ ${reward}`);
  await game.screenshot({ path: `${SHOTS}/${tag}-3-reclamee.png` });
  log(`${tag} : réclamation → +${coins1 - coins0} pièces, carte « réclamée »`);

  // F5 : toujours réclamée, pas de nouveau crédit possible
  await game.reload();
  await game.waitForFunction(() => typeof DailyMissions !== 'undefined' && DailyMissions.isLive(), null, { timeout: 15000 });
  await game.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  await game.click('.nav-btn[data-view="daily"]');
  await game.waitForSelector('#daily-missions-list .mission-card.mission-claimed');
  assert.strictEqual(await game.locator('#daily-missions-list .mission-card.mission-claimed').count(), 1);
  const replay = await player('POST', '/api/me/missions/claim', { slot: 0, day: view.day });
  assert.ok(replay.body.replayed === true || replay.status === 409, JSON.stringify(replay.body));
  log(`${tag} : F5 — toujours réclamée ; nouvelle réclamation = rejeu sans crédit`);

  // ── Admin : inspection, puis retour à « Désactivé » ──
  await pickPlayer(adm, '#mq-act-user', '#mq-act-user-list', name);
  await adm.waitForFunction(() => /réclamée/.test(document.querySelector('#mq-act-out').textContent));
  assert.match(await adm.textContent('#mq-act-out'), /Source des missions : Serveur \(Pilote\)/);
  await adm.locator('#mq-act').scrollIntoViewIfNeeded();
  await adm.screenshot({ path: `${SHOTS}/${tag}-4-inspection.png` });
  await adminSetMode(adm, 'off', []);
  const off = (await player('GET', '/api/me/missions')).body;
  assert.deepStrictEqual(off, { live: false, paid: { [view.day]: [view.missions[0].id] } });
  log(`${tag} : inspection admin (réclamée), retour à « Désactivé » → mission payée listée (#83)`);

  // ── #83 : retour OFF, rechargement : la mission payée par le serveur reste « Réclamé » ──
  const paidId = view.missions[0].id;
  await game.reload();
  await game.waitForFunction(id => typeof DailyMissions !== 'undefined' && !DailyMissions.isLive()
    && GameState.dailyMissions.missions.some(m => m.id === id && m.claimed && m.serverPaid), paidId, { timeout: 15000 });
  await game.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  await game.click('.nav-btn[data-view="daily"]');
  const idx = await game.evaluate(id => GameState.dailyMissions.missions.findIndex(m => m.id === id), paidId);
  const card = game.locator('#daily-missions-list .mission-card').nth(idx);
  await card.locator('.mission-claim-btn[disabled]').waitFor();
  assert.match(await card.getAttribute('class'), /mission-claimed/);
  await game.screenshot({ path: `${SHOTS}/${tag}-5-off-reclamee.png` });
  log(`${tag} : mode OFF après F5 — « ${paidId} » affichée Réclamé, bouton inactif`);
  // Ancien état local (non réclamé, comme le compte de la recette #68-H) : le clic relit le serveur, aucun crédit
  const local0 = await game.evaluate(i => { const m = GameState.dailyMissions.missions[i]; m.claimed = false; delete m.serverPaid;
    // Objectif atteint localement (comme Accumulateur 2000/2000 dans la recette)
    for (const k of Object.keys(GameState.dailyMissions.baselineStats)) GameState.dailyMissions.baselineStats[k] = -1e6;
    // Relecture automatique (toutes les 30 s) suspendue : seul le clic doit relire le serveur
    DailyMissions._paid = {}; _liveMissionsAt = Date.now(); renderDailyMissions(); return GameState.coins; }, idx);
  await card.locator('.mission-claim-btn:not([disabled])').click();
  await game.waitForFunction(i => GameState.dailyMissions.missions[i].serverPaid === true, idx);
  await card.locator('.mission-claim-btn[disabled]').waitFor();
  assert.strictEqual(await game.evaluate(() => GameState.coins), local0, 'aucun crédit local');
  // Ancienne page (sans correctif) : sauvegarde « réclamée » + récompense → refusée par le serveur
  const cur = (await player('GET', '/api/me/save')).body.save;
  const dm = { ...cur.data.dailyMissions, missions: cur.data.dailyMissions.missions.map(m => (m.id === paidId ? { ...m, claimed: true, serverPaid: undefined } : m)) };
  const dbl = await game.evaluate(async body => {
    const res = await fetch('/api/me/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, controllerId: _tabId }) });
    return { status: res.status, body: await res.json() };
  }, { data: { ...cur.data, coins: cur.data.coins + view.missions[0].reward.coins, dailyMissions: dm }, baseRevision: cur.revision });
  assert.deepStrictEqual([dbl.status, dbl.body.conflict], [409, true], JSON.stringify(dbl.body).slice(0, 200));
  const after = (await player('GET', '/api/me/save')).body.save;
  assert.ok(after.data.coins < cur.data.coins + view.missions[0].reward.coins, `aucun second crédit (${cur.data.coins} → ${after.data.coins})`);
  assert.strictEqual(dbl.body.save.data.coins, cur.data.coins, 'version serveur reprise, solde inchangé');
  log(`${tag} : clic sur un ancien état local → aucun crédit ; sauvegarde d'une ancienne page → 409, solde inchangé`);

  await ctx.close();
  await adm.close();
  assert.deepStrictEqual(errors, [], errors.join('\n'));
}

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  try {
    for (const [tag, viewport] of [['pc', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
      await steps(browser, tag, viewport);
    }
    console.log('OK');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
