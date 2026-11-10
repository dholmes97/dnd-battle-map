import assert from "node:assert/strict";
import test from "node:test";
import { spellArtUsesAnimation } from "../shared/battle-map-animation.ts";
import { parseCommandRequest } from "../shared/command-parser.ts";
import { DEFAULT_SPELL_CONE, pointInSpellCone, spellEffectById } from "../shared/spell-effects.ts";

test("Spell Cone is a static sector measured from its tip in map units", () => {
  const spell = spellEffectById("spell-cone");
  assert.equal(spell.name, "Spell Cone");
  assert.equal(spell.shape, "cone");
  assert.equal(spellArtUsesAnimation(spell.artAsset), false);
  const east = DEFAULT_SPELL_CONE;
  assert.equal(pointInSpellCone(east, 5, 6, 0), true);
  assert.equal(pointInSpellCone(east, 5, 6.01, 0), false);
  assert.equal(pointInSpellCone(east, 5, 3, 3), true);
  assert.equal(pointInSpellCone(east, 5, 3, 3.01), false);
  assert.equal(pointInSpellCone(east, 5, -2, 0), false);
  const north = { ...east, directionDegrees: 359 };
  assert.equal(pointInSpellCone(north, 5, 0, -6), true);
  assert.equal(pointInSpellCone(north, 5, 0, 6), false);
  assert.equal(pointInSpellCone(north, 5, 0, 0), true);
});

test("the command parser bounds cone geometry and rejects non-numeric values", () => {
  const base = { command: "update-token", tokenId: "cone" };
  assert.deepEqual(parseCommandRequest({ ...base, spellCone: DEFAULT_SPELL_CONE }), {
    ok: true,
    request: { command: "update-token", payload: { tokenId: "cone", spellCone: DEFAULT_SPELL_CONE } },
  });
  for (const changes of [{ rangeFeet: 301 }, { rangeFeet: "30" }, { angleDegrees: 0 }, { angleDegrees: 181 }, { directionDegrees: 360 }, { directionDegrees: 2.5 }]) {
    assert.equal(parseCommandRequest({ ...base, spellCone: { ...DEFAULT_SPELL_CONE, ...changes } }).ok, false);
  }
});
