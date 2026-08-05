import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const encounters = sqliteTable("encounters", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: integer("updated_at").notNull(),
});

export const participants = sqliteTable(
  "participants",
  {
    id: text("id").primaryKey(),
    encounterId: text("encounter_id")
      .notNull()
      .references(() => encounters.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
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
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    lockOwnerId: text("lock_owner_id"),
    lockOwnerName: text("lock_owner_name"),
    lockExpiresAt: integer("lock_expires_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("idx_tokens_encounter_id").on(table.encounterId)],
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
