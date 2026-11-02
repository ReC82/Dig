# Ticket #57 — [P0] Préparer une bêta fermée Dig : stabilité, accès, feedback et suivi

Lien : https://github.com/ReC82/Dig/issues/57

## Session du 03/11/2026 (nuit)

### 1. État réel

**Déployé en production (SHA `1ac0ecf`), en attente de recette.** Tout est désactivé par défaut : rien ne change en jeu tant que tu n'actives rien dans /admin → 🧪 Bêta.

### 2. En bref : GO / NO-GO

| Étape | Verdict | Pourquoi |
|---|---|---|
| **Pré-bêta familiale (3–5 proches, Discord)** | **GO sous 3 conditions** | (1) créer le serveur Discord et coller le lien dans le panel ; (2) décider si les points de récompense restent en mode réel (question 1) ; (3) accepter que le « mot de passe oublié » passe par toi (mot de passe temporaire du panel) tant que les e-mails (#43) ne sont pas configurés. |
| **Bêta fermée 30 joueurs** | **NO-GO pour l'instant** | Manquent : e-mails du jeu (#43), coordonnées de l'éditeur sur la page de confidentialité + conditions d'utilisation + suppression de compte, surveillance externe, et la recette navigateur des tickets en attente (#35, #47). |
| **Bêta 100 joueurs** | NO-GO | En plus : économie toujours calculée par le navigateur (pièces/gemmes falsifiables, #25 lots C–E), à accepter explicitement ou corriger. |

Production au moment de l'audit : **1 seul compte** (le tien) dans la base. Aucun joueur extérieur ne peut donc être perturbé par la bêta.

### 3. Ce qui a été livré

Tout est **désactivé par défaut** : au déploiement, le jeu est strictement identique (inscription ouverte, aucun bandeau, aucun lien Discord). Tu actives chaque élément toi-même dans **/admin → 🧪 Bêta**.

- **Inscription sur invitation** (`server/beta.js`, `POST /api/register`) : trois modes, *ouverte* (comme avant), *sur invitation* (code obligatoire) et *fermée*. Les codes ont la forme `DIG-XXXX-XXXX`, avec un nombre d'utilisations, une date d'expiration (14 jours par défaut), une révocation possible et un numéro de vague (10 → 30 → 100). Le code est consommé dans la même transaction que la création du compte : deux inscriptions simultanées ne peuvent pas dépasser la limite. Ni le mode ni la révocation n'empêchent les comptes existants de se connecter (c'est testé).
- **Lien d'invitation** `https://dig.lodygames.com/?invite=DIG-XXXX-XXXX` : il ouvre directement « Créer un compte » avec le code déjà rempli, et le code disparaît de la barre d'adresse. Le panel propose « 📋 Copier le lien ». Le jeu n'envoie **aucune** invitation de lui-même.
- **Bandeau BÊTA** sous l'en-tête, sur une seule ligne : « 🧪 BÊTA — jeu en développement », bouton « 🐞 Signaler un bug » et × pour le masquer pendant la session. Il est loin de la zone de minage.
- **Section « 🧪 Bêta » dans Paramètres** : politique de progression (texte par défaut traduit en FR/EN/NL/ES : « la progression peut être ajustée ou remise à zéro pendant la bêta, aucune récompense réelle n'est promise », ou ton propre texte), bugs connus, version, bouton Discord (**seulement si un lien est configuré**, jamais inventé), bouton de signalement et « Mes signalements » avec leur statut (reçu, en cours d'analyse, corrigé + lien vers le ticket GitHub). Le testeur voit donc quand son bug est corrigé.
- **Signaler un bug** : quatre champs (étape, attendu, constaté, appareil prérempli « Android · Chrome »). Une case, **décochée par défaut**, joint les infos techniques : version, navigateur, taille d'écran, langue, écran du jeu, page **sans paramètres** (les jetons des liens e-mail ne partent jamais). Leur contenu exact est visible avant l'envoi. Aucune capture et aucune IP ne sont enregistrées. Après l'envoi, « 📋 Copier pour Discord » prépare un message au format « appareil, étape, attendu, constaté, capture » à coller dans #bugs. Limite : 5 envois par 15 min.
- **Panel → 🧪 Bêta** :
  - réglages ;
  - codes (créer, copier le lien, révoquer) ;
  - **testeurs** : comptes créés avec un code, date d'inscription, dernière sauvegarde, retour J+1 et J+7 (approximation fondée sur la dernière sauvegarde cloud, sans outil d'audience) ;
  - **signalements** : statut, lien GitHub, note interne, diagnostic ;
  - **mot de passe temporaire** pour un testeur qui a perdu le sien. Il est affiché une seule fois, toutes ses sessions sont fermées, et il faut confirmer en saisissant le nom exact du joueur.
- **`/health` vérifie la base** : il renvoie 503 si SQLite ne répond pas. `deploy.sh` s'appuie sur ce contrôle, donc un retour arrière se déclenche aussi dans ce cas.
- **Simulation de 12 cycles de saisons** (`test/season-cycles-12.test.js`), dans une base isolée avec une horloge simulée, de mars à mai 2027 :
  - rotations hebdomadaires, avec le planificateur appelé deux fois à chaque passage (idempotence) ;
  - une saison sans participant ;
  - des ex æquo parfaits, deux fois ;
  - des joueurs absents puis revenus ;
  - deux fins exceptionnelles en heure de Bruxelles, **avant** (16:00 = 15:00 UTC) et **après** (16:00 = 14:00 UTC) le passage à l'heure d'été du 28/03/2027, avec une saison courte qui couvre la nuit du changement d'heure ;
  - une **panne de 15 jours** suivie d'un redémarrage (migrations rejouées) et du rattrapage des semaines manquées ;
  - les points en mode réel et les promotions de ligue.

  Invariants vérifiés sur les 14 saisons closes : contiguïté à la seconde, noms uniques, une seule saison active, classement figé vérifiable pour chaque saison, **une seule attribution de points par saison**, aucun double crédit, soldes égaux au total crédité, registre valide, au plus un niveau de ligue gagné par clôture, et **comptes et sauvegardes jamais réécrits**.

Fichiers : `server/beta.js` (nouveau), `server/db.js` (4 tables ajoutées), `server/index.js`, `server/rateLimits.js`, `public/js/beta.js` (nouveau), `public/js/main.js`, `public/js/i18n.js` (FR/EN/NL/ES), `public/index.html`, `public/css/style.css`, `public/admin/index.html`, `public/admin/admin.js`, `test/beta.test.js` (nouveau, 7 tests), `test/season-cycles-12.test.js` (nouveau).

### 4. SHA et procédure de test

- Branche `feature/57-beta-fermee`, commit `b7eb06b`, intégré dans `develop` au merge `1ac0ecf`.
- `npm test` : **432/432** dans le worktree du ticket et dans la release `1ac0ecf`. `npm run check` est ok.
- `node --test test/beta.test.js test/season-cycles-12.test.js` couvre les invitations, la fermeture, les signalements, le mot de passe temporaire, `/health` et les 12 cycles.
- Essai navigateur sur un serveur de test (port 3101, base de test supprimée ensuite), sur ordinateur 1280×900 et sur smartphone 390×844. Le lien d'invitation remplit le code, l'inscription fonctionne, un code épuisé est refusé avec un message clair, le bandeau s'affiche, le signalement est envoyé avec diagnostic et apparaît dans « Mes signalements ». Côté panel : réglages, codes, testeurs, signalements et mot de passe temporaire fonctionnent. Aucune erreur JavaScript.

### 5. Vérifications, limites, données joueurs

- **Migration** testée sur une copie de la base de production démarrée en `NODE_ENV=production` : empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` **identiques** avant et après. Seules 4 tables sont ajoutées (`beta_settings`, `beta_invites`, `beta_invite_uses`, `bug_reports`). Copie supprimée ensuite.
- Aucune donnée joueur n'est modifiée. Le mot de passe temporaire n'agit que lorsque tu le déclenches, sur un compte précis.
- Limites :
  - le texte personnalisé de politique et de bugs connus n'est affiché que dans la langue où tu l'écris ;
  - J+1 et J+7 sont approximatifs : seule la dernière sauvegarde est connue ;
  - pas de captures d'écran dans le jeu (Discord sert à ça) ;
  - pas de suppression automatique des anciens signalements.
- Non vérifié : rendu sur un vrai iPhone ou Android, délivrabilité Discord.

### 6. Déploiement et test à faire par le propriétaire

- **Déployé : `1ac0ecf`** le 03/11/2026 à 00:26 (Bruxelles), en avance rapide de `main` depuis `06ca5ba`, avec `scripts/deploy.sh` de la release. Pas de `npm ci`, le lockfile est inchangé.
- Le déploiement a été **retardé d'environ 1 min**, le temps que ta génération d'icône en cours se termine (culotte de Dagobert, terminée à 00:25:22), pour ne pas l'interrompre.
- Sauvegarde vérifiée : `~/backups/dig/dig-20261103-002631-pre-deploy-1ac0ecf.sqlite`.
- Vérifications faites :
  - les deux domaines répondent 200 ;
  - `/api/version` = `1.0.0+1ac0ecf` ;
  - `/health` = `{ok:true, db:true}` ;
  - `/api/beta/config` renvoie les valeurs par défaut (ouvert, bandeau masqué, pas de Discord) ;
  - le journal est sans erreur ;
  - `quick_check` = ok ;
  - les empreintes joueurs sont **identiques** à la sauvegarde pré-déploiement ;
  - Chromium sur la production (ordinateur et smartphone) : jeu chargé, pas de bandeau, aucune erreur JavaScript.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 06ca5ba && sudo systemctl restart dig`. Les tables ajoutées restent, sans effet.

**Test fonctionnel (10 min, PC puis téléphone) :**
1. /admin/ (Ctrl+F5) → **🧪 Bêta**. Le bandeau jaune indique « Inscription ouverte à tous · bandeau masqué · Discord non configuré ».
2. Coche « Bandeau BÊTA… », colle le lien d'invitation Discord **si le serveur existe déjà** (sinon laisse vide), puis **Enregistrer**.
3. Codes d'invitation : libellé « Test », 1 utilisation → **Créer** → « 📋 Copier le lien ».
4. Mode d'inscription « Sur invitation » → **Enregistrer**.
5. Sur le téléphone, en navigation privée, ouvre le lien copié. **Attendu :** bandeau BÊTA, formulaire « Créer un compte » avec le code déjà rempli. Crée un compte de test.
6. Rouvre le même lien dans un autre onglet privé et essaie un 2ᵉ compte. **Attendu :** « Code d'invitation invalide, expiré ou déjà utilisé. »
7. Avec le compte de test : bandeau → « 🐞 Signaler un bug », remplis « Constaté », coche la case, regarde « Voir exactement ce qui sera envoyé », puis **Envoyer**. **Attendu :** « Merci ! Signalement n°… reçu » et un bouton « Copier pour Discord ».
8. Panel → 🧪 Bêta : le testeur « Test » apparaît, ainsi que le signalement. Passe-le en « corrigé » → sur le téléphone, Paramètres → Bêta → Mes signalements affiche « corrigé ».
9. Vérifie que ton propre compte se connecte toujours normalement (le mode invitation ne touche pas les comptes existants).
10. Remets le mode d'inscription de ton choix (« Sur invitation » recommandé pendant la bêta).

**Classement MVP :** **Bloquant MVP** (accès contrôlé et canal de retour sont des prérequis de la bêta familiale).

### 7. Choix techniques faits seul

- **Tout désactivé par défaut** : aucun effet visible au déploiement, et le lancement reste ta décision (« ne pas auto-activer l'accès public »).
- **Signalements stockés dans le jeu**, en plus de Discord : ça marche même sans serveur Discord, le suivi par joueur est possible, et le texte est déjà mis au format Discord. Ça reste le plus simple : pas d'envoi automatique vers GitHub, et c'est toi qui lies le ticket.
- **Diagnostic sur consentement, case décochée par défaut**, contenu affiché avant l'envoi. Aucune IP ni capture.
- **Mot de passe temporaire par l'admin** plutôt que d'attendre #43 : c'est le seul moyen, aujourd'hui, de débloquer un proche qui a oublié son mot de passe.
- **Codes sans caractères ambigus** (pas de 0/O ni de 1/I/L), pour qu'ils puissent être dictés. Le lien d'invitation évite de toute façon d'avoir à les saisir.
- **Badge « Testeur fondateur » non créé** : il faut d'abord ta validation (question 3). Le système de badges (#38) le permet sans aucun bonus.

### 8. Décisions demandées au propriétaire

1. **Points de récompense pendant la bêta.** Ils sont aujourd'hui en mode **réel** (depuis le 30/10) : avec 3 testeurs éligibles, le 1er reçoit 100 points. Le ticket demande « aucune promesse de conservation des points ». Options :
   - (a) les laisser réels et annoncer qu'ils peuvent être remis à zéro en fin de bêta ;
   - (b) repasser en **simulation** (panel → 🏅 Points), qui calcule les points sans les créditer.

   **Recommandation : (b)** pendant la bêta familiale.
2. **Politique de reset** : faut-il annoncer qu'en fin de bêta la progression **sera** remise à zéro, ou seulement qu'elle **peut** l'être ? **Recommandation :** « peut être ajustée », comme le texte par défaut. Ça ne promet rien et ça n'oblige à rien.
3. **Badge « Testeur fondateur »**, honorifique, sans aucun bonus : oui ou non ? Si oui, je le crée dans un ticket #38 ou #57 et il sera attribué aux comptes créés avec un code de la vague 1.
4. **E-mails du jeu (#43)** : c'est le vrai bloquant avant 30 joueurs. Choisis le fournisseur (voir #43) ; d'ici là, le mot de passe temporaire du panel suffit pour 3 à 5 proches.

### 9. Ce qu'il reste à faire, côté propriétaire, étape par étape

**A. Discord (≈ 15 min, toi) :**
1. Discord → « + » → *Créer le mien* → *Pour un club ou une communauté* → nom « Dig — Bêta ».
2. Salons texte : `#bienvenue`, `#annonces`, `#bugs`, `#suggestions`, `#discussion`. Dans `#annonces` et `#bienvenue`, retire à `@everyone` le droit « Envoyer des messages ».
3. Paramètres du serveur → Rôles : crée « Testeur » **sans** « Administrateur » ni « Gérer le serveur ». Ne donne à personne d'autre que toi les droits d'administration.
4. Message épinglé dans `#bugs` : « Pour chaque bug : **appareil**, **étape**, **attendu**, **constaté**, **capture**. Le bouton 🐞 du jeu prépare ce message pour vous. »
5. Inviter → *Modifier le lien* : expiration 7 jours, nombre d'utilisations 5, puis copie le lien `https://discord.gg/…`.
6. Panel → 🧪 Bêta → colle-le dans « Lien d'invitation Discord » → Enregistrer.

**B. Ouvrir la vague 1 (≈ 5 min) :** panel → 🧪 Bêta :
1. Mode « Sur invitation » + bandeau coché.
2. Crée un code par proche (libellé = prénom, 1 utilisation, 14 jours).
3. Envoie à chacun, en message privé, le lien du jeu et le lien Discord.

**C. Script de test externe de 15 min (à envoyer aux testeurs) :**
1. *(2 min)* Ouvre le lien d'invitation sur ton téléphone, crée ton compte et note ton pseudo.
2. *(3 min)* Mine une vingtaine de blocs. La profondeur augmente-t-elle ? Les pièces aussi ?
3. *(2 min)* Boutique : achète une amélioration. Quotidien : récupère la récompense.
4. *(2 min)* Ouvre un coffre (s'il est disponible) et note ce que tu as reçu.
5. *(2 min)* Sur un **autre appareil** (PC), connecte-toi avec le même compte. Retrouves-tu ta profondeur et tes pièces ? Le téléphone affiche-t-il « Partie ouverte sur un autre appareil » ?
6. *(1 min)* Onglet 🏆 Saison : te vois-tu dans le classement ?
7. *(1 min)* Si quelque chose cloche, utilise 🐞 « Signaler un bug », puis « Copier pour Discord » et colle le message dans #bugs avec une capture.
8. *(2 min)* **Le lendemain (J+1)**, rouvre le jeu : ta progression est-elle toujours là ? Dis-le dans #discussion.

**D. Critères de passage :**
- **Vague 1 (3–5 proches) → vague 2 (≈ 30)** : 7 jours sans perte de progression signalée, aucun bug bloquant ouvert dans `#bugs`, au moins 60 % des testeurs revenus à J+1 (panel → Testeurs), au moins une clôture de saison observée sans anomalie, #43 (e-mails) et page légale complétée.
- **Vague 2 → vague 3 (≈ 100)** : 14 jours stables, surveillance externe en place, décision prise sur l'économie côté client (#25 C–E et #49), sauvegarde hors machine prouvée (#36), conditions d'utilisation publiées.

**E. Après la bêta familiale (classé « Après lancement », sauf mention) :**
- surveillance externe gratuite de `/health` (UptimeRobot ou équivalent, à créer par toi) ;
- conditions d'utilisation, coordonnées de l'éditeur et suppression de compte (**bloquant pour 30 et plus**) ;
- CSP `script-src` ;
- heure de fin de saison affichée en heure locale (la rotation se fait en UTC : fin le dimanche à 23:59:59 UTC, soit lundi 00:59 ou 01:59 à Bruxelles) ;
- recette navigateur de #35 et #47.

### Vrais P0 restants (liste courte)

1. Lien Discord à créer et à coller (toi, partie A).
2. Décision sur les points réels ou simulés (question 1).
3. E-mails du jeu, #43 (avant 30 joueurs ; contourné pour 3 à 5 proches par le mot de passe temporaire).

### Les 3 prochains tests concrets pour toi

1. Le test fonctionnel du §6 (10 min).
2. La création du Discord, partie A (15 min), puis un essai de « Copier pour Discord » vers `#bugs`.
3. Le script de 15 min de la partie C, fait toi-même sur ton téléphone avec un code d'invitation, avant de l'envoyer à ta sœur.
