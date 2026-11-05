# Ticket #75 — [P0] Admin — Réinitialiser un joueur pour rejouer les tests, avec snapshot et historique des tentatives

- Ticket : [#75](https://github.com/ReC82/Dig/issues/75). Tickets liés : #74 (enquête sur le test de résistance), #25 (anti-bot), #73 (classement aux blocs manuels), #18 (révisions de sauvegarde), #35 (session de jeu unique).
- Session : 05/11/2026 (nuit), branche `feature/75-reset-essai-joueur`
- **État réel : déployé en production (SHA `7b70f6e`), en attente de recette du propriétaire**

Toutes les heures sont en **UTC** (Bruxelles = UTC + 1). Le compte étudié s'appelle ici « le compte testeur ». Ce rapport ne contient aucune adresse IP, aucun e-mail et aucun jeton.

---

## 1. Résumé

1. **Nouveau bouton « 🧪 Recommencer un test à zéro »** dans la fiche joueur (Admin → Économie & joueurs). L'opération se fait en une seule transaction : soit tout passe, soit rien ne change.
   - D'abord, un **instantané complet** de l'essai en cours est archivé.
   - Ensuite, le personnage revient à l'**état d'une inscription neuve**. Cela couvre la sauvegarde **et** le classement de la saison active, les suivis de profondeur et de clics, le score de risque, les badges, la collection serveur, les gemmes et la ligue.
   - Rien d'autre n'est touché : le compte, l'accès, l'invitation, les points de récompense, les saisons clôturées et tous les journaux anti-bot restent intacts.
2. **Aucune réinjection possible** :
   - les onglets, la PWA et les autres appareils déjà ouverts perdent la main et affichent « Progression réinitialisée par l'équipe » ;
   - une sauvegarde tardive est refusée ;
   - un vieux client qui n'envoie pas de révision est refusé aussi.
3. **Historique des essais** :
   - un tableau compare les essais : durée, profondeur, blocs, clics, Auto-Dig, ressources, risque et décisions du serveur ;
   - export CSV ou JSON complet ;
   - **restauration** d'un essai archivé, avec aperçu des différences. L'essai en cours est archivé avant, donc rien n'est détruit.
   - Le journal d'audit est en ajout seul et chaîné par empreinte.
4. **Constat important sur le « reset » du 04/11 (~23:05)** : l'appel au reset admin n'apparaît dans **aucun** journal. L'état observé correspond exactement au bouton du jeu **« Réinitialiser la partie »** (Paramètres), et non à la route admin (§ 3).
5. L'ancien « Reset saisonnier » s'appelle maintenant **« Réinitialisation saisonnière partielle »**. Il ne touche que la sauvegarde ; le classement et l'anti-bot ne changent pas. Il est désormais **précédé d'un instantané**.
6. **Aucune réinitialisation n'a été faite en production.** Le compte testeur n'a pas été modifié. Le reset a été essayé uniquement sur une copie de la base, supprimée ensuite (§ 5).

---

## 2. Ce qui a changé

| Fichier | Changement |
|---|---|
| `server/testRuns.js` (nouveau) | instantané, statistiques par essai, nouveau personnage, reset, restauration, historique, export, audit chaîné, garde |
| `server/index.js` | 6 routes admin `…/players/:id/test-runs…` ; garde dans `POST /api/me/save` ; `adminReset` dans les refus de sauvegarde, de coffre et dans le signal de présence ; réinitialisation partielle renommée et précédée d'un instantané |
| `server/gemLedger.js` | `onTestReset` : solde ramené à 0 par un mouvement tracé `test_reset` (ou `test_restore`), références remises à neuf, ancienne révision jamais recomptée |
| `public/admin/index.html`, `admin.js` | bloc « 🧪 Essais de test », fiche de confirmation (aperçu, motif, pseudo exact), exports, restauration ; libellé « Réinitialisation saisonnière partielle » |
| `public/js/main.js`, `i18n.js`, `locales/it.js`, `i18n/it.json` | message joueur « Progression réinitialisée par l'équipe » (FR/EN/NL/ES/IT), page bloquée jusqu'à « Jouer ici » (rechargement) |
| `docs/OPERATIONS.md` | procédure « Rejouer un test avec le même compte » |
| `test/test-runs.test.js`, `test/e2e/test-runs.e2e.js` | tests automatisés (§ 5) |

### 2.1 Ce que fait « Recommencer un test à zéro »

**Archivé** dans `player_test_runs`. Ces lignes ne peuvent être ni modifiées ni supprimées : des déclencheurs SQL le refusent. L'archive contient :
- le `testRunId`, le numéro d'essai, le début et la fin, l'auteur (`admin (session)` ou `admin (clé)`), le motif ;
- l'empreinte SHA-256 de l'instantané ;
- **l'instantané complet** : la sauvegarde et sa révision, toutes les lignes du joueur dans `season_rankings` (saisons clôturées comprises, à titre de référence), les suivis de clics et de profondeur, `risk_scores`, les badges et leurs compteurs, la collection serveur, les événements mensuels, le compte de gemmes, la ligue et la session de jeu ;
- les **repères des journaux** : l'identifiant maximum de `anticheat_logs`, `security_events`, `antibot_save_samples`, `user_events`, `gem_ledger` et `gem_anomalies`. Chaque ligne de journal est ainsi rattachée à son essai ;
- une **copie bornée** de ces lignes (5 000 au plus par table, sans empreinte d'IP). Elle est nécessaire parce que `security_events` et `antibot_save_samples` sont purgés au bout de 90 jours.

**Remis à l'état d'une inscription neuve** :
- **Sauvegarde** : 1 m, 0 pièce, 0 gemme, pioche 1, améliorations et Auto-Dig à 0, aucune relique, aucun fragment, aucun coffre acheté, collection et quêtes vides, statistiques à 0. Les compteurs de saison sont à 0 et rattachés à la saison active. La révision de sauvegarde augmente.
- **Supprimées pour la saison active seulement** : la ligne du joueur dans `season_rankings` (le joueur est **non classé**) et sa ligne `risk_scores`. Les autres tables du joueur sont vidées : suivis de clics et de profondeur, badges (obtenus, compteurs, suivi), collection serveur, événements mensuels (objets trouvés, curseurs).
- **Ligue** : la plus basse, comme à l'inscription.
- **Registre de gemmes** : un mouvement tracé ramène le solde à 0.

**Conservé** :
- compte, mot de passe, e-mail, liaisons Google et X, invitation bêta ;
- points de récompense, commandes, gagnants ;
- classements et instantanés des **saisons clôturées** ;
- tous les journaux.
- Sont aussi conservés, pour éviter tout double gain : les achats cosmétiques et le délai de publicité, la récompense quotidienne déjà réclamée aujourd'hui, et les missions du jour déjà réclamées. Leur progression du jour est gardée, avec la même règle que le reset de saison du jeu (B11).

**Journalisé** : `user_events` `admin_test_reset`, puis `security_events` `admin_test_reset`. Ce dernier garde l'ancien score de risque dans `score_before` : la remise à zéro du score n'est **pas silencieuse** et l'essai archivé conserve la preuve.

**Sécurités** :
- contrôle admin côté serveur ;
- en-tête `X-Dig-Admin` obligatoire sur la session admin, ce qui protège contre le CSRF ;
- pseudo à saisir à l'identique (la casse compte) et motif obligatoire ;
- **identifiant de requête** : un double clic ou un renvoi réseau renvoie le même résultat, sans second reset ;
- **révision attendue** : refus « relancez l'aperçu » si la sauvegarde a changé entre l'aperçu et la confirmation ;
- transaction `IMMEDIATE` : une panne au milieu annule tout. C'est testé.

### 2.2 Pourquoi l'ancien état ne peut pas revenir

- **Session de jeu** : le reset pose un contrôleur « reset » (#35). Toute page ouverte voit alors sa sauvegarde ou son coffre refusé (`notController` + `adminReset`). Au signal de présence suivant (≤ 15 s si la page est visible), elle affiche « 🔄 Progression réinitialisée par l'équipe » et cesse d'écrire. « Jouer ici » recharge la page, qui reprend la main et lit l'état réinitialisé.
- **Révision** : une sauvegarde différée qui porte l'ancienne révision est refusée (#18).
- **Garde `player_reset_guards`** : une sauvegarde **sans** révision (client d'avant #18) est refusée pour ce compte, même après l'expiration du bail.

### 2.3 Restauration d'un essai

Le bouton « Restaurer… » se trouve sur une ligne archivée. Le serveur vérifie d'abord l'empreinte de l'instantané. Il affiche ensuite l'aperçu des différences entre l'état actuel et l'état archivé. La confirmation demande, comme pour le reset, un motif et le pseudo exact.

Déroulement :
1. l'essai en cours est **archivé d'abord**, il reste restaurable ;
2. l'état archivé est réécrit ;
3. si l'instantané date d'une saison **déjà terminée**, seule la progression revient, et le classement de la saison active repart de zéro. Les saisons clôturées ne sont jamais touchées.

### 2.4 Historique

Le tableau montre une ligne par essai archivé, plus l'essai en cours, calculé en direct. Colonnes :
- période (heure de Bruxelles), durée, type de fin et motif ;
- profondeur classée et profondeur actuelle ;
- blocs manuels validés et déclarés ;
- clics, dont les clics suspects ;
- Auto-Dig en fin d'essai et maximum observé (« non journalisé » quand aucune donnée n'existe) ;
- pièces et gemmes ;
- risque ;
- décisions du serveur dans la fenêtre de l'essai (types d'événements de sécurité et actions anti-autoclic).

Sous le tableau, une ligne indique l'état du journal d'audit, par exemple « chaîne d'empreintes intacte ✓ ».

**Rien n'est inventé** : l'essai n° 1 commence à l'inscription et ne contient que ce qui est réellement en base.

---

## 3. Constat : le « reset » du 04/11 n'est pas passé par l'admin

Le commentaire du propriétaire attribue le reset de ~23:05 au reset saisonnier de la fiche joueur. Les trois sources consultées (lecture seule) ne le confirment pas :

| Source | Constat |
|---|---|
| journal nginx (`access.log`, `access.log.1`) | **aucun** `POST /api/admin/players/…/season-reset`, et aucune consultation de fiche joueur (`/api/admin/players/…`) le 04/11 au soir. Les seules actions admin de la soirée sont des invitations bêta (21:34–21:35), des générations d'icônes et un événement (23:31) |
| `security_events` `admin_action` (audit de toute écriture admin, #25) | aucun `season-reset`, jamais |
| `user_events` | aucun `admin_season_reset` pour ce compte |

**Inféré, avec un niveau de confiance élevé** : l'état observé correspond exactement au bouton du jeu **« Réinitialiser la partie »** (Paramètres → `Save.reset()` → `GameState.reset()`). Ce bouton :
- vide pièces, gemmes, profondeur, améliorations, reliques, collection et statistiques. Dans la sauvegarde de 23:53, `blocksDestroyed` vaut 342 (il valait 1 002 à 22:57) et les reliques sont réapparues à des niveaux plus bas ;
- **garde `seasonStats`** : `maxDepth` reste à 1 011 et `manualClicks` continue de 78 364 vers 98 179 puis 103 174 ;
- **ne touche pas au serveur**. La sauvegarde suivante écrase la sauvegarde serveur (révision valide) et le classement garde 1 011 m.

C'est donc bien « reset sauvegarde ≠ reset classement », mais par le bouton joueur. Ce bouton n'exige que la session du joueur. Le journal ne permet pas de dire qui l'a utilisé ; d'après l'activité de l'appareil, c'est probablement l'appareil du testeur.

**Conséquence pour #74** : l'état complet d'avant ce reset (22:57, 1 003 m) a disparu de la base. Il est **préservé** dans `~/forensics/ticket-74/` (session #74, empreintes `SHA256SUMS`) et analysé dans `docs/claude-reports/2026-11-05_ticket-74-enquete-test-resistance.md`. Rien de plus n'a été perdu depuis.

### 3.1 État actuel du compte testeur (copie de production, 05/11 00:47, lecture seule)

| Rubrique | Sauvegarde | Classement (saison active) |
|---|---|---|
| Profondeur | 450 m (déclarée max 1 011) | **1 011 m** (retenue 1 011) |
| Blocs manuels | 152 déclarés | **124 validés → 1ᵉʳ sur 3** |
| Clics | 103 174 (94 880 suspects) | — |
| Pioche / Auto-Dig / reliques | 15 / 5 / 6 reliques au niveau 5 | — |
| Pièces / gemmes | 2,09 M / 1 | — |
| Risque | — | 72,9 (niveau 2) |
| Journaux | 310 lignes anti-autoclic, 48 événements de sécurité, 400 échantillons de sauvegarde | — |

**Procédure sûre proposée au propriétaire**, rien n'a été lancé :
1. Admin → Économie & joueurs → fiche du compte testeur → **🧪 Essais de test**. La ligne « n° 1 (en cours) » montre les chiffres ci-dessus.
2. Facultatif : cliquez sur « Exporter JSON complet » pour garder une copie sur votre poste.
3. Cliquez sur « 🔄 Recommencer un test à zéro ». Relisez l'aperçu (1 011 m → 0, 124 blocs → 0, etc.), saisissez le motif et le pseudo exact, puis cliquez sur « Archiver l'essai n° 1 et remettre à zéro ».
4. Demandez au testeur de recharger le jeu (son écran affiche « Progression réinitialisée par l'équipe »), puis de rejouer.

---

## 4. Develop, branche et procédure de test

- Branche : `feature/75-reset-essai-joueur`, commit `ba03937`
- **Develop : `7b70f6e`** (fusion), **déployé**

Tests automatisés (base temporaire, port de test, aucun compte réel) :
```bash
npm test                                   # suite complète : 719/719
node --test test/test-runs.test.js         # #75 seul
# essai navigateur (serveur de TEST sur 3101, base test-75.sqlite) :
PW=…/playwright-core CHROME=…/chrome-headless-shell BASE=http://127.0.0.1:3101 ADMIN_SECRET=… node test/e2e/test-runs.e2e.js
```

---

## 5. Vérifications effectuées

**`test/test-runs.test.js`** (serveur réel, 3 joueurs, base temporaire) :
- **Classement** : le testeur est 1ᵉʳ avec 1 011 m et 57 blocs validés. Après le reset, il est **absent du classement**. Les lignes des deux autres joueurs sont **identiques octet pour octet** et leur ordre ne change pas.
- **Nouveau bloc** : après un bloc réellement cassé à la main, le testeur a 1 bloc, une profondeur de 2 m et un rang recalculé (> 1). L'Auto-Dig précédent est absent.
- **Confirmations** : sans authentification → 401. Pseudo avec une autre casse, motif vide ou identifiant invalide → 400. Révision obsolète → 409 `stale_preview`. Dans tous ces cas, rien ne change.
- **Transaction interrompue** : une panne SQL simulée au milieu donne 500. Sauvegarde, classement, suivis, registre de gemmes et session sont inchangés ; aucun essai n'est archivé.
- **Rejeu** : la même requête renvoyée donne `replayed: true`, sans second reset (une seule archive, révision inchangée).
- **État neuf** : profondeur, ressources, améliorations, reliques et statistiques à zéro. La récompense quotidienne et la mission déjà réclamées sont gardées (pas de double gain). La ligue revient à la plus basse. Le registre de gemmes passe à 0 avec un mouvement de −7. La saison clôturée est intacte (222 m). Les journaux anti-autoclic et de sécurité sont conservés. L'événement `admin_test_reset` garde `score_before = 74,9`.
- **Ancien onglet / PWA / sauvegarde différée** :
  - ancienne révision → 409 `adminReset` ;
  - signal de présence → `adminReset` ;
  - client sans révision → 409, aussi après l'expiration du bail (garde) ;
  - rechargement → la page reprend l'état réinitialisé.
- **Historique** :
  - essai n° 1 archivé avec 1 011 m, 57 blocs, Auto-Dig 3, risque 74,9, `flagged` × 1 ;
  - les preuves de l'essai 1 ne comptent pas dans l'essai 2 ;
  - export CSV à 3 lignes, export JSON avec instantané et preuves, sans empreinte d'IP ;
  - toute modification ou suppression d'archive ou d'audit est refusée par la base ;
  - chaîne d'audit intacte.
- **Restauration** : l'aperçu donne `rankedMaxDepth` 2 → 1 011. Une révision obsolète est refusée (409). Après restauration, la progression, le classement de la saison active, les gemmes, la ligue et les badges reviennent. L'essai 2 est archivé avec ses chiffres. La page de l'essai 2 ne peut pas écraser la restauration.
- **Réinitialisation saisonnière partielle** : un instantané est archivé avant l'écriture, et le message dit « partielle ».

**Essai navigateur** (`test/e2e/test-runs.e2e.js`, Chromium headless, **1280×900 et 390×844**) :
- inscription et minage dans une vraie page de jeu ;
- côté admin : fiche, aperçu, bouton désactivé tant que le pseudo n'est pas exact, confirmation, message, historique à 2 lignes, profondeur affichée « 1 m » ;
- la page de jeu restée ouverte affiche « 🔄 Progression réinitialisée par l'équipe » ; après « Jouer ici », elle affiche 1 m.

Résultat : **OK sur les deux formats**. Captures relues : la fiche et le message mobile sont lisibles, sans débordement.

**Copie de la base de production** (prise en lecture seule, puis supprimée, jamais transmise) :
- démarrage `NODE_ENV=production` : tables ajoutées seules, **empreintes identiques** des 6 tables joueurs ;
- reset du compte testeur **sur la copie** (44 ms) : non classé ; lignes des 2 autres joueurs et saisons clôturées identiques ; 310 lignes anti-autoclic et 48 événements de sécurité conservés ; instantané de 348 Ko.

**Suite complète** : 719/719 dans le worktree du ticket, dans `develop` et dans la release `7b70f6e`.

**Non vérifié** : un vrai appareil Android ou iOS avec la PWA installée. Le mécanisme est le même que pour un onglet (session de jeu #35), et il est testé côté serveur.

**Impact sur les données des joueurs** : aucun au déploiement (tables ajoutées seules). Le reset n'agit que sur clic du propriétaire, pour un joueur précis.

---

## 6. Déploiement

- **SHA déployé : `7b70f6e`** (avant : `14d2e8b`), `npm ci` non nécessaire (lock inchangé)
- Sauvegarde vérifiée avant déploiement : `~/backups/dig/dig-20261105-020133-pre-deploy-7b70f6e.sqlite`
- Contrôles avant déploiement : aucune génération IA en cours (dernier appel d'icône à 23:10). Copie de production démarrée en mode production, empreintes identiques.
- Après déploiement :
  - https://dig.lodygames.com et https://dig.lodylands.com → 200, `/api/version` = `1.0.0+7b70f6e` ;
  - journal du service sans erreur, `pragma quick_check` = ok ;
  - empreintes des 6 tables joueurs identiques à la sauvegarde pré-déploiement ;
  - les 3 nouvelles tables existent, avec 0 essai ;
  - le panel admin sert le nouveau bloc ;
  - la route est protégée (401 sans session).
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 14d2e8b` puis `sudo systemctl restart dig`. Les tables ajoutées sont simplement ignorées par l'ancien code.

### Test fonctionnel à faire par le propriétaire

1. **Sans risque, d'abord sur un compte de test à vous** (pas le compte testeur) : jouez quelques blocs, ouvrez la fiche du joueur, puis « 🧪 Essais de test » → « Recommencer un test à zéro ».
   - Attendu : récapitulatif ; bouton désactivé tant que le pseudo n'est pas exact ; puis « Essai n° 1 archivé … essai n° 2 commencé ».
   - Le jeu ouvert sur ce compte affiche « Progression réinitialisée par l'équipe ». Après « Jouer ici », il montre 1 m et 0 pièce. Le compte disparaît du classement jusqu'à son prochain bloc manuel.
2. « Exporter CSV » : le fichier contient l'essai 1 et l'essai 2 en cours.
3. « Restaurer… » sur l'essai 1 : l'aperçu montre les différences ; après confirmation, la progression revient et le tableau montre 2 essais archivés.
4. **Ensuite seulement, et si vous le décidez**, faites la même chose sur le compte testeur (procédure du § 3.1), puis demandez-lui de rejouer.

Classement MVP : **Bloquant MVP** (boucle de bêta P0 : relancer un test propre). Restes : **Après lancement**.

---

## 7. Choix techniques faits seul

1. **Le classement de la saison active est supprimé, pas mis à zéro.** Un nouveau joueur n'a aucune ligne, ce qui le rend « non classé ». La ligne réapparaît au premier bloc manuel validé.
2. **Badges, collection serveur et événements mensuels sont remis à zéro**, avec archive et restauration possibles. Sinon, leurs références serveur (blocs déjà validés) bloqueraient les comptes de l'essai suivant, et la collection reviendrait d'elle-même par `collectionPity.mergeInto`.
3. **Le score de risque de l'essai suivant repart de 0**, mais l'ancien score est archivé avec l'essai et inscrit dans l'événement de sécurité `admin_test_reset`. La preuve reste visible, et les deux essais ne se mélangent pas.
4. **Pas de double gain** : la récompense quotidienne et les missions déjà réclamées aujourd'hui sont gardées. Les points de récompense, les commandes et les gagnants ne sont jamais touchés.
5. **Les journaux sont rattachés par identifiant**, sans être déplacés ni effacés. Une copie bornée est jointe à l'instantané à cause de la purge à 90 jours.
6. **Ancien reset gardé**, mais renommé et précédé d'un instantané. Son comportement n'a pas changé : le remplacer aurait modifié une règle existante sans demande.

---

## 8. Décisions demandées au propriétaire

1. **Bouton joueur « Réinitialiser la partie » (Paramètres)**. Pour un compte connecté, il écrase la sauvegarde serveur sans instantané et garde les compteurs de saison et le classement. C'est ce qui s'est passé le 04/11.
   - Options : (a) le laisser tel quel ; (b) le masquer pour les comptes connectés pendant la bêta ; (c) le faire passer par le serveur, avec un instantané et une remise à zéro cohérente des compteurs de saison.
   - **Recommandation : (b) tout de suite, (c) après le lancement.** C'est une petite correction qui évite une perte d'historique, et elle peut se faire dans ce ticket si vous le validez.
2. **État d'avant le 04/11 23:05 (1 003 m), conservé dans `~/forensics/ticket-74/`**. Faut-il l'ajouter à l'historique comme « essai n° 0 (reconstitué depuis la sauvegarde de 22:57) », en lecture seule et non restaurable ?
   - **Recommandation : non.** Le rapport #74 le documente déjà en détail, et la fonction n'invente rien. À faire seulement si vous voulez comparer les essais dans le même tableau.

---

## 9. Reste à faire

- Vos décisions 1 et 2 ci-dessus (après lancement, sauf si vous choisissez 1(b)).
- Le reset du compte testeur lui-même : **à déclencher par vous** dans l'admin (§ 3.1). Il n'a pas été fait automatiquement, comme le ticket le demande.
