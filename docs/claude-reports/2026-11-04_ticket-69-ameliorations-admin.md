# Ticket #69 — Admin : gérer les améliorations, leurs niveaux/effets, et désactivation d'urgence

Lien : https://github.com/ReC82/Dig/issues/69

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
