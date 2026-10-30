#!/usr/bin/env node
/**
 * DIG! — Contrôle de l'envoi d'e-mails du jeu (ticket #43), utilisé par scripts/dig-smtp-config.sh.
 *
 *   node scripts/mail-check.js [--config /etc/dig/dig.env] --verify
 *        connexion + authentification SMTP, sans envoi
 *   node scripts/mail-check.js [--config /etc/dig/dig.env] --send adresse@exemple.be
 *        envoie un e-mail de test (modèle « test » de server/mailer.js)
 *   node scripts/mail-check.js [--config …] --dns
 *        enregistrements SPF et DMARC du domaine d'expédition (DKIM : voir les en-têtes reçus)
 *
 * Configuration : variables d'environnement, complétées par --config (seules les clés e-mail y
 * sont lues ; « - » = entrée standard, pour ne jamais passer de secret en argument). Aucun secret n'est affiché : les erreurs sont réduites à leur code.
 * Codes de sortie : 0 = OK, 1 = échec du contrôle, 2 = usage ou configuration incomplète.
 */

'use strict';

const fs  = require('fs');
const dns = require('dns').promises;
const { createMailer, senderDomain, smtpErrorSummary } = require('../server/mailer');

const MAIL_KEYS = ['MAIL_TRANSPORT', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS',
  'MAIL_FROM', 'MAIL_REPLY_TO', 'PUBLIC_BASE_URL'];

/** Lit un fichier au format EnvironmentFile de systemd (KEY=valeur, guillemets simples ou doubles). */
function readEnvFile(file) {
  const out = {};
  for (const line of fs.readFileSync(file === '-' ? 0 : file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=(.*)$/.exec(line);
    if (!m || !MAIL_KEYS.includes(m[1])) continue;
    let v = m[2].trim();
    if (v.length >= 2 && v[0] === "'" && v.endsWith("'")) v = v.slice(1, -1);
    else if (v.length >= 2 && v[0] === '"' && v.endsWith('"')) v = v.slice(1, -1).replace(/\\(["\\$`])/g, '$1');
    out[m[1]] = v;
  }
  return out;
}

function parseArgs(argv) {
  const a = { envFile: null, action: null, to: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config') a.envFile = argv[++i];
    else if (argv[i] === '--verify' || argv[i] === '--dns') a.action = argv[i].slice(2);
    else if (argv[i] === '--send') { a.action = 'send'; a.to = argv[++i]; }
    else return null;
  }
  return a.action ? a : null;
}

async function txt(name) {
  try { return (await dns.resolveTxt(name)).map(r => r.join('')); } catch (_) { return []; }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) { console.error('Usage : mail-check.js [--config FICHIER] --verify | --dns | --send ADRESSE'); return 2; }
  const env = { ...(args.envFile ? readEnvFile(args.envFile) : {}), NODE_ENV: 'production' };
  for (const k of MAIL_KEYS) if (process.env[k] !== undefined && env[k] === undefined) env[k] = process.env[k];

  if (args.action === 'dns') {
    const domain = senderDomain(env.MAIL_FROM);
    if (!domain) { console.log('✗ MAIL_FROM absent ou sans adresse valide'); return 2; }
    const spf   = (await txt(domain)).filter(t => /^v=spf1\b/i.test(t));
    const dmarc = (await txt(`_dmarc.${domain}`)).filter(t => /^v=DMARC1\b/i.test(t));
    console.log(spf.length === 1 ? `✓ SPF de ${domain} : ${spf[0]}`
      : spf.length ? `✗ SPF de ${domain} : ${spf.length} enregistrements (un seul est admis)` : `✗ SPF de ${domain} : absent`);
    console.log(dmarc.length ? `✓ DMARC de ${domain} : ${dmarc[0]}` : `! DMARC de ${domain} : absent (recommandé : v=DMARC1; p=none)`);
    console.log('  DKIM : à contrôler dans les en-têtes de l\'e-mail reçu (« dkim=pass »).');
    return spf.length === 1 ? 0 : 1;
  }

  const mailer = createMailer(env);
  if (!mailer.enabled || mailer.mode !== 'smtp') { console.log('✗ configuration SMTP incomplète (SMTP_HOST et MAIL_FROM requis)'); return 2; }

  if (args.action === 'verify') {
    const r = await mailer.verify();
    console.log(r.ok ? `✓ connexion SMTP acceptée — ${mailer.summary}` : `✗ connexion SMTP refusée : ${r.error}`);
    return r.ok ? 0 : 1;
  }

  const to = String(args.to || '').trim();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[A-Za-z]{2,}$/.test(to)) { console.log('✗ adresse de test invalide'); return 2; }
  try {
    const when = new Date().toLocaleString('fr-BE', { timeZone: 'Europe/Brussels' });
    const info = await mailer.send(mailer.compose('test', { to, username: 'DIG!', lang: 'fr', arg: when }));
    const accepted = (info.accepted || []).length, rejected = (info.rejected || []).length;
    const code = /^\d{3}/.exec(String(info.response || ''));
    console.log(accepted && !rejected
      ? `✓ e-mail de test accepté par le serveur SMTP${code ? ` (${code[0]})` : ''}`
      : `✗ e-mail de test refusé (${rejected} destinataire(s) rejeté(s))`);
    return accepted && !rejected ? 0 : 1;
  } catch (err) {
    console.log(`✗ envoi refusé : ${smtpErrorSummary(err)}`);
    return 1;
  }
}

if (require.main === module) main().then(code => process.exit(code), () => process.exit(1));

module.exports = { readEnvFile, parseArgs };
