"use client";

/**
 * BriefRows (UI v3 W2, 2026-10-16): the finite brief under the verdict.
 *
 * Replaces BriefLead (headline, body paragraph, gold button block, Why, Different move) and
 * JudgmentQueue (eyebrow, count, kind chips) with ONE ruled list of at most BRIEF_ROW_CAP rows:
 * the lead CTA first, then the judgment items, then horizon slots. Each row is one line of text
 * and one action, plus Keep / Less. Less hides that row kind on this device for seven days
 * (lib/ui/brief-feedback.ts); nothing is written to the server and the brief writer is unchanged.
 * "Done for today." is the state when no row remains, with Show hidden as the way back.
 *
 * Every verdict runs through the mutation the old components used, so the receipt paths hold:
 * commitment accept/dismiss, follow-up convert/dismiss, the lead's `accepted` ledger decision, and
 * the follow-up ledger sync side effect (moved here verbatim). New in W2: a live approval is
 * approved in place through the same mutations /system/actions uses, behind the house confirm
 * dialog (window.confirm is suppressed in the iOS PWA and is never called). The server mutation is
 * the claim: it refuses a row that is no longer pending or whose window has passed.
 *
 * Design: rows ruled by hairlines, never carded; gold only on the lead CTA (the Now line owns the
 * page's one at-rest notch); Geist sentence case; 44px targets; no fixed widths, min-w-0 on text.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, Check, X } from "lucide-react";

import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils/cn";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { useBriefFeedback } from "@/hooks/use-brief-feedback";
import { BRIEF_ROW_CAP, composeBriefRows, type BriefRow, type BriefRowKind, type BriefRowsInput } from "@/lib/home/brief-rows";
import type { BriefLeadSection } from "@/lib/home/operator-brief";

const KIND_LABEL: Record<BriefRowKind, string> = {
  lead: "Move",
  approval: "Approve",
  commitment: "Commit",
  followup: "Follow up",
  contradiction: "Conflict",
  horizon: "Horizon",
};

const SCOPE_LABEL: Record<string, string> = { now: "Now", today: "Today", week: "Week", later: "Later" };

/** Lead tones carried from BriefLead: one semantic color per meaning, nothing else. */
const LEAD_TONE: Record<BriefLeadSection["kind"], string> = {
  error: "text-rose-300",
  execute: "text-fg",
  resume: "text-fg",
  decide: "text-rose-300",
  hygiene: "text-amber-300",
  triage: "text-amber-300",
  suggestions: "text-fg",
};

const ACTION = "inline-flex min-h-[44px] items-center gap-1 rounded-control px-3 text-[13px] font-medium transition-colors duration-[var(--motion-state)]";
const ACTION_QUIET = cn(ACTION, "border border-edge-default text-fg-secondary hover:border-edge-strong hover:text-fg disabled:opacity-50");
// Short words ("Open", "Less") get a 44px minimum box, not only a 44px height (tests/e2e/target-size.spec.ts).
const ACTION_LINK = cn(ACTION, "min-w-[44px] justify-center text-fg-secondary hover:text-fg");
const ICON_ACTION = "inline-flex size-11 items-center justify-center rounded-control border border-edge text-fg-tertiary transition-colors duration-[var(--motion-state)] hover:text-fg disabled:opacity-50";
const VERDICT = "inline-flex min-h-[44px] min-w-[44px] items-center justify-center px-3 font-mono text-[12px] text-fg-tertiary transition-colors duration-[var(--motion-state)] hover:text-fg aria-pressed:text-fg";

const SAVE_FAILED = "That did not save. The item is still waiting.";

export function BriefRows({ brief, loading }: { brief: BriefRowsInput | null; loading: boolean }) {
  const utils = trpc.useUtils();
  const { feedback, hidden, setVerdict, clear } = useBriefFeedback();
  const { confirm, dialog } = useConfirmDialog();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // 2026-10-02 · the lead is a ledgered recommendation (operator-brief.ts ledgerLeadShown). Taking
  // the CTA is `accepted`. No id (the bounded ledger write answered late) -> send the summary the row
  // was ledgered under and the server decides by content (audit 2026-10-10, 06-F2); it must match
  // leadLedgerSummary (pinned by tests/home/lost-click-decide-by-content.test.ts).
  const decide = trpc.operator.recordRecommendationDecision.useMutation();
  // BDN-104 · decision sensor (fire-and-forget); telemetry failure never surfaces as a failed verdict.
  const signal = trpc.operator.recordHomeSignal.useMutation();
  const acceptCommitment = trpc.operator.commitmentAccept.useMutation();
  const dismissCommitment = trpc.operator.commitmentDismiss.useMutation();
  const convertFollowUp = trpc.operator.agendaConvertFollowUp.useMutation();
  const dismissFollowUp = trpc.operator.agendaDismissFollowUp.useMutation();
  const approveRequest = trpc.system.approveApprovalRequest.useMutation();
  const decideAction = trpc.systemAutomation.decideApproval.useMutation();

  // Follow-up ledger sync (ported verbatim from JudgmentQueue, before that FollowUpsList): once per
  // distinct generated payload. NUL delimiter written as an ESCAPE, not a raw byte.
  const remembersQ = trpc.operator.nickRemembersContext.useQuery(undefined, { staleTime: 60_000 });
  const syncMutation = trpc.operator.agendaSyncFollowUps.useMutation({
    onSuccess: () => void utils.operator.brief.invalidate(),
  });
  const syncedFor = useRef<string | null>(null);
  useEffect(() => {
    const titles = remembersQ.data?.followUps ?? [];
    if (titles.length === 0) return;
    const sig = titles.join("\u0000");
    if (syncedFor.current === sig) return;
    syncedFor.current = sig;
    syncMutation.mutate({ titles });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remembersQ.data?.followUps]);

  const rows = useMemo(() => (brief ? composeBriefRows(brief, hidden) : []), [brief, hidden]);

  if (loading) {
    return (
      <section aria-label="the brief" className="mt-10 space-y-3" aria-busy>
        <div className="h-3 w-24 animate-pulse rounded-micro bg-raised" />
        <div className="h-12 w-full animate-pulse rounded-micro bg-raised" />
        <div className="h-12 w-full animate-pulse rounded-micro bg-raised" />
        <div className="h-12 w-4/5 animate-pulse rounded-micro bg-raised" />
      </section>
    );
  }
  if (!brief) return null;

  const failedSources = brief.judgment?.failedSources ?? [];
  const refresh = () => void utils.operator.brief.invalidate();

  const act = async (key: string, run: () => Promise<{ ok: boolean }>, onOk?: () => void) => {
    setBusyKey(key);
    setActionError(null);
    try {
      const res = await run();
      if (!res.ok) setActionError(SAVE_FAILED);
      else {
        onOk?.();
        refresh();
      }
    } catch {
      setActionError(SAVE_FAILED);
    } finally {
      setBusyKey(null);
    }
  };

  const recordLeadDecision = (lead: Extract<BriefRow, { kind: "lead" }>["lead"]) => {
    const target = lead.ledgerId ? { ledgerId: lead.ledgerId } : { summary: `${lead.headline}: ${lead.cta.label}` };
    const resultRef = lead.taskId ? `task:${lead.taskId}` : lead.cta.href;
    decide.mutate({ ...target, decision: "accepted", resultRef });
  };

  const approve = async (key: string, item: { id: string; source: "request" | "action"; title: string }) => {
    const ok = await confirm({ title: "Approve this action?", body: item.title, confirmLabel: "Approve" });
    if (!ok) return;
    await act(key, async () => {
      if (item.source === "request") await approveRequest.mutateAsync({ id: item.id });
      else await decideAction.mutateAsync({ id: item.id, decision: "approved" });
      return { ok: true };
    });
  };

  const partialRead = failedSources.length > 0 && (
    <p className="mt-3 flex items-center gap-1.5 text-[12px] text-amber-300">
      <AlertCircle className="h-3 w-3" />
      Partial read: {failedSources.join(", ")} unavailable, so this brief is a floor.
    </p>
  );

  if (rows.length === 0) {
    return (
      <section aria-label="the brief" className="mt-10 border-t border-edge-subtle pt-6">
        {partialRead}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <p className="text-[17px] text-fg-secondary">Done for today.</p>
          {hidden.size > 0 && (
            <button type="button" onClick={clear} className={ACTION_LINK}>
              Show hidden
            </button>
          )}
        </div>
        {dialog}
      </section>
    );
  }

  return (
    <section aria-label="the brief" className="mt-10">
      <div className="flex items-end justify-between border-b border-edge-subtle pb-3">
        <h2 className="vt-eyebrow text-fg-secondary">The brief</h2>
        <span className="font-mono text-[11px] tabular-nums text-fg-tertiary">
          {rows.length} of {BRIEF_ROW_CAP}
        </span>
      </div>
      {partialRead}
      {actionError && <p className="mt-3 text-[13px] text-amber-300">{actionError}</p>}

      <ol className="divide-y divide-edge/60">
        {rows.map((row) => {
          const busy = busyKey === row.key;
          let label = KIND_LABEL[row.kind];
          let text: string;
          let tone = "text-fg";
          let action: React.ReactNode;
          let secondary: React.ReactNode = null;

          switch (row.kind) {
            case "lead":
              text = row.lead.headline;
              tone = LEAD_TONE[row.lead.kind];
              action = (
                <Link
                  href={row.lead.cta.href}
                  onClick={() => recordLeadDecision(row.lead)}
                  data-lead-decision="accepted"
                  className={cn(ACTION, "bg-accent px-4 font-semibold text-[var(--text-inverse)] hover:bg-accent-hover")}
                >
                  {row.lead.cta.label}
                </Link>
              );
              break;
            case "approval":
              if ("item" in row) {
                const item = row.item;
                text = item.title;
                action = (
                  <button type="button" disabled={busy} onClick={() => void approve(row.key, item)} className={ACTION_QUIET}>
                    <Check className="h-3 w-3" /> Approve
                  </button>
                );
              } else {
                text = `${row.more} more await${row.more === 1 ? "s" : ""} your verdict${row.expired > 0 ? ` (${row.expired} expired)` : ""}`;
                action = (
                  <Link href={row.href} className={ACTION_LINK}>
                    Review
                  </Link>
                );
              }
              break;
            case "commitment": {
              const item = row.item;
              text = item.description;
              action = (
                <button
                  type="button"
                  disabled={busy}
                  title="Accept: goes on the books as active"
                  onClick={() => void act(row.key, () => acceptCommitment.mutateAsync({ id: item.id }), () => signal.mutate({ kind: "verdict_accept" }))}
                  className={ACTION_QUIET}
                >
                  <Check className="h-3 w-3" /> Accept
                </button>
              );
              secondary = (
                <button
                  type="button"
                  disabled={busy}
                  aria-label="Dismiss proposal: remembered, never re-proposed"
                  title="Dismiss: remembered, never re-proposed"
                  onClick={() => void act(row.key, () => dismissCommitment.mutateAsync({ id: item.id }), () => signal.mutate({ kind: "verdict_dismiss" }))}
                  className={ICON_ACTION}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              );
              break;
            }
            case "followup": {
              const item = row.item;
              text = item.title;
              action = (
                <button
                  type="button"
                  disabled={busy}
                  title="Convert to task"
                  onClick={() =>
                    void act(
                      row.key,
                      () => convertFollowUp.mutateAsync({ id: item.id }),
                      () => {
                        signal.mutate({ kind: "followup_convert" });
                        void utils.task.inboxCount.invalidate();
                      },
                    )
                  }
                  className={ACTION_QUIET}
                >
                  Task
                </button>
              );
              secondary = (
                <button
                  type="button"
                  disabled={busy}
                  aria-label="Dismiss follow-up"
                  title="Dismiss follow-up"
                  onClick={() => void act(row.key, () => dismissFollowUp.mutateAsync({ id: item.id }), () => signal.mutate({ kind: "followup_dismiss" }))}
                  className={ICON_ACTION}
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              );
              break;
            }
            case "contradiction":
              text = `Now: ${row.item.nowExcerpt}. Before: ${row.item.beforeExcerpt}${row.item.daysApart > 0 ? ` (${row.item.daysApart}d apart)` : ""}`;
              action = (
                <Link href={row.item.href} className={ACTION_LINK}>
                  Resolve
                </Link>
              );
              break;
            case "horizon":
              label = SCOPE_LABEL[row.slot.scope] ?? row.slot.scope;
              text = row.slot.label;
              action = (
                <Link href={row.slot.href} className={ACTION_LINK}>
                  Open
                </Link>
              );
              break;
          }

          return (
            <li key={row.key} data-brief-row={row.kind} className={cn("py-3", busy && "opacity-50")}>
              <div className="flex items-start gap-3">
                <span className="w-14 shrink-0 pt-0.5 font-mono text-[11px] text-fg-tertiary">{label}</span>
                <span className={cn("min-w-0 flex-1 line-clamp-2 text-[15px] leading-snug", tone)}>{text}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-1 pl-[4.25rem]">
                {action}
                {secondary}
                <span className="ml-auto flex items-center">
                  <button
                    type="button"
                    data-brief-verdict="keep"
                    aria-pressed={feedback[row.kind]?.verdict === "keep"}
                    aria-label={`Keep ${KIND_LABEL[row.kind].toLowerCase()} rows in the brief`}
                    onClick={() => setVerdict(row.kind, "keep")}
                    className={VERDICT}
                  >
                    Keep
                  </button>
                  <button
                    type="button"
                    data-brief-verdict="less"
                    aria-label={`Less: hide ${KIND_LABEL[row.kind].toLowerCase()} rows for seven days`}
                    onClick={() => setVerdict(row.kind, "less")}
                    className={VERDICT}
                  >
                    Less
                  </button>
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      {dialog}
    </section>
  );
}
