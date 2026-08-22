"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { flushSync } from "react-dom";
import {
  API_TIMEOUT_MESSAGE,
  DEFAULT_API_TIMEOUT_MS,
  battleMapApi,
  battleMapRequest,
} from "@/app/battle-map-api";
import { commandRequest } from "@/shared/command-parser";
import { transitionTokenMove } from "@/shared/encounter-transitions";
import { scheduleAfterPoll, shouldRunLiveRequests } from "@/shared/live-polling";
import type {
  CommandName,
  CommandPayload,
  CommandResponse,
  EncounterState,
  MapPoint,
  ParticipantSession,
  SharedToken,
} from "@/shared/contracts";
import { SPELL_EFFECT_KIND } from "@/shared/spell-effects";

export type ConnectionState = "connecting" | "live" | "reconnecting" | "lost";
type OptimisticMutation = { operationId: number; apply: (state: EncounterState) => EncounterState };
type HistoryEntry = { mutationId: number; state: EncounterState };
type TokenCreationCommand = "create-token" | "create-spell-effect";
export type HistoryDirection = "undo" | "redo";
export type MoveConfirmation = {
  distance: number;
  overBudget: boolean;
  tokenName: string;
  spellEffect: boolean;
};

type SendCommand = <T extends CommandResponse = CommandResponse, Name extends CommandName = CommandName>(
  name: Name,
  extra?: CommandPayload<Name>,
  beforeAccept?: (result: T) => void,
) => Promise<T>;

type RunCommand = <Name extends CommandName>(
  name: Name,
  extra?: CommandPayload<Name>,
  success?: string,
) => Promise<boolean>;

type RunOptimisticCommand = <T extends CommandResponse, Name extends CommandName = CommandName>(
  name: Name,
  extra: CommandPayload<Name>,
  apply: (current: EncounterState) => EncounterState,
  success?: string,
  beforeAccept?: (result: T) => void,
  trackHistory?: boolean,
) => Promise<T | null>;

type CreateTokenOptimistically = <T extends CommandResponse, Name extends TokenCreationCommand>(
  name: Name,
  payload: CommandPayload<Name>,
  buildToken: (temporaryId: string) => SharedToken,
  success: string,
  beforeAccept?: (result: T) => void,
) => Promise<T | null>;

export type EncounterSync = {
  participant: ParticipantSession | null;
  state: EncounterState | null;
  connection: ConnectionState;
  startSession: (participant: ParticipantSession, state: EncounterState) => void;
  clearSession: () => void;
  acceptState: (state: EncounterState) => void;
  sendCommand: SendCommand;
  runCommand: RunCommand;
  runOptimisticCommand: RunOptimisticCommand;
  createTokenOptimistically: CreateTokenOptimistically;
  removeTokenOptimistically: (token: SharedToken, success: string) => Promise<boolean>;
  moveTokenOptimistically: (tokenId: string, destination: MapPoint & { altitude: number }, encounterCode?: string) => Promise<MoveConfirmation | null>;
  isTokenPendingCreation: (tokenId: string) => boolean;
  runHistory: (direction: HistoryDirection) => Promise<boolean>;
};

const HEARTBEAT_INTERVAL_MS = 20_000;
const OPTIMISTIC_HISTORY_COMMANDS = new Set<CommandName>([
  "set-initiative", "set-initiative-group", "apply-hp", "add-effect", "remove-effect",
  "add-annotation", "remove-annotation", "create-token", "update-token",
  "create-spell-effect", "resize-spell-effect",
]);

export function sessionPayload(participant: ParticipantSession, extra: object = {}) {
  return JSON.stringify({
    participantId: participant.id,
    sessionSecret: participant.sessionSecret,
    ...extra,
  });
}

export function viewerHeaders(participant: ParticipantSession) {
  return {
    "x-participant-id": participant.id,
    "x-session-secret": participant.sessionSecret,
  };
}

type UseEncounterSyncInput = {
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
};

export function useEncounterSync({ setError, setNotice }: UseEncounterSyncInput): EncounterSync {
  const [participant, setParticipant] = useState<ParticipantSession | null>(null);
  const [state, setState] = useState<EncounterState | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authoritativeStateRef = useRef<EncounterState | null>(null);
  const pendingTokenIdsRef = useRef<Set<string>>(new Set());
  const pendingOptimisticRef = useRef<Map<number, OptimisticMutation>>(new Map());
  const localUndoHistoryRef = useRef<HistoryEntry[]>([]);
  const localRedoHistoryRef = useRef<HistoryEntry[]>([]);
  const optimisticSequenceRef = useRef(0);
  const sessionGenerationRef = useRef(0);
  const optimisticRequestQueueRef = useRef<Promise<void>>(Promise.resolve());

  const projectPendingOperations = useCallback((authoritative: EncounterState) => {
    let projected = authoritative;
    const operations = [...pendingOptimisticRef.current.values()]
      .sort((left, right) => left.operationId - right.operationId);
    for (const operation of operations) projected = operation.apply(projected);
    return projected;
  }, []);

  const repaintFromAuthoritative = useCallback((synchronous = false) => {
    const paint = () => setState((current) => {
      const authoritative = authoritativeStateRef.current;
      if (!authoritative) return current;
      return projectPendingOperations(authoritative);
    });
    if (synchronous) flushSync(paint);
    else paint();
  }, [projectPendingOperations]);

  const acceptAuthoritativeState = useCallback((next: EncounterState) => {
    if (!isEncounterState(next)) {
      throw new Error("The server returned an invalid encounter state. Refresh and try again.");
    }
    const current = authoritativeStateRef.current;
    if (current && next.encounter.code !== current.encounter.code) return;
    if (!current || next.encounter.version >= current.encounter.version) {
      authoritativeStateRef.current = next;
    }
    // Reproject even when the response is stale: its operation may just have
    // settled, so removing that reducer must still change the visible state.
    repaintFromAuthoritative();
  }, [repaintFromAuthoritative]);

  const joinedCode = state?.encounter.code;

  useEffect(() => {
    if (!participant || !joinedCode) return;
    let disposed = false;
    let controller: AbortController | null = null;
    let delayTimer: ReturnType<typeof setTimeout> | null = null;
    let wakeDelay: (() => void) | null = null;
    let wakeVisible: (() => void) | null = null;
    let refreshOnResume = false;
    let lastVersion = state?.encounter.version ?? 0;
    const headers = viewerHeaders(participant);
    const markLive = () => {
      if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
      if (navigator.onLine) setConnection("live");
    };
    const scheduleLost = () => {
      setConnection((current) => current === "lost" ? "lost" : "reconnecting");
      if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = setTimeout(() => { if (!disposed) setConnection("lost"); }, 8_000);
    };
    const refresh = async () => {
      const fresh = await battleMapApi<EncounterState>(`/api/encounters/${encodeURIComponent(joinedCode)}/state`, { headers });
      if (!disposed) { acceptAuthoritativeState(fresh); lastVersion = fresh.encounter.version; markLive(); }
    };
    const wait = (milliseconds: number) => new Promise<void>((resolve) => {
      wakeDelay = () => {
        if (delayTimer) clearTimeout(delayTimer);
        delayTimer = null;
        wakeDelay = null;
        resolve();
      };
      delayTimer = setTimeout(() => wakeDelay?.(), milliseconds);
    });
    const waitUntilVisible = () => new Promise<void>((resolve) => {
      if (shouldRunLiveRequests(document.visibilityState)) { resolve(); return; }
      wakeVisible = () => { wakeVisible = null; resolve(); };
    });
    const wakeForForeground = () => {
      if (!shouldRunLiveRequests(document.visibilityState)) return;
      refreshOnResume = true;
      controller?.abort();
      wakeDelay?.();
      wakeVisible?.();
    };
    const onVisibilityChange = () => {
      if (shouldRunLiveRequests(document.visibilityState)) wakeForForeground();
      else { controller?.abort(); wakeDelay?.(); }
    };
    const listen = async () => {
      if (shouldRunLiveRequests(document.visibilityState)) {
        try { await refresh(); } catch { scheduleLost(); }
      }
      let unchangedPolls = 0;
      while (!disposed) {
        if (!shouldRunLiveRequests(document.visibilityState)) {
          await waitUntilVisible();
          if (disposed) return;
          refreshOnResume = true;
        }
        if (refreshOnResume) {
          refreshOnResume = false;
          unchangedPolls = 0;
          try { await refresh(); } catch { scheduleLost(); await wait(750); continue; }
        }
        controller = new AbortController();
        try {
          const received = await battleMapRequest(
            `/api/encounters/${encodeURIComponent(joinedCode)}/events?since=${lastVersion}`,
            { signal: controller.signal, cache: "no-store", headers },
            async (response) => ({
              ok: response.ok,
              status: response.status,
              state: response.status === 204 ? null : await response.json() as EncounterState,
            }),
          );
          if (disposed) return;
          if (received.status === 204) {
            markLive();
            const schedule = scheduleAfterPoll(unchangedPolls, false);
            unchangedPolls = schedule.unchangedPolls;
            await wait(schedule.delayMs);
            continue;
          }
          if (!received.ok || !received.state) throw new Error("Live updates are unavailable.");
          const next = received.state;
          acceptAuthoritativeState(next);
          lastVersion = next.encounter.version;
          markLive();
          const schedule = scheduleAfterPoll(unchangedPolls, true);
          unchangedPolls = schedule.unchangedPolls;
          await wait(schedule.delayMs);
        } catch {
          if (disposed) return;
          if (controller.signal.aborted) continue;
          scheduleLost();
          await wait(750);
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", wakeForForeground);
    void listen();
    return () => {
      disposed = true;
      controller?.abort();
      wakeDelay?.();
      wakeVisible?.();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", wakeForForeground);
      if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
    };
    // The participant identity and encounter code own the long-poll lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptAuthoritativeState, joinedCode, participant?.id]);

  useEffect(() => {
    if (!participant || !joinedCode) return;
    const heartbeat = () => {
      if (!shouldRunLiveRequests(document.visibilityState)) return Promise.resolve();
      return battleMapApi<{ present: boolean }>(
        `/api/encounters/${encodeURIComponent(joinedCode)}/heartbeat`,
        { method: "POST", body: sessionPayload(participant) },
      ).then(() => undefined).catch(() => setConnection((current) => current === "lost" ? "lost" : "reconnecting"));
    };
    const onVisible = () => { if (shouldRunLiveRequests(document.visibilityState)) void heartbeat(); };
    void heartbeat();
    const timer = setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [joinedCode, participant]);

  const refreshAfterError = async () => {
    const authoritative = authoritativeStateRef.current;
    if (!participant || !authoritative) return;
    const fresh = await battleMapApi<EncounterState>(
      `/api/encounters/${encodeURIComponent(authoritative.encounter.code)}/state`,
      { headers: viewerHeaders(participant) },
    ).catch(() => null);
    if (fresh) acceptAuthoritativeState(fresh);
  };

  const requestCommandFor = async <T extends CommandResponse = CommandResponse, Name extends CommandName = CommandName>(
    targetParticipant: ParticipantSession,
    encounterCode: string,
    name: Name,
    extra: CommandPayload<Name> = {} as CommandPayload<Name>,
    timeoutMs = DEFAULT_API_TIMEOUT_MS,
  ) => battleMapApi<T>(`/api/encounters/${encodeURIComponent(encounterCode)}/command`, {
    method: "POST", body: sessionPayload(targetParticipant, commandRequest(name, extra)), timeoutMs,
  });

  const requestCommand = async <T extends CommandResponse = CommandResponse, Name extends CommandName = CommandName>(
    name: Name,
    extra: CommandPayload<Name> = {} as CommandPayload<Name>,
  ) => {
    const authoritative = authoritativeStateRef.current;
    if (!participant || !authoritative) throw new Error("Join the encounter first.");
    return requestCommandFor<T, Name>(participant, authoritative.encounter.code, name, extra);
  };

  const enqueueOptimisticRequest = <T,>(send: (timeoutMs: number) => Promise<T>) => {
    const deadline = Date.now() + DEFAULT_API_TIMEOUT_MS;
    const queued = optimisticRequestQueueRef.current.then(() => {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new Error(API_TIMEOUT_MESSAGE);
      return send(remainingMs);
    });
    optimisticRequestQueueRef.current = queued.then(() => undefined, () => undefined);
    return queued;
  };

  const sendCommand: SendCommand = async <T extends CommandResponse = CommandResponse, Name extends CommandName = CommandName>(
    name: Name,
    extra: CommandPayload<Name> = {} as CommandPayload<Name>,
    beforeAccept?: (result: T) => void,
  ) => {
    const result = await requestCommand<T, Name>(name, extra);
    beforeAccept?.(result);
    acceptAuthoritativeState(result.state);
    return result;
  };

  const runCommand = async <Name extends CommandName>(
    name: Name,
    extra: CommandPayload<Name> = {} as CommandPayload<Name>,
    success?: string,
  ) => {
    setError("");
    try {
      await sendCommand(name, extra);
      if (success) setNotice(success);
      return true;
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : "Action rejected.");
      void refreshAfterError();
      return false;
    }
  };

  const runOptimisticCommand = async <T extends CommandResponse, Name extends CommandName = CommandName>(
    name: Name,
    extra: CommandPayload<Name>,
    apply: (current: EncounterState) => EncounterState,
    success?: string,
    beforeAccept?: (result: T) => void,
    trackHistory = OPTIMISTIC_HISTORY_COMMANDS.has(name),
  ): Promise<T | null> => {
    const mutationId = ++optimisticSequenceRef.current;
    const operationGeneration = sessionGenerationRef.current;
    const operationParticipant = participant;
    const operationEncounterCode = authoritativeStateRef.current?.encounter.code;
    const applyOptimistic = (current: EncounterState) => {
      const applied = apply(current);
      return trackHistory ? {
        ...applied,
        undo: { ...applied.undo, available: Math.min(10, current.undo.available + 1), redoAvailable: 0 },
      } : applied;
    };
    pendingOptimisticRef.current.set(mutationId, { operationId: mutationId, apply: applyOptimistic });
    flushSync(() => {
      setState((current) => {
        if (!current) return current;
        if (trackHistory && !localUndoHistoryRef.current.some((entry) => entry.mutationId === mutationId)) {
          localUndoHistoryRef.current = [...localUndoHistoryRef.current.slice(-9), { mutationId, state: current }];
          localRedoHistoryRef.current = [];
        }
        const authoritative = authoritativeStateRef.current;
        return authoritative ? projectPendingOperations(authoritative) : applyOptimistic(current);
      });
    });
    setError("");
    let result: T;
    try {
      result = await enqueueOptimisticRequest((timeoutMs) => {
        if (operationGeneration !== sessionGenerationRef.current) throw new Error("The operation was cancelled after leaving the scenario.");
        if (!operationParticipant || !operationEncounterCode) throw new Error("Join the encounter first.");
        return requestCommandFor<T, Name>(operationParticipant, operationEncounterCode, name, extra, timeoutMs);
      });
      if (operationGeneration !== sessionGenerationRef.current) return null;
      pendingOptimisticRef.current.delete(mutationId);
      acceptAuthoritativeState(result.state);
    } catch (commandError) {
      if (operationGeneration !== sessionGenerationRef.current) return null;
      pendingOptimisticRef.current.delete(mutationId);
      if (trackHistory) {
        // A later snapshot may include the rejected reducer. Drop it and every
        // dependent local snapshot; durable server history remains available.
        localUndoHistoryRef.current = localUndoHistoryRef.current.filter((entry) => entry.mutationId < mutationId);
        localRedoHistoryRef.current = [];
      }
      repaintFromAuthoritative(true);
      setError(commandError instanceof Error ? commandError.message : "Action rejected.");
      void refreshAfterError();
      return null;
    }
    try {
      beforeAccept?.(result);
    } catch (followUpError) {
      setError(followUpError instanceof Error ? followUpError.message : "The action completed, but its local follow-up failed.");
    }
    if (success) setNotice(success);
    return result;
  };

  const clearPendingState = () => {
    sessionGenerationRef.current += 1;
    authoritativeStateRef.current = null;
    pendingTokenIdsRef.current.clear();
    pendingOptimisticRef.current.clear();
    localUndoHistoryRef.current = [];
    localRedoHistoryRef.current = [];
    optimisticRequestQueueRef.current = Promise.resolve();
  };

  const startSession = (nextParticipant: ParticipantSession, nextState: EncounterState) => {
    clearPendingState();
    authoritativeStateRef.current = nextState;
    setParticipant(nextParticipant);
    setState(nextState);
    setConnection("connecting");
  };

  const clearSession = () => {
    clearPendingState();
    setParticipant(null);
    setState(null);
    setConnection("connecting");
  };

  const createTokenOptimistically: CreateTokenOptimistically = async (name, payload, buildToken, success, beforeAccept) => {
    const temporaryId = `pending-create-${crypto.randomUUID()}`;
    const optimisticToken = buildToken(temporaryId);
    pendingTokenIdsRef.current.add(temporaryId);
    try {
      return await runOptimisticCommand(
        name,
        payload,
        (current) => ({ ...current, tokens: [...current.tokens, optimisticToken] }),
        success,
        beforeAccept,
      );
    } finally {
      pendingTokenIdsRef.current.delete(temporaryId);
    }
  };

  const removeTokenOptimistically = async (token: SharedToken, success: string) => Boolean(await runOptimisticCommand(
    "delete-token",
    { tokenId: token.id },
    (current) => ({ ...current, tokens: current.tokens.filter((candidate) => candidate.id !== token.id) }),
    success,
    undefined,
    token.kind === SPELL_EFFECT_KIND,
  ));

  const moveTokenOptimistically = async (
    tokenId: string,
    destination: MapPoint & { altitude: number },
    encounterCode = state?.encounter.code,
  ): Promise<MoveConfirmation | null> => {
    if (!participant || !encounterCode) return null;
    const operationId = ++optimisticSequenceRef.current;
    const operationGeneration = sessionGenerationRef.current;
    let authoritativeDestination: MapPoint & { altitude: number } = destination;
    const moveContext: { token: SharedToken | null } = { token: null };
    flushSync(() => {
      setState((current) => {
        if (!current) return current;
        moveContext.token = current.tokens.find((token) => token.id === tokenId) ?? null;
        if (!moveContext.token) return current;
        const move = transitionTokenMove({
          previous: moveContext.token,
          destination,
          previousMovementOrigin: moveContext.token.movementOrigin,
          previousMovementUsed: moveContext.token.movementUsed,
          size: moveContext.token.size,
          grid: current.grid,
          speed: moveContext.token.speed,
          encounterStatus: current.encounter.status,
          isSpellEffect: moveContext.token.kind === SPELL_EFFECT_KIND,
        });
        authoritativeDestination = { ...move.position, altitude: destination.altitude };
        pendingOptimisticRef.current.set(operationId, {
          operationId,
          apply: (projected) => ({
            ...projected,
            undo: { ...projected.undo, available: Math.min(10, projected.undo.available + 1), redoAvailable: 0 },
            tokens: projected.tokens.map((token) => token.id === tokenId
              ? { ...token, ...move.position, altitude: destination.altitude, movementUsed: move.movementUsed, movementOrigin: move.movementOrigin }
              : token),
          }),
        });
        localUndoHistoryRef.current = [...localUndoHistoryRef.current.slice(-9), { mutationId: operationId, state: current }];
        localRedoHistoryRef.current = [];
        const authoritative = authoritativeStateRef.current;
        return authoritative ? projectPendingOperations(authoritative) : current;
      });
    });
    if (!moveContext.token) return null;
    setError("");
    try {
      const result = await enqueueOptimisticRequest((timeoutMs) => {
        if (operationGeneration !== sessionGenerationRef.current) throw new Error("The operation was cancelled after leaving the scenario.");
        return battleMapApi<{ distance: number; overBudget: boolean; state: EncounterState }>(
            `/api/encounters/${encodeURIComponent(encounterCode)}/move`,
            { method: "POST", body: sessionPayload(participant, { tokenId, ...authoritativeDestination, altitude: destination.altitude }), timeoutMs },
          );
      });
      if (operationGeneration !== sessionGenerationRef.current) return null;
      pendingOptimisticRef.current.delete(operationId);
      acceptAuthoritativeState(result.state);
      return {
        distance: result.distance,
        overBudget: result.overBudget,
        tokenName: moveContext.token.name,
        spellEffect: moveContext.token.kind === SPELL_EFFECT_KIND,
      };
    } catch (moveError) {
      if (operationGeneration !== sessionGenerationRef.current) return null;
      pendingOptimisticRef.current.delete(operationId);
      localUndoHistoryRef.current = localUndoHistoryRef.current.filter((entry) => entry.mutationId < operationId);
      localRedoHistoryRef.current = [];
      repaintFromAuthoritative(true);
      setError(moveError instanceof Error ? moveError.message : "Move rejected.");
      void refreshAfterError();
      return null;
    }
  };

  const runHistory = async (direction: HistoryDirection) => {
    const currentState = state;
    const history = direction === "undo" ? localUndoHistoryRef : localRedoHistoryRef;
    const inverseHistory = direction === "undo" ? localRedoHistoryRef : localUndoHistoryRef;
    const entry = history.current.at(-1);
    if (!entry || !currentState) return runCommand(direction);
    history.current = history.current.slice(0, -1);
    const inverseEntry = { mutationId: ++optimisticSequenceRef.current, state: currentState };
    inverseHistory.current = [...inverseHistory.current.slice(-9), inverseEntry];
    const result = await runOptimisticCommand(
      direction,
      {},
      () => ({
        ...entry.state,
        undo: {
          ...entry.state.undo,
          available: direction === "undo" ? Math.max(0, currentState.undo.available - 1) : Math.min(10, currentState.undo.available + 1),
          redoAvailable: direction === "undo" ? Math.min(10, currentState.undo.redoAvailable + 1) : Math.max(0, currentState.undo.redoAvailable - 1),
        },
      }),
      undefined,
      undefined,
      false,
    );
    if (result) return true;
    inverseHistory.current = inverseHistory.current.filter((item) => item.mutationId !== inverseEntry.mutationId);
    history.current = [...history.current, entry];
    return false;
  };

  return {
    participant,
    state,
    connection,
    startSession,
    clearSession,
    acceptState: acceptAuthoritativeState,
    sendCommand,
    runCommand,
    runOptimisticCommand,
    createTokenOptimistically,
    removeTokenOptimistically,
    moveTokenOptimistically,
    isTokenPendingCreation: (tokenId) => pendingTokenIdsRef.current.has(tokenId),
    runHistory,
  };
}

function isEncounterState(value: unknown): value is EncounterState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<EncounterState>;
  return Boolean(
    candidate.encounter &&
    typeof candidate.encounter.code === "string" &&
    Number.isFinite(candidate.encounter.version) &&
    Array.isArray(candidate.tokens) &&
    Array.isArray(candidate.annotations) &&
    Array.isArray(candidate.chatMessages) &&
    Array.isArray(candidate.handouts),
  );
}
