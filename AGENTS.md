# Project direction

- Treat cohesive, high-resolution full-scene maps as the only map-authoring workflow. Do not restore the retired generic terrain or fragment-based editor.
- Scene additions must be generated for and visually matched to their specific base map.
- Keep the battle map visually dominant: desktop layouts must fit the map within the browser viewport, with controls and sidebars scrolling independently when needed.
- Keep global map launchers in the compact top toolbar; do not duplicate creature-palette or map-workshop controls in the right sidebar.
- Size the desktop map from its live CSS container; do not freeze its dimensions from an early JavaScript layout measurement, and explicitly stretch the desktop grid column so the base flex layout's centered content rule cannot shrink-wrap it.
- Preserve the map navigation convention: the desktop viewport fills the entire available stage, 100% uses a centered cover view with square grid cells, the dedicated Fit control or zooming out from 100% enters a whole-map Fit view (the only letterboxed state), scroll zooms toward the pointer, and left-dragging empty map space reveals cropped edges while token dragging remains direct; do not require right-click.
- The DM must be able to press and immediately drag any visible token on the map without selecting its sidebar card first.
- Token moves, placements, and deletions must never globally block the map while awaiting confirmation. Preserve optimistic per-token mutations, reconcile them with authoritative responses, and roll back only the rejected token action.
- Keep the join surface limited to the three trusted fixed identities: Dan (Dar'eleth) and Barry (Jelton) as players, plus Kevin as DM. Do not restore free-form name, role, or encounter-code fields unless explicitly requested.
- A summon or familiar inherits its controller dynamically from `summoner_token_id`; never present it as separately unclaimed, copy ownership as independent state, or authorize it through a stale copied owner.
- Keep the creature library storage-backed and lazy: searchable metadata belongs in D1, original/thumbnail bytes belong in R2, palette results are paged, thumbnails load only when visible, and full token art loads only for placement previews or tokens on the active map.
- Creature catalog records must carry placement-ready defaults: average HP, hit dice, AC, challenge rating, creature type, size, and separate walk/fly/swim/climb/burrow speeds. Placement initializes current and maximum HP from the catalog default.
- Grow the production creature catalog through the secret-protected batch importer in groups of at most ten; never commit its bearer token or authorize imports through the selectable DM role.
- Verify changes locally first. Publish the Sites project only when the user explicitly asks.
- Preserve server-authoritative shared state, durable D1 history, temporary browser drafts, and the public accountless trusted-group model.
