/**
 * Essai navigateur #68 — étape B : missions attribuées et réclamées par le serveur (base de TEST uniquement).
 *   Admin → Missions → carte « Activation en jeu » : désactivé par défaut → mode Pilote pour un compte
 *   de test → jeu (ce compte) : onglet Quotidien, missions du serveur terminées → réclamer → crédit,
 *   carte « réclamée », F5 : toujours réclamée, pièces non recréditées → admin : inspection du joueur →
 *   retour à « Désactivé ». Ordinateur 1280×900 et smartphone 390×844 (un compte par format).
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

async function adminSetMode(page, mode, pilots) {
  await page.selectOption('#mq-act-mode', mode);
  await page.fill('#mq-act-pilots', pilots.join(', '));
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
  await adm.fill('#mq-act-user', name);
  await adm.click('#btn-mq-act-inspect');
  await adm.waitForFunction(() => /réclamée/.test(document.querySelector('#mq-act-out').textContent));
  await adm.locator('#mq-act').scrollIntoViewIfNeeded();
  await adm.screenshot({ path: `${SHOTS}/${tag}-4-inspection.png` });
  await adminSetMode(adm, 'off', []);
  const off = (await player('GET', '/api/me/missions')).body;
  assert.deepStrictEqual(off, { live: false });
  log(`${tag} : inspection admin (réclamée), retour à « Désactivé » → jeu inchangé`);

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
