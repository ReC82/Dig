/**
 * Parcours Chromium réels du ticket #63 (PC 1280×900 et smartphone 390×844) :
 *  A. Invité : personne → Profil (« Invité », progression, invitation à se connecter), engrenage → Paramètres
 *     (formulaire de compte, langue, notifications) ; deux vues distinctes, bouton actif signalé (aria-current).
 *  B. Retour : depuis l'onglet Améliorations, Profil puis « Retour » ramène à Améliorations ; un second appui sur la
 *     personne aussi ; le bloc en cours (nom, PV) est identique au retour sur Creuser ; aucun rechargement.
 *  C. Connecté : pseudo, « Membre depuis », décompte des badges (un seul GET /api/me/badges en deux ouvertures
 *     rapprochées), Profil → Paramètres du compte → déconnexion présente seulement dans Paramètres.
 *  D. Zones tactiles des deux boutons ≥ 44 px, pas de débordement horizontal, aucune erreur console.
 *
 * JAMAIS contre la production : serveur de test seulement, par exemple
 *   DB_FILE=test-63.sqlite PORT=3101 node server/index.js
 * puis
 *   DIG_E2E_BASE=http://127.0.0.1:3101 NODE_PATH=<dossier contenant playwright-core> node test/e2e/profile-settings.e2e.js
 * Crée un compte jetable par format dans la base de TEST.
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
  for (const [w, h, tag] of [[1280, 900, 'pc'], [390, 844, 'mob']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: tag === 'mob', isMobile: tag === 'mob' });
    await ctx.addInitScript(() => localStorage.setItem('dig_lang', 'fr'));
    const page = await ctx.newPage();
    const errors = [];
    let badgeCalls = 0, navigations = 0;
    page.on('pageerror', e => errors.push('pageerror ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console ' + m.text()); });
    page.on('request', r => { if (r.url().includes('/api/me/badges')) badgeCalls++; });
    page.on('framenavigated', f => { if (f === page.mainFrame()) navigations++; });
    const tap = sel => (tag === 'mob' ? page.tap(sel) : page.click(sel));
    const visible = id => page.evaluate(i => !document.getElementById(i).classList.contains('hidden'), id);

    await page.goto(BASE + '/');
    await page.waitForSelector('#block-name:not(:empty)');
    const navsAfterLoad = navigations;

    // A. Invité
    await tap('#btn-account');
    check(tag, 'A personne → Profil', await visible('view-profile') && !(await visible('view-settings')));
    const prof = await page.textContent('#view-profile');
    check(tag, 'A Profil invité : titre, « Invité », progression', /Profil/.test(prof) && /Invité/.test(prof) && /Profondeur/.test(prof) && /Blocs détruits/.test(prof));
    check(tag, 'A Profil sans réglage (pas de champ, pas de langue)', await page.$$eval('#view-profile input, #view-profile #lang-current, #view-profile #btn-account-logout', e => e.length) === 0);
    check(tag, 'A bouton Profil actif', await page.getAttribute('#btn-account', 'aria-current') === 'page' && !(await page.getAttribute('#btn-settings', 'aria-current')));
    await page.screenshot({ path: `${SHOTS}/63-${tag}-profil-invite.png`, fullPage: false });
    await tap('#btn-settings');
    check(tag, 'A engrenage → Paramètres', await visible('view-settings') && !(await visible('view-profile')));
    const set = await page.textContent('#view-settings');
    check(tag, 'A Paramètres : compte, langue, notifications, sans stats du profil',
      /Compte/.test(set) && /Langue/.test(set) && /notifications/i.test(set) && !/Blocs détruits/.test(set));
    check(tag, 'A bouton Paramètres actif', await page.getAttribute('#btn-settings', 'aria-current') === 'page' && !(await page.getAttribute('#btn-account', 'aria-current')));

    // B. Retour vers l'onglet d'origine, bloc intact
    await tap('#btn-settings-back');
    check(tag, 'B retour depuis Paramètres → Creuser', await visible('view-dig'));
    const blockBefore = await page.evaluate(() => `${document.getElementById('block-name').textContent}|${document.getElementById('hp-text').textContent}`);
    await tap('.nav-btn[data-view="upgrades"]');
    await tap('#btn-account');
    await tap('#btn-profile-back');
    check(tag, 'B Profil → Retour → Améliorations', await visible('view-upgrades'));
    await tap('#btn-account');
    await tap('#btn-account');
    check(tag, 'B second appui sur la personne → Améliorations', await visible('view-upgrades'));
    await tap('.nav-btn[data-view="dig"]');
    const blockAfter = await page.evaluate(() => `${document.getElementById('block-name').textContent}|${document.getElementById('hp-text').textContent}`);
    check(tag, 'B bloc en cours inchangé', blockBefore === blockAfter, blockAfter);
    check(tag, 'B aucun rechargement de page', navigations === navsAfterLoad);

    // C. Connecté
    const name = `p63${tag}${Date.now() % 1e6}`;
    const r = await page.request.post(BASE + '/api/register', { data: { username: name, email: `${name}@example.invalid`, password: 'secret123' } });
    if (!r.ok()) throw new Error(`inscription ${r.status()} ${await r.text()}`);
    await page.reload();
    await page.waitForSelector('#block-name:not(:empty)');
    await page.waitForFunction(() => typeof _account !== 'undefined' && _account);
    badgeCalls = 0;
    await tap('#btn-account');
    await page.waitForFunction(() => /obtenus/.test(document.getElementById('profile-badges')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
    const p2 = await page.textContent('#view-profile');
    check(tag, 'C pseudo affiché', p2.includes(name));
    check(tag, 'C « Membre depuis » (date d\'inscription)', /Membre depuis le \d+ \S+ \d{4}/.test(p2));
    check(tag, 'C décompte des badges', /\d+ \/ \d+ obtenus/.test(p2), (await page.textContent('#profile-badges')));
    check(tag, 'C e-mail absent du Profil', !p2.includes('@example.invalid'));
    await page.screenshot({ path: `${SHOTS}/63-${tag}-profil-connecte.png`, fullPage: true });
    await tap('#btn-profile-back');
    await tap('#btn-account');
    check(tag, 'C un seul appel badges pour deux ouvertures rapprochées', badgeCalls === 1, `${badgeCalls} appel(s)`);
    await tap('.profile-to-settings');
    check(tag, 'C Profil → Paramètres du compte', await visible('view-settings'));
    check(tag, 'C déconnexion dans Paramètres', !!(await page.$('#view-settings #btn-account-logout')));
    await page.screenshot({ path: `${SHOTS}/63-${tag}-parametres.png`, fullPage: false });
    await tap('#btn-settings-back');
    check(tag, 'C retour depuis Paramètres → Creuser', await visible('view-dig'));

    // D. Ergonomie
    for (const id of ['btn-account', 'btn-settings']) {
      const b = await page.$eval(`#${id}`, e => { const r = e.getBoundingClientRect(); return [r.width, r.height]; });
      check(tag, `D ${id} ≥ 44 px`, b[0] >= 44 && b[1] >= 44, b.join('×'));
    }
    await tap('#btn-account');
    check(tag, 'D Profil sans débordement horizontal', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    check(tag, 'D aucune erreur console', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  await browser.close();
  console.log(results.join('\n'));
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed}/${results.length} contrôles réussis`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
