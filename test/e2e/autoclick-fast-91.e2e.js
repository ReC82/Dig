/**
 * Essai navigateur #91 — détection rapide des autoclickers basiques, jeu réel (Chromium), mode global
 * Appliqué. Serveur de TEST uniquement (jamais le port 3000).
 *
 *   A. Ordinateur 1280×900 — « autoclicker » : clics souris réels au même pixel toutes les 125 ms,
 *      souris jamais déplacée → vérification en quelques secondes (raison « autoclicker ») ;
 *      énigme résolue, reprise immédiate → minage manuel suspendu 5 min, message clair.
 *   B. Ordinateur — humain qui bouge la souris, rythme irrégulier : aucune vérification.
 *   C. Ordinateur — joueur à souris immobile, rythme humain : vérification « même pixel » seulement ;
 *      après résolution, reprise au même pixel 40 s : ni nouvelle vérification ni suspension.
 *   D. Smartphone 390×844 — tapotements au même point toutes les 125 ms : vérification en secondes.
 *
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   ADMIN=<secret> OUT=/tmp/captures node test/e2e/autoclick-fast-91.e2e.js
 */
'use strict';

const assert = require('node:assert');
const path = require('path');
const { chromium } = require(process.env.PW);

const BASE = process.env.BASE, ADMIN = process.env.ADMIN, OUT = process.env.OUT || '/tmp';
if (!BASE || /:3000\b/.test(BASE)) throw new Error('serveur de test obligatoire (jamais le port 3000)');
const H = { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (tag, label, ok, extra = '') => { console.log(`${ok ? 'OK  ' : 'ÉCHEC'} [${tag}] ${label}${extra ? ` — ${extra}` : ''}`); if (!ok) failed++; };

async function fiche(user) {
  const res = await fetch(`${BASE}/api/admin/security/player?q=${encodeURIComponent(user)}`, { headers: H });
  return res.json();
}

async function openGame(browser, user, { mobile = false } = {}) {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-BE' }
    : { viewport: { width: 1280, height: 900 }, locale: 'fr-BE' });
  await ctx.addInitScript(() => { localStorage.setItem('dig_lang', 'fr'); localStorage.setItem('dig_tutorial', JSON.stringify({ state: 'skipped' })); });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message));
  await p.goto(BASE + '/?lang=fr');
  const ok = await p.evaluate(async u => (await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: 'motdepasse91', email: `${u}@example.invalid` }) })).ok, user);
  assert.ok(ok, 'inscription');
  await p.reload();
  await p.waitForSelector('#block');
  await sleep(1500);
  const skip = await p.$('#tuto-card button[data-tuto="skip"]');
  if (skip && await skip.isVisible()) await skip.click();
  return p;
}

const modalOpen = p => p.$('#antibot-modal:not([hidden])');

/** Clics au bloc. gap(i) → attente (ms) ; move : déplace la souris avant chaque clic ; tap : tactile. */
async function play(p, secs, { gap = () => 125, move = false, tap = false, stopOnModal = true } = {}) {
  const box = await p.locator('#block').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const t0 = Date.now();
  for (let i = 0; Date.now() - t0 < secs * 1000; i++) {
    if (stopOnModal && await modalOpen(p)) return { modalAfter: (Date.now() - t0) / 1000, clicks: i };
    const chest = await p.$('#chest-modal:not([hidden]) #btn-collect-chest');
    if (chest) { await chest.click().catch(() => {}); await sleep(300); continue; }
    const x = move ? cx + (Math.random() - 0.5) * box.width * 0.5 : cx;
    const y = move ? cy + (Math.random() - 0.5) * box.height * 0.5 : cy;
    if (tap) await p.touchscreen.tap(x, y);
    else { if (move) await p.mouse.move(x, y, { steps: 3 }); await p.mouse.click(x, y); }
    await sleep(gap(i));
  }
  return { modalAfter: null };
}

/** Résout la vérification comme un humain (version texte, via l'API du jeu) puis recharge la page. */
async function solve(p) {
  const r = await p.evaluate(async () => {
    const st = await (await fetch('/api/me/antibot')).json();
    const id = st.antibot?.challenge?.id;
    if (!id) return { error: 'aucune vérification' };
    const post = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
    const pz = (await post('/api/me/antibot/puzzle', { challengeId: id, kind: 'text' })).puzzle;
    await new Promise(r => setTimeout(r, 1500));
    return post('/api/me/antibot/answer', { challengeId: id, puzzleId: pz.puzzleId, answer: String(pz.a + pz.b),
      manualClicks: GameState.seasonStats.manualClicks, manualBlocks: GameState.seasonStats.manualBlocks });
  });
  await p.reload();
  await p.waitForSelector('#block');
  await sleep(1200);
  return r;
}

const humanGap = () => Math.max(60, 140 * (1 + 0.25 * (Math.random() + Math.random() + Math.random() - 1.5) * 2));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME });
  const sfx = Date.now() % 100000;
  try {
    // A. Autoclicker souris
    const ua = `ac91a_${sfx}`;
    const a = await openGame(browser, ua);
    const r1 = await play(a, 30);
    check('A', 'vérification affichée en quelques secondes', r1.modalAfter != null && r1.modalAfter <= 8, `${r1.modalAfter} s`);
    let f = await fiche(ua);
    const ch1 = f.lotC?.history?.challenges?.[0];
    check('A', 'raison : clics au même pixel (25)', ch1?.reasons?.includes('same_pixel'), JSON.stringify(ch1?.reasons));
    await a.screenshot({ path: path.join(OUT, '91-A-verification-pc.png') });
    const s1 = await solve(a);
    check('A', 'énigme résolue', s1.solved === true, JSON.stringify(s1));
    const r2 = await play(a, 60);
    f = await fiche(ua);
    const ev = f.lotC?.fast?.last?.evidence ?? {};
    check('A', 'preuves : même pixel, rythme machine, souris immobile', f.lotC?.fast?.detections >= 2,
      `détections ${f.lotC?.fast?.detections}, pixel ${ev.samePixelRun}, écart robuste ${ev.robustCv}, top3 ${ev.top3Share}, médiane ${ev.medianMs} ms, immobile ${ev.stillHits}/${ev.mouseHits}`);
    check('A', 'reprise immédiate → minage manuel suspendu 5 min', f.lotC?.state === 'suspended' && f.lotC.suspension?.reason === 'autoclick_repeat'
      && f.lotC.suspension.level === 1, `${f.lotC?.state} ${f.lotC?.suspension?.reason} palier ${f.lotC?.suspension?.level} après ${r2.modalAfter} s de reprise`);
    const txt = await a.locator('#antibot-text').textContent();
    check('A', 'message joueur explicite', /clics automatiques/i.test(txt ?? ''), txt);
    await a.screenshot({ path: path.join(OUT, '91-A-suspension-pc.png') });
    check('A', 'aucune erreur JS', !a.errors.length, a.errors.join(' | '));

    // B. Humain qui bouge la souris
    const ub = `ac91b_${sfx}`;
    const b = await openGame(browser, ub);
    const rb = await play(b, 35, { gap: humanGap, move: true });
    f = await fiche(ub);
    check('B', 'humain mobile : aucune vérification', rb.modalAfter == null && !(f.lotC?.history?.challenges ?? []).length);
    check('B', 'verdict : rien de suspect', f.lotC?.fast?.last && !f.lotC.fast.last.automation && !f.lotC.fast.last.fixed, JSON.stringify(f.lotC?.fast?.last?.evidence));

    // C. Souris immobile, rythme humain
    const uc = `ac91c_${sfx}`;
    const c = await openGame(browser, uc);
    const rc = await play(c, 30, { gap: humanGap });
    f = await fiche(uc);
    const chc = f.lotC?.history?.challenges?.[0];
    check('C', 'souris immobile : vérification « même pixel » (pas autoclicker)', rc.modalAfter != null && chc?.reasons?.includes('same_pixel')
      && !chc.reasons.includes('autoclick_corroborated'), `${rc.modalAfter} s ${JSON.stringify(chc?.reasons)} top3 ${f.lotC?.fast?.last?.evidence?.top3Share}`);
    await solve(c);
    const rc2 = await play(c, 40, { gap: humanGap });
    f = await fiche(uc);
    check('C', 'reprise immobile 40 s : ni nouvelle vérification ni suspension', rc2.modalAfter == null && f.lotC?.state === 'normal'
      && (f.lotC?.history?.suspensions ?? []).length === 0, `${f.lotC?.state}`);

    // D. Smartphone, tapotements au même point
    const ud = `ac91d_${sfx}`;
    const d = await openGame(browser, ud, { mobile: true });
    const rd = await play(d, 30, { tap: true });
    f = await fiche(ud);
    check('D', 'mobile : vérification en quelques secondes', rd.modalAfter != null && rd.modalAfter <= 8, `${rd.modalAfter} s ${JSON.stringify(f.lotC?.history?.challenges?.[0]?.reasons)}`);
    await d.screenshot({ path: path.join(OUT, '91-D-verification-mobile.png') });
    check('D', 'aucune erreur JS', !d.errors.length, d.errors.join(' | '));
  } finally {
    await browser.close();
  }
  console.log(failed ? `${failed} ÉCHEC(S)` : 'TOUT OK');
  process.exit(failed ? 1 : 0);
})();
