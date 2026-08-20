import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSpellDismissShortcut } from "@/app/use-spell-dismiss-shortcut";
import type { SharedToken } from "@/shared/contracts";

const spell = {
  id: "spell", name: "Moonbeam", kind: "spell-effect", controlledByViewer: true,
} as SharedToken;

function Harness({ onDismiss }: { onDismiss: (token: SharedToken) => void }) {
  useSpellDismissShortcut({ enabled: true, selectedToken: spell, onDismiss });
  return <input aria-label="Editor" />;
}

describe("useSpellDismissShortcut", () => {
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
