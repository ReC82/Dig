# Ticket #69 — Admin : gérer les améliorations, leurs niveaux/effets, et désactivation d'urgence

Lien : https://github.com/ReC82/Dig/issues/69

## Session du 06/11/2026 (après-midi) — recette #69-D : simulation compréhensible

### 1. Contexte et état réel

Le 06/11 à 12:40, vous avez indiqué que la simulation fonctionnait mais que ses termes restaient trop techniques : « profil fort / faible », « En vigueur » et « Fiche » n'étaient pas expliqués. Vous avez demandé des libellés clairs avec des aides ⓘ, un résumé « ce qui change » en premier, le détail replié, et « Aucun changement proposé » à la place d'une colonne remplie de « = ». Consigne : ne changer aucun montant, aucune formule, aucun paramètre et aucun tarif.

**État : Déployé en production (`f84e594`, 06/11 13:29) — en attente de recette.** Le changement concerne uniquement l'affichage du panel admin. Le jeu, les prix et la base ne changent pas.

Classement : **Après lancement** (outil d'administration).

### 2. Changements réalisés (Admin → ⬆ Améliorations → fiche → « 4. Simulation avant / après »)

- **Phrase d'introduction** : la section compare ce que le jeu utilise aujourd'hui avec les valeurs de la fiche, même si elles ne sont pas enregistrées. Rien n'est appliqué ici : seule la publication du brouillon change le jeu.
- **Encadré « Ce qui change »**, affiché en premier :
  - il liste les chiffres qui changent, par exemple « Gemmes pour tous les niveaux : 65 → 67 (+3,1 %) » ;
  - si la fiche correspond au jeu, il affiche « Aucun changement proposé : la fiche correspond aux paramètres utilisés en jeu. », et la colonne « Écart » est masquée ;
  - si seul un champ sans effet chiffré change (un nom, par exemple), il l'indique et renvoie au détail.
- **Les deux rythmes simulés** s'appellent désormais « Joueur qui gagne peu de pièces (pièces par minute) » et « Joueur qui gagne beaucoup de pièces (pièces par minute) ». Leur ⓘ précise qu'il s'agit de cas **hypothétiques et modifiables** : ce ne sont ni des comptes réels, ni des niveaux, ni un classement de joueurs. Ces champs ne sont jamais enregistrés.
- **Accordéon « Détail chiffré et comparaison champ par champ »**, replié par défaut. Il contient :
  - le tableau, avec les colonnes **« En jeu actuellement »**, **« Fiche ouverte »** et **« Écart »**. Leur ⓘ explique : version publiée utilisée par le jeu / valeurs de la fiche, même non enregistrées ni publiées / différence prévisionnelle, sans effet immédiat. Dans la colonne « Écart », « inchangé » remplace « = » ;
  - une ⓘ pour chaque ligne :
    - « Coût total de tous les niveaux, en pièces » : somme des prix réels (prix de la fiche × multiplicateur de Config), du premier achat jusqu'au maximum ;
    - « Gemmes pour tous les niveaux » : comptées à part, car elles ne se gagnent pas à un rythme par minute. Elles sont donc exclues du temps estimé. Elles se modifient dans la section 3, colonne « Gemmes », pour l'Auto-Dig ;
    - « Temps estimé » : total en pièces ÷ pièces par minute du cas simulé, arrondi, sans gemmes ni autres dépenses. C'est un ordre de grandeur, pas une durée garantie ;
  - une phrase qui rappelle ce qui est modifiable dans la section 3 ;
  - la liste « Champs modifiés par rapport au jeu actuel ».
- Les durées s'affichent avec une virgule (« 4,5 j » au lieu de « 4.5 j »).
- Fichiers : `public/admin/index.html`, `public/admin/admin.js` (`upRefresh`, aides ⓘ de la fiche), `public/admin/admin.css`, nouveau test `test/upgrade-sim-ux.test.js`.
- **Aucun montant, aucune formule, aucun paramètre ni tarif modifié.** Le barème reste en version 1 (Auto-Dig 0 / 0 / 4 / 8 / 18 / 35 💎). Aucune migration.

### 3. SHA, branche

- Branche `feature/69-ameliorations-admin` (`78e4022`), intégrée dans **`develop` `f84e594`**, déployée.

### 4. Vérifications effectuées

- `npm test` : 831/831 sur la branche avant l'ajout du test, puis 833/833 sur `develop` `f84e594` et sur la release.
- Chromium, PC 1280×900 et mobile 390×844, sur un serveur de test (port 3101, base de test supprimée ensuite). Fiche Auto-Dig :
  - à l'ouverture : les 6 champs « Gemmes » sont **modifiables** (0/0/4/8/18/35). L'encadré affiche « Aucun changement proposé… » et la colonne « Écart » est masquée ;
  - niveau 3 passé à `6`, **sans enregistrer** : l'encadré affiche « Gemmes pour tous les niveaux : 65 → 67 (+3,1 %) ». Dans le tableau, la ligne Gemmes indique 65 / 67 / +3,1 % et les autres lignes « inchangé ». Les aides ⓘ s'ouvrent une à la fois ;
  - fiche Pioche, prix du niveau 1 passé à 20 000 : « Coût total… : 1 946 450 → 1 966 350 (+1 %) » et « Temps estimé, joueur qui gagne peu… : 4,5 j → 4,6 j (+1 %) » ;
  - aucune erreur JavaScript.
- Copie de la base de production démarrée en `NODE_ENV=production` (port 3122) : `/health` ok, version `1.0.0+f84e594`, empreintes des 6 tables joueurs identiques. Copie supprimée.

### 5. Déploiement

- Avant le redémarrage : dernière requête admin à 12:54, déploiement à 13:29. Aucune génération en cours n'a donc été interrompue.
- `main` avancé en avance rapide `3684330` → `f84e594`, puis `scripts/deploy.sh` (script de la release). Sauvegarde vérifiée : `~/backups/dig/dig-20261106-132926-pre-deploy-f84e594.sqlite`.
- Après le déploiement :
  - les 2 domaines répondent 200, version `1.0.0+f84e594` ;
  - `quick_check` ok ;
  - empreintes joueurs identiques à la sauvegarde ;
  - `journalctl` sans erreur ;
  - la page /admin/ servie contient les nouveaux libellés ;
  - Chromium (PC et 390 px) sur le jeu et /admin/ : aucune erreur JavaScript.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 3684330` puis `sudo systemctl restart dig`. Aucune donnée n'est concernée.

### 6. Test fonctionnel à faire (3 min, sans publier)

1. /admin/ (Ctrl+F5) → ⬆ Améliorations → **Auto-Dig**. Section 4 : l'encadré « Ce qui change » affiche « Aucun changement proposé… ». Les deux champs s'appellent « Joueur qui gagne peu / beaucoup de pièces » ; cliquer leurs ⓘ.
2. Section 3, colonne **« Gemmes »**, niveau 3 : remplacer `4` par `6`. L'encadré affiche aussitôt « Gemmes pour tous les niveaux : 65 → 67 (+3,1 %) ». C'est la démonstration demandée : le champ est éditable et son effet apparaît dans la simulation, sans publication.
3. Ouvrir « Détail chiffré et comparaison champ par champ » : colonnes « En jeu actuellement / Fiche ouverte / Écart » avec leurs ⓘ, puis « inchangé » sur les autres lignes.
4. **Fermer → « Quitter sans enregistrer »**. Dans le jeu, l'Auto-Dig coûte toujours 4/8/18/35 💎.

### 7. Choix techniques faits seul

- La colonne « Écart » n'est masquée que si **aucun** champ de la fiche ne diffère du jeu. Si seul un nom change, elle reste visible avec « inchangé » sur chaque ligne, et l'encadré renvoie au détail.
- Le tableau reste dans un accordéon replié, conformément à votre demande de réduire la densité. Sur mobile, il défile horizontalement comme avant ; l'encadré « Ce qui change » suffit pour l'essentiel.

### 8. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire.

### 9. Restant à réaliser

- Votre recette de #69-D et de la correction #69-A (champ « Gemmes » éditable, test ci-dessus).
- Hors périmètre, constat inchangé : Fragments et Reroll bloc sont toujours masqués en production par votre session admin du 05/11.

## Session du 06/11/2026 — correction après recette : coûts en gemmes éditables (#69-A)

### 1. Contexte et état réel

Le 06/11, vous avez validé la consultation de la fiche Pioche (#69-A) et la simulation du Sac (#69-B). Vous avez demandé une correction : la colonne « Gemmes » (Auto-Dig) était en lecture seule. Vous attendez une gestion réelle des coûts en gemmes, en coordination avec #49.

**État : Déployé en production (`ba083e0`, 06/11 10:50) — en attente de recette.** La release a passé 822/822. Aucune migration : aucune table ni colonne ajoutée.**

Classement : **Après lancement**. Le barème reste strictement identique : 0 / 0 / 4 / 8 / 18 / 35 gemmes. Le jeu ne change pas pour les joueurs tant qu'aucune version n'est publiée.

### 2. Audit (améliorations payées en gemmes)

- **Auto-Dig** est la seule amélioration payée en gemmes : niveaux 3 à 6 = 4 / 8 / 18 / 35 💎. Les niveaux 1 et 2 se paient en pièces (800 et 3 000).
- **Jeu** : depuis le 04/11, il appliquait déjà les gemmes du barème publié (`Upgrades.applyCatalog`). L'achat restait toutefois décidé par le navigateur seul, avec le barème gardé en cache (relu chaque minute).
- **Registre de gemmes serveur (#49)** : il débitait la montée de niveau de l'Auto-Dig avec une table codée en dur (`AUTODIG_GEM_COST`). C'était la cause du verrou. Le registre est en mode `off` en production (aucun compte). Il ne débite donc rien aujourd'hui, mais il doit lire les mêmes prix le jour où il sera activé.
- **Règles économiques (#49, Admin → Économie)** : leurs « coûts Auto-Dig » ne servent que de référence de simulation. Le jeu ne les lit pas. Ce n'était donc pas une seconde vérité appliquée.
- **Anti-triche** : l'anti-bot (#25) dépend du nombre de niveaux (6 + 14 = 20 dégâts/s), pas du prix. Le nombre de niveaux reste donc verrouillé, et seul le prix devient éditable.
- **Achats en cours** : un joueur dont le barème est en cache pouvait acheter à l'ancien prix pendant au plus une minute après une publication.

### 3. Changements réalisés

- **Admin → ⬆ Améliorations → fiche Auto-Dig** :
  - colonne « Gemmes » **éditable par niveau** ;
  - bornes : entier de 0 à 1 000 ; un niveau ne peut pas être gratuit (0 pièce et 0 gemme refusé) ;
  - avertissement si un prix en gemmes baisse d'un niveau au suivant ;
  - simulation « Gemmes jusqu'au maximum » avant/après en % (exemple : 65 → 67, +3,1 %), comparaison champ par champ, puis le circuit existant : brouillon, publication avec note, retour arrière, journal ;
  - la fiche indique le verrou restant (nombre de niveaux, anti-bot #25) et la règle des gemmes.
- **Source unique** (`server/upgradeCatalog.js`) :
  - `autodigGemCosts()` renvoie les prix de la **version publiée, immuable** ;
  - le jeu (`GET /api/upgrades/catalog`) et le registre de gemmes (`server/gemLedger.js`, débit Auto-Dig) lisent ce même barème ;
  - le numéro de version est noté dans chaque débit du journal ;
  - `AUTODIG_GEM_COST` ne sert plus que de repli si le barème est illisible.
- **Achat au prix périmé refusé** :
  - nouvelle route publique `POST /api/upgrades/purchase-check` (limitée comme la boutique) ;
  - avant de débiter quoi que ce soit, le jeu envoie le prix qu'il affiche ;
  - même prix que la version publiée → achat ;
  - prix périmé → 409 + barème à jour : le jeu l'applique et le mémorise, l'achat est refusé et un message s'affiche : « Prix mis à jour : ce niveau coûte maintenant 6 💎. Vérifiez puis réessayez. » ;
  - achats suspendus → refus ;
  - sans réseau : un niveau payé en gemmes est refusé (« Connexion nécessaire… ») ; un niveau payé en pièces (1 et 2) s'achète comme avant ;
  - textes en FR/EN/NL/ES et en italien (outil i18n).
- **Admin → Économie** : la colonne « jeu actuel » des règles lit désormais les prix appliqués (barème des améliorations). Le groupe Auto-Dig est libellé « simulation ; prix appliqués au jeu : ⬆ Améliorations ».

### 4. SHA, branche, procédure de test

- Branche `feature/69-ameliorations-admin` (`f3d1ba1`), intégrée dans **`develop` `ba083e0`**.
- `node --test test/upgrade-catalog.test.js` (8 tests, dont 2 nouveaux) :
  - **recette sur base isolée** :
    - niveau 3 de l'Auto-Dig passé de 4 à 6 💎 dans le brouillon → le jeu, le contrôle d'achat et le registre restent à 4 ;
    - publication → jeu et registre en version N au prix de 6 ;
    - un client périmé à 4 est refusé (409 + barème) ; à 6, il est accepté ;
    - **débit serveur exact de 6** (version notée), et une révision rejouée n'est jamais débitée deux fois ;
    - retour arrière → 4 partout, niveau 4 débité 8 ;
    - achats suspendus refusés ;
  - **client** : confirmation avant débit, aucun débit sur un refus, barème à jour appliqué et mémorisé, nouvel essai au bon prix, règles hors ligne ;
  - validation : bornes, longueur, niveau gratuit, avertissement de baisse, 7e niveau refusé ;
  - route HTTP publique : 200, 409 et 400.

### 5. Vérifications effectuées

- `npm test` :
  - branche : 822/822 ;
  - `develop` `ba083e0` : 822/822 ;
  - release : **822/822**.
- Chromium (PC 1280×900 et mobile 390×844), serveur de test 3101 avec une base de test (supprimée ensuite) :
  - fiche Auto-Dig : 6 champs gemmes (0/0/4/8/18/35) ; niveau 3 → 6 ; simulation « 65 → 67 (+3,1 %) » ; comparaison « 0 / 0 / 4 / 8 / 18 / 35 → 0 / 0 / 6 / 8 / 18 / 35 » ;
  - brouillon enregistré, catalogue public toujours à 4 ;
  - jeu ouvert avec l'ancien barème, puis publication sur la base de test, puis clic sur l'Auto-Dig : **refus**, message « Prix mis à jour : ce niveau coûte maintenant 6 💎 », gemmes 100 inchangées, niveau 2 inchangé ;
  - nouveau clic : achat à 6 (100 → 94, niveau 3) ;
  - retour arrière : 4 partout ;
  - aucune erreur JavaScript.
- **Impact sur les données des joueurs : aucun.** Aucune table ni colonne ajoutée. Aucun prix, solde ou sauvegarde modifié. Le registre de gemmes reste en mode `off` en production.

### 6. Déploiement

- **SHA déployé : `ba083e0`** (précédent : `5756328`), le 06/11 à 10:50 (Bruxelles), avec `scripts/deploy.sh` de la release.
- J'ai attendu 10 minutes sans activité admin avant de redémarrer. Vous génériez des pictogrammes dans l'atelier (dernière application à 10:39) : un redémarrage pendant une génération l'aurait interrompue.
- Copie de la base de production (release, `NODE_ENV=production`, port 3122) :
  - `/health` ok, version `1.0.0+ba083e0` ;
  - catalogue v1, gemmes 0/0/4/8/18/35 ;
  - `purchase-check` niveau 3 à 4 💎 → ok ;
  - empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` **identiques**, liste des tables identique ; copie supprimée.
- Sauvegarde vérifiée avant déploiement : `~/backups/dig/dig-20261106-105002-pre-deploy-ba083e0.sqlite`.
- Après déploiement :
  - les 2 domaines → 200 et `1.0.0+ba083e0` ;
  - `journalctl` sans erreur ; `quick_check` = ok ;
  - empreintes des 6 tables joueurs **identiques** à celles d'avant le déploiement ;
  - catalogue toujours en version 1 (gemmes inchangées), brouillon vide, registre de gemmes `off` ;
  - Chromium (PC et 390 px) sur la production : jeu chargé, Auto-Dig 0/0/4/8/18/35, aucune erreur JavaScript.
- Constat sans action : en production, **Fragments** et **Reroll bloc** sont masqués (achats bloqués) depuis le 05/11 à 11:41 et 11:42, par votre session admin, avec les motifs « Les fragments doivent être récoltable par click et coffre uniquement » et « Ne sert pas a grand chose... ». Je n'y ai pas touché.
- Retour arrière immédiat possible : `git -C /home/ubuntu/Dig reset --keep 5756328` puis `sudo systemctl restart dig`. Aucune dépendance ni aucun schéma n'a changé.

**Test fonctionnel à faire par le propriétaire** (3 min, **sans publier**) :
1. /admin/ (Ctrl+F5) → **⬆ Améliorations** → cliquer **Auto-Dig**. La colonne « Gemmes » contient 6 champs modifiables : 0 / 0 / 4 / 8 / 18 / 35.
2. Mettre le niveau 3 à `6`. La simulation affiche « Gemmes jusqu'au maximum 65 → 67 (+3,1 %) » et la comparaison affiche la nouvelle liste. Essayer `-1` ou `2000` puis « Enregistrer dans le brouillon » : refus avec la borne. Essayer `0` gemme sur le niveau 3 (0 pièce) : refus « niveau gratuit ».
3. **Fermer → « Quitter sans enregistrer »**, ou enregistrer puis « Abandonner le brouillon ». Rien n'est publié.
4. Dans le jeu, l'Auto-Dig coûte toujours 4 / 8 / 18 / 35 💎. Pour un joueur qui l'achète, rien ne change (une confirmation serveur invisible a lieu avant le débit).
5. Reste aussi le test #69-C (boîte de suspension d'urgence, **Annuler** sans rien appliquer), décrit au § 6 de la session du 04/11.

### 7. Choix techniques faits seul

- **Pas de nouvelle table** : les prix en gemmes vivent dans les versions existantes du barème des améliorations, déjà immuables et en ajout seul. Le registre les lit au lieu de sa table codée en dur. Il n'y a donc qu'une seule source.
- **Contrôle avant achat plutôt que débit serveur direct** : la progression reste enregistrée par le client (sauvegarde cloud), et le registre débite à la sauvegarde. Un débit dans la route de contrôle, suivi d'une sauvegarde arrivée dans le désordre, aurait pu débiter deux fois. La route ne débite rien. Le débit unique reste celui du registre, au prix de la version publiée, avec rejeu sans double débit.
- **Refus hors ligne limité aux niveaux en gemmes** : aucun changement pour les achats en pièces hors ligne.
- Le nombre de niveaux de l'Auto-Dig reste verrouillé (#25). Les règles économiques (#49) restent un outil de simulation, inchangé.
- Fenêtre résiduelle connue : si une publication tombe entre le contrôle (accepté) et la sauvegarde suivante (quelques secondes), le registre débite le nouveau prix. En mode « fait foi », le solde de référence l'emporte : aucun achat ne peut être sous-payé ; seul un écart d'affichage côté client est possible, et il est noté. Un client modifié peut sauter le contrôle. Le registre débite quand même le prix publié et note une anomalie si le solde ne suffit pas (périmètre #25/#49).

### 8. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire. Changer un prix reste votre décision : brouillon → « Publier… » avec note. Rien n'est publié.

### 9. Reste à réaliser

- Recette #69-A (gemmes) et #69-C (suspension d'urgence, sans rien suspendre).
- Après lancement (#49) : activer le registre en `observe` puis `enforce` (décision séparée), pour que le débit serveur fasse foi.

## Session du 04/11/2026 (soir)

### 1. État réel

**Déployé en production (`5fc77d9`, 04/11 22:45) — en attente de recette.** La release a passé les tests complets (682/682). La migration a été testée sur une copie de la base de production, sans perte (empreintes identiques ; seules 5 tables `upgrade_*` ajoutées).

Classement : **Après lancement** pour l'édition du barème. La **suspension d'urgence** est un filet de sécurité utile dès le partage du MVP (couper une amélioration bugguée sans redéploiement), mais elle ne bloque pas le lancement. À la livraison, **aucune amélioration n'est suspendue et aucun prix ni effet n'est modifié** : le jeu est strictement identique.

### 2. Audit préalable : les améliorations réelles du moteur

Relevé dans le code (`public/js/upgrades.js`, `balance.js`, `blocks.js`, `relics.js`, `main.js`, `server/gemLedger.js`, `server/antibot.js`) :

| Amélioration | Type | Niveaux | Prix | Effet réel |
|---|---|---|---|---|
| ⛏ Pioche (`pickaxe`) | permanente (saison) | 1 → 15 | 100 → 700 000 pièces (total 1 946 450) | dégâts par clic = niveau + bonus « dégâts » des reliques |
| 🍀 Chance (`luck`) | permanente (saison) | 0 → 12 | 100 → 190 000 (total 520 050) | poids des blocs rares/épiques/légendaires × (1 + 0,10 × niveau + bonus reliques) |
| 🎒 Sac (`bag`) | permanente (saison) | 0 → 12 | 120 → 225 000 (total 622 170) | pièces d'un bloc × (1 + 0,3 × niveau) × reliques × réglage admin × boost |
| ⚙ Auto-Dig (`autodig`) | permanente (saison) | 0 → 6 | 800 et 3 000 pièces, puis 4 / 8 / 18 / 35 gemmes | dégâts automatiques/s = niveau + bonus reliques (gains hors ligne compris) |
| 🔮 Fragments (`fragment_shop`) | achat immédiat | 10 achats/saison | 5 000 → 620 000 | +1 fragment de relique par achat |
| 🔄 Reroll bloc (`block_reroll`) | achat immédiat | 99 achats/saison | 400 × 2^(achats ÷ 10) | remplace le bloc courant |

- Le multiplicateur `upgrade_cost_multiplier` de ⚙ Config (#20) s'applique en plus sur les prix en pièces.
- **Couplages serveur** : l'anti-bot (#25) suppose au plus 15 + 10 = 25 dégâts par clic et 6 + 14 = 20 dégâts auto/s. Le registre de gemmes (#49) code en dur les prix en gemmes de l'Auto-Dig. Ces éléments sont donc **verrouillés** dans la fiche, avec la raison affichée.
- Les **reliques** (#64, onglet 🔮) et les **consommables** (coffres, boost ×2) ne sont pas des améliorations : ils ne sont pas repris ici et l'aide de l'onglet le précise.
- Limite connue : la progression reste calculée par le client (sauvegarde cloud). Le serveur ne peut donc pas empêcher seul un achat suspendu par un client modifié ; c'est le périmètre de #25. Le blocage s'applique dans le jeu officiel.

### 3. Changements réalisés

- **`server/upgradeCatalog.js`** (nouveau) :
  - **Barème versionné**, sur le modèle des reliques (#64) :
    - tables ajoutées uniquement : `upgrade_catalog_versions`, `upgrade_catalog_audit` (en ajout seul, protégées par des triggers) et `upgrade_catalog_draft` ;
    - **version 1 = les six améliorations à l'identique**, relues dans le code du jeu (prix par niveau, niveaux, effet par niveau du Sac et de la Chance, paliers du reroll, noms FR/EN/NL/ES) ;
    - champs éditables, et seulement ceux que le moteur lit :
      - prix en pièces ;
      - nombre de niveaux de la Chance, du Sac et des Fragments, jamais en baisse (20 au plus) ;
      - effet par niveau du Sac (0,05 à 0,5) et de la Chance (0,01 à 0,2) ;
      - prix de base et palier de doublement du reroll ;
      - noms et emoji ;
    - éléments verrouillés : niveaux de la pioche et de l'Auto-Dig, gemmes de l'Auto-Dig (raison affichée) ;
    - cycle : brouillon, publication explicite avec **note obligatoire** et contrôle de version périmée, abandon, annulation par amélioration, **retour arrière** (republication d'une version antérieure, sans jamais réduire le nombre de niveaux), journal ;
    - usage par amélioration et par niveau, lu dans les sauvegardes cloud (lecture seule).
  - **Suspension d'urgence**, séparée du barème et immédiate :
    - tables `upgrade_controls` et `upgrade_control_audit` (ce journal est en ajout seul) ;
    - trois interrupteurs indépendants par amélioration : **nouveaux achats**, **effets**, **affichage**. Masquer une carte bloque aussi les achats. Pour les achats à effet immédiat (Fragments, Reroll), les « effets » ne sont pas suspendables : l'effet a déjà eu lieu à l'achat ;
    - **aperçu des conséquences** sans rien appliquer (joueurs concernés, effet calculé) ;
    - **motif obligatoire** (5 caractères au moins) ;
    - **identifiant à recopier** pour suspendre les effets ou masquer la carte ;
    - **30 bascules par heure** au plus ;
    - journal : avant/après, motif, nombre de joueurs, origine (session ou clé) ;
    - le motif n'est jamais envoyé aux joueurs.
- **Routes** :
  - `GET /api/upgrades/catalog` (public : barème, suspensions, numéro de révision) ;
  - `GET /api/admin/upgrades`, `PUT /api/admin/upgrades/draft/upgrades/:id`, `POST …/:id/revert`, `DELETE /api/admin/upgrades/draft`, `POST /api/admin/upgrades/publish`, `POST /api/admin/upgrades/rollback`, `GET /api/admin/upgrades/audit` ;
  - `POST /api/admin/upgrades/:id/controls/preview` (aperçu) et `POST /api/admin/upgrades/:id/controls` (application). Toutes les routes admin sont protégées et tracées dans le journal de sécurité existant.
- **Jeu** (`upgrades.js`, `balance.js`, `blocks.js`, `relics.js`, `main.js`, `style.css`, `i18n.js` + italien) :
  - le barème publié et les suspensions sont lus au démarrage, gardés en cache, puis **relus chaque minute**. Une bascule s'applique sans rechargement, sans déconnexion et sans toucher au bloc en cours ;
  - **effet suspendu** : calculé comme au niveau de départ (pioche niveau 1, autres niveau 0 ; les reliques restent actives). Le niveau possédé reste dans la sauvegarde et l'effet revient tel quel à la réactivation ;
  - **achats suspendus** : bouton « Suspendu » désactivé, avec le message « Achats suspendus temporairement » ;
  - **carte masquée** : la carte n'apparaît plus dans l'onglet Améliorations.
  - Textes FR/EN/NL/ES et IT. Le message reste visible sur mobile, où la description est masquée.
- **Admin → ⬆ Améliorations** (`index.html`, `admin.js`, `admin.css`) :
  - carte **🚨 Suspension d'urgence** : état des 3 interrupteurs, joueurs concernés, dernier motif, bouton « Suspendre… » / « Réactiver / modifier… ». Il ouvre une boîte avec les 3 cases, les conséquences calculées par le serveur, le motif et l'identifiant à recopier ;
  - **liste** : visuel (pictogramme de l'atelier, sinon emoji), nom, type et effet, niveaux, prix du premier au dernier niveau (×Config), total jusqu'au maximum, effet du niveau de départ au maximum, joueurs, état. Recherche et filtres par état et par type ;
  - **fiche** : noms dans les 4 langues (pastilles ●/○), emoji, bouton « 🎨 Pictogramme de la carte dans Icônes ». Il ouvre la cible stable `ui:upgrade_<id>` de l'atelier (#67 : une image par clic, téléversement, Appliquer / Revenir), avec un retour à la fiche ;
  - dans la fiche, la formule réelle et les verrous expliqués ; un tableau par niveau avec prix, gemmes, prix réel (×Config), cumul, effet et joueurs à ce niveau ;
  - **simulation avant/après** : coût total, temps pour un profil faible ou fort (revenu par minute modifiable), effet au maximum, écart en % ; plus une comparaison champ par champ avec la version en vigueur ;
  - « ＋ Ajouter une amélioration » explique qu'un nouveau type exige du code moteur (voir § 7) ;
  - brouillon (avant/après, erreurs, avertissements), versions publiées avec retour arrière, journal commun barème + suspensions. Fiche protégée contre la perte de saisies (#61).
- **Tests** : `test/upgrade-catalog.test.js` (6 tests), décrits au § 4.

### 4. SHA, branche et procédure de test

- Branche `feature/69-ameliorations-admin` (`d0b9077`), intégrée dans **`develop` `5fc77d9`**.
- `npm test`, ou `node --test test/upgrade-catalog.test.js`. Les tests couvrent :
  - version 1 identique au client, prix par niveau et gemmes de l'Auto-Dig identiques au registre serveur ;
  - validation : verrous, bornes, niveaux jamais en baisse ;
  - brouillon et abandon sans effet, publication avec note, version périmée, retour arrière, tables en ajout seul ;
  - **recette de suspension sur base isolée** : aperçu sans effet, motif, confirmation, effet immédiat non suspendable, carte masquée ⇒ achats bloqués, limite de fréquence, réactivation, **sauvegarde du joueur identique octet pour octet** ;
  - client : barème appliqué, achats bloqués, effets suspendus puis rétablis, niveaux intacts, barème invalide refusé ;
  - routes HTTP : 401 sans session admin, suspension puis réactivation, rien de publié.

### 5. Vérifications effectuées

- `npm test` :
  - branche : 682/683 au premier passage, puis 683/683. Seuls échecs : le pilote italien (3 textes à ajouter, corrigé) et `ranking-depth`, passé en dépassement de délai une fois, à cause d'un serveur de test orphelin. Relancé seul, il réussit (17/17) ;
  - `develop` `5fc77d9` : 681/682 au premier passage (`gem-ledger` « achats simultanés depuis 4 processus », instabilité connue et déjà signalée au #64), puis **682/682** au second passage complet ;
  - release `5fc77d9` : **682/682** du premier coup.
- Chromium headless, PC 1280×900 et smartphone 390×844, serveur de test (port 3101, base de test supprimée ensuite) :
  - 6 améliorations listées avec prix, totaux et effets réels ;
  - fiche Sac : effet 0,3 → 0,35 et prix du niveau 1 120 → 200 → simulation (+0,01 % de coût, effet max ×4,60 → ×5,20) et comparaison ; enregistrement dans le brouillon, tableau avant/après, abandon ;
  - suspension des effets de l'Auto-Dig : aperçu, identifiant demandé, application, catalogue public mis à jour, journal ; puis réactivation ;
  - jeu : Sac suspendu (achats + effets) et Reroll masqué → 5 cartes, messages « Effet suspendu temporairement — votre niveau est conservé » et « Achats suspendus temporairement », bouton « Suspendu » désactivé ; après réactivation, 6 cartes et plus aucun message ;
  - aucune erreur JavaScript, seuls les 401/404 attendus avant la connexion admin.
- **Copie de la base de production** (release, `NODE_ENV=production`, port 3122) :
  - `/health` ok, `/api/version` = `1.0.0+5fc77d9`, catalogue en version 1 sans suspension ;
  - empreintes (nombre de lignes + hachage de toutes les colonnes) de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking` **identiques** avant et après le démarrage ;
  - seules 5 tables `upgrade_*` sont ajoutées ; copie supprimée ensuite.
- **Impact sur les données des joueurs : aucun.** Les niveaux, pièces, gemmes et sauvegardes ne sont jamais écrits par ce ticket : le serveur ne fait que lire les sauvegardes pour compter l'usage.
- Non fait : aucune génération d'image (aucune dépense), aucune publication, **aucune suspension en production**.

### 6. Déploiement

- **SHA déployé : `5fc77d9`** (précédent : `ef22f67`), le 04/11 à 22:45 (Bruxelles), avec `scripts/deploy.sh` de la release.
- J'ai attendu 10 minutes sans activité admin avant de redémarrer : des icônes avaient été générées entre 22:30 et 22:34 et des invitations bêta créées à 22:35. Un redémarrage pendant une génération IA l'aurait interrompue.
- Sauvegarde vérifiée avant déploiement : `~/backups/dig/dig-20261104-224554-pre-deploy-5fc77d9.sqlite`.
- Vérifications après déploiement :
  - https://dig.lodygames.com et https://dig.lodylands.com → 200, `/api/version` = `1.0.0+5fc77d9` ;
  - `/api/upgrades/catalog` = version 1, sans suspension ;
  - aucune erreur dans `journalctl -u dig` ; `pragma quick_check` = ok ;
  - empreintes de `users`, `seasons` et `leagues` identiques à la sauvegarde ;
  - `user_saves`, `season_rankings` et `player_click_tracking` ont évolué parce qu'un joueur était en partie (14 m → 26 m, révision 11 → 13). C'est une progression, aucune perte ;
  - aucune amélioration suspendue ni publiée en production (`upgrade_controls` vide, 1 version).
- Retour arrière immédiat possible : `git -C /home/ubuntu/Dig reset --keep ef22f67` puis `sudo systemctl restart dig` (aucune dépendance changée). Les 5 tables ajoutées seraient ignorées par l'ancien code.

**Test fonctionnel à faire par le propriétaire** (5 min, sans rien suspendre ni publier en production) :
1. /admin/ (Ctrl+F5) → onglet **⬆ Améliorations** : 6 améliorations. Pioche : 15 niveaux, `100 🪙 → 700 000 🪙`, total `1 946 450 🪙`, effet `1 → 15 dégâts/clic`. La colonne « Joueurs » compte les sauvegardes cloud.
2. Cliquer **Sac** : formule réelle, tableau des 12 niveaux (prix, prix réel ×Config, cumul, effet ×1,30 … ×4,60). Modifier « Effet par niveau » à `0,35` : la simulation montre l'effet maximal ×4,60 → ×5,20 et la comparaison apparaît. **Fermer → « Quitter sans enregistrer »** (ou enregistrer dans le brouillon puis « Abandonner le brouillon »).
3. Carte **🚨 Suspension d'urgence** → « Suspendre… » sur une amélioration : vérifier les 3 cases distinctes (nouveaux achats / effets / affichage), les conséquences qui s'affichent et le motif obligatoire. Cocher « Effets » fait apparaître « Recopiez … pour confirmer ». **Cliquer « Annuler »** : rien n'est appliqué (le ticket demande la capacité, pas l'arrêt d'une amélioration réelle).
4. Dans le jeu : l'onglet Améliorations est inchangé (mêmes prix, mêmes niveaux).

### 7. Choix techniques faits seul

- **Ensemble fixe de six améliorations** : « ＋ Ajouter » explique qu'un nouveau type exige du code moteur. Une fiche sans effet réel serait un champ cosmétique, que le ticket exclut. Archiver une amélioration n'a pas de sens pour ces six : la suspension « affichage » couvre ce besoin de façon réversible.
- **Verrous** : niveaux de la pioche (15) et de l'Auto-Dig (6), dégâts par niveau, gemmes de l'Auto-Dig. Les relâcher exigerait de faire évoluer l'anti-bot (#25) et le registre de gemmes (#49) ; c'est une décision à part.
- **Suspension séparée du barème** : immédiate (sans brouillon ni publication), pour être rapide. Elle est protégée par un motif, la recopie de l'identifiant pour les actions qui touchent les joueurs, une limite de fréquence et un journal en ajout seul.
- **Comportement sûr pour les détenteurs** : effet suspendu = niveau de départ, calculé à la volée. La sauvegarde n'est jamais réécrite, donc aucune compensation n'est nécessaire à la réactivation. Une carte masquée garde son effet, sauf si ses effets sont aussi suspendus.
- Relecture chaque minute : délai court pour une urgence, une petite requête JSON gardée en mémoire côté serveur.
- La description de la carte reste calculée par le jeu (traductions intégrées avec la valeur réelle) et n'est pas éditable : ainsi, elle n'affiche jamais une valeur fausse.
- Le pictogramme réutilise les cibles `ui:upgrade_*` de l'atelier (#67), sans créer de doublon.

### 8. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire. Rien n'est publié ni suspendu : toute modification du barème reste dans un brouillon jusqu'à votre « Publier… », et toute suspension demande votre motif et votre confirmation.

### 9. Reste à réaliser

- Facultatif (#25) : contrôle serveur des niveaux achetés pendant une suspension (aujourd'hui, seul le jeu officiel applique le blocage).
- Facultatif (#49) : faire lire au registre de gemmes les prix en gemmes de l'Auto-Dig depuis ce barème, pour les rendre éditables ; relâcher les verrous de la pioche et de l'Auto-Dig avec l'anti-bot (#25).
- Réorganisation du menu admin : #70 (l'onglet est ajouté à la suite de 🔮 Reliques).
- Fiabiliser `test/gem-ledger.test.js` (instabilité connue, #17/#49).
