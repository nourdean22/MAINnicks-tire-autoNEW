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
import { apiFetch } from "@/lib/utils/api-fetch";

interface PipelineStatus {
  totalClaims: number | null;
  statusCounts: Array<{ status: string; count: number }> | null;
  bestVerificationScore: number | null;
  /**
   * `null` when the status groupBy REJECTED — nobody read the count, so there
   * is no number to print. It was typed `number` and the route returned a
   * `?? 0` fallback, which is how a failed read rendered as "0 promotable now".
   */
  promotableNow: number | null;
  candidateRows: number | null;
  thresholds: { strong: number; weak: number };
  gateUnreachable: boolean;
  gateMeaning: string;
  degraded: string[];
}

/**
 * The NON-ALARM branch. Named "quiet", not "healthy", because that is all this
 * branch actually knows.
 *
 * `gateUnreachable` is false in two very different worlds, and the route says
 * so out loud (see its comment at the `gateUnreachable` guard): the gate is
 * genuinely reachable, OR one of the four reads REJECTED and the route
 * correctly refused to assert the alarm from missing data. The route's refusal
 * was right; treating it as a clean bill of health was the defect. So this
 * branch has to be able to say "unread" and has to carry the `degraded` list
 * that used to render only inside the alarm card — the one path a rejected
 * read can never reach.
 *
 * Exported so the canary renders all three shapes directly: the effect that
 * populates `status` never runs under renderToStaticMarkup.
 */
export function PipelineQuietLine({ status }: { status: PipelineStatus }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-mono text-(--text-tertiary)">
        {status.totalClaims ?? "?"} claims ingested ·{" "}
        {status.promotableNow === null
          ? "promotable now: unread"
          : `${status.promotableNow} promotable now`}
      </p>
      {status.degraded.length > 0 && (
        <p className="text-[11px] font-mono text-amber-400/80">
          degraded reads: {status.degraded.join(", ")}
        </p>
      )}
    </div>
  );
}

export function ResearchPipelineStatus() {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    (async () => {
      try {
        setStatus(await apiFetch<PipelineStatus>("/api/knowledge/pipeline-status", {
          cache: "no-store",
          signal: controller.signal,
        }));
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
      <div className="flex items-center gap-2 text-[11px] font-mono text-(--text-tertiary)">
        <Loader2 size={11} className="animate-spin" />
        reading pipeline status…
      </div>
    );
  }

  // A failed read is unknown, never "healthy".
  if (state === "error" || !status) {
    return (
      <p className="text-[11px] font-mono text-amber-400">
        pipeline status unavailable — unknown, not zero
      </p>
    );
  }

  if (!status.gateUnreachable) {
    return <PipelineQuietLine status={status} />;
  }

  return (
    <GlassCard className="border-amber-500/30 bg-amber-500/[0.06] space-y-2">
      <div className="flex items-center gap-2">
        <AlertTriangle size={13} className="text-amber-400 shrink-0" />
        <h3 className="text-[11px] font-mono font-bold text-amber-300">
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
              className="px-1.5 py-0.5 rounded-micro border border-(--border-default) bg-content text-[11px] font-mono text-(--text-tertiary)"
            >
              {s.status.replaceAll("_", " ")} · {s.count}
            </span>
          ))}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-(--text-tertiary)">
        {status.gateMeaning}
      </p>

      <p className="text-[11px] leading-relaxed text-(--text-tertiary) border-t border-amber-500/15 pt-2">
        Your call, not the system&apos;s: lower the gate, ground claims against
        something other than our own memory, or retire the lane. Until one of
        those happens this surface stays empty by construction — which is why
        it now says so instead of looking merely quiet.
      </p>

      {status.degraded.length > 0 && (
        <p className="text-[11px] font-mono text-amber-400/80">
          degraded reads: {status.degraded.join(", ")}
        </p>
      )}
    </GlassCard>
  );
}
