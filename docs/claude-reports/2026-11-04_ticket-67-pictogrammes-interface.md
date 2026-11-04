# Ticket #67 — Atelier d'icônes : appliquer les pictogrammes d'interface validés dans le jeu

Lien : https://github.com/ReC82/Dig/issues/67 — branche `feature/67-pictos-ui`

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
