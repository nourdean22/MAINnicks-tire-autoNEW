"use client";

/**
 * DailyBriefSection — the "REVIEW" half of the merged LEARN/REVIEW
 * tab. Auto-surfaces a time-of-day appropriate brief from the
 * existing pulse-digest endpoint + cron-produced belief refresh +
 * pin hygiene reports.
 *
 * Before: REVIEW was a separate tab that literally rendered the
 * same <KommandoLearn /> as LEARN. Two tabs, one component. Nour
 * called it out — identical copies. This section is what REVIEW
 * was supposed to be. Now it lives above the LEARN research UI
 * so the tab does both jobs cleanly.
 *
 * Phases:
 *   morning (5-11)   → "Morning brief" — yesterday's recap + today's MIT
 *   midday  (11-14)  → "Midday pulse" — what's slipping
 *   afternoon (14-18) → "Afternoon push" — what still matters today
 *   evening (18-22)  → "Evening debrief" — done today + tomorrow seed
 *   late (22-5)      → "Overnight" — patterns + sleep hygiene
 *
 * Collapses if there's nothing meaningful to show (no priority
 * items + no maintenance reports) so the page isn't cluttered.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { authedFetch } from "@/hooks/use-authed-fetch";
import { TipChip } from "@/components/ui/tip-chip";
import { LEARN_TIPS } from "@/lib/learn/tips";
import {
  Sunrise,
  Sun,
  Sunset,
  Moon,
  MoonStar,
  Loader2,
  Sparkles,
  AlertTriangle,
  Trophy,
  Pin,
} from "lucide-react";

type Phase = "morning" | "midday" | "afternoon" | "evening" | "late";

interface DigestItem {
  id: string;
  headline: string;
  detail?: string;
  kind: "drift" | "insight" | "win" | "error" | "maintenance";
  severity: "critical" | "warning" | "info" | "win";
  streakDays?: number;
  at: string;
  link?: string;
}

interface DigestPayload {
  priority?: DigestItem[];
  emerging?: DigestItem[];
  wins?: DigestItem[];
  maintenance?: DigestItem[];
  summary?: {
    total?: number;
    highestHeadline?: string | null;
  };
}

interface BriefMeta {
  phase: Phase;
  headline: string;
  subtitle: string;
  icon: React.ReactNode;
  accent: string;
}

function currentPhase(): Phase {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return "morning";
  if (h >= 11 && h < 14) return "midday";
  if (h >= 14 && h < 18) return "afternoon";
  if (h >= 18 && h < 22) return "evening";
  return "late";
}

const PHASE_META: Record<Phase, BriefMeta> = {
  morning: {
    phase: "morning",
    headline: "Morning brief",
    subtitle: "Yesterday's close + today's MIT",
    icon: <Sunrise size={12} className="text-amber-400" />,
    accent: "border-amber-500/25 bg-amber-500/[0.04]",
  },
  midday: {
    phase: "midday",
    headline: "Midday pulse",
    subtitle: "What's at risk of slipping",
    icon: <Sun size={12} className="text-amber-300" />,
    accent: "border-amber-400/25 bg-amber-400/[0.03]",
  },
  afternoon: {
    phase: "afternoon",
    headline: "Afternoon push",
    subtitle: "What still matters today",
    icon: <Sun size={12} className="text-orange-400" />,
    accent: "border-orange-500/25 bg-orange-500/[0.03]",
  },
  evening: {
    phase: "evening",
    headline: "Evening debrief",
    subtitle: "Done today · tomorrow's seed",
    icon: <Sunset size={12} className="text-violet-400" />,
    accent: "border-violet-500/25 bg-violet-500/[0.03]",
  },
  late: {
    phase: "late",
    headline: "Overnight",
    subtitle: "Patterns + sleep hygiene",
    icon: <Moon size={12} className="text-blue-400" />,
    accent: "border-blue-500/25 bg-blue-500/[0.03]",
  },
};

interface MaintenanceRow {
  id: string;
  kind: "belief_refresh" | "pin_hygiene";
  headline: string;
  detail?: string;
  updatedAt: string;
  link: string;
}

// v10.0.277 · "Today's pulse" chip data · weak axis + top-fired lens
// + voice-call summary surfaced as inline chips at the top of the brief.
interface PulseChips {
  weakAxis: string | null;
  maturity: number | null;
  topLens: string | null;
  topLensCount: number;
  voiceCallsToday: number;
}

export function DailyBriefSection() {
  const [phase, setPhase] = useState<Phase>("morning");
  const [digest, setDigest] = useState<DigestPayload | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceRow[]>([]);
  const [pulse, setPulse] = useState<PulseChips | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setPhase(currentPhase());
    const id = setInterval(() => setPhase(currentPhase()), 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [digestRes, maintRes, brainRes, lensRes, voiceRes] = await Promise.all([
        authedFetch("/api/ultron/pulse-digest").then((r) => (r.ok ? r.json() : null)),
        authedFetch("/api/brain/memories?category=belief_refresh_report&limit=1"
        ).then((r) => (r.ok ? r.json() : null)),
        // v10.0.277 · pulse chips · weak axis + top lens + voice today
        authedFetch("/api/actions-brain").then((r) => (r.ok ? r.json() : null)),
        authedFetch("/api/system/lens-stats?days=1").then((r) => (r.ok ? r.json() : null)),
        authedFetch("/api/system/vapi-calls?days=1").then((r) => (r.ok ? r.json() : null)),
      ]);

      // Pulse chips · safe-fail · null if any source breaks
      try {
        const brainData = (brainRes?.data ?? null) as
          | { weakAxis?: string | null; maturity?: number | null }
          | null;
        const lensData = (lensRes?.data ?? lensRes ?? null) as
          | { topFrameworks?: Array<{ framework: string; count: number }> }
          | null;
        const voiceData = (voiceRes?.data ?? voiceRes ?? null) as
          | { totalCalls?: number }
          | null;
        const top = lensData?.topFrameworks?.find(
          (f) => f.framework !== "(fallback)",
        );
        setPulse({
          weakAxis: brainData?.weakAxis ?? null,
          maturity: brainData?.maturity ?? null,
          topLens: top?.framework ?? null,
          topLensCount: top?.count ?? 0,
          voiceCallsToday: voiceData?.totalCalls ?? 0,
        });
      } catch {
        setPulse(null);
      }

      // pulse-digest route returns { priority, emerging, wins, maintenance }
      // directly (no envelope) based on the route shape.
      if (digestRes) {
        setDigest(
          (digestRes.data ?? digestRes) as DigestPayload
        );
      }

      // belief refresh rows — merged with pin hygiene into one list.
      // Also pull pin hygiene via a separate call since memories API
      // can only filter one category at a time through this endpoint.
      const [pinMaint] = await Promise.all([
        authedFetch("/api/brain/memories?category=nudge_pin_hygiene&limit=1"
        ).then((r) => (r.ok ? r.json() : null)),
      ]);

      const rows: MaintenanceRow[] = [];
      const beliefList =
        (maintRes?.data ?? maintRes?.memories ?? maintRes ?? []) as Array<{
          id: string;
          content?: string;
          updatedAt?: string;
          metadata?: { changes?: Array<{ action: string }> };
        }>;
      for (const r of (Array.isArray(beliefList) ? beliefList : []).slice(0, 1)) {
        const needsReview =
          r.metadata?.changes?.filter((c) => c.action === "queued_for_review").length || 0;
        rows.push({
          id: r.id,
          kind: "belief_refresh",
          headline:
            needsReview > 0
              ? `${needsReview} beliefs need your call`
              : "Beliefs refreshed overnight",
          detail: r.content,
          updatedAt: r.updatedAt || new Date().toISOString(),
          link: "/brain",
        });
      }
      const pinList =
        (pinMaint?.data ?? pinMaint?.memories ?? pinMaint ?? []) as Array<{
          id: string;
          content?: string;
          updatedAt?: string;
          metadata?: { findings?: Array<{ kind: string }> };
        }>;
      for (const r of (Array.isArray(pinList) ? pinList : []).slice(0, 1)) {
        const veryStale =
          r.metadata?.findings?.filter((f) => f.kind === "very_stale").length || 0;
        rows.push({
          id: r.id,
          kind: "pin_hygiene",
          headline:
            veryStale > 0
              ? `${veryStale} very-stale pins`
              : "Pin hygiene check ran",
          detail: r.content,
          updatedAt: r.updatedAt || new Date().toISOString(),
          link: "/brain#pinned-context",
        });
      }
      setMaintenance(rows);
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Refresh every 5 min so the brief reflects new cron output
    const id = setInterval(load, 5 * 60_000);
    return () => clearInterval(id);
  }, [load]);

  const meta = PHASE_META[phase];
  const priorityItems = (digest?.priority ?? []).slice(0, 3);
  const wins = (digest?.wins ?? []).slice(0, 3);
  const emerging = (digest?.emerging ?? []).slice(0, 2);

  const hasContent = useMemo(
    () =>
      priorityItems.length > 0 ||
      wins.length > 0 ||
      emerging.length > 0 ||
      maintenance.length > 0,
    [priorityItems, wins, emerging, maintenance]
  );

  if (loading) {
    return (
      <div
        className={cn(
          "rounded-xl border px-3 py-2.5 flex items-center gap-2",
          meta.accent
        )}
      >
        <Loader2 size={12} className="animate-spin text-zinc-500" />
        <span className="text-[10px] text-zinc-500">loading brief…</span>
      </div>
    );
  }

  if (!hasContent) {
    return (
      <div className={cn("rounded-xl border px-3 py-2.5", meta.accent)}>
        <div className="flex items-center gap-2">
          {meta.icon}
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-300">
            {meta.headline}
          </span>
          <span className="text-[10px] text-emerald-400/80 ml-auto">
            clean · nothing to review
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("rounded-xl border", meta.accent)}>
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.02] transition-colors"
      >
        {meta.icon}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-300">
              {meta.headline}
            </span>
            {/* v10.0.529.74 · Wave 20 · learn-anywhere · explain what
                the daily brief is + when it's morning vs evening. */}
            <TipChip tip={LEARN_TIPS.trends_brief} title="daily brief" size="xs" />
            <span className="text-[9px] text-zinc-600">{meta.subtitle}</span>
          </div>
        </div>
        <span className="text-[9px] font-mono text-zinc-600">
          {collapsed ? "expand" : "collapse"}
        </span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-2.5">
          {/* v10.0.277 · Today's pulse chips · weak axis + top fired
              lens + voice calls. Renders only when at least one chip
              has data so the section doesn't bloat empty. */}
          {pulse &&
            (pulse.weakAxis || pulse.topLens || pulse.voiceCallsToday > 0) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {pulse.weakAxis && (
                  <Link
                    href="/brain"
                    className="inline-flex items-center gap-1 rounded border border-rose-500/30 bg-rose-500/5 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-rose-300 hover:bg-rose-500/15 transition-colors"
                    title={`Weakest axis · tap → /brain`}
                  >
                    <span className="h-1 w-1 rounded-full bg-rose-400 animate-pulse" />
                    weak · {pulse.weakAxis}
                    {typeof pulse.maturity === "number" && (
                      <span className="text-rose-400/60 ml-1">
                        · {pulse.maturity}
                      </span>
                    )}
                  </Link>
                )}
                {pulse.topLens && (
                  <Link
                    href="/system/lens-stats"
                    className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/5 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-emerald-300 hover:bg-emerald-500/15 transition-colors"
                    title={`Top-fired lens today · ${pulse.topLensCount}× · tap for breakdown`}
                  >
                    lens · {pulse.topLens}
                    <span className="text-emerald-400/60 ml-0.5">
                      ×{pulse.topLensCount}
                    </span>
                  </Link>
                )}
                {pulse.voiceCallsToday > 0 && (
                  <Link
                    href="/system/vapi-calls"
                    className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/5 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-amber-300 hover:bg-amber-500/15 transition-colors"
                    title={`Voice calls today · tap for detail`}
                  >
                    voice · {pulse.voiceCallsToday}
                    <span className="text-amber-400/60 ml-0.5">
                      call{pulse.voiceCallsToday === 1 ? "" : "s"}
                    </span>
                  </Link>
                )}
              </div>
            )}

          {/* Overnight maintenance (cron output) */}
          {maintenance.length > 0 && (
            <div className="space-y-1">
              <p className="text-[8px] font-bold uppercase tracking-[0.22em] text-emerald-400/70">
                Overnight
              </p>
              {maintenance.map((m) => (
                <Link
                  key={m.id}
                  href={m.link}
                  className="flex items-start gap-2 px-2 py-1.5 rounded-md border border-emerald-500/15 bg-emerald-500/[0.03] hover:border-emerald-500/30 hover:bg-emerald-500/[0.06] transition-colors"
                >
                  {m.kind === "belief_refresh" ? (
                    <Sparkles size={10} className="text-emerald-400/60 mt-0.5 shrink-0" />
                  ) : (
                    <Pin size={10} className="text-[var(--gold)]/60 mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-zinc-200 font-medium">
                      {m.headline}
                    </p>
                    {m.detail && (
                      <p className="text-[9px] text-zinc-500 truncate">
                        {m.detail}
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Priority */}
          {priorityItems.length > 0 && (
            <div className="space-y-1">
              <p className="text-[8px] font-bold uppercase tracking-[0.22em] text-red-400/70">
                Priority
              </p>
              {priorityItems.map((item) => {
                const inner = (
                  <div className="flex items-start gap-2 px-2 py-1.5 rounded-md border border-red-500/20 bg-red-500/[0.03]">
                    <AlertTriangle
                      size={10}
                      className="text-red-400 mt-0.5 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-zinc-200">{item.headline}</p>
                      {item.streakDays && item.streakDays > 1 && (
                        <span className="text-[8px] font-mono text-red-400">
                          ×{item.streakDays}d streak
                        </span>
                      )}
                    </div>
                  </div>
                );
                return item.link ? (
                  <Link key={item.id} href={item.link} className="block hover:brightness-110">
                    {inner}
                  </Link>
                ) : (
                  <div key={item.id}>{inner}</div>
                );
              })}
            </div>
          )}

          {/* Emerging insights */}
          {emerging.length > 0 && (
            <div className="space-y-1">
              <p className="text-[8px] font-bold uppercase tracking-[0.22em] text-[var(--gold)]/70">
                Emerging
              </p>
              {emerging.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-2 px-2 py-1.5 rounded-md border border-[var(--gold)]/15 bg-[var(--gold)]/[0.03]"
                >
                  <Sparkles
                    size={10}
                    className="text-[var(--gold)]/80 mt-0.5 shrink-0"
                  />
                  <p className="text-[11px] text-zinc-200">{item.headline}</p>
                </div>
              ))}
            </div>
          )}

          {/* Wins */}
          {wins.length > 0 && (
            <div className="space-y-1">
              <p className="text-[8px] font-bold uppercase tracking-[0.22em] text-emerald-400/70">
                Wins
              </p>
              {wins.slice(0, 3).map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-2 px-2 py-1"
                >
                  <Trophy size={9} className="text-emerald-400/80 mt-0.5 shrink-0" />
                  <p className="text-[10px] text-zinc-400">{item.headline}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
