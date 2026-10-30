# ⛏ DIG!

Idle clicker game — frontend HTML/CSS/JS + backend Node.js + SQLite.

## Prérequis

- Node.js ≥ 18

## Installation

```bash
npm install
```

## Lancement

```bash
# Production
npm start

# Développement (rechargement automatique)
npm run dev
```

Le jeu est accessible sur **http://localhost:3000**

## Configuration

Copier `.env.example` en `.env` et ajuster les valeurs si nécessaire :

```bash
cp .env.example .env
```

| Variable         | Défaut        | Description                                                  |
|------------------|---------------|--------------------------------------------------------------|
| `PORT`           | `3000`        | Port d'écoute du serveur                                     |
| `HOST`           | `127.0.0.1`   | Adresse d'écoute (nginx sert le jeu en HTTPS devant Node)    |
| `NODE_ENV`       | —             | `production` : cookie `secure`, secret de session obligatoire |
| `SESSION_SECRET` | —             | Obligatoire en production (≥ 32 caractères), sinon refus de démarrer |
| `ADMIN_SECRET`   | —             | Clé du panel `/admin` ; panel désactivé (503) si absente ou trop courte |
| `TRUST_PROXY`    | `loopback`    | Réglage Express « trust proxy »                              |
| `DB_FILE`        | `dig.sqlite`  | Nom du fichier SQLite dans `server/data/`                    |
| `SESSIONS_DIR`   | `sessions`    | Dossier des sessions (relatif à `server/data/` ou absolu)    |
| `COMMIT_HASH`    | `git rev-parse` | Version affichée par `/api/version` (`1.0.0+<sha>`)        |

En production, les secrets sont dans `/etc/dig/dig.env` (jamais dans le dépôt).
Exploitation (déploiement, sauvegardes, restauration) : `docs/OPERATIONS.md`.

Le dossier `server/data/` est créé automatiquement au premier démarrage.

## Tests

```bash
npm test        # tests automatisés (bases temporaires, ports 3105-3117, jamais la production)
```

Détails, intégration continue GitHub Actions et `seed-test.js` : `docs/OPERATIONS.md`, section « Tests ».

## Structure

```
├── public/               Frontend (HTML, CSS, JS) — servi par Express
│   ├── index.html        Jeu (PWA : manifest.webmanifest, sw.js)
│   ├── js/               Logique client (i18n.js : FR/EN/NL, save.js, …)
│   └── admin/            Panel d'administration (/admin)
├── server/
│   ├── index.js          Serveur Express + routes API
│   ├── db.js             Accès SQLite (better-sqlite3) et migrations additives
│   ├── seasons.js        Saisons, classement, anti-autoclic, rotation planifiée
│   ├── chestShop.js      Coffres de saison (achat vérifié côté serveur)
│   ├── economy.js        Paramètres économiques réglables par l'admin
│   ├── security.js       Secrets, en-têtes HTTP, contrôle de la clé admin
│   ├── rateLimits.js     Limitation de débit (connexion, inscription, sauvegarde)
│   ├── validation.js     Validation des entrées (e-mail, paramètres de pagination)
│   └── data/             Base SQLite et sessions (gitignorées)
├── scripts/              deploy.sh, backup-db.js, restore-db.js
├── test/                 Tests automatisés (npm test)
└── docs/                 OPERATIONS.md, LIGUES.md, ANTI-BOT.md, ICONS.md, rapports
```

## API

Authentification par cookie de session (`/api/me/*`) ; routes `/api/admin/*` protégées
par l'en-tête `Authorization: Bearer <ADMIN_SECRET>`. Toute autre route `/api/*` répond 404.

| Méthode  | Route                                            | Description                                   |
|----------|--------------------------------------------------|-----------------------------------------------|
| `GET`    | `/health`                                        | Statut du serveur                             |
| `GET`    | `/api/version`                                   | Version déployée (`1.0.0+<sha>`)              |
| `POST`   | `/api/register`                                  | Création de compte (nom, e-mail, mot de passe) |
| `POST`   | `/api/login`                                     | Connexion                                     |
| `POST`   | `/api/logout`                                    | Déconnexion                                   |
| `GET`    | `/api/me`                                        | Compte connecté                               |
| `GET`    | `/api/me/save`                                   | Sauvegarde cloud (avec numéro de révision)    |
| `POST`   | `/api/me/save`                                   | Enregistre la sauvegarde (`baseRevision`, 409 si conflit) |
| `POST`   | `/api/me/shop/chest/open`                        | Achat d'un coffre de saison                   |
| `GET`    | `/api/seasons/current`                           | Saison active, réglages et paramètres économiques |
| `GET`    | `/api/seasons/active/leaderboard?page=&league=`  | Classement de la saison active                |
| `GET`    | `/api/seasons/:id/leaderboard?page=`             | Classement global d'une saison                |
| `GET`    | `/api/seasons/:seasonId/leagues/:leagueId/leaderboard?page=` | Classement d'une ligue            |
| `GET`/`POST`/`PUT` | `/api/admin/seasons[/:id]`, `/close`, `/active/summary`, `/:id/leaderboard` | Gestion des saisons |
| `PUT`    | `/api/admin/seasons/:seasonId/rankings/:userId`  | Correction d'une ligne de classement (journalisée) |
| `GET`/`POST`/`PUT`/`DELETE` | `/api/admin/leagues[/:id]`            | Gestion des ligues                            |
| `GET`/`PUT` | `/api/admin/config`                           | Paramètres (dont économie, bornés)            |
| `GET`    | `/api/admin/anticheat/logs?limit=&offset=`       | Journal anti-autoclic                         |
| `GET`    | `/api/admin/players/search`, `/players/:userId/save` | Recherche et consultation d'un joueur     |
| `POST`   | `/api/admin/players/:userId/season-reset`        | Reset saisonnier d'un joueur                  |

Les paramètres `page`, `limit` et `offset` invalides (`?page=abc`) prennent leur valeur par
défaut. Un corps de requête illisible (JSON invalide, encodage non pris en charge) répond 4xx.

## Base de données

SQLite (WAL). Les migrations sont additives et idempotentes (aucune suppression de données).

```
users                  — comptes (nom, e-mail, hachage du mot de passe, ligue)
user_saves             — sauvegarde JSON par compte + révision
user_events            — journal des actions de compte (achat de coffre, reset admin…)
seasons                — saisons (dates, statut active/closed)
leagues                — ligues et bornes de rang
season_rankings        — classement par saison (profondeur, blocs manuels, ligue)
player_click_tracking  — suivi des clics pour l'anti-autoclic
player_depth_tracking  — suivi de la profondeur (classement vérifié côté serveur)
anticheat_logs         — journal anti-triche et corrections admin
admin_config           — paramètres modifiables depuis le panel admin
players, player_saves, save_events — ancienne API anonyme (routes supprimées, tables conservées)
```
