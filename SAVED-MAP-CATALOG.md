# Saved AI Map Catalog

Verified locally August 7, 2026. The `EMBER-KEEP` DM library contains the six
original prompt fixtures plus the following twenty additional editable map
packages. Each additional package has a unique prompt, seed, environment/mood/
feature signature, terrain layout, and stamp/wall composition.

| Saved map | Environment | Mood | Signature content |
| --- | --- | --- | --- |
| Moonlit Witch's Bog | Swamp | Moonlight | Mangroves, black pools, ritual altar, glowing mushrooms |
| Drowned Marsh Causeway | Swamp | Overcast | Stream, earth causeway, reeds, broken rope bridge |
| Lizardfolk Reed Camp | Swamp | Daylight | Muddy pools, reed beds, campfire, supplies |
| Oasis Caravan Ambush | Desert | Daylight | Oasis pool, dunes, abandoned cart, barrel cache |
| Red Canyon Shrine | Desert | Overcast | Boulder funnel, altar, warding glyph, spike pit |
| Buried Desert Necropolis | Desert | Torchlight | Dunes, broken crypts, bones, altar, supplies |
| Salt-Flat Battlefield | Desert | Overcast | Open salt waste, battle bones, wrecked cart, rubble |
| Frozen Watchtower | Tundra | Overcast | Ice spires, collapsed tower, exposed snow path |
| Aurora Stone Circle | Tundra | Moonlight | Standing stones, glowing rune, ice spires |
| Glacial Crevasse Camp | Tundra | Daylight | Chasm trap, rope bridge, expedition camp, ice |
| Snowbound Caravan | Tundra | Overcast | Cart roadblock, supplies, boulders, winding trail |
| Caldera Cult Ritual | Volcanic | Moonlight | Lava vents, standing stones, ward, black altar |
| Obsidian Forge | Volcanic | Torchlight | Lava, forge altar, supplies, ruined industrial walls |
| Ash-Choked Battlefield | Volcanic | Overcast | Ash field, bones, cart wreck, rubble berms |
| Fire-Giant Approach | Volcanic | Torchlight | Lava river, rope bridge, stone islands, molten vents |
| Pirate Smuggler Cove | Coast | Moonlight | Broken vessel, campfire, contraband crates, tidewater |
| Storm Lighthouse Ruins | Coast | Overcast | Collapsed tower, wreck timbers, rocks, flooded steps |
| Sunken Tidal Temple | Coast | Daylight | Stone circle, fountain pool, ward, shallow water |
| Shipwreck Salvage Beach | Coast | Overcast | Beached wreck, cart, barrels, dunes, shoreline lanes |
| Fey Thorn Labyrinth | Forest | Moonlight | Dense brambles, mushrooms, rune, ritual clearing |

## New reusable art

- `terrain-swamp-mud-01.png`
- `terrain-desert-sand-01.png`
- `terrain-tundra-snow-01.png`
- `terrain-volcanic-ash-01.png`
- `terrain-lava-crust-01.png`

All five are 1254 × 1254 RGB PNG terrain textures generated with the built-in
image workflow and copied into `public/assets/terrain/`. The complete 28-piece
stamp library now resolves to dedicated transparent RGBA raster artwork in
`public/assets/map-stamps/`, including environment-specific mangroves, reeds,
dunes, ice spires, lava vents, and coastal wrecks. Rotation, flipping, layering,
and package export continue to operate on the stamp definitions independently
of their art assets.

## Verification

- `npm test` validates all nine environment generators, all twenty theme
  signatures, package round-trips, signature stamps/terrain, and unique package
  fingerprints. It also requires all 28 stamp definitions to resolve to unique
  PNG files with preserved RGBA transparency.
- `npm run maps:seed-prompts` is idempotent by exact source prompt and reported
  twenty creations plus six original updates on the first expanded run.
- `npm run maps:verify-prompts` independently read the D1-backed encounter state
  and confirmed 20/20 additional maps are durable, distinct, editable, and
  visible only to DMs.
