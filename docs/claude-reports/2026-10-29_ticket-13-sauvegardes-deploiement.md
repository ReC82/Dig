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
- **Pas de restauration automatique de la base** en cas de déploiement raté : elle effacerait des parties jouées après la sauvegarde. Seul le code est remis en arrière, et la commande de restauration’est affichée.
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

---

## Installation contrôlée sur le serveur — 2026-10-29 22:25–22:30 (après validation technique)

**Périmètre :** sauvegarde et restauration uniquement. **Rien de develop n’est déployé** : `/home/ubuntu/Dig` reste sur `49faf2d` ; `deploy.sh` n’est pas installé.

### Composants installés

| Élément | Emplacement |
|---|---|
| Scripts (copie figée du commit `99fb195`, empreintes identiques à Git) | `/opt/dig-backup/backup-db.js` (`122ac9cc1af1`), `/opt/dig-backup/restore-db.js` (`f934a0e04efd`), `README.md` |
| Commande | `/usr/local/bin/dig-backup-tool backup | restore` |
| Service + timer | `dig-backup.service` (oneshot, utilisateur ubuntu, priorité basse) — `dig-backup.timer` actif, chaque jour 03:30 (+ ≤ 10 min), rattrapage au démarrage |
| Sauvegardes | `/home/ubuntu/backups/dig/` (700 ; fichiers 600), rétention 14 j, minimum 3 |

Les scripts sont installés hors de `/home/ubuntu/Dig` : des fichiers non suivis dans le dossier de production seraient un déploiement partiel et bloqueraient le futur `git merge --ff-only`. Ils utilisent le module SQLite de la production (`NODE_PATH`, better-sqlite3 9.6.0, version testée).

### Déroulé et preuves

1. **Prérequis :** Node v22.23.0, better-sqlite3 9.6.0, 21 Go libres, service `dig` actif (`49faf2d`), aucune installation antérieure, DIGORCH en pause.
2. **Sauvegarde de précaution** (outil indépendant, binaire `sqlite3 -readonly .backup`) : `~/backups/dig/precaution/dig-precaution-avant-installation-20261029-222553.sqlite`, `integrity_check = ok`, 1 compte / 1 sauvegarde de partie / 3 classements / 6 saisons, sha256 `0ce640de631e…`. Ce sous-dossier n’est jamais concerné par la rétention.
3. **Installation et activation** : `systemd-analyze verify` sans erreur sur les unités, timer activé. Prochain passage : 30/10 à 03:30:00.
4. **Sauvegarde réelle n° 1** (22:26) : OK, mais elle a révélé un **défaut** non couvert par les tests : fichiers `…sqlite.partial-wal` / `-shm` résiduels (la copie héritait du mode WAL de la source). **Corrigé** (`99fb195`, copie passée en journal DELETE avant vérification, même chose en restauration), test renforcé qui échoue sur l’ancien code et passe avec le correctif, 14/14 sur develop (`9c4ff9f`), scripts réinstallés, résidus supprimés.
5. **Sauvegarde réelle n° 2** (22:28, par le service systemd) : `dig-20261029-222840-daily.sqlite`, 11 tables / 29 lignes. Vérification indépendante : `integrity_check = ok` (binaire sqlite3), `journal_mode = delete`, sha256 du fichier identique au manifeste (`cf7d2e151964…`), aucun fichier annexe.
6. **Restauration sur copie isolée** (dossier temporaire 700, supprimé ensuite) : 11 tables, **compteurs identiques à la production pour chaque table**, classement de la saison 6 identique, **`.dump` complet identique à la sauvegarde** (empreinte `62ba137d4d03…`), `integrity_check = ok`.
7. **Garde-fou :** une restauration visant le chemin de la base du jeu est **refusée avant toute écriture** (« la cible est la base du jeu »). La base de production n’a jamais été restaurée ni modifiée : service actif, même PID 553, date de modification de la base inchangée.

### Commandes de contrôle

```bash
systemctl list-timers dig-backup.timer          # prochain passage
systemctl status dig-backup.service --no-pager  # dernier résultat
journalctl -u dig-backup -n 20                  # « [backup] OK … intégrité ok »
ls -lt ~/backups/dig | head
sudo systemctl start dig-backup.service         # sauvegarde immédiate
dig-backup-tool restore ~/backups/dig/<fichier>.sqlite --target /tmp/dig-restore-check.sqlite   # test sur copie
```

Désinstallation : `sudo systemctl disable --now dig-backup.timer`, puis retrait des deux unités, de `/opt/dig-backup` et de `/usr/local/bin/dig-backup-tool`. Les sauvegardes sont conservées.

### Décisions restantes

1. **Copie hors serveur :** non configurée (aucune AWS CLI ni aucun identifiant sur la machine). Recommandation : un bucket S3 dédié, avec un rôle IAM d’instance limité à `s3:PutObject` sur ce bucket, une expiration à 30 jours et le chiffrement SSE-S3. Ensuite, un drop-in `dig-backup.service.d/offsite.conf` avec `DIG_BACKUP_OFFSITE_CMD="aws s3 cp --only-show-errors"` complété de la destination. Aucun secret dans le dépôt.
2. **Vérification finale du propriétaire**, puis passage du ticket à « terminé ».
3. Plus tard, après validation du ticket #8 et des autres : déploiement de develop par `scripts/deploy.sh`. L unité pourra alors pointer vers `/home/ubuntu/Dig/scripts/backup-db.js`.

### Commits et isolation du déploiement

- **`main` = production = `49faf2d`**, inchangé. Aucun commit de `develop` n’est en production : `git log origin/main..origin/develop` liste 12 commits, dont ceux de #8 (`cb75ba3`, `84db536`, `9228f85`, `7a69583`), qui **restent non déployés**.
- **Commits de #13 :**
  - `0036466` : outils ;
  - `e7c1f39` : intégration ;
  - `99fb195`, puis `9c4ff9f` : correctif des fichiers -wal/-shm ;
  - `279b618` : timer à 03:30 précises (délai aléatoire retiré) ;
  - les commits de ce rapport.
- **Isolation garantie :** seuls deux fichiers JavaScript autonomes sont installés, hors du dossier de production, à partir de `git show 99fb195:scripts/…` (empreintes vérifiées). Ils sont accompagnés de deux unités systemd et d’une commande. Aucun `git pull` ni `merge`, aucun `npm`, aucun redémarrage de `dig` (PID 553 inchangé). L’arbre de `/home/ubuntu/Dig` reste propre sur `49faf2d`.
- **Timer :** prochain passage le 30/10 à 03:30:00.

### Contrôle final de la production (22:30)

- `https://dig.lodygames.com` et `https://dig.lodylands.com` répondent 200, `/health` ok, version `1.0.0+49faf2d`.
- `quick_check` de la base de production : ok.
- Compte, sauvegarde de partie (même taille), classements et saisons **identiques à la sauvegarde de précaution**.

### Rollback de l’installation (sans effet sur le jeu ni sur la base)

```bash
sudo systemctl disable --now dig-backup.timer
sudo rm /etc/systemd/system/dig-backup.service /etc/systemd/system/dig-backup.timer
sudo rm -r /opt/dig-backup
sudo rm /usr/local/bin/dig-backup-tool
sudo systemctl daemon-reload
# Les sauvegardes de ~/backups/dig sont conservées (à supprimer à la main seulement si voulu).
```

### Étude : copie hors machine sur S3 (aucune ressource créée)

**Constat :** instance en `us-east-1`, **sans rôle IAM attaché** (`iam/security-credentials` → 404), sans AWS CLI, sans identifiants AWS. Aucune ressource AWS n’a été créée.

**Volume et coût estimés :** environ 115 Ko par sauvegarde, plus le manifeste, une fois par jour. Sur 30 jours de rétention, cela fait environ 4 Mo stockés et environ 60 requêtes PUT par mois. Au tarif public de S3 Standard (environ 0,023 USD par Go-mois et 0,005 USD pour 1 000 PUT, à vérifier), on reste **sous 0,01 USD par mois**.

**Configuration recommandée (à valider avant toute création) :**
1. **Bucket privé dédié** (par exemple `dig-backups-<compte>`) en `us-east-1`, avec :
   - blocage total de l’accès public ;
   - chiffrement SSE-S3 ;
   - versioning activé ;
   - règle de cycle de vie : expiration à 30 jours, versions non courantes supprimées après 7 jours.
2. **Rôle IAM `dig-backup-writer`**, rattaché à l’instance par un profil d’instance. Sa politique n’autorise que `s3:PutObject` sur `arn:aws:s3:::dig-backups-<compte>/dig/*` : pas de lecture, pas de suppression, pas de listage. Une compromission du serveur ne pourrait donc ni lire ni effacer les copies hors machine. Les identifiants sont temporaires et fournis par l’instance : **aucune clé n’est stockée sur le serveur**.
3. **AWS CLI v2**, puis le drop-in `/etc/systemd/system/dig-backup.service.d/offsite.conf` (le script passe le chemin de la sauvegarde puis celui du manifeste) :
   ```ini
   [Service]
   Environment="DIG_BACKUP_OFFSITE_CMD=/usr/local/bin/dig-backup-offsite"
   ```
   Le petit script `dig-backup-offsite` lance `aws s3 cp --only-show-errors "$1" s3://dig-backups-<compte>/dig/`, puis la même commande pour `"$2"`. Si la copie échoue, le service sort en erreur, ce qui est visible dans `systemctl status dig-backup`. La sauvegarde locale est conservée dans tous les cas.
4. **Test :** lancer `sudo systemctl start dig-backup.service`, vérifier « hors machine : ok » dans le journal, puis contrôler la présence de l’objet dans la console S3.

Alternatives :
- **Copie vers une autre machine** (`rsync` vers un compte restreint) : pas d’AWS, mais une clé SSH à stocker sur le serveur.
- **Rester en local :** le risque de perte avec la machine ou le disque est alors non couvert.

**Décisions demandées :**
1. Valider ou non la création du bucket et du rôle (coût inférieur à 0,01 USD par mois). Qui les crée : vous dans la console AWS, ou moi avec des identifiants d’administration temporaires ?
2. Durée de rétention hors machine : 30 jours recommandés.
