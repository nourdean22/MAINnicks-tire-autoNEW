"use client";

/**
 * Research-pipeline status · 2026-08-19 (Brain wave 2).
 *
 * The Review tab used to render an empty list when there was nothing to
 * rule on — which read as "all caught up" when the truth (measured in
 * prod) was "this queue is structurally incapable of filling": 893 claims
 * ingested, best verification score 0.58, promotion gate 0.75, zero
 * candidates ever produced.
 *
 * An empty queue and a dead queue must never look the same. This panel is
 * the difference.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";

interface PipelineStatus {
  totalClaims: number | null;
  statusCounts: Array<{ status: string; count: number }> | null;
  bestVerificationScore: number | null;
  promotableNow: number;
  candidateRows: number | null;
  thresholds: { strong: number; weak: number };
  gateUnreachable: boolean;
  gateMeaning: string;
  degraded: string[];
}

function unwrap<T>(payload: unknown): T {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

export function ResearchPipelineStatus() {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    (async () => {
      try {
        const res = await fetch("/api/knowledge/pipeline-status", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        setStatus(unwrap<PipelineStatus>(await res.json()));
        setState("ready");
      } catch {
        setState("error");
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => controller.abort();
  }, []);

  if (state === "loading") {
    return (
      <div className="flex items-center gap-2 text-[10px] font-mono text-(--text-tertiary)">
        <Loader2 size={11} className="animate-spin" />
        reading pipeline status…
      </div>
    );
  }

  // A failed read is unknown, never "healthy".
  if (state === "error" || !status) {
    return (
      <p className="text-[10px] font-mono text-amber-400">
        pipeline status unavailable — unknown, not zero
      </p>
    );
  }

  if (!status.gateUnreachable) {
    // Healthy (or genuinely empty) — one honest line, no alarm.
    return (
      <p className="text-[10px] font-mono text-(--text-tertiary)">
        {status.totalClaims ?? "?"} claims ingested ·{" "}
        {status.promotableNow} promotable now
      </p>
    );
  }

  return (
    <GlassCard className="border-amber-500/30 bg-amber-500/[0.06] p-3 space-y-2">
      <div className="flex items-center gap-2">
        <AlertTriangle size={13} className="text-amber-400 shrink-0" />
        <h3 className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-amber-300">
          this queue cannot fill
        </h3>
      </div>

      <p className="text-[11px] leading-relaxed text-(--text-secondary)">
        <span className="font-bold text-(--text-primary)">
          {status.totalClaims} claims
        </span>{" "}
        have been ingested and{" "}
        <span className="font-bold text-(--text-primary)">none has ever been promotable</span>.
        The best verification score in the whole corpus is{" "}
        <span className="font-mono text-amber-300">
          {status.bestVerificationScore?.toFixed(2) ?? "?"}
        </span>{" "}
        against a promotion gate of{" "}
        <span className="font-mono text-amber-300">
          {status.thresholds.strong.toFixed(2)}
        </span>
        .
      </p>

      {status.statusCounts && status.statusCounts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {status.statusCounts.map((s) => (
            <span
              key={s.status}
              className="px-1.5 py-0.5 rounded border border-(--border-default) bg-black/30 text-[9px] font-mono text-(--text-tertiary)"
            >
              {s.status.replaceAll("_", " ")} · {s.count}
            </span>
          ))}
        </div>
      )}

      <p className="text-[10px] leading-relaxed text-(--text-tertiary)">
        {status.gateMeaning}
      </p>

      <p className="text-[10px] leading-relaxed text-(--text-tertiary) border-t border-amber-500/15 pt-2">
        Your call, not the system&apos;s: lower the gate, ground claims against
        something other than our own memory, or retire the lane. Until one of
        those happens this surface stays empty by construction — which is why
        it now says so instead of looking merely quiet.
      </p>

      {status.degraded.length > 0 && (
        <p className="text-[9px] font-mono text-amber-400/80">
          degraded reads: {status.degraded.join(", ")}
        </p>
      )}
    </GlassCard>
  );
}
