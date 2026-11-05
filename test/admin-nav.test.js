/**
 * Navigation du panel admin (#70) : menu groupé construit depuis un registre unique (ADM_NAV), recherche
 * « Aller à une rubrique », menu réductible / déroulant, rubrique retenue dans le fragment d'URL (#50-F),
 * signal d'anomalie réel uniquement. Parcours Chromium : test/e2e/admin-nav.e2e.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/admin/admin.css'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');

const ctx = {};
vm.runInNewContext(`${JS.slice(JS.indexOf('const ADM_NAV_GROUPS = ['), JS.indexOf('const admNavItem ='))}
  this.G = ADM_NAV_GROUPS; this.N = ADM_NAV; this.D = ADM_NAV_DEFAULT; this.A = ADM_NAV_ACTIONS;`, ctx);
const DOC = fs.readFileSync(path.join(ROOT, 'docs/admin-navigation.md'), 'utf8');
const sections = [...HTML.matchAll(/<section id="tab-([\w-]+)" class="tab-content/g)].map(m => m[1]);

test('registre : chaque section a exactement une rubrique, et inversement', () => {
  const ids = ctx.N.map(t => t.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'identifiants uniques');
  assert.deepStrictEqual([...ids].sort(), [...sections].sort());
  assert.ok(ids.includes(ctx.D), 'rubrique par défaut connue');
  for (const t of ctx.N) {
    assert.match(t.id, /^[a-z-]+$/, t.id);   // admTabBtn n'accepte que ce format (fragment d'URL)
    assert.ok(t.label && t.icon && Number.isFinite(t.order), `${t.id} : libellé, icône, ordre`);
    assert.ok(ctx.G.some(g => g.id === t.group), `${t.id} : groupe ${t.group} inconnu`);
  }
  const orders = ctx.N.map(t => `${t.group}:${t.order}`);
  assert.strictEqual(new Set(orders).size, orders.length, 'ordre sans ex-aequo dans un groupe');
});

test('regroupement demandé : Joueurs & testeurs en tête (recette du 05/11), rubriques à leur place', () => {
  assert.deepStrictEqual([...ctx.G.map(g => g.id)], ['players', 'game', 'competition', 'content', 'visuals', 'ops']);
  const at = id => ctx.N.find(t => t.id === id).group;
  for (const id of ['players', 'security', 'beta']) assert.strictEqual(at(id), 'players', id);
  for (const id of ['blocks', 'rewards', 'upgrades', 'relics', 'missions', 'economy']) assert.strictEqual(at(id), 'game', id);
  for (const id of ['season-overview', 'seasons', 'leagues', 'leaderboard', 'points', 'contest']) assert.strictEqual(at(id), 'competition', id);
  for (const id of ['collections', 'badges', 'events', 'news']) assert.strictEqual(at(id), 'content', id);
  assert.strictEqual(at('icons'), 'visuals');
  for (const id of ['ads', 'config']) assert.strictEqual(at(id), 'ops', id);
  // doublon d'intitulé levé : « Ligues & Saisons » / « Saisons »
  const labels = ctx.N.map(t => t.label);
  assert.strictEqual(new Set(labels).size, labels.length, 'libellés distincts');
  assert.ok(!labels.includes('Saisons') && labels.includes('Saison en cours') && labels.includes('Historique des saisons'));
});

test('chargements branchés : chaque rubrique chargée l\'est par le registre (plus de chaîne de if)', () => {
  assert.doesNotMatch(JS, /btn\.dataset\.tab === '/);
  for (const t of ctx.N) {
    if (!t.load) continue;
    for (const fn of String(t.load).match(/load\w+(?=\()/g)) assert.match(JS, new RegExp(`function ${fn}\\(`), `${t.id} : ${fn}`);
  }
  for (const id of ['news', 'events', 'rewards', 'blocks', 'upgrades', 'missions', 'config', 'season-overview']) {
    assert.ok(ctx.N.find(t => t.id === id).load, `${id} chargé à l'ouverture`);
  }
});

test('HTML : plus aucun lien d\'onglet codé en dur, menu accessible', () => {
  assert.doesNotMatch(HTML, /class="tab-btn/);
  assert.match(HTML, /<nav class="admin-nav" id="admin-nav" aria-label="[^"]+">/);
  assert.match(HTML, /id="nav-menu-btn"[^>]*aria-expanded="false" aria-controls="nav-panel"/);
  assert.match(HTML, /id="nav-collapse-btn"[^>]*aria-pressed="false"/);
  assert.match(HTML, /id="nav-search" type="search"[^>]*aria-label=/);
  assert.match(HTML, /<main class="admin-main" id="admin-main">[\s\S]*<section id="tab-seasons" class="tab-content">[\s\S]*<\/main>/);
  // le menu construit pose aria-expanded / aria-current et n'injecte aucun HTML
  const build = JS.slice(JS.indexOf('function admNavBuild('), JS.indexOf('function admNavSetGroup('));
  assert.doesNotMatch(build, /innerHTML/);
  assert.match(JS, /setAttribute\('aria-expanded', String\(open\)\)/);
  assert.match(JS, /b\.setAttribute\('aria-current', 'page'\)/);
});

test('CSS : plus de bandeau d\'onglets sur plusieurs lignes, menu latéral / déroulant', () => {
  assert.doesNotMatch(CSS, /\.admin-nav \{[^}]*flex-wrap: wrap/);
  assert.match(CSS, /\.admin-shell \{ display: grid; grid-template-columns: 236px minmax\(0, 1fr\);/);
  assert.match(CSS, /\.admin-shell\.nav-collapsed \{ grid-template-columns: 58px/);
  assert.match(CSS, /@media \(max-width: 900px\) \{\n  \.admin-shell, \.admin-shell\.nav-collapsed \{ display: block; \}/);
  assert.match(CSS, /\.nav-panel \{ display: none; \}\n  \.admin-nav\.is-open \.nav-panel \{ display: block;/);
  // libellés masqués visuellement en mode icônes, pas supprimés (lecteurs d'écran)
  assert.match(CSS, /\.nav-collapsed \.tab-btn \.nav-lbl \{ position: absolute; width: 1px; height: 1px; overflow: hidden; clip:/);
});

test('rubrique retenue dans l\'URL sans entrée d\'historique ; préférences seulement visuelles en local', () => {
  assert.match(JS, /history\.replaceState\(null, '', `\$\{location\.pathname\}\$\{location\.search\}#\$\{id\}\$\{sub\}`\)/);
  assert.doesNotMatch(JS, /history\.pushState/);
  const prefs = JS.slice(JS.indexOf('function admNavPrefs('), JS.indexOf('const admNavFold'));
  assert.match(prefs, /collapsed: !!p\.collapsed, closed: Array\.isArray\(p\.closed\)/);
  // la rubrique courante ne passe pas par le stockage local
  assert.strictEqual((JS.match(/localStorage\./g) || []).length, 2);
});

test('signal d\'anomalie : uniquement sur des faits serveur (pas de faux signal hors ligne)', () => {
  assert.match(JS, /if \(ok \|\| status === 404\) admNavFlag\('season-overview', ok \? null : 'aucune saison active'\);/);
  // Une suspension volontaire n'est pas un incident : le ⚠ des Améliorations ne dépend que de l'échec du chargement.
  assert.match(JS, /if \(ok \|\| status >= 500\) admNavFlag\('upgrades', ok \? null : 'chargement du catalogue impossible \(erreur serveur\)'\);/);
  assert.doesNotMatch(JS, /admNavFlag\('upgrades', suspended/);
  assert.strictEqual((JS.match(/admNavFlag\('/g) || []).length, 2, 'aucun autre signal');
});

test('recherche « Aller à une rubrique » : sans accents, par libellé, groupe ou mot-clé', () => {
  const fold = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const find = q => [...ctx.N].filter(t => fold(`${t.label} ${t.id} ${ctx.G.find(g => g.id === t.group).label} ${t.keywords ?? ''}`).includes(fold(q))).map(t => t.id);
  assert.deepStrictEqual(find('mensuel'), ['events']);
  assert.deepStrictEqual(find('evenement'), ['news', 'microbonus', 'events', 'collections', 'badges'], 'nom du groupe : toutes ses rubriques');
  assert.ok(find('ligues & saisons').includes('season-overview'), 'ancien intitulé retrouvé');
  assert.ok(find('missions').includes('missions'));
  assert.deepStrictEqual(find('amelio'), ['upgrades']);
  assert.ok(find('visuels').includes('icons'));
  assert.match(JS, /admNavFold\(`\$\{t\.label\} \$\{t\.id\} \$\{g\.label\} \$\{t\.keywords \?\? ''\} \$\{subs\}`\)\.includes\(f\)/);
});

test('rubrique Joueurs distincte : recherche du pseudo en tête, fiche avec essais de test et anti-bot', () => {
  const sec = HTML.slice(HTML.indexOf('<section id="tab-players"'), HTML.indexOf('</section>', HTML.indexOf('<section id="tab-players"')));
  const eco = HTML.slice(HTML.indexOf('<section id="tab-economy"'), HTML.indexOf('</section>', HTML.indexOf('<section id="tab-economy"')));
  assert.ok(sec.indexOf('id="player-search-input"') > 0 && sec.indexOf('id="player-search-input"') < sec.indexOf('id="player-detail-card"'), 'recherche avant la fiche');
  for (const id of ['player-detail-card', 'pd-sec-tests', 'btn-tr-reset', 'pd-sec-partial', 'btn-pd-antibot', 'btn-pd-goto-tests', 'tr-dialog', 'players-hint']) assert.match(sec, new RegExp(`id="${id}"`), id);
  assert.doesNotMatch(eco, /player-search-input|player-detail-card|Debug joueur/, 'plus rien du joueur dans Économie');
  // le dialogue de confirmation n'est pas dans une section repliable
  const card = sec.slice(sec.indexOf('id="player-detail-card"'), sec.indexOf('id="tr-dialog"'));
  assert.strictEqual((card.match(/<details/g) || []).length, (card.match(/<\/details>/g) || []).length);
  assert.match(sec, /<details class="pd-sec" id="pd-sec-tests" open>/);
  assert.match(sec, /<details class="pd-sec" id="pd-sec-partial">/, 'réinitialisation partielle repliée par défaut');
  assert.match(JS, /secOpenPlayer\(String\(_currentPlayerId\), e\.currentTarget\)/);
});

test('Économie : sous-rubriques séparées (gains, registre, règles, boutique en gemmes)', () => {
  const eco = ctx.N.find(t => t.id === 'economy');
  assert.strictEqual(eco.label, 'Économie');
  assert.deepStrictEqual([...eco.subs.map(s => s.id)], ['gains', 'ledger', 'rules', 'gemshop']);
  const sec = HTML.slice(HTML.indexOf('<section id="tab-economy"'), HTML.indexOf('</section>', HTML.indexOf('<section id="tab-economy"')));
  for (const s of eco.subs) assert.match(sec, new RegExp(`data-sub="${s.id}"`), s.id);
  assert.match(sec, /id="gem-ledger-card" data-sub="ledger"/);
  assert.match(sec, /id="btn-save-economy"/);
  for (const t of ctx.N) for (const s of t.subs ?? []) assert.match(s.id, /^[a-z-]+$/);
  assert.match(CSS, /\.sub-hidden \{ display: none !important; \}/);
});

test('actions courantes : cible existante, rubrique connue, jamais de clic ni de déclenchement', () => {
  const ids = ctx.A.map(a => a.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  for (const a of ctx.A) {
    assert.match(a.id, /^[a-z-]+$/, a.id);
    const t = ctx.N.find(x => x.id === a.tab);
    assert.ok(t, `${a.id} : rubrique ${a.tab}`);
    if (a.sub) assert.ok(t.subs?.some(s => s.id === a.sub), `${a.id} : sous-rubrique ${a.sub}`);
    assert.ok(a.label && a.help, `${a.id} : libellé et aide`);
    const sec = HTML.slice(HTML.indexOf(`<section id="tab-${a.tab}"`), HTML.indexOf('</section>', HTML.indexOf(`<section id="tab-${a.tab}"`)));
    assert.match(sec, new RegExp(`id="${a.target}"`), `${a.id} : cible #${a.target} dans la rubrique ${a.tab}`);
    if (a.sub) assert.match(sec, new RegExp(`id="${a.target}"[^>]*>[\\s\\S]*`), a.id);
  }
  for (const want of ['find-player', 'reset-test', 'player-antibot', 'invite', 'gains']) assert.ok(ids.includes(want), want);
  // les actions n'amènent qu'au bon endroit : ni click(), ni appel serveur dans admNavRun / admNavPoint
  const run = JS.slice(JS.indexOf('function admNavRun('), JS.indexOf('function admNavSetGroup('));
  assert.doesNotMatch(run, /\.click\(\)|api\(|fetch\(|\.submit\(/);
  assert.match(JS, /admNavOpen\(a\.tab, a\.sub\)/);
});

test('recherche : trouve les actions et sous-rubriques (pas seulement les rubriques)', () => {
  const fold = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const targets = [];
  for (const t of ctx.N) for (const s of t.subs ?? []) targets.push({ id: `${t.id}/${s.id}`, tab: t.id, label: s.label, keywords: s.keywords, path: t.label });
  for (const a of ctx.A) targets.push({ ...a, path: ctx.N.find(t => t.id === a.tab).label });
  const hay = r => fold(`${r.label} ${r.keywords ?? ''} ${r.path} ${ctx.G.find(g => g.id === ctx.N.find(t => t.id === r.tab).group).label}`);
  const find = q => targets.filter(r => hay(r).includes(fold(q))).map(r => r.id);
  assert.strictEqual(find('recommencer')[0], 'reset-test');
  assert.ok(find('reset').includes('reset-test'));
  assert.strictEqual(find('joueur')[0], 'find-player', '« joueur » : d\'abord trouver un joueur');
  assert.ok(find('anti-bot').includes('player-antibot'));
  assert.ok(find('invitation').includes('invite'));
  assert.ok(find('gains').includes('gains'));
  assert.ok(find('registre').includes('economy/ledger'));
  assert.match(JS, /const admNavHay = r => admNavFold\(`\$\{r\.label\} \$\{r\.keywords \?\? ''\} \$\{r\.path\}/);
  // Entrée : premier résultat, actions en tête
  assert.ok(HTML.indexOf('id="nav-actions"') < HTML.indexOf('id="nav-groups"'));
});

test('plan intégré et document de navigation à jour (toutes rubriques, sous-rubriques et actions)', () => {
  assert.match(HTML, /id="nav-plan-btn"[^>]*aria-haspopup="dialog"/);
  assert.match(HTML, /<dialog id="nav-plan-dialog"/);
  const plan = JS.slice(JS.indexOf('function admNavPlanOpen('), JS.indexOf("document.getElementById('nav-plan-btn')"));
  assert.doesNotMatch(plan, /innerHTML/);
  for (const t of ctx.N) {
    assert.ok(DOC.includes(t.label) && DOC.includes(`\`#${t.id}\``), `doc : rubrique ${t.id}`);
    for (const s of t.subs ?? []) assert.ok(DOC.includes(s.label) && DOC.includes(`\`#${t.id}/${s.id}\``), `doc : ${t.id}/${s.id}`);
  }
  for (const a of ctx.A) assert.ok(DOC.includes(a.label) && DOC.includes(`\`#a/${a.id}\``), `doc : action ${a.id}`);
  for (const g of ctx.G) assert.ok(DOC.includes(g.label), `doc : groupe ${g.id}`);
});
