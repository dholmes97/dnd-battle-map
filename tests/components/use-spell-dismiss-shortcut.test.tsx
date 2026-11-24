import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSpellDismissShortcut } from "@/app/use-spell-dismiss-shortcut";
import type { SharedToken } from "@/shared/contracts";

const spell = {
  id: "spell", name: "Moonbeam", kind: "spell-effect", controlledByViewer: true,
} as SharedToken;

function Harness({ onDismiss, selectedToken = spell }: { onDismiss: (token: SharedToken) => void; selectedToken?: SharedToken }) {
  useSpellDismissShortcut({ enabled: true, selectedToken, onDismiss });
  return <input aria-label="Editor" />;
}

describe("useSpellDismissShortcut", () => {
  it("dismisses an owned summon but preserves foreign summons and characters", () => {
    const onDismiss = vi.fn();
    const summon = { ...spell, kind: "summon" };
    const view = render(<Harness onDismiss={onDismiss} selectedToken={summon} />);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith(summon);
    fireEvent.keyDown(document.querySelector("input")!, { key: "Delete" });
    view.rerender(<Harness onDismiss={onDismiss} selectedToken={{ ...summon, controlledByViewer: false }} />);
    fireEvent.keyDown(window, { key: "Delete" });
    view.rerender(<Harness onDismiss={onDismiss} selectedToken={{ ...summon, kind: "character" }} />);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses the selected controlled spell with Delete or Backspace, except while editing", () => {
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} />);
    fireEvent.keyDown(window, { key: "Delete" });
    fireEvent.keyDown(window, { key: "Backspace" });
    expect(onDismiss).toHaveBeenCalledTimes(2);
    expect(onDismiss).toHaveBeenLastCalledWith(spell);

    fireEvent.keyDown(document.querySelector("input")!, { key: "Delete" });
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});
