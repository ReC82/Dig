# DIG! — Authentification : connexions sociales, Auth0 Free ou OAuth direct (ticket #28)

Version 2, rédigée le 30/10/2026. Elle remplace la version 1 (même jour). Le propriétaire a
corrigé l'objectif : la priorité, ce sont les **connexions sociales** (Google, Apple…), pas
seulement la récupération du mot de passe. Les tarifs viennent de la grille officielle
https://auth0.com/pricing, relevée le 30/10/2026.

> **Rien n'a été souscrit, aucun tenant n'a été créé, aucune connexion sociale n'est active.**
> Ce document sert à préparer une décision. Il ne l'applique pas.

## Décision du propriétaire (30/10/2026)

> **La connexion classique (identifiant ou e-mail + mot de passe) est conservée.** Les connexions
> sociales s'**ajoutent** à elle : ni remplacement, ni migration forcée. Les joueurs existants se
> connectent comme avant. Une identité sociale se relie **explicitement** à un compte DIG!
> existant (§4), sans toucher à la progression, à l'inventaire ni au classement. Le plan, les
> coûts et les limites sont présentés avant toute activation. La connexion en production ne
> change pas sans nouvelle décision.

Les deux architectures (§3) et le plan (§5) respectent déjà cette règle : le formulaire et la
route `/api/login` restent tels quels ; le drapeau `SOCIAL_LOGIN` n'ajoute qu'un bouton.

## 0. Rectificatif de la version 1

| Version 1 (erronée ou incomplète) | Correction |
|---|---|
| « Auth0 n'apporte au MVP rien d'indispensable » ; elle comparait Essentials à 35–700 $/mois | Pour les **connexions sociales**, l'offre **Free suffit** : 0 $/mois jusqu'à **25 000 MAU**, connexions sociales illimitées, passkeys, 1 domaine personnalisé. Essentials n'est pas nécessaire dans l'architecture A ci-dessous. |
| « L'offre gratuite n'inclut pas l'envoi d'e-mails personnalisés » | La grille dit seulement **« Email Workflow : non disponible »** en Free. La documentation SMTP d'Auth0 ne lie pas le fournisseur e-mail à une offre. Dans l'architecture A, **c'est sans effet** : DIG! envoie lui-même ses e-mails (vérification, mot de passe oublié, livrés dans #28). |
| « Préférer Firebase/Supabase à Auth0 » | Ce n'est pas justifié pour les connexions sociales. Le propriétaire veut évaluer Auth0 Free en priorité. Firebase et Supabase restent possibles mais ne sont pas étudiés ici. |
| Migration : « toutes les sessions changent, reconnexion de tous » | C'est faux pour l'architecture A : Auth0 ne sert qu'au bouton « Continuer avec… ». La session DIG! (cookie) et la connexion par mot de passe restent inchangées. |

## 1. Grille officielle Auth0 B2C — Free contre Essentials (30/10/2026)

| Fonction | **Free** | **Essentials** | Effet pour DIG! |
|---|---|---|---|
| Prix | 0 $/mois | dès 35 $/mois (500 MAU ; paliers jusqu'à 50 000) | Free suffit (voir A) |
| Utilisateurs actifs mensuels (MAU) | jusqu'à 25 000 | selon le palier | Largement au-delà du MVP |
| Connexions sociales | illimitées (« sous réserve des limites système ») | illimitées | Google, Apple, Microsoft, Discord… |
| Passkeys | incluses | incluses | Option future |
| Domaine personnalisé | 1 (**vérification de carte bancaire**) | inclus | Sans lui, la page affiche `…eu.auth0.com` |
| **Account Linking** | **non disponible** | inclus | La liaison se fait **dans DIG!** (§4) |
| **Email Workflow** | **non disponible** | inclus | DIG! garde ses propres e-mails |
| **Custom Database Connections** | **non disponible** | **non disponible** (aussi en Essentials) | Les mots de passe restent dans DIG!, sans import dans Auth0 |
| Personnaliser l'inscription et la connexion | non disponible | inclus | Pas gênant : DIG! affiche ses propres boutons et passe `connection=google-oauth2`, ce qui saute la page Auth0 |
| Expérience de connexion configurable | incluse | incluse | Logo et couleurs |
| Actions + Forms | 5 | 10 | Inutile au départ |
| MFA Pro / Entreprise | non disponible | incluse (la page la cite aussi en option payante : à confirmer) | DIG! n'en a pas besoin pour le MVP |
| Rétention des journaux | 1 jour | 5 jours | DIG! journalise ses propres connexions |
| Tenants / administrateurs | 1 / 3 | 3 / illimités | 1 tenant de production. Les tests se font sur ce tenant avec une application séparée. |
| Support standard | non | oui | Forum communautaire seulement |

**Limites de débit, offre Free** (documentation « rate limit configurations – free public ») :
`/oauth/token` 30/s ; `/userinfo` 5/min par utilisateur ; `/usernamepassword/login` 5/s ;
API de gestion 2/s. Le fournisseur e-mail de test d'Auth0 est limité à 10 e-mails/min, sans
modèles personnalisés, et n'est pas prévu pour la production. DIG! n'en dépend pas.

**Clés de développement** : les clés sociales fournies par Auth0 sont réservées aux essais, pas à
la production. Il faut créer **son propre client Google** (gratuit). Pour Apple, il faut
**l'Apple Developer Program, 99 $/an**, que la connexion passe par Auth0 ou non.

## 2. Contraintes côté DIG!

- La table `users` reste la **source de vérité**. Elle contient `id`, `username`, `email` (unique),
  `password_hash` (NOT NULL), `email_verified_at` et `auth_version` (#28). La progression est liée
  à `users.id` (`user_saves`, `season_rankings`…). **Aucune de ces tables ne doit être réécrite.**
- La session est un cookie `express-session` sur le même domaine. La PWA reste sur ce cookie.
- Ajout nécessaire, dans les deux architectures et sans rien détruire : une table
  `user_identities (user_id → users.id, provider, subject, email, email_verified, created_at,
  last_login_at, UNIQUE(provider, subject))`. S'y ajoute une colonne `users.password_set`
  (défaut 1). Un compte créé par connexion sociale reçoit un hachage aléatoire inutilisable et
  `password_set = 0`. Il peut définir un mot de passe plus tard, par le lien e-mail de #28.

## 3. Les deux architectures

### A. Auth0 Free comme fournisseur d'identité social (OIDC), DIG! source de vérité

1. Le joueur clique « Continuer avec Google » (bouton DIG!).
2. Le serveur DIG! redirige vers Auth0 `/authorize` (code d'autorisation, PKCE, `state` et
   `nonce` à usage unique, `connection=google-oauth2`). Auth0 envoie directement vers Google.
3. Au retour sur `/auth/callback`, DIG! échange le code contre un jeton d'identité. Il vérifie la
   signature (JWKS), `iss`, `aud`, `exp` et `nonce`, puis lit `sub` (ex. `google-oauth2|1234…`),
   `email` et `email_verified`.
4. DIG! cherche `(provider='auth0', subject=sub)` dans `user_identities`, puis applique les règles
   du §4. Ensuite il ouvre **sa propre session** (régénérée) et n'utilise plus les jetons Auth0.

- Une seule intégration OIDC donne accès à tous les fournisseurs activés dans Auth0. Le tableau de
  bord Auth0 gère les quirks propres à chaque fournisseur (Apple : `form_post`, secret client JWT
  à renouveler, nom transmis une seule fois, adresse relais privée).
- Account Linking n'est pas nécessaire dans Auth0. Chaque fournisseur y garde un profil séparé
  (un `sub` chacun), et c'est DIG! qui relie plusieurs `sub` au même `users.id`.
- Sortie possible plus tard : le `sub` Auth0 contient l'identifiant natif
  (`google-oauth2|<sub Google>`, `apple|<sub Apple>`). Il faut le conserver. On pourra alors
  passer à l'architecture B sans demander aux joueurs de relier à nouveau leurs comptes
  (pour Apple, avec la même Team ID).

### B. OAuth/OIDC social directement dans DIG!

- Même parcours, mais DIG! parle directement à Google (OIDC standard, gratuit) puis, si décidé,
  à Apple (99 $/an), Microsoft ou Discord. Chaque fournisseur demande son client, ses secrets,
  ses particularités et ses tests.
- Bibliothèque : `openid-client` (une dépendance, certifiée OpenID) plutôt qu'un code écrit à la
  main.
- Pas de sous-traitant d'identité supplémentaire : seul le fournisseur social intervient.

### Comparaison

| Critère | **A. Auth0 Free + DIG!** | **B. OAuth direct dans DIG!** |
|---|---|---|
| Coût | 0 $ (≤ 25 000 MAU) ; domaine personnalisé facultatif (carte bancaire, sans frais annoncés) ; Apple 99 $/an | 0 $ ; Apple 99 $/an |
| Effort, Google seul | ≈ 1,5–2 j (OIDC + liaison §4 + tests) + configuration du tenant | ≈ 1,5–2 j (presque le même) |
| Effort, chaque fournisseur suivant | ≈ 0,5 j (activation + bouton + test) | ≈ 1–2 j (Apple surtout) |
| Sécurité | Protocole et clés sociales gérés par Auth0 ; une surface en plus (tenant, comptes administrateurs à protéger par MFA) ; journaux Auth0 gardés 1 jour | Moins d'intermédiaires ; DIG! doit gérer lui-même les secrets et la rotation des clés de chaque fournisseur |
| Dépendance | Si Auth0 tombe ou change ses conditions, **seule** la connexion sociale s'arrête. Mot de passe et sessions continuent. | Seulement le fournisseur social |
| RGPD | Auth0/Okta devient **sous-traitant** : tenant en **région UE**, DPA Okta à accepter, transferts encadrés, mention dans la politique de confidentialité et le registre. Auth0 garde une copie du profil social (nom, e-mail, photo). | Pas de sous-traitant en plus ; mention du fournisseur social dans la politique |
| Fournisseurs | Liste Auth0 (Google, Apple, Microsoft, Facebook, Discord, GitHub, X…) activable sans code | Un par un |
| Page intermédiaire | Une redirection rapide par `…eu.auth0.com`, ou un domaine personnalisé (`auth.lodygames.com`) | Aucune |
| PWA installée | Redirection pleine page : à tester sur iOS (la PWA peut s'ouvrir dans Safari) | Même point |
| Risque de comptes en double | Même règle dans les deux cas (§4). Free n'a pas d'Account Linking, ce qui écarte toute fusion automatique côté Auth0. | Même règle |
| Retour arrière | Désactiver le drapeau `SOCIAL_LOGIN` ; aucune donnée à défaire | Même chose |

**Recommandation : A (Auth0 Free), en commençant par Google seul**, comme le propriétaire
préfère. Avec un seul fournisseur, A et B demandent presque le même effort. A devient plus
rentable dès le deuxième fournisseur (Apple surtout), sans coût mensuel, avec une sortie possible
vers B. Conditions : tenant en région UE, MFA sur les comptes administrateurs Auth0, aucune
donnée de progression chez Auth0.

## 4. Liaison sûre des comptes existants (obligatoire, A comme B)

Principe : **une identité sociale n'est jamais rattachée à un compte DIG! sur la seule égalité des
adresses e-mail.** Une liaison exige la preuve des **deux** identités dans la même démarche, et la
progression n'est jamais touchée : on ajoute une ligne `user_identities`, sans rien d'autre.

1. **Identité déjà liée** `(provider, subject)` → connexion au compte lié. Rien d'autre.
2. **Identité inconnue, joueur non connecté** → l'identité sociale est gardée **en attente** dans
   la session (10 min, usage unique), puis deux choix sont proposés :
   - « **J'ai déjà un compte DIG!** » : le joueur se connecte par nom d'utilisateur + mot de passe
     (ou par le lien « mot de passe oublié » envoyé à l'adresse du compte DIG!). La liaison n'a
     lieu qu'après cette preuve.
   - « **Créer un nouveau compte** » : il choisit un nom d'utilisateur. L'adresse sociale n'est
     reprise que si le fournisseur la dit vérifiée **et** qu'aucun compte ne l'utilise déjà.
     Sinon, il doit saisir une autre adresse.
   - Si l'adresse sociale **vérifiée** correspond à un compte existant, DIG! le **suggère**
     (« Un compte DIG! utilise déjà cette adresse : connecte-toi pour le lier ») mais **ne lie
     rien** sans l'étape précédente. Si l'adresse n'est pas vérifiée par le fournisseur, DIG! ne
     dit pas qu'un compte existe (pas d'énumération).
3. **Liaison depuis Paramètres → Compte** (joueur connecté) : « Lier Google » demande le **mot de
   passe actuel** (ou une connexion de moins de 5 min), puis lance le flux social avec
   `prompt=login`. L'identité est refusée si elle est déjà liée à un **autre** compte : DIG! ne
   fusionne jamais deux progressions (cas rare, traité à la main par l'administrateur).
4. **Délier** : permis seulement s'il reste un autre moyen de connexion (mot de passe défini ou
   autre identité).
5. Chaque liaison ou retrait est **notifié** à l'adresse du compte (si le SMTP est configuré) et
   incrémente `auth_version` lors d'un retrait, ce qui ferme les autres sessions.
6. **Adresse vérifiée** : la connexion sociale ne marque `email_verified_at` que si l'adresse
   sociale vérifiée est **identique** à `users.email`. Sinon l'adresse du compte reste à confirmer
   par le lien DIG! (important pour le concours, #30/#31).
7. Sécurité du flux : `state`, `nonce` et vérificateur PKCE à usage unique ; `redirect_uri` fixe
   construit depuis `PUBLIC_BASE_URL` ; session régénérée à la connexion ; limitation de débit
   sur `/auth/*` ; aucun jeton social conservé.

## 5. Plan de test et de mise en place progressive (avec retour arrière)

**Tests automatisés** (avant toute activation), avec un faux émetteur OIDC local dans les tests
(clé générée au lancement, aucun appel extérieur) :
nouveau compte ; identité connue ; adresse identique **sans** liaison automatique ; liaison après
mot de passe ; refus d'une identité liée ailleurs ; refus de délier la dernière méthode ;
`state`/`nonce` rejoués, signature, `iss`, `aud` ou `exp` invalides ; progression
(`user_saves`) identique, octet pour octet, avant et après la liaison.

| Étape | Contenu | Visible pour les joueurs | Retour arrière |
|---|---|---|---|
| 0 | **Décisions du propriétaire** (§6) ; il crée le tenant (région UE) et le client Google, et dépose les secrets dans `/etc/dig/dig.env` | Non | — |
| 1 | Migration **additive** (`user_identities`, `users.password_set`), testée sur une copie de la production ; code déployé avec `SOCIAL_LOGIN=off` | Non | Redéployer le SHA précédent ; la table vide reste sans effet |
| 2 | `SOCIAL_LOGIN=link` et liste blanche : seul le propriétaire voit « Lier Google » dans Paramètres. Test réel sur ordinateur, téléphone et PWA. | Propriétaire seul | Drapeau `off` : le compte garde son mot de passe |
| 3 | `link` pour tous : **liaison de comptes existants uniquement**, pas de création de compte social seul | Oui | `off` : tout le monde garde son mot de passe |
| 4 | `on` : création de comptes par Google, **seulement une fois le SMTP actif** (filet de secours : définir un mot de passe par e-mail) | Oui | `off` : les comptes « Google seul » passent par « mot de passe oublié » avec leur adresse vérifiée |
| 5 | Apple puis d'autres fournisseurs, si décidé (Apple : 99 $/an) | Oui | Désactiver la connexion dans Auth0 ou le drapeau |

Aucune étape ne modifie les comptes, sauvegardes ou classements existants. Le retour arrière
complet consiste à mettre le drapeau à `off`. La table `user_identities` peut rester en place.

## 6. Décisions demandées au propriétaire

1. **Architecture** : A (Auth0 Free) ou B (OAuth direct). **Recommandé : A**, en commençant par
   Google.
2. **Fournisseurs** : Google d'abord (gratuit). Apple demande l'Apple Developer Program
   (99 $/an). **Recommandé : Google seul pour commencer.**
3. **Tenant Auth0** (à créer par le propriétaire, aucune session ne le fera) : région **UE**, MFA
   sur le compte administrateur, client Google « Web » à son nom. Il faut aussi choisir entre le
   domaine `…eu.auth0.com` et un domaine personnalisé (`auth.lodygames.com`, carte bancaire à
   vérifier). **Recommandé : le domaine par défaut pour les essais.**
4. **Création de comptes « Google seul »** ou liaison seulement au début. **Recommandé : liaison
   seulement (étapes 2–3), création après activation du SMTP.**
5. Toujours en attente depuis la version 1 : **SMTP du jeu** et **adresse vérifiée exigée pour le
   concours** (#30/#31).

## 7. L'existant amélioré (livré dans #28, en production depuis `994705e`)

Ces fonctions restent la base, avec ou sans connexion sociale :
- vérification de l'adresse (lien unique, 48 h) ;
- mot de passe oublié (réponse non énumérante, lien 1 h, autres sessions fermées) ;
- changement de mot de passe (mot de passe actuel exigé) ;
- changement d'adresse (effectif après confirmation, ancienne adresse prévenue) ;
- jetons de 256 bits stockés hachés, limites par IP et par compte.

Les fonctions qui envoient un e-mail restent masquées tant que le SMTP n'est pas configuré
(`/etc/dig/dig.env` : `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`,
`MAIL_REPLY_TO` facultatif, `PUBLIC_BASE_URL`), puis redémarrage de `dig.service`. Détails :
`docs/OPERATIONS.md`. Pour éviter le dossier indésirable, configurer SPF et DKIM sur le domaine
de `MAIL_FROM`.

Pour le concours (#27, #30, #31) : le gagnant est contacté **seulement** à l'adresse vérifiée,
jamais publiée. Recommandé : n'autoriser la participation qu'aux adresses vérifiées.

## Sources (consultées le 30/10/2026)

- Auth0, tarifs et grille détaillée : https://auth0.com/pricing (et https://auth0.com/fr/pricing)
- Auth0, limites de débit Free : https://auth0.com/docs/troubleshoot/customer-support/operational-policies/rate-limit-policy/rate-limit-configurations/free-public
- Auth0, fournisseurs e-mail : https://auth0.com/docs/customize/email/smtp-email-providers
- Auth0, liaison de comptes (mises en garde) : https://auth0.com/docs/manage-users/user-accounts/user-account-linking
- Auth0, clés de développement : https://auth0.com/docs/authenticate/identity-providers/social-identity-providers/devkeys
- Apple Developer Program (99 $/an, nécessaire pour Sign in with Apple) : https://developer.apple.com/programs/
