# Ticket #91 — Détecter les autoclickers en secondes et préparer des suspensions graduées sans faux positifs

- Ticket : #91 « [P0][SÉCURITÉ] Détecter autoclickers en secondes et préparer suspensions graduées sans faux positifs » — https://github.com/ReC82/Dig/issues/91
- Session du 08/11/2026 (DIGORCH), lot 1 (autoclickers basiques) demandé par le propriétaire le 08/11.

## 1. État réel

**Déployé en production (SHA `4f3c8fd`, 08/11/2026 20:10 Bruxelles) — actif pour tous les joueurs (mode global Appliqué), en attente de recette du propriétaire.**

Classement : **Bloquant MVP public / concours des collègues (09/11 → 16/11)**. Lot 2 (autoclickers à cadence aléatoire, mouvements simulés, clients modifiés) : **après lancement**.

## 2. Audit : pourquoi l'OP Auto Clicker à 125 ms passait

Constats sur le code avant ce ticket et sur les traces réelles du compte du propriétaire du 08/11 (lecture seule de la base) :

| Mesure | Existait ? | Ce qui se passait |
|---|---|---|
| Horodatage des clics | Oui, résumé en 8 classes (< 40, < 60, < 80, < 100, < 150, < 250, < 500, ≥ 500 ms) | Les 96 clics d'une fenêtre de 12 s tombaient tous dans la classe 100–150 ms : trop large pour distinguer 125 ms exacts d'un humain. |
| Régularité (CV) | Oui, coefficient de variation | **Fragile** : un seul intervalle long (coffre, animation) faisait passer le CV de 0,04 à 0,36 dans la trace réelle. Indice `regular_clicks` à 200 clics et CV < 0,03 seulement, et +2 points de risque. |
| Coordonnées / même pixel | **Non** | Jamais relevées. |
| Mouvement du pointeur | **Non** | Jamais relevé. |
| `isTrusted` | Oui | Trace réelle 12:48–13:07 : 100 % de clics non fiables (extension), mais indice plafonné à 25 points (seuil de vérification à 60). |
| Cadence | Oui (#10, #74) | 8 clics/s = exactement le seuil (`max_effective_cps` 8, frappe 12/s) : rien n'était rejeté. |
| Durée | Oui (lot C) | Vérification seulement après 60 min de minage continu ; après une vérification résolue, la reprise immédiate n'était pas sanctionnée. |

Ne pas confondre : les mesures portent sur des **clics** (coups de pioche). Les **blocs manuels** (classement #73) et la **profondeur** sont validés à part (#9, budget #25) et restent gelés pendant une vérification ou une suspension.

## 3. Ce qui a été réalisé

### Mesures ajoutées dans le jeu (navigateur, `public/js/main.js`)
Jointes à chaque sauvegarde (≈ 12 s), sans horodatage brut ni donnée personnelle :
- **même pixel** : plus longue série de coups aux mêmes coordonnées exactes (souris ou tactile ; **clavier exclu**, donc les joueurs au clavier ou avec un contacteur d'accessibilité ne sont jamais comptés) ;
- **souris immobile** : coups sans déplacement réel du pointeur depuis le coup précédent ;
- **rythme** : médiane, écart robuste (MAD) et part des intervalles dans les 3 classes de 4 ms les plus remplies ;
- **horloge grossière** (protection anti-empreinte Firefox/Tor) : le rythme est alors « inconnu », jamais retenu ;
- au **25ᵉ coup au même pixel**, la sauvegarde part tout de suite (vérification en quelques secondes au lieu d'attendre 12 s).

### Décision côté serveur (`server/autoclickDetector.js`, branché sur les défis/suspensions #25)
| Règle | Condition | Réponse |
|---|---|---|
| 1 | 25 coups consécutifs au même pixel (réglable) | **Vérification (énigme)** — jamais une suspension ; au plus une par 30 min (`ab_cooldown_min`) pour ne pas harceler un joueur dont la souris est posée |
| 2 | **rythme de machine** (≥ 40 intervalles, écart robuste ≤ 5 % ou ≥ 80 % dans 3 classes de 4 ms) **+ même pixel + un 3ᵉ indice** : souris immobile (≥ 90 %), clics générés par script (≥ 50 %) ou cadence stable mesurée par le **serveur** (±2 % sur 4 des 5 dernières fenêtres) | Vérification immédiate |
| 3 | règle 2 sur **2 fenêtres consécutives (≈ 24 s)** moins de 60 min après une vérification #91 **résolue** | **Suspension du minage manuel** au palier suivant 5 → 15 → 30 → 60 → 120 → 720 → 1440 min + nouvelle vérification ; −1 palier après 30 jours sans récidive (existant) |

Jamais de suspension pour : des clics au même pixel seuls, une cadence élevée seule, une énigme ratée ou expirée. L'option A de #25 (cumuls 6 h / 24 h conservés) est inchangée ; l'option B n'est pas appliquée ; le chrono d'énigme (30 s visuel / 60 s accessible) est inchangé.

### Pendant une vérification ou une suspension
Inchangé (#25) : le jeu bloque les coups manuels ; le serveur ne crédite **ni blocs manuels classés ni profondeur** issus des clics ; Auto-Dig, pièces déjà gagnées, inventaire, boutique restent intacts. **Aucun retrait rétroactif** de blocs, profondeur, monnaie ou fragments (voir décisions demandées).

### Joueur
Message de suspension explicite dans les 5 langues : « Des clics automatiques (même rythme, même point) ont repris juste après une vérification : le minage manuel est suspendu jusqu'au … (heure de Bruxelles) ». Bouton « 🐞 Signaler une erreur » (#84) toujours présent.

### Admin
- **Anti-bot → Réglages** (pli) : résumé visible « autoclickers : détection ON, 25 clics même pixel ON, suspension ON » et 3 boutons ON/OFF (arrêt d'urgence immédiat, confirmation). Le bouton global Observation/Désactivé reste prioritaire.
- **Config → Protections** : `ab_fast_mode`, `ab_same_pixel_mode`, `ab_same_pixel_clicks` (25), `ab_fast_suspend`, `ab_fast_repeat_min` (60).
- **Fiche joueur → vue essentielle** : 5ᵉ carte « Autoclicker — détection rapide (#91) » en clair : ✔/✘ rythme de machine (écart en %, médiane), même pixel (n clics de suite), souris immobile (n/n), clics générés par script, cadence stable serveur, nombre de détections. Raison des suspensions dans les tableaux (« autoclicker revu juste après une vérification résolue »). Levée de suspension et annulation de vérification : boutons existants.
- Journal : nouveau type `suspension_shadow` (suspension qui aurait été appliquée en mode Observation).

### Fichiers
`server/autoclickDetector.js` (nouveau), `server/antibotResponses.js`, `server/antibot.js`, `server/seasons.js`, `server/index.js`, `server/db.js` (colonne `antibot_activity.fast_state` ajoutée, 5 réglages ajoutés si absents), `public/js/main.js`, `public/js/antibotGate.js`, `public/js/i18n.js`, `public/js/locales/it.js` + `i18n/it.json`, `public/admin/admin.js`, `public/admin/index.html`, `docs/ANTI-BOT.md` § 13, tests `test/autoclick-fast-91.test.js`, `test/e2e/autoclick-fast-91.e2e.js`, `test/e2e/admin-antibot-sheet.e2e.js` (5 cartes).

## 4. SHA, branche, procédure de test

- Branche : `feature/91-autoclicker-rapide` — commit `3dd1ee7` ; **develop : `4f3c8fd`**.
- `npm test` : **988/988** (branche) ; **988/988** (release, SHA exact `4f3c8fd` ; un 1ᵉʳ passage avait bloqué 120 s sur le sous-test HTTP de `test/antibot.test.js` — repassé 2/2 seul puis suite complète relancée : 988/988) (release, SHA exact `4f3c8fd`).
- `node --test test/autoclick-fast-91.test.js` (19 tests) : profils, faux positifs, pipeline réel en Appliqué / Observation, interrupteurs, fiche admin.
- Essai navigateur réel (Chromium, serveur de test 3101) : `PW=… CHROME=… BASE=http://127.0.0.1:3101 ADMIN=<secret> node test/e2e/autoclick-fast-91.e2e.js` → **TOUT OK**.

### Résultats mesurés
| Scénario | Résultat |
|---|---|
| Autoclicker souris 125 ms, même pixel, souris immobile (Chromium réel) | vérification après **5,3 s** ; énigme résolue puis reprise → **suspension 5 min 28 s après la reprise** (écart robuste mesuré 4,1 %) |
| Même scénario en simulation (gigue 5 ms) | vérification à 3,2 s ; suspension 24 s après la reprise ; 2ᵉ récidive → 15 min |
| Extension (clics générés par script) | corroboré (3ᵉ indice = clics non fiables) |
| Autoclicker tactile Android (clics fiables) | vérification au 25ᵉ tap ; corroboré quand la cadence serveur est stable (≈ 50 s) |
| Smartphone 390×844, tapotements au même point (Chromium réel) | vérification après **5,1 s** |
| Humain qui bouge la souris, rythme irrégulier (réel) | **aucune vérification** |
| Joueur PC souris immobile, rythme humain (réel) | vérification « même pixel » seulement ; reprise 40 s : ni nouvelle vérification ni suspension. Simulation 2 h : 4 vérifications (1 / 30 min), **0 suspension** |
| Cadence bruitée ±10 % / ±35 % (lot 2) | pas de « rythme machine » : vérifications « même pixel », pas de suspension automatique |
| Clavier / accessibilité | ni même pixel ni immobilité : non concerné |
| Faux « rythme machine » (2 000 fenêtres de 12 s par profil) | humain CV 8 %, 12 %, 20 %, log-normal : **0** ; humain exceptionnellement régulier CV 5 % : 53 % des fenêtres (voir limites) |
| Mode Observation | vérifications simulées + `suspension_shadow` journalisée, rien d'appliqué |
| Interrupteurs | OFF détection → rien ; OFF même pixel → seul l'autoclicker corroboré ; OFF suspension → vérifications seules |

## 5. Vérifications, limites, données joueurs

- **Données joueurs** : aucune suppression ni réécriture ; migration = 1 colonne ajoutée (`antibot_activity.fast_state`) + 5 réglages ajoutés s'ils manquent. Testée sur une copie de la base de production (empreintes identiques).
- **Ce que l'on peut garantir** : un autoclicker grand public (OP Auto Clicker, extension Chrome, appli tactile) à cadence fixe et position fixe est arrêté en secondes, puis suspendu s'il reprend après l'énigme.
- **Ce que l'on ne peut pas garantir** : la télémétrie vient du navigateur et peut être falsifiée par un client modifié (il peut prétendre bouger la souris). Restent alors côté serveur : la cadence stable (horloge serveur), les plafonds de cadence #9/#10/#74, le budget de dégâts, les vérifications de durée (#25). Les autoclickers à cadence aléatoire et mouvements simulés relèvent du **lot 2**. La détection des extensions par signature est le ticket #92.
- **Faux positifs possibles** : un joueur PC qui garde la souris posée reçoit une vérification au plus toutes les 30 min (règle 1, demandée par le propriétaire). Un humain **exceptionnellement régulier** (écart ≈ 5 %, à 8 clics/s, souris totalement immobile, au même pixel) pourrait être suspendu 5 min s'il enchaîne 24 s ainsi dans l'heure qui suit une vérification : jugé très improbable, levée en un clic par l'admin, signalement possible par le joueur.
- **Non vérifié** : vrai OP Auto Clicker Windows (pas de Windows sur le serveur) — c'est le test de recette du propriétaire ci-dessous ; Firefox/Safari.

## 6. Déploiement

- **SHA déployé : `4f3c8fd`** (08/11 20:10 Bruxelles), `main` avancé en avance rapide depuis `4682799`.
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261108-201031-pre-deploy-4f3c8fd.sqlite`.
- Avant : suite complète sur le SHA exact (988/988) ; migration testée sur une copie de la base de production en `NODE_ENV=production` (santé, version, `antibot_activity.fast_state` ajouté, 5 réglages ajoutés, empreintes `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking` identiques ; copie supprimée).
- Après : dig.lodygames.com et dig.lodylands.com → 200, `/api/version` = `1.0.0+4f3c8fd` ; journal sans erreur (seule ligne : migration) ; `pragma quick_check` = ok ; empreintes joueurs identiques à la sauvegarde ; réglages en base : `ab_fast_mode` on, `ab_same_pixel_mode` on, `ab_same_pixel_clicks` 25, `ab_fast_suspend` on, `ab_fast_repeat_min` 60, `antibot_response_mode` enforce (inchangé) ; `/api/seasons/current` transmet `samePixelClicks: 25` ; Chromium visiteur 1280 et 390 : nouveau code chargé, 0 erreur JS.
- **Ce qui est ON pour tous** : détection rapide, vérification à 25 clics au même pixel, suspension graduée sur autoclicker corroboré revu. **OFF / inchangé** : `antibot_mode` shadow (score de risque), `exact_hp_mode` shadow (#77), détection d'extensions (#92, non livré).
- Retour arrière immédiat : `git -C /home/ubuntu/Dig reset --keep 4682799` + `sudo systemctl restart dig` (la colonne ajoutée est ignorée par l'ancien code) ; ou, sans redéploiement, Admin → Anti-bot → Réglages → « Détection : OFF ».

### Test fonctionnel à faire par le propriétaire (≈ 5 min, compte « lody »)
1. Recharger le jeu (F5) sur PC pour obtenir la nouvelle version.
2. Lancer OP Auto Clicker à **125 ms**, souris posée au centre du bloc.
   → Attendu : la fenêtre « Petite vérification » apparaît en **moins de 10 s**.
3. Arrêter l'autoclicker, résoudre l'énigme, puis **relancer aussitôt** l'autoclicker.
   → Attendu : en ≈ 30 s, « ⏸️ Minage manuel en pause … Des clics automatiques (même rythme, même point) … jusqu'au HH:MM » (5 min).
4. Admin → Anti-bot → chercher « lody » : carte « Autoclicker — détection rapide (#91) » = « autoclicker corroboré », ✔ rythme / même pixel / souris immobile ; tableau des suspensions : palier 1, raison « autoclicker revu… » → bouton **Lever** pour reprendre tout de suite (puis Annuler la vérification ou la résoudre ; « Palier » de la fiche → 0 pour remettre le test à zéro).
5. Témoin : jouer à la main en bougeant la souris 1 min → aucune vérification.
6. Arrêt d'urgence si besoin : Admin → Anti-bot → Réglages → « Détection : ON » → OFF (ou mode global Observation).

## 7. Choix techniques faits seul

- **Écart robuste (MAD) plutôt que CV** : un seul intervalle long faussait le CV ; la MAD ignore coffres et animations. Seuil 5 % calibré par simulation (autoclicker gigue 5 ms détecté à 98 %, humain CV 8 % : 0 fenêtre sur 2 000) et validé dans Chromium réel (4,1 %).
- **Suspension sur 2 fenêtres consécutives** après une vérification résolue (≈ 24 s) : deux observations indépendantes, exigence « plusieurs observations » du ticket ; une fenêtre isolée attend sa confirmation.
- **Clavier exclu** du « même pixel » et de l'immobilité (accessibilité, coups sans coordonnées fiables — demande du 08/11).
- **Réglages activés par défaut** (`on`, 25, 60 min) : décision du propriétaire du 08/11 « activer globalement maintenant » ; réglables et coupables dans l'admin, une valeur changée par le propriétaire n'est jamais réécrite.
- Comparaison des fenêtres 10/20/30/60 s : la fenêtre de base est la sauvegarde (≈ 12 s, ou ≈ 3 s au 25ᵉ clic au même pixel) ; vérification à 3–6 s, suspension à ≈ 24–30 s de reprise, cadence serveur stable à ≈ 50 s (4 fenêtres).

## 8. Décisions demandées au propriétaire

1. **Clics et gains de la fenêtre suspecte** (avant la vérification) — options : (A, recommandé) ne rien retirer, gel prospectif seulement (actuel) ; (B) retirer du **classement** les blocs manuels des 30 s précédant une suspension confirmée (profondeur, pièces, fragments intacts) ; (C) quarantaine traçable des blocs classés de la fenêtre, réintégrés si la suspension est levée. Rien n'est appliqué sans votre accord.
2. **Fréquence de la vérification « même pixel » pour une souris posée** : 1 par 30 min actuellement (réglage « Délai minimal entre deux défis »). Recommandation : garder 30 min pendant le concours, puis décider avec les retours des collègues.
3. **Lot 2** (cadence aléatoire, mouvements simulés, bot supervisé qui résout les énigmes) : à lancer après votre recette du lot 1 ? Recommandé : oui, après le concours.

## 9. Reste à réaliser

- Recette du propriétaire avec le vrai OP Auto Clicker (étapes § 6).
- Lot 2 (après lancement) ; #92 (signatures d'extensions, OFF par défaut).
- Décision 1 (sort des gains de la fenêtre suspecte).
