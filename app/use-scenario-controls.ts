"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import type { EncounterSync } from "@/app/use-encounter-sync";
import type { EncounterState, ParticipantSession } from "@/shared/contracts";

export type EncounterSummary = {
  code: string;
  name: string;
  status: "setup" | "active" | "paused";
  updatedAt: number;
};

export function useScenarioControls({ participant, state, sync, setEncounters, setNotice }: {
  participant: ParticipantSession | null;
  state: EncounterState | null;
  sync: EncounterSync;
  setEncounters: Dispatch<SetStateAction<EncounterSummary[]>>;
  setNotice: Dispatch<SetStateAction<string>>;
}) {
  const [open, setOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState("");

  const show = () => {
    setRenameError("");
    setRenameName(state?.encounter.name ?? "");
    setOpen(true);
  };

  const rename = async () => {
    if (!participant || participant.role !== "dm" || !state || renaming) return;
    const scenarioName = renameName.trim();
    if (scenarioName.length < 3) { setRenameError("Enter a scenario name of at least three characters."); return; }
    if (scenarioName === state.encounter.name) { setRenameError(""); setOpen(false); setNotice(`This scenario is already named ${scenarioName}.`); return; }
    setRenaming(true); setRenameError("");
    const result = await sync.runOptimisticCommand<{ renamed: boolean; scenario: EncounterSummary; state: EncounterState }>(
      "rename-scenario",
      { name: scenarioName },
      (current) => ({ ...current, encounter: { ...current.encounter, name: scenarioName, updatedAt: Date.now() } }),
      `${scenarioName} saved.`,
      (response) => setEncounters((current) => [response.scenario, ...current.filter((item) => item.code !== response.scenario.code)]),
      false,
    );
    if (result) { setRenameName(result.scenario.name); setOpen(false); }
    else setRenameError("The scenario name could not be saved. Try again.");
    setRenaming(false);
  };

  return { open, setOpen, show, renameName, setRenameName, renaming, renameError, rename };
}
