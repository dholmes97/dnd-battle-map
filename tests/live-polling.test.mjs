import assert from "node:assert/strict";
import test from "node:test";

import {
  LIVE_POLL_MAX_DELAY_MS,
  scheduleAfterPoll,
  shouldRunLiveRequests,
  unchangedPollDelay,
} from "../shared/live-polling.ts";

test("unchanged foreground polls back off quickly to a bounded one-second cadence", () => {
  assert.deepEqual([0, 1, 2, 3, 20].map(unchangedPollDelay), [250, 500, 1_000, 1_000, 1_000]);
  assert.equal(LIVE_POLL_MAX_DELAY_MS, 1_000);
});

test("live state and heartbeat requests run only while the page is visible", () => {
  assert.equal(shouldRunLiveRequests("visible"), true);
  assert.equal(shouldRunLiveRequests("hidden"), false);
  assert.equal(shouldRunLiveRequests("prerender"), false);
});

test("a received update resets the next foreground poll to the fast cadence", () => {
  assert.deepEqual(scheduleAfterPoll(12, true), { unchangedPolls: 0, delayMs: 250 });
  assert.deepEqual(scheduleAfterPoll(0, false), { unchangedPolls: 1, delayMs: 250 });
  assert.deepEqual(scheduleAfterPoll(2, false), { unchangedPolls: 3, delayMs: 1_000 });
});
