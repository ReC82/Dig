# Ticket #81 — Dégâts décimaux et PV précis : affichage arrondi par défaut, détails optionnels, futurs micro-bonus d'événements

Lien : https://github.com/ReC82/Dig/issues/81 — branche `feature/81-degats-decimaux`.

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
- Un bonus de +0,25 sur la pierre, avec 1 dégât de base à 50 m, rend la descente environ **2,6 %** plus rapide. La pierre représente environ 31 % des blocs à cette profondeur.
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
   - Le tableau de simulation montre moins de coups par bloc avec le bonus (par exemple 193,92 → 188,98 à 50 m avec 1 dégât).
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
