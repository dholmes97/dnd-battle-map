import type { Metadata } from "next";
import BattleMapPrototype from "./battle-map-prototype";

export const metadata: Metadata = {
  description:
    "Plan scenarios, share handouts, and run live tactical encounters with the Friday Lunch Crew.",
};

export default function Home() {
  return <BattleMapPrototype />;
}
