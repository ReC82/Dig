# Ticket #76 — [P1][UX] Simplifier les fiches et fenêtres de l'administration

- Ticket : [#76](https://github.com/ReC82/Dig/issues/76). Tickets liés : #70 (navigation admin), #75 (reset d'un joueur de test), #61 (saisies non enregistrées).
- Session : 05/11/2026, branche `feature/76-admin-fiches-compactes`
- **État réel : déployé en production (SHA `922e21d`), en attente de recette du propriétaire** — dernière passe : décisions serveur dépliables par essai (section « Recette 76-A du 05/11 » en bas). Passes précédentes : fiche Anti-bot (`9b0850e`), fiche Joueurs et fenêtres (`121f940`).

## 1. Résultat

Le parcours **Joueurs → fiche → Essais de test → Recommencer un test à zéro** tient désormais sur un écran d'ordinateur.
Toutes les informations et toutes les sécurités sont conservées.

### Fiche joueur (rubrique 👤 Joueurs)

- **Résumé compact en tête**. Il affiche l'essai en cours (n°, depuis combien de temps, nombre d'essais archivés), la profondeur, les pièces, les gemmes, la pioche, l'Auto-Dig, la dernière sauvegarde et la révision.
- **🧪 Essais de test vient en premier, ouvert**. Les boutons **🔄 Recommencer un test à zéro**, Exporter CSV et Exporter JSON complet sont en tête de cette section : ils sont visibles sans défiler, sur ordinateur et sur smartphone.
- Le texte « ce qui est remis à zéro / conservé » est **replié** sous une phrase courte. L'indication de garde active a été placée au même endroit.
- **📈 Progression détaillée** (les 15 valeurs, coffres, format de sauvegarde) est **repliée**. **⚠ Réinitialisation saisonnière partielle** reste repliée, comme avant.
- **Historique des essais** :
  - l'essai en cours est en tête, puis les essais archivés du plus récent au plus ancien ;
  - **5 lignes par page**, avec « ‹ Précédents · 1–5 sur 8 · Suivants › » ;
  - le tableau est resserré pour tenir dans la largeur d'un ordinateur 1280 px. Une période sur une seule journée affiche « jeu. 05/11/2026 14:34 → 14:41 » ; la période complète apparaît en infobulle ;
  - sur smartphone, chaque essai est une **carte « intitulé : valeur »** ;
  - aucune colonne n'a été retirée.

### Fenêtre « Recommencer un test à zéro » / « Restaurer l'essai n° … »

L'ordre devient : titre → résumé (essai archivé, nouvel essai) → **ligne « Change : profondeur 245 → 1 · pièces … »** → **motif** et **pseudo exact** → détails **repliés**. Les détails contiennent le tableau avant / après complet et toute la liste « archivé / conservé ». **Annuler / Confirmer** sont dans un **pied fixe** qui reste visible, même avec les détails dépliés.

**Sécurités inchangées** :
- motif obligatoire ;
- pseudo exact (la casse compte) ;
- révision attendue ;
- identifiant de requête (idempotence) ;
- instantané archivé avant toute écriture ;
- protection #61 « Abandonner les modifications ? » si l'on annule après avoir saisi un motif.

### Recherche joueur

- La recherche reste en haut de la rubrique Joueurs (#70).
- Si « Rechercher » ne trouve **qu'un joueur**, sa fiche s'ouvre directement.
- Le bouton s'appelle « Ouvrir la fiche ».
- Le tableau des résultats est paginé (10 par page) et s'affiche en cartes sur smartphone.

### Toutes les fenêtres de l'admin

Quand une fenêtre se termine par sa rangée de boutons, cette rangée devient un **pied fixe** : les boutons restent visibles pendant le défilement et passent côte à côte sur smartphone (≥ 44 px). C'est le cas de 22 fenêtres, vérifiées une par une : saisons, ligues, article de boutique, ajout de bloc / collection / badge / événement, récompenses, contrôles des améliorations, rotation des missions, etc.

Les fiches qui avaient déjà leur propre pied fixe ne sont pas touchées : Actualités, badges, reliques, améliorations, missions, blocs, événements.

### Fichiers

| Fichier | Changement |
|---|---|
| `public/admin/index.html` | fiche joueur réorganisée, fenêtre `tr-dialog` réordonnée, barres de pagination |
| `public/admin/admin.js` | `admTableLabels` et `admTablePage` (communs), `pdSummary`, ordre et pagination des essais, résumé des changements, recherche à un seul résultat |
| `public/admin/admin.css` | résumé, cartes `.adm-rtable`, pagination, pied fixe commun, tableau des essais resserré |
| `test/admin-sheets.test.js` | 5 tests unitaires (structure, sécurités, pagination, CSS) |
| `test/e2e/admin-sheets.e2e.js` | essai Chromium PC 1280×900 et smartphone 390×844 |
| `test/e2e/test-runs.e2e.js` | adapté : la fiche s'ouvre directement quand il n'y a qu'un résultat |

Aucune route serveur, aucune migration et aucune donnée ne sont modifiées.

## 2. SHA et procédure de test

- Branche : `feature/76-admin-fiches-compactes` (`d7a232c`). **`develop` : `121f940`**. Déployé : `121f940`.
- `npm test` : **770/770** sur la branche et sur la release `121f940`. `npm run check` OK.
- Essais navigateur sur un serveur de test (port 3101, base temporaire supprimée ensuite) :
  - `admin-sheets.e2e.js` : **TOUT OK** sur PC et sur mobile. Il vérifie :
    - le résumé ;
    - l'ordre des sections et ce qui est replié ;
    - le bouton de reset visible sans défiler ;
    - la pagination 1–5 / 6–8 et l'absence de défilement horizontal ;
    - les cartes sur mobile ;
    - le formulaire placé avant les détails, avec les 9 lignes avant / après et les 10 points d'impact présents ;
    - le pied visible, y compris détails dépliés ;
    - le pseudo exact exigé ;
    - la confirmation #61 ;
    - l'aperçu de restauration ;
    - **aucune requête d'écriture** ;
    - aucune erreur JS.
  - `test-runs.e2e.js` (#75, vrai reset d'un joueur **de la base de test**) : PC OK, mobile OK.
  - `admin-nav.e2e.js` (#70) : TOUT OK. `admin-layout.e2e.js` : aucun débordement.
  - Le pied fixe a été contrôlé sur les 30 fenêtres : les 22 concernées ont leurs boutons visibles avec un contenu long simulé, sur PC et sur mobile.
- Non lancé : `admin-unsaved.e2e.js` (#61). Il dépend d'une série de collection pré-remplie (`saint_martin`) absente d'une base neuve. Les comportements #61 de la fenêtre de reset sont couverts par `admin-sheets.e2e.js`.

## 3. Déploiement

- Copie de la base de production : démarrage OK (`1.0.0+121f940`). Les empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` sont **identiques** avant et après. La copie a été supprimée.
- Avant de déployer : aucune génération IA en cours (dernier appel à 11:53 UTC).
- `scripts/deploy.sh` (release) :
  - sauvegarde vérifiée `dig-20261105-150008-pre-deploy-121f940.sqlite` ;
  - `d89f089 → 121f940` ;
  - santé et version OK.
- Après le déploiement :
  - les 2 domaines répondent 200 en `1.0.0+121f940`, et `/admin/` répond 200 ;
  - le journal ne contient aucune erreur ;
  - `quick_check` = ok ;
  - empreintes joueurs **identiques** à la sauvegarde pré-déploiement.
- Aucun essai navigateur n'a été fait en production : la session admin exige la clé, qui n'est pas lue.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep d89f089` + `sudo systemctl restart dig` (pas de `npm ci` : lock inchangé).
- **Aucun reset réel** n'a été fait en production.

## 4. Test fonctionnel à faire par le propriétaire (3 min, PC puis smartphone)

1. Recharger l'admin (F5) → 👤 Joueurs. Taper le pseudo complet d'un joueur de test, puis « Rechercher ». **Attendu** : la fiche s'ouvre directement (un seul résultat).
2. **Attendu** dans la fiche :
   - une ligne de pastilles (essai n° … en cours, profondeur, pièces, gemmes, pioche, Auto-Dig, sauvegarde, révision) ;
   - juste dessous, 🧪 Essais de test avec **🔄 Recommencer un test à zéro** visible sans défiler ;
   - la progression détaillée et la réinitialisation partielle repliées.
3. Avec plus de 5 essais : « Suivants › » affiche les plus anciens. Sur smartphone, chaque essai est une carte lisible.
4. Cliquer **Recommencer un test à zéro** sans confirmer. **Attendu** :
   - résumé et ligne « Change : … » ;
   - motif et pseudo tout de suite ;
   - « Détails : 9 valeurs avant / après… » replié ;
   - Annuler / Confirmer toujours visibles en bas ;
   - Confirmer inactif tant que le motif et le pseudo exact manquent.

   Annuler (« Abandonner les modifications » si un motif a été saisi).
5. Facultatif : ouvrir une autre fenêtre longue, par exemple Boutique de cadeaux → un article, sur smartphone. **Attendu** : les boutons restent en bas pendant le défilement.

Classement : **Après lancement** (confort d'administration, aucun effet pour les joueurs).

## 5. Choix techniques faits seul

- **Pas de déplacement du bouton de reset dans l'en-tête de la fiche**. La section Essais passe en tête et la progression détaillée est repliée, ce qui suffit à rendre le bouton visible sans défiler. Les liens et actions de #70 (`#a/reset-test` → section Essais) restent valables sans modification.
- **Pagination côté navigateur** en masquant les lignes : rien n'est retiré du DOM, et les exports restent complets. Le serveur renvoie déjà tous les essais d'un joueur, au plus quelques dizaines.
- **Pied fixe en CSS commun** (`.bk-dialog > .form-actions` en fin de fenêtre) plutôt que de reprendre chaque fenêtre. Les fiches `.nw-dialog` et `.bk-sheet-actions`, qui ont déjà leur propre pied, sont exclues.
- **Bêta fermée (fenêtre d'invitation) non modifiée** : #72 et #80 la traitent. Cela évite un travail concurrent.
- **Fiche anti-bot** non modifiée : elle est déjà « résumé d'abord, sections repliées » depuis la recette UX du 05/11.

## 6. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire.

## 7. Reste à faire

- Rien dans le périmètre testé. Si la recette demande d'autres fenêtres précises à resserrer, elles seront traitées dans ce ticket.
- Suggestion (non faite) : rendre `admin-unsaved.e2e.js` autonome (création de sa série de test) pour qu'il passe sur une base neuve.


---

## Retour du 05/11 — fiche Anti-bot : vue essentielle et diagnostic avancé (session de 15 h)

**État réel : déployé en production (SHA `9b0850e`) — en attente de recette.**
Classement : **Après lancement** (outil d'administration ; il ne bloque pas le MVP public).

### Demande du propriétaire

[Commentaire du 05/11](https://github.com/ReC82/Dig/issues/76#issuecomment-6659309857) : la fiche Anti-bot restait difficile à exploiter malgré ses 11 sections repliables. Pour voir la profondeur couverte aux PV réels (#77), il fallait ouvrir « Progression de la saison (détail) ».

Le propriétaire demandait :
- un résumé lisible tout de suite ;
- deux vues séparées, « Vue essentielle » et « Diagnostic avancé », sans perdre aucune métrique ;
- une explication claire des blocs ni manuels ni Auto-Dig ;
- une fiche utilisable sur mobile et PC, sans fenêtre géante ;
- aucun changement aux calculs anti-bot ni aux données des joueurs.

### Ce qui change (Anti-bot → bouton « Fiche » ou recherche « Ouvrir la fiche »)

- **Deux onglets** en tête de la fiche :
  - **Vue essentielle**, ouverte par défaut ;
  - **Diagnostic avancé — toutes les métriques**.

  L'onglet choisi est conservé au rafraîchissement et au changement de saison.
- **Vue essentielle**, sans rien ouvrir :
  - une phrase de verdict : risque, nombre d'alertes, « aucune sanction appliquée au joueur » ;
  - **4 cartes**. Une carte est bordée d'orange quand elle demande de l'attention, de vert sinon :
    1. **Progression de la saison** : mètres déclarés, profondeur validée (classement) et écart entre les deux.
    2. **PV réels des blocs (#77)** : mètres couverts, écart à la dernière sauvegarde et mode (`shadow` = observation, aucun joueur freiné).
    3. **Classement (👆 blocs manuels)** : blocs validés, déclarés et non retenus, plus les coups de pioche manuels.
    4. **Risque, alertes, sanctions** : niveau et score, alertes par type, « Sanctions : aucune (applied:false) » et coups/s max mesurés à l'horloge du serveur.
  - **« Blocs détruits : d'où viennent-ils ? »** : une barre de couleur et les chiffres de chaque part :
    - manuels de la saison ;
    - Auto-Dig de la saison ;
    - coups jugés suspects de la saison ;
    - reste hors saison ;
    - total de la partie.
  - **L'explication en clair**. Le total des blocs détruits couvre toute la partie et n'est jamais remis à zéro. Les compteurs manuels, Auto-Dig et suspects repartent à 0 à chaque saison. Le reste vient donc surtout des **saisons précédentes**. Avant le correctif #74, il contient aussi les blocs cassés par un coup suspect, qui n'étaient alors comptés nulle part.
  - **Un contrôle de cohérence**. La profondeur repart à 1 m à chaque saison, donc le nombre de mètres atteints doit correspondre aux blocs comptés dans la saison. La fiche affiche « ✓ Tous les blocs de la saison sont attribués » ou « ⚠ N bloc(s) non attribué(s) ».
- **Le cas de la capture LODY, saison 8, vérifié en lecture seule** : 510 blocs au total, 131 manuels, 37 Auto-Dig et 0 suspect, soit 168 blocs pour la saison. C'est exactement 169 m − 1. **Les 342 blocs restants sont ceux des saisons précédentes** (le compte existe depuis juin), pas une anomalie. L'ancien libellé « Blocs ni manuels ni Auto-Dig (clic jugé suspect) » était donc **trompeur** : il est corrigé en « total partie − manuels − Auto-Dig ». La valeur est inchangée.
- **Diagnostic avancé** : les 11 sections d'avant sont identiques, avec toutes les métriques et « Tout déplier / Tout replier ». Une ligne s'ajoute à « Progression de la saison (détail) » : « Blocs coups jugés suspects (saison, depuis #74) ».
- **Smartphone** : les cartes s'affichent 2 par ligne et les deux onglets côte à côte. La vue essentielle tient sur environ un écran et demi, sans débordement horizontal.

### Fichiers

- `public/admin/admin.js` (`secRenderPlayer`) et `public/admin/admin.css` : onglets, cartes, bloc « origine ».
- `server/antibot.js` (`playerReport`) : ajouts en **lecture seule** au contenu de la fiche :
  - `blockOrigin` ;
  - `save.seasonStats.suspiciousBlocks` ;
  - `modes.exactHpMode`.

  **Aucun calcul anti-bot n'est modifié** et `uncountedBlocks` reste inchangé.
- Tests :
  - `test/antibot-player-report.test.js` : 2 tests ajoutés (origine des blocs sur le cas 510 / 131 / 37 / 342 et sur une sauvegarde antérieure à #74 ; onglets et cartes) ;
  - `test/e2e/admin-antibot-sheet.e2e.js` (nouveau).

### SHA et vérifications

- Branche `feature/76-admin-fiches-compactes` : `7f7980d`. `develop` : `9b0850e`, la version déployée.
- `npm test` **772/772** sur la branche, sur `develop` et sur la release `9b0850e`. `npm run check` OK.
- Essais Chromium sur un serveur de **test** (port 3101, base temporaire supprimée ensuite) :
  - `admin-antibot-sheet.e2e.js` : **TOUT OK** sur PC 1280×900 et mobile 390×844. Il vérifie :
    - la vue essentielle par défaut et ses 4 cartes avec leurs valeurs ;
    - l'origine 131 / 37 / 0 / 342 sur 510 et l'explication ;
    - les cartes visibles sans défiler, sans débordement ;
    - le diagnostic avancé avec ses 11 sections repliées et l'onglet conservé au rafraîchissement ;
    - aucune requête d'écriture et aucune erreur JS.
  - Non-régression : `admin-sheets.e2e.js`, `admin-nav.e2e.js` et `admin-layout.e2e.js` tous OK.
- Copie de la base de production démarrée avec la release : empreintes identiques (`users`, `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking`).

### Déploiement

- Sauvegarde vérifiée : `dig-20261105-153111-pre-deploy-9b0850e.sqlite`. `main` a avancé en avance rapide `121f940 → 9b0850e`.
- Contrôles après déploiement :
  - les 2 domaines répondent 200 en `1.0.0+9b0850e` ;
  - le journal est sans erreur ;
  - `quick_check` = ok ;
  - les empreintes des joueurs sont identiques à la sauvegarde ;
  - l'admin sert `admin.js?v=1.0.0+9b0850e`.
- Aucune génération IA n'était en cours. Aucune migration, aucune donnée écrite.
- Retour arrière possible vers `121f940` (aucune migration).

### Test fonctionnel à faire par le propriétaire (2 min, PC puis smartphone)

1. Faire F5 sur l'admin, puis aller dans 🛡 Anti-bot. Ouvrir la fiche de LODY, depuis un tableau (bouton « Fiche ») ou par la recherche.
2. **Attendu** :
   - l'onglet « Vue essentielle » est actif ;
   - les 4 cartes sont visibles sans défiler : progression déclarée / validée, **PV réels couverts + écart**, blocs manuels validés, risque / alertes / sanctions ;
   - en dessous, « Blocs détruits : d'où viennent-ils ? » affiche 131 manuels, 37 Auto-Dig, 0 suspect, **342 hors saison** sur 510, avec l'explication et « ✓ Tous les blocs de la saison sont attribués ». Ces valeurs peuvent avoir augmenté si LODY a joué depuis.
3. Cliquer sur « Diagnostic avancé ». **Attendu** : les 11 sections d'avant, repliées ; « Progression de la saison (détail) » contient toujours toutes les valeurs. Faire ↻ Rafraîchir : on reste sur cet onglet.
4. Sur smartphone, **attendu** : les cartes sont 2 par ligne, les onglets côte à côte, et rien ne déborde sur le côté.

### Choix techniques faits seul

- **Onglets plutôt qu'une deuxième série de sections repliables.** La vue essentielle reste courte et le diagnostic garde sa structure connue, sans doublon visible à l'écran.
- **Origine des blocs calculée par le serveur**, en lecture de la sauvegarde. Le total de la partie vient de `stats.blocksDestroyed`, les parts de la saison de `seasonStats`. Si le compteur de suspects est absent (sauvegarde antérieure à #74), la fiche affiche « non transmis » au lieu de 0.
- **Le seuil du contrôle de cohérence tolère ±1 bloc**, à cause du bloc courant.

### Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire.

### Reste à faire

Rien pour cette demande. Suggestion hors périmètre, non réalisée : afficher la même carte « Blocs détruits : d'où viennent-ils ? » dans la fiche 👤 Joueurs.

## Recette 76-A du 05/11 — décisions serveur dépliables par essai (session de 16 h)

1. **Ticket** : [#76](https://github.com/ReC82/Dig/issues/76). Retour du propriétaire : [commentaire du 05/11 14:21](https://github.com/ReC82/Dig/issues/76#issuecomment-6660341542). Le test 76-A est **validé** ; une remarque UX est non bloquante : la colonne « Décisions serveur » du tableau des essais est trop dense.
2. **État réel : déployé en production (SHA `922e21d`), en attente de recette.**
3. **Changement** (`public/admin/admin.js`, `public/admin/admin.css`, client seulement) :
   - Rubrique 👤 Joueurs → fiche → 🧪 Essais de test → tableau. La colonne « Décisions serveur » est simplifiée.
   - **Plusieurs décisions** : la cellule affiche la plus fréquente et le nombre d'autres, par exemple `depth_capped ×412 +5`. Un clic déplie **la liste complète, une décision par ligne**, triée comme avant. La liste complète est aussi dans l'infobulle.
   - **Une seule décision**, ou « aucune » : texte simple, comme avant.
   - **Aucune information perdue** : mêmes valeurs, même tri. Les décisions `admin_*` sont toujours exclues et l'autoclic toujours inclus.
   - Les exports CSV/JSON ne changent pas.
   - Sur ordinateur, la liste ne coupe pas les noms au milieu. Sur smartphone (cartes), elle passe à la ligne sans déborder.
   - Serveur, calculs et données : **rien n'est modifié**.
4. **SHA** : branche `feature/76-admin-fiches-compactes` `50dce51`, `develop` `922e21d` (code), avec le rapport en commit suivant.
   - Test automatisé ajouté : `test/e2e/admin-tr-decisions.e2e.js`.
   - Il enrichit la réponse des essais dans le navigateur (6 décisions sur l'essai en cours, 1 sur un essai, 0 sur un autre).
   - Il ne fait aucune écriture.
   - Lancement : `PW=… CHROME=… BASE=http://127.0.0.1:3101 ADMIN_SECRET=… node test/e2e/admin-tr-decisions.e2e.js`.
5. **Vérifications** :
   - `npm test` **772/772** sur la branche, `develop` et la release.
   - Un premier passage sur la release a montré 1 échec (`antibot` HTTP, 409). La cause : un serveur de test orphelin de ma propre série de tests occupait le port 3131. Je l'ai arrêté, et la suite complète a été relancée : 772/772.
   - `npm run check` OK.
   - E2E Chromium **TOUT OK**, PC 1280×900 et mobile 390×844 : `admin-tr-decisions` (nouveau), `admin-sheets`, `test-runs`, `admin-nav`, `admin-layout`.
   - Non lancé : `admin-antibot-sheet`. Il demande une base préparée (variable `DB`) et cette partie n'a pas été touchée.
6. **Déploiement** :
   - Aucune génération IA en cours avant le déploiement (dernière activité 11:53 UTC).
   - Copie de la base de production : empreintes identiques après démarrage de la release.
   - `main` avancé en avance rapide `9b0850e → 922e21d`, puis `scripts/deploy.sh`.
   - Sauvegarde vérifiée : `dig-20261105-161907-pre-deploy-922e21d.sqlite`.
   - Les 2 domaines répondent 200 en `1.0.0+922e21d`, et l'admin sert `admin.js?v=1.0.0+922e21d`.
   - Journal sans erreur, `quick_check` ok.
   - Empreintes joueurs identiques à la sauvegarde.
   - Retour arrière possible vers `9b0850e`.
   - **Test à faire par le propriétaire (1 min)** :
     1. F5 sur l'admin, puis 👤 Joueurs → gabpok8.
     2. 🧪 Essais de test → colonne « Décisions serveur ». **Attendu** : une ligne courte « décision ×n +N » en doré.
     3. Cliquer dessus. **Attendu** : la liste complète, une décision par ligne. Un nouveau clic la replie.
     4. Sur smartphone : même chose dans les cartes, sans débordement.
     5. Suite prévue par le propriétaire, inchangée : **test 76-B**. Ouvrir l'aperçu du reset puis **Annuler sans confirmer**.
   - Classement : **Après lancement**.
7. **Choix techniques** :
   - J'ai choisi un `<details>` natif par cellule, sans état mémorisé. Il est accessible au clavier, ne demande aucun JavaScript supplémentaire et reste replié à chaque rafraîchissement.
   - Le résumé montre la décision la plus fréquente, l'information la plus utile d'un coup d'œil.
8. **Décisions demandées au propriétaire** : aucune décision utilisateur nécessaire.
9. **Reste à faire** : recette 76-B (aperçu du reset puis Annuler), puis la recette de cette passe et de la fiche Anti-bot.

