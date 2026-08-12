export function movementPolicyDenial({ strictMovement, participantRole, controlledByViewer, encounterStatus }) {
  if (strictMovement && participantRole !== "dm" && !controlledByViewer) {
    return { status: 403, error: "You do not control this token." };
  }
  if (encounterStatus === "paused" && participantRole !== "dm") {
    return { status: 409, error: "The encounter is paused." };
  }
  return null;
}

export function mapSceneContentKey(mapPackage) {
  if (!mapPackage) return "";
  return JSON.stringify({ ...mapPackage, fog: undefined });
}
