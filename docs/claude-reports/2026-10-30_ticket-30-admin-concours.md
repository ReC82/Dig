# Ticket #30 — [P1] Panel admin — concours, lots et gagnants

- Ticket : https://github.com/ReC82/Dig/issues/30
- Session : 30/10/2026 (session 1)
- Tickets liés : #27 (conformité, décision « mérite »), #29 (classement figé), #25 (anti-bot),
  #28 (identité), #33/#34 (points, boutique), #31 (interface joueur)
- Classement MVP : **Après lancement** (le jeu se partage sans concours) ; outil nécessaire avant
  la première récompense, même simulée.

## 1. État réel

**Déployé en production (SHA `a49c604`, 03/11/2026 17:15 Bruxelles) — en attente de recette.**
Dernière évolution (§ 11) : retour UX de la recette du propriétaire du 03/11 (#30-A) — synthèse des
réglages d'abord, « Modifier » ouvre la fiche en accordéons, simulation explicitée. Le panel est
actif et protégé par `ADMIN_SECRET` depuis le 30/10 (§ 10). Aucun changement visible pour les joueurs.

## 2. Périmètre retenu

Le ticket parlait de « tirage », « somme des poids » et « participants pondérés ». Depuis la
décision du propriétaire du 30/10 (#27, #29), **il n'y a aucun tirage** : le lot va au premier
éligible du classement figé à la clôture. « Tirage » devient donc **attribution au mérite** et
« somme des poids » devient le **décompte participants / éligibles / lots**. Les cadeaux réels
restent **verrouillés** (#27 § 3, « interface de simulation possible avant conformité ; pas
d'activation réelle »).

## 3. Résultat et changements

| Fichier | Changement |
|---|---|
| `server/contest.js` (nouveau) | Réglages, aperçu, attribution, exclusions motivées, suivi des gagnants, coordonnées, journal. |
| `server/db.js` | Migration **additive** : tables `contest_settings` (1 ligne), `contest_exclusions`, `contest_winners`, `contest_audit` ; déclencheurs : journal en ajout seul, aucun gagnant supprimable. |
| `server/index.js` | 9 routes `/api/admin/contest/…` (protégées par `ADMIN_SECRET`). |
| `public/admin/*` | Onglet « 🎁 Concours » : bandeau de verrou, réglages, aperçu par saison, attribution, gagnants, journal. Rendu sûr (`textContent`, test XSS existant respecté). |
| `test/contest.test.js` (nouveau) | 16 tests. |

**Fonctions du panel :**
- **Activation et lot** : concours actif/inactif, titre, description, lot (par défaut « Carte cadeau
  Amazon », 5,00 EUR), fournisseur, devise, **stock** de lots réels, lots par saison.
- **Calendrier** : début et fin (UTC, vides = sans limite) ; une saison qui finit hors de la
  fenêtre n'est pas attribuable.
- **Critères d'éligibilité** (en plus de ceux du classement figé #29) : profondeur minimale,
  niveau de risque anti-bot maximal (**aucune exclusion par défaut**, #25 lot C non décidé),
  nombre de saisons sans nouveau gain après un lot (**0 par défaut** = le premier gagne toujours),
  **exclusion motivée** d'un joueur pour une saison (journalisée, réversible, sans toucher à
  l'instantané figé).
- **Éligibilité des cadeaux réels** (pays, âge minimal, accord parental, fournisseur, notes) :
  structure prévue, **vide par défaut et non appliquée** tant que les cadeaux réels sont verrouillés.
- **Aperçu (simulation)** par saison et par mode, sans rien écrire : classement figé (ou classement
  vivant pour la saison en cours, indicatif seulement), raison de chaque non-éligibilité, lot que
  chaque joueur recevrait, empreinte de l'instantané, et liste des obstacles (saison non figée,
  empreinte invalide, hors calendrier, déjà attribuée, verrou réel, concours inactif, stock).
- **Attribution** : en une transaction, aux premiers éligibles, avec l'empreinte du classement
  figé et une copie du lot. **Double attribution interdite** : refus 409, plus contraintes en base
  (un gagnant par saison/mode/lot, un lot par joueur et par saison). Mode simulation : aucun stock
  consommé. Mode réel : stock décrémenté, rendu si le lot expire.
- **Suivi des gagnants** : désigné → contacté → identité vérifiée → lot envoyé → confirmé ;
  « expiré » possible avant l'envoi. Toute autre transition est refusée. Échéance = attribution +
  délai de remise (30 jours par défaut), retard signalé ⚠. Un lot expiré **n'est pas réattribué**
  automatiquement (question 2).
- **Confidentialité** : aucun e-mail ni code cadeau dans les tables du concours ni dans les
  journaux ; les notes qui contiennent un e-mail ou ressemblent à un code sont refusées ; l'e-mail
  du gagnant s'affiche seulement sur demande (bouton « Coordonnées », requête POST), et la
  consultation est journalisée sans l'adresse. Aucune route publique.
- **Journal du concours** : réglages (avant/après), exclusions, désignations, changements de
  statut, consultations de coordonnées. En ajout seul (déclencheurs). Les actions admin restent
  aussi tracées dans le journal de sécurité (#25).

**Verrou des cadeaux réels** : le mode réel n'est possible que si la variable d'environnement
`CONTEST_REAL_PRIZES=on` est définie sur le serveur. Elle ne l'est pas : activer le concours dans
le panel ne suffit pas. Une décision explicite du propriétaire, puis une modification du fichier
de secrets, sont nécessaires.

## 4. SHA, branche et procédure de test

- Branche `feature/30-admin-concours` — commit `3806e62`.
- **SHA sur `develop` : `1ef0693`** (fusion).
- Tests : `npm test` → **222/222** (dont `node --test test/contest.test.js` 16/16).
- Essai local : `PORT=3101 DB_FILE=test-30.sqlite ADMIN_SECRET=<48 caractères> node server/index.js`,
  puis `http://127.0.0.1:3101/admin/` → onglet « 🎁 Concours ».

## 5. Vérifications

**Faites :**
- Tests automatiques : réglages (validation, refus sans écriture, audit avant/après), notes
  (e-mail et codes refusés), aperçu (ordre au mérite, profondeur min., risque max., exclusion,
  délai entre gains, calendrier, saison active non attribuable, saison sans éligible), attribution
  (premier éligible, 409 à la deuxième, contraintes UNIQUE, suppression refusée, journal en ajout
  seul), verrou réel (refus même concours actif et stock rempli), mode réel déverrouillé dans le
  test (stock consommé puis rendu à l'expiration), suivi complet et transitions interdites,
  coordonnées sans adresse dans les tables, routes HTTP (401 sans jeton, 400/404/409, aucune
  adresse dans les réponses de liste, le journal ni la console).
- Navigateur headless (base de test, port 3101) : 1280×900 et 390×844, aucune erreur console ;
  attribution, passage à « Contacté », affichage des coordonnées et journal vérifiés.
- **Migration sur une copie de la base de production** (mode production, port 3122) : santé et
  version OK, empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`,
  `player_click_tracking` **identiques**, `quick_check` ok, réglages par défaut créés, aucun
  gagnant. Copie supprimée.

**Non faites / limites :**
- Pas de test dans le vrai panel de production (panel désactivé faute d'`ADMIN_SECRET`).
- L'éligibilité des cadeaux réels (pays, âge) est enregistrée mais pas appliquée : le jeu ne
  connaît ni le pays ni l'âge des joueurs (relève de #28/#34 et d'une décision d'activation).
- Pas d'attribution automatique à la clôture : l'admin clique « Attribuer » (choix § 7).
- Pas d'envoi d'e-mail au gagnant depuis le panel : contact manuel (choix § 7).

**Données des joueurs** : rien de supprimé ni de réécrit. Ajout de 4 tables, 1 index et
4 déclencheurs ; aucune colonne ajoutée aux tables existantes.

## 6. Déploiement

- **SHA déployé : `1ef0693`** (précédent : `10ce36f`), servi en `1.0.0+1ef0693` sur
  https://dig.lodygames.com et https://dig.lodylands.com (200).
- Avant : release détachée, `npm ci`, `npm test` **222/222** sur le SHA exact ; copie de la base
  de production démarrée en mode production : empreintes identiques.
- **Sauvegarde pré-déploiement vérifiée** : `~/backups/dig/dig-20261030-143440-pre-deploy-1ef0693.sqlite`.
- Après : 2 domaines 200 et bonne version, `journalctl` sans erreur, `quick_check` ok, empreintes
  des 6 tables **identiques** à la sauvegarde.
- **Retour arrière** : `git -C /home/ubuntu/Dig reset --keep 10ce36f` puis
  `sudo systemctl restart dig` (`package-lock.json` inchangé). Les tables ajoutées sont ignorées
  par l'ancien code. La base n'est jamais restaurée.

**Test fonctionnel à faire par le propriétaire (10 min) :**
0. **Préalable (une fois)** : activer le panel admin, désactivé depuis #12 :
   `printf 'ADMIN_SECRET=%s\n' "$(openssl rand -hex 32)" | sudo tee -a /etc/dig/dig.env >/dev/null`,
   puis `sudo systemctl restart dig`, et lire la clé avec `sudo grep ADMIN_SECRET /etc/dig/dig.env`.
   Les joueurs ne sont pas déconnectés.
1. Ouvrir https://dig.lodygames.com/admin/, saisir la clé, onglet **🎁 Concours** : bandeau jaune
   « 🔒 Simulation uniquement : cadeaux réels verrouillés ».
2. Réglages : vérifier le lot (Carte cadeau Amazon, 5,00 EUR), changer la description, cliquer
   « Enregistrer » → « Réglages enregistrés » et une ligne `settings_updated` dans le journal.
3. Aperçu : choisir « Saison 4-2026 (closed, figée) », mode Simulation → toi au rang 1 avec
   « 🎁 lot 1 » et l'empreinte du classement figé. Mode « Réel » → obstacles en rouge (verrou,
   concours inactif, stock) et bouton grisé.
4. Revenir en Simulation, cliquer « Attribuer les lots (simulation) » et confirmer → « 1 lot(s)
   attribué(s) ». Cliquer à nouveau sur Aperçu : « lots déjà attribués », bouton grisé.
5. Gagnants : « → Contacté » (note libre) → statut « Contacté ». Essayer une note avec une adresse
   e-mail → refus. « Coordonnées » → ton e-mail s'affiche, ligne `contact_viewed` dans le journal.
6. Lundi 02/11 : la saison 44-2026 apparaît « figée » et peut être prévisualisée.

Résultat attendu : rien ne change côté joueurs ; aucun e-mail dans le journal.

## 7. Choix techniques faits seul

- **Verrou réel par variable d'environnement** (`CONTEST_REAL_PRIZES=on`) plutôt que par une case
  du panel : un jeton admin volé ne peut pas ouvrir les cadeaux réels, et l'activation reste une
  décision explicite du propriétaire sur le serveur.
- **Ordre du suivi** : contacté avant identité vérifiée (on vérifie l'identité en échangeant avec
  le gagnant), puis envoyé, confirmé. Expiration possible jusqu'à l'envoi.
- **Simulation sans stock** et **mode réel séparé** (une saison peut être simulée puis attribuée
  en réel sans conflit).
- **Aucun code cadeau stocké** : le code s'envoie en privé hors du panel ; le panel ne trace que
  l'étape « lot envoyé ». Stocker les codes demanderait un chiffrement et une gestion de clés.
- **Attribution manuelle** (bouton), pas automatique à la clôture : évite d'attribuer des saisons
  anciennes sans contrôle humain ; automatisable plus tard.
- **Valeurs par défaut prudentes** : concours inactif, stock 0, aucune exclusion anti-bot, délai
  entre gains 0 (le premier gagne toujours, faute de décision sur la question 2 de #27).

## 8. Décisions demandées au propriétaire

Aucune décision n'est nécessaire pour utiliser le panel en simulation. Points à trancher plus
tard (valeurs modifiables dans le panel, sans code) :

1. **Délai entre deux gains** : (a) 0, le premier gagne toujours (réglage actuel) ; (b) 4 saisons
   sans nouveau gain, le lot passe au suivant (recommandation de #27).
2. **Lot expiré** : (a) non réattribué, il retourne au stock (comportement actuel, **recommandé**,
   simple et transparent) ; (b) réattribué au suivant du classement (développement à prévoir).
3. ~~Panel admin en production : ajouter `ADMIN_SECRET`~~ — **fait par le propriétaire le 30/10, vérifié (§ 10).**

## 9. Restant à réaliser

- Activation réelle : après les vérifications différées de #27 (§ 4), mettre
  `CONTEST_REAL_PRIZES=on` et appliquer l'éligibilité réelle (pays/âge, #28/#34).
- Affichage joueur du concours et du lot (#31) ; points et boutique (#33/#34).
- Harmoniser la clôture admin manuelle (`PUT … status: closed`) avec les promotions (#19, repéré
  dans #29, hors périmètre).
- Option : attribution automatique en simulation à chaque clôture.

## 10. Mise à jour du 30/10/2026, 16:55 (session 2) — `ADMIN_SECRET` actif en production

Demande du propriétaire (commentaire du 30/10, 15:40 UTC) : vérifier, **sans afficher ni divulguer
la valeur**, que le service charge `ADMIN_SECRET`, que `/admin/` n'est accessible qu'avec
l'authentification attendue et que les fonctions admin (#30, #33, #34, #44) répondent.

Aucune modification de code, aucune écriture en base de production, **aucun redémarrage
nécessaire** : `dig.service` avait déjà été redémarré à 16:30 (Bruxelles), après l'ajout de la
variable. Le fichier `/etc/dig/dig.env` et l'environnement du service n'ont pas été lus ; la
vérification se fait uniquement par le comportement de l'API.

**Production (`1.0.0+36b9e70`, les deux domaines)**

| Contrôle | Résultat |
|---|---|
| `/admin/` (page de connexion, statique) | 200 sur https://dig.lodygames.com et https://dig.lodylands.com |
| 15 routes `GET /api/admin/…` sans jeton | **401** « Accès refusé » (et non plus **503** « non configuré ») → la variable est chargée et de longueur suffisante |
| Les mêmes routes avec un jeton faux | **401** |
| Journal `dig` depuis 16:30 | aucune erreur ni avertissement (pas de « ADMIN_SECRET trop faible ») |

Les routes couvrent #30 (`contest`, `contest/winners`, `contest/audit`), #33 (`points`),
#34 (`shop`, `shop/audit`), #44 (`seasons/active/end`), ainsi que saisons, ligues, config,
sécurité et anti-triche.

**Réponses authentifiées** — je ne connais pas la clé de production (et ne dois pas la lire).
Le même code (`36b9e70`) a donc été démarré sur une **copie de la base de production** en mode
production, avec une clé de test aléatoire (port 3122, copie et clé supprimées ensuite) :

- 14 routes admin → **200** ; `players/search` sans paramètre → 400 attendu ;
- #30 : réglages du concours (`enabled: false`), gagnants `[]`, journal vide ; **aperçu de la saison
  « Saison 44-2026 » (close, figée par #44) → 200**, mode simulation, source « snapshot » avec
  l'empreinte du classement figé ; saison active « Saison 44-2026 · 2 » → aperçu en direct (200) ;
- #33 : barème des points (`mode: live`) ; #34 : boutique (`realEnabled: false`) ; #44 : fin de la
  saison active (200) ;
- **lots réels toujours verrouillés** (`CONTEST_REAL_PRIZES` absent → bandeau simulation),
  aucune attribution ni action d'écriture effectuée.

**Recette par le propriétaire** : la procédure du § 6 s'applique telle quelle, **sans l'étape 0**
(déjà faite). À l'étape 3, choisir la saison **« Saison 44-2026 (closed, figée) »** (clôturée le
30/10 à 16h par #44). Résultat attendu : connexion refusée avec une mauvaise clé ; avec la bonne
clé, l'onglet 🎁 Concours s'ouvre avec le bandeau jaune « Simulation uniquement ».

## 11. Mise à jour du 03/11/2026, 17:20 (session 3) — synthèse d'abord, fiche en accordéons

**Retour du propriétaire** (recette #30-A, 03/11 15:50 UTC, consultation sans action) : grande fiche
de configuration ouverte par défaut, réglages de cadeaux réels verrouillés (pays, âge, stock,
fournisseur) mêlés au reste, long défilement ; demander « liste/synthèse d'abord, Modifier ouvre la
fiche », accordéons pour l'avancé et l'éligibilité des cadeaux réels ; ne pas activer le concours ni
toucher aux paramètres ; prochain test éventuel limité à la Simulation **après confirmation que
l'action reste sans effet réel**.

**État réel : déployé en production (`a49c604`) — en attente de recette.**

### Changements (`public/admin/index.html`, `admin.js`, `admin.css`, `test/contest.test.js`)

- **Synthèse toujours visible** en tête de « Réglages du concours et du lot » : état, lot (libellé,
  valeur, devise, fournisseur), lots par saison, profondeur minimale, risque anti-bot, délai entre
  deux gains, délai de remise, calendrier, cadeaux réels (🔒 verrouillés + stock). Deux colonnes sur
  smartphone.
- **« ✏ Modifier »** ouvre la fiche sous la synthèse, en trois accordéons avec résumé :
  « Concours et lot » (déplié), « Critères et calendrier » (replié), « Cadeaux réels : stock et
  éligibilité » (replié, mention « rien n'est appliqué tant que verrouillé »). Le stock réel est
  désormais rangé avec l'éligibilité réelle.
- **Enregistrer** referme la fiche et met à jour la synthèse ; **Annuler** rétablit les valeurs
  enregistrées (confirmation si une saisie est en cours) ; un refus du serveur (valeur hors bornes)
  déplie toutes les sections et affiche le message.
- **Rafraîchir n'écrase plus une saisie en cours** dans la fiche (indicateur « ● modifications non
  enregistrées »). Protection minimale propre à ce formulaire ; la généralisation reste #61.
- **Simulation explicitée** sous « Attribuer les lots » ; l'option de mode affiche « Réel
  (verrouillé) » tant que `CONTEST_REAL_PRIZES` ≠ `on`.
- Aucun réglage supprimé ; aucune route, règle d'attribution ni donnée modifiée.

### Confirmation demandée : la Simulation reste sans effet réel (vérifié dans le code)

`attribute(…, { mode: 'simulation' })` (`server/contest.js`) :
- **écrit** une ligne par lot dans `contest_winners` (mode `simulation`) et un événement dans le
  journal du concours ; c'est tout ;
- **ne consomme aucun stock** (seul le mode réel décrémente `prize_stock`), **n'envoie aucun
  message ni e-mail**, **ne donne aucun point ni cadeau** (aucun autre module du jeu ne lit
  `contest_winners`), et rien n'est visible côté joueur ;
- n'est possible **que sur une saison close et figée** (#29), **une seule fois par saison** ; la ligne
  ne peut pas être supprimée (déclencheur), seulement passée à « expiré » ;
- elle n'influence que les simulations suivantes (délai entre gains calculé par mode) — jamais le
  mode réel. Le mode réel reste refusé (`real_prizes_locked`) tant que la variable n'est pas `on`.

Saisons proposées en production : « Saison 45-2026 » (active, non figée → aperçu seulement),
« Saison 44-2026 · 2 », « Saison 44-2026 », « Saison 41-2026 » (closes et figées, aucun gagnant).

### Vérifications

- `npm test` complet : **553/553** sur la branche puis sur le SHA exact `a49c604` (release).
- Nouveau test : synthèse et bouton présents, fiche fermée par défaut, un seul accordéon déplié,
  **tous les champs envoyés au serveur présents dans la fiche**, stock/éligibilité réels dans
  l'accordéon verrouillé, Rafraîchir sans écrasement, texte de simulation.
- Navigateur (Chromium headless, base de test, port 3101) en 1280×900 et 390×844 : synthèse,
  « Modifier », saisie conservée après Rafraîchir, Annuler → valeur d'origine et fiche refermée,
  enregistrement (lots/saison 2) reflété dans la synthèse, refus serveur (99) → toutes les sections
  dépliées + message ; aucune erreur JavaScript. Serveur arrêté, base de test supprimée.
- Copie de la base de production (`a49c604`, `NODE_ENV=production`, port 3122) : `/health` ok,
  version `1.0.0+a49c604`, `/admin/` 200, empreintes des 6 tables identiques avant/après ; copie
  supprimée.

### Déploiement

- `main` avancé de `0c66821` à `a49c604` (avance rapide ; inclut aussi l'outil de simulation #39
  déjà intégré dans `develop`, sans fichier servi aux joueurs).
- Sauvegarde vérifiée : `~/backups/dig/dig-20261103-171531-pre-deploy-a49c604.sqlite`.
- Après déploiement : les deux domaines 200, `/admin/` 200, `/api/version` = `1.0.0+a49c604`,
  `admin.js` servi contient la nouvelle synthèse, journal sans erreur, `quick_check` ok ; empreintes :
  `users`, `seasons`, `leagues` identiques, `user_saves` (version 833 → 834) et horodatages de
  `season_rankings` / `player_click_tracking` en progression (partie en cours), aucune perte.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 0c66821` + `sudo systemctl restart dig`
  (pas de `npm ci` : verrou inchangé, aucune migration).

### Test fonctionnel à faire par le propriétaire (sans aucune action réelle)

1. Admin → 🎁 Concours (recharger la page avec Ctrl+F5 si elle était ouverte).
   Attendu : bandeau jaune « Simulation uniquement », puis la **synthèse** (État ⏸ inactif, Lot
   Carte cadeau Amazon 5.00 EUR, Cadeaux réels 🔒 verrouillés — stock 0) **sans formulaire ouvert**.
2. Cliquer **✏ Modifier**. Attendu : « Concours et lot » déplié, les deux autres sections repliées avec
   leur résumé. Ouvrir « Cadeaux réels : stock et éligibilité » pour voir le regroupement.
3. Sans rien enregistrer, cliquer **Annuler**. Attendu : la fiche se referme, rien n'a changé.
4. (Facultatif, Simulation seule) Choisir « Saison 44-2026 (closed, figée) », mode Simulation,
   **Aperçu** : la liste et le texte « aucun stock consommé, aucun message au joueur, aucun point ni
   cadeau » s'affichent. « Attribuer les lots (simulation) » inscrirait un gagnant fictif
   **définitif pour cette saison** (non supprimable, passable à « expiré ») — à ne cliquer que si ce
   test est voulu.

Classement : **Après lancement** (le MVP se partage sans concours).

### Choix techniques faits seul

- Réutilisation des accordéons de la fiche d'un bloc (#37, classes `bk-acc`) pour une présentation
  homogène dans l'admin.
- Le stock réel passe dans l'accordéon « Cadeaux réels » : il n'a d'effet qu'en mode réel.
- Largeur/centrage communs (#62), protection générale des formulaires (#61) et bouton Rafraîchir
  avec état (#60) ne sont **pas** traités ici : ce sont des tickets dédiés, transverses à tout
  l'admin ; le panel Concours en bénéficiera automatiquement.

### Décisions demandées au propriétaire

Inchangées (§ 8, questions 1 et 2), non bloquantes : délai entre deux gains ; sort d'un lot expiré.

### Restant à réaliser

Inchangé (§ 9), plus #60/#61/#62 pour l'harmonisation transverse de l'admin.
