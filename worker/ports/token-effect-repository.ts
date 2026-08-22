import type { EffectRow, TokenRow } from "../types.ts";
import type { HistoryReplayInput } from "./history-repository.ts";

export type EffectWithToken = EffectRow & {
  created_by: string;
  created_at: number;
  token: TokenRow;
};

export type TokenWrite = {
  id: string;
  encounterId: string;
  name: string;
  x: number;
  y: number;
  artAsset: string | null;
  kind: string;
  size: TokenRow["size"];
  speed: number;
  flySpeed: number | null;
  swimSpeed: number | null;
  climbSpeed: number | null;
  burrowSpeed: number | null;
  altitude: number;
  armorClass: number | null;
  hp: number | null;
  maxHp: number | null;
  hidden: boolean;
  summonerTokenId: string | null;
  initiative: number | null;
  initiativeOrder: number | null;
  now: number;
};

export interface TokenEffectRepository {
  findToken(encounterId: string, tokenId: string): Promise<TokenRow | null>;
  createToken(input: TokenWrite): Promise<boolean>;
  resizeToken(
    encounterId: string,
    tokenId: string,
    size: TokenRow["size"],
    x: number,
    y: number,
    now: number,
  ): Promise<void>;
  updateToken(input: TokenWrite): Promise<void>;
  hasConcentration(tokenId: string): Promise<boolean>;
  updateHp(encounterId: string, tokenId: string, hp: number, now: number): Promise<void>;
  addEffect(input: {
    id: string;
    encounterId: string;
    tokenId: string;
    name: string;
    effectType: string;
    durationRounds: number | null;
    expiresRound: number | null;
    reminderTiming: string;
    participantId: string;
    now: number;
  }): Promise<boolean>;
  findEffect(encounterId: string, effectId: string): Promise<EffectWithToken | null>;
  removeEffect(encounterId: string, effectId: string): Promise<void>;
  deleteToken(encounterId: string, tokenId: string): Promise<void>;
  replayHistoryAction(input: HistoryReplayInput): Promise<number>;
}
