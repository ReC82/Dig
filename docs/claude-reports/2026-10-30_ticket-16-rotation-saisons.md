# Ticket #16 — [P1] T-09 — Rotation continue des saisons

- Ticket : https://github.com/ReC82/Dig/issues/16
- Source : audit général #6, bug B7 et partie « saisons » de B11 (`docs/claude-reports/2026-10-29-2130-audit-general-dig.md`)
- Session du 30 octobre 2026

## 1. État réel

**Intégré dans develop, en attente de validation et de déploiement.** Rien n'est déployé : `main` et la production n'ont pas bougé.

## 2. Résultat

Avant la correction :

- La rotation était « paresseuse » : une saison ne se fermait qu'à la première requête reçue après sa fin.
- La saison suivante démarrait au **lundi suivant la clôture**. En production, cela a laissé des semaines sans saison (par exemple entre la saison 41 et la saison 44).
- Une saison pouvait être `active` alors que sa date de début était dans le futur, et elle comptait quand même des scores.
- Le numéro de semaine était faux (« Saison 4-2026 » pour la semaine 26).
- Une date `end_at` au format ISO avec `Z` provoquait une clôture immédiate.
- L'admin pouvait créer deux saisons actives.

Après la correction :

- **Le serveur fait la rotation lui-même**, au démarrage puis chaque minute.
- **La saison N+1 commence à `end_at` de N + 1 seconde**, donc sans trou : la saison du lundi 00:00:00 au dimanche 23:59:59 UTC est suivie de la semaine suivante.
- Si le serveur a été arrêté plusieurs semaines, il rattrape **semaine par semaine** : chaque semaine a sa propre saison, éventuellement vide, et l'historique reste contigu.
- **Aucun score n'est compté hors de la période de la saison** (avant `start_at` ou après `end_at`).
- **Il ne peut y avoir qu'une saison active**, avec deux protections : un index unique partiel en base et un refus 409 dans l'API admin.
- **Les noms suivent la semaine ISO 8601 correcte** (« Saison 45-2026 »).
- **Les dates sont normalisées** au format `YYYY-MM-DD HH:MM:SS` UTC.

Pour le joueur, rien ne change pendant une saison. Dans la minute qui suit dimanche 23:59:59 UTC, la nouvelle saison est ouverte. Le client la détecte, comme avant, par le changement d'identifiant : le sondage passe toutes les 5 minutes ou à la prochaine ouverture de la vue Saison.

### Changements

| Fichier | Changement |
|---|---|
| `server/seasonCalendar.js` (nouveau) | Module pur : `isoWeek` (semaine et année ISO), `weekBounds`, `seasonName`, `nextSeasonPeriod` (fin + 1 s → dimanche 23:59:59 ; si la saison durerait moins de 24 h, elle absorbe la semaine suivante), `parseUtc` et `normalizeDate` (accepte espace ou `T`, `Z`, décalage `+HH:MM` ; refuse les dates impossibles), `endBefore`. |
| `server/seasons.js` | `checkAndRotateSeason(now)` : boucle de rattrapage, idempotente, plafonnée à 520 saisons par passe. Avec un `end_at` illisible, la saison n'est plus clôturée « par erreur » : un avertissement est journalisé. `closeActiveSeason(id, now)` : promotions inchangées ; en cas de clôture anticipée, la fin effective devient l'instant de clôture (la date prévue est conservée dans `config.plannedEndAt`) et la suivante commence aussitôt. `_openNextSeason` : enchaînement, prise en compte d'une saison programmée par l'admin, nom unique (`· 2` en cas de clôture anticipée dans la même semaine). `isWithinSeason`. `startSeasonScheduler` et `stopSeasonScheduler` (timer d'une minute, `unref`). `syncPlayerRanking` ignore toute sauvegarde hors période. |
| `server/db.js` | Seed (base vierge uniquement) : semaine ISO courante avec un nom correct. Index `idx_seasons_one_active` : `CREATE UNIQUE INDEX IF NOT EXISTS … ON seasons(status) WHERE status='active'`, créé seulement s'il y a au plus une saison active (sinon un avertissement est journalisé, aucune donnée n'est modifiée). `createSeason(…, status)`, `getNextScheduledSeason`, `getLastEndedSeason`, `seasonNameExists`. |
| `server/index.js` | Lancement du planificateur après `initDb()`. `POST /api/admin/seasons` : dates normalisées (400 si invalides ou si la fin précède le début) ; début futur → `scheduled` ; 409 si une saison est déjà active. `PUT /api/admin/seasons/:id` : 404 si la saison est inconnue, dates normalisées, statut contrôlé, 409 en cas de seconde saison active ; une clôture manuelle (`status: closed`) ramène `end_at` à l'instant présent pour que la suivante s'ouvre sans trou. |
| `test/season-rotation.test.js` (nouveau) | 12 tests, détaillés en section 4. |
| `test/anticheat.test.js`, `test/ranking-depth.test.js` | Leur saison de test est créée `closed` : la saison active est celle du seed, à cause de l'index d'unicité. |

## 3. Références

- **SHA sur `develop` : `7b0c6be5e41aa7ab70c9cee0634f5ff802fb37af`** (fusion `--no-ff`), commit du correctif `2b893e4`.
- Branche : `fix/16-rotation-saisons`.

## 4. Procédure de test

### Tests automatisés

```bash
npm ci
node --test test/season-rotation.test.js   # 12/12 — port 3116, bases temporaires dans /tmp
npm test                                    # suite complète
node server/test-season.js                  # 62/62 (ancien script ; laisse des -wal/-shm dans server/data/, cf. B11)
```

Ce que couvre `test/season-rotation.test.js` :

1. **Semaines ISO**, y compris aux changements d'année : 2026-W53, le 3 janvier 2027 encore en 2026-W53, le 30 décembre 2024 déjà en 2025-W01, et le 22 juin 2026 en semaine 26.
2. **Dates** : `…Z`, `.000Z`, `+01:00` et date seule sont acceptés ; `demain`, le 31 février et 25:00 sont refusés.
3. **Rotation sur 3 semaines avec horloge simulée** (`mock.timers` sur `setInterval` et `Date`, une tick par minute, départ le mercredi 4 novembre 2026). À chaque minute : exactement une saison active, et elle contient l'instant présent (retard de rotation mesuré : 0). Au final : saisons 45, 46, 47 et 48 de 2026, contiguës à la seconde, chacune clôturée moins d'une minute après sa fin, avec promotions appliquées. Une sauvegarde par jour, comptée dans la saison en cours. Une sauvegarde portant l'identifiant de l'ancienne saison est ignorée.
4. **Aucun score avant `start_at`** (reproduction de l'état B7).
5. **Aucun score après `end_at`**, même avant le passage du planificateur.
6. **Serveur arrêté 3 semaines** : rattrapage des semaines 49, 50 et 51 sans trou ; un second appel ne change rien.
7. **Clôture anticipée** : la fin est ramenée à l'instant de clôture, la suite commence aussitôt et compte immédiatement, sous le nom « … · 2 ».
8. **Saison programmée** : la saison automatique s'arrête juste avant, puis la saison programmée est activée à sa date.
9. **Index** : une seconde saison active est refusée (`SQLITE_CONSTRAINT_UNIQUE`).
10. **`end_at` illisible** : la saison n'est pas clôturée.
11. **Routes admin, sur un vrai serveur de test** : 400 (date invalide, fin avant début, statut inconnu), 409 (seconde saison active), début futur → `scheduled` avec date normalisée, clôture manuelle puis nouvelle saison à fin + 1 s.

### Test manuel proposé (après déploiement)

1. `GET /api/seasons/current` : la saison doit avoir `startAt <= maintenant <= endAt` et un nom « Saison <semaine ISO>-<année> ».
2. Dans la minute qui suit dimanche 23:59:59 UTC, les journaux (`journalctl -u dig`) doivent afficher `[seasons][close] Début de clôture …` puis `[seasons] Nouvelle saison : Saison N-AAAA (… 00:00:00 → … 23:59:59)`, sans requête de joueur pour la déclencher.

## 5. Vérifications effectuées

- `node --test test/season-rotation.test.js` : 12/12 sur la branche du ticket.
- `npm test` sur la branche : 89/89 au second passage. Au premier passage, un seul échec : `rate-limit.test.js`, « connexion : 429 après RATE_LOGIN_MAX… ».
- **Cet échec est préexistant** : sur `develop` **avant** la fusion (`18e3881`), le même test échoue aussi, 1 fois sur 3. Sur `develop` après la fusion, il échoue 2 fois sur 3. Il dépend du temps (fenêtre fixe d'une minute du limiteur, attente de 100 ms) et n'a pas de lien avec les saisons. Lors d'un passage de `npm test` dans le worktree d'intégration, le fichier `rate-limit.test.js` est aussi resté bloqué plusieurs minutes : son serveur de test a été arrêté à la main. Ce défaut est signalé en section 9.
- Sur `develop` après la fusion : `season-rotation`, `anticheat` et `ranking-depth` passent, 34/34.
- `node server/test-season.js` : 62/62. Ce test m'a fait corriger un défaut : après une clôture anticipée, la suite commençait à la seconde suivante, ce qui refusait les scores pendant moins d'une seconde.
- **Migration testée sur une copie de la base de production** (`sqlite3 -readonly … ".backup /tmp/…"`, copie supprimée ensuite) :
  - l'index `idx_seasons_one_active` est créé ;
  - les 6 saisons et les 3 lignes de classement sont intactes ;
  - à l'heure actuelle, rien ne bouge : la saison 6 « Saison 44-2026 » reste active jusqu'au 01/11 23:59:59 ;
  - en simulant le 02/11 à 00:00:30, la saison 6 est clôturée et « Saison 45-2026 » s'ouvre du 02/11 00:00:00 au 08/11 23:59:59, sans trou.
- `node --check` des 4 fichiers serveur modifiés, dans le worktree d'intégration.
- Non vérifié : un vrai passage de dimanche à lundi en conditions réelles (simulé uniquement), et l'affichage côté navigateur, que le ticket ne modifie pas.

### Impact sur les données des joueurs

- **Aucune donnée existante n'est modifiée au déploiement.** Le seul changement de schéma est l'ajout d'un index (idempotent, non destructif). Les noms historiques erronés (« Saison 4-2026 »…) ne sont pas réécrits.
- Les sauvegardes et les classements ne changent pas. Une sauvegarde reçue après `end_at` n'est plus comptée dans la saison terminée ; avant, elle l'était jusqu'à la clôture paresseuse.
- La rotation de dimanche soir appliquera les promotions comme avant. Avec les 3 joueurs actuels, il y a moins que le minimum de 10 par ligue, donc aucune promotion.

## 6. Procédure de déploiement proposée

```bash
# 1. Sauvegarde (timer dig-backup déjà en place, ou à la main)
sqlite3 /home/ubuntu/Dig/server/data/dig.sqlite ".backup /home/ubuntu/backups/dig-avant-16.sqlite"
sqlite3 /home/ubuntu/backups/dig-avant-16.sqlite "PRAGMA integrity_check;"   # → ok
# 2. Mise à jour du code (selon votre procédure habituelle, depuis develop/main)
# 3. Redémarrage
sudo systemctl restart dig
# 4. Vérifications
journalctl -u dig -n 30 --no-pager          # pas d'avertissement "saisons actives : index d'unicité non créé"
curl -s http://127.0.0.1:3000/api/seasons/current | head -c 300   # startAt <= now <= endAt
sqlite3 -readonly /home/ubuntu/Dig/server/data/dig.sqlite "SELECT name FROM sqlite_master WHERE name='idx_seasons_one_active';"
```

Dépendance de code : ce ticket est construit sur `develop`, qui contient aussi les correctifs #8 à #15 non déployés. Il se déploie avec eux.

**Retour arrière** : redéployer le commit précédent. L'index ajouté est sans effet sur l'ancien code, qui ne crée jamais deux saisons actives par la rotation. Seul l'ancien `POST /api/admin/seasons` serait refusé par la base en cas de doublon, ce qui est voulu. Au besoin : `DROP INDEX idx_seasons_one_active;`. Les saisons créées par le nouveau code sont des lignes ordinaires que l'ancien code sait lire.

## 7. Choix techniques faits seul

- **Timer interne au processus Node** (`setInterval` de 60 s, plus une passe au démarrage) plutôt qu'un timer systemd : aucune infrastructure à modifier, et better-sqlite3 est synchrone, donc aucune concurrence avec les requêtes. La rotation reste aussi déclenchée par `/api/me/save` et `/api/seasons/current`, en filet de sécurité.
- **Bornes inclusives à la seconde** (`… 23:59:59`, puis `00:00:00`) : c'est le format existant en base et compris par le client. « Sans trou » signifie donc début(N+1) = fin(N) + 1 s.
- **Rattrapage semaine par semaine** plutôt qu'une seule longue saison après une panne : les noms restent cohérents avec la semaine ISO, la durée reste hebdomadaire et les saisons vides coûtent une ligne chacune.
- **Clôture anticipée** (route admin `close`, ou `PUT status=closed`) : `end_at` est ramené à l'instant de clôture. Sinon la saison suivante aurait commencé à l'ancienne date de fin, avec une période sans score. La date prévue est conservée dans `config.plannedEndAt` pour la clôture avec promotions.
- **Saison créée dans l'admin avec un début futur** : elle devient `scheduled` au lieu d'être refusée. La rotation l'active à sa date, en raccourcissant si besoin la saison automatique qui la précède.
- **Fuseau horaire** : tout est en UTC, comme avant. La semaine se termine donc dimanche à 23:59:59 UTC, soit 00:59:59 ou 01:59:59 lundi à Bruxelles.
- **Index unique conditionnel** : il n'est pas créé si la base contient déjà plusieurs saisons actives. Aucune réécriture automatique dans ce cas : un avertissement invite à corriger depuis l'admin.

## 8. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire. Point facultatif, sans blocage : faut-il que la semaine de saison suive l'heure de Bruxelles plutôt que l'UTC (fin dimanche à minuit heure locale) ? Recommandation : rester en UTC (comportement actuel, simple et sans ambiguïté aux changements d'heure).

## 9. Éléments restant à réaliser (hors périmètre, à signaler)

- **Reset de saison côté serveur** : le reset (pièces, profondeur, gemmes plafonnées) reste fait par le client quand il voit un nouvel identifiant de saison. Prévu dans T-12 (#19).
- **`season_duration`** (paramètre admin) reste ignoré : la saison est hebdomadaire. Prévu dans T-13 (#20).
- **Champ de date du panel admin** : il envoie une heure locale du navigateur, interprétée en UTC. Il faudrait l'indiquer dans l'interface ou convertir (petite amélioration, T-17).
- **Instabilité de `test/rate-limit.test.js`** (test de connexion 429, préexistante, reproduite sur `18e3881`) : il dépend du temps, échoue souvent et peut rester bloqué. Il faudrait le rendre déterministe (T-10 / #17, ou reprise de #14).
- `server/test-season.js` n'est pas inclus dans `npm test` et laisse des fichiers `-wal`/`-shm` (B11) : à intégrer dans T-10.
