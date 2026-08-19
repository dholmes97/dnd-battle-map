"use client";

import { HandoutLightbox, ScenarioHandouts } from "@/app/chat-handouts-ui";
import type { EncounterState, ParticipantSession, SharedHandout } from "@/shared/contracts";
import type { useScenarioControls } from "@/app/use-scenario-controls";

type ScenarioControls = ReturnType<typeof useScenarioControls>;
type LightboxHandout = Parameters<typeof HandoutLightbox>[0]["handout"];
export type ConcentrationReminder = { tokenId: string; tokenName: string };

export function ConcentrationReminderDialog({ reminder, onDismiss }: {
  reminder: ConcentrationReminder;
  onDismiss: () => void;
}) {
  return <div className="modal-shadowbox concentration-reminder-shadowbox" role="presentation">
    <section role="alertdialog" aria-modal="true" aria-labelledby="concentration-reminder-title" aria-describedby="concentration-reminder-description">
      <header>
        <span><small>Combat reminder</small><strong id="concentration-reminder-title">Concentration check required</strong></span>
      </header>
      <div className="concentration-reminder-content">
        <div className="concentration-reminder-sigil" aria-hidden="true"><span>◆</span></div>
        <p id="concentration-reminder-description"><strong>{reminder.tokenName}</strong> took damage while concentrating. Make the required Constitution saving throw now.</p>
      </div>
      <footer><button type="button" className="primary-button" autoFocus onClick={onDismiss}>Dismiss reminder</button></footer>
    </section>
  </div>;
}

export function EncounterDialogs({ participant, state, resetOpen, restartOpen, concentrationReminder, scenario, handoutTitle, handoutUploading, handoutUploadError, handoutDeletingId, lightboxHandout, handoutFitMode, onResetOpen, onRestartOpen, onReset, onRestart, onDismissConcentrationReminder, onHandoutTitle, onUploadHandout, onPreviewHandout, onDeleteHandout, onHandoutFitMode, onCloseLightbox }: {
  participant: ParticipantSession;
  state: EncounterState;
  resetOpen: boolean;
  restartOpen: boolean;
  concentrationReminder: ConcentrationReminder | null;
  scenario: ScenarioControls;
  handoutTitle: string;
  handoutUploading: boolean;
  handoutUploadError: string;
  handoutDeletingId: string | null;
  lightboxHandout: LightboxHandout | null;
  handoutFitMode: boolean;
  onResetOpen: (open: boolean) => void;
  onRestartOpen: (open: boolean) => void;
  onReset: () => void;
  onRestart: () => void;
  onDismissConcentrationReminder: () => void;
  onHandoutTitle: (title: string) => void;
  onUploadHandout: (file: File, title: string, replaceId: string | null) => void;
  onPreviewHandout: (handout: SharedHandout) => void;
  onDeleteHandout: (handout: SharedHandout) => void;
  onHandoutFitMode: (fit: boolean) => void;
  onCloseLightbox: () => void;
}) {
  if (participant.role !== "dm") return <>
    {lightboxHandout?.available ? <HandoutLightbox participant={participant} encounterCode={state.encounter.code} handout={lightboxHandout} fitMode={handoutFitMode} onFitModeChange={onHandoutFitMode} onClose={onCloseLightbox} /> : null}
    {concentrationReminder ? <ConcentrationReminderDialog reminder={concentrationReminder} onDismiss={onDismissConcentrationReminder} /> : null}
  </>;
  return <>
    {resetOpen ? <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onResetOpen(false); }}><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-encounter-title" aria-describedby="reset-encounter-description"><div className="eyebrow">Encounter control</div><h2 id="reset-encounter-title">Reset combat?</h2><p id="reset-encounter-description">This returns the encounter to setup, clears the current round, active turn, and movement tracking. The map, tokens, HP, effects, and entered initiative numbers stay intact.</p><div className="button-row"><button className="secondary-button" autoFocus onClick={() => onResetOpen(false)}>Cancel</button><button className="danger-button" onClick={onReset}>Reset combat</button></div></section></div> : null}
    {restartOpen ? <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onRestartOpen(false); }}><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="restart-combat-title" aria-describedby="restart-combat-description"><div className="eyebrow">Encounter control</div><h2 id="restart-combat-title">Restart combat?</h2><p id="restart-combat-description">This returns combat to round 1 and rebuilds the turn order from the current initiative numbers. Movement and completed-turn tracking reset. The map, tokens, HP, and effects stay intact.</p><div className="button-row"><button className="secondary-button" autoFocus onClick={() => onRestartOpen(false)}>Cancel</button><button className="danger-button" onClick={onRestart}>Restart combat</button></div></section></div> : null}
    {scenario.open ? <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !scenario.renaming && !handoutUploading) scenario.setOpen(false); }}><section className="confirm-dialog scenario-dialog" role="dialog" aria-modal="true" aria-labelledby="manage-scenarios-title" aria-describedby="manage-scenarios-description"><div className="eyebrow">Current scenario</div><h2 id="manage-scenarios-title">Scenario details</h2><p id="manage-scenarios-description">Rename this scenario or manage the handouts attached to it. Create and duplicate scenarios from Campaign Home.</p>{state.encounter.dmBriefing ? <section className="scenario-briefing" aria-labelledby="scenario-briefing-title"><div className="scenario-create-heading"><strong id="scenario-briefing-title">DM briefing</strong><small>Prepared with this scenario</small></div><p>{state.encounter.dmBriefing}</p></section> : null}<div className="scenario-rename-section"><label>Current scenario name<input autoFocus maxLength={64} value={scenario.renameName} onChange={(event) => scenario.setRenameName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void scenario.rename(); } }} disabled={scenario.renaming} /></label>{scenario.renameError ? <div className="form-error" role="alert">{scenario.renameError}</div> : null}<div className="button-row"><button className={`secondary-button${scenario.renaming ? " is-pending" : ""}`} onClick={() => void scenario.rename()} disabled={scenario.renaming || scenario.renameName.trim().length < 3 || scenario.renameName.trim() === state.encounter.name}>{scenario.renaming ? "Saving…" : "Rename current scenario"}</button></div></div>
      <ScenarioHandouts participant={participant} encounterCode={state.encounter.code} handouts={state.handouts} title={handoutTitle} uploading={handoutUploading} uploadError={handoutUploadError} deletingId={handoutDeletingId} onTitleChange={onHandoutTitle} onUpload={(file, title, replaceId) => onUploadHandout(file, title, replaceId ?? null)} onPreview={onPreviewHandout} onDelete={onDeleteHandout} />
      <div className="button-row"><button className="secondary-button" onClick={() => scenario.setOpen(false)} disabled={scenario.renaming || handoutUploading}>Close</button></div></section></div> : null}
    {lightboxHandout?.available ? <HandoutLightbox participant={participant} encounterCode={state.encounter.code} handout={lightboxHandout} fitMode={handoutFitMode} onFitModeChange={onHandoutFitMode} onClose={onCloseLightbox} /> : null}
    {concentrationReminder ? <ConcentrationReminderDialog reminder={concentrationReminder} onDismiss={onDismissConcentrationReminder} /> : null}
  </>;
}
