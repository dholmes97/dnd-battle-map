const ANGLE_EPSILON = 0.00001;
// A 16-sided approximation is visually smooth at battle-map scale while keeping
// ray casting comfortably below a frame budget on maps with many blockers.
const CIRCLE_SIDES = 16;

export function defaultFogConfig(width, height) {
  return {
    mode: "off",
    sharedPolygon: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }],
    walls: [], doors: [], circles: [],
  };
}

export function pointInPolygon(point, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]; const b = polygon[j];
    if (((a.y > point.y) !== (b.y > point.y)) && point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || Number.EPSILON) + a.x) inside = !inside;
  }
  return inside;
}

export function distanceToSegment(point, start, end) {
  const dx = end.x - start.x; const dy = end.y - start.y; const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

export function fogBlockerAtPoint(fog, point, tolerance = 0.3) {
  const circle = [...fog.circles].reverse().find((item) => Math.abs(Math.hypot(point.x - item.x, point.y - item.y) - item.radius) <= tolerance);
  if (circle) return { kind: "circle", id: circle.id };
  const door = [...fog.doors].reverse().find((item) => distanceToSegment(point, item, { x: item.x2, y: item.y2 }) <= tolerance);
  if (door) return { kind: "door", id: door.id };
  const wall = [...fog.walls].reverse().find((item) => distanceToSegment(point, item, { x: item.x2, y: item.y2 }) <= tolerance);
  return wall ? { kind: "wall", id: wall.id } : null;
}

function blockerSegments(fog, width, height) {
  const segments = [
    { x1: 0, y1: 0, x2: width, y2: 0 }, { x1: width, y1: 0, x2: width, y2: height },
    { x1: width, y1: height, x2: 0, y2: height }, { x1: 0, y1: height, x2: 0, y2: 0 },
    ...fog.walls, ...fog.doors.filter((door) => !door.open),
  ];
  for (const circle of fog.circles) {
    for (let index = 0; index < CIRCLE_SIDES; index += 1) {
      const start = index / CIRCLE_SIDES * Math.PI * 2; const end = (index + 1) / CIRCLE_SIDES * Math.PI * 2;
      segments.push({ x1: circle.x + Math.cos(start) * circle.radius, y1: circle.y + Math.sin(start) * circle.radius, x2: circle.x + Math.cos(end) * circle.radius, y2: circle.y + Math.sin(end) * circle.radius });
    }
  }
  return segments;
}

function raySegmentIntersection(origin, angle, segment) {
  const rayX = Math.cos(angle); const rayY = Math.sin(angle); const segmentX = segment.x2 - segment.x1; const segmentY = segment.y2 - segment.y1;
  const denominator = rayX * segmentY - rayY * segmentX;
  if (Math.abs(denominator) < 1e-10) return null;
  const dx = segment.x1 - origin.x; const dy = segment.y1 - origin.y;
  const rayDistance = (dx * segmentY - dy * segmentX) / denominator; const segmentPosition = (dx * rayY - dy * rayX) / denominator;
  if (rayDistance < 0 || segmentPosition < 0 || segmentPosition > 1) return null;
  return { x: origin.x + rayX * rayDistance, y: origin.y + rayY * rayDistance, distance: rayDistance };
}

export function visibilityPolygon(origin, fog, width, height) {
  const segments = blockerSegments(fog, width, height); const angles = [];
  const points = new Map();
  for (const segment of segments) for (const point of [{ x: segment.x1, y: segment.y1 }, { x: segment.x2, y: segment.y2 }]) points.set(`${point.x.toFixed(6)}:${point.y.toFixed(6)}`, point);
  for (const point of points.values()) {
    const angle = Math.atan2(point.y - origin.y, point.x - origin.x); angles.push(angle - ANGLE_EPSILON, angle, angle + ANGLE_EPSILON);
  }
  return angles.map((angle) => {
    let closest = null;
    for (const segment of segments) { const hit = raySegmentIntersection(origin, angle, segment); if (hit && (!closest || hit.distance < closest.distance)) closest = hit; }
    return closest ? { x: closest.x, y: closest.y, angle } : null;
  }).filter(Boolean).sort((a, b) => a.angle - b.angle).map(({ x, y }) => ({ x, y }));
}

export function visibilityForViewer(mapPackage, tokens, viewer) {
  const fog = mapPackage?.fog;
  if (!fog || fog.mode === "off" || viewer?.role === "dm") return { mode: fog?.mode ?? "off", polygons: [] };
  if (fog.mode === "shared") return { mode: "shared", polygons: [], hiddenPolygon: fog.sharedPolygon };
  const origins = tokens.filter((token) => token.controlledByViewer && token.kind !== "spell-effect").map((token) => ({ x: token.x, y: token.y }));
  return {
    mode: "dynamic",
    polygons: origins.map((origin) => visibilityPolygon(origin, fog, mapPackage.width, mapPackage.height)),
    geometry: { walls: fog.walls, doors: fog.doors, circles: fog.circles },
  };
}

export function pointVisibleToViewer(point, visibility) {
  if (!visibility || visibility.mode === "off") return true;
  if (visibility.mode === "shared") return !pointInPolygon(point, visibility.hiddenPolygon ?? []);
  return visibility.polygons.some((polygon) => pointInPolygon(point, polygon));
}
