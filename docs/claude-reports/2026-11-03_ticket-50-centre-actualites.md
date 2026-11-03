# Ticket #50 — Centre d'actualités Dig (cloche, annonces IA, événements joueurs, Discord)

Lien : https://github.com/ReC82/Dig/issues/50 — session DIGORCH du 03/11/2026 (nuit).

## 1. État réel

**Déployé en production (SHA `b2cbb44`), en attente de ta recette.**
Classement : **Après lancement** pour l'essentiel, mais c'est une petite brique utile pour la bêta (annoncer une maintenance, une saison, le Discord). Rien ne bloque le MVP.

## 2. Ce qui a changé

### Dans le jeu
- **Cloche à gauche du logo** (PC et téléphone), en miroir de Profil et Paramètres. Une **pastille rouge** indique le nombre d'annonces non lues (au-delà de 9 : « 9+ »).
- Un clic ouvre le **panneau Actualités** par-dessus le jeu, qui continue de tourner (le minage automatique ne s'arrête pas). On le ferme avec ✕, Échap ou un clic à côté.
  - **À venir** : annonces dont la date d'événement n'est pas encore passée (📅 date et heure dans le fuseau du joueur).
  - **Dernières actualités** : les autres, de la plus récente à la plus ancienne. Les nouvelles sont marquées « Nouveau » et ont un liseré doré.
  - Bouton « Lire la suite » pour le texte complet, et lien externe s'il y en a un (https uniquement, ouvert dans un nouvel onglet).
  - **« 💬 Rejoindre le Discord »** : seulement si un lien Discord est enregistré dans l'onglet 🧪 Bêta du panel (le même lien que pour la bêta). Il n'y en a **aucun** pour l'instant, donc rien ne s'affiche. Aucune adresse n'est inventée.
- **Lu / non lu** : enregistré **par compte** côté serveur pour un joueur connecté (la pastille disparaît aussi sur ses autres appareils), et dans le navigateur pour un invité.
- Textes en FR/EN/NL/ES, avec le français par défaut si une langue manque. Le panneau est séparé de l'historique personnel des notifications (#26, Paramètres).

### Dans le panel : onglet « 📰 Actualités »
- La liste des annonces s'affiche d'abord, avec un filtre : toutes, brouillons, publiées/programmées, archivées. Chaque ligne indique l'état, le titre, la catégorie, les dates et la source (manuelle, IA, automatique). Aucune fiche n'est ouverte par défaut.
- **« ＋ Ajouter »** ouvre une fiche avec, en haut, **« ✨ Mise en forme avec l'IA »** : tu colles un texte brut et l'IA remplit titre, résumé et texte dans les 4 langues, la catégorie, l'icône et la date si tu l'as donnée.
  - La consigne interdit d'ajouter un fait (date, chiffre, récompense, lien). L'IA liste « ❓ À compléter » (ce qui manque) et « ⚠️ À vérifier » (ce qui est douteux).
  - Un lien qui n'est pas dans ton texte est **retiré** automatiquement.
  - Le résultat remplit seulement la fiche : tu relis, tu corriges, puis **« Enregistrer le brouillon »**.
- **Tout est enregistré en brouillon**, y compris ce qui vient de l'IA. Ensuite : « 📣 Publier maintenant » ou « Programmer » à une date. La liste propose aussi Dépublier, Archiver et Restaurer. Rien n'est jamais supprimé.
- Un **aperçu** montre l'annonce comme dans le jeu, et un avertissement apparaît si une langue n'a pas de titre.
- La section repliée **« Annonces automatiques, faits joueurs et Discord »** contient les réglages et indique où configurer le lien Discord.
- Un **journal** garde les 40 dernières actions : création, modification, publication, programmation, archivage, annonces automatiques, réglages. Les actions admin restent aussi tracées dans le journal de sécurité existant.

### Annonces automatiques (activées)
- **Saison suivante** : publiée au moment où le thème est annoncé à J-1 (#48), avec le nom, l'accroche et la collection si elle est publiée. Elle apparaît dans « À venir » et disparaît au début de la saison.
- **Début de saison** : nom du thème et accroche.
- **Fin de saison** : publiée seulement **après le classement figé** (#29), avec des chiffres agrégés (nombre de mineurs classés, record). **Sous 3 classés, aucun chiffre** n'est donné, parce qu'il révélerait le résultat d'un joueur ; seul un renvoi vers l'onglet Saison est affiché.
- Chaque annonce a une clé unique : pas de doublon, et un redémarrage ne crée rien en plus. Seuls les événements des **48 dernières heures** sont annoncés : aucun rattrapage de l'historique au déploiement.
- **En production, juste après le déploiement**, deux annonces vraies ont été créées : « La saison Boussoles et dés a commencé » et « Fin de la saison 44-2026 · 2 » (sans chiffre, car un seul classé).

### Faits joueurs (DÉSACTIVÉS par défaut)
- Deux types de faits :
  - un **palier de profondeur** atteint, selon la profondeur **validée par le serveur** (paliers configurables, 200 m par défaut ; seul le palier le plus haut est annoncé, une seule fois) ;
  - le **classement final** (top N du classement figé, N = 3 par défaut, joueurs éligibles seulement).
- Conditions pour qu'un joueur soit cité :
  - il a **coché lui-même** « J'accepte que mon pseudo apparaisse… » dans le panneau Actualités. La case n'apparaît que si tu actives les faits joueurs, et elle est décochée par défaut ;
  - s'il la décoche, ses annonces **disparaissent aussitôt** ;
  - seul son pseudo public est affiché ;
  - un joueur au risque anti-bot ≥ 2 n'est jamais cité ;
  - un **plafond quotidien** limite le nombre de faits publiés (5 par défaut). Au-delà, le fait est tracé mais jamais publié plus tard.
- Pas encore traités : « découverte importante » et « collection terminée » (voir § 9).

## 3. SHA, branche et tests

- Branche : `feature/50-centre-actualites` (commits `dee4e99`, `f5c4e06`, `bcddb5f`, plus le correctif de fin de saison).
- **SHA sur `develop` = SHA déployé : `b2cbb44`.**
- `test/news.test.js` (10 tests) vérifie :
  - la création en brouillon, la publication, la programmation, l'expiration, l'archivage, la répartition « À venir » / « Dernières » et le journal ;
  - les validations (titre FR obligatoire, lien https, dates) ;
  - le lu/non lu par compte, sans retour en arrière, et l'accord explicite pour les mentions ;
  - l'IA (transport factice) : lien inventé retiré, catégorie réservée refusée, brouillon obligatoire, proposition utilisable une seule fois, échec tracé ;
  - les annonces de saison : réglage désactivable, idempotence, aucun rattrapage, fin de saison seulement après le classement figé, aucun chiffre sous 3 classés ;
  - les faits joueurs : désactivés par défaut, accord nécessaire, retrait immédiat, profondeur validée seulement, déduplication, plafond, validation des réglages ;
  - les routes HTTP (invité, joueur inscrit, admin 401) et la structure de l'interface.
- Suite complète : **475/475** sur `develop`, puis **475/475** dans la release au SHA exact `b2cbb44`.
- Navigateur (Chromium headless), sur un serveur de test avec une base jetable et l'IA factice, en 1280×900 et 390×844 : pastille 3 → panneau → Échap → pastille masquée, y compris après rechargement ; aucune erreur console. Panneau en néerlandais vérifié. Fiche admin avec mise en forme IA (factice) vérifiée.
- Production après déploiement, en PC et mobile : cloche « 2 », panneau avec les 2 annonces, aucune erreur.

## 4. Vérifications et impact sur les données

- **Migration** : uniquement **5 tables ajoutées** (`news_items`, `news_log`, `news_reads`, `news_prefs`, `news_ai_proposals`), avec `CREATE TABLE IF NOT EXISTS`. Aucune table existante n'est modifiée.
- Test sur une **copie de la base de production** : empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` **identiques** avant et après démarrage, `quick_check` = ok. Copie supprimée ensuite.
- **Aucune dépense IA** pendant les tests (transport factice). En production, une mise en forme coûte un appel texte, dans le quota et le plafond IA existants (#37).
- Non vérifié : un **vrai** appel IA (il n'a lieu que quand tu cliques « Mettre en forme »), et le passage J-1 « saison suivante » en production (prochaine occasion : 08/11 vers 00:00 UTC, pour la saison du 09/11).

## 5. Déploiement

- Déployé : `61a5cbc` → **`b2cbb44`** le 03/11 à 05:08 (Bruxelles).
- Sauvegarde vérifiée : `~/backups/dig/dig-20261103-050803-pre-deploy-b2cbb44.sqlite`.
- Après déploiement :
  - les deux domaines répondent 200 avec la version `1.0.0+b2cbb44` ;
  - journal du service sans erreur ;
  - `quick_check` = ok ;
  - empreintes joueurs identiques à la sauvegarde pré-déploiement.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 61a5cbc` puis `sudo systemctl restart dig`. Les 5 tables ajoutées restent, sans effet sur le reste du jeu.

### Test fonctionnel à faire (≈ 4 min)
1. **Jeu** (Ctrl+F5), sur PC puis sur téléphone : une **cloche** à gauche de « DIG! » avec une pastille **2**. Ouvre-la : « À venir » est vide, « Dernières actualités » contient « Fin de la saison 44-2026 · 2 » et « La saison Boussoles et dés a commencé ». Ferme avec Échap ou ✕ : la pastille disparaît. Recharge : elle reste masquée. Connecté, ouvre le jeu sur l'autre appareil : pas de pastille non plus.
2. **Panel** (/admin/, Ctrl+F5) → **📰 Actualités** : les 2 annonces automatiques sont dans la liste. « ＋ Ajouter » → colle un texte brut, par exemple « Maintenance jeudi 20h-20h30 heure belge, sauvegardez avant » → « ✨ Mettre en forme » (≈ 20 s, un appel IA). Résultat attendu : fiche remplie en 4 langues, sans fait ajouté, avec ce qui manque listé.
3. « Enregistrer le brouillon » : rien n'apparaît dans le jeu. « 📣 Publier maintenant » : la pastille passe à 1 dans le jeu (rafraîchissement au chargement de la page, ou toutes les 10 min).
4. Facultatif : enregistre un lien Discord dans 🧪 Bêta → Configurer la bêta. Le bouton « Rejoindre le Discord » apparaît alors en bas du panneau.

## 6. Choix techniques faits seul

- **Lien Discord** repris de la configuration Bêta (#57) plutôt qu'un deuxième réglage : une seule source, jamais inventée.
- **Lu / non lu** : je retiens une date « lu jusqu'à » par compte plutôt qu'un état par annonce. C'est plus simple, ça ne revient jamais en arrière, et c'est suffisant pour une pastille.
- Les **textes automatiques** sont écrits à l'avance dans les 4 langues, sans IA : aucune dépense, aucun risque d'invention.
- Les annonces automatiques ne sont pas modifiables une fois publiées : on les archive. Elles restent dans le journal.
- Pas de suppression : on archive, et on peut restaurer.
- Les dates s'affichent dans le fuseau du joueur. Dans le panel, la saisie se fait en heure locale du navigateur et le serveur stocke en UTC.
- Le panneau se recharge à l'ouverture et toutes les 10 minutes quand l'onglet est visible. La route est limitée à 30 requêtes par minute et par compte.

## 7. Décisions demandées au propriétaire

1. **Activer les faits joueurs ?** (onglet 📰 → Annonces automatiques → cocher « Faits joueurs »). Recommandation : **pas avant la bêta ouverte**. Avec 1 à 2 joueurs, il n'y a pas d'intérêt, et l'anti-bot est encore en mode observation (#25).
2. **Lien Discord** : à enregistrer dans 🧪 Bêta quand le serveur Discord existera. Rien n'est requis pour la recette.

Sinon, aucune décision nécessaire pour la recette.

## 8. Limites connues

- Si l'admin change le nom du thème après l'annonce J-1, l'annonce « Prochaine saison » garde l'ancien nom. Il faut l'archiver et en publier une autre.
- La pastille d'un invité est propre à chaque navigateur.
- Le jeu ne reçoit pas les nouvelles annonces en direct : il les récupère au chargement, toutes les 10 min, ou à l'ouverture du panneau.

## 9. Reste à réaliser (Après lancement)

- Faits « découverte importante » (objet rare de collection) et « collection terminée » : il faut d'abord un suivi serveur fiable des trouvailles, qui n'est validé aujourd'hui que côté client (#39). C'est à reprendre avec l'anti-bot (#25).
- Notifications push ou e-mail des annonces : seulement une fois le SMTP en place (#43).
