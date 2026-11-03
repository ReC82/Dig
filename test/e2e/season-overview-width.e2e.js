/**
 * Essai navigateur de la recette #48 du 03/11 : l'onglet « 📊 Ligues & Saisons » occupe la largeur
 * utile (≤ 1440 px), centré ; les deux cartes de thème sont côte à côte et égales sur grand écran,
 * empilées sur smartphone ; aucun défilement horizontal de la page ; édition intacte.
 * Mesure aussi l'état « avant » en servant l'ancienne feuille de style (BEFORE_CSS), pour comparaison.
 * Hors `npm test` (navigateur requis).
 *
 * Lancer (serveur de test démarré) :
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   ADMIN=<secret> OUT=/tmp/dossier [BEFORE_CSS=/tmp/ancien-admin.css] node test/e2e/season-overview-width.e2e.js
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const { chromium } = require(process.env.PW);
const BASE = process.env.BASE, ADMIN = process.env.ADMIN, OUT = process.env.OUT || '/tmp';
const VIEWPORTS = [[1920, 1080], [1440, 900], [1280, 800], [390, 844]];
const errors = [];

async function measure(b, [w, h], css, tag) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: w < 500 });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${tag} ${w}: ${e.message}`));
  if (css) await page.route('**/admin/admin.css*', r => r.fulfill({ contentType: 'text/css', body: css }));
  await page.goto(`${BASE}/admin/`);
  await page.fill('#secret-input', ADMIN);
  await page.click('#secret-btn');
  await page.waitForSelector('#admin-app:not(.hidden)');
  await page.click('.tab-btn[data-tab="season-overview"]');
  await page.waitForSelector('#st-body .st-col');
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const r = el => el.getBoundingClientRect();
    const sec = r(document.getElementById('tab-season-overview'));
    const cols = [...document.querySelectorAll('#st-body .st-col')].map(r);
    return {
      vw: document.documentElement.clientWidth,
      sectionW: Math.round(sec.width), left: Math.round(sec.left), right: Math.round(document.documentElement.clientWidth - sec.right),
      cards: cols.map(c => [Math.round(c.left), Math.round(c.top), Math.round(c.width)]),
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  await page.screenshot({ path: `${OUT}/${tag}-${w}x${h}.png`, fullPage: false });
  return { page, ctx, m };
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const before = process.env.BEFORE_CSS ? fs.readFileSync(process.env.BEFORE_CSS, 'utf8') : null;
  for (const vp of VIEWPORTS) {
    if (before) {
      const { ctx, m } = await measure(b, vp, before, 'avant');
      console.log('avant', vp.join('x'), JSON.stringify(m));
      await ctx.close();
    }
    const { page, ctx, m } = await measure(b, vp, null, 'apres');
    console.log('après', vp.join('x'), JSON.stringify(m));
    assert.ok(m.pageOverflow <= 0, `${vp}: pas de défilement horizontal (${m.pageOverflow})`);
    if (vp[0] >= 1280) {
      assert.ok(Math.abs(m.left - m.right) <= 2, `${vp}: centré (${m.left} / ${m.right})`);
      assert.ok(m.sectionW >= Math.min(1440, m.vw) - 2, `${vp}: largeur utile (${m.sectionW})`);
      assert.strictEqual(m.cards[0][1], m.cards[1][1], `${vp}: cartes côte à côte`);
      assert.ok(Math.abs(m.cards[0][2] - m.cards[1][2]) <= 1, `${vp}: cartes égales`);
    } else {
      assert.ok(m.cards[1][1] > m.cards[0][1], `${vp}: cartes empilées`);
    }
    // Édition intacte : saisie d'un paramètre saisonnier conservée (non enregistrée).
    const input = page.locator('#ov-params-grid input').first();
    if (await input.count()) {
      const old = await input.inputValue();
      await input.fill('7');
      assert.strictEqual(await input.inputValue(), '7');
      await input.fill(old);
    }
    // Réglages avancés dépliés, sans débordement.
    await page.click('#st-card .st-adv > summary');
    await page.screenshot({ path: `${OUT}/apres-${vp.join('x')}-reglages.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${vp}: réglages sans débordement`);
    await ctx.close();
  }
  await b.close();
  assert.deepStrictEqual(errors, [], 'aucune erreur JS');
  console.log('✓ largeur, centrage, cartes, empilement mobile, édition : OK — 0 erreur JS');
})().catch(e => { console.error(e); process.exit(1); });
