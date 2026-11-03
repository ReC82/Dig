/**
 * Boutons « ↻ Rafraîchir » uniformes dans tout le panel admin (#60) :
 * - inventaire : chaque bouton Rafraîchir de index.html passe par admRefreshButton (aucun branchement direct) ;
 * - état visible commun : « ↻ Actualisation… » (bouton indisponible, focus conservé), puis « ✓ Données à jour à
 *   HH:MM:SS » avec « aucun changement » / « nouvelles données affichées », ou « ⚠️ Échec de l'actualisation » ;
 * - un échec de lecture (HTTP ou réseau) n'est jamais présenté comme « à jour » ; ligne d'état aria-live ;
 * - aucune écriture pendant un rafraîchissement ; lectures sans cache ; toasts espacés lors de clics rapides ;
 * - saisies conservées : le barème Points n'est plus effacé par Rafraîchir.
 * Parcours Chromium réels (PC 1280×900 et 390×844) : test/e2e/admin-refresh.e2e.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');
const fn = name => { const i = JS.search(new RegExp(`(async )?function ${name}\\(`)); assert.ok(i >= 0, name); return JS.slice(i, JS.indexOf('\n}\n', i) + 2); };

const REFRESH_IDS = [...HTML.matchAll(/<button[^>]*id="([^"]+)"[^>]*>↻ Rafraîchir<\/button>/g)].map(m => m[1]);

test('inventaire : tous les boutons « ↻ Rafraîchir » passent par le composant commun', () => {
  assert.ok(REFRESH_IDS.length >= 16, `${REFRESH_IDS.length} boutons`);
  for (const id of REFRESH_IDS) {
    assert.match(JS, new RegExp(`admRefreshButton\\('${id}', load\\w+, '[^']+'\\)`), id);
    assert.doesNotMatch(JS, new RegExp(`getElementById\\('${id}'\\)\\??\\.addEventListener`), `${id} : branchement direct restant`);
  }
  // Anti-bot (#25) et Atelier d'icônes explicitement couverts (commentaires du propriétaire)
  for (const id of ['btn-refresh-sec', 'btn-refresh-ac', 'btn-refresh-icons', 'btn-ev-refresh', 'btn-refresh-collections', 'btn-refresh-beta']) {
    assert.ok(REFRESH_IDS.includes(id), id);
  }
});

test('lectures sans cache et relevé des lectures / écritures par api()', () => {
  const a = fn('api');
  assert.match(a, /cache: 'no-store'/);
  assert.match(a, /admRefreshNote\(method, path, res\.ok, data\)/);
  // Réseau coupé : échec ordinaire relevé aussi (#61)
  assert.match(a, /catch \{\s+admRefreshNote\(method, path, false, \{ error: 'serveur injoignable' \}\);\s+return \{ ok: false, status: 0/);
});

test('Points : Rafraîchir ne supprime plus le barème en cours de saisie', () => {
  assert.doesNotMatch(JS, /addEventListener\('click', \(\) => \{\s+delete document\.getElementById\('pt-scale'\)\.dataset\.dirty/);
  assert.match(JS, /admRefreshButton\('btn-refresh-points', loadPoints, 'Points'\)/);
  assert.match(fn('loadPoints'), /if \(!ta\.dataset\.dirty\) ta\.value =/);
});

// ── Comportement du composant, exécuté dans un DOM minimal ──────────────────
function fakeEl(tag = 'button', text = '') {
  const attrs = {};
  const classes = new Set();
  const el = {
    tagName: tag, id: '', textContent: text, listeners: {}, nextElementSibling: null,
    setAttribute: (k, v) => { attrs[k] = String(v); if (k === 'id') el.id = String(v); },
    getAttribute: k => (k in attrs ? attrs[k] : null),
    removeAttribute: k => { delete attrs[k]; },
    addEventListener: (t, f) => { el.listeners[t] = f; },
    after: other => { el.nextElementSibling = other; },
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
    attrs,
  };
  Object.defineProperty(el, 'className', {
    get: () => [...classes].join(' '),
    set: v => { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); },
  });
  return el;
}

function harness() {
  const btn = fakeEl('button', '↻ Rafraîchir');
  const toasts = [];
  const ctx = {
    document: { getElementById: id => (id === 'btn-x' ? btn : null), createElement: t => fakeEl(t) },
    admToast: t => toasts.push(t), console: { error() {} }, setTimeout, Date, JSON, Math, Set, Map, Promise,
  };
  vm.createContext(ctx);
  const src = JS.slice(JS.indexOf('const admClock ='), JS.indexOf('\n}\n', JS.indexOf('function admRefreshButton(')) + 2);
  vm.runInContext(`${src}\nthis.admRefreshButton = admRefreshButton; this.note = admRefreshNote;`, ctx);
  return { btn, toasts, ctx };
}

test('composant : attente visible, succès daté, « aucun changement » puis « nouvelles données »', async () => {
  const { btn, toasts, ctx } = harness();
  let payload = { n: 1 };
  let seenDuring = null;
  ctx.admRefreshButton('btn-x', async ({ manual }) => {
    assert.strictEqual(manual, true);
    seenDuring = { text: btn.textContent, busy: btn.getAttribute('aria-disabled'), status: btn.nextElementSibling.textContent };
    ctx.note('GET', '/api/admin/x', true, payload);
  }, 'Test');
  const st = btn.nextElementSibling;
  assert.ok(st, 'ligne d\'état créée');
  assert.strictEqual(st.getAttribute('aria-live'), 'polite');
  assert.strictEqual(st.getAttribute('role'), 'status');
  assert.strictEqual(btn.getAttribute('aria-describedby'), st.id);

  ctx.note('GET', '/api/admin/x', true, payload);   // chargement de l'onglet
  await btn.listeners.click();
  assert.deepStrictEqual(seenDuring, { text: '↻ Actualisation…', busy: 'true', status: 'Chargement…' });
  assert.strictEqual(btn.textContent, '↻ Rafraîchir');
  assert.strictEqual(btn.getAttribute('aria-disabled'), null, 'bouton de nouveau disponible');
  assert.match(st.textContent, /^✓ Données à jour à \d\d:\d\d:\d\d — aucun changement$/);
  assert.strictEqual(toasts.length, 1);

  payload = { n: 2 };
  await btn.listeners.click();
  assert.match(st.textContent, /— nouvelles données affichées$/);
  assert.strictEqual(toasts.length, 1, 'pas de second toast dans les 5 s (clics rapides)');
});

test('composant : un échec HTTP ou réseau n\'est jamais présenté comme « à jour »', async () => {
  const { btn, toasts, ctx } = harness();
  let fail = false;
  ctx.admRefreshButton('btn-x', async () => {
    ctx.note('GET', '/api/admin/a', true, { ok: 1 });
    if (fail) ctx.note('GET', '/api/admin/b', false, { error: 'Serveur injoignable' });
  }, 'Test');
  const st = btn.nextElementSibling;
  await btn.listeners.click();
  assert.match(st.textContent, /^✓ Données à jour/);
  const okTime = st.textContent.match(/\d\d:\d\d:\d\d/)[0];
  fail = true;
  await btn.listeners.click();
  assert.strictEqual(st.className, 'refresh-status is-err');
  assert.match(st.textContent, new RegExp(`^⚠️ Échec de l’actualisation \\(Serveur injoignable\\) — données affichées : ${okTime}$`));
  assert.doesNotMatch(st.textContent, /à jour/);
  assert.match(toasts.at(-1), /^⚠️ Test : échec de l’actualisation\.$/, 'échec toujours signalé, même juste après un succès');
});

test('composant : exception du chargeur = échec visible, bouton rendu ; clic pendant l\'attente ignoré', async () => {
  const { btn, ctx } = harness();
  let calls = 0;
  let release;
  ctx.admRefreshButton('btn-x', async () => { calls++; await new Promise(r => { release = r; }); throw new Error('boom'); }, 'Test');
  const first = btn.listeners.click();
  await btn.listeners.click();   // second clic pendant l'attente : ignoré
  assert.strictEqual(calls, 1);
  release();
  await first;
  assert.match(btn.nextElementSibling.textContent, /^⚠️ Échec de l’actualisation \(erreur inattendue/);
  assert.strictEqual(btn.getAttribute('aria-disabled'), null);
});

test('composant : les écritures pendant un rafraîchissement sont comptées (aucune attendue)', () => {
  const r = fn('admRefreshNote');
  assert.match(r, /if \(method !== 'GET'\) \{ for \(const run of _admRefreshRuns\) run\.writes\+\+; return; \}/);
  // Les chargeurs branchés ne font que des lectures
  for (const m of JS.matchAll(/admRefreshButton\('([^']+)', (load\w+),/g)) {
    assert.doesNotMatch(fn(m[2]), /api\('(POST|PUT|DELETE|PATCH)'/, `${m[1]} → ${m[2]} écrit`);
  }
});
