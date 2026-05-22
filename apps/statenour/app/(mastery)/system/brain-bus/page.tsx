"use client";

/**
 * /system/brain-bus · v10.0.21 · Apr 30.
 *
 * Live tail of the durable brain-bus events table. Polls every 3s
 * with cursor-based incremental fetch — once seeded, only new events
 * arrive (cheap on the DB).
 *
 * Why polling instead of SSE: Vercel serverless lambdas time out at
 * 30s/60s/300s depending on plan; long-lived SSE connections don't
 * fit cleanly. 3s polling with `sinceId` cursor gives near-real-time
 * feel without holding lambda capacity.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { StandardPage } from "@/components/layout/standard-page";
import { Panel } from "@/components/panel";
import { FreshnessChip } from "@/components/ui/freshness-chip";
// Phase B.7a (2026-05-22) · REST→tRPC system-pages slice · the
// authedFetch tail read is now an imperative
// `utils.system.brainBusEvents.fetch()`. This page owns its own 3s
// cursor loop + visibility-pause + append buffer — that bespoke logic
// is preserved verbatim; only the transport swaps to a typed tRPC
// fetch (the roadmap's lazy/imperative-read pattern).
import { trpc } from "@/lib/trpc/client";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  PauseCircle,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TailEvent {
  id: string;
  topic: string;
  eventType: string;
  status: string;
  attempts: number;
  payloadPreview: string | null;
  lastError: string | null;
  createdAt: string;
  processedAt: string | null;
  availableAt: string;
}

interface Payload {
  generatedAt: string;
  cursor: string | null;
  windowCounts: {
    pending: number;
    processing: number;
    done: number;
    failed: number;
    dead: number;
  };
  events: TailEvent[];
}

const MAX_BUFFER = 200;
const POLL_MS = 3000;

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 1000) return "just now";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function statusIcon(status: string) {
  if (status === "done")
    return <CheckCircle2 size={11} className="text-emerald-300" />;
  if (status === "processing")
    return <Activity size={11} className="text-sky-300" />;
  if (status === "pending")
    return <PauseCircle size={11} className="text-amber-300" />;
  if (status === "failed")
    return <AlertTriangle size={11} className="text-rose-300" />;
  if (status === "dead") return <XCircle size={11} className="text-rose-400" />;
  return <Clock size={11} className="text-zinc-500" />;
}

function statusColor(status: string): string {
  switch (status) {
    case "done":
      return "text-emerald-200 bg-emerald-500/10";
    case "processing":
      return "text-sky-200 bg-sky-500/10";
    case "pending":
      return "text-amber-200 bg-amber-500/10";
    case "failed":
      return "text-rose-200 bg-rose-500/10";
    case "dead":
      return "text-rose-300 bg-rose-500/15";
    default:
      return "text-zinc-300 bg-zinc-500/10";
  }
}

export default function BrainBusPage() {
  const [events, setEvents] = useState<TailEvent[]>([]);
  const [counts, setCounts] = useState<Payload["windowCounts"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const cursorRef = useRef<string | null>(null);
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);

  const utils = trpc.useUtils();

  const fetchOnce = useCallback(
    async (initial = false) => {
      try {
        const p = await utils.system.brainBusEvents.fetch({
          limit: initial ? 50 : 200,
          ...(cursorRef.current ? { sinceId: cursorRef.current } : {}),
        });
        setCounts(p.windowCounts);
        if (p.cursor) cursorRef.current = p.cursor;
        if (p.events.length > 0) {
          setEvents((prev) => {
            // Append on incremental fetch; replace on initial fetch.
            const merged = initial ? p.events : [...prev, ...p.events];
            return merged.slice(-MAX_BUFFER);
          });
        } else if (initial) {
          setEvents([]);
        }
        setLastFetched(new Date());
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [utils],
  );

  useEffect(() => {
    void fetchOnce(true);
    // v10.0.27 — visibility-aware polling. An operator leaving this
    // tab open for 8h would otherwise generate ~9600 requests, each
    // running a findMany + groupBy on BrainBusEvent. document.hidden
    // pauses the loop until the tab is foregrounded again. No
    // catch-up burst — when the tab returns we just resume.
    const id = setInterval(() => {
      if (pausedRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void fetchOnce(false);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [fetchOnce]);

  return (
    <StandardPage
      eyebrow="System · v10.0.21"
      title="Brain-Bus Tail"
      description="Live durable event stream · cursor-based 3s poll · 24h status counts"
      width="2xl"
      rhythm="comfortable"
      actions={
        <FreshnessChip
          lastFetchedAt={lastFetched}
          source="api/system/brain-bus-events"
          onReload={() => void fetchOnce(true)}
        />
      }
    >
      {error && events.length === 0 && (
        <Panel className="border-rose-500/40 bg-rose-500/[0.05]">
          <p className="p-3 text-[12px] text-rose-200">{error}</p>
        </Panel>
      )}

      {loading && events.length === 0 && (
        <Panel>
          <p className="p-6 text-center text-[11px] text-zinc-500">loading…</p>
        </Panel>
      )}

      {/* 24h counts */}
      {counts && (
        <Panel>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <CountCell
              label="pending"
              value={counts.pending}
              color={counts.pending > 0 ? "text-amber-300" : "text-zinc-400"}
            />
            <CountCell
              label="processing"
              value={counts.processing}
              color={counts.processing > 0 ? "text-sky-300" : "text-zinc-400"}
            />
            <CountCell
              label="done 24h"
              value={counts.done}
              color="text-emerald-200"
            />
            <CountCell
              label="failed 24h"
              value={counts.failed}
              color={counts.failed > 0 ? "text-rose-300" : "text-zinc-400"}
            />
            <CountCell
              label="dead-letter"
              value={counts.dead}
              color={counts.dead > 0 ? "text-rose-400" : "text-zinc-400"}
            />
          </div>
        </Panel>
      )}

      {/* Pause toggle */}
      <div className="flex items-center justify-between text-[10px] font-mono">
        <span className="text-zinc-500">
          {paused ? "paused" : "live · 3s poll"} · {events.length} buffered
        </span>
        <button
          onClick={() => {
            const next = !paused;
            pausedRef.current = next;
            setPaused(next);
          }}
          className="rounded border border-zinc-700/50 px-2 py-1 text-zinc-300 hover:bg-zinc-800/40"
        >
          {paused ? "▶ resume" : "⏸ pause"}
        </button>
      </div>

      {/* Event tail */}
      <Panel>
        {events.length === 0 ? (
          <p className="py-8 text-center text-[11px] text-zinc-500">
            No events yet. Producers (publishDurable) write rows that show up
            here. Check{" "}
            <a className="text-zinc-300 underline" href="/system/crons">
              /system/crons
            </a>{" "}
            → brain-bus-backfill for the consumer side.
          </p>
        ) : (
          <div className="divide-y divide-zinc-800/40">
            {events
              .slice()
              .reverse()
              .map((e) => (
                <div key={e.id} className="py-2">
                  <div className="flex items-center gap-2 px-2">
                    {statusIcon(e.status)}
                    <span
                      className={cn(
                        "rounded px-1.5 py-[1px] text-[9px] uppercase tracking-wider",
                        statusColor(e.status),
                      )}
                    >
                      {e.status}
                    </span>
                    <span className="text-[11px] font-mono text-zinc-300">
                      {e.topic}
                    </span>
                    <span className="text-[10px] font-mono text-zinc-500">
                      {e.eventType}
                    </span>
                    {e.attempts > 1 && (
                      <span className="rounded bg-amber-500/10 px-1.5 py-[1px] text-[9px] text-amber-200">
                        attempts: {e.attempts}
                      </span>
                    )}
                    <span className="ml-auto text-[10px] tabular-nums text-zinc-500">
                      {relTime(e.createdAt)}
                    </span>
                  </div>
                  {e.payloadPreview && (
                    <div className="mt-1 px-2 font-mono text-[10px] text-zinc-500">
                      {e.payloadPreview}
                    </div>
                  )}
                  {e.lastError && (
                    <div className="mt-1 px-2 text-[10px] text-rose-300">
                      {e.lastError}
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}
      </Panel>

      <p className="text-center text-[10px] text-zinc-600">
        v10.0.21 · cursor-based incremental tail · see{" "}
        <code>lib/db/brain-bus-tail.ts</code>
      </p>
    </StandardPage>
  );
}

function CountCell({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div className={cn("text-2xl font-bold tabular-nums", color)}>{value}</div>
    </div>
  );
}
