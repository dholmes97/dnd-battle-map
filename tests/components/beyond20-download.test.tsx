import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { Beyond20Download, BEYOND20_DOWNLOAD } from "@/app/beyond20-download";

it("keeps Chrome setup compact and exposes a real download with instructions", async () => {
  render(<Beyond20Download />);
  const summary = screen.getByText("D&D Beyond HP sync").closest("summary")!;
  const panel = summary.closest("details")!;
  expect(panel.open).toBe(false);
  await userEvent.click(summary);
  expect(panel.open).toBe(true);
  const download = screen.getByRole("link", { name: "Download patched Beyond20 · ZIP" });
  expect(download.getAttribute("href")).toBe(BEYOND20_DOWNLOAD);
  expect(download.hasAttribute("download")).toBe(true);
  expect(screen.getByText("chrome://extensions")).toBeTruthy();
  expect(screen.getByText("Load unpacked")).toBeTruthy();
  expect(screen.getByText("https://dnd.fridaylunchcrew.com/")).toBeTruthy();
  expect(screen.getByText(/unofficial Chrome desktop build/)).toBeTruthy();
});
