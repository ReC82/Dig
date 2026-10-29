# Ticket #14 — [P1] T-07 — Rate limiting et suppression des routes API legacy

- Ticket : https://github.com/ReC82/Dig/issues/14 (source : audit général #6, section T-07)
- Session du 29-30/10/2026

## 1. État réel

**Intégré dans develop — en attente de validation et de déploiement.** Rien n'est déployé : `main`,
`/home/ubuntu/Dig`, `dig.service` et nginx n'ont pas bougé. Aucune action préalable n'est requise
au déploiement (pas de secret, pas de migration).

## 2. Problème

- `POST /api/login` et `POST /api/register` acceptaient un nombre illimité de requêtes : force
  brute des mots de passe et création de comptes en masse possibles.
- `POST /api/me/save` sans plafond (chaque sauvegarde = plusieurs écritures SQLite).
- L'ancienne API anonyme `/api/players/register` et `/api/players/:token/save` (GET/POST/DELETE)
  était exposée sans être utilisée par le jeu : jeton dans l'URL (journaux nginx, historique),
  écriture en base sur un simple `GET` (création de joueur + événement), suppression de sauvegarde
  par `DELETE` sans authentification.
- L'inscription révélait si une adresse e-mail possédait déjà un compte.

## 3. Changements réalisés

| Fichier | Changement |
|---|---|
| `package.json`, `package-lock.json` | Dépendance `express-rate-limit` ^7.5.1 (aucune dépendance transitive ; `npm audit` : 0 vulnérabilité). |
| `server/rateLimits.js` (nouveau) | Trois limiteurs en mémoire + réponse 429 JSON homogène (`Retry-After`, en-têtes `RateLimit` draft-7). Limites réglables par variables d'environnement. |
| `server/index.js` | Limiteurs branchés sur `/api/login`, `/api/register`, `POST /api/me/save`. **Suppression** des 4 routes `/api/players/*` (et de `isValidToken`, des imports inutilisés). Catch-all `/api/*` ⇒ `404 {"error":"Route inconnue."}`. Inscription : un seul message 409 que le nom **ou** l'e-mail soit pris. |
| `test/rate-limit.test.js` (nouveau) | 5 tests (voir § 4). |
| `docs/OPERATIONS.md` | Section « Limitation de débit et API legacy » : limites, variables, vérifications après déploiement. |

Limites par défaut :

| Route | Limite | Ce qui compte | Clé |
|---|---|---|---|
| `POST /api/login` | 10 / minute | les **échecs** seulement (réponses ≥ 400) | IP |
| `POST /api/register` | 10 / 15 minutes | toutes les tentatives | IP |
| `POST /api/me/save` | 30 / minute | toutes | compte connecté (IP sinon) |

Comportement visible pour les joueurs : aucun en usage normal (le jeu envoie au plus une
sauvegarde cloud toutes les 12 s depuis #10, soit ≤ 5/min, plus une à la fermeture de l'onglet).
Après 10 mots de passe faux en une minute, la fenêtre de connexion affiche « Trop de tentatives.
Réessayez dans N s. ». Une inscription avec un nom ou un e-mail déjà utilisé affiche « Ce nom
d'utilisateur ou cette adresse e-mail est déjà utilisé. ».

## 4. SHA, branche et procédure de test

- Branche : `fix/14-rate-limit-api-legacy` (commit `3f7e8a8`)
- **SHA sur `develop` : `693f027`** (fusion `--no-ff`) ; ce rapport est intégré par une fusion suivante.

```bash
npm ci && npm test        # 72 tests, 0 échec (dont 5 nouveaux dans test/rate-limit.test.js)
npm audit                 # found 0 vulnerabilities
```

`test/rate-limit.test.js` (serveur sur le port 3112, base temporaire dans `/tmp`) vérifie :
1. `POST /api/players/register`, `GET|POST|DELETE /api/players/<uuid>/save` et une route `/api/*`
   inconnue ⇒ **404 JSON** ; la table `players` reste vide ; `/api/version` et `/api/me` répondent toujours 200 ;
2. connexion avec `RATE_LOGIN_MAX=3` : 5 connexions réussies ne comptent pas ; 3 échecs (401) puis
   **429** avec `Retry-After` (1–60 s) et en-tête `RateLimit` ; bloqué même avec le bon mot de passe ;
   une autre IP (relayée comme par nginx, `X-Forwarded-For`) n'est pas affectée ;
3. inscription avec `RATE_REGISTER_MAX=4` : nom déjà pris et e-mail déjà pris donnent **exactement
   la même réponse 409** ; la 5e tentative ⇒ 429 ;
4. sauvegarde avec `RATE_SAVE_MAX=3` : 4e sauvegarde du même compte ⇒ 429 ; un autre compte
   depuis la même IP passe ; la lecture `GET /api/me/save` n'est pas limitée ;
5. valeurs par défaut : 10 échecs de connexion (401) puis 429.

Test manuel possible :
`PORT=3101 DB_FILE=/tmp/test-14.sqlite node server/index.js` puis
`curl -i http://127.0.0.1:3101/api/players/00000000-0000-4000-8000-000000000000/save` ⇒ 404, et
11 `POST /api/login` avec un mauvais mot de passe ⇒ 401 ×10 puis 429.

## 5. Vérifications, limites, impact sur les données

- Fait : suite complète sur la branche (72/72) ; après fusion dans `develop` : `npm ci`,
  `node --check`, `test/rate-limit.test.js` + `test/security.test.js` (12/12) ; `npm audit` 0.
- Vérifié dans le code client (`public/js`) : aucun appel à `/api/players/*` ; les erreurs de
  connexion/inscription affichent `data.error` (le message 429 s'affiche donc tel quel) ; une
  sauvegarde cloud en échec est ignorée silencieusement et retentée au cycle suivant.
- Non fait : aucun test en production (interdit). Le comportement derrière nginx repose sur
  `trust proxy loopback` livré par #12 : **si #14 était déployé sans #12**, toutes les requêtes
  sembleraient venir de 127.0.0.1 et partageraient le même compteur IP (connexion/inscription).
  `develop` contient les deux : déployer `develop` tel quel évite ce cas.
- **Données des joueurs : aucune migration, aucune écriture.** Les tables `players`,
  `player_saves`, `save_events` (vides en production d'après l'audit) restent en place ; les
  fonctions correspondantes de `server/db.js` sont conservées (nettoyage éventuel avec T-17).
- Limites connues :
  - compteurs en mémoire : remis à zéro à chaque redémarrage, non partagés si un jour plusieurs
    processus Node tournent (il n'y en a qu'un) ;
  - clé = IP exacte : un attaquant IPv6 disposant d'un /64 peut changer d'adresse ; plusieurs
    joueurs derrière une même IP (école, entreprise) partagent le compteur connexion/inscription
    (seuls les échecs comptent à la connexion, donc l'impact est faible) ;
  - pas de limite par nom d'utilisateur (attaque distribuée lente sur un compte) : voir § 9 ;
  - `POST /api/me/shop/chest/open` n'est pas limité (hors périmètre « sauvegardes » ; il exige
    une session et des gemmes).

## 6. Procédure de déploiement proposée

Ce ticket ne demande aucune action préalable. Il est livré dans `develop` avec #12, qui, lui,
exige la création du secret de session **avant** déploiement (voir rapport #12 / `docs/OPERATIONS.md`).

```bash
# 0. Sauvegarde de la base
sqlite3 /home/ubuntu/Dig/server/data/dig.sqlite ".backup /home/ubuntu/backups/dig-avant-14.sqlite"

# 1. Après fusion develop → main : npm run deploy (ou procédure manuelle habituelle :
#    git pull --ff-only && npm ci && sudo systemctl restart dig)
#    npm ci est nécessaire : nouvelle dépendance express-rate-limit.

# 2. Vérifications
curl -fsS http://127.0.0.1:3000/health
curl -s -o /dev/null -w '%{http_code}\n' https://dig.lodygames.com/api/players/00000000-0000-4000-8000-000000000000/save   # 404
# Connexion + partie normale dans le navigateur (sauvegarde cloud OK).
# Facultatif (bloque VOTRE IP une minute) : 11 POST /api/login avec un mauvais mot de passe ⇒ 401 ×10 puis 429.
```

Retour arrière : redéployer le SHA précédent (`scripts/deploy.sh` le fait seul si `/health`
échoue). Aucune donnée à restaurer. En cas de faux positifs gênants sans vouloir revenir en
arrière : augmenter `RATE_LOGIN_MAX` / `RATE_REGISTER_MAX` / `RATE_SAVE_MAX` (ou `RATE_LIMIT=off`)
dans `/etc/dig/dig.env` puis redémarrer.

## 7. Choix techniques faits seul

- **`express-rate-limit`** (proposé par l'audit) plutôt qu'un limiteur maison : maintenu, sans
  dépendance transitive, en-têtes standard.
- **Connexion : seuls les échecs comptent** (`skipSuccessfulRequests`) — un joueur légitime n'est
  jamais bloqué, une force brute l'est après 10 essais/minute.
- **Sauvegarde : clé par compte** et non par IP, pour que plusieurs joueurs derrière une même IP
  ne se gênent pas ; marge ×6 au-dessus du rythme réel du client.
- **Suppression** des routes legacy (et non désactivation par drapeau) : code mort, aucun appel
  client ; les tables restent pour ne rien détruire.
- **404 JSON pour toute route `/api/*` inconnue** (au lieu de la page HTML « Cannot GET » d'Express) :
  répond au critère « les routes legacy renvoient 404 » sans route fantôme spécifique.
- **Message d'inscription neutre** unique pour nom ou e-mail déjà pris (point « messages
  d'erreur neutres » de l'audit T-07). Le nom d'utilisateur reste de toute façon public via le
  classement ; l'e-mail, lui, n'est plus révélé.
- Messages d'erreur 429 en français en dur, comme les autres messages serveur actuels
  (l'i18n des messages serveur relève de T-17).

## 8. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire. Les seuils (10/min, 10/15 min, 30/min) sont ajustables
sans redéploiement de code via les variables d'environnement si vous préférez d'autres valeurs.

## 9. Éléments restant à réaliser (suggestions, hors périmètre)

- Limite complémentaire **par nom d'utilisateur** (ex. 20 échecs / heure / compte, toutes IP
  confondues) contre une attaque distribuée lente.
- Regrouper les IPv6 par /64 pour le comptage (disponible dans `express-rate-limit` v8).
- Limiter aussi `POST /api/me/shop/chest/open` et les routes admin (à voir avec #25 anti-bot).
- Nettoyage du code et des tables legacy dans `server/db.js` (T-17), après accord pour un éventuel `DROP`.
