# Audit général de DIG! — ticket #6

- **Date :** 2026-10-29 21:30 CET
- **Périmètre :** dépôt `ReC82/Dig` (commit `49faf2d`), serveur de production `dig.lodygames.com`
- **Méthode :** lecture seule. Je n'ai arrêté aucun service, n'ai rien déployé, n'ai écrit ni dans la base ni dans `.env`, nginx ou systemd, et n'ai généré aucune icône. La base de prod a été lue uniquement en mode `-readonly`. `server/test-season.js` a tourné sur une **copie** du code, dans un répertoire temporaire. Aucune valeur secrète ne figure dans ce rapport.

---

## 0. Résumé

DIG! est un jeu de minage par clics (« idle clicker ») **fonctionnel et jouable** : minage manuel et automatique, 14 matériaux, profondeur, économie, reliques, quêtes, missions quotidiennes, i18n FR/EN/NL, comptes, saisons et classement. Il tourne en production depuis le 12/10 sur le commit `49faf2d`, identique à `origin/main`, sans aucune divergence locale.

Il compte aujourd'hui **un seul compte joueur**. Ce n'est pas encore un jeu compétitif fiable.

1. **Le serveur fait entièrement confiance au client.** La profondeur, critère n°1 du classement, est acceptée telle quelle. Une seule requête suffit pour devenir premier.
2. **L'anti-autoclic serveur est inopérant en pratique.** Le client sauvegarde à **chaque clic**, et le contrôle est sauté quand deux sauvegardes sont espacées de moins de 3 s.
3. **Les coffres de la boutique de saison sont cassés pour les joueurs connectés.** La route renvoie toujours une erreur 500.
4. **Exploitation fragile :** aucune sauvegarde de la base, secret de session par défaut (public dans le dépôt), aucun test automatisé ni CI, script de déploiement sans sauvegarde ni retour arrière, dépendances vulnérables (1 critique, 1 haute).
5. **Les ligues se limitent à une promotion.** Il n'y a ni relégation ni spécification écrite, et une seule ligue existe en base. Les saisons tournent de façon « paresseuse », avec des trous et une saison déclarée active avant sa date de début.

**Prochaines actions recommandées, dans l'ordre :**
1. Sauvegarder la base et sécuriser les secrets : T-06, T-05.
2. Corriger les coffres (T-01) et la sauvegarde à chaque clic (T-03).
3. Mettre en place la validation serveur du classement (T-02) et les tests/CI (T-10).
4. Seulement ensuite : ligues, PWA, icônes et DIGORCH.

---

## 1. Cartographie technique

### 1.1 Stack

| Élément | Valeur |
|---|---|
| Runtime | Node.js v22.23.0 (`engines >= 18`) |
| Serveur | Express 4.22.2, `express-session` + `session-file-store`, `bcryptjs` |
| Base | SQLite via `better-sqlite3` 9.6 (mode WAL) : `server/data/dig.sqlite`, 112 Ko + WAL 4 Mo |
| Frontend | HTML/CSS/JS vanilla, 14 scripts globaux (pas de modules ni de bundler) ; `main.js` fait 1 912 lignes |
| Admin | `public/admin/` (statique), API `/api/admin/*` protégée par `Bearer ADMIN_SECRET` |
| Volume | environ 11 600 lignes (serveur environ 3 000, client environ 4 900, CSS 2 300) |

### 1.2 Déploiement et services

```
Internet ──443/TLS──► nginx (dig.lodygames.com, cert Let's Encrypt jusqu'au 20/01/2027)
                          └─► 127.0.0.1:3000  node server/index.js  (dig.service, User=ubuntu)
                                               └─► server/data/dig.sqlite (+ sessions/ en fichiers)
```

- **`dig.service`** : `Restart=always`, `NODE_ENV=production`, `PORT=3000`. **Aucun `EnvironmentFile`** et **pas de `.env`** dans `/home/ubuntu/Dig`.
- **Code servi :** la production tourne **directement depuis le clone Git `/home/ubuntu/Dig`**. Il n'y a pas d'environnement de développement ou de recette.
- **Écart prod / GitHub :** aucun. `HEAD` = `origin/main` = `49faf2d` (24/06), arbre propre, `/api/version` répond `1.0.0+49faf2d`. Le processus tourne depuis le 12/10.
- **Déploiement :** `~/update-dig.sh` (hors dépôt) enchaîne `git pull`, `npm install`, `systemctl set-environment COMMIT_HASH` et `restart`. Il ne fait **ni sauvegarde, ni `npm ci`, ni contrôle de santé, ni retour arrière**.
- **Écoute réseau :** Node écoute sur `*:3000` (toutes interfaces). Le port n'est pas joignable depuis Internet (filtré par le security group AWS), mais `ufw` est inactif. La protection repose donc uniquement sur le security group.
- **Hôte partagé** avec environ 10 autres services (Jury Central, LodyQuests, Kestrel…) : RAM de 3,8 Go dont environ 170 Mo libres, disque à 80 % (21 Go libres), journald 1,7 Go.

### 1.3 Données de production (lecture seule, `integrity_check = ok`)

| Table | Lignes | Remarque |
|---|---|---|
| users / user_saves | 1 / 1 | un seul compte |
| players / player_saves / save_events | 0 / 0 / 0 | API anonyme « legacy » non utilisée ; `save_events` vide (voir B1) |
| seasons | 6 | saisons 1 à 5 `closed`, saison 6 `active` (26/10 → 01/11) |
| leagues | 1 | Mimosa 🌼 |
| season_rankings | 3 | |
| anticheat_logs | 0 | voir B3 |
| admin_config | 14 | |

### 1.4 Logs, sauvegardes, sécurité de l'infrastructure

- **Logs :** journald uniquement. Une ligne `recordManualBreaks` **par clic** (421 lignes sur 554 depuis le 12/10, pour un seul joueur). On trouve aussi 11 piles d'erreur complètes `UnsupportedMediaTypeError: content encoding "br"`, probablement des scanners.
- **Sauvegardes :** **aucune.** Ni cron, ni timer, ni copie de `dig.sqlite`. `~/backups` ne contient rien de Dig.
- **Dépendances** (`npm audit --omit=dev`) : `proxy-addr` (**critique**), `body-parser` (**haute**, DoS), `qs` (moyenne). Toutes corrigeables par une mise à jour mineure d'Express 4.
- **En-têtes HTTP :** `X-Powered-By: Express` exposé ; pas de HSTS, de CSP ni de `X-Frame-Options`.
- **Git :** 6 PR fusionnées (mai à juin). Il ne reste que des branches distantes déjà fusionnées et seul `main` est actif. Le dépôt n'avait ni labels de priorité ni CI.

---

## 2. Inventaire fonctionnel

Légende : ✅ opérationnel · 🟡 partiel · 🔴 défectueux · ⚪ absent

| Fonction | État | Preuve / remarque |
|---|---|---|
| Minage manuel (clic / tactile) | ✅ | `main.js:1720-1781` |
| Minage automatique (idle) | ✅ | `autoDigTick` toutes les 1 s (`main.js:1746`, `upgrades.js:145`) |
| Matériaux | ✅ | 14 types (`blocks.js:8-133`), rendus en **emoji** sur un fond en dégradé CSS |
| Profondeur et difficulté | ✅ | +1 m par bloc ; PV ×(1+0,12·(d−1)), gain ×(1+0,05·(d−1)) (`blocks.js:166-172`) |
| Économie (pièces, gemmes, fragments) | ✅ côté client uniquement | `balance.js`, 6 améliorations (`upgrades.js`) ; rien n'est validé par le serveur |
| Reliques | ✅ | 6 reliques sur 5 niveaux (`relics.js`) |
| Coffres trouvés en minant | ✅ | `chests.js`, `main.js:1572` |
| **Coffres de la boutique de saison** | 🔴 | erreur 500 systématique une fois connecté (B1) |
| Collection | ✅ | 8 trouvailles (`collection.js`) |
| Quêtes | ✅ | 5 quêtes à usage unique |
| Missions quotidiennes | 🟡 | 3 par jour parmi 6 ; progression négative possible après un reset de saison (B8) |
| Récompense quotidienne | 🟡 | série de 7 jours sur l'horloge **de l'appareil**, donc falsifiable |
| Gains hors ligne | 🟡 | autodig seul, plafond de 4 h, horloge de l'appareil ; non recalculés après un chargement cloud |
| Sauvegarde locale | ✅ | localStorage v15 avec migrations (`save.js`) |
| Sauvegarde cloud | 🟡 | seulement si connecté ; envoyée **à chaque clic** ; conflits arbitrés sur `lastSaveTime` (« le dernier gagne ») |
| Comptes (inscription, connexion) | ✅ | bcrypt, session en cookie (7 jours) |
| Saisons | 🟡 | hebdomadaires, rotation paresseuse, trous, saison « active » avant son début (§4) |
| Ligues | 🟡 | promotion seulement, pas de relégation ; côté client, simple badge (§4) |
| Classement | 🟡 | affiché et fonctionnel, mais **falsifiable** (B2) |
| Anti-autoclic | 🔴 | client : mesures stockées mais jamais exploitées ; serveur : contourné par la sauvegarde à chaque clic (B3) |
| Publicités récompensées | 🟡 simulées | fausse modale de 5 s, aucun fournisseur (`monetization.js:91`) |
| Achats intégrés | 🔴 simulés | `_fakePurchase` donne gratuitement gemmes, skins et boosts, avec des prix affichés en € (B4) |
| i18n | ✅ | FR/EN/NL ; quelques chaînes restent en dur (B9) |
| Contrôle de version | 🟡 | vérifié seulement sur l'événement `focus` (au plus toutes les 5 min), jamais au chargement |
| Interface mobile | 🟡 | `100dvh`, `touch-action`, largeur max 440 px ; **pas de `viewport-fit=cover`**, donc marges sûres iOS inopérantes ; `user-scalable=no` |
| PWA (manifest, service worker, icônes) | ⚪ | absent |
| Accessibilité | ⚪ | bloc non jouable au clavier, pas de `prefers-reduced-motion` |
| Panel d'administration | 🟡 | complet (saisons, ligues, classements, config, logs anti-triche, joueurs, reset), mais **désactivé en prod** (`ADMIN_SECRET` non défini, l'API répond 503) et vulnérable à une XSS (B6) |
| API anonyme `/api/players/:token/*` | 🟡 morte | exposée mais jamais appelée ; écritures sur des requêtes GET |

---

## 3. Qualité, sécurité et anti-triche

### 3.1 Bugs avérés (reproduits ou vérifiés dans le code)

| # | Prio | Constat | Preuve |
|---|---|---|---|
| B1 | P0 | **Les coffres de la boutique renvoient toujours une erreur 500.** `logEvent(userId,'chest_shop_open')` viole `CHECK(event_type IN ('save','load','reset'))` et la clé étrangère vers `players` (l'id passé vient de `users`). L'erreur survient **après** l'écriture de la sauvegarde : le serveur a débité et crédité, le client affiche une erreur, puis sa sauvegarde suivante écrase l'état. Même bug dans le reset saisonnier admin. | `server/index.js:730-731`, `:853` ; `db.js:73` ; reproduit sur une copie du schéma (`SQLITE_CONSTRAINT_CHECK`) |
| B2 | P0 | **Le classement est falsifiable.** `seasonStats.maxDepth` est fourni par le client et enregistré via `MAX()` sans aucun contrôle ; l'anti-triche ne corrige que le critère de départage. | `seasons.js:374-377`, `db.js:576` |
| B3 | P0 | **Une sauvegarde cloud à chaque clic.** Conséquences : environ 8 requêtes SQLite et une ligne de log par clic, un toast « Sauvegardé » permanent, et surtout l'anti-autoclic serveur n'est jamais évalué (branche `Δt < 3 s`). Il est aussi contournable en envoyant `manualClicks` inchangé. | `main.js:1730-1743`, `:1881` ; `seasons.js:256-266` ; `anticheat_logs` = 0 |
| B4 | P1 | **Achats intégrés gratuits** (mode démo actif en production). | `monetization.js:186-193` |
| B5 | P1 | **Le reset saisonnier admin est écrasé par le client** : `lastSaveTime` n'est pas mis à jour, donc la sauvegarde locale gagne. | `main.js:1026`, `:1068` ; `index.js:833` |
| B6 | P1 | **XSS stockée dans l'admin.** Un e-mail malformé, accepté par `isValidEmail`, est affiché via `innerHTML` dans l'admin et peut voler la clé admin gardée en mémoire. Même schéma pour `log.username`. | `index.js:197`, `admin.js:571`, `:486` |
| B7 | P1 | **Saisons :** la saison suivante commence le **lundi suivant la clôture**, et la clôture n'arrive qu'à la première requête. Résultat : des semaines sans saison (par exemple du 12/10 au 25/10) et une saison `active` dont `start_at` est dans le futur, mais qui compte déjà les scores. | `seasons.js:176`, `:198-201` ; données de prod |
| B8 | P2 | **Le bonus Shard Magnet est ignoré par le serveur** (`data.relicBonuses` n'est jamais sauvegardé). | `chestShop.js:136` |
| B9 | P2 | `_syncAfterLogin` réécrit la sauvegarde locale **sans** `seasonStats` ni `shopChestsBought` (sérialisation dupliquée qui a dérivé). | `main.js:1028-1056` vs `save.js:38-68` |
| B10 | P2 | **`seed-test.js` écrit dans la base de production** (comptes à mot de passe connu, et `--close-season` clôt la vraie saison). | `seed-test.js:16-19` |
| B11 | P3 | Divers : nom de saison faux au seed (« Saison 4-2026 » pour la semaine 26) ; mission `depth_gain` négative ; chaînes FR codées en dur (`main.js:1219`, « HP ») ; `?page=abc` donne `NaN` ; `end_at` ISO avec `Z` donne une date invalide et une clôture immédiate ; `POST /api/admin/seasons` peut créer deux saisons actives ; `test-season.js` laisse des fichiers `-wal`/`-shm`. | |

### 3.2 Risques (pas de défaut visible aujourd'hui, mais exposés)

| Prio | Risque |
|---|---|
| P1 | **Aucune sauvegarde de la base**, déploiement sans retour arrière. |
| P1 | **`SESSION_SECRET` vaut la valeur par défaut publiée dans le dépôt**, ce qui permet de forger des cookies de session. Cookie sans `secure`, pas de `trust proxy`. |
| P1 | **Aucune limitation de débit** (login, inscription, sauvegardes). Brute force possible, et chaque essai coûte un calcul bcrypt. |
| P1 | **Dépendances vulnérables** (`proxy-addr` critique, `body-parser` haute). |
| P1 | **Toute l'économie est calculée côté client** (pièces, gemmes, reliques, coffres, quotidien, hors ligne). Une ligne de console suffit pour tricher. |
| P2 | Sauvegardes concurrentes sans numéro de version : une sauvegarde ancienne peut écraser une plus récente. |
| P2 | Déconnexion sans purge locale (un nouveau compte hérite de la progression) ; « Réinitialiser » efface aussi le cloud. |
| P2 | Paramètres d'admin morts : `upgrade_cost_multiplier`, `coin_gain_multiplier`, `season_duration`. Les coûts de coffre modifiés par l'admin ne sont pas reflétés dans l'interface. |
| P2 | API anonyme exposée : gonflement de la base possible, jetons dans l'URL donc dans les logs nginx. |
| P2 | Node écoute sur `0.0.0.0:3000` et `ufw` est inactif : une seule couche de filtrage. |
| P3 | Énumération des comptes (409 distincts), comparaison du secret admin non constante, `uncaughtException` avalé, `catch {}` silencieux sur la synchro du classement, `X-Powered-By`, piles d'erreur `br` dans journald. |

### 3.3 Tests et performance

- **Tests :** aucun `npm test`, aucune CI. `test-season.js` passe **62/62** sur une copie (rotation, promotion, tri, réduction du CPS), mais ne couvre ni les routes HTTP, ni les coffres, ni la sauvegarde.
- **Performance :** tout le SQLite est synchrone dans le chemin de la requête, et chaque clic produit un POST, la réécriture du blob complet et un recalcul du classement. Ça tient avec un joueur, pas avec N. Côté client, chaque clic déclenche environ 2 `innerHTML`, 6 `querySelector`, un `JSON.stringify` et une écriture localStorage.

---

## 4. Règles métier : saisons, ligues, classement

**Aucune spécification écrite n'existe** : pas de doc, et les tickets et PR sont vides. La comparaison se fait donc avec les commentaires du code et la description du ticket #6.

| Règle | Implémentation actuelle | Écart / question pour le propriétaire |
|---|---|---|
| Durée de saison | hebdomadaire (lundi → dimanche) ; `season_duration` est ignoré | Faut-il une durée paramétrable ? |
| Début / fin | clôture paresseuse au premier appel ; la saison suivante démarre au **lundi suivant** | Il faut un enchaînement sans trou, déclenché par un timer serveur. |
| Reset de fin de saison | **fait par le client** (pièces, profondeur, gemmes plafonnées à `gemsCap`) | Doit être fait par le serveur. Que conserve-t-on exactement ? |
| Récompenses de saison | **aucune** | À spécifier (par rang ou par ligue ?) |
| Ligues | créées à la volée ; promotion de `max(1, rate/(1+level×difficulty))` joueurs si la ligue compte au moins 10 actifs | **Pas de relégation.** Les champs `rank_min`/`rank_max` ne servent presque à rien. Avec un joueur, aucune promotion n'aura jamais lieu. |
| Classement | `max_depth DESC`, puis `effective_manual_blocks DESC`, filtré sur `manual_blocks > 0` ; pas de 3e critère | Ex-aequo non déterministes ; index sur la mauvaise colonne ; valeurs fournies par le client. |
| Manuel vs automatique | c'est le client qui classe chaque clic ; un clic « suspect » compte comme automatique | La classification doit se faire côté serveur. |
| Anti-autoclic | client : CPS sur 3 s et régularité ; serveur : Δclics/Δt entre deux sauvegardes, réduction au-delà de 8 CPS | Inopérant (B3) ; `suspiciousScore` n'est pas utilisé. |

👉 **Prérequis du ticket T-12 :** une spec rédigée et validée par le propriétaire (durée, récompenses, relégation, critères de départage).

---

## 5. Orchestration : étude DIGORCH

**Modèle existant.** LQORCH et JCORCH sont un même script Python (`lqorch.py`, bibliothèque standard uniquement). Il tourne en service systemd, garde son état en SQLite (tickets, sessions, événements, contrôle) et lance `claude -p` en sous-processus, **sans tmux** : les sessions tmux présentes sur la machine sont interactives. Les règles de branche, PR et déploiement sont dans le prompt (`session_prompt.md`), pas dans le code.

Garde-fous : plafond de sessions par jour, pause selon le quota, disjoncteur après échecs, 3 tentatives maximum, délai croissant après échec, verrou `flock`, `stop`/`resume`.

**JCORCH** est la meilleure base : configurable par `instance.env`, synchronisation GitHub (labels `P0–P3`, dépendances, labels `statut: …`), reprise du ticket sur réponse du propriétaire, notifications SMTP via le fichier partagé de PlugAdmin (mode 600, lu sur place, jamais copié).

**Proposition (non exécutée) :**
1. Créer les labels `P0–P3` et `statut: …` sur `ReC82/Dig`, et ajouter un `CLAUDE.md` au dépôt : architecture, interdits, « `/home/ubuntu/Dig` = PRODUCTION ».
2. Créer `/opt/dig-orch/` à partir de JCORCH. Paramétrer `instance.env` : `LQ_REPO=ReC82/Dig`, `LQ_LAUNCH_DIR=/home/ubuntu/Dig`, `LQ_WORKDIR=/home/ubuntu/dig-worktrees`, `LQ_STATE_DIR=~/.local/state/dig-orch`, `LQ_SERVICE=dig-orch`, marqueur `<!-- digorch -->`, préfixe `[Dig]`. Rendre paramétrables les libellés codés en dur (`STATUS_LABELS`, « Jury Central »).
3. Prompt Dig : Node/Express ; tests sur un **autre port avec une base temporaire** ; interdiction de toucher à `server/data/`, `.env`, nginx, systemd et `update-dig.sh`.
4. **Mode de livraison recommandé au départ : jusqu'à la PR seulement.** Le propriétaire fusionne et déploie. Plus tard, éventuellement, un mode « installation » sur le modèle JCORCH : arbre propre, `sqlite3 .backup`, `merge --ff-only`, `npm ci`, redémarrage, contrôle de santé, retour arrière.
5. Démarrage prudent : 4 sessions par jour maximum, 2 h par session, service lancé en `pause`, puis un premier ticket test.
6. Partager le suivi de quota (`LQ_SHARED_USAGE_DBS`) entre les trois superviseurs.

**Risques :**
- Trois superviseurs se partagent le même compte Claude et le même quota.
- La machine a peu de RAM disponible.
- Il n'y a pas d'environnement de développement pour Dig.
- Les sessions tournent avec `--dangerously-skip-permissions` sous un utilisateur qui a `sudo` sans mot de passe : seul le prompt protège la production.
- Les commentaires GitHub sont un canal d'instructions : il faut garder le filtre sur les auteurs de confiance.
- Il y aura trois copies divergentes de `lqorch.py`.

👉 **Prérequis :** T-06 (sauvegardes) et T-10 (tests et CI) avant d'activer DIGORCH.

---

## 6. Icônes de matériaux : étude de l'API OpenAI

**Existant.** Dig n'utilise aucune API d'IA. Jury Central utilise déjà l'API Images d'OpenAI côté serveur (`POST /v1/images/generations` et `/v1/images/edits` avec images de référence, réponse en `b64_json`). Sa clé est dans `/srv/jury-central/.env`.

⚠️ Ce fichier est en mode **664**, donc lisible par tous les utilisateurs de la machine : à corriger dans ce projet-là (non touché ici).

**Rendu actuel.** Uniquement des emoji. Le bloc fait 170×170 px avec un `border-radius` de 20 px, un fond en dégradé `type.color` et des fissures en `::after`. Les blocs **n'ont pas d'`id` stable** (la clé est déduite du `name`).

À couvrir :
- 14 matériaux : terre meuble, argile, pierre, grès, granite, charbon, fer, or, vieille caisse, coffre en bois, coffre en fer, rubis, émeraude, diamant ;
- 8 trouvailles ;
- 6 reliques ;
- 3 coffres de boutique.

Soit environ **31 icônes**.

**Architecture proposée :**
- **Génération hors ligne**, par un script `tools/gen-icons.js` lancé à la main. Pas d'appel à l'API au moment du jeu. **La clé ne passe jamais côté client.**
- **Clé dédiée à Dig**, avec un plafond de dépense, dans un `EnvironmentFile` en mode 600 hors du dépôt. Ne pas réutiliser le `.env` de Jury Central.
- **Style constant :**
  - un gabarit de prompt unique : vue de face, cadrage centré, fond uni, palette imposée, éclairage en haut à gauche ;
  - une ou deux icônes validées servent d'**images de référence** via `/v1/images/edits`, pour garder le même style ;
  - génération en 1024×1024.
- **Post-traitement déterministe** (avec `sharp`) : recadrage carré, **coins arrondis appliqués par masque** (pas laissés au modèle), export WebP en 256 et 128 px, mêmes marges pour toutes les icônes.
- **Versionnement et cache :**
  - fichiers dans `public/assets/materials/v1/<id>.<hash>.webp` ;
  - `manifest.json` qui consigne l'id, le modèle, le prompt, le hash et la date ;
  - `Cache-Control: immutable` ;
  - repli sur l'emoji si l'image manque ;
  - ajout de champs `id` et `sprite` dans `blocks.js`.
- **Coût :** environ 31 icônes × 2 à 4 essais, soit une centaine d'images au plus. L'ordre de grandeur est de quelques dollars à quelques dizaines de dollars selon le modèle et la qualité. Le tarif exact est à vérifier sur la grille OpenAI en vigueur au moment de lancer.
- **Processus imposé par le ticket :**
  1. le propriétaire fournit une **capture d'écran** du jeu ;
  2. on fait **2 ou 3 essais de style** (pierre, charbon, diamant) ;
  3. le propriétaire valide ;
  4. seulement alors, génération du lot.

  **Rien n'a été généré dans le cadre de cet audit.**

---

## 7. Feuille de route : tickets proposés

Chaque ticket est indépendant sauf dépendance indiquée. Procédure de test commune : lancer le serveur du worktree avec `PORT=3100 DB_FILE=dig_test.sqlite`, **jamais** sur `server/data/dig.sqlite` ni sur le port 3000.

### P0 : bloquant pour un jeu compétitif

**T-01 — Corriger l'achat de coffres en boutique (erreur 500)** (B1)
- Ajouter une table `user_events` (ou étendre le CHECK et retirer la FK) pour journaliser les événements liés aux `users`.
- Faire l'écriture de la sauvegarde et la journalisation **dans une même transaction**.
- Corriger aussi le reset saisonnier admin.
- *Critères :* l'ouverture d'un coffre renvoie 200 ; pièces débitées et récompense créditée en base ; un événement journalisé ; aucun 500 sur 3 types de coffre × 2 cas (solde suffisant / insuffisant).
- *Test :* script HTTP sur une base temporaire (inscription → injection d'une sauvegarde → ouverture × 3).

**T-02 — Validation serveur du classement** (B2)
- Plafonner la profondeur acceptée selon le temps écoulé et le nombre de blocs depuis la dernière sauvegarde (Δprofondeur ≤ Δblocs, Δblocs ≤ CPS max × Δt + autodig).
- Rejeter ou journaliser dans `anticheat_logs` ce qui dépasse.
- Offrir à l'admin un outil pour corriger une ligne du classement.
- *Critères :* un POST avec `maxDepth: 1e9` ne change pas le classement et crée une entrée anti-triche ; un jeu normal n'est pas pénalisé.
- *Test :* tests unitaires sur `processAntiCheat` et la plausibilité de la profondeur, plus un scénario HTTP.

**T-03 — Regrouper les sauvegardes cloud (fin de la sauvegarde à chaque clic)** (B3)
- Sauvegarde locale à chaque clic si besoin, mais cloud au plus toutes les 10 à 15 s, et au `visibilitychange`/`pagehide` (`sendBeacon`).
- Côté serveur : ne plus sauter le contrôle CPS quand Δt < 3 s mais **cumuler**, refuser Δclics = 0 avec Δblocs > 0, et supprimer le log par clic.
- *Critères :* au plus 1 POST par 10 s en jeu continu ; l'anti-autoclic produit des entrées quand le CPS dépasse 8 ; aucune perte de progression en fermant l'onglet.
- *Test :* onglet Réseau des outils de développement, plus un auto-clicker à 20 CPS sur l'environnement de test.

### P1 : sécurité, exploitation, intégrité

**T-04 — Désactiver les achats intégrés simulés** (B4)
- Masquer la boutique payante, ou afficher clairement « démo » sans rien créditer, tant qu'il n'y a pas de fournisseur de paiement.
- *Critères :* aucun crédit de gemmes, skins ou boosts sans paiement réel.

**T-05 — Secrets et durcissement HTTP**
- Créer un `EnvironmentFile` (mode 600) pour `SESSION_SECRET` et éventuellement `ADMIN_SECRET`. **Action du propriétaire sur le serveur.**
- Refuser de démarrer en production sans secret.
- `app.set('trust proxy', 1)`, cookie `secure`, Node lié à `127.0.0.1`, désactiver `x-powered-by`, ajouter HSTS.
- Mettre à jour Express 4.x pour corriger `proxy-addr`, `body-parser` et `qs`.
- *Critères :* `npm audit --omit=dev` ne remonte plus de vulnérabilité haute ou critique ; le serveur refuse de démarrer sans secret ; le cookie porte `Secure`.
- *Note :* changer le secret déconnecte les sessions existantes (une seule aujourd'hui).

**T-06 — Sauvegardes de la base et déploiement sûr**
- Timer systemd qui lance `sqlite3 dig.sqlite ".backup …"` chaque jour, avec une rotation de 14 jours et une copie hors machine si possible.
- Versionner un script de déploiement dans le dépôt : sauvegarde → `git pull --ff-only` → `npm ci` → redémarrage → contrôle `/health` et `/api/version` → retour arrière si échec.
- *Critères :* une sauvegarde par jour, restauration testée sur une copie ; le déploiement échoue proprement si le contrôle de santé échoue.

**T-07 — Limitation de débit et API morte**
- Ajouter `express-rate-limit` sur login, inscription et sauvegardes.
- Supprimer ou désactiver `/api/players/:token/*`.
- Messages d'erreur neutres à l'inscription.
- *Critères :* 429 au-delà de N tentatives de connexion par minute et par IP ; les routes legacy renvoient 404.

**T-08 — Corriger la XSS de l'admin** (B6)
- Échapper toutes les données utilisateur dans `admin.js` et `main.js` (`textContent`).
- Durcir `isValidEmail`.
- *Critères :* un e-mail `<img src=x onerror=…>@a.io` est refusé, et s'affiche comme du texte s'il existe déjà.

**T-09 — Saisons continues et rotation planifiée** (B7, B11 pour la partie saisons)
- Timer serveur (vérification toutes les minutes) ; la saison N+1 commence à `end_at` de N, sans trou.
- `start_at` respecté avant de compter les scores ; nom de saison = numéro de semaine ISO correct ; impossible d'avoir deux saisons actives ; dates ISO normalisées.
- *Critères :* simulation sur 3 semaines avec une horloge simulée (fake timers) → 3 saisons contiguës, aucun score compté hors période.

**T-10 — Tests automatisés et CI**
- `npm test` qui couvre `test-season.js` et de nouveaux tests HTTP (supertest).
- `seed-test.js` refuse de tourner sur `dig.sqlite` ; nettoyage des fichiers `-wal`/`-shm` ; GitHub Actions sur les PR.
- *Critères :* CI verte sur `main` ; `seed-test.js` sans `DB_FILE` se termine en erreur.

**T-11 — Cohérence des sauvegardes client/serveur** (B5, B9, risques P2)
- Champ `revision` incrémenté par le serveur, avec rejet ou fusion des sauvegardes obsolètes.
- Le reset admin incrémente cette révision.
- Sérialisation unique (`save.js`).
- Purge locale à la déconnexion.
- *Critères :* un reset admin est conservé après la synchro suivante ; deux onglets ne s'écrasent pas en silence ; la déconnexion puis l'inscription d'un nouveau compte part d'une sauvegarde vierge.

### P2 : règles métier et produit

**T-12 — Spécification et implémentation des ligues et récompenses** (§4)
- *Dépend de :* une spec validée par le propriétaire.
- Contenu : relégation, récompenses de fin de saison côté serveur, 3e critère de départage (date d'atteinte, puis id), index sur la colonne de tri, reset de saison fait par le serveur.
- *Critères :* tests de promotion et relégation sur 3 ligues × 30 joueurs simulés.

**T-13 — Paramètres économiques effectifs**
- Appliquer ou supprimer `upgrade_cost_multiplier`, `coin_gain_multiplier` et `season_duration`.
- Exposer les coûts de coffre au client via l'API.
- Sauvegarder `relicBonuses` ou le recalculer côté serveur (B8).
- *Critères :* un changement dans l'admin a un effet visible dans le jeu sans redéploiement.

**T-14 — Mobile, PWA et accessibilité**
- `viewport-fit=cover` et marges sûres haut et bas.
- Manifest, service worker (cache des fichiers statiques versionnés), icônes, `theme-color`.
- Bloc jouable au clavier, `prefers-reduced-motion`, contrôle de version au chargement.
- *Critères :* Lighthouse « installable » ; affichage correct sur iPhone avec encoche ; jouable avec la barre d'espace.

**T-15 — Bibliothèque d'icônes de matériaux** (§6)
- *Dépend de :* capture d'écran et validation de 2 ou 3 essais de style.
- Étape 1 : ajouter `id` et `sprite` aux données, avec repli sur l'emoji. Étape 2 : script de génération et manifest. Étape 3 : génération du lot.
- *Critères :* 31 icônes de même taille, cadrage et palette ; `manifest.json` versionné ; aucune clé côté client ni dans le dépôt.

**T-16 — Installer DIGORCH** (§5)
- *Dépend de :* T-06 et T-10.
- *Critères :* le service `dig-orch` démarre en pause ; un ticket test va jusqu'à une PR sans toucher à `/home/ubuntu/Dig` ; un e-mail de compte rendu est reçu.

### P3 : finitions

**T-17 — Nettoyage divers** (B11, risques P3)
- Chaînes i18n codées en dur, mission `depth_gain` négative, pagination `NaN`.
- Comparaison admin en temps constant, `uncaughtException` qui fait sortir le processus (systemd redémarre), journalisation de l'erreur silencieuse de synchro du classement, logs `br` en une ligne.
- Mettre à jour le README (routes et tables actuelles).

---

## 8. Ce qui n'a pas été fait (volontairement)

- Aucune correction, migration, mise à jour de dépendances (`npm audit fix` non lancé) ni redémarrage.
- Aucune icône générée, aucun appel à OpenAI.
- Aucune installation de DIGORCH ; aucune modification des projets LodyQuests ou Jury Central (y compris les droits du `.env` de Jury Central).
- Les tickets ci-dessus sont **proposés**, pas créés : à valider par le propriétaire avant ouverture.
