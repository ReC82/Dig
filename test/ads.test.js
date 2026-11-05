/**
 * Tests de la préparation publicitaire, ticket #45 :
 * - tout désactivé par défaut (aucune bannière, aucun cadre, aucun ads.txt) ;
 * - analyse du code « GET CODE » (clé, format iframe, dimensions de l'emplacement, script HTTPS) ;
 * - activation protégée (ACTIVER, régie, domaine), coupure d'urgence ADS_DISABLED ;
 * - domaine officiel seul : l'adresse alternative ne reçoit jamais de publicité ni d'ads.txt,
 *   robots.txt la désindexe sans redirection ;
 * - cadre isolé : CSP à nonce, aucune clé dans la configuration publique, compteur technique ;
 * - page du jeu : aucun script tiers, iframe sandbox sans allow-same-origin ;
 * - promotion interne DIG! (04/11) : désactivée par défaut, indépendante de la régie et
 *   d'ADS_DISABLED, coupe-circuit PROMO_DISABLED, aucun cadre ni script tiers, migration additive ;
 * - routes HTTP (serveur de test, port ≠ 3000, base temporaire).
 * Lancer : npm test
 */

'use strict';

const test     = require('node:test');
const assert   = require('node:assert');
const crypto   = require('crypto');
const fs       = require('fs');
const http     = require('http');
const os       = require('os');
const path     = require('path');
const { spawn } = require('child_process');

const ROOT  = path.join(__dirname, '..');
const PORT  = process.env.DIG_TEST_PORT_ADS || '3164';
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-ads-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');
delete process.env.ADS_DISABLED;

const db  = require('../server/db');
const ads = require('../server/ads');
db.initDb();

const KEY_M = 'ed65346038546d10006fb13bdf2c810e';
const KEY_D = 'fd2ab86fcc2c43bb1749be5e939dc821';
const snippet = (key, w, h, { format = 'iframe', src = `https://ads.example.net/22/${key}` } = {}) => `<script>
  atOptions = {
    'key' : '${key}',
    'format' : '${format}',
    'height' : ${h},
    'width' : ${w},
    'params' : {}
  };
</script>
<script src="${src}"></script>`;

const OFFICIAL = 'dig.lodygames.com';
const ALT      = 'dig.lodylands.com';

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('par défaut : tout est désactivé', () => {
  const s = ads.getSettings();
  assert.strictEqual(s.enabled, false);
  assert.deepStrictEqual(s.allowedHosts, [OFFICIAL]);
  assert.ok(ads.getSlots().every(x => !x.enabled && !x.configured));
  assert.deepStrictEqual(ads.publicConfig(OFFICIAL), { enabled: false, reason: 'disabled', consentVersion: 1, slots: [], promo: null });
  assert.strictEqual(ads.frameDocument('top_mobile', OFFICIAL), null);
  assert.strictEqual(ads.adsTxt(OFFICIAL), null);
  assert.strictEqual(ads.isAdFree(1), false);
});

test('promotion interne : désactivée par défaut, pilotée à part, coupe-circuits distincts', () => {
  assert.strictEqual(ads.getSettings().promoEnabled, false);
  assert.deepStrictEqual(ads.getSlots().map(s => [s.slot, s.promoHideOnDig]), [['top_mobile', true], ['top_desktop', false]],
    'reprend le réglage « masquer sur l\'écran de minage » existant');
  assert.strictEqual(ads.publicConfig(OFFICIAL).promo, null);

  const st = ads.updatePromo({ enabled: true });
  assert.strictEqual(st.enabled, true);
  for (const host of [OFFICIAL, ALT]) {
    const cfg = ads.publicConfig(host);
    assert.strictEqual(cfg.enabled, false, 'la régie reste coupée');
    assert.deepStrictEqual(cfg.slots, []);
    assert.deepStrictEqual(cfg.promo, { campaign: 'gems_shop', slots: [
      { slot: 'top_mobile', width: 320, height: 50, hideOnDig: true },
      { slot: 'top_desktop', width: 728, height: 90, hideOnDig: false }] });
  }
  assert.strictEqual(ads.frameDocument('top_mobile', OFFICIAL), null, 'aucun cadre de régie pour la promotion');

  process.env.ADS_DISABLED = '1';
  try { assert.ok(ads.publicConfig(OFFICIAL).promo, 'ADS_DISABLED ne coupe pas la promotion interne'); }
  finally { delete process.env.ADS_DISABLED; }
  process.env.PROMO_DISABLED = '1';
  try {
    assert.strictEqual(ads.publicConfig(OFFICIAL).promo, null);
    assert.strictEqual(ads.promoState().killSwitch, true);
  } finally { delete process.env.PROMO_DISABLED; }

  ads.updatePromo({ hideOnDig: { top_mobile: false, top_desktop: true } });
  assert.deepStrictEqual(ads.publicConfig(OFFICIAL).promo.slots.map(s => s.hideOnDig), [false, true]);
  assert.deepStrictEqual(ads.getSlots().map(s => s.hideOnDig), [true, false], 'réglage de la régie inchangé');
  assert.throws(() => ads.updatePromo({ hideOnDig: { sidebar: true } }), /inconnu/);
  db.initDb();   // migration rejouée : idempotente, les réglages restent
  assert.deepStrictEqual(ads.getSlots().map(s => s.promoHideOnDig), [false, true]);
  assert.strictEqual(ads.getSettings().promoEnabled, true);

  ads.updatePromo({ enabled: false, hideOnDig: { top_mobile: true, top_desktop: false } });
  assert.strictEqual(ads.publicConfig(OFFICIAL).promo, null);
});

test('migration : base existante sans colonnes de promotion, réglages conservés', () => {
  const file = path.join(dir, 'old.sqlite');
  const Database = require('better-sqlite3');
  const old = new Database(file);
  old.exec(`CREATE TABLE ad_settings (id INTEGER PRIMARY KEY CHECK (id = 1), enabled INTEGER NOT NULL DEFAULT 0,
      provider TEXT NOT NULL DEFAULT '', allowed_hosts TEXT NOT NULL DEFAULT '["dig.lodygames.com"]',
      consent_version INTEGER NOT NULL DEFAULT 1, ads_txt TEXT NOT NULL DEFAULT '', legal_contact TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO ad_settings (id, legal_contact) VALUES (1, 'Éditeur');
    CREATE TABLE ad_slots (slot TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, ad_key TEXT NOT NULL DEFAULT '',
      script_url TEXT NOT NULL DEFAULT '', hide_on_dig INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO ad_slots (slot, hide_on_dig) VALUES ('top_mobile', 0), ('top_desktop', 1);`);
  old.close();
  const { execFileSync } = require('child_process');
  const out = execFileSync(process.execPath, ['-e', `
    const db = require('./server/db'); db.initDb(); db.initDb();
    const ads = require('./server/ads');
    console.log(JSON.stringify([ads.getSettings().legalContact, ads.getSettings().promoEnabled,
      ads.getSlots().map(s => [s.slot, s.hideOnDig, s.promoHideOnDig])]));`],
  { cwd: ROOT, env: { ...process.env, DB_FILE: file }, encoding: 'utf8' });
  assert.deepStrictEqual(JSON.parse(out.trim().split('\n').pop()),
    ['Éditeur', false, [['top_mobile', false, false], ['top_desktop', true, true]]]);
});

test('analyse du code GET CODE', () => {
  const r = ads.parseSnippet(snippet(KEY_M, 320, 50, { src: `https://bauval.org/22/${KEY_M}` }), 'top_mobile');
  assert.deepStrictEqual(r, { key: KEY_M, scriptUrl: `https://bauval.org/22/${KEY_M}`, scriptHost: 'bauval.org' });
  assert.strictEqual(ads.parseSnippet(snippet(KEY_D, 728, 90), 'top_desktop').key, KEY_D);
  const bad = (txt, slot, re) => assert.throws(() => ads.parseSnippet(txt, slot), re);
  bad(snippet(KEY_D, 728, 90), 'top_mobile', /Dimensions 728×90/);
  bad(snippet(KEY_M, 320, 50, { format: 'js' }), 'top_mobile', /iframe/);
  bad(snippet('zz', 320, 50), 'top_mobile', /key/);
  bad(snippet(KEY_M, 320, 50, { src: `http://ads.example.net/22/${KEY_M}` }), 'top_mobile', /HTTPS/);
  bad(snippet(KEY_M, 320, 50, { src: 'https://ads.example.net/22/autre' }), 'top_mobile', /clé/);
  bad(snippet(KEY_M, 320, 50) + '<script src="https://x.example/a.js"></script>', 'top_mobile', /exactement un script/);
  bad(snippet(KEY_M, 320, 50), 'sidebar', /inconnu/);
});

test('activation protégée, domaine officiel seul, coupure d\'urgence', () => {
  assert.throws(() => ads.updateSlot('top_mobile', { enabled: true }), /Coller le code/);
  ads.updateSlot('top_mobile', { snippet: snippet(KEY_M, 320, 50), enabled: true });
  ads.updateSlot('top_desktop', { snippet: snippet(KEY_D, 728, 90), enabled: true });
  assert.strictEqual(ads.publicConfig(OFFICIAL).reason, 'disabled', 'emplacements seuls : rien sans interrupteur général');

  assert.throws(() => ads.updateSettings({ enabled: true }), /ACTIVER/);
  assert.throws(() => ads.updateSettings({ enabled: true, confirm: 'ACTIVER' }), /régie/);
  assert.throws(() => ads.updateSettings({ provider: 'inconnue' }), /Régie inconnue/);
  assert.throws(() => ads.updateSettings({ allowedHosts: 'pas un domaine' }), /domaines/);
  ads.updateSettings({ provider: 'adsterra' });
  ads.updateSettings({ enabled: true, confirm: 'ACTIVER' });

  const cfg = ads.publicConfig(OFFICIAL);
  assert.strictEqual(cfg.enabled, true);
  assert.deepStrictEqual(cfg.slots.map(s => [s.slot, s.width, s.height, s.hideOnDig]),
    [['top_mobile', 320, 50, true], ['top_desktop', 728, 90, false]]);
  assert.ok(!JSON.stringify(cfg).includes(KEY_M), 'aucune clé de régie dans la configuration publique');
  assert.strictEqual(ads.publicConfig('DIG.LODYGAMES.COM:443').enabled, true, 'casse et port ignorés');

  // Adresse alternative : jamais de publicité, de cadre ni d'ads.txt
  assert.strictEqual(ads.publicConfig(ALT).reason, 'host_not_allowed');
  assert.strictEqual(ads.frameDocument('top_mobile', ALT), null);
  ads.updateSettings({ adsTxt: 'ads.example.net, pub-123, DIRECT' });
  assert.strictEqual(ads.adsTxt(OFFICIAL), 'ads.example.net, pub-123, DIRECT\n');
  assert.strictEqual(ads.adsTxt(ALT), null);

  process.env.ADS_DISABLED = '1';
  try {
    assert.strictEqual(ads.publicConfig(OFFICIAL).reason, 'kill_switch');
    assert.strictEqual(ads.frameDocument('top_mobile', OFFICIAL), null);
  } finally { delete process.env.ADS_DISABLED; }

  // Emplacement désactivé : plus servi
  ads.updateSlot('top_desktop', { enabled: false });
  assert.deepStrictEqual(ads.publicConfig(OFFICIAL).slots.map(s => s.slot), ['top_mobile']);
  assert.strictEqual(ads.frameDocument('top_desktop', OFFICIAL), null);
  ads.updateSlot('top_desktop', { enabled: true });

  // Consentement redemandé : version incrémentée
  assert.strictEqual(ads.updateSettings({ bumpConsent: true }).consentVersion, 2);
});

test('cadre isolé : CSP à nonce, clé échappée, compteur technique', () => {
  const doc = ads.frameDocument('top_mobile', OFFICIAL);
  const nonce = doc.csp.match(/'nonce-([^']+)'/)[1];
  assert.match(doc.csp, /default-src 'none'/);
  assert.match(doc.csp, /frame-ancestors 'self'/);
  assert.strictEqual((doc.html.match(new RegExp(`nonce="${nonce.replace(/[+/=]/g, '\\$&')}"`, 'g')) || []).length, 3);
  assert.ok(doc.html.includes(`"key":"${KEY_M}"`));
  assert.ok(doc.html.includes(`src="https://ads.example.net/22/${KEY_M}"`));
  assert.ok(doc.html.includes("parent.postMessage({ digAd: 'error' }"));
  const n = db.getDb().prepare("SELECT frames FROM ad_daily_stats WHERE slot = 'top_mobile' AND day = date('now')").get().frames;
  assert.ok(n >= 1);
  assert.notStrictEqual(ads.frameDocument('top_mobile', OFFICIAL).csp, doc.csp, 'nonce renouvelé à chaque cadre');
});

test('ads.txt et robots.txt', () => {
  assert.throws(() => ads.validateAdsTxt('<script>alert(1)</script>'), /ligne 1/);
  assert.strictEqual(ads.validateAdsTxt('# commentaire\r\ngoogle.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0\ncontact=x@example.org'),
    '# commentaire\ngoogle.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0\ncontact=x@example.org');
  assert.match(ads.robotsTxt(OFFICIAL, OFFICIAL), /Allow: \/\n/);
  assert.match(ads.robotsTxt(OFFICIAL, OFFICIAL), /Disallow: \/admin\//);
  assert.strictEqual(ads.robotsTxt(ALT, OFFICIAL), 'User-agent: *\nDisallow: /\n');
});

test('page du jeu : aucun script tiers, bannière en iframe sandbox', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(!/<script[^>]+src="(https?:)?\/\//.test(html), 'aucun script externe dans la page du jeu');
  assert.ok(html.indexOf('js/ads.js') < html.indexOf('js/main.js'));
  assert.match(html, /<link rel="canonical" href="https:\/\/dig\.lodygames\.com\/">/);
  const js = fs.readFileSync(path.join(ROOT, 'public/js/ads.js'), 'utf8');
  assert.match(js, /'sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox'/);
  assert.ok(!/allow-same-origin|allow-top-navigation/.test(js.replace(/^\s*(\*|\/\/).*$/gm, '')));
  assert.ok(!/setInterval|setTimeout/.test(js), 'aucun rafraîchissement programmé de la bannière');
  // Promotion interne : création locale, aucune ressource distante, chargée avant ads.js
  assert.ok(html.indexOf('js/gemCallout.js') < html.indexOf('js/ads.js'));
  assert.match(html, /<link rel="stylesheet" href="css\/gemCallout\.css">/);
  const callout = fs.readFileSync(path.join(ROOT, 'public/js/gemCallout.js'), 'utf8')
    + fs.readFileSync(path.join(ROOT, 'public/css/gemCallout.css'), 'utf8');
  assert.ok(!/https?:\/\/|url\(/.test(callout), 'aucune ressource distante dans la création');
  assert.match(js, /switchView\('shop'\)/);
  assert.match(js, /getElementById\('shop-gems-anchor'\)/);
  assert.match(fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8'), /class="section-divider" id="shop-gems-anchor"/);
  assert.ok(!/['"#]ad-top/.test(js), 'conteneur neutre (#top-strip), ignoré des filtres cosmétiques');
});

function get(urlPath, { host, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method: 'GET',
      headers: { ...(host ? { Host: host } : {}), ...headers } }, (res) => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function send(method, urlPath, body, { auth = true } = {}) {
  return fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method, body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${ADMIN}` } : {}) },
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
}

test('routes HTTP : public, cadre, ads.txt, robots, page légale, admin', async (t) => {
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: path.join(dir, 'http.sqlite'), ADMIN_SECRET: ADMIN, SESSION_SECRET: crypto.randomBytes(16).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', d => { log += d; });
  server.stderr.on('data', d => { log += d; });
  t.after(() => server.kill());
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/api/version`); up = true; } catch (_) { await new Promise(r => setTimeout(r, 100)); }
  }
  assert.ok(up, `serveur de test non démarré :\n${log}`);

  let r = await get('/api/ads/config', { host: OFFICIAL });
  assert.deepStrictEqual([r.status, JSON.parse(r.body).enabled, JSON.parse(r.body).reason], [200, false, 'disabled']);
  assert.strictEqual((await get('/ads/frame/top_mobile', { host: OFFICIAL })).status, 404);
  assert.strictEqual((await get('/ads.txt', { host: OFFICIAL })).status, 404);
  r = await get('/legal/confidentialite', { host: OFFICIAL });
  assert.strictEqual(r.status, 200);
  assert.match(r.body, /aucune publicité/);
  assert.match(r.body, /en cours de publication/);
  assert.match((await get('/robots.txt', { host: ALT })).body, /Disallow: \/\n/);
  r = await get('/', { host: ALT });
  assert.strictEqual(r.status, 200, 'adresse alternative servie directement, sans redirection');

  assert.strictEqual((await send('GET', '/api/admin/ads', undefined, { auth: false })).status, 401);
  assert.strictEqual((await send('PUT', '/api/admin/ads/promo', { enabled: true }, { auth: false })).status, 401);
  r = await send('PUT', '/api/admin/ads/promo', { enabled: true });
  assert.deepStrictEqual([r.status, r.body.promo.enabled, r.body.settings.enabled], [200, true, false]);
  r = JSON.parse((await get('/api/ads/config', { host: OFFICIAL })).body);
  assert.deepStrictEqual([r.enabled, r.promo.campaign, r.promo.slots.length], [false, 'gems_shop', 2]);
  assert.strictEqual((await get('/ads/frame/top_desktop', { host: OFFICIAL })).status, 404, 'promotion : aucun cadre');
  r = await send('PUT', '/api/admin/ads/promo', { enabled: false });
  assert.strictEqual(r.body.promo.enabled, false);
  r = await send('PUT', '/api/admin/ads/slots/top_mobile', { snippet: snippet(KEY_M, 320, 50), enabled: true });
  assert.strictEqual(r.status, 200);
  r = await send('PUT', '/api/admin/ads/slots/top_desktop', { snippet: snippet(KEY_M, 320, 50) });
  assert.strictEqual(r.status, 400);
  r = await send('PUT', '/api/admin/ads/settings', { provider: 'adsterra', legalContact: 'Éditeur <test>\nBelgique' });
  assert.strictEqual(r.status, 200);
  r = await send('PUT', '/api/admin/ads/settings', { enabled: true });
  assert.strictEqual(r.status, 400, 'confirmation ACTIVER exigée');
  r = await send('PUT', '/api/admin/ads/settings', { enabled: true, confirm: 'ACTIVER' });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.effective.find(e => e.host === OFFICIAL).slots.map(s => s.slot), ['top_mobile']);

  r = await get('/ads/frame/top_mobile', { host: OFFICIAL });
  assert.strictEqual(r.status, 200);
  assert.match(r.headers['content-security-policy'], /script-src 'nonce-[^']+' 'strict-dynamic' https:/);
  assert.strictEqual(r.headers['x-robots-tag'], 'noindex');
  assert.match(r.body, new RegExp(KEY_M));
  assert.strictEqual((await get('/ads/frame/top_mobile', { host: ALT })).status, 404);
  assert.strictEqual(JSON.parse((await get('/api/ads/config', { host: ALT })).body).reason, 'host_not_allowed');
  // La page du jeu garde sa CSP stricte
  r = await get('/', { host: OFFICIAL });
  assert.ok(!/script-src/.test(r.headers['content-security-policy']));

  r = await get('/legal/confidentialite', { host: OFFICIAL });
  assert.match(r.body, /uniquement\s+si tu l'acceptes/);
  assert.match(r.body, /Éditeur &lt;test&gt;<br>Belgique/);

  r = await send('GET', '/api/admin/ads');
  assert.strictEqual(r.body.stats.find(x => x.slot === 'top_mobile').frames, 1);

  // Retour à l'état sûr
  r = await send('PUT', '/api/admin/ads/settings', { enabled: false });
  assert.strictEqual(r.body.settings.enabled, false);
  assert.strictEqual((await get('/ads/frame/top_mobile', { host: OFFICIAL })).status, 404);
});
