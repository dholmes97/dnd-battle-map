import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEncounterSync } from "@/app/use-encounter-sync";
import type { EncounterState, ParticipantSession } from "@/shared/contracts";

const participant: ParticipantSession = {
  id: "participant-1",
  name: "Dan",
  role: "player",
  sessionSecret: "session-secret",
};
const state = {
  encounter: { code: "TEST", version: 7 },
  tokens: [],
  annotations: [],
  chatMessages: [],
  handouts: [],
  savedMapPresets: [],
} as unknown as EncounterState;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useEncounterSync live lifecycle", () => {
  it("exposes operations without leaking mutable synchronization storage", () => {
    const { result } = renderHook(() => useEncounterSync({
      setError: vi.fn(),
      setNotice: vi.fn(),
    }));
    expect(result.current).toMatchObject({
      participant: null,
      state: null,
      connection: "connecting",
      startSession: expect.any(Function),
      acceptState: expect.any(Function),
      sendCommand: expect.any(Function),
      runOptimisticCommand: expect.any(Function),
      createTokenOptimistically: expect.any(Function),
      removeTokenOptimistically: expect.any(Function),
      moveTokenOptimistically: expect.any(Function),
      runHistory: expect.any(Function),
    });
    expect(Object.keys(result.current).some((key) => key.endsWith("Ref"))).toBe(false);
    expect(result.current).not.toHaveProperty("setState");
    expect(result.current).not.toHaveProperty("setParticipant");
    expect(result.current).not.toHaveProperty("setConnection");
  });

  it("stops live requests while hidden and refreshes immediately on return", async () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    const requested: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("/state")) return Response.json(state);
      if (url.includes("/heartbeat")) return Response.json({ present: true });
      return new Response(null, { status: 204 });
    }));

    const { result } = renderHook(() => useEncounterSync({
      setError: vi.fn(),
      setNotice: vi.fn(),
    }));
    await act(async () => {
      result.current.startSession(participant, state);
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(requested.some((url) => url.includes("/events?since="))).toBe(true);

    visibility = "hidden";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => { await Promise.resolve(); });
    const hiddenRequestCount = requested.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(requested).toHaveLength(hiddenRequestCount);

    visibility = "visible";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(requested.slice(hiddenRequestCount).some((url) => url.includes("/state"))).toBe(true);
  });
});
