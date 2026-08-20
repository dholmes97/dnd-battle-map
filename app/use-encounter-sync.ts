"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { flushSync } from "react-dom";
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
type PendingMove = MapPoint & { altitude: number; sequence: number; movementUsed: number; movementOrigin: MapPoint | null };
type OptimisticMutation = { apply: (state: EncounterState) => EncounterState };
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
  serializeTurnAdvance?: boolean,
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

export async function battleMapApi<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", ...(options?.headers ?? {}) },
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Request failed.");
  return data;
}

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
  const pendingMovesRef = useRef<Map<string, PendingMove>>(new Map());
  const pendingTokenIdsRef = useRef<Set<string>>(new Set());
  const pendingOptimisticRef = useRef<Map<number, OptimisticMutation>>(new Map());
  const localUndoHistoryRef = useRef<HistoryEntry[]>([]);
  const localRedoHistoryRef = useRef<HistoryEntry[]>([]);
  const moveSequenceRef = useRef(0);
  const optimisticSequenceRef = useRef(0);
  const turnAdvanceQueueRef = useRef<Promise<void>>(Promise.resolve());

  const acceptAuthoritativeState = useCallback((next: EncounterState) => {
    setState((current) => {
      if (current && next.encounter.code !== current.encounter.code) return current;
      if (current && next.encounter.version < current.encounter.version) return current;
      const pendingMoves = pendingMovesRef.current;
      const pendingOptimistic = pendingOptimisticRef.current;
      if (pendingMoves.size === 0 && pendingOptimistic.size === 0) return next;
      const tokens = next.tokens.map((token) => {
          const pending = pendingMoves.get(token.id);
          return pending ? { ...token, x: pending.x, y: pending.y, altitude: pending.altitude, movementUsed: pending.movementUsed, movementOrigin: pending.movementOrigin } : token;
        });
      let merged = {
        ...next,
        tokens,
      };
      for (const mutation of pendingOptimistic.values()) merged = mutation.apply(merged);
      return merged;
    });
  }, []);

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
      if (!disposed) { lastVersion = fresh.encounter.version; acceptAuthoritativeState(fresh); markLive(); }
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
          const response = await fetch(
            `/api/encounters/${encodeURIComponent(joinedCode)}/events?since=${lastVersion}`,
            { signal: controller.signal, cache: "no-store", headers },
          );
          if (disposed) return;
          if (response.status === 204) {
            markLive();
            const schedule = scheduleAfterPoll(unchangedPolls, false);
            unchangedPolls = schedule.unchangedPolls;
            await wait(schedule.delayMs);
            continue;
          }
          if (!response.ok) throw new Error("Live updates are unavailable.");
          const next = (await response.json()) as EncounterState;
          lastVersion = next.encounter.version;
          acceptAuthoritativeState(next);
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
    if (!participant || !state) return;
    const fresh = await battleMapApi<EncounterState>(
      `/api/encounters/${encodeURIComponent(state.encounter.code)}/state`,
      { headers: viewerHeaders(participant) },
    ).catch(() => null);
    if (fresh) acceptAuthoritativeState(fresh);
  };

  const sendCommand: SendCommand = async <T extends CommandResponse = CommandResponse, Name extends CommandName = CommandName>(
    name: Name,
    extra: CommandPayload<Name> = {} as CommandPayload<Name>,
    beforeAccept?: (result: T) => void,
  ) => {
    if (!participant || !state) throw new Error("Join the encounter first.");
    const result = await battleMapApi<T>(`/api/encounters/${encodeURIComponent(state.encounter.code)}/command`, {
      method: "POST", body: sessionPayload(participant, commandRequest(name, extra)),
    });
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
      await refreshAfterError();
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
    serializeTurnAdvance = false,
  ): Promise<T | null> => {
    const mutationId = ++optimisticSequenceRef.current;
    const applyOptimistic = (current: EncounterState) => {
      const applied = apply(current);
      return trackHistory ? {
        ...applied,
        undo: { ...applied.undo, available: Math.min(10, current.undo.available + 1), redoAvailable: 0 },
      } : applied;
    };
    pendingOptimisticRef.current.set(mutationId, { apply: applyOptimistic });
    flushSync(() => {
      setState((current) => {
        if (!current) return current;
        if (trackHistory && !localUndoHistoryRef.current.some((entry) => entry.mutationId === mutationId)) {
          localUndoHistoryRef.current = [...localUndoHistoryRef.current.slice(-9), { mutationId, state: current }];
          localRedoHistoryRef.current = [];
        }
        return applyOptimistic(current);
      });
    });
    setError("");
    try {
      const send = () => sendCommand<T, Name>(name, extra);
      let result: T;
      if (serializeTurnAdvance) {
        const queued = turnAdvanceQueueRef.current.then(send);
        turnAdvanceQueueRef.current = queued.then(() => undefined, () => undefined);
        result = await queued;
      } else {
        result = await send();
      }
      beforeAccept?.(result);
      pendingOptimisticRef.current.delete(mutationId);
      acceptAuthoritativeState(result.state);
      if (success) setNotice(success);
      return result;
    } catch (commandError) {
      pendingOptimisticRef.current.delete(mutationId);
      if (trackHistory) localUndoHistoryRef.current = localUndoHistoryRef.current.filter((entry) => entry.mutationId !== mutationId);
      setError(commandError instanceof Error ? commandError.message : "Action rejected.");
      await refreshAfterError();
      return null;
    }
  };

  const clearPendingState = () => {
    pendingMovesRef.current.clear();
    pendingTokenIdsRef.current.clear();
    pendingOptimisticRef.current.clear();
    localUndoHistoryRef.current = [];
    localRedoHistoryRef.current = [];
  };

  const startSession = (nextParticipant: ParticipantSession, nextState: EncounterState) => {
    clearPendingState();
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
    const sequence = ++moveSequenceRef.current;
    const historyMutationId = ++optimisticSequenceRef.current;
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
        pendingMovesRef.current.set(tokenId, { ...move.position, altitude: destination.altitude, sequence, movementUsed: move.movementUsed, movementOrigin: move.movementOrigin });
        localUndoHistoryRef.current = [...localUndoHistoryRef.current.slice(-9), { mutationId: historyMutationId, state: current }];
        localRedoHistoryRef.current = [];
        return {
          ...current,
          undo: { ...current.undo, available: Math.min(10, current.undo.available + 1), redoAvailable: 0 },
          tokens: current.tokens.map((token) => token.id === tokenId
            ? { ...token, ...move.position, altitude: destination.altitude, movementUsed: move.movementUsed, movementOrigin: move.movementOrigin }
            : token),
        };
      });
    });
    if (!moveContext.token) return null;
    setError("");
    try {
      const result = await battleMapApi<{ distance: number; overBudget: boolean; state: EncounterState }>(
        `/api/encounters/${encodeURIComponent(encounterCode)}/move`,
        { method: "POST", body: sessionPayload(participant, { tokenId, ...authoritativeDestination, altitude: destination.altitude }) },
      );
      if (pendingMovesRef.current.get(tokenId)?.sequence === sequence) pendingMovesRef.current.delete(tokenId);
      acceptAuthoritativeState(result.state);
      return {
        distance: result.distance,
        overBudget: result.overBudget,
        tokenName: moveContext.token.name,
        spellEffect: moveContext.token.kind === SPELL_EFFECT_KIND,
      };
    } catch (moveError) {
      if (pendingMovesRef.current.get(tokenId)?.sequence === sequence) pendingMovesRef.current.delete(tokenId);
      localUndoHistoryRef.current = localUndoHistoryRef.current.filter((entry) => entry.mutationId !== historyMutationId);
      setError(moveError instanceof Error ? moveError.message : "Move rejected.");
      await refreshAfterError();
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
