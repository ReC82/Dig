# Ticket #48 — Saisons thématiques automatiques : noms uniques, collections préparées et annonce anticipée

Lien : https://github.com/ReC82/Dig/issues/48 — session du 03/11/2026 (nuit).

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
