# Ticket #13 — T-06 : Sauvegardes SQLite et déploiement réversible

- **Ticket :** https://github.com/ReC82/Dig/issues/13
- **Date :** 2026-10-29
- **Branche :** `feature/13-sauvegardes-deploiement`, intégrée dans `develop`

## 1. État réel

**Intégré dans `develop`, en attente de validation et de déploiement.** Rien n'a été installé en production : ni timer, ni nouveau script dans `/home/ubuntu/Dig`. La sauvegarde quotidienne ne tournera donc qu'après l'installation décrite au §6.

## 2. Résultat et changements

| Fichier | Rôle |
|---|---|
| `scripts/backup-db.js` | Sauvegarde cohérente à chaud via l'API backup de SQLite, en lecture seule sur la base. Elle est vérifiée (`integrity_check`, compteurs par table), produit un manifeste JSON (sha256, taille, compteurs), applique une rétention de 14 jours (avec au moins 3 sauvegardes gardées) et propose un crochet optionnel de copie hors machine (`DIG_BACKUP_OFFSITE_CMD`). |
| `scripts/restore-db.js` | Restauration sur une copie (`--target`) ou sur la base du jeu (`--live`). Le mode `--live` est refusé si le service est actif. Le script vérifie le sha256 et l'intégrité, sauvegarde d'abord la base remplacée et fait un remplacement atomique. |
| `scripts/deploy.sh` | Remplace `~/update-dig.sh`. Il enchaîne verrou, contrôles, **sauvegarde obligatoire**, `merge --ff-only`, `npm ci` si le lock a changé, redémarrage, contrôle santé et version, puis **retour arrière automatique** du code en cas d'échec. Il accepte `--dry-run`. |
| `deploy/systemd/dig-backup.{service,timer}` | Sauvegarde quotidienne à 03:30, rattrapée au démarrage si la machine était éteinte (`Persistent=true`). |
| `test/backup-restore.test.js`, `test/deploy.test.js` | 8 tests automatisés (`npm test`). |
| `docs/OPERATIONS.md` | Procédures d'exploitation : sauvegarde, restauration, déploiement. |
| `package.json` | Scripts `test`, `backup`, `restore` et `deploy`. Aucune nouvelle dépendance. |

Le code du jeu n'est pas modifié.

## 3. SHA et procédure de test

- **Sur `develop` :** voir le commit de fusion indiqué dans le commentaire du ticket.
- **Test automatisé :** `npm ci && npm test`. Résultat attendu : `# pass 8`, `# fail 0`.
- **Test manuel sans risque :** `node scripts/backup-db.js`, puis `node scripts/restore-db.js <fichier> --target /tmp/x.sqlite`, puis `APP_DIR=/home/ubuntu/Dig bash scripts/deploy.sh --dry-run`.

## 4. Vérifications effectuées

| Vérification | Résultat |
|---|---|
| `npm test` (8 tests) | ✅ 8/8. Couvre : sauvegarde cohérente avec des écritures encore dans le WAL ; source inchangée ; droits 600 ; manifeste ; rétention (garde le minimum, ignore les fichiers hors convention) ; restauration sur copie avec sauvegarde `pre-restore` ; refus `--live` sans option, refus sur sauvegarde altérée, refus si le service est actif ; codes de sortie ; **bac à sable de déploiement** (rien à déployer, `--dry-run`, déploiement réussi avec sauvegarde pré-déploiement et version vérifiée, **version cassée → retour arrière automatique** au SHA précédent qui répond de nouveau, refus sur arbre modifié). |
| **Restauration réelle sur copie** | ✅ La base de production a été sauvegardée à chaud (11 tables / 29 lignes, intégrité ok), puis restaurée sur une copie. L'application, lancée sur cette copie (port 3102), répond sur `/health` et renvoie **exactement le même classement** que la production. La copie a ensuite été supprimée. |
| `deploy.sh --dry-run` sur `/home/ubuntu/Dig` | ✅ « déjà à jour (49faf2d) ». Avec `TARGET=origin/develop` : avance rapide possible, `npm ci` non nécessaire. Rien n'a été modifié. |
| Production pendant tous les tests | ✅ Service `dig` actif, même PID 553, compteurs inchangés, arbre Git propre sur `49faf2d`. |

**Bug corrigé pendant les tests :** le descripteur du verrou de déploiement était hérité par le processus relancé, et un serveur lancé en arrière-plan aurait pu le garder. Il est désormais fermé (`9>&-`) pour les commandes lancées par le script.

**Non vérifié :** le déploiement réel et le timer installé (hors périmètre sans validation), ainsi que la copie hors machine (aucune destination configurée).

**Impact sur les données des joueurs :** aucun. La base n'est que lue, aucune migration n'a été faite.

## 5. Choix techniques

- **Node et `better-sqlite3`** plutôt que le binaire `sqlite3` : la dépendance est déjà présente et les mêmes vérifications sont possibles en JavaScript.
- **Pas de restauration automatique de la base** en cas de déploiement raté : elle effacerait des parties jouées après la sauvegarde. Seul le code est remis en arrière, et la commande de restauration est affichée.
- **`COMMIT_HASH` n'est plus posé dans systemd** (contrairement à `update-dig.sh`) : la version vient de `git rev-parse`, toujours exacte après une avance rapide ou un retour arrière. Une valeur posée par `set-environment` risquerait d'être périmée.
- **Sauvegardes dans `~/backups/dig`**, hors du dossier servi et hors Git. Rétention de 14 jours, avec au moins 3 sauvegardes toujours gardées, pour ne jamais tout perdre après une longue absence de sauvegarde.
- **`npm test` limité à `test/*.test.js`** : la découverte automatique de Node exécutait aussi `server/seed-test.js`.

## 6. Procédure de déploiement proposée

1. Fusionner `develop` dans `main` (avance rapide).
2. Premier déploiement depuis un clone à jour (voir `docs/OPERATIONS.md` §« Premier déploiement ») : `--dry-run`, puis `APP_DIR=/home/ubuntu/Dig bash scripts/deploy.sh`. Ce script fait lui-même la première sauvegarde vérifiée.
3. Installer le timer : copier les fichiers `dig-backup.*`, `daemon-reload`, `enable --now dig-backup.timer`, puis `start dig-backup.service` et vérifier `journalctl -u dig-backup`.
4. Contrôler une restauration sur copie avec la dernière sauvegarde.
5. Retirer `~/update-dig.sh`, qui n'a ni sauvegarde ni retour arrière.

**Retour arrière :** ce ticket ne change pas le code du jeu. En cas de problème, `git reset --keep 49faf2d` suivi de `sudo systemctl restart dig`.

## 7. Décisions demandées au propriétaire

1. **Copie hors machine.** Il n'y a aujourd'hui ni AWS CLI ni identifiants sur la machine.
   - Options : (a) un bucket S3 dédié, accédé par un rôle IAM de l'instance avec une politique en écriture seule et une expiration à 30 jours ; (b) une copie vers une autre machine (`rsync`/`scp`) ; (c) rester en local pour l'instant.
   - **Recommandation :** (a). Il suffira de définir `DIG_BACKUP_OFFSITE_CMD` dans un drop-in systemd.
2. **Déploiement et installation du timer** selon le §6 : à valider.
3. **Ouverture du déploiement automatique.** Une fois le timer installé et une restauration contrôlée, confirmer dans ce ticket que « sauvegardes et restauration sont opérationnelles ». C'est la condition fixée pour autoriser un jour le déploiement automatique par DIGORCH (jamais pour un P0 sans confirmation explicite).

## 8. Reste à faire

- Copie hors machine (décision 1).
- Installation en production (décision 2).
- Les tests et la CI GitHub Actions sont prévus au ticket #17 (T-10), qui pourra reprendre `npm test`.
