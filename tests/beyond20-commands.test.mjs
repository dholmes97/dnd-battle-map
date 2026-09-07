import assert from "node:assert/strict";
import test from "node:test";
import { linkBeyond20, syncBeyond20Hp } from "../worker/commands/beyond20-commands.ts";
import { beyond20HpTransition } from "../shared/beyond20-hp.ts";
import { parseCommandRequest } from "../shared/command-parser.ts";

function fixture() {
  const calls = [];
  return { calls, encounter: { id: "encounter", campaignId: "campaign" }, participant: { role: "player", identityId: "owner" }, now: 10,
    payload: { tokenId: "hero", characterId: "123", hp: 18, maximumHp: 30, temporaryHp: 0, expectedHp: 20, expectedTemporaryHp: 5 },
    links: {
      findLink: async () => ({ characterId: "pc", sheetId: "123", controllerIdentityId: "owner" }),
      sheetInUse: async () => false,
      setLink: async (...args) => calls.push(["link", ...args]),
    },
    tokens: {
      findToken: async () => ({ hp: 20, max_hp: 30, temporary_hp: 5 }),
      hasConcentration: async () => true,
      updateHp: async (...args) => calls.push(["hp", ...args]),
    },
    services: { commit: async (...args) => calls.push(["commit", ...args]), loadState: async () => ({ version: 2 }) },
  };
}

test("HP sync sets the snapshot once and uses the ordinary undoable HP history and concentration flag", async () => {
  const context = fixture();
  const result = await syncBeyond20Hp(context);
  assert.equal(result.payload.concentrationCheckRequired, true);
  assert.deepEqual(context.calls[0], ["hp", "encounter", "hero", 18, 0, 10]);
  assert.deepEqual(context.calls[1], ["commit", "hp_changed", { tokenId: "hero", from: 20, to: 18, fromTemporaryHp: 5, toTemporaryHp: 0, concentrationCheckRequired: true, source: "beyond20" }]);
});

test("wrong sheet, wrong owner (including DM), missing identity and missing campaign link cannot sync", async () => {
  for (const patch of [
    (c) => { c.payload.characterId = "456"; },
    (c) => { c.participant.identityId = "other"; },
    (c) => { c.participant = { role: "dm", identityId: "other" }; },
    (c) => { c.participant.identityId = null; },
    (c) => { c.links.findLink = async () => null; },
    (c) => { c.links.findLink = async () => ({ sheetId: null, controllerIdentityId: "owner" }); },
  ]) {
    const c = fixture(); patch(c);
    assert.equal((await syncBeyond20Hp(c)).status, 403);
    assert.deepEqual(c.calls, []);
  }
});

test("sync rejects changed maximum HP, stale map HP and stale temporary HP without writes", async () => {
  for (const patch of [{ maximumHp: 31 }, { expectedHp: 19 }, { expectedTemporaryHp: 0 }, { hp: -1 }]) {
    const c = fixture(); Object.assign(c.payload, patch);
    assert.equal((await syncBeyond20Hp(c)).status, 409);
    assert.deepEqual(c.calls, []);
  }
});

test("duplicate snapshots are no-ops, healing skips concentration, temporary HP loss prompts", async () => {
  const duplicate = fixture(); Object.assign(duplicate.payload, { hp: 20, temporaryHp: 5, expectedHp: 1 });
  assert.equal((await syncBeyond20Hp(duplicate)).payload.updated, false);
  assert.deepEqual(duplicate.calls, []);
  const heal = fixture(); Object.assign(heal.payload, { hp: 25, temporaryHp: 5 });
  assert.equal((await syncBeyond20Hp(heal)).payload.concentrationCheckRequired, false);
  const temp = fixture(); temp.payload.hp = 20;
  assert.equal((await syncBeyond20Hp(temp)).payload.concentrationCheckRequired, true);
});

test("only DM may link, links must be unique, and unchanged links don't write", async () => {
  const player = fixture(); assert.equal((await linkBeyond20(player)).status, 403);
  const dm = fixture(); dm.participant.role = "dm";
  assert.equal((await linkBeyond20(dm)).payload.linked, true); assert.deepEqual(dm.calls, []);
  dm.payload.characterId = "456"; dm.links.sheetInUse = async () => true;
  assert.equal((await linkBeyond20(dm)).status, 409); assert.deepEqual(dm.calls, []);
  dm.links.sheetInUse = async () => false;
  await linkBeyond20(dm);
  assert.deepEqual(dm.calls, [["link", "campaign", "pc", "456", "encounter", 10], ["commit", null]]);
  dm.calls.length = 0; dm.payload.characterId = null;
  await linkBeyond20(dm); assert.equal(dm.calls[0][3], null);
});

test("HP transition and transport validation reject malformed snapshots", () => {
  assert.equal(beyond20HpTransition({ hp: 20, maxHp: 30, temporaryHp: 5 }, { hp: 18, maximumHp: 30, temporaryHp: 0 }).hp, 18);
  for (const hp of [-1, 31, NaN, 0.5, Infinity]) assert.ok("error" in beyond20HpTransition({ hp: 20, maxHp: 30, temporaryHp: 0 }, { hp, maximumHp: 30, temporaryHp: 0 }));
  const payload = fixture().payload;
  assert.equal(parseCommandRequest({ command: "sync-beyond20-hp", ...payload }).ok, true);
  for (const patch of [{ hp: "18" }, { expectedHp: undefined }, { characterId: "bad" }, { temporaryHp: 100001 }, { maximumHp: 0 }]) assert.equal(parseCommandRequest({ command: "sync-beyond20-hp", ...payload, ...patch }).ok, false);
  assert.equal(parseCommandRequest({ command: "link-beyond20", tokenId: "hero", characterId: null }).ok, true);
});
