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
- **Copie hors machine :** optionnelle, via `DIG_BACKUP_OFFSITE_CMD`. Cette commande reçoit le chemin de la sauvegarde et celui du manifeste. Elle est désactivée par défaut. Pour S3, voir plus bas.

### Sauvegarde quotidienne (timer systemd)

```bash
sudo cp deploy/systemd/dig-backup.service deploy/systemd/dig-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dig-backup.timer
sudo systemctl start dig-backup.service        # premier passage immédiat
journalctl -u dig-backup -n 5                  # « [backup] OK … intégrité ok »
systemctl list-timers dig-backup.timer
```

### Copie hors machine vers S3 (ticket #13)

`scripts/offsite-s3.sh` envoie chaque sauvegarde et son manifeste dans un bucket S3 privé, avec chiffrement SSE-S3 et sha256 contrôlé par S3 à la réception. Il relit ensuite l'objet (`head-object` : taille, chiffrement, sha256). En cas d'échec, `backup-db.js` sort en erreur et `dig-backup.service` passe en échec (`systemctl --failed`). La sauvegarde locale est toujours conservée.

1. **Ressources AWS** (propriétaire, avec des droits d'administration, par exemple dans AWS CloudShell, jamais sur le serveur) :
   `bash deploy/aws/setup-s3.sh dig-backups-<id-compte> <id-instance> us-east-1`.
   Ce script crée un bucket privé (accès public bloqué, SSE-S3, versionnement, expiration à 30 jours, HTTPS obligatoire), puis le rôle d'instance `dig-backup-ec2`. Ce rôle est limité à `PutObject`/`GetObject` sur `backups/*` et à `ListBucket` sur ce préfixe. Aucune clé d'accès n'est créée.
2. **Serveur** : installer l'AWS CLI v2, puis vérifier `aws sts get-caller-identity` (doit afficher le rôle `dig-backup-ec2`).
3. **Brancher la copie** (outil installé dans `/opt/dig-backup`) :

```bash
sudo install -m 755 scripts/offsite-s3.sh /opt/dig-backup/offsite-s3.sh
sudo mkdir -p /etc/systemd/system/dig-backup.service.d
sudo tee /etc/systemd/system/dig-backup.service.d/offsite.conf >/dev/null <<'CONF'
[Service]
Environment=DIG_S3_BUCKET=dig-backups-<id-compte>
Environment=AWS_REGION=us-east-1
Environment=DIG_BACKUP_OFFSITE_CMD=/opt/dig-backup/offsite-s3.sh
CONF
sudo systemctl daemon-reload && sudo systemctl start dig-backup.service
journalctl -u dig-backup -n 10      # « [offsite-s3] ok s3://… » puis « hors machine : ok »
```

4. **Restauration depuis S3, sur une copie :**

```bash
aws s3 ls s3://dig-backups-<id-compte>/backups/ | tail
mkdir -p /tmp/dig-s3 && aws s3 cp s3://dig-backups-<id-compte>/backups/dig-….sqlite /tmp/dig-s3/ \
  && aws s3 cp s3://dig-backups-<id-compte>/backups/dig-….json /tmp/dig-s3/
node scripts/restore-db.js /tmp/dig-s3/dig-….sqlite --target /tmp/dig-restore-check.sqlite
```

**Retour arrière :** supprimer `offsite.conf`, puis `daemon-reload`. Les sauvegardes locales ne changent pas.

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

## Secrets, sessions et HTTP (ticket #12)

En production (`NODE_ENV=production`), le serveur **refuse de démarrer** si `SESSION_SECRET` est absent, fait moins de 32 caractères ou vaut l'ancienne valeur par défaut publiée dans le dépôt. Le secret est fourni par un `EnvironmentFile` systemd (`/etc/dig/dig.env`, root, mode 600 : systemd le lit en root avant de lancer Node), jamais dans le dépôt ni dans `dig.service`.

Installation, **avant** de déployer une version qui contient ce changement :

```bash
sudo install -d -m 700 -o root -g root /etc/dig
sudo install -m 600 -o root -g root /dev/null /etc/dig/dig.env
# Génère le secret sans l'afficher. ADMIN_SECRET est facultatif (voir ci-dessous).
printf 'SESSION_SECRET=%s\n' "$(openssl rand -hex 48)" | sudo tee /etc/dig/dig.env >/dev/null
sudo install -D -m 644 deploy/systemd/dig.service.d/secrets.conf /etc/systemd/system/dig.service.d/secrets.conf
sudo systemctl daemon-reload
sudo systemctl show dig -p EnvironmentFiles     # doit citer /etc/dig/dig.env
```

- **Effet sur les joueurs :** le nouveau secret invalide les cookies de session existants ; chaque joueur connecté devra se reconnecter une fois (ses sauvegardes cloud et son classement sont intacts). Les anciens fichiers de `server/data/sessions/` deviennent inutilisables et sont purgés automatiquement à expiration ; on peut aussi les supprimer après le redémarrage.
- **`ADMIN_SECRET` :** décision séparée. Absent ou plus court que 32 caractères, l'API admin répond 503 (panel désactivé, état actuel). Pour l'activer : `printf 'ADMIN_SECRET=%s\n' "$(openssl rand -hex 32)" | sudo tee -a /etc/dig/dig.env >/dev/null`, puis redémarrer. La comparaison du jeton est en temps constant.
- **Réseau :** Node écoute sur `127.0.0.1` (variable `HOST`) ; seul nginx, sur la même machine, le joint. `trust proxy` vaut `loopback` (variable `TRUST_PROXY`) : `req.secure` et `req.ip` reflètent le client réel transmis par nginx (`X-Forwarded-Proto`, `X-Forwarded-For`, déjà configurés).
- **Cookie de session :** `Secure` (HTTPS uniquement), `HttpOnly`, `SameSite=Lax`, 7 jours. Variable `COOKIE_SECURE=auto|true|false` pour un usage hors production.
- **En-têtes :** `X-Powered-By` supprimé ; `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, CSP minimale (`frame-ancestors`, `base-uri`, `object-src`, `form-action`) et HSTS (180 jours, sur HTTPS uniquement).

Vérifications après déploiement :

```bash
curl -sI https://dig.lodygames.com/ | grep -i -E 'strict-transport|x-frame|x-powered'   # HSTS + X-Frame, pas de X-Powered-By
ss -ltnp | grep ':3000'                                                                  # 127.0.0.1:3000 seulement
```

Retour arrière : `npm run deploy` vers le SHA précédent (ou `scripts/deploy.sh` le fait seul si le contrôle de santé échoue). Le drop-in peut rester en place : l'ancienne version ignore `SESSION_SECRET` (elle l'utilisait déjà s'il était défini).

## Limitation de débit et API legacy (ticket #14)

Compteurs en mémoire dans Node (remis à zéro au redémarrage), par IP réelle du client (`trust proxy` loopback, voir ci-dessus) :

| Route | Limite par défaut | Variable | Ce qui compte |
|---|---|---|---|
| `POST /api/login` | 10 / minute / IP | `RATE_LOGIN_MAX` | les **échecs** seulement (une connexion réussie ne compte pas) |
| `POST /api/register` | 10 / 15 minutes / IP | `RATE_REGISTER_MAX` | toutes les tentatives |
| `POST /api/me/save` | 30 / minute / **compte** (IP si non connecté) | `RATE_SAVE_MAX` | toutes les sauvegardes cloud (le jeu en envoie ≤ 5/min) |

Au-delà : réponse `429` JSON `{ "error": "Trop de tentatives. Réessayez dans N s.", "retryAfter": N }` avec `Retry-After` et `RateLimit` (draft-7). Le jeu affiche le message à la connexion/inscription ; une sauvegarde cloud refusée est ignorée silencieusement (la suivante passe, la sauvegarde locale n'est pas affectée). `RATE_LIMIT=off` désactive tout (diagnostic uniquement).

L'ancienne API anonyme `/api/players/register` et `/api/players/:token/save` (GET/POST/DELETE) est **supprimée** : elle répond `404`, comme toute route `/api/*` inconnue (`{"error":"Route inconnue."}`). Les tables `players`, `player_saves`, `save_events` restent en base (vides en production, aucune migration).

Vérification après déploiement (depuis n'importe quel poste) :

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://dig.lodygames.com/api/players/00000000-0000-4000-8000-000000000000/save   # 404
for i in $(seq 1 11); do curl -s -o /dev/null -w '%{http_code} ' -H 'Content-Type: application/json' \
  -d '{"username":"compte-inexistant","password":"mauvais-mdp"}' https://dig.lodygames.com/api/login; done; echo   # 401 ×10 puis 429
```

(Ce second test bloque les connexions **de votre IP** pendant une minute.)

## E-mails de compte : vérification et mot de passe oublié (ticket #28)

Désactivés tant que le SMTP n'est pas configuré (le jeu fonctionne alors comme avant ; seul le
changement de mot de passe, qui n'envoie rien, est proposé). Pour les activer, ajouter dans
`/etc/dig/dig.env` puis `sudo systemctl restart dig` :

```
SMTP_HOST=…  SMTP_PORT=587  SMTP_USER=…  SMTP_PASS=…
MAIL_FROM=DIG! <adresse@domaine>   MAIL_REPLY_TO=…   PUBLIC_BASE_URL=https://dig.lodygames.com
```

(une variable par ligne). Contrôle : `curl -s http://127.0.0.1:3000/api/me` → `"mail":true`.
Un échec d'envoi est journalisé (`journalctl -u dig | grep '\[mail\]'`) sans le mot de passe.
Limites : `RATE_MAIL_MAX` (5 envois / IP / 15 min), `RATE_TOKEN_MAX` (20 liens refusés / IP / 15 min).
Comparatif Auth0 et choix : `docs/AUTH-COMPARATIF.md`.

## Tests

```bash
npm ci          # une fois (installe aussi les dépendances de développement)
npm run check   # syntaxe de tous les fichiers .js suivis par git
npm test        # test/*.test.js, y compris les 62 contrôles historiques de server/test-season.js
```

Les tests n'utilisent que des bases et des dossiers de sessions temporaires (`DB_FILE` et `SESSIONS_DIR` pointent dans `os.tmpdir()`) et des ports 3105 à 3117 (dont 3111 pour `test/security.test.js`, serveur en `NODE_ENV=production`, et 3112 pour `test/rate-limit.test.js`). Ils ne touchent jamais au service `dig`, au port 3000, à `server/data/dig.sqlite` ni à `server/data/sessions/`. Ils ne laissent ni base ni fichier `-wal` / `-shm`. Durée : environ 1 min.

Ports surchargeables si l'un est occupé : variables `DIG_TEST_PORT_*` en tête de chaque fichier de `test/`.

**Intégration continue** : `.github/workflows/ci.yml` (GitHub Actions, Node 22) lance `npm ci`, `npm run check` et `npm test` à chaque push et à chaque Pull Request vers `main` ou `develop`. Résultats : onglet *Actions* du dépôt. Aucun secret n'est nécessaire.

**Jeu de données de test** (`server/seed-test.js`) : `DB_FILE` est obligatoire et ne peut pas désigner `dig.sqlite` ; un `DB_FILE` présent seulement dans `.env` est ignoré. Le script refuse donc de tourner sur la base des joueurs.

```bash
DB_FILE=/tmp/dig-seed.sqlite node server/seed-test.js            # 8 joueurs fictifs
DB_FILE=/tmp/dig-seed.sqlite node server/seed-test.js --check    # classement
DB_FILE=/tmp/dig-seed.sqlite PORT=3101 node server/index.js      # serveur de test sur cette base
```
