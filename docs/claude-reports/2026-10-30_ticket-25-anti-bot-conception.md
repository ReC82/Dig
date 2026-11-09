# Ticket #25 — [P1] Protection anti-bot globale — détection, progression serveur et sanctions graduelles

- Ticket : https://github.com/ReC82/Dig/issues/25
- Conception : [`docs/ANTI-BOT.md`](../ANTI-BOT.md) (§ 10 = ce qui est réellement en place)
- Session 1 (30/10/2026, nuit) : phase 1, audit et conception — branche `docs/25-anti-bot-conception`
- **Session 2 (30/10/2026, midi) : phase 2, lots A et B réalisés et déployés** — branche
  `feature/25-anti-bot-lots-ab`
- **Session 3 (03/11/2026) : recette propriétaire — journaux anti-bot / anti-autoclicker clarifiés,
  filtres corrigés, derniers contrôles par joueur ; déployé `9731025`**
- **Session 4 (05/11/2026, nuit) : premier test de résistance réel (`gabpok8`) — fiche diagnostique
  par joueur dans Admin → Anti-bot, mesures par sauvegarde, explication score 40 / shadow / enforce ;
  déployé `3f726c2`** (section « Session 4 » en fin de document)
- **Session du 07/11/2026 (après-midi) : recette du défi manuel — pictogramme « pièce » en carré
  vide corrigé (SVG locaux) ; déployé `510a1df`** (dernière section du document)
- **Session du 08/11/2026 (fin d'après-midi) : Appliqué pour tous, arrêt d'urgence, chrono de l'énigme 30 s / 60 s ; déployé `55240ce`** (dernière section)
- **Session du 08/11/2026 : recette #25-G — preuve du gel pendant un défi (audit : 0 bloc pendant le défi), relevés horodatés dans l'admin, coffres récupérés seuls en recette ; déployé `487ff7d`** (dernière section)

---

# Session 3 — 03/11/2026 : recette propriétaire, journaux anti-bot et anti-autoclicker

## 1. État réel

**Déployé en production (SHA `9731025`, 03/11/2026 14:06 Bruxelles) — en attente de recette.** Pas un bug du journal : chaque sauvegarde est contrôlée, seules les anomalies sont consignées. Deux défauts réels de filtrage ont été corrigés, et la lisibilité des deux journaux a été améliorée (admin uniquement).

Origine : deux commentaires de recette du propriétaire du 03/11/2026
([anti-autoclicker](https://github.com/ReC82/Dig/issues/25#issuecomment-6603362137),
[Anti-bot](https://github.com/ReC82/Dig/issues/25#issuecomment-6603450403)) : 16 anomalies,
toutes pour `lody`, la dernière le 29/10 ; aucune entrée pour `testeur` ; dans l'onglet Anti-bot,
seuls les filtres « Config admin » et « Actions admin » donnent des lignes. Question : bug du
journal, ou simple absence d'anomalie ? La largeur de la page (≈ 830 px, collée à gauche) est
traitée par le ticket transversal **#62**, comme le propriétaire l'a demandé.

## 2. Résultat de l'audit (lecture seule de la production, puis données synthétiques sur base isolée)

**Le système contrôle bien chaque sauvegarde.** Simplement, il ne journalise que les anomalies.

- Chaîne vérifiée dans le code : sauvegarde cloud (télémétrie jointe) → `syncPlayerRanking` →
  profondeur (#9) + budget de dégâts → compteurs forgés → télémétrie → anti-autoclic (#10) →
  score de risque → `security_events` / `anticheat_logs`. Une sauvegarde normale (action `none`)
  n'écrit **aucune** ligne, par conception.
- Production (copie lue le 03/11 vers 13:35) : `testeur` contrôlé pour la dernière fois le 03/11 à 12:31 UTC
  (37 m retenus, écart 0) et `lody` le 02/11 à 23:01 (124 m, écart 0). Aucun score de risque, aucun
  événement joueur : aucun seuil n'a été franchi. Les 16 anomalies du 29/10 sont réelles (20 à
  268 clics/s inférés, `flagged`/`reduced`, avant les corrections #9/#10).
- **Deux vrais défauts trouvés et corrigés :**
  1. Le filtre du journal anti-autoclicker ne triait que les **100 dernières lignes** dans le
     navigateur : une anomalie plus ancienne d'un autre type était cachée, et le total affiché ne
     tenait pas compte du filtre. Le filtre est maintenant fait par le serveur (SQL), avec le nombre
     de lignes du filtre.
  2. Le serveur émet `admin_login`, `admin_login_failed`, `standings_frozen` et
     `standings_freeze_failed`, mais aucune option du filtre ne permettait de les afficher. C'est
     pourquoi les 7 `standings_frozen` et la connexion admin n'apparaissaient que sous « Tous ».
- Ni la période ni le filtre ne masquaient d'événements joueur : la table n'en contient aucun.
- Les deux journaux sont **distincts** : `anticheat_logs` (Ligues & Saisons) et `security_events`
  (onglet Anti-bot, conservé 90 jours).

## 3. Changements réalisés (visibles uniquement dans l'admin)

- **Ligues & Saisons → « Journal des anomalies anti-autoclicker »** (nouveau titre). Une phrase
  explique que seules les anomalies sont consignées, pas les clics normaux, et que la date de la
  dernière ligne n'est pas celle du dernier contrôle. Une ligne de couverture s'ajoute :
  « Saison 8 : 2 joueur(s) suivi(s), 2 contrôlé(s) dans les 24 dernières heures — dernier contrôle
  le … ». Le filtre est fait par le serveur et propose aussi « Rejected ». Les états vides sont
  explicites.
- **🛡 Anti-bot :**
  - « Synthèse » : mode, sanctions désactivées, comptes suivis, comptes contrôlés sur 24 h,
    anomalies joueur et audit admin sur 24 h, 7 j et 30 j.
  - Nouveau tableau **« Derniers contrôles des joueurs »** : dernier contrôle, profondeur
    retenue, écarts, clics et blocs validés, score, résultat « normal », « en attente de crédit »
    ou « indices ». Ces valeurs sont lues dans l'état de validation existant : aucun journal
    supplémentaire, aucune IP.
  - Filtre en trois familles : **Anomalies joueur / Audit admin / Système**, chacune avec une
    option « toute la famille ». Tous les types émis ont maintenant leur option.
  - Filtre de période : 24 h, 7 j, 30 j, tout.
  - État vide explicite : « Aucune anomalie détectée dans cette catégorie sur cette période ».
- API admin : `GET /api/admin/security/events?group=player|admin|system&days=1|7|30` ;
  `/summary` renvoie aussi `eventsByGroup`, `checks`, `trackedAccounts`, `checkedLast24h` et
  `sanctionsApplied:false` ; `GET /api/admin/anticheat/logs?action=…` renvoie aussi `matching` et `coverage`.
- Fichiers : `server/antibot.js`, `server/db.js`, `server/index.js`, `public/admin/index.html`,
  `public/admin/admin.js`, `docs/ANTI-BOT.md` § 10.5, tests `test/antibot-journals.test.js`
  (nouveau) et `test/antibot.test.js`.
- Aucun réglage, seuil, sanction ni récompense modifié. Aucune migration.

## 4. SHA, branche, procédure de test

- Branche `feature/25-anti-bot-lots-ab`, commit `6ba72be` ; **develop `9731025`**.
- `npm test` → 534/534 (6 nouveaux tests sur base isolée et données synthétiques) :
  - un jeu normal donne `none` et aucune ligne ; un CPS excessif donne `flagged` journalisé ; plus
    de blocs que de clics donne `rejected` journalisé ;
  - une sauvegarde complète normale ne crée aucun événement de sécurité, mais le dernier contrôle
    apparaît dans la synthèse ; des compteurs forgés créent un événement et un changement de niveau ;
  - les types émis par le code, les familles et les options du filtre doivent rester identiques
    (même chose pour les actions anti-autoclicker) : un nouveau type sans filtre fait échouer le
    test ;
  - une anomalie ancienne reste trouvable derrière 150 lignes plus récentes ; les filtres par
    famille et par période sont vérifiés ; un test HTTP couvre les nouveaux paramètres.

## 5. Vérifications effectuées, limites, données

- Copie isolée de la base de production servie sur le port 3101, admin parcouru sous Chromium à
  1440×900 et 390×844 : aucune erreur JS. « Anomalies joueur » affiche l'état vide explicite ;
  « Classement figé, 7 j » montre 7 lignes ; « Reduced » montre 3 lignes sur 16 ; les deux joueurs
  sont « normal ». Copie supprimée après le contrôle.
- Copie de production démarrée en `NODE_ENV=production` avec la release : empreintes de `users`,
  `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` identiques ;
  aucune migration.
- **Limite** : zéro anomalie veut dire qu'aucun joueur réel n'a franchi de seuil. Les détecteurs
  sont éprouvés par les tests sur données synthétiques, pas en production, comme demandé (aucune
  fausse infraction créée).

## 6. Déploiement

- SHA déployé : **`9731025`** (`main` avancé d'abord en avance rapide depuis `d8d3e80`, sans `--force`). Le déploiement a été lancé le 03/11 à 14:06 Bruxelles, **après 10 min sans action admin** : le propriétaire générait des icônes IA, et un redémarrage aurait interrompu un appel payant en cours.
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261103-140654-pre-deploy-9731025.sqlite`.
- Après le déploiement :
  - dig.lodygames.com et dig.lodylands.com répondent 200, version `1.0.0+9731025` ;
  - journal de `dig.service` sans erreur ; `quick_check` ok ;
  - empreintes des 6 tables joueurs **identiques** à la sauvegarde ;
  - Chromium sur la production (jeu + page admin) à 1280×900 et 390×844 : aucune erreur JS.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep d8d3e80` puis `sudo systemctl restart dig` (aucune migration, lock inchangé).
- Recharger l'onglet admin (Ctrl+F5) pour obtenir le nouveau `admin.js`.

**Test fonctionnel à faire par le propriétaire (admin, sans rien modifier) :**
1. Admin → Ligues & Saisons : le journal s'appelle « Journal des anomalies anti-autoclicker », avec
   la phrase d'explication et la ligne « Saison 8 : N joueur(s) suivi(s)… dernier contrôle le … ».
   Choisir « Reduced » : « 3 anomalie(s) de ce type sur 16 au total ».
2. Admin → 🛡 Anti-bot :
   - la « Synthèse » indique « sanctions : désactivées » et le nombre de comptes suivis ;
   - « Derniers contrôles des joueurs » montre `testeur` avec l'heure de sa dernière sauvegarde
     (miner une minute en jeu avec `testeur`, puis Rafraîchir : l'heure avance, résultat « normal ») ;
   - Journal : « Classement figé » affiche les 7 gels ; « Toutes les anomalies joueur » affiche
     « Aucune anomalie détectée dans cette catégorie sur cette période… ».
3. Résultat attendu : aucune nouvelle ligne d'anomalie n'apparaît pour un minage normal ; c'est le
   comportement voulu.

Classement : **Après lancement** (lisibilité admin) ; le lot B déjà en production reste le seul
élément « Bloquant MVP » du #25 et il est livré.

## 7. Choix techniques faits seul

- Aucun journal ajouté pour les sauvegardes normales : le dernier contrôle se lit dans
  `player_depth_tracking` / `player_click_tracking`, déjà mis à jour à chaque sauvegarde, ce qui
  évite la croissance de la base et toute nouvelle donnée personnelle.
- Familles déclarées une seule fois (`antibot.EVENT_GROUPS`) et verrouillées par un test contre le
  code : le filtre ne peut plus diverger des types émis.
- Largeur et centrage non modifiés ici : ils sont confiés à #62, à la demande du propriétaire.

## 8. Décisions demandées au propriétaire

Aucune nouvelle décision nécessaire. Les questions optionnelles de la session 2 (lot C, défi,
éligibilité, contestation, lot D) restent ouvertes, sans urgence.

## 9. Éléments restant à réaliser

- #62 : largeur et centrage de l'onglet Anti-bot (et de Config).
- #60 : bouton Rafraîchir avec état visible.
- Lots C, D et E du #25 (après la période d'observation et les décisions ci-dessus).

---


# Session 2 — 30/10/2026 : lots A (observation) et B (budget de dégâts)

## 1. État réel

**Déployé en production (SHA `ea23431`) — en attente de recette.** Autorisation explicite du
propriétaire (commentaire du 30/10 sur #25) : développer, tester et déployer les lots A et B, sans
bannissement, CAPTCHA ni sanction hors A/B. Les décisions sur les lots C/D/E, l'éligibilité aux
récompenses et l'adresse de contestation restent ouvertes et ne bloquent pas A/B.

## 2. Résultat

**Pour un joueur normal, rien ne change** (aucun écran, aucune limite visible) ; pour un tricheur,
la profondeur classée ne peut plus monter plus vite que ce que permettent les dégâts maximum du jeu.

- **Lot B — budget de dégâts (appliqué).** La profondeur retenue pour le classement est aussi bornée
  par les dégâts qu'un joueur a pu infliger : clics × 25 PV (pioche 15 + relique +10) et temps réel
  × 25 PV/s (Auto-Dig 20 + marge 25 %), comparés aux **PV minimum** des blocs (bloc le plus faible,
  réduction de PV maximale de 50 %). Avant : 1 000 m possibles en 47 s et 5 000 m en 4 min avec des
  compteurs falsifiés cohérents ; maintenant ≥ 6 min 14 et ≥ 2 h 34. La profondeur retenue ne
  diminue jamais et la sauvegarde n'est jamais modifiée.
- **Lot A — observation (shadow, aucune sanction).** Journal `security_events` (IP hachées, purge à
  90 jours), score de risque par compte et par saison (décroît de moitié en 24 h, plafonné par
  catégorie), signaux serveur (compteurs forgés, profondeur rejetée, budget dépassé, plus de blocs
  que de clics, cadence) et télémétrie résumée du client (histogramme des intervalles, clics générés
  par script, type de pointeur, régularité). Les niveaux 1–4 sont calculés et journalisés mais
  **jamais appliqués**.
- **Interrupteurs** (admin, effet immédiat, changement journalisé) : `damage_budget_mode` =
  `enforce` (défaut) / `shadow` / `off` ; `antibot_mode` = `shadow` (défaut) / `off` (`enforce`
  refusé tant que le lot C n'est pas décidé). Variable `ANTIBOT=off` : coupe tout #25.
- **Audit admin** : toute action admin authentifiée qui modifie quelque chose est journalisée ; les
  changements de config le sont avec l'ancienne et la nouvelle valeur.
- **Vue admin** : onglet « 🛡 Anti-bot » (modes, comptes par niveau, comptes à risque, journal
  filtrable, temps de calcul par sauvegarde) et API `GET /api/admin/security/summary|events`.
- **Coffres** : limite propre de 30 ouvertures / min / compte.

## 3. Changements réalisés

| Fichier | Changement |
|---|---|
| `server/antibot.js` (nouveau) | Budget de dégâts, interrupteurs, journal de sécurité, score de risque, télémétrie, résumé admin, purge |
| `server/seasons.js` | `validateDepth` : budget de dégâts (enforce/shadow/off) ; `syncPlayerRanking` : collecte des signaux et mesure du temps de calcul |
| `server/db.js` | Ajouts seuls : colonnes `dmg_depth`, `dmg_credit`, `dmg_ref_clicks`, `dmg_gap` (`player_depth_tracking`), tables `security_events`, `risk_scores`, clés de config `antibot_mode`, `damage_budget_mode` ; la correction admin du classement recale aussi le budget |
| `server/index.js` | Télémétrie dans `POST /api/me/save`, validation et audit de `PUT /api/admin/config`, audit des actions admin, routes `/api/admin/security/*`, limite des coffres, purge planifiée |
| `server/rateLimits.js` | Limiteur `chest` (30/min/compte, `RATE_CHEST_MAX`) |
| `public/js/main.js` | Télémétrie résumée jointe aux sauvegardes cloud (et à la sauvegarde de sortie), retirée du cumul après réception |
| `public/admin/index.html`, `admin.js` | Onglet « Anti-bot », libellés de config, badge « budget de dégâts » |
| `test/antibot.test.js` (nouveau) | 26 tests (voir § 5) |
| `test/ranking-depth.test.js` | Scénarios de comptage #9 (un bloc par clic à toute profondeur, physiquement impossibles) lancés budget coupé ; le budget est testé à part avec la physique réelle |
| `docs/ANTI-BOT.md` | § 10 : réalisation, chiffres recalculés, désactivation, limites |

## 4. SHA, branche et procédure de test

- Branche `feature/25-anti-bot-lots-ab`, commit `bdb40c8` ; fusion dans `develop` : **`ea23431`**
  (= production).
- Tests : `npm test` (184/184), dont `node --test test/antibot.test.js`.
- Essai manuel (serveur de test, port ≠ 3000, base de test) : jouer, vérifier dans l'onglet réseau
  que `POST /api/me/save` contient `telemetry` ; panel admin → onglet « Anti-bot ».

## 5. Vérifications effectuées

- **Constantes relues dans le code du client par les tests** : dégâts max par clic et par seconde,
  réduction de PV max, PV minimum à chaque profondeur de 1 à 12 000 m (la phase 1 indiquait un
  minimum de 8 PV de base dès 13 m ; c'est 6 jusqu'à 22 m — argile — corrigé), deux seules sources
  de dégâts, une frappe Auto-Dig par seconde. Un rééquilibrage qui dépasse ces valeurs fait échouer
  `npm test`.
- **Non-régression (joueurs honnêtes simulés avec la vraie formule de PV)** : la même partie,
  validée avec et sans budget, donne la même profondeur retenue à chaque sauvegarde et aucun signal :
  maximum théorique (20 clics/s, tout au maximum, blocs les plus faibles, 30 min), joueur typique
  (6 clics/s, pioche 5), Auto-Dig seul 8 h, pauses, sauvegardes toutes les 3 s à 5 min, coupures
  réseau de 5 à 15 min, 50 profils aléatoires. Un premier jet créditait les clics via les seaux
  de #9 et retardait le rattrapage après une coupure : trouvé par ces tests et corrigé.
- **Bots et requêtes forgées** : bot « cohérent » à 20 clics/s sans dégâts borné (< 1 000 m en
  4 min au lieu de ≈ 4 800), une seule entrée de journal ; attente puis déclaration massive bornée
  par le plafond du crédit ; compteurs forgés détectés ; mode shadow sans effet sur la profondeur ;
  passage shadow → enforce sans retrait.
- **Lot A** : plafonds par catégorie (un indice seul ne dépasse jamais le niveau 1), décroissance,
  mode off, télémétrie (souris, tactile multi-doigts, contacteur d'accessibilité régulier → niveau
  0 ; script → indices), données illisibles ignorées, purge à 90 jours, calcul < 5 ms par sauvegarde.
- **HTTP** : télémétrie acceptée ou ignorée, résumé et journal admin (401 sans clé), `enforce`
  refusé, audit des changements (une seule entrée si la valeur ne change pas, rien pour une requête
  non authentifiée), 429 au-delà de la limite des coffres.
- **Navigateur** (serveur de test) : ordinateur 1280×900 et smartphone 390×844, aucune erreur JS ;
  télémétrie envoyée (souris : 12 clics ; mobile : 26 touchers + 5 clics de script comptés
  `isTrusted = false`) ; onglet admin affiché.
- **Données réelles** (copie de production) : le seul joueur classé de la saison (214 m) a besoin
  de 11 610 PV pour 1,67 million possibles ; sa sauvegarde suivante simulée progresse normalement
  (214 → 216 → 218 m, aucun signal).
- Non vérifié : comportement d'auto-clickers et d'outils d'accessibilité réels (à observer en
  shadow) ; onglet admin en production (panel désactivé, voir § 8).
- Impact données : ajouts seuls ; aucune donnée joueur modifiée (empreintes identiques).

## 6. Déploiement

- **SHA déployé : `ea23431`** le 30/10 à 13:00, par `scripts/deploy.sh` de la release.
- Avant : 184/184 sur le SHA exact ; copie de la base de production démarrée avec la release
  (port 3122) : santé, version, migration additive (4 colonnes, 2 tables, 2 clés de config),
  empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`,
  `player_click_tracking` **identiques**, `quick_check` ok ; copie supprimée.
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261030-130035-pre-deploy-ea23431.sqlite`.
- Après : 2 domaines → 200 et `/api/version` = `1.0.0+ea23431` ; journal du service sans erreur ;
  `quick_check` ok ; empreintes joueurs identiques à la sauvegarde pré-déploiement ; jeu chargé et
  joué en invité sur les 2 domaines (ordinateur et smartphone), aucune erreur JS ; première
  sauvegarde réelle traitée (214 m retenus, budget initialisé, aucun événement).
- **Retour arrière** : sans redéploiement, `damage_budget_mode = shadow` ou `off` et/ou
  `antibot_mode = off` (onglet Config, si le panel est activé) ; ou `ANTIBOT=off` dans
  l'environnement du service ; ou retour au code précédent `c23f521` (`git reset --keep c23f521`
  + redémarrage, procédure de `docs/OPERATIONS.md`) — le schéma ajouté est ignoré par l'ancien
  code, aucune restauration de base nécessaire.

### Test fonctionnel à faire par le propriétaire (3 min)

1. Ouvrir le jeu connecté, jouer normalement 2–3 minutes (clics, Auto-Dig si tu l'as).
2. Ouvrir l'onglet Saison : ta profondeur et tes blocs manuels progressent comme avant, au même
   rythme (aucun ralentissement, aucun message).
3. Recharger la page : progression conservée.
4. *(Si le panel admin est activé)* Admin → onglet « 🛡 Anti-bot » : « Mode observation : shadow »,
   « Budget de dégâts : enforce », ton compte absent de la liste des comptes à risque (ou à un
   score faible), temps de calcul de quelques millisecondes.

Résultat attendu : aucun changement perceptible en jeu.

Classement : **Bloquant MVP public — livré** (A et B). Lots C, D, E : **Après lancement**.

## 7. Choix techniques faits seul

- Budget de dégâts appliqué (`enforce`) par défaut : c'est une borne physique, démontrée neutre pour
  tout joueur honnête par les simulations et sur les données réelles ; l'observation (`shadow`)
  reste disponible d'un réglage si un doute apparaît.
- Clics crédités selon le temps réel écoulé (≤ 25 clics/s) et non selon les seaux de #9 : évite de
  retarder le rattrapage après des sauvegardes perdues.
- Coût calculé sans arrondi (borne inférieure des PV) : plus tolérant de < 1 PV par bloc, mais à
  l'abri des écarts d'arrondi entre navigateur et serveur ; recherche O(log n) par sauvegarde.
- Le signal « budget dépassé » n'est émis que si l'écart persiste même en créditant tous les clics
  déclarés en attente (une coupure réseau n'est pas un signal).
- `antibot_mode = enforce` refusé : rien à appliquer sans décision sur le lot C.
- Télémétrie : résumé seulement, jamais d'horodatage brut ; les données illisibles n'empêchent
  jamais la sauvegarde.

## 8. Décisions demandées au propriétaire

Aucune décision nécessaire pour les lots A et B. Restent ouvertes, sans urgence (questions 2 à 6
de la session 1, ci-dessous) : sanctions du lot C, défi ponctuel, éligibilité aux récompenses,
adresse de contestation, report du lot D. À noter : le panel admin est désactivé en production
tant que `ADMIN_SECRET` n'est pas défini (décision de #12) ; l'onglet « Anti-bot » n'y est donc
visible qu'après l'avoir défini.

## 9. Éléments restant à réaliser

- Observer ≈ 1 semaine en shadow (journal de sécurité), puis revue des scores avant tout lot C.
- Limite connue (#9, avant le lot C) : après ≈ 13 min de sauvegardes en échec avec un Auto-Dig à
  1 bloc/s, les seaux de #9 rejettent l'excédent (`depth_rejected`), compté comme preuve dans le
  score. Sans effet en shadow ; à corriger dans #9 avant toute sanction automatique.
- Lots C (réponses graduelles), D (économie serveur, après #20), E (anti-fermes) : après lancement.

---

# Session 1 — 30/10/2026 (nuit) : phase 1, audit et conception

## 1. État réel (session 1)

**Bloqué — décision nécessaire.** La phase 1 (audit et conception) est livrée dans `develop`
(document `docs/ANTI-BOT.md`). Le ticket exige l'accord du propriétaire sur la conception avant
toute réalisation (« Phase 2 : réalisation après accord sur la conception ») : aucun code n'a été
modifié, **rien à déployer** (documentation seule ; la production `cf1f605` n'est pas touchée).

## 2. Résultat

`docs/ANTI-BOT.md` couvre les 7 points de la phase 1 :

1. **Cartographie** des flux (clic, sauvegarde cloud, progression, coffres, saisons, classement,
   comptes, admin) avec les garanties serveur réelles et les contournements possibles, vérifiés
   dans le code de production.
2. **Modèle de progression serveur** en trois niveaux : N1 « budget de dégâts » (borne serrée de la
   profondeur classée à partir des PV minimum des blocs et des dégâts maximum possibles), N2
   « économie transactionnelle » (grand livre serveur), N3 simulation complète (déconseillée).
3. **Détection multi-signal** : preuves (impossibilités physiques) vs indices (cadence, rafales,
   régularité, motifs, `isTrusted`, fermes de comptes) ; aucun signal seul ne sanctionne.
4. **Quotas, anti-rejeu, fermes de comptes, journaux** (`security_events`, IP hachée, rétention).
5. **Score de risque** décroissant et réponses graduelles (journaliser → limiter le classement →
   défi ponctuel optionnel → exclusion temporaire du classement, révisable) ; jamais de
   bannissement ni de remise à zéro ; interrupteur `off`/`shadow`/`enforce` + `ANTIBOT=off`.
6. **Impact** mobile, accessibilité, double clic, réseau instable, joueurs rapides ; métriques de
   faux positifs.
7. **Dépendances** (#9, #10, #14, #18 déjà en production ; #19, #20, #23 à faire) et **ordre** en
   5 lots.

Constats principaux :

- Le client est autoritatif pour toute la progression ; seul le classement est borné côté serveur.
- Bornes actuelles (#9) : un tricheur aux compteurs cohérents peut monter d'≈ 21 m/s au
  classement. Le budget de dégâts (lot B) ramène 1 000 m de 47 s à 8 min et 5 000 m de 4 min à
  3 h, **sans pouvoir pénaliser un joueur honnête** (bornes calculées avec tout au maximum).
- Lacunes repérées hors anti-bot pur : `PUT /api/admin/config` n'est pas journalisé ; la route des
  coffres n'a pas de limite de débit propre ; les coffres débitent des pièces déclarées par le
  client.

## 3. Changements réalisés

- `docs/ANTI-BOT.md` (nouveau) : conception complète.
- Ce rapport.
- Aucun fichier de code, aucune migration.

## 4. SHA et procédure de test

- Branche `docs/25-anti-bot-conception` ; SHA de fusion sur `develop` : indiqué dans le
  commentaire du ticket.
- Pas de test fonctionnel (documentation). `npm test` lancé sur la fusion pour s'assurer que rien
  n'est cassé (résultat dans le commentaire du ticket).

## 5. Vérifications, limites, impact données

- Vérifié dans le code : routes et limites (`server/index.js`, `server/rateLimits.js`), validation
  de profondeur et anti-autoclic (`server/seasons.js`), mécaniques client (`public/js/main.js`,
  `blocks.js`, `upgrades.js`, `relics.js`) ; version en production (`/api/version` = `cf1f605`) ;
  comptages agrégés en lecture seule de la base de production (nombre de comptes, de lignes
  `anticheat_logs` par action, configuration) — aucune donnée personnelle extraite.
- Chiffres du tableau N1 calculés par script à partir des formules du jeu (PV, dégâts, reliques).
- Non vérifié : comportement réel d'auto-clickers et d'outils d'accessibilité (à mesurer en
  shadow, lot A).
- Impact données : aucun.

## 6. Déploiement

Non déployé : **documentation seule**, aucun changement de comportement. Rien à tester en jeu.
**Test à faire par le propriétaire** : lire `docs/ANTI-BOT.md` (≈ 10 min) et répondre aux
questions ci-dessous dans le ticket.

Classement MVP : lots **A (observation) et B (budget de dégâts) = Bloquant MVP public** (petits,
sans effet visible pour un joueur honnête) ; lots C, D, E = **Après lancement**.

## 7. Choix techniques faits seul

- Conception livrée **sans implémentation**, conformément au ticket (« Commencer par l'analyse et
  la conception ; ne pas lancer de sanctions automatiques en production »).
- Bornes N1 fondées sur les **maxima théoriques** (pioche 15, relique +10, autodig 6 + 14, réduction
  de PV 50 %) : aucun faux positif possible, sans dépendre d'un état client.
- Sanctions limitées au **classement et aux récompenses de saison** ; le jeu et la sauvegarde ne
  sont jamais touchés.
- Télémétrie client sous forme de **résumé** (histogramme), jamais d'horodatages bruts ni de donnée
  personnelle ; IP hachée dans les journaux.

## 8. Décisions demandées au propriétaire

1. **Valider la conception et l'ordre des lots** : lancer A (observation shadow) + B (budget de
   dégâts) maintenant ? *Recommandation : oui, les deux, déployés ensemble ; A en mode `shadow`.*
2. **Périmètre des sanctions** (lot C, plus tard) : limiter uniquement le classement et les
   récompenses de saison, jamais le jeu ni la sauvegarde ? *Recommandation : oui.*
3. **Défi ponctuel** (niveau 3) : (a) jamais, (b) défi simple maison « touchez le bloc doré »,
   (c) CAPTCHA tiers. *Recommandation : (b), désactivé par défaut.*
4. **Éligibilité aux récompenses/promotions** (anti-fermes) : exiger un minimum d'activité
   (ex. ≥ 30 min de jeu validé sur ≥ 2 jours dans la saison) ? *Recommandation : oui, à intégrer à
   #19.*
5. **Contestation** : quelle adresse de contact afficher aux joueurs sanctionnés ? *Recommandation :
   l'adresse d'expédition SMTP de #23, ou une adresse dédiée.*
6. **Lot D (économie côté serveur)** : le reporter après le lancement et après #20 ?
   *Recommandation : oui.*

## 9. Éléments restant à réaliser

- Après accord : lots A et B (phase 2), tests listés au § 8 de `docs/ANTI-BOT.md`, déploiement
  shadow, puis revue des mesures avant le lot C.
- Signalé hors périmètre (à rattacher à #14 ou #25-A) : journal d'audit de `PUT /api/admin/config`,
  limite de débit sur `POST /api/me/shop/chest/open`.


---

# Session 4 — 05/11/2026 : fiche diagnostique par joueur (premier test de résistance)

## 1. Ticket

#25 — [P0] Protection anti-bot globale — détection, validation serveur et réponses effectives —
https://github.com/ReC82/Dig/issues/25. Commentaires du propriétaire du 04/11 (22:00 → 22:41 UTC) :
rafales `burst_clicks` / `cps_flagged` du testeur volontaire `gabpok8` (beau-fils du propriétaire,
invité **pour casser le jeu** : aucune accusation), demande d'une **vue par joueur**, d'une explication
exacte du score 40 et de `applied:false`, et du tableau « signal → observation → action prévue →
action effectivement appliquée ». Le rapport forensique et le correctif serveur P0 (bloquer gains et
achats issus d'une progression impossible) ont été ouverts par le propriétaire dans **#74** ; la remise
à zéro du testeur dans **#75**.

## 2. État réel

**Déployé en production (SHA `3f726c2`) — en attente de recette.** Classement : **Bloquant MVP public**
pour la capacité d'observation (la bêta invitée ne peut pas être suivie sans), le correctif de fond
étant #74.

## 3. Résultat et changements

**Ce que le propriétaire voit :** Admin → Anti-bot → nouvelle carte « Fiche d'un joueur » (pseudo exact
ou `#ID`) et bouton **Fiche** à côté de chaque pseudo dans « Derniers contrôles », « Comptes par score de
risque » et le « Journal de sécurité ». La fiche (fenêtre centrée, lisible sur mobile) affiche, avec pour
chaque valeur une étiquette **serveur** / **déclaré** (sauvegarde du navigateur, non vérifiée) /
**télémétrie** (indice falsifiable) / **déduit** :

- bandeau : « Anti-bot shadow — sanctions désactivées (applied:false) » ; « Budget de dégâts enforce —
  plafonne la profondeur CLASSÉE ; ne réduit ni les coups, ni les gains, ni les achats » ;
  « 👆 du classement = blocs détruits manuellement validés, pas des coups » ;
- compte et activité : inscription, première activité et dernière mise à jour de la saison, dernière
  sauvegarde (révision), dernier contrôle ;
- progression : profondeur retenue / déclarée / couverte par le budget, écarts, coups manuels, blocs
  manuels déclarés et validés, blocs Auto-Dig, blocs détruits au total, **blocs ni manuels ni Auto-Dig**
  (détruits par un clic que le navigateur juge suspect : profondeur et gains accordés quand même — faille
  #74), clics jugés suspects ;
- partie déclarée : pièces, gemmes, fragments, pioche, niveaux d'améliorations (dont Auto-Dig) et de
  reliques, cumuls ;
- score de risque par catégorie (valeur, plafond, points de chaque signal) avec la règle de calcul ;
- **tableau des contrôles** : validation de profondeur #9, budget de dégâts, anti-autoclic #10, clic suspect
  navigateur, score de risque, économie — mode, observation chiffrée pour ce joueur, action prévue,
  **action effectivement appliquée** ;
- alertes par type et chronologie (100 dernières) **filtrées sur le joueur** ; fenêtres anti-autoclic ;
- **à partir de ce déploiement** : télémétrie cumulée (histogramme des intervalles, souris / tactile /
  clavier / autre, `isTrusted=false`) et tableau des sauvegardes contrôlées (Δt serveur, Δ coups,
  **coups/s à l'horloge serveur**, Δ blocs manuels / auto / total, profondeur déclarée / retenue / budget,
  niveau Auto-Dig, décision anti-autoclic). Avant ce déploiement : « non disponible pour cette session ».

**Fichiers :** `server/antibot.js` (`recordSaveSample`, `findPlayer`, `playerReport`), `server/db.js`
(table additive `antibot_save_samples`), `server/seasons.js` (échantillon à chaque sauvegarde contrôlée ;
mesures ajoutées aux événements `cps_flagged` / `cps_reduced` / `blocks_gt_clicks`), `server/index.js`
(`GET /api/admin/security/player`, admin), `public/admin/*` (fiche), `server/gemLedger.js` (voir § 7),
`test/antibot-player-report.test.js`.

### Réponses aux questions du propriétaire (commentaires #25 du 04/11)

**Score 40 et `risk_level {from:0,to:1,applied:false}` — exactement :** chaque signal ajoute des points à
sa catégorie, plafonnée : `burst_clicks` +4 (plafond « burst » 15), `cps_flagged` +6 (plafond « cps »
25). Après 4 rafales et 5 fenêtres CPS très élevé : 15 + 25 = **40** ≥ 30 → **N1**. L'événement
`risk_level` est journalisé avec `applied:false` parce que `antibot_mode = shadow` : **aucun niveau n'est
appliqué, le jeu n'a réduit aucun coup**. Le score décroît de moitié toutes les 24 h. Test automatisé
qui reproduit exactement ce 40 / N1 : `test/antibot-player-report.test.js`. (Plus tard le 04/11, un
`depth_rejected` a ajouté la catégorie « preuve » : score 74,5, N2, toujours non appliqué.)

**`clicks: 509` n'est pas 509 clics/s :** c'est le nombre de coups enregistrés par le navigateur
**depuis la dernière sauvegarde réussie**, envoyés avec une sauvegarde ; `under40ms: 505` = 505 de ces
intervalles étaient < 40 ms (> 25 coups/s). La télémétrie n'est **pas rejouée** : le lot est retiré du
cumul seulement quand le serveur confirme la sauvegarde, et les envois sont chaînés (un seul à la fois).
Seul cas de double envoi possible : l'envoi de fermeture de page (`keepalive`) pendant qu'un envoi normal
est en vol — rare, et sans effet sur la progression.

**Doubles événements :** `touchstart` appelle `preventDefault()` → pas de `click` synthétique en plus
sur mobile ; clavier : l'auto-répétition d'une touche maintenue est ignorée. Le tapotement à plusieurs
doigts produit des intervalles < 40 ms, mais pas ~99 % d'entre eux (il faut une pause entre deux
salves). Des lots où 505/509 intervalles sont < 40 ms correspondent à **> 25 coups/s soutenus** :
compatible avec un autocliqueur logiciel (qui produit des événements `isTrusted = true`, d'où l'absence
d'`untrusted_clicks`), pas avec un clic humain. Les fenêtres anti-autoclic serveur du compte
(horloge serveur) montrent par exemple 29,7 et 36,3 coups/s sur ~12 s. **Conclusion prudente : automatisation
probable, cohérente avec le test de résistance autorisé ; aucune sanction.** La répartition souris /
tactile / clavier n'était pas conservée avant ce déploiement ; elle l'est désormais.

**« L'anti-bot ne fait rien » — exact pour la partie score :** en `shadow`, les signaux ne produisent
aucune action. Ce qui agit réellement : (1) validation de profondeur #9 et (2) budget de dégâts
`enforce`, qui bornent la **profondeur classée** seulement ; (3) l'anti-autoclic #10, qui réduit les
**blocs manuels classés** (#73) seulement. **Rien ne borne les gains, les achats ni l'Auto-Dig** : la
sauvegarde du navigateur est acceptée telle quelle. Le budget de dégâts n'a pas freiné `gabpok8` parce
qu'il est volontairement permissif : il crédite les coups déclarés jusqu'à `depth_max_cps` = 20 coups/s,
chacun aux dégâts maximum du jeu, contre les PV minimum des blocs ; un autocliqueur sous ce débit, ou un
compteur forgé, reste « plausible » (voir #74 pour l'audit chiffré). Ce correctif de fond est l'objet de **#74**.

**Faits relevés en lecture seule pour #74 (compte `gabpok8`, aucune donnée personnelle) :** inscrit le
04/11 21:43 UTC ; à 22:57 UTC (sauvegarde pré-déploiement `dig-20261104-235755-pre-deploy-53d19ac.sqlite`) :
profondeur 1 003, 1 002 blocs détruits, dont 33 manuels et 21 Auto-Dig → **≈ 948 blocs détruits par des
clics jugés suspects**, pioche niv. 15, Auto-Dig niv. 6, 153 améliorations achetées, ~161,6 M pièces. À
23:04 UTC, la sauvegarde courante repasse à profondeur 1, 0 pièce, améliorations à 0 (remise à zéro
**côté navigateur** — aucune action serveur ni admin ne l'explique), alors que les compteurs de saison
restent à 1 011 m : l'état d'avant n'existe plus que dans les sauvegardes de la base (préservées).

## 4. SHA et procédure de test

- Branche `feature/25-anti-bot-lots-ab` : `a95a312` (fiche), `960acd7` (correctif gemmes).
- **`develop` = `3f726c2`** (fusion), déployé.
- Automatique : `npm test` → **706/706**. Ciblé : `node --test test/antibot-player-report.test.js`
  (joueur normal sans alerte ; autoclicker 30 coups/s → score 40 N1, `applied:false`, mesures sur
  `cps_flagged` ; blocs ni manuels ni auto ; plafond de 500 échantillons ; rien en mode off ; recherche
  pseudo / ID ; route admin protégée).
- Navigateur (serveur de test, port 3101, base de test, joueur synthétique « autoclicker ») : fiche
  ouverte depuis « Derniers contrôles » et depuis la recherche, PC 1280×900 et mobile 390×844, Échap
  ferme sans avertissement « modifications non enregistrées ».

## 5. Vérifications, limites, impact données

- **Aucune donnée joueur modifiée** ; aucune règle, aucun seuil, aucune sanction, aucun barème changé.
  Le compte testeur n'a pas été touché.
- Migration **additive** (table `antibot_save_samples`, index) testée sur une copie de la production :
  empreintes des 6 tables identiques avant/après démarrage, `quick_check` ok.
- Données ajoutées : par sauvegarde, compteurs et résumé de télémétrie déjà envoyés (pas d'IP, pas de
  frappe horodatée) ; 500 lignes max par joueur, purge à 90 jours avec le journal.
- Limites : la fiche ne reconstitue **pas** l'historique d'avant ce déploiement (la sauvegarde est
  écrasée à chaque envoi ; voir #74 pour la reconstitution à partir des sauvegardes de la base). Les
  valeurs « déclaré » / « télémétrie » sont falsifiables par un client modifié.

## 6. Déploiement

- **Déployé `3f726c2`** le 05/11 à 00:53 (Bruxelles) ; précédent `53d19ac`. Sauvegarde vérifiée :
  `~/backups/dig/dig-20261105-005305-pre-deploy-3f726c2.sqlite`.
- Vérifié : dig.lodygames.com et dig.lodylands.com → 200, `/api/version` = `1.0.0+3f726c2` ; journal
  sans erreur ; `quick_check` ok ; compteurs joueurs en progression uniquement (une partie en cours) ;
  23 échantillons enregistrés dans la minute ; route de la fiche → 401 sans session admin.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 53d19ac` + `sudo systemctl restart dig` (la
  table ajoutée est ignorée par l'ancienne version).

**Test fonctionnel à faire par le propriétaire :**
1. Admin → Anti-bot → bouton **Fiche** à côté de `gabpok8` dans « Derniers contrôles » : la fiche
   s'ouvre ; vérifier bandeau shadow / enforce, profondeur retenue vs déclarée, « Blocs ni manuels ni
   Auto-Dig », score et sa décomposition, tableau « action effectivement appliquée ».
2. Saisir `gabpok8` (ou `#3`) dans « Fiche d'un joueur » → même fiche.
3. Pendant que le testeur joue : **↻ Rafraîchir** dans la fiche → le tableau « Sauvegardes contrôlées »
   s'allonge (coups/s à l'horloge serveur, souris / tactile, intervalles < 40 ms).
4. Sur smartphone : la fiche se lit et se ferme (✕, Échap) sans avertissement.

## 7. Choix techniques faits seul

- Échantillon **agrégé par sauvegarde** plutôt que frappes individuelles : suffisant pour coups/s,
  doublons, rejeu et origine des clics, sans donnée sensible ; borné en volume.
- La fiche **n'invente pas d'historique** : ce qui n'était pas stocké est marqué « non disponible ».
- **Correctif hors périmètre strict, nécessaire au déploiement** : le test du registre de gemmes (#49)
  « achats simultanés depuis 4 processus » échouait 2 fois sur 12 **déjà sur `develop` avant ce
  ticket** (`SQLITE_BUSY_SNAPSHOT` : transaction différée lue puis écrite pendant qu'un autre processus
  écrit). Les règles de déploiement refusent tout échec. `spend` / `credit` passent en transaction
  `IMMEDIATE` (verrou d'écriture pris avant la lecture) : 0 échec sur 25 passages. Aucun changement de
  règle ni de montant ; ces fonctions ne sont pas encore appelées par le jeu.

## 8. Décisions demandées au propriétaire

Aucune nouvelle décision nécessaire pour cette livraison. Questions antérieures toujours ouvertes
(optionnelles) : lot C (réponses graduelles) limité au classement et aux récompenses ; défi ponctuel
maison désactivé par défaut ; éligibilité aux récompenses via #19 ; adresse de contestation ; lot D après
le lancement. Le blocage effectif des gains / achats impossibles est traité dans **#74**.

## 9. Éléments restant à réaliser

- **#74 (P0, Bloquant MVP)** : rapport forensique `gabpok8` et correctif serveur (un bloc détruit par un
  clic suspect ne doit plus rapporter profondeur ni gains ; bornage serveur des gains / achats /
  Auto-Dig). La fiche fournit désormais les mesures pour comparer avant / après.
- **#75** : remise à zéro contrôlée du testeur (la fiche servira à comparer les essais).
- Après lancement : historique des achats côté serveur (aujourd'hui inexistant), lot C.


---

# Session 5 — 05/11/2026 : fiche anti-bot lisible (recette UX du propriétaire)

## 1. Ticket

#25 — [P0] Protection anti-bot globale — détection, validation serveur et réponses effectives —
https://github.com/ReC82/Dig/issues/25. Commentaire du propriétaire du 05/11 10:24 UTC
(https://github.com/ReC82/Dig/issues/25#issuecomment-6655584499) : la fiche individuelle affiche trop
d'informations à la fois ; demander un **résumé lisible par défaut** et des **sections techniques
repliables**, en conservant toutes les données et les exports, testé sur PC et mobile, **sans modifier
les règles anti-bot**.

## 2. État réel

**Déployé en production (SHA `f3892a6`) — en attente de recette.** Classement : **Bloquant MVP public**
(outil de suivi de la bêta), correction d'ergonomie seule.

## 3. Résultat et changements

Admin → 🛡 Anti-bot → « Fiche » (ou recherche pseudo / #ID) :

- **Résumé toujours visible** en tête : une phrase (score de risque, niveau, nombre d'alertes de la
  saison, « aucune sanction appliquée (applied:false) »), puis six valeurs : profondeur retenue /
  déclarée, écart déclaré − retenu, blocs manuels validés (👆 classement), blocs manuels déclarés /
  coups, coups/s maximum à l'horloge serveur (sur les échantillons de sauvegarde), dernière sauvegarde
  reçue — chacune avec sa source (serveur / déclaré / déduit) — et une ligne sur les modes.
- **11 sections repliables, fermées par défaut**, chacune avec un rappel court dans son titre
  (ex. « Alertes du joueur par type — 10 alerte(s), 3 type(s) », « Sauvegardes contrôlées —
  12 échantillon(s) ») : Modes et lecture des valeurs · Compte et activité · Progression de la saison
  (détail) · Partie déclarée · Score de risque (décomposition) · Contrôles → action prévue → action
  appliquée · Alertes par type · Télémétrie des clics · Sauvegardes contrôlées · Fenêtres anti-autoclic ·
  Chronologie des alertes.
- Boutons **« Tout déplier » / « Tout replier »** ; les sections ouvertes **restent ouvertes** après
  « ↻ Rafraîchir » ou un changement de saison.
- **Aucune donnée retirée** : le contenu de chaque section est exactement celui de la version précédente
  (mêmes tableaux, mêmes notes). La route `GET /api/admin/security/player` (réponse JSON complète) est
  inchangée. Remarque : la fiche n'avait pas de bouton d'export ; rien n'a donc été supprimé de ce côté
  (voir § 9).
- Fichiers : `public/admin/admin.js` (`secRenderPlayer`), `public/admin/admin.css` (résumé, accordéons,
  titres sur mobile), `test/antibot-player-report.test.js` (+1 test statique).
- **Règles anti-bot non modifiées** : aucun fichier serveur touché.

## 4. SHA et procédure de test

Branche `feature/25-anti-bot-lots-ab`, commit `b5b8cff` ; fusion dans `develop` : **`f3892a6`**.
`npm test` ; scénario navigateur ci-dessous.

## 5. Vérifications, limites, impact données

- `npm test` : 740/740 sur la branche, sur `develop` (`f3892a6`) et sur la release `f3892a6`.
- Navigateur (serveur de test port 3101, base de test, joueur synthétique « autoclicker » 12
  sauvegardes) en **PC 1280×900** et **mobile 390×844** : résumé affiché (score 38,9 — N1, 10 alertes,
  33,3 coups/s max), 11 sections fermées, ouverture de 2 sections conservée après « Rafraîchir »,
  « Tout déplier » → 11 sections, 7 tableaux, 48 lignes (toutes les données), pas de débordement
  horizontal de la fiche, fermeture sans avertissement ni erreur JavaScript. Correction mobile : la
  flèche ▸ ne se retrouve plus seule sur une ligne quand le titre est long.
- Impact données joueurs : aucun (affichage admin uniquement, lecture seule).

## 6. Déploiement

- Contrôle préalable : aucune génération IA en cours (dernier appel à 10:06 UTC).
- Copie de la base de production : empreintes des 6 tables identiques avant / après démarrage de la
  release (`NODE_ENV=production`, port 3122), `quick_check` ok ; copie supprimée.
- `main` avancé `2169b5c` → `f3892a6` ; `scripts/deploy.sh` de la release : sauvegarde vérifiée
  `~/backups/dig/dig-20261105-115710-pre-deploy-f3892a6.sqlite`, « OK : f3892a6 en service ».
- Après : dig.lodygames.com et dig.lodylands.com → 200 et `1.0.0+f3892a6`, journal sans erreur,
  `quick_check` ok, nombres de lignes inchangés, route fiche → 401 sans session, `admin.js` servi à jour.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 2169b5c` + redémarrage (pas de migration).

**Test fonctionnel à faire par le propriétaire** (PC puis smartphone) :
1. Admin → 🛡 Anti-bot (recharger l'onglet admin, F5, pour charger le nouveau `admin.js`).
2. Ouvrir la fiche d'un joueur (bouton « Fiche » ou recherche `gabpok8`).
3. Attendu : en haut, un résumé court (score / niveau / alertes / profondeurs / blocs validés /
   coups/s max / dernière sauvegarde) ; dessous, des titres repliés avec un rappel chiffré.
4. Ouvrir « Score de risque » puis « Sauvegardes contrôlées », cliquer « ↻ Rafraîchir » : elles
   restent ouvertes. « Tout déplier » affiche tout le détail d'avant ; « Tout replier » referme.
5. « ✕ Fermer » : la fiche se ferme sans avertissement.

## 7. Choix techniques faits seul

- Accordéons `<details>` natifs (accessibles au clavier, sans JavaScript pour s'ouvrir), avec le style
  `bk-acc` déjà utilisé dans le catalogue de blocs, pour rester cohérent dans le panel.
- Toutes les sections repliées par défaut (y compris « Contrôles → action appliquée ») : l'essentiel de
  cette section est déjà résumé par « aucune sanction appliquée (applied:false) ».
- État ouvert / fermé gardé en mémoire de l'onglet (pas en `localStorage`) : simple et sans trace.
- Coups/s max = valeur la plus haute des échantillons de sauvegarde (Δ coups déclarés ÷ Δt serveur),
  marqué « déduit ».

## 8. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire pour cette livraison. Questions antérieures toujours ouvertes
(optionnelles) : lot C limité au classement et aux récompenses ; défi ponctuel maison désactivé par
défaut ; éligibilité aux récompenses via #19 ; adresse de contestation ; lot D après le lancement.

## 9. Éléments restant à réaliser

- Proposition (non implémentée, hors demande) : un bouton « Exporter la fiche (JSON) » dans la fiche, si
  un export est souhaité — la donnée complète est déjà disponible via la route admin.
- **#74 (P0, Bloquant MVP)** et **#75** : inchangés (voir session 4).

---

# Session du 06/11/2026 (soir) — Lot C : défis serveur et suspensions progressives du minage manuel

## 1. Ticket

#25 — [P0] Protection anti-bot globale — détection, validation serveur et réponses effectives —
https://github.com/ReC82/Dig/issues/25. Demandes du propriétaire du 06/11 (commentaires 6690606604 :
recette avec de vrais autoclickers Windows/Android ; 6690668718 : autoclickers à cadence aléatoire,
CAPTCHA, suspensions progressives, Observation par défaut).

## 2. État réel

**Déployé en production (SHA `3a87ffd`) — en attente de recette.** Mode global **Observation** :
aucun joueur ne voit de défi, rien n'est retiré. Appliqué uniquement sur décision du propriétaire
(ou sur un compte d'essai choisi dans la fiche).

## 3. Résultat et changements

**Ce qui bloque réellement la triche (côté serveur, en Appliqué)** : dès qu'un défi est imposé, les
clics manuels de chaque sauvegarde sont consommés sans crédit — ni profondeur manuelle, ni blocs
manuels validés (le classement #73), ni tirages serveur qui en dépendent. Peu importe que le défi
soit ensuite résolu par un script : seuls les clics postérieurs à la résolution comptent, et les
mesures repartent de zéro (un automate qui tourne la nuit doit être « débloqué » par un humain
environ chaque heure).

- `server/antibotResponses.js` (nouveau) : mesures d'activité manuelle (série sans pause, temps actif
  6 h / 24 h), décision de défi, énigme maison (usage unique, 5 min, réponse < 1,2 s refusée,
  15 énigmes / 10 min), violation confirmée, paliers de suspension, décroissance, vues admin.
- `server/seasons.js` : avant la validation de chaque sauvegarde, gel du crédit manuel si défi /
  suspension (Appliqué) ; après, décision éventuelle d'un défi. `nowMs` injectable (tests accélérés).
- `server/antibot.js` : catégories `activity` (+10, plafond 20) et `pattern` (+5, plafond 10) ;
  allègement du score (hors preuves) quand un défi est résolu ; famille de journal « Réponses ».
- `server/index.js` : `GET /api/me/antibot`, `POST /api/me/antibot/{seen,puzzle,answer}` ; admin
  `GET /api/admin/security/responses`, essai par compte, défi d'essai, annuler, lever, palier ; état
  joint à la réponse de sauvegarde (null en Observation).
- `server/db.js` : tables ajoutées seules `antibot_activity`, `antibot_challenges`,
  `antibot_suspensions` ; réglages par défaut (`antibot_response_mode = observe`, seuils, paliers).
- Jeu : `public/js/antibotGate.js` (nouveau) — fenêtre « Petite vérification » non destructive
  (fermable, rouverte en touchant le bloc, version accessible texte, messages sans sanction), fenêtre
  « Minage manuel en pause » avec la fin à l'heure de Bruxelles ; `main.js` bloque les coups manuels
  pendant l'état (l'Auto-Dig continue) ; textes FR/EN/NL/ES + pilote italien.
- Admin → 🛡 Anti-bot : carte **Réponses** (Désactivé / Observation / Appliqué, compteurs 7 j,
  défis récents, suspensions, Annuler / Lever), **Protocole de recette** repliable, section
  « Défi et suspension » dans la fiche joueur (état distinct : normal / défi imposé — minage refusé
  au classement / sanction ; mesures vs seuils ; « Essai Appliqué sur ce compte », « Émettre un défi
  d'essai », « Remettre le palier à 0 »). Config → Protections : tous les seuils et paliers.
- Doc : `docs/ANTI-BOT.md` § 12.

**Matrice des scénarios** (simulations `test/antibot-lot-c.test.js`, sauvegarde toutes les 12 s,
blocs aux PV réalistes, horloge accélérée ; valeurs par défaut) :

| Scénario | Observation (défaut) | Appliqué |
|---|---|---|
| Humain 2, 5, 8 clics/s avec pauses, mobile + rafales 15/s (2 h) | aucun défi | aucun défi, ≥ 90 % classé |
| Auto-Dig seul 10 h | aucun défi | aucun défi |
| Autoclicker 8/s régulier, 8 h | 7 à 9 défis simulés, rien retiré | défi à ≈ 1 h, plus rien de classé ensuite |
| 12/s bruité ±40 %, 20/s, 5/s avec pauses 2 min | défis simulés | défi à ≈ 1 h, classement figé |
| 8/s avec pauses de 4 min (série coupée) | défi simulé ≈ 4 h | défi par « temps actif 6 h » entre 3,5 et 5 h |
| Défi résolu par un humain à chaque fois (10/s, 6 h) | — | 5 à 7 défis, aucune suspension |
| Client modifié qui continue à cliquer pendant le défi | — | suspensions 5 → 15 → 30 → 60 min…, aucun crédit |
| Mauvaise réponse, trop rapide, expirée, rejouée, force brute | — | nouvelle énigme, aucune sanction, plafond 15/10 min |

**Ce qu'un clicker obtient aujourd'hui** : jeu officiel plafonné à 12 coups/s (#74), profondeur
classée bornée par les dégâts possibles (#25-B), blocs classés réduits au-delà de 8 clics/s (#10).
En **Observation**, un autoclicker à ≤ 8 clics/s toute la nuit reste donc crédité (signalé et
journalisé seulement) ; en **Appliqué**, il cesse d'être crédité après ≈ 1 h (≈ 4 h s'il fait des
pauses de 3–4 min), jusqu'à ce qu'un humain résolve le défi.

## 4. SHA et procédure de test

Branche `feature/25-anti-bot-lots-ab` (`24f9672`), `develop` = `3a87ffd`.
- `npm test` : 857/857 (branche, `develop` et release `3a87ffd`).
- `node --test test/antibot-lot-c.test.js` : 16 tests (simulations ci-dessus, énigme, modes, admin).
- Essai navigateur (serveur de test port 3101, base neuve) :
  `PW=… CHROME=… BASE=http://127.0.0.1:3101 ADMIN=… node test/e2e/antibot-challenge.e2e.js` —
  1280×900 et 390×844 : défi au chargement (F5), coup non compté, fermeture / réouverture, mauvaise
  réponse sans sanction, version accessible, grille, minage repris, aucune erreur JS. `admin-antibot-sheet.e2e.js`
  (#76) repassé : vue essentielle toujours lisible sans défiler.

## 5. Vérifications, limites, impact données

- Données joueurs : aucune modifiée. Migration = 3 tables + 9 réglages ajoutés ; testée sur copie de
  la production (empreintes des 6 tables identiques avant / après démarrage). En Observation, la seule
  différence pour les joueurs est la réponse de sauvegarde (`antibot: null`) et deux indices de risque
  supplémentaires (journal seulement).
- **Limites (risques résiduels)** : l'énigme maison arrête les autoclickers (clics à un endroit fixe)
  mais un script écrit pour le jeu peut la lire ; un CAPTCHA tiers (Turnstile) se brancherait sur la
  même interface (clés à fournir). Pièces et achats restent déclarés par le navigateur (#74). Jusqu'à
  ≈ 12 s de clics entre la dernière sauvegarde gelée et la résolution peuvent être crédités. Activité
  hors focus non mesurée (le propriétaire a exclu d'en faire un motif seul). Charge : 4 à 6 requêtes
  SQLite de plus par sauvegarde.
- Non vérifié : vrais autoclickers Windows/Android (recette du propriétaire).

## 6. Déploiement

- Contrôle préalable : aucune génération IA depuis 11:52 UTC, aucune action admin depuis 13:53 UTC.
- `main` avancé `0325c3a` → `3a87ffd` ; `scripts/deploy.sh` de la release : sauvegarde vérifiée
  `~/backups/dig/dig-20261106-195610-pre-deploy-3a87ffd.sqlite`, « OK : 3a87ffd en service ».
- Après : dig.lodygames.com et dig.lodylands.com → 200 et `1.0.0+3a87ffd`, journal sans erreur,
  `quick_check` ok, empreintes des 6 tables identiques à la sauvegarde, mode `observe`,
  routes admin → 401 sans session, `antibotGate.js` servi.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 0325c3a` + redémarrage (tables ajoutées
  ignorées par l'ancien code) ; ou, sans redéploiement, mode **Désactivé** dans Admin → Anti-bot.

**Test fonctionnel à faire par le propriétaire** (≈ 20 min, détail dans Admin → Anti-bot →
« Protocole de recette ») :
1. Admin (F5) → Anti-bot → Fiche de votre compte de test → « Essai Appliqué sur ce compte » puis
   « Émettre un défi d'essai ».
2. Dans le jeu (PC puis Android, F5) : « Petite vérification » s'affiche ; toucher le bloc ne fait
   rien ; « Fermer » puis toucher le bloc la rouvre ; une mauvaise réponse donne une nouvelle énigme ;
   « Version accessible » ; résoudre → le minage reprend. Admin : défi « résolu ».
3. Autoclicker 8–12 clics/s : pour un essai court, Config → Protections → « Défi : minage manuel
   continu sans pause » = 10, lancer 12 min. Attendu : défi ; fiche « Défi imposé — minage refusé au
   classement » ; blocs manuels validés figés ; autoclicker sur la fenêtre → aucun clic compté.
4. Humain rapide 5–8 clics/s avec pauses, 10–15 min : aucun défi.
5. Remise en état : seuil à 60, « Arrêter l'essai Appliqué », palier à 0.

Classement : **Bloquant MVP public** pour la décision Appliqué/Observation (sans Appliqué, un
autoclicker modéré reste crédité au classement, mais signalé) ; aucune incidence sur les invitations
bêta du 09/11 en Observation.

**Verdict pour lundi 09/11 : GO pour les invitations**, Observation maintenue (aucun risque de faux
positif pour les collègues) ; passage en Appliqué après votre recette autoclicker, ou dès lundi si
vous voulez que le classement de la bêta soit protégé (les seuils n'affectent pas une partie humaine
normale dans les simulations).

## 7. Choix techniques faits seul

- **Défi maison** plutôt que CAPTCHA tiers : aucune clé ni dépense, aucune donnée envoyée à un tiers,
  fonctionne hors fournisseur ; il cible les autoclickers (clics à position fixe). Interface prête
  pour Turnstile.
- **Temps actif = min(durée, clics ÷ 2)** : estimation serveur sans horodatage par clic (pas de
  profilage biométrique) ; un humain qui clique 5 s sur 12 compte 5 s.
- **Violation = clics après le relevé d'affichage** (le jeu bloque les coups pendant le défi) : un
  ancien onglet sans le nouveau code ne peut jamais être suspendu, seulement retenu.
- Le défi n'expire pas (seules les énigmes expirent) : attendre ne débloque pas un automate ; une
  expiration n'est jamais une sanction.
- Défis simulés résolus d'office en Observation : la fréquence mesurée = celle que vivrait un joueur.
- Section de la fiche placée sous les 4 cartes pour garder la vue essentielle lisible sans défiler (#76).

## 8. Décisions demandées au propriétaire

1. **Passage en Appliqué** (global) : (a) après votre recette autoclicker, (b) dès la bêta du 09/11,
   (c) après une semaine d'Observation (relevé des défis simulés = faux positifs potentiels).
   Recommandation : (a), au plus tard (c).
2. **Seuils** : 60 min de minage continu, 180 min actives sur 6 h, 360 min sur 24 h, score 60 ;
   violation = 30 clics pendant un défi affiché ; paliers 5 min → 24 h. Recommandation : garder.
3. **CAPTCHA tiers** (Cloudflare Turnstile, gratuit) en plus du défi maison si des scripts dédiés
   apparaissent : nécessite que vous créiez les clés. Recommandation : pas avant le lancement.
4. (Toujours ouvertes, optionnelles) éligibilité aux récompenses via #19 ; adresse de contestation
   (aujourd'hui : « via Aide ») ; lot D après le lancement.

## 9. Éléments restant à réaliser

- Recette du propriétaire (autoclickers réels Windows / Android) puis décision Appliqué.
- **#74 (P0, Bloquant MVP)** : gains / achats (pièces) toujours déclarés par le navigateur.
- **#77** : `exact_hp_mode` reste en shadow (décision séparée, non modifiée).
- Proposé, non réalisé : branchement Turnstile ; indicateur discret « vérification en attente » dans
  l'en-tête quand la fenêtre est fermée.

---

# Session du 07/11/2026 (après-midi) — Défi manuel : pictogramme « pièce » illisible

## 1. Ticket et état réel

#25 — [P0] Protection anti-bot globale — https://github.com/ReC82/Dig/issues/25

**Déployé en production (SHA `510a1df`, 07/11/2026 17:06 Bruxelles), en attente de recette.**
Source : commentaire du propriétaire du 07/11 à 15:38 UTC (issuecomment-6709151530). Le défi
« Touche le trèfle, puis la pièce » montrait un **carré vide à la place de la pièce**. Le
propriétaire a deviné la réponse et a réussi le défi : la recette #25-F reste donc partielle.

## 2. Cause

Les tuiles affichaient des emoji Unicode envoyés par le serveur. La pièce `🪙` date
d'Unicode 13 (2020) et la police emoji de Windows 10 et de plusieurs Android ne la contient pas,
d'où le carré vide (« tofu »). La feuille `🍃` et les autres emoji dépendaient eux aussi de la
police installée.

## 3. Changements (comportement visible)

- `public/js/antibotGate.js` : les 12 symboles de la grille (pioche, diamant, clé, étoile, cœur,
  flamme, goutte, lune, trèfle, pièce, cloche, feuille) sont maintenant **dessinés en SVG intégré
  au client**. Ils ne dépendent d'aucune police, d'aucun emoji ni d'aucun téléchargement : le
  rendu est le même sur Windows, Android, iOS et en PWA. Chaque symbole a sa forme et sa couleur
  (pièce dorée marquée « $ », feuille vert clair avec nervure, trèfle vert foncé à quatre
  feuilles, etc.). Si le serveur envoyait un jour un symbole inconnu, la tuile affiche son
  **nom en clair** au lieu d'un carré. Chaque tuile garde son nom accessible (`aria-label`),
  avec en plus une infobulle (`title`). La version texte (calcul) ne change pas.
- `public/css/style.css` : tuiles centrées, icône de 44 px.
- `test/antibot-symbols.test.js` (nouveau, 4 tests) : chaque symbole tiré par le serveur a un
  SVG ; le SVG ne contient ni `<text>`, ni image distante, ni emoji ; le client n'affiche plus
  `tile.icon` ; chaque symbole a un nom en fr, en, nl, es et it.
- **Inchangés** : serveur (tirage, validation, nonce, expiration 5 min, délai minimal 1,2 s,
  usage unique, plafond de 15 énigmes / 10 min), paramètres, mode global **Observation**,
  données du compte testeur. Le champ `icon` reste dans la réponse du serveur pour les onglets
  encore ouverts sur l'ancienne version, mais le nouveau client l'ignore.

## 4. SHA et procédure de test

- Branche `feature/25-anti-bot-lots-ab`, commit `af1119a` ; `develop` = `510a1df` (fusion).
- `npm test` : 900/900 sur `af1119a`, sur `develop` et dans la release `510a1df`.
- Essai navigateur `test/e2e/antibot-challenge.e2e.js` (base neuve, port 3101), sur ordinateur
  1280×900 et smartphone 390×844 : défi au chargement, fermeture et réouverture, mauvaise réponse
  sans sanction, version texte résolue, grille résolue par les noms accessibles, aucune erreur
  JavaScript. Les captures montrent les 6 pictogrammes nets.

## 5. Vérifications, limites, impact données

- Les 12 pictogrammes ont été rendus et contrôlés visuellement dans Chromium, seuls puis dans la
  vraie fenêtre du défi.
- **Non vérifié sur de vrais appareils Windows, Android ou iOS.** Les SVG n'utilisent aucun
  texte ni aucune police, donc le rendu ne dépend pas du système ; le test automatique garantit
  cette propriété.
- **Résistance aux scripts : pas améliorée par ce correctif.** Le nom de chaque tuile reste
  lisible dans la réponse de l'API et dans `aria-label`, comme avant. Le défi maison freine un
  autoclicker simple mais pas un script écrit pour Dig. La vraie résistance passe par un
  fournisseur spécialisé (question 1 ci-dessous).
- Données joueurs : aucune migration, aucune écriture. Les empreintes de la copie de production
  sont identiques avant et après démarrage. Après déploiement, seule une sauvegarde de partie en
  cours a progressé (version 6269 → 6270, compteurs identiques).

## 6. Déploiement

- SHA déployé : `510a1df` (`main` avancé en avance rapide depuis `4feed13`).
- Sauvegarde vérifiée : `~/backups/dig/dig-20261107-170607-pre-deploy-510a1df.sqlite`.
- Avant le déploiement : aucune génération IA en cours (dernier appel à 13:43 UTC).
- Après : dig.lodygames.com et dig.lodylands.com renvoient 200, `/api/version` = `1.0.0+510a1df`,
  le nouveau `antibotGate.js` est servi, `journalctl` est sans erreur, `quick_check` = ok.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 4feed13` + `sudo systemctl restart dig`
  (`npm ci` inutile, le lock n'a pas changé).

**Test fonctionnel à faire par le propriétaire (#25-F, suite) :**
1. Recharger le jeu (F5 ; sur la PWA, fermer puis rouvrir l'app) sur le compte d'essai.
2. Admin → Anti-bot → « Tester la protection » : passer le compte en essai Appliqué, puis
   envoyer un défi.
3. En jeu, dans la fenêtre « Petite vérification », les 6 tuiles doivent montrer des dessins
   nets, sans carré vide. Cliquer sur « Autre énigme » plusieurs fois pour voir les 12 symboles,
   dont la pièce dorée « $ ».
4. Résoudre le défi. Dans l'admin, le défi doit apparaître « Résolu ».
5. Cliquer sur « Terminer le test / remettre l'état normal ».

Classement : **Bloquant MVP** (lisibilité du défi avant la bêta).

## 7. Choix techniques faits seul

- **SVG intégrés au script** plutôt que des fichiers séparés : aucune requête, aucun cache du
  service worker à gérer, aucun risque d'image manquante ; il y a 12 petits dessins (environ 3 Ko).
- **Pas de nom visible sous chaque tuile** : le défi resterait une simple lecture et irait contre
  la demande d'images moins triviales. Le nom reste disponible pour l'accessibilité
  (`aria-label`, infobulle) et dans la version texte.
- **Aucun nouveau caractère Unicode**, conformément à la consigne.

## 8. Décisions demandées au propriétaire

1. **Images plus élaborées, pré-générées par API** (votre demande, analysée sans aucun appel
   payant). Faisable avec l'atelier d'icônes existant (#22/#40) : une banque fixe d'environ
   3 variantes par symbole, générées une seule fois, avec dimensions et coût estimés à l'avance
   dans le plafond de l'atelier, stockées en local et choisies au hasard par le serveur. Limites :
   une IA de vision reconnaît ces images aussi bien qu'un humain, les fichiers sont plus lourds
   et un dessin chargé est plus ambigu, donc plus de faux échecs. Le gain contre les scripts est
   faible tant que le nom de la tuile reste dans la réponse de l'API.
   **Recommandation : ne pas le faire avant la bêta.** Garder les SVG nets. Pour la résistance,
   il vaut mieux (a) un CAPTCHA spécialisé comme Cloudflare Turnstile (gratuit, clés à créer par
   vous, question déjà posée), ou (b) ne plus envoyer le nom des tuiles et servir des images
   opaques propres à chaque énigme (lot à part, environ une demi-journée).
2. Les questions précédentes restent ouvertes : passage en Appliqué pour tous, seuils, Turnstile,
   éligibilité, adresse de contestation, lot D.

## 9. Éléments restant à réaliser

- Recette #25-F complète par le propriétaire (étapes 1 à 5 ci-dessus). — Bloquant MVP
- Réponses aux questions ouvertes (mode Appliqué, Turnstile). — Bloquant MVP pour le mode ;
  Turnstile après lancement
- Option : images opaques par énigme ou banque d'images pré-générées. — Après lancement

---

# Session du 07/11/2026 (soir) — Recette autoclicker : conditions de détection, fiche lisible, test court par compte

## 1. Ticket et état réel

#25 — [P0] Protection anti-bot globale — https://github.com/ReC82/Dig/issues/25

**Déployé en production (SHA `4c65838`, 07/11/2026 17:52 Bruxelles), en attente de recette.**
Sources : commentaires du propriétaire du 07/11, 15:41 UTC (défi et boutons validés), 15:46 UTC
(essai OP Auto Clicker à 8 clics/s, « pas de signalement », demandes 1 à 5) et 15:48 UTC (essai de
quelques secondes seulement, interruption par les coffres, recette déterministe par compte demandée).
Le pictogramme « pièce » signalé à 15:41 avait déjà été corrigé et déployé (`510a1df`, section
précédente).

## 2. Ce qui s'est passé lors de l'essai réel (mesures du serveur, lecture seule)

L'essai a été fait sur le **compte n° 1, qui n'était pas en essai** (mode global Observation). Le compte
d'essai n° 2 n'a reçu aucun clic entre 15:40 et 15:54 UTC.
- 15:44:15 → 15:44:56 UTC : 42, 83 puis 24 clics manuels en trois sauvegardes, soit environ 150 clics en
  40 s (jusqu'à 7 clics/s sur une fenêtre de 12 s). Plus aucun clic ensuite, ce qui correspond à
  l'arrêt causé par le coffre.
- Série de minage continu mesurée : environ 0,5 min, pour un seuil de 60 min. Après plus de 3 min de
  pause, elle est remise à zéro. **Aucun défi n'était prévu, même simulé : le comportement est normal.**
- **Trois anomalies ont tout de même été journalisées** : `untrusted_clicks` (42/42, 83/83, 24/24). Le
  navigateur a marqué ces clics comme non produits par l'utilisateur (`isTrusted = false`). Chaque
  anomalie compte +10 au score de risque, mais cette catégorie est plafonnée à 25, sous le seuil de
  défi de 60. Résultat : une **anomalie journalisée sans défi**, dans la section diagnostic, ce que la
  fiche ne montrait pas clairement.

## 3. Conditions exactes de détection d'un autoclicker modéré à 8 clics/s (demande 1)

| Mesure (temps serveur, à chaque sauvegarde, environ toutes les 12 s) | Seuil par défaut | Effet |
|---|---|---|
| Minage manuel continu sans pause de 3 min (temps actif = min(durée, clics ÷ 2)) | 60 min | défi (simulé en Observation) |
| Temps actif sur 6 h / 24 h glissantes | 180 / 360 min | défi |
| Score de risque (multi-signal, demi-vie 24 h) | 60 | défi |
| Anti-autoclic #10 : fenêtre de 12 s au-delà de 8 clics/s | 8 clics/s | anomalie `cps_reduced`, blocs en trop non crédités |
| Cadence de frappe #74 | 12 coups/s (rafale 36) | coups sans dégât au-delà |

- À 8 clics/s réguliers, la série atteint le seuil en 60 min : environ **un défi par heure**, simulé en
  Observation, réel en Appliqué. Une gigue aléatoire n'exonère de rien : seule la durée compte.
- Il faut que le jeu soit ouvert et connecté (sauvegardes cloud). Le focus de la fenêtre ne change
  rien côté serveur. Sans sauvegarde reçue, aucune mesure n'est possible.
- **Mode Observation** : aucun défi ni retrait n'est montré au joueur, tout est noté. **Essai Appliqué**
  (un seul compte) : vrai défi ; tant qu'il attend, les clics manuels ne comptent plus au classement.
  Une suspension n'arrive qu'après 30 clics **déclarés** pendant un défi affiché. Le jeu officiel ne
  compte plus aucun coup pendant le défi, donc seul un client modifié peut y arriver.
- Les coffres interrompent un autoclicker à position fixe parce que leur fenêtre intercepte les clics.
  Ce n'est pas une protection : c'est une interruption de jeu.

## 4. Changements (comportement visible)

- **Fiche joueur et parcours « Tester la protection » : nouvel encadré « Ce que le serveur a vu »**
  (demande 2). Il donne une phrase-verdict, sans avoir à lire le journal, et distingue :
  aucun contrôle reçu (rien depuis 15 min, ou jamais) / activité mesurée sous les seuils / anomalie
  journalisée / défi simulé (Observation) / défi réel. Détails affichés : dernière mesure (heure,
  clics, durée, environ X clics/s), série continue en minutes et en % du seuil, temps actif sur 6 h et
  24 h, nombre et type de la dernière anomalie, défis simulés sur 24 h.
- **Variante « tester un autoclicker sans attendre 60 min (ce compte seulement) »** (demande 3), repliée
  sous les 5 étapes validées, qui ne changent pas. Elle propose un seuil court de 1, 2, 3, 5 ou 10 min
  pour **le seul compte en essai**. Garde-fous : essai Appliqué requis ; expiration automatique après
  2 h ; effacement par « Terminer le test » ; réglage global `ab_streak_min` jamais modifié ; aucun
  autre joueur concerné. À l'activation, un **relevé du début** est noté (blocs manuels validés, clics
  déclarés, rang par blocs manuels). Un tableau **Au début / Maintenant / Écart** montre ensuite le
  gel pendant la vérification.
- Serveur : `server/antibotResponses.js` (seuil d'essai, relevé, synthèse d'observation, dernière
  fenêtre mesurée) ; nouvelle route `POST /api/admin/security/player/:id/test-threshold`
  `{ minutes | null }`, tracée dans l'audit admin.
- Migration **additive** : 4 colonnes `antibot_activity` (`last_window`, `test_streak_min`,
  `test_started_ms`, `test_snapshot`). Rien n'est supprimé ni réécrit.

## 5. SHA, tests et vérifications

- Branche `feature/25-anti-bot-lots-ab`, commit `8840731` ; `develop` = `4c65838` (fusion).
- `npm test` : **909/909** sur la branche, sur `develop` et dans la release.
- Nouveau `test/antibot-autoclicker-recipe.test.js` (9 tests, demande 4), avec une sauvegarde
  simulée toutes les 12 s :
  - essai réel reproduit (8 clics/s pendant 40 s, avec ou sans gigue) : « sous les seuils », aucun
    défi ; avec gigue, seule l'anomalie `cps_reduced` de #10 apparaît ;
  - clics `isTrusted = false` : 3 anomalies, score sous 60, aucun défi ;
  - 3 h à 8 clics/s, fixes ou bruités de ±30 % : 2 à 3 défis simulés (environ 1 par heure), classement
    identique à celui obtenu avec les réponses désactivées ;
  - faux positifs : humains pendant 3 h avec des pauses de 4 à 5 min, même à 8 à 12 clics/s et même en
    Appliqué : aucun défi ;
  - recette avec seuil de 2 min : défi réel en 1 min 40 à 2 min 30, blocs classés figés pendant
    13 min d'autoclic, témoin au même rythme non concerné, paramètres globaux identiques, seuil et
    relevé effacés à la fin ;
  - client modifié : suspension de 5 min du seul compte d'essai ;
  - garde-fous : essai requis, bornes, expiration après 2 h, mode Désactivé.
- Nouvel essai navigateur `test/e2e/antibot-autoclicker-recipe.e2e.js` (serveur de test, port 3101,
  base neuve), **TOUT OK** sur ordinateur 1280×900 et smartphone 390×844. Il simule un autoclicker
  (vrais clics souris toutes les 125 ms à position fixe, coffres fermés au passage, 1 à 3 par essai)
  avec un seuil d'essai d'une minute. La vérification s'affiche après environ 54 s ; les coups
  suivants n'ont plus d'effet ; les blocs manuels validés restent figés (17 → 17) ; l'encadré indique
  « défi réel » ; le témoin au même rythme n'a ni défi ni anomalie ; la fin du test efface essai et
  seuil ; mode global et paramètres sont inchangés ; aucune erreur JavaScript.
- Copie de la base de production : empreintes `users`, `user_saves`, `season_rankings`, `seasons`,
  `leagues`, `player_click_tracking` et `antibot_activity` identiques avant et après démarrage
  (migration : 4 colonnes ajoutées seulement).
- Limites : pas d'essai avec le vrai OP Auto Clicker ni sur un vrai Android. Les clics de Playwright
  sont marqués « fiables » (`isTrusted = true`), contrairement à ceux de l'essai réel : le signal
  `untrusted_clicks` n'est donc couvert que par le test unitaire. `isTrusted` reste falsifiable par un
  client modifié.

## 6. Déploiement

- SHA déployé : `4c65838` (avance rapide de `main` depuis `510a1df`).
- Sauvegarde vérifiée : `~/backups/dig/dig-20261107-175226-pre-deploy-4c65838.sqlite`.
- Avant : aucune génération IA en cours (dernier appel à 13:43 UTC).
- Après : les deux domaines renvoient 200 avec `1.0.0+4c65838` ; le nouvel `admin.js` est servi ;
  `journalctl` ne montre que les 4 migrations ; `quick_check` = ok ; empreintes joueurs identiques à
  la sauvegarde pré-déploiement.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 510a1df` + `sudo systemctl restart dig`
  (lock inchangé). Les 4 colonnes ajoutées sont sans effet sur l'ancien code.

**Test fonctionnel à faire par le propriétaire (#25-G, recette autoclicker, environ 10 min) :**
1. Admin → Anti-bot → « Tester la protection » : choisir le compte d'essai, puis « Lancer un essai
   uniquement pour ce compte ».
2. Ouvrir « Variante : tester un autoclicker… », choisir **2 min**, puis « Activer le seuil court ».
   Le tableau « Au début du test » apparaît.
3. Dans le jeu, **avec ce même compte**, régler OP Auto Clicker sur 125 ms, curseur sur le bloc.
   Si un coffre s'ouvre, le récupérer et relancer en moins de 3 min.
4. Après environ 2 min, la fenêtre « Petite vérification » s'affiche. Arrêter l'autoclicker.
5. Admin → « ↻ Voir où en est le compte » : l'encadré indique « Défi réel… » et la ligne « Blocs
   manuels validés (classement) » ne change plus d'un rafraîchissement à l'autre.
6. Résoudre la vérification, puis « Terminer le test / remettre l'état normal ». Le seuil revient à
   60 min, le mode global reste Observation.
7. Facultatif : ouvrir la fiche du compte n° 1. L'encadré résume l'essai réel du 07/11 : anomalies
   `untrusted_clicks`, aucun défi.

Classement : **Bloquant MVP** (preuve que la protection agit avant la bêta). Les sanctions sur client
modifié ne se testent pas avec le jeu officiel : elles sont couvertes par les tests automatiques.

## 7. Choix techniques faits seul

- **Seuil d'essai par compte plutôt qu'un réglage global raccourci** : c'est la consigne (« ne pas
  réduire en production les seuils de tous les joueurs »). Il ne porte que sur le minage continu,
  le déclencheur visé par un autoclicker. Les seuils 6 h et 24 h et le score ne changent pas.
- **Expiration automatique en 2 h** : un essai oublié ne laisse pas de seuil court actif.
- **Coffres non modifiés** : la recette indique de fermer le coffre (moins de 3 min de pause ne
  coupe pas la série). L'essai automatique fait de même.
- Rang du relevé : 1 + nombre de joueurs ayant strictement plus de blocs manuels validés (critère de
  #73). Les égalités ne sont pas départagées dans ce relevé indicatif.

## 8. Décisions demandées au propriétaire

Aucune nouvelle décision. Les questions précédentes restent ouvertes :
1. Défis et suspensions en Appliqué pour tous : (a) après cette recette, (b) dès la bêta du 09/11, ou
   (c) après une semaine d'Observation. Recommandation : (a), au plus tard (c).
2. Seuils par défaut (60 min continu, 180 min sur 6 h, 360 min sur 24 h, score 60, violation à
   30 clics, paliers de 5 min à 24 h) : les garder ? Recommandation : oui.
3. Cloudflare Turnstile en plus du défi maison : recommandation, pas avant le lancement.
4. Images de défi pré-générées : recommandation, non avant la bêta.
5. Optionnels : éligibilité aux récompenses via #19, adresse de contestation, report du lot D.

## 9. Éléments restant à réaliser

- Recette #25-G par le propriétaire (ci-dessus). — Bloquant MVP
- Décision sur le mode Appliqué pour tous. — Bloquant MVP
- Option, signalée sans être réalisée : faire peser davantage `untrusted_clicks` répétés dans le score
  (plafond de 25 aujourd'hui). Cela touche à l'algorithme, donc décision séparée. — Après lancement

---

# Session du 08/11/2026 — Preuve du gel du classement pendant un défi (recette #25-G)

## 1. Ticket et état réel

#25 — [P0] Protection anti-bot globale — https://github.com/ReC82/Dig/issues/25

**Déployé en production (SHA `487ff7d`, 08/11/2026 12:31 Bruxelles) — en attente de recette.** Source : commentaire du propriétaire du 08/11/2026 10:40 UTC
([issuecomment-6720465294](https://github.com/ReC82/Dig/issues/25#issuecomment-6720465294)) :
défi réel déclenché par OP Auto Clicker, mais gel du classement pendant le défi **non prouvé** ;
relevé 194 → 206 blocs (+12) à expliquer par des horodatages ; demandes 1 à 5.

## 2. Audit de l'essai réel du 08/11 (base de production lue en copie, lecture seule)

Compte n° 1, essai Appliqué, seuil court de 3 min. Heures en UTC (Bruxelles = +1 h). Source :
une ligne par sauvegarde (`antibot_save_samples`), table des défis, journal de sécurité.

| Phase | Heure serveur (UTC) | Blocs manuels déclarés | Clics déclarés | Constat |
|---|---|---|---|---|
| Seuil d'essai activé (relevé « Au début ») | 10:28:00 | 194 | 7 611 | rang 1 |
| Dernière sauvegarde **avant** le défi | 10:31:03.232 | 203 | 8 900 | +9 blocs gagnés AVANT l'émission |
| **Émission du défi n° 4** (`continuous_mining`, 3 min) | 10:31:03 | 203 | 8 900 | même requête, après le crédit de cette sauvegarde |
| Pendant le défi (6 sauvegardes : 10:31:15 → 10:32:44) | — | **203** | 8 901 | 1 clic en vol, retenu (`held_clicks = 1`) ; **0 bloc** |
| **Résolution** (grille, 104 s) | 10:32:47 | 203 | 8 901 | — |
| Autoclicker relancé (bot supervisé) | 10:32:56 → 10:33:44 | 206 | 9 307 | +3 blocs APRÈS la résolution, clics `isTrusted=false` journalisés dès 10:32:56 |

**Conclusion : +12 = +9 avant l'émission + 0 pendant + 3 après la résolution. Aucune fuite
constatée** : pendant le défi, le compteur déclaré n'a pas bougé (le jeu bloque les coups) et le
serveur a retenu le seul clic reçu. Le relevé « 187 → 187 » correspond au défi d'essai admin n° 3
(10:15:25 → 10:15:35, résolu en 10 s, aucun clic). Les blocs validés finaux (206) sont égaux aux
blocs déclarés. Limite honnête : ce défi n° 4 est antérieur aux relevés horodatés ajoutés ce jour ;
la preuve repose sur les sauvegardes déclarées (le validé ne peut jamais dépasser le déclaré).

## 3. Revue du gel côté serveur (demande 2)

Le gel est décidé dans la même transaction synchrone que la sauvegarde (Node + SQLite synchrones :
deux requêtes d'un même compte ne s'entrelacent jamais). Pendant un défi en attente, les compteurs
reçus sont « consommés » sans crédit avant tout calcul. Cas éprouvés par des tests automatisés :
sauvegarde en retard (compteurs d'avant l'émission reçus après), client modifié qui continue de
cliquer, second appareil (compteurs plus bas), fenêtre de coffre, onglet changé / F5.

**Un défaut réel, mineur, corrigé** : après la résolution, un client modifié qui aurait cliqué pendant
le défi sans sauvegarder, puis déclaré des compteurs anciens en répondant, voyait ces clics jugés par
l'anti-autoclic sur une fenêtre partant de la dernière sauvegarde retenue (durée du défi incluse,
jusqu'à 120 s) : cadence diluée. **La fenêtre part désormais de la résolution** ; la rafale est
détectée (`flagged`/`reduced`) et le crédit borné à 8 clics/s depuis la résolution. Le jeu officiel
n'est pas concerné (il bloque les coups pendant le défi).

**Garde-fou ajouté** : pendant un défi ou une suspension, les blocs validés sont relevés avant et après
le traitement de la sauvegarde ; toute hausse (aucun chemin connu) est retirée aussitôt, comptée sur le
défi et journalisée (`freeze_clamped`, filtre « Crédit refusé pendant un défi » du journal).

## 4. Changements (comportement visible)

- **Admin → Anti-bot, fiche et parcours de test : encadré « Preuve du gel »** pour le dernier défi réel :
  tableau horodaté (heure serveur, secondes) **Avant (début du test) / Émission du défi / Pendant le
  défi / Résolution / Maintenant** avec blocs validés, clics déclarés et rang ; ligne « Pendant » :
  sauvegardes retenues, clics non crédités, blocs refusés par le garde-fou, écart ; verdict
  « ✓ Gel vérifié : +0 bloc… », « ⚠ Écart » ou « défi antérieur au 08/11 : pas de relevé ».
- **Indice de reprise (bot supervisé), sans aucune action** : délai entre la résolution et le premier
  clic suivant, cadence de reprise, alertes « clics non fiables » depuis, vérifications résolues en 24 h.
- **Coffres pendant la recette** : sur le seul compte en essai avec seuil court actif, la fenêtre du
  coffre se récupère seule après 1,5 s (même récompense, taux inchangés) ; l'autoclicker à position fixe
  n'est plus interrompu. Aucun effet sur les autres comptes ni après « Terminer le test ».
- Serveur : relevés à l'émission et à la résolution/annulation, compteur de sauvegardes retenues.
  Migration additive : 5 colonnes `antibot_challenges`, 1 colonne `antibot_activity`.
- Inchangé : mode global **Observation**, seuils, algorithmes de détection, économie, classement des
  autres joueurs. Aucune suspension réelle.

## 5. Tests

- `test/antibot-freeze-proof.test.js` (9 tests) : essai du 08/11 reproduit (+N avant, 0 pendant,
  progression après) ; client modifié + sauvegarde en retard ; compteurs du défi déclarés après la
  résolution (ce test **échoue sans le correctif** de fenêtre) ; second appareil + coffre + F5 ;
  garde-fou ; annulation admin + témoin inchangé ; indice de reprise sans effet ; défi sans relevé
  → « inconnu » ; migration idempotente.
- `npm test` complet : **929/929** sur la branche (`9528875`), sur `develop` (`487ff7d`) et dans la release.
- E2e navigateur `test/e2e/antibot-freeze-proof.e2e.js`, serveur de test (port 3101, base de test),
  **TOUT OK en 1280×900 et 390×844** : vrais clics souris à 8 clics/s ; vérification après ≈ 57 s
  (seuil 1 min) ; coffre récupéré seul en 1,35 s ; défi **résolu dans le jeu** (énigme texte) ;
  autoclicker relancé ; fiche : « ✓ Gel vérifié : +0 bloc », phases Avant / Émission / Pendant /
  Résolution / Maintenant ; reprise mesurée « au plus 12 s après, ≈ 7,2 clics/s » ; mode global et
  paramètres inchangés ; aucune erreur JS. Remarque : le jeu n'envoie une sauvegarde que s'il y a du
  changement, d'où parfois 1 seule sauvegarde retenue pendant un défi (6 en production le 08/11).

## 6. Déploiement

- **SHA déployé : `487ff7d`** (merge dans `develop`), 08/11/2026 12:31 Bruxelles, par `scripts/deploy.sh`
  de la release. Sauvegarde vérifiée : `~/backups/dig/dig-20261108-123118-pre-deploy-487ff7d.sqlite`.
- Copie de la base de production : empreintes (lignes + hachage) de `users`, `user_saves`,
  `season_rankings`, `seasons`, `leagues`, `player_click_tracking` **identiques** avant et après
  démarrage ; seules les 6 colonnes ajoutées apparaissent ; copie supprimée.
- Après déploiement : 2 domaines 200, `/api/version` = `1.0.0+487ff7d`, aucune erreur dans le journal,
  `quick_check` ok, classement de la saison identique à la sauvegarde (206 / 80 blocs validés).
- Aucun appel IA en cours avant le redémarrage. Retour arrière : `git reset --keep 5f0c2a6` +
  redémarrage (colonnes ajoutées sans effet sur l'ancien code).
- Note : le compte n° 1 était encore en essai Appliqué (seuil 3 min expiré à 13:28 Bruxelles) ; rien
  n'a été modifié sur ce compte — « Terminer le test » dans l'admin le remet à l'état normal.

### Test fonctionnel à faire par le propriétaire (≈ 4 min, non redondant)

Le défi lui-même est déjà validé : ne pas le revalider. Ce test sert uniquement à voir la preuve.
1. Admin → Anti-bot → « Tester la protection » : votre compte, « Lancer l'essai », variante
   autoclicker, seuil **1 min**, « Activer le seuil court ».
2. Dans le jeu : OP Auto Clicker sur le bloc. Les coffres se récupèrent seuls (≈ 1,5 s).
3. Quand « Petite vérification » apparaît : Alt+F2 (arrêt), attendez 30 s, résolvez, Alt+F1 (relance)
   30 s.
4. Admin → « Voir où en est le compte » : l'encadré vert **« Preuve du gel — ✓ Gel vérifié : +0 bloc
   validé entre l'émission (hh:mm:ss) et la résolution (hh:mm:ss) »**, avec le tableau Avant /
   Émission / Pendant / Résolution / Maintenant ; « Maintenant » > « Résolution » (reprise permise) ;
   ligne « Reprise … au plus N s après, ≈ 8 clics/s » (indice seulement, aucune sanction).
5. « Terminer le test ».

### GO / NO-GO classement pour la bêta du 09/11 (demande 5)

- **Constaté en réel** (production, 08/11) : défi déclenché par un autoclicker réel ; 0 bloc crédité
  pendant le défi (sauvegardes horodatées) ; reprise immédiate après résolution (bot supervisé).
- **Simulé / testé** : gel face aux sauvegardes en retard, client modifié, second appareil, coffre,
  F5 ; crédit rétroactif borné ; aucun faux positif sur des humains avec pauses (tests du 07/11).
- **Limite** : en mode global **Observation** (maintenu, comme demandé), aucun joueur n'est gelé :
  un autoclicker à ≤ 8 clics/s progresse au classement comme un humain très assidu ; seuls le plafond
  de cadence (#10) et les contrôles de profondeur s'appliquent, et les défis simulés sont visibles
  dans l'admin. Un bot supervisé résout chaque défi : en Appliqué, il perd ≈ le temps du défi par heure.
- **Verdict : GO pour un classement de bêta entre collègues sans lot réel** (surveiller « Défis
  simulés » dans Admin → Anti-bot). **NO-GO pour tout classement doté d'un lot réel** tant que le
  mode Appliqué et une règle de récidive ne sont pas décidés (questions 1 et 2).

Classement MVP : la preuve du gel est **Bloquant MVP public** (livrée) ; récidive graduée et mode
Appliqué pour tous : **Bloquant pour des récompenses réelles**, pas pour la bêta fermée.

## 7. Choix techniques faits seul

- Relevés stockés sur le défi (JSON, heure serveur) plutôt que recalculés : preuve figée, indépendante
  des sauvegardes suivantes. Défis antérieurs : verdict « inconnu », jamais « prouvé » par défaut.
- Garde-fou après traitement plutôt qu'un court-circuit du pipeline : les autres contrôles (profondeur,
  journal) continuent de voir les sauvegardes retenues.
- Coffres : récupération automatique de la MÊME récompense pour le seul compte en recette (seuil court
  actif, expire en 2 h), plutôt qu'un changement de taux ou de séquence de blocs (économie inchangée).
- Indice de reprise en lecture seule (aucun seuil, aucune action) : l'algorithme ne change pas sans
  décision.

## 8. Décisions demandées au propriétaire

1. **Récidive graduée (bot supervisé)** — aujourd'hui une vérification réussie remet à zéro la série
   ET les temps actifs 6 h / 24 h. Options : (a) ne remettre à zéro que la série continue (les cumuls
   6 h / 24 h continuent : un bot supervisé atteint 180 min/6 h et reçoit des défis plus fréquents) ;
   (b) (a) + seuil de série divisé par 2 à chaque défi résolu dans les 24 h (plancher 10 min) ;
   (c) rien. Jamais de suspension sur simple réussite ou cadence. **Recommandation : (a) puis (b)
   après une semaine d'observation de l'indice de reprise.**
2. Rappel (inchangé) : défis et suspensions en Appliqué pour tous — (a) après cette recette, (b) dès la
   bêta, (c) après 1 semaine d'Observation. **Recommandation : (a), au plus tard (c)** ; obligatoire
   avant tout classement doté d'un lot réel.
3. Les autres questions en attente (seuils par défaut, Turnstile, images de défi, éligibilité #19,
   adresse de contestation, lot D) restent valables, sans changement.

## 9. Éléments restant à réaliser

- Selon décision 1 : récidive graduée (≈ 0,5 jour, tests de faux positifs inclus) — Après la bêta.
- Le pas 3 du parcours guidé reste surligné quand le défi vient du seuil automatique (pas de l'admin) :
  cosmétique, à traiter dans #87 — Après lancement.

---

# Session du 08/11/2026 (après-midi) — Récidive, option A : cumuls 6 h / 24 h conservés après un défi

## 1. Ticket et état réel

#25 — [P0] Protection anti-bot globale — https://github.com/ReC82/Dig/issues/25

**Déployé en production (SHA `18f4cd1`, 08/11/2026 14:56 Bruxelles) — en attente de recette.** Source : décision du propriétaire du 08/11/2026 11:36 UTC
([issuecomment-6720990840](https://github.com/ReC82/Dig/issues/25#issuecomment-6720990840)) :
option A validée ; option B, Turnstile, images, sanctions, coffres, économie et classement exclus ;
mode global « Observation » maintenu.

## 2. Sémantique avant / après (explicitée, comme demandé)

| | Avant (jusqu'à `0c5d24e`) | Après (option A) |
|---|---|---|
| Émission ou résolution d'un défi | série **et** cumuls 6 h / 24 h effacés | **seule la série** (et sa pause) repart de zéro ; les paquets de 10 min sont conservés |
| Défi par cumul (180 min / 6 h, 360 min / 24 h) | jamais atteint par un bot qui résout chaque défi (la série à 60 min effaçait tout) | atteint à ≈ 3 h / ≈ 6 h ; tant que le cumul reste au-dessus du seuil : au plus un défi par `ab_cooldown_min` (30 min, réglage existant), compté depuis la résolution ou l'annulation |
| Temps bloqué pendant un défi / une suspension (Appliqué) | clics déclarés par un client modifié comptés comme minage | **ni minage, ni pause** ; la mesure suivante repart de l'instant de la résolution (aucun double comptage) |
| Changement de saison | cumuls effacés | cumuls conservés (fenêtres de temps, pas de saison) |
| Compteur inférieur (autre appareil, F5) | fenêtre ignorée | inchangé ; la série n'est coupée que par une vraie absence ≥ 3 min |
| Annulation admin d'un défi | aucun effet sur les mesures | série remise à zéro, délai minimal compté depuis l'annulation |

Fenêtres : vraies fenêtres glissantes (paquets de 10 min, conservés 24 h). Seuils (60 / 180 / 360 min,
score 60, violation 30 clics, paliers 5 min → 24 h), détections, indices et politique de sanctions
**inchangés**. Option B (seuil réduit après chaque défi) **non appliquée**.

## 3. Changements

- `server/antibotResponses.js` : `_resetActivity` → `_resetStreak` (buckets conservés) ; délai minimal
  appliqué aux déclencheurs de cumul ; mesure « gelée » pendant un défi / une suspension Appliqué ;
  base de mesure avancée à la résolution ; cumuls conservés au changement de saison ; annulation →
  série et délai.
- `public/admin/admin.js` : libellé et aide du « Délai minimal entre deux défis par score ou cumul »,
  ligne des seuils de la fiche (« cumuls conservés après un défi résolu »).
- `docs/ANTI-BOT.md` § 11 : sémantique mise à jour.
- Tests : `test/antibot-recidive-option-a.test.js` (12 tests, horloge simulée) ; `test/antibot-lot-c.test.js`
  (2 attentes mises à jour : 1 défi/h → 1/h puis 1/30 min dès 180 min sur 6 h) ;
  `test/e2e/antibot-freeze-proof.e2e.js` (contrôle option A dans la fiche admin).
- Aucune migration, aucune donnée joueur modifiée, aucune modification rétroactive : les cumuls
  actuels des joueurs (déjà remis à zéro par les défis passés) repartent tels quels.

## 4. Résultat du scénario bot supervisé (simulation, 8 clics/s, défi résolu en 60 s)

Défis à 1 h et 2 h (série 60 min), puis **180 min / 6 h atteint à ≈ 3 h** et **360 min / 24 h à ≈ 6 h** ;
ensuite un défi toutes les 30 min tant que le bot continue (≈ 10 défis en 7 h au lieu de 7). Aucune
suspension (client officiel, défis résolus). Humain 6 clics/s (20 min / 10 min de pause) pendant
4 h 30 avec un défi admin résolu : **aucun défi automatique, aucune sanction**, cumul 6 h conservé
sous le seuil.

## 5. Tests

- `npm test` **943/943** sur la branche (`14cabb3`), sur `develop` `18f4cd1` et sur la release.
- Nouveau `test/antibot-recidive-option-a.test.js` (12 tests, horloge simulée) : défauts inchangés
  (Observation, 60/180/360, délai 30) ; bot supervisé 8 clics/s fixe (série remise à zéro, cumuls
  conservés ; 180 min/6 h à ≈ 3 h, 360 min/24 h à ≈ 6 h ; au plus un défi par 30 min ensuite ; temps
  bloqué non compté) ; bot à cadence variable 4–12 clics/s ; humain avec pauses + défi admin résolu
  (aucun défi automatique, aucune sanction) ; frontières glissantes 6 h / 24 h ; F5, nouvel appareil,
  changement de saison, absence ; client modifié (cumul figé pendant le défi) ; pas de double
  comptage à la résolution ; onglets concurrents (actif ≤ temps écoulé) ; annulation admin ; preuve
  du gel +0.
- Essais navigateur (serveur de test, port 3101, base isolée) : `antibot-freeze-proof` **TOUT OK**
  en 1280×900 et 390×844 (vrais clics 8/s, défi à ≈ 57 s, résolu dans le jeu, gel +0, reprise
  ≈ 7,2 clics/s, **contrôle option A : série 0,6 min, actif 6 h 1,6 min, actif 24 h 1,6 min après la
  résolution**, aucune erreur JS) ; `admin-antibot-87-guided`, `antibot-challenge`,
  `admin-antibot-sheet` TOUT OK. Limite : relancer `antibot-freeze-proof` plusieurs fois sur le
  MÊME serveur de test échoue (défi non affiché) — sur serveur et base neufs il réussit à chaque
  fois ; pollution d'essai entre passages, pas une régression (le premier passage du code identique
  avait réussi).

## 6. Déploiement

- **SHA déployé : `18f4cd1`** (merge dans `develop`), 08/11/2026 14:56 Bruxelles, `scripts/deploy.sh`
  de la release. Sauvegarde vérifiée : `~/backups/dig/dig-20261108-145600-pre-deploy-18f4cd1.sqlite`.
- Copie de la base de production : empreintes (lignes + hachage) de `users`, `user_saves`,
  `season_rankings`, `seasons`, `leagues`, `player_click_tracking`, `antibot_activity` **identiques**
  avant et après démarrage ; aucune migration ; copie supprimée.
- Après déploiement : 2 domaines 200, `/api/version` = `1.0.0+18f4cd1`, aucune erreur au journal,
  `quick_check` ok, classement identique à la sauvegarde (221 / 80 blocs validés).
- **Mode global : `observe` (Observation), lu en base avant et après — inchangé.** Aucun essai Appliqué
  actif en production ; aucun défi ni suspension créé sur des joueurs réels.
- Retour arrière : `git reset --keep 0c5d24e` + redémarrage (aucun changement de schéma).

### Test fonctionnel à faire par le propriétaire (≈ 3 min, unique)

Le défi, le gel et la reprise sont déjà validés : ce test ne vérifie que l'option A.
1. Admin → Anti-bot → « Tester la protection » : votre compte, « Lancer l'essai », délai **1 min**.
2. Dans le jeu : autoclicker jusqu'à « Petite vérification », résolvez-la, relancez 30 s.
3. Admin → même écran, « Diagnostic avancé de ce compte », encadré « Ce que le serveur a vu » :
   « Minage continu sans pause : **< 1 min** » (repartie de zéro à la résolution) et « Temps de minage
   actif : **≈ 1,5 / 180 min sur 6 h, ≈ 1,5 / 360 min sur 24 h** » (conservé : avant ce correctif, ce
   cumul retombait à 0 à la résolution et ne montrait que la reprise). En haut : « Protection des
   joueurs : **Observation** ».
4. « Terminer le test ».

Classement MVP : **Bloquant pour des récompenses réelles** (anti-contournement du bot supervisé),
pas pour la bêta fermée sans lot.

## 7. Choix techniques faits seul

- Redéclenchement d'un cumul au-dessus du seuil limité par `ab_cooldown_min` (réglage existant,
  libellé « délai minimal entre deux défis ») : sans limite, chaque sauvegarde (12 s) relancerait un
  défi ; aucun nouveau paramètre, seuils inchangés.
- Le temps pendant un défi n'est compté ni comme minage ni comme pause : la série est déjà remise à
  zéro à l'émission, compter une pause n'aurait aucun effet utile.
- Indicateur de gigue (`narrow_jitter`) : agrégé « par série », il repart avec la série (inchangé).
- Onglets concurrents : déjà bloqués par la session de jeu unique (#35) ; le temps actif reste de
  toute façon borné par le temps écoulé (testé).

## 8. Décisions demandées au propriétaire

1. Rappel (inchangé, décision distincte annoncée) : défis et suspensions en **Appliqué pour tous** —
   (a) après cette recette, (b) dès la bêta, (c) après 1 semaine d'Observation. Recommandation : (a),
   au plus tard (c) ; obligatoire avant tout classement doté d'un lot réel.
2. Les autres questions (seuils par défaut, Turnstile, éligibilité #19, contestation, lot D) restent
   valables sans changement.

## 9. Éléments restant à réaliser

- Activation générale du mode Appliqué : sur décision distincte — Bloquant pour des récompenses réelles.
- Option B : non autorisée, rien à faire.

---

# Session du 08/11/2026 (fin d'après-midi) — Protections « Appliqué » pour tous, arrêt d'urgence, chrono de l'énigme

## 1. Ticket et état réel

#25 — [P0] Protection anti-bot globale — https://github.com/ReC82/Dig/issues/25

**Déployé en production (SHA `55240ce`, 08/11/2026 15:36 Bruxelles) — protections « Appliqué » actives pour tous, vérifié en base ; en attente de recette.**

Sources (commentaires du propriétaire du 08/11/2026) :
[13:11 UTC, chrono](https://github.com/ReC82/Dig/issues/25#issuecomment-6721915229),
[13:28 UTC, protections globales actives](https://github.com/ReC82/Dig/issues/25#issuecomment-6722088344),
[13:32 UTC, mise en service immédiate pour tous](https://github.com/ReC82/Dig/issues/25#issuecomment-6722134355).
Le commentaire de 12:53 UTC (preuve du gel, +0 bloc) ne demande rien de plus. La session
précédente n'avait pas pris en compte ceux de 13:11 à 13:32 (elle disait encore « Appliqué = décision
distincte »).

## 2. Résultat et changements

| Demande | Fait |
|---|---|
| Activer **Appliqué pour tous** sans clic du propriétaire, de façon traçable | Décision de réglage journalisée `issue25-global-enforce-2026-11-08` (mécanisme existant `admin_config_decisions`, déjà utilisé pour #19) : `antibot_response_mode` passe de `observe` à `enforce` **une seule fois**, au démarrage. Elle n'est jamais rejouée : un arrêt d'urgence reste acquis après un redémarrage. Si le réglage a été modifié entre-temps, il est respecté et la décision est notée « skipped ». Aucun contournement de l'authentification admin. |
| Arrêt d'urgence visible et immédiat | En tête de Admin → Anti-bot, quand le mode est Appliqué : gros bouton rouge **« 🚨 Arrêt d'urgence : repasser en Observation »**. Il agit en un clic, sans confirmation, et l'action est journalisée (audit `admin_config`). En Observation, les défis en attente ne bloquent plus le minage ; rien n'est supprimé. Pour réactiver : Réglages → « Appliqué » (avec confirmation). |
| Levée des sanctions erronées | Déjà en place (fiche joueur : annuler le défi, lever la suspension, remettre le palier à 0). Vérifié, rien à changer. |
| Chrono de l'énigme | « Vérification : encore 00:30 » et une barre discrète, orange sous 10 s. **30 s** pour la grille et **60 s** pour la version accessible (texte), réglables dans Config → Protections (`ab_puzzle_seconds` 10–300, `ab_puzzle_text_seconds` 10–600). À zéro : l'énigme est désactivée, le message dit « Le temps est écoulé. Demande une autre énigme (aucune sanction). » et le focus va sur « Autre énigme ». |
| Sécurité du chrono | Le serveur garde sa propre expiration : durée + 5 s de marge réseau, comptée depuis la demande de l'énigme. Le jeu ne demande l'énigme que quand la fenêtre est réellement affichée. Le navigateur décompte avec son horloge monotone (`performance.now`) : l'heure du PC n'intervient pas, et le décompte est recalculé au retour d'un onglet en arrière-plan. Fenêtre fermée puis rouverte après expiration : nouvelle énigme avec chrono complet. Usage unique, délai minimal de 1,2 s, plafond de 15 énigmes par 10 min : inchangés. Tant que le défi n'est pas résolu, le minage classé reste gelé. |
| Aucune sanction pour un temps écoulé, une erreur ou un abandon | Inchangé et testé : ni suspension, ni palier. Une suspension n'existe que pour ≥ 30 clics déclarés après l'affichage du défi. Le jeu officiel bloque ces clics, donc seul un client modifié ou un automate qui ignore la fenêtre peut y arriver. |

Inchangés : seuils 60 / 180 / 360 min, score 60, délai minimal 30 min, paliers 5 → 1440 min, option A (cumuls conservés), option B non appliquée, Auto-Dig jamais compté.

Fichiers : `server/db.js` (décision et 2 réglages ajoutés), `server/antibotResponses.js` (durée de l'énigme), `server/index.js` (config transmise), `public/js/antibotGate.js` (chrono), `public/js/i18n.js` et `public/js/locales/it.js` / `i18n/it.json` (2 textes × 5 langues), `public/css/style.css`, `public/admin/index.html` et `public/admin/admin.js` (arrêt d'urgence, 2 réglages), tests.

## 3. Hors de ce lot (renvoyé à #91, ticket dédié du propriétaire)

- **Défi après 25 clics consécutifs au même pixel**, détection de cadence fixe à 125 ms, `isTrusted` et signaux croisés sur des fenêtres de 10 à 60 s. Le propriétaire a confié ce volet à #91 (commentaire du 13:19 UTC). Il n'est pas codé ici, pour ne pas faire deux fois le même travail.
- Pour l'instant, un autoclicker à 8 clics/s déclenche une vérification **réelle** au bout de 60 min de minage continu, puis à 180 min sur 6 h et 360 min sur 24 h, puis au plus une fois toutes les 30 min. Pendant chaque vérification, le classement est gelé. Ce n'est **pas** une détection en quelques secondes : c'est l'objet de #91.

## 4. SHA, branche, procédure de test

- Branche `feature/25-anti-bot-lots-ab`, commit `52f6afb` ; **develop `55240ce`** (fusion, arbre identique).
- `npm test` : 949/949 sur la branche, 949/949 sur la release `55240ce`. Nouveau fichier `test/antibot-global-enforce-timer.test.js` (6 tests) : décision appliquée une seule fois, arrêt d'urgence conservé au redémarrage, réglage modifié respecté, `ANTIBOT=off` toujours prioritaire, 30 / 60 s et marge de 5 s, temps écoulé sans sanction, bornes et plafond de renouvellement. 3 attentes « défaut Observation » mises à jour (`antibot-lot-c`, `antibot-recidive-option-a`, `leagues-beta-threshold`).
- Essais navigateur (serveur de test, base neuve, port 3125) : `test/e2e/antibot-timer.e2e.js` **TOUT OK** en 1280×900 et 390×844 (compte ordinaire en Appliqué, chrono réduit à 10 s pour l'essai) : chrono affiché, temps écoulé (tuiles désactivées, message, aucune suspension), « Autre énigme » → chrono complet, réouverture après expiration → nouvelle énigme, résolution, arrêt d'urgence visible → Observation en un clic. `antibot-challenge.e2e.js` OK. Les e2e plus anciens (`antibot-challenge`, `antibot-freeze-proof`, `admin-antibot-87`) repassent d'abord en Observation, puisqu'une base neuve est désormais en Appliqué.

## 5. Impact sur les données des joueurs

Aucune donnée joueur modifiée. Deux réglages sont ajoutés (`ab_puzzle_seconds`, `ab_puzzle_text_seconds`), un réglage est modifié par décision journalisée (`antibot_response_mode`) et la table `admin_config_decisions` gagne une ligne. Les gains passés ne sont jamais retirés.

## 6. Déploiement

- SHA déployé : **`55240ce`** (18f4cd1 → 55240ce, `npm ci` non nécessaire). Sauvegarde vérifiée avant déploiement : `~/backups/dig/dig-20261108-153623-pre-deploy-55240ce.sqlite`.
- Avant : release `npm test` 949/949. Sur une copie de la base de production démarrée en mode production : `/health` ok, version `1.0.0+55240ce`, décision appliquée (`observe → enforce`), empreintes des 6 tables joueurs identiques avant et après le démarrage ; copie supprimée.
- Après : les 2 domaines répondent 200 avec la version `1.0.0+55240ce` ; journal sans erreur (`[db] Décision issue25-global-enforce-2026-11-08 : antibot_response_mode observe → enforce`) ; `quick_check` ok. **En base de production : `antibot_response_mode = enforce`**, `ab_puzzle_seconds = 30`, `ab_puzzle_text_seconds = 60`, décision `applied` à 14:36:23 UTC. Saves et classement identiques à la sauvegarde pré-déploiement. Page du jeu chargée en Chromium (1280×900 et 390×844) : module de vérification présent, 0 erreur JavaScript.
- Retour arrière : **arrêt d'urgence** dans Admin → Anti-bot (un clic, sans redéploiement). Retour de code : `git -C /home/ubuntu/Dig reset --keep 18f4cd1` puis redémarrage. Le mode reste Appliqué tant que l'arrêt d'urgence n'est pas utilisé, car la décision n'est pas rejouée et pas annulée par un retour de code.

### Test fonctionnel à faire par le propriétaire (≈ 3 min)

1. Admin → Anti-bot : en haut, « Protection des joueurs : **Appliquée** » et le bouton rouge « Arrêt d'urgence ».
2. « Tester la protection » avec votre compte, puis « Sans autoclicker : envoyer la vérification tout de suite ». Ouvrez le jeu : « Vérification : encore 00:30 » décompte.
3. Attendez 30 s sans répondre : « Le temps est écoulé… » apparaît, les symboles sont grisés. Cliquez sur « Autre énigme » : le chrono repart à 00:30. Résolvez.
4. Optionnel : « Version accessible (texte) » → 01:00.
5. « Terminer le test ». Le mode global reste **Appliqué**. L'arrêt d'urgence n'est à utiliser qu'en cas de faux positifs.

Résultat attendu : aucune suspension, aucune perte, minage repris après la résolution.

Classement MVP : **Bloquant MVP public** (classement doté de lots pour la bêta du 09/11), livré.

## 7. Choix techniques faits seul

- **Activation par décision de réglage au démarrage**, plutôt que par le panel, faute d'accès admin (secret non lisible, par règle). Ce mécanisme existe déjà, est journalisé et réversible, et respecte un réglage modifié entre-temps. Une base neuve (test, réinstallation) démarre donc aussi en Appliqué.
- **Arrêt d'urgence sans confirmation**, comme demandé (« immédiat ») ; la réactivation garde sa confirmation.
- **Marge serveur de 5 s** au-delà du chrono affiché : la latence et un téléphone lent ne doivent pas transformer une bonne réponse donnée à 00:01 en « expirée ».
- **Pas de renouvellement automatique** au temps écoulé : le joueur clique sur « Autre énigme », comme demandé. Une réponse fausse ou une expiration détectée par le serveur donne, elle, une nouvelle énigme tout de suite (comportement existant).
- Le chrono part de la **demande de l'énigme**, pas de l'émission du défi : un défi émis onglet fermé ne fait pas courir le temps.

## 8. Décisions demandées au propriétaire

1. Durée du chrono : **30 s** (grille) / **60 s** (texte) par défaut. Comparatif : 20 s = rapide mais stressant sur mobile ; **30 s** = une grille de 6 symboles se résout en 3 à 8 s ; 45 s / 60 s = plus confortable, sans gain anti-bot (un bot répond en 1,2 s ou pas du tout). Recommandation : garder 30 / 60 s et ajuster dans Config → Protections si des collègues se plaignent.
2. Les autres questions (Turnstile, éligibilité #19, adresse de contestation, lot D) restent sans changement. La question « Appliqué pour tous » est **tranchée** (13:32 UTC) et appliquée.

## 9. Éléments restant à réaliser

- #91 : défi après 25 clics au même pixel, cadence 125 ms, signaux croisés, suspensions sur fraude corroborée — **Bloquant pour un concours sérieux**, en cours dans #91.
- Audit écrit complet des flux de crédit (pièces, ressources, profondeur) pendant un défi ou une suspension, demandé à 12:59 UTC. **Non refait dans cette session.** Le gel du classement (blocs manuels) et de la profondeur hors Auto-Dig est prouvé (recette #25-G, +0). Le jeu officiel bloque les coups pendant un défi, donc pas de pièces ni de ressources par le minage manuel. En revanche, la validation serveur des monnaies face à un client modifié n'a pas été auditée ici (lien avec #74 / #77). À documenter dans une prochaine session — Bloquant pour des lots plus importants, pas pour la bêta.

---

# Session du 08/11/2026 (soir) — Décision « CAPTCHA maison conservé » et audit des flux de crédit pendant un défi

## 1. Ticket et état réel

#25 — [P0] Protection anti-bot globale — https://github.com/ReC82/Dig/issues/25

**Déployé en production (SHA `55240ce`) — en attente de recette. Cette session n'ajoute que de la documentation, sans code ni déploiement.**

Source : [décision du propriétaire du 08/11/2026, 13:59 UTC](https://github.com/ReC82/Dig/issues/25#issuecomment-6722406587).
Le propriétaire garde le **CAPTCHA natif de Dig** et veut l'améliorer. Il ne veut **ni Cloudflare Turnstile ni aucun service CAPTCHA tiers**, ni dépense ou dépendance Cloudflare. Il demande de poursuivre en local les détecteurs et le chronomètre prévus.

## 2. Résultat

| Point de la décision | Situation |
|---|---|
| Pas de CAPTCHA tiers | Vérifié : aucune trace de Turnstile, hCaptcha ou reCAPTCHA dans le code de `develop` (seulement dans les rapports). Rien à retirer. La question n°3 du rapport (Turnstile) est **tranchée** et retirée des questions ouvertes. |
| Chronomètre de vérification | **Déjà en production** (`55240ce`) : 30 s pour la grille et 60 s pour la version accessible, réglables, avec une expiration côté serveur. Rien de plus à faire ici. |
| Détecteurs locaux (25 clics au même pixel, cadence 125 ms, signaux croisés) | Confiés par le propriétaire à **#91** (13:19 UTC). Pas codés dans #25, pour ne pas faire deux fois le travail. La décision « CAPTCHA maison » s'applique aussi à #91. |

Audit demandé le 08/11 à 12:59 UTC (point 2), resté en suspens jusqu'ici. Il a été fait par lecture du code de `develop` et des réglages de production, en **lecture seule**.

### Matrice des gains avant / pendant / après un défi (mode Appliqué, en production depuis `55240ce`)

« Pendant » = un défi est en attente ou le minage manuel est suspendu. Le serveur pose alors un **gel** (`antibotResponses.beforeSave` → `hold`).

| Gain | Qui fait foi | Avant / après le défi | Pendant le défi, jeu officiel | Pendant le défi, client modifié |
|---|---|---|---|---|
| **Blocs manuels classés** (classement, lots de la bêta) | Serveur (`season_rankings.effective_manual_blocks`) | Crédités dans la limite des contrôles existants : clics ≥ blocs, plafond de cadence `processAntiCheat` (refusé / réduit / signalé), blocs ≤ profondeur retenue − 1 | **+0** : les coups sont bloqués à l'écran | **+0** : les compteurs de la fenêtre sont consommés sans crédit et le total validé est plafonné à sa valeur d'avant la sauvegarde (`recordHoldSave`). Prouvé en production (recettes #25-G et #87-C : +0). |
| **Profondeur retenue** (sert au classement, aux badges, aux souvenirs et à la collection) | Serveur (`depth_tracking.accepted_depth`, budget de clics, #9) | Avance selon le budget de clics validés | **Gelée** pour le minage manuel ; l'Auto-Dig (amélioration achetée) continue | **Gelée** : les clics de la fenêtre sont consommés et une profondeur déclarée plus grande est ignorée |
| Profondeur, blocs et statistiques **affichés dans la sauvegarde** | Navigateur (`user_saves.data`) | Enregistrés tels quels | Pas de minage manuel, donc pas de hausse | **Peuvent être écrits librement**. Ils ne comptent ni pour le classement ni pour les lots, qui ne lisent que les valeurs retenues par le serveur. |
| **Badges, souvenirs d'événement (#56), collection (#39)** | Serveur, tirages fondés sur la profondeur retenue et les blocs validés | Selon les valeurs validées | Gelés, puisque leur base est gelée | Gelés, pour la même raison |
| **Points de récompense et gagnants** (#29, #33) | Serveur, depuis le classement figé en fin de saison | Dérivés du classement | Dérivés du classement gelé | Idem |
| **Pièces, ressources, améliorations** | **Navigateur** (sauvegarde) | Gagnées en minant | Pas de minage, donc pas de gain | **Non protégées, avec ou sans défi** : un client modifié peut déclarer n'importe quel montant. Les dépenses côté serveur (ouverture de coffre en boutique) sont débitées sur ce solde déclaré. Ce n'est pas lié au défi. |
| **Gemmes** | Navigateur aujourd'hui ; registre serveur #49 en mode **`off`** en production | Déclarées par le jeu | Pas de gain par le minage | Non protégées tant que le registre #49 n'est pas en `enforce` |
| **Missions quotidiennes** | Mode serveur #68 **`off`** en production (calcul dans le navigateur) | Côté navigateur | Pas de progression par le minage | Non protégées tant que #68 est `off` (le double paiement #83 est bloqué) |
| PV exacts des blocs | #77 en **`shadow`** (observation) | — | — | Mesurés, sans effet |

### Conclusion de l'audit

1. **Pour la bêta du 09/11, ce qui donne droit aux lots est protégé** : blocs manuels classés et profondeur retenue, calculés par le serveur. Pendant un défi, ils sont gelés, même contre un client modifié. Aucun autre chemin ne crédite le classement : l'Auto-Dig n'entre jamais dans le classement, et les badges, souvenirs et collection n'en sont que des dérivés.
2. **Ce qui n'est pas protégé, et ne l'était pas non plus avant le défi** : les gains *entre* deux défis par un autoclicker supervisé (c'est l'objet de #91), et les monnaies du jeu (pièces, ressources, gemmes) face à un client modifié. Ces monnaies ne comptent pas pour les lots. Leur validation serveur relève de #49 (registre de gemmes, à passer en `enforce`) et de #77 (PV exacts, en `shadow`). Elle sort du périmètre de #25.
3. Aucun retrait rétroactif automatique n'a été fait ni proposé.

## 3. SHA, branche, procédure de vérification

- Branche `feature/25-anti-bot-lots-ab`. Code inchangé depuis `55240ce`, déjà en production ; seul ce rapport est ajouté.
- Pour relire l'audit : `server/index.js` (`POST /api/me/save`, ouverture de coffre, réclamation de mission), `server/seasons.js` (`_syncPlayerRanking` : `beforeSave`, `validateDepth`, `recordHoldSave`), `server/badges.js` / `monthlyEvents.js` / `collectionPity.js` (`processSave`, base = `accepted_depth`), `server/chestShop.js` (`rollChest`, débit sur `data.coins`).
- Réglages de production lus en lecture seule : `antibot_response_mode = enforce`, `ab_puzzle_seconds = 30`, `ab_puzzle_text_seconds = 60`, registre de gemmes `off`, missions serveur `off`, `exact_hp_mode = shadow`.

## 4. Impact sur les données des joueurs et déploiement

Aucune donnée modifiée. Rien à déployer : un commit de rapport seul ne justifie pas un déploiement. La production reste en **`55240ce`**.

Test fonctionnel à faire par le propriétaire : **le même que dans la section précédente** (chrono, temps écoulé, « Autre énigme », arrêt d'urgence, ≈ 3 min). Classement MVP : **Bloquant MVP public**, livré.

## 5. Décisions demandées au propriétaire

1. Chrono : garder 30 s (grille) / 60 s (texte) ? Recommandation : oui, et ajuster dans Config → Protections en cas de plaintes.
2. Optionnel : éligibilité aux récompenses (≥ 30 min de jeu sur ≥ 2 jours) via #19 ? Recommandation : oui.
3. Optionnel : adresse de contestation ? Recommandation : l'expéditeur SMTP de #23 ou une adresse dédiée.
4. Optionnel : reporter le lot D après le lancement ? Recommandation : oui.

La question Turnstile est **tranchée** (CAPTCHA maison, aucun tiers).

## 6. Éléments restant à réaliser

- #91 : détecteurs locaux rapides (25 clics au même pixel, cadence, signaux croisés) et suspensions graduées. **Bloquant pour un concours sérieux.**
- #49 en `enforce` (gemmes) et #77 (PV exacts) : validation serveur des monnaies face à un client modifié. **Après lancement** pour la bêta à petits lots, puisque les lots ne dépendent que du classement ; à faire avant des lots plus importants.

---

# Session du 09/11/2026 — « Terminer le test » grisé sans explication (recette du 09/11, BLOQUÉE UX)

## 1. Ticket et état réel

#25 — [P0] Protection anti-bot globale — https://github.com/ReC82/Dig/issues/25

**Déployé en production (SHA `611cf30`) — en attente de recette.**

Source : [recette du propriétaire du 09/11/2026, 13:51 UTC](https://github.com/ReC82/Dig/issues/25#issuecomment-6741715484). Dans Admin → Anti-bot → « Tester la protection », sur le compte de test du propriétaire, après une vérification résolue : bandeau « Résolu », gel vérifié (+0), mais l'étape 5 « Terminer et remettre à l'état normal » avait un bouton **« Terminer le test » grisé, sans aucune raison**.

## 2. Diagnostic : état cohérent, explication absente

Le bouton était **volontairement** grisé : il n'y avait **plus rien à remettre en état**. Ce n'était **pas** un état incohérent.

- Condition exacte (avant correctif) : le bouton n'était actif que si le compte avait **au moins un** de ces éléments : essai propre au compte (`testEnforce`), délai court, vérification en attente, suspension, ou palier de sanction supérieur à 0.
- Le mode est « Appliqué » **pour tous** depuis le 08/11. L'étape 2 (« Lancer l'essai ») n'a donc rien à faire. L'étape 3 (délai court) était **grisée elle aussi**, car elle exigeait un essai propre au compte. Il ne restait que « envoyer la vérification tout de suite ».
- Une fois cette vérification résolue, le serveur n'avait plus rien d'actif à nettoyer. Relevé en lecture seule de la base de production pour ce compte : vérification n° 9 `solved` (émise à 13:46:16 UTC, résolue à 13:47:16 UTC), aucun essai, aucun délai court, palier 0, aucune suspension active.
- Le défaut : l'étape 5 restait affichée **comme l'étape à faire** (encadrée en doré), avec un bouton grisé et **aucun texte**. La phrase « Test terminé » n'apparaissait qu'après un clic… sur ce bouton grisé. Le parcours ne pouvait donc **jamais se terminer** visuellement en mode « Appliqué » pour tous.

## 3. Correctif (interface admin uniquement)

| Situation du compte | Étape 5 maintenant |
|---|---|
| Vérification résolue ou annulée, rien d'actif (le cas de la capture) | Étape **cochée**, badge **« Terminé »**, texte : « ✓ Essai terminé — *pseudo* mine normalement ; aucune remise à zéro nécessaire (ni essai, ni délai court, ni vérification, ni suspension en cours). Protection des autres joueurs inchangée (Appliqué). » « Terminer le test » est masqué ; **« Nouveau test »** apparaît. |
| Quelque chose reste actif | « Terminer le test » **actif**, avec la liste de ce qui reste, par exemple : « À remettre en état : vérification en attente » ou « délai court, essai sur ce compte ». |
| Rien encore fait | Bouton grisé **avec sa raison** : « Rien à remettre en état : aucun essai, délai court, vérification ni suspension sur ce compte. » |
| Après un clic sur « Terminer le test » | « ✓ Test terminé : *pseudo* est revenu à l'état normal », étape cochée, « Nouveau test ». |

- **« Nouveau test »** n'appelle **pas** le serveur et **n'efface rien**. Le parcours ignore seulement les vérifications déjà terminées et revient à l'étape 3.
- **Étape 3 en mode « Appliqué » pour tous** : « Activer le délai de 1/2/3 min » n'est plus grisé. Il place d'abord **ce compte seul** en essai (route existante `test-mode`), puis il active le délai court. Pour ce compte, rien ne change dans ce qu'il subit, puisqu'il est déjà en « Appliqué ». Cela rend le test avec un autoclicker de nouveau possible, et « Terminer le test » retire ensuite l'essai et le délai. Le texte de l'étape l'annonce : « Activer un délai court place ce compte seul en essai. »
- Après un F5 : rien n'est stocké dans le navigateur. En rechoisissant le compte, l'état terminé est relu côté serveur. Il reste affiché tant que la vérification a moins de 2 h.
- Fichiers : `public/admin/admin.js` (`secTestEnd`, `secTestChallenge`, `secTestRender`, boutons), `public/admin/index.html` (bouton « Nouveau test »), `public/admin/admin.css` (une ligne). Aucun changement côté serveur.

**Inchangés** : mode global, seuils, chrono, détecteurs #91 et #92, routes du serveur et règles anti-bot. Aucun joueur suspendu ni modifié.

## 4. SHA, branche, vérification

- Branche `feature/25-anti-bot-lots-ab`, commit `dcd8496`. Intégré dans `develop` : `611cf30`.
- `npm test` : **1042/1042** sur le SHA exact `611cf30` (worktree de release). Un premier passage avait échoué, à cause d'un serveur de test orphelin de ma propre session resté sur le port 3131. Je l'ai arrêté, puis tout est passé.
- Nouveau test unitaire `test/antibot-admin-end-25.test.js` (8 cas) : vérification résolue (cas de la capture), vérification en attente (énigme expirée, signalement #84), suspension/palier/délai/essai, aucun test en cours, F5 après « Terminer », « Nouveau test » sans appel au serveur, délai court en mode « Appliqué » pour tous, et « Terminer » sans appel au serveur quand rien n'est actif.
- Nouvel essai navigateur `test/e2e/admin-antibot-end-25.e2e.js`, en **1280×900 et 390×844** : **TOUT OK, 0 erreur JS**. Il se déroule sur un serveur de test en mode « Appliqué » pour tous et rejoue tout le parcours **#84-E bis** :
  1. vérification envoyée tout de suite ;
  2. « 🐞 Signaler une erreur », puis envoi : « 🛡️ Reprendre la vérification » s'affiche, la vérification revient, le défi reste en attente côté serveur, et il n'y a **qu'un seul** signalement ;
  3. énigme résolue : étape 5 cochée, « Essai terminé… aucune remise à zéro nécessaire », « Nouveau test » ;
  4. F5 : même état ;
  5. « Nouveau test » : retour à l'étape 3, historique intact ;
  6. délai court de 1 min : « Terminer le test » actif, puis essai et délai retirés côté serveur ;
  7. le mode global reste « Appliqué » et la progression classée est conservée.
- Je n'ai **pas** testé l'énigme qui expire **pendant** le signalement : c'est déjà couvert par l'essai `antibot-report-84` du 08/11, et ce correctif n'y touche pas.

## 5. Données des joueurs et déploiement

- Copie de la base de production démarrée avec `611cf30` : empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking` **identiques**. Aucune migration.
- Sauvegarde avant déploiement : `dig-20261109-153922-pre-deploy-611cf30.sqlite` (vérifiée par `deploy.sh`). Aucune génération IA n'était en cours (dernier appel terminé à 13:45 UTC).
- Déployé le 09/11 à 15:39 (heure de Bruxelles) : `dc8cf1e` → `611cf30`. Les 2 domaines répondent 200 avec `1.0.0+611cf30`, le journal ne montre aucune erreur et `quick_check` est ok. Après le déploiement, seuls les horodatages de sauvegarde du compte ouvert ont avancé. Blocs, profondeur, pièces et classement sont identiques.
- Retour arrière possible vers `dc8cf1e`, sans toucher à la base.

## 6. Test fonctionnel à faire par le propriétaire (une seule recette, ≈ 3 min)

1. Admin → Anti-bot → « Tester la protection » → ton compte de test. *Attendu :* l'étape 5 ne montre plus un bouton grisé sans texte. Selon l'état du compte, elle affiche « Rien à remettre en état… » ou « ✓ Essai terminé… ».
2. « Sans autoclicker : envoyer la vérification tout de suite ». *Attendu :* l'étape 5 dit « À remettre en état : vérification en attente » et « Terminer le test » est actif.
3. Dans le jeu (F5), fais le parcours #84-E bis : « 🐞 Signaler une erreur », écris « essai #84-E bis », envoie, puis « 🛡️ Reprendre la vérification ». Résous l'énigme.
4. Admin → « ↻ Actualiser le résultat ». *Attendu :* étape 5 **cochée**, badge **Terminé**, « ✓ Essai terminé — *ton compte* mine normalement ; aucune remise à zéro nécessaire… », et un bouton **« Nouveau test »**. **C'est la bonne fin de #84-E bis : il n'y a rien d'autre à cliquer.**
5. Facultatif : « Nouveau test », puis « Activer le délai de 1 min » (désormais actif en mode « Appliqué »). *Attendu :* l'étape 5 dit « À remettre en état : délai court, essai sur ce compte ». « Terminer le test » mène à « ✓ Test terminé ». Le mode reste « Appliqué ».

Classement : **Bloquant MVP public** (le parcours de recette anti-bot ne pouvait pas être terminé).

## 7. Choix techniques faits seul

- J'ai gardé « Terminer le test » **inactif** quand rien n'est à nettoyer, plutôt que de le réactiver pour rien : il n'y a pas d'action trompeuse. À la place, l'interface affiche une raison écrite, l'étape cochée et « Nouveau test ».
- « Nouveau test » est purement visuel, pour qu'aucun historique ni aucune donnée ne soit effacé.
- J'ai réparé l'étape 3 en mode « Appliqué » pour tous : elle était grisée sans raison, et le test avec un autoclicker était impossible. Je réutilise la route d'essai existante, sans nouvelle route ni changement de règle.

## 8. Décisions demandées au propriétaire

Aucune nouvelle décision. Les questions facultatives précédentes (éligibilité via #19, adresse de contestation, lot D) restent inchangées.

## 9. Éléments restant à réaliser

- La recette ci-dessus, puis la validation de #84-E bis dans #84 (non validée tant que le propriétaire ne l'a pas testée).
- Idem session précédente : #91 (détecteurs) et la validation serveur des monnaies face à un client modifié (#49/#77) — Après lancement pour la bêta.
