"use client";

/**
 * /system/approvals · v10.0.153 · May 03 · Slice B
 *
 * The W11 backlog item the v10.0.148 policy registry was meant to
 * unblock. Lists every AutonomousAction row sitting in approval=
 * "pending" and lets the operator approve/reject one-tap.
 *
 * Each row carries policy hints from /system/policies — objective +
 * declared approval class — so the operator can tell immediately
 * whether the row is here because the rule was DECLARED pending
 * (intentional gate) or whether something legacy slipped through.
 *
 * Per kaizen + JIT: the approve action records sign-off; the side
 * effect is NOT re-executed here today. A future slice will route
 * the side effect through this gate. For now: approve = "I reviewed
 * this, it's intentional"; reject = "flag for postmortem."
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Panel } from "@/components/panel";
import { PageHeader } from "@/components/layout/ui";
// Phase B.7a (2026-05-22) · REST→tRPC system-pages slice · the
// authedFetch read is `trpc.system.approvals.useQuery` and the
// approve/reject POST is `trpc.system.decideApproval.useMutation`.
// The optimistic-remove-from-list behaviour is preserved via local
// `rows`/`summary` state seeded from the query.
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils/cn";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ShieldAlert,
  Bot,
  Clock,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

interface PendingAction {
  id: string;
  ruleName: string;
  trigger: string;
  actionType: string;
  targetType: string | null;
  targetId: string | null;
  payload: unknown;
  result: string | null;
  error: string | null;
  executedAt: string | null;
  createdAt: string;
  policyId: string | null;
  policyApprovalClass: "auto" | "pending" | "forbidden" | null;
  policyObjective: string | null;
}

interface QueueSummary {
  total: number;
  byRule: Array<{ ruleName: string; count: number }>;
  oldestAgeMin: number | null;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function ApprovalsPage() {
  const [rows, setRows] = useState<PendingAction[]>([]);
  const [summary, setSummary] = useState<QueueSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingReject, setConfirmingReject] = useState<string | null>(null);

  // Phase B.7a · the queue read is a typed useQuery; local `rows` /
  // `summary` state mirrors it so the optimistic remove-on-decide still
  // works. A successful decide invalidates the query for a clean
  // re-sync.
  const utils = trpc.useUtils();
  const approvalsQuery = trpc.system.approvals.useQuery();
  const loading = approvalsQuery.isPending || approvalsQuery.isFetching;
  const error = approvalsQuery.error ? approvalsQuery.error.message : null;

  useEffect(() => {
    if (approvalsQuery.data) {
      setRows(approvalsQuery.data.rows as unknown as PendingAction[]);
      setSummary(approvalsQuery.data.summary);
    }
  }, [approvalsQuery.data]);

  const decideMutation = trpc.system.decideApproval.useMutation();

  const decide = useCallback(
    async (id: string, decision: "approved" | "rejected", notes?: string) => {
      setBusyId(id);
      try {
        await decideMutation.mutateAsync({ id, decision, notes });
        toast.success(decision === "approved" ? "Approved" : "Rejected");
        // Optimistic remove from list.
        setRows((prev) => prev.filter((p) => p.id !== id));
        setSummary((prev) =>
          prev ? { ...prev, total: Math.max(0, prev.total - 1) } : prev,
        );
        setConfirmingReject(null);
        await utils.system.approvals.invalidate();
      } catch (e) {
        toast.error(`failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        setBusyId(null);
      }
    },
    [decideMutation, utils],
  );

  return (
    <div className="space-y-4">
      <PageHeader parentHref="/system" parentLabel="system"
        eyebrow="system · governance · approvals"
        title="approval queue"
        description="Pending autonomous actions awaiting operator review · sign off, reject for postmortem, or jump to the policy that declared the gate"
      />

      {/* Top stats */}
      <Panel>
        <div className="grid grid-cols-3 gap-3 p-3">
          <Stat
            label="pending"
            value={summary?.total ?? 0}
            tint={summary && summary.total > 0 ? "text-amber-300" : "text-zinc-400"}
          />
          <Stat
            label="oldest"
            value={
              summary?.oldestAgeMin == null
                ? "—"
                : summary.oldestAgeMin < 60
                  ? `${summary.oldestAgeMin}m`
                  : `${Math.round(summary.oldestAgeMin / 60)}h`
            }
            tint={
              summary?.oldestAgeMin && summary.oldestAgeMin > 60 * 24
                ? "text-rose-400"
                : summary?.oldestAgeMin && summary.oldestAgeMin > 60
                  ? "text-amber-300"
                  : "text-zinc-400"
            }
          />
          <Stat label="rules" value={summary?.byRule.length ?? 0} />
        </div>
        {summary && summary.byRule.length > 0 && (
          <div className="px-3 pb-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[8px] font-mono uppercase tracking-wider text-zinc-600">
              by rule:
            </span>
            {summary.byRule.slice(0, 6).map((r) => (
              <span
                key={r.ruleName}
                className="text-[10px] font-mono px-1.5 py-px rounded bg-zinc-800/60 text-zinc-300"
              >
                {r.ruleName} · {r.count}
              </span>
            ))}
          </div>
        )}
      </Panel>

      {loading && (
        <Panel>
          <div className="flex items-center gap-2 p-4 text-zinc-500 text-[12px]">
            <Loader2 className="animate-spin" size={14} />
            loading queue…
          </div>
        </Panel>
      )}

      {error && (
        <Panel>
          <p className="p-3 text-rose-400 text-[12px]">failed to load: {error}</p>
        </Panel>
      )}

      {!loading && !error && rows.length === 0 && (
        <Panel>
          <div className="p-6 text-center space-y-2">
            <CheckCircle2 size={28} className="mx-auto text-emerald-500/60" />
            <p className="text-[13px] text-zinc-300">queue clear · 0 pending</p>
            <p className="text-[10px] text-zinc-600 font-mono">
              When a policy with approvalClass=&quot;pending&quot; fires, rows land here.
            </p>
          </div>
        </Panel>
      )}

      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((row) => (
            <ActionCard
              key={row.id}
              row={row}
              busy={busyId === row.id}
              confirmingReject={confirmingReject === row.id}
              onApprove={() => decide(row.id, "approved")}
              onReject={() => {
                if (confirmingReject === row.id) {
                  void decide(row.id, "rejected");
                } else {
                  setConfirmingReject(row.id);
                }
              }}
              onCancelReject={() => setConfirmingReject(null)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tint,
}: {
  label: string;
  value: string | number;
  tint?: string;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-[8px] font-mono uppercase tracking-wider text-zinc-600">
        {label}
      </div>
      <div className={cn("text-[18px] font-bold tabular-nums", tint ?? "text-zinc-200")}>
        {value}
      </div>
    </div>
  );
}

function ActionCard({
  row,
  busy,
  confirmingReject,
  onApprove,
  onReject,
  onCancelReject,
}: {
  row: PendingAction;
  busy: boolean;
  confirmingReject: boolean;
  onApprove: () => void;
  onReject: () => void;
  onCancelReject: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const undeclared =
    row.policyId == null || row.policyApprovalClass !== "pending";

  return (
    <Panel>
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Bot
            size={12}
            className={undeclared ? "text-rose-400" : "text-amber-400"}
          />
          <span className="font-mono text-[12px] text-zinc-200">
            {row.ruleName}
          </span>
          {row.actionType && (
            <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-px rounded border border-zinc-700 text-zinc-400">
              {row.actionType}
            </span>
          )}
          {row.targetType && (
            <span className="text-[9px] font-mono text-zinc-500">
              {row.targetType}
              {row.targetId ? `:${row.targetId.slice(0, 12)}` : ""}
            </span>
          )}
          {undeclared && (
            <span
              className="ml-auto inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-rose-300"
              title="No matching AutomationPolicy with approvalClass=pending — slipped through legacy path"
            >
              <AlertTriangle size={10} />
              undeclared
            </span>
          )}
          {!undeclared && (
            <span className="ml-auto inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-amber-300">
              <ShieldAlert size={10} />
              declared
            </span>
          )}
        </div>

        {row.policyObjective && (
          <p className="text-[11px] text-zinc-400 italic border-l-2 border-zinc-800 pl-2">
            {row.policyObjective}
          </p>
        )}

        <div className="flex items-center gap-3 text-[9px] font-mono text-zinc-600">
          <Clock size={10} />
          <span>{timeAgo(row.createdAt)}</span>
          {row.policyId && (
            <Link
              href={`/system/policies?search=${encodeURIComponent(row.policyId)}`}
              className="ml-auto inline-flex items-center gap-0.5 text-blue-400/70 hover:text-blue-300 underline decoration-dotted"
            >
              {row.policyId}
              <ExternalLink size={9} />
            </Link>
          )}
        </div>

        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300 underline decoration-dotted"
        >
          {expanded ? "hide" : "show"} trigger + payload
        </button>

        {expanded && (
          <div className="space-y-1.5 pt-1 border-t border-zinc-800/50">
            <Detail label="trigger" value={row.trigger} />
            {row.error && (
              <Detail
                label="error"
                value={<span className="text-rose-400">{row.error}</span>}
              />
            )}
            {row.payload != null && (
              <Detail
                label="payload"
                value={
                  <pre className="text-[10px] text-zinc-400 font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                    {JSON.stringify(row.payload, null, 2)}
                  </pre>
                }
              />
            )}
          </div>
        )}

        {/* Action row */}
        <div className="flex items-center gap-2 pt-2 border-t border-zinc-800/50">
          <button
            onClick={onApprove}
            disabled={busy}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1 text-[10px] font-medium text-emerald-300 hover:bg-emerald-500/15 transition-all",
              busy && "opacity-50 cursor-not-allowed",
            )}
          >
            {busy ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <CheckCircle2 size={11} />
            )}
            approve
          </button>

          {confirmingReject ? (
            <>
              <span className="text-[10px] text-rose-300 font-mono">confirm reject?</span>
              <button
                onClick={onReject}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-300 hover:bg-rose-500/20"
              >
                yes, reject
              </button>
              <button
                onClick={onCancelReject}
                className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300"
              >
                cancel
              </button>
            </>
          ) : (
            <button
              onClick={onReject}
              disabled={busy}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border border-rose-500/30 px-2.5 py-1 text-[10px] font-medium text-rose-300 hover:bg-rose-500/10 transition-all",
                busy && "opacity-50 cursor-not-allowed",
              )}
            >
              <XCircle size={11} />
              reject
            </button>
          )}
        </div>
      </div>
    </Panel>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-2 text-[11px]">
      <div className="text-[8px] font-mono uppercase tracking-wider text-zinc-600 pt-0.5">
        {label}
      </div>
      <div className="text-zinc-300">{value}</div>
    </div>
  );
}
