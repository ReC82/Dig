# Ticket #61 — Admin : empêcher la perte de modifications dans tous les formulaires

- Ticket : [#61 — [P1] Admin — empêcher la perte de modifications dans tous les formulaires](https://github.com/ReC82/Dig/issues/61)
- Session : 03/11/2026 (soir), DIGORCH
- Liens : #39 (cas reproduit : fiche de série Collections), #57 (protection déjà livrée), #50 (composant `admConfirm()` réutilisé), #56 (fiches Événements), #60 (boutons Rafraîchir)

## 1. État réel

**Déployé en production (SHA `f1c3bcb`) — en attente de recette.**
Panel admin uniquement (HTML/CSS/JS du panel). Aucune migration, aucune route serveur modifiée, aucune donnée de joueur touchée.

## 2. Résultat et changements réalisés

### Comportement visible

- **Toutes les fiches du panel** (27 `<dialog>` : Saisons, Ligues, Concours, Boutique, Blocs, Collections — séries, objets, IA, relecture de proposition —, Badges, Bêta, Actualités, Événements, révisions…) :
  - fiche **sans modification** : ✕, Annuler, clic à côté, Échap la ferment comme avant ;
  - fiche **modifiée** : ✕, Annuler, clic à côté, Échap ou « ouvrir l'atelier d'icônes » affichent une boîte de confirmation Dig, dans le thème sombre du panel : **« Modifications non enregistrées »**. Les deux choix sont **« Continuer à modifier »**, qui a le focus par défaut (Échap et clic à côté reviennent à ce choix), et **« Abandonner les modifications »** (bouton rouge). La boîte indique aussi le vrai libellé du bouton d'enregistrement de la fiche, par exemple « Enregistrer la série dans le brouillon ».
  - si l'on remet la valeur d'origine, la fiche redevient propre et se ferme sans question ;
  - si l'on sélectionne du texte dans un champ en relâchant la souris à côté de la fiche, rien ne se ferme. C'était une cause classique de fermeture accidentelle. La fiche Blocs bénéficie aussi de cette correction.
  - **Échap répété** : Chrome rend le second Échap « non annulable » et fermait alors la fiche malgré la protection. Échap est désormais intercepté dès l'appui sur la touche.
- **Échec réseau** (serveur injoignable, réponse coupée) : l'enregistrement échoue proprement. La fiche reste ouverte avec les saisies et affiche « Serveur injoignable ou réponse interrompue : rien n'est perdu, la fiche reste ouverte ; réessayez. » Il suffit de cliquer de nouveau sur Enregistrer.
- **Formulaires hors fiche** (Configuration, Économie, plafond de dépense IA, réglages Boutique, Publicité — réglages et codes collés —, réglages Actualités ; Concours et Points le faisaient déjà) : changer d'onglet ou recharger l'onglet **ne remplace plus une saisie non enregistrée**. Après un enregistrement réussi, l'onglet se recharge normalement.
- **Quitter ou recharger la page** (F5, fermeture de l'onglet) avec une fiche ou un réglage modifié : le navigateur demande une confirmation. C'est la seule boîte native encore possible, car le navigateur impose la sienne pour quitter une page.
- **Plus aucune fenêtre native `confirm` / `alert` / `prompt` dans le panel** : environ 49 appels ont été remplacés.
  - Confirmations : `admAsk`. La première ligne du message sert de titre, le reste de détail.
  - Informations : `admAlert`, avec un seul bouton OK.
  - Les six `prompt()` deviennent de **petites fiches de saisie Dig** (`admPrompt`) : correction du classement (profondeur, blocs, motif), note de changement de statut d'un gagnant, mot de passe temporaire Bêta, copie manuelle d'une invitation.
  - Dans chacune, Entrée valide, Échap ou Annuler abandonne, et rien n'est envoyé.

### Fichiers

| Fichier | Changement |
| --- | --- |
| `public/admin/admin.js` | Mécanisme commun : `admTrack` (suivi des champs), `admConfirmDiscard`, `admOnBackdrop`, `admDialogSetup` (options `dirty`, `canClose`, `keep`), `admAnyDirty` + un seul `beforeunload`, `admZone` / `admZoneDirty` / `admZoneClean` (formulaires de page), `admAsk` / `admAlert` / `admPrompt`. `api()` rend un échec ordinaire quand le réseau est coupé. Fiches Collections (série, objet, proposition IA), Actualités, Boutique, Événements et Badges branchées sur le mécanisme commun (les protections maison et leurs `confirm()` natifs sont retirés). |
| `public/admin/index.html` | Zone d'erreur de la Configuration (remplace un `alert`) ; interrupteur général Publicité exclu du suivi (`data-adm-noguard`). |
| `public/admin/admin.css` | Retours à la ligne dans la confirmation, champ de la petite fiche de saisie. |
| `test/admin-unsaved.test.js` | Nouveau : 8 tests de non-régression (aucune fenêtre native, toutes les fiches protégées, fermeture unique, suivi des champs, échec réseau, formulaires de page, `beforeunload` unique). |
| `test/e2e/admin-unsaved.e2e.js` | Nouveau : parcours Chromium réels PC 1280×900 et 390×844, sur un serveur de test uniquement (refuse la production). |
| `test/admin-*.test.js`, `test/shop-ux.test.js`, `test/collection-ai.test.js` | Assertions mises à jour vers le mécanisme commun (même intention). |

## 3. SHA, branche, procédure de test

- Branche : `feature/61-admin-modifications-protegees` (commits `5adefc8`, `c6d8496`)
- **`develop` : `f1c3bcb`** (fusion) — déployé tel quel.
- Tests automatisés : `npm test` → **572/572** (sur la branche, sur `develop` et dans la release `f1c3bcb`).
- Parcours navigateur (serveur de test seulement) :
  ```
  ADMIN_SECRET=$(openssl rand -hex 24) DB_FILE=test-61.sqlite PORT=3101 node server/index.js
  # série de brouillon « saint_martin » via PUT /api/admin/collections/draft/series/saint_martin
  DIG_E2E_BASE=http://127.0.0.1:3101 DIG_E2E_SECRET_FILE=<fichier ADMIN_SECRET> NODE_PATH=<playwright-core> node test/e2e/admin-unsaved.e2e.js
  ```
  Résultat : **TOUT OK** sur PC et 390 px (29 et 27 contrôles). Contrôles effectués :
  - clic à côté, fiche propre puis modifiée ;
  - focus par défaut sur « Continuer à modifier » ;
  - Échap sur la confirmation ;
  - trois Échap successifs sur la fiche ;
  - ✕ ;
  - sélection de texte relâchée sur le fond ;
  - retour à la valeur initiale ;
  - case à cocher modifiée puis remise ;
  - échec réseau (coupure simulée) : la saisie est conservée et l'erreur affichée ;
  - **aucune donnée enregistrée pendant ces essais** (vérifié par l'API) ;
  - Abandonner, puis réouverture avec la valeur enregistrée ;
  - enregistrement réussi, puis fiche propre ;
  - fiche Objet (Échap) et fiche Badge (clic à côté) ;
  - Configuration et Économie conservées au changement d'onglet ;
  - départ de la page protégé ;
  - petite fiche de saisie (Entrée, Échap) ;
  - aucune fenêtre native, aucune erreur JS.

## 4. Vérifications effectuées / non effectuées, limites

- Effectué : tests complets ×3, parcours Chromium PC + mobile, captures de la confirmation (PC et 390 px, lisibles, boutons pleine largeur sur mobile), contrôle du panel en production sans connexion (fonctions chargées, aucune erreur JS, PC et 390 px).
- Non effectué : parcours connecté **en production**. La clé admin est un secret que la session ne lit jamais, d'où le test fonctionnel ci-dessous. Safari n'a pas été essayé ; une case cochée sans focus y est néanmoins gérée.
- Limites connues :
  - La fiche **Blocs** garde sa propre confirmation (`bk-leave-dialog`, validée en #37). Elle est désormais aussi protégée contre l'Échap répété et la sélection relâchée sur le fond.
  - Un remplissage automatique (par exemple une proposition IA) dans une fiche sans instantané propre n'est pas compté comme une modification. Les fiches à IA (Actualités, propositions Collections et Badges) ont leur instantané et sont couvertes.
  - Le bouton « Retour » d'Android sur une fiche modifiée dépend du navigateur. Échap clavier et clic à côté sont couverts.
  - La correction du classement passe par trois petites fiches successives plutôt qu'une fiche unique à trois champs.
- **Données des joueurs** : aucun impact, car le panel seul change (aucune migration, aucune route serveur).

## 5. Déploiement

- **SHA déployé : `f1c3bcb`** (03/11/2026 21:01 Bruxelles), précédent `ba5ccfb`.
- Release `f1c3bcb` : `npm ci` et `npm test` 572/572.
- Copie de la base de production démarrée en `NODE_ENV=production` sur le port 3122 : `/health` et `/api/version` corrects, **empreintes identiques** avant et après démarrage (`users`, `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking`). La copie a ensuite été supprimée.
- Aucune génération IA en cours (dernier appel 17:16 UTC).
- Avance rapide de `main` `ba5ccfb..f1c3bcb`, puis `scripts/deploy.sh` de la release. Sauvegarde vérifiée : `~/backups/dig/dig-20261103-210134-pre-deploy-f1c3bcb.sqlite`.
- Après déploiement :
  - https://dig.lodygames.com et https://dig.lodylands.com → 200, `/api/version` = `1.0.0+f1c3bcb`, `/admin/` 200 ;
  - `journalctl -u dig` sans erreur ; `pragma quick_check` = ok ;
  - empreintes joueurs **identiques** à la sauvegarde pré-déploiement.
- Retour arrière immédiat possible : `git -C /home/ubuntu/Dig reset --keep ba5ccfb && sudo systemctl restart dig`. Aucun `npm ci` n'est nécessaire, le lock est inchangé.

### Test fonctionnel à faire par le propriétaire (3 min, rien n'est enregistré)

1. /admin/ (**Ctrl+F5**) → 📿 Collections → Séries — brouillon → fiche **« Les Trésors de la Saint-Martin »**.
2. Sans rien changer, cliquer à côté de la fiche : elle se ferme normalement.
3. Rouvrir, modifier le nom FR, puis **cliquer à côté** : la fiche reste ouverte et la boîte « Modifications non enregistrées » apparaît. **Continuer à modifier** : la saisie est toujours là.
4. Appuyer **deux fois sur Échap**, puis cliquer sur **✕** : la même boîte apparaît chaque fois, la fiche ne se ferme jamais seule.
5. Remettre le nom d'origine, puis cliquer à côté : la fiche se ferme sans question.
6. Modifier de nouveau, puis ✕ → **Abandonner les modifications** : la fiche se ferme, et en la rouvrant on retrouve le nom enregistré (rien n'a changé).
7. Facultatif : ⚙ Config → modifier une valeur → aller sur un autre onglet puis revenir : la saisie est toujours là. Ne pas enregistrer : F5 → le navigateur demande de confirmer, choisir Annuler ou quitter selon le cas.

Résultat attendu : à aucun moment une saisie n'est perdue sans « Abandonner les modifications » explicite, et aucune fenêtre grise native du navigateur n'apparaît (hors F5).

**Classement : Après lancement** (outil admin, fiabilité du travail éditorial ; ne bloque pas le MVP public des joueurs).

## 6. Choix techniques faits seul

1. **Mécanisme unique dans `admDialogSetup`** plutôt qu'un correctif par fiche : toute fiche existante ou future est protégée par défaut. `admConfirm()` du ticket #50 a été réutilisé, comme le demandait le propriétaire.
2. **Détection par comparaison des valeurs**. Chaque champ est relevé juste avant la première action de l'utilisateur (focus, clic, touche), puis comparé à sa valeur actuelle. Le simple focus ne compte pas, un remplissage par le code non plus, et le retour à la valeur d'origine efface la modification. Les fiches qui avaient déjà un instantané complet (objets, propositions, actualités, boutique, événements) gardent leur instantané, plus précis car il couvre les listes et les suppressions.
3. **Changement d'onglet : conserver plutôt que demander.** Le contenu d'un onglet reste en place ; seul son rechargement réécrivait les champs. Les chargements laissent donc intactes les zones en cours de saisie, ce qui suit la consigne « conserver les données saisies lors d'un changement d'onglet ». Une confirmation à chaque changement d'onglet aurait été une friction sans gain.
4. **Échap intercepté sur `keydown`** : sans cela, Chrome rend le second Échap non annulable et ferme la fiche malgré `preventDefault()` sur `cancel`. Vérifié par trois Échap successifs dans le parcours réel.
5. **`api()` ne lève plus d'exception réseau** : elle rend `{ ok: false, status: 0 }` avec un message clair, que tous les écrans affichent déjà. La fiche ne se ferme qu'après un succès.
6. **Fiche Blocs** : sa confirmation dédiée, validée en #37, est conservée ; seuls l'Échap et le clic sur le fond sont durcis.

## 7. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire.

## 8. Éléments restant à réaliser

- Recette du propriétaire (ci-dessus).
- #60 (boutons Rafraîchir uniformes) : les formulaires de page conservent déjà leurs saisies au rechargement. Il reste l'état visible de chaque bouton, qui relève de #60.
- Après lancement, facultatif : fiche unique à trois champs pour la correction du classement ; libellés « Confirmer » plus explicites (« Publier », « Supprimer »…) sur certaines confirmations converties automatiquement, qui gardent pour l'instant « Confirmer / Annuler ».
