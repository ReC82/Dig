# Ticket #43 — [P1] SMTP du jeu — vérification d'adresse, mot de passe oublié et notifications

## Mise à jour du 03/11/2026 — diagnostic pré-bêta (inscription et mot de passe oublié)

Demande du propriétaire (commentaire du 02/11) : vérifier ce qui fonctionne aujourd'hui, distinguer
OAuth, SMTP absent et compte de test, proposer un parcours d'inscription réellement utilisable pour
une pré-bêta de 3 à 5 proches avec des avertissements précis, et classer le blocage de la récupération.

### État réel

**Déployé en production (SHA `cfa125c`, 03/11 03:14 Bruxelles) — en attente de recette.**
Aucune configuration SMTP n'a été créée ni simulée ; aucun identifiant demandé ni journalisé.

### Diagnostic (production, 03/11, mesuré et non supposé)

| Parcours | État aujourd'hui | Preuve |
|---|---|---|
| Inscription nom + e-mail + mot de passe | **Fonctionne.** Compte créé et connecté tout de suite ; aucune vérification d'adresse exigée pour jouer. | Mode d'inscription `open` (`/api/beta/config`) ; essai complet inscription → déconnexion → reconnexion sur un serveur de test avec le code déployé. |
| Connexion par mot de passe | **Fonctionne.** | Même essai. |
| Vérification de l'adresse e-mail | **Inactive.** L'adresse est enregistrée mais jamais vérifiée ; le bouton « Vérifier » n'apparaît pas. | `/api/me` → `"mail":false`. |
| Mot de passe oublié (libre-service) | **Impossible.** Le lien est masqué et l'API répond 503 « Envoi d'e-mails indisponible ». | `POST /api/auth/password/forgot` → 503 sur le serveur de test. |
| Mot de passe oublié (par toi) | **Fonctionne.** Panel admin → fiche du joueur → « Mot de passe temporaire » (saisie du nom pour confirmer, affiché une seule fois, sessions fermées). Le joueur le change ensuite dans Paramètres → Compte. | Route `POST /api/admin/players/:id/temp-password` (#57), couverte par les tests. |
| Google (OAuth via Auth0) | **Pas un parcours d'inscription.** Mode `link` limité à une liste de comptes : pas de bouton public, pas de création de compte « Google seul ». | `/api/me` → `social.loginButton:false`, `canLink:false`. |
| Compte de test | Aucun compte de test dédié n'est nécessaire : un compte créé normalement par l'inscription suffit. La base ne contient aujourd'hui qu'**un seul compte**. | Empreintes de déploiement (`users` : 1 ligne). |
| DNS d'envoi | Inchangé : `lodygames.com` et `lodylands.com` ont toujours un MX nul (`0 .`), ni SPF ni DMARC. | Requête DNS publique du 03/11. |

### Changement livré (petit, côté joueur)

Quand les e-mails sont inactifs, l'écran Paramètres → Compte dit précisément quoi faire :

- **Onglet « Créer un compte »** : « ⚠️ Bêta : la récupération du mot de passe par e-mail n'est pas
  encore active. Note bien ton mot de passe. Ton adresse n'est pas vérifiée pour l'instant. »
- **Onglet « Connexion »** : « Mot de passe oublié ? La récupération par e-mail n'est pas encore
  active : contacte l'organisateur de la bêta, qui peut te donner un mot de passe temporaire (à
  changer ensuite dans Paramètres). » + bouton Discord **seulement si** un lien Discord est
  enregistré dans le panel (onglet Bêta) — aucun lien inventé.
- FR, EN, NL, ES. Dès que les e-mails seront actifs (`mail:true`), ces textes disparaissent et le
  lien « Mot de passe oublié ? » automatique revient, sans nouveau déploiement.

Fichiers : `public/js/main.js` (`_noMailForgotHtml`, deux conditions dans le formulaire),
`public/js/beta.js` (lecture du lien Discord), `public/js/i18n.js` (2 clés × 4 langues),
`test/account-forms.test.js` (nouveau test). Aucune modification serveur, aucune migration.

### Classement du blocage

- **Pré-bêta à 3–5 proches : NON bloquant.** Tu connais chaque joueur et tu peux lui donner un mot
  de passe temporaire depuis le panel en une minute. Les joueurs sont prévenus à l'inscription.
- **MVP public : BLOQUANT** (inchangé). Un inconnu qui oublie son mot de passe n'a aucun moyen
  autonome de récupérer son compte, et tu ne peux pas vérifier son identité.

### Parcours recommandé pour la pré-bêta

1. Envoie le lien `https://dig.lodygames.com` à tes proches (inscription ouverte) ou, si tu veux
   limiter l'accès, passe l'inscription en « Sur invitation » dans le panel (onglet Bêta) et
   envoie un code à chacun.
2. Demande-leur d'utiliser une vraie adresse e-mail (elle servira à la récupération quand le SMTP
   sera actif) et de noter leur mot de passe.
3. Optionnel : enregistre le lien Discord de la bêta dans le panel → il apparaît sous l'avertissement
   « Mot de passe oublié ? ».
4. Oubli : panel → Joueurs → fiche → « Mot de passe temporaire » → transmets-le en privé.

### Vérifications

- `npm test` 454/454 sur la branche, sur `develop` (`cfa125c`) et sur la release exacte.
- Navigateur headless (serveur de test, puis production) en 1280×900 et 390×844 : les deux textes
  s'affichent, pas de lien « Mot de passe oublié » automatique, aucune erreur JavaScript.
- Copie de la base de production démarrée en mode production : empreintes identiques avant/après.
- Déploiement `fbc83f7 → cfa125c` : sauvegarde vérifiée
  `~/backups/dig/dig-20261103-031357-pre-deploy-cfa125c.sqlite` ; 2 domaines 200 ;
  `/api/version` = `1.0.0+cfa125c` ; journal sans erreur ; `quick_check` ok ; empreintes joueurs
  identiques à la sauvegarde pré-déploiement. Aucune génération IA en cours au moment du
  redémarrage (dernier appel admin à 00:26).
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep fbc83f7` + `sudo systemctl restart dig`
  (aucune dépendance ni donnée modifiée).

### Test fonctionnel à faire (5 minutes)

1. Fenêtre privée → https://dig.lodygames.com → ⚙️ Paramètres → Compte.
   Attendu : sous « Se connecter », le texte « Mot de passe oublié ? La récupération par e-mail
   n'est pas encore active… ».
2. Onglet « Créer un compte » → attendu : l'avertissement ⚠️ Bêta sous les indications.
3. Crée un compte de test (ex. `test-preb1`, une de tes adresses), joue un peu, déconnecte-toi.
4. Panel → Joueurs → `test-preb1` → « Mot de passe temporaire » → reconnecte-toi avec ce mot de
   passe → Paramètres → change-le. Attendu : progression conservée.

### Décisions demandées (inchangées, nécessaires seulement pour le MVP public)

1. Fournisseur d'envoi : A) compte SMTP existant, B) Brevo (UE, gratuit jusqu'à 300 e-mails/jour),
   C) Amazon SES (exclu sans validation AWS). **Recommandation : B.**
2. Adresse d'expédition : a) `no-reply@mail.lodygames.com` avec SPF/DKIM/DMARC, b) domaine
   principal (retirer le MX nul). **Recommandation : a**, avec `MAIL_REPLY_TO` vers ton support.
3. Puis lancer toi-même en SSH : `sudo bash /home/ubuntu/Dig/scripts/dig-smtp-config.sh`.

### Restant

- MVP public : choix du fournisseur + DNS + lancement du script (propriétaire).
- Après lancement : rien d'autre dans ce ticket.


Lien : https://github.com/ReC82/Dig/issues/43

## 1. État réel (30/10/2026, 19:35 Bruxelles)

**Déployé en production (SHA `bbdb1d6`). En attente de ton choix de fournisseur, de ta
configuration DNS et du lancement du script.** Le jeu n'envoie toujours aucun e-mail
(`/api/me` → `"mail":false`), comme prévu : aucun identifiant SMTP n'existe sur le serveur et
aucune session n'a le droit d'en créer.

Classement : **Bloquant MVP public.** Sans e-mail, un joueur qui oublie son mot de passe perd
l'accès à son compte.

## 2. Constat important : le domaine ne peut pas encore envoyer d'e-mails

Interrogation DNS publique du 30/10 :

| Domaine | MX | SPF | DMARC |
|---|---|---|---|
| `lodygames.com` | `0 .` (**MX nul** : le domaine déclare qu'il ne reçoit aucun e-mail) | absent | absent |
| `lodylands.com` | `0 .` (MX nul) | absent | absent |

Un e-mail « De : …@lodygames.com » serait aujourd'hui **rejeté ou classé en indésirable** par
Gmail et Outlook : selon la RFC 7505, un domaine à MX nul n'envoie pas d'e-mails, et il manque
SPF et DKIM. Il faut donc des enregistrements DNS avant tout envoi réel (question 2).

## 3. Ce qui a été réalisé

### Préparation côté serveur (déployée)

- **`scripts/dig-smtp-config.sh`** : script de configuration du SMTP du jeu, distinct du SMTP de
  DIGORCH, sur le modèle de `dig-auth0-config`. Il se lance en SSH :
  - `sudo bash /home/ubuntu/Dig/scripts/dig-smtp-config.sh` : demande le serveur, le port,
    l'identifiant, le **mot de passe (saisi sans écho)**, l'adresse d'expédition, le nom affiché,
    une adresse de réponse facultative et l'adresse publique du jeu ;
  - il **teste d'abord la connexion et l'authentification SMTP sans rien modifier**. En cas
    d'échec, il affiche « Rien n'a été modifié » et s'arrête ;
  - il affiche SPF et DMARC du domaine d'expédition ;
  - il sauvegarde `/etc/dig/dig.env` (`dig.env.avant-smtp-<date>`), écrit les variables
    (root, 600, valeurs entre apostrophes, que systemd lit littéralement) et redémarre le jeu ;
  - il contrôle :
    - le journal (`[mail] e-mails de compte actifs …, limites 5 envois/IP/15 min, 20 liens refusés/IP/15 min`
      puis `[mail] connexion SMTP vérifiée`) ;
    - que `/api/me` renvoie `"mail":true` ;
    - que la connexion classique fonctionne toujours.

    Il envoie ensuite **un e-mail de test réel** à l'adresse que tu indiques ;
  - **retour automatique à l'ancienne configuration** si l'un de ces contrôles échoue. Il refuse
    aussi d'activer les e-mails si les limites d'envoi sont désactivées (`RATE_LIMIT=off`) ;
  - `--test [adresse]` : refait les contrôles et l'e-mail de test sans rien modifier.
    `--off` : retire les variables SMTP et redémarre (retour arrière du ticket).
- **`scripts/mail-check.js`** : contrôles appelés par le script. Ils reçoivent la configuration sur
  leur **entrée standard** et ne voient donc jamais un secret en argument (`ps`). Ils tournent sous
  l'utilisateur du service (`ubuntu`), pas en root. Les erreurs sont réduites à leur code
  (`EAUTH 535` = identifiants refusés ; `ECONNECTION`/`ETIMEDOUT` = serveur ou port injoignable).
- **`server/mailer.js`** :
  - nouveau `verify()` qui teste la connexion SMTP sans envoyer ;
  - `summary`, une description de la configuration sans identifiant ni mot de passe ;
  - nouveau modèle « e-mail de test » en FR, EN et NL ;
  - un `MAIL_FROM` sans adresse valide est désormais refusé.
- **`server/index.js`** : au démarrage, une ligne `[mail]` décrit la configuration et les limites
  actives, puis la connexion SMTP est vérifiée et le résultat journalisé. Sans configuration SMTP,
  rien ne change et le journal ne contient aucune ligne `[mail]`.
- **`server/rateLimits.js`** : nouvelle fonction `describeMailLimits()` qui fournit le texte des
  limites pour le journal. Les limites elles-mêmes n'ont pas changé.
- **`docs/OPERATIONS.md`** : procédure complète (configuration, contrôle, retour arrière, codes d'erreur).

### Déjà en place depuis #28 (vérifié, non modifié)

- Vérification d'adresse, mot de passe oublié (réponse identique que le compte existe ou non),
  avis de changement d'adresse, notifications de liaison et de retrait du compte Google.
- Limites : `RATE_MAIL_MAX` (5/IP/15 min), `RATE_TOKEN_MAX` (20 liens refusés/IP/15 min) et
  1 envoi par compte et par type toutes les 60 s.

## 4. SHA, branche, procédure de test

- Branche : `feature/43-smtp-jeu` (commit `81fae50`).
- **SHA sur `develop` : `bbdb1d6`** (fusion), déployé.
- Tests automatisés : `npm test` → **302/302**. Le nouveau fichier `test/smtp-config.test.js`
  utilise un faux serveur SMTP local sur 127.0.0.1:2525 et un serveur de jeu de test sur le port 3153. Il couvre :
  - `verify()` : identifiants bons ou refusés (`EAUTH 535`), résumé sans secret, `MAIL_FROM` invalide ;
  - `mail-check.js` : configuration lue sur l'entrée standard, e-mail de test accepté ou destinataire
    refusé, aucun mot de passe dans les sorties ;
  - **le script complet dans un bac à sable**, en 4 cas :
    1. mauvais mot de passe : fichier inchangé, aucune sauvegarde ;
    2. e-mail de test refusé : configuration installée puis **retirée automatiquement**, fichier
       revenu à l'identique ;
    3. configuration valide : variables écrites, autres lignes conservées, mode 600, e-mail reçu,
       `"mail":true`, ligne de journal avec les limites, mot de passe absent des sorties et du journal ;
    4. `--off` : variables retirées, `"mail":false`.

  Le bac à sable n'est actif que hors root ; `sudo` ne transmet pas ses variables.
- Vérifié à la main : la lecture littérale des valeurs entre apostrophes par systemd, dans la
  documentation de systemd 255 installé (`man systemd.exec`, § EnvironmentFile).

## 5. Vérifications, limites, impact sur les données

- Aucune migration ni écriture en base. Copie de la base de production démarrée en mode
  production avec `bbdb1d6` : empreintes identiques (`users`, `user_saves`, `season_rankings`,
  `seasons`, `leagues`, `player_click_tracking`).
- **Non vérifié (impossible sans toi) :**
  - un envoi réel par un vrai fournisseur ;
  - la délivrabilité : SPF et DKIM valides, message hors des indésirables ;
  - ta recette en jeu.
- Limite : un mot de passe SMTP contenant une apostrophe (`'`) est refusé par le script. Les
  mots de passe générés par les fournisseurs n'en contiennent pas.
- Limite : AWS bloque souvent le port 25 en sortie. Utiliser 587 (STARTTLS) ou 465 (TLS direct).

## 6. Déploiement

- **SHA déployé : `bbdb1d6`**, le 30/10 à 19:33 (Bruxelles), depuis `af523fb` (avance rapide de `main`).
- Sauvegarde pré-déploiement vérifiée :
  `~/backups/dig/dig-20261030-193312-pre-deploy-bbdb1d6.sqlite`.
- Contrôles :
  - 302/302 sur le SHA exact (release) ;
  - copie de production identique ;
  - https://dig.lodygames.com et https://dig.lodylands.com → 200, `/api/version` = `1.0.0+bbdb1d6` ;
  - `/api/me` → `"mail":false` (inchangé) ;
  - journal sans erreur ;
  - `pragma quick_check` = ok ;
  - empreintes identiques à la sauvegarde pré-déploiement.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep af523fb && sudo systemctl restart dig`.
  Le changement n'a aucun effet tant que le SMTP n'est pas configuré.

### Ce que tu dois faire (≈ 30 min, une seule fois)

1. Choisir le fournisseur et l'adresse d'expédition (questions 1 et 2).
2. Chez le fournisseur : authentifier le domaine d'expédition. Il te donne les enregistrements
   SPF et DKIM à ajouter dans le DNS. Ajouter aussi `_dmarc` → `v=DMARC1; p=none`.
3. En SSH : `sudo bash /home/ubuntu/Dig/scripts/dig-smtp-config.sh`. Répondre aux questions, puis
   donner ton adresse pour l'e-mail de test.
4. Dans l'e-mail de test reçu : vérifier qu'il n'est **pas dans les indésirables**. Ensuite,
   « Afficher l'original » (Gmail) doit indiquer **SPF : PASS** et **DKIM : PASS**.

### Test fonctionnel à faire dans le jeu (après l'étape 3, 5 min)

1. **Vérifier mon adresse** : Paramètres → Compte → « Envoyer le lien de confirmation ». L'e-mail
   arrive en moins d'une minute. Son lien ouvre le jeu avec le message « Adresse e-mail confirmée ! ».
2. **Mot de passe oublié** : se déconnecter, puis « Mot de passe oublié ? », saisir ton nom
   d'utilisateur et cliquer sur « Envoyer le lien ». L'e-mail arrive, son lien permet de choisir un nouveau mot de passe, et tu es
   reconnecté. **Pièces, profondeur et pioche sont intactes.** L'ancien mot de passe est refusé.
3. **Notifications Google** : lier puis retirer le compte Google (Paramètres → Compte). Un e-mail
   « Compte Google lié », puis un e-mail « Compte Google retiré » arrivent à l'adresse du compte.
4. **Limite** : demander 6 fois « Mot de passe oublié » en moins de 15 min. La 6ᵉ demande affiche
   « Trop de tentatives » et un seul e-mail arrive par minute.

## 7. Choix techniques faits seul

- **Le script est dans le dépôt** (`scripts/dig-smtp-config.sh`) au lieu de `/usr/local/sbin`.
  Il est ainsi versionné, testé et livré par le déploiement, et une session n'a pas à modifier
  `/usr/local/sbin`. Il se lance avec `sudo bash …`.
- **Test SMTP avant toute écriture** : un mauvais mot de passe ne redémarre jamais le jeu.
- **Valeurs entre apostrophes** dans `dig.env` : systemd les lit littéralement, sans risque avec
  `$`, `\`, `#` ou les espaces d'un mot de passe.
- **Mot de passe masqué ; serveur, identifiant et adresses affichés** : un identifiant qui est
  une adresse e-mail est plus sûr à saisir en le voyant. Ces valeurs n'apparaissent ni dans le
  journal ni dans les rapports.
- **Échec de l'e-mail de test = retour arrière** : si le fournisseur accepte la connexion mais
  refuse l'expéditeur, tous les e-mails du jeu échoueraient.
- **Aucune vérification DKIM automatique** : le sélecteur DKIM dépend du fournisseur. Le
  contrôle se fait dans les en-têtes de l'e-mail reçu.

## 8. Décisions demandées au propriétaire

1. **Fournisseur d'envoi.**
   - A) Réutiliser le compte SMTP de DIGORCH. C'est le plus rapide, mais si c'est une boîte
     personnelle (Gmail ou Outlook), elle n'autorise pas l'envoi « De : …@lodygames.com » et
     ses limites sont basses. Elle mélange aussi rapports techniques et e-mails des joueurs.
   - B) Un service transactionnel européen, par exemple **Brevo** (offre gratuite à 300 e-mails
     par jour, hébergement UE) ou Mailjet.
   - C) Amazon SES : exclu pour l'instant (aucune ressource AWS sans ta validation, #13 reporté).

   **Recommandation : B (Brevo).**
2. **Adresse d'expédition et DNS.** `lodygames.com` a un MX nul et ni SPF ni DMARC.
   - a) **Sous-domaine dédié**, par exemple `DIG! <no-reply@mail.lodygames.com>`, authentifié
     chez le fournisseur (SPF, DKIM et DMARC sur ce sous-domaine). Le MX nul du domaine
     principal reste en place.
   - b) Le domaine principal `no-reply@lodygames.com` : il faut alors retirer le MX nul et
     ajouter SPF, DKIM et DMARC à la racine.

   **Recommandation : a**, avec `MAIL_REPLY_TO` = ton adresse de support, pour que les joueurs
   puissent répondre en cas d'abus.
3. **Lancement du script** : par toi en SSH (recommandé, le mot de passe ne quitte pas ton
   terminal). Aucune session ne peut le faire : écrire dans `/etc/dig/dig.env` et manipuler un
   secret leur sont interdits.

## 9. Restant à réaliser

- **Toi :**
  - décisions 1 et 2 ;
  - enregistrements DNS ;
  - lancement du script ;
  - contrôle de délivrabilité ;
  - recette (section 6).
- Suites prévues par le ticket, **hors périmètre** :
  - exiger une adresse vérifiée pour participer au concours (#30, #31) ;
  - comptes « Google seul » : **après lancement**.
- Suggestion (non faite) : ajouter une ligne « e-mails : actifs/inactifs » à `digorch status`.
