# Ticket #20 — [P2] T-13 — Rendre les paramètres économiques effectifs

- Ticket : https://github.com/ReC82/Dig/issues/20
- Source : audit général #6 (T-13, bug B8, risque P2 « paramètres d'admin morts »)
- Branche : `feature/20-parametres-economiques` (dernier code : `e339a26`, `develop` : `9fd23e4`, déployé : `9fd23e4`)

## Session du 30/10/2026 (soir, DIGORCH) — option A des coffres, chances visibles, aperçu des améliorations

Commentaires du propriétaire traités :
[recette du Sac et cas combinés](https://github.com/ReC82/Dig/issues/20#issuecomment-6519842869),
[décision : option A + transparence avant achat](https://github.com/ReC82/Dig/issues/20#issuecomment-6519885255),
[aperçu avant/après des améliorations](https://github.com/ReC82/Dig/issues/20#issuecomment-6520146241) et
[Auto-Dig validé](https://github.com/ReC82/Dig/issues/20#issuecomment-6520597663).

### 1. État réel

**Déployé en production (SHA `9fd23e4`) — en attente de recette.** Ticket laissé ouvert : sa clôture
revient au propriétaire, après validation en jeu de la fenêtre des chances et des cas combinés.

### 2. Résultat et changements réalisés

**a) Coffres : option A en service** (`server/chestShop.js`). Les prix sont inchangés et le panel
admin reste désactivé.

| Coffre | Chances (total 100 %) | Pièces rendues en moyenne |
|---|---|---|
| 📦 2 000 | 45 % 500–1 000 💰 · 30 % 1 🔮 · 15 % boost ×2 5 min · 10 % gros lot 2 000–3 500 💰 | 30,6 % du prix |
| 💎 15 000 | 40 % 5 000–9 000 💰 · 30 % 4 🔮 · 12 % 7 🔮 · 8 % boost ×2 15 min · 8 % objet · 2 % gros lot 15 000–25 000 💰 | 21,3 % |
| 🏺 80 000 (5/saison) | 30 % 25 000–40 000 💰 · 25 % 20 🔮 · 18 % 30 🔮 · 10 % boost ×3 20 min · 12 % objet · 4 % 50 🔮 · 1 % gros lot 100 000–150 000 💰 | 13,8 % |

Quand un coffre donne des pièces, il rend au moins un quart de son prix. Cette garantie ne concerne
que les pièces : les fragments, les boosts et les objets ne sont pas présentés comme un
remboursement. En moyenne, un coffre rend toujours moins de pièces qu'il ne coûte, il n'y a donc pas
de boucle de profit.

**b) Fenêtre « ℹ️ Récompenses et chances »**, sous chaque coffre de la boutique de saison (vue
Améliorations). Le lien est toujours actif : sans pièces, sans compte, ou quand la limite est
atteinte. La fenêtre affiche :
- le prix et la limite saisonnière (« Limité à 5 ouvertures par saison (n/5 cette saison) ») ;
- toutes les récompenses avec leur probabilité exacte, les plages de pièces, la durée des boosts et
  l'étiquette « gros lot » ;
- les fragments que le joueur recevrait lui-même avec son Aimant à éclats (« tu en reçois 6 ») ;
- les règles de tirage :
  - une ouverture = un tirage ;
  - le pourcentage est la probabilité d'obtenir ce type de récompense, la quantité est affichée à
    côté ;
  - les pièces ne sont multipliées ni par le Sac, ni par les reliques, ni par les boosts ;
  - formule des fragments : (quantité + bonus Aimant de +1 à +5) × bonus de fragments du jeu s'il
    est différent de 1, arrondi, au moins 1 ;
  - objet de collection tiré à chances égales parmi les objets d'origine manquants, avec le nombre
    et le % par objet pour ce joueur ;
  - collection complète : 5 fragments à la place.

La fenêtre ne contient **aucun bouton d'achat**. Elle se ferme par « Fermer », la touche Échap ou un
clic à côté. Elle est traduite en FR, EN et NL.

**c) Source unique des chances.** La nouvelle route `GET /api/shop/chests` (publique, lecture seule)
publie la table utilisée par le tirage du serveur, ainsi que le coût admin et le multiplicateur de
fragments. La fenêtre relit cette route à chaque ouverture. Le tirage des joueurs anonymes utilise
désormais la même table : les tables recopiées en dur dans `main.js` ont été supprimées.

**d) Aperçu avant/après des améliorations.** Chaque carte affiche maintenant le passage au niveau
suivant, avec les valeurs réelles (reliques comprises) :
- Sac : « Niveau 8 → 9 · Récompenses ×3,4 → ×3,7 » ;
- Pioche : « Dégâts par clic : 7 → 8 », Œil du mineur compris ;
- Auto-Dig : « Dégâts auto/sec : 6 → 7 », Moteur antique compris ;
- Chance, Fragments et Reroll : « Niveau n → n+1 ». Chance garde en plus son aperçu des blocs rares ;
- au niveau maximal : « Niveau maximal atteint ».

Les descriptions de la Pioche et de l'Auto-Dig donnent désormais elles aussi la valeur réelle avec
les reliques. Elles indiquaient auparavant le niveau seul. L'économie ne change pas.

**e) Ligne « Récompense » sous le bloc.**
- **Cœur d'or** : vérifié dans le moteur. Il multiplie les pièces des blocs par 1,15 / 1,30 / 1,50 /
  1,75 / 2 selon son niveau, et il était déjà affiché à part (💛). Il n'est pas compris dans la base
  du bloc, donc il n'est pas compté deux fois.
- L'ordre de calcul est inchangé : base × 🎒 × 💛 × ✨ × ⚡, avec un seul arrondi supérieur à la fin,
  comme pour le crédit réel.
- **Grands nombres** : les montants sont toujours écrits en entier avec les séparateurs de la
  langue (7 654 321 / 7,654,321 / 7.654.321), jamais abrégés.
- Si la place manque, la ligne passe à la ligne entre deux facteurs. « = 💰 total » reste d'un seul
  tenant et n'est jamais tronqué.

### 3. SHA sur `develop`, branche, procédure de test

- Branche `feature/20-parametres-economiques` : commit `e339a26`. Fusion dans `develop` : **`9fd23e4`**.
- Lancer les tests : `npm test` (313 tests), ou `node --test test/chest-shop-odds.test.js` pour les
  10 nouveaux tests.
- Vérification rapide de l'API : `curl https://dig.lodygames.com/api/shop/chests` renvoie les 3
  coffres, et la somme des `chance` de chaque coffre vaut 100.

### 4. Vérifications effectuées, limites, données des joueurs

**Tests automatiques** : `npm test` 313/313 sur la branche, sur `develop` et sur la release `9fd23e4`.

Le nouveau fichier `test/chest-shop-odds.test.js` couvre :
- les sommes à 100 % et les prix ;
- le minimum d'un quart du prix et une espérance inférieure au prix ;
- 20 000 tirages par coffre avec une graine fixe : fréquences à ±1,2 point près, montants dans les
  bornes ;
- l'égalité entre la description publique et le tirage, coût admin et multiplicateur compris ;
- l'absence de pourcentages en dur côté client ;
- les fragments du client égaux à ceux du serveur : Aimant de 0 à 5 × multiplicateurs 0,5 / 1 /
  1,5 / 2 ;
- l'aperçu avant/après avec reliques ;
- la mise en forme FR/EN/NL ;
- Cœur d'or 0–5 × Sac × bonus 1–3 × réglage admin × bases jusqu'à 7 654 321 : total affiché =
  montant crédité, et produit des facteurs = multiplicateur appliqué ;
- les règles CSS de retour à la ligne.

Fichiers de tests existants adaptés :
- `test/chest-shop.test.js` : nouvelle route publique testée (lecture seule, identique au tirage).
  Le test « double clic » fixe le coût à 4 000 le temps du test, parce que le gros lot de 3 500
  permettrait désormais de racheter un coffre.
- `test/economy.test.js` : tirage simulé recalé sur la nouvelle table.

**Contrôles Chromium** sur un serveur de test, en 1280×900 et 390×844, en FR, EN et NL, sans aucune
erreur :
- ligne « 💰 7 654 321 × 🎒 3,4 × 💛 1,3 × ⚡ 3 = 💰 101 496 297 » sur deux lignes, total entier
  visible et sans débordement ;
- 3 fenêtres de chances : 4, 6 et 7 lignes, total 100 %, aucun bouton d'achat, fermeture par Échap ;
- achat anonyme d'un coffre simple tiré avec la table du serveur ;
- aperçu « Niveau 8 → 9 · Récompenses ×3,4 → ×3,7 ».

**En production**, en visiteur et sans achat : fenêtre du coffre antique et aperçus corrects sur
ordinateur et smartphone, sans erreur.

**Données des joueurs** : aucune migration, aucune donnée touchée. Seules les tirages futurs
changent. Copie de la base de production démarrée avec la release : empreintes identiques.

**Limites** :
- Les coffres-blocs trouvés en creusant (table `Chests.TABLES`) ne sont pas concernés : ils
  affichent toujours « Contenu aléatoire ». Voir le point 9.
- Le boost d'un coffre multiplie les pièces des blocs. Sa valeur dépend donc du rythme de jeu et
  n'est pas comptée dans le rendement en pièces.

### 5. Déploiement

- **SHA déployé : `9fd23e4`**, par `deploy.sh` de la release. Production précédente : `bbdb1d6`.
- Sauvegarde vérifiée : `dig-20261030-195907-pre-deploy-9fd23e4.sqlite`.
- Après déploiement :
  - les 2 domaines répondent 200 en `1.0.0+9fd23e4`, `/api/shop/chests` répond 200 ;
  - journal sans erreur, `quick_check` ok ;
  - empreintes des tables joueurs identiques à la sauvegarde.
- Retour arrière possible immédiatement : `git -C /home/ubuntu/Dig reset --keep bbdb1d6` puis
  `sudo systemctl restart dig`. Aucun changement de schéma n'est à défaire.

### 6. Test fonctionnel à faire par le propriétaire (≈ 3 min, sans acheter de coffre)

Recharger la page une fois avant de commencer.

1. **Améliorations → Boutique de saison → « ℹ️ Récompenses et chances »** sous chaque coffre.
   Attendu :
   - simple : 45 / 30 / 15 / 10 % ;
   - rare : 40 / 30 / 12 / 8 / 8 / 2 % ;
   - antique : 30 / 25 / 18 / 10 / 12 / 4 / 1 %, avec « Limité à 5 ouvertures par saison » ;
   - pas de bouton d'achat dans la fenêtre ; fermeture par « Fermer » ou en touchant à côté.
2. Si tu as l'Aimant à éclats, la mention « tu en reçois N » apparaît à côté des fragments.
3. **Carte Sac** : « Niveau 8 → 9 · Récompenses ×3,4 → ×3,7 ». Pioche et Auto-Dig affichent aussi
   « actuel → suivant ».
4. **Cas combinés**, sous le bloc :
   - avec un bonus ×2 actif : « 💰 base × 🎒 3,4 × ⚡ 2 = 💰 total » ;
   - avec le Cœur d'or : un facteur 💛 en plus ;
   - le compteur augmente exactement du total.
5. Facultatif : en anglais ou en néerlandais (Paramètres), la fenêtre est traduite.

**Classement : Bloquant MVP public** pour la transparence des chances, dès qu'on vend des coffres
contre des pièces. Le reste relève du confort, **après lancement**.

### 7. Choix techniques faits seul

- **Route publique dédiée** `GET /api/shop/chests` plutôt qu'un champ dans `/api/seasons/current`.
  C'est la seule source des chances : elle est relue à chaque ouverture de la fenêtre, ce qui reflète
  aussitôt un réglage admin.
- **Achat anonyme hors ligne** : il est refusé tant que la table n'a pas été chargée (message
  d'erreur, aucun débit). Garder une copie locale des chances aurait recréé un doublon.
- **Montants jamais abrégés** (pas de « 1,2 M »), pour éviter toute troncature ambiguë. Le retour à
  la ligne suffit à rester lisible sur 390 px.
- **Pioche et Auto-Dig** : effet réel avec les reliques. C'est « la formule effective » demandée, et
  cela corrige une description qui ignorait l'Œil du mineur et le Moteur antique.

### 8. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire. Il reste seulement la recette ci-dessus.

### 9. Éléments restant à réaliser

- Après lancement, suggestion à valider dans un ticket séparé : afficher les chances des
  coffres-blocs trouvés en creusant, qui montrent seulement « Contenu aléatoire ».
- Clôture du #20 par le propriétaire après la recette.

## Session du 30/10/2026 (matin, DIGORCH) — retours de recette du propriétaire

Deux commentaires du propriétaire du 30/10 ont été traités :
[récompense des coffres décevante](https://github.com/ReC82/Dig/issues/20#issuecomment-6518676648)
(audit + proposition demandés, **sans modification sans décision**) et
[pioche validée, affichage du Sac demandé](https://github.com/ReC82/Dig/issues/20#issuecomment-6519234276)
(correction d'affichage à livrer).

### 1. État réel

- **Affichage de la récompense décomposée : déployé en production (SHA `cab983d`) — en attente de recette.**
- **Équilibrage des coffres : audit fait, proposition ci-dessous, rien de modifié — décision du propriétaire attendue.**
- Pioche : validée par le propriétaire en jeu. Les autres améliorations ne sont pas considérées comme testées.

Classement : affichage du Sac **Après lancement** (confort) ; équilibrage des coffres **Bloquant MVP public**
(conseillé) : un joueur qui ouvre un coffre et perd 95 % de sa mise risque de ne jamais y revenir.

### 2. Affichage du Sac sous le bloc

Formule réelle du moteur (`public/js/main.js`, destruction d'un bloc normal) :

```
pièces créditées = arrondi supérieur( base du bloc × sac × relique 💛 × réglage admin × bonus temporaire )
sac = 1 + 0,3 × niveau du Sac      base du bloc = arrondi supérieur( base du type × (1 + 0,05 × (profondeur − 1)) )
```

Un seul arrondi, à la fin. L'ancien affichage montrait « 💰 X ⚡×2 → 💰 Y » où **X incluait déjà le
Sac** : afficher « X × 🎒 3,4 » aurait compté le Sac deux fois. Le nouvel affichage part donc de la
base du bloc :

| Situation | Ligne « Récompense » |
|---|---|
| Sac 0, pas de bonus | `💰 150` |
| Bonus ×2 seul | `💰 150 × ⚡ 2 = 💰 300` |
| Sac 8 + bonus ×2 (capture de la recette) | `💰 150 × 🎒 3,4 × ⚡ 2 = 💰 1 020` |
| Sac 3 | `💰 150 × 🎒 1,9 = 💰 285` |
| Sac 12 + bonus ×3 | `💰 150 × 🎒 4,6 × ⚡ 3 = 💰 2 070` |

- Seuls les multiplicateurs différents de 1 apparaissent, dans l'ordre du moteur : 🎒 Sac,
  💛 relique Golden Heart (+% pièces), ✨ réglage admin `coin_gain_multiplier`, ⚡ bonus temporaire.
  Chaque facteur a une info-bulle (« Sac », « Bonus temporaire »…) en FR/EN/NL.
- Le total est calculé avec **la même expression** que le crédit réel : le nombre affiché est celui
  qui s'ajoute au compteur. Économie inchangée.
- Séparateur décimal selon la langue (3,4 en français, 3.4 en anglais). Icône des pièces : 💰,
  celle déjà utilisée partout dans le jeu (au lieu du 🪙 de l'exemple).
- Smartphone 390×844 : la ligne la plus longue (sac + bonus) tient sur une ligne (301 px) ; avec
  quatre facteurs, elle revient à la ligne entre deux facteurs, jamais au milieu d'un nombre.

Fichiers : `public/js/upgrades.js` (`Upgrades.getRewardBreakdown`), `public/js/main.js`
(`renderBlock`), `public/js/i18n.js` (libellés `ui.reward_factor.*`), `public/css/style.css`,
`test/economy.test.js` (1 nouveau test : sans bonus, bonus seul, exemple 150 × 3,4 × 2 = 1 020,
puis tous les niveaux de Sac 0–12 × bonus 1/2/3 × 6 bases : total affiché = montant crédité ;
relique et réglage admin affichés comme facteurs distincts).

### 3. Audit des coffres de la boutique de saison (aucune modification)

Source de vérité : `server/chestShop.js` (copie hors ligne dans `public/js/main.js`). Les pièces
gagnées dans un coffre ne sont **pas** multipliées par le Sac, les reliques ni les bonus.

**Table actuelle**

| Coffre (prix) | Tirages | Pièces rendues en moyenne | Fragments / coffre | Coût net d'un fragment |
|---|---|---|---|---|
| 📦 Simple (2 000) | 50 % 80–200 💰 · 25 % 200–500 💰 · 20 % 1 🔮 · 5 % boost ×2 3 min | **158 (7,9 %)** | 0,20 | 9 213 💰 |
| 💎 Rare (15 000) | 30 % 1 000–3 000 · 20 % 3 000–8 000 · 25 % 2 🔮 · 12 % 3 🔮 · 8 % boost ×2 10 min · 5 % objet de collection | 1 700 (11,3 %) | 0,86 | 15 465 💰 |
| 🏺 Antique (80 000, 5/saison) | 25 % 10 000–25 000 · 25 % 5 🔮 · 15 % 10 🔮 · 13 % boost ×3 15 min · 12 % objet · 7 % 20 🔮 · 3 % 30 🔮 | 4 375 (5,5 %) | 5,05 | 14 975 💰 |

Constats :
1. **Le tirage de la recette (90 pièces) est le cas le plus fréquent** : 75 % des coffres simples
   rendent moins de 500 pièces (moins de 25 % du prix). Ce n'est pas un bug, c'est la table.
2. **Le meilleur coffre est le plus petit** : un fragment coûte ~9 200 💰 via le coffre simple contre
   ~15 000 via le rare ou l'antique. Le coffre antique, présenté comme « jackpot », est le pire en
   pièces (5,5 %).
3. **Repère** : la boutique de fragments (Améliorations) vend le 1er fragment 5 000 💰, le 2e 12 000,
   le 3e 25 000. Débloquer la première relique demande 5 à 25 fragments ; tout maxer en demande 1 617.
4. **Pas de boucle de profit aujourd'hui** (aucun coffre ne rend plus de pièces qu'il ne coûte), mais
   aucune raison claire d'acheter non plus. Point d'attention existant : la relique Shard Magnet
   (+1 à +5 par tirage de fragments) rend le coffre simple très rentable en fragments au niveau 5
   (1 fragment → 6) ; borné par le coût fini des reliques, donc pas de boucle de pièces.
5. Exemple de 10 coffres simples aujourd'hui : 89 · 167 · 174 · 183 · 1 🔮 · 284 · 167 · 1 🔮 · 1 🔮 ·
   168 pièces → 1 232 pièces et 3 fragments pour 20 000 dépensées.

**Proposition (option A, recommandée)** — règles simples à expliquer :
- un coffre ne rend **jamais moins d'un quart de son prix** en pièces ;
- il rend en moyenne **15 à 30 % de son prix en pièces**, et son vrai intérêt est **fragments, boost et objets** ;
- un fragment coûte **~4 600 à 5 800 💰** par les coffres (moins que la boutique de fragments après le 1er achat) ;
- un **gros lot rare** peut rembourser le coffre (10 % / 2 % / 1 %), sans que la moyenne dépasse jamais le prix.

| Coffre (prix inchangé) | Tirages proposés | Pièces rendues en moyenne | Fragments / coffre | Coût net d'un fragment |
|---|---|---|---|---|
| 📦 Simple (2 000) | 45 % 500–1 000 💰 · 30 % 1 🔮 · 15 % boost ×2 **5 min** · 10 % **gros lot 2 000–3 500 💰** | 613 (30,6 %) | 0,30 | 4 625 💰 |
| 💎 Rare (15 000) | 40 % 5 000–9 000 💰 · 30 % 4 🔮 · 12 % 7 🔮 · 8 % boost ×2 15 min · 8 % objet de collection · 2 % gros lot 15 000–25 000 💰 | 3 200 (21,3 %) | 2,04 | 5 784 💰 |
| 🏺 Antique (80 000, 5/saison) | 30 % 25 000–40 000 💰 · 25 % 20 🔮 · 18 % 30 🔮 · 10 % boost ×3 20 min · 12 % objet · 4 % 50 🔮 · 1 % gros lot 100 000–150 000 💰 | 11 000 (13,8 %) | 12,40 | 5 565 💰 |

Exemples de tirages simulés (option A) :
- 10 coffres simples : 540 · 860 · 890 · 929 · **2 802** · 537 · 1 🔮 · boost · boost · 868 pièces →
  ~8 400 pièces, 1 fragment et 2 boosts pour 20 000 dépensées.
- 10 coffres rares : objet · 7 🔮 · 6 761 · boost · 4 🔮 · 8 527 · 7 577 · 6 544 · 8 868 · 5 012.
- 5 coffres antiques : 30 🔮 · 30 🔮 · 25 442 · objet · 26 652.

Impact attendu : la pire ouverture d'un coffre simple passe de 80 à 500 pièces ; la relique la moins
chère (5 fragments) s'obtient en moyenne avec ~17 coffres simples ou ~3 rares, au lieu de 25 / 6
(1 antique dans les deux cas). Les pièces restent une dépense nette (69 à 86 % du prix « brûlés » en moyenne) : aucune
boucle de profit, même avec le Sac, les reliques ou un bonus (non appliqués aux coffres).
Réversible : les tables sont du code, les sauvegardes des joueurs ne changent pas.

Autres options :
- **B (minimale)** : ne changer que le coffre simple (table ci-dessus), garder rare et antique.
- **C (sans code)** : garder les tables et baisser les prix via l'admin (par exemple 500 / 5 000 /
  30 000). Nécessite d'activer le panel admin en production (voir question 2) ; ne corrige pas le
  ressenti « 90 pièces » ni l'antique moins rentable que le simple.

Mise en œuvre si A ou B est retenue (~1 h) : `server/chestShop.js` + copie hors ligne de
`public/js/main.js` + descriptions de la boutique (FR/EN/NL) + tests de la nouvelle table
(probabilités, espérance < prix), puis déploiement ordinaire.

### 4. SHA, procédure de test

- Branche `feature/20-parametres-economiques` : `8657fec` ; `develop` : `cab983d` (fusion).
- Tests : `npm test` → 148/148 sur la branche, sur `develop` et sur la release `cab983d`.
- Essai Chromium sur serveur de test (port 3101, base de test) puis en production (visiteur sans
  compte, rien d'enregistré côté serveur), 1280×900 et 390×844 : cinq cas ci-dessus, aucune erreur.

### 5. Vérifications, limites, données des joueurs

- Changement d'affichage uniquement : aucune donnée, aucune règle d'économie, aucun schéma modifié.
- Premier passage de `npm test` sur la release : le fichier `ranking-depth` a été signalé en échec
  au niveau du fichier sans aucun sous-test en échec (17/17 passés), cause environnementale probable
  (port de test 3110) ; suite complète relancée 148/148, puis 3 × 17/17 sur ce fichier seul.
- Un serveur de test orphelin (port 3110, base temporaire), laissé par une relance interrompue de
  ma part, a été identifié et arrêté.

### 6. Déploiement

- SHA déployé : **`cab983d`** (avant : `041ed21`). Sauvegarde pré-déploiement vérifiée :
  `dig-20261030-104234-pre-deploy-cab983d.sqlite`.
- Copie de la base de production démarrée avec la release : `/health` OK, version `1.0.0+cab983d`,
  empreintes des 6 tables identiques avant/après.
- Après déploiement : 2 domaines → 200 en `1.0.0+cab983d`, journal sans erreur, `quick_check` ok,
  empreintes joueurs identiques à la sauvegarde.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 041ed21` + redémarrage (aucune migration).

**Test à faire en jeu (2 min)** — recharger la page une fois (nouvelle version du cache hors ligne) :
1. Sur un bloc normal, sans bonus actif : la ligne affiche `💰 base × 🎒 3,4 = 💰 total` (Sac niveau 8).
2. Activer un bonus (pub « Doubler la récompense » ou boost) : `… × ⚡ 2 = 💰 total`.
3. Casser le bloc : le nombre qui s'ajoute au compteur de pièces = le total affiché.
4. Coffre (bloc coffre) : la ligne affiche toujours les icônes de butin, sans calcul.

### 7. Choix techniques faits seul

- Base affichée = base du bloc (hors Sac), pour ne jamais compter le Sac deux fois.
- Tous les multiplicateurs réels sont montrés (pas seulement Sac et bonus), sinon le calcul affiché
  serait faux pour un joueur ayant la relique Golden Heart ou si l'admin règle les gains.
- 💰 conservé (icône des pièces du jeu).
- Aucune modification des coffres : demandée explicitement par le propriétaire avant décision.

### 8. Décisions demandées au propriétaire

1. **Équilibrage des coffres** : A (nouvelles tables pour les 3 coffres, recommandé), B (coffre
   simple seulement) ou C (tables inchangées, prix baissés via l'admin) ? Ajustements possibles sur
   un chiffre précis (ex. « simple à 40 % en moyenne »).
2. Activer le panel admin en production (`ADMIN_SECRET` dans `/etc/dig/dig.env`) — utile seulement
   pour l'option C ou pour régler l'économie sans déploiement. Recommandation : non pour le moment.

### 9. Reste à faire

- Appliquer l'option retenue pour les coffres (Bloquant MVP conseillé, ~1 h + déploiement).
- Recette des autres améliorations (Chance, Sac, Auto-Dig) et de l'affichage décomposé.

## Session du 30/10/2026 (nuit, DIGORCH)

### 1. État réel

**Déployé en production (SHA `5a35fa3`) — en attente de recette.**
Classement : **Après lancement** (aucun effet visible tant que les réglages restent à leur valeur neutre).

### 2. Résultat

Avant : trois réglages de l'admin ne servaient à rien (`upgrade_cost_multiplier`,
`coin_gain_multiplier`, `season_duration`). Un coût de coffre modifié dans l'admin était débité
par le serveur, mais le jeu affichait toujours l'ancien prix. Le bonus de la relique Shard Magnet
était ignoré par le serveur (B8) : le serveur lisait `relicBonuses`, un cache du navigateur
jamais sauvegardé.

Maintenant :

| Réglage admin | Effet en jeu |
|---|---|
| `upgrade_cost_multiplier` (0.1–10) | Coût en pièces de toutes les améliorations (onglet Améliorations), arrondi à l'unité supérieure. |
| `coin_gain_multiplier` (0.1–10) | Pièces gagnées par bloc (et affichées sous le bloc) et gains hors ligne. |
| `fragment_drop_multiplier` (0.1–10) | Fragments des coffres de la boutique. C'était déjà appliqué par le serveur ; c'est maintenant aussi le cas pour un joueur sans compte. |
| `chest_cost_simple/rare/antique` (entier ≥ 1) | Prix affiché dans la boutique de saison = prix débité par le serveur. |
| `season_duration` | **Retiré** des paramètres de saison. Depuis #16, les saisons durent une semaine ISO (du lundi au dimanche, UTC). Il reste visible dans la config brute, marqué « Inutilisé ». La valeur en base est conservée. |

Les effets s'appliquent **sans redéploiement** :
- au prochain chargement de la page ;
- ou sous 5 minutes pour une partie déjà ouverte (interrogation existante de `/api/seasons/current`).

Le serveur recalcule le bonus Shard Magnet à partir du niveau de la relique enregistré dans la
sauvegarde, soit +1 à +5 fragments par coffre. Les anciennes sauvegardes, où les reliques sont
une liste, sont comprises (niveau 1).

Fichiers :
- `server/economy.js` (nouveau) : lecture bornée de la config, validation des saisies admin, bonus de relique.
- `server/chestShop.js` : coûts, multiplicateur et bonus via `economy.js`. La réponse indique le coût débité.
- `server/seasons.js` : `GET /api/seasons/current` → `config.economy`.
- `server/index.js` : `PUT /api/admin/config` répond 400 à une valeur économique hors bornes. L'achat de coffre renvoie `cost`.
- `public/js/balance.js` : `Balance.economy`, `applyEconomy()`, `scaleUpgradeCoins()`.
- `public/js/upgrades.js` : coût multiplié dans `Upgrades.getCost`, gain multiplié dans `getRewardMultiplier`.
- `public/js/main.js` : application à chaque réponse saison, puis redessin des améliorations, de la boutique et du gain du bloc. L'affichage des améliorations passe par `Upgrades.getCost`. Le tirage anonyme applique le multiplicateur de fragments.
- `public/admin/admin.js`, `public/admin/index.html` : libellés, `season_duration` retiré, erreurs de validation affichées.
- `test/economy.test.js` (nouveau) : 9 tests.

### 3. SHA et procédure de test technique

- **SHA sur `develop` : `5a35fa3`** (fusion `--no-ff` de `ee2340b`), identique au SHA déployé.
- Tests : `npm test` → 118/118, sur la branche, sur `develop` et sur la release `5a35fa3`.
  - `node --test test/economy.test.js` → 9/9 : bornes, valeurs invalides en base ignorées, Shard Magnet, tirage d'un coffre avec coût, multiplicateur et bonus, cohérence des valeurs client/serveur, application côté client, puis en HTTP un changement admin visible sans redémarrage et un achat de coffre au prix réglé.
- Essai navigateur sur un serveur de test (port 3101, base temporaire) :
  - après le passage de l'admin à ×2 coût, ×1,5 gain et coffre simple à 1 000, puis un rechargement : pioche 100 → 200, multiplicateur 1 → 1,5, boutique « 💰 1,000 » ;
  - après le retour à 1 et un `_pollSeason()` sans rechargement, l'interface revient à 100 et 2 000 ;
  - aucune erreur console sur ordinateur ni sur smartphone.

### 4. Vérifications, limites, données des joueurs

- **Données des joueurs :** aucune migration, aucune écriture.
  - Les réglages de production valaient déjà 1.0 et 2000/15000/80000 (vérifié en lecture seule) : **le jeu est strictement inchangé tant que l'admin ne les modifie pas.**
  - Empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` identiques à chaque contrôle : sur la copie de production avant et après démarrage, et en production avant et après le déploiement.
- Limite 1 : l'économie reste calculée dans le navigateur (risque P1 de l'audit, hors périmètre). Les multiplicateurs de coût et de gain ne sont donc appliqués que par le client. Seuls les coffres sont contrôlés par le serveur.
- Limite 2 : le **panel admin est désactivé en production** (`ADMIN_SECRET` absent, `/api/admin/*` répond 503). Les réglages ne peuvent donc pas être modifiés en production aujourd'hui. Voir la décision 1.
- Non vérifié : l'interface de l'admin dans un navigateur. La sauvegarde a été vérifiée par l'API, et le code de l'interface a seulement été relu.

### 5. Déploiement

- SHA déployé : **`5a35fa3`** (production précédente : `b64af44`).
- Contrôles avant déploiement :
  - release propre `npm ci` + `npm test` 118/118 ;
  - copie de la base de production démarrée en `NODE_ENV=production` sur le port 3122 : `/health` ok, version `1.0.0+5a35fa3`, `config.economy` neutre, empreintes identiques ;
  - copie supprimée.
- Sauvegarde vérifiée par `deploy.sh` : `~/backups/dig/dig-20261030-022331-pre-deploy-5a35fa3.sqlite`.
- Après déploiement :
  - les 2 domaines répondent 200 et `/api/version` = `1.0.0+5a35fa3` ;
  - journal sans erreur ;
  - `quick_check` ok ;
  - empreintes joueurs identiques à la sauvegarde pré-déploiement ;
  - essai Chromium sur dig.lodygames.com (1280×900 et 390×844) : pioche 100, coffres 2 000 / 15 000 / 80 000, multiplicateur 1, aucune erreur.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep b64af44 && sudo systemctl restart dig`. Les dépendances sont inchangées et il n'y a aucune migration à défaire.

### 6. Test fonctionnel à faire par le propriétaire

**Sans admin (possible tout de suite), environ 2 minutes :**
1. Ouvrir https://dig.lodygames.com et se connecter.
2. Onglet Améliorations : les prix sont inchangés (pioche niveau 1 → 2 : 100 pièces).
3. Boutique de saison : 2 000 / 15 000 / 80 000.
4. Casser un bloc : le gain correspond au gain affiché sous le bloc, comme avant.
5. Avec la relique Shard Magnet débloquée : un coffre qui donne des fragments en donne désormais +1 à +5 de plus selon le niveau de la relique.

**Avec l'admin (si tu l'actives, voir la décision 1) :**
1. Admin → « Économie & Joueurs » :
   - « Coût des upgrades » = 2 ;
   - « Gain de coins » = 2 ;
   - « Coffre simple » = 1000 ;
   - Enregistrer.
2. Recharger le jeu. Résultat attendu :
   - Améliorations : la pioche coûte 200 ;
   - le gain affiché sous le bloc est doublé ;
   - la boutique affiche 1 000 pour le coffre simple ;
   - l'achat débite exactement 1 000.
3. Saisir 0 ou 50 comme multiplicateur : message d'erreur, valeur non enregistrée.
4. Remettre 1 / 1 / 2000, puis recharger : tout revient comme avant.

### 7. Choix techniques faits seul

- **Appliquer plutôt que supprimer** les deux multiplicateurs. Ils existaient déjà dans l'admin avec leur libellé et valaient 1.0 en production : les activer ne change aucune règle tant que personne ne les modifie. C'est toi qui décides de toute variation.
- **Bornes 0.1–10** pour les multiplicateurs, qui reprennent les bornes déjà présentes dans le formulaire admin. Les coûts de coffre doivent être des entiers ≥ 1. Une valeur invalide déjà en base est ignorée (valeur par défaut) : une mauvaise saisie ne peut ni casser le jeu ni rendre un coffre gratuit.
- **`season_duration` retiré de l'interface** plutôt qu'appliqué : depuis #16, les saisons sont des semaines ISO, et une durée variable contredirait ce calendrier. La ligne en base est conservée.
- **Bonus de relique recalculé côté serveur** à partir du niveau sauvegardé, plutôt que de sauvegarder le cache `relicBonuses` qui serait falsifiable. Un test vérifie que la table du serveur est identique à `public/js/relics.js`.
- **Le multiplicateur de coût s'applique à toutes les améliorations payées en pièces**, y compris la boutique de fragments et le reroll. Elles sont toutes saisonnières et remises à zéro à chaque saison.
- **Pas de nouvelle requête** : les paramètres passent par `/api/seasons/current`, déjà interrogé au chargement et toutes les 5 minutes.

### 8. Décisions demandées au propriétaire

Aucune décision n'est nécessaire pour ce ticket. Une option :

1. **Activer le panel admin en production ?** Il faut définir `ADMIN_SECRET` (au moins 32 caractères) dans `/etc/dig/dig.env`, puis `sudo systemctl restart dig`. C'est une opération sur un secret : à faire par toi.
   - Option A : l'activer pour pouvoir régler l'économie sans redéploiement.
   - Option B : le laisser désactivé jusqu'au lancement.
   - Recommandation : **A** si tu veux tester le scénario « avec admin » ci-dessus. Sinon **B** : aucun risque, le jeu reste au réglage neutre.

### 9. Reste à faire

- Rien pour le périmètre du ticket.
- Suite possible, après lancement : faire calculer l'économie par le serveur (risque P1 de l'audit, à rattacher à #25 « progression serveur »). C'est seulement alors que les multiplicateurs de coût et de gain deviendront impossibles à contourner.
