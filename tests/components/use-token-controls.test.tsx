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
  it("syncs exact HP and temporary HP with an immediate concentration warning and clears it on rejection", async () => {
    let resolve!: (value: null) => void;
    const send = vi.fn(() => new Promise<null>((r) => { resolve = r; }));
    const { result } = renderHook(() => useTokenControls({ participant: null, state: null,
      sync: { runOptimisticCommand: send } as unknown as EncounterSync, setError: vi.fn(), setNotice: vi.fn() }));
    const token = { ...concentratingToken, temporaryHp: 5, canSyncBeyond20: true, beyond20CharacterId: "123" };
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.syncBeyond20Hp(token, "123", { hp: 20, maximumHp: 20, temporaryHp: 2 }); });
    expect(result.current.concentrationReminder?.tokenId).toBe(token.id);
    expect(send.mock.calls[0]).toMatchObject(["sync-beyond20-hp", { hp: 20, temporaryHp: 2, expectedHp: 20, expectedTemporaryHp: 5 }, expect.any(Function)]);
    await act(async () => { resolve(null); await pending; });
    expect(result.current.concentrationReminder).toBeNull();
  });
  it("starts with no HP action armed", () => {
    const { result } = renderHook(() => useTokenControls({
      participant: null,
      state: null,
      sync: { runOptimisticCommand: vi.fn() } as unknown as EncounterSync,
      setError: vi.fn(),
      setNotice: vi.fn(),
    }));

    expect(result.current.hpAmount).toBe("");
  });

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

    expect(result.current.hpAmount).toBe("");
    expect(result.current.concentrationReminder).toMatchObject({ tokenId: "token-1", tokenName: "Dar'eleth" });

    await act(async () => {
      resolveCommand({ concentrationCheckRequired: true } as unknown as CommandResponse);
      await damageRequest;
    });
    expect(result.current.concentrationReminder).not.toBeNull();
  });
});
