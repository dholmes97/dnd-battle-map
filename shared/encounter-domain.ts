import type { Role } from "./contracts";
import type { MapPackage } from "./map-package";

export function scenarioCodeFromName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20) || "NEW-SCENARIO";
}

export function mapPackageForViewer(mapPackage: MapPackage | null, viewer: { role: Role } | null): MapPackage | null {
  if (!mapPackage || viewer?.role === "dm") return mapPackage;
  return {
    ...mapPackage,
    labels: mapPackage.labels.filter((label) => label.visibility === "everyone"),
    notes: [],
    ...(mapPackage.fog ? { fog: { mode: mapPackage.fog.mode, sharedPolygon: [], walls: [], doors: [], circles: [] } } : {}),
  } as MapPackage;
}

export function historyConflictMessage(direction: string, actionType: string): string {
  const messages: Record<string, string> = {
    token_moved: `This move cannot be ${direction} because the token moved again.`,
    hp_changed: `This HP change cannot be ${direction} because the token's HP changed again.`,
    initiative_set: `This initiative change cannot be ${direction} because the token's initiative or group changed again.`,
    initiative_group_set: `This initiative-group change cannot be ${direction} because its members or initiative changed again.`,
    effect_added: `This effect change cannot be ${direction} because the effect changed again.`,
    effect_removed: `This effect change cannot be ${direction} because the effect changed again.`,
    annotation_added: `This drawing cannot be ${direction} because it was changed, erased, or cleared.`,
    annotation_removed: `This erased drawing cannot be ${direction} because the drawing changed again.`,
    token_created: `This placement cannot be ${direction} because the token was deleted, reassigned, or otherwise changed.`,
    token_updated: `This token edit cannot be ${direction} because the token no longer exists or its details changed again.`,
  };
  return messages[actionType] ?? `This action cannot be ${direction} because its shared state changed.`;
}
