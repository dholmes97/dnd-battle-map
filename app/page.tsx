import type { Metadata } from "next";
import BattleMapPrototype from "./battle-map-prototype";

export const metadata: Metadata = {
  description:
    "Prepare encounters, share handouts, and run live tactical battles with the Friday Lunch Crew.",
};

export default function Home() {
  return <BattleMapPrototype />;
}
