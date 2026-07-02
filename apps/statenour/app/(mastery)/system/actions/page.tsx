"use client";

/**
 * /system/actions — Nick's autonomous action audit trail.
 *
 * v11.0 (W2.5). Every row in AutonomousAction. Shows rule leaderboard
 * + individual recent actions. Click a rule chip to filter.
 *
 * Controls:
 *   · window pills (24h · 7d · 30d)
 *   · approval filter (auto/pending/approved/rejected)
 *   · rule filter (click a rule row)
 *   · recent feed with expand-to-see-payload
 *
 * Alive elements:
 *   · success-rate ring per rule (green/amber/red)
 *   · pending actions pulse (count on page title)
 *   · last-fired time-ago tick every 30s
 */

import { useState, useEffect } from "react";
import { Panel } from "@/components/panel";
import { StandardPage } from "@/components/layout/standard-page";
import { SortDropdown } from "@/components/ui/sort-dropdown";
import { cn } from "@/lib/utils/cn";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { FreshnessChip } from "@/components/ui/freshness-chip";

// Phase B.7a (2026-05-22) · REST→tRPC system-pages slice · the
// authedFetch read is now `trpc.system.autonomousActions.useQuery`.
// React Query keys on the input object, so changing the window /
// rule / approval filter refetches without a manual `load()` — the
// AbortController the prior code juggled is React Query's job now.
// The 30s `cache:"no-store"` poll maps to `refetchInterval`.
import { trpc } from "@/lib/trpc/client";
import { relativeTimeSeconds as timeAgo } from "@/lib/utils/datetime";

interface RuleRow {
  ruleName: string;
  total: number;
  success: number;
  failed: number;
  skipped: number;
  lastFiredAt: string | null;
  successRate: number;
}

interface ActionRow {
  id: string;
  ruleName: string;
  trigger: string;
  actionType: string;
  targetType: string | null;
  targetId: string | null;
  payload: unknown;
  approval: string;
  approvedBy: string | null;
  executedAt: string | null;
  result: string | null;
  error: string | null;
  createdAt: string;
}

interface Feed {
  recent: ActionRow[];
  rules: RuleRow[];
  approvalBreakdown: { auto: number; pending: number; approved: number; rejected: number };
  totalInWindow: number;
  generatedAt: string;
}

type Win = "24h" | "7d" | "30d";

function resultTint(result: string | null): string {
  if (result === "success") return "text-emerald-400";
  if (result === "failed") return "text-rose-400";
  if (result === "skipped") return "text-zinc-500";
  return "text-amber-400"; // in-flight / unknown
}

function SuccessRing({ rate }: { rate: number }) {
  const color = rate >= 90 ? "text-emerald-400" : rate >= 70 ? "text-amber-400" : "text-rose-400";
  const circumference = 2 * Math.PI * 14;
  const offset = circumference - (rate / 100) * circumference;
  return (
    <div className="relative h-9 w-9">
      <svg className="-rotate-90 transform" viewBox="0 0 32 32" width={36} height={36}>
        <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="3" fill="none" className="text-zinc-800" />
        <circle
          cx="16"
          cy="16"
          r="14"
          stroke="currentColor"
          strokeWidth="3"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={color}
        />
      </svg>
      <span className={cn("absolute inset-0 flex items-center justify-center font-mono text-[9px] tabular-nums", color)}>
        {rate}
      </span>
    </div>
  );
}

export default function ActionsPage() {
  const [activeTab, setActiveTab] = useState<"logs" | "approvals">("logs");
  const [win, setWin] = useState<Win>("7d");
  const [ruleFilter, setRuleFilter] = useState<string | null>(null);
  const [approvalFilter, setApprovalFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  
  type ActionSort = "newest" | "oldest" | "rule-alpha" | "approval-pending-first" | "errors-first";
  const [sortKey, setSortKey] = useState<ActionSort>(() => {
    if (typeof window === "undefined") return "newest";
    const saved = window.localStorage.getItem("system-actions:sortKey");
    const valid: ActionSort[] = ["newest", "oldest", "rule-alpha", "approval-pending-first", "errors-first"];
    return saved && valid.includes(saved as ActionSort) ? (saved as ActionSort) : "newest";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("system-actions:sortKey", sortKey);
  }, [sortKey]);

  const actionsQuery = trpc.system.autonomousActions.useQuery(
    {
      since: win,
      ...(ruleFilter ? { rule: ruleFilter } : {}),
      ...(approvalFilter
        ? {
            approval: approvalFilter as
              | "auto"
              | "pending"
              | "approved"
              | "rejected",
          }
        : {}),
    },
    { refetchInterval: 30_000 },
  );

  const approvalsQuery = trpc.systemAutomation.getPendingApprovals.useQuery(undefined, {
    refetchInterval: 5_000,
  });

  const userQuery = trpc.system.getCurrentUser.useQuery();
  const userRole = userQuery.data?.role ?? "operator";

  const approveMutation = trpc.system.approveApprovalRequest.useMutation({
    onSuccess: () => {
      approvalsQuery.refetch();
      actionsQuery.refetch();
    }
  });

  const rejectMutation = trpc.system.rejectApprovalRequest.useMutation({
    onSuccess: () => {
      approvalsQuery.refetch();
      actionsQuery.refetch();
    }
  });

  const feed: Feed | null = (actionsQuery.data as Feed | undefined) ?? null;
  const approvals = (approvalsQuery.data as any) ?? [];
  const loading = actionsQuery.isPending || actionsQuery.isFetching || approvalsQuery.isPending || approvalsQuery.isFetching;

  const load = () => {
    actionsQuery.refetch();
    approvalsQuery.refetch();
  };

  const toggleExpand = (id: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const pendingCount = approvals.length;

  return (
    <StandardPage
      eyebrow="NOUR OS · System"
      title="Actions"
      description={
        feed
          ? `${feed.totalInWindow} in window · ${feed.rules.length} unique rules${pendingCount > 0 ? ` · ${pendingCount} pending approval` : ""}`
          : "loading…"
      }
      width="2xl"
      rhythm="loose"
      actions={
        <div className="flex items-center gap-2">
          <FreshnessChip
            lastFetchedAt={feed?.generatedAt}
            source="db · AutonomousAction"
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
      {/* Tab Selector */}
      <div className="flex border-b border-zinc-800/80 mb-6">
        <button
          onClick={() => setActiveTab("logs")}
          className={cn(
            "px-4 py-2.5 text-sm font-medium border-b-2 transition -mb-[2px]",
            activeTab === "logs"
              ? "border-[var(--gold)] text-[var(--gold)]"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          )}
        >
          Autonomous Log
        </button>
        <button
          onClick={() => setActiveTab("approvals")}
          className={cn(
            "px-4 py-2.5 text-sm font-medium border-b-2 transition -mb-[2px] flex items-center gap-2",
            activeTab === "approvals"
              ? "border-[var(--gold)] text-[var(--gold)]"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          )}
        >
          Pending Approvals
          {pendingCount > 0 && (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-200 font-mono animate-pulse">
              {pendingCount}
            </span>
          )}
        </button>
      </div>

      {activeTab === "logs" ? (
        <>
          {/* Filter strip */}
          <div className="flex flex-wrap items-center gap-2">
            {(["24h", "7d", "30d"] as Win[]).map((w) => (
              <button
                key={w}
                onClick={() => setWin(w)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs transition",
                  win === w ? "bg-[var(--gold)]/15 text-[var(--gold)]" : "bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800/60",
                )}
              >
                {w}
              </button>
            ))}
            <span className="text-xs text-zinc-600">·</span>
            {(["auto", "pending", "approved", "rejected"] as const).map((a) => (
              <button
                key={a}
                onClick={() => setApprovalFilter(approvalFilter === a ? null : a)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs transition",
                  approvalFilter === a
                    ? a === "pending"
                      ? "bg-amber-500/20 text-amber-200"
                      : a === "rejected"
                        ? "bg-rose-500/20 text-rose-200"
                        : "bg-sky-500/20 text-sky-200"
                    : "bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800/60",
                )}
              >
                {a} · <AnimatedCounter value={feed?.approvalBreakdown[a] ?? 0} />
              </button>
            ))}
            {ruleFilter && (
              <button
                onClick={() => setRuleFilter(null)}
                className="ml-auto rounded-full bg-rose-500/10 px-3 py-1 text-xs text-rose-300 hover:bg-rose-500/20"
              >
                clear rule filter: {ruleFilter} ×
              </button>
            )}
          </div>

          {/* Rule leaderboard */}
          <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">rule leaderboard</h2>
              <span className="text-xs text-[var(--text-tertiary)]">click to filter recent feed</span>
            </div>
            {feed && feed.rules.length === 0 ? (
              <p className="text-xs text-zinc-500">
                {loading ? "loading…" : "no autonomous actions in this window"}
              </p>
            ) : (
              <div className="space-y-1">
                {feed?.rules.slice(0, 20).map((r) => (
                  <button
                    key={r.ruleName}
                    onClick={() => setRuleFilter(r.ruleName)}
                    className={cn(
                      "grid w-full grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 rounded-lg border border-zinc-800/40 bg-[var(--bg-raised)]/[0.02] px-3 py-2 text-left transition hover:border-zinc-700/60 hover:bg-white/[0.03]",
                      ruleFilter === r.ruleName && "border-[var(--gold)]/40 bg-[var(--gold)]/[0.04]",
                    )}
                  >
                    <SuccessRing rate={r.successRate} />
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs text-zinc-200">{r.ruleName}</div>
                      <div className="text-[10px] text-zinc-500">
                        last fired {timeAgo(r.lastFiredAt)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm tabular-nums text-zinc-100"><AnimatedCounter value={r.total} /></div>
                      <div className="text-[10px] uppercase text-zinc-500">total</div>
                    </div>
                    <div className="hidden text-right sm:block">
                      <div className="font-mono text-xs tabular-nums text-emerald-400"><AnimatedCounter value={r.success} /></div>
                      <div className="text-[10px] uppercase text-zinc-500">success</div>
                    </div>
                    <div className={cn("text-right", r.failed > 0 ? "" : "opacity-40")}>
                      <div className={cn("font-mono text-xs tabular-nums", r.failed > 0 ? "text-rose-400" : "text-zinc-600")}>
                        <AnimatedCounter value={r.failed} />
                      </div>
                      <div className="text-[10px] uppercase text-zinc-500">failed</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Panel>

          {/* Recent feed */}
          <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
            <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-sm font-semibold text-white">recent · last 100</h2>
              <div className="flex items-center gap-2">
                <SortDropdown<ActionSort>
                  value={sortKey}
                  onChange={setSortKey}
                  defaultValue="newest"
                  ariaLabel="Sort actions"
                  options={[
                    { value: "newest", label: "newest first" },
                    { value: "oldest", label: "oldest first" },
                    { value: "rule-alpha", label: "rule · A→Z" },
                    { value: "approval-pending-first", label: "approval · pending first" },
                    { value: "errors-first", label: "errors first" },
                  ]}
                />
                <span className="text-xs text-[var(--text-tertiary)] hidden sm:inline">click to expand payload</span>
              </div>
            </div>
            {feed && feed.recent.length === 0 ? (
              <p className="text-xs text-zinc-500">
                {loading ? "loading…" : "nothing matches the filters"}
              </p>
            ) : (
              <div className="space-y-1">
                {[...(feed?.recent ?? [])].sort((a, b) => {
                  switch (sortKey) {
                    case "oldest":
                      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
                    case "rule-alpha":
                      return a.ruleName.localeCompare(b.ruleName);
                    case "approval-pending-first": {
                      const pa = a.approval === "pending" ? 0 : 1;
                      const pb = b.approval === "pending" ? 0 : 1;
                      if (pa !== pb) return pa - pb;
                      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                    }
                    case "errors-first": {
                      const ea = a.error ? 0 : 1;
                      const eb = b.error ? 0 : 1;
                      if (ea !== eb) return ea - eb;
                      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                    }
                    case "newest":
                    default:
                      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                  }
                }).map((a) => {
                  const isOpen = expanded.has(a.id);
                  const fresh = Date.now() - new Date(a.createdAt).getTime() < 120_000;
                  return (
                    <div
                      key={a.id}
                      className={cn(
                        "rounded-lg border border-zinc-800/40 bg-[var(--bg-raised)]/[0.02] transition hover:border-zinc-700/60",
                        a.approval === "pending" && "border-amber-500/30 bg-amber-500/[0.02]",
                        fresh && "border-emerald-500/30",
                      )}
                    >
                      <button
                        onClick={() => toggleExpand(a.id)}
                        className="grid w-full grid-cols-[auto_auto_1fr_auto_auto_auto] items-center gap-3 px-3 py-2 text-left"
                      >
                        <span className={cn(
                          "inline-block h-2 w-2 rounded-full",
                          a.result === "success" ? "bg-emerald-400" :
                          a.result === "failed" ? "bg-rose-400 animate-pulse" :
                          a.result === "skipped" ? "bg-zinc-500" : "bg-amber-400",
                          fresh && "animate-pulse",
                        )} />
                        <span className="rounded bg-white/[0.04] px-1.5 py-[1px] text-[9px] uppercase tracking-wider text-zinc-400">
                          {a.approval}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-mono text-xs text-zinc-200">{a.ruleName}</span>
                            <span className="flex-shrink-0 text-[10px] text-zinc-500">· {a.actionType}</span>
                            {a.targetType && (
                              <span className="flex-shrink-0 text-[10px] text-zinc-600">
                                → {a.targetType}{a.targetId ? ` #${a.targetId.slice(0, 8)}` : ""}
                              </span>
                            )}
                          </div>
                          <div className="truncate text-[10px] text-zinc-500">{a.trigger}</div>
                        </div>
                        <span className={cn("font-mono text-[10px] tabular-nums", resultTint(a.result))}>
                          {a.result ?? "—"}
                        </span>
                        <span className="text-[10px] text-zinc-500">{timeAgo(a.createdAt)}</span>
                        <span className="text-zinc-600">{isOpen ? "▼" : "▸"}</span>
                      </button>
                      {isOpen && (
                        <div className="space-y-2 border-t border-white/5 px-3 pb-3 pt-2">
                          {a.error && (
                            <div className="rounded bg-rose-500/10 p-2 text-[11px] text-rose-300">
                              <div className="mb-1 text-[9px] uppercase tracking-wider text-rose-400/70">error</div>
                              <pre className="overflow-x-auto whitespace-pre-wrap break-words">{a.error}</pre>
                            </div>
                          )}
                          {a.payload !== null && a.payload !== undefined && (
                            <div className="rounded bg-black/30 p-2">
                              <div className="mb-1 text-[9px] uppercase tracking-wider text-zinc-500">payload</div>
                              <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[10px] text-zinc-400">
                                {JSON.stringify(a.payload, null, 2)}
                              </pre>
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-zinc-500">
                            <div>createdAt: {a.createdAt}</div>
                            <div>executedAt: {a.executedAt ?? "—"}</div>
                            <div>approvedBy: {a.approvedBy ?? "—"}</div>
                            <div>id: {a.id}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </>
      ) : (
        <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">pending action queue</h2>
            <span className="text-xs text-[var(--text-tertiary)]">requires owner/operator approval</span>
          </div>
          {approvals.length === 0 ? (
            <p className="text-xs text-zinc-500 p-4">
              {loading ? "loading approvals…" : "no pending tool approvals"}
            </p>
          ) : (
            <div className="space-y-4">
              {approvals.map((req: any) => {
                const isCritical = req.riskClass === "critical";
                const cannotApprove = isCritical && userRole !== "owner";
                return (
                  <div
                    key={req.id}
                    className={cn(
                      "rounded-lg border bg-[var(--bg-raised)]/[0.02] p-4 space-y-3 transition",
                      isCritical ? "border-rose-500/30" : "border-zinc-800/60"
                    )}
                  >
                    <div className="flex items-start justify-between flex-wrap gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-semibold text-zinc-200">
                            {req.toolId}
                          </span>
                          <span className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-mono font-medium uppercase tracking-wider",
                            isCritical ? "bg-rose-500/20 text-rose-300 animate-pulse" :
                            req.riskClass === "high" ? "bg-amber-500/20 text-amber-300" :
                            "bg-sky-500/20 text-sky-300"
                          )}>
                            {req.riskClass} risk
                          </span>
                        </div>
                        <div className="text-xs text-zinc-400 mt-1">
                          Requested by: <span className="font-mono">{req.requestedBy}</span> · reason: {req.reason}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => rejectMutation.mutate({ id: req.id })}
                          disabled={rejectMutation.isPending || approveMutation.isPending}
                          className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 transition"
                        >
                          Reject
                        </button>
                        <button
                          onClick={() => approveMutation.mutate({ id: req.id })}
                          disabled={cannotApprove || rejectMutation.isPending || approveMutation.isPending}
                          className={cn(
                            "rounded-lg px-3 py-1.5 text-xs font-semibold text-black transition disabled:opacity-40",
                            isCritical ? "bg-rose-500 hover:bg-rose-600 disabled:bg-rose-800" : "bg-[var(--gold)] hover:bg-[var(--gold)]/80"
                          )}
                          title={cannotApprove ? "Requires owner privilege" : undefined}
                        >
                          Approve
                        </button>
                      </div>
                    </div>

                    <div className="rounded bg-black/40 p-3 space-y-1">
                      <div className="text-[10px] uppercase tracking-wider text-zinc-500">payload parameters</div>
                      <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs text-zinc-300 font-mono">
                        {JSON.stringify(req.payload, null, 2)}
                      </pre>
                    </div>

                    {cannotApprove && (
                      <div className="text-xs text-rose-400 flex items-center gap-1.5">
                        <span>⚠️</span> Owner privilege is required to approve this critical risk action.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      )}

      <p className="pt-2 text-center text-[10px] text-zinc-600">
        auto-refresh 30s · source: AutonomousAction / ApprovalRequest
      </p>
    </StandardPage>
  );
}

