/** Read-only diagnostics projection. Never retain raw sheets, HTML, URLs or settings. */
export type Beyond20Preview = {
  kind: "hp" | "roll";
  character: { id: string; name: string };
  hp?: number;
  maximumHp?: number;
  temporaryHp?: number;
  title?: string;
  rollType?: string;
  fallback?: boolean;
  whisper?: number;
  rolls?: { formula: string; total: number; dice: { sides: number; values: number[] }[] }[];
};

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const label = (value: unknown, limit = 120) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, limit) : "";
const integer = (value: unknown, min = 0, max = 100_000): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;

export function parseBeyond20Preview(eventName: string, detail: unknown): Beyond20Preview | null {
  // UpdateHP includes four legacy positional arguments after the request.
  // Read only the canonical request; never trust those redundant values.
  if (!Array.isArray(detail) || (detail.length !== 1 && !(eventName === "Beyond20_UpdateHP" && detail.length === 5))) return null;
  const request = record(detail[0]);
  const original = record(request?.request);
  // Rendered rolls carry a display name outside and the sheet identity inside.
  const character = record(eventName === "Beyond20_RenderedRoll" ? original?.character : request?.character);
  if (!request || !character || typeof character.id !== "string" || !/^\d{1,20}$/.test(character.id)) return null;
  const identity = { id: character.id, name: label(character.name) };
  if (eventName === "Beyond20_UpdateHP" && request.action === "hp-update") {
    if (!integer(character.hp) || !integer(character["max-hp"], 1) || !integer(character["temp-hp"]) || character.hp > character["max-hp"]) return null;
    return { kind: "hp", character: identity, hp: character.hp, maximumHp: character["max-hp"], temporaryHp: character["temp-hp"] };
  }
  if (eventName !== "Beyond20_RenderedRoll" || request.action !== "rendered-roll") return null;
  const rawRolls: unknown[] = [];
  if (Array.isArray(request.attack_rolls)) rawRolls.push(...request.attack_rolls.slice(0, 10));
  if (Array.isArray(request.damage_rolls)) {
    for (const entry of request.damage_rolls.slice(0, 10)) if (Array.isArray(entry)) rawRolls.push(entry[1]);
  }
  const rolls: NonNullable<Beyond20Preview["rolls"]> = [];
  for (const raw of rawRolls) {
    const roll = record(raw);
    if (!roll || !integer(roll.total, -100_000)) continue;
    const dice: { sides: number; values: number[] }[] = [];
    if (Array.isArray(roll.parts)) for (const part of roll.parts.slice(0, 20)) {
      const die = record(part);
      if (!die || !integer(die.faces, 1, 1000) || !Array.isArray(die.rolls)) continue;
      const sides = die.faces;
      const values = die.rolls.slice(0, 30).flatMap((item) => {
        const value = record(item)?.roll;
        return integer(value, 1, sides) ? [value] : [];
      });
      dice.push({ sides, values });
    }
    rolls.push({ formula: label(roll.formula), total: roll.total, dice });
  }
  if (!rolls.length) return null;
  return { kind: "roll", character: identity, title: label(request.title), rollType: label(original?.type, 40), fallback: request.rendered === "fallback", whisper: integer(request.whisper, 0, 3) ? request.whisper : undefined, rolls };
}
