import type { Metadata } from "next";
import BattleMapPrototype from "./battle-map-prototype";

export const metadata: Metadata = {
  description:
    "A focused real-time battle-map prototype for shared token movement.",
};

export default function Home() {
  return <BattleMapPrototype />;
}
