/**
 * #25 — recette du propriétaire du 09/11 : « Terminer le test » grisé sans explication après une
 * vérification résolue en mode « Appliqué » pour tous. Le bouton n'est actif que s'il reste quelque
 * chose à remettre en état côté serveur ; sinon la raison est écrite et l'étape 5 est cochée
 * (« Essai terminé — … aucune remise à zéro nécessaire »), avec « Nouveau test ». En mode Appliqué
 * pour tous, le délai court (étape 3) place d'abord ce compte seul en essai. Aucune route nouvelle,
 * aucun réglage global modifié. Parcours Chromium : test/e2e/admin-antibot-end-25.e2e.js.
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

const ctx = vm.createContext({ Date });
vm.runInContext(`${fn('secTestChallenge')}\n${fn('secTestEnd')}\nthis.secTestChallenge = secTestChallenge; this.secTestEnd = secTestEnd;`, ctx);
const { secTestChallenge, secTestEnd } = ctx;

const ago = min => new Date(Date.now() - min * 60_000).toISOString();
const chRow = (id, status, min = 5) => ({ id, status, createdAt: ago(min), freeze: { issued: { manualBlocks: 2, at: ago(min) } } });
// Compte en mode Appliqué pour tous, sans essai propre (cas de la capture du 09/11)
const base = (over = {}) => ({ mode: 'enforce', globalMode: 'enforce', testEnforce: false, testThreshold: null, challenge: null,
  suspension: null, violationLevel: 0, history: { challenges: [] }, ...over });

test('cas de la capture : vérification résolue, rien d\'actif → essai terminé, aucune remise à zéro, pas de bouton grisé muet', () => {
  const L = base({ history: { challenges: [chRow(9, 'solved')] } });
  const ch = secTestChallenge(L);
  assert.strictEqual(ch.id, 9);
  const e = secTestEnd(L, ch, false);
  assert.strictEqual(e.needsReset, false);
  assert.strictEqual(e.finished, true, 'étape 5 cochée sans clic');
  assert.deepStrictEqual([...e.left], []);
  const r = fn('secTestRender');
  assert.match(r, /Essai terminé — \$\{d\.player\.username\} mine normalement ; aucune remise à zéro nécessaire/);
  assert.match(r, /endBtn\.hidden = ended;/);
  assert.match(r, /newBtn\.hidden = !ended;/);
});

test('vérification en attente (y compris énigme expirée, #84 signalement envoyé) → à remettre en état, bouton actif', () => {
  // Une énigme expirée ou un signalement #84 ne résolvent pas le défi : il reste « pending » côté serveur
  const pend = { id: 10, status: 'pending', createdAt: ago(1) };
  const L = base({ challenge: pend, history: { challenges: [{ ...chRow(10, 'pending', 1), freeze: { open: true, issued: {} } }] } });
  const e = secTestEnd(L, secTestChallenge(L), false);
  assert.strictEqual(e.needsReset, true);
  assert.strictEqual(e.finished, false);
  assert.deepStrictEqual([...e.left], ['vérification en attente']);
});

test('suspension, palier, délai court, essai : chacun nommé et « Terminer le test » actif', () => {
  const L = base({ suspension: { id: 3 }, violationLevel: 1, testThreshold: { minutes: 2 }, testEnforce: true,
    history: { challenges: [chRow(11, 'solved')] } });
  const e = secTestEnd(L, secTestChallenge(L), false);
  assert.strictEqual(e.needsReset, true);
  assert.strictEqual(e.finished, false, 'résolu ne suffit pas tant que la suspension ou l\'essai restent');
  assert.deepStrictEqual([...e.left], ['suspension du minage', 'palier de sanction 1', 'délai court', 'essai sur ce compte']);
  // Délai court expiré (2 h) mais essai encore actif : toujours à remettre en état
  assert.deepStrictEqual([...secTestEnd(base({ testEnforce: true }), null, false).left], ['essai sur ce compte']);
});

test('rien encore fait : pas terminé, raison écrite (« Rien à remettre en état »)', () => {
  const e = secTestEnd(base(), null, false);
  assert.strictEqual(e.needsReset, false);
  assert.strictEqual(e.finished, false);
  assert.match(fn('secTestRender'), /Rien à remettre en état : aucun essai, délai court, vérification ni suspension sur ce compte\./);
  assert.strictEqual(secTestEnd(null, null, false).finished, false);
});

test('après « Terminer le test » puis F5 : état relu côté serveur, toujours terminé tant que la vérification est récente', () => {
  const L = base({ history: { challenges: [chRow(12, 'cancelled')] } });
  assert.strictEqual(secTestEnd(L, null, true).finished, true, 'clic sur Terminer');
  assert.strictEqual(secTestEnd(L, secTestChallenge(L), false).finished, true, 'F5 : _secTest.ended perdu, vérification annulée retrouvée');
  // Aucun stockage navigateur
  const block = JS.slice(JS.indexOf('// ── Parcours guidé « Tester la protection » (#87)'), JS.indexOf('// ── Réponses anti-bot (#25 lot C)'));
  assert.doesNotMatch(block, /sessionStorage|localStorage/);
});

test('« Nouveau test » : n\'efface rien, ignore seulement les vérifications déjà terminées', () => {
  const L = base({ history: { challenges: [chRow(9, 'solved'), chRow(8, 'solved', 20)] } });
  assert.strictEqual(secTestChallenge(L, 9), null, 'retour à l\'étape 3');
  assert.strictEqual(secTestEnd(L, secTestChallenge(L, 9), false).finished, false);
  const L2 = { ...L, history: { challenges: [chRow(13, 'solved', 0), ...L.history.challenges] } };
  assert.strictEqual(secTestChallenge(L2, 9).id, 13, 'nouvelle vérification suivie');
  assert.match(HTML, /id="btn-sec-test-new" hidden>Nouveau test</);
  const handler = JS.slice(JS.indexOf("getElementById('btn-sec-test-new').addEventListener"), JS.indexOf("getElementById('btn-sec-test-end').addEventListener"));
  assert.doesNotMatch(handler, /api\(/, 'aucun appel serveur');
});

test('mode Appliqué pour tous : le délai court est activable (essai de ce compte seul), jamais le mode global', () => {
  const r = fn('secTestRender');
  assert.match(r, /acOn\.disabled = busy \|\| !L \|\| L\.mode !== 'enforce' \|\| pending \|\| !!L\.suspension/);
  assert.doesNotMatch(r, /acOn\.disabled = busy \|\| !L\?\.testEnforce/);
  const h = JS.slice(JS.indexOf("getElementById('btn-sec-test-ac-on').addEventListener"), JS.indexOf("getElementById('sec-test-delay').addEventListener"));
  assert.match(h, /if \(!_secTest\.data\.lotC\.testEnforce\)[\s\S]{0,120}test-mode`, \{ enforce: true \}/);
  assert.ok(h.indexOf('test-mode') < h.indexOf('test-threshold'));
  assert.doesNotMatch(h, /\/api\/admin\/config|antibot_response_mode/);
});

test('Terminer le test sans rien d\'actif : aucun appel serveur, juste l\'état terminé', () => {
  const h = JS.slice(JS.indexOf("getElementById('btn-sec-test-end').addEventListener"), JS.indexOf('// ── Réponses anti-bot (#25 lot C)'));
  assert.match(h, /if \(!secTestEnd\(L, null, false\)\.needsReset\) \{ _secTest\.ended = true; return ''; \}/);
});
