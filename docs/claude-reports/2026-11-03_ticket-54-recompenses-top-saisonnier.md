# Ticket #54 — [Idée future] Récompenses du top saisonnier — pioches spéciales et bonus par matériau

Lien : https://github.com/ReC82/Dig/issues/54

## Session du 03/11/2026 (DIGORCH) — étude : définition du « +0,1 », équilibrage chiffré, 3 barèmes

### 1. État réel

**Étude livrée (ce rapport + un outil d'analyse), intégrée dans `develop`, non déployée : rien ne
change dans le jeu.** Le ticket demande de « proposer 2–3 barèmes de récompense […] sans activer
d'attributions ni de bonus en production avant décision propriétaire », et la précision du 02/11
répète « ne pas implémenter sans étude d'équilibrage (#49/#32) ». Je n'ai modifié aucune règle de
jeu, aucune table, aucune sauvegarde ni aucun réglage. Ajouts : l'outil de calcul
`tools/balance/pickaxe-bonus-sim.js` (lecture seule, hors serveur) et son test.

Classement : **Après lancement** (récompense de fidélisation ; le MVP public n'en a pas besoin, et
la base ne compte aujourd'hui qu'un compte, voir #53 : un « top 10 » n'a pas encore de sens).

### 2. Ce qui existe déjà (vérifié dans le code de `develop`)

| Élément | Où | Conséquence pour les pioches spéciales |
|---|---|---|
| « Pioche » = **niveau d'amélioration 1→15**, remis à 1 à chaque saison | `public/js/balance.js` (`PICKAXE`), `server/index.js` (remise à zéro) | Une pioche spéciale est un **objet distinct**, permanent, qui se combine avec le niveau ; à nommer autrement dans l'interface (« outil », « pioche de collection ») pour éviter la confusion. |
| Dégâts d'un coup = `niveau de pioche + Œil du mineur` (**entier**, 1 à 25) | `upgrades.js`, `relics.js`, `main.js` (`onBlockHit` → `Blocks.hit(GameState.damage)`) | Un bonus « ×1,1 » rend les dégâts **fractionnaires** : PV décimaux à gérer (affichage arrondi). |
| Nature et PV d'un bloc tirés **séparément** : nature avec la Chance, PV sans Chance | `blocks.js` (`spawn`, #32) | Une émeraude n'a **pas plus de PV** qu'un autre bloc de la même profondeur : un bonus de dégâts « émeraude » ne s'applique qu'aux ≈ 1 % de blocs émeraude. |
| Le bloc courant est sauvegardé (type, PV restants, n° de tirage), jamais retiré | `blocks.js` (`snapshot`/`resume`, #35) | Changer de pioche en plein bloc ne touche ni le bloc ni ses PV ni le tirage : il suffit d'appliquer le bonus **au coup** (`Blocks.hit(dégâts du coup)`). Aucun « reroll » possible. |
| Budget de dégâts côté serveur : `MAX_CLICK_DAMAGE = 25`, vérifié par test contre le client | `server/antibot.js`, `test/antibot.test.js` (#25 lot B) | Un bonus de dégâts impose de relever ce plafond (25 × 1,1 = 27,5) **en même temps** que le client, sinon un joueur honnête serait plafonné. |
| Classement figé et déterministe (profondeur, puis date d'atteinte), `eligible`, `risk_level`, `effective_manual_blocks` | `season_standings` (#29), `server/standings.js` | Source idéale pour désigner le top N : pas d'ex æquo réel (positions uniques), idempotence par instantané. |
| Skins de pioche « doré »/« diamant » (achats intégrés simulés, désactivés #11) | `monetization.js`, `GameState.monetization.pickaxeSkin` | Mécanisme d'apparence déjà branché sur le bloc (`skin-golden`…) : réutilisable pour des pioches **purement esthétiques**. |
| Simulateur d'économie | `tools/balance/economy-sim.js` (#49) | Profondeur médiane en fin de saison : débutant ≈ 310 m, régulier ≈ 1 000 m, assidu ≈ 2 050 m ; les joueurs réguliers finissent avec des **dizaines de millions de pièces non dépensées** (les pièces ne limitent plus la descente). |

### 3. Que vaut « +0,1 » ? (chiffré avec le vrai code)

L'outil `node tools/balance/pickaxe-bonus-sim.js` calcule exactement (catalogue de production v3,
22 blocs, Chance 5) l'effet d'une pioche équipée sur **tous les coups** de la saison, pour trois
définitions possibles. Extrait :

| Profondeur | Matériau | Part des blocs | Part des pièces | **Rendement ×1,1** : pièces gagnées | **Dégâts ×1,1** : coups économisés (dégâts 3 / 12 / 25) | **+0,1 dégât plat** : coups économisés |
|---|---|---|---|---|---|---|
| 100 m | pierre | 28,9 % | 2,0 % | +0,20 % | 2,6 / 2,6 / 2,9 % | 0,9 / 0,2 / 0,0 % |
| 100 m | émeraude | 1,4 % | 27,9 % | +2,8 % | 0,13 % | ≈ 0 |
| 1 000 m | pierre | 22,5 % | 0,5 % | +0,05 % | 2,0 % | 0,7 / 0,2 / 0,1 % |
| 1 000 m | émeraude | 1,1 % | 7,1 % | +0,7 % | 0,10 % | ≈ 0 |
| 1 000 m | diamant | 0,6 % | 8,1 % | +0,8 % | 0,05 % | ≈ 0 |
| 1 000 m | charbon | 8,3 % | 0,8 % | +0,08 % | 0,75 % | 0,3 / 0,1 / 0,0 % |

(tableau complet : lancer l'outil ; 30, 100, 300, 1 000 et 2 000 m.)

Lecture :

- **« +0,1 dégât plat »** : sans intérêt. Les dégâts vont de 1 à 25 ; +0,1 vaut +10 % au tout
  début et +0,4 % au niveau maximal. Le joueur ne verrait aucune différence (les coups restent
  entiers dans la plupart des cas). **À écarter.**
- **« Dégâts ×1,1 sur ce matériau »** : **ressenti sur le bloc** (à 1 000 m, une émeraude demande
  ≈ 201 coups au lieu de ≈ 183 avec la pioche : 18 clics de moins, visible), mais l'effet sur
  la saison dépend de la fréquence du matériau :
  - matériau **rare** (émeraude, diamant, gemmes, minerais rares ≤ 2 % des blocs) : ≤ 0,15 % de
    descente en plus → **aucun avantage de classement** mesurable (≈ 1 à 3 m sur 2 000 m) ;
  - matériau **courant** (pierre ≈ 22–32 % des blocs) : **≈ 2 à 4 %** de descente en plus,
    soit ≈ 40 m pour un assidu à 2 000 m → **avantage réel et cumulatif** pour les gagnants
    (« rich get richer »), à éviter.
- **« Rendement ×1,1 sur ce matériau »** (pièces du bloc) : sans effet sur la descente (PV
  inchangés, budget anti-bot inchangé). Gain de pièces de +0,05 % (pierre) à +2,8 % (émeraude à
  100 m), et les pièces ne limitent plus la progression des joueurs réguliers (#49). Effet
  **sûr mais peu ressenti**, sauf en début de saison.
- **Probabilité d'apparition (+0,1 de Chance sur un matériau)** : **exclue** par la précision du
  02/11 : la nature du bloc est tirée à son apparition, avant le coup ; un bonus de probabilité
  inciterait à changer de pioche *avant* le tirage et ne « suivrait pas la pioche au moment du
  coup ». Il rendrait aussi le tirage dépendant de l'équipement (risque de contournement #35).

**Recommandation : « +0,1 » = dégâts × 1,1 sur le matériau, réservé aux matériaux rares** (part
des blocs ≤ 2 % à toutes les profondeurs ; liste à confirmer avec l’outil — étendre `MATERIALS` —, pas de pierre, terre,
argile, grès ni charbon). C'est ce qui correspond le mieux au scénario du propriétaire (« je vois
une émeraude, je sors ma pioche émeraude ») : gain visible sur le bloc, nul sur le classement.

### 4. Règles de fonctionnement proposées (communes aux barèmes)

**Changement de pioche en plein minage (précision du 02/11)**

- Barre rapide sous le bloc (mobile et PC) : pioche standard + 3 favorites au plus, icône, nom
  court et bonus lisible (« 💚 +10 % dégâts émeraude »), accessible au clavier (#21). Un appui =
  équiper ; la standard = « déséquiper ». Liste complète dans la collection.
- Le coup utilise la pioche **équipée au moment du coup** : `dégâts = (niveau + Œil) × bonus(pioche,
  matériau du bloc)`. Le bloc, ses PV restants et son n° de tirage ne changent pas ; aucun coup
  n'est rejoué ni doublé (un clic = un appel `Blocks.hit`). L'Auto-Dig utilise la même règle.
- PV décimaux : le moteur garde la valeur exacte, l'affichage arrondit au supérieur (« 12 / 40
  PV ») ; le bloc est détruit à PV ≤ 0. Le budget anti-bot passe à `MAX_CLICK_DAMAGE = 27,5`
  (et `MAX_AUTODIG_DPS` × 1,1), relevés **dans le même lot** que le client, test à l'appui.
- **Propriété côté serveur, choix côté joueur** : la liste des pioches possédées vient d'une table
  serveur (attribution) ; la pioche équipée est un champ de la sauvegarde, **vérifié à chaque
  sauvegarde** (pioche non possédée → ignorée, standard). Changement d'appareil : la sauvegarde
  cloud (#18, #35) porte l'équipement → même état partout. Aucune duplication possible : une
  pioche est un droit (ligne d'attribution), pas un objet échangeable ni empilable.
- Pas de changement automatique quotidien, pas de bonus cumulé : **une seule pioche active**.
- Anti-bot : changer de pioche n'est pas un coup (ne compte ni comme clic ni comme bloc) ; un
  changement très fréquent est simplement journalisé (#25), sans sanction.

**Attribution au top saisonnier**

- Source : classement **figé** de la saison close (#29), jamais le classement vivant.
- Éligibles : `eligible = 1`, `risk_level < 3`, `effective_manual_blocks ≥ 20` (même seuil que
  #53 : pas de récompense à un inactif ou à un compte suspect) ; rang `rank` global (ou par
  ligue si #19 l'exige plus tard).
- **Top N proportionnel** : `N = min(N_max, max(N_min, arrondi(p × éligibles)))`, réglable dans
  l'admin (proposé : p = 10 %, N_min = 3, N_max = 20). Avec 15 participants : 3 ; 100 : 10 ;
  1 000 : 20.
- Ex æquo : impossibles (profondeur puis date d'atteinte → positions uniques, #29).
- Idempotence : table d'attribution `(season_id, user_id, item_id)` unique, alimentée à la
  clôture dans la même transaction que les points #33 ; une clôture rejouée ne crée aucun
  doublon. **Réversible** : retrait par l'admin = `revoked_at` + motif (aucune suppression),
  journal d'audit (#25).
- Migrations : uniquement des tables ajoutées (`pickaxe_items` catalogue, `pickaxe_grants`
  attributions) ; rien n'est réécrit dans les sauvegardes ni le classement.
- Interrupteur admin `top_pickaxes_mode = off | preview | on` (défaut **off**) ; en `preview`,
  l'admin voit qui aurait été récompensé, sans rien attribuer.
- Un **NFT** n'est pas prévu : les pioches fonctionnent sans blockchain ; toute évolution relève de
  #55 (étude séparée).

### 5. Trois barèmes proposés (aucun activé)

| | **A — Vitrine** (esthétique) | **B — Spécialiste** (recommandé) | **C — Rendement** |
|---|---|---|---|
| Top 1 | Pioche de saison « Or » unique (apparence + nom de saison) | Pioche de saison + **choix** d'une pioche « matériau rare » ×1,1 dégâts | Pioche +10 % pièces sur un matériau au choix |
| Top 2–3 | Pioche de saison « Argent » | Pioche « matériau rare » ×1,1 tirée dans la liste | idem |
| Top 4–N | Pioche de saison « Bronze » | Pioche de saison (esthétique) | Pioche de saison (esthétique) |
| Effet sur le classement | Aucun | ≤ 0,15 % de descente (≈ 3 m à 2 000 m) | Aucun direct ; +0,05 à +2,8 % de pièces |
| Risque « rich get richer » | Nul | Négligeable (une seule pioche active, matériaux rares seulement, ×1,1 jamais cumulé) | Nul |
| Ressenti joueur | Prestige, collection | Prestige + gain visible sur le bloc | Faible (chiffre de pièces) |
| Travail technique | Faible (skins existants) | Moyen (dégâts décimaux, barre rapide, budget anti-bot) | Faible à moyen |

Exemples de pioches (B) : « Pic de jade » (+10 % dégâts émeraude), « Taille-diamant » (diamant),
« Fend-cristal » (cristal ancien), « Pic d'argent » (minerai d'argent). Une pioche « pierre »
**n'est pas** proposée en bonus (≈ 2–4 % de descente) : seulement en apparence.

Garde-fous communs : une pioche de bonus déjà possédée n'est pas redonnée (le joueur reçoit une
variante esthétique ou un autre matériau) ; le bonus maximal reste ×1,1 (jamais ×1,2 par
accumulation de saisons) ; tous les paramètres (p, N_min, N_max, liste des matériaux éligibles,
multiplicateur) sont réglables dans l'admin et désactivables.

### 6. Procédure de vérification de l'étude

```
cd <worktree ou release>
node tools/balance/pickaxe-bonus-sim.js          # tableaux Markdown
node tools/balance/pickaxe-bonus-sim.js --json   # chiffres bruts
node --test test/pickaxe-bonus-sim.test.js       # garde-fous : émeraude < 2 % des blocs et < 0,5 % de descente ; pierre > 1,5 %
```

Vérifications faites : `npm test` complet sur la branche et sur `develop` après fusion ; lecture
du code de `develop` (blocs, dégâts, budget anti-bot, classement figé, skins). Non fait : aucune
simulation de saison complète avec la pioche (inutile à ce stade : l'effet maximal mesuré, 0,15 %
pour un matériau rare, est sous l'écart-type des simulations #49) ; aucune maquette d'interface.

Impact sur les données des joueurs : **aucun** (aucun code du jeu ni du serveur modifié).

### 7. Déploiement

**Non déployé, volontairement** : seuls un document, un outil hors serveur et son test sont
ajoutés ; rien ne change pour les joueurs. Ils partiront avec le prochain déploiement ordinaire.
**Test fonctionnel en jeu : aucun pour l'instant** (lecture du rapport et décisions ci-dessous).

### 8. Choix faits seul

- Étude plutôt que code : exigé par le ticket et la précision du 02/11.
- Calcul exact (espérance sur la loi des PV) plutôt que simulation aléatoire : chiffres
  reproductibles, testables, et suffisants pour comparer les définitions.
- Seuils d'éligibilité repris de #53 (`effective_manual_blocks ≥ 20`, `risk_level < 3`) pour la
  cohérence entre statut OG, points #33 et pioches.
- « Matériau rare » défini par sa part des blocs (≤ 2 % à toutes profondeurs) plutôt que par son
  étiquette de rareté : le catalogue est éditable dans l'admin (#37), la règle reste vraie.

### 9. Décisions demandées au propriétaire

1. **Définition du « +0,1 »** : (a) dégâts × 1,1 sur le matériau, (b) pièces × 1,1, (c) apparence
   seule. **Recommandation : (a)**, limité aux matériaux rares.
2. **Barème** : A (vitrine), B (spécialiste), C (rendement). **Recommandation : B**, avec A comme
   première étape si vous voulez livrer vite et sans risque d'équilibrage.
3. **Taille du top** : proportionnel (10 %, min 3, max 20) ou fixe (10 ou 20) ? **Recommandation :
   proportionnel**, réglable dans l'admin.
4. **Barre rapide** : combien de favorites sous le bloc (2, 3 ou 4) ? **Recommandation : 3** +
   la standard (tient sur un écran de 390 px).
5. **Quand** : ce chantier vient **après** le lancement public et après #33 (points) et #19
   (ligues) ; confirmez-vous ce séquencement ?

### 10. Reste à réaliser (après décision)

- Lot 1 (selon barème) : tables `pickaxe_items`/`pickaxe_grants`, attribution à la clôture
  (interrupteur `off/preview/on`), écran « Mes pioches », barre rapide sous le bloc, admin
  (catalogue, aperçu des gagnants, retrait réversible), traductions FR/EN/NL/ES.
- Lot 2 (barème B) : dégâts décimaux, relèvement coordonné du budget anti-bot, tests de
  cohérence client/serveur et de changement en plein bloc (pas de double coup, pas de tirage).
- Icônes des pioches : dans le cadre #22/#40 (direction artistique validée).
