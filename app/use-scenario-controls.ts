"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { battleMapApi as api, sessionPayload, type useEncounterSync } from "@/app/use-encounter-sync";
import type { EncounterState, ParticipantSession, Role } from "@/shared/contracts";

export type EncounterSummary = {
  code: string;
  name: string;
  status: "setup" | "active" | "paused";
  updatedAt: number;
};

type EncounterSync = ReturnType<typeof useEncounterSync>;

export function useScenarioControls({ participant, state, sync, resetChatForParticipant, setEncounterCode, setEncounters, setSelectedTokenId, setNotice }: {
  participant: ParticipantSession | null;
  state: EncounterState | null;
  sync: EncounterSync;
  resetChatForParticipant: (name: string, role: Role, encounterCode: string) => void;
  setEncounterCode: Dispatch<SetStateAction<string>>;
  setEncounters: Dispatch<SetStateAction<EncounterSummary[]>>;
  setSelectedTokenId: Dispatch<SetStateAction<string | null>>;
  setNotice: Dispatch<SetStateAction<string>>;
}) {
  const [open, setOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"party" | "duplicate">("party");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const show = () => {
    setError("");
    setRenameError("");
    setRenameName(state?.encounter.name ?? "");
    setOpen(true);
  };

  const create = async () => {
    if (!participant || participant.role !== "dm" || !state || creating) return;
    const scenarioName = name.trim();
    if (scenarioName.length < 3) { setError("Enter a scenario name of at least three characters."); return; }
    setCreating(true); setError("");
    try {
      const result = await api<{ participantId: string; sessionSecret: string; role: Role; scenario: EncounterSummary; state: EncounterState }>(`/api/encounters/${encodeURIComponent(state.encounter.code)}/command`, {
        method: "POST",
        body: sessionPayload(participant, { command: "create-scenario", name: scenarioName, mode }),
      });
      sync.clearPendingState();
      const joined = { id: result.participantId, name: "Kevin", role: result.role, sessionSecret: result.sessionSecret };
      resetChatForParticipant(joined.name, joined.role, result.scenario.code);
      sync.setParticipant(joined); sync.setState(result.state); setEncounterCode(result.scenario.code);
      setEncounters((current) => [result.scenario, ...current.filter((encounter) => encounter.code !== result.scenario.code)]);
      setSelectedTokenId(null); setOpen(false); setName(""); setMode("party"); sync.setConnection("connecting");
      setNotice(`${result.scenario.name} created.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The scenario could not be created.");
    } finally { setCreating(false); }
  };

  const rename = async () => {
    if (!participant || participant.role !== "dm" || !state || renaming || creating) return;
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

  return { open, setOpen, show, renameName, setRenameName, renaming, renameError, name, setName, mode, setMode, creating, error, create, rename };
}
