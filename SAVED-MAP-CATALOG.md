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
image workflow and copied into `public/assets/terrain/`. The complete stamp
library now contains fifty families with five dedicated transparent RGBA raster
variants apiece: 250 unique files in `public/assets/map-stamps/`. It includes
environment-specific mangroves, reeds, dunes, ice spires, lava vents, coastal
wrecks, expanded trees and rocks, furnishings, ruins, camps, and small details.
Variant choice is deterministic from the package seed, while the selected-stamp
editor can deliberately advance to another variant. Orthographic pieces retain
rotation and flipping; perspective-sensitive art is fixed to its authored
orientation. Layering and package export remain independent of the art files.
Stamp images are web-optimized to a maximum 768-pixel dimension, which remains
well above their rendered map size while keeping the complete public release
within the Sites artifact limit.

## Verification

- `npm test` validates all nine environment generators, all twenty theme
  signatures, package round-trips, signature stamps/terrain, and unique package
  fingerprints. It also requires exactly fifty stamp definitions, five unique
  PNG variants each, preserved RGBA transparency, seed-stable choices, and
  fixed rotation for perspective-sensitive art.
- `npm run maps:seed-prompts` is idempotent by exact source prompt. The August 7
  variant migration updated all twenty-six local presets without creating
  duplicates.
- `npm run maps:verify-prompts` independently read the D1-backed encounter state
  and confirmed 20/20 additional maps are durable, distinct, editable, and
  visible only to DMs.
- Browser verification confirmed all fifty families are available in the
  workshop palette and the five-variant/fixed-orientation controls render.
