# Ticket #63 — Navigation joueur : séparer Profil et Paramètres dans le header mobile/PC

Ticket : https://github.com/ReC82/Dig/issues/63

## Session du 04/11/2026 (19:20–19:45, Bruxelles)

### 1. État réel

**Déployé en production (SHA `5a32746`) — en attente de recette.**

### 2. Résultat et changements

Avant : la personne et l'engrenage en haut à droite ouvraient tous les deux la même page Paramètres.

Maintenant :

- **Personne → Profil**, une nouvelle vue en lecture seule :
  - **Identité** : avatar (initiale du pseudo dans la pastille dorée), pseudo, « Membre depuis le … » (date d'inscription déjà enregistrée), statut X s'il est lié. Sans compte : « Invité », une explication et un bouton « Se connecter ou créer un compte » qui ouvre Paramètres.
  - **Progression** (sauvegarde du joueur) : profondeur, pioche, dégâts par coup, blocs détruits, pièces gagnées au total, coffres trouvés, gemmes trouvées, reliques débloquées, objets de collection, série quotidienne.
  - **Badges et saison** : « n / total obtenus », solde de points de saison s'il est déjà chargé, boutons « Voir mes badges › » (Collection → Badges) et « Voir la saison › ».
  - **Ce qui est visible** : public = pseudo, profondeur et blocs minés (classement de la saison) ; privé = e-mail, statistiques, badges, points. L'e-mail n'est pas affiché dans le Profil.
  - Boutons « Paramètres du compte › » et « ← Retour ».
- **Engrenage → Paramètres** : contenu inchangé (compte, connexion/inscription, mot de passe, e-mail, Google, X, langue, bêta, historique des notifications, publicité, confidentialité, déconnexion). Rien du Profil n'y est dupliqué.
- **Navigation** : le bouton de la vue ouverte est mis en évidence (`aria-current="page"`). Un second appui sur ce même bouton, ou « Retour », ramène à l'onglet d'origine. La barre du bas n'est pas touchée, donc le bloc en cours et la partie restent intacts. Les zones tactiles font 44×44 px.
- Libellé accessible de la personne : « Profil et compte » devient **« Profil »** (fr/en/nl/es/it).

Fichiers :
- `public/index.html` : `#view-profile`, `aria-controls` sur les deux boutons.
- `public/js/main.js` : `HEADER_VIEWS`, `_toggleHeaderView`, `renderProfile`, décompte des badges partagé avec la Collection.
- `public/css/style.css` : styles du Profil et état actif des boutons.
- `public/js/i18n.js` : bloc `profile.*` en fr/en/nl/es.
- `i18n/it.json` et `public/js/locales/it.js` : italien.
- `server/db.js` et `server/accountRoutes.js` : `/api/me` renvoie en plus `createdAt`, la date d'inscription existante, en lecture seule.
- Tests : `test/profile-nav.test.js` (nouveau), `test/account-recovery.test.js` (ajusté pour `createdAt`), `test/e2e/profile-settings.e2e.js` (nouveau parcours Chromium).

### 3. SHA, branche, procédure de test

- Branche `feature/63-profil-parametres`, commit `c2439a7` ; **develop `5a32746`** (merge `--no-ff`).
- `npm test` : **646/646**, sur la branche puis sur le SHA exact de la release.
- Parcours Chromium sur serveur de test (`DB_FILE=test-63.sqlite PORT=3101 node server/index.js`, puis `DIG_E2E_BASE=http://127.0.0.1:3101 NODE_PATH=<playwright-core> node test/e2e/profile-settings.e2e.js`) : **48/48** contrôles, PC 1280×900 et smartphone 390×844. Ils couvrent : invité, vues distinctes, bouton actif, retour vers Améliorations, second appui, bloc inchangé, aucun rechargement, compte connecté (pseudo, « Membre depuis », badges, e-mail absent), **un seul** appel `/api/me/badges` pour deux ouvertures rapprochées, Profil → Paramètres → déconnexion présente, 44 px, pas de débordement, aucune erreur console.

### 4. Vérifications et limites

- Données des joueurs : aucune écriture, aucune migration. `/api/me` lit une colonne existante (`users.created_at`).
- Les statistiques viennent de la sauvegarde du joueur (`GameState.stats`). Elles sont cumulées depuis le début de la partie sur ce compte ou cet appareil.
- Points de saison : affichés seulement s'ils ont déjà été chargés par l'onglet Saison. C'est voulu, pour ne pas ajouter trois appels réseau.
- Il n'y a pas de photo de profil : aucune donnée d'avatar n'existe. L'initiale du pseudo la remplace.
- Le bouton « Retour » du système Android / PWA n'est pas géré par l'historique du navigateur : ce comportement existait déjà pour Paramètres et n'a pas été modifié.

### 5. Déploiement

- **SHA déployé `5a32746`** (04/11 19:35), précédent `6b5a981`.
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261104-193516-pre-deploy-5a32746.sqlite`.
- Avant : copie de la base de production démarrée avec la release (port 3122), `/health` ok, `/api/version` = `1.0.0+5a32746`, empreintes identiques après démarrage (`users`, `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking`). Copie supprimée ensuite.
- Après : dig.lodygames.com et dig.lodylands.com → 200, version `1.0.0+5a32746` ; journal sans erreur ; `quick_check` ok ; empreintes identiques à la sauvegarde ; contrôle Chromium en production en invité (mobile et PC) : Profil, Paramètres et retour ok, 0 erreur.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 6b5a981` puis `sudo systemctl restart dig`. Aucune base à restaurer.

**Test fonctionnel à faire par le propriétaire (2 min)** :
1. Sur téléphone, recharger https://dig.lodygames.com et commencer à casser un bloc.
2. Toucher la **personne** → page « PROFIL » : pseudo, « Membre depuis le … », progression, « n / N obtenus », public/privé. Aucun champ ni aucune langue.
3. Toucher l'**engrenage** → page « PARAMÈTRES » : Compte, Langue, Historique des notifications, déconnexion.
4. Toucher l'engrenage une seconde fois (ou « ← Retour ») → retour à Creuser : le bloc a les mêmes PV qu'avant.
5. Depuis Amélios, ouvrir Profil puis « ← Retour » → retour à Amélios.
6. Répéter sur PC.

Résultat attendu : deux vues réellement différentes, un retour fidèle, ni déconnexion ni perte de progression.

**Classement MVP** : Bloquant MVP public (léger — un nouveau joueur voyait deux boutons identiques). Livré.

### 6. Choix techniques faits seul

- **Avatar = initiale du pseudo** : aucune image de profil n'existe, et le ticket demande de ne pas inventer de données.
- **« Membre depuis »** : `created_at` est ajouté à `/api/me`. Le compte ne voit que sa propre date d'inscription, aucune nouvelle donnée n'est créée.
- **Décompte des badges** : une requête au plus par minute, partagée avec l'onglet Collection.
- **Second appui sur le bouton = retour** : c'est le comportement attendu d'un bouton à bascule, et on peut sortir sans chercher « Retour ».
- **Italien** : les 26 textes (25 nouveaux + libellé « Profilo ») ont été traduits par la session (même méthode que #59), avec le marquage `origin: ai` dans `i18n/it.json`.

### 7. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire.

### 8. Reste à faire

Rien pour ce ticket. Pistes d'amélioration (Après lancement, hors périmètre) :
- gérer le bouton Retour Android / PWA avec l'historique du navigateur pour toutes les vues d'en-tête ;
- afficher le rang de saison dans le Profil s'il est déjà chargé.
