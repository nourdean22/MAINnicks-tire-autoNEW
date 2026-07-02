"use client";

/**
 * CronControlPanel — Settings surface for kill-switching every
 * scheduled cron + firing any cron manually. Data lives in
 * BrainMemory (category="cron_control") so no schema change.
 *
 * Layout: one row per cron with:
 *   • Job name + schedule ("0 9 * * *" rendered human-friendly)
 *   • Last success + last fail pills (14d window)
 *   • ok/fail count sparkline (numeric, not a chart — cheap)
 *   • Toggle switch (green=on, dim=off)
 *   • Play button (manual trigger — shows spinner + toast on return)
 *
 * Filters: search + show-disabled-only toggle. Groups by schedule
 * cadence (hourly / every-N-h / daily / weekly / mega-fanout) so
 * Nour can find a knob fast.
 */

import { useCallback, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/ui/glass-card";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { Play, Loader2, Clock, CheckCircle2, XCircle, Power, Search } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { relativeTimeMinutes as timeAgo } from "@/lib/utils/datetime";

// CronRow shape is inferred from the system.cronCatalog procedure
// return type — kept as a type alias only for the local helpers'
// signatures (Phase UU.2 · REST→tRPC).
type CronRow = {
  jobName: string;
  path: string;
  schedule: string;
  enabled: boolean;
  note: string | null;
  controlUpdatedAt: string | null;
  lastSuccessAt: string | null;
  lastFailAt: string | null;
  success14d: number;
  fail14d: number;
};

const CRON_RUNBOOKS: Record<string, string> = {
  "embed-backfill": "hf-embeddings-cutover.md",
  "mega": "statenour-current-truth.md",
  "mega-evening": "statenour-current-truth.md",
  "dossier-autodraft": "action-honesty-and-receipts.md",
  "nick-action-proposal": "action-honesty-and-receipts.md",
  "nick-action-execute": "action-honesty-and-receipts.md",
  "data-cleanup": "statenour-migrations-and-deploys.md",
  "stale-tasks": "stale-doc-cleanup.md",
  "goal-drift-detector": "task-classifier-domain-missions.md",
  "conversation-mission-link": "task-classifier-domain-missions.md",
  "mastery-xp": "memory-evals.md",
};

// Human-readable cron schedule (covers the vercel.json patterns this
// project actually uses; falls back to the raw expression otherwise).
function describeSchedule(expr: string): string {
  if (expr === "(mega fanout)") return "via mega cron fan-out";
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, , dow] = parts;
  if (min.startsWith("*/")) return `every ${min.slice(2)}min`;
  if (hour === "*") return "every hour";
  if (hour.startsWith("*/")) return `every ${hour.slice(2)}h`;
  if (dow && dow !== "*") {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const parsed = dow.split(",").map((d) => days[parseInt(d, 10)] ?? d).join("/");
    return `${hour}:${min.padStart(2, "0")} ${parsed}`;
  }
  if (hour.includes(",")) return `${hour}h daily`;
  if (dom === "*") return `${hour}:${min.padStart(2, "0")} daily`;
  return expr;
}

// Group crons into cadence buckets so the panel is scannable.
function cadenceBucket(expr: string): string {
  if (expr === "(mega fanout)") return "mega fanout";
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return "other";
  const [min, hour, , , dow] = parts;
  if (min.startsWith("*/")) return "sub-hourly";
  if (hour === "*") return "hourly";
  if (hour.startsWith("*/")) return "every N hours";
  if (dow && dow !== "*") return "weekly";
  return "daily";
}

export function CronControlPanel() {
  const [filter, setFilter] = useState("");
  const [showDisabledOnly, setShowDisabledOnly] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [firing, setFiring] = useState<string | null>(null);

  // Phase UU.2 (2026-05-22) · REST→tRPC · the catalog is a typed query
  // (system.cronCatalog). The legacy route wrapped the row array in
  // `{ data }`; the procedure returns the array directly. loadedAt is
  // derived from React Query's dataUpdatedAt so the FreshnessChip stays
  // accurate. load()/refresh repoint to refetch.
  const utils = trpc.useUtils();
  const catalogQuery = trpc.systemAutomation.cronCatalog.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const rows: CronRow[] | null = catalogQuery.data ?? null;
  const loading = catalogQuery.isPending;
  const loadedAt = catalogQuery.dataUpdatedAt || null;
  const error = catalogQuery.error
    ? catalogQuery.error.message || "fetch failed"
    : null;
  const load = useCallback(() => void catalogQuery.refetch(), [catalogQuery]);

  // Phase UU.2 · kill-switch toggle + manual trigger are typed
  // mutations. setCronEnabled is jobName-keyed (the NN mutation, reused
  // here); triggerCron is path-keyed (new in UU.2, maps the panel's
  // existing trigger(path, jobName) signature 1:1).
  const setCronEnabledMutation = trpc.systemAutomation.setCronEnabled.useMutation();
  const triggerCronMutation = trpc.systemAutomation.triggerCron.useMutation();

  const toggle = useCallback(
    async (jobName: string, nextEnabled: boolean) => {
      setToggling(jobName);
      // Optimistic — patch the React Query cache so the switch flips
      // instantly, exactly as the prior setRows optimistic update did.
      utils.system.cronCatalog.setData(undefined, (prev) =>
        prev?.map((r) =>
          r.jobName === jobName ? { ...r, enabled: nextEnabled } : r,
        ),
      );
      try {
        await setCronEnabledMutation.mutateAsync({
          jobName,
          enabled: nextEnabled,
        });
        toast.success(`${jobName} ${nextEnabled ? "enabled" : "disabled"}`);
      } catch (e) {
        // Revert the optimistic patch.
        utils.system.cronCatalog.setData(undefined, (prev) =>
          prev?.map((r) =>
            r.jobName === jobName ? { ...r, enabled: !nextEnabled } : r,
          ),
        );
        toast.error(`toggle failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        setToggling(null);
      }
    },
    [utils, setCronEnabledMutation],
  );

  const trigger = useCallback(
    async (path: string, jobName: string) => {
      setFiring(jobName);
      try {
        const r = await triggerCronMutation.mutateAsync({ path });
        if (r?.ok) {
          toast.success(`${jobName} → ${r.status} (${r.durationMs}ms)`);
          // Reload stats so last-success flips fresh
          void catalogQuery.refetch();
        } else {
          toast.error(`${jobName} failed: ${r?.status ?? "?"}`);
        }
      } catch (e) {
        toast.error(`trigger failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        setFiring(null);
      }
    },
    [triggerCronMutation, catalogQuery],
  );

  const visible = useMemo(() => {
    if (!rows) return [] as CronRow[];
    const q = filter.trim().toLowerCase();
    return rows.filter((r) => {
      if (showDisabledOnly && r.enabled) return false;
      if (q && !r.jobName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, filter, showDisabledOnly]);

  const grouped = useMemo(() => {
    const buckets: Record<string, CronRow[]> = {};
    for (const r of visible) {
      const b = cadenceBucket(r.schedule);
      (buckets[b] ??= []).push(r);
    }
    // Sort buckets by preferred order
    const ORDER = ["sub-hourly", "hourly", "every N hours", "daily", "weekly", "mega fanout", "other"];
    return ORDER.filter((b) => buckets[b]?.length).map((b) => ({ bucket: b, rows: buckets[b] }));
  }, [visible]);

  const killedCount = rows?.filter((r) => !r.enabled).length ?? 0;
  const totalCount = rows?.length ?? 0;

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="section-label">Cron Control</p>
            <FreshnessChip lastFetchedAt={loadedAt} source="crons" compact onReload={() => void load()} />
          </div>
          <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
            {totalCount} scheduled · {killedCount} killed · kill switches survive restarts
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--gold)] transition-colors"
          title="refresh stats"
        >
          refresh
        </button>
      </div>

      {/* Filter + toggle */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 relative">
          <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input
            type="text"
            placeholder="filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full pl-7 pr-2 py-1.5 bg-[var(--bg-base)] border border-[var(--border-default)] rounded text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--gold)]/30"
          />
        </div>
        <button
          onClick={() => setShowDisabledOnly((v) => !v)}
          aria-pressed={showDisabledOnly}
          className={cn(
            "px-2 py-1.5 text-[9px] font-mono uppercase tracking-wider rounded border transition-colors",
            showDisabledOnly
              ? "bg-red-500/10 border-red-500/30 text-red-400"
              : "border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]",
          )}
        >
          disabled only
        </button>
      </div>

      {loading && !rows && (
        <div className="flex items-center gap-2 py-6 justify-center text-[11px] text-[var(--text-tertiary)]">
          <Loader2 size={12} className="animate-spin" />
          loading crons…
        </div>
      )}

      {error && (
        <div className="text-[11px] text-red-400 py-2">failed to load: {error}</div>
      )}

      {/* Grouped list */}
      <div className="space-y-4">
        {grouped.map(({ bucket, rows: bucketRows }) => (
          <div key={bucket}>
            <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[var(--text-tertiary)] mb-1.5">
              {bucket}
            </p>
            <div className="space-y-1">
              {bucketRows.map((r) => (
                <div
                  key={r.jobName}
                  className={cn(
                    "group flex items-center gap-2 px-2 py-1.5 rounded border transition-colors",
                    r.enabled
                      ? "bg-[var(--bg-base)] border-[var(--border-default)]"
                      : "bg-red-500/5 border-red-500/20",
                  )}
                >
                  {/* Enabled dot */}
                  <span
                    className={cn(
                      "w-1.5 h-1.5 rounded-full shrink-0",
                      r.enabled
                        ? r.fail14d > r.success14d
                          ? "bg-amber-400 animate-pulse"
                          : "bg-emerald-400"
                        : "bg-red-400",
                    )}
                    title={
                      r.enabled
                        ? r.fail14d > r.success14d
                          ? "enabled but failing"
                          : "enabled + healthy"
                        : "killed"
                    }
                  />

                  {/* Name + schedule */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 w-full">
                      <span className="text-[11px] font-mono text-[var(--text-primary)] truncate">
                        {r.jobName}
                      </span>
                      <span className="text-[9px] font-mono text-[var(--text-tertiary)] shrink-0">
                        {describeSchedule(r.schedule)}
                      </span>
                      <a
                        href={
                          CRON_RUNBOOKS[r.jobName]
                            ? `https://github.com/nourdean22/MAINnicks-tire-autoNEW/blob/main/apps/statenour/docs/runbooks/${CRON_RUNBOOKS[r.jobName]}`
                            : `https://github.com/nourdean22/MAINnicks-tire-autoNEW/blob/main/apps/statenour/docs/RUNBOOK.md#cron-catalog`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[9px] font-mono text-[var(--gold)]/60 hover:text-[var(--gold)] hover:underline shrink-0 ml-auto mr-1"
                        title="view runbook"
                      >
                        [runbook]
                      </a>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[9px] font-mono text-[var(--text-tertiary)]">
                      <span className="inline-flex items-center gap-0.5">
                        <CheckCircle2 size={8} className="text-emerald-400" />
                        {r.success14d} · {timeAgo(r.lastSuccessAt)}
                      </span>
                      <span className="inline-flex items-center gap-0.5">
                        <XCircle size={8} className={r.fail14d > 0 ? "text-red-400" : "text-[var(--text-tertiary)]"} />
                        {r.fail14d}
                      </span>
                      {!r.enabled && r.controlUpdatedAt && (
                        <span className="inline-flex items-center gap-0.5 text-red-400">
                          <Clock size={8} />
                          killed {timeAgo(r.controlUpdatedAt)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Fire button */}
                  <button
                    onClick={() => trigger(r.path, r.jobName)}
                    disabled={firing !== null}
                    title={`fire ${r.path}`}
                    aria-label={`fire ${r.jobName} now`}
                    className={cn(
                      "w-6 h-6 rounded flex items-center justify-center border transition-colors shrink-0",
                      "border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:border-[var(--gold)]/30",
                      firing !== null && "opacity-50 cursor-wait",
                    )}
                  >
                    {firing === r.jobName ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
                  </button>

                  {/* Kill switch */}
                  <button
                    onClick={() => toggle(r.jobName, !r.enabled)}
                    disabled={toggling !== null || firing !== null}
                    role="switch"
                    aria-checked={r.enabled}
                    aria-label={`${r.jobName} cron ${r.enabled ? "enabled" : "disabled"}`}
                    title={r.enabled ? "click to kill" : "click to enable"}
                    className={cn(
                      "shrink-0 h-5 w-9 rounded-full border relative transition-colors",
                      r.enabled
                        ? "bg-emerald-500/20 border-emerald-500/40"
                        : "bg-red-500/10 border-red-500/30",
                      (toggling === r.jobName || firing !== null) && "opacity-50",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all",
                        r.enabled
                          ? "left-[19px] bg-emerald-400"
                          : "left-0.5 bg-red-400",
                      )}
                    />
                    <Power
                      size={7}
                      aria-hidden
                      className={cn(
                        "absolute top-1/2 -translate-y-1/2",
                        r.enabled ? "left-1 text-emerald-400/70" : "right-1 text-red-400/70",
                      )}
                    />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}

        {rows && visible.length === 0 && (
          <div className="text-[11px] text-[var(--text-tertiary)] text-center py-6">
            no crons match the filter
          </div>
        )}
      </div>

      <p className="text-[9px] text-[var(--text-tertiary)] mt-3 leading-relaxed">
        Kill switches store in BrainMemory (category: cron_control). Disabled
        crons short-circuit inside <code className="text-[var(--gold)]/70">cronHandler</code> — they
        return <code className="text-[var(--gold)]/70">{'{'}skipped:true{'}'}</code> and
        stay out of the cron-job log. Manual triggers fire with the same
        CRON_SECRET the scheduler uses.
      </p>
    </GlassCard>
  );
}
