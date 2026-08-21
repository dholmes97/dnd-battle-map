import { annotationGeometryIsBounded } from "../../shared/annotation-geometry.ts";
import { ensureSharedFogPolygon } from "../../shared/fog-of-war.ts";
import { parseMapPackage } from "../../shared/map-package.ts";
import type { SharedAnnotation } from "../../shared/contracts.ts";
import type { AnnotationFogRepository } from "../ports/annotation-fog-repository.ts";
import { commandError, requireDm, type CommandContextFor, type CommandOutcome } from "./types.ts";

const PING_TTL_MS = 2_000;
const SPOTLIGHT_TTL_MS = 6_500;

type AnnotationFogCommandName =
  | "set-strict-movement" | "set-fog-mode" | "set-vision-door-open"
  | "update-shared-fog" | "add-annotation" | "clear-annotations" | "remove-annotation";
export type AnnotationFogCommandContext<Name extends AnnotationFogCommandName = AnnotationFogCommandName> =
  CommandContextFor<Name, { repository: AnnotationFogRepository }>;

export async function setStrictMovement(context: AnnotationFogCommandContext<"set-strict-movement">): Promise<CommandOutcome> {
  const denied = requireDm(context);
  if (denied) return denied;
  await context.repository.updateStrictMovement(context.encounter.id, context.payload.enabled, context.now);
  await finish(context, "strict_movement_changed", {
    from: context.encounter.strictMovement,
    to: context.payload.enabled,
  });
  return success(context, { updated: true });
}

export async function setFogMode(context: AnnotationFogCommandContext<"set-fog-mode">): Promise<CommandOutcome> {
  const denied = requireDm(context);
  if (denied) return denied;
  const mode = context.payload.mode;
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

export async function setVisionDoorOpen(context: AnnotationFogCommandContext<"set-vision-door-open">): Promise<CommandOutcome> {
  const denied = requireDm(context);
  if (denied) return denied;
  const doorId = cleanId(context.payload.doorId);
  if (!doorId) return commandError("Choose a vision door and whether it is open.", 400);
  const map = mapPackage(context.encounter.mapPackageJson);
  if (!map) return commandError("Apply a map before changing vision doors.", 400);
  if (!map.fog.doors.some((door) => door.id === doorId)) return commandError("That vision door no longer exists.", 404);
  const next = {
    ...map,
    fog: {
      ...map.fog,
      doors: map.fog.doors.map((door) => door.id === doorId ? { ...door, open: context.payload.open } : door),
    },
  };
  await context.repository.updateMapPackage(context.encounter.id, JSON.stringify(next), context.now);
  await finish(context, "vision_door_changed", { doorId, open: context.payload.open });
  return success(context, { updated: true });
}

export async function updateSharedFog(context: AnnotationFogCommandContext<"update-shared-fog">): Promise<CommandOutcome> {
  const denied = requireDm(context);
  if (denied) return denied;
  const map = mapPackage(context.encounter.mapPackageJson);
  if (!map) return commandError("Apply a map before changing shared fog.", 400);
  const candidate = mapPackage(JSON.stringify({ ...map, fog: { ...map.fog, sharedPolygon: context.payload.polygon } }));
  if (!candidate || candidate.fog.sharedPolygon.length < 3) return commandError("Shared fog needs at least three valid corners inside the map.", 400);
  await context.repository.updateMapPackage(context.encounter.id, JSON.stringify(candidate), context.now);
  await finish(context, "shared_fog_changed", { cornerCount: candidate.fog.sharedPolygon.length });
  return success(context, { updated: true });
}

export async function addAnnotation(context: AnnotationFogCommandContext<"add-annotation">): Promise<CommandOutcome> {
  const annotationType: SharedAnnotation["type"] = context.payload.annotationType;
  if ((annotationType === "spotlight" || annotationType === "neon-spotlight") && context.participant.role !== "dm") {
    return commandError("Only the DM can place a spotlight.", 403);
  }
  const x = context.payload.x;
  const y = context.payload.y;
  const x2 = context.payload.x2 ?? null;
  const y2 = context.payload.y2 ?? null;
  if (!annotationGeometryIsBounded(
    { type: annotationType, x, y, x2, y2 },
    context.encounter.gridWidth,
    context.encounter.gridHeight,
  )) {
    return commandError("Annotation geometry is outside the map.", 400);
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
    color: cleanText(context.payload.color, 16) || "#f5c65c",
    label: cleanText(context.payload.label, 48) || null,
    createdBy: context.participant.id,
    expiresAt,
    createdAt: context.now,
  };
  if (!await context.repository.insertAnnotation(context.encounter.id, annotation)) {
    return commandError("This scenario has reached its annotation limit. Clear old annotations before adding another.", 409);
  }
  await finish(context, "annotation_added", { annotationId, annotation });
  return success(context, { added: true, annotationId });
}

export async function clearAnnotations(context: AnnotationFogCommandContext<"clear-annotations">): Promise<CommandOutcome> {
  const denied = requireDm(context);
  if (denied) return denied;
  await context.repository.clearAnnotations(context.encounter.id);
  await finish(context, "annotations_cleared", {});
  return success(context, { cleared: true });
}

export async function removeAnnotation(context: AnnotationFogCommandContext<"remove-annotation">): Promise<CommandOutcome> {
  const annotationId = cleanId(context.payload.annotationId);
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
