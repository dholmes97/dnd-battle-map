# Battle-map token art

This library contains the transparent-background tactical fantasy cutouts declared by `manifest.json`. Each asset is a 1254 x 1254 RGBA PNG with a fully transparent outer border and enough padding for either free-standing map art or a UI-applied portrait/token frame. No frame, token ring, text, scenery, or shadow is baked into the image.

## Provenance

- Generated on 2026-08-05 with OpenAI's built-in image-generation tool.
- The final prompt set used one shared production brief: premium painterly fantasy RPG art; a complete single subject; realistic anatomy; three-quarter view from a slightly elevated tactical camera; compact square silhouette; no text, watermark, scenery, frame, ring, or shadow. Asset-specific prompt summaries are recorded in `manifest.json`.
- The three character likenesses were grounded in the user-provided Dar'eleth, Malichar, and Jelton portrait references and the character-continuity guide in the adjacent `D&D Campaign` project. Monster designs were grounded in that project's campaign art for Session 79 (Hungries), Session 80 (young green dragons), and Session 91 (shadow dire warg).
- The adjacent campaign project was read only. No source/reference image was copied into this library, and no campaign-project file was changed.
- Generation produced flat green or magenta chroma-key sources. The project PNGs were then processed with the image-generation skill's local soft-matte/despill helper and visually inspected. The chroma-key intermediates are not part of this project.

## Files

See `manifest.json` for stable IDs, public paths, creature-size hints, and concise prompt specifications. Character assets live under `characters/`; monsters live under `monsters/`.

When the app consumes these assets, apply rings, health/status overlays, selection glow, ownership color, and footprint sizing at runtime so the same art remains reusable in both the map and card UI.
