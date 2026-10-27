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
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { toast } from "sonner";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import { PageHeader, LoadingState, ErrorState } from "./shared";
import { PROPOSAL_REASON_CHIPS } from "@shared/proposalReasons";
import { describeProposal, lastDecisionWords, localPart, sourceWords, typePlural } from "./approvals/plainWords";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
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

type ProposalStatusName =
  | "draft" | "pending_review" | "approved" | "executing"
  | "executed" | "failed" | "rejected" | "execution_ambiguous";

const FILTER_STATUSES: Record<StatusFilter, ProposalStatusName[] | undefined> = {
  needs_decision: ["draft", "pending_review"],
  executed: ["executed"],
  rejected: ["rejected"],
  // Everything that needs a human but is not a fresh decision: real failures,
  // sweep-parked ambiguity, and the two crash-orphan resting states.
  failed: ["failed", "execution_ambiguous", "executing", "approved"],
  all: undefined,
};

function SourceBadge({ source }: { source: string }) {
  const isHuman = source === "human_user";
  const isNick = source === "nick_receptionist";
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
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
    executing: { cls: "bg-amber-500/10 text-amber-600", icon: <Clock className="w-3 h-3" /> },
    execution_ambiguous: { cls: "bg-red-500/10 text-red-500", icon: <AlertTriangle className="w-3 h-3" /> },
    executed: { cls: "bg-emerald-500/10 text-emerald-500", icon: <CheckCircle2 className="w-3 h-3" /> },
    rejected: { cls: "bg-muted text-muted-foreground", icon: <XCircle className="w-3 h-3" /> },
    failed: { cls: "bg-red-500/10 text-red-500", icon: <XCircle className="w-3 h-3" /> },
  };
  const c = cfg[status] ?? { cls: "bg-muted text-muted-foreground", icon: <Clock className="w-3 h-3" /> };
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${c.cls}`}>
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
  // One-tap reason; the note sent is "<reason> · <typed detail>" with either part optional.
  const [rejectReason, setRejectReason] = useState<string | null>(null);

  const list = trpc.proposals.list.useQuery(
    { statuses: FILTER_STATUSES[filter], limit: 100 },
    { refetchInterval: 60_000 },
  );
  // Counts, top reasons and the last decision come from the audit log on the server (not from list
  // rows, whose reviewedAt a retry rewrites). Refreshed every 5 minutes so the 30-day window moves.
  const decided = trpc.proposals.decisionSummary.useQuery(
    { days: 30 },
    { refetchInterval: 300_000, refetchIntervalInBackground: false },
  );
  const actionTypes = trpc.proposals.actionTypes.useQuery(undefined, { staleTime: 300_000 });

  const invalidate = () => {
    void utils.proposals.list.invalidate();
    void utils.proposals.counts.invalidate();
  };

  const approve = trpc.proposals.approve.useMutation({
    onSuccess: (r) => {
      if (r.ok) toast.success("Approved and executed");
      else toast.error(`Not executed · ${r.error ?? r.status}`);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const reject = trpc.proposals.reject.useMutation({
    onSuccess: (r) => {
      if (r.ok) toast.success("Rejected: nothing was executed");
      else toast.error(`Could not reject · ${r.error ?? r.status}`);
      setRejectingId(null);
      setRejectNote("");
      setRejectReason(null);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const retry = trpc.proposals.retry.useMutation({
    onSuccess: (r) => {
      if (r.ok) toast.success("Retry succeeded");
      else toast.error(`Retry failed · ${r.error ?? r.status}`);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const resolve = trpc.proposals.resolveAmbiguous.useMutation({
    onSuccess: (r) => {
      if (r.ok) {
        toast.success(
          r.status === "executed"
            ? "Recorded as already done: nothing was re-run"
            : "Recorded as never executed: you can retry it now",
        );
      } else toast.error(`Could not resolve · ${r.error ?? r.status}`);
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
      // Approving is the job this page exists for, not a destructive act (admin UI v1 W3): the
      // primary tone. Reject keeps the destructive styling.
      tone: "default",
    });
    if (!ok) return;
    approve.mutate({ id });
  }

  const rows = list.data ?? [];
  const now = new Date(); // "today"/"tomorrow" on a card are read against this render, not the request date
  const rejectText = [rejectReason, rejectNote.trim()].filter(Boolean).join(" · ");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Approvals"
        subtitle="Requests the receptionist and one-tap actions want to run. Nothing here runs until you approve it."
        icon={<ShieldCheck className="w-5 h-5" />}
      />

      <DecisionSummary query={decided} />

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`text-xs px-3 py-2 min-h-12 min-w-12 rounded-md border transition-colors ${
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
          message={`Could not read the approval queue: this is unknown, not empty. ${list.error?.message ?? ""}`}
          onRetry={() => void list.refetch()}
        />
      ) : rows.length === 0 ? (
        <div className="border border-border/30 bg-card/50 rounded-lg px-4 py-8 text-center text-sm text-muted-foreground">
          <ClipboardList className="w-5 h-5 mx-auto mb-2 opacity-50" />
          {filter === "needs_decision" ? (
            <>
              <p className="text-foreground">Nothing waiting for you.</p>
              <LastDecisionLine query={decided} />
            </>
          ) : (
            "Nothing here for this filter."
          )}
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
                <PayloadLines lines={describeProposal(p.actionType, p.payloadJson, now)} />
                <div className="text-xs text-muted-foreground">
                  {`${describeAction(p.actionType)} · ${sourceWords(p.source, p.actor)}`}
                </div>

                {/* Intent preview: the exact payload the executor will receive, one tap down. */}
                <details className="group text-xs text-muted-foreground">
                  <summary className="flex min-h-12 min-w-12 cursor-pointer list-none items-center gap-1 text-[13px] [&::-webkit-details-marker]:hidden">
                    <ChevronRight aria-hidden className="w-4 h-4 transition-transform group-open:rotate-90" />
                    Technical details
                  </summary>
                  <div className="space-y-2 pb-1">
                    <div>Payload the executor will receive</div>
                    <pre className="text-xs bg-background/60 border border-border/20 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">
                      {JSON.stringify(p.payloadJson, null, 1)}
                    </pre>
                    {p.contextJson != null && (
                      <>
                        <div>Call / source context</div>
                        <pre className="text-xs bg-background/60 border border-border/20 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">
                          {JSON.stringify(p.contextJson, null, 1)}
                        </pre>
                      </>
                    )}
                  </div>
                </details>

                {p.status === "rejected" && (
                  <div className="text-xs text-muted-foreground">
                    {`Turned down${p.reviewedBy ? ` by ${localPart(p.reviewedBy)}` : ""}: ${p.reviewNote?.trim() || "no reason given"}`}
                  </div>
                )}
                <DownstreamLine downstream={p.downstream ?? null} />
                {p.status === "failed" && (
                  <div className="text-xs text-red-500">
                    Execution failed: {String((p.executionResultJson as { error?: string } | null)?.error ?? "unknown")}
                  </div>
                )}
                {p.status === "executed" && p.reviewedBy && (
                  <div className="text-xs text-muted-foreground">
                    Approved by {localPart(p.reviewedBy)}
                    {p.executedAt ? ` · executed ${new Date(p.executedAt).toLocaleString()}` : ""}
                  </div>
                )}

                {reviewable && rejectingId !== p.id && (
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => void onApprove(p.id, p.title, p.actionType)}
                      disabled={approve.isPending}
                      className="flex-1 min-h-12 min-w-12 text-xs font-bold bg-primary text-primary-foreground rounded-md px-3 py-2 hover:bg-primary/90 disabled:opacity-50"
                    >
                      Approve & execute
                    </button>
                    <button
                      onClick={() => {
                        setRejectingId(p.id);
                        setRejectNote("");
                        setRejectReason(null);
                      }}
                      disabled={reject.isPending}
                      className="flex-1 min-h-12 min-w-12 text-xs font-medium bg-secondary text-foreground rounded-md px-3 py-2 hover:bg-secondary/80 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                )}

                {/* In-DOM two-tap reject — dialog globals are dead on the iOS PWA. */}
                {reviewable && rejectingId === p.id && (
                  <div className="space-y-2 pt-1">
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Why turn it down?">
                      {PROPOSAL_REASON_CHIPS.map((reason) => (
                        <button
                          key={reason}
                          type="button"
                          aria-pressed={rejectReason === reason}
                          onClick={() => setRejectReason(rejectReason === reason ? null : reason)}
                          className={`text-xs px-3 py-2 min-h-12 min-w-12 rounded-md border transition-colors ${
                            rejectReason === reason
                              ? "bg-primary/15 text-primary border-primary/30"
                              : "bg-card/50 text-muted-foreground border-border/30 hover:text-foreground"
                          }`}
                        >
                          {reason}
                        </button>
                      ))}
                    </div>
                    <input
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      maxLength={800}
                      aria-label="Add detail (optional)"
                      placeholder="Add detail (optional)"
                      className="w-full bg-background/50 border border-border/30 rounded-md px-3 py-2 text-base"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => reject.mutate({ id: p.id, note: rejectText || undefined })}
                        disabled={reject.isPending}
                        className="flex-1 min-h-12 min-w-12 text-xs font-bold bg-destructive text-destructive-foreground rounded-md px-3 py-2 disabled:opacity-50"
                      >
                        Confirm reject
                      </button>
                      <button
                        onClick={() => setRejectingId(null)}
                        className="flex-1 min-h-12 min-w-12 text-xs bg-secondary rounded-md px-3 py-2"
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
                    className="inline-flex items-center gap-1.5 min-h-12 min-w-12 text-xs font-medium bg-secondary rounded-md px-3 py-2 hover:bg-secondary/80 disabled:opacity-50"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {p.status === "approved" ? "Resume execution" : "Retry execution"}
                  </button>
                )}
                {p.status === "executing" && (
                  <div className="text-[11px] text-amber-600">
                    Running. If it is still here in a few minutes the sweep will park it as ambiguous: it is never auto-retried, because the action may already exist.
                  </div>
                )}

                {/* Ambiguous: the system cannot know whether the action landed.
                    Only a human who checked the real records may resolve it. */}
                {p.status === "execution_ambiguous" && (
                  <div className="space-y-2 pt-1">
                    <div className="text-[11px] text-red-500">
                      Abandoned mid-execution: this {p.actionType === "create_callback" ? "callback" : "booking"} may
                      or may not exist. Check the real records first, then say which.
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => resolve.mutate({ id: p.id, outcome: "executed" })}
                        disabled={resolve.isPending}
                        className="flex-1 min-h-12 min-w-12 text-xs font-bold bg-secondary rounded-md px-3 py-2 hover:bg-secondary/80 disabled:opacity-50"
                      >
                        It DID happen
                      </button>
                      <button
                        onClick={() => resolve.mutate({ id: p.id, outcome: "failed" })}
                        disabled={resolve.isPending}
                        className="flex-1 min-h-12 min-w-12 text-xs font-bold bg-secondary rounded-md px-3 py-2 hover:bg-secondary/80 disabled:opacity-50"
                      >
                        It never happened
                      </button>
                    </div>
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

type Downstream =
  | { readable: true; invoicedOn: string | null; bookedOn: string | null; callbackOn: string | null }
  | { readable: false };

/**
 * What happened to this customer after the decision (server: proposalOutcomes.ts).
 * Without it a rejection was a black hole: nothing said whether the caller came in
 * anyway or was lost. Unreadable renders as unknown, never as "nothing happened".
 */
function DownstreamLine({ downstream }: { downstream: Downstream | null }) {
  if (!downstream) return null;
  if (!downstream.readable) {
    return <div className="text-xs text-amber-500">Afterwards: unknown (outcome read failed)</div>;
  }
  const parts = [
    downstream.invoicedOn && `invoiced ${downstream.invoicedOn}`,
    downstream.bookedOn && `booked ${downstream.bookedOn}`,
    downstream.callbackOn && `callback requested ${downstream.callbackOn}`,
  ].filter(Boolean);
  return (
    <div className={`text-xs ${parts.length ? "text-emerald-500" : "text-muted-foreground"}`}>
      Afterwards: {parts.length ? parts.join(" · ") : "no invoice, booking or callback found for this phone"}
    </div>
  );
}

/** The request in the owner's words. The raw payload stays one tap down, in Technical details. */
function PayloadLines({ lines }: { lines: Array<{ label: string; value: string }> }) {
  if (lines.length === 0) return null;
  return (
    <div className="space-y-0.5 text-sm text-foreground">
      {lines.map((l) => (
        <p key={l.label} className="break-words">
          <span className="text-muted-foreground">{l.label}:</span> {l.value}
        </p>
      ))}
    </div>
  );
}

type DecidedQuery = {
  data: RouterOutputs["proposals"]["decisionSummary"] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => unknown;
};

/**
 * The queue's own track record over the last 30 days, counted on the server from the audit log.
 * A failed or unavailable read is "not known", never "no decisions" (empty-vs-error).
 */
function DecisionSummary({ query }: { query: DecidedQuery }) {
  const data = query.data;
  const box = "border border-border/30 bg-card/50 rounded-lg px-3 py-2 text-xs text-muted-foreground";

  if (query.isError || (data && !data.available)) {
    return (
      <div className={`${box} flex flex-wrap items-center gap-2`}>
        <span>Last 30 days: not known (the read failed).</span>
        <button
          type="button"
          onClick={() => void query.refetch()}
          className="min-h-12 min-w-12 rounded-md bg-secondary px-3 text-xs text-foreground hover:bg-secondary/80"
        >
          Read again
        </button>
      </div>
    );
  }
  if (query.isLoading || !data || !data.available) return <div className={box}>Last 30 days: reading…</div>;

  return (
    <section aria-label={`Last ${data.days} days`} className={`${box} space-y-1.5`}>
      <h3 className="font-semibold text-foreground">{`Last ${data.days} days`}</h3>
      {data.byType.length === 0 ? (
        <p>{`No decisions in the last ${data.days} days.`}</p>
      ) : (
        <>
          {data.byType.map((t) => (
            <p key={t.actionType} className="break-words text-foreground">
              {`${typePlural(t.actionType)}: ${t.approved} approved, ${t.turnedDown} turned down`}
            </p>
          ))}
          {data.topReasons.length > 0 && (
            <div>
              <p>Turned down because</p>
              <ul className="mt-0.5 space-y-0.5 text-foreground">
                {data.topReasons.map((r) => (
                  <li key={r.reason} className="break-words">{`${r.reason} · ${r.count}`}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Empty-queue footer: when the owner last decided something. Says nothing if that read failed. */
function LastDecisionLine({ query }: { query: DecidedQuery }) {
  const data = query.data;
  if (query.isError || query.isLoading || !data || !data.available) return null;
  if (!data.lastDecision) return <p className="mt-1 text-xs">No decisions yet.</p>;
  const last = lastDecisionWords(data.lastDecision);
  return last ? <p className="mt-1 text-xs">{`Last decision: ${last}`}</p> : null;
}
