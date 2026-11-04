# Ticket #57 — [P0] Préparer une bêta fermée Dig : stabilité, accès, feedback et suivi

Lien : https://github.com/ReC82/Dig/issues/57

## Session du 04/11/2026 — verdict GO/NO-GO actualisé et clôture du lot de préparation

**Demande traitée** : commentaire du propriétaire du 04/11 (14:48, #issuecomment-6633713713) — verdict GO/NO-GO en deux périmètres et décision de clôture du lot de préparation, sans refaire de recette et sans changer la configuration de production.

**État réel** : constat seulement. Aucun code, aucun déploiement, aucun réglage de production modifié. Production : `1.0.0+7b2ea8f`.

### État de la production relevé en lecture seule (04/11, ~16:25 Bruxelles)

- Réglages Bêta : bandeau BÊTA actif, inscription en mode `invite` (réglé pendant la recette du 03/11 à 08:39), signalements actifs, lien Discord vide, politique de reset et problèmes connus vides (textes par défaut affichés).
- Invitations : **1 seule**, 1 utilisation sur 1, **épuisée** (expiration 17/11, non révoquée). Une seule inscription par invitation a eu lieu. **Aucune nouvelle inscription n'est donc possible aujourd'hui** sans action du propriétaire.
- Comptes : 2 au total. Sauvegarde vérifiée avant le dernier déploiement (`7b2ea8f`, 04/11 15:55) ; timer quotidien actif (prochaine sauvegarde le 05/11 à 03:30).
- **Rien n'a été modifié.** Je n'ai ni créé, ni révoqué, ni prolongé d'invitation, et je n'ai pas changé le mode d'inscription.

### Verdict — périmètre 1 : bêta privée 3–5 proches

**GO technique préparatoire.** Ce n'est pas une autorisation de lancement.

| Capacité | État | Preuve |
|---|---|---|
| Inscription par invitation, liens à usage limité, révocation, vagues | ✅ | Recettes #57-A à #57-G validées par le propriétaire (03/11 et 04/11) |
| Connexion, sauvegarde, session conservée | ✅ | Recette du 03/11 |
| Feedback en jeu, signalements, protection des saisies | ✅ | Recette #57-F |
| Panel Bêta : tableau de bord, invitation en 2 clics, « Configurer la bêta » | ✅ | Recette #57-G |
| Mot de passe oublié | ⚠️ sans e-mail | Mot de passe temporaire via le panel (#43, contournement accepté pour des proches) |
| Sauvegardes | ⚠️ locales seulement | Quotidiennes et avant chaque déploiement. La copie hors machine (#36) n'est pas encore faite |
| Ligues | ✅ seuil appliqué | Seuil 3 actifs appliqué en production le 04/11 à 15:55 (#19, `7b2ea8f`). C'était encore en attente au moment du commentaire |

Pour lancer réellement, il faudra une **validation explicite et écrite du propriétaire**. Il créera ensuite lui-même les invitations (une par proche) dans Admin → Bêta. Avant d'inviter, il est conseillé de renseigner la politique de reset et, si possible, le lien Discord. Rien de cela n'est fait ni autorisé à ce stade.

### Verdict — périmètre 2 : vague 10–20 testeurs, puis public

**NO-GO.** Dépendances bloquantes :

| Ticket | Pourquoi c'est bloquant | État au 04/11 |
|---|---|---|
| #43 SMTP | Un inconnu ne peut pas récupérer son compte seul | En attente du choix du fournisseur (reco Brevo) |
| #36 Sauvegarde hors machine | Perte totale si l'instance disparaît | Rôle IAM associé par le propriétaire le 04/11 ; vérification et test de restauration à faire |
| #25 Anti-bot | Un classement ouvert à des inconnus doit être protégé | En cours de recette (#25-E) |
| #19 Ligues | Promotions avec peu de joueurs | Seuil 3 appliqué ; recette en jeu à faire |
| #27 Conformité | Points et lots pour des joueurs non proches | Vérification différée (décision du 30/10) ; à refaire avant toute récompense publique |

### Décision de clôture du lot de préparation

Je recommande de **clore le lot « préparation de la bêta fermée »**. Tout le périmètre outillage de #57 est livré, déployé (dernier code #57 : `feecf11`) et validé par le propriétaire. Rien ne reste à développer dans #57.

Le lancement réel n'est pas inclus dans ce lot. Il relève d'une décision séparée du propriétaire, prise en dehors de ce ticket, et l'ouverture 10–20 puis publique suit les tickets listés ci-dessus.

Options :
- A) Clore #57 maintenant. Les dépendances restent suivies dans leurs propres tickets. **Recommandé.**
- B) Garder #57 ouvert comme ticket de suivi du GO 10–20.

La clôture appartient au propriétaire.

### Décisions demandées au propriétaire

1. Clôture de #57 : A ou B (reco A).
2. Questions toujours ouvertes, à trancher seulement avant d'inviter :
   - points de récompense pendant la bêta, réels ou simulation (reco simulation) ;
   - politique de reset « peut être ajustée » (reco) ;
   - badge « Testeur fondateur » sans bonus, oui ou non ;
   - fournisseur e-mail pour #43 (bloquant pour 10–20).

### Test fonctionnel

Aucun. Le propriétaire a demandé de ne pas refaire les recettes déjà validées.

### Classement

Préparation #57 : livrée. Bêta 3–5 proches : non bloquante. Vague 10–20 et MVP public : bloqués par #43, #36, #25, #19 (recette) et #27.

## Session du 03/11/2026 (3) — recette #57-F : signalement protégé, session admin au F5, « Rafraîchir » explicite

Réponse au commentaire du propriétaire « Recette réelle #57-F » (03/11, 09:00 UTC) : parcours de signalement validé, trois défauts UX à corriger.

### 1. État réel

**Déployé en production (SHA `feecf11`), en attente de recette.** Réglages bêta de production inchangés (inscription ouverte, bandeau masqué, aucun lien Discord). Aucune issue GitHub créée à partir des signalements : ils restent dans la base du jeu, Discord n'est qu'une copie manuelle.

### 2. Changements réalisés

**1. (P1) Signalement : plus de perte de saisie** (`public/js/beta.js`, `public/css/style.css`, textes FR/EN/NL/ES + IT)
- Fermer une fenêtre qui contient du texte demande toujours une confirmation : « Fermer sans envoyer ? Ce que tu as écrit sera perdu. ». Cela vaut pour un clic sur le fond, la croix ✕ (ajoutée en haut à droite), la touche Échap et le bouton « Fermer ». Deux choix : **Continuer la rédaction**, qui a le focus et que la touche Échap choisit aussi, ou **Abandonner**.
- Un clic sur le fond ne compte que s'il commence **et** se termine sur le fond. Avant, sélectionner du texte et relâcher la souris hors de la fenêtre la fermait : c'est la cause probable du « clic involontaire ».
- **Brouillon en mémoire** de la page : si la fenêtre se ferme ou se rouvre, les champs sont repris. Le brouillon n'est écrit ni dans le stockage du navigateur ni sur le serveur. Il est effacé après un envoi réussi, sur « Abandonner » et à la déconnexion du compte (appareil partagé). Il ne survit pas à un rechargement de la page.
- Une fenêtre vide ou déjà envoyée se ferme directement, sans question.

**2. (P1) Panel admin : la session survit au F5** (`server/adminSession.js` nouveau, `server/index.js`, `server/db.js`, `public/admin/*`)
- La clé saisie est envoyée **une seule fois** (`POST /api/admin/session`), puis le champ est vidé. Le serveur répond avec un cookie de session admin :
  - jeton aléatoire de 256 bits, sans lien avec `ADMIN_SECRET` ; seule son empreinte SHA-256 est stockée (nouvelle table `admin_sessions`) ;
  - cookie **HttpOnly** (illisible par le JavaScript), **Secure**, **SameSite=Strict**, limité au chemin `/api/admin` ;
  - durée **limitée** : fermeture après **2 h sans activité**, et **12 h au plus** même en restant actif ;
  - validé par le serveur à chaque requête. Il n'est accepté qu'avec l'en-tête `X-Dig-Admin`, que seul le panel envoie, ce qui protège contre une action déclenchée depuis un autre site (CSRF).
- La clé n'est **jamais** conservée : ni dans une variable, ni dans `localStorage`/`sessionStorage`, ni dans l'URL, ni dans un cookie (vérifié par test et dans le navigateur).
- **Déconnexion** : la session est révoquée côté serveur, donc un cookie recopié ne sert plus. Nouveau bouton **Déconnecter partout**, qui ferme toutes les sessions admin. Changer `ADMIN_SECRET` ou `SESSION_SECRET` invalide aussi toutes les sessions.
- Une session expirée pendant l'utilisation ramène à l'écran de connexion avec un message clair.
- Le journal de sécurité trace les connexions (`admin_login`), les échecs (`admin_login_failed`, limités en débit comme la connexion joueur) et la voie de chaque action (`via: key|session`), sans clé ni jeton.
- Les réponses `/api/admin/*` portent désormais `Cache-Control: no-store`.
- L'accès par en-tête `Authorization: Bearer` reste valable (scripts, tests). Un onglet admin ouvert avant le déploiement continue donc de fonctionner.

**3. (P2) « Rafraîchir » (onglet 🧪 Bêta) explicite** (`public/admin/admin.js`, `index.html`, `admin.css`)
- Pendant la requête, le bouton est désactivé et affiche « ↻ Actualisation… », avec « Chargement… » à côté.
- En cas de réussite : « ✓ Données à jour à HH:MM:SS » et un toast.
- En cas d'échec : « ⚠️ Échec de l'actualisation (raison) — données affichées : HH:MM:SS ». Les données déjà affichées restent visibles.
- Rien n'est réinitialisé : les notes, statuts et liens GitHub en cours de saisie dans les retours, les bugs connus et la vague en cours de saisie, ainsi que les fiches et sections ouvertes, sont conservés.
- **Les compteurs sont bien relus côté serveur.** `GET /api/admin/beta` interroge la base à chaque appel, sans cache serveur ni navigateur (`no-store`). Vérifié dans le navigateur : un nouveau signalement envoyé par un joueur fait passer le compteur de 3 à 4 après « Rafraîchir ».

### 3. SHA, branche, procédure de test

- Branche `feature/57-beta-fermee`, commit `61a600e` ; **`develop` = `feecf11`** (merge).
- `npm test` : **519/519** (worktree du ticket, intégration `develop` et release `feecf11`). Nouveau `test/admin-session.test.js` (7 tests) : jeton aléatoire et empreinte seule en base, inactivité 2 h, durée maximale 12 h, révocation unitaire et globale, clé changée = session refusée, attributs du cookie, F5 sans clé, refus sans en-tête `X-Dig-Admin`, Bearer faux non rattrapé par le cookie, déconnexion côté serveur, journal sans secret, panel sans stockage de la clé.
- Essai Chromium `test/e2e/beta-recette-f.e2e.js` (7 étapes, 0 erreur JS) : signalement sur smartphone (fond, ✕, Échap, Fermer, glisser depuis un champ, brouillon repris, abandon, envoi) ; admin sur ordinateur (mauvaise clé, connexion, F5, cookie illisible, clé absente des cookies, du stockage et de l'URL) ; Rafraîchir (attente, heure, échec simulé, saisies conservées, compteur relu) ; déconnexion puis F5.
- Non-régression : `test/e2e/beta-invite.e2e.js` (8 étapes) repasse : invitation en 2 clics, invité en navigation privée, lien réutilisé, mode fermé.

### 4. Déploiement

- SHA déployé : **`feecf11`** (précédent : `2c77dfa`). Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261103-102806-pre-deploy-feecf11.sqlite`.
- Avant : release démarrée en `NODE_ENV=production` sur une copie de la base de production. Empreintes identiques ; seule la table `admin_sessions` est ajoutée ; la session admin fonctionne. Copie supprimée.
- Avant le redémarrage, vérification qu'aucune génération IA n'était en cours. Une mise en forme d'actualité s'était terminée à 09:25:45 UTC et la proposition était « utilisée ».
- Après : les 2 domaines répondent 200, version `1.0.0+feecf11`, `/health` db:true, `quick_check` ok, journal sans erreur. Empreintes : `users`, `seasons`, `leagues` identiques ; `user_saves`, `season_rankings` et `player_click_tracking` ont progressé à cause d'une partie en cours (sauvegarde version 113 → 114, aucune perte). Chromium en production 1280 et 390 : 0 erreur JS.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 2c77dfa` + `sudo systemctl restart dig`. La table `admin_sessions` peut rester ; l'ancien code l'ignore.

### 5. Test fonctionnel à faire (3 étapes, ~3 min)

1. **Signalement** : dans le jeu, « Signaler un bug », écris quelques mots, puis clique à côté de la fenêtre. **Attendu** : la question « Fermer sans envoyer ? » apparaît, le focus est sur « Continuer la rédaction » et rien n'est perdu. Essaie aussi ✕ et Échap.
2. **Admin et F5** : connecte-toi au panel (la clé une dernière fois), puis appuie sur F5. **Attendu** : le panel reste ouvert, sans nouvelle saisie. « Déconnexion » puis F5 : la clé est redemandée.
3. **Rafraîchir** : onglet 🧪 Bêta → « ↻ Rafraîchir ». **Attendu** : le bouton passe brièvement en « Actualisation… », puis « ✓ Données à jour à HH:MM:SS » s'affiche. Une note en cours de saisie dans un retour n'est pas effacée.

Classement : **Bloquant MVP (bêta 3–5 proches)** pour le point 1 (perte de retour testeur) ; **Après lancement** pour les points 2 et 3 (confort admin), livrés quand même.

### 6. Choix techniques faits seul

- Jeton de session en base plutôt que dans la mémoire du serveur : il survit aux déploiements (sinon chaque déploiement déconnecterait l'admin) et la révocation reste effective.
- Durées 2 h d'inactivité / 12 h au maximum : compromis entre confort (F5, demi-journée de travail) et exposition d'un poste laissé ouvert. Ce sont des constantes de `server/adminSession.js`, faciles à ajuster.
- `SameSite=Strict` + en-tête `X-Dig-Admin` obligatoire avec le cookie : double protection CSRF sans jeton à gérer côté panel.
- Bearer conservé : compatibilité avec les scripts, les tests et un onglet ouvert avant le déploiement.
- Brouillon gardé en mémoire de la page seulement, sans persistance : le propriétaire demandait « sans fuite de contenu ».

### 7. Décisions demandées au propriétaire

Aucune nouvelle décision nécessaire pour ces correctifs. Les questions précédentes restent ouvertes (voir sessions plus bas) : points en simulation ou réels, formulation de la politique de reset, badge « Testeur fondateur », fournisseur e-mail #43.

### 8. Reste à faire

- Recette des 3 étapes ci-dessus.
- Repérés hors périmètre (non faits) : les autres boutons « ↻ Rafraîchir » du panel (Classement, Anti-bot, Boutique…) n'ont toujours pas de retour visible. Le même motif pourra être généralisé dans un ticket « Après lancement ».

---

## Session du 03/11/2026 (2) — panneau Bêta simplifié, invitation en 2 clics, verdict par audience

Réponse aux deux commentaires du propriétaire du 03/11 : « NUIT 03/11 — verdict pré-bêta » et « Retour de recette — UX bêta trop nébuleuse ».

### 1. État réel

**Déployé en production (SHA `2b6c457`), en attente de recette.** Le panneau 🧪 Bêta a été réorganisé et le parcours de l'invité simplifié. **Aucun réglage de production n'a été modifié** : en production, l'inscription reste « ouverte à tous », le bandeau est masqué et aucun lien Discord n'est configuré, jusqu'à ce que tu passes par « Configurer la bêta ». Aucune invitation n'a été créée ni envoyée.

### 2. Verdict par audience

| Audience | Verdict | Raisons précises |
|---|---|---|
| **3–5 proches (dont ta sœur)** | **GO**, après tes 10 minutes de préparation (checklist §6) | Inscription par lien sans code à saisir (vérifiée dans un vrai navigateur, ordinateur et mobile, en navigation privée). Lien à usage unique, refus clair s'il est réutilisé. Google ne peut **pas** créer de compte, donc il ne contourne pas l'invitation (vérifié dans le code et par un test automatique). Comptes existants jamais coupés. Session unique multi-appareils (#35) validée et close par toi. Sauvegarde quotidienne à 03:30 + sauvegarde avant chaque déploiement, restauration testée par `test/backup-restore.test.js`. Simulation de 12 clôtures de saison réussie (session précédente). **Limite acceptée :** pas d'e-mail (#43). Un mot de passe perdu passe par toi (panel → Paramètres avancés → « Mot de passe perdu »). |
| **10–20 testeurs** | **NO-GO pour l'instant** | (1) **Pas d'e-mail du jeu (#43)** : ni vérification d'adresse ni « mot de passe oublié » autonome. À 20 personnes, la réinitialisation manuelle ne tient plus. (2) Points de récompense **réels** (#33 non terminé, décision 1 en attente). (3) Ligues et promotions (#19) et saisons thématiques (#48) non livrées : le classement fonctionne, mais sans promotion. (4) Économie calculée par le navigateur (#25 lots C–E) : un testeur curieux peut tricher. Sans gravité entre proches, mais le classement perd son sens à 20. (5) Pas de sauvegarde hors machine (#36 bloqué). **Feu vert** quand (1) est fait, (2) est décidé et que 7 jours de vague 1 se sont écoulés sans perte de progression. |
| **Bêta publique** | **NO-GO** | En plus des points ci-dessus : conditions d'utilisation, coordonnées de l'éditeur et suppression de compte ; surveillance externe de `/health` ; sauvegarde hors machine prouvée (#36) ; décision sur la triche côté navigateur (#25/#49) ; conformité du concours (#27) si des lots réels sont promis. |

État par parcours (preuves) :

| Parcours | État | Preuve |
|---|---|---|
| Nouveau compte (lien d'invitation) | ✅ | Essai navigateur `test/e2e/beta-invite.e2e.js` (mobile 390×844, navigation privée) et tests `test/beta.test.js` (9) |
| Connexion Google | ✅ ne contourne pas l'invitation | Mode « link » seul en production (journal du service). Aucun `createUser` dans `socialAuth.js` (test automatique) |
| E-mail / récupération (#43) | ⚠️ absent (`mail:false` en production) | Contournement : mot de passe temporaire depuis le panel |
| Première minute, minage, sauvegarde/reprise | ✅ | Tests `save-revision`, `block-resume`, `play-session` |
| Session unique (#35) | ✅ | Ticket clos par toi |
| Boutique, coffres, boost (#47) | ✅ correctif déployé (`0e1a561`), recette à faire | Ticket #47 en attente de ta validation |
| Classement, saisons | ✅ rotation | `season-cycles-12.test.js` (12 cycles, heure d'été à Bruxelles, panne de 15 jours) |
| Promotions (#19), saisons thématiques (#48) | ❌ non livrées | Pas bloquant pour 3–5 proches |
| Crédit de points (#33) | ⚠️ points réels actifs, portefeuille incomplet | Décision 1 |
| Sécurité, anti-triche (#25) | ⚠️ limites de débit, anti-autoclic. Économie côté navigateur | #25 en attente |
| Sauvegarde et restauration | ✅ locale ; ❌ hors machine (#36) | `~/backups/dig/`, timer `dig-backup.timer` |

### 3. Ce qui a changé (refonte demandée)

**Panneau admin 🧪 Bêta** (`public/admin/index.html`, `admin.js`, `admin.css`) :
- **Tableau de bord** à l'ouverture : l'état **enregistré** en gros (« Inscriptions ouvertes à tous », « Sur invitation » ou « Inscriptions fermées »), le nombre de testeurs, de liens actifs et de nouveaux retours. Un avertissement n'apparaît que s'il est utile : inscription encore ouverte à tous, ou inscriptions fermées (dans ce cas, une invitation ne marche pas). Trois boutons : **➕ Inviter un testeur**, **💬 Voir les retours**, **⚙️ Configurer la bêta**. Aucun formulaire technique n'est visible au chargement.
- **Inviter un testeur** : une fiche avec un seul champ, facultatif (« Pour qui ? »), puis **Créer le lien**. Valeurs sûres : 1 inscription, 14 jours, vague courante. Ensuite viennent **📋 Copier le lien** et **✉️ Copier un message prêt à envoyer**. Le message contient le lien Discord seulement s'il est configuré, et Discord reste présenté comme facultatif. Puis « Inviter quelqu'un d'autre ».
- **Configurer la bêta** : une fiche guidée (qui peut créer un compte, bandeau, bouton « Signaler un bug », Discord, politique de progression avec le texte par défaut affiché). Le bouton « Réglages conseillés » coche invitation, bandeau et signalements. Une liste **« Ce qui va changer »** compare le brouillon à l'état enregistré. « Enregistrer » reste grisé tant que rien ne change. Après l'enregistrement, une confirmation (toast) s'affiche. Le tableau de bord n'affiche jamais un état non enregistré, ce qui corrige l'incohérence relevée (« Sur invitation » dans le champ alors que l'inscription était encore ouverte).
- **Retours des testeurs** : une liste simple, les nouveaux dépliés.
- **Paramètres avancés** (repliés) : liens créés (copie, révocation), testeurs (J+1/J+7), lot de codes (vague, utilisations, expiration, nombre), bugs connus, mot de passe perdu.

**Côté joueur** (`public/js/beta.js`, `main.js`, `i18n.js`, `style.css`) :
- Le lien `/?invite=…` ouvre l'inscription avec le mot d'accueil « 🎟️ Tu es invité·e à la bêta de DIG! Choisis un pseudo, ton e-mail et un mot de passe : c'est tout. ». **Aucun champ « code »** n'apparaît : le code part tout seul. Le formulaire est identique à l'inscription normale.
- Lien déjà utilisé, expiré ou révoqué : le jeu le vérifie **avant** que l'invité remplisse le formulaire. Il affiche alors un seul message (« demande un nouveau lien à la personne qui t'a invité·e ») et un seul bouton, « J'ai déjà un compte : me connecter ».
- Les erreurs d'inscription liées à la bêta sont traduites (FR/EN/NL/ES) et formulées simplement.
- Déjà connecté : le lien est ignoré.

**Serveur** (`server/beta.js`, `server/index.js`, `server/rateLimits.js`) :
- `GET /api/beta/invite/:code` renvoie l'état du lien (`active`, `used`, `expired`, `revoked`, `invalid` ou `closed`). Il est limité à 30 requêtes par IP toutes les 15 minutes (`RATE_INVITE_CHECK_MAX`). Avec environ 8·10¹¹ codes possibles, aucune énumération n'est faisable.
- Une invitation créée sans vague prend la **vague courante** (la plus haute). Le panneau reçoit `currentWave`.
- Aucune migration : aucune table ni colonne nouvelle.

Cohérence de **toutes** les voies d'inscription (point 5 de la recette) :
- **E-mail et mot de passe** (`POST /api/register`) : c'est le **seul** endroit qui crée un compte. Le mode et le code sont vérifiés avant le hachage, puis revérifiés et consommés dans la même transaction que la création du compte (deux inscriptions simultanées ne peuvent pas dépasser la limite).
- **Google (Auth0)** : en mode `link`, il ne fait que lier un compte DIG! existant (mot de passe exigé). Il ne crée jamais de compte. Un test automatique échoue si `createUser` apparaît ailleurs.
- **Activation** : aucune vérification d'e-mail tant que #43 n'est pas livré. Le compte est utilisable tout de suite.
- **Récupération** : sans e-mail, elle passe par le mot de passe temporaire du panel, qui ferme les sessions du joueur.
- **Lien privé** : le code est retiré de la barre d'adresse au chargement et gardé seulement pour l'onglet. Il est à usage unique par défaut, expire après 14 jours et peut être révoqué. Révoquer un lien ne touche pas les comptes déjà créés.

### 4. SHA et procédure de test

- Branche `feature/57-beta-fermee`, commit `045bc5b`, intégré dans `develop` : `2b6c457`.
- `npm test` : 435/435 dans le worktree et dans la release `2b6c457` (nouveaux : état du lien d'invitation, vague courante, aucune autre voie de création de compte, route `GET /api/beta/invite/:code`).
- Essai navigateur (hors `npm test`, base neuve) :
  `PW=…/playwright-core CHROME=…/chrome-headless-shell BASE=http://127.0.0.1:3157 ADMIN=<secret de test> OUT=/tmp/x node test/e2e/beta-invite.e2e.js`.
  Résultat : 8 étapes ✓ (tableau de bord sans configuration, configuration avec aperçu et toast, invitation en 2 clics avec copie vérifiée dans le presse-papiers, invité mobile en navigation privée sans code, lien réutilisé, refus sans lien, mode fermé, aucune erreur JavaScript).

Captures (avant / après), dans `docs/claude-reports/img/` :
- avant : `2026-11-03_ticket-57-avant-panel-desktop.png` ;
- après : `…-1-dashboard-desktop.png`, `…-2-config-desktop.png`, `…-3-invite-desktop.png`, `…-4-invite-mobile.png`, `…-6-used-mobile.png`, `…-7-dashboard-mobile.png`.

### 5. Vérifications, limites, données joueurs

- Aucune donnée joueur modifiée, aucune migration. Empreintes de la base identiques avant et après le démarrage sur une copie de la production (voir §6).
- Non vérifié dans un vrai navigateur : la connexion Google de bout en bout (il faut un compte Google réel). Le code et le test automatique prouvent seulement qu'elle ne crée pas de compte.
- Le premier écran d'un nouvel appareil reste le choix de la langue (comme pour tout nouveau joueur). L'inscription s'ouvre juste après.

### 6. Déploiement et recette de 3 minutes

**Déployé : `2b6c457`** (avant : `3722008`), le 03/11 à 01:08 (Bruxelles), par `scripts/deploy.sh`.
- Sauvegarde vérifiée avant déploiement : `~/backups/dig/dig-20261103-010757-pre-deploy-2b6c457.sqlite`.
- Avant : copie de la production démarrée en `NODE_ENV=production`. `/health` et `/api/version` répondent, les empreintes des 6 tables joueurs sont identiques, aucune table n'est ajoutée ni supprimée.
- Après : les 2 domaines répondent 200 avec la version `1.0.0+2b6c457`, `/health` renvoie `db:true`, `quick_check` vaut `ok`, aucune erreur dans le journal, et les empreintes de production sont identiques à la sauvegarde pré-déploiement. Chromium sur la production (1280×900 et 390×844) avec un lien d'invitation inconnu : aucune erreur JavaScript, aucun bandeau, aucun message (inscription encore « ouverte à tous »).
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 3722008` puis `sudo systemctl restart dig` (aucune migration, donc rien à défaire dans la base).

**Recette de 3 minutes (toi) :**
1. Panel → 🧪 Bêta. Tu vois seulement un tableau de bord : « Inscriptions ouvertes à tous » et un avertissement.
2. **⚙️ Configurer la bêta** → **Réglages conseillés pour la bêta**. Lis « Ce qui va changer » → **Enregistrer**. Une confirmation verte s'affiche et le titre devient « Sur invitation ».
3. **➕ Inviter un testeur** → tape « Test » → **Créer le lien** → **📋 Copier le lien**.
4. Sur ton téléphone, en **navigation privée**, colle le lien → choisis la langue. Le formulaire d'inscription s'ouvre avec « 🎟️ Tu es invité·e… », **sans champ code**. Crée un compte `test_soeur`.
5. Rouvre le même lien dans un nouvel onglet privé : « Ce lien d'invitation n'est plus valable… » et un seul bouton.
6. Panel → **↻ Rafraîchir** : « 1 testeur inscrit ».

Attendu : aucune étape ne demande de comprendre le mot « code ». Le compte de test peut ensuite rester tel quel ou être ignoré.

**Checklist du jour J (avant d'inviter ta sœur) :**
- [ ] Recette de 3 minutes ci-dessus réussie.
- [ ] (Facultatif) Serveur Discord créé, lien collé dans « Configurer la bêta » (procédure : section « Session du 03/11/2026 (nuit) », §9 A, plus bas).
- [ ] Décision 1 (points réels ou simulés) prise dans panel → 🏅 Points.
- [ ] Un lien par proche (« Inviter un testeur » → prénom), envoyé avec « Copier un message prêt à envoyer ».
- [ ] Le soir même : panel → 🧪 Bêta → « Voir les retours », puis Paramètres avancés → Testeurs (le compte a-t-il sauvegardé ?).
- [ ] À J+1 : la colonne J+1 des testeurs, et la question « ta progression est-elle toujours là ? ».

Classement : **Bloquant MVP** (accès des premiers testeurs).

### 7. Choix techniques faits seul

- Fiches `<dialog>` existantes du panel plutôt qu'un nouvel écran : même ergonomie que Saisons, Ligues et Blocs.
- Vérification du lien avant le formulaire, par une route publique limitée en débit, pour que l'invité n'apprenne pas l'échec après avoir tout rempli.
- Inscription « ouverte à tous » et lien périmé : le message est masqué (l'invité peut s'inscrire quand même, l'inquiéter ne sert à rien).
- Pas d'envoi automatique : le panneau prépare le texte, et c'est toi qui l'envoies.

### 8. Décisions demandées au propriétaire

Inchangées par rapport à la session précédente (voir plus bas, §8) : (1) points réels ou simulés pendant la bêta, recommandé **simulés** ; (2) politique de reset, recommandé « peut être ajustée » ; (3) badge « Testeur fondateur » sans bonus, oui ou non ; (4) fournisseur e-mail pour #43, **bloquant avant 10–20 testeurs**.

### 9. Reste à faire

- #43 e-mails (bloquant pour 10–20), #33 portefeuille de points, #19/#48 promotions et saisons thématiques, #36 sauvegarde hors machine, conditions d'utilisation : classés « Après la vague 1 ».
- Après lancement : un essai de la connexion Google de bout en bout avec un vrai compte, une fois l'inscription Google éventuellement ouverte.

---

## Session du 03/11/2026 (nuit)

### 1. État réel

**Déployé en production (SHA `1ac0ecf`), en attente de recette.** Tout est désactivé par défaut : rien ne change en jeu tant que tu n'actives rien dans /admin → 🧪 Bêta.

### 2. En bref : GO / NO-GO

| Étape | Verdict | Pourquoi |
|---|---|---|
| **Pré-bêta familiale (3–5 proches, Discord)** | **GO sous 3 conditions** | (1) créer le serveur Discord et coller le lien dans le panel ; (2) décider si les points de récompense restent en mode réel (question 1) ; (3) accepter que le « mot de passe oublié » passe par toi (mot de passe temporaire du panel) tant que les e-mails (#43) ne sont pas configurés. |
| **Bêta fermée 30 joueurs** | **NO-GO pour l'instant** | Manquent : e-mails du jeu (#43), coordonnées de l'éditeur sur la page de confidentialité + conditions d'utilisation + suppression de compte, surveillance externe, et la recette navigateur des tickets en attente (#35, #47). |
| **Bêta 100 joueurs** | NO-GO | En plus : économie toujours calculée par le navigateur (pièces/gemmes falsifiables, #25 lots C–E), à accepter explicitement ou corriger. |

Production au moment de l'audit : **1 seul compte** (le tien) dans la base. Aucun joueur extérieur ne peut donc être perturbé par la bêta.

### 3. Ce qui a été livré

Tout est **désactivé par défaut** : au déploiement, le jeu est strictement identique (inscription ouverte, aucun bandeau, aucun lien Discord). Tu actives chaque élément toi-même dans **/admin → 🧪 Bêta**.

- **Inscription sur invitation** (`server/beta.js`, `POST /api/register`) : trois modes, *ouverte* (comme avant), *sur invitation* (code obligatoire) et *fermée*. Les codes ont la forme `DIG-XXXX-XXXX`, avec un nombre d'utilisations, une date d'expiration (14 jours par défaut), une révocation possible et un numéro de vague (10 → 30 → 100). Le code est consommé dans la même transaction que la création du compte : deux inscriptions simultanées ne peuvent pas dépasser la limite. Ni le mode ni la révocation n'empêchent les comptes existants de se connecter (c'est testé).
- **Lien d'invitation** `https://dig.lodygames.com/?invite=DIG-XXXX-XXXX` : il ouvre directement « Créer un compte » avec le code déjà rempli, et le code disparaît de la barre d'adresse. Le panel propose « 📋 Copier le lien ». Le jeu n'envoie **aucune** invitation de lui-même.
- **Bandeau BÊTA** sous l'en-tête, sur une seule ligne : « 🧪 BÊTA — jeu en développement », bouton « 🐞 Signaler un bug » et × pour le masquer pendant la session. Il est loin de la zone de minage.
- **Section « 🧪 Bêta » dans Paramètres** : politique de progression (texte par défaut traduit en FR/EN/NL/ES : « la progression peut être ajustée ou remise à zéro pendant la bêta, aucune récompense réelle n'est promise », ou ton propre texte), bugs connus, version, bouton Discord (**seulement si un lien est configuré**, jamais inventé), bouton de signalement et « Mes signalements » avec leur statut (reçu, en cours d'analyse, corrigé + lien vers le ticket GitHub). Le testeur voit donc quand son bug est corrigé.
- **Signaler un bug** : quatre champs (étape, attendu, constaté, appareil prérempli « Android · Chrome »). Une case, **décochée par défaut**, joint les infos techniques : version, navigateur, taille d'écran, langue, écran du jeu, page **sans paramètres** (les jetons des liens e-mail ne partent jamais). Leur contenu exact est visible avant l'envoi. Aucune capture et aucune IP ne sont enregistrées. Après l'envoi, « 📋 Copier pour Discord » prépare un message au format « appareil, étape, attendu, constaté, capture » à coller dans #bugs. Limite : 5 envois par 15 min.
- **Panel → 🧪 Bêta** :
  - réglages ;
  - codes (créer, copier le lien, révoquer) ;
  - **testeurs** : comptes créés avec un code, date d'inscription, dernière sauvegarde, retour J+1 et J+7 (approximation fondée sur la dernière sauvegarde cloud, sans outil d'audience) ;
  - **signalements** : statut, lien GitHub, note interne, diagnostic ;
  - **mot de passe temporaire** pour un testeur qui a perdu le sien. Il est affiché une seule fois, toutes ses sessions sont fermées, et il faut confirmer en saisissant le nom exact du joueur.
- **`/health` vérifie la base** : il renvoie 503 si SQLite ne répond pas. `deploy.sh` s'appuie sur ce contrôle, donc un retour arrière se déclenche aussi dans ce cas.
- **Simulation de 12 cycles de saisons** (`test/season-cycles-12.test.js`), dans une base isolée avec une horloge simulée, de mars à mai 2027 :
  - rotations hebdomadaires, avec le planificateur appelé deux fois à chaque passage (idempotence) ;
  - une saison sans participant ;
  - des ex æquo parfaits, deux fois ;
  - des joueurs absents puis revenus ;
  - deux fins exceptionnelles en heure de Bruxelles, **avant** (16:00 = 15:00 UTC) et **après** (16:00 = 14:00 UTC) le passage à l'heure d'été du 28/03/2027, avec une saison courte qui couvre la nuit du changement d'heure ;
  - une **panne de 15 jours** suivie d'un redémarrage (migrations rejouées) et du rattrapage des semaines manquées ;
  - les points en mode réel et les promotions de ligue.

  Invariants vérifiés sur les 14 saisons closes : contiguïté à la seconde, noms uniques, une seule saison active, classement figé vérifiable pour chaque saison, **une seule attribution de points par saison**, aucun double crédit, soldes égaux au total crédité, registre valide, au plus un niveau de ligue gagné par clôture, et **comptes et sauvegardes jamais réécrits**.

Fichiers : `server/beta.js` (nouveau), `server/db.js` (4 tables ajoutées), `server/index.js`, `server/rateLimits.js`, `public/js/beta.js` (nouveau), `public/js/main.js`, `public/js/i18n.js` (FR/EN/NL/ES), `public/index.html`, `public/css/style.css`, `public/admin/index.html`, `public/admin/admin.js`, `test/beta.test.js` (nouveau, 7 tests), `test/season-cycles-12.test.js` (nouveau).

### 4. SHA et procédure de test

- Branche `feature/57-beta-fermee`, commit `b7eb06b`, intégré dans `develop` au merge `1ac0ecf`.
- `npm test` : **432/432** dans le worktree du ticket et dans la release `1ac0ecf`. `npm run check` est ok.
- `node --test test/beta.test.js test/season-cycles-12.test.js` couvre les invitations, la fermeture, les signalements, le mot de passe temporaire, `/health` et les 12 cycles.
- Essai navigateur sur un serveur de test (port 3101, base de test supprimée ensuite), sur ordinateur 1280×900 et sur smartphone 390×844. Le lien d'invitation remplit le code, l'inscription fonctionne, un code épuisé est refusé avec un message clair, le bandeau s'affiche, le signalement est envoyé avec diagnostic et apparaît dans « Mes signalements ». Côté panel : réglages, codes, testeurs, signalements et mot de passe temporaire fonctionnent. Aucune erreur JavaScript.

### 5. Vérifications, limites, données joueurs

- **Migration** testée sur une copie de la base de production démarrée en `NODE_ENV=production` : empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` **identiques** avant et après. Seules 4 tables sont ajoutées (`beta_settings`, `beta_invites`, `beta_invite_uses`, `bug_reports`). Copie supprimée ensuite.
- Aucune donnée joueur n'est modifiée. Le mot de passe temporaire n'agit que lorsque tu le déclenches, sur un compte précis.
- Limites :
  - le texte personnalisé de politique et de bugs connus n'est affiché que dans la langue où tu l'écris ;
  - J+1 et J+7 sont approximatifs : seule la dernière sauvegarde est connue ;
  - pas de captures d'écran dans le jeu (Discord sert à ça) ;
  - pas de suppression automatique des anciens signalements.
- Non vérifié : rendu sur un vrai iPhone ou Android, délivrabilité Discord.

### 6. Déploiement et test à faire par le propriétaire

- **Déployé : `1ac0ecf`** le 03/11/2026 à 00:26 (Bruxelles), en avance rapide de `main` depuis `06ca5ba`, avec `scripts/deploy.sh` de la release. Pas de `npm ci`, le lockfile est inchangé.
- Le déploiement a été **retardé d'environ 1 min**, le temps que ta génération d'icône en cours se termine (culotte de Dagobert, terminée à 00:25:22), pour ne pas l'interrompre.
- Sauvegarde vérifiée : `~/backups/dig/dig-20261103-002631-pre-deploy-1ac0ecf.sqlite`.
- Vérifications faites :
  - les deux domaines répondent 200 ;
  - `/api/version` = `1.0.0+1ac0ecf` ;
  - `/health` = `{ok:true, db:true}` ;
  - `/api/beta/config` renvoie les valeurs par défaut (ouvert, bandeau masqué, pas de Discord) ;
  - le journal est sans erreur ;
  - `quick_check` = ok ;
  - les empreintes joueurs sont **identiques** à la sauvegarde pré-déploiement ;
  - Chromium sur la production (ordinateur et smartphone) : jeu chargé, pas de bandeau, aucune erreur JavaScript.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 06ca5ba && sudo systemctl restart dig`. Les tables ajoutées restent, sans effet.

**Test fonctionnel (10 min, PC puis téléphone) :**
1. /admin/ (Ctrl+F5) → **🧪 Bêta**. Le bandeau jaune indique « Inscription ouverte à tous · bandeau masqué · Discord non configuré ».
2. Coche « Bandeau BÊTA… », colle le lien d'invitation Discord **si le serveur existe déjà** (sinon laisse vide), puis **Enregistrer**.
3. Codes d'invitation : libellé « Test », 1 utilisation → **Créer** → « 📋 Copier le lien ».
4. Mode d'inscription « Sur invitation » → **Enregistrer**.
5. Sur le téléphone, en navigation privée, ouvre le lien copié. **Attendu :** bandeau BÊTA, formulaire « Créer un compte » avec le code déjà rempli. Crée un compte de test.
6. Rouvre le même lien dans un autre onglet privé et essaie un 2ᵉ compte. **Attendu :** « Code d'invitation invalide, expiré ou déjà utilisé. »
7. Avec le compte de test : bandeau → « 🐞 Signaler un bug », remplis « Constaté », coche la case, regarde « Voir exactement ce qui sera envoyé », puis **Envoyer**. **Attendu :** « Merci ! Signalement n°… reçu » et un bouton « Copier pour Discord ».
8. Panel → 🧪 Bêta : le testeur « Test » apparaît, ainsi que le signalement. Passe-le en « corrigé » → sur le téléphone, Paramètres → Bêta → Mes signalements affiche « corrigé ».
9. Vérifie que ton propre compte se connecte toujours normalement (le mode invitation ne touche pas les comptes existants).
10. Remets le mode d'inscription de ton choix (« Sur invitation » recommandé pendant la bêta).

**Classement MVP :** **Bloquant MVP** (accès contrôlé et canal de retour sont des prérequis de la bêta familiale).

### 7. Choix techniques faits seul

- **Tout désactivé par défaut** : aucun effet visible au déploiement, et le lancement reste ta décision (« ne pas auto-activer l'accès public »).
- **Signalements stockés dans le jeu**, en plus de Discord : ça marche même sans serveur Discord, le suivi par joueur est possible, et le texte est déjà mis au format Discord. Ça reste le plus simple : pas d'envoi automatique vers GitHub, et c'est toi qui lies le ticket.
- **Diagnostic sur consentement, case décochée par défaut**, contenu affiché avant l'envoi. Aucune IP ni capture.
- **Mot de passe temporaire par l'admin** plutôt que d'attendre #43 : c'est le seul moyen, aujourd'hui, de débloquer un proche qui a oublié son mot de passe.
- **Codes sans caractères ambigus** (pas de 0/O ni de 1/I/L), pour qu'ils puissent être dictés. Le lien d'invitation évite de toute façon d'avoir à les saisir.
- **Badge « Testeur fondateur » non créé** : il faut d'abord ta validation (question 3). Le système de badges (#38) le permet sans aucun bonus.

### 8. Décisions demandées au propriétaire

1. **Points de récompense pendant la bêta.** Ils sont aujourd'hui en mode **réel** (depuis le 30/10) : avec 3 testeurs éligibles, le 1er reçoit 100 points. Le ticket demande « aucune promesse de conservation des points ». Options :
   - (a) les laisser réels et annoncer qu'ils peuvent être remis à zéro en fin de bêta ;
   - (b) repasser en **simulation** (panel → 🏅 Points), qui calcule les points sans les créditer.

   **Recommandation : (b)** pendant la bêta familiale.
2. **Politique de reset** : faut-il annoncer qu'en fin de bêta la progression **sera** remise à zéro, ou seulement qu'elle **peut** l'être ? **Recommandation :** « peut être ajustée », comme le texte par défaut. Ça ne promet rien et ça n'oblige à rien.
3. **Badge « Testeur fondateur »**, honorifique, sans aucun bonus : oui ou non ? Si oui, je le crée dans un ticket #38 ou #57 et il sera attribué aux comptes créés avec un code de la vague 1.
4. **E-mails du jeu (#43)** : c'est le vrai bloquant avant 30 joueurs. Choisis le fournisseur (voir #43) ; d'ici là, le mot de passe temporaire du panel suffit pour 3 à 5 proches.

### 9. Ce qu'il reste à faire, côté propriétaire, étape par étape

**A. Discord (≈ 15 min, toi) :**
1. Discord → « + » → *Créer le mien* → *Pour un club ou une communauté* → nom « Dig — Bêta ».
2. Salons texte : `#bienvenue`, `#annonces`, `#bugs`, `#suggestions`, `#discussion`. Dans `#annonces` et `#bienvenue`, retire à `@everyone` le droit « Envoyer des messages ».
3. Paramètres du serveur → Rôles : crée « Testeur » **sans** « Administrateur » ni « Gérer le serveur ». Ne donne à personne d'autre que toi les droits d'administration.
4. Message épinglé dans `#bugs` : « Pour chaque bug : **appareil**, **étape**, **attendu**, **constaté**, **capture**. Le bouton 🐞 du jeu prépare ce message pour vous. »
5. Inviter → *Modifier le lien* : expiration 7 jours, nombre d'utilisations 5, puis copie le lien `https://discord.gg/…`.
6. Panel → 🧪 Bêta → colle-le dans « Lien d'invitation Discord » → Enregistrer.

**B. Ouvrir la vague 1 (≈ 5 min) :** panel → 🧪 Bêta :
1. Mode « Sur invitation » + bandeau coché.
2. Crée un code par proche (libellé = prénom, 1 utilisation, 14 jours).
3. Envoie à chacun, en message privé, le lien du jeu et le lien Discord.

**C. Script de test externe de 15 min (à envoyer aux testeurs) :**
1. *(2 min)* Ouvre le lien d'invitation sur ton téléphone, crée ton compte et note ton pseudo.
2. *(3 min)* Mine une vingtaine de blocs. La profondeur augmente-t-elle ? Les pièces aussi ?
3. *(2 min)* Boutique : achète une amélioration. Quotidien : récupère la récompense.
4. *(2 min)* Ouvre un coffre (s'il est disponible) et note ce que tu as reçu.
5. *(2 min)* Sur un **autre appareil** (PC), connecte-toi avec le même compte. Retrouves-tu ta profondeur et tes pièces ? Le téléphone affiche-t-il « Partie ouverte sur un autre appareil » ?
6. *(1 min)* Onglet 🏆 Saison : te vois-tu dans le classement ?
7. *(1 min)* Si quelque chose cloche, utilise 🐞 « Signaler un bug », puis « Copier pour Discord » et colle le message dans #bugs avec une capture.
8. *(2 min)* **Le lendemain (J+1)**, rouvre le jeu : ta progression est-elle toujours là ? Dis-le dans #discussion.

**D. Critères de passage :**
- **Vague 1 (3–5 proches) → vague 2 (≈ 30)** : 7 jours sans perte de progression signalée, aucun bug bloquant ouvert dans `#bugs`, au moins 60 % des testeurs revenus à J+1 (panel → Testeurs), au moins une clôture de saison observée sans anomalie, #43 (e-mails) et page légale complétée.
- **Vague 2 → vague 3 (≈ 100)** : 14 jours stables, surveillance externe en place, décision prise sur l'économie côté client (#25 C–E et #49), sauvegarde hors machine prouvée (#36), conditions d'utilisation publiées.

**E. Après la bêta familiale (classé « Après lancement », sauf mention) :**
- surveillance externe gratuite de `/health` (UptimeRobot ou équivalent, à créer par toi) ;
- conditions d'utilisation, coordonnées de l'éditeur et suppression de compte (**bloquant pour 30 et plus**) ;
- CSP `script-src` ;
- heure de fin de saison affichée en heure locale (la rotation se fait en UTC : fin le dimanche à 23:59:59 UTC, soit lundi 00:59 ou 01:59 à Bruxelles) ;
- recette navigateur de #35 et #47.

### Vrais P0 restants (liste courte)

1. Lien Discord à créer et à coller (toi, partie A).
2. Décision sur les points réels ou simulés (question 1).
3. E-mails du jeu, #43 (avant 30 joueurs ; contourné pour 3 à 5 proches par le mot de passe temporaire).

### Les 3 prochains tests concrets pour toi

1. Le test fonctionnel du §6 (10 min).
2. La création du Discord, partie A (15 min), puis un essai de « Copier pour Discord » vers `#bugs`.
3. Le script de 15 min de la partie C, fait toi-même sur ton téléphone avec un code d'invitation, avant de l'envoyer à ta sœur.
