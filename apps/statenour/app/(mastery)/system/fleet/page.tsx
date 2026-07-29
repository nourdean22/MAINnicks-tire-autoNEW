"use client";

/**
 * /system/fleet — the one-screen cross-app liveness answer (W1).
 *
 * Renders /api/system/fleet-truth: statenour capability artifacts
 * (spine-7 probes) + nickstire health/db/schema-guard/self-healing in
 * the shared vocabulary. Honest states everywhere: loading is a
 * skeleton, failure renders as FAILURE, unknown is never painted green.
 */

import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/panel";
import { PageHeader } from "@/components/layout/ui";
import { trpc } from "@/lib/trpc/client";

interface Artifact {
  capability: string;
  state: "fresh" | "stale" | "never_produced" | "unknown";
  ageH: number | null;
}
interface QueueHealth {
  pending: number;
  processing: number;
  dead: number;
  oldestDeadAt: string | null;
}
interface FleetTruth {
  generatedAt: string;
  statenour: Artifact[];
  nickstire: Artifact[];
  queues?: {
    postTurnOutbox: QueueHealth | null;
    brainBus: QueueHealth | null;
  };
  allFresh: boolean;
  queuesClean?: boolean;
}

const STATE_STYLE: Record<Artifact["state"], { dot: string; label: string }> = {
  fresh: { dot: "bg-emerald-400", label: "fresh" },
  stale: { dot: "bg-amber-400", label: "STALE" },
  never_produced: { dot: "bg-red-400", label: "NEVER PRODUCED" },
  unknown: { dot: "bg-zinc-500", label: "unknown" },
};

/** WP-8 · row-state health for one durable queue. `dead > 0` is an
 *  attention state even when the drain's liveness probe is fresh. */
function QueueRow({
  name,
  q,
  onRedrive,
  redriving,
}: {
  name: string;
  q: QueueHealth | null;
  onRedrive?: () => void;
  redriving?: boolean;
}) {
  // Two-tap in-DOM confirm — window.confirm is suppressed in the iOS PWA.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  if (!q) {
    return (
      <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
        <span className="text-[13px] text-fg-secondary font-mono">{name}</span>
        <span className="text-[12px] text-zinc-400">unknown — probe failed, NOT healthy</span>
      </div>
    );
  }
  const deadAgeH =
    q.oldestDeadAt != null
      ? Math.round(((Date.now() - new Date(q.oldestDeadAt).getTime()) / 3_600_000) * 10) / 10
      : null;
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
      <span className="text-[13px] text-fg-secondary font-mono">{name}</span>
      <span className="flex items-center gap-3 text-[12px] tabular-nums">
        <span className="text-fg-secondary/60">{q.pending} pending</span>
        <span className="text-fg-secondary/60">{q.processing} processing</span>
        {q.dead > 0 ? (
          <>
            <span className="flex items-center gap-1.5 text-red-300">
              <span className="h-2 w-2 rounded-full bg-red-400" />
              {q.dead} DEAD{deadAgeH != null ? ` · oldest ${deadAgeH}h` : ""}
            </span>
            {onRedrive && (
              <button
                onClick={() => {
                  if (!armed) {
                    setArmed(true);
                    return;
                  }
                  setArmed(false);
                  onRedrive();
                }}
                disabled={redriving}
                className={`rounded px-2 py-0.5 text-[11px] border ${
                  armed
                    ? "border-red-400 text-red-300"
                    : "border-white/15 text-fg-secondary"
                } disabled:opacity-50`}
              >
                {redriving ? "redriving…" : armed ? `tap again — redrive ${q.dead}` : "redrive"}
              </button>
            )}
          </>
        ) : (
          <span className="flex items-center gap-1.5 text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            clean
          </span>
        )}
      </span>
    </div>
  );
}

function ArtifactRow({ a }: { a: Artifact }) {
  const s = STATE_STYLE[a.state];
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
      <span className="text-[13px] text-fg-secondary font-mono">{a.capability}</span>
      <span className="flex items-center gap-2 text-[12px]">
        {a.ageH != null && <span className="text-fg-secondary/60 tabular-nums">{a.ageH}h</span>}
        <span className={`h-2 w-2 rounded-full ${s.dot}`} />
        <span className={a.state === "fresh" ? "text-emerald-300" : a.state === "unknown" ? "text-zinc-400" : "text-amber-300"}>
          {s.label}
        </span>
      </span>
    </div>
  );
}

export default function FleetPage() {
  const [truth, setTruth] = useState<FleetTruth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const redrive = trpc.system.outboxRedrive.useMutation();
  const delivery = trpc.system.deliveryStats.useQuery({ windowDays: 7 });
  // Derived, not state: no sync setState inside the load effect
  // (react-compiler cascading-render rule), and one less thing to lie.
  const loading = truth === null && error === null;

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/system/fleet-truth", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTruth((await res.json()) as FleetTruth);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    // Deferred a tick — the compiler can't prove load() defers its
    // setState past the await, so give it the guarantee structurally.
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="px-4 pb-[var(--bottom-chrome-h)] max-w-2xl mx-auto space-y-4">
      <PageHeader
        eyebrow="SYSTEM"
        title="Fleet Truth"
        description="Capability artifacts across both apps — produced, not just invoked"
      />

      {loading && (
        <Panel>
          <div className="h-4 w-48 rounded bg-white/5 animate-pulse" />
        </Panel>
      )}

      {!loading && error && (
        <Panel>
          <p className="text-[13px] text-red-400">
            Fleet truth couldn&apos;t load ({error}) — state UNKNOWN, not healthy.
          </p>
          <button onClick={() => void load()} className="mt-2 text-[12px] text-fg-secondary underline">
            retry
          </button>
        </Panel>
      )}

      {!loading && truth && (
        <>
          <Panel>
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold">
                {truth.allFresh && truth.queuesClean !== false
                  ? "All probed capabilities fresh · queues clean"
                  : "Attention needed"}
              </span>
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  truth.allFresh && truth.queuesClean !== false ? "bg-emerald-400" : "bg-amber-400"
                }`}
              />
            </div>
            <p className="text-[11px] text-fg-secondary/60 mt-1">
              as of {new Date(truth.generatedAt).toLocaleTimeString()} · unknown counts as NOT ok
            </p>
          </Panel>

          {truth.queues && (
            <Panel>
              <p className="text-[11px] uppercase tracking-[0.16em] text-fg-secondary/70 mb-1">
                durable queues — rows, not just drains
              </p>
              <QueueRow
                name="post-turn-outbox"
                q={truth.queues.postTurnOutbox}
                redriving={redrive.isPending}
                onRedrive={() =>
                  redrive.mutate(undefined, {
                    onSettled: () => void load(),
                  })
                }
              />
              <QueueRow name="brain-bus" q={truth.queues.brainBus} />
              {redrive.isError && (
                <p className="mt-1 text-[12px] text-red-400">
                  redrive failed: {redrive.error.message}
                </p>
              )}
              {redrive.isSuccess && (
                <p className="mt-1 text-[12px] text-emerald-300">
                  redriven {redrive.data.redriven} row(s) — the 15-min drain replays them
                </p>
              )}
            </Panel>
          )}

          <Panel>
            <p className="text-[11px] uppercase tracking-[0.16em] text-fg-secondary/70 mb-1">
              delivery — shown vs acknowledged (7d)
            </p>
            {delivery.isLoading ? (
              <div className="h-4 w-40 rounded bg-white/5 animate-pulse" />
            ) : delivery.isError || !delivery.data?.stats ? (
              <p className="text-[12px] text-zinc-400">
                ledger unreadable — state UNKNOWN, not healthy
              </p>
            ) : (
              <>
                <div className="flex items-center gap-4 text-[12px] tabular-nums py-1">
                  <span className="text-fg-secondary/70">{delivery.data.stats.shown} shown</span>
                  <span className="text-fg-secondary/70">{delivery.data.stats.decided} decided</span>
                  <span className="text-emerald-300">{delivery.data.stats.accepted} accepted</span>
                  <span className="text-amber-300">{delivery.data.stats.dismissed} dismissed</span>
                  <span className="text-zinc-400">{delivery.data.stats.undecided} undecided</span>
                </div>
                <p className="text-[10px] text-fg-secondary/50 mt-0.5">
                  producers writing rows:{" "}
                  {delivery.data.producers.length === 0
                    ? "NONE — computed intelligence is not reaching the ledger"
                    : delivery.data.producers
                        .map((p) => `${p.sourceEngine} (${p.rows})`)
                        .join(" · ")}
                </p>
              </>
            )}
          </Panel>

          <Panel>
            <p className="text-[11px] uppercase tracking-[0.16em] text-fg-secondary/70 mb-1">statenour</p>
            {truth.statenour.map((a) => (
              <ArtifactRow key={a.capability} a={a} />
            ))}
          </Panel>

          <Panel>
            <p className="text-[11px] uppercase tracking-[0.16em] text-fg-secondary/70 mb-1">nickstire</p>
            {truth.nickstire.map((a) => (
              <ArtifactRow key={a.capability} a={a} />
            ))}
          </Panel>
        </>
      )}
    </div>
  );
}
