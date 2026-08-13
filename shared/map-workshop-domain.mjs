export function mapThumbnailUrl(assetUrl) {
  return `/assets/full-map-thumbnails/${assetUrl.split("/").pop()}`;
}

export function snapMapPoint(point) {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

export function mapNoteAt(map, point, tolerance = 0.38) {
  return [...map.notes].reverse().find((note) => Math.hypot(note.x - point.x, note.y - point.y) <= tolerance) ?? null;
}
