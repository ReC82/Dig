# Ticket #65 — Événements : générer et gérer les images IA des objets souvenirs dans le panel

Lien : https://github.com/ReC82/Dig/issues/65

## 04/11/2026 — livraison

### 1. État réel

**Déployé en production (SHA `7a5eb04`), en attente de votre recette.**
Classement : **Après lancement** (outil d'administration). Le MVP public n'en dépend pas : sans image publiée, le jeu affiche l'emoji comme avant.

Ce déploiement met aussi en ligne #64 (catalogue de reliques). Ce ticket était intégré dans `develop` le 04/11 mais n'avait pas été déployé, à cause d'un test instable sans rapport (`gem-ledger`). Cette fois, la release a passé les 657 tests.

### 2. Résultat et changements

**Comportement visible (admin)**
- **🎉 Événements → fiche d'un événement → clic sur un objet → section « Illustration »** :
  - l'état de l'image s'affiche : `Sans image`, `Proposition dans l'atelier`, `Conservée dans le brouillon` ou `Publiée`, avec ce que voit le joueur ;
  - un bouton **« 🎨 Créer une image avec l'IA »** ouvre la fiche de cet objet dans 🎨 Icônes ;
  - le bouton reste disponible quand l'événement est planifié (fiche en lecture seule) : il ne modifie que l'image.
- **Fiche Icônes de l'objet** (famille « Objet d'événement », filtre ajouté) :
  - préremplis et modifiables : nom FR/EN, description humoristique, thème de l'événement et consigne d'illustration préparée avec l'événement (champ « Consigne d'illustration ») ;
  - une image par clic sur « Générer », puis « Refaire », téléversement manuel, aperçu en taille réelle, historique et retour à une image précédente ou à l'emoji : tout cela vient de l'atelier #40 ;
  - « Conserver cette image » écrit l'image dans la **fiche de l'événement**, ce qui ajoute une révision. Les joueurs ne la voient pas encore ;
  - un bouton « ← Retour à la fiche de l'objet d'événement » ramène à la fiche.
- **Fiche de l'événement** : un bouton **« 🖼 Publier les images (N)… »** apparaît dès qu'une image de fiche diffère de l'image vue des joueurs. Une confirmation indique les objets concernés et les souvenirs déjà trouvés. Le statut, les dates, les testeurs et les drops ne changent pas.
- **Planifier** et **Démarrer le test maintenant** publient aussi les images de la fiche : ce sont des actions explicites de l'événement.

**Côté joueur**
- Collection → Souvenirs d'événements, les événements en cours et le message de trouvaille affichent **seulement l'image publiée**. Sans image publiée, l'emoji reste affiché. Une image conservée dans le brouillon n'est jamais montrée.

**Fichiers**
- `server/monthlyEvents.js` :
  - nouvelle table `monthly_event_item_images`, en ajout seul : l'image vue des joueurs ;
  - `publishImages`, `setItemImage`, `imageState`, `studioKey` ;
  - vue joueur et trouvailles basées sur l'image publiée ;
  - états des images et nombre de propositions dans la vue admin ;
  - migration unique : une image déjà présente sur une fiche devient l'image publiée, pour ne rien faire disparaître (aucune en production).
- `server/iconStudio.js` : nouvelle famille `event`, clé stable `event:<événement>/<objet>`, consigne par défaut, contrôle du sujet par rapport aux autres objets du même événement, « Conserver » écrit dans la fiche.
- `server/index.js` : route `POST /api/admin/events/:id/publish-images` ; les erreurs d'événement remontent proprement depuis l'atelier.
- `public/admin/index.html`, `public/admin/admin.js` : bouton, états, publication, retour, filtre.
- Tests : `test/event-images.test.js` (nouveau), `test/collection-ai.test.js` (adapté), essai navigateur `test/e2e/event-images.e2e.js`.

### 3. SHA, branche, procédure de test

- Branche `feature/65-images-souvenirs`, commit `5b36d05`. Fusion dans `develop` : `7a5eb04` (déployé).
- Tests automatiques : `npm test`. Le fichier `test/event-images.test.js` couvre :
  - cibles de tous les événements, sans mélange avec les collections ;
  - fiche préremplie ;
  - une image par action ;
  - image conservée invisible du joueur, puis visible après publication ;
  - retour à l'emoji ;
  - planification qui publie, sans changer le barème ;
  - Noël resté en brouillon ;
  - migration idempotente ;
  - routes protégées (401) et clé encodée dans l'URL.
- Essai navigateur (serveur de test démarré avec `DIG_AI_FAKE=1`, sur une copie de la base) :
  `PW=…/playwright-core BASE=http://127.0.0.1:3101 ADMIN=<secret> EVENT=<id> ITEM=<id> NAME="Caillou de test" node test/e2e/event-images.e2e.js`

### 4. Vérifications effectuées

- `npm test` :
  - branche : 656/657, le seul échec venait d'une assertion statique à mettre à jour (corrigée) ;
  - `develop` : 656/657 au premier passage (`gem-ledger` « 4 processus », instabilité connue, voir #64), puis 657/657 au passage complet suivant ;
  - **release `7a5eb04` : 657/657**.
- Chromium headless sur une copie de la base de production (port 3101, transport IA simulé, aucune dépense), à 1280×900 :
  - Caillou de test « Sans image » ;
  - bouton → fiche Icônes préremplie (thème « Test event », description), aucun appel à l'ouverture ;
  - Générer → 1 appel d'image, plus le contrôle du sujet habituel ;
  - Conserver → « Conservée dans le brouillon », image publiée toujours vide ;
  - « Publier les images (1) » → « Publiée », statut de l'événement inchangé ;
  - Noël toujours en brouillon.
- Même essai à 390×844 : fiche objet, bouton et fiche Icônes OK. Aucune erreur JavaScript.
- **Non fait** : aucune vraie génération d'image. Rien n'était demandé et le raccordement se valide sans dépense.

**Données des joueurs** :
- aucune donnée supprimée ni réécrite ; une table et une ligne de réglage ajoutées ;
- le souvenir « Caillou de test » déjà trouvé est conservé (1 trouvaille avant et après) ;
- aucun drop modifié, aucun événement planifié, aucun faux souvenir créé.

### 5. Déploiement

- SHA déployé : **`7a5eb04`** (avant : `5a32746`).
- Sauvegarde vérifiée avant déploiement : `~/backups/dig/dig-20261104-203725-pre-deploy-7a5eb04.sqlite`.
- Copie de production démarrée avec la release : `/health` OK, version OK. Empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` identiques avant et après démarrage. Migration appliquée (0 image à reprendre).
- Après déploiement :
  - les deux domaines répondent 200 avec `1.0.0+7a5eb04` ;
  - journal sans erreur, `quick_check` ok ;
  - empreintes identiques à la sauvegarde ;
  - l'admin servie contient le bouton et `eviOpenStudio`.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 5a32746` puis redémarrage. Seul le code change ; la table ajoutée est ignorée par l'ancien code.

**Test fonctionnel à faire par le propriétaire** (5 minutes, sans dépense) :
1. Ouvrez /admin/ avec Ctrl+F5, puis l'onglet **🎉 Événements**.
2. Ouvrez la fiche « Événement test », cliquez sur **Caillou de test**, puis descendez jusqu'à « Illustration ».
   Attendu : `🖼 Sans image — Les joueurs voient l'emoji`, et le bouton **« 🎨 Créer une image avec l'IA »**.
3. Cliquez sur le bouton.
   Attendu : l'onglet 🎨 Icônes s'ouvre sur « Caillou de test », famille « Objet d'événement · 🧪 Événement test (TEST, brouillon) ». La consigne d'illustration est préremplie (« a collectible souvenir of the "Test event" event » et la description). **Aucune image n'est générée.**
4. « ← Retour à la fiche de l'objet d'événement » ramène à la fiche.
5. Même vérification sur un objet de **Noël** (brouillon public) : consigne préparée (« A single glossy lump of black coal… »). Noël reste en brouillon.
6. Facultatif (1 image payante) : Générer → Conserver. La fiche passe à « Conservée dans le brouillon » ; en jeu, le testeur voit toujours l'emoji. Ensuite, dans la fiche de l'événement, « 🖼 Publier les images (1)… » met l'image en jeu (rechargez Collection → Souvenirs d'événements).

### 6. Choix techniques faits seul

- **Image de la fiche ≠ image publiée.** La colonne `image` des objets reste celle de la fiche. L'image vue des joueurs est stockée dans une table à part, en ajout seul. Ainsi, le souvenir d'un événement TEST repassé en brouillon (le cas de « Caillou de test ») ne montre jamais une proposition non validée.
- **Publication = « Publier les images » ou Planifier / Démarrer le test.** Le ticket demande une publication « par l'action explicite » de l'événement. Un bouton dédié permet d'illustrer les souvenirs d'un événement terminé ou en brouillon sans le replanifier.
- **Image modifiable sur un événement planifié.** Seule l'image de la fiche change, avec une révision et une ligne au journal. Le barème, les dates et les drops restent figés. Le joueur ne voit rien avant la publication.
- **Clé `event:<événement>/<objet>`.** Elle reprend les identifiants stables de #56, qui ne sont jamais réutilisés : un objet trouvé ne peut ni disparaître ni changer d'identifiant. Elle est encodée dans les URL de l'atelier.
- **Contrôle du sujet.** Il compare avec les autres objets **du même événement** : une consigne qui demande un autre objet de l'événement est refusée avant toute dépense, comme pour les collections et les reliques.
- **Consigne modifiée dans l'atelier.** Elle est enregistrée pour cette cible dans l'atelier (comme pour les objets de collection). Le champ « Consigne d'illustration » de l'événement reste la valeur par défaut.

### 7. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire.

### 8. Éléments restant à réaliser

- (Après lancement) Le test `test/gem-ledger.test.js` « 4 processus » reste instable sous charge. Il a bloqué le déploiement de #64 et a encore échoué une fois aujourd'hui en intégration. À fiabiliser dans #17 ou #49 (attendre le verrou SQLite, ou afficher le motif dans l'assertion).
- (Après lancement, suggestion) Dans la fiche objet, l'« Aperçu joueur » montre l'image de la fiche même si elle n'est pas encore publiée. Le badge d'état le précise, mais l'aperçu pourrait aussi être marqué « brouillon ».
