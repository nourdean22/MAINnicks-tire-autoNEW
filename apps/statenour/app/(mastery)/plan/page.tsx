"use client";

/**
 * /plan — orchestrated day planner.
 *
 * v6 · BATCH 6 · Apr 28. Pulls everything Nour needs (tasks, calendar,
 * brain memory, recent scores, industry intel, customer stories) and
 * generates a structured plan. Each block has one-click actions: open
 * task, navigate to page, capture note, set reminder.
 *
 * Day picker: today / tomorrow / Saturday / this-week / explicit date.
 * Optional intent input: "close out the launch" / "rest day" / etc.
 *
 * The plan rendering ties to the existing /tasks queue, /actions desk,
 * and HQ situation pages — clicking "open task X" navigates to /tasks?focus=X.
 */

import { useState, useCallback, useRef } from "react";
import { Panel } from "@/components/panel";
import { StandardPage } from "@/components/layout/standard-page";
// v10.0.529.57 · AnimatedCounter import removed · only consumer
// was the deleted Stat component / Inputs summary panel.
import { GoalNextActionsCard } from "@/components/plan/goal-next-actions-card";
import { cn } from "@/lib/utils/cn";
import Link from "next/link";
import { authedFetch } from "@/hooks/use-authed-fetch";
import {
  Calendar,
  Clock,
  Sparkles,
  Loader2,
  AlertCircle,
  Plus,
  Coffee,
  Briefcase,
  Wrench,
  Heart,
  Megaphone,
  ListTodo,
  Navigation,
} from "lucide-react";

type DayLabel = "today" | "tomorrow" | "saturday" | "this-week";

interface PlanAction {
  label: string;
  type: "task" | "nav" | "capture" | "reminder";
  target?: string;
}

interface PlanBlock {
  id: string;
  time: string;
  title: string;
  kind: "deep-work" | "meeting" | "shop" | "personal" | "marketing" | "rest";
  actions: PlanAction[];
  rationale: string;
}

interface DayPlan {
  period: string;
  theme: string;
  blocks: PlanBlock[];
  antiPatterns: string[];
  winCondition: string;
}

interface PlanResponse {
  ok: boolean;
  plan?: DayPlan;
  inputs: {
    taskCount: number;
    eventCount: number;
    brainCount: number;
    industryCount: number;
    storyCount: number;
  };
  meta: { model: string; provider: string; durationMs: number };
  error?: string;
  raw?: string;
}

// v10.0.529.59 · KIND_CONFIG rainbow palette CUT (audit Wave 8).
// Operator's editorial-minimalist contract has ONE accent (gold).
// 5 distinct semantic block-types now use varied opacity + the
// gold accent · readability + cohesion both improve. Icons stay
// distinct so the operator can still tell block-types apart.
const KIND_CONFIG: Record<PlanBlock["kind"], { icon: typeof Coffee; tone: string; label: string }> = {
  "deep-work": { icon: Briefcase, tone: "border-[var(--gold)]/40 bg-[var(--gold)]/[0.06] text-[var(--gold)]", label: "DEEP WORK" },
  meeting: { icon: Calendar, tone: "border-[var(--gold)]/25 bg-[var(--gold)]/[0.03] text-[var(--text-primary)]", label: "MEETING" },
  shop: { icon: Wrench, tone: "border-[var(--gold)]/25 bg-[var(--gold)]/[0.03] text-[var(--text-primary)]", label: "SHOP" },
  personal: { icon: Heart, tone: "border-[var(--border-default)] bg-[var(--bg-raised)]/[0.04] text-[var(--text-secondary)]", label: "PERSONAL" },
  marketing: { icon: Megaphone, tone: "border-[var(--gold)]/25 bg-[var(--gold)]/[0.03] text-[var(--text-primary)]", label: "MARKETING" },
  rest: { icon: Coffee, tone: "border-zinc-500/30 bg-zinc-500/5 text-zinc-300", label: "REST" },
};

export default function PlanPage() {
  const [data, setData] = useState<PlanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState<DayLabel>("today");
  const [intent, setIntent] = useState("");

  // v10.0.31 — abort signal so a programmatic re-fire (or fast
  // user click on a future hotkey) doesn't pile concurrent requests.
  const inflightRef = useRef<AbortController | null>(null);

  const generate = useCallback(async () => {
    if (inflightRef.current) inflightRef.current.abort();
    const ctrl = new AbortController();
    inflightRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch("/api/ai/plan-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dayLabel: day, intent }),
        signal: ctrl.signal,
      });
      // v10.0.31 — res.ok guard before .json(). Pre-v10.0.31 a 5xx
      // returned an HTML error page; .json() either threw or
      // produced garbage, leaving json.ok undefined and surfacing
      // a confusing "plan generation failed" toast.
      if (!res.ok) throw new Error(`plan API ${res.status} ${res.statusText}`);
      const json = (await res.json()) as PlanResponse;
      if (!json.ok) throw new Error(json.error ?? "plan generation failed");
      setData(json);
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [day, intent]);

  return (
    <StandardPage
      eyebrow="NOUR OS · Plan"
      title="day planner"
      description={
        data?.plan
          ? `${data.plan.period} · theme: ${data.plan.theme} · ${data.plan.blocks.length} blocks`
          : "Click generate to draft today/Saturday/etc."
      }
      width="lg"
      rhythm="comfortable"
    >

      {/* Controls */}
      <Panel>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1">period</label>
            <div className="flex gap-1 flex-wrap">
              {(["today", "tomorrow", "saturday", "this-week"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDay(d)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs transition-colors",
                    day === d
                      ? "bg-emerald-500/15 text-emerald-200 border border-emerald-500/40"
                      : "bg-white/[0.02] text-zinc-400 hover:bg-white/[0.06] border border-white/10",
                  )}
                >
                  {d === "this-week" ? "this week" : d}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1">intent (optional)</label>
            <input
              type="text"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder="close out launch / rest mode / shop-floor focus..."
              className="w-full rounded-md border border-white/10 bg-white/[0.02] px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-500 outline-none focus:border-white/25"
            />
          </div>
          <button
            onClick={generate}
            disabled={loading}
            className={cn(
              "rounded-lg border px-4 py-2 text-sm font-medium transition w-full sm:w-auto",
              loading
                ? "border-amber-500/40 bg-amber-500/10 text-amber-200 cursor-wait"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15",
            )}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating…
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <Sparkles className="h-4 w-4" />
                Generate plan
              </span>
            )}
          </button>
        </div>
      </Panel>

      {error && (
        <Panel className="border-rose-500/40 bg-rose-500/10">
          <div className="flex items-center gap-2 p-3 text-sm text-rose-200">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        </Panel>
      )}

      {/* v8.10 BATCH 56 — behind-pace nudges. Silent when no goals
          are >10pts behind. Composes v8.9 next-actions API. */}
      <GoalNextActionsCard />

      {/* v10.0.529.57 · Inputs summary panel CUT (audit Wave 9 · HIGH).
          Was a 5-stat diagnostic about what the AI pulled · not
          actionable · operator can't change these counts from this
          page. Removed cleanly. */}

      {/* Plan output */}
      {data?.plan && (
        <>
          {/* Theme + win condition */}
          <Panel>
            <div className="text-center space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">theme</div>
              {/* v10.0.529.57 · emerald-300 → gold · audit Wave 8 flagged
                  emerald as second-accent slop in a gold-accent system. */}
              <div className="text-2xl font-bold text-[var(--gold)]">{data.plan.theme}</div>
              <div className="text-xs text-zinc-400">
                <span className="opacity-60">win condition · </span>
                {data.plan.winCondition}
              </div>
            </div>
          </Panel>

          {/* Blocks */}
          <div className="space-y-2">
            {data.plan.blocks.map((b) => {
              const cfg = KIND_CONFIG[b.kind] ?? KIND_CONFIG.personal;
              const Icon = cfg.icon;
              return (
                <Panel key={b.id} className={cn("transition-colors", cfg.tone)}>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        <span className="font-mono text-xs uppercase tracking-wider opacity-70">{cfg.label}</span>
                        <span className="font-mono text-xs opacity-60">·</span>
                        <span className="font-mono text-xs">{b.time}</span>
                      </div>
                    </div>
                    <h3 className="text-base font-semibold text-white">{b.title}</h3>
                    <p className="text-xs text-zinc-300 italic opacity-70">{b.rationale}</p>
                    {b.actions.length > 0 && (
                      <div className="flex gap-1.5 flex-wrap pt-1">
                        {b.actions.map((a, idx) => (
                          // v10.0.31 — was key={idx} (array index). If
                          // the AI varies the action ordering across
                          // regenerations, React misassociated DOM
                          // nodes. Composite of label+type is stable.
                          <ActionButton key={`${a.label}::${a.type}::${idx}`} action={a} />
                        ))}
                      </div>
                    )}
                  </div>
                </Panel>
              );
            })}
          </div>

          {/* Anti-patterns */}
          {data.plan.antiPatterns.length > 0 && (
            <Panel className="border-rose-500/30 bg-rose-500/5">
              <h2 className="text-xs font-semibold text-rose-300 mb-2">avoid today</h2>
              <ul className="space-y-1">
                {data.plan.antiPatterns.map((p, idx) => (
                  <li key={idx} className="text-xs text-rose-200/80 flex items-start gap-1.5">
                    <span className="text-rose-400 flex-shrink-0">×</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {/* v10.0.529.57 · model/provider/durationMs debug footer CUT.
              Audit Wave 9 flagged as live UI debug telemetry · operator
              cares about the plan, not which provider answered it. */}
        </>
      )}
    </StandardPage>
  );
}

// v10.0.529.57 · Stat component deleted · was only used by the cut
// Inputs summary panel. AnimatedCounter import may also be unused now.

function ActionButton({ action }: { action: PlanAction }) {
  const baseClass = "rounded-md px-2 py-1 text-[10px] font-mono inline-flex items-center gap-1 transition-colors border";

  if (action.type === "nav" && action.target) {
    return (
      <Link
        href={action.target}
        className={cn(baseClass, "border-sky-500/30 bg-sky-500/10 text-sky-200 hover:bg-sky-500/15")}
      >
        <Navigation className="h-3 w-3" />
        {action.label}
      </Link>
    );
  }
  if (action.type === "task" && action.target) {
    return (
      <Link
        href={`/tasks?q=${encodeURIComponent(action.target.slice(0, 30))}`}
        className={cn(baseClass, "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15")}
      >
        <ListTodo className="h-3 w-3" />
        {action.label}
      </Link>
    );
  }
  if (action.type === "capture") {
    return (
      <Link
        href={`/chat?prompt=${encodeURIComponent(action.target ?? action.label)}`}
        className={cn(baseClass, "border-violet-500/30 bg-violet-500/10 text-violet-200 hover:bg-violet-500/15")}
      >
        <Plus className="h-3 w-3" />
        {action.label}
      </Link>
    );
  }
  return (
    <span className={cn(baseClass, "border-zinc-500/30 bg-zinc-500/10 text-zinc-300")}>
      <Clock className="h-3 w-3" />
      {action.label}
    </span>
  );
}
