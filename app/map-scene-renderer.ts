import type { MapPackage } from "@/shared/map-package";

export function renderMapPackageOverlayToContext(
  context: CanvasRenderingContext2D,
  map: MapPackage,
  cellWidth: number,
  cellHeight: number,
  offsetX = 0,
  offsetY = 0,
  includePrivate = false,
) {
  context.save();
  context.translate(offsetX, offsetY);
  for (const wall of map.walls) {
    context.strokeStyle = "rgba(35, 28, 22, 0.92)";
    context.lineWidth = Math.max(4, cellWidth * 0.12);
    context.beginPath(); context.moveTo(wall.x1 * cellWidth, wall.y1 * cellHeight); context.lineTo(wall.x2 * cellWidth, wall.y2 * cellHeight); context.stroke();
    context.strokeStyle = "rgba(218, 202, 169, 0.68)";
    context.lineWidth = Math.max(1, cellWidth * 0.025);
    context.stroke();
  }
  for (const portal of map.portals) {
    const x = portal.x * cellWidth; const y = portal.y * cellHeight;
    const length = portal.orientation === "horizontal" ? cellWidth * 0.82 : cellHeight * 0.82;
    context.strokeStyle = portal.kind === "door" ? "#d6a75e" : "#79b6c5";
    context.lineWidth = Math.max(3, cellWidth * 0.08);
    context.beginPath();
    if (portal.orientation === "horizontal") { context.moveTo(x - length / 2, y); context.lineTo(x + length / 2, y); }
    else { context.moveTo(x, y - length / 2); context.lineTo(x, y + length / 2); }
    context.stroke();
  }
  context.textAlign = "center"; context.textBaseline = "middle";
  for (const label of map.labels) {
    if (label.visibility === "dm" && !includePrivate) continue;
    context.font = `700 ${Math.max(11, cellWidth * 0.24)}px ui-sans-serif, system-ui`;
    context.fillStyle = "rgba(15, 14, 12, 0.78)";
    const measured = context.measureText(label.text).width + 14;
    context.fillRect(label.x * cellWidth - measured / 2, label.y * cellHeight - 11, measured, 22);
    context.fillStyle = label.visibility === "dm" ? "#c1a6d8" : "#f3e4bb";
    context.fillText(label.text, label.x * cellWidth, label.y * cellHeight);
  }
  if (includePrivate) map.notes.forEach((note, index) => {
    context.fillStyle = "#75508f";
    context.beginPath(); context.arc(note.x * cellWidth, note.y * cellHeight, Math.max(8, cellWidth * 0.22), 0, Math.PI * 2); context.fill();
    context.fillStyle = "white"; context.font = `700 ${Math.max(10, cellWidth * 0.2)}px ui-sans-serif, system-ui`; context.fillText(String(index + 1), note.x * cellWidth, note.y * cellHeight + 0.5);
  });
  context.restore();
}

export function renderMapPackageToContext(
  context: CanvasRenderingContext2D,
  map: MapPackage,
  images: ReadonlyMap<string, HTMLImageElement>,
  cellWidth: number,
  cellHeight: number,
  offsetX = 0,
  offsetY = 0,
  includePrivate = false,
) {
  context.save();
  context.translate(offsetX, offsetY);
  const mapWidth = map.width * cellWidth; const mapHeight = map.height * cellHeight;
  const base = images.get(map.visual.assetUrl);
  if (base) context.drawImage(base, 0, 0, mapWidth, mapHeight);
  else { context.fillStyle = "#30372c"; context.fillRect(0, 0, mapWidth, mapHeight); }
  context.restore();
  renderMapPackageOverlayToContext(context, map, cellWidth, cellHeight, offsetX, offsetY, includePrivate);
}
