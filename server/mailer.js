/**
 * DIG! — Envoi des e-mails de compte : vérification d'adresse, mot de passe oublié (ticket #28).
 *
 * Variables d'environnement :
 *   MAIL_TRANSPORT   « smtp » (défaut si SMTP_HOST est défini), « file » (tests, hors production)
 *                    ou « off » (défaut) : fonctions e-mail désactivées, le jeu fonctionne comme avant.
 *   SMTP_HOST, SMTP_PORT (587), SMTP_SECURE (« true » pour TLS direct, implicite sur le port 465),
 *   SMTP_USER, SMTP_PASS                        serveur d'envoi (jamais journalisés)
 *   MAIL_FROM        expéditeur, ex. « DIG! <dig@lodygames.com> » (obligatoire en smtp)
 *   MAIL_REPLY_TO    adresse de réponse (facultative) : les e-mails invitent à répondre en cas d'abus
 *   MAIL_OUTBOX_DIR  dossier des messages en mode « file » (un fichier JSON par message)
 *   PUBLIC_BASE_URL  adresse publique du jeu pour les liens (défaut https://dig.lodygames.com en
 *                    production) : jamais déduite de l'en-tête Host, qui est falsifiable.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

/** Textes des e-mails (texte brut : rien à échapper, aucun contenu distant). */
const TEMPLATES = {
  fr: {
    test: {
      subject: 'DIG! — E-mail de test',
      text: (u, when) => `Bonjour ${u},\n\nCet e-mail de test confirme que DIG! peut envoyer des messages (${when}).\nVérifie qu'il n'est pas arrivé dans les indésirables.\n\n— DIG!`,
    },
    verify: {
      subject: 'DIG! — Confirme ton adresse e-mail',
      text: (u, link) => `Bonjour ${u},\n\nConfirme ton adresse e-mail pour sécuriser ton compte DIG! :\n${link}\n\nCe lien est valable 48 heures. Si tu n'as rien demandé, ignore ce message.\n\n— DIG!`,
    },
    reset: {
      subject: 'DIG! — Réinitialisation du mot de passe',
      text: (u, link) => `Bonjour ${u},\n\nUne réinitialisation du mot de passe de ton compte DIG! a été demandée.\nChoisis un nouveau mot de passe ici :\n${link}\n\nCe lien est valable 1 heure et ne sert qu'une fois. Si tu n'as rien demandé, ignore ce message : ton mot de passe actuel reste valable.\n\n— DIG!`,
    },
    emailChanged: {
      subject: 'DIG! — Adresse e-mail modifiée',
      text: (u, newEmail) => `Bonjour ${u},\n\nL'adresse e-mail de ton compte DIG! vient d'être remplacée par ${newEmail}.\nSi ce n'est pas toi, réponds à ce message ou contacte le support.\n\n— DIG!`,
    },
    socialLinked: {
      subject: 'DIG! — Compte Google lié',
      text: (u, email) => `Bonjour ${u},\n\nLe compte Google ${email} vient d'être lié à ton compte DIG! : tu peux maintenant te connecter avec Google.\nSi ce n'est pas toi, change ton mot de passe et réponds à ce message.\n\n— DIG!`,
    },
    socialUnlinked: {
      subject: 'DIG! — Compte Google retiré',
      text: (u, email) => `Bonjour ${u},\n\nLe compte Google ${email} n'est plus lié à ton compte DIG!. Ton mot de passe reste valable.\nSi ce n'est pas toi, change ton mot de passe et réponds à ce message.\n\n— DIG!`,
    },
  },
  en: {
    test: {
      subject: 'DIG! — Test email',
      text: (u, when) => `Hi ${u},\n\nThis test email confirms that DIG! can send messages (${when}).\nCheck that it did not land in your spam folder.\n\n— DIG!`,
    },
    verify: {
      subject: 'DIG! — Confirm your email address',
      text: (u, link) => `Hi ${u},\n\nConfirm your email address to secure your DIG! account:\n${link}\n\nThis link is valid for 48 hours. If you did not ask for it, ignore this message.\n\n— DIG!`,
    },
    reset: {
      subject: 'DIG! — Password reset',
      text: (u, link) => `Hi ${u},\n\nA password reset was requested for your DIG! account.\nChoose a new password here:\n${link}\n\nThis link is valid for 1 hour and works only once. If you did not ask for it, ignore this message: your current password still works.\n\n— DIG!`,
    },
    emailChanged: {
      subject: 'DIG! — Email address changed',
      text: (u, newEmail) => `Hi ${u},\n\nThe email address of your DIG! account was just changed to ${newEmail}.\nIf this was not you, reply to this message or contact support.\n\n— DIG!`,
    },
    socialLinked: {
      subject: 'DIG! — Google account linked',
      text: (u, email) => `Hi ${u},\n\nThe Google account ${email} was just linked to your DIG! account: you can now sign in with Google.\nIf this was not you, change your password and reply to this message.\n\n— DIG!`,
    },
    socialUnlinked: {
      subject: 'DIG! — Google account removed',
      text: (u, email) => `Hi ${u},\n\nThe Google account ${email} is no longer linked to your DIG! account. Your password still works.\nIf this was not you, change your password and reply to this message.\n\n— DIG!`,
    },
  },
  nl: {
    test: {
      subject: 'DIG! — Test-e-mail',
      text: (u, when) => `Hallo ${u},\n\nDeze test-e-mail bevestigt dat DIG! berichten kan versturen (${when}).\nControleer of hij niet in je spammap is beland.\n\n— DIG!`,
    },
    verify: {
      subject: 'DIG! — Bevestig je e-mailadres',
      text: (u, link) => `Hallo ${u},\n\nBevestig je e-mailadres om je DIG!-account te beveiligen:\n${link}\n\nDeze link is 48 uur geldig. Heb je niets aangevraagd? Negeer dan dit bericht.\n\n— DIG!`,
    },
    reset: {
      subject: 'DIG! — Wachtwoord opnieuw instellen',
      text: (u, link) => `Hallo ${u},\n\nEr is gevraagd om het wachtwoord van je DIG!-account opnieuw in te stellen.\nKies hier een nieuw wachtwoord:\n${link}\n\nDeze link is 1 uur geldig en werkt maar één keer. Heb je niets aangevraagd? Negeer dan dit bericht: je huidige wachtwoord blijft geldig.\n\n— DIG!`,
    },
    emailChanged: {
      subject: 'DIG! — E-mailadres gewijzigd',
      text: (u, newEmail) => `Hallo ${u},\n\nHet e-mailadres van je DIG!-account is zojuist gewijzigd in ${newEmail}.\nWas jij dit niet? Antwoord op dit bericht of neem contact op met de support.\n\n— DIG!`,
    },
    socialLinked: {
      subject: 'DIG! — Google-account gekoppeld',
      text: (u, email) => `Hallo ${u},\n\nHet Google-account ${email} is zojuist aan je DIG!-account gekoppeld: je kunt nu inloggen met Google.\nWas jij dit niet? Wijzig je wachtwoord en antwoord op dit bericht.\n\n— DIG!`,
    },
    socialUnlinked: {
      subject: 'DIG! — Google-account ontkoppeld',
      text: (u, email) => `Hallo ${u},\n\nHet Google-account ${email} is niet langer gekoppeld aan je DIG!-account. Je wachtwoord blijft geldig.\nWas jij dit niet? Wijzig je wachtwoord en antwoord op dit bericht.\n\n— DIG!`,
    },
  },
};

function pickLang(lang) {
  return Object.prototype.hasOwnProperty.call(TEMPLATES, lang) ? lang : 'fr';
}

/** Adresse publique du jeu (sans barre finale) pour construire les liens des e-mails. */
function resolvePublicBaseUrl(env = process.env) {
  const raw = (env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (raw) return raw;
  return env.NODE_ENV === 'production'
    ? 'https://dig.lodygames.com'
    : `http://127.0.0.1:${env.PORT || 3000}`;
}

/**
 * Construit le service d'envoi. `enabled` = false : aucune fonction e-mail n'est proposée
 * (le jeu et les comptes fonctionnent exactement comme avant #28).
 * `summary` décrit la configuration sans aucun secret (journal) ; `verify()` teste la connexion SMTP.
 * @returns {{ enabled: boolean, mode: string, baseUrl: string, send: Function, compose: Function, verify: Function, summary: string }}
 */
function createMailer(env = process.env) {
  const smtpHost = (env.SMTP_HOST || '').trim();
  const mode     = (env.MAIL_TRANSPORT || (smtpHost ? 'smtp' : 'off')).trim().toLowerCase();
  const from     = (env.MAIL_FROM || '').trim();
  const baseUrl  = resolvePublicBaseUrl(env);
  const disabled = (reason) => {
    if (reason) console.warn(`[mail] e-mails de compte désactivés : ${reason}`);
    return {
      enabled: false, mode: 'off', baseUrl, compose, summary: 'désactivé',
      send: async () => { throw new Error('mail désactivé'); },
      verify: async () => ({ ok: false, error: 'désactivé' }),
    };
  };

  let deliver;
  let verify  = async () => ({ ok: true });
  let summary = mode;
  if (mode === 'file') {
    // Boîte d'envoi locale : tests automatisés uniquement.
    if (env.NODE_ENV === 'production') return disabled('MAIL_TRANSPORT=file refusé en production');
    const dir = (env.MAIL_OUTBOX_DIR || '').trim();
    if (!dir) return disabled('MAIL_OUTBOX_DIR manquant');
    fs.mkdirSync(dir, { recursive: true });
    let n = 0;
    deliver = async (msg) => {
      const file = path.join(dir, `${Date.now()}-${process.pid}-${++n}.json`);
      fs.writeFileSync(file, JSON.stringify({ ...msg, from: from || 'dig@localhost' }));
    };
  } else if (mode === 'smtp') {
    if (!smtpHost) return disabled('SMTP_HOST manquant');
    if (!from)     return disabled('MAIL_FROM manquant');
    if (!senderDomain(from)) return disabled('MAIL_FROM sans adresse valide');
    const nodemailer = require('nodemailer');
    const port = parseInt(env.SMTP_PORT, 10) || 587;
    const transport = nodemailer.createTransport({
      host:   smtpHost,
      port,
      secure: String(env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465,
      auth:   env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS || '' } : undefined,
      // Aucun contenu lu depuis un fichier ou une URL : les messages sont du texte construit ici.
      disableFileAccess: true,
      disableUrlAccess:  true,
      connectionTimeout: 10_000,
      greetingTimeout:   10_000,
      socketTimeout:     20_000,
    });
    const replyTo = (env.MAIL_REPLY_TO || '').trim() || undefined;
    deliver = (msg) => transport.sendMail({ from, replyTo, ...msg });
    // Connexion et authentification sans envoi (ticket #43) : erreur réduite à son code.
    verify = () => transport.verify().then(() => ({ ok: true }), err => ({ ok: false, error: smtpErrorSummary(err) }));
    summary = `SMTP ${smtpHost}:${port} (${port === 465 || String(env.SMTP_SECURE || '').toLowerCase() === 'true' ? 'TLS direct' : 'STARTTLS si proposé'}), `
      + `expéditeur @${senderDomain(from) || '?'}${env.SMTP_USER ? ', authentifié' : ', sans authentification'}`;
  } else {
    return disabled(mode === 'off' ? null : `MAIL_TRANSPORT=${mode} inconnu`);
  }

  return { enabled: true, mode, baseUrl, compose, send: deliver, verify, summary };
}

/** Domaine de l'adresse d'expédition (« DIG! <dig@exemple.be> » → « exemple.be »). */
function senderDomain(from) {
  const m = /@([A-Za-z0-9.-]+\.[A-Za-z]{2,})>?\s*$/.exec(String(from || '').trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * Résumé d'une erreur SMTP pour le journal : code et réponse numérique seulement. Le texte du
 * serveur distant peut citer l'identifiant ; le mot de passe n'y figure jamais, mais on s'en tient
 * aux codes, suffisants pour diagnostiquer (EAUTH = identifiants refusés, ECONNECTION…).
 */
function smtpErrorSummary(err) {
  const parts = [];
  if (err && err.code) parts.push(String(err.code).replace(/[^A-Z0-9_]/gi, ''));
  if (err && err.responseCode) parts.push(String(err.responseCode).replace(/\D/g, ''));
  return parts.length ? parts.join(' ') : 'erreur inconnue';
}

/**
 * Prépare un message { to, subject, text }.
 * @param {'verify'|'reset'|'emailChanged'|'socialLinked'|'socialUnlinked'|'test'} kind
 * @param {{ to: string, username: string, lang?: string, arg: string }} p  arg = lien, nouvelle adresse ou adresse Google
 */
function compose(kind, { to, username, lang, arg }) {
  const tpl = TEMPLATES[pickLang(lang)][kind];
  return { to, subject: tpl.subject, text: tpl.text(username, arg) };
}

module.exports = { createMailer, resolvePublicBaseUrl, compose, pickLang, senderDomain, smtpErrorSummary };
