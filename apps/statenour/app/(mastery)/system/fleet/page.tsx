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

interface Artifact {
  capability: string;
  state: "fresh" | "stale" | "never_produced" | "unknown";
  ageH: number | null;
}
interface FleetTruth {
  generatedAt: string;
  statenour: Artifact[];
  nickstire: Artifact[];
  allFresh: boolean;
}

const STATE_STYLE: Record<Artifact["state"], { dot: string; label: string }> = {
  fresh: { dot: "bg-emerald-400", label: "fresh" },
  stale: { dot: "bg-amber-400", label: "STALE" },
  never_produced: { dot: "bg-red-400", label: "NEVER PRODUCED" },
  unknown: { dot: "bg-zinc-500", label: "unknown" },
};

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
                {truth.allFresh ? "All probed capabilities fresh" : "Attention needed"}
              </span>
              <span className={`h-2.5 w-2.5 rounded-full ${truth.allFresh ? "bg-emerald-400" : "bg-amber-400"}`} />
            </div>
            <p className="text-[11px] text-fg-secondary/60 mt-1">
              as of {new Date(truth.generatedAt).toLocaleTimeString()} · unknown counts as NOT ok
            </p>
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
