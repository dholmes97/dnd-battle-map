"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Beyond20Preview } from "@/shared/beyond20";
import type { Beyond20HpSnapshot } from "@/shared/beyond20-hp";
import type { EncounterState, ParticipantSession, SharedToken } from "@/shared/contracts";

export type Beyond20Integration = {
  identityId?: string;
  state: EncounterState;
  participant: ParticipantSession;
  onSyncHp(token: SharedToken, characterId: string, hp: Beyond20HpSnapshot): Promise<boolean>;
  onLink(tokenId: string, characterId: string | null): Promise<boolean>;
};

export function useBeyond20HpSync(integration?: Beyond20Integration) {
  const links = integration?.state.tokens.filter((token) => token.canSyncBeyond20 && token.campaignCharacterId && token.beyond20CharacterId)
    .map((token) => [token.campaignCharacterId, token.beyond20CharacterId]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const preferenceKey = integration?.identityId && links?.length
    ? `beyond20-hp-sync:v1:${JSON.stringify([integration.identityId, links])}` : null;
  const latest = useRef(integration);
  const lastInputState = useRef(integration?.state);
  useEffect(() => {
    const state = integration?.state === lastInputState.current ? latest.current?.state : integration?.state;
    lastInputState.current = integration?.state;
    latest.current = integration && state ? { ...integration, state } : integration;
  }, [integration]);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  const active = useRef(false);
  const queue = useRef(Promise.resolve());
  const queued = useRef(0);
  const previous = useRef("");
  useEffect(() => () => { active.current = false; generation.current++; }, []);
  const toggle = useCallback((value: boolean) => {
    generation.current++;
    active.current = value;
    previous.current = "";
    setEnabled(value);
    if (preferenceKey) {
      try { window.localStorage.setItem(preferenceKey, value ? "on" : "off"); } catch { /* Storage may be unavailable; session consent still works. */ }
    }
    setMessage(value ? "Waiting for the next linked sheet HP update." : "HP sync is off.");
  }, [preferenceKey]);
  useEffect(() => {
    let remembered = false;
    try { remembered = Boolean(preferenceKey && window.localStorage.getItem(preferenceKey) === "on"); } catch { /* Default to off. */ }
    generation.current++;
    active.current = remembered;
    previous.current = "";
    // Restore browser-owned consent only after hydration and when its scope changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnabled(remembered);
    setMessage(remembered ? "HP sync restored. Waiting for the next linked sheet HP update." : "");
  }, [preferenceKey]);
  const receive = useCallback((event: Beyond20Preview) => {
    if (!active.current || event.kind !== "hp") return;
    const epoch = generation.current;
    if (queued.current >= 20) { toggle(false); setMessage("Too many pending HP updates. Review HP and enable sync again."); return; }
    queued.current++;
    queue.current = queue.current.then(async () => {
      if (!active.current || generation.current !== epoch) return;
      const config = latest.current;
      if (!config) return;
      const token = config.state.tokens.find((item) => item.canSyncBeyond20 && item.beyond20CharacterId === event.character.id);
      if (!token) { setMessage("Ignored HP from a sheet not linked to your controlled character."); return; }
      const signature = JSON.stringify([token.id, event.character.id, event.hp, event.maximumHp, event.temporaryHp]);
      if (signature === previous.current) return;
      const ok = await config.onSyncHp(token, event.character.id, { hp: event.hp!, maximumHp: event.maximumHp!, temporaryHp: event.temporaryHp! });
      if (generation.current !== epoch) return;
      if (!ok) { toggle(false); setMessage("HP sync paused. Resolve the reported mismatch or conflict, then enable it again."); return; }
      // React may not have painted the accepted response before the next queued
      // event runs. Carry the confirmed HP baseline forward without touching UI.
      if (latest.current) latest.current = { ...latest.current, state: { ...latest.current.state,
        tokens: latest.current.state.tokens.map((item) => item.id === token.id ? { ...item, hp: event.hp!, temporaryHp: event.temporaryHp! } : item),
      } };
      previous.current = signature;
      setMessage(`${token.name}: HP matches D&D Beyond (${event.hp}/${event.maximumHp}, ${event.temporaryHp} temporary).`);
    }).catch(() => {
      if (generation.current === epoch) { toggle(false); setMessage("HP sync paused after an error. Review HP before enabling it again."); }
    }).finally(() => { queued.current--; });
  }, [toggle]);
  return { enabled, message, toggle, receive };
}
