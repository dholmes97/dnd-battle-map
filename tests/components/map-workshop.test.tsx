import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import MapWorkshop from "@/app/map-workshop";
import { createFullSceneMap, FULL_SCENE_MAPS } from "@/shared/full-scene-maps";

vi.mock("next/image", () => ({
  default: () => <span aria-hidden="true" />,
}));
vi.mock("@/app/map-scene-renderer", () => ({ renderMapPackageToContext: vi.fn() }));

const originalResizeObserver = globalThis.ResizeObserver;
const originalGetContext = HTMLCanvasElement.prototype.getContext;

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), save: vi.fn(), restore: vi.fn(),
    closePath: vi.fn(), fill: vi.fn(), setLineDash: vi.fn(), arc: vi.fn(), ellipse: vi.fn(),
    strokeRect: vi.fn(), measureText: () => ({ width: 12 }),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

function setup(command = vi.fn(async () => ({ state: {} }))) {
  const map = createFullSceneMap(FULL_SCENE_MAPS[0]);
  const onClose = vi.fn();
  const view = render(<MapWorkshop
    activeMapPackage={map}
    activeMapPresetId={null}
    savedPresets={[]}
    onCommand={command as never}
    onClose={onClose}
  />);
  return { command, map, onClose, unmount: view.unmount };
}

async function makeDirty(description = "A revised private map") {
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: description } });
  await waitFor(() => expect(screen.getByText("Private changes")).toBeTruthy());
}

describe("MapWorkshop exit safeguards", () => {
  it("returns immediately when the draft is clean", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    await user.click(screen.getByRole("button", { name: "Return to battle map" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps a dirty draft by default and restores focus to Return", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    await makeDirty();
    const returnButton = screen.getByRole("button", { name: "Return to battle map" });
    await user.click(returnButton);
    expect(screen.getByRole("dialog", { name: "Return without applying?" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep editing" }));
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Private changes")).toBeTruthy();
    expect(document.activeElement).toBe(returnButton);
  });

  it("confirms header discard and restores the authoritative draft without leaving", async () => {
    const user = userEvent.setup();
    const { map, onClose } = setup();
    await makeDirty();
    await user.click(screen.getByRole("button", { name: "Discard private changes" }));
    expect(screen.getByRole("dialog", { name: "Discard private changes?" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toBe(map.description);
    expect(screen.getByText("Matches players")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("offers an explicit discard-and-return path for a dirty draft", async () => {
    const user = userEvent.setup();
    const { command, onClose } = setup();
    await makeDirty();
    await user.click(screen.getByRole("button", { name: "Return to battle map" }));
    await user.click(screen.getByRole("button", { name: "Discard and return" }));
    expect(command).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("applies before returning and keeps the workshop open after rejection", async () => {
    const user = userEvent.setup();
    const accepted = vi.fn(async () => ({ state: {} }));
    const success = setup(accepted);
    await makeDirty("Published description");
    await user.click(screen.getByRole("button", { name: "Return to battle map" }));
    await user.click(screen.getByRole("button", { name: "Apply and return" }));
    await waitFor(() => expect(success.onClose).toHaveBeenCalledOnce());
    expect(accepted).toHaveBeenCalledWith("apply-map-package", expect.objectContaining({
      mapPackage: expect.objectContaining({ description: "Published description" }),
    }));
    success.unmount();

    const rejected = vi.fn(async () => { throw new Error("Server kept the applied map unchanged."); });
    const failure = setup(rejected);
    await makeDirty("Rejected description");
    await user.click(screen.getByRole("button", { name: "Return to battle map" }));
    await user.click(screen.getByRole("button", { name: "Apply and return" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Server kept the applied map unchanged."));
    expect(failure.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Return without applying?" })).toBeTruthy();
  });
});

describe("MapWorkshop keyboard-equivalent authoring", () => {
  it("creates, moves, and deletes a label without a pointer", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Add map label" }));
    await user.type(screen.getByLabelText("Text"), "Keyboard waypoint");
    const canvas = screen.getByRole("application", { name: /editable map draft/i });
    canvas.focus();
    await user.keyboard("{Enter}");

    await user.click(screen.getByText("Map details"));
    const label = screen.getByRole("button", { name: /Keyboard waypoint.*everyone/i });
    expect(label.getAttribute("aria-pressed")).toBe("true");
    const x = screen.getByLabelText("Selected annotation X coordinate");
    fireEvent.change(x, { target: { value: "7.25" } });
    expect((x as HTMLInputElement).value).toBe("7.25");

    canvas.focus();
    await user.keyboard("{Delete}");
    expect(screen.queryByRole("button", { name: /Keyboard waypoint.*everyone/i })).toBeNull();
    expect(screen.getByText("Private changes")).toBeTruthy();
  });

  it("creates a vision wall and edits both endpoints without a pointer", async () => {
    const user = userEvent.setup();
    setup();
    await user.selectOptions(screen.getByLabelText("Visibility mode"), "dynamic");
    await user.click(screen.getByRole("button", { name: "Vision wall" }));
    const canvas = screen.getByRole("application", { name: /editable map draft/i });
    canvas.focus();
    await user.keyboard("{Enter}{ArrowRight}{ArrowRight}{Enter}");

    await user.click(screen.getByText("Vision geometry"));
    const wall = screen.getByRole("button", { name: /Vision wall 1/i });
    expect(wall.getAttribute("aria-pressed")).toBe("true");
    const startX = screen.getByLabelText("Selected blocker start X coordinate");
    const endY = screen.getByLabelText("Selected blocker end Y coordinate");
    fireEvent.change(startX, { target: { value: "3.5" } });
    fireEvent.change(endY, { target: { value: "9.25" } });
    expect((startX as HTMLInputElement).value).toBe("3.5");
    expect((endY as HTMLInputElement).value).toBe("9.25");
  });

  it("moves shared-fog corners and resizes round blockers through keyboard-accessible controls", async () => {
    const user = userEvent.setup();
    setup();
    await user.selectOptions(screen.getByLabelText("Visibility mode"), "shared");
    await user.click(screen.getByText("Vision geometry"));
    await user.click(screen.getByRole("button", { name: /Fog corner 1/i }));
    const fogX = screen.getByLabelText("Selected fog corner X coordinate");
    fireEvent.change(fogX, { target: { value: "1.25" } });
    expect((fogX as HTMLInputElement).value).toBe("1.25");

    await user.selectOptions(screen.getByLabelText("Visibility mode"), "dynamic");
    await user.click(screen.getByRole("button", { name: "Round blocker" }));
    const canvas = screen.getByRole("application", { name: /editable map draft/i });
    canvas.focus();
    await user.keyboard("{Enter}{ArrowRight}{Enter}");
    const radius = screen.getByLabelText("Selected round blocker radius");
    fireEvent.change(radius, { target: { value: "2.5" } });
    expect((radius as HTMLInputElement).value).toBe("2.5");
  });
});
