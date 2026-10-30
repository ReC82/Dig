# Ticket #28 — [P1] Authentification — e-mail vérifié et récupération de compte

- Ticket : https://github.com/ReC82/Dig/issues/28
- Session du 30/10/2026 (DIGORCH)

## Session 3 (30/10/2026) — touche Entrée dans les formulaires du compte

### 1. État réel

**Déployé en production (SHA `c23f521`) — en attente de recette.**
- `develop` : `c23f521` (fusion de `a4310d4`, branche `feature/28-auth-email-recuperation`).
- Production : `994705e` → `c23f521`, https://dig.lodygames.com et https://dig.lodylands.com.

### 2. Retours du propriétaire pris en compte

- **Recette étape 2 validée** (11:00) : Paramètres → Compte → « Changer le mot de passe »
  fonctionne, message de succès, session maintenue.
- **Anomalie signalée** : sur PC, **Entrée** dans les champs du changement de mot de passe ne
  validait pas ; il fallait cliquer. **Corrigée dans ce ticket** (ci-dessous).
- **Décision (10:57)** : la connexion classique (identifiant/e-mail + mot de passe) est
  **conservée** ; les connexions sociales s'y **ajoutent**, liaison explicite au compte existant,
  rien ne change en production sans nouvelle décision. Inscrite en tête de
  `docs/AUTH-COMPARATIF.md`. Les deux architectures et le plan respectaient déjà cette règle.

### 3. Changements

`public/js/main.js` — section Compte des Paramètres :
- Les six formulaires deviennent de **vrais `<form novalidate>`** : connexion, inscription,
  mot de passe oublié, nouveau mot de passe (lien e-mail), changement de mot de passe,
  changement d'adresse.
  - Un seul bouton `type="submit"` par formulaire ; les liens (« Mot de passe oublié ? »,
    « Retour », « Annuler ») sont `type="button"` et n'envoient rien.
  - **Entrée et clic passent par le même événement `submit`** (`_onAccountSubmit`).
- **Un seul envoi à la fois** : garde `busy`, bouton désactivé, `aria-busy` sur le formulaire.
  - Avant, la connexion par Entrée pouvait partir plusieurs fois (le gestionnaire clavier
    ignorait le bouton désactivé).
- **Erreurs accessibles** : le message (zone `role="status"` ou `role="alert"`) est relié aux
  champs par `aria-describedby`. Le focus revient au premier champ vide, sinon au premier champ.
- **Erreur réseau** : message « Une erreur est survenue. » et bouton réactivé. Avant, le bouton
  de connexion pouvait rester bloqué.
- Libellés accessibles (`aria-label`) ajoutés aux champs de connexion/inscription, comme les autres.
- **Validation inchangée** : `novalidate` laisse au serveur les mêmes règles et messages.
  Aucune route serveur modifiée.

`test/account-forms.test.js` (nouveau, 3 tests) : chaque formulaire est un `<form>` avec un seul
bouton submit et des types explicites ; chacun passe par `_onAccountSubmit` ; plus de branchement
clic ou Entrée manuel ; `preventDefault`, garde de double envoi, message générique et focus.

`docs/AUTH-COMPARATIF.md` : décision du propriétaire en tête.

### 4. Procédure de test

- `npm test` : **158/158** sur la branche, sur `develop` `c23f521` et sur la release `c23f521`.
  - Sur `develop`, deux passages précédents avaient échoué pour des causes d'environnement :
    un serveur de test orphelin occupait le port 3110 (`ranking-depth`, arrêté), puis un échec
    isolé de `account-recovery` « mot de passe oublié… », réussi seul et au passage complet
    suivant (158/158). Non lié au changement (aucun code serveur touché).
- **Navigateur (Chromium headless, serveur de test port 3101, base temporaire, e-mails en
  fichier)**, ordinateur 1280×900 :
  1. Inscription validée par Entrée.
  2. Changement de mot de passe, mot de passe actuel faux, **Entrée ×3 rapides** (réponse
     retardée de 400 ms) → **1 seule requête**, « Mot de passe actuel incorrect. », focus sur
     « Mot de passe actuel », message relié au champ, pas de rechargement de page.
  3. Mot de passe correct + Entrée → « Mot de passe modifié. ».
  4. Le clic fonctionne toujours (champs vides → message du serveur, focus rendu).
  5. Changement d'adresse validé par Entrée → « Lien envoyé… ».
  6. Déconnexion ; ancien mot de passe + Entrée → refusé, focus rendu ; **nouveau mot de passe
     + Entrée → connecté**.
  7. « Mot de passe oublié » validé par Entrée ; « Retour à la connexion » n'envoie rien.
  8. Lien « nouveau mot de passe » reçu : mot de passe trop court + Entrée → erreur et focus ;
     mot de passe valide + Entrée → connecté.
  - Aucune erreur JavaScript. Smartphone 390×844 : rendu identique à avant.
- **Production** (après déploiement), ordinateur et smartphone : formulaire de connexion, compte
  inexistant + Entrée → « Nom d'utilisateur ou mot de passe incorrect. », focus rendu, aucune
  erreur JavaScript. Aucun compte créé en production.

### 5. Impact sur les données des joueurs

Aucun : seul le client change. Aucune migration, aucune route serveur modifiée.

### 6. Déploiement

- Release `c23f521` : `npm ci`, `npm test` 158/158.
- Copie de la base de production : démarrage `NODE_ENV=production` port 3122, `/health` ok,
  `/api/version` = `1.0.0+c23f521`, **empreintes identiques** (`users`, `user_saves`,
  `season_rankings`, `seasons`, `leagues`, `player_click_tracking`) ; copie supprimée.
- `main` avancé `994705e` → `c23f521` (avance rapide), `scripts/deploy.sh` de la release :
  sauvegarde vérifiée `~/backups/dig/dig-20261030-121755-pre-deploy-c23f521.sqlite`, santé et
  version OK.
- Après : les deux domaines → 200 et `1.0.0+c23f521` ; journal sans erreur ; `quick_check` ok ;
  empreintes identiques à la sauvegarde ; le service worker change de cache (nouvelle version).
- **Retour arrière** : `git -C /home/ubuntu/Dig reset --keep 994705e` + `sudo systemctl restart dig`
  (pas de `npm ci` : verrou inchangé). Aucune donnée à restaurer.

### 7. Test fonctionnel à faire par le propriétaire (sur PC)

1. Recharger le jeu (Ctrl+F5 si l'ancienne version reste affichée).
2. Paramètres → Compte → « Changer le mot de passe » : saisir le mot de passe actuel et un
   nouveau, puis **appuyer sur Entrée** (sans cliquer).
   **Attendu** : « Mot de passe modifié. », session maintenue.
3. Refaire avec un mot de passe actuel faux + Entrée.
   **Attendu** : « Mot de passe actuel incorrect. », curseur replacé dans le premier champ.
4. **Recette suivante demandée** : se déconnecter, se reconnecter avec le nouveau mot de passe en
   appuyant sur **Entrée** dans le champ mot de passe.
   **Attendu** : connecté, progression intacte (profondeur, pièces, inventaire, classement).

**Classement : Bloquant MVP public** (ergonomie de base de la connexion sur PC) — fait.

### 8. Choix techniques faits seul

- `novalidate` : pas de bulles de validation du navigateur, pour garder exactement les règles
  et messages du serveur (demande « validation identique »).
- Focus sur erreur : premier champ vide, sinon premier champ. Simple et prévisible ; le serveur
  ne dit pas quel champ est en cause.
- Tests automatisés sur le source (la CI n'a pas de DOM) ; le comportement est vérifié au
  navigateur (§4).

### 9. Décisions demandées au propriétaire

Inchangées depuis la session 2 (aucune nouvelle question) :
1. **Architecture sociale** : A (Auth0 Free, DIG! source de vérité) ou B (OAuth direct).
   **Recommandé : A**, Google d'abord — en complément du mot de passe, conformément à ta décision.
2. **Apple** (99 $/an) : **recommandé plus tard**.
3. **Tenant Auth0** à créer par toi : région UE, MFA administrateur, client Google « Web »,
   secrets dans `/etc/dig/dig.env`, domaine par défaut pour les essais. **Recommandé : oui.**
4. **Comptes « Google seul »** après activation du SMTP ; d'abord la liaison des comptes
   existants. **Recommandé : oui.**
5. **SMTP du jeu** dans `/etc/dig/dig.env` ; adresse vérifiée exigée pour le concours (#30/#31).
   **Recommandé : oui.**

### 10. Reste à faire

- Recette : changement par Entrée, puis déconnexion/reconnexion (§7).
- Après le SMTP : recette « vérifier l'adresse » et « mot de passe oublié ». **Bloquant MVP** :
  l'activation du SMTP.
- Connexion sociale après décision (§9). **Après lancement**, sauf si tu en fais une condition.

---

## Session 2 (30/10/2026) — connexions sociales : comparatif Auth0 rectifié

### 1. État réel

- **Comparatif rectifié, intégré dans `develop`.** Aucun déploiement : seul de la documentation a
  changé, et le fichier n'est pas servi par le jeu.
- La production reste `994705e` (session 1).
- **Connexion sociale : rien d'activé.** Aucun tenant, aucune souscription, aucun code, comme
  demandé par le propriétaire. Une décision du propriétaire est attendue (§8).

### 2. Retour du propriétaire pris en compte

Commentaire du 30/10, 10:54 :
- **Recette validée** : Paramètres → Compte affiche bien l'adresse et « Adresse non vérifiée ».
- **Objectif clarifié** : les connexions sociales.
- **Correction demandée** : la version 1 du comparatif écartait Auth0 en s'appuyant sur
  Essentials. Or l'offre **Free** couvre 25 000 MAU et des connexions sociales illimitées.

### 3. Changements

`docs/AUTH-COMPARATIF.md`, version 2, entièrement réécrit :
- **§0 Rectificatif** des erreurs de la version 1 (Free suffit pour le social ; e-mails sans
  effet ; sessions et mots de passe conservés).
- **§1 Grille officielle Free / Essentials** relevée le 30/10 :
  - **Account Linking, Email Workflow et la personnalisation de la connexion** sont absents du
    Free.
  - **Custom Database Connections** est absent du Free **et aussi d'Essentials**, selon la page.
  - S'y ajoutent les limites de débit Free, les clés de développement interdites en production
    et Apple à 99 $/an.
- **§3 Deux architectures** : (A) Auth0 Free en fournisseur OIDC, avec DIG! comme source de
  vérité ; (B) OAuth direct. Elles sont comparées sur l'effort, la sécurité, le RGPD, les
  fournisseurs, les coûts, le risque de doublons et le retour arrière.
- **§4 Liaison sûre des comptes** : jamais sur la seule égalité d'e-mail ; preuve des deux
  identités ; refus d'une identité déjà liée ailleurs ; jamais de fusion de progressions ;
  notification. La liaison est gérée par DIG!, ce qui neutralise l'absence d'Account Linking en
  Free.
- **§5 Plan de test** (faux émetteur OIDC local) et **mise en place en 5 étapes** derrière un
  drapeau `SOCIAL_LOGIN` (`off` / `link` / `on`), avec retour arrière à chaque étape.

### 4. SHA et vérification

- Branche `feature/28-auth-email-recuperation`.
- SHA sur `develop` : `72219ff` (fusion de `7334c35`). `npm test` : 155/155 sur la fusion.
- Lecture : `docs/AUTH-COMPARATIF.md` sur `develop`.
- `npm test` complet sur la fusion `develop`.

### 5. Choix faits seul

- **Recommandation : A, en commençant par Google seul.**
  - Avec un fournisseur, A et B demandent presque le même effort.
  - A devient plus rentable à partir du deuxième fournisseur, sans coût mensuel.
  - Le `sub` natif est conservé, ce qui permet de passer plus tard à B sans relier les comptes à
    nouveau.
- **Pas d'Auth0 Account Linking, même payant** : DIG! reste la seule source de vérité des
  liaisons.
- **Aucun code écrit** avant le choix de l'architecture, pour respecter la consigne « ne pas
  activer sans décision ».

### 6. Données des joueurs

Aucune modification : pas de code, pas de migration, pas de déploiement.

### 7. Test fonctionnel à faire par le propriétaire

- Relire `docs/AUTH-COMPARATIF.md` (§0, §3 et §4) et répondre aux décisions du §6 de ce document.
- La recette de l'existant continue :
  - « Changer le mot de passe » ;
  - après configuration du SMTP : vérification de l'adresse et « Mot de passe oublié ».

### 8. Décisions demandées au propriétaire

1. **Architecture** : A (Auth0 Free) ou B (OAuth direct). **Recommandé : A**, Google d'abord.
2. **Apple** : 99 $/an (Apple Developer Program). **Recommandé : plus tard.**
3. **Tenant Auth0**, créé par le propriétaire :
   - région **UE** ;
   - MFA sur le compte administrateur ;
   - client Google à son nom ;
   - secrets dans `/etc/dig/dig.env` ;
   - domaine par défaut pour les essais.
4. **Comptes « Google seul »** : attendre l'activation du SMTP. Au début, liaison des comptes
   existants seulement. **Recommandé : oui.**
5. Toujours en attente :
   - configuration du SMTP du jeu ;
   - adresse vérifiée obligatoire pour le concours.

### 9. Reste à faire

- Après la décision : implémentation selon le §5 du comparatif (≈ 2 jours pour Google, tests
  compris), puis déploiement progressif.
- **Classement : Après lancement.**
  - Le MVP public peut ouvrir avec la connexion par mot de passe et la récupération par e-mail.
  - Le propriétaire peut avancer la connexion sociale s'il en fait une condition de lancement.
- **Bloquant MVP** : l'activation du SMTP uniquement.

---

# Session 1

## 1. État réel

**Déployé en production (SHA `994705e`) — en attente de recette.**
Les fonctions qui envoient un e-mail restent **désactivées** jusqu'à ce que le propriétaire
configure un serveur SMTP pour le jeu (§ 7, question 1). Le changement de mot de passe et
l'affichage de l'adresse du compte sont déjà actifs.

## 2. Résultat

Le propriétaire demandait d'abord un comparatif Auth0 / amélioration de l'existant, sans achat
ni migration automatique. Livré :

1. **Comparatif** `docs/AUTH-COMPARATIF.md` : Auth0, Firebase/Supabase et l'existant amélioré.
   Coûts, MAU, e-mails, migration, RGPD et PWA.
   - **Recommandation : améliorer l'existant.** Coût nul, aucune migration d'identité, aucune
     reconnexion forcée.
   - L'offre gratuite d'Auth0 n'inclut pas l'envoi d'e-mails personnalisés. L'offre utile
     (Essentials) coûte de 35 $/mois pour 500 MAU à 700 $/mois pour 10 000 MAU.
2. **Amélioration de l'existant**, sans service tiers à part le SMTP :
   - **Vérification de l'adresse** : badge « Adresse vérifiée / non vérifiée » dans
     Paramètres → Compte, et bouton « Envoyer le lien de confirmation ». Le lien est valable
     48 h et ne sert qu'une fois ; il s'ouvre sur n'importe quel appareil.
   - **Mot de passe oublié** : lien sous « Se connecter », par nom d'utilisateur ou adresse.
     - La réponse est la même que le compte existe ou non.
     - Le lien est valable 1 h et ne sert qu'une fois.
     - Le nouveau mot de passe **déconnecte les autres appareils** et connecte celui utilisé.
       Ouvrir ce lien prouve aussi l'adresse.
   - **Changement de mot de passe** : le mot de passe actuel est exigé, et les autres appareils
     sont déconnectés.
   - **Changement d'adresse** : le mot de passe est exigé. La nouvelle adresse ne remplace
     l'ancienne qu'après confirmation, et l'ancienne adresse est prévenue.
   - Textes FR/EN/NL (écrans et e-mails).

### Fichiers

| Fichier | Rôle |
|---|---|
| `server/accountRoutes.js` (nouveau) | Routes `/api/auth/email/send-verification`, `/api/auth/email/verify`, `/api/auth/password/forgot`, `/api/auth/password/reset`, `/api/me/password`, `/api/me/email`. Contrôle `auth_version` des sessions |
| `server/mailer.js` (nouveau) | Envoi SMTP (nodemailer 10.3.1). Mode `file` réservé aux tests. Désactivé sans configuration |
| `server/db.js` | Colonnes `users.email_verified_at`, `users.auth_version`, table `auth_tokens` (ajouts idempotents), fonctions associées |
| `server/index.js` | Branchement. `/api/me` renvoie aussi `email`, `emailVerified` et `mail` (envoi disponible ou non) |
| `server/rateLimits.js` | Limiteurs `mail` (5 envois / IP / 15 min) et `token` (20 liens refusés / IP / 15 min) |
| `public/js/main.js`, `public/js/i18n.js`, `public/css/style.css` | Section Compte, liens `?verify=` / `?reset=` (retirés aussitôt de l'adresse), traductions |
| `test/account-recovery.test.js` (nouveau) | 6 tests |
| `docs/AUTH-COMPARATIF.md`, `docs/OPERATIONS.md` | Comparatif, configuration SMTP |

## 3. SHA et procédure de test

- Branche `feature/28-auth-email-recuperation`, commit `9dba10a`.
- Fusion dans `develop` : **`994705e`**, déployée.
- Tests automatisés : `npm ci && npm test` (155/155). Ce ticket ajoute
  `node --test test/account-recovery.test.js` (6/6), qui couvre :
  - **Sans SMTP** : routes e-mail en 503, changement de mot de passe possible.
  - **Vérification** : lien unique, seul le hachage est stocké, 429 si renvoi dans la minute.
  - **Mot de passe oublié** :
    - réponse identique pour un compte connu ou inconnu ;
    - un seul e-mail envoyé ;
    - lien unique ;
    - autre session fermée ;
    - ancien mot de passe refusé ;
    - lien expiré refusé.
  - **Changement de mot de passe et d'adresse** :
    - mot de passe exigé ;
    - adresse d'un autre compte refusée ;
    - adresse inchangée avant confirmation ;
    - ancienne adresse prévenue ;
    - l'ancienne adresse ne sert plus à récupérer le compte.
  - **Migration** d'une base d'avant #28 : connexion avec l'ancien identifiant, session sans
    `authVersion` toujours valable, 2ᵉ démarrage sans effet.
  - **Mailer** : mode `file` refusé en production, `MAIL_FROM` obligatoire, lien jamais tiré de
    l'en-tête `Host`.
- Essai manuel : `MAIL_TRANSPORT=file MAIL_OUTBOX_DIR=/tmp/out DB_FILE=/tmp/t.sqlite PORT=3128 node server/index.js`.
  Les e-mails sont alors écrits en JSON dans `/tmp/out` et leurs liens s'ouvrent sur
  `http://127.0.0.1:3128`.

## 4. Vérifications effectuées

- Suite complète : 155/155 sur la branche, sur la fusion `develop` et sur le SHA exact de la release.
  - Lors d'une première exécution, `security.test.js` a échoué : un serveur orphelin d'un essai
    précédent occupait le port 3111.
  - Après son arrêt : 7/7 seul, puis 155/155 deux fois.
- Chromium headless, ordinateur 1280×900 et smartphone 390×844, serveur de test avec boîte
  d'envoi locale. Parcours complet sans erreur JS :
  1. inscription ;
  2. envoi du lien ;
  3. confirmation (badge « Adresse vérifiée ») ;
  4. déconnexion ;
  5. mot de passe oublié ;
  6. lien de réinitialisation (l'adresse est nettoyée) ;
  7. nouveau mot de passe, puis connexion automatique.
- `npm audit` (production) : 0 vulnérabilité. nodemailer 7.x avait des failles connues, d'où le
  choix de la 10.3.1.
- **Non vérifié** : un envoi SMTP réel, faute de configuration SMTP pour le jeu (§ 7).
- **Impact sur les données des joueurs** :
  - 2 colonnes et 1 table ajoutées ; aucune donnée réécrite.
  - Les comptes existants gardent leurs identifiants et leurs sessions.
  - Leur adresse est marquée « non vérifiée ».

## 5. Déploiement

- **SHA déployé : `994705e`**, le 30/10 à 11:43. L'avance rapide de `main` est passée de
  `4988e19` à `994705e` ; elle inclut aussi la documentation de #27.
- **Avant le déploiement** :
  - 155/155 sur le SHA exact.
  - Copie de la base de production démarrée en mode production :
    - empreintes identiques de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`
      et `player_click_tracking` ;
    - seuls ajouts : `email_verified_at`, `auth_version` et `auth_tokens`.
  - Copie supprimée ensuite.
- **Sauvegarde vérifiée** : `~/backups/dig/dig-20261030-114120-pre-deploy-994705e.sqlite`.
- **Après le déploiement** :
  - Les 2 domaines répondent 200, avec `/api/version` = `1.0.0+994705e` et `/api/me` → `"mail":false`.
  - Journal sans erreur (2 lignes de migration).
  - `quick_check` ok.
  - Ligne `users` identique à la sauvegarde.
  - Sauvegarde de la partie en cours passée de la révision 7244 à 7250 : une progression, pas une perte.
  - Essai Chromium sur la production (ordinateur et smartphone) : sans erreur JS, lien
    « Mot de passe oublié » masqué (pas de SMTP), lien `?reset=` nettoyé.
- **Retour arrière** :
  - Commandes : `git -C /home/ubuntu/Dig reset --keep 4988e19`, puis `npm ci --omit=dev` (le
    lock a changé), puis `sudo systemctl restart dig`.
  - Les colonnes et la table ajoutées sont ignorées par l'ancien code.
  - La base n'est pas à restaurer.

### Test fonctionnel à faire par le propriétaire

**Maintenant (sans SMTP, 2 min)**

1. Ouvrir Paramètres → Compte.
   - Attendu : ton adresse e-mail et le badge « Adresse non vérifiée ».
2. Ouvrir « Changer le mot de passe ». Saisir le mot de passe actuel et un nouveau, puis valider.
   - Attendu : « Mot de passe modifié ».
   - Attendu : tu restes connecté.
   - Attendu : un autre appareil connecté (téléphone) est déconnecté à sa prochaine action.
3. Te déconnecter, puis te reconnecter avec le nouveau mot de passe.
   - Attendu : la progression revient.

**Après la configuration SMTP (§ 7), 5 min**

1. Paramètres → Compte → « Envoyer le lien de confirmation ».
2. Ouvrir l'e-mail reçu, puis cliquer sur le lien.
   - Attendu : « Adresse e-mail confirmée ! ».
   - Attendu : le badge devient « Adresse vérifiée ».
3. Se déconnecter → « Mot de passe oublié ? ».
4. Saisir ton nom d'utilisateur.
5. Ouvrir le lien de l'e-mail et choisir un nouveau mot de passe.
   - Attendu : connecté automatiquement, progression intacte.

**Classement MVP : Bloquant MVP public**, pour la récupération du mot de passe. Il ne reste que
l'activation SMTP, qui revient au propriétaire. Le changement d'adresse et le comparatif sont
classés **Après lancement**.

## 6. Choix techniques faits seul

- **Pas d'Auth0 ni de migration d'identité.** Le ticket l'interdisait sans décision du
  propriétaire, et le comparatif la déconseille pour le MVP.
- **Jetons opaques de 256 bits** : seul le SHA-256 est stocké, à usage unique, et un seul lien
  reste valable par usage. Un jeton aléatoire de 256 bits ne se devine pas : un hachage rapide
  suffit, pas besoin de bcrypt.
- **`auth_version`** sur le compte, recopié dans la session. Les sessions sont des fichiers, et
  ce numéro est le moyen simple de fermer les autres appareils. Une session sans numéro vaut 0,
  donc **aucune session existante n'est rompue**.
- **Fonctions e-mail désactivées sans SMTP** : `/api/me` renvoie `mail:false` et l'interface
  masque les boutons. Le déploiement est ainsi sans effet tant que la configuration manque.
- **Liens construits depuis `PUBLIC_BASE_URL`** (par défaut `https://dig.lodygames.com` en
  production), jamais depuis l'en-tête `Host`, que le client peut falsifier.
- **Mot de passe oublié** : la réponse part avant l'e-mail et reste identique dans tous les cas,
  pour ne révéler ni l'existence d'un compte ni un temps de réponse différent.
- **Délai minimal de 60 s** entre deux envois à un même compte, en plus de la limite par IP.
- **Recevoir un lien de réinitialisation vaut vérification de l'adresse.**
- **nodemailer 10.3.1**, version exacte : 0 vulnérabilité connue. Il demande Node ≥ 20 ; la
  production et la CI sont en Node 22.

## 7. Décisions demandées au propriétaire

1. **SMTP du jeu (nécessaire pour activer la vérification et le mot de passe oublié).** Ajouter
   les variables dans `/etc/dig/dig.env` (liste au § 6 de `docs/AUTH-COMPARATIF.md`, ou
   `docs/OPERATIONS.md`), puis `sudo systemctl restart dig`.
   - Options :
     - (a) réutiliser le compte SMTP déjà utilisé par DIGORCH ;
     - (b) un service d'envoi gratuit (Brevo, Mailjet ≈ 200 à 300 e-mails/jour) avec SPF/DKIM
       sur le domaine ;
     - (c) la boîte mail du domaine `lodygames.com`.
   - **Recommandation :** (b) ou (c), avec une adresse d'expédition sur un domaine du jeu.
   - Les sessions Claude n'ont pas le droit de lire ni d'écrire ces secrets.
2. **Choix d'architecture.** Valider l'option A (existant amélioré, pas d'Auth0).
   **Recommandation : oui.** À rouvrir seulement pour une connexion Google/Apple, la double
   authentification ou les passkeys.
3. **Concours (#30/#31).** Exiger une adresse vérifiée pour participer au concours et contacter
   le gagnant uniquement à cette adresse ? **Recommandation : oui.**

## 8. Reste à faire

- **Activation SMTP** (propriétaire), puis test du § 5. *Bloquant MVP public.*
- **Anti-multicompte renforcé** : normalisation Gmail, refus des domaines jetables, contrôle
  admin avant remise d'un lot. À décider avec le règlement du concours. *Après lancement.*
- **Exigence d'adresse vérifiée pour le concours** : à appliquer dans #30/#31. *Après lancement*
  (aucun prix réel avant #27).
- **Régénération de l'identifiant de session à la connexion** (protection contre la fixation de
  session). Elle est déjà faite pour la réinitialisation, pas pour `/api/login`. Amélioration
  repérée, hors périmètre. *Après lancement.*
- **Connexion par adresse e-mail** (aujourd'hui par nom d'utilisateur seulement). *Après lancement.*
