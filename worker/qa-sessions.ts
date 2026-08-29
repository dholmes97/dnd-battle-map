import type { AuthenticatedIdentity } from "../shared/auth-domain.ts";
import { API_JSON_BODY_MAX_BYTES, MAX_PARTICIPANTS_PER_ENCOUNTER } from "../shared/resource-limits.ts";
import { readBoundedJsonObject } from "./request-security.ts";
import type { EncounterState } from "../shared/contracts.ts";
import type { Env, ParticipantRow } from "./types.ts";

const QA_CAMPAIGN_ID = "campaign-combat-rolling-qa";
const QA_ENCOUNTER_ID = "encounter-combat-rolling-qa";
const QA_ENCOUNTER_CODE = "COMBAT-ROLLING-QA";
const QA_SESSION_TTL_MS = 2 * 60 * 60 * 1_000;
const QA_MAP_IMAGE_ID = "qa-forest-hollow-v1";
const QA_MAP_SETUP_JSON = JSON.stringify({
  format: "dnd-map-setup",
  version: 1,
  walls: [],
  portals: [],
  labels: [],
  notes: [],
  fog: {
    mode: "off",
    sharedPolygon: [
      { x: 0, y: 0 }, { x: 8, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 6 },
      { x: 16, y: 12 }, { x: 8, y: 12 }, { x: 0, y: 12 }, { x: 0, y: 6 },
    ],
    walls: [],
    doors: [],
    circles: [],
  },
});

const PERSONAS = {
  dm: { identityId: "identity-combat-qa-dm", membershipId: "membership-combat-qa-dm", name: "QA DM", role: "dm" as const },
  player1: { identityId: "identity-combat-qa-player", membershipId: "membership-combat-qa-player", name: "QA Player 1", role: "player" as const },
  player2: { identityId: "identity-combat-qa-player-2", membershipId: "membership-combat-qa-player-2", name: "QA Player 2", role: "player" as const },
};

export async function handleQaSession(
  request: Request,
  env: Env,
  identity: AuthenticatedIdentity,
  loadState: (participant: ParticipantRow) => Promise<EncounterState | null>,
): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405, headers: { allow: "POST" } });
  if (!identity.canUseQaSessions) return json({ error: "QA sessions are not available to this account." }, { status: 403 });
  const body = await readBoundedJsonObject(request, API_JSON_BODY_MAX_BYTES);
  const requestedPersona = body.persona === "player" ? "player1" : body.persona;
  const personaKey = requestedPersona === "dm" || requestedPersona === "player1" || requestedPersona === "player2" ? requestedPersona : null;
  if (!personaKey) return json({ error: "Choose the fixed QA DM, Player 1, or Player 2 persona." }, { status: 400 });
  const persona = PERSONAS[personaKey];
  const fixture = await env.DB.prepare(
    "SELECT 1 AS found FROM encounters WHERE id = ? AND campaign_id = ? AND code = ?",
  ).bind(QA_ENCOUNTER_ID, QA_CAMPAIGN_ID, QA_ENCOUNTER_CODE).first();
  if (!fixture) return json({ error: "The interaction QA fixture is unavailable." }, { status: 503 });
  const now = Date.now();
  const existingParticipant = await env.DB.prepare(
    `SELECT id FROM participants
     WHERE encounter_id = ? AND authenticated_actor_identity_id = ? AND qa_persona = ?
     ORDER BY last_seen_at DESC, id DESC LIMIT 1`,
  ).bind(QA_ENCOUNTER_ID, identity.id, personaKey).first<{ id: string }>();
  const participantId = existingParticipant?.id ?? crypto.randomUUID();
  const sessionSecret = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM participants
       WHERE encounter_id = ? AND qa_persona IS NOT NULL AND last_seen_at <= ? AND id <> ?
         AND NOT EXISTS (SELECT 1 FROM combat_rolls WHERE participant_id = participants.id)`,
    ).bind(QA_ENCOUNTER_ID, now - QA_SESSION_TTL_MS, participantId),
    env.DB.prepare(
      `DELETE FROM participants WHERE encounter_id = ? AND id NOT IN (
         SELECT id FROM participants WHERE encounter_id = ? ORDER BY last_seen_at DESC, id DESC LIMIT ?
       ) AND id <> ?
         AND NOT EXISTS (SELECT 1 FROM combat_rolls WHERE participant_id = participants.id)`,
    ).bind(QA_ENCOUNTER_ID, QA_ENCOUNTER_ID, MAX_PARTICIPANTS_PER_ENCOUNTER - 1, participantId),
    existingParticipant
      ? env.DB.prepare(
          `UPDATE participants SET identity_id = ?, authenticated_actor_identity_id = ?, qa_persona = ?,
           campaign_membership_id = ?, name = ?, role = ?, session_secret = ?, joined_at = ?, last_seen_at = ?
           WHERE id = ? AND encounter_id = ?`,
        ).bind(
          persona.identityId, identity.id, personaKey, persona.membershipId, persona.name, persona.role,
          sessionSecret, now, now, participantId, QA_ENCOUNTER_ID,
        )
      : env.DB.prepare(
          `INSERT INTO participants
           (id, encounter_id, identity_id, authenticated_actor_identity_id, qa_persona,
            campaign_membership_id, name, role, session_secret, joined_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          participantId, QA_ENCOUNTER_ID, persona.identityId, identity.id, personaKey,
          persona.membershipId, persona.name, persona.role, sessionSecret, now, now,
        ),
  ]);
  const participant: ParticipantRow = {
    id: participantId,
    name: persona.name,
    role: persona.role,
    identity_id: persona.identityId,
    authenticated_actor_identity_id: identity.id,
    qa_persona: personaKey,
    campaign_membership_id: persona.membershipId,
  };
  return json({
    participantId,
    participantName: persona.name,
    sessionSecret,
    role: persona.role,
    qa: { persona: personaKey, actor: identity.displayName, expiresAt: now + QA_SESSION_TTL_MS },
    state: await loadState(participant),
  });
}

export async function resetQaFixture(request: Request, env: Env, identity: AuthenticatedIdentity): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405, headers: { allow: "POST" } });
  if (!identity.canUseQaSessions) return json({ error: "QA fixture reset is not available to this account." }, { status: 403 });
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM damage_proposals WHERE encounter_id = ?").bind(QA_ENCOUNTER_ID),
    env.DB.prepare("DELETE FROM combat_rolls WHERE encounter_id = ?").bind(QA_ENCOUNTER_ID),
    env.DB.prepare("DELETE FROM actions WHERE encounter_id = ?").bind(QA_ENCOUNTER_ID),
    env.DB.prepare("DELETE FROM participants WHERE encounter_id = ? AND qa_persona IS NOT NULL").bind(QA_ENCOUNTER_ID),
    env.DB.prepare("DELETE FROM effects WHERE encounter_id = ?").bind(QA_ENCOUNTER_ID),
    env.DB.prepare(
      `INSERT OR IGNORE INTO identities
       (id, display_name, login_email, can_create_campaigns, can_use_qa_sessions, created_at, updated_at)
       VALUES ('identity-combat-qa-player-2', 'QA Player 2', 'qa-player-2@invalid.local', 0, 0, ?, ?)`,
    ).bind(now, now),
    env.DB.prepare(
      `INSERT OR IGNORE INTO campaign_memberships
       (id, campaign_id, identity_id, role, created_at, updated_at)
       VALUES ('membership-combat-qa-player-2', ?, 'identity-combat-qa-player-2', 'player', ?, ?)`,
    ).bind(QA_CAMPAIGN_ID, now, now),
    env.DB.prepare(
      `INSERT OR IGNORE INTO campaign_characters
       (id, campaign_id, controller_membership_id, name, class_name, art_asset, size, speed,
        armor_class, max_hp, sort_order, is_active, created_at, updated_at)
       VALUES ('character-combat-qa-player-2', ?, 'membership-combat-qa-player-2', 'QA Scout', 'Rogue',
        '/assets/tokens/characters/malichar-rogue-01.png', 'medium', 30, 15, 24, 20, 1, ?, ?)`,
    ).bind(QA_CAMPAIGN_ID, now, now),
    env.DB.prepare(
      `INSERT OR IGNORE INTO tokens
       (id, encounter_id, name, x, y, art_asset, kind, size, speed, armor_class, hp, max_hp,
        temporary_hp, is_hidden, campaign_character_id, initiative, initiative_order,
        turn_complete, movement_used, altitude, updated_at)
       VALUES ('token-combat-qa-player-2', ?, 'QA Scout', 5.5, 7.5,
        '/assets/tokens/characters/malichar-rogue-01.png', 'character', 'medium', 30, 15, 24, 24,
        0, 0, 'character-combat-qa-player-2', 14, 2, 0, 0, 0, ?)`,
    ).bind(QA_ENCOUNTER_ID, now),
    env.DB.prepare(
      `INSERT INTO combat_action_profiles
       (id, campaign_character_id, name, attack_bonus, attack_kind, damage_dice_count, damage_die_size,
        damage_modifier, damage_type, reach_feet, range_feet, manual_rider, manual_rider_text, alternate_damage_json,
        source_kind, source_ref, sort_order, is_enabled, created_at, updated_at)
       VALUES ('character-combat-qa-guiding-bolt-v1', 'character-combat-qa-player', 'Guiding Bolt', 8, 'ranged', 4, 6,
        0, 'radiant', NULL, 120, 1, 'The next attack roll made against the target before the end of your next turn has advantage.', NULL, 'manual-character', 'qa-fixture-v1', 20, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, attack_bonus = excluded.attack_bonus,
        attack_kind = excluded.attack_kind, damage_dice_count = excluded.damage_dice_count,
        damage_die_size = excluded.damage_die_size, damage_modifier = excluded.damage_modifier,
        damage_type = excluded.damage_type, reach_feet = excluded.reach_feet, range_feet = excluded.range_feet,
        manual_rider = excluded.manual_rider, manual_rider_text = excluded.manual_rider_text,
        alternate_damage_json = excluded.alternate_damage_json,
        sort_order = excluded.sort_order, is_enabled = excluded.is_enabled, updated_at = excluded.updated_at`,
    ).bind(now, now),
    env.DB.prepare(
      `INSERT INTO combat_action_profiles
       (id, campaign_character_id, name, attack_bonus, attack_kind, damage_dice_count, damage_die_size,
        damage_modifier, damage_type, reach_feet, range_feet, manual_rider, manual_rider_text, alternate_damage_json,
        source_kind, source_ref, sort_order, is_enabled, created_at, updated_at)
       VALUES
        ('character-combat-qa-player-2-rapier-v1', 'character-combat-qa-player-2', 'Rapier', 5, 'melee', 1, 8,
         3, 'piercing', 5, NULL, 0, '', NULL, 'manual-character', 'qa-fixture-v2', 10, 1, ?, ?),
        ('character-combat-qa-player-2-shortbow-v1', 'character-combat-qa-player-2', 'Shortbow', 5, 'ranged', 1, 6,
         3, 'piercing', NULL, 80, 0, '', NULL, 'manual-character', 'qa-fixture-v2', 20, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, attack_bonus = excluded.attack_bonus,
        attack_kind = excluded.attack_kind, damage_dice_count = excluded.damage_dice_count,
        damage_die_size = excluded.damage_die_size, damage_modifier = excluded.damage_modifier,
        damage_type = excluded.damage_type, reach_feet = excluded.reach_feet, range_feet = excluded.range_feet,
        manual_rider = excluded.manual_rider, manual_rider_text = excluded.manual_rider_text,
        alternate_damage_json = excluded.alternate_damage_json, sort_order = excluded.sort_order,
        is_enabled = excluded.is_enabled, updated_at = excluded.updated_at`,
    ).bind(now, now, now, now),
    env.DB.prepare(
      `INSERT INTO effects
       (id, encounter_id, token_id, name, effect_type, duration_rounds, expires_round, reminder_timing, created_by, created_at)
       VALUES ('effect-combat-qa-bless', ?, 'token-combat-qa-player', 'Bless', 'concentration', 10, 11, 'end', 'qa-fixture', ?)`,
    ).bind(QA_ENCOUNTER_ID, now),
    env.DB.prepare(
      `UPDATE tokens SET hp = CASE id
         WHEN 'token-combat-qa-player' THEN 30 WHEN 'token-combat-qa-goblin' THEN 7
         WHEN 'token-combat-qa-player-2' THEN 24 WHEN 'token-combat-qa-skeleton' THEN 13
         WHEN 'token-combat-qa-unconfigured' THEN 7 ELSE hp END,
       x = CASE id
         WHEN 'token-combat-qa-player' THEN 4 WHEN 'token-combat-qa-goblin' THEN 9
         WHEN 'token-combat-qa-player-2' THEN 5.5 WHEN 'token-combat-qa-skeleton' THEN 10
         WHEN 'token-combat-qa-unconfigured' THEN 9 ELSE x END,
       y = CASE id
         WHEN 'token-combat-qa-player' THEN 5.5 WHEN 'token-combat-qa-goblin' THEN 3.5
         WHEN 'token-combat-qa-player-2' THEN 7.5 WHEN 'token-combat-qa-skeleton' THEN 5.5
         WHEN 'token-combat-qa-unconfigured' THEN 7.5 ELSE y END,
       temporary_hp = CASE id WHEN 'token-combat-qa-player' THEN 5 ELSE 0 END,
       turn_complete = 0, movement_used = 0, movement_origin_x = NULL, movement_origin_y = NULL,
       altitude = 0,
       updated_at = ? WHERE encounter_id = ?`,
    ).bind(now, QA_ENCOUNTER_ID),
    env.DB.prepare(
      `UPDATE encounters SET status = 'active', current_round = 1, active_initiative_order = 0,
       active_map_image_id = ?, active_map_setup_json = ?, draft_map_image_id = ?, draft_map_setup_json = ?,
       draft_updated_at = ?, grid_width = 16, grid_height = 12, map_asset = '', map_package_json = NULL,
       version = version + 1, updated_at = ? WHERE id = ?`,
    ).bind(QA_MAP_IMAGE_ID, QA_MAP_SETUP_JSON, QA_MAP_IMAGE_ID, QA_MAP_SETUP_JSON, now, now, QA_ENCOUNTER_ID),
  ]);
  return json({ reset: true });
}

function json(value: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(value), { ...init, headers });
}
