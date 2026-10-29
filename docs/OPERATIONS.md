# Exploitation de DIG! — sauvegardes, restauration, déploiement

La production tourne directement depuis `/home/ubuntu/Dig` (service `dig`, Node, port 3000, nginx
pour `dig.lodygames.com` et `dig.lodylands.com`). La base des joueurs est
`server/data/dig.sqlite` (mode WAL).

## Sauvegardes

```bash
npm run backup                          # sauvegarde immédiate, vérifiée
node scripts/backup-db.js --label avant-migration
```

- **Méthode :** API backup de SQLite (`better-sqlite3`), en lecture seule sur la base. Elle est cohérente même pendant que le jeu écrit, et le service n'est pas arrêté.
- **Vérification de chaque sauvegarde :** `PRAGMA integrity_check` et nombre de lignes par table. Une copie invalide est supprimée et le script sort en erreur (code 1).
- **Fichiers produits :**
  - `~/backups/dig/dig-AAAAMMJJ-HHMMSS[-label].sqlite`, en mode 600 ;
  - le manifeste `.json` associé (sha256, taille, compteurs, durée).
- **Rétention :** 14 jours (`DIG_BACKUP_RETENTION_DAYS`). Les 3 plus récentes (`DIG_BACKUP_KEEP_MIN`) sont toujours conservées, et seuls les fichiers `dig-*.sqlite` sont concernés.
- **Copie hors machine :** optionnelle, via `DIG_BACKUP_OFFSITE_CMD`. Cette commande reçoit le chemin de la sauvegarde et celui du manifeste. Elle est désactivée par défaut.

### Sauvegarde quotidienne (timer systemd)

```bash
sudo cp deploy/systemd/dig-backup.service deploy/systemd/dig-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dig-backup.timer
sudo systemctl start dig-backup.service        # premier passage immédiat
journalctl -u dig-backup -n 5                  # « [backup] OK … intégrité ok »
systemctl list-timers dig-backup.timer
```

## Restauration

```bash
# 1. Vérifier une sauvegarde sur une COPIE (sans risque, à faire régulièrement)
node scripts/restore-db.js ~/backups/dig/dig-….sqlite --target /tmp/dig-restore-check.sqlite

# 2. Restaurer la base du jeu (perte des parties jouées depuis la sauvegarde !)
sudo systemctl stop dig
node scripts/restore-db.js ~/backups/dig/dig-….sqlite --live
sudo systemctl start dig && curl -fsS http://127.0.0.1:3000/health
```

Garde-fous du script :
- il vérifie le sha256 du manifeste et l'intégrité de la sauvegarde ;
- il **refuse `--live` tant que le service est actif** ;
- il sauvegarde d'abord la base remplacée (label `pre-restore`) ;
- il écrit dans un fichier temporaire vérifié, puis fait un remplacement atomique.

## Déploiement réversible

```bash
cd /home/ubuntu/Dig
npm run deploy -- --dry-run     # contrôles seulement
npm run deploy                  # déploie origin/main
```

`scripts/deploy.sh` remplace `~/update-dig.sh`. Il enchaîne :
1. Un verrou, pour qu'il n'y ait qu'un seul déploiement à la fois.
2. Des contrôles : arbre propre, branche `main`, avance rapide possible.
3. Une **sauvegarde vérifiée obligatoire** de la base. Le déploiement est annulé si elle échoue.
4. `git merge --ff-only`.
5. `npm ci --omit=dev`, seulement si `package-lock.json` a changé.
6. `sudo systemctl restart dig`.
7. Un contrôle `/health` et `/api/version`, qui doit annoncer le nouveau SHA.
8. En cas d'échec : **retour automatique au SHA précédent** (code et dépendances), redémarrage et nouveau contrôle.

**La base n'est jamais restaurée automatiquement**, car des parties ont pu être jouées entre-temps. La commande de restauration de la sauvegarde pré-déploiement est affichée.

Journal : `~/backups/dig/deploy.log`.

### Premier déploiement avec ce script

Tant que `scripts/deploy.sh` n'est pas encore dans `/home/ubuntu/Dig`, on le lance depuis un clone à jour de `main` :

```bash
git clone -q https://github.com/ReC82/Dig /tmp/dig-deploy && cd /tmp/dig-deploy && npm ci --omit=dev
APP_DIR=/home/ubuntu/Dig bash scripts/deploy.sh --dry-run
APP_DIR=/home/ubuntu/Dig bash scripts/deploy.sh
rm -rf /tmp/dig-deploy
```

Pour les déploiements suivants : `cd /home/ubuntu/Dig && npm run deploy`.

## Tests

```bash
npm test     # test/*.test.js : sauvegarde, rétention, restauration, déploiement + retour arrière
```

Les tests n'utilisent que des bases temporaires et le port 3105 (bac à sable Git local). Ils ne touchent jamais au service `dig`, au port 3000 ni à `server/data/dig.sqlite`.
