/**
 * Parcours Chromium réels du ticket #60 (PC 1280×900 et smartphone 390×844) : chaque bouton « ↻ Rafraîchir » du panel
 * montre « ↻ Actualisation… » (bouton indisponible), puis « ✓ Données à jour à HH:MM:SS » ou une erreur ; seules des
 * lectures GET partent ; Anti-bot relit vraiment la synthèse, les derniers contrôles et le journal (sauvegarde de joueur
 * simulée sur la base de test) sans F5 ni perte du filtre ou du défilement ; échec réseau simulé visible ; saisies
 * conservées (consigne de l'atelier d'icônes, barème Points, filtres) ; focus clavier conservé ; aucune fenêtre native.
 *
 * JAMAIS contre la production : serveur de test seulement, par exemple
 *   ADMIN_SECRET=$(openssl rand -hex 24) DB_FILE=test-60.sqlite PORT=3101 node server/index.js
 * puis
 *   DIG_E2E_BASE=http://127.0.0.1:3101 DIG_E2E_SECRET_FILE=<fichier contenant ADMIN_SECRET> \
 *   DIG_E2E_DB=<chemin de la base de test> NODE_PATH=<dossier contenant playwright-core> node test/e2e/admin-refresh.e2e.js
 * Seule la base de test change (contrôles anti-bot de joueurs synthétiques « e2e60_… »).
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const BASE = process.env.DIG_E2E_BASE || 'http://127.0.0.1:3101';
if (/:3000\b|lodygames|lodylands/.test(BASE)) throw new Error('Parcours réservé à un serveur de test.');
const DB = process.env.DIG_E2E_DB;
if (!DB || /\/home\/ubuntu\/Dig\//.test(path.resolve(DB))) throw new Error('DIG_E2E_DB : base de test obligatoire (jamais la production).');
const exe = fs.readdirSync(process.env.HOME + '/.cache/ms-playwright').filter(d => d.startsWith('chromium-')).sort().pop();
const SHOTS = process.env.DIG_E2E_SHOTS || '/tmp';
const results = [];
const check = (tag, name, cond, extra = '') => { results.push(`${cond ? 'OK  ' : 'FAIL'} [${tag}] ${name}${extra ? ' — ' + extra : ''}`); };

// Sauvegarde de joueur simulée : contrôle anti-bot écrit dans la base de test, comme le ferait une sauvegarde cloud
function simulatePlayerSave(name, depth) {
  const root = path.join(__dirname, '..', '..');
  execFileSync(process.execPath, ['-e', `
    const db = require(${JSON.stringify(root + '/server/db')}); const seasons = require(${JSON.stringify(root + '/server/seasons')});
    db.initDb(); const season = db.getActiveSeason(); const d = db.getDb();
    let u = d.prepare('SELECT id FROM users WHERE username = ?').get(${JSON.stringify(name)});
    const id = u ? u.id : d.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(${JSON.stringify(name)}, 'x').lastInsertRowid;
    seasons.syncPlayerRanking(id, { seasonId: season.id, maxDepth: ${depth}, manualBlocks: 0, manualClicks: 0, autoBlocks: 0 });
    d.close();`], { env: { ...process.env, DB_FILE: path.resolve(DB) }, stdio: 'pipe' });
}

(async () => {
  const browser = await chromium.launch({ executablePath: `${process.env.HOME}/.cache/ms-playwright/${exe}/chrome-linux64/chrome` });
  const secret = fs.readFileSync(process.env.DIG_E2E_SECRET_FILE || '/tmp/t60-secret', 'utf8').trim();
  for (const [w, h, tag] of [[1280, 900, 'pc'], [390, 844, 'mob']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: tag === 'mob' });
    const page = await ctx.newPage();
    const errors = [], natives = [], requests = [];
    page.on('pageerror', e => errors.push('pageerror ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console ' + m.text()); });
    page.on('dialog', d => { natives.push(`${d.type()}: ${d.message()}`); d.dismiss(); });
    page.on('request', r => { if (r.url().includes('/api/')) requests.push(`${r.method()} ${new URL(r.url()).pathname}`); });
    await page.goto(BASE + '/admin/#security');
    await page.fill('#secret-input', secret);
    await page.click('#secret-btn');
    await page.waitForSelector('#admin-app:not(.hidden)', { timeout: 8000 });

    const status = id => page.evaluate(i => document.getElementById(i).nextElementSibling?.textContent ?? '', id);
    const openTab = async tab => { await page.click(`.tab-btn[data-tab="${tab}"]`); await page.waitForTimeout(700); };
    /** Clique « Rafraîchir » ; rend l'état pendant l'attente, l'état final et les requêtes émises. */
    const refresh = async (id, how = 'click') => {
      await page.evaluate(i => document.getElementById(i).scrollIntoView({ block: 'center' }), id);
      requests.length = 0;
      if (how === 'enter') { await page.focus(`#${id}`); await page.keyboard.press('Enter'); } else await page.click(`#${id}`);
      const during = await page.evaluate(i => { const b = document.getElementById(i); return { text: b.textContent, busy: b.getAttribute('aria-disabled'), st: b.nextElementSibling?.textContent }; }, id);
      await page.waitForFunction(i => /^(✓|⚠️)/.test(document.getElementById(i).nextElementSibling?.textContent ?? '')
        && document.getElementById(i).getAttribute('aria-disabled') !== 'true', id, { timeout: 15000 });
      return { during, final: await status(id), reqs: [...requests] };
    };
    const tabOf = id => page.evaluate(i => document.getElementById(i).closest('.tab-content')?.id.replace(/^tab-/, ''), id);

    // ── 1. Inventaire : chaque bouton Rafraîchir de chaque onglet ──
    const ids = await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '↻ Rafraîchir').map(b => b.id));
    check(tag, `inventaire : ${ids.length} boutons Rafraîchir`, ids.length >= 16, ids.join(', '));
    for (const id of ids) {
      const t = await tabOf(id);
      await openTab(t);
      if (!(await page.locator(`#${id}`).isVisible())) { check(tag, `${t} / ${id} visible`, false); continue; }
      const r = await refresh(id);
      const writes = r.reqs.filter(q => !q.startsWith('GET '));
      check(tag, `${t} / ${id} : « Actualisation… » pendant l'attente`, r.during.text === '↻ Actualisation…' && r.during.busy === 'true' && r.during.st === 'Chargement…', JSON.stringify(r.during));
      check(tag, `${t} / ${id} : succès daté`, /^✓ Données à jour à \d\d:\d\d:\d\d/.test(r.final), r.final);
      check(tag, `${t} / ${id} : requête réelle, lectures seules`, r.reqs.length > 0 && !writes.length, r.reqs.join(' | '));
    }

    // ── 2. Anti-bot : données relues sans F5, filtre et défilement conservés ──
    await openTab('security');
    await page.selectOption('#sec-filter-type', 'group:player');
    await page.waitForTimeout(600);
    const player = `e2e60_${tag}_${Date.now().toString(36)}`;
    const rowsBefore = await page.locator('#sec-checks-body tr').allTextContents();
    await page.evaluate(() => document.getElementById('sec-checks-body').scrollIntoView({ block: 'start' }));
    const scrollBefore = await page.evaluate(() => window.scrollY);
    simulatePlayerSave(player, 4);
    await page.evaluate(() => window.scrollTo(0, 0));
    let r = await refresh('btn-refresh-sec');
    const rowsAfter = await page.locator('#sec-checks-body tr').allTextContents();
    check(tag, 'Anti-bot : nouveau contrôle de joueur affiché sans F5', rowsAfter.some(x => x.includes(player)) && !rowsBefore.some(x => x.includes(player)), rowsAfter[0]);
    check(tag, 'Anti-bot : « nouvelles données affichées »', /nouvelles données affichées$/.test(r.final), r.final);
    check(tag, 'Anti-bot : synthèse et journal relus', r.reqs.includes('GET /api/admin/security/summary') && r.reqs.includes('GET /api/admin/security/events'), r.reqs.join(' | '));
    check(tag, 'Anti-bot : filtre conservé', await page.inputValue('#sec-filter-type') === 'group:player');
    await page.screenshot({ path: `${SHOTS}/t60-${tag}-antibot.png` });
    // Défilement : rafraîchir depuis le bas de l'onglet ne remonte pas la page
    await page.evaluate(y => window.scrollTo(0, y), scrollBefore);
    await page.evaluate(() => document.getElementById('btn-refresh-sec').click());
    await page.waitForFunction(() => document.getElementById('btn-refresh-sec').getAttribute('aria-disabled') !== 'true', null, { timeout: 15000 });
    check(tag, 'Anti-bot : défilement conservé', Math.abs(await page.evaluate(() => window.scrollY) - scrollBefore) < 40);
    // Profondeur mise à jour (même joueur, nouvelle sauvegarde)
    const rowOf = async () => (await page.locator('#sec-checks-body tr').allTextContents()).find(x => x.includes(player));
    const row1 = await rowOf();
    await page.waitForTimeout(1100);   // heure du contrôle à la seconde
    simulatePlayerSave(player, 9);
    r = await refresh('btn-refresh-sec', 'enter');
    const row2 = await rowOf();
    check(tag, 'Anti-bot : heure et profondeur déclarée du contrôle mises à jour', row2 !== row1 && /nouvelles données/.test(r.final), `${row1} → ${row2}`);
    check(tag, 'clavier : Entrée déclenche, focus conservé sur le bouton', await page.evaluate(() => document.activeElement?.id) === 'btn-refresh-sec' && /^✓/.test(r.final));
    r = await refresh('btn-refresh-sec');
    check(tag, 'Anti-bot : clic sans nouveauté → « aucun changement »', /aucun changement$/.test(r.final), r.final);
    // Échec réseau simulé
    await page.route('**/api/admin/security/**', route => route.abort());
    r = await refresh('btn-refresh-sec');
    await page.unroute('**/api/admin/security/**');
    check(tag, 'échec réseau : erreur visible, jamais « à jour »', /^⚠️ Échec de l’actualisation/.test(r.final) && !/à jour/.test(r.final)
      && await page.evaluate(() => document.getElementById('btn-refresh-sec').nextElementSibling.className.includes('is-err')), r.final);
    check(tag, 'échec réseau : bouton de nouveau disponible', await page.evaluate(() => document.getElementById('btn-refresh-sec').getAttribute('aria-disabled')) === null);
    await page.screenshot({ path: `${SHOTS}/t60-${tag}-antibot-error.png` });
    r = await refresh('btn-refresh-sec');
    check(tag, 'après l\'échec : nouveau clic → données à jour', /^✓ Données à jour/.test(r.final), r.final);

    // ── 3. Saisies conservées ──
    await openTab('points');
    const scale = await page.inputValue('#pt-scale');
    await page.fill('#pt-scale', scale.replace('{', '{ "e2e60": 1,'));
    await page.dispatchEvent('#pt-scale', 'input');
    r = await refresh('btn-refresh-points');
    check(tag, 'Points : barème en cours de saisie conservé', (await page.inputValue('#pt-scale')).includes('"e2e60": 1') && /^✓/.test(r.final));
    await page.fill('#pt-scale', scale);

    await openTab('icons');
    const card = page.locator('#ic-grid .ic-card').first();
    if (await card.count()) {
      await card.click();
      await page.waitForSelector('#ic-instruction', { timeout: 8000 });
      await page.fill('#ic-instruction', 'consigne e2e60 non enregistrée');
      r = await refresh('btn-refresh-icons');
      await page.waitForTimeout(500);
      check(tag, 'Icônes : fiche ouverte et consigne conservées', await page.locator('#ic-sheet').isVisible() && await page.inputValue('#ic-instruction') === 'consigne e2e60 non enregistrée' && /^✓/.test(r.final), r.final);
      await page.screenshot({ path: `${SHOTS}/t60-${tag}-icons.png` });
    } else check(tag, 'Icônes : au moins une fiche', false);

    await openTab('shop');
    const filt = await page.locator('#sh-order-filter option').nth(1).getAttribute('value');
    await page.selectOption('#sh-order-filter', filt);
    await page.waitForTimeout(400);
    r = await refresh('btn-refresh-shop');
    check(tag, 'Boutique : filtre des commandes conservé', await page.inputValue('#sh-order-filter') === filt && /^✓/.test(r.final));

    // Clics rapides : un seul chargement à la fois, pas de pile de toasts
    await openTab('events');
    requests.length = 0;
    await page.evaluate(() => { const b = document.getElementById('btn-ev-refresh'); b.click(); b.click(); b.click(); });
    await page.waitForFunction(() => document.getElementById('btn-ev-refresh').getAttribute('aria-disabled') !== 'true', null, { timeout: 15000 });
    check(tag, 'clics rapides : une seule relecture', requests.filter(q => q === 'GET /api/admin/events').length === 1, requests.join(' | '));
    await page.screenshot({ path: `${SHOTS}/t60-${tag}-events.png` });

    check(tag, 'aucune fenêtre native', natives.length === 0, natives.join(' | '));
    check(tag, 'aucune erreur JS', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  await browser.close();
  console.log(results.join('\n'));
  const fails = results.filter(x => x.startsWith('FAIL')).length;
  console.log(fails ? `${fails} ÉCHEC(S)` : `TOUT OK (${results.length} contrôles)`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
