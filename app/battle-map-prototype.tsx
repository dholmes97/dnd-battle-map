"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import MapWorkshop from "@/app/map-workshop";
import {
  PING_DURATION_MS,
  SPOTLIGHT_DURATION_MS,
} from "@/app/battle-map-renderer";
import { battleMapApi as api } from "@/app/battle-map-api";
import { useEncounterSync } from "@/app/use-encounter-sync";
import {
  ChatPanel,
  HandoutLightbox,
} from "@/app/chat-handouts-ui";
import { EncounterSetupDetails } from "@/app/encounter-setup-details";
import { useChatHandouts } from "@/app/use-chat-handouts";
import { useTokenControls } from "@/app/use-token-controls";
import { useDamageNotifications } from "@/app/use-damage-notifications";
import { useDamageReviewQueue } from "@/app/use-damage-review-queue";
import { useCombatRollNotifications } from "@/app/use-combat-roll-notifications";
import type { EncounterSummary } from "@/app/encounter-summary";
import { useCreatureCatalog } from "@/app/use-creature-catalog";
import { useEncounterActions } from "@/app/use-encounter-actions";
import { useMapAssets } from "@/app/use-map-assets";
import { BattleMapCommandBar, type AnnotationMode } from "@/app/battle-map-command-bar";
import { CombatActivityStack } from "@/app/combat-activity-stack";
import { EncounterDialogs } from "@/app/encounter-dialogs";
import { useHistoryShortcuts } from "@/app/use-history-shortcuts";
import { useSpellDismissShortcut } from "@/app/use-spell-dismiss-shortcut";
import { usePersonalUiSettings } from "@/app/use-personal-ui-settings";
import { useBattleMapGestures } from "@/app/use-battle-map-gestures";
import { JoinScreen, type JoinIdentity } from "@/app/join-screen";
import { CampaignList, type QaPendingAction, type QaPersona } from "@/app/campaign-list";
import { CampaignHome } from "@/app/campaign-home";
import { CreaturePalette, SpellPalette } from "@/app/battle-map-palettes";
import { CombatRollPanel, type CombatRollResponse } from "@/app/combat-roll-panel";
import { EncounterSidebar, type RosterRow } from "@/app/encounter-sidebar";
import {
  type CreatureTemplate,
} from "@/shared/creature-library";
import { TRUSTED_IDENTITIES, type CampaignAccessResponse, type CampaignAccessSummary } from "@/shared/campaigns";
import type {
  EncounterState,
  MapPoint,
  Role,
  SharedAnnotation,
  SharedToken,
} from "@/shared/contracts";
import { movementPolicyDenial } from "@/shared/battle-map-policies.ts";
import { adjudicatedDamage, transitionDamageWithTemporaryHp } from "@/shared/combat-rolling.ts";
import { commandRequest } from "@/shared/command-parser.ts";
import { buildRosterRows } from "@/shared/initiative-domain.ts";
import {
  SPELL_EFFECT_KIND,
  spellEffectByArt,
  type SpellEffectDefinition,
} from "@/shared/spell-effects";

const JOIN_IDENTITIES: JoinIdentity[] = [...TRUSTED_IDENTITIES];
const JOIN_TIMEOUT_MS = 12_000;

function playPingSound(context: AudioContext) {
  if (context.state === "closed") return;
  const sound = () => {
    const startedAt = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, startedAt);
    oscillator.frequency.exponentialRampToValueAtTime(1_320, startedAt + 0.09);
    gain.gain.setValueAtTime(0.0001, startedAt);
    gain.gain.exponentialRampToValueAtTime(0.16, startedAt + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.18);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(startedAt); oscillator.stop(startedAt + 0.19);
  };
  if (context.state === "suspended") void context.resume().then(sound).catch(() => undefined);
  else sound();
}

export default function BattleMapPrototype() {
  const [campaigns, setCampaigns] = useState<CampaignAccessSummary[]>([]);
  const [invitedIdentities, setInvitedIdentities] = useState<JoinIdentity[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [signedInIdentity, setSignedInIdentity] = useState<JoinIdentity | null>(null);
  const [appView, setAppView] = useState<"login" | "campaigns" | "dashboard" | "map">("login");
  const [authLoading, setAuthLoading] = useState(true);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [devLoginAvailable, setDevLoginAvailable] = useState(false);
  const [qaSessionInfo, setQaSessionInfo] = useState<null | { persona: QaPersona; actor: string; expiresAt: number }>(null);
  const [qaPending, setQaPending] = useState<QaPendingAction>(null);
  const [openingCode, setOpeningCode] = useState<string | null>(null);
  const [openingDestination, setOpeningDestination] = useState<"map" | "setup" | null>(null);
  const [creatingScenarioFromHome, setCreatingScenarioFromHome] = useState(false);
  const [renamingScenarioCode, setRenamingScenarioCode] = useState<string | null>(null);
  const [campaignMutationPending, setCampaignMutationPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const encounterSync = useEncounterSync({
    setError,
    setNotice,
    onSessionInvalid: () => {
      const wasQaSession = Boolean(qaSessionInfo);
      setQaSessionInfo(null);
      setAppView(wasQaSession ? "campaigns" : "dashboard");
      setError(wasQaSession
        ? "That QA persona session ended. Reopen the persona to continue."
        : "Your encounter session ended. Reopen the encounter to continue.");
    },
  });
  const {
    participant,
    state,
    connection,
    startSession,
    clearSession,
    sendCommand,
    runOptimisticCommand,
    createTokenOptimistically,
    removeTokenOptimistically,
    moveTokenOptimistically,
    isTokenPendingCreation,
  } = encounterSync;
  const tokenControls = useTokenControls({ participant, state, sync: encounterSync, setError, setNotice });
  const damageNotifications = useDamageNotifications({ participant, state });
  const damageReview = useDamageReviewQueue({ participant, state });
  const combatRollNotifications = useCombatRollNotifications({ participant, state });
  const encounterActions = useEncounterActions(encounterSync);
  const {
    pendingAction: encounterAction,
    startCombat: startCombatOptimistically,
    endTurn: endTurnOptimistically,
    advanceTurn: advanceTurnOptimistically,
    correctTurn: correctTurnOptimistically,
    configure: configureEncounterOptimistically,
    setStrictMovement: setStrictMovementOptimistically,
    setFogMode: setFogModeOptimistically,
    setVisionDoorOpen: setVisionDoorOpenOptimistically,
    updateSharedFog: updateSharedFogOptimistically,
  } = encounterActions;
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [armedAttackAttackerId, setArmedAttackAttackerId] = useState<string | null>(null);
  const [combatChooser, setCombatChooser] = useState<null | {
    attackerId: string; targetId: string; anchor: { x: number; y: number };
  }>(null);
  const [selectedMapNoteId, setSelectedMapNoteId] = useState<string | null>(null);
  const [annotationMode, setAnnotationMode] = useState<AnnotationMode>("move");
  const [busy, setBusy] = useState(false);
  const history = useHistoryShortcuts({ sync: encounterSync, busy, setNotice });
  const [workshopOpen, setWorkshopOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false);
  const [clearAnnotationsConfirmOpen, setClearAnnotationsConfirmOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [spellPaletteOpen, setSpellPaletteOpen] = useState(false);
  const [armedCreatureId, setArmedCreatureId] = useState<string | null>(null);
  const [armedSpellId, setArmedSpellId] = useState<string | null>(null);
  const [placementSummonerId, setPlacementSummonerId] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [presenting, setPresenting] = useState(false);
  const personalUiSettings = usePersonalUiSettings(participant);
  const { gridOpacity, setGridOpacity, showColoredTokenCenters, setShowColoredTokenCenters, showHealthRings, setShowHealthRings } = personalUiSettings;
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const {
    open: chatOpen,
    setOpen: setChatOpen,
    minimized: chatMinimized,
    setMinimized: setChatMinimized,
    dock: chatDock,
    activeChannel: activeChatChannel,
    setActiveChannel: setActiveChatChannel,
    draft: chatDraft,
    setDraft: setChatDraft,
    sending: chatSending,
    channels: chatChannels,
    messages: chatMessagesForChannel,
    unreadByChannel: chatUnreadByChannel,
    unreadTotal: chatUnreadTotal,
    messagesRef: chatMessagesRef,
    shouldStickRef: chatShouldStickRef,
    markChannelRead: markChatChannelRead,
    resetForParticipant: resetChatForParticipant,
    sendMessage: sendChatMessage,
    handoutTitle,
    setHandoutTitle,
    handoutUploading,
    handoutUploadError,
    setHandoutUploadError,
    handoutDeletingId,
    handoutPickerOpen,
    setHandoutPickerOpen,
    setSelectedHandoutId: setSelectedChatHandoutId,
    selectedHandout: selectedChatHandout,
    showImmediately: showHandoutImmediately,
    setShowImmediately: setShowHandoutImmediately,
    lightboxHandout,
    setLightboxHandout,
    handoutFitMode,
    setHandoutFitMode,
    uploadHandout,
    deleteHandout,
    onDockPointerDown: onChatDockPointerDown,
    onDockPointerMove: onChatDockPointerMove,
    onDockPointerEnd: onChatDockPointerEnd,
  } = useChatHandouts({ participant, state, sync: encounterSync, canvasRef, setNotice });
  const uiSettingsRef = useRef<HTMLDetailsElement>(null);
  const pingStartedAtRef = useRef<Map<string, number>>(new Map());
  const pingAudioContextRef = useRef<AudioContext | null>(null);
  const creatureCatalog = useCreatureCatalog({ open: paletteOpen, role: participant?.role });
  const {
    creatures, families: creatureFamilies, query: creatureQuery, setQuery: setCreatureQuery,
    family: creatureFamily, setFamily: setCreatureFamily, cursor: creatureCursor,
    loading: creatureCatalogLoading, error: creatureCatalogError, loadMore: loadMoreCreatures,
  } = creatureCatalog;

  useEffect(() => {
    const closeUiSettingsOutside = (event: PointerEvent) => {
      const menu = uiSettingsRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    };
    const closeUiSettingsOnEscape = (event: KeyboardEvent) => {
      const menu = uiSettingsRef.current;
      if (event.key !== "Escape" || !menu?.open) return;
      menu.open = false;
      menu.querySelector<HTMLElement>("summary")?.focus();
    };
    document.addEventListener("pointerdown", closeUiSettingsOutside);
    document.addEventListener("keydown", closeUiSettingsOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeUiSettingsOutside);
      document.removeEventListener("keydown", closeUiSettingsOnEscape);
    };
  }, []);


  const controlledTokens = state?.tokens.filter((token) => token.controlledByViewer) ?? [];
  const playerCharacter = participant?.role === "player"
    ? controlledTokens.find((token) => token.kind === "character" && !token.summonerTokenId) ?? null
    : null;
  const effectivePlacementSummonerId = participant?.role === "player"
    ? playerCharacter?.id ?? ""
    : placementSummonerId;
  const effectiveSelectedTokenId = selectedTokenId ?? controlledTokens[0]?.id ?? null;
  const selectedToken = state?.tokens.find((token) => token.id === effectiveSelectedTokenId) ?? null;
  const selectedMapNote = participant?.role === "dm" && selectedMapNoteId
    ? state?.encounter.mapPackage?.notes.find((note) => note.id === selectedMapNoteId) ?? null
    : null;
  const selectedSpell = selectedToken?.kind === SPELL_EFFECT_KIND ? spellEffectByArt(selectedToken.artAsset) : null;
  const openAttackTarget = useCallback((targetId: string, anchor: { x: number; y: number }) => {
    if (!state || !participant) return false;
    const attacker = state.tokens.find((token) => token.id === (armedAttackAttackerId ?? effectiveSelectedTokenId)) ??
      (participant.role === "player" ? playerCharacter : null);
    const target = state.tokens.find((token) => token.id === targetId);
    if (!attacker?.controlledByViewer || attacker.kind === SPELL_EFFECT_KIND || !target || target.kind === SPELL_EFFECT_KIND || attacker.id === target.id) return false;
    setCombatChooser({ attackerId: attacker.id, targetId: target.id, anchor });
    setArmedAttackAttackerId(null);
    return true;
  }, [armedAttackAttackerId, effectiveSelectedTokenId, participant, playerCharacter, state]);
  const movementEnabled = connection === "live" && !busy && state?.encounter.status !== "paused";
  const canMoveToken = (token: SharedToken) => Boolean(
    participant && state && !movementPolicyDenial({
      strictMovement: state.encounter.strictMovement,
      participantRole: participant.role,
      controlledByViewer: token.controlledByViewer,
      encounterStatus: state.encounter.status,
    }),
  );
  const enablePingAudio = () => {
    if (typeof AudioContext === "undefined") return;
    if (!pingAudioContextRef.current || pingAudioContextRef.current.state === "closed") {
      pingAudioContextRef.current = new AudioContext();
    }
    if (pingAudioContextRef.current.state === "suspended") void pingAudioContextRef.current.resume().catch(() => undefined);
  };

  const loadCampaigns = async (identity: JoinIdentity, { preserveCurrent = false } = {}) => {
    if (!preserveCurrent) setCampaignsLoading(true);
    setError("");
    try {
      const result = await api<CampaignAccessResponse>("/api/campaigns");
      setSignedInIdentity(result.identity);
      setInvitedIdentities(result.invitedIdentities);
      setCampaigns(result.items);
    } catch (caught) {
      if (!preserveCurrent) setCampaigns([]);
      setError(caught instanceof Error ? caught.message : preserveCurrent
        ? "Your campaign status could not be refreshed. Please try again."
        : "Your campaigns could not be loaded. Please try again.");
    } finally {
      if (!preserveCurrent) setCampaignsLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const restoreSession = async () => {
      try {
        const response = await fetch("/api/auth/session", { headers: { accept: "application/json" } });
        const result = await response.json() as {
          authenticated?: boolean;
          identity?: JoinIdentity;
          googleConfigured?: boolean;
          devLoginAvailable?: boolean;
        };
        if (!active) return;
        setGoogleConfigured(Boolean(result.googleConfigured ?? response.ok));
        setDevLoginAvailable(Boolean(result.devLoginAvailable));
        if (response.ok && result.authenticated && result.identity) {
          setSignedInIdentity(result.identity);
          setAppView("campaigns");
          await loadCampaigns(result.identity);
        } else {
          const authError = new URLSearchParams(window.location.search).get("authError");
          const messages: Record<string, string> = {
            "not-invited": "That Google account has not been invited to this table.",
            "account-conflict": "That Google account is already linked to a different person.",
            cancelled: "Google sign-in was cancelled or could not be verified.",
            expired: "That sign-in attempt expired. Please try again.",
            provider: "Google could not complete sign-in. Please try again.",
            configuration: "Google sign-in has not been configured yet.",
          };
          if (authError && messages[authError]) setError(messages[authError]);
          if (authError) window.history.replaceState({}, "", window.location.pathname);
        }
      } catch {
        if (active) setError("Sign-in status could not be checked. Please refresh and try again.");
      } finally {
        if (active) setAuthLoading(false);
      }
    };
    void restoreSession();
    return () => { active = false; };
  }, []);

  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null;

  const updateCampaignEncounter = (scenario: EncounterSummary) => {
    if (!selectedCampaignId) return;
    setCampaigns((current) => current.map((campaign) => campaign.id === selectedCampaignId
      ? { ...campaign, encounters: [scenario, ...campaign.encounters.filter((encounter) => encounter.code !== scenario.code)] }
      : campaign));
  };

  const join = async (identity: JoinIdentity, campaign: CampaignAccessSummary, code: string, destination: "map" | "setup" = "map") => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), JOIN_TIMEOUT_MS);
    enablePingAudio();
    setOpeningCode(code); setOpeningDestination(destination); setBusy(true); setError("");
    try {
      const result = await api<{ participantId: string; participantName: string; sessionSecret: string; role: Role; state: EncounterState }>(
        `/api/encounters/${encodeURIComponent(code)}/join`,
        { method: "POST", signal: controller.signal, body: JSON.stringify({ campaignId: campaign.id }) },
      );
      const joined = { id: result.participantId, name: result.participantName, role: result.role, sessionSecret: result.sessionSecret };
      personalUiSettings.loadForIdentity(result.participantName, result.role);
      resetChatForParticipant(result.participantName, result.role, result.state.encounter.code);
      startSession(joined, result.state);
      setWorkshopOpen(destination === "setup");
      setAppView("map");
    } catch (joinError) {
      setError(joinError instanceof DOMException && joinError.name === "AbortError"
        ? "The encounter took too long to respond. Please try again."
        : joinError instanceof Error ? joinError.message : "Unable to join.");
    } finally {
      window.clearTimeout(timeout);
      setOpeningCode(null);
      setOpeningDestination(null);
      setBusy(false);
    }
  };

  const launchQaSession = async (persona: QaPersona) => {
    if (!signedInIdentity?.canUseQaSessions) return;
    setQaPending(persona);
    setBusy(true); setError("");
    try {
      const result = await api<{ participantId: string; participantName: string; sessionSecret: string; role: Role; qa: { persona: QaPersona; actor: string; expiresAt: number }; state: EncounterState }>(
        "/api/qa/session", { method: "POST", body: JSON.stringify({ persona }) },
      );
      const joined = { id: result.participantId, name: result.participantName, role: result.role, sessionSecret: result.sessionSecret };
      personalUiSettings.loadForIdentity(result.participantName, result.role);
      resetChatForParticipant(result.participantName, result.role, result.state.encounter.code);
      startSession(joined, result.state); setQaSessionInfo(result.qa); setWorkshopOpen(false); setAppView("map");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The QA persona could not be opened.");
    } finally { setQaPending(null); setBusy(false); }
  };

  const resetQaFixture = async () => {
    setQaPending("reset");
    setBusy(true); setError("");
    try {
      await api<{ reset: boolean }>("/api/qa/reset", { method: "POST", body: "{}" });
      setNotice("Interaction QA fixture reset.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The QA fixture could not be reset.");
    } finally { setQaPending(null); setBusy(false); }
  };

  const createScenarioFromHome = async ({ name, mode, sourceCode }: { name: string; mode: "party" | "duplicate"; sourceCode: string }) => {
    if (!signedInIdentity || !selectedCampaign || selectedCampaign.role !== "dm" || creatingScenarioFromHome) return false;
    setCreatingScenarioFromHome(true); setError("");
    try {
      if (mode === "party") {
        const result = await api<{ scenario: EncounterSummary }>(
          `/api/campaigns/${encodeURIComponent(selectedCampaign.id)}/encounters`,
          { method: "POST", body: JSON.stringify({ name }) },
        );
        updateCampaignEncounter(result.scenario);
        setNotice(`${result.scenario.name} created.`);
        return true;
      }
      if (!sourceCode) throw new Error("Choose an encounter to duplicate.");
      const joined = await api<{ participantId: string; sessionSecret: string; role: Role; state: EncounterState }>(
        `/api/encounters/${encodeURIComponent(sourceCode)}/join`,
        { method: "POST", body: JSON.stringify({ campaignId: selectedCampaign.id }) },
      );
      const result = await api<{ scenario: EncounterSummary; state: EncounterState }>(`/api/encounters/${encodeURIComponent(sourceCode)}/command`, {
        method: "POST",
        body: JSON.stringify({ participantId: joined.participantId, sessionSecret: joined.sessionSecret, ...commandRequest("create-scenario", { name, mode }) }),
      });
      updateCampaignEncounter(result.scenario);
      setNotice(`${result.scenario.name} created.`);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The encounter could not be created.");
      return false;
    } finally { setCreatingScenarioFromHome(false); }
  };

  const renameScenarioFromHome = async (code: string, name: string) => {
    if (!signedInIdentity || !selectedCampaign || selectedCampaign.role !== "dm" || renamingScenarioCode) return false;
    setRenamingScenarioCode(code); setError("");
    try {
      const joined = await api<{ participantId: string; sessionSecret: string; role: Role; state: EncounterState }>(
        `/api/encounters/${encodeURIComponent(code)}/join`,
        { method: "POST", body: JSON.stringify({ campaignId: selectedCampaign.id }) },
      );
      const result = await api<{ renamed: boolean; scenario: EncounterSummary; state: EncounterState }>(`/api/encounters/${encodeURIComponent(code)}/command`, {
        method: "POST",
        body: JSON.stringify({ participantId: joined.participantId, sessionSecret: joined.sessionSecret, ...commandRequest("rename-scenario", { name }) }),
      });
      updateCampaignEncounter(result.scenario);
      setNotice(`${result.scenario.name} saved.`);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The encounter name could not be saved.");
      return false;
    } finally { setRenamingScenarioCode(null); }
  };

  const acceptCampaignAccess = (result: CampaignAccessResponse) => {
    setSignedInIdentity(result.identity);
    setInvitedIdentities(result.invitedIdentities);
    setCampaigns(result.items);
  };

  const createCampaign = async (input: { name: string; players: Array<{ identityId: string; character: { name: string; className: string; maxHp: number; armorClass: number; speed: number } | null }> }) => {
    if (campaignMutationPending) return false;
    setCampaignMutationPending(true); setError("");
    try {
      const result = await api<CampaignAccessResponse>("/api/campaigns", { method: "POST", body: JSON.stringify(input) });
      acceptCampaignAccess(result);
      setNotice(`${input.name} created.`);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The campaign could not be created.");
      return false;
    } finally { setCampaignMutationPending(false); }
  };

  const renameCampaign = async (name: string) => {
    if (!selectedCampaign || campaignMutationPending) return false;
    setCampaignMutationPending(true); setError("");
    try {
      const result = await api<CampaignAccessResponse>(`/api/campaigns/${encodeURIComponent(selectedCampaign.id)}`, { method: "PATCH", body: JSON.stringify({ name }) });
      acceptCampaignAccess(result);
      setNotice(`${name} saved.`);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The campaign name could not be saved.");
      return false;
    } finally { setCampaignMutationPending(false); }
  };

  const addCampaignPlayer = async (input: { identityId: string; character: { name: string; className: string; maxHp: number; armorClass: number; speed: number } | null }) => {
    if (!selectedCampaign || campaignMutationPending) return false;
    setCampaignMutationPending(true); setError("");
    try {
      const result = await api<CampaignAccessResponse>(`/api/campaigns/${encodeURIComponent(selectedCampaign.id)}/members`, { method: "POST", body: JSON.stringify(input) });
      acceptCampaignAccess(result);
      const added = invitedIdentities.find((candidate) => candidate.id === input.identityId)?.displayName ?? "Player";
      setNotice(`${added} added to ${selectedCampaign.name}.`);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The player could not be added.");
      return false;
    } finally { setCampaignMutationPending(false); }
  };

  const saveCharacterCombatAction = async (input: { characterId: string; actionId?: string; values: import("@/shared/combat-rolling").CombatActionValues }) => {
    if (!selectedCampaign || campaignMutationPending) return false;
    setCampaignMutationPending(true); setError("");
    try {
      const result = await api<CampaignAccessResponse>(`/api/campaigns/${encodeURIComponent(selectedCampaign.id)}/actions`, {
        method: "POST", body: JSON.stringify(input),
      });
      acceptCampaignAccess(result); setNotice(`${input.values.name} saved.`); return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The combat action could not be saved."); return false;
    } finally { setCampaignMutationPending(false); }
  };

  const deleteCharacterCombatAction = async (actionId: string) => {
    if (!selectedCampaign || campaignMutationPending) return false;
    setCampaignMutationPending(true); setError("");
    try {
      const result = await api<CampaignAccessResponse>(`/api/campaigns/${encodeURIComponent(selectedCampaign.id)}/actions`, {
        method: "DELETE", body: JSON.stringify({ actionId }),
      });
      acceptCampaignAccess(result); setNotice("Combat action removed."); return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The combat action could not be removed."); return false;
    } finally { setCampaignMutationPending(false); }
  };

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4_200);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const annotations = state?.annotations ?? [];
    const activePingIds = new Set(
      annotations
        .filter((annotation) => annotation.type === "ping")
        .map((annotation) => annotation.id),
    );
    for (const pingId of pingStartedAtRef.current.keys()) {
      if (!activePingIds.has(pingId)) pingStartedAtRef.current.delete(pingId);
    }
    for (const annotation of annotations) {
      if (annotation.type !== "ping" || pingStartedAtRef.current.has(annotation.id)) continue;
      pingStartedAtRef.current.set(annotation.id, (annotation.expiresAt ?? PING_DURATION_MS) - PING_DURATION_MS);
      if (pingAudioContextRef.current) playPingSound(pingAudioContextRef.current);
    }
  }, [state?.annotations]);

  useEffect(() => () => {
    if (pingAudioContextRef.current?.state !== "closed") void pingAudioContextRef.current?.close();
  }, []);
  const placeCreature = async (creature: CreatureTemplate, point: MapPoint) => {
    if (!participant || !state || !movementEnabled) return;
    if (participant.role === "player" && !effectivePlacementSummonerId) {
      setError("Your character is not available in this scenario, so a summon cannot be placed.");
      return;
    }
    const matchingCount = state.tokens.filter((token) => token.artAsset === creature.artAsset).length;
    const name = matchingCount === 0 ? creature.name : `${creature.name} ${matchingCount + 1}`;
    const summoner = effectivePlacementSummonerId ? state.tokens.find((token) => token.id === effectivePlacementSummonerId) : null;
    await createTokenOptimistically<{ tokenId: string; state: EncounterState }, "create-token">(
      "create-token",
      {
        name,
        kind: effectivePlacementSummonerId ? "summon" : "monster",
        size: creature.size,
        speed: creature.defaultSpeed,
        flySpeed: creature.speeds.fly ?? undefined,
        swimSpeed: creature.speeds.swim ?? undefined,
        climbSpeed: creature.speeds.climb ?? undefined,
        burrowSpeed: creature.speeds.burrow ?? undefined,
        armorClass: creature.armorClass,
        maxHp: creature.defaultHp,
        hp: creature.defaultHp,
        artAsset: creature.artAsset,
        catalogCreatureId: creature.id,
        summonerTokenId: effectivePlacementSummonerId || undefined,
        x: point.x,
        y: point.y,
      },
      (temporaryId) => ({
        id: temporaryId,
        name,
        artAsset: creature.artAsset,
        kind: effectivePlacementSummonerId ? "summon" : "monster",
        size: creature.size,
        speed: creature.defaultSpeed,
        flySpeed: creature.speeds.fly,
        swimSpeed: creature.speeds.swim,
        climbSpeed: creature.speeds.climb,
        burrowSpeed: creature.speeds.burrow,
        armorClass: creature.armorClass,
        hp: creature.defaultHp,
        maxHp: creature.defaultHp,
        temporaryHp: 0,
        healthState: null,
        hidden: false,
        summonerTokenId: effectivePlacementSummonerId || null,
        initiative: summoner?.initiative ?? null,
        initiativeGroupId: null,
        initiativeOrder: summoner?.initiativeOrder ?? null,
        turnComplete: false,
        altitude: 0,
        movementUsed: 0,
        movementOrigin: null,
        effects: [],
        controller: summoner?.controller ?? { name: participant.name },
        controlledByViewer: true,
        x: point.x,
        y: point.y,
      }),
      `${name} placed at ${creature.defaultHp} HP.`,
      (confirmed) => setSelectedTokenId(confirmed.tokenId),
    );
  };

  const placeSpellEffect = async (spell: SpellEffectDefinition, point: MapPoint) => {
    if (!participant || !state || !movementEnabled) return;
    if (participant.role === "player" && !effectivePlacementSummonerId) {
      setError("Your character is not available in this scenario, so the spell cannot be placed.");
      return;
    }
    // Spell placements are intentionally one-shot. Clear the armed palette
    // choice before the optimistic paint so rapid clicks cannot create copies.
    setArmedSpellId(null);
    const matchingCount = state.tokens.filter((token) => token.kind === SPELL_EFFECT_KIND && token.artAsset === spell.artAsset).length;
    const name = matchingCount === 0 ? spell.name : `${spell.name} ${matchingCount + 1}`;
    const caster = effectivePlacementSummonerId ? state.tokens.find((token) => token.id === effectivePlacementSummonerId) : null;
    await createTokenOptimistically<{ tokenId: string; state: EncounterState }, "create-spell-effect">(
      "create-spell-effect",
      {
        spellId: spell.id,
        summonerTokenId: effectivePlacementSummonerId || undefined,
        x: point.x,
        y: point.y,
      },
      (temporaryId) => ({
        id: temporaryId,
        name,
        artAsset: spell.artAsset,
        kind: SPELL_EFFECT_KIND,
        size: spell.size,
        speed: 0,
        flySpeed: null,
        swimSpeed: null,
        climbSpeed: null,
        burrowSpeed: null,
        armorClass: null,
        hp: null,
        maxHp: null,
        temporaryHp: 0,
        healthState: null,
        hidden: false,
        summonerTokenId: effectivePlacementSummonerId || null,
        initiative: caster?.initiative ?? null,
        initiativeGroupId: null,
        initiativeOrder: caster?.initiativeOrder ?? null,
        turnComplete: false,
        altitude: 0,
        movementUsed: 0,
        movementOrigin: null,
        effects: [],
        controller: caster?.controller ?? { name: participant.name },
        controlledByViewer: true,
        x: point.x,
        y: point.y,
      }),
      `${spell.name} manifested.`,
      (confirmed) => setSelectedTokenId(confirmed.tokenId),
    );
  };

  const deleteToken = async (token: SharedToken) => {
    if (!participant || !state || isTokenPendingCreation(token.id)) return;
    if (participant.role !== "dm" && (token.kind !== SPELL_EFFECT_KIND || !token.controlledByViewer)) return;
    setSelectedTokenId((current) => current === token.id ? null : current);
    await removeTokenOptimistically(token, token.kind === SPELL_EFFECT_KIND ? `${token.name} dismissed.` : "Token removed.");
  };

  useSpellDismissShortcut({
    enabled: appView === "map" && !workshopOpen,
    selectedToken,
    onDismiss: (token) => { void deleteToken(token); },
  });

  const publishMove = async (tokenId: string, destination: MapPoint & { altitude: number }, encounter = state?.encounter.code) => {
    const result = await moveTokenOptimistically(tokenId, destination, encounter);
    if (!result) return;
    setNotice(result.spellEffect
      ? `${result.tokenName} repositioned.`
      : result.overBudget
        ? `Move confirmed · ${result.distance} ft · over movement.`
        : `Move confirmed · ${result.distance} ft.`);
  };

  const addAnnotation = async (type: AnnotationMode, start: MapPoint, end?: MapPoint) => {
    if (type === "move" || type === "erase") return;
    const temporaryId = `pending-annotation-${crypto.randomUUID()}`;
    const annotation: SharedAnnotation = {
      id: temporaryId,
      type,
      x: start.x,
      y: start.y,
      x2: end?.x ?? null,
      y2: end?.y ?? null,
      color: type === "spotlight" ? "#f5c65c" : type === "neon-spotlight" ? "#ff3fbf" : "#75c8d8",
      label: null,
      createdBy: participant?.id ?? "pending",
      expiresAt: type === "ping" ? Date.now() + PING_DURATION_MS : type === "spotlight" || type === "neon-spotlight" ? Date.now() + SPOTLIGHT_DURATION_MS : null,
    };
    await runOptimisticCommand("add-annotation", {
      annotationType: type,
      x: start.x, y: start.y,
      x2: end?.x, y2: end?.y,
      color: annotation.color,
    }, (current) => ({ ...current, annotations: [...current.annotations, annotation] }), type === "drawing" ? "Tactical line shared." : type === "spotlight" ? "Arcane spotlight shared." : type === "neon-spotlight" ? "Neon spotlight shared." : undefined);
  };

  const gestures = useBattleMapGestures({
    canvasRef,
    state,
    participant,
    movementEnabled,
    annotationMode,
    creatures,
    armedCreatureId,
    armedSpellId,
    playerCharacter,
    selectedTokenId: effectiveSelectedTokenId,
    canMoveToken,
    isTokenPendingCreation,
    setNotice,
    onSelectToken: (tokenId) => {
      if (armedAttackAttackerId && openAttackTarget(tokenId, { x: 24, y: 24 })) return;
      setSelectedTokenId(tokenId); setSelectedMapNoteId(null);
    },
    onSelectMapNote: (noteId) => { setSelectedMapNoteId(noteId); setSelectedTokenId(null); },
    onArmCreature: setArmedCreatureId,
    onArmSpell: setArmedSpellId,
    onPlaceCreature: placeCreature,
    onPlaceSpellEffect: placeSpellEffect,
    onMoveToken: publishMove,
    onAddAnnotation: addAnnotation,
    onRemoveAnnotation: (annotation) => void runOptimisticCommand(
      "remove-annotation",
      { annotationId: annotation.id },
      (current) => ({ ...current, annotations: current.annotations.filter((item) => item.id !== annotation.id) }),
      "Line erased.",
    ),
    onUpdateSharedFog: updateSharedFogOptimistically,
    onAttackTarget: openAttackTarget,
  });
  const {
    preview,
    dragOrigin,
    dragging,
    placementPreview,
    spellPlacementPreview,
    viewport,
    effectiveZoom,
    panning,
    editingSharedFog,
    sharedFogPreview,
    selectedSharedFogVertex,
    keyboardCursor,
    keyboardStatus,
    onPaletteDragStart,
    onSpellDragStart,
    onMapDragOver,
    onMapDrop,
    onMapDragLeave,
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp,
    onCanvasPointerCancel,
    onCanvasWheel,
    onCanvasContextMenu,
    onCanvasFocus,
    onCanvasKeyDown,
    changeZoom,
    fitViewport,
    resetViewport,
    toggleSharedFogEditing,
    finishSharedFogEditing,
    addSharedFogPoint,
    removeSharedFogPoint,
    clearCreaturePlacementPreview,
    clearSpellPlacementPreview,
  } = gestures;
  useMapAssets({
    active: !workshopOpen,
    state, participant, preview, placementPreview, spellPlacementPreview, dragOrigin, viewport,
    selectedTokenId: effectiveSelectedTokenId, selectedMapNoteId, gridOpacity,
    showColoredTokenCenters, showHealthRings, sharedFogPreview, selectedSharedFogVertex, keyboardCursor,
    pingStartedAtRef, canvasRef,
  });

  const togglePresenting = useCallback(() => {
    setPresenting((current) => {
      const next = !current;
      // Browser fullscreen is a bonus, not the mechanism: the class alone
      // already hides every panel. Mobile Safari's fullscreen transition can
      // unwind immediately, so phones use the app-owned presentation state.
      const mobilePresentation = window.innerWidth <= 560
        || window.matchMedia("(hover: none) and (pointer: coarse)").matches;
      if (next && !mobilePresentation) void document.documentElement.requestFullscreen?.().catch(() => undefined);
      else if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
      return next;
    });
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setPresenting(false);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (!participant || !state) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest?.("input, textarea, select")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLocaleLowerCase();
      if (key === "escape" && presenting) { event.preventDefault(); togglePresenting(); return; }
      const tool: Record<string, AnnotationMode> = { v: "move", p: "ping", l: "drawing", e: "erase", s: "spotlight", n: "neon-spotlight" };
      if (tool[key] && (!["spotlight", "neon-spotlight"].includes(tool[key]) || participant?.role === "dm")) {
        event.preventDefault();
        if (tool[key] === "ping") enablePingAudio();
        setAnnotationMode(tool[key]);
        return;
      }
      if (key === "\\") { event.preventDefault(); setSidebarOpen((open) => !open); return; }
      if (key === "f") { event.preventDefault(); togglePresenting(); return; }
      if (key === "0") { event.preventDefault(); fitViewport(); return; }
      if (key === "=" || key === "+") { event.preventDefault(); changeZoom(0.5); return; }
      if (key === "-" || key === "_") { event.preventDefault(); changeZoom(-0.5); }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participant?.role, presenting, togglePresenting, state]);

  if (appView === "login" || !signedInIdentity) {
    return <JoinScreen error={error} identities={JOIN_IDENTITIES} loading={authLoading}
      googleConfigured={googleConfigured} devLoginAvailable={devLoginAvailable}
      onDevLogin={(identity) => { void (async () => {
        setError(""); setAuthLoading(true);
        try {
          const result = await api<{ authenticated: true; identity: JoinIdentity }>("/api/auth/dev-login", { method: "POST", body: JSON.stringify({ identityId: identity.id }) });
          setSignedInIdentity(result.identity); setSelectedCampaignId(null); setCampaigns([]); setAppView("campaigns");
          await loadCampaigns(result.identity);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "Development sign-in failed.");
        } finally { setAuthLoading(false); }
      })(); }} />;
  }

  const signOut = async () => {
    try { await api<{ signedOut: boolean }>("/api/auth/logout", { method: "POST", body: "{}" }); } catch { /* Local state still signs out. */ }
    clearSession(); setWorkshopOpen(false); setSignedInIdentity(null); setSelectedCampaignId(null);
    setCampaigns([]); setInvitedIdentities([]); setError(""); setNotice(""); setAppView("login");
  };

  const returnToCampaignHome = () => {
    const qa = Boolean(qaSessionInfo);
    clearSession(); setQaSessionInfo(null); setWorkshopOpen(false); setError(""); setAppView(qa ? "campaigns" : "dashboard");
    void loadCampaigns(signedInIdentity, { preserveCurrent: true });
  };

  if (appView === "campaigns") {
    return <CampaignList identity={signedInIdentity} campaigns={campaigns} invitedIdentities={invitedIdentities} loading={campaignsLoading} mutationPending={campaignMutationPending} qaPending={qaPending} error={error} notice={notice}
      onEnterCampaign={(campaignId) => { setSelectedCampaignId(campaignId); setError(""); setAppView("dashboard"); }}
      onCreateCampaign={createCampaign}
      onLaunchQa={(persona) => void launchQaSession(persona)} onResetQa={() => void resetQaFixture()}
      onSignOut={() => void signOut()} />;
  }

  if (appView === "dashboard" && selectedCampaign) {
    return <CampaignHome
      identity={signedInIdentity} campaign={selectedCampaign} invitedIdentities={invitedIdentities} loading={campaignsLoading}
      openingCode={openingCode} openingDestination={openingDestination} renamingCode={renamingScenarioCode} error={error} notice={notice} creating={creatingScenarioFromHome}
      campaignMutationPending={campaignMutationPending}
      onOpenEncounter={(code) => void join(signedInIdentity, selectedCampaign, code, "map")}
      onSetupEncounter={(code) => void join(signedInIdentity, selectedCampaign, code, "setup")}
      onCreateEncounter={createScenarioFromHome}
      onRenameEncounter={renameScenarioFromHome}
      onRenameCampaign={renameCampaign}
      onAddPlayer={addCampaignPlayer}
      onSaveCombatAction={saveCharacterCombatAction}
      onDeleteCombatAction={deleteCharacterCombatAction}
      onBackToCampaigns={() => { setError(""); setNotice(""); setAppView("campaigns"); }}
      onSignOut={() => void signOut()}
    />;
  }

  if (appView === "dashboard") {
    return <CampaignList identity={signedInIdentity} campaigns={campaigns} invitedIdentities={invitedIdentities} loading={campaignsLoading} mutationPending={campaignMutationPending} qaPending={qaPending} error={error} notice={notice}
      onEnterCampaign={(campaignId) => { setSelectedCampaignId(campaignId); setError(""); setAppView("dashboard"); }}
      onCreateCampaign={createCampaign}
      onLaunchQa={(persona) => void launchQaSession(persona)} onResetQa={() => void resetQaFixture()}
      onSignOut={() => void signOut()} />;
  }

  if (!participant || !state) return null;

  const connectionLabel = connection === "live" ? "Live" : connection === "lost" ? "Connection lost" : connection === "reconnecting" ? "Reconnecting" : "Connecting";
  const connectionTooltip = connection === "live"
    ? "Live connection — shared encounter updates are current."
    : connection === "lost"
      ? "Connection lost — shared updates are unavailable."
      : connection === "reconnecting"
        ? "Reconnecting — restoring shared encounter updates."
        : "Connecting — loading shared encounter updates.";
  const durableAnnotationCount = state.annotations.filter((annotation) => annotation.type === "drawing").length;
  const adjudicateDamageProposal = (proposalId: string, method: Parameters<typeof adjudicatedDamage>[0]["method"], adjustedDamage?: number) => {
    void runOptimisticCommand<{ state: EncounterState; concentrationCheckRequired: boolean }, "adjudicate-damage">(
      "adjudicate-damage",
      { proposalId, method, adjustedDamage },
      (current) => {
        const pending = current.damageProposals.find((item) => item.id === proposalId);
        if (!pending || pending.rolledDamage === null) return current;
        const finalDamage = adjudicatedDamage({ rolledDamage: pending.rolledDamage, method, adjustedDamage });
        if (finalDamage === null) return current;
        const nextStatus = method === "adjust" ? "adjusted" : method === "immune" ? "immune"
          : method === "reject" ? "rejected" : method === "cancel" ? "cancelled" : "applied";
        return {
          ...current,
          damageProposals: current.damageProposals.map((item) => item.id === proposalId
            ? { ...item, status: nextStatus, finalDamage, adjudicationMethod: method, resolvedAt: Date.now() }
            : item),
          tokens: finalDamage > 0 ? current.tokens.map((token) => {
            if (token.id !== pending.targetTokenId || token.maxHp === null || token.hp === null || token.temporaryHp === null) return token;
            const transition = transitionDamageWithTemporaryHp({ hp: token.hp, maxHp: token.maxHp, temporaryHp: token.temporaryHp, damage: finalDamage });
            return transition ? { ...token, hp: transition.hp, temporaryHp: transition.temporaryHp } : token;
          }) : current.tokens,
        };
      },
      "Damage review completed.",
      undefined,
      false,
    );
  };
  const rollDamage = async (rollId: string) => {
    await runOptimisticCommand<{ state: EncounterState; rollId: string; proposalId: string }, "roll-damage">(
      "roll-damage",
      { operationId: crypto.randomUUID(), rollId },
      (current) => current,
      undefined,
      undefined,
      false,
    );
  };

  if (participant.role === "dm" && workshopOpen) return <>
    <MapWorkshop
      activeMapPackage={state.encounter.mapPackage}
      draftMapPackage={state.encounter.mapDraft}
      mapImages={state.mapImages}
      sidebarDetails={<EncounterSetupDetails
        participant={participant}
        encounterCode={state.encounter.code}
        dmBriefing={state.encounter.dmBriefing}
        handouts={state.handouts}
        title={handoutTitle}
        uploading={handoutUploading}
        uploadError={handoutUploadError}
        deletingId={handoutDeletingId}
        onTitleChange={setHandoutTitle}
        onUpload={(file, title, replaceId) => void uploadHandout(file, title, false, replaceId ?? null)}
        onPreview={(handout) => { setLightboxHandout({ id: handout.id, title: handout.title, width: handout.width, height: handout.height, updatedAt: handout.updatedAt, available: true }); setHandoutFitMode(true); }}
        onDelete={(handout) => void deleteHandout(handout)}
      />}
      onCommand={async (name, extra) => sendCommand<{ state: EncounterState }>(name, extra)}
      onClose={returnToCampaignHome}
    />
    {lightboxHandout?.available ? <HandoutLightbox participant={participant} encounterCode={state.encounter.code} handout={lightboxHandout} fitMode={handoutFitMode} onFitModeChange={setHandoutFitMode} onClose={() => setLightboxHandout(null)} /> : null}
  </>;

  const inCombat = state.encounter.status === "active";
  const rosterRows = buildRosterRows(state.tokens, inCombat, expandedGroups) as RosterRow[];
  const activeTurnMembers = state.tokens.filter((token) => token.kind !== SPELL_EFFECT_KIND &&
    token.initiativeOrder !== null && token.initiativeOrder === state.encounter.activeInitiativeOrder);
  const activeOwnTurnToken = activeTurnMembers.find((token) =>
    token.controlledByViewer && !token.turnComplete) ?? null;
  const activeOwnTurnIsGroup = activeTurnMembers.length > 1;
  const mapInteractionDescription = !movementEnabled
    ? "Movement and placement are currently unavailable. Select any visible token to inspect it. Focus the map for keyboard inspection; use arrow keys for the map cursor and Enter to select."
    : armedCreatureId
      ? "Click or focus the map and press Enter to place the selected creature."
      : armedSpellId
        ? "Click or focus the map and press Enter to manifest the selected spell effect."
        : annotationMode === "erase"
          ? "Erase mode. Click a drawn line, or move the keyboard cursor to it and press Enter, to remove it."
          : selectedToken && canMoveToken(selectedToken)
            ? `Selected ${selectedToken.name}. Select any visible token to inspect it, drag a permitted token to move it, or use the keyboard map cursor. Space grabs or drops a token.`
            : participant.role === "dm" || !state.encounter.strictMovement
              ? "Select any visible token to inspect it, drag a permitted token to move it, or use the keyboard map cursor. Space grabs or drops a token."
              : selectedToken
                ? `Selected ${selectedToken.name}. Select any visible token to inspect it; drag your character or summons to move them, or use the keyboard map cursor.`
                : "Select any visible token to inspect it; drag your character or summons to move them, or use the keyboard map cursor.";

  return (
    <main className={`app-shell${presenting ? " is-presenting" : ""}${sidebarOpen ? "" : " is-collapsed"}`}>
      {qaSessionInfo ? <div className="qa-session-banner" role="status"><strong>{qaSessionInfo.persona === "dm" ? "QA DM" : qaSessionInfo.persona === "player1" ? "QA Player 1" : "QA Player 2"}</strong><span>Isolated Interaction QA · authenticated as {qaSessionInfo.actor}</span><button onClick={returnToCampaignHome}>Exit QA</button></div> : null}
      <BattleMapCommandBar
        participant={participant} state={state} annotationMode={annotationMode} editingSharedFog={editingSharedFog}
        chatOpen={chatOpen} chatMinimized={chatMinimized} chatUnreadTotal={chatUnreadTotal}
        paletteOpen={paletteOpen} spellPaletteOpen={spellPaletteOpen} busy={busy} viewport={viewport}
        effectiveZoom={effectiveZoom} connection={connection} connectionLabel={connectionLabel} connectionTooltip={connectionTooltip}
        uiSettingsRef={uiSettingsRef} gridOpacity={gridOpacity} showColoredTokenCenters={showColoredTokenCenters}
        showHealthRings={showHealthRings} sidebarOpen={sidebarOpen} presenting={presenting} durableAnnotationCount={durableAnnotationCount}
        onAnnotationMode={(mode) => { if (mode === "ping") enablePingAudio(); setAnnotationMode(mode); }}
        onToggleFogEditor={() => { toggleSharedFogEditing(); setAnnotationMode("move"); }}
        onRequestClearAnnotations={() => setClearAnnotationsConfirmOpen(true)}
        onToggleChat={() => { if (!chatOpen) { markChatChannelRead(activeChatChannel); setChatOpen(true); setChatMinimized(false); chatShouldStickRef.current = true; } else if (chatMinimized) { markChatChannelRead(activeChatChannel); setChatMinimized(false); chatShouldStickRef.current = true; } else { markChatChannelRead(activeChatChannel); setChatOpen(false); } }}
        onToggleCreatures={() => { setPaletteOpen((open) => !open); setSpellPaletteOpen(false); setArmedSpellId(null); clearSpellPlacementPreview(); setAnnotationMode("move"); }}
        onToggleSpells={() => { setSpellPaletteOpen((open) => !open); setPaletteOpen(false); setArmedCreatureId(null); clearCreaturePlacementPreview(); setAnnotationMode("move"); }}
        onOpenDashboard={returnToCampaignHome}
        onHistory={(direction) => void history.run(direction)} onFit={fitViewport} onZoom={changeZoom}
        onResetZoom={resetViewport}
        onGridOpacityChange={setGridOpacity} onColoredTokenCentersChange={setShowColoredTokenCenters}
        onHealthRingsChange={setShowHealthRings} onFogModeChange={setFogModeOptimistically}
        onVisionDoorChange={setVisionDoorOpenOptimistically} onStrictMovementChange={setStrictMovementOptimistically}
        onToggleSidebar={() => setSidebarOpen((open) => !open)} onTogglePresenting={togglePresenting}
        onCorrectTurn={correctTurnOptimistically}
      />

      <div className="workspace">
        <section className="map-panel" aria-label="Shared battle map">
          <div className="map-stage">
          <div className="map-frame" style={{ aspectRatio: `${state.grid.width} / ${state.grid.height}` }}>
            <p id="battle-map-keyboard-help" className="visually-hidden">Arrow keys move the map cursor one cell; Shift plus arrows moves five cells. Enter activates the current tool or selects an object. Space grabs or drops a movable token. Page Up and Page Down adjust altitude while grabbed. Alt plus arrows pans. Plus and minus zoom. Escape cancels a staged keyboard action.</p>
            <canvas ref={canvasRef} className={`map-canvas${dragging ? " is-dragging" : ""}${panning ? " is-panning" : ""}${armedCreatureId || armedSpellId ? " is-placing" : ""}${annotationMode === "erase" ? " is-erasing" : ""}${editingSharedFog ? " is-editing-fog" : ""}${movementEnabled ? "" : " is-blocked"}`} onFocus={onCanvasFocus} onKeyDown={onCanvasKeyDown} onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove} onPointerUp={onCanvasPointerUp} onPointerCancel={onCanvasPointerCancel} onWheel={onCanvasWheel} onContextMenu={onCanvasContextMenu} onDragOver={onMapDragOver} onDrop={onMapDrop} onDragLeave={onMapDragLeave} aria-describedby="battle-map-keyboard-help" aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Enter Space PageUp PageDown Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight + - Escape" aria-label={`${state.grid.width} by ${state.grid.height} battle grid with ${state.tokens.length} visible tokens. ${mapInteractionDescription}`} role="application" tabIndex={0} />
            {combatChooser ? (() => {
              const attacker = state.tokens.find((token) => token.id === combatChooser.attackerId);
              const target = state.tokens.find((token) => token.id === combatChooser.targetId);
              return attacker && target ? <CombatRollPanel
                participant={participant} state={state} attacker={attacker} target={target} anchor={combatChooser.anchor}
                onClose={() => setCombatChooser(null)}
                onRoll={(payload) => runOptimisticCommand<CombatRollResponse, "roll-attack">(
                  "roll-attack", payload, (current) => current, undefined, undefined, false,
                )}
                onComplete={(response) => {
                  const roll = response.state.combatRolls.find((item) => item.id === response.rollId);
                  setCombatChooser(null);
                  if (roll) combatRollNotifications.enqueue({ roll, proposalId: response.proposalId });
                  else setError("The attack was rolled, but its result could not be displayed.");
                }}
              /> : null;
            })() : null}
            {participant.role === "dm" && damageReview.pendingCount > 0 && damageReview.visibleProposals.length === 0 ? <button type="button" className="damage-review-launcher" onClick={damageReview.reopen}>Review pending damage <span>{damageReview.pendingCount}</span></button> : null}
            <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{keyboardStatus}</div>
            {editingSharedFog ? <div className="fog-live-controls" role="group" aria-label="Shared fog corner controls"><span>Drag a corner handle to reshape the hidden area.</span><button type="button" onClick={addSharedFogPoint}>Add corner</button><button type="button" className="is-danger" disabled={selectedSharedFogVertex === null || (sharedFogPreview?.length ?? 0) <= 3} onClick={removeSharedFogPoint}>Remove selected</button><button type="button" onClick={finishSharedFogEditing}>Done</button></div> : null}
            {paletteOpen ? <CreaturePalette
              participant={participant} tokens={state.tokens} playerCharacter={playerCharacter}
              creatures={creatures} families={creatureFamilies} query={creatureQuery} family={creatureFamily}
              cursor={creatureCursor} loading={creatureCatalogLoading} error={creatureCatalogError}
              armedId={armedCreatureId} summonerId={placementSummonerId}
              onClose={() => { setPaletteOpen(false); setArmedCreatureId(null); clearCreaturePlacementPreview(); }}
              onSummonerChange={setPlacementSummonerId}
              onQueryChange={(value) => { setCreatureQuery(value); setArmedCreatureId(null); clearCreaturePlacementPreview(); }}
              onFamilyChange={(value) => { setCreatureFamily(value); setArmedCreatureId(null); clearCreaturePlacementPreview(); }}
              onArm={(id) => { setArmedCreatureId(id); if (!id) clearCreaturePlacementPreview(); }}
              onDragStart={onPaletteDragStart} onDragEnd={clearCreaturePlacementPreview} onLoadMore={() => void loadMoreCreatures()}
            /> : null}
            {spellPaletteOpen ? <SpellPalette
              participant={participant} playerCharacter={playerCharacter} armedId={armedSpellId}
              onClose={() => { setSpellPaletteOpen(false); setArmedSpellId(null); clearSpellPlacementPreview(); }}
              onArm={(id) => { setArmedSpellId(id); if (!id) clearSpellPlacementPreview(); }}
              onDragStart={onSpellDragStart} onDragEnd={clearSpellPlacementPreview}
            /> : null}
            {chatOpen && !presenting ? <ChatPanel
              participant={participant}
              state={state}
              dock={chatDock}
              minimized={chatMinimized}
              unreadTotal={chatUnreadTotal}
              channels={chatChannels}
              activeChannel={activeChatChannel}
              unreadByChannel={chatUnreadByChannel}
              messages={chatMessagesForChannel}
              messagesRef={chatMessagesRef}
              draft={chatDraft}
              sending={chatSending}
              handoutPickerOpen={handoutPickerOpen}
              handoutUploading={handoutUploading}
              handoutUploadError={handoutUploadError}
              selectedHandout={selectedChatHandout}
              showImmediately={showHandoutImmediately}
              onDockPointerDown={onChatDockPointerDown}
              onDockPointerMove={onChatDockPointerMove}
              onDockPointerEnd={onChatDockPointerEnd}
              onToggleMinimized={() => { markChatChannelRead(activeChatChannel); setChatMinimized((value) => !value); chatShouldStickRef.current = true; }}
              onClose={() => { markChatChannelRead(activeChatChannel); setChatOpen(false); }}
              onSelectChannel={(channel) => { markChatChannelRead(activeChatChannel); markChatChannelRead(channel); setActiveChatChannel(channel); chatShouldStickRef.current = true; }}
              onMessagesScroll={(event) => { const element = event.currentTarget; chatShouldStickRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64; }}
              onOpenHandout={(handout) => { setLightboxHandout(handout); setHandoutFitMode(true); }}
              onDraftChange={setChatDraft}
              onSend={() => void sendChatMessage()}
              onToggleHandoutPicker={() => { setHandoutPickerOpen((open) => !open); setHandoutUploadError(""); }}
              onUploadNew={(file) => void uploadHandout(file, "", true)}
              onSelectHandout={(handoutId) => { setSelectedChatHandoutId(handoutId); setHandoutPickerOpen(false); }}
              onRemoveHandout={() => { setSelectedChatHandoutId(null); setShowHandoutImmediately(false); }}
              onShowImmediatelyChange={setShowHandoutImmediately}
            /> : null}
            {error ? <div className="map-message is-error" role="alert">{error}</div> : notice ? <div className="map-message" role="status">{notice}</div> : null}
            {connection !== "live" || state.encounter.status === "paused" ? <div className="map-safety-overlay"><strong>{state.encounter.status === "paused" ? "Encounter paused" : connectionLabel}</strong><span>{state.encounter.status === "paused" ? "The DM paused the encounter. Movement and turn advancement are temporarily disabled." : "Movement is paused until shared state is current."}</span></div> : null}
            {presenting ? <button className="present-exit" onClick={togglePresenting}>Exit presentation</button> : null}
          </div>
          </div>
        </section>

        <EncounterSidebar
          participant={participant} state={state} hidden={!sidebarOpen || presenting} inCombat={inCombat}
          rosterRows={rosterRows} selectedToken={selectedToken}
          selectedSpell={selectedSpell} selectedMapNote={selectedMapNote}
          activeOwnTurnToken={activeOwnTurnToken} activeOwnTurnIsGroup={activeOwnTurnIsGroup}
          encounterAction={encounterAction} controls={tokenControls}
          onToggleGroup={(key) => setExpandedGroups((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; })}
          onSelectToken={(id) => { setSelectedTokenId(id); setSelectedMapNoteId(null); }}
          onBeginAttack={(token) => { setArmedAttackAttackerId(token.id); setCombatChooser(null); setNotice(`Choose a visible target for ${token.name}.`); }}
          onCloseMapNote={() => setSelectedMapNoteId(null)} onResizeSpell={tokenControls.resizeSpellEffect}
          onDeleteToken={(token) => void deleteToken(token)} canMoveToken={canMoveToken}
          onHideToken={(token) => void runOptimisticCommand("update-token", { tokenId: token.id, hidden: !token.hidden }, (current) => ({ ...current, tokens: current.tokens.map((item) => item.id === token.id ? { ...item, hidden: !token.hidden } : item) }), token.hidden ? "Token revealed." : "Token hidden.")}
          onEndTurn={endTurnOptimistically}
          onStartOrRestart={() => { if (state.encounter.status !== "setup") setRestartConfirmOpen(true); else startCombatOptimistically(); }}
          onAdvanceTurn={advanceTurnOptimistically}
          onPauseOrResume={() => void configureEncounterOptimistically(state.encounter.status === "paused" ? "active" : "paused", state.encounter.status === "paused" ? "Encounter resumed." : "Encounter paused.")}
          onRequestReset={() => setResetConfirmOpen(true)}
        />

      </div>
      <CombatActivityStack
        state={state}
        rollResults={combatRollNotifications.notifications}
        damageNotifications={damageNotifications.notifications}
        damageReviewProposals={damageReview.visibleProposals}
        damageReviewPendingCount={damageReview.pendingCount}
        onDismissRollResult={combatRollNotifications.dismiss}
        onRollDamage={rollDamage}
        onDismissDamageNotification={(notification) => {
          damageNotifications.dismiss(notification.id);
          if (!notification.concentrationCheckRequired) return;
          const target = state.tokens.find((token) => token.id === notification.targetTokenId);
          if (target) tokenControls.requireConcentrationCheck(target);
        }}
        onDismissDamageReview={damageReview.deferProposal}
        onAdjudicateDamage={adjudicateDamageProposal}
      />
      <EncounterDialogs
        participant={participant} state={state} resetOpen={resetConfirmOpen} restartOpen={restartConfirmOpen}
        clearAnnotationsOpen={clearAnnotationsConfirmOpen} clearAnnotationCount={durableAnnotationCount}
        concentrationReminder={tokenControls.concentrationReminder}
        lightboxHandout={lightboxHandout} handoutFitMode={handoutFitMode}
        onResetOpen={setResetConfirmOpen} onRestartOpen={setRestartConfirmOpen} onClearAnnotationsOpen={setClearAnnotationsConfirmOpen}
        onReset={() => { setResetConfirmOpen(false); void configureEncounterOptimistically("setup", "Encounter reset to setup."); }}
        onRestart={() => { setRestartConfirmOpen(false); startCombatOptimistically(); }}
        onClearAnnotations={() => { setClearAnnotationsConfirmOpen(false); void runOptimisticCommand("clear-annotations", {}, (current) => ({ ...current, annotations: current.annotations.filter((annotation) => annotation.type !== "drawing") }), `${durableAnnotationCount} ${durableAnnotationCount === 1 ? "drawing" : "drawings"} cleared. Use Undo to restore.`); }}
        onDismissConcentrationReminder={tokenControls.dismissConcentrationReminder}
        onHandoutFitMode={setHandoutFitMode}
        onCloseLightbox={() => setLightboxHandout(null)}
      />
    </main>
  );
}
