#!/usr/bin/env node
/**
 * Faux AWS CLI pour test/offsite-s3.test.js : simule put-object / head-object / get-object /
 * list-objects-v2 dans FAKE_S3_DIR, et les lectures de configuration du bucket (get-bucket-*,
 * get-public-access-block) à partir de FAKE_S3_DIR/conf.json (réponse texte par sous-commande).
 * FAKE_S3_CORRUPT=1 tronque l'objet stocké (doit être détecté par la vérification).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const store = process.env.FAKE_S3_DIR;
fs.appendFileSync(path.join(store, 'calls.log'), args.join(' ') + '\n');
const obj = path.join(store, opt('--bucket'), opt('--key') || '');
const sub = args.find((a) => /^(get-bucket-|get-public-access-block)/.test(a));

if (args.includes('put-object')) {
  let body = fs.readFileSync(opt('--body'));
  const sent = opt('--checksum-sha256');
  if (sent && crypto.createHash('sha256').update(body).digest('base64') !== sent) {
    console.error('BadDigest'); process.exit(254);
  }
  if (process.env.FAKE_S3_CORRUPT === '1') body = body.subarray(0, body.length - 1);
  fs.mkdirSync(path.dirname(obj), { recursive: true });
  fs.writeFileSync(obj, body);
  fs.writeFileSync(obj + '.meta', JSON.stringify({
    sse: opt('--server-side-encryption') || '',
    sha: (opt('--metadata') || '').replace(/^sha256=/, ''),
  }));
} else if (args.includes('head-object')) {
  if (!fs.existsSync(obj)) { console.error('Not Found'); process.exit(254); }
  const body = fs.readFileSync(obj);
  const meta = JSON.parse(fs.readFileSync(obj + '.meta', 'utf8'));
  if (opt('--query') === 'Metadata.sha256') { console.log(meta.sha); process.exit(0); }
  console.log([body.length, meta.sse, crypto.createHash('sha256').update(body).digest('base64'), meta.sha].join('\t'));
} else if (args.includes('get-object')) {
  if (!fs.existsSync(obj)) { console.error('NoSuchKey'); process.exit(254); }
  fs.copyFileSync(obj, args[args.indexOf('--output') - 1]);
  console.log('{}');
} else if (args.includes('list-objects-v2')) {
  const dir = path.join(store, opt('--bucket'), opt('--prefix'));
  const keys = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => !f.endsWith('.meta')) : [];
  console.log(keys.length ? keys.map((k) => opt('--prefix') + k).join('\t') : 'None');
} else if (sub) {
  const conf = JSON.parse(fs.readFileSync(path.join(store, 'conf.json'), 'utf8'));
  if (!(sub in conf)) { console.error('NotFound'); process.exit(254); }
  console.log(conf[sub]);
} else {
  console.error('commande non simulée'); process.exit(2);
}
