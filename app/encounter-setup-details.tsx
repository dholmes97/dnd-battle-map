"use client";

import { EncounterHandouts } from "@/app/chat-handouts-ui";
import type { ParticipantSession, SharedHandout } from "@/shared/contracts";

export function EncounterSetupDetails({ participant, encounterCode, dmBriefing, handouts, title, uploading, uploadError, deletingId, onTitleChange, onUpload, onPreview, onDelete }: {
  participant: ParticipantSession;
  encounterCode: string;
  dmBriefing: string | null;
  handouts: SharedHandout[];
  title: string;
  uploading: boolean;
  uploadError: string;
  deletingId: string | null;
  onTitleChange: (title: string) => void;
  onUpload: (file: File, title: string, replaceId?: string) => void;
  onPreview: (handout: SharedHandout) => void;
  onDelete: (handout: SharedHandout) => void;
}) {
  return <section className="encounter-setup-details" aria-labelledby="encounter-preparation-title">
    <div className="workshop-section-heading"><small>Encounter</small><strong id="encounter-preparation-title">Briefing &amp; handouts</strong></div>
    <section className="scenario-briefing" aria-labelledby="encounter-briefing-title">
      <div className="scenario-create-heading"><strong id="encounter-briefing-title">DM briefing</strong><small>Private preparation supplied with this encounter</small></div>
      {dmBriefing ? <p>{dmBriefing}</p> : <p className="is-empty">No DM briefing was provided.</p>}
    </section>
    <EncounterHandouts
      participant={participant}
      encounterCode={encounterCode}
      handouts={handouts}
      title={title}
      uploading={uploading}
      uploadError={uploadError}
      deletingId={deletingId}
      onTitleChange={onTitleChange}
      onUpload={onUpload}
      onPreview={onPreview}
      onDelete={onDelete}
    />
  </section>;
}
