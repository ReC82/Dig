# Ticket #27 — [P1] Concours hebdomadaire — conformité légale belge

- Ticket : https://github.com/ReC82/Dig/issues/27
- Session du 30/10/2026
- Tickets liés : #28 (identité), #29 (moteur), #30 (admin), #31 (interface), #25 (anti-bot)

## 1. État réel

**Intégré dans develop (documentation seule) — non déployé, car rien à déployer** : aucun
changement de code ni de base. La production n'est pas touchée. **Bloqué sur une décision du
propriétaire** : la formule prévue (tirage au sort pondéré) n'est pas utilisable en Belgique pour
un prix réel ; il faut choisir la formule de remplacement (questions § 8).

Classement : **Après lancement** pour le MVP public du jeu (le jeu peut être partagé sans
concours) ; **bloquant pour toute annonce ou attribution de prix réel**.

## 2. Résultat

**Verdict : le tirage au sort pondéré par la profondeur est une loterie au sens du Code pénal
belge, interdite même gratuite.** Le nouveau Code pénal (en vigueur depuis le 1er septembre 2026)
reprend la définition de l'ancien art. 301 à l'art. 534 : « opérations offertes au public,
destinées à procurer un gain par la voie du sort », sans exiger de mise ; organisation et
publicité sont punissables (art. 535 et 537). Les notes d'avocats belges récentes sont
unanimes : « ook volledig gratis loterijen zijn verboden ». Pondérer les chances par la profondeur
ne supprime pas le hasard (un joueur à 1 m peut battre celui à 600 m).

**Formule possible : un concours au mérite** — le lot va au premier du classement hebdomadaire
selon la profondeur validée par le serveur, départage déterministe, gratuit, sans achat, réservé
(recommandation) aux majeurs résidant en Belgique. C'est un concours, autorisé, sous réserve d'une
mesure fiable (#25 lots A+B) et d'un règlement accessible.

Autres points (détails dans `docs/CONCOURS-CONFORMITE.md`) :

- **Jeux de hasard (loi 1999)** : pas d'enjeu aujourd'hui (achats désactivés #11, pub
  récompensée simulée). Si de vrais achats ou publicités influencent un jour le critère, un tirage
  deviendrait un jeu de hasard sans licence ; un concours au mérite deviendrait du « payer pour
  gagner » : à réévaluer avant d'activer la monétisation.
- **Mineurs** : réserver le concours aux 18 ans et plus (déclaration, vérifiée au gagnant).
- **Territoire** : Belgique uniquement au départ.
- **Fiscalité** : lot de 5 € sans enjeu pratique ; gains occasionnels en principe non imposables
  pour un particulier ; conserver les factures (à confirmer par un professionnel).
- **RGPD** : participation distincte du jeu, minimisation, publication sous pseudonyme,
  conservation 12 mois des données du gagnant. **Le jeu n'a aujourd'hui aucune notice vie
  privée** alors qu'il collecte des e-mails.
- **Amazon** : mention « Amazon n'est ni organisateur ni partenaire », pas de logo, code envoyé en
  privé ; conditions des cartes cadeaux Amazon.com.be **non relues** (page indisponible, erreur
  503) — à vérifier avant activation.

## 3. Changements réalisés

| Fichier | Contenu |
|---|---|
| `docs/CONCOURS-CONFORMITE.md` | Verdict, analyse (loteries, jeux de hasard, concours, droit économique, mineurs, territoire, fiscalité, RGPD, Amazon), conséquences pour #25/#28/#29/#30/#31/#11, **liste de contrôle des 7 conditions** avant tout prix réel, sources. |
| `docs/REGLEMENT-CONCOURS.md` | **Projet de règlement** (11 articles) pour la formule au mérite, avec les blancs à compléter par le propriétaire (identité de l'organisateur, dates, délais, règle de rotation). Non publié. |
| ce rapport | — |

Aucun fichier de code, aucune migration, aucune donnée joueur touchée.

## 4. Révision, branche et vérification

- Branche : `docs/27-conformite-concours` (commit `b00b97f`) ; **SHA sur `develop` : `c6b56c7`**
  (fusion « Merge docs/27-conformite-concours dans develop (#27) »).
- Procédure de relecture : lire `docs/CONCOURS-CONFORMITE.md` § 1 (verdict, 1 tableau) puis § 4
  (liste de contrôle) ; compléter les crochets de `docs/REGLEMENT-CONCOURS.md`.
- Contrôle : `npm test` complet sur la fusion `c6b56c7` : **149/149 réussis**.

## 5. Vérifications et limites

- Faites : lecture du ticket et des tickets liés ; contrôle du code (achats désactivés,
  pub récompensée simulée qui accorde un boost de pièces, inscription sans âge ni pays, saisons
  hebdomadaires avec remise à zéro de la profondeur, gemmes reportées plafonnées à 100) ;
  recherche de sources publiques belges (liste dans le document).
- **Limites** : ce n'est **pas un avis juridique**. Textes consultés surtout via des résumés
  (texte officiel du nouveau Code pénal et de l'art. XII.12 CDE non lus en intégralité) ; doctrine
  ancienne divergente écartée ; conditions Amazon non lues ; droit des autres pays non analysé.
- Impact sur les données des joueurs : aucun.

## 6. Déploiement

Non déployé : documentation seule, rien ne change en production (règle « un commit de rapport ou
de documentation seul ne justifie pas un déploiement »). La production reste à `4988e19` (vérifié via `/api/version`).

**Test fonctionnel à faire par le propriétaire** : pas de test en jeu. Relire le verdict (§ 1 du
document), répondre aux questions ci-dessous et compléter le projet de règlement.

## 7. Choix faits seul

- Livrable en documentation (pas de garde-fou codé) : aucun code de concours n'existe encore ; le
  verrou « pas de prix réel » sera porté par #30 (interrupteur désactivé par défaut).
- Projet de règlement écrit pour la formule recommandée (mérite) plutôt que pour le tirage, qui
  n'est pas publiable.
- Recommandations par défaut prudentes : 18 ans et plus, Belgique seulement, pas de tirage même
  pour départager, conservation 12 mois.

## 8. Décisions demandées au propriétaire

1. **Formule du concours** : (a) concours au mérite — premier du classement hebdomadaire
   (**recommandé**) ; (b) maintenir le tirage pondéré malgré le risque pénal (déconseillé) ;
   (c) abandonner le prix réel (récompenses en jeu seulement).
2. **Si (a), répartition des gains** : (a1) le premier gagne toujours ; (a2) un même joueur ne
   peut pas regagner pendant N semaines, le lot passe au suivant (**recommandé**, N = 4) ; (a3) un
   lot par ligue quand plusieurs ligues seront actives.
3. **Avis d'avocat** : faire relire le cadrage et le règlement par un avocat belge avant le
   premier prix (**recommandé**), ou accepter le risque par écrit.
4. **Organisateur** : qui est l'organisateur légal (personne physique ou société, adresse, n° BCE,
   e-mail de contact) ? Indispensable pour le règlement et la notice vie privée.
5. **Éligibilité** : 18 ans et plus et résidents belges seulement (**recommandé**) — ou autre ?

## 9. Restant à réaliser

- Réponses aux questions 1 à 5, puis mise à jour de #29 (classement déterministe au lieu du
  tirage si (a)) et de #31 (rang au lieu d'une probabilité).
- Notice vie privée du jeu et du concours (à rédiger une fois l'organisateur connu).
- Traductions NL/EN du règlement après validation du texte français.
- Relecture des conditions des cartes cadeaux Amazon.com.be.
- Relecture juridique (si retenue).
