# Ticket #68 — Admin : catalogue de missions quotidiennes dynamiques, adaptées à la progression

Lien : https://github.com/ReC82/Dig/issues/68

## Session du 04/11/2026, soir (DIGORCH) — étape A : catalogue, rotation adaptative simulée, atelier d'icônes

### 1. État réel

**Déployé en production (SHA 6a359bd) — en attente de recette.** Étape A uniquement : outil d'administration et simulateur.

Le jeu n'est **pas** modifié : les joueurs gardent les six missions actuelles, calculées par leur
navigateur (`public/js/dailyMissions.js`, inchangé). Le nouveau catalogue sert à préparer, illustrer
et simuler les missions. Son activation en jeu (étape B) attend vos arbitrages de barème (§ 8),
comme le demande le ticket (« remonte les arbitrages de barème avant activation »).

### 2. Résultat visible

Nouvel onglet **Admin → 🎯 Missions** :

- **Liste d'abord** (aucun formulaire ouvert) : visuel, nom, identifiant et texte d'exemple, type,
  catégorie, objectifs par tranche de profondeur, récompense, poids, état. Recherche, filtres par
  type et par état (actives, archivées, modifiées dans le brouillon). Bandeau permanent : « le jeu
  n'utilise pas encore ce catalogue ».
- **« ＋ Ajouter une mission »** et clic sur une ligne → **fiche** en 6 sections : textes FR/EN/NL/ES
  (avec `{t}` = objectif et `{s}` = pluriel, aides ⓘ), identifiant stable, active/archivée ; visuel
  (emoji de repli, image de l'atelier) ; type, catégorie, poids de tirage, ancienneté min./max. ;
  objectifs par tranche de profondeur (« à partir de X m : 20, 40, 60 », tranches ajoutables) ;
  récompense (pièces par unité, gemmes, seuil des gemmes) ; **aperçu pour un joueur à 20, 100, 250
  et 500 m** (tirable ou non, avec la raison, objectifs possibles et récompense de chacun) et
  comparaison avec la version en vigueur. Boutons : Enregistrer dans le brouillon, **Dupliquer**,
  Annuler les modifications de cette mission, Retirer du brouillon (jamais publiée). Fiches protégées
  contre la perte de saisie (#61).
- **Brouillon → Publier… → versions → Revenir à cette version** et **journal** en ajout seul (comme
  les reliques #64). Une mission publiée ne se supprime pas : elle s'archive.
- **Rotation** : réglages affichés et modifiables dans le brouillon (mode origine/adaptatif, missions
  par jour, au plus N par catégorie, anti-répétition sur N jours avec un poids, rotation par joueur,
  journée de référence pour plafonner les objectifs, changement de jour navigateur ou Bruxelles).
  Bouton « Charger la proposition adaptative dans le brouillon… » (rien n'est publié).
- **Simulateur** (aucune écriture) : source version en vigueur / brouillon / proposition, date de
  départ, nombre de jours, profils Débutant 20 m, Régulier 100 m, Avancé 250 m, Très avancé 500 m.
  Pour chaque journée : les missions, ✓ si atteignables avec l'activité du profil, « déjà hier », et
  les missions écartées avec la raison ; puis taux d'atteinte, nombre de journées différentes,
  reprises de la veille, récompenses si tout est fait, fréquence par mission.
- **Atelier d'icônes** : nouvelle famille « Mission quotidienne », cible stable `mission:<id>`
  (distincte des pictogrammes d'interface #67). Depuis la fiche : « 🎨 Créer / refaire l'image dans
  Icônes » ouvre la fiche de l'atelier avec une consigne préremplie par type (ex. coffre ouvert pour
  « Chercheur de trésors ») ; génération **une par clic** ou téléversement ; « Conserver » place
  l'image dans le brouillon des missions ; « ← Retour à la fiche de la mission ».

Types proposés = **compteurs réellement tenus par le moteur**, chacun documenté (événement suivi,
validation, limite) : casser des blocs, gagner des pièces, ouvrir des coffres **minés**, acheter des
améliorations, trouver des gemmes, descendre de X mètres. Les demandes sans compteur (blocs cassés à
la main seulement, coffres achetés, fragments collectés, pioche à charges #71) sont affichées comme
« non disponibles » avec la raison.

### 3. Fichiers

- `server/missionCatalog.js` (nouveau) : tables `mission_catalog_versions` / `_draft` / `_audit`
  (ajout seul, déclencheurs anti-modification), version 1 = conversion à l'identique relue dans
  `public/js/dailyMissions.js` et `public/js/i18n.js`, validation, brouillon/publication/retour
  arrière, rotation d'origine (même hash et même générateur que le jeu), rotation adaptative,
  estimation d'activité (catalogue de blocs publié), aperçu et simulateur.
- `server/index.js` : 12 routes `/api/admin/missions…` (toutes protégées par `requireAdmin`), init.
- `server/iconStudio.js` : famille `mission`.
- `public/admin/index.html`, `admin.js`, `admin.css` : onglet, fiche, rotation, simulateur, retour
  depuis l'atelier.
- `test/mission-catalog.test.js` (10 tests), `test/e2e/missions-catalog.e2e.js` (essai navigateur).

### 4. SHA, branche et procédure de test

- Branche : `feature/68-missions-quotidiennes` ; SHA sur `develop` : **`6a359bd`** (fusion de `d605b89`).
- `npm test` (tout) ; ciblé : `node --test test/mission-catalog.test.js`.
- Essai navigateur : serveur de test (`PORT=3141 DB_FILE=test-68.sqlite NODE_ENV=test
  ADMIN_SECRET=… node server/index.js`), puis
  `PW=…/playwright-core BASE=http://127.0.0.1:3141 ADMIN=… node test/e2e/missions-catalog.e2e.js`.

### 5. Vérifications effectuées

- **Rotation d'origine identique au jeu** : pour 400 dates consécutives, le catalogue v1 donne
  exactement les mêmes 3 missions, objectifs et récompenses que `DailyMissions._generate` (test).
- Récompenses de la v1 identiques pour chaque objectif ; noms et textes FR/EN/NL/ES identiques.
- Validation (types, bornes, `{t}`, suppression refusée, archivage), brouillon, publication, version
  périmée refusée, retour arrière, tables en ajout seul (tests).
- Rotation adaptative : reproductible ; débutant 20 m sans mission « gemmes » (aucune gemme avant
  35 m) ; avancé 250 m sans « acheter des améliorations » (toutes au maximum) ; objectifs de la bonne
  tranche ; plafond à la journée de référence ; anti-répétition stricte sans reprise de la veille ;
  rotation par joueur différente d'un joueur à l'autre (tests).
- Atelier : cible `mission:open_chests`, image téléversée conservée dans le **brouillon** seulement,
  retour à l'emoji supprime le brouillon redevenu identique (test, sans génération payante).
- Routes : 401 sans session admin, aperçu, simulateur sans écriture (test HTTP, port 3194).
- Essai navigateur (Chromium, ordinateur 1280×900 et smartphone 390×844) : liste, « ＋ Ajouter »
  fermé sans rien créer, fiche + aperçu, atelier sans génération + retour, simulateur débutant/avancé
  sur 2 jours ; aucune erreur JavaScript ; aucune écriture.
- Non vérifié : génération réelle d'une image (payante, non lancée, une par clic si vous la faites).

**Impact données joueurs : aucun.** Trois tables nouvelles (ajout seul), aucune colonne ni ligne
existante modifiée ; sauvegardes et missions en cours intactes.

### 6. Déploiement

- SHA déployé : **`6a359bd`** (`main` avancé en avance rapide depuis `7a5eb04`), le 04/11 à 21:18
  (Bruxelles), par `scripts/deploy.sh` de la release.
- Avant : `npm ci` + `npm test` complet sur le SHA exact : **667/667 réussis** ; copie de la base de
  production démarrée en `NODE_ENV=production` (port 3122) : `/health` et `/api/version` OK, empreintes
  (lignes + hachage) de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`,
  `player_click_tracking` **identiques** après démarrage ; seules les tables `mission_catalog_*`
  sont ajoutées (version 1 = origine, aucun brouillon) ; copie supprimée.
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261104-211855-pre-deploy-6a359bd.sqlite`.
- Après : dig.lodygames.com et dig.lodylands.com → 200, `/api/version` = `1.0.0+6a359bd` ; journal
  sans erreur ; `pragma quick_check` = ok ; empreintes joueurs identiques à la sauvegarde ; jeu chargé
  dans Chromium (1280×900 et 390×844) sans erreur, missions du jeu inchangées (6 missions d'origine).
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 7a5eb04` puis `sudo systemctl restart dig`
  (aucune dépendance modifiée ; les tables ajoutées sont simplement ignorées par l'ancien code).

**Test fonctionnel à faire par le propriétaire (sans rien créer ni publier) :**

1. Admin → **🎯 Missions** : la liste des six missions s'affiche, aucun formulaire ouvert.
2. « ＋ Ajouter une mission » : la fiche vide s'ouvre avec l'aperçu 20/100/250/500 m ; « Fermer ».
3. Cliquer « Gemmologue » : section 6, « Débutant — 20 m » = **non — aucun bloc « gemme » à 20 m** ;
   à 100 m = oui. Fermer sans enregistrer.
4. « Chercheur de trésors » → « 🎨 Créer / refaire l'image dans Icônes » : fiche « Mission
   quotidienne » avec une consigne de coffre ouvert ; ne rien générer (ou une image si vous le
   souhaitez : elle ira seulement dans le brouillon) ; « ← Retour à la fiche de la mission ».
5. Simulateur : source **Proposition adaptative**, 2 jours, Débutant + Avancé → « Simuler ».
   Attendu : objectifs plus élevés à 250 m (ex. « Gagner 100000 pièces »), débutant sans gemmes,
   avancé sans « Acheter des améliorations », journées différentes. Recommencer avec la source
   **Version en vigueur** pour voir le jeu actuel (missions ✗ inatteignables chez le débutant).
6. Vérifier dans « Versions publiées » qu'il n'y a toujours que la version 1 et aucun brouillon.

Classement : **Après lancement** (le jeu actuel fonctionne ; l'adaptation améliore la rétention).

### 7. Choix techniques faits seul

- **Étape A sans activation** : le ticket interdit de modifier missions, récompenses ou rotation en
  production sans votre approbation après simulations ; le catalogue est donc préparé, versionné et
  simulé, mais le jeu ne le lit pas (`isLive() = false`). L'activation est l'étape B.
- **Même modèle que reliques/blocs** (brouillon unique, versions et journal en ajout seul, archivage
  au lieu de suppression) : comportement déjà connu dans le panel.
- **Récompense = pièces par unité d'objectif + gemmes à partir d'un seuil** : seule forme qui
  reproduit exactement les six formules actuelles (ex. coffres : 120 pièces/coffre, +1 💎 dès 4).
- **Rotation reproductible** : graine = date (+ identifiant du joueur si « par joueur »), historique
  des jours précédents pour l'anti-répétition (dégressif : la veille × poids, plus ancien : moins).
- **Journée de référence = 100 blocs** dans la proposition : le rapport #49 mesure 130 à 200 m/h de
  jeu actif (1 bloc = 1 m) ; 100 blocs ≈ 30 à 45 min. Les profils du simulateur : 60, 120, 170 et
  160 blocs/jour.
- **« Acheter des améliorations »** : le compteur du moteur inclut les achats de fragments et les
  relances de bloc ; la rotation adaptative ne compte que les niveaux réellement restants (pioche,
  Chance, Sac, Auto-Dig, fragments) et écarte la mission quand tout est au maximum.
- Aide IA pour les textes : non faite à cette étape (texte uniquement sur demande dans le ticket) ;
  la fiche est entièrement manuelle et traduisible.

### 8. Décisions demandées au propriétaire (avant activation, étape B)

Simulation sur 14 jours (5→18/11), même graine :

| Profil | Jeu actuel : atteignables | Proposition : atteignables | Récompenses si tout fait (actuel → proposition) |
|---|---|---|---|
| Débutant 20 m | 67 % | 100 % | 5 795 💰 + 5 💎 → 8 660 💰 + 0 💎 |
| Régulier 100 m | 86 % | 93 % | 9 295 💰 + 9 💎 → 29 740 💰 + 11 💎 |
| Avancé 250 m | 83 % | 100 % | 10 015 💰 + 9 💎 → 118 360 💰 + 14 💎 |
| Très avancé 500 m | 83 % | 100 % | 10 015 💰 + 9 💎 → 413 360 💰 + 14 💎 |

1. **Barème des objectifs par profondeur** (proposition visible dans le simulateur) : l'accepter tel
   quel, l'ajuster, ou garder les objectifs fixes actuels ? *Recommandation : accepter, les pièces
   en profondeur restant négligeables face aux revenus (≈ 2 M de pièces/jour à 250 m).*
2. **Gemmes des missions** : avec la proposition, un débutant sous 35 m ne gagne plus de gemmes par
   les missions (aujourd'hui « Trouver 2 gemmes » lui est demandé alors qu'il ne peut pas en
   trouver ; « Ouvrir 4 coffres » lui donnait +1 💎). Options : a) accepter ; b) donner +1 💎 aux
   coffres dès 3 ; c) ajouter un bonus « trois missions » (réglage `missionSetBonus` de #49).
   *Recommandation : a) ou c), à trancher avec #49.*
3. **Rotation** : par joueur (recommandé) ou la même pour tous ; changement de jour à minuit
   **Europe/Bruxelles** (recommandé, aligné sur le registre des gemmes) ou à minuit du navigateur.
4. **Activation (étape B)** : une fois 1 à 3 tranchés, autorisez-vous l'étape B — missions calculées
   et réclamées côté serveur (anti double réclamation F5/multi-appareils, historique par joueur),
   catalogue lu par le jeu derrière un drapeau, missions déjà attribuées du jour conservées ?

### 9. Restant à réaliser

- Étape B (après décisions) : attribution et réclamation côté serveur, historique par joueur,
  drapeau d'activation, affichage joueur des images du catalogue. **Après lancement.**
- Nouveaux compteurs pour les types indisponibles (blocs manuels, coffres achetés, fragments,
  pioche à charges #71). **Après lancement.**
- Aide IA pour les textes et variantes (sur demande). **Après lancement.**
