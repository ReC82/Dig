# Ticket #30 — [P1] Panel admin — concours, lots et gagnants

- Ticket : https://github.com/ReC82/Dig/issues/30
- Session : 30/10/2026 (session 1)
- Tickets liés : #27 (conformité, décision « mérite »), #29 (classement figé), #25 (anti-bot),
  #28 (identité), #33/#34 (points, boutique), #31 (interface joueur)
- Classement MVP : **Après lancement** (le jeu se partage sans concours) ; outil nécessaire avant
  la première récompense, même simulée.

## 1. État réel

**Déployé en production (SHA `1ef0693`) le 30/10/2026 à 14:34 (Bruxelles) — en attente de recette.**
Aucun changement visible pour les joueurs. Le nouvel onglet admin « 🎁 Concours » est en ligne, mais
**le panel admin est désactivé en production depuis #12** : `ADMIN_SECRET` n'est pas défini dans
`/etc/dig/dig.env` (l'API admin répond 503, comme avant ce déploiement). Le propriétaire doit
l'ajouter pour faire la recette (§ 6).

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
3. **Panel admin en production** : ajouter `ADMIN_SECRET` (§ 6, étape 0) — nécessaire pour la recette.

## 9. Restant à réaliser

- Activation réelle : après les vérifications différées de #27 (§ 4), mettre
  `CONTEST_REAL_PRIZES=on` et appliquer l'éligibilité réelle (pays/âge, #28/#34).
- Affichage joueur du concours et du lot (#31) ; points et boutique (#33/#34).
- Harmoniser la clôture admin manuelle (`PUT … status: closed`) avec les promotions (#19, repéré
  dans #29, hors périmètre).
- Option : attribution automatique en simulation à chaque clôture.
