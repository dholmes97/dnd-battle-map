import type { CreatureSize } from "../../shared/creature-library.ts";
import type { TokenRow } from "../types.ts";

export type ScenarioSeedToken = TokenRow & {
  copiedId: string;
  copiedSummonerId: string | null;
  copiedHp: number | null;
  copiedHidden: boolean;
  copiedAltitude: number;
};

export type NewScenarioWrite = {
  id: string;
  code: string;
  name: string;
  mapAsset: string;
  mapPackageJson: string | null;
  width: number;
  height: number;
  strictMovement: boolean;
  participantId: string;
  sessionSecret: string;
  tokens: ScenarioSeedToken[];
  now: number;
};

export type MapPresetWrite = {
  id: string;
  encounterId: string;
  name: string;
  description: string;
  sourcePrompt: string | null;
  packageJson: string;
  participantId: string;
  now: number;
};

export interface ScenarioMapRepository {
  renameScenario(encounterId: string, name: string, now: number): Promise<void>;
  scenarioCodeExists(code: string): Promise<boolean>;
  listScenarioTokens(encounterId: string): Promise<TokenRow[]>;
  createScenario(input: NewScenarioWrite): Promise<void>;
  saveMapPreset(input: MapPresetWrite, update: boolean): Promise<boolean>;
  deleteMapPreset(encounterId: string, presetId: string): Promise<boolean>;
  clearActivePreset(encounterId: string): Promise<void>;
  loadMapPreset(encounterId: string, presetId: string): Promise<string | null>;
  listTokenPositions(encounterId: string): Promise<Array<{
    id: string;
    x: number;
    y: number;
    size: CreatureSize;
  }>>;
  applyMapPackage(input: {
    encounterId: string;
    packageJson: string;
    activePresetId: string | null;
    width: number;
    height: number;
    tokenPositions: Array<{ id: string; x: number; y: number }>;
    now: number;
  }): Promise<void>;
  configureEncounter(
    encounterId: string,
    status: "setup" | "active" | "paused",
    now: number,
  ): Promise<void>;
}
