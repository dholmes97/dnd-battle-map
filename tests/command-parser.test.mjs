import assert from "node:assert/strict";
import test from "node:test";

import { commandParserCoverage, commandRequest, parseCommandRequest } from "../shared/command-parser.ts";
import { testMapPackage } from "./fixtures/map-fixture.ts";

test("command parser narrows valid payloads and strips transport fields", () => {
  const parsed = parseCommandRequest({
    participantId: "participant-1",
    sessionSecret: "session-secret",
    command: "set-vision-door-open",
    doorId: "door-1",
    open: true,
  });
  assert.deepEqual(parsed, {
    ok: true,
    request: { command: "set-vision-door-open", payload: { doorId: "door-1", open: true } },
  });
});

test("runtime validation covers every declared command", () => {
  assert.deepEqual(commandParserCoverage(), { complete: true, missing: [] });
});

test("browser adapters serialize the typed payload in the compatible flat envelope", () => {
  assert.deepEqual(commandRequest("correct-turn", { round: 2, activeOrder: 3 }), {
    command: "correct-turn",
    round: 2,
    activeOrder: 3,
  });
});

test("command parser rejects missing, mismatched, and malformed payloads", () => {
  for (const value of [
    { command: "not-a-command" },
    { command: "set-strict-movement" },
    { command: "set-strict-movement", enabled: "yes" },
    { command: "set-initiative-group", tokenIds: ["one", 2], initiative: 10 },
    { command: "create-token", name: "Wolf", kind: "monster", size: "medium", speed: 40, x: "3", y: 4 },
  ]) assert.equal(parseCommandRequest(value).ok, false);
});

test("command parser bounds collection-valued writes before command execution", () => {
  assert.equal(parseCommandRequest({
    command: "set-initiative-group",
    tokenIds: Array.from({ length: 101 }, (_, index) => `token-${index}`),
    initiative: 10,
  }).ok, false);
  assert.equal(parseCommandRequest({
    command: "update-shared-fog",
    polygon: Array.from({ length: 101 }, (_, index) => ({ x: index % 10, y: index % 8 })),
  }).ok, false);
});

test("command parser accepts empty, map, and optional payload variants", () => {
  const mapPackage = testMapPackage();
  assert.deepEqual(parseCommandRequest({ command: "undo", ignored: true }), {
    ok: true,
    request: { command: "undo", payload: {} },
  });
  const applied = parseCommandRequest({ command: "apply-map-draft", mapPackage });
  assert.equal(applied.ok, true);
  assert.equal(applied.ok && applied.request.command, "apply-map-draft");
  assert.equal(applied.ok && applied.request.payload.mapPackage.id, mapPackage.id);
  assert.equal(parseCommandRequest({ command: "apply-map-draft" }).ok, false);
  assert.equal(parseCommandRequest({ command: "send-chat-message", message: "Hello", handoutId: null }).ok, true);
  const creature = parseCommandRequest({
    command: "create-token", name: "Dragon", kind: "monster", size: "large", speed: 40,
    flySpeed: 80, swimSpeed: 40, x: 3, y: 4,
  });
  assert.equal(creature.ok, true);
  assert.deepEqual(creature.ok && creature.request.payload, {
    name: "Dragon", kind: "monster", size: "large", speed: 40,
    flySpeed: 80, swimSpeed: 40, x: 3, y: 4,
  });
});

test("command parser also accepts an explicit payload envelope for adapter flexibility", () => {
  assert.deepEqual(parseCommandRequest({ command: "apply-hp", payload: { tokenId: "token-1", delta: -4 } }), {
    ok: true,
    request: { command: "apply-hp", payload: { tokenId: "token-1", delta: -4 } },
  });
});
