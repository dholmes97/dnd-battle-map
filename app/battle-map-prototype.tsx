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
} from "@/app/chat-handouts-ui";
import { useChatHandouts } from "@/app/use-chat-handouts";
import { useTokenControls } from "@/app/use-token-controls";
import { useScenarioControls, type EncounterSummary } from "@/app/use-scenario-controls";
import { useCreatureCatalog } from "@/app/use-creature-catalog";
import { useEncounterActions } from "@/app/use-encounter-actions";
import { useMapAssets } from "@/app/use-map-assets";
import { BattleMapCommandBar, type AnnotationMode } from "@/app/battle-map-command-bar";
import { EncounterDialogs } from "@/app/encounter-dialogs";
import { useHistoryShortcuts } from "@/app/use-history-shortcuts";
import { useSpellDismissShortcut } from "@/app/use-spell-dismiss-shortcut";
import { usePersonalUiSettings } from "@/app/use-personal-ui-settings";
import { useBattleMapGestures } from "@/app/use-battle-map-gestures";
import { JoinScreen, type JoinIdentity } from "@/app/join-screen";
import { CampaignHome } from "@/app/campaign-home";
import { CreaturePalette, SpellPalette } from "@/app/battle-map-palettes";
import { EncounterSidebar, type RosterRow } from "@/app/encounter-sidebar";
import {
  type CreatureTemplate,
} from "@/shared/creature-library";
import type {
  EncounterState,
  MapPoint,
  Role,
  SharedAnnotation,
  SharedToken,
} from "@/shared/contracts";
import { movementPolicyDenial } from "@/shared/battle-map-policies.ts";
import { commandRequest } from "@/shared/command-parser.ts";
import { buildRosterRows } from "@/shared/initiative-domain.ts";
import {
  SPELL_EFFECT_KIND,
  spellEffectByArt,
  type SpellEffectDefinition,
} from "@/shared/spell-effects";

const JOIN_IDENTITIES: JoinIdentity[] = [
  { label: "Dar'eleth · Paladin", participantName: "Dan", role: "player" },
  { label: "Jelton · Druid", participantName: "Barry", role: "player" },
  { label: "Malichar · Rogue", participantName: "Scott", role: "player" },
  { label: "Dungeon Master", participantName: "Kevin", role: "dm" },
];
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
  const [encounterCode, setEncounterCode] = useState("");
  const [encounters, setEncounters] = useState<EncounterSummary[]>([]);
  const [encountersLoading, setEncountersLoading] = useState(true);
  const [signedInIdentity, setSignedInIdentity] = useState<JoinIdentity | null>(null);
  const [appView, setAppView] = useState<"login" | "dashboard" | "map">("login");
  const [openingCode, setOpeningCode] = useState<string | null>(null);
  const [creatingScenarioFromHome, setCreatingScenarioFromHome] = useState(false);
  const [renamingScenarioCode, setRenamingScenarioCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const encounterSync = useEncounterSync({ setError, setNotice });
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
  const [selectedMapNoteId, setSelectedMapNoteId] = useState<string | null>(null);
  const [annotationMode, setAnnotationMode] = useState<AnnotationMode>("move");
  const [busy, setBusy] = useState(false);
  const history = useHistoryShortcuts({ sync: encounterSync, busy, setNotice });
  const [workshopOpen, setWorkshopOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [spellPaletteOpen, setSpellPaletteOpen] = useState(false);
  const [armedCreatureId, setArmedCreatureId] = useState<string | null>(null);
  const [armedSpellId, setArmedSpellId] = useState<string | null>(null);
  const [placementSummonerId, setPlacementSummonerId] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [presenting, setPresenting] = useState(false);
  const [rosterFilter, setRosterFilter] = useState("");
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
  const scenarioControls = useScenarioControls();
  const {
    open: scenarioManagerOpen, setOpen: setScenarioManagerOpen,
  } = scenarioControls;
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

  useEffect(() => {
    let disposed = false;
    void api<{ items: EncounterSummary[] }>("/api/encounters")
      .then(({ items }) => {
        if (disposed) return;
        setEncounters(items);
        setEncounterCode((current) => items.some((encounter) => encounter.code === current) ? current : items[0]?.code ?? "");
      })
      .catch(() => { if (!disposed) setError("Your scenarios could not be loaded. Please try again."); })
      .finally(() => { if (!disposed) setEncountersLoading(false); });
    return () => { disposed = true; };
  }, []);

  const join = async (identity: JoinIdentity, code: string) => {
    const name = identity.participantName;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), JOIN_TIMEOUT_MS);
    enablePingAudio();
    setOpeningCode(code); setBusy(true); setError("");
    try {
      const result = await api<{ participantId: string; sessionSecret: string; role: Role; state: EncounterState }>(
        `/api/encounters/${encodeURIComponent(code)}/join`,
        { method: "POST", signal: controller.signal, body: JSON.stringify({ participantName: name, role: identity.role }) },
      );
      const joined = { id: result.participantId, name, role: result.role, sessionSecret: result.sessionSecret };
      personalUiSettings.loadForIdentity(name, result.role);
      resetChatForParticipant(name, result.role, result.state.encounter.code);
      startSession(joined, result.state); setEncounterCode(result.state.encounter.code); setAppView("map");
    } catch (joinError) {
      setError(joinError instanceof DOMException && joinError.name === "AbortError"
        ? "The encounter took too long to respond. Please try again."
        : joinError instanceof Error ? joinError.message : "Unable to join.");
    } finally {
      window.clearTimeout(timeout);
      setOpeningCode(null);
      setBusy(false);
    }
  };

  const createScenarioFromHome = async ({ name, mode, sourceCode }: { name: string; mode: "party" | "duplicate"; sourceCode: string }) => {
    if (!signedInIdentity || signedInIdentity.role !== "dm" || creatingScenarioFromHome) return false;
    setCreatingScenarioFromHome(true); setError("");
    try {
      const joined = await api<{ participantId: string; sessionSecret: string; role: Role; state: EncounterState }>(
        `/api/encounters/${encodeURIComponent(sourceCode)}/join`,
        { method: "POST", body: JSON.stringify({ participantName: signedInIdentity.participantName, role: signedInIdentity.role }) },
      );
      const result = await api<{ scenario: EncounterSummary; state: EncounterState }>(`/api/encounters/${encodeURIComponent(sourceCode)}/command`, {
        method: "POST",
        body: JSON.stringify({ participantId: joined.participantId, sessionSecret: joined.sessionSecret, ...commandRequest("create-scenario", { name, mode }) }),
      });
      setEncounters((current) => [result.scenario, ...current.filter((encounter) => encounter.code !== result.scenario.code)]);
      setNotice(`${result.scenario.name} created.`);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The scenario could not be created.");
      return false;
    } finally { setCreatingScenarioFromHome(false); }
  };

  const renameScenarioFromHome = async (code: string, name: string) => {
    if (!signedInIdentity || signedInIdentity.role !== "dm" || renamingScenarioCode) return false;
    setRenamingScenarioCode(code); setError("");
    try {
      const joined = await api<{ participantId: string; sessionSecret: string; role: Role; state: EncounterState }>(
        `/api/encounters/${encodeURIComponent(code)}/join`,
        { method: "POST", body: JSON.stringify({ participantName: signedInIdentity.participantName, role: signedInIdentity.role }) },
      );
      const result = await api<{ renamed: boolean; scenario: EncounterSummary; state: EncounterState }>(`/api/encounters/${encodeURIComponent(code)}/command`, {
        method: "POST",
        body: JSON.stringify({ participantId: joined.participantId, sessionSecret: joined.sessionSecret, ...commandRequest("rename-scenario", { name }) }),
      });
      setEncounters((current) => [result.scenario, ...current.filter((encounter) => encounter.code !== result.scenario.code)]);
      setNotice(`${result.scenario.name} saved.`);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The scenario name could not be saved.");
      return false;
    } finally { setRenamingScenarioCode(null); }
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
  useEffect(() => {
    if (!resetConfirmOpen && !restartConfirmOpen && !scenarioManagerOpen && !lightboxHandout) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (lightboxHandout) { setLightboxHandout(null); return; }
        setResetConfirmOpen(false);
        setRestartConfirmOpen(false);
        if (!handoutUploading) setScenarioManagerOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [handoutUploading, lightboxHandout, resetConfirmOpen, restartConfirmOpen, scenarioManagerOpen, setLightboxHandout, setScenarioManagerOpen]);


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
    canMoveToken,
    isTokenPendingCreation,
    setNotice,
    onSelectToken: (tokenId) => { setSelectedTokenId(tokenId); setSelectedMapNoteId(null); },
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
    showColoredTokenCenters, showHealthRings, sharedFogPreview, selectedSharedFogVertex,
    pingStartedAtRef, canvasRef,
  });

  const togglePresenting = useCallback(() => {
    setPresenting((current) => {
      const next = !current;
      // Browser fullscreen is a bonus, not the mechanism: the class alone
      // already hides every panel, so a rejected request still presents.
      if (next) void document.documentElement.requestFullscreen?.().catch(() => undefined);
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
    return <JoinScreen error={error} identities={JOIN_IDENTITIES} onLogin={(identity) => { setSignedInIdentity(identity); setError(""); setAppView("dashboard"); }} />;
  }

  if (appView === "dashboard") {
    return <CampaignHome
      identity={signedInIdentity} encounters={encounters} loading={encountersLoading}
      openingCode={openingCode} renamingCode={renamingScenarioCode} error={error} notice={notice} creating={creatingScenarioFromHome}
      onOpenScenario={(code) => void join(signedInIdentity, code)}
      onCreateScenario={createScenarioFromHome}
      onRenameScenario={renameScenarioFromHome}
      onSignOut={() => { clearSession(); setSignedInIdentity(null); setError(""); setNotice(""); setAppView("login"); }}
    />;
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
  const initiativeTokens = [...state.tokens].filter((token) => token.kind !== SPELL_EFFECT_KIND && token.initiativeOrder !== null).sort((a, b) => (a.initiativeOrder ?? 999) - (b.initiativeOrder ?? 999) || a.name.localeCompare(b.name));

  if (participant.role === "dm" && workshopOpen) return <MapWorkshop
    activeMapPackage={state.encounter.mapPackage}
    activeMapPresetId={state.encounter.activeMapPresetId}
    savedPresets={state.savedMapPresets}
    onCommand={async (name, extra) => sendCommand<{ state: EncounterState; presetId?: string }>(name, extra)}
    onClose={() => setWorkshopOpen(false)}
  />;

  const inCombat = state.encounter.status === "active";
  const rosterRows = buildRosterRows(state.tokens, inCombat, rosterFilter, expandedGroups) as RosterRow[];
  const activeTurnMembers = state.tokens.filter((token) => token.kind !== SPELL_EFFECT_KIND &&
    token.initiativeOrder !== null && token.initiativeOrder === state.encounter.activeInitiativeOrder);
  const activeOwnTurnToken = activeTurnMembers.find((token) =>
    token.controlledByViewer && !token.turnComplete) ?? null;
  const activeOwnTurnIsGroup = activeTurnMembers.length > 1;

  return (
    <main className={`app-shell${presenting ? " is-presenting" : ""}${sidebarOpen ? "" : " is-collapsed"}`}>
      <BattleMapCommandBar
        participant={participant} state={state} annotationMode={annotationMode} editingSharedFog={editingSharedFog}
        chatOpen={chatOpen} chatMinimized={chatMinimized} chatUnreadTotal={chatUnreadTotal}
        paletteOpen={paletteOpen} spellPaletteOpen={spellPaletteOpen} busy={busy} viewport={viewport}
        effectiveZoom={effectiveZoom} connection={connection} connectionLabel={connectionLabel} connectionTooltip={connectionTooltip}
        uiSettingsRef={uiSettingsRef} gridOpacity={gridOpacity} showColoredTokenCenters={showColoredTokenCenters}
        showHealthRings={showHealthRings} sidebarOpen={sidebarOpen} presenting={presenting}
        onAnnotationMode={(mode) => { if (mode === "ping") enablePingAudio(); setAnnotationMode(mode); }}
        onToggleFogEditor={() => { toggleSharedFogEditing(); setAnnotationMode("move"); }}
        onClearAnnotations={() => void runOptimisticCommand("clear-annotations", {}, (current) => ({ ...current, annotations: [] }), "Annotations cleared.")}
        onToggleChat={() => { if (!chatOpen) { markChatChannelRead(activeChatChannel); setChatOpen(true); setChatMinimized(false); chatShouldStickRef.current = true; } else if (chatMinimized) { markChatChannelRead(activeChatChannel); setChatMinimized(false); chatShouldStickRef.current = true; } else { markChatChannelRead(activeChatChannel); setChatOpen(false); } }}
        onToggleCreatures={() => { setPaletteOpen((open) => !open); setSpellPaletteOpen(false); setArmedSpellId(null); clearSpellPlacementPreview(); setAnnotationMode("move"); }}
        onToggleSpells={() => { setSpellPaletteOpen((open) => !open); setPaletteOpen(false); setArmedCreatureId(null); clearCreaturePlacementPreview(); setAnnotationMode("move"); }}
        onOpenWorkshop={() => setWorkshopOpen(true)} onManageScenarios={scenarioControls.show}
        onOpenDashboard={() => { clearSession(); setError(""); setAppView("dashboard"); }}
        onHistory={(direction) => void history.run(direction)} onFit={fitViewport} onZoom={changeZoom}
        onResetZoom={resetViewport}
        onGridOpacityChange={setGridOpacity} onColoredTokenCentersChange={setShowColoredTokenCenters}
        onHealthRingsChange={setShowHealthRings} onFogModeChange={setFogModeOptimistically}
        onVisionDoorChange={setVisionDoorOpenOptimistically} onStrictMovementChange={setStrictMovementOptimistically}
        onToggleSidebar={() => setSidebarOpen((open) => !open)} onTogglePresenting={togglePresenting}
      />

      <div className="workspace">
        <section className="map-panel" aria-label="Shared battle map">
          <div className="map-stage">
          <div className="map-frame" style={{ aspectRatio: `${state.grid.width} / ${state.grid.height}` }}>
            <canvas ref={canvasRef} className={`map-canvas${dragging ? " is-dragging" : ""}${panning ? " is-panning" : ""}${armedCreatureId || armedSpellId ? " is-placing" : ""}${annotationMode === "erase" ? " is-erasing" : ""}${editingSharedFog ? " is-editing-fog" : ""}${movementEnabled ? "" : " is-blocked"}`} onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove} onPointerUp={onCanvasPointerUp} onPointerCancel={onCanvasPointerCancel} onWheel={onCanvasWheel} onDragOver={onMapDragOver} onDrop={onMapDrop} onDragLeave={onMapDragLeave} aria-label={`${state.grid.width} by ${state.grid.height} battle grid with ${state.tokens.length} visible tokens. ${armedCreatureId ? "Click to place the selected creature." : armedSpellId ? "Click to manifest the selected spell effect." : annotationMode === "erase" ? "Erase mode. Click a drawn line to remove it." : participant.role === "dm" || !state.encounter.strictMovement ? "Drag any visible token to move it, or drag empty map space to pan." : selectedToken ? `Selected ${selectedToken.name}. Drag the token to move it, or drag empty map space to pan.` : "Scroll to zoom and drag empty map space to pan."}`} role="img" />
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
            {presenting ? <button className="present-exit" onClick={togglePresenting}>Exit presentation · Esc</button> : null}
          </div>
          </div>
        </section>

        <EncounterSidebar
          participant={participant} state={state} hidden={!sidebarOpen || presenting} inCombat={inCombat}
          rosterFilter={rosterFilter} rosterRows={rosterRows} selectedToken={selectedToken}
          selectedSpell={selectedSpell} selectedMapNote={selectedMapNote}
          activeOwnTurnToken={activeOwnTurnToken} activeOwnTurnIsGroup={activeOwnTurnIsGroup}
          initiativeTokens={initiativeTokens} encounterAction={encounterAction} controls={tokenControls}
          onRosterFilterChange={setRosterFilter}
          onToggleGroup={(key) => setExpandedGroups((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; })}
          onSelectToken={(id) => { setSelectedTokenId(id); setSelectedMapNoteId(null); }}
          onCloseMapNote={() => setSelectedMapNoteId(null)} onResizeSpell={tokenControls.resizeSpellEffect}
          onDeleteToken={(token) => void deleteToken(token)} canMoveToken={canMoveToken}
          onHideToken={(token) => void runOptimisticCommand("update-token", { tokenId: token.id, hidden: !token.hidden }, (current) => ({ ...current, tokens: current.tokens.map((item) => item.id === token.id ? { ...item, hidden: !token.hidden } : item) }), token.hidden ? "Token revealed." : "Token hidden.")}
          onEndTurn={endTurnOptimistically}
          onStartOrRestart={() => { if (inCombat) setRestartConfirmOpen(true); else startCombatOptimistically(); }}
          onAdvanceTurn={advanceTurnOptimistically}
          onPauseOrResume={() => void configureEncounterOptimistically(state.encounter.status === "paused" ? "active" : "paused", state.encounter.status === "paused" ? "Encounter resumed." : "Encounter paused.")}
          onRequestReset={() => setResetConfirmOpen(true)} onCorrectTurn={correctTurnOptimistically}
        />

      </div>
      <EncounterDialogs
        participant={participant} state={state} resetOpen={resetConfirmOpen} restartOpen={restartConfirmOpen}
        concentrationReminder={tokenControls.concentrationReminder}
        scenario={scenarioControls} handoutTitle={handoutTitle} handoutUploading={handoutUploading}
        handoutUploadError={handoutUploadError} handoutDeletingId={handoutDeletingId}
        lightboxHandout={lightboxHandout} handoutFitMode={handoutFitMode}
        onResetOpen={setResetConfirmOpen} onRestartOpen={setRestartConfirmOpen}
        onReset={() => { setResetConfirmOpen(false); void configureEncounterOptimistically("setup", "Encounter reset to setup."); }}
        onRestart={() => { setRestartConfirmOpen(false); startCombatOptimistically(); }}
        onDismissConcentrationReminder={tokenControls.dismissConcentrationReminder}
        onHandoutTitle={setHandoutTitle}
        onUploadHandout={(file, title, replaceId) => void uploadHandout(file, title, false, replaceId)}
        onPreviewHandout={(handout) => { setLightboxHandout({ id: handout.id, title: handout.title, width: handout.width, height: handout.height, updatedAt: handout.updatedAt, available: true }); setHandoutFitMode(true); }}
        onDeleteHandout={(handout) => void deleteHandout(handout)} onHandoutFitMode={setHandoutFitMode}
        onCloseLightbox={() => setLightboxHandout(null)}
      />
    </main>
  );
}
