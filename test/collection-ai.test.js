/**
 * Collections (#39, demande du propriétaire du 31/10) — UX commune du panel et création assistée par IA
 * (transport factice : aucun appel réel, aucune dépense) :
 * - proposition en arrière-plan : série + objets, textes FR/EN/NL/ES nettoyés, identifiants uniques ;
 * - drops pré-remplis selon la rareté mais INACTIFS, aucune image générée, consignes reprises par l'atelier ;
 * - corrections sans coût ; ajout au BROUILLON seulement (version publiée inchangée), jamais publié ;
 * - garde-fous partagés avec #37 (quota, plafond) ; appel interrompu affiché comme tel ;
 * - routes protégées (401) et parcours HTTP complet ; onglet : données d'abord, « ＋ Ajouter » en fiche.
 * Lancer : npm test
 */

'use strict';

const test     = require('node:test');
const assert   = require('node:assert');
const crypto   = require('crypto');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const { spawn } = require('child_process');

const ROOT  = path.join(__dirname, '..');
const PORT  = process.env.DIG_TEST_PORT_COLLECTION_AI || '3165';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-collection-ai-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db      = require('../server/db');
const blockAi = require('../server/blockAi');
const catalog = require('../server/collectionCatalog');
const studio  = require('../server/iconStudio');
const ai      = require('../server/collectionAi');

db.initDb();
blockAi.init();
catalog.init();
studio.init();
ai.init();
const conn = () => db.getDb();

const texts = (fr, en, nl, es) => ({ fr, en, nl, es });
let jsonCalls = 0;
let answer = null;
const reply = () => ({
  series: { idSuggestion: 'Trésors du givre!', names: texts('Trésors du givre', 'Frost treasures', 'Schatten van de rijp', 'Tesoros de la escarcha'),
    icon: '❄️<b>', theme: 'Hiver <script>' },
  items: [
    { idSuggestion: 'flocon', names: texts('Flocon éternel', 'Eternal snowflake', 'Eeuwige sneeuwvlok', 'Copo eterno'),
      stories: texts('Il ne fond <jamais>.', 'It never melts.', 'Hij smelt nooit.', 'Nunca se derrite.'), rarity: 'commun', icon: '❄️',
      image: { subject: 'A single eternal snowflake charm', details: 'Six branches.', palette: 'Palette: ice blue.' } },
    { idSuggestion: 'flocon', names: texts('Flocon jumeau', 'Twin snowflake', 'Tweelingvlok', 'Copo gemelo'),
      stories: texts('Son frère.', 'Its brother.', 'Zijn broer.', 'Su hermano.'), rarity: 'legendaire', icon: '💎',
      image: { subject: 'A twin snowflake', details: '', palette: '' } },
    { idSuggestion: 'fossil', names: texts('Luge', 'Sled', 'Slee', 'Trineo'), stories: texts('Vite.', 'Fast.', 'Snel.', 'Rápido.'),
      rarity: 'inventée', icon: '🛷', image: { subject: 'A tiny sled', details: '', palette: '' } },
  ],
  rationale: 'Thème hivernal.',
});
blockAi.setFakeTransport({
  text: async () => { throw new Error('inutilisé'); },
  image: async () => { throw new Error('aucune image ne doit être générée'); },
  json: async ({ name, messages }) => {
    jsonCalls += 1;
    assert.strictEqual(name, 'dig_collection');
    assert.match(messages[0].content, /exactly 3 items/);
    assert.match(messages[0].content, /Do NOT propose drop rates/);
    return { data: answer ?? reply(), usage: { prompt_tokens: 1000, completion_tokens: 800 } };
  },
});

async function propose(input) {
  const { proposal, job } = ai.startProposal(input);
  assert.strictEqual(proposal.status, 'pending', 'réponse immédiate, génération en arrière-plan');
  await job.catch(() => {});
  return ai.getProposal(proposal.id);
}

test('proposition : série + objets nettoyés, identifiants uniques, drops inactifs pré-remplis par rareté', async () => {
  const p = await propose({ concept: 'Des trésors gelés pour l\'hiver', itemCount: 3 });
  assert.strictEqual(p.status, 'open', p.error);
  assert.strictEqual(jsonCalls, 1);
  const { series, items } = p.data;
  assert.strictEqual(series.id, 'tresors_du_givre');
  assert.strictEqual(series.icon, '📦', 'emoji invalide (balise) remplacé');
  assert.doesNotMatch(series.theme + items[0].stories.fr, /[<>]/);
  assert.deepStrictEqual(items.map(i => i.id), ['flocon', 'flocon_2', 'fossil']);
  assert.strictEqual(items[2].rarity, 'commun', 'rareté inconnue ramenée à commun');
  assert.deepStrictEqual(items[1].drop, ai.DEFAULT_DROPS.legendaire);
  assert.ok(p.warnings.some(w => /« fossil » déjà utilisé/.test(w)), 'collision avec un objet existant signalée');
  const calls = conn().prepare("SELECT kind, ok FROM block_ai_calls WHERE kind = 'collection-text'").all();
  assert.deepStrictEqual(calls, [{ kind: 'collection-text', ok: 1 }], 'appel journalisé (journal partagé #37)');
});

test('corrections sans coût, puis brouillon seulement : version publiée inchangée, drops inactifs, consignes atelier', async () => {
  const p = await propose({ concept: 'Trésors gelés', itemCount: 3 });
  const before = jsonCalls;
  assert.throws(() => ai.addToDraft(p.id), /déjà utilisé/);
  const items = p.data.items.map(i => (i.id === 'fossil' ? { ...i, id: 'luge_givree' } : i));
  items[0] = { ...items[0], names: { ...items[0].names, nl: 'Eeuwig vlokje' } };
  const q = ai.updateProposal(p.id, { series: { ...p.data.series, id: 'givre' }, items });
  assert.strictEqual(jsonCalls, before, 'aucun appel IA pour une correction');
  assert.strictEqual(q.data.items[0].names.nl, 'Eeuwig vlokje');
  const v = catalog.getPublished().version;
  const r = ai.addToDraft(p.id);
  assert.deepStrictEqual(r.items, ['flocon', 'flocon_2', 'luge_givree']);
  assert.strictEqual(catalog.getPublished().version, v, 'jamais publié automatiquement');
  const draft = catalog.getDraft();
  assert.ok(draft.series.some(s => s.id === 'givre' && s.seasonId === null));
  const added = draft.items.filter(i => i.seriesId === 'givre');
  assert.strictEqual(added.length, 3);
  assert.ok(added.every(i => i.dropEnabled === false && i.image === null), 'drops inactifs, aucune image');
  assert.strictEqual(catalog.validateContent(draft).errors.length, 0);
  assert.match(studio.getTarget('item:flocon').brief.subject, /eternal snowflake/, 'consigne reprise par l\'atelier');
  assert.strictEqual(ai.getProposal(p.id).status, 'in_draft');
  assert.throws(() => ai.updateProposal(p.id, {}), /déjà enregistrée/);
  assert.throws(() => ai.addToDraft(p.id), /déjà enregistrée/);
});

test('recette du 02/11 (atelier) : consigne répétée pour plusieurs objets signalée, non reprise ; repli nom + histoire', async () => {
  const lantern = { subject: 'Worn brass miner\'s lantern', details: 'A small tarnished brass lantern.', palette: 'Palette: amber.' };
  const r = reply();
  r.series.idSuggestion = 'vieille_mine';
  r.items = r.items.slice(0, 3).map((i, k) => ({ ...i, idSuggestion: ['lanterne_t', 'boussole_t', 'crayon_t'][k], image: k < 2 ? lantern : { subject: 'A stubby pencil', details: 'Chewed end.', palette: '' } }));
  answer = r;
  try {
    const p = await propose({ concept: 'Trésors de la vieille mine', itemCount: 3 });
    assert.ok(p.warnings.some(w => /Consigne d'illustration identique pour « Flocon éternel », « Flocon jumeau »/.test(w)), p.warnings.join(' | '));
    ai.addToDraft(p.id);
  } finally { answer = null; }
  assert.strictEqual(studio.getTarget('item:lanterne_t').brief.custom, false, 'consigne répétée non reprise');
  assert.match(studio.getTarget('item:lanterne_t').brief.subject, /twin snowflake|eternal snowflake/i, 'repli : nom de l\'objet');
  const crayon = studio.getTarget('item:crayon_t');
  assert.deepStrictEqual([crayon.brief.custom, crayon.brief.subject, crayon.briefSharedWith], [true, 'A stubby pencil', []]);
  // Consignes déjà enregistrées à l'identique (cas de la production) : signalées, repli proposé
  // (écrites en une fois par l'importation d'avant le garde-fou) : ignorées, signalées, repli proposé
  const ins = db.getDb().prepare("INSERT OR REPLACE INTO icon_studio_briefs (target, subject, details, palette, updated_at) VALUES (?, ?, ?, ?, '2026-11-02 14:33:58')");
  for (const k of ['lanterne_t', 'boussole_t']) ins.run(`item:${k}`, lantern.subject, lantern.details, lantern.palette);
  const t = studio.getTarget('item:boussole_t');
  assert.deepStrictEqual([t.briefSharedWith, t.briefIgnored, t.brief.custom], [['lanterne_t'], true, false]);
  assert.doesNotMatch(t.prompt, /lantern/i, 'la consigne répétée n\'entre pas dans le prompt');
  assert.match(t.defaultBrief.subject, /^A single .*usual real-world shape$/, 'consigne par défaut v1.3 : l\'objet seul, sous sa forme réelle');
  assert.strictEqual(t.neverPublished, true, 'objet du brouillon jamais publié : pas « en jeu »');
});

test('validations : description, nombre d\'objets, saison inconnue ; abandon', async () => {
  assert.throws(() => ai.startProposal({ concept: 'a' }), /Décrivez/);
  assert.throws(() => ai.startProposal({ concept: 'hiver', itemCount: 12 }), /entre 3 et 8/);
  assert.throws(() => ai.startProposal({ concept: 'hiver', itemCount: 3, seasonId: 999 }), /introuvable/);
  const p = await propose({ concept: 'Trésors gelés', itemCount: 3 });
  ai.discardProposal(p.id);
  assert.ok(!ai.listProposals().some(x => x.id === p.id));
});

test('échec IA : état « error » sans écriture au catalogue ; appel interrompu par un redémarrage affiché', async () => {
  answer = { series: {}, items: [], rationale: '' };
  const draftBefore = JSON.stringify(catalog.getDraft());
  const p = await propose({ concept: 'Rien du tout', itemCount: 3 });
  answer = null;
  assert.strictEqual(p.status, 'error');
  assert.match(p.error, /aucun objet/);
  assert.strictEqual(JSON.stringify(catalog.getDraft()), draftBefore);
  const id = conn().prepare("INSERT INTO collection_ai_proposals (concept, params) VALUES ('x', '{}')").run().lastInsertRowid;
  const q = ai.getProposal(id);
  assert.deepStrictEqual([q.status, /interrompue/.test(q.error)], ['error', true]);
});

test('directive éditoriale du 02/11 : prompt (humour ancré, variété, pas de faux faits, évocation), clin d\'œil et relecture', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'collectionAi.js'), 'utf8');
  for (const re of [/EDITORIAL LINE/, /absurd but recognisable wink anchored in some reality/, /DIFFERENT reference/,
    /Never present invented history as fact/, /evoke or parody/, /clearly different silhouette/, /self-review/]) assert.match(src, re);
  const r = reply();
  r.items[0].reference = 'Folklore : un clin d\'œil.';
  r.review = 'Variété correcte.';
  answer = r;
  return propose({ concept: 'Givre', itemCount: 3 }).then(p => {
    answer = null;
    assert.strictEqual(p.data.review, 'Variété correcte.');
    assert.strictEqual(p.data.items[0].reference, 'Folklore : un clin d\'œil.');
    assert.ok(p.warnings.some(w => /Clin d'œil non précisé pour « Flocon jumeau », « Luge »/.test(w)), p.warnings.join(' | '));
    const q = ai.updateProposal(p.id, { items: p.data.items.map(i => ({ ...i, reference: i.reference || 'Source.' })) });
    assert.strictEqual(q.data.review, 'Variété correcte.', 'relecture conservée après correction');
    assert.ok(q.data.items.every(i => i.reference));
    ai.discardProposal(p.id);
  }).finally(() => { answer = null; });
});

test('contrôles de qualité : consignes et histoires trop proches, noms en double ; collection variée sans alerte', async () => {
  assert.strictEqual(ai.similarity('A brass lantern with soot', 'A brass lantern with soot'), 1);
  assert.strictEqual(ai.similarity('A round orange fruit', 'A tall granite standing stone'), 0);
  const r = reply();
  r.series.idSuggestion = 'clones';
  const img = k => ({ subject: `An old rusty miner lantern number ${k}`, details: 'Old rusty miner lantern with glass panes and handle.', palette: 'Palette: amber.' });
  r.items = r.items.map((i, k) => ({ ...i, idSuggestion: `clone_${k}`, reference: 'Source.', image: img(k),
    names: k === 2 ? r.items[0].names : i.names,
    stories: texts('On raconte que cette vieille lanterne éclairait les mineurs perdus de la galerie.', 'x', 'x', 'x') }));
  answer = r;
  try {
    const p = await propose({ concept: 'Clones', itemCount: 3 });
    const w = p.warnings.join(' | ');
    assert.match(w, /Consignes d'illustration très proches pour « Flocon éternel » et « Flocon jumeau »/);
    assert.match(w, /Histoires FR très proches/);
    assert.match(w, /Nom FR identique pour « Flocon éternel », « Flocon éternel »/);
    ai.discardProposal(p.id);
  } finally { answer = null; }
});

test('garde-fous partagés : quota journalier', async () => {
  const ins = conn().prepare("INSERT INTO block_ai_calls (kind, ok, cost_usd) VALUES ('text', 1, 0)");
  for (let i = 0; i < 40; i++) ins.run();
  assert.throws(() => ai.startProposal({ concept: 'hiver', itemCount: 3 }), e => e.status === 429 && /Quota/.test(e.message));
});

test('routes : protégées, parcours complet, aucune publication', async (t) => {
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, DIG_AI_FAKE: '1', NODE_ENV: 'test', SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: path.join(dir, 'http.sqlite'),
      ADMIN_SECRET: ADMIN, SESSION_SECRET: crypto.randomBytes(16).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', d => { log += d; });
  server.stderr.on('data', d => { log += d; });
  t.after(() => server.kill());
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { await fetch(`${BASE}/api/version`); up = true; } catch (_) { await new Promise(r => setTimeout(r, 100)); }
  }
  assert.ok(up, `serveur de test non démarré :\n${log}`);
  const call = async (method, url, body, { auth = true } = {}) => {
    const res = await fetch(BASE + url, { method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${ADMIN}` } : {}) } });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  for (const [m, u] of [['GET', '/api/admin/collections/ai'], ['POST', '/api/admin/collections/ai/proposals'], ['GET', '/api/admin/collections/ai/proposals/1'],
    ['PUT', '/api/admin/collections/ai/proposals/1'], ['POST', '/api/admin/collections/ai/proposals/1/draft'], ['DELETE', '/api/admin/collections/ai/proposals/1']]) {
    assert.strictEqual((await call(m, u, m === 'GET' ? undefined : {}, { auth: false })).status, 401, `${m} ${u}`);
  }
  const st = await call('GET', '/api/admin/collections/ai');
  assert.deepStrictEqual([st.status, st.body.status.configured, st.body.status.fake, st.body.proposals.length], [200, true, true, 0]);
  assert.strictEqual((await call('POST', '/api/admin/collections/ai/proposals', { concept: 'x' })).status, 400);
  const p = await call('POST', '/api/admin/collections/ai/proposals', { concept: 'trésors gelés', itemCount: 4 });
  assert.deepStrictEqual([p.status, p.body.proposal.status], [200, 'pending'], JSON.stringify(p.body));
  let ready = null;
  for (let i = 0; i < 50 && !ready; i++) {
    const v = await call('GET', `/api/admin/collections/ai/proposals/${p.body.proposal.id}`);
    if (v.body.proposal.status !== 'pending') ready = v.body.proposal; else await new Promise(r => setTimeout(r, 100));
  }
  assert.strictEqual(ready?.status, 'open', JSON.stringify(ready));
  assert.strictEqual(ready.data.items.length, 4);
  const d = await call('POST', `/api/admin/collections/ai/proposals/${ready.id}/draft`, {});
  assert.deepStrictEqual([d.status, d.body.series.id], [200, 'tresors_givre'], JSON.stringify(d.body));
  const view = await call('GET', '/api/admin/collections');
  assert.strictEqual(view.body.published.version, 1, 'pas de publication automatique');
  assert.strictEqual(view.body.draft.drops.length, 0, 'aucun drop actif ajouté');
  assert.strictEqual((await call('GET', '/api/admin/collections/ai/proposals/9999')).status, 404);
});

// ── Onglet 📿 Collections : données d'abord, « ＋ Ajouter » en fiche ───────────

const JS = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');
const section = (() => { const a = HTML.indexOf('<section id="tab-collections"'); return HTML.slice(a, HTML.indexOf('</section>', a)); })();
const dialog = id => { const m = section.match(new RegExp(`<dialog id="${id}"[\\s\\S]*?</dialog>`)); assert.ok(m, id); return m[0]; };

test('onglet Collections : aucun champ de création hors fiche, un seul « ＋ Ajouter », lignes cliquables', () => {
  const visible = section.replace(/<dialog[\s\S]*?<\/dialog>/g, '');
  for (const f of ['co-s-id', 'co-s-name-fr', 'co-i-id', 'co-i-name-fr', 'co-i-story-fr', 'co-i-chance', 'co-ai-concept']) {
    assert.doesNotMatch(visible, new RegExp(`id="${f}"`), `${f} visible hors fiche`);
  }
  const btns = [...visible.matchAll(/<button class="btn btn-primary" id="([^"]+)"[^>]*>＋ Ajouter[^<]*<\/button>/g)].map(m => m[1]);
  assert.deepStrictEqual(btns, ['btn-co-add']);
  assert.doesNotMatch(section, /Nouveau \(vider|Nouvelle \(vider/);
  assert.match(JS, /admRowOpen\(tr, `co-series:\$\{s\.id\}`/);
  assert.match(JS, /admRowOpen\(tr, `co-item:\$\{i\.id\}`/);
  assert.match(JS, /admRowOpen\(tr, `co-prop:\$\{p\.id\}`/);
  assert.doesNotMatch(JS, /addButtonCell\(tr, 'Modifier', \(\) => coFill/);
  assert.match(visible, /<details class="overview-card hidden" id="co-ai-card">/, 'propositions IA repliées, absentes s\'il n\'y en a pas');
});

test('fiches Collections : fermeture sans effet, choix IA / manuel, IA grisée sans configuration, image jamais automatique', () => {
  for (const id of ['co-add-dialog', 'co-ai-dialog', 'co-prop-dialog', 'co-series-dialog', 'co-item-dialog']) {
    const d = dialog(id);
    assert.match(d, new RegExp(`<dialog id="${id}" class="bk-dialog adm-dialog[^"]*" aria-labelledby="[^"]+">`));
    assert.ok((d.match(/data-close/g) || []).length >= 2, `${id} : ✕ et Annuler/Fermer`);
    assert.match(JS, new RegExp(`admDialogSetup\\('${id}'(, \\{[^\\n]*\\})?\\);`));
  }
  const add = dialog('co-add-dialog');
  assert.match(add, /id="btn-co-add-ai"[\s\S]*Créer une collection avec l'IA/);
  assert.match(add, /id="btn-co-add-series"[\s\S]*Nouvelle série \(manuel\)/);
  assert.match(add, /id="btn-co-add-item"[\s\S]*Nouvel objet \(manuel\)/);
  assert.match(JS, /aiBtn\.disabled = !st\.configured/);
  assert.doesNotMatch(dialog('co-ai-dialog'), /type="checkbox"/, 'pas d\'option d\'image dans la création IA');
  assert.match(dialog('co-item-dialog'), /id="btn-co-i-studio"/, 'illustration une par une via l\'atelier');
});

test('recette du 02/11 : pas de ligne technique IA dans les fiches, détails dans l\'aide repliée', () => {
  const add = dialog('co-add-dialog');
  assert.match(add, /<p id="co-ai-status"/);
  assert.match(JS, /La génération IA peut entraîner un coût ; rien n\\'est publié automatiquement\./);
  // Modèle, budget et quota : uniquement dans « Aide technique » (repliée) de la fiche IA
  const ai = dialog('co-ai-dialog');
  assert.match(ai, /<details[^>]*><summary>Aide technique<\/summary>\s*<p id="co-ai-status-2"><\/p>/);
  const simple = JS.slice(JS.indexOf("document.getElementById('co-ai-status').textContent"), JS.indexOf("document.getElementById('co-ai-status-2').textContent"));
  assert.doesNotMatch(simple, /budget restant|appels sur 24 h|textModel/);
});

test('recette du 02/11 : relecture IA en synthèse puis fiche d\'un objet, une langue à la fois', () => {
  assert.match(JS, /function coPropDrawList\(/);
  assert.match(JS, /function coPropDrawItem\(/);
  assert.match(JS, /admRowOpen\(tr, `co-prop-item:\$\{k\}`/, 'ligne d\'objet ouvrable à la souris et au clavier');
  assert.match(JS, /lang: _coPropWork\?\.lang \?\? 'fr'/, 'FR par défaut');
  assert.match(JS, /_coProp = null; _coPropWork = null;/, 'langue remise à FR à la fermeture');
  assert.match(JS, /admDialogSetup\('co-prop-dialog', \{ dirty: \(\) => !!_coPropWork\?\.dirty/, 'Échap ne perd pas les corrections sans confirmation (#61)');
  // Un seul nom et une seule histoire éditables à l'écran : les quatre langues restent dans la copie de travail
  const item = JS.slice(JS.indexOf('function coPropDrawItem('), JS.indexOf('/** Corrections de la copie de travail'));
  assert.doesNotMatch(item, /for \(const l of CO_LANGS\) coField/);
  assert.match(JS, /names: texts\(it\.names\), stories: texts\(it\.stories\)/);
  assert.doesNotMatch(item, /dropEnabled|api\(/, 'aucun drop activé ni appel depuis la fiche d\'objet');
});

test('recette du 02/11 (atelier) : consigne de l\'objet préremplie et modifiable, saisie conservée, jamais de génération automatique', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'server', 'collectionAi.js'), 'utf8'), /Every item has a clearly different silhouette and subject/);
  const sheet = JS.slice(JS.indexOf('function icRenderSheet('), JS.indexOf('function icHistory('));
  assert.match(sheet, /t\.kind === 'item' \|\| t\.kind === 'event' \? icItemBrief\(step, t\)/);   // #65 : objets d'événement aussi
  assert.match(sheet, /IC_HINTS\[t\.kind\]/, 'plus de consigne « minerai » pour un objet');
  assert.match(JS, /item: 'ex\. vue de trois quarts/);
  assert.match(JS, /_icTyped\[t\.key\]\?\.instruction \?\? typed/, 'consigne saisie conservée entre les fiches');
  assert.match(JS, /memo\[k\] \?\? t\.brief\[k\]/, 'description saisie conservée');
  const brief = JS.slice(JS.indexOf('function icItemBrief('), JS.indexOf('/** Enregistre la consigne de l\'objet'));
  assert.doesNotMatch(brief, /generate/, 'aucune génération depuis la consigne');
  assert.match(JS, /← Retour à la fiche de l\\'objet/);
});

test('recette du 02/11 : fiche objet une langue à la fois, statut publication distinct de l\'indicateur activé', () => {
  const d = dialog('co-item-dialog');
  assert.match(d, /id="co-i-langs" role="group"/);
  for (const l of ['fr', 'en', 'nl', 'es']) assert.match(d, new RegExp(`class="co-i-lang${l === 'fr' ? '' : ' hidden'}" data-lang="${l}"`));
  assert.match(d, /Objet activé/);
  assert.match(JS, /coItemLang\('fr'\);\n  _coItemSnap = JSON\.stringify\(coReadItem\(\)\);/, 'FR par défaut à chaque ouverture');
  assert.match(JS, /document\.getElementById\('co-preview-lang'\)\.value = l;/, 'aperçu synchronisé');
  assert.match(JS, /names: coTexts\('co-i-name'\),\n    stories: coTexts\('co-i-story'\)/, 'les quatre langues restent enregistrées ensemble');
  assert.match(JS, /'Brouillon — non publié'/);
  assert.match(JS, /'Publié · modifié dans le brouillon' : 'Publié'/);
  assert.doesNotMatch(JS, /' · nouveau'\}`;\n    const cell = addCell/);
});

test('collection préparée du 02/11 : contenu complet et varié, importée une seule fois dans le brouillon, rien publié', () => {
  const file = path.join(__dirname, '..', 'server', 'content', 'collections', 'objets-trouves-legende.json');
  const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(pack.items.length, 6);
  for (const i of pack.items) {
    for (const l of ['fr', 'en', 'nl', 'es']) {
      assert.ok(i.names[l] && i.names[l].length <= 60, `${i.id} nom ${l}`);
      assert.ok(i.stories[l] && i.stories[l].length <= 320, `${i.id} histoire ${l} (≤ 320)`);
    }
    assert.ok(i.reference && i.image.subject && i.image.details && /^Palette:/.test(i.image.palette), i.id);
  }
  assert.deepStrictEqual(pack.items.map(i => i.rarity).sort(), ['commun', 'commun', 'epique', 'legendaire', 'rare', 'rare']);
  const v = catalog.getPublished().version;
  const res = ai.importPrepared();
  assert.deepStrictEqual(res.map(x => [x.pack, x.status]), [['objets_trouves_legende_v1', 'in_draft']]);
  const prop = ai.getProposal(res[0].proposal);
  assert.deepStrictEqual(prop.warnings, [], 'aucune alerte de qualité');
  assert.match(prop.data.review, /Variété/);
  assert.strictEqual(catalog.getPublished().version, v, 'jamais publié');
  const draft = catalog.getDraft();
  const added = draft.items.filter(i => i.seriesId === 'objets_trouves_legende');
  assert.strictEqual(added.length, 6);
  assert.ok(added.every(i => i.dropEnabled === false && i.image === null), 'drops inactifs, aucune image');
  assert.strictEqual(catalog.validateContent(draft).errors.length, 0);
  const subjects = added.map(i => studio.getTarget(`item:${i.id}`).brief);
  assert.ok(subjects.every(b => b.custom === true), 'consigne propre reprise par l\'atelier pour chaque objet');
  assert.strictEqual(new Set(subjects.map(b => b.subject)).size, 6);
  assert.deepStrictEqual(ai.importPrepared(), [], 'jamais réimportée');
  // Supprimée du brouillon par l'admin : toujours pas réimportée
  for (const i of added) catalog.removeDraftEntry('items', i.id);
  catalog.removeDraftEntry('series', 'objets_trouves_legende');
  assert.deepStrictEqual(ai.importPrepared(), []);
});
