const ANGLE_EPSILON = 0.00001;
// A 16-sided approximation is visually smooth at battle-map scale while keeping
// ray casting comfortably below a frame budget on maps with many blockers.
const CIRCLE_SIDES = 16;

export function defaultSharedFogPolygon(width, height) {
  return [
    { x: 0, y: 0 }, { x: width / 2, y: 0 }, { x: width, y: 0 },
    { x: width, y: height / 2 }, { x: width, y: height }, { x: width / 2, y: height },
    { x: 0, y: height }, { x: 0, y: height / 2 },
  ];
}

export function ensureSharedFogPolygon(polygon, width, height) {
  const oldDefault = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
  const isOldDefault = polygon?.length === oldDefault.length && polygon.every((point, index) => point.x === oldDefault[index].x && point.y === oldDefault[index].y);
  return isOldDefault ? defaultSharedFogPolygon(width, height) : polygon;
}

export function insertSharedFogPoint(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 2) return polygon;
  let edgeIndex = 0; let longest = -1;
  polygon.forEach((start, index) => {
    const end = polygon[(index + 1) % polygon.length]; const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length > longest) { longest = length; edgeIndex = index; }
  });
  const start = polygon[edgeIndex]; const end = polygon[(edgeIndex + 1) % polygon.length];
  return [...polygon.slice(0, edgeIndex + 1), { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, ...polygon.slice(edgeIndex + 1)];
}

export function defaultFogConfig(width, height) {
  return {
    mode: "off",
    sharedPolygon: defaultSharedFogPolygon(width, height),
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
  const target = fogBlockerHandleAtPoint(fog, point, tolerance);
  return target ? { kind: target.kind, id: target.id } : null;
}

function blockerTargets(fog, preferred) {
  const targets = [];
  if (preferred) targets.push(preferred);
  for (const kind of ["circle", "door", "wall"]) {
    const collection = kind === "circle" ? fog.circles : kind === "door" ? fog.doors : fog.walls;
    for (const item of [...collection].reverse()) if (!preferred || preferred.kind !== kind || preferred.id !== item.id) targets.push({ kind, id: item.id });
  }
  return targets;
}

export function fogBlockerHandleAtPoint(fog, point, tolerance = 0.3, preferred = /** @type {{ kind: string, id: string } | null} */ (null)) {
  for (const target of blockerTargets(fog, preferred)) {
    const collection = target.kind === "circle" ? fog.circles : target.kind === "door" ? fog.doors : fog.walls;
    const item = collection.find((candidate) => candidate.id === target.id); if (!item) continue;
    if (target.kind === "circle") {
      const distance = Math.hypot(point.x - item.x, point.y - item.y);
      if (Math.abs(distance - item.radius) <= tolerance) return { ...target, handle: "radius" };
      if (distance <= item.radius) return { ...target, handle: "body" };
      continue;
    }
    if (Math.hypot(point.x - item.x1, point.y - item.y1) <= tolerance) return { ...target, handle: "start" };
    if (Math.hypot(point.x - item.x2, point.y - item.y2) <= tolerance) return { ...target, handle: "end" };
    if (distanceToSegment(point, item, { x: item.x2, y: item.y2 }) <= tolerance) return { ...target, handle: "body" };
  }
  return null;
}

const rounded = (value) => Math.round(value * 1000) / 1000;
const bounded = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export function dragFogBlocker(fog, target, start, current, width, height) {
  const collectionName = target.kind === "circle" ? "circles" : target.kind === "door" ? "doors" : "walls";
  const item = fog[collectionName].find((candidate) => candidate.id === target.id);
  if (!item) return fog;
  let updated;
  if (target.kind === "circle") {
    if (target.handle === "radius") updated = { ...item, radius: rounded(bounded(Math.hypot(current.x - item.x, current.y - item.y), 0.1, Math.max(width, height))) };
    else updated = { ...item, x: rounded(bounded(item.x + current.x - start.x, 0, width)), y: rounded(bounded(item.y + current.y - start.y, 0, height)) };
  } else if (target.handle === "start") updated = { ...item, x1: rounded(bounded(current.x, 0, width)), y1: rounded(bounded(current.y, 0, height)) };
  else if (target.handle === "end") updated = { ...item, x2: rounded(bounded(current.x, 0, width)), y2: rounded(bounded(current.y, 0, height)) };
  else {
    const requestedX = current.x - start.x; const requestedY = current.y - start.y;
    const deltaX = bounded(requestedX, -Math.min(item.x1, item.x2), width - Math.max(item.x1, item.x2));
    const deltaY = bounded(requestedY, -Math.min(item.y1, item.y2), height - Math.max(item.y1, item.y2));
    updated = { ...item, x1: rounded(item.x1 + deltaX), y1: rounded(item.y1 + deltaY), x2: rounded(item.x2 + deltaX), y2: rounded(item.y2 + deltaY) };
  }
  return { ...fog, [collectionName]: fog[collectionName].map((candidate) => candidate.id === target.id ? updated : candidate) };
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

export function revealedRoundBlockers(origins, polygons, circles) {
  return circles.filter((circle) => origins.some((origin, index) => {
    const distance = Math.hypot(origin.x - circle.x, origin.y - circle.y);
    if (distance <= circle.radius) return true;
    const revealMargin = Math.max(0.001, circle.radius * 0.001);
    const surface = {
      x: circle.x + (origin.x - circle.x) / distance * (circle.radius + revealMargin),
      y: circle.y + (origin.y - circle.y) / distance * (circle.radius + revealMargin),
    };
    return pointInPolygon(surface, polygons[index] ?? []);
  }));
}

export function visibilityForViewer(mapPackage, tokens, viewer) {
  const fog = mapPackage?.fog;
  if (!fog || fog.mode === "off" || viewer?.role === "dm") return { mode: fog?.mode ?? "off", polygons: [] };
  if (fog.mode === "shared") return { mode: "shared", polygons: [], hiddenPolygon: fog.sharedPolygon };
  const origins = tokens.filter((token) => token.controlledByViewer && token.kind !== "spell-effect").map((token) => ({ x: token.x, y: token.y }));
  const polygons = origins.map((origin) => visibilityPolygon(origin, fog, mapPackage.width, mapPackage.height));
  return {
    mode: "dynamic",
    polygons,
    revealedCircles: revealedRoundBlockers(origins, polygons, fog.circles),
    geometry: { walls: fog.walls, doors: fog.doors, circles: fog.circles },
  };
}

export function pointVisibleToViewer(point, visibility) {
  if (!visibility || visibility.mode === "off") return true;
  if (visibility.mode === "shared") return !pointInPolygon(point, visibility.hiddenPolygon ?? []);
  return visibility.polygons.some((polygon) => pointInPolygon(point, polygon))
    || (visibility.revealedCircles ?? []).some((circle) => Math.hypot(point.x - circle.x, point.y - circle.y) <= circle.radius);
}
