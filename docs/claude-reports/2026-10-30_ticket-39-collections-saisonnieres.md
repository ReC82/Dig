# Ticket #39 — Collections saisonnières : objets, fiches narratives et édition admin

Lien : https://github.com/ReC82/Dig/issues/39 — rapport du 30/10/2026 (session autonome digorch).

## 1. État réel

**Étape A déployée en production (SHA `80bd4a6`), en attente de recette.**
Aucun nouveau drop n'est activé. Les 8 objets d'origine tombent exactement comme avant ; seuls l'affichage et l'outil d'administration changent.

Classement : **« Après lancement »**. Le MVP fonctionne avec la collection d'origine. Ce lot ajoute la fiche joueur et l'outil qui permettra de créer une collection par saison.

## 2. Résultat et changements

### Pour les joueurs (onglet 📦 Collection)
- Les objets sont **groupés par série**. Les séries en cours apparaissent en premier : la série permanente « Collection des origines », puis la série de la saison du joueur. Viennent ensuite les **« 🗄 Archives des saisons passées »**. Une série archivée n'est visible que si le joueur en possède au moins un objet, et les objets acquis restent consultables pour toujours.
- **Toucher ou cliquer un objet ouvre une fiche détaillée** adaptée à l'écran. Elle contient :
  - une grande image (ou l'emoji) ;
  - le nom et la rareté ;
  - la série et la saison ;
  - « Trouvé le … » et la quantité ;
  - une **petite histoire originale et amusante**, écrite en FR, EN, NL et ES pour les 8 objets.
- **Objet inconnu** : la fiche affiche « Objet non découvert » avec une phrase d'encouragement. Elle ne montre ni le nom, ni la rareté, ni l'histoire, ni la profondeur. Si l'objet vient d'une saison terminée, la phrase indique « non trouvé à temps ».
- **Date et quantité** : elles sont enregistrées à chaque nouvelle trouvaille (`collectionMeta` dans la sauvegarde). Pour les objets trouvés avant cette mise à jour, la fiche affiche « Trouvé avant le suivi des dates » : **aucune date n'est inventée**.
- La langue suit le choix du joueur (FR/EN/NL). Les textes ES sont stockés et seront affichés dès que l'espagnol existera dans le jeu (#42). Si une traduction manque, le texte français s'affiche.

### Panel admin, onglet 📿 Collections
- **Séries** : création et modification avec identifiant, noms en 4 langues, icône et état actif. Une série est soit **permanente**, soit **rattachée à une saison** (liste des saisons).
- **Objets** : création et modification avec :
  - la série et la rareté ;
  - l'icône et l'image ;
  - les noms et les histoires en 4 langues ;
  - le drop : catégories de blocs sources, profondeur de départ (« dès X m »), chance par bloc en %, drop activé ou non ;
  - l'état actif.

  La liste se filtre et montre les langues manquantes.
- **Aperçu de la fiche** dans chaque langue, pendant la saisie.
- **Images** : téléversement PNG, JPEG ou WebP (350 Ko maximum). Le format est vérifié sur le contenu réel du fichier. Les images sont stockées **dans la base**, donc couvertes par les sauvegardes, et réutilisables via le bouton « Utiliser ».
- **Brouillon → publication → retour arrière**, sur le même modèle que l'onglet Blocs (#37) :
  - liste des changements champ par champ, erreurs et avertissements ;
  - note de publication ;
  - versions conservées, avec « Revenir à vN » ;
  - **journal d'audit en ajout seul**.
- **Garde-fou sur les drops** : un drop nouveau ou un barème modifié (chance, profondeur, blocs, série ou saison) s'affiche en rouge. La publication est **refusée** (par le panel et par le serveur) tant que la case « Barème validé : j'active ces drops » n'est pas cochée. La confirmation est inscrite au journal.
- Une série ou un objet déjà publié ne peut pas être supprimé, seulement désactivé.

### Technique
- `server/collectionCatalog.js` (nouveau) ; routes `GET /api/collections/catalog` et `GET /api/collections/images/<sha256>.<ext>` (publiques) ; routes `/api/admin/collections/*`, qui exigent `ADMIN_SECRET` (401 sans clé, testé).
- La **version 1** reprend les 8 trouvailles d'origine **à l'identique** : même ordre, mêmes blocs, mêmes profondeurs, mêmes chances. Un test rejoue 3 × 20 000 blocs et obtient les mêmes trouvailles aux mêmes blocs, avec et sans le catalogue publié.
- Jeu :
  - `collection.js` applique le catalogue publié (mémorisé localement) ;
  - un objet ne tombe que s'il est actif, que son drop est activé et que sa série est permanente ou de la saison en cours du joueur.
- Les coffres de la boutique continuent de donner uniquement les 8 objets d'origine (comme le serveur `chestShop.js`).
- Fichiers modifiés :
  - `server/collectionCatalog.js`, `server/index.js` ;
  - `public/js/collection.js`, `main.js`, `save.js`, `gameState.js`, `i18n.js` ;
  - `public/index.html`, `public/css/style.css` ;
  - `public/admin/index.html`, `public/admin/admin.js` ;
  - `test/collection-catalog.test.js` (nouveau, 7 tests).

## 3. SHA, branche, procédure de test

- Branche : `feature/39-collections-saisonnieres` (commit `3e7aae4`).
- **`develop` : `80bd4a6`** (fusion). Déployé : `80bd4a6`.
- `npm test` : **281/281** sur la branche et sur la release `80bd4a6` (dont 7 nouveaux tests).
- Essai navigateur sur un serveur de test (port 3101, base temporaire supprimée ensuite), sur ordinateur 1280×900 et smartphone 390×844 :
  - admin : création de la série « Trésors de l'hiver » (saison active) et de l'objet « Flocon éternel » avec une image téléversée ;
  - aperçu en ES ;
  - publication refusée sans « barème validé », puis acceptée (v2) ;
  - jeu : séries, fiche avec date, fiche d'un objet ancien « Trouvé avant le suivi des dates », fiche d'un objet inconnu, passage en archives après changement de saison, image affichée, NL.
  - Seule erreur console : un 404 dans le panel admin (le favicon, déjà connu).

## 4. Vérifications, limites, données joueurs

- **Migration uniquement additive** : 4 tables nouvelles (`collection_catalog_versions`, `collection_catalog_draft`, `collection_catalog_audit`, `collection_images`). Versions et journal sont en ajout seul (triggers). Aucune colonne ni sauvegarde n'est réécrite.
- Testée sur une copie de la base de production : empreintes identiques avant et après démarrage pour `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` ; `quick_check` ok ; copie supprimée.
- La sauvegarde réelle (7 objets sur 8) est inchangée et compatible : tous ses objets existent dans la v1.
- Limites :
  - les noms et histoires sont visibles dans le catalogue public (comme l'étaient déjà les 8 trouvailles dans le JS). L'interface ne les révèle pas, mais un joueur curieux peut les lire. Un masquage serveur est possible plus tard ;
  - le tirage reste calculé par le client, comme avant ;
  - une trouvaille ne tombe qu'une fois (règle d'origine), donc la quantité vaut 1 sauf nouvelle règle ;
  - la **génération d'images par IA depuis le panel** relève du ticket #40 (atelier d'icônes) : ce lot permet le téléversement.

## 5. Déploiement

- SHA déployé : **`80bd4a6`** (avance rapide de `main` de `1710147` à `80bd4a6`, avec `scripts/deploy.sh` de la release).
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261030-181624-pre-deploy-80bd4a6.sqlite`.
- Après déploiement :
  - dig.lodygames.com et dig.lodylands.com répondent 200, `/api/version` = `1.0.0+80bd4a6` ;
  - `/api/collections/catalog` = v1 (8 objets), `/api/admin/collections` sans clé = 401 ;
  - journal sans erreur, `quick_check` ok ;
  - empreintes joueurs identiques à la sauvegarde ;
  - Chromium sur la production (1280×900 et 390×844) : onglet Collection, ouverture d'une fiche, aucune erreur.
- Retour arrière :
  - code : `git -C /home/ubuntu/Dig reset --keep 1710147` puis redémarrage (l'ancien code ignore les 4 tables et le champ `collectionMeta`) ;
  - contenu : « Revenir à vN » dans l'onglet.

### Test fonctionnel à faire par le propriétaire (5 min)
1. **Jeu**, onglet 📦 Collection : ta série « 📦 Collection des origines · 7/8 ». Touche le Cristal bleu → fiche avec grande icône, « PEU COMMUN », « Trouvé avant le suivi des dates · Quantité : 1 » et une petite histoire. Touche l'objet « ??? » → « Objet non découvert », sans indice. Ferme avec « Fermer », un clic à côté ou Échap. Change la langue (EN/NL) : noms et histoires suivent.
2. **Admin** https://dig.lodygames.com/admin/, onglet **📿 Collections** : bandeau « v1 — 1 série, 8 objets, 8 drops actifs ».
3. Essai sans risque :
   - « Modifier » sur *fossil*, change l'histoire FR, regarde l'aperçu (sélecteur de langue), puis « Enregistrer l'objet dans le brouillon » → le changement est listé, rien ne change en jeu ;
   - crée une série « Test » rattachée à la saison active et un objet avec drop activé → encadré rouge « Drops nouveaux » ; « Publier » sans cocher → refusé ;
   - « Abandonner le brouillon ».
4. (Facultatif, visible des joueurs) publier une simple correction de texte, la vérifier en jeu après rechargement, puis « Revenir à v1 ».

Résultat attendu : tout fonctionne sans changer le jeu tant que rien n'est publié.

## 6. Choix techniques faits seul

- **Série « origines » permanente** pour la collection actuelle : elle ne disparaît pas à la fin de saison. Rien n'est effacé, l'historique n'est pas faussé, et les joueurs gardent leur progression 7/8.
- Le modèle de #37 (versions en ajout seul, brouillon unique, retour arrière qui publie une nouvelle version) est réutilisé, pour un comportement cohérent dans le panel.
- **Images stockées en base** plutôt qu'en fichiers : couvertes par les sauvegardes et le retour arrière, sans écriture dans le dossier servi. Elles sont adressées par empreinte SHA-256 (immuables, mise en cache longue) et contrôlées par signature binaire (pas de SVG téléversé, pour éviter le XSS).
- Il n'y avait pas de rareté pour les 8 objets : je l'ai fixée d'après leur difficulté réelle (fossile commun ; cristal et pièce peu communs ; relique, dent et carte rares ; couronne épique ; orbe légendaire). Affichage seul, modifiable dans le panel.
- `collectionMeta` est un champ facultatif de la sauvegarde, sans changement de version : les anciennes sauvegardes restent valides et aucune date n'est inventée.

## 7. Décisions demandées au propriétaire

1. **Barème des drops saisonniers** (aucun n'est activé).
   - Proposition pour une série de saison de 6 objets : 2 communs (chance 3 % sur pierre/terre dès 5 m), 2 rares (1,5 % sur minerai dès 40 m), 1 épique (8 % sur coffre dès 60 m), 1 légendaire (5 % sur gemme dès 100 m).
   - Options :
     - (a) valider ce barème ;
     - (b) donner le vôtre ;
     - (c) créer les séries vous-même dans le panel en cochant « barème validé ».
   - Recommandation : (a), saisi pour la saison suivante.
2. **Objets d'une saison terminée** : les rendre encore obtenables plus tard (dans des coffres « héritage », par exemple) ? Recommandation : non, pour l'exclusivité ; ils restent visibles dans les archives pour ceux qui les ont.
3. **Révéler les objets non trouvés après la fin de leur saison** (nom et image en grisé) ? Aujourd'hui ils restent « ??? ». Recommandation : oui, après la fin de saison seulement (petit changement).

## 8. Restant à réaliser

- Génération d'images IA pilotée depuis le panel : #40 (atelier d'icônes), qui pourra écrire directement dans `collection_images`.
- Liaisons :
  - #20 : coffres donnant des objets de la série de la saison (les coffres de la boutique donnent aujourd'hui seulement les 8 d'origine) ;
  - #38 : badges « série complète » ;
  - #31 : carte Saison, avec le rappel de la série en cours.
- Affichage ES quand la langue sera ajoutée au jeu (#42).
- Statistiques admin (nombre de joueurs possédant chaque objet), révélation après saison (décision 3), quantité > 1 si les doublons deviennent possibles.
