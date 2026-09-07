export type Beyond20Link = { characterId: string; sheetId: string | null; controllerIdentityId: string };
export interface Beyond20Repository {
  findLink(campaignId: string, tokenId: string, encounterId: string): Promise<Beyond20Link | null>;
  sheetInUse(campaignId: string, characterId: string, sheetId: string): Promise<boolean>;
  setLink(campaignId: string, characterId: string, sheetId: string | null, encounterId: string, now: number): Promise<void>;
}
