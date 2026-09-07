import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Beyond20Diagnostics } from "@/app/beyond20-diagnostics";
import { parseBeyond20Preview } from "@/shared/beyond20";

// Sanitized synthetic values using envelope shapes verified with the live extension.
const character = { id: "123456", name: "Test Ranger", hp: 17, "max-hp": 30, "temp-hp": 5, settings: { secret: "PRIVATE" }, avatar: "PRIVATE" };
const hp = { action: "hp-update", character };
const roll = (type: string, fallback = false) => ({
  action: "rendered-roll", character: character.name, title: "Test roll", request: { type, character },
  rendered: fallback ? "fallback" : undefined, html: "<img src=x onerror=alert(1)>",
  attack_rolls: [{ formula: "1d20 + 4", total: 19, parts: [{ faces: 20, rolls: [{ roll: 15 }] }, "+", 4] }],
  damage_rolls: type === "attack" ? [["Piercing", { formula: "1d8 + 2", total: 6, parts: [{ faces: 8, rolls: [{ roll: 4 }] }] }, 1]] : [],
});
const emit = (name: string, value: unknown) => act(() => { document.dispatchEvent(new CustomEvent(name, { detail: name === "Beyond20_UpdateHP" ? [value, character.name, character.hp, character["max-hp"], character["temp-hp"]] : [value] })); });

describe("Beyond20 read-only diagnostics", () => {
  it("closes on outside pointer interaction and Escape without disabling capture", async () => {
    const user = userEvent.setup();
    const view = render(<><Beyond20Diagnostics /><button>Outside</button></>);
    const trigger = screen.getByLabelText("Beyond20 diagnostics", { selector: "summary" });
    const panel = view.container.querySelector("details")!;
    await user.click(trigger);
    await user.click(screen.getByLabelText("Capture events"));
    expect(panel.open).toBe(true);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    expect(panel.open).toBe(false);
    emit("Beyond20_UpdateHP", hp);
    await user.click(trigger);
    expect(screen.getByText("1 of at most 20 previews")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Beyond20 setup help" }));
    expect(panel.open).toBe(true);
    await user.keyboard("{Escape}");
    expect(panel.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });
  it("captures only while enabled, bounds history, clears previews, and never sends requests", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const view = render(<Beyond20Diagnostics />);
    emit("Beyond20_UpdateHP", hp);
    expect(screen.getByText("0 of at most 20 previews")).toBeTruthy();
    expect(screen.getByText("Beyond20 detected")).toBeTruthy();
    emit("Beyond20_Loaded", {});
    expect(screen.getByText("Beyond20 detected")).toBeTruthy();
    await userEvent.click(screen.getByLabelText("Capture events"));
    for (let i = 0; i < 25; i++) emit("Beyond20_UpdateHP", hp);
    expect(screen.getByText("20 of at most 20 previews")).toBeTruthy();
    expect(view.container.textContent).not.toContain("PRIVATE");
    await userEvent.click(screen.getByRole("button", { name: "Clear previews" }));
    expect(screen.getByText("0 of at most 20 previews")).toBeTruthy();
    emit("Beyond20_UpdateHP", { ...hp, character: { ...character, hp: null } });
    expect(screen.getByText(/1 unsupported or invalid/)).toBeTruthy();
    view.unmount();
    emit("Beyond20_UpdateHP", hp);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });

  it("detects rejected events even when the initial Loaded event was missed", async () => {
    render(<Beyond20Diagnostics />);
    await userEvent.click(screen.getByLabelText("Capture events"));
    emit("Beyond20_RenderedRoll", { action: "rendered-roll" });
    expect(screen.getByText("Beyond20 detected")).toBeTruthy();
    expect(screen.getByText(/1 unsupported or invalid/)).toBeTruthy();
  });

  it("accepts the live five-argument HP envelope but ignores redundant positional data", () => {
    expect(parseBeyond20Preview("Beyond20_UpdateHP", [hp, "WRONG", 999, 999, 999])).toEqual({
      kind: "hp", character: { id: character.id, name: character.name }, hp: 17, maximumHp: 30, temporaryHp: 5,
    });
    expect(parseBeyond20Preview("Beyond20_UpdateHP", [null, character.name, 17, 30, 5])).toBeNull();
  });

  it.each(["ability", "attack", "saving-throw"])("projects %s digital dice without retaining HTML or sheet settings", (type) => {
    const result = parseBeyond20Preview("Beyond20_RenderedRoll", [roll(type)]);
    expect(result?.rolls?.[0]).toEqual({ formula: "1d20 + 4", total: 19, dice: [{ sides: 20, values: [15] }] });
    expect(result?.rolls).toHaveLength(type === "attack" ? 2 : 1);
    expect(result?.fallback).toBe(false);
    expect(result?.character).toEqual({ id: character.id, name: character.name });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|<img|settings/);
  });

  it("distinguishes fallback rolls and rejects malformed HP and unsupported events", () => {
    expect(parseBeyond20Preview("Beyond20_RenderedRoll", [roll("skill", true)])?.fallback).toBe(true);
    expect(parseBeyond20Preview("Beyond20_UpdateHP", [hp])?.hp).toBe(17);
    for (const detail of [null, [], [null], [{ ...hp, character: { ...character, hp: 99 } }], [{ ...hp, character: { ...character, id: "bad" } }]]) {
      expect(parseBeyond20Preview("Beyond20_UpdateHP", detail)).toBeNull();
    }
    expect(parseBeyond20Preview("Beyond20_UpdateConditions", [hp])).toBeNull();
    expect(parseBeyond20Preview("Beyond20_RenderedRoll", [{ action: "rendered-roll", character }])).toBeNull();
  });
});
