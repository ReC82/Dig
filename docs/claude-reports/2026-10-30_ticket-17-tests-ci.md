# Ticket #17 — [P1] T-10 — Mettre en place tests automatisés et CI

- Ticket : https://github.com/ReC82/Dig/issues/17
- Source : audit général #6, partie « Tests et performance », bug B10 et fichiers `-wal`/`-shm` de B11 (`docs/claude-reports/2026-10-29-2130-audit-general-dig.md`)
- Session du 30 octobre 2026

## 1. État réel

**Intégré dans develop, en attente de validation et de déploiement.** Rien n'est déployé : `main` et la production n'ont pas bougé.

## 2. Résultat

Avant ce ticket, `develop` avait déjà une commande `npm test`, ajoutée au fil des tickets #8 à #16 : 89 tests, avec des serveurs HTTP de test sur des bases temporaires. Il manquait :

- une **intégration continue** : aucun workflow GitHub Actions ;
- un **garde-fou** sur `server/seed-test.js`. Lancé sans précaution, ce script écrivait dans `server/data/dig.sqlite`, la base des joueurs. Il y créait des comptes au mot de passe connu, et `--close-season` clôturait la vraie saison (audit B10) ;
- les 62 contrôles historiques de `server/test-season.js`, qui **n'étaient pas lancés par `npm test`**. Ce script créait en plus sa base dans `server/data/` et y laissait des fichiers `-wal` et `-shm` ;
- l'**isolation des sessions** : les serveurs de test écrivaient leurs sessions dans `server/data/sessions/`. Lancé depuis le dossier de production, `npm test` aurait donc écrit dans le dossier des sessions réelles ;
- la **stabilité** : un test de #14 (limitation des connexions) échouait au hasard, environ une exécution complète sur trois sur cette machine. Sur GitHub Actions, `test/rate-limit.test.js` s'est en plus **figé** deux fois sur quatre, après le test 62, jusqu'à l'annulation de la tâche.

Après ce ticket :

- **GitHub Actions** (`.github/workflows/ci.yml`) lance `npm ci`, puis `npm run check` (syntaxe de tous les `.js`), puis `npm test`, avec Node 22, la version de production. Il tourne à chaque push, sur toutes les branches, à chaque Pull Request vers `main` ou `develop`, et à la demande. Aucun secret n'est nécessaire et les droits sont en lecture seule.
- **`seed-test.js` refuse de tourner** (code de sortie 2, rien n'est créé) dans trois cas :
  - sans `DB_FILE` dans l'environnement de la commande ;
  - quand le fichier visé s'appelle `dig.sqlite`, quel que soit le chemin ou la casse ;
  - quand `DB_FILE` n'est défini que dans `.env`. Le contrôle a lieu avant le chargement de `.env`.
- **`seed-test.js` ferme proprement la base** à la sortie : plus de `-wal` ni de `-shm` résiduels.
- **`test-season.js` travaille dans un dossier temporaire** (`os.tmpdir()`), supprimé en entier à la sortie : base, `-wal` et `-shm`. Il est lancé par `npm test` via `test/tooling.test.js`, qui vérifie aussi qu'il n'a rien écrit dans `server/data/`.
- **Nouvelle variable `SESSIONS_DIR`** pour le serveur : c'est un chemin absolu ou relatif à `server/data/`. Sa valeur par défaut, `sessions`, garde le comportement actuel. Tous les serveurs de test l'utilisent pour écrire leurs sessions dans leur dossier temporaire.
- **`npm test` = 95 tests** : les 89 existants plus 6 nouveaux.
- **Le test instable de #14 est stabilisé.** Le test enchaînait des connexions réussies alors que le serveur retire leur décompte un peu après l'envoi de la réponse (événement « finish »). Il lit maintenant la réponse et laisse 100 ms entre deux connexions. Le code de production n'est pas modifié.
- **Un blocage ne peut plus figer la CI** :
  - chaque requête de `rate-limit.test.js` a un délai maximal de 10 s ;
  - l'arrêt d'un serveur de test passe à `SIGKILL` au bout de 5 s ;
  - chaque test a un délai maximal de 120 s (`--test-timeout`) ;
  - l'étape de tests de la CI est limitée à 8 min.

  Je n'ai pas identifié la cause exacte de ces blocages : ils ne se reproduisent pas sur cette machine, où le fichier a passé 12 exécutions de suite. Après ces changements, la CI est passée 3 fois de suite. Si un blocage revient, il apparaîtra comme un échec nommé, avec son message, au lieu d'une annulation sans journal.

### Changements

| Fichier | Changement |
|---|---|
| `.github/workflows/ci.yml` (nouveau) | Workflow CI : checkout complet (`test/deploy.test.js` clone le dépôt), Node 22 avec cache npm, `npm ci`, `npm run check`, `npm test`. Délai maximal de 15 min pour la tâche, 8 min pour les tests. Un nouveau push annule l'exécution en cours sur la même branche. |
| `server/testDbGuard.js` (nouveau) | `resolveTestDbPath(env, dataDir)` : `DB_FILE` est obligatoire et `dig.sqlite` est refusé. |
| `server/seed-test.js` | Garde-fou appelé avant `dotenv`, sortie 2 avec un message clair. Fermeture de la base à la sortie. Usage mis à jour. |
| `server/test-season.js` | Base dans `os.tmpdir()`, fermeture de la base, puis suppression du dossier entier. |
| `server/index.js` | Dossier des sessions configurable par `SESSIONS_DIR`, avec `sessions` par défaut. Aucun changement en production. |
| `test/tooling.test.js` (nouveau) | 6 tests : `resolveTestDbPath`, les refus de `seed-test.js` (4 modes × 3 configurations), le refus d'un `DB_FILE` venu de `.env`, un cycle seed / `--check` / `--clean` sur une base temporaire sans `-wal`/`-shm`, `test-season.js` (62/62, aucun fichier laissé), et les sessions écrites dans `SESSIONS_DIR`. Port 3117. |
| `test/*.test.js` (7 fichiers) | Ajout de `SESSIONS_DIR` (dossier temporaire) aux serveurs de test. `rate-limit.test.js` : stabilisation, délais par requête et arrêt forcé, décrits plus haut. |
| `package.json` | `npm test` passe `test/*.test.js` au shell au lieu d'un motif entre guillemets, avec `--test-timeout=120000`. Nouveau script `npm run check` : `node --check` sur chaque `.js` suivi par git. |
| `.gitignore` | Ajout de `*.sqlite-wal` et `*.sqlite-shm`. |
| `docs/OPERATIONS.md`, `README.md` | Section « Tests » : commandes, ports, isolation, CI, usage sûr de `seed-test.js`. Variable `SESSIONS_DIR`. |

## 3. SHA, branche et procédure de test

- **SHA sur `develop` : `36d1e59`**, code complet et rapport, avec une CI verte : https://github.com/ReC82/Dig/actions/runs/40980342952. La première fusion, `3276106`, n'avait pas encore les délais maximaux, et sa CI s'était figée. Une dernière fusion n'ajoute que la mise à jour de cette ligne.
- Branche : `feature/17-tests-ci`.
- CI GitHub Actions verte : https://github.com/ReC82/Dig/actions/workflows/ci.yml

Procédure (dans une copie de travail, **pas** dans `/home/ubuntu/Dig`) :

```bash
npm ci
npm run check          # aucune sortie d'erreur
npm test               # « # tests 95 / # pass 95 / # fail 0 », environ 1 min

# Garde-fou
node server/seed-test.js                         # → « DB_FILE absent … », code 2
DB_FILE=dig.sqlite node server/seed-test.js      # → « … base de production … refusé », code 2
DB_FILE=/tmp/dig-seed.sqlite node server/seed-test.js && \
DB_FILE=/tmp/dig-seed.sqlite node server/seed-test.js --check   # classement de 8 joueurs fictifs
rm -f /tmp/dig-seed.sqlite

# Historique des saisons
node server/test-season.js     # « Tous les tests passent (62/62) », rien laissé dans server/data/ ni /tmp
```

Sur GitHub : l'onglet *Actions* doit afficher « CI » en vert pour `develop`. Le workflow se relance aussi depuis cet onglet (« Run workflow »).

## 4. Vérifications

Effectuées :

- `npm test` sur la branche : 95/95, deux fois. Sur `develop` fusionné en local : 95/95, **trois fois de suite**.
- `node --test test/rate-limit.test.js` six fois de suite après la stabilisation : 0 échec. Avant, la suite complète avait échoué 2 fois sur 5 sur ce test.
- `npm run check` : tous les `.js` suivis sont valides.
- CI GitHub Actions sur la branche (Node 22) : 95 tests, 95 réussis, 0 ignoré. La CI est verte sur les trois dernières exécutions de la branche (push et deux relances manuelles) ; deux exécutions antérieures, sans les délais maximaux, s'étaient figées dans `rate-limit.test.js`. CI sur `develop` (`36d1e59`) : verte.
- Après `npm test`, `server/data/` de la copie de travail reste vide : ni base, ni session.
- Aucune commande n'a visé `/home/ubuntu/Dig`, sa base, le port 3000 ou `dig.service`. Tous les serveurs de test tournaient sur les ports 3105 à 3117 et ont été arrêtés par les tests.

Non effectuées et limites :

- **Node 20 n'est pas couvert par la CI.** Il est en fin de vie depuis avril 2026, et `sharp`, l'outil des icônes, demande déjà Node ≥ 20.9. La CI teste donc Node 22 seul, la version de production. Au premier essai, la tâche Node 20 s'était figée au même endroit que Node 22 plus tard, le blocage de `rate-limit.test.js` décrit au point 2 : ce blocage ne vient donc pas de Node 20. `package.json` indique toujours `"node": ">=18.0.0"` : voir la question 2.
- **Les tests ne couvrent pas le navigateur** (pas de test d'interface sur `public/js`), seulement la syntaxe.
- **Pas de couverture de code mesurée.**
- La CI ne lance **pas `npm audit`**, pour ne pas la bloquer sur des vulnérabilités qui relèvent d'un autre ticket.
- **La protection de `main` n'est pas activée.** Il s'agit de rendre la CI obligatoire avant fusion dans les réglages du dépôt, ce qui est hors de mes autorisations : voir la question 1.

Impact sur les données des joueurs : **aucun**. Aucune migration et aucun changement de schéma. Le seul changement d'exécution en production est la lecture facultative de `SESSIONS_DIR`. Sans cette variable, les sessions restent dans `server/data/sessions/` et les joueurs connectés le restent.

## 5. Procédure de déploiement proposée

Ce ticket ne change presque rien à l'exécution du jeu, et il peut partir avec le lot de `develop` (voir le plan groupé de #13, `docs/claude-reports/2026-10-29_ticket-13-sauvegardes-deploiement.md`).

1. Sauvegarde : `sqlite3 /home/ubuntu/Dig/server/data/dig.sqlite ".backup /home/ubuntu/backups/dig-$(date +%F-%H%M).sqlite"`, ou `npm run backup` si #13 est déjà installé.
2. Fusion de `develop` dans `main` (PR ou fusion locale), puis la procédure habituelle : `git pull --ff-only`, `npm ci --omit=dev`, redémarrage de `dig.service`.
3. Vérifications : `curl -fsS http://127.0.0.1:3000/health`, une connexion joueur qui reste active après le redémarrage (les sessions n'ont pas bougé), et la CI verte sur `main` dans l'onglet *Actions*.
4. Retour arrière : `git checkout <commit précédent>`, `npm ci --omit=dev`, redémarrage. Aucune donnée n'est à restaurer.

## 6. Choix techniques faits seul

- **`node:test` (natif) et `fetch` plutôt que supertest**, comme les 89 tests existants : aucune dépendance de plus, et ce sont de vrais serveurs lancés comme en production.
- **Garde-fou par nom de fichier (`dig.sqlite`) et `DB_FILE` obligatoire**, plutôt que des chemins absolus de la machine : la règle est simple, portable, et elle couvre `/home/ubuntu/Dig/server/data/dig.sqlite` comme toute copie du dépôt.
- **Contrôle avant `dotenv`** : un `.env` de production qui définirait `DB_FILE` ne doit pas pouvoir autoriser le script.
- **CI déclenchée sur toutes les branches** : chaque ticket a sa CI dès le premier push, sans attendre une PR, ce qui convient au mode de travail de DIGORCH (fusion directe dans `develop`).
- **Node 22 seul**, pour les raisons données au point 4. Actions `checkout` et `setup-node` en v5, pour éviter l'avertissement de dépréciation de Node 20 côté GitHub.
- **Correction du test instable dans le test seulement** : le comportement du limiteur reste correct pour des joueurs réels, car une connexion réussie n'est jamais refusée en temps normal.

## 7. Décisions demandées au propriétaire

1. **Rendre la CI obligatoire avant fusion dans `main`** (Settings → Branches → règle de protection de `main` → « Require status checks to pass » → cocher « Tests (Node 22) »). Options : (a) l'activer, (b) laisser la CI indicative. **Recommandation : (a)**, à faire par vous, puisque je n'ai pas le droit de modifier les réglages du dépôt.
2. **Version de Node déclarée** : `package.json` annonce `>=18.0.0`, mais seule la 22 est testée. Options : (a) passer à `>=22` (petit ticket T-17), (b) laisser tel quel. **Recommandation : (a)**, sans urgence.

Aucune autre décision n'est nécessaire pour ce ticket.

## 8. Restant à réaliser (propositions, hors périmètre)

- Tests d'interface du client (`public/js`), par exemple avec Playwright, pour les parcours clés : inscription, sauvegarde, coffres.
- Mesure de couverture (`node --test --experimental-test-coverage`).
- Une tâche CI `npm audit --omit=dev`, informative, une fois les dépendances vulnérables traitées.
- Activer la protection de branche (question 1).
