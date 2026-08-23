import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBattleMapGestures } from "@/app/use-battle-map-gestures";
import { viewportGeometry } from "@/shared/battle-map-geometry";
import type { EncounterState, ParticipantSession, SharedToken } from "@/shared/contracts";
import { SPELL_EFFECT_KIND } from "@/shared/spell-effects";

const participant: ParticipantSession = {
  id: "participant-1",
  name: "Dan",
  role: "player",
  sessionSecret: "session-secret",
};

const token = {
  id: "token-1",
  name: "Dar'eleth",
  kind: "character",
  size: "medium",
  x: 5,
  y: 5,
  altitude: 0,
  movementOrigin: null,
  controlledByViewer: true,
} as SharedToken;

const state = {
  encounter: {
    status: "active",
    mapPackage: {
      id: "map-1",
      notes: [],
      fog: {
        mode: "shared",
        sharedPolygon: [
          { x: 0, y: 0 }, { x: 12, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 8 },
          { x: 24, y: 16 }, { x: 12, y: 16 }, { x: 0, y: 16 }, { x: 0, y: 8 },
        ],
      },
    },
  },
  grid: { width: 24, height: 16, feetPerCell: 5 },
  tokens: [token],
  annotations: [],
} as unknown as EncounterState;

function renderGestures(overrides: Partial<Parameters<typeof useBattleMapGestures>[0]> = {}) {
  const canvasRef = { current: null as HTMLCanvasElement | null };
  const onSelectToken = vi.fn();
  const onUpdateSharedFog = vi.fn();
  const inputs: Parameters<typeof useBattleMapGestures>[0] = {
    canvasRef,
    state,
    participant,
    movementEnabled: true,
    annotationMode: "move",
    creatures: [],
    armedCreatureId: null,
    armedSpellId: null,
    playerCharacter: token,
    selectedTokenId: null,
    canMoveToken: () => false,
    isTokenPendingCreation: () => false,
    setNotice: vi.fn(),
    onSelectToken,
    onSelectMapNote: vi.fn(),
    onArmCreature: vi.fn(),
    onArmSpell: vi.fn(),
    onPlaceCreature: vi.fn(),
    onPlaceSpellEffect: vi.fn(),
    onMoveToken: vi.fn(),
    onAddAnnotation: vi.fn(),
    onRemoveAnnotation: vi.fn(),
    onUpdateSharedFog,
    ...overrides,
  };
  return { ...renderHook(() => useBattleMapGestures(inputs)), onSelectToken, onUpdateSharedFog };
}

function pointerDownAtToken(
  viewport: ReturnType<typeof renderGestures>["result"]["current"]["viewport"],
  currentState: EncounterState,
  target: SharedToken,
  pointerId = 1,
) {
  const rect = { left: 0, top: 0, width: 1200, height: 800 } as DOMRect;
  const canvas = {
    getBoundingClientRect: () => rect,
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => false,
    releasePointerCapture: vi.fn(),
  } as unknown as HTMLCanvasElement;
  const geometry = viewportGeometry(viewport, currentState, rect.width, rect.height);
  const event = {
    button: 0,
    pointerId,
    clientX: rect.left + geometry.offsetX + (target.x - geometry.panX) * geometry.cellSize,
    clientY: rect.top + geometry.offsetY + (target.y - geometry.panY) * geometry.cellSize,
    currentTarget: canvas,
    preventDefault: vi.fn(),
  } as unknown as React.PointerEvent<HTMLCanvasElement>;
  return { canvas, event };
}

function keyboardEvent(key: string, modifiers: Partial<React.KeyboardEvent<HTMLCanvasElement>> = {}) {
  const canvas = document.createElement("canvas");
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 1200, height: 800 } as DOMRect);
  return {
    key,
    currentTarget: canvas,
    preventDefault: vi.fn(),
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  } as unknown as React.KeyboardEvent<HTMLCanvasElement>;
}

describe("useBattleMapGestures", () => {
  it("completes a token move and altitude change without a pointer", () => {
    const onMoveToken = vi.fn();
    const { result, onSelectToken } = renderGestures({
      selectedTokenId: token.id,
      canMoveToken: () => true,
      onMoveToken,
    });

    act(() => result.current.onCanvasFocus());
    act(() => result.current.onCanvasKeyDown(keyboardEvent(" ")));
    expect(onSelectToken).toHaveBeenCalledWith(token.id);
    expect(result.current.dragging).toBe(true);

    act(() => result.current.onCanvasKeyDown(keyboardEvent("ArrowRight")));
    act(() => result.current.onCanvasKeyDown(keyboardEvent("PageUp")));
    act(() => result.current.onCanvasKeyDown(keyboardEvent("Enter")));

    expect(onMoveToken).toHaveBeenCalledWith(token.id, { x: 6, y: 5, altitude: 5 });
    expect(result.current.dragging).toBe(false);
    expect(result.current.keyboardStatus).toContain("Move submitted");
  });

  it("stages and cancels a keyboard move without publishing it", () => {
    const onMoveToken = vi.fn();
    const { result } = renderGestures({ selectedTokenId: token.id, canMoveToken: () => true, onMoveToken });
    act(() => result.current.onCanvasFocus());
    act(() => result.current.onCanvasKeyDown(keyboardEvent(" ")));
    act(() => result.current.onCanvasKeyDown(keyboardEvent("ArrowDown")));
    act(() => result.current.onCanvasKeyDown(keyboardEvent("Escape")));
    expect(onMoveToken).not.toHaveBeenCalled();
    expect(result.current.preview).toBeNull();
    expect(result.current.keyboardStatus).toContain("cancelled");
  });

  it("creates a tactical line with two keyboard activations while keeping the tool active", () => {
    const onAddAnnotation = vi.fn();
    const { result } = renderGestures({ annotationMode: "drawing", onAddAnnotation });
    act(() => result.current.onCanvasFocus());
    const start = result.current.keyboardCursor;
    act(() => result.current.onCanvasKeyDown(keyboardEvent("Enter")));
    act(() => result.current.onCanvasKeyDown(keyboardEvent("ArrowRight")));
    act(() => result.current.onCanvasKeyDown(keyboardEvent("Enter")));
    expect(onAddAnnotation).toHaveBeenCalledWith("drawing", start, expect.objectContaining({ x: start!.x + 1, y: start!.y }));
    expect(result.current.keyboardStatus).toContain("tool remains active");
  });

  it("selects and reshapes a shared-fog corner with the keyboard", () => {
    const centeredFogState = {
      ...state,
      encounter: {
        ...state.encounter,
        mapPackage: {
          ...state.encounter.mapPackage,
          fog: {
            ...state.encounter.mapPackage!.fog,
            sharedPolygon: [{ x: 12.5, y: 8.5 }, { x: 24, y: 0 }, { x: 24, y: 16 }, { x: 0, y: 16 }],
          },
        },
      },
    } as EncounterState;
    const dm = { ...participant, role: "dm" as const };
    const { result, onUpdateSharedFog } = renderGestures({ state: centeredFogState, participant: dm, playerCharacter: null });
    act(() => result.current.toggleSharedFogEditing());
    act(() => result.current.onCanvasFocus());
    act(() => result.current.onCanvasKeyDown(keyboardEvent("Enter")));
    act(() => result.current.onCanvasKeyDown(keyboardEvent("ArrowLeft")));
    act(() => result.current.onCanvasKeyDown(keyboardEvent("Enter")));
    expect(onUpdateSharedFog).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ x: 11.5, y: 8.5 })]));
  });

  it("zooms from a Safari trackpad pinch without double-applying wheel zoom", () => {
    const canvas = document.createElement("canvas");
    const rect = { left: 100, top: 50, width: 1200, height: 800 } as DOMRect;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(rect);
    const canvasRef = { current: canvas };
    const { result } = renderGestures({ canvasRef });
    const gestureEvent = (type: string, scale: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        scale: { value: scale },
        clientX: { value: rect.left + rect.width * 0.25 },
        clientY: { value: rect.top + rect.height * 0.75 },
      });
      return event;
    };

    act(() => canvas.dispatchEvent(gestureEvent("gesturestart", 1)));
    act(() => canvas.dispatchEvent(gestureEvent("gesturechange", 2)));
    expect(result.current.viewport).toMatchObject({ zoom: 2, fit: false });

    const wheelEvent = {
      currentTarget: canvas,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      deltaY: -100,
      preventDefault: vi.fn(),
    } as unknown as React.WheelEvent<HTMLCanvasElement>;
    act(() => result.current.onCanvasWheel(wheelEvent));
    expect(result.current.viewport.zoom).toBe(2);
    expect(wheelEvent.preventDefault).toHaveBeenCalledOnce();

    act(() => canvas.dispatchEvent(gestureEvent("gestureend", 2)));
    act(() => result.current.onCanvasWheel(wheelEvent));
    expect(result.current.viewport.zoom).toBeGreaterThan(2);
  });

  it("owns fit/reset viewport and shared-fog editing state", () => {
    const { result, onUpdateSharedFog } = renderGestures();
    act(() => result.current.fitViewport());
    expect(result.current.viewport).toMatchObject({ fit: true, centerX: 12, centerY: 8 });

    act(() => result.current.toggleSharedFogEditing());
    expect(result.current.editingSharedFog).toBe(true);
    expect(result.current.sharedFogPreview).toHaveLength(8);

    act(() => result.current.addSharedFogPoint());
    expect(onUpdateSharedFog).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) })]));
    expect(onUpdateSharedFog.mock.calls.at(-1)?.[0]).toHaveLength(9);

    act(() => result.current.resetViewport());
    expect(result.current.viewport).toMatchObject({ fit: false, zoom: 1, centerX: 12, centerY: 8 });
  });

  it("routes a canvas token hit through the selection port", () => {
    const { result, onSelectToken } = renderGestures();
    const { event } = pointerDownAtToken(result.current.viewport, state, token);

    act(() => result.current.onCanvasPointerDown(event));
    expect(onSelectToken).toHaveBeenCalledWith(token.id);
  });

  it.each(["paused", "reconnecting", "busy"])("keeps ordinary-token inspection available while movement is unavailable because the app is %s", (reason) => {
    const unavailableState = reason === "paused"
      ? { ...state, encounter: { ...state.encounter, status: "paused" } } as EncounterState
      : state;
    const canMoveToken = vi.fn(() => true);
    const onMoveToken = vi.fn();
    const { result, onSelectToken } = renderGestures({
      state: unavailableState,
      movementEnabled: false,
      canMoveToken,
      onMoveToken,
    });
    const { canvas, event } = pointerDownAtToken(result.current.viewport, unavailableState, token);

    act(() => result.current.onCanvasPointerDown(event));

    expect(onSelectToken).toHaveBeenCalledWith(token.id);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(canMoveToken).not.toHaveBeenCalled();
    expect(canvas.setPointerCapture).not.toHaveBeenCalled();
    expect(result.current.dragging).toBe(false);
    expect(result.current.preview).toBeNull();
    expect(onMoveToken).not.toHaveBeenCalled();
  });

  it("selects a foreign token under strict movement without starting a drag", () => {
    const foreignToken = {
      ...token,
      id: "token-foreign",
      name: "Owlbear",
      kind: "monster",
      controlledByViewer: false,
    } as SharedToken;
    const strictState = {
      ...state,
      encounter: { ...state.encounter, strictMovement: true },
      tokens: [foreignToken],
    } as EncounterState;
    const canMoveToken = vi.fn(() => false);
    const { result, onSelectToken } = renderGestures({ state: strictState, canMoveToken });
    const { canvas, event } = pointerDownAtToken(result.current.viewport, strictState, foreignToken);

    act(() => result.current.onCanvasPointerDown(event));

    expect(onSelectToken).toHaveBeenCalledWith(foreignToken.id);
    expect(canMoveToken).toHaveBeenCalledWith(foreignToken);
    expect(canvas.setPointerCapture).not.toHaveBeenCalled();
    expect(result.current.dragging).toBe(false);
  });

  it("keeps persistent spell inspection aligned with ordinary tokens while movement is unavailable", () => {
    const spellToken = {
      ...token,
      id: "spell-1",
      name: "Spell Circle",
      kind: SPELL_EFFECT_KIND,
      size: "large",
      artAsset: "shape:generic-circle",
      controlledByViewer: false,
      x: 8,
    } as SharedToken;
    const spellState = { ...state, tokens: [spellToken] } as EncounterState;
    const { result, onSelectToken } = renderGestures({ state: spellState, movementEnabled: false });
    const { canvas, event } = pointerDownAtToken(result.current.viewport, spellState, spellToken);

    act(() => result.current.onCanvasPointerDown(event));

    expect(onSelectToken).toHaveBeenCalledWith(spellToken.id);
    expect(canvas.setPointerCapture).not.toHaveBeenCalled();
    expect(result.current.dragging).toBe(false);
  });

  it("publishes a completed token drag through the movement port", () => {
    const onMoveToken = vi.fn();
    const { result } = renderGestures({ canMoveToken: () => true, onMoveToken });
    const rect = { left: 0, top: 0, width: 1200, height: 800 } as DOMRect;
    const canvas = {
      getBoundingClientRect: () => rect,
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => true,
      releasePointerCapture: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const geometry = viewportGeometry(result.current.viewport, state, rect.width, rect.height);
    const pointerEvent = (x: number, y: number) => ({
      button: 0,
      pointerId: 7,
      clientX: rect.left + geometry.offsetX + (x - geometry.panX) * geometry.cellSize,
      clientY: rect.top + geometry.offsetY + (y - geometry.panY) * geometry.cellSize,
      currentTarget: canvas,
      preventDefault: vi.fn(),
    } as unknown as React.PointerEvent<HTMLCanvasElement>);

    act(() => result.current.onCanvasPointerDown(pointerEvent(token.x, token.y)));
    act(() => result.current.onCanvasPointerMove(pointerEvent(token.x + 2, token.y + 1)));
    act(() => result.current.onCanvasPointerUp(pointerEvent(token.x + 2, token.y + 1)));

    expect(onMoveToken).toHaveBeenCalledOnce();
    expect(onMoveToken).toHaveBeenCalledWith(token.id, expect.objectContaining({ x: token.x + 2, y: token.y + 1, altitude: 0 }));
  });

  it("uses the wheel to change altitude while dragging and commits height with the move", () => {
    const onMoveToken = vi.fn();
    const { result } = renderGestures({ canMoveToken: () => true, onMoveToken });
    const rect = { left: 0, top: 0, width: 1200, height: 800 } as DOMRect;
    const canvas = {
      getBoundingClientRect: () => rect,
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => true,
      releasePointerCapture: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const geometry = viewportGeometry(result.current.viewport, state, rect.width, rect.height);
    const pointerEvent = {
      button: 0, pointerId: 9,
      clientX: geometry.offsetX + (token.x - geometry.panX) * geometry.cellSize,
      clientY: geometry.offsetY + (token.y - geometry.panY) * geometry.cellSize,
      currentTarget: canvas, preventDefault: vi.fn(),
    } as unknown as React.PointerEvent<HTMLCanvasElement>;
    act(() => result.current.onCanvasPointerDown(pointerEvent));
    const wheelEvent = { currentTarget: canvas, clientX: 0, clientY: 0, deltaY: -100, preventDefault: vi.fn() } as unknown as React.WheelEvent<HTMLCanvasElement>;
    act(() => result.current.onCanvasWheel(wheelEvent));
    expect(result.current.preview).toMatchObject({ altitude: 5 });
    act(() => result.current.onCanvasPointerUp(pointerEvent));
    expect(onMoveToken).toHaveBeenCalledWith(token.id, expect.objectContaining({ altitude: 5 }));
  });
});
