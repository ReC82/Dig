#!/usr/bin/env node
/**
 * Faux AWS CLI pour test/offsite-s3.test.js : simule put-object / head-object dans FAKE_S3_DIR.
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
const obj = path.join(store, opt('--bucket'), opt('--key'));

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
  console.log([body.length, meta.sse, crypto.createHash('sha256').update(body).digest('base64'), meta.sha].join('\t'));
} else {
  console.error('commande non simulée'); process.exit(2);
}
