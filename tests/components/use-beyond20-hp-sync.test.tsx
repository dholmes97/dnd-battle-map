import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useBeyond20HpSync, type Beyond20Integration } from "@/app/use-beyond20-hp-sync";
import type { Beyond20Preview } from "@/shared/beyond20";

const event: Beyond20Preview = { kind: "hp", character: { id: "123", name: "Hero" }, hp: 18, maximumHp: 30, temporaryHp: 0 };
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
});
function config(onSyncHp = vi.fn(async () => true)) {
  return { state: { tokens: [{ id: "token", name: "Hero", hp: 20, maxHp: 30, temporaryHp: 5, canSyncBeyond20: true, beyond20CharacterId: "123" }] }, onSyncHp } as unknown as Beyond20Integration;
}

function persistentConfig() {
  const integration = config();
  integration.identityId = "dan";
  integration.state.tokens[0].campaignCharacterId = "campaign-character";
  return integration;
}

it("remembers consent across remounts without applying HP until a new event", async () => {
  const integration = persistentConfig();
  const first = renderHook(() => useBeyond20HpSync(integration));
  act(() => first.result.current.toggle(true));
  first.unmount();
  const next = renderHook(() => useBeyond20HpSync(integration));
  expect(next.result.current.enabled).toBe(true);
  expect(integration.onSyncHp).not.toHaveBeenCalled();
  await act(async () => next.result.current.receive(event));
  expect(integration.onSyncHp).toHaveBeenCalledOnce();
  act(() => next.result.current.toggle(false));
  next.unmount();
  expect(renderHook(() => useBeyond20HpSync(integration)).result.current.enabled).toBe(false);
});

it("does not inherit consent for a different identity, campaign character, or sheet", () => {
  const integration = persistentConfig();
  const hook = renderHook(({ value }) => useBeyond20HpSync(value), { initialProps: { value: integration } });
  act(() => hook.result.current.toggle(true));
  hook.rerender({ value: { ...integration, identityId: "scott" } });
  expect(hook.result.current.enabled).toBe(false);
  hook.rerender({ value: { ...integration, state: { ...integration.state, tokens: [{ ...integration.state.tokens[0], campaignCharacterId: "other" }] } } });
  expect(hook.result.current.enabled).toBe(false);
  hook.rerender({ value: { ...integration, state: { ...integration.state, tokens: [{ ...integration.state.tokens[0], beyond20CharacterId: "456" }] } } });
  expect(hook.result.current.enabled).toBe(false);
});

it("persists a safety pause after a rejected update", async () => {
  const integration = persistentConfig();
  integration.onSyncHp = vi.fn(async () => false);
  const hook = renderHook(() => useBeyond20HpSync(integration));
  act(() => hook.result.current.toggle(true));
  await act(async () => hook.result.current.receive(event));
  hook.unmount();
  expect(renderHook(() => useBeyond20HpSync(integration)).result.current.enabled).toBe(false);
});

it("is opt-in, ignores other sheets, suppresses repeated snapshots and resets when disabled", async () => {
  const integration = config();
  const { result } = renderHook(() => useBeyond20HpSync(integration));
  await act(async () => result.current.receive(event));
  expect(integration.onSyncHp).not.toHaveBeenCalled();
  act(() => result.current.toggle(true));
  await act(async () => result.current.receive({ ...event, character: { id: "456", name: "Other" } }));
  expect(integration.onSyncHp).not.toHaveBeenCalled();
  expect(result.current.message).toContain("not linked");
  await act(async () => { result.current.receive(event); result.current.receive(event); });
  expect(integration.onSyncHp).toHaveBeenCalledTimes(1);
  act(() => result.current.toggle(false));
  await act(async () => result.current.receive({ ...event, hp: 17 }));
  expect(integration.onSyncHp).toHaveBeenCalledTimes(1);
});

it("serializes rapid updates using the last accepted HP baseline", async () => {
  let resolve!: (value: boolean) => void;
  const send = vi.fn().mockImplementationOnce(() => new Promise<boolean>((r) => { resolve = r; })).mockResolvedValue(true);
  const integration = config(send);
  const { result } = renderHook(() => useBeyond20HpSync(integration));
  act(() => result.current.toggle(true));
  await act(async () => { result.current.receive(event); result.current.receive({ ...event, hp: 17 }); });
  expect(send).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(true); });
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1][0].hp).toBe(18);
});

it("pauses and drops queued events after a rejected update", async () => {
  const send = vi.fn(async () => false);
  const { result } = renderHook(() => useBeyond20HpSync(config(send)));
  act(() => result.current.toggle(true));
  await act(async () => { result.current.receive(event); result.current.receive({ ...event, hp: 17 }); });
  expect(send).toHaveBeenCalledTimes(1);
  expect(result.current.enabled).toBe(false);
  expect(result.current.message).toContain("paused");
});

it("drops queued events on unmount", async () => {
  let resolve!: (value: boolean) => void;
  const send = vi.fn(() => new Promise<boolean>((r) => { resolve = r; }));
  const { result, unmount } = renderHook(() => useBeyond20HpSync(config(send)));
  act(() => result.current.toggle(true));
  await act(async () => { result.current.receive(event); result.current.receive({ ...event, hp: 17 }); });
  unmount();
  await act(async () => { resolve(true); });
  expect(send).toHaveBeenCalledTimes(1);
});
