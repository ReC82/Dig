/**
 * Parcours Chromium du ticket #72 (PC 1280×900 et smartphone 390×844) : fiche « Inviter un testeur » après création.
 * Résultat déjà enregistré → « Terminé », ✕ et Échap ferment sans avertissement ; message retouché → confirmation
 * propre au texte (l'invitation reste valide), « Revenir au message » garde le texte ; message copié → plus rien à
 * perdre ; « Inviter quelqu'un d'autre » donne un nouveau lien sans toucher au précédent ; formulaire (étape 1) avec
 * un prénom saisi → protection #61 inchangée. Une invitation en base par création, aucune utilisée ni révoquée.
 * Aucun code d'invitation n'est écrit dans la sortie.
 *
 * JAMAIS contre la production : serveur de test sur une base neuve, par exemple
 *   ADMIN_SECRET=$(openssl rand -hex 24) DB_FILE=test-72.sqlite PORT=3101 node server/index.js
 * puis
 *   DIG_E2E_BASE=http://127.0.0.1:3101 DIG_E2E_SECRET_FILE=<fichier contenant ADMIN_SECRET> \
 *   NODE_PATH=<dossier contenant playwright-core> node test/e2e/beta-invite-close.e2e.js
 */
const { chromium } = require('playwright-core');
const { admOpenTab } = require('./_admin-nav');
const fs = require('fs');
const BASE = process.env.DIG_E2E_BASE || 'http://127.0.0.1:3101';
if (/:3000\b|lodygames|lodylands/.test(BASE)) throw new Error('Parcours réservé à un serveur de test.');
const exe = fs.readdirSync(process.env.HOME + '/.cache/ms-playwright').filter(d => d.startsWith('chromium-')).sort().pop();
const SHOTS = process.env.DIG_E2E_SHOTS || '/tmp';
const results = [];
const check = (tag, name, cond, extra = '') => { results.push(`${cond ? 'OK  ' : 'FAIL'} [${tag}] ${name}${extra ? ' — ' + extra : ''}`); };

(async () => {
  const browser = await chromium.launch({ executablePath: `${process.env.HOME}/.cache/ms-playwright/${exe}/chrome-linux64/chrome` });
  const secret = fs.readFileSync(process.env.DIG_E2E_SECRET_FILE || '/tmp/t72-secret', 'utf8').trim();
  const invites = async () => (await (await fetch(BASE + '/api/admin/beta', { headers: { Authorization: `Bearer ${secret}` } })).json()).invites;
  for (const [w, h, tag] of [[1280, 900, 'pc'], [390, 844, 'mob']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: tag === 'mob', permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await ctx.newPage();
    const errors = [], natives = [];
    page.on('pageerror', e => errors.push('pageerror ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console ' + m.text()); });
    page.on('dialog', d => { natives.push(d.type()); d.dismiss(); });
    await page.goto(BASE + '/admin/');
    await page.fill('#secret-input', secret);
    await page.click('#secret-btn');
    await admOpenTab(page, 'beta');
    await page.waitForSelector('#beta-stats li');
    const isOpen = id => page.evaluate(i => !!document.getElementById(i)?.open, id);
    const confirmTitle = () => page.evaluate(() => document.getElementById('adm-confirm')?.open ? document.getElementById('adm-confirm').textContent : '');
    const known = new Set((await invites()).map(i => i.code));
    const fresh = async () => (await invites()).filter(i => !known.has(i.code));
    const create = async name => {
      await page.click('#btn-beta-invite-open');
      await page.waitForSelector('#beta-invite-dialog[open]');
      await page.fill('#beta-invite-name', name);
      await page.click('#btn-beta-invite-create');
      await page.waitForSelector('#beta-invite-step2:not(.hidden)');
      return page.inputValue('#beta-invite-link');
    };
    const finish = () => page.click('#beta-invite-step2 [data-close]');
    const cross = () => page.click('#beta-invite-dialog .bk-dialog-head [data-close]');

    // 1. Création puis « Terminé » : fermeture directe (cas du propriétaire : prénom saisi)
    const l1 = await create('Sophie');
    await page.screenshot({ path: `${SHOTS}/t72-${tag}-1-resultat.png` });
    await finish();
    await page.waitForTimeout(250);
    check(tag, '« Terminé » ferme sans avertissement', !(await isOpen('beta-invite-dialog')) && !(await isOpen('adm-confirm')));
    // 2. ✕ Fermer et Échap
    await create('Marc');
    await cross();
    await page.waitForTimeout(250);
    check(tag, '✕ ferme sans avertissement', !(await isOpen('beta-invite-dialog')) && !(await isOpen('adm-confirm')));
    await create('');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    check(tag, 'Échap ferme sans avertissement', !(await isOpen('beta-invite-dialog')) && !(await isOpen('adm-confirm')));
    // 3. Message retouché : confirmation propre au texte, « Revenir au message » garde le texte
    await create('Léa');
    await page.fill('#beta-invite-message', (await page.inputValue('#beta-invite-message')) + '\nÀ bientôt !');
    await finish();
    await page.waitForSelector('#adm-confirm[open]');
    const t = await confirmTitle();
    check(tag, 'retouche : confirmation spécifique', /Message personnalisé non copié/.test(t) && /reste valide/.test(t) && !/rien n.est enregistré/.test(t));
    await page.screenshot({ path: `${SHOTS}/t72-${tag}-2-texte.png` });
    await page.click('#adm-confirm-no');
    await page.waitForTimeout(200);
    check(tag, '« Revenir au message » garde la fiche et le texte',
      await isOpen('beta-invite-dialog') && (await page.inputValue('#beta-invite-message')).endsWith('À bientôt !'));
    // 4. Copier le message retouché : plus rien à perdre
    await page.click('#btn-beta-copy-msg');
    await page.waitForTimeout(200);
    check(tag, 'copie du message retouché', (await page.evaluate(() => navigator.clipboard.readText())).endsWith('À bientôt !'));
    await finish();
    await page.waitForTimeout(250);
    check(tag, 'message copié : fermeture directe', !(await isOpen('beta-invite-dialog')) && !(await isOpen('adm-confirm')));
    // 5. Retouche puis « Abandonner le texte »
    await create('Nina');
    await page.fill('#beta-invite-message', 'texte perso');
    await cross();
    await page.waitForSelector('#adm-confirm[open]');
    await page.click('#adm-confirm-yes');
    await page.waitForTimeout(250);
    check(tag, '« Abandonner le texte » ferme la fiche', !(await isOpen('beta-invite-dialog')));
    // 6. « Inviter quelqu'un d'autre » : nouveau lien, le précédent intact
    const l6 = await create('Paul');
    await page.fill('#beta-invite-message', 'texte perso');
    await page.click('#btn-beta-invite-again');
    await page.waitForSelector('#adm-confirm[open]');
    check(tag, 'autre invitation après retouche : confirmation spécifique', /reste valide/.test(await confirmTitle()));
    await page.click('#adm-confirm-yes');
    await page.waitForSelector('#beta-invite-step1:not(.hidden)');
    check(tag, 'étape 1 vide', (await page.inputValue('#beta-invite-name')) === '');
    await page.fill('#beta-invite-name', 'Zoé');
    await page.click('#btn-beta-invite-create');
    await page.waitForFunction(prev => !document.getElementById('beta-invite-step2').classList.contains('hidden')
      && document.getElementById('beta-invite-link').value !== prev, l6);
    const l7 = await page.inputValue('#beta-invite-link');
    check(tag, 'nouveau lien distinct', l7 !== l6 && l7 !== l1);
    await page.click('#btn-beta-copy-link');
    check(tag, 'copie du lien = nouveau lien', (await page.evaluate(() => navigator.clipboard.readText())) === l7);
    await finish();
    await page.waitForTimeout(250);
    check(tag, 'fermeture directe après la 2e invitation', !(await isOpen('beta-invite-dialog')) && !(await isOpen('adm-confirm')));
    // 7. Étape 1 avec un prénom saisi : protection #61 inchangée, rien créé
    await page.click('#btn-beta-invite-open');
    await page.fill('#beta-invite-name', 'Jamais');
    await cross();
    await page.waitForSelector('#adm-confirm[open]');
    check(tag, 'formulaire modifié : protection #61', /Modifications non enregistrées/.test(await confirmTitle()));
    await page.click('#adm-confirm-yes');
    await page.waitForTimeout(250);
    // 8. Base : une invitation par création, aucune utilisée ni révoquée
    const got = await fresh();
    const labels = got.map(i => i.label).sort().join(',');
    check(tag, '7 invitations, une par création', got.length === 7 && labels === ',Léa,Marc,Nina,Paul,Sophie,Zoé'.split(',').sort().join(','), labels);
    check(tag, 'aucune invitation utilisée ni révoquée', got.every(i => !i.uses && !i.revokedAt && !i.revoked));
    check(tag, 'liens affichés = invitations en base', [l1, l6, l7].every(l => got.some(i => l.endsWith(encodeURIComponent(i.code)))));
    for (const c of got) known.add(c.code);
    check(tag, 'aucune boîte native', natives.length === 0, natives.join(','));
    check(tag, 'aucune erreur JS', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  await browser.close();
  console.log(results.join('\n'));
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
