# Ticket #36 — Sauvegardes hors machine : AWS S3 us-east-1 et test de restauration

Lien : https://github.com/ReC82/Dig/issues/36 · Lié à #13

## Session du 30/10/2026 (21:18–21:45, Bruxelles)

### 1. État réel

**Partiel. Partie serveur déployée en production (SHA `df570a3`). La partie AWS est bloquée et attend le propriétaire.**

Les outils côté serveur sont maintenant tous prêts : envoi, restauration depuis S3, contrôle du bucket et journal des envois. Aucun d'eux n'est encore branché, faute de bucket confirmé, de rôle IAM et d'AWS CLI. Aucun envoi réel vers S3 n'a eu lieu.

Je n'ai fait **aucune action côté AWS** : la directive du 30/10 interdit à l'orchestrateur de créer ou modifier des ressources ou permissions AWS. Je n'ai donc ni interrogé de compte, ni deviné de nom de bucket, ni lu les identifiants. Les étapes 1, 2, 3 et la preuve réelle de l'étape 4 du ticket attendent le propriétaire (voir § 8).

### 2. Réconciliation (déjà livré avant cette session, par #13)

- `scripts/offsite-s3.sh` : envoi de la sauvegarde et de son manifeste, chiffrement SSE-S3, sha256 contrôlé par S3, puis relecture `head-object`.
- `deploy/aws/setup-s3.sh` : création du bucket et du rôle d'instance `dig-backup-ec2`, idempotente. Le propriétaire le lance dans CloudShell.
- Crochet `DIG_BACKUP_OFFSITE_CMD` dans `scripts/backup-db.js`, et documentation dans `docs/OPERATIONS.md`.

Je n'ai rien refait de tout cela.

### 3. Changements de cette session

| Fichier | Rôle |
|---|---|
| `scripts/restore-from-s3.sh` (nouveau) | **Test de restauration depuis S3 sur copie isolée** (étape 4 du ticket). Prend `latest` ou un nom précis `dig-AAAAMMJJ-HHMMSS[-label].sqlite` (nom validé, pas de chemin arbitraire). Télécharge la sauvegarde et son manifeste dans un dossier `mktemp` neuf (droits 700), avec le checksum S3 vérifié au téléchargement (`--checksum-mode ENABLED`). Compare ensuite le sha256 à la métadonnée enregistrée à l'envoi et au manifeste. Restaure enfin avec `restore-db.js` sur une base **neuve** de ce dossier (`integrity_check` + compteurs par table). La base du jeu n'est jamais lue ni écrite. Le dossier est supprimé à la fin, sauf avec `DIG_S3_KEEP=1`. Les droits du rôle `dig-backup-ec2` (GetObject + ListBucket sur `backups/`) suffisent. |
| `deploy/aws/check-s3.sh` (nouveau) | **Contrôle en lecture seule** d'un bucket créé à la main dans la console (étape 1 du ticket). N'utilise que des appels `get-*` : région = us-east-1, 4 blocages d'accès public, chiffrement par défaut AES256, versionnement activé, expiration à 30 jours sur `backups/`. Affiche « ok / ÉCART » pour chaque point. Code de sortie 0 seulement si tout est conforme. Il ne crée, ne modifie et ne supprime rien. |
| `scripts/backup-db.js` | **Journal des envois hors machine** (étape 5 du ticket) : chaque tentative ajoute une ligne JSON à `~/backups/dig/offsite.log` (`at`, `file`, `result` = `ok` / `échec (code N)`, `duration_ms`, droits 600). Rien n'est écrit tant que la copie hors machine est désactivée, ce qui est le cas en production aujourd'hui. Le comportement en cas d'échec ne change pas : la sauvegarde locale est conservée, le script sort en erreur et `dig-backup.service` passe en échec. |
| `test/fixtures/fake-aws.js`, `test/offsite-s3.test.js` | Le faux AWS CLI simule aussi `get-object`, `list-objects-v2` et les lectures de configuration du bucket. **5 nouveaux tests** : journal réussite/échec, journal absent si la copie est désactivée, restauration de la plus récente puis d'une sauvegarde précise (base du jeu inchangée octet pour octet), refus si objet altéré, absent, nom invalide ou bucket vide, contrôle du bucket conforme puis écarts (lectures seulement). |
| `docs/OPERATIONS.md` | Procédure : contrôle d'un bucket existant, test de restauration depuis S3, lecture du journal. |

Aucun changement visible dans le jeu. Aucune migration, aucune donnée joueur touchée.

### 4. SHA, branche et procédure de test

- Branche `feature/36-sauvegardes-s3`, commit `b60412a`. Fusion dans `develop` : **`df570a3`** (puis commit du rapport).
- Tests automatiques : `npm test` → **335/335** (sur la branche, sur `develop` et sur le SHA exact de la release).
- `shellcheck` sans remarque sur les deux nouveaux scripts.
- Rejouer localement, sans AWS : `node --test test/offsite-s3.test.js` → 8/8.

### 5. Vérifications, limites, impact

- Vérifié : tests ci-dessus. Sur une copie de la base de production, démarrage de la release avec `/health` et `/api/version` = `1.0.0+df570a3`, et empreintes des 6 tables (users, user_saves, season_rankings, seasons, leagues, player_click_tracking) identiques avant et après démarrage.
- **Non vérifié : aucun appel AWS réel** (pas d'AWS CLI sur le serveur, pas de rôle IAM confirmé, et les ressources AWS me sont interdites). Le format exact des réponses de l'AWS CLI v2 (`--output text` de `get-bucket-location`, `list-objects-v2`) est connu mais n'a été testé qu'avec le simulateur. Le premier passage réel du propriétaire servira de validation.
- `latest` choisit la plus récente par le nom horodaté. `list-objects-v2` renvoie au plus 1 000 clés par page et l'AWS CLI pagine tout seul ; avec une expiration à 30 jours, on reste vers 60 objets.
- Impact sur les données joueurs : **aucun**. Les scripts n'écrivent que dans `~/backups/dig/offsite.log` (une fois la copie branchée) et dans un dossier temporaire.

### 6. Déploiement

- **Déployé en production : `df570a3`** le 30/10 à 21:32 (Bruxelles), depuis `80d2e51`, sans `npm ci` (lock inchangé).
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261030-213243-pre-deploy-df570a3.sqlite`.
- Après déploiement : `dig.lodygames.com` et `dig.lodylands.com` → 200 avec `/api/version` = `1.0.0+df570a3`. `journalctl -u dig` sans erreur, `pragma quick_check` = ok, empreintes joueurs identiques à la sauvegarde pré-déploiement.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 80d2e51 && sudo systemctl restart dig`. Il n'y a aucune migration, et le seul ajout de données est le fichier `offsite.log`, inactif tant que la copie n'est pas branchée.
- **Test fonctionnel (propriétaire)** : il n'y a rien à tester dans le jeu. Le test se fait sur AWS puis sur le serveur, voir § 8.
- **Classement MVP : « Après lancement ».** Les sauvegardes locales quotidiennes vérifiées et les déploiements réversibles (#13) protègent déjà contre les erreurs logicielles. La copie S3 protège contre la perte de la machine : à faire vite, mais elle ne bloque pas le partage du MVP.

### 7. Choix techniques faits seul

- **Restauration en shell, en réutilisant `restore-db.js`** plutôt qu'un nouveau code Node : un seul chemin de restauration, déjà testé. La cible est toujours une base neuve dans un dossier `mktemp`, donc pas de sauvegarde « pre-restore » parasite dans `~/backups/dig`, et aucun moyen de viser la base du jeu.
- **Triple contrôle du sha256** : checksum S3 à la réception, métadonnée enregistrée à l'envoi, puis manifeste. Un objet modifié côté S3 est refusé.
- **Contrôle du bucket séparé de `setup-s3.sh`**, en lecture seule. Le ticket demande de ne pas réinitialiser ni dupliquer un bucket créé à la main : on vérifie d'abord, puis on corrige si besoin.
- **Journal en JSON par ligne dans le dossier des sauvegardes** : il survit à la rotation de journalctl, se lit avec `tail`, et n'existe que si la copie est branchée.
- **Pas d'alerte e-mail** : le SMTP du jeu (#43) n'est pas configuré. `dig-backup.service` passe déjà en échec visible (`systemctl --failed`). Alerte proposée ci-dessous, pour après le lancement.

### 8. Décisions et actions demandées au propriétaire

1. **Bucket** : quel est le nom exact du bucket créé en us-east-1 ? Dans AWS CloudShell (us-east-1), lance `bash deploy/aws/check-s3.sh <bucket> us-east-1` (après `git clone https://github.com/ReC82/Dig` ou un copier-coller du fichier) et colle la sortie dans le ticket. Elle ne contient aucun secret. *Recommandation : faire ce contrôle avant toute autre étape.*
2. **Rôle IAM et réglages** : l'orchestrateur n'a pas le droit de créer de ressources ni de permissions AWS. Options :
   (a) tu lances toi-même dans CloudShell `bash deploy/aws/setup-s3.sh <bucket> <id-instance> us-east-1`. Ce script est idempotent : il ne recrée pas le bucket, corrige seulement ses réglages, crée le rôle `dig-backup-ec2` limité à `backups/*` sans clé d'accès, et l'associe à l'instance si elle n'a pas déjà de profil ;
   (b) tu crées le rôle à la main dans la console.
   *Recommandation : (a).*
3. **Serveur** : installer l'AWS CLI v2 et le drop-in systemd `dig-backup.service.d/offsite.conf` modifie l'infrastructure, ce qui m'est interdit sans ton accord écrit. Options :
   (a) tu écris dans le ticket « j'autorise l'installation de l'AWS CLI v2 et du drop-in offsite.conf pour le bucket <nom> ». Une session suivante fera alors l'installation, le premier envoi réel et le test de restauration depuis S3, avec les preuves ;
   (b) tu le fais toi-même avec `docs/OPERATIONS.md` § « Copie hors machine vers S3 », étapes 2 à 4.
   *Recommandation : (a), après les points 1 et 2.*
4. **Alerte e-mail en cas d'échec d'envoi** : *recommandation : après le lancement, une fois le SMTP du jeu (#43) configuré.* En attendant, échec visible dans `systemctl --failed` et dans `offsite.log`.

### 9. Restant à réaliser

- Une fois les points 1 à 3 faits (Après lancement) : `aws sts get-caller-identity` (rôle `dig-backup-ec2`), `systemctl start dig-backup.service`, puis vérifier « [offsite-s3] ok » et « hors machine : ok ». Ensuite `scripts/restore-from-s3.sh latest` (copie isolée vérifiée), et contrôler la rétention avec `check-s3.sh`.
- Alerte e-mail sur échec d'envoi : après #43 (Après lancement).

## Session du 05/11/2026 (02:50–03:20, Bruxelles) — vérifications AWS réelles

Fait suite aux commentaires du propriétaire du 04/11 : bucket `lodygames-dig-bucket` (us-east-1) ; accord pour le rôle EC2, l'AWS CLI v2, l'envoi réel et la restauration isolée ; rôle `dig-backup-ec2` associé par le propriétaire à l'instance `i-0902384bfb5e75956`.

### 1. État réel

**Partiel. L'envoi réel vers S3 et la restauration depuis S3 sur une base jetable sont prouvés. L'envoi automatique quotidien n'est pas encore branché**, parce qu'il faut un drop-in systemd (sudo), et je n'ai pas le droit de modifier les unités systemd. Par ailleurs, **le versionnement et l'expiration à 30 jours ne sont pas actifs** sur le bucket. Ces deux points se règlent dans la console AWS ou dans CloudShell (voir § 8).

Je n'ai rien déployé : les changements de cette session ne concernent que la documentation et le message d'un script d'exploitation. Le jeu n'exécute rien de nouveau (§ 6).

### 2. Ce qui a été vérifié pour de vrai

| Contrôle | Résultat |
|---|---|
| Rôle associé à l'instance (IMDSv2, `iam/info`) | `instance-profile/dig-backup-ec2` sur `i-0902384bfb5e75956`, us-east-1 ✅ |
| AWS CLI v2 | **2.39.4**, installée avec l'installateur officiel **pour l'utilisateur `ubuntu` seulement** (`~/.local/bin/aws`, sans sudo). La signature PGP est valide (« Good signature from AWS CLI Team »), empreinte `FB5D B77F D5C1 18B8 0511 ADA8 A631 0ACC 4672 475C` ✅ |
| `aws sts get-caller-identity` | `assumed-role/dig-backup-ec2/i-0902384bfb5e75956` : identifiants temporaires IMDS, aucune clé enregistrée sur le serveur ✅ |
| Moindre privilège | `ListBucket` hors `backups/` → AccessDenied ; `PutObject` hors `backups/` → AccessDenied ; tous les `get-bucket-*` → AccessDenied. Le rôle n'a pas de `s3:*` ✅ |
| **Envoi réel** (`scripts/offsite-s3.sh`) de la sauvegarde quotidienne existante `dig-20261104-033000-daily.sqlite` (1 228 800 octets) et de son manifeste | `[offsite-s3] ok` pour les 2 objets, en environ 4 s. sha256 `cbcd8ec7…3d2ee1` contrôlé par S3 à la réception, puis relu avec `head-object` ✅ |
| Chiffrement | `ServerSideEncryption = AES256` sur l'objet ✅ |
| **Restauration depuis S3** (`scripts/restore-from-s3.sh latest`) | Téléchargement dans un dossier `mktemp` neuf. Triple contrôle du sha256 (S3, métadonnée, manifeste). Restauration sur une base neuve : `integrity_check` ok, **87 tables / 648 lignes**. Dossier supprimé ensuite. La base du jeu n'a pas été touchée (date et taille inchangées) ✅ |
| Échec journalisé, puis reprise | Avec `backup-db.js` lancé sur une **copie** (dossier temporaire), vers un préfixe interdit : AccessDenied, `[offsite-s3] ÉCHEC`, sauvegarde locale conservée et vérifiée, ligne `{"result":"échec (code 1)"}` dans `offsite.log`. Ensuite, nouvel envoi réussi de la même sauvegarde vers `backups/` ✅ |
| **Versionnement** | ❌ L'objet n'a **pas de `VersionId`**, donc le versionnement est désactivé |
| **Expiration 30 jours** | ❌ L'objet n'a **pas d'en-tête `Expiration`**, donc aucune règle d'expiration ne s'applique à `backups/` |
| Accès public bloqué, chiffrement par défaut du bucket | Non vérifiable depuis le serveur : le rôle ne lit pas la configuration du bucket, et c'est voulu. À faire dans CloudShell avec `check-s3.sh` |

**Résultat dans S3 :** `backups/dig-20261104-033000-daily.sqlite` et `.json`. Je ne peux rien y supprimer : le rôle n'a pas `DeleteObject`.

### 3. Changements de cette session

- `docs/OPERATIONS.md` :
  - emplacement réel de l'AWS CLI et procédure de mise à jour ;
  - le rôle ne lit pas la configuration du bucket ;
  - drop-in avec les vraies valeurs (`DIG_S3_BUCKET=lodygames-dig-bucket`, `AWS_CLI=/home/ubuntu/.local/bin/aws`, car `~/.local/bin` n'est pas dans le `PATH` de systemd) ;
  - mise à jour de `/opt/dig-backup/backup-db.js`, une copie du 29/10 qui n'a pas le journal `offsite.log`.
- `deploy/aws/check-s3.sh` : quand le bucket est « inaccessible », le message explique que c'est normal sur le serveur et qu'il faut lancer le contrôle dans CloudShell.

### 4. SHA, branche, tests

- Branche `feature/36-sauvegardes-s3` ; SHA sur `develop` : voir le commentaire du ticket et le statut.
- `npm test` complet sur la branche : **730/730** ; `node --test test/offsite-s3.test.js` 8/8 ; `shellcheck` OK.
- Rejouer sur le serveur (lecture S3 seulement, base du jeu jamais touchée) :
  `PATH=$HOME/.local/bin:$PATH DIG_S3_BUCKET=lodygames-dig-bucket AWS_REGION=us-east-1 bash /home/ubuntu/Dig/scripts/restore-from-s3.sh latest`

### 5. Limites et impact

- Données joueurs : **aucun impact**. J'ai seulement lu une sauvegarde locale existante. Aucune sauvegarde locale n'a été supprimée ni modifiée. Seules des copies temporaires ont été créées dans `/tmp`, puis supprimées.
- L'envoi automatique quotidien n'est **pas** actif (§ 8, point 1). Sans versionnement ni expiration, les objets restent dans S3 sans limite de durée et un écrasement n'est pas récupérable (§ 8, point 2).
- Le rôle d'instance s'applique à toute la machine : les autres projets du serveur peuvent aussi écrire dans `backups/` de ce bucket. Le risque est acceptable (accès limité au préfixe, aucune suppression possible) ; le versionnement protégera contre les écrasements.

### 6. Déploiement

**Pas de nouveau déploiement.** Cette session ne modifie que la documentation et un message de `check-s3.sh`, un outil lancé dans CloudShell. Le jeu et `dig-backup.service` n'exécutent rien de nouveau. Ces changements partiront avec le prochain déploiement. La production reste en `497b52a`.
**Test fonctionnel du propriétaire** : rien à tester dans le jeu. Voir le § 8 (console et serveur).
**Classement MVP : « Après lancement »** (sauvegardes locales vérifiées et déploiements réversibles déjà en place).

### 7. Choix techniques faits seul

- **CLI installée pour l'utilisateur `ubuntu` (sans sudo)** plutôt que dans `/usr/local` : je n'ai pas le droit de modifier l'infrastructure du serveur, et le service de sauvegarde tourne déjà sous `ubuntu`.
- **Test réel fait avec une sauvegarde quotidienne existante**, sans créer de nouvelle sauvegarde sur la base live.
- **Échec testé sur une copie** et avec un vrai refus d'AWS, pour ne laisser ni objet parasite ni sauvegarde de test dans `~/backups/dig`.
- **Pas de `setup-s3.sh` pour corriger le bucket** : il *remplacerait* sa politique, ses tags et ses règles de cycle de vie. Or ce bucket, nommé `lodygames-…`, sert peut-être à autre chose. Je propose plutôt des commandes ciblées, à lancer après lecture de l'existant.

### 8. Actions demandées au propriétaire

1. **Brancher l'envoi quotidien** (sudo, sur le serveur ; je n'ai pas le droit de modifier systemd) :
   ```bash
   cd /home/ubuntu/Dig
   sudo install -m 755 scripts/offsite-s3.sh /opt/dig-backup/offsite-s3.sh
   sudo install -m 644 scripts/backup-db.js /opt/dig-backup/backup-db.js
   sudo mkdir -p /etc/systemd/system/dig-backup.service.d
   printf '[Service]\nEnvironment=DIG_S3_BUCKET=lodygames-dig-bucket\nEnvironment=AWS_REGION=us-east-1\nEnvironment=AWS_CLI=/home/ubuntu/.local/bin/aws\nEnvironment=DIG_BACKUP_OFFSITE_CMD=/opt/dig-backup/offsite-s3.sh\n' | sudo tee /etc/systemd/system/dig-backup.service.d/offsite.conf
   sudo systemctl daemon-reload && sudo systemctl start dig-backup.service
   journalctl -u dig-backup -n 10 --no-pager    # attendu : « [offsite-s3] ok … » puis « hors machine : ok »
   ```
   Retour arrière : `sudo rm /etc/systemd/system/dig-backup.service.d/offsite.conf && sudo systemctl daemon-reload`. *Recommandation : oui, maintenant.*
2. **Versionnement et expiration** (CloudShell us-east-1, avec tes droits). D'abord lire l'existant :
   `aws s3api get-bucket-lifecycle-configuration --bucket lodygames-dig-bucket` et `bash deploy/aws/check-s3.sh lodygames-dig-bucket us-east-1`.
   Si aucune règle de cycle de vie n'existe déjà (sinon, ajoute la règle dans la console, onglet Management, pour ne pas écraser les autres) :
   `aws s3api put-bucket-versioning --bucket lodygames-dig-bucket --versioning-configuration Status=Enabled`
   `aws s3api put-bucket-lifecycle-configuration --bucket lodygames-dig-bucket --lifecycle-configuration file://deploy/aws/lifecycle.json`
   puis relance `check-s3.sh` : attendu « == conforme ». Colle la sortie dans le ticket (elle ne contient aucun secret). *Recommandation : oui. Expiration à 30 jours sur `backups/` uniquement.*
3. Alerte e-mail sur échec : *après le lancement, une fois le SMTP (#43) configuré.*

### 9. Restant à réaliser

- Après le point 1 : constater la première sauvegarde quotidienne envoyée automatiquement (`offsite.log`, `result: ok`), puis `restore-from-s3.sh latest` sur cette sauvegarde.
- Après le point 2 : `head-object` doit montrer `VersionId` et `Expiration`.
- Alerte e-mail après #43.
