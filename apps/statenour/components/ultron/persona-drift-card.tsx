"use client";

/**
 * PersonaDriftCard · v10.0.529.38 · Arc B Feature 4 · review surface
 *
 * Dedicated operator review surface for persona-drift events the
 * detector logs. Pairs with the SituationCard's `persona_drift`
 * ranked source (which surfaces ONE summary candidate) · this card
 * lets the operator see EVERY drift in the last 7d and take action
 * per-row.
 *
 * Resolution actions:
 *   · acknowledge · "I saw it · doesn't change my behavior" · stays
 *     visible until naturally expires from the 7d window
 *   · snooze     · "Quiet for a week · re-surface if it persists"
 *   · dismiss    · "False positive · soft-delete" · gone immediately
 *
 * The persona-anchor injection at chat-time (v529.36) should reduce
 * drift over time · this card is the operator's calibration loop ·
 * persistent drift here = signal the 8-axis spec needs updating to
 * match the operator's actual current self-model.
 *
 * Surface design (frontend-design):
 *   · GlassCard with gold accent · matches the family
 *   · Dense per-row layout · drift % · excerpt · resolve toggle
 *   · Compass icon · same vocabulary as the situation source
 *   · Silent on empty (no active drifts in 7d) · zero card noise
 */

import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  Compass,
  Check,
  Clock,
  X as XIcon,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

type Resolution = "acknowledge" | "snooze" | "dismiss";

const TOP_N = 4;
const PREVIEW_CHARS = 160;

const RESOLVE_META: Record<
  Resolution,
  { label: string; title: string; icon: typeof Check; tone: string }
> = {
  acknowledge: {
    label: "noted",
    title: "I saw it · drift acknowledged · row stays visible until it ages out",
    icon: Check,
    tone: "border-emerald-400/45 bg-emerald-400/[0.08] text-emerald-300 hover:bg-emerald-400/15",
  },
  snooze: {
    label: "snooze 7d",
    title: "quiet this drift for 7 days · re-surfaces if it persists past then",
    icon: Clock,
    tone: "border-amber-400/45 bg-amber-400/[0.08] text-amber-300 hover:bg-amber-400/15",
  },
  dismiss: {
    label: "dismiss",
    title: "false positive · soft-delete the row · gone immediately",
    icon: XIcon,
    tone: "border-rose-400/35 bg-rose-400/[0.06] text-rose-300/85 hover:text-rose-300 hover:bg-rose-400/15",
  },
};

function trimText(s: string, n = PREVIEW_CHARS): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

function daysAgo(iso: string): number | null {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400_000));
}

export function PersonaDriftCard() {
  // Phase B.6c (2026-05-22) · migrated off `useUltronFetch("/api/system/
  // persona-drift")` + an `authedFetch` POST onto `trpc.system.personaDrift`
  // (reactive read · 5-min refetchInterval) + `trpc.system.resolvePersonaDrift`
  // (mutation). The procedure returns `{ items, summary }` directly ·
  // the legacy envelope unwrap is gone. The `key` path param now rides
  // in the mutation input object (tRPC has no path).
  const drift = trpc.system.personaDrift.useQuery(undefined, {
    refetchInterval: 300_000,
    staleTime: 300_000,
  });
  const utils = trpc.useUtils();
  const resolveMutation = trpc.system.resolvePersonaDrift.useMutation();

  const [submittingKey, setSubmittingKey] = useState<string | null>(null);

  const submitResolution = useCallback(
    async (key: string, resolution: Resolution) => {
      setSubmittingKey(key);
      const toastId = toast.loading(`${resolution}…`);
      try {
        await resolveMutation.mutateAsync({ key, resolution });
        toast.success(
          resolution === "dismiss"
            ? "dismissed · false positive logged"
            : resolution === "snooze"
              ? "snoozed 7d"
              : "noted · row stays visible",
          { id: toastId },
        );
        await utils.system.personaDrift.invalidate();
      } catch {
        toast.error("resolve failed", { id: toastId });
      } finally {
        setSubmittingKey(null);
      }
    },
    [resolveMutation, utils],
  );

  if (drift.isLoading && !drift.data) {
    return <ShimmerSkeleton variant="card" className="min-h-[96px]" />;
  }

  const items = drift.data?.items ?? [];
  if (items.length === 0) return null;

  const shown = items.slice(0, TOP_N);
  const more = Math.max(0, items.length - TOP_N);
  const strongest = drift.data?.summary?.strongest ?? items[0].drift;

  return (
    <GlassCard
      className="min-h-[96px] border-[var(--gold)]/25 bg-[var(--gold)]/[0.03]"
      data-testid="persona-drift-card"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]">
          <Compass size={11} />
          identity · drift
          <span className="rounded-sm border border-[var(--gold)]/30 px-1 py-px text-[9px] tabular-nums text-[var(--gold)]">
            {items.length} · {Math.round(strongest * 100)}% max
          </span>
        </span>
        <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)] tabular-nums">
          7d window
        </span>
      </div>

      <ul className="mt-2 space-y-1.5" aria-label="Active persona drift events">
        {shown.map((d) => {
          const isSubmitting = submittingKey === d.key;
          const age = daysAgo(d.detectedAt);
          const driftPct = Math.round(d.drift * 100);
          return (
            <li key={d.key} className="text-[11px] leading-snug">
              <div className="-mx-1 flex items-start gap-2 px-1 py-1 rounded-sm">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5">
                    <span className="shrink-0 text-[8.5px] font-mono uppercase tracking-[0.18em] text-amber-400/80 tabular-nums">
                      {driftPct}%
                    </span>
                    <span className="text-[var(--text-primary)]">
                      {trimText(d.excerpt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 text-[9px] font-mono text-[var(--text-tertiary)] tabular-nums">
                    {age !== null && (
                      <span title={`detected ${d.detectedAt}`}>
                        {age === 0 ? "today" : `${age}d ago`}
                      </span>
                    )}
                    <span aria-hidden="true">·</span>
                    <span title={`cosine similarity ${d.similarity.toFixed(2)}`}>
                      sim {d.similarity.toFixed(2)}
                    </span>
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-1">
                  {(["acknowledge", "snooze", "dismiss"] as Resolution[]).map(
                    (r) => {
                      const meta = RESOLVE_META[r];
                      const Icon = isSubmitting ? Loader2 : meta.icon;
                      return (
                        <button
                          key={r}
                          type="button"
                          onClick={() => submitResolution(d.key, r)}
                          disabled={isSubmitting}
                          title={meta.title}
                          aria-label={`${r} this drift event`}
                          className={cn(
                            "flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-mono lowercase tracking-wide transition-colors",
                            "min-h-[44px] sm:min-h-[24px]",
                            meta.tone,
                            isSubmitting && "opacity-60 cursor-wait",
                          )}
                        >
                          <Icon
                            size={9}
                            className={isSubmitting ? "animate-spin" : undefined}
                          />
                          <span className="hidden sm:inline">{meta.label}</span>
                        </button>
                      );
                    },
                  )}
                </div>
              </div>
            </li>
          );
        })}
        {more > 0 && (
          <li className="text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)] pl-3">
            <span className="inline-flex items-center gap-1">
              <ChevronRight size={9} />+ {more} more in window
            </span>
          </li>
        )}
      </ul>

      <p className="mt-2 border-t border-[var(--border-default)]/30 pt-2 text-[10px] italic text-[var(--text-tertiary)]">
        drift = 1 − cosine(reply, 8-axis identity) · persistent drift here suggests your stated spec needs updating
      </p>
    </GlassCard>
  );
}
