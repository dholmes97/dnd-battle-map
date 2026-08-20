import assert from "node:assert/strict";
import test from "node:test";

import {
  addEffect,
  applyHp,
  createSpellEffect,
  createToken,
  deleteToken,
  resizeSpellEffect,
  updateToken,
} from "../worker/commands/token-effect-commands.ts";

function token(overrides = {}) {
  return {
    id: "token",
    name: "Hero",
    x: 4,
    y: 4,
    art_asset: "hero.png",
    kind: "character",
    size: "medium",
    speed: 30,
    fly_speed: null,
    swim_speed: null,
    climb_speed: null,
    burrow_speed: null,
    armor_class: 18,
    hp: 20,
    max_hp: 30,
    is_hidden: 0,
    summoner_token_id: null,
    initiative: 18,
    initiative_group_id: null,
    initiative_order: 0,
    turn_complete: 0,
    movement_used: 0,
    altitude: 0,
    owner_participant_id: null,
    owner_name: null,
    ...overrides,
  };
}

function context(overrides = {}) {
  const { repository: repoOverrides = {}, ...rest } = overrides;
  const calls = [];
  const repository = {
    findToken: async () => token(),
    createToken: async (value) => calls.push(["create", value]),
    resizeToken: async (...args) => calls.push(["resize", ...args]),
    updateToken: async (value) => calls.push(["update", value]),
    hasConcentration: async () => false,
    updateHp: async (...args) => calls.push(["hp", ...args]),
    addEffect: async (value) => calls.push(["effect", value]),
    findEffect: async () => null,
    removeEffect: async (...args) => calls.push(["remove-effect", ...args]),
    deleteToken: async (...args) => calls.push(["delete", ...args]),
    ...repoOverrides,
  };
  return {
    calls,
    repository,
    encounter: {
      id: "encounter", code: "CODE", name: "Scenario", status: "active",
      mapAsset: "", mapPackageJson: null, activeMapPresetId: null,
      gridWidth: 24, gridHeight: 16, currentRound: 2, activeInitiativeOrder: 0,
      strictMovement: true, updatedAt: 0,
    },
    participant: { id: "dm", name: "Kevin", role: "dm" },
    payload: {},
    now: 10,
    canControl: async () => true,
    isAllowedArt: async () => true,
    services: {
      createId: () => "generated-id",
      loadState: async () => ({ marker: "state" }),
      bumpEncounter: async () => calls.push(["bump"]),
      recordAction: async (...args) => calls.push(["record", ...args]),
    },
    ...rest,
  };
}

test("player-created creatures and spells require the player's root character", async () => {
  const player = { id: "player", name: "Dan", role: "player" };
  const noCaster = context({
    participant: player,
    payload: { name: "Wolf", kind: "monster" },
    repository: { findToken: async () => null },
  });
  assert.equal((await createToken(noCaster)).status, 403);

  const valid = context({
    participant: player,
    payload: { name: "Wolf", armorClass: 13.8, flySpeed: 60, swimSpeed: 0, summonerTokenId: "hero", x: 3, y: 3 },
  });
  const result = await createToken(valid);
  assert.equal(result.payload.created, true);
  const created = valid.calls.find(([name]) => name === "create")[1];
  assert.equal(created.kind, "summon");
  assert.equal(created.armorClass, 13);
  assert.equal(created.flySpeed, 60);
  assert.equal(created.swimSpeed, null);
  assert.equal(created.summonerTokenId, "hero");

  const spell = context({
    participant: player,
    payload: { spellId: "moonbeam", summonerTokenId: "hero", x: 5, y: 5 },
  });
  assert.equal((await createSpellEffect(spell)).payload.created, true);
  assert.equal(spell.calls.find(([name]) => name === "create")[1].kind, "spell-effect");
});

test("HP damage reports concentration checks and clamps at zero", async () => {
  const value = context({
    payload: { tokenId: "token", delta: -50 },
    repository: { hasConcentration: async () => true },
  });
  const result = await applyHp(value);
  assert.equal(result.payload.concentrationCheckRequired, true);
  assert.deepEqual(value.calls.find(([name]) => name === "hp").slice(2, 4), ["token", 0]);
});

test("players can edit controlled token details but not another participant's token", async () => {
  const player = { id: "player", name: "Dan", role: "player" };
  const allowed = context({
    participant: player,
    payload: { tokenId: "token", armorClass: 19, altitude: 35, hidden: true },
  });
  assert.equal((await updateToken(allowed)).payload.updated, true);
  const updated = allowed.calls.find(([name]) => name === "update")[1];
  assert.equal(updated.armorClass, 19);
  assert.equal(updated.altitude, 35);
  assert.equal(updated.hidden, false);

  const denied = context({
    participant: player,
    payload: { tokenId: "token", armorClass: 20 },
    canControl: async () => false,
  });
  assert.equal((await updateToken(denied)).status, 403);
});

test("spell resizing clamps the new footprint and records a reversible token update", async () => {
  const value = context({
    payload: { tokenId: "spell", size: "gargantuan" },
    repository: { findToken: async () => token({ id: "spell", kind: "spell-effect", x: 0, y: 0 }) },
  });
  assert.equal((await resizeSpellEffect(value)).payload.updated, true);
  assert.deepEqual(value.calls.find(([name]) => name === "resize").slice(2, 6), [
    "spell", "gargantuan", 1.72, 1.72,
  ]);
});

test("effects and deletion enforce token control", async () => {
  const denied = context({
    participant: { id: "player", name: "Dan", role: "player" },
    payload: { tokenId: "token", name: "Bless" },
    canControl: async () => false,
  });
  assert.equal((await addEffect(denied)).status, 403);
  assert.equal((await deleteToken(denied)).status, 403);

  const allowedSpell = context({
    participant: { id: "player", name: "Dan", role: "player" },
    payload: { tokenId: "spell" },
    repository: { findToken: async () => token({ id: "spell", kind: "spell-effect" }) },
  });
  assert.equal((await deleteToken(allowedSpell)).payload.deleted, true);
  const dismissal = allowedSpell.calls.find(([name]) => name === "record");
  assert.equal(dismissal[1], "spell_effect_dismissed");
  assert.deepEqual(dismissal[2].token, {
    name: "Hero", x: 4, y: 4, artAsset: "hero.png", kind: "spell-effect",
    size: "medium", speed: 30, flySpeed: null, swimSpeed: null, climbSpeed: null,
    burrowSpeed: null, altitude: 0, armorClass: 18, hp: 20, maxHp: 30,
    hidden: false, summonerTokenId: null, initiative: 18, initiativeOrder: 0,
  });
});
