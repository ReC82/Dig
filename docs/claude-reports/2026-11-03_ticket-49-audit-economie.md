# Ticket #49 — [P1] Audit et rééquilibrage de l'économie — gemmes, fragments, coffres et boutique

Lien : https://github.com/ReC82/Dig/issues/49

## Session du 03/11/2026 (DIGORCH) — audit chiffré, simulations, deux barèmes proposés

### 1. État réel

**Audit livré, intégré dans `develop`, non déployé (aucun changement du jeu à déployer). En attente
de l'arbitrage du propriétaire.** Conformément au ticket et à la décision du 02/11, **aucun taux,
prix, solde ni effet n'a été modifié**, ni dans le code du jeu ni dans les réglages de production.
Le livrable est : ce rapport, un simulateur reproductible (`tools/balance/economy-sim.js`) et ses
tests automatisés (`test/economy-sim.test.js`).

Classement : **Après lancement** pour le MVP public (l'économie actuelle fonctionne et ne perd
aucune donnée). En revanche, la recommandation R1 (solde de gemmes tenu par le serveur) est
**bloquante pour l'ouverture d'une boutique en gemmes**, et R3 (fragments quasi illimités) pèse
sur l'équité du classement dès qu'il y aura plusieurs joueurs assidus.

### 2. Réponse courte au constat du 02/11 (2 gemmes, 5 fragments, 37 735 pièces vers 122 m)

- **Ce n'est pas un problème de rareté, c'est un problème de puits.** À 122 m avec l'équipement de
  la capture (pioche 8, Œil du mineur 2, Chance 5, Sac 6, Auto-Dig 4, 4 clics/s), le jeu donne
  **≈ 8,7 💎/h** (médiane 9, p10–p90 5–13) et **≈ 8,6 🔮/h** : à peu près autant de gemmes que de
  fragments. La sauvegarde de production (seul compte) le confirme : **14 gemmes trouvées**, dont
  **12 dépensées** en Auto-Dig 3 et 4 (4 + 8). Il en reste 2.
- **Les gemmes n'ont qu'un seul usage : Auto-Dig 3 → 6 (65 💎), remis à zéro chaque lundi.** Les
  articles « gemmes », « skins » et « boost » de la boutique sont des achats en euros désactivés
  (#11, « Bientôt »). Une fois l'Auto-Dig 6 atteint (≈ 12 h de jeu pour un joueur régulier),
  les gemmes ne servent plus à rien et sont écrêtées à 100 en fin de saison.
- **Les fragments, eux, sont permanents** et ont un débouché clair (6 reliques × 5 niveaux =
  1 617 🔮). Ils arrivent par paquets (1 à 3, + Aimant) : d'où l'impression qu'ils sont plus
  faciles à obtenir.
- Deux déséquilibres structurels plus graves sont apparus (détails en 4) : **inflation des pièces**
  (toutes les améliorations en pièces sont au maximum après ≈ 3 h de jeu) et **fragments quasi
  illimités** via le coffre simple de la boutique (achat illimité, 800 🪙 en production).

### 3. Inventaire réel — sources et puits (code de `develop` = production, réglages relevés le 03/11)

Réglages `admin_config` de production (lecture seule d'une copie) : `chest_cost_simple = 800`
(modifié le **02/11 à 20:38–20:39 UTC** : 2 000 → 500 → 800), `chest_cost_rare = 15000`,
`chest_cost_antique = 80000`, multiplicateurs pièces / améliorations / fragments = 1, `gems_cap = 100`.
Catalogue de blocs publié : **v3** (14 blocs d'origine + 8 minerais de l'étape B, #37).

| Monnaie | Portée | Sources | Puits |
|---|---|---|---|
| 💰 Pièces | Saison (remises à 0 le lundi) | Blocs : `récompense × (1 + 0,05 × (prof. − 1)) × Sac (1 + 0,3/niv.) × Cœur d'or × coin_gain_multiplier × boost` ; coffres de la mine (80–1 200) ; hors ligne (Auto-Dig × multiplicateurs × 30/min, 4 h max) ; série quotidienne (50–600) ; missions ; objectifs ; pièces rendues par les coffres de la boutique | Pioche 1 946 450 ; Chance 520 050 ; Sac 622 170 ; Auto-Dig 1–2 : 3 800 ; boutique de fragments 1 895 000 (10/saison) ; relance de bloc 3 887 200 (99 max) ; coffres de la boutique (simple 800 et rare 15 000 **illimités**, antique 80 000 × 5) |
| 💎 Gemmes | Permanentes, **écrêtées à 100** en fin de saison | Rubis (≥ 35 m), émeraude (≥ 70 m), diamant (≥ 120 m) : **+1 chacun** ; saphir, améthyste, cristal ancien (étape B) : **0** (`gemReward: false`) ; série quotidienne 1 + 2 + 4 = **7/semaine** (7 jours d'affilée seulement) ; missions « Trouver des gemmes » (+1) et « Ouvrir 4–5 coffres » (+1) ; objectif « Première gemme » (+1, une fois) | **Auto-Dig 3/4/5/6 : 4 + 8 + 18 + 35 = 65**, à racheter chaque saison. Rien d'autre (boutique en euros désactivée). |
| 🔮 Fragments | Permanents | Coffres de la mine : vieille caisse 20 % × 1, bois 30 % × 1 + 10 % × 2, fer 25 % × 2 + 20 % × 3 (+ Aimant 1–5 par lot) ; boutique de fragments (1 par achat, 10/saison) ; coffres de la boutique (simple 30 % × 1 ; rare 4 / 7 ; antique 20 / 30 / 50 ; × `fragment_drop_multiplier` + Aimant ; objet déjà possédé → 5) | Reliques : 1 617 au total (Œil 129, Cœur 196, Aimant 222, Lentille 280, Griffe 350, Moteur 440). Au-delà : aucun usage. |
| 🏅 Points saisonniers (#33) | Portefeuille séparé | Classement de fin de saison | Boutique de cadeaux (#34). **Aucune conversion** avec gemmes ou pièces (vérifié : `server/shop.js` n'accepte que les points). |

Leviers liés : **Chance** (+10 % de poids par niveau pour rare/épique/légendaire, #32) → à 122 m,
gemmes 3,55 % des blocs à Chance 0, **5,01 % à Chance 5** (+41 %), coffres 7,1 % → 8,8 % ;
**boosts** (pièces seulement : coffres de la mine, série jour 6, coffres de la boutique, bouton
« bonus » ×2 2 min toutes les 5 min) ; **Auto-Dig** (1 coup/s ; s'arrête sur la fenêtre d'un coffre).

Où l'argent est tenu : les pièces, gemmes, missions, série et reliques sont calculées **dans le
navigateur** et enregistrées telles quelles par `POST /api/me/save` ; seuls l'achat des coffres
de la boutique (`server/chestShop.js`, transactionnel) et le plafond de fin de saison sont côtés
serveur. La profondeur du classement est, elle, validée par le budget de dégâts (#9, #25).

### 4. Simulations (vrai code du jeu, 10 000 saisons par profil et par barème)

Outil : `node tools/balance/economy-sim.js` (≈ 6 min ; `--runs 500` pour un aperçu en 20 s). Il
charge `balance.js`, `blocks.js`, `chests.js`, `relics.js`, `daily.js`, `dailyMissions.js`,
`quests.js`, le catalogue v3 (`server/blockCatalog.js`), les tables et la formule des coffres de la
boutique (`server/chestShop.js`, `server/economy.js`) et les réglages de production ci-dessus.
Hasard à graine : mêmes options → mêmes chiffres. Tables complètes en annexe.

Profils (saison de 7 jours, réinvestissement : l'amélioration la moins chère d'abord, Auto-Dig en
gemmes dès que possible, fragments → relique la moins chère) :

| Profil | Jeu actif | Onglet ouvert (Auto-Dig seul) | Jours | Autres |
|---|---|---|---|---|
| Débutant | 20 min/j, 4 clics/s | — | 4 / 7 (série brisée) | — |
| Régulier | 1 h/j, 5 clics/s | 1 h/j | 7 / 7 | bouton bonus |
| Assidu | 3 h/j, 6 clics/s | 4 h/j (passage /15 min) | 7 / 7 | bonus ; fin de saison : pièces → coffres (1 800 ouvertures = 1 h au maximum du limiteur) |
| Automatique | 15 min/j | 8 h/j (passage /20 min) | 7 / 7 | — |

**Résultats clés — barème actuel, saison 1** (médiane, p10–p90) :

| Profil | Heures | Profondeur | 💎 / saison | 💎 / h | 💎 dépensées | 🔮 / saison | Toutes améliorations en 💰 au max |
|---|---|---|---|---|---|---|---|
| Débutant | 1,3 | 310 m (291–330) | **18** (13–24) | 13,5 | 12 (Auto-Dig 4 au mieux) | 21 | non |
| Régulier | 14 | 994 m | **66** (56–75) | 4,7 | 65 (Auto-Dig 6 pour 56 %, vers 12 h) | 75 | après **3,2 h** |
| Assidu | 49 | 2 051 m | **124** (110–138) | 2,5 | 65 (Auto-Dig 6 vers 17,5 h) | **1 860** | après **2,8 h** |
| Automatique | 58 | 692 m | **49** (40–57) | 0,85 | 30 (Auto-Dig 5 ; 6 pour 1 %) | 49 | après 33 h |

Constats chiffrés :

1. **Les gemmes par heure baissent quand on progresse** (13,5/h pour un débutant, 2,5/h pour un
   assidu) : la part de blocs gemmes reste ≈ 3 % à toute profondeur, mais les blocs deviennent
   lents (PV × (1 + 0,12/m)), et les gemmes profondes de l'étape B ne rapportent rien
   (2,1 % des blocs à 900 m). Plus on joue, moins chaque heure rapporte de gemmes.
2. **Accumulation inutile** : sur 8 saisons, un joueur régulier perd en moyenne 72 💎 par saison
   au plafond dès la saison 8, un assidu ≈ 185 💎 par saison dès la saison 4 (aucun débouché).
3. **Inflation des pièces** : la récompense des blocs croît de 5 % par mètre sans limite, alors que
   les coûts sont fixes et bornés (≈ 5 M au total + 3,9 M de relances). Un joueur régulier gagne
   ≈ 47 M de pièces par saison et en laisse **42 M inutilisées** ; un assidu, 243 M. Les pièces ne
   pilotent la progression que pendant les ≈ 3 premières heures de chaque saison.
4. **Fragments quasi illimités** : le coffre simple (800 🪙, illimité) donne 0,3 🔮 et rend 613 🪙
   en moyenne → **625 🪙 nets par fragment, 104 🪙 avec l'Aimant 5** (au défaut de 2 000 🪙 :
   4 600). Avec des dizaines de millions de pièces inutiles, la limite n'est plus le prix mais le
   nombre d'ouvertures (limiteur : 30/min). Une heure d'ouvertures en fin de saison suffit pour
   **toutes les reliques au maximum dès la saison 1** (1 860 🔮), soit **+40 % de profondeur en
   saison 2** pour un assidu ; 300 ouvertures/saison donnent +16 % (S2) et **+34 % (S4)** à un
   joueur régulier. Le prix de 800 ou 2 000 ne change rien chez l'assidu (même résultat) : c'est
   l'**absence de limite** combinée à l'inflation qui pose problème. Un script au maximum du
   limiteur sur 24 h obtiendrait ≈ 39 000 🔮 par saison.
5. **Effet des avantages sur la profondeur (classement)**, saison 1 : sans l'Auto-Dig en gemmes,
   −1,9 % (débutant) à −3,5 % (assidu), mais **−19 % pour le profil automatique** ; « ramassage
   automatique des coffres » : +0,1 % (actif) à **+4,0 %** (automatique) ; boost ×2 pièces 30 min
   par jour : **+5,2 % pour un débutant**, +0,2 à +1,3 % ensuite (pièces déjà saturées).
6. Les reliques (permanentes) sont le vrai moteur à long terme : un assidu passe de 2 050 m (S1) à
   3 380 m (S4) à temps de jeu égal.

### 5. Barèmes proposés (AUCUN n'est appliqué)

Deux variantes cohérentes avec le modèle hybride validé le 02/11 (cosmétiques + confort +
progression mesurée, gemmes gagnées en jouant). Elles ne changent que les **sources** de gemmes,
le plafond et (B) le prix de l'Auto-Dig ; pièces, fragments et points saisonniers sont inchangés.

| Paramètre | Actuel | **A — mesurée (recommandée)** | B — généreuse |
|---|---|---|---|
| Gemmes par bloc : rubis / saphir / émeraude / améthyste / diamant / cristal | 1 / 0 / 1 / 0 / 1 / 0 | 1 / 1 / 2 / 2 / 3 / 3 | 2 / 2 / 3 / 3 / 5 / 5 |
| Gemmes dans les coffres de la mine | aucune | coffre en fer : 10 % → 1 💎 | caisse 2 % → 1, bois 6 % → 1, fer 15 % → 2 |
| Série quotidienne (jours 1 → 7) | 0,0,1,0,2,0,4 (7/sem.) | inchangée | 1,1,2,1,3,1,6 (15/sem.) |
| Bonus « 3 missions du jour réussies » | 0 | +1 💎 | +2 💎 |
| Plafond de fin de saison | 100 | 150 | 250 |
| Auto-Dig 3 / 4 / 5 / 6 | 4 / 8 / 18 / 35 (65) | inchangé | 6 / 14 / 30 / 60 (110) |

Résultats (saison 1, médianes) :

| Profil | 💎 / saison actuel → A → B | 💎 libres après Auto-Dig (fin de saison) actuel → A → B | Auto-Dig 6 atteint (h de jeu) actuel → A → B | Profondeur actuel → A → B |
|---|---|---|---|---|
| Débutant | 18 → 28 → 52 | 6 → 9 → 15 | jamais | 310 → 312 → 312 m |
| Régulier | 66 → 130 → 229 | 13 → 65 → 119 | 12,0 (56 %) → 6,0 → 5,3 | 994 → 1 001 → 1 001 m |
| Assidu | 124 → 293 → 515 | 59 → 228 → 405 | 17,5 → 5,6 → 5,3 | 2 051 → 2 057 → 2 056 m |
| Automatique | 49 → 89 → 158 | 18 → 24 → 48 | 55,6 (1 %) → 41,8 → 39,4 | 692 → 722 → 728 m |

Effet sur le classement : **+0,3 % à +4,3 %** de profondeur selon le profil (l'Auto-Dig 6 arrive
plus tôt). Les deux variantes doublent (A) ou triplent (B) le revenu en gemmes ; les gemmes
profondes redeviennent intéressantes à miner. **A est recommandée** : elle laisse ≈ 65 💎 libres
par semaine à un joueur régulier (un vrai budget pour la boutique) sans inonder les assidus ; B
n'a de sens que si la boutique propose beaucoup d'articles, et rend l'Auto-Dig plus cher.

**Première tranche de boutique en gemmes gagnées** (prix suggérés ; durée = « temps pour un
joueur régulier », gemmes libres après l'Auto-Dig). Rien n'est achetable aujourd'hui ; aucun
paiement réel ; ces articles ne seront activés qu'après décision.

| Rayon | Article | Durée | Effet sur la profondeur | Prix A | Prix B |
|---|---|---|---|---|---|
| Apparences | Pioche dorée (le style `skin-golden` existe déjà) | permanent | aucun | 150 💎 (≈ 2,5 sem.) | 250 💎 |
| Apparences | Pioche diamant (`skin-diamond` existe déjà) | permanent | aucun | 350 💎 (≈ 5 sem.) | 600 💎 |
| Apparences | Effet de destruction (particules) / cadre de pseudo au classement | permanent | aucun | 80–120 💎 | 150–200 💎 |
| Confort | Ramassage automatique des coffres de la mine (l'Auto-Dig ne s'arrête plus) | saison | +0,1 % (actif) à +4 % (onglet ouvert) | 30 💎 | 50 💎 |
| Confort | Gains hors ligne 4 h → 8 h | saison | aucun (pièces seulement) | 20 💎 | 35 💎 |
| Améliorations | Auto-Dig 3 → 6 (existant) | saison | −2 à −19 % sans | 65 💎 (inchangé) | 110 💎 |
| Améliorations | Boost ×2 pièces 30 min (2 par jour max) | temporaire | +5 % débutant, < +1,5 % ensuite | 8 💎 | 12 💎 |
| Améliorations | +1 coffre antique cette saison (2 max) | saison | faible (fragments) — à revoir après R3 | 40 💎 | 70 💎 |

Pas de pioche plus forte, de relique ni de bonus de profondeur permanent vendus en gemmes : ce
serait obligatoire pour le classement. Si un jour des gemmes sont vendues contre de l'argent, seuls
les rayons Apparences et Confort devraient être achetables avec des gemmes payantes.

### 6. Panel admin (#20, #37) — effectif ou non

| Réglage | Effectif ? | Remarque |
|---|---|---|
| `upgrade_cost_multiplier`, `coin_gain_multiplier` | oui (jeu, toutes les 5 min) | multiplicateurs globaux |
| `fragment_drop_multiplier` | oui, **coffres de la boutique seulement** | libellé admin exact ; les coffres de la mine l'ignorent |
| `chest_cost_*` | oui (serveur) | simple = 800 en production |
| `gems_cap` | oui (client + serveur) | |
| `season_duration` | non | déjà libellé « Inutilisé » |
| Catalogue de blocs (#37) | oui : brouillon, simulation, publication, versions, retour arrière, journal | `gemReward` par gemme ; **pas de quantité de gemmes par bloc** |
| Gemmes par bloc, coûts Auto-Dig, série quotidienne, missions, tables des coffres de la mine et de la boutique, reliques, limites des coffres | **non administrables** (codés en dur, côté client pour la plupart) | à rendre pilotables selon la variante retenue |

Proposition (après décision) : un onglet « Économie » sur le modèle de #37 — brouillon, aperçu
chiffré par `economy-sim` (gemmes/h par profil, temps d'accès à chaque article), publication avec
note, versions, retour arrière, journal d'audit ; valeurs publiées par le serveur (comme le
catalogue des coffres) pour ne plus rien recopier côté client.

### 7. Protection du gameplay

- **Classement** : seule la profondeur compte, validée par le budget de dégâts (#25). Les gemmes
  n'y pèsent qu'à travers l'Auto-Dig (chiffré ci-dessus). Les reliques pèsent beaucoup plus (R3).
- **R1 — solde de gemmes non tenu par le serveur** : le navigateur écrit le nombre de gemmes dans
  la sauvegarde ; un client modifié peut en écrire autant qu'il veut. Sans conséquence grave
  aujourd'hui (seul usage : Auto-Dig, borné par le budget de dégâts), mais **à corriger avant toute
  boutique en gemmes** : journal de gemmes côté serveur (comme `reward_point_ledger`), crédits des
  gemmes recalculés ou bornés par le serveur (blocs gemmes via `minedByType` borné par la profondeur,
  série et missions validées côté serveur), achats transactionnels et idempotents (modèle #34).
- Doubles crédits : achats de coffres transactionnels (#8), une seule session de jeu (#35), boosts
  qui s'additionnent sans se raccourcir (#47) — rien de nouveau trouvé.
- Pay-to-win : aucun paiement réel actif (#11). Le bouton « bonus » accorde son boost après une
  publicité **simulée** (5 s) — hors périmètre, relève de #45.
- Joueurs existants : aucune proposition ne retire de gemmes, fragments ou reliques déjà acquis.

### 8. SHA, branche et procédure de test

- Branche `feature/49-audit-economie` (commit `7680aee`) ; **SHA sur `develop` : `5ed7046`**
  (merge `--no-ff`, arbre identique à la branche testée).
- Fichiers : `tools/balance/economy-sim.js` (nouveau), `test/economy-sim.test.js` (nouveau), ce
  rapport. **Aucun fichier du jeu ni du serveur modifié.**
- Reproduire : `node tools/balance/economy-sim.js` (≈ 6 min, annexe identique) ou
  `node tools/balance/economy-sim.js --runs 500 --long-runs 100` (≈ 20 s, mêmes tendances) ;
  `node --test test/economy-sim.test.js` (5 tests : catalogue et gemmes réels, tirage rapide =
  `Blocks.spawn`, coffres = `rollChest`, reproductibilité et plafond, variantes sans effet sur le jeu).

### 9. Vérifications, limites, données des joueurs

- Réglages et statistiques lus sur une **copie** de la base (`.backup` en lecture seule, supprimée
  ensuite) ; seule la sauvegarde du compte du propriétaire existe. Aucune écriture en production.
- `npm test` complet sur l'arbre exact de `5ed7046` : **465 / 465 réussis** (dont les 5 nouveaux).
- Limites du modèle : joueur « rationnel » qui réinvestit au mieux et réclame tout ; temps de
  rupture d'un bloc calculé en dégâts/s (pas clic par clic) ; objets de collection supposés déjà
  possédés lors des conversions massives ; reliques achetées « la moins chère d'abord » ; pas de
  relance de bloc ; budget de dégâts non simulé (joueur honnête). Les valeurs absolues dépendent du
  profil ; les comparaisons entre barèmes (mêmes graines) sont robustes.

### 10. Déploiement

**Non déployé, volontairement** : ni le jeu ni le serveur ne changent (outil hors ligne, test et
rapport). La production (`61a5cbc`) exécute déjà exactement le même code ; le prochain déploiement
ordinaire embarquera ces fichiers. Rien à tester en jeu pour l'instant.

**Test fonctionnel proposé au propriétaire** (≈ 5 min, sans rien changer) : relire les sections 2,
4 et 5, puis répondre aux questions ci-dessous dans le ticket. Pour vérifier un chiffre en jeu :
noter gemmes et fragments au début d'une séance d'une heure vers 120 m, puis à la fin — attendu
≈ 5 à 13 gemmes et 4 à 14 fragments.

### 11. Choix techniques faits seul

- Simulateur séparé de `luck-sim.js` (#32) mais même principe (vrai code dans `vm`, graines) ;
  tirage des blocs à partir des probabilités exactes de `Blocks.blockOdds` mises en cache (vérifié
  contre `Blocks.spawn` par un test) pour tenir 10 000 saisons par profil en quelques minutes.
- Conversion massive des pièces en coffres : au-delà de 200 coffres d'un coup, le lot est crédité à
  son espérance exacte (même table et même formule), sinon tirage coffre par coffre.
- Réglages de production figés dans l'outil (`PROD_CONFIG`, relevé du 03/11) plutôt que lus en
  base : l'outil ne touche jamais une base.

### 12. Décisions demandées au propriétaire

1. **Barème des gemmes** : (a) variante A « mesurée », (b) variante B « généreuse », (c) autre.
   Recommandation : **A**.
2. **Fragments illimités (R3)** : (a) limiter les coffres simple et rare (ex. 20 et 10 par
   saison), (b) coût croissant à chaque achat comme la boutique de fragments, (c) retirer les
   fragments du coffre simple, (d) ne rien changer. Recommandation : **(a)**. Le prix de 800 🪙
   réglé le 02/11 est-il voulu ? (sans effet chez les assidus, mais il rend le coffre simple très
   rentable pour les autres).
3. **Inflation des pièces (R2)** : (a) l'accepter (les pièces ne servent qu'aux premières heures
   de chaque saison), (b) ralentir la croissance des récompenses en profondeur (ex. +5 %/m jusqu'à
   200 m puis +2 %/m), simulée avant toute application, (c) ajouter des puits de pièces qui
   suivent la profondeur. Recommandation : **(b)**, simulée dans ce ticket avant décision finale.
4. **Boutique en gemmes** : valider la première tranche (section 5) et ses prix, ou la réduire
   (ex. seulement les deux pioches + ramassage automatique). Recommandation : pioche dorée, pioche
   diamant, ramassage automatique, boost ×2 pièces 30 min ; le reste plus tard.
5. **Ordre de réalisation** proposé : R1 (journal de gemmes côté serveur, invisible pour le joueur)
   → barème retenu → boutique en gemmes → onglet admin « Économie ». D'accord ?

### 13. Éléments restant à réaliser

- Selon les réponses : appliquer le barème retenu (le rendre administrable), R1 (journal de gemmes
  serveur — prérequis de la boutique), limites des coffres (R3), courbe des récompenses (R2),
  boutique en gemmes, onglet admin « Économie » avec simulation avant publication.
- Signalé, hors périmètre : publicité simulée qui accorde un vrai boost (#45).

### Annexe — sortie complète de `node tools/balance/economy-sim.js`

<!-- généré par node tools/balance/economy-sim.js --runs 10000 --long-runs 2000 --seasons 8 -->
### Probabilités exactes par bloc (catalogue v3 publié, Chance 0 et 5)

| Profondeur | Chance | Gemme qui rapporte 💎 | Gemme sans 💎 (saphir, améthyste, cristal) | Coffre de la mine | 💎 / 1 000 blocs (A · B) |
|---|---|---|---|---|---|
| 20 m | 0 | 0,00 % | 0,00 % | 5,64 % | 0,0 (0,0 · 0,0) |
| 20 m | 5 | 0,00 % | 0,00 % | 7,07 % | 0,0 (0,0 · 0,0) |
| 35 m | 0 | 2,15 % | 0,00 % | 7,51 % | 21,5 (21,5 · 42,9) |
| 35 m | 5 | 3,11 % | 0,00 % | 9,59 % | 31,1 (31,1 · 62,2) |
| 50 m | 0 | 2,06 % | 0,00 % | 7,20 % | 20,6 (20,6 · 41,1) |
| 50 m | 5 | 2,93 % | 0,00 % | 9,03 % | 29,3 (29,3 · 58,6) |
| 70 m | 0 | 3,05 % | 0,00 % | 7,13 % | 30,5 (40,7 · 71,3) |
| 70 m | 5 | 4,33 % | 0,00 % | 8,90 % | 43,3 (57,7 · 101,0) |
| 100 m | 0 | 3,05 % | 0,00 % | 7,13 % | 30,5 (40,7 · 71,3) |
| 100 m | 5 | 4,33 % | 0,00 % | 8,90 % | 43,3 (57,7 · 101,0) |
| 122 m | 0 | 3,55 % | 0,00 % | 7,09 % | 35,5 (55,7 · 96,2) |
| 122 m | 5 | 5,01 % | 0,00 % | 8,83 % | 50,1 (78,8 · 136,1) |
| 150 m | 0 | 3,31 % | 0,00 % | 6,62 % | 33,1 (52,0 · 89,9) |
| 150 m | 5 | 4,70 % | 0,00 % | 8,28 % | 47,0 (73,8 · 127,5) |
| 250 m | 0 | 3,08 % | 0,00 % | 6,16 % | 30,8 (48,4 · 83,5) |
| 250 m | 5 | 4,39 % | 0,00 % | 7,73 % | 43,9 (68,9 · 119,0) |
| 400 m | 0 | 2,95 % | 1,06 % | 5,91 % | 29,5 (57,0 · 101,3) |
| 400 m | 5 | 4,14 % | 1,48 % | 7,29 % | 41,4 (79,8 · 141,9) |
| 600 m | 0 | 2,87 % | 1,84 % | 5,74 % | 28,7 (71,7 · 123,0) |
| 600 m | 5 | 3,97 % | 2,55 % | 7,00 % | 39,7 (99,4 · 170,3) |
| 900 m | 0 | 2,85 % | 2,08 % | 5,70 % | 28,5 (78,6 · 134,4) |
| 900 m | 5 | 3,94 % | 2,87 % | 6,94 % | 39,4 (108,6 · 185,7) |

### Espérance des coffres (pièces, fragments)

| Coffre | Coût | Pièces rendues | Fragments (Aimant 0 → 5) | Boost | Objet | Pièces nettes / fragment |
|---|---|---|---|---|---|---|
| Mine — vieille caisse | gratuit | 155 | 0,20 → 1,20 | 0 % | — | — |
| Mine — coffre en bois | gratuit | 180 | 0,50 → 2,50 | 20 % | — | — |
| Mine — coffre en fer | gratuit | 270 | 1,10 → 3,35 | 25 % | — | — |
| Boutique — simple (∞/saison) | 800 | 613 | 0,30 → 1,80 | 15 % | 0 % | 625 → 104 |
| Boutique — rare (∞/saison) | 15 000 | 3 200 | 2,04 → 4,14 | 8 % | 8 % | 5 784 → 2 850 |
| Boutique — antique (5/saison) | 80 000 | 11 000 | 12,40 → 14,75 | 10 % | 12 % | 5 565 → 4 678 |

### Une heure à équipement figé — 10 000 heures simulées par ligne (barème actuel · A · B)

Médiane (p10–p90) ; 💎 et 🔮 : moyenne ± écart-type en plus.

| Équipement | Mètres / h | 💎 / h actuel | 💎 / h A | 💎 / h B | 🔮 / h (mine) | 💰 / h |
|---|---|---|---|---|---|---|
| Début — 30 m, pioche 3, 4 clics/s | 127 (117–135) | 4 (1–6) · 3,8 ± 1,9 | 5 (2–9) · 5,3 ± 2,9 | 10 (4–17) · 10,1 ± 5,1 | 5 (1–9) · 5,0 ± 3,1 | 58 964 |
| Capture 02/11 — 122 m, pioche 8 (+4 Œil), Chance 5, Sac 6, Auto-Dig 4, 4 clics/s | 195 (182–206) | 9 (5–13) · 8,7 ± 2,9 | 14 (8–21) · 14,1 ± 5,1 | 25 (15–37) · 25,5 ± 8,7 | 8 (4–14) · 8,6 ± 4,1 | 691 197 |
| Milieu — 300 m, pioche 12, Chance 8, Sac 9, Auto-Dig 6, 5 clics/s | 170 (157–183) | 8 (5–12) · 8,1 ± 2,8 | 15 (9–22) · 15,4 ± 5,2 | 27 (17–40) · 28,0 ± 8,8 | 12 (6–21) · 12,8 ± 5,9 | 2 376 155 |
| Avancé — 800 m, tout au max, reliques 3, 6 clics/s | 158 (143–173) | 10 (6–14) · 9,7 ± 3,1 | 27 (18–37) · 27,2 ± 7,1 | 47 (33–63) · 47,6 ± 11,9 | 26 (13–41) · 26,5 ± 11,1 | 18 380 080 |
| Onglet ouvert seul — 300 m, Auto-Dig 6, passage /10 min | 14 (10–19) | 0 (0–2) · 0,7 ± 0,8 | 1 (0–3) · 1,1 ± 1,4 | 2 (0–5) · 2,0 ± 2,5 | 0 (0–2) · 0,7 ± 1,1 | 53 759 |

### Saison 1 (nouveau joueur, 7 jours) — 10 000 saisons par profil et par barème

Médiane (p10–p90) · moyenne ± écart-type.

#### Débutant (20 min/j, 4 j/7) — 1,3 h de jeu (actif + onglet ouvert)

| Mesure | Actuel | Variante A | Variante B |
|---|---|---|---|
| Profondeur max (m) | 310 (291–330) · moy. 310 ± 15 | 312 (293–331) · moy. 312 ± 15 | 312 (294–332) · moy. 313 ± 15 |
| 💎 gagnées / saison | 18,0 (13,0–24,0) · moy. 18,1 ± 4,4 | 28,0 (19,0–38,0) · moy. 28,4 ± 7,3 | 52,0 (38,0–69,0) · moy. 52,9 ± 12,3 |
| 💎 / heure de jeu | 13,50 (9,75–18,00) · moy. 13,54 ± 3,28 | 21,00 (14,25–28,50) · moy. 21,29 ± 5,46 | 39,00 (28,50–51,75) · moy. 39,66 ± 9,21 |
| — dont blocs gemmes | 13,0 (8,0–19,0) · moy. 13,6 ± 4,2 | 20,0 (12,0–30,0) · moy. 20,5 ± 6,9 | 35,0 (22,0–51,0) · moy. 36,0 ± 11,6 |
| — dont série quotidienne | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 4,0 (4,0–4,0) · moy. 4,0 ± 0,0 |
| — dont missions du jour | 4,0 (3,0–4,0) · moy. 3,5 ± 0,6 | 7,0 (5,0–7,0) · moy. 6,2 ± 1,1 | 10,0 (7,0–10,0) · moy. 9,0 ± 1,5 |
| — dont coffres de la mine | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 0,0 (0,0–2,0) · moy. 0,7 ± 0,8 | 3,0 (0,0–6,0) · moy. 3,0 ± 2,2 |
| 💎 dépensées (Auto-Dig) | 12,0 (12,0–12,0) · moy. 11,7 ± 2,5 | 12,0 (12,0–30,0) · moy. 19,4 ± 8,9 | 50,0 (20,0–50,0) · moy. 37,6 ± 14,8 |
| 💎 en fin de saison (avant plafond) | 6,0 (2,0–12,0) · moy. 6,4 ± 3,7 | 9,0 (1,0–16,0) · moy. 9,0 ± 5,3 | 15,0 (2,0–27,0) · moy. 15,2 ± 9,3 |
| 🔮 fragments / saison | 21,0 (14,0–29,0) · moy. 21,2 ± 5,9 | 21,0 (14,0–29,0) · moy. 21,4 ± 5,9 | 21,0 (14,0–29,0) · moy. 21,5 ± 6,0 |
| 🔮 / heure de jeu | 15,75 (10,50–21,75) · moy. 15,93 ± 4,43 | 15,75 (10,50–21,75) · moy. 16,05 ± 4,45 | 15,75 (10,50–21,75) · moy. 16,10 ± 4,50 |
| — dont coffres de la mine | 15,0 (9,0–23,0) · moy. 15,3 ± 5,6 | 15,0 (8,0–23,0) · moy. 15,4 ± 5,7 | 15,0 (9,0–23,0) · moy. 15,4 ± 5,7 |
| — dont boutique de fragments | 6,0 (5,0–7,0) · moy. 5,9 ± 0,9 | 6,0 (5,0–7,0) · moy. 6,0 ± 0,9 | 6,0 (5,0–7,0) · moy. 6,0 ± 0,9 |
| — dont coffres de la boutique | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 |
| 💰 pièces gagnées / saison | 1 333 681 (827 200–2 172 245) · moy. 1 433 430 ± 553 933 | 1 389 935 (880 739–2 258 561) · moy. 1 497 656 ± 575 386 | 1 409 587 (910 061–2 255 309) · moy. 1 518 396 ± 571 602 |
| 💰 / heure de jeu | 1 000 261 (620 400–1 629 183) · moy. 1 075 072 ± 415 450 | 1 042 451 (660 554–1 693 920) · moy. 1 123 242 ± 431 540 | 1 057 190 (682 546–1 691 482) · moy. 1 138 797 ± 428 702 |
| Auto-Dig atteint (niveau) | 4,0 (4,0–4,0) · moy. 3,9 ± 0,3 | 4,0 (4,0–5,0) · moy. 4,4 ± 0,5 | 5,0 (4,0–5,0) · moy. 4,6 ± 0,5 |
| Auto-Dig 3 · 4 · 5 · 6 : part des joueurs (actuel) | 100 % · 94 % · 1 % · 0 % | 100 % · 100 % · 41 % · 0 % | 100 % · 100 % · 59 % · 0 % |
| Toutes améliorations en pièces au max (h de jeu ; part) | 1,2 (1,2–1,2) · moy. 1,2 ± 0,0 | 1,2 (1,2–1,3) · moy. 1,3 ± 0,0 | 1,3 (1,1–1,3) · moy. 1,2 ± 0,1 |
| — part des joueurs qui ont tout au max | 0 % | 0 % | 0 % |
| 💰 non dépensées en fin de saison | 83 030 (17 513–173 993) · moy. 91 444 ± 64 407 | 87 086 (17 766–177 581) · moy. 94 771 ± 66 692 | 88 967 (18 103–180 446) · moy. 97 189 ± 68 483 |
| Auto-Dig 3 · 4 · 5 · 6 : heures de jeu (médiane) | 0,3 · 0,8 · 1,3 · — | 0,3 · 0,6 · 1,1 · — | 0,2 · 0,5 · 1,0 · — |

#### Régulier (1 h/j, 7 j/7, bonus pub) — 14,0 h de jeu (actif + onglet ouvert)

| Mesure | Actuel | Variante A | Variante B |
|---|---|---|---|
| Profondeur max (m) | 994 (967–1 022) · moy. 994 ± 22 | 1 001 (973–1 029) · moy. 1 001 ± 22 | 1 001 (975–1 030) · moy. 1 002 ± 22 |
| 💎 gagnées / saison | 66,0 (56,0–75,0) · moy. 65,7 ± 7,5 | 130,0 (111,0–150,0) · moy. 130,3 ± 15,1 | 229,0 (197,0–263,0) · moy. 229,6 ± 25,7 |
| 💎 / heure de jeu | 4,71 (4,00–5,36) · moy. 4,69 ± 0,54 | 9,29 (7,93–10,71) · moy. 9,31 ± 1,08 | 16,36 (14,07–18,79) · moy. 16,40 ± 1,84 |
| — dont blocs gemmes | 51,0 (41,0–60,0) · moy. 50,8 ± 7,5 | 110,0 (91,0–130,0) · moy. 110,1 ± 15,0 | 190,0 (159,0–224,0) · moy. 190,8 ± 25,1 |
| — dont série quotidienne | 7,0 (7,0–7,0) · moy. 7,0 ± 0,0 | 7,0 (7,0–7,0) · moy. 7,0 ± 0,0 | 15,0 (15,0–15,0) · moy. 15,0 ± 0,0 |
| — dont missions du jour | 7,0 (6,0–7,0) · moy. 6,8 ± 0,4 | 10,0 (9,0–10,0) · moy. 9,9 ± 0,5 | 13,0 (12,0–13,0) · moy. 12,9 ± 0,5 |
| — dont coffres de la mine | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 2,0 (0,0–4,0) · moy. 2,3 ± 1,5 | 10,0 (5,0–15,0) · moy. 9,9 ± 4,1 |
| 💎 dépensées (Auto-Dig) | 65,0 (30,0–65,0) · moy. 49,5 ± 17,4 | 65,0 (65,0–65,0) · moy. 65,0 ± 0,0 | 110,0 (110,0–110,0) · moy. 110,0 ± 0,0 |
| 💎 en fin de saison (avant plafond) | 13,0 (1,0–33,0) · moy. 16,2 ± 12,3 | 65,0 (46,0–85,0) · moy. 65,3 ± 15,1 | 119,0 (87,0–153,0) · moy. 119,6 ± 25,7 |
| 🔮 fragments / saison | 75,0 (55,0–97,0) · moy. 75,5 ± 16,3 | 76,0 (55,0–98,0) · moy. 76,3 ± 16,4 | 76,0 (55,0–98,0) · moy. 76,2 ± 16,6 |
| 🔮 / heure de jeu | 5,36 (3,93–6,93) · moy. 5,40 ± 1,17 | 5,43 (3,93–7,00) · moy. 5,45 ± 1,17 | 5,43 (3,93–7,00) · moy. 5,45 ± 1,18 |
| — dont coffres de la mine | 65,0 (45,0–87,0) · moy. 65,5 ± 16,3 | 66,0 (45,0–88,0) · moy. 66,3 ± 16,4 | 66,0 (45,0–88,0) · moy. 66,2 ± 16,6 |
| — dont boutique de fragments | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 |
| — dont coffres de la boutique | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 |
| 💰 pièces gagnées / saison | 47 360 981 (38 582 627–58 269 780) · moy. 47 989 248 ± 7 791 202 | 48 617 699 (39 599 090–59 343 389) · moy. 49 134 221 ± 7 898 163 | 48 554 486 (39 680 052–59 859 394) · moy. 49 256 157 ± 7 939 855 |
| 💰 / heure de jeu | 3 382 927 (2 755 902–4 162 127) · moy. 3 427 803 ± 556 514 | 3 472 693 (2 828 506–4 238 813) · moy. 3 509 587 ± 564 155 | 3 468 178 (2 834 289–4 275 671) · moy. 3 518 297 ± 567 132 |
| Auto-Dig atteint (niveau) | 6,0 (5,0–6,0) · moy. 5,6 ± 0,5 | 6,0 (6,0–6,0) · moy. 6,0 ± 0,0 | 6,0 (6,0–6,0) · moy. 6,0 ± 0,0 |
| Auto-Dig 3 · 4 · 5 · 6 : part des joueurs (actuel) | 100 % · 100 % · 100 % · 56 % | 100 % · 100 % · 100 % · 100 % | 100 % · 100 % · 100 % · 100 % |
| Toutes améliorations en pièces au max (h de jeu ; part) | 3,2 (2,4–4,1) · moy. 3,3 ± 0,6 | 3,2 (2,4–4,1) · moy. 3,2 ± 0,6 | 3,2 (2,3–4,1) · moy. 3,2 ± 0,6 |
| — part des joueurs qui ont tout au max | 100 % | 100 % | 100 % |
| 💰 non dépensées en fin de saison | 42 373 511 (33 595 157–53 282 310) · moy. 43 001 778 ± 7 791 202 | 43 630 229 (34 611 620–54 355 919) · moy. 44 146 751 ± 7 898 163 | 43 567 016 (34 692 582–54 871 924) · moy. 44 268 687 ± 7 939 855 |
| Auto-Dig 3 · 4 · 5 · 6 : heures de jeu (médiane) | 0,2 · 1,3 · 4,3 · 12,0 | 0,2 · 1,0 · 2,3 · 6,0 | 0,2 · 0,5 · 2,2 · 5,3 |

#### Assidu (3 h/j + 4 h onglet ouvert) — 49,0 h de jeu (actif + onglet ouvert)

| Mesure | Actuel | Variante A | Variante B |
|---|---|---|---|
| Profondeur max (m) | 2 051 (1 990–2 106) · moy. 2 049 ± 46 | 2 057 (1 996–2 112) · moy. 2 055 ± 46 | 2 056 (1 995–2 113) · moy. 2 055 ± 46 |
| 💎 gagnées / saison | 124,0 (110,0–138,0) · moy. 124,2 ± 10,8 | 293,0 (264,0–324,0) · moy. 293,7 ± 23,8 | 515,0 (463,0–567,0) · moy. 515,0 ± 40,4 |
| 💎 / heure de jeu | 2,53 (2,24–2,82) · moy. 2,53 ± 0,22 | 5,98 (5,39–6,61) · moy. 5,99 ± 0,49 | 10,51 (9,45–11,57) · moy. 10,51 ± 0,83 |
| — dont blocs gemmes | 109,0 (95,0–123,0) · moy. 109,2 ± 10,8 | 270,0 (241,0–301,0) · moy. 270,9 ± 23,6 | 465,0 (415,0–516,0) · moy. 465,3 ± 39,5 |
| — dont série quotidienne | 7,0 (7,0–7,0) · moy. 7,0 ± 0,0 | 7,0 (7,0–7,0) · moy. 7,0 ± 0,0 | 15,0 (15,0–15,0) · moy. 15,0 ± 0,0 |
| — dont missions du jour | 7,0 (7,0–7,0) · moy. 7,0 ± 0,0 | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 | 13,0 (13,0–13,0) · moy. 13,0 ± 0,0 |
| — dont coffres de la mine | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 5,0 (2,0–8,0) · moy. 4,8 ± 2,2 | 20,0 (13,0–29,0) · moy. 20,8 ± 6,1 |
| 💎 dépensées (Auto-Dig) | 65,0 (65,0–65,0) · moy. 65,0 ± 0,0 | 65,0 (65,0–65,0) · moy. 65,0 ± 0,0 | 110,0 (110,0–110,0) · moy. 110,0 ± 0,0 |
| 💎 en fin de saison (avant plafond) | 59,0 (45,0–73,0) · moy. 59,2 ± 10,8 | 228,0 (199,0–259,0) · moy. 228,7 ± 23,8 | 405,0 (353,0–457,0) · moy. 405,0 ± 40,4 |
| 🔮 fragments / saison | 1 860,0 (1 801,0–2 463,0) · moy. 1 928,9 ± 221,2 | 1 862,0 (1 802,0–2 464,0) · moy. 1 933,7 ± 223,4 | 1 861,0 (1 802,0–2 465,0) · moy. 1 932,5 ± 226,7 |
| 🔮 / heure de jeu | 37,96 (36,76–50,27) · moy. 39,37 ± 4,51 | 38,00 (36,78–50,29) · moy. 39,46 ± 4,56 | 37,98 (36,78–50,31) · moy. 39,44 ± 4,63 |
| — dont coffres de la mine | 167,0 (125,0–212,0) · moy. 168,2 ± 34,1 | 167,0 (125,0–213,0) · moy. 168,6 ± 34,0 | 167,0 (124,0–213,0) · moy. 168,1 ± 34,4 |
| — dont boutique de fragments | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 |
| — dont coffres de la boutique | 1 681,0 (1 642,0–2 240,0) · moy. 1 750,7 ± 203,8 | 1 684,0 (1 642,0–2 243,0) · moy. 1 755,1 ± 206,1 | 1 684,0 (1 642,0–2 245,0) · moy. 1 754,4 ± 209,1 |
| 💰 pièces gagnées / saison | 250 215 905 (215 649 566–287 356 389) · moy. 251 060 294 ± 28 108 315 | 250 865 926 (217 123 380–289 495 566) · moy. 252 199 455 ± 28 230 888 | 251 242 434 (216 762 418–288 220 049) · moy. 252 070 527 ± 28 014 376 |
| 💰 / heure de jeu | 5 106 447 (4 401 012–5 864 416) · moy. 5 123 679 ± 573 639 | 5 119 713 (4 431 089–5 908 073) · moy. 5 146 928 ± 576 141 | 5 127 397 (4 423 723–5 882 042) · moy. 5 144 296 ± 571 722 |
| Auto-Dig atteint (niveau) | 6,0 (6,0–6,0) · moy. 6,0 ± 0,0 | 6,0 (6,0–6,0) · moy. 6,0 ± 0,0 | 6,0 (6,0–6,0) · moy. 6,0 ± 0,0 |
| Auto-Dig 3 · 4 · 5 · 6 : part des joueurs (actuel) | 100 % · 100 % · 100 % · 100 % | 100 % · 100 % · 100 % · 100 % | 100 % · 100 % · 100 % · 100 % |
| Toutes améliorations en pièces au max (h de jeu ; part) | 2,8 (2,4–3,2) · moy. 2,8 ± 0,6 | 2,8 (2,4–3,2) · moy. 2,8 ± 0,6 | 2,8 (2,4–3,2) · moy. 2,8 ± 0,6 |
| — part des joueurs qui ont tout au max | 100 % | 100 % | 100 % |
| 💰 non dépensées en fin de saison | 243 392 435 (208 826 096–280 532 919) · moy. 244 236 824 ± 28 108 315 | 244 042 456 (210 299 910–282 672 096) · moy. 245 375 985 ± 28 230 888 | 244 418 964 (209 938 948–281 396 579) · moy. 245 247 057 ± 28 014 376 |
| Auto-Dig 3 · 4 · 5 · 6 : heures de jeu (médiane) | 0,2 · 0,7 · 5,0 · 17,5 | 0,2 · 0,4 · 2,5 · 5,6 | 0,1 · 0,4 · 2,4 · 5,3 |

#### Automatique (15 min/j + 8 h onglet) — 57,8 h de jeu (actif + onglet ouvert)

| Mesure | Actuel | Variante A | Variante B |
|---|---|---|---|
| Profondeur max (m) | 692 (663–719) · moy. 691 ± 22 | 722 (691–751) · moy. 721 ± 23 | 728 (697–756) · moy. 727 ± 23 |
| 💎 gagnées / saison | 49,0 (40,0–57,0) · moy. 48,7 ± 6,7 | 89,0 (73,0–105,0) · moy. 88,8 ± 12,7 | 158,0 (131,0–186,0) · moy. 158,2 ± 21,8 |
| 💎 / heure de jeu | 0,85 (0,69–0,99) · moy. 0,84 ± 0,12 | 1,54 (1,26–1,82) · moy. 1,54 ± 0,22 | 2,74 (2,27–3,22) · moy. 2,74 ± 0,38 |
| — dont blocs gemmes | 34,0 (26,0–43,0) · moy. 34,1 ± 6,5 | 69,0 (53,0–85,0) · moy. 68,8 ± 12,6 | 120,0 (94,0–149,0) · moy. 120,9 ± 21,5 |
| — dont série quotidienne | 7,0 (7,0–7,0) · moy. 7,0 ± 0,0 | 7,0 (7,0–7,0) · moy. 7,0 ± 0,0 | 15,0 (15,0–15,0) · moy. 15,0 ± 0,0 |
| — dont missions du jour | 7,0 (6,0–7,0) · moy. 6,6 ± 0,6 | 10,0 (9,0–12,0) · moy. 10,4 ± 1,0 | 14,0 (12,0–17,0) · moy. 14,2 ± 1,5 |
| — dont coffres de la mine | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 1,0 (0,0–3,0) · moy. 1,6 ± 1,3 | 7,0 (3,0–12,0) · moy. 7,1 ± 3,4 |
| 💎 dépensées (Auto-Dig) | 30,0 (30,0–30,0) · moy. 30,3 ± 3,6 | 65,0 (65,0–65,0) · moy. 64,1 ± 5,5 | 110,0 (110,0–110,0) · moy. 109,4 ± 5,9 |
| 💎 en fin de saison (avant plafond) | 18,0 (10,0–27,0) · moy. 18,3 ± 6,6 | 24,0 (9,0–40,0) · moy. 24,7 ± 12,0 | 48,0 (22,0–76,0) · moy. 48,8 ± 21,1 |
| 🔮 fragments / saison | 49,0 (35,0–66,0) · moy. 49,9 ± 12,3 | 52,0 (36,0–70,0) · moy. 52,4 ± 12,9 | 52,0 (36,0–70,0) · moy. 52,8 ± 13,0 |
| 🔮 / heure de jeu | 0,85 (0,61–1,14) · moy. 0,86 ± 0,21 | 0,90 (0,62–1,21) · moy. 0,91 ± 0,22 | 0,90 (0,62–1,21) · moy. 0,91 ± 0,22 |
| — dont coffres de la mine | 39,0 (25,0–56,0) · moy. 39,9 ± 12,3 | 42,0 (26,0–60,0) · moy. 42,4 ± 12,9 | 42,0 (26,0–60,0) · moy. 42,8 ± 13,0 |
| — dont boutique de fragments | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 |
| — dont coffres de la boutique | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 |
| 💰 pièces gagnées / saison | 13 604 082 (10 982 335–16 538 256) · moy. 13 700 015 ± 2 161 183 | 15 461 679 (12 488 815–18 820 764) · moy. 15 558 070 ± 2 456 454 | 15 781 500 (12 787 871–19 119 317) · moy. 15 880 734 ± 2 470 328 |
| 💰 / heure de jeu | 235 569 (190 170–286 377) · moy. 237 230 ± 37 423 | 267 735 (216 257–325 901) · moy. 269 404 ± 42 536 | 273 273 (221 435–331 070) · moy. 274 991 ± 42 776 |
| Auto-Dig atteint (niveau) | 5,0 (5,0–5,0) · moy. 5,0 ± 0,1 | 6,0 (6,0–6,0) · moy. 6,0 ± 0,2 | 6,0 (6,0–6,0) · moy. 6,0 ± 0,1 |
| Auto-Dig 3 · 4 · 5 · 6 : part des joueurs (actuel) | 100 % · 100 % · 100 % · 1 % | 100 % · 100 % · 100 % · 98 % | 100 % · 100 % · 100 % · 99 % |
| Toutes améliorations en pièces au max (h de jeu ; part) | 33,0 (27,5–38,5) · moy. 33,0 ± 4,0 | 30,3 (26,1–35,8) · moy. 30,7 ± 3,7 | 30,3 (25,2–35,6) · moy. 30,3 ± 3,7 |
| — part des joueurs qui ont tout au max | 100 % | 100 % | 100 % |
| 💰 non dépensées en fin de saison | 8 616 612 (5 994 865–11 550 786) · moy. 8 712 545 ± 2 161 183 | 10 474 209 (7 501 345–13 833 294) · moy. 10 570 600 ± 2 456 454 | 10 794 030 (7 800 401–14 131 847) · moy. 10 893 264 ± 2 470 328 |
| Auto-Dig 3 · 4 · 5 · 6 : heures de jeu (médiane) | 5,5 · 12,4 · 33,0 · 55,6 | 5,4 · 8,3 · 19,3 · 41,8 | 4,3 · 8,3 · 16,6 · 39,4 |

### Accumulation sur 8 saisons — 2 000 joueurs par profil (barème actuel)

| Profil | Saison | Profondeur max | 💎 gagnées | 💎 en fin (avant plafond) | 💎 perdues au plafond | 🔮 gagnées | Niveaux de reliques | Coffres boutique |
|---|---|---|---|---|---|---|---|---|
| Débutant (20 min/j, 4 j/7) | 1 | 310 | 18,0 | 6,0 | 0,0 (moy.) | 21 | 2 / 30 | 0 |
| Débutant (20 min/j, 4 j/7) | 4 | 395 | 24,0 | 9,0 | 0,0 (moy.) | 45 | 8 / 30 | 0 |
| Débutant (20 min/j, 4 j/7) | 8 | 472 | 31,0 | 13,0 | 0,0 (moy.) | 90 | 16 / 30 | 0 |
| Régulier (1 h/j, 7 j/7, bonus pub) | 1 | 994 | 66,0 | 12,0 | 0,0 (moy.) | 75 | 6 / 30 | 0 |
| Régulier (1 h/j, 7 j/7, bonus pub) | 4 | 1 325 | 95,0 | 74,5 | 0,8 (moy.) | 244 | 20 / 30 | 0 |
| Régulier (1 h/j, 7 j/7, bonus pub) | 8 | 1 778 | 137,0 | 172,0 | 72,5 (moy.) | 503 | 30 / 30 | 0 |
| Assidu (3 h/j + 4 h onglet ouvert) | 1 | 2 049 | 124,0 | 59,0 | 0,0 (moy.) | 1 861 | 30 / 30 | 1 800 |
| Assidu (3 h/j + 4 h onglet ouvert) | 4 | 3 383 | 252,0 | 287,0 | 186,3 (moy.) | 4 239 | 30 / 30 | 1 800 |
| Assidu (3 h/j + 4 h onglet ouvert) | 8 | 3 383 | 249,0 | 284,0 | 184,6 (moy.) | 4 239 | 30 / 30 | 1 800 |
| Automatique (15 min/j + 8 h onglet) | 1 | 694 | 49,0 | 18,0 | 0,0 (moy.) | 49 | 4 / 30 | 0 |
| Automatique (15 min/j + 8 h onglet) | 4 | 948 | 69,0 | 25,0 | 0,0 (moy.) | 151 | 16 / 30 | 0 |
| Automatique (15 min/j + 8 h onglet) | 8 | 1 448 | 113,0 | 130,5 | 30,2 (moy.) | 410 | 29 / 30 | 0 |

### Effet des avantages sur la profondeur (saison 1, 10 000 saisons, barème actuel)

| Profil | Référence | Sans Auto-Dig en gemmes | Ramassage auto des coffres (onglet ouvert) | Boost ×2 pièces 30 min / jour | Écart Auto-Dig gemmes | Écart ramassage | Écart boost |
|---|---|---|---|---|---|---|---|
| Débutant (20 min/j, 4 j/7) | 310 m | 304 m | — | 326 m | -1,9 % | — | +5,2 % |
| Régulier (1 h/j, 7 j/7, bonus pub) | 994 m | 965 m | 995 m | 998 m | -2,9 % | +0,1 % | +0,4 % |
| Assidu (3 h/j + 4 h onglet ouvert) | 2 051 m | 1 979 m | 2 053 m | 2 055 m | -3,5 % | +0,1 % | +0,2 % |
| Automatique (15 min/j + 8 h onglet) | 692 m | 559 m | 720 m | 701 m | -19,2 % | +4,0 % | +1,3 % |

### Conversion des pièces en coffres de la boutique — 2 000 joueurs × 4 saisons

| Scénario | 🔮 saison 1 | Reliques S1 (/30) | Profondeur S1 | Profondeur S2 | Écart S2 | Profondeur S4 | Écart S4 |
|---|---|---|---|---|---|---|---|
| Assidu — sans coffres de la boutique | 176 | 10 | 2 048 m | 2 408 m | +0,0 % | 3 330 m | +0,0 % |
| Assidu — simple à 800 (production), 1 h d'ouvertures (1 800) | 1 860 | 30 | 2 048 m | 3 384 m | +40,5 % | 3 383 m | +1,6 % |
| Assidu — simple à 2 000 (défaut du code), 1 800 ouvertures | 1 860 | 30 | 2 048 m | 3 384 m | +40,5 % | 3 383 m | +1,6 % |
| Assidu — simple à 800, 300 ouvertures / saison | 511 | 18 | 2 048 m | 2 734 m | +13,5 % | 3 384 m | +1,6 % |
| Assidu — script au plafond du limiteur (30/min, 24 h) | 39 120 | 30 | 2 048 m | 3 384 m | +40,5 % | 3 383 m | +1,6 % |
| Régulier — sans coffres de la boutique | 75 | 6 | 993 m | 1 127 m | +0,0 % | 1 327 m | +0,0 % |
| Régulier — simple à 800, 300 ouvertures / saison | 407 | 16 | 993 m | 1 314 m | +16,5 % | 1 779 m | +34,1 % |

