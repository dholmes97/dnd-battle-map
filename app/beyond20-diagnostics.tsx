"use client";

import { useBeyond20Bridge } from "@/app/use-beyond20-bridge";
import { useEffect, useId, useRef, useState } from "react";
import { useBeyond20HpSync, type Beyond20Integration } from "@/app/use-beyond20-hp-sync";

function Help({ label, children }: { label: string; children: string }) {
  const id = useId();
  return <span className="beyond20-help"><button type="button" aria-label={label} aria-describedby={id}>?</button><span id={id} role="tooltip">{children}</span></span>;
}

export function Beyond20Diagnostics({ integration }: { integration?: Beyond20Integration }) {
  const hpSync = useBeyond20HpSync(integration);
  const bridge = useBeyond20Bridge(hpSync.enabled ? hpSync.receive : undefined);
  const [tokenId, setTokenId] = useState("");
  const [sheetId, setSheetId] = useState("");
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const panel = panelRef.current;
      if (panel?.open && event.target instanceof Node && !panel.contains(event.target)) panel.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      const panel = panelRef.current;
      if (event.key !== "Escape" || !panel?.open) return;
      event.preventDefault();
      event.stopPropagation();
      panel.open = false;
      panel.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, []);
  const characters = integration?.state.tokens.filter((token) => token.campaignCharacterId && !token.summonerTokenId) ?? [];
  const selected = characters.find((token) => token.id === tokenId);
  const eligible = characters.filter((token) => token.canSyncBeyond20 && token.beyond20CharacterId);
  const saveLink = async (value: string | null) => {
    if (!integration || !selected) return;
    setSaving(true);
    try { await integration.onLink(selected.id, value); } finally { setSaving(false); }
  };
  return <details ref={panelRef} className="beyond20-diagnostics toolbar-popover-anchor">
    <summary className="icon-tool" aria-label="Beyond20 diagnostics" title="Beyond20 diagnostics">B20</summary>
    <section className="toolbar-popover beyond20-panel" aria-label="Beyond20 diagnostics">
      <header><strong>Beyond20</strong><Help label="Beyond20 setup help">Add this app’s origin to Beyond20’s custom domains and activate the extension on this tab. Open your D&D Beyond sheet in the same browser. Rolls are preview-only; HP sync applies only to this encounter.</Help></header>
      <p role="status">{bridge.detected ? "Beyond20 detected" : "Waiting for Beyond20"}</p>
      {integration ? <>
        <p className="beyond20-link">{eligible.length ? eligible.map((token) => `${token.name} · ${token.beyond20CharacterId}`).join(" · ") : "No linked character · ask your DM"}</p>
        <div className="beyond20-control"><label><input type="checkbox" checked={hpSync.enabled} disabled={!eligible.length && !hpSync.enabled} onChange={(event) => hpSync.toggle(event.target.checked)} /> Sync HP</label><Help label="HP sync help">The next matching sheet update replaces current and temporary HP. Maximum HP must match. Decreases can trigger a concentration warning. Your choice is remembered in this browser for your character and linked sheet, including after refresh or encounter reentry. Errors pause sync until you enable it again.</Help></div>
        {hpSync.message ? <p role="status">{hpSync.message}</p> : null}
        {integration.participant.role === "dm" ? <details><summary>Manage character links · DM</summary>
          <label>Campaign character<select value={tokenId} onChange={(event) => { const token = characters.find((item) => item.id === event.target.value); setTokenId(event.target.value); setSheetId(token?.beyond20CharacterId ?? ""); }}><option value="">Choose character</option>{characters.map((token) => <option key={token.id} value={token.id}>{token.name}</option>)}</select></label>
          <p>Current sheet: {selected?.beyond20CharacterId ?? "Not linked"}. This link applies throughout the campaign; only its controller can sync.</p>
          <label>D&D Beyond character ID<input type="text" inputMode="numeric" value={sheetId} onChange={(event) => setSheetId(event.target.value)} placeholder="120144329" /></label>
          <button type="button" disabled={saving || !selected || !/^\d{1,20}$/.test(sheetId)} onClick={() => void saveLink(sheetId)}>Save sheet link</button>
          <button type="button" disabled={saving || !selected?.beyond20CharacterId} onClick={() => void saveLink(null)}>Unlink sheet</button>
        </details> : null}
      </> : null}
      <div className="beyond20-control"><label><input type="checkbox" checked={bridge.enabled} onChange={(event) => bridge.setEnabled(event.target.checked)} /> Capture events</label><Help label="Event capture help">Keep up to 20 sanitized HP and roll previews in this tab for troubleshooting. Capturing does not change shared data. Clear removes previews only.</Help></div>
      <footer><p>{bridge.events.length} of at most 20 previews{bridge.rejected ? ` · ${bridge.rejected} unsupported or invalid events` : ""}</p><button type="button" onClick={bridge.clear}>Clear previews</button></footer>
      <div className="beyond20-events">{bridge.events.map((event, index) => <details key={index}>
        <summary>{event.character.name || event.character.id} · {event.kind === "hp" ? `HP ${event.hp}/${event.maximumHp} + ${event.temporaryHp} temp` : event.title || "Roll"}</summary>
        <pre>{JSON.stringify(event, null, 2)}</pre>
      </details>)}</div>
    </section>
  </details>;
}
