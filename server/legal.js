/**
 * server/legal.js — Page « Confidentialité, cookies et contact » (#45).
 *
 * Décrit les traitements réellement faits par DIG! (vérifiés dans le code au 30/10/2026) ; la
 * section publicité suit l'état effectif des réglages (désactivée par défaut). Les coordonnées
 * de l'éditeur sont saisies par le propriétaire dans le panel admin (aucune n'est inventée).
 * Pas de contenu éditorial artificiel : uniquement l'information due aux joueurs.
 */

'use strict';

const ads = require('./ads');

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const UPDATED = '30 octobre 2026';

function privacyPage(host, canonicalHost) {
  const s = ads.getSettings();
  const contact = s.legalContact
    ? `<p class="contact">${esc(s.legalContact).replace(/\n/g, '<br>')}</p>`
    : '<p><em>Les coordonnées de l\'éditeur sont en cours de publication.</em></p>';
  const adsActive = !ads.blockedReason(host, s);
  const provider = ads.PROVIDERS[s.provider]?.label || s.provider;
  const adsSection = adsActive
    ? `<p>Des bannières publicitaires (${esc(provider)}) peuvent s'afficher en haut de l'écran, <strong>uniquement
      si tu l'acceptes</strong>. Elles sont chargées dans un cadre isolé : la régie n'a accès ni à ton compte,
      ni à ta partie, ni aux cookies du jeu. Elle peut déposer ses propres cookies ou identifiants pour mesurer
      et personnaliser les annonces ; consulte sa politique de confidentialité.</p>
      <p>Sans ton accord, aucun script publicitaire n'est chargé. Tu peux retirer ton accord à tout moment dans
      <strong>Paramètres → Publicité</strong> ; refuser ne change rien à ta progression.</p>`
    : `<p>Le jeu n'affiche actuellement <strong>aucune publicité</strong> et ne charge aucun script publicitaire.
      Si cela change, un choix explicite (accepter ou refuser) te sera demandé avant tout chargement et cette
      page sera mise à jour.</p>`;
  const canonical = `https://${canonicalHost}/legal/confidentialite`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confidentialité, cookies et contact — DIG!</title>
  <meta name="description" content="Données traitées par DIG!, cookies, publicité, droits et contact.">
  <link rel="canonical" href="${canonical}">
  <meta name="color-scheme" content="dark">
  <style>
    body { margin: 0; background: #0f0f1a; color: #e8e8f0; font: 16px/1.6 'Segoe UI', system-ui, sans-serif; }
    main { max-width: 760px; margin: 0 auto; padding: 24px 18px 48px; }
    h1 { color: #f5c518; font-size: 1.6rem; } h2 { color: #f5c518; font-size: 1.15rem; margin-top: 28px; }
    a { color: #f5c518; } table { border-collapse: collapse; width: 100%; font-size: .92rem; }
    td, th { border: 1px solid rgba(255,255,255,.12); padding: 6px 8px; text-align: left; vertical-align: top; }
    .muted { color: #9ca3af; font-size: .88rem; } .contact { background: #1a1a2e; padding: 10px 14px; border-radius: 8px; }
  </style>
</head>
<body>
<main>
  <p><a href="/">← Retour au jeu</a></p>
  <h1>Confidentialité, cookies et contact</h1>
  <p class="muted">Dernière mise à jour : ${UPDATED}.</p>

  <h2>Éditeur et contact</h2>
  ${contact}

  <h2>Données traitées</h2>
  <table>
    <tr><th>Donnée</th><th>Pourquoi</th><th>Base</th></tr>
    <tr><td>Pseudo, mot de passe (stocké haché, jamais en clair), e-mail facultatif</td><td>Créer et protéger ton compte, vérifier l'adresse, récupérer le mot de passe</td><td>Exécution du service</td></tr>
    <tr><td>Connexion Google (facultative) : identifiant du compte Google et e-mail</td><td>Te connecter sans mot de passe</td><td>Exécution du service</td></tr>
    <tr><td>Sauvegarde de partie, résultats de saison</td><td>Retrouver ta progression sur tes appareils ; classement</td><td>Exécution du service</td></tr>
    <tr><td>Pseudo et score dans le classement</td><td>Classement public de la saison</td><td>Exécution du service</td></tr>
    <tr><td>Statistiques de clics et de progression, événements de sécurité (adresse IP uniquement sous forme d'empreinte non réversible)</td><td>Lutter contre la triche, les robots et les abus</td><td>Intérêt légitime (jeu équitable, sécurité)</td></tr>
  </table>
  <p>Les journaux de sécurité sont supprimés après 90 jours. Les données ne sont ni vendues ni transmises à des
  tiers, sauf aux prestataires techniques nécessaires (hébergement chez Amazon Web Services, envoi d'e-mails,
  connexion Google via Auth0 si tu la choisis).</p>

  <h2>Cookies et stockage local</h2>
  <table>
    <tr><th>Nom</th><th>Rôle</th><th>Durée</th></tr>
    <tr><td><code>connect.sid</code> (cookie)</td><td>Garder ta session connectée — strictement nécessaire</td><td>7 jours</td></tr>
    <tr><td>Stockage local du navigateur</td><td>Sauvegarde locale de la partie, langue, préférences, choix concernant la publicité</td><td>Jusqu'à effacement par toi</td></tr>
  </table>
  <p>Le jeu ne dépose aucun cookie de mesure d'audience ni de publicité.</p>

  <h2>Publicité</h2>
  ${adsSection}

  <h2>Tes droits</h2>
  <p>Tu peux demander l'accès à tes données, leur rectification, leur effacement, leur portabilité ou t'opposer
  à un traitement en écrivant à l'éditeur (coordonnées ci-dessus). Tu peux aussi introduire une réclamation
  auprès de l'Autorité de protection des données (Belgique,
  <a href="https://www.autoriteprotectiondonnees.be" rel="noopener">autoriteprotectiondonnees.be</a>)
  ou de l'autorité de ton pays.</p>
</main>
</body>
</html>`;
}

module.exports = { privacyPage };
