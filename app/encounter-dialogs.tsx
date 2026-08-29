"use client";

import { HandoutLightbox } from "@/app/chat-handouts-ui";
import { ModalDialog } from "@/app/modal-dialog";
import type { EncounterState, ParticipantSession } from "@/shared/contracts";

type LightboxHandout = Parameters<typeof HandoutLightbox>[0]["handout"];
export type ConcentrationReminder = { tokenId: string; tokenName: string };

export function ConcentrationReminderDialog({ reminder, onDismiss }: {
  reminder: ConcentrationReminder;
  onDismiss: () => void;
}) {
  return <ModalDialog role="alertdialog" labelledBy="concentration-reminder-title" describedBy="concentration-reminder-description" backdropClassName="modal-shadowbox concentration-reminder-shadowbox" dialogClassName="" closeOnEscape={false}>
    <header>
      <span><small>Combat reminder</small><strong id="concentration-reminder-title">Concentration check required</strong></span>
    </header>
    <div className="concentration-reminder-content">
      <div className="concentration-reminder-sigil" aria-hidden="true"><span>◆</span></div>
      <p id="concentration-reminder-description"><strong>{reminder.tokenName}</strong> took damage while concentrating. Make the required Constitution saving throw now.</p>
    </div>
    <footer><button type="button" className="primary-button" data-dialog-initial-focus onClick={onDismiss}>Dismiss reminder</button></footer>
  </ModalDialog>;
}

export function EncounterDialogs({ participant, state, resetOpen, restartOpen, clearAnnotationsOpen, clearAnnotationCount, concentrationReminder, lightboxHandout, handoutFitMode, onResetOpen, onRestartOpen, onClearAnnotationsOpen, onReset, onRestart, onClearAnnotations, onDismissConcentrationReminder, onHandoutFitMode, onCloseLightbox }: {
  participant: ParticipantSession;
  state: EncounterState;
  resetOpen: boolean;
  restartOpen: boolean;
  clearAnnotationsOpen: boolean;
  clearAnnotationCount: number;
  concentrationReminder: ConcentrationReminder | null;
  lightboxHandout: LightboxHandout | null;
  handoutFitMode: boolean;
  onResetOpen: (open: boolean) => void;
  onRestartOpen: (open: boolean) => void;
  onClearAnnotationsOpen: (open: boolean) => void;
  onReset: () => void;
  onRestart: () => void;
  onClearAnnotations: () => void;
  onDismissConcentrationReminder: () => void;
  onHandoutFitMode: (fit: boolean) => void;
  onCloseLightbox: () => void;
}) {
  if (participant.role !== "dm") return <>
    {lightboxHandout?.available ? <HandoutLightbox participant={participant} encounterCode={state.encounter.code} handout={lightboxHandout} fitMode={handoutFitMode} onFitModeChange={onHandoutFitMode} onClose={onCloseLightbox} /> : null}
    {concentrationReminder ? <ConcentrationReminderDialog reminder={concentrationReminder} onDismiss={onDismissConcentrationReminder} /> : null}
  </>;
  const authoredDialogOpen = resetOpen || restartOpen || clearAnnotationsOpen;
  return <>
    {resetOpen ? <ModalDialog labelledBy="reset-encounter-title" describedBy="reset-encounter-description" closeOnBackdrop onDismiss={() => onResetOpen(false)}><div className="eyebrow">Encounter control</div><h2 id="reset-encounter-title">Reset combat?</h2><p id="reset-encounter-description">This returns the encounter to setup, clears the current round, active turn, and movement tracking. The map, tokens, HP, effects, and entered initiative numbers stay intact.</p><div className="button-row"><button className="secondary-button" data-dialog-initial-focus onClick={() => onResetOpen(false)}>Cancel</button><button className="danger-button" onClick={onReset}>Reset combat</button></div></ModalDialog> : null}
    {restartOpen ? <ModalDialog labelledBy="restart-combat-title" describedBy="restart-combat-description" closeOnBackdrop onDismiss={() => onRestartOpen(false)}><div className="eyebrow">Encounter control</div><h2 id="restart-combat-title">Restart combat?</h2><p id="restart-combat-description">This returns combat to round 1 and rebuilds the turn order from the current initiative numbers. Movement and completed-turn tracking reset. The map, tokens, HP, and effects stay intact.</p><div className="button-row"><button className="secondary-button" data-dialog-initial-focus onClick={() => onRestartOpen(false)}>Cancel</button><button className="danger-button" onClick={onRestart}>Restart combat</button></div></ModalDialog> : null}
    {clearAnnotationsOpen ? <ModalDialog labelledBy="clear-annotations-title" describedBy="clear-annotations-description" closeOnBackdrop onDismiss={() => onClearAnnotationsOpen(false)}><div className="eyebrow">Map drawings</div><h2 id="clear-annotations-title">Clear {clearAnnotationCount} {clearAnnotationCount === 1 ? "drawing" : "drawings"}?</h2><p id="clear-annotations-description">This removes every durable line from the map. Temporary pings and DM spotlights keep their normal expiry, and Undo can restore the cleared drawings.</p><div className="button-row"><button className="secondary-button" data-dialog-initial-focus onClick={() => onClearAnnotationsOpen(false)}>Keep drawings</button><button className="danger-button" onClick={onClearAnnotations}>Clear drawings</button></div></ModalDialog> : null}
    {lightboxHandout?.available ? <HandoutLightbox participant={participant} encounterCode={state.encounter.code} handout={lightboxHandout} fitMode={handoutFitMode} onFitModeChange={onHandoutFitMode} onClose={onCloseLightbox} /> : null}
    {!authoredDialogOpen && concentrationReminder ? <ConcentrationReminderDialog reminder={concentrationReminder} onDismiss={onDismissConcentrationReminder} /> : null}
  </>;
}
