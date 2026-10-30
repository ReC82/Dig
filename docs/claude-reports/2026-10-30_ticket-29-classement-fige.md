# Ticket #29 — Classement saisonnier figé, attribution déterministe au mérite

- Ticket : [#29 — [P1] Classement saisonnier figé — attribution déterministe au mérite](https://github.com/ReC82/Dig/issues/29)
- Session : 30/10/2026 (session 1)
- Classement MVP : **Après lancement** pour l'usage (points #33, boutique #34). Le figement doit
  toutefois être en place **avant** la première saison qui compte pour des points : il est donc
  déployé maintenant.

## 1. État réel

**Déployé en production (SHA `10ce36f`) le 30/10/2026 à 14:13 (Bruxelles), en attente de recette.**
Aucun changement visible en jeu. Le classement figé est consultable par l'API ; la première vraie
clôture figée aura lieu dimanche 01/11 à 23:59:59 UTC (fin de la saison 44-2026).

## 2. Périmètre retenu

Le ticket décrivait d'abord un tirage au sort pondéré par la profondeur. Le propriétaire l'a
abandonné le 30/10 (commentaire du ticket) au profit d'un **concours au mérite** : « réorienter le
ticket vers le classement saisonnier figé et l'attribution déterministe ; coordonner avec #33 et
#34 ». **Aucun tirage n'est implémenté**, même pour départager. L'attribution des points (#33), la
boutique (#34), l'interface joueur (#31) et l'administration des lots (#30) restent dans leurs
tickets.

## 3. Résultat et changements

**Comportement :** à chaque clôture de saison, le serveur copie le classement dans deux tables
qui ne peuvent plus être modifiées. Le résultat d'une saison est donc définitif et vérifiable. Une
correction admin ou une écriture tardive dans le classement vivant n'y change plus rien.

| Fichier | Changement |
|---|---|
| `server/db.js` | Migration additive : colonne `season_rankings.max_depth_reached_at` ; tables `season_snapshots` (1 ligne par saison) et `season_standings` (1 ligne par participant) ; 4 déclencheurs qui refusent `UPDATE`/`DELETE` sur ces tables. L'horodatage « profondeur atteinte » est posé à la milliseconde quand la profondeur max augmente. Un ordre de classement unique (`RANK_ORDER`) sert à tous les classements (vivant, ligue, promotions, figé). |
| `server/standings.js` (nouveau) | Calcul du classement figé, figement idempotent et transactionnel, rattrapage, vérification des empreintes, lecture paginée. |
| `server/seasons.js` | Figement dans la transaction de clôture (`closeActiveSeason`) ; le planificateur (chaque minute) fige les saisons closes sans instantané. |
| `server/index.js` | `GET /api/seasons/:id/standings` et `GET /api/seasons/last/standings` (public) ; `GET /api/admin/seasons/:id/standings` (complet, avec vérification) ; figement immédiat lors d'une clôture admin manuelle. |
| `test/standings.test.js` (nouveau) | 10 tests (voir § 5). |
| `docs/LIGUES.md` | Règle de départage et classement figé documentés. |

**Règles appliquées (mérite, déterministe) :**
- **Participants** : joueurs actifs de la saison ayant cassé au moins un bloc à la main (mêmes
  critères que le classement affiché).
- **Éligibles** : participants dont la profondeur validée par le serveur est > 0 et dont le
  compte existe. Les non-éligibles restent dans l'instantané avec leur motif (`depth_zero`).
- **Ordre** : profondeur max validée ↓, blocs manuels validés ↓, **premier à avoir atteint cette
  profondeur** ↑, identifiant du compte ↑. Les lignes d'avant ce déploiement n'ont pas d'instant
  d'arrivée et passent après, à égalité. C'est l'ordre de l'article 5 du projet de règlement.
- **Leader** = 1er éligible, noté dans l'instantané. **Mode `simulation`** : aucun prix, aucun point
  n'est attribué ici.
- **Anti-bot (#25)** : le niveau de risque de chaque participant est enregistré pour l'audit,
  **sans exclusion automatique**. Les sanctions (lot C) ne sont pas décidées.
- **Preuve** : empreinte SHA-256 des lignes (forme canonique documentée dans `standings.js`), puis
  empreinte de l'instantané qui inclut celle du précédent (chaîne). Modifier une saison passée
  casse toute la suite. Un journal `standings_frozen` est écrit dans `security_events`.
- **Pannes** : le figement est dans la transaction de clôture (savepoint). S'il échoue, la saison
  se clôt quand même, sans instantané partiel, et la suivante s'ouvre : la rotation n'est jamais
  bloquée. L'échec est journalisé (`standings_freeze_failed`) et le planificateur retente chaque
  minute. Aucun score n'est accepté pour une saison close : le résultat retenté est le même.
- **Zéro participant** : instantané vide, sans leader, statut `no_eligible_participant`.
- **Saisons closes avant #29** : figées au démarrage par rattrapage (`source: backfill`), dans
  l'ordre chronologique. En production, cela concerne les 5 saisons passées (2 avec 1 participant,
  3 vides).

## 4. SHA, branche et procédure de test

- Branche : `feature/29-classement-fige` — commit code `8ea524a`.
- **SHA sur `develop`** : `10ce36f` (fusion).
- Tests : `npm test` (206/206), dont `node --test test/standings.test.js` (10/10) ;
  `node server/test-season.js` (62/62).
- Essai manuel : `curl https://dig.lodygames.com/api/seasons/last/standings` → dernière saison
  figée ; `…/api/seasons/1/standings` → saison 4-2026 avec son classement et son empreinte.

## 5. Vérifications

**Effectuées :**
- Calcul : éligibilité, rangs global et de ligue, exclusions visibles, risque noté sans exclusion.
- Horodatage : posé à la première atteinte, inchangé à profondeur égale ou inférieure, renouvelé à
  la hausse.
- Clôture : ordre au mérite avec ex æquo départagés par l'instant d'arrivée (un identifiant plus
  grand arrivé avant passe devant), lignes sans instant après, non-participant exclu. L'ordre est
  identique à celui du classement vivant. Idempotence (2ᵉ figement sans effet). Une correction
  admin après la clôture ne change pas le résultat.
- Immuabilité : `UPDATE`/`DELETE` refusés par la base ; saison active non figeable.
- Falsification d'une copie (déclencheur retiré) : l'empreinte recalculée ne correspond plus.
- Saison vide, chaîne d'empreintes, panne simulée pendant la clôture (rotation non bloquée, aucun
  instantané partiel, échec journalisé, rattrapage ensuite), rattrapage des saisons anciennes.
- **Déterminisme** (test statistique adapté au mérite) : 40 joueurs à fortes égalités, insérés
  dans 200 ordres aléatoires → un seul classement et une seule empreinte, ordre vérifié paire par
  paire.
- HTTP (port 3129, base temporaire) : 404 sans saison figée, 400 identifiant invalide, clôture
  admin → instantané `admin_close`, pas de données d'audit en public, `me` pour le joueur
  connecté, admin 401 sans jeton, vérification `ok`.
- **Migration sur une copie de la base de production** (mode production, port 3101) : empreintes
  identiques avant et après (`users`, `user_saves`, `season_rankings`, `seasons`, `leagues`,
  `player_click_tracking`), `quick_check` ok, 5 saisons passées figées et vérifiées. Un 2ᵉ
  démarrage ne crée rien de plus. La copie a été supprimée.

**Non effectuées / limites :**
- Pas de vraie clôture en production avant ce dimanche 01/11 à 23:59:59 UTC (saison 44-2026).
- Une correction admin de profondeur ne modifie pas l'instant d'arrivée.
- Pas d'interface en jeu ni dans le panel admin : elle relève de #31 et #30. L'API suffit pour
  #33.

**Données des joueurs :** rien n'est supprimé ni réécrit. Ajouts seuls : 1 colonne (vide pour les
lignes existantes), 2 tables, 4 déclencheurs, 1 index. Les nouvelles tables ne référencent pas
`users` par clé étrangère : la suppression d'un compte reste possible et l'instantané le conserve
(nom affiché `null`).

## 6. Déploiement

- **SHA déployé : `10ce36f`** (production précédente : `64332b2`), servi en `1.0.0+10ce36f` sur
  https://dig.lodygames.com et https://dig.lodylands.com (200).
- **Avant** : release détachée, `npm ci`, `npm test` **206/206** sur le SHA exact. Copie de la base
  de production démarrée en mode production (port 3122) : santé et version OK, empreintes des 6
  tables identiques, `quick_check` ok, 5 instantanés créés. Copie supprimée ensuite.
- **Sauvegarde pré-déploiement vérifiée** : `~/backups/dig/dig-20261030-141323-pre-deploy-10ce36f.sqlite`.
- **Après** : 2 domaines 200 et bonne version, `journalctl` sans erreur (5 saisons passées figées
  au démarrage), `quick_check` ok, empreintes `users`, `user_saves`, `season_rankings`,
  `seasons`, `leagues` et `player_click_tracking` **identiques** à la sauvegarde. L'API
  `/api/seasons/1/standings` répond en production.
- **Retour arrière** : `git -C /home/ubuntu/Dig reset --keep 64332b2` puis
  `sudo systemctl restart dig` (`package-lock.json` inchangé). Les tables ajoutées sont ignorées par
  l'ancien code. La base n'est jamais restaurée.

**Test fonctionnel à faire par le propriétaire (2 min) :**
1. Ouvrir https://dig.lodygames.com/api/seasons/last/standings : réponse JSON de la saison
   « Saison 41-2026 » (vide, `participants: 0`), avec `prizeMode: "simulation"` et une empreinte
   `hash` de 64 caractères.
2. Ouvrir https://dig.lodygames.com/api/seasons/1/standings : « Saison 4-2026 », toi au rang 1
   (26 m), `eligible: true`.
3. Jouer normalement : rien ne change en jeu (classement, rang et onglet Saison comme avant).
4. **Lundi 02/11** : rouvrir `…/api/seasons/last/standings` → « Saison 44-2026 » figée
   (`source: "close"`), avec ta profondeur de fin de semaine. Ce résultat ne bouge plus ensuite.

## 7. Choix techniques faits seul

- **Pas d'exclusion anti-bot automatique** : le lot C de #25 n'est pas décidé. Le niveau de
  risque est conservé dans l'instantané, donc l'exclusion pourra être décidée plus tard, de façon
  révisable, sans perte d'information.
- **Panne de figement non bloquante** pour la rotation. Bloquer la clôture aurait gelé le jeu
  (aucune nouvelle saison). Comme le classement d'une saison close n'évolue plus, le figement
  rattrapé donne le même résultat.
- **Rattrapage des saisons passées** : utile pour l'historique et sans risque (ajout seul) ; ces
  instantanés sont marqués `backfill`.
- **Départage horodaté côté serveur** (instant d'acceptation de la sauvegarde, à la ms), jamais
  l'horloge du client. Les ex æquo dans la même milliseconde sont départagés par l'identifiant.
- **Déclencheurs SQLite** plutôt qu'une simple convention, pour que l'immuabilité soit garantie
  par la base.

## 8. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire pour ce ticket. Les points ouverts relèvent d'autres
tickets : le barème de points (#33), l'exclusion des tricheurs (lot C de #25), l'affichage en jeu
(#31) et l'administration (#30).

## 9. Reste à réaliser (autres tickets)

- #33 : créditer les points à partir de `season_standings` (rang, rang de ligue, éligibilité),
  avec un registre idempotent (clé `season_id` + `user_id`).
- #31 : afficher en jeu le résultat figé de la saison précédente (`/api/seasons/last/standings`,
  champ `me`).
- #30 : vue admin des instantanés (l'API `GET /api/admin/seasons/:id/standings` existe, avec
  vérification) ; procédure d'exclusion motivée après la clôture (table d'ajustements séparée, sans
  toucher à l'instantané).
- Repéré hors périmètre : la clôture admin manuelle (`PUT … status: closed`) n'applique pas les
  promotions, contrairement à `POST …/close`. Ce comportement préexistant est à harmoniser dans
  #19/#30.
