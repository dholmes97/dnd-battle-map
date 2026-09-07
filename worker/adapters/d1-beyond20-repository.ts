import type { Beyond20Repository } from "../ports/beyond20-repository.ts";

export function createD1Beyond20Repository(db: D1Database): Beyond20Repository {
  return {
    async findLink(campaignId, tokenId, encounterId) {
      return db.prepare(`SELECT cc.id AS characterId, cc.beyond20_character_id AS sheetId, cm.identity_id AS controllerIdentityId
        FROM tokens t JOIN campaign_characters cc ON cc.id = t.campaign_character_id
        JOIN campaign_memberships cm ON cm.id = cc.controller_membership_id AND cm.campaign_id = cc.campaign_id
        WHERE t.id = ? AND t.encounter_id = ? AND cc.campaign_id = ? AND cc.is_active = 1 AND t.summoner_token_id IS NULL`)
        .bind(tokenId, encounterId, campaignId).first();
    },
    async sheetInUse(campaignId, characterId, sheetId) {
      return Boolean(await db.prepare("SELECT id FROM campaign_characters WHERE campaign_id = ? AND beyond20_character_id = ? AND id != ? LIMIT 1")
        .bind(campaignId, sheetId, characterId).first());
    },
    async setLink(campaignId, characterId, sheetId, encounterId, now) {
      await db.prepare("UPDATE campaign_characters SET beyond20_character_id = ?, updated_at = ? WHERE id = ? AND campaign_id = ?")
        .bind(sheetId, now, characterId, campaignId).run();
      // Links are campaign-wide; wake the other encounters' unchanged-state polls.
      await db.prepare("UPDATE encounters SET version = version + 1, updated_at = ? WHERE campaign_id = ? AND id != ?")
        .bind(now, campaignId, encounterId).run();
    },
  };
}
