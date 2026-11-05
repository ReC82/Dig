# Ticket #70 — Admin : navigation en sections et sous-menus évolutifs

- Ticket : [#70 — [P1] Admin — réorganiser la navigation en sections et sous-menus évolutifs](https://github.com/ReC82/Dig/issues/70)
- Branche : `feature/70-navigation-admin` (correctif ⚠ du 05/11 après-midi : `1ba2083` ; code du 05/11 matin : `462df6b` ; code du 04/11 : `70ffb91`)
- `develop` : `d89f089` (fusion du correctif ⚠), puis le commit de ce rapport
- **Production : `d89f089`** (déployé le 05/11/2026 à 14:28, heure de Bruxelles)

## 00. Mise à jour du 05/11/2026 après-midi — faux ⚠ des suspensions volontaires

**État réel : déployé en production (SHA `d89f089`) — en attente de recette.**

### Contexte
Les recettes #70-A à #70-F du propriétaire sont toutes validées (recherche « recommencer »/reset, fiche joueur et Essais de test, lien Anti-bot, action « Préparer une invitation », sous-rubrique Économie après F5, navigation mobile) : elles ne sont pas redemandées.
Il restait un défaut signalé le 05/11 : quand des améliorations sont **suspendues volontairement** (Fragments, Reroll bloc), un ⚠ restait affiché sur « Améliorations » et sur le groupe « Jeu & progression », comme s'il s'agissait d'une anomalie.

### Correction (`public/admin/admin.js`, `loadUpgrades`)
- Une suspension volontaire **n'allume plus le ⚠ du menu**. Ce ⚠ est réservé à un incident qui demande une action : le catalogue des améliorations ne se charge pas (**erreur serveur**, code 500 ou plus). Son infobulle l'explique : « chargement du catalogue impossible (erreur serveur) ». Le ⚠ disparaît dès que le chargement réussit.
- Une coupure réseau ne déclenche **aucun faux signal** : c'est la même règle que pour « aucune saison active ».
- L'état reste visible dans la page Améliorations, en texte neutre : le résumé indique « … 6 améliorations, 2 désactivée(s) volontairement » et le titre « 🚨 Suspension d'urgence » affiche « — 2 désactivée(s) ». Le tableau des suspensions ne change pas.
- **Rien d'autre ne change** : les suspensions en vigueur, les achats, les effets, la visibilité côté joueur et les données joueurs restent tels quels. Le seul autre signal du menu (« aucune saison active ») fonctionne comme avant.

### Tests
- `npm test` : **765/765** sur la branche, sur `develop` `d89f089` et sur la release `d89f089`. `npm run check` OK. Le test unitaire `test/admin-nav.test.js` vérifie que le ⚠ des Améliorations ne dépend plus des suspensions.
- Nouvel essai navigateur `test/e2e/admin-nav-flag.e2e.js` : **17/17** sur PC 1280×900 et smartphone 390×844, sans erreur JS. Il couvre :
  - deux suspensions volontaires réelles en base de test : pas de ⚠ et texte neutre ;
  - une erreur 500 simulée : ⚠ sur la rubrique et sur le groupe, avec explication ;
  - le retour à la normale : ⚠ retiré ;
  - une coupure réseau : aucun ⚠ ;
  - le signal « aucune saison active » : toujours opérationnel.
- `test/e2e/admin-nav.e2e.js` relancé : **38/38** (aucune régression de navigation).
- Copie de la base de production : démarrage OK, `/health` 200, version `d89f089`, empreintes identiques avant et après démarrage. Aucune migration.

### Déploiement
- Avant le déploiement, aucune génération IA n'était en cours (dernière à 12:53, heure de Bruxelles).
- `main` a avancé par avance rapide `9fc4acb` → `d89f089`, puis `scripts/deploy.sh` a été lancé depuis la release.
- Sauvegarde vérifiée : `dig-20261105-142841-pre-deploy-d89f089.sqlite`.
- Après déploiement :
  - les 2 domaines répondent 200 avec la version `1.0.0+d89f089` ;
  - le journal ne contient aucune erreur ;
  - `quick_check` = ok ;
  - `users`, `seasons`, `leagues` et `player_click_tracking` sont identiques à la sauvegarde ;
  - `user_saves` et `season_rankings` ont avancé à cause d'une partie en cours (même nombre de lignes, version de sauvegarde +1, pièces en hausse) : c'est une progression, pas une perte.
- Retour arrière possible vers `9fc4acb`.

### Test fonctionnel à faire par le propriétaire (1 min, PC puis smartphone)
1. Rechargez l'onglet admin (F5). Laissez Fragments et Reroll suspendus : **ne les réactivez pas**.
2. Ouvrez ⛏ Jeu & progression → ⬆ Améliorations. **Attendu :** aucun ⚠ ni sur « Améliorations » ni sur « Jeu & progression ». En haut de page, le résumé indique « 2 désactivée(s) volontairement », et le cadre « 🚨 Suspension d'urgence » affiche « — 2 désactivée(s) » avec les deux lignes suspendues.
3. Sur smartphone, ouvrez ☰ Rubriques. **Attendu :** aucun ⚠ sur « Jeu & progression » ni sur « Améliorations ».

Une vraie panne (catalogue en erreur serveur) ne peut pas être provoquée sans risque en production. Ce cas est vérifié par l'essai navigateur ci-dessus.

### Classement
**Après lancement** : confort d'exploitation, sans effet sur les joueurs.

### Choix techniques faits seul
- Le ⚠ des Améliorations est réservé à l'erreur serveur au chargement. Une suspension est une décision connue et journalisée, donc ce n'est pas un incident.
- Le seuil est « code ≥ 500 ». Le panel affiche déjà les autres échecs (session expirée, réseau) par un message propre, et l'on évite ainsi un faux signal hors ligne.
- L'état reste en texte, sans badge coloré dans le menu, comme demandé (« indication neutre non alarmante »).

### Décisions demandées au propriétaire
Aucune décision utilisateur nécessaire.

### Reste à faire
Rien dans le périmètre de #70 après cette recette. Le ticket peut être clôturé par le propriétaire si ce dernier test est concluant. #76 (simplification des fiches et modales) reste un ticket séparé.

## 0. Mise à jour du 05/11/2026 — recette du propriétaire (rubrique Joueurs, plan, actions)

### 0.1 État réel

**Déployé en production (SHA `faf25e1`) — en attente de recette.**

Le menu groupé du 04/11 était déjà en ligne depuis le déploiement `f3892a6` (#25), qui contenait `develop`. Ce
déploiement ajoute les corrections demandées le 05/11.

### 0.2 Demande du propriétaire

[Commentaire du 05/11](https://github.com/ReC82/Dig/issues/70#issuecomment-6656911347). Pour réinitialiser un joueur
(#75), il fallait passer par « Économie & joueurs », descendre sous les barèmes jusqu'à « DEBUG JOUEUR », chercher le
pseudo, ouvrir la fiche puis « Essais de test ». Sans accompagnement, ce chemin était introuvable. Six demandes :
(1) une vraie rubrique Joueurs ; (2) des sous-menus pour l'Économie ; (3) un plan de navigation à jour, avec les actions
courantes ; (4) une recherche qui trouve les actions ; (5) pas de long formulaire ouvert d'office, et aucune action
déclenchée par la navigation ; (6) des essais sur PC et mobile, puis un déploiement.

### 0.3 Changements réalisés

| Demande | Réalisé |
|---|---|
| (1) Rubrique Joueurs | Nouveau groupe **👥 Joueurs & testeurs**, en tête du menu : **👤 Joueurs**, 🛡 Anti-bot, 🧪 Bêta fermée. La rubrique Joueurs commence par une phrase d'aide, puis **🔎 Trouver un joueur** : la recherche du pseudo est en haut de page, visible sans défiler. La fiche affiche dans son en-tête les boutons **🧪 Essais de test**, **🛡 Anti-bot de ce joueur** (la fiche anti-bot en lecture seule s'ouvre par-dessus) et Fermer. Elle a trois sections repliables : 📈 Progression (ouverte) ; 🧪 Essais de test — recommencer un test à zéro, exports (ouverte) ; ⚠ Réinitialisation saisonnière partielle (**repliée par défaut**). |
| (2) Économie séparée | La rubrique s'appelle désormais **💰 Économie** et ne contient plus rien sur les joueurs. Elle a quatre sous-rubriques, une seule affichée à la fois : **Gains & coûts des coffres**, **Registre de gemmes**, **Règles économiques**, **Boutique en gemmes**. On les choisit dans le menu latéral (sous Économie) ou dans la barre en haut de page, qui reste disponible sur smartphone. Lien direct : `#economy/ledger`, par exemple. Une saisie reste en place quand on change de sous-rubrique ou de rubrique. |
| (3) Plan | Bouton **🧭 Plan & actions courantes**, sous la recherche du menu. Il ouvre 23 actions courantes (chacune avec son chemin et une aide d'une ligne) et l'arbre complet groupes › rubriques › sous-rubriques. Le plan est construit à partir des registres du code, il suit donc toujours le menu. Une copie lisible existe dans [`docs/admin-navigation.md`](../admin-navigation.md) ; un test échoue si une rubrique, une sous-rubrique ou une action en manque. |
| (4) Recherche d'actions | Le champ s'appelle « Rubrique ou action (ex. joueur, reset)… ». Les actions et sous-rubriques trouvées s'affichent en tête des résultats, avec leur chemin, et **Entrée** ouvre le premier résultat. Exemples : « recommencer » ou « reset » mène à Recommencer un test à zéro ; « joueur » à Trouver un joueur ; « invitation » à Préparer une invitation bêta ; « gains » à Modifier les gains ; « registre » à Économie › Registre de gemmes. La recherche ignore les accents. |
| (5) Rien de déclenché | Une action **amène seulement au bon endroit** : elle ouvre la rubrique et la sous-rubrique, déplie la section, place le curseur et signale l'endroit par un bref contour doré. Elle ne clique jamais sur un bouton, n'envoie rien au serveur et ne publie ni ne réinitialise rien. C'est vérifié par un test du code et au navigateur (aucune requête de réinitialisation, aucune confirmation ouverte). Pour une action liée à un joueur (« Recommencer un test à zéro ») sans fiche ouverte : le curseur se place sur la recherche du pseudo, une aide indique la suite, et une fois le joueur choisi la fiche s'ouvre directement sur 🧪 Essais de test. |
| Liens directs | `#players`, `#economy/gains`, `#a/reset-test`, etc. (liste complète dans `docs/admin-navigation.md`). Après F5, la rubrique et la sous-rubrique restent affichées. Un lien `#a/…` ne s'applique qu'une fois, à l'ouverture : il est ensuite remplacé par l'adresse de la rubrique, et un F5 n'y ramène pas. |

Fichiers : `public/admin/index.html` (section `tab-players` ; blocs `data-sub` dans Économie ; plan ; identifiants posés
sur 5 cartes cibles), `public/admin/admin.js` (registres `ADM_NAV` avec `subs`, `ADM_NAV_ACTIONS`, sous-rubriques,
recherche d'actions, plan, boutons de la fiche joueur), `public/admin/admin.css`, `docs/admin-navigation.md`, tests
`test/admin-nav.test.js`, `test/admin-news-ux.test.js`, `test/e2e/admin-nav.e2e.js`, `test/e2e/test-runs.e2e.js`.
Aucun changement côté serveur, aucune migration.

### 0.4 Vérifications

- `npm test` : branche **745/745** ; `develop` `faf25e1` **745/745** ; release `faf25e1` **745/745**. `npm run check` OK.
- Navigateur Chromium, serveur de test (port 3101, base de test neuve), **`admin-nav.e2e.js` : 38/38**, ordinateur
  1280×900 et smartphone 390×844, sans erreur JS. Sont couverts : recherche « joueur » puis « recommencer » + Entrée,
  qui mène à la rubrique Joueurs avec le curseur sur le pseudo ; choix du joueur, qui ouvre la fiche sur « Essais de
  test » sans rien déclencher ; anti-bot du joueur ; `#economy/ledger` et F5 ; saisie conservée entre sous-rubriques ;
  plan → « Modifier les gains » ; lien `#a/invite` dans un nouvel onglet ; garde « modifications non enregistrées » ;
  menu réduit ; recherche « reset » et plan sur smartphone, sans débordement.
- `test-runs.e2e.js` (#75, réinitialisation d'un joueur de TEST sur la base de test), passé par la nouvelle rubrique
  Joueurs : PC OK, mobile OK. `admin-layout.e2e.js` (#62) OK. `season-overview-width.e2e.js` OK.
- Non relancé : `admin-unsaved.e2e.js`, qui attend une collection `saint_martin` absente de la base de test neuve (même
  limite que le 04/11). Ses contrôles de navigation et de brouillon sont repris dans `admin-nav.e2e.js`.
- Aucune donnée réelle touchée : aucun reset, barème ni compte modifié. Les essais n'ont tourné que sur la base de test,
  supprimée ensuite.

### 0.5 Déploiement

- SHA déployé : **`faf25e1`** (précédent : `f3892a6`). Sauvegarde vérifiée avant déploiement :
  `~/backups/dig/dig-20261105-132144-pre-deploy-faf25e1.sqlite`.
- Avant : aucune génération IA en cours (dernier appel terminé à 12:53, plus d'activité admin depuis 12:54). Sur une
  copie de la base de production, la release a démarré et répondu à `/health` et `/api/version`. Les empreintes de
  `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` étaient identiques avant et
  après ce démarrage. La copie a ensuite été supprimée.
- Après : les deux domaines répondent 200 avec `1.0.0+faf25e1`. Le journal est sans erreur, `quick_check` = ok, et les
  empreintes des six tables sont **identiques** à la sauvegarde pré-déploiement. La page admin servie contient la
  rubrique Joueurs et le plan.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep f3892a6` puis `sudo systemctl restart dig`. Le lock npm est
  inchangé et il n'y a pas de migration.

### 0.6 Test fonctionnel à faire par le propriétaire (PC puis smartphone)

0. Recharger l'onglet admin déjà ouvert (F5) pour charger le nouveau code.
1. Taper « joueur » dans la recherche du menu, puis Entrée. Attendu : rubrique **👤 Joueurs**, curseur dans la
   recherche du pseudo, en haut de page.
2. Taper « recommencer » dans la recherche du menu, puis Entrée. Attendu : même rubrique, avec une aide « choisissez
   d'abord le joueur ». Taper `gabpok8` et choisir la suggestion. Attendu : la fiche s'ouvre **directement sur 🧪 Essais
   de test**, le bouton « Recommencer un test à zéro » est visible et **rien n'est lancé**. Ne pas cliquer si aucun
   reset n'est voulu.
3. Dans la fiche, cliquer sur « 🛡 Anti-bot de ce joueur ». Attendu : la fiche anti-bot du joueur s'ouvre par-dessus ;
   Fermer ramène à la rubrique Joueurs.
4. Ouvrir **🧭 Plan & actions courantes**, puis cliquer sur « Préparer une invitation bêta ». Attendu : rubrique Bêta
   fermée, focus sur « ➕ Inviter un testeur » ; aucune invitation n'est créée.
5. Ouvrir 💰 Économie, puis Registre de gemmes (menu latéral ou barre en page). Attendu : seul le registre est affiché.
   Après F5 : toujours le registre.
6. Sur smartphone : ☰ Rubriques, taper « reset », toucher le résultat. Attendu : rubrique Joueurs, menu refermé.

### 0.7 Classement MVP

**Après lancement** (ergonomie de la bêta, P1). Ce changement ne retarde pas les P0 anti-bot.

### 0.8 Choix techniques faits seul

- **Groupe « Joueurs & testeurs » en tête** (Joueurs, Anti-bot, Bêta fermée) plutôt qu'une rubrique isolée dans
  « Exploitation » : le propriétaire y va le plus souvent, et ces trois rubriques concernent les personnes.
  Exploitation & paramètres ne garde que Publicité et Configuration.
- **Sous-rubriques = une seule partie affichée à la fois.** Les autres sont seulement masquées, sans rechargement ni
  perte de saisie. Le bouton « Enregistrer les paramètres économiques » reste dans « Gains & coûts », dont il couvre les
  deux cartes (multiplicateurs et coûts des coffres).
- **Actions = navigation seulement**, jamais d'appui automatique sur un bouton. Une action qui ouvrirait une fiche ou
  lancerait une opération sortirait du cadre « aucune publication ni reset déclenché par la navigation ».
- **Résultats « actions » avant les rubriques** dans la recherche : Entrée sur « joueur » ouvre « Trouver un joueur »,
  qui place directement le curseur sur le pseudo.
- La réinitialisation saisonnière partielle est **repliée** dans la fiche, pour éviter la confusion avec
  « Recommencer un test à zéro ».

### 0.9 Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire.

### 0.10 Reste à faire

- Recette du propriétaire (ci-dessus).
- Suggestion, non réalisée (hors périmètre) : d'autres rubriques longues pourraient aussi passer en sous-rubriques avec
  le même mécanisme (`subs` + `data-sub`), par exemple Saison en cours ou Concours. À décider après la recette.

---

## 1. État réel — 04/11/2026

**Intégré dans `develop` (`e15e2ee`), non déployé.**

La suite complète de la release `e15e2ee` a donné 689/690. L'échec vient de `test/gem-ledger.test.js` « achats simultanés depuis 4 processus : jamais plus que le solde ». Ce test n'a aucun lien avec #70, qui ne modifie que le panel admin (HTML/CSS/JS du navigateur). Son instabilité est connue depuis #64 et #69. Les règles n'admettent une relance que pour le test `rate-limit`. Je n'ai donc ni relancé ni déployé.

Sur le même SHA, la suite complète a réussi dans le worktree d'intégration : **690/690**.

Production inchangée : `5fc77d9`. Le prochain déploiement de `develop` (ticket suivant) mettra #70 en ligne avec lui. Ce changement ne contient aucune migration et ne touche ni le serveur ni la base.

## 2. Résultat visible

La barre d'environ vingt-deux onglets, sur deux lignes, est remplacée par un **menu groupé** :

| Groupe | Rubriques (ordre du menu) |
|---|---|
| ⛏ Jeu & progression | 🧱 Blocs · 🎲 Coffres & drops · ⬆ Améliorations · 🔮 Reliques · 🎯 Missions quotidiennes · 💰 Économie & joueurs |
| 🏆 Saisons & compétition | 📊 Saison en cours *(ex « Ligues & Saisons »)* · 🗓 Historique des saisons *(ex « Saisons »)* · 🏅 Ligues · 🏆 Classement · ⭐ Points de récompense · 🛍 Boutique de cadeaux · 🎁 Concours |
| 📰 Contenu & événements | 📰 Actualités · 🎉 Événements · 📿 Collections · 🎖 Badges |
| 🎨 Visuels | 🎨 Atelier d'icônes (pictogrammes #67, coffres #66, souvenirs #65) |
| 🛠 Exploitation & paramètres | 🧪 Bêta fermée · 🛡 Anti-bot · 📢 Publicité · ⚙ Configuration |

- **PC** : menu latéral fixe de 236 px. Chaque groupe se replie (▾, `aria-expanded`). Le bouton « « » réduit le menu à une colonne d'icônes de 58 px, avec le nom en infobulle ; « » » le redéplie. Ces deux réglages sont mémorisés dans le navigateur. La rubrique active est surlignée en or, avec un trait à gauche et `aria-current="page"`. Son groupe est rouvert automatiquement.
- **Smartphone / fenêtre < 900 px** : sous l'en-tête, une barre « ☰ Rubriques · *rubrique actuelle* » reste accessible en haut pendant le défilement. Elle ouvre le menu complet ; choisir une rubrique le referme et remonte en haut de la page. Échap le referme aussi. Fermé, le menu ne recouvre aucun formulaire : seule la barre de 53 px reste visible.
- **« Aller à une rubrique… »** : champ de recherche en tête du menu. Il ignore les accents et cherche dans le nom, le groupe et des mots-clés (par exemple « ligues & saisons » retrouve « Saison en cours », « amelio » retrouve Améliorations). Entrée ouvre la première rubrique trouvée. La touche « / » (hors champ de saisie) place le curseur dans la recherche. ↑/↓ passent d'une entrée à l'autre.
- **F5 et liens directs** : comme avant, l'adresse se termine par `#rubrique` (par exemple `/admin/#news`). Après F5, on reste sur la même rubrique. Tous les anciens liens restent valables, car les identifiants n'ont pas changé (`#season-overview`, `#seasons`…). Un fragment inconnu affiche la rubrique par défaut (Historique des saisons, inchangée).
- **Aucune perte de saisie** : changer de rubrique masque seulement la page. Les formulaires de page (Configuration, Économie…) gardent leurs saisies, et quitter la page reste protégé (#60/#61). Une fiche ouverte est modale : on ne peut pas changer de rubrique derrière elle.
- **Signal d'anomalie** : un petit ⚠ discret, sans pastille de couleur ni compteur, apparaît sur la rubrique et sur son groupe, même replié ou réduit aux icônes. Il s'affiche **uniquement** pour deux faits réels :
  1. **aucune saison active** : signal calculé au chargement du panel, sur la réponse 404 du serveur ; rien n'est affiché si le serveur est injoignable ;
  2. **amélioration(s) suspendue(s) en urgence** (#69) : signal posé à l'ouverture de la rubrique Améliorations.

  L'explication s'affiche en infobulle.

Captures (Chromium, serveur de test) :
- PC 1280×900 : `docs/claude-reports/img/2026-11-04_ticket-70-pc.png`
- PC, menu réduit aux icônes : `docs/claude-reports/img/2026-11-04_ticket-70-pc-icones.png`
- Smartphone 390×844, menu ouvert : `docs/claude-reports/img/2026-11-04_ticket-70-mobile.png`

## 3. Changements techniques

- `public/admin/admin.js` : **registre unique** `ADM_NAV_GROUPS` + `ADM_NAV` (`id, group, order, icon, label, keywords, load, available`). Le menu est construit depuis ce registre, et le chargement de chaque rubrique y est déclaré : la chaîne de 21 `if (btn.dataset.tab === …)` disparaît. Une nouvelle rubrique tient en une ligne de registre plus sa `<section id="tab-…">`. Autres ajouts : `available()` (condition de disponibilité), `admNavFlag()` (signal), recherche, clavier, préférences.
- `public/admin/index.html` : la barre de boutons codés en dur est supprimée. À la place : `<nav id="admin-nav">` (bouton de menu mobile, bouton de réduction, recherche, groupes) et `<main id="admin-main">` autour des sections. Les sections et les fiches sont inchangées.
- `public/admin/admin.css` : grille menu + contenu, mode icônes et menu déroulant sous 900 px. Le conteneur commun des pages (#62 : 1440 px max, centré) est conservé, désormais centré dans la zone de contenu.
- Tests : nouveau `test/admin-nav.test.js` (8 tests : bijection registre ↔ sections, groupes, chargements branchés, HTML/ARIA, CSS, URL/stockage, signaux, recherche). Mise à jour de `admin-layout`, `admin-session`, `news`, `monthly-events` et `reward-tables`, qui cherchaient les anciens boutons dans le HTML.
- Essais navigateur : nouveau `test/e2e/admin-nav.e2e.js` et helper `test/e2e/_admin-nav.js`, qui ouvre une rubrique par le vrai menu à toute largeur. Les 15 parcours existants l'utilisent désormais. Les mesures de centrage #62 se font dans la zone de contenu.

## 4. Procédure de test (technique)

```
cd <worktree> && npm ci && npm test                       # 690/690 attendu
ADMIN_SECRET=<secret de test> SESSION_SECRET=$(openssl rand -hex 32) DB_FILE=test-70.sqlite PORT=3101 node server/index.js
PW=<…>/node_modules/playwright-core CHROME=<chrome> BASE=http://127.0.0.1:3101 ADMIN=<secret de test> OUT=/tmp/x \
  node test/e2e/admin-nav.e2e.js                           # « TOUT OK » (25 contrôles)
```

## 5. Vérifications effectuées

- `npm test` : branche 690/690 (après adaptation de deux tests existants, voir § 7) ; `develop` `e15e2ee` **690/690** ; release `e15e2ee` 689/690 (`gem-ledger`, voir § 1). `npm run check` OK.
- Chromium headless (`admin-nav.e2e.js`, **25/25**), PC 1280×900 et smartphone 390×844 :
  - menu en une seule colonne, 22 rubriques dans 5 groupes, aucun défilement horizontal ;
  - Blocs, Missions quotidiennes, Actualités puis F5 : même rubrique, marquée active ;
  - groupe replié, toujours replié après F5 ;
  - recherche, Entrée, message « aucune rubrique » ; « / » et ↓ ;
  - Configuration modifiée → autre rubrique → retour : saisie conservée, départ de la page protégé ;
  - fiche ouverte : le menu ne change pas de rubrique derrière elle ;
  - mode icônes à 58 px, mémorisé, navigation fonctionnelle ;
  - lien direct `#season-overview` ; fragment inconnu → rubrique par défaut ; lien interne vers l'Atelier d'icônes → bon groupe actif ;
  - mobile : barre fermée de 53 px ; ouverture avec `aria-expanded`, aucun libellé coupé ; choix « Blocs » → menu refermé ; Actualités puis F5 ; Échap ; barre accessible après défilement ; retour navigateur ;
  - aucune erreur JavaScript.
- Parcours existants relancés avec le nouveau menu : `admin-layout.e2e.js` (#62, 4 largeurs × 22 rubriques, Config) **OK**, `season-overview-width.e2e.js` **OK**.
- Non relancé : `admin-unsaved.e2e.js`, qui dépend d'une série de collection `saint_martin` absente de la base de test neuve. Les deux points qu'il couvre sur la navigation (saisie conservée, fiche modale) sont repris dans `admin-nav.e2e.js`.
- **Données des joueurs** : aucun impact. Pas de migration, pas de route serveur modifiée ; seuls les fichiers du panel admin changent.

## 6. Déploiement

**Non déployé** : la release `e15e2ee` a échoué sur le test `gem-ledger` (§ 1), et la règle « tout autre échec que `rate-limit` bloque » s'applique. Je n'ai donc pas fait de copie de base ni d'avance de `main`. Production : `5fc77d9`.

Le prochain déploiement ordinaire de `develop` emportera #70. Retour arrière : celui de `scripts/deploy.sh`, puisque ce sont des fichiers statiques seulement.

**Test fonctionnel à faire par le propriétaire (après déploiement, 3 min, rien n'est enregistré)** :
1. PC → https://dig.lodygames.com/admin/ (Ctrl+F5). À gauche, un menu en 5 groupes ; plus de bandeau d'onglets sur deux lignes.
2. Cliquer **Blocs**, puis **Missions quotidiennes**, puis **Actualités** ; après chaque clic, F5 → même rubrique.
3. Taper « eve » dans « Aller à une rubrique… » puis Entrée → Événements.
4. Cliquer « « » en haut du menu → colonne d'icônes, nom au survol ; « » » pour revenir.
5. ⚙ Configuration : modifier une valeur sans enregistrer → ouvrir Blocs → revenir : la valeur modifiée est toujours là. Recharger la page → avertissement du navigateur. Remettre la valeur.
6. Smartphone → /admin/ : barre « ☰ Rubriques · … » sous l'en-tête → l'ouvrir, choisir Actualités → le menu se referme sur la page Actualités ; aucun texte coupé.

Classement : **Après lancement** (confort d'administration ; aucun effet pour les joueurs).

## 7. Choix techniques faits seul

- **Pas de « Tableau de bord » artificiel** : aucune page de synthèse n'existe aujourd'hui, et le ticket demande de ne pas en construire sans données. « Ligues & Saisons » est en réalité le pilotage de la saison active (thèmes, date de fin, zone critique). Il devient « 📊 Saison en cours », en tête de « Saisons & compétition ». Un futur tableau de bord sera une simple ligne du registre.
- **Doublons d'intitulés levés** : « Saisons » / « Ligues & Saisons » deviennent « Historique des saisons » / « Saison en cours ». Les anciens noms restent trouvables par la recherche. **Boutique de cadeaux** est placée avec Points et Concours (échange de points saisonniers), et non dans Jeu.
- **Rubrique par défaut inchangée** (Historique des saisons), pour ne rien changer aux habitudes ni aux liens.
- **Historique navigateur** : je garde `replaceState` (décision #50-F déjà recettée). Le retour navigateur ne saute pas de rubrique en rubrique, et ne peut donc pas contourner une fiche protégée. Les liens directs `#rubrique` fonctionnent.
- **Préférences du menu dans le navigateur** (`localStorage`, clé `dig-admin-nav`) : seulement `collapsed` et `closed`, deux réglages purement visuels. Le test de sécurité #57 (« aucun stockage navigateur dans le panel ») est resserré : il vérifie que **seules** ces deux fonctions touchent le stockage et qu'elles ne stockent que ces deux champs. La clé admin n'est toujours conservée nulle part.
- **Signal d'anomalie limité à deux faits réels** (saison active absente, suspension d'urgence #69). Il n'y a ni compteur ni nouvel appel serveur : la vue Améliorations analyse les sauvegardes et serait trop coûteuse à chaque chargement du panel. Le signal Améliorations n'apparaît donc qu'après une ouverture de la rubrique.
- **Seuil mobile à 900 px**, pour qu'une tablette en portrait ait aussi le menu déroulant plutôt qu'une colonne étroite.

## 8. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire. Les noms et l'ordre des groupes se changent en une ligne dans `ADM_NAV_GROUPS` / `ADM_NAV` si vous souhaitez un autre regroupement.

## 9. Reste à faire / suggestions (non réalisées)

- Déploiement (au prochain déploiement de `develop`) puis recette.
- **Rendre robuste `gem-ledger` « achats simultanés depuis 4 processus »** (verrou SQLite entre processus sur machine chargée). Ce test a déjà bloqué les déploiements de #64 et de #70. Ticket séparé suggéré. Classement : Après lancement, mais il freine les livraisons.
- Futur tableau de bord (alertes d'exploitation centralisées : sauvegardes, budget IA, anti-bot) : à spécifier si souhaité.
