import assert from "node:assert/strict";
import { composeMapFromPrompt, parseMapPackage } from "../shared/map-package.ts";
import { ADDITIONAL_MAP_PROMPT_CASES, MAP_PROMPT_CASES } from "../shared/map-prompt-cases.ts";

const baseUrl = process.env.BATTLE_MAP_BASE_URL ?? "http://localhost:3000";
const code = process.env.BATTLE_MAP_CODE ?? "EMBER-KEEP";
const endpoint = `${baseUrl}/api/encounters/${encodeURIComponent(code)}`;

async function post(action, body) {
  const response = await fetch(`${endpoint}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `${action} failed with ${response.status}`);
  return result;
}

const joined = await post("join", {
  participantName: "Codex Map Studio",
  role: "dm",
});
const session = {
  participantId: joined.participantId,
  sessionSecret: joined.sessionSecret,
};
let presets = joined.state.savedMapPresets ?? [];
let created = 0;
let updated = 0;

for (const promptCase of MAP_PROMPT_CASES) {
  const composition = composeMapFromPrompt(promptCase.prompt, promptCase.seed);
  const existing = presets.find((preset) => preset.sourcePrompt === promptCase.prompt);
  const saved = await post("command", {
    ...session,
    command: "save-map-preset",
    presetId: existing?.id,
    name: composition.map.name,
    description: composition.map.description,
    sourcePrompt: promptCase.prompt,
    mapPackage: composition.map,
  });
  presets = saved.state.savedMapPresets;
  if (existing) updated += 1;
  else created += 1;
  process.stdout.write(`${existing ? "updated" : "saved"}: ${composition.map.name} [${composition.detectedFeatures.join(", ")}]\n`);
}

for (const promptCase of MAP_PROMPT_CASES) {
  const matches = presets.filter((preset) => preset.sourcePrompt === promptCase.prompt);
  assert.equal(matches.length, 1, `${promptCase.id} must exist exactly once in the durable preset library`);
  const stored = parseMapPackage(matches[0].mapPackage);
  assert.ok(stored, `${promptCase.id} must contain a valid stored package`);
  assert.equal(stored.biome, promptCase.expectedBiome, `${promptCase.id} biome`);
  assert.equal(stored.mood, promptCase.expectedMood, `${promptCase.id} mood`);
  if (promptCase.requiredStamp) assert.ok(stored.stamps.some((stamp) => stamp.definitionId === promptCase.requiredStamp), `${promptCase.id} signature stamp`);
  if (promptCase.distinctiveTerrain) assert.ok(stored.terrain.includes(promptCase.distinctiveTerrain), `${promptCase.id} signature terrain`);
}

assert.equal(ADDITIONAL_MAP_PROMPT_CASES.length, 20);
assert.equal(new Set(ADDITIONAL_MAP_PROMPT_CASES.map((item) => item.prompt)).size, 20);
process.stdout.write(`prompt preset library: ${MAP_PROMPT_CASES.length} verified cases (${ADDITIONAL_MAP_PROMPT_CASES.length} additional; ${created} created, ${updated} updated)\n`);
