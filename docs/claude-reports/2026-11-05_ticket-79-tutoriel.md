# Ticket #79 — Tutoriel interactif facultatif à la première partie

Lien : https://github.com/ReC82/Dig/issues/79 · Session du 05/11/2026 (≈ 19 h, Bruxelles)

## 1. État réel

**Déployé en production (SHA `52a8fab`), en attente de recette du propriétaire.**
Classement : **Bloquant MVP public** (P1 bêta). Avec l'aide #78, il permet à un invité de comprendre le jeu sans explication orale.

## 2. Résultat visible

- **À la toute première partie**, une petite carte apparaît sous le bloc :
  - titre « Première partie ? » ;
  - texte « Découvre les bases en 6 petites étapes, ou passe directement au jeu. » ;
  - boutons **Passer** et **Découvrir le jeu**.

  La carte n'a pas de voile. Le jeu reste jouable, défilable et navigable pendant qu'elle est affichée.
- **Six étapes d'une phrase**. Chacune entoure la zone concernée d'un cadre doré pulsé, qui ne la masque pas et ne capte aucun clic :
  1. **Bloc** : « Touche le bloc pour le creuser. » Le premier coup fait passer à l'étape suivante.
  2. **Barre de PV + Dégâts** : « La barre montre les PV du bloc : chaque coup retire tes dégâts, jusqu'à le casser. »
  3. **Onglet Amélios + Coins** : « Chaque bloc cassé rapporte des pièces : ouvre « Amélios » pour choisir une amélioration. » Ouvrir Amélios fait passer à l'étape suivante. **Aucun changement d'onglet n'est imposé.**
  4. **Carte Auto-Dig** (amenée à l'écran par un défilement doux) : « L'Auto-Dig, dans « Amélios », frappe le bloc tout seul, même quand tu ne touches pas l'écran. »
  5. **Onglet Saison** : « Au classement de la saison, seuls les blocs cassés à la main comptent, pas la profondeur. »
  6. **Onglet Collection + bouton ?** : « Trouvailles, événements et reliques sont dans « Collection » ; le ? en haut rouvre l'aide et ce tutoriel. »
- **Boutons de chaque étape** : **Passer**, **Retour** (dès l'étape 2) et **Suivant** (**Terminer** à la dernière). Un indicateur « 2/6 » avec des points montre l'avancement.
  - **Échap** sur la carte = Passer.
  - Tous les boutons mesurent au moins 44 px de haut.
- **Fenêtres du jeu** : la carte se cache derrière la fiche Aide, un coffre, les gains hors ligne, les actualités, etc., puis réapparaît quand elles se ferment. Elle ne recouvre jamais la barre du bas.
- **Dans l'Aide (#78)**, sous « Comment jouer ? », un bloc « 🎓 Tutoriel interactif » propose :
  - « Lancer le tutoriel » (jamais commencé) ;
  - ou « Recommencer le tutoriel » (déjà vu) ;
  - ou « **Reprendre (étape 3/6)** » + « Recommencer » si le joueur avait passé en cours de route.

  La fiche se ferme et le tutoriel démarre sur l'écran du joueur.

## 3. À qui il est proposé (et à qui jamais)

Il est proposé **une seule fois**, si toutes ces conditions sont réunies :

- aucun état de tutoriel n'est enregistré, ni dans le navigateur ni dans le compte ;
- la partie est **neuve** à l'ouverture : aucun bloc cassé et profondeur 1 ;
- aucune partie du compte n'a été reprise depuis le serveur ;
- l'onglet Dig est affiché, sans autre fenêtre ouverte.

Conséquences :

- **Joueurs historiques** : ils ont déjà des blocs cassés, donc **aucune proposition**. Aucun état n'est écrit pour eux. Vérifié : 0 ligne dans `player_tutorial` après le déploiement.
- **Nouveau téléphone / PWA / restauration d'un compte existant** : l'état du compte (passé ou terminé) ou la partie reprise empêche la proposition.
- **Rechargement en plein tutoriel** : reprise à la même étape. **Passer** ou **Terminer** : plus jamais relancé automatiquement.
- **Déconnexion** : la partie du navigateur est vidée (comportement existant) et l'état local du tutoriel aussi. L'état reste dans le compte.

## 4. Fichiers

| Fichier | Rôle |
|---|---|
| `public/js/tutorial.js` (nouveau) | Module `DigTutorial` : étapes, carte, cadres, placement, état versionné, synchronisation avec le compte, entrée dans l'Aide |
| `server/tutorial.js` (nouveau) | Table `player_tutorial` (ajout seul) : version, état `started`/`done`/`skipped`, étape ; validation |
| `server/index.js` | `GET` / `PUT /api/me/tutorial` (joueur connecté uniquement), `tutorial.init()` |
| `server/rateLimits.js` | Limiteur `tutorial` : 30 / min / compte |
| `public/js/main.js` | Partie neuve mesurée à l'ouverture ; sauvegarde du compte reprise ; `DigTutorial.boot` une fois la session connue ; `onAccount` / `onLogout` |
| `public/js/help.js` | Bloc « Tutoriel interactif » dans « Comment jouer ? » |
| `public/js/i18n.js`, `i18n/it.json`, `public/js/locales/it.js` | Clés `tutorial.*` en FR / EN / NL / ES / IT (19 textes par langue). Italien reconstruit (`node tools/i18n/cli.js build it`, 840/840) |
| `public/index.html`, `public/css/style.css` | Chargement du module et styles (`.tuto-*`) |
| `test/tutorial.test.js` (nouveau) | 6 tests automatiques |
| `test/e2e/tutorial.e2e.js` (nouveau) | Parcours Chromium sur PC, 390 px et 320 px, compte, anglais |

## 5. SHA, branche et procédure de test

- Branche `feature/79-tutoriel` : `2bb200b`.
- **develop : `52a8fab`** (fusion), **déployé en production**.
- Tests automatiques : `npm test` → **801/801** (sur la branche, l'intégration et la release, au SHA exact).
- Parcours navigateur (serveur de test uniquement) :
  - `DB_FILE=test-79.sqlite PORT=3279 node server/index.js`
  - puis `DIG_E2E_BASE=http://127.0.0.1:3279 NODE_PATH=<playwright-core> node test/e2e/tutorial.e2e.js`
  - → **128/128 OK**.
- Non-régression #78 : `test/e2e/help.e2e.js` → **123/123 OK**, alors que la proposition du tutoriel est affichée.

## 6. Vérifications, limites, données joueurs

- **Automatiques** :
  - états et validation : version 1–99, état connu, étape 0–20 ;
  - une ligne par compte ;
  - **sauvegarde du joueur jamais touchée** ;
  - aucune colonne ajoutée à `users` ;
  - routes refusées aux invités (401) ;
  - textes complets dans les 5 langues, **une phrase par étape**, aucun chiffre ;
  - `tutorial.js` ne contient ni sauvegarde, ni achat, ni changement d'onglet, ni écriture dans `GameState`, ni autre API ;
  - le cadre ne capte aucun clic, il n'y a pas de voile ;
  - la décision de proposer est prise après la reprise du compte.
- **Navigateur** (PC 1280×900, 390×844, 320×640) :
  - proposition, parcours complet, Retour, avance automatique (coup sur le bloc, ouverture d'Amélios) ;
  - cadre autour de la carte Auto-Dig ;
  - Passer dès la proposition puis à l'étape 3, Reprendre et Recommencer depuis l'Aide, Échap ;
  - rechargement en cours de parcours ;
  - carte cachée derrière l'Aide ;
  - **joueur historique sans proposition** ;
  - **0 pièce donnée, 0 amélioration achetée, aucune écriture hors du jeu normal** ;
  - compte : état envoyé au serveur, **nouveau téléphone sans proposition** ;
  - anglais ;
  - aucune erreur de console.
- **Non vérifié** :
  - écoute réelle avec VoiceOver ou TalkBack : le balisage `dialog` non modal, `aria-live` et les libellés ont été contrôlés, pas l'écoute ;
  - PWA installée sur un vrai téléphone : le service worker met `js/tutorial.js` en cache comme les autres fichiers de la page.
- **Limite connue** : sur un navigateur partagé sans déconnexion, l'état local est commun à ce navigateur. C'est sans effet pratique, car un compte déjà joué n'est jamais « partie neuve ».
- **Données joueurs** :
  - migration en **ajout seul** : `CREATE TABLE IF NOT EXISTS player_tutorial`, idempotente ;
  - testée sur une copie de production en `NODE_ENV=production` ;
  - empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` **identiques** avant et après démarrage ;
  - copie supprimée.
- **Aucun effet** sur l'économie, les drops, les coûts, l'anti-bot, les compteurs manuels, les quêtes ou l'Auto-Dig.

## 7. Déploiement

- SHA déployé : **`52a8fab`** (`d9a96a0` → `52a8fab`, 4 commits, `npm ci` non nécessaire), le 05/11 à 19:03 (Bruxelles).
- Avant le redémarrage : aucune génération IA en cours (dernière activité à 15:50 UTC).
- Sauvegarde vérifiée : `~/backups/dig/dig-20261105-190356-pre-deploy-52a8fab.sqlite`.
- Après déploiement :
  - https://dig.lodygames.com et https://dig.lodylands.com répondent 200, version `1.0.0+52a8fab`, `js/tutorial.js` en 200 ;
  - journal sans erreur ;
  - `quick_check` = ok ;
  - empreintes joueurs = sauvegarde ;
  - `player_tutorial` vide ;
  - essai Chromium en production (invité neuf, PC et 390 px) : proposition affichée, « Passer » enregistré localement, **0 requête d'écriture, 0 erreur**.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep d9a96a0 && sudo systemctl restart dig`. La table ajoutée peut rester : elle est ignorée par l'ancienne version.

### Test fonctionnel à faire par le propriétaire (3 minutes)

1. **Première partie** : sur le téléphone, ouvrir https://dig.lodygames.com dans une **fenêtre de navigation privée** (navigateur vierge). Choisir la langue.
   **Attendu** : sous le bloc, la carte « Première partie ? » avec « Passer » et « Découvrir le jeu ».
2. Toucher « **Découvrir le jeu** » : 1/6, le bloc est entouré. **Toucher le bloc** : on passe seul à 2/6 (PV). Essayer « Retour » puis « Suivant ».
3. À 3/6, toucher l'onglet **Amélios** : on passe à 4/6 et la carte Auto-Dig est entourée. Puis « Suivant » jusqu'à « **Terminer** ».
   **Attendu** : aucune pièce ni amélioration offerte, aucun achat déclenché.
4. Recharger la page : **plus rien ne s'affiche**.
5. Toucher le **?** en haut à gauche : sous « Comment jouer ? », « 🎓 Tutoriel interactif → Recommencer le tutoriel ». Le toucher : la fiche se ferme, l'étape 1 revient. Toucher « **Passer** » à l'étape 3, puis rouvrir le **?** : « **Reprendre (étape 3/6)** ».
6. **Sur votre compte habituel** (fenêtre normale) : recharger.
   **Attendu** : **aucune proposition** (joueur historique).

## 8. Choix techniques faits seul

- **Carte sans voile plutôt qu'une fenêtre modale** : aucun piège, aucun scroll bloqué. Le jeu (Auto-Dig, boutons) continue. Le cadre doré ne capte pas les clics.
- **Pas de changement d'onglet automatique** : le tutoriel montre l'onglet, le joueur le touche lui-même. Il n'y a donc aucun clic involontaire sur un bouton d'achat. À la fermeture, la carte absorbe encore les appuis pendant le fondu (0,35 s).
- **Avance automatique sur l'action réelle** (coup sur le bloc, ouverture d'Amélios), mais **Suivant** suffit toujours : aucune étape n'exige des pièces, un achat, un bloc rare ou une gemme.
- **État dans une table à part** (`player_tutorial`), pas dans la sauvegarde ni dans `users` : la sauvegarde ne peut pas être corrompue et la table s'ajoute sans risque.
  - Règle de fusion : un état « terminé » ou « passé » du compte l'emporte sur un « en cours » local.
  - Un état local d'invité est envoyé au compte à la connexion ou à l'inscription.
- **Version 1 enregistrée** : un parcours révisé (version 2) ne sera pas relancé aux joueurs qui ont déjà un état.
- **Textes propres au tutoriel** (`tutorial.*`, une phrase) plutôt que les résumés de l'aide (2 à 5 phrases). Les noms d'onglets (« Amélios », « Collection ») sont repris du jeu dans la langue du joueur.
- **Italien** traduit dans cette session, sans appel d'API payant, comme pour #78.

## 9. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire. Les textes et l'ordre des étapes pourront être ajustés après la recette.

## 10. Reste à faire / suites proposées

- **Reset de test #75** : il ne remet pas l'état du tutoriel à zéro. Pour revoir la proposition sur un compte de test, utiliser « Recommencer » dans l'Aide ou une fenêtre privée sans connexion. On pourrait l'ajouter au reset complet. Après lancement.
- Écoute avec un vrai lecteur d'écran. Après lancement.
- Si la pioche à charges (#71) ou les missions serveur (#68) sont activées pour tous, une étape pourra être ajoutée (nouvelle version du parcours, sans relance aux anciens joueurs). Après lancement.
