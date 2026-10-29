# Ticket #10 — [P0] T-03 — Regrouper les sauvegardes cloud et réparer l'anti-autoclic

- Ticket : https://github.com/ReC82/Dig/issues/10 (source : audit général #6, bug B3)
- Branche : `fix/10-sauvegardes-cloud-anticlic`
- Session du 29/10/2026

## 1. État réel

**Intégré dans `develop` — en attente de validation et de déploiement.** Rien n'est déployé :
`main` et la production ne sont pas modifiés.

## 2. Problème de départ (audit B3)

- Le client envoyait une sauvegarde cloud (`POST /api/me/save`) **à chaque clic** : ~8 requêtes
  SQLite et plusieurs lignes de log par clic, toast « Sauvegardé » affiché en permanence.
- Le serveur sautait le contrôle anti-autoclic quand deux sauvegardes étaient espacées de moins de
  3 s ; avec une sauvegarde par clic, il n'était donc **jamais évalué** (`anticheat_logs` vide en
  production).
- Il était aussi contournable en envoyant `manualClicks` inchangé avec des blocs en hausse
  (Δclics = 0 → blocs acceptés sans contrôle).

## 3. Changements réalisés

### Client — `public/js/main.js`
- La sauvegarde **locale** reste immédiate (à chaque clic, comme avant).
- La sauvegarde **cloud** est regroupée : au plus **1 envoi toutes les 12 s**
  (`CLOUD_SYNC_INTERVAL_MS`). Le premier changement après une pause part tout de suite, les
  suivants sont regroupés dans un envoi différé.
- **Sauvegarde finale** quand l'onglet est masqué ou fermé (`visibilitychange` → hidden,
  `pagehide`) via `navigator.sendBeacon` (repli `fetch(..., { keepalive: true })`), sans doublon
  entre les deux événements.
- Le toast « Sauvegardé » n'apparaît plus qu'à chaque envoi cloud (≤ 1 toutes les 12 s).
- La synchronisation après connexion (`_syncAfterLogin`) reste immédiate.

### Serveur — `server/seasons.js` (`processAntiCheat`), `server/index.js`
- **Cumul** : si moins de 3 s depuis la dernière mesure, la référence n'est plus avancée ; les
  clics s'accumulent et sont évalués à la sauvegarde suivante (action interne `pending`).
- **Δblocs > Δclics refusé** : un bloc manuel exige un clic. L'excédent est refusé et journalisé
  (`action_taken = 'rejected'`), y compris le cas Δclics = 0 avec Δblocs > 0.
- **Fenêtre plafonnée à 120 s** pour le calcul du CPS : une longue absence ne peut plus « diluer »
  une rafale (ex. 6 000 clics après 10 h → 50 CPS mesurés, pas 0,17).
- **Inactivité** (Δclics = Δblocs = 0) : la référence avance, l'inactivité n'entre pas dans la
  fenêtre (pas de dilution, pas de faux positif).
- **Première sauvegarde de saison** : blocs acceptés plafonnés au nombre de clics.
- Compteurs revenus en arrière (réinitialisation, autre appareil) : nouvelle référence, rien
  d'accepté en plus (comportement inchangé, désormais explicite).
- Anti-autoclic désactivé par l'admin : comportement d'avant (tout accepté).
- **Logs supprimés** : `getOrCreateSeasonStats`, `recordManualBreaks`, `recordAutoBreaks` ne
  loguent plus à chaque sauvegarde. Seuls les événements anti-triche (réduit / signalé / refusé)
  sont logués.
- Une erreur de synchronisation saisonnière n'est plus avalée silencieusement : elle est logguée
  (`console.error`) ; la sauvegarde reste acceptée comme avant.
- `processAntiCheat` est exporté et accepte une horloge injectable (tests).

### Admin — `public/admin/index.html`
- Filtre « ✖ Rejected seulement » ajouté au journal anti-autoclicker.

### Tests — `test/anticheat.test.js` (nouveau, inclus dans `npm test`)
Base temporaire dans `/tmp`, serveur de test sur le port 3109.

## 4. SHA, branche et procédure de test

- Commit du correctif : `07f4d85` sur `fix/10-sauvegardes-cloud-anticlic`.
- SHA de fusion sur `develop` : indiqué dans le commentaire du ticket (fusion `--no-ff` faite
  après ce rapport).

### Tests automatisés
```bash
cd <copie de travail> && npm ci && npm test
```
Résultat obtenu : **36/36** (dont 9 nouveaux pour #10) :
jeu normal 5 CPS sans log ; sauvegarde à chaque clic à 20 CPS → cumul + réduction journalisée ;
Δclics = 0 → `rejected` ; Δblocs > Δclics → excédent refusé ; init plafonnée ; longue absence non
diluée (480 blocs acceptés sur 3 000) ; inactivité sans faux positif ; anti-autoclic désactivé ;
route HTTP acceptant un corps `sendBeacon` (Blob `application/json`) sans log par sauvegarde.

### Contrôle navigateur réalisé (Chromium headless, serveur de test port 3101, base `/tmp`)
Scénario : compte de test créé, auto-clic simulé à 20 CPS pendant 30 s, 5 clics juste avant de
fermer l'onglet, puis fermeture.
- **2 POST** `/api/me/save` pendant les 30 s de jeu (à 10,1 s et 22,1 s) — critère « ≤ 1 POST par
  10 s » respecté (contre ~500 avant).
- Fermeture de l'onglet : la sauvegarde cloud contient **498 clics = valeur locale finale** (les
  clics des 8 dernières secondes et ceux faits juste avant la fermeture sont arrivés par la
  sauvegarde finale) — aucune perte.
- `anticheat_logs` : 2 entrées `reduced` (16,7 et 16,4 CPS, seuil 8, ratio ≈ 0,48) — l'anti-autoclic
  produit enfin des entrées.

### Procédure de test manuelle proposée au propriétaire
1. Lancer un serveur de test : `PORT=3101 DB_FILE=/tmp/test-10.sqlite ADMIN_SECRET=… SESSION_SECRET=… node server/index.js`.
2. Ouvrir le jeu, créer un compte, ouvrir l'onglet Réseau des outils de développement, filtrer
   `me/save`, cliquer en continu : au plus un POST toutes les ~12 s.
3. Cliquer encore puis fermer l'onglet ; rouvrir : la progression est intacte (sur un autre
   navigateur aussi, après connexion).
4. Avec un auto-clicker à 20 CPS pendant ≥ 15 s : le panel admin, section « Journal
   anti-autoclicker », affiche des lignes `reduced`/`flagged`.

## 5. Vérifications, limites, impact données

- Vérifié : `node --check` des fichiers modifiés, `npm test` (36/36), contrôle navigateur ci-dessus.
- Non vérifié : vrais navigateurs mobiles (iOS Safari : `pagehide` est le seul événement fiable,
  il est couvert ; `sendBeacon` est supporté), charge réelle multi-joueurs (non testée ; la charge
  diminue mécaniquement d'un facteur ~50–100 par joueur actif).
- **Aucune migration de schéma**, aucune donnée réécrite. Les lignes existantes de
  `player_click_tracking` sont réutilisées telles quelles.
- Effet attendu après déploiement : les joueurs qui cliquent au-delà de 8 CPS en moyenne sur une
  fenêtre verront leurs **blocs classés** réduits (jamais sous 10 %) — c'est le comportement prévu
  par l'admin mais jusqu'ici inactif. La progression du jeu (pièces, profondeur…) n'est pas touchée.
- Limites connues :
  - Le client détecte déjà localement les clics « suspects » et ne les compte pas comme blocs
    manuels ; le contrôle serveur est un second filet.
  - La profondeur (`maxDepth`) reste fournie par le client sans contrôle : c'est le ticket #9 (T-02).
  - Le serveur fait toujours confiance aux compteurs cumulés du client (un tricheur peut envoyer de
    faux compteurs cohérents à ≤ 8 CPS) ; une progression calculée côté serveur relève du ticket #25.
  - Une sauvegarde de sortie envoyée < 3 s après la précédente reste « en attente » jusqu'à la
    sauvegarde suivante (≤ 3 s de clics non comptés au classement si le joueur ne revient pas
    pendant la saison).
  - Pas de limitation de débit côté serveur : un client modifié peut toujours envoyer des
    sauvegardes en rafale (ticket #14 / T-07). Elles sont désormais cumulées, donc sans effet sur
    l'anti-autoclic.

## 6. Procédure de déploiement proposée

1. Sauvegarde vérifiée de la base (outil du ticket #13 si installé : `npm run backup`, sinon
   `sqlite3 server/data/dig.sqlite ".backup /chemin/sauvegarde.sqlite"` puis
   `sqlite3 /chemin/sauvegarde.sqlite "PRAGMA integrity_check"`).
2. Mettre à jour le code de production avec la révision de `develop` validée (procédure habituelle
   ou `scripts/deploy.sh` du ticket #13), puis redémarrer `dig.service`.
3. Vérifier : `curl -s https://dig.lodygames.com/api/version` ; jouer 30 s connecté et compter les
   POST `me/save` (≤ 3) ; `journalctl -u dig` ne doit plus afficher de ligne par clic.
4. Retour arrière : redéployer la révision précédente et redémarrer le service. Aucune migration →
   aucune restauration de base nécessaire. Les clients déjà chargés reprennent l'ancien
   comportement au rechargement de la page.

## 7. Choix techniques faits seul

- **Intervalle cloud 12 s** (fourchette 10–15 s du ticket) : critère « ≤ 1 POST / 10 s » respecté
  avec marge, perte maximale bornée par la sauvegarde de sortie.
- **Envoi immédiat du premier changement après une pause** (throttle « leading + trailing ») :
  données fraîches côté serveur sans dépasser le plafond.
- **Fenêtre de CPS plafonnée à 120 s** : empêche la dilution par une longue absence ; en jeu normal
  les fenêtres font ~12 s, donc pas de faux positif.
- **Blocs excédentaires refusés plutôt que réduits** : Δblocs > Δclics est physiquement impossible
  avec le client officiel.
- **Nouvelle valeur `rejected`** dans `anticheat_logs.action_taken` (colonne TEXT sans contrainte,
  pas de migration).
- Le toast « Sauvegardé » suit l'envoi cloud (y compris pour les invités, où il signale la
  sauvegarde locale périodique).

## 8. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire.

## 9. Éléments restant à réaliser (hors périmètre, proposés)

- #9 (T-02) : plafonner `maxDepth` côté serveur.
- #14 (T-07) : limitation de débit sur `POST /api/me/save`.
- #25 : progression calculée côté serveur et sanctions graduelles.
- Test de charge réel une fois un environnement de recette disponible.
- Le script du contrôle navigateur (Playwright) n'est pas versionné faute de dépendance de test ;
  il pourrait l'être avec #17 (T-10, CI).
