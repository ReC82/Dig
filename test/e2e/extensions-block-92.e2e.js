/**
 * Essai navigateur #92 — règle du propriétaire du 10/11 : extension d'autoclic PROUVÉE détectée → minage
 * manuel bloqué pour tous les bêta-testeurs, sans sanction. Vraie extension OP Auto Clicker 0.1.4
 * chargée dans Chromium. Serveur de TEST uniquement (jamais 3000), base neuve (la décision du
 * propriétaire s'y applique au démarrage).
 *
 *   0. Base neuve : OP Auto Clicker « Tous les joueurs », réaction « Bloquer le minage ».
 *   A. Extension installée, sans cliquer : fenêtre « Extension d'autoclic détectée », coup refusé
 *      (ni dégât, ni clic compté), aucune vérification ni suspension, journal « installée · bloqué ».
 *   B. Extension qui clique (Alt+F1) : toujours bloqué, aucun dégât, aucune sanction sur présence.
 *   C. « Vérifier à nouveau » avec l'extension encore là : message + « Recharger la page ».
 *   D. Extension désactivée (chrome://extensions) puis rechargement : reprise immédiate, coups comptés,
 *      journal « reprise ». Réactivée + rechargement : bloqué de nouveau.
 *   E. Navigateur sans extension : aucun blocage, coups comptés.
 *   F. Arrêt d'urgence : plus aucun blocage.
 *   G. Fenêtre de blocage sur smartphone 390×844 (capture) ; navigation encore possible.
 *
 *   PW=…/playwright-core CHROME=…/chrome-linux64/chrome EXT=/chemin/op-auto-clicker-0.1.4 \
 *   BASE=http://127.0.0.1:3101 ADMIN=<secret> OUT=/tmp/captures node test/e2e/extensions-block-92.e2e.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require(process.env.PW);

const BASE = process.env.BASE, ADMIN = process.env.ADMIN, OUT = process.env.OUT || '/tmp', EXT = process.env.EXT;
if (!BASE || /:3000\b/.test(BASE)) throw new Error('serveur de test obligatoire (jamais le port 3000)');
if (!EXT) throw new Error('EXT : dossier de l\'extension décompressée requis');
const H = { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (tag, label, ok, extra = '') => { console.log(`${ok ? 'OK  ' : 'ÉCHEC'} [${tag}] ${label}${extra ? ` — ${extra}` : ''}`); if (!ok) failed++; };
const admin = async (method, p, body) => (await fetch(BASE + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined })).json();
const setCfg = (key, value) => admin('PUT', '/api/admin/config', { key, value });
const journal = async () => (await admin('GET', '/api/admin/antibot/extensions')).journal;

async function launch(withExt, viewport = { width: 1280, height: 900 }, mobile = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-e2e-92b-'));
  const ctx = await chromium.launchPersistentContext(dir, { executablePath: process.env.CHROME, headless: true, viewport, locale: 'fr-BE',
    isMobile: mobile, hasTouch: mobile, args: withExt ? [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] : [] });
  await ctx.addInitScript(() => { localStorage.setItem('dig_lang', 'fr'); localStorage.setItem('dig_tutorial', JSON.stringify({ state: 'skipped' })); });
  return ctx;
}

async function gamePage(ctx, user, { register = false } = {}) {
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message));
  await p.goto(BASE + '/?lang=fr');
  const ok = await p.evaluate(async ([u, reg]) => (await fetch(reg ? '/api/register' : '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: 'motdepasse92', ...(reg ? { email: `${u}@example.invalid` } : {}) }) })).ok, [user, register]);
  if (!ok) throw new Error(`connexion ${user}`);
  return p;
}

/** Recharge et attend la vérification du chargement. */
async function reload(p) {
  const resp = p.waitForResponse(r => r.url().includes('/api/me/antibot/ext'), { timeout: 15000 }).catch(() => null);
  await p.reload();
  await p.waitForSelector('#block');
  const r = await resp;
  await sleep(500);
  return r ? r.json() : null;
}

const modalShown = p => p.evaluate(() => { const m = document.getElementById('antibot-modal'); return !!m && !m.hidden; });
const modalText = p => p.evaluate(() => document.getElementById('antibot-inner')?.innerText ?? '');
const counters = p => p.evaluate(() => ({ clicks: GameState.seasonStats.manualClicks || 0, hp: Blocks.current?.hp ?? null }));
const antibotState = p => p.evaluate(async () => (await (await fetch('/api/me/antibot')).json()).antibot);

/** Ferme la fenêtre puis frappe le bloc `n` fois (vrais clics souris). */
async function strike(p, n) {
  if (await modalShown(p)) await p.click('#antibot-close');
  const box = await p.locator('#block').boundingBox();
  for (let i = 0; i < n; i++) {
    if (await modalShown(p)) await p.click('#antibot-close');
    await p.mouse.click(box.x + box.width / 2 + (i % 7) * 3, box.y + box.height / 2 + (i % 5) * 4);
    await sleep(160 + (i % 4) * 70);
  }
}

/** Active ou désactive l'extension depuis chrome://extensions (API de la page). */
async function setExtEnabled(ctx, enabled) {
  const ext = await ctx.newPage();
  await ext.goto('chrome://extensions/');
  await ext.waitForTimeout(800);
  const id = await ext.evaluate(() => document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-item-list').shadowRoot.querySelector('extensions-item').id);
  await ext.evaluate(([i, on]) => new Promise(r => chrome.management.setEnabled(i, on, r)), [id, enabled]);
  await ext.close();
}

(async () => {
  const sfx = Date.now() % 100000;
  const me = `ext92b_${sfx}`;
  const v0 = await admin('GET', '/api/admin/antibot/extensions');
  const op0 = v0.signatures.find(s => s.id === 'op_auto_clicker');
  check('0', 'base neuve : OP Auto Clicker pour tous, réaction « Bloquer le minage »', op0.mode === 'global' && v0.reaction === 'block' && v0.stop === 'off', `${op0.mode} ${v0.reaction} ${v0.stop}`);
  check('0', 'seule OP Auto Clicker peut bloquer', JSON.stringify(v0.signatures.filter(s => s.canBlock).map(s => s.id)) === '["op_auto_clicker"]');

  const withExt = await launch(true);
  try {
    // A. Installée, sans cliquer
    const g = await gamePage(withExt, me, { register: true });
    const a = await reload(g);
    check('A', 'serveur : OP bloquante', JSON.stringify(a?.blocked) === '["op_auto_clicker"]', JSON.stringify(a));
    check('A', 'fenêtre « Extension d\'autoclic détectée » affichée', await modalShown(g));
    const txt = await modalText(g);
    check('A', 'message franc + nom de l\'extension + reprise', /Extension d'autoclic détectée/.test(txt) && /OP Auto Clicker/.test(txt) && /désactive-la pour reprendre/.test(txt), txt.replace(/\n/g, ' | '));
    check('A', 'pas une sanction, Auto-Dig/collection/compte conservés', /pas une sanction/.test(txt) && /Auto-Dig/.test(txt));
    await g.screenshot({ path: path.join(OUT, '92-block-A-pc.png') });
    const c0 = await counters(g);
    await strike(g, 6);
    const c1 = await counters(g);
    check('A', 'coups refusés : aucun clic compté, aucun dégât', c1.clicks === c0.clicks && c1.hp === c0.hp, `${JSON.stringify(c0)} → ${JSON.stringify(c1)}`);
    check('A', 'la fenêtre revient au coup suivant', await modalShown(g));
    check('A', 'aucune vérification ni suspension', !(await antibotState(g)), JSON.stringify(await antibotState(g)));
    let j = await journal();
    const ja = j.find(x => x.username === me && x.state === 'installed');
    check('A', 'journal : installée · minage bloqué', ja?.reaction === 'block' && ja.mode === 'global', JSON.stringify(ja));

    // B. L'extension clique sur le bloc (fenêtre fermée)
    await g.click('#antibot-close');
    const box = await g.locator('#block').boundingBox();
    await g.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await g.keyboard.down('Alt'); await g.keyboard.press('F1'); await g.keyboard.up('Alt');
    await sleep(3000);
    await g.keyboard.down('Alt'); await g.keyboard.press('F2'); await g.keyboard.up('Alt');
    const c2 = await counters(g);
    check('B', 'extension qui clique : toujours bloqué, aucun dégât', c2.clicks === c0.clicks && c2.hp === c0.hp, JSON.stringify(c2));
    check('B', 'fenêtre de blocage revenue', await modalShown(g));
    const sb = await antibotState(g);
    check('B', 'aucune suspension sur simple présence', !sb?.suspension, JSON.stringify(sb));

    // C. Vérifier à nouveau, extension toujours là
    if (!(await modalShown(g))) await strike(g, 1);
    await g.click('#antibot-new');
    await sleep(600);
    const ct = await modalText(g);
    check('C', '« encore détectée » + bouton « Recharger la page »', /encore détectée/.test(ct) && /Recharger la page/.test(ct), ct.replace(/\n/g, ' | '));
    check('A-C', 'aucune erreur JS', !g.errors.length, g.errors.join(' | '));

    // D. Extension désactivée puis rechargement : reprise ; réactivée : bloqué de nouveau
    await setExtEnabled(withExt, false);
    const nav = g.waitForNavigation({ timeout: 15000 }).catch(() => null);
    await g.click('#antibot-new');   // « Recharger la page »
    await nav;
    await g.waitForSelector('#block');
    await sleep(1500);
    check('D', 'désactivée + rechargée : plus de fenêtre', !(await modalShown(g)));
    const d0 = await counters(g);
    await strike(g, 4);
    const d1 = await counters(g);
    check('D', 'reprise immédiate : coups comptés', d1.clicks >= d0.clicks + 3, `${d0.clicks} → ${d1.clicks}`);
    j = await journal();
    const jr = j.find(x => x.username === me && x.state === 'none');
    check('D', 'journal : reprise (nouvelle vérification sans trace)', jr?.source === 'recheck', JSON.stringify(jr));
    await setExtEnabled(withExt, true);
    await reload(g);
    check('D', 'réactivée + rechargée : bloqué de nouveau', await modalShown(g));
    check('D', 'aucune erreur JS', !g.errors.length, g.errors.join(' | '));

    // F. Arrêt d'urgence
    await setCfg('ab_ext_stop', 'on');
    await reload(g);
    const f0 = await counters(g);
    await strike(g, 3);
    const f1 = await counters(g);
    check('F', 'arrêt d\'urgence : aucun blocage, coups comptés', !(await modalShown(g)) && f1.clicks >= f0.clicks + 2, `${f0.clicks} → ${f1.clicks}`);
    await setCfg('ab_ext_stop', 'off');
  } finally { await withExt.close(); }

  // E. Navigateur sans extension
  const noExt = await launch(false);
  try {
    const g = await gamePage(noExt, me);
    const e = await reload(g);
    check('E', 'sans extension : rien de bloquant', Array.isArray(e?.blocked) && e.blocked.length === 0 && !(await modalShown(g)), JSON.stringify(e));
    const e0 = await counters(g);
    await strike(g, 4);
    const e1 = await counters(g);
    check('E', 'sans extension : coups comptés', e1.clicks >= e0.clicks + 3, `${e0.clicks} → ${e1.clicks}`);
  } finally { await noExt.close(); }

  // G. Smartphone (extension chargée : Chromium de bureau en format téléphone, pour la mise en page)
  const mob = await launch(true, { width: 390, height: 844 }, true);
  try {
    const g = await gamePage(mob, me);
    await reload(g);
    check('G', 'smartphone : fenêtre affichée', await modalShown(g));
    const over = await g.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    check('G', 'smartphone : pas de débordement horizontal', !over);
    await g.screenshot({ path: path.join(OUT, '92-block-G-mobile.png') });
    await g.click('#antibot-close');
    check('G', 'fermeture : le jeu reste navigable', !(await modalShown(g)));
    check('G', 'aucune erreur JS', !g.errors.length, g.errors.join(' | '));
  } finally { await mob.close(); }

  // Admin : réaction et journal lisibles
  const v1 = await admin('GET', '/api/admin/antibot/extensions');
  check('Z', 'admin : réaction toujours « block », OP pour tous', v1.reaction === 'block' && v1.signatures.find(s => s.id === 'op_auto_clicker').mode === 'global');
  console.log(failed ? `\n${failed} ÉCHEC(S)` : '\nTOUT OK');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
