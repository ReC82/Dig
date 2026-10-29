#!/usr/bin/env node
/**
 * scripts/backup-db.js
 * Sauvegarde cohérente de la base SQLite via l'API backup de SQLite (better-sqlite3),
 * sans arrêter le serveur : la copie est faite pendant que le jeu tourne (mode WAL).
 *
 * Chaque sauvegarde est vérifiée (PRAGMA integrity_check + nombre de lignes par table),
 * accompagnée d'un manifeste JSON (sha256, tailles, compteurs) et la rétention est appliquée.
 *
 * Utilisation :
 *   node scripts/backup-db.js [--label pre-deploy] [--json]
 *
 * Variables d'environnement :
 *   DIG_DB_PATH          base à sauvegarder (défaut : server/data/$DB_FILE, DB_FILE=dig.sqlite)
 *   DIG_BACKUP_DIR       dossier des sauvegardes (défaut : ~/backups/dig)
 *   DIG_BACKUP_RETENTION_DAYS  rétention en jours (défaut : 14)
 *   DIG_BACKUP_KEEP_MIN  nombre minimal de sauvegardes toujours conservées (défaut : 3)
 *   DIG_BACKUP_OFFSITE_CMD  commande optionnelle de copie hors machine, appelée avec le chemin
 *                        de la sauvegarde puis celui du manifeste en arguments (désactivée si vide)
 *
 * Code de sortie : 0 si la sauvegarde est vérifiée, 1 sinon (la copie invalide est supprimée).
 */

'use strict';

const Database = require('better-sqlite3');
const crypto   = require('crypto');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PREFIX = 'dig-';
const BACKUP_RE = /^dig-(\d{8}-\d{6})(?:-[a-z0-9_-]+)?\.sqlite$/;

function config(env = process.env) {
  return {
    dbPath:        env.DIG_DB_PATH || path.join(ROOT, 'server', 'data', env.DB_FILE || 'dig.sqlite'),
    backupDir:     env.DIG_BACKUP_DIR || path.join(os.homedir(), 'backups', 'dig'),
    retentionDays: Number(env.DIG_BACKUP_RETENTION_DAYS || 14),
    keepMin:       Number(env.DIG_BACKUP_KEEP_MIN || 3),
    offsiteCmd:    env.DIG_BACKUP_OFFSITE_CMD || '',
  };
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Vérifie une base : intégrité + compteurs par table. Lève une erreur si elle est invalide. */
function verifyDb(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`integrity_check : ${integrity}`);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all().map((r) => r.name);
    const counts = {};
    for (const t of tables) counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM "${t.replace(/"/g, '""')}"`).get().c;
    return { integrity, counts };
  } finally {
    db.close();
  }
}

/**
 * Rend une copie autonome : l'API backup recopie l'en-tête WAL de la source, si bien que toute
 * ouverture ultérieure recréait des fichiers -wal / -shm à côté de la copie. Passage en journal
 * classique (DELETE), puis retrait de ces fichiers annexes.
 */
function finalizeCopy(file) {
  const db = new Database(file, { fileMustExist: true });
  try {
    db.pragma('journal_mode = DELETE');
  } finally {
    db.close();
  }
  for (const extra of [`${file}-wal`, `${file}-shm`]) fs.rmSync(extra, { force: true });
}

/** Supprime les sauvegardes plus anciennes que la rétention, en gardant toujours les keepMin plus récentes. */
function applyRetention(cfg, now = Date.now()) {
  const files = fs.readdirSync(cfg.backupDir).filter((f) => BACKUP_RE.test(f)).sort().reverse();
  const limit = now - cfg.retentionDays * 86400 * 1000;
  const removed = [];
  files.forEach((f, i) => {
    if (i < cfg.keepMin) return;
    const full = path.join(cfg.backupDir, f);
    if (fs.statSync(full).mtimeMs >= limit) return;
    for (const extra of [full, full.replace(/\.sqlite$/, '.json')]) {
      if (fs.existsSync(extra)) fs.unlinkSync(extra);
    }
    removed.push(f);
  });
  return removed;
}

async function backup(cfg, label = '') {
  if (!fs.existsSync(cfg.dbPath)) throw new Error(`base introuvable : ${cfg.dbPath}`);
  fs.mkdirSync(cfg.backupDir, { recursive: true, mode: 0o700 });
  const safeLabel = String(label).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  const name = `${PREFIX}${stamp()}${safeLabel ? '-' + safeLabel : ''}.sqlite`;
  const dest = path.join(cfg.backupDir, name);
  const tmp = `${dest}.partial`;

  // Lecture seule côté source : la sauvegarde n'écrit jamais dans la base du jeu.
  const src = new Database(cfg.dbPath, { readonly: true, fileMustExist: true });
  const started = Date.now();
  try {
    await src.backup(tmp);
  } finally {
    src.close();
  }
  let check;
  try {
    finalizeCopy(tmp);
    check = verifyDb(tmp);
  } catch (err) {
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) fs.rmSync(f, { force: true });
    throw new Error(`sauvegarde invalide, supprimée : ${err.message}`);
  }
  fs.renameSync(tmp, dest);
  fs.chmodSync(dest, 0o600);

  const manifest = {
    file: name,
    source: cfg.dbPath,
    created_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    bytes: fs.statSync(dest).size,
    sha256: sha256(dest),
    integrity: check.integrity,
    counts: check.counts,
    label: safeLabel,
  };
  const manifestPath = dest.replace(/\.sqlite$/, '.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });

  manifest.removed = applyRetention(cfg);

  if (cfg.offsiteCmd) {
    const r = spawnSync('/bin/sh', ['-c', `${cfg.offsiteCmd} "$1" "$2"`, 'offsite', dest, manifestPath],
      { stdio: 'inherit', timeout: 10 * 60 * 1000 });
    manifest.offsite = r.status === 0 ? 'ok' : `échec (code ${r.status})`;
  } else {
    manifest.offsite = 'désactivée';
  }
  manifest.path = dest;
  return manifest;
}

module.exports = { config, backup, verifyDb, finalizeCopy, applyRetention, BACKUP_RE };

if (require.main === module) {
  const args = process.argv.slice(2);
  const li = args.indexOf('--label');
  const label = li >= 0 ? args[li + 1] || '' : '';
  backup(config(), label)
    .then((m) => {
      if (args.includes('--json')) {
        console.log(JSON.stringify(m));
      } else {
        const total = Object.values(m.counts).reduce((a, b) => a + b, 0);
        console.log(`[backup] OK ${m.path} — ${m.bytes} octets, sha256 ${m.sha256.slice(0, 12)}, ` +
          `${Object.keys(m.counts).length} tables / ${total} lignes, intégrité ${m.integrity}, ` +
          `hors machine : ${m.offsite}, supprimées (rétention) : ${m.removed.length}`);
      }
      if (m.offsite.startsWith('échec')) process.exitCode = 1;
    })
    .catch((err) => {
      console.error(`[backup] ÉCHEC : ${err.message}`);
      process.exitCode = 1;
    });
}
