/**
 * Essai navigateur #92 — signature de l'extension réelle OP Auto Clicker 0.1.4 (Chrome Web Store,
 * kpmbpdpbjjadabknommjfphilmecebab), chargée dans Chromium. Serveur de TEST uniquement (jamais 3000).
 *
 *   A. Extension installée, compte de test, signature « Mon compte de test » : au chargement du jeu,
 *      message « DÉTECTÉE » et ligne du journal (installée, chargement).
 *   B. Extension qui clique (Alt+F1 sur le bloc) : indicateur dans la page, ligne « indicateur actif » à
 *      la sauvegarde ; réaction « journal » : aucune vérification.
 *   C. Réaction « vérification » + mode Appliqué : énigme avec le motif « extension d'autoclic active ».
 *   D. Admin (navigateur avec extension) : « Tester ce navigateur » → OP DÉTECTÉE, les autres non.
 *   E. Navigateur SANS extension : jeu « non détectée », admin « non détectée » partout.
 *   F. Autre joueur (pas compte de test) : rien vérifié ni envoyé.
 *   G. Admin smartphone 390×844 : section lisible, pas de débordement.
 *   H. Arrêt d'urgence : plus aucune vérification envoyée au jeu.
 *
 *   PW=…/playwright-core CHROME=…/chrome-linux64/chrome EXT=/chemin/op-auto-clicker-0.1.4 \
 *   BASE=http://127.0.0.1:3101 ADMIN=<secret> OUT=/tmp/captures node test/e2e/extensions-92.e2e.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require(process.env.PW);
const { admOpenTab } = require('./_admin-nav');

const BASE = process.env.BASE, ADMIN = process.env.ADMIN, OUT = process.env.OUT || '/tmp', EXT = process.env.EXT;
if (!BASE || /:3000\b/.test(BASE)) throw new Error('serveur de test obligatoire (jamais le port 3000)');
if (!EXT) throw new Error('EXT : dossier de l\'extension décompressée requis');
const H = { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (tag, label, ok, extra = '') => { console.log(`${ok ? 'OK  ' : 'ÉCHEC'} [${tag}] ${label}${extra ? ` — ${extra}` : ''}`); if (!ok) failed++; };
const admin = async (method, p, body) => (await fetch(BASE + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined })).json();
const setCfg = (key, value) => admin('PUT', '/api/admin/config', { key, value });

async function launch(withExt, viewport = { width: 1280, height: 900 }, mobile = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-e2e-92-'));
  const ctx = await chromium.launchPersistentContext(dir, { executablePath: process.env.CHROME, headless: true, viewport, locale: 'fr-BE',
    isMobile: mobile, hasTouch: mobile, args: withExt ? [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] : [] });
  await ctx.addInitScript(() => { localStorage.setItem('dig_lang', 'fr'); localStorage.setItem('dig_tutorial', JSON.stringify({ state: 'skipped' })); });
  ctx.dir = dir;
  return ctx;
}

async function gamePage(ctx, user, { register = false } = {}) {
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message));
  p.extPosts = [];
  p.on('request', r => { if (r.url().includes('/api/me/antibot/ext')) p.extPosts.push(r.postDataJSON()); });
  await p.goto(BASE + '/?lang=fr');
  const ok = await p.evaluate(async ([u, reg]) => (await fetch(reg ? '/api/register' : '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: 'motdepasse92', ...(reg ? { email: `${u}@example.invalid` } : {}) }) })).ok, [user, register]);
  if (!ok) throw new Error(`connexion ${user}`);
  return p;
}

/** Recharge le jeu et attend la vérification du chargement (réponse + message affiché). */
async function reloadAndWaitCheck(p) {
  const resp = p.waitForResponse(r => r.url().includes('/api/me/antibot/ext'), { timeout: 15000 }).catch(() => null);
  const toast = p.waitForSelector('.float-text.achievement', { timeout: 15000 }).then(e => e.textContent()).catch(() => null);
  await p.reload();
  await p.waitForSelector('#block');
  const r = await resp;
  return { body: r ? await r.json() : null, toast: await toast };
}

async function openAdmin(ctx, viewport) {
  const page = await ctx.newPage();
  if (viewport) await page.setViewportSize(viewport);
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(`${BASE}/admin/`);
  await page.fill('#secret-input', ADMIN);
  await page.click('#secret-btn');
  await page.waitForSelector('.tab-btn[data-tab="security"]', { state: 'attached' });
  await admOpenTab(page, 'security');
  await page.waitForFunction(() => document.querySelectorAll('#sec-ext-body tr[data-sig]').length > 0);
  await page.evaluate(() => { document.getElementById('sec-ext').open = true; });
  return page;
}

const journal = async () => (await admin('GET', '/api/admin/antibot/extensions')).journal;

(async () => {
  const sfx = Date.now() % 100000;
  const me = `ext92me_${sfx}`, other = `ext92ot_${sfx}`;
  // Base neuve : décision du propriétaire du 10/11 (OP pour tous, « Bloquer le minage ») ; ces essais
  // (POC du 08/11) repartent de tout OFF, réaction « journal » (le blocage : extensions-block-92.e2e.js)
  const before = await admin('GET', '/api/admin/antibot/extensions');
  check('0', 'base neuve : seule OP Auto Clicker activée (Tous), réaction « block »', before.reaction === 'block'
    && before.signatures.every(s => s.mode === (s.id === 'op_auto_clicker' ? 'global' : 'off')), before.signatures.map(s => s.mode).join(','));
  await setCfg('ab_ext_sig_op_auto_clicker', 'off');
  await setCfg('antibot_response_mode', 'observe');
  await setCfg('ab_fast_mode', 'off');
  await setCfg('ab_ext_reaction', 'log');
  await setCfg('ab_ext_stop', 'off');

  const withExt = await launch(true);
  try {
    // A. Installée, compte de test
    const g = await gamePage(withExt, me, { register: true });
    { const c = await launch(false); await gamePage(c, other, { register: true }); await c.close(); }
    let r = await admin('PUT', '/api/admin/antibot/extensions/test-users', { users: me });
    check('A', 'compte de test enregistré', r.testUsers?.[0]?.username === me, JSON.stringify(r.testUsers ?? r));
    await setCfg('ab_ext_sig_op_auto_clicker', 'self');
    const a = await reloadAndWaitCheck(g);
    check('A', 'jeu : vérification au chargement, OP DÉTECTÉE', a.body?.test?.[0]?.installed === true, JSON.stringify(a.body));
    check('A', 'jeu : message d\'essai visible', /OP Auto Clicker — DÉTECTÉE/.test(a.toast ?? ''), a.toast);
    check('A', 'seule la signature activée est envoyée', JSON.stringify(Object.keys(g.extPosts.at(-1)?.results ?? {})) === '["op_auto_clicker"]', JSON.stringify(g.extPosts.at(-1)));
    await g.screenshot({ path: path.join(OUT, '92-A-jeu-detectee.png') });
    let j = await journal();
    check('A', 'journal : installée, chargement, compte de test', j[0]?.username === me && j[0].state === 'installed' && j[0].source === 'load' && j[0].mode === 'self', JSON.stringify(j[0]));

    // B. L'extension clique (raccourci Alt+F1 sur le bloc) — réaction « journal »
    await sleep(1500);
    const box = await g.locator('#block').boundingBox();
    await g.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await g.keyboard.down('Alt'); await g.keyboard.press('F1'); await g.keyboard.up('Alt');
    await sleep(1500);
    const ind = await g.evaluate(() => !!document.querySelector('body > div#AutoClickerIndicator'));
    check('B', 'indicateur de l\'extension présent pendant les clics', ind);
    const saved = g.waitForResponse(r => r.url().includes('/api/me/save'), { timeout: 30000 }).catch(() => null);
    await saved;
    await g.keyboard.down('Alt'); await g.keyboard.press('F2'); await g.keyboard.up('Alt');
    j = await journal();
    const act = j.find(x => x.username === me && x.state === 'active');
    check('B', 'journal : indicateur actif pendant les coups (sauvegarde)', act && act.activeHits >= 5 && act.source === 'save' && act.reaction === 'log', JSON.stringify(act));
    const st = await g.evaluate(async () => (await (await fetch('/api/me/antibot')).json()).antibot);
    check('B', 'réaction « journal » : aucune vérification', !st?.challenge, JSON.stringify(st));

    // C. Réaction « vérification », mode Appliqué
    await setCfg('ab_ext_reaction', 'challenge');
    await setCfg('antibot_response_mode', 'enforce');
    await g.reload(); await g.waitForSelector('#block'); await sleep(1500);
    await g.mouse.move(box.x + box.width / 2 + 3, box.y + box.height / 2 + 3);
    await g.keyboard.down('Alt'); await g.keyboard.press('F1'); await g.keyboard.up('Alt');
    const modal = await g.waitForSelector('#antibot-modal:not([hidden])', { timeout: 30000 }).catch(() => null);
    await g.keyboard.down('Alt'); await g.keyboard.press('F2'); await g.keyboard.up('Alt');
    check('C', 'vérification (énigme) affichée', !!modal);
    const f = await admin('GET', `/api/admin/security/player?q=${me}`);
    const ch = f.lotC?.history?.challenges?.[0];
    check('C', 'motif : extension d\'autoclic active', ch?.reasons?.includes('extension_active'), JSON.stringify(ch?.reasons));
    check('C', 'aucune suspension', !(f.lotC?.history?.suspensions ?? []).length && f.lotC?.state !== 'suspended', f.lotC?.state);
    await g.screenshot({ path: path.join(OUT, '92-C-verification.png') });
    if (ch?.id) await admin('POST', `/api/admin/security/challenge/${ch.id}/cancel`, { note: 'essai #92' });
    await setCfg('antibot_response_mode', 'observe');
    await setCfg('ab_ext_reaction', 'log');
    check('A-C', 'aucune erreur JS (jeu)', !g.errors.length, g.errors.join(' | '));

    // D. Admin dans le navigateur avec l'extension
    const ad = await openAdmin(withExt);
    await ad.click('#btn-sec-ext-check');
    const res = await ad.evaluate(() => [...document.querySelectorAll('#sec-ext-check-result li')].map(li => [li.dataset.sig, li.textContent]));
    const op = res.find(x => x[0] === 'op_auto_clicker');
    check('D', 'admin : OP Auto Clicker DÉTECTÉE', /DÉTECTÉE/.test(op?.[1] ?? ''), op?.[1]);
    check('D', 'admin : les autres signatures non détectées', res.filter(x => x[0] !== 'op_auto_clicker').every(x => /non détectée/.test(x[1])), JSON.stringify(res));
    const sel = await ad.$eval('select[data-adm-key="sec-ext-mode-op_auto_clicker"]', s => s.value);
    check('D', 'interrupteur OP = Mon compte de test', sel === 'self', sel);
    const unavailable = await ad.$eval('tr[data-sig="gg_auto_clicker"]', tr => tr.textContent);
    check('D', 'extension non détectable : interrupteur indisponible', /Indisponible/.test(unavailable));
    const globalDisabled = await ad.$eval('select[data-adm-key="sec-ext-mode-io_auto_clicker_firefox"] option[value="global"]', o => o.disabled);
    check('D', 'signature incertaine : « Tous les joueurs » désactivé', globalDisabled);
    await ad.selectOption('#sec-ext-browser', 'firefox');
    const ffRows = await ad.$$eval('#sec-ext-body tr[data-sig]', trs => trs.map(t => t.dataset.sig));
    check('D', 'filtre Firefox', ffRows.length >= 1 && !ffRows.includes('op_auto_clicker'), ffRows.join(','));
    await ad.selectOption('#sec-ext-browser', '');
    await ad.locator('#sec-ext').scrollIntoViewIfNeeded();
    await ad.screenshot({ path: path.join(OUT, '92-D-admin-pc.png'), fullPage: false });
    await ad.locator('#sec-ext').screenshot({ path: path.join(OUT, '92-D-admin-section-pc.png') });
    check('D', 'aucune erreur JS (admin)', !ad.errors.length, ad.errors.join(' | '));

    // F. Autre joueur (son propre navigateur, extension installée) : rien vérifié ni envoyé
    const otherCtx = await launch(true);
    try {
      const o = await gamePage(otherCtx, other);
      await o.reload(); await o.waitForSelector('#block'); await sleep(2500);
      const who = await o.evaluate(async () => (await (await fetch('/api/me')).json()).user?.username);
      const cfg = await o.evaluate(async () => (await (await fetch('/api/seasons/current')).json()).config.extSignatures);
      check('F', 'autre joueur : aucune signature reçue, aucun envoi', who === other && Array.isArray(cfg) && cfg.length === 0 && o.extPosts.length === 0, `${who} ${JSON.stringify(cfg)} ${o.extPosts.length}`);
    } finally { await otherCtx.close(); }

    // H. Arrêt d'urgence
    await setCfg('ab_ext_stop', 'on');
    const gh = await gamePage(withExt, me);
    await gh.reload(); await gh.waitForSelector('#block'); await sleep(2500);
    const cfgStop = await gh.evaluate(async () => (await (await fetch('/api/seasons/current')).json()).config.extSignatures);
    check('H', 'arrêt d\'urgence : plus rien envoyé au jeu', cfgStop.length === 0 && gh.extPosts.length === 0, JSON.stringify(cfgStop));
    await setCfg('ab_ext_stop', 'off');
  } finally { await withExt.close(); }

  // E. Navigateur sans extension
  const noExt = await launch(false);
  try {
    const g = await gamePage(noExt, me);
    const e = await reloadAndWaitCheck(g);
    check('E', 'jeu sans extension : non détectée', e.body?.test?.[0]?.installed === false && /non détectée/.test(e.toast ?? ''), `${JSON.stringify(e.body)} ${e.toast}`);
    const j = await journal();
    check('E', 'journal : « non détectée » du compte de test', j.some(x => x.username === me && x.state === 'none'), JSON.stringify(j.slice(0, 3)));
    const ad = await openAdmin(noExt);
    await ad.click('#btn-sec-ext-check');
    const res = await ad.evaluate(() => [...document.querySelectorAll('#sec-ext-check-result li')].map(li => li.textContent));
    check('E', 'admin sans extension : rien détecté', res.length >= 2 && res.every(t => /non détectée/.test(t)), JSON.stringify(res));
  } finally { await noExt.close(); }

  // G. Admin smartphone
  const mob = await launch(false, { width: 390, height: 844 }, true);
  try {
    const ad = await openAdmin(mob);
    await ad.locator('#sec-ext').scrollIntoViewIfNeeded();
    const over = await ad.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    check('G', 'smartphone : pas de débordement horizontal', !over);
    await ad.locator('#sec-ext').screenshot({ path: path.join(OUT, '92-G-admin-mobile.png') });
    check('G', 'aucune erreur JS', !ad.errors.length, ad.errors.join(' | '));
  } finally { await mob.close(); }

  // Remise à l'état de départ
  await setCfg('ab_ext_sig_op_auto_clicker', 'off');
  await setCfg('ab_fast_mode', 'on');
  await admin('PUT', '/api/admin/antibot/extensions/test-users', { users: '' });
  console.log(failed ? `\n${failed} ÉCHEC(S)` : '\nTOUT OK');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
