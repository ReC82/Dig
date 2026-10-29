/**
 * Tests de scripts/backup-db.js et scripts/restore-db.js, sur des bases temporaires uniquement.
 * Lancer : npm test
 */

'use strict';

const test     = require('node:test');
const assert   = require('node:assert');
const Database = require('better-sqlite3');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { config, backup, applyRetention } = require('../scripts/backup-db');
const { restore } = require('../scripts/restore-db');

const SCRIPTS = path.join(__dirname, '..', 'scripts');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-backup-test-'));
  const dbPath = path.join(dir, 'game.sqlite');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT); CREATE TABLE user_saves(user_id INTEGER, data TEXT);');
  const ins = db.prepare('INSERT INTO users(name) VALUES (?)');
  for (let i = 0; i < 50; i++) ins.run(`joueur${i}`);
  db.prepare('INSERT INTO user_saves VALUES (1, ?)').run(JSON.stringify({ coins: 42 }));
  const cfg = { ...config({}), dbPath, backupDir: path.join(dir, 'backups'), retentionDays: 14, keepMin: 3, offsiteCmd: '' };
  return { dir, dbPath, db, cfg, cleanup: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('sauvegarde cohérente pendant que la base est ouverte en écriture (WAL), vérifiée et documentée', async () => {
  const s = sandbox();
  try {
    // Écritures non encore « checkpointées » : elles ne sont que dans le WAL.
    s.db.prepare('INSERT INTO users(name) VALUES (?)').run('dans-le-wal');
    const m = await backup(s.cfg, 'Test Label!');
    assert.match(path.basename(m.path), /^dig-\d{8}-\d{6}-test-label\.sqlite$/);
    assert.strictEqual(m.integrity, 'ok');
    assert.deepStrictEqual(m.counts, { user_saves: 1, users: 51 });
    assert.strictEqual(fs.statSync(m.path).mode & 0o777, 0o600);
    const manifest = JSON.parse(fs.readFileSync(m.path.replace(/\.sqlite$/, '.json'), 'utf8'));
    assert.strictEqual(manifest.sha256, m.sha256);
    assert.strictEqual(m.offsite, 'désactivée');
    assert.ok(!fs.existsSync(`${m.path}.partial`));
  } finally {
    s.cleanup();
  }
});

test('la source n\'est pas modifiée par la sauvegarde', async () => {
  const s = sandbox();
  try {
    const before = s.db.prepare('SELECT COUNT(*) c FROM users').get().c;
    await backup(s.cfg);
    assert.strictEqual(s.db.prepare('SELECT COUNT(*) c FROM users').get().c, before);
  } finally {
    s.cleanup();
  }
});

test('rétention : supprime au-delà de N jours mais garde toujours les keepMin plus récentes', async () => {
  const s = sandbox();
  try {
    fs.mkdirSync(s.cfg.backupDir, { recursive: true });
    const old = Date.now() / 1000 - 30 * 86400;
    const names = ['20260901-010101', '20260902-010101', '20260903-010101', '20260904-010101', '20260905-010101']
      .map((d) => `dig-${d}.sqlite`);
    for (const n of names) {
      const f = path.join(s.cfg.backupDir, n);
      fs.writeFileSync(f, 'x');
      fs.writeFileSync(f.replace(/\.sqlite$/, '.json'), '{}');
      fs.utimesSync(f, old, old);
    }
    fs.writeFileSync(path.join(s.cfg.backupDir, 'autre-fichier.sqlite'), 'x');
    const removed = applyRetention(s.cfg);
    assert.deepStrictEqual(removed.sort(), names.slice(0, 2));
    const left = fs.readdirSync(s.cfg.backupDir).sort();
    assert.ok(left.includes('autre-fichier.sqlite'), 'un fichier hors convention n\'est jamais supprimé');
    assert.strictEqual(left.filter((f) => f.startsWith('dig-') && f.endsWith('.sqlite')).length, 3);
    assert.ok(!left.includes(names[0].replace(/\.sqlite$/, '.json')), 'le manifeste part avec sa sauvegarde');
  } finally {
    s.cleanup();
  }
});

test('restauration sur copie : données identiques, ancienne base sauvegardée d\'abord', async () => {
  const s = sandbox();
  try {
    const m = await backup(s.cfg);
    const target = path.join(s.dir, 'copie.sqlite');
    fs.writeFileSync(target, '');
    new Database(target).exec('CREATE TABLE ancienne(x)'); // base cible existante
    const r = await restore(m.path, target, { env: { DIG_DB_PATH: s.dbPath, DIG_BACKUP_DIR: s.cfg.backupDir } });
    assert.ok(r.safety && fs.existsSync(r.safety), 'sauvegarde pre-restore créée');
    const copy = new Database(target, { readonly: true });
    assert.strictEqual(copy.prepare('SELECT COUNT(*) c FROM users').get().c, 50);
    assert.strictEqual(JSON.parse(copy.prepare('SELECT data FROM user_saves').get().data).coins, 42);
    copy.close();
  } finally {
    s.cleanup();
  }
});

test('restauration refusée sur la base du jeu sans --live, et sur une sauvegarde altérée', async () => {
  const s = sandbox();
  try {
    const m = await backup(s.cfg);
    const env = { DIG_DB_PATH: s.dbPath, DIG_BACKUP_DIR: s.cfg.backupDir };
    await assert.rejects(restore(m.path, s.dbPath, { env }), /base du jeu/);
    fs.appendFileSync(m.path, 'altération');
    await assert.rejects(restore(m.path, path.join(s.dir, 'x.sqlite'), { env }), /sha256/);
  } finally {
    s.cleanup();
  }
});

test('restauration --live refusée tant que le service est actif', async () => {
  const s = sandbox();
  try {
    const m = await backup(s.cfg);
    // « dbus » tourne toujours : il joue le rôle d'un service actif sans toucher à dig.
    const env = { DIG_DB_PATH: s.dbPath, DIG_BACKUP_DIR: s.cfg.backupDir, DIG_SERVICE: 'dbus' };
    if (spawnSync('systemctl', ['is-active', '--quiet', 'dbus']).status !== 0) return;
    await assert.rejects(restore(m.path, s.dbPath, { live: true, env }), /actif/);
  } finally {
    s.cleanup();
  }
});

test('CLI : sortie en échec si la base est absente, succès sinon', () => {
  const s = sandbox();
  try {
    const env = { ...process.env, DIG_DB_PATH: path.join(s.dir, 'absente.sqlite'), DIG_BACKUP_DIR: s.cfg.backupDir };
    const ko = spawnSync('node', [path.join(SCRIPTS, 'backup-db.js')], { env, encoding: 'utf8' });
    assert.strictEqual(ko.status, 1);
    assert.match(ko.stderr, /base introuvable/);
    const out = execFileSync('node', [path.join(SCRIPTS, 'backup-db.js'), '--json'],
      { env: { ...env, DIG_DB_PATH: s.dbPath }, encoding: 'utf8' });
    assert.strictEqual(JSON.parse(out).integrity, 'ok');
  } finally {
    s.cleanup();
  }
});
