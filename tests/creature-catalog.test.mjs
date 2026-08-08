import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const catalog = JSON.parse(await readFile(new URL("../catalog/creatures.json", import.meta.url), "utf8"));

test("defines exactly enough researched creatures for a 500-entry production catalog", () => {
  assert.equal(catalog.existingProductionCount, 17);
  assert.equal(catalog.targetProductionTotal, 500);
  assert.equal(catalog.additions.length, 483);
  assert.equal(new Set(catalog.additions.map((creature) => creature.id)).size, 483);
  assert.equal(catalog.additions.filter((creature) => creature.source.kind === "srd-5.1").length, 329);
  assert.equal(catalog.additions.filter((creature) => creature.source.kind === "campaign-original").length, 10);
  assert.equal(catalog.additions.filter((creature) => creature.source.kind === "original").length, 144);
});

test("makes every creature placement-ready", () => {
  const sizes = new Set(["tiny", "small", "medium", "large", "huge", "gargantuan"]);
  for (const creature of catalog.additions) {
    assert.match(creature.id, /^[a-z0-9-]+$/);
    assert.ok(creature.name);
    assert.ok(creature.family);
    assert.ok(creature.creatureType);
    assert.ok(sizes.has(creature.size), `${creature.id} size`);
    assert.ok(Number.isInteger(creature.defaultHp) && creature.defaultHp > 0, `${creature.id} HP`);
    assert.ok(Number.isInteger(creature.armorClass) && creature.armorClass > 0, `${creature.id} AC`);
    assert.equal(typeof creature.speeds.walk, "number", `${creature.id} walk speed`);
    for (const mode of ["fly", "swim", "climb", "burrow"]) {
      assert.ok(creature.speeds[mode] === null || typeof creature.speeds[mode] === "number", `${creature.id} ${mode} speed`);
    }
    assert.ok(creature.artDirection);
  }
});
