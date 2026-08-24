import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import MapWorkshop from "@/app/map-workshop";
import { TEST_MAP_IMAGE, testMapPackage } from "../fixtures/map-fixture";

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
  const map = testMapPackage();
  const onClose = vi.fn();
  const view = render(<MapWorkshop
    activeMapPackage={map}
    draftMapPackage={map}
    mapImages={[TEST_MAP_IMAGE]}
    onCommand={command as never}
    onClose={onClose}
  />);
  return { command, map, onClose, unmount: view.unmount };
}

async function makeDirty() {
  await userEvent.selectOptions(screen.getByLabelText("Visibility mode"), "dynamic");
  await waitFor(() => expect(screen.getByText("Unsaved draft")).toBeTruthy());
}

describe("MapWorkshop exit safeguards", () => {
  it("only enables Apply draft when the draft differs from the applied encounter map", async () => {
    const user = userEvent.setup();
    setup();
    const applyButton = screen.getByRole("button", { name: "Apply draft" });

    expect(applyButton.hasAttribute("disabled")).toBe(true);
    await makeDirty();
    expect(applyButton.hasAttribute("disabled")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Undo draft change" }));
    expect(applyButton.hasAttribute("disabled")).toBe(true);
  });

  it("returns immediately when the draft is clean", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    await user.click(screen.getByRole("button", { name: "Return to encounters" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps a dirty draft by default and restores focus to Return", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    await makeDirty();
    const returnButton = screen.getByRole("button", { name: "Return to encounters" });
    await user.click(returnButton);
    expect(screen.getByRole("dialog", { name: "Return to encounters with unsaved changes?" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep editing" }));
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Unsaved draft")).toBeTruthy();
    expect(document.activeElement).toBe(returnButton);
  });

  it("confirms header discard and restores the authoritative draft without leaving", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    await makeDirty();
    await user.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(screen.getByRole("dialog", { name: "Discard the draft?" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Discard draft" }));
    await waitFor(() => expect((screen.getByLabelText("Visibility mode") as unknown as { value: string }).value).toBe("off"));
    expect(screen.getByText("Applied")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("offers an explicit discard-and-return path for a dirty draft", async () => {
    const user = userEvent.setup();
    const { command, onClose } = setup();
    await makeDirty();
    await user.click(screen.getByRole("button", { name: "Return to encounters" }));
    await user.click(screen.getByRole("button", { name: "Discard and return" }));
    expect(command).toHaveBeenCalledWith("discard-map-draft", {});
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("applies before returning and keeps the workshop open after rejection", async () => {
    const user = userEvent.setup();
    const accepted = vi.fn(async () => ({ state: {} }));
    const success = setup(accepted);
    await makeDirty();
    await user.click(screen.getByRole("button", { name: "Return to encounters" }));
    await user.click(screen.getByRole("button", { name: "Apply and return" }));
    await waitFor(() => expect(success.onClose).toHaveBeenCalledOnce());
    expect(accepted).toHaveBeenCalledWith("apply-map-draft", expect.objectContaining({
      mapPackage: expect.objectContaining({ fog: expect.objectContaining({ mode: "dynamic" }) }),
    }));
    success.unmount();

    const rejected = vi.fn(async () => { throw new Error("Server kept the applied map unchanged."); });
    const failure = setup(rejected);
    await makeDirty();
    await user.click(screen.getByRole("button", { name: "Return to encounters" }));
    await user.click(screen.getByRole("button", { name: "Apply and return" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Server kept the applied map unchanged."));
    expect(failure.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Return to encounters with unsaved changes?" })).toBeTruthy();
  });
});

describe("MapWorkshop keyboard-equivalent authoring", () => {
  it("reveals the keyboard cursor only after keyboard navigation", async () => {
    const user = userEvent.setup();
    setup();
    const canvas = screen.getByRole("application", { name: /editable map draft/i });
    canvas.focus();
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Press an arrow key to reveal"));
    expect(document.activeElement).toBe(canvas);
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("status").textContent).toContain("Workshop cursor at");
  });

  it("creates, moves, and deletes a label without a pointer", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Add map label" }));
    const canvas = screen.getByRole("application", { name: /editable map draft/i });
    canvas.focus();
    await user.keyboard("{Enter}");
    const labelEditor = screen.getByLabelText("Label text");
    await waitFor(() => expect(document.activeElement).toBe(labelEditor));
    await user.type(labelEditor, "Keyboard waypoint{Enter}");

    await user.click(screen.getByText("Map details"));
    const label = screen.getByRole("button", { name: /Keyboard waypoint.*everyone/i });
    expect(label.getAttribute("aria-pressed")).toBe("true");
    await user.click(label);
    expect(screen.getByRole("form", { name: "Edit map label" })).toBeTruthy();
    const editLabel = screen.getByLabelText("Label text");
    expect((editLabel as HTMLInputElement).value).toBe("Keyboard waypoint");
    await user.clear(editLabel);
    await user.type(editLabel, "Revised waypoint");
    await user.click(within(screen.getByRole("group", { name: "Label visibility" })).getByRole("button", { name: "DM only" }));
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: /Revised waypoint.*dm/i })).toBeTruthy();
    const x = screen.getByLabelText("Selected annotation X coordinate");
    fireEvent.change(x, { target: { value: "7.25" } });
    expect((x as HTMLInputElement).value).toBe("7.25");

    canvas.focus();
    await user.keyboard("{Delete}");
    expect(screen.queryByRole("button", { name: /Revised waypoint.*dm/i })).toBeNull();
    expect(screen.getByText("Unsaved draft")).toBeTruthy();
  });

  it("creates and re-edits a DM note directly on the map", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Add DM note" }));
    const canvas = screen.getByRole("application", { name: /editable map draft/i });
    canvas.focus();
    await user.keyboard("{Enter}");
    const noteEditor = screen.getByLabelText("DM note text");
    await waitFor(() => expect(document.activeElement).toBe(noteEditor));
    await user.type(noteEditor, "Private clue{Enter}");

    await user.click(screen.getByText("Map details"));
    const note = screen.getByRole("button", { name: /DM note 1.*Private clue/i });
    await user.click(note);
    expect(screen.getByRole("form", { name: "Edit DM note" })).toBeTruthy();
    const editNote = screen.getByLabelText("DM note text");
    expect((editNote as HTMLTextAreaElement).value).toBe("Private clue");
    await user.clear(editNote);
    await user.type(editNote, "Revised private clue{Enter}");
    expect(screen.getByRole("button", { name: /DM note 1.*Revised private clue/i })).toBeTruthy();
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
