/**
 * ApprovalsSection — the generic approval queue (trust ladder).
 *
 * Everything AI- or one-tap-originated lands here as a DRAFT and executes only
 * after a human approves it. The gate is backend-enforced (services/
 * proposals.ts CAS chain) — this screen is a window onto it, not the lock.
 *
 * Truth rules (adminTruth doctrine): a failed read renders as an error state,
 * never as an empty queue; approve/reject are two-tap via confirmDialog
 * (iOS-PWA-safe — window.confirm is silently suppressed in standalone mode).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import { PageHeader, LoadingState, ErrorState } from "./shared";
import {
  Bot,
  CheckCircle2,
  ClipboardList,
  Clock,
  PhoneCall,
  RefreshCw,
  ShieldCheck,
  User,
  XCircle,
} from "lucide-react";

type StatusFilter = "needs_decision" | "executed" | "rejected" | "failed" | "all";

const FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: "needs_decision", label: "Needs decision" },
  { id: "executed", label: "Executed" },
  { id: "rejected", label: "Rejected" },
  { id: "failed", label: "Failed / stuck" },
  { id: "all", label: "All" },
];

const FILTER_STATUSES: Record<StatusFilter, Array<"draft" | "pending_review" | "approved" | "executing" | "executed" | "failed" | "rejected"> | undefined> = {
  needs_decision: ["draft", "pending_review"],
  executed: ["executed"],
  rejected: ["rejected"],
  failed: ["failed", "executing", "approved"],
  all: undefined,
};

function SourceBadge({ source }: { source: string }) {
  const isHuman = source === "human_user";
  const isNick = source === "nick_receptionist";
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${
        isHuman
          ? "bg-blue-500/10 text-blue-500"
          : isNick
            ? "bg-violet-500/10 text-violet-500"
            : "bg-amber-500/10 text-amber-600"
      }`}
    >
      {isNick ? <PhoneCall className="w-3 h-3" /> : isHuman ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
      {isNick ? "Nick" : isHuman ? "Human" : "AI"}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const cfg: Record<string, { cls: string; icon: React.ReactNode }> = {
    draft: { cls: "bg-amber-500/10 text-amber-600", icon: <Clock className="w-3 h-3" /> },
    pending_review: { cls: "bg-amber-500/10 text-amber-600", icon: <Clock className="w-3 h-3" /> },
    // approved/executing are crash-orphan states when seen at rest — they must
    // read as "needs attention", never as a neutral gray done-ness.
    approved: { cls: "bg-red-500/10 text-red-500", icon: <RefreshCw className="w-3 h-3" /> },
    executing: { cls: "bg-red-500/10 text-red-500", icon: <Clock className="w-3 h-3" /> },
    executed: { cls: "bg-emerald-500/10 text-emerald-500", icon: <CheckCircle2 className="w-3 h-3" /> },
    rejected: { cls: "bg-muted text-muted-foreground", icon: <XCircle className="w-3 h-3" /> },
    failed: { cls: "bg-red-500/10 text-red-500", icon: <XCircle className="w-3 h-3" /> },
  };
  const c = cfg[status] ?? { cls: "bg-muted text-muted-foreground", icon: <Clock className="w-3 h-3" /> };
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${c.cls}`}>
      {c.icon}
      {status.replace("_", " ")}
    </span>
  );
}

export default function ApprovalsSection() {
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<StatusFilter>("needs_decision");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const list = trpc.proposals.list.useQuery(
    { statuses: FILTER_STATUSES[filter], limit: 100 },
    { refetchInterval: 60_000 },
  );
  const actionTypes = trpc.proposals.actionTypes.useQuery(undefined, { staleTime: 300_000 });

  const invalidate = () => {
    void utils.proposals.list.invalidate();
    void utils.proposals.counts.invalidate();
  };

  const approve = trpc.proposals.approve.useMutation({
    onSuccess: (r) => {
      if (r.ok) toast.success("Approved and executed");
      else toast.error(`Not executed — ${r.error ?? r.status}`);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const reject = trpc.proposals.reject.useMutation({
    onSuccess: (r) => {
      if (r.ok) toast.success("Rejected — nothing was executed");
      else toast.error(`Could not reject — ${r.error ?? r.status}`);
      setRejectingId(null);
      setRejectNote("");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const retry = trpc.proposals.retry.useMutation({
    onSuccess: (r) => {
      if (r.ok) toast.success("Retry succeeded");
      else toast.error(`Retry failed — ${r.error ?? r.status}`);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const describeAction = (actionType: string) =>
    actionTypes.data?.find((a) => a.actionType === actionType)?.describe ??
    `Runs the '${actionType}' executor`;

  async function onApprove(id: string, title: string, actionType: string) {
    const ok = await confirmDialog({
      title: `Approve: ${title}?`,
      message: `${describeAction(actionType)} This runs immediately after approval.`,
      confirmLabel: "Approve & execute",
      cancelLabel: "Cancel",
      tone: "danger",
    });
    if (!ok) return;
    approve.mutate({ id });
  }

  const rows = list.data ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Approvals"
        subtitle="AI- and one-tap-originated actions wait here as drafts. Nothing executes without your approval — enforced server-side."
        icon={<ShieldCheck className="w-5 h-5" />}
      />

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`text-xs px-3 py-2 min-h-[40px] rounded-md border transition-colors ${
              filter === f.id
                ? "bg-primary/15 text-primary border-primary/30"
                : "bg-card/50 text-muted-foreground border-border/30 hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {list.isLoading ? (
        <LoadingState label="Loading proposals…" />
      ) : list.isError ? (
        /* Unknown is not empty: a dead query must never render a calm queue. */
        <ErrorState
          message={`Could not read the approval queue — this is unknown, not empty. ${list.error?.message ?? ""}`}
          onRetry={() => void list.refetch()}
        />
      ) : rows.length === 0 ? (
        <div className="border border-border/30 bg-card/50 rounded-lg px-4 py-8 text-center text-sm text-muted-foreground">
          <ClipboardList className="w-5 h-5 mx-auto mb-2 opacity-50" />
          {filter === "needs_decision"
            ? "No proposals waiting for a decision."
            : "Nothing here for this filter."}
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((p) => {
            const reviewable = p.status === "draft" || p.status === "pending_review";
            return (
              <li key={p.id} className="border border-border/30 bg-card/50 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <SourceBadge source={p.source} />
                  <StatusPill status={p.status} />
                  {typeof p.confidence === "number" && (
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        p.confidence < 60 ? "bg-red-500/10 text-red-500" : "bg-muted text-muted-foreground"
                      }`}
                      title="Extraction confidence"
                    >
                      {p.confidence}% conf
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground/70 ml-auto">
                    {new Date(p.createdAt).toLocaleString()}
                  </span>
                </div>

                <div className="text-sm font-medium text-foreground">{p.title}</div>
                <div className="text-[11px] text-muted-foreground">
                  {describeAction(p.actionType)} · by {p.actor}
                </div>

                {/* Intent preview: the exact payload the executor will receive. */}
                <pre className="text-[11px] bg-background/60 border border-border/20 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">
                  {JSON.stringify(p.payloadJson, null, 1)}
                </pre>

                {p.contextJson != null && (
                  <details className="text-[11px] text-muted-foreground">
                    <summary className="cursor-pointer py-1">Call / source context</summary>
                    <pre className="bg-background/60 border border-border/20 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">
                      {JSON.stringify(p.contextJson, null, 1)}
                    </pre>
                  </details>
                )}

                {p.status === "rejected" && p.reviewNote && (
                  <div className="text-[11px] text-muted-foreground">Rejected: {p.reviewNote}</div>
                )}
                {p.status === "failed" && (
                  <div className="text-[11px] text-red-500">
                    Execution failed: {String((p.executionResultJson as { error?: string } | null)?.error ?? "unknown")}
                  </div>
                )}
                {p.status === "executed" && p.reviewedBy && (
                  <div className="text-[11px] text-muted-foreground">
                    Approved by {p.reviewedBy}
                    {p.executedAt ? ` · executed ${new Date(p.executedAt).toLocaleString()}` : ""}
                  </div>
                )}

                {reviewable && rejectingId !== p.id && (
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => void onApprove(p.id, p.title, p.actionType)}
                      disabled={approve.isPending}
                      className="flex-1 min-h-[44px] text-xs font-bold bg-primary text-primary-foreground rounded-md px-3 py-2 hover:bg-primary/90 disabled:opacity-50"
                    >
                      Approve & execute
                    </button>
                    <button
                      onClick={() => {
                        setRejectingId(p.id);
                        setRejectNote("");
                      }}
                      disabled={reject.isPending}
                      className="flex-1 min-h-[44px] text-xs font-medium bg-secondary text-foreground rounded-md px-3 py-2 hover:bg-secondary/80 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                )}

                {/* In-DOM two-tap reject — dialog globals are dead on the iOS PWA. */}
                {reviewable && rejectingId === p.id && (
                  <div className="space-y-2 pt-1">
                    <input
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      placeholder="Why? (optional)"
                      className="w-full bg-background/50 border border-border/30 rounded-md px-3 py-2 text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => reject.mutate({ id: p.id, note: rejectNote || undefined })}
                        disabled={reject.isPending}
                        className="flex-1 min-h-[44px] text-xs font-bold bg-destructive text-destructive-foreground rounded-md px-3 py-2 disabled:opacity-50"
                      >
                        Confirm reject
                      </button>
                      <button
                        onClick={() => setRejectingId(null)}
                        className="flex-1 min-h-[44px] text-xs bg-secondary rounded-md px-3 py-2"
                      >
                        Keep
                      </button>
                    </div>
                  </div>
                )}

                {/* failed = executor threw; approved = crash orphan whose
                    execution claim never landed (provably never ran) — both
                    safely retryable. `executing` is deliberately excluded: the
                    action may have completed before the terminal write. */}
                {(p.status === "failed" || p.status === "approved") && (
                  <button
                    onClick={() => retry.mutate({ id: p.id })}
                    disabled={retry.isPending}
                    className="inline-flex items-center gap-1.5 min-h-[44px] text-xs font-medium bg-secondary rounded-md px-3 py-2 hover:bg-secondary/80 disabled:opacity-50"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {p.status === "approved" ? "Resume execution" : "Retry execution"}
                  </button>
                )}
                {p.status === "executing" && (
                  <div className="text-[11px] text-amber-600">
                    Stuck mid-execution? The action may already exist — verify (callbacks/bookings) before
                    doing anything by hand. This row never auto-retries.
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
