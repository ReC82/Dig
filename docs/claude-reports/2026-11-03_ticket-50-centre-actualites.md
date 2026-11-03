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

---

## Mise à jour du 03/11/2026 (midi) — recettes #50-A à #50-E : ergonomie du panel

Lien : https://github.com/ReC82/Dig/issues/50 — recettes du propriétaire #50-A, B, C, D, E du 03/11.

### État réel

**Déployé en production (SHA `d37b478`), en attente de ta recette.** Tes recettes ont validé le fonctionnement : génération IA, brouillon invisible des joueurs, archivage. Cette mise à jour ne traite que l'ergonomie, sans toucher aux annonces publiées ni au mécanisme de saison. Classement : **Après lancement**, non bloquant pour la pré-bêta.

### Ce qui a changé (panel → 📰 Actualités)

1. **Fini les popups JavaScript (#50-E)**
   - Publier, Programmer, Dépublier, Archiver, Restaurer et « abandonner les modifications » ouvrent une **confirmation aux couleurs de Dig**. Elle reprend le même type de fenêtre que les fiches du panel.
   - Elle indique ce que fait l'action : visible des joueurs ou non, réversible ou non, et comment revenir en arrière.
   - Le focus est d'abord sur **Annuler**. Échap, un clic sur le fond ou Annuler ne changent rien, et le focus revient au bouton d'origine.
   - Le bouton d'action est rouge pour Archiver, Dépublier et Abandonner. Le résultat s'affiche dans un toast, erreur comprise.
   - Un double clic n'envoie l'action qu'une fois.
   - Le composant est réutilisable (`admConfirm()` dans `public/admin/admin.js`) pour les autres onglets (voir l'inventaire plus bas).
2. **La fiche d'une annonce est réorganisée (#50-B, #50-E)**
   - **1. Notes brutes → mise en forme IA** en tête. La section est ouverte pour une nouvelle annonce et repliée pour une modification ; l'aide « ⓘ Comment ça marche » est repliée.
   - **2. Texte** avec des **onglets FR / EN / NL / ES** : une seule langue est visible à la fois, comme dans les fiches Collections. Chaque onglet porte une pastille : ● complet, ◐ titre seul, ○ à traduire.
     - Changer de langue ne perd rien.
     - Quand tu traduis, le texte français reste affiché en référence.
     - L'**aperçu joueur** suit la langue choisie. Il est à droite sur PC et en dessous sur mobile.
   - **3. Catégorie, icône, dates et lien** est replié, avec un résumé sur une ligne (ex. « Annonce · 📣 · sans date · sans lien »). Le libellé du lien n'apparaît que si un lien est saisi.
   - **Publication** est un cadre séparé, sous la fiche, visible seulement pour une annonce déjà enregistrée. Chaque action demande une confirmation.
   - Le **pied de fiche reste fixe** : « 💾 Enregistrer le brouillon », Annuler et l'indicateur « ● modifications non enregistrées ».
   - La fiche a une hauteur limitée, avec **une seule zone qui défile** entre l'en-tête et le pied. Sur mobile, les deux boutons restent visibles côte à côte.
   - **Saisies protégées** (notes, textes, réglages) : ✕, Annuler, Échap ou un clic sur le fond demandent confirmation s'il reste quelque chose de non enregistré. Le navigateur prévient aussi si tu quittes la page.
   - **« 🖨 Fiche complète »** : imprime ou enregistre en PDF l'annonce entière, avec ses réglages et les 4 langues l'une sous l'autre, sur fond blanc. Plus besoin de trois captures.
3. **Liste pleine largeur (#50-A)**
   - Jusqu'à 1440 px, comme Ligues & Saisons.
   - Le titre a la colonne la plus large ; état, catégorie, dates et source tiennent sur une ligne.
   - Sur téléphone, chaque annonce devient une carte (État : …, Catégorie : …) avec des boutons plus hauts.
4. **Remarques de l'IA allégées (#50-C)** (`server/news.js`)
   - Au premier plan ne restent que ❓ les **lacunes qui gêneraient vraiment** (3 au plus, par exemple une maintenance sans date) et ⚠️ les **points risqués** (2 au plus).
   - Les idées facultatives (durée, critères…) sont dans « Autres suggestions facultatives (n) », replié.
   - **Registre homogène** : l'IA doit tutoyer partout, comme le jeu. En français « tu », en néerlandais « je/jij », en espagnol d'Espagne « tú » (jamais « vosotros », « vuestro » ni « usted »), en anglais « you ». Elle ne mélange jamais les registres dans un même texte.
   - La relecture multilingue plus poussée (glossaire) relève de #59.

### Fichiers
`public/admin/admin.js` (`admConfirm`, section Actualités), `public/admin/index.html` (fiche `news-dialog`, `#nw-print`), `public/admin/admin.css`, `server/news.js` (consigne et liste `suggestions`), `test/admin-news-ux.test.js` (nouveau, 6 tests), `test/news.test.js`.

### SHA et tests
- Branche `feature/50-centre-actualites` (`e986744`), intégrée dans `develop` en **`d37b478`**.
- `npm test` : **527/527** sur la branche, sur `develop` `d37b478` et dans la release `d37b478`.
- **Essai navigateur local** (Chromium, 1280×900 et 390×844, IA simulée) :
  - aucune popup native ;
  - focus sur Annuler, et Échap sur Archiver ne modifie rien ;
  - une seule langue visible, saisie ES conservée après FR → ES, aperçu ES ;
  - Échap ou clic sur le fond avec une fiche modifiée → confirmation, puis « Continuer » garde la fiche ;
  - ✕ sans modification ferme directement ;
  - brouillon → indicateur effacé, cadre Publication visible ;
  - Publier → confirmation → Annuler ;
  - Archiver → Confirmer en double clic → une seule archive ;
  - fiche complète en impression : 4 langues ;
  - pas de défilement horizontal sur mobile.
- **Copie de la base de production** : empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` identiques avant et après démarrage, `quick_check` ok. Aucune migration : le schéma est inchangé.

### Déploiement
- **`d37b478` en production** (avance rapide de `main` 33aac1b → d37b478). Sauvegarde vérifiée : `dig-20261103-123217-pre-deploy-d37b478.sqlite`.
- dig.lodygames.com et dig.lodylands.com répondent 200, version `1.0.0+d37b478`.
- Journal sans erreur, `quick_check` ok, empreintes joueurs identiques à la sauvegarde.
- Annonces en base inchangées : 2 publiées, 1 archivée (ton test).
- Chromium en production, jeu et page admin, 1280 et 390 : aucune erreur.
- Aucune génération IA n'était en cours au redémarrage.
- **Retour arrière** : `git -C /home/ubuntu/Dig reset --keep 33aac1b && sudo systemctl restart dig` (pas de migration, base inchangée).

### Test à faire par le propriétaire (≈ 4 min, PC puis téléphone)
1. /admin/ (Ctrl+F5) → 📰 Actualités. La liste occupe la largeur et les titres tiennent mieux. Sur téléphone, chaque annonce est une carte.
2. Sur l'annonce archivée « Dig en bêta privée », clique « Restaurer en brouillon… ». Une fenêtre Dig (pas une popup du navigateur) explique l'effet, avec le focus sur Annuler. Appuie sur **Échap** : rien ne change.
3. Clique « Modifier » sur cette annonce. Tu dois voir les onglets ● FR ● EN ● NL ● ES, une seule langue visible, l'aperçu dans la langue choisie, la section 3 repliée et les boutons en bas toujours visibles.
4. Modifie une lettre du titre, puis clique sur le fond ou appuie sur Échap. Attendu : « Modifications non enregistrées », puis « Continuer à modifier » garde ta saisie.
5. « 🖨 Fiche complète » : l'aperçu d'impression montre l'annonce dans les 4 langues sur une page. Ferme ensuite avec « Abandonner les modifications ». **Ne publie rien.**
6. Facultatif (un appel IA) : « ＋ Ajouter », colle une note courte et clique « ✨ Mettre en forme ». Au premier plan, il ne doit rester que peu de remarques ; les autres sont sous « Autres suggestions ». Dans l'onglet ES, le tutoiement doit être cohérent.

### Choix techniques faits seul
- **Composant partagé `admConfirm()`** créé à la volée, sans balisage par onglet. Ainsi chaque section pourra l'adopter en une ligne, sans confirmation ad hoc incohérente.
- **Impression** : un bloc `#nw-print` est rempli puis `window.print()` est appelé. Une feuille `@media print` masque tout le reste. C'est fiable et ne demande ni bibliothèque PDF ni génération serveur.
- **Clic sur le fond** : seul un clic hors du cadre de la fiche demande la fermeture. Un clic dans sa marge intérieure est ignoré.
- **Archiver ne se fait pas depuis la fiche**, seulement depuis la liste, avec confirmation. Cela évite une action de plus près de « Enregistrer ».

### Inventaire des `confirm/alert/prompt` restants dans le panel (#50-E, point 2) — à programmer
Il reste **environ 58 appels natifs hors Actualités**. Ordre de remplacement proposé par `admConfirm()`, de l'usage le plus fréquent au plus rare, et sans toucher aux parcours critiques avant la pré-bêta :

| Priorité | Onglet | Appels | Remarque |
|---|---|---|---|
| 1 | Collections (#39), Blocs (#37), Badges (#38) | ~25 | publier, abandonner, retirer, fermer une fiche modifiée : usage le plus fréquent |
| 2 | Événements (#56), Saisons thématiques (#48), Icônes (#40) | ~11 | publier ou planifier, verrouiller une image |
| 3 | Bêta (#57), Publicité (#45), Boutique (#34), Points (#33) | ~8 | révoquer, fermer les inscriptions, ajuster des points |
| 4 | Concours (#30), Classement, Saisons, Ligues, Auth, Config | ~14 | dont **6 `prompt()`** (motif, profondeur, note) qui demandent une petite fiche de saisie : prévoir un `admPrompt()` |

Je propose de le faire dans **#61** (« Admin — empêcher la perte de modifications dans tous les formulaires »), qui touche les mêmes fiches. Les collections et les blocs utilisent encore `confirm()` pour la fermeture d'une fiche modifiée.

### Décisions demandées au propriétaire
Aucune décision nécessaire pour cette mise à jour. Les questions précédentes restent ouvertes et ne bloquent rien :
1. Activer les faits joueurs ? Je recommande d'attendre la bêta ouverte.
2. Lien Discord à saisir dans 🧪 Bêta quand il existera.
3. Ajouter le remplacement des popups natives des autres onglets au périmètre de #61 ? Je le recommande.

### Reste à faire (après lancement)
- Remplacer les popups natives des autres onglets (inventaire ci-dessus).
- Faits « découverte importante » et « collection terminée ».
- Annonces en direct : aujourd'hui elles arrivent au chargement ou toutes les 10 min.

## Mise à jour du 03/11/2026 (après-midi) — recettes #50-F, #50-G et #50-H

### 1. État réel
**Déployé en production (SHA `2babc99`), en attente de recette** (≈ 1 min). Classement : **Après lancement**, confort de l'administration, rien ne bloque le MVP.

Recettes du propriétaire prises en compte :
- **#50-F** : nouvelle fiche acceptée (« Oui c'est beaucoup mieux »). Défaut signalé : après **F5**, le panel revenait sur l'onglet **Saisons**. → **corrigé**.
- **#50-G** : fermeture protégée et abandon validés. Incohérence de texte signalée : le dialogue citait toujours « 💾 Enregistrer le brouillon », alors que le bouton d'une annonce publiée ou archivée s'appelle « 💾 Enregistrer les modifications ». → **corrigé**.
- **#50-H** : fiche complète et impression validées. Rien à faire.

### 2. Changements (`public/admin/admin.js`, `test/admin-news-ux.test.js`)
- **Onglet retenu après F5.** Cliquer sur un onglet inscrit son identifiant dans l'adresse (`/admin/#news`, `#collections`, `#icons`…). Après F5, ou après une reconnexion par clé, le panel rouvre cet onglet et sa liste.
  - **Lien direct** : `/admin/#icons` ouvre l'onglet Icônes.
  - **Saisie manuelle du fragment** : elle change d'onglet.
  - **Fragment inconnu ou malformé** : retour à l'onglet Saisons (le fragment est filtré avant de servir de sélecteur).
- **Pas d'onglets dans l'historique.** L'adresse est mise à jour avec `history.replaceState` : le retour navigateur quitte le panel comme avant, au lieu de sauter d'onglet en onglet. Il ne peut donc pas contourner une fiche protégée, et la page reste protégée par la confirmation de sortie.
- **Rien d'autre n'est restauré.** Aucune fiche rouverte, aucune action relancée, aucune publication. Un changement de fragment est ignoré tant qu'une fiche ou une confirmation est ouverte.
- **Libellé du dialogue.** « Modifications non enregistrées » cite le vrai libellé du bouton d'enregistrement : « Enregistrer le brouillon » ou « Enregistrer les modifications ». Il en va de même pour le message affiché après la mise en forme par l'IA.

### 3. SHA, branche et tests
- Branche `feature/50-centre-actualites` : commit `9950ca2`. Sur `develop` : merge `2babc99`.
- `npm test` : **547/547** sur la branche, sur `develop` `2babc99` et dans la release. Les 2 nouveaux tests sont dans `test/admin-news-ux.test.js`.
- Le test existant « aucun stockage navigateur dans le panel » (sécurité #12) reste respecté : ni sessionStorage ni localStorage, seulement le fragment d'URL.
- **Chromium local** (serveur de test, port 3101, base de test supprimée ensuite), en 1280×900 et 390×844 :
  - Actualités → F5 → Actualités ; Collections → F5 → Collections ;
  - lien `#icons` ouvert directement ; `#nope` et `#"]bad` → Saisons ;
  - 3 changements d'onglet → longueur d'historique inchangée ;
  - fragment modifié pendant une fiche ouverte → fiche conservée, onglet inchangé ;
  - après connexion par clé avec `#news` → Actualités ;
  - dialogue : « Enregistrer le brouillon » pour une nouvelle annonce, « Enregistrer les modifications » pour une annonce archivée ;
  - 0 erreur JavaScript, 0 popup native.

### 4. Données et déploiement
- Aucune migration, aucune route serveur modifiée, aucune annonce publiée ni modifiée.
- **Copie de la base de production démarrée avec la release** : empreintes `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` identiques, copie supprimée.
- Aucune génération IA en cours avant le déploiement : dernier appel à 12:55 UTC.
- `deploy.sh` (script de la release) : `7e7c885` → `2babc99`, sauvegarde vérifiée `dig-20261103-155223-pre-deploy-2babc99.sqlite`.
- **Après le déploiement** :
  - les 2 domaines répondent 200 avec la version `1.0.0+2babc99` ;
  - journal sans erreur ; `quick_check` ok ;
  - empreintes joueurs identiques à la sauvegarde ;
  - `news_items` inchangées (2 publiées, 1 archivée) ;
  - Chromium prod, jeu et admin, en 1280 et 390 : 0 erreur.
- **Retour arrière** : `git -C /home/ubuntu/Dig reset --keep 7e7c885` puis redémarrage. Le changement ne touche que le panel.

### 5. Test à faire (≈ 1 min, sans rien publier)
1. /admin/ (Ctrl+F5) → 📰 Actualités. L'adresse se termine par `#news`.
2. **F5** → tu restes sur Actualités (plus de retour à Saisons). Même essai sur 📿 Collections ou 🎨 Icônes.
3. Facultatif : sur une annonce publiée ou archivée, « Modifier », change une lettre, puis Échap. Le dialogue doit dire « puis « 💾 Enregistrer les modifications » ». Termine par « Abandonner les modifications ».

### 6. Choix techniques
- **Fragment d'URL plutôt que sessionStorage.** Le panel interdit tout stockage navigateur (test de sécurité #12), et le fragment survit à F5 tout en permettant un lien direct.
- **`replaceState` plutôt que `pushState`.** Un historique d'onglets ferait sauter le retour navigateur d'onglet en onglet. Il contournerait aussi les protections de fiche que #61 généralisera.
- **Correction pour tout le panel.** Le défaut concernait tous les onglets, et aucun autre ticket ne le couvrait. Les filtres de liste et l'état des boutons Rafraîchir restent dans #60 et #61.

### 7. Décisions demandées au propriétaire
Aucune nouvelle décision. Les questions précédentes restent ouvertes et ne bloquent rien :
1. Faits joueurs (profondeur, classement final) : je recommande de les activer après la bêta ouverte.
2. Lien Discord : à saisir dans 🧪 Bêta quand il existera.
3. Remplacement des ~58 confirm/alert/prompt des autres onglets : je recommande de le faire dans #61, en commençant par Collections, Blocs et Badges.

### 8. Reste à réaliser
- Observer les annonces automatiques J-1 à leur échéance du 08/11 (Après lancement).
- Le cas « Continuer à modifier garde la saisie » n'a pas été rapporté explicitement par le propriétaire. Il est couvert par l'essai Chromium local du 03/11 (midi).
