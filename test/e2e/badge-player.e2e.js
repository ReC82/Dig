/**
 * Parcours Chromium réels de la recette #38-E (PC 1280×900 et smartphone 390×844), côté joueur :
 *  A. Collection → Badges : un clic sur un badge ouvre la fiche (même fenêtre que les objets de collection #39) —
 *     grande icône (repli emoji), nom et description localisés, catégorie, objectif traduit (#38-C : « Depth ≥ 100 m »
 *     en anglais), progression chiffrée si non acquis, date si obtenu, statut, rappel honorifique ; badge secret sans
 *     objectif révélé ; fermeture bouton / Échap / clic hors fenêtre, focus rendu à la carte.
 *  B. Déblocage : toast « 🏅 Badge unlocked: … » qui n'interrompt pas le jeu, enregistré une seule fois dans
 *     Paramètres → Historique des notifications (#26), confirmé au serveur : rien de renvoyé après F5 ni nouvelle sauvegarde.
 *
 * JAMAIS contre la production : serveur de test seulement, par exemple
 *   DB_FILE=test-38.sqlite PORT=3101 node server/index.js
 * puis
 *   DIG_E2E_BASE=http://127.0.0.1:3101 DIG_E2E_DB=<chemin de test-38.sqlite> \
 *   NODE_PATH=<dossier contenant playwright-core> node test/e2e/badge-player.e2e.js
 * Le parcours crée deux comptes jetables et écrit une ligne player_badges par compte dans la base de TEST (déblocage
 * simulé, le minage de 100 m n'étant pas jouable dans un test) ; la fiche (A) utilise une réponse /api/me/badges simulée.
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const { execFileSync } = require('child_process');
const BASE = process.env.DIG_E2E_BASE || 'http://127.0.0.1:3101';
const DBF = process.env.DIG_E2E_DB;
if (/:3000\b|lodygames|lodylands/.test(BASE) || !DBF || /\/home\/ubuntu\/Dig\//.test(DBF)) throw new Error('Parcours réservé à un serveur et une base de test.');
const exe = fs.readdirSync(process.env.HOME + '/.cache/ms-playwright').filter(d => d.startsWith('chromium-')).sort().pop();
const SHOTS = process.env.DIG_E2E_SHOTS || '/tmp';
const results = [];
const check = (tag, name, cond, extra = '') => { results.push(`${cond ? 'OK  ' : 'FAIL'} [${tag}] ${name}${extra ? ' — ' + extra : ''}`); };
const sql = q => execFileSync('sqlite3', [DBF, q], { encoding: 'utf8' }).trim();
const tx = (fr, en) => ({ fr, en, nl: fr, es: fr });
const VIEW = {
  activatedAt: '2026-10-30T21:00:00Z', earnedCount: 1,
  badges: [
    { id: 'profondeur_100', category: 'profondeur', icon: '⛏️', image: null, hidden: false, names: tx('Cent mètres sous terre', '100 metres deep'),
      descriptions: tx('Atteindre 100 m de profondeur.', 'Reach a depth of 100 m.'), criterion: { condition: 'max_depth', blockId: null, threshold: 100 },
      earned: true, earnedAt: '2026-11-04T09:12:00Z', progress: null, event: null, archived: false },
    { id: 'pierre_100', category: 'minage', icon: '🪨', image: '/assets/introuvable-38.webp', hidden: false, names: tx('Tailleur de pierre', 'Stonecutter'),
      descriptions: tx('Casser 100 blocs de pierre.', 'Break 100 stone blocks.'), criterion: { condition: 'blocks_of_type', blockId: 'pierre', threshold: 100 },
      earned: false, earnedAt: null, progress: { value: 23, target: 100 }, event: null, archived: false },
    { id: 'secret_x', category: 'exploration', icon: '❔', image: null, hidden: true, names: null, descriptions: null, criterion: null,
      earned: false, earnedAt: null, progress: { value: 1, target: 5 }, event: null, archived: false },
  ],
};

async function login(ctx, page, name) {
  const r = await page.request.post(BASE + '/api/register', { data: { username: name, email: `${name}@example.invalid`, password: 'secret123' } });
  if (!r.ok()) throw new Error(`inscription ${r.status()} ${await r.text()}`);
  return (await r.json()).user.id;
}

(async () => {
  const browser = await chromium.launch({ executablePath: `${process.env.HOME}/.cache/ms-playwright/${exe}/chrome-linux64/chrome` });
  for (const [w, h, tag] of [[1280, 900, 'pc'], [390, 844, 'mob']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: tag === 'mob' });
    await ctx.addInitScript(() => localStorage.setItem('dig_lang', 'en'));
    const page = await ctx.newPage();
    const errors = [], natives = [];
    page.on('pageerror', e => errors.push('pageerror ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console ' + m.text()); });
    page.on('dialog', d => { natives.push(`${d.type()}: ${d.message()}`); d.dismiss(); });
    const userId = await login(ctx, page, `b38${tag}${Date.now() % 1e6}`);

    // ── A. Fiche au clic (vue simulée, langue EN) ──
    await page.route('**/api/me/badges', r => r.request().method() === 'GET' ? r.fulfill({ json: VIEW }) : r.continue());
    await page.goto(BASE);
    const pick = page.locator('.lang-pick-btn[data-lang="en"]');
    if (await pick.isVisible().catch(() => false)) await pick.click();
    await page.click('.nav-btn[data-view="collection"]');
    await page.waitForSelector('.badge-card[data-badge="profondeur_100"]', { timeout: 8000 });
    const card = page.locator('.badge-card[data-badge="profondeur_100"]');
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await page.waitForSelector('#find-modal:not([hidden])');
    const read = () => page.evaluate(() => {
      const q = id => document.getElementById(id);
      const r = q('find-modal-inner').getBoundingClientRect();
      return { art: q('find-modal-art').textContent, img: !!q('find-modal-art').querySelector('img'), title: q('find-modal-title').textContent,
        chip: q('find-modal-rarity').textContent, ctx: q('find-modal-series').textContent, found: q('find-modal-found').textContent,
        story: q('find-modal-story').textContent, extra: q('find-modal-extra').innerText, bar: !!q('find-modal-extra').querySelector('[role=progressbar]'),
        focus: document.activeElement.id, fits: r.left >= 0 && r.right <= innerWidth + 0.5 && r.top >= 0 && r.bottom <= innerHeight + 0.5,
        hscroll: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    let s = await read();
    check(tag, 'acquis : titre EN', s.title === '100 metres deep', s.title);
    check(tag, 'acquis : description EN', s.story === 'Reach a depth of 100 m.', s.story);
    check(tag, 'acquis : objectif traduit (#38-C)', /Goal: Depth ≥ 100 m/.test(s.extra) && !/Profondeur/.test(s.extra), s.extra.replace(/\n/g, ' | '));
    check(tag, 'acquis : statut + date', /earned/i.test(s.chip) && /Earned on/.test(s.found) && /2026/.test(s.found), `${s.chip} / ${s.found}`);
    check(tag, 'acquis : catégorie', s.ctx === 'Category: Depth', s.ctx);
    check(tag, 'acquis : rappel honorifique', /no coins, gems, shards or points/.test(s.extra));
    check(tag, 'acquis : grande icône emoji', s.art === '⛏️');
    check(tag, 'acquis : pas de barre de progression', !s.bar);
    check(tag, 'focus sur Fermer', s.focus === 'btn-find-modal-close');
    check(tag, 'fiche entièrement visible', s.fits);
    check(tag, 'pas de défilement horizontal', s.hscroll <= 0, `${s.hscroll}`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/t38e-${tag}-1-acquis.png` });
    await page.keyboard.press('Escape');
    check(tag, 'Échap ferme', await page.locator('#find-modal').isHidden());
    check(tag, 'focus rendu à la carte', await card.evaluate(e => e === document.activeElement));

    const locked = page.locator('.badge-card[data-badge="pierre_100"]');
    await locked.click();
    await page.waitForTimeout(300);   // image absente → repli emoji
    s = await read();
    check(tag, 'à débloquer : statut', /locked/i.test(s.chip), s.chip);
    check(tag, 'à débloquer : objectif par type traduit', /Goal: Stone: blocks broken ≥ 100/.test(s.extra), s.extra.replace(/\n/g, ' | '));
    check(tag, 'à débloquer : progression chiffrée + barre', /Progress: 23 \/ 100/.test(s.extra) && s.bar);
    check(tag, 'à débloquer : pas de date', s.found === '');
    check(tag, 'image introuvable : repli emoji', !s.img && s.art === '🪨', `${s.art}`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/t38e-${tag}-2-a-debloquer.png` });
    await page.mouse.click(5, 5);   // clic hors fenêtre
    check(tag, 'clic hors fenêtre ferme', await page.locator('#find-modal').isHidden());

    await page.click('.badge-card[data-badge="secret_x"]');
    s = await read();
    check(tag, 'secret : aucun objectif révélé', /Secret goal/.test(s.extra) && !/≥/.test(s.extra), s.extra.replace(/\n/g, ' | '));
    check(tag, 'secret : titre générique', s.title === 'Secret badge', s.title);
    await page.click('#btn-find-modal-close');
    check(tag, 'bouton Fermer ferme', await page.locator('#find-modal').isHidden());
    await page.unroute('**/api/me/badges');

    // ── B. Déblocage réel : notification unique, confirmée au serveur ──
    await page.click('.nav-btn[data-view="dig"]');
    sql(`INSERT INTO player_badges (user_id, badge_id, earned_at, value, notified) VALUES (${userId}, 'profondeur_100', '${new Date().toISOString()}', 100, 0)`);
    const toast = page.waitForSelector('.float-text.achievement', { timeout: 6000 }).then(e => e.textContent()).catch(() => '');
    await page.evaluate(() => _syncToCloud());
    const text = await toast;
    const enName = JSON.parse(sql("SELECT names FROM badges WHERE id = 'profondeur_100'")).en;   // nom EN réel de la base de test
    check(tag, 'toast de déblocage', text === `🏅 Badge unlocked: ${enName}!`, text);
    await page.waitForTimeout(800);
    check(tag, 'confirmé au serveur (notified = 1)', sql(`SELECT notified FROM player_badges WHERE user_id = ${userId}`) === '1');
    const logged = () => page.evaluate(() => NotifLog.list().filter(e => /Badge unlocked/.test(e.text)).length);
    check(tag, 'historique #26 : une entrée', await logged() === 1);
    check(tag, 'le jeu reste sur la vue Creuser (toast non bloquant)', await page.isVisible('#view-dig') && await page.locator('#find-modal').isHidden());
    // F5 + nouvelle sauvegarde : rien n'est renvoyé, pas de second toast
    await page.reload();
    await page.waitForTimeout(1500);
    let second = false;
    page.on('response', async r => { if (r.url().endsWith('/api/me/save') && r.request().method() === 'POST') { try { if ((await r.json()).badgesEarned) second = true; } catch (_) {} } });
    await page.evaluate(() => _syncToCloud());
    await page.waitForTimeout(1200);
    check(tag, 'après F5 : aucune notification renvoyée', !second);
    check(tag, 'après F5 : toujours une seule entrée', await logged() === 1);
    await page.evaluate(() => switchView('settings'));
    await page.waitForTimeout(400);
    const hist = await page.evaluate(n => document.body.innerText.includes(`Badge unlocked: ${n}!`), enName);
    check(tag, 'visible dans Paramètres → Historique', hist);
    await page.screenshot({ path: `${SHOTS}/t38e-${tag}-3-historique.png`, fullPage: false });

    check(tag, 'aucune popup native', natives.length === 0, natives.join(' | '));
    check(tag, 'aucune erreur JS', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  await browser.close();
  console.log(results.join('\n'));
  const fails = results.filter(r => r.startsWith('FAIL')).length;
  console.log(`${results.length - fails}/${results.length} OK`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); console.log(results.join('\n')); process.exit(1); });
