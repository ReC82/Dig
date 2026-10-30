# Ticket #32 — [P1] Équilibrage Chance — éviter de pénaliser la progression en profondeur

- Ticket : https://github.com/ReC82/Dig/issues/32
- Branche : `feature/32-equilibrage-chance` — audit `1d1dc0a` (develop `f42ae68`), rééquilibrage `959d70e` (develop **`0d8cb41`**)
- Liés : #20 (aperçu avant/après des améliorations), #19 (ligues), #25 (progression serveur), #35 (bloc courant), #37 (catalogue)

## 2e session du 30/10/2026 — rééquilibrage option A (DIGORCH)

### 1. État réel

**Déployé en production (SHA `0d8cb41`) — en attente de recette.** Le propriétaire a validé l'option A
(commentaire du 30/10 14:03 UTC) : PV tirés sans Chance, nature et récompense avec Chance, +10 % par
niveau, apparence normale (pas de ✨), libellé remplacé par la probabilité réelle.

Classement MVP : **Bloquant MVP public — traité** (une amélioration qui faisait reculer au classement
ceux qui l'achetaient).

### 2. Ce qui change en jeu

- **Un bloc = deux tirages** (`public/js/blocks.js`, `spawn`) :
  - la **nature** du bloc (apparence, nom, rareté, récompense, coffre, gemme) est tirée **avec** la
    Chance, comme avant ;
  - sa **résistance** (PV) est tirée **sans Chance** (ni niveau ni relique) sur le même pool de la
    même profondeur. Un diamant peut donc avoir les PV d'un bloc de pierre ; son apparence reste
    normale. Les PV moyens sont **identiques à toute Chance** : la Chance ne ralentit plus la descente.
- **Bonus de poids : +10 % par niveau** au lieu de +20 % (`Blocks.LUCK_PER_LEVEL = 0.10`).
- **Carte Chance** : « +140 % chance de blocs rares » (c'était un poids) est remplacé par
  « **Plus de rares, sans ralentir** » ; la ligne dorée déjà livrée donne la **probabilité réelle** à
  la profondeur actuelle, au niveau actuel → suivant (ex. Nv.7 à 150 m : « À 150m : 19,4% de blocs
  rares → 20,3% »). FR / EN (« More rares, no slowdown ») / NL (« Meer zeldzame, niet trager ») ;
  l'espagnol n'existe pas encore dans le jeu (#42) : à ajouter avec lui.
- **Aucune donnée touchée** : les niveaux de Chance achetés restent ; le classement de la saison en
  cours n'est pas recalculé ; aucun changement serveur ni de schéma.

À noter pour le joueur de la recette (Chance 7) : la part de blocs rares affichée passe de ~25 % à
~19 % (bonus réduit de moitié), mais il descend **~16 % plus vite** qu'avant et gagne autant de
pièces par heure.

### 3. Métriques avant → après (simulation, vrai code du jeu, 200 tirages d'une heure)

Outil : `node tools/balance/luck-sim.js` (~15 s) — compare désormais « avant #32 » (un tirage, +20 %)
et les règles actuelles. Écarts = moyennes par rapport à Chance 0 **avec les mêmes règles**.

| Profil (1 h) | Chance | Mètres/h : avant → **après** | Pièces/h : avant → **après** |
|---|---|---|---|
| Début (pioche 3, 5 clics/s, 30 m) | 7 | −11 % → **−1 %** | +43 % → **+41 %** |
| | 12 | −15 % → **−0 %** | +58 % → **+85 %** |
| Milieu (pioche 9, Auto-Dig 4, Sac 8, 100 m) | 1 | −3 % → **+0 %** | +12 % → **+9 %** |
| | 4 | −9 % → **−0 %** | +40 % → **+33 %** |
| | 7 | −14 % → **−0 %** | +61 % → **+53 %** |
| | 12 | −20 % → **−0 %** | +84 % → **+93 %** |
| Fin (pioche 15, Auto-Dig 6, Sac 12, 200 m) | 7 | −16 % → **−0 %** | +60 % → **+55 %** |
| | 12 | −22 % → **−1 %** | +86 % → **+93 %** |
| Inactif (Auto-Dig 6 seul, 200 m) | 7 | −21 % → **−0 %** | +41 % → **+39 %** |
| | 12 | −29 % → **−1 %** | +56 % → **+64 %** |
| Milieu + Lentille fêlée Nv.5 | 7 | −21 % → **−0 %** | +89 % → **+153 %** |

Valeurs absolues après (médiane, p10 · p90) : milieu ~**235 m/h** (220 · 248) à toute Chance ;
fin ~**286 m/h** (270 · 300). À 100 m, PV moyens d'un bloc : Chance 7 avant 478 → **391** (= Chance 0).

**Saison complète** depuis zéro (6 clics/s, réinvestissement automatique, 30 tirages, profondeur
médiane, écart avec « ne jamais acheter de Chance » des mêmes règles) :

| Chance visée | 3 h | 10 h | 20 h |
|---|---|---|---|
| 4 | −3 % → **+6 %** | −4 % → **+3 %** | −4 % → **+3 %** |
| 7 | −6 % → **+7 %** | −7 % → **+5 %** | −6 % → **+5 %** |
| 12 | −10 % → **+5 %** | −10 % → **+6 %** | −9 % → **+7 %** |

**Conclusion : acheter la Chance est maintenant rationnel pour le classement** (gain modéré, +3 à
+7 % de profondeur sur une saison grâce aux pièces/gemmes réinvesties), sans jamais ralentir la
descente à équipement égal.

### 4. SHA et procédure de test

- Branche `feature/32-equilibrage-chance` : `959d70e` · `develop` : **`0d8cb41`** · production : **`0d8cb41`**.
- `npm test` : **239/239** sur la branche, sur `develop` fusionné et sur la release exacte `0d8cb41` ;
  `npm run check` ok. `test/luck.test.js` (6 tests) : somme des probabilités, part rare à +10 %,
  fréquences tirées, **PV moyens identiques à Chance 0, 12 et 12 + relique (40 000 tirages)**,
  récompense = celle du bloc affiché, PV minimal inchangé (compatibilité `server/antibot.js`),
  libellé sans pourcentage et aperçu FR/EN/NL, simulation avant (ralentit) / après (neutre).
- Navigateur (serveur de test port 3101, base de test) : Chromium 1280×900 FR, 390×844 FR/EN/NL,
  aucune erreur JS ; libellé entier sur téléphone (une première version plus longue était tronquée,
  raccourcie).

### 5. Vérifications, limites, compatibilité

- **Anti-bot #25** (`server/antibot.js`) : il borne la vitesse avec le plus petit `hpBase` tirable par
  profondeur ; le pool des PV est le même, ce minimum est inchangé (testé).
- **Bloc courant #35** : `Blocks.current` garde la forme `{ type, hp, maxHp, reward }` ; une
  persistance future enregistrera `maxHp` avec le bloc (il ne se déduit plus de `type.hpBase`).
- **Catalogue #37** : aucun champ ajouté aux blocs ; le tirage lit toujours `TYPES` (poids, rareté,
  profondeurs), un catalogue éditable s'y branche sans changement.
- Gains hors ligne : inchangés (ils n'utilisaient pas la Chance).
- Limites : simulation à CPS constant ; coffres de la boutique de saison hors modèle.

### 6. Déploiement

- SHA déployé **`0d8cb41`** (avant : `2397123`), `scripts/deploy.sh` de la release, sans `npm ci`.
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261030-153507-pre-deploy-0d8cb41.sqlite`.
- Copie de la base de production démarrée en mode production (port 3122) : `/health` ok, version
  `1.0.0+0d8cb41`, empreintes des 6 tables joueurs **identiques** ; copie supprimée.
- Après déploiement : 2 domaines → 200 en `1.0.0+0d8cb41`, `blocks.js` servi avec +10 %/niveau,
  journal sans erreur, `quick_check` ok, empreintes joueurs **identiques** à la sauvegarde
  pré-déploiement ; carte Chance vérifiée en production (FR 1280×900, EN 390×844), aucune erreur JS.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 2397123` puis `sudo systemctl restart dig`
  (lock npm inchangé, aucune donnée à restaurer).

**Test fonctionnel à faire en jeu (3 min, sans achat) :**
1. Onglet **Améliorations**, carte **Chance** (Nv.7) : sous le nom, « **Plus de rares, sans ralentir** »
   (plus de « +140 % ») ; la ligne dorée indique « À ___m : ~19% de blocs rares → ~20% ».
2. Revenir à la mine et casser une vingtaine de blocs : les blocs rares (or, rubis, coffres…) gardent
   leur apparence et leur récompense, mais leurs PV varient comme ceux des blocs ordinaires (un rubis
   peut tomber en quelques coups) ; la descente doit paraître plus rapide qu'avant.
3. Passer en EN puis NL : libellé et ligne traduits ; sur téléphone, rien n'est coupé.

### 7. Choix techniques faits seul

- **Relique Lentille fêlée inchangée** (pas divisée par deux) : la décision écrite ne vise que le bonus
  par niveau ; diminuer une relique déjà achetée avec des fragments aurait été une perte pour le
  joueur. Elle ne ralentit plus la descente non plus (PV tirés sans relique). Son libellé
  « +n % blocs rares » reste un poids : voir question 1.
- Description sans chiffre (« Plus de rares, sans ralentir ») + aperçu chiffré : un seul pourcentage
  affiché, celui qui est vrai ; texte assez court pour une ligne sur téléphone.
- Tirage des PV : second tirage sur le pool **sans aucune Chance** (multiplicateur 1), plutôt qu'une
  table de PV séparée : même distribution que Chance 0 par construction, rien à maintenir.
- `luck-sim.js` : variantes A'/B retirées, remplacées par « avant » (règles d'avant #32) pour mesurer
  l'effet réel du changement.

### 8. Décisions demandées au propriétaire

Aucune décision bloquante. Une question facultative :
1. La relique **Lentille fêlée** affiche « +130 % blocs rares » (un poids, comme l'ancien libellé de
   la Chance). La laisser telle quelle (recommandé pour le MVP — elle ne ralentit plus) ou afficher
   aussi la part réelle ? **Après lancement.**

### 9. Reste à faire

- Recette du propriétaire, puis clôture.
- ES : traduire « Plus de rares, sans ralentir » et la ligne d'aperçu avec #42.
- Hors périmètre (déjà signalés plus bas) : popup de coffre qui arrête l'Auto-Dig d'un joueur absent ;
  coffres de la mine indépendants de la profondeur.

## 1re session du 30/10/2026 — audit (DIGORCH)

Les sections suivantes décrivent l'audit et les règles **d'avant** le rééquilibrage ; les tableaux
ont été produits par la version de `luck-sim.js` du commit `1d1dc0a`.

### 1. État réel

- **Audit et simulation : faits** (outil reproductible committé, chiffres ci-dessous).
- **Aperçu du niveau suivant sur la carte Chance : déployé en production (SHA `f42ae68`) — en attente de recette.**
- **Équilibrage : rien n'est modifié.** Le tirage des blocs, les PV, les récompenses et le classement
  sont identiques. Une **décision du propriétaire** est nécessaire (question 1).

Classement MVP : **décision d'équilibrage = Bloquant MVP public (conseillé)** — dans un classement
avec lots, une amélioration qui fait reculer au classement ceux qui l'achètent nuit à la confiance ;
le correctif recommandé tient en ~1 h. **Aperçu sur la carte = Après lancement** (confort).

### 2. Réponse courte

**Oui, la Chance pénalise la profondeur, à tous les niveaux et à toutes les profondeurs, et les
pièces gagnées ne compensent pas, même sur une saison complète.**

- À puissance, CPS et temps identiques, **Chance 7 fait descendre 11 à 16 % moins vite** que Chance 0
  (15 à 22 % au niveau 12 ; jusqu'à 29 % pour un joueur qui laisse tourner l'Auto-Dig).
- En échange, elle rapporte **+40 à +60 % de pièces**, +60 à +80 % de fragments et ~+70 % de gemmes par heure.
- Sur une **saison complète** (le joueur réinvestit tout : pioche, Sac, Auto-Dig, boutique de
  fragments, reliques Œil du mineur et Griffe d'obsidienne), viser Chance 7 donne **6 à 7 % de
  profondeur en moins** après 3 h, 6 h, 10 h ou 20 h de jeu ; Chance 12 donne 9 à 10 % de moins.
  Avec la Chance, la pioche est au maximum ~1 h plus tôt (3 h au lieu de 4 h) et les reliques
  arrivent plus vite, mais cela ne rattrape jamais la lenteur des blocs rares.
- **Pour un joueur qui vise la ligue supérieure, acheter la Chance n'est jamais rationnel
  aujourd'hui** (seul intérêt : fragments et gemmes, utiles aux reliques… des saisons suivantes).

### 3. Formules réelles vérifiées (code de `develop`)

| Élément | Formule (fichier) |
|---|---|
| Profondeur | +1 m par bloc détruit, clic ou Auto-Dig ; classement = profondeur maximale (`gameState.js nextDepth`, plafonnée côté serveur par #9) |
| Tirage d'un bloc | pondéré parmi les blocs autorisés à cette profondeur ; poids des blocs **rares, épiques, légendaires** × (1 + 0,2 × Chance + relique Lentille fêlée) (`blocks.js _pickType`) |
| Blocs concernés par la Chance | Minerai d'or (PV 90), Coffre en bois (18), Coffre en fer (40), Rubis (110), Émeraude (200), Diamant (350) — contre 3 à 55 PV pour les blocs communs |
| PV | arrondi sup.( PV de base × (1 + 0,12 × (profondeur − 1)) × (1 − Griffe d'obsidienne) ) |
| Pièces | arrondi sup.( base × (1 + 0,05 × (profondeur − 1)) ) × Sac (1 + 0,3 × niveau) × relique × réglage admin × bonus temporaire |
| Gemmes | +1 par Rubis, Émeraude, Diamant (les gemmes paient l'Auto-Dig 3 à 6) |
| Coffres de la mine | table fixe (80–1 200 pièces, 1–3 fragments ou boost ×2/×3), **ni profondeur ni Sac** ; popup bloquante jusqu'à « Récupérer » |
| Auto-Dig | 1 coup par seconde de (niveau + relique) dégâts ; ignoré pendant l'animation (0,35 s) et la popup de coffre |
| Hors ligne | dégâts Auto-Dig × multiplicateur de pièces × 30 / min : **la Chance n'y joue aucun rôle** |

Pourquoi ça ralentit : à 100 m, un bloc rare+ a en moyenne **78 PV de base** contre **24** pour les
autres. Chance 7 fait passer leur part de 11,9 % à 24,5 % : les PV moyens d'un bloc montent de
**+22 %** (391 → 478), donc il faut ~22 % de temps en plus par mètre (un peu moins grâce au délai
fixe de 0,35 s entre deux blocs). Le libellé « +140 % de chance de blocs rares » décrit le
**poids** du tirage, pas la probabilité : à 100 m la part réelle passe de 11,9 % à 24,5 % (×2,06).

À ~260 m, de Chance 7 à 8 : blocs rares 25,3 % → 26,9 %, PV moyens +2,5 %, pièces moyennes par
bloc +5,3 % — le prochain niveau (28 000 💰) fait donc perdre ~2 % de vitesse de descente.

### 4. Simulation

Outil : `tools/balance/luck-sim.js` (`node tools/balance/luck-sim.js`, ~10 s ; `--quick` ~1 s).
Il charge **le vrai code du jeu** (`blocks.js`, `chests.js`, `balance.js`, `relics.js`) avec un
hasard à graine fixe : résultats reproductibles. Modèle de temps : clics réguliers au CPS donné,
Auto-Dig toutes les secondes, 0,35 s d'animation après chaque bloc, popup de coffre fermée en 1,5 s
(30 s pour le profil « inactif »). Distributions sur 200 tirages d'une heure (p10 · **médiane** ·
p90) ; « Écart » = écart des moyennes. Les pièces ont une forte dispersion (boosts ×2/×3 des
coffres) : un écart de ±6 % sur les pièces moyennes est du bruit.

Le **bonus temporaire** (×2 pendant toute l'heure) ne change pas la vitesse de descente (il ne
touche que les pièces) ; il **réduit** l'avantage relatif de la Chance en pièces (+48 % au lieu de
+61 % à Chance 7, profil milieu), car les coffres de la mine ne sont pas multipliés.

#### A. Espérances exactes par bloc (Chance seule, sans relique)

| Profondeur | Chance | Blocs « rares » | PV moyens | Pièces moyennes / bloc (base) | Pièces / PV | Coffres | Gemmes |
|---|---|---|---|---|---|---|---|
| 20 m | 0 | 3,1 % | 57,9 | 19,9 | 0,34 | 5,7 % | 0,0 % |
| 20 m | 1 | 3,7 % | 57,9 | 19,8 | 0,34 | 6,3 % | 0,0 % |
| 20 m | 4 | 5,5 % | 57,9 | 19,4 | 0,33 | 8,0 % | 0,0 % |
| 20 m | 7 | 7,1 % | 58,0 | 19,0 | 0,33 | 9,6 % | 0,0 % |
| 20 m | 12 | 9,8 % | 58,0 | 18,5 | 0,32 | 12,2 % | 0,0 % |
| 50 m | 0 | 11,0 % | 196,9 | 105,0 | 0,53 | 7,3 % | 2,1 % |
| 50 m | 1 | 12,9 % | 202,5 | 115,0 | 0,57 | 8,1 % | 2,5 % |
| 50 m | 4 | 18,2 % | 217,8 | 142,7 | 0,66 | 10,2 % | 3,5 % |
| 50 m | 7 | 22,9 % | 231,4 | 167,3 | 0,72 | 12,1 % | 4,4 % |
| 50 m | 12 | 29,6 % | 250,8 | 202,5 | 0,81 | 14,7 % | 5,6 % |
| 100 m | 0 | 11,9 % | 391,1 | 264,9 | 0,68 | 7,3 % | 3,1 % |
| 100 m | 1 | 14,0 % | 405,3 | 296,6 | 0,73 | 8,0 % | 3,6 % |
| 100 m | 4 | 19,6 % | 444,2 | 383,3 | 0,86 | 10,0 % | 5,1 % |
| 100 m | 7 | 24,5 % | 478,4 | 459,4 | 0,96 | 11,8 % | 6,4 % |
| 100 m | 12 | 31,5 % | 526,9 | 567,4 | 1,08 | 14,3 % | 8,2 % |
| 150 m | 0 | 12,4 % | 604,1 | 513,7 | 0,85 | 7,2 % | 3,6 % |
| 150 m | 1 | 14,5 % | 630,2 | 581,9 | 0,92 | 7,9 % | 4,2 % |
| 150 m | 4 | 20,3 % | 701,2 | 768,0 | 1,10 | 9,9 % | 5,9 % |
| 150 m | 7 | 25,3 % | 763,3 | 930,6 | 1,22 | 11,7 % | 7,4 % |
| 150 m | 12 | 32,4 % | 851,0 | 1 160,3 | 1,36 | 14,1 % | 9,5 % |
| 250 m | 0 | 12,4 % | 987,8 | 817,4 | 0,83 | 7,2 % | 3,6 % |
| 250 m | 1 | 14,5 % | 1 030,4 | 925,9 | 0,90 | 7,9 % | 4,2 % |
| 250 m | 4 | 20,3 % | 1 146,6 | 1 222,2 | 1,07 | 9,9 % | 5,9 % |
| 250 m | 7 | 25,3 % | 1 248,2 | 1 481,0 | 1,19 | 11,7 % | 7,4 % |
| 250 m | 12 | 32,4 % | 1 391,6 | 1 846,6 | 1,33 | 14,1 % | 9,5 % |


#### B. Début de saison — pioche 3, 5 clics/s, sans Auto-Dig, 30 m — 1 h (200 tirages)

| Chance | Mètres/h (p10 · médiane · p90) | Écart vs Chance 0 | Pièces/h (p10 · médiane · p90) | Écart | Fragments/h | Gemmes/h | Coffres/h |
|---|---|---|---|---|---|---|---|
| 0 | 126 · **135** · 144 | +0 % | 43 720 · **65 937** · 96 559 | +0 % | 5,1 | 4,1 | 10,0 |
| 1 | 122 · **133** · 142 | -2 % | 47 083 · **71 863** · 109 742 | +8 % | 5,7 | 4,6 | 10,9 |
| 4 | 115 · **126** · 135 | -7 % | 60 668 · **87 721** · 119 677 | +31 % | 7,6 | 6,0 | 13,2 |
| 7 | 110 · **121** · 129 | -11 % | 70 561 · **97 225** · 126 473 | +43 % | 9,2 | 7,0 | 15,2 |
| 12 | 107 · **115** · 123 | -15 % | 77 818 · **105 397** · 140 958 | +58 % | 11,3 | 8,2 | 17,3 |


#### B. Milieu — pioche 9, 6 clics/s, Auto-Dig 4, Sac 8, 100 m (profil proche de la recette) — 1 h (200 tirages)

| Chance | Mètres/h (p10 · médiane · p90) | Écart vs Chance 0 | Pièces/h (p10 · médiane · p90) | Écart | Fragments/h | Gemmes/h | Coffres/h |
|---|---|---|---|---|---|---|---|
| 0 | 220 · **233** · 249 | +0 % | 440 691 · **637 951** · 827 175 | +0 % | 8,7 | 8,6 | 17,1 |
| 1 | 213 · **227** · 241 | -3 % | 504 397 · **716 707** · 960 054 | +12 % | 9,8 | 9,7 | 18,2 |
| 4 | 199 · **212** · 227 | -9 % | 653 749 · **876 314** · 1 155 250 | +40 % | 12,6 | 12,5 | 21,9 |
| 7 | 188 · **200** · 214 | -14 % | 771 306 · **1 013 305** · 1 314 194 | +61 % | 14,3 | 14,9 | 23,7 |
| 12 | 175 · **186** · 200 | -20 % | 867 165 · **1 170 444** · 1 514 387 | +84 % | 17,2 | 17,4 | 26,9 |


#### B. Fin de saison — pioche 15, 7 clics/s, Auto-Dig 6, Sac 12, 200 m — 1 h (200 tirages)

| Chance | Mètres/h (p10 · médiane · p90) | Écart vs Chance 0 | Pièces/h (p10 · médiane · p90) | Écart | Fragments/h | Gemmes/h | Coffres/h |
|---|---|---|---|---|---|---|---|
| 0 | 270 · **288** · 304 | +0 % | 1 199 778 · **1 645 665** · 2 313 666 | +0 % | 10,6 | 10,5 | 20,9 |
| 1 | 261 · **278** · 294 | -3 % | 1 325 549 · **1 856 576** · 2 492 448 | +11 % | 12,1 | 11,9 | 22,3 |
| 4 | 242 · **257** · 274 | -10 % | 1 720 072 · **2 329 508** · 2 997 716 | +39 % | 14,9 | 15,3 | 26,2 |
| 7 | 226 · **243** · 257 | -16 % | 2 055 375 · **2 622 263** · 3 503 687 | +60 % | 17,2 | 18,1 | 28,5 |
| 12 | 209 · **223** · 241 | -22 % | 2 388 397 · **3 109 270** · 4 077 872 | +86 % | 20,5 | 21,1 | 31,8 |


#### B. Inactif — Auto-Dig 6 seul, pioche 15, 200 m, popups de coffre fermées en 30 s — 1 h (200 tirages)

| Chance | Mètres/h (p10 · médiane · p90) | Écart vs Chance 0 | Pièces/h (p10 · médiane · p90) | Écart | Fragments/h | Gemmes/h | Coffres/h |
|---|---|---|---|---|---|---|---|
| 0 | 19 · **26** · 31 | +0 % | 24 006 · **56 566** · 154 236 | +0 % | 1,0 | 0,8 | 2,1 |
| 1 | 16 · **25** · 30 | -4 % | 24 809 · **59 179** · 180 527 | +11 % | 1,2 | 0,9 | 2,2 |
| 4 | 15 · **22** · 28 | -14 % | 26 256 · **84 786** · 184 969 | +30 % | 1,4 | 1,2 | 2,3 |
| 7 | 13 · **21** · 26 | -21 % | 29 480 · **89 635** · 184 435 | +41 % | 1,5 | 1,3 | 2,5 |
| 12 | 11 · **18** · 24 | -29 % | 53 991 · **93 705** · 195 686 | +56 % | 1,6 | 1,6 | 2,6 |


#### B. Milieu — pioche 9, 6 clics/s, Auto-Dig 4, Sac 8, 100 m (profil proche de la recette) — 1 h, bonus temporaire ×2 pendant toute l’heure (200 tirages)

| Chance | Mètres/h (p10 · médiane · p90) | Écart vs Chance 0 | Pièces/h (p10 · médiane · p90) | Écart | Fragments/h | Gemmes/h | Coffres/h |
|---|---|---|---|---|---|---|---|
| 0 | 220 · **233** · 249 | +0 % | 802 884 · **1 147 735** · 1 503 694 | +0 % | 8,7 | 8,6 | 17,1 |
| 1 | 213 · **227** · 241 | -3 % | 908 823 · **1 263 806** · 1 608 648 | +10 % | 9,8 | 9,7 | 18,2 |
| 4 | 199 · **212** · 227 | -9 % | 1 153 289 · **1 519 277** · 1 856 166 | +32 % | 12,6 | 12,5 | 21,9 |
| 7 | 188 · **200** · 214 | -14 % | 1 346 983 · **1 691 917** · 2 092 048 | +48 % | 14,3 | 14,9 | 23,7 |
| 12 | 175 · **186** · 200 | -20 % | 1 499 456 · **1 897 453** · 2 320 210 | +66 % | 17,2 | 17,4 | 26,9 |


#### C. Avec la relique Lentille fêlée niveau 5 (+130 % Chance) — profil « milieu », 1 h

| Chance | Mètres/h médiane | Écart vs Chance 0 sans relique | Pièces/h médiane | Écart |
|---|---|---|---|---|
| 0 + relique | 203 | -13 % | 994 918 | +58 % |
| 1 + relique | 199 | -15 % | 1 029 884 | +63 % |
| 4 + relique | 190 | -18 % | 1 106 331 | +75 % |
| 7 + relique | 183 | -21 % | 1 188 044 | +89 % |
| 12 + relique | 174 | -25 % | 1 321 518 | +108 % |


#### D. Saison complète depuis zéro, 6 clics/s, réinvestissement automatique (30 tirages)

Le joueur achète toujours l’amélioration la moins chère disponible (pioche, Sac, Auto-Dig, boutique de fragments, et Chance jusqu’au niveau visé) ; ses fragments vont à l’Œil du mineur et à la Griffe d’obsidienne. Valeurs : p10 · **médiane** · p90.

| Chance visée | Profondeur après 1 h | 3 h | 6 h | 10 h | 20 h de jeu | Niveaux à 10 h (médiane) |
|---|---|---|---|---|---|---|
| 0 | 299 · **320** · 336 | 644 · **676** · 698 | 1 042 · **1 072** · 1 102 | 1 421 · **1 469** · 1 513 | 2 156 · **2 218** · 2 260 | P15 C0 S12 A5 · Œil 2 Griffe 1 |
| 1 | 297 · **314** · 328 | 645 · **667** · 683 | 1 036 · **1 055** · 1 089 | 1 426 · **1 446** · 1 494 | 2 133 · **2 173** · 2 223 | P15 C1 S12 A6 · Œil 3 Griffe 1 |
| 4 | 289 · **305** · 326 | 625 · **656** · 675 | 1 006 · **1 034** · 1 055 | 1 382 · **1 414** · 1 445 | 2 079 · **2 128** · 2 177 | P15 C4 S12 A6 · Œil 3 Griffe 1 |
| 7 | 279 · **300** · 314 | 620 · **635** · 656 | 982 · **1 006** · 1 031 | 1 345 · **1 372** · 1 410 | 2 033 · **2 086** · 2 127 | P15 C7 S12 A6 · Œil 3 Griffe 1 |
| 12 | 278 · **295** · 309 | 590 · **609** · 631 | 940 · **964** · 989 | 1 295 · **1 325** · 1 350 | 1 962 · **2 009** · 2 047 | P15 C12 S12 A6 · Œil 4 Griffe 1 |

#### E. Solutions étudiées — profil « milieu », 1 h, sans bonus (200 tirages)

Écarts par rapport au jeu actuel à Chance 0 (référence commune).

| Chance | Actuel : mètres/h · pièces/h | A « deux temps » : mètres/h · pièces/h | B « rares fragiles » : mètres/h · pièces/h |
|---|---|---|---|
| 0 | 233 (+0 %) · 637 951 (+0 %) | 236 (+1 %) · 648 458 (+6 %) | 233 (+0 %) · 637 951 (+0 %) |
| 1 | 227 (-3 %) · 716 707 (+12 %) | 236 (+1 %) · 751 095 (+24 %) | 237 (+1 %) · 764 505 (+22 %) |
| 4 | 212 (-9 %) · 876 314 (+40 %) | 234 (-0 %) · 1 051 612 (+69 %) | 249 (+6 %) · 1 172 772 (+86 %) |
| 7 | 200 (-14 %) · 1 013 305 (+61 %) | 232 (-0 %) · 1 356 979 (+114 %) | 259 (+11 %) · 1 570 731 (+155 %) |
| 12 | 186 (-20 %) · 1 170 444 (+84 %) | 233 (-0 %) · 1 818 167 (+190 %) | 276 (+18 %) · 2 361 450 (+276 %) |

Lecture des tables :
- **A** : quel que soit le niveau, à partir de ~40 m la Chance augmente les PV moyens (+22 % à
  100 m pour Chance 7, +35 % pour Chance 12). Avant 40 m, les seuls blocs « rares » sont des
  coffres à faibles PV : la Chance y est neutre en vitesse mais remplace des blocs payants par des
  coffres peu payants.
- **B** : la perte de vitesse est d'autant plus forte que le joueur dépend de l'Auto-Dig
  (dégâts faibles face à des blocs à 300+ PV).
- **D** : même en convertissant tout le surplus de pièces en fragments puis en reliques de
  profondeur, la Chance reste perdante à tous les horizons.

### 5. Solutions proposées (aucune n'est appliquée)

| | Principe | Profondeur (Chance 7, profil milieu) | Pièces/h (Chance 7) | Risques |
|---|---|---|---|---|
| **A — « deux temps » à 10 %/niveau (recommandée)** | La **résistance** du bloc est tirée **sans** Chance, sa **nature et sa récompense avec** Chance. Chance passe de +20 % à **+10 % de poids par niveau** (Lentille fêlée idem, à moitié). | **±0 %** (neutre par construction) | **+60 %**, comme aujourd'hui (+14 / +40 / +60 / +102 % aux niveaux 1 / 4 / 7 / 12) | Un « diamant » peut avoir les PV d'un bloc de pierre : à assumer (« bloc chanceux ✨ ») ou à habiller visuellement. Gemmes plus fréquentes → Auto-Dig plus tôt (léger gain de profondeur). |
| A' — « deux temps » à 20 %/niveau | Idem, sans changer le pourcentage | ±0 % | +114 % (+190 % au niveau 12) | Économie nettement plus généreuse : coffres, boutique et pioche s'achètent plus vite. |
| B — « rares fragiles » | Tirage inchangé ; les PV des blocs rares+ sont divisés par le multiplicateur de Chance (÷2,4 à Chance 7) | **+11 %** (+18 % au niveau 12) | +155 % (+276 %) | Chance devient la meilleure amélioration de profondeur **et** d'économie : déséquilibre inverse, recalibrage des prix nécessaire. |
| C — ne rien changer au moteur, informer | Carte Chance : « plus de pièces et de gemmes, descente plus lente » avec le % réel | −14 % | +61 % | Amélioration toujours piégeuse pour le classement ; transparente mais frustrante. |

Pour A, la mise en œuvre est courte (~1 h) : `blocks.js spawn` (deux tirages), coefficient 0,1
dans `luckMultiplier`, libellé de la carte, tests (PV moyens identiques à Chance 0, part rare
conforme). Aucune donnée de joueur n'est touchée : les niveaux de Chance achetés restent, et
deviennent simplement non pénalisants. Le classement de la saison en cours n'est pas recalculé.

### 6. Changements réalisés (sans effet sur l'équilibrage)

- `public/js/blocks.js` : `Blocks.blockOdds(depth, luck)` (probabilité exacte de chaque bloc),
  `Blocks.rareShare`, `Blocks.luckMultiplier`. `_pickType` utilise le même pool : **tirage
  identique** (test de fréquence sur 60 000 tirages).
- `public/js/upgrades.js` : `Upgrades.getLuckPreview(depth, level)` ; la carte Chance reçoit une
  ligne d'aperçu.
- `public/js/main.js` : ligne `.upgrade-preview` sous la description, recalculée à chaque coup
  (elle suit la descente sans redessiner la carte).
- `public/js/i18n.js` : textes FR/EN/NL. `public/css/style.css` : style de la ligne (or, retour à
  la ligne autorisé).
- `tools/balance/luck-sim.js` : simulation (sections A à E du présent rapport).
- `test/luck.test.js` : 5 tests (somme des probabilités = 1, part rare exacte à 100 m, fréquences
  tirées = probabilités, aperçu FR/EN/NL avec virgule/point, relique incluse, niveau max, outil
  reproductible et cohérent avec le constat).

Affichage obtenu (carte Chance, Nv.7, à 150 m) :
- FR : « À 150m : 25,3% de blocs rares → 26,9% » ; au niveau 12 : « À 150m : 32,4% de blocs rares » ;
  avant 5 m : « Aucun bloc rare avant 5m ».
- EN : « At 150m: 25.3% rare blocks → 26.9% » · NL : « Op 150m: 25,3% zeldzame blokken → 26,9% ».
- Ordinateur 1280×900 : une ligne. Smartphone 390×844 : deux lignes, la flèche reste collée au
  pourcentage suivant ; la description existante reste inchangée.

Cet aperçu est **spécifique à la Chance** (effet dépendant de la profondeur). L'aperçu général
« niveau 8 → 9, Récompenses ×3,4 → ×3,7 » de toutes les améliorations reste à faire dans #20 ; il
pourra s'y ajouter sans conflit.

### 7. SHA, test et vérifications

- `develop` : **`f42ae68`** (merge de `1d1dc0a`). Production : **`f42ae68`**.
- Tests : `npm test` **227/227** sur la branche, sur `develop` fusionné et sur la release exacte
  `f42ae68` ; `npm run check` ok.
- Navigateur (Chromium sans interface, serveur de test port 3101, base de test) : carte Chance à
  1280×900 (FR) et 390×844 (FR, NL), aperçu mis à jour en passant de 100 m à 150 m, aucune erreur
  JavaScript.
- Reproduire l'audit : `node tools/balance/luck-sim.js` ; tests : `node --test test/luck.test.js`.
- Non vérifié : simulation des reliques Lentille fêlée/Cœur d'or achetées sur plusieurs saisons,
  coffres de la boutique de saison (exclus du modèle de saison), clics irréguliers (CPS constant).

### 8. Déploiement

- SHA déployé **`f42ae68`** (avant : `1ef0693`), par `scripts/deploy.sh` de la release.
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261030-145105-pre-deploy-f42ae68.sqlite`.
- Copie de la base de production démarrée en mode production (port 3122) : `/health` ok,
  `/api/version` = `1.0.0+f42ae68`, empreintes des 6 tables joueurs **identiques** avant/après ;
  copie supprimée.
- Après déploiement : 2 domaines → 200 en `1.0.0+f42ae68`, journal sans erreur, `quick_check` ok.
  Une partie était en cours : la sauvegarde du joueur a progressé (révision +1, profondeur et
  classement inchangés) — progression, aucune perte.
- Aucune migration, aucun changement de schéma ni de données.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 1ef0693` puis `sudo systemctl restart dig`
  (lock npm inchangé).

**Test fonctionnel à faire en jeu (2 min, sans achat) :**
1. Ouvrir l'onglet **Améliorations**, carte **Chance** (Nv.7).
2. Attendu : sous « +140% chance de blocs rares », une ligne dorée « À ___m : 25,3% de blocs rares → 26,9% »
   (valeurs selon la profondeur), avec la profondeur actuelle.
3. Casser quelques blocs : la profondeur de la ligne suit la descente.
4. Changer la langue (EN/NL) : la ligne est traduite (point décimal en anglais).
5. Sur téléphone : la ligne passe sur deux lignes au maximum, rien n'est coupé.
6. Lire la section 5 et répondre à la question 1.

### 9. Choix techniques faits seul

- Simulation par **le vrai code du jeu** chargé en `vm` (pas de recopie des tables) : l'outil reste
  juste si les blocs changent. Hasard à graine fixe pour des chiffres reproductibles dans le rapport.
- Aperçu exprimé en **part réelle de blocs rares à la profondeur actuelle**, plutôt qu'en
  « +160 % » : c'est la seule valeur compréhensible et elle montre que le gain d'un niveau est faible.
  Pas de mention « descente plus lente » : c'est un choix de communication lié à la question 1.
- Les variantes A/B ne vivent que dans l'outil de simulation (`variant`), jamais dans le jeu.

### 10. Décisions demandées au propriétaire

1. **Rééquilibrage de la Chance** :
   - **A (recommandée)** — tirage « deux temps » + 10 % par niveau : profondeur neutre, gains de
     pièces identiques à aujourd'hui ;
   - A' — « deux temps » à 20 % : profondeur neutre, pièces ~×2 par rapport à aujourd'hui ;
   - B — rares fragiles : la Chance fait descendre plus vite (+11 %), économie à recalibrer ;
   - C — ne rien changer, afficher « descente plus lente » sur la carte.
2. Si A ou A' : un bloc rare tiré par la Chance garde-t-il son apparence normale (recommandé, plus
   simple) ou reçoit-il un marqueur « ✨ chanceux » pour expliquer ses PV bas ?
3. Le libellé « +140 % chance de blocs rares » est trompeur (poids, pas probabilité). Le remplacer
   par la part réelle (« 25 % de blocs rares à 150 m ») ? Recommandation : oui, avec la décision 1.

### 11. Constats hors périmètre (signalés, non traités)

- **Auto-Dig bloqué par les coffres** : la popup de coffre de la mine arrête tout jusqu'au clic
  « Récupérer ». Un joueur absent ne casse en médiane que **10 blocs** (Chance 0) ou **6 blocs**
  (Chance 7) avant que l'Auto-Dig s'arrête. À traiter avec #35 ou #25 — **Après lancement**.
- Les coffres de la mine ne suivent ni la profondeur ni le Sac : à 200 m, 80–1 200 pièces contre
  ~2 500 pour un bloc de fer avec Sac 12. À voir avec la table A des coffres (#20).
- Les gains hors ligne ignorent la Chance (formule fixe) : cohérent avec l'option A, à garder en tête.

### 12. Reste à faire

- Décision 1 → implémentation (~1 h) + tests + déploiement, dans ce ticket.
- Aperçu avant/après des autres améliorations : #20.
