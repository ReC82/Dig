# Prompt maître — icônes de matériaux DIG! (bibliothèque v1)

Version : `v1.0` (2026-10-29). Toute modification de ce gabarit crée une nouvelle version et ne
s'applique qu'aux matériaux générés ensuite ; la provenance de chaque asset est consignée dans
`art/icons/v1/manifest.json`.

## Gabarit (utilisé par `tools/icons/generate.js`)

Le texte entre les marqueurs `PROMPT` est envoyé à l'API. `{{SUBJECT}}`, `{{PALETTE}}` et
`{{DETAILS}}` viennent de `tools/icons/materials.json` ; `{{REFERENCE}}` est rempli seulement
quand une image de référence validée est jointe (édition).

<!-- PROMPT -->
{{SUBJECT}}, premium stylized 3D low-poly game resource icon. {{DETAILS}} {{PALETTE}} Softly illuminated by a warm golden-white key light from the upper left, delicate highlights along a few facet edges, darker lower faces, soft ambient occlusion between facets. Slight three-quarter view, centered, visually substantial and readable at small sizes on a dark interface. Modern polished fantasy mining game aesthetic, sophisticated but not photorealistic, neither cartoon emoji nor flat vector art. One isolated object only. No text, no border, no UI card, no pedestal, no scenery, no floor, no cast shadow outside the object. True transparent alpha background. Square 1024x1024 canvas, object occupying approximately 75 percent of canvas, consistent margins.{{REFERENCE}}
<!-- /PROMPT -->

## Clause de référence (édition avec image validée)

<!-- REFERENCE -->
 Match exactly the rendering style, lighting direction, facet density, camera angle, scale, margins and material finish of the provided reference icon; only the material changes.
<!-- /REFERENCE -->

## Paramètres constants

| Paramètre | Valeur |
|---|---|
| Taille | `1024x1024` |
| Format | `png`, `background: transparent` |
| Qualité | `high` |
| Images par appel | `n = 1` (2 ou 3 propositions = 2 ou 3 appels) |
| Post-traitement | recadrage sur la boîte alpha, recentrage, **marge 12 %** par côté (objet ≈ 76 %), exports WebP 256 et 128 |
| Référence | dès qu'une pierre est validée : `art/icons/v1/reference/pierre.png`, envoyée à `/v1/images/edits` pour chaque nouveau matériau |
