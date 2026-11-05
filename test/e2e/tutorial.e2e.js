/**
 * Parcours Chromium réels du ticket #79 (PC 1280×900, smartphone 390×844, petit écran 320×640) :
 *  A. Première partie : la proposition « Découvrir le jeu » / « Passer » apparaît sur l'onglet Dig, sans voile,
 *     sans chevaucher la barre du bas ni déborder ; boutons ≥ 44 px.
 *  B. Parcours complet : toucher le bloc fait avancer, Retour, Amélios ouvert fait avancer, cadre autour de
 *     l'Auto-Dig, Terminer ; état « done » ; rechargement → plus rien. Aucune requête hors /api/me/tutorial
 *     due au tutoriel, aucune pièce donnée, aucun achat.
 *  C. Passer dès la proposition → « skipped », rien au rechargement.
 *  D. Passer à l'étape 3 → Aide → « Reprendre (étape 3/6) » → étape 3 ; « Recommencer » → étape 1 ; Échap = Passer.
 *  E. Rechargement en cours de parcours → reprise à la même étape. La carte se cache derrière la fiche Aide.
 *  F. Joueur historique (blocs déjà cassés, aucun état) → aucune proposition.
 *  G. Compte : état envoyé au compte ; « nouveau téléphone » (navigateur vierge, connexion) → aucune proposition.
 *  H. Anglais.
 *
 * JAMAIS contre la production : serveur de test seulement, par exemple
 *   DB_FILE=test-79.sqlite PORT=3279 node server/index.js
 * puis
 *   DIG_E2E_BASE=http://127.0.0.1:3279 NODE_PATH=<dossier contenant playwright-core> node test/e2e/tutorial.e2e.js
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const BASE = process.env.DIG_E2E_BASE || 'http://127.0.0.1:3279';
if (/:3000\b|lodygames|lodylands/.test(BASE)) throw new Error('Parcours réservé à un serveur de test.');
const exe = fs.readdirSync(process.env.HOME + '/.cache/ms-playwright').filter(d => d.startsWith('chromium-')).sort().pop();
const SHOTS = process.env.DIG_E2E_SHOTS || '/tmp';
const results = [];
const check = (tag, name, cond, extra = '') => { results.push(`${cond ? 'OK  ' : 'FAIL'} [${tag}] ${name}${extra ? ' — ' + extra : ''}`); };
const overlap = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: `${process.env.HOME}/.cache/ms-playwright/${exe}/chrome-linux64/chrome` });
  const run = Date.now().toString(36);

  async function open(w, h, tag, { lang = 'fr', ctx: reuse } = {}) {
    const touch = tag !== 'pc';
    const ctx = reuse || await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
    if (!reuse) await ctx.addInitScript(l => { if (!localStorage.getItem('dig_lang')) localStorage.setItem('dig_lang', l); }, lang);
    const page = await ctx.newPage();
    const errors = [], writes = [];
    page.on('pageerror', e => errors.push('pageerror ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console ' + m.text()); });
    page.on('request', r => { if (r.method() !== 'GET') writes.push(`${r.method()} ${new URL(r.url()).pathname}`); });
    await page.goto(BASE + '/');
    await page.waitForSelector('#block-name:not(:empty)');
    const tap = sel => (touch ? page.tap(sel) : page.click(sel));
    const card = () => page.evaluate(() => { const c = document.getElementById('tuto-card'); return c && !c.hidden && !c.classList.contains('is-behind') && !c.classList.contains('is-leaving') ? c.textContent : null; });
    const rec = () => page.evaluate(() => JSON.parse(localStorage.getItem('dig_tutorial') || 'null'));
    const box = sel => page.$(sel).then(e => (e ? e.boundingBox() : null));
    const waitCard = async (re, ms = 3000) => { for (let t = 0; t < ms; t += 100) { const c = await card(); if (c && (!re || re.test(c))) return c; await sleep(100); } return await card(); };
    return { ctx, page, errors, writes, tap, card, rec, box, waitCard, touch };
  }
  const hitBlock = async (P, n = 1) => { for (let i = 0; i < n; i++) { await P.tap('#block'); await sleep(140); } };

  for (const [w, h, tag] of [[1280, 900, 'pc'], [390, 844, 'mob'], [320, 640, 'xs']]) {
    // A + B. Première partie, parcours complet
    let P = await open(w, h, tag);
    let c = await P.waitCard(/Première partie/);
    check(tag, 'A proposition à la première partie', !!c && /Découvrir le jeu/.test(c) && /Passer/.test(c), c);
    const cardBox = await P.box('#tuto-card'), nav = await P.box('#bottom-nav');
    check(tag, 'A carte au-dessus de la barre du bas', cardBox && nav && cardBox.y + cardBox.height <= nav.y + 0.5, JSON.stringify(cardBox));
    check(tag, 'A carte dans l\'écran, pas de débordement', cardBox && cardBox.x >= 0 && cardBox.x + cardBox.width <= w
      && await P.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    const btns = await P.page.$$eval('#tuto-card button', bs => bs.map(b => b.getBoundingClientRect().height));
    check(tag, 'A boutons ≥ 44 px', btns.length === 2 && btns.every(x => x >= 44), btns.join(','));
    check(tag, 'A dialogue non modal, sans voile', await P.page.evaluate(() => {
      const c = document.getElementById('tuto-card');
      return c.getAttribute('role') === 'dialog' && c.getAttribute('aria-modal') === 'false' && c.getBoundingClientRect().height < window.innerHeight / 2;
    }));
    check(tag, 'A rien d\'enregistré tant qu\'on n\'a pas choisi', (await P.rec()) === null);
    await P.page.screenshot({ path: `${SHOTS}/79-${tag}-proposition.png` });
    const coins0 = await P.page.evaluate(() => GameState.coins);

    await P.tap('#tuto-card [data-tuto="start"]');
    c = await P.waitCard(/1\/6/);
    check(tag, 'B étape 1 : toucher le bloc', /Touche le bloc/.test(c || ''), c);
    const ring = await P.box('.tuto-ring:not([hidden])'), block = await P.box('#block');
    check(tag, 'B cadre autour du bloc, sans le masquer', ring && block && ring.x <= block.x && ring.y <= block.y && ring.x + ring.width >= block.x + block.width
      && await P.page.evaluate(() => getComputedStyle(document.querySelector('.tuto-ring')).pointerEvents === 'none'));
    check(tag, 'B carte ne couvre pas le bloc', !overlap(await P.box('#tuto-card'), block));
    await P.page.screenshot({ path: `${SHOTS}/79-${tag}-etape1.png` });
    await hitBlock(P);
    c = await P.waitCard(/2\/6/);
    check(tag, 'B un coup sur le bloc fait avancer', /PV/.test(c || ''), c);
    check(tag, 'B état « en cours » enregistré', (await P.rec())?.state === 'started' && (await P.rec())?.step === 2);
    await P.tap('#tuto-card [data-tuto="back"]');
    c = await P.waitCard(/1\/6/);
    check(tag, 'B Retour', /Touche le bloc/.test(c || ''));
    await P.tap('#tuto-card [data-tuto="next"]');
    await P.tap('#tuto-card [data-tuto="next"]');
    c = await P.waitCard(/3\/6/);
    check(tag, 'B étape 3 : pièces et Amélios', /pièces/.test(c || '') && /Amélios/.test(c || ''), c);
    check(tag, 'B étape 3 : onglet Dig conservé (aucun changement d\'onglet imposé)', await P.page.evaluate(() => isViewActive('dig')));
    await P.tap('.nav-btn[data-view="upgrades"]');
    c = await P.waitCard(/4\/6/);
    check(tag, 'B ouvrir Amélios fait avancer', /Auto-Dig/.test(c || ''), c);
    await sleep(400);
    const rings = await P.page.$$eval('.tuto-ring:not([hidden])', rs => rs.map(r => r.getBoundingClientRect()));
    const auto = await P.page.evaluate(() => { const e = document.querySelector('#upgrades-list .help-tip-btn[data-help="autodig"]')?.closest('.upgrade-card'); return e && e.getBoundingClientRect(); });
    check(tag, 'B cadre autour de la carte Auto-Dig', auto && rings.some(r => Math.abs(r.x - (auto.x - 4)) < 2 && Math.abs(r.width - (auto.width + 8)) < 2), JSON.stringify(rings));
    await P.page.screenshot({ path: `${SHOTS}/79-${tag}-etape4.png` });
    await P.tap('#tuto-card [data-tuto="next"]');
    c = await P.waitCard(/5\/6/);
    check(tag, 'B étape 5 : classement à la main, pas la profondeur', /à la main/.test(c || '') && /profondeur/.test(c || ''), c);
    await P.tap('#tuto-card [data-tuto="next"]');
    c = await P.waitCard(/6\/6/);
    check(tag, 'B étape 6 : Collection et aide', /Collection/.test(c || '') && /Terminer/.test(c || ''), c);
    const helpRing = await P.page.$$eval('.tuto-ring:not([hidden])', rs => rs.length);
    check(tag, 'B étape 6 : deux zones entourées (Collection, ?)', helpRing === 2, String(helpRing));
    await P.page.screenshot({ path: `${SHOTS}/79-${tag}-etape6.png` });
    await P.tap('#tuto-card [data-tuto="next"]');
    await sleep(500);
    check(tag, 'B Terminer : carte et cadres retirés', !(await P.card()) && await P.page.$$eval('.tuto-ring', r => r.length) === 0);
    check(tag, 'B état « done »', (await P.rec())?.state === 'done');
    check(tag, 'B aucune pièce offerte', (await P.page.evaluate(() => GameState.coins)) - coins0 <= (await P.page.evaluate(() => GameState.stats.totalCoinsEarned)),
      `${coins0}→${await P.page.evaluate(() => GameState.coins)}`);
    check(tag, 'B aucune amélioration achetée', await P.page.evaluate(() => GameState.stats.totalUpgradesBought) === 0);
    const otherWrites = P.writes.filter(x => !/\/api\/(me\/tutorial|play|me\/play|me\/save|telemetry|clicks|blocks)/.test(x));
    check(tag, 'B aucune écriture hors jeu normal', otherWrites.length === 0, otherWrites.join(','));
    check(tag, 'B invité : aucune requête au compte', !P.writes.some(x => /tutorial/.test(x)));
    await P.page.reload();
    await P.page.waitForSelector('#block-name:not(:empty)');
    await sleep(1500);
    check(tag, 'B rechargement : plus de proposition', !(await P.card()));
    check(tag, 'A/B aucune erreur', P.errors.length === 0, P.errors.join(' | '));
    await P.ctx.close();

    // C. Passer dès la proposition
    P = await open(w, h, tag);
    await P.waitCard(/Première partie/);
    await P.tap('#tuto-card [data-tuto="skip"]');
    await sleep(500);
    check(tag, 'C Passer : carte fermée, état « skipped »', !(await P.card()) && (await P.rec())?.state === 'skipped');
    await P.page.reload(); await P.page.waitForSelector('#block-name:not(:empty)'); await sleep(1500);
    check(tag, 'C rechargement : pas relancé', !(await P.card()));

    // D. Reprise depuis l'Aide (après Passer à l'étape 3) ; Recommencer ; Échap
    await P.tap('#btn-help');
    let hb = await P.page.textContent('#help-body');
    check(tag, 'D Aide : « Recommencer le tutoriel » après un Passer immédiat', /Recommencer le tutoriel/.test(hb) && !/Reprendre/.test(hb));
    await P.tap('#help-body [data-tuto-help="restart"]');
    c = await P.waitCard(/1\/6/);
    check(tag, 'D lancé depuis l\'Aide : fiche fermée, étape 1', !!c && !(await P.page.isVisible('#help-panel')));
    await P.tap('#tuto-card [data-tuto="next"]'); await P.tap('#tuto-card [data-tuto="next"]');
    await P.waitCard(/3\/6/);
    await P.tap('#tuto-card [data-tuto="skip"]');
    await sleep(500);
    check(tag, 'D Passer à l\'étape 3 : « skipped », étape 3', (await P.rec())?.state === 'skipped' && (await P.rec())?.step === 3);
    await P.tap('#btn-help');
    hb = await P.page.textContent('#help-body');
    check(tag, 'D Aide : « Reprendre (étape 3/6) »', /Reprendre \(étape 3\/6\)/.test(hb), hb.slice(0, 200));
    await P.page.screenshot({ path: `${SHOTS}/79-${tag}-aide.png` });
    await P.tap('#help-body [data-tuto-help="resume"]');
    c = await P.waitCard(/3\/6/);
    check(tag, 'D reprise à l\'étape 3', !!c);
    // E. Rechargement en cours de parcours, carte cachée derrière la fiche Aide
    await P.page.reload(); await P.page.waitForSelector('#block-name:not(:empty)');
    c = await P.waitCard(/3\/6/);
    check(tag, 'E rechargement en cours : reprise à la même étape', !!c);
    await P.tap('#btn-help');
    await sleep(500);
    check(tag, 'E carte cachée derrière la fiche Aide', !(await P.card()) && await P.page.evaluate(() => document.getElementById('tuto-card').classList.contains('is-behind')));
    await P.page.keyboard.press('Escape');
    c = await P.waitCard(/3\/6/);
    check(tag, 'E carte de retour à la fermeture de l\'Aide', !!c);
    await P.tap('#help-body [data-tuto-help]').catch(() => {});
    await P.page.focus('#tuto-card [data-tuto="next"]');
    await P.page.keyboard.press('Escape');
    await sleep(500);
    check(tag, 'D Échap sur la carte = Passer', !(await P.card()) && (await P.rec())?.state === 'skipped');
    check(tag, 'C/D/E aucune erreur', P.errors.length === 0, P.errors.join(' | '));
    await P.ctx.close();

    // F. Joueur historique : blocs déjà cassés, aucun état du tutoriel
    P = await open(w, h, tag);
    await P.waitCard(/Première partie/);
    for (let i = 0; i < 60 && await P.page.evaluate(() => GameState.stats.blocksDestroyed) === 0; i++) await hitBlock(P, 5);
    await P.page.evaluate(() => { Save.save(); localStorage.removeItem('dig_tutorial'); });
    await P.page.reload(); await P.page.waitForSelector('#block-name:not(:empty)'); await sleep(1800);
    check(tag, 'F joueur historique : aucune proposition', !(await P.card()) && (await P.rec()) === null,
      `blocs=${await P.page.evaluate(() => GameState.stats.blocksDestroyed)}`);
    await P.ctx.close();
  }

  // G. Compte : l'état suit le compte ; nouveau téléphone → aucune proposition
  {
    const tag = 'compte';
    let P = await open(390, 844, 'mob');
    await P.waitCard(/Première partie/);
    const user = `tuto${run}`.slice(0, 18);
    const reg = await P.page.evaluate(async u => (await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, email: `${u}@example.test`, password: 'motdepasse-solide' }) })).status, user);
    check(tag, 'G inscription (test)', reg === 200 || reg === 201, String(reg));
    await P.page.reload(); await P.page.waitForSelector('#block-name:not(:empty)');
    let c = await P.waitCard(/Première partie/, 4000);
    check(tag, 'G nouveau compte, partie neuve : proposition', !!c);
    await P.tap('#tuto-card [data-tuto="start"]');
    await P.waitCard(/1\/6/);
    await P.tap('#tuto-card [data-tuto="skip"]');
    await sleep(1500);
    const server = await P.page.evaluate(async () => (await (await fetch('/api/me/tutorial')).json()).tutorial);
    check(tag, 'G état envoyé au compte', server?.state === 'skipped' && server?.v === 1, JSON.stringify(server));
    await P.ctx.close();
    // Nouveau téléphone : navigateur vierge, connexion avant le jeu
    P = await open(390, 844, 'mob');
    const login = await P.page.evaluate(async u => (await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: 'motdepasse-solide' }) })).status, user);
    await P.page.evaluate(() => localStorage.clear());
    await P.page.reload(); await P.page.waitForSelector('#block-name:not(:empty)'); await sleep(2500);
    check(tag, 'G nouveau téléphone (connexion) : aucune proposition', login === 200 && !(await P.card()), `login=${login} card=${await P.card()}`);
    check(tag, 'G état du compte recopié dans le navigateur', (await P.rec())?.state === 'skipped');
    check(tag, 'G aucune erreur', P.errors.length === 0, P.errors.join(' | '));
    await P.ctx.close();
  }

  // H. Anglais
  {
    const P = await open(390, 844, 'mob', { lang: 'en' });
    const c = await P.waitCard(/First game/);
    check('en', 'H proposition en anglais', /Discover the game/.test(c || '') && /Skip/.test(c || ''), c);
    await P.tap('#tuto-card [data-tuto="start"]');
    check('en', 'H étape 1 en anglais', /Tap the block/.test(await P.waitCard(/1\/6/) || ''));
    await P.page.screenshot({ path: `${SHOTS}/79-en-etape1.png` });
    await P.ctx.close();
  }

  await browser.close();
  console.log(results.join('\n'));
  const fails = results.filter(r => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - fails}/${results.length} OK`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
