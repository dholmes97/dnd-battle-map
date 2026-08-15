import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTokenControls } from "@/app/use-token-controls";
import type { EncounterSync } from "@/app/use-encounter-sync";
import type { CommandResponse, SharedToken } from "@/shared/contracts";

const concentratingToken = {
  id: "token-1",
  name: "Dar'eleth",
  hp: 20,
  maxHp: 20,
  effects: [{ id: "effect-1", name: "Bless", type: "concentration" }],
} as SharedToken;

describe("useTokenControls", () => {
  it("shows a locally known concentration reminder before the HP request resolves", async () => {
    let resolveCommand!: (value: CommandResponse | null) => void;
    const commandPromise = new Promise<CommandResponse | null>((resolve) => { resolveCommand = resolve; });
    const sync = { runOptimisticCommand: vi.fn(() => commandPromise) } as unknown as EncounterSync;
    const { result } = renderHook(() => useTokenControls({
      participant: null,
      state: null,
      sync,
      setError: vi.fn(),
      setNotice: vi.fn(),
    }));

    let damageRequest!: Promise<void>;
    act(() => { damageRequest = result.current.applyHpToToken(concentratingToken, -5); });

    expect(result.current.concentrationReminder).toMatchObject({ tokenId: "token-1", tokenName: "Dar'eleth" });

    await act(async () => {
      resolveCommand({ concentrationCheckRequired: true } as unknown as CommandResponse);
      await damageRequest;
    });
    expect(result.current.concentrationReminder).not.toBeNull();
  });
});
