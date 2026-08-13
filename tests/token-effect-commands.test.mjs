import assert from "node:assert/strict";
import test from "node:test";

import {
  addEffect,
  applyHp,
  createSpellEffect,
  createToken,
  deleteToken,
  resizeSpellEffect,
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
    hp: 20,
    max_hp: 30,
    is_hidden: 0,
    summoner_token_id: null,
    initiative: 18,
    initiative_group_id: null,
    initiative_order: 0,
    turn_complete: 0,
    movement_used: 0,
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
    body: {},
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
    body: { name: "Wolf", kind: "monster" },
    repository: { findToken: async () => null },
  });
  assert.equal((await createToken(noCaster)).status, 403);

  const valid = context({
    participant: player,
    body: { name: "Wolf", summonerTokenId: "hero", x: 3, y: 3 },
  });
  const result = await createToken(valid);
  assert.equal(result.payload.created, true);
  const created = valid.calls.find(([name]) => name === "create")[1];
  assert.equal(created.kind, "summon");
  assert.equal(created.summonerTokenId, "hero");

  const spell = context({
    participant: player,
    body: { spellId: "moonbeam", summonerTokenId: "hero", x: 5, y: 5 },
  });
  assert.equal((await createSpellEffect(spell)).payload.created, true);
  assert.equal(spell.calls.find(([name]) => name === "create")[1].kind, "spell-effect");
});

test("HP damage reports concentration checks and clamps at zero", async () => {
  const value = context({
    body: { tokenId: "token", delta: -50 },
    repository: { hasConcentration: async () => true },
  });
  const result = await applyHp(value);
  assert.equal(result.payload.concentrationCheckRequired, true);
  assert.deepEqual(value.calls.find(([name]) => name === "hp").slice(2, 4), ["token", 0]);
});

test("spell resizing clamps the new footprint and records a reversible token update", async () => {
  const value = context({
    body: { tokenId: "spell", size: "gargantuan" },
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
    body: { tokenId: "token", name: "Bless" },
    canControl: async () => false,
  });
  assert.equal((await addEffect(denied)).status, 403);
  assert.equal((await deleteToken(denied)).status, 403);

  const allowedSpell = context({
    participant: { id: "player", name: "Dan", role: "player" },
    body: { tokenId: "spell" },
    repository: { findToken: async () => token({ id: "spell", kind: "spell-effect" }) },
  });
  assert.equal((await deleteToken(allowedSpell)).payload.deleted, true);
});
