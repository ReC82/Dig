/**
 * Parcours Chromium réels de l'accès Discord (#50, 07/11) : PC 1280×900, smartphone 390×844, 320×640.
 *  - lien configuré : bouton en tête d'Actualités, visible sans défiler, URL exacte, target _blank + noopener ;
 *    clic → nouvel onglet sur l'invitation (bloquée hors réseau : seul l'onglet et l'URL comptent), le jeu
 *    reste dans son onglet avec les mêmes PV et le même bloc ; Aide → « Communauté » ;
 *  - clavier : Tab depuis ✕ atteint le bouton ; Entrée l'ouvre ;
 *  - pas de débordement horizontal ; Échap ferme et le bloc reste cliquable.
 *  - DIG_E2E_EXPECT_NONE=1 : lien absent → aucun bouton Discord nulle part.
 * JAMAIS contre la production :
 *   DB_FILE=test-50.sqlite PORT=3101 node server/index.js
 *   DIG_E2E_BASE=http://127.0.0.1:3101 NODE_PATH=<dossier de playwright-core> node test/e2e/discord-access-50.e2e.js
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const BASE = process.env.DIG_E2E_BASE || 'http://127.0.0.1:3101';
if (/:3000\b|lodygames|lodylands/.test(BASE)) throw new Error('Parcours réservé à un serveur de test.');
const URL_OK = 'https://discord.gg/eGzJrzbaq';
const NONE = process.env.DIG_E2E_EXPECT_NONE === '1';
const exe = fs.readdirSync(process.env.HOME + '/.cache/ms-playwright').filter(d => d.startsWith('chromium-')).sort().pop();
const SHOTS = process.env.DIG_E2E_SHOTS || '/tmp';
const results = [];
const check = (tag, name, cond, extra = '') => { results.push(`${cond ? 'OK  ' : 'FAIL'} [${tag}] ${name}${extra ? ' — ' + extra : ''}`); };

(async () => {
  const browser = await chromium.launch({ executablePath: `${process.env.HOME}/.cache/ms-playwright/${exe}/chrome-linux64/chrome` });
  for (const [w, h, tag] of [[1280, 900, 'pc'], [390, 844, 'mob'], [320, 640, 'xs']]) {
    const touch = tag !== 'pc';
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, locale: 'fr-FR' });
    await ctx.route(/discord\.(gg|com)/, r => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>discord</title>' }));
    const page = await ctx.newPage();
    await page.goto(BASE + '/?lang=fr', { waitUntil: 'networkidle' });
    await page.evaluate(() => { try { localStorage.setItem('dig_tutorial', JSON.stringify({ state: 'skipped' })); } catch {} });
    await page.reload({ waitUntil: 'networkidle' });
    await page.keyboard.press('Escape').catch(() => {});
    const skip = page.locator('text=Passer').first();
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.locator('#block').click({ force: true });
    await page.waitForTimeout(1500);
    const snap = () => page.evaluate(() => `${document.getElementById('block-name')?.textContent} · ${document.getElementById('hp-text')?.textContent}`);
    const hpBefore = await snap();
    await page.click('#btn-news');
    await page.waitForTimeout(400);
    const a = page.locator('#news-body a.news-discord');
    if (NONE) {
      check(tag, 'Actualités : aucun bouton Discord sans lien', await a.count() === 0);
      await page.keyboard.press('Escape');
      await page.click('#btn-help');
      check(tag, 'Aide : aucune section Communauté sans lien', await page.locator('.help-community, #help-body a[href*="discord"]').count() === 0);
      await page.screenshot({ path: `${SHOTS}/discord-none-${tag}.png` });
      await ctx.close();
      continue;
    }
    check(tag, 'Actualités : bouton présent', await a.count() === 1);
    check(tag, 'URL exacte', await a.getAttribute('href') === URL_OK, await a.getAttribute('href'));
    check(tag, 'target _blank + noopener', await a.getAttribute('target') === '_blank' && /noopener/.test(await a.getAttribute('rel')));
    const box = await a.boundingBox();
    check(tag, 'visible sans défiler', box && box.y >= 0 && box.y + box.height <= h, JSON.stringify(box));
    check(tag, 'zone tactile ≥ 44 px de haut', box && box.height >= 44, String(box?.height));
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(tag, 'aucun débordement horizontal', over <= 0, String(over));
    await page.screenshot({ path: `${SHOTS}/discord-news-${tag}.png` });
    // Clavier : depuis ✕, Tab atteint le bouton Discord.
    await page.focus('#btn-news-close');
    await page.keyboard.press('Tab');
    check(tag, 'Tab depuis ✕ → bouton Discord', await page.evaluate(() => document.activeElement?.classList.contains('news-discord')));
    const [popup] = await Promise.all([ctx.waitForEvent('page'), touch ? a.tap() : page.keyboard.press('Enter')]);
    await popup.waitForLoadState().catch(() => {});
    check(tag, 'nouvel onglet sur l\'invitation', popup.url().replace(/\/$/, '') === URL_OK, popup.url());
    check(tag, 'pas d\'accès à window.opener', await popup.evaluate(() => window.opener === null));
    check(tag, 'jeu toujours dans son onglet', page.url().startsWith(BASE));
    await popup.close();
    await page.bringToFront();
    await page.keyboard.press('Escape');
    const hpAfter = await snap();
    check(tag, 'même bloc et mêmes PV au retour', hpBefore === hpAfter, `${hpBefore} / ${hpAfter}`);
    await page.click('#btn-help');
    await page.waitForTimeout(200);
    const ha = page.locator('#help-body .help-community a.news-discord');
    check(tag, 'Aide : section Communauté avec le lien', await ha.count() === 1 && await ha.getAttribute('href') === URL_OK);
    const hb = await ha.boundingBox();
    check(tag, 'Aide : lien visible sans défiler', hb && hb.y + hb.height <= h, JSON.stringify(hb));
    await page.screenshot({ path: `${SHOTS}/discord-help-${tag}.png` });
    await page.keyboard.press('Escape');
    await ctx.close();
  }
  await browser.close();
  console.log(results.join('\n'));
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
