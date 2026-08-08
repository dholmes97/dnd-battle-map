// Coarse health bands. The server never sends exact HP for tokens a viewer does
// not control, so players read health as a band and the map ring snaps to the
// band's ratio instead of animating a number they are not allowed to see.
export const HEALTH_BANDS = Object.freeze([
  "unharmed",
  "injured",
  "bloodied",
  "near-death",
  "down",
]);

export function healthBand(hp, maxHp) {
  if (hp === null || hp === undefined) return null;
  if (maxHp === null || maxHp === undefined || maxHp <= 0) return null;
  if (hp <= 0) return "down";
  const ratio = hp / maxHp;
  if (ratio >= 1) return "unharmed";
  if (ratio > 0.5) return "injured";
  if (ratio > 0.25) return "bloodied";
  return "near-death";
}

// The fraction of the ring a viewer sees when they only know the band.
export const HEALTH_BAND_RATIO = Object.freeze({
  unharmed: 1,
  injured: 0.75,
  bloodied: 0.5,
  "near-death": 0.25,
  down: 0,
});

export const HEALTH_BAND_LABEL = Object.freeze({
  unharmed: "Unharmed",
  injured: "Injured",
  bloodied: "Bloodied",
  "near-death": "Near death",
  down: "Down",
});

export const HEALTH_BAND_COLOR = Object.freeze({
  unharmed: "#7ebc8a",
  injured: "#d3c169",
  bloodied: "#dd9146",
  "near-death": "#d95f59",
  down: "#6f6862",
});

export function healthBandRatio(band) {
  return HEALTH_BAND_RATIO[band] ?? null;
}

export function healthBandLabel(band) {
  return HEALTH_BAND_LABEL[band] ?? null;
}

export function healthBandColor(band) {
  return HEALTH_BAND_COLOR[band] ?? "#6f6862";
}

// What the viewer should actually see: the exact ratio when the server trusted
// them with numbers, otherwise the band's stepped ratio.
export function displayHealth(hp, maxHp, band) {
  const exact = hp !== null && hp !== undefined && maxHp !== null && maxHp !== undefined && maxHp > 0;
  const resolvedBand = exact ? healthBand(hp, maxHp) : band ?? null;
  if (!resolvedBand) return null;
  return {
    band: resolvedBand,
    exact,
    ratio: exact ? Math.max(0, Math.min(1, hp / maxHp)) : healthBandRatio(resolvedBand) ?? 0,
    color: healthBandColor(resolvedBand),
    label: exact ? `${hp}/${maxHp}` : healthBandLabel(resolvedBand),
  };
}
