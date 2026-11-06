# Ticket #68 — Admin : catalogue de missions quotidiennes dynamiques, adaptées à la progression

Lien : https://github.com/ReC82/Dig/issues/68

## Session du 06/11/2026, matin (DIGORCH) — réserves UX de la recette : fiche Mission compacte et simulateur lisible

**État réel : Déployé en production (SHA `7af04f9`) — en attente de recette.** Présentation seule : aucun calcul, objectif, barème, coût, nombre de gemmes, état de publication ni d'activation modifié.

### Origine
Recette du propriétaire du 06/11 : #68-A conforme et #68-B réussi, avec deux réserves UX ([commentaire 1](https://github.com/ReC82/Dig/issues/68#issuecomment-6681717834), [commentaire 2](https://github.com/ReC82/Dig/issues/68#issuecomment-6681792405)) : « beaucoup d'info sur une seule fenêtre » pour la fiche, « il faut simplifier l'affichage » pour le simulateur.

### Changements (fichiers `public/admin/index.html`, `admin.js`, `admin.css`, essais `test/e2e/missions-catalog.e2e.js`, `missions-bonus.e2e.js`)
**Fiche Mission (Admin → 🎯 Missions → clic sur une mission)**
- En haut, toujours visible : visuel, nom FR, texte FR, case « Active », puis deux résumés en lecture seule, **Objectifs** (tranches) et **Récompense**.
- **Aperçu par profil** (ouvert) : une ligne par profondeur, par exemple « 20 m · indisponible · gemmes inaccessibles (aucun bloc gemme à cette profondeur) » ou « 100 m · disponible · objectifs 1 / 2 / 3 ». Un clic sur la ligne déplie les récompenses par objectif, la tranche utilisée, le plafond et la raison technique.
- **Repliées**, chacune avec un résumé dans son en-tête : Objectifs par tranche de profondeur, Détail de la récompense, Visuel (bouton atelier d'icônes), Traductions (EN/NL/ES côte à côte, ● complet / ◐ nom seul / ○ vide), **Paramètres avancés** (identifiant, type, catégorie, poids, ancienneté, aide du compteur).
- Une nouvelle mission ou une copie ouvre d'office « Paramètres avancés » et « Objectifs », qu'il faut remplir. Après une erreur d'enregistrement, toutes les sections s'ouvrent pour montrer le champ en cause. Au retour de l'atelier d'icônes, « Visuel » est ouvert. Replier une section ne perd aucune saisie, et la garde « modifications non enregistrées » (#61) reste active.
- Enregistrer / Dupliquer / Fermer restent dans le pied fixe de la fenêtre. Aucune fiche ne s'ouvre au chargement.

**Simulateur de rotation**
- Bandeau « 🧪 Simulation uniquement — rien ne change en jeu ».
- Le bloc replié « Comment lire ces résultats ? » explique en français courant : ✓ atteignable, ✗ non atteignable, activité estimée (1 bloc = 1 m), reprise de la veille, journées différentes, écartée, 100 % atteignable. Il donne aussi les paramètres de la source.
- Par profil, d'abord **4 cartes** : journées différentes (2/2), missions atteignables (6/6), répétitions de la veille, récompenses des missions (total sur la période et ≈ par jour).
- **Bonus trois missions à part**, encadré en pointillés avec le badge « Simulation uniquement — bonus désactivé ». Il affiche les journées complètes, le montant hypothétique, puis « sans bonus : … · avec bonus : … ». Les totaux normaux ne l'incluent jamais.
- **Une carte repliable par journée** (ouvertes d'office jusqu'à 3 jours). Chaque mission y figure avec son icône, son nom, son objectif, sa récompense, un badge ✓/✗ et le badge « reprise de la veille ». Quand une mission n'est pas atteignable, l'activité estimée est comparée à l'objectif. Une ligne « bonus hypothétique, non compté ci-dessus » s'ajoute sur les journées complètes.
- **« Détails / Pourquoi ? »** est replié et regroupe l'activité estimée, les missions écartées (raison en clair et raison technique), le nombre de tirages par mission et la part du bonus dans le minage. Partout, les **noms** des missions remplacent les identifiants techniques (`find_gems`, `buy_upgrades`).
- Milliers au format fr-BE, aucun défilement horizontal à 320, 390 et 1280 px, zones cliquables d'au moins 40 px, gris des textes secondaires éclairci pour le contraste.

### SHA et branche
Branche `feature/68-missions-quotidiennes` (commit `2695267`), `develop` = **`7af04f9`** (fusion), déployé `7af04f9`.

### Procédure de test (technique)
`npm test` (822/822). Essais navigateur sur base de test, serveur `PORT=3101 DB_FILE=test-68.sqlite NODE_ENV=test ADMIN_SECRET=…` :
- `CHROME=…/chrome-headless-shell PW=…/playwright-core BASE=http://127.0.0.1:3101 ADMIN=… node test/e2e/missions-catalog.e2e.js` passe en PC 1280×900, mobile 390×844 et **320×640**. Il vérifie les sections repliées par défaut, la saisie conservée après repli, l'absence de défilement horizontal, le simulateur sans identifiant technique, les détails repliés et l'absence d'écriture.
- `missions-bonus.e2e.js` passe en PC et en mobile.
- `missions-live.e2e.js` passe en PC et en mobile sur base neuve. Un premier passage sur une base déjà utilisée par les autres essais avait échoué sur mobile à l'ouverture du menu, avant toute étape liée à ce changement.

### Vérifications et déploiement
- Release au SHA exact : `npm ci` puis `npm test`, 822/822.
- Copie de la base de production démarrée en `NODE_ENV=production` : `/health` ok, version `1.0.0+7af04f9`. Empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking`, et liste des tables : identiques avant et après (aucune migration). Copie supprimée.
- Aucune génération IA en cours avant le déploiement. `main` avancé en avance rapide, puis `scripts/deploy.sh` de la release : sauvegarde vérifiée `~/backups/dig/dig-20261106-112306-pre-deploy-7af04f9.sqlite`, santé et version OK.
- Après déploiement : les 2 domaines répondent 200 avec `1.0.0+7af04f9`, et `admin.js?v=1.0.0+7af04f9` est servi. Journal sans erreur, `quick_check` ok. Mêmes nombres de lignes que la sauvegarde. Les seuls écarts viennent d'une partie en cours (sauvegarde d'un joueur 4872 → 4873), donc une progression, pas une perte.
- **Brouillon de missions de production (image « Briseur ») intact** : même empreinte avant et après. **Mode d'activation inchangé** : « Pilote », réglé par le propriétaire à 11:07 le 06/11, compte pilote inchangé.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep ba083e0` puis `sudo systemctl restart dig` (aucune migration, base inchangée).

### Test fonctionnel à faire par le propriétaire (5 min, ne rien publier)
1. /admin/ (**Ctrl+F5**, l'onglet admin ouvert avant 11:23 garde l'ancienne version) → 🎯 Missions → **Gemmologue** :
   - en haut : visuel, nom, texte, Active, « Objectifs : dès 1 m : 1, 2, 3 », « Récompense : 200 💰 par unité +1 💎 » ;
   - l'aperçu montre « 20 m · indisponible · gemmes inaccessibles… » et « 100 m · disponible · objectifs 1 / 2 / 3 » ; un clic sur une ligne déplie le détail ;
   - les autres sections sont repliées ; ouvrir « Traductions », modifier un mot, replier puis rouvrir : la saisie est toujours là ; « Fermer » demande confirmation, choisir de ne pas enregistrer.
2. Simulateur : Proposition adaptative, 06/11/2026, 2 jours, Débutant et Avancé → **Simuler**. Résultat attendu : **mêmes missions qu'au test du matin**. Débutant J1 : coffres, 30 m, 1 amélioration ; J2 : 40 blocs, 30 m, 1 000 pièces. Avancé J1 : 3 coffres, 75 m, 1 gemme ; J2 : 75 blocs, 75 m, 60 000 pièces. Chaque profil commence par ses cartes « 2/2 journées différentes », « 6/6 missions atteignables », « 1 répétition de la veille ». Le bonus est à part, avec le badge « Simulation uniquement — bonus désactivé ». « Détails / Pourquoi ? » est replié et indique « Gemmologue — trop peu profond (à partir de 35 m) » pour le débutant.
3. Même chose sur téléphone : aucun défilement horizontal.

**Classement : Après lancement** (outil d'administration, rien ne change pour les joueurs).

### Choix techniques faits seul
- Mise en page reprise des fiches de blocs (#76, `bk-acc`) : sections dépliables avec un résumé dans l'en-tête, pour la cohérence de l'admin.
- Traductions affichées côte à côte dans leur section, sans bouton de langue : le FR, obligatoire, est en haut.
- Raisons d'écart traduites en clair dans le navigateur, la raison technique du serveur restant visible dans le détail : la réponse du serveur n'est pas touchée.
- Pied de fenêtre mobile inchangé (boutons pleine largeur, identique aux autres fiches).

### Décisions demandées au propriétaire
Aucune nouvelle décision pour cette correction. Les questions déjà posées restent ouvertes (barème du bonus, remplacement du bonus fixe #49, branchement dans le moteur, barème des objectifs, ordre d'activation).

### Restant à réaliser
Recette de cette présentation ; suite selon vos décisions sur le barème et l'activation (rien n'est publié ni étendu à tous les joueurs).

## Session du 05/11/2026, soir (DIGORCH) — bonus « trois missions » : barème chiffré, brouillon et simulateur, désactivé

Suite à l'arbitrage du propriétaire du 05/11 (17:31 Bruxelles) : accord de principe sur un **bonus pour les
3 missions du jour réussies**, pour **tous les joueurs** (débutants compris), **adapté à la profondeur**,
sans boule de neige ni pay-to-win. Il demande un **barème chiffré et simulé avec #49** avant validation, la
mécanique **en brouillon ou derrière un drapeau OFF**, aucune activation, et une recette courte pour plus tard.

### 1. État réel

**Déployé en production (SHA d9a96a0) — en attente de recette, rien d'activé.** Les joueurs ne voient
**aucun changement** : les fichiers du jeu sont identiques à la version précédente, le moteur de missions reste
sur « Désactivé » et le bonus n'est lu ni par le jeu ni par le moteur serveur. Le pilote n'a pas été activé.

### 2. Résultat et changements

- **Catalogue** (`server/missionCatalog.js`) : nouveau réglage **« Bonus trois missions »**, versionné avec le
  catalogue (brouillon → publication → retour arrière, journal).
  - Forme : `{ enabled, bands: [{ fromDepth, coins, gems }] }`. Les versions publiées avant ce réglage valent
    « aucun bonus, désactivé ».
  - Garde-fous (validation) : premier palier **à 1 m** (accessible à tous), paliers strictement croissants,
    **gemmes de 0 à 3** par palier, pièces de 0 à 1 000 000, 6 paliers au plus. Les montants sont **fixes par
    palier**, jamais un pourcentage des revenus : pas de boule de neige.
  - Le palier appliqué est celui de la profondeur du joueur au début de la journée.
  - Même publié et marqué « activé », le bonus n'a **aucun effet** : un avertissement le rappelle à la publication.
- **Proposition de barème** (désactivée), chargée avec « Charger la proposition adaptative » ou
  « Remplir avec le barème proposé » :

  | Profondeur | Pièces | Gemmes |
  |---|---|---|
  | dès 1 m | 300 | 1 |
  | dès 50 m | 2 000 | 1 |
  | dès 150 m | 10 000 | 1 |
  | dès 300 m | 40 000 | 2 |

- **Simulateur des missions** : pour chaque profil, journées complètes, bonus gagné (« si activé » quand il est
  désactivé), part des pièces et des gemmes du minage. Les missions tirées sont strictement les mêmes avec ou
  sans bonus.
- **Simulateur économique #49** (`tools/balance/economy-sim.js`) : prise en charge des paliers
  (`missionSetBands`), pour chiffrer l'effet sur une saison avec les profils de #49.
- **Admin → 🎯 Missions** : carte **« 🎁 Bonus trois missions »** (état, paliers, origine brouillon/version) et
  fenêtre « Modifier le bonus… » (paliers, « ＋ Palier », « Remplir avec le barème proposé », protégée contre la
  perte de saisie). Les écarts apparaissent dans le brouillon. Route :
  `PUT /api/admin/missions/draft/set-bonus` (admin seulement).
- **Tests** : 1 test catalogue (validation, brouillon, publication, retour arrière, simulation, moteur non
  concerné), 1 test du simulateur économique, essai navigateur `test/e2e/missions-bonus.e2e.js`.

### 3. Chiffres du barème proposé

**a) Simulateur des missions** — 28 jours depuis le 09/11, source « Proposition » (objectifs adaptés à la
profondeur), profils du catalogue :

| Profil | Journées complètes | Bonus en pièces (part des pièces du minage) | Bonus en gemmes (part des gemmes trouvées en minant) |
|---|---|---|---|
| Débutant 20 m | 28/28 | 8 400 (2,8 %) | 28 💎 (97 % : environ le double) |
| Régulier 100 m | 26/28 | 52 000 (0,8 %) | 26 💎 (18 %) |
| Avancé 250 m | 28/28 | 280 000 (0,5 %) | 28 💎 (10 %) |
| Très avancé 500 m | 28/28 | 1 120 000 (0,9 %) | 56 💎 (24 %) |

Avec la proposition, un débutant ne gagne plus de gemmes par les missions elles-mêmes (aucune gemme avant 35 m).
Avec la v1, il en gagnait 15 en 28 jours. Le bonus remplace donc ces gemmes (28 si tout est fait).

**b) Simulateur économique #49** — 300 joueurs par profil, mêmes graines. Les missions y sont celles du jeu actuel
(objectifs fixes), ce qui donne moins de journées complètes : ces chiffres sont donc une **borne basse**.

Une saison (7 jours), règles actuelles → règles actuelles + bonus :

| Profil #49 | 💎 gagnées | 💎 perdues au plafond | Pièces | Profondeur médiane |
|---|---|---|---|---|
| Débutant (20 min/j, 4 j/7) | 17,9 → 20,7 (+16 %) | 0 → 0 | +2,6 % | 309 → 310 m |
| Régulier (1 h/j) | 94,6 → 100,3 (+6 %) | 0 → 0 | ≈ 0 % | 1 341 → 1 347 m |
| Assidu (3 h/j + 4 h) | 224,4 → 229,5 (+2 %) | 59,4 → 64,5 | ≈ 0 % | 3 207 → 3 207 m |
| Automatique (15 min/j + 8 h) | 61,3 → 67,8 (+11 %) | 0 → 0 | +7,7 % | 859 → 879 m (+2 %) |

Saison 4 (effet à long terme) : profondeur inchangée (débutant 482 → 485 m, régulier 1 779 → 1 779 m,
assidu 3 385 → 3 385 m, automatique 1 633 → 1 635 m). Le surplus de gemmes des joueurs assidus finit
surtout **perdu au plafond** (régulier 75 → 86, assidu 187 → 198, automatique 65 → 76 💎 perdues par saison).

Avec le **barème A de #49**, son bonus fixe de +1 💎 comparé aux paliers proposés donne : débutant 28,2 → 28,2 ;
régulier 212,3 → 213,3 ; assidu 574,4 → 576,5 ; automatique 128,5 → 131,2 💎. Les deux sont presque
équivalents : les paliers ajoutent surtout des pièces, et une deuxième gemme seulement à partir de 300 m.

**Lecture** :

- **Coût en pièces : négligeable** (moins de 3 % des pièces du minage), et il ne grandit pas avec les revenus.
- **Rareté des gemmes** : le bonus profite surtout aux **débutants** (+16 % par saison, jusqu'au double par jour
  si les missions sont adaptées). Pour les joueurs avancés, l'effet est faible (+2 à +6 %) et le surplus bute
  sur le plafond de saison. Cela renforce le besoin d'un débouché (boutique en gemmes, #49).
- **Boule de neige** : seul le profil automatique avance un peu plus vite (+2 % de profondeur la première
  saison), parce qu'il achète l'Auto-Dig plus tôt. L'effet disparaît ensuite. Aucun effet sur le classement
  (il ne compte que les blocs cassés à la main, #73).
- **Pay-to-win** : non. Le bonus ne s'achète pas et ne dépend ni d'achats ni de publicités. Il est crédité
  sans multiplicateur de boost.

### 4. SHA, branche, procédure de test

- Branche : `feature/68-missions-quotidiennes` (commit `f85f959`). SHA sur `develop` : **`d9a96a0`**.
- `npm test` : **795/795** sur la branche, sur `develop` et sur la release au SHA exact.
- Tests ciblés : `node --test test/mission-catalog.test.js test/economy-sim.test.js`.
- Essai navigateur, uniquement sur une base de test : `PORT=3101 DB_FILE=test-68.sqlite NODE_ENV=test
  ADMIN_SECRET=… node server/index.js`, puis `PW=… CHROME=… BASE=http://127.0.0.1:3101 ADMIN=…
  node test/e2e/missions-bonus.e2e.js`.

### 5. Vérifications effectuées

- Validation : refus d'un premier palier au-delà de 1 m, de plus de 3 gemmes, de paliers non croissants, de
  montants négatifs, d'un bonus activé sans récompense, de plus de 6 paliers.
- Brouillon : écart visible, rien de publié. Un retour à « aucun palier » supprime le brouillon redevenu
  identique. La proposition reste désactivée. Publication avec avertissement, puis retour arrière (bonus
  retiré). Journal `draft_set_bonus`.
- Simulateur : bonus = palier × journées complètes. Missions, objectifs et récompenses identiques avec ou sans
  bonus. Le moteur serveur (`missionsLive.js`) ne lit pas le réglage (test).
- Navigateur (Chromium, PC 1280×900 et mobile 390×844, base de test) : carte « Aucun bonus », barème proposé
  rempli (4 paliers, désactivé), enregistré dans le brouillon, écart affiché, simulateur avec les lignes 🎁
  (débutant palier 1 m, très avancé palier 300 m). Aucune publication, aucune erreur JavaScript. La fenêtre a
  été corrigée pour le mobile (colonnes lisibles, aucun défilement horizontal).
- Le simulateur économique reproduit exactement les valeurs de référence de #49 (17,9 / 94,6 / 224,4 / 61,3 💎).

**Impact sur les données joueurs : aucun.** Pas de nouvelle table, pas de migration. Le réglage est rangé
dans le contenu (JSON) des versions et du brouillon du catalogue. Votre brouillon de missions en production
(image « Briseur ») est lu sans changement.

### 6. Déploiement

- SHA déployé : **`d9a96a0`** le 05/11 à 18:23 (Bruxelles). `main` a avancé en avance rapide depuis `b4d6ae4`
  (inclut aussi les commits de rapport de #78), puis `scripts/deploy.sh` de la release a été exécuté.
- **Avant** : `npm ci` + `npm test` sur le SHA exact : 795/795. Une copie de la base de production a été
  démarrée en `NODE_ENV=production` (port 3122) : `/health` et `/api/version` OK. Les empreintes (lignes et
  hachage) de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking` sont
  **identiques**, la liste des tables est **identique**. Copie supprimée.
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261105-182258-pre-deploy-d9a96a0.sqlite`.
- **Après** : dig.lodygames.com et dig.lodylands.com renvoient 200 et `/api/version` = `1.0.0+d9a96a0` ;
  journal sans erreur ; `quick_check` ok ; empreintes identiques à la sauvegarde ; drapeau du moteur absent
  (donc OFF) ; brouillon du catalogue toujours présent ; page admin servie avec la nouvelle carte.
- **Retour arrière** : `git -C /home/ubuntu/Dig reset --keep b4d6ae4` puis `sudo systemctl restart dig`.
  Aucune dépendance modifiée, aucun schéma modifié.

**Recette courte (5 min, quand vous serez disponible ; rien n'est activé pour les joueurs)** :

1. Admin → 🎯 Missions → carte **« 🎁 Bonus trois missions »** : « Aucun bonus (jeu actuel) ».
2. Simulateur : source **« Proposition adaptative »**, 7 jours, les 4 profils, « Simuler ». Sous chaque
   journée complète, une ligne « 🎁 bonus trois missions (si activé) » apparaît. Sous chaque profil, le total
   s'affiche avec la part des pièces et des gemmes du minage (rien n'est écrit).
3. Facultatif : « Modifier le bonus… » → « Remplir avec le barème proposé » → ajustez → « Enregistrer dans le
   brouillon ». Simulez ensuite avec la source « Brouillon ». Pour retirer le bonus du brouillon : supprimez
   tous les paliers (✕), puis « Enregistrer dans le brouillon ».
   ⚠️ N'utilisez pas « Abandonner le brouillon » : vous perdriez aussi votre image « Briseur ».

Classement : **Après lancement.**

### 7. Choix techniques faits seul

- **Montants fixes par palier, pas un pourcentage** : la demande « plus élevé pour un joueur avancé, sans boule
  de neige » est tenue par 4 paliers fixes. Le bonus reste inférieur à 3 % des pièces du minage à toute
  profondeur, et le plafond de 3 gemmes est vérifié à l'enregistrement.
- **Réglage du catalogue plutôt que de #49** : le bonus dépend des missions du jour (même version, même
  publication, même retour arrière). Le réglage `missionSetBonus` de #49 reste une référence, et le barème A
  n'est pas approuvé (question 2 ci-dessous).
- **Pas de branchement dans le moteur** : le propriétaire demande « brouillon ou drapeau OFF » et aucun changement
  effectif. Le moteur serveur ne lit donc pas le réglage, même publié. Le branchement (réclamation unique du
  bonus en une transaction, registre de gemmes #49) se fera après votre validation du barème.
- **Simulation #49 sur les missions actuelles** : le simulateur de saison de #49 tire les missions du jeu
  actuel. Ses chiffres sont une borne basse. Le simulateur du catalogue donne la borne haute, avec les
  objectifs adaptés.

### 8. Décisions demandées au propriétaire

1. **Barème du bonus** : a) adopter les paliers proposés (1 💎 pour tous, 2 💎 dès 300 m ; 300 / 2 000 /
   10 000 / 40 000 pièces) ; b) 1 💎 pour tous sans deuxième gemme, avec les paliers de pièces ; c) l'ajuster
   dans la fenêtre. *Recommandation : a)* (au plus +7 💎 par semaine, surtout absorbés par le plafond chez les
   assidus).
2. **Lien avec #49** : le bonus des missions **remplace** le « bonus trois missions » fixe du barème A (pas de
   cumul) ? *Recommandation : oui, remplacer.*
3. **Ensuite** : autorisez-vous le branchement dans le moteur serveur, derrière le drapeau OFF, une fois 1 et 2
   tranchés ? Il suivrait la recette en Pilote sur votre compte testeur. *Recommandation : oui.*

Les questions précédentes restent ouvertes et inchangées : barème des objectifs par profondeur, gemmes des
débutants (le bonus est l'option « c », désormais chiffrée), rotation par joueur et minuit Bruxelles, ordre
d'activation.

### 9. Restant à réaliser

- Branchement du bonus dans le moteur serveur et le jeu, après validation (question 3). **Après lancement.**
- Activation Pilote puis « Tous les joueurs », sur votre décision. **Après lancement.**
- Restants des sessions précédentes : nouveaux compteurs (blocs cassés à la main, coffres achetés, fragments,
  #71), aide IA pour les textes. **Après lancement.**

---

## Session du 05/11/2026, après-midi (DIGORCH) — étape B technique : attribution et réclamation côté serveur, drapeau OFF

Suite au commentaire du propriétaire du 05/11 (15:59 Bruxelles) : « étape B technique en autonomie, derrière un
drapeau OFF, dans des bases de test ; pas d'activation pour les joueurs, ni de nouveau barème ou
récompense ; ne pas refaire le catalogue/simulateur ; recette courte de l'étape A ; récapitulatif des
décisions économiques pour l'activation ; coordonner #49 ».

### 1. État réel

**Déployé en production (SHA 8bd26c6), drapeau sur « Désactivé ». En attente de recette.**
Les joueurs ne voient **aucun changement**. Vérifié en production : missions d'origine, PC et mobile.
L'étape A (catalogue, simulateur) n'a pas été refaite. Aucun barème, aucune récompense, aucune rotation
de production n'a été modifié.

### 2. Résultat et changements

**Moteur côté serveur** (`server/missionsLive.js`, nouveau) :

- **Drapeau à 3 positions**, enregistré en base et journalisé en ajout seul. La valeur par défaut est
  `off` (aucune ligne de réglage en production).
  - `off` : jeu inchangé.
  - `pilot` : seuls les comptes listés reçoivent les missions du serveur (recette sur un compte testeur).
  - `on` : tous les joueurs connectés ; une note est obligatoire (votre décision).
- **Attribution** : une fois par joueur et par jour. Le jour change à **minuit Europe/Bruxelles**.
  - Les missions sont tirées dans la **version publiée** du catalogue, avec la rotation qui y est
    définie (origine ou adaptative).
  - Le profil vient de la sauvegarde serveur : profondeur, améliorations, ancienneté du compte.
  - L'anti-répétition s'appuie sur les jours précédents du joueur.
  - Clé primaire joueur + jour : un F5, un autre onglet ou un autre appareil donnent les mêmes missions.
  - **Publier une nouvelle version ne change pas les missions déjà attribuées.**
  - Avec la v1 en vigueur, la rotation d'origine donne exactement les missions actuelles du jeu (test).
- **Progression** : elle est lue dans la **sauvegarde serveur** à chaque sauvegarde acceptée, jamais dans
  une valeur envoyée à part.
  - Elle se cumule : une hausse s'ajoute, une baisse (fin de saison, réinitialisation, autre appareil)
    ne retire rien.
  - Un gain de blocs ou de mètres supérieur aux blocs validés par le serveur (#38) est **noté**, sans
    jamais bloquer (même politique que le mode observation).
- **Réclamation** : tout se fait en **une seule transaction**.
  - Contrôles : appareil qui a la main (#35), mission terminée, journée en cours.
  - Une ligne de réclamation (joueur + jour + emplacement) est écrite en ajout seul.
  - Les pièces et gemmes sont créditées dans la sauvegarde, avec une nouvelle révision.
  - Une deuxième réclamation (double clic, F5, deux appareils, requêtes simultanées) renvoie la première
    **sans recréditer**.
  - Si le registre de gemmes #49 est actif, les gemmes de mission y sont créditées comme gain serveur
    (idempotent) et ne consomment plus l'allocation quotidienne « déclarée ».

**Routes** :

- `GET /api/me/missions` : renvoie `{ live:false }` quand le drapeau est OFF.
- `POST /api/me/missions/claim`.
- Admin : `GET/PUT /api/admin/missions/live` et `GET /api/admin/missions/live/player?username=` (lecture
  seule).

**Jeu** (`public/js/dailyMissions.js`, `main.js`) :

- Le jeu n'utilise les missions du serveur que si celui-ci répond `live:true` pour ce compte.
- Dans ce cas, l'affichage montre les noms, textes, emojis ou images du catalogue (texte échappé). La
  barre de progression combine la progression serveur et le gain local pas encore sauvegardé.
- Le bouton « Réclamer » envoie d'abord la sauvegarde, puis demande la réclamation au serveur.
- Dans tous les autres cas (invité, OFF, réseau en panne), le code d'origine s'exécute sans changement.

**Admin → 🎯 Missions** : nouvelle carte **« 🚦 Activation en jeu (étape B) »** :

- état actuel ;
- choix du mode ;
- comptes pilotes ;
- « Enregistrer… » avec une confirmation Dig (« Tous les joueurs » demande une note) ;
- « Voir les missions d'un joueur » : missions du jour, progression, réclamée ou non, 7 derniers jours ;
- journal.

**Tables ajoutées** (aucune table existante modifiée) : `mission_live_settings`, `mission_live_audit`,
`daily_mission_days`, `daily_mission_claims`.

**Tests** :

- `test/missions-live.test.js` : 6 tests.
- `test/e2e/missions-live.e2e.js` : essai navigateur.
- `test/ui-icons.test.js` : ajusté au nouveau nom de variable du rendu.

### 3. SHA, branche, procédure de test

- Branche : `feature/68-missions-quotidiennes` (commit `b9cac60`). SHA sur `develop` : **`8bd26c6`**.
- `npm test` ; tests ciblés : `node --test test/missions-live.test.js test/mission-catalog.test.js`.
- Essai navigateur, uniquement sur un serveur et une base de test :
  1. Démarrer le serveur : `PORT=3101 DB_FILE=test-68.sqlite NODE_ENV=test ADMIN_SECRET=… RATE_SAVE_MAX=1000 node server/index.js`.
  2. Lancer l'essai : `CHROME=…/chrome-headless-shell PW=…/playwright-core BASE=http://127.0.0.1:3101 ADMIN=… node test/e2e/missions-live.e2e.js`.

### 4. Vérifications effectuées

- **Drapeau OFF** : aucune ligne écrite et vue `{ live:false }`. La réclamation serveur est refusée
  (`not_live`). Le manifeste d'icônes n'est pas modifié. Dans le navigateur, un joueur connecté garde
  exactement les missions de `_generate(date)`.
- **Pilote** : seuls les comptes listés sont concernés. Nom inconnu et mode inconnu refusés. « on » sans
  note refusé. Journal protégé contre la modification et la suppression.
- **Attribution** : une seule ligne par jour. 23:30 à Bruxelles = même jour ; 00:30 = jour suivant. Le
  résultat est identique au jeu pour la v1. Une publication ne change pas les missions du jour.
- **Progression et réclamation** :
  - refusée tant que la mission n'est pas terminée ;
  - la baisse de profondeur ne retire rien ;
  - refusée hors contrôleur de partie, sans rien écrire ;
  - crédit exact et révision +1 ;
  - un rejeu ne recrédite pas ;
  - réclamations protégées contre la modification ;
  - le lendemain, une réclamation de la veille est refusée et de nouvelles missions sont attribuées.
- **Rotation adaptative** (proposition publiée dans une base de test uniquement) : le débutant à 20 m
  n'a jamais de mission « gemmes » ; l'avancé à 250 m n'a jamais « améliorations » ; les journées
  diffèrent.
- **HTTP** :
  - routes admin en 401 sans session ;
  - le téléphone sans la main est refusé (409) ;
  - **3 réclamations simultanées → un seul crédit** ;
  - une sauvegarde d'ancienne révision après la réclamation est refusée (409), le crédit n'est pas écrasé.
- **Navigateur** (Chromium, PC 1280×900 et mobile 390×844, base de test) :
  - carte « désactivé » ;
  - passage en Pilote pour un compte ;
  - jeu : 3 missions du serveur terminées ;
  - « Réclamer » : +80 pièces et carte « réclamée » ;
  - après F5 : toujours réclamée, rejeu sans crédit ;
  - inspection admin, puis retour à « Désactivé », qui rend `live:false` ;
  - aucune erreur JavaScript.
- **Suite complète** : `npm test` **788/788** sur la branche, sur `develop` et sur la release (SHA exact
  8bd26c6).

**Impact sur les données joueurs : aucun.** Quatre tables nouvelles, vides en production. Aucune
sauvegarde, aucun solde ni aucun classement n'a été touché.

### 5. Déploiement

- SHA déployé : **`8bd26c6`**, le 05/11 à 17:10 (Bruxelles). `main` a avancé en avance rapide depuis
  `922e21d`, puis `scripts/deploy.sh` de la release a été exécuté. GitHub a d'abord renvoyé une erreur
  temporaire (« commit_refs_rules ») ; la poussée a réussi au 3ᵉ essai, sans forcer.
- **Avant le déploiement** :
  - `npm ci` puis `npm test` sur le SHA exact : 788/788.
  - Copie de la base de production démarrée en `NODE_ENV=production` sur le port 3122 : `/health` et
    `/api/version` OK.
  - Empreintes (lignes + hachage) de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`,
    `player_click_tracking` **identiques** après démarrage. Seules les 4 tables ci-dessus sont ajoutées,
    vides. Copie supprimée.
  - Contrôle qu'aucune génération IA de l'atelier n'était en cours (dernière à 16:50, plus aucune
    requête depuis 16:51).
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261105-171011-pre-deploy-8bd26c6.sqlite`.
- **Après le déploiement** :
  - dig.lodygames.com et dig.lodylands.com renvoient 200 et `/api/version` = `1.0.0+8bd26c6` ;
  - journal sans erreur ; `quick_check` ok ;
  - empreintes identiques à la sauvegarde ;
  - drapeau absent (donc OFF) ;
  - votre brouillon de missions du 05/11 (image « Briseur ») est intact ;
  - jeu chargé en production sur PC et mobile : missions d'origine, aucune erreur.
- **Retour arrière** : `git -C /home/ubuntu/Dig reset --keep 922e21d` puis `sudo systemctl restart dig`.
  Aucune dépendance n'a changé, et l'ancien code ignore les tables ajoutées.

**Recette courte (environ 10 min, rien n'est activé pour les joueurs)** :

*Étape A, déjà livrée :*

1. Admin → 🎯 Missions : 6 missions, aucune fiche ouverte.
2. Ouvrir « Gemmologue » : l'aperçu indique « non » à 20 m et « oui » à 100 m.
3. Simulateur : source « Proposition adaptative », 2 jours, Débutant + Avancé, puis « Simuler ». Les
   objectifs sont plus hauts à 250 m, le débutant n'a pas de gemmes, et les deux journées diffèrent.

*Étape B, nouvelle :*

4. Carte « 🚦 Activation en jeu » : l'état indique « désactivé — jeu inchangé ».
5. Mode **Pilote**, saisir **votre compte testeur**, puis « Enregistrer… » et confirmer. Seul ce compte
   est concerné.
6. Dans le jeu, avec ce compte, ouvrir l'onglet Quotidien. Vous voyez les missions du serveur (avec la
   v1 en vigueur, ce sont les 3 missions habituelles du jour). Jouez jusqu'à en terminer une, puis
   « Réclamer ». Le crédit apparaît une seule fois. Après F5 ou sur un deuxième appareil, la mission
   reste « réclamée » et le bouton ne recrédite pas.
7. Admin : « Voir les missions d'un joueur » avec ce compte affiche progression et « réclamée ».
8. Remettre le mode sur **Désactivé**. Le jeu revient aux missions calculées par le navigateur. Les
   réclamations faites restent acquises.

Classement : **Après lancement** (le jeu actuel fonctionne ; l'étape B prépare la variété et la
sécurité des missions).

### 6. Choix techniques faits seul

- **Mode pilote en plus de OFF/ON** : il permet de recetter en production sur un seul compte, sans
  activer quoi que ce soit pour les joueurs. Le manifeste d'icônes (images des missions pour tous)
  n'est concerné qu'en mode `on`.
- **Jour serveur = minuit Europe/Bruxelles** : le serveur ne connaît pas le fuseau du navigateur. Le
  réglage « minuit du navigateur » du catalogue reste valable pour le jeu actuel seulement (question 3
  ci-dessous).
- **Progression = sauvegarde serveur cumulée** : ce sont les mêmes compteurs que le moteur, sans
  nouvelle règle de validation bloquante. Le contrôle par les blocs validés (#38) reste en observation,
  comme pour #77.
- **Récompense figée à l'attribution** : c'est celle de la version publiée au moment du tirage. Une
  publication en cours de journée ne change rien pour le jour même.
- **Mission gemmes et registre #49** : crédit serveur idempotent (`mission:<jour>:<emplacement>`)
  lorsque le registre est actif. L'allocation de 8 💎/jour de #49 pourrait alors être abaissée, mais
  cela relève de #49 et n'a pas été modifié.
- **Ancien onglet ouvert au moment d'une activation** : une page chargée avant le déploiement garde les
  missions du navigateur jusqu'à son rechargement. Activer de préférence quelques minutes après un
  déploiement, ou après avoir rechargé.

### 7. Récapitulatif des décisions économiques avant activation (avec #49)

L'activation « Tous les joueurs » est techniquement prête. Elle attend seulement vos choix :

1. **Barème des objectifs par profondeur.** Options : publier la proposition (simulateur, source
   « Proposition »), l'ajuster, ou garder la v1 (objectifs fixes, 33 % des missions d'un débutant à 20 m
   impossibles). *Recommandation : publier la proposition.*
2. **Gemmes des débutants sous 35 m** : a) accepter qu'ils n'en gagnent pas par les missions ;
   b) +1 💎 aux coffres dès 3 ; c) bonus « trois missions » (`missionSetBonus`, à 1 dans le barème A
   de #49, en brouillon). *Recommandation : a) ou c), à trancher avec le barème A de #49.*
3. **Rotation par joueur et changement de jour à minuit Bruxelles.** *Recommandation : oui aux deux.*
   C'est déjà le cas côté serveur pour le jour ; « par joueur » fait partie de la proposition.
4. **Ordre d'activation.** Proposé : Pilote sur votre compte testeur (recette ci-dessus), puis « Tous
   les joueurs » une fois 1 à 3 tranchés.

Aucune de ces options ne rend la progression achetable : les récompenses des missions ne s'achètent
pas et ne dépendent ni d'achats ni de publicités. Il n'y a donc pas de pay-to-win.

### 8. Décisions demandées au propriétaire

Les questions 1 à 4 du § 7. Aucune n'empêche la recette en mode Pilote.

### 9. Restant à réaliser

- Activation « Tous les joueurs » après vos décisions (une note dans la carte suffit). **Après lancement.**
- Nouveaux compteurs pour les types indisponibles : blocs cassés à la main, coffres achetés, fragments,
  pioche à charges (#71). Ils apporteraient plus de variété. **Après lancement.**
- Aide IA pour les textes des missions (sur demande). **Après lancement.**

---

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
