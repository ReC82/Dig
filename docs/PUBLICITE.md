# Publicité dans DIG! — architecture, réglages et checklist (#45)

État au 30/10/2026 : **préparation livrée, publicité désactivée**. Aucun script de régie n'est
chargé tant que le propriétaire n'a pas, dans le panel admin, collé les codes des unités, choisi la
régie et actionné l'interrupteur général (saisie `ACTIVER`), **et** que le joueur a accepté.

## Fonctionnement

| Élément | Comportement |
|---|---|
| Emplacements | `top_mobile` 320×50 (écran < 760 px) et `top_desktop` 728×90 (≥ 760 px), **au-dessus de l'en-tête**. Jamais sur le bloc, les commandes ni la barre de navigation. Pas de bannière si la fenêtre fait moins de 480 px de haut (téléphone couché). |
| Écran de minage | Option par emplacement « Masquer sur l'écran de minage » : **mobile masqué par défaut** (bannière visible dans les autres vues), ordinateur visible (≈ 190 px entre la bannière et le bloc à 1280×900). |
| Isolation | Le code de la régie est servi par `GET /ads/frame/:slot` et chargé dans une `iframe sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"` : **origine opaque** (aucun accès aux cookies, au stockage, à la session ni au DOM du jeu), **pas de navigation de l'onglet** (pas d'`allow-top-navigation`). Chaque unité a son propre document : la variable globale `atOptions` ne peut pas entrer en conflit. La page du jeu garde sa CSP et ne contient aucun script tiers. |
| CSP du cadre | `default-src 'none'`, script de la régie autorisé par nonce + `'strict-dynamic'` (ses sous-ressources HTTPS sont admises, mais confinées au cadre), `frame-ancestors 'self'`, `Permissions-Policy` sans caméra, micro, géolocalisation, paiement. |
| Domaine | Publicité, cadres et `ads.txt` **uniquement sur les domaines autorisés** (défaut : `dig.lodygames.com`). `dig.lodylands.com` (accès alternatif du propriétaire) ne reçoit jamais de publicité, reste servi directement, **sans redirection** ; son `robots.txt` interdit l'indexation. `<link rel="canonical">` → `https://dig.lodygames.com/`. |
| Consentement | Fenêtre « Publicité et vie privée » (Accepter / Refuser, même poids visuel), affichée seulement si une bannière peut s'afficher. Sans accord : **aucune requête vers la régie**. Choix modifiable dans **Paramètres → Publicité** (retrait = bannière retirée immédiatement). Version de consentement incrémentable depuis l'admin (redemande à tous). |
| Trafic invalide | Bannière chargée **une seule fois par page** : aucun minuteur, aucun rafraîchissement, aucun lien avec les clics, l'Auto-Dig, les scores ou le classement (testé : `public/js/ads.js` ne contient ni `setInterval` ni `setTimeout`). |
| Échec / bloqueur | Si le script de la régie ne se charge pas (bloqueur, réseau), le cadre le signale (`postMessage`) et l'emplacement se replie : aucune pénalité, aucun message. Une absence d'annonce sans erreur laisse un bandeau vide de la taille réservée. |
| Arrêt d'urgence | Interrupteur général dans l'admin, ou `ADS_DISABLED=1` dans l'environnement du service (prioritaire). |
| Statistiques | « Cadres servis » par jour et emplacement (compteur serveur, sans donnée personnelle). **Ce ne sont pas des impressions facturées** ; aucun revenu n'est estimé. Impressions et revenus : tableau de bord de la régie. |
| Sans publicité (futur) | Point d'entrée unique `isAdFree(userId)` dans `server/ads.js`, qui renvoie toujours `false`. Aucun prix, durée ni achat n'est implémenté. |
| Pages | `/legal/confidentialite` : données traitées, cookies, publicité (selon l'état réel), droits, contact (coordonnées saisies dans l'admin, aucune n'est inventée). Lien dans Paramètres et dans la fenêtre de consentement. |

Fichiers : `server/ads.js`, `server/legal.js`, routes dans `server/index.js`, `public/js/ads.js`,
styles en fin de `public/css/style.css`, onglet admin « 📢 Publicité », tests `test/ads.test.js`.
Tables ajoutées : `ad_settings`, `ad_slots`, `ad_daily_stats` (aucune table existante modifiée).

## Mise en service (propriétaire)

1. Admin → 📢 Publicité → **Réglages généraux** : saisir « Éditeur et contact » (nom ou raison
   sociale, pays, adresse e-mail de contact publique) → Enregistrer. Vérifier `/legal/confidentialite`.
2. Confirmer auprès du **support officiel de la régie** que `bauval.org` est bien un domaine de
   diffusion de ses unités (voir « Points à confirmer »).
3. Emplacements : coller le code « GET CODE » de l'unité 320×50 dans « Bannière haute mobile »,
   celui de l'unité 728×90 dans « Bannière haute ordinateur », cocher « Emplacement activé »,
   Enregistrer. Le code est analysé (clé, format iframe, dimensions, script HTTPS), jamais exécuté.
4. Régie : « Adsterra », Enregistrer. Interrupteur général : cocher, saisir `ACTIVER`, Appliquer.
5. Sur `https://dig.lodygames.com` : accepter la fenêtre de consentement, vérifier la bannière ;
   sur `https://dig.lodylands.com` : aucune bannière ni fenêtre.
6. Retour arrière : décocher l'interrupteur général (effet au prochain chargement de page).

## Checklist d'éligibilité et de conformité

| # | Point | État | Preuve / reste à faire |
|---|---|---|---|
| 1 | HTTPS sur le domaine officiel | PASS | `https://dig.lodygames.com` (Certbot, HSTS). |
| 2 | Domaine canonique unique, alias sans redirection | PASS | `rel=canonical`, `robots.txt` par domaine, test HTTP sur les deux noms. |
| 3 | Aucune annonce près du bloc, des commandes ou de la nav | PASS | Bannière au-dessus de l'en-tête ; masquée sur l'écran de minage en mobile ; captures 1280×900 et 390×844. |
| 4 | Pas d'interstitiel, popunder, notification forcée, rafraîchissement artificiel | PASS (côté DIG!) | Aucun format de ce type intégré ; un seul chargement par page. Le contenu servi par la régie reste de sa responsabilité (voir 9). |
| 5 | Auto-Dig sans effet sur les annonces | PASS | Aucun lien code entre `autoDigTick` et `ads.js`. |
| 6 | Pas de script tiers avant consentement | PASS | Testé dans le navigateur : zéro requête externe sans accord ou avec refus. |
| 7 | Retrait du consentement | PASS | Paramètres → Publicité → « Retirer mon accord ». |
| 8 | Politique de confidentialité et cookies | PARTIEL | Page en français ; coordonnées de l'éditeur à saisir (manuel) ; traductions EN/NL/ES à faire (après lancement). |
| 9 | Légitimité de `bauval.org` pour la régie | À CONFIRMER | Depuis le serveur, `https://bauval.org/22/<clé>` répond **403 avec un corps vide** (Cloudflare) : le script n'a pas pu être audité. La page publique du domaine renvoie à BPGame / Game Plan Zero Limited et indique que les contenus partenaires ne sont pas tous modérés. Confirmation écrite du support de la régie nécessaire. |
| 10 | Consentement conforme EEE / Royaume-Uni / Suisse | À CONFIRMER | Fenêtre maison accepter/refuser, sans TCF. Suffisante pour bloquer tout chargement sans accord ; ne transmet aucun signal TCF à la régie. Si la régie exige un CMP certifié IAB TCF v2.2 (obligatoire pour Google AdSense/Ad Manager depuis le 16/01/2024), il faudra en intégrer un. |
| 11 | Mineurs | À CONFIRMER | Aucun contrôle d'âge dans DIG!. Annonces adultes désactivées côté régie (selon le tableau de bord). Décision nécessaire : pas de publicité personnalisée pour les mineurs, ou âge minimal de 13 ans (Belgique), etc. |
| 12 | ads.txt | EN ATTENTE | Champ admin prêt (validé ligne par ligne, servi sur le domaine officiel seulement). Ne rien inventer : à remplir si la régie fournit des lignes. |
| 13 | Revenus | N/A | Non mesurés par DIG!, consultables seulement sur la régie. |

## Vidéo récompensée (proposition, non implémentée)

Décision du propriétaire : vidéo **volontaire** offrant un **boost temporaire de pièces** seulement.
Les unités actuelles sont des bannières ; aucune unité rewarded web n'a été vérifiée pour cette
régie. Architecture proposée, à réaliser après choix d'une régie qui fournit une **preuve
serveur** (postback signé de serveur à serveur) :

1. `POST /api/ads/reward/start` (joueur connecté) → jeton unique à usage unique (utilisateur,
   expiration courte), refusé pendant le délai de récupération.
2. La régie appelle `GET /api/ads/reward/callback` (signature HMAC vérifiée, IP de la régie si
   documentée) → jeton marqué « visionné ». **Aucun événement du navigateur n'est une preuve.**
3. `POST /api/ads/reward/claim` → boost accordé une seule fois par jeton (transaction,
   idempotent), journalisé, plafonné par jour.
4. Pas d'annonce disponible, refus ou visionnage interrompu → message neutre, aucune pénalité.
5. UX : bouton « 📺 Boost pièces » sous la zone de récompense, jamais sur le bloc ; sur PC le
   même bouton (à vérifier avec #46).

À arbitrer : durée et multiplicateur du boost, délai de récupération, plafond quotidien, régie.

**Attention** : le bouton actuel « Doubler la récompense » (`public/js/monetization.js`) lance une
**publicité simulée** de 5 secondes et accorde réellement le bonus. Il ne doit pas être présenté
comme une publicité réelle ; il est traité par #46.

## Régies : état des vérifications

Les conditions d'Adsterra, Monetag, Nitro et CrazyGames (acceptation sans contenu éditorial,
formats, consentement, âge, trafic minimal, paiement, exclusivité) **n'ont pas été confirmées
auprès de sources officielles dans cette session** : les recherches n'ont pas renvoyé de
documentation officielle exploitable sur ces points. Le propriétaire a déjà fait approuver
`dig.lodygames.com` sur une régie de type Adsterra (site 6162894, unités 32005478 et 32005479) ;
l'architecture ci-dessus fonctionne avec tout code de type « atOptions + script iframe ». Une autre
régie demande une nouvelle entrée dans `PROVIDERS` et son générateur de cadre.
