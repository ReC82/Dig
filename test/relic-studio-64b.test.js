/**
 * Recette #64-B (10/11) — atelier d'icônes : « Actuelle en jeu » = image réellement servie aux joueurs.
 * Le catalogue PUBLIÉ fait foi (jamais l'image du brouillon) ; sans image publiée, le pictogramme d'origine.
 * « Conserver » d'une relique renvoie vers 🔮 Reliques (et non 📿 Collections). Essai navigateur complet :
 * test/e2e/relic-studio-64b.e2e.js.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'admin.js'), 'utf8');

function extract(re) {
  const m = re.exec(SRC);
  assert.ok(m, `introuvable : ${re}`);
  return m[0];
}

const ctx = vm.createContext({});
vm.runInContext(`${extract(/function icLiveSrc\(t\) \{[\s\S]*?\n\}/)}\n${extract(/const IC_DRAFT_TABS = [^\n]+/)}\n${extract(/const IC_DRAFT_TAB_IDS = [^\n]+/)}\n`
  + 'this.icLiveSrc = icLiveSrc; this.IC_DRAFT_TABS = IC_DRAFT_TABS; this.IC_DRAFT_TAB_IDS = IC_DRAFT_TAB_IDS;', ctx);

test('relique : l\'image du brouillon n\'est jamais montrée comme « en jeu »', () => {
  const t = { kind: 'relic', applicable: true, emoji: '👁', image: '/media/icons/1e6364f6d938f441.webp', publishedImage: null };
  assert.strictEqual(ctx.icLiveSrc(t), null, 'emoji d\'origine');
  assert.strictEqual(ctx.icLiveSrc({ ...t, publishedImage: '/media/icons/aaaaaaaaaaaaaaaa.webp' }), '/media/icons/aaaaaaaaaaaaaaaa.webp');
});

test('bloc : bibliothèque v1 à défaut d\'image publiée ; pictogramme non raccordé : inchangé', () => {
  assert.strictEqual(ctx.icLiveSrc({ kind: 'block', applicable: true, image: '/x.webp', publishedImage: null, v1: { url: '/v1.webp' } }), '/v1.webp');
  assert.strictEqual(ctx.icLiveSrc({ kind: 'item', applicable: true, image: '/x.webp', publishedImage: null, v1: { url: '/v1.webp' } }), null);
  assert.strictEqual(ctx.icLiveSrc({ kind: 'ui', applicable: false, image: null, v1: null }), null);
});

test('« Conserver » : onglet de publication propre à chaque catalogue', () => {
  assert.strictEqual(ctx.IC_DRAFT_TABS.relic, '🔮 Reliques');
  assert.strictEqual(ctx.IC_DRAFT_TAB_IDS.relic, 'relics');
  assert.strictEqual(ctx.IC_DRAFT_TAB_IDS.mission, 'missions');
  assert.match(SRC, /data-tab="\$\{IC_DRAFT_TAB_IDS\[t\.kind\] \?\? 'collections'\}"/);
});

test('fiche atelier : notice « aucune génération nécessaire » et aperçu à la taille de la carte du jeu', () => {
  assert.match(SRC, /Icône actuelle conservée — aucune génération nécessaire/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'admin.css'), 'utf8');
  const game = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
  // Même taille d'emoji que .relic-icon du jeu
  assert.match(game, /\.relic-icon \{\s*font-size: 2\.2rem;/);
  assert.match(css, /\.ic-game-relic-icon \{ font-size: 2\.2rem;/);
});
