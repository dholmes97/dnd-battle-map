import type { TokenRow } from "../types.ts";
import type { HistoryReplayInput } from "./history-repository.ts";

export type InitiativeToken = Pick<
  TokenRow,
  "id" | "name" | "initiative" | "initiative_group_id" | "summoner_token_id"
>;

export interface InitiativeCombatRepository {
  findToken(encounterId: string, tokenId: string): Promise<TokenRow | null>;
  activeLeaderIds(encounterId: string, activeOrder: number | null): Promise<string[]>;
  listInitiativeTokens(encounterId: string): Promise<InitiativeToken[]>;
  setInitiative(
    encounterId: string,
    tokenId: string,
    initiative: number,
    now: number,
  ): Promise<void>;
  setInitiativeGroup(
    encounterId: string,
    tokenIds: string[],
    initiative: number,
    groupId: string,
    now: number,
  ): Promise<void>;
  rebuildOrders(
    encounterId: string,
    groups: string[][],
    activeOrder: number | null,
    now: number,
  ): Promise<void>;
  startCombat(encounterId: string, groups: string[][], now: number): Promise<void>;
  completeOrder(encounterId: string, order: number | null, now: number): Promise<void>;
  listOrders(encounterId: string): Promise<number[]>;
  exitCombat(encounterId: string, now: number): Promise<void>;
  enterTurn(encounterId: string, round: number, order: number, now: number): Promise<void>;
  orderExists(encounterId: string, order: number): Promise<boolean>;
  correctTurn(encounterId: string, round: number, order: number, now: number): Promise<void>;
  replayHistoryAction(input: HistoryReplayInput): Promise<number>;
}
