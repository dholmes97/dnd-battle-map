"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import styles from "./world-map.module.css";

type Point = { x: number; y: number };
type View = Point & { scale: number };
type AtlasMarker = Point & {
  name: string;
  detail?: string;
  kind?: "place" | "region" | "destination";
  destination?: number;
};
type AtlasLevel = {
  id: string;
  name: string;
  scope: string;
  description: string;
  image: string;
  nextFocus?: Point;
  markers: AtlasMarker[];
};

const LEVELS: AtlasLevel[] = [
  {
    id: "faerun",
    name: "Faerûn",
    scope: "Continent",
    description: "The western heart of Toril, from the frozen north to the jungles of Chult.",
    image: "/world-atlas/faerun-overview-v1.webp",
    nextFocus: { x: 20.5, y: 40 },
    markers: [
      { name: "Sword Coast", detail: "Open regional map", x: 20.5, y: 40, kind: "destination", destination: 1 },
      { name: "Icewind Dale", x: 25, y: 13, kind: "region" },
      { name: "High Forest", x: 35, y: 35, kind: "region" },
      { name: "Anauroch", x: 57, y: 32, kind: "region" },
      { name: "The Dalelands", x: 70, y: 40, kind: "region" },
      { name: "Sea of Fallen Stars", x: 69, y: 54, kind: "region" },
      { name: "Calimshan", x: 29, y: 73, kind: "region" },
      { name: "Chult", x: 12, y: 79, kind: "region" },
    ],
  },
  {
    id: "sword-coast",
    name: "The Sword Coast",
    scope: "Region",
    description: "The storm-lashed coast and trade roads surrounding the City of Splendors.",
    image: "/world-atlas/sword-coast-v1.webp",
    nextFocus: { x: 39, y: 59 },
    markers: [
      { name: "Icewind Dale", x: 42, y: 14, kind: "region" },
      { name: "Luskan", x: 30, y: 31, kind: "place" },
      { name: "Neverwinter", x: 34, y: 42, kind: "place" },
      { name: "Neverwinter Wood", x: 49, y: 38, kind: "region" },
      { name: "High Forest", x: 68, y: 47, kind: "region" },
      { name: "Sword Mountains", x: 51, y: 54, kind: "region" },
      { name: "Waterdeep", detail: "Open city map", x: 39, y: 59, kind: "destination", destination: 2 },
      { name: "Daggerford", x: 42, y: 73, kind: "place" },
    ],
  },
  {
    id: "waterdeep",
    name: "Waterdeep",
    scope: "City",
    description: "The City of Splendors: wards, harbor, roads, and the shadow of Mount Waterdeep.",
    image: "/world-atlas/waterdeep-v1.webp",
    markers: [
      { name: "Field Ward", x: 70, y: 13, kind: "region" },
      { name: "Sea Ward", x: 46, y: 25, kind: "region" },
      { name: "North Ward", x: 67, y: 30, kind: "region" },
      { name: "Castle Ward", x: 51, y: 51, kind: "region" },
      { name: "City of the Dead", x: 68, y: 50, kind: "region" },
      { name: "Trades Ward", x: 56, y: 64, kind: "region" },
      { name: "Dock Ward", x: 40, y: 69, kind: "region" },
      { name: "Southern Ward", x: 66, y: 80, kind: "region" },
      { name: "Mount Waterdeep", x: 28, y: 38, kind: "place" },
      { name: "Deepwater Harbor", x: 25, y: 65, kind: "place" },
    ],
  },
];

const MIN_SCALE = 0.7;
const MAX_SCALE = 5.5;
const SEMANTIC_ZOOM_SCALE = 3.45;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function DistanceIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17 8.5 7l3 5 2.6-4L21 17H3Z" /><path d="M8.5 7 11 3l3.2 5" /></svg>;
}

function CompassIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="m15.3 8.7-2 4.6-4.6 2 2-4.6 4.6-2Z" /></svg>;
}

function ZoomIcon({ direction }: { direction: "in" | "out" }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5M7.5 10.5h6" />{direction === "in" ? <path d="M10.5 7.5v6" /> : null}</svg>;
}

function focusDistance(focus: Point, target: Point) {
  return Math.hypot(focus.x - target.x, focus.y - target.y);
}

export function WorldAtlas() {
  const [levelIndex, setLevelIndex] = useState(0);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [selectedMarker, setSelectedMarker] = useState<string | null>("Sword Coast");
  const [transitionLabel, setTransitionLabel] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; origin: Point; start: Point } | null>(null);
  const level = LEVELS[levelIndex];

  const resetView = useCallback(() => {
    setView({ scale: 1, x: 0, y: 0 });
  }, []);

  const switchLevel = useCallback((nextIndex: number, markerName?: string) => {
    const next = LEVELS[nextIndex];
    if (!next) return;
    setTransitionLabel(next.name);
    setLevelIndex(nextIndex);
    setSelectedMarker(markerName ?? next.markers.find((marker) => marker.destination)?.name ?? next.name);
    setView({ scale: 1, x: 0, y: 0 });
    window.setTimeout(() => setTransitionLabel(null), 900);
  }, []);

  const zoomAt = useCallback((nextScale: number, clientX?: number, clientY?: number) => {
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage) return;
    setView((current) => {
      const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
      const px = clientX ?? stage.left + stage.width / 2;
      const py = clientY ?? stage.top + stage.height / 2;
      const localX = px - stage.left - stage.width / 2;
      const localY = py - stage.top - stage.height / 2;
      const ratio = scale / current.scale;
      return {
        scale,
        x: localX - (localX - current.x) * ratio,
        y: localY - (localY - current.y) * ratio,
      };
    });
  }, []);

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const multiplier = event.ctrlKey ? 0.008 : 0.0022;
    const nextScale = view.scale * Math.exp(-event.deltaY * multiplier);

    if (levelIndex > 0 && nextScale < 0.76) {
      switchLevel(levelIndex - 1);
      return;
    }

    const stage = stageRef.current?.getBoundingClientRect();
    const focus = stage && stage.width && stage.height ? {
      x: clamp(50 - (view.x / (stage.width * view.scale)) * 100, 0, 100),
      y: clamp(50 - (view.y / (stage.height * view.scale)) * 100, 0, 100),
    } : { x: 50, y: 50 };
    const target = level.nextFocus;
    if (target && nextScale >= SEMANTIC_ZOOM_SCALE && focusDistance(focus, target) < 24) {
      switchLevel(levelIndex + 1);
      return;
    }
    zoomAt(nextScale, event.clientX, event.clientY);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      origin: { x: view.x, y: view.y },
      start: { x: event.clientX, y: event.clientY },
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setView((current) => ({
      ...current,
      x: drag.origin.x + event.clientX - drag.start.x,
      y: drag.origin.y + event.clientY - drag.start.y,
    }));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const preventPageZoom = (event: WheelEvent) => event.preventDefault();
    element.addEventListener("wheel", preventPageZoom, { passive: false });
    return () => element.removeEventListener("wheel", preventPageZoom);
  }, []);

  return (
    <main className={styles.atlasShell}>
      <header className={styles.header}>
        <Link className={styles.backLink} href="/" aria-label="Return to campaign landing page">← <span>Campaign</span></Link>
        <div className={styles.titleBlock}>
          <span>Campaign atlas</span>
          <strong>{level.name}</strong>
        </div>
        <div className={styles.headerMeta}><span>{Math.round(view.scale * 100)}%</span><span>{levelIndex + 1} / {LEVELS.length}</span></div>
      </header>

      <aside className={styles.navigator} aria-label="Atlas levels">
        <div className={styles.navigatorHeading}><CompassIcon /><div><span>Where are we?</span><strong>Waterdeep, Sword Coast</strong></div></div>
        <nav>
          {LEVELS.map((item, index) => (
            <button key={item.id} type="button" className={index === levelIndex ? styles.activeLevel : undefined} onClick={() => switchLevel(index)}>
              <span className={styles.levelNumber}>0{index + 1}</span>
              <span><small>{item.scope}</small><strong>{item.name}</strong></span>
              <span aria-hidden="true">{index === levelIndex ? "●" : "→"}</span>
            </button>
          ))}
        </nav>
        <div className={styles.navigatorNote}><DistanceIcon /><p>This is a layered atlas. Zoom toward a highlighted place to cross into its more detailed map.</p></div>
      </aside>

      <section className={styles.mapWorkspace} aria-label={`${level.name} map`}>
        <div className={styles.mapHeading}>
          <div><span>{level.scope}</span><h1>{level.name}</h1></div>
          <p>{level.description}</p>
        </div>
        <div
          ref={stageRef}
          className={styles.mapStage}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={(event) => zoomAt(view.scale * 1.65, event.clientX, event.clientY)}
        >
          <div className={styles.mapBackdrop} />
          <div className={styles.mapLayer} role="img" aria-label={`Original illustrated map of ${level.name}`} style={{ backgroundImage: `url(${level.image})`, transform: `translate(-50%, -50%) translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` }}>
            <div className={styles.mapVignette} />
            {level.markers.map((marker) => (
              <button
                type="button"
                key={marker.name}
                className={`${styles.marker} ${styles[marker.kind ?? "place"]} ${selectedMarker === marker.name ? styles.selectedMarker : ""}`}
                style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                  setSelectedMarker(marker.name);
                  if (marker.destination !== undefined) switchLevel(marker.destination, marker.name);
                }}
                aria-label={marker.destination !== undefined ? `Open detailed map of ${marker.name}` : marker.name}
              >
                <span className={styles.markerDot} />
                <span className={styles.markerLabel}><strong>{marker.name}</strong>{marker.detail ? <small>{marker.detail}</small> : null}</span>
              </button>
            ))}
          </div>
          <div className={styles.controls} aria-label="Map zoom controls">
            <button type="button" onClick={() => zoomAt(view.scale / 1.35)} aria-label="Zoom out"><ZoomIcon direction="out" /></button>
            <button type="button" onClick={resetView}>Fit</button>
            <button type="button" onClick={() => zoomAt(view.scale * 1.35)} aria-label="Zoom in"><ZoomIcon direction="in" /></button>
          </div>
          <div className={styles.hint}>Drag to roam · Scroll or pinch to zoom · Double-click to dive in</div>
          {transitionLabel ? <div className={styles.transitionNotice}><span>Entering</span><strong>{transitionLabel}</strong></div> : null}
        </div>
      </section>
    </main>
  );
}
