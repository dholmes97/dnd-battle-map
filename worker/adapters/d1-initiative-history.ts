import { orderedInitiativeGroups } from "../../shared/initiative-domain.ts";
import { MAX_INITIATIVE_GROUP_TOKENS, MAX_TOKENS_PER_ENCOUNTER } from "../../shared/resource-limits.ts";
import type { HistoryReplayInput } from "../ports/history-repository.ts";

type InitiativeRow = {
  id: string;
  name: string;
  initiative: number | null;
  initiative_group_id: string | null;
  summoner_token_id: string | null;
};

export async function replayInitiativeHistory(
  db: D1Database,
  input: HistoryReplayInput,
): Promise<number> {
  if (input.actionType !== "initiative_set" && input.actionType !== "initiative_group_set") return 0;
  const rows = await db.prepare(
    `SELECT id, name, initiative, initiative_group_id, summoner_token_id
     FROM tokens WHERE encounter_id = ? ORDER BY name, id LIMIT ?`,
  ).bind(input.encounterId, MAX_TOKENS_PER_ENCOUNTER).all<InitiativeRow>();
  const next = rows.results.map((row) => ({ ...row }));
  const undo = input.direction === "undo";
  let changed = 0;
  if (input.actionType === "initiative_set") {
    const tokenId = cleanId(input.payload.tokenId);
    const row = next.find((candidate) => candidate.id === tokenId);
    const expectedInitiative = undo ? input.payload.to : input.payload.from ?? null;
    const expectedGroup = undo ? null : input.payload.fromGroupId ?? null;
    if (!row || row.initiative !== expectedInitiative || row.initiative_group_id !== expectedGroup) return 0;
    row.initiative = (undo ? input.payload.from : input.payload.to) as number | null;
    row.initiative_group_id = (undo ? input.payload.fromGroupId : null) as string | null;
    await db.prepare(
      `UPDATE tokens SET initiative = ?, initiative_group_id = ?, initiative_order = NULL,
       turn_complete = 0, movement_used = 0, movement_origin_x = NULL,
       movement_origin_y = NULL, updated_at = ? WHERE id = ? AND encounter_id = ?`,
    ).bind(row.initiative, row.initiative_group_id, input.now, tokenId, input.encounterId).run();
    changed = 1;
  } else {
    const members = Array.isArray(input.payload.members)
      ? input.payload.members as Array<Record<string, unknown>>
      : [];
    if (!members.length || members.length > MAX_INITIATIVE_GROUP_TOKENS) return 0;
    const groupId = cleanId(input.payload.groupId);
    for (const member of members) {
      const row = next.find((candidate) => candidate.id === cleanId(member.tokenId));
      const expectedInitiative = undo ? input.payload.to : member.from ?? null;
      const expectedGroup = undo ? groupId : member.fromGroupId ?? null;
      if (!row || row.initiative !== expectedInitiative || row.initiative_group_id !== expectedGroup) return 0;
    }
    await db.batch(members.map((member) => {
      const row = next.find((candidate) => candidate.id === cleanId(member.tokenId))!;
      row.initiative = (undo ? member.from : input.payload.to) as number | null;
      row.initiative_group_id = (undo ? member.fromGroupId : groupId) as string | null;
      return db.prepare(
        `UPDATE tokens SET initiative = ?, initiative_group_id = ?, initiative_order = NULL,
         turn_complete = 0, movement_used = 0, movement_origin_x = NULL,
         movement_origin_y = NULL, updated_at = ? WHERE id = ? AND encounter_id = ?`,
      ).bind(row.initiative, row.initiative_group_id, input.now, row.id, input.encounterId);
    }));
    changed = members.length;
  }
  await rebuildOrders(db, input.encounterId, next, input.activeLeaderIds ?? [], input.now);
  return changed;
}

async function rebuildOrders(
  db: D1Database,
  encounterId: string,
  tokens: InitiativeRow[],
  activeLeaderIds: string[],
  now: number,
) {
  if (!activeLeaderIds.length) return;
  const groups = orderedInitiativeGroups(tokens.map((token) => ({
    id: token.id,
    name: token.name,
    initiative: token.initiative,
    initiativeGroupId: token.initiative_group_id,
    summonerTokenId: token.summoner_token_id,
    kind: "monster",
    artAsset: null,
    initiativeOrder: null,
    controlledByViewer: false,
  }))).map((group) => group.map((token) => token.id));
  const activeOrder = Math.max(0, groups.findIndex((group) =>
    group.some((id) => activeLeaderIds.includes(id))
  ));
  await db.batch([
    db.prepare("UPDATE tokens SET initiative_order = NULL, updated_at = ? WHERE encounter_id = ?")
      .bind(now, encounterId),
    ...groups.flatMap((group, order) => group.map((leaderId) => db.prepare(
      `UPDATE tokens SET initiative_order = ?, updated_at = ?
       WHERE encounter_id = ? AND (id = ? OR summoner_token_id = ?)`,
    ).bind(order, now, encounterId, leaderId, leaderId))),
    db.prepare("UPDATE encounters SET active_initiative_order = ?, updated_at = ? WHERE id = ?")
      .bind(groups.length ? activeOrder : null, now, encounterId),
  ]);
}

function cleanId(value: unknown) {
  return typeof value === "string" ? value.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) : "";
}
