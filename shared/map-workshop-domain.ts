import type { MapPoint } from "./contracts";
import type { MapPackage, MapNote } from "./map-package";

export function mapThumbnailUrl(assetUrl: string): string {
  return `/assets/full-map-thumbnails/${assetUrl.split("/").pop()}`;
}

export function snapMapPoint(point: MapPoint): MapPoint {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

export function mapNoteAt(map: MapPackage, point: MapPoint, tolerance = 0.38): MapNote | null {
  return [...map.notes].reverse().find((note) => Math.hypot(note.x - point.x, note.y - point.y) <= tolerance) ?? null;
}
