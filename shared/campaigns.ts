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
  loginEmail?: string;
  canCreateCampaigns?: boolean;
};

export type CampaignCharacterSummary = {
  id: string;
  name: string;
  className: string;
  artAsset: string | null;
  size?: string;
  speed?: number;
  armorClass?: number;
  maxHp?: number;
};

export type CampaignMemberSummary = {
  membershipId: string;
  identity: HumanIdentity;
  role: Role;
  characters: CampaignCharacterSummary[];
};

export type CampaignAccessSummary = {
  id: string;
  slug: string;
  name: string;
  membershipId: string;
  role: Role;
  characters: CampaignCharacterSummary[];
  members?: CampaignMemberSummary[];
  encounters: Array<{
    code: string;
    name: string;
    status: "setup" | "active" | "paused";
    updatedAt: number;
  }>;
};

export type CampaignAccessResponse = {
  identity: HumanIdentity;
  invitedIdentities: HumanIdentity[];
  items: CampaignAccessSummary[];
};

export function trustedIdentity(identityId: string): HumanIdentity | null {
  return TRUSTED_IDENTITIES.find((identity) => identity.id === identityId) ?? null;
}
