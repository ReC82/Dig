/**
 * Mise en page commune du panel admin et refonte de ⚙ Config (#62) :
 * - un seul conteneur pour tous les onglets : 1440 px max, centré, plus aucune largeur fixée onglet par onglet ;
 * - Config : chaque réglage connu est classé (catégorie ou « Avancé »), libellé humain + clé technique en petit,
 *   bornes et options cohérentes avec la validation du serveur, obsolètes en lecture seule ;
 * - l'enregistrement n'envoie QUE les réglages modifiés (aucune réécriture des autres valeurs) ;
 * - Budget IA : l'état (bloqué ou non) passe avant les montants.
 * Parcours Chromium (1920, 1440, 1280, 390 px) : test/e2e/admin-layout.e2e.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/admin/admin.css'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');
const DBJS = fs.readFileSync(path.join(ROOT, 'server/db.js'), 'utf8');
const fn = name => { const i = JS.search(new RegExp(`(async )?function ${name}\\(`)); assert.ok(i >= 0, name); return JS.slice(i, JS.indexOf('\n}\n', i) + 2); };

process.env.DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dig-62-')), 'unit.sqlite');
const antibot = require('../server/antibot');
const economy = require('../server/economy');
const seasonThemes = require('../server/seasonThemes');

// Définitions de l'admin évaluées telles quelles
const slice = (from, to) => JS.slice(JS.indexOf(from), JS.indexOf(to));
const ctx = {};
vm.runInNewContext(`${slice('const CONFIG_GROUPS = [', 'function cfgField(')}; this.G = CONFIG_GROUPS; this.L = CONFIG_LEGACY;`, ctx);
const FIELDS = Object.assign({}, ...ctx.G.map(g => g.fields));

test('conteneur commun : 1440 px max, centré, aucune largeur propre à un onglet', () => {
  assert.match(CSS, /\n\.tab-content \{ width: 100%; max-width: 1440px; margin-inline: auto;/);
  assert.doesNotMatch(CSS, /max-width: 960px/);
  assert.doesNotMatch(CSS, /#tab-[\w-]+\.tab-content \{[^}]*max-width/, 'plus d\'exception par onglet');
  // paragraphes à largeur de lecture, pas étirés sur 1440 px
  assert.match(CSS, /\.tab-content > p, \.tab-content \.overview-card > p, \.tab-content details > p \{ max-width: 110ch; \}/);
  // chaque onglet utilise ce conteneur
  const sections = [...HTML.matchAll(/<section id="tab-([\w-]+)" class="tab-content/g)].map(m => m[1]);
  const tabs = [...HTML.matchAll(/data-tab="([\w-]+)"/g)].map(m => m[1]);
  for (const t of tabs) assert.ok(sections.includes(t), t);
});

test('Config : chaque réglage créé par le serveur est classé et libellé', () => {
  const keys = [...DBJS.matchAll(/cfgStmt\.run\('(\w+)'/g)].map(m => m[1]);
  keys.push('season_themes_public', 'season_prep_days', 'season_announce_hours');
  assert.ok(keys.length >= 21, keys.length);
  for (const k of keys) {
    const def = FIELDS[k] ?? ctx.L[k];
    assert.ok(def, `${k} non classé`);
    assert.ok(def.label && def.label !== k && def.hint, `${k} : libellé et explication`);
  }
  assert.deepStrictEqual(Object.keys(ctx.L).sort(), ['cps_limit', 'season_duration']);
  for (const k of Object.keys(ctx.L)) assert.ok(!FIELDS[k], `${k} obsolète ne doit pas être modifiable`);
  assert.deepStrictEqual([...ctx.G.map(g => g.id)], ['leagues', 'themes', 'economy', 'protection']);
});

test('Config : options et bornes alignées sur la validation du serveur', () => {
  const check = (k, v) => antibot.validateConfigValue(k, v) ?? seasonThemes.validateConfigValue(k, v) ?? economy.validateEconomyValue(k, v);
  for (const [k, def] of Object.entries(FIELDS)) {
    if (def.type === 'enum') for (const o of def.options) assert.ok(!check(k, o).error, `${k}=${o}`);
    if (def.type === 'bool') for (const o of ['true', 'false']) assert.ok(!check(k, o).error, `${k}=${o}`);
  }
  // antibot_mode : « enforce » refusé par le serveur, donc non proposé
  assert.deepStrictEqual([...FIELDS.antibot_mode.options], ['off', 'shadow']);
  for (const k of ['upgrade_cost_multiplier', 'coin_gain_multiplier', 'fragment_drop_multiplier']) {
    assert.ok(!economy.validateEconomyValue(k, String(FIELDS[k].min)).error && !economy.validateEconomyValue(k, String(FIELDS[k].max)).error, k);
    assert.ok(economy.validateEconomyValue(k, String(FIELDS[k].max + 1)).error, k);
  }
  for (const k of ['season_prep_days', 'season_announce_hours']) {
    assert.ok(!seasonThemes.validateConfigValue(k, String(FIELDS[k].min)).error, k);
    assert.ok(seasonThemes.validateConfigValue(k, String(FIELDS[k].max + 1)).error, k);
  }
});

test('Config : clé technique en petit, valeur inattendue conservée, obsolètes en lecture seule', () => {
  const f = fn('cfgField');
  assert.match(f, /keyEl\.className = 'config-key'/);
  assert.match(f, /label\.htmlFor = id/);
  assert.match(f, /if \(!opts\.some\(\(\[o\]\) => o === v\)\) opts\.unshift\(\[v, `\$\{v\} \(valeur actuelle\)`\]\)/);
  assert.match(f, /if \(readOnly\) input\.disabled = true;\s+else \{ input\.dataset\.key = key; input\.dataset\.orig = v; \}/);
  // clé inconnue : modifiable en texte libre comme avant (aucun réglage masqué)
  assert.match(fn('loadConfig'), /filter\(k => !known\.has\(k\)\)\.map\(k => cfgField\(k, cfg\[k\], null\)\)/);
  assert.match(CSS, /\.config-text \{[^}]*min-width: 0; overflow-wrap: anywhere; \}/);
});

test('Config : enregistrement des seuls réglages modifiés, saisies protégées (#61)', () => {
  const from = JS.indexOf("getElementById('btn-save-config').addEventListener");
  const save = JS.slice(from, JS.indexOf('\n});\n', from));
  assert.match(save, /for \(const input of cfgChanged\(\)\)/);
  assert.match(save, /else input\.dataset\.orig = input\.value;/);
  assert.match(JS, /const cfgChanged = \(\) => \[\.\.\.document\.querySelectorAll\('#config-rows \.config-value\[data-key\]'\)\]\.filter\(i => i\.value !== i\.dataset\.orig\)/);
  assert.match(fn('loadConfig'), /if \(!ok \|\| admZoneDirty\(_cfgZone\)\) return;/);
  // recherche hors de la zone suivie : filtrer ne compte pas comme une saisie
  assert.ok(HTML.indexOf('id="cfg-search"') < HTML.indexOf('<div id="config-rows">'));
  // liens de catégorie : pas de changement du fragment (onglet retenu après F5)
  assert.match(JS, /getElementById\('cfg-jump'\)\.addEventListener\('click', e => \{[\s\S]{0,120}e\.preventDefault\(\)/);
});

test('Budget IA : état de génération d\'abord, coûts avec période et périmètre', () => {
  const f = fn('loadAiBudget');
  assert.ok(f.indexOf('state.textContent = text') < f.indexOf("row(`Coût observé"));
  assert.match(f, /s\.budgetReached \? \['blocked'/);
  assert.match(f, /quotaFull \? \['blocked'/);
  assert.match(f, /data\.job\?\.status === 'running' \? \['busy'/);
  assert.match(f, /mois UTC, tout Dig/);
  assert.match(f, /row\('Dernière image'/);
  assert.match(f, /row\('Limites'/);
  // aucune écriture : lecture seule de l'état
  assert.doesNotMatch(f, /api\('(PUT|POST)'/);
});
