export const SCENARIO_MAIL_BODY_MAX_BYTES = 2_048;
export const SCENARIO_MAIL_REPLY_KINDS = ["clarification", "ready", "failed"] as const;

export type ScenarioMailReplyKind = (typeof SCENARIO_MAIL_REPLY_KINDS)[number];

const SAFE_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const MAILBOX_KEY_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;
const PROVIDER_MESSAGE_ID_PATTERN = /^[^\s\u0000-\u001f\u007f]{1,200}$/;
const THREAD_ID_PATTERN = /^[^\s\u0000-\u001f\u007f]{1,200}$/;
const RESPONSE_MARKER_PATTERN = /(?:^|\s)(DND-SCENARIO-REPLY:([A-Za-z0-9-]{1,64}):([A-Za-z0-9-]{1,64}))(?=\s|$)/;

export function parseScenarioMailReplyKind(value: unknown): ScenarioMailReplyKind | null {
  return typeof value === "string" && SCENARIO_MAIL_REPLY_KINDS.includes(value as ScenarioMailReplyKind)
    ? value as ScenarioMailReplyKind
    : null;
}

export function scenarioMailResponseMarker(jobId: string, replyId: string): string {
  if (!SAFE_ID_PATTERN.test(jobId) || !SAFE_ID_PATTERN.test(replyId)) throw new Error("Scenario mail marker IDs are invalid.");
  return `DND-SCENARIO-REPLY:${jobId}:${replyId}`;
}

export function extractScenarioMailResponseMarker(value: string): string | null {
  return value.slice(0, 100_000).match(RESPONSE_MARKER_PATTERN)?.[1] ?? null;
}

export function parseScenarioMailResponseMarker(value: unknown): { marker: string; jobId: string; replyId: string } | null {
  if (typeof value !== "string") return null;
  const match = ` ${value.trim()} `.match(RESPONSE_MARKER_PATTERN);
  return match && match[1] === value.trim()
    ? { marker: match[1], jobId: match[2], replyId: match[3] }
    : null;
}

export function cleanScenarioMailboxKey(value: unknown): string | null {
  return typeof value === "string" && MAILBOX_KEY_PATTERN.test(value.trim()) ? value.trim() : null;
}

export function cleanScenarioProviderMessageId(value: unknown): string | null {
  return typeof value === "string" && PROVIDER_MESSAGE_ID_PATTERN.test(value.trim()) ? value.trim() : null;
}

export function cleanScenarioThreadId(value: unknown): string | null {
  return typeof value === "string" && THREAD_ID_PATTERN.test(value.trim()) ? value.trim() : null;
}
