# DIG! — Authentification : Auth0 ou amélioration de l'existant (ticket #28)

Comparatif demandé par le propriétaire avant tout achat ou toute migration d'identité.
Rédigé le 30/10/2026. Tarifs relevés le même jour (page officielle Auth0 ; Firebase et
Supabase d'après des sources secondaires, à revérifier avant toute décision d'achat).

## 1. Point de départ

- Comptes DIG! : nom d'utilisateur + mot de passe (bcrypt, coût 10), adresse e-mail **obligatoire
  et unique** depuis l'inscription, session par cookie (`express-session`, fichiers, 7 jours,
  `Secure`/`HttpOnly`/`SameSite=Lax` depuis #12), limitation de débit (#14).
- Production au 30/10 : **1 compte**. Aucun mécanisme de vérification d'adresse, de mot de passe
  oublié ni de changement de mot de passe avant ce ticket.
- Besoins du ticket : e-mail vérifié, récupération et changement de compte, anti-multicompte,
  contact privé du gagnant (concours au mérite, #27), RGPD/minimisation, PWA.

## 2. Options comparées

| Critère | **A. Existant amélioré** (livré dans #28) | **B. Auth0** | **C. Firebase Auth / Supabase Auth** |
|---|---|---|---|
| Coût fixe | 0 € (+ envoi d'e-mails : 0 € dans les quotas gratuits courants, ~300 e-mails/jour) | Free : 0 $ jusqu'à 25 000 MAU ; **Essentials 35 $/mois (500 MAU), 70 $ (1 000), 350 $ (5 000), 700 $ (10 000)** ; Professional dès 240 $/mois | ~50 000 MAU gratuits (e-mail/mot de passe), au-delà quelques dixièmes de centime par MAU |
| E-mails de vérification / récupération | Oui, par le SMTP choisi, textes FR/EN/NL du jeu | Free : **pas de fournisseur e-mail personnalisé ni de personnalisation des pages** (envoi de test d'Auth0 seulement) → Essentials nécessaire en pratique | Oui, modèles limités ; domaine d'envoi à configurer |
| Migration des comptes | **Aucune** : mêmes identifiants, mêmes sessions | Import des hachages bcrypt possible, ou migration progressive (base personnalisée) ; **toutes les sessions changent** (jetons OIDC) | Import bcrypt possible ; refonte du client et des sessions |
| Rupture pour les joueurs | Aucune | Redirection vers une page Auth0 (Universal Login) ; reconnexion de tous | Reconnexion de tous ; SDK tiers dans le client |
| Travail | Fait (≈ 1 300 lignes avec tests et traductions, 6 tests) | Refonte connexion/inscription/session + liaison `users.id` ↔ `sub` Auth0 (plusieurs jours) | Idem B |
| Dépendance externe | Serveur SMTP seulement | Panne ou changement de tarif Auth0 = connexion impossible | Idem, Google ou Supabase |
| RGPD | Données sur le serveur actuel, aucun sous-traitant hors SMTP | Sous-traitant (région UE possible), DPA à signer, registre à compléter | Sous-traitant US (Google) ou UE (Supabase), DPA |
| Connexion Google/Apple, MFA, passkeys | Non (à développer si besoin) | Oui (social gratuit ; MFA « Pro » payante) | Oui (social ; MFA selon offre) |
| PWA / hors ligne | Inchangé (cookie même origine) | Redirections externes à gérer dans la PWA installée | SDK client, fonctionne en PWA |
| Anti-multicompte | E-mail unique + vérifié ; règles supplémentaires possibles | Idem (+ détection d'attaques payante) | Idem |

## 3. Recommandation

**Option A — améliorer l'existant (livrée par ce ticket).** Elle couvre tous les besoins du MVP
sans coût, sans migration d'identité, sans rupture de session, et garde les données des joueurs
sur le serveur actuel. Auth0 n'apporte au MVP rien d'indispensable : son offre gratuite n'inclut
pas l'envoi d'e-mails personnalisés, et l'offre utile (Essentials) coûterait 35 à 700 $/mois
selon l'audience, avec une refonte et une reconnexion de tous les joueurs.

**À réexaminer** si l'un de ces besoins devient prioritaire : connexion « Continuer avec
Google/Apple », double authentification, passkeys, ou une obligation de conformité qui imposerait
un fournisseur d'identité certifié. Le choix à ce moment serait plutôt Firebase/Supabase (gratuit
jusqu'à ~50 000 MAU) qu'Auth0, sauf exigence entreprise. La table `users` et ses identifiants
restent alors la référence (migration progressive possible, réversible).

## 4. Ce que l'option A fait (ticket #28)

- **Vérification de l'adresse** : lien à usage unique (48 h) ; possible depuis n'importe quel
  appareil ; les comptes existants gardent leur adresse, marquée « non vérifiée ».
- **Mot de passe oublié** : par nom d'utilisateur ou adresse ; réponse identique que le compte
  existe ou non ; lien unique valable 1 h ; le nouveau mot de passe **ferme les autres sessions**
  et connecte le navigateur utilisé ; ouvrir le lien prouve aussi l'adresse.
- **Changement de mot de passe** (mot de passe actuel exigé ; autres appareils déconnectés).
- **Changement d'adresse** (mot de passe exigé) : la nouvelle adresse ne remplace l'ancienne
  qu'après confirmation, et l'ancienne adresse est prévenue.
- **Sécurité** : jetons de 256 bits, seul leur SHA-256 est stocké ; un seul lien valable à la fois
  par usage ; délai de 60 s entre deux envois à un même compte ; limitation par IP (5 envois /
  15 min, 20 liens refusés / 15 min) ; liens construits depuis `PUBLIC_BASE_URL`, jamais depuis
  l'en-tête `Host` ; SMTP sans accès fichier/URL.
- **Sans SMTP configuré** : rien ne change pour les joueurs, hormis l'affichage de leur adresse
  et le changement de mot de passe (qui ne demande pas d'e-mail).

## 5. Pour le concours (#27, #30, #31)

- **Contact privé du gagnant** : par l'adresse **vérifiée** du compte, jamais publiée.
- **Recommandé** : n'autoriser la participation qu'aux comptes à adresse vérifiée (à appliquer
  dans #30/#31), avec une inscription au concours **distincte** du compte de jeu (consentement
  au règlement, minimisation : aucune donnée supplémentaire avant d'avoir gagné).
- **Anti-multicompte, étapes suivantes possibles** (Après lancement) : normalisation des adresses
  Gmail (points, `+alias`), refus des domaines jetables, contrôle par le panel admin avant remise
  du lot. La règle est une décision produit, liée au règlement du concours.

## 6. Configuration à faire par le propriétaire (production)

Ajouter dans `/etc/dig/dig.env` (fichier root, mode 600 — jamais lu par les sessions Claude),
puis redémarrer `dig.service` :

```
SMTP_HOST=…            # serveur d'envoi (ex. Brevo, Mailjet, OVH, Gmail avec mot de passe d'application)
SMTP_PORT=587          # 465 = TLS direct
SMTP_USER=…
SMTP_PASS=…
MAIL_FROM=DIG! <adresse@domaine>
MAIL_REPLY_TO=…        # facultatif : adresse lue par le propriétaire
PUBLIC_BASE_URL=https://dig.lodygames.com
```

Pour éviter les indésirables : SPF et DKIM du domaine de `MAIL_FROM` configurés chez le
fournisseur choisi.

## Sources

- Auth0, tarifs : https://auth0.com/pricing (consulté le 30/10/2026)
- Firebase Authentication : https://firebase.google.com/pricing ; synthèse https://blog.logto.io/firebase-authentication-pricing
- Supabase : https://supabase.com/pricing ; synthèse https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/
