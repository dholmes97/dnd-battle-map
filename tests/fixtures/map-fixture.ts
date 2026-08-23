import { createMapPackageForImage, type MapImage } from "../../shared/map-package.ts";

export const TEST_MAP_IMAGE: MapImage = {
  id: "grandfather-tree-roots-v1",
  name: "Grandfather Tree Roots",
  description: "The shaded base of the Grandfather Tree.",
  biome: "forest",
  mood: "daylight",
  assetPath: "/map-assets/grandfather-tree-roots-01.jpg",
  gridWidth: 24,
  gridHeight: 16,
  pixelWidth: 3072,
  pixelHeight: 2048,
  sourceKind: "built-in",
  sourcePrompt: null,
  createdAt: 0,
  updatedAt: 0,
  active: true,
};

export function testMapPackage() {
  return createMapPackageForImage(TEST_MAP_IMAGE);
}
