# Ticket #37 — Panel admin : catalogue de blocs, découvertes, événements et tables de récompenses

Lien : https://github.com/ReC82/Dig/issues/37 — rapport du 30/10/2026 (session autonome digorch).

## 1. État réel

**Étape A déployée en production (SHA `1710147`) — en attente de recette.**
Étape B : **proposée** (nouveaux minerais chiffrés ci-dessous, rien d'activé). Étapes C (événements) et D (tables de drops gemmes/reliques/coffres) : **non commencées**.

Classement : **« Après lancement »** pour l'ensemble du ticket (le MVP public fonctionne avec les 14 blocs actuels) ; l'étape B (contenu au-delà de 249 m) est prioritaire parmi les suites car le propriétaire n'a plus rien à découvrir.

## 2. Résultat et changements

### Audit de l'existant (avant #37)
- Les 14 blocs étaient codés en dur dans `public/js/blocks.js` (tirage 100 % côté client, pondéré par profondeur, Chance #32, tirage reproductible #35).
- Tous les blocs avaient une borne cachée `maxDepth: 9999` (au-delà : repli sur la pierre seule) ; seules **terre meuble (≤ 12 m)** et **argile (≤ 22 m)** avaient une vraie profondeur maximale.
- Le budget de dégâts anti-bot (#25, `server/antibot.js`) recopiait à la main les PV minimum (3 / 6 / 8) : tout changement de catalogue l'aurait faussé.
- Coffres : contenu tiré par rareté (`public/js/chests.js`) ; trouvailles par catégorie (`collection.js`) — non modifiés (étape D).

### Ce qui est livré
- **`server/blockCatalog.js`** (nouveau) : catalogue versionné.
  - Version 1 = conversion **à l'identique** des 14 blocs, relus directement dans `public/js/blocks.js` (testé : mêmes probabilités au 1e-12 de 1 à 600 m, Chance 0 et 5).
  - Champs par bloc : identifiant stable, noms FR/EN/NL (les 14 d'origine gardent leurs traductions intégrées si vides), catégorie, rareté, icône emoji, image `/assets/…` facultative, couleurs, PV de base, récompense, **dès X m**, poids, actif/inactif.
  - **Brouillon unique → publication atomique** (refusée si invalide ou si une autre version a été publiée entre-temps), **retour arrière** (publie une nouvelle version au contenu d'une ancienne ; les blocs ajoutés depuis restent présents mais désactivés), **journal en ajout seul** (triggers SQLite), versions jamais modifiées ni supprimées.
  - Validation serveur : nom FR obligatoire pour un nouveau bloc, **aucune profondeur maximale pour un nouveau bloc**, poids > 0 (pour retirer : désactiver), **aucun bloc publié supprimable**, au moins un bloc actif à chaque profondeur, couleurs/images/noms filtrés (XSS).
  - Simulation 10 000 / 100 000 tirages par profondeur (probabilité théorique, fréquence observée, PV et récompense moyens), avec niveau de Chance.
- **Routes** : `GET /api/blocks/catalog` (public, lu par le jeu) ; `GET/PUT/DELETE/POST /api/admin/blocks…` protégées par `ADMIN_SECRET` (401 sans clé, testé) et tracées aussi par l'audit admin #25.
- **Jeu** (`blocks.js`, `main.js`, `iconLibrary.js`) : le catalogue publié est appliqué aux **prochains** blocs et mémorisé localement ; le bloc en cours, ses PV et les sauvegardes ne changent pas (#35 : un bloc désactivé sauvegardé est repris tel quel). Nom du bloc dans la langue du joueur. Image du catalogue affichée seulement si l'admin en renseigne une (les icônes v1 restent non activées par défaut).
- **Anti-bot #25** : PV minimum du budget de dégâts = minimum, profondeur par profondeur, sur **toutes** les versions publiées, et jamais plus strict que les valeurs d'origine (un joueur sur une ancienne version ne peut pas être freiné). Affiché dans l'onglet.
- **Panel admin, onglet « 🧱 Blocs »** : liste filtrable (texte, catégorie, statut, modifiés), probabilités à une profondeur choisie, formulaire avec aperçu du bloc, brouillon (changements champ par champ, erreurs, avertissements), publication avec note, simulation, versions avec « Revenir à vN », journal.
- La borne cachée 9 999 m est supprimée (sans effet pour les joueurs actuels, tous < 9 999 m).

Fichiers : `server/blockCatalog.js`, `server/index.js`, `server/antibot.js`, `public/js/blocks.js`, `public/js/main.js`, `public/js/iconLibrary.js`, `public/admin/index.html`, `public/admin/admin.js`, `test/block-catalog.test.js` (nouveau, 7 tests), `test/antibot.test.js` (adapté : plus de profondeur maximale implicite).

## 3. SHA, branche, procédure de test

- Branche : `feature/37-catalogue-blocs-admin` (commit `b84966d`) ; **`develop` : `1710147`** (fusion) ; déployé : `1710147`.
- Tests : `npm test` → 274/274 sur la branche, sur `develop` et sur la release `1710147`.
- Essai navigateur sur serveur de test (port 3101, base temporaire) : ajout d'un bloc dans le brouillon, simulation, publication v2, retour au jeu → le jeu reçoit la v2 et affiche le nouveau bloc (ordinateur 1280×900 et smartphone 390×844, aucune erreur JS).

## 4. Vérifications, limites, données joueurs

- Migration **additive uniquement** : 3 tables nouvelles (`block_catalog_versions`, `block_catalog_draft`, `block_catalog_audit`), aucune colonne ni donnée existante touchée. Testée sur une copie de la base de production : empreintes `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking` identiques avant/après démarrage ; `quick_check` ok ; copie supprimée.
- Limites : les étapes C et D ne sont pas faites ; le tirage reste calculé par le client (comme avant), le serveur est source de vérité du **catalogue** et borne la progression via le budget anti-bot — un tirage côté serveur est un chantier distinct (#25 lot C / étape D) ; pas de « découverte » visible côté joueur (bestiaire) encore (étape B) ; sur smartphone, le tableau de l'onglet Blocs défile horizontalement (panel prévu pour ordinateur).

## 5. Déploiement

- SHA déployé : **`1710147`** (avance rapide `main` 68a67eb → 1710147, `scripts/deploy.sh` de la release).
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261030-175531-pre-deploy-1710147.sqlite`.
- Après déploiement : dig.lodygames.com et dig.lodylands.com → 200, `/api/version` = `1.0.0+1710147`, `/api/blocks/catalog` = v1 (14 blocs), `/api/admin/blocks` sans clé = 401, journal sans erreur, `quick_check` ok, empreintes joueurs identiques à la sauvegarde ; jeu chargé en navigateur (ordinateur et smartphone) : catalogue v1 appliqué, aucune erreur.
- Retour arrière : code → `git -C /home/ubuntu/Dig reset --keep 68a67eb` + redémarrage (les 3 tables ajoutées sont simplement ignorées par l'ancien code) ; contenu → bouton « Revenir à vN » dans l'onglet.

### Test fonctionnel à faire par le propriétaire
1. Ouvrir https://dig.lodygames.com/admin/, saisir la clé admin, onglet **🧱 Blocs**.
2. Vérifier la liste : 14 blocs, « Version en vigueur : v1 ». Mettre « Probabilités à » = 249 : terre meuble / argile « — », pierre ≈ 30,9 %, diamant ≈ 0,52 %.
3. Simulation : Profondeurs `249`, 100 000 tirages, Simuler → colonnes Probabilité et Observé proches.
4. Essai sans risque : cliquer « Modifier » sur *diamant*, saisir un nom EN « Diamond », « Enregistrer dans le brouillon » → le bandeau indique un brouillon, la section Brouillon montre `names : null → {"en":"Diamond"}` ; **rien ne change en jeu**. Puis « Abandonner le brouillon ».
5. (Facultatif, visible des joueurs) publier une petite modification, vérifier en jeu après rechargement (s'applique aux blocs suivants), puis « Revenir à v1 » dans Versions.

Résultat attendu : tout fonctionne sans changer le jeu tant que rien n'est publié.

## 6. Choix techniques faits seul

- **Conversion à l'identique** : les bornes de terre meuble (12 m) et argile (22 m) sont conservées comme « bornes héritées » (avertissement dans le panel) — les supprimer changerait toutes les probabilités au-delà de 22 m (décision 1 ci-dessous). Un nouveau bloc ne peut pas avoir de profondeur maximale.
- Catalogue d'origine relu dans `blocks.js` plutôt que recopié : une seule source, migration prouvée par test.
- Catalogue public incluant les blocs désactivés : nécessaire pour reprendre un bloc sauvegardé (#35).
- Budget anti-bot = minimum sur toutes les versions : ne peut que rester permissif ; aucun joueur honnête freiné par un changement de PV.
- Le jeu applique le catalogue en arrière-plan (jamais bloquant) ; s'il est injoignable, le catalogue mémorisé ou d'origine sert.

## 7. Décisions demandées au propriétaire

1. **Bornes de surface** : terre meuble (jusqu'à 12 m) et argile (jusqu'à 22 m) disparaissent ensuite. (a) Les garder (recommandé : c'est la sensation « on quitte la surface », et cela ne touche pas « un type débloqué » au sens de nouvelles découvertes) ; (b) les supprimer : ils réapparaîtraient en profondeur (≈ 36 % des blocs à 249 m, PV moyens fortement réduits — gros changement d'équilibrage).
2. **Étape B — premiers nouveaux minerais** (proposition, non activée ; PV/récompense de base, ×(1+0,12 d) et ×(1+0,05 d) en jeu) :

| Bloc | Catégorie / rareté | Dès | PV base | Récompense | Poids |
|---|---|---|---|---|---|
| Quartz | minerai / peu commun | 150 m | 45 | 70 | 14 |
| Obsidienne | pierre / peu commun | 200 m | 60 | 40 | 16 |
| Minerai d'argent | minerai / rare | 260 m | 95 | 260 | 7 |
| Saphir | gemme / épique | 330 m | 150 | 1 900 | 2,5 |
| Minerai de platine | minerai / rare | 420 m | 120 | 520 | 5 |
| Améthyste | gemme / épique | 520 m | 170 | 2 600 | 2 |
| Fer météorique | minerai / légendaire | 650 m | 220 | 5 200 | 1 |
| Cristal ancien | gemme / légendaire | 800 m | 300 | 9 000 | 0,6 |

   Effet simulé (catalogue actuel → avec proposition) : à 260 m, PV moyens +14,5 %, récompense moyenne +5 %, 16 % de blocs nouveaux ; à 520 m, PV +27 %, récompense +73 % ; à 1 000 m, PV +31 %, récompense ×2,3, 20 % de nouveaux. Options : (a) valider tel quel ; (b) valider les noms/profondeurs mais réduire PV ou récompenses ; (c) proposer vos propres noms. Recommandation : (a) pour Quartz → Platine d'abord, le reste après observation. Les icônes (#22/#40) suivront.
3. Gemmes « saphir/améthyste » : doivent-elles compter comme gemmes (monnaie gemmes) ? Aujourd'hui seule la catégorie « gemme » sert de marqueur ; la monnaie gemmes relève de l'étape D (#20).

## 8. Restant à réaliser

- Étape B : après décision 2, saisir les blocs (directement dans l'onglet) + écran « découvertes » côté joueur (bestiaire : blocs vus, « ??? dès X m »).
- Étape C : événements temporaires (dates UTC, blocs/chances d'événement, calendrier).
- Étape D : tables de drops gemmes/fragments/reliques et contenu des coffres par bloc/profondeur/événement, probabilités affichées aux joueurs, cohérence #20.
- Amélioration signalée (hors périmètre) : favicon absent dans `/admin/` (404 dans la console).
