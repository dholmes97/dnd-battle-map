import type { CreatureSize } from "../shared/creature-library.ts";
import type { EncounterStatus, SharedAnnotation } from "../shared/contracts.ts";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  MAP_ASSETS?: R2Bucket;
  CATALOG_IMPORT_TOKEN?: string;
  PRODUCTION_BACKUP_TOKEN?: string;
  SCENARIO_PROVISIONING_TOKEN?: string;
  SCENARIO_PROVISIONING_SENDERS?: string;
  IMAGES?: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export type EncounterRow = {
  id: string; code: string; name: string; dm_briefing: string; version: number; status: EncounterStatus;
  map_asset: string; map_package_json: string | null; active_map_preset_id: string | null;
  grid_width: number; grid_height: number; current_round: number;
  active_initiative_order: number | null; strict_movement: number; updated_at: number;
};

export type TokenRow = {
  id: string; name: string; x: number; y: number; art_asset: string | null; kind: string;
  size: CreatureSize; speed: number; armor_class: number | null; hp: number | null; max_hp: number | null; is_hidden: number;
  summoner_token_id: string | null; initiative: number | null; initiative_group_id: string | null;
  initiative_order: number | null; turn_complete: number; movement_used: number;
  movement_origin_x?: number | null; movement_origin_y?: number | null;
  owner_participant_id: string | null; owner_name: string | null;
};

export type ParticipantRow = { id: string; name: string; role: "dm" | "player" };
export type EffectRow = { id: string; token_id: string; name: string; effect_type: string; duration_rounds: number | null; expires_round: number | null; reminder_timing: string };
export type AnnotationRow = { id: string; annotation_type: SharedAnnotation["type"]; x: number; y: number; x2: number | null; y2: number | null; color: string; label: string | null; created_by: string; expires_at: number | null };
export type ActionRow = { id: string; action_type: string; payload_json: string; created_at: number };
export type ChatMessageRow = { id: string; sender_name: string; sender_role: "dm" | "player"; recipient_name: string | null; body: string; handout_id: string | null; handout_title: string | null; handout_width: number | null; handout_height: number | null; handout_updated_at: number | null; handout_deleted_at: number | null; show_immediately: number; created_at: number };
export type HandoutRow = { id: string; title: string; display_key: string; thumbnail_key: string; mime_type: string; width: number; height: number; display_bytes: number; thumbnail_bytes: number; created_by: string; created_at: number; updated_at: number; deleted_at: number | null; message_count?: number };
export type MapPresetRow = { id: string; name: string; description: string; source_prompt: string | null; package_json: string; created_at: number; updated_at: number };
export type CreatureCatalogRow = { id: string; name: string; family: string; creature_type: string; size: CreatureSize; default_hp: number; hit_dice: string | null; armor_class: number; challenge_rating: string | null; default_speed: number; walk_speed: number; fly_speed: number | null; swim_speed: number | null; climb_speed: number | null; burrow_speed: number | null; token_asset: string; thumbnail_asset: string; sort_order: number };
