# Ticket #78 — Aide du joueur : bouton dans l'en-tête, guide clair et ? contextuels

Lien : https://github.com/ReC82/Dig/issues/78 · Session du 05/11/2026 (≈ 17 h 45, Bruxelles)

## 1. État réel

**Déployé en production (SHA `b4d6ae4`) — en attente de recette du propriétaire.**
Classement : **Bloquant MVP public** (le ticket est P1 bêta : un joueur invité doit comprendre le jeu sans explication orale).

## 2. Résultat visible

- **Bouton Aide** (point d'interrogation cerclé) **tout en haut à gauche**, avant la cloche des actualités.
  Il a un intitulé accessible traduit (« Aide — comment jouer »), une zone tactile de 44 × 44 px
  (40 × 44 px sous 380 px de large) et ne chevauche ni la cloche, ni le logo, ni Profil/Paramètres,
  ni le bandeau BÊTA. Contrôlé à 1280 px, 390 px et 320 px.
- **Fiche Aide** ouverte par-dessus le jeu, qui continue de tourner (même gabarit que les actualités) :
  - « Comment jouer ? » en 4 étapes courtes ;
  - 20 rubriques **repliées** et regroupées par thème : *Les bases* (taper sur un bloc, pioche et dégâts,
    profondeur, améliorations, Auto-Dig), *Pièces, gemmes et bonus* (pièces, gemmes, fragments, boosts),
    *Coffres et collections* (coffres, collection, événements, reliques, badges), *Saison et classement*
    (saison, classement, ligues, points de récompense), *Chaque jour* (récompense quotidienne, missions du jour).
    Une seule rubrique est ouverte à la fois, pour que la fiche reste courte ;
  - **Questions fréquentes** : « Pourquoi mon rang ne dépend-il pas de ma profondeur ? », « L'Auto-Dig
    m'aide-t-il au classement ? », « Que garde-t-on à la fin d'une saison ? », « Ma progression est-elle
    sauvegardée ? », « Pourquoi le jeu me propose « Jouer ici » ? ».
  - La fiche se ferme avec ✕, Échap ou un clic à côté. Le focus revient au bouton d'origine et l'écran
    est exactement celui de départ.
- **? contextuels** discrets (pastille de 18 px, zone tactile de 28 px) à côté de : Collection, Événements
  (quand un événement est affiché), Reliques, Badges, Améliorations, Pioche, Auto-Dig, Fragments (carte
  d'achat de fragments), Coffres de saison, Gemmes (Boutique), Connexion quotidienne, Missions du jour,
  Saison, Classement et Ligue (carte du joueur connecté).
  Un appui ouvre une **bulle de 2 à 5 phrases** sous le ?, ou au-dessus s'il manque de place, avec
  « En savoir plus › » qui ouvre la fiche sur la bonne rubrique. La bulle fonctionne au toucher, sans
  survol. Elle n'a pas de voile : le défilement et les boutons du jeu restent utilisables, et un appui
  ailleurs ferme la bulle **et** fait l'action demandée.
- **Aucun effet sur la partie** : ni sauvegarde, ni achat, ni requête serveur, ni changement d'onglet
  (vérifié : 0 requête POST pendant l'utilisation de l'aide, en production comme en test).

## 3. Contenu et règles métier

Les textes décrivent le jeu **tel qu'il est déployé**, sans chiffres d'équilibrage. La seule exception
est la série de 7 jours, qui fait partie de la structure du jeu. Aucune fonction désactivée n'est promise :

- **Classement** : uniquement les blocs cassés à la main et validés par le serveur. L'Auto-Dig ne compte
  pas, la profondeur est affichée seulement pour information. À égalité, le premier joueur à atteindre le
  total passe devant ; pas de tirage au sort ; le classement est figé en fin de saison.
- **Collection des origines** (permanente), **collections de saison** (remplies seulement pendant leur
  saison, puis archivées) et **événements/souvenirs**, rangés à part.
- Fragments → reliques permanentes. Gemmes conservées d'une saison à l'autre dans la limite d'un plafond
  (c'est le cas en jeu). **La boutique de gemmes est décrite comme « Bientôt » : aucun achat n'est possible.**
- L'aide ne mentionne **ni** publicité réelle, **ni** concours, **ni** pioche à charges, car ces fonctions sont
  désactivées en production (vérifié en lecture seule). Le bouton « Doubler la récompense », présent en
  jeu, est décrit seulement comme une source de boost.
- Les noms des onglets et des boutons cités (« Amélios », « Réclamer », « Jouer ici »…) sont repris
  **du jeu lui-même** dans la langue du joueur : si un libellé change, l'aide suit automatiquement.

## 4. Fichiers

| Fichier | Rôle |
|---|---|
| `public/js/help.js` (nouveau) | Module `DigHelp` : liste des rubriques (source unique), fiche, bulles, ? délégués, API `DigHelp.open(id)` pour le tutoriel #79 |
| `public/js/i18n.js` | Clés `help.*` en fr / en / nl / es (88 textes par langue) |
| `i18n/it.json`, `public/js/locales/it.js` | Italien (preview) traduit par la session, sans coût d'API ; fichier reconstruit (`node tools/i18n/cli.js build it`), couverture 100 % |
| `public/index.html` | Bouton de l'en-tête, fiche `#help-panel`, ? statiques (titres placés dans un `<span>` pour que la traduction ne les efface pas) |
| `public/js/main.js` | ? dans les vues générées (Améliorations, Événements, Quotidien, Boutique, Saison), `DigHelp.init()` |
| `public/css/style.css` | Styles de l'aide (fin du fichier) |
| `test/help.test.js` (nouveau) | 5 tests automatiques |
| `test/e2e/help.e2e.js` (nouveau) | Parcours Chromium sur PC, 390 px et 320 px |

## 5. SHA, branche et procédure de test

- Branche `feature/78-aide-joueur` : `79c7a56` (fonctionnalité) puis `41fe02b` (garde pour le rendu isolé
  de `renderEvents`, utilisé par un test existant).
- **develop : `b4d6ae4`** (fusion), déployé en production.
- Tests automatiques : `npm test` → **793/793** (branche d'intégration et release, sur le SHA exact).
- Parcours navigateur (serveur de test uniquement) :
  `DB_FILE=test-78.sqlite PORT=3279 node server/index.js`, puis
  `DIG_E2E_BASE=http://127.0.0.1:3279 NODE_PATH=<playwright-core> node test/e2e/help.e2e.js`
  → **123/123 OK**.

## 6. Vérifications, limites, données joueurs

- Automatiques (`test/help.test.js`) :
  - place du bouton et intitulé accessible ;
  - toutes les clés présentes dans les 5 langues ;
  - résumés de 2 à 5 phrases ;
  - aucun chiffre figé ni fonction désactivée dans les textes ;
  - règles du classement et des événements ;
  - chaque ? pointe vers une rubrique existante ;
  - aucun appel de sauvegarde, de requête, d'achat ou de changement d'onglet dans `help.js` ;
  - textes échappés.
- Navigateur (PC 1280×900, smartphone 390×844, petit écran 320×640) :
  - pas de chevauchement dans l'en-tête ni de débordement horizontal ;
  - focus sur ✕ à l'ouverture, Tab reste dans la fiche, Échap ferme et rend le focus ;
  - une seule rubrique ouverte à la fois ;
  - bloc et PV identiques avant et après ;
  - bulles dans l'écran ;
  - « En savoir plus » ouvre la bonne rubrique ;
  - un appui sur la navigation ferme la bulle et change d'onglet ;
  - anglais et italien corrects ;
  - aucune erreur console.
- **PWA** : le service worker met automatiquement en cache le nouveau fichier `js/help.js?v=…` (liste
  tirée de la page). Aucun test n'a été fait dans une PWA installée sur un vrai téléphone.
- **Non vérifié** : lecteur d'écran réel (VoiceOver/TalkBack). Le balisage `dialog`, `aria-*` et les
  intitulés a été contrôlé, mais pas l'écoute.
- **Données joueurs** : aucune migration, aucune écriture ; empreintes `users`, `user_saves`,
  `season_rankings`, `seasons`, `leagues` et `player_click_tracking` identiques avant et après démarrage
  sur une copie de production, et identiques à la sauvegarde pré-déploiement après le déploiement.

## 7. Déploiement

- SHA déployé : **`b4d6ae4`** (`8bd26c6` → `b4d6ae4`, 5 commits, `npm ci` non nécessaire), le 05/11 à 17:45.
- Sauvegarde vérifiée : `~/backups/dig/dig-20261105-174552-pre-deploy-b4d6ae4.sqlite`.
- Après déploiement :
  - https://dig.lodygames.com et https://dig.lodylands.com répondent 200, version `1.0.0+b4d6ae4` ;
  - journal sans erreur ;
  - `quick_check` = ok ;
  - empreintes joueurs = sauvegarde ;
  - essai Chromium en production (invité, aide seulement) sur PC et mobile : fiche et bulle OK, 0 requête
    POST, 0 erreur.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 8bd26c6 && sudo systemctl restart dig`.
  Aucune donnée n'est concernée.

### Test fonctionnel à faire par le propriétaire (2 minutes, rien n'est enregistré)

1. Sur le téléphone, recharger https://dig.lodygames.com. En haut à gauche, un **?** cerclé apparaît
   avant la cloche ; rien ne se chevauche.
2. Toucher le **?** : la fiche « Aide » s'ouvre avec « Comment jouer ? ». Ouvrir « Classement » puis
   « Auto-Dig » : une seule rubrique reste ouverte. Fermer avec ✕ : on revient sur le même bloc, avec
   les mêmes PV.
3. Onglet **Collection** : toucher le petit **?** à côté de « Collection » → une bulle courte s'affiche.
   Toucher « En savoir plus » → la fiche s'ouvre sur « Collection ». Fermer.
4. Descendre jusqu'à **Reliques** → **?** → bulle ; toucher l'onglet **Amélios** : la bulle se ferme et
   l'onglet change. Essayer les **?** de la Pioche et de l'Auto-Dig.
5. Onglet **Saison** → **?** de « Classement — blocs détruits manuellement » : la bulle explique que seuls
   les blocs cassés à la main et validés comptent.
6. Facultatif : Paramètres → English, puis rouvrir l'aide : tout est en anglais.

Résultat attendu : aide lisible et courte, aucune perte de partie, aucun achat ni sauvegarde déclenchés.

## 8. Choix techniques faits seul

- **Fiche par-dessus le jeu plutôt qu'un onglet** : retour exact à l'écran d'origine sans toucher à la
  navigation, et le jeu (Auto-Dig) continue de tourner, comme pour les actualités (#50).
- **Bulle sans voile** et ancrée au ? : rien ne bloque le défilement ni les boutons. Elle se replace en
  cas de défilement et se ferme si son ? disparaît.
- **Une rubrique ouverte à la fois**, pour respecter la consigne « ne pas afficher toutes les règles
  simultanément ».
- **Italien traduit dans cette session**, comme pour les tickets précédents, sans appel d'API payant.
  Pour une future langue sans traduction, la fiche affiche une mention explicite de repli en français.
- **Pictogramme de l'en-tête en SVG intégré**, dans le même style que la cloche et l'engrenage : aucune
  image générée. Il n'est pas relié à l'atelier d'icônes ; on pourra le faire plus tard si le
  propriétaire veut un pictogramme d'atelier.
- **Pas de ? sur la carte des points de récompense** : la rubrique « Points de récompense » est dans la
  fiche ; un ? dans cette carte repliable aurait encombré l'écran.

## 9. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire. Le style des textes et des ? peut être ajusté après la recette.

## 10. Reste à faire / suites proposées

- **#79 (tutoriel interactif)** : le tutoriel doit réutiliser `DigHelp.open('<rubrique>')` et les clés
  `help.topics.*` au lieu de réécrire les explications. C'est à faire dans #79, pas ici.
- Si les missions du serveur (#68) ou la pioche à charges (#71) sont activées pour tous, il faudra relire
  les rubriques « Missions du jour » et « Pioche » (et ajouter une rubrique « charges »). Après lancement.
- Test avec un vrai lecteur d'écran (VoiceOver/TalkBack). Après lancement.
