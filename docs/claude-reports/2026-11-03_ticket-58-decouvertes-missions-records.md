# Ticket #58 — [Idées à tester] Découvertes surprises, missions courtes et records personnels

Lien : https://github.com/ReC82/Dig/issues/58

## Session du 03/11/2026 (DIGORCH) — étude : ce qui existe, trois conceptions, ordre de test

### 1. État réel

**Étude livrée (ce rapport), intégrée dans `develop`, non déployée : rien ne change dans le jeu.**
Le ticket se termine par « **Ne rien déployer automatiquement avant MVP stable et décision de
priorisation** ». Je n'ai donc modifié aucune ligne de code, aucune table et aucun réglage. Il n'y a
rien à tester en jeu pour l'instant. Ce rapport sert à prendre la décision de priorisation.

Classement : **Après lancement** pour les trois idées. Une seule remarque touche le MVP : les
**missions du jour actuelles** (voir 2.2) sont calculées et payées par le navigateur, y compris des
gemmes. C'est déjà noté dans l'audit économique #49 et ne bloque pas le lancement, mais c'est la
raison pour laquelle je recommande de **remplacer** ces missions plutôt que d'en ajouter d'autres.

### 2. Ce qui existe déjà (vérifié dans le code de `develop`, `dbb4b45`)

#### 2.1 Découvertes pendant le minage

| Mécanisme | Où | Qui tire au sort | Ce que ça rapporte |
|---|---|---|---|
| **Blocs-coffres** (Vieille caisse dès 1 m, Coffre en bois dès 5 m, Coffre en fer dès 30 m) | `public/js/blocks.js`, `public/js/chests.js` | navigateur (tirage reproductible par bloc, #35) | pièces, fragments de relique, boost ×2/×3 |
| **Trouvailles de collection** (8 objets « origines », chance de 3 à 20 % sur un type de bloc à partir d'une profondeur) | `public/js/collection.js` `tryDrop`, catalogue `server/collectionCatalog.js` (#39) | navigateur | objet de collection (pas de monnaie) |
| **Objets d'événement mensuel** | `server/monthlyEvents.js` (#56) | **serveur**, à la sauvegarde, avec `crypto`, sur les seuls blocs validés | souvenir unique par joueur, aucune monnaie |
| Gemmes (rubis, émeraude, diamant) | catalogue de blocs #37 | navigateur | +1 💎 |

Conclusion : le jeu a déjà des « surprises », mais elles **ressemblent à des blocs ordinaires**
(un coffre est un bloc parmi d'autres), sans moment fort. Le ticket demande surtout un **moment
visuel** (« feedback visuel court ») et un **contrôle des probabilités**. Le modèle sûr existe déjà
dans #56 : tirage côté serveur sur les blocs validés, une fois par objet, rien de rejouable.

#### 2.2 Objectifs et missions

| Mécanisme | Où | Fonctionnement | Récompense |
|---|---|---|---|
| **Objectifs** (5, une seule fois : 10 blocs, 25 m, 100 pièces, première gemme, 5 améliorations) | `public/js/quests.js` | navigateur, attribution automatique | 30 à 200 pièces ; +1 💎 (première gemme) |
| **Missions du jour** (3 tirées chaque jour parmi 6 : blocs, pièces gagnées, coffres, améliorations, gemmes trouvées, profondeur gagnée) | `public/js/dailyMissions.js` | navigateur : mêmes missions pour tous selon la date, progression = statistique du jour − statistique du matin, bouton « Réclamer » | pièces (jusqu'à 1 200) ; **+1 💎** pour « trouver des gemmes » et « ouvrir 4–5 coffres » |

Les missions du jour existent donc déjà, mais elles vont à l'encontre de deux demandes du ticket :
- **« sans pression quotidienne »** : elles disparaissent à minuit, une mission non faite est perdue ;
- **« validation serveur »** : la progression et la récompense sont calculées par le navigateur
  (un joueur qui modifie sa sauvegarde peut les réclamer à volonté). L'audit #49 compte 3,5 à
  13 gemmes par semaine issues de ces missions selon le profil.

#### 2.3 Records et statistiques

| Donnée | Où | Fiable ? | Depuis |
|---|---|---|---|
| Profondeur maximale retenue, blocs par type, total de blocs, coffres ouverts, types distincts, jours joués | `badge_player_stats` (#38) | **oui** : seulement ce que le serveur a validé (profondeur #9/#25, un bloc = un mètre retenu) | 02/11/2026 (pas de rétroactif) |
| Badges obtenus et date | `player_badges` (#38) | oui | 02/11/2026 |
| Classement figé de chaque saison close (rang, profondeur, blocs manuels validés) | `season_standings` (#29) | oui, immuable | saisons 6 et suivantes (1 à 5 reconstituées a posteriori) |
| Objets de collection et d'événement trouvés | sauvegarde du joueur (#39) ; table d'événements (#56) | collection : non (navigateur) ; événement : oui | — |
| Statistiques de la sauvegarde (`stats.blocksDestroyed`, `chestsFound`, `gemsFound`…) | `user_saves` | **non** (déclarées par le navigateur) | origine |

Il n'existe **pas de profil public** : le bouton « Profil » ouvre le compte du joueur (privé). Aucun
autre joueur ne peut voir ces données, sauf le pseudo, la profondeur et le rang au classement.

#### 2.4 Mesure (J+1 / J+7)

Seul outil : la liste des testeurs de la bêta (#57, `server/beta.js listTesters`), qui approxime le
retour par la date de la **dernière** sauvegarde. Ce n'est pas un vrai J+1/J+7 (un joueur revenu
le lendemain puis plus jamais compte comme « revenu à J+7 » s'il a sauvegardé une fois plus tard).
`badge_tracking.last_day` ne garde que le dernier jour. **Aucune mesure ne permet aujourd'hui de
savoir si une mécanique est utile** — c'est le prérequis de « mesurer et arrêter les mécanismes peu
utiles ».

### 3. Conception proposée — idée 3 : records personnels (la plus simple, recommandée en premier)

Aucune économie, aucune règle de récompense, presque toutes les données existent déjà.

**Contenu : une carte « Mes records » dans Profil**, en lecture seule :

| Record | Source | Remarque |
|---|---|---|
| Meilleure profondeur (et date) | `badge_player_stats.max_depth` + date de franchissement à enregistrer | toutes saisons confondues, depuis le 02/11 |
| Meilleure saison : meilleur rang et meilleure profondeur de fin de saison | `season_standings` (saisons figées à la clôture, `source = close`) | jamais les saisons reconstituées 1–5 |
| Saisons jouées | `season_standings` : saisons closes avec au moins N blocs manuels validés (réutiliser la règle « semaine » de l'étude #53 pour ne pas compter deux fois la double clôture du 30/10) | |
| Découverte la plus rare | objets d'événement (#56) ; collection quand son tirage passera côté serveur | rareté du catalogue |
| Total de blocs, coffres ouverts, types de blocs différents, jours joués | `badge_player_stats` | |
| Dernier record battu | nouvelle petite table, voir ci-dessous | « Nouveau record ! » en notification courte |

**Confidentialité** : visible seulement par le joueur lui-même (route authentifiée
`GET /api/me/records`). Pas de date de création du compte affichée aux autres, pas de liste
d'activité, pas de comparaison avec d'autres joueurs. Un profil public éventuel serait une
décision séparée.

**Données (non créées)** : ajout pur et idempotent —
`player_records(user_id, record TEXT, value INTEGER, ref TEXT, achieved_at TEXT, PRIMARY KEY(user_id, record))`,
mis à jour dans la même transaction que les statistiques #38 (`UPDATE … WHERE value < ?`), donc
jamais en baisse. Les records de saison se calculent à la lecture depuis `season_standings`.

**Effort** : petit (≈ ½ à 1 journée de session : module serveur, route, carte, traductions des langues actives, tests).
**Risque** : très faible (lecture seule sur les données existantes, aucune monnaie).

### 4. Conception proposée — idée 1 : découvertes surprises

**Principe** : de temps en temps, un bloc miné révèle une **découverte** avec une courte animation
(≈ 1,2 s, sans bloquer le clic, désactivable si « réduire les animations ») : **Filon**, **Géode**,
**Cache oubliée**. C'est un *moment*, pas un nouveau bloc.

**Tirage côté serveur** (modèle #56, déjà éprouvé) : à chaque sauvegarde, pour chaque bloc **validé**
depuis le dernier passage, tirage `crypto` ; le résultat est renvoyé au navigateur, qui joue
l'animation au prochain bloc. Le client ne peut ni choisir ni rejouer. Conséquence assumée :
quelques secondes de décalage entre le bloc et l'animation (la sauvegarde est groupée, #10) ; à
mesurer en jeu, sinon tirage à la réception des blocs validés.

**Anti-spam (réglages, valeurs proposées)** :
- chance de base par bloc validé : **0,6 %** → ≈ 1 découverte pour 170 blocs, soit ≈ 45 min de jeu
  actif en début de partie (≈ 126 blocs/h d'après le simulateur #49) ;
- **délai minimal** de 100 blocs validés entre deux découvertes ; **plafond** de 6 par jour ;
- **garantie douce** : au-delà de 400 blocs sans découverte, la chance double (évite la malchance
  longue) ;
- l'Auto-Dig ne déclenche rien (blocs **manuels** validés uniquement, comme #53), sinon un onglet
  ouvert la nuit produit des découvertes.

**Contenu et cohérence** :

| Découverte | Dès | Part | Contenu proposé |
|---|---|---|---|
| Filon | 1 m | 70 % | le bloc suivant d'un minerai de la profondeur actuelle vaut ×3 (pièces de saison seulement) |
| Géode | 20 m | 25 % | une chance renforcée (×3) de trouvaille de collection de la profondeur actuelle, sinon fragments de relique (1) |
| Cache oubliée | 40 m | 5 % | un objet de collection garanti non encore possédé (série permanente) ou, si tout est possédé, 2 fragments |

Aucune gemme, aucun point de récompense, aucun effet sur le classement autre que les pièces de
saison du Filon (remises à zéro le lundi). Les chances sont des **réglages admin** (même garde-fou
`confirmDrops` que #39 : toute modification de barème est confirmée et journalisée).

**Données (non créées)** : `discovery_settings` (désactivé par défaut), `player_discoveries`
(journal en ajout seul : joueur, type, bloc, profondeur, contenu, date) et un curseur par joueur.

**Effort** : moyen (≈ 2 journées : serveur, animation, admin, tests, traductions).
**Risque** : moyen — touche aux gains (pièces, fragments). **Dépend** : du choix de récompense
(question 3) et, pour la Géode/Cache, du passage côté serveur du tirage de collection (#39 étape suivante).

### 5. Conception proposée — idée 2 : mini-objectifs facultatifs renouvelés

**Principe** : **remplacer** les missions du jour par **3 objectifs en cours**, toujours visibles,
**sans date limite**. Quand un objectif est réclamé, un nouveau le remplace (au plus 3 nouveaux
objectifs par jour pour éviter la course ; au-delà, « reviens demain » sans rien perdre).
Rien n'expire : un joueur absent une semaine retrouve ses objectifs là où il les a laissés.

**Types** (uniquement des compteurs validés par le serveur, #38) :
- « Descendre de X m » (profondeur retenue gagnée depuis le début de l'objectif) ;
- « Miner X blocs de <minerai> » (types publiés, profondeur d'apparition atteinte) ;
- « Ouvrir X coffres en minant » (blocs-coffres validés).

Les missions actuelles « pièces gagnées », « améliorations achetées » et « gemmes trouvées » ne
sont pas reprises : leurs compteurs ne sont pas validés par le serveur.

**Taille** : calibrée pour ≈ 5 à 15 minutes de jeu actif à la profondeur du joueur (une mission
« courte » au sens du titre). **Validation** : la progression et la réclamation sont calculées par
le serveur (`POST /api/objectives/:id/claim`, idempotent, transaction).

**Récompense modeste** (proposée, à valider avec #49) : pièces de saison seulement, équivalentes
à ≈ 3 minutes de minage à la profondeur du joueur ; **pas de gemmes** en attendant la décision
économique #49. Les gemmes que rapportent aujourd'hui les missions du jour disparaîtraient donc —
c'est un **changement d'économie** à décider explicitement (question 2).

**Migration** : les missions du jour en cours restent réclamables jusqu'à minuit le jour du
passage ; les objectifs « une seule fois » (`quests.js`) restent inchangés. Aucune sauvegarde
réécrite : le champ `dailyMissions` reste lu, simplement plus alimenté.

**Données (non créées)** : `player_objectives(user_id, slot, kind, target, baseline, created_at, claimed_at, reward)`
en ajout ; réglages `objective_settings` (désactivé par défaut).

**Effort** : moyen (≈ 2 journées). **Risque** : moyen (remplace un écran existant, change des gains).

### 6. Mesure (prérequis commun, à faire avant d'activer les idées 1 et 2)

Pour « mesurer onboarding/J+1/J+7 et arrêter les mécanismes peu utiles », il faut une trace
minimale, sans outil tiers :
- `player_activity_days(user_id, day)` : un jour (Bruxelles) avec au moins un bloc validé, écrit
  au même endroit que `play_days` (#38). Pas d'IP, pas d'heure, pas d'appareil. Donne de vrais
  J+1/J+7 par cohorte de création de compte ;
- compteurs agrégés par jour et par mécanique : découvertes déclenchées, objectifs réclamés, cartes
  « Mes records » ouvertes (`feature_daily_stats(day, feature, count)`, sans identifiant joueur) ;
- une page admin « Rétention » : cohortes par semaine, J+1/J+7, utilisation par mécanique.

Avec très peu de joueurs (bêta #57), les chiffres seront indicatifs : comparer avant/après
activation sur 2 semaines, et préférer les retours des testeurs (#57, formulaire de bug).
**Effort** : petit (≈ ½ journée). **Risque** : nul pour le jeu ; à mentionner dans la page de
confidentialité (#28/#57) si elle existe.

### 7. Ordre de test recommandé

1. **Mesure** (section 6) — sinon impossible de juger les trois idées.
2. **Records personnels** — sans économie, rapide, utile aussi pour le partage du MVP.
3. **Découvertes surprises** — le plus fort effet « clic », une fois le barème choisi.
4. **Objectifs renouvelés** — après la décision économique #49, car ils remplacent des gains existants.

Chaque mécanique serait livrée **désactivée par défaut**, activable dans l'admin (puis éventuellement
pour les seuls testeurs #57), et désactivable sans perte (les objets ou records obtenus restent).

Pistes « à évaluer ensuite » (zones spéciales selon profondeur, mystères narratifs via collections,
objectifs communautaires) : non étudiées ici ; les zones spéciales recouvrent #37/#48 (catalogue
et saisons thématiques), les mystères #39, les objectifs communautaires demanderaient un
compteur global serveur.

### 8. Vérifications effectuées

- Lecture du ticket (aucun commentaire), du code de `develop` (`dbb4b45`) : `public/js/dailyMissions.js`,
  `quests.js`, `chests.js`, `blocks.js`, `collection.js`, `server/badges.js`, `monthlyEvents.js`,
  `collectionCatalog.js`, `beta.js`, schéma `server/db.js`, et des rapports #38, #49, #53, #56.
- Aucune branche, PR ou rapport existant pour #58 (réconciliation : rien de livré).
- **Non effectué** : aucun code, aucun test automatisé (rien à tester), aucune lecture de la base
  de production (non nécessaire ; l'étude #53 du même jour a constaté 1 seul compte).
- Impact sur les données des joueurs : **aucun**.

### 9. Déploiement

**Aucun déploiement** : seul ce rapport est ajouté (documentation), et le ticket demande
explicitement de ne rien déployer avant décision. La production reste sur la version actuelle.
**Test fonctionnel à faire par le propriétaire** : aucun en jeu ; lire les sections 3 à 7 et
répondre aux questions ci-dessous dans le ticket.

### 10. Choix faits seul

- **Étude plutôt que code** : imposé par la dernière phrase du ticket.
- **Réutiliser les compteurs validés #38 et le tirage serveur #56** plutôt que les statistiques de
  la sauvegarde : seules sources que le navigateur ne peut pas falsifier.
- **Blocs manuels seulement** pour les découvertes : sinon l'Auto-Dig hors ligne en produirait.
- **Records privés** : aucun profil public n'existe ; en créer un est une décision distincte.

### 11. Décisions demandées au propriétaire

1. **Ordre de priorité** des trois idées. Options : (a) mesure → records → découvertes → objectifs ;
   (b) découvertes d'abord (effet le plus visible) ; (c) une seule idée pour l'instant.
   **Recommandation : (a)**, en commençant après le lancement du MVP public.
2. **Missions du jour** : (a) les **remplacer** par les objectifs renouvelés sans date limite,
   validés serveur, payés en pièces seulement (les gemmes des missions disparaissent) ;
   (b) les garder telles quelles et ajouter les objectifs à côté ; (c) les garder mais les faire
   valider par le serveur (gemmes conservées). **Recommandation : (a)**, à arbitrer avec #49.
3. **Contenu des découvertes surprises** : (a) barème du tableau 4 (pièces de saison, fragments,
   objets de collection, aucune gemme) ; (b) purement visuel/souvenir, aucun gain ; (c) inclure
   une petite chance de gemme. **Recommandation : (a)**.
4. **Fréquence des découvertes** : ≈ 1 pour 170 blocs manuels (≈ 45 min de jeu actif), 6 par jour
   au plus — plus, moins, ou d'accord ? **Recommandation : d'accord, réglable dans l'admin.**
5. **Records** : visibles par le joueur seul (recommandé) ou aussi sur un futur profil public ?
6. **Mesure** : d'accord pour enregistrer un jour d'activité par joueur (sans IP ni heure) afin de
   calculer de vrais J+1/J+7 ? **Recommandation : oui.**

### 12. Restant à réaliser

Tout le développement, après les réponses ci-dessus : mesure (≈ ½ j), records (≈ ½–1 j),
découvertes (≈ 2 j), objectifs renouvelés (≈ 2 j). Chaque partie serait livrée désactivée par
défaut, avec tests automatisés et déploiement ordinaire.
