/**
 * Accès « Rejoindre le Discord » côté joueur (#50, demande du propriétaire du 07/11) :
 *   - un seul champ (Admin → Bêta → Configurer la bêta), validation stricte des invitations Discord,
 *     barre finale retirée, lien vidé = plus rien d'affiché ; une valeur ancienne non conforme n'est
 *     jamais exposée au jeu ;
 *   - Actualités : bouton en tête du panneau (avant « À venir »), nouvel onglet, noopener, mention
 *     « facultatif » ; rien sans lien ; même contrôle d'adresse côté navigateur ;
 *   - Aide : section « Communauté » seulement si le lien est configuré ;
 *   - textes FR/EN/NL/ES/IT présents ; aucune requête ni action de jeu ajoutée.
 * Base temporaire hors server/data/. Lancer : npm test
 */
'use strict';
const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const vm     = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-discord-50-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');
const db   = require('../server/db');
const beta = require('../server/beta');
db.initDb();

const OFFICIAL = 'https://discord.gg/eGzJrzbaq';
const status = fn => { try { fn(); return 200; } catch (err) { return err.status || 500; } };

test('serveur : invitation officielle acceptée telle quelle, publiée au jeu, puis retirée', () => {
  assert.strictEqual(beta.publicConfig().discordUrl, null, 'aucun lien par défaut');
  assert.strictEqual(beta.updateSettings({ discordUrl: `  ${OFFICIAL}  ` }).discordUrl, OFFICIAL);
  assert.strictEqual(beta.publicConfig().discordUrl, OFFICIAL, 'URL exacte');
  assert.strictEqual(beta.updateSettings({ discordUrl: `${OFFICIAL}/` }).discordUrl, OFFICIAL, 'barre finale retirée');
  assert.strictEqual(beta.updateSettings({ discordUrl: 'https://discord.com/invite/eGzJrzbaq' }).discordUrl, 'https://discord.com/invite/eGzJrzbaq');
  assert.strictEqual(beta.updateSettings({ discordUrl: '' }).discordUrl, '');
  assert.strictEqual(beta.publicConfig().discordUrl, null, 'lien vidé = désactivé');
});

test('serveur : toute autre adresse est refusée et l\'ancienne valeur conservée', () => {
  beta.updateSettings({ discordUrl: OFFICIAL });
  for (const bad of [
    'http://discord.gg/eGzJrzbaq', 'discord.gg/eGzJrzbaq', 'https://discord.gg/', 'https://discord.gg/a',
    'https://discord.gg/eGzJrzbaq?x=1', 'https://discord.gg/eGzJrzbaq#x', 'https://discord.gg/eGz/Jrz',
    'https://discord.gg.evil.example/eGzJrzbaq', 'https://evil.example/discord.gg/eGzJrzbaq',
    'https://user@discord.gg/eGzJrzbaq', 'https://discord.gg:8443/eGzJrzbaq', 'https://discord.com/eGzJrzbaq',
    'https://discord.com/channels/1/2', 'https://xdiscord.gg/eGzJrzbaq', 'javascript:alert(1)',
    'https://discord.gg/eGz Jrzbaq', 'https://discord.gg/eGzJrzbaq\nhttps://evil.example', 'https://discord.gg/<b>',
  ]) {
    assert.strictEqual(status(() => beta.updateSettings({ discordUrl: bad })), 400, bad);
  }
  assert.strictEqual(status(() => beta.updateSettings({ discordUrl: 42 })), 400);
  assert.strictEqual(beta.getSettings().discordUrl, OFFICIAL, 'refus sans effet');
});

test('serveur : une valeur ancienne non conforme en base n\'est jamais exposée', () => {
  db.getDb().prepare("UPDATE beta_settings SET discord_url = 'https://evil.example/x' WHERE id = 1").run();
  assert.strictEqual(beta.publicConfig().discordUrl, null);
  beta.updateSettings({ discordUrl: '' });
});

// ── Navigateur : news.js et help.js dans un DOM minimal ─────────────────────

function fakeDom() {
  const byId = new Map();
  class El {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.className = ''; this._text = ''; this.hidden = false; this.listeners = {}; }
    get childNodes() { return this.children; }
    set id(v) { this.attrs.id = v; byId.set(v, this); }
    get id() { return this.attrs.id; }
    set textContent(v) { this._text = String(v); this.children = []; }
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
    appendChild(c) { this.children.push(c); return c; }
    append(...cs) { cs.forEach(c => this.appendChild(typeof c === 'string' ? Object.assign(new El('#text'), { _text: c }) : c)); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
    removeEventListener() {}
    querySelector() { return null; }
    querySelectorAll() { return []; }
    focus() {}
    get classList() { const el = this; return { add() {}, remove() {}, toggle() {}, contains: c => el.className.split(' ').includes(c) }; }
    find(pred) { if (pred(this)) return this; for (const c of this.children) { const r = c.find?.(pred); if (r) return r; } return null; }
    all(pred, out = []) { if (pred(this)) out.push(this); for (const c of this.children) c.all?.(pred, out); return out; }
  }
  const doc = {
    documentElement: {}, head: { appendChild() {} }, body: new El('body'),
    createElement: tag => new El(tag), createDocumentFragment: () => new El('#fragment'),
    getElementById: id => byId.get(id) || null,
    querySelectorAll: () => [], addEventListener() {}, removeEventListener() {}, activeElement: null,
  };
  for (const id of ['news-body', 'news-panel', 'btn-news', 'news-badge', 'help-body', 'help-panel', 'help-panel-inner', 'btn-help']) {
    const el = new El('div'); el.id = id;
  }
  return doc;
}

function load(lang, newsData) {
  const store = new Map([['dig_lang', lang]]);
  if (lang === 'it') store.set('dig_lang_preview', '1');
  const document = fakeDom();
  const ctx = {
    console, Intl, URLSearchParams, document, setTimeout, clearTimeout, setInterval: () => 0,
    location: { search: '' }, navigator: {},
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    fetch: async () => ({ ok: true, json: async () => newsData }),
    requestAnimationFrame: f => f(),
  };
  ctx.self = ctx; ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('public/js/languages.js'), ctx);
  vm.runInContext(read('public/js/escapeHtml.js'), ctx);
  vm.runInContext(`${read('public/js/i18n.js')}\n;this.I18n = I18n; this.t = t;`, ctx);
  vm.runInContext(read('public/js/locales/it.js'), ctx);
  vm.runInContext(`${read('public/js/news.js')}\n;this.DigNews = DigNews;`, ctx);
  vm.runInContext(`${read('public/js/help.js')}\n;this.DigHelp = DigHelp;`, ctx);
  ctx.I18n.init();
  return ctx;
}

const NEWS = discordUrl => ({ upcoming: [], latest: [], discordUrl, mentions: false, serverTime: '2026-11-07T10:00:00Z' });

async function openNews(ctx) {
  await ctx.DigNews.open();
  return ctx.document.getElementById('news-body');
}

test('Actualités : bouton Discord en tête, URL exacte, nouvel onglet, facultatif', async () => {
  const ctx = load('fr', NEWS(OFFICIAL));
  const body = await openNews(ctx);
  const a = body.find(e => e.className === 'news-discord');
  assert.ok(a, 'bouton présent');
  assert.strictEqual(a.href, OFFICIAL);
  assert.strictEqual(a.target, '_blank');
  assert.strictEqual(a.rel, 'noopener noreferrer');
  assert.match(a.getAttribute('aria-label'), /nouvel onglet/);
  assert.strictEqual(body.children[0].className, 'news-community', 'premier élément du panneau, avant « À venir »');
  assert.match(body.children[0].textContent, /Facultatif.*pas nécessaire pour jouer/);
  assert.strictEqual(ctx.DigNews.discordUrl(), OFFICIAL);
});

test('Actualités : sans lien (ou lien non conforme), aucun bouton Discord', async () => {
  for (const url of [null, '', 'https://evil.example/x', 'javascript:alert(1)']) {
    const ctx = load('fr', NEWS(url));
    const body = await openNews(ctx);
    assert.strictEqual(body.find(e => /news-discord|news-community/.test(e.className)), null, String(url));
    assert.strictEqual(ctx.DigNews.discordUrl(), null);
  }
});

test('Aide : section « Communauté » seulement si le lien est configuré', async () => {
  let ctx = load('fr', NEWS(OFFICIAL));
  await openNews(ctx);
  ctx.DigHelp.open();
  let html = ctx.document.getElementById('help-body').innerHTML;
  assert.ok(html.includes(`href="${OFFICIAL}" target="_blank" rel="noopener noreferrer"`), 'lien sûr');
  assert.ok(html.indexOf('help-community') > html.indexOf('help-intro') && html.indexOf('help-community') < html.indexOf('help-group-basics'),
    'juste sous « Comment jouer ? »');
  ctx = load('fr', NEWS(null));
  await openNews(ctx);
  ctx.DigHelp.open();
  html = ctx.document.getElementById('help-body').innerHTML;
  assert.ok(!html.includes('help-community') && !html.includes('discord'), 'rien sans lien');
});

test('textes : FR/EN/NL/ES/IT, sans clé technique', () => {
  for (const lang of ['fr', 'en', 'nl', 'es', 'it']) {
    const ctx = load(lang, NEWS(null));
    for (const k of ['news.discord', 'news.discord_aria', 'news.discord_hint', 'help.community']) {
      assert.ok(ctx.I18n.has(k, lang), `${lang} ${k}`);
      assert.notStrictEqual(ctx.t(k), k);
    }
    assert.match(ctx.t('news.discord_hint'), /Discord/);
  }
});

test('aucune requête ni action de jeu ajoutée par l\'Aide ; un seul champ Discord dans l\'admin', () => {
  const help = read('public/js/help.js');
  assert.ok(!/fetch\(|saveGame|DigSave/.test(help));
  const admin = read('public/admin/index.html');
  assert.strictEqual((admin.match(/Lien d'invitation Discord/g) || []).length, 1);
});
