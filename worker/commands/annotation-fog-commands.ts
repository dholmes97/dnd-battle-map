import { ensureSharedFogPolygon } from "../../shared/fog-of-war.ts";
import { parseMapPackage } from "../../shared/map-package.ts";
import type { SharedAnnotation } from "../../shared/contracts.ts";
import type { AnnotationFogRepository } from "../ports/annotation-fog-repository.ts";
import { commandError, type CommandContext, type CommandOutcome } from "./types.ts";

const PING_TTL_MS = 2_000;
const SPOTLIGHT_TTL_MS = 6_500;

export type AnnotationFogCommandContext = CommandContext & {
  repository: AnnotationFogRepository;
};

export async function setStrictMovement(context: AnnotationFogCommandContext): Promise<CommandOutcome> {
  const denied = requireDm(context);
  if (denied) return denied;
  if (typeof context.body.enabled !== "boolean") return commandError("Strict movement must be on or off.", 400);
  await context.repository.updateStrictMovement(context.encounter.id, context.body.enabled, context.now);
  await finish(context, "strict_movement_changed", {
    from: context.encounter.strictMovement,
    to: context.body.enabled,
  });
  return success(context, { updated: true });
}

export async function setFogMode(context: AnnotationFogCommandContext): Promise<CommandOutcome> {
  const denied = requireDm(context);
  if (denied) return denied;
  const mode = context.body.mode;
  if (mode !== "off" && mode !== "shared" && mode !== "dynamic") {
    return commandError("Choose no fog, shared fog, or dynamic vision.", 400);
  }
  const map = mapPackage(context.encounter.mapPackageJson);
  if (!map) return commandError("Apply a map before enabling fog of war.", 400);
  const previousMode = map.fog.mode;
  const next = {
    ...map,
    fog: {
      ...map.fog,
      mode,
      sharedPolygon: mode === "shared"
        ? ensureSharedFogPolygon(map.fog.sharedPolygon, map.width, map.height)
        : map.fog.sharedPolygon,
    },
  };
  await context.repository.updateMapPackage(context.encounter.id, JSON.stringify(next), context.now);
  await finish(context, "fog_mode_changed", { from: previousMode, to: mode });
  return success(context, { updated: true });
}

export async function setVisionDoorOpen(context: AnnotationFogCommandContext): Promise<CommandOutcome> {
  const denied = requireDm(context);
  if (denied) return denied;
  const doorId = cleanId(context.body.doorId);
  if (!doorId || typeof context.body.open !== "boolean") return commandError("Choose a vision door and whether it is open.", 400);
  const map = mapPackage(context.encounter.mapPackageJson);
  if (!map) return commandError("Apply a map before changing vision doors.", 400);
  if (!map.fog.doors.some((door) => door.id === doorId)) return commandError("That vision door no longer exists.", 404);
  const next = {
    ...map,
    fog: {
      ...map.fog,
      doors: map.fog.doors.map((door) => door.id === doorId ? { ...door, open: context.body.open as boolean } : door),
    },
  };
  await context.repository.updateMapPackage(context.encounter.id, JSON.stringify(next), context.now);
  await finish(context, "vision_door_changed", { doorId, open: context.body.open });
  return success(context, { updated: true });
}

export async function updateSharedFog(context: AnnotationFogCommandContext): Promise<CommandOutcome> {
  const denied = requireDm(context);
  if (denied) return denied;
  const map = mapPackage(context.encounter.mapPackageJson);
  if (!map) return commandError("Apply a map before changing shared fog.", 400);
  const candidate = mapPackage(JSON.stringify({ ...map, fog: { ...map.fog, sharedPolygon: context.body.polygon } }));
  if (!candidate || candidate.fog.sharedPolygon.length < 3) return commandError("Shared fog needs at least three valid corners inside the map.", 400);
  await context.repository.updateMapPackage(context.encounter.id, JSON.stringify(candidate), context.now);
  await finish(context, "shared_fog_changed", { cornerCount: candidate.fog.sharedPolygon.length });
  return success(context, { updated: true });
}

export async function addAnnotation(context: AnnotationFogCommandContext): Promise<CommandOutcome> {
  const requestedType = context.body.annotationType;
  const annotationType: SharedAnnotation["type"] = requestedType === "drawing" || requestedType === "spotlight" || requestedType === "neon-spotlight" ? requestedType : "ping";
  if ((annotationType === "spotlight" || annotationType === "neon-spotlight") && context.participant.role !== "dm") {
    return commandError("Only the DM can place a spotlight.", 403);
  }
  const x = Number(context.body.x);
  const y = Number(context.body.y);
  const x2 = Number.isFinite(Number(context.body.x2)) ? Number(context.body.x2) : null;
  const y2 = Number.isFinite(Number(context.body.y2)) ? Number(context.body.y2) : null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > context.encounter.gridWidth || y > context.encounter.gridHeight) {
    return commandError("Annotation is outside the map.", 400);
  }
  const expiresAt = annotationType === "ping"
    ? context.now + PING_TTL_MS
    : annotationType === "spotlight" || annotationType === "neon-spotlight"
      ? context.now + SPOTLIGHT_TTL_MS
      : null;
  const annotationId = context.services.createId();
  const annotation = {
    id: annotationId,
    annotationType,
    x,
    y,
    x2,
    y2,
    color: cleanText(context.body.color, 16) || "#f5c65c",
    label: cleanText(context.body.label, 48) || null,
    createdBy: context.participant.id,
    expiresAt,
    createdAt: context.now,
  };
  await context.repository.insertAnnotation(context.encounter.id, annotation);
  await finish(context, "annotation_added", { annotationId, annotation });
  return success(context, { added: true, annotationId });
}

export async function clearAnnotations(context: AnnotationFogCommandContext): Promise<CommandOutcome> {
  const denied = requireDm(context);
  if (denied) return denied;
  await context.repository.clearAnnotations(context.encounter.id);
  await finish(context, "annotations_cleared", {});
  return success(context, { cleared: true });
}

export async function removeAnnotation(context: AnnotationFogCommandContext): Promise<CommandOutcome> {
  const annotationId = cleanId(context.body.annotationId);
  const annotation = await context.repository.findAnnotation(context.encounter.id, annotationId);
  if (!annotation || annotation.annotationType !== "drawing") return commandError("Drawn line not found.", 404);
  if (context.participant.role !== "dm" && annotation.createdBy !== context.participant.id) {
    return commandError("You can only erase lines you drew.", 403);
  }
  if (!await context.repository.removeAnnotation(context.encounter.id, annotationId)) {
    return commandError("That line was already removed.", 409);
  }
  await finish(context, "annotation_removed", { annotationId, annotation });
  return success(context, { removed: true });
}

function requireDm(context: AnnotationFogCommandContext): CommandOutcome | null {
  return context.participant.role === "dm" ? null : commandError("This action requires the DM role.", 403);
}

async function finish(context: AnnotationFogCommandContext, type: string, payload: Record<string, unknown>) {
  await context.services.bumpEncounter();
  await context.services.recordAction(type, payload);
}

async function success(context: AnnotationFogCommandContext, payload: Record<string, unknown>): Promise<CommandOutcome> {
  return { payload: { ...payload, state: await context.services.loadState() } };
}

function mapPackage(value: unknown) {
  try {
    return parseMapPackage(typeof value === "string" ? JSON.parse(value) : value);
  } catch {
    return null;
  }
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function cleanId(value: unknown): string {
  return typeof value === "string" ? value.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) : "";
}
