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

| Variable  | Défaut       | Description                                    |
|-----------|--------------|------------------------------------------------|
| `PORT`    | `3000`       | Port d'écoute du serveur                       |
| `DB_FILE` | `dig.sqlite` | Nom du fichier SQLite dans `server/data/`      |

Le dossier `server/data/` est créé automatiquement au premier démarrage.

## Structure

```
├── public/             Frontend (HTML, CSS, JS) — servi par Express
│   ├── index.html
│   ├── css/
│   └── js/
├── server/
│   ├── index.js        Serveur Express + routes API
│   ├── db.js           Accès SQLite (better-sqlite3)
│   └── data/           Base de données SQLite (gitignorée)
├── .env.example
├── .gitignore
└── package.json
```

## API

| Méthode  | Route                          | Description                       |
|----------|--------------------------------|-----------------------------------|
| `GET`    | `/health`                      | Statut du serveur                 |
| `POST`   | `/api/players/register`        | Enregistre ou retrouve un joueur  |
| `GET`    | `/api/players/:token/save`     | Charge la sauvegarde              |
| `POST`   | `/api/players/:token/save`     | Crée ou met à jour la sauvegarde  |
| `DELETE` | `/api/players/:token/save`     | Supprime la sauvegarde (reset)    |

Le `:token` est un UUID v4 généré côté client et persisté dans `localStorage`.

## Base de données

```sql
players       — identité joueur (token UUID)
player_saves  — sauvegarde JSON par joueur (1 ligne max)
save_events   — journal des opérations (save / load / reset)
```
