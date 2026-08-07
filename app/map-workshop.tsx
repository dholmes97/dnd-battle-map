"use client";

import {
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import NextImage from "next/image";
import {
  MAP_SIZES,
  STAMP_LIBRARY,
  TERRAIN_ASSETS,
  baseTerrainForBiome,
  cloneMapPackage,
  composeMapFromPrompt,
  definitionFor,
  effectiveStampRotation,
  generateMap,
  parseMapPackage,
  rotatedMask,
  stampAssetFor,
  stampVariantFor,
  seedHash,
  terrainIndex,
  type Cell,
  type MapDensity,
  type MapBiome,
  type MapMood,
  type MapPackage,
  type MapRotation,
  type MapSize,
  type PathStyle,
  type StampCategory,
  type TerrainKind,
  type WaterFeature,
} from "@/shared/map-package";

type WorkshopTool = "select" | "terrain" | "wall" | "door" | "window" | "label" | "note";
type WorkshopMap = MapPackage;
type DragState = { pointerId: number; stampId: string; offsetX: number; offsetY: number };
type StampDropPreview = { definitionId: string; x: number; y: number; variant: number };
type WallPreview = { start: Cell; end: Cell };
type SavedMapPreset = {
  id: string;
  name: string;
  description: string;
  sourcePrompt: string | null;
  mapPackage: MapPackage;
  createdAt: number;
  updatedAt: number;
};
type MapWorkshopProps = {
  activeMapPackage: MapPackage | null;
  activeMapPresetId: string | null;
  savedPresets: SavedMapPreset[];
  onCommand: (name: string, extra?: Record<string, unknown>) => Promise<unknown>;
  onClose: () => void;
};

const TERRAIN_FALLBACKS: Record<TerrainKind, string> = {
  grass: "#466d27",
  earth: "#725233",
  water: "#467f89",
  stone: "#66655e",
  cave: "#403a32",
  rubble: "#777064",
  mud: "#51402f",
  sand: "#9b8055",
  snow: "#cbd7d7",
  ash: "#393735",
  lava: "#b64320",
};

function fillTerrainTexture(
  context: CanvasRenderingContext2D,
  kind: TerrainKind,
  image: HTMLImageElement | undefined,
  width: number,
  height: number,
  cellWidth: number,
) {
  const pattern = image ? context.createPattern(image, "repeat") : null;
  if (pattern) pattern.setTransform(new DOMMatrix().scale(Math.max(0.08, cellWidth / 130)));
  context.fillStyle = pattern ?? TERRAIN_FALLBACKS[kind];
  context.fillRect(0, 0, width, height);
}

function organicEdgeNoise(seed: string) {
  return seedHash(seed) / 4294967295;
}

function createTerrainMask(
  map: WorkshopMap,
  kind: TerrainKind,
  width: number,
  height: number,
) {
  const mask = document.createElement("canvas");
  mask.width = Math.max(1, Math.ceil(width));
  mask.height = Math.max(1, Math.ceil(height));
  const context = mask.getContext("2d");
  if (!context) return mask;
  const cellWidth = width / map.width;
  const cellHeight = height / map.height;
  const shortSide = Math.min(cellWidth, cellHeight);

  context.fillStyle = "#fff";
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (map.terrain[terrainIndex(map, x, y)] === kind) {
        context.fillRect(x * cellWidth, y * cellHeight, cellWidth + 0.75, cellHeight + 0.75);
      }
    }
  }

  const edges = [
    { name: "top", dx: 0, dy: -1 },
    { name: "right", dx: 1, dy: 0 },
    { name: "bottom", dx: 0, dy: 1 },
    { name: "left", dx: -1, dy: 0 },
  ] as const;

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (map.terrain[terrainIndex(map, x, y)] !== kind) continue;
      for (const edge of edges) {
        const neighborX = x + edge.dx;
        const neighborY = y + edge.dy;
        if (neighborX < 0 || neighborY < 0 || neighborX >= map.width || neighborY >= map.height) continue;
        if (map.terrain[terrainIndex(map, neighborX, neighborY)] === kind) continue;

        for (let sample = 0; sample < 6; sample += 1) {
          const key = `${map.seed}:${kind}:${x}:${y}:${edge.name}:${sample}`;
          const shape = organicEdgeNoise(`${key}:shape`);
          const radius = shortSide * (0.12 + organicEdgeNoise(`${key}:radius`) * 0.09);
          const along = (sample + 0.45 + organicEdgeNoise(`${key}:along`) * 0.1) / 6;
          const inset = radius * (0.42 + organicEdgeNoise(`${key}:inset`) * 0.28);
          let centerX = (x + 0.5) * cellWidth;
          let centerY = (y + 0.5) * cellHeight;
          if (edge.name === "top" || edge.name === "bottom") {
            centerX = (x + along) * cellWidth;
            centerY = (edge.name === "top" ? y * cellHeight + inset : (y + 1) * cellHeight - inset);
          } else {
            centerX = (edge.name === "left" ? x * cellWidth + inset : (x + 1) * cellWidth - inset);
            centerY = (y + along) * cellHeight;
          }

          context.globalCompositeOperation = shape > 0.48 ? "source-over" : "destination-out";
          if (shape > 0.48) {
            centerX += edge.dx * radius * 0.72;
            centerY += edge.dy * radius * 0.72;
          }
          context.beginPath();
          context.arc(centerX, centerY, radius, 0, Math.PI * 2);
          context.fill();
        }
      }
    }
  }
  context.globalCompositeOperation = "source-over";
  return mask;
}

function paintMaskedTerrain(
  context: CanvasRenderingContext2D,
  map: WorkshopMap,
  kind: TerrainKind,
  image: HTMLImageElement | undefined,
  mask: HTMLCanvasElement,
  width: number,
  height: number,
  blur: number,
  opacity = 1,
) {
  const layer = document.createElement("canvas");
  layer.width = Math.max(1, Math.ceil(width));
  layer.height = Math.max(1, Math.ceil(height));
  const layerContext = layer.getContext("2d");
  if (!layerContext) return;
  fillTerrainTexture(layerContext, kind, image, width, height, width / map.width);
  layerContext.globalCompositeOperation = "destination-in";
  layerContext.filter = blur > 0 ? `blur(${blur}px)` : "none";
  layerContext.drawImage(mask, 0, 0, width, height);
  layerContext.filter = "none";
  layerContext.globalCompositeOperation = "source-over";
  context.save();
  context.globalAlpha = opacity;
  context.drawImage(layer, 0, 0, width, height);
  context.restore();
}

function drawOrganicTerrain(
  context: CanvasRenderingContext2D,
  map: WorkshopMap,
  images: Map<string, HTMLImageElement>,
  width: number,
  height: number,
) {
  const cellWidth = width / map.width;
  const cellHeight = height / map.height;
  const baseKind = baseTerrainForBiome(map.biome);
  fillTerrainTexture(context, baseKind, images.get(TERRAIN_ASSETS[baseKind]), width, height, cellWidth);

  const orderedKinds: TerrainKind[] = ["grass", "snow", "ash", "cave", "stone", "sand", "earth", "mud", "rubble", "lava", "water"];
  for (const kind of orderedKinds) {
    if (kind === baseKind || !map.terrain.includes(kind)) continue;
    const mask = createTerrainMask(map, kind, width, height);
    if (kind === "water") {
      const bankBlur = Math.max(2.5, Math.min(cellWidth, cellHeight) * 0.13);
      const bankKind: TerrainKind = map.biome === "cave" ? "mud" : "earth";
      paintMaskedTerrain(context, map, bankKind, images.get(TERRAIN_ASSETS[bankKind]), mask, width, height, bankBlur, 0.72);
    }
    paintMaskedTerrain(context, map, kind, images.get(TERRAIN_ASSETS[kind]), mask, width, height, kind === "water" ? 1.1 : 0.8);
  }
}

function drawProceduralStamp(
  context: CanvasRenderingContext2D,
  map: WorkshopMap,
  stamp: WorkshopMap["stamps"][number],
  cellWidth: number,
  cellHeight: number,
) {
  const definition = definitionFor(stamp.definitionId);
  // Finished library entries never render the legacy canvas placeholder while
  // their raster image is loading or if a browser temporarily misses the asset.
  if (definition.assets.length) return;
  const mask = rotatedMask(definition, stamp.rotation);
  const left = stamp.x * cellWidth;
  const top = stamp.y * cellHeight;
  const width = mask.width * cellWidth;
  const height = mask.height * cellHeight;
  const unit = Math.min(cellWidth, cellHeight);
  const random = (suffix: string) => seedHash(`${map.seed}:${stamp.id}:${suffix}`) / 4294967295;
  context.save();
  context.translate(left + width / 2, top + height / 2);
  if (stamp.flipX) context.scale(-1, 1);
  context.translate(-width / 2, -height / 2);
  context.shadowColor = "rgba(10, 12, 9, 0.46)";
  context.shadowBlur = Math.max(3, unit * 0.18);

  if (definition.renderKind === "stones" || definition.renderKind === "stalagmites") {
    mask.cells.forEach((cell, index) => {
      const centerX = (cell.x + 0.5) * cellWidth;
      const centerY = (cell.y + 0.54) * cellHeight;
      const radius = unit * (0.24 + random(`stone:${index}`) * 0.12);
      context.fillStyle = definition.renderKind === "stalagmites" ? "#575045" : "#777970";
      context.beginPath();
      if (definition.renderKind === "stalagmites") {
        context.moveTo(centerX, centerY - radius * 1.45);
        context.lineTo(centerX + radius, centerY + radius);
        context.lineTo(centerX - radius, centerY + radius);
        context.closePath();
      } else context.ellipse(centerX, centerY, radius * 0.78, radius, random(`tilt:${index}`) - 0.5, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "rgba(218, 210, 188, 0.28)";
      context.lineWidth = 1;
      context.stroke();
    });
  } else if (definition.renderKind === "ruin") {
    mask.cells.forEach((cell, index) => {
      const inset = unit * (0.08 + random(`ruin:${index}`) * 0.06);
      context.fillStyle = index % 3 === 0 ? "#77736a" : "#66645e";
      context.fillRect(cell.x * cellWidth + inset, cell.y * cellHeight + inset, cellWidth - inset * 2, cellHeight - inset * 2);
      context.strokeStyle = "rgba(225, 215, 191, 0.22)";
      context.strokeRect(cell.x * cellWidth + inset, cell.y * cellHeight + inset, cellWidth - inset * 2, cellHeight - inset * 2);
    });
  } else if (definition.renderKind === "bones") {
    for (let index = 0; index < 13; index += 1) {
      const x = width * (0.08 + random(`bone-x:${index}`) * 0.84);
      const y = height * (0.12 + random(`bone-y:${index}`) * 0.76);
      const length = unit * (0.18 + random(`bone-length:${index}`) * 0.2);
      const angle = random(`bone-angle:${index}`) * Math.PI;
      context.strokeStyle = index % 5 === 0 ? "#d6cfb9" : "#c7c0aa";
      context.lineWidth = Math.max(1.5, unit * 0.055);
      context.beginPath(); context.moveTo(x, y); context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length); context.stroke();
      if (index % 5 === 0) {
        context.fillStyle = "#d3cbb4";
        context.beginPath(); context.arc(x, y, unit * 0.09, 0, Math.PI * 2); context.fill();
      }
    }
  } else if (definition.renderKind === "campfire") {
    context.strokeStyle = "#4e2f1d"; context.lineWidth = unit * 0.16;
    context.beginPath(); context.moveTo(width * 0.28, height * 0.64); context.lineTo(width * 0.72, height * 0.4); context.moveTo(width * 0.28, height * 0.4); context.lineTo(width * 0.72, height * 0.64); context.stroke();
    const glow = context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, unit * 0.75);
    glow.addColorStop(0, "rgba(255, 214, 103, 0.92)"); glow.addColorStop(0.42, "rgba(231, 108, 45, 0.7)"); glow.addColorStop(1, "rgba(231, 108, 45, 0)");
    context.fillStyle = glow; context.beginPath(); context.arc(width / 2, height / 2, unit * 0.75, 0, Math.PI * 2); context.fill();
    context.fillStyle = "#ffca55"; context.beginPath(); context.moveTo(width / 2, height * 0.2); context.quadraticCurveTo(width * 0.72, height * 0.56, width / 2, height * 0.7); context.quadraticCurveTo(width * 0.3, height * 0.54, width / 2, height * 0.2); context.fill();
  } else if (definition.renderKind === "bridge") {
    context.strokeStyle = "#49311e"; context.lineWidth = unit * 0.08;
    context.beginPath(); context.moveTo(0, height * 0.2); context.lineTo(width, height * 0.2); context.moveTo(0, height * 0.8); context.lineTo(width, height * 0.8); context.stroke();
    const plankWidth = width / 12;
    for (let index = 0; index < 12; index += 1) {
      context.fillStyle = index % 3 === 0 ? "#85623b" : "#735333";
      context.fillRect(index * plankWidth + 1, height * 0.26, plankWidth - 2, height * 0.48);
    }
  } else if (definition.renderKind === "crypt") {
    context.fillStyle = "#6d6c67";
    context.fillRect(unit * 0.14, unit * 0.14, width - unit * 0.28, height - unit * 0.28);
    context.strokeStyle = "#a09c90"; context.lineWidth = unit * 0.08;
    context.strokeRect(unit * 0.22, unit * 0.22, width - unit * 0.44, height - unit * 0.44);
    context.beginPath(); context.moveTo(width / 2, unit * 0.4); context.lineTo(width / 2, height - unit * 0.4); context.moveTo(width * 0.34, height * 0.46); context.lineTo(width * 0.66, height * 0.46); context.stroke();
  } else if (definition.renderKind === "thicket") {
    mask.cells.forEach((cell, index) => {
      const x = (cell.x + 0.5) * cellWidth;
      const y = (cell.y + 0.52) * cellHeight;
      const radius = unit * (0.24 + random(`thicket:${index}`) * 0.1);
      context.fillStyle = index % 3 === 0 ? "#405f2a" : "#526c2d";
      context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
      context.strokeStyle = "#4a3222"; context.lineWidth = Math.max(1, unit * 0.035);
      context.beginPath(); context.moveTo(x - radius, y + radius * 0.45); context.lineTo(x + radius, y - radius * 0.45); context.moveTo(x - radius * 0.55, y - radius * 0.7); context.lineTo(x + radius * 0.62, y + radius * 0.75); context.stroke();
    });
  } else if (definition.renderKind === "supplies") {
    for (let index = 0; index < 4; index += 1) {
      const x = unit * (0.22 + index * 0.54);
      const y = index % 2 ? height * 0.48 : height * 0.17;
      context.fillStyle = index % 2 ? "#795734" : "#8a633a";
      context.fillRect(x, y, unit * 0.48, unit * 0.48);
      context.strokeStyle = "#3e2c1d"; context.lineWidth = Math.max(1, unit * 0.04); context.strokeRect(x, y, unit * 0.48, unit * 0.48);
      context.beginPath(); context.moveTo(x, y); context.lineTo(x + unit * 0.48, y + unit * 0.48); context.moveTo(x + unit * 0.48, y); context.lineTo(x, y + unit * 0.48); context.stroke();
    }
    context.fillStyle = "#695038"; context.beginPath(); context.ellipse(width * 0.83, height * 0.56, unit * 0.25, unit * 0.34, 0, 0, Math.PI * 2); context.fill();
    context.strokeStyle = "#b08a55"; context.lineWidth = unit * 0.04; context.stroke();
  } else if (definition.renderKind === "altar") {
    context.fillStyle = "#77756e"; context.fillRect(unit * 0.28, height * 0.25, width - unit * 0.56, height * 0.5);
    context.strokeStyle = "#aaa69a"; context.lineWidth = unit * 0.06; context.strokeRect(unit * 0.28, height * 0.25, width - unit * 0.56, height * 0.5);
    context.strokeStyle = "#514e49"; context.beginPath(); context.arc(width / 2, height / 2, unit * 0.22, 0, Math.PI * 2); context.moveTo(width / 2, height * 0.31); context.lineTo(width / 2, height * 0.69); context.stroke();
  } else if (definition.renderKind === "bars") {
    context.strokeStyle = "#2b2d2d"; context.lineWidth = Math.max(2, unit * 0.08);
    context.beginPath(); context.moveTo(0, height * 0.18); context.lineTo(width, height * 0.18); context.moveTo(0, height * 0.82); context.lineTo(width, height * 0.82); context.stroke();
    for (let index = 0; index <= 12; index += 1) { const x = (index / 12) * width; context.beginPath(); context.moveTo(x, height * 0.05); context.lineTo(x, height * 0.95); context.stroke(); }
  } else if (definition.renderKind === "mushrooms") {
    mask.cells.forEach((cell, index) => {
      const x = (cell.x + 0.5) * cellWidth;
      const y = (cell.y + 0.58) * cellHeight;
      const size = unit * (0.17 + random(`cap:${index}`) * 0.1);
      context.shadowColor = "rgba(107, 216, 221, .85)"; context.shadowBlur = unit * 0.3;
      context.fillStyle = "#b5e5db"; context.fillRect(x - unit * 0.035, y, unit * 0.07, size * 0.9);
      context.fillStyle = index % 2 ? "#61b7b8" : "#8d75c7"; context.beginPath(); context.ellipse(x, y, size, size * 0.58, random(`cap-tilt:${index}`) - 0.5, Math.PI, Math.PI * 2); context.fill();
    });
  } else if (definition.renderKind === "fountain") {
    context.fillStyle = "#74736c"; context.beginPath(); context.arc(width / 2, height / 2, unit * 1.55, 0, Math.PI * 2); context.fill();
    context.fillStyle = "#426d75"; context.beginPath(); context.arc(width / 2, height / 2, unit * 1.13, 0, Math.PI * 2); context.fill();
    context.strokeStyle = "#a09b8d"; context.lineWidth = unit * 0.14; context.beginPath(); context.arc(width / 2, height / 2, unit * 1.42, Math.PI * 0.12, Math.PI * 1.72); context.stroke();
    context.fillStyle = "#77756e"; context.beginPath(); context.arc(width / 2, height / 2, unit * 0.32, 0, Math.PI * 2); context.fill();
  } else if (definition.renderKind === "cart") {
    context.fillStyle = "#76502f"; context.fillRect(unit * 0.55, height * 0.2, width - unit * 1.45, height * 0.6);
    context.strokeStyle = "#3c291b"; context.lineWidth = unit * 0.08; context.strokeRect(unit * 0.55, height * 0.2, width - unit * 1.45, height * 0.6);
    for (let index = 1; index < 4; index += 1) { const x = unit * 0.55 + (width - unit * 1.45) * index / 4; context.beginPath(); context.moveTo(x, height * 0.2); context.lineTo(x, height * 0.8); context.stroke(); }
    context.beginPath(); context.moveTo(width - unit * 0.9, height * 0.34); context.lineTo(width, height * 0.1); context.moveTo(width - unit * 0.9, height * 0.66); context.lineTo(width, height * 0.9); context.stroke();
    context.fillStyle = "#30271f"; for (const y of [height * 0.18, height * 0.82]) { context.beginPath(); context.arc(unit * 0.85, y, unit * 0.27, 0, Math.PI * 2); context.fill(); }
  } else if (definition.renderKind === "pit") {
    const gradient = context.createRadialGradient(width / 2, height / 2, unit * 0.25, width / 2, height / 2, unit * 1.4);
    gradient.addColorStop(0, "#12110f"); gradient.addColorStop(0.68, "#27241e"); gradient.addColorStop(1, "#756b59");
    context.fillStyle = gradient; context.beginPath(); context.ellipse(width / 2, height / 2, unit * 1.35, unit * 1.2, 0, 0, Math.PI * 2); context.fill();
    context.fillStyle = "#9a8865";
    for (let index = 0; index < 10; index += 1) {
      const angle = random(`spike:${index}`) * Math.PI * 2;
      const radius = unit * (0.18 + random(`spike-radius:${index}`) * 0.62);
      const x = width / 2 + Math.cos(angle) * radius;
      const y = height / 2 + Math.sin(angle) * radius;
      context.beginPath(); context.moveTo(x, y - unit * 0.2); context.lineTo(x + unit * 0.08, y + unit * 0.12); context.lineTo(x - unit * 0.08, y + unit * 0.12); context.closePath(); context.fill();
    }
  } else if (definition.renderKind === "rune") {
    context.shadowColor = "rgba(109, 176, 205, .8)"; context.shadowBlur = unit * 0.32;
    context.strokeStyle = "#78b8cb"; context.lineWidth = Math.max(2, unit * 0.065);
    context.beginPath(); context.arc(width / 2, height / 2, unit * 0.68, 0, Math.PI * 2); context.moveTo(width / 2, height * 0.22); context.lineTo(width * 0.72, height * 0.67); context.lineTo(width * 0.28, height * 0.67); context.closePath(); context.stroke();
  } else if (definition.renderKind === "dunes") {
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#d1ad70"); gradient.addColorStop(0.48, "#a87c45"); gradient.addColorStop(1, "#d6b77d");
    context.fillStyle = gradient;
    for (let index = 0; index < 4; index += 1) {
      const y = height * (0.18 + index * 0.22);
      context.beginPath(); context.moveTo(0, y + unit * 0.22); context.quadraticCurveTo(width * 0.3, y - unit * 0.35, width * 0.55, y); context.quadraticCurveTo(width * 0.78, y + unit * 0.3, width, y - unit * 0.12); context.lineTo(width, y + unit * 0.38); context.lineTo(0, y + unit * 0.5); context.closePath(); context.fill();
    }
  } else if (definition.renderKind === "ice") {
    mask.cells.forEach((cell, index) => {
      const x = (cell.x + 0.5) * cellWidth;
      const y = (cell.y + 0.64) * cellHeight;
      const size = unit * (0.3 + random(`ice:${index}`) * 0.16);
      context.fillStyle = index % 2 ? "rgba(164, 209, 218, .9)" : "rgba(205, 231, 232, .92)";
      context.strokeStyle = "rgba(93, 149, 166, .75)"; context.lineWidth = Math.max(1, unit * 0.035);
      context.beginPath(); context.moveTo(x, y - size * 1.55); context.lineTo(x + size * 0.74, y + size); context.lineTo(x - size * 0.78, y + size * 0.86); context.closePath(); context.fill(); context.stroke();
    });
  } else if (definition.renderKind === "lava") {
    const glow = context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, unit * 1.35);
    glow.addColorStop(0, "#ffd05a"); glow.addColorStop(0.38, "#e55622"); glow.addColorStop(0.72, "#63251e"); glow.addColorStop(1, "rgba(30, 24, 22, 0)");
    context.fillStyle = glow; context.beginPath(); context.arc(width / 2, height / 2, unit * 1.34, 0, Math.PI * 2); context.fill();
    context.strokeStyle = "#2b2522"; context.lineWidth = unit * 0.13;
    for (let index = 0; index < 7; index += 1) { const angle = random(`vent:${index}`) * Math.PI * 2; context.beginPath(); context.moveTo(width / 2 + Math.cos(angle) * unit * 0.35, height / 2 + Math.sin(angle) * unit * 0.35); context.lineTo(width / 2 + Math.cos(angle) * unit * (0.85 + random(`vent-r:${index}`) * 0.45), height / 2 + Math.sin(angle) * unit * (0.85 + random(`vent-r:${index}`) * 0.45)); context.stroke(); }
  } else if (definition.renderKind === "wreck") {
    context.strokeStyle = "#3d2a1d"; context.lineWidth = unit * 0.13;
    context.fillStyle = "#6f4b2e";
    context.beginPath(); context.moveTo(unit * 0.2, height * 0.25); context.quadraticCurveTo(width * 0.52, height * 0.82, width - unit * 0.25, height * 0.28); context.lineTo(width - unit * 0.65, height * 0.78); context.quadraticCurveTo(width * 0.48, height, unit * 0.6, height * 0.73); context.closePath(); context.fill(); context.stroke();
    for (let index = 0; index < 7; index += 1) { const x = unit * (0.55 + index * 0.76); context.beginPath(); context.moveTo(x, height * 0.31); context.lineTo(x + unit * 0.3, height * 0.78); context.stroke(); }
    context.beginPath(); context.moveTo(width * 0.56, height * 0.52); context.lineTo(width * 0.42, -unit * 0.2); context.stroke();
  }
  context.restore();
}

function drawStructures(
  context: CanvasRenderingContext2D,
  map: WorkshopMap,
  cellWidth: number,
  cellHeight: number,
  includeDmDetails = false,
) {
  for (const wall of map.walls) {
    context.save();
    context.strokeStyle = wall.style === "cave" ? "#25231f" : wall.style === "ruined" ? "#777064" : "#4e4d49";
    context.lineWidth = Math.max(4, Math.min(cellWidth, cellHeight) * (wall.style === "cave" ? 0.24 : 0.17));
    if (wall.style === "ruined") context.setLineDash([cellWidth * 0.65, cellWidth * 0.24]);
    context.shadowColor = "rgba(0,0,0,.5)"; context.shadowBlur = 5;
    context.beginPath(); context.moveTo(wall.x1 * cellWidth, wall.y1 * cellHeight); context.lineTo(wall.x2 * cellWidth, wall.y2 * cellHeight); context.stroke();
    context.restore();
  }
  for (const portal of map.portals) {
    const x = portal.x * cellWidth;
    const y = portal.y * cellHeight;
    context.save();
    context.strokeStyle = portal.kind === "door" ? "#b1814f" : "#7fb0b7";
    context.lineWidth = Math.max(3, Math.min(cellWidth, cellHeight) * 0.12);
    context.beginPath();
    if (portal.orientation === "horizontal") { context.moveTo(x - cellWidth * 0.4, y); context.lineTo(x + cellWidth * 0.4, y); }
    else { context.moveTo(x, y - cellHeight * 0.4); context.lineTo(x, y + cellHeight * 0.4); }
    context.stroke();
    context.restore();
  }
  for (const label of map.labels) {
    if (label.visibility === "dm" && !includeDmDetails) continue;
    const x = label.x * cellWidth;
    const y = label.y * cellHeight;
    context.save();
    context.font = `700 ${Math.max(11, Math.min(cellWidth, cellHeight) * 0.28)}px ui-sans-serif, system-ui`;
    context.textAlign = "center"; context.textBaseline = "middle";
    const textWidth = context.measureText(label.text).width + 12;
    context.fillStyle = label.visibility === "dm" ? "rgba(77, 56, 87, 0.88)" : "rgba(22, 22, 19, 0.82)";
    context.fillRect(x - textWidth / 2, y - 10, textWidth, 20);
    context.fillStyle = label.visibility === "dm" ? "#d6b6dc" : "#e8dfcd";
    context.fillText(label.text, x, y + 0.5);
    context.restore();
  }
  if (includeDmDetails) map.notes.forEach((note, index) => {
    const x = note.x * cellWidth;
    const y = note.y * cellHeight;
    context.save();
    context.fillStyle = "#8f6ab2";
    context.beginPath(); context.arc(x, y, Math.max(7, Math.min(cellWidth, cellHeight) * 0.18), 0, Math.PI * 2); context.fill();
    context.fillStyle = "#fff"; context.font = "800 10px ui-monospace, monospace"; context.textAlign = "center"; context.textBaseline = "middle"; context.fillText(String(index + 1), x, y + 0.5);
    context.restore();
  });
}

function drawMood(context: CanvasRenderingContext2D, map: WorkshopMap, width: number, height: number) {
  if (map.mood === "daylight") return;
  context.save();
  context.fillStyle = map.mood === "moonlight" ? "rgba(29, 40, 73, 0.28)" : map.mood === "overcast" ? "rgba(34, 40, 42, 0.2)" : "rgba(35, 21, 12, 0.18)";
  context.fillRect(0, 0, width, height);
  context.restore();
}

export function renderMapPackageToCanvas(
  canvas: HTMLCanvasElement,
  map: MapPackage,
  images: Map<string, HTMLImageElement>,
  organicEdges = true,
) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const width = canvas.width;
  const height = canvas.height;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  if (organicEdges) drawOrganicTerrain(context, map, images, width, height);
  else {
    const cellWidth = width / map.width;
    const cellHeight = height / map.height;
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const kind = map.terrain[terrainIndex(map, x, y)];
        context.fillStyle = TERRAIN_FALLBACKS[kind];
        context.fillRect(x * cellWidth, y * cellHeight, cellWidth + 0.5, cellHeight + 0.5);
      }
    }
  }
  const cellWidth = width / map.width;
  const cellHeight = height / map.height;
  drawStructures(context, map, cellWidth, cellHeight, false);
  for (const stamp of map.stamps) {
    const definition = definitionFor(stamp.definitionId);
    const mask = rotatedMask(definition, stamp.rotation);
    const asset = stampAssetFor(definition, map.seed, stamp.id, stamp.variant);
    const image = images.get(asset);
    if (image) {
      const drawWidth = definition.width * cellWidth;
      const drawHeight = definition.height * cellHeight;
      const centerX = (stamp.x + mask.width / 2) * cellWidth;
      const centerY = (stamp.y + mask.height / 2) * cellHeight;
      context.save();
      context.translate(centerX, centerY);
      context.rotate((effectiveStampRotation(definition, stamp.rotation) * Math.PI) / 180);
      if (stamp.flipX) context.scale(-1, 1);
      context.shadowColor = "rgba(15, 19, 10, 0.48)";
      context.shadowBlur = Math.max(4, Math.min(cellWidth, cellHeight) * 0.24);
      context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      context.restore();
    } else drawProceduralStamp(context, map, stamp, cellWidth, cellHeight);
  }
  drawMood(context, map, width, height);
}

function drawWorkshop(
  canvas: HTMLCanvasElement,
  map: WorkshopMap,
  images: Map<string, HTMLImageElement>,
  selectedStampId: string | null,
  dropPreview: StampDropPreview | null,
  wallPreview: WallPreview | null,
  organicEdges: boolean,
) {
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.imageSmoothingEnabled = true;
  const cellWidth = rect.width / map.width;
  const cellHeight = rect.height / map.height;

  if (organicEdges) {
    drawOrganicTerrain(context, map, images, rect.width, rect.height);
  } else {
    const patterns = new Map<TerrainKind, CanvasPattern | null>();
    (Object.keys(TERRAIN_ASSETS) as TerrainKind[]).forEach((kind) => {
      const image = images.get(TERRAIN_ASSETS[kind]);
      const pattern = image ? context.createPattern(image, "repeat") : null;
      if (pattern) pattern.setTransform(new DOMMatrix().scale(Math.max(0.08, cellWidth / 130)));
      patterns.set(kind, pattern);
    });
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const kind = map.terrain[terrainIndex(map, x, y)];
        context.fillStyle = patterns.get(kind) ?? TERRAIN_FALLBACKS[kind];
        context.fillRect(x * cellWidth, y * cellHeight, cellWidth + 0.5, cellHeight + 0.5);
      }
    }
  }

  drawStructures(context, map, cellWidth, cellHeight, true);

  for (const stamp of map.stamps) {
    const definition = definitionFor(stamp.definitionId);
    const mask = rotatedMask(definition, stamp.rotation);
    const asset = stampAssetFor(definition, map.seed, stamp.id, stamp.variant);
    const image = images.get(asset);
    const x = stamp.x * cellWidth;
    const y = stamp.y * cellHeight;
    const width = mask.width * cellWidth;
    const height = mask.height * cellHeight;

    if (stamp.id === selectedStampId) {
      context.save();
      context.fillStyle = "rgba(245, 198, 92, 0.18)";
      context.strokeStyle = "rgba(255, 218, 135, 0.9)";
      context.lineWidth = 1.5;
      mask.cells.forEach((cell) => {
        context.fillRect((stamp.x + cell.x) * cellWidth, (stamp.y + cell.y) * cellHeight, cellWidth, cellHeight);
        context.strokeRect((stamp.x + cell.x) * cellWidth + 0.75, (stamp.y + cell.y) * cellHeight + 0.75, cellWidth - 1.5, cellHeight - 1.5);
      });
      context.restore();
    }

    if (image) {
      context.save();
      context.translate(x + width / 2, y + height / 2);
      context.rotate((effectiveStampRotation(definition, stamp.rotation) * Math.PI) / 180);
      if (stamp.flipX) context.scale(-1, 1);
      context.shadowColor = "rgba(15, 19, 10, 0.48)";
      context.shadowBlur = Math.max(4, Math.min(cellWidth, cellHeight) * 0.24);
      context.drawImage(image, -(definition.width * cellWidth) / 2, -(definition.height * cellHeight) / 2, definition.width * cellWidth, definition.height * cellHeight);
      context.restore();
    } else drawProceduralStamp(context, map, stamp, cellWidth, cellHeight);
  }

  drawMood(context, map, rect.width, rect.height);

  if (dropPreview) {
    const definition = definitionFor(dropPreview.definitionId);
    const image = images.get(definition.assets[dropPreview.variant]);
    context.save();
    context.fillStyle = "rgba(245, 198, 92, 0.24)";
    context.strokeStyle = "rgba(255, 218, 135, 0.95)";
    context.lineWidth = 1.5;
    definition.mask.forEach((cell) => {
      context.fillRect((dropPreview.x + cell.x) * cellWidth, (dropPreview.y + cell.y) * cellHeight, cellWidth, cellHeight);
      context.strokeRect((dropPreview.x + cell.x) * cellWidth + 0.75, (dropPreview.y + cell.y) * cellHeight + 0.75, cellWidth - 1.5, cellHeight - 1.5);
    });
    if (image) {
      context.globalAlpha = 0.7;
      context.drawImage(image, dropPreview.x * cellWidth, dropPreview.y * cellHeight, definition.width * cellWidth, definition.height * cellHeight);
    } else {
      context.globalAlpha = 0.7;
      drawProceduralStamp(context, map, { id: "drop-preview", definitionId: definition.id, x: dropPreview.x, y: dropPreview.y, rotation: 0 }, cellWidth, cellHeight);
    }
    context.restore();
  }

  if (wallPreview) {
    context.save();
    context.strokeStyle = "rgba(255, 210, 112, .95)";
    context.lineWidth = Math.max(3, Math.min(cellWidth, cellHeight) * 0.11);
    context.setLineDash([Math.max(5, cellWidth * 0.22), Math.max(3, cellWidth * 0.12)]);
    context.beginPath();
    context.moveTo(wallPreview.start.x * cellWidth, wallPreview.start.y * cellHeight);
    context.lineTo(wallPreview.end.x * cellWidth, wallPreview.end.y * cellHeight);
    context.stroke();
    context.restore();
  }

  context.save();
  context.strokeStyle = "rgba(244, 234, 205, 0.16)";
  context.lineWidth = 1;
  for (let x = 0; x <= map.width; x += 1) {
    context.beginPath(); context.moveTo(x * cellWidth, 0); context.lineTo(x * cellWidth, rect.height); context.stroke();
  }
  for (let y = 0; y <= map.height; y += 1) {
    context.beginPath(); context.moveTo(0, y * cellHeight); context.lineTo(rect.width, y * cellHeight); context.stroke();
  }
  context.restore();
}

function canvasCell(canvas: HTMLCanvasElement, map: WorkshopMap, clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(map.width - 1, Math.floor(((clientX - rect.left) / rect.width) * map.width))),
    y: Math.max(0, Math.min(map.height - 1, Math.floor(((clientY - rect.top) / rect.height) * map.height))),
  };
}

function canvasGridPoint(canvas: HTMLCanvasElement, map: WorkshopMap, clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(map.width, Math.round(((clientX - rect.left) / rect.width) * map.width))),
    y: Math.max(0, Math.min(map.height, Math.round(((clientY - rect.top) / rect.height) * map.height))),
  };
}

function canvasMapPoint(canvas: HTMLCanvasElement, map: WorkshopMap, clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(map.width, ((clientX - rect.left) / rect.width) * map.width)),
    y: Math.max(0, Math.min(map.height, ((clientY - rect.top) / rect.height) * map.height)),
  };
}

function stampAtCell(map: WorkshopMap, cell: Cell) {
  return [...map.stamps].reverse().find((stamp) => {
    const mask = rotatedMask(definitionFor(stamp.definitionId), stamp.rotation);
    return mask.cells.some((maskCell) => stamp.x + maskCell.x === cell.x && stamp.y + maskCell.y === cell.y);
  }) ?? null;
}

export default function MapWorkshop({ activeMapPackage, activeMapPresetId, savedPresets, onCommand, onClose }: MapWorkshopProps) {
  const [seed, setSeed] = useState("EMBER-WOOD-42");
  const [biome, setBiome] = useState<MapBiome>("forest");
  const [size, setSize] = useState<MapSize>("standard");
  const [density, setDensity] = useState<MapDensity>("balanced");
  const [landmarks, setLandmarks] = useState(1);
  const [pathStyle, setPathStyle] = useState<PathStyle>("winding");
  const [water, setWater] = useState<WaterFeature>("pond");
  const [mood, setMood] = useState<MapMood>("daylight");
  const [map, setMap] = useState(() => activeMapPackage ? cloneMapPackage(activeMapPackage) : generateMap({ biome, size, density, landmarks, pathStyle, water, mood, seed }));
  const [tool, setTool] = useState<WorkshopTool>("select");
  const [paint, setPaint] = useState<TerrainKind>("grass");
  const [selectedStampId, setSelectedStampId] = useState<string | null>(map.stamps[0]?.id ?? null);
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(new Map());
  const [dirty, setDirty] = useState(false);
  const [dropPreview, setDropPreview] = useState<StampDropPreview | null>(null);
  const [wallPreview, setWallPreview] = useState<WallPreview | null>(null);
  const [organicEdges, setOrganicEdges] = useState(true);
  const [prompt, setPrompt] = useState("Haunted ruins in moonlight, broken shrine, scattered bones, and one open courtyard.");
  const [promptFindings, setPromptFindings] = useState<string[]>([]);
  const [presetName, setPresetName] = useState(activeMapPackage?.name ?? "");
  const [loadedPresetId, setLoadedPresetId] = useState<string | null>(activeMapPresetId);
  const [workshopBusy, setWorkshopBusy] = useState(false);
  const [workshopMessage, setWorkshopMessage] = useState("");
  const [portalOrientation, setPortalOrientation] = useState<"horizontal" | "vertical">("horizontal");
  const [labelText, setLabelText] = useState("");
  const [labelVisibility, setLabelVisibility] = useState<"dm" | "everyone">("everyone");
  const [noteText, setNoteText] = useState("");
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteCategory, setPaletteCategory] = useState<"all" | StampCategory>("all");
  const [historyCounts, setHistoryCounts] = useState({ undo: 0, redo: 0 });
  const importInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const paletteDragDefinitionRef = useRef<string | null>(null);
  const paletteDragVariantRef = useRef<number | null>(null);
  const manualStampCounterRef = useRef(0);
  const rerollCounterRef = useRef(0);
  const wallStartRef = useRef<{ pointerId: number; cell: Cell } | null>(null);
  const paintGestureRef = useRef<number | null>(null);
  const metadataEditRef = useRef(false);
  const mapRef = useRef(map);
  const undoRef = useRef<MapPackage[]>([]);
  const redoRef = useRef<MapPackage[]>([]);
  const selectedStamp = map.stamps.find((stamp) => stamp.id === selectedStampId) ?? null;
  const selectedDefinition = selectedStamp ? definitionFor(selectedStamp.definitionId) : null;
  const loadedPreset = savedPresets.find((preset) => preset.id === loadedPresetId) ?? null;
  const draftMatchesLoadedPreset = Boolean(loadedPreset && JSON.stringify(loadedPreset.mapPackage) === JSON.stringify(map));
  const visibleStamps = STAMP_LIBRARY.filter((stamp) => {
    const query = paletteQuery.trim().toLowerCase();
    return (paletteCategory === "all" || stamp.category === paletteCategory)
      && (!query || `${stamp.name} ${stamp.description} ${stamp.category}`.toLowerCase().includes(query));
  });

  const assets = useMemo(() => [
    ...Object.values(TERRAIN_ASSETS),
    ...STAMP_LIBRARY.flatMap((stamp) => stamp.assets),
  ], []);

  const syncHistoryCounts = () => setHistoryCounts({ undo: undoRef.current.length, redo: redoRef.current.length });
  const clearDraftHistory = () => { undoRef.current = []; redoRef.current = []; syncHistoryCounts(); };
  const rememberDraft = () => {
    undoRef.current.push(cloneMapPackage(mapRef.current));
    if (undoRef.current.length > 50) undoRef.current.shift();
    redoRef.current = [];
    syncHistoryCounts();
  };
  const commitMap = (updater: (current: MapPackage) => MapPackage) => {
    rememberDraft();
    const next = updater(mapRef.current);
    mapRef.current = next;
    setMap(next);
    setDirty(true);
  };
  const restoreDraft = (next: MapPackage, isDirty: boolean) => {
    mapRef.current = next;
    setMap(next);
    clearDraftHistory();
    setDirty(isDirty);
  };
  const undoDraft = () => {
    const previous = undoRef.current.pop();
    if (!previous) return;
    redoRef.current.push(cloneMapPackage(mapRef.current));
    mapRef.current = previous;
    setMap(previous); setSelectedStampId(null); setDirty(true); syncHistoryCounts();
  };
  const redoDraft = () => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(cloneMapPackage(mapRef.current));
    mapRef.current = next;
    setMap(next); setSelectedStampId(null); setDirty(true); syncHistoryCounts();
  };

  useEffect(() => {
    mapRef.current = map;
  }, [map]);

  useEffect(() => {
    let disposed = false;
    void Promise.all(assets.map((asset) => new Promise<[string, HTMLImageElement]>((resolve) => {
      const image = new Image();
      image.onload = () => resolve([asset, image]);
      image.onerror = () => resolve([asset, image]);
      image.src = asset;
    }))).then((entries) => { if (!disposed) setImages(new Map(entries)); });
    return () => { disposed = true; };
  }, [assets]);

  const redraw = useCallback(() => {
    if (canvasRef.current) drawWorkshop(canvasRef.current, map, images, selectedStampId, dropPreview, wallPreview, organicEdges);
  }, [dropPreview, images, map, organicEdges, selectedStampId, wallPreview]);

  useEffect(() => {
    redraw();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [redraw]);

  const regenerate = (nextSeed = seed) => {
    const generated = generateMap({ biome, size, density, landmarks, pathStyle, water, mood, seed: nextSeed.trim() || "WAYFINDER" });
    restoreDraft(generated, true); setPresetName(generated.name); setLoadedPresetId(null); setPromptFindings([]); setSelectedStampId(generated.stamps[0]?.id ?? null); setTool("select");
  };

  const reroll = () => {
    rerollCounterRef.current += 1;
    const nextSeed = `MAP-${seedHash(`${seed}:reroll:${rerollCounterRef.current}`).toString(36).toUpperCase()}`;
    setSeed(nextSeed); regenerate(nextSeed);
  };

  const chooseBiome = (next: MapBiome) => {
    setBiome(next);
    if (next === "dungeon") { setPathStyle("none"); setWater("none"); setMood("torchlight"); }
    else if (next === "cave") { setPathStyle("winding"); setWater("pond"); setMood("torchlight"); }
    else if (next === "ruins") { setPathStyle("direct"); setWater("none"); setMood("moonlight"); }
    else if (next === "swamp") { setPathStyle("winding"); setWater("stream"); setMood("overcast"); }
    else if (next === "desert") { setPathStyle("direct"); setWater("none"); setMood("daylight"); }
    else if (next === "tundra") { setPathStyle("winding"); setWater("pond"); setMood("overcast"); }
    else if (next === "volcanic") { setPathStyle("winding"); setWater("stream"); setMood("torchlight"); }
    else if (next === "coast") { setPathStyle("direct"); setWater("pond"); setMood("overcast"); }
    else { setPathStyle("winding"); setWater("pond"); setMood("daylight"); }
  };

  const updateStampPosition = (stampId: string, x: number, y: number) => {
    const current = mapRef.current;
    const next = {
      ...current,
      stamps: current.stamps.map((stamp) => {
        if (stamp.id !== stampId) return stamp;
        const mask = rotatedMask(definitionFor(stamp.definitionId), stamp.rotation);
        return { ...stamp, x: Math.max(0, Math.min(current.width - mask.width, x)), y: Math.max(0, Math.min(current.height - mask.height, y)) };
      }),
    };
    mapRef.current = next;
    setMap(next);
    setDirty(true);
  };

  const paintTerrainCell = (cell: Cell) => {
    const current = mapRef.current;
    const index = terrainIndex(current, cell.x, cell.y);
    if (current.terrain[index] === paint) return;
    const terrain = [...current.terrain];
    terrain[index] = paint;
    const next = { ...current, terrain };
    mapRef.current = next;
    setMap(next);
    setDirty(true);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const cell = canvasCell(event.currentTarget, map, event.clientX, event.clientY);
    if (tool === "terrain") {
      if (mapRef.current.terrain[terrainIndex(mapRef.current, cell.x, cell.y)] !== paint) rememberDraft();
      paintGestureRef.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      paintTerrainCell(cell);
      return;
    }
    if (tool === "wall") {
      const point = canvasGridPoint(event.currentTarget, map, event.clientX, event.clientY);
      wallStartRef.current = { pointerId: event.pointerId, cell: point };
      setWallPreview({ start: point, end: point });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (tool === "door" || tool === "window") {
      const point = canvasMapPoint(event.currentTarget, map, event.clientX, event.clientY);
      commitMap((current) => ({ ...current, portals: [...current.portals, {
        id: `portal-${Date.now()}-${current.portals.length}`,
        x: portalOrientation === "horizontal" ? Math.min(current.width - 0.5, Math.floor(point.x) + 0.5) : Math.round(point.x),
        y: portalOrientation === "horizontal" ? Math.round(point.y) : Math.min(current.height - 0.5, Math.floor(point.y) + 0.5),
        orientation: portalOrientation,
        kind: tool,
        open: false,
      }] }));
      return;
    }
    if (tool === "label") {
      if (!labelText.trim()) { setWorkshopMessage("Enter label text, then click its map position."); return; }
      commitMap((current) => ({ ...current, labels: [...current.labels, { id: `label-${Date.now()}-${current.labels.length}`, x: cell.x + 0.5, y: cell.y + 0.5, text: labelText.trim().slice(0, 80), visibility: labelVisibility }] }));
      return;
    }
    if (tool === "note") {
      if (!noteText.trim()) { setWorkshopMessage("Enter a DM note, then click its map position."); return; }
      commitMap((current) => ({ ...current, notes: [...current.notes, { id: `note-${Date.now()}-${current.notes.length}`, x: cell.x + 0.5, y: cell.y + 0.5, text: noteText.trim().slice(0, 240) }] }));
      return;
    }
    const stamp = stampAtCell(map, cell);
    setSelectedStampId(stamp?.id ?? null);
    if (!stamp) return;
    rememberDraft();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, stampId: stamp.id, offsetX: cell.x - stamp.x, offsetY: cell.y - stamp.y };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (paintGestureRef.current === event.pointerId) {
      paintTerrainCell(canvasCell(event.currentTarget, mapRef.current, event.clientX, event.clientY));
      return;
    }
    if (wallStartRef.current?.pointerId === event.pointerId) {
      setWallPreview({ start: wallStartRef.current.cell, end: canvasGridPoint(event.currentTarget, mapRef.current, event.clientX, event.clientY) });
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const cell = canvasCell(event.currentTarget, map, event.clientX, event.clientY);
    updateStampPosition(drag.stampId, cell.x - drag.offsetX, cell.y - drag.offsetY);
  };

  const finishDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (wallStartRef.current?.pointerId === event.pointerId) {
      const start = wallStartRef.current.cell;
      const dropped = canvasGridPoint(event.currentTarget, mapRef.current, event.clientX, event.clientY);
      const end = dropped.x === start.x && dropped.y === start.y
        ? { x: start.x < mapRef.current.width ? start.x + 1 : start.x - 1, y: start.y }
        : dropped;
      wallStartRef.current = null;
      setWallPreview(null);
      commitMap((current) => ({ ...current, walls: [...current.walls, {
        id: `wall-manual-${Date.now()}-${current.walls.length}`,
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        style: current.biome === "cave" ? "cave" : current.biome === "ruins" ? "ruined" : "stone",
      }] }));
    }
    if (paintGestureRef.current === event.pointerId) paintGestureRef.current = null;
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const rotateSelected = () => {
    if (!selectedStamp || definitionFor(selectedStamp.definitionId).rotationMode === "fixed") return;
    commitMap((current) => ({
      ...current,
      stamps: current.stamps.map((stamp) => {
        if (stamp.id !== selectedStamp.id) return stamp;
        const rotation = ((stamp.rotation + 90) % 360) as MapRotation;
        const mask = rotatedMask(definitionFor(stamp.definitionId), rotation);
        return { ...stamp, rotation, x: Math.min(stamp.x, current.width - mask.width), y: Math.min(stamp.y, current.height - mask.height) };
      }),
    }));
  };

  const flipSelected = () => {
    if (!selectedStamp || definitionFor(selectedStamp.definitionId).rotationMode === "fixed") return;
    commitMap((current) => ({ ...current, stamps: current.stamps.map((stamp) => stamp.id === selectedStamp.id ? { ...stamp, flipX: !stamp.flipX } : stamp) }));
  };

  const deleteSelected = () => {
    if (!selectedStampId) return;
    commitMap((current) => ({ ...current, stamps: current.stamps.filter((stamp) => stamp.id !== selectedStampId) }));
    setSelectedStampId(null);
  };

  const duplicateSelected = () => {
    if (!selectedStamp) return;
    manualStampCounterRef.current += 1;
    const id = `${selectedStamp.definitionId}-copy-${manualStampCounterRef.current}`;
    const mask = rotatedMask(definitionFor(selectedStamp.definitionId), selectedStamp.rotation);
    commitMap((current) => ({
      ...current,
      stamps: [...current.stamps, {
        ...selectedStamp,
        id,
        variant: ((selectedStamp.variant ?? stampVariantFor(definitionFor(selectedStamp.definitionId), mapRef.current.seed, selectedStamp.id)) + 1) % 5,
        x: Math.min(current.width - mask.width, selectedStamp.x + 1),
        y: Math.min(current.height - mask.height, selectedStamp.y + 1),
      }],
    }));
    setSelectedStampId(id);
  };

  const shuffleSelectedVariant = () => {
    if (!selectedStamp) return;
    const definition = definitionFor(selectedStamp.definitionId);
    const currentVariant = stampVariantFor(definition, mapRef.current.seed, selectedStamp.id, selectedStamp.variant);
    commitMap((current) => ({
      ...current,
      stamps: current.stamps.map((stamp) => stamp.id === selectedStamp.id ? { ...stamp, variant: (currentVariant + 1) % definition.assets.length } : stamp),
    }));
  };

  const moveSelectedLayer = (position: "front" | "back") => {
    if (!selectedStamp) return;
    commitMap((current) => {
      const others = current.stamps.filter((stamp) => stamp.id !== selectedStamp.id);
      return { ...current, stamps: position === "front" ? [...others, selectedStamp] : [selectedStamp, ...others] };
    });
  };

  const deleteMapObject = (collection: "walls" | "portals" | "labels" | "notes", id: string) => {
    commitMap((current) => {
      if (collection === "walls") return { ...current, walls: current.walls.filter((item) => item.id !== id) };
      if (collection === "portals") return { ...current, portals: current.portals.filter((item) => item.id !== id) };
      if (collection === "labels") return { ...current, labels: current.labels.filter((item) => item.id !== id) };
      return { ...current, notes: current.notes.filter((item) => item.id !== id) };
    });
  };

  const updateMapMetadata = (field: "name" | "description", value: string) => {
    if (!metadataEditRef.current) { rememberDraft(); metadataEditRef.current = true; }
    const next = { ...mapRef.current, [field]: value };
    mapRef.current = next;
    setMap(next);
    setDirty(true);
  };

  const addStampAt = (definitionId: string, x: number, y: number, requestedVariant?: number) => {
    const definition = definitionFor(definitionId);
    manualStampCounterRef.current += 1;
    const id = `${definitionId}-manual-${manualStampCounterRef.current}`;
    const variant = stampVariantFor(definition, mapRef.current.seed, id, requestedVariant);
    commitMap((current) => ({
      ...current,
      stamps: [...current.stamps, { id, definitionId, x: Math.max(0, Math.min(current.width - definition.width, x)), y: Math.max(0, Math.min(current.height - definition.height, y)), rotation: 0, variant }],
    }));
    setSelectedStampId(id); setTool("select");
  };

  const stampDropPosition = (canvas: HTMLCanvasElement, definitionId: string, variant: number, clientX: number, clientY: number) => {
    const definition = definitionFor(definitionId);
    const cell = canvasCell(canvas, map, clientX, clientY);
    return {
      definitionId,
      variant,
      x: Math.max(0, Math.min(map.width - definition.width, cell.x - Math.floor(definition.width / 2))),
      y: Math.max(0, Math.min(map.height - definition.height, cell.y - Math.floor(definition.height / 2))),
    };
  };

  const onStampDragStart = (event: ReactDragEvent<HTMLButtonElement>, definitionId: string) => {
    const definition = definitionFor(definitionId);
    paletteDragDefinitionRef.current = definitionId;
    paletteDragVariantRef.current = seedHash(`${mapRef.current.seed}:${definitionId}:manual:${manualStampCounterRef.current + 1}`) % definition.assets.length;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-map-stamp", definitionId);
  };

  const onMapDragOver = (event: ReactDragEvent<HTMLCanvasElement>) => {
    const definitionId = paletteDragDefinitionRef.current;
    const variant = paletteDragVariantRef.current;
    if (!definitionId || variant === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropPreview(stampDropPosition(event.currentTarget, definitionId, variant, event.clientX, event.clientY));
  };

  const onMapDrop = (event: ReactDragEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const definitionId = event.dataTransfer.getData("application/x-map-stamp") || paletteDragDefinitionRef.current;
    if (!definitionId) return;
    const definition = definitionFor(definitionId);
    const variant = paletteDragVariantRef.current ?? seedHash(`${mapRef.current.seed}:${definitionId}:manual:${manualStampCounterRef.current + 1}`) % definition.assets.length;
    const position = stampDropPosition(event.currentTarget, definitionId, variant, event.clientX, event.clientY);
    addStampAt(definitionId, position.x, position.y, position.variant);
    paletteDragDefinitionRef.current = null;
    paletteDragVariantRef.current = null;
    setDropPreview(null);
  };

  const generateFromPrompt = () => {
    if (!prompt.trim()) return setWorkshopMessage("Describe the map you want first.");
    const composition = composeMapFromPrompt(prompt, seed);
    restoreDraft(composition.map, true);
    setBiome(composition.settings.biome);
    setSize(composition.settings.size);
    setDensity(composition.settings.density);
    setPathStyle(composition.settings.pathStyle);
    setWater(composition.settings.water);
    setMood(composition.settings.mood);
    setLandmarks(composition.settings.landmarks);
    setSeed(composition.settings.seed);
    setPresetName(composition.map.name);
    setLoadedPresetId(null);
    setPromptFindings(composition.detectedFeatures);
    setSelectedStampId(composition.map.stamps[0]?.id ?? null);
    setWorkshopMessage("Prompt interpreted locally. Review and edit the draft before applying it.");
  };

  const runWorkshopCommand = async (name: string, extra: Record<string, unknown>, message: string) => {
    setWorkshopBusy(true); setWorkshopMessage("");
    try { const result = await onCommand(name, extra); setWorkshopMessage(message); return result; }
    catch (error) { setWorkshopMessage(error instanceof Error ? error.message : "The map action was rejected."); return null; }
    finally { setWorkshopBusy(false); }
  };

  const savePreset = async () => {
    const name = presetName.trim() || map.name;
    const result = await runWorkshopCommand("save-map-preset", {
      presetId: loadedPresetId || undefined,
      name,
      description: map.description,
      sourcePrompt: map.source.prompt,
      mapPackage: { ...map, name },
    }, loadedPresetId ? `Updated “${name}”.` : `Saved “${name}” for later.`);
    if (!loadedPresetId && result && typeof result === "object" && "presetId" in result && typeof result.presetId === "string") setLoadedPresetId(result.presetId);
    setPresetName(name);
  };

  const applyDraft = async () => {
    const applied = await runWorkshopCommand("apply-map-package", { mapPackage: map, presetId: loadedPresetId || undefined }, `Applied “${map.name}”. Players now receive this map.`);
    if (applied) { setDirty(false); if (!draftMatchesLoadedPreset) setLoadedPresetId(null); }
  };

  const loadPreset = (preset: SavedMapPreset) => {
    const next = cloneMapPackage(preset.mapPackage);
    restoreDraft(next, preset.id !== activeMapPresetId); setSeed(next.seed); setBiome(next.biome); setMood(next.mood); setPresetName(preset.name); setLoadedPresetId(preset.id); setPrompt(next.source.prompt ?? ""); setPromptFindings([]); setSelectedStampId(null); setWorkshopMessage(`Loaded “${preset.name}” into the private workshop.`);
  };

  const discardDraft = () => {
    const next = activeMapPackage ? cloneMapPackage(activeMapPackage) : generateMap({ biome, size, density, landmarks, pathStyle, water, mood, seed });
    restoreDraft(next, false); setSeed(next.seed); setBiome(next.biome); setMood(next.mood); setPresetName(next.name); setLoadedPresetId(activeMapPresetId); setSelectedStampId(null); setWorkshopMessage(activeMapPackage ? "Discarded changes and restored the applied map." : "Discarded changes and restored a fresh local draft.");
  };

  const exportPackage = () => {
    const blob = new Blob([JSON.stringify(map, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${(presetName || map.name || "battle-map").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "battle-map"}.dndmap.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setWorkshopMessage("Map package exported.");
  };

  const importPackage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const imported = parseMapPackage(JSON.parse(await file.text()));
      if (!imported) throw new Error("That file is not a valid D&D Battle Map package.");
      const next = cloneMapPackage(imported);
      next.source = { ...next.source, kind: "imported" };
      restoreDraft(next, true); setSeed(next.seed); setBiome(next.biome); setMood(next.mood); setPresetName(next.name); setLoadedPresetId(null); setSelectedStampId(null); setWorkshopMessage(`Imported “${next.name}”. Review it before saving or applying.`);
    } catch (error) { setWorkshopMessage(error instanceof Error ? error.message : "The map package could not be imported."); }
  };

  return (
    <main className="workshop-shell">
      <header className="workshop-header">
        <div><div className="eyebrow">DM-only · Unapplied workshop</div><h1>Map Workshop</h1><p>Generate a strong starting point, then reshape terrain, structures, and details.</p></div>
        <div className="workshop-header-actions"><span className={dirty ? "draft-status is-dirty" : "draft-status"}>{dirty ? "Unapplied draft" : "Applied / clean"}</span><button className="secondary-button" disabled={!dirty || workshopBusy} onClick={discardDraft}>Discard</button><button className="primary-button" disabled={workshopBusy} onClick={() => void applyDraft()}>Apply to players</button><button className="secondary-button" onClick={onClose}>Return</button></div>
      </header>

      <div className="workshop-layout">
        <aside className="workshop-controls" aria-label="Map generator controls">
          <section className="prompt-studio">
            <div className="workshop-section-heading"><small>Prompt studio · Local</small><strong>Describe a starting map</strong></div>
            <textarea aria-label="Map description" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} placeholder="A narrow cave entrance opens into a bone-strewn lair…" />
            <button className="primary-button" onClick={generateFromPrompt}>Interpret prompt</button>
            <p className="workshop-help">Runs without a live AI service. Codex-authored packages use this same editable format.</p>
            {promptFindings.length ? <div className="prompt-findings" aria-label="Detected prompt features">{promptFindings.map((feature) => <span key={feature}>{feature}</span>)}</div> : null}
          </section>

          <section>
            <div className="workshop-section-heading"><small>Procedural generator</small><strong>{biome.charAt(0).toUpperCase() + biome.slice(1)} starter</strong></div>
            <label>Environment<select value={biome} onChange={(event) => chooseBiome(event.target.value as MapBiome)}><option value="forest">Forest</option><option value="dungeon">Dungeon</option><option value="cave">Cave</option><option value="ruins">Ruins</option><option value="swamp">Swamp</option><option value="desert">Desert</option><option value="tundra">Tundra</option><option value="volcanic">Volcanic</option><option value="coast">Coast</option></select></label>
            <label>Map size<select value={size} onChange={(event) => setSize(event.target.value as MapSize)}>{Object.entries(MAP_SIZES).map(([value, option]) => <option value={value} key={value}>{option.label}</option>)}</select></label>
            <div className="workshop-control-grid"><label>Density<select value={density} onChange={(event) => setDensity(event.target.value as MapDensity)}><option value="open">Open</option><option value="balanced">Balanced</option><option value="dense">Dense</option></select></label><label>Landmarks<select value={landmarks} onChange={(event) => setLandmarks(Number(event.target.value))}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label></div>
            <div className="workshop-control-grid"><label>Path<select value={pathStyle} onChange={(event) => setPathStyle(event.target.value as PathStyle)}><option value="none">None</option><option value="direct">Direct</option><option value="winding">Winding</option></select></label><label>Water<select value={water} onChange={(event) => setWater(event.target.value as WaterFeature)}><option value="none">None</option><option value="pond">Pond / pool</option><option value="stream">Stream</option></select></label></div>
            <label>Atmosphere<select value={mood} onChange={(event) => setMood(event.target.value as MapMood)}><option value="daylight">Daylight</option><option value="overcast">Overcast</option><option value="moonlight">Moonlight</option><option value="torchlight">Torchlight</option></select></label>
            <label>Seed<input value={seed} onChange={(event) => setSeed(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === "Enter") regenerate(); }} /></label>
            <div className="button-row"><button className="primary-button" onClick={() => regenerate()}>Generate</button><button className="secondary-button" onClick={reroll}>Reroll</button></div>
          </section>

          <section>
            <div className="workshop-section-heading"><small>Edit</small><strong>Minor corrections</strong></div>
            <div className="terrain-edge-toggle" aria-label="Terrain edge rendering">
              <button className={!organicEdges ? "is-active" : ""} onClick={() => setOrganicEdges(false)}>Crisp cells</button>
              <button className={organicEdges ? "is-active" : ""} onClick={() => setOrganicEdges(true)}>Organic edges</button>
            </div>
            <p className="workshop-help edge-help">Rendering only—the underlying terrain still occupies exact grid cells.</p>
            <div className="draft-history-row"><button disabled={!historyCounts.undo} onClick={undoDraft}>Undo draft{historyCounts.undo ? ` (${historyCounts.undo})` : ""}</button><button disabled={!historyCounts.redo} onClick={redoDraft}>Redo{historyCounts.redo ? ` (${historyCounts.redo})` : ""}</button></div>
            <div className="workshop-tool-row is-expanded">
              <button className={tool === "select" ? "is-active" : ""} onClick={() => setTool("select")}>Select</button>
              <button className={tool === "terrain" ? "is-active" : ""} onClick={() => setTool("terrain")}>Terrain</button>
              <button className={tool === "wall" ? "is-active" : ""} onClick={() => setTool("wall")}>Wall</button>
              <button className={tool === "door" ? "is-active" : ""} onClick={() => setTool("door")}>Door</button>
              <button className={tool === "window" ? "is-active" : ""} onClick={() => setTool("window")}>Window</button>
              <button className={tool === "label" ? "is-active" : ""} onClick={() => setTool("label")}>Label</button>
              <button className={tool === "note" ? "is-active" : ""} onClick={() => setTool("note")}>DM note</button>
            </div>
            {tool === "terrain" ? <div className="terrain-swatches">{(Object.keys(TERRAIN_ASSETS) as TerrainKind[]).map((kind) => <button key={kind} className={paint === kind ? "is-active" : ""} onClick={() => setPaint(kind)}><span className={`terrain-swatch is-${kind}`} />{kind}</button>)}</div> : null}
            {tool === "select" ? <p className="workshop-help">Drag stamps to grid positions. Select one to rotate, flip, or delete it.</p> : null}
            {tool === "wall" ? <p className="workshop-help">Drag between grid intersections to preview and add a wall segment. Its style follows the map environment.</p> : null}
            {tool === "door" || tool === "window" ? <div className="structure-options"><span>{tool === "door" ? "Door" : "Window"} orientation</span><div className="terrain-edge-toggle"><button className={portalOrientation === "horizontal" ? "is-active" : ""} onClick={() => setPortalOrientation("horizontal")}>Horizontal</button><button className={portalOrientation === "vertical" ? "is-active" : ""} onClick={() => setPortalOrientation("vertical")}>Vertical</button></div><p className="workshop-help">Click the desired grid position to place it.</p></div> : null}
            {tool === "label" ? <div className="structure-options"><label>Label text<input value={labelText} onChange={(event) => setLabelText(event.target.value)} placeholder="Collapsed gallery" /></label><label>Visible to<select value={labelVisibility} onChange={(event) => setLabelVisibility(event.target.value as "dm" | "everyone")}><option value="everyone">Everyone</option><option value="dm">DM only</option></select></label><p className="workshop-help">Enter text, then click its map position.</p></div> : null}
            {tool === "note" ? <div className="structure-options"><label>Private note<textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} rows={3} placeholder="The altar conceals a pressure plate…" /></label><p className="workshop-help">Notes appear as numbered purple markers only in the DM workshop.</p></div> : null}
          </section>

          <section>
            <div className="workshop-section-heading"><small>Stamp palette</small><strong>Map pieces</strong></div>
            <p className="workshop-help">Drag a piece onto the map. Its footprint snaps around your drop point.</p>
            <div className="palette-filters"><input aria-label="Search stamp palette" value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} placeholder="Search pieces…" /><select aria-label="Filter stamp category" value={paletteCategory} onChange={(event) => setPaletteCategory(event.target.value as "all" | StampCategory)}><option value="all">All types</option><option value="nature">Nature</option><option value="structure">Structures</option><option value="hazard">Hazards</option><option value="furnishing">Furnishings</option><option value="detail">Details</option></select></div>
            <div className="stamp-palette">{visibleStamps.map((stamp) => <button key={stamp.id} draggable onDragStart={(event) => onStampDragStart(event, stamp.id)} onDragEnd={() => { paletteDragDefinitionRef.current = null; paletteDragVariantRef.current = null; setDropPreview(null); }} aria-label={`Drag ${stamp.name} onto the map`}><NextImage src={stamp.assets[seedHash(`${map.seed}:${stamp.id}:palette`) % stamp.assets.length]} alt="" width={64} height={64} unoptimized draggable={false} /><span><strong>{stamp.name}</strong><small>{stamp.width} × {stamp.height} · 5 variants</small></span></button>)}</div>
            {!visibleStamps.length ? <p className="workshop-help">No pieces match this filter.</p> : null}
          </section>

          <details className="map-object-list">
            <summary>Map objects <span>{map.walls.length + map.portals.length + map.labels.length + map.notes.length}</span></summary>
            <p className="workshop-help">Remove generated or manually placed structures without undoing later work.</p>
            {map.walls.map((wall, index) => <div key={wall.id}><span>Wall {index + 1}<small>{wall.style}</small></span><button aria-label={`Delete wall ${index + 1}`} onClick={() => deleteMapObject("walls", wall.id)}>×</button></div>)}
            {map.portals.map((portal, index) => <div key={portal.id}><span>{portal.kind === "door" ? "Door" : "Window"} {index + 1}<small>{portal.orientation}</small></span><button aria-label={`Delete ${portal.kind} ${index + 1}`} onClick={() => deleteMapObject("portals", portal.id)}>×</button></div>)}
            {map.labels.map((label, index) => <div key={label.id}><span>{label.text}<small>{label.visibility === "dm" ? "DM label" : "Public label"}</small></span><button aria-label={`Delete label ${index + 1}`} onClick={() => deleteMapObject("labels", label.id)}>×</button></div>)}
            {map.notes.map((note, index) => <div key={note.id}><span>DM note {index + 1}<small>{note.text}</small></span><button aria-label={`Delete DM note ${index + 1}`} onClick={() => deleteMapObject("notes", note.id)}>×</button></div>)}
            {map.walls.length + map.portals.length + map.labels.length + map.notes.length === 0 ? <p className="workshop-help">No walls, doors, windows, labels, or notes yet.</p> : null}
          </details>

          <section className="map-library-panel">
            <div className="workshop-section-heading"><small>Map library</small><strong>Save, reuse, and exchange</strong></div>
            <label>Map title<input value={map.name} maxLength={72} onChange={(event) => updateMapMetadata("name", event.target.value)} onBlur={() => { metadataEditRef.current = false; }} /></label>
            <label>Description<textarea value={map.description} maxLength={240} rows={2} onChange={(event) => updateMapMetadata("description", event.target.value)} onBlur={() => { metadataEditRef.current = false; }} /></label>
            <label>Preset name<input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder={map.name} /></label>
            <div className="button-row"><button className="primary-button" disabled={workshopBusy} onClick={() => void savePreset()}>{loadedPresetId ? "Update preset" : "Save preset"}</button><button className="secondary-button" onClick={exportPackage}>Export</button><button className="secondary-button" onClick={() => importInputRef.current?.click()}>Import</button></div>
            <input ref={importInputRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => void importPackage(event)} />
            <div className="saved-map-list">{savedPresets.length ? savedPresets.map((preset) => <article className={preset.id === loadedPresetId ? "is-selected" : ""} key={preset.id}><button className="saved-map-load" onClick={() => loadPreset(preset)}><strong>{preset.name}</strong><small>{preset.mapPackage.biome} · {preset.mapPackage.width} × {preset.mapPackage.height}{preset.id === activeMapPresetId ? " · applied" : ""}</small></button><button className="saved-map-delete" aria-label={`Delete ${preset.name}`} onClick={() => void runWorkshopCommand("delete-map-preset", { presetId: preset.id }, `Deleted “${preset.name}”.`)}>×</button></article>) : <p className="workshop-help">Saved prompt tests and finished maps will appear here.</p>}</div>
          </section>

          {selectedStamp && selectedDefinition ? <section className="selected-stamp-panel">
            <div className="workshop-section-heading"><small>Selected stamp</small><strong>{selectedDefinition.name}</strong></div>
            <p>{selectedDefinition.description}</p>
            <div className="stamp-stats"><span>Footprint <strong>{rotatedMask(selectedDefinition, selectedStamp.rotation).cells.length} cells</strong></span><span>Rotation <strong>{selectedDefinition.rotationMode === "fixed" ? "Fixed" : `${selectedStamp.rotation}°`}</strong></span><span>Artwork <strong>{stampVariantFor(selectedDefinition, map.seed, selectedStamp.id, selectedStamp.variant) + 1} of 5</strong></span></div>
            <div className="button-row stamp-edit-actions"><button className="secondary-button" disabled={selectedDefinition.rotationMode === "fixed"} title={selectedDefinition.rotationMode === "fixed" ? "This artwork has a fixed camera perspective" : undefined} onClick={rotateSelected}>Rotate 90°</button><button className="secondary-button" disabled={selectedDefinition.rotationMode === "fixed"} title={selectedDefinition.rotationMode === "fixed" ? "This artwork has a fixed camera perspective" : undefined} onClick={flipSelected}>Flip</button><button className="secondary-button" onClick={shuffleSelectedVariant}>Next art</button><button className="secondary-button" onClick={duplicateSelected}>Duplicate</button><button className="secondary-button" onClick={() => moveSelectedLayer("back")}>Send back</button><button className="secondary-button" onClick={() => moveSelectedLayer("front")}>Bring front</button><button className="danger-button" onClick={deleteSelected}>Delete</button></div>
            <small className="shadow-note">Neutral contact shadow is rendered by the workshop, not baked into the artwork.</small>
          </section> : null}
        </aside>

        <section className="workshop-canvas-panel" aria-label={`Editable generated ${map.biome}`}>
          <div className="workshop-canvas-heading"><div><small>{map.source.kind === "prompt" ? "Prompt-composed draft" : "Draft preview"}</small><strong>{map.name} · {map.width} × {map.height} · seed {map.seed || "WAYFINDER"}</strong></div><span>{organicEdges ? "Organic edges" : "Crisp cells"} · {dirty ? "Private until applied" : "Matches applied map"}</span></div>
          <div className="workshop-canvas-frame"><canvas ref={canvasRef} style={{ aspectRatio: `${map.width} / ${map.height}` }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finishDrag} onPointerCancel={(event) => { wallStartRef.current = null; paintGestureRef.current = null; dragRef.current = null; setWallPreview(null); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onDragOver={onMapDragOver} onDrop={onMapDrop} onDragLeave={() => setDropPreview(null)} aria-label={`Generated ${map.biome} draft with ${map.stamps.length} editable stamps`} /></div>
          <div className="workshop-legend"><span><i className="legend-cell" />Gold cells show the selected stamp footprint</span><span><i className="legend-grid" />Every stamp snaps to the grid</span><span>Drag terrain corrections across individual cells</span></div>
          {workshopMessage ? <div className="workshop-message" role="status">{workshopMessage}</div> : null}
        </section>
      </div>
    </main>
  );
}
