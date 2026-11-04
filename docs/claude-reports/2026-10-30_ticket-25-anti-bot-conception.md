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
