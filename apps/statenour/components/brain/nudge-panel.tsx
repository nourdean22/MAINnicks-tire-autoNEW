"use client";

/**
 * NudgePanel — cross-system live deltas. Appears at the top of /brain
 * so Nour sees what the self-model is screaming about right now.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { GlassCard } from "@/components/ui/glass-card";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { AlertTriangle, AlertCircle, Info, Loader2 } from "lucide-react";
import { DismissButton } from "@/components/ui/dismiss-button";
// Phase B.6d (2026-05-22) · migrated off `authedFetch("/api/brain/
// nudges")` (read) + `authedFetch("/api/brain/nudges/dismiss")` (POST)
// onto `trpc.brain.nudges` + `trpc.brain.dismissNudge`.
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import { AnimatedCounter } from "@/components/ui/animated-counter";

interface Nudge {
  severity: "high" | "medium" | "low";
  source:
    | "identity"
    | "contradiction"
    | "ghost"
    | "skill"
    | "pin_hygiene"
    | "belief_refresh"
    // v11.1 meta-intelligence
    | "correlation"
    | "decision_drift"
    | "prediction_streak"
    | "blind_spot";
  text: string;
  link?: string;
}

// Per-source label + tint, mirroring the server-side taxonomy.
const SOURCE_META: Record<Nudge["source"], { label: string; tint: string }> = {
  identity: { label: "identity", tint: "text-violet-300" },
  contradiction: { label: "contradiction", tint: "text-amber-300" },
  ghost: { label: "ghost", tint: "text-violet-400" },
  skill: { label: "skill", tint: "text-emerald-300" },
  pin_hygiene: { label: "pins", tint: "text-fg-secondary" },
  belief_refresh: { label: "belief", tint: "text-sky-300" },
  correlation: { label: "correlation", tint: "text-fuchsia-300" },
  decision_drift: { label: "decision drift", tint: "text-rose-300" },
  prediction_streak: { label: "streak", tint: "text-emerald-300" },
  blind_spot: { label: "blind spot", tint: "text-rose-400" },
};

const SEVERITY_GLYPH = {
  high: <AlertTriangle size={12} className="text-red-400" />,
  medium: <AlertCircle size={12} className="text-amber-400" />,
  low: <Info size={12} className="text-[var(--text-tertiary)]" />,
};

export function NudgePanel() {
  const utils = trpc.useUtils();
  const nudgesQuery = trpc.brain.nudges.useQuery(undefined);
  const dismissMutation = trpc.brain.dismissNudge.useMutation();
  // 2026-10-02 · following a nudge's link is accepting it (the dismiss side has
  // written `dismissed` since 2026-08-16; this lane was dismiss-only). Fire-
  // and-forget beside the navigation.
  const acceptMutation = trpc.brain.acceptNudge.useMutation();
  // WAS A FALSE ALL-CLEAR. This previously read `isError ? [] : (...)`, so a
  // FAILED query fell into the same branch as a genuinely empty one and the
  // panel rendered a green "In rhythm · all subsystems stable" across nine
  // subsystems it had just failed to read. The old comment recorded that as
  // intentional, inherited from a legacy `catch → setNudges([])`.
  //
  // A failed read is not a zero. The three cases are now distinct, and the
  // positive tone is type-gated to the measured one.
  const nudges: Nudge[] | null =
    (nudgesQuery.data?.nudges as Nudge[] | undefined) ?? null;
  const loading = nudgesQuery.isLoading;
  const loadedAt = nudgesQuery.dataUpdatedAt || null;

  if (loading) {
    return (
      <GlassCard>
        <div className="flex items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
          <Loader2 size={12} className="animate-spin" /> reading nudges…
        </div>
      </GlassCard>
    );
  }

  if (nudgesQuery.isError || !nudges || nudges.length === 0) {
    const shell = (body: ReactNode) => (
      <GlassCard>
        <div className="flex justify-end mb-1">
          <FreshnessChip lastFetchedAt={loadedAt} source="brain" compact onReload={() => void nudgesQuery.refetch()} />
        </div>
        {body}
      </GlassCard>
    );

    if (nudgesQuery.isError) {
      return shell(
        <EmptyState
          icon={AlertCircle}
          title="Nudges unavailable"
          provenance="ERROR"
          tone="warning"
          why="The nudge query failed, so nothing is known about any of the nine subsystems it aggregates. This is NOT the same as having no nudges."
          unlock="Reload above. If it keeps failing, check the brain router and /api/health."
        />,
      );
    }

    if (!nudges) {
      return shell(
        <EmptyState
          icon={AlertCircle}
          title="Nudges not yet read"
          provenance="UNMEASURED"
          why="The query returned no nudge payload at all, so no aggregation has happened this session."
          unlock="Reload above to take the measurement."
        />,
      );
    }

    return shell(
      <EmptyState
        icon={AlertCircle}
        title="In rhythm"
        provenance="ZERO"
        tone="positive"
        why="Cross-system nudges aggregate signals from identity, contradictions, ghost accuracy, skills, beliefs, correlations, decision drift, prediction streaks, and blind-spots. A measured zero here means all subsystems are stable."
        unlock="Keep shipping. New signals surface within 15s of a state change; dismissed ones return after 7d if still real."
      />,
    );
  }

  return (
    <GlassCard>
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-2">
          <p className="section-label">Live nudges</p>
          <FreshnessChip lastFetchedAt={loadedAt} source="brain" compact onReload={() => void nudgesQuery.refetch()} />
        </div>
        <span className="text-[11px] font-mono text-[var(--text-tertiary)]">
          <AnimatedCounter value={nudges.filter((n) => n.severity === "high").length} /> high ·{" "}
          <AnimatedCounter value={nudges.filter((n) => n.severity === "medium").length} /> med ·{" "}
          <AnimatedCounter value={nudges.filter((n) => n.severity === "low").length} /> low
        </span>
      </div>
      <div className="space-y-1.5">
        {nudges.map((n, i) => {
          const inner = (
            <div
              className={cn(
                "group flex items-start gap-2 px-2 py-1.5 rounded-micro border transition-colors",
                n.severity === "high" ? "border-red-500/30 bg-red-500/5"
                  : n.severity === "medium" ? "border-amber-500/30 bg-amber-500/5"
                  : "border-[var(--border-default)] bg-[var(--bg-base)]",
              )}
            >
              <span className="mt-0.5">{SEVERITY_GLYPH[n.severity]}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-[var(--text-primary)]">{n.text}</p>
                <p className={cn("text-[11px] font-mono mt-0.5", SOURCE_META[n.source]?.tint ?? "text-fg-tertiary")}>
                  {SOURCE_META[n.source]?.label ?? n.source}
                </p>
              </div>
              {/* v11.1 · Dismiss — hides nudge for 7d via
                  /api/brain/nudges/dismiss → BrainMemory
                  nudge_ack row with expiresAt. computeNudges on
                  the server filters by ack. */}
              <DismissButton
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  try {
                    await dismissMutation.mutateAsync({
                      source: n.source,
                      text: n.text,
                      until: "7d",
                    });
                    toast.success("dismissed · back in 7d");
                    void utils.brain.nudges.invalidate();
                  } catch {
                    toast.error("dismiss failed");
                  }
                }}
                label="Dismiss for 7 days"
                alwaysVisible
                size="sm"
                className="shrink-0 hover:text-rose-400"
              />
            </div>
          );
          return n.link ? (
            // next/link, not <a>: every nudge link is an in-app path, and a full
            // document navigation would abort the fire-and-forget accept below.
            <Link
              key={`${n.source}-${i}`}
              href={n.link}
              onClick={() => acceptMutation.mutate({ source: n.source, text: n.text })}
              data-nudge-decision="accepted"
              className="block hover:brightness-110"
            >
              {inner}
            </Link>
          ) : (
            <div key={`${n.source}-${i}`}>{inner}</div>
          );
        })}
      </div>
    </GlassCard>
  );
}
