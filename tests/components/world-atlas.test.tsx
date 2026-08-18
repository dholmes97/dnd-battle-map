import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JoinScreen } from "@/app/join-screen";
import { WorldAtlas } from "@/app/world-map/world-atlas";

describe("WorldAtlas", () => {
  it("moves through distinct continent, regional, and city maps", () => {
    render(<WorldAtlas />);

    expect(screen.getByRole("heading", { name: "Faerûn" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open detailed map of Sword Coast" }));
    expect(screen.getByRole("heading", { name: "The Sword Coast" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open detailed map of Waterdeep" }));
    expect(screen.getByRole("heading", { name: "Waterdeep" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dock Ward" })).toBeTruthy();
  });

  it("keeps the atlas as a separate landing-page destination", () => {
    render(<JoinScreen encounters={[{ code: "ember-keep", name: "Ember Keep", status: "setup", updatedAt: 0 }]} selectedCode="ember-keep" joiningIdentity={null} busy={false} error="" identities={[{ label: "Dan", participantName: "Dan", role: "player" }]} onEncounterChange={vi.fn()} onJoin={vi.fn()} />);

    const atlasLink = screen.getByRole("link", { name: /Open the World Atlas/i });
    expect(atlasLink.getAttribute("href")).toBe("/world-map");
  });
});
