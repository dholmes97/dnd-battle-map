import assert from "node:assert/strict";
import test from "node:test";
import {
  identityControlsToken,
  resolveTokenController,
} from "../shared/token-control.ts";

const kevin = { identityId: "identity-kevin", name: "Kevin" };
const barry = { identityId: "identity-barry", name: "Barry" };

test("campaign character relationships determine control independently of token names", () => {
  const tokens = new Map([
    ["jelton", { id: "renamed-druid-token", campaignCharacterId: "character-jelton", summonerTokenId: null }],
    ["imp", { id: "imp", campaignCharacterId: null, summonerTokenId: "jelton" }],
    ["familiar", { id: "familiar", campaignCharacterId: null, summonerTokenId: "imp" }],
  ]);
  const characterControllers = new Map([["character-jelton", barry]]);
  assert.deepEqual(resolveTokenController(tokens.get("jelton"), tokens, characterControllers, kevin), barry);
  assert.deepEqual(resolveTokenController(tokens.get("imp"), tokens, characterControllers, kevin), barry);
  assert.deepEqual(resolveTokenController(tokens.get("familiar"), tokens, characterControllers, kevin), barry);
  assert.deepEqual(resolveTokenController({ id: "dragon" }, tokens, characterControllers, kevin), kevin);
});

test("players control only their identity's tokens while the DM controls all", () => {
  assert.equal(identityControlsToken({ name: "Barry", role: "player", identityId: "identity-barry" }, barry), true);
  assert.equal(identityControlsToken({ name: "Barry", role: "player", identityId: "identity-other" }, barry), false);
  assert.equal(identityControlsToken({ name: "Kevin", role: "dm", identityId: "identity-kevin" }, barry), true);
});
