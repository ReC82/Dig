/**
 * Parcours Chromium réels du ticket #67 (panel admin, puis jeu en PC 1280×900 et smartphone 390×844) :
 *  A. Admin → 🎨 Icônes, zone « Navigation du bas », fiche Collection : proposition affichée, aucun renvoi
 *     à #41, aperçu avant/après PC et smartphone, « Appliquer cette image dans le jeu… » distinct de
 *     « Refaire » ; Annuler la confirmation n'applique rien ; Confirmer l'applique.
 *  B. Jeu : l'onglet Collection affiche l'image, les autres onglets et le logo sont inchangés ; pictogrammes
 *     des coûts (pièces), d'une amélioration et de la médaille d'or appliqués par la route du panel affichés ;
 *     missions du jour : emoji d'origine (emblèmes du catalogue #68, inactif en jeu).
 *  C. Aperçu ?uiicon= (rien d'appliqué) et image introuvable → repli sur l'emoji d'origine.
 *  D. Retour arrière depuis le panel (« Revenir au pictogramme d'origine ») : le jeu réaffiche 📦.
 *  Aucune erreur console, pas de débordement horizontal.
 *
 * JAMAIS contre la production : serveur de test seulement, par exemple
 *   DB_FILE=test-67.sqlite DIG_AI_FAKE=1 ADMIN_SECRET=<secret> PORT=3101 node server/index.js
 * puis
 *   DIG_E2E_BASE=http://127.0.0.1:3101 ADMIN=<secret> NODE_PATH=<dossier contenant playwright-core> node test/e2e/ui-icons.e2e.js
 */
const { chromium } = require('playwright-core');
const { admOpenTab } = require('./_admin-nav');
const fs = require('fs');
const sharp = require('sharp');
const BASE = process.env.DIG_E2E_BASE || 'http://127.0.0.1:3101';
const ADMIN = process.env.ADMIN;
if (/:3000\b|lodygames|lodylands/.test(BASE)) throw new Error('Parcours réservé à un serveur de test.');
const exe = fs.readdirSync(process.env.HOME + '/.cache/ms-playwright').filter(d => d.startsWith('chromium-')).sort().pop();
const SHOTS = process.env.DIG_E2E_SHOTS || '/tmp';
const results = [];
const check = (tag, name, cond, extra = '') => { results.push(`${cond ? 'OK  ' : 'FAIL'} [${tag}] ${name}${extra ? ' — ' + extra : ''}`); };
const H = { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' };
const api = async (method, path, body) => (await fetch(BASE + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined })).json();
const uiMap = async () => (await (await fetch(`${BASE}/api/ui-icons`)).json()).icons;

async function upload(key, color) {
  const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect x="190" y="250" width="640" height="520" rx="60" fill="${color}"/></svg>`)).png().toBuffer();
  return api('POST', `/api/admin/icons/targets/${key}/upload`, { data: png.toString('base64') });
}

(async () => {
  const browser = await chromium.launch({ executablePath: `${process.env.HOME}/.cache/ms-playwright/${exe}/chrome-linux64/chrome` });
  const errors = [];
  const watch = (page, tag) => {
    page.on('pageerror', e => errors.push(`${tag} pageerror ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${tag} console ${m.text()}`); });
  };

  // Préparation : une proposition (téléversée, aucune IA) pour Collection, une image pour les autres essais
  const col = await upload('ui:collection', '#a0602a');
  const other = await upload('ui:medaille_argent', '#2a80c0');
  check('prep', 'propositions téléversées', !!col.sha && !!other.sha, JSON.stringify([col.error, other.error]));
  check('prep', 'rien appliqué au départ', Object.keys(await uiMap()).length === 0);

  // A. Panel
  const actx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await actx.newPage();
  watch(admin, 'admin');
  await admin.goto(`${BASE}/admin/`);
  await admin.fill('#secret-input', ADMIN);
  await admin.click('#secret-btn');
  await admin.waitForSelector('#admin-app:not(.hidden)');
  await admOpenTab(admin, 'icons');
  await admin.waitForSelector('#ic-grid .ic-card');
  await admin.selectOption('#ic-zone', 'nav');
  const navCards = await admin.$$eval('#ic-grid .ic-card .ic-card-name', els => els.map(e => e.textContent));
  check('A', 'filtre zone « Navigation du bas » : 6 onglets', navCards.length === 6, navCards.join(', '));
  await admin.click('#ic-grid .ic-card[aria-label="Ouvrir la fiche Collection"]');
  await admin.waitForSelector('#ic-sheet .ic-compare');
  const sheet = await admin.textContent('#ic-sheet');
  check('A', 'aucun renvoi à #41', !/#41/.test(sheet));
  check('A', 'emplacement exact affiché', /onglet « Collection » de la barre du bas/.test(sheet));
  check('A', 'aperçu avant/après PC et smartphone', /Aperçu avant \/ après/.test(sheet) && /Smartphone \(390 px\)/.test(sheet) && /Ordinateur/.test(sheet));
  const applyBtn = admin.locator('#ic-sheet button', { hasText: 'Appliquer cette image dans le jeu…' });
  check('A', 'bouton « Appliquer » distinct de « Refaire »', await applyBtn.count() === 1 && await admin.locator('#ic-sheet button', { hasText: '↻ Refaire' }).count() === 1);
  check('A', 'lien « Prévisualiser dans le jeu »', await admin.locator(`#ic-sheet a[href="/?uiicon=collection:${col.sha}"]`).count() === 1);
  await admin.screenshot({ path: `${SHOTS}/67-admin-collection-avant.png`, fullPage: true });
  await applyBtn.click();
  await admin.waitForSelector('#adm-confirm[open]');
  const conf = await admin.textContent('#adm-confirm');
  check('A', 'confirmation explicite (emplacement, tous les joueurs, retour arrière)', /Appliquer cette image à « Collection »/.test(conf) && /tous les joueurs/.test(conf) && /Revenir à l'icône précédente/.test(conf));
  await admin.click('#adm-confirm-no');
  await admin.waitForTimeout(300);
  check('A', 'Annuler : rien appliqué', Object.keys(await uiMap()).length === 0);
  await applyBtn.click();
  await admin.waitForSelector('#adm-confirm[open]');
  await admin.click('#adm-confirm-yes');
  await admin.waitForSelector('#ic-sheet .ic-kept');
  check('A', 'Confirmer : appliqué', (await uiMap()).collection === col.url);
  check('A', 'retour arrière proposé', await admin.locator('#ic-sheet button', { hasText: 'Revenir au pictogramme d\'origine' }).count() >= 1);
  await admin.screenshot({ path: `${SHOTS}/67-admin-collection-applique.png`, fullPage: true });

  // Autres cibles variées, par la route du panel (même code serveur) : monnaie, amélioration, médaille
  for (const id of ['pieces', 'upgrade_pickaxe', 'medaille_or']) {
    const r = await api('POST', `/api/admin/icons/targets/ui:${id}/apply`, { sha: other.sha, live: true });
    if (r.error) check('prep', `application ${id}`, false, r.error);
  }

  // B. Jeu
  for (const [w, h, tag] of [[1280, 900, 'pc'], [390, 844, 'mob']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: tag === 'mob', isMobile: tag === 'mob' });
    await ctx.addInitScript(() => localStorage.setItem('dig_lang', 'fr'));
    const page = await ctx.newPage();
    watch(page, tag);
    const tap = sel => (tag === 'mob' ? page.tap(sel) : page.click(sel));
    await page.goto(BASE + '/');
    await page.waitForSelector('#block-name:not(:empty)');
    await page.waitForSelector('.nav-icon[data-ui-icon="collection"] img.ui-ico');
    const nav = await page.$$eval('.nav-icon', els => els.map(e => [e.dataset.uiIcon, e.querySelector('img') ? e.querySelector('img').getAttribute('src') : e.textContent.trim()]));
    check(tag, 'B onglet Collection = image appliquée', nav.find(n => n[0] === 'collection')[1] === col.url);
    check(tag, 'B autres onglets inchangés (emoji)', nav.filter(n => n[0] !== 'collection').every(n => !n[1].startsWith('/media/')), JSON.stringify(nav));
    const img = await page.$eval('.nav-icon[data-ui-icon="collection"] img', e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), e.complete && e.naturalWidth > 0]; });
    check(tag, 'B image chargée, taille d\'un pictogramme', img[2] && img[0] >= 20 && img[0] <= 32, img.join('×'));
    check(tag, 'B logo inchangé', await page.$eval('#game-logo img', e => e.getAttribute('src').split('?')[0]) === 'assets/logo/a-lingot.svg');
    check(tag, 'B en-tête inchangé (SVG d\'origine)', await page.$$eval('.hdr-ico-wrap svg', e => e.length) === 3);
    await page.screenshot({ path: `${SHOTS}/67-${tag}-jeu-collection.png` });
    check(tag, 'B récompense du bloc : pictogramme « pièces »', await page.$$eval('#block-reward img.ui-ico', e => e.length) >= 1);
    await tap('.nav-btn[data-view="upgrades"]');
    check(tag, 'B coûts : pictogramme « pièces »', await page.$$eval('#upgrades-list img.ui-ico', e => e.length) > 0);
    check(tag, 'B carte Pioche : image appliquée', await page.$$eval('#upgrades-list .upgrade-icon img.ui-ico', e => e.length) === 1);
    await tap('.nav-btn[data-view="daily"]');
    await page.waitForSelector('.mission-card');
    const m = await page.$$eval('.mission-card', cards => cards.map(c => [!!c.querySelector('.mission-icon img.ui-ico'), !!c.querySelector('.mission-reward-text img.ui-ico')]));
    check(tag, 'B missions du jour : emblème d\'origine (catalogue #68 inactif), récompense en pièces = image', m.length > 0 && m.every(x => !x[0]) && m.some(x => x[1]), JSON.stringify(m));
    await page.screenshot({ path: `${SHOTS}/67-${tag}-jeu-missions.png` });
    check(tag, 'B pas de débordement horizontal', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

    // C. Aperçu (rien d'appliqué) et repli sur image introuvable
    await page.goto(`${BASE}/?uiicon=saison:${col.sha},boutique:ffffffffffffffff`);
    await page.waitForSelector('.nav-icon[data-ui-icon="saison"] img.ui-ico');
    await page.waitForTimeout(500);
    check(tag, 'C aperçu ?uiicon= : Saison affichée avec l\'image', !!(await page.$('.nav-icon[data-ui-icon="saison"] img.ui-ico')));
    check(tag, 'C image introuvable → emoji d\'origine', (await page.textContent('.nav-icon[data-ui-icon="boutique"]')).trim() === '🛒' && !(await page.$('.nav-icon[data-ui-icon="boutique"] img')));
    check(tag, 'C aperçu non appliqué côté serveur', (await uiMap()).saison === undefined);
    await page.goto(BASE + '/');
    await page.waitForSelector('#block-name:not(:empty)');
    await page.waitForTimeout(500);
    check(tag, 'C aperçu non mémorisé', !(await page.$('.nav-icon[data-ui-icon="saison"] img')));
    await ctx.close();
  }

  // D. Retour arrière depuis le panel
  await admin.locator('#ic-sheet button', { hasText: 'Revenir au pictogramme d\'origine' }).first().click();
  await admin.waitForSelector('#adm-confirm[open]');
  await admin.click('#adm-confirm-yes');
  await admin.waitForTimeout(800);
  check('D', 'retour au pictogramme d\'origine (serveur)', (await uiMap()).collection === undefined);
  const hist = await admin.textContent('#ic-sheet');
  check('D', 'historique : appliquée puis retour', /Appliquée en jeu/.test(hist) && /Retour au pictogramme d'origine/.test(hist));
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => localStorage.setItem('dig_lang', 'fr'));
  const page = await ctx.newPage();
  watch(page, 'D');
  await page.goto(BASE + '/');
  await page.waitForSelector('#block-name:not(:empty)');
  await page.waitForTimeout(800);
  check('D', 'jeu : 📦 réaffiché après retour arrière', (await page.textContent('.nav-icon[data-ui-icon="collection"]')).trim() === '📦' && !(await page.$('.nav-icon[data-ui-icon="collection"] img')));

  check('all', 'aucune erreur console', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed}/${results.length} contrôles réussis`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
