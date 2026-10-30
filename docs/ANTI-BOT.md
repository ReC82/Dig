# DIG! — Protection anti-bot : audit et conception (ticket #25, phase 1)

> Document de conception. **Rien n'est encore implémenté au titre de #25** : la phase 2
> (réalisation) commence après accord du propriétaire sur ce document (voir § 9).
> État du code analysé : `develop` = production `cf1f605` (30/10/2026), qui contient déjà
> #9 (classement serveur), #10 (anti-autoclic cumulé), #14 (limitation de débit), #16 (rotation
> des saisons) et #18 (révisions de sauvegarde).

## 0. Résumé

- Aujourd'hui, **le client est autoritatif pour tout le jeu** (pièces, gemmes, améliorations,
  reliques, quêtes, profondeur) ; le serveur stocke un « blob » JSON. Seul le **classement** est
  borné côté serveur (#9, #10, #16) — par des bornes *physiques* larges (≈ 21 m/s).
- Le risque principal pour un MVP public est le **classement** (seul élément partagé entre
  joueurs). La progression individuelle falsifiée ne lèse que le tricheur… sauf si elle sert à
  monter au classement ou à obtenir des récompenses de saison (#19).
- **Recommandation** : un plan en 5 lots, du moins intrusif au plus lourd. Les lots **A**
  (observation « shadow » + interrupteur + journal d'audit) et **B** (budget de dégâts : borne
  serrée de la profondeur classée) sont courts, sans impact sur le jeu, et suffisent pour le MVP.
  Les sanctions graduelles (C), l'économie transactionnelle (D) et l'anti-fermes renforcé (E)
  viennent **après le lancement**, nourris par les mesures réelles du lot A.
- Aucune sanction automatique définitive ; aucune sanction ne touche la **sauvegarde** ni le
  **droit de jouer** : seules la position au classement et l'éligibilité aux récompenses de saison
  peuvent être restreintes, toujours de façon révisable par l'admin.

## 1. Cartographie des flux et garanties réelles

| Flux | Où est la vérité | Garanties serveur actuelles | Contournement possible |
|---|---|---|---|
| Clic sur le bloc | Client (`onBlockHit`, `public/js/main.js`) | Aucune au moment du clic | Script `dispatchEvent`/`el.click()` (pas de contrôle `isTrusted`), auto-clicker OS, appel direct de `onBlockHit` en console |
| Détection client (CPS > seuil, régularité) | Client (`_isSuspiciousCPS`, `_computeRegularityScore`) | Aucune : le serveur ne recalcule pas | Modifier le JS ou forger `suspiciousScore`/`regularityScore` à 0 |
| Sauvegarde cloud `POST /api/me/save` | Blob JSON entier fourni par le client | Session obligatoire ; ≤ 30/min/compte (#14) ; révision optimiste `baseRevision` → 409 si obsolète (#18) ; taille du corps limitée par Express | Envoyer n'importe quel blob cohérent : pièces, gemmes, niveaux, reliques, quêtes. Sans `baseRevision`, l'écriture est acceptée (compatibilité ancien client) |
| Progression (pièces, gemmes, améliorations, reliques, quêtes, missions, récompense quotidienne, boosts, pub récompensée simulée) | Client | Aucune | Édition du blob ou de `localStorage` |
| Coffres boutique `POST /api/me/shop/chest/open` | Serveur (tirage + débit) | Coût et tirage côté serveur, transaction (#8) | Le débit porte sur des **pièces déclarées par le client** : pièces forgées → coffres « légitimes » |
| Statistiques de saison (`seasonStats`) | Client, puis bornées par le serveur | Saison active et dans sa période (#16) ; profondeur ≤ précédente + clics + blocs auto acceptés au rythme du temps serveur (≤ 20 clics/s, 1,25 bloc auto/s, seaux de 20 s, rejet au-delà de 10 min en attente) (#9) ; Δblocs ≤ Δclics, CPS moyen > 8 → blocs effectifs réduits (#10) | Compteurs **cohérents** forgés : jusqu'à ≈ 21 m/s de profondeur classée tant qu'on sauvegarde ; ≈ 425 m d'un coup après une pause |
| Classement public | Serveur (`season_rankings.max_depth` validée) | Valeur retenue ≠ déclarée (audit admin), correction admin journalisée (#9) | Voir ligne précédente |
| Promotions / ligues | Serveur à la clôture (#16) | Basées sur les valeurs retenues | Héritent des faiblesses ci-dessus ; récompenses à spécifier (#19) |
| Comptes `POST /api/register` | Serveur | ≤ 10 tentatives / 15 min / IP (#14) ; pas de vérification d'e-mail | Fermes de comptes via IP multiples (proxy, 4G) |
| Connexion | Serveur | ≤ 10 échecs / min / IP (#14), sessions durcies (#12) | — |
| Admin | Serveur (Bearer `ADMIN_SECRET`) | Secret hors dépôt (#12) | `PUT /api/admin/config` **non journalisé** : un changement d'interrupteur ne laisse pas de trace |

Constats complémentaires :

- **Rejeu** : rejouer une ancienne requête de sauvegarde avec son `baseRevision` donne 409 (#18) ;
  sans `baseRevision`, le rejeu écrase la sauvegarde mais ne fait pas progresser le classement
  (compteurs bornés par le temps serveur). Pas de nonce sur les autres routes ; les coffres sont
  idempotents par débit (un rejeu = un achat de plus, payé).
- **Journal anti-triche** : `anticheat_logs` (actions `reduced`, `flagged`, `rejected`,
  `depth_capped`, `depth_rejected`, `admin_fix`). En production (30/10) : 16 lignes, 1 compte.
- **Mobile** : `touchstart` (avec `preventDefault`) et `click` déclenchent `onBlockHit` ; pas de
  double comptage constaté (le `preventDefault` supprime le `click` synthétique).

## 2. Modèle de progression serveur autoritatif

Trois niveaux possibles, par coût croissant.

### N1 — Budget de dégâts (recommandé pour le MVP, lot B)

Règle du jeu exploitée : descendre d'un mètre exige de détruire un bloc, donc d'infliger ses PV.

- PV d'un bloc à la profondeur *d* : `ceil(hpBase × (1 + 0,12 (d−1)) × (1 − hpReduction))`.
  Plus petit `hpBase` : 3 jusqu'à 12 m, puis 8 ; `hpReduction` ≤ 0,50 (relique au niveau max).
  → **PV minimum** `hpMin(d)` calculable côté serveur, sans connaître l'état du joueur.
- Dégâts maximum : clic ≤ pioche 15 + relique 10 = **25** ; autodig ≤ 6 + 14 = **20 PV/s**.
- Le serveur tient un **seau de dégâts** alimenté par le temps serveur :
  manuel ≤ `depth_max_cps` (20) × 25 PV/s, auto ≤ 20 PV/s (+ marge de rattrapage 25 %, comme #9).
  Passer de la profondeur retenue *p* à *p + k* consomme `Σ hpMin(p+1 … p+k)` PV.
- Séparation stricte : les dégâts auto ne sont alimentés **que** par le temps (jamais par des clics),
  les dégâts manuels **que** par des clics acceptés (seaux existants de #9).
- Effet (temps minimum pour atteindre une profondeur, joueur au maximum théorique de tout) :

| Profondeur | Règle actuelle #9 (≈ 21 m/s) | Budget de dégâts (N1) |
|---:|---:|---:|
| 100 m | 5 s | 5 s |
| 500 m | 24 s | 2 min |
| 1 000 m | 47 s | 8 min |
| 2 000 m | 1 min 34 | 31 min |
| 5 000 m | 4 min | 3 h 13 |
| 10 000 m | 8 min | 12 h 50 |

  Ces bornes ne peuvent pas pénaliser un joueur honnête (elles supposent pioche, autodig et
  reliques au maximum et le bloc le plus faible à chaque mètre). Un joueur réel à 6 clics/s avec
  une pioche niveau 5 met ≈ 16 min pour 200 m.
- Variante plus serrée (après le lot D) : utiliser les niveaux **connus du serveur** (pioche,
  autodig, reliques) au lieu des maxima.

### N2 — Économie transactionnelle (lot D, après lancement, lié à #20)

- Les achats d'améliorations et de reliques passent par des routes serveur transactionnelles
  (modèle des coffres de #8) ; le serveur tient un **grand livre** (pièces gagnées bornées par le
  budget de dégâts × récompense maximale par PV, dépenses, solde).
- Le blob client reste un cache d'affichage ; les champs économiques du blob sont **ignorés**
  (pas réécrits) au profit du grand livre. Migration additive : le grand livre démarre à la valeur
  actuelle de chaque sauvegarde, sans réécriture.
- Coût : important (toutes les dépenses du jeu, quêtes, missions, quotidien) ; décision produit
  sur les sources de gemmes (#19/#20). Non nécessaire pour un MVP dont le seul enjeu partagé est
  le classement.

### N3 — Simulation complète côté serveur (non recommandé)

Blocs tirés par le serveur, clics transmis par lots signés, PV calculés côté serveur. Garantie
maximale mais réécriture du jeu, latence perceptible, jeu hors ligne/invité impossible, charge
serveur ×100. À reconsidérer seulement si le jeu acquiert des enjeux monétaires réels.

## 3. Détection multi-signal

Principe : **aucun signal seul ne déclenche une réponse au-delà de la journalisation**. Chaque
signal ajoute des points à un score de risque (§ 5) ; certains signaux sont des **preuves**
(impossibilités physiques), les autres des **indices**.

| Signal | Type | Source | Poids indicatif |
|---|---|---|---|
| Δblocs > Δclics, compteurs au-delà du budget de dégâts, `depth_rejected` | Preuve | Serveur (#9, #10, lot B) | Fort |
| Valeurs forgées impossibles (négatives, non entières, saison future, champs `suspiciousScore` remis à 0 alors qu'il était > 0 dans la même saison) | Preuve | Serveur | Fort |
| CPS moyen soutenu > seuil sur plusieurs fenêtres consécutives (pas une seule) | Indice | Serveur (#10) | Moyen |
| Rafales impossibles : > 25 clics/s sur 1 s (record humain ≈ 14–16 clics/s soutenus) | Indice fort | Client (histogramme) | Moyen |
| Régularité : coefficient de variation des intervalles très faible **et** longue durée | Indice faible | Client (résumé) | Faible — jamais seul (outils d'accessibilité) |
| Entropie / répétition de motifs d'intervalles (même séquence répétée) | Indice | Client (résumé) | Faible |
| Proportion de clics non `isTrusted` | Indice fort | Client | Moyen |
| Jeu ininterrompu > 4 h au rythme élevé sans pause | Indice | Serveur | Faible |
| Nombreuses sauvegardes 409 / sans `baseRevision` / rafales au plafond de #14 | Indice | Serveur | Faible |
| Comptes multiples créés depuis la même IP (hachée) en peu de temps, profils de jeu identiques | Indice | Serveur | Faible (IP partagées) |

Télémétrie client proposée (lot A) : la sauvegarde cloud transporte un **résumé** (pas les
horodatages bruts) : nombre de clics, histogramme des intervalles en 8 classes, CV, nombre de
clics non `isTrusted`, type de pointeur dominant (souris/tactile/stylet). Taille < 200 octets ;
aucune donnée personnelle. Le client n'est jamais cru : ces données ne servent qu'à des
**indices**, jamais à des preuves.

## 4. Limitation, quotas, rejeu, fermes de comptes, journaux

- **Existant (#14)** : connexion 10 échecs/min/IP, inscription 10/15 min/IP, sauvegarde
  30/min/compte. Conservé.
- **Ajouts proposés** :
  - Coffres : ≤ 30/min/compte (aujourd'hui sans limite propre).
  - Inscription : en plus du quota par IP, un quota **global** souple (ex. 200/h) qui ne bloque
    pas mais passe le serveur en « inscription surveillée » (journal + alerte admin).
  - IP partagées (écoles, 4G/CGNAT) : aucune limite par IP sur le jeu lui-même ; les limites par IP
    ne visent que l'inscription et la connexion.
- **Rejeu** : rendre `baseRevision` obligatoire pour les clients à jour (les anciens restent
  acceptés pendant une transition, comptés comme indice) ; numéro de séquence monotone par
  session pour la télémétrie.
- **Fermes de comptes** : un compte n'est **éligible aux promotions/récompenses de saison** qu'avec
  un minimum d'activité réelle (ex. ≥ 30 min de jeu validé sur ≥ 2 jours) — décision produit, voir
  Q4. Vérification d'e-mail en option (lot E, dépend de #23 SMTP).
- **Journal de sécurité** : nouvelle table `security_events` (type, compte, score avant/après,
  détails JSON, IP **hachée** HMAC avec un sel serveur, horodatage). Pas d'e-mail, pas de mot de
  passe, pas d'IP en clair. Rétention 90 jours (purge des événements uniquement, jamais des
  comptes ni des sauvegardes). `anticheat_logs` reste en place.
- **Journal d'audit admin** : `PUT /api/admin/config` et toute action admin (correction,
  levée de sanction) journalisés dans `security_events` (clé, ancienne/nouvelle valeur).

## 5. Score de risque et réponses graduelles

- Score par compte et par saison, 0–100, **décroissant** (demi-vie 24 h) ; recalculé à chaque
  sauvegarde. Les preuves pèsent lourd, les indices peu ; plafonnés par catégorie pour qu'un seul
  type d'indice ne puisse pas dépasser le niveau 1.

| Niveau | Score | Réponse | Visible par le joueur |
|---|---|---|---|
| 0 | < 30 | Rien | Non |
| 1 — Journaliser | ≥ 30 | Événement `security_events`, compte listé dans l'admin | Non |
| 2 — Limiter | ≥ 60 | Crédit de classement réduit (blocs effectifs au rythme du seuil, comme #10) ; le jeu et la sauvegarde ne changent pas | Message discret « progression de classement limitée » |
| 3 — Défi ponctuel | ≥ 80, **seulement si activé** | Défi non intrusif (ex. « touchez le bloc doré » une fois, pas de CAPTCHA tiers) ; réussi → score −30 | Oui |
| 4 — Suspension temporaire | Preuves répétées **et** score ≥ 90 pendant 24 h | Exclusion du classement **et** des récompenses de saison pour la saison en cours, révisable ; le joueur continue à jouer | Oui, avec lien de contestation |

- Jamais de bannissement automatique, de suppression ou de remise à zéro de progression.
- **Contestation** : lien vers une adresse de contact (à fournir, Q5) ; l'admin lève la sanction
  (journalisé) et peut marquer « faux positif » (sert aux métriques).
- **Interrupteur** `antibot_mode` = `off` | `shadow` | `enforce` (config admin, effet immédiat,
  journalisé) + variable d'environnement `ANTIBOT=off` prioritaire (désactivation même si l'admin
  est inaccessible). En `shadow`, tout est calculé et journalisé, **aucune** réponse n'est
  appliquée. Les bornes physiques existantes (#9/#10) gardent leurs interrupteurs propres.

## 6. Impact joueurs et métriques

- **Mobile / tactile** : rafales courtes possibles avec plusieurs doigts → l'histogramme tolère des
  intervalles < 30 ms isolés ; le budget N1 suppose 20 clics/s soutenus, au-dessus du tactile réel.
- **Accessibilité** : contacteurs et auto-clickers d'assistance produisent des rythmes très
  réguliers → la régularité n'est **jamais** suffisante seule et plafonne au niveau 1.
- **Double clic** : chaque clic compte ; pas de pénalité pour deux clics rapprochés.
- **Réseau instable / hors ligne** : sauvegardes perdues ou en retard rattrapées par les seaux
  (#9) ; aucun indice n'est tiré du délai entre sauvegardes.
- **Latence** : calculs O(1) par sauvegarde (≤ 1 sauvegarde/12 s/joueur, #10) ; une ligne
  d'état par joueur ; aucune requête supplémentaire par clic.
- **Joueurs rapides** : 20 clics/s soutenus est au-dessus des records humains ; le niveau 2 exige
  plusieurs fenêtres consécutives.
- **Métriques** (vue admin) : comptes par niveau, événements par signal, taux de faux positifs
  (sanctions levées « faux positif » / sanctions), délai moyen de levée, temps de calcul par
  sauvegarde.

## 7. Dépendances et ordre de mise en œuvre

| Ticket | Lien | État au 30/10 |
|---|---|---|
| #10 anti-autoclic cumulé | Signal CPS, `anticheat_logs` | En production (`cf1f605`) |
| #9 classement serveur | Seaux de clics/temps ; N1 s'y ajoute | En production |
| #14 limitation de débit | Quotas réutilisés | En production |
| #18 révisions | Anti-rejeu `baseRevision` | En production |
| #19 ligues/récompenses | Les sanctions portent sur l'éligibilité aux récompenses | À faire |
| #20 paramètres économiques | Prérequis du lot D (N2) | À faire |
| #23 SMTP | Vérification d'e-mail (lot E) | À faire |

Ordre proposé :

1. **Lot A — Observation** *(Bloquant MVP public — petit)* : `security_events`, journal d'audit
   admin, interrupteur `antibot_mode` (défaut `shadow`), télémétrie client résumée, score de
   risque calculé mais **non appliqué**, vue admin. Déployé en shadow.
2. **Lot B — Budget de dégâts** *(Bloquant MVP public — petit)* : borne N1 sur la profondeur
   classée, avec son interrupteur (`damage_budget_enabled`), log `depth_capped` existant réutilisé.
   C'est une borne physique comme #9 : elle s'applique dès le déploiement (pas de sanction).
3. **Lot C — Réponses graduelles** *(Après lancement)* : niveaux 2–4, contestation, après ≥ 1
   semaine de shadow et revue des faux positifs par le propriétaire.
4. **Lot D — Économie transactionnelle N2** *(Après lancement, après #20)*.
5. **Lot E — Anti-fermes renforcé** *(Après lancement, si nécessaire)* : éligibilité aux
   récompenses, vérification d'e-mail (#23).

## 8. Plan de tests (phase 2)

Scénarios automatisés (`npm test`, base `/tmp`, horloge injectée comme #9/#10) :
joueur humain 3–14 clics/s irrégulier (souris et tactile) ; joueur rapide 18 clics/s sur 30 s ;
autodig seul 8 h ; boosts actifs (aucun effet sur les bornes) ; outil d'accessibilité très régulier
à 5 clics/s ; bot 30 clics/s régulier ; bot « humanisé » 12 clics/s avec gigue (doit au mieux être
borné par N1, pas sanctionné) ; requêtes forgées (compteurs 1e9, négatifs, profondeur sans dégâts) ;
rejeu de sauvegarde ; réseau instable (sauvegardes perdues 60 s puis rafale) ; 20 comptes derrière
une IP ; mode `off`/`shadow`/`enforce` ; non-régression saisons et récompenses (`test-season.js`).
Mesures : temps de calcul par sauvegarde, faux positifs sur les scénarios humains = 0.

## 9. Décisions demandées au propriétaire

Voir le rapport `docs/claude-reports/2026-10-30_ticket-25-anti-bot-conception.md`, § 8.
