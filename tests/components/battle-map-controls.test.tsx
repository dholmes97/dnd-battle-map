import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BattleMapCommandBar } from "@/app/battle-map-command-bar";
import { CreaturePalette, SpellPalette } from "@/app/battle-map-palettes";
import type { EncounterState, ParticipantSession, SharedToken } from "@/shared/contracts";

const dm: ParticipantSession = { id: "dm", name: "Kevin", role: "dm", sessionSecret: "secret" };
const player: ParticipantSession = { id: "p", name: "Dan", role: "player", sessionSecret: "secret" };
const baseToken = { id: "dar", name: "Dar'eleth", kind: "character", summonerTokenId: null } as SharedToken;
const state = { encounter: { name: "Dinner Party", status: "active", currentRound: 2, strictMovement: false, mapPackage: { fog: { mode: "off", doors: [] } } }, undo: { available: 1, redoAvailable: 0 } } as unknown as EncounterState;

function commandBar(overrides: Partial<Parameters<typeof BattleMapCommandBar>[0]> = {}) {
  const props: Parameters<typeof BattleMapCommandBar>[0] = {
    participant: dm, state, annotationMode: "move", editingSharedFog: false, chatOpen: false, chatMinimized: false, chatUnreadTotal: 3,
    paletteOpen: false, spellPaletteOpen: false, busy: false, viewport: { zoom: 1, centerX: 12, centerY: 8, mapKey: "map", fit: false }, effectiveZoom: 1,
    connection: "live", connectionLabel: "Live", connectionTooltip: "Live connection", uiSettingsRef: { current: null }, gridOpacity: 0.17,
    showColoredTokenCenters: true, showHealthRings: true, sidebarOpen: true, presenting: false,
    durableAnnotationCount: 0,
    onAnnotationMode: vi.fn(), onToggleFogEditor: vi.fn(), onRequestClearAnnotations: vi.fn(), onToggleChat: vi.fn(), onToggleCreatures: vi.fn(), onToggleSpells: vi.fn(), onOpenDashboard: vi.fn(), onHistory: vi.fn(), onFit: vi.fn(), onZoom: vi.fn(), onResetZoom: vi.fn(), onGridOpacityChange: vi.fn(), onColoredTokenCentersChange: vi.fn(), onHealthRingsChange: vi.fn(), onFogModeChange: vi.fn(), onVisionDoorChange: vi.fn(), onStrictMovementChange: vi.fn(), onToggleSidebar: vi.fn(), onTogglePresenting: vi.fn(), ...overrides,
  };
  render(<BattleMapCommandBar {...props} />); return props;
}

describe("BattleMapCommandBar", () => {
  it("keeps tactical tools active until the user selects another mode", async () => {
    const onAnnotationMode = vi.fn(); commandBar({ annotationMode: "ping", onAnnotationMode });
    expect(screen.getByRole("button", { name: "Ping map" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Draw line" }));
    expect(onAnnotationMode).toHaveBeenCalledWith("drawing");
  });
  it("shows compact history, chat badge, and layout controls", async () => {
    const props = commandBar();
    expect(screen.getByLabelText("Chat, 3 unread messages")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Redo last action" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Undo last action" }));
    expect(props.onHistory).toHaveBeenCalledWith("undo");
  });
  it("returns every participant to campaign home from the map", async () => {
    const onOpenDashboard = vi.fn(); commandBar({ participant: player, onOpenDashboard });
    await userEvent.click(screen.getByRole("button", { name: "Back to campaign home" }));
    expect(onOpenDashboard).toHaveBeenCalledOnce();
  });
  it("keeps encounter setup off the live battle map", () => {
    commandBar();
    expect(screen.queryByRole("button", { name: /Map Workshop|Encounter Setup/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Manage current encounter|Encounter details/i })).toBeNull();
  });
  it("shows the effective zoom percentage while Fit remains active", async () => {
    const props = commandBar({
      viewport: { zoom: 1, centerX: 12, centerY: 8, mapKey: "map", fit: true },
      effectiveZoom: 0.625,
    });
    expect(screen.getByRole("button", { name: "Fit whole map" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Reset zoom to 100%, currently 63%" }).textContent).toBe("63%");
    await userEvent.click(screen.getByRole("button", { name: "Reset zoom to 100%, currently 63%" }));
    expect(props.onResetZoom).toHaveBeenCalledOnce();
  });
  it("uses a presentation glyph distinct from the Fit glyph", () => {
    commandBar();
    const fitPath = screen.getByRole("button", { name: "Fit whole map" }).querySelector("path")?.getAttribute("d");
    const presentPath = screen.getByRole("button", { name: "Presentation mode" }).querySelector("path")?.getAttribute("d");
    expect(presentPath).toBeTruthy();
    expect(presentPath).not.toBe(fitPath);
  });
  it("separates browser-local display settings from DM encounter settings", async () => {
    const props = commandBar();
    const settingsLauncher = screen.getAllByLabelText("UI Settings").find((element) => element.tagName === "SUMMARY");
    expect(settingsLauncher).toBeTruthy();
    await userEvent.click(settingsLauncher!);
    await userEvent.click(screen.getByLabelText("Health rings"));
    expect(props.onHealthRingsChange).toHaveBeenCalledWith(false);
    expect(screen.getByLabelText("Strict movement")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(settingsLauncher!.closest("details")?.hasAttribute("open")).toBe(false);
  });
  it("requests confirmation only when durable drawings exist", async () => {
    commandBar();
    expect((screen.getByRole("button", { name: "No drawings to clear" }) as HTMLButtonElement).disabled).toBe(true);

    const onRequestClearAnnotations = vi.fn();
    commandBar({ durableAnnotationCount: 2, onRequestClearAnnotations });
    await userEvent.click(screen.getByRole("button", { name: "Clear 2 drawings" }));
    expect(onRequestClearAnnotations).toHaveBeenCalledOnce();
  });
});

describe("placement palettes", () => {
  it("keeps creature placement repeatable and closes through the shared close control", async () => {
    const onArm = vi.fn(); const onClose = vi.fn();
    render(<CreaturePalette participant={player} tokens={[baseToken]} playerCharacter={baseToken} creatures={[{ id: "wolf", name: "Wolf", family: "Beast", size: "medium", thumbnailAsset: "/wolf.png", artAsset: "/wolf.png", armorClass: 13, defaultHp: 11, hitDice: "2d8+2", challengeRating: "1/4", creatureType: "beast", defaultSpeed: 40, speeds: { walk: 40, fly: 0, swim: 0, climb: 0, burrow: 0 } }]} families={["Beast"]} query="" family="" cursor={null} loading={false} error="" armedId="wolf" summonerId="" onClose={onClose} onSummonerChange={vi.fn()} onQueryChange={vi.fn()} onFamilyChange={vi.fn()} onArm={onArm} onDragStart={vi.fn()} onDragEnd={vi.fn()} onLoadMore={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Wolf/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("Tap the visible map to place copies");
    expect(screen.getByText(/click repeatedly to place copies/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Close creature palette" })); expect(onClose).toHaveBeenCalledOnce();
  });
  it("describes spell placement as a one-placement selection", async () => {
    const onArm = vi.fn();
    render(<SpellPalette participant={player} playerCharacter={baseToken} armedId="moonbeam" onClose={vi.fn()} onArm={onArm} onDragStart={vi.fn()} onDragEnd={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Moonbeam/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("Tap the visible map to place it once");
    await userEvent.click(screen.getByRole("button", { name: "Cancel spell placement" }));
    expect(onArm).toHaveBeenCalledWith(null);
  });
});
