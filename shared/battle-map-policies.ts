import type { EncounterStatus, Role } from "./contracts";
import type { MapPackage } from "./map-package";

type MovementPolicyInput = { strictMovement: boolean; participantRole: Role; controlledByViewer: boolean; encounterStatus: EncounterStatus };

export function movementPolicyDenial({ strictMovement, participantRole, controlledByViewer, encounterStatus }: MovementPolicyInput): { status: number; error: string } | null {
  if (strictMovement && participantRole !== "dm" && !controlledByViewer) {
    return { status: 403, error: "You do not control this token." };
  }
  if (encounterStatus === "paused" && participantRole !== "dm") {
    return { status: 409, error: "The encounter is paused." };
  }
  return null;
}

export function mapSceneContentKey(mapPackage: MapPackage | null): string {
  if (!mapPackage) return "";
  return JSON.stringify({ ...mapPackage, fog: undefined });
}
