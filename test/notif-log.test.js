/**
 * Tests de public/js/notifLog.js (ticket #26) : historique local des notifications,
 * borné, dédupliqué, persistant (localStorage) et tolérant aux erreurs de stockage.
 * Contrôle aussi le branchement dans le jeu (toasts, Paramètres, traductions).
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

function load(store = new Map(), localStorage) {
  localStorage ??= {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  const ctx = vm.createContext({ localStorage, Date, JSON, Math, Number, String, Array });
  vm.runInContext(`${read('public/js/notifLog.js')}\nthis.NL = NotifLog;`, ctx);
  return { NotifLog: ctx.NL, store };
}

test('ajout : plus récent en tête, type explicite ou déduit de l\'icône, texte intégral', () => {
  const { NotifLog } = load();
  NotifLog.add({ icon: '☁️', text: 'Progression mise à jour depuis le serveur (autre appareil ou action admin).', at: 1000 });
  NotifLog.add({ icon: '❌', text: 'Erreur boutique', at: 2000 });
  NotifLog.add({ icon: '🏆', text: 'Nouvelle saison', type: 'info', at: 3000 });
  const list = NotifLog.list();
  assert.deepStrictEqual(list.map(e => e.type), ['info', 'error', 'info']);
  assert.strictEqual(list[2].text, 'Progression mise à jour depuis le serveur (autre appareil ou action admin).');
  assert.strictEqual(list[0].at, 3000);
  assert.strictEqual(NotifLog.typeForIcon('⚠️'), 'warning');
  assert.strictEqual(NotifLog.typeForIcon('🎯'), 'success');
});

test('déduplication : la répétition remonte l\'entrée et incrémente le compteur', () => {
  const { NotifLog } = load();
  NotifLog.add({ icon: '☁️', text: 'Conflit', at: 1000 });
  NotifLog.add({ icon: '🎯', text: 'Quête', at: 2000 });
  NotifLog.add({ icon: '☁️', text: 'Conflit', at: 3000 });
  let list = NotifLog.list();
  assert.strictEqual(list.length, 2);
  assert.deepStrictEqual([list[0].text, list[0].count, list[0].at], ['Conflit', 2, 3000]);
  // Au-delà de la fenêtre : nouvelle entrée
  NotifLog.add({ icon: '☁️', text: 'Conflit', at: 3000 + NotifLog.DEDUP_MS });
  list = NotifLog.list();
  assert.strictEqual(list.length, 3);
  assert.strictEqual(list[0].count, 1);
});

test('borné à MAX entrées et persistant (nouveau chargement = même historique)', () => {
  const store = new Map();
  const { NotifLog } = load(store);
  for (let i = 0; i < NotifLog.MAX + 30; i++) NotifLog.add({ icon: '🎯', text: `m${i}`, at: i });
  assert.strictEqual(NotifLog.list().length, NotifLog.MAX);
  const again = load(store).NotifLog.list();
  assert.strictEqual(again.length, NotifLog.MAX);
  assert.strictEqual(again[0].text, `m${NotifLog.MAX + 29}`);
});

test('effacement, texte vide ignoré, stockage corrompu ou indisponible sans erreur', () => {
  const store = new Map([['dig_notif_log', '{pas du json']]);
  const { NotifLog } = load(store);
  assert.strictEqual(NotifLog.list().length, 0);
  NotifLog.add({ icon: '🎯', text: '   ' });
  assert.strictEqual(NotifLog.list().length, 0);
  NotifLog.add({ icon: '🎯', text: 'ok' });
  NotifLog.clear();
  assert.strictEqual(NotifLog.list().length, 0);

  const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('x'); } };
  const nl = load(undefined, broken).NotifLog;
  assert.doesNotThrow(() => { nl.add({ text: 'a' }); nl.clear(); });
  assert.strictEqual(nl.list().length, 0);
});

test('jeu : toasts historisés, « Sauvegardé » exclu, section Paramètres et traductions', () => {
  const main = read('public/js/main.js');
  assert.match(main, /function showAchievement\(icon, text, type\) \{\s*NotifLog\.add\(/);
  assert.doesNotMatch(main.match(/function showSaveToast\(\) \{[\s\S]*?\n\}/)[0], /NotifLog/);
  assert.match(main, /id="notif-history"/);
  assert.match(main, /escapeHtml\(e\.text\)/);
  assert.match(read('public/css/style.css'), /#view-dig\.hidden \{ display: none; \}/, 'vue Dig masquée hors onglet Dig');
  assert.match(read('public/index.html'), /<script src="js\/notifLog\.js"><\/script>\s*<script src="js\/save\.js">/);

  const i18n = read('public/js/i18n.js');
  for (const key of ['notif_title', 'notif_empty', 'notif_clear', 'notif_clear_confirm', 'notif_type_info',
    'notif_type_success', 'notif_type_warning', 'notif_type_error', 'cloud_resumed', 'cloud_save_error', 'cloud_save_restored']) {
    assert.strictEqual(i18n.split(`${key}:`).length - 1, 3, `clé ${key} en fr/en/nl`);
  }
});
