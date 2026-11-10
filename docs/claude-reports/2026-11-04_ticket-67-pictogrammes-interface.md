# Ticket #67 — Atelier d'icônes : appliquer les pictogrammes d'interface validés dans le jeu

Lien : https://github.com/ReC82/Dig/issues/67 — branche `feature/67-pictos-ui`

## Session du 10/11/2026 — recette #67-B : inventaire et raccordement des pictogrammes de l'interface

### 1. État réel

**Déployé en production (SHA `ab547b2`) — en attente de recette.** Aucune nouvelle image n'a été
appliquée par cette session, et aucun appel IA n'a été fait. Ce qui change dès le déploiement :
- les deux petits pictogrammes sont retirés (FRAGS et « Blocs manuels ») ;
- les images **que vous aviez déjà appliquées** apparaissent aussi aux emplacements de **même rôle** :
  - onglets → titres des vues Améliorations, Collection, Quotidien et Boutique ;
  - Pièces → guide des boutiques, récompense quotidienne, explications de la saison ;
  - Gemmes → titre « Gemmes », guide, récompense quotidienne ;
  - Boost → titre « Boosts », carte boost, récompense quotidienne ;
  - Saison → 🏆 des explications.

  « Revenir au pictogramme d'origine » sur la fiche concernée retire l'image partout à la fois.

Les 23 nouvelles cibles gardent leur emoji tant que vous ne cliquez pas sur « Appliquer ».

Source : commentaire du propriétaire du 10/11 (recette #67-B). La prévisualisation de la médaille du
rang 1 est validée et ne sera pas redemandée. Le propriétaire demande l'inventaire complet des icônes,
les cibles manquantes et deux retraits.

### 2. Résultat visible

**Retraits demandés (actifs dès le déploiement)**
- Barre du haut : la carte **FRAGS** n'a plus le petit 🔮 devant son libellé. Elle est alignée sur
  Pièces, Gemmes, Prof., Pioche et Dégâts, et garde sa valeur. Corrigé en FR, EN, NL, ES et IT.
- Classement saisonnier : l'en-tête **« Blocs manuels »** est maintenant en texte seul, sans
  pictogramme, comme les colonnes voisines. Le texte et la définition « blocs détruits manuellement »
  (#73) sont inchangés.
  - La cible `ui:blocs_mines` passe en « stockage seul ». Son identifiant et ses images sont
    conservés, mais elle n'est plus servie au jeu.
  - L'image qui était appliquée en production disparaît donc de l'en-tête dès le déploiement.

**23 nouvelles cibles dans Admin → 🎨 Icônes** (registre `server/uiIcons.js`, cinq nouvelles zones) :

| Zone | Cible | Emplacement(s) en jeu |
|---|---|---|
| Icônes système | `aide` | bouton « ? » rond en haut à gauche (aide générale) |
| Icônes système | `aide_contextuelle` | **tous** les petits « ? » à côté des titres (une seule image) |
| Icônes système | `info` | ℹ️ « Comment fonctionne la saison ? », ℹ️ « Récompenses et chances », ℹ️ « Comment fonctionnent les récompenses ? » (une seule image) |
| Minage | `doubler` | 📺 du bouton « Doubler la récompense » |
| Saison | `saison_theme` | grand pictogramme de la carte « Thème de la semaine » (🏮 lanterne actuellement) |
| Saison | `saison_resultat` | 🏁 « Résultat — Saison … » |
| Saison | `points_recompense` | 🏅 « Points de récompense », 🏅 « Points de saison » du guide des boutiques, puce des explications |
| Saison | `cadeaux_boutique` | 🎁 « Boutique de cadeaux » et 🎁 « Cadeaux » du guide |
| Boutique | `coffres` | 📦 « Coffres de saison » (Améliorations) et 📦 « Coffres » du guide |
| Boutique | `argent_reel` | 💶 « Argent réel » du guide |
| Boutique | `pack_gems_5`, `pack_gems_20`, `pack_gems_60` | cartes des trois packs de gemmes |
| Boutique | `pioche_entretien` | titre ⛏ « Pioche et entretien » |
| Boutique | `pioche_reserve`, `pioche_vitesse` | cartes 🔋 « Capacité de réserve » et ⏱ « Vitesse de recharge » |
| Boutique | `pioche_recharge` | cartes ⚡ « Recharge immédiate +10/+25/+50 % » (une seule image) |
| Boutique | `fragments` | 🔮 lot de fragments (#85, caché tant que l'offre est fermée), coût des reliques, puce des explications |
| Titres de sections | `objectifs`, `missions_jour`, `reliques`, `badges`, `evenements` | 🎯 Objectifs, 🎯 Missions du jour, ✨ Reliques, 🏅 Badges et succès, 🎉 Événements |

**Cibles existantes réutilisées par rôle, plutôt que des doublons**
- `boutique` : titre 🛒 Boutique.
- `gemmes` : titre 💎 Gemmes, guide, récompense quotidienne.
- `boost` : titre ⚡ Boosts, carte boost, récompense quotidienne.
- `pieces` : guide, récompense quotidienne, explications de la saison.
- `quotidien` : titre 📅 Quotidien.
- `ameliorations` : titre ⚙ Améliorations.
- `collection` : titre 📦 Collection.
- `saison` : 🏆 des explications.
- `reliques` : ✨ des explications.

**Boutons d'aide et d'information**
- Seule l'apparence change : même `<button>`, même `aria-label`, même zone tactile (28×28 px pour les
  « ? » contextuels, ≥ 40 px pour l'aide générale), même ouverture au clic et au clavier.
- Les icônes système sont personnalisées **par rôle** : une image pour tous les « ? » contextuels,
  une pour l'aide générale et une pour tous les ℹ️.

### 3. Inventaire de l'interface (audit réel, Chromium)

**Méthode** : parcours `test/e2e/ui-icons-67b.e2e.js`.
1. Une même image est appliquée à **toutes** les cibles, sur un serveur de test.
2. Les 8 vues joueur et l'en-tête/barre du bas sont parcourus, en PC 1280 px et en 390 px.
3. Tout emoji encore visible correspond à un emplacement **non raccordé**.

**Résultat (joueur non connecté)** : 115 emplacements affichent l'image de l'Atelier. **22**
emplacements restent en emoji, chacun pour une raison précise :

| Vue | Emplacement | Pourquoi pas ici |
|---|---|---|
| Améliorations | icônes des 3 coffres (📦 💎 🏺) | Déjà gérées par l'Atelier « coffres » (#66, cibles `chest:`) : elles s'affichent en jeu dès qu'un visuel de coffre est appliqué. |
| Collection | icônes des reliques (👁 💛 🧲 🔭 🖤 ⚗️) | Images de reliques = cibles `relic:` de #64 ; leur affichage en jeu relève de #64. |
| Collection | 📦 titre d'une série de collection | Icône propre à chaque série du catalogue #39 (dynamique). |
| Collection | 🔮 au milieu de « 0 / 6 débloquées — 🔮 0 fragments » | Emoji au milieu d'une phrase traduite, pas en tête : non remplaçable sans réécrire les traductions. |
| Quotidien | emblèmes des missions (⛏ 💰 📦) | Emblèmes `mission:` du catalogue #68, servis au jeu à l'activation du catalogue (décision en attente). |
| Boutique | « 5 💎 » dans le bouton d'achat de la pioche | Emoji en fin de libellé de bouton, même raison que ci-dessus. |
| Minage | ⛏ « Réserve pleine : … » (pioche à charges) | Texte d'état rafraîchi en continu ; aucun rôle distinct de `pioche_entretien`. Proposé après lancement. |
| Saison (explications) | 🔄 / ✅ titres de colonnes, ⛏ profondeur, ⬆ améliorations, 🎁 bonus, 🏆 « Comment est établi le classement ? » | Rôles ambigus (⛏ = pioche ou profondeur, 🎁 = cadeau ou bonus) : pas de doublon créé sans décision. Les autres puces (💰 ⚡ 🏆 💎 🔮 ✨ 🏅) sont raccordées. |

**Non parcouru automatiquement** : fenêtres (aide, actualités, ouverture de coffre, récompenses hors
ligne), notifications et vues d'un joueur connecté avec un classement rempli. Le code de l'en-tête du
classement est contrôlé directement, à partir d'une ligne de classement réelle.

### 4. SHA et procédure de test

- Branche `feature/67-pictos-ui`, SHA sur `develop` : `ab547b2`.
- Tests automatisés :
  - `npm test` ;
  - `test/ui-icons.test.js` (15 tests, dont 3 nouveaux pour #67-B) ;
  - e2e `test/e2e/ui-icons-67b.e2e.js` (57 contrôles) ;
  - e2e historique `test/e2e/ui-icons.e2e.js` (44/44).
  - Commandes dans l'en-tête de chaque fichier ; serveur de test uniquement.

### 5. Vérifications

- e2e #67-B, 57/57, en PC 1280×900, 390×844 et 320×640 :
  - toutes les cibles appliquées s'affichent ;
  - aide générale et « ? » contextuels : aria-label conservé, 28×28 px, ouverture au clic et au
    clavier ;
  - libellés de la barre du haut sans pictogramme (FRAGS = « Frags », valeur conservée) ;
  - en-tête « Blocs manuels » sans image ;
  - changement de langue FR → EN : les titres restent décorés ;
  - aucun débordement horizontal sur les 8 vues ;
  - retour arrière de `info` : ℹ️ réaffiché ;
  - aucune erreur console.
- e2e historique #67 : 44/44. Le compteur de SVG de l'en-tête passe à 4, puisque l'aide est
  désormais raccordée.
- Aucun appel IA, aucune dépense.
- Aucune migration de base : le registre est un fichier de code, et l'historique reste dans la table
  existante `icon_studio_events`.
- Aucune donnée joueur touchée. Les images déjà proposées, leurs identifiants et les filtres #89 sont
  inchangés.

### 6. Déploiement

- SHA déployé : **`ab547b2`**. Précédent : `11b00c0`. `npm ci` non nécessaire, lock inchangé.
- Release `ab547b2` : `npm test` 1049/1049.
- Copie de la base de production démarrée sur le port 3122 :
  - `/health` ok, `/api/version` = `1.0.0+ab547b2` ;
  - empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et
    `player_click_tracking` identiques avant et après démarrage ;
  - copie supprimée.
- Aucune génération IA en cours : dernier appel de l'Atelier à 10:49 UTC, déploiement à 12:13 UTC.
- `scripts/deploy.sh` : sauvegarde vérifiée
  `~/backups/dig/dig-20261110-131342-pre-deploy-ab547b2.sqlite`, santé et version OK.
- Après déploiement :
  - dig.lodygames.com et dig.lodylands.com répondent 200, version `1.0.0+ab547b2` ;
  - `journalctl` sans erreur, `pragma quick_check` = ok ;
  - empreintes joueurs identiques à la sauvegarde ;
  - `/api/ui-icons` ne sert plus `blocs_mines`.
- Chromium en production, 1280×900 et 390×844 :
  - libellés `Pièces | Gemmes | Prof. | Pioche | Dégâts | Frags` ;
  - en-tête « Blocs manuels » sans image ;
  - aucun débordement sur 6 vues ;
  - toutes les images chargées ;
  - seule erreur console : un 401 attendu (visiteur non connecté).
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 11b00c0 && sudo systemctl restart dig`. Aucune
  migration à défaire.

**Test fonctionnel à faire par le propriétaire (court, aucune génération IA nécessaire)**
1. **Retraits** : ouvrez le jeu sur téléphone. La carte **FRAGS** de la barre du haut n'a plus de
   petit pictogramme. Onglet **Saison** : l'en-tête de colonne **« Blocs manuels »** du classement
   est en texte seul.
2. **Nouvelle cible n° 1, aide** : Admin → 🎨 Icônes → zone **« Icônes système »** → fiche **« Aide
   contextuelle (petits ? …) »**.
   - Téléversez une image, ou réutilisez une image existante (section « Réutiliser l'image d'un autre
     pictogramme »), puis faites « Prévisualiser dans le jeu ».
   - Attendu : tous les petits « ? » (Améliorations, Collection, Saison…) montrent l'image et ouvrent
     toujours leur bulle d'aide.
3. **Nouvelle cible n° 2, saison** : zone **« Saison »** → fiche **« Résultat — Saison précédente »**
   (🏁). Même manipulation.
   - Attendu : dans Saison, le titre repliable « Résultat — Saison … » commence par l'image.
4. Si vous appliquez l'une de ces cibles : « Revenir au pictogramme d'origine » rétablit l'emoji
   après rechargement.

**Classement MVP** : **Après lancement.** Ce sont des personnalisations visuelles ; les deux retraits
sont de la cohérence cosmétique.

### 7. Choix techniques faits seul

- **Un mécanisme générique « pictogramme de tête »** : `UiIcons.lead(id, libellé)` pour les vues
  dynamiques, et `data-ui-lead` pour les titres statiques, re-décorés après chaque traduction. Il
  évite de réécrire les traductions des 5 langues.
  - Sans image appliquée, le libellé est **strictement identique** : aucun élément n'est ajouté au
    HTML.
- **Un rôle = une cible** : les « ? » contextuels, les ℹ️ et les recharges +10/+25/+50 % partagent
  chacun une seule image. Les cibles existantes (pièces, gemmes, boost…) sont réutilisées dès que le
  sens est le même.
- **Thème de la semaine** : l'emoji change chaque semaine. Une image appliquée à `saison_theme`
  remplace donc l'icône de **chaque** thème. La consigne IA par défaut décrit un emblème neutre (fanion
  et étoile), jamais une lanterne. Une image propre à chaque thème est proposée en question 1.
- **`blocs_mines` passe en stockage seul** plutôt que d'être supprimé : identifiants et images stables
  (règle du registre).
- Bouton « Doubler » : son pictogramme était réécrit par l'état du bouton (📺 / ✅ / ⏳). L'image ne
  remplace donc que l'état « disponible ».

### 8. Décisions demandées au propriétaire

1. **Thème de la semaine** : (a) une image commune à tous les thèmes (livré, cible `saison_theme`) ;
   (b) une image par thème, rattachée aux packs de saison (#48). **Recommandation : (a) pour
   l'instant, (b) après lancement.**
2. Les questions précédentes restent ouvertes :
   - emblèmes des missions du jour (#68) : recommandation, attendre l'étape B ;
   - facteurs de récompense : recommandation, après lancement.

### 9. Restant à réaliser

- Puces ambiguës des explications de la saison (⛏ ⬆ 🎁 🔄 ✅), texte d'état de la pioche à charges et
  emoji placés au milieu d'une phrase : sur décision, après lancement.
- Reliques (#64), missions (#68), séries de collection (#39) : dans leurs tickets respectifs.
- Inventaire des fenêtres et des notifications : non parcouru automatiquement (voir § 3).

## Session du 04/11/2026 (soir)

### 1. État réel

**Déployé en production (SHA `ef22f67`) — en attente de recette.** Rien n'a été appliqué : le jeu affiche toujours les pictogrammes d'origine tant que le propriétaire ne clique pas sur « Appliquer ».

La session précédente s'était arrêtée brutalement avant de rien committer. Son travail, resté dans le
worktree, a été récupéré, mis à jour avec `develop` (conflits avec #68 résolus), terminé et testé.

### 2. Résultat visible

**Dans le panel (Admin → 🎨 Icônes)**
- Nouveau filtre **« Zone de l'interface »** (Navigation du bas, En-tête, Monnaies et récompenses,
  Classement, Améliorations, Objectifs). Le filtre « État » distingue maintenant « À créer (jamais
  générée) », « Propositions à examiner » et « En jeu (appliquée) ».
- Chaque fiche de pictogramme indique **son emplacement exact dans le jeu**, par exemple « onglet
  « Collection » de la barre du bas ». L'ancienne phrase renvoyant à #41 a disparu.
- Sur une proposition sélectionnée :
  - **aperçu avant/après** en taille réelle, sur ordinateur et sur smartphone (390 px) ;
  - lien **« Prévisualiser dans le jeu »** (`/?uiicon=collection:<image>`) : il n'affiche l'image que
    dans votre onglet, n'applique rien et n'est pas mémorisé ;
  - bouton **« Appliquer cette image dans le jeu… »**, distinct de « ↻ Refaire ». Il ne lance aucun
    appel IA. Il demande une confirmation qui rappelle l'emplacement, que tous les joueurs verront
    l'image, et comment revenir en arrière ;
  - après application : **« Revenir à l'icône précédente »** et **« Revenir au pictogramme
    d'origine »** (emoji ou dessin d'origine). L'historique de la fiche enregistre chaque application
    et chaque retour.
- Section **« Réutiliser l'image d'un autre pictogramme »** : une image déjà créée pour un autre
  pictogramme peut servir ici sans nouvelle génération.
- **Logo** : la fiche indique « Stockage seulement ». Une image du logo n'est jamais appliquée (le
  logo « Lingot » choisi avec #41 reste en place).
- **Aucune image n'est jamais appliquée automatiquement.** Générer, téléverser ou conserver une image
  ne change rien en jeu. Seul « Appliquer » avec confirmation change ce que voient les joueurs.

**Dans le jeu** — 28 pictogrammes raccordés, chacun avec un identifiant stable :

| Zone | Pictogrammes |
|---|---|
| Navigation du bas | Dig, Améliorations, **Collection**, Quotidien, Boutique, Saison |
| En-tête | Profil, Paramètres, Actualités (cloche) — *Logo : stockage seulement* |
| Monnaies et récompenses | Pièces (récompense du bloc, coûts, coffres, missions, objectifs, connexion), Gemmes, Boost, Cadeau (7e jour) |
| Classement | Médailles or / argent / bronze (classement et podium de la saison passée), blocs minés à la main |
| Améliorations | Pioche, Chance, Sac, Auto-Dig, Fragments, Reroll bloc |
| Objectifs | les 5 objectifs de l'onglet Améliorations |

- Le jeu lit la liste à chaque chargement (`GET /api/ui-icons`, jamais mis en cache). Les images
  elles-mêmes ne changent jamais d'adresse. Un retour arrière s'applique donc au rechargement suivant,
  y compris en PWA : le service worker ne met pas `/api/` en cache.
- **Repli permanent** : si le serveur ne répond pas, si l'appareil est hors ligne ou si une image ne
  se charge pas, le jeu affiche l'emoji ou le dessin d'origine.
- Le logo, les images des blocs, des objets, des reliques, des badges et des souvenirs ne sont pas
  touchés par ce mécanisme.

**Missions du jour (séparation avec #68)** : leurs emblèmes existent déjà dans l'Atelier, sous la
famille « Missions quotidiennes » (`mission:<id>`, #68). Je n'ai **pas** créé de deuxième cible en
double. Le jeu est prêt à afficher l'emblème **publié** de chaque mission, mais seulement quand le
catalogue #68 sera actif en jeu (`missionCatalog.isLive()`, aujourd'hui toujours faux). Le panel #68
annonce en effet « le jeu n'utilise pas encore ce catalogue : rien ne change pour les joueurs ».
Aujourd'hui, les montants de récompense des cartes de mission utilisent déjà le pictogramme
« Pièces » / « Gemmes ».

**Prompt** : la génération d'un pictogramme transmet maintenant à l'IA le nom exact et le contexte de
navigation. Exemple : `Interface pictogram to depict: "Collection" (French label: "Collection"), the
"Collection" tab button of the bottom navigation bar…` (prompt `ui-v1.2`). La proposition « coffre »
du 04/11 est conservée telle quelle, marquée « ancienne version du prompt ». Vous pouvez la valider,
la rejeter ou la refaire.

**Fichiers** : `server/uiIcons.js` (registre, nouveau), `public/js/uiIcons.js` (affichage en jeu,
nouveau), `server/iconStudio.js`, `server/index.js` (`GET /api/ui-icons`), `public/index.html`,
`public/js/main.js`, `public/css/style.css`, `public/admin/admin.js`, `public/admin/index.html`, tests
`test/ui-icons.test.js`, `test/e2e/ui-icons.e2e.js`, `test/season-view.test.js`,
`test/icon-studio.test.js`.

### 3. Inventaire des pictogrammes encore non raccordés (audit du code)

| Emplacement | Source actuelle | Raison / suite proposée | Classement |
|---|---|---|---|
| Icônes des ligues (classement, badge de ligue) | emoji saisi dans l'admin des ligues (table `leagues`) | dépend de #19 (ligues, en attente) ; cibles dynamiques `ligue_<id>` à ajouter avec #19 | Après lancement |
| Emoji dans les textes traduits (« 🎯 Objectifs », « ✨ Reliques », « 🏅 Badges », légendes de la Saison) | i18n (FR/EN/NL/ES) | font partie des textes : il faudrait les sortir des traductions | Après lancement |
| Facteurs de la récompense du bloc (🎒 💛 ✨ ⚡), aperçu du contenu des coffres | emoji dans `main.js` | peuvent réutiliser Sac / Boost ; à ajouter si vous le souhaitez | Après lancement |
| Messages éphémères (« 💰 50 reçus ») | texte brut | volontairement en texte | Après lancement |
| Coffres (boutique et minage) | — | ticket #66 | — |
| Reliques, souvenirs, badges, objets | atelier, familles dédiées | #64, #65, #38, #39 (déjà applicables) | — |
| Signaler un bug (bandeau bêta) | bouton texte, sans pictogramme | rien à raccorder | — |

### 4. SHA et procédure de test

- Branche `feature/67-pictos-ui` : `037ac09` (reprise du travail interrompu), `1aef579` (fonction), `eae6187` (correctif de test).
- **develop : `ef22f67`** (merge `--no-ff`).
- Tests locaux, sans la production :
  ```
  npm test                                   # suite complète
  DB_FILE=test-67.sqlite DIG_AI_FAKE=1 ADMIN_SECRET=<secret> PORT=3101 node server/index.js
  DIG_E2E_BASE=http://127.0.0.1:3101 ADMIN=<secret> NODE_PATH=<playwright-core> node test/e2e/ui-icons.e2e.js
  ```

### 5. Vérifications

- **`npm test` complet : 676/676 réussis sur la branche, sur `develop` et sur le SHA de release `ef22f67` (aucun nouveau passage nécessaire).**
- `test/ui-icons.test.js` (9 tests) :
  - registre : identifiants uniques et historiques conservés ;
  - **aucune cible orpheline** : chaque pictogramme déployable est lu par le jeu au bon endroit ;
  - Collection = onglet de navigation ;
  - application refusée sans confirmation « live » ;
  - retour arrière et historique ; journal en ajout seul ;
  - réutilisation sans génération, image d'une autre famille refusée ;
  - logo non applicable ;
  - prompt avec nom et contexte ;
  - missions servies seulement si #68 est actif.
- **Parcours Chromium e2e : 44/44** sur le serveur de test (ordinateur 1280×900 et smartphone
  390×844) :
  - panel : filtre de zone, fiche Collection, aperçu, « Appliquer » ; Annuler n'applique rien,
    Confirmer applique ;
  - jeu : onglet Collection en image, autres onglets inchangés, logo et en-tête inchangés ; pièces
    sous le bloc et dans les coûts, carte Pioche ; missions avec leur emoji d'origine ;
  - aperçu `?uiicon=` non appliqué et non mémorisé ; image introuvable remplacée par l'emoji ;
  - retour au pictogramme d'origine, constaté dans le jeu ;
  - aucune erreur console, pas de débordement horizontal.
- Aucun appel IA payant (téléversements de test et IA factice).
- **Données des joueurs** : aucune migration. L'état « appliqué » est dérivé du journal existant
  `icon_studio_events` (ajout seul). Aucune table, aucune colonne et aucune sauvegarde de joueur ne
  sont modifiées.

### 6. Déploiement

- SHA déployé : **`ef22f67`** (avant : `6a359bd`), par l'avance rapide de `main` puis le script
  `scripts/deploy.sh` de la release.
- Sauvegarde vérifiée avant déploiement : `~/backups/dig/dig-20261104-215457-pre-deploy-ef22f67.sqlite`.
- Avant déploiement, sur une copie de la base de production démarrée en mode production (port 3122) :
  - `/health` et `/api/version` OK ;
  - `/api/ui-icons` = `{}` : rien n'est appliqué ;
  - empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et
    `player_click_tracking` identiques avant et après démarrage ;
  - copie supprimée ensuite.
- Après déploiement :
  - dig.lodygames.com et dig.lodylands.com répondent 200, version `1.0.0+ef22f67` ;
  - `/api/ui-icons` = `{}` ;
  - `journalctl` sans erreur, `pragma quick_check` = ok ;
  - empreintes joueurs identiques à la sauvegarde avant déploiement ;
  - Chromium en production (1280×900 et 390×844) : pictogrammes d'origine, aucune erreur console.
- Aucune génération IA n'était en cours (dernier appel à 15:36 UTC).
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 6a359bd && sudo systemctl restart dig`. Le
  fichier `package-lock.json` est identique, et aucune migration n'est à défaire.

**Test fonctionnel à faire par le propriétaire (aucune génération IA nécessaire)**
1. Admin → 🎨 Icônes → Zone « Navigation du bas » → fiche **Collection**. Attendu : l'emplacement
   « onglet « Collection » de la barre du bas » est indiqué, et aucune mention de #41.
2. Sélectionnez la proposition « coffre » du 04/11. Attendu : l'aperçu avant/après PC et
   smartphone s'affiche, ainsi que les boutons « Prévisualiser dans le jeu » et « Appliquer cette
   image dans le jeu… ».
3. Facultatif : « Prévisualiser dans le jeu ». Seul votre onglet montre le coffre dans la barre du
   bas ; un rechargement normal le retire.
4. Quand vous le décidez : « Appliquer… », puis Confirmer. Rechargez le jeu (PC et téléphone) : seul
   l'onglet Collection change.
5. Retour arrière : dans la même fiche, « Revenir au pictogramme d'origine ». Après rechargement,
   📦 revient.
6. Autres cibles : zone « Classement » → Médaille d'or ; zone « Monnaies » → Pièces. Même parcours,
   en téléversant une image ou en en réutilisant une.

Rien n'a été appliqué en production par cette session : le jeu affiche les mêmes pictogrammes
qu'avant tant que vous ne cliquez pas sur « Appliquer ».

**Classement MVP** : **Après lancement.** C'est du confort visuel ; le jeu reste identique sans
action de votre part.

### 7. Choix techniques faits seul

- **Pas de nouvelle table** : l'image en jeu est le dernier événement « applied / reverted_to_emoji »
  du journal `icon_studio_events`, qui est en ajout seul. On obtient ainsi l'historique et le retour
  arrière gratuitement, sans migration.
- **Application immédiate (pas de brouillon)** pour les pictogrammes d'interface, avec une
  confirmation explicite obligatoire, sur le modèle des badges actifs (#38).
- **Pas de cible `ui:mission_*`** : ce serait un doublon des emblèmes `mission:<id>` de #68. Le
  raccordement en jeu attend l'activation du catalogue #68.
- Les identifiants historiques (`profil`, `parametres`, `collection`, …) sont conservés : l'image
  « coffre » déjà générée reste rattachée à Collection.
- Le paramètre `?v=` ajouté par le serveur au logo a été pris en compte dans le test e2e. Ce n'était
  pas une modification du logo.

### 8. Décisions demandées au propriétaire

1. **Emblèmes des missions du jour** : faut-il les afficher en jeu dès leur publication dans
   🎯 Missions (#68), avant l'activation complète du catalogue ? Options : (a) attendre l'étape B de
   #68 (actuel) ; (b) les afficher dès la publication. **Recommandation : (a)**, pour respecter
   l'annonce « rien ne change pour les joueurs » du panel #68.
2. Faut-il des pictogrammes pour les **facteurs de récompense** (🎒 💛 ✨ ⚡) et les **titres de
   section** (🎯 ✨ 🏅) ? Recommandation : après lancement.

### 9. Restant à réaliser

- Icônes des ligues : avec #19.
- Titres de section et facteurs de récompense : sur décision 2.
- Lien direct vers l'Atelier depuis les modules Missions et Améliorations (#68, #69) : proposé, non
  fait dans ce ticket.
