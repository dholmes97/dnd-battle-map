import { selectEmailCampaign, selectEmailRevisionTarget } from "../../shared/scenario-email-routing.ts";
import { ScenarioProvisioningWriteError } from "../ports/scenario-provisioning-repository.ts";
import { MAX_CAMPAIGNS, MAX_SCENARIOS, MAX_CAMPAIGN_CHARACTERS_PER_CAMPAIGN, MAX_TOKENS_PER_ENCOUNTER } from "../../shared/resource-limits.ts";

export async function provisioningMembership(db: D1Database, sender: string, campaignId: string) {
  return db.prepare(`SELECT cm.id, cm.identity_id FROM campaign_memberships cm
    JOIN identities i ON i.id = cm.identity_id
    WHERE (? = '' OR cm.campaign_id = ?) AND lower(i.login_email) = ?
    AND (cm.role = 'dm' OR cm.can_provision_scenarios = 1) LIMIT 1`)
    .bind(campaignId, campaignId, sender).first<{ id: string; identity_id: string }>();
}

/** Secret-authenticated, sender-scoped preparation context. Never a public campaign listing. */
export async function provisioningContext(db: D1Database, sender: string, input: Record<string, unknown>) {
  const campaigns = await db.prepare(`SELECT c.id, c.slug, c.name FROM campaigns c
    JOIN campaign_memberships cm ON cm.campaign_id = c.id JOIN identities i ON i.id = cm.identity_id
    WHERE lower(i.login_email) = ? AND (cm.role = 'dm' OR cm.can_provision_scenarios = 1)
    ORDER BY c.name, c.id LIMIT ?`).bind(sender, MAX_CAMPAIGNS).all<{ id: string; slug: string; name: string }>();
  const campaignId = typeof input.campaignId === "string" ? input.campaignId : null;
  if (!campaignId) return { campaigns: campaigns.results, selection: selectEmailCampaign(campaigns.results, typeof input.campaignName === "string" ? input.campaignName : undefined) };
  if (!campaigns.results.some((campaign) => campaign.id === campaignId)) throw new ScenarioProvisioningWriteError("campaign_unauthorized", "Email preparation is not authorized for this campaign.", 403);
  const encounters = await db.prepare(`SELECT code, name, status, version, draft_updated_at AS draftUpdatedAt FROM encounters WHERE campaign_id = ? ORDER BY updated_at DESC LIMIT ?`)
    .bind(campaignId, MAX_SCENARIOS).all();
  const characters = await db.prepare(`SELECT id, name, size, speed, armor_class AS armorClass, max_hp AS maxHp FROM campaign_characters WHERE campaign_id = ? AND is_active = 1 ORDER BY sort_order, id LIMIT ?`)
    .bind(campaignId, MAX_CAMPAIGN_CHARACTERS_PER_CAMPAIGN).all();
  const threadJobs = typeof input.mailboxKey === "string" && typeof input.threadId === "string"
    ? (await db.prepare(`SELECT j.id, j.status, j.scenario_code AS scenarioCode FROM scenario_provisioning_jobs j
        JOIN encounters e ON e.id = j.scenario_id WHERE e.campaign_id = ?
        AND json_extract(j.manifest_json, '$.source.mailboxKey') = ?
        AND json_extract(j.manifest_json, '$.source.threadId') = ?
        ORDER BY j.created_at DESC LIMIT 50`).bind(campaignId, input.mailboxKey, input.threadId).all<{ id: string; status: string; scenarioCode: string | null }>()).results : [];
  if (typeof input.scenarioCode !== "string") return { campaigns: campaigns.results, encounters: encounters.results, characters: characters.results, threadJobs, threadTarget: selectEmailRevisionTarget(threadJobs) };
  const encounter = await db.prepare(`SELECT id, code, name, status, version, dm_briefing AS briefing, grid_width AS width, grid_height AS height,
    active_map_image_id AS activeMapImageId, draft_map_image_id AS draftMapImageId, draft_map_setup_json AS draftSetupJson,
    draft_updated_at AS draftUpdatedAt FROM encounters WHERE campaign_id = ? AND code = ? LIMIT 1`)
    .bind(campaignId, input.scenarioCode).first<{ id: string }>();
  if (!encounter) throw new ScenarioProvisioningWriteError("scenario_not_found", "Encounter not found in this campaign.", 404);
  const tokens = await db.prepare(`SELECT id, name, kind, x, y, size, campaign_character_id AS campaignCharacterId, summoner_token_id AS summonerTokenId FROM tokens WHERE encounter_id = ? ORDER BY id LIMIT ?`)
    .bind(encounter.id, MAX_TOKENS_PER_ENCOUNTER).all();
  const handouts = await db.prepare(`SELECT id, title FROM handouts WHERE encounter_id = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 100`)
    .bind(encounter.id).all();
  return { campaigns: campaigns.results, encounter, characters: characters.results, tokens: tokens.results, handouts: handouts.results };
}
