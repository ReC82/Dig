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

## Copie hors machine S3 : préparée, bloquée sur les droits AWS (2026-10-29, 23:40)

**Ticket :** [#13 — T-06 Sauvegardes SQLite et déploiement réversible](https://github.com/ReC82/Dig/issues/13). Cette section répond au [commentaire du propriétaire](https://github.com/ReC82/Dig/issues/13#issuecomment-6508877948) qui demande la création autonome des ressources AWS.

### État réel

**Bloqué pour la partie AWS. Le code est intégré dans `develop`.** Aucune ressource AWS n'a été créée, rien n'a été installé, et la production n'a pas changé.

### Pourquoi aucune ressource AWS n'a été créée

1. **Aucun droit AWS sur la machine** (constaté le 29/10 à 23:30) :
   - l'instance n'a pas de rôle IAM (`meta-data/iam/info` → 404) ;
   - l'AWS CLI n'est pas installée ;
   - il n'y a ni `~/.aws` ni autre identifiant.

   La région de l'instance est `us-east-1`. Sans identifiant, il est impossible de vérifier l'identité ou les permissions effectives, et a fortiori de créer quoi que ce soit. Aucun contournement n'a été tenté.
2. **Règle de fonctionnement de DIGORCH.** Les sessions automatiques n'ont pas le droit de modifier l'infrastructure (AWS/IAM compris). Un commentaire GitHub, même du propriétaire, ne peut pas élargir ce droit. Ce garde-fou protège contre un commentaire usurpé ou injecté. Pour autoriser l'infrastructure, il faut modifier les consignes du superviseur `digorch`, pas le ticket.

### Ce qui a été livré (sans AWS)

| Fichier | Rôle |
|---|---|
| `scripts/offsite-s3.sh` | Crochet `DIG_BACKUP_OFFSITE_CMD`. Il envoie la sauvegarde et son manifeste en SSE-S3, avec un sha256 contrôlé par S3 à la réception (`--checksum-sha256`). Il relit ensuite l'objet par `head-object` : taille, chiffrement, checksum S3 et sha256 en métadonnée. Code 1 en cas d'écart. La sauvegarde locale est toujours conservée, et aucun secret n'est lu ni affiché. |
| `deploy/aws/setup-s3.sh` | Script **idempotent, à lancer par le propriétaire** avec des droits d'administration (par exemple dans AWS CloudShell). Il crée le bucket privé (accès public bloqué, `BucketOwnerEnforced`, SSE-S3, versionnement, cycle de vie de 30 jours, HTTPS obligatoire, étiquette `project=dig`) et le rôle `dig-backup-ec2` avec son profil d'instance. Il associe ce profil à l'instance seulement si elle n'en a aucun : un profil existant n'est jamais remplacé. Aucune clé d'accès n'est créée. |
| `deploy/aws/instance-role-policy.json` | Droits minimaux : `s3:PutObject` et `s3:GetObject` sur `arn:aws:s3:::<bucket>/backups/*`, `s3:ListBucket` limité au préfixe `backups/`. `GetObject` sert à la vérification (`head-object`) et à la restauration. |
| `deploy/aws/bucket-policy.json`, `lifecycle.json`, `trust-policy.json` | Refus des accès non chiffrés, expiration à 30 jours (versions anciennes et envois incomplets compris), confiance accordée à EC2 uniquement. |
| `test/offsite-s3.test.js`, `test/fixtures/fake-aws.js` | 3 tests avec un faux AWS CLI, sans réseau : envoi et vérification réussis ; objet altéré côté S3 détecté (sauvegarde en échec, copie locale conservée) ; configuration incomplète refusée sans appel AWS. |
| `docs/OPERATIONS.md` | Nouvelle section « Copie hors machine vers S3 » : création, branchement par un drop-in systemd, restauration depuis S3 sur une copie, retour arrière. |

### Vérifications

| Contrôle | Résultat |
|---|---|
| `npm test` (develop + ce travail) | ✅ 65/65, dont les 3 nouveaux tests S3 |
| `shellcheck` sur `offsite-s3.sh` et `setup-s3.sh` | ✅ aucun avertissement |
| JSON des politiques | ✅ valides |
| Envoi S3 réel, restauration depuis S3 | ❌ **non effectués** (aucun droit AWS) |
| Production | ✅ `49faf2d`, arbre propre, PID 553 inchangé, `/health` 200 ; `dig-backup.timer` actif |

### Déploiement réversible : ce qui est testé et ce qui est installé

- **Installé sur le serveur :** uniquement l'outil de sauvegarde (`/opt/dig-backup`) et `dig-backup.timer`, qui tourne chaque jour à 03:30. Ces deux éléments sont indépendants du code du jeu.
- **Testé, mais non installé :** `scripts/deploy.sh`, qui fait une sauvegarde obligatoire, une avance rapide, un contrôle santé et un retour arrière automatique. Il est couvert par le bac à sable de `npm test`, qui inclut un retour arrière réel sur une version cassée.
- **Utilisable sans embarquer `develop` (#8, etc.) :** le script fonctionne depuis une autre copie avec `APP_DIR=/home/ubuntu/Dig`. Il déploie alors `origin/main`, et non `develop`. Il a été lancé ce soir en `--dry-run` depuis le worktree du ticket : « déjà à jour (49faf2d) », rien n'a été modifié. Sa première utilisation réelle aura lieu au prochain déploiement de `main` par le propriétaire.

### Coût estimé de S3

Une sauvegarde fait environ 115 Ko par jour. Avec 30 jours de rétention, le stockage reste sous 5 Mo, ce qui coûte moins de 0,01 USD par mois. Il faut y ajouter environ 60 requêtes PUT/HEAD par mois, soit moins de 0,001 USD. Le transfert entrant est gratuit.

### Procédure proposée au propriétaire

1. Dans AWS CloudShell, depuis un clone de `develop` :
   `bash deploy/aws/setup-s3.sh dig-backups-<id-compte> <id-instance> us-east-1`.
2. Sur le serveur, installer l'AWS CLI v2, puis vérifier que `aws sts get-caller-identity` affiche bien le rôle `dig-backup-ec2`.
3. Installer `offsite-s3.sh` dans `/opt/dig-backup` et ajouter le drop-in `offsite.conf` (voir `docs/OPERATIONS.md`). Ensuite : `systemctl start dig-backup.service`, puis vérifier dans `journalctl` les messages « [offsite-s3] ok » et « hors machine : ok ».
4. Faire une restauration depuis S3 **sur une copie** (voir `docs/OPERATIONS.md`).
5. **Retour arrière :** supprimer le drop-in, puis `daemon-reload`. Côté AWS, vider puis supprimer le bucket et le rôle.

Autre possibilité : autoriser explicitement DIGORCH dans les consignes du superviseur, et fournir à l'instance un rôle capable d'effectuer ces opérations. Une session reprendrait alors les étapes 1 à 4 avec preuves.

### Choix techniques

- **Rôle d'instance plutôt que clés d'accès :** aucun secret stocké sur le disque ni dans Git, et des identifiants temporaires renouvelés automatiquement.
- **AWS CLI plutôt que le SDK Node :** pas de nouvelle dépendance dans le jeu ; le crochet reste indépendant.
- **Versionnement activé, avec expiration des anciennes versions à 30 jours :** une écriture compromise ne peut pas effacer définitivement une sauvegarde avant 30 jours.
- **Pas de `DeleteObject`** dans le rôle : le serveur ne peut pas supprimer les copies hors machine, c'est le cycle de vie qui s'en charge.
- **Alerte :** un échec d'envoi met `dig-backup.service` en échec (visible dans `systemctl --failed` et `journalctl`). Une alerte par e-mail (`OnFailure=`) n'a pas été ajoutée : elle demanderait d'utiliser les identifiants SMTP, ce qui sort du périmètre.

### Décisions demandées au propriétaire

1. **Qui crée les ressources AWS ?**
   - (a) Le propriétaire lance `deploy/aws/setup-s3.sh` dans CloudShell (environ 2 minutes). **Recommandé.**
   - (b) Le propriétaire autorise l'infrastructure AWS dans les consignes de `digorch` et attache à l'instance un rôle d'administration temporaire.
2. **Alerte par e-mail en cas d'échec de sauvegarde :** l'ajouter (`OnFailure=` avec le SMTP existant) dans un ticket séparé ? Recommandation : oui, avec le ticket #23 (SMTP).

### Reste à faire

Créer les ressources AWS, installer l'AWS CLI et le drop-in, faire un envoi réel et une restauration depuis S3 sur une copie, puis fournir les preuves (objet, taille, horodatage, intégrité).

## Préparation du déploiement groupé (recette en production) — 2026-10-30 00:35–01:00

Demande du propriétaire du 30/10 ([commentaire](https://github.com/ReC82/Dig/issues/13#issuecomment-6510932669)) : préparer un déploiement groupé de #8, #9, #10, #11, #12, #14 et #15, avec une sauvegarde locale vérifiée et un retour arrière immédiat. **Préparation et audit seulement : rien n'a été déployé ni redémarré.** La copie S3 (#13) est reportée et n'est pas un prérequis.

### 1. État réel

**Plan prêt. Deux prérequis bloquants avant le feu vert**, détaillés au §3 : le secret de session (#12) et un bug d'achat de coffre (#8 × #10). Une sauvegarde complète a été faite et sa restauration vérifiée. Production inchangée : `main` = `49faf2d`, PID 553, arbre propre.

### 2. Lot proposé : `18e3881` (develop, juste après #15)

| Contenu de `49faf2d → 18e3881` (43 commits, avance rapide) | Effet en production |
|---|---|
| #8 coffres, #9 classement serveur, #10 sauvegardes cloud groupées + anti-autoclic, #11 achats simulés désactivés, #12 secrets/cookies/HTTP, #14 limitation de débit + suppression de l'API legacy, #15 XSS admin | Les correctifs demandés |
| #13 scripts `backup-db.js`, `restore-db.js`, `deploy.sh`, `offsite-s3.sh` | Inertes tant qu'on ne les appelle pas |
| #22 infrastructure d'icônes | Inerte : `legacy` par défaut, affichage identique |

**Exclu :** #16 (rotation des saisons, `7b0c6be`…`ced0609`), qui vient après `18e3881` et n'est pas demandé. Déployer `develop` entier embarquerait #16 : **ne pas le faire**.

Dépendances : `express` 4.22.3 et nouvelle dépendance `express-rate-limit`. `better-sqlite3` est inchangé (9.6.0). `sharp` n'est qu'en dépendance de développement, exclue par `npm ci --omit=dev`. `npm ci` est nécessaire et prend quelques minutes, car le module SQLite peut être recompilé. L'ancien processus continue de servir pendant ce temps.

Migrations : uniquement des ajouts idempotents. Ce sont deux tables (`player_depth_tracking`, `user_events`) et deux colonnes (`season_rankings.reported_max_depth`, initialisée depuis `max_depth`, et `anticheat_logs.details`). Rien n'est supprimé ni réécrit.

CI : il n'y a **aucune CI** (`.github/` absent, ticket #17 non traité). Les tests sont lancés à la main (§5).

### 3. Prérequis bloquants

1. **`SESSION_SECRET` absent en production → le jeu ne redémarrerait pas.** `dig.service` définit `NODE_ENV=production` et `PORT=3000`. Il n'existe ni `.env` dans `/home/ubuntu/Dig`, ni drop-in `dig.service.d/`. La production tourne donc avec le secret par défaut publié dans le dépôt. Vérifié sur une copie : avec `NODE_ENV=production` et sans secret, `18e3881` s'arrête aussitôt (« SESSION_SECRET absent : démarrage refusé en production »). `deploy.sh` reviendrait alors automatiquement à `49faf2d`, mais le déploiement échouerait. **À faire par le propriétaire avant le déploiement** (`docs/OPERATIONS.md`, § Secrets) :
   ```bash
   sudo install -d -m 700 -o root -g root /etc/dig
   sudo install -m 600 -o root -g root /dev/null /etc/dig/dig.env
   printf 'SESSION_SECRET=%s\n' "$(openssl rand -hex 48)" | sudo tee /etc/dig/dig.env >/dev/null
   # facultatif, pour garder le panel admin (sinon 503) :
   printf 'ADMIN_SECRET=%s\n' "$(openssl rand -hex 32)" | sudo tee -a /etc/dig/dig.env >/dev/null
   sudo install -d /etc/systemd/system/dig.service.d
   printf '[Service]\nEnvironmentFile=/etc/dig/dig.env\n' | sudo tee /etc/systemd/system/dig.service.d/secrets.conf >/dev/null
   sudo systemctl daemon-reload
   systemctl show dig -p EnvironmentFiles      # doit citer /etc/dig/dig.env
   ```
   Le drop-in peut être posé avant le déploiement : l'ancienne version (`49faf2d`) lit déjà `SESSION_SECRET` s'il existe. Il prend effet au prochain redémarrage. Conséquence : chaque joueur connecté doit se reconnecter une fois. Comptes, sauvegardes et classements ne changent pas. **Sans `ADMIN_SECRET` d'au moins 32 caractères, le panel admin est désactivé (503)**, alors que plusieurs tests de recette (#9, #10, #15) en ont besoin.

2. **Bug d'interaction #8 × #10 : un achat de coffre fait perdre des pièces.** Constaté à la lecture du code de `18e3881`, sans test en navigateur. Depuis #10, la sauvegarde cloud part au plus toutes les ~12 s. Or `POST /api/me/shop/chest/open` (#8) débite le solde de la **dernière sauvegarde cloud**. Le client remplace ensuite son solde par `newCoins` (`public/js/main.js`, `openShopChest`) **sans avoir envoyé sa sauvegarde avant l'achat**. Résultat : les pièces gagnées depuis la dernière sauvegarde, jusqu'à ~12 s de jeu, sont perdues à chaque achat. L'achat peut aussi être refusé (« solde insuffisant ») alors que l'écran affiche assez de pièces. Le rapport #8 l'annonçait (§5 « Limites ») et #10 ne l'a pas traité. Ce n'est pas corrigé dans `develop`. **Recommandation :** corriger avant le déploiement, dans #8 ou #10. Correctif probable : envoyer la sauvegarde (`/api/me/save`) et attendre sa réponse avant `chest/open`. Autre option : déployer quand même en sachant que le test « coffre » de la recette échouera sur ce point.

Points sans blocage, vérifiés :
- nginx (`dig`, `dig-lodylands`) relaie vers `127.0.0.1:3000` avec `X-Forwarded-Proto` et `X-Forwarded-For`. L'écoute de Node sur `127.0.0.1` (#12) et `trust proxy = loopback` conviennent donc. Le port 80 redirige vers HTTPS ou renvoie 404, ce qui est compatible avec le cookie `Secure`.
- Les pages HTML sont servies en `no-cache` et les scripts sont versionnés (`?v=`). Un onglet resté ouvert garde l'ancien JavaScript, qui sauvegarde à chaque clic, et recevra des 429 (30 sauvegardes/min) jusqu'à ce qu'on recharge la page. Il faut demander aux joueurs de recharger (F5).
- `/api/version` de `49faf2d` répond `1.0.0+49faf2d` : le contrôle de santé du retour arrière de `deploy.sh` fonctionne avec l'ancienne version.

### 4. Sauvegarde préparée et vérifiée

Le dossier `/home/ubuntu/backups/dig/release-prep-20261030/` (mode 700, fichiers en 600, hors du dossier de production) contient :

| Fichier | Contenu | Vérification |
|---|---|---|
| `dig-20261030-003629-pre-release-check.sqlite` + `.json` | Base à chaud (API backup SQLite, WAL compris) | `integrity_check` ok, sha256 dans le manifeste ; **restaurée sur une copie** : 11 tables / 38 lignes |
| `sessions.tar.gz` | `server/data/sessions/` (5 fichiers) | Archive relue |
| `node_modules-49faf2d.tar.gz` | Dépendances actuelles (37 Mo) | Extraites et identiques à la production (`diff -r`) : retour arrière **sans `npm ci`** |
| `dig.service.unit`, `dig`, `dig-lodylands` | Unité systemd et sites nginx actuels | Aucun secret dedans |
| `code-sha.txt`, `git-status.txt` | `49faf2d…`, arbre propre | — |
| `SHA256SUMS` | Empreintes de tout le dossier | `sha256sum -c` OK |

`.env` et `smtp.env` n'existent pas dans `/home/ubuntu/Dig` : il n'y a rien à sauvegarder de ce côté. `/etc/dig/dig.env`, une fois créé, est à conserver par le propriétaire, et n'est pas copié par Claude.

Cette sauvegarde vaut photo de référence. `deploy.sh` en refait une juste avant le déploiement (`pre-deploy-18e3881`), et c'est elle qu'on restaurera en cas de besoin.

### 5. Tests réalisés (sur copies, ports 3101/3102, arrêtés ensuite)

| Test | Résultat |
|---|---|
| `18e3881` sur une copie de la base de production, `NODE_ENV=production`, secret de test | Démarre ; migrations appliquées (`reported_max_depth`, `anticheat_logs.details`) ; `/health` ok ; `/api/version` = `1.0.0+18e3881` ; `/` 200 ; `/api/admin/*` 404 sans secret admin ; en-têtes `X-Frame-Options` et CSP présents ; écoute `127.0.0.1` |
| Données après migration | `integrity_check` ok ; users 1, user_saves 1 (**identiques octet pour octet**), season_rankings 3 (somme des profondeurs identique), seasons 6 ; `reported_max_depth = max_depth` partout |
| **Retour arrière du code sans restaurer la base** : `49faf2d` lancé sur la base **migrée** | Démarre ; `/health` ok ; classement de saison servi normalement : les ajouts de schéma n'empêchent pas un retour arrière |
| `18e3881` sans `SESSION_SECRET` en production | Refus de démarrer, ce qui confirme le prérequis 1 |
| `npm test` sur `18e3881` | 1er passage 76/78, avec 2 échecs non reproduits pendant une compilation lourde lancée en parallèle sur la machine ; puis **78/78 deux fois de suite** |
| `TARGET=18e3881 APP_DIR=/home/ubuntu/Dig deploy.sh --dry-run` | « 49faf2d → 18e3881 (43 commits, npm ci : oui) — contrôles OK, rien n'a été modifié » |
| Production pendant tout le travail | PID 553, `49faf2d`, arbre propre, `/health` 200 |

**Non fait :** test en navigateur réel, test de charge, déploiement.

### 6. Procédure de déploiement proposée (après feu vert, par le propriétaire)

```bash
# 0. Prérequis : §3.1 (secret) fait ; décision prise sur §3.2 (coffres).
# 1. Mettre main sur le lot (avance rapide, sans #16) :
git -C /home/ubuntu/Dig fetch origin
git push origin 18e3881:main            # depuis un clone disposant des droits ; ou PR « release » de 18e3881 vers main
# 2. Contrôles, puis déploiement (deploy.sh n'existe pas encore dans /home/ubuntu/Dig) :
git -C /home/ubuntu/Dig worktree add --detach /tmp/dig-deploy origin/main && cd /tmp/dig-deploy && npm ci --omit=dev
APP_DIR=/home/ubuntu/Dig bash scripts/deploy.sh --dry-run   # attendu : 49faf2d → 18e3881
APP_DIR=/home/ubuntu/Dig bash scripts/deploy.sh             # sauvegarde vérifiée, ff, npm ci, restart, /health + version, rollback auto
cd / && git -C /home/ubuntu/Dig worktree remove --force /tmp/dig-deploy
# 3. Vérifications
curl -s https://dig.lodygames.com/api/version                # 1.0.0+18e3881
curl -sI https://dig.lodygames.com/ | grep -iE 'strict-transport|x-frame|x-powered'
ss -ltnp | grep ':3000'                                       # 127.0.0.1:3000
journalctl -u dig -n 30                                       # lignes « [db] Migration … »
```

**Retour arrière immédiat (code et configuration), sans perte de parties :**
```bash
cd /home/ubuntu/Dig && git reset --keep 49faf2d
rm -rf node_modules && tar -xzf ~/backups/dig/release-prep-20261030/node_modules-49faf2d.tar.gz
sudo systemctl restart dig && curl -s 127.0.0.1:3000/api/version   # 1.0.0+49faf2d
# Le drop-in secrets.conf peut rester (49faf2d utilise SESSION_SECRET). Pour l'annuler aussi :
# sudo rm /etc/systemd/system/dig.service.d/secrets.conf && sudo systemctl daemon-reload && sudo systemctl restart dig
```
Il n'est **pas** nécessaire de restaurer la base : `49faf2d` fonctionne sur la base migrée (testé). Ne la restaurer qu'en cas de données abîmées, et le service arrêté : `node /opt/dig-backup/restore-db.js ~/backups/dig/dig-*-pre-deploy-18e3881.sqlite --live` (avec `NODE_PATH=/home/ubuntu/Dig/node_modules`). Les parties jouées depuis seraient perdues.

### 7. Checklist courte de recette en jeu (preuves attendues)

| # | Test en jeu | Preuve attendue |
|---|---|---|
| — | Recharger la page, se reconnecter (nouveau secret) | Sauvegarde et classement retrouvés à l'identique |
| #8 | Avec ≥ 2 000 pièces, acheter un coffre simple | Fenêtre de récompense, pas de « ❌ » ; solde et compteur conservés après F5. **Avec le bug §3.2 : comparer le solde avant et après, la différence doit être exactement 2 000** |
| #9 | Jouer quelques minutes connecté | L'onglet Saison suit la profondeur du jeu (≤ ~12 s de retard) ; une profondeur falsifiée via `curl` est rejetée (journal admin « profondeur rejetée ») |
| #10 | Outils de développement → Réseau, filtrer `me/save`, cliquer en continu | Au plus un POST toutes les ~12 s ; fermer puis rouvrir l'onglet : progression intacte |
| #10 | Autoclicker (≥ 15 s) | Admin → journal anti-autoclicker : lignes `reduced`/`flagged` |
| #11 | Onglet Boutique | Boutons gris « Bientôt », non cliquables, aucune gemme créditée |
| #12 | `curl -sI` (§6) | HSTS, `X-Frame-Options`, pas de `X-Powered-By` ; cookie `Secure; HttpOnly; SameSite=Lax` |
| #14 | 11 mauvais mots de passe en 1 min | 10 × « incorrect » puis « Trop de tentatives » ; `GET /api/players/<uuid>/save` → 404 |
| #15 | Inscription avec `test@example.com<b>x` ; parcours complet du panel admin | « Adresse e-mail invalide » ; panel fonctionnel, aucun HTML interprété |

### 8. Choix faits seul

- **Lot = `18e3881`** plutôt que `develop` : c'est le seul point de `develop` qui contient exactement les tickets demandés sans #16, et il fait une avance rapide de `main`. #13 et #22 y sont inertes.
- **Sauvegarde de `node_modules`** : un retour arrière via `npm ci` peut imposer une recompilation de plusieurs minutes ; avec l'archive, il prend quelques secondes.
- **Aucune lecture de secret** : l'absence de secret a été établie par l'absence de `.env` et de drop-in, et par l'unité systemd (valeurs masquées). L'environnement du processus n'a pas été lu.
- **Bug §3.2 signalé, pas corrigé** : il relève de #8/#10, hors du périmètre de #13.

### 9. Décisions demandées au propriétaire

1. **Feu vert pour le lot `18e3881`** (sans #16) ? Recommandation : oui, après les points 2 et 3.
2. **Bug coffres §3.2** : (a) le corriger d'abord dans #8/#10 (petit correctif client, puis nouveau lot) — **recommandé** ; (b) déployer tel quel et l'observer pendant la recette.
3. **Secrets** : créer `/etc/dig/dig.env` avec `SESSION_SECRET` (obligatoire) **et `ADMIN_SECRET`** (recommandé, pour pouvoir faire la recette admin), puis le drop-in (§3.1).

### 10. Reste à faire

- Ticket #13 lui-même : la copie hors machine S3 (reportée au 31/10, voir la section précédente).
- Après déploiement, faire pointer `dig-backup.service` vers `/home/ubuntu/Dig/scripts/backup-db.js` et retirer `/opt/dig-backup` (optionnel).
- CI (#17) inexistante.
