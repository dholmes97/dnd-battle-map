import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { battleMapApi } from "@/app/battle-map-api";
import { useEncounterSync } from "@/app/use-encounter-sync";
import type { EncounterState, ParticipantSession, SharedToken } from "@/shared/contracts";

const participant: ParticipantSession = {
  id: "participant-1",
  name: "Dan",
  role: "player",
  sessionSecret: "session-secret",
};
const token: SharedToken = {
  id: "token-1",
  name: "Dar'eleth",
  artAsset: null,
  kind: "character",
  size: "medium",
  speed: 30,
  flySpeed: null,
  swimSpeed: null,
  climbSpeed: null,
  burrowSpeed: null,
  armorClass: 18,
  hp: 30,
  maxHp: 30,
  healthState: "unharmed",
  hidden: false,
  summonerTokenId: null,
  initiative: 15,
  initiativeGroupId: null,
  initiativeOrder: 0,
  turnComplete: false,
  x: 2,
  y: 2,
  altitude: 0,
  movementUsed: 0,
  movementOrigin: null,
  effects: [],
  controller: { name: "Dan" },
  controlledByViewer: true,
};

const state: EncounterState = {
  encounter: {
    code: "TEST",
    name: "Test encounter",
    dmBriefing: null,
    version: 7,
    status: "active",
    mapPackage: null,
    activeMapPresetId: null,
    currentRound: 7,
    activeInitiativeOrder: 0,
    strictMovement: false,
    fogVisibility: { mode: "off", polygons: [] },
    updatedAt: 7,
  },
  grid: { width: 24, height: 16, feetPerCell: 5 },
  viewer: { id: participant.id, role: participant.role },
  undo: { available: 0, redoAvailable: 0, lastAction: null, nextRedoAction: null },
  tokens: [token],
  annotations: [],
  chatMessages: [],
  handouts: [],
  savedMapPresets: [],
  availableArt: [],
};

function encounterState(overrides: {
  version?: number;
  status?: EncounterState["encounter"]["status"];
  strictMovement?: boolean;
  currentRound?: number;
  tokens?: SharedToken[];
} = {}): EncounterState {
  return {
    ...state,
    encounter: {
      ...state.encounter,
      version: overrides.version ?? state.encounter.version,
      status: overrides.status ?? state.encounter.status,
      strictMovement: overrides.strictMovement ?? state.encounter.strictMovement,
      currentRound: overrides.currentRound ?? state.encounter.currentRound,
    },
    tokens: overrides.tokens ?? state.tokens,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function renderHiddenSync(setError = vi.fn(), setNotice = vi.fn(), initialState = state) {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const rendered = renderHook(() => useEncounterSync({ setError, setNotice }));
  act(() => rendered.result.current.startSession(participant, initialState));
  return { ...rendered, setError, setNotice };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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

describe("useEncounterSync optimistic interleavings", () => {
  it("paints immediately and replaces the reducer with authoritative success", async () => {
    const command = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => command.promise));
    const { result } = renderHiddenSync();

    let request!: ReturnType<typeof result.current.runOptimisticCommand>;
    act(() => {
      request = result.current.runOptimisticCommand(
        "set-strict-movement",
        { enabled: true },
        (current) => ({ ...current, encounter: { ...current.encounter, strictMovement: true } }),
        undefined,
        undefined,
        false,
      );
    });
    expect(result.current.state?.encounter.strictMovement).toBe(true);

    command.resolve(jsonResponse({ state: encounterState({ version: 8, strictMovement: true }) }));
    await act(async () => { await request; });
    expect(result.current.state?.encounter).toMatchObject({ version: 8, strictMovement: true });
  });

  it("rolls back a rejected reducer before a failed recovery request settles", async () => {
    const command = deferred<Response>();
    const recovery = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) =>
      String(input).endsWith("/command") ? command.promise : recovery.promise));
    const setError = vi.fn();
    const { result } = renderHiddenSync(setError);

    let request!: ReturnType<typeof result.current.runOptimisticCommand>;
    act(() => {
      request = result.current.runOptimisticCommand(
        "set-strict-movement",
        { enabled: true },
        (current) => ({ ...current, encounter: { ...current.encounter, strictMovement: true } }),
        undefined,
        undefined,
        false,
      );
    });
    expect(result.current.state?.encounter.strictMovement).toBe(true);

    command.reject(new Error("Action rejected."));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.state?.encounter.strictMovement).toBe(false);
    expect(setError).toHaveBeenLastCalledWith("Action rejected.");
    await act(async () => { expect(await request).toBeNull(); });

    recovery.reject(new Error("Recovery unavailable."));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.state?.encounter.strictMovement).toBe(false);
  });

  it("removes only the rejected operation while preserving a concurrent reducer", async () => {
    const commands = [deferred<Response>(), deferred<Response>()];
    const recovery = deferred<Response>();
    let commandIndex = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) =>
      String(input).endsWith("/command") ? commands[commandIndex++].promise : recovery.promise));
    const { result } = renderHiddenSync();

    let first!: ReturnType<typeof result.current.runOptimisticCommand>;
    let second!: ReturnType<typeof result.current.runOptimisticCommand>;
    act(() => {
      first = result.current.runOptimisticCommand(
        "configure-encounter", { status: "paused" },
        (current) => ({ ...current, encounter: { ...current.encounter, status: "paused" } }),
        undefined, undefined, false,
      );
      second = result.current.runOptimisticCommand(
        "set-strict-movement", { enabled: true },
        (current) => ({ ...current, encounter: { ...current.encounter, strictMovement: true } }),
        undefined, undefined, false,
      );
    });
    expect(result.current.state?.encounter).toMatchObject({ status: "paused", strictMovement: true });

    commands[0].reject(new Error("Pause rejected."));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.state?.encounter).toMatchObject({ status: "active", strictMovement: true });

    commands[1].resolve(jsonResponse({ state: encounterState({ version: 8, strictMovement: true }) }));
    recovery.reject(new Error("Recovery unavailable."));
    await act(async () => { await Promise.all([first, second]); });
    expect(result.current.state?.encounter).toMatchObject({ version: 8, status: "active", strictMovement: true });
  });

  it("reconciles a stale operation response against a newer authoritative refresh", async () => {
    const command = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => command.promise));
    const { result } = renderHiddenSync();

    let request!: ReturnType<typeof result.current.runOptimisticCommand>;
    act(() => {
      request = result.current.runOptimisticCommand(
        "configure-encounter", { status: "paused" },
        (current) => ({ ...current, encounter: { ...current.encounter, status: "paused" } }),
        undefined, undefined, false,
      );
    });

    act(() => result.current.acceptState(encounterState({ version: 9, strictMovement: true })));
    expect(result.current.state?.encounter).toMatchObject({ version: 9, status: "paused", strictMovement: true });

    command.resolve(jsonResponse({ state: encounterState({ version: 8, status: "paused" }) }));
    await act(async () => { await request; });
    expect(result.current.state?.encounter).toMatchObject({ version: 9, status: "active", strictMovement: true });
  });

  it("serializes rapid turn requests while painting every operation immediately", async () => {
    const commands = [deferred<Response>(), deferred<Response>()];
    let commandIndex = 0;
    const fetchMock = vi.fn(() => commands[commandIndex++].promise);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHiddenSync();
    const advance = (current: EncounterState) => ({
      ...current,
      encounter: { ...current.encounter, currentRound: current.encounter.currentRound + 1 },
    });

    let first!: ReturnType<typeof result.current.runOptimisticCommand>;
    let second!: ReturnType<typeof result.current.runOptimisticCommand>;
    act(() => {
      first = result.current.runOptimisticCommand("advance-turn", {}, advance, undefined, undefined, false);
      second = result.current.runOptimisticCommand("advance-turn", {}, advance, undefined, undefined, false);
    });
    expect(result.current.state?.encounter.currentRound).toBe(9);
    await act(async () => { await Promise.resolve(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    commands[0].resolve(jsonResponse({ state: encounterState({ version: 8, currentRound: 8 }) }));
    await act(async () => { await first; });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.state?.encounter.currentRound).toBe(9);

    commands[1].resolve(jsonResponse({ state: encounterState({ version: 9, currentRound: 9 }) }));
    await act(async () => { await second; });
    expect(result.current.state?.encounter).toMatchObject({ version: 9, currentRound: 9 });
  });

  it("rolls back a rejected token move even when recovery also fails", async () => {
    const move = deferred<Response>();
    const recovery = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) =>
      String(input).endsWith("/move") ? move.promise : recovery.promise));
    const { result } = renderHiddenSync();

    let request!: ReturnType<typeof result.current.moveTokenOptimistically>;
    act(() => { request = result.current.moveTokenOptimistically(token.id, { x: 6, y: 5, altitude: 10 }); });
    expect(result.current.state?.tokens[0]).toMatchObject({ x: 6, y: 5, altitude: 10 });

    move.reject(new Error("Move rejected."));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.state?.tokens[0]).toMatchObject({ x: 2, y: 2, altitude: 0 });

    recovery.reject(new Error("Recovery unavailable."));
    await act(async () => { expect(await request).toBeNull(); });
    expect(result.current.state?.tokens[0]).toMatchObject({ x: 2, y: 2, altitude: 0 });
  });

  it("keeps the newest repeated move painted and rolls it back to the prior accepted move", async () => {
    const moves = [deferred<Response>(), deferred<Response>()];
    const recovery = deferred<Response>();
    let moveIndex = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      String(input).endsWith("/move") ? moves[moveIndex++].promise : recovery.promise);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHiddenSync();

    let first!: ReturnType<typeof result.current.moveTokenOptimistically>;
    let second!: ReturnType<typeof result.current.moveTokenOptimistically>;
    act(() => {
      first = result.current.moveTokenOptimistically(token.id, { x: 4, y: 4, altitude: 5 });
      second = result.current.moveTokenOptimistically(token.id, { x: 8, y: 7, altitude: 10 });
    });
    expect(result.current.state?.tokens[0]).toMatchObject({ x: 8, y: 7, altitude: 10 });
    await act(async () => { await Promise.resolve(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const firstAcceptedToken = { ...token, x: 4, y: 4, altitude: 5, movementOrigin: { x: 2, y: 2 } };
    moves[0].resolve(jsonResponse({
      distance: 15,
      overBudget: false,
      state: encounterState({ version: 8, tokens: [firstAcceptedToken] }),
    }));
    await act(async () => { await first; });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.state?.tokens[0]).toMatchObject({ x: 8, y: 7, altitude: 10 });

    moves[1].reject(new Error("Revision rejected."));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.state?.tokens[0]).toMatchObject({ x: 4, y: 4, altitude: 5 });
    recovery.reject(new Error("Recovery unavailable."));
    await act(async () => { expect(await second).toBeNull(); });
    expect(result.current.state?.tokens[0]).toMatchObject({ x: 4, y: 4, altitude: 5 });
  });

  it("removes a rejected temporary token and clears its pending identity", async () => {
    const command = deferred<Response>();
    const recovery = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) =>
      String(input).endsWith("/command") ? command.promise : recovery.promise));
    const { result } = renderHiddenSync();
    let temporaryId = "";

    let request!: ReturnType<typeof result.current.createTokenOptimistically>;
    act(() => {
      request = result.current.createTokenOptimistically(
        "create-token",
        { name: "Summon", kind: "summon", size: "medium", speed: 30, x: 5, y: 5 },
        (id) => {
          temporaryId = id;
          return { ...token, id, name: "Summon", kind: "summon", x: 5, y: 5 };
        },
        "Summon placed.",
      );
    });
    expect(result.current.state?.tokens.some((candidate) => candidate.id === temporaryId)).toBe(true);
    expect(result.current.isTokenPendingCreation(temporaryId)).toBe(true);

    command.reject(new Error("Placement rejected."));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.state?.tokens.some((candidate) => candidate.id === temporaryId)).toBe(false);
    await act(async () => { expect(await request).toBeNull(); });
    expect(result.current.isTokenPendingCreation(temporaryId)).toBe(false);
    recovery.reject(new Error("Recovery unavailable."));
    await act(async () => { await Promise.resolve(); });
  });

  it("restores a rejected optimistic deletion without a recovery response", async () => {
    const command = deferred<Response>();
    const recovery = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) =>
      String(input).endsWith("/command") ? command.promise : recovery.promise));
    const { result } = renderHiddenSync();

    let request!: ReturnType<typeof result.current.removeTokenOptimistically>;
    act(() => { request = result.current.removeTokenOptimistically(token, "Token removed."); });
    expect(result.current.state?.tokens).toHaveLength(0);

    command.reject(new Error("Deletion rejected."));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.state?.tokens).toEqual([token]);
    recovery.reject(new Error("Recovery unavailable."));
    await act(async () => { expect(await request).toBe(false); });
    expect(result.current.state?.tokens).toEqual([token]);
  });

  it("rolls back a rejected optimistic undo and preserves it for retry", async () => {
    const requests = [deferred<Response>(), deferred<Response>(), deferred<Response>(), deferred<Response>()];
    let requestIndex = 0;
    vi.stubGlobal("fetch", vi.fn(() => requests[requestIndex++].promise));
    const { result } = renderHiddenSync();

    let update!: ReturnType<typeof result.current.runOptimisticCommand>;
    act(() => {
      update = result.current.runOptimisticCommand(
        "update-token", { tokenId: token.id, name: "Dar" },
        (current) => ({ ...current, tokens: current.tokens.map((candidate) => candidate.id === token.id ? { ...candidate, name: "Dar" } : candidate) }),
      );
    });
    requests[0].resolve(jsonResponse({
      state: { ...encounterState({ version: 8, tokens: [{ ...token, name: "Dar" }] }), undo: { ...state.undo, available: 1 } },
    }));
    await act(async () => { await update; });
    expect(result.current.state?.tokens[0].name).toBe("Dar");

    let firstUndo!: ReturnType<typeof result.current.runHistory>;
    act(() => { firstUndo = result.current.runHistory("undo"); });
    expect(result.current.state?.tokens[0].name).toBe("Dar'eleth");
    requests[1].reject(new Error("Undo conflicted."));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.state?.tokens[0].name).toBe("Dar");
    requests[2].reject(new Error("Recovery unavailable."));
    await act(async () => { expect(await firstUndo).toBe(false); });

    let retry!: ReturnType<typeof result.current.runHistory>;
    act(() => { retry = result.current.runHistory("undo"); });
    expect(result.current.state?.tokens[0].name).toBe("Dar'eleth");
    requests[3].resolve(jsonResponse({
      state: { ...encounterState({ version: 9 }), undo: { ...state.undo, redoAvailable: 1 } },
    }));
    await act(async () => { expect(await retry).toBe(true); });
    expect(result.current.state?.tokens[0].name).toBe("Dar'eleth");
  });

  it("times out a stranded optimistic command and restores its paint", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).endsWith("/command")) return Promise.reject(new Error("Recovery unavailable."));
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    }));
    const setError = vi.fn();
    const { result } = renderHiddenSync(setError);

    let request!: ReturnType<typeof result.current.runOptimisticCommand>;
    act(() => {
      request = result.current.runOptimisticCommand(
        "set-strict-movement", { enabled: true },
        (current) => ({ ...current, encounter: { ...current.encounter, strictMovement: true } }),
        undefined, undefined, false,
      );
    });
    expect(result.current.state?.encounter.strictMovement).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    expect(await request).toBeNull();
    expect(result.current.state?.encounter.strictMovement).toBe(false);
    expect(setError).toHaveBeenLastCalledWith("The request timed out. Please try again.");
  });

  it("bounds queued operations from their paint time rather than restarting the deadline", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).endsWith("/command")) return Promise.reject(new Error("Recovery unavailable."));
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHiddenSync();

    let first!: ReturnType<typeof result.current.runOptimisticCommand>;
    let second!: ReturnType<typeof result.current.runOptimisticCommand>;
    act(() => {
      first = result.current.runOptimisticCommand(
        "configure-encounter", { status: "paused" },
        (current) => ({ ...current, encounter: { ...current.encounter, status: "paused" } }),
        undefined, undefined, false,
      );
      second = result.current.runOptimisticCommand(
        "set-strict-movement", { enabled: true },
        (current) => ({ ...current, encounter: { ...current.encounter, strictMovement: true } }),
        undefined, undefined, false,
      );
    });
    expect(result.current.state?.encounter).toMatchObject({ status: "paused", strictMovement: true });

    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    await act(async () => { expect(await Promise.all([first, second])).toEqual([null, null]); });
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/command"))).toHaveLength(1);
    expect(result.current.state?.encounter).toMatchObject({ status: "active", strictMovement: false });
  });

  it("isolates in-flight operation IDs and cancels unsent work across a session change", async () => {
    const commands = [deferred<Response>(), deferred<Response>()];
    const urls: string[] = [];
    let commandIndex = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      urls.push(String(input));
      return commands[commandIndex++].promise;
    }));
    const { result } = renderHiddenSync();

    let oldRequest!: ReturnType<typeof result.current.runOptimisticCommand>;
    let oldQueuedRequest!: ReturnType<typeof result.current.runOptimisticCommand>;
    act(() => {
      oldRequest = result.current.runOptimisticCommand(
        "configure-encounter", { status: "paused" },
        (current) => ({ ...current, encounter: { ...current.encounter, status: "paused" } }),
        undefined, undefined, false,
      );
      oldQueuedRequest = result.current.runOptimisticCommand(
        "set-strict-movement", { enabled: true },
        (current) => ({ ...current, encounter: { ...current.encounter, strictMovement: true } }),
        undefined, undefined, false,
      );
    });
    await act(async () => { await Promise.resolve(); });

    const nextSessionState: EncounterState = {
      ...state,
      encounter: { ...state.encounter, code: "NEXT", version: 1, currentRound: 1 },
    };
    act(() => result.current.startSession(participant, nextSessionState));
    let nextRequest!: ReturnType<typeof result.current.runOptimisticCommand>;
    act(() => {
      nextRequest = result.current.runOptimisticCommand(
        "set-strict-movement", { enabled: true },
        (current) => ({ ...current, encounter: { ...current.encounter, strictMovement: true } }),
        undefined, undefined, false,
      );
    });
    await act(async () => { await Promise.resolve(); });
    expect(urls).toEqual([
      "/api/encounters/TEST/command",
      "/api/encounters/NEXT/command",
    ]);

    commands[1].resolve(jsonResponse({
      state: { ...nextSessionState, encounter: { ...nextSessionState.encounter, version: 2, strictMovement: true } },
    }));
    await act(async () => { await nextRequest; });
    commands[0].resolve(jsonResponse({ state: encounterState({ version: 8, status: "paused" }) }));
    await act(async () => { expect(await oldRequest).toBeNull(); });
    await act(async () => { expect(await oldQueuedRequest).toBeNull(); });
    expect(urls).toHaveLength(2);
    expect(result.current.state?.encounter).toMatchObject({ code: "NEXT", version: 2, status: "active", strictMovement: true });
  });
});

describe("battleMapApi deadlines", () => {
  it("preserves caller cancellation while composing the default deadline", async () => {
    const caller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      receivedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        receivedSignal?.addEventListener("abort", () => reject(receivedSignal?.reason), { once: true });
      });
    }));

    const request = battleMapApi("/api/test", { signal: caller.signal });
    caller.abort(new DOMException("Caller cancelled.", "AbortError"));
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(receivedSignal?.aborted).toBe(true);
  });
});
