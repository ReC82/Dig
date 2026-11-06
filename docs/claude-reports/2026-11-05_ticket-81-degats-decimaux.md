# Ticket #81 — Dégâts décimaux et PV précis : affichage arrondi par défaut, détails optionnels, futurs micro-bonus d'événements

Lien : https://github.com/ReC82/Dig/issues/81 — branche `feature/81-degats-decimaux`.

## 0. Session du 06/11/2026 (14:00, Bruxelles) — recette #81-B : simulateur expliqué et audité

### 0.1 État réel

**Déployé en production (SHA `8cf6674`), en attente de recette #81-B.**

- Recettes du propriétaire du 06/11 : #81-A ✅ (option persistante), #81-C ✅ (bloc et PV repris après F5), #81-D ✅ (brouillon impossible à activer).
- #81-B ⚠️ : la simulation s'affichait, mais elle était incompréhensible et ses chiffres devaient être audités. Cette session la corrige.
- **Aucun bonus n'est actif ni transmis au jeu.** Aucun taux, aucun équilibrage et aucune donnée de joueur n'ont été modifiés.
- Classement MVP : **Après lancement** (outil admin de préparation).

### 0.2 Demande du propriétaire (commentaire #81-B)

1. Des explications en français non technique : définition de chaque colonne, un exemple guidé, des aides ⓘ.
2. Un audit mathématique indépendant des chiffres 193,92 → 188,98, « +2,6 % », « 30,9 % » et des « 0 % ».
3. Un calendrier clair. La règle ET doit être expliquée, et le statut réel « brouillon » séparé de « serait actif ».
4. Le champ « Souvenir lié » doit être compréhensible.
5. Un tableau lisible sur PC et sur mobile.

### 0.3 Audit mathématique : une vraie erreur de modèle, corrigée

**Constat.**
- L'ancienne simulation reproduisait **exactement** les chiffres vus par le propriétaire : 193,92 → 188,98 ; 97,23 → 95,68 ; 39,2 → 38,89 ; 19,91 → 19,91.
- Son arithmétique était donc juste, mais **son modèle ne correspondait pas au moteur du jeu**.
- Elle supposait qu'un bloc « Pierre » a toujours les PV de la Pierre (83 PV à 50 m).
- Or, dans le jeu (`Blocks.spawn`, décision #32 option A), **la nature du bloc et sa résistance sont tirées séparément** :
  - la nature est ce que le joueur voit, et ce que vise le bonus. Elle est tirée avec la Chance ;
  - les PV sont tirés à part, sur le même tirage mais sans la Chance.
- Un bloc « Pierre » peut donc avoir les PV de n'importe quel bloc possible : 21, 83, 138, 262… jusqu'à 757 PV à 50 m.
- `main.js` applique le bonus selon `Blocks.current.type`, c'est-à-dire selon la nature du bloc.

**Conséquence.** L'ancienne simulation **sous-estimait le gain d'environ 2,5 fois**, et ses « 0 % » aux dégâts 10, 15 et 25 étaient faux.

**Chiffres corrigés** : 50 m, +0,25 sur la Pierre, sans Chance, catalogue publié v4.

| Dégâts de base | Coups/bloc sans | avec (ancien) | **avec (corrigé)** | Coups en moins | Blocs en plus | Coups économisés / 100 blocs |
|---|---|---|---|---|---|---|
| 1 | 193,92 | 188,98 | **182,12** | −6,09 % | +6,48 % | ≈ 1 180 |
| 2 | 97,23 | 95,68 | **93,94** | −3,38 % | +3,50 % | ≈ 328 |
| 5 | 39,20 | 38,89 | **38,62** | −1,48 % | +1,50 % | ≈ 58 |
| 10 | 19,91 | 19,91 (0 %) | **19,77** | −0,67 % | +0,67 % | ≈ 13 |
| 15 | 13,47 | 13,47 (0 %) | **13,43** | −0,32 % | +0,32 % | ≈ 4 |
| 25 | 8,30 | 8,30 (0 %) | **8,29** | −0,13 % | +0,13 % | ≈ 1 |

**Définitions vérifiées.**
- **Coups en moins** = 1 − (avec ÷ sans).
- **Blocs en plus pour le même nombre de coups** = (sans ÷ avec) − 1.
- L'ancien libellé « descente plus rapide +2,6 % » correspondait au second calcul. Ce libellé est remplacé : seul le nombre de frappes est modélisé, pas un temps chronométré.

**La part de 30,9 % est confirmée.** À 50 m, la Pierre a un poids de 60 sur un total de 194,45, soit 30,86 %.
- C'est la part des blocs Pierre réellement rencontrés **sans Chance**.
- Avec de la Chance, cette part baisse un peu : la Pierre est commune, et la Chance favorise les blocs rares. La simulation a désormais un champ « niveau de Chance » (0 à 12).

**Pourquoi le gain est faible, voire nul, à haut niveau de dégâts.**
- Un coup de moins n'est gagné que si `ceil(PV ÷ (base + bonus))` passe à l'entier inférieur.
- Exemple : 83 PV ÷ 25 = 3,32, soit 4 coups ; 83 ÷ 25,25 = 3,29, soit toujours 4 coups.
- À 25 dégâts, seuls 3,6 % des PV possibles franchissent ce seuil : le gain est faible mais réel.
- Le simulateur distingue désormais un **vrai 0 %** (aucun bloc ne gagne de coup) d'un gain **inférieur à 0,01 %**.

**Écart entre la moyenne et le hasard réel.**
- La moyenne exacte est de 1 180 coups économisés pour 100 blocs, avec 1 dégât de base.
- Sur 100 blocs réellement minés, le résultat varie environ **de 701 à 1 659 coups dans 95 % des cas**. Ce calcul utilise l'écart-type exact et une approximation normale.
- L'écart se resserre quand le nombre de blocs augmente.

**Vérifications indépendantes** (`test/micro-bonus-sim-81b.test.js`, 8 tests) :
1. **Calcul alternatif** : la table de blocs est recopiée à la main, et le test vérifie qu'elle est identique au catalogue d'origine. Le calcul n'appelle aucune fonction du moteur ni du serveur. Il donne les mêmes valeurs au centième, à 5, 12, 13, 30, 50, 75 et 149 m, et avec une Chance de 0, 5 et 12.
2. **Monte-Carlo sur le vrai `Blocks.spawn`** : 20 000 blocs, graine fixe, bonus appliqué selon la nature du bloc comme dans `main.js`. Les coups économisés concordent avec le simulateur à moins de 4 erreurs-types, à 1 et à 10 dégâts. L'ancien modèle (494 coups pour 100 blocs, 0 à 10 dégâts) est explicitement écarté.
3. **Bornes** :
   - vrai zéro : Pierre absente à 4 m, et aucun seuil franchi à 1 m avec 25 dégâts ;
   - dates repères : la veille du début à 23:59, le début à 00:00, la fin à 23:59 et le lendemain à 00:00, heure de Bruxelles ;
   - les changements d'heure sont couverts : 29/03/2026 et 25/10/2026, un jour unique en hiver.

### 0.4 Ce qui change dans l'admin (✨ Micro-bonus)

- **Tableau** :
  - colonnes renommées : « Dégâts par coup (sans bonus) », « Coups par bloc — moyenne sans / avec », « Coups en moins », « Coups économisés pour 100 blocs », « Blocs visés » ;
  - nombres en français (193,92 ; ≈ 1 180) ;
  - « 0 % (aucun) » et « < 0,01 % » sont distingués ;
  - lisible à 390 px : le tableau défile dans son cadre, la page ne déborde pas.
- **« Comment lire cette simulation ? »** (dépliable) :
  - définition de chaque colonne ;
  - exemple guidé : « 5 PV : 1 dégât → 5 coups ; 1,25 → 4 coups » ;
  - moyenne pondérée chiffrée : « 30,9 % × 155,68 + 69,1 % × 193,92 ≈ 182,12 » ;
  - raison d'un gain faible ou nul, et fourchette due au hasard ;
  - hypothèses affichées : PV sans relique, tirages séparés, niveau de Chance, coups manuels seulement.
  Tous les nombres de ces textes viennent de la simulation affichée : aucun n'est inventé.
- **« Blocs possibles à X m »** (dépliable) : chaque bloc avec sa chance d'apparition, ses PV et s'il est visé par le bonus.
- **Calendrier** :
  - encadré « aucun mois/jour coché = tous ; plusieurs conditions = toutes vraies (ET) » ;
  - aides ⓘ : jours entiers de 00:00 à 23:59 à Bruxelles, date de début et date de fin incluses ;
  - dates repères ajoutées pour les bornes « du / au ».
- **Statut** :
  - « 📅 Calendrier : aujourd'hui, ce bonus serait actif s'il était publié » est séparé de « 🔒 Statut réel : brouillon — jamais appliqué au jeu » ;
  - dans la liste, les colonnes deviennent « Calendrier aujourd'hui (si publié) » et « Statut réel » ;
  - le mot « Actif » n'apparaît plus seul pour un brouillon.
- **Souvenir lié** :
  - les deux champs d'identifiants internes sont remplacés par une liste lisible, « Noël sous la mine — Charbon du Père Noël » ;
  - une aide ⓘ explique que c'est un simple lien de préparation ;
  - un ancien lien vers un objet disparu est conservé et marqué « Introuvable ».
- Aides ⓘ également sur « Dégâts ajoutés », « Cible », « Profondeur » et « Chance ».

Fichiers modifiés :
- `server/microBonusDrafts.js` : `simulate`, `explain`, `hypotheses`, `stateSamples`, souvenirs ;
- `server/index.js` : paramètre `luck` de l'aperçu ;
- `public/admin/index.html`, `admin.js` et `admin.css` ;
- tests : `test/micro-bonus-sim-81b.test.js` (nouveau), `test/decimal-damage-81.test.js` et `test/e2e/decimal-damage.e2e.js`.

### 0.5 Tests et déploiement

- `npm test` : 841/841 sur la branche, sur `develop` et sur le SHA exact de release `8cf6674`.
- e2e Chromium `test/e2e/decimal-damage.e2e.js` : 31/31 contrôles (PC 1280, mobile 390, admin PC et admin 390), dont 7 nouveaux #81-B.
  - Limite connue : sur 4 passages, 2 ont expiré dans la partie **joueur** (`strikes`, attente de l'animation du bloc), un code que cette session n'a pas modifié. C'est une instabilité de rythme du test. Le passage complet suivant a réussi.
- Copie de la base de production en `NODE_ENV=production` : empreintes des 6 tables identiques, **aucune table ni colonne ajoutée** (pas de migration).
- Avant de déployer : aucun appel IA en cours (dernier appel à 11:52 UTC).
- **Déploiement `f84e594` → `8cf6674`** par `scripts/deploy.sh` (release) :
  - sauvegarde vérifiée : `~/backups/dig/dig-20261106-140106-pre-deploy-8cf6674.sqlite` ;
  - les 2 domaines répondent 200, version `1.0.0+8cf6674` ;
  - journal sans erreur, `quick_check` ok ;
  - empreintes de la production identiques à la sauvegarde pré-déploiement ;
  - essai invité dans Chromium en production (PC et 390) : dégâts « 1 », `eventBonuses` vide, pas de débordement, aucune erreur.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep f84e594` puis `sudo systemctl restart dig`. Il n'y a ni migration ni changement de `package-lock.json`.

### 0.6 Test fonctionnel #81-B à refaire (environ 4 min)

1. Ouvrir /admin/ (F5), puis ✨ Micro-bonus (brouillons) → ＋ Ajouter → exemple « +0,25 sur la pierre ». Laisser 50 m et Chance 0.
   - **Attendu** : deux lignes séparées, « 📅 … serait actif s'il était publié » et « 🔒 Statut réel : brouillon — jamais appliqué ».
2. **Lire le tableau.**
   - **Attendu**, ligne « 1 » : 193,92 → 182,12, −6,09 %, ≈ 1 180 coups pour 100 blocs, 30,9 % de blocs visés.
   - **Attendu**, lignes 10, 15 et 25 : −0,67 %, −0,32 % et −0,13 % (et non plus 0 %).
3. Déplier **« Comment lire cette simulation ? »**.
   - **Attendu** : l'exemple 5 PV → 4 coups, puis la moyenne « 30,9 % × 155,68 + 69,1 % × 193,92 ≈ 182,12 ».
   - Vérifier la concordance avec le tableau : 182,12 doit être identique.
4. **Calendrier** : cocher novembre et mardi.
   - **Attendu** : le texte devient « les mardis en novembre », et les dates repères indiquent « Serait inactif » le lundi 02/11 à 23:59 et « Serait actif » le mardi 03/11 à 00:00.
   - Décocher ensuite novembre et mardi, puis saisir « Du 24/12 au 24/12 ». **Attendu** : « Pas encore commencé » le 23/12 à 23:59, « Serait actif » le 24/12 à 00:00 et à 23:59, « Serait terminé » le 25/12 à 00:00.
5. **Souvenir lié** : la liste propose « Noël sous la mine — … ». Cliquer sur les ⓘ.
6. Ne pas enregistrer, ou enregistrer : la ligne indique « 🔒 Brouillon — jamais appliqué », et rien ne change en jeu.

### 0.7 Choix techniques faits seul

- **Le simulateur suit le moteur tel qu'il est** : PV tirés séparément de la nature (#32). La règle du moteur ne change pas, et aucun taux n'est modifié.
- **Calcul exact plutôt que tirage aléatoire** dans l'admin : résultat reproductible et sans bruit. Le Monte-Carlo sert uniquement de contrôle dans les tests.
- Champ **Chance** dans la simulation : il fallait répondre à la question « 30,9 % correspond-il aux blocs réellement rencontrés ? ». Plafond : 12, le niveau max de l'amélioration, sans les reliques de Chance.
- Fourchette « 95 % des cas » : écart-type exact et approximation normale, avec le mot « environ ».
- Les textes d'explication sont générés côté serveur, en français seulement : l'admin n'existe qu'en français.

### 0.8 Décisions demandées au propriétaire

Il n'y a aucune nouvelle décision bloquante. Les 3 questions du 05/11 restent ouvertes et non bloquantes (§ 9). Un point est ajouté pour information :

4. **Le bonus vise la nature visible du bloc, pas sa résistance** (conséquence de #32). Un « +0,25 sur la Pierre » joue donc aussi sur une Pierre qui a les PV d'un minerai. Recommandation : garder ce comportement. C'est ce que le joueur voit, et cela ne change pas le moteur.

### 0.9 Reste à faire

- Recette #81-B par le propriétaire.
- Inchangé : activer un vrai bonus (développement dédié, `STACK_CAP` dans le plafond anti-bot, textes NL/ES/IT). Classement : Après lancement.
- À signaler : le test e2e joueur `strikes` est instable (rythme de 150 ms). Ce n'est pas un défaut du jeu. Il faudrait le corriger dans un ticket de robustesse des tests.

---

## 1. État réel — session du 05/11/2026 (20:15, Bruxelles)

**Déployé en production (SHA `5756328`), en attente de recette.**

- Pour les joueurs, rien ne change : tous les dégâts et tous les PV en jeu sont encore des entiers, et l'affichage est le même qu'avant.
- La nouvelle option « Afficher les valeurs précises » est désactivée par défaut.
- **Aucun bonus n'est actif ni transmis au jeu.** Aucune récompense, aucun coût, aucun drop et aucune donnée de joueur n'a été modifié.

Classement MVP : **Après lancement.** C'est une fondation technique sans effet visible tant qu'aucun bonus n'existe. Elle n'est pas bloquante pour partager le MVP.

## 2. Étape A — audit des nombres et des calculs

| Surface | Avant #81 | Constat |
|---|---|---|
| Dégâts par clic (`GameState.damage`) | niveau de pioche + relique « Œil du mineur » (`damage_flat`), entiers | JS `Number` (flottant binaire). Des valeurs fractionnaires ajoutées naïvement donnent des résidus : 1 + 0,1 + 0,2 = 1,3000000000000003. |
| PV max d'un bloc | `ceil(hpBase × (1 + 0,12 (prof − 1)) × (1 − réduction))` | Toujours entier. **Inchangé** : la dureté, le rythme et le calcul serveur des PV réels (#77) restent les mêmes. |
| PV restants (`Blocks.hit`) | `max(0, hp − dégâts)`, destruction si `=== 0` | Avec des flottants, 0,1 × 10 laisse 1,4e-16 PV : il faudrait un 11e coup. Le seuil n'était donc pas fiable avec des décimales. |
| Auto-Dig | `Blocks.hit(niveau + bonus)` toutes les secondes | Même moteur que le clic. Les gains hors ligne sont calculés en `floor` sur des pièces, sans effet sur les PV. |
| Pioche à charges (#71) | coup plein = dégâts, émoussée = 1 | Inchangé. Un futur bonus ne s'appliquerait pas à un coup émoussé. |
| Sauvegarde / reprise (#35) | `block.hp` enregistré, contrôlé par `Number.isFinite` | Ce format accepte déjà des décimales. Côté serveur, `seasons._claimedBlock` ne lit que `hp > 0` et `maxHp`, qui reste entier. |
| Anti-bot (#25 budget, #77 PV réels) | `MAX_CLICK_DAMAGE = 25`, `MAX_AUTODIG_DPS = 20` ; PV réels recalculés | Rien ne change tant qu'aucun bonus n'est actif. **Le jour où un bonus est activé, il faudra ajouter `STACK_CAP` à `MAX_CLICK_DAMAGE`.** Un test l'impose déjà : `GameState.eventBonuses` ne doit jamais être rempli par le code du jeu. |
| Admin des reliques (#64) | `damage_flat` et `autodig_bonus` imposés entiers | **Laissé tel quel.** Autoriser des valeurs décimales pour les reliques est une décision d'économie (#49). |
| Missions (#68), statistiques, saison et classement | comptent des blocs, des clics et la profondeur | Ils ne dépendent pas de la valeur des dégâts : aucun impact. |

Mini plan d'équilibrage :
- ~~Un bonus de +0,25 sur la pierre, avec 1 dégât de base à 50 m, rend la descente environ **2,6 %** plus rapide.~~ **Corrigé le 06/11 (§ 0.3) : −6,09 % de coups** (soit +6,48 % de blocs pour le même nombre de coups). La pierre représente environ 31 % des blocs à cette profondeur.
- Le même bonus ne donne plus que +0,8 % avec 5 dégâts de base, et presque rien au-delà. Ces chiffres viennent du simulateur du panel.
- Un micro-bonus pèse donc surtout en **début de partie**. C'est là que l'avantage au classement serait le plus visible.

## 3. Étape B — ce qui a été livré

**Moteur, calcul en centièmes entiers :**
- `Blocks.hit` calcule PV restants et dégâts en centièmes.
  - Le bloc est détruit quand il ne reste plus aucun centième : le seuil est exact et il ne reste pas de résidu.
  - Des dégâts négatifs, invalides ou inférieurs à 0,005 n'ont aucun effet.
  - Avec des entiers, le résultat est **identique** à avant. Un test le vérifie sur 342 combinaisons.
- `Blocks.hitsToBreak(hp, dmg)` donne le nombre de coups nécessaires.
- `GameState.toCents`, `fromCents` et `normAmount` sont utilisés par les reliques et les améliorations : les dégâts calculés sont ramenés au centième.
- `Blocks.resume` reprend des PV fractionnaires. Les anciennes sauvegardes, avec des PV entiers, sont reprises sans changement.

**Affichage (`public/js/numFmt.js`) :**
- Par défaut, les dégâts sont arrondis à l'entier le plus proche (1,25 → « 1 »).
- Les PV sont arrondis à l'entier supérieur : un bloc encore debout n'affiche jamais « 0 PV ».
- Une valeur positive inférieure à 1 garde ses décimales (0,5 → « 0,5 »).

**Nouvelle option dans Paramètres :**
- Section « Affichage » → « **Afficher les valeurs précises** », désactivée par défaut et mémorisée sur l'appareil (`dig.precise`).
- Elle affiche jusqu'à 2 décimales, sans zéros inutiles, avec le séparateur de la langue (FR 1,25 ; EN 1.25).
- Textes traduits en FR, EN, NL, ES et IT.

**Valeurs exactes dans les détails :**
- La description de la pioche et de l'Auto-Dig, l'aperçu « avant → après » et les bonus des reliques affichent toujours la valeur exacte au centième.
- Un petit bonus reste donc visible même si le minage l'arrondit.

**Point d'entrée des futurs bonus :**
- Le coup manuel passe par `MicroBonus.clickDamage(GameState.damage, GameState.eventBonuses, { block })`.
- `eventBonuses` est toujours vide, n'est pas sauvegardé et n'est jamais transmis par le serveur.
- L'Auto-Dig n'est volontairement pas concerné.

## 4. Étape C — micro-bonus en brouillon seulement

**Modèle déclaratif (`public/js/microBonus.js`, partagé entre le jeu et le serveur) :**
- Type : `damage_flat`.
- Intensité : de 0,01 à 1, au plus 2 décimales. Une valeur hors bornes est **refusée**, jamais tronquée en silence.
- Cible : tous les blocs, une catégorie ou un bloc.
- Calendrier : dates de début et de fin incluses, mois, jours de la semaine. Toutes les conditions se cumulent (ET) et s'évaluent sur la date civile **Europe/Brussels**.
- Cumul : addition des bonus actifs, total plafonné à `STACK_CAP = 1`.
- Un souvenir d'événement peut être lié (`source`) sans modifier l'objet.
- Textes et états disponibles en FR et EN : « +0,25 dégât par coup sur le bloc « Pierre » — les lundis », « Actif actuellement », « Inactif — actif les lundis », « Terminé le … », « Commence le … ».

**Panel admin, nouvelle rubrique « ✨ Micro-bonus (brouillons) » (Contenu & événements, `#microbonus`) :**
- Liste compacte, et fiche modale protégée contre la perte de saisie (#61).
- 4 exemples fictifs non validés, chargeables en un clic : +0,25 sur la pierre, +0,1 le lundi, +0,2 en novembre, +0,15 sur les minerais pendant 30 jours.
- « Aperçu et simulation » affiche :
  - le texte FR/EN de l'effet ;
  - l'état qu'aurait le bonus aujourd'hui s'il était activé ;
  - son état à des dates repères : lundi 23:59 ↔ mardi 00:00, 31/10 ↔ 01/11 ;
  - une simulation des coups moyens par bloc pour 1 à 25 dégâts de base ;
  - des avertissements, par exemple « effet permanent : avantage durable au classement ».
- Enregistrer, archiver et désarchiver sont possibles ; chaque écriture est journalisée.

**Garde-fous en base et côté serveur :**
- Table `micro_bonus_drafts`, avec `CHECK (status = 'draft')`, et table `micro_bonus_draft_log`. Ce sont des **ajouts seuls**.
- L'API refuse tout autre statut : « Activation impossible… ».
- Seules les routes `/api/admin/micro-bonuses*` existent, toutes protégées par `requireAdmin`. Aucune route joueur ne lit ces tables.

## 5. Équité — alternatives au bonus permanent (à arbitrer)

1. **Bonus temporaire** (dates ou mois) : actif seulement pendant l'événement, puis le souvenir reste en collection sans effet. Pas d'avantage durable. **Recommandé.**
2. **Bonus plafonné au cumul** : `STACK_CAP` à 0,25 ou 0,5 au lieu de 1. L'écart maximal entre joueurs reste ainsi borné.
3. **Bonus de confort, sans effet au classement** : par exemple un bonus limité à certaines catégories comme les coffres, ou désactivé pendant la saison compétitive.
4. **Rattrapage par le jeu** : un joueur qui a raté l'événement peut obtenir plus tard le même effet (mission, collection), sans paiement.

Le pay-to-win est exclu : aucun bonus n'est lié à un achat.

## 6. Tests et vérifications

**Automatisés :**
- `test/decimal-damage-81.test.js` : 12 tests.
  - Les entiers donnent exactement le même résultat qu'avant.
  - 0,1 × 10 = 1 coup sur 10 ; 5 PV en 4 coups de 1,25 ; 12 PV en 10 coups de 1,3 ; dégâts négatifs et NaN sans effet.
  - 3 + 0,1 + 0,2 = 3,3 pour les reliques.
  - Sauvegarde et reprise de PV fractionnaires, y compris les anciennes sauvegardes entières.
  - Affichage FR et EN.
  - Validation des bonus.
  - Calendrier : lundi↔mardi, 31/10↔01/11, 30/11↔01/12, passage à l'heure d'été du 29/03.
  - Ciblage et cumul plafonné.
  - Brouillons : la contrainte CHECK refuse un statut `active` posé directement en SQL.
  - Aucune route joueur.
- Tests existants adaptés : anti-bot (le coup passe par MicroBonus, `eventBonuses` n'est jamais rempli), pioche à charges, navigation admin.
- **Suite complète : 820/820** sur la branche et **820/820** sur le SHA exact de la release `5756328`.

**Navigateur :**
- Chromium, serveur de test port 3101, base `test-81.sqlite` supprimée ensuite : `test/e2e/decimal-damage.e2e.js`, **26/26** sur PC 1280×900, mobile 390×844 et admin.
- Valeurs entières par défaut :
  - 1,25 affiché « 1 » ;
  - 3,75 PV affichés « 4 / 5 HP » ;
  - un bloc de 5 PV détruit en 4 coups.
- Avec l'option précise :
  - « 1,25 » et « 3,75 / 5 HP » ;
  - après F5, l'option est conservée et les PV 3,75 sont repris.
- Exemple +0,25 **actif seulement dans la page de test** : 5 PV détruits en 4 coups.
- Admin : aperçu, brouillon enregistré, rien transmis au jeu.
- Aucune erreur console, aucun débordement horizontal.

**Non vérifié :**
- Le rendu sur un vrai téléphone.
- Les textes d'effet en NL et ES : ils ne servent qu'au moment d'une activation.

**Données des joueurs :** aucune réécriture. Seules 2 tables vides ont été ajoutées.

## 7. Déploiement

**Release `5756328`** (develop = merge `5756328` du code `1f8df1d`) :
- `npm ci` ; tests 820/820.
- Copie de la base de production démarrée en `NODE_ENV=production` sur le port 3122 :
  - `/health` OK ;
  - version `1.0.0+5756328` ;
  - **empreintes des 6 tables joueurs identiques** ;
  - `micro_bonus_drafts` vide ;
  - `quick_check` ok ;
  - copie supprimée.

**Mise en ligne :**
- Avance rapide de `main` : `326b31d` → `5756328`.
- `scripts/deploy.sh` (script de la release) : sauvegarde vérifiée `~/backups/dig/dig-20261105-201320-pre-deploy-5756328.sqlite`, puis service vérifié.

**Après déploiement :**
- dig.lodygames.com et dig.lodylands.com répondent 200, `/api/version` = `1.0.0+5756328`.
- `/api/admin/micro-bonuses` sans authentification renvoie 401.
- Journal du service sans erreur ; `quick_check` ok.
- Empreintes des tables joueurs : seule la sauvegarde d'un joueur en train de jouer a avancé (révision +1). C'est une progression, sans aucune perte.
- Chromium en invité sur la production (PC et 390 px) : dégâts « 1 », PV entiers, `eventBonuses` vide, aucune erreur.

**Retour arrière :** `git -C /home/ubuntu/Dig reset --keep 326b31d` puis `sudo systemctl restart dig`. Aucune modification de dépendance. Les tables ajoutées peuvent rester en place.

### Recette courte pour le propriétaire (environ 4 minutes)

1. **Niveau entier par défaut** : jouer normalement. Les dégâts en haut de l'écran et les PV du bloc s'affichent comme avant (entiers) et les blocs cassent au même rythme.
2. **Valeurs précises** : ⚙ Paramètres → « Affichage » → cocher « Afficher les valeurs précises ».
   - Les valeurs restent entières aujourd'hui, car aucun bonus fractionnaire n'existe. Par exemple « 1 », « 12 / 12 HP ».
   - Après F5, la case est toujours cochée.
   - La décocher remet l'affichage par défaut.
3. **Coups fractionnaires** : à vérifier dans l'admin, sans rien toucher en jeu.
   - Ouvrir /admin/ (F5) → Contenu & événements → ✨ Micro-bonus (brouillons) → « ＋ Ajouter » → exemple « +0,25 sur la pierre ».
   - Le tableau de simulation montre moins de coups par bloc avec le bonus (par exemple 193,92 → ~~188,98~~ 182,12 à 50 m avec 1 dégât — corrigé le 06/11, § 0.3).
   - Le calcul réel du jeu a été vérifié dans le parcours automatique : 5 PV détruits en 4 coups de 1,25.
4. **Sauvegarde / F5** : recharger la page en plein minage. Le bloc reprend avec les mêmes PV.
5. **Bonus en brouillon seulement** :
   - Enregistrer l'exemple : la ligne affiche « … — brouillon, inactif en jeu ».
   - Dans le jeu, rien ne change.
   - L'archiver ensuite si vous le souhaitez ; rien n'est supprimé.

## 8. Choix techniques faits seul

- **Centièmes entiers (virgule fixe) plutôt que flottants accumulés.**
  - Les PV restants sont stockés au centième, par exemple `8.75`, et non en nombre de centièmes. La sauvegarde reste donc lisible et compatible avec les anciens clients et le serveur.
  - Chaque coup recalcule en entiers : il n'y a pas d'accumulation d'erreurs.
- **PV max des blocs toujours entiers (`ceil`)** : la dureté et le calcul serveur #77 restent inchangés. Seuls les dégâts et les PV restants deviennent fractionnaires.
- **Affichage arrondi** : dégâts à l'entier le plus proche, PV à l'entier supérieur (pour ne jamais afficher « 0 PV » sur un bloc encore debout).
- **Option mémorisée sur l'appareil** (`localStorage`), comme le consentement publicitaire. Il n'existe pas aujourd'hui de préférences de compte côté serveur.
- **Bonus limités aux coups manuels** : pas l'Auto-Dig, pour ne pas amplifier le jeu inactif, et pas la pioche émoussée (#71).
- **Brouillons dans une table dédiée, pas dans `monthly_event_items`** :
  - un événement planifié est figé (#56) ;
  - lier un bonus ne doit modifier ni l'objet, ni son historique, ni ses chances.
- **Reliques laissées en valeurs entières** : passer à des valeurs décimales relève de #49.

## 9. Décisions demandées au propriétaire

Aucune n'est bloquante. Ces décisions ne seront utiles qu'au moment d'activer un premier bonus.

1. **Forme d'un premier bonus d'événement** :
   - (a) temporaire, actif pendant l'événement seulement ;
   - (b) permanent mais plafonné ;
   - (c) confort, hors classement.

   Recommandation : **(a)**, avec un plafond de cumul de 0,5.
2. **Plafond de cumul `STACK_CAP`** : 1 dégât aujourd'hui (borne technique). Recommandation : 0,5 si des effets permanents sont envisagés.
3. **Préférence « valeurs précises »** : mémorisée par appareil aujourd'hui. Souhaitez-vous qu'elle suive le compte ? Recommandation : pas avant le lancement.

## 10. Reste à faire (Après lancement)

- **Activation réelle d'un bonus**, sur décision du propriétaire :
  - transmission serveur des bonus d'objets possédés, jamais pris au client ;
  - `MAX_CLICK_DAMAGE += STACK_CAP` dans l'anti-bot ;
  - contrôle par #77 ;
  - texte de la fiche objet du joueur traduit en NL, ES et IT ;
  - coordination avec #56, #39 et #49.
- Éventuelles valeurs décimales pour les reliques (#64/#49), si l'économie le décide.
