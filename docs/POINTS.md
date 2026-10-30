# Points de récompense saisonniers (#33)

Monnaie de fidélité **distincte des pièces et des gemmes** : attribuée à la fin de chaque saison
selon le rang au **classement figé** (#29), conservée d'une saison à l'autre, dépensable plus tard
dans la boutique de cadeaux (#34). Code : `server/rewardPoints.js`.

## 1. Règles fixes (implémentées)

- **Mérite uniquement** : le rang vient de l'instantané figé à la clôture (`season_standings`,
  ordre profondeur ↓, blocs manuels validés ↓, premier arrivé ↑, identifiant ↑). Aucun hasard.
- **Éligibles** : participants éligibles de l'instantané (au moins un bloc cassé à la main,
  profondeur validée > 0, compte existant). Option `maxRiskLevel` pour écarter un niveau de risque
  anti-bot (désactivée : sanctions #25 lot C non décidées).
- **Catégories exclusives**, évaluées dans l'ordre ; la première qui correspond s'applique :
  `rankMax` (rang ≤ N) ou `percentMax` (top p %, borne = ⌈éligibles × p / 100⌉, au moins le 1er),
  `minEligible` (catégorie ignorée sous ce nombre d'éligibles), sans condition = autres participants.
- **Égalités** : le classement figé n'a pas d'ex æquo (départage déterministe). Option
  `tiesShareTier` (activée) : des joueurs parfaitement à égalité sur les critères de mérite
  (même profondeur, mêmes blocs validés) reçoivent la meilleure catégorie du groupe ; seul le
  départage technique (heure d'arrivée, identifiant) ne coûte donc jamais de points.
- **Ligues (#19)** : option `leagueBonusPctPerLevel` (+p % par niveau de ligue), à 0 tant que les
  règles de ligues ne sont pas décidées.
- **Pas de conversion** en pièces, gemmes ou argent, **pas de transfert** entre joueurs, **pas
  d'achat** de points.
- **Deux usages** à la dépense : `virtual` (avantages virtuels, ouverts) et `real` (cadeaux réels,
  **refusés** tant que `CONTEST_REAL_PRIZES` ≠ `on`, décision #27).

## 2. Modes

| Mode | Effet | Par défaut |
|---|---|---|
| `simulation` | À chaque clôture, les points sont **calculés et affichés** (aperçu joueur, panel), **jamais crédités**. | **oui** |
| `live` | Les saisons qui se terminent **après l'activation** sont créditées au portefeuille. Aucune saison antérieure n'est créditée rétroactivement. | non — décision du propriétaire |

Le passage en `live` vaut validation du barème en vigueur : panel admin, onglet **🏅 Points**,
bouton « Activer le crédit réel des points ».

## 3. Barème proposé (version 1, **non validé**, appliqué en simulation seulement)

| Catégorie | Condition | Points |
|---|---|---|
| 1er | rang 1, dès 3 éligibles | 100 |
| Top 1 % | dès 10 éligibles | 60 |
| Top 5 % | dès 10 éligibles | 40 |
| Top 10 % | dès 10 éligibles | 30 |
| Top 25 % | dès 4 éligibles | 20 |
| Top 50 % | dès 2 éligibles | 12 |
| Autres participants | éligible | 5 |

Répartition simulée (barème v1) :

| Éligibles | Catégories | Total distribué | Moyenne |
|---|---|---|---|
| 1 | 1 participant | 5 | 5 |
| 2 | top 50 % ×1, participant ×1 | 17 | 8,5 |
| 3 | 1er, top 50 %, participant | 117 | 39 |
| 10 | 1er, top 25 % ×2, top 50 % ×2, participants ×5 | 189 | 18,9 |
| 100 | 1er, top 5 % ×4, top 10 % ×5, top 25 % ×15, top 50 % ×25, participants ×50 | 1 260 | 12,6 |
| 1 000 | 1er, top 1 % ×9, top 5 % ×40, top 10 % ×50, top 25 % ×150, top 50 % ×250, participants ×500 | 12 240 | 12,2 |

Les minimums évitent qu'un joueur seul (ou à deux) gagne le maximum chaque semaine. La valeur
d'échange des points (prix dans la boutique) relève de #34.

## 4. Registre et garanties

- `reward_point_ledger` : un mouvement par ligne (crédit/débit, solde après, type, usage, saison,
  motif), **ajout seul** (déclencheurs), clé d'idempotence **UNIQUE**.
- `reward_point_wallets` : solde courant (`CHECK balance >= 0`), total gagné, total dépensé.
  Contrôle `verifyLedger()` : solde = somme du registre (affiché dans le panel).
- Crédit de fin de saison : clé `season:<saison>:user:<joueur>` → jamais deux fois.
- Dépense (#34) : transaction, solde vérifié, clé d'idempotence fournie par l'appelant (une
  commande rejouée ne débite pas deux fois ; même clé + autre montant = refus 409).
- `reward_point_awards` / `reward_point_runs` : attributions par (saison, mode), ajout seul, avec
  la version du barème et l'empreinte de l'instantané figé.
- `reward_point_scales` : toutes les versions du barème sont conservées.
- Les points ne sont **pas** dans la sauvegarde de jeu : ils survivent au reset de saison et ne
  peuvent pas être modifiés par le client.

## 5. API

| Route | Accès | Rôle |
|---|---|---|
| `GET /api/points/scale` | public | mode et barème |
| `GET /api/points/me` | joueur connecté | solde, historique, attributions, récompense potentielle |
| `GET /api/admin/points` | admin | réglages, versions, exécutions, totaux, contrôle du registre |
| `PUT /api/admin/points/scale` | admin | nouvelle version du barème (`{ scale, note }`) |
| `POST /api/admin/points/scale/preview` | admin | aperçu d'un barème sur une saison figée |
| `PUT /api/admin/points/mode` | admin | `simulation` / `live` |
| `GET /api/admin/points/seasons/:id` | admin | attributions d'une saison |
| `POST /api/admin/points/adjust` | admin | ajustement motivé (`{ userId, amount, reason }`) |

## 6. Retour arrière

Les tables ajoutées sont ignorées par le code antérieur. Revenir en `simulation` arrête les
crédits futurs ; les points déjà crédités restent acquis (un retrait se fait par ajustement
motivé, tracé). Aucune donnée existante n'est modifiée par cette fonctionnalité.
