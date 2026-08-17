import type { CreatureTemplate } from "@/shared/creature-library";
import { renderMapPackageOverlayToContext } from "@/app/map-scene-renderer";
import { tokenRadiusCells } from "@/shared/creature-library";
import type { EncounterState, MapPoint, ParticipantSession, SharedAnnotation, SharedToken } from "@/shared/contracts";
import { calculateDirectDistance, tokenArtScale, viewportGeometry } from "@/shared/battle-map-geometry";
import { displayHealth } from "@/shared/health";
import { SPELL_EFFECT_KIND, spellEffectByArt, type SpellEffectDefinition } from "@/shared/spell-effects";

export type TokenPreview = MapPoint & { tokenId: string };
export type PlacementPreview = MapPoint & { creature: CreatureTemplate };
export type SpellPlacementPreview = MapPoint & { spell: SpellEffectDefinition };
export type BattleMapViewport = { zoom: number; centerX: number; centerY: number; mapKey: string; fit: boolean };

const fogMaskCanvases = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
const TOKEN_COLORS = ["#c97546", "#639a72", "#8c72b8", "#628aaa", "#a16b75"];
const TOKEN_LABEL_MIN_CELL_PX = 30;
const PING_PULSE_COUNT = 3;
const PING_PULSE_MS = 420;
export const PING_DURATION_MS = PING_PULSE_COUNT * PING_PULSE_MS;
export const SPOTLIGHT_DURATION_MS = 6_500;

function tokenInitial(token: SharedToken) {
  return token.name.trim().charAt(0).toUpperCase() || "?";
}

function spellParticleSeed(value: string, index: number) {
  let hash = 2166136261 ^ index;
  for (let character = 0; character < value.length; character += 1) {
    hash ^= value.charCodeAt(character);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

export function tokenHasEffect(token: SharedToken, effectName: string) {
  const normalizedName = effectName.trim().toLocaleLowerCase();
  return token.effects.some((effect) => effect.name.trim().toLocaleLowerCase() === normalizedName);
}

function drawBlessEffect(
  context: CanvasRenderingContext2D,
  token: SharedToken,
  x: number,
  y: number,
  radius: number,
  animationNow: number,
) {
  if (!tokenHasEffect(token, "Bless")) return;
  const time = animationNow / 1_000;
  const seed = spellParticleSeed(token.id, 77);
  const angle = time * 0.38 + seed * Math.PI * 2;
  const orbit = radius * 1.38;
  const moteX = x + Math.cos(angle) * orbit;
  const moteY = y + Math.sin(angle) * orbit;
  const flareCycle = (time + seed * 5.4) % 5.4;
  const flare = flareCycle < 0.48 ? Math.sin(Math.PI * flareCycle / 0.48) ** 2 : 0;
  const moteRadius = Math.max(1.35, radius * 0.06) * (1 + flare * 0.48);
  context.save();
  context.globalCompositeOperation = "screen";
  context.shadowColor = "#ffe9a0";
  context.shadowBlur = Math.max(4.5, radius * 0.16) + flare * radius * 0.28;
  context.globalAlpha = 0.66 + Math.sin(time * 2.1 + seed * 4) * 0.08 + flare * 0.2;
  context.fillStyle = "#ffe18a";
  context.beginPath(); context.arc(moteX, moteY, moteRadius, 0, Math.PI * 2); context.fill();
  context.globalAlpha *= 0.72;
  context.lineWidth = Math.max(0.7, radius * 0.02);
  context.strokeStyle = "#fff7d1";
  context.beginPath();
  context.moveTo(moteX - moteRadius * 1.55, moteY); context.lineTo(moteX + moteRadius * 1.55, moteY);
  context.moveTo(moteX, moteY - moteRadius * 1.55); context.lineTo(moteX, moteY + moteRadius * 1.55);
  context.stroke();
  if (flare > 0.02) {
    context.globalAlpha = flare * 0.38;
    context.lineWidth = Math.max(0.6, radius * 0.016);
    context.beginPath();
    context.moveTo(moteX - moteRadius * 2.5, moteY - moteRadius * 2.5); context.lineTo(moteX + moteRadius * 2.5, moteY + moteRadius * 2.5);
    context.moveTo(moteX + moteRadius * 2.5, moteY - moteRadius * 2.5); context.lineTo(moteX - moteRadius * 2.5, moteY + moteRadius * 2.5);
    context.stroke();
  }
  context.restore();
}

function drawHasteEffect(
  context: CanvasRenderingContext2D,
  token: SharedToken,
  x: number,
  y: number,
  radius: number,
  animationNow: number,
) {
  if (!tokenHasEffect(token, "Haste")) return;
  const time = animationNow / 1_000;
  const seed = spellParticleSeed(token.id, 91);
  const intervals = [0, 1, 2, 3].map((index) => 3 + spellParticleSeed(token.id, 120 + index) * 2);
  const sequenceDuration = intervals.reduce((total, interval) => total + interval, 0);
  const shiftedTime = time + seed * sequenceDuration;
  const sequenceIndex = Math.floor(shiftedTime / sequenceDuration);
  let phase = shiftedTime % sequenceDuration;
  let pulseSlot = 0;
  while (pulseSlot < intervals.length - 1 && phase >= intervals[pulseSlot]) {
    phase -= intervals[pulseSlot];
    pulseSlot += 1;
  }
  const pulseDuration = 1.05;
  if (phase > pulseDuration) return;
  const pulseKey = sequenceIndex * intervals.length + pulseSlot;
  const clockPosition = Math.floor(spellParticleSeed(token.id, 200 + pulseKey) * 12);
  const angle = clockPosition * Math.PI * 2 / 12 - Math.PI / 2;
  const orbit = radius * 1.4;
  const pulseX = x + Math.cos(angle) * orbit;
  const pulseY = y + Math.sin(angle) * orbit;
  const progress = phase / pulseDuration;
  const intensity = progress < 0.1 ? progress / 0.1 : Math.max(0, 1 - (progress - 0.1) / 0.9) ** 0.62;
  const boltRotation = spellParticleSeed(token.id, 410 + pulseKey) * Math.PI * 2;
  const drift = radius * 0.13 * progress;
  const boltX = pulseX + Math.cos(boltRotation + Math.PI / 2) * drift;
  const boltY = pulseY + Math.sin(boltRotation + Math.PI / 2) * drift;
  const boltLength = Math.max(9, radius * 0.55);
  const bendA = (spellParticleSeed(token.id, 500 + pulseKey * 3) - 0.5) * boltLength * 0.24;
  const bendB = (spellParticleSeed(token.id, 501 + pulseKey * 3) - 0.5) * boltLength * 0.3;
  const bendC = (spellParticleSeed(token.id, 502 + pulseKey * 3) - 0.5) * boltLength * 0.22;
  context.save();
  context.globalCompositeOperation = "screen";
  context.lineCap = "round";
  context.lineJoin = "round";
  context.shadowColor = "#7de6ff";
  context.shadowBlur = Math.max(5, radius * 0.16) * intensity;
  context.globalAlpha = intensity;
  context.translate(boltX, boltY);
  context.rotate(boltRotation);
  context.beginPath();
  context.moveTo(-boltLength * 0.52, 0);
  context.lineTo(-boltLength * 0.25, bendA);
  context.lineTo(-boltLength * 0.04, bendB);
  context.lineTo(boltLength * 0.2, bendC);
  context.lineTo(boltLength * 0.52, -bendA * 0.35);
  context.moveTo(-boltLength * 0.04, bendB);
  context.lineTo(boltLength * 0.1, bendB - boltLength * 0.22);
  context.lineTo(boltLength * 0.3, bendB - boltLength * 0.34);
  context.strokeStyle = "rgba(79, 202, 255, 0.5)";
  context.lineWidth = Math.max(2.4, radius * 0.085);
  context.stroke();
  context.strokeStyle = "#e8fcff";
  context.lineWidth = Math.max(0.9, radius * 0.026);
  context.stroke();
  context.restore();
}

function drawSpellEffect(
  context: CanvasRenderingContext2D,
  token: SharedToken,
  x: number,
  y: number,
  radius: number,
  art: HTMLImageElement | null,
  animationNow: number,
  selected: boolean,
  owned: boolean,
) {
  const spell = spellEffectByArt(token.artAsset);
  if (!spell) return;
  const time = animationNow / 1_000;
  const isMoonbeam = spell.id === "moonbeam";
  const isMagicCircle = spell.id === "magic-circle";
  const isGenericShape = spell.shape !== null;
  const pulseSpeed = isMoonbeam ? 2.1 : isMagicCircle ? 1.35 : 5.2;
  const pulseDepth = isMoonbeam ? 0.055 : isMagicCircle ? 0.025 : 0.095;
  const pulse = 1 + Math.sin(time * pulseSpeed + spellParticleSeed(token.id, 1) * 5) * pulseDepth;
  if (isGenericShape) {
    const halfSize = radius * 1.16;
    context.save();
    if (token.hidden) context.globalAlpha = 0.48;
    context.globalCompositeOperation = "screen";
    context.fillStyle = `${spell.accent}20`;
    context.strokeStyle = selected ? "#fff2ad" : spell.accent;
    context.shadowColor = spell.accent;
    context.shadowBlur = selected ? 12 : owned ? 7 : 4;
    context.lineWidth = selected ? 3 : 2;
    context.setLineDash([Math.max(5, radius * 0.12), Math.max(4, radius * 0.08)]);
    context.beginPath();
    if (spell.shape === "square") context.rect(x - halfSize, y - halfSize, halfSize * 2, halfSize * 2);
    else context.arc(x, y, halfSize, 0, Math.PI * 2);
    context.fill(); context.stroke();
    context.setLineDash([]);
    context.globalAlpha *= 0.72;
    context.lineWidth = 1;
    context.beginPath();
    if (spell.shape === "square") context.rect(x - halfSize * 0.88, y - halfSize * 0.88, halfSize * 1.76, halfSize * 1.76);
    else context.arc(x, y, halfSize * 0.88, 0, Math.PI * 2);
    context.stroke();
    context.restore();
    return;
  }
  // Magic Circle's PNG keeps transparent breathing room around its outer
  // ornament. Compensate for that padding so the visible ring—not the image
  // box—lands at the full ten-foot radius.
  const visualRadius = radius * (isMoonbeam ? 1.25 : isMagicCircle ? 1.25 : 1.36);

  context.save();
  if (token.hidden) context.globalAlpha = 0.48;
  const aura = context.createRadialGradient(x, y, visualRadius * 0.08, x, y, visualRadius * 1.22);
  if (isMoonbeam) {
    aura.addColorStop(0, "rgba(245,248,255,.78)");
    aura.addColorStop(0.38, "rgba(154,186,255,.28)");
    aura.addColorStop(0.75, "rgba(120,102,255,.12)");
    aura.addColorStop(1, "rgba(80,70,210,0)");
  } else if (isMagicCircle) {
    aura.addColorStop(0, "rgba(255,247,200,.08)");
    aura.addColorStop(0.54, "rgba(255,220,112,.1)");
    aura.addColorStop(0.82, "rgba(255,190,62,.18)");
    aura.addColorStop(1, "rgba(255,176,38,0)");
  } else {
    aura.addColorStop(0, "rgba(255,244,178,.9)");
    aura.addColorStop(0.3, "rgba(255,125,24,.38)");
    aura.addColorStop(0.72, "rgba(221,40,12,.16)");
    aura.addColorStop(1, "rgba(170,20,0,0)");
  }
  context.globalCompositeOperation = "screen";
  context.fillStyle = aura;
  context.beginPath(); context.arc(x, y, visualRadius * 1.22 * pulse, 0, Math.PI * 2); context.fill();

  if (art) {
    context.save();
    context.translate(x, y);
    context.rotate(time * (isMoonbeam ? 0.13 : isMagicCircle ? 0.055 : 0.72));
    const plateRadius = visualRadius * pulse;
    context.globalAlpha *= isMoonbeam ? 0.86 : isMagicCircle ? 0.92 : 0.94;
    context.drawImage(art, -plateRadius, -plateRadius, plateRadius * 2, plateRadius * 2);
    context.restore();
    if (!isMagicCircle) {
      context.save();
      context.translate(x, y);
      context.rotate(-time * (isMoonbeam ? 0.22 : 0.46));
      const echoRadius = visualRadius * (isMoonbeam ? 0.76 : 0.7) * (2 - pulse);
      context.globalAlpha *= isMoonbeam ? 0.34 : 0.46;
      context.drawImage(art, -echoRadius, -echoRadius, echoRadius * 2, echoRadius * 2);
      context.restore();
    }
  }

  if (isMoonbeam) {
    context.save();
    context.translate(x, y);
    context.rotate(-time * 0.18);
    context.strokeStyle = "rgba(226,235,255,.8)";
    context.shadowColor = "#a9c7ff";
    context.shadowBlur = Math.max(8, radius * 0.24);
    context.lineWidth = Math.max(1.2, radius * 0.025);
    context.setLineDash([radius * 0.16, radius * 0.11]);
    context.beginPath(); context.arc(0, 0, radius * 1.05, 0, Math.PI * 2); context.stroke();
    context.setLineDash([]);
    context.restore();
    for (let index = 0; index < 12; index += 1) {
      const seed = spellParticleSeed(token.id, index + 10);
      const orbit = visualRadius * (0.38 + seed * 0.7);
      const angle = seed * Math.PI * 2 + time * (0.18 + (index % 3) * 0.07);
      const flicker = 0.35 + 0.65 * Math.abs(Math.sin(time * 2.3 + seed * 12));
      context.globalAlpha = flicker;
      context.fillStyle = index % 3 === 0 ? "#ffffff" : "#b8d0ff";
      context.shadowColor = "#d8e5ff"; context.shadowBlur = 8;
      context.beginPath(); context.arc(x + Math.cos(angle) * orbit, y + Math.sin(angle) * orbit, Math.max(1.2, radius * (0.022 + seed * 0.025)), 0, Math.PI * 2); context.fill();
    }
  } else if (isMagicCircle) {
    context.save();
    context.translate(x, y);
    context.rotate(-time * 0.13);
    context.strokeStyle = "rgba(255,239,164,.76)";
    context.shadowColor = "#ffd66b";
    context.shadowBlur = Math.max(9, radius * 0.2);
    context.lineWidth = Math.max(1.2, radius * 0.018);
    context.setLineDash([radius * 0.12, radius * 0.08]);
    context.beginPath(); context.arc(0, 0, visualRadius * 0.84, 0, Math.PI * 2); context.stroke();
    context.setLineDash([]);
    context.restore();
    for (let index = 0; index < 8; index += 1) {
      const angle = index * Math.PI / 4 + time * 0.06;
      const flare = 0.42 + Math.sin(time * 2 + index * 0.9) * 0.2;
      context.globalAlpha = flare;
      context.fillStyle = index % 2 === 0 ? "#fff8ce" : "#bde8ff";
      context.shadowColor = "#ffe38a"; context.shadowBlur = 8;
      context.beginPath(); context.arc(x + Math.cos(angle) * visualRadius * 0.88, y + Math.sin(angle) * visualRadius * 0.88, Math.max(1.2, radius * 0.018), 0, Math.PI * 2); context.fill();
    }
  } else {
    for (let index = 0; index < 18; index += 1) {
      const seed = spellParticleSeed(token.id, index + 30);
      const cycle = (time * (0.42 + seed * 0.35) + seed * 5) % 1;
      const orbit = visualRadius * (0.45 + cycle * 0.9);
      const angle = seed * Math.PI * 2 + time * (0.9 + seed);
      context.globalAlpha = (1 - cycle) * (0.45 + seed * 0.55);
      context.fillStyle = seed > 0.64 ? "#fff4a8" : seed > 0.3 ? "#ff9b21" : "#ff3b0a";
      context.shadowColor = "#ff5a00"; context.shadowBlur = 7;
      const emberSize = Math.max(1.2, radius * (0.018 + seed * 0.035));
      context.beginPath(); context.arc(x + Math.cos(angle) * orbit, y + Math.sin(angle) * orbit, emberSize, 0, Math.PI * 2); context.fill();
    }
    context.globalAlpha = 0.28 + Math.sin(time * 8) * 0.06;
    context.strokeStyle = "#ffd05a";
    context.lineWidth = Math.max(1.5, radius * 0.045);
    context.beginPath(); context.arc(x, y, radius * (0.72 + Math.sin(time * 4.4) * 0.05), 0, Math.PI * 2); context.stroke();
  }

  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
  context.shadowBlur = 0;
  if ((selected || owned) && !isMagicCircle) {
    context.strokeStyle = selected ? "#f5c65c" : spell.accent;
    context.lineWidth = selected ? 2.4 : 1.2;
    context.globalAlpha = selected ? 0.95 : 0.48;
    context.setLineDash(selected ? [5, 5] : [2, 5]);
    context.beginPath(); context.arc(x, y, radius * 1.22, 0, Math.PI * 2); context.stroke();
  }
  context.restore();
}

function transientSpotlightOpacity(annotation: SharedAnnotation, animationNow: number) {
  if (annotation.expiresAt === null) return 0;
  const remaining = annotation.expiresAt - animationNow;
  const elapsed = SPOTLIGHT_DURATION_MS - remaining;
  if (remaining <= 0 || elapsed < 0) return 0;
  return Math.min(1, elapsed / 260, remaining / 1_350);
}

function drawArcaneSpotlight(
  context: CanvasRenderingContext2D,
  annotation: SharedAnnotation,
  x: number,
  y: number,
  cellSize: number,
  animationNow: number,
) {
  const opacity = transientSpotlightOpacity(annotation, animationNow);
  if (opacity <= 0 || annotation.expiresAt === null) return;
  const elapsed = SPOTLIGHT_DURATION_MS - (annotation.expiresAt - animationNow);
  const time = elapsed / 1_000;
  const radius = cellSize * 1.42;
  context.save();
  context.globalCompositeOperation = "screen";

  const glow = context.createRadialGradient(x, y, radius * 0.08, x, y, radius);
  glow.addColorStop(0, `rgba(255, 247, 190, ${0.48 * opacity})`);
  glow.addColorStop(0.38, `rgba(115, 216, 255, ${0.22 * opacity})`);
  glow.addColorStop(0.72, `rgba(170, 112, 255, ${0.12 * opacity})`);
  glow.addColorStop(1, "rgba(80, 40, 180, 0)");
  context.fillStyle = glow;
  context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();

  for (let beam = 0; beam < 3; beam += 1) {
    const sway = Math.sin(time * (0.7 + beam * 0.12) + beam * 2.1) * radius * 0.18;
    const beamWidth = radius * (0.22 + beam * 0.025);
    const beamTop = y - radius * (2.3 + beam * 0.18);
    const beamGradient = context.createLinearGradient(0, beamTop, 0, y + radius * 0.55);
    beamGradient.addColorStop(0, "rgba(190, 225, 255, 0)");
    beamGradient.addColorStop(0.36, `rgba(190, 225, 255, ${0.12 * opacity})`);
    beamGradient.addColorStop(1, "rgba(255, 236, 170, 0)");
    context.fillStyle = beamGradient;
    context.beginPath();
    context.moveTo(x + sway - beamWidth * 0.25, beamTop);
    context.lineTo(x + sway + beamWidth * 0.25, beamTop);
    context.lineTo(x + beamWidth, y + radius * 0.55);
    context.lineTo(x - beamWidth, y + radius * 0.55);
    context.closePath(); context.fill();
  }

  for (let particle = 0; particle < 26; particle += 1) {
    const seed = spellParticleSeed(annotation.id, 200 + particle);
    const angle = seed * Math.PI * 2 + Math.sin(time * 0.7 + seed * 8) * 0.35;
    const orbit = radius * (0.18 + spellParticleSeed(annotation.id, 300 + particle) * 0.8);
    const fall = (time * (0.32 + seed * 0.2) + seed) % 1;
    const px = x + Math.cos(angle) * orbit;
    const py = y - radius * 1.35 + fall * radius * 2.15;
    const size = Math.max(1, cellSize * (0.018 + seed * 0.025));
    context.globalAlpha = opacity * Math.sin(Math.PI * fall) * (0.45 + seed * 0.45);
    context.fillStyle = particle % 3 === 0 ? "#f7d77d" : particle % 3 === 1 ? "#9ce8ff" : "#d5a7ff";
    context.shadowColor = context.fillStyle;
    context.shadowBlur = size * 4;
    context.beginPath(); context.arc(px, py, size, 0, Math.PI * 2); context.fill();
  }

  const ringPulse = (time * 0.58) % 1;
  context.globalAlpha = opacity * (1 - ringPulse) * 0.72;
  context.strokeStyle = "#ffeaa3";
  context.lineWidth = Math.max(1.5, cellSize * 0.045);
  context.setLineDash([cellSize * 0.12, cellSize * 0.11]);
  context.beginPath(); context.arc(x, y, radius * (0.28 + ringPulse * 0.72), 0, Math.PI * 2); context.stroke();
  context.restore();
}

function drawNeonSpotlight(
  context: CanvasRenderingContext2D,
  annotation: SharedAnnotation,
  x: number,
  y: number,
  cellSize: number,
  animationNow: number,
) {
  const opacity = transientSpotlightOpacity(annotation, animationNow);
  if (opacity <= 0 || annotation.expiresAt === null) return;
  const elapsed = SPOTLIGHT_DURATION_MS - (annotation.expiresAt - animationNow);
  const time = elapsed / 1_000;
  const flicker = Math.sin(time * 23) > -0.84 ? 1 : 0.38;
  const pulse = 0.88 + Math.sin(time * 6.4) * 0.12;
  const scale = cellSize * pulse;
  const startX = x - scale * 2.5;
  const startY = y - scale * 1.85;
  const bendX = x - scale * 0.72;
  const bendY = y - scale * 0.72;

  context.save();
  context.globalCompositeOperation = "screen";
  context.globalAlpha = opacity * flicker;
  context.lineCap = "round";
  context.lineJoin = "round";
  const traceArrow = () => {
    context.beginPath();
    context.moveTo(startX, startY);
    context.lineTo(bendX, bendY);
    context.lineTo(x - scale * 0.62, y - scale * 1.25);
    context.moveTo(bendX, bendY);
    context.lineTo(x - scale * 1.26, y - scale * 0.62);
  };
  context.strokeStyle = "#ff3fbf";
  context.shadowColor = "#ff2cae";
  context.shadowBlur = scale * 0.34;
  context.lineWidth = Math.max(8, scale * 0.2);
  traceArrow(); context.stroke();
  context.strokeStyle = "#fff7ff";
  context.shadowBlur = scale * 0.12;
  context.lineWidth = Math.max(2.4, scale * 0.055);
  traceArrow(); context.stroke();

  const labelX = startX + scale * 0.7;
  const labelY = startY - scale * 0.18;
  context.font = `900 ${Math.max(13, scale * 0.34)}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "bottom";
  context.strokeStyle = "#112035";
  context.lineWidth = Math.max(4, scale * 0.1);
  context.shadowColor = "#24dfff";
  context.shadowBlur = scale * 0.3;
  context.strokeText("LOOK HERE!", labelX, labelY);
  context.fillStyle = "#7cf5ff";
  context.shadowBlur = scale * 0.18;
  context.fillText("LOOK HERE!", labelX, labelY);

  context.globalAlpha = opacity * (0.65 + Math.sin(time * 8) * 0.2);
  context.strokeStyle = "#ffe76e";
  context.shadowColor = "#ffe14b";
  context.shadowBlur = scale * 0.22;
  context.lineWidth = Math.max(2, scale * 0.045);
  context.beginPath(); context.arc(x, y, scale * (0.2 + ((time * 0.8) % 1) * 0.42), 0, Math.PI * 2); context.stroke();
  context.restore();
}

export function drawMap(
  canvas: HTMLCanvasElement,
  state: EncounterState,
  preview: TokenPreview | null,
  placementPreview: PlacementPreview | null,
  spellPlacementPreview: SpellPlacementPreview | null,
  dragOrigin: MapPoint | null,
  participant: ParticipantSession,
  mapScene: HTMLImageElement | HTMLCanvasElement | null,
  tokenArt: Map<string, HTMLImageElement>,
  viewport: BattleMapViewport,
  pingStartedAt: ReadonlyMap<string, number>,
  animationNow: number,
  selectedTokenId: string | null,
  selectedMapNoteId: string | null,
  gridOpacity: number,
  showColoredTokenCenters: boolean,
  showHealthRings: boolean,
  sharedFogPreview: MapPoint[] | null,
  selectedSharedFogVertex: number | null,
) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  const geometry = viewportGeometry(viewport, state, rect.width, rect.height);
  const cellWidth = geometry.cellSize;
  const cellHeight = geometry.cellSize;
  const screenX = (mapX: number) => geometry.offsetX + (mapX - geometry.panX) * geometry.cellSize;
  const screenY = (mapY: number) => geometry.offsetY + (mapY - geometry.panY) * geometry.cellSize;
  context.fillStyle = "#242622";
  context.fillRect(0, 0, rect.width, rect.height);
  const mapPackage = state.encounter.mapPackage;
  if (mapScene && mapPackage) {
    const sourceWidth = geometry.visibleWidth / state.grid.width * mapScene.width;
    const sourceHeight = geometry.visibleHeight / state.grid.height * mapScene.height;
    const sourceX = geometry.panX / state.grid.width * mapScene.width;
    const sourceY = geometry.panY / state.grid.height * mapScene.height;
    context.drawImage(
      mapScene,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      geometry.offsetX,
      geometry.offsetY,
      geometry.visibleWidth * geometry.cellSize,
      geometry.visibleHeight * geometry.cellSize,
    );
    renderMapPackageOverlayToContext(
      context,
      mapPackage,
      geometry.cellSize,
      geometry.cellSize,
      geometry.offsetX - geometry.panX * geometry.cellSize,
      geometry.offsetY - geometry.panY * geometry.cellSize,
      participant.role === "dm",
    );
  } else {
    context.fillStyle = "#4b4b42";
    context.fillRect(
      geometry.offsetX,
      geometry.offsetY,
      geometry.visibleWidth * geometry.cellSize,
      geometry.visibleHeight * geometry.cellSize,
    );
  }

  context.strokeStyle = `rgba(232, 220, 190, ${Math.min(1, Math.max(0, gridOpacity))})`;
  context.lineWidth = 1;
  for (let x = 0; x <= state.grid.width; x += 1) {
    context.beginPath(); context.moveTo(screenX(x), geometry.offsetY); context.lineTo(screenX(x), geometry.offsetY + geometry.visibleHeight * geometry.cellSize); context.stroke();
  }
  for (let y = 0; y <= state.grid.height; y += 1) {
    context.beginPath(); context.moveTo(geometry.offsetX, screenY(y)); context.lineTo(geometry.offsetX + geometry.visibleWidth * geometry.cellSize, screenY(y)); context.stroke();
  }

  const serverFog = state.encounter.fogVisibility;
  // Keep vision on the last server-authoritative geometry while a token is
  // dragged or has a move pending. Pointer previews must never reveal terrain.
  const fogPolygons = serverFog.polygons;
  if (serverFog.mode === "shared" || (serverFog.mode === "dynamic" && participant.role !== "dm")) {
    context.save();
    if (serverFog.mode === "shared") {
      const polygon = participant.role === "dm" ? sharedFogPreview ?? mapPackage?.fog.sharedPolygon ?? [] : serverFog.hiddenPolygon ?? [];
      if (polygon.length >= 3) {
        context.beginPath(); polygon.forEach((point, index) => index ? context.lineTo(screenX(point.x), screenY(point.y)) : context.moveTo(screenX(point.x), screenY(point.y))); context.closePath();
        context.fillStyle = participant.role === "dm" ? "rgba(6, 7, 10, 0.42)" : "rgb(0, 0, 0)"; context.fill();
        if (participant.role === "dm") {
          context.strokeStyle = "rgba(183, 156, 255, 0.85)"; context.lineWidth = 2; context.setLineDash([8, 6]); context.stroke();
          if (sharedFogPreview) {
            context.setLineDash([]);
            for (const [index, point] of polygon.entries()) {
              context.fillStyle = index === selectedSharedFogVertex ? "#f5c65c" : "#f6e9ff"; context.strokeStyle = "#7d52a8"; context.lineWidth = 2;
              context.beginPath(); context.arc(screenX(point.x), screenY(point.y), index === selectedSharedFogVertex ? 8 : 6, 0, Math.PI * 2); context.fill(); context.stroke();
            }
          }
        }
      }
    } else {
      let mask = fogMaskCanvases.get(canvas);
      if (!mask) { mask = canvas.ownerDocument.createElement("canvas"); fogMaskCanvases.set(canvas, mask); }
      const maskWidth = Math.max(1, Math.ceil(rect.width)); const maskHeight = Math.max(1, Math.ceil(rect.height));
      if (mask.width !== maskWidth || mask.height !== maskHeight) { mask.width = maskWidth; mask.height = maskHeight; }
      const maskContext = mask.getContext("2d");
      if (maskContext) {
        maskContext.clearRect(0, 0, maskWidth, maskHeight); maskContext.fillStyle = "rgb(0, 0, 0)"; maskContext.fillRect(0, 0, maskWidth, maskHeight);
        maskContext.globalCompositeOperation = "destination-out"; maskContext.fillStyle = "black";
        for (const polygon of fogPolygons) if (polygon.length >= 3) { maskContext.beginPath(); polygon.forEach((point, index) => index ? maskContext.lineTo(screenX(point.x), screenY(point.y)) : maskContext.moveTo(screenX(point.x), screenY(point.y))); maskContext.closePath(); maskContext.fill(); }
        for (const circle of serverFog.revealedCircles ?? []) { maskContext.beginPath(); maskContext.arc(screenX(circle.x), screenY(circle.y), circle.radius * geometry.cellSize + 0.75, 0, Math.PI * 2); maskContext.fill(); }
        maskContext.globalCompositeOperation = "source-over"; context.drawImage(mask, 0, 0, rect.width, rect.height);
      }
    }
    context.restore();
  }

  const selectedMapNote = participant.role === "dm" && selectedMapNoteId
    ? mapPackage?.notes.find((note) => note.id === selectedMapNoteId) ?? null
    : null;
  if (selectedMapNote) {
    context.save();
    context.strokeStyle = "#f5c65c";
    context.lineWidth = 2.5;
    context.setLineDash([6, 5]);
    context.beginPath();
    context.arc(screenX(selectedMapNote.x), screenY(selectedMapNote.y), Math.max(12, cellWidth * 0.3), 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  for (const annotation of state.annotations) {
    const x = screenX(annotation.x);
    const y = screenY(annotation.y);
    context.save();
    context.strokeStyle = annotation.color;
    context.fillStyle = `${annotation.color}33`;
    context.lineWidth = 3;
    if (annotation.type === "ping") {
      const startedAt = pingStartedAt.get(annotation.id);
      const elapsed = startedAt === undefined ? PING_DURATION_MS : animationNow - startedAt;
      if (elapsed < 0 || elapsed >= PING_DURATION_MS) { context.restore(); continue; }
      const pulseProgress = (elapsed % PING_PULSE_MS) / PING_PULSE_MS;
      const radius = Math.min(cellWidth, cellHeight) * (0.12 + pulseProgress * 0.2);
      context.globalAlpha = Math.max(0, 1 - pulseProgress);
      context.lineWidth = 2.5;
      context.shadowColor = annotation.color;
      context.shadowBlur = 7;
      context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.stroke();
      context.globalAlpha = Math.max(0, 0.82 - elapsed / PING_DURATION_MS);
      context.fillStyle = annotation.color;
      context.beginPath(); context.arc(x, y, Math.min(cellWidth, cellHeight) * 0.055, 0, Math.PI * 2); context.fill();
    } else if (annotation.type === "drawing" && annotation.x2 !== null && annotation.y2 !== null) {
      context.setLineDash([9, 5]);
      context.beginPath(); context.moveTo(x, y); context.lineTo(screenX(annotation.x2), screenY(annotation.y2)); context.stroke();
    } else if (annotation.type === "spotlight") drawArcaneSpotlight(context, annotation, x, y, Math.min(cellWidth, cellHeight), animationNow);
    else if (annotation.type === "neon-spotlight") drawNeonSpotlight(context, annotation, x, y, Math.min(cellWidth, cellHeight), animationNow);
    context.restore();
  }

  state.tokens.filter((token) => token.kind === SPELL_EFFECT_KIND).forEach((token) => {
    const position = preview?.tokenId === token.id ? preview : token;
    const x = screenX(position.x);
    const y = screenY(position.y);
    const radius = Math.min(cellWidth, cellHeight) * tokenRadiusCells(token.size);
    drawSpellEffect(context, token, x, y, radius, token.artAsset ? tokenArt.get(token.artAsset) ?? null : null,
      animationNow, token.id === selectedTokenId, token.controlledByViewer);
  });

  if (preview && dragOrigin) {
    const movingToken = state.tokens.find((token) => token.id === preview.tokenId);
    if (movingToken?.kind !== SPELL_EFFECT_KIND) {
      const distance = calculateDirectDistance(dragOrigin, preview, state.grid.feetPerCell);
      const overMovement = Boolean(movingToken && distance > movingToken.speed + 0.05);
      const rulerColor = overMovement ? "#ef6656" : "#f5c65c";
      const startX = screenX(dragOrigin.x);
      const startY = screenY(dragOrigin.y);
      const endX = screenX(preview.x);
      const endY = screenY(preview.y);
      const middleX = (startX + endX) / 2;
      const middleY = (startY + endY) / 2;
      const label = `${distance} ft`;

      context.save();
      context.strokeStyle = rulerColor;
      context.lineWidth = 3;
      context.setLineDash([3, 7]);
      context.beginPath();
      context.moveTo(startX, startY);
      context.lineTo(endX, endY);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = rulerColor;
      context.beginPath(); context.arc(startX, startY, 5, 0, Math.PI * 2); context.fill();
      context.font = "700 12px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.textAlign = "center";
      context.textBaseline = "middle";
      const labelWidth = context.measureText(label).width + 14;
      context.fillStyle = "rgba(24, 22, 19, 0.92)";
      context.fillRect(middleX - labelWidth / 2, middleY - 12, labelWidth, 24);
      context.strokeStyle = rulerColor;
      context.lineWidth = 1.5;
      context.strokeRect(middleX - labelWidth / 2, middleY - 12, labelWidth, 24);
      context.fillStyle = rulerColor;
      context.fillText(label, middleX, middleY + 0.5);
      context.restore();
    }
  }

  state.tokens.filter((token) => token.kind !== SPELL_EFFECT_KIND).forEach((token, index) => {
    const position = preview?.tokenId === token.id ? preview : token;
    const owned = token.controller.name.toLocaleLowerCase() === participant.name.toLocaleLowerCase();
    const active = token.initiativeOrder !== null && token.initiativeOrder === state.encounter.activeInitiativeOrder;
    const selected = token.id === selectedTokenId;
    // Exact when the server trusted this viewer with numbers, otherwise the
    // ring snaps to the band so players read "bloodied", never "37/104".
    const health = displayHealth(token.hp, token.maxHp, token.healthState);
    const down = health?.band === "down";
    const x = screenX(position.x);
    const y = screenY(position.y);
    const radius = Math.min(cellWidth, cellHeight) * tokenRadiusCells(token.size);
    const smallestTokenRadius = Math.min(cellWidth, cellHeight) * tokenRadiusCells("tiny");
    const hasLargeFootprint = token.size === "large" || token.size === "huge" || token.size === "gargantuan";
    context.save();
    if (token.hidden) context.globalAlpha *= 0.48;
    if (down) context.globalAlpha *= 0.55;
    context.shadowColor = "rgba(0,0,0,.45)";
    context.shadowBlur = showColoredTokenCenters ? 10 : 5;
    context.fillStyle = showColoredTokenCenters
      ? active ? "#f5c65c" : TOKEN_COLORS[index % TOKEN_COLORS.length]
      : "rgba(16, 15, 13, 0.12)";
    context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
    context.shadowBlur = 0;
    const art = token.artAsset ? tokenArt.get(token.artAsset) : null;
    if (art) {
      const artRadius = radius * tokenArtScale(token.size);
      context.save();
      context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.clip();
      context.drawImage(art, x - artRadius, y - artRadius, artRadius * 2, artRadius * 2);
      context.restore();
    } else {
      context.fillStyle = showColoredTokenCenters ? "#261d18" : "#f3eadb";
      if (!showColoredTokenCenters) {
        context.shadowColor = "rgba(0, 0, 0, 0.9)";
        context.shadowBlur = 4;
      }
      context.font = `800 ${Math.max(12, radius * 0.88)}px ui-sans-serif, system-ui`;
      context.textAlign = "center"; context.textBaseline = "middle";
      context.fillText(tokenInitial(token), x, y + 1);
    }
    if (showColoredTokenCenters) {
      context.strokeStyle = owned ? "#fff1ba" : active ? "#ffe29a" : "#f0d0a0";
      context.lineWidth = hasLargeFootprint ? Math.max(0.5, radius * 0.025) : Math.max(1, radius * 0.05);
      context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.stroke();
    }

    if (health && showHealthRings) {
      const healthRadius = radius * 1.12;
      // Keep the HP ring as slim as it is on a Tiny token. Its radius still
      // follows the creature footprint, but larger creatures do not get a
      // progressively heavier ring.
      const healthWidth = Math.max(2.5, smallestTokenRadius * 0.17);
      context.lineCap = "butt";
      context.lineWidth = healthWidth;
      context.strokeStyle = "rgba(12, 11, 10, 0.72)";
      context.beginPath(); context.arc(x, y, healthRadius, 0, Math.PI * 2); context.stroke();
      if (health.ratio > 0) {
        context.strokeStyle = health.color;
        context.beginPath();
        context.arc(x, y, healthRadius, -Math.PI / 2, -Math.PI / 2 + health.ratio * Math.PI * 2);
        context.stroke();
      }
      context.lineCap = "butt";
    }
    if (down) {
      context.strokeStyle = health!.color;
      context.lineWidth = Math.max(2, radius * 0.14);
      context.lineCap = "round";
      const slash = radius * 0.6;
      context.beginPath();
      context.moveTo(x - slash, y - slash); context.lineTo(x + slash, y + slash);
      context.moveTo(x + slash, y - slash); context.lineTo(x - slash, y + slash);
      context.stroke();
      context.lineCap = "butt";
    }

    drawBlessEffect(context, token, x, y, radius, animationNow);
    drawHasteEffect(context, token, x, y, radius, animationNow);

    if (token.effects.length > 0) {
      context.fillStyle = token.effects.some((effect) => effect.due) ? "#d95f59" : "#8ec9a0";
      context.beginPath(); context.arc(x + radius * 0.72, y - radius * 0.72, radius * 0.24, 0, Math.PI * 2); context.fill();
    }

    if (selected) {
      context.globalAlpha = 1;
      context.strokeStyle = "#f5c65c";
      context.lineWidth = 2;
      context.setLineDash([4, 4]);
      const selectionRadius = radius + smallestTokenRadius * 0.32;
      context.beginPath(); context.arc(x, y, selectionRadius, 0, Math.PI * 2); context.stroke();
      context.setLineDash([]);
    }

    if (geometry.cellSize >= TOKEN_LABEL_MIN_CELL_PX) {
      const label = token.name.length > 16 ? `${token.name.slice(0, 15)}…` : token.name;
      const fontSize = Math.max(9, Math.min(13, geometry.cellSize * 0.23));
      context.globalAlpha = token.hidden ? 0.6 : 1;
      context.font = `650 ${fontSize}px ui-sans-serif, system-ui`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      const labelY = y + radius * 1.12 + fontSize * 0.95;
      const labelWidth = context.measureText(label).width + fontSize * 0.7;
      context.fillStyle = "rgba(14, 13, 12, 0.78)";
      context.beginPath();
      context.roundRect(x - labelWidth / 2, labelY - fontSize * 0.72, labelWidth, fontSize * 1.44, fontSize * 0.36);
      context.fill();
      context.fillStyle = active ? "#f7dc9d" : owned ? "#efe6d6" : "#c8bfb1";
      context.fillText(label, x, labelY);
    }
    context.restore();
  });

  if (placementPreview) {
    const x = screenX(placementPreview.x);
    const y = screenY(placementPreview.y);
    const radius = Math.min(cellWidth, cellHeight) * tokenRadiusCells(placementPreview.creature.size);
    const art = tokenArt.get(placementPreview.creature.artAsset);
    context.save();
    context.globalAlpha = 0.72;
    context.fillStyle = "rgba(245, 198, 92, 0.28)";
    context.strokeStyle = "#f5c65c";
    context.lineWidth = Math.max(2, radius * 0.08);
    context.setLineDash([7, 5]);
    context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill(); context.stroke();
    context.setLineDash([]);
    if (art) {
      const artRadius = radius * tokenArtScale(placementPreview.creature.size);
      context.drawImage(art, x - artRadius, y - artRadius, artRadius * 2, artRadius * 2);
    }
    context.restore();
  }
  if (spellPlacementPreview) {
    const spellToken: SharedToken = {
      id: `spell-preview-${spellPlacementPreview.spell.id}`,
      name: spellPlacementPreview.spell.name,
      artAsset: spellPlacementPreview.spell.artAsset,
      kind: SPELL_EFFECT_KIND,
      size: spellPlacementPreview.spell.size,
      speed: 0,
      armorClass: null,
      hp: null,
      maxHp: null,
      healthState: null,
      hidden: false,
      summonerTokenId: null,
      initiative: null,
      initiativeGroupId: null,
      initiativeOrder: null,
      turnComplete: false,
      movementUsed: 0,
      movementOrigin: null,
      effects: [],
      controller: { name: participant.name },
      controlledByViewer: true,
      x: spellPlacementPreview.x,
      y: spellPlacementPreview.y,
    };
    const radius = Math.min(cellWidth, cellHeight) * tokenRadiusCells(spellToken.size);
    context.save(); context.globalAlpha = 0.78;
    drawSpellEffect(context, spellToken, screenX(spellToken.x), screenY(spellToken.y), radius,
      tokenArt.get(spellToken.artAsset ?? "") ?? null, animationNow, true, true);
    context.restore();
  }
}
