/**
 * Parcours Chromium réels du ticket #61 (PC 1280×900 et smartphone 390×844) : fiches protégées (clic extérieur, Échap
 * répété, ✕, sélection relâchée sur le fond, retour à l'état initial, échec réseau, abandon, enregistrement), fiches
 * Objet et Badge, formulaires de page conservés, petite fiche de saisie (remplace prompt), aucune fenêtre native.
 *
 * JAMAIS contre la production : serveur de test seulement, par exemple
 *   ADMIN_SECRET=$(openssl rand -hex 24) DB_FILE=test-61.sqlite PORT=3101 node server/index.js
 * puis une série de brouillon « saint_martin » (PUT /api/admin/collections/draft/series/saint_martin), et
 *   DIG_E2E_BASE=http://127.0.0.1:3101 DIG_E2E_SECRET_FILE=<fichier contenant ADMIN_SECRET> \
 *   NODE_PATH=<dossier contenant playwright-core> node test/e2e/admin-unsaved.e2e.js
 * Le parcours enregistre une seule fois le nom de la série (PC) : la base de test change, jamais une autre.
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
  const secret = fs.readFileSync(process.env.DIG_E2E_SECRET_FILE || '/tmp/t61-secret', 'utf8').trim();
  const api = async (path) => (await fetch(BASE + path, { headers: { Authorization: `Bearer ${secret}`, 'X-Dig-Admin': '1' } })).json();
  const seriesName = async () => (await api('/api/admin/collections')).draft.series.find(s => s.id === 'saint_martin').names.fr;
  for (const [w, h, tag] of [[1280, 900, 'pc'], [390, 844, 'mob']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: tag === 'mob' });
    const page = await ctx.newPage();
    const errors = [], natives = [];
    page.on('pageerror', e => errors.push('pageerror ' + e.message));
    // Ressources en échec attendues (401 avant connexion, coupure réseau simulée) : seules les erreurs JS comptent.
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console ' + m.text()); });
    page.on('dialog', d => { natives.push(`${d.type()}: ${d.message()}`); d.dismiss(); });
    await page.goto(BASE + '/admin/#collections');
    await page.fill('#secret-input', secret);
    await page.click('#secret-btn');
    await page.waitForSelector('[data-adm-key="co-series:saint_martin"]', { state: 'attached', timeout: 8000 });
    const sheet = page.locator('#co-series-dialog'); const SH = 'co-series-dialog', CF = 'adm-confirm';
    const confirmBox = page.locator('#adm-confirm');
    const isOpen = id => page.evaluate(i => !!document.getElementById(i)?.open, id);
    const backdrop = async () => {   // clic à côté de la fiche
      const b = await sheet.boundingBox();
      const x = Math.max(2, b.x - 8 > 2 ? b.x - 8 : 2), y = Math.min(h - 3, b.y + b.height + 8 < h - 3 ? b.y + b.height + 8 : h - 3);
      await page.mouse.click(b.x > 12 ? b.x - 8 : 3, b.y > 12 ? b.y - 8 : y);
      await page.waitForTimeout(250);
    };
    const openSeries = async () => {
      await page.evaluate(() => { const r = document.querySelector('[data-adm-key="co-series:saint_martin"]'); r.closest('details') && (r.closest('details').open = true); r.scrollIntoView(); });
      await page.click('[data-adm-key="co-series:saint_martin"]');
      await page.waitForTimeout(300);
    };
    const before = await seriesName();
    await openSeries();
    check(tag, 'fiche série ouverte', await isOpen(SH));
    await page.screenshot({ path: `${SHOTS}/${tag}-1-fiche.png` });
    await backdrop();
    check(tag, 'fiche propre : clic extérieur ferme sans question', !(await isOpen(SH)) && !(await isOpen(CF)));
    // Fiche modifiée : clic extérieur
    await openSeries();
    await page.fill('#co-s-name-fr', 'Trésors MODIFIÉS');
    await backdrop();
    check(tag, 'fiche modifiée : clic extérieur → confirmation Dig, fiche toujours ouverte', await isOpen(SH) && await isOpen(CF));
    check(tag, 'focus par défaut sur « Continuer à modifier »', await page.evaluate(() => document.activeElement?.id === 'adm-confirm-no' && document.activeElement.textContent === 'Continuer à modifier'));
    await page.screenshot({ path: `${SHOTS}/${tag}-2-confirm.png` });
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    check(tag, 'Échap sur la confirmation = continuer, saisie conservée', await isOpen(SH) && await page.inputValue('#co-s-name-fr') === 'Trésors MODIFIÉS');
    // Échap répétés sur la fiche (Chrome : second Échap sans activation)
    for (let k = 0; k < 3; k++) {
      await page.focus('#co-s-icon');
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
      const okk = await isOpen(SH) && await isOpen(CF);
      check(tag, `Échap n°${k + 1} sur la fiche modifiée → confirmation`, okk);
      if (await isOpen(CF)) { await page.click('#adm-confirm-no'); await page.waitForTimeout(150); }
    }
    // ✕
    await page.click('#co-series-dialog [data-close]'); await page.waitForTimeout(200);
    check(tag, '✕ sur la fiche modifiée → confirmation', await isOpen(CF));
    await page.click('#adm-confirm-no'); await page.waitForTimeout(150);
    // Sélection de texte qui finit sur le fond
    const ib = await page.locator('#co-s-name-fr').boundingBox();
    await page.mouse.move(ib.x + ib.width - 4, ib.y + ib.height / 2);
    await page.mouse.down();
    await page.mouse.move(2, ib.y + ib.height / 2, { steps: 5 });
    await page.mouse.up(); await page.waitForTimeout(200);
    check(tag, 'sélection de texte relâchée sur le fond : rien ne se passe', await isOpen(SH) && !(await isOpen(CF)));
    // Retour à l'état initial = plus de confirmation
    await page.fill('#co-s-name-fr', before);
    await backdrop();
    check(tag, 'retour à la valeur initiale : fermeture sans question', !(await isOpen(SH)) && !(await isOpen(CF)));
    // Échec réseau à l'enregistrement
    await openSeries();
    await page.fill('#co-s-name-fr', 'Trésors réseau');
    await page.route('**/api/admin/collections/draft/series/**', r => r.abort());
    await page.click('#btn-co-s-save'); await page.waitForTimeout(400);
    const msg = await page.textContent('#co-s-msg');
    check(tag, 'échec réseau : fiche ouverte, saisie conservée, erreur affichée', await isOpen(SH) && await page.inputValue('#co-s-name-fr') === 'Trésors réseau' && /injoignable/.test(msg), msg);
    await page.screenshot({ path: `${SHOTS}/${tag}-3-reseau.png` });
    await page.unroute('**/api/admin/collections/draft/series/**');
    check(tag, 'aucune donnée enregistrée pendant ces essais', await seriesName() === before);
    // Abandonner
    await page.click('#co-series-dialog [data-close]'); await page.waitForTimeout(200);
    await page.click('#adm-confirm-yes'); await page.waitForTimeout(250);
    check(tag, '« Abandonner les modifications » ferme la fiche, rien enregistré', !(await isOpen(SH)) && await seriesName() === before);
    await openSeries();
    check(tag, 'réouverture : valeur enregistrée affichée', await page.inputValue('#co-s-name-fr') === before);
    // Enregistrement réussi
    const saved = before + (tag === 'pc' ? ' ✓' : '');
    if (saved !== before) {
      await page.fill('#co-s-name-fr', saved);
      await page.click('#btn-co-s-save'); await page.waitForTimeout(600);
      check(tag, 'enregistrement réussi : fiche fermée, valeur enregistrée', !(await isOpen(SH)) && await seriesName() === saved);
      await openSeries();
      await backdrop();
      check(tag, 'après enregistrement : fiche propre, clic extérieur ferme', !(await isOpen(SH)));
    } else { await backdrop(); }
    // Case à cocher + sélection (autres types de champ)
    await openSeries();
    await page.click('#co-s-active');
    await backdrop();
    check(tag, 'case à cocher modifiée → confirmation', await isOpen(CF));
    await page.click('#adm-confirm-no'); await page.waitForTimeout(150);
    await page.click('#co-s-active');
    await backdrop();
    check(tag, 'case remise à l\'état initial → fermeture', !(await isOpen(SH)));
    // Objet : fiche à instantané
    await page.click('#btn-co-add'); await page.waitForTimeout(200);
    await page.click('#btn-co-add-item'); await page.waitForTimeout(300);
    await page.fill('#co-i-id', 'objet_test');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    check(tag, 'fiche objet : Échap → confirmation Dig (plus de confirm natif)', await isOpen('co-item-dialog') && await isOpen(CF));
    await page.click('#adm-confirm-yes'); await page.waitForTimeout(200);
    check(tag, 'fiche objet abandonnée', !(await isOpen('co-item-dialog')));
    // Badges : fiche manuelle (suivi générique)
    await page.click('button[data-tab="badges"]'); await page.waitForTimeout(700);
    await page.click('#btn-bg-add'); await page.waitForTimeout(200);
    await page.click('#btn-bg-add-manual'); await page.waitForTimeout(300);
    await page.fill('#bg-fr-name', 'Badge test');
    const bb = await page.locator('#bg-dialog').boundingBox();
    await page.mouse.click(bb.x > 12 ? bb.x - 6 : 3, bb.y > 12 ? bb.y - 6 : h - 3); await page.waitForTimeout(250);
    check(tag, 'fiche badge modifiée : clic extérieur → confirmation', await isOpen('bg-dialog') && await isOpen(CF));
    await page.click('#adm-confirm-yes'); await page.waitForTimeout(200);
    // Formulaire de page : Configuration conservée au changement d'onglet
    await page.click('button[data-tab="config"]'); await page.waitForTimeout(700);
    const cfg = page.locator('.config-value').first();
    const cfgBefore = await cfg.inputValue();
    await cfg.fill(cfgBefore + '9');
    await page.click('button[data-tab="economy"]'); await page.waitForTimeout(500);
    await page.fill('#eco-coin-gain', '1.7');
    await page.click('button[data-tab="config"]'); await page.waitForTimeout(700);
    check(tag, 'Configuration : saisie conservée après changement d\'onglet', await page.locator('.config-value').first().inputValue() === cfgBefore + '9');
    await page.click('button[data-tab="economy"]'); await page.waitForTimeout(700);
    check(tag, 'Économie : saisie conservée après rechargement de l\'onglet', await page.inputValue('#eco-coin-gain') === '1.7');
    check(tag, 'départ de la page protégé (admAnyDirty)', await page.evaluate(() => admAnyDirty()));
    // Petite fiche de saisie (remplace prompt)
    const pr = page.evaluate(() => admPrompt({ title: 'Essai', label: 'Motif' }));
    await page.waitForTimeout(150);
    await page.keyboard.type('motif test'); await page.keyboard.press('Enter');
    check(tag, 'admPrompt : saisie Dig, Entrée valide', await pr === 'motif test');
    const pr2 = page.evaluate(() => admPrompt({ title: 'Essai', label: 'Motif' }));
    await page.waitForTimeout(150); await page.keyboard.press('Escape');
    check(tag, 'admPrompt : Échap = annulé (null)', await pr2 === null);
    check(tag, 'aucune fenêtre native', natives.length === 0, natives.join(' | '));
    check(tag, 'aucune erreur JS', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  await browser.close();
  console.log(results.join('\n'));
  console.log(results.filter(r => r.startsWith('FAIL')).length ? 'ÉCHECS' : 'TOUT OK');
})().catch(e => { console.error(e); console.log(results.join('\n')); process.exit(1); });
