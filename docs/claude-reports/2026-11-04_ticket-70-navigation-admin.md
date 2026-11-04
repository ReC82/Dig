# Ticket #70 — Admin : navigation en sections et sous-menus évolutifs

- Ticket : [#70 — [P1] Admin — réorganiser la navigation en sections et sous-menus évolutifs](https://github.com/ReC82/Dig/issues/70)
- Branche : `feature/70-navigation-admin` (code `70ffb91`)
- `develop` : `e15e2ee` (fusion du code), puis le commit de ce rapport

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
