# Ticket #48 — Saisons thématiques automatiques : noms uniques, collections préparées et annonce anticipée

Lien : https://github.com/ReC82/Dig/issues/48 — session du 03/11/2026 (nuit).

## Mise à jour du 03/11/2026 (matin) : recettes #48-C, refonte de l'écran « Thèmes de saison » et promotions à petit effectif

### 1. État réel

**Intégré dans `develop` et déployé en production (SHA indiqué en section 6). En attente de recette.**
Branche : `feature/48-saisons-thematiques`. La lisibilité est un lot UX à part, **classé « Après lancement »** et non bloquant pour la pré-bêta. La recette de la bascule réelle (lundi 09/11 à 01:00, Bruxelles) reste à faire.

### 2. Ce que les recettes du propriétaire ont validé (03/11, 09:07 et 09:11)

Validé visuellement : saison actuelle 45-2026 « Boussoles et dés » ; saison suivante 2026-W46 « La Saison des Lanternes » préparée pour le lundi 09/11 à 01:00 ; collection Saint-Martin en brouillon, 0/6 images, drops inactifs ; classement de la ligue Mimosa correct (2 joueurs actifs).
Pas encore validé : la bascule, les drops, une promotion et une clôture.

### 3. Changements réalisés

**Panel admin, onglet 📊 Ligues & Saisons, carte « 🎭 Thèmes de saison »** : refonte complète de l'affichage. Aucune règle n'a changé.
- **Deux cartes, « Saison en cours » et « Prochaine saison »**. Chacune affiche une pastille d'état (En cours / À préparer / Préparée / Annoncée aux joueurs), le **thème en grand** avec son accroche, et des dates compactes en heure de Bruxelles (l'heure UTC du serveur apparaît au survol). Un **compte à rebours** se met à jour chaque minute.
- **Collection** : nom et pastille d'état **« Brouillon — non distribuée »**, « Publiée » ou « Aucune collection ». S'y ajoutent le nombre d'images (n/m) avec une jauge, la phrase « Invisible pour les joueurs, aucun drop actif tant qu'elle n'est pas publiée », et la liste repliée des objets sans image.
- **Les quatre étapes de la prochaine saison sont distinctes** : ✓ Préparer, • Illustrer (n images manquantes, coût estimé, lancement manuel), • Publier (décision manuelle dans Collections), • Annoncer (automatique à telle date). Aucune étape n'en déclenche une autre.
- **Action principale** : « 📚 Voir / préparer la collection ». Elle ouvre l'onglet Collections filtré sur la série, sans rien modifier. À côté, « 🎨 Illustrer (6 images) » ouvre l'atelier sans lancer de génération.
- **« Préparer maintenant »** n'apparaît que si la prochaine saison n'est **pas encore** préparée, avec une confirmation qui explique ce qui se passe (nom réservé, collection en brouillon, rien d'illustré, publié ni annoncé). Une saison déjà préparée affiche « Déjà préparée : une nouvelle préparation ne la remplacerait pas » (le serveur était déjà idempotent). L'ancien bouton permanent est supprimé.
- **Repliés par défaut** :
  - **Traductions** : tableau FR/EN/NL/ES, nom et accroche.
  - **Actions secondaires** : « Modifier les textes », plus, pour la prochaine saison seulement, « Tirer un autre nom » et « Autre nom et exclure celui-ci ». Une **confirmation** est demandée et le texte rappelle que l'ancien nom reste réservé.
  - **Détails techniques** : origine (« nom de repli », pack), numéro, semaine, série.
- **Réglages et détails avancés** (bloc replié) :
  - un **vrai commutateur** pour « Afficher thèmes et annonces aux joueurs » ;
  - des champs numériques bornés (3–14 jours, 0–168 h), chacun avec une aide courte et une **validation explicite** avant l'envoi ; seules les valeurs modifiées sont enregistrées ;
  - les mots exclus, les packs, le budget images et un **journal en clair** (« Saison suivante préparée », « Collection importée en brouillon »…).
- **Mobile 390 px** : cartes empilées, sans débordement horizontal.

**Onglet 🗓 Saisons** : nouvelle colonne **Thème** (ex. « 🧭 Boussoles et dés »). Les dates s'affichent **en heure de Bruxelles**, avec l'UTC en petit dessous (masqué sur smartphone) et au survol. La fiche d'une saison montre le thème et les deux heures. Les saisons antérieures au 02/11 n'ont pas de thème (« — »). Le bloc « Saison en cours » de Ligues & Saisons affiche aussi ses dates en Bruxelles (l'UTC au survol) : les deux onglets sont maintenant cohérents.

**Serveur** : `GET /api/admin/seasons` joint à chaque saison son thème (nom FR et icône, `null` s'il n'y en a pas). C'est une lecture seule (`seasonThemes.themesBySeason()`) ; une panne du module des thèmes ne masque pas la liste.

Fichiers : `public/admin/admin.js`, `public/admin/index.html`, `public/admin/admin.css`, `server/seasonThemes.js`, `server/index.js`, `test/season-themes.test.js`, `test/season-rotation.test.js`.

Avant :
![Avant, PC](img/2026-11-03_ticket-48-ux-avant-pc-theme.png)
Après, PC (détails repliés) :
![Après, PC](img/2026-11-03_ticket-48-ux-apres-pc-theme.png)
Après, smartphone 390 px :
![Après, mobile](img/2026-11-03_ticket-48-ux-apres-mobile-theme.png)
Prochaine saison pas encore préparée (état simulé sur une copie) :
![Non préparée](img/2026-11-03_ticket-48-ux-apres-pc-non-preparee.png)
Onglet Saisons, avant et après :
![Saisons avant](img/2026-11-03_ticket-48-ux-avant-pc-saisons.png)
![Saisons après](img/2026-11-03_ticket-48-ux-apres-pc-saisons.png)

### 4. Promotions à petit effectif : stratégie de recette (rien n'a été modifié en production)

**Constat** : le seuil « Joueurs actifs min par ligue » (`min_active_players_per_league`) vaut **10**, et Mimosa compte **2** joueurs actifs. À la clôture du 09/11, il n'y aura donc **aucun promu**. C'est le comportement attendu avec ce réglage, pas un défaut.

**Simulation isolée** : copie de la base de production en `/tmp`, vrai code de clôture (`closeActiveSeason`), copie supprimée ensuite.

| Seuil simulé | Joueurs éligibles dans Mimosa | Résultat |
|---|---|---|
| 10 (actuel) | 2 | aucun promu (2 < 10) |
| 3 | 2 | aucun promu (2 < 3) |
| 3 | 3 (2 réels + 1 joueur fictif) | 1/3 promu (50 %) vers Bronze, créée automatiquement : le 1ᵉʳ du classement |
| 2 | 2 | 1/2 promu (50 %) vers Bronze : le 1ᵉʳ du classement |

La formule est conforme à la règle #19 : `max(1, floor(actifs × 0,50 / (1 + niveau × 0,45)))`, donc au moins 1 promu par ligue éligible. Avec 3 joueurs : 1 promu en Mimosa, 1 promu en Bronze (34 %).

**Compromis** : un seuil bas permet de tester la promotion dès la pré-bêta, mais avec 2 ou 3 joueurs, monter en Bronze revient presque à « être premier d'une poignée de testeurs ». La ligue Bronze serait créée pour un seul joueur, qui s'y retrouverait seul la semaine suivante. Un seuil haut (10) protège la logique de ligue pour le lancement public, mais aucune promotion n'est testée avant.

**Stratégie proposée (au choix du propriétaire)** :
1. **Recommandé** : garder 10 en production. La promotion est déjà vérifiée par les tests automatisés et par cette simulation sur une copie. Si une recette en jeu est souhaitée, la faire **délibérément** : baisser le seuil à 3 la veille d'une clôture (onglet Config), avec 3 comptes éligibles (au moins un bloc manuel dans la saison), noter le rapport de clôture, puis **remettre 10** juste après. Une ligue Bronze créée ainsi reste en place : c'est un effet durable à accepter.
2. Baisser le seuil à 2 ou 3 jusqu'au lancement public. Les promotions ont alors lieu chaque semaine pendant la pré-bêta, et il faut penser à le remonter.
3. Ne rien tester en jeu avant d'avoir au moins 10 joueurs actifs.

### 5. SHA, procédure de test, vérifications

- Tests : `npm test` **519/519** sur la branche (dont 2 nouveaux contrôles : thème joint à chaque saison, `themesBySeason` limité aux saisons qui ont un thème).
- Navigateur (Chromium headless, copie de la base de production, port de test), en 1280×900 et 390×844 : 0 erreur JavaScript, 0 débordement horizontal. Parcours vérifiés :
  - « Voir / préparer la collection » ouvre Collections filtré sur `tresors_saint_martin` ;
  - un réglage hors bornes est refusé avec un message, « Aucun changement » s'affiche si rien n'a changé ;
  - « Tirer un autre nom » annulé ne change rien ;
  - prochaine saison non préparée : le bouton « Préparer maintenant » apparaît ; s'il est annulé, rien ne change ; s'il est confirmé, la saison est préparée.
- Données joueurs : aucune modification. Pas de migration ni de nouveau réglage, et aucun contenu publié n'a changé.

### 6. Déploiement

Voir la section « Déploiement du 03/11 (matin) » ajoutée en fin de mise à jour.

**Test fonctionnel à faire par le propriétaire (lecture seule, ≈ 3 min)** :
1. Admin → 📊 Ligues & Saisons → « 🎭 Thèmes de saison ». Attendu : deux cartes. À gauche, « En cours » et « 🧭 Boussoles et dés », fin lun. 09/11/2026 00:59 avec un compte à rebours. À droite, « Préparée » et « 🏮 La Saison des Lanternes », début lun. 09/11/2026 01:00, collection « Brouillon — non distribuée », 0/6, étapes Préparer ✓ / Illustrer / Publier / Annoncer (automatique le dim. 08/11 01:00).
2. Survoler une date : l'heure UTC s'affiche.
3. Ouvrir « Traductions », puis « Détails techniques » : FR/EN/NL/ES, puis l'origine « pack de saison rédigé ».
4. Cliquer « 📚 Voir / préparer la collection » : l'onglet Collections s'ouvre, filtré sur la série Saint-Martin. Ne rien publier.
5. Onglet 🗓 Saisons : colonne Thème (« 🧭 Boussoles et dés » sur la saison 45) et dates en Bruxelles, avec l'UTC dessous.
6. Sur smartphone : mêmes écrans, sans défilement horizontal de la carte.
À éviter en recette de consultation : « Préparer maintenant » (absent tant que la saison est préparée), « Tirer un autre nom », « Clore la saison ».

### 7. Choix techniques faits seul

- Repli par `<details>` natifs plutôt que par onglets : aucune dépendance, accessibles au clavier, cohérents avec le reste du panel.
- Le bouton « Préparer maintenant » n'est affiché que s'il a un effet. Les « Autre nom » demandent une confirmation, parce qu'ils consomment un nom à vie.
- Le thème de l'onglet Saisons est joint côté serveur, dans une lecture seule protégée par `try`, plutôt que par un second appel du navigateur.
- Aucune donnée, règle, calendrier, seuil ou barème n'a été touché, comme demandé.

### 8. Décisions demandées au propriétaire

1. **Seuil de promotion en pré-bêta** : (a) garder 10 et, si souhaité, faire une recette délibérée à 3 puis remettre 10 ; (b) 2–3 jusqu'au lancement ; (c) ne rien tester avant 10 actifs. **Recommandé : (a).** Aucun changement sans votre écrit.
2. (Reprise) **Illustrer, puis publier, la collection Saint-Martin avant le 09/11 ?** Coût : ≈ 0,72 $, une image par objet. Sans réponse, le thème s'affiche seul et la collection reste en brouillon.
3. (Reprise) **Un 4ᵉ pack rédigé pour la S48 (23–29/11) ?** Sinon, nom de repli sans collection. Recommandé : un pack de plus.

### 9. Restant à réaliser

- Recette réelle de la bascule du lundi 09/11 01:00 (Bruxelles) : nouveau thème, annonce J-1, saison suivante préparée dès J-7. *Bloquant MVP : non, mais à vérifier.*
- Illustration et publication des collections : décision du propriétaire (question 2).
- Recette de promotion en jeu : selon la décision 1.

---

## Session de la nuit du 03/11/2026 (livraison initiale, 61a5cbc)

## 1. État réel

**Déployé en production (SHA `61a5cbc`). En attente de recette.**
Branche `feature/48-saisons-thematiques` (`f643c77`), intégrée dans `develop` (`61a5cbc`).

## 2. Diagnostic « Mimosa » (demande prioritaire du 03/11)

**Mimosa est la ligue de départ (niveau 0), pas le nom de la saison.** Cela confirme l'audit #19.
- La table `leagues` de la production ne contient qu'une ligue, Mimosa 🌼. Personne n'a jamais été promu : il y a un seul joueur actif par semaine, alors que le seuil est de 10.
- La rotation des saisons fonctionne. La production compte 8 saisons, toutes avec un nom différent (« Saison 45-2026 » est active jusqu'au 08/11 23:59:59 UTC).
- Le vrai défaut était ailleurs : l'onglet Saison n'affichait aucun nom de thème. On n'y voyait qu'un badge de ligue sans libellé, d'où la confusion.

Mimosa n'a pas été renommée, et aucune ligue ne change de nom chaque semaine.

## 3. Résultat et changements

### Ce que voit le joueur (onglet 🏆 Saison)
- **Carte « Thème de la semaine »** : icône, nom inédit, accroche dans la langue du joueur (FR/EN/NL/ES), puis la période « Du … au … » en heure locale. Le numéro « Saison 45-2026 » reste dans le titre.
- **Ligue étiquetée** : « Ligue : 🌼 Mimosa · palier 1 ». Une infobulle explique que la ligue est un palier durable et que le thème change chaque semaine.
- **Annonce « Prochaine saison : [nom] »** : affichée **24 h avant** le début avec son accroche et la date. La collection n'y est citée (nom et nombre d'objets seulement) que si l'admin l'a **publiée**. Aucune probabilité ni aucun objet secret n'est montré.
- **Point discret** sur le bouton Saison tant que l'annonce n'a pas été vue (aucune fenêtre surgissante). Au changement de saison, la notification devient « Nouvelle saison : Saison 46-2026 · La Saison des Lanternes ! ».
- **Historique replié « Saisons précédentes »** : les 6 dernières saisons avec leur numéro, leur thème et leurs dates.

![Onglet Saison, smartphone 390 px (copie de production, annonce forcée à 168 h pour la capture)](img/2026-11-03_ticket-48-mobile-saison.png)

### Ce qui se fait automatiquement (sans IA, sans dépense, sans intervention)
Le nouveau module `server/seasonThemes.js` est appelé par le planificateur chaque minute, après la rotation, et par `GET /api/seasons/current`.
1. **Saison suivante préparée dès qu'elle débute dans moins de 7 jours** (réglable de 3 à 14 jours). En rythme hebdomadaire, cela veut dire dès le début de la saison en cours, donc toujours au moins à J-3.
2. **Source du thème** :
   - en priorité, un **pack de saison** rédigé à l'avance (`server/content/seasons/*.json`) : nom, accroche en 4 langues et collection complète ;
   - à défaut, un **nom de repli déterministe** : deux mots d'un lexique traduit de 36 entrées, choisis à partir du numéro de semaine (630 paires, puis des triplets). Ce cas ne fournit pas de collection.
3. **Collection d'un pack** : elle est versée dans le **brouillon** du catalogue en réutilisant le moteur #39 (`importPack`), drops **inactifs** et **jamais publiée** automatiquement. Les consignes d'illustration de chaque objet vont dans l'atelier #40, sans générer d'image. Au début de la saison, la série est rattachée à cette saison dans le brouillon.
4. **Saison commencée sans thème préparé** (déploiement en cours de semaine, clôture exceptionnelle #44) : elle reçoit un nom de repli, sans collection. C'est le cas de la saison actuelle, « Boussoles et dés ».
5. **Archivage** : à la clôture, le thème passe en « archivé » et reste visible dans l'historique.

### Unicité durable
- Chaque nom attribué est inscrit dans le registre `season_theme_names`, dont la clé primaire est le nom normalisé : accents, casse, articles et ordre des mots ignorés (« Taupes et Lanternes » = « lanternes ET taupes »). Une clé n'est **jamais supprimée ni réattribuée**, même après un rejet ou un renommage. La clé primaire garantit l'unicité même en cas d'accès simultanés.
- Les noms de ligues (Mimosa, Bronze, Argent…) sont refusés comme noms de thème.
- L'admin peut **exclure des mots ou des noms** : tout nom contenant tous les mots d'une exclusion est écarté.

### Panel admin (onglet 📊 Ligues & Saisons → carte « 🎭 Thème — saison actuelle / saison suivante »)
- Saison actuelle et saison suivante : bornes (heure de Bruxelles), nom en 4 langues, accroche, origine (pack ou repli), état.
- Collection : brouillon ou publiée, images présentes/manquantes, liste des objets sans image, coût estimé. Un bouton **« Illustrer la collection »** ouvre l'atelier d'icônes, qui génère une image par objet en série (#40), sous le plafond déjà administré.
- Dates de préparation et d'annonce.
- Actions facultatives : « Modifier », « 🎲 Autre nom », « 🚫 Autre nom et exclure celui-ci », « Préparer la saison suivante maintenant ».
- Section repliée : réglages (`season_themes_public`, `season_prep_days`, `season_announce_hours`), mots exclus, packs disponibles ou utilisés, dépense d'images, journal.

![Panel admin, carte des thèmes (copie de production)](img/2026-11-03_ticket-48-admin-themes.png)

### Contenu préparé (rédigé selon la ligne éditoriale #39, un clin d'œil réel différent par objet)
| Pack | Semaine | Collection (6 objets chacune) |
|---|---|---|
| 🏮 **La Saison des Lanternes** | 2026-W46 (09–15/11, contient le 11/11) | Les Trésors de la Saint-Martin : lanterne en betterave, plume de l'oie bavarde, lampion qui chantait faux, bonbon du porte-à-porte, fer du cheval de Martin, demi-manteau de Martin (légendaire) |
| 🎭 **La Saison des Géants** | première semaine libre (S47) | Les Affaires des Géants : bouton de veste, peigne de la Géante, ruban des noces de Gouyasse (Ath), osier fatigué, fronde de David, crinière du cheval Bayard (légendaire) |
| 🎁 **La Saison de Saint-Nicolas** | 2026-W49 (30/11–06/12) | Le Chemin de Saint-Nicolas : carotte de l'âne, chaussure près de la cheminée, spéculoos décapité, mandarine voyageuse, mitre trop grande, crosse dorée (légendaire) |

La semaine 48 (23–29/11) n'a pas de pack. Elle recevra donc un nom de repli, sauf si un pack est ajouté d'ici là.

Les 18 objets ont un nom et une histoire dans les 4 langues, une rareté et une consigne d'illustration propre à chacun. Les références réelles (Binche, Ath, Termonde, Saint-Martin, Saint-Nicolas) sont exactes, et les anecdotes inventées sont présentées comme légende ou rumeur. La relecture #39 et le détecteur de conflit de sujet #40 passent sans alerte : au premier essai, trois consignes citaient « orange » ou « ribbon », qui sont des noms d'autres objets, et elles ont été reformulées.

### Fichiers
`server/seasonThemes.js` (nouveau), `server/content/seasons/*.json` (3 packs), `server/seasons.js` (planificateur et réponse joueur), `server/collectionAi.js` (extraction de `importPack`, comportement inchangé), `server/index.js` (initialisation, validation des réglages, 6 routes admin), `public/js/main.js`, `public/js/i18n.js` (FR/EN/NL/ES), `public/css/style.css`, `public/admin/{index.html,admin.js,admin.css}`, `test/season-themes.test.js`.

## 4. SHA et procédure de test

- `develop` : `61a5cbc` · branche `feature/48-saisons-thematiques` (`f643c77`).
- `npm test` : **460/460**. `node --test test/season-themes.test.js` : 6 tests. Ils couvrent :
  - l'horloge simulée ;
  - **53 saisons** consécutives jusqu'au passage à l'heure d'hiver 2027, toutes avec un nom différent ;
  - chaque pack utilisé une seule fois et à sa semaine ;
  - l'annonce exactement à J-1 (ni une seconde avant, ni la collection tant qu'elle n'est pas publiée) ;
  - le fuseau de Bruxelles au changement d'heure : annonce à 02:00 heure d'été, début à 01:00 heure d'hiver ;
  - le redémarrage (`initDb` rejoué) sans doublon ;
  - les collisions (nom déjà utilisé, nom de ligue, mot exclu) ;
  - l'édition refusée sans aucune modification (atomicité) ;
  - « Autre nom » ;
  - **aucun appel IA ni réseau, 0 appel d'image** ;
  - une panne du module de thèmes qui ne bloque ni la rotation ni la réponse saison ;
  - le masquage complet par réglage.

## 5. Vérifications, limites, impact sur les données

- Essai navigateur (Chromium headless) sur une copie de la base de production avec un joueur de test, en 1280×900 et 390×844 : thème, annonce, ligue étiquetée, historique et point de nouveauté corrects ; aucun débordement horizontal ; aucune erreur JavaScript ; carte admin complète. Copie et serveur supprimés ensuite.
- **Données joueurs** : aucune ligne modifiée. Migration additive uniquement : 3 tables nouvelles (`season_themes`, `season_theme_names`, `season_theme_events`) et 3 réglages ajoutés.
- **Brouillon des collections (production)** : une 3ᵉ série, « Les Trésors de la Saint-Martin », s'est ajoutée aux deux séries déjà en brouillon. Rien n'est publié et les drops sont inactifs. Attention : une publication **globale** du brouillon avec « publier même incomplet » emporterait aussi cette série. La publication ciblée par série (#39) reste la voie recommandée.
- Limites :
  - pas de génération de thème par IA : ce n'est pas nécessaire, il y a les packs et le repli, et aucune dépense n'est autorisée ;
  - pas de génération automatique des images : lancement manuel en un clic pour toute la collection ;
  - le centre d'actualités (cloche, #50) n'est pas fait : l'annonce vit dans l'onglet Saison et `publicView()` est réutilisable par #50 ;
  - le repli ne fournit pas de collection.

## 6. Déploiement

- SHA déployé : **`61a5cbc`** (précédent : `cfa125c`). Sauvegarde vérifiée : `~/backups/dig/dig-20261103-035223-pre-deploy-61a5cbc.sqlite`.
- Avant le déploiement :
  - release : 460/460 ;
  - copie de la base de production démarrée en `NODE_ENV=production` (port 3122) : `/health` ok, version `61a5cbc` ;
  - empreintes `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking` identiques avant et après le démarrage ;
  - aucune génération IA en cours.
- Après le déploiement :
  - les deux domaines répondent 200 avec `1.0.0+61a5cbc` ;
  - journal sans erreur ; `quick_check` = ok ;
  - empreintes joueurs identiques à la sauvegarde ;
  - en production, la saison 45-2026 a reçu le thème « **Boussoles et dés** » et la saison 46 est préparée : « **La Saison des Lanternes** », annonce visible dimanche 08/11 à 01:00 (Bruxelles).
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep cfa125c` puis `sudo systemctl restart dig`. Aucune dépendance n'a changé. Les tables ajoutées, inertes, peuvent rester.

### Test fonctionnel pour le propriétaire (3 minutes)
1. Dans le jeu, onglet 🏆 **Saison** : le titre affiche « Saison 45-2026 », puis la carte « Thème de la semaine : 🧭 **Boussoles et dés** » avec les dates. La carte joueur indique « **Ligue : 🌼 Mimosa · palier 1** ». La ligue et le thème sont donc bien distincts.
2. Panel → **📊 Ligues & Saisons** → carte « 🎭 Thème ». À droite, « Saison suivante : 🏮 La Saison des Lanternes », collection « Les Trésors de la Saint-Martin — en brouillon », 0/6 images, début prévu lun. 09/11 01:00, annonce à partir du **dim. 08/11 01:00** (Bruxelles).
3. Facultatif, pour voir l'annonce tout de suite : dans « Réglages… », mettre `season_announce_hours` à `168`, enregistrer, puis recharger l'onglet Saison du jeu. La carte « Prochaine saison : La Saison des Lanternes » apparaît, avec un point sur le bouton Saison tant qu'elle n'a pas été vue. **Remettre 24 ensuite.**
4. Lundi 09/11 après 01:00 : le jeu affiche « Saison 46-2026 » avec le thème « La Saison des Lanternes ». L'historique contient « Saison 45-2026 · Boussoles et dés ».

**Classement MVP : Bloquant pré-bêta pour la partie affichage saison/ligue/thème (livrée). Après lancement pour les illustrations et la publication des collections.**

## 7. Choix techniques faits seul

- **Le numéro de saison reste l'identifiant ; le thème est une couche à part** : aucune réécriture de `seasons.name`, ni des classements ou des points qui y font référence.
- **Préparation dès J-7 au lieu de J-3** : le ticket demande « au moins trois jours avant » et le propriétaire a demandé de « préparer immédiatement ». Le minimum réglable reste 3 jours.
- **La saison en cours reçoit un nom de repli, pas un pack** : les packs (avec leur collection) sont réservés à des saisons annoncées à l'avance.
- **Packs rédigés plutôt qu'IA** : la règle « aucune dépense API sans budget explicite » s'applique, le résultat est déterministe et relu, et aucune panne réseau n'a d'effet.
- **Thème public, collection en brouillon** : les noms et accroches viennent de packs relus ou d'un lexique fermé, donc rien d'imprévisible n'est publié. Les collections et leurs drops restent à la décision du propriétaire.
- **Packs coupés en test** et si `DIG_PREPARED_COLLECTIONS=0`, comme pour les collections préparées.

## 8. Décisions demandées au propriétaire

1. **Collection de la saison des Lanternes (dès que possible, au plus tard pour le 09/11)** : illustrer les 6 objets (une image par objet, ≈ 0,72 $ estimés, sous ton plafond) puis publier la série, drops compris ? Ou la laisser en brouillon ?
   *Recommandation : illustrer, puis publier la série seule avec le barème proposé, si tu valides ce barème.* Sans réponse, rien n'est publié et le thème s'affiche seul.
2. **Semaine 48 (23–29/11)** : accepter un nom de repli sans collection, ou faut-il un 4ᵉ pack rédigé ?
   *Recommandation : un pack de plus, écrit lors d'une prochaine session.*

## 9. Restant à réaliser

- Centre d'actualités et cloche (#50), qui réutilisera `seasonThemes.publicView()`. Après lancement.
- Lancement automatique et facultatif des illustrations d'une collection préparée sous un budget dédié, puis publication automatique conditionnelle : à décider (décision 1). Après lancement.
- Génération IA de packs quand la réserve est vide, derrière un réglage et un budget explicites. Après lancement.
- Événements mensuels (#56) : indépendants des thèmes hebdomadaires.
