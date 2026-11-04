/**
 * Essai navigateur #70 : navigation de l'admin en menu groupé.
 * PC 1280×900 : menu latéral (une seule colonne, aucun bandeau d'onglets sur deux lignes), groupes repliables mémorisés,
 * menu réduit aux icônes mémorisé, recherche « Aller à une rubrique » (Entrée), F5 garde la rubrique, lien direct,
 * saisie conservée en changeant de rubrique, clavier (« / », ↑/↓). Smartphone 390×844 : bouton « Rubriques »,
 * ouverture / fermeture, changement de rubrique, aucun débordement ni texte coupé, menu fermé non superposé au contenu.
 * Hors `npm test` (navigateur requis). Captures dans OUT.
 *
 * Lancer (serveur de test démarré, base de test) :
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome BASE=http://127.0.0.1:3101 ADMIN=<secret> OUT=/tmp/dossier \
 *   node test/e2e/admin-nav.e2e.js
 */
'use strict';

const { chromium } = require(process.env.PW);
const { admOpenTab } = require('./_admin-nav');
const BASE = process.env.BASE, ADMIN = process.env.ADMIN, OUT = process.env.OUT || '/tmp';
const results = [];
const check = (tag, name, ok, extra = '') => results.push(`${ok ? 'OK  ' : 'FAIL'} [${tag}] ${name}${extra ? ` — ${extra}` : ''}`);

async function login(page) {
  await page.goto(`${BASE}/admin/`);
  await page.fill('#secret-input', ADMIN);
  await page.click('#secret-btn');
  await page.waitForSelector('#admin-app:not(.hidden)');
  await page.waitForTimeout(400);
}
const visibleSection = page => page.evaluate(() => [...document.querySelectorAll('.tab-content')].filter(s => !s.classList.contains('hidden')).map(s => s.id));

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const errors = [];

  // ── PC ──
  {
    const tag = 'pc 1280';
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
    await login(page);
    const nav = await page.evaluate(() => {
      const n = document.getElementById('admin-nav').getBoundingClientRect();
      const m = document.getElementById('admin-main').getBoundingClientRect();
      const btns = [...document.querySelectorAll('.tab-btn')].map(b => b.getBoundingClientRect());
      return { navW: Math.round(n.width), mainLeft: Math.round(m.left), mainW: Math.round(m.width), cols: new Set(btns.map(r => Math.round(r.left))).size,
        n: btns.length, groups: document.querySelectorAll('.nav-group').length, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    check(tag, 'menu latéral : une seule colonne, aucune ligne d\'onglets', nav.cols === 1 && nav.n >= 22 && nav.groups === 5, JSON.stringify(nav));
    check(tag, 'contenu à droite du menu, pas de défilement horizontal', nav.mainLeft >= nav.navW - 1 && nav.overflow <= 0);
    await page.screenshot({ path: `${OUT}/pc-1280-saisons.png` });
    for (const t of ['blocks', 'missions', 'news']) {
      await page.click(`.tab-btn[data-tab="${t}"]`); await page.waitForTimeout(500);
      const ok1 = (await visibleSection(page)).join() === `tab-${t}` && page.url().endsWith(`#${t}`);
      await page.reload(); await page.waitForSelector('#admin-app:not(.hidden)'); await page.waitForTimeout(600);
      const cur = await page.getAttribute('.tab-btn[aria-current="page"]', 'data-tab');
      check(tag, `« ${t} » puis F5 : même rubrique, marquée active`, ok1 && (await visibleSection(page)).join() === `tab-${t}` && cur === t);
    }
    await page.screenshot({ path: `${OUT}/pc-1280-actualites.png` });
    // groupe replié mémorisé
    await page.click('.nav-group[data-group="ops"] .nav-group-btn');
    const closed = await page.getAttribute('.nav-group[data-group="ops"] .nav-group-btn', 'aria-expanded') === 'false' && !(await page.isVisible('.tab-btn[data-tab="config"]'));
    await page.reload(); await page.waitForSelector('#admin-app:not(.hidden)'); await page.waitForTimeout(400);
    check(tag, 'groupe replié (aria-expanded=false) et mémorisé après F5', closed && !(await page.isVisible('.tab-btn[data-tab="config"]')));
    await page.click('.nav-group[data-group="ops"] .nav-group-btn');
    // recherche
    await page.fill('#nav-search', 'amelio');
    const shown = await page.$$eval('.tab-btn', bs => bs.filter(b => b.offsetParent).map(b => b.dataset.tab));
    check(tag, 'recherche « amelio » → seule Améliorations', shown.join() === 'upgrades', shown.join());
    await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    check(tag, 'Entrée ouvre la rubrique trouvée, recherche vidée', (await visibleSection(page)).join() === 'tab-upgrades' && await page.inputValue('#nav-search') === '');
    await page.fill('#nav-search', 'zzzz');
    check(tag, 'recherche sans résultat : message', await page.isVisible('#nav-search-empty'));
    await page.fill('#nav-search', '');
    // clavier : « / » puis ↓
    await page.click('#tab-upgrades h2');
    await page.keyboard.press('/');
    const focused = await page.evaluate(() => document.activeElement.id);
    await page.keyboard.press('ArrowDown');
    const next = await page.evaluate(() => document.activeElement.className);
    check(tag, 'clavier : « / » → recherche, ↓ → entrée suivante', focused === 'nav-search' && /nav-group-btn/.test(next), `${focused} ${next}`);
    // saisie conservée en changeant de rubrique
    await page.click('.tab-btn[data-tab="config"]'); await page.waitForTimeout(700);
    const cfg = page.locator('.config-value').first();
    const v0 = await cfg.inputValue();
    await cfg.fill(v0 + '9');
    await page.click('.tab-btn[data-tab="blocks"]'); await page.waitForTimeout(500);
    await page.click('.tab-btn[data-tab="config"]'); await page.waitForTimeout(700);
    check(tag, 'Configuration : saisie conservée après changement de rubrique, départ de la page protégé',
      await page.locator('.config-value').first().inputValue() === v0 + '9' && await page.evaluate(() => admAnyDirty()));
    await cfg.fill(v0);
    // fiche ouverte : modale, menu inaccessible
    await page.click('.tab-btn[data-tab="badges"]'); await page.waitForTimeout(600);
    await page.click('#btn-bg-add'); await page.waitForTimeout(200);
    let blocked;
    try { await page.click('.tab-btn[data-tab="news"]', { timeout: 800 }); blocked = (await visibleSection(page)).join() === 'tab-badges'; }
    catch { blocked = true; }
    check(tag, 'fiche ouverte : le menu ne change pas de rubrique derrière elle', blocked);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    // réduit aux icônes
    await page.click('#nav-collapse-btn'); await page.waitForTimeout(200);
    const col = await page.evaluate(() => ({ w: Math.round(document.getElementById('admin-nav').getBoundingClientRect().width),
      pressed: document.getElementById('nav-collapse-btn').getAttribute('aria-pressed'),
      lbl: getComputedStyle(document.querySelector('.tab-btn .nav-lbl')).width, title: document.querySelector('.tab-btn[data-tab="news"]').title }));
    await page.screenshot({ path: `${OUT}/pc-1280-icones.png` });
    await page.reload(); await page.waitForSelector('#admin-app:not(.hidden)'); await page.waitForTimeout(400);
    const kept = await page.evaluate(() => document.getElementById('admin-shell').classList.contains('nav-collapsed'));
    check(tag, 'menu réduit aux icônes (≤ 60 px), libellé en infobulle, mémorisé', col.w <= 60 && col.pressed === 'true' && col.lbl === '1px' && col.title === 'Actualités' && kept, JSON.stringify(col));
    await page.click('.tab-btn[data-tab="events"]'); await page.waitForTimeout(400);
    check(tag, 'mode icônes : navigation fonctionnelle', (await visibleSection(page)).join() === 'tab-events');
    await page.click('#nav-collapse-btn');
    // lien direct + ancien lien
    await page.goto(`${BASE}/admin/#season-overview`); await page.waitForSelector('#admin-app:not(.hidden)'); await page.waitForTimeout(500);
    check(tag, 'lien direct #season-overview (ancien « Ligues & Saisons ») → « Saison en cours »',
      (await visibleSection(page)).join() === 'tab-season-overview' && (await page.textContent('.tab-btn.active')).includes('Saison en cours'));
    await page.goto(`${BASE}/admin/#inconnu`); await page.reload(); await page.waitForSelector('#admin-app:not(.hidden)'); await page.waitForTimeout(400);
    check(tag, 'fragment inconnu → rubrique par défaut, marquée active', (await visibleSection(page)).join() === 'tab-seasons' && await page.getAttribute('.tab-btn.active', 'data-tab') === 'seasons');
    // lien interne programmé (fiche → Atelier d'icônes) : la bonne rubrique et son groupe
    await page.evaluate(() => document.querySelector('.tab-btn[data-tab="icons"]').click()); await page.waitForTimeout(300);
    check(tag, 'lien interne vers l\'Atelier : rubrique et groupe actifs', await page.getAttribute('.nav-group.has-active', 'data-group') === 'visuals');
    await ctx.close();
  }

  // ── Smartphone ──
  {
    const tag = 'mobile 390';
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
    await login(page);
    const closedH = await page.evaluate(() => Math.round(document.getElementById('admin-nav').getBoundingClientRect().height));
    check(tag, 'menu fermé : une barre « Rubriques » compacte, entrées masquées', closedH <= 60 && !(await page.isVisible('.tab-btn[data-tab="blocks"]')), `${closedH}px`);
    await page.screenshot({ path: `${OUT}/mobile-390-ferme.png` });
    await page.click('#nav-menu-btn'); await page.waitForTimeout(200);
    const open = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const cut = [...document.querySelectorAll('.tab-btn .nav-lbl, .nav-group-btn .nav-lbl')].filter(e => e.offsetParent && (e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > vw));
      return { expanded: document.getElementById('nav-menu-btn').getAttribute('aria-expanded'), cut: cut.map(e => e.textContent), overflow: document.documentElement.scrollWidth - vw };
    });
    check(tag, 'ouverture : aria-expanded, aucun libellé coupé, pas de débordement', open.expanded === 'true' && !open.cut.length && open.overflow <= 0, JSON.stringify(open));
    await page.screenshot({ path: `${OUT}/mobile-390-ouvert.png` });
    await page.tap('.tab-btn[data-tab="blocks"]'); await page.waitForTimeout(500);
    check(tag, 'choix « Blocs » : menu refermé, rubrique affichée, intitulé à jour',
      await page.getAttribute('#nav-menu-btn', 'aria-expanded') === 'false' && (await visibleSection(page)).join() === 'tab-blocks'
      && (await page.textContent('#nav-current')).includes('Blocs'));
    await page.screenshot({ path: `${OUT}/mobile-390-blocs.png` });
    await admOpenTab(page, 'news'); await page.waitForTimeout(500);
    await page.reload(); await page.waitForSelector('#admin-app:not(.hidden)'); await page.waitForTimeout(500);
    check(tag, 'Actualités puis F5 : même rubrique', (await visibleSection(page)).join() === 'tab-news' && (await page.textContent('#nav-current')).includes('Actualités'));
    await page.click('#nav-menu-btn'); await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    check(tag, 'Échap referme le menu', await page.getAttribute('#nav-menu-btn', 'aria-expanded') === 'false');
    // menu fermé au-dessus du contenu en défilement : barre seule, contenu non recouvert au repos
    await admOpenTab(page, 'config'); await page.waitForTimeout(600);
    await page.evaluate(() => window.scrollTo(0, 600)); await page.waitForTimeout(150);
    const sticky = await page.evaluate(() => [Math.round(document.getElementById('admin-nav').getBoundingClientRect().top), Math.round(scrollY)]);
    check(tag, 'barre « Rubriques » accessible après défilement', sticky[0] === 0 && sticky[1] > 100, String(sticky));
    await page.screenshot({ path: `${OUT}/mobile-390-defilement.png` });
    await admOpenTab(page, 'news'); await page.waitForTimeout(400);
    await page.goto(`${BASE}/`); await page.goBack(); await page.waitForSelector('#admin-app:not(.hidden)'); await page.waitForTimeout(500);
    check(tag, 'retour navigateur : rubrique retrouvée', (await visibleSection(page)).join() === 'tab-news');
    await ctx.close();
  }
  await b.close();
  check('global', 'aucune erreur JS', !errors.length, errors.join(' | '));
  console.log(results.join('\n'));
  console.log(results.some(r => r.startsWith('FAIL')) ? 'ÉCHECS' : 'TOUT OK');
})().catch(e => { console.error(e); console.log(results.join('\n')); process.exit(1); });
