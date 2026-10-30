/**
 * Tests de la création de blocs assistée par IA, ticket #37 (transport factice : aucun appel réel,
 * aucune dépense) :
 * - proposition : noms FR/EN/NL, paramètres bornés, image stockée (URL persistante), journal ;
 * - corrections par langue, avertissement « traduction = français », régénérations ciblées ;
 * - ajout au BROUILLON seulement (version publiée inchangée), identifiant unique, jamais publié ;
 * - garde-fous : quota, plafond, échec journalisé sans secret, API non configurée (503) ;
 * - routes : protégées (401 sans clé admin), image servie sous /media/blocks/<sha>.webp.
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
const PORT  = process.env.DIG_TEST_PORT_BLOCK_AI || '3149';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-block-ai-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db      = require('../server/db');
const catalog = require('../server/blockCatalog');
const ai      = require('../server/blockAi');

db.initDb();
catalog.init();
ai.init();
const conn = () => db.getDb();

let textCalls = 0;
const fake = {
  text: async ({ kind }) => {
    textCalls += 1;
    const names = { fr: 'Cuivre oxydé', en: 'Oxidised copper', nl: 'Geoxideerd koper' };
    if (kind === 'names') return { data: { names: { ...names, nl: 'Verweerd koper' } } };
    return { data: {
      names, idSuggestion: 'Cuivre oxydé!', category: 'minerai', rarity: 'peu-commun', icon: '🟢<b>',
      color1: '#14532d', color2: 'javascript:1', accent: '#4ade80', hpBase: 1e12, reward: -5, minDepth: 300, weight: 6,
      rationale: 'Entre quartz et argent. <script>', image: { subject: 'An oxidised copper nugget', details: 'Green patina.', palette: 'Palette: green.' },
    } };
  },
  image: async () => ({ webp: Buffer.from(`RIFF-fake-webp-${crypto.randomBytes(4).toString('hex')}`) }),
};
ai.setFakeTransport(fake);

test('proposition IA : noms localisés, paramètres bornés, image persistante, journal', async () => {
  const p = await ai.createProposal({ concept: 'Un minerai de cuivre oxydé vers 300 m' });
  assert.deepStrictEqual(p.names, { fr: 'Cuivre oxydé', en: 'Oxidised copper', nl: 'Geoxideerd koper' });
  assert.strictEqual(p.idSuggestion, 'cuivre_oxyde');
  assert.strictEqual(p.icon, '🟢', 'balises retirées de l\'emoji');
  assert.strictEqual(p.color, 'linear-gradient(145deg,#14532d,#1f2937)', 'couleur invalide remplacée');
  assert.deepStrictEqual([p.hpBase, p.reward], [1e6, 0], 'bornes');
  assert.ok(!p.rationale.includes('<'));
  assert.match(p.image, /^\/media\/blocks\/[a-f0-9]{16}\.webp$/);
  assert.ok(ai.getImage(p.image.slice(14, 30)));
  assert.deepStrictEqual(p.warnings, []);
  assert.deepStrictEqual(ai.listCalls().map(c => [c.kind, c.ok]), [['image', true], ['text', true]]);
  assert.strictEqual(catalog.getDraft(), null, 'aucun brouillon touché');
  assert.throws(() => conn().prepare('DELETE FROM block_ai_calls').run(), /ajout seul/);
  assert.throws(() => conn().prepare('DELETE FROM block_ai_images').run(), /ajout seul/);
});

test('corrections par langue, régénérations ciblées, avertissements de traduction', async () => {
  const [p] = ai.listProposals();
  const q = ai.updateProposal(p.id, { names: { nl: 'Cuivre oxydé' } });
  assert.deepStrictEqual(q.names, { ...p.names, nl: 'Cuivre oxydé' }, 'seule la langue NL change');
  assert.ok(q.warnings.some(w => w.includes('NL identique au français')));
  assert.throws(() => ai.updateProposal(p.id, { category: 'lave' }), /catégorie/);
  const before = q.image;
  const r = await ai.regenerate(p.id, 'names');
  assert.strictEqual(r.names.nl, 'Verweerd koper');
  assert.strictEqual(r.image, before, 'noms seuls : image conservée');
  const i = await ai.regenerate(p.id, 'image');
  assert.notStrictEqual(i.image, before, 'image seule : nouvelle image');
  assert.deepStrictEqual(i.names, r.names, 'image seule : noms conservés');
  assert.ok(ai.getImage(before.slice(14, 30)), 'ancienne image toujours servie');
  await assert.rejects(ai.regenerate(p.id, 'tout'), /names, text ou image/);
});

test('ajout au brouillon seulement, identifiant unique, impact avant publication', async () => {
  const [p] = ai.listProposals();
  const impact = ai.impact(p.id);
  assert.strictEqual(impact[0].depth, 300);
  assert.ok(impact[0].share > 0 && impact[0].avgHp[1] !== impact[0].avgHp[0]);
  const version = catalog.getPublished().version;
  assert.throws(() => ai.addToDraft(p.id, { blockId: 'quartz' }), /existe déjà/);
  const { type } = ai.addToDraft(p.id, { blockId: 'cuivre_oxyde' });
  assert.strictEqual(type.image, p.image);
  assert.strictEqual(catalog.getPublished().version, version, 'jamais publié automatiquement');
  assert.ok(catalog.getDraft().types.some(t => t.id === 'cuivre_oxyde'));
  assert.strictEqual(ai.getProposal(p.id).status, 'in_draft');
  assert.throws(() => ai.addToDraft(p.id), /déjà ajoutée/);
  await assert.rejects(ai.regenerate(p.id, 'image'), /déjà ajoutée/);
  // La publication reste un geste de l'admin ; l'image est acceptée par le catalogue
  const pub = catalog.publishDraft({ note: 'test IA' });
  assert.ok(catalog.getPublished().types.find(t => t.id === 'cuivre_oxyde').image.startsWith('/media/blocks/'));
  assert.strictEqual(pub.version, version + 1);
});

test('gemme créée par IA : pas de gemme premium par défaut ; échec et quota journalisés', async () => {
  fake.text = async () => ({ data: { names: { fr: 'Opale', en: 'Opal', nl: 'Opaal' }, idSuggestion: 'opale', category: 'gemme', rarity: 'epique',
    icon: '🌈', color1: '#a21caf', color2: '#3b0764', accent: '#f0abfc', hpBase: 180, reward: 2800, minDepth: 560, weight: 2,
    rationale: 'x', image: { subject: 'opal', details: '', palette: '' } } });
  const p = await ai.createProposal({ concept: 'opale', withImage: false });
  assert.strictEqual(p.image, null);
  const { type } = ai.addToDraft(p.id);
  assert.strictEqual(type.gemReward, false);
  catalog.discardDraft();

  fake.image = async () => { throw new Error('OpenAI 500 server_error : boom sk-proj-ABCDEFGHIJKLMNOP'); };
  const q = await ai.createProposal({ concept: 'un autre bloc' });
  assert.match(q.imageError, /Échec de l'appel IA/);
  assert.ok(!q.imageError.includes('sk-proj-ABCD'), 'clé masquée');
  const failed = ai.listCalls().find(c => !c.ok);
  assert.ok(failed && !failed.error.includes('sk-proj-ABCD'));
  await assert.rejects(ai.createProposal({ concept: 'x' }), /3 à 500/);
  // Quota journalier
  const ins = conn().prepare("INSERT INTO block_ai_calls (kind, ok, cost_usd) VALUES ('text', 1, 0)");
  for (let i = 0; i < 40; i++) ins.run();
  await assert.rejects(ai.createProposal({ concept: 'encore un bloc' }), e => e.status === 429);
  assert.ok(textCalls > 0);
});

test('API non configurée : statut explicite, génération refusée (503)', async () => {
  ai.setFakeTransport(null);
  const prev = process.env.DIG_OPENAI_CONFIG;
  // Le module lit le chemin au chargement : on vérifie via un processus séparé
  const out = await new Promise(resolve => {
    const child = spawn(process.execPath, ['-e', `
      process.env.DB_FILE = ${JSON.stringify(path.join(dir, 'nocfg.sqlite'))};
      process.env.DIG_OPENAI_CONFIG = ${JSON.stringify(path.join(dir, 'absent.env'))};
      const db = require('./server/db'); db.initDb();
      require('./server/blockCatalog').init();
      const ai = require('./server/blockAi'); ai.init();
      const s = ai.status();
      ai.createProposal({ concept: 'un bloc de test' }).then(() => console.log(JSON.stringify({ s, ok: true })),
        e => console.log(JSON.stringify({ s, status: e.status, msg: e.message })));
    `], { cwd: ROOT, env: { ...process.env, DIG_AI_FAKE: '' } });
    let o = '';
    child.stdout.on('data', d => { o += d; });
    child.on('close', () => resolve(o));
  });
  process.env.DIG_OPENAI_CONFIG = prev;
  const r = JSON.parse(out.trim().split('\n').pop());
  assert.strictEqual(r.s.configured, false);
  assert.match(r.s.reason, /absent\.env|ENOENT|no such file/);
  assert.strictEqual(r.status, 503);
});

test('routes : protégées, mode test, image servie', async (t) => {
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
  for (const [m, u] of [['GET', '/api/admin/blocks/ai'], ['POST', '/api/admin/blocks/ai/proposals'], ['PUT', '/api/admin/blocks/ai/proposals/1'],
    ['POST', '/api/admin/blocks/ai/proposals/1/regenerate'], ['GET', '/api/admin/blocks/ai/proposals/1/impact'],
    ['POST', '/api/admin/blocks/ai/proposals/1/draft'], ['DELETE', '/api/admin/blocks/ai/proposals/1']]) {
    assert.strictEqual((await call(m, u, m === 'GET' ? undefined : {}, { auth: false })).status, 401, `${m} ${u}`);
  }
  const st = await call('GET', '/api/admin/blocks/ai');
  assert.deepStrictEqual([st.status, st.body.status.configured, st.body.status.fake], [200, true, true]);
  const p = await call('POST', '/api/admin/blocks/ai/proposals', { concept: 'basalte lunaire' });
  assert.strictEqual(p.status, 200, JSON.stringify(p.body));
  const img = await fetch(BASE + p.body.proposal.image);
  assert.strictEqual(img.status, 200);
  assert.match(img.headers.get('cache-control'), /immutable/);
  assert.strictEqual((await fetch(`${BASE}/media/blocks/0123456789abcdef.webp`)).status, 404);
  assert.strictEqual((await fetch(`${BASE}/media/blocks/..%2Fdig.sqlite`)).status, 404);
  const d = await call('POST', `/api/admin/blocks/ai/proposals/${p.body.proposal.id}/draft`, {});
  assert.deepStrictEqual([d.status, d.body.type.id], [200, 'basalte_lunaire']);
  const view = await call('GET', '/api/admin/blocks');
  assert.strictEqual(view.body.published.version, 3, 'pas de publication automatique');
});

test.after(() => {
  try { db.getDb().close(); } catch (_) {}
  fs.rmSync(dir, { recursive: true, force: true });
});
