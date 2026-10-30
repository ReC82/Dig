# Concours hebdomadaire — cadrage légal belge (ticket #27)

> **Statut : verdict technique documenté, sans valeur d'avis juridique.** Ce document a été rédigé
> à partir de sources publiques (textes de loi, notes d'avocats belges, organisations
> professionnelles) le 30 octobre 2026. Il doit être relu par un avocat belge (droit des jeux de
> hasard et de la consommation) avant toute attribution d'un prix réel.
>
> Tant que ce cadrage n'est pas validé par le propriétaire : **aucune annonce publique, aucune
> promesse de carte cadeau et aucun prix réel**. Les simulations techniques restent autorisées.

> **Mise à jour du 30/10/2026 — décision du propriétaire** ([commentaire](https://github.com/ReC82/Dig/issues/27#issuecomment-6520561353)) :
> la formule **concours au mérite** est retenue, **sans tirage au sort**, sous forme de **points
> de récompense saisonniers** attribués selon le classement et échangeables contre des cadeaux
> (#33, #34). Les restrictions « 18 ans minimum » et « Belgique uniquement » proposées ci-dessous
> **ne sont pas retenues comme règles** : elles sont remplacées par l'étude
> `docs/CONCOURS-INTERNATIONAL-MINEURS.md` (territoires par liste blanche, procédure mineurs
> justifiée, fournisseurs, données, remise ; récompenses virtuelles et points convertibles
> distingués). Les §§ 2.5, 2.6, 3 et 4 sont mis à jour en conséquence. Le verrou reste en place.

> **Décision du propriétaire — 30/10/2026, 12 h 09 et 12 h 20** ([décision](https://github.com/ReC82/Dig/issues/27#issuecomment-6521207300), [statut](https://github.com/ReC82/Dig/issues/27#issuecomment-6521405115)) :
> **jeu mondial, États-Unis inclus**, sans restriction de pays ni d'âge dans le gameplay, les
> classements, les points saisonniers et l'interface de la boutique. Les questions juridiques
> (pays ouverts, procédure mineurs, organisateur, avis juridique, fournisseur) **ne bloquent plus
> le développement** de #29, #30, #31, #33 et #34 et ne sont plus posées pour l'instant. Pas de
> géoblocage ni de barrière 18+ globale codés par défaut ; une **configuration d'éligibilité des
> cadeaux réels** est prévue mais reste désactivée. **Limite conservée** : cadeaux de valeur réelle
> et envoi de codes **désactivés** jusqu'à une décision explicite d'activation et la vérification
> des obligations applicables (§ « Conditions d'activation ») ; aucune annonce d'échanges réels ; le
> faible montant des lots n'est pas une exemption acquise. Ce ticket devient une **vérification
> différée avant activation**.

## 1. Verdict

| Formule | Qualification probable en Belgique | Verdict |
|---|---|---|
| **Tirage au sort pondéré par la profondeur** (formule des tickets #29/#31 : chance = profondeur / somme des profondeurs), même gratuit | **Loterie** : opération offerte au public, gain attribué par le sort. Le poids ne supprime pas le hasard, il le module. | **Non autorisé** pour un organisateur privé. À garder en **simulation uniquement**. |
| Même tirage, avec achat, gemmes payantes, pub récompensée réelle ou bonus achetable qui augmente le poids | Loterie **et** jeu de hasard avec enjeu (loi du 7 mai 1999) sans licence | **Interdit**. |
| **Concours au mérite** : le lot va au joueur classé premier de la saison hebdomadaire selon la profondeur **validée par le serveur**, départage déterministe, participation gratuite, sans achat | **Concours** (aucun hasard dans la désignation, aucun enjeu) | **Possible**, sous les conditions du § 4. **Formule recommandée.** |
| Tirage au sort organisé avec une ASBL autorisée ou avec la Loterie Nationale | Loterie autorisée | Hors de portée d'un jeu commercial ; non retenu. |

En une phrase : **en Belgique, un tirage au sort gratuit reste une loterie interdite** ; seul un
gagnant désigné par la performance (sans hasard) est envisageable pour Dig.

## 2. Analyse

### 2.1 Loteries — Code pénal

- Ancien Code pénal, art. 301 à 304 : est une loterie « toute opération offerte au public et
  destinée à procurer un gain par la voie du sort » ; l'organisation, la vente de billets et la
  publicité pour une loterie non autorisée sont punissables.
- **Nouveau Code pénal (loi de 2024, en vigueur depuis le 1er septembre 2026 après report du
  8 avril 2026)** : la même définition est reprise à l'**art. 534** (« loteries illégales » : toutes
  opérations offertes au public, destinées à procurer un gain par la voie du sort et non autorisées
  par ou en vertu de la loi) ; l'organisation (art. 535), la diffusion de billets (art. 536) et la
  **publicité** (art. 537) sont punissables (peine de niveau 1, infraction intentionnelle).
- La définition **ne contient pas d'enjeu** (de mise). Les notes d'avocats et d'organisations
  professionnelles belges récentes concluent toutes dans le même sens : « ook volledig gratis
  loterijen zijn verboden » (Caluwaerts Uytterhoeven, 2023), un tirage au sort sur les réseaux
  sociaux est une loterie interdite (Barreau de Liège-Huy, 2021 ; Lexing, 2022 ; UNIZO, 2024-2026).
  Seules exceptions : loteries autorisées (Loterie Nationale ; loteries d'ASBL au but
  philanthropique autorisées en vertu de la loi du 31 décembre 1851).
- Une ancienne doctrine (2003) admettait les « jeux de hasard gratuits » ; elle visait la loi de
  1999 (qui exige un enjeu) et non l'interdiction pénale des loteries. Elle n'est pas retenue.

Application à Dig : la formule « 100/300/600 m → 10/30/60 % » désigne le gagnant **par le sort**.
Le mérite n'intervient que dans le poids ; le joueur le plus profond peut perdre et un joueur à
1 m peut gagner. C'est la définition même d'une loterie.

### 2.2 Jeux de hasard — loi du 7 mai 1999

- Un jeu de hasard suppose trois éléments cumulatifs : un **enjeu de quelque nature que ce soit**,
  un gain ou une perte, et le hasard (même accessoire) dans le déroulement, la désignation du
  gagnant ou le gain. Sans enjeu, la loi de 1999 ne s'applique pas.
- La Commission des jeux de hasard (rapport « loot boxes », 2018) a considéré qu'une monnaie
  virtuelle achetée avec de l'argent réel peut constituer un enjeu ; une monnaie gagnée en jouant
  est en principe sans valeur.
- Conséquence pour Dig : **tant que les achats intégrés sont désactivés (#11) et que la pub
  récompensée est simulée**, la participation est sans enjeu. Si un jour des gemmes, boosts ou
  publicités réelles **influencent la profondeur** prise en compte par le concours, il faut
  réévaluer : avec un tirage, ce serait un jeu de hasard sans licence (interdit) ; avec un concours
  au mérite, ce ne serait pas un jeu de hasard mais un risque de pratique déloyale (« payer pour
  gagner un prix »).

### 2.3 Concours

Le concours n'est pas défini par la loi et est autorisé : le gagnant est désigné par une aptitude
ou un effort (intellectuel, physique, créatif). Le hasard doit être exclu de la désignation ;
une « question subsidiaire » trop simple ne suffit pas à transformer une loterie en concours
(jurisprudence d'appel citée par la doctrine).

Pour Dig, la **performance dans le jeu** (profondeur maximale validée par le serveur pendant la
saison hebdomadaire) est un critère de mérite mesurable, public et non aléatoire. Le départage doit
lui aussi être déterministe (blocs cassés manuellement, puis horodatage auquel la profondeur a été
atteinte en premier). **Aucun tirage, même pour départager.**

Limite connue : un critère de mérite n'a de sens que si la mesure est fiable. Aujourd'hui la
progression est décidée par le client et seul le classement est borné côté serveur (#9/#10). Les
lots A (observation) et B (« budget de dégâts ») de #25 sont donc un **préalable** à tout prix réel.

### 2.4 Droit économique (Code de droit économique)

- Les concours promotionnels proposés en ligne doivent être **clairement identifiables** et leurs
  **conditions de participation facilement accessibles et présentées de manière précise et non
  équivoque** (dispositions sur la publicité des services de la société de l'information, livre
  XII ; transposition de la directive 2000/31, art. 6).
- Pratiques commerciales déloyales (livre VI) : ne pas présenter le lot comme un « cadeau », ne
  pas donner l'impression qu'un prix est déjà gagné, ne pas laisser croire qu'un achat augmente
  les chances. Lot, valeur, nombre, calendrier et critères doivent être exacts.
- Pas d'obligation légale de faire déposer le règlement chez un huissier ; c'est utile pour de
  gros lots. Pour une carte de 5 €, le journal d'audit horodaté du serveur (#29/#30) suffit.

### 2.5 Mineurs

- La loi de 1999 interdit les jeux de hasard aux mineurs ; elle ne s'applique pas à un concours
  gratuit, mais un mineur ne peut pas valablement accepter seul un règlement ni fournir ses données
  pour un lot sans encadrement.
- Âge du consentement numérique en Belgique pour les services en ligne : 13 ans (loi du 30 juillet
  2018, art. 7, mise en œuvre du RGPD).
- ~~Recommandation initiale : réserver le concours aux majeurs.~~ **Non retenue (30/10/2026).**
  Aucune loi n'impose 18 ans pour un concours gratuit au mérite. Proposition actuelle : points et
  récompenses virtuelles ouverts à tous ; échange contre un cadeau réel par un mineur avec
  l'accord de son représentant légal, à qui le cadeau est remis — voir
  `docs/CONCOURS-INTERNATIONAL-MINEURS.md` § 4.

### 2.6 Territoire

- L'analyse ne couvre que la Belgique. Les règles diffèrent ailleurs (France : jeux promotionnels
  gratuits admis sous conditions ; Pays-Bas : code de conduite des jeux promotionnels). Le jeu est
  accessible partout et en FR/EN/NL.
- ~~Recommandation initiale : Belgique uniquement.~~ **Non retenue (30/10/2026).** Proposition
  actuelle : jeu et points mondiaux ; échange contre un cadeau réel ouvert aux résidents d'une
  **liste blanche** de pays vérifiés (proposition initiale BE, FR, NL, DE ; LU à vérifier ;
  Italie exclue à cause de la déclaration ministérielle obligatoire) — voir
  `docs/CONCOURS-INTERNATIONAL-MINEURS.md` § 3.

### 2.7 Fiscalité

- Côté gagnant (particulier) : en principe, les gains de loteries, jeux et concours occasionnels
  ne sont pas imposables en Belgique ; un lot de 5 € ne pose pas de question pratique. À confirmer
  par l'avocat ou un comptable.
- Côté organisateur : l'achat des cartes cadeaux est une dépense de promotion ; conserver les
  factures. Les cartes cadeaux Amazon sont des bons à usages multiples (pas de TVA spécifique à
  l'attribution). À confirmer selon le statut de l'organisateur (personne physique ou société).

### 2.8 RGPD

- Participation au concours **distincte** du jeu (#28) : inscription explicite, avec lien vers le
  règlement et la notice vie privée.
- Base légale : exécution du règlement (art. 6.1.b RGPD) pour la participation et la remise du
  lot ; obligation légale pour la conservation des preuves comptables.
- Minimisation : pseudonyme et profondeur pour le classement ; e-mail vérifié pour contacter le
  gagnant ; nom/adresse de résidence **uniquement** du gagnant pour vérifier l'éligibilité. Aucun
  e-mail ni code cadeau dans les journaux publics ou applicatifs (#30).
- Publication du résultat sous le **pseudonyme** du joueur, annoncée dans le règlement.
- Conservation : données du gagnant et preuve de remise 12 mois après la remise (contestations),
  puis suppression ; journaux de tirage/classement sans donnée personnelle directe.
- Le jeu ne publie aujourd'hui **aucune notice de confidentialité** alors qu'il collecte des
  e-mails : une notice est nécessaire pour le concours (et souhaitable pour le jeu en général).
- Aucune utilisation commerciale des e-mails (newsletter) sans consentement séparé.

### 2.9 Amazon

- Indiquer dans le règlement et l'interface : « Amazon n'est ni organisateur, ni parrain, ni
  partenaire de ce concours » ; ne pas utiliser le logo Amazon ; décrire le lot comme « un code de
  carte cadeau Amazon.com.be d'une valeur de 5 € » (ou du site Amazon choisi).
- Les codes ne sont utilisables que sur le site Amazon émetteur et sont soumis aux conditions
  générales des cartes cadeaux de ce site (pas d'échange contre de l'argent, etc.) : le
  règlement renvoie à ces conditions. **La page de conditions d'Amazon.com.be n'a pas pu être
  consultée lors de cette analyse (erreur 503) : à relire avant activation.**
- Le code est transmis **en privé** au gagnant vérifié, jamais publié ni journalisé (#30).

## 3. Conséquences pour les tickets liés

| Ticket | Conséquence |
|---|---|
| #29 Moteur | Le tirage pondéré peut être développé et testé **en simulation uniquement** ; il ne doit jamais attribuer de prix réel. Si la formule « concours au mérite » est retenue, le moteur réel devient un **classement déterministe figé à la clôture** (snapshot #16, profondeur validée #9, protections #25), avec journal et preuve — plus simple que le tirage. |
| #30 Admin | Interrupteur « prix réel » désactivé par défaut et **impossible à activer** tant que la conformité n'est pas validée ; workflow gagnant inchangé. |
| #31 Interface | Pas de « probabilité de gagner » en formule mérite : afficher le **rang** et l'écart avec le premier. Aucune mention de carte cadeau avant feu vert. Lien vers le règlement et la notice vie privée, mention « Amazon n'est pas partenaire ». |
| #28 Identité | E-mail vérifié, un compte par personne, contact privé ; à l'échange d'un cadeau réel : pays de résidence, déclaration de majorité ou accord du représentant légal (pas de restriction « majeur et résident belge »). |
| #33 Points / #34 Boutique | Attribution déterministe au classement ; pas de hasard dans la boutique (pas de boîte mystère contre des points convertibles) ; pas d'achat ni de transfert de points ; catalogue par pays ; lots réels sous verrou. |
| #25 Anti-bot | Lots A et B préalables à tout prix réel. |
| #11 / monétisation | Avant d'activer de vrais paiements ou de vraies publicités récompensées, vérifier qu'ils n'influencent pas le critère du concours (ou réévaluer ce cadrage). |

**Cadre de développement depuis la décision du 30/10/2026 (12 h 09)** — s'applique à #29, #30,
#31, #33 et #34, qui ne dépendent plus de ce ticket :

- Classements, points saisonniers, boutique et récompenses **virtuelles** : ouverts à tous les
  joueurs, **sans géoblocage ni âge minimal** ; textes internationalisés (FR/EN au minimum).
- Attribution **déterministe au mérite** (aucun tirage, aucune boîte mystère), points ni
  achetables, ni transférables, ni convertibles en argent, aucun achat qui améliore le classement.
- Catalogue extensible (articles virtuels et réels), **contrôle d'inventaire**, **journal d'audit**
  des attributions et échanges, **mode simulation** des échanges réels.
- **Configuration d'éligibilité des cadeaux réels** (pays, âge/accord parental, fournisseur) :
  structure prévue, **vide et désactivée par défaut** ; l'interrupteur global « cadeaux réels »
  reste **éteint** et aucun code n'est envoyé tant que la liste du § 4 n'est pas remplie.
- Interface : ne pas présenter les échanges réels comme ouverts (mention « bientôt » ou absence).

## 4. Conditions d'activation d'un prix réel (liste de contrôle)

Toutes sont nécessaires ; aucune ne peut être cochée par une session automatique. **Vérification
différée** (décision du 30/10/2026) : elle n'est faite qu'au moment où le propriétaire veut activer
les cadeaux réels ; elle ne bloque pas le développement.

1. ~~Choix de la formule~~ : **concours au mérite par points saisonniers retenu le 30/10/2026** ;
   barème (#33) et catalogue (#34) restent à décider.
2. Relecture du présent cadrage et du règlement par un avocat belge, ou acceptation écrite du
   risque par le propriétaire.
3. Identité complète de l'organisateur renseignée dans le règlement (nom ou dénomination,
   adresse, n° BCE le cas échéant, e-mail de contact).
4. Notice vie privée publiée et liée depuis le jeu.
5. #28 (e-mail vérifié), #25 lots A+B, #30, #31, #33 et #34 livrés et recettés ; liste blanche
   des pays et procédure mineurs validées (`docs/CONCOURS-INTERNATIONAL-MINEURS.md` § 7).
6. Règlement publié en FR, NL et EN (la version française fait foi) avant la première semaine
   concernée, sans modification en cours de semaine.
7. Achats intégrés et publicités récompensées réelles sans effet sur le critère du concours.

## 5. Sources consultées (30 octobre 2026)

- Nouveau Code pénal, art. 534 à 537 (loteries illégales) — résumé elfri.be (« Illegale loterij »,
  « Verboden loterijen ») ; entrée en vigueur au 1er septembre 2026 : SPF Justice,
  justice.belgium.be.
- Loi du 7 mai 1999 sur les jeux de hasard, les établissements de jeux de hasard et la protection
  des joueurs (Moniteur belge, etaamb.openjustice.be).
- Caluwaerts Uytterhoeven, « Een wedstrijd of winactie organiseren op sociale media : slimme
  marketing of een verboden loterij ? », LegalNews, 17 avril 2023.
- J. Neuray, « Les entreprises et les réseaux sociaux : concours, tombola, etc. et la loi ? »,
  Barreau de Liège-Huy, 1er décembre 2021.
- J.-F. Henrotte, « Concours sur les réseaux sociaux : do's and don'ts », Lexing, 29 mars 2022.
- UNIZO, Ondernemersgids « Wedstrijden » (mises à jour 2024 et 2026).
- R. Byl, droitbelge.be, 2003 (doctrine ancienne sur concours et question subsidiaire).
- Commission des jeux de hasard, rapport sur les loot boxes, avril 2018 (résumés de presse).
