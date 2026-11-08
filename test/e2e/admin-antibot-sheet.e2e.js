/**
 * Essai navigateur #76 (recette du 05/11) : fiche anti-bot en deux onglets — « Vue essentielle » lisible
 * sans rien ouvrir (progression déclarée / validée, PV réels + écart, blocs manuels validés, risque /
 * alertes / sanctions, origine des blocs détruits) et « Diagnostic avancé » avec toutes les sections.
 * Serveur de TEST uniquement (base temporaire, port ≥ 3100). La sauvegarde du joueur de test est écrite
 * directement dans la base de TEST (DB=chemin) ; aucune requête d'écriture n'est faite par l'admin.
 *
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   ADMIN_SECRET=… DB=/chemin/server/data/test-76.sqlite OUT=/tmp/captures node test/e2e/admin-antibot-sheet.e2e.js
 */
'use strict';

const path = require('path');
const Database = require('better-sqlite3');
const { chromium } = require(process.env.PW);
const { admOpenTab } = require('./_admin-nav');

const BASE = process.env.BASE, SECRET = process.env.ADMIN_SECRET, OUT = process.env.OUT || '/tmp';
if (!process.env.DB || /\/home\/ubuntu\/Dig\//.test(path.resolve(process.env.DB))) throw new Error('DB de test obligatoire (jamais la production)');
let failed = 0;
const check = (tag, label, ok, extra = '') => { console.log(`${ok ? 'OK  ' : 'ÉCHEC'} [${tag}] ${label}${extra ? ` — ${extra}` : ''}`); if (!ok) failed++; };

(async () => {
  const name = `abot76x${Date.now() % 100000}`;
  const reg = await fetch(`${BASE}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name, email: `${name}@example.invalid`, password: 'secret123' }) });
  if (reg.status !== 200) throw new Error(`inscription ${reg.status}`);
  const db = new Database(process.env.DB);
  const uid = db.prepare('SELECT id FROM users WHERE username = ?').get(name).id;
  const sid = db.prepare("SELECT id FROM seasons WHERE status = 'active' ORDER BY id DESC LIMIT 1").get().id;
  // Cas de la recette : 510 blocs au total, 131 manuels, 37 Auto-Dig, 169 m cette saison
  db.prepare(`INSERT INTO user_saves (user_id, data, version) VALUES (?, ?, 4)
              ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, version = excluded.version`).run(uid, JSON.stringify({
    depth: 169, coins: 1200, gems: 3, stats: { blocksDestroyed: 510 },
    seasonStats: { seasonId: sid, maxDepth: 169, manualBlocks: 131, autoBlocks: 37, manualClicks: 3775, suspiciousScore: 0, suspiciousBlocks: 0 },
  }));
  // Classement et suivi de profondeur de la saison (valeurs serveur) : 169 m déclarés, 160 m retenus, 150 m aux PV réels
  db.prepare(`INSERT INTO season_rankings (season_id, user_id, max_depth, reported_max_depth, manual_blocks, effective_manual_blocks, auto_blocks, manual_clicks, is_active)
              VALUES (?, ?, 160, 169, 131, 120, 37, 3775, 1)`).run(sid, uid);
  db.prepare(`INSERT INTO player_depth_tracking (user_id, season_id, accepted_depth, last_gap, updated_ms, dmg_depth, xhp_state)
              VALUES (?, ?, 160, 9, ?, 160, ?)`).run(uid, sid, Date.now(), JSON.stringify({ depth: 150, gap: 19, credit: 0, seed: 1, seedChanges: 0 }));
  db.close();

  const browser = await chromium.launch({ executablePath: process.env.CHROME });
  try {
    for (const [tag, viewport, isMobile] of [['pc 1280', { width: 1280, height: 900 }, false], ['mobile 390', { width: 390, height: 844 }, true]]) {
      const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile });
      const page = await ctx.newPage();
      const errors = [], writes = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (r.method() !== 'GET' && /\/api\/admin\//.test(r.url()) && !/\/api\/admin\/session$/.test(r.url())) writes.push(r.url()); });
      await page.goto(`${BASE}/admin/`);
      await page.fill('#secret-input', SECRET);
      await page.click('#secret-btn');
      await page.waitForSelector('.tab-btn[data-tab="security"]', { state: 'attached' });
      await admOpenTab(page, 'security');
      await page.fill('#sec-player-q', name);
      await page.click('#sec-player-form button[type="submit"]');
      await page.waitForSelector('#sec-player-dialog[open] .sec-cards');

      const st = await page.evaluate(() => {
        const vis = el => !!el && !el.closest('[hidden]') && el.getBoundingClientRect().height > 0;
        const dlg = document.getElementById('sec-player-dialog');
        return {
          essSel: document.getElementById('sec-tab-essential')?.getAttribute('aria-selected'),
          essVis: vis(document.getElementById('sec-pane-essential')), advVis: vis(document.getElementById('sec-pane-advanced')),
          cards: [...document.querySelectorAll('#sec-pane-essential .sec-card')].map(c => c.textContent.replace(/\s+/g, ' ')),
          origin: document.querySelector('#sec-pane-essential .sec-origin')?.textContent.replace(/\s+/g, ' ') ?? '',
          sections: document.querySelectorAll('#sec-pane-advanced details.sec-acc').length,
          overflow: dlg.scrollWidth > dlg.clientWidth + 1, dlgH: dlg.getBoundingClientRect().height, vh: innerHeight,
          cardsBottom: document.querySelector('#sec-pane-essential .sec-cards').getBoundingClientRect().bottom,
        };
      });
      check(tag, 'vue essentielle ouverte par défaut, diagnostic masqué', st.essSel === 'true' && st.essVis && !st.advVis);
      check(tag, '5 cartes : progression, PV réels, classement, risque, autoclicker (#91)', st.cards.length === 5
        && /169 m déclarés/.test(st.cards[0]) && /Validée \(classement\) : 160 m/.test(st.cards[0]) && /Écart déclaré − validé : 9 m/.test(st.cards[0])
        && /150 m couverts/.test(st.cards[1]) && /Écart à la dernière sauvegarde : 19 m/.test(st.cards[1])
        && /120 validés/.test(st.cards[2]) && /non retenus : 11/.test(st.cards[2]) && /Sanctions : aucune/.test(st.cards[3]), st.cards.join(' | '));
      check(tag, 'origine des blocs : 131 / 37 / 0 / 342 sur 510, expliquée', /Manuels \(cette saison\) : 131/.test(st.origin) && /Auto-Dig \(cette saison\) : 37/.test(st.origin)
        && /suspects \(cette saison\) : 0/.test(st.origin) && /hors saison en cours\) : 342/.test(st.origin) && /510/.test(st.origin)
        && /jamais remis à zéro/.test(st.origin) && /Tous les blocs de la saison sont attribués/.test(st.origin), st.origin.slice(0, 400));
      check(tag, 'aucun débordement horizontal de la fenêtre', !st.overflow);
      check(tag, 'cartes visibles sans défiler', st.cardsBottom <= st.vh, `${Math.round(st.cardsBottom)} / ${st.vh}`);
      await page.screenshot({ path: path.join(OUT, `antibot76-${isMobile ? 'mobile' : 'pc'}-essentiel.png`), fullPage: false });

      await page.click('#sec-tab-advanced');
      const adv = await page.evaluate(() => ({
        sel: document.getElementById('sec-tab-advanced').getAttribute('aria-selected'),
        essHidden: document.getElementById('sec-pane-essential').hidden,
        sections: document.querySelectorAll('#sec-pane-advanced details.sec-acc').length,
        allClosed: [...document.querySelectorAll('#sec-pane-advanced details.sec-acc')].every(d => !d.open),
      }));
      check(tag, 'diagnostic avancé : 12 sections repliées, vue essentielle masquée', adv.sel === 'true' && adv.essHidden && adv.sections === 12 && adv.allClosed, JSON.stringify(adv));
      await page.click('#btn-sec-player-refresh');
      await page.waitForTimeout(600);
      check(tag, 'onglet conservé au rafraîchissement', await page.evaluate(() => document.getElementById('sec-tab-advanced').getAttribute('aria-selected') === 'true'));
      await page.click('#sec-pane-advanced details[data-sec="progress"] > summary');
      const prog = await page.textContent('#sec-pane-advanced details[data-sec="progress"]');
      check(tag, 'progression détaillée : toutes les métriques conservées', /PV réels des blocs \(#77\)/.test(prog) && /Blocs coups jugés suspects/.test(prog) && /total partie − manuels − Auto-Dig/.test(prog));
      await page.screenshot({ path: path.join(OUT, `antibot76-${isMobile ? 'mobile' : 'pc'}-avance.png`), fullPage: false });
      await page.click('#sec-tab-essential');
      check(tag, 'aucune requête d’écriture admin', writes.length === 0, writes.join(', '));
      check(tag, 'aucune erreur JS', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(failed ? `${failed} ÉCHEC(S)` : 'TOUT OK');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
