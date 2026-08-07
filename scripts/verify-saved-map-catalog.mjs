import assert from "node:assert/strict";
import { parseMapPackage } from "../shared/map-package.ts";
import { ADDITIONAL_MAP_PROMPT_CASES } from "../shared/map-prompt-cases.ts";

const baseUrl = process.env.BATTLE_MAP_BASE_URL ?? "http://localhost:3000";
const code = process.env.BATTLE_MAP_CODE ?? "EMBER-KEEP";
const endpoint = `${baseUrl}/api/encounters/${encodeURIComponent(code)}`;

async function join(participantName, role) {
  const response = await fetch(`${endpoint}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ participantName, role }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `join failed with ${response.status}`);
  return result;
}

const suffix = Date.now().toString(36);
const dm = await join(`Codex Catalog Audit ${suffix}`, "dm");
const player = await join(`Catalog Privacy Audit ${suffix}`, "player");
assert.deepEqual(player.state.savedMapPresets, [], "players must never receive the DM's saved-map catalog");

const fingerprints = [];
for (const promptCase of ADDITIONAL_MAP_PROMPT_CASES) {
  const matches = dm.state.savedMapPresets.filter((preset) => preset.sourcePrompt === promptCase.prompt);
  assert.equal(matches.length, 1, `${promptCase.id} must be saved exactly once`);
  const stored = parseMapPackage(matches[0].mapPackage);
  assert.ok(stored, `${promptCase.id} must remain a valid editable package after D1 round-trip`);
  assert.equal(stored.source.kind, "prompt", `${promptCase.id} source`);
  assert.equal(stored.biome, promptCase.expectedBiome, `${promptCase.id} biome`);
  assert.equal(stored.mood, promptCase.expectedMood, `${promptCase.id} mood`);
  assert.ok(stored.stamps.some((stamp) => stamp.definitionId === promptCase.requiredStamp), `${promptCase.id} signature stamp`);
  assert.ok(stored.terrain.includes(promptCase.distinctiveTerrain), `${promptCase.id} signature terrain`);
  fingerprints.push(JSON.stringify({ biome: stored.biome, mood: stored.mood, terrain: stored.terrain, stamps: stored.stamps, walls: stored.walls }));
}

assert.equal(new Set(fingerprints).size, 20, "all twenty stored packages must remain distinct");
process.stdout.write("saved AI map catalog: 20/20 durable, distinct, editable, and DM-private\n");
