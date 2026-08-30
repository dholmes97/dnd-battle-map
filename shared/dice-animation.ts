const MIN_PREVIEW_COUNT = 4;
const PREVIEW_COUNT_VARIANTS = 4;

function hashSeed(seed: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0 || 0x9e3779b9;
}

function nextState(state: number) {
  let value = state;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

export function deterministicDiePreviewValues(
  seed: string,
  sides: number,
  count?: number,
) {
  if (!Number.isInteger(sides) || sides < 2) return [];
  const previewCount = count === undefined
    ? MIN_PREVIEW_COUNT + (hashSeed(`${seed}:preview-count`) % PREVIEW_COUNT_VARIANTS)
    : Number.isInteger(count) ? Math.max(0, count) : MIN_PREVIEW_COUNT;
  const values: number[] = [];
  let state = hashSeed(seed);
  for (let index = 0; index < previewCount; index += 1) {
    state = nextState(state);
    let value = (state % sides) + 1;
    if (sides > 2 && value === values.at(-1)) value = (value % sides) + 1;
    values.push(value);
  }
  return values;
}
