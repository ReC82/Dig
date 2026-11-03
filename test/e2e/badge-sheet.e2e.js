/**
 * Parcours Chromium réels de la recette #38-A (PC 1280×900 et smartphone 390×844) : fiche badge sur le modèle de la
 * fiche Actualités #50 — une langue à la fois avec aperçu synchronisé, sections, options avancées repliées, pied fixe
 * Enregistrer / Annuler toujours visible, une seule zone défilante, saisies protégées (#61 : fond, ✕, Échap, échec
 * d'enregistrement), aucune fenêtre native, aucune erreur JS.
 *
 * JAMAIS contre la production : serveur de test seulement, par exemple
 *   ADMIN_SECRET=$(openssl rand -hex 24) DB_FILE=test-38.sqlite PORT=3101 node server/index.js
 * puis
 *   DIG_E2E_BASE=http://127.0.0.1:3101 DIG_E2E_SECRET_FILE=<fichier contenant ADMIN_SECRET> \
 *   NODE_PATH=<dossier contenant playwright-core> node test/e2e/badge-sheet.e2e.js
 * Le parcours enregistre une seule fois le nom EN du badge profondeur_100 (PC) : la base de test change, jamais une autre.
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const BASE = process.env.DIG_E2E_BASE || 'http://127.0.0.1:3101';
if (/:3000\b|lodygames|lodylands/.test(BASE)) throw new Error('Parcours réservé à un serveur de test.');
const exe = fs.readdirSync(process.env.HOME + '/.cache/ms-playwright').filter(d => d.startsWith('chromium-')).sort().pop();
const SHOTS = process.env.DIG_E2E_SHOTS || '/tmp';
const results = [];
const check = (tag, name, cond, extra = '') => { results.push(`${cond ? 'OK  ' : 'FAIL'} [${tag}] ${name}${extra ? ' — ' + extra : ''}`); };
(async () => {
  const browser = await chromium.launch({ executablePath: `${process.env.HOME}/.cache/ms-playwright/${exe}/chrome-linux64/chrome` });
  const secret = fs.readFileSync(process.env.DIG_E2E_SECRET_FILE || '/tmp/t38-secret', 'utf8').trim();
  const api = async (path) => (await fetch(BASE + path, { headers: { Authorization: `Bearer ${secret}`, 'X-Dig-Admin': '1' } })).json();
  const badge = async () => (await api('/api/admin/badges')).badges.find(b => b.id === 'profondeur_100');
  for (const [w, h, tag] of [[1280, 900, 'pc'], [390, 844, 'mob']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: tag === 'mob' });
    const page = await ctx.newPage();
    const errors = [], natives = [];
    page.on('pageerror', e => errors.push('pageerror ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console ' + m.text()); });
    page.on('dialog', d => { natives.push(`${d.type()}: ${d.message()}`); d.dismiss(); });
    await page.goto(BASE + '/admin/#badges');
    await page.fill('#secret-input', secret);
    await page.click('#secret-btn');
    await page.waitForSelector('[data-adm-key="badge:profondeur_100"]', { state: 'attached', timeout: 8000 });
    const SH = 'bg-dialog', CF = 'adm-confirm';
    const sheet = page.locator('#bg-dialog');
    const isOpen = id => page.evaluate(i => !!document.getElementById(i)?.open, id);
    const open = async () => {
      await page.evaluate(() => document.querySelector('[data-adm-key="badge:profondeur_100"]').scrollIntoView());
      await page.click('[data-adm-key="badge:profondeur_100"]');
      await page.waitForTimeout(300);
    };
    const inView = sel => page.evaluate(([s, vh]) => { const r = document.querySelector(s).getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= vh; }, [sel, h]);
    const keep = async () => { await page.click('#adm-confirm-no'); await page.waitForTimeout(200); };

    await open();
    check(tag, 'fiche ouverte', await isOpen(SH));
    const box = await sheet.boundingBox();
    check(tag, 'fiche tenant dans l\'écran', box.y >= 0 && box.y + box.height <= h + 1, `${Math.round(box.height)} px`);
    check(tag, 'Enregistrer visible sans défiler', await inView('#btn-bg-save'));
    check(tag, 'Annuler visible sans défiler', await inView('#bg-dialog .nw-foot [data-close]'));
    const langs = await page.$$eval('#bg-dialog .nw-lang-fields', ds => ds.filter(d => d.offsetParent).map(d => d.dataset.lang));
    check(tag, 'une seule langue visible (FR)', langs.join() === 'fr', langs.join());
    check(tag, 'options avancées repliées', !(await page.$eval('#bg-period-box', d => d.open)));
    check(tag, 'résumé des options lisible replié', /visible · ordre \d+ · permanent/.test(await page.textContent('#bg-adv-sum')));
    const scrollers = await page.$$eval('#bg-dialog *', els => els.filter(e => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1 && e.tagName !== 'TEXTAREA'; }).map(e => e.className));
    check(tag, 'au plus une zone défilante', scrollers.length <= 1 && scrollers.every(c => /nw-scroll/.test(c)), scrollers.join(' | '));
    const hscroll = await page.$eval('#bg-dialog .nw-scroll', e => e.scrollWidth - e.clientWidth);
    check(tag, 'pas de défilement horizontal', hscroll <= 1, `${hscroll}`);
    await page.screenshot({ path: `${SHOTS}/t38-${tag}-1-fiche.png` });
    const pills = await page.$$eval('#bg-langs .co-lang-btn', bs => bs.map(b => b.textContent.trim()).join(' '));
    check(tag, 'pastilles de langue', pills === '● FR ● EN ● NL ● ES', pills);

    // Langue EN : champs EN seuls, aperçu en anglais, référence française
    await page.click('#bg-langs [data-lang="en"]');
    const enName = await page.inputValue('#bg-en-name');
    check(tag, 'onglet EN : aperçu en anglais', (await page.textContent('#bg-pv-name')) === enName && /\(EN\)/.test(await page.textContent('#bg-pv-h')));
    check(tag, 'onglet EN : référence FR affichée', await page.isVisible('#bg-fr-ref'));
    check(tag, 'onglet EN : nom FR masqué', !(await page.isVisible('#bg-fr-name')));
    // Clavier : flèche droite → NL
    await page.focus('#bg-langs [data-lang="en"]');
    await page.keyboard.press('ArrowRight');
    check(tag, 'flèche → NL', await page.isVisible('#bg-nl-name') && await page.evaluate(() => document.activeElement.dataset.lang === 'nl'));
    await page.click('#bg-langs [data-lang="en"]');
    const newEn = `${tag === 'pc' ? 'One hundred metres down' : 'Mobile test name'} ${Date.now() % 100000}`;   // différent à chaque passage
    await page.fill('#bg-en-name', newEn);
    check(tag, 'aperçu synchronisé à la saisie', (await page.textContent('#bg-pv-name')) === newEn);
    check(tag, 'indicateur « non enregistrées »', await page.isVisible('#bg-dirty'));
    await page.fill('#bg-en-name', '');
    check(tag, 'EN vidé : repli FR signalé', /texte français affiché/.test(await page.textContent('#bg-pv-h')) && /○ EN/.test(await page.textContent('#bg-langs')));
    await page.fill('#bg-en-name', newEn);
    await page.screenshot({ path: `${SHOTS}/t38-${tag}-2-en.png` });

    // Protection #61 : Échap, ✕, fond
    await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    check(tag, 'Échap → confirmation Dig', await isOpen(SH) && await isOpen(CF));
    await keep();
    check(tag, 'Continuer à modifier → saisie conservée', await isOpen(SH) && (await page.inputValue('#bg-en-name')) === newEn);
    await page.click('#bg-dialog .bk-dialog-head [data-close]'); await page.waitForTimeout(250);
    check(tag, '✕ → confirmation Dig', await isOpen(CF));
    await keep();
    const b2 = await sheet.boundingBox();
    await page.mouse.click(b2.x > 12 ? b2.x - 6 : 3, b2.y > 12 ? b2.y - 6 : 3); await page.waitForTimeout(250);
    check(tag, 'clic sur le fond → confirmation Dig', await isOpen(SH) && await isOpen(CF));
    await keep();

    if (tag === 'pc') {
      // Échec d'enregistrement (réseau coupé) : fiche ouverte, message dans le pied, saisie conservée
      await ctx.setOffline(true);
      await page.click('#btn-bg-save'); await page.waitForTimeout(300);
      if (await isOpen(CF)) { await page.click('#adm-confirm-yes'); await page.waitForTimeout(600); }
      check(tag, 'échec réseau : fiche ouverte, saisie conservée', await isOpen(SH) && (await page.inputValue('#bg-en-name')) === newEn);
      check(tag, 'échec réseau : message visible dans le pied', await inView('#bg-form-msg'), await page.textContent('#bg-form-msg'));
      await ctx.setOffline(false);
      // Options avancées dépliées : toujours une seule zone défilante, pied visible
      await page.click('#bg-period-box > summary');
      check(tag, 'options dépliées : Enregistrer toujours visible', await inView('#btn-bg-save'));
      await page.screenshot({ path: `${SHOTS}/t38-${tag}-3-options.png` });
      await page.click('#btn-bg-save'); await page.waitForTimeout(300);
      if (await isOpen(CF)) { await page.click('#adm-confirm-yes'); await page.waitForTimeout(800); }
      check(tag, 'enregistrement : fiche fermée', !(await isOpen(SH)));
      check(tag, 'enregistrement : nom EN en base', (await badge()).names.en === newEn);
    } else {
      // Abandon : rien n'est enregistré
      await page.keyboard.press('Escape'); await page.waitForTimeout(250);
      await page.click('#adm-confirm-yes'); await page.waitForTimeout(300);
      check(tag, 'abandon : fiche fermée, rien enregistré', !(await isOpen(SH)) && (await badge()).names.en !== newEn);
    }
    check(tag, 'aucune fenêtre native', !natives.length, natives.join(' | '));
    check(tag, 'aucune erreur JS', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  await browser.close();
  console.log(results.join('\n'));
  process.exitCode = results.some(r => r.startsWith('FAIL')) ? 1 : 0;
})();
