import type { Metadata } from "next";
import { WorldAtlas } from "./world-atlas";

export const metadata: Metadata = {
  title: "World Atlas",
  description: "An original deep-zoom campaign atlas of Faerûn, the Sword Coast, and Waterdeep.",
};

export default function WorldMapPage() {
  return <WorldAtlas />;
}
