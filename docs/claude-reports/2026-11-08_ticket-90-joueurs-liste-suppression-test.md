# Ticket #90 — Admin Joueurs : liste paginée par défaut et suppression contrôlée d'un compte de test

- Ticket : [#90 — [P1][Admin] Joueurs — liste paginée par défaut et suppression contrôlée d'un compte de test pour refaire l'inscription](https://github.com/ReC82/Dig/issues/90)
- Liés : #75 (Recommencer un test à zéro, inchangé), #80 (Retirer de la bêta, inchangé), #84 (bêta collègues)
- Classement : **Bloquant MVP public** pour la liste (outil de suivi de la bêta du 09/11) ; la suppression de compte de test est un outil de recette, **Après lancement** si elle devait être retirée.

## Session du 10/11/2026 (DIGORCH) — recette #90-B : diagnostic d'éligibilité avant marquage

### 1. État réel

**Déployé en production (SHA `11b00c0`, 10/11/2026 12:25 Bruxelles) — en attente de recette du diagnostic.**
Déjà validé par le propriétaire le 10/11 (ne pas redemander) : **#90-A** (liste, pagination, tri, recherche, retour depuis la fiche) et **#90-B bis** (suppression d'une identité jetable neuve puis réinscription avec la même identité).

### 2. Retour traité

Recette #90-B : le compte `testeur` (ID 2), marqué « compte de test », restait non supprimable et la fiche ne le disait qu'**après** la saisie du motif, du pseudo et de SUPPRIMER. Le refus lui-même est voulu (verrous du ticket) et **n'a pas été modifié**.

### 3. Changements réalisés

- `server/playerAdmin.js` — l'aperçu de suppression renvoie un diagnostic `eligibility` :
  - `needs_mark` : aucune donnée protégée, il manque seulement la marque ;
  - `deletable` : marqué, aucune donnée protégée ;
  - `protected` : données protégées — « Même marqué « compte de test », ce compte ne pourra pas être supprimé : N catégories de données protégées » (avant marquage) ou « Compte de test reconnu, mais suppression bloquée par N catégories de données protégées » (après).
  - Chaque verrou indique sa catégorie, son nombre, **sa raison en langage simple** et un détail sans donnée personnelle (types de mouvements de points, saison et rang, commande virtuelle/réelle et statut, place au classement figé).
- Admin → Joueurs → fiche → **Actions sensibles** : le diagnostic s'affiche **dès l'ouverture** (vert / doré / rouge), le bouton « Supprimer le compte de test… » est **désactivé** quand des données sont protégées, et « **Pourquoi ? Et comment refaire une inscription quand même** » explique chaque verrou et les voies sûres (identité jetable neuve ; « Recommencer un test à zéro » #75 qui garde login, points et classement figé).
- Fenêtre « Marquer comme compte de test » : **avertissement avant la saisie** si la marque ne suffira pas.
- Correctif : dans la fenêtre de suppression, le formulaire (motif, pseudo, SUPPRIMER) devait être masqué quand la suppression est impossible, mais une règle CSS `display:flex` l'emportait sur `hidden` — c'est pourquoi la capture #90-B montrait les champs saisis avec un bouton grisé. Il est maintenant masqué.
- Aucun bouton de contournement, aucune suppression automatique, aucune modification de données.

### 4. SHA, branche et procédure de test

- Branche `feature/90-joueurs-liste-suppression-test`, commit `7555b5a` ; **`develop` = `11b00c0`** (déployé).
- `npm test` : **1046/1046** sur le SHA exact `11b00c0` (release) et sur la branche. Nouveau test unitaire « diagnostic d'éligibilité (#90-B) » dans `test/admin-players-90.test.js` : compte neuf `needs_mark` → `deletable` → supprimé ; compte de type « testeur » (crédit admin, dépense, remboursement, attribution de saison réelle, commande annulée, classement figé) : `protected` dès avant le marquage avec 5 catégories, détails lisibles, aucun e-mail ; après marquage « reconnu, mais bloqué », suppression refusée, données intactes.
- Essai navigateur `test/e2e/players-90b.e2e.js` (serveur de test port 3101, base temporaire) : **réussi** à 1280, 390 et 320 px sans débordement — diagnostic avant marquage, avertissement dans la fenêtre de marquage, diagnostic « reconnu, mais bloqué » après, bouton désactivé, « Pourquoi ? », identité jetable : formulaire masqué tant que non marquée, puis suppression possible.

### 5. Vérification demandée : valeurs réelles ou données fictives de bêta ? (lecture seule de la base de production)

Pour le compte ID 2, les 5 catégories bloquantes proviennent de **deux origines différentes** :
- **Données d'essai** (#34, 03/11) : un crédit manuel admin de 1 point motivé « TEST #34 », dépensé pour l'article fictif « Titre honorifique TEST » (virtuel), commande **annulée** et **remboursée**. Fictif, mais inscrit dans des registres en ajout seul protégés par des déclencheurs SQLite.
- **Valeur réelle de saison** : attribution **réelle** (mode « live ») de 5 points de mérite pour la saison 8 (« Saison 45-2026 », clôturée, rang 2 sur 2 éligibles), avec la 2ᵉ place dans le **classement figé** de cette saison (instantané chaîné par empreinte). Portefeuille : solde 6 points (7 gagnés, 1 dépensé).

Conclusion : le refus n'est **pas** dû seulement à des données fictives ; un nettoyage « des données de test » ne suffirait pas à rendre ce compte supprimable sans toucher à un classement de saison publié.

### 6. Analyse — procédure exceptionnelle pour réutiliser exactement `testeur` (NON mise en œuvre)

Elle exigerait, sous accord écrit et spécifique du propriétaire :
1. **Migration destructive** : `reward_point_ledger`, `reward_point_awards`, `shop_orders`, `season_standings` et `season_snapshots` sont protégés par des déclencheurs « suppression interdite » ; il faudrait les désactiver, ce que les règles du projet interdisent sans accord.
2. **Classement figé** : retirer ou anonymiser la 2ᵉ place de la saison 8 casse la chaîne d'empreintes (`rows_hash` / `snapshot_hash` / `prev_hash`) des saisons suivantes ; il faudrait soit garder la ligne avec un identifiant d'archive (anonymisation : `user_id` remplacé par un identifiant fantôme jamais attribué), soit recalculer et republier la chaîne. Le second point modifie un résultat publié ; seul le premier est envisageable.
3. **Tiers** : l'autre joueur classé 1ᵉʳ de la saison 8 garde son rang et ses points ; aucune ligue n'est impactée (une seule ligue). Aucun gain réel ni paiement concerné.
4. **Obligations** : pas de lot réel ni de paiement ; aucune obligation comptable ; la trace d'audit `account_deletions` garderait le motif.
5. **Sécurité** : sauvegarde vérifiée avant, opération en une transaction, retour arrière = restauration de la sauvegarde (uniquement sur décision du propriétaire).

**Recommandation** : ne pas le faire. La voie sûre est validée (#90-B bis) : identité jetable neuve pour tester l'inscription ; pour rejouer avec `testeur`, « Recommencer un test à zéro » (#75) remet la progression à zéro sans toucher à l'historique.

### 7. Déploiement

- Copie de la base de production démarrée avec `11b00c0` (port 3122) : santé et version OK, **empreintes identiques** (users, user_saves, season_rankings, seasons, leagues, player_click_tracking) ; copie supprimée.
- Aucune génération IA en cours (dernier appel de l'atelier 35 min avant).
- `main` avancé en avance rapide `c1c9cdd → 11b00c0`, `scripts/deploy.sh` de la release : sauvegarde vérifiée `~/backups/dig/dig-20261110-122541-pre-deploy-11b00c0.sqlite`, santé et version OK.
- Après déploiement : 2 domaines 200 + `1.0.0+11b00c0`, API admin 401 sans authentification, journal sans erreur, `quick_check` ok, empreintes de production identiques à la sauvegarde pré-déploiement, jeu et admin chargés sans erreur JS (PC + mobile ; seuls les 401 attendus hors connexion).
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep c1c9cdd` + redémarrage (aucune migration, aucun changement de dépendances).
- **Aucun compte supprimé ni marqué en production par cette session.**

**Test fonctionnel à faire par le propriétaire (#90-C, ~2 min)** — Admin → Joueurs → ouvrir la fiche **TESTEUR (ID 2)** → déplier « Actions sensibles » :
1. Sans rien saisir, un encadré rouge dit « ⛔ Compte de test reconnu, mais suppression bloquée par 5 catégories de données protégées. », liste les 5 catégories avec leur détail, et le bouton « Supprimer le compte de test… » est grisé.
2. Déplier « Pourquoi ? » : une raison par catégorie et les deux voies sûres (identité jetable neuve ; Recommencer un test à zéro).
3. (Facultatif) Ouvrir la fiche d'un compte neuf jamais joué, non marqué : encadré doré « Aucune donnée protégée : la suppression sera possible une fois le compte marqué… ». Ne rien supprimer.

Classement : **Après lancement** (outil admin de recette ; la liste #90-A, bloquante MVP, est validée).

### 8. Choix techniques faits seul

- Le diagnostic est calculé côté serveur dans l'aperçu existant (lecture seule) : une seule source de vérité avec le refus de suppression.
- Bouton de suppression désactivé quand des données sont protégées (et non masqué) : l'administrateur voit que l'action existe et pourquoi elle est indisponible.
- Le marquage reste possible sur un compte protégé (utile pour le filtre « Comptes de test »), mais avec l'avertissement préalable.

### 9. Décisions demandées au propriétaire

1. Procédure exceptionnelle pour réutiliser exactement `testeur` (anonymisation des historiques, section 6) : **(a) non, garder l'identité jetable + Recommencer un test à zéro — recommandé** ; (b) oui, préparer un script d'anonymisation à valider séparément (migration destructive, accord écrit requis).

### 10. Reste à faire

- Recette #90-C du diagnostic. Rien d'autre dans le périmètre.

## Session du 08/11/2026 (DIGORCH)

### 1. État réel

**Déployé en production (SHA `b8d8f77`, 08/11/2026 23:52 Bruxelles) — en attente de recette.**

### 2. Résultat et changements

**Liste des joueurs (Admin → Joueurs & testeurs → Joueurs)**
- Au chargement, la rubrique montre **immédiatement** la liste des joueurs (plus d'écran vide) : total, **20 par page** par défaut (10 / 20 / 50), pages précédente / suivante, numéros de page (première, dernière, voisines), tri **Dernière activité** (défaut) / Inscription récentes / anciennes / Pseudo / ID, filtre **Tous / Actifs 7 jours / Testeurs bêta / Comptes de test / Suspendus (anti-bot)**.
- Recherche partielle **sur toute la base** (côté serveur), insensible à la casse, aux accents et ligatures (« MASSÉ » trouve « masse_… »), ou par `#ID`. Jokers `%` `_` pris au pied de la lettre. L'autocomplétion existante (#37) est conservée ; « Rechercher » avec un seul résultat ouvre directement la fiche (#76).
- Colonnes : pseudo (cliquable → fiche existante avec essais #75 et anti-bot), ID, inscription, **dernière activité** (dernière sauvegarde ou dernier signal de la page de jeu reçus par le serveur — donnée réelle), statut (compte de test, testeur bêta / retiré de la bêta, suspendu), progression (profondeur, blocs manuels de la saison). **Aucun e-mail** ni secret.
- « Fermer » la fiche revient sur la ligne du joueur, **même page, même recherche, même tri**. État vide « Aucun joueur pour ce filtre. », erreur lisible si le serveur ne répond pas.
- Smartphone : le tableau passe en cartes (composant `adm-rtable` existant) ; contrôlé **sans débordement horizontal** à 1280, 390 et 320 px.

**Fiche joueur → « 🗑 Actions sensibles » (repliée par défaut)**
- Rappel des trois opérations distinctes : « Recommencer un test à zéro » (#75, garde le compte et le login), « Retirer de la bêta » (#80, accès seulement), « Supprimer le compte de test » (nouveau).
- **Marquer comme compte de test** (motif + pseudo exact) / retirer la marque. Seul un compte marqué peut être supprimé.
- **Supprimer le compte de test…** : aperçu d'impact (ce qui est effacé, table par table avec le nombre de lignes ; ce qui est conservé ; rappels : nouvelle invitation peut-être nécessaire, irréversible, différent d'une suppression RGPD), puis confirmation forte : **motif obligatoire + pseudo exact + mot « SUPPRIMER »** (bouton désactivé tant que les trois ne sont pas corrects).

**Serveur (`server/playerAdmin.js`, nouveau)**
- `GET /api/admin/players` (liste paginée, bornes strictes : 10/20/50, page bornée), `POST|DELETE /api/admin/players/:id/test-account`, `GET /api/admin/players/:id/delete-preview` (ne modifie rien), `POST /api/admin/players/:id/delete`, `GET /api/admin/players-deletions`. Toutes protégées par l'authentification admin existante (clé / session admin avec en-tête anti-CSRF `X-Dig-Admin`), journalisées par l'audit admin existant.
- Suppression **refusée** si le compte n'est pas marqué, ou s'il porte une valeur réelle : points de récompense (mouvements, attributions, portefeuille non vide), commandes en boutique de cadeaux, gains de concours, paiements (lot de fragments), récompenses X, classement figé d'une saison clôturée, meneur d'une saison clôturée.
- Dans **une seule transaction** (IMMEDIATE, tout ou rien) : copie des journaux du compte (sécurité, anti-triche, anti-bot, risque, événements du compte, registre/anomalies de gemmes, anomalies de pioche, rattachement à l'invitation) dans une **trace d'audit** `account_deletions` (pseudo, dates, auteur, motif, nombre de lignes par table, empreinte SHA-256 — **ni e-mail ni mot de passe**), effacement de toutes les lignes du joueur, retours bêta rendus anonymes, puis suppression de la ligne `users`. Un événement `admin_account_deleted` est ajouté au journal de sécurité global (sans lien au compte, donc conservé).
- **Anti-rejeu** : le même `requestId` renvoie le même résultat sans rien refaire ; un `requestId` réutilisé pour un autre joueur est refusé.
- Conservés tels quels : journal d'audit des essais #75, historique des liaisons X (anti-abus), journal de la boutique, actualités publiées (le pseudo n'y apparaît plus), retours bêta (anonymes).
- L'identifiant n'est **jamais réutilisé** (AUTOINCREMENT) : le compte recréé a un nouvel ID, sans ancien rang, ressource, fragment ni jeton.
- Le lien d'invitation déjà consommé **reste consommé** (compteur `uses` inchangé) : il faut créer une nouvelle invitation ; aucun lien expiré/révoqué n'est réactivé.

**Sessions et anciens onglets / PWA**
- `authVersionGuard` : une session dont le compte n'existe plus est fermée et marquée ; chaque réponse API porte alors l'en-tête `X-Dig-Account-Deleted: 1` jusqu'à ce que le jeu l'ait pris en compte (`GET /api/me` → `accountDeleted: true`, une seule fois) ou qu'on se reconnecte / réinscrive.
- Jeu (`public/js/main.js`) : à réception de ce signal, la page se déconnecte, **efface la sauvegarde locale de ce compte** et affiche « Ce compte a été supprimé par l'administration… » (FR, EN, NL, ES, IT). Une ancienne page ne peut plus rien enregistrer (401).
- Règle générale ajoutée : une sauvegarde locale qui appartenait à **un autre compte** n'est plus jamais transférée à un compte sans sauvegarde cloud (avant : se connecter / s'inscrire avec un nouveau compte dans un navigateur où un autre compte avait joué copiait sa progression). Une partie d'invité (sans compte) est toujours reprise à l'inscription, comme avant.

Fichiers : `server/playerAdmin.js` (nouveau), `server/index.js`, `server/accountRoutes.js`, `public/admin/index.html`, `public/admin/admin.js`, `public/admin/admin.css`, `public/js/main.js`, `public/js/i18n.js`, `public/js/locales/it.js`, `test/admin-players-90.test.js` (nouveau), `test/e2e/players-90.e2e.js` (nouveau).

### 3. SHA, branche, procédure de test

- Branche : `feature/90-joueurs-liste-suppression-test` ; commit `a695b58` ; **SHA sur `develop` = SHA déployé : `b8d8f77`** (fusion `--no-ff`).
- Tests automatisés : `npm test` (inclut `test/admin-players-90.test.js` : pagination 56 comptes, tri, bornes, recherche sans accents / #ID / jokers, aucun e-mail ; marque, confirmations, anti-rejeu ; parcours HTTP complet invitation → sauvegarde → refus compte avec points → refus compte non marqué → suppression → ancienne session 401 + signal unique → lien consommé refusé → nouvelle invitation → même pseudo et même e-mail acceptés, nouvel ID, aucune sauvegarde ni classement → témoins intacts → trace d'audit sans e-mail).
- Essai navigateur : `PW=… CHROME=… BASE=http://127.0.0.1:3101 ADMIN_SECRET=… node test/e2e/players-90.e2e.js` sur une base de test avec ≥ 55 comptes : liste sans recherche, page 2, fiche puis retour (même page, même tri), recherche « MASSÉ », état vide, 1280/390/320 px sans débordement ; marque, refus avant marque, SUPPRIMER exigé en majuscules, suppression ; page de jeu restée ouverte → déconnectée, revenue à 1 m ; réinscription du même pseudo / e-mail depuis la même page → compte neuf à 1 m. **Réussi.**

### 4. Vérifications, limites, impact sur les données

- Vérifié : tests unitaires et HTTP, essai navigateur complet, suite `npm test` complète (1022/1022 réussis sur le SHA exact `b8d8f77` dans le worktree de release ; un premier passage sur la branche avait vu `antibot.test.js` dépasser 120 s sous charge — relancé seul : 26/26, puis suite complète verte), migration sur une copie de la base de production (voir Déploiement).
- **Migration** : ajout seul de deux tables (`test_accounts`, `account_deletions`) et d'un index ; aucune donnée existante modifiée. Le déploiement ne supprime rien : seule une action explicite de l'admin, sur un compte qu'il a marqué « compte de test », supprime un compte.
- **Aucune suppression en production** n'a été faite par cette session (recette automatique uniquement sur bases de test).
- Limites : pas de rôle « propriétaire/admin » sur les comptes joueurs (l'admin se connecte par clé) ; la protection des comptes réels repose sur la marque explicite + les verrous de valeur réelle. Les listes de testeurs stockées dans les réglages (pioche à charges, signatures d'extensions, événements TEST) peuvent garder l'ID supprimé : il ne correspond plus à rien et n'est jamais réattribué. Une ancienne page **hors ligne** garde sa sauvegarde locale jusqu'à son prochain contact avec le serveur (elle est alors effacée).

### 5. Déploiement

- **SHA déployé : `b8d8f77`** (`main` avancé en avance rapide depuis `313f153`, sans `--force`), via `scripts/deploy.sh` de la release.
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261108-235240-pre-deploy-b8d8f77.sqlite`.
- Avant : copie de la base de production démarrée avec ce SHA (port 3122, `NODE_ENV=production`) → `/health` ok, `/api/version` = `1.0.0+b8d8f77`, tables `test_accounts` et `account_deletions` créées, **empreintes identiques** (nombre de lignes + hachage) de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking` ; copie supprimée. Aucune génération IA en cours au moment du redémarrage.
- Après : https://dig.lodygames.com et https://dig.lodylands.com → 200, `/api/version` = `1.0.0+b8d8f77` ; `/api/admin/players` sans authentification → 401 ; `journalctl -u dig` sans erreur ; `pragma quick_check` = ok ; empreintes joueurs identiques à la sauvegarde ; `test_accounts` = 0, `account_deletions` = 0 (aucun compte marqué ni supprimé) ; jeu chargé dans Chromium (1280×900 et 390×844) sans erreur JavaScript.
- Retour arrière immédiat possible : `git -C /home/ubuntu/Dig reset --keep 313f153` + `sudo systemctl restart dig` (aucune dépendance changée ; les deux tables ajoutées sont ignorées par l'ancienne version).

**Test fonctionnel à faire par le propriétaire (en deux temps, ≈ 5 min)**

1. *Navigation (sans risque)* — /admin/ (Ctrl+F5) → Joueurs & testeurs → **Joueurs** : la liste s'affiche tout de suite (total, 20 par page). Changer le tri (Pseudo), le filtre (Testeurs bêta), la taille (10) ; taper une partie d'un pseudo → « Rechercher » ; cliquer un pseudo → la fiche s'ouvre ; « Fermer » → retour à la même page. Sur smartphone : cartes lisibles, pas de défilement horizontal.
2. *Suppression (uniquement sur un compte de test choisi par vous)* — Bêta fermée → créer une invitation → s'inscrire avec un pseudo de test (ex. `essai90`) et une adresse de test dans une fenêtre privée, jouer 1 minute. Admin → Joueurs → `essai90` → 🗑 Actions sensibles → « Marquer comme compte de test » (motif + pseudo) → « Supprimer le compte de test… » → lire l'aperçu → motif + `essai90` + `SUPPRIMER` → « Supprimer définitivement ». Attendu : message « Compte « essai90 » … supprimé » ; la fenêtre de jeu affiche « Ce compte a été supprimé… » et revient à 1 m. Créer une **nouvelle** invitation et refaire l'inscription avec le même pseudo et la même adresse → compte neuf (1 m, 0 pièce, absent du classement).

### 6. Choix techniques faits seul

- **Vraie suppression** de la ligne `users` (plutôt qu'un compte « désactivé » renommé) : c'est la seule façon de libérer pseudo **et** e-mail sans laisser un compte fantôme dans les classements et listes ; les journaux sont gardés par copie dans `account_deletions`.
- **Marque « compte de test » préalable** et verrous de valeur réelle plutôt qu'une liste de pseudos : aucun compte réel ne peut être supprimé par erreur, même avec la bonne confirmation.
- Liste des tables effacées **calculée** (toute table avec `user_id`) avec listes explicites « refus » et « conservé » : un futur ticket qui ajoute une table joueur est couvert automatiquement.
- Signal client par en-tête HTTP plutôt qu'un nouveau point d'API : toutes les routes existantes (sauvegarde, signal de jeu, etc.) le portent sans modification.
- « Dernière activité » = max(dernière sauvegarde, dernier signal de la page de jeu) : seules traces d'activité réellement enregistrées (aucune mesure de connexion n'existe).

### 7. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire.

### 8. Reste à faire

- (Après lancement) Purge automatique des traces `account_deletions` après une durée de rétention à définir avec la politique de confidentialité, et procédure distincte de suppression RGPD à la demande d'un joueur réel (hors périmètre : ici, comptes de test seulement).
