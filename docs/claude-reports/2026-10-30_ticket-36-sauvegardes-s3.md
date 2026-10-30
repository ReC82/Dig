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
