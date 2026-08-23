export const LIVE_POLL_MIN_DELAY_MS = 250;
export const LIVE_POLL_ACTIVE_MAX_DELAY_MS = 3_000;
export const LIVE_POLL_IDLE_MAX_DELAY_MS = 8_000;
export const LIVE_POLL_JITTER_RATIO = 0.1;

export type LivePollingMode = "active" | "idle";

function stablePollJitter(seed: string, unchangedPolls: number): number {
  let hash = 2_166_136_261;
  const value = `${seed}:${unchangedPolls}`;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 0xffff_ffff;
}

export function unchangedPollDelay(
  unchangedPolls: number,
  mode: LivePollingMode = "active",
  seed = "participant",
): number {
  const exponent = Math.max(0, Math.min(5, Math.trunc(unchangedPolls)));
  const maximum = mode === "active" ? LIVE_POLL_ACTIVE_MAX_DELAY_MS : LIVE_POLL_IDLE_MAX_DELAY_MS;
  const bounded = Math.min(maximum, LIVE_POLL_MIN_DELAY_MS * (2 ** exponent));
  if (bounded < 1_000) return bounded;
  const jitter = 1 - LIVE_POLL_JITTER_RATIO + stablePollJitter(seed, exponent) * LIVE_POLL_JITTER_RATIO * 2;
  return Math.max(LIVE_POLL_MIN_DELAY_MS, Math.round(bounded * jitter));
}

export function shouldRunLiveRequests(visibilityState: DocumentVisibilityState): boolean {
  return visibilityState === "visible";
}

export type LivePollingSchedule = {
  unchangedPolls: number;
  delayMs: number;
};

export function scheduleAfterPoll(
  unchangedPolls: number,
  changed: boolean,
  mode: LivePollingMode = "active",
  seed = "participant",
): LivePollingSchedule {
  const nextUnchangedPolls = changed ? 0 : unchangedPolls + 1;
  return {
    unchangedPolls: nextUnchangedPolls,
    delayMs: unchangedPollDelay(changed ? 0 : unchangedPolls, mode, seed),
  };
}

export function livePollingMode(status: "setup" | "active" | "paused"): LivePollingMode {
  return status === "active" ? "active" : "idle";
}
