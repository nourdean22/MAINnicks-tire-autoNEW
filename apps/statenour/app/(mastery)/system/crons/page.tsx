"use client";

/**
 * /system/crons — live command deck for every scheduled job.
 *
 * v11.0 (W2.2). Source: config/crons.ts + CronJobLog + BrainMemory
 * (cron_control). Auto-refreshes every 30s. Fires /api/system/crons/
 * {toggle,run} for control actions.
 *
 * Controls per row:
 *   · STATUS DOT (live)     — green/amber/red, pulses on recent run
 *   · NAME + CATEGORY PILL  — clickable → filter
 *   · SCHEDULE + NEXT-IN    — live countdown
 *   · LAST RUN              — time-ago + duration + pass/fail
 *   · SPARKLINE             — 20-run duration history
 *   · SUCCESS RATE          — 14d %
 *   · KILL SWITCH           — toggle disables (stored as BrainMemory)
 *   · RUN NOW               — manually trigger via /api/system/crons/run
 *
 * Alive elements:
 *   · pulsing dot on active runs
 *   · countdown tick every second
 *   · row shimmer during manual run
 *   · category tint on hover
 *   · drift bar turns red when last-run is > 150% of expected gap
 */

import { useState, useEffect, useMemo } from "react";
import { Panel } from "@/components/panel";
import { StandardPage } from "@/components/layout/standard-page";
import { SortDropdown } from "@/components/ui/sort-dropdown";
import { cn } from "@/lib/utils/cn";
import { toast } from "sonner";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { CronFoldTree } from "@/components/system/cron-fold-tree";
// 2026-08-16 · relocated from the retired /knowledge page. This is the
// manual trigger for the 8-subsystem ingest fan-out + prompt-cache flush —
// the same class of action as this deck's per-row RUN NOW.
import { KnowledgeRefreshPanel } from "@/components/system/knowledge-refresh-panel";
import { relativeTimeSeconds as timeAgo } from "@/lib/utils/datetime";

// Phase B.7a (2026-05-22) · REST→tRPC system-pages slice · the
// authedFetch read is `trpc.systemAutomation.cronDeck.useQuery`; the kill-switch
// toggle + run-now POSTs are `trpc.systemAutomation.setCronEnabled` /
// `trpc.systemAutomation.runManifestCron` mutations. The 30s poll maps to
// `refetchInterval`; per-job busy state stays as local Sets.
import { trpc } from "@/lib/trpc/client";

type CronMode = "active" | "folded" | "retired" | "dormant";
type Category = "ingest" | "brain" | "hygiene" | "signals" | "review" | "compose" | "device" | "alert" | "action";

interface CronRow {
  name: string;
  schedule: string | null;
  mode: CronMode;
  category: Category;
  description: string;
  memory?: number;
  maxDuration?: number;
  foldedInto?: string;
  retireAfter?: string;
  enabled: boolean;
  lastSuccessAt: string | null;
  lastFailAt: string | null;
  success14d: number;
  fail14d: number;
  successRate: number;
  recentDurations: number[];
  lastRunAt: string | null;
  lastRunMs: number | null;
  lastStatus: "success" | "failed" | null;
  nextRunAt: string | null;
  drift: number | null;
}

interface Summary {
  active: number;
  disabled: number;
  folded: number;
  retired: number;
  runs24h: number;
  failures24h: number;
  drifted: number;
}

interface FeedResponse {
  rows: CronRow[];
  summary: Summary;
  generatedAt: string;
}

const CATEGORY_META: Record<Category, { label: string; tint: string; glow: string }> = {
  compose: { label: "compose",   tint: "text-violet-300",  glow: "shadow-[0_0_12px_rgba(139,92,246,0.35)]" },
  ingest:  { label: "ingest",    tint: "text-sky-300",     glow: "shadow-[0_0_12px_rgba(56,189,248,0.3)]" },
  brain:   { label: "brain",     tint: "text-fuchsia-300", glow: "shadow-[0_0_12px_rgba(232,121,249,0.3)]" },
  signals: { label: "signals",   tint: "text-amber-300",   glow: "shadow-[0_0_12px_rgba(251,191,36,0.3)]" },
  hygiene: { label: "hygiene",   tint: "text-emerald-300", glow: "shadow-[0_0_12px_rgba(52,211,153,0.25)]" },
  review:  { label: "review",    tint: "text-yellow-200",  glow: "shadow-[0_0_12px_rgba(250,204,21,0.25)]" },
  device:  { label: "device",    tint: "text-cyan-300",    glow: "shadow-[0_0_12px_rgba(103,232,249,0.3)]" },
  alert:   { label: "alert",     tint: "text-rose-300",    glow: "shadow-[0_0_12px_rgba(251,113,133,0.3)]" },
  action:  { label: "action",    tint: "text-lime-300",    glow: "shadow-[0_0_12px_rgba(163,230,53,0.3)]" },
};

// Crash-proof fallback for any category value the manifest grows that
// isn't yet mapped above — keeps the page rendering instead of throwing
// "Cannot read properties of undefined (reading 'tint')".
const FALLBACK_META = { label: "other", tint: "text-zinc-300", glow: "" };

function nextRunIn(iso: string | null, now: number): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - now;
  if (ms < 0) return "imminent";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.round((ms % 3_600_000) / 60_000);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.round(ms / 86_400_000)}d`;
}

function describeSchedule(expr: string | null): string {
  if (!expr) return "—";
  // Friendly-ify common shapes
  const m: Record<string, string> = {
    "*/5 * * * *": "every 5m",
    "*/10 * * * *": "every 10m",
    "*/15 * * * *": "every 15m",
    "30 * * * *": "xx:30",
    "0 */3 * * *": "every 3h",
    "0 */6 * * *": "every 6h",
  };
  return m[expr] ?? expr;
}

function Sparkline({ values, status }: { values: number[]; status: "success" | "failed" | null }) {
  if (values.length === 0) {
    return <div className="h-6 w-20 rounded bg-zinc-800/50" aria-label="no data" />;
  }
  const max = Math.max(...values, 100);
  const bars = values.slice(-20);
  return (
    <div className="flex h-6 w-20 items-end gap-[1px]" aria-label={`duration history, last ${bars.length} runs`}>
      {bars.map((v, i) => {
        const h = Math.max(2, Math.round((v / max) * 22));
        const isLast = i === bars.length - 1;
        const color = isLast
          ? status === "failed"
            ? "bg-rose-400"
            : "bg-emerald-400"
          : "bg-zinc-600";
        return <span key={i} className={`w-[2px] rounded-sm ${color}`} style={{ height: `${h}px` }} />;
      })}
    </div>
  );
}

function StatusDot({ row }: { row: CronRow }) {
  if (row.mode === "retired") {
    return <span className="inline-block h-2 w-2 rounded-full bg-zinc-500" />;
  }
  if (row.mode === "folded") {
    return <span className="inline-block h-2 w-2 rounded-full bg-indigo-400/50" />;
  }
  if (!row.enabled) {
    return <span className="inline-block h-2 w-2 rounded-full bg-zinc-400" />;
  }
  if (row.lastStatus === "failed") {
    return <span className="inline-block h-2 w-2 rounded-full bg-rose-400 animate-pulse" />;
  }
  if (row.drift !== null && row.drift > 0) {
    return <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" />;
  }
  return <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />;
}

/**
 * v9.1.26 · Per-row countdown that owns its own 1s tick.
 *
 * Previous: the parent CronsPage held a single `tick` state ticked
 * by setInterval(()=>setTick(t=>t+1), 1000). Every tick re-rendered
 * the ENTIRE page (header, filters, all 34+ rows) just to update
 * the "next in Xm" labels. On mobile this was a meaningful CPU
 * burn for a glanceable detail.
 *
 * Now: the countdown is a leaf component with its own setInterval.
 * Only this tiny component re-renders per second, not the whole
 * tree. The parent's tick state is removed entirely.
 */
function NextRunCountdown({ iso }: { iso: string }) {
  const [, force] = useState(0);
  useEffect(() => {
    const i = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, []);
  return <>{nextRunIn(iso, Date.now())}</>;
}

export default function CronsPage() {
  const [categoryFilter, setCategoryFilter] = useState<Category | "all">("all");
  const [showFolded, setShowFolded] = useState(false);
  const [pendingRun, setPendingRun] = useState<Set<string>>(new Set());
  const [pendingToggle, setPendingToggle] = useState<Set<string>>(new Set());
  // v9.1.26 · removed page-level tick state. The 1s countdown re-render
  // moved to per-row <NextRunCountdown /> leaves so the whole page
  // doesn't re-render every second.

  // Phase B.7a · single typed useQuery · 30s refetchInterval mirrors
  // the prior setInterval poll. React Query handles request
  // de-duplication so the AbortController the prior code juggled is no
  // longer needed.
  const utils = trpc.useUtils();
  const cronDeckQuery = trpc.systemAutomation.cronDeck.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const feed: FeedResponse | null =
    (cronDeckQuery.data as FeedResponse | undefined) ?? null;
  const loading = cronDeckQuery.isPending || cronDeckQuery.isFetching;
  const load = () => void cronDeckQuery.refetch();

  const toggleMutation = trpc.systemAutomation.setCronEnabled.useMutation();
  const runMutation = trpc.systemAutomation.runManifestCron.useMutation();

  const rows = useMemo(() => {
    if (!feed) return [] as CronRow[];
    let list = feed.rows;
    if (!showFolded) list = list.filter((r) => r.mode !== "folded" && r.mode !== "retired");
    if (categoryFilter !== "all") list = list.filter((r) => r.category === categoryFilter);
    return list;
  }, [feed, categoryFilter, showFolded]);

  // v10.0.437 · sort key for crons within each category. localStorage-
  // persisted. 6 modes · default = name (alphabetical · stable visual).
  type CronSort = "name" | "success-rate-desc" | "fail-count-desc" | "last-run-newest" | "duration-longest" | "drift-worst";
  const [sortKey, setSortKey] = useState<CronSort>(() => {
    if (typeof window === "undefined") return "name";
    const saved = window.localStorage.getItem("system-crons:sortKey");
    const valid: CronSort[] = ["name", "success-rate-desc", "fail-count-desc", "last-run-newest", "duration-longest", "drift-worst"];
    return saved && valid.includes(saved as CronSort) ? (saved as CronSort) : "name";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("system-crons:sortKey", sortKey);
  }, [sortKey]);

  const grouped = useMemo(() => {
    const g = new Map<Category, CronRow[]>();
    for (const r of rows) {
      if (!g.has(r.category)) g.set(r.category, []);
      g.get(r.category)!.push(r);
    }
    // Apply sort within each category bucket
    for (const [cat, list] of g) {
      const sorted = [...list];
      switch (sortKey) {
        case "success-rate-desc":
          sorted.sort((a, b) => b.successRate - a.successRate);
          break;
        case "fail-count-desc":
          sorted.sort((a, b) => b.fail14d - a.fail14d);
          break;
        case "last-run-newest":
          sorted.sort((a, b) => {
            const at = a.lastRunAt ? new Date(a.lastRunAt).getTime() : 0;
            const bt = b.lastRunAt ? new Date(b.lastRunAt).getTime() : 0;
            return bt - at;
          });
          break;
        case "duration-longest":
          sorted.sort((a, b) => (b.lastRunMs ?? 0) - (a.lastRunMs ?? 0));
          break;
        case "drift-worst":
          sorted.sort((a, b) => (b.drift ?? 0) - (a.drift ?? 0));
          break;
        case "name":
        default:
          sorted.sort((a, b) => a.name.localeCompare(b.name));
          break;
      }
      g.set(cat, sorted);
    }
    return g;
  }, [rows, sortKey]);

  async function toggle(jobName: string, nextEnabled: boolean) {
    setPendingToggle((s) => new Set(s).add(jobName));
    try {
      await toggleMutation.mutateAsync({ jobName, enabled: nextEnabled });
      toast.success(`${jobName} ${nextEnabled ? "enabled" : "killed"}`);
      await utils.system.cronDeck.invalidate();
    } catch (e) {
      toast.error(`toggle failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setPendingToggle((s) => {
        const n = new Set(s);
        n.delete(jobName);
        return n;
      });
    }
  }

  async function runNow(jobName: string) {
    setPendingRun((s) => new Set(s).add(jobName));
    try {
      const result = await runMutation.mutateAsync({ jobName });
      if (result.ok) {
        toast.success(`${jobName} ran · ${result.durationMs}ms`);
      } else {
        toast.error(`${jobName} failed · ${result.error ?? result.status}`);
      }
      await utils.system.cronDeck.invalidate();
    } catch (e) {
      toast.error(`run failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setPendingRun((s) => {
        const n = new Set(s);
        n.delete(jobName);
        return n;
      });
    }
  }

  const summary = feed?.summary;

  return (
    <StandardPage
      eyebrow="NOUR OS · system"
      title="crons"
      description={
        feed
          ? `${summary?.active ?? 0} active · ${summary?.disabled ?? 0} killed · ${summary?.folded ?? 0} folded · ${summary?.runs24h ?? 0} runs/24h · ${summary?.failures24h ?? 0} failures/24h · ${summary?.drifted ?? 0} drifted`
          : "loading…"
      }
      width="2xl"
      rhythm="loose"
      actions={
        <div className="flex items-center gap-2">
          <FreshnessChip
            lastFetchedAt={feed?.generatedAt}
            source="config + db · CronJobLog"
            onReload={load}
          />
          <button
            onClick={load}
            disabled={loading}
            className="rounded-lg border border-[var(--border-hover)] bg-[var(--bg-raised)]/5 px-4 py-2 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-raised)]/10 disabled:opacity-50"
          >
            {loading ? "refreshing…" : "refresh"}
          </button>
        </div>
      }
    >

      <KnowledgeRefreshPanel />

      {/* Summary strip */}
      {summary && (
        <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
          <div className="grid grid-cols-3 gap-3 text-center md:grid-cols-7">
            <SummaryCell label="active"      value={summary.active}      tint="text-emerald-400" />
            <SummaryCell label="killed"      value={summary.disabled}    tint={summary.disabled > 0 ? "text-amber-400" : "text-zinc-500"} />
            <SummaryCell label="folded"      value={summary.folded}      tint="text-indigo-300" />
            <SummaryCell label="retired"     value={summary.retired}     tint="text-zinc-500" />
            <SummaryCell label="runs/24h"    value={summary.runs24h}     tint="text-sky-300" />
            <SummaryCell label="failures/24h" value={summary.failures24h} tint={summary.failures24h > 0 ? "text-rose-400 animate-pulse" : "text-zinc-500"} />
            <SummaryCell label="drifted"     value={summary.drifted}     tint={summary.drifted > 0 ? "text-amber-400 animate-pulse" : "text-zinc-500"} />
          </div>
        </Panel>
      )}

      {/* v8.9 BATCH 53 — Fold-lineage tree. Active vs folded vs
          retired with foldedInto target arrows + headroom counter. */}
      <CronFoldTree />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setCategoryFilter("all")}
          aria-pressed={categoryFilter === "all"}
          aria-label="show all categories"
          className={cn(
            "rounded-full px-3 py-1 text-xs transition focus-visible:ring-1 focus-visible:ring-[var(--gold)] focus-visible:outline-none",
            categoryFilter === "all"
              ? "bg-white/10 text-white"
              : "bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800/60",
          )}
        >
          all
        </button>
        {(Object.keys(CATEGORY_META) as Category[]).map((c) => (
          <button
            key={c}
            onClick={() => setCategoryFilter(c)}
            aria-pressed={categoryFilter === c}
            aria-label={`filter to ${CATEGORY_META[c].label}`}
            className={cn(
              "rounded-full px-3 py-1 text-xs transition focus-visible:ring-1 focus-visible:ring-[var(--gold)] focus-visible:outline-none",
              categoryFilter === c
                ? cn("bg-white/10", CATEGORY_META[c].tint)
                : cn("bg-zinc-900/60 hover:bg-zinc-800/60", "text-zinc-400"),
            )}
          >
            {CATEGORY_META[c].label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-xs text-zinc-400">
          <input
            id="show-folded"
            type="checkbox"
            checked={showFolded}
            onChange={(e) => setShowFolded(e.target.checked)}
            className="h-3.5 w-3.5 rounded"
          />
          <label htmlFor="show-folded" className="cursor-pointer select-none">show folded + retired</label>
          {/* v10.0.437 · sort dropdown · 6 modes within each category */}
          <SortDropdown<CronSort>
            value={sortKey}
            onChange={setSortKey}
            defaultValue="name"
            ariaLabel="Sort crons"
            options={[
              { value: "name", label: "name · A→Z" },
              { value: "success-rate-desc", label: "success rate · highest" },
              { value: "fail-count-desc", label: "fails 14d · most" },
              { value: "last-run-newest", label: "last run · newest" },
              { value: "duration-longest", label: "duration · longest" },
              { value: "drift-worst", label: "drift · worst" },
            ]}
          />
        </div>
      </div>

      {/* Rows grouped by category */}
      <div className="space-y-5">
        {[...grouped.entries()].map(([category, list]) => {
          const groupMeta = CATEGORY_META[category] ?? FALLBACK_META;
          return (
          <section key={category} className="space-y-2">
            <h2 className={cn("text-xs font-semibold uppercase tracking-wider", groupMeta.tint)}>
              {groupMeta.label} · <span className="text-zinc-500 font-normal normal-case">{list.length}</span>
            </h2>
            <div className="space-y-1.5">
              {list.map((row) => (
                <CronRowView
                  key={row.name}
                  row={row}
                  runNow={() => runNow(row.name)}
                  toggle={(v) => toggle(row.name, v)}
                  isRunning={pendingRun.has(row.name)}
                  isToggling={pendingToggle.has(row.name)}
                />
              ))}
            </div>
          </section>
          );
        })}
      </div>

      {feed && (
        <p className="pt-2 text-center text-[10px] text-zinc-600">
          generated {timeAgo(feed.generatedAt)} · auto-refresh 30s · {CRONS_LABEL}
        </p>
      )}
    </StandardPage>
  );
}

const CRONS_LABEL = "source: config/crons.ts · state: BrainMemory(cron_control) + CronJobLog";

function SummaryCell({ label, value, tint }: { label: string; value: number; tint: string }) {
  return (
    <div className="rounded-lg bg-[var(--bg-raised)]/[0.03] p-3">
      <div className={cn("text-2xl font-bold tabular-nums", tint)}>
        <AnimatedCounter value={value} />
      </div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
    </div>
  );
}

function CronRowView({
  row,
  runNow,
  toggle,
  isRunning,
  isToggling,
}: {
  row: CronRow;
  runNow: () => void;
  toggle: (next: boolean) => void;
  isRunning: boolean;
  isToggling: boolean;
}) {
  const meta = CATEGORY_META[row.category] ?? FALLBACK_META;
  const canTrigger = row.mode === "active";
  const durationStr = row.lastRunMs != null ? `${row.lastRunMs}ms` : "—";

  return (
    <div
      className={cn(
        "group grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto] items-center gap-3 rounded-lg border border-zinc-800/50 bg-[var(--bg-raised)]/[0.02] px-3 py-2.5 transition hover:border-zinc-700/60",
        row.mode === "retired" && "opacity-40",
        !row.enabled && row.mode === "active" && "border-amber-500/20 bg-amber-500/[0.02]",
        isRunning && "chat-tool-shimmer",
      )}
    >
      <StatusDot row={row} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn("truncate font-mono text-sm", row.enabled ? "text-zinc-100" : "text-zinc-500 line-through")}>
            {row.name}
          </span>
          <span className={cn("flex-shrink-0 rounded px-1.5 py-[1px] text-[9px] uppercase tracking-wider", meta.tint, "bg-white/[0.04]")}>
            {row.mode === "folded" ? `folded → ${row.foldedInto}` : row.mode === "retired" ? "retired" : meta.label}
          </span>
          {row.drift !== null && row.drift > 0 && (
            <span className="flex-shrink-0 rounded bg-amber-500/10 px-1.5 py-[1px] text-[9px] uppercase tracking-wider text-amber-300">
              drifted {row.drift}m
            </span>
          )}
        </div>
        <div className="truncate text-[11px] text-zinc-500">{row.description}</div>
      </div>

      <div className="hidden md:block text-right">
        <div className="font-mono text-[10px] text-zinc-500">{describeSchedule(row.schedule)}</div>
        {row.nextRunAt && row.enabled && (
          <div className="font-mono text-[10px] tabular-nums text-zinc-400">
            next · <NextRunCountdown iso={row.nextRunAt} />
          </div>
        )}
      </div>

      <div className="hidden md:block text-right">
        <div className="text-[10px] text-zinc-500">last</div>
        <div
          className={cn(
            "font-mono text-[11px]",
            row.lastStatus === "failed" ? "text-rose-300" : "text-zinc-300",
          )}
        >
          {timeAgo(row.lastRunAt)} <span className="text-zinc-500">· {durationStr}</span>
        </div>
      </div>

      <Sparkline values={row.recentDurations} status={row.lastStatus} />

      <div className="hidden sm:block text-right">
        <div className={cn(
          "font-mono text-sm tabular-nums",
          row.successRate >= 95 ? "text-emerald-400" : row.successRate >= 80 ? "text-amber-400" : "text-rose-400",
        )}>
          {row.successRate}%
        </div>
        <div className="text-[9px] uppercase text-zinc-500">14d</div>
      </div>

      <div className="flex items-center gap-1.5">
        {row.mode === "active" && (
          <button
            onClick={() => toggle(!row.enabled)}
            disabled={isToggling}
            aria-label={row.enabled ? `kill cron ${row.name}` : `re-enable cron ${row.name}`}
            className={cn(
              "rounded px-2 py-1 text-[10px] transition focus-visible:ring-1 focus-visible:ring-[var(--gold)] focus-visible:outline-none",
              row.enabled
                ? "bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                : "bg-amber-500/10 text-amber-300 hover:bg-amber-500/20",
              isToggling && "opacity-50",
            )}
            title={row.enabled ? "click to kill this cron" : "click to re-enable"}
          >
            {row.enabled ? "on" : "off"}
          </button>
        )}
        <button
          onClick={runNow}
          disabled={!canTrigger || isRunning}
          aria-label={`run cron ${row.name} now`}
          className={cn(
            "rounded px-2 py-1 text-[10px] transition focus-visible:ring-1 focus-visible:ring-[var(--gold)] focus-visible:outline-none",
            canTrigger
              ? "bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]"
              : "cursor-not-allowed bg-zinc-900/40 text-zinc-600",
            isRunning && "animate-pulse",
          )}
          title={canTrigger ? "trigger this cron now" : "not runnable"}
        >
          {isRunning ? "running…" : "run"}
        </button>
      </div>
    </div>
  );
}
