"use client";

/**
 * TIME GHOST — a tiny horizontal visual of today's shape.
 *
 * 34 half-hour pips from 6am → 11pm. Each pip:
 *   • 🟢 emerald = task DONE in this window
 *   • 🟡 gold    = task ACTIVE (DOING) in this window
 *   • 🔵 blue    = brain dump / capture hit
 *   • 🔴 red     = task SKIPPED
 *   • ▫ dim    = idle
 *   • ▪ dark   = future (not yet lived)
 *
 * Data source: /api/ultron/time-ghost (cached 120s). Polls every 2min.
 * Hover a pip → tooltip with time + count.
 *
 * Drops into the TodoDesk header strip as a 34-pip row, replacing the
 * old 7-day weekly heatmap which showed progress but not today's
 * shape. Pairs well with the momentum "done today" counter next door.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

import { authedFetch } from "@/hooks/use-authed-fetch";
type CellKind = "done" | "started" | "skipped" | "capture" | "active" | "idle" | "future";

interface Cell {
  bucket: number;
  time: string;
  kind: CellKind;
  count: number;
}

interface GhostPayload {
  date: string;
  cells: Cell[];
  firstActivityBucket: number | null;
  lastActivityBucket: number | null;
}

const CELL_COLORS: Record<CellKind, string> = {
  done:    "bg-emerald-400",
  active:  "bg-[var(--gold)]",
  started: "bg-[var(--gold)]/70",
  capture: "bg-blue-400/70",
  skipped: "bg-red-400/60",
  idle:    "bg-[var(--bg-void)] border border-[var(--border-default)]/60",
  future:  "bg-[var(--bg-void)]/40",
};

const CELL_TITLES: Record<CellKind, string> = {
  done:    "task completed",
  active:  "task active",
  started: "task started",
  capture: "brain dump / capture",
  skipped: "task skipped",
  idle:    "idle",
  future:  "future",
};

export function TimeGhost({ className }: { className?: string }) {
  const [data, setData] = useState<GhostPayload | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await authedFetch("/api/ultron/time-ghost");
        if (!res.ok) return;
        const raw = (await res.json()) as { data?: GhostPayload };
        if (!alive) return;
        if (raw?.data) setData(raw.data);
      } catch {
        // silent — ambient
      }
    };
    load();
    const iv = setInterval(load, 120_000); // 2 min
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  if (!data || data.cells.length === 0) return null;

  return (
    <div
      className={cn("flex items-center gap-[1px]", className)}
      title="today's shape · 6am → 11pm in 30-min pips"
      aria-label="time ghost — today's shape in 30-minute buckets"
    >
      {data.cells.map((c) => (
        <span
          key={c.bucket}
          className={cn("w-[3px] h-2.5 rounded-[1px] transition-all", CELL_COLORS[c.kind])}
          title={`${c.time} — ${CELL_TITLES[c.kind]}${c.count > 1 ? ` ×${c.count}` : ""}`}
        />
      ))}
    </div>
  );
}
