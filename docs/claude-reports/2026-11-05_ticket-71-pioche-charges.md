# Ticket #71 — Pioche à charges : implémentation bêta et remplacement des skins en boutique

- Ticket : [#71 — [P1] Pioche à charges — implémentation bêta et remplacement des skins en boutique](https://github.com/ReC82/Dig/issues/71)
- Session : 05/11/2026 (nuit), branche `feature/71-pioche-charges`
- Classement : **Après lancement** (mécanique d'économie nouvelle, livrée désactivée ; ne bloque pas le MVP public)

## 1. État réel

**Déployé en production (SHA `497b52a`) — en attente de recette.**

La mécanique est en production **désactivée (drapeau OFF)** : pour les joueurs, le seul changement visible est la
disparition de la section « Skins de pioche » de la boutique (articles jamais achetables : aucun paiement branché,
aucun skin possédé en base). La recette se fait en activant le mode **« Testeurs seulement »** pour ton compte.

## 2. Ce qui a été fait

### Étude avant de coder (demandée par le ticket)

Outil : `tools/balance/pickaxe-charges-sim.js` (réutilise le simulateur de saisons de #49 : vrai code du jeu, catalogue
de blocs publié, achats d'améliorations, gains hors ligne, profils de joueurs). Médianes sur 200 saisons de 7 jours,
nouveau joueur. Commande : `node tools/balance/pickaxe-charges-sim.js --runs 200`.

**Constat principal : un clicker se joue à 2–6 coups par seconde.** Une réserve de 100 coups dure donc 20 à 50
secondes de jeu actif, alors que la recharge à 10 s/coup ne rend que 6 coups par minute. Avec les chiffres
exploratoires (100 coups, 10 s/coup), la pioche est émoussée **95 % du temps** pour tous les profils actifs et la
profondeur de saison baisse de **50 à 60 %**.

| Profil (profondeur de saison au jeu actuel) | Exploratoire 100 / 10 s | **Bêta 1 500 / 3 s (défaut)** | 3 000 / 2 s | 5 000 / 1 s |
|---|---|---|---|---|
| Occasionnel lent, 20 min/j à 2 clics/s (211 m ≈ ton rythme) | −52 %, 1re panne après 0,9 min | **−12 %, 1re panne après 15 min** | 0 % | 0 % |
| Débutant, 20 min/j à 4 clics/s (309 m) | −58 %, panne après 0,5 min | **−34 %, panne après 7 min** | −13 % | 0 % |
| Régulier, 1 h/j (991 m) | −60 % | **−43 %** | −31 % | −13 % |
| Assidu, 3 h/j (2 054 m) | −63 % | **−54 %** | −47 % | −34 % |
| Automatique, 15 min/j + 8 h d'Auto-Dig (693 m) | −21 % | **0 %** | 0 % | 0 % |

Lecture : plus un joueur clique longtemps d'affilée, plus il est freiné ; l'Auto-Dig n'étant pas concerné, le profil
« automatique » n'est presque pas touché. Tableau complet (9 réglages × 5 profils, part des coups à pleine
puissance, pannes par jour) : sortie de la commande ci-dessus. Une usure en blocs n'a pas été étudiée (rejetée par le
ticket).

**Valeurs de départ retenues (prudentes, NON validées, toutes réglables dans l'admin)** : 1 500 coups, recharge
3 s/coup (réserve pleine en 75 min), bonus de retour à 10 % de la réserve. Pour ton rythme, la panne arrive après
~15 min de clics continus : la mécanique se voit pendant la recette sans casser la partie. Les arbres reprennent les
**ratios** de l'étude exploratoire (capacité ×1 → ×15, recharge ×1 → ×0,3), avec des prix en gemmes prudents
5/10/20/40/80/150/300 (605 💎 par arbre au total ; un joueur régulier gagne ~25 💎 par saison d'après #49). Recharge
en pièces : 3 pièces par charge à 1 m, indexé comme la récompense des blocs (+5 %/m) — à 100 m, +50 % de 1 500 coups
= 750 coups pour 13 388 pièces.

### Règles implémentées

- **Chaque frappe manuelle à pleine puissance consomme 1 charge**, quels que soient les PV du bloc ou la profondeur.
- **À 0 charge : pioche émoussée**, 1 dégât par coup, bonus de la pioche désactivés (niveau de pioche et relique
  Œil du mineur), améliorations conservées. Pendant la panne, les coups ne consomment rien et la réserve se recharge ;
  les bonus reviennent au **seuil de reprise** (10 % par défaut) — pas de yo-yo « 1 charge / 1 gros coup ».
- **Recharge automatique continue, y compris hors ligne** (calculée sur l'horodatage de la réserve).
- **Non concernés** : Auto-Dig (pas de clic manuel), bonus de pièces (Sac, reliques, boosts), Chance. Il n'existe pas
  de bombe dans le jeu (rien à exclure).
- **Aucun blocage, aucun achat imposé, aucun achat automatique**, aucune gemme dépensée sans confirmation.

### Boutique — « Pioche et entretien » remplace « Skins de pioche »

- Audit : les skins (Pioche dorée / diamant) étaient des articles en euros, **jamais achetables** (#11 : aucun
  paiement branché) ; en production, **0 sauvegarde** avec un skin et **0 achat** dans `gem_shop_purchases`. Rien à
  migrer. Le code d'affichage d'un skin possédé est conservé (aucun droit retiré), ainsi que les articles « skin » de
  la boutique en gemmes de #49 (fermée, non touchée).
- Section visible seulement quand la mécanique est active pour le joueur : état de la réserve, **deux améliorations
  permanentes en gemmes** (niveau, valeur actuelle → suivante, prix ; confirmation avec avant/après, prix et solde
  restant), **recharges +10/25/50 %** (charges réellement ajoutées et coût affichés sur la carte ; jamais de
  surfacturation près du maximum ; réserve pleine = rien à vendre).
- Sous le bloc : jauge bleue « ⛏ Réserve : n / cap coups · +1 toutes les 3 s », grise et orange en panne
  « 🪫 Pioche émoussée… bonus de retour dans … » avec un bouton « Recharger » vers la boutique ; la statistique
  « Dégâts » affiche « 1 🪫 » ; messages à la panne et au retour des bonus.

### Persistance, multi-appareils, saisons

- État dans la sauvegarde (`pickaxe` : réserve, horodatage, panne, niveaux, compteurs) — champ facultatif, sans
  changement de version ; une ancienne sauvegarde démarre réserve pleine.
- **Conservé** par le bouton reset du joueur, le changement de saison, le reset admin partiel et le changement
  d'appareil (sauvegarde cloud ; vérifié en navigateur : réserve reprise sur un 2e appareil). Remis à neuf par la
  déconnexion (comme toute la progression locale) et par le **reset complet de test #75** (nouveau personnage, gemmes
  à 0 : niveaux à 0 aussi ; la restauration d'un essai les rend).
- Registre de gemmes (#49) : la montée des niveaux est déduite comme une dépense (comme l'Auto-Dig), jamais deux fois,
  sans fausse « perte client » ; colonne `gem_accounts.ref_pickaxe` ajoutée (registre en mode OFF en production).

### Admin — Jeu & progression → 🔋 Pioche à charges

- **Drapeau** : OFF (défaut, arrêt d'urgence en moins d'une minute, rien n'est effacé) / **Testeurs seulement**
  (pseudos) / Tous (double confirmation).
- **Réglages** journalisés (ancienne valeur conservée, journal en ajout seul) : capacité, recharge, seuil, prix d'une
  charge, arbres (multiplicateurs et prix), formules de recharge, recharges proposées ou non ; validation lisible côté
  serveur ; saisies protégées (#61). Aperçu des niveaux, prix et recharges à 100 m.
- **Anti-fraude (observation)** : à chaque sauvegarde, sur le temps du **serveur** : réserve au-dessus de la capacité,
  recharge trop rapide, coups pleins au-delà des charges disponibles, niveau hors barème. Écarts listés dans l'admin
  (au plus un par type et par minute), **sauvegarde jamais modifiée, aucune sanction automatique**. Joueurs observés
  listés.

### Fichiers

`server/pickaxeCharges.js` (nouveau), `server/index.js` (routes `GET /api/pickaxe/config`, `GET /api/admin/pickaxe`,
`PUT /api/admin/pickaxe/settings`, observation à la sauvegarde), `server/gemLedger.js` (dépenses des arbres),
`public/js/pickaxeCharges.js` (nouveau, moteur), `public/js/main.js`, `gameState.js`, `save.js`, `index.html`,
`css/style.css`, `i18n.js` (FR/EN/NL/ES) + `i18n/it.json` et `locales/it.js` (italien 100 %), admin
(`index.html`, `admin.js`), `tools/balance/economy-sim.js` (option `charges`, résultats existants inchangés),
`tools/balance/pickaxe-charges-sim.js` (nouveau), `test/pickaxe-charges.test.js` (nouveau), `test/antibot.test.js`.

## 3. Base de données (migration)

Uniquement des **ajouts** idempotents : tables `pickaxe_charge_settings`, `pickaxe_charge_audit` (ajout seul),
`pickaxe_charge_state`, `pickaxe_charge_anomalies`, colonne `gem_accounts.ref_pickaxe` (défaut `'{}'`). Aucune
donnée joueur réécrite. Testé sur une copie de la base de production (voir Déploiement).

## 4. SHA, branche, procédure de test

- Branche `feature/71-pioche-charges` (commit `9261c1a`), **`develop` = `497b52a`** (merge, arbre identique au
  commit testé).
- Automatique : `npm test` → **730/730** sur la branche ; release `497b52a` : **730/730**.
- `node --test test/pickaxe-charges.test.js` (11 tests : réglages, drapeau, moteur, recharges, arbres, sauvegarde,
  anti-fraude, registre de gemmes, boutique, simulation, HTTP de bout en bout).
- Navigateur (Chromium, serveur de test port 3101, base de test) : PC 1280×900 et mobile 390×844 — jauge, panne à
  1 dégât, « Dégâts 1 🪫 », bouton Recharger → section boutique, plus de skins, réserve reprise sur le 2e appareil,
  aucune erreur JavaScript ; admin : bandeau, réglages, refus lisible d'un barème invalide, joueur observé, 0 écart
  sur un jeu normal.

## 5. Vérifications, limites, impact joueurs

- Drapeau OFF : configuration publique `{ enabled: false }`, jeu strictement inchangé (hors section skins retirée).
- **Limites connues** : le moteur reste côté navigateur comme tout le jeu ; l'anti-fraude observe et signale, il ne
  corrige ni ne sanctionne (décision à prendre plus tard). Les prix des recharges et des arbres ne sont pas dans les
  « règles économiques » de #49 (réglages propres à la pioche, en attendant la décision #49). Le registre de gemmes
  déduit les dépenses aux prix en vigueur au moment du relevé (si tu changes un prix entre l'achat et la sauvegarde,
  le registre utilise le nouveau prix ; registre OFF en production).
- Impact joueurs : aucune donnée existante modifiée ; mode OFF par défaut.

## 6. Déploiement

- SHA déployé : **`497b52a`** (`main` avancé en avance rapide depuis `7b70f6e`), le 05/11/2026 à 02:47 (Bruxelles),
  par `scripts/deploy.sh` de la release ; `npm ci` non nécessaire (dépendances inchangées).
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261105-024739-pre-deploy-497b52a.sqlite`.
- Avant : tests complets 730/730 sur le SHA exact ; copie de la base de production démarrée en mode production
  (port 3122) : `/health` et `/api/version` OK, empreintes (lignes + hachage des colonnes) de `users`, `user_saves`,
  `season_rankings`, `seasons`, `leagues`, `player_click_tracking` **identiques** avant/après, seules des tables et une
  colonne ajoutées, `quick_check` ok ; copie supprimée. Aucune génération IA en cours au moment du redémarrage.
- Après : https://dig.lodygames.com et https://dig.lodylands.com → 200, `/api/version` = `1.0.0+497b52a`,
  `/api/pickaxe/config` = `{"enabled":false}` ; journal du service sans erreur ; `pragma quick_check` = ok ;
  empreintes joueurs identiques à la sauvegarde pré-déploiement ; Chromium PC et mobile (invité) : jeu chargé, jauge
  absente, plus de skins en boutique, aucune erreur JavaScript.
- Retour arrière immédiat possible : `git -C /home/ubuntu/Dig reset --keep 7b70f6e` puis `sudo systemctl restart dig`
  (aucun `npm ci` nécessaire). Plus simplement, le drapeau reste OFF : rien n'est actif pour les joueurs.

### Test fonctionnel à faire par le propriétaire

1. Admin → **Jeu & progression → 🔋 Pioche à charges** : Mode « Testeurs seulement », Testeurs = ton pseudo,
   « Appliquer l'activation ». (Pour voir la panne vite : Capacité de base = 30, Enregistrer ; remets 1 500 ensuite.)
2. Dans le jeu (attendre ≤ 1 min ou recharger la page) : sous le bloc, « ⛏ Réserve pleine : 1 500 coups ».
3. Mine : la réserve baisse d'1 par coup. À 0 : jauge grise, « 🪫 Pioche émoussée : 1 dégât par coup — bonus de
   retour dans … », « Dégâts 1 🪫 », message. Tu continues à miner. Au seuil : message « Pioche affûtée ».
4. **Boutique** : plus de « Skins de pioche » ; section « ⛏ Pioche et entretien » : améliore la capacité (5 💎,
   confirmation avec avant/après) ; recharge +10 % en pièces (coût et coups ajoutés affichés).
5. Ferme le jeu quelques minutes puis rouvre : la réserve a remonté (recharge hors ligne). Ouvre sur ton téléphone :
   même réserve, mêmes niveaux.
6. Arrêt d'urgence : Mode OFF → la jauge et la section disparaissent en moins d'une minute.

Résultat attendu : minage jamais bloqué, panne lisible, achats affichés avant paiement, niveaux conservés.

## 7. Choix techniques faits seul

- **Valeurs de départ 1 500 / 3 s / 10 %** au lieu de 100 / 10 s : les chiffres exploratoires rendent la pioche
  émoussée 95 % du temps (étude ci-dessus) ; le ticket demande des valeurs prudentes et ajustables.
- **Pendant la panne, les coups ne consomment rien** ; reprise des bonus au seuil (le ticket suggérait 10 %).
- « Bonus propres de la pioche » = niveau de pioche + relique Œil du mineur (dégâts par clic) ; Sac, reliques de
  pièces, boosts, Chance et Auto-Dig **non** concernés.
- Arbres = multiplicateurs de la base (les ratios de l'étude) pour garder la cohérence si la base change.
- Prix d'une recharge indexé sur la profondeur (+5 %/m, comme la récompense des blocs) : un prix fixe serait trop
  cher en surface et négligeable en profondeur.
- Drapeau à 3 positions avec **mode testeurs** : recette possible en production sans toucher les autres joueurs.
- Anti-fraude en **observation** (même principe que le registre de gemmes #49) ; contrôles sur le temps serveur pour
  ne pas dépendre de l'horloge du navigateur.
- Recharge en pièces sans confirmation (achat récurrent, coût affiché sur le bouton) ; achat en gemmes avec
  confirmation.

## 8. Décisions demandées au propriétaire

1. **Valeurs de la bêta** (après ta recette) : garder 1 500 coups / 3 s (recommandé pour commencer), ou plus
   doux (3 000 / 2 s : quasi invisible pour un joueur occasionnel), ou plus dur ? La règle « 1 charge par coup »
   freine fortement les longues sessions de clics quelle que soit la valeur (voir tableau).
2. **Activation pour tous** : quand et avec quels prix (gemmes des arbres, pièces par charge) ? Recommandation :
   après la recette et la décision #49 sur l'économie des gemmes.
3. **Anti-fraude** : les écarts doivent-ils un jour avoir une conséquence (coups comptés « suspects » pour le
   classement, comme #74) ? Recommandation : observer d'abord pendant la bêta.

## 9. Reste à réaliser

- Selon tes réponses : valeurs définitives, activation générale, éventuelle conséquence des écarts.
- Après lancement : intégrer les prix de la pioche aux règles économiques versionnées de #49 si tu le souhaites.
