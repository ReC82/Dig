/**
 * Formulaires du compte (#28) : vrais <form>, soumission par Entrée comme par clic,
 * un seul envoi à la fois, erreurs reliées aux champs et focus rendu au champ.
 * Contrôle du source (pas de DOM dans la CI) ; vérification navigateur décrite dans le rapport.
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const path   = require('path');

const main = fs.readFileSync(path.join(__dirname, '..', 'public/js/main.js'), 'utf8');

// Formulaire → message où s'affiche le résultat
const FORMS = {
  'form-account-login':           'acc-error',
  'form-account-forgot':          'acc-forgot-msg',
  'form-account-reset':           'acc-error',
  'form-account-change-password': 'acc-password-msg',
  'form-account-change-email':    'acc-email-msg',
};

/** Extrait le gabarit HTML d'un formulaire, de <form id="…"> à </form>. */
function formHtml(id) {
  const start = main.indexOf(`<form class="account-form" id="${id}" novalidate>`);
  assert.ok(start !== -1, `${id} doit être un <form class="account-form" … novalidate>`);
  const end = main.indexOf('</form>', start);
  assert.ok(end > start, `${id} doit être fermé par </form>`);
  return main.slice(start, end);
}

test('chaque formulaire du compte est un <form> avec un seul bouton submit', () => {
  for (const id of Object.keys(FORMS)) {
    const html = formHtml(id);
    assert.ok(!/<form[\s>]/.test(html.slice(5)), `${id} ne doit pas contenir de formulaire imbriqué`);
    const buttons = html.match(/<button\b[^>]*>/g) || [];
    assert.ok(buttons.length > 0, `${id} doit contenir un bouton`);
    for (const b of buttons) {
      assert.match(b, /\btype="(submit|button)"/, `${id} : type explicite requis pour ${b}`);
    }
    assert.strictEqual(buttons.filter(b => b.includes('type="submit"')).length, 1,
      `${id} : exactement un bouton submit (Entrée valide ce bouton)`);
  }
});

test('chaque formulaire est branché sur « submit », avec son message', () => {
  for (const [id, msg] of Object.entries(FORMS)) {
    assert.ok(main.includes(`_onAccountSubmit('${id}', '${msg}',`), `${id} doit passer par _onAccountSubmit`);
  }
  // Les anciens branchements clic / touche Entrée ne doivent pas revenir (double envoi)
  for (const btn of ['btn-account-submit', 'btn-account-forgot', 'btn-account-reset',
    'btn-account-change-password', 'btn-account-change-email']) {
    assert.ok(!main.includes(`_onAccountClick('${btn}'`), `${btn} ne doit plus être branché au clic`);
  }
  assert.ok(!/e\.key === 'Enter'\) doSubmit/.test(main), 'plus de gestionnaire Entrée manuel');
});

test('_onAccountSubmit : preventDefault, un seul envoi à la fois, focus sur erreur', () => {
  const start = main.indexOf('function _onAccountSubmit(');
  assert.ok(start !== -1);
  const body = main.slice(start, main.indexOf('\n}\n', start));
  assert.ok(body.includes("addEventListener('submit'"), 'écoute « submit »');
  assert.ok(body.includes('e.preventDefault()'), 'pas de rechargement de page');
  assert.ok(/if \(busy\) return;[\s\S]*busy = true;/.test(body), 'garde contre la double soumission');
  assert.ok(body.includes('btn.disabled = true'), 'bouton désactivé pendant l\'appel');
  assert.ok(body.includes("t('account.err_generic')"), 'erreur réseau : message générique, bouton réactivé');
  assert.ok(body.includes('_accFocusError(form, msgId)'), 'focus rendu au champ en cas d\'erreur');
  const focus = main.slice(main.indexOf('function _accFocusError('));
  assert.ok(focus.includes("setAttribute('aria-describedby', msgId)"), 'message relié aux champs');
});
