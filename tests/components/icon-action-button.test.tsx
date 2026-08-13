import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import IconActionButton from "@/app/icon-action-button";

it.each(["close", "remove", "discard"] as const)("uses the aligned X glyph for %s actions", async (variant) => {
  const onClick = vi.fn();
  const { container } = render(<IconActionButton variant={variant} label={`${variant} item`} onClick={onClick} />);
  expect(container.querySelector("path")?.getAttribute("d")).toBe("M5 5l10 10M15 5L5 15");
  await userEvent.click(screen.getByRole("button", { name: `${variant} item` }));
  expect(onClick).toHaveBeenCalledOnce();
});

it("reserves the trash glyph for destructive deletion", () => {
  const { container } = render(<IconActionButton variant="delete" label="Delete preset" onClick={vi.fn()} />);
  expect(container.querySelector("path")?.getAttribute("d")).not.toBe("M5 5l10 10M15 5L5 15");
});
