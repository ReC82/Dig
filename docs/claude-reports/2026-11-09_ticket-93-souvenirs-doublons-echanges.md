# Ticket #93 — Souvenirs d'événements : doublons en inventaire et échanges sécurisés entre joueurs

Lien : https://github.com/ReC82/Dig/issues/93 — branche `feature/93-souvenirs-doublons-echanges`.

## 09/11/2026 — Audit, schéma, V1 serveur derrière drapeaux OFF

### 1. État réel

Voir la section « Déploiement » en bas (complétée après la mise en ligne). **Rien n'est activé** :
doubles OFF, échanges OFF, aucune règle de doubles enregistrée, aucun taux d'événement modifié,
aucun micro-bonus appliqué. Pour les joueurs, le jeu se comporte exactement comme avant.

Classement : **Après lancement** (aucun impact sur la bêta collègues du 09/11 ; rien à tester en jeu
tant que le propriétaire n'a pas tranché le barème).

### 2. Audit de l'existant

| Sujet | Constat |
|---|---|
| Schéma | `monthly_event_finds` (clé primaire joueur + événement + objet) : **un exemplaire par joueur et par type**, jamais supprimé (souvenir à vie, aussi après la fin ou un retour en brouillon). |
| Provenance des drops | Serveur uniquement, à la sauvegarde acceptée, sur les blocs **validés** (#38, bornés par la profondeur retenue #9/#25), tirage `crypto`, curseur par joueur/événement (rien de rétroactif), rafale > 2 000 blocs ignorée. |
| Saison vs événement | Les collections saisonnières (#39) vivent dans la sauvegarde cloud (`Collection.tryDrop` côté jeu + `collection_pity` côté serveur) : **hors périmètre** de ces doubles. Reliques et fragments : autres systèmes, non touchés. |
| Multi-session | Insertion `INSERT OR IGNORE` dans une transaction : deux onglets ou deux appareils ne peuvent pas créer deux découvertes. |
| Bonus (#81) | `server/souvenirBonus.js` modélise déjà la règle « un seul bonus par TYPE, quelle que soit la quantité » et un transfert ; rien n'est appliqué. |
| Données de production (lecture seule, 09/11) | 3 événements (Novembre actif, Noël planifié, un test terminé), **5 découvertes** au total, 3 curseurs. |
| Reset de test #75 / suppression de compte #90 | Les tables par joueur sont listées/archivées par nom de colonne `user_id` : les nouvelles tables utilisent `user_id` et sont ajoutées à l'état réinitialisable #75. |

### 3. Design V1 retenu (livré dans le code, OFF)

**Principe : la découverte n'est jamais déplacée.** `monthly_event_finds` reste inchangée et compte
pour un exemplaire ; les exemplaires supplémentaires sont des lignes à part. Aucune migration des
possessions existantes n'est nécessaire (rien n'est copié, rien n'est réécrit, rien ne peut être
dupliqué par une migration).

Nouvelles tables (ajout seul, idempotent, `server/souvenirInventory.js`) :

| Table | Rôle |
|---|---|
| `souvenir_copies` | Un exemplaire supplémentaire = une ligne : type (`événement/objet`), propriétaire actuel `user_id`, origine (`duplicate`), clé d'origine UNIQUE (`dup:<joueur>:<événement>:<objet>:<n>` → impossible de le créer deux fois), premier propriétaire, date de création (toujours pendant l'événement), date d'arrivée chez le propriétaire, réservation `trade_id`. |
| `souvenir_copy_log` | Historique de chaque exemplaire : création, réservation, libération, transfert, retour arrière admin. |
| `souvenir_inventory_versions` | Version d'inventaire par joueur (+1 à chaque changement). |
| `souvenir_settings` | `duplicates_enabled` = 0, `trades_enabled` = 0, durée d'une proposition 48 h, compte ≥ 7 jours, ≥ 500 blocs validés, 5 propositions en attente au plus, 10 échanges / 24 h au plus. |
| `souvenir_dup_rules` | Règle par événement (`*`) ou par objet : autorisé, facteur (0 à 1) appliqué à la chance de l'objet, exemplaires au plus par joueur (1 à 10). Table séparée : **ne modifie ni l'événement planifié ni ses révisions**. |
| `souvenir_trades` | Propositions d'échange : auteur, destinataire, exemplaire offert (réservé), type demandé, statut (`pending`, `completed`, `declined`, `cancelled`, `expired`, `countered`, `failed`, `rolled_back`), version, contre-proposition (`parent_id`), `request_id` unique par auteur. |
| `souvenir_admin_log` | Changements de réglages, de règles, retours arrière. |

Pour chaque type : quantité totale = découverte (0/1) + exemplaires supplémentaires ; réservée =
exemplaires bloqués par une proposition ; **échangeable = total − 1 − réservée** (le dernier exemplaire
ne part jamais) ; historique = journal ; version = version d'inventaire.

**Doubles** (`monthlyEvents.processSave`) : un objet déjà possédé n'est retiré que si le drapeau global
ET une règle autorisée existent. Chance par bloc = chance de l'objet × facteur ; au plus `maxCopies − 1`
doubles **créés** par joueur et par type (échanger ne permet pas de refarmer) ; au plus 3 doubles par
sauvegarde ; mêmes blocs validés, même curseur (aucun faux drop rétroactif). **Drapeau OFF : le code
passe exactement par les mêmes tirages qu'avant** (test : aucun appel supplémentaire au générateur).
Un type reçu par échange compte comme possédé : il n'est jamais « redécouvert ».

**Échanges** (1 exemplaire contre 1 exemplaire d'un **autre** type ; jamais contre pièces, gemmes ou
fragments ; aucune récompense de participation) :

1. A propose au pseudo de B : « mon double de X contre ton double de Y » → l'exemplaire X est **réservé**.
2. B accepte (transaction unique : revérifie statut, version, propriété, réservation, quantité ≥ 2 des
   deux côtés, limites, éligibilité ; échange les deux exemplaires) — ou refuse, ou **contre-propose**
   (« je te donne Y, mais contre Z ») — A peut annuler ; sans réponse : expiration à 48 h. Chaque
   clôture libère la réservation.
3. Double clic / rejeu / deux onglets : même `requestId` = même proposition ; une acceptation rejouée
   trouve l'échange conclu (409), rien n'est transféré deux fois ; version périmée → 409.
4. Auto-échange, même type, compte trop récent, minage insuffisant, suspension anti-bot active : refusés.
5. Admin : désactiver les échanges clôt aussitôt toutes les propositions et libère les exemplaires
   (rien n'est supprimé) ; **retour arrière** d'un échange conclu si les deux exemplaires sont toujours
   chez leurs receveurs ; **audit d'intégrité** (réservations orphelines, propositions sans réservation,
   créations au-delà du plafond) — doit toujours être vide.

**Souvenirs exclusifs après la fin du mois** : un exemplaire n'est créé que pendant l'événement ;
après, il ne peut que changer de main. Ma recommandation (comme celle du ticket) : **oui**, un joueur
absent en novembre peut recevoir par échange un authentique double acquis pendant l'événement (la date
de création est conservée et pourra être affichée).

**Bonus (#81)** : `souvenirInventory.quantities()` alimente `souvenirBonus.resolve()` : un bonus par
type, jamais multiplié par la quantité (testé) ; rien n'est appliqué.

### 4. Changements réalisés

- `server/souvenirInventory.js` (nouveau) : schéma, réglages, règles, inventaire, création de doubles,
  moteur d'échange, retour arrière, audit, simulation 10 000 profils.
- `server/monthlyEvents.js` : `init` crée les nouvelles tables ; `processSave` tire les doubles seulement
  si drapeau + règle ; `publicView` compte aussi les exemplaires reçus et ajoute `qty`/`tradeable`
  **uniquement au-delà de 1** (réponse identique pour tous les joueurs actuels).
- `server/index.js` : `GET /api/souvenirs/inventory` (lecture) ; `GET|POST /api/souvenirs/trades`,
  `POST /api/souvenirs/trades/:id/accept|decline|cancel|counter` (403 `trades_disabled` tant que OFF) ;
  admin `GET /api/admin/souvenirs`, `PUT /api/admin/souvenirs/settings` (activation = `confirm: true`),
  `PUT /api/admin/souvenirs/rules/:eventId/:itemId` (barème = `confirm: true`),
  `GET /api/admin/souvenirs/simulate/:eventId`, `POST /api/admin/souvenirs/trades/:id/rollback`.
- `server/testRuns.js` (#75) : nouvelles tables dans l'état du joueur ; `server/playerAdmin.js` (#90) : libellés.
- Jeu : badge `×N` sur la carte et « Possédé ×N · doublons ×(N−1) » dans la fiche (FR/EN/NL/ES),
  **jamais affiché à ×1** — donc invisible aujourd'hui.
- `test/souvenir-trades-93.test.js` (nouveau, 12 tests).

### 5. Simulation (10 000 joueurs, barème de Novembre, graine fixe)

Profils supposés (aucune donnée réelle suffisante : 3 joueurs en production) : occasionnel 50 %
(100 blocs/j, 10 j, profondeur 8), régulier 30 % (300/j, 20 j, prof. 25), assidu 15 % (800/j, 28 j,
prof. 50), acharné 5 % (2 000/j, 30 j, prof. 80). Valeurs : types distincts moyens / doubles moyens /
% ayant ≥ 1 double / % collection complète.

| Barème | Occasionnel | Régulier | Assidu | Acharné |
|---|---|---|---|---|
| Aucun double (actuel) | 16,5 / 0 / 0 % / 0 % | 29,3 / 0 / 0 % / 51 % | 30 / 0 / 0 % / 99,7 % | 30 / 0 / 0 % / 100 % |
| **A** facteur 0,05, max 2 | 16,5 / 0,8 / 56 % / 0 % | 29,3 / 7,5 / 100 % / 51 % | 30 / 19,6 / 100 % | 30 / 27,1 / 100 % |
| **B** facteur 0,1, max 3 | 16,5 / 1,7 / 80 % | 29,4 / 16,9 / 100 % | 30 / 43,6 / 100 % | 30 / 56,8 / 100 % |
| C facteur 0,2, max 3 | 16,5 / 3,3 / 96 % | 29,3 / 28,6 / 100 % | 30 / 53,6 | 30 / 59,6 |
| D facteur 0,1, max 5 | 16,6 / 1,6 / 81 % | 29,4 / 18,8 | 30 / 65,2 | 30 / 103,7 |

Lecture : avec les chances actuelles (0,03 % à 0,25 % par bloc), **les doubles abondent dès qu'un
joueur mine régulièrement** ; le plafond `maxCopies` est ce qui borne l'inventaire, bien plus que le
facteur. Les joueurs occasionnels (profondeur < 10) n'ont jamais les 7 épiques/légendaires et ne
complètent jamais : ce sont eux que l'échange aide. Les doubles ne changent pas la difficulté de
collection d'un joueur seul (types distincts identiques dans toutes les lignes).

### 6. Risques et limites

- **Comptes secondaires** : aucun système ne les détecte de façon fiable. Les garde-fous (compte ≥ 7 j,
  ≥ 500 blocs validés, pas de suspension, 10 échanges/24 h, 5 propositions en attente, objet contre
  objet uniquement) rendent le farm coûteux sans le rendre impossible. Comme aucune valeur économique
  ne circule, l'enjeu se limite à la collection (et au bonus #81 s'il est activé un jour).
- Pas encore d'**alertes** (échanges en boucle entre deux mêmes comptes) : à ajouter avec l'interface.
- Un reset de test #75 ou une suppression de compte #90 retire aussi les exemplaires reçus par ce
  compte (comptes de test seulement ; les échanges sont OFF).
- Interface d'échange joueur et écran admin dédié : **non faits** (API seulement, ci-dessous).

### 7. Choix techniques faits seul

1. Découverte jamais déplacée + exemplaires supplémentaires à part : aucune migration de données, et le
   « dernier exemplaire ne part jamais » est garanti par construction.
2. Règles de doubles dans une table séparée : l'événement planifié (Novembre, Noël) reste figé.
3. Plafond compté sur les doubles **créés** par le joueur (pas sur ceux possédés) : céder ne relance pas le farm.
4. Expiration traitée dans sa propre transaction ; une acceptation qui découvre un exemplaire disparu clôt
   l'échange (`failed`) sans rien transférer.
5. Visibilité des doubles d'un autre joueur : pas d'annuaire public dans cette V1 (la proposition se fait
   au pseudo, l'acceptation vérifie) — évite d'exposer les inventaires.

### 8. Décisions demandées au propriétaire

1. **Barème des doubles** (ne s'applique qu'à un événement choisi) — options : A (facteur 0,05, max 2 :
   un seul double échangeable par type), B (0,1, max 3), C/D plus généreux. **Recommandation : A**, tous
   objets y compris légendaires, d'abord sur **Noël** (pas sur Novembre en cours : ses joueurs
   n'auraient des doubles qu'à partir de l'activation).
2. **Conditions d'échange** : compte ≥ 7 jours, ≥ 500 blocs validés, 10 échanges/24 h, propositions
   valables 48 h. **Recommandation : garder ces valeurs** pour le lancement.
3. **Souvenir exclusif après la fin du mois** échangeable vers un joueur absent : **recommandation oui**
   (seulement des doubles authentiques créés pendant l'événement).
4. **Activation** : doubles puis échanges, séparément, après la bêta collègues. Rien n'est activé sans
   votre accord écrit.

### 9. Reste à réaliser (ordre proposé)

1. Écran admin « Souvenirs — doubles et échanges » (réglages, règles par événement/objet, simulation,
   journal, audit, retour arrière) — l'API existe.
2. Filtres joueur `À découvrir / Possédés / Doubles / Échangeables` (affichés seulement quand les doubles sont ON).
3. Interface d'échange joueur (invitation au pseudo, choix du double, contre-proposition, notifications après réussite).
4. Alertes anti-abus (paires récurrentes, comptes récents) et tableau de bord.
5. Activation sur un événement TEST, puis décision propriétaire.
