export function mapThumbnailUrl(assetUrl) {
  return `/assets/full-map-thumbnails/${assetUrl.split("/").pop()}`;
}

export function snapMapPoint(point) {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

export function nextMapRotation(rotation) {
  return (rotation + 90) % 360;
}

export function sceneObjectBounds(object) {
  const rotated = object.rotation === 90 || object.rotation === 270;
  return { width: rotated ? object.height : object.width, height: rotated ? object.width : object.height };
}

export function sceneObjectAt(map, point) {
  return [...map.sceneObjects].reverse().find((object) => {
    const bounds = sceneObjectBounds(object);
    return point.x >= object.x && point.x <= object.x + bounds.width && point.y >= object.y && point.y <= object.y + bounds.height;
  }) ?? null;
}

export function mapNoteAt(map, point, tolerance = 0.38) {
  return [...map.notes].reverse().find((note) => Math.hypot(note.x - point.x, note.y - point.y) <= tolerance) ?? null;
}
