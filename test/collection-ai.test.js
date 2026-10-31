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
    assert.match(JS, new RegExp(`admDialogSetup\\('${id}'\\)`));
  }
  const add = dialog('co-add-dialog');
  assert.match(add, /id="btn-co-add-ai"[\s\S]*Créer une collection avec l'IA/);
  assert.match(add, /id="btn-co-add-series"[\s\S]*Nouvelle série \(manuel\)/);
  assert.match(add, /id="btn-co-add-item"[\s\S]*Nouvel objet \(manuel\)/);
  assert.match(JS, /aiBtn\.disabled = !st\.configured/);
  assert.doesNotMatch(dialog('co-ai-dialog'), /type="checkbox"/, 'pas d\'option d\'image dans la création IA');
  assert.match(dialog('co-item-dialog'), /id="btn-co-i-studio"/, 'illustration une par une via l\'atelier');
});
