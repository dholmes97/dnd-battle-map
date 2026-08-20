export const ALTITUDE_STEP_FEET = 5;
export const MAX_ALTITUDE_FEET = 1_000;

export function normalizeAltitude(value: unknown) {
  const altitude = Math.trunc(Number(value));
  if (!Number.isFinite(altitude)) return 0;
  return Math.min(MAX_ALTITUDE_FEET, Math.max(0, altitude));
}

export function stepAltitude(current: unknown, direction: number) {
  const altitude = normalizeAltitude(current);
  if (direction === 0) return altitude;
  return normalizeAltitude(altitude + Math.sign(direction) * ALTITUDE_STEP_FEET);
}
