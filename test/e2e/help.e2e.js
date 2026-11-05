/**
 * Parcours Chromium réels du ticket #78 (PC 1280×900, smartphone 390×844, petit écran 320×640) :
 *  A. En-tête : bouton Aide tout à gauche, zone tactile ≥ 40×44, sans chevauchement (cloche, logo, profil,
 *     paramètres, bandeau BÊTA) ; aucun débordement horizontal.
 *  B. Fiche : ouverture, focus sur ✕, « Comment jouer ? », une seule rubrique ouverte à la fois, Tab reste dans
 *     la fiche, Échap ferme et rend le focus ; onglet, bloc et PV identiques ; aucune requête POST.
 *  C. ? contextuels : Collection, Reliques, Pioche, Auto-Dig, Classement… bulle courte dans l'écran, « En savoir
 *     plus » ouvre la bonne rubrique ; un appui ailleurs (barre de navigation) ferme la bulle ET agit.
 *  D. Langue : anglais → intitulés et bulles en anglais ; italien (preview) → textes italiens.
 *
 * JAMAIS contre la production : serveur de test seulement, par exemple
 *   DB_FILE=test-78.sqlite PORT=3279 node server/index.js
 * puis
 *   DIG_E2E_BASE=http://127.0.0.1:3279 NODE_PATH=<dossier contenant playwright-core> node test/e2e/help.e2e.js
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

(async () => {
  const browser = await chromium.launch({ executablePath: `${process.env.HOME}/.cache/ms-playwright/${exe}/chrome-linux64/chrome` });
  for (const [w, h, tag] of [[1280, 900, 'pc'], [390, 844, 'mob'], [320, 640, 'xs']]) {
    const touch = tag !== 'pc';
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
    await ctx.addInitScript(() => { if (!localStorage.getItem('dig_lang')) localStorage.setItem('dig_lang', 'fr'); });
    const page = await ctx.newPage();
    const errors = [];
    const posts = [];
    page.on('pageerror', e => errors.push('pageerror ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console ' + m.text()); });
    page.on('request', r => { if (r.method() !== 'GET') posts.push(r.url()); });
    const tap = sel => (touch ? page.tap(sel) : page.click(sel));
    const box = sel => page.$(sel).then(e => (e ? e.boundingBox() : null));
    const visible = id => page.evaluate(i => !document.getElementById(i).classList.contains('hidden'), id);
    const focusId = () => page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.className || document.activeElement.tagName));

    await page.goto(BASE + '/');
    await page.waitForSelector('#block-name:not(:empty)');
    await page.waitForTimeout(400);

    // A. En-tête
    const bHelp = await box('#btn-help');
    const others = { cloche: await box('#btn-news'), logo: await box('#game-logo img'), profil: await box('#btn-account'),
      parametres: await box('#btn-settings'), beta: await box('#beta-banner') };
    check(tag, 'A bouton Aide visible, ≥ 40×44', bHelp && bHelp.width >= 40 && bHelp.height >= 44, JSON.stringify(bHelp));
    check(tag, 'A Aide tout à gauche (avant la cloche)', bHelp && others.cloche && bHelp.x + bHelp.width <= others.cloche.x + 0.5);
    for (const [n, b] of Object.entries(others)) if (b) check(tag, `A aucun chevauchement avec ${n}`, !overlap(bHelp, b), JSON.stringify(b));
    check(tag, 'A intitulé accessible', await page.getAttribute('#btn-help', 'aria-label') === 'Aide — comment jouer');
    check(tag, 'A pas de débordement horizontal', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: `${SHOTS}/78-${tag}-entete.png`, clip: { x: 0, y: 0, width: w, height: 120 } });

    // B. Fiche Aide
    const blockBefore = await page.evaluate(() => `${document.getElementById('block-name').textContent}|${document.getElementById('hp-text').textContent}`);
    const postsBefore = posts.length;
    await tap('#btn-help');
    check(tag, 'B fiche ouverte', await page.isVisible('#help-panel'));
    check(tag, 'B focus sur ✕', await focusId() === 'btn-help-close', await focusId());
    check(tag, 'B aria-expanded=true', await page.getAttribute('#btn-help', 'aria-expanded') === 'true');
    const body = await page.textContent('#help-body');
    check(tag, 'B « Comment jouer ? » et FAQ profondeur', /Comment jouer \?/.test(body) && /Pourquoi mon rang ne dépend-il pas de ma profondeur/.test(body));
    check(tag, 'B rubriques repliées au départ', await page.$$eval('#help-body details[open]', e => e.length) === 0);
    await page.screenshot({ path: `${SHOTS}/78-${tag}-fiche.png` });
    await tap('#help-topic-ranking > summary');
    await tap('#help-topic-autodig > summary');
    const opened = await page.$$eval('#help-body details[open]', e => e.map(d => d.id));
    check(tag, 'B une seule rubrique ouverte à la fois', opened.length === 1 && opened[0] === 'help-topic-autodig', opened.join(','));
    check(tag, 'B Auto-Dig : non classé', /ne comptent pas pour le classement/.test(await page.textContent('#help-topic-autodig')));
    await page.screenshot({ path: `${SHOTS}/78-${tag}-fiche-rubrique.png` });
    check(tag, 'B défilement interne de la fiche', await page.evaluate(() => { const i = document.getElementById('help-panel-inner'); return i.scrollHeight > i.clientHeight; }));
    // Tab reste dans la fiche
    await page.focus('#btn-help-close');
    await page.keyboard.press('Shift+Tab');
    check(tag, 'B Maj+Tab depuis ✕ reste dans la fiche', await page.evaluate(() => document.getElementById('help-panel-inner').contains(document.activeElement)));
    await page.keyboard.press('Escape');
    check(tag, 'B Échap ferme', !(await page.isVisible('#help-panel')));
    check(tag, 'B focus rendu au bouton Aide', await focusId() === 'btn-help', await focusId());
    const blockAfter = await page.evaluate(() => `${document.getElementById('block-name').textContent}|${document.getElementById('hp-text').textContent}`);
    check(tag, 'B onglet Creuser et bloc intacts', (await visible('view-dig')) && blockAfter === blockBefore, blockAfter);
    check(tag, 'B aucune requête POST (ni sauvegarde ni achat)', posts.length === postsBefore, posts.slice(postsBefore).join(','));
    // Clic sur le voile → ferme
    await tap('#btn-help');
    await page.mouse.click(w - 3, h - 3);
    check(tag, 'B clic à côté ferme', !(await page.isVisible('#help-panel')));

    // C. ? contextuels
    await tap('.nav-btn[data-view="collection"]');
    await tap('#view-collection .view-title-bar .help-tip-btn');
    check(tag, 'C ? Collection → bulle', await page.isVisible('#help-tip'));
    const tb = await box('#help-tip');
    check(tag, 'C bulle dans l’écran', tb && tb.x >= 0 && tb.y >= 0 && tb.x + tb.width <= w && tb.y + tb.height <= h, JSON.stringify(tb));
    const tipTxt = await page.textContent('#help-tip');
    check(tag, 'C bulle courte et ciblée', /Collection des origines/.test(tipTxt) && tipTxt.length < 420, String(tipTxt.length));
    check(tag, 'C ? aria-expanded=true', await page.getAttribute('#view-collection .view-title-bar .help-tip-btn', 'aria-expanded') === 'true');
    await page.screenshot({ path: `${SHOTS}/78-${tag}-bulle-collection.png` });
    await tap('#help-tip .help-tip-more');
    check(tag, 'C « En savoir plus » → fiche sur Collection', await page.isVisible('#help-panel') && await page.$eval('#help-topic-collection', d => d.open));
    await tap('#btn-help-close');
    check(tag, 'C fermeture → focus rendu au ?', await page.evaluate(() => document.activeElement?.dataset?.help) === 'collection');
    check(tag, 'C toujours sur Collection', await visible('view-collection'));
    // Reliques, plus bas dans la page
    await page.$eval('#relics-grid', e => e.scrollIntoView({ block: 'center' }));
    await tap('.section-divider .help-tip-btn[data-help="relics"]');
    check(tag, 'C ? Reliques → bulle', /fragments/.test(await page.textContent('#help-tip')));
    // Appui sur la nav pendant que la bulle est ouverte : la bulle se ferme ET l'onglet change
    await tap('.nav-btn[data-view="upgrades"]');
    check(tag, 'C appui ailleurs : bulle fermée et action faite', !(await page.isVisible('#help-tip')) && await visible('view-upgrades'));
    await tap('.upgrade-name .help-tip-btn[data-help="pickaxe"]');
    check(tag, 'C ? Pioche', /dégâts de chaque coup/.test(await page.textContent('#help-tip')));
    await tap('.upgrade-name .help-tip-btn[data-help="autodig"]');
    check(tag, 'C ? Auto-Dig (bascule de bulle)', /Auto-Dig frappe/.test(await page.textContent('#help-tip')));
    await page.keyboard.press('Escape');
    check(tag, 'C Échap ferme la bulle', !(await page.isVisible('#help-tip')));
    await tap('.nav-btn[data-view="season"]');
    await page.waitForSelector('#view-season .season-section-title .help-tip-btn', { timeout: 8000 }).catch(() => {});
    if (await page.$('#view-season .season-section-title .help-tip-btn')) {
      await tap('#view-season .season-section-title .help-tip-btn');
      check(tag, 'C ? Classement : blocs manuels validés', /cassés toi-même, validés par le serveur/.test(await page.textContent('#help-tip')));
      await page.screenshot({ path: `${SHOTS}/78-${tag}-bulle-classement.png` });
      await page.keyboard.press('Escape');
    } else check(tag, 'C ? Classement présent', false, 'saison non chargée');
    check(tag, 'C pas de débordement horizontal', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

    // D. Langues
    await page.evaluate(() => localStorage.setItem('dig_lang', 'en'));
    await page.reload();
    await page.waitForSelector('#block-name:not(:empty)');
    check(tag, 'D anglais : intitulé du bouton', await page.getAttribute('#btn-help', 'aria-label') === 'Help — how to play');
    await tap('.nav-btn[data-view="collection"]');
    check(tag, 'D anglais : intitulé du ?', await page.getAttribute('#view-collection .view-title-bar .help-tip-btn', 'aria-label') === 'Help: Collection');
    await tap('#view-collection .view-title-bar .help-tip-btn');
    check(tag, 'D anglais : bulle', /Origins collection/.test(await page.textContent('#help-tip')));
    await page.goto(BASE + '/?lang=it');
    await page.waitForSelector('#block-name:not(:empty)');
    await page.waitForFunction(() => document.documentElement.lang === 'it' && I18n.has('help.title', 'it'), null, { timeout: 8000 }).catch(() => {});
    await tap('#btn-help');
    check(tag, 'D italien : fiche traduite, sans mention de repli', /Come si gioca\?/.test(await page.textContent('#help-body')) && !(await page.$('.help-fallback')));
    await page.keyboard.press('Escape');
    await page.evaluate(() => { localStorage.setItem('dig_lang', 'fr'); localStorage.removeItem('dig_lang_preview'); });

    check(tag, 'aucune erreur console', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  await browser.close();
  console.log(results.join('\n'));
  const fails = results.filter(r => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - fails}/${results.length} OK`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
