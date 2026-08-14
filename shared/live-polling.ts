export const LIVE_POLL_MIN_DELAY_MS = 250;
export const LIVE_POLL_MAX_DELAY_MS = 1_000;

export function unchangedPollDelay(unchangedPolls: number): number {
  const exponent = Math.max(0, Math.min(2, Math.trunc(unchangedPolls)));
  return Math.min(LIVE_POLL_MAX_DELAY_MS, LIVE_POLL_MIN_DELAY_MS * (2 ** exponent));
}

export function shouldRunLiveRequests(visibilityState: DocumentVisibilityState): boolean {
  return visibilityState === "visible";
}

export type LivePollingSchedule = {
  unchangedPolls: number;
  delayMs: number;
};

export function scheduleAfterPoll(unchangedPolls: number, changed: boolean): LivePollingSchedule {
  const nextUnchangedPolls = changed ? 0 : unchangedPolls + 1;
  return {
    unchangedPolls: nextUnchangedPolls,
    delayMs: unchangedPollDelay(changed ? 0 : unchangedPolls),
  };
}
