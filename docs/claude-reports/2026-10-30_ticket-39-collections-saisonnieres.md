# Ticket #39 — Collections saisonnières : objets, fiches narratives et édition admin

# Mise à jour du 31/10/2026, 22 h 30 (Bruxelles) — UX commune des Collections et création assistée par IA

Suite à la demande du propriétaire du 31/10 (commentaire 20:19 UTC, aussi publiée sur #37, #38 et #40) : les pages montrent d'abord les données, aucun formulaire d'ajout n'est visible par défaut, « ＋ Ajouter » ouvre une fiche, un clic sur une ligne ouvre sa fiche. Pour les collections : « Créer avec l'IA » ou « Créer manuellement ».

## A. État réel

**Déployé en production (SHA `5ad36b1`) — en attente de recette.** Classement : **Après lancement** (panel admin seulement, aucun effet sur les joueurs ; aucun drop activé, rien de publié).

## B. Changements

**Onglet 📿 Collections** (`public/admin/index.html`, `admin.js`, `admin.css`), sur le socle commun de #37 (`admDialogSetup`, `admDialogOpen`, `admRowOpen`) :
- La page s'ouvre sur le bandeau, la liste **Séries** puis la liste **Objets**. La liste des objets a une miniature (image ou emoji), un compteur et 3 filtres : texte, série, état (sans image, histoire incomplète, nouveaux ou modifiés, drop actif).
- Plus aucun formulaire visible. Les boutons « Modifier » et « Nouveau (vider) » sont retirés. Un clic, Entrée ou Espace sur une ligne ouvre sa **fiche**. Échap, ✕, Annuler ou un clic sur le fond la ferment **sans effet**, et le focus revient à la ligne.
- **« ＋ Ajouter »** (en haut à droite) propose 3 choix : **✨ Créer une collection avec l'IA**, **✍ Nouvelle série (manuel)**, **✍ Nouvel objet (manuel)**. Le choix IA est grisé si l'API n'est pas configurée.
- La fiche d'un objet est organisée en sections : Identité, Noms et histoires, Image, Drop (avec infobulle sur la chance). L'aperçu par langue est conservé. Nouveau bouton **🎨 Illustrer dans l'atelier**, qui ouvre l'atelier #40 sur l'objet : une image par action, jamais automatique.
- Après « Enregistrer », la fiche se ferme et un message de confirmation s'affiche sous le bandeau.
- Les cartes Brouillon et publication restent visibles. Versions, Images téléversées, Journal et l'aide « Comment ça marche ? » sont **repliés**.

**Création assistée par IA** (`server/collectionAi.js`, routes `/api/admin/collections/ai…`) :
- L'admin saisit une description libre, le nombre d'objets (3 à 8) et la saison (facultatif). L'IA fait **un seul appel texte** et propose :
  - une série : identifiant, noms FR/EN/NL/ES, emoji, thème ;
  - des objets : noms et **histoires** FR/EN/NL/ES dans le ton des 8 objets d'origine, rareté, emoji et **consigne d'illustration** ;
  - une courte justification.
- L'appel tourne **en arrière-plan** (environ 30 à 60 s, au-delà du délai de 60 s du proxy). La fiche affiche « ⏳ génération en cours » puis la proposition. Un appel interrompu par un redémarrage s'affiche comme tel. Rien n'est relancé automatiquement.
- **Fiche de relecture** : tous les champs sont modifiables. Un aperçu de la fiche joueur s'affiche par langue. On peut retirer un objet. Les problèmes sont signalés (identifiant déjà utilisé, langue manquante). « Enregistrer les corrections » ne fait aucun appel IA.
- **« Enregistrer dans le brouillon »** ajoute la série et ses objets au **brouillon** des collections, avec les mêmes validations que les fiches manuelles. **Rien n'est publié.** La publication reste le bouton « Publier » habituel.
- **Drops** : paramètres pré-remplis selon la rareté (barème proposé, **non validé**), toujours **inactifs**. La case « barème validé » reste obligatoire pour en activer un.
- **Images** : aucune n'est générée. La consigne d'illustration de chaque objet est transmise à l'atelier d'icônes. On y génère ensuite les images **une par une**, sur action explicite.
- **Infrastructure IA réutilisée de #37**, sans duplication : `blockAi.guardedJson` / `precheckText`. Clé côté serveur, un appel à la fois, quota de 40 appels par 24 h, plafond et journal partagés (source `admin-collections`, type `collection-text`).
- Les propositions déjà faites sont des données. Elles sont listées dans une carte repliée « ✨ Propositions IA », absente s'il n'y en a aucune.

**Base** : nouvelle table `collection_ai_proposals` (création seulement, idempotente). Aucune table existante n'est modifiée.

## C. SHA, tests, déploiement

- Branche `feature/39-collections-saisonnieres`, commit `425bfd5`. **`develop` = `5ad36b1`** (fusion). **Déployé : `5ad36b1`.**
- `npm test` : **392/392** sur la branche, sur `develop` et sur la release. Ce total inclut 8 nouveaux tests (`test/collection-ai.test.js`, transport IA factice, aucune dépense) :
  - nettoyage de la proposition, identifiants uniques, rareté inconnue ramenée à « commun » ;
  - drops inactifs pré-remplis ;
  - corrections sans appel IA ;
  - brouillon seulement, version publiée inchangée, consigne transmise à l'atelier ;
  - validations ;
  - échec IA sans écriture au catalogue, appel interrompu affiché ;
  - quota partagé ;
  - routes protégées (401) et parcours HTTP complet ;
  - contrôle statique de l'onglet (aucun champ hors fiche, un seul « ＋ Ajouter », lignes cliquables, fermeture sans effet).
  - Lors de l'intégration, une première exécution a échoué sur `ranking-depth`. Cause : un serveur de test orphelin de ma propre exécution occupait le port 3110. Après son arrêt : 392/392.
- Chromium sur le serveur de test (port 3101), copie de la base de production, IA factice, en 1280×900 et 390×844 tactile :
  - aucun champ de création visible : seuls le filtre et la note de publication sont des outils ;
  - « ＋ Ajouter » puis Échap : **0 écriture**, le focus revient au bouton ;
  - Entrée sur une ligne ouvre la fiche, Échap la ferme et rend le focus à la ligne, **0 écriture** ;
  - parcours IA : proposition de 4 objets, correction du nom NL, aperçu en NL, ajout au brouillon. Résultat : 12 objets, version en vigueur toujours v1, drops inactifs ;
  - « 🎨 Illustrer » ouvre l'atelier sur l'objet, avec la consigne proposée ;
  - pas de débordement à 390 px ; 0 erreur JS (un 404 sur le bureau, sans doute le `favicon.ico` de l'admin déjà connu).
- Release sur une copie de la base de production (`NODE_ENV=production`, port 3122) : santé OK, `1.0.0+5ad36b1`, **empreintes des 6 tables joueurs identiques** avant et après le démarrage, `quick_check` ok, nouvelle table créée vide.
- Avant le déploiement : aucune génération IA en cours (dernier appel à 16:26 UTC).
- Déploiement : avance rapide de `main` `27f5be2` → `5ad36b1`. Sauvegarde vérifiée : `~/backups/dig/dig-20261031-222923-pre-deploy-5ad36b1.sqlite`. Lock inchangé, donc pas de `npm ci`.
- En production :
  - les 2 domaines répondent 200 avec `1.0.0+5ad36b1` ; `/api/admin/collections/ai` sans clé répond 401 ;
  - journal sans erreur, `quick_check` ok ;
  - **empreintes joueurs identiques à la sauvegarde** ; catalogue public toujours v1 avec 8 objets ;
  - Chromium 1280 et 390 sur `/` et `/admin/` : 0 erreur, les 5 fiches Collections sont présentes.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 27f5be2` puis `sudo systemctl restart dig`. La table ajoutée est simplement ignorée par l'ancienne version.

Captures : [liste 1280](img/2026-10-31_ticket-39-ux-desktop-list.png), [choix « Ajouter »](img/2026-10-31_ticket-39-ux-desktop-add.png), [relecture de la proposition IA](img/2026-10-31_ticket-39-ux-desktop-proposal.png), [après ajout au brouillon](img/2026-10-31_ticket-39-ux-desktop-after-draft.png), [nouvel objet 390](img/2026-10-31_ticket-39-ux-mobile-new-item.png), [proposition 390](img/2026-10-31_ticket-39-ux-mobile-proposal.png).

## D. Test fonctionnel à faire par le propriétaire (Admin → 📿 Collections, PC puis smartphone)

1. La page montre le bandeau, les Séries et les Objets avec miniatures. **Aucun formulaire n'est visible.**
2. Cliquez sur « Fossile » : sa fiche s'ouvre (sections, aperçu). Fermez avec Échap : rien n'est modifié.
3. « ＋ Ajouter » affiche 3 choix. Cliquez sur **Annuler** : rien n'est créé.
4. « ＋ Ajouter » → **✨ Créer une collection avec l'IA**. Exemple de description : « trésors gelés de l'hiver, ton drôle et tendre », 6 objets, saison au choix. Cliquez sur « Proposer une collection ».
   - Coût : un appel texte, quelques centimes au plus, dans le plafond actuel. Aucune image n'est générée.
   - Après environ 30 à 60 s, la proposition s'affiche. Relisez les noms et histoires, changez la langue de l'aperçu, corrigez si besoin.
5. « Enregistrer dans le brouillon » : la série et ses objets apparaissent dans les listes, marqués « nouveau ». Le bandeau indique toujours la **version v1 en vigueur**. Les drops sont inactifs.
6. Facultatif : ouvrez un nouvel objet, puis « 🎨 Illustrer dans l'atelier ». La consigne proposée est pré-remplie. Ne générez que si vous le souhaitez (payant, une image).
7. **Ne publiez pas** si vous ne voulez pas que la série soit visible des joueurs. « Abandonner le brouillon » efface tout le brouillon, y compris d'éventuelles autres modifications en cours.

Résultat attendu : rien ne change pour les joueurs tant que vous ne cliquez pas sur « Publier ». Aucun drop n'est activé sans la case « barème validé ».

## E. Choix techniques faits seul

- **Appel IA en arrière-plan avec état visible** : un appel pour 6 objets en 4 langues peut dépasser les 60 s du proxy, et un redémarrage interrompt l'appel. Rien n'est relancé automatiquement, car une relance coûte.
- **Propositions conservées en base** (`collection_ai_proposals`) plutôt qu'écrites directement dans le brouillon : on peut relire et corriger avant tout ajout au catalogue, et une fiche fermée ne fait pas perdre un appel payé.
- **L'IA ne propose aucun taux de drop.** Les paramètres sont pré-remplis selon la rareté (barème proposé le 30/10, non validé) et restent **inactifs**. L'économie reste votre décision.
- **Images via l'atelier #40** plutôt qu'un second générateur : une image par action, retouche par consigne, budget et verrouillage déjà en place. Pas de logique en double.
- Refactorisation minimale de `blockAi.js` : l'appel JSON est extrait et partagé. Les blocs gardent le même comportement (tests block-ai inchangés et réussis).

## F. Décisions demandées au propriétaire

Aucune nouvelle décision pour ce lot. Les questions du 30/10 restent ouvertes :
1. Barème des drops saisonniers. Proposition : 6 objets par saison, 2 communs à 3 % dès 5 m, 2 rares à 1,5 % dès 40 m, 1 épique à 8 % sur coffre dès 60 m, 1 légendaire à 5 % sur gemme dès 100 m. Recommandation : oui.
2. Objets d'une saison terminée obtenables plus tard ? Recommandation : non (exclusivité).
3. Révéler en grisé les objets non trouvés après la fin de leur saison ? Recommandation : oui.

## G. Restant à réaliser

- Badges (#38) : même socle et création IA, traités dans leur ticket.
- Après lancement : favicon de l'admin (404 inoffensif) ; tri par colonne des listes de collections, comme pour les blocs, si utile.

---

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
