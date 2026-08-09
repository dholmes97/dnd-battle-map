import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const encounters = sqliteTable("encounters", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("setup"),
  mapAsset: text("map_asset")
    .notNull()
    .default(""),
  mapPackageJson: text("map_package_json"),
  activeMapPresetId: text("active_map_preset_id"),
  gridWidth: integer("grid_width").notNull().default(16),
  gridHeight: integer("grid_height").notNull().default(11),
  currentRound: integer("current_round").notNull().default(0),
  activeInitiativeOrder: integer("active_initiative_order"),
  strictMovement: integer("strict_movement", { mode: "boolean" }).notNull().default(true),
  updatedAt: integer("updated_at").notNull(),
});

export const mapPresets = sqliteTable(
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

export const participants = sqliteTable(
  "participants",
  {
    id: text("id").primaryKey(),
    encounterId: text("encounter_id")
      .notNull()
      .references(() => encounters.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    role: text("role").notNull().default("player"),
    sessionSecret: text("session_secret").notNull().unique(),
    joinedAt: integer("joined_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (table) => [index("idx_participants_encounter_id").on(table.encounterId)],
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
    hp: integer("hp"),
    maxHp: integer("max_hp"),
    isHidden: integer("is_hidden", { mode: "boolean" }).notNull().default(false),
    summonerTokenId: text("summoner_token_id"),
    initiative: integer("initiative"),
    initiativeGroupId: text("initiative_group_id"),
    initiativeOrder: integer("initiative_order"),
    turnComplete: integer("turn_complete", { mode: "boolean" }).notNull().default(false),
    movementUsed: real("movement_used").notNull().default(0),
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
    index("idx_tokens_owner_participant_id").on(table.ownerParticipantId),
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
  ],
);
