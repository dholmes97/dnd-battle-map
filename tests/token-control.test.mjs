import assert from "node:assert/strict";
import test from "node:test";
import {
  baseTokenControllerName,
  identityControlsToken,
  resolveTokenControllerName,
} from "../shared/token-control.ts";

test("assigns fixed characters and all other base tokens deterministically", () => {
  assert.equal(baseTokenControllerName({ id: "token-bronze-warden", name: "Renamed hero" }), "Dan");
  assert.equal(baseTokenControllerName({ id: "token-ash-mystic", name: "Renamed druid" }), "Barry");
  assert.equal(baseTokenControllerName({ id: "token-ember-scout", name: "Renamed rogue" }), "Scott");
  assert.equal(baseTokenControllerName({ id: "new-dar", name: "Dar'eleth" }), "Dan");
  assert.equal(baseTokenControllerName({ id: "new-jelton", name: "Jelton" }), "Barry");
  assert.equal(baseTokenControllerName({ id: "new-malichar", name: "Malichar" }), "Scott");
  assert.equal(baseTokenControllerName({ id: "monster", name: "Ancient Dragon" }), "Kevin");
});

test("summons inherit their root summoner's controller", () => {
  const tokens = new Map([
    ["jelton", { id: "token-ash-mystic", name: "Jelton", summonerTokenId: null }],
    ["imp", { id: "imp", name: "Imp", summonerTokenId: "jelton" }],
    ["familiar", { id: "familiar", name: "Familiar", summonerTokenId: "imp" }],
  ]);
  assert.equal(resolveTokenControllerName(tokens.get("imp"), tokens), "Barry");
  assert.equal(resolveTokenControllerName(tokens.get("familiar"), tokens), "Barry");
});

test("players control only their identity's tokens while the DM controls all", () => {
  assert.equal(identityControlsToken({ name: "Dan", role: "player" }, "Dan"), true);
  assert.equal(identityControlsToken({ name: "Barry", role: "player" }, "Dan"), false);
  assert.equal(identityControlsToken({ name: "Scott", role: "player" }, "Scott"), true);
  assert.equal(identityControlsToken({ name: "Kevin", role: "dm" }, "Dan"), true);
  assert.equal(identityControlsToken({ name: "Kevin", role: "dm" }, "Kevin"), true);
});
