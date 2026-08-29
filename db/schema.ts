import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const appMaintenance = sqliteTable("app_maintenance", {
  id: text("id").primaryKey(),
  completedAt: integer("completed_at").notNull(),
});

export const requestRateLimits = sqliteTable(
  "request_rate_limits",
  {
    key: text("key").primaryKey(),
    requestCount: integer("request_count").notNull(),
    windowEndsAt: integer("window_ends_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("idx_request_rate_limits_expiry").on(table.windowEndsAt)],
);

export const operationLeases = sqliteTable(
  "operation_leases",
  {
    key: text("key").primaryKey(),
    leaseToken: text("lease_token").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [index("idx_operation_leases_expiry").on(table.expiresAt)],
);

export const mutationAssertions = sqliteTable(
  "mutation_assertions",
  {
    operationId: text("operation_id").primaryKey(),
    valid: integer("valid").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [check("mutation_assertions_valid", sql`${table.valid} = 1`)],
);

export const storageWriteIntents = sqliteTable(
  "storage_write_intents",
  {
    id: text("id").primaryKey(),
    operationId: text("operation_id").notNull(),
    objectKey: text("object_key").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_storage_write_intents_operation_key").on(table.operationId, table.objectKey),
    index("idx_storage_write_intents_created").on(table.createdAt),
    index("idx_storage_write_intents_object_key").on(table.objectKey),
  ],
);

export const storageCleanupOutbox = sqliteTable(
  "storage_cleanup_outbox",
  {
    objectKey: text("object_key").primaryKey(),
    reason: text("reason").notNull(),
    attempts: integer("attempts").notNull().default(0),
    availableAt: integer("available_at").notNull(),
    createdAt: integer("created_at").notNull(),
    completedAt: integer("completed_at"),
    lastError: text("last_error"),
  },
  (table) => [index("idx_storage_cleanup_outbox_pending").on(table.completedAt, table.availableAt)],
);

export const mapImages = sqliteTable(
  "map_images",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    biome: text("biome").notNull(),
    mood: text("mood").notNull(),
    assetPath: text("asset_path").notNull(),
    gridWidth: integer("grid_width").notNull(),
    gridHeight: integer("grid_height").notNull(),
    pixelWidth: integer("pixel_width").notNull(),
    pixelHeight: integer("pixel_height").notNull(),
    sourceKind: text("source_kind").notNull(),
    sourcePrompt: text("source_prompt"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_map_images_asset_path").on(table.assetPath),
    index("idx_map_images_active_name").on(table.isActive, table.name, table.id),
    index("idx_map_images_biome_mood").on(table.biome, table.mood),
  ],
);

export const identities = sqliteTable("identities", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  loginEmail: text("login_email").notNull().default(""),
  canCreateCampaigns: integer("can_create_campaigns", { mode: "boolean" }).notNull().default(false),
  canUseQaSessions: integer("can_use_qa_sessions", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_identities_display_name").on(table.displayName),
  uniqueIndex("idx_identities_login_email").on(table.loginEmail),
]);

export const authAccounts = sqliteTable(
  "auth_accounts",
  {
    id: text("id").primaryKey(),
    identityId: text("identity_id").notNull().references(() => identities.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerSubject: text("provider_subject").notNull(),
    verifiedEmail: text("verified_email").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_auth_accounts_provider_subject").on(table.provider, table.providerSubject),
    uniqueIndex("idx_auth_accounts_identity_provider").on(table.identityId, table.provider),
    index("idx_auth_accounts_verified_email").on(table.verifiedEmail),
  ],
);

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    identityId: text("identity_id").notNull().references(() => identities.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    revokedAt: integer("revoked_at"),
  },
  (table) => [
    index("idx_auth_sessions_identity_expiry").on(table.identityId, table.expiresAt),
    index("idx_auth_sessions_expiry").on(table.expiresAt),
  ],
);

export const authOauthStates = sqliteTable(
  "auth_oauth_states",
  {
    stateHash: text("state_hash").primaryKey(),
    pkceVerifier: text("pkce_verifier").notNull(),
    nonce: text("nonce").notNull(),
    returnTo: text("return_to").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [index("idx_auth_oauth_states_expiry").on(table.expiresAt)],
);

export const campaigns = sqliteTable("campaigns", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  isQa: integer("is_qa", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("idx_campaigns_slug").on(table.slug)]);

export const campaignMemberships = sqliteTable(
  "campaign_memberships",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    identityId: text("identity_id").notNull().references(() => identities.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_campaign_memberships_campaign_identity").on(table.campaignId, table.identityId),
    index("idx_campaign_memberships_identity_campaign").on(table.identityId, table.campaignId),
  ],
);

export const campaignCharacters = sqliteTable(
  "campaign_characters",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    controllerMembershipId: text("controller_membership_id").notNull().references(() => campaignMemberships.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    className: text("class_name").notNull().default(""),
    artAsset: text("art_asset"),
    size: text("size").notNull().default("medium"),
    speed: integer("speed").notNull().default(30),
    armorClass: integer("armor_class").notNull().default(10),
    maxHp: integer("max_hp").notNull().default(10),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_campaign_characters_campaign_name").on(table.campaignId, table.name),
    index("idx_campaign_characters_controller").on(table.controllerMembershipId, table.sortOrder),
  ],
);

export const encounters = sqliteTable("encounters", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").references(() => campaigns.id),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  dmBriefing: text("dm_briefing").notNull().default(""),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("setup"),
  legacyMapAsset: text("map_asset")
    .notNull()
    .default(""),
  legacyMapPackageJson: text("map_package_json"),
  legacyActiveMapPresetId: text("active_map_preset_id"),
  activeMapImageId: text("active_map_image_id")
    .references(() => mapImages.id),
  activeMapSetupJson: text("active_map_setup_json"),
  draftMapImageId: text("draft_map_image_id")
    .references(() => mapImages.id),
  draftMapSetupJson: text("draft_map_setup_json"),
  draftUpdatedAt: integer("draft_updated_at"),
  gridWidth: integer("grid_width").notNull().default(16),
  gridHeight: integer("grid_height").notNull().default(11),
  currentRound: integer("current_round").notNull().default(0),
  activeInitiativeOrder: integer("active_initiative_order"),
  strictMovement: integer("strict_movement", { mode: "boolean" }).notNull().default(true),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("idx_encounters_campaign_updated").on(table.campaignId, table.updatedAt)]);

export const scenarioProvisioningJobs = sqliteTable(
  "scenario_provisioning_jobs",
  {
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    revision: integer("revision").notNull(),
    operation: text("operation").notNull(),
    status: text("status").notNull(),
    manifestJson: text("manifest_json").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    scenarioId: text("scenario_id").references(() => encounters.id, { onDelete: "set null" }),
    scenarioCode: text("scenario_code"),
    baseScenarioVersion: integer("base_scenario_version"),
    summary: text("summary").notNull().default(""),
    errorCode: text("error_code"),
    resultJson: text("result_json"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_scenario_provisioning_jobs_idempotency").on(table.idempotencyKey),
    index("idx_scenario_provisioning_jobs_created").on(table.createdAt),
    index("idx_scenario_provisioning_jobs_status_updated").on(table.status, table.updatedAt),
    index("idx_scenario_provisioning_jobs_scenario").on(table.scenarioId, table.updatedAt),
  ],
);

export const scenarioProvisioningAssets = sqliteTable(
  "scenario_provisioning_assets",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => scenarioProvisioningJobs.id, { onDelete: "cascade" }),
    assetId: text("asset_id").notNull(),
    kind: text("kind").notNull(),
    r2Key: text("r2_key").notNull(),
    contentType: text("content_type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    byteLength: integer("byte_length").notNull(),
    sha256: text("sha256").notNull(),
    committedAt: integer("committed_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_scenario_provisioning_assets_job_asset").on(table.jobId, table.assetId),
    uniqueIndex("idx_scenario_provisioning_assets_r2_key").on(table.r2Key),
    index("idx_scenario_provisioning_assets_uncommitted").on(table.committedAt, table.createdAt),
  ],
);

export const scenarioProvisioningMailReplies = sqliteTable(
  "scenario_provisioning_mail_replies",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => scenarioProvisioningJobs.id, { onDelete: "cascade" }),
    mailboxKey: text("mailbox_key").notNull(),
    threadId: text("thread_id").notNull(),
    replyKind: text("reply_kind").notNull(),
    responseMarker: text("response_marker").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_scenario_provisioning_mail_replies_job_kind").on(table.jobId, table.replyKind),
    uniqueIndex("idx_scenario_provisioning_mail_replies_marker").on(table.responseMarker),
    index("idx_scenario_provisioning_mail_replies_thread").on(table.mailboxKey, table.threadId, table.createdAt),
  ],
);

export const scenarioProvisioningMailMessages = sqliteTable(
  "scenario_provisioning_mail_messages",
  {
    id: text("id").primaryKey(),
    replyId: text("reply_id")
      .notNull()
      .references(() => scenarioProvisioningMailReplies.id, { onDelete: "cascade" }),
    mailboxKey: text("mailbox_key").notNull(),
    threadId: text("thread_id").notNull(),
    providerMessageId: text("provider_message_id").notNull(),
    recordedAt: integer("recorded_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_scenario_provisioning_mail_messages_mailbox_message").on(table.mailboxKey, table.providerMessageId),
    index("idx_scenario_provisioning_mail_messages_reply").on(table.replyId, table.recordedAt),
  ],
);

// Rollout recovery only. Current map commands use the encounter active/draft fields above.
export const legacyMapPresets = sqliteTable(
  "map_presets",
  {
    id: text("id").primaryKey(),
    encounterId: text("encounter_id")
      .notNull()
      .references(() => encounters.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    sourcePrompt: text("source_prompt"),
    packageJson: text("package_json").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_map_presets_encounter_updated").on(
      table.encounterId,
      table.updatedAt,
    ),
  ],
);

export const creatureCatalog = sqliteTable(
  "creature_catalog",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    family: text("family").notNull(),
    creatureType: text("creature_type").notNull(),
    size: text("size").notNull(),
    defaultHp: integer("default_hp").notNull(),
    hitDice: text("hit_dice"),
    armorClass: integer("armor_class").notNull(),
    challengeRating: text("challenge_rating"),
    defaultSpeed: integer("default_speed").notNull(),
    walkSpeed: integer("walk_speed").notNull(),
    flySpeed: integer("fly_speed"),
    swimSpeed: integer("swim_speed"),
    climbSpeed: integer("climb_speed"),
    burrowSpeed: integer("burrow_speed"),
    sourceAsset: text("source_asset").notNull(),
    tokenAsset: text("token_asset").notNull().unique(),
    thumbnailAsset: text("thumbnail_asset").notNull(),
    sortOrder: integer("sort_order").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_creature_catalog_active_sort_id").on(table.isActive, table.sortOrder, table.id),
    index("idx_creature_catalog_family_sort_id").on(table.family, table.sortOrder, table.id),
  ],
);

export const combatActionProfiles = sqliteTable(
  "combat_action_profiles",
  {
    id: text("id").primaryKey(),
    campaignCharacterId: text("campaign_character_id").references(() => campaignCharacters.id, { onDelete: "cascade" }),
    creatureCatalogId: text("creature_catalog_id").references(() => creatureCatalog.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    resolutionMode: text("resolution_mode").notNull().default("attack-vs-ac"),
    attackBonus: integer("attack_bonus").notNull(),
    attackKind: text("attack_kind").notNull(),
    damageDiceCount: integer("damage_dice_count").notNull(),
    damageDieSize: integer("damage_die_size").notNull(),
    damageModifier: integer("damage_modifier").notNull(),
    damageType: text("damage_type").notNull(),
    reachFeet: integer("reach_feet"),
    rangeFeet: integer("range_feet"),
    manualRider: integer("manual_rider", { mode: "boolean" }).notNull().default(false),
    manualRiderText: text("manual_rider_text"),
    alternateDamageJson: text("alternate_damage_json"),
    sourceKind: text("source_kind").notNull(),
    sourceRef: text("source_ref"),
    sortOrder: integer("sort_order").notNull().default(0),
    isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check("combat_action_profiles_one_owner", sql`(
      (${table.campaignCharacterId} IS NOT NULL AND ${table.creatureCatalogId} IS NULL) OR
      (${table.campaignCharacterId} IS NULL AND ${table.creatureCatalogId} IS NOT NULL)
    )`),
    index("idx_combat_actions_character_sort").on(table.campaignCharacterId, table.sortOrder, table.id),
    index("idx_combat_actions_creature_sort").on(table.creatureCatalogId, table.sortOrder, table.id),
  ],
);

export const participants = sqliteTable(
  "participants",
  {
    id: text("id").primaryKey(),
    encounterId: text("encounter_id")
      .notNull()
      .references(() => encounters.id, { onDelete: "cascade" }),
    identityId: text("identity_id").references(() => identities.id),
    authenticatedActorIdentityId: text("authenticated_actor_identity_id").references(() => identities.id),
    qaPersona: text("qa_persona"),
    campaignMembershipId: text("campaign_membership_id").references(() => campaignMemberships.id),
    name: text("name").notNull(),
    role: text("role").notNull().default("player"),
    sessionSecret: text("session_secret").notNull().unique(),
    joinedAt: integer("joined_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (table) => [
    index("idx_participants_encounter_id").on(table.encounterId),
    index("idx_participants_identity_encounter").on(table.identityId, table.encounterId),
    index("idx_participants_membership_encounter").on(table.campaignMembershipId, table.encounterId),
  ],
);

export const tokens = sqliteTable(
  "tokens",
  {
    id: text("id").primaryKey(),
    encounterId: text("encounter_id")
      .notNull()
      .references(() => encounters.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    x: real("x").notNull(),
    y: real("y").notNull(),
    artAsset: text("art_asset"),
    kind: text("kind").notNull().default("character"),
    size: text("size").notNull().default("medium"),
    speed: integer("speed").notNull().default(30),
    flySpeed: integer("fly_speed"),
    swimSpeed: integer("swim_speed"),
    climbSpeed: integer("climb_speed"),
    burrowSpeed: integer("burrow_speed"),
    armorClass: integer("armor_class"),
    hp: integer("hp"),
    maxHp: integer("max_hp"),
    temporaryHp: integer("temporary_hp").notNull().default(0),
    isHidden: integer("is_hidden", { mode: "boolean" }).notNull().default(false),
    summonerTokenId: text("summoner_token_id"),
    campaignCharacterId: text("campaign_character_id").references(() => campaignCharacters.id),
    catalogCreatureId: text("catalog_creature_id").references(() => creatureCatalog.id, { onDelete: "set null" }),
    initiative: integer("initiative"),
    initiativeGroupId: text("initiative_group_id"),
    initiativeOrder: integer("initiative_order"),
    turnComplete: integer("turn_complete", { mode: "boolean" }).notNull().default(false),
    movementUsed: real("movement_used").notNull().default(0),
    altitude: integer("altitude").notNull().default(0),
    movementOriginX: real("movement_origin_x"),
    movementOriginY: real("movement_origin_y"),
    ownerParticipantId: text("owner_participant_id").references(
      () => participants.id,
      { onDelete: "set null" },
    ),
    ownerName: text("owner_name"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_tokens_encounter_id").on(table.encounterId),
    index("idx_tokens_campaign_character_id").on(table.campaignCharacterId),
    index("idx_tokens_owner_participant_id").on(table.ownerParticipantId),
  ],
);

export const combatRolls = sqliteTable(
  "combat_rolls",
  {
    id: text("id").primaryKey(),
    encounterId: text("encounter_id").notNull().references(() => encounters.id, { onDelete: "cascade" }),
    operationId: text("operation_id").notNull(),
    participantId: text("participant_id").notNull().references(() => participants.id, { onDelete: "restrict" }),
    authenticatedActorIdentityId: text("authenticated_actor_identity_id").references(() => identities.id),
    attackerTokenId: text("attacker_token_id").notNull().references(() => tokens.id, { onDelete: "restrict" }),
    targetTokenId: text("target_token_id").notNull().references(() => tokens.id, { onDelete: "restrict" }),
    actionProfileId: text("action_profile_id").references(() => combatActionProfiles.id, { onDelete: "set null" }),
    actionSource: text("action_source").notNull(),
    actionSnapshotJson: text("action_snapshot_json").notNull(),
    rollMode: text("roll_mode").notNull(),
    attackDiceJson: text("attack_dice_json").notNull(),
    keptD20: integer("kept_d20").notNull(),
    blessDie: integer("bless_die"),
    attackTotal: integer("attack_total").notNull(),
    outcome: text("outcome").notNull(),
    damageDiceJson: text("damage_dice_json").notNull(),
    damageTotal: integer("damage_total").notNull(),
    damageRolledAt: integer("damage_rolled_at"),
    inTurn: integer("in_turn", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_combat_rolls_encounter_operation").on(table.encounterId, table.operationId),
    index("idx_combat_rolls_encounter_created").on(table.encounterId, table.createdAt, table.id),
    index("idx_combat_rolls_participant_created").on(table.participantId, table.createdAt, table.id),
  ],
);

export const damageProposals = sqliteTable(
  "damage_proposals",
  {
    id: text("id").primaryKey(),
    encounterId: text("encounter_id").notNull().references(() => encounters.id, { onDelete: "cascade" }),
    rollId: text("roll_id").notNull().references(() => combatRolls.id, { onDelete: "cascade" }),
    targetTokenId: text("target_token_id").notNull().references(() => tokens.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("pending"),
    rolledDamage: integer("rolled_damage").notNull(),
    finalDamage: integer("final_damage"),
    adjudicationMethod: text("adjudication_method"),
    adjudicatedByParticipantId: text("adjudicated_by_participant_id").references(() => participants.id, { onDelete: "set null" }),
    adjudicationNote: text("adjudication_note"),
    historyActionId: text("history_action_id"),
    createdAt: integer("created_at").notNull(),
    resolvedAt: integer("resolved_at"),
  },
  (table) => [
    uniqueIndex("idx_damage_proposals_roll").on(table.rollId),
    index("idx_damage_proposals_encounter_status_created").on(table.encounterId, table.status, table.createdAt, table.id),
  ],
);

export const effects = sqliteTable(
  "effects",
  {
    id: text("id").primaryKey(),
    encounterId: text("encounter_id")
      .notNull()
      .references(() => encounters.id, { onDelete: "cascade" }),
    tokenId: text("token_id")
      .notNull()
      .references(() => tokens.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    effectType: text("effect_type").notNull().default("condition"),
    durationRounds: integer("duration_rounds"),
    expiresRound: integer("expires_round"),
    reminderTiming: text("reminder_timing").notNull().default("end"),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_effects_encounter_token").on(table.encounterId, table.tokenId),
    index("idx_effects_encounter_token_type").on(
      table.encounterId,
      table.tokenId,
      table.effectType,
    ),
  ],
);

export const annotations = sqliteTable(
  "annotations",
  {
    id: text("id").primaryKey(),
    encounterId: text("encounter_id")
      .notNull()
      .references(() => encounters.id, { onDelete: "cascade" }),
    annotationType: text("annotation_type").notNull(),
    x: real("x").notNull(),
    y: real("y").notNull(),
    x2: real("x2"),
    y2: real("y2"),
    color: text("color").notNull().default("#f5c65c"),
    label: text("label"),
    createdBy: text("created_by").notNull(),
    expiresAt: integer("expires_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_annotations_encounter_created_at").on(
      table.encounterId,
      table.createdAt,
    ),
  ],
);

export const actions = sqliteTable(
  "actions",
  {
    id: text("id").primaryKey(),
    encounterId: text("encounter_id")
      .notNull()
      .references(() => encounters.id, { onDelete: "cascade" }),
    participantId: text("participant_id").notNull(),
    actionType: text("action_type").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_actions_encounter_created_at").on(
      table.encounterId,
      table.createdAt,
    ),
    index("idx_actions_encounter_participant_created").on(
      table.encounterId,
      table.participantId,
      table.createdAt,
      table.id,
    ),
  ],
);

export const handouts = sqliteTable(
  "handouts",
  {
    id: text("id").primaryKey(),
    encounterId: text("encounter_id")
      .notNull()
      .references(() => encounters.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    displayKey: text("display_key").notNull(),
    thumbnailKey: text("thumbnail_key").notNull(),
    mimeType: text("mime_type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    displayBytes: integer("display_bytes").notNull(),
    thumbnailBytes: integer("thumbnail_bytes").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    index("idx_handouts_encounter_created").on(
      table.encounterId,
      table.createdAt,
      table.id,
    ),
  ],
);

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    encounterId: text("encounter_id")
      .notNull()
      .references(() => encounters.id, { onDelete: "cascade" }),
    senderName: text("sender_name").notNull(),
    senderRole: text("sender_role").notNull(),
    recipientName: text("recipient_name"),
    body: text("body").notNull(),
    handoutId: text("handout_id").references(() => handouts.id, { onDelete: "set null" }),
    showImmediately: integer("show_immediately", { mode: "boolean" }).default(false).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_chat_messages_encounter_created").on(
      table.encounterId,
      table.createdAt,
      table.id,
    ),
    index("idx_chat_messages_encounter_handout_created").on(
      table.encounterId,
      table.handoutId,
      table.createdAt,
      table.id,
    ).where(sql`${table.handoutId} IS NOT NULL`),
  ],
);
