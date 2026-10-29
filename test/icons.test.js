/**
 * Tests de la bibliothèque d'icônes (#22) : rendu legacy/v1 côté jeu, traitement d'image,
 * client OpenAI (sans aucun appel réseau). Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const vm     = require('vm');
const sharp  = require('sharp');

const ROOT = path.join(__dirname, '..');
const IconLibrary = require('../public/js/iconLibrary');
const oa = require('../tools/icons/openai-images');
const { processIcon, checkSource } = require('../tools/icons/process');
const { buildPrompt } = require('../tools/icons/generate');

// ── Environnement DOM minimal ────────────────────────────────────────────────

class FakeEl {
  constructor(tag) { this.tagName = tag; this.children = []; this.attrs = {}; this._text = ''; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(c) { this.children.push(c); return c; }
  contains(c) { return this.children.includes(c); }
}
global.document = { createElement: (t) => new FakeEl(t) };

function loadBlockTypes() {
  const ctx = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public/js/blocks.js'), 'utf8') + '\nthis.TYPES = Blocks.TYPES;', ctx);
  return Array.from(ctx.TYPES, (t) => ({ ...t })); // objets du contexte courant (comparaisons strictes)
}

const memoryStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };

function withLibrary({ config, search = '', storage = memoryStorage() }, fn) {
  const saved = { override: IconLibrary.override, config: IconLibrary.config };
  IconLibrary.config = config;
  IconLibrary.failed = new Set();
  IconLibrary.override = () => saved.override.call(IconLibrary, search, storage);
  try { return fn(); } finally { IconLibrary.override = saved.override; IconLibrary.config = saved.config; }
}

const V1_PIERRE = {
  defaultLibrary: 'v1',
  libraries: { v1: { base: 'assets/icons/v1/', materials: { pierre: { webp: { 128: 'pierre-128.webp', 256: 'pierre-256.webp' } } } } },
};

// ── Rendu en jeu ─────────────────────────────────────────────────────────────

test('14 matériaux réels, identifiants stables', () => {
  const types = loadBlockTypes();
  assert.strictEqual(types.length, 14);
  assert.deepStrictEqual(types.map((t) => IconLibrary.materialId(t)), [
    'terre_meuble', 'argile', 'pierre', 'gres', 'granite', 'charbon', 'minerai_fer', 'minerai_or',
    'vieille_caisse', 'coffre_bois', 'coffre_fer', 'rubis', 'emeraude', 'diamant']);
});

test('legacy par défaut : rendu strictement identique à l\'ancien (texte = emoji, aucun attribut)', () => {
  for (const config of [null, { defaultLibrary: 'legacy' }, { defaultLibrary: 'inconnu' }, { ...V1_PIERRE, defaultLibrary: 'legacy' }]) {
    withLibrary({ config }, () => {
      for (const type of loadBlockTypes()) {
        const el = new FakeEl('span');
        IconLibrary.render(el, type);
        assert.strictEqual(el.textContent, type.icon);
        assert.deepStrictEqual(el.children, []);
        assert.deepStrictEqual(el.attrs, {});
      }
    });
  }
});

test('v1 : image pour la pierre uniquement, les 13 autres matériaux restent en legacy', () => {
  withLibrary({ config: V1_PIERRE }, () => {
    for (const type of loadBlockTypes()) {
      const el = new FakeEl('span');
      IconLibrary.render(el, type);
      if (IconLibrary.materialId(type) === 'pierre') {
        assert.strictEqual(el.attrs['data-icon-lib'], 'v1');
        assert.strictEqual(el.children.length, 1);
        assert.strictEqual(el.children[0].src, 'assets/icons/v1/pierre-128.webp');
        assert.match(el.children[0].srcset, /pierre-256\.webp 2x/);
      } else {
        assert.strictEqual(el.textContent, type.icon, IconLibrary.materialId(type));
        assert.deepStrictEqual(el.attrs, {});
      }
    }
  });
});

test('v1 : image en erreur → repli legacy immédiat et définitif pour la session', () => {
  withLibrary({ config: V1_PIERRE }, () => {
    const pierre = loadBlockTypes().find((t) => IconLibrary.materialId(t) === 'pierre');
    const el = new FakeEl('span');
    IconLibrary.render(el, pierre);
    el.children[0].onerror();
    assert.strictEqual(el.textContent, '🪨');
    assert.deepStrictEqual(el.attrs, {});
    const el2 = new FakeEl('span');
    IconLibrary.render(el2, pierre);
    assert.strictEqual(el2.textContent, '🪨', 'plus de nouvel essai après un échec');
  });
});

test('v1 sans asset dans le manifeste (état actuel) → legacy partout', () => {
  const lib = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/assets/icons/library.json'), 'utf8'));
  assert.strictEqual(lib.defaultLibrary, 'legacy', 'legacy doit rester la valeur par défaut livrée');
  withLibrary({ config: { ...lib, defaultLibrary: 'v1' } }, () => {
    for (const type of loadBlockTypes()) {
      const el = new FakeEl('span');
      IconLibrary.render(el, type);
      if (!lib.libraries.v1.materials[IconLibrary.materialId(type)]) assert.strictEqual(el.textContent, type.icon);
    }
  });
});

test('surcharge par navigateur : ?icons=v1 / legacy mémorisé, ?icons=default efface', () => {
  const storage = memoryStorage();
  assert.strictEqual(IconLibrary.override('?icons=v1', storage), 'v1');
  assert.strictEqual(IconLibrary.override('', storage), 'v1');
  assert.strictEqual(IconLibrary.override('?icons=legacy', storage), 'legacy');
  assert.strictEqual(IconLibrary.override('?icons=default', storage), null);
  assert.strictEqual(IconLibrary.override('?icons=nimporte', storage), null);
  withLibrary({ config: V1_PIERRE, search: '?icons=legacy' }, () => assert.strictEqual(IconLibrary.active(), 'legacy'));
});

// ── Traitement d'image ───────────────────────────────────────────────────────

async function syntheticStone(file, { opaque = false } = {}) {
  // Polygone gris décentré (anti-crénelé) sur fond transparent, 1024×1024.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
    ${opaque ? '<rect width="1024" height="1024" fill="#222"/>' : ''}
    <polygon points="300,250 620,200 760,420 700,700 420,760 260,560" fill="#8a929c"/>
    <polygon points="300,250 620,200 520,420" fill="#c9ced4"/></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
}

test('process : vrai alpha, normalisation à 12 % de marge, exports 1024 / 256 / 128 avec alpha', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-icons-test-'));
  try {
    const src = path.join(dir, 'brut.png');
    await syntheticStone(src);
    const r = await processIcon(src, path.join(dir, 'out'), 'pierre');
    assert.ok(r.source.ok);
    assert.deepStrictEqual([r.verify.png.width, r.verify.png.height, r.verify.png.channels, r.verify.png.hasAlpha], [1024, 1024, 4, true]);
    assert.deepStrictEqual([r.verify.webp256.width, r.verify.webp256.hasAlpha], [256, true]);
    assert.deepStrictEqual([r.verify.webp128.width, r.verify.webp128.hasAlpha], [128, true]);
    const m = r.margins;
    assert.ok(Math.abs(Math.min(m.left, m.right, m.top, m.bottom) - 0.12) < 0.004, JSON.stringify(m));
    assert.ok(Math.abs(m.left - m.right) < 0.004 && Math.abs(m.top - m.bottom) < 0.004, 'objet centré');
    assert.ok(r.legibility.contrast['bloc pierre (#374151)'] > 1);
    assert.ok(fs.existsSync(r.files.darkPreview));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('process : une image sans vraie transparence est refusée', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-icons-test-'));
  try {
    const src = path.join(dir, 'opaque.png');
    await syntheticStone(src, { opaque: true });
    const c = await checkSource(src);
    assert.strictEqual(c.ok, false);
    assert.ok(c.problems.some((p) => /coins non transparents/.test(p)), c.problems.join(' ; '));
    await assert.rejects(processIcon(src, path.join(dir, 'out'), 'x'), /source refusée/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Client OpenAI (aucun appel réseau) ───────────────────────────────────────

function tmpConfig(extra = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-oa-test-'));
  const key = path.join(dir, 'key.env');
  fs.writeFileSync(key, 'OPENAI_API_KEY=sk-test-ABCDEFGHIJKLMNOP1234\n', { mode: 0o600 });
  const cfg = path.join(dir, 'openai.env');
  fs.writeFileSync(cfg, `DIG_OPENAI_KEY_FILE=${key}\nDIG_IMAGE_BUDGET_USD=1\nDIG_IMAGE_EST_COST_USD=0.4\nDIG_IMAGE_MAX_PER_RUN=3\n${extra}`, { mode: 0o600 });
  return { dir, key, cfg };
}

test('openai : configuration et clé refusées si lisibles par d\'autres comptes', () => {
  const t = tmpConfig();
  try {
    fs.chmodSync(t.cfg, 0o644);
    assert.throws(() => oa.loadConfig(t.cfg), /trop ouvert/);
    fs.chmodSync(t.cfg, 0o600);
    fs.chmodSync(t.key, 0o664);
    assert.throws(() => oa.loadKey(oa.loadConfig(t.cfg)), /trop ouvert/);
  } finally {
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
});

test('openai : clé brute sur une seule ligne acceptée, sans apparaître dans les erreurs', () => {
  const t = tmpConfig();
  try {
    fs.writeFileSync(t.key, 'sk-test-brute-0123456789\n', { mode: 0o600 });
    assert.strictEqual(oa.loadKey(oa.loadConfig(t.cfg)), 'sk-test-brute-0123456789');
    fs.writeFileSync(t.key, '# commentaire\nAUTRE=1\n', { mode: 0o600 });
    assert.throws(() => oa.loadKey(oa.loadConfig(t.cfg)), (e) => /absente/.test(e.message) && !/AUTRE=1/.test(e.message));
  } finally {
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
});

test('openai : plafond de budget et nombre d\'images par commande', () => {
  const t = tmpConfig();
  try {
    const cfg = oa.loadConfig(t.cfg);
    assert.doesNotThrow(() => oa.checkBudget(cfg, 2, []));
    assert.throws(() => oa.checkBudget(cfg, 3, []), /budget dépassé/);
    assert.throws(() => oa.checkBudget(cfg, 1, [{ cost_usd: 0.7 }]), /budget dépassé/);
    assert.throws(() => oa.checkBudget(cfg, 4, []), /maximum 3/);
  } finally {
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
});

test('openai : requête sans référence (JSON, fond transparent) et avec référence (édition multipart)', async () => {
  const t = tmpConfig('DIG_IMAGE_EDIT_MODEL=modele-edition\n');
  try {
    const cfg = oa.loadConfig(t.cfg);
    const gen = oa.buildRequest(cfg, { prompt: 'p' });
    assert.match(gen.endpoint, /images\/generations$/);
    assert.deepStrictEqual(JSON.parse(gen.body), { model: cfg.model, prompt: 'p', size: '1024x1024', quality: 'high', n: 1, background: 'transparent', output_format: 'png' });
    const ref = path.join(t.dir, 'ref.png');
    await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toFile(ref);
    const edit = oa.buildRequest(cfg, { prompt: 'p', reference: ref });
    assert.match(edit.endpoint, /images\/edits$/);
    assert.strictEqual(edit.body.get('model'), 'modele-edition');
    assert.strictEqual(edit.body.get('input_fidelity'), 'high');
    assert.strictEqual(edit.body.get('background'), 'transparent');
    assert.ok(edit.body.get('image[]'), 'référence jointe');
  } finally {
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
});

test('openai : aucune trace de la clé dans les erreurs (y compris la forme masquée renvoyée par OpenAI)', async () => {
  const t = tmpConfig();
  try {
    const cfg = oa.loadConfig(t.cfg);
    const fakeFetch = async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: {
      type: 'invalid_request_error', code: 'invalid_api_key',
      message: 'Incorrect API key provided: sk-test-****************1234. You can find your API key at https://platform.openai.com/account/api-keys.' } }) });
    await assert.rejects(oa.callImages(cfg, oa.buildRequest(cfg, { prompt: 'p' }), { fetchImpl: fakeFetch }), (err) => {
      assert.match(err.message, /401 invalid_request_error invalid_api_key/);
      assert.doesNotMatch(err.message, /sk-|1234|ABCDEF/);
      return true;
    });
    const okFetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ data: [{ b64_json: Buffer.from('png').toString('base64') }], usage: { input_tokens: 100, output_tokens: 1000 } }) });
    const r = await oa.callImages(cfg, oa.buildRequest(cfg, { prompt: 'p' }), { fetchImpl: okFetch });
    assert.strictEqual(r.png.toString(), 'png');
  } finally {
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
});

test('prompt : texte du propriétaire mot pour mot sans référence ; gabarit maître + clause avec référence', () => {
  const materials = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/icons/materials.json'), 'utf8')).materials;
  assert.deepStrictEqual(Object.keys(materials), ['pierre'], 'seule la pierre est décrite');
  const owner = buildPrompt(materials.pierre, { withReference: false });
  assert.strictEqual(owner.prompt, materials.pierre.ownerPrompt);
  const ref = buildPrompt(materials.pierre, { withReference: true });
  assert.match(ref.prompt, /^A single irregular gray stone, premium stylized 3D low-poly/);
  assert.match(ref.prompt, /Match exactly the rendering style/);
  assert.doesNotMatch(ref.prompt, /\{\{/);
  assert.strictEqual(ref.masterVersion, 'v1.0');
});
