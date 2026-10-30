# Ticket #28 — [P1] Authentification — e-mail vérifié et récupération de compte

- Ticket : https://github.com/ReC82/Dig/issues/28
- Session du 30/10/2026 (DIGORCH)

## Session 5 (30/10/2026) — connexion Google via Auth0 Free, code dormant déployé

### 1. État réel

**Déployé en production (SHA `64332b2`), drapeau `SOCIAL_LOGIN` à `off`.** Rien ne change pour
les joueurs : aucun bouton, aucune route sociale (404), aucun appel à Auth0.

- **Avant la recette :** le propriétaire doit créer le tenant Auth0 et le client Google, puis
  déposer les secrets (§6). La recette de liaison ne peut pas commencer avant.
- `develop` : `64332b2` (fusion de `66b5d29`, branche `feature/28-auth-email-recuperation`).
- Production : `0f58670` → `64332b2`, sur les deux domaines.

### 2. Point de départ

- **Dépendance #22 levée :** la planche des 14 blocs a été présentée (commentaire #22, `0f58670`).
- **Travail repris selon l'autorisation du propriétaire** (commentaire 6521243869) :
  - architecture A : Auth0 Free (UE) pour Google, en complément du mot de passe ;
  - base DIG! source de vérité ;
  - liaison explicite avec preuve des deux identités ;
  - aucune fusion de progression ;
  - drapeau `SOCIAL_LOGIN=off` en production jusqu'à la recette ;
  - aucun tenant ni secret créé à la place du propriétaire.

### 3. Changements

| Fichier | Rôle |
|---|---|
| `server/socialAuth.js` (nouveau) | Client OIDC et routes `/api/auth/social/*` (détail ci-dessous) |
| `server/db.js` | Table `user_identities` (ajout seul, vide) et ses fonctions |
| `server/index.js` | Branchement. `/api/me` renvoie `social` (`null` si désactivé). `/api/login` signale une identité Google en attente |
| `server/rateLimits.js` | Limiteur `social` : 30 départs ou retours par IP et par 15 min |
| `server/mailer.js` | E-mails « Compte Google lié / retiré » en FR, EN et NL |
| `public/js/main.js`, `i18n.js`, `css/style.css` | Paramètres → Compte : bouton, liaison, confirmation, retrait ; traitement du retour `?social=` |
| `test/social-login.test.js` (nouveau) | 8 tests avec un faux émetteur OIDC local |
| `docs/OPERATIONS.md` | Procédure de mise en service et retour arrière |
| `docs/AUTH-COMPARATIF.md` | Avancement du plan |

**Client OIDC (`server/socialAuth.js`) :**
- flux par code d'autorisation, avec **PKCE S256** ;
- `state`, `nonce` et vérificateur à usage unique, valables 10 min ;
- jeton d'identité vérifié : signature RS256 par la clé publiée (JWKS), puis `iss`, `aud`/`azp`,
  `exp`, `iat` et `nonce` ;
- seuls les identifiants Google (`google-oauth2|…`) sont acceptés ;
- aucune dépendance ajoutée ; aucun jeton Auth0 ou Google conservé.

**Fonctionnement en mode `link` :**
- **Lier depuis Paramètres** (joueur connecté) : « Lier un compte Google ». Le joueur confirme
  son mot de passe DIG!, valable une fois pendant 5 min, puis se connecte à Google
  (`prompt=login`).
- **« Continuer avec Google » avec un compte Google inconnu** :
  - rien n'est lié, même si l'adresse Google est celle d'un compte DIG! ;
  - l'identité est gardée 10 min dans la session du navigateur ;
  - le joueur se connecte ensuite par mot de passe, puis confirme « Lier ce compte Google ».
- **Règles de liaison :**
  - un compte Google est lié à un seul compte DIG! (refus « déjà lié à un autre compte ») ;
  - un compte DIG! a au plus un compte Google ;
  - aucune progression n'est touchée : seule une ligne est ajoutée dans `user_identities`.
- **Connexion par Google d'un compte lié :** nouvelle session, avec un identifiant régénéré.
  Le mot de passe reste valable.
- **Retrait :** mot de passe exigé ; les autres appareils sont déconnectés.
- **Adresse vérifiée :** elle est marquée vérifiée seulement si Google la dit vérifiée **et**
  qu'elle est identique à l'adresse du compte.
- **Liste blanche `SOCIAL_LOGIN_USERS` :**
  - seuls les comptes listés peuvent lier ou se connecter par Google ;
  - c'est la phase de recette du propriétaire ;
  - le bouton de connexion n'apparaît que sur un appareil où un compte Google a été lié.
- **Adresse de retour :** construite sur le domaine de la page (lodygames ou lodylands, pour
  garder le cookie de session). Un domaine non déclaré est refusé.
- **Hors périmètre :** le mode `on` (création de comptes « Google seul ») n'est pas développé ;
  il attend le SMTP. Apple : plus tard.

### 4. SHA et procédure de test

- Branche `feature/28-auth-email-recuperation`, commit `66b5d29`.
- `develop` et production : **`64332b2`**.
- **Tests automatisés :** `npm ci && npm test`, **196/196**, sur la branche, sur `develop` et sur
  la release. `node --test test/social-login.test.js` (8/8) couvre :
  - **Drapeau `off`** : toutes les routes en 404, `social: null`, connexion classique inchangée ;
  - **configuration** : incomplète, donc désactivée ; `OIDC_ISSUER` refusé en production ;
    origines par défaut (les deux domaines) ;
  - **même adresse sans liaison automatique** : l'identité reste en attente, aucune ligne liée ;
  - **liaison après mot de passe et confirmation** :
    - l'identité en attente ne sert qu'une fois ;
    - la connexion Google ouvre le même compte ;
    - la sauvegarde `user_saves` est **identique octet pour octet** ;
    - le mot de passe marche toujours ;
  - **liaison depuis Paramètres** :
    - mot de passe exigé ; la preuve ne sert qu'une fois ;
    - `prompt=login` ;
    - refus d'un deuxième Google sur le même compte ;
    - refus d'un compte Google déjà lié à un autre compte, sans fusion ;
  - **retrait** :
    - mot de passe exigé ;
    - l'autre session est fermée ;
    - le compte Google redevient inconnu ;
    - les e-mails de liaison et de retrait sont envoyés (SMTP simulé) ;
  - **sécurité du retour**, chaque cas refusé sans session ouverte :
    - `state` rejoué ;
    - mauvaise signature ;
    - `iss`, `aud` ou `azp` faux ;
    - jeton expiré ;
    - `nonce` faux ;
    - `alg: none` ;
    - clé inconnue ;
    - autre fournisseur que Google ;
    - retour sans départ ;
    - annulation chez Google ;
    - domaine non déclaré ;
  - **liste blanche** ;
  - **migration** : base sans la table, 2 démarrages, `users` identique.
- **Navigateur** : Chromium headless, serveur de test (port 3101) et faux Google local.
  - **Ordinateur 1280×900** :
    1. mauvais mot de passe → « Mot de passe incorrect. » ;
    2. liaison → retour dans Paramètres, « Google : … », badge « Adresse vérifiée » ;
    3. déconnexion → bouton « Continuer avec Google » → connecté.
  - **Smartphone 390×844** :
    1. retrait du compte Google ;
    2. annulation chez Google ;
    3. compte Google inconnu → message d'attente ;
    4. connexion par mot de passe → « Lier ce compte Google » → lié.
  - La session de l'ordinateur a bien été fermée par le retrait. **0 erreur JavaScript.**
- **Essai manuel** (sans Auth0, faux émetteur à écrire comme dans `test/social-login.test.js`) :
  `SOCIAL_LOGIN=link OIDC_ISSUER=http://127.0.0.1:<port>/ AUTH0_CLIENT_ID=… AUTH0_CLIENT_SECRET=… SOCIAL_ORIGINS=http://127.0.0.1:3101 DB_FILE=test-28.sqlite PORT=3101 node server/index.js`.

### 5. Données des joueurs

- **Ajout seul :** la table `user_identities`, vide.
- **Inchangés :**
  - comptes, sauvegardes et classements ;
  - colonnes existantes ;
  - sessions ouvertes.
- La migration est idempotente : `CREATE TABLE IF NOT EXISTS`.

### 6. Déploiement

**Avant :**
- release `64332b2` : `npm ci`, 196/196 ;
- copie de la base de production démarrée en mode production (port 3122) :
  - `/health` ok, `/api/version` = `1.0.0+64332b2`, `/api/me` → `social: null` ;
  - départ Google → 404 ;
  - **empreintes identiques** de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`
    et `player_click_tracking` ; `user_identities` vide ;
  - copie supprimée ensuite.

**Déploiement :**
- `main` avancé `0f58670` → `64332b2` (avance rapide) ;
- `scripts/deploy.sh` de la release ;
- sauvegarde vérifiée `~/backups/dig/dig-20261030-135541-pre-deploy-64332b2.sqlite` ;
- santé et version OK.

**Après :**
- les deux domaines → 200, `1.0.0+64332b2`, `social: null`, départ Google → 404 ;
- journal sans erreur ; `quick_check` ok ;
- **empreintes identiques à la sauvegarde** ;
- Chromium en production (ordinateur et smartphone) : formulaire de connexion présent, aucun
  bouton Google, 0 erreur JavaScript.

**Retour arrière :**
- code : `git -C /home/ubuntu/Dig reset --keep 0f58670` + `sudo systemctl restart dig` (verrou
  inchangé, pas de `npm ci`) ;
- fonction : `SOCIAL_LOGIN=off` ;
- aucune donnée à restaurer.

### 7. Test fonctionnel à faire par le propriétaire

**Mise en service (≈ 20 min, gratuit)** : suivre `docs/OPERATIONS.md`, section « Connexion Google
via Auth0 Free ».
1. Tenant Auth0 en **région EU**, avec MFA.
2. Application « Regular Web Application ». Callbacks :
   `https://dig.lodygames.com/api/auth/social/callback` et
   `https://dig.lodylands.com/api/auth/social/callback`.
3. Client OAuth Google « Application Web » : redirection `https://<domaine Auth0>/login/callback`,
   consentement en mode Test avec ta propre adresse.
4. Connexion Google activée pour l'application dans Auth0 ; base de mots de passe Auth0
   désactivée pour l'application.
5. Dans `/etc/dig/dig.env` : `SOCIAL_LOGIN=link`, `SOCIAL_LOGIN_USERS=<ton pseudo>`,
   `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`. Puis `sudo systemctl restart dig`.

**Recette de liaison (5 min, ordinateur puis téléphone) :**
1. Paramètres → Compte → « Lier un compte Google » : saisir ton mot de passe, puis choisir ton
   compte Google.
   - Attendu : retour dans Paramètres, « 🔗 Google : ton adresse ».
   - Attendu : progression identique (pièces, profondeur, classement).
2. Se déconnecter, puis « Continuer avec Google ».
   - Attendu : connecté au même compte, progression intacte.
3. Sur le téléphone (navigateur où tu n'as rien lié), te connecter par mot de passe.
   - Attendu : la connexion classique marche toujours.
4. Facultatif : « Retirer le compte Google » (mot de passe demandé).
   - Attendu : l'ordinateur est déconnecté ; le mot de passe marche.

**Retour arrière immédiat :** `SOCIAL_LOGIN=off`, puis redémarrage.

### 8. Classement MVP

- Connexion Google : **Après lancement**. Le code est prêt et sans effet.
- SMTP du jeu : **Bloquant MVP public**, inchangé.

### 9. Choix techniques faits seul

- **Client OIDC écrit dans DIG!** (≈ 150 lignes, module `crypto` de Node) plutôt que la
  bibliothèque `openid-client` :
  - la version 6 de cette bibliothèque est en ESM uniquement ;
  - on n'utilise qu'un seul flux (code + PKCE) ;
  - toutes les vérifications du jeton sont explicites et testées (signature, émetteur, audience,
    expiration, nonce, algorithme).
- **Pas de PKCE seul :** secret client en plus (« Regular Web Application »).
- **Identité en attente dans la session** (10 min), jamais en base : rien n'est écrit avant la
  preuve des deux identités.
- **Confirmation explicite après la connexion par mot de passe**, plutôt qu'une liaison
  automatique : le joueur voit l'adresse Google qu'il lie.
- **Adresse de retour sur le domaine de la page**, parmi une liste déclarée : le cookie de
  session dépend du domaine. L'en-tête `Host` n'est jamais utilisé tel quel.
- **Retour toujours vers Paramètres → Compte**, avec un message ; après une connexion Google, la
  sauvegarde cloud est appliquée comme pour une connexion explicite (#18).
- **Un compte Google par compte DIG!** (contrainte `UNIQUE (user_id, provider)`).
- **Mode `on` non développé** : la création de comptes « Google seul » attend le SMTP (étape 4 du
  plan).

### 10. Décisions demandées au propriétaire

Aucune nouvelle décision. Actions de ton côté :
1. Créer le tenant Auth0 Free (UE) et le client Google, et déposer les 5 variables (§7).
   **Recommandé : oui, quand tu veux tester la liaison.**
2. Toujours en attente : **SMTP du jeu** (bloquant MVP) et adresse vérifiée exigée pour le
   concours (#30/#31). **Recommandé : oui.**

### 11. Reste à faire

- Recette de liaison après mise en service (§7). Ensuite : retirer `SOCIAL_LOGIN_USERS` pour
  ouvrir la liaison à tous (étape 3).
- Étape 4 (`on`, création de comptes par Google) après le SMTP. *Après lancement.*
- Apple (99 $/an), si décidé. *Après lancement.*
- **Limite connue (cosmétique) :** une adresse construite à la main `/?social=ok` affiche le
  message « Connecté avec Google » sans connecter personne. *Après lancement.*
- **Amélioration repérée, hors périmètre :** régénérer l'identifiant de session à la connexion
  par mot de passe (`/api/login`). C'est déjà fait pour Google et pour la réinitialisation.
  *Après lancement.*

## Session 4 (30/10/2026) — recettes validées, Google/Auth0 reporté après #22

### État réel

**Déployé en production (`c23f521`, aujourd'hui inclus dans `ea23431`) — recettes validées par
le propriétaire.** Aucune modification de code dans cette session : seul ce rapport change.

### Retours du propriétaire pris en compte

- **Validé en jeu :** étape 1 (adresse et statut « Adresse non vérifiée »), étape 2 (changement de
  mot de passe), étape 3 (déconnexion, reconnexion avec le nouveau mot de passe, progression
  intacte) et **la correction de la touche Entrée sur PC** (`c23f521`). Ces tests ne seront plus
  redemandés.
- **Décision : architecture A autorisée** — Auth0 Free (tenant UE), Google d'abord, en complément
  de la connexion classique qui reste intégralement fonctionnelle. Exigences notées : base DIG!
  source de vérité ; liaison Google ↔ compte DIG! explicite, avec preuve de possession des deux
  identités (jamais sur la seule égalité d'adresse) ; une identité sociale liée à un seul compte ;
  aucune fusion de progressions ; sessions classiques conservées ; tests OIDC locaux ; feature
  flag `SOCIAL_LOGIN=off` (désactivé en production jusqu'à la recette de liaison) ; pas d'achat,
  pas de création de tenant ni de saisie de secrets à la place du propriétaire ; Apple plus tard.
- **Priorité :** terminer et présenter la planche d'images des blocs du **#22** avant de reprendre
  les travaux non critiques du #28.

### Décision de cette session

Le développement Google/Auth0 n'est **pas commencé** maintenant, conformément à la priorité donnée.
Le ticket est rendu au superviseur avec la dépendance **#22** : il reprendra dès que la planche du
#22 aura été présentée. Prochaine session #28 : implémentation de l'architecture A derrière
`SOCIAL_LOGIN=off` (code dormant déployable), tests OIDC avec un fournisseur simulé local, et
procédure courte de création du tenant Auth0 Free (UE) + client Google OAuth pour le propriétaire.

### Test fonctionnel à faire par le propriétaire

Aucun nouveau test sur ce qui est déployé. Restent, après configuration du SMTP du jeu dans
`/etc/dig/dig.env` : « Vérifier mon adresse » (lien reçu → « Adresse vérifiée ») et « Mot de passe
oublié » (lien reçu → nouveau mot de passe → connexion).

### Classement MVP

- SMTP du jeu (configuration par le propriétaire) : **Bloquant MVP public.**
- Connexion Google via Auth0 Free : **Après lancement** (autorisée, après #22).

### Décisions demandées au propriétaire

1. **SMTP du jeu** : configurer les variables dans `/etc/dig/dig.env` (voir § 6 de
   `docs/AUTH-COMPARATIF.md`). Recommandé : un service d'envoi (Brevo/Mailjet) ou la boîte du
   domaine, avec SPF/DKIM.
2. **Concours (#30/#31)** : exiger une adresse vérifiée pour participer. Recommandé : oui.

Les questions d'architecture (A/B), d'Apple et de tenant sont **tranchées** par le propriétaire.

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
