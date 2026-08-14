import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBattleMapGestures } from "@/app/use-battle-map-gestures";
import { viewportGeometry } from "@/shared/battle-map-geometry";
import type { EncounterState, ParticipantSession, SharedToken } from "@/shared/contracts";

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

describe("useBattleMapGestures", () => {
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
    const rect = { left: 0, top: 0, width: 1200, height: 800 } as DOMRect;
    const canvas = {
      getBoundingClientRect: () => rect,
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => false,
      releasePointerCapture: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const geometry = viewportGeometry(result.current.viewport, state, rect.width, rect.height);
    const event = {
      button: 0,
      pointerId: 1,
      clientX: rect.left + geometry.offsetX + (token.x - geometry.panX) * geometry.cellSize,
      clientY: rect.top + geometry.offsetY + (token.y - geometry.panY) * geometry.cellSize,
      currentTarget: canvas,
      preventDefault: vi.fn(),
    } as unknown as React.PointerEvent<HTMLCanvasElement>;

    act(() => result.current.onCanvasPointerDown(event));
    expect(onSelectToken).toHaveBeenCalledWith(token.id);
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
    expect(onMoveToken).toHaveBeenCalledWith(token.id, expect.objectContaining({ x: token.x + 2, y: token.y + 1 }));
  });
});
