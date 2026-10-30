# Récompenses au mérite — étude internationale, mineurs, fournisseurs et remise (ticket #27)

> **Statut : étude technique documentée, sans valeur d'avis juridique.** Rédigée le 30 octobre 2026
> à partir de sources publiques (textes, notes de cabinets d'avocats, autorités) à la suite de la
> décision du propriétaire du même jour (concours au mérite, points de récompense saisonniers
> échangeables contre des cadeaux ; pas de restriction « 18 ans » ni « Belgique uniquement » sans
> justification). **Avis juridique externe recommandé avant tout lancement de récompense réelle.**
>
> Le verrou est maintenu : **aucune récompense de valeur réelle n'est activée ni annoncée** tant
> que la conformité et le règlement ne sont pas validés par le propriétaire. Les récompenses
> purement virtuelles et les simulations restent possibles.

Complète `docs/CONCOURS-CONFORMITE.md` (cadrage belge) et `docs/REGLEMENT-CONCOURS.md` (projet de
règlement). Tickets concernés : #33 (points), #34 (boutique), #30 (admin), #31 (interface), #28
(identité), #25 (anti-bot), #32 (équilibrage Chance).

## 1. Synthèse

1. **Le mérite règle l'essentiel du problème international.** Dans les pays étudiés, l'interdiction
   ou l'encadrement lourd vise surtout le **hasard** (loteries, tirages) et/ou la **mise payante**.
   Une attribution **déterministe au classement**, **gratuite** et **sans achat qui améliore le
   classement** est un concours d'adresse/de performance, licite en principe en Belgique, en
   France, aux Pays-Bas, en Allemagne, au Royaume-Uni, au Canada (Québec compris depuis 2023) et
   dans la grande majorité des États américains. **Exception connue : l'Italie**, où même un
   concours au mérite à but promotionnel est une « manifestazione a premio » soumise à déclaration
   ministérielle et garantie (§ 3).
2. **Il n'existe pas de règle « 18 ans » ou « Belgique » imposée par la loi pour un concours
   gratuit au mérite.** Les seuils d'âge **justifiés** sont : l'âge du consentement numérique
   (13 à 16 ans selon le pays, RGPD art. 8 ; 13 ans aux États-Unis, COPPA), la **majorité civile**
   (capacité à accepter seul un règlement et à recevoir un bien), et les **conditions des
   fournisseurs** de cartes cadeaux (Amazon : utilisation par un mineur avec l'implication d'un
   parent). D'où la proposition : **pas d'âge minimal pour jouer et gagner des points** ;
   **échange contre un cadeau réel par un mineur seulement avec l'accord vérifié de son
   représentant légal, le cadeau étant remis à ce dernier** (§ 4).
3. **Le territoire se gère par une liste blanche de pays vérifiés**, pas par une restriction
   arbitraire : le jeu reste mondial ; les points s'accumulent partout ; l'**échange contre un
   cadeau réel** n'est ouvert qu'aux résidents d'un pays inscrit dans l'annexe du règlement après
   vérification (droit local + disponibilité du cadeau + livraison). Liste initiale proposée :
   **Belgique, France, Luxembourg, Pays-Bas, Allemagne** (vérification documentaire faite pour
   BE/FR/NL/DE ; LU à confirmer), puis Royaume-Uni, Canada, États-Unis après relecture (§ 3).
4. **Deux régimes distincts** (§ 2) : les **récompenses purement virtuelles** (sans valeur
   monétaire, non transférables) peuvent être ouvertes à tous dès maintenant ; les **points
   convertibles en biens de valeur réelle** restent sous verrou jusqu'à validation.
5. **Fournisseurs** : une carte Amazon n'est utilisable que sur le site Amazon du pays émetteur ;
   pour un public international, prévoir un **catalogue par pays** ou un **agrégateur** de cartes
   cadeaux multi-pays (Tango Card, Tremendous… : comparaison à faire), sans engagement de dépense
   sans accord du propriétaire (§ 5).

## 2. Récompenses virtuelles et points convertibles — deux régimes

| | **A. Récompenses purement virtuelles** | **B. Points convertibles en biens de valeur réelle** |
|---|---|---|
| Exemples | titres, badges, cosmétiques, cadres de profil, gemmes/pièces du jeu | carte cadeau, objet physique, bon d'achat |
| Valeur | aucune valeur monétaire, non transférables, non convertibles | les points acquièrent une valeur économique indirecte |
| Qualification | pas de « gain » au sens des loteries/jeux de hasard tant qu'aucun achat ne permet de les obtenir ni de les revendre ; droit de la consommation (transparence) | **concours** si l'attribution est au mérite ; sinon loterie (BE : interdite même gratuite) |
| Âge | aucune restriction légale ; ergonomie et RGPD habituels du jeu | mineurs : accord du représentant légal pour l'échange (§ 4) |
| Territoire | monde entier | pays de la liste blanche (§ 3) |
| Données | celles du jeu | + identité/adresse/contact du bénéficiaire, au moment de l'échange seulement |
| Statut | **activable** après décision métier sur le barème (#33) | **verrouillé** jusqu'aux conditions du § 7 |

Règles communes indispensables pour que la formule reste un **concours** et non une loterie :

- **Attribution déterministe** des points (rang figé à la clôture, départage sans tirage) ; pas de
  « points bonus aléatoires ».
- **Aucun hasard dans la boutique** : pas de boîte mystère, de coffre ou de roue contre des points
  convertibles. Une boîte mystère contenant un bien réel serait une loterie (BE) ; payante, un jeu
  de hasard (loot box, avis de la Commission des jeux de hasard, 2018).
- **Pas d'achat de points** ni de bonus payant qui améliore le classement (sinon « payer pour
  gagner », pratique déloyale ; et réévaluation jeux de hasard si le jeu contient du hasard).
  Aujourd'hui sans objet : achats intégrés désactivés (#11), publicité récompensée simulée.
- **Pas de transfert de points entre joueurs** ni de conversion en argent (évite marché
  secondaire, valeur monétaire et fraude multi-comptes).
- **Part du hasard dans le classement limitée** : la profondeur dépend surtout de l'effort, des
  améliorations et du temps ; les éléments aléatoires du jeu (coffres, blocs, « Chance ») doivent
  rester accessoires (#32). À documenter dans le règlement (« le classement dépend de la
  performance de jeu ; les éléments aléatoires du jeu sont identiques pour tous »).
- **Mesure fiable** : profondeur validée par le serveur (#9, #25 lots A+B) avant toute valeur
  réelle.

## 3. Territoires

Principe : un concours en ligne accessible partout peut être soumis au droit de **chaque pays
dont les résidents sont visés** (langue, devise, lots proposés). Le règlement doit donc dire où
l'échange contre un cadeau réel est ouvert. Méthode proposée : **liste blanche** dans une annexe du
règlement, enrichie pays par pays après vérification ; partout ailleurs, le joueur garde ses
points et peut utiliser les récompenses virtuelles. Pays sous sanctions internationales (UE/ONU)
exclus de toute remise de bien.

| Pays | Concours gratuit au mérite | Points à retenir | Proposition |
|---|---|---|---|
| **Belgique** | Licite (pas de hasard → pas de loterie, art. 534 nouveau Code pénal ; pas d'enjeu → hors loi 1999) | Conditions accessibles et non équivoques (CDE livre XII) ; pas de pratique déloyale (livre VI) ; règlement en FR/NL (EN utile) | Liste initiale |
| **France** | Licite : la loterie prohibée (CSI art. L322-1 s.) suppose hasard **et** participation financière ; un concours sans hasard n'en est pas une | Règlement accessible gratuitement ; dépôt chez commissaire de justice non obligatoire pour un concours gratuit (usage pour les gros lots) ; FR obligatoire | Liste initiale |
| **Pays-Bas** | Licite : une « prijsvraag » de performance n'est pas un « kansspel » ; le code de conduite des jeux promotionnels (GPK) vise les jeux de **hasard** | Bonne pratique tirée du GPK : accord parental pour les moins de 16 ans, prudence envers les mineurs ; NL | Liste initiale |
| **Luxembourg** | Pas de vérification spécifique faite | À vérifier (cadre proche de BE/FR présumé, non confirmé) | Liste initiale **après vérification** |
| **Allemagne** | Licite : concours d'adresse gratuit hors GlüStV ; transparence des conditions (UWG) | Mineurs : § 107 BGB (accord des parents sauf acte « purement avantageux » — débattu pour l'acceptation d'un règlement) ; pratique courante : accord écrit des parents ; DE | Liste initiale (version DE du règlement à prévoir ou EN accepté à vérifier) |
| **Italie** | **Encadré** : concours promotionnels (DPR 430/2001), même au mérite : déclaration préalable au ministère (MIMIT, « Prema on-line »), garantie couvrant les lots, procès-verbal de clôture, serveur de collecte en Italie selon la pratique | Lourd pour 5 € | **Exclue** au départ |
| **Royaume-Uni** | Licite : le Gambling Act 2005 ne vise les concours que si l'entrée est payante ; gratuit = hors champ. Code CAP section 8 (promotions) | Conditions claires, éviter qu'un concours sans réelle difficulté soit requalifié en loterie ; mineurs : prudence, accord parental pour < 16 dans la pratique | Après relecture |
| **Canada** | Licite : le Code criminel (art. 206) vise le hasard ; un concours de pure habileté gratuit n'y tombe pas. **Québec : régime des concours publicitaires abrogé le 27/10/2023** (plus d'enregistrement ni de droits) ; restent la Loi sur la protection du consommateur, la Loi sur la concurrence et le français | Prix aux mineurs : remise au parent par usage | Après relecture |
| **États-Unis** | Concours d'adresse gratuit licite dans la grande majorité des États (règles d'État variables pour les concours **payants**) | **COPPA** : collecte de données d'enfants < 13 ans soumise à accord parental vérifiable ; prix aux mineurs remis au parent ; mention « nul là où interdit » | Après relecture |
| Autres | Non étudiés | — | Fermés à l'échange réel |

## 4. Mineurs

### 4.1 Seuils d'âge justifiés (et seulement ceux-là)

| Seuil | Source | Effet proposé |
|---|---|---|
| Âge du consentement numérique : **13 ans** (BE, UK), **14** (IT, ES), **15** (FR), **16** (NL, DE, LU, IE) — à confirmer pays par pays | RGPD art. 8 ; lois nationales (BE : loi du 30/07/2018, art. 7) | En dessous : les traitements fondés sur le consentement (e-mail de contact facultatif, notifications) exigent l'accord du titulaire de l'autorité parentale |
| **13 ans** aux États-Unis | COPPA | Pas de collecte de données personnelles d'un enfant < 13 ans sans accord parental vérifiable |
| **Majorité civile** (18 ans dans les pays de la liste) | Droit civil (capacité) | Un mineur ne peut pas valablement seul accepter un règlement engageant ni recevoir un bien de valeur → **accord et remise via le représentant légal** |
| Conditions Amazon | Conditions d'utilisation Amazon : un mineur utilise les services « avec l'implication d'un parent ou tuteur » | Le code est remis au représentant légal |

Aucun de ces seuils n'impose d'exclure les mineurs du **jeu** ni du **gain de points**.

### 4.2 Proposition (à valider)

1. Jeu, classement, points et récompenses **virtuelles** : ouverts à tous, sans âge minimal
   spécifique au concours (les règles générales du jeu s'appliquent).
2. Échange de points contre une récompense **réelle** :
   - joueur majeur : déclaration de majorité et de pays de résidence à l'échange ;
   - joueur mineur : **accord du représentant légal** recueilli à l'échange (e-mail du parent
     confirmé par lien, acceptation du règlement en son nom) ; le cadeau est **envoyé au
     représentant légal** ;
   - en dessous de l'âge du consentement numérique (ou < 13 ans aux États-Unis) : même procédure,
     sans aucune donnée supplémentaire de l'enfant ; seules les données du parent sont collectées.
3. Pas de vérification d'identité intrusive : déclaration sur l'honneur, contrôle proportionné
   uniquement en cas de doute ou au-delà d'un montant cumulé (à fixer) ; aucune copie de pièce
   d'identité conservée.
4. Protection : pas de communication incitative envers les enfants (« dépêche-toi, plus que 2 h »),
   pas de pression au temps de jeu dans les messages de récompense ; limites de lots par période
   (anti-accaparement, anti-multi-comptes).

## 5. Fournisseurs de cartes cadeaux

- **Amazon** : chaque carte est liée au **site du pays émetteur** (une carte Amazon.com n'est pas
  utilisable sur un autre site Amazon ; logique identique présumée pour Amazon.com.be, page de
  conditions belge **inaccessible (erreur 503) lors des deux consultations du 30/10/2026**, à
  relire). Utilisation sous les conditions des cartes cadeaux du site (pas de revente, pas
  d'échange contre de l'argent). Mineurs : implication d'un parent. Mentions obligatoires d'usage :
  « Amazon n'est ni organisateur, ni parrain, ni partenaire », pas de logo. Les conditions
  « Corporate » d'Amazon s'adressent aux entreprises : si l'organisateur est une personne
  physique, acheter des cartes au détail et conserver les factures.
- **Catalogue par pays** (#34) : un article = un fournisseur + un pays + une devise ; l'échange
  n'est proposé que si le pays du joueur correspond.
- **Agrégateurs multi-pays** (Tango Card, Tremendous, Giftbit…) : couverture de nombreux pays
  annoncée, conditions propres à chaque marque ; frais, KYC de l'organisateur et conditions sur
  les destinataires (mineurs, pays) **à comparer avant toute souscription** — dépense externe
  soumise à accord du propriétaire.
- Récompenses non monétaires (objets à l'effigie du jeu) : frais de port et douane, à éviter au
  départ.

## 6. Données personnelles et modalités de remise

- **Minimisation par étape** : pseudonyme + points pour le classement ; e-mail vérifié du compte
  (#28) ; **au moment de l'échange seulement** : pays de résidence, déclaration de majorité ou
  e-mail du représentant légal ; aucune adresse postale tant que les lots sont numériques.
- Base légale : exécution du règlement (art. 6.1.b) pour l'échange et la remise ; consentement
  parental (art. 8) quand le traitement repose sur le consentement d'un enfant sous le seuil
  national ; obligation légale pour les pièces comptables.
- **Remise** : code envoyé en privé (e-mail vérifié du joueur majeur ou du représentant légal),
  jamais affiché publiquement ni journalisé en clair (#30) ; statut de commande visible dans le
  jeu ; délai annoncé ; procédure de réclamation ; code non remplacé s'il a été divulgué par le
  bénéficiaire.
- Conservation : données de l'échange et preuve de remise **12 mois** après la remise, puis
  suppression ; journaux de points sans donnée personnelle directe.
- Transferts hors UE : si un agrégateur non européen est utilisé, vérifier le cadre de transfert
  (clauses contractuelles types / décision d'adéquation).
- **Notice vie privée** du jeu nécessaire avant toute activation (absente aujourd'hui).
- Fiscalité : lots de faible valeur sans incidence pratique pour le bénéficiaire dans les pays de
  la liste ; aux États-Unis, déclaration seulement au-delà de 600 $ par an et par bénéficiaire ;
  côté organisateur, dépense de promotion à documenter (à confirmer par un comptable).

## 7. Conditions d'activation des récompenses réelles (mise à jour)

1. Décision métier sur le barème des points (#33) et le catalogue (#34) — barème illustratif non
   appliqué sans décision.
2. Avis juridique externe sur ce document et le règlement (recommandé), ou acceptation écrite du
   risque par le propriétaire.
3. Identité de l'organisateur dans le règlement (nom/dénomination, adresse, n° BCE éventuel,
   e-mail de contact).
4. Liste blanche initiale des pays validée par le propriétaire (proposition : BE, FR, NL, DE ; LU
   après vérification).
5. Procédure mineurs validée (accord et remise au représentant légal).
6. Notice vie privée publiée ; règlement publié dans les langues des pays ouverts.
7. #25 lots A+B, #28, #30, #33, #34 livrés et recettés ; aucun achat ni bonus payant n'influence
   le classement.
8. Fournisseur de cartes choisi et premier budget approuvé par le propriétaire.

## 8. Sources consultées (30 octobre 2026)

- Belgique : voir `docs/CONCOURS-CONFORMITE.md` § 5 (nouveau Code pénal art. 534-537, loi du
  7 mai 1999, doctrine).
- France : Code de la sécurité intérieure, art. L322-1 s. ; Code de la consommation, art. L121-36 ;
  Me A. Bem, « Règlementation et conditions de légalité des loteries et des jeux-concours »,
  Legavox ; Squire Patton Boggs, « Réforme en cours du CSI et du Code de la consommation ».
- Pays-Bas : Gedragscode Promotionele Kansspelen (révision au 1/1/2014), CMS, « Gewijzigde
  gedragscode promotionele kansspelen » ; Emerce.
- Allemagne : § 107 BGB (buzer.de, lexetius.com) ; exemples de conditions de participation
  (VR Bank, « Hinweis zum Minderjährigenschutz bei Gewinnspielen », 2023).
- Italie : DPR 430/2001 ; MIMIT, « Concorsi a premio — sanzioni e controlli » ; Leggioggi,
  « Concorsi a premio : una disciplina da rivedere ? ».
- Royaume-Uni : Gambling Act 2005 s. 14 et annexe 2 ; ASA/CAP, « Promotional marketing:
  lotteries » ; Pinsent Masons, « Running a competition ».
- Canada/Québec : BLG, Blakes, Lavery, Gowling WLG (abrogation du régime des concours
  publicitaires au 27 octobre 2023).
- États-Unis : COPPA ; Venable, « Sweepstakes, contests and other types of giveaways » (2022) ;
  National Law Review, « Practical guide to offering online contests and promotions ».
- RGPD art. 8 et seuils nationaux : Bird & Bird, « Children in the digital world » (tableau UE).
- Amazon : conditions des cartes cadeaux Amazon.com (restrictions, usage sur le site émetteur),
  conditions « Corporate Gift Card » ; Amazon.com.be inaccessible (503).
- Agrégateurs : pages publiques Tango Card (« International rewards ») ; comparatif GIFQ (2026).
