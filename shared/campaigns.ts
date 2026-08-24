import type { Role } from "./contracts";

export const TRUSTED_IDENTITIES = Object.freeze([
  { id: "identity-dan", displayName: "Dan" },
  { id: "identity-barry", displayName: "Barry" },
  { id: "identity-scott", displayName: "Scott" },
  { id: "identity-kevin", displayName: "Kevin" },
] as const);

export type HumanIdentity = {
  id: string;
  displayName: string;
};

export type CampaignCharacterSummary = {
  id: string;
  name: string;
  className: string;
  artAsset: string | null;
};

export type CampaignAccessSummary = {
  id: string;
  slug: string;
  name: string;
  membershipId: string;
  role: Role;
  characters: CampaignCharacterSummary[];
  encounters: Array<{
    code: string;
    name: string;
    status: "setup" | "active" | "paused";
    updatedAt: number;
  }>;
};

export type CampaignAccessResponse = {
  identity: HumanIdentity;
  items: CampaignAccessSummary[];
};

export function trustedIdentity(identityId: string): HumanIdentity | null {
  return TRUSTED_IDENTITIES.find((identity) => identity.id === identityId) ?? null;
}
