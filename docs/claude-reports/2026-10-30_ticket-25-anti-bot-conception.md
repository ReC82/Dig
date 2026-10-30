# Ticket #25 — [P1] Protection anti-bot globale — détection, progression serveur et sanctions graduelles

- Ticket : https://github.com/ReC82/Dig/issues/25
- Conception : [`docs/ANTI-BOT.md`](../ANTI-BOT.md) (§ 10 = ce qui est réellement en place)
- Session 1 (30/10/2026, nuit) : phase 1, audit et conception — branche `docs/25-anti-bot-conception`
- **Session 2 (30/10/2026, midi) : phase 2, lots A et B réalisés et déployés** — branche
  `feature/25-anti-bot-lots-ab`

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
| `test/antibot.test.js` (nouveau) | 27 tests (voir § 5) |
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
