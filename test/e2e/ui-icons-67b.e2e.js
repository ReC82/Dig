/**
 * Recette #67-B (10/11) — parcours Chromium réels, PC 1280×900, smartphone 390×844 et 320×640 :
 *  A. Une image téléversée (aucune IA) est appliquée à TOUTES les cibles déployables du registre (réutilisation,
 *     aucune génération) ; le jeu l'affiche aux nouveaux emplacements : ? d'aide de l'en-tête et ? contextuels,
 *     ℹ️ « Comment fonctionne la saison ? », thème de la semaine, guide des boutiques, Boutique (titres, packs de
 *     gemmes, Pioche et entretien), titres des vues Améliorations/Collection, bouton « Doubler ».
 *  B. Boutons d'aide : même aria-label, zone tactile ≥ 24 px, ouverture au clic et au clavier, focus conservé.
 *  C. Carte FRAGS et en-tête « Blocs manuels » : plus aucun petit pictogramme isolé.
 *  D. Titres statiques toujours décorés après un changement de langue ; aucun débordement horizontal.
 *  E. Retour arrière d'une cible (info) : le jeu réaffiche ℹ️.
 *  F. Inventaire : avec tout appliqué, chaque emoji encore visible = emplacement NON raccordé (fichier JSON).
 *
 * JAMAIS contre la production : serveur de test seulement, par exemple
 *   DB_FILE=test-67.sqlite DIG_AI_FAKE=1 ADMIN_SECRET=<secret ≥ 32 car.> PORT=3101 node server/index.js
 * puis
 *   DIG_E2E_BASE=http://127.0.0.1:3101 ADMIN=<secret> NODE_PATH=<dossier contenant playwright-core> node test/e2e/ui-icons-67b.e2e.js
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const sharp = require('sharp');
const { UI_TARGETS } = require('../../server/uiIcons');
const BASE = process.env.DIG_E2E_BASE || 'http://127.0.0.1:3101';
const ADMIN = process.env.ADMIN;
if (/:3000\b|lodygames|lodylands/.test(BASE)) throw new Error('Parcours réservé à un serveur de test.');
const exe = fs.readdirSync(process.env.HOME + '/.cache/ms-playwright').filter(d => d.startsWith('chromium-')).sort().pop();
const OUT = process.env.DIG_E2E_SHOTS || '/tmp';
const results = [];
const check = (tag, name, cond, extra = '') => { results.push(`${cond ? 'OK  ' : 'FAIL'} [${tag}] ${name}${extra ? ' — ' + extra : ''}`); };
const H = { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' };
const api = async (method, path, body) => (await fetch(BASE + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined })).json();
const uiMap = async () => (await (await fetch(`${BASE}/api/ui-icons`)).json()).icons;

const VIEWS = ['dig', 'upgrades', 'collection', 'daily', 'shop', 'season', 'profile', 'settings'];

/** Emoji encore visibles dans la vue active (hors images appliquées) : emplacement, rôle, raccordement. */
function inventory(view) {
  const RE = /\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier}|‍\p{Extended_Pictographic})*/gu;
  const scope = view === 'header' ? [document.querySelector('header'), document.getElementById('stats'), document.getElementById('bottom-nav')]
    : [document.getElementById(`view-${view}`)];
  const out = [];
  const where = el => {
    const parts = [];
    for (let e = el; e && parts.length < 3 && !/^view-/.test(e.id || ''); e = e.parentElement) {
      if (e.id) { parts.unshift(`#${e.id}`); break; }
      const c = [...e.classList].filter(x => !/^(is-|has-|hidden)/.test(x))[0];
      if (c) parts.unshift(`.${c}`);
    }
    return parts.join(' ');
  };
  for (const root of scope.filter(Boolean)) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
      for (const m of n.nodeValue.matchAll(RE)) {
        const role = el.closest('button, a, summary, [role="button"]') ? 'interactif' : el.closest('[aria-hidden="true"]') ? 'décoratif' : 'informatif';
        const text = (el.closest('li, h3, summary, .section-divider, .view-title-bar, .shop-card, .lb-row, div') || el).innerText.replace(/\s+/g, ' ').trim().slice(0, 70);
        out.push({ view, emoji: m[0], where: where(el), role, text });
      }
    }
    for (const img of root.querySelectorAll('img.ui-ico')) {
      if (!img.getClientRects().length) continue;
      out.push({ view, emoji: '[image appliquée]', where: where(img), role: 'raccordé', text: (img.closest('[data-ui-icon], [data-ui-lead]')?.dataset.uiIcon) || '' });
    }
  }
  return out;
}

(async () => {
  const browser = await chromium.launch({ executablePath: `${process.env.HOME}/.cache/ms-playwright/${exe}/chrome-linux64/chrome` });
  const errors = [];
  const watch = (page, tag) => {
    page.on('pageerror', e => errors.push(`${tag} pageerror ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${tag} console ${m.text()}`); });
  };

  // A. Une seule image téléversée, réutilisée pour toutes les cibles déployables (aucune génération)
  const png = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><circle cx="512" cy="512" r="380" fill="#3a8f5a"/></svg>')).png().toBuffer();
  const up = await api('POST', '/api/admin/icons/targets/ui:aide/upload', { data: png.toString('base64') });
  check('prep', 'image téléversée sur ui:aide', !!up.sha, up.error ?? '');
  const deployable = UI_TARGETS.filter(u => u.deployable).map(u => u.id);
  const refused = [];
  for (const id of deployable) {
    const r = await api('POST', `/api/admin/icons/targets/ui:${id}/apply`, { sha: up.sha, live: true });
    if (r.error) refused.push(`${id}: ${r.error}`);
  }
  check('prep', `${deployable.length} cibles déployables appliquées`, !refused.length, refused.join(' | '));
  const bm = await api('POST', '/api/admin/icons/targets/ui:blocs_mines/apply', { sha: up.sha, live: true });
  check('prep', 'blocs_mines (retiré) : application refusée', !!bm.error && !('blocs_mines' in await uiMap()), bm.error ?? '');

  const inv = [];
  for (const [w, h, tag] of [[1280, 900, 'pc'], [390, 844, '390'], [320, 640, '320']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: tag !== 'pc', isMobile: tag !== 'pc' });
    await ctx.addInitScript(() => { localStorage.setItem('dig_lang', 'fr'); localStorage.setItem('dig_tutorial', JSON.stringify({ v: 1, state: 'skipped', step: 0, at: Date.now() })); });
    const page = await ctx.newPage();
    watch(page, tag);
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => document.querySelector('#btn-help img.ui-ico')?.complete);
    await page.evaluate(() => document.querySelectorAll('.tutorial-overlay, #tutorial, .tuto').forEach(e => e.remove()));

    // B. Aide générale : image, même bouton, même texte accessible, même comportement
    const helpBtn = await page.$eval('#btn-help', b => { const r = b.getBoundingClientRect(); return { label: b.getAttribute('aria-label'), w: r.width, h: r.height, img: !!b.querySelector('img.ui-ico[alt=""]'), svg: !!b.querySelector('svg') }; });
    check(tag, 'B ? de l\'en-tête : image appliquée, bouton et aria-label conservés', helpBtn.img && !helpBtn.svg && /Aide/.test(helpBtn.label) && helpBtn.w >= 24 && helpBtn.h >= 24, JSON.stringify(helpBtn));
    await page.click('#btn-help');
    check(tag, 'B ? de l\'en-tête : ouvre toujours l\'aide', await page.getAttribute('#btn-help', 'aria-expanded') === 'true');
    await page.keyboard.press('Escape');
    await page.focus('#btn-help');
    await page.keyboard.press('Enter');
    check(tag, 'B ? de l\'en-tête : ouverture au clavier', await page.getAttribute('#btn-help', 'aria-expanded') === 'true');
    await page.keyboard.press('Escape');

    // C. Carte FRAGS : libellé seul, comme les cinq autres cartes
    const labels = await page.$$eval('#stats .stat .label', ls => ls.map(l => l.textContent.trim()));
    check(tag, 'C barre du haut : aucun pictogramme dans les libellés (FRAGS compris)', labels.length === 6 && labels.every(l => !/\p{Extended_Pictographic}/u.test(l)) && labels[5] === 'Frags', labels.join(' | '));
    check(tag, 'C barre du haut : valeur FRAGS conservée', (await page.textContent('#stat-relics')).trim() !== '');

    // Dig : bouton « Doubler »
    check(tag, 'A Dig : pictogramme du bouton « Doubler »', await page.$$eval('.bonus-btn-icon img.ui-ico', e => e.length) === 1 && await page.getAttribute('#btn-bonus-boost', 'aria-label') !== null);

    // Améliorations : titres statiques + ? contextuels (zone tactile 28 px, aria-label conservé)
    await page.click('.nav-btn[data-view="upgrades"]');
    const upg = await page.evaluate(() => ({
      leads: ['ameliorations', 'coffres', 'objectifs'].map(id => !!document.querySelector(`[data-ui-lead="${id}"] > .ui-lead img.ui-ico`)),
      title: document.querySelector('[data-ui-lead="coffres"]').textContent.trim(),
      tips: [...document.querySelectorAll('#view-upgrades .help-tip-btn')].map(b => { const r = b.getBoundingClientRect(); return [!!b.querySelector('img.ui-ico'), Math.round(r.width), Math.round(r.height), !!b.getAttribute('aria-label')]; }),
    }));
    check(tag, 'A Améliorations : titres ⚙ / 📦 / 🎯 remplacés, texte conservé', upg.leads.every(Boolean) && upg.title === 'Coffres de saison', JSON.stringify(upg.leads) + ' ' + upg.title);
    check(tag, 'B ? contextuels : image, 28×28 px, aria-label', upg.tips.length >= 2 && upg.tips.every(t => t[0] && t[1] === 28 && t[2] === 28 && t[3]), JSON.stringify(upg.tips));
    const tip = page.locator('#view-upgrades .help-tip-btn').first();
    await tip.focus(); await page.keyboard.press('Enter');
    check(tag, 'B ? contextuel : ouvre sa bulle au clavier', await tip.getAttribute('aria-expanded') === 'true');
    await page.keyboard.press('Escape');

    // D. Changement de langue : les titres statiques restent décorés
    await page.evaluate(() => I18n.setLang('en'));
    await page.waitForFunction(() => /Season chests/i.test(document.querySelector('[data-ui-lead="coffres"]').textContent));
    check(tag, 'D EN : titre « Coffres » toujours décoré, texte traduit', await page.$$eval('[data-ui-lead="coffres"] img.ui-ico', e => e.length) === 1, await page.textContent('[data-ui-lead="coffres"]'));
    await page.evaluate(() => I18n.setLang('fr'));
    await page.waitForFunction(() => /Coffres de saison/.test(document.querySelector('[data-ui-lead="coffres"]').textContent));

    // Collection
    await page.click('.nav-btn[data-view="collection"]');
    check(tag, 'A Collection : titres 📦 / ✨ / 🏅 remplacés', await page.evaluate(() => ['collection', 'reliques', 'badges'].every(id => document.querySelector(`[data-ui-lead="${id}"] img.ui-ico`))));

    // Boutique
    await page.click('.nav-btn[data-view="shop"]');
    await page.waitForSelector('#shop-grid-gems .shop-card');
    const shop = await page.evaluate(() => ({
      title: !!document.querySelector('#view-shop .view-title-bar img.ui-ico'),
      guide: document.querySelectorAll('#view-shop .shop-guide img.ui-ico').length,
      gems: !!document.querySelector('#shop-gems-anchor img.ui-ico'),
      packs: document.querySelectorAll('#shop-grid-gems .shop-item-icon img.ui-ico').length,
      boosts: document.querySelectorAll('#shop-grid-boosts img.ui-ico').length,
      boostTitle: !!document.querySelector('#shop-grid-boosts')?.previousElementSibling?.querySelector('img.ui-ico'),
      pick: !!document.querySelector('#shop-pickaxe img.ui-ico'),
      pickCards: document.querySelectorAll('.pick-card .shop-item-icon img.ui-ico').length,
      pickCardsAll: document.querySelectorAll('.pick-card').length,
    }));
    check(tag, 'A Boutique : titre, guide (6), Gemmes, 3 packs, Boosts', shop.title && shop.guide === 6 && shop.gems && shop.packs === 3 && shop.boosts === 1 && shop.boostTitle, JSON.stringify(shop));
    check(tag, 'A Boutique : Pioche et entretien (titre, réserve, vitesse, recharges)', shop.pick && shop.pickCards === shop.pickCardsAll && shop.pickCardsAll >= 3, JSON.stringify(shop));

    // Saison
    await page.click('.nav-btn[data-view="season"]');
    await page.waitForSelector('#view-season .season-info-card');
    const season = await page.evaluate(() => ({
      theme: !!document.querySelector('.season-theme-icon img.ui-ico'),
      info: !!document.querySelector('.season-info-toggle img.ui-ico'),
      infoText: document.querySelector('.season-info-toggle').textContent.trim(),
      tips: [...document.querySelectorAll('#view-season .help-tip-btn')].every(b => b.querySelector('img.ui-ico')),
      // En-tête du classement rendu avec une ligne : texte seul, aucun pictogramme
      lbHead: (() => { const d = document.createElement('div'); d.innerHTML = _leaderboardHtml({ leaderboard: [{ rank: 1, username: 'x', manualBlocks: 3, maxDepth: 4 }] }); const h = d.querySelector('.lb-head .lb-blocks'); return [h.textContent.trim(), h.querySelectorAll('img').length]; })(),
    }));
    check(tag, 'A Saison : thème de la semaine, ℹ️ « Comment fonctionne la saison ? », ? contextuels', season.theme && season.info && season.tips && season.infoText === 'Comment fonctionne la saison ?', JSON.stringify(season));
    check(tag, 'C classement : en-tête « Blocs manuels » sans pictogramme', season.lbHead[0] === 'Blocs manuels' && season.lbHead[1] === 0, JSON.stringify(season.lbHead));
    await page.click('.season-info-toggle');
    check(tag, 'B ℹ️ : le repli s\'ouvre toujours', await page.evaluate(() => document.querySelector('.season-info-card').open));

    // D. Aucun débordement horizontal, toutes vues
    const over = [];
    for (const v of VIEWS) {
      await page.click(`.nav-btn[data-view="${v}"]`).catch(() => page.evaluate(x => switchView(x), v));
      await page.waitForTimeout(250);
      const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (o > 0) over.push(`${v}:+${o}`);
      if (tag !== '320') inv.push(...(await page.evaluate(inventory, v)).map(x => ({ ...x, viewport: tag })));
    }
    if (tag !== '320') inv.push(...(await page.evaluate(inventory, 'header')).map(x => ({ ...x, viewport: tag })));
    check(tag, 'D aucun débordement horizontal (8 vues)', !over.length, over.join(' '));
    await page.screenshot({ path: `${OUT}/67b-${tag}-season.png`, fullPage: false });
    await ctx.close();
  }

  // E. Retour arrière de la cible « info » : ℹ️ réaffiché
  const rb = await api('POST', '/api/admin/icons/targets/ui:info/apply', { sha: null, live: true });
  check('E', 'retour arrière ui:info (serveur)', !rb.error && !('info' in await uiMap()), rb.error ?? '');
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => { localStorage.setItem('dig_lang', 'fr'); localStorage.setItem('dig_tutorial', JSON.stringify({ v: 1, state: 'skipped', step: 0, at: Date.now() })); });
    const page = await ctx.newPage();
    watch(page, 'E');
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => document.querySelector('#btn-help img.ui-ico'));
    await page.evaluate(() => switchView('season'));
    await page.waitForSelector('#view-season .season-info-card');
    await page.waitForTimeout(800);
    check('E', 'jeu : « ℹ️ Comment fonctionne la saison ? » d\'origine', (await page.textContent('.season-info-toggle')).trim() === 'ℹ️ Comment fonctionne la saison ?');
    await ctx.close();
  }

  check('all', 'aucune erreur console', !errors.length, errors.slice(0, 5).join(' | '));
  fs.writeFileSync(`${OUT}/67b-inventory.json`, JSON.stringify(inv, null, 1));
  await browser.close();
  console.log(results.join('\n'));
  const ok = results.filter(r => r.startsWith('OK')).length;
  console.log(`\n${ok}/${results.length} contrôles réussis — inventaire : ${inv.length} occurrences → ${OUT}/67b-inventory.json`);
  process.exit(ok === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
