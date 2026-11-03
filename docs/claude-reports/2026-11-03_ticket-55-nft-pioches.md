# Ticket #55 — [Idée long terme] NFT de pioches à édition limitée — portefeuille facultatif et mint

Lien : https://github.com/ReC82/Dig/issues/55

## Session du 03/11/2026 (DIGORCH) — étude de faisabilité, risques et options

### 1. État réel

**Étude livrée (ce rapport seul), intégrée dans `develop`, non déployée : rien ne change dans le
jeu.** Le ticket demande explicitement « rapporter faisabilité, risques et options seulement. Pas
de contrat blockchain, pas de mint, pas de vente ni de portefeuille imposé à ce stade ». Aucune
ligne de code, aucune table, aucun réglage, aucune dépendance n'a été ajouté. Aucun service
externe (nœud blockchain, fournisseur de portefeuille) n'a été contacté.

Classement : **Après lancement** (idée long terme ; le MVP public n'en a aucun besoin et le
ticket le dit lui-même).

**Conclusion courte :** techniquement faisable, mais **pas maintenant** et **pas sous la forme
« 500 exemplaires identiques vendus »**. Recommandation : (1) lancer d'abord des **pioches de
collection numérotées, hors blockchain, gagnées au mérite** (option A, réutilise #54, #56 et la
boutique #34) ; (2) ne reconsidérer un NFT qu'après des seuils d'audience mesurés et un avis
juridique écrit ; (3) si un jour NFT il y a, **réclamation gratuite** (pas de vente), pièces
**uniques et numérotées**, purement **cosmétiques**, portefeuille strictement facultatif.

### 2. Point de départ (vérifié dans le code de `develop` = production `2c77dfa`)

| Élément existant | Où | Utilité pour #55 |
|---|---|---|
| Saisons **hebdomadaires** (« Saison <semaine ISO> ») | `server/seasonCalendar.js`, `server/seasons.js` | « 500 par saison » = 500 **par semaine** ≈ 26 000 par an : ce n'est plus « très limité ». Il faut raisonner par **saison thématique** (#48) ou par mois (#56), pas par saison hebdomadaire. |
| Classement figé, immuable, déterministe (`season_standings`, triggers `RAISE(ABORT)`) avec `eligible`, `risk_level` | `server/db.js`, `server/standings.js` (#29, #25) | Source d'éligibilité fiable et rejouable : « premiers éligibles » = rang figé, jamais le classement vivant ni la vitesse de clic. |
| Boutique de cadeaux : **stock atomique** (`UPDATE … SET stock_remaining = stock_remaining - 1 WHERE … AND stock_remaining > 0`), `max_per_user`, clé d'idempotence `shop:<userId>:<requestId>`, remboursement + remise en stock une seule fois | `server/shop.js` (#34) | Exactement le mécanisme de quota « 500 exemplaires, concurrence atomique, limite par joueur, annulation » demandé : déjà écrit et testé. |
| Objets exclusifs d'événement, propriété serveur `monthly_event_finds(user_id, event_id, item_id)` | `server/monthlyEvents.js` (#56) | Modèle de « souvenir permanent » possédé côté serveur, déjà en production (désactivé). |
| Pioches spéciales du top saisonnier, table d'attribution proposée `pickaxe_grants` (idempotente, révocable sans suppression), une seule pioche active | rapport #54 | La « pioche limitée » de #55 est un cas particulier de #54 : une attribution numérotée. |
| Skins de pioche « doré » / « diamant » branchés sur l'affichage du bloc | `public/js/monetization.js` (achats simulés désactivés, #11) | Rendu cosmétique déjà disponible, sans effet de jeu. |
| Liaison d'un compte externe facultatif (OAuth PKCE), liaison/déliaison, historique, désactivé par défaut | `server/xLink.js` (#51) | Gabarit pour une liaison de portefeuille : opt-in, `…_links` + `…_history`, interrupteur `off`. |
| Comptes en production | base (lecture seule, agrégat) | **1 compte**. Un stock de 500 n'a aucun sens avant des centaines de joueurs actifs. |

### 3. Séparer les notions (exigence du ticket)

| Notion | Définition proposée | Effet sur le classement | Où vit la vérité |
|---|---|---|---|
| **Objet in-game** (pioche classique, niveau 1→15) | progression de saison, remise à 1 chaque lundi | oui (c'est le jeu) | sauvegarde + serveur |
| **Pioche de collection** (#54) | objet permanent attribué au mérite | aucun, ou ×1,1 dégâts sur un matériau rare (≤ 0,15 % de descente, #54) | serveur (`pickaxe_grants`) |
| **Édition limitée** | une pioche de collection avec un **numéro** (« n° 37 / 500 ») et un stock fini | **aucun** : strictement cosmétique (nom, apparence, numéro, cadre) | serveur |
| **Propriété NFT** (facultative, futur) | un jeton on-chain **miroir** d'une édition limitée déjà attribuée | aucun | la blockchain pour la propriété, le serveur pour l'affichage en jeu |
| **Cosmétique** | apparence (skin, cadre, pseudo) | aucun | serveur |
| **Bonus** | modification d'un chiffre de jeu | **interdit** pour toute édition limitée ou NFT | — |

Règle d'or proposée : **une édition limitée ou un NFT ne donne jamais de bonus**. Sinon
l'avantage serait achetable sur le marché secondaire (pay-to-win indirect) et la valeur du jeton
dépendrait de l'équilibrage, ce qui le rapproche d'un instrument financier (voir § 5).

### 4. Faisabilité technique d'un NFT (si un jour décidé)

**4.1 Chaîne et contrat**

- Chaîne compatible EVM à frais faibles (Polygon PoS, Base ou une autre couche 2) ; Ethereum
  principal exclu (frais de plusieurs euros à dizaines d'euros par mint).
- Contrat **ERC-721** standard audité (OpenZeppelin), une collection par saison thématique, avec
  `maxSupply` **gravé dans le contrat** (le quota ne dépend pas seulement du serveur), métadonnées
  figées (IPFS ou équivalent ; jamais une URL du serveur Dig qui pourrait changer).
- **« Lazy mint » par bon signé** (EIP-712) : le serveur signe un bon « joueur X peut réclamer
  l'édition n° N de la collection S, valable jusqu'à T » ; le **joueur** envoie la transaction
  depuis son portefeuille et paie les frais réseau. Le jeu ne dépense rien en gaz et ne détient
  **aucune clé privée de joueur**.
- Contrainte forte : le serveur détiendrait une **clé de signature** (le « minter »). Elle doit
  vivre hors du dossier de l'application, idéalement dans un coffre de clés (KMS/HSM) — ce qui
  suppose une ressource cloud, **interdite sans accord écrit** (règle AWS du projet). Une fuite
  de cette clé = mints frauduleux jusqu'au plafond du contrat ; prévoir rotation et pause du
  contrat (`Pausable`).
- Coût fixe : déploiement du contrat (quelques euros sur une couche 2), audit (le contrat
  standard réduit le besoin, mais une revue reste conseillée), fournisseur RPC (offre gratuite
  limitée, payante au-delà), stockage des métadonnées.

**4.2 Portefeuille facultatif (opt-in)**

- Liaison par **signature de message** « Sign-In with Ethereum » (EIP-4361) : le serveur émet un
  nonce à usage unique, le joueur signe, le serveur vérifie l'adresse. Aucune transaction, aucun
  frais, aucune clé transmise. Même structure que #51 : `user_wallet_links` (une adresse active
  par compte, unicité de l'adresse entre comptes), `wallet_link_history`, interrupteur
  `WALLET_LINK=off` par défaut.
- **Déliaison** libre à tout moment, sans effet sur la progression ; l'adresse est effacée de
  la base (historique : uniquement « lié/délié à telle date », sans l'adresse en clair après la
  déliaison, pour le RGPD — voir § 5).
- Le jeu **ne propose jamais** de créer ni de garder un portefeuille, ne demande jamais de phrase
  de récupération (message explicite dans l'interface : « Dig ne vous demandera jamais votre
  phrase secrète »).
- Erreurs à couvrir : signature refusée, mauvaise chaîne, portefeuille absent (mobile sans
  extension → WalletConnect, dépendance externe supplémentaire), nonce expiré, adresse déjà liée
  à un autre compte.

**4.3 Quota de 500, concurrence, anti-bot, limites**

- Le quota est **réservé côté serveur** avec le mécanisme existant de `server/shop.js` : décrément
  atomique du stock, `max_per_user = 1` par collection, clé d'idempotence ; la réservation donne
  un **numéro d'édition** et un bon signé valable 24–72 h ; non réclamé à l'échéance → numéro
  remis en stock une seule fois (même logique que l'annulation de la boutique). Le contrat refuse
  tout dépassement de `maxSupply` et tout bon déjà utilisé.
- Éligibilité **au mérite et vérifiée par le serveur**, jamais « premier arrivé » au clic :
  `season_standings.eligible = 1`, `risk_level < 3`, ≥ 20 blocs manuels validés (seuils #53/#54),
  ordre d'attribution = rang figé. Ainsi un bot rapide n'obtient rien de plus qu'un humain, et la
  course au mint (ruée, saturation du serveur) n'existe pas.
- Limites : 1 édition par joueur et par collection ; un compte suspect (#25) ne reçoit pas de bon.

**4.4 Preuve de propriété et transferts**

- Le NFT est transférable (c'est sa nature). En jeu, l'apparence suit le **possesseur actuel** :
  le serveur lit la propriété (`ownerOf`) pour les adresses liées, avec un cache (ex. 1 h) et un
  bouton « Actualiser ». Si le jeton part vers une adresse non liée, l'ancien possesseur perd
  l'apparence ; le nouveau la gagne en liant son portefeuille.
- Conséquence : **l'édition « hors blockchain » et l'édition NFT ne peuvent pas coexister pour le
  même numéro** sans règle claire. Proposition : l'édition serveur reste au joueur méritant
  (non transférable) ; le NFT est un **souvenir exportable** dont seule l'apparence « certifiée »
  (cadre, numéro on-chain) suit le jeton.
- Panne du fournisseur RPC : le jeu continue (cache conservé, aucune fonction de jeu n'en
  dépend).

**4.5 Remboursements et vérification du mint**

- Frais réseau payés par le joueur : **non remboursables** par nature ; à afficher avant la
  signature.
- Vérification : le serveur considère l'édition « mintée » à la lecture de l'événement
  `Transfer` du contrat (avec confirmations), pas à la déclaration du navigateur.
- S'il y avait une vente (déconseillé, § 6), il faudrait gérer le droit de rétractation, les
  remboursements en monnaie fiat et les échecs de mint après paiement : complexité forte.

### 5. Risques (réglementation, plateformes, données, réputation)

> Synthèse non juridique, à faire valider par un professionnel avant toute décision : les textes
> évoluent et leur application aux NFT de jeu est encore en cours de précision.

| Domaine | Risque | Niveau | Mesure proposée |
|---|---|---|---|
| **MiCA** (règlement UE 2023/1114 sur les crypto-actifs) | Les NFT **uniques et non fongibles** sont exclus, mais une émission **en grande série** ou de jetons **interchangeables** peut être requalifiée en crypto-actif soumis à MiCA (livre blanc, obligations d'émetteur). « 500 exemplaires identiques » est précisément le cas à risque. | **Élevé** si 500 identiques ; plus faible si chaque pièce est unique (numéro, attributs propres) et non vendue | Pièces uniques et numérotées ; pas de vente ; avis juridique écrit |
| **Prestataire de services sur crypto-actifs** (MiCA, FSMA en Belgique) | Garder des clés, échanger ou vendre pour le compte de joueurs = activité réglementée | Élevé si le jeu garde/échange ; faible en lazy mint auto-hébergé | Jamais de garde, jamais de place de marché propre |
| **Jeux de hasard** (Belgique : la Commission des jeux de hasard a jugé illégales les loot boxes payantes, 2018) | Un mint **payant à contenu aléatoire** (rareté tirée au sort) serait assimilable à un jeu de hasard | **Élevé** si payant + aléatoire | Jamais de mint aléatoire payant ; attribution au mérite, contenu connu |
| **Protection du consommateur** (CDR, contenus numériques) | Vente = information précontractuelle, droit de rétractation, garantie de conformité du contenu numérique ; « investissement » implicite = pratique trompeuse | Moyen à élevé si vente | Pas de vente ; aucune communication sur la « valeur » ou la revente |
| **Fiscalité** | Vente : TVA sur services électroniques (taux du pays du client, guichet OSS), revenus à déclarer ; redevances de revente | Moyen si vente | Pas de vente au départ ; sinon comptable |
| **RGPD** | Une adresse de portefeuille liée à un compte est une donnée personnelle ; la blockchain est **immuable** (droit à l'effacement impossible on-chain) | Moyen | Aucune donnée personnelle on-chain (ni pseudo ni identifiant Dig dans les métadonnées) ; adresse effaçable en base ; mention dans la page Confidentialité (#45/#51) |
| **Concours / récompenses** (#27) | Si l'édition est gagnée via le classement et a une valeur marchande, elle peut entrer dans le régime des concours/loteries publicitaires | Moyen | Conditions écrites, attribution au mérite déterministe (#29), cohérent avec #27 |
| **Plateformes** | Stores d'applications : Apple interdit qu'un NFT **débloque** des fonctions et impose ses achats intégrés ; Google Play encadre les actifs tokenisés (déclaration, pas de mécanique de type jeu d'argent). Réseaux sociaux : X interdit de récompenser des posts (#51). Le jeu est une PWA web : risque faible aujourd'hui, réel si une version store est envisagée | Faible (web) / élevé (store) | Cosmétique seulement ; aucune fonction débloquée par NFT ; pas de promotion « gagnez des NFT » sur X |
| **Sécurité** | Hameçonnage (faux sites « mint Dig »), clé de signature serveur, contrats malveillants imités | Moyen | Domaine unique, message « jamais de phrase secrète », clé en coffre, contrat pausable |
| **Réputation / communauté** | Une partie des joueurs rejette les NFT (spéculation, écologie) ; annonce mal reçue = départs | Moyen | Strictement facultatif, invisible pour qui ne lie pas de portefeuille, sondage avant |
| **Pay-to-win / inflation** | Achat de ressources du jeu contre argent réel → inflation (#49 : les pièces ne limitent déjà plus les joueurs réguliers) et avantage au classement | **Élevé** | **Aucun achat de ressources contre argent réel** (exigence du ticket) ; si un jour des gemmes sont vendues, seulement pour l'apparence et le confort (#49 § 5) |

### 6. Options comparées

| | **0. Rien pour l'instant** | **A. Collection limitée hors blockchain** (recommandée) | **B. A + export NFT gratuit plus tard** | **C. Mint NFT payant** |
|---|---|---|---|---|
| Ce que voit le joueur | — | « Pioche de saison n° 37 / 150 » dans la Collection, apparence unique, gagnée au mérite | idem + bouton facultatif « Certifier sur la blockchain » | page de mint, portefeuille, prix |
| Portefeuille | non | non | facultatif (SIWE) | requis pour le mint |
| Effet de jeu | — | aucun (cosmétique) | aucun | aucun (sinon pay-to-win) |
| Réglementation | aucune | faible (règlement du concours #27) | moyenne (MiCA à faire valider, RGPD) | **élevée** (MiCA, consommateur, TVA, hasard) |
| Coût | 0 | ≈ 2–3 jours de dev (réutilise #54/#34/#56) | A + ≈ 1–2 semaines + contrat + RPC + coffre de clés + avis juridique | B + paiement, rétractation, comptabilité |
| Réversible | — | oui (révocation sans suppression) | non pour la partie on-chain | non |
| Mesure de l'intérêt | non | **oui** (taux de réclamation, d'équipement, rétention) | oui | biaisée par la spéculation |

**Option A détaillée (MVP alternatif hors blockchain demandé par le ticket)** — non implémentée :

- Tables ajoutées (migration idempotente, aucune donnée existante touchée) :
  `limited_editions(id, season_theme, item_id, name_i18n, image, supply, minted, status)` et
  `limited_edition_grants(edition_id, serial, user_id, granted_at, reason, revoked_at, revoke_reason,
  UNIQUE(edition_id, serial), UNIQUE(edition_id, user_id))`.
- Attribution à la **clôture d'une saison thématique** (#48) ou d'un événement mensuel (#56),
  dans la même transaction que les points #33 : les N premiers éligibles du classement figé
  reçoivent les numéros 1…N dans l'ordre du rang ; idempotent (clôture rejouée = aucun doublon).
- Taille : **proportionnelle à l'audience** (ex. 10 % des éligibles, plafonnée à 150 puis 500
  quand l'audience le justifie), réglable dans l'admin, interrupteur `limited_editions_mode =
  off | preview | on` (défaut **off**, `preview` = l'admin voit qui recevrait quoi).
- Affichage : Collection → « Éditions limitées », tuile avec le numéro, l'apparence équipable via
  le mécanisme de skin existant, mention « non échangeable ».
- **Non transférable** en v1 (pas de marché, pas de fraude, pas de valeur marchande).
- Indicateurs pour décider d'aller plus loin : part des joueurs attribués qui **équipent** la
  pioche (> 50 % ?), rétention à J+7 des attribués vs non attribués, demandes spontanées
  d'échange ou d'export (via #57 retours de bêta).

**Seuils proposés avant de rouvrir la piste NFT** : au moins **500 joueurs actifs par saison
thématique** pendant 2 saisons (sinon le quota n'est pas « limité » mais vide), option A en ligne
depuis ≥ 2 mois avec des indicateurs positifs, avis juridique écrit (MiCA/FSMA, Commission des
jeux de hasard, consommateur), décision budgétaire (contrat, RPC, coffre de clés = ressource
cloud à autoriser).

### 7. SHA, branche et procédure de lecture

- Branche : `docs/55-etude-nft-pioches` ; SHA sur `develop` : voir le commentaire du ticket et le
  rapport de nuit (commit de fusion « Merge docs/55-etude-nft-pioches dans develop »).
- Rien à tester en jeu. Vérifier les éléments cités :
  `grep -n "stock_remaining - 1" server/shop.js` (stock atomique),
  `grep -n "monthly_event_finds" server/monthlyEvents.js` (propriété serveur),
  `grep -n "RAISE(ABORT" server/db.js` (classement figé immuable),
  `grep -n "seasonName" server/seasonCalendar.js` (saisons hebdomadaires).

### 8. Vérifications effectuées, limites, données des joueurs

- Lecture du ticket (aucun commentaire), des rapports #49, #51, #52, #54, #27 et du code cité.
- Comptage agrégé en lecture seule de la base de production (`users` = 1, `shop_items` = 0) ;
  aucune donnée personnelle consultée ni reproduite.
- `npm test` complet sur `develop` après fusion (documentation seule).
- Non fait (hors périmètre, conformément au ticket) : aucun contrat, aucun appel à une chaîne ou
  à un fournisseur RPC, aucune estimation de frais en temps réel (les ordres de grandeur sont
  indicatifs), aucune consultation juridique.
- **Impact sur les données des joueurs : aucun.**

### 9. Déploiement

**Non déployé, et sans objet** : un rapport seul ne change pas le jeu (règle : un commit de
rapport ne justifie pas un déploiement). Production inchangée (`2c77dfa`).
**Test fonctionnel à faire par le propriétaire : aucun en jeu** — lire les § 1, 6 et 10 (5 min)
et répondre aux décisions. Classement : **Après lancement**.

### 10. Choix faits seul

- Pas de code ni de prototype : le ticket l'interdit (« sans coder maintenant »).
- Raisonnement « par saison thématique / événement » et non « par saison hebdomadaire » : les
  saisons de Dig durent une semaine, 500 par semaine ne serait pas une édition limitée.
- Éligibilité au mérite plutôt que « premiers arrivés » : supprime la course au mint, l'avantage
  des bots et la charge serveur, et réutilise le classement figé #29.
- Réutilisation recommandée de `server/shop.js` (stock atomique) et du modèle #51 (liaison
  facultative désactivée par défaut) plutôt qu'un nouveau mécanisme.

### 11. Décisions demandées au propriétaire

1. **Direction** : (a) rien pour l'instant ; (b) **option A — pioches limitées numérotées hors
   blockchain, gagnées au mérite, cosmétiques** (recommandé, après le MVP et avec #54) ;
   (c) préparer directement un NFT. *Recommandation : (b), à planifier après le lancement.*
2. **Mode d'obtention** : (a) **au mérite uniquement** (classement figé, événements) (recommandé) ;
   (b) achat en gemmes gagnées en jeu ; (c) achat en argent réel (déconseillé : MiCA,
   consommateur, TVA, pay-to-win).
3. **Échange entre joueurs** des éditions hors blockchain : (a) **non en v1** (recommandé) ;
   (b) oui plus tard, via un échange contrôlé par le serveur.
4. **Taille** : remplacer « 500 par saison » par **un stock proportionnel aux joueurs actifs**
   (10 % des éligibles, plafond 150 puis 500) par **saison thématique ou événement**, pas par
   semaine. *Recommandé.*
5. **Piste NFT** : ne la rouvrir qu'aux seuils du § 6 (≥ 500 actifs par saison thématique, option
   A en ligne ≥ 2 mois, avis juridique écrit, budget validé) ; alors **réclamation gratuite**,
   pièces uniques, cosmétiques, portefeuille facultatif, jamais de garde de clés. *Recommandé.*

### 12. Éléments restant à réaliser

- Après décision 1 = (b) : ticket d'implémentation de l'option A (après #54, qui définit les
  pioches de collection, et #48 pour les saisons thématiques).
- Piste NFT : rien avant les seuils ; ensuite avis juridique, choix de chaîne, contrat standard,
  coffre de clés (ressource cloud à autoriser), liaison SIWE sur le modèle #51.
