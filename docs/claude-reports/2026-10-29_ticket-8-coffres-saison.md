# Ticket #8 — T-01 : Corriger l'achat des coffres de saison

- **Ticket :** https://github.com/ReC82/Dig/issues/8
- **Date :** 2026-10-29
- **Branche :** `fix/8-coffres-saison`, intégrée dans `develop`

## 1. État réel

**Intégré dans `develop`, en attente de validation et de déploiement.** Rien n'a été installé en production : `main`, `/home/ubuntu/Dig` et `dig.service` n'ont pas été touchés.

## 2. Résultat et changements

**Cause (bug B1 de l'audit).** La route `POST /api/me/shop/chest/open` appelait `logEvent(userId, 'chest_shop_open')`. Or `logEvent` écrit dans `save_events`, une table de l'ancienne API anonyme. Cette table a une clé étrangère vers `players` (et non `users`) et un `CHECK(event_type IN ('save','load','reset'))`. L'insertion échouait donc toujours (`SQLITE_CONSTRAINT`), mais **après** l'écriture de la sauvegarde. Résultat : le serveur avait débité le joueur et crédité la récompense, mais il renvoyait une erreur 500. Le client affichait alors une erreur, et sa sauvegarde suivante écrasait l'achat. Le reset saisonnier admin (`POST /api/admin/players/:id/season-reset`) avait exactement le même défaut.

| Fichier | Changement |
|---|---|
| `server/db.js` | Nouvelle table **`user_events`** (`user_id` → `users`, `event_type` libre, `metadata` JSON, index par utilisateur). Elle est créée par `CREATE TABLE IF NOT EXISTS` : ajout pur et idempotent. Ajout de `logUserEvent()` et de `runTransaction()`. `DB_FILE` accepte aussi un chemin absolu (utile aux tests) ; un nom relatif garde exactement le comportement d'avant. |
| `server/index.js` | Dans la route des coffres, la lecture de la sauvegarde, le tirage, le débit/crédit et la journalisation s'exécutent dans **une seule transaction**. Si l'une de ces étapes échoue, rien n'est écrit. Le reset saisonnier admin utilise désormais `logUserEvent`, lui aussi en transaction. |
| `test/chest-shop.test.js` | 6 tests HTTP de bout en bout (serveur réel, port 3108, base temporaire dans `/tmp`). |

**Ce que voit le joueur :** les coffres simple, rare et antique s'ouvrent normalement une fois connecté. Le solde affiché correspond à celui du serveur, et un solde insuffisant ou une limite atteinte donne un message clair (400) sans aucun débit. Le client (`public/js/main.js`) n'a pas été modifié : il gérait déjà correctement la réponse de succès.

## 3. SHA et procédure de test

- **Commit du correctif :** `cb75ba3` (branche `fix/8-coffres-saison`)
- **Fusion dans `develop` :** `84db536` (le commit du rapport est fusionné ensuite)
- **Test automatisé :** `npm ci && npm test`. Résultat attendu : `# pass 14`, `# fail 0` (6 nouveaux tests + 8 du ticket #13).
- **Test ciblé :** `node --test test/chest-shop.test.js`. Il couvre :
  1. les 3 coffres avec un solde suffisant : 200, `newCoins = solde − coût + gain`, version de la sauvegarde +1, compteur `shopChestsBought` à jour, 3 lignes `chest_shop_open` dans `user_events` ;
  2. un solde insuffisant (1 999) pour chacun des 3 coffres : 400 « Coins insuffisants. », sauvegarde identique, aucun événement ;
  3. la limite saisonnière du coffre antique (5/5) : 400, rien n'est débité ;
  4. non connecté → 401 ; coffre inconnu → 400 ; pas de sauvegarde → 404 ;
  5. **atomicité** : un trigger SQLite fait échouer la journalisation. Le serveur répond 500 et la sauvegarde reste **inchangée**. Une fois le trigger retiré, l'achat repasse ;
  6. le reset saisonnier admin répond 200 et est journalisé.
- **Test manuel (après déploiement) :** se connecter, avoir au moins 2 000 pièces, puis acheter un coffre simple dans la boutique de saison. Attendu : la fenêtre de récompense s'affiche, sans toast « ❌ ». Après rechargement de la page, le solde et le compteur d'achats sont conservés.

## 4. Vérifications effectuées

| Vérification | Résultat |
|---|---|
| Tests du ticket avec le correctif | ✅ 6/6 |
| Mêmes tests sur l'ancien `server/index.js` | ❌ 3 échecs (achat, atomicité, reset admin) : le bug est bien reproduit |
| `npm test` complet sur la branche | ✅ 14/14 |
| `node --check` + tests du ticket sur `develop` après fusion | ✅ 6/6 |
| Migration sur une **copie** de la base de production (`.backup` en lecture seule, puis `initDb()` lancé deux fois) | ✅ seule différence : la table `user_events` apparaît. Mêmes nombres de comptes, sauvegardes, classements et saisons, même taille des sauvegardes, `integrity_check` ok, `foreign_key_check` vide. Copie supprimée ensuite. |

**Non vérifié :** test dans un navigateur réel (il n'existe pas d'environnement de recette). Il est à faire par le propriétaire après déploiement (scénario du §3).

**Impact sur les données des joueurs :** une table vide est ajoutée au démarrage. Aucune donnée existante n'est modifiée, et `save_events` reste en place (toujours utilisée par l'API anonyme).

## 5. Limites

- Le serveur vérifie le solde de la **sauvegarde cloud**. Aujourd'hui, le client sauvegarde à chaque clic, donc ce solde est à jour. Quand T-03 (#10) espacera les sauvegardes, le client devra **envoyer sa sauvegarde juste avant l'achat**. Sinon, le serveur raisonnera sur un solde ancien et le `newCoins` renvoyé ferait perdre au joueur ses gains récents. Ce point est à traiter dans T-03.
- Les coûts de coffre modifiés dans l'admin ne s'affichent toujours pas côté client (risque P2 de l'audit, ticket T-13).
- Le bonus Shard Magnet reste ignoré par le serveur (B8, hors périmètre).
- Le test lance `server/index.js` depuis le dépôt : `express-session` écrit donc ses fichiers de session de test dans `server/data/sessions/` de la copie de travail. Il ne faut pas lancer `npm test` dans `/home/ubuntu/Dig`.

## 6. Procédure de déploiement proposée

1. **Sauvegarde** : `cd /home/ubuntu/Dig && node scripts/backup-db.js` une fois T-06 déployé ; sinon `sqlite3 server/data/dig.sqlite ".backup /home/ubuntu/backups/dig-avant-t01.sqlite"`.
2. Fusionner `develop` (ou seulement `fix/8-coffres-saison`) dans `main`, puis, dans `/home/ubuntu/Dig` : `git pull` (pas de nouvelle dépendance, `npm ci` inutile) et `sudo systemctl restart dig`.
3. **Vérifications** : `journalctl -u dig -n 20` (attendu : « Base prête », aucune erreur) ; `sqlite3 server/data/dig.sqlite ".tables"` doit lister `user_events` ; puis le scénario manuel du §3.
4. **Retour arrière** : revenir au commit précédent (`git checkout 49faf2d -- server/` ou `git revert` de la fusion) et redémarrer. La table `user_events` peut rester : elle est ignorée par l'ancien code. La restauration de la base n'est pas nécessaire.

## 7. Choix techniques faits seul

- **Nouvelle table `user_events` plutôt que modifier `save_events`.** SQLite ne permet pas de modifier un `CHECK` ni une clé étrangère sans recréer la table, ce qui serait une migration destructive. L'ajout d'une table est rétrocompatible et sépare proprement les comptes (`users`) de l'ancienne API anonyme (`players`).
- **Journal dans la transaction, pas en « best effort ».** Le ticket demande une transaction atomique débit/crédit/journalisation. Si le journal échoue, l'achat est annulé et le joueur reçoit une erreur, sans aucun débit.
- **`DB_FILE` absolu accepté**, pour que les tests ne créent jamais de fichier dans `server/data/`.

## 8. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire.

## 9. Éléments restant à réaliser

- Validation par le propriétaire, puis déploiement (§6).
- Dans T-03 (#10) : sauvegarde cloud forcée avant l'achat d'un coffre (voir §5).

---

## Mise à jour du 30/10/2026 — preuves automatisées des cas limites après la recette

**Ticket :** #8 — [P0] T-01 — Corriger l'achat des coffres de saison — https://github.com/ReC82/Dig/issues/8

**État réel :** correctif **déployé en production** depuis `18e3881`. La version servie aujourd'hui est `1.0.0+232c0b9`, qui le contient. Recette du propriétaire **réussie** le 30/10 sur téléphone : achat d'un coffre simple, récompense reçue, solde correct après rechargement. Cette mise à jour n'ajoute qu'un test : pas de nouveau déploiement, car le code servi est inchangé.

**Ce que le propriétaire a demandé :** couvrir par des tests automatisés les cas qu'il ne peut pas vérifier sans dépenser beaucoup de pièces. Si ces tests existent, #8 peut être clôturé sans le solliciter à nouveau.

| Cas demandé | Preuve automatisée (sur `develop`) |
|---|---|
| Solde insuffisant (3 coffres) | `test/chest-shop.test.js` « solde insuffisant » : réponse 400, sauvegarde et journal inchangés |
| Coffres rare et antique (débit, crédit, récompense) | `test/chest-shop.test.js` « les 3 coffres… » : coût exact, gain, compteur saisonnier, révision, journal ; limite 5/5 du coffre antique |
| **Double débit** (double clic, requêtes simultanées) | **Nouveau** test `test/chest-shop.test.js` « double clic / requêtes simultanées » : 5 achats envoyés en parallèle avec un solde pour un seul coffre → 1 réussite, 4 refus (400), débit unique, révision +1, une seule ligne de journal |
| Pas de 500 / atomicité | `test/chest-shop.test.js` « atomicité » et « requêtes invalides » (401/400/404) |
| Concurrence avec la sauvegarde cloud espacée (#10/#18) | `test/save-revision.test.js` « coffre : la réponse donne la nouvelle révision » : une sauvegarde partie avant l'achat est refusée (409) et ne réécrit pas le débit. Côté client (`public/js/main.js`, `openShopChest`), l'état local est envoyé au serveur **avant** l'achat ; si le serveur avait une sauvegarde plus récente, l'achat est annulé. |
| Coût configurable (#20) | `test/economy.test.js` : achat au coût réglé par l'admin |

**Changement :** `test/chest-shop.test.js` contient un test de plus. Le code de production n'est pas modifié.

**Tests :** `npm test` complet passe **130/130** sur la branche (base `develop` b83c163 + ce test).

**Choix technique :** pas de verrou supplémentaire. La route fait lecture, contrôle, débit et journalisation dans une transaction `better-sqlite3` synchrone : deux requêtes ne peuvent pas s'entrelacer dans le même processus Node. Le nouveau test protège cette garantie contre une future réécriture asynchrone.

**Classement :** Bloquant MVP public, désormais levé côté technique.

**Test fonctionnel restant :** aucun. Le propriétaire a demandé de ne pas lui faire dépenser 15 000 ou 80 000 pièces. L'équilibrage des récompenses (2 000 pièces pour 90 gagnées) est suivi dans #20.

**Décisions demandées au propriétaire :** aucune, à part clôturer #8 s'il est d'accord. La session automatique ne ferme pas les tickets.

**Reste à faire :** rien dans le périmètre de #8.
