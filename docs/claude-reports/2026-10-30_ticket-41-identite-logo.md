# Ticket #41 — Identité DIG! : logo compact et pictogrammes de navigation

Lien : https://github.com/ReC82/Dig/issues/41. Rapport du 30/10/2026, 22 h 25 (Bruxelles), rédigé par une session autonome digorch.

## 1. État réel

**Déployé en production (SHA `bb8464c`). En attente de recette et de ton choix de logo.**

Classement : **« Après lancement »**. C'est de l'identité visuelle : le MVP fonctionne avec le titre actuel.

## 2. Résultat et changements

### Ce qui est actif pour tous les joueurs

Les deux boutons en haut à droite sont maintenant clairement différenciés :

| | Avant | Maintenant |
|---|---|---|
| **Profil** | emoji 👤 gris, ≈ 34 px | silhouette **pleine dorée** dans une **pastille ronde cerclée d'or** |
| **Paramètres** | emoji ⚙ gris, ≈ 34 px | **engrenage ajouré gris clair**, sans pastille |
| Libellés accessibles | « Compte » / « Paramètres » | « Profil et compte » / « Paramètres », traduits FR/EN/NL, et **infobulle** au survol sur ordinateur |
| Zone tactile | ≈ 34 × 30 px | **44 × 44 px** (40 × 44 sous 380 px de large, pour ne pas toucher le titre) |

Les pictogrammes sont des SVG intégrés à la page, donc identiques sur tous les appareils (les emoji changeaient selon le téléphone).

La hauteur de l'en-tête et la place des compteurs ne changent pas : 55 px avant et après, mesuré sur 320, 360, 390 et 1280 px de large. Les boutons sont en position absolue, hors du flux.

### Ce qui reste en aperçu (rien d'activé)

Le logo par défaut reste le titre texte « ⛏ DIG! ». J'ai préparé **4 propositions compactes**. Elles sont toutes **moins larges que le titre actuel** (170 px aujourd'hui) et hautes de 40 px :

| | Proposition | Largeur à 40 px |
|---|---|---|
| **A — Lingot** | lettres d'or taillées comme une pierre ; le point du « ! » est une gemme turquoise | 102 px |
| **B — Strates** | lettres coupées en couches terre / pierre / filon d'or, comme les blocs | 102 px |
| **C — Écusson** | bloc de pierre biseauté avec une pioche dorée, puis « DIG! » | 144 px |
| **D — Pioche** | le « I » de DIG! devient une pioche (manche en bois, fer d'acier) | 98 px |

Pour les voir dans le vrai jeu, ajoute `?logo=a`, `b`, `c` ou `d` à l'adresse. L'aperçu n'est **pas mémorisé** : il disparaît au rechargement sans le paramètre, et les joueurs ne voient rien.

**Planche comparative** (vrai en-tête, smartphone 390 px et ordinateur) : `art/logo/candidates/planche-comparative.png`, consultable sur https://github.com/ReC82/Dig/blob/develop/art/logo/candidates/planche-comparative.png.

### Génération IA depuis le panel

L'atelier d'icônes (#40, onglet 🎨 Icônes, famille « Interface ») a une nouvelle cible **« Logo DIG! — emblème compact »**. Son brief demande un emblème carré : bloc de pierre et pioche dorée, sans texte, lisible à 32–40 px, dans le style des blocs v1 (la pierre de référence est jointe).

Chaque proposition générée a un bouton **« Voir dans le vrai en-tête ↗ »**. Il ouvre le jeu avec `?logo=media:<empreinte>` : l'emblème s'affiche devant le mot « DIG! », à la place du titre, pour juger l'encombrement réel.

### Fichiers

- nouveaux :
  - `public/js/logoPreview.js` (aperçu `?logo=`) ;
  - `public/assets/logo/{a-lingot,b-strates,c-ecusson,d-pioche}.svg` ;
  - `art/logo/candidates/planche-comparative.png` ;
  - `test/logo-identity.test.js` (5 tests) ;
- modifiés :
  - `public/index.html` (boutons SVG, `id="game-logo"`) ;
  - `public/css/style.css` ;
  - `public/js/i18n.js` (`account.header_aria` en FR/EN/NL, prise en charge de `data-i18n-title`) ;
  - `server/iconStudio.js` (cible `ui:logo`) ;
  - `public/admin/admin.js` (lien d'aperçu).

## 3. SHA, branche, procédure de test

- Branche : `feature/41-identite-logo`, commit `7468617`.
- **`develop` : `bb8464c`**, qui est aussi le SHA déployé.
- `npm test` : **351/351** sur la branche, sur `develop` et sur la release.
- Essais sur un serveur de test (port 3101, base jetable) puis en production, avec Chromium headless (smartphone 390×844, ordinateur 1280×900, et 320 / 360 px) :
  - mesures de l'en-tête et des boutons ;
  - clic sur Profil et sur Paramètres : l'écran Paramètres s'ouvre ;
  - libellés et infobulles présents ;
  - aucune erreur JavaScript, y compris en `?logo=media:…`.

## 4. Vérifications, limites, données joueurs

- **Aucune migration, aucune donnée touchée**. Le changement porte sur le client, plus une entrée dans une liste de constantes de l'atelier.
- Contrôle sur une copie de la base de production : les empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` sont identiques avant et après le démarrage. La copie a été supprimée.
- **Aucune génération IA payante** n'a été faite : la génération de logos n'entre pas dans le cadre autorisé (#22), et le budget restant est faible (≈ 2,02 / 3 USD dépensés selon #40). Les 4 propositions sont des SVG dessinés à la main, gratuits et nets à toute taille.
- Limites :
  - **Profil et Paramètres ouvrent toujours le même écran** (Paramètres, section Compte en haut), comme avant. Seule l'apparence a changé (voir décision 3).
  - **L'onglet Améliorations de la barre du bas utilise encore ⚙**, comme les Paramètres (voir décision 2).
  - Les propositions sont en SVG plat-dégradé, pas en rendu 3D comme les icônes v1. Pour un emblème 3D cohérent avec les blocs, il faut passer par la génération IA du panel.

## 5. Déploiement

- SHA déployé : **`bb8464c`**, par avance rapide de `main` `bee0df4` → `bb8464c` puis `scripts/deploy.sh` de la release.
- Sauvegarde vérifiée : `~/backups/dig/dig-20261030-221933-pre-deploy-bb8464c.sqlite`.
- Contrôles après déploiement :
  - dig.lodygames.com et dig.lodylands.com → 200, `/api/version` = `1.0.0+bb8464c` ;
  - SVG et `logoPreview.js` servis ;
  - journal sans erreur, `quick_check` ok ;
  - empreintes joueurs identiques à la sauvegarde ;
  - navigateur en production : smartphone et ordinateur, avec et sans `?logo=c`, sans erreur.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep bee0df4` puis `sudo systemctl restart dig`. Il n'y a rien en base à défaire.

### Test fonctionnel à faire par le propriétaire (3 min)

1. Sur le téléphone puis sur le PC, ouvre https://dig.lodygames.com et actualise une fois.
   - Attendu en haut à droite : une **pastille dorée avec une silhouette** (Profil), puis un **engrenage gris** (Paramètres).
   - Les compteurs n'ont pas bougé.
   - Sur PC, le survol affiche « Profil et compte » ou « Paramètres ».
2. Touche chaque bouton : l'écran Paramètres s'ouvre (comme avant). Les boutons doivent être faciles à toucher.
3. Ouvre successivement https://dig.lodygames.com/?logo=a, puis `?logo=b`, `?logo=c` et `?logo=d`. Compare avec la planche. Note la proposition préférée, ou ce qu'il faut changer.
4. (Facultatif, ≈ 0,25 USD) /admin/ → 🎨 Icônes → famille Interface → **Logo DIG! — emblème compact** → ✨ Générer, 1 variante → **Voir dans le vrai en-tête ↗**.

## 6. Choix techniques faits seul

- **SVG intégrés** plutôt que les pictogrammes IA de #40 pour Profil et Paramètres : ils sont nets à 22–30 px, ne coûtent rien et suivent la couleur du thème. Les pictogrammes IA restent disponibles dans l'atelier si tu préfères une version 3D.
- **Contraste par la forme et par la couleur** :
  - Profil : forme pleine, dorée, dans une pastille ;
  - Paramètres : forme ajourée, grise, sans pastille.

  On les distingue même en niveaux de gris.
- **Libellé « Profil et compte »** : le bouton ouvre la section Compte. Le libellé reste donc honnête.
- **Aperçu par l'URL, non mémorisé** : aucun risque que des joueurs voient une proposition par accident. Les valeurs inconnues sont ignorées ; seule une empreinte de 16 caractères hexadécimaux est acceptée pour `media:`.
- **Lettres dessinées en tracés** (pas de police) : le rendu est identique partout, sans téléchargement de police. Les lettres sont biseautées comme une pierre taillée, pour rappeler les blocs.

## 7. Décisions demandées au propriétaire

1. **Logo** : A, B, C, D, un emblème IA du panel, ou on garde le titre actuel ? Recommandation : **C — Écusson**. L'emblème carré se réutilise ensuite pour l'icône d'application (PWA) et les réseaux sociaux, tout en restant plus étroit que le titre actuel. Après ton choix, une session l'active par défaut (changement réversible) et met l'icône PWA en cohérence si tu le souhaites.
2. **Améliorations ⚙ dans la barre du bas** : cet onglet a le même engrenage que les Paramètres. Faut-il le remplacer ? Options :
   - (a) pioche avec flèche montante, en SVG ;
   - (b) emoji ⏫ ;
   - (c) garder ⚙.

   Recommandation : **(a)**, cohérent avec le brief « améliorations » de l'atelier.
3. **Destination du bouton Profil** : aujourd'hui, il ouvre le même écran que Paramètres. Faut-il qu'il fasse défiler directement jusqu'à la section Compte, et que Paramètres s'ouvre sur Langue et Historique ? Recommandation : oui (petit changement client, sans risque).

## 8. Éléments restant à réaliser

- Activer le logo choisi (décision 1), et éventuellement mettre l'icône PWA en cohérence.
- Pictogramme Améliorations (décision 2) et destination du bouton Profil (décision 3).
- Facultatif : générer 1 à 3 emblèmes IA dans l'atelier, si le budget est relevé (voir #40, décision 1).
