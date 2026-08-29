import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drawMap, type BattleMapViewport } from "@/app/battle-map-renderer";
import { renderMapPackageToContext } from "@/app/map-scene-renderer";
import { useMapAssets } from "@/app/use-map-assets";
import { battleMapAnimationIsActive } from "@/shared/battle-map-animation";
import type { EncounterState, ParticipantSession, SharedToken } from "@/shared/contracts";
import type { MapPackage } from "@/shared/map-package";
import { SPELL_EFFECT_KIND } from "@/shared/spell-effects";
import { layoutTokenLabels, type LabelRectangle, type TokenLabelRequest } from "@/shared/token-label-layout";

const participant: ParticipantSession = { id: "player-1", name: "Dan", role: "player", sessionSecret: "secret" };
const viewport: BattleMapViewport = { zoom: 1, centerX: 12, centerY: 8, mapKey: "empty:24x16", fit: false };

function createToken(overrides: Partial<SharedToken> = {}): SharedToken {
  return {
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
    armorClass: 16,
    hp: 24,
    maxHp: 24,
    temporaryHp: 0,
    healthState: "unharmed",
    hidden: false,
    summonerTokenId: null,
    initiative: 15,
    initiativeGroupId: null,
    initiativeOrder: 0,
    turnComplete: false,
    altitude: 0,
    movementUsed: 0,
    movementOrigin: null,
    effects: [],
    controller: { name: "Dan" },
    controlledByViewer: true,
    x: 6,
    y: 6,
    ...overrides,
  };
}

function createState(tokens: SharedToken[] = [], mapPackage: MapPackage | null = null): EncounterState {
  return {
    encounter: {
      code: "TEST",
      name: "Test encounter",
      dmBriefing: null,
      version: 1,
      status: "active",
      mapPackage,
      mapDraft: null,
      draftUpdatedAt: null,
      currentRound: 1,
      activeInitiativeOrder: 0,
      strictMovement: false,
      fogVisibility: { mode: "off", polygons: [] },
      updatedAt: 1,
    },
    grid: { width: 24, height: 16, feetPerCell: 5 },
    viewer: { id: participant.id, role: participant.role },
    features: { combatRolling: { mode: "off", enabled: false, draining: false } },
    combatActions: [],
    combatRolls: [],
    damageProposals: [],
    undo: { available: 0, redoAvailable: 0, lastAction: null, nextRedoAction: null },
    tokens,
    annotations: [],
    chatMessages: [],
    handouts: [],
    mapImages: [],
    availableArt: [],
  };
}

function rectanglesOverlap(left: LabelRectangle, right: LabelRectangle): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function contextMock() {
  return {
    globalAlpha: 1,
    setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn(),
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), clip: vi.fn(),
    beginPath: vi.fn(), closePath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), arc: vi.fn(), rect: vi.fn(),
    fill: vi.fn(), stroke: vi.fn(), strokeRect: vi.fn(), roundRect: vi.fn(), setLineDash: vi.fn(),
    fillText: vi.fn(), strokeText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  } as unknown as CanvasRenderingContext2D;
}

describe("battle-map animation decisions", () => {
  it("keeps generic spell shapes static while dedicated spells and token VFX animate", () => {
    const generic = createToken({ id: "generic", kind: SPELL_EFFECT_KIND, artAsset: "shape:generic-circle" });
    expect(battleMapAnimationIsActive({ annotations: [], tokens: [generic], pingStartedAt: new Map(), spellPlacementArt: null, now: 1_000 })).toBe(false);

    const dedicated = createToken({ id: "moonbeam", kind: SPELL_EFFECT_KIND, artAsset: "/assets/spells/moonbeam-vfx-source.png" });
    expect(battleMapAnimationIsActive({ annotations: [], tokens: [dedicated], pingStartedAt: new Map(), spellPlacementArt: null, now: 1_000 })).toBe(true);

    const blessed = createToken({ effects: [{ id: "effect-1", name: "Bless", type: "buff", durationRounds: null, expiresRound: null, reminderTiming: "", due: false }] });
    expect(battleMapAnimationIsActive({ annotations: [], tokens: [blessed], pingStartedAt: new Map(), spellPlacementArt: null, now: 1_000 })).toBe(true);
  });

  it("expires transient annotation animation from authoritative timing", () => {
    const ping = { id: "ping-1", type: "ping", x: 1, y: 1, x2: null, y2: null, color: "#fff", label: null, createdBy: "Dan", expiresAt: 2_260 } as const;
    expect(battleMapAnimationIsActive({ annotations: [ping], tokens: [], pingStartedAt: new Map([[ping.id, 1_000]]), spellPlacementArt: null, now: 1_500 })).toBe(true);
    expect(battleMapAnimationIsActive({ annotations: [ping], tokens: [], pingStartedAt: new Map([[ping.id, 1_000]]), spellPlacementArt: null, now: 2_260 })).toBe(false);
  });
});

describe("token label layout", () => {
  const bounds = { x: 0, y: 0, width: 320, height: 220 };
  const request = (tokenId: string, tokenX: number, tokenY: number, overrides: Partial<TokenLabelRequest> = {}): TokenLabelRequest => ({
    tokenId,
    text: `Long ${tokenId}`,
    tokenX,
    tokenY,
    radius: 20,
    width: 88,
    height: 18,
    priority: 0,
    selected: false,
    ...overrides,
  });

  it("places crowded labels without overlap and remains stable across input order", () => {
    const requests = [request("c", 155, 105), request("a", 140, 100, { selected: true, priority: 300 }), request("b", 170, 100, { priority: 200 })];
    const obstacles = requests.map((item) => ({ tokenId: item.tokenId, x: item.tokenX, y: item.tokenY, radius: item.radius }));
    const forward = layoutTokenLabels(requests, obstacles, bounds);
    const reversed = layoutTokenLabels([...requests].reverse(), obstacles, bounds);

    expect(forward.map(({ tokenId, anchor }) => ({ tokenId, anchor }))).toEqual(reversed.map(({ tokenId, anchor }) => ({ tokenId, anchor })));
    expect(forward.some((placement) => placement.tokenId === "a")).toBe(true);
    for (let index = 0; index < forward.length; index += 1) {
      for (let other = index + 1; other < forward.length; other += 1) expect(rectanglesOverlap(forward[index], forward[other])).toBe(false);
    }
  });

  it("keeps the selected edge label visible and suppresses lower-priority overflow", () => {
    const requests = Array.from({ length: 10 }, (_, index) => request(`token-${index}`, 8, 8, {
      selected: index === 0,
      priority: index === 0 ? 300 : 0,
    }));
    const placements = layoutTokenLabels(requests, [], { x: 0, y: 0, width: 140, height: 90 });
    const selected = placements.find((placement) => placement.tokenId === "token-0");

    expect(selected).toBeDefined();
    expect(selected!.x).toBeGreaterThanOrEqual(0);
    expect(selected!.y).toBeGreaterThanOrEqual(0);
    expect(selected!.x + selected!.width).toBeLessThanOrEqual(140);
    expect(selected!.y + selected!.height).toBeLessThanOrEqual(90);
    expect(placements.length).toBeLessThan(requests.length);
  });
});

describe("executable canvas adapters", () => {
  it("paints a high-contrast keyboard cursor on the real map canvas", () => {
    const context = contextMock();
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "getBoundingClientRect", { value: () => ({ left: 0, top: 0, width: 800, height: 500 }) });
    Object.defineProperty(canvas, "getContext", { value: () => context });

    drawMap(canvas, createState(), null, null, null, null, participant, null, new Map(), viewport, new Map(), 1_000, null, null, 0.4, true, true, null, null, { x: 12, y: 8 });

    expect(context.arc).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), expect.any(Number), 0, Math.PI * 2);
    expect(context.setLineDash).toHaveBeenCalledWith([4, 3]);
  });

  it("draws collision-laid-out names through the real battle-map renderer", () => {
    const context = contextMock();
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "getBoundingClientRect", { value: () => ({ left: 0, top: 0, width: 800, height: 500 }) });
    Object.defineProperty(canvas, "getContext", { value: () => context });
    const selected = createToken({ id: "selected", name: "Selected Hero", x: 10, y: 8 });
    const crowded = createToken({ id: "crowded", name: "Crowded Monster", size: "large", controller: { name: "Kevin" }, controlledByViewer: false, x: 10.25, y: 8 });

    drawMap(canvas, createState([crowded, selected]), null, null, null, null, participant, null, new Map(), viewport, new Map(), 1_000, selected.id, null, 0.4, true, true, null, null, null);

    expect(context.fillText).toHaveBeenCalledWith("Selected Hero", expect.any(Number), expect.any(Number));
    const labelRects = vi.mocked(context.roundRect).mock.calls.map(([x, y, width, height]) => ({ x: Number(x), y: Number(y), width: Number(width), height: Number(height) }));
    for (let index = 0; index < labelRects.length; index += 1) {
      for (let other = index + 1; other < labelRects.length; other += 1) expect(rectanglesOverlap(labelRects[index], labelRects[other])).toBe(false);
    }
  });

  it("caps backing-canvas density while keeping CSS-pixel geometry", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 3 });
    try {
      const context = contextMock();
      const canvas = document.createElement("canvas");
      Object.defineProperty(canvas, "getBoundingClientRect", { value: () => ({ left: 0, top: 0, width: 400, height: 240 }) });
      Object.defineProperty(canvas, "getContext", { value: () => context });

      drawMap(canvas, createState(), null, null, null, null, participant, null, new Map(), viewport, new Map(), 1_000, null, null, 0.4, true, true, null, null, null);

      expect(canvas.width).toBe(800);
      expect(canvas.height).toBe(480);
      expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    } finally {
      if (originalDescriptor) Object.defineProperty(window, "devicePixelRatio", originalDescriptor);
      else Reflect.deleteProperty(window, "devicePixelRatio");
    }
  });

  it("builds dynamic fog in a bounded offscreen mask before compositing it", () => {
    const context = contextMock();
    const maskContext = contextMock();
    const maskCanvas = { width: 0, height: 0, getContext: () => maskContext } as unknown as HTMLCanvasElement;
    const canvas = {
      width: 0,
      height: 0,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 240 }),
      getContext: () => context,
      ownerDocument: { createElement: () => maskCanvas },
    } as unknown as HTMLCanvasElement;
    const state = createState();
    state.encounter.fogVisibility = {
      mode: "dynamic",
      polygons: [[{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 3, y: 4 }]],
      revealedCircles: [{ id: "tree", x: 6, y: 6, radius: 1 }],
    };

    drawMap(canvas, state, null, null, null, null, participant, null, new Map(), viewport, new Map(), 1_000, null, null, 0.4, true, true, null, null, null);

    expect(maskContext.fillRect).toHaveBeenCalledWith(0, 0, 400, 240);
    expect(maskContext.closePath).toHaveBeenCalled();
    expect(maskContext.arc).toHaveBeenCalled();
    expect(context.drawImage).toHaveBeenCalledWith(maskCanvas, 0, 0, 400, 240);
  });

  it("draws the full scene directly before its deterministic overlay", () => {
    const context = contextMock();
    const image = {} as HTMLImageElement;
    const map = {
      width: 24,
      height: 16,
      visual: { assetUrl: "/map-assets/test.png" },
      walls: [{ id: "wall-1", x1: 1, y1: 1, x2: 2, y2: 1, style: "stone" }],
      portals: [], labels: [], notes: [],
    } as unknown as MapPackage;

    renderMapPackageToContext(context, map, new Map([[map.visual.assetUrl, image]]), 10, 10);

    expect(context.drawImage).toHaveBeenCalledWith(image, 0, 0, 240, 160);
    expect(context.moveTo).toHaveBeenCalledWith(10, 10);
    expect(context.lineTo).toHaveBeenCalledWith(20, 10);
  });
});

describe("useMapAssets", () => {
  const originalImage = globalThis.Image;
  const originalMatchMedia = window.matchMedia;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const originalResizeObserver = globalThis.ResizeObserver;
  let images: Array<{ src: string }>;
  let failedSources: Set<string>;

  beforeEach(() => {
    images = [];
    failedSources = new Set();
    class FakeImage {
      onload: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      width = 100;
      height = 100;
      private value = "";
      constructor() { images.push(this); }
      get src() { return this.value; }
      set src(value: string) {
        this.value = value;
        if (value) queueMicrotask(() => failedSources.has(value)
          ? this.onerror?.(new Event("error"))
          : this.onload?.(new Event("load")));
      }
    }
    globalThis.Image = FakeImage as unknown as typeof Image;
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
    globalThis.requestAnimationFrame = vi.fn(() => 1);
    globalThis.cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    globalThis.Image = originalImage;
    window.matchMedia = originalMatchMedia;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    if (originalResizeObserver) globalThis.ResizeObserver = originalResizeObserver;
    else Reflect.deleteProperty(globalThis, "ResizeObserver");
  });

  function renderAssets(initialState: EncounterState, canvas: HTMLCanvasElement | null = null) {
    const inputs = (state: EncounterState): Parameters<typeof useMapAssets>[0] => ({
      active: true,
      state,
      participant,
      preview: null,
      placementPreview: null,
      spellPlacementPreview: null,
      dragOrigin: null,
      viewport,
      selectedTokenId: null,
      selectedMapNoteId: null,
      gridOpacity: 0.4,
      showColoredTokenCenters: true,
      showHealthRings: true,
      sharedFogPreview: null,
      selectedSharedFogVertex: null,
      keyboardCursor: null,
      pingStartedAtRef: { current: new Map() },
      canvasRef: { current: canvas },
    });
    return renderHook(({ state }) => useMapAssets(inputs(state)), { initialProps: { state: initialState } });
  }

  it("retains unchanged token images across authoritative array replacement and loads only additions", async () => {
    const first = createToken({ artAsset: "/assets/tokens/hero.png" });
    const view = renderAssets(createState([first]));
    await waitFor(() => expect(images.filter((image) => image.src)).toHaveLength(1));

    view.rerender({ state: createState([{ ...first }]) });
    await act(async () => Promise.resolve());
    expect(images.filter((image) => image.src)).toHaveLength(1);

    const second = createToken({ id: "token-2", artAsset: "/assets/tokens/owlbear.png" });
    view.rerender({ state: createState([{ ...first }, second]) });
    await waitFor(() => expect(images.filter((image) => image.src)).toHaveLength(2));
    expect(images.map((image) => image.src).sort()).toEqual(["/assets/tokens/hero.png", "/assets/tokens/owlbear.png"]);

    view.rerender({ state: createState([second]) });
    await waitFor(() => expect(images[0].src).toBe(""));
    view.unmount();
    expect(images[1].src).toBe("");
  });

  it("keeps an equivalent full-scene package cached across state replacement", async () => {
    const map = {
      format: "dnd-battle-map", version: 1, id: "map-1", name: "Map", description: "", biome: "forest", mood: "daylight", seed: "seed",
      width: 24, height: 16,
      visual: { kind: "generated-scene", assetUrl: "/map-assets/map.png", pixelWidth: 3072, pixelHeight: 2048 },
      walls: [], portals: [], labels: [], notes: [],
      fog: { mode: "off", sharedPolygon: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 16 }], walls: [], doors: [], circles: [] },
      source: { kind: "generated-scene" }, createdAt: 1,
    } as MapPackage;
    const view = renderAssets(createState([], map));
    await waitFor(() => expect(view.result.current.renderedMapScene?.mapId).toBe(map.id));

    view.rerender({ state: createState([], structuredClone(map)) });
    await act(async () => Promise.resolve());

    expect(images.filter((image) => image.src === map.visual.assetUrl)).toHaveLength(1);
  });

  it("falls back cleanly when token artwork cannot load", async () => {
    failedSources.add("/assets/tokens/broken.png");
    const view = renderAssets(createState([createToken({ artAsset: "/assets/tokens/broken.png" })]));
    await waitFor(() => expect(images).toHaveLength(1));
    await act(async () => Promise.resolve());
    expect(view.result.current.tokenArt.size).toBe(0);
  });

  it("coalesces resize paints into an animation frame and cleans up the observer", () => {
    const context = contextMock();
    const parent = document.createElement("div");
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "getBoundingClientRect", { value: () => ({ left: 0, top: 0, width: 800, height: 500 }) });
    Object.defineProperty(canvas, "getContext", { value: () => context });
    Object.defineProperty(canvas, "parentElement", { value: parent });

    let resizeCallback: ResizeObserverCallback | null = null;
    const observe = vi.fn();
    const disconnect = vi.fn();
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) { resizeCallback = callback; }
      observe = observe;
      unobserve = vi.fn();
      disconnect = disconnect;
    };

    const view = renderAssets(createState(), canvas);
    expect(observe).toHaveBeenCalledWith(parent);
    const paintsBeforeResize = vi.mocked(context.clearRect).mock.calls.length;

    act(() => resizeCallback?.([], {} as ResizeObserver));
    expect(cancelAnimationFrame).toHaveBeenCalledWith(0);
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    act(() => vi.mocked(requestAnimationFrame).mock.calls[0][0](1));
    expect(context.clearRect).toHaveBeenCalledTimes(paintsBeforeResize + 1);

    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenLastCalledWith(1);
  });

  it("does not schedule animation frames for a static generic spell", () => {
    renderAssets(createState([createToken({ kind: SPELL_EFFECT_KIND, artAsset: "shape:generic-square" })]));
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("schedules animation for dedicated spell artwork", () => {
    renderAssets(createState([createToken({ kind: SPELL_EFFECT_KIND, artAsset: "/assets/spells/magic-circle-vfx.png" })]));
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
  });

  it("honors reduced motion without starting a frame loop", () => {
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
    renderAssets(createState([createToken({ kind: SPELL_EFFECT_KIND, artAsset: "/assets/spells/magic-circle-vfx.png" })]));
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});
