/**
 * Parcours Chromium réels du ticket #81 (PC 1280×900 et smartphone 390×844), serveur de TEST seulement :
 *  A. Défaut : dégâts et PV affichés entiers ; des dégâts de 1,25 (injectés dans la page de test, comme le ferait
 *     un futur bonus) s'affichent « 1 » mais détruisent un bloc de 5 PV en 4 coups exactement.
 *  B. Paramètres → « Afficher les valeurs précises » : 1,25 et « 3,75 / 5 PV » ; option conservée après F5,
 *     PV restants fractionnaires repris à l'identique.
 *  C. Exemple de micro-bonus +0,25 ACTIF dans cette page de test uniquement : 4 coups sur 5 PV avec 1 dégât de base.
 *  D. Admin (PC) : rubrique « Micro-bonus (brouillons) », exemple +0,25 sur la pierre, aperçu (texte, états,
 *     simulation), brouillon enregistré ; aucun bonus transmis au jeu (GameState.eventBonuses vide).
 *
 *   DB_FILE=test-81.sqlite PORT=3101 ADMIN_SECRET=… node server/index.js
 *   DIG_E2E_BASE=http://127.0.0.1:3101 ADMIN_SECRET=… NODE_PATH=<playwright-core> node test/e2e/decimal-damage.e2e.js
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const BASE = process.env.DIG_E2E_BASE || 'http://127.0.0.1:3101';
if (/:3000\b|lodygames|lodylands/.test(BASE)) throw new Error('Parcours réservé à un serveur de test.');
const SECRET = process.env.ADMIN_SECRET;
const exe = fs.readdirSync(process.env.HOME + '/.cache/ms-playwright').filter(d => d.startsWith('chromium-')).sort().pop();
const SHOTS = process.env.DIG_E2E_SHOTS || '/tmp';
const results = [];
const check = (tag, name, cond, extra = '') => { results.push(`${cond ? 'OK  ' : 'FAIL'} [${tag}] ${name}${extra ? ' — ' + extra : ''}`); };
const pause = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: `${process.env.HOME}/.cache/ms-playwright/${exe}/chrome-linux64/chrome` });
  // DIG_E2E_ONLY=admin : parcours de la fiche Micro-bonus seul (recette #81-B bis)
  for (const [w, h, tag] of process.env.DIG_E2E_ONLY === 'admin' ? [] : [[1280, 900, 'pc'], [390, 844, 'mob']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: tag === 'mob', isMobile: tag === 'mob' });
    // Tutoriel #79 déjà passé (sinon sa carte couvre le bas de l'écran)
    await ctx.addInitScript(() => { localStorage.setItem('dig_lang', 'fr'); localStorage.setItem('dig_tutorial', JSON.stringify({ v: 1, state: 'skipped', step: 0, at: new Date().toISOString() })); });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console ' + m.text()); });
    const tap = sel => (tag === 'mob' ? page.tap(sel) : page.click(sel));
    await page.goto(BASE + '/');
    await page.waitForSelector('#block-name:not(:empty)');
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    const setBlock = hp => page.evaluate(v => { Blocks.current.hp = v; Blocks.current.maxHp = v; renderBlock(); renderStats(); }, hp);
    const strikes = async () => {
      const seq0 = await page.evaluate(() => Blocks.current.seq);
      let n = 0;
      while (n < 20) {
        await page.evaluate(() => { const r = document.getElementById('block').getBoundingClientRect(); onBlockHit(r.left + r.width / 2, r.top + r.height / 2, null); });
        n++;
        await pause(150);
        if (await page.evaluate(s => Blocks.current.seq !== s || blockAnimating, seq0)) break;
      }
      await page.waitForFunction(s => Blocks.current.seq !== s && !blockAnimating, seq0, { timeout: 5000 });
      return n;
    };

    // A. Défaut
    check(tag, 'A option OFF par défaut', !(await page.evaluate(() => NumFmt.isPrecise())));
    check(tag, 'A dégâts entiers inchangés', (await page.textContent('#stat-damage')).trim() === '1');
    await page.evaluate(() => { GameState.damage = 1.25; renderStats(); });
    check(tag, 'A 1,25 affiché « 1 »', (await page.textContent('#stat-damage')).trim() === '1');
    await setBlock(5);
    await page.evaluate(() => { const r = document.getElementById('block').getBoundingClientRect(); onBlockHit(r.left + r.width / 2, r.top + r.height / 2, null); });
    const afterOne = await page.evaluate(() => ({ hp: Blocks.current.hp, txt: document.getElementById('hp-text')?.textContent ?? '' }));
    check(tag, 'A PV réels 3,75, affichés arrondis à l\'entier supérieur', afterOne.hp === 3.75 && /^4 \/ 5 PV$/.test(afterOne.txt.trim()), afterOne.txt);
    await page.evaluate(() => { Blocks.current.hp = 5; renderBlock(); });
    const hits = await strikes();
    check(tag, 'A bloc de 5 PV détruit en 4 coups de 1,25', hits === 4, `${hits} coups`);

    // B. Option précise
    await tap('#btn-settings');
    await page.waitForSelector('#opt-precise');
    await page.screenshot({ path: `${SHOTS}/81-${tag}-parametres.png` });
    await tap('#opt-precise');
    check(tag, 'B option mémorisée', await page.evaluate(() => localStorage.getItem('dig.precise') === '1'));
    await tap('#btn-settings-back');
    await page.evaluate(() => { GameState.damage = 1.25; renderStats(); Blocks.current.hp = 5; Blocks.current.maxHp = 5; renderBlock(); });
    await page.evaluate(() => { const r = document.getElementById('block').getBoundingClientRect(); onBlockHit(r.left + r.width / 2, r.top + r.height / 2, null); });
    const precise = await page.evaluate(() => ({ dmg: document.getElementById('stat-damage').textContent.trim(), hp: document.getElementById('hp-text')?.textContent.trim() }));
    check(tag, 'B 1,25 et 3,75 / 5 PV', precise.dmg === '1,25' && precise.hp === '3,75 / 5 PV', JSON.stringify(precise));
    await page.screenshot({ path: `${SHOTS}/81-${tag}-precis.png` });
    await page.evaluate(() => Save.save());
    await page.reload();
    await page.waitForSelector('#block-name:not(:empty)');
    const reloaded = await page.evaluate(() => ({ pref: NumFmt.isPrecise(), hp: Blocks.current.hp, txt: document.getElementById('hp-text')?.textContent.trim(), dmg: GameState.damage }));
    check(tag, 'B F5 : option conservée, PV 3,75 repris, dégâts recalculés (1)', reloaded.pref && reloaded.hp === 3.75 && reloaded.txt === '3,75 / 5 PV' && reloaded.dmg === 1, JSON.stringify(reloaded));

    // C. Exemple de micro-bonus actif dans cette page de test
    await page.evaluate(() => GameState.eventBonuses.push(MicroBonus.normalize({ value: 0.25 })));
    await page.evaluate(() => { Blocks.current.hp = 5; Blocks.current.maxHp = 5; renderBlock(); });
    const hitsBonus = await strikes();
    check(tag, 'C +0,25 actif (test) : 5 PV en 4 coups avec 1 dégât de base', hitsBonus === 4, `${hitsBonus} coups`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check(tag, 'pas de débordement horizontal', !overflow);
    check(tag, 'aucune erreur console', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // D. Admin
  if (SECRET) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror ' + e.message));
    await page.goto(BASE + '/admin#microbonus');
    await page.fill('#secret-input', SECRET);
    await page.click('#secret-btn');
    await page.waitForSelector('#btn-mb-add', { state: 'visible' });
    await page.click('#btn-mb-add');
    await page.waitForSelector('#mb-dialog[open]');
    // Recette #81-B bis : brouillon affiché d'abord, calendrier et détails repliés, résultat en bref calculé d'office
    await page.waitForSelector('#mb-preview:not(.hidden)');
    const first = await page.evaluate(() => {
      const d = document.getElementById('mb-dialog');
      const lock = document.getElementById('mb-lock');
      return { lock: lock.textContent, lockTop: lock.getBoundingClientRect().top < document.getElementById('mb-label').getBoundingClientRect().top,
        when: document.getElementById('mb-when').open, details: document.getElementById('mb-details').open,
        simVisible: document.getElementById('mb-prev-sim').checkVisibility(), poolVisible: document.getElementById('mb-prev-pool').checkVisibility(),
        sum: document.getElementById('mb-when-sum').textContent, active: /actif en jeu|est actif/i.test(d.textContent.replace(/aucun effet en jeu|serait actif/gi, '')) };
    });
    check('admin', '81-B bis « 🔒 Brouillon — aucun effet en jeu » en tête, calendrier et détails repliés', first.lock === '🔒 Brouillon — aucun effet en jeu' && first.lockTop
      && !first.when && !first.details && !first.simVisible && !first.poolVisible && first.sum === 'Toujours (aucune condition)' && !first.active, JSON.stringify(first));
    await page.click('#mb-examples button:first-child');
    await page.waitForFunction(() => /pierre/i.test(document.getElementById('mb-prev-fr').textContent) && /193,92/.test(document.getElementById('mb-brief-sentence').textContent));
    const brief = await page.evaluate(() => Object.fromEntries(Object.entries({ v: document.getElementById('mb-brief-value').textContent, g: document.getElementById('mb-brief-gain').textContent,
      saved: document.getElementById('mb-brief-saved').textContent, share: document.getElementById('mb-brief-share').textContent,
      s: document.getElementById('mb-brief-sentence').textContent, note: document.getElementById('mb-brief-note').textContent }).map(([k, t]) => [k, t.replace(/\s/g, ' ')])));
    check('admin', '81-B bis résultat en bref : 3 valeurs et phrase reliant coups économisés et %', brief.v === '+0,25' && brief.g === '−6,09 %' && brief.share === '30,9 %'
      && brief.saved === '≈ 1 180 coups sur 100 blocs'
      && brief.s === 'À 50 m, avec 1 dégât par coup, vous économiseriez environ 1 180 coups sur 100 blocs (−6,09 % de coups) : 182,12 coups par bloc en moyenne au lieu de 193,92.'
      && /Estimation moyenne selon les blocs tirés/.test(brief.note) && /pas du temps/.test(brief.note), JSON.stringify(brief));
    await page.selectOption('#mb-base', { label: '2' });
    const b2 = await page.evaluate(() => ({ g: document.getElementById('mb-brief-gain').textContent, s: document.getElementById('mb-brief-sentence').textContent }));
    check('admin', '81-B bis valeur différente selon les dégâts du joueur', b2.g !== brief.g && /avec 2 dégâts par coup/.test(b2.s), JSON.stringify(b2));
    await page.fill('#mb-depth', '120');
    await page.waitForFunction(() => /^À 120 m, avec 2 dégâts/.test(document.getElementById('mb-brief-sentence').textContent));
    await page.fill('#mb-depth', '50');
    await page.waitForFunction(() => /^À 50 m, avec 2 dégâts/.test(document.getElementById('mb-brief-sentence').textContent));
    check('admin', '81-B bis profondeur recalculée seule, choix des dégâts conservé', true);
    await page.selectOption('#mb-base', { label: '1' });
    const prev = await page.evaluate(() => ({ fr: document.getElementById('mb-prev-fr').textContent, state: document.getElementById('mb-prev-state').textContent,
      sims: document.querySelectorAll('#mb-prev-sim tr').length, samples: document.querySelectorAll('#mb-prev-samples tr').length }));
    check('admin', 'D aperçu : texte, état, dates repères, simulation', /^\+0,25 dégât par coup sur le bloc/.test(prev.fr) && /s'il était publié/.test(prev.state) && prev.sims >= 5 && prev.samples === 5, JSON.stringify(prev));
    // Recette #81-B : statut réel séparé, explications chiffrées, tableau des blocs, aides ⓘ
    const help = await page.evaluate(() => ({
      real: document.querySelector('#mb-preview .mb-real').textContent,
      samples: [...document.querySelectorAll('#mb-prev-samples tr td:last-child')].map(td => td.textContent),
      row1: [...document.querySelectorAll('#mb-prev-sim tr:first-child td')].map(td => td.textContent),
      explain: [...document.querySelectorAll('#mb-prev-explain li')].map(li => li.textContent),
      pool: document.querySelectorAll('#mb-prev-pool tr').length,
      source: [...document.querySelectorAll('#mb-source option')].map(o => o.textContent)[0],
    }));
    check('admin', '81-B statut réel « brouillon » séparé, dates repères au conditionnel', /Statut réel : brouillon/.test(help.real) && help.samples.every(t => /^(Serait|Pas encore)/.test(t)), JSON.stringify(help.samples));
    check('admin', '81-B tableau : 193,92 → 182,12, −6,09 %, 30,9 % visés', help.row1[1] === '193,92' && help.row1[2] === '182,12' && help.row1[3] === '−6,09 %' && help.row1[5] === '30,9 %', JSON.stringify(help.row1));
    check('admin', '81-B explications chiffrées et blocs possibles', help.explain.length >= 3 && /5 ÷ 1,25 = 4/.test(help.explain[0]) && help.pool >= 10 && help.source === 'Aucun', JSON.stringify(help.explain));
    await page.click('#mb-when summary');
    await page.check('#mb-weekdays input[value="1"]');
    await page.waitForFunction(() => document.getElementById('mb-when-sum').textContent === 'lun.' && /lundis/.test(document.getElementById('mb-prev-fr').textContent));
    check('admin', '81-B bis calendrier : résumé « lun. » et aperçu recalculé', true);
    await page.uncheck('#mb-weekdays input[value="1"]');
    await page.waitForFunction(() => !/lundis/.test(document.getElementById('mb-prev-fr').textContent));
    await page.click('#mb-dialog .bk-info[aria-controls="mb-h-dates"]');
    check('admin', '81-B aide ⓘ des dates', await page.isVisible('#mb-h-dates') && /incluses/.test(await page.textContent('#mb-h-dates')));
    await page.screenshot({ path: `${SHOTS}/81bbis-admin-bref.png`, fullPage: true });
    await page.click('#mb-details summary');
    await page.click('#mb-sim-help summary');
    await page.screenshot({ path: `${SHOTS}/81b-admin-explications.png`, fullPage: true });
    await page.screenshot({ path: `${SHOTS}/81-admin-apercu.png`, fullPage: true });
    await page.click('#btn-mb-save');
    await page.waitForFunction(() => !document.getElementById('mb-dialog').open);
    const row = await page.textContent('#mb-list');
    check('admin', 'D brouillon listé, jamais appliqué', /pierre/i.test(row) && /jamais appliqué/.test(row));
    // Recette #81-B : fiche et simulation lisibles sur smartphone (390 px), sans débordement de la page
    const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState() });
    const mp = await mob.newPage();
    mp.on('pageerror', e => errors.push('pageerror mobile ' + e.message));
    await mp.goto(BASE + '/admin#microbonus');
    if (await mp.isVisible('#secret-input')) { await mp.fill('#secret-input', SECRET); await mp.click('#secret-btn'); }
    await mp.waitForSelector('#btn-mb-add', { state: 'visible' });
    await mp.click('#btn-mb-add');
    await mp.click('#mb-examples button:first-child');
    await mp.waitForFunction(() => /193,92/.test(document.getElementById('mb-brief-sentence').textContent));
    for (const w of [390, 320]) {
      await mp.setViewportSize({ width: w, height: 844 });
      const over = await mp.evaluate(() => ({ page: document.documentElement.scrollWidth, dlg: document.getElementById('mb-dialog').scrollWidth, w: innerWidth,
        save: (() => { const r = document.getElementById('btn-mb-save').getBoundingClientRect(); return r.right <= innerWidth && r.width > 0; })() }));
      check('admin', `81-B bis mobile ${w} : fiche sans débordement, Enregistrer visible`, over.page <= over.w && over.dlg <= over.w && over.save, JSON.stringify(over));
      await mp.screenshot({ path: `${SHOTS}/81bbis-admin-mobile-${w}.png` });
    }
    await mp.click('#mb-details summary');
    const over = await mp.evaluate(() => ({ page: document.documentElement.scrollWidth, dlg: document.getElementById('mb-dialog').scrollWidth, w: innerWidth }));
    check('admin', '81-B mobile 320 : détails ouverts sans débordement de la fiche', over.page <= over.w && over.dlg <= over.w, JSON.stringify(over));
    await mp.screenshot({ path: `${SHOTS}/81b-admin-mobile.png`, fullPage: true });
    await mob.close();
    const play = await ctx.newPage();
    await play.addInitScript(() => localStorage.setItem('dig_lang', 'fr'));
    await play.goto(BASE + '/');
    await play.waitForSelector('#block-name:not(:empty)');
    check('admin', 'D aucun bonus transmis au jeu', await play.evaluate(() => GameState.eventBonuses.length === 0));
    check('admin', 'aucune erreur console', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  await browser.close();
  console.log(results.join('\n'));
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
