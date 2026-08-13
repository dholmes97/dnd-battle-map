"use client";

import {
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import MapWorkshop from "@/app/map-workshop";
import {
  PING_DURATION_MS,
  SPOTLIGHT_DURATION_MS,
  type BattleMapViewport as Viewport,
  type PlacementPreview,
  type SpellPlacementPreview,
  type TokenPreview,
} from "@/app/battle-map-renderer";
import {
  battleMapApi as api,
  sessionPayload,
  useEncounterSync,
} from "@/app/use-encounter-sync";
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
import { usePersonalUiSettings } from "@/app/use-personal-ui-settings";
import { JoinScreen, type JoinIdentity } from "@/app/join-screen";
import { CreaturePalette, SpellPalette } from "@/app/battle-map-palettes";
import { EncounterSidebar, type RosterRow } from "@/app/encounter-sidebar";
import {
  type CreatureTemplate,
  tokenRadiusCells,
} from "@/shared/creature-library";
import type {
  EncounterState,
  MapPoint,
  Role,
  SharedAnnotation,
  SharedToken,
} from "@/shared/contracts";
import { insertSharedFogPoint } from "@/shared/fog-of-war.ts";
import { transitionTokenMove } from "@/shared/encounter-transitions.ts";
import { movementPolicyDenial } from "@/shared/battle-map-policies.ts";
import {
  calculateDirectDistance,
  clampMapPoint,
  clampViewport,
  drawingAtPoint,
  viewportGeometry,
  zoomViewportAt,
} from "@/shared/battle-map-geometry.ts";
import { buildRosterRows } from "@/shared/initiative-domain.ts";
import {
  SPELL_EFFECT_KIND,
  spellEffectByArt,
  spellEffectById,
  type SpellEffectDefinition,
} from "@/shared/spell-effects";

type DragGesture = {
  pointerId: number;
  tokenId: string;
  origin: MapPoint;
  latest: MapPoint;
  grabOffset: MapPoint;
};
type PanGesture = {
  pointerId: number;
  clientX: number;
  clientY: number;
  viewport: Viewport;
};
type FogVertexGesture = { pointerId: number; vertexIndex: number; polygon: MapPoint[] };

const DEFAULT_CODE = "EMBER-KEEP";
const DEFAULT_ENCOUNTER: EncounterSummary = { code: DEFAULT_CODE, name: "Swamp Battle", status: "setup", updatedAt: 0 };
const JOIN_IDENTITIES: JoinIdentity[] = [
  { label: "Join as Dan (Dar'eleth)", participantName: "Dan", role: "player" },
  { label: "Join as Barry (Jelton)", participantName: "Barry", role: "player" },
  { label: "Join as Scott (Malichar)", participantName: "Scott", role: "player" },
  { label: "Join as Kevin (DM)", participantName: "Kevin", role: "dm" },
];
const JOIN_TIMEOUT_MS = 12_000;
function pointerToMap(
  canvas: HTMLCanvasElement,
  state: EncounterState,
  viewport: Viewport,
  clientX: number,
  clientY: number,
  radius?: number,
) {
  const rect = canvas.getBoundingClientRect();
  const geometry = viewportGeometry(viewport, state, rect.width, rect.height);
  return clampMapPoint(state.grid, {
    x: geometry.panX + (clientX - rect.left - geometry.offsetX) / geometry.cellSize,
    y: geometry.panY + (clientY - rect.top - geometry.offsetY) / geometry.cellSize,
  }, radius);
}

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

let nativeDragGhost: HTMLCanvasElement | null = null;

function suppressNativeDragGhost(dataTransfer: DataTransfer) {
  // Browsers can snapshot a drag image after the dragstart frame. Reusing a
  // persistent, nearly transparent square prevents a late fallback to the
  // rectangular palette tile and its black-backed source artwork.
  if (!nativeDragGhost) {
    const ghost = document.createElement("canvas");
    ghost.width = 1;
    ghost.height = 1;
    ghost.getContext("2d")?.fillRect(0, 0, 1, 1);
    Object.assign(ghost.style, {
      position: "fixed",
      top: "-2px",
      left: "-2px",
      width: "1px",
      height: "1px",
      opacity: "0.01",
      pointerEvents: "none",
    });
    document.body.appendChild(ghost);
    nativeDragGhost = ghost;
  }
  dataTransfer.setDragImage(nativeDragGhost, 0, 0);
}

export default function BattleMapPrototype() {
  const [encounterCode, setEncounterCode] = useState(DEFAULT_CODE);
  const [encounters, setEncounters] = useState<EncounterSummary[]>([DEFAULT_ENCOUNTER]);
  const [joiningIdentity, setJoiningIdentity] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const encounterSync = useEncounterSync({ setError, setNotice });
  const {
    participant,
    setParticipant,
    state,
    setState,
    connection,
    setConnection,
    acceptAuthoritativeState,
    refreshAfterError,
    command,
    runOptimisticCommand,
    pendingMovesRef,
    pendingCreatesRef,
    pendingDeletesRef,
    localUndoHistoryRef,
    localRedoHistoryRef,
    moveSequenceRef,
    tokenMutationSequenceRef,
    optimisticSequenceRef,
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
  const [preview, setPreview] = useState<TokenPreview | null>(null);
  const [dragOrigin, setDragOrigin] = useState<MapPoint | null>(null);
  const [dragging, setDragging] = useState(false);
  const [annotationMode, setAnnotationMode] = useState<AnnotationMode>("move");
  const [editingSharedFog, setEditingSharedFog] = useState(false);
  const [sharedFogPreview, setSharedFogPreview] = useState<MapPoint[] | null>(null);
  const [selectedSharedFogVertex, setSelectedSharedFogVertex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const history = useHistoryShortcuts({ sync: encounterSync, busy, setNotice });
  const [workshopOpen, setWorkshopOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [spellPaletteOpen, setSpellPaletteOpen] = useState(false);
  const [armedCreatureId, setArmedCreatureId] = useState<string | null>(null);
  const [placementPreview, setPlacementPreview] = useState<PlacementPreview | null>(null);
  const [armedSpellId, setArmedSpellId] = useState<string | null>(null);
  const [spellPlacementPreview, setSpellPlacementPreview] = useState<SpellPlacementPreview | null>(null);
  const [placementSummonerId, setPlacementSummonerId] = useState("");
  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, centerX: 12, centerY: 8, mapKey: "", fit: false });
  const [panning, setPanning] = useState(false);
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
  const scenarioControls = useScenarioControls({
    participant, state, sync: encounterSync, resetChatForParticipant,
    setEncounterCode, setEncounters, setSelectedTokenId, setNotice,
  });
  const {
    open: scenarioCreatorOpen, setOpen: setScenarioCreatorOpen,
    renaming: scenarioRenaming, creating: scenarioCreating,
  } = scenarioControls;
  const uiSettingsRef = useRef<HTMLDetailsElement>(null);
  const dragGestureRef = useRef<DragGesture | null>(null);
  const panGestureRef = useRef<PanGesture | null>(null);
  const annotationStartRef = useRef<{ pointerId: number; point: MapPoint } | null>(null);
  const fogVertexGestureRef = useRef<FogVertexGesture | null>(null);
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


  const normalizedCode = encounterCode.trim().toUpperCase() || DEFAULT_CODE;
  const selectedEncounter = encounters.find((encounter) => encounter.code === normalizedCode) ?? encounters[0] ?? DEFAULT_ENCOUNTER;
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
  const distance = state && dragOrigin && preview
    ? calculateDirectDistance(dragOrigin, preview, state.grid.feetPerCell)
    : 0;
  const remainingMovement = selectedToken ? Math.max(0, selectedToken.speed - distance) : 0;
  const overMovement = Boolean(selectedToken && distance > selectedToken.speed + 0.05);
  useMapAssets({
    state, participant, preview, placementPreview, spellPlacementPreview, dragOrigin, viewport,
    selectedTokenId: effectiveSelectedTokenId, selectedMapNoteId, gridOpacity,
    showColoredTokenCenters, showHealthRings, sharedFogPreview, selectedSharedFogVertex,
    pingStartedAtRef, canvasRef,
  });
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
        if (disposed || items.length === 0) return;
        setEncounters(items);
        setEncounterCode((current) => items.some((encounter) => encounter.code === current) ? current : items[0].code);
      })
      .catch(() => undefined);
    return () => { disposed = true; };
  }, []);

  const join = async (identity: JoinIdentity) => {
    const name = identity.participantName;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), JOIN_TIMEOUT_MS);
    enablePingAudio();
    setJoiningIdentity(identity.label); setBusy(true); setError("");
    try {
      const result = await api<{ participantId: string; sessionSecret: string; role: Role; state: EncounterState }>(
        `/api/encounters/${encodeURIComponent(normalizedCode)}/join`,
        { method: "POST", signal: controller.signal, body: JSON.stringify({ participantName: name, role: identity.role }) },
      );
      const joined = { id: result.participantId, name, role: result.role, sessionSecret: result.sessionSecret };
      personalUiSettings.loadForIdentity(name, result.role);
      resetChatForParticipant(name, result.role, result.state.encounter.code);
      setParticipant(joined); setState(result.state); setEncounterCode(result.state.encounter.code); setConnection("connecting");
    } catch (joinError) {
      setError(joinError instanceof DOMException && joinError.name === "AbortError"
        ? "The encounter took too long to respond. Please try again."
        : joinError instanceof Error ? joinError.message : "Unable to join.");
    } finally {
      window.clearTimeout(timeout);
      setJoiningIdentity(null);
      setBusy(false);
    }
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




  const addLiveSharedFogPoint = () => {
    const polygon = sharedFogPreview ?? state?.encounter.mapPackage?.fog.sharedPolygon;
    if (!polygon) return;
    const next = insertSharedFogPoint(polygon);
    setSharedFogPreview(next); setSelectedSharedFogVertex(null); updateSharedFogOptimistically(next);
  };

  const removeLiveSharedFogPoint = () => {
    const polygon = sharedFogPreview ?? state?.encounter.mapPackage?.fog.sharedPolygon;
    if (!polygon || selectedSharedFogVertex === null || polygon.length <= 3) return;
    const next = polygon.filter((_, index) => index !== selectedSharedFogVertex);
    setSharedFogPreview(next); setSelectedSharedFogVertex(null); updateSharedFogOptimistically(next);
  };

  useEffect(() => {
    if (!resetConfirmOpen && !restartConfirmOpen && !scenarioCreatorOpen && !lightboxHandout) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (lightboxHandout) { setLightboxHandout(null); return; }
        setResetConfirmOpen(false);
        setRestartConfirmOpen(false);
        if (!scenarioCreating && !scenarioRenaming && !handoutUploading) setScenarioCreatorOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [handoutUploading, lightboxHandout, resetConfirmOpen, restartConfirmOpen, scenarioCreating, scenarioCreatorOpen, scenarioRenaming, setLightboxHandout, setScenarioCreatorOpen]);


  const placeCreature = async (creature: CreatureTemplate, point: MapPoint) => {
    if (!participant || !state || !movementEnabled) return;
    if (participant.role === "player" && !effectivePlacementSummonerId) {
      setError("Your character is not available in this scenario, so a summon cannot be placed.");
      return;
    }
    const matchingCount = state.tokens.filter((token) => token.artAsset === creature.artAsset).length;
    const name = matchingCount === 0 ? creature.name : `${creature.name} ${matchingCount + 1}`;
    const summoner = effectivePlacementSummonerId ? state.tokens.find((token) => token.id === effectivePlacementSummonerId) : null;
    const temporaryId = `pending-create-${Date.now()}-${++tokenMutationSequenceRef.current}`;
    const historyMutationId = ++optimisticSequenceRef.current;
    const optimisticToken: SharedToken = {
      id: temporaryId,
      name,
      artAsset: creature.artAsset,
      kind: effectivePlacementSummonerId ? "summon" : "monster",
      size: creature.size,
      speed: creature.defaultSpeed,
      hp: creature.defaultHp,
      maxHp: creature.defaultHp,
      healthState: null,
      hidden: false,
      summonerTokenId: effectivePlacementSummonerId || null,
      initiative: summoner?.initiative ?? null,
      initiativeGroupId: null,
      initiativeOrder: summoner?.initiativeOrder ?? null,
      turnComplete: false,
      movementUsed: 0,
      movementOrigin: null,
      effects: [],
      controller: summoner?.controller ?? { name: participant.name },
      controlledByViewer: true,
      x: point.x,
      y: point.y,
    };
    pendingCreatesRef.current.set(temporaryId, optimisticToken);
    setState((current) => {
      if (!current) return current;
      localUndoHistoryRef.current = [...localUndoHistoryRef.current.slice(-9), { mutationId: historyMutationId, state: current }];
      localRedoHistoryRef.current = [];
      return { ...current, undo: { ...current.undo, available: Math.min(10, current.undo.available + 1), redoAvailable: 0 }, tokens: [...current.tokens, optimisticToken] };
    });
    setPlacementPreview(null);
    setError("");
    try {
      await command<{ tokenId: string; state: EncounterState }>("create-token", {
        name,
        kind: effectivePlacementSummonerId ? "summon" : "monster",
        size: creature.size,
        speed: creature.defaultSpeed,
        maxHp: creature.defaultHp,
        hp: creature.defaultHp,
        artAsset: creature.artAsset,
        summonerTokenId: effectivePlacementSummonerId || undefined,
        x: point.x,
        y: point.y,
      }, (confirmed) => {
        pendingCreatesRef.current.delete(temporaryId);
        setState((current) => current ? { ...current, tokens: current.tokens.filter((token) => token.id !== temporaryId) } : current);
        setSelectedTokenId(confirmed.tokenId);
      });
      setNotice(`${name} placed at ${creature.defaultHp} HP.`);
    } catch (placementError) {
      pendingCreatesRef.current.delete(temporaryId);
      localUndoHistoryRef.current = localUndoHistoryRef.current.filter((entry) => entry.mutationId !== historyMutationId);
      setState((current) => current ? { ...current, tokens: current.tokens.filter((token) => token.id !== temporaryId) } : current);
      setError(placementError instanceof Error ? placementError.message : "Creature placement was rejected.");
      await refreshAfterError();
    }
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
    setSpellPlacementPreview(null);
    const matchingCount = state.tokens.filter((token) => token.kind === SPELL_EFFECT_KIND && token.artAsset === spell.artAsset).length;
    const name = matchingCount === 0 ? spell.name : `${spell.name} ${matchingCount + 1}`;
    const caster = effectivePlacementSummonerId ? state.tokens.find((token) => token.id === effectivePlacementSummonerId) : null;
    const temporaryId = `pending-create-${Date.now()}-${++tokenMutationSequenceRef.current}`;
    const historyMutationId = ++optimisticSequenceRef.current;
    const optimisticToken: SharedToken = {
      id: temporaryId,
      name,
      artAsset: spell.artAsset,
      kind: SPELL_EFFECT_KIND,
      size: spell.size,
      speed: 0,
      hp: null,
      maxHp: null,
      healthState: null,
      hidden: false,
      summonerTokenId: effectivePlacementSummonerId || null,
      initiative: caster?.initiative ?? null,
      initiativeGroupId: null,
      initiativeOrder: caster?.initiativeOrder ?? null,
      turnComplete: false,
      movementUsed: 0,
      movementOrigin: null,
      effects: [],
      controller: caster?.controller ?? { name: participant.name },
      controlledByViewer: true,
      x: point.x,
      y: point.y,
    };
    pendingCreatesRef.current.set(temporaryId, optimisticToken);
    setState((current) => {
      if (!current) return current;
      localUndoHistoryRef.current = [...localUndoHistoryRef.current.slice(-9), { mutationId: historyMutationId, state: current }];
      localRedoHistoryRef.current = [];
      return { ...current, undo: { ...current.undo, available: Math.min(10, current.undo.available + 1), redoAvailable: 0 }, tokens: [...current.tokens, optimisticToken] };
    });
    setError("");
    try {
      await command<{ tokenId: string; state: EncounterState }>("create-spell-effect", {
        spellId: spell.id,
        summonerTokenId: effectivePlacementSummonerId || undefined,
        x: point.x,
        y: point.y,
      }, (confirmed) => {
        pendingCreatesRef.current.delete(temporaryId);
        setState((current) => current ? { ...current, tokens: current.tokens.filter((token) => token.id !== temporaryId) } : current);
        setSelectedTokenId(confirmed.tokenId);
      });
      setNotice(`${spell.name} manifested.`);
    } catch (placementError) {
      pendingCreatesRef.current.delete(temporaryId);
      localUndoHistoryRef.current = localUndoHistoryRef.current.filter((entry) => entry.mutationId !== historyMutationId);
      setState((current) => current ? { ...current, tokens: current.tokens.filter((token) => token.id !== temporaryId) } : current);
      setError(placementError instanceof Error ? placementError.message : "Spell placement was rejected.");
      await refreshAfterError();
    }
  };

  const deleteToken = async (token: SharedToken) => {
    if (!participant || !state || pendingCreatesRef.current.has(token.id)) return;
    if (participant.role !== "dm" && (token.kind !== SPELL_EFFECT_KIND || !token.controlledByViewer)) return;
    pendingDeletesRef.current.add(token.id);
    pendingMovesRef.current.delete(token.id);
    setState((current) => current ? { ...current, tokens: current.tokens.filter((currentToken) => currentToken.id !== token.id) } : current);
    setSelectedTokenId((current) => current === token.id ? null : current);
    setError("");
    try {
      await command("delete-token", { tokenId: token.id }, () => {
        pendingDeletesRef.current.delete(token.id);
      });
      setNotice(token.kind === SPELL_EFFECT_KIND ? `${token.name} dismissed.` : "Token removed.");
    } catch (deleteError) {
      pendingDeletesRef.current.delete(token.id);
      setState((current) => current && !current.tokens.some((currentToken) => currentToken.id === token.id)
        ? { ...current, tokens: [...current.tokens, token] }
        : current);
      setError(deleteError instanceof Error ? deleteError.message : "Token deletion was rejected.");
      await refreshAfterError();
    }
  };

  const paletteCreature = (id: string | null) => creatures.find((creature) => creature.id === id) ?? null;

  const onPaletteDragStart = (event: ReactDragEvent<HTMLButtonElement>, creature: CreatureTemplate) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-creature-id", creature.id);
    setArmedCreatureId(creature.id);
  };

  const onSpellDragStart = (event: ReactDragEvent<HTMLButtonElement>, spell: SpellEffectDefinition) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-spell-effect-id", spell.id);
    suppressNativeDragGhost(event.dataTransfer);
    setArmedSpellId(spell.id);
  };

  const onMapDragOver = (event: ReactDragEvent<HTMLCanvasElement>) => {
    if (!state || !participant || !movementEnabled || (participant.role === "player" && !playerCharacter)) return;
    const spell = spellEffectById(event.dataTransfer.getData("application/x-spell-effect-id") || armedSpellId);
    if (spell) {
      event.preventDefault(); event.dataTransfer.dropEffect = "copy";
      const point = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY, tokenRadiusCells(spell.size));
      setSpellPlacementPreview({ spell, ...point });
      return;
    }
    const creature = paletteCreature(event.dataTransfer.getData("application/x-creature-id") || armedCreatureId);
    if (!creature) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    const point = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY, tokenRadiusCells(creature.size));
    setPlacementPreview({ creature, ...point });
  };

  const onMapDrop = (event: ReactDragEvent<HTMLCanvasElement>) => {
    if (!state || !participant || !movementEnabled || (participant.role === "player" && !playerCharacter)) return;
    const spell = spellEffectById(event.dataTransfer.getData("application/x-spell-effect-id") || armedSpellId);
    if (spell) {
      event.preventDefault();
      const point = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY, tokenRadiusCells(spell.size));
      void placeSpellEffect(spell, point);
      return;
    }
    const creature = paletteCreature(event.dataTransfer.getData("application/x-creature-id") || armedCreatureId);
    if (!creature) return;
    event.preventDefault();
    const point = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY, tokenRadiusCells(creature.size));
    void placeCreature(creature, point);
  };

  const publishMove = async (tokenId: string, destination: MapPoint, encounter = state?.encounter.code) => {
    if (!participant || !encounter) return;
    const sequence = ++moveSequenceRef.current;
    const historyMutationId = ++optimisticSequenceRef.current;
    let authoritativeDestination = destination;
    let applied = false;
    flushSync(() => {
      setState((current) => {
        if (!current) return current;
        const movingToken = current.tokens.find((token) => token.id === tokenId);
        if (!movingToken) return current;
        const move = transitionTokenMove({
          previous: movingToken,
          destination,
          previousMovementOrigin: movingToken.movementOrigin,
          previousMovementUsed: movingToken.movementUsed,
          size: movingToken.size,
          grid: current.grid,
          speed: movingToken.speed,
          encounterStatus: current.encounter.status,
          isSpellEffect: movingToken.kind === SPELL_EFFECT_KIND,
        });
        authoritativeDestination = move.position;
        applied = true;
        pendingMovesRef.current.set(tokenId, { ...move.position, sequence, movementUsed: move.movementUsed, movementOrigin: move.movementOrigin });
        localUndoHistoryRef.current = [...localUndoHistoryRef.current.slice(-9), { mutationId: historyMutationId, state: current }];
        localRedoHistoryRef.current = [];
        return { ...current, undo: { ...current.undo, available: Math.min(10, current.undo.available + 1), redoAvailable: 0 }, tokens: current.tokens.map((token) => token.id === tokenId ? { ...token, ...move.position, movementUsed: move.movementUsed, movementOrigin: move.movementOrigin } : token) };
      });
    });
    if (!applied) return;
    setPreview(null); setDragOrigin(null); setError("");
    try {
      const result = await api<{ distance: number; overBudget: boolean; state: EncounterState }>(
        `/api/encounters/${encodeURIComponent(encounter)}/move`,
        { method: "POST", body: sessionPayload(participant, { tokenId, ...authoritativeDestination }) },
      );
      if (pendingMovesRef.current.get(tokenId)?.sequence === sequence) pendingMovesRef.current.delete(tokenId);
      acceptAuthoritativeState(result.state);
      const movedToken = state?.tokens.find((token) => token.id === tokenId);
      setNotice(movedToken?.kind === SPELL_EFFECT_KIND
        ? `${movedToken.name} repositioned.`
        : result.overBudget
          ? `Move confirmed · ${result.distance} ft · over movement.`
          : `Move confirmed · ${result.distance} ft.`);
    } catch (moveError) {
      if (pendingMovesRef.current.get(tokenId)?.sequence === sequence) pendingMovesRef.current.delete(tokenId);
      localUndoHistoryRef.current = localUndoHistoryRef.current.filter((entry) => entry.mutationId !== historyMutationId);
      setError(moveError instanceof Error ? moveError.message : "Move rejected.");
      await refreshAfterError();
    }
  };

  const addAnnotation = async (type: AnnotationMode, start: MapPoint, end?: MapPoint) => {
    if (type === "move" || type === "erase") return;
    const temporaryId = `pending-annotation-${Date.now()}-${++tokenMutationSequenceRef.current}`;
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

  const eraseAnnotationAtPoint = (canvas: HTMLCanvasElement, point: MapPoint) => {
    if (!state) return;
    const rect = canvas.getBoundingClientRect();
    const cellPixels = viewportGeometry(viewport, state, rect.width, rect.height).cellSize;
    const annotation = drawingAtPoint(state.annotations, point, 10 / Math.max(1, cellPixels));
    if (!annotation) {
      setNotice("Click closer to a drawn line.");
      return;
    }
    void runOptimisticCommand(
      "remove-annotation",
      { annotationId: annotation.id },
      (current) => ({ ...current, annotations: current.annotations.filter((item) => item.id !== annotation.id) }),
      "Line erased.",
    );
  };

  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!state || !participant) return;
    if (event.button !== 0) return;
    const point = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY);
    const rect = event.currentTarget.getBoundingClientRect();
    const geometry = viewportGeometry(viewport, state, rect.width, rect.height);
    if (editingSharedFog && participant.role === "dm" && state.encounter.mapPackage?.fog.mode === "shared") {
      const polygon = sharedFogPreview ?? state.encounter.mapPackage.fog.sharedPolygon;
      const fogPoint = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY, 0);
      const vertexIndex = polygon.findIndex((vertex) => Math.hypot((fogPoint.x - vertex.x) * geometry.cellSize, (fogPoint.y - vertex.y) * geometry.cellSize) <= 13);
      event.preventDefault();
      if (vertexIndex < 0) { setNotice("Drag one of the shared-fog corner handles."); return; }
      setSelectedSharedFogVertex(vertexIndex);
      event.currentTarget.setPointerCapture(event.pointerId);
      fogVertexGestureRef.current = { pointerId: event.pointerId, vertexIndex, polygon: polygon.map((vertex) => ({ ...vertex })) };
      setSharedFogPreview(polygon.map((vertex) => ({ ...vertex })));
      return;
    }
    const hitMapNote = participant.role === "dm"
      ? [...(state.encounter.mapPackage?.notes ?? [])].reverse().find((note) => {
          const deltaX = (point.x - note.x) * geometry.cellSize;
          const deltaY = (point.y - note.y) * geometry.cellSize;
          return Math.hypot(deltaX, deltaY) <= Math.max(12, geometry.cellSize * 0.32);
        }) ?? null
      : null;
    const hitTokens = [...state.tokens].reverse().filter((token) => {
      if (pendingCreatesRef.current.has(token.id)) return false;
      const deltaX = (point.x - token.x) * geometry.cellSize;
      const deltaY = (point.y - token.y) * geometry.cellSize;
      const radius = geometry.cellSize * tokenRadiusCells(token.size);
      const distance = Math.hypot(deltaX, deltaY);
      const spell = token.kind === SPELL_EFFECT_KIND ? spellEffectByArt(token.artAsset) : null;
      if (spell?.id === "magic-circle") {
        const outerRadius = radius * 1.25;
        return distance >= outerRadius * 0.72 && distance <= outerRadius * 1.08;
      }
      if (spell?.shape === "square") {
        const halfSize = radius * 1.16;
        return Math.abs(point.x - token.x) * geometry.cellSize <= halfSize && Math.abs(point.y - token.y) * geometry.cellSize <= halfSize;
      }
      if (spell?.shape === "circle") return distance <= radius * 1.16;
      return distance <= radius;
    });
    // A circle is scenery around its occupants: clicking a token inside must
    // select that token, while clicking the luminous perimeter selects the spell.
    const hitToken = hitTokens.find((token) => token.kind !== SPELL_EFFECT_KIND) ?? hitTokens[0];
    if (annotationMode === "move" && hitMapNote) {
      event.preventDefault();
      setSelectedMapNoteId(hitMapNote.id);
      setSelectedTokenId(null);
      return;
    }
    if (!movementEnabled) {
      if (hitToken?.kind === SPELL_EFFECT_KIND) setSelectedTokenId(hitToken.id);
      return;
    }
    const armedCreature = participant.role === "dm" || playerCharacter ? paletteCreature(armedCreatureId) : null;
    if (armedCreature) {
      event.preventDefault();
      const placementPoint = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY, tokenRadiusCells(armedCreature.size));
      void placeCreature(armedCreature, placementPoint);
      return;
    }
    const armedSpell = participant.role === "dm" || playerCharacter ? spellEffectById(armedSpellId) : null;
    if (armedSpell) {
      event.preventDefault();
      const placementPoint = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY, tokenRadiusCells(armedSpell.size));
      void placeSpellEffect(armedSpell, placementPoint);
      return;
    }
    if (annotationMode !== "move") {
      event.preventDefault();
      if (annotationMode === "erase") {
        eraseAnnotationAtPoint(event.currentTarget, point);
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      if (annotationMode === "drawing") annotationStartRef.current = { pointerId: event.pointerId, point };
      else void addAnnotation(annotationMode, point);
      return;
    }
    if (hitToken && !dragGestureRef.current) {
      event.preventDefault();
      setSelectedTokenId(hitToken.id);
      setSelectedMapNoteId(null);
      if (!canMoveToken(hitToken)) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const gesture: DragGesture = {
        pointerId: event.pointerId, tokenId: hitToken.id,
        origin: { x: hitToken.x, y: hitToken.y }, latest: { x: hitToken.x, y: hitToken.y },
        grabOffset: { x: point.x - hitToken.x, y: point.y - hitToken.y },
      };
      dragGestureRef.current = gesture; setDragging(true); setPreview({ tokenId: hitToken.id, x: hitToken.x, y: hitToken.y });
      setDragOrigin(hitToken.kind === SPELL_EFFECT_KIND ? null : state.encounter.status === "active" ? hitToken.movementOrigin ?? gesture.origin : gesture.origin);
      return;
    }
    if (!panGestureRef.current) {
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      panGestureRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        viewport: { zoom: geometry.fit ? 1 : geometry.zoom, centerX: geometry.centerX, centerY: geometry.centerY, mapKey: geometry.mapKey, fit: geometry.fit },
      };
      setPanning(true);
    }
  };

  const dragPoint = (canvas: HTMLCanvasElement, gesture: DragGesture, clientX: number, clientY: number) => {
    if (!state) return gesture.latest;
    const token = state.tokens.find((item) => item.id === gesture.tokenId);
    const radius = tokenRadiusCells(token?.size ?? "medium");
    const pointer = pointerToMap(canvas, state, viewport, clientX, clientY, radius);
    return clampMapPoint(state.grid, { x: pointer.x - gesture.grabOffset.x, y: pointer.y - gesture.grabOffset.y }, radius);
  };

  const onCanvasPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const fogGesture = fogVertexGestureRef.current;
    if (fogGesture?.pointerId === event.pointerId && state) {
      event.preventDefault();
      const point = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY, 0);
      fogGesture.polygon[fogGesture.vertexIndex] = clampMapPoint(state.grid, point, 0);
      setSharedFogPreview(fogGesture.polygon.map((vertex) => ({ ...vertex })));
      return;
    }
    const pan = panGestureRef.current;
    if (pan?.pointerId === event.pointerId && state) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const geometry = viewportGeometry(pan.viewport, state, rect.width, rect.height);
      setViewport(clampViewport({
        ...pan.viewport,
        centerX: pan.viewport.centerX - (event.clientX - pan.clientX) / geometry.cellSize,
        centerY: pan.viewport.centerY - (event.clientY - pan.clientY) / geometry.cellSize,
      }, state, rect.width, rect.height));
      return;
    }
    const gesture = dragGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault(); gesture.latest = dragPoint(event.currentTarget, gesture, event.clientX, event.clientY);
    setPreview({ tokenId: gesture.tokenId, ...gesture.latest });
  };

  const onCanvasPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const fogGesture = fogVertexGestureRef.current;
    if (fogGesture?.pointerId === event.pointerId) {
      event.preventDefault(); fogVertexGestureRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      const polygon = fogGesture.polygon.map((vertex) => ({ ...vertex }));
      setSharedFogPreview(polygon); updateSharedFogOptimistically(polygon); return;
    }
    const pan = panGestureRef.current;
    if (pan?.pointerId === event.pointerId) {
      event.preventDefault(); panGestureRef.current = null; setPanning(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    const drawing = annotationStartRef.current;
    if (drawing?.pointerId === event.pointerId && state) {
      const end = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY);
      annotationStartRef.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      void addAnnotation("drawing", drawing.point, end); return;
    }
    const gesture = dragGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault(); gesture.latest = dragPoint(event.currentTarget, gesture, event.clientX, event.clientY);
    dragGestureRef.current = null; setPreview({ tokenId: gesture.tokenId, ...gesture.latest }); setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (Math.hypot(gesture.latest.x - gesture.origin.x, gesture.latest.y - gesture.origin.y) < 0.001) {
      setPreview(null); setDragOrigin(null); return;
    }
    void publishMove(gesture.tokenId, gesture.latest);
  };

  const onCanvasPointerCancel = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    annotationStartRef.current = null;
    if (fogVertexGestureRef.current?.pointerId === event.pointerId) {
      fogVertexGestureRef.current = null; setSharedFogPreview(state?.encounter.mapPackage?.fog.sharedPolygon ?? null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    if (panGestureRef.current?.pointerId === event.pointerId) {
      panGestureRef.current = null; setPanning(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    const gesture = dragGestureRef.current; if (!gesture || gesture.pointerId !== event.pointerId) return;
    dragGestureRef.current = null; setPreview(null); setDragOrigin(null); setDragging(false);
  };

  const onCanvasWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    if (!state) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const focusX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const focusY = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    setViewport((current) => zoomViewportAt(current, state, rect.width, rect.height, current.zoom * Math.exp(-event.deltaY * 0.0015), focusX, focusY));
  };

  const changeZoom = (amount: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !state) return;
    const rect = canvas.getBoundingClientRect();
    setViewport((current) => {
      const geometry = viewportGeometry(current, state, rect.width, rect.height);
      return zoomViewportAt(current, state, rect.width, rect.height, geometry.zoom < 1 && amount > 0 ? 1 : geometry.zoom + amount);
    });
  };

  const fitViewport = () => {
    if (!state) return;
    setViewport({
      zoom: 1,
      centerX: state.grid.width / 2,
      centerY: state.grid.height / 2,
      mapKey: `${state.encounter.mapPackage?.id ?? "empty"}:${state.grid.width}x${state.grid.height}`,
      fit: true,
    });
  };

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

  if (!participant || !state) {
    return <JoinScreen encounters={encounters} selectedCode={selectedEncounter.code} joiningIdentity={joiningIdentity} busy={busy} error={error} identities={JOIN_IDENTITIES} onEncounterChange={setEncounterCode} onJoin={(identity) => void join(identity)} />;
  }

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
    onCommand={async (name, extra) => command<{ state: EncounterState; presetId?: string }>(name, extra)}
    onClose={() => setWorkshopOpen(false)}
  />;

  const mapKey = `${state.encounter.mapPackage?.id ?? "empty"}:${state.grid.width}x${state.grid.height}`;
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
        mapKey={mapKey} connection={connection} connectionLabel={connectionLabel} connectionTooltip={connectionTooltip}
        uiSettingsRef={uiSettingsRef} gridOpacity={gridOpacity} showColoredTokenCenters={showColoredTokenCenters}
        showHealthRings={showHealthRings} sidebarOpen={sidebarOpen} presenting={presenting}
        onAnnotationMode={(mode) => { if (mode === "ping") enablePingAudio(); setAnnotationMode(mode); }}
        onToggleFogEditor={() => { setEditingSharedFog((current) => { const next = !current; setSharedFogPreview(next ? state.encounter.mapPackage?.fog.sharedPolygon ?? null : null); setSelectedSharedFogVertex(null); if (next) fitViewport(); return next; }); setAnnotationMode("move"); }}
        onClearAnnotations={() => void runOptimisticCommand("clear-annotations", {}, (current) => ({ ...current, annotations: [] }), "Annotations cleared.")}
        onToggleChat={() => { if (!chatOpen) { markChatChannelRead(activeChatChannel); setChatOpen(true); setChatMinimized(false); chatShouldStickRef.current = true; } else if (chatMinimized) { markChatChannelRead(activeChatChannel); setChatMinimized(false); chatShouldStickRef.current = true; } else { markChatChannelRead(activeChatChannel); setChatOpen(false); } }}
        onToggleCreatures={() => { setPaletteOpen((open) => !open); setSpellPaletteOpen(false); setArmedSpellId(null); setSpellPlacementPreview(null); setAnnotationMode("move"); }}
        onToggleSpells={() => { setSpellPaletteOpen((open) => !open); setPaletteOpen(false); setArmedCreatureId(null); setPlacementPreview(null); setAnnotationMode("move"); }}
        onOpenWorkshop={() => setWorkshopOpen(true)} onManageScenarios={scenarioControls.show}
        onHistory={(direction) => void history.run(direction)} onFit={fitViewport} onZoom={changeZoom}
        onResetZoom={() => setViewport({ zoom: 1, centerX: state.grid.width / 2, centerY: state.grid.height / 2, mapKey, fit: false })}
        onGridOpacityChange={setGridOpacity} onColoredTokenCentersChange={setShowColoredTokenCenters}
        onHealthRingsChange={setShowHealthRings} onFogModeChange={setFogModeOptimistically}
        onVisionDoorChange={setVisionDoorOpenOptimistically} onStrictMovementChange={setStrictMovementOptimistically}
        onToggleSidebar={() => setSidebarOpen((open) => !open)} onTogglePresenting={togglePresenting}
      />

      <div className="workspace">
        <section className="map-panel" aria-label="Shared battle map">
          <div className="map-stage">
          <div className="map-frame" style={{ aspectRatio: `${state.grid.width} / ${state.grid.height}` }}>
            <canvas ref={canvasRef} className={`map-canvas${dragging ? " is-dragging" : ""}${panning ? " is-panning" : ""}${armedCreatureId || armedSpellId ? " is-placing" : ""}${annotationMode === "erase" ? " is-erasing" : ""}${editingSharedFog ? " is-editing-fog" : ""}${movementEnabled ? "" : " is-blocked"}`} onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove} onPointerUp={onCanvasPointerUp} onPointerCancel={onCanvasPointerCancel} onWheel={onCanvasWheel} onDragOver={onMapDragOver} onDrop={onMapDrop} onDragLeave={() => { setPlacementPreview(null); setSpellPlacementPreview(null); }} aria-label={`${state.grid.width} by ${state.grid.height} battle grid with ${state.tokens.length} visible tokens. ${armedCreatureId ? "Click to place the selected creature." : armedSpellId ? "Click to manifest the selected spell effect." : annotationMode === "erase" ? "Erase mode. Click a drawn line to remove it." : participant.role === "dm" || !state.encounter.strictMovement ? "Drag any visible token to move it, or drag empty map space to pan." : selectedToken ? `Selected ${selectedToken.name}. Drag the token to move it, or drag empty map space to pan.` : "Scroll to zoom and drag empty map space to pan."}`} role="img" />
            {editingSharedFog ? <div className="fog-live-controls" role="group" aria-label="Shared fog corner controls"><span>Drag a corner handle to reshape the hidden area.</span><button type="button" onClick={addLiveSharedFogPoint}>Add corner</button><button type="button" className="is-danger" disabled={selectedSharedFogVertex === null || (sharedFogPreview?.length ?? 0) <= 3} onClick={removeLiveSharedFogPoint}>Remove selected</button><button type="button" onClick={() => { setEditingSharedFog(false); setSharedFogPreview(null); setSelectedSharedFogVertex(null); }}>Done</button></div> : null}
            {paletteOpen ? <CreaturePalette
              participant={participant} tokens={state.tokens} playerCharacter={playerCharacter}
              creatures={creatures} families={creatureFamilies} query={creatureQuery} family={creatureFamily}
              cursor={creatureCursor} loading={creatureCatalogLoading} error={creatureCatalogError}
              armedId={armedCreatureId} summonerId={placementSummonerId}
              onClose={() => { setPaletteOpen(false); setArmedCreatureId(null); setPlacementPreview(null); }}
              onSummonerChange={setPlacementSummonerId}
              onQueryChange={(value) => { setCreatureQuery(value); setArmedCreatureId(null); setPlacementPreview(null); }}
              onFamilyChange={(value) => { setCreatureFamily(value); setArmedCreatureId(null); setPlacementPreview(null); }}
              onArm={(id) => { setArmedCreatureId(id); if (!id) setPlacementPreview(null); }}
              onDragStart={onPaletteDragStart} onDragEnd={() => setPlacementPreview(null)} onLoadMore={() => void loadMoreCreatures()}
            /> : null}
            {spellPaletteOpen ? <SpellPalette
              participant={participant} playerCharacter={playerCharacter} armedId={armedSpellId}
              onClose={() => { setSpellPaletteOpen(false); setArmedSpellId(null); setSpellPlacementPreview(null); }}
              onArm={(id) => { setArmedSpellId(id); if (!id) setSpellPlacementPreview(null); }}
              onDragStart={onSpellDragStart} onDragEnd={() => setSpellPlacementPreview(null)}
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
          selectedSpell={selectedSpell} selectedMapNote={selectedMapNote} preview={preview}
          distance={distance} remainingMovement={remainingMovement} overMovement={overMovement}
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
        scenario={scenarioControls} handoutTitle={handoutTitle} handoutUploading={handoutUploading}
        handoutUploadError={handoutUploadError} handoutDeletingId={handoutDeletingId}
        lightboxHandout={lightboxHandout} handoutFitMode={handoutFitMode}
        onResetOpen={setResetConfirmOpen} onRestartOpen={setRestartConfirmOpen}
        onReset={() => { setResetConfirmOpen(false); void configureEncounterOptimistically("setup", "Encounter reset to setup."); }}
        onRestart={() => { setRestartConfirmOpen(false); startCombatOptimistically(); }}
        onHandoutTitle={setHandoutTitle}
        onUploadHandout={(file, title, replaceId) => void uploadHandout(file, title, false, replaceId)}
        onPreviewHandout={(handout) => { setLightboxHandout({ id: handout.id, title: handout.title, width: handout.width, height: handout.height, updatedAt: handout.updatedAt, available: true }); setHandoutFitMode(true); }}
        onDeleteHandout={(handout) => void deleteHandout(handout)} onHandoutFitMode={setHandoutFitMode}
        onCloseLightbox={() => setLightboxHandout(null)}
      />
    </main>
  );
}
