import assert from "node:assert/strict";
import test from "node:test";

import {
  LIVE_POLL_ACTIVE_MAX_DELAY_MS,
  LIVE_POLL_IDLE_MAX_DELAY_MS,
  livePollingMode,
  scheduleAfterPoll,
  shouldRunLiveRequests,
  unchangedPollDelay,
} from "../shared/live-polling.ts";

test("unchanged foreground polls use an exact active ceiling and a jittered idle ceiling", () => {
  assert.deepEqual([0, 1].map((count) => unchangedPollDelay(count, "active", "dan")), [250, 500]);
  assert.equal(unchangedPollDelay(20, "active", "dan"), LIVE_POLL_ACTIVE_MAX_DELAY_MS);
  assert.equal(unchangedPollDelay(20, "active", "barry"), LIVE_POLL_ACTIVE_MAX_DELAY_MS);
  assert.ok(unchangedPollDelay(20, "idle", "dan") >= LIVE_POLL_IDLE_MAX_DELAY_MS * 0.9);
  assert.ok(unchangedPollDelay(20, "idle", "dan") <= LIVE_POLL_IDLE_MAX_DELAY_MS * 1.1);
  assert.notEqual(
    unchangedPollDelay(20, "idle", "dan"),
    unchangedPollDelay(20, "idle", "barry"),
  );
  assert.equal(livePollingMode("active"), "active");
  assert.equal(livePollingMode("setup"), "idle");
  assert.equal(livePollingMode("paused"), "idle");
});

test("live state and heartbeat requests run only while the page is visible", () => {
  assert.equal(shouldRunLiveRequests("visible"), true);
  assert.equal(shouldRunLiveRequests("hidden"), false);
  assert.equal(shouldRunLiveRequests("prerender"), false);
});

test("a received update resets the next foreground poll to the fast cadence", () => {
  assert.deepEqual(scheduleAfterPoll(12, true, "idle", "dan"), { unchangedPolls: 0, delayMs: 250 });
  assert.deepEqual(scheduleAfterPoll(0, false, "active", "dan"), { unchangedPolls: 1, delayMs: 250 });
  assert.equal(scheduleAfterPoll(2, false, "active", "dan").unchangedPolls, 3);
});

test("four visible participants stay within the measured hourly request budget", () => {
  const participants = ["dan", "barry", "scott", "kevin"];
  const requestsInHour = (mode) => participants.reduce((total, participant) => {
    let elapsed = 0;
    let unchangedPolls = 0;
    let requests = 0;
    while (elapsed < 60 * 60 * 1_000) {
      const schedule = scheduleAfterPoll(unchangedPolls, false, mode, participant);
      unchangedPolls = schedule.unchangedPolls;
      elapsed += schedule.delayMs;
      requests += 1;
    }
    return total + requests;
  }, 0);

  const activeRequests = requestsInHour("active");
  const idleRequests = requestsInHour("idle");
  assert.ok(activeRequests < 19_500, `active encounter made ${activeRequests} requests/hour`);
  assert.ok(idleRequests < 2_200, `setup/paused encounter made ${idleRequests} requests/hour`);
  assert.ok(activeRequests > idleRequests);
});
