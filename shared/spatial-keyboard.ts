export type SpatialPoint = { x: number; y: number };

export type SpatialKeyboardIntent =
  | { kind: "move"; dx: number; dy: number; step: number }
  | { kind: "pan"; dx: number; dy: number; step: number }
  | { kind: "activate" }
  | { kind: "grab" }
  | { kind: "cancel" }
  | { kind: "delete" }
  | { kind: "altitude"; direction: 1 | -1 }
  | { kind: "zoom"; direction: 1 | -1 };

type KeyboardEventLike = {
  key: string;
  altKey?: boolean;
  shiftKey?: boolean;
};

const ARROW_DELTAS: Record<string, SpatialPoint> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

export function spatialKeyboardIntent(event: KeyboardEventLike): SpatialKeyboardIntent | null {
  const delta = ARROW_DELTAS[event.key];
  if (delta) {
    return {
      kind: event.altKey ? "pan" : "move",
      dx: delta.x,
      dy: delta.y,
      step: event.shiftKey ? 5 : 1,
    };
  }
  if (event.key === "Enter") return { kind: "activate" };
  if (event.key === " " || event.key === "Space" || event.key === "Spacebar") return { kind: "grab" };
  if (event.key === "Escape") return { kind: "cancel" };
  if (event.key === "Delete" || event.key === "Backspace") return { kind: "delete" };
  if (event.key === "PageUp") return { kind: "altitude", direction: 1 };
  if (event.key === "PageDown") return { kind: "altitude", direction: -1 };
  if (event.key === "+" || event.key === "=") return { kind: "zoom", direction: 1 };
  if (event.key === "-" || event.key === "_") return { kind: "zoom", direction: -1 };
  return null;
}

export function moveSpatialPoint(
  point: SpatialPoint,
  intent: Extract<SpatialKeyboardIntent, { kind: "move" | "pan" }>,
  bounds: { width: number; height: number },
  radius = 0,
  quantum = 0.01,
): SpatialPoint {
  const clamp = (value: number, maximum: number) => Math.min(maximum - radius, Math.max(radius, value));
  const round = (value: number) => Math.round(value / quantum) * quantum;
  return {
    x: round(clamp(point.x + intent.dx * intent.step, bounds.width)),
    y: round(clamp(point.y + intent.dy * intent.step, bounds.height)),
  };
}

export function spatialCoordinateAnnouncement(point: SpatialPoint, feetPerCell = 5): string {
  const x = Math.round(point.x * feetPerCell * 100) / 100;
  const y = Math.round(point.y * feetPerCell * 100) / 100;
  return `${x} feet east, ${y} feet south`;
}

export function nearestSpatialItem<T extends SpatialPoint & { id: string }>(
  point: SpatialPoint,
  items: readonly T[],
  maximumDistance: number,
): T | null {
  let match: T | null = null;
  let bestDistance = maximumDistance;
  for (const item of items) {
    const distance = Math.hypot(point.x - item.x, point.y - item.y);
    if (distance > bestDistance) continue;
    if (distance === bestDistance && match && item.id.localeCompare(match.id) >= 0) continue;
    match = item;
    bestDistance = distance;
  }
  return match;
}
