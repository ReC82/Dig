/**
 * Tests de scripts/offsite-s3.sh (copie hors machine vers S3) avec un faux AWS CLI : aucun appel réseau.
 * Lancer : npm test
 */

'use strict';

const test     = require('node:test');
const assert   = require('node:assert');
const Database = require('better-sqlite3');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const { spawnSync } = require('child_process');
const { config, backup } = require('../scripts/backup-db');

const HOOK = path.join(__dirname, '..', 'scripts', 'offsite-s3.sh');
const FAKE_AWS = path.join(__dirname, 'fixtures', 'fake-aws.js');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-offsite-test-'));
  const s3 = path.join(dir, 's3');
  fs.mkdirSync(s3);
  const dbPath = path.join(dir, 'game.sqlite');
  const db = new Database(dbPath);
  db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT); INSERT INTO users(name) VALUES (\'a\'), (\'b\');');
  db.close();
  const env = { ...process.env, AWS_CLI: FAKE_AWS, FAKE_S3_DIR: s3, DIG_S3_BUCKET: 'dig-test', AWS_REGION: 'us-east-1' };
  return { dir, s3, dbPath, env, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function withEnv(env, fn) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  return fn().finally(() => { process.env = saved; });
}

test('sauvegarde réelle envoyée vers S3 (SSE-S3, sha256) et vérifiée via head-object', async () => {
  const s = sandbox();
  try {
    const cfg = { ...config({}), dbPath: s.dbPath, backupDir: path.join(s.dir, 'backups'), offsiteCmd: `bash ${HOOK}` };
    const m = await withEnv(s.env, () => backup(cfg, 'daily'));
    assert.strictEqual(m.offsite, 'ok');
    const name = path.basename(m.path);
    const stored = path.join(s.s3, 'dig-test', 'backups', name);
    assert.deepStrictEqual(fs.readFileSync(stored), fs.readFileSync(m.path));
    assert.ok(fs.existsSync(path.join(s.s3, 'dig-test', 'backups', name.replace(/\.sqlite$/, '.json'))));
    const calls = fs.readFileSync(path.join(s.s3, 'calls.log'), 'utf8');
    assert.match(calls, /put-object .*--server-side-encryption AES256 --checksum-algorithm SHA256/);
    assert.match(calls, /head-object/);
    assert.ok(fs.existsSync(m.path), 'la sauvegarde locale est conservée');
  } finally { s.cleanup(); }
});

test('objet altéré côté S3 : échec signalé, sauvegarde locale conservée, code de sortie 1', async () => {
  const s = sandbox();
  try {
    const cfg = { ...config({}), dbPath: s.dbPath, backupDir: path.join(s.dir, 'backups'), offsiteCmd: `bash ${HOOK}` };
    const m = await withEnv({ ...s.env, FAKE_S3_CORRUPT: '1' }, () => backup(cfg, 'daily'));
    assert.match(m.offsite, /^échec/);
    assert.ok(fs.existsSync(m.path));
  } finally { s.cleanup(); }
});

test('configuration incomplète refusée sans appel AWS', () => {
  const s = sandbox();
  try {
    const f = path.join(s.dir, 'x.sqlite');
    fs.writeFileSync(f, 'x');
    const noBucket = spawnSync('bash', [HOOK, f, f], { env: { ...s.env, DIG_S3_BUCKET: '' }, encoding: 'utf8' });
    assert.strictEqual(noBucket.status, 1);
    assert.match(noBucket.stderr, /DIG_S3_BUCKET/);
    const missing = spawnSync('bash', [HOOK, path.join(s.dir, 'absent'), f], { env: s.env, encoding: 'utf8' });
    assert.strictEqual(missing.status, 1);
    assert.ok(!fs.existsSync(path.join(s.s3, 'calls.log')));
  } finally { s.cleanup(); }
});

const RESTORE = path.join(__dirname, '..', 'scripts', 'restore-from-s3.sh');
const CHECK = path.join(__dirname, '..', 'deploy', 'aws', 'check-s3.sh');

test('journal hors machine : chaque tentative (réussie ou échouée) est consignée dans offsite.log', async () => {
  const s = sandbox();
  try {
    const backupDir = path.join(s.dir, 'backups');
    const cfg = { ...config({}), dbPath: s.dbPath, backupDir, offsiteCmd: `bash ${HOOK}` };
    const ok = await withEnv(s.env, () => backup(cfg, 'daily'));
    const ko = await withEnv({ ...s.env, FAKE_S3_CORRUPT: '1' }, () => backup(cfg, 'daily'));
    const lines = fs.readFileSync(path.join(backupDir, 'offsite.log'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.strictEqual(lines.length, 2);
    assert.deepStrictEqual(lines.map((l) => l.file), [path.basename(ok.path), path.basename(ko.path)]);
    assert.strictEqual(lines[0].result, 'ok');
    assert.match(lines[1].result, /^échec/);
    assert.strictEqual(fs.statSync(path.join(backupDir, 'offsite.log')).mode & 0o777, 0o600);
  } finally { s.cleanup(); }
});

test('copie hors machine désactivée : aucun journal créé', async () => {
  const s = sandbox();
  try {
    const backupDir = path.join(s.dir, 'backups');
    await backup({ ...config({}), dbPath: s.dbPath, backupDir, offsiteCmd: '' }, 'daily');
    assert.ok(!fs.existsSync(path.join(backupDir, 'offsite.log')));
  } finally { s.cleanup(); }
});

test('restauration depuis S3 : la plus récente est téléchargée, vérifiée et restaurée sur une copie isolée', async () => {
  const s = sandbox();
  try {
    const cfg = { ...config({}), dbPath: s.dbPath, backupDir: path.join(s.dir, 'backups'), offsiteCmd: `bash ${HOOK}` };
    const first = await withEnv(s.env, () => backup(cfg, 'daily'));
    await new Promise((r) => setTimeout(r, 1100)); // horodatage à la seconde
    const db = new Database(s.dbPath);
    db.exec("INSERT INTO users(name) VALUES ('c')");
    db.close();
    const second = await withEnv(s.env, () => backup(cfg, 'daily'));
    const before = fs.readFileSync(s.dbPath);
    const tmp = path.join(s.dir, 'tmp');
    fs.mkdirSync(tmp);

    const env = { ...s.env, TMPDIR: tmp, DIG_DB_PATH: s.dbPath, DIG_S3_KEEP: '1' };
    const r = spawnSync('bash', [RESTORE], { env, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`ok s3://dig-test/backups/${path.basename(second.path)}`));
    assert.match(r.stdout, /3 lignes/);
    const kept = r.stdout.match(/copie conservée : (\S+)/)[1];
    const restored = new Database(kept, { readonly: true });
    assert.strictEqual(restored.prepare('SELECT COUNT(*) AS c FROM users').get().c, 3);
    restored.close();
    assert.deepStrictEqual(fs.readFileSync(s.dbPath), before, 'la base du jeu est intacte');

    const named = spawnSync('bash', [RESTORE, path.basename(first.path)], { env: { ...env, DIG_S3_KEEP: '' }, encoding: 'utf8' });
    assert.strictEqual(named.status, 0, named.stderr);
    assert.match(named.stdout, /2 lignes/);
    assert.strictEqual(fs.readdirSync(tmp).length, 1, 'dossier temporaire supprimé sans DIG_S3_KEEP');
  } finally { s.cleanup(); }
});

test('restauration depuis S3 refusée si l\'objet est altéré, absent ou le nom invalide', async () => {
  const s = sandbox();
  try {
    const cfg = { ...config({}), dbPath: s.dbPath, backupDir: path.join(s.dir, 'backups'), offsiteCmd: `bash ${HOOK}` };
    const m = await withEnv(s.env, () => backup(cfg, 'daily'));
    const stored = path.join(s.s3, 'dig-test', 'backups', path.basename(m.path));
    const buf = fs.readFileSync(stored);
    buf[buf.length - 1] ^= 0xff;
    fs.writeFileSync(stored, buf);
    const altered = spawnSync('bash', [RESTORE, 'latest'], { env: s.env, encoding: 'utf8' });
    assert.strictEqual(altered.status, 1);
    assert.match(altered.stderr, /sha256/);

    const absent = spawnSync('bash', [RESTORE, 'dig-20200101-000000.sqlite'], { env: s.env, encoding: 'utf8' });
    assert.strictEqual(absent.status, 1);
    assert.match(absent.stderr, /téléchargement impossible/);

    const invalid = spawnSync('bash', [RESTORE, '../../etc/passwd'], { env: s.env, encoding: 'utf8' });
    assert.strictEqual(invalid.status, 1);
    assert.match(invalid.stderr, /nom de sauvegarde invalide/);

    fs.rmSync(path.join(s.s3, 'dig-test'), { recursive: true });
    const empty = spawnSync('bash', [RESTORE], { env: s.env, encoding: 'utf8' });
    assert.strictEqual(empty.status, 1);
    assert.match(empty.stderr, /aucune sauvegarde/);
  } finally { s.cleanup(); }
});

test('contrôle du bucket en lecture seule : conforme, puis écarts signalés', () => {
  const s = sandbox();
  try {
    const good = {
      'get-bucket-location': 'None',
      'get-public-access-block': 'True\tTrue\tTrue\tTrue',
      'get-bucket-encryption': 'AES256',
      'get-bucket-versioning': 'Enabled',
      'get-bucket-lifecycle-configuration': '30',
    };
    fs.writeFileSync(path.join(s.s3, 'conf.json'), JSON.stringify(good));
    const ok = spawnSync('bash', [CHECK, 'dig-test'], { env: s.env, encoding: 'utf8' });
    assert.strictEqual(ok.status, 0, ok.stdout);
    assert.match(ok.stdout, /== conforme/);

    const { 'get-bucket-versioning': _v, ...noVersioning } = good;
    fs.writeFileSync(path.join(s.s3, 'conf.json'), JSON.stringify({ ...noVersioning, 'get-bucket-location': 'us-west-2' }));
    const ko = spawnSync('bash', [CHECK, 'dig-test'], { env: s.env, encoding: 'utf8' });
    assert.strictEqual(ko.status, 1);
    assert.match(ko.stdout, /ÉCART région us-west-2/);
    assert.match(ko.stdout, /ÉCART versionnement/);
    const calls = fs.readFileSync(path.join(s.s3, 'calls.log'), 'utf8').trim().split('\n');
    assert.ok(calls.every((c) => /s3api get-/.test(c)), 'uniquement des lectures');
  } finally { s.cleanup(); }
});
