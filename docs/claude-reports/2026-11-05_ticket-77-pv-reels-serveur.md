# Ticket #77 — [P0][Anti-bot] Recalculer les PV réels des blocs côté serveur pour valider la progression

- Ticket : [#77](https://github.com/ReC82/Dig/issues/77). Liés : [#74](https://github.com/ReC82/Dig/issues/74) (rapport de résistance, recommandation P0-2), [#25](https://github.com/ReC82/Dig/issues/25) (anti-bot, budget de dégâts lot B). Distinct de #49 (contrôle économique, décision du propriétaire).
- Session du 05/11/2026 (après-midi), branche `fix/77-pv-reels-serveur`.
- **État réel : Déployé en production (SHA `9fc4acb`), en mode observation (`exact_hp_mode = shadow`). En attente de recette.**

Toutes les heures sont en heure de Bruxelles. Ce rapport ne contient aucune donnée personnelle de joueur.

---

## 1. Résultat en bref

1. **Le serveur recalcule désormais les PV réels de chaque bloc** qu'une sauvegarde déclare détruit. Il rejoue le tirage du jeu à l'identique, à partir de la graine des blocs et du numéro de chaque bloc (#35).
2. Le test compare ce recalcul au vrai code du jeu (`Blocks.spawn`) sur 2 000 tirages et 5 graines : il donne **exactement les mêmes PV**.
3. Avant, chaque mètre coûtait les PV du bloc le plus faible avec −50 %. Maintenant, il coûte **les PV de son vrai bloc**. Le coût d'un mètre est **3,5 à 4 fois plus élevé** (mesuré de 1 à 2 100 m, catalogue intégré, 5 graines). Le rapport #74 l'estimait entre 5 et 7.
4. **Sauvegardes forgées** (profondeur déclarée sans jouer) : il fallait 10,2 min pour atteindre 1 003 m, il en faut maintenant **37,6**.
5. **Joueurs honnêtes simulés avec le vrai jeu** : aucun mètre perdu, aucun signal, y compris au maximum théorique. Cas couverts : 12 coups/s × 25 dégâts, Auto-Dig max, −50 %, mobile, rerolls, sauvegardes perdues, rechargements, 2ᵉ appareil, saison suivante.
6. **Rien n'est encore appliqué aux joueurs** : le nouveau calcul est en **observation** (`shadow`). Il calcule, journalise et affiche dans la fiche joueur, mais **ne réduit aucune profondeur**. Le passage au rejet strict (`enforce`) est **une décision du propriétaire**, à prendre après observation (§ 8).
7. Aucun prix, probabilité, achat, solde, classement ni score anti-bot n'a changé. Personne n'a été sanctionné ni réinitialisé.

## 2. Ce qui est effectivement appliqué en production

| Contrôle | Mode en production | Effet réel sur les joueurs |
|---|---|---|
| Limiteur de cadence du jeu (#74) | actif (12 coups/s, rafale 36) | inchangé |
| Validation de profondeur (#9) | actif | inchangé |
| Budget de dégâts aux PV **minimum** (#25, lot B) | `enforce` | inchangé : borne la profondeur classée |
| **Budget aux PV réels (#77)** | **`shadow`** | **aucun** : calcul, journal (0 point) et fiche joueur |
| Score de risque (#25, lot A) | `shadow` | inchangé ; les observations #77 n'ajoutent **aucun point** |

## 3. Changements réalisés

**Serveur**
- `server/blockHp.js` (nouveau) recalcule les PV :
  - même générateur (`rng(graine, n°, 'hp')`), même pool sans Chance, même ordre des opérations : `ceil(hpBase × (1 + 0,12 (d − 1)) × 0,5)` ;
  - c'est la borne inférieure exacte : un joueur qui a −50 % a exactement ces PV, un autre en a davantage ;
  - les rerolls (un n° consommé sans descendre) sont pris en compte : le coût retenu est le minimum sur tous les placements possibles des blocs sautés (programmation dynamique).
- `server/seasons.js`, `validateDepth` : budget « PV réels » calculé en parallèle du budget #25.
  - Il utilise le même crédit : clics crédités au plus à 15/s selon le **temps mesuré par le serveur**, × 25 dégâts, Auto-Dig max, réserve de 10 min.
  - **Graine épinglée** à la première sauvegarde de la saison. Un changement est admis 3 fois par saison, puis la graine épinglée est conservée.
  - **Blocs sautés** admis = rerolls déclarés (≤ 99 par saison) + une réserve de 3 (recharge : 1 par 10 min), et au plus 32 par sauvegarde. Au-delà, ou si le jeu n'envoie plus son bloc courant, le serveur poursuit **sa propre suite** de numéros. Il est donc impossible de « choisir » des blocs faibles.
  - **Catalogue** : celui que le jeu déclare, le catalogue intégré et la version en vigueur sont évalués séparément ; le plus favorable au joueur est retenu.
  - **Anciens clients** (sans graine ni bloc courant) : ancienne borne, sans aucun signal.
- `server/antibot.js` :
  - nouveau réglage `exact_hp_mode` : `off` | `shadow` (défaut) | `enforce`. Il est coupé si `damage_budget_mode = off` ou `ANTIBOT=off` ;
  - le budget accepte un coût par mètre interchangeable ;
  - 4 observations **à 0 point** sont journalisées sans toucher au score : `exact_hp_budget`, `block_hp_mismatch` (PV du bloc courant falsifiés), `block_seed_changed`, `block_seq_skips`.
- Migrations, **toutes par ajout** et idempotentes :
  - `player_depth_tracking.xhp_state` (TEXT, NULL pour les lignes existantes) ;
  - `antibot_save_samples.exact_depth` (INTEGER) ;
  - réglage `exact_hp_mode = shadow` (`ON CONFLICT DO NOTHING`).
- `server/index.js` : action `exact_capped` acceptée par le filtre du journal anti-autoclic (émise seulement en `enforce`).

**Jeu** : la sauvegarde indique la version du catalogue de blocs en usage (`blockCatalog`). Rien d'autre ne change, rien n'est visible.

**Admin**
- Config → Protections : réglage « Budget aux PV réels des blocs ».
- Anti-bot → journal : 4 filtres « (0 point) ».
- Fiche joueur : « Profondeur couverte aux PV réels », écart, colonne « PV réels » des échantillons.

**Documentation** : `docs/ANTI-BOT.md` § 11.

## 4. SHA, branche et procédure de test

- Branche `fix/77-pv-reels-serveur`, commit `6fc328c`.
- **`develop` = `9fc4acb`** (merge), identique à la branche testée.
- Tests : `npm test` → **765/765** sur la branche, puis **765/765** sur le SHA exact de release `9fc4acb`. Le test instable `rate-limit` n'a pas eu besoin d'être relancé.
- Nouveau fichier `test/exact-hp-77.test.js` (21 tests) : `node --test test/exact-hp-77.test.js`. Il couvre :
  - **rejeu exact** des PV (catalogue intégré et catalogue publié) ;
  - **joueurs honnêtes**, en shadow et en enforce : maximum théorique, mobile, rerolls fréquents et en rafale de 30, Chance 12, sauvegarde pendant l'animation de destruction, rechargements de page, 2ᵉ appareil, redémarrage du serveur, saison suivante, ancien client, ligne antérieure à #77. Attendu : aucune perte, aucun signal ;
  - **incident #74 rejoué** et **sauvegardes forgées** avant/après (tableau § 5) ;
  - **triche** : numéros de blocs qui sautent vers des blocs faibles, bloc courant omis, graine changée à chaque sauvegarde, PV du bloc courant falsifiés. Attendu : borné et journalisé à 0 point ;
  - réglage et performance.

## 5. Simulation avant / après (base isolée)

| Scénario | Avant (PV minimum) | Après (PV réels, `enforce`) |
|---|---|---|
| Sauvegardes forgées (3 m/s et 40 coups/s déclarés) : temps pour 1 003 m | 10,2 min | **37,6 min** |
| Forgées : profondeur retenue à 10 / 30 / 77 min | 993 / 1 725 / 2 768 m | **504 / 897 / 1 464 m** |
| Client modifié **jouant** à 40 coups/s × 25 dégâts : à 10 / 30 / 77 min | 809 / 1 415 / 2 230 m | **526 / 896 / 1 493 m** |
| Client modifié : numéros de blocs qui sautent (+500 par sauvegarde) | — | ≤ la suite normale, `block_seq_skips` |
| Client modifié : bloc courant omis après le début | ancienne borne | suite du serveur conservée |
| Joueurs honnêtes (tous les scénarios du § 4) | aucune perte | **aucune perte, aucun signal** |

**Ce que cela ne change pas pour l'incident #74.** L'essai était un autoclicker sur le vrai jeu, à environ 18 coups/s en moyenne et 1 003 m en 72 min. Ce rythme reste **sous** la nouvelle borne, qui suppose un joueur au maximum de tout : pioche 15, reliques max, 15 coups/s. Ce cas est traité par le limiteur de cadence du jeu livré dans #74 (× 0,30). #77 ferme l'autre voie, celle du **client modifié ou des requêtes forgées**.

## 6. Vérifications, limites et données des joueurs

**Vérifié**
- Copie de la base de production en lecture seule (supprimée ensuite). Pour les 2 sauvegardes qui ont une graine et un bloc courant, les PV max du bloc sont cohérents avec le recalcul : 0 incohérence.
- La production compte peu de joueurs : la comparaison sur données réelles reste donc limitée. Les journaux en `shadow` serviront de mesure.

**Limites**
- La borne suppose les bonus non vérifiables (pioche, reliques) **au maximum**. Un client modifié qui les déclare progresse donc encore au rythme d'un joueur au maximum de tout à 15 coups/s.
- Les **gains** (pièces, gemmes) restent calculés par le jeu : c'est le sujet de #49 (P0-3), qui demande l'arbitrage du propriétaire.
- Un client modifié peut changer sa graine 3 fois par saison. Chaque fois, l'ancienne borne s'applique pour la sauvegarde concernée, et c'est journalisé.
- Il peut aussi déclarer jusqu'à 99 rerolls par saison pour sauter des blocs. Chaque saut ne remplace qu'un bloc, au plus 32 par sauvegarde.
- Jeux ouverts avant le déploiement (version du catalogue non déclarée) : toutes les versions publiées sont évaluées. C'est un peu plus permissif jusqu'au rechargement.

**Données des joueurs**
- Aucune sauvegarde, aucun solde, aucun classement ni compte n'a été modifié.
- En `shadow`, la profondeur retenue est **strictement identique** à avant (vérifié par test).
- Nouvelles colonnes et nouveau réglage : ajouts seuls.

## 7. Déploiement

- **SHA déployé : `9fc4acb`** (production précédente : `faf25e1`), avance rapide de `main`, `scripts/deploy.sh` de la release.
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261105-140139-pre-deploy-9fc4acb.sqlite`.
- Copie de la base de production démarrée en mode production (port 3122) :
  - `/health` ok, `/api/version` = `1.0.0+9fc4acb` ;
  - migrations : 2 colonnes ajoutées ;
  - empreintes (nombre de lignes + hachage de toutes les colonnes) de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking` **identiques** avant et après le démarrage ;
  - copie supprimée.
- Avant le déploiement : aucune génération IA en cours.
- Après le déploiement :
  - https://dig.lodygames.com et https://dig.lodylands.com renvoient 200, version `1.0.0+9fc4acb` ;
  - `journalctl` sans erreur ;
  - `pragma quick_check` = ok ;
  - comptes, sauvegardes et classement identiques à la sauvegarde pré-déploiement ;
  - `exact_hp_mode = shadow`.
- Essai Chromium headless en 1280×900 et 390×844 (visiteur, rien d'enregistré) : aucune erreur JavaScript, la sauvegarde contient `blockCatalog`.
- **Retour arrière** :
  - sans redéploiement : Admin → Config → Protections → « Budget aux PV réels des blocs » = `off` ;
  - code : `git -C /home/ubuntu/Dig reset --keep faf25e1` puis `sudo systemctl restart dig` (lock npm inchangé). Les colonnes ajoutées sont ignorées par l'ancien code.

### Test fonctionnel à faire par le propriétaire (5 min)
1. Recharger le jeu (Ctrl+F5 sur PC, fermer et rouvrir l'onglet sur mobile), puis jouer **normalement** 2 à 3 minutes, connecté. **Attendu** : rien de changé, la profondeur et le classement progressent comme avant.
2. Admin (Ctrl+F5) → Config → Protections. **Attendu** : le réglage « Budget aux PV réels des blocs » vaut `shadow`. **Ne pas le passer en `enforce`** pour l'instant (§ 8).
3. Admin → 🛡 Anti-bot → fiche de votre compte. **Attendu** :
   - « Profondeur couverte aux PV réels (#77) » est égale à votre profondeur retenue, avec un écart de 0 m ;
   - la colonne « … / PV réels » des sauvegardes contrôlées est remplie.
4. Journal de sécurité → filtre « PV réels des blocs dépassés (0 point) ». **Attendu** : vide pour un joueur normal. Une ligne n'y apparaîtrait que pour un client modifié ou une sauvegarde forgée.

Classement : **Bloquant MVP public** (validation serveur de la progression ; l'observation suffit pour la bêta, le passage en `enforce` est à décider avant le partage public).

## 8. Choix techniques faits seul
- **`shadow` par défaut** (consigne du ticket) : aucune réponse stricte avant d'avoir des métriques d'observation sur de vrais joueurs.
- **Bonus non vérifiables au maximum** : pioche, reliques, cadence et catalogue sont pris au plus favorable pour le joueur. Aucun joueur honnête ne peut donc être freiné par une hypothèse fausse ; seule la nature du bloc (graine + n°) est vérifiée.
- **Graine épinglée par le serveur** : sans cela, un client modifié pourrait chercher hors ligne une graine à blocs faibles.
- **Une variante de catalogue par fenêtre**, la plus favorable : prendre le minimum bloc par bloc sur toutes les versions relâchait la borne d'environ 20 %.
- **Observations à 0 point** : le ticket interdit de modifier le score anti-bot. Ces événements sont donc journalisés, sans aucun point.
- **Ancien client** : ancienne borne, sans signal, pour ne bloquer personne arbitrairement.

## 9. Décisions demandées au propriétaire
1. **Passage en `enforce`** (rejet strict par les PV réels). Options :
   - a) après 7 jours de bêta sans `exact_hp_budget` sur un joueur légitime (**recommandé**) ;
   - b) tout de suite ;
   - c) rester en observation jusqu'au partage public.

   La bascule se fait dans Admin → Config, sans redéploiement, et elle est réversible.

## 10. Reste à réaliser
- Observer les journaux `exact_hp_budget` / `block_*` pendant la bêta, puis appliquer la décision 1.
- **Après lancement / #49 (P0-3)** : vérifier les gains de pièces et de gemmes côté serveur. Les bonus (pioche, reliques) deviendraient alors vérifiables et la borne #77 se resserrerait d'autant.
- Suggestion hors périmètre : ajouter au résumé Anti-bot un compteur « sauvegardes où PV réels < profondeur visée » sur 7 jours. Les événements sont déjà comptés par type dans le résumé existant.
