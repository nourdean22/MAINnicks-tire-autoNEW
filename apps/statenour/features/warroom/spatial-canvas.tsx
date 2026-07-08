"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWarRoomStore } from "./store";
import { useWarRoomLayout } from "./layout-store";
import { WIDGET_REGISTRY } from "./manifest";
import { WidgetWindow } from "./widget-window";
import { MissionsTile } from "./tiles/missions-tile";
import { SystemPulseTile } from "./tiles/system-pulse-tile";
import { LivePulseTile } from "./tiles/live-pulse-tile";

/**
 * War-Room · SpatialCanvas.
 *
 * Desktop-only pannable/zoomable canvas. Slice 1 proved the shell
 * (transform-only pan/zoom, keyboard, desktop guard). Slice 2 hosts a
 * widget runtime: windows are rendered from WIDGET_REGISTRY, positioned
 * by the persisted layout store, and draggable by their title bars.
 * Real tile data lands in Slice 3, the task→mission drop in Slice 4.
 */

const WORLD_GRID = {
  backgroundImage:
    "linear-gradient(rgba(255,255,255,0.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.045) 1px,transparent 1px)",
  backgroundSize: "48px 48px",
} as const;

export function SpatialCanvas() {
  const { panX, panY, zoom, panBy, setPan, zoomAt, reset } = useWarRoomStore();
  const resetLayout = useWarRoomLayout((s) => s.resetLayout);
  const stageRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);

  // Rehydrate the persisted window layout on the client only (the store
  // uses skipHydration to keep SSR + first render on defaults).
  useEffect(() => {
    void useWarRoomLayout.persist.rehydrate();
  }, []);

  // Desktop-only guard. The canvas paradigm is desktop-primary; the phone
  // keeps its existing list UI (design non-goal: no drag/canvas on phone).
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 820px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const centerZoom = useCallback(
    (factor: number) => {
      const r = stageRef.current?.getBoundingClientRect();
      if (!r) return;
      zoomAt(factor, r.width / 2, r.height / 2);
    },
    [zoomAt],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Windows handle their own drag (data-tile); empty space pans.
      if ((e.target as HTMLElement).closest("[data-tile]")) return;
      panRef.current = { x: e.clientX, y: e.clientY, px: panX, py: panY };
      setPanning(true);
      stageRef.current?.setPointerCapture(e.pointerId);
    },
    [panX, panY],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const p = panRef.current;
      if (!p) return;
      setPan(p.px + (e.clientX - p.x), p.py + (e.clientY - p.y));
    },
    [setPan],
  );

  const endPan = useCallback((e: React.PointerEvent) => {
    panRef.current = null;
    setPanning(false);
    try {
      stageRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const r = stageRef.current?.getBoundingClientRect();
      if (!r) return;
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
    },
    [zoomAt],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = 48;
      if (e.key === "ArrowLeft") panBy(step, 0);
      else if (e.key === "ArrowRight") panBy(-step, 0);
      else if (e.key === "ArrowUp") panBy(0, step);
      else if (e.key === "ArrowDown") panBy(0, -step);
      else if (e.key === "+" || e.key === "=") centerZoom(1.15);
      else if (e.key === "-") centerZoom(1 / 1.15);
      else return;
      e.preventDefault();
    },
    [panBy, centerZoom],
  );

  if (!isDesktop) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">war-room</p>
        <h1 className="mt-2 text-xl font-medium text-[var(--text-primary)]">Desktop-only surface</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          The spatial canvas is built for a large screen. On your phone, use the existing list views — Missions, Stats,
          Journal — from the bottom nav.
        </p>
      </div>
    );
  }

  const btn =
    "rounded-md border border-white/15 bg-white/[0.03] px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-primary)] transition hover:bg-white/[0.07] active:scale-95";

  return (
    <section aria-label="war-room spatial canvas" className="px-2">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className="h-2 w-2 rounded-full bg-[var(--gold)]"
            style={{ boxShadow: "0 0 10px 1px rgba(231,197,106,0.35)" }}
          />
          <span className="text-sm font-medium text-[var(--text-primary)]">War-Room</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
            slice 3 · real data
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => centerZoom(1 / 1.15)} aria-label="zoom out" className={btn}>
            −
          </button>
          <button type="button" onClick={() => centerZoom(1.15)} aria-label="zoom in" className={btn}>
            +
          </button>
          <button type="button" onClick={reset} className={btn}>
            reset view
          </button>
          <button type="button" onClick={resetLayout} className={btn}>
            reset tiles
          </button>
          <span className="ml-1 font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
            {zoom.toFixed(2)}×
          </span>
        </div>
      </header>

      <div
        ref={stageRef}
        tabIndex={0}
        role="application"
        aria-label="pannable zoomable canvas — drag to pan, scroll to zoom, arrow keys pan, plus and minus zoom"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        className="relative h-[calc(100dvh-190px)] min-h-[420px] w-full touch-none overflow-hidden rounded-xl border border-[var(--glass-border)] bg-[rgba(9,10,13,0.6)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
        style={{ cursor: panning ? "grabbing" : "grab" }}
      >
        <div
          className="absolute left-0 top-0 h-[1600px] w-[2400px] origin-top-left will-change-transform"
          style={{ ...WORLD_GRID, transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }}
        >
          {WIDGET_REGISTRY.map((m) => (
            <WidgetWindow key={m.id} id={m.id} title={m.title} icon={m.icon} note={m.note}>
              {m.id === "missions" ? <MissionsTile /> : m.id === "pulse" ? <SystemPulseTile /> : m.id === "livepulse" ? <LivePulseTile /> : undefined}
            </WidgetWindow>
          ))}
        </div>

        <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-0.5 rounded-lg border border-[var(--glass-border)] bg-black/60 px-3 py-2 font-mono text-[10.5px] leading-relaxed tabular-nums text-[var(--text-secondary)] backdrop-blur">
          <span>
            zoom <b className="font-medium text-[var(--text-primary)]">{zoom.toFixed(2)}×</b> · pan{" "}
            <b className="font-medium text-[var(--text-primary)]">
              {Math.round(panX)}, {Math.round(panY)}
            </b>
          </span>
          <span className="text-[var(--text-tertiary)]">drag empty space · scroll to zoom · drag a title bar to move a window</span>
        </div>
      </div>
    </section>
  );
}
