"use client";

import { useCallback, useRef, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { useWarRoomLayout } from "./layout-store";
import { useWarRoomStore } from "./store";

/**
 * War-Room · Slice 2 · WidgetWindow.
 *
 * A draggable glass window on the canvas. The title bar is the drag
 * handle — repositioning converts the screen-space pointer delta to
 * world space by dividing by the current zoom (`worldΔ = screenΔ /
 * zoom`). This is NOT the drop-target hit-testing that Slice 4 needs;
 * it only moves the window's own rect. Content is wrapped in the shared
 * ErrorBoundary so one broken widget can't white-screen the desktop.
 */
export function WidgetWindow({
  id,
  title,
  icon: Icon,
  note,
  children,
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  note: string;
  children?: ReactNode;
}) {
  const rect = useWarRoomLayout((s) => s.windows[id]);
  const moveWindow = useWarRoomLayout((s) => s.moveWindow);
  const bringToFront = useWarRoomLayout((s) => s.bringToFront);
  const zoom = useWarRoomStore((s) => s.zoom);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!rect) return;
      e.stopPropagation(); // never pan the canvas while moving a window
      bringToFront(id);
      drag.current = { x: e.clientX, y: e.clientY, ox: rect.x, oy: rect.y };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [id, rect, bringToFront],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      moveWindow(id, d.ox + (e.clientX - d.x) / zoom, d.oy + (e.clientY - d.y) / zoom);
    },
    [id, zoom, moveWindow],
  );

  const endDrag = useCallback((e: React.PointerEvent) => {
    drag.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  }, []);

  if (!rect) return null;

  return (
    <div
      data-tile={id}
      className="neural-glass flex flex-col overflow-hidden rounded-xl"
      style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: rect.z }}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ touchAction: "none" }}
        className="flex select-none items-center gap-2 border-b border-[var(--glass-border)] px-3 py-2 cursor-grab active:cursor-grabbing"
      >
        <Icon size={13} className="text-[var(--text-tertiary)]" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--text-primary)]">{title}</span>
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">{note}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <ErrorBoundary name={`warroom.${id}`}>
          {children ?? (
            <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-white/10">
              <span className="text-[11px] text-[var(--text-tertiary)]">placeholder — wraps real data in a later slice</span>
            </div>
          )}
        </ErrorBoundary>
      </div>
    </div>
  );
}
