import { scenarioCodeFromName } from "../shared/encounter-domain.ts";
import {
  API_JSON_BODY_MAX_BYTES,
  MAX_CAMPAIGN_CHARACTERS_PER_CAMPAIGN,
  MAX_CAMPAIGN_MEMBERS_PER_CAMPAIGN,
  MAX_CAMPAIGNS,
  MAX_SCENARIOS,
} from "../shared/resource-limits.ts";
import type { AuthenticatedIdentity } from "../shared/auth-domain.ts";
import { readBoundedJsonObject } from "./request-security.ts";
import type { Env } from "./types.ts";
import { validateCombatActionValues, type CombatActionProfile } from "../shared/combat-rolling.ts";
import { MAX_COMBAT_ACTIONS_PER_OWNER } from "../shared/resource-limits.ts";
import { createD1CombatRollRepository } from "./adapters/d1-combat-roll-repository.ts";
import type { CombatActionProfileRow } from "./ports/combat-roll-repository.ts";

type MembershipRow = {
  id: string;
  slug: string;
  name: string;
  membership_id: string;
  role: "dm" | "player";
};

type CharacterRow = {
  id: string;
  campaign_id: string;
  name: string;
  class_name: string;
  art_asset: string | null;
  size: string;
  speed: number;
  armor_class: number;
  max_hp: number;
  controller_identity_id: string;
};

type MemberRow = {
  campaign_id: string;
  membership_id: string;
  identity_id: string;
  display_name: string;
  role: "dm" | "player";
};

type EncounterSummaryRow = {
  campaign_id: string;
  code: string;
  name: string;
  status: "setup" | "active" | "paused";
  updated_at: number;
};

type NewPlayerInput = {
  identityId: string;
  character: NewCharacterInput | null;
};

type NewCharacterInput = {
  name: string;
  className: string;
  maxHp: number;
  armorClass: number;
  speed: number;
};

export async function handleCampaignCollection(
  request: Request,
  env: Env,
  identity: AuthenticatedIdentity,
): Promise<Response> {
  if (request.method === "GET") return campaignListResponse(env, identity);
  if (request.method === "POST") return createCampaign(request, env, identity);
  return methodNotAllowed("GET, POST");
}

export async function handleCampaignResource(
  request: Request,
  env: Env,
  identity: AuthenticatedIdentity,
  campaignId: string,
  child: "members" | "encounters" | "actions" | null,
): Promise<Response> {
  if (!cleanIdentifier(campaignId)) return json({ error: "Campaign not found." }, { status: 404 });
  if (child === "members") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    return addCampaignPlayer(request, env, identity, campaignId);
  }
  if (child === "encounters") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    return createFreshEncounter(request, env, identity, campaignId);
  }
  if (child === "actions") return maintainCharacterAction(request, env, identity, campaignId);
  if (request.method === "PATCH") return renameCampaign(request, env, identity, campaignId);
  return methodNotAllowed("PATCH");
}

export async function campaignListResponse(env: Env, identity: AuthenticatedIdentity): Promise<Response> {
  const payload = await campaignAccess(env, identity);
  return json(payload);
}

async function campaignAccess(env: Env, identity: AuthenticatedIdentity) {
  const memberships = await env.DB.prepare(
    `SELECT c.id, c.slug, c.name, cm.id AS membership_id, cm.role
     FROM campaign_memberships cm
     JOIN campaigns c ON c.id = cm.campaign_id
     WHERE cm.identity_id = ?
     ORDER BY c.name, c.id LIMIT ?`,
  ).bind(identity.id, MAX_CAMPAIGNS).all<MembershipRow>();
  const characters = await env.DB.prepare(
    `SELECT cc.id, cc.campaign_id, cc.name, cc.class_name, cc.art_asset,
            cc.size, cc.speed, cc.armor_class, cc.max_hp,
            controller.identity_id AS controller_identity_id
     FROM campaign_characters cc
     JOIN campaign_memberships controller ON controller.id = cc.controller_membership_id
     JOIN campaign_memberships access ON access.campaign_id = cc.campaign_id
     WHERE access.identity_id = ? AND cc.is_active = 1
     ORDER BY cc.campaign_id, cc.sort_order, cc.name, cc.id LIMIT ?`,
  ).bind(identity.id, MAX_CAMPAIGNS * MAX_CAMPAIGN_CHARACTERS_PER_CAMPAIGN).all<CharacterRow>();
  const members = await env.DB.prepare(
    `SELECT cm.campaign_id, cm.id AS membership_id, cm.identity_id, i.display_name, cm.role
     FROM campaign_memberships cm
     JOIN identities i ON i.id = cm.identity_id
     JOIN campaign_memberships access ON access.campaign_id = cm.campaign_id
     WHERE access.identity_id = ?
     ORDER BY cm.campaign_id, CASE cm.role WHEN 'dm' THEN 0 ELSE 1 END, i.display_name
     LIMIT ?`,
  ).bind(identity.id, MAX_CAMPAIGNS * MAX_CAMPAIGN_MEMBERS_PER_CAMPAIGN).all<MemberRow>();
  const encounters = await env.DB.prepare(
    `SELECT e.campaign_id, e.code, e.name, e.status, e.updated_at
     FROM encounters e
     JOIN campaign_memberships cm ON cm.campaign_id = e.campaign_id
     WHERE cm.identity_id = ?
     ORDER BY e.updated_at DESC, e.name, e.code LIMIT ?`,
  ).bind(identity.id, MAX_SCENARIOS).all<EncounterSummaryRow>();
  const invited = await env.DB.prepare(
    `SELECT id, display_name FROM identities
     WHERE login_email <> '' AND id NOT LIKE 'identity-combat-qa-%'
     ORDER BY display_name, id LIMIT ?`,
  ).bind(MAX_CAMPAIGN_MEMBERS_PER_CAMPAIGN).all<{ id: string; display_name: string }>();
  const actionRows = await env.DB.prepare(
    `SELECT cap.id, cap.campaign_character_id, cap.creature_catalog_id, cap.name, cap.resolution_mode, cap.attack_bonus,
            cap.attack_kind, cap.damage_dice_count, cap.damage_die_size, cap.damage_modifier,
            cap.damage_type, cap.reach_feet, cap.range_feet, cap.manual_rider, cap.manual_rider_text,
            cap.alternate_damage_json, cap.source_kind, cap.source_ref, cap.sort_order,
            cap.is_enabled, cap.created_at, cap.updated_at
     FROM combat_action_profiles cap
     JOIN campaign_characters cc ON cc.id = cap.campaign_character_id
     JOIN campaign_memberships access ON access.campaign_id = cc.campaign_id
     WHERE access.identity_id = ? AND cap.is_enabled = 1
     ORDER BY cap.sort_order, cap.name, cap.id LIMIT ?`,
  ).bind(identity.id, MAX_CAMPAIGNS * MAX_CAMPAIGN_CHARACTERS_PER_CAMPAIGN * MAX_COMBAT_ACTIONS_PER_OWNER)
    .all<CombatActionProfileRow>();

  return {
    identity,
    invitedIdentities: invited.results.map((entry) => ({ id: entry.id, displayName: entry.display_name })),
    items: memberships.results.map((membership) => {
      const campaignCharacters = characters.results.filter((character) => character.campaign_id === membership.id);
      const campaignMembers = members.results.filter((member) => member.campaign_id === membership.id);
      return {
        id: membership.id,
        slug: membership.slug,
        name: membership.name,
        membershipId: membership.membership_id,
        role: membership.role,
        characters: campaignCharacters.filter((character) =>
          membership.role === "dm" || character.controller_identity_id === identity.id,
        ).map((character) => characterSummary(character, actionRows.results)),
        members: campaignMembers.map((member) => ({
          membershipId: member.membership_id,
          identity: { id: member.identity_id, displayName: member.display_name },
          role: member.role,
          characters: campaignCharacters.filter((character) => character.controller_identity_id === member.identity_id)
            .map((character) => characterSummary(character, actionRows.results)),
        })),
        encounters: encounters.results.filter((encounter) => encounter.campaign_id === membership.id).map((encounter) => ({
          code: encounter.code,
          name: encounter.name,
          status: encounter.status,
          updatedAt: encounter.updated_at,
        })),
      };
    }),
  };
}

async function maintainCharacterAction(
  request: Request,
  env: Env,
  identity: AuthenticatedIdentity,
  campaignId: string,
): Promise<Response> {
  if (request.method !== "POST" && request.method !== "DELETE") return methodNotAllowed("POST, DELETE");
  const body = await readBoundedJsonObject(request, API_JSON_BODY_MAX_BYTES);
  const repository = createD1CombatRollRepository(env.DB);
  if (request.method === "DELETE") {
    const actionId = cleanIdentifier(body.actionId);
    const action = await repository.findAction(actionId);
    if (!action?.campaign_character_id || !await mayMaintainCharacter(env, identity.id, campaignId, action.campaign_character_id)) {
      return json({ error: "Combat action not found." }, { status: 404 });
    }
    await repository.deleteAction(actionId);
    return json(await campaignAccess(env, identity));
  }
  const characterId = cleanIdentifier(body.characterId);
  const values = validateCombatActionValues(body.values);
  if (!characterId || !values || !await mayMaintainCharacter(env, identity.id, campaignId, characterId)) {
    return json({ error: "Character combat action is invalid or unavailable." }, { status: 403 });
  }
  const actionId = cleanIdentifier(body.actionId) || crypto.randomUUID();
  const existing = cleanIdentifier(body.actionId) ? await repository.findAction(actionId) : null;
  if (existing && existing.campaign_character_id !== characterId) {
    return json({ error: "Combat action belongs to another character." }, { status: 409 });
  }
  if (!existing && await repository.countActions("character", characterId) >= MAX_COMBAT_ACTIONS_PER_OWNER) {
    return json({ error: "This character has reached the combat action limit." }, { status: 409 });
  }
  await repository.saveAction({
    id: actionId,
    ownerType: "character",
    ownerId: characterId,
    values,
    sourceKind: "manual-character",
    sourceRef: null,
    now: Date.now(),
  });
  return json(await campaignAccess(env, identity));
}

async function mayMaintainCharacter(env: Env, identityId: string, campaignId: string, characterId: string) {
  const row = await env.DB.prepare(
    `SELECT access.role, controller.identity_id AS controller_identity_id
     FROM campaign_characters cc
     JOIN campaign_memberships controller ON controller.id = cc.controller_membership_id
     JOIN campaign_memberships access ON access.campaign_id = cc.campaign_id AND access.identity_id = ?
     WHERE cc.id = ? AND cc.campaign_id = ? LIMIT 1`,
  ).bind(identityId, characterId, campaignId).first<{ role: "dm" | "player"; controller_identity_id: string }>();
  return Boolean(row && (row.role === "dm" || row.controller_identity_id === identityId));
}

async function createCampaign(request: Request, env: Env, identity: AuthenticatedIdentity): Promise<Response> {
  if (!identity.canCreateCampaigns) return json({ error: "This account cannot create campaigns." }, { status: 403 });
  const body = await readBoundedJsonObject(request, API_JSON_BODY_MAX_BYTES);
  const name = cleanText(body.name, 64);
  if (name.length < 3) return json({ error: "Campaign name must be at least three characters." }, { status: 400 });
  const players = await parsePlayers(env, identity.id, body.players);
  if ("error" in players) return json({ error: players.error }, { status: 400 });
  const characterNames = players.value.flatMap((player) => player.character ? [player.character.name.toLowerCase()] : []);
  if (new Set(characterNames).size !== characterNames.length) return json({ error: "Character names must be unique within a campaign." }, { status: 409 });
  const count = await env.DB.prepare("SELECT COUNT(*) AS value FROM campaigns").first<{ value: number }>();
  if ((count?.value ?? 0) >= MAX_CAMPAIGNS) return json({ error: "The campaign limit has been reached." }, { status: 409 });
  const now = Date.now();
  const campaignId = crypto.randomUUID();
  const slug = await uniqueCampaignSlug(env, name);
  const dmMembershipId = crypto.randomUUID();
  const playerRows = players.value.map((player, index) => ({ ...player, membershipId: crypto.randomUUID(), sortOrder: (index + 1) * 10 }));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO campaigns (id, slug, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(campaignId, slug, name, now, now),
    env.DB.prepare(
      `INSERT INTO campaign_memberships (id, campaign_id, identity_id, role, created_at, updated_at)
       VALUES (?, ?, ?, 'dm', ?, ?)`,
    ).bind(dmMembershipId, campaignId, identity.id, now, now),
    ...playerRows.map((player) => env.DB.prepare(
      `INSERT INTO campaign_memberships (id, campaign_id, identity_id, role, created_at, updated_at)
       VALUES (?, ?, ?, 'player', ?, ?)`,
    ).bind(player.membershipId, campaignId, player.identityId, now, now)),
    ...playerRows.filter((player) => player.character).map((player) => characterInsert(env, {
      campaignId,
      membershipId: player.membershipId,
      character: player.character!,
      sortOrder: player.sortOrder,
      now,
    })),
  ]);
  return json(await campaignAccess(env, identity), { status: 201 });
}

async function addCampaignPlayer(request: Request, env: Env, identity: AuthenticatedIdentity, campaignId: string): Promise<Response> {
  const membership = await requireCampaignDm(env, identity.id, campaignId);
  if (!membership) return json({ error: "Only this campaign's DM can add players." }, { status: 403 });
  const body = await readBoundedJsonObject(request, API_JSON_BODY_MAX_BYTES);
  const parsed = await parsePlayers(env, identity.id, [{ identityId: body.identityId, character: body.character }]);
  if ("error" in parsed || parsed.value.length !== 1) return json({ error: "Choose an invited player." }, { status: 400 });
  const player = parsed.value[0];
  if (player.character && await env.DB.prepare(
    "SELECT 1 AS found FROM campaign_characters WHERE campaign_id = ? AND lower(name) = lower(?) LIMIT 1",
  ).bind(campaignId, player.character.name).first()) {
    return json({ error: "That character name is already used in this campaign." }, { status: 409 });
  }
  const existing = await env.DB.prepare(
    "SELECT id, role FROM campaign_memberships WHERE campaign_id = ? AND identity_id = ? LIMIT 1",
  ).bind(campaignId, player.identityId).first<{ id: string; role: "dm" | "player" }>();
  if (existing) {
    if (existing.role !== "player" || !player.character) return json({ error: "That person is already in this campaign." }, { status: 409 });
    const characterCount = await env.DB.prepare("SELECT COUNT(*) AS value FROM campaign_characters WHERE campaign_id = ?")
      .bind(campaignId).first<{ value: number }>();
    if ((characterCount?.value ?? 0) >= MAX_CAMPAIGN_CHARACTERS_PER_CAMPAIGN) return json({ error: "This campaign has reached its character limit." }, { status: 409 });
    const now = Date.now();
    await env.DB.batch([
      characterInsert(env, { campaignId, membershipId: existing.id, character: player.character, sortOrder: ((characterCount?.value ?? 0) + 1) * 10, now }),
      env.DB.prepare("UPDATE campaigns SET updated_at = ? WHERE id = ?").bind(now, campaignId),
    ]);
    return json(await campaignAccess(env, identity), { status: 201 });
  }
  const counts = await env.DB.prepare(
    `SELECT COUNT(*) AS value FROM campaign_memberships WHERE campaign_id = ?`,
  ).bind(campaignId).first<{ value: number }>();
  if ((counts?.value ?? 0) >= MAX_CAMPAIGN_MEMBERS_PER_CAMPAIGN) return json({ error: "This campaign has reached its player limit." }, { status: 409 });
  const now = Date.now();
  const playerMembershipId = crypto.randomUUID();
  const characterCount = await env.DB.prepare("SELECT COUNT(*) AS value FROM campaign_characters WHERE campaign_id = ?")
    .bind(campaignId).first<{ value: number }>();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO campaign_memberships (id, campaign_id, identity_id, role, created_at, updated_at)
       VALUES (?, ?, ?, 'player', ?, ?)`,
    ).bind(playerMembershipId, campaignId, player.identityId, now, now),
    ...(player.character ? [characterInsert(env, {
      campaignId,
      membershipId: playerMembershipId,
      character: player.character,
      sortOrder: ((characterCount?.value ?? 0) + 1) * 10,
      now,
    })] : []),
    env.DB.prepare("UPDATE campaigns SET updated_at = ? WHERE id = ?").bind(now, campaignId),
  ]);
  return json(await campaignAccess(env, identity), { status: 201 });
}

async function renameCampaign(request: Request, env: Env, identity: AuthenticatedIdentity, campaignId: string): Promise<Response> {
  if (!await requireCampaignDm(env, identity.id, campaignId)) return json({ error: "Only this campaign's DM can rename it." }, { status: 403 });
  const body = await readBoundedJsonObject(request, API_JSON_BODY_MAX_BYTES);
  const name = cleanText(body.name, 64);
  if (name.length < 3) return json({ error: "Campaign name must be at least three characters." }, { status: 400 });
  await env.DB.prepare("UPDATE campaigns SET name = ?, updated_at = ? WHERE id = ?").bind(name, Date.now(), campaignId).run();
  return json(await campaignAccess(env, identity));
}

async function createFreshEncounter(request: Request, env: Env, identity: AuthenticatedIdentity, campaignId: string): Promise<Response> {
  if (!await requireCampaignDm(env, identity.id, campaignId)) return json({ error: "Only this campaign's DM can create encounters." }, { status: 403 });
  const body = await readBoundedJsonObject(request, API_JSON_BODY_MAX_BYTES);
  const name = cleanText(body.name, 64);
  if (name.length < 3) return json({ error: "Encounter name must be at least three characters." }, { status: 400 });
  const encounterCount = await env.DB.prepare("SELECT COUNT(*) AS value FROM encounters WHERE campaign_id = ?")
    .bind(campaignId).first<{ value: number }>();
  if ((encounterCount?.value ?? 0) >= MAX_SCENARIOS) return json({ error: "This campaign has reached its encounter limit." }, { status: 409 });
  const characters = await env.DB.prepare(
    `SELECT id, name, art_asset, size, speed, armor_class, max_hp
     FROM campaign_characters WHERE campaign_id = ? AND is_active = 1
     ORDER BY sort_order, name, id LIMIT ?`,
  ).bind(campaignId, MAX_CAMPAIGN_CHARACTERS_PER_CAMPAIGN).all<{
    id: string; name: string; art_asset: string | null; size: string; speed: number; armor_class: number; max_hp: number;
  }>();
  if (!characters.results.length) return json({ error: "Add at least one player character before creating an encounter." }, { status: 409 });
  const now = Date.now();
  const encounterId = crypto.randomUUID();
  const code = await uniqueEncounterCode(env, name);
  const gridHeight = Math.max(11, 4 + Math.ceil(characters.results.length / 6) * 2);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO encounters
       (id, campaign_id, code, name, version, status, map_asset, map_package_json, active_map_preset_id,
        active_map_image_id, active_map_setup_json, draft_map_image_id, draft_map_setup_json, draft_updated_at,
        grid_width, grid_height, current_round, active_initiative_order, strict_movement, updated_at)
       VALUES (?, ?, ?, ?, 1, 'setup', '', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 16, ?, 0, NULL, 1, ?)`,
    ).bind(encounterId, campaignId, code, name, gridHeight, now),
    ...characters.results.map((character, index) => env.DB.prepare(
      `INSERT INTO tokens
       (id, encounter_id, name, x, y, art_asset, kind, size, speed, armor_class, hp, max_hp,
        is_hidden, campaign_character_id, turn_complete, movement_used, altitude, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'character', ?, ?, ?, ?, ?, 0, ?, 0, 0, 0, ?)`,
    ).bind(
      crypto.randomUUID(), encounterId, character.name,
      2 + (index % 6) * 2, 2 + Math.floor(index / 6) * 2,
      character.art_asset, character.size, character.speed, character.armor_class,
      character.max_hp, character.max_hp, character.id, now,
    )),
  ]);
  return json({ scenario: { code, name, status: "setup", updatedAt: now } }, { status: 201 });
}

async function parsePlayers(
  env: Env,
  creatorIdentityId: string,
  value: unknown,
): Promise<{ value: NewPlayerInput[] } | { error: string }> {
  if (value === undefined || value === null) return { value: [] };
  if (!Array.isArray(value) || value.length > MAX_CAMPAIGN_MEMBERS_PER_CAMPAIGN - 1) return { error: "The player list is invalid." };
  const results: NewPlayerInput[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "The player list is invalid." };
    const entry = raw as Record<string, unknown>;
    const identityId = cleanIdentifier(entry.identityId);
    if (!identityId || identityId === creatorIdentityId || seen.has(identityId)) return { error: "Each invited player may be added once." };
    const invited = await env.DB.prepare(
      "SELECT 1 AS found FROM identities WHERE id = ? AND login_email <> '' AND id NOT LIKE 'identity-combat-qa-%' LIMIT 1",
    )
      .bind(identityId).first();
    if (!invited) return { error: "Only an invited person can be added." };
    const character = parseCharacter(entry.character);
    if ("error" in character) return character;
    seen.add(identityId);
    results.push({ identityId, character: character.value });
  }
  return { value: results };
}

function parseCharacter(value: unknown): { value: NewCharacterInput | null } | { error: string } {
  if (value === undefined || value === null) return { value: null };
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "Character details are invalid." };
  const input = value as Record<string, unknown>;
  const name = cleanText(input.name, 64);
  if (!name) return { value: null };
  const className = cleanText(input.className, 64);
  const maxHp = boundedInteger(input.maxHp, 1, 999, 10);
  const armorClass = boundedInteger(input.armorClass, 1, 40, 10);
  const speed = boundedInteger(input.speed, 0, 240, 30);
  if (maxHp === null || armorClass === null || speed === null) return { error: "Character combat values are invalid." };
  return { value: { name, className, maxHp, armorClass, speed } };
}

function characterInsert(env: Env, input: {
  campaignId: string;
  membershipId: string;
  character: NewCharacterInput;
  sortOrder: number;
  now: number;
}): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO campaign_characters
     (id, campaign_id, controller_membership_id, name, class_name, art_asset,
      size, speed, armor_class, max_hp, sort_order, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, 'medium', ?, ?, ?, ?, 1, ?, ?)`,
  ).bind(
    crypto.randomUUID(), input.campaignId, input.membershipId, input.character.name,
    input.character.className, input.character.speed, input.character.armorClass,
    input.character.maxHp, input.sortOrder, input.now, input.now,
  );
}

async function requireCampaignDm(env: Env, identityId: string, campaignId: string): Promise<{ membershipId: string } | null> {
  const row = await env.DB.prepare(
    `SELECT id FROM campaign_memberships WHERE campaign_id = ? AND identity_id = ? AND role = 'dm' LIMIT 1`,
  ).bind(campaignId, identityId).first<{ id: string }>();
  return row ? { membershipId: row.id } : null;
}

async function uniqueCampaignSlug(env: Env, name: string): Promise<string> {
  const base = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "campaign";
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate = suffix ? `${base.slice(0, 44)}-${suffix + 1}` : base;
    if (!await env.DB.prepare("SELECT 1 AS found FROM campaigns WHERE slug = ? LIMIT 1").bind(candidate).first()) return candidate;
  }
  return `${base.slice(0, 35)}-${crypto.randomUUID().slice(0, 8)}`;
}

async function uniqueEncounterCode(env: Env, name: string): Promise<string> {
  const base = scenarioCodeFromName(name);
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate = suffix ? `${base.slice(0, 16)}-${suffix + 1}` : base;
    if (!await env.DB.prepare("SELECT 1 AS found FROM encounters WHERE code = ? LIMIT 1").bind(candidate).first()) return candidate;
  }
  return `${base.slice(0, 11)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function characterSummary(character: CharacterRow, actionRows: CombatActionProfileRow[] = []) {
  return {
    id: character.id,
    name: character.name,
    className: character.class_name,
    artAsset: character.art_asset,
    size: character.size,
    speed: character.speed,
    armorClass: character.armor_class,
    maxHp: character.max_hp,
    combatActions: actionRows.filter((action) => action.campaign_character_id === character.id)
      .flatMap((action) => { const profile = campaignActionSummary(action); return profile ? [profile] : []; }),
  };
}

function campaignActionSummary(row: CombatActionProfileRow): CombatActionProfile | null {
  let alternateDamage: unknown = null;
  try { alternateDamage = row.alternate_damage_json ? JSON.parse(row.alternate_damage_json) : null; } catch { return null; }
  const values = validateCombatActionValues({
    name: row.name,
    resolutionMode: row.resolution_mode,
    attackBonus: row.attack_bonus,
    attackKind: row.attack_kind,
    damage: { count: row.damage_dice_count, sides: row.damage_die_size, modifier: row.damage_modifier },
    damageType: row.damage_type,
    reachFeet: row.reach_feet,
    rangeFeet: row.range_feet,
    manualRider: Boolean(row.manual_rider),
    manualRiderText: row.manual_rider_text,
    alternateDamage,
  });
  return values ? {
    ...values, id: row.id, ownerType: "character", ownerId: row.campaign_character_id!,
    applicableTokenIds: [], source: "character", enabled: Boolean(row.is_enabled), sortOrder: row.sort_order,
  } : null;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number): number | null {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : null;
}

function cleanIdentifier(value: unknown): string {
  return typeof value === "string" ? value.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) : "";
}

function cleanText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maximum) : "";
}

function methodNotAllowed(allow: string): Response {
  return json({ error: "Method not allowed." }, { status: 405, headers: { allow } });
}

function json(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(value), { ...init, headers });
}
