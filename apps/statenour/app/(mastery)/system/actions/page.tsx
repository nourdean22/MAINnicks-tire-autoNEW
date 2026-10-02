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

import { ConfirmHold } from "@/components/ui/confirm-hold";
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
  if (result === "skipped") return "text-fg-tertiary";
  return "text-amber-400"; // in-flight / unknown
}

function SuccessRing({ rate }: { rate: number }) {
  const color = rate >= 90 ? "text-emerald-400" : rate >= 70 ? "text-amber-400" : "text-rose-400";
  const circumference = 2 * Math.PI * 14;
  const offset = circumference - (rate / 100) * circumference;
  return (
    <div className="relative h-9 w-9">
      <svg className="-rotate-90 transform" viewBox="0 0 32 32" width={36} height={36}>
        <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="3" fill="none" className="text-edge-default" />
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
      <span className={cn("absolute inset-0 flex items-center justify-center font-mono text-[11px] tabular-nums", color)}>
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
  // 2026-09-08 · the autonomous-action queue (rules that deferred with approval="pending")
  // had no UI since the legacy ApprovalsPage went; Home counted it, nothing listed it.
  const autoQueue = trpc.systemAutomation.approvals.useQuery(undefined, { refetchInterval: 5_000 });
  const windowsQuery = trpc.systemAutomation.approvalWindows.useQuery(undefined, { staleTime: 60_000 });
  const decideAuto = trpc.systemAutomation.decideApproval.useMutation({
    onSuccess: () => {
      autoQueue.refetch();
      actionsQuery.refetch();
    },
  });

  const userQuery = trpc.system.getCurrentUser.useQuery();
  const userRole = userQuery.data?.role ?? "operator";

  const approveMutation = trpc.system.approveApprovalRequest.useMutation({
    onSuccess: () => {
      approvalsQuery.refetch();
      actionsQuery.refetch();
    }
  });

  // BDN-205 · Edit verb (agent-inbox HumanInterrupt vocabulary: Accept /
  // EDIT / Respond / Ignore). The server has accepted `editedPayload`
  // since the guardian shipped (approveApprovalRequest input) — the UI
  // never sent it, so "approve with corrected args" meant reject + wait
  // for a re-request. One request is editable at a time; malformed JSON
  // disables the button rather than erroring server-side.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const editParse = (() => {
    if (editingId === null) return { ok: false as const, value: undefined };
    try {
      return { ok: true as const, value: JSON.parse(editText) };
    } catch {
      return { ok: false as const, value: undefined };
    }
  })();

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
            className="rounded-control border border-edge-strong bg-content px-4 py-2 text-xs font-medium text-fg-secondary transition hover:bg-surface-hover disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      }
    >
      {/* Tab Selector */}
      <div className="flex border-b border-edge-subtle mb-6">
        <button
          onClick={() => setActiveTab("logs")}
          className={cn(
            "px-4 py-2.5 text-sm font-medium border-b-2 transition -mb-[2px]",
            activeTab === "logs"
              ? "border-accent text-fg"
              : "border-transparent text-fg-secondary hover:text-fg"
          )}
        >
          Autonomous Log
        </button>
        <button
          onClick={() => setActiveTab("approvals")}
          className={cn(
            "px-4 py-2.5 text-sm font-medium border-b-2 transition -mb-[2px] flex items-center gap-2",
            activeTab === "approvals"
              ? "border-accent text-fg"
              : "border-transparent text-fg-secondary hover:text-fg"
          )}
        >
          Pending Approvals
          {pendingCount > 0 && (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-200 font-mono">
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
                  win === w ? "bg-accent-soft text-fg" : "bg-content text-fg-secondary hover:bg-surface-hover",
                )}
              >
                {w}
              </button>
            ))}
            <span className="text-xs text-fg-tertiary">·</span>
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
                    : "bg-content text-fg-secondary hover:bg-surface-hover",
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
                Clear rule filter: {ruleFilter} ×
              </button>
            )}
          </div>

          {/* Rule leaderboard */}
          <Panel className="border-edge-default">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-fg">rule leaderboard</h2>
              <span className="text-xs text-fg-tertiary">click to filter recent feed</span>
            </div>
            {feed && feed.rules.length === 0 ? (
              <p className="text-xs text-fg-tertiary">
                {loading ? "loading…" : "no autonomous actions in this window"}
              </p>
            ) : (
              <div className="space-y-1">
                {feed?.rules.slice(0, 20).map((r) => (
                  <button
                    key={r.ruleName}
                    onClick={() => setRuleFilter(r.ruleName)}
                    className={cn(
                      "grid w-full grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 rounded-control border border-edge-subtle px-3 py-2 text-left transition hover:border-edge-default hover:bg-surface-hover",
                      ruleFilter === r.ruleName && "border-accent bg-accent-soft",
                    )}
                  >
                    <SuccessRing rate={r.successRate} />
                    <div className="min-w-0">
              <div className="truncate font-mono text-xs text-fg">{r.ruleName}</div>
                      <div className="text-[11px] text-fg-tertiary">
                        Last fired {timeAgo(r.lastFiredAt)}
                      </div>
                    </div>
                    <div className="text-right">
              <div className="font-mono text-sm tabular-nums text-fg"><AnimatedCounter value={r.total} /></div>
                      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">total</div>
                    </div>
                    <div className="hidden text-right sm:block">
                      <div className="font-mono text-xs tabular-nums text-emerald-400"><AnimatedCounter value={r.success} /></div>
                      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">success</div>
                    </div>
                    <div className={cn("text-right", r.failed > 0 ? "" : "opacity-40")}>
                      <div className={cn("font-mono text-xs tabular-nums", r.failed > 0 ? "text-rose-400" : "text-fg-tertiary")}>
                        <AnimatedCounter value={r.failed} />
                      </div>
                      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">failed</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Panel>

          {/* Recent feed */}
          <Panel className="border-edge-default">
            <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-sm font-semibold text-fg">recent · last 100</h2>
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
                <span className="text-xs text-fg-tertiary hidden sm:inline">click to expand payload</span>
              </div>
            </div>
            {feed && feed.recent.length === 0 ? (
              <p className="text-xs text-fg-tertiary">
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
                        "rounded-surface border border-edge-subtle transition hover:border-edge-default",
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
                          a.result === "failed" ? "bg-rose-400" :
                          a.result === "skipped" ? "bg-fg-tertiary" : "bg-amber-400",
                        )} />
                        <span className="rounded-micro bg-surface-interactive px-1.5 py-[1px] text-[11px] text-fg-secondary">
                          {a.approval}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-mono text-xs text-fg">{a.ruleName}</span>
                            <span className="flex-shrink-0 text-[11px] text-fg-tertiary">· {a.actionType}</span>
                            {a.targetType && (
                              <span className="flex-shrink-0 text-[11px] text-fg-tertiary">
                                → {a.targetType}{a.targetId ? ` #${a.targetId.slice(0, 8)}` : ""}
                              </span>
                            )}
                          </div>
                          <div className="truncate text-[11px] text-fg-tertiary">{a.trigger}</div>
                        </div>
                        <span className={cn("font-mono text-[11px] tabular-nums", resultTint(a.result))}>
                          {a.result ?? "—"}
                        </span>
                        <span className="text-[11px] text-fg-tertiary">{timeAgo(a.createdAt)}</span>
                        <span className="text-fg-tertiary">{isOpen ? "▼" : "▸"}</span>
                      </button>
                      {isOpen && (
                        <div className="space-y-2 border-t border-edge-subtle px-3 pb-3 pt-2">
                          {a.error && (
                            <div className="rounded-micro bg-rose-500/10 p-2 text-[11px] text-rose-300">
              <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.12em] text-rose-400/70">error</div>
                              <pre className="overflow-x-auto whitespace-pre-wrap break-words">{a.error}</pre>
                            </div>
                          )}
                          {a.payload !== null && a.payload !== undefined && (
                            <div className="rounded-micro bg-content p-2">
              <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">payload</div>
                              <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-fg-secondary">
                                {JSON.stringify(a.payload, null, 2)}
                              </pre>
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-fg-tertiary">
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
        <Panel className="border-edge-default">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">pending action queue</h2>
            <span className="text-xs text-fg-tertiary">requires owner/operator approval</span>
          </div>

          {/* 2026-09-08 · approval windows — the operator could not find them (they were code constants). */}
          <div className="mb-4 rounded-surface border border-edge-subtle bg-canvas p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-fg">approval windows</h3>
              <span className="text-[11px] font-mono text-fg-tertiary">
                {windowsQuery.data?.source === "env" ? "overridden by APPROVAL_FRESHNESS_DAYS" : "defaults · override with APPROVAL_FRESHNESS_DAYS (JSON)"}
              </span>
            </div>
            {windowsQuery.isError ? (
              <p className="text-xs text-amber-300">windows could not be read.</p>
            ) : !windowsQuery.data ? (
              <p className="text-xs text-fg-tertiary">loading…</p>
            ) : (
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {windowsQuery.data.windows.map((w) => (
                  <li key={w.actionType} className="font-mono text-fg">
                    {w.actionType} · {w.days} d{w.source === "env" ? " (env)" : ""}
                  </li>
                ))}
                <li className="font-mono text-fg-tertiary">anything else · {windowsQuery.data.defaultDays} d</li>
              </ul>
            )}
            <p className="mt-1.5 text-[11px] text-fg-tertiary">
              An approval past its window cannot be approved (the server refuses); it can be rejected, or the rule re-run.
            </p>
          </div>
          {approvals.length === 0 ? (
            <p className="text-xs text-fg-tertiary p-4">
              {loading ? "loading approvals…" : "no pending tool approvals"}
            </p>
          ) : (
            <div className="space-y-4">
              {approvals.map((req: any) => {
                const isCritical = req.riskClass === "critical";
                // 2026-09-07 (D12) · expired authorization: the server refuses approve
                // (CONFLICT); the button says so instead of failing after the tap.
                const isExpired = req.expired === true;
                const needsOwner = isCritical && userRole !== "owner";
                const cannotApprove = needsOwner || isExpired;
                return (
                  <div
                    key={req.id}
                    className={cn(
                      "rounded-surface border p-4 space-y-3 transition",
                      isCritical ? "border-rose-500/30" : "border-edge-subtle"
                    )}
                  >
                    <div className="flex items-start justify-between flex-wrap gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm font-semibold text-fg">
                            {req.toolId}
                          </span>
                          <span className={cn(
                            "rounded-micro px-1.5 py-0.5 text-[11px] font-mono font-medium",
                            isCritical ? "bg-rose-500/20 text-rose-300" :
                            req.riskClass === "high" ? "bg-amber-500/20 text-amber-300" :
                            "bg-sky-500/20 text-sky-300"
                          )}>
                            {req.riskClass} risk
                          </span>
                        </div>
                        <div className="text-xs text-fg-secondary mt-1">
                          Requested by: <span className="font-mono">{req.requestedBy}</span> · reason: {req.reason}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => rejectMutation.mutate({ id: req.id })}
                          disabled={rejectMutation.isPending || approveMutation.isPending}
                          className="rounded-control border border-edge-subtle bg-content px-3 py-1.5 text-xs font-semibold text-fg hover:bg-surface-hover disabled:opacity-50 transition"
                        >
                          Reject
                        </button>
                        <button
                          onClick={() => approveMutation.mutate({ id: req.id })}
                          disabled={cannotApprove || rejectMutation.isPending || approveMutation.isPending}
                          className={cn(
                            "rounded-control px-3 py-1.5 text-xs font-semibold text-black transition disabled:opacity-40",
                            isCritical ? "bg-rose-500 hover:bg-rose-600 disabled:bg-rose-800" : "bg-accent hover:bg-accent-hover"
                          )}
                          title={isExpired ? "Authorization expired — re-request or reject" : needsOwner ? "Requires owner privilege" : undefined}
                        >
                          Approve
                        </button>
                      </div>
                    </div>

                    <div className="rounded-micro bg-content p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">payload parameters</div>
                        <button
                          onClick={() => {
                            if (editingId === req.id) {
                              setEditingId(null);
                            } else {
                              setEditingId(req.id);
                              setEditText(JSON.stringify(req.payload, null, 2));
                            }
                          }}
                          className="min-h-[32px] rounded-control border border-edge-subtle px-2 text-[11px] font-mono text-fg-secondary hover:text-fg hover:bg-surface-hover transition"
                        >
                          {editingId === req.id ? "Cancel edit" : "Edit args"}
                        </button>
                      </div>
                      {editingId === req.id ? (
                        <div className="space-y-2">
                          <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            rows={Math.min(12, editText.split("\n").length + 1)}
                            spellCheck={false}
                            className={cn(
                              "w-full rounded-control border bg-content p-2 text-xs font-mono text-fg focus:outline-none",
                              editParse.ok ? "border-edge-default" : "border-rose-500/50",
                            )}
                            aria-label="edited payload JSON"
                          />
                          <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className={cn("text-[11px] font-mono", editParse.ok ? "text-fg-tertiary" : "text-rose-400")}>
                              {editParse.ok ? "valid JSON — approval executes with THESE args" : "invalid JSON"}
                            </span>
                            <button
                              onClick={() => {
                                if (!editParse.ok) return;
                                approveMutation.mutate({ id: req.id, editedPayload: editParse.value });
                                setEditingId(null);
                              }}
                              disabled={cannotApprove || !editParse.ok || rejectMutation.isPending || approveMutation.isPending}
                              className="rounded-control bg-sky-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-sky-400 disabled:opacity-40 transition"
                              title={isExpired ? "Authorization expired — re-request or reject" : needsOwner ? "Requires owner privilege" : undefined}
                            >
                              Approve edited
                            </button>
                          </div>
                        </div>
                      ) : (
                        <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs text-fg font-mono">
                          {JSON.stringify(req.payload, null, 2)}
                        </pre>
                      )}
                    </div>

                    {isExpired && (
                      <div className="text-xs text-amber-300 flex items-center gap-1.5">
                        <span>⏱</span> Authorization expired{req.expiresAt ? ` ${new Date(req.expiresAt).toLocaleString()}` : ""} — approve is refused. Re-request it against current state, or reject it.
                      </div>
                    )}
                    {needsOwner && (
                      <div className="text-xs text-rose-400 flex items-center gap-1.5">
              Owner privilege is required to approve this critical risk action.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 2026-09-08 · deferred automation (autonomous_actions awaiting a verdict) */}
          <div className="mt-6 border-t border-edge-subtle pt-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-fg">deferred automation</h3>
              <span className="text-xs text-fg-tertiary">
                {autoQueue.data ? `${autoQueue.data.summary.live} live · ${autoQueue.data.summary.expired} expired` : autoQueue.isError ? "read failed — unknown, not zero" : "loading…"}
              </span>
            </div>
            {autoQueue.data && autoQueue.data.rows.length === 0 && (
              <p className="text-xs text-fg-tertiary p-2">no rule is waiting on you.</p>
            )}
            <div className="space-y-3">
              {(autoQueue.data?.rows ?? []).map((row) => (
                <div
                  key={row.id}
                  className={cn(
                    "rounded-surface border p-3 space-y-2",
                    row.expired ? "border-amber-500/30" : "border-edge-subtle",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-fg">{row.ruleName}</p>
                      <p className="text-[11px] font-mono text-fg-tertiary">
                        {row.actionType}
                        {row.targetType ? ` · ${row.targetType}${row.targetId ? ` ${row.targetId}` : ""}` : ""}
                        {" · "}
                        {row.expired
                          ? `expired ${new Date(row.expiresAt).toLocaleString()}`
                          : `expires ${new Date(row.expiresAt).toLocaleString()}`}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => decideAuto.mutate({ id: row.id, decision: "rejected" })}
                        disabled={decideAuto.isPending}
                        className="min-h-[48px] min-w-[48px] rounded-control border border-edge-default px-3 py-1.5 text-xs text-fg hover:border-edge-strong disabled:opacity-40"
                      >
                        Reject
                      </button>
                      {/* Approve REPLAYS the deferred side effect (a message, a write). On the iOS
                          PWA an accidental tap must not do that: press-and-hold, 48px, in-DOM. */}
                      <ConfirmHold
                        label="Approve"
                        variant="gold"
                        disabled={row.expired || decideAuto.isPending}
                        onConfirm={() => decideAuto.mutate({ id: row.id, decision: "approved" })}
                        className="min-h-[48px] min-w-[48px] px-3 text-xs font-semibold"
                      />
                    </div>
                  </div>
                  {row.policyObjective && (
                    <p className="text-[11px] text-fg-secondary">{row.policyObjective}</p>
                  )}
                  {row.payload != null && (
                    <details className="text-[11px]">
              <summary className="cursor-pointer text-fg-tertiary">payload</summary>
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-fg">{JSON.stringify(row.payload, null, 2)}</pre>
                    </details>
                  )}
                  {row.expired && (
                    <p className="text-xs text-amber-300">Authorization expired — approve is refused; reject it or re-run the rule against current state.</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Panel>
      )}

      <p className="pt-2 text-center text-[11px] text-fg-tertiary">
        auto-refresh 30s · source: AutonomousAction / ApprovalRequest
      </p>
    </StandardPage>
  );
}

