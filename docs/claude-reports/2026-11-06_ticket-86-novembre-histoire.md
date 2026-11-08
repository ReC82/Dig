# Ticket #86 — Novembre 2026 : 30 souvenirs « Novembre déterre l'Histoire » en brouillon, images provisoires, boosts limités

Lien : https://github.com/ReC82/Dig/issues/86 — session du 06/11/2026 (≈ 22 h, Bruxelles). Pris en compte : le corps du ticket et le [rectificatif du propriétaire du 06/11](https://github.com/ReC82/Dig/issues/86) (bonus **permanents tant que le souvenir est possédé**, constants ou calendaires, jamais 15 minutes, aucun bonus actif).

## 1. État réel

**Déployé en production (SHA `8a26e0b`) — en attente de recette.** L'événement est créé en **brouillon** dans Admin → 🎉 Événements, avec ses 30 fiches. **Rien n'est publié ni activé** : aucun drop, aucun bonus, aucune image, aucune annonce, et les joueurs ne voient rien. Aucune dépense IA.

Classement : **Après lancement.** C'est du contenu d'événement : le MVP public et la bêta du 09/11 (#84) n'en dépendent pas.

## 2. Résultat et changements

**Ce qui existe maintenant en production**
- Admin → 🎉 Événements → **« 🏛️ Novembre déterre l'Histoire »** : brouillon, public, du 01/11/2026 00:00 au 01/12/2026 00:00, heure de Bruxelles. La fin exclue équivaut au 30/11 à 23:59:59 inclus.
- **30 fiches**, une par date du 01 au 30/11, dans l'ordre. Chaque ligne de la liste affiche l'emoji provisoire (30 emojis distincts), le nom, « 09/11 · nov26_09_brique_liberte », l'état de l'image (« Sans image »), la rareté, le taux proposé, les langues (FR/EN/NL/ES toutes vertes) et l'état actif.
- **La fiche d'un objet** contient :
  - les nouveaux champs **Date de référence** (MM-JJ) et **Inspiration** (le fait historique, visible en admin seulement) ;
  - les noms et descriptions dans les 4 langues ;
  - la **consigne d'image** en anglais (le brief du ticket, avec garde-fous ajoutés : ni nom, ni slogan, ni drapeau, ni emblème officiel) ;
  - le bouton **« 🎨 Créer une image avec l'IA »**. Il ouvre la fiche de l'objet dans 🎨 Icônes (cible stable `event:novembre_histoire_2026/<objet>`) ; ensuite, une image par clic sur « Générer » (atelier #40/#65).
- Tout reste éditable : noms, histoires, raretés, emojis, images, taux, dates. Chaque enregistrement crée une révision restaurable.

**Le moteur (pour tous les mois suivants)**
- `server/monthlyEvents.js` :
  - **40 objets au plus** par événement (12 avant) ; un mois peut en prévoir moins ;
  - 2 colonnes **ajoutées** à `monthly_event_items` : `ref_date` et `inspiration`. La migration est en ajout seul et idempotente ;
  - ces colonnes ne sont **jamais** envoyées au joueur ;
  - la date de référence est **une inspiration, pas une condition de drop** : chaque objet reste trouvable pendant tout l'événement. Un invité du 09/11 peut donc trouver les objets du 01 au 08.
- **Importation groupée réutilisable** : Admin → Événements → ＋ Ajouter → **« 📥 Importer un fichier JSON »**.
  - Le fichier suit le même format que `server/content/events/*.json`.
  - Il est enregistré en brouillon, après une confirmation qui annonce le nombre d'objets.
  - Le statut du fichier est ignoré.
  - Il est **refusé si l'identifiant existe** (409) : aucun écrasement.
  - Modèle à copier : `server/content/events/novembre-histoire-2026.json`.
- **Contenu préparé** `server/content/events/novembre-histoire-2026.json` : importé une seule fois au démarrage (comme Noël). Un événement déjà présent n'est jamais remplacé.
- **Calendrier des micro-bonus (#81, toujours en brouillon)** :
  - nouveau critère **« Jours du mois »** : `1-7` = première semaine de chaque mois. Il se combine avec les jours de la semaine, les mois et les dates (heure de Bruxelles, bornes incluses) ;
  - aperçu **« prochain créneau le 01/12/2026 »** ou **« jusqu'au 07/11/2026 inclus »**. Le calcul avance jour civil par jour civil, sans effet des changements d'heure ;
  - le jeu ne reçoit toujours **aucun** bonus : `GameState.eventBonuses` reste vide.
- **Simulateur** `tools/balance/november-event-sim.js` : il réutilise le simulateur économique #49, qui tourne avec le vrai code du jeu (blocs, PV, pioche, Auto-Dig, reliques, saisons hebdomadaires qui remettent la profondeur à 1). Le tirage reproduit celui du serveur.
- Tests : `test/november-event-86.test.js` (8 tests).

## 3. SHA, branche, procédure de test

- Branche `feature/86-novembre-histoire`, commit `84ca712`. **SHA sur develop : `8a26e0b`** (merge `--no-ff`), **déployé**.
- `node --test test/november-event-86.test.js` → 8/8. Le fichier couvre :
  - le contenu : 30 objets, dates 01→30, identifiants, emojis et consignes distincts, 4 langues non tronquées, répartition 5/9/9/5/2 ;
  - l'import : unique, en brouillon, sans écrasement ;
  - en brouillon : aucun drop (même avec un tirage forcé), rien de visible ;
  - aucune fuite de la date de référence ni de l'inspiration côté joueur ;
  - la limite de 40 objets et le format MM-JJ ;
  - la migration sur une ancienne table ;
  - le calendrier : jours du mois, prochain créneau, jeudi après le passage à l'heure d'été 2027 ;
  - les contrôles statiques du panel et le simulateur, déterministe.
- `npm test` complet : **880/880** sur la branche, sur develop `8a26e0b` et sur la release `8a26e0b`.
- Simulations : `node tools/balance/november-event-sim.js --runs 10000` (≈ 7 min) et `node tools/balance/november-event-sim.js --bonus`.

## 4. Vérifications, limites, données

- **Chromium** sur une copie de la base de production (port 3101, transport IA simulé), en 1280×900 et 390×844 :
  - la fiche de l'événement montre **30 lignes** ;
  - les objets **01, 09, 11, 23 et 30** ont été ouverts : date de référence, inspiration, « Sans image » et bouton d'image présents ;
  - **modification du nom puis abandon** : la ligne garde son nom ;
  - 0 erreur JS, 0 boîte native.
- Production après déploiement : le jeu se charge sans erreur JS en 1280 et en 390 px.
- **Données des joueurs** : aucune lue ni écrite. Sont ajoutés seulement : 2 colonnes, 1 événement brouillon (30 objets), 1 révision et 1 ligne de méta. Les empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` sont **identiques** avant et après, sur la copie comme en production. Les 3 souvenirs de l'événement TEST et le brouillon de Noël sont intacts.
- **Vérification des faits** (connaissances, sans navigation web) : dates confirmées pour Voyager 1 (12/11/1980), Einstein (25/11/1915), Nobel (27/11/1895) et les autres. Deux formulations sont précisées dans l'inspiration :
  - **Carter**, 26/11/1922 : il ouvre une brèche et **aperçoit** l'antichambre ; l'entrée complète a lieu le lendemain ;
  - **Hubble** : formulation du ticket conservée (article du NYT du 23/11/1924, présentation formelle en 1925).
- **Ton** : les objets restent humoristiques. Le 11/11 (coquelicot) garde un texte sobre, comme le ticket le prévoit. Aucune citation n'est attribuée à une personnalité.
- **Non fait** : aucune image générée (aucune dépense) ; aucune planification ; aucun bonus créé dans ✨ Micro-bonus. Les traductions EN/NL/ES sont écrites à la main, à relire par le propriétaire si besoin.

## 5. Déploiement

- SHA déployé : **`8a26e0b`** (avant : `b37e232`). Sauvegarde vérifiée : `~/backups/dig/dig-20261106-221157-pre-deploy-8a26e0b.sqlite`.
- Release : `npm ci` puis `npm test` 880/880.
- Copie de production démarrée en mode production (port 3122) : `/health` et `/api/version` OK, empreintes identiques, brouillon importé, `quick_check` ok. La copie a été supprimée.
- Aucune génération IA n'était en cours (dernier appel de l'atelier à 11:52 UTC).
- `main` a été avancé en avance rapide de `b37e232` à `8a26e0b`. `deploy.sh` : santé et version OK.
- Après le déploiement :
  - les deux domaines répondent 200 avec `1.0.0+8a26e0b` ;
  - le journal contient seulement la ligne « événement préparé … ajouté en brouillon » ;
  - `quick_check` ok, empreintes identiques à la sauvegarde ;
  - `/api/events` ne mentionne pas novembre.
- **Retour arrière** : `git -C /home/ubuntu/Dig reset --keep b37e232`, puis `sudo systemctl restart dig` (lock inchangé). L'ancien code ignore les 2 colonnes ajoutées et liste le brouillon normalement (12 objets max seulement à l'enregistrement).

**Test fonctionnel à faire par le propriétaire** (5 min, ne rien planifier) :
1. Ouvrez /admin/ avec Ctrl+F5, puis **🎉 Événements**. **Attendu** : la ligne « 🏛️ Novembre déterre l'Histoire », Brouillon, Public.
2. Ouvrez-la. **Attendu** : les onglets FR/EN/NL/ES sont verts, avec l'avertissement « déjà commencée : il reste 24 j ». La liste « Objets exclusifs » compte **30 lignes**, de « 01/11 · nov26_01_echelle_michel_ange » à « 30/11 · nov26_30_noeud_churchill ».
3. Cliquez sur **09/11 La brique de la liberté**. **Attendu** :
   - Épique, date de référence `11-09`, inspiration « 1989 : chute du mur de Berlin » ;
   - texte dans les 4 langues ;
   - « 🖼 Sans image », avec le bouton « 🎨 Créer une image avec l'IA ».
   
   Vérifiez de même 01, 11, 23 et 30.
4. Modifiez un nom, puis **Annuler**, puis « Abandonner ». **Attendu** : le nom d'origine reste. Ne cliquez pas sur « Planifier ».
5. Facultatif, sans dépense : cliquez sur « 🎨 Créer une image avec l'IA ». **Attendu** : 🎨 Icônes s'ouvre sur l'objet avec la consigne préremplie. Ne cliquez pas sur « Générer » (1 image payante par clic), sauf si vous le souhaitez.
6. Jeu → Collection : **aucun** événement de novembre n'est visible.

## 6. Choix techniques faits seul

- **Identifiant `novembre_histoire_2026`** au lieu de `novembre-histoire-2026` : le format stable de #56 n'accepte pas le tiret. Les objets s'appellent `nov26_<jour>_<nom>`.
- **Objets « activés », événement en brouillon** : en brouillon, aucun drop n'est possible (c'est testé). Désactiver les 30 objets aurait demandé 30 clics le jour de la publication, sans gain de sécurité. Une planification publique exige de toute façon deux confirmations (« barème validé » et « publication validée par le propriétaire »).
- **Raretés** : les 5 raretés du ticket existent déjà dans #56 (commun, peu commun, rare, épique, légendaire). Aucun nouvel enum.
- **Date de référence et inspiration** : stockées dans des colonnes à part, réservées à l'admin. Les mettre dans la consigne d'image aurait poussé l'IA à représenter des personnes réelles.
- **Le taux par objet est obligatoire dans le modèle #56.** Le fichier contient donc la **proposition** du § 8, simulée, sans aucun effet tant que rien n'est planifié.
- Aucun bonus de souvenir n'est enregistré, même en brouillon : les variantes ne sont décrites qu'ici.

## 7. Simulations

### 7.1 Drops — barème proposé

Barème : commun 0,25 %, peu commun 0,15 %, rare 0,08 %, épique 0,05 % (dès 10 m), légendaire 0,03 % (dès 20 m), par bloc validé, tous les blocs. 10 000 parcours de novembre par profil, sur le vrai code du jeu et la rotation hebdomadaire. Le simulateur ne lit pas les données de la production. Il utilise les profils de jeu du #49, faute d'historique de minage suffisant (3 comptes).

| Profil | Blocs validés en novembre (médiane) | Jour 1 | Jour 5 | Jour 15 | Jour 22 | Jour 30 | Collection complète | commun | peu-commun | rare | epique | legendaire |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Occasionnel (20 min/j, 4 j/7) | 1596 | 3.7 obj. (0.2 h) | 7.7 obj. (1 h) | 17.1 obj. (2.9 h) | 20.6 obj. (4.2 h) | 23.1 obj. (5.7 h) | **< 1 %** | 98 % | 91 % | 72 % | 54 % | 36 % |
| Invité du 09/11 (1 h/j, 22 jours) | 3813 | 8.9 obj. (1 h) | 17.3 obj. (5 h) | 26.3 obj. (15 h) | 28.2 obj. (22 h) | — | **13 %** | > 99 % | > 99 % | 95 % | 85 % | 68 % |
| Régulier (1 h/j) | 5412 | 8.9 obj. (1 h) | 17.3 obj. (5 h) | 26.3 obj. (15 h) | 28.2 obj. (22 h) | 29.1 obj. (30 h) | **40 %** | 100 % | > 99 % | 99 % | 93 % | 80 % |
| Assidu (3 h/j + 4 h onglet) | 13818 | 13.3 obj. (3 h) | 23.2 obj. (15 h) | 29.4 obj. (45 h) | 29.8 obj. (66 h) | 30.0 obj. (90 h) | **96 %** | 100 % | 100 % | 100 % | > 99 % | 98 % |
| Auto-Dig (15 min/j + 8 h onglet) | 3768 | 3.5 obj. (0.3 h) | 13.2 obj. (1.3 h) | 23.5 obj. (3.8 h) | 26.4 obj. (5.5 h) | 28.1 obj. (7.5 h) | **11 %** | > 99 % | > 99 % | 95 % | 84 % | 67 % |

- Le rythme correspond à l'objectif « engageant sans complétion garantie » : **≈ 9 objets après 1 h, 17 après 5 h, 26 après 15 h**.
- Un **invité du 09/11** qui joue 1 h par jour finit avec ≈ 28 objets sur 30, et 13 % ont tout. Les objets des dates passées restent trouvables.
- Un joueur occasionnel (≈ 6 h dans le mois) obtient ≈ 23 objets, sans complétion.
- Un joueur assidu finit à 96 %.
- Autres réglages possibles : `--scale 1.5` (plus généreux) ou `--scale 0.7`.

### 7.2 Bonus de souvenirs — poids cumulé (aucun n'est actif)

Mesure : avantage en **blocs détruits à nombre de coups égal**, pour un collectionneur au plafond. Le classement #73 compte les blocs manuels. Calcul exact du simulateur #81 sur le catalogue publié.


#### Constante : +0,01 par souvenir, toujours actif, cumul plafonné à +0,10

| Profondeur | 1 dégât de base | 2 dégâts de base | 5 dégâts de base | 10 dégâts de base |
|---|---|---|---|---|
| 10 m | +7.66 % | +3.88 % | +0 % | +0 % |
| 30 m | +9.38 % | +4.67 % | +1.83 % | +1.4 % |
| 60 m | +9.69 % | +4.64 % | +1.71 % | +0 % |
| 100 m | +9.88 % | +4.97 % | +1.54 % | +0.58 % |

#### Calendaire : +0,03 par souvenir, le jeudi seulement, cumul plafonné à +0,30

| Profondeur | 1 dégât de base | 2 dégâts de base | 5 dégâts de base | 10 dégâts de base |
|---|---|---|---|---|
| 10 m | +25.63 % le jeudi · +3.66 % / semaine | +14.03 % le jeudi · +2.00 % / semaine | +0 % le jeudi · +0.00 % / semaine | +0 % le jeudi · +0.00 % / semaine |
| 30 m | +29.3 % le jeudi · +4.19 % / semaine | +13.82 % le jeudi · +1.97 % / semaine | +5.39 % le jeudi · +0.77 % / semaine | +2.48 % le jeudi · +0.35 % / semaine |
| 60 m | +29.74 % le jeudi · +4.25 % / semaine | +14.67 % le jeudi · +2.10 % / semaine | +5.79 % le jeudi · +0.83 % / semaine | +2.5 % le jeudi · +0.36 % / semaine |
| 100 m | +29.79 % le jeudi · +4.26 % / semaine | +14.72 % le jeudi · +2.10 % / semaine | +5.54 % le jeudi · +0.79 % / semaine | +1.91 % le jeudi · +0.27 % / semaine |

**Lecture**
- Un dégât fractionnaire ne pèse qu'**en début de partie** (1–2 dégâts de base). Au-delà de 5 dégâts, l'effet devient presque nul.
- Mais chaque saison remet la profondeur à 1 : le début de partie revient chaque semaine. Variante constante plafonnée à +0,10 : jusqu'à **+10 % de blocs** pour un vétéran face à un nouveau joueur sans souvenir. C'est trop pour un classement au mérite.
- Variante calendaire : jusqu'à +30 % le jeudi, soit ≈ +4 % en moyenne sur la semaine. C'est plus visible et moins durable, mais concentré sur une journée.

**Plafonds anti-pay-to-win proposés** (avant toute validation)
1. **Plafond global du cumul** de tous les souvenirs : +0,05 dégât en permanence, ou +0,10 le jeudi. Cela donne ≤ +5 % de blocs en début de partie, ≈ +1,4 % sur la semaine pour la variante calendaire.
2. **Le bonus ne s'applique pas** pendant les 2 premiers jours d'une saison. Au choix : il ne compte pas au classement, ou il ne vaut qu'au-delà de 50 m. Le départ reste égal.
3. **Rattrapage gratuit** : les souvenirs d'un événement passé restent trouvables plus tard (chance réduite, « Histoire » rejouée en novembre 2027, ou boutique contre des points de mérite #33, jamais contre de l'argent).
4. **Aucun bonus achetable**, et aucun lien avec le lot de fragments (#85).
5. **Avant toute activation, un développement dédié est nécessaire** : ajouter `STACK_CAP` au plafond anti-bot `MAX_CLICK_DAMAGE` (#81/#25/#77) et transmettre les bonus possédés par le serveur.

## 8. Décisions demandées au propriétaire

1. **Barème des drops** : valider la proposition du § 7.1 (commun 0,25 % → légendaire 0,03 %), ou la rendre plus généreuse (× 1,5) ou plus rare (× 0,7). *Recommandation : la proposition telle quelle.*
2. **Publication** : l'événement a déjà commencé. Planifier signifie des drops à partir du moment du clic, sans rétroactivité. Options : (a) planifier lundi 09/11 au matin, après votre recette et la bêta #84 ; (b) le garder pour plus tard en changeant les dates ; (c) ne pas le publier. *Recommandation : (a), avec les emojis provisoires. Les images pourront être publiées plus tard (« Publier les images »).*
3. **Bonus des souvenirs** : (A) constant +0,01 par souvenir, cumul plafonné ; (B) calendaire +0,03 le jeudi, cumul plafonné ; (C) **aucun effet de jeu** pour novembre, souvenir purement honorifique. *Recommandation : C pour novembre. Si un bonus est voulu : B avec un plafond global de +0,10 le jeudi et le départ de saison protégé (plafonds 1–2), à développer dans un ticket dédié.*
4. **Textes** : relire les traductions EN/NL/ES et les descriptions, si besoin. Les noms et descriptions FR sont ceux du ticket ; seule la description du 19/11 met « réseau indisponible » entre guillemets.

## 9. Restant à réaliser

- **Après lancement** :
  - planification selon la décision 2 ;
  - images : un clic par objet dans 🎨 Icônes (au choix du propriétaire, payant) ;
  - si la décision 3 est A ou B : transmission serveur des bonus possédés, `STACK_CAP` anti-bot, textes joueur, plafonds ;
  - éventuellement un bouton « Exporter en JSON » dans la fiche, pour préparer le mois suivant à partir du mois en cours.

---

# Mise à jour du 08/11/2026 (≈ 18 h 30, Bruxelles) — « Pourquoi cet objet ? » et confirmation de publication lisible

Ticket : [#86](https://github.com/ReC82/Dig/issues/86). Pris en compte : les commentaires du propriétaire du 08/11 ([décision de lancement](https://github.com/ReC82/Dig/issues/86#issuecomment-6719899583), [feu vert](https://github.com/ReC82/Dig/issues/86#issuecomment-6720004334), [rectificatif sur la fenêtre de publication et ajout éducatif](https://github.com/ReC82/Dig/issues/86#issuecomment-6720078814), [publication sans clic admin](https://github.com/ReC82/Dig/issues/86#issuecomment-6722405932)) et la [coordination #56](https://github.com/ReC82/Dig/issues/86#issuecomment-6723177145).

## 1. État réel

**Déployé en production (SHA `ce0a4db`) — en attente de recette.**

- **Novembre est réellement actif en production.** La publication a été faite par #56 (`fdf90ee`), via la décision écrite `issue56-novembre-histoire-2026-planifie`, le 08/11 à 16 h 10 (heure de Bruxelles). Vérifié après ce déploiement :
  - en base : `scheduled`, révision 7, du 31/10 23:01 UTC au 30/11 23:00 UTC, soit **du 1er novembre 00 h 01 au 30 novembre 23 h 59 (heure de Bruxelles)** ;
  - API publique `/api/events` : événement **actif**, 30 objets ;
  - 2 souvenirs de novembre déjà trouvés par des joueurs, qui restent acquis.
- Ce déploiement **ne republie rien** et ne modifie pas l'événement : même statut, même révision, mêmes chances.
- Il ajoute deux choses :
  1. **l'explication éducative « Pourquoi cet objet ? »** des 30 souvenirs ;
  2. **la confirmation de publication lisible**, qui servira aux prochains événements.

Classement : **Après lancement** (contenu éducatif et ergonomie de l'admin). Rien de bloquant pour le MVP ni pour la bêta du 09/11.

## 2. Résultat et changements

**Côté joueur — fiche d'un souvenir trouvé** (Collection → Novembre → clic sur un objet trouvé), sous la description humoristique :
- **« Pourquoi cet objet ? »** (traduit en FR/EN/NL/ES, et IT pour le pilote #59) ;
- 📅 la date historique (« 17 novembre 1558 », ou « Chaque année le 13 novembre » pour une journée mondiale) ;
- 1 à 3 phrases factuelles ;
- un lien **📖 Source : Wikipédia — …**, qui s'ouvre dans un nouvel onglet (https uniquement, `noopener noreferrer`). Il n'est jamais nécessaire de l'ouvrir pour jouer.
- **Objet non trouvé** : rien n'est envoyé par le serveur. La fiche reste « Objet non découvert » / « ??? ».
- **Explication non cochée « Vérifiée »** : invisible des joueurs.
- **L'inspiration admin** n'est toujours jamais envoyée au joueur.

**Côté admin** (🎉 Événements → Novembre) :
- **nouvelle colonne « Pourquoi ? »** dans le tableau des objets : ✅ Vérifiée, 📝 À vérifier ou ⚠ Absente. Le tableau de préparation signale aussi « N « Pourquoi cet objet ? » sans source vérifiée ».
- **Fiche objet → section « 📖 Pourquoi cet objet ? »** :
  - champs : explication (dans la langue choisie avec FR/EN/NL/ES), date historique, adresse de la source (https), titre de la source, case « Vérifiée — montrée aux joueurs », bouton « Ouvrir la source ↗ » ;
  - **« 💾 Enregistrer l'explication »** enregistre tout de suite. Cela fonctionne **même quand l'événement est planifié** (fiche en lecture seule), sans révision et sans effet sur les drops ;
  - fermer la fiche avec une saisie non enregistrée demande confirmation.
- **Confirmation « 🗓️ Planifier… » d'un événement public**, refaite selon la demande du 08/11. **Étape 1 sur 2** : une liste courte :
  - nom et identifiant ;
  - Public ;
  - période « du 01/11/2026 00:01 au 30/11/2026 23:59 inclus (heure de Bruxelles) » ;
  - nombre d'objets par rareté ;
  - nombre d'objets affichant l'emoji provisoire, « aucune génération IA n'est lancée » ;
  - nombre d'explications vérifiées ;
  - « 🚫 Aucun bonus : ni bonus permanent, ni bonus temporaire, ni effet sur le minage ou le classement » ;
  - « Effet immédiat… sans attribution rétroactive » ;
  - « Réversible : « Repasser en brouillon » arrête les futurs drops ; les souvenirs déjà trouvés restent acquis ».

  Les 30 objets sont dans un tableau **replié** « Voir les 30 objet(s) — date, nom, rareté, chance » (une ligne par objet, défilement interne). Le focus est sur **Annuler**. **Étape 2 sur 2** : barème par rareté sur une ligne, bouton « 🗓️ Publier pour tous ». Un clic sur Annuler, Échap ou le fond, à l'une ou l'autre étape : rien n'est publié.

**Contenu des 30 explications**
- Fichier : `server/content/event-lore/novembre_histoire_2026.json`, rédigé sans IA payante.
- Chaque fait a été **relu le 08/11 sur la source citée** : Wikipédia FR, Wikipédia EN quand la page FR ne donnait pas la date (Moby-Dick, Hubble, relativité générale, Journée de la gentillesse, indépendance albanaise) et UNESCO pour la Journée de la science.
- Les **30 liens répondent HTTP 200**. Aucune adresse n'a été inventée : chaque lien provient de l'API Wikipédia ou d'un contrôle direct.
- Écarts corrigés par rapport aux inspirations :
  - **Sixtine** : la fresque a été inaugurée le **31 octobre 1512**, la veille de la Toussaint. La date historique est donc 1512-10-31 ; la date de référence de l'objet reste 01/11 ;
  - **Toutânkhamon** : l'entrée a été découverte le 4/11 et la porte percée le **26/11** ; les deux dates sont citées ;
  - **Tchaïkovski** : le 6/11 est une date du calendrier grégorien, précisé dans le texte ;
  - **Conspiration des poudres** : le complot visait l'ouverture du Parlement du 5/11/1605.

**Technique**
- Table **ajoutée** `monthly_event_item_lore` (ajout seul, idempotente), séparée de la fiche de l'événement : la fiche planifiée n'est jamais réécrite. Journal : `lore_update` et `lore_import`.
- Import au démarrage : **seulement pour les objets sans explication**. Une saisie admin n'est jamais écrasée. Au déploiement : « 30 explication(s) ajoutée(s) ».
- Route `PUT /api/admin/events/:id/items/:itemId/lore` (admin). La vue joueur `publicView` n'ajoute `lore` qu'à un objet **trouvé** et **vérifié**.
- Fichiers : `server/monthlyEvents.js`, `server/index.js`, `server/content/event-lore/novembre_histoire_2026.json`, `public/js/main.js`, `public/index.html`, `public/css/style.css`, `public/js/i18n.js`, `i18n/it.json` + `public/js/locales/it.js`, `public/admin/admin.js`, `public/admin/index.html`, `public/admin/admin.css`, `test/event-lore-86.test.js` (nouveau), `test/admin-unsaved.test.js`.

## 3. SHA et procédure de test

- Branche `feature/86-novembre-histoire` : commit `070e3bb`. Sur `develop` : merge `ce0a4db` (déployé).
- `npm test` → 968/968 sur la branche, sur `develop` et sur la release `ce0a4db`. Le nouveau fichier `test/event-lore-86.test.js` contient 8 tests :
  - les 30 explications : 4 langues, 1 à 3 phrases, https Wikipédia/UNESCO, date cohérente avec la date de référence et avec l'année de l'inspiration ;
  - la validation : http, `javascript:`, identifiants dans l'URL ou date libre sont refusés ; « Vérifiée » exige les 4 langues et la source ;
  - l'import une seule fois, sans écraser une saisie admin ;
  - l'édition sur un événement planifié : pas de révision, statut inchangé ;
  - la vue joueur : rien avant découverte, rien si non vérifiée, jamais l'inspiration ; le souvenir garde son explication après la fin ;
  - aucun effet sur les drops ;
  - la migration idempotente ;
  - la présence des éléments du panel et du jeu.

## 4. Vérifications effectuées

- **Navigateur Chromium sur une copie de la base de production** (port 3101, copie supprimée ensuite), avec un compte de test créé dans la copie, qui possède 2 souvenirs :
  - Collection : 30 cartes, « 2 / 30 trouvé(s) » ;
  - fiche « La couronne d'Élisabeth » avec l'explication, la date et le lien Wikipédia (nouvel onglet, noopener) en **FR à 1280 px, NL à 390 px, ES à 320 px** ;
  - objet non trouvé : « Objet non découvert », sans explication ;
  - après F5, les 2 souvenirs sont toujours là ;
  - 0 erreur JS.
- **Admin à 1280, 390 et 320 px** :
  - fenêtre de publication lisible, tableau fermé par défaut, 30 lignes, aucun débordement de page, focus sur Annuler ;
  - Annuler à l'étape 1 puis à l'étape 2 : l'événement reste en brouillon ;
  - sur l'événement planifié : nom et chances verrouillés, explication modifiable ; http refusé ; enregistrement en brouillon puis vérifié ; garde-fou de fermeture ; statut `scheduled` et révision inchangés.
  - Pour cet essai seulement, novembre a été repassé en brouillon **dans la copie** puis replanifié. Aucune action de ce type n'a été faite en production.
- **Non vérifié** : le clic réel « Publier pour tous » d'un nouvel événement public en production (aucun à publier aujourd'hui). Décembre (Noël) est déjà planifié par #56.

## 5. Données des joueurs

Aucune donnée joueur modifiée. Seules une table et des lignes d'explication ont été ajoutées. Empreintes (lignes + hachage) de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` : **identiques** sur la copie avant et après démarrage, et identiques entre la production après déploiement et la sauvegarde pré-déploiement. Les souvenirs déjà trouvés sont conservés.

## 6. Déploiement

- SHA déployé : **`ce0a4db`** (avance rapide de `main` `b565fd9` → `ce0a4db`, `scripts/deploy.sh` de la release).
- Sauvegarde vérifiée : `~/backups/dig/dig-20261108-183128-pre-deploy-ce0a4db.sqlite`.
- Après déploiement :
  - les 2 domaines répondent 200 avec la version `1.0.0+ce0a4db` ;
  - journal sans erreur ;
  - `quick_check` ok ;
  - 30/30 explications en base ;
  - novembre `scheduled` rév. 7 ;
  - `/api/events` : actif, 30 objets, aucune explication envoyée sans compte ;
  - jeu chargé sans erreur JS à 1280 et 390 px.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep b565fd9` puis `sudo systemctl restart dig`. La table ajoutée est simplement ignorée par l'ancien code.

**Test fonctionnel pour le propriétaire (2 minutes)**
1. En jeu, connecté : **Collection → « 🏛️ Novembre déterre l'Histoire »**. Résultat attendu : 30 cartes et le compteur « n / 30 trouvé(s) ».
2. Cliquez un **objet trouvé**. Résultat attendu, sous la description drôle : « Pourquoi cet objet ? », la date, 1 à 3 phrases et « 📖 Source : Wikipédia — … ↗ », qui s'ouvre dans un nouvel onglet.
3. Cliquez une carte **« ? »**. Résultat attendu : « Objet non découvert », sans explication.
4. Changez de langue (EN/NL/ES). Résultat attendu : l'explication est traduite.
5. Admin → 🎉 Événements → Novembre → colonne **« Pourquoi ? »**. Résultat attendu : ✅ Vérifiée ×30. Ouvrez « La couronne d'Élisabeth » → section 📖. Résultat attendu : le texte, la date 1558-11-17 et le lien sont modifiables, et « 💾 Enregistrer l'explication » fonctionne alors que l'événement est planifié.
6. La nouvelle fenêtre « Planifier… » ne peut se voir que sur un événement en brouillon (par exemple un événement TEST). **Ne repassez pas novembre en brouillon** : cela arrêterait les drops.

## 7. Choix techniques faits seul

- **Table séparée** pour les explications, et non des colonnes dans la fiche. La fiche d'un événement planifié est figée (la modifier imposerait de repasser en brouillon, donc d'arrêter les drops). Le propriétaire veut pourtant compléter les sources sans bloquer la publication.
- **Date historique distincte de la date de référence**. Exemple : la Sixtine, inaugurée le 31/10 pour un objet du 01/11. Format : AAAA-MM-JJ, ou MM-JJ pour une journée annuelle.
- **Sources Wikipédia EN** quand l'article FR ne contient pas la date exacte. Le titre de la source l'indique : « Wikipedia (EN) ».
- La confirmation est en **deux étapes conservées**, pour éviter une publication accidentelle. La période est affichée avec la dernière minute incluse (« 30/11 23:59 inclus ») au lieu de la fin exclusive « 01/12 00:00 ».

## 8. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire pour ce lot. Les questions précédentes restent à trancher plus tard, sans bloquer :
1. **Bonus des souvenirs** : non activés, conformément à la décision du 08/11 (« aucun bonus permanent/conditionnel »). Recommandation inchangée : C (aucun effet) pour novembre.

## 9. Éléments restant à réaliser

- **Pour #56** :
  - le libellé joueur « Jusqu'au 1 décembre 2026 » affiché sous le titre de l'événement (fin exclusive) pourrait devenir « jusqu'au 30 novembre, 23 h 59 » ;
  - l'avertissement admin « Début dans moins de 7 jours : annonce tardive » reste affiché sur un événement déjà commencé.

  Ces deux points sont signalés, pas modifiés ici (périmètre #56).
- Les images définitives des 30 objets se feront par clic du propriétaire dans l'atelier (#65 / #89). La proposition « La brique de la liberté » n'a pas été touchée.
- Explications des prochains mois : même mécanisme. Il suffit d'ajouter un fichier dans `server/content/event-lore/`, ou de les saisir dans la fiche objet.
