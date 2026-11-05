# Ticket #76 — [P1][UX] Simplifier les fiches et fenêtres de l'administration

- Ticket : [#76](https://github.com/ReC82/Dig/issues/76). Tickets liés : #70 (navigation admin), #75 (reset d'un joueur de test), #61 (saisies non enregistrées).
- Session : 05/11/2026, branche `feature/76-admin-fiches-compactes`
- **État réel : déployé en production (SHA `121f940`), en attente de recette du propriétaire**

## 1. Résultat

Le parcours **Joueurs → fiche → Essais de test → Recommencer un test à zéro** tient désormais sur un écran d'ordinateur.
Toutes les informations et toutes les sécurités sont conservées.

### Fiche joueur (rubrique 👤 Joueurs)

- **Résumé compact en tête**. Il affiche l'essai en cours (n°, depuis combien de temps, nombre d'essais archivés), la profondeur, les pièces, les gemmes, la pioche, l'Auto-Dig, la dernière sauvegarde et la révision.
- **🧪 Essais de test vient en premier, ouvert**. Les boutons **🔄 Recommencer un test à zéro**, Exporter CSV et Exporter JSON complet sont en tête de cette section : ils sont visibles sans défiler, sur ordinateur et sur smartphone.
- Le texte « ce qui est remis à zéro / conservé » est **replié** sous une phrase courte. L'indication de garde active a été placée au même endroit.
- **📈 Progression détaillée** (les 15 valeurs, coffres, format de sauvegarde) est **repliée**. **⚠ Réinitialisation saisonnière partielle** reste repliée, comme avant.
- **Historique des essais** :
  - l'essai en cours est en tête, puis les essais archivés du plus récent au plus ancien ;
  - **5 lignes par page**, avec « ‹ Précédents · 1–5 sur 8 · Suivants › » ;
  - le tableau est resserré pour tenir dans la largeur d'un ordinateur 1280 px. Une période sur une seule journée affiche « jeu. 05/11/2026 14:34 → 14:41 » ; la période complète apparaît en infobulle ;
  - sur smartphone, chaque essai est une **carte « intitulé : valeur »** ;
  - aucune colonne n'a été retirée.

### Fenêtre « Recommencer un test à zéro » / « Restaurer l'essai n° … »

L'ordre devient : titre → résumé (essai archivé, nouvel essai) → **ligne « Change : profondeur 245 → 1 · pièces … »** → **motif** et **pseudo exact** → détails **repliés**. Les détails contiennent le tableau avant / après complet et toute la liste « archivé / conservé ». **Annuler / Confirmer** sont dans un **pied fixe** qui reste visible, même avec les détails dépliés.

**Sécurités inchangées** :
- motif obligatoire ;
- pseudo exact (la casse compte) ;
- révision attendue ;
- identifiant de requête (idempotence) ;
- instantané archivé avant toute écriture ;
- protection #61 « Abandonner les modifications ? » si l'on annule après avoir saisi un motif.

### Recherche joueur

- La recherche reste en haut de la rubrique Joueurs (#70).
- Si « Rechercher » ne trouve **qu'un joueur**, sa fiche s'ouvre directement.
- Le bouton s'appelle « Ouvrir la fiche ».
- Le tableau des résultats est paginé (10 par page) et s'affiche en cartes sur smartphone.

### Toutes les fenêtres de l'admin

Quand une fenêtre se termine par sa rangée de boutons, cette rangée devient un **pied fixe** : les boutons restent visibles pendant le défilement et passent côte à côte sur smartphone (≥ 44 px). C'est le cas de 22 fenêtres, vérifiées une par une : saisons, ligues, article de boutique, ajout de bloc / collection / badge / événement, récompenses, contrôles des améliorations, rotation des missions, etc.

Les fiches qui avaient déjà leur propre pied fixe ne sont pas touchées : Actualités, badges, reliques, améliorations, missions, blocs, événements.

### Fichiers

| Fichier | Changement |
|---|---|
| `public/admin/index.html` | fiche joueur réorganisée, fenêtre `tr-dialog` réordonnée, barres de pagination |
| `public/admin/admin.js` | `admTableLabels` et `admTablePage` (communs), `pdSummary`, ordre et pagination des essais, résumé des changements, recherche à un seul résultat |
| `public/admin/admin.css` | résumé, cartes `.adm-rtable`, pagination, pied fixe commun, tableau des essais resserré |
| `test/admin-sheets.test.js` | 5 tests unitaires (structure, sécurités, pagination, CSS) |
| `test/e2e/admin-sheets.e2e.js` | essai Chromium PC 1280×900 et smartphone 390×844 |
| `test/e2e/test-runs.e2e.js` | adapté : la fiche s'ouvre directement quand il n'y a qu'un résultat |

Aucune route serveur, aucune migration et aucune donnée ne sont modifiées.

## 2. SHA et procédure de test

- Branche : `feature/76-admin-fiches-compactes` (`d7a232c`). **`develop` : `121f940`**. Déployé : `121f940`.
- `npm test` : **770/770** sur la branche et sur la release `121f940`. `npm run check` OK.
- Essais navigateur sur un serveur de test (port 3101, base temporaire supprimée ensuite) :
  - `admin-sheets.e2e.js` : **TOUT OK** sur PC et sur mobile. Il vérifie :
    - le résumé ;
    - l'ordre des sections et ce qui est replié ;
    - le bouton de reset visible sans défiler ;
    - la pagination 1–5 / 6–8 et l'absence de défilement horizontal ;
    - les cartes sur mobile ;
    - le formulaire placé avant les détails, avec les 9 lignes avant / après et les 10 points d'impact présents ;
    - le pied visible, y compris détails dépliés ;
    - le pseudo exact exigé ;
    - la confirmation #61 ;
    - l'aperçu de restauration ;
    - **aucune requête d'écriture** ;
    - aucune erreur JS.
  - `test-runs.e2e.js` (#75, vrai reset d'un joueur **de la base de test**) : PC OK, mobile OK.
  - `admin-nav.e2e.js` (#70) : TOUT OK. `admin-layout.e2e.js` : aucun débordement.
  - Le pied fixe a été contrôlé sur les 30 fenêtres : les 22 concernées ont leurs boutons visibles avec un contenu long simulé, sur PC et sur mobile.
- Non lancé : `admin-unsaved.e2e.js` (#61). Il dépend d'une série de collection pré-remplie (`saint_martin`) absente d'une base neuve. Les comportements #61 de la fenêtre de reset sont couverts par `admin-sheets.e2e.js`.

## 3. Déploiement

- Copie de la base de production : démarrage OK (`1.0.0+121f940`). Les empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` sont **identiques** avant et après. La copie a été supprimée.
- Avant de déployer : aucune génération IA en cours (dernier appel à 11:53 UTC).
- `scripts/deploy.sh` (release) :
  - sauvegarde vérifiée `dig-20261105-150008-pre-deploy-121f940.sqlite` ;
  - `d89f089 → 121f940` ;
  - santé et version OK.
- Après le déploiement :
  - les 2 domaines répondent 200 en `1.0.0+121f940`, et `/admin/` répond 200 ;
  - le journal ne contient aucune erreur ;
  - `quick_check` = ok ;
  - empreintes joueurs **identiques** à la sauvegarde pré-déploiement.
- Aucun essai navigateur n'a été fait en production : la session admin exige la clé, qui n'est pas lue.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep d89f089` + `sudo systemctl restart dig` (pas de `npm ci` : lock inchangé).
- **Aucun reset réel** n'a été fait en production.

## 4. Test fonctionnel à faire par le propriétaire (3 min, PC puis smartphone)

1. Recharger l'admin (F5) → 👤 Joueurs. Taper le pseudo complet d'un joueur de test, puis « Rechercher ». **Attendu** : la fiche s'ouvre directement (un seul résultat).
2. **Attendu** dans la fiche :
   - une ligne de pastilles (essai n° … en cours, profondeur, pièces, gemmes, pioche, Auto-Dig, sauvegarde, révision) ;
   - juste dessous, 🧪 Essais de test avec **🔄 Recommencer un test à zéro** visible sans défiler ;
   - la progression détaillée et la réinitialisation partielle repliées.
3. Avec plus de 5 essais : « Suivants › » affiche les plus anciens. Sur smartphone, chaque essai est une carte lisible.
4. Cliquer **Recommencer un test à zéro** sans confirmer. **Attendu** :
   - résumé et ligne « Change : … » ;
   - motif et pseudo tout de suite ;
   - « Détails : 9 valeurs avant / après… » replié ;
   - Annuler / Confirmer toujours visibles en bas ;
   - Confirmer inactif tant que le motif et le pseudo exact manquent.

   Annuler (« Abandonner les modifications » si un motif a été saisi).
5. Facultatif : ouvrir une autre fenêtre longue, par exemple Boutique de cadeaux → un article, sur smartphone. **Attendu** : les boutons restent en bas pendant le défilement.

Classement : **Après lancement** (confort d'administration, aucun effet pour les joueurs).

## 5. Choix techniques faits seul

- **Pas de déplacement du bouton de reset dans l'en-tête de la fiche**. La section Essais passe en tête et la progression détaillée est repliée, ce qui suffit à rendre le bouton visible sans défiler. Les liens et actions de #70 (`#a/reset-test` → section Essais) restent valables sans modification.
- **Pagination côté navigateur** en masquant les lignes : rien n'est retiré du DOM, et les exports restent complets. Le serveur renvoie déjà tous les essais d'un joueur, au plus quelques dizaines.
- **Pied fixe en CSS commun** (`.bk-dialog > .form-actions` en fin de fenêtre) plutôt que de reprendre chaque fenêtre. Les fiches `.nw-dialog` et `.bk-sheet-actions`, qui ont déjà leur propre pied, sont exclues.
- **Bêta fermée (fenêtre d'invitation) non modifiée** : #72 et #80 la traitent. Cela évite un travail concurrent.
- **Fiche anti-bot** non modifiée : elle est déjà « résumé d'abord, sections repliées » depuis la recette UX du 05/11.

## 6. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire.

## 7. Reste à faire

- Rien dans le périmètre testé. Si la recette demande d'autres fenêtres précises à resserrer, elles seront traitées dans ce ticket.
- Suggestion (non faite) : rendre `admin-unsaved.e2e.js` autonome (création de sa série de test) pour qu'il passe sur une base neuve.
