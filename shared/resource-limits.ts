export const API_JSON_BODY_MAX_BYTES = 256 * 1024;
export const CATALOG_IMPORT_JSON_MAX_BYTES = 28 * 1024 * 1024;
export const HANDOUT_MULTIPART_MAX_BYTES = 1_750_000;

export const MAX_SCENARIOS = 100;
export const MAX_CAMPAIGNS = 64;
export const MAX_IDENTITIES = 256;
export const MAX_CAMPAIGN_MEMBERS_PER_CAMPAIGN = 64;
export const MAX_CAMPAIGN_CHARACTERS_PER_CAMPAIGN = 64;
export const MAX_PARTICIPANTS_PER_ENCOUNTER = 64;
export const MAX_TOKENS_PER_ENCOUNTER = 256;
export const MAX_EFFECTS_PER_TOKEN = 32;
export const MAX_EFFECTS_PER_ENCOUNTER = 1_024;
export const MAX_ANNOTATIONS_PER_ENCOUNTER = 500;
export const MAX_MAP_IMAGES = 500;
// Legacy rollout archive only. New map preparation uses one durable draft per encounter.
export const MAX_MAP_PRESETS_PER_ENCOUNTER = 60;
export const MAX_HANDOUT_ROWS_PER_ENCOUNTER = 200;
export const MAX_CHAT_MESSAGES_PER_ENCOUNTER = 2_000;
export const MAX_ACTIONS_PER_ENCOUNTER = 20_000;
export const MAX_CATALOG_ENTRIES = 2_000;
export const MAX_CATALOG_FAMILIES = 128;
export const MAX_INITIATIVE_GROUP_TOKENS = 100;
export const MAX_SHARED_FOG_INPUT_POINTS = 100;

export const CATALOG_IMAGE_MAX_ENCODED_CHARACTERS = 2_800_000;
export const CATALOG_IMAGE_MAX_BYTES = 2_000_000;
export const CATALOG_IMPORT_MAX_DECODED_BYTES = 20 * 1024 * 1024;
export const CATALOG_ORIGINAL_MAX_EDGE = 2_048;
export const CATALOG_ORIGINAL_MAX_PIXELS = 4_194_304;
export const CATALOG_THUMBNAIL_MAX_EDGE = 512;
export const CATALOG_THUMBNAIL_MAX_PIXELS = 262_144;

export const RATE_LIMIT_POLICIES = Object.freeze({
  publicRead: { limit: 120, windowMs: 60_000 },
  anonymousProjection: { limit: 20, windowMs: 60_000 },
  authenticatedProjection: { limit: 180, windowMs: 60_000 },
  join: { limit: 30, windowMs: 60_000 },
  encounterWrite: { limit: 180, windowMs: 60_000 },
  tokenMove: { limit: 120, windowMs: 60_000 },
  handoutUpload: { limit: 10, windowMs: 60_000 },
  catalogImport: { limit: 2, windowMs: 60_000 },
});
