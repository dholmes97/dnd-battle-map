export type AnnotationGeometry = {
  type: unknown;
  x: unknown;
  y: unknown;
  x2?: unknown;
  y2?: unknown;
};

export function annotationGeometryIsBounded(
  annotation: AnnotationGeometry,
  gridWidth: number,
  gridHeight: number,
): boolean {
  if (!pointIsBounded(annotation.x, annotation.y, gridWidth, gridHeight)) return false;
  const x2 = annotation.x2 ?? null;
  const y2 = annotation.y2 ?? null;
  const hasX2 = x2 !== null;
  const hasY2 = y2 !== null;
  if (hasX2 !== hasY2 || (annotation.type === "drawing" && !hasX2)) return false;
  return !hasX2 || pointIsBounded(x2, y2, gridWidth, gridHeight);
}

function pointIsBounded(x: unknown, y: unknown, width: number, height: number): boolean {
  return typeof x === "number" && typeof y === "number" &&
    Number.isFinite(x) && Number.isFinite(y) &&
    x >= 0 && x <= width && y >= 0 && y <= height;
}
