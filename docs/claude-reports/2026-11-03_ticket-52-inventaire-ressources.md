# Ticket #52 — [Idée future] Inventaire des ressources récoltées, bois et futurs bâtiments

Lien : https://github.com/ReC82/Dig/issues/52

## Session du 03/11/2026 (DIGORCH) — étude et proposition d'architecture

### 1. État réel

**Étude livrée (ce rapport), intégrée dans `develop`, non déployée : aucun changement du jeu.**
Conformément au ticket (« sans activer ni modifier les ressources »), **aucune ligne de code du
jeu, aucun drop, aucune table et aucun réglage n'a été modifié**. Il n'y a donc rien à mettre en
production ni à tester en jeu pour l'instant.

Classement : **Après lancement** (idée de feuille de route ; le MVP public n'en a pas besoin).

### 2. Audit des données existantes : statistiques ≠ ressources

| Donnée | Où | Fiabilité | Nature |
|---|---|---|---|
| `stats.blocksDestroyed`, `stats.minedByType` | sauvegarde du navigateur (`public/js/gameState.js`, `save.js`) | **déclarée par le client** | statistique historique cumulée |
| `badge_player_stats` : `blocks:<type>`, `blocks_total`, `chests_opened` | serveur (`server/badges.js`, #38) | **validée** : le serveur ne crédite que l'écart déclaré, borné par les mètres retenus (#9/#25), seulement pour un type publié (#37) dont la profondeur est atteinte | statistique historique, depuis l'activation de #38 (02/11/2026 23:01 UTC) |
| Tirages d'événement (#56) | serveur (`server/monthlyEvents.js`) | validée (même base `blocks:<type>`) | objets uniques, pas des quantités |
| Pièces, gemmes, fragments | navigateur, enregistrés tels quels | déclarée (cf. #49, R1) | monnaies |

Constats (copie en lecture seule de la base de production, agrégats uniquement) :
- **Aucune ressource stockable n'existe aujourd'hui.** Il n'y a que des compteurs historiques.
  Les « blocs minés » ne sont jamais consommés et ne doivent pas le devenir (ils servent aux
  badges et aux événements).
- Pour le seul compte actif : **465** blocs déclarés depuis le début, **123** validés par le
  serveur depuis l'activation de #38. Les 342 blocs d'avant n'ont **aucune preuve serveur** :
  ils ne doivent pas être convertis en ressources (exigence du ticket respectée).
- Le catalogue publié (v3) compte **22 blocs** : terre (2), pierre (4), minerai (8), coffre (3),
  gemme (6). **Aucun bloc ni objet « bois »** n'existe ; les seules choses en bois sont la
  « vieille caisse » et le « coffre en bois » (catégorie coffre).
- La brique fiable à réutiliser existe déjà : le crédit validé de `badges.processSave`. Une
  ressource récoltée = un bloc validé de ce mécanisme, crédité dans **la même transaction**,
  à partir de zéro au jour de l'activation.

Rythme de récolte (simulateur de #49, `tools/balance/economy-sim.js`, profils de référence,
catalogue v3, 200 heures simulées par profil) — base de calibrage des coûts :

| Profil | Blocs/h | Pierre (pierre+grès+granite) | Charbon | Fer | Or | Caisses en bois (vieille + bois) | Coffre en fer |
|---|---|---|---|---|---|---|---|
| Début — 30 m | ≈ 126 | ≈ 88 | 15 | 10 | 0 | ≈ 8 | 2 |
| Capture 02/11 — 122 m | ≈ 195 | ≈ 119 | 20 | 14 | 11 | ≈ 13 | 4 |
| Milieu — 300 m | ≈ 168 | ≈ 83 (+ 10 obsidienne) | 14 | 10 | 9 | ≈ 10 | 3,5 |
| Onglet ouvert seul (Auto-Dig) | ≈ 14 | ≈ 9 | 1 | 1 | 1 | ≈ 1 | 0 |

Conséquence : la pierre est abondante (≈ 100/h), le charbon et le fer modérés (10–20/h), l'or et
les caisses rares (≈ 10/h). Une heure en Auto-Dig seul rapporte ≈ 10 fois moins qu'une heure
active : les coûts peuvent viser le jeu actif sans être triviaux pour un bot (le budget de dégâts
#25 borne déjà le crédit).

### 3. Proposition d'architecture (non implémentée)

**Principe : ressources tenues par le serveur, jamais par le navigateur** (cohérent avec #49 R1).

1. **Catalogue des ressources** (fichier versionné, administrable comme #37) : une ressource =
   `id`, icône/image, noms FR/EN/NL/ES, catégorie (`pierre`, `minerai`, `bois`, `special`),
   plafond de stock. Correspondance **bloc → ressource** par un champ facultatif `yields` du
   catalogue de blocs (`{ resource: 'pierre', qty: 1 }`), absent = rien. Recommandation de
   regroupement pour éviter 22 compteurs :
   - **Pierre** ← pierre, grès, granite ; **Argile** ← terre meuble, argile ;
   - un minerai = une ressource (charbon, fer, or, quartz, obsidienne, argent, platine, fer
     météorique) ;
   - **Planches** ← vieille caisse (1), coffre en bois (2) ; **Ferraille** ← coffre en fer (1) ;
   - **gemmes exclues** : elles sont déjà une monnaie (💎) ; un second compteur serait redondant.
2. **Tables** (ajouts purs, migration idempotente `CREATE TABLE IF NOT EXISTS`, aucune donnée
   existante touchée) :
   - `player_resources(user_id, resource_id, qty, updated_at, PRIMARY KEY(user_id, resource_id))` ;
   - `resource_ledger(id, user_id, resource_id, delta, reason, ref, created_at)` — chaque crédit
     ou dépense, pour l'historique, l'audit admin et l'idempotence (`ref` unique pour une
     construction) ;
   - plus tard : `player_buildings(user_id, building_id, level, built_at)` et un catalogue de
     bâtiments versionné (même modèle brouillon → publié → révisions que #37/#56).
3. **Crédit** : dans `badges.processSave`, après le calcul des blocs validés `n` par type, ajouter
   `n × yields.qty` à la ressource correspondante, dans la même transaction, plafonné au stock
   maximal. Garde-fous repris tels quels : rien sans mètre validé, rafale > 2 000 blocs ignorée
   (comme #56), départ à zéro (aucun crédit rétroactif).
4. **Dépense** : `POST /api/buildings/:id/upgrade` transactionnel côté serveur (vérifie les stocks,
   décrémente, écrit le registre, augmente le niveau), même schéma que l'achat des coffres
   (`server/chestShop.js`). Le navigateur ne fait qu'afficher.
5. **Interrupteurs** dans `admin_config` : `resources_enabled` et `buildings_enabled`, **désactivés
   par défaut** ; un mode TEST réservé à une liste de pseudos (comme #56) pour la recette.
6. **Saisons** : par défaut, recommandation **stocks et bâtiments permanents** (comme les
   fragments et reliques), effets **plafonnés et sans lien direct avec la profondeur** pour ne pas
   fausser le classement hebdomadaire (voir décision 1).

### 4. UX de l'inventaire (mobile 390 px et PC)

- **Pas de 7ᵉ bouton dans la barre du bas** (déjà 6 sur mobile) : un bloc **« 🎒 Inventaire »** en
  tête de la vue **Collection**, à côté des reliques, badges et événements, masqué tant que
  `resources_enabled` est faux.
- **Filtres en pastilles** : Tout · Pierre · Minerais · Bois · Spécial (une ligne défilante sur
  mobile, alignée sur PC).
- **Grille de tuiles** (3 colonnes mobile, 6 PC) : icône du bloc d'origine (bibliothèque #22/#40),
  nom, **quantité en stock** et barre de plafond discrète ; ressource jamais obtenue = tuile grise
  « ? » avec la profondeur d'apparition (incite à descendre sans dévoiler tout le catalogue).
- **Un seul compteur par ressource : le stock.** Le « total miné » historique n'est pas répété dans
  l'inventaire : il reste dans les badges (progression) ; la fiche détaillée d'une tuile peut
  l'afficher en petit (« miné depuis le … »).
- **Historique** : fiche d'une ressource → les 20 derniers mouvements du registre (« +2 planches —
  coffre en bois », « −40 pierre — Treuil niv. 1 »).
- **Notification** discrète au premier exemplaire d'une ressource (historique #26), jamais à chaque
  bloc (pas de bruit).

### 5. Le bois : origine et fonction

Pourquoi du bois dans une mine : les **étais** (soutènements), les caisses et l'outillage des
mineurs. Options classées (aucune n'est activée) :

| Option | Origine | Effort / risque | Avis |
|---|---|---|---|
| **A. Récupération sur les caisses** (recommandée) | vieille caisse → 1 planche, coffre en bois → 2 | aucun nouveau bloc ni drop : simple `yields` sur deux blocs existants ; les récompenses actuelles des coffres restent inchangées | ≈ 8–13 planches/h actives : rare sans être bloquant |
| **B. Étai abandonné** | nouveau bloc « étai de mine » (catégorie `bois`), 3–60 m, faible poids, via le catalogue #37 en brouillon | ajoute un bloc → change légèrement la répartition des drops (à simuler, #49) | donne une valeur aux premiers mètres de chaque saison (la profondeur repart à 0 le lundi) |
| C. Racines fossiles | rare en terre (1–15 m) | idem B | anecdotique, terre très rare après 15 m |
| D. Commerce / événement | échange de pierre contre bois, lot d'événement #56 | crée un taux de change à arbitrer | plus tard |

Fonction : **matériau de construction uniquement** (étais, charpentes), jamais converti en
pièces, gemmes ou fragments : pas de nouvelle porte d'inflation (#49).

### 6. Phase future : bâtiments (trois exemples, valeurs indicatives à simuler)

Règles proposées : 3 niveaux au plus au départ ; coût du niveau 1 ≈ 1–2 h de jeu actif, niveau 3 ≈
8–10 h cumulées ; effets **de confort ou plafonnés**, aucun effet direct sur la vitesse de descente
au-delà de quelques pour cent ; chaque bâtiment désactivable et ses chiffres modifiables par
l'admin.

| Bâtiment | Coût niv. 1 / 2 / 3 | Effet par niveau | Impact classement / économie |
|---|---|---|---|
| **⛏ Treuil (chevalement)** | 60 planches + 150 pierre / 120 pl. + 400 pierre + 40 fer / 200 pl. + 800 pierre + 100 fer | plafond des gains hors ligne 4 h → 5 / 6 / 8 h | pièces seulement, hors ligne déjà ≈ 10 × moins rentable que le jeu actif ; **aucun effet sur la profondeur** |
| **🔥 Forge** | 40 charbon + 30 fer + 100 pierre / 120 ch. + 80 fer + 20 or / 250 ch. + 150 fer + 60 or + 30 ferraille | −5 / −10 / −15 % sur le prix des améliorations de **pioche** (pièces) | accélère un peu le début de saison → **effet indirect sur la profondeur, à mesurer** avec le simulateur ; alternative sans risque : skins de pioche cosmétiques |
| **📦 Entrepôt** | 200 pierre + 30 planches / 500 pierre + 80 pl. + 30 fer / 1 000 pierre + 150 pl. + 80 fer | plafond de stock par ressource 500 → 1 000 / 2 500 / 5 000 | **aucun** effet économique : c'est le puits qui empêche l'accumulation infinie et donne une raison de construire |

Mesures à faire avant toute activation : rejouer `economy-sim.js` avec les effets (profondeur
médiane en fin de saison par profil, pièces/h), vérifier que l'écart de profondeur entre un joueur
« tous bâtiments niv. 3 » et un nouveau joueur reste sous un seuil fixé par le propriétaire
(proposition : ≤ 5 %).

### 7. Procédure de lecture / test

Rien à tester en jeu. Reproduire les chiffres de la section 2 (dans un worktree, `npm ci`) :

```bash
DB_FILE=test-52.sqlite node -e "const s=require('./tools/balance/economy-sim.js');for(const e of s.FIXED)console.log(e.label,s.hourAt(e,200).meters.mean)"
```

### 8. Vérifications effectuées et limites

- Lecture du code : `server/badges.js`, `server/monthlyEvents.js` (rapport #56), `public/js/blocks.js`,
  `gameState.js`, `save.js`, `index.html` (navigation), rapport #49.
- Requêtes **en lecture seule** sur la base de production (agrégats : nombre de comptes, compteurs
  de badges, catalogue publié). Aucune écriture, aucune donnée personnelle reprise ici.
- Simulateur #49 exécuté hors base (rythmes par type, 200 h par profil).
- Non fait (hors périmètre) : aucun code, aucune migration, aucun mockup interactif.
- **Impact sur les données des joueurs : aucun.**

### 9. Déploiement

**Aucun déploiement** : livrable documentaire uniquement, aucun changement du jeu. Version en
production inchangée.

### 10. Choix techniques faits seul

- Ressources côté serveur adossées au crédit validé de #38 (seule source fiable existante).
- Pas de crédit rétroactif, même à partir des compteurs de badges : ils prouvent l'activité, mais
  pas qu'elle doive devenir un stock (et créditer le seul compte actif serait arbitraire).
- Gemmes exclues de l'inventaire (déjà une monnaie).
- Inventaire dans la vue Collection plutôt qu'un nouvel onglet (place sur mobile).

### 11. Décisions demandées au propriétaire

1. **Portée des stocks et bâtiments** : (a) permanents, effets plafonnés sans lien avec la
   profondeur — *recommandé* ; (b) remis à zéro chaque saison comme les pièces ; (c) stocks
   saisonniers, bâtiments permanents.
2. **Origine du bois** : (A) planches récupérées sur les caisses — *recommandé pour démarrer* ;
   (A + B) ajouter ensuite un bloc « étai abandonné » en brouillon et simulé ; (D) seulement par
   événements.
3. **Premiers bâtiments** : Treuil + Entrepôt (sans effet sur le classement) — *recommandé* ; Forge
   seulement après simulation, ou en version cosmétique.
4. **Calendrier** : inventaire seul d'abord (affichage des stocks, sans dépense), après #49 R1
   (solde côté serveur) — *recommandé* ; ou attendre une spécification complète des bâtiments.

### 12. Restant à réaliser (après arbitrage, Après lancement)

1. Étape 1 — inventaire en lecture : catalogue des ressources, tables, crédit dans
   `processSave`, bloc « Inventaire » (désactivé par défaut, mode TEST), tests automatisés.
2. Étape 2 — bois selon la décision 2.
3. Étape 3 — catalogue de bâtiments administrable, dépense transactionnelle, simulation des
   effets, puis activation par le propriétaire.
