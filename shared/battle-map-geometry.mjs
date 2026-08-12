export function roundCoordinate(value) {
  return Math.round(value * 1_000) / 1_000;
}

export function distanceToSegment(point, start, end) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const projection = Math.max(0, Math.min(1, ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared));
  return Math.hypot(point.x - (start.x + projection * deltaX), point.y - (start.y + projection * deltaY));
}

export function drawingAtPoint(annotations, point, tolerance) {
  return annotations
    .filter((annotation) => annotation.type === "drawing" && annotation.x2 !== null && annotation.y2 !== null)
    .map((annotation) => ({ annotation, distance: distanceToSegment(point, annotation, { x: annotation.x2, y: annotation.y2 }) }))
    .filter(({ distance }) => distance <= tolerance)
    .sort((a, b) => a.distance - b.distance)[0]?.annotation ?? null;
}

export function clampMapPoint(grid, point, radius = 0.5) {
  return {
    x: roundCoordinate(Math.min(grid.width - radius, Math.max(radius, point.x))),
    y: roundCoordinate(Math.min(grid.height - radius, Math.max(radius, point.y))),
  };
}

export function calculateDirectDistance(from, to, feetPerCell = 5) {
  const squares = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  return Math.round(squares * feetPerCell * 10) / 10;
}

export function tokenArtScale(size) {
  return size === "small" ? 0.75 : 1;
}

export function fitGridGeometry(gridWidth, gridHeight, width, height) {
  const cellSize = Math.max(1, Math.min(width / gridWidth, height / gridHeight));
  return {
    cellSize,
    visibleWidth: gridWidth,
    visibleHeight: gridHeight,
    panX: 0,
    panY: 0,
    offsetX: Math.max(0, (width - gridWidth * cellSize) / 2),
    offsetY: Math.max(0, (height - gridHeight * cellSize) / 2),
  };
}

export function viewportGeometry(viewport, state, width, height) {
  const mapKey = `${state.encounter.mapPackage?.id ?? "empty"}:${state.grid.width}x${state.grid.height}`;
  const matchesMap = viewport.mapKey === mapKey;
  const baseCellSize = Math.max(width / state.grid.width, height / state.grid.height);
  const fitZoom = Math.min(width / state.grid.width, height / state.grid.height) / baseCellSize;
  const fit = matchesMap && viewport.fit;
  const fitted = fit ? fitGridGeometry(state.grid.width, state.grid.height, width, height) : null;
  const requestedZoom = matchesMap ? viewport.zoom : 1;
  const zoom = fit ? fitZoom : Math.max(1, Math.min(3, requestedZoom));
  const cellSize = fitted?.cellSize ?? Math.max(1, baseCellSize * zoom);
  const visibleWidth = Math.min(state.grid.width, width / cellSize);
  const visibleHeight = Math.min(state.grid.height, height / cellSize);
  const requestedCenterX = matchesMap ? viewport.centerX : state.grid.width / 2;
  const requestedCenterY = matchesMap ? viewport.centerY : state.grid.height / 2;
  const centerX = Math.max(visibleWidth / 2, Math.min(state.grid.width - visibleWidth / 2, requestedCenterX));
  const centerY = Math.max(visibleHeight / 2, Math.min(state.grid.height - visibleHeight / 2, requestedCenterY));
  return {
    zoom,
    centerX,
    centerY,
    mapKey,
    fit,
    cellSize,
    visibleWidth,
    visibleHeight,
    panX: fitted?.panX ?? centerX - visibleWidth / 2,
    panY: fitted?.panY ?? centerY - visibleHeight / 2,
    offsetX: fitted?.offsetX ?? Math.max(0, (width - state.grid.width * cellSize) / 2),
    offsetY: fitted?.offsetY ?? Math.max(0, (height - state.grid.height * cellSize) / 2),
  };
}

export function clampViewport(viewport, state, width, height) {
  const geometry = viewportGeometry(viewport, state, width, height);
  return { zoom: geometry.fit ? 1 : geometry.zoom, centerX: geometry.centerX, centerY: geometry.centerY, mapKey: geometry.mapKey, fit: geometry.fit };
}

export function zoomViewportAt(viewport, state, width, height, zoom, focusX = 0.5, focusY = 0.5) {
  const current = viewportGeometry(viewport, state, width, height);
  const baseCellSize = Math.max(width / state.grid.width, height / state.grid.height);
  const fitZoom = Math.min(width / state.grid.width, height / state.grid.height) / baseCellSize;
  const nextFit = zoom < 1;
  const nextZoom = nextFit ? 1 : Math.min(3, zoom);
  const effectiveNextZoom = nextFit ? fitZoom : nextZoom;
  const mapX = current.panX + Math.min(current.visibleWidth, Math.max(0, focusX * width - current.offsetX) / current.cellSize);
  const mapY = current.panY + Math.min(current.visibleHeight, Math.max(0, focusY * height - current.offsetY) / current.cellSize);
  const visibleWidth = Math.min(state.grid.width, width / (baseCellSize * effectiveNextZoom));
  const visibleHeight = Math.min(state.grid.height, height / (baseCellSize * effectiveNextZoom));
  return clampViewport({
    zoom: nextZoom,
    centerX: mapX + (0.5 - focusX) * visibleWidth,
    centerY: mapY + (0.5 - focusY) * visibleHeight,
    mapKey: current.mapKey,
    fit: nextFit,
  }, state, width, height);
}
