# Project direction

- Treat cohesive, high-resolution full-scene maps as the only map-authoring workflow. Do not restore the retired generic terrain or fragment-based editor.
- Scene additions must be generated for and visually matched to their specific base map.
- Keep the battle map visually dominant: desktop layouts must fit the map within the browser viewport, with controls and sidebars scrolling independently when needed.
- Size the desktop map from its live CSS container; do not freeze its dimensions from an early JavaScript layout measurement, and explicitly stretch the desktop grid column so the base flex layout's centered content rule cannot shrink-wrap it.
- Preserve the map navigation convention: scroll zooms toward the pointer, and left-dragging empty map space pans while token dragging remains direct; do not require right-click.
- Verify changes locally first. Publish the Sites project only when the user explicitly asks.
- Preserve server-authoritative shared state, durable D1 history, temporary browser drafts, and the public accountless trusted-group model.
