import type { CreatureSize } from "../../shared/creature-library.ts";
import type { MapImage } from "../../shared/map-package.ts";
import type { TokenRow } from "../types.ts";

export type ScenarioSeedToken = TokenRow & {
  copiedId: string;
  copiedSummonerId: string | null;
  copiedHp: number | null;
  copiedTemporaryHp: number;
  copiedHidden: boolean;
  copiedAltitude: number;
};

export type NewScenarioWrite = {
  id: string;
  campaignId: string;
  code: string;
  name: string;
  activeMapImageId: string | null;
  activeMapSetupJson: string | null;
  draftMapImageId: string | null;
  draftMapSetupJson: string | null;
  width: number;
  height: number;
  strictMovement: boolean;
  participantId: string;
  participantIdentityId: string;
  participantMembershipId: string;
  participantName: string;
  sessionSecret: string;
  tokens: ScenarioSeedToken[];
  now: number;
};

export interface ScenarioMapRepository {
  renameScenario(encounterId: string, name: string, now: number): Promise<void>;
  countScenarios(campaignId: string): Promise<number>;
  scenarioCodeExists(code: string): Promise<boolean>;
  listScenarioTokens(encounterId: string): Promise<TokenRow[]>;
  createScenario(input: NewScenarioWrite): Promise<void>;
  findMapImage(mapImageId: string): Promise<MapImage | null>;
  saveMapDraft(encounterId: string, mapImageId: string, setupJson: string, now: number): Promise<void>;
  discardMapDraft(encounterId: string, now: number): Promise<void>;
  listTokenPositions(encounterId: string): Promise<Array<{
    id: string;
    x: number;
    y: number;
    size: CreatureSize;
  }>>;
  applyMapDraft(input: {
    encounterId: string;
    mapImageId: string;
    setupJson: string;
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
