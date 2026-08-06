"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type ConnectionState = "connecting" | "live" | "reconnecting" | "lost";

type EncounterState = {
  encounter: {
    code: string;
    name: string;
    version: number;
    updatedAt: number;
  };
  grid: { width: number; height: number; feetPerCell: number };
  token: {
    id: string;
    name: string;
    x: number;
    y: number;
    lock: null | {
      ownerId: string;
      ownerName: string;
      expiresAt: number;
    };
  };
};

type Participant = { id: string; name: string; sessionSecret: string };
type MapPoint = { x: number; y: number };
type DragGesture = {
  pointerId: number;
  origin: MapPoint;
  latest: MapPoint;
  grabOffset: MapPoint;
  released: boolean;
  canceled: boolean;
  finishing: boolean;
  lockState: EncounterState | null;
};

const DEFAULT_CODE = "EMBER-KEEP";
const TERRAIN_URL = "/assets/terrain/terrain-dungeon-flagstone-01.png";
const TOKEN_RADIUS_CELLS = 0.36;

function roundCoordinate(value: number) {
  return Math.round(value * 1_000) / 1_000;
}

function formatPosition(point: MapPoint) {
  return `${point.x.toFixed(2)}, ${point.y.toFixed(2)}`;
}

function clampMapPoint(state: EncounterState, point: MapPoint): MapPoint {
  return {
    x: roundCoordinate(
      Math.min(
        state.grid.width - TOKEN_RADIUS_CELLS,
        Math.max(TOKEN_RADIUS_CELLS, point.x),
      ),
    ),
    y: roundCoordinate(
      Math.min(
        state.grid.height - TOKEN_RADIUS_CELLS,
        Math.max(TOKEN_RADIUS_CELLS, point.y),
      ),
    ),
  };
}

function pointerToMap(
  canvas: HTMLCanvasElement,
  state: EncounterState,
  clientX: number,
  clientY: number,
): MapPoint {
  const rect = canvas.getBoundingClientRect();
  return clampMapPoint(state, {
    x: ((clientX - rect.left) / rect.width) * state.grid.width,
    y: ((clientY - rect.top) / rect.height) * state.grid.height,
  });
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options?.headers ?? {}),
    },
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Request failed.");
  return data;
}

function postBody(participant: Participant, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    participantId: participant.id,
    sessionSecret: participant.sessionSecret,
    ...extra,
  });
}

function drawMap(
  canvas: HTMLCanvasElement,
  state: EncounterState,
  preview: MapPoint | null,
  participant: Participant,
  terrain: HTMLImageElement | null,
) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);

  const cellWidth = rect.width / state.grid.width;
  const cellHeight = rect.height / state.grid.height;
  const pattern = terrain ? context.createPattern(terrain, "repeat") : null;
  if (pattern) {
    const scale = Math.max(0.18, Math.min(0.32, cellWidth / 190));
    pattern.setTransform(new DOMMatrix().scale(scale));
    context.fillStyle = pattern;
    context.fillRect(0, 0, rect.width, rect.height);
    context.fillStyle = "rgba(20, 23, 21, 0.17)";
    context.fillRect(0, 0, rect.width, rect.height);
  } else {
    context.fillStyle = "#4b4b42";
    context.fillRect(0, 0, rect.width, rect.height);
  }

  context.strokeStyle = "rgba(232, 220, 190, 0.17)";
  context.lineWidth = 1;
  for (let x = 0; x <= state.grid.width; x += 1) {
    context.beginPath();
    context.moveTo(x * cellWidth, 0);
    context.lineTo(x * cellWidth, rect.height);
    context.stroke();
  }
  for (let y = 0; y <= state.grid.height; y += 1) {
    context.beginPath();
    context.moveTo(0, y * cellHeight);
    context.lineTo(rect.width, y * cellHeight);
    context.stroke();
  }

  const ownsLock = state.token.lock?.ownerId === participant.id;
  const lockedByOther = Boolean(
    state.token.lock && state.token.lock.ownerId !== participant.id,
  );
  if (preview && !lockedByOther) {
    const startX = state.token.x * cellWidth;
    const startY = state.token.y * cellHeight;
    const endX = preview.x * cellWidth;
    const endY = preview.y * cellHeight;
    context.strokeStyle = "rgba(245, 198, 92, 0.9)";
    context.lineWidth = 3;
    context.setLineDash([7, 6]);
    context.beginPath();
    context.moveTo(startX, startY);
    context.lineTo(endX, endY);
    context.stroke();
    context.setLineDash([]);
  }

  const displayedPosition = preview && !lockedByOther ? preview : state.token;
  const tokenX = displayedPosition.x * cellWidth;
  const tokenY = displayedPosition.y * cellHeight;
  const radius = Math.min(cellWidth, cellHeight) * TOKEN_RADIUS_CELLS;

  context.save();
  if (lockedByOther) context.globalAlpha = 0.58;
  context.shadowColor = "rgba(0, 0, 0, 0.45)";
  context.shadowBlur = 12;
  context.fillStyle = ownsLock || preview ? "#f5c65c" : "#c97546";
  context.beginPath();
  context.arc(tokenX, tokenY, radius, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;
  context.strokeStyle = ownsLock ? "#fff1ba" : "#f0d0a0";
  context.lineWidth = Math.max(2, radius * 0.12);
  context.stroke();
  context.fillStyle = "#261d18";
  context.font = `700 ${Math.max(12, radius * 0.88)}px ui-sans-serif, system-ui`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("W", tokenX, tokenY + 1);
  context.restore();
}

export default function BattleMapPrototype() {
  const [displayName, setDisplayName] = useState("");
  const [encounterCode, setEncounterCode] = useState(DEFAULT_CODE);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [state, setState] = useState<EncounterState | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [preview, setPreview] = useState<MapPoint | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [terrain, setTerrain] = useState<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousLockRef = useRef<EncounterState["token"]["lock"]>(null);
  const dragGestureRef = useRef<DragGesture | null>(null);

  const normalizedCode = encounterCode.trim().toUpperCase() || DEFAULT_CODE;
  const joinedEncounterCode = state?.encounter.code;
  const activeLock = state?.token.lock ?? null;
  const ownsLock = Boolean(
    participant && activeLock?.ownerId === participant.id,
  );
  const lockedByOther = Boolean(activeLock && !ownsLock);
  const movementEnabled = connection === "live" && !busy;
  const remainingSeconds = activeLock
    ? Math.max(0, Math.ceil((activeLock.expiresAt - now) / 1000))
    : 0;

  const distance = useMemo(() => {
    if (!state || !preview) return 0;
    return Number((
      Math.max(
        Math.abs(preview.x - state.token.x),
        Math.abs(preview.y - state.token.y),
      ) * state.grid.feetPerCell
    ).toFixed(1));
  }, [preview, state]);
  const isNoOpPreview = Boolean(
    state &&
      preview &&
      Math.hypot(preview.x - state.token.x, preview.y - state.token.y) < 0.001,
  );

  const join = async () => {
    const name = displayName.trim();
    if (!name) {
      setError("Enter a display name to join the encounter.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api<{
        participantId: string;
        sessionSecret: string;
        state: EncounterState;
      }>(
        `/api/encounters/${encodeURIComponent(normalizedCode)}/join`,
        {
          method: "POST",
          body: JSON.stringify({ participantName: name }),
        },
      );
      setParticipant({
        id: result.participantId,
        name,
        sessionSecret: result.sessionSecret,
      });
      setState(result.state);
      setEncounterCode(result.state.encounter.code);
      setConnection("connecting");
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Unable to join.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!participant || !joinedEncounterCode) return;
    let disposed = false;
    let controller: AbortController | null = null;
    let lastVersion = state?.encounter.version ?? 0;

    const refresh = async () => {
      try {
        const fresh = await api<EncounterState>(
          `/api/encounters/${encodeURIComponent(joinedEncounterCode)}/state`,
        );
        if (!disposed) {
          setState(fresh);
          setConnection("live");
        }
      } catch {
        // The polling loop will keep retrying; movement remains disabled meanwhile.
      }
    };

    const scheduleLost = () => {
      setConnection((current) =>
        current === "lost" ? "lost" : "reconnecting",
      );
      if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = setTimeout(() => {
        if (!disposed) setConnection("lost");
      }, 8_000);
    };

    const markLive = () => {
      if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
      if (navigator.onLine) setConnection("live");
    };

    const listen = async () => {
      await refresh();
      while (!disposed) {
        controller = new AbortController();
        try {
          const response = await fetch(
            `/api/encounters/${encodeURIComponent(joinedEncounterCode)}/events?since=${lastVersion}`,
            { signal: controller.signal, cache: "no-store" },
          );
          if (disposed) return;
          if (response.status === 204) {
            markLive();
            await new Promise((resolve) => setTimeout(resolve, 250));
            continue;
          }
          if (!response.ok) throw new Error("Live updates are unavailable.");
          const next = (await response.json()) as EncounterState;
          lastVersion = next.encounter.version;
          setState(next);
          markLive();
          await new Promise((resolve) => setTimeout(resolve, 250));
        } catch (listenError) {
          if (
            disposed ||
            (listenError instanceof DOMException &&
              listenError.name === "AbortError")
          ) {
            return;
          }
          scheduleLost();
          await new Promise((resolve) => setTimeout(resolve, 750));
        }
      }
    };

    void listen();

    return () => {
      disposed = true;
      controller?.abort();
      if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
    };
    // Keep one authoritative conditional-poll loop per participant and encounter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participant?.id, joinedEncounterCode]);

  useEffect(() => {
    if (!participant || !joinedEncounterCode) return;

    const scheduleLost = () => {
      setConnection("reconnecting");
      if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = setTimeout(() => setConnection("lost"), 8_000);
    };
    const handleOnline = async () => {
      setConnection("reconnecting");
      try {
        const fresh = await api<EncounterState>(
          `/api/encounters/${encodeURIComponent(joinedEncounterCode)}/state`,
        );
        setState(fresh);
        if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
        setConnection("live");
      } catch {
        scheduleLost();
      }
    };

    window.addEventListener("offline", scheduleLost);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", scheduleLost);
      window.removeEventListener("online", handleOnline);
    };
  }, [joinedEncounterCode, participant]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const previousLock = previousLockRef.current;
    const currentLock = state?.token.lock ?? null;
    if (
      previousLock &&
      !currentLock &&
      previousLock.expiresAt <= Date.now() + 1_000
    ) {
      setPreview(null);
      setNotice("Lock ended — the token is available again.");
    }
    previousLockRef.current = currentLock;
  }, [state?.token.lock]);

  useEffect(() => {
    const image = new Image();
    let disposed = false;
    image.onload = () => {
      if (!disposed) setTerrain(image);
    };
    image.src = TERRAIN_URL;
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3_400);
    return () => clearTimeout(timer);
  }, [notice]);

  const redraw = useCallback(() => {
    if (canvasRef.current && state && participant) {
      drawMap(canvasRef.current, state, preview, participant, terrain);
    }
  }, [participant, preview, state, terrain]);

  useEffect(() => {
    redraw();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [redraw]);

  const acquireLock = async () => {
    if (!participant || !state || !movementEnabled || lockedByOther) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ acquired: boolean; state: EncounterState }>(
        `/api/encounters/${encodeURIComponent(state.encounter.code)}/lock`,
        { method: "POST", body: postBody(participant) },
      );
      setState(result.state);
      if (result.acquired) {
        setPreview({ x: result.state.token.x, y: result.state.token.y });
        setNotice("Token locked. Drag it or use the arrow keys.");
      }
    } catch (lockError) {
      setError(lockError instanceof Error ? lockError.message : "Lock unavailable.");
      const fresh = await api<EncounterState>(
        `/api/encounters/${encodeURIComponent(state.encounter.code)}/state`,
      ).catch(() => null);
      if (fresh) setState(fresh);
    } finally {
      setBusy(false);
    }
  };

  const cancelMove = async () => {
    if (!participant || !state) return;
    setPreview(null);
    setBusy(true);
    try {
      const result = await api<{ state: EncounterState }>(
        `/api/encounters/${encodeURIComponent(state.encounter.code)}/unlock`,
        { method: "POST", body: postBody(participant) },
      );
      setState(result.state);
      setNotice("Move cancelled. Token released.");
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Unable to release token.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!participant || !state || !ownsLock) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void cancelMove();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // cancelMove intentionally uses the latest render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownsLock, participant, state?.encounter.code]);

  const publishMove = async (
    destination: MapPoint,
    encounterCode = state?.encounter.code,
  ) => {
    if (!participant || !encounterCode) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ moved: boolean; state: EncounterState }>(
        `/api/encounters/${encodeURIComponent(encounterCode)}/move`,
        {
          method: "POST",
          body: postBody(participant, destination),
        },
      );
      setState(result.state);
      setPreview(null);
      setNotice(`Move confirmed at ${formatPosition(destination)}.`);
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "Move rejected.");
      setPreview(null);
      const fresh = await api<EncounterState>(
        `/api/encounters/${encodeURIComponent(encounterCode)}/state`,
      ).catch(() => null);
      if (fresh) setState(fresh);
    } finally {
      setBusy(false);
    }
  };

  const confirmMove = async () => {
    if (!preview || !ownsLock || !movementEnabled) return;
    await publishMove(preview);
  };

  const releaseGestureLock = async (
    gesture: DragGesture,
    message?: string,
  ) => {
    if (!participant || !gesture.lockState) {
      setBusy(false);
      return;
    }
    try {
      const result = await api<{ state: EncounterState }>(
        `/api/encounters/${encodeURIComponent(gesture.lockState.encounter.code)}/unlock`,
        { method: "POST", body: postBody(participant) },
      );
      setState(result.state);
      if (message) setNotice(message);
    } catch (releaseError) {
      setError(
        releaseError instanceof Error
          ? releaseError.message
          : "Unable to release token.",
      );
    } finally {
      setPreview(null);
      setBusy(false);
    }
  };

  const finishDrag = async (gesture: DragGesture) => {
    if (gesture.finishing || !gesture.lockState) return;
    gesture.finishing = true;
    dragGestureRef.current = null;
    setDragging(false);
    if (
      Math.hypot(
        gesture.latest.x - gesture.origin.x,
        gesture.latest.y - gesture.origin.y,
      ) < 0.001
    ) {
      await releaseGestureLock(gesture, "Token released without moving.");
      return;
    }
    await publishMove(gesture.latest, gesture.lockState.encounter.code);
  };

  const acquireLockForDrag = async (gesture: DragGesture) => {
    if (!participant || !state) return;
    try {
      const result = await api<{ acquired: boolean; state: EncounterState }>(
        `/api/encounters/${encodeURIComponent(state.encounter.code)}/lock`,
        { method: "POST", body: postBody(participant) },
      );
      setState(result.state);
      if (!result.acquired) throw new Error("Token lock is unavailable.");
      gesture.lockState = result.state;
      if (gesture.canceled) {
        await releaseGestureLock(gesture);
      } else if (gesture.released) {
        await finishDrag(gesture);
      } else {
        setBusy(false);
      }
    } catch (lockError) {
      if (!gesture.canceled) {
        setError(
          lockError instanceof Error ? lockError.message : "Lock unavailable.",
        );
      }
      if (dragGestureRef.current === gesture) dragGestureRef.current = null;
      setPreview(null);
      setDragging(false);
      setBusy(false);
      const fresh = await api<EncounterState>(
        `/api/encounters/${encodeURIComponent(state.encounter.code)}/state`,
      ).catch(() => null);
      if (fresh) setState(fresh);
    }
  };

  const dragDestination = (
    canvas: HTMLCanvasElement,
    gesture: DragGesture,
    clientX: number,
    clientY: number,
  ) => {
    if (!state) return gesture.latest;
    const pointer = pointerToMap(canvas, state, clientX, clientY);
    return clampMapPoint(state, {
      x: pointer.x - gesture.grabOffset.x,
      y: pointer.y - gesture.grabOffset.y,
    });
  };

  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (
      !state ||
      !participant ||
      !movementEnabled ||
      lockedByOther ||
      dragGestureRef.current
    ) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const pointer = pointerToMap(
      event.currentTarget,
      state,
      event.clientX,
      event.clientY,
    );
    const displayedPosition = ownsLock && preview ? preview : state.token;
    const deltaX =
      ((pointer.x - displayedPosition.x) / state.grid.width) * rect.width;
    const deltaY =
      ((pointer.y - displayedPosition.y) / state.grid.height) * rect.height;
    const radius =
      Math.min(rect.width / state.grid.width, rect.height / state.grid.height) *
      TOKEN_RADIUS_CELLS;
    if (Math.hypot(deltaX, deltaY) > radius) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const gesture: DragGesture = {
      pointerId: event.pointerId,
      origin: { x: state.token.x, y: state.token.y },
      latest: { ...displayedPosition },
      grabOffset: {
        x: pointer.x - displayedPosition.x,
        y: pointer.y - displayedPosition.y,
      },
      released: false,
      canceled: false,
      finishing: false,
      lockState: ownsLock ? state : null,
    };
    dragGestureRef.current = gesture;
    setDragging(true);
    setPreview(displayedPosition);
    setBusy(true);
    setError("");
    if (gesture.lockState) {
      setBusy(false);
    } else {
      void acquireLockForDrag(gesture);
    }
  };

  const onCanvasPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const gesture = dragGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    gesture.latest = dragDestination(
      event.currentTarget,
      gesture,
      event.clientX,
      event.clientY,
    );
    setPreview(gesture.latest);
  };

  const onCanvasPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const gesture = dragGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    gesture.latest = dragDestination(
      event.currentTarget,
      gesture,
      event.clientX,
      event.clientY,
    );
    gesture.released = true;
    setPreview(gesture.latest);
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (gesture.lockState) void finishDrag(gesture);
  };

  const onCanvasPointerCancel = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const gesture = dragGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gesture.canceled = true;
    dragGestureRef.current = null;
    setPreview(null);
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (gesture.lockState) {
      void releaseGestureLock(gesture);
    }
  };

  const onCanvasKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (!state || !participant || !movementEnabled || lockedByOther) return;
    if (!ownsLock) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void acquireLock();
      }
      return;
    }

    const origin = preview ?? { x: state.token.x, y: state.token.y };
    const deltas: Record<string, MapPoint> = {
      ArrowLeft: { x: -0.25, y: 0 },
      ArrowRight: { x: 0.25, y: 0 },
      ArrowUp: { x: 0, y: -0.25 },
      ArrowDown: { x: 0, y: 0.25 },
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    setPreview(
      clampMapPoint(state, {
        x: origin.x + delta.x,
        y: origin.y + delta.y,
      }),
    );
  };

  if (!participant || !state) {
    return (
      <main className="join-shell">
        <section className="join-card" aria-labelledby="join-title">
          <div className="eyebrow">Phase one · Live movement proof</div>
          <h1 id="join-title">Enter the Ember Keep</h1>
          <p>
            Join the same encounter in two browser windows to test shared,
            server-confirmed token movement.
          </p>
          <label>
            Display name
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void join();
              }}
              placeholder="e.g. Mira"
              autoFocus
              maxLength={32}
            />
          </label>
          <label>
            Encounter code
            <input
              value={encounterCode}
              onChange={(event) => setEncounterCode(event.target.value.toUpperCase())}
              maxLength={24}
              spellCheck={false}
            />
          </label>
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <button className="primary-button" onClick={() => void join()} disabled={busy}>
            {busy ? "Joining…" : "Join encounter"}
          </button>
          <div className="join-note">
            Accountless prototype · use code <strong>EMBER-KEEP</strong>
          </div>
        </section>
      </main>
    );
  }

  const connectionLabel =
    connection === "live"
      ? "Live"
      : connection === "lost"
        ? "Connection lost"
        : connection === "reconnecting"
          ? "Reconnecting"
          : "Connecting";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">Shared encounter · {state.encounter.code}</div>
          <h1>{state.encounter.name}</h1>
        </div>
        <div className={`connection-pill connection-${connection}`} aria-live="polite">
          <span className="connection-dot" />
          {connectionLabel}
        </div>
      </header>

      <div className="workspace">
        <section className="map-panel" aria-label="Shared battle map">
          <div className="map-frame">
            <canvas
              ref={canvasRef}
              className={`map-canvas${lockedByOther ? " is-blocked" : ""}${dragging ? " is-dragging" : ""}`}
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onCanvasPointerMove}
              onPointerUp={onCanvasPointerUp}
              onPointerCancel={onCanvasPointerCancel}
              onKeyDown={onCanvasKeyDown}
              aria-disabled={!movementEnabled || lockedByOther}
              aria-label={`${state.grid.width} by ${state.grid.height} battle grid. Token at map position ${formatPosition(state.token)}. Grab and drag the token to any position, or use the keyboard movement control.`}
              role="application"
              tabIndex={0}
            />
            {connection !== "live" ? (
              <div className="map-safety-overlay">
                <strong>{connectionLabel}</strong>
                <span>Movement is paused until shared state is current.</span>
              </div>
            ) : null}
          </div>
          <div className="map-footer">
            <span>{state.grid.width} × {state.grid.height} squares</span>
            <span>5 ft per square · equal-cost diagonals</span>
            <span>Server version {state.encounter.version}</span>
          </div>
        </section>

        <aside className="control-panel" aria-label="Token controls">
          <div className="participant-row">
            <span className="participant-avatar">{participant.name.charAt(0).toUpperCase()}</span>
            <span>
              <small>Joined as</small>
              <strong>{participant.name}</strong>
            </span>
          </div>

          <div className="panel-rule" />

          <section className="token-card">
            <div className="token-heading">
              <span className="token-mini">W</span>
              <div>
                <small>Shared token</small>
                <h2>{state.token.name}</h2>
              </div>
            </div>
            <div className="coordinate-row">
              <span>Position</span>
              <strong>{formatPosition(state.token)}</strong>
            </div>

            {!activeLock ? (
              <div className="lock-state is-open">
                <span className="lock-mark">◇</span>
                <span><strong>Available</strong><small>Grab the token and drag it anywhere on the map.</small></span>
              </div>
            ) : ownsLock ? (
              <div className="lock-state is-yours">
                <span className="lock-mark">◆</span>
                <span><strong>Your lock · {remainingSeconds}s</strong><small>Release the token to publish the drop.</small></span>
              </div>
            ) : (
              <div className="lock-state is-other">
                <span className="lock-mark">◆</span>
                <span><strong>{activeLock.ownerName} is moving</strong><small>Available again in about {remainingSeconds}s.</small></span>
              </div>
            )}

            {ownsLock && preview ? (
              <div className="move-review">
                <div>
                  <small>Proposed destination</small>
                  <strong>{formatPosition(preview)}</strong>
                </div>
                <div>
                  <small>Rules distance</small>
                  <strong>{distance} ft</strong>
                </div>
              </div>
            ) : null}

            {ownsLock ? (
              <div className="button-stack">
                <button
                  className="primary-button"
                  onClick={() => void confirmMove()}
                  disabled={!preview || isNoOpPreview || !movementEnabled}
                >
                  Confirm move
                </button>
                <button className="secondary-button" onClick={() => void cancelMove()} disabled={!movementEnabled}>
                  Cancel & release
                </button>
              </div>
            ) : (
              <button
                className="primary-button"
                onClick={() => void acquireLock()}
                disabled={!movementEnabled || lockedByOther}
              >
                {lockedByOther ? "Token locked" : "Move with keyboard"}
              </button>
            )}
          </section>

          <div className="how-it-works">
            <span>1</span><p>Grab the shared token.</p>
            <span>2</span><p>Drag to any pixel on the map.</p>
            <span>3</span><p>Release to publish the move.</p>
          </div>

          {error ? <div className="form-error" role="alert">{error}</div> : null}
          {notice ? <div className="toast" role="status">{notice}</div> : null}
        </aside>
      </div>
    </main>
  );
}
