# Ticket #74 — [P0][INCIDENT] Enquête sur le test de résistance du 04/11 et protections anti-bot non effectives

- Ticket : [#74](https://github.com/ReC82/Dig/issues/74) — liés : #25 (anti-bot), #73 (classement aux blocs manuels), #9/#10 (profondeur serveur, anti-autoclic), #49 (économie, registre de gemmes), #75 (reset joueur)
- Session : 05/11/2026 (nuit), branche `fix/74-gabpok8-antibot`
- **État réel : Déployé en production (SHA `14d2e8b`) — en attente de recette du propriétaire**

Toutes les heures sont en **UTC** (heure de Bruxelles = UTC + 1). Le compte étudié est appelé ci-dessous « le compte testeur » (le compte invité nommé dans le ticket). Aucune adresse IP, adresse e-mail, aucun jeton ni code d'invitation n'apparaît dans ce rapport.

---

## 1. Résumé en 10 lignes

1. Le compte testeur est passé de **14 m à 1 003 m en 72 minutes** (21:45 → 22:57), puis 1 011 m à 23:04, juste avant le reset saisonnier lancé par le propriétaire (~23:05).
2. Il a envoyé **78 364 clics** pendant ce temps, à **30–51 clics/s soutenus pendant une heure**, avec **97 à 99 % des intervalles sous 40 ms**. Aucun humain ne tient ce rythme : un **autoclicker (outil externe)** est **très probable**.
3. Ces clics étaient « de confiance » pour le navigateur (`isTrusted`) : aucun signal `untrusted_clicks`. L'outil agit donc au niveau du système (autoclicker PC ou application d'accessibilité Android), pas par un script dans la page.
4. **Aucune falsification de sauvegarde ni de requête n'a été constatée** : les compteurs sont cohérents entre eux (1 002 blocs détruits = profondeur − 1) et avec la physique du jeu.
5. **Bug de comptage prouvé** : 954 des 1 002 blocs ont été cassés par des clics jugés suspects. Ils ont donné profondeur et gains, mais n'ont été comptés **ni comme manuels ni comme Auto-Dig**. D'où « 1 003 m avec 30 blocs manuels ».
6. **L'Auto-Dig n'a pas causé la progression** : il n'a cassé que 18 blocs (1,8 %). Son niveau max (65 gemmes) est une **conséquence** : 72 gemmes trouvées en cassant ~1 000 blocs.
7. L'anti-bot **a bien vu** (score de risque 74,9, niveau 2, 13 événements `cps_flagged`) mais **n'a rien appliqué** : le mode `shadow` est conçu ainsi (`applied:false`).
8. Le budget de dégâts `enforce` **a tourné, mais ne pouvait pas freiner ce cas** : il admet 20 clics/s × 1,25 × 25 dégâts avec une borne de PV très basse (bloc le plus faible, −50 %). Avec cette borne, 14 → 1 003 m ne demandent que **6 minutes** au rythme admis ; le crédit est resté au plafond (393 750 PV), écart 0.
9. Le reste de l'économie (pièces, améliorations, Auto-Dig, reliques) est **calculé par le client** : le serveur ne contrôle aucun gain de pièces. 506 coffres rares ont été achetés avec ces pièces, d'où les reliques au max et un boost ×3 cumulé sur ~10 h.
10. **Correctif livré** (§ 6) : limiteur de cadence dans le jeu (au-delà de 12 coups/s soutenus, avec une rafale de 36 coups tolérée, un coup ne fait **ni dégât ni gain**), blocs suspects enfin comptés, serveur aligné sur la même cadence. Sur le rejeu, la progression de l'autoclicker tombe à **× 0,30**. Les joueurs humains, y compris rapides et sur mobile, ne sont jamais freinés.

**Verdict : défaut de détection et de réponse prouvé, bug de comptage prouvé, outil externe très probable, aucune faille de sauvegarde exploitée.** Défaut d'équilibrage secondaire : les boosts des coffres se cumulent en durée. Le compte testeur **n'a pas été modifié** pendant l'enquête.

---

## 2. Sources (lecture seule) et niveau de preuve

Avant toute analyse, les preuves ont été préservées dans `~/forensics/ticket-74/` (dossier privé 700, hors dépôt, jamais transmis), empreintes SHA-256 dans `SHA256SUMS`. Cela couvre :
- `dig-20261104-224554-pre-deploy-5fc77d9` : état à **21:45:43**, 2 min après l'inscription ;
- `dig-20261104-235755-pre-deploy-53d19ac` : état à **22:57:45**, **dernier état complet de l'essai n° 1**, avant le reset ;
- `dig-20261105-005305-pre-deploy-3f726c2` : état à 23:53, après le reset ;
- une copie de la base actuelle, prise à 00:00.

Pour éviter la rotation des sauvegardes, les originaux restent aussi dans `~/backups/dig/`.

Le niveau de preuve est indiqué partout :
- **mesuré** : valeur lue en base ou dans le journal ;
- **inféré** : calculé à partir de valeurs mesurées ;
- **non journalisé** : n'existe nulle part. **Les achats d'améliorations n'ont aucun historique** : seul leur état final est connu, et aucune séquence n'est inventée ici.

| Source | Contenu | Période |
|---|---|---|
| `user_saves` (3 sauvegardes + base actuelle) | état complet : profondeur, pièces, gemmes, niveaux, reliques, coffres achetés, compteurs | 21:45, 22:57, 23:53, 00:00 |
| `anticheat_logs` (300 lignes) | clics et durée de chaque lot réduit ou signalé, cadence, régularité | 21:46 → 00:00 |
| `security_events` (44) | `burst_clicks`, `cps_flagged`, `cps_reduced`, `depth_rejected`, `risk_level` | 21:46 → 23:59 |
| `user_events` (773) | chaque ouverture de coffre de boutique (type, nature du gain) | 21:55 → 23:59 |
| `player_badges` | badge « 100 m » avec horodatage | 21:49 |
| `collectionMeta` de la sauvegarde | heure de chaque objet de collection trouvé | 21:46 → 21:58 |
| `antibot_save_samples` | une ligne par sauvegarde, télémétrie (types de pointeur, `isTrusted`) | **après 23:53 seulement** (déploiement #25) |
| `season_rankings`, `player_depth_tracking`, `risk_scores` | profondeur retenue, budget, score de risque | états ci-dessus |

Ce qui n'est **pas journalisé** : l'historique des achats d'améliorations et de reliques, la profondeur à chaque minute avant 23:53, le type de pointeur et `isTrusted` avant 23:53, et les captures du propriétaire (269 m, 386 m, 736 m), qui ne peuvent pas être datées à la minute.

---

## 3. Chronologie : heure → activité → évolution → décision anti-bot

| Heure (UTC) | Activité (preuve) | Évolution | Décision anti-bot |
|---|---|---|---|
| 21:43:36 | inscription (mesuré) | — | — |
| 21:45:43 | 1er état connu (mesuré) | 14 m, 157 clics, 13 blocs manuels, pioche niv. 1, 123 pièces | aucune |
| 21:46:10 → 21:47:19 | lots de 357 à 530 clics en 9,5–16 s : **22 à 51 clics/s**, 346/357 à 505/509 intervalles < 40 ms (mesuré) | collection : 2 objets à 21:46 | `burst_clicks` + `cps_flagged` à chaque lot ; **risque 0 → 1 à 21:46:43, `applied:false`** ; blocs manuels validés × 0,16–0,36 |
| 21:49:43 | badge « profondeur 100 m » (mesuré) | **100 m, 6 min après l'inscription** | badge accordé (profondeur validée) |
| 21:50 → 22:40 | cadence moyenne par tranche de 10 min : **31,2 / 31,2 / 28,3 / 30,1 / 34,8 clics/s** (mesuré, somme clics / somme durées des lots journalisés) | 269 m puis 386 m (captures non datées) ; 100 → ~950 m (inféré) | `cps_flagged` toutes les 3–5 min ; aucune réduction de profondeur ni de gains |
| 21:55:46 → 22:35 | **417 coffres ouverts entre 22:10 et 22:30** (mesuré) | pièces converties en reliques et boosts | aucun contrôle (pièces fournies par le client) |
| 22:42:37 | `depth_rejected` : 955 m déclarés, **955 m retenus**, 12 115 clics en attente rejetés (mesuré) | 955 m | **risque 1 → 2, `applied:false`** ; profondeur retenue inchangée |
| 22:54:32 | profondeur 1 003 m atteinte (mesuré) | 1 003 m | aucune |
| 22:57:45 | **dernier état complet de l'essai n° 1** (mesuré, § 4) | 1 003 m, 78 364 clics, 30 blocs manuels (18 validés), 18 Auto-Dig | score de risque 74,9 (niveau 2), non appliqué |
| 23:04:21 | 1 011 m (mesuré : `max_depth_reached_at`) | max classé 1 011 m | aucune |
| ~23:05 | **reset saisonnier par l'admin** (inféré : entre 23:04:21, dernière progression, et 23:06:50, 1er objet de l'essai n° 2) | sauvegarde réécrite ; classement **non** réinitialisé (1 011 m restent) | — (#75) |
| 23:05 → 00:00 | **≈ 9 clics/s**, uniquement tactile, 100 % `isTrusted`, variabilité 0,74–0,79 (mesuré, télémétrie) | 0 → 377 m | `cps_reduced` (au-delà de 8 clics/s) ; profil compatible avec une frappe humaine rapide à plusieurs doigts |

Les captures du propriétaire (269 m, 386 m, 736 m avec 17 blocs manuels) se placent entre 21:49 (100 m) et 22:42 (955 m). « 736 m / 17 blocs manuels » colle exactement au bug de comptage du § 5.2.

---

## 4. État du compte au dernier instant de l'essai n° 1 (22:57:45, mesuré)

| Rubrique | 21:45:43 | 22:57:45 | Remarque |
|---|---|---|---|
| Profondeur déclarée / retenue | 14 / 14 | 1 003 / 1 003 | budget jamais limitant (§ 5.4) |
| Clics manuels (`manualClicks`) | 157 | **78 364** | 18,1 clics/s en moyenne sur 72 min, pauses comprises |
| Clics suspects (`suspiciousScore`) | 0 | **76 783 (98 %)** | jugés suspects par le client |
| Blocs manuels déclarés / validés | 13 / 13 | **30 / 18** | anti-autoclic #10 à 8 clics/s |
| Blocs Auto-Dig | 0 | 18 | 1,8 % des blocs |
| Blocs détruits (`blocksDestroyed`) | 13 | **1 002** | **954 blocs comptés nulle part** |
| Pioche / dégâts | niv. 1 / 1 | **niv. 15 (max) / 25** | |
| Chance / Sac / Auto-Dig | 0 / 0 / 0 | 12 / 12 / **6 (max)** | Auto-Dig 6 = 4 + 8 + 18 + 35 = **65 gemmes** |
| Gemmes trouvées / solde | 0 / 0 | 72 / 9 | 72 − 65 (Auto-Dig) ≈ 9, cohérent (inféré) |
| Pièces gagnées / solde | 73 / 123 | **176,8 M / 161,6 M** | gains calculés par le client |
| Coffres de boutique simple / rare / antique | 0 | 38 / **506** / 5 | ≈ 7,7 M pièces dépensées |
| Reliques | aucune | 6 reliques au **niveau 5** | 247 coffres rares ont donné des reliques |
| Boost de pièces | ×2 (pub) | **×3, encore ~10,2 h** | 37 boosts de coffres rares cumulés en durée |
| Améliorations achetées | 0 | 153 (dont 99 relances de bloc) | **séquence non journalisée** |

---

## 5. Comment 1 003 m ont été atteints : reconstitution mécanique

### 5.1 La boucle (prouvée par l'état final, pas par l'ordre exact des achats)
1. Un autoclicker frappe à **30–51 coups/s**. Chaque coup inflige les dégâts de la pioche (1 → 25).
2. Les blocs tombent beaucoup plus vite qu'à la main. Chacun rapporte pièces, gemmes (72 au total), objets et coffres.
3. Les pièces achètent la pioche niv. 15, Chance 12 et Sac 12 (coûts du barème, quelques millions au total), puis 549 coffres de boutique. Ces coffres donnent les **reliques au max**, dont −50 % de PV des blocs, et **des boosts ×2/×3 dont la durée s'additionne**.
4. Avec 25 dégâts par coup, des PV réduits et un boost ×3, les gains par minute explosent (176,8 M de pièces). Les gemmes paient l'Auto-Dig max, qui n'apporte presque rien (≤ 11 dégâts/s contre ~1 000 pour l'autoclicker).

Ordre de grandeur (inféré) : 78 207 coups × ≤ 25 dégâts ≈ 1,9 M PV infligés au maximum. Un bloc de platine à 1 003 m a 3 335 PV. La profondeur atteinte est donc **compatible avec la physique honnête du jeu à cette cadence** : aucune triche sur les PV ni sur la sauvegarde n'est nécessaire pour l'expliquer.

### 5.2 Bug de comptage : prouvé (code + données)
`public/js/main.js`, `onBlockHit` (develop `cd31d8c`, avant correctif) :

```js
const suspicious = _isSuspiciousCPS();
if (suspicious) GameState.seasonStats.suspiciousScore++;
const destroyed = Blocks.hit(GameState.damage);           // dégâts toujours appliqués
if (destroyed) handleBlockDestroyed(cx, cy, { isManual: !suspicious }); // ni manuel ni auto si suspect
```

Un bloc cassé par un coup suspect donne profondeur, pièces, gemmes et objets, mais n'incrémente **aucun** compteur de blocs. Mesuré au même instant : 1 002 blocs détruits = 30 manuels + 18 Auto-Dig + **954 non comptés**.

### 5.3 Hypothèses et niveau de preuve

| Hypothèse | Verdict | Preuves |
|---|---|---|
| Outil externe (autoclicker) | **très probable** | 30–51 clics/s soutenus pendant ~1 h ; 97–99 % d'intervalles < 40 ms ; régularité client 0,8–0,89 sur de nombreux lots ; 98 % de clics suspects. Un humain tient ~6–10 clics/s soutenus. Impossible de dire lequel (type de pointeur non journalisé avant 23:53). |
| Script dans la page (console, extension qui crée des clics) | **peu probable** | aucun `untrusted_clicks` : moins de 50 % de clics `isTrusted = false` dans chaque lot |
| Falsification de sauvegarde / requêtes forgées | **non constaté** | compteurs cohérents (blocs = profondeur − 1, clics ≥ PV / dégâts), aucun `forged_counters`, budget jamais dépassé |
| Rejeu / multi-onglets | **non constaté** | session de jeu unique (#35) ; aucun conflit anormal |
| Bug de comptage | **prouvé** | § 5.2 |
| Inflation économique (boosts cumulés, coffres) | **prouvé (amplificateur)** | boost ×3 sur ~10 h, 506 coffres rares, reliques au max en < 1 h |
| Exploitation de l'Auto-Dig | **écarté comme cause** | 18 blocs Auto-Dig sur 1 002 |
| Essai n° 2 (après reset, ~9 clics/s tactile) | **compatible avec une frappe humaine** rapide à plusieurs doigts | tactile 100 %, `isTrusted` 100 %, variabilité 0,74–0,79 (humaine), histogramme étalé |

### 5.4 Pourquoi rien ne l'a arrêté (audit de chaque protection)

| Protection | Mode en production | Ce qu'elle a fait | Pourquoi ce n'était pas suffisant |
|---|---|---|---|
| Client `_isSuspiciousCPS` (8 clics/s sur 3 s) | actif | 76 783 clics marqués suspects | **marque seulement** : dégâts et gains toujours accordés, blocs perdus des compteurs (§ 5.2) |
| Anti-autoclic serveur #10 (`max_effective_cps` = 8) | actif | blocs manuels **validés** réduits (30 → 18) | ne touche **que le classement** ; aucun effet sur profondeur, pièces ou gemmes |
| Validation de profondeur #9 (`depth_max_cps` = 20) | actif | 1 rejet de 12 115 clics en attente (22:42) | 1 clic peut valoir 1 m, 20 clics/s acceptés : ne borne rien à cette échelle |
| Budget de dégâts #25 lot B | **`enforce`** | calculé à chaque sauvegarde, crédit **au plafond (393 750 PV)** en permanence, écart 0 | admet 20 × 1,25 clics/s × 25 dégâts + Auto-Dig ≈ 656 PV/s, et la borne de PV est le bloc le plus faible avec −50 % (485 PV à 1 003 m contre 3 335 réels). 14 → 1 003 m ne demandent que 244 612 PV, soit **6,2 min** au rythme admis. Conçu contre les sauts forgés, pas contre un autoclicker. |
| Score de risque #25 lot A | **`shadow`** | 0 → 40 → 74,9 ; niveaux 1 puis 2 | `applied:false` par conception : le lot C (réponses) n'existe pas encore |
| Économie (pièces, améliorations, reliques, Auto-Dig) | — | rien | **calculée par le client**. La boutique de coffres est serveur mais débite le solde de pièces déclaré par le client. |
| Registre de gemmes #49 | observation | rien | le mode `enforce` reste une décision du propriétaire |

Classement : avec la règle #73 (blocs manuels validés uniquement), le compte testeur était 3ᵉ sur 3 joueurs actifs à 22:57 (18 blocs validés) et 2ᵉ à 00:00 (106). La profondeur 1 011 m ne classe plus personne, mais **#73 ne corrige ni les gains ni la progression**.

---

## 6. Correctif P0 livré

### 6.1 Ce qui change (`fix/74-gabpok8-antibot`)
- **Limiteur de frappes dans le jeu** (`public/js/main.js`, `_takeHitToken`). C'est un « seau de jetons » : on peut frapper jusqu'à **36 coups d'affilée**, puis la cadence soutenue est limitée à **12 coups/s**. Si le rythme est robotique (régularité > 0,92), la recharge est divisée par deux.
  - Un coup au-delà de cette cadence **ne fait ni dégât ni gain**. Il n'entre pas dans `manualClicks`. Il est compté à part (`throttledHits`, télémétrie `x`) et affiche « -0 ».
  - **Aucun ban, aucune coupure, aucun solde touché.**
- **Compteurs complets** : un bloc cassé par un coup suspect est compté dans `seasonStats.suspiciousBlocks`. Il n'est **jamais crédité comme manuel**, conformément à la consigne du propriétaire.
- **Serveur aligné** (`server/seasons.js`, `validateDepth`) : la cadence créditée pour la profondeur et le budget de dégâts est le **minimum de `depth_max_cps` et `manual_hit_rate`**. Un client modifié qui déclare la cadence de l'incident n'est donc crédité qu'à 12 coups/s (× 1,25 de marge). Les badges, événements mensuels et la collection, tirés sur la profondeur retenue, suivent automatiquement.
- **Réglages admin** : deux nouvelles clés, ajoutées seulement si elles n'existent pas, sans toucher aux valeurs existantes. On les trouve dans Admin → Config → Protections :
  - `manual_hit_rate` (12, de 4 à 30) ;
  - `manual_hit_burst` (36, de 1 à 200).

  Elles sont validées à l'écriture et transmises au jeu par `/api/seasons/current` (`hitRate`, `hitBurst`).
- **Observation** : nouveau signal `throttled_hits` (famille rafales, 4 points), visible dans le journal Anti-bot. `forgedCounters` contrôle aussi `suspiciousBlocks` et `throttledHits`. La doc est dans `docs/ANTI-BOT.md`.

### 6.2 Avant / après (tests reproductibles, base isolée)

| Scénario | Avant | Après |
|---|---|---|
| Autoclicker 40 coups/s pendant 77 min, vrai client | 184 800 coups portés | **≈ 55 440 coups portés (× 0,30)** |
| Autoclicker régulier à 12 coups/s | tout passe | ≤ 6 coups/s portés |
| Humain 6 coups/s (10 min), 10 coups/s (5 min) | tout passe | **tout passe** |
| Mobile multi-doigts : rafale 20 coups/s pendant 3 s, 15 coups/s pendant 6 s | tout passe | **tout passe** |
| Client modifié, profondeur déclarée de l'incident (40 clics/s), 10 / 30 / 77 min | retenu 1 268 / 2 201 / 3 530 m | **retenu 993 / 1 725 / 2 768 m** |
| Sauvegarde forgée : +4 990 m et 1 000 000 de clics en 12 s | bornée | bornée à ≤ 205 m + signal `depth_rejected` |
| Bloc cassé par un coup suspect | compté nulle part | `suspiciousBlocks` |

**Limite honnête** : côté serveur, le gain n'est que de 22 % contre un client **modifié**, parce que la borne de PV du budget reste très basse (bloc le plus faible, −50 %). La protection forte vise le chemin réellement utilisé dans l'incident : un autoclicker sur le vrai jeu. Contre un client modifié, la vraie défense est la recommandation P0-2 (§ 9).

### 6.3 Tests
- `test/incident-74.test.js` (11 tests) : limiteur réel extrait de `main.js`, humain, mobile, rafales, autoclicker, rythme robotique, configuration, compteurs, rejeu serveur de l'incident, sauvegarde forgée, télémétrie.
- `test/antibot.test.js` : le scénario « honnête au maximum théorique » passe de 20 à **12 coups/s**, le nouveau maximum honnête. Il reste sans aucune perte de profondeur ni aucun signal.
- `npm test` complet : **717/717** sur la branche, puis **717/717** sur le SHA exact de release `14d2e8b` (aucun nouveau passage nécessaire).

### 6.4 Données des joueurs
- Aucune sauvegarde, solde, classement ni compte n'est modifié. **Le compte testeur est intact.**
- Migration : 2 lignes de réglage ajoutées (`ON CONFLICT DO NOTHING`), idempotente, rétrocompatible.
- Les nouveaux compteurs de sauvegarde ont une valeur par défaut de 0 et les anciennes sauvegardes se chargent sans changement.

---

## 7. Déploiement

- **SHA sur `develop` = SHA déployé : `14d2e8b`** (merge de `0d4effc`), branche `fix/74-gabpok8-antibot`. Production précédente : `3f726c2`.
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261105-012148-pre-deploy-14d2e8b.sqlite`.
- Copie de la base de production démarrée en mode production sur le port 3122 : `/health` ok, `/api/version` = `1.0.0+14d2e8b`. Empreintes (nombre de lignes + hachage de toutes les colonnes) de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` **identiques** avant et après le démarrage. Seules 2 lignes de réglage ont été ajoutées. La copie a ensuite été supprimée.
- Avant le déploiement : aucune génération IA en cours (dernier appel à 23:10 UTC).
- Après le déploiement :
  - https://dig.lodygames.com et https://dig.lodylands.com renvoient 200, version `1.0.0+14d2e8b` ;
  - aucune erreur dans `journalctl` ; `pragma quick_check` = ok ;
  - mêmes nombres de comptes, sauvegardes et lignes de classement qu'avant ;
  - `/api/seasons/current` renvoie `hitRate` 12, `hitBurst` 36.
- Essai navigateur en production (Chromium headless, invité, aucune donnée serveur modifiée), en 1280×900 et 390×844 : aucune erreur JavaScript. Le limiteur servi charge 12/36 depuis le serveur et accorde 36 coups d'affilée, puis 24 coups après 2 s (12/s).
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 3f726c2` puis `sudo systemctl restart dig` (lock npm inchangé). Le code seul revient en arrière : les 2 réglages ajoutés sont inertes pour l'ancien code.

### Test fonctionnel à faire par le propriétaire (5 min)
1. Recharger le jeu (Ctrl+F5 sur PC, fermer et rouvrir l'onglet sur mobile).
2. **Frappe humaine** : taper aussi vite que possible pendant 3 secondes, à un ou deux doigts. **Attendu** : chaque coup fait ses dégâts habituels (« -25 », etc.).
3. **Frappe soutenue** : continuer à taper très vite plus de 5 secondes. **Attendu** : au-delà de ~12 coups/s, des « -0 » apparaissent. Ces coups-là ne font ni dégât ni gain. Le jeu reste fluide.
4. **Autoclicker** (testeur volontaire) : rejouer l'essai avec le même outil. **Attendu** : la progression est environ 3× plus lente qu'hier, et Admin → Anti-bot → fiche du joueur montre des `throttled_hits`.
5. Admin → Config → Protections : les deux réglages « Coups/s max » (12) et « Rafale de coups tolérée » (36) sont présents. Les régler n'est utile qu'en cas de faux positif signalé.

Classement : **Bloquant MVP public**. Le classement et les points sont partagés en bêta invitée.

---

## 8. Choix techniques faits seul
- **12 coups/s soutenus, rafale de 36** : au-dessus de la cadence humaine soutenue (6–10), tout en laissant passer les rafales mobiles à plusieurs doigts. Les deux valeurs sont réglables sans redéploiement.
- **Coup au-delà de la cadence = sans effet**, plutôt qu'une réduction des gains : c'est plus simple, plus lisible (« -0 ») et ne touche ni aux prix, ni aux probabilités, ni aux récompenses (#49).
- **Ce coup ne compte pas dans `manualClicks`** : le budget serveur reste ainsi cohérent avec les coups réellement portés.
- **Le serveur prend le minimum des deux cadences** au lieu de modifier `depth_max_cps` (20) : le réglage du propriétaire n'est pas réécrit.
- **Aucun changement de `antibot_mode` ni des sanctions** : le passage en sanction (lot C) reste une décision du propriétaire.

## 9. Recommandations ordonnées
- **P0-2 — Bloquant MVP** : budget serveur exact. Le serveur peut recalculer les **vrais PV** de chaque bloc à partir de `blockSeed`/`blockSeq` (#35), à la place de la borne « bloc le plus faible −50 % ». Le budget deviendrait ~5 à 7× plus serré contre un client modifié. Après lancement si une bêta fermée suffit.
- **P0-3 — Bloquant MVP** : pièces côté serveur. Plafonner les gains de pièces par sauvegarde à ce que permettent les blocs validés, puis faire calculer les achats d'améliorations et de reliques par le serveur (comme la boutique de coffres). Cela touche l'économie (#49) : validation du propriétaire nécessaire.
- **P1** : boosts des coffres. Plafonner la durée cumulée (≤ 1 h par exemple) plutôt que de l'additionner sans limite (#47/#49, décision propriétaire).
- **P1** : #75 (reset). Le reset doit aussi réinitialiser `season_rankings` et les suivis, et archiver avant.
- **P1** : lot C (#25). Suspension réversible des **seuls gains classés** quand le score de risque reste au niveau ≥ 2, après avoir vérifié l'absence de faux positifs sur une semaine de bêta avec ce correctif.

## 10. Décisions demandées au propriétaire
1. **Cadence max 12 coups/s, rafale 36** : la garder ? Options : 10 (plus strict) / 12 (recommandé) / 15 (plus tolérant).
2. **P0-3 (pièces vérifiées par le serveur)** : l'autoriser comme prochain ticket ? Recommandation : oui, c'est la seule protection solide contre un client modifié.
3. **Boosts des coffres cumulés sur 10 h** : plafonner la durée ? Recommandation : oui, 1 h max (#49).

## 11. Reste à faire
- P0-2 et P0-3 ci-dessus. Les tests multi-onglets et redémarrage du serveur sont déjà couverts par #35/#18 et n'ont pas été rejoués spécifiquement.
- Données de l'essai n° 1 préservées dans `~/forensics/ticket-74/` jusqu'à décision du propriétaire. Ce dossier est privé et n'est pas sauvegardé hors machine.
