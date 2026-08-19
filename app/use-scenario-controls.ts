"use client";

import { useState } from "react";

export type EncounterSummary = {
  code: string;
  name: string;
  status: "setup" | "active" | "paused";
  updatedAt: number;
};

export function useScenarioControls() {
  const [open, setOpen] = useState(false);
  return { open, setOpen, show: () => setOpen(true) };
}
