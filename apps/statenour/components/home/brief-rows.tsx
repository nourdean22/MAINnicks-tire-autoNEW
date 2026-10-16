"use client";

/**
 * BriefRows (UI v3 W2, 2026-10-16): the finite brief under the verdict.
 *
 * Replaces BriefLead (headline, body paragraph, gold button block, Why, Different move) and
 * JudgmentQueue (eyebrow, count, kind chips) with ONE ruled list of at most BRIEF_ROW_CAP rows:
 * the lead CTA first, then the judgment items, then horizon slots; "N more" expands the rest in
 * place, never a silent drop. Each row is one line of text (plus one line of decision detail where
 * the item has one) and one action, plus Keep / Less. Less hides that row kind on this device for
 * seven days (lib/ui/brief-feedback.ts); Show hidden is always one tap away while anything is
 * hidden; a lead that reports an unreadable board or asks for a decision cannot be hidden. Nothing
 * is written to the server and the brief writer is unchanged.
 *
 * Empty states are three, never one: "Done for today." only when nothing failed and nothing is
 * hidden; "State unknown" when a source failed (empty-vs-error); "Nothing shown" when Less hid it.
 *
 * Every verdict runs through the mutation the old components used, so the receipt paths hold:
 * commitment accept/dismiss, follow-up convert/dismiss, the lead's `accepted` ledger decision, and
 * the follow-up ledger sync side effect (moved here verbatim). New in W2: a live approval REQUEST
 * (approval_requests, no executable payload of its own) is approved in place through the same
 * mutation /system/actions uses, behind the house confirm dialog in its danger tone (focus starts
 * on Cancel, so Enter cannot approve; window.confirm is suppressed in the iOS PWA and is never
 * called). An autonomous ACTION row never approves from Home: approving it executes a deferred
 * side effect whose payload this dialog does not show (review round 2, Codex 4291673580), so it
 * offers Review. The server mutation is the claim: a CONFLICT reads "Already decided".
 *
 * Design: rows ruled by hairlines, never carded; gold only on the lead CTA (the Now line owns the
 * page's one at-rest notch); Geist sentence case; 44px targets with gaps; no fixed widths, min-w-0
 * on text. One polite live region announces what a tap did; focus returns to the heading when the
 * control that had it leaves the page.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, Check, X } from "lucide-react";

import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils/cn";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { useBriefFeedback } from "@/hooks/use-brief-feedback";
import { hiddenKinds } from "@/lib/ui/brief-feedback";
import { BRIEF_ROW_CAP, composeBriefRows, type BriefRow, type BriefRowKind, type BriefRowsInput } from "@/lib/home/brief-rows";
import type { BriefLeadSection, PendingApproval } from "@/lib/home/operator-brief";

const KIND_LABEL: Record<BriefRowKind, string> = {
  lead: "Move",
  approval: "Approve",
  commitment: "Commit",
  followup: "Follow-up",
  contradiction: "Conflict",
  horizon: "Horizon",
};

/** What Keep / Less act on, as a noun phrase for accessible names and the live region. */
const KIND_NOUN: Record<BriefRowKind, string> = {
  lead: "the move",
  approval: "approvals",
  commitment: "commitments",
  followup: "follow-ups",
  contradiction: "conflicts",
  horizon: "horizon rows",
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
const LABEL_COL = "w-[4.5rem] shrink-0 pt-0.5 font-mono text-[11px] text-fg-tertiary";
const UNDER_LABEL = "pl-[5.25rem]";

const SAVE_FAILED = "That did not save. The item is still waiting.";
const ALREADY_DECIDED = "Already decided elsewhere. Refreshing the brief.";

type RunResult = { ok: boolean; note?: string };

function isConflict(err: unknown): boolean {
  const code = (err as { data?: { code?: string } } | null)?.data?.code;
  return code === "CONFLICT" || code === "BAD_REQUEST";
}

export function BriefRows({ brief, loading }: { brief: BriefRowsInput | null; loading: boolean }) {
  const utils = trpc.useUtils();
  const { feedback, hydrated, setVerdict, clear } = useBriefFeedback();
  const { confirm, dialog } = useConfirmDialog();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [live, setLive] = useState("");
  const [expanded, setExpanded] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const refocus = useRef(false);

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

  // Expiry is read at render, so a Less that ages out during a long session lifts without a reload.
  const hidden = new Set(hiddenKinds(feedback, Date.now()));
  const hiddenKey = [...hidden].sort().join(",");
  const composed = useMemo(
    () => (brief ? composeBriefRows(brief, new Set(hiddenKey ? hiddenKey.split(",") : []), expanded ? Number.POSITIVE_INFINITY : BRIEF_ROW_CAP) : { rows: [], total: 0 }),
    [brief, hiddenKey, expanded],
  );
  const { rows, total } = composed;

  // A tap that removes the control holding focus (Less, a verdict, Approve) would drop focus to body.
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    headingRef.current?.focus();
    // keyed on the composition, not its length: a hidden kind is replaced by the next row, same count
  }, [composed]);

  if (loading || !hydrated) {
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

  const less = (kind: BriefRowKind) => {
    refocus.current = true;
    setVerdict(kind, "less");
    setLive(`Hidden: ${KIND_NOUN[kind]} for seven days.`);
  };

  const act = async (key: string, run: () => Promise<RunResult>, done: string, onOk?: () => void) => {
    setBusyKey(key);
    setNotes((n) => ({ ...n, [key]: "" }));
    try {
      const res = await run();
      if (!res.ok) {
        setNotes((n) => ({ ...n, [key]: res.note ?? SAVE_FAILED }));
        if (res.note) refresh();
      } else {
        onOk?.();
        setLive(done);
        refocus.current = true;
        refresh();
      }
    } catch (err) {
      if (isConflict(err)) {
        setNotes((n) => ({ ...n, [key]: ALREADY_DECIDED }));
        refresh();
      } else {
        setNotes((n) => ({ ...n, [key]: SAVE_FAILED }));
      }
    } finally {
      setBusyKey(null);
    }
  };

  const recordLeadDecision = (lead: Extract<BriefRow, { kind: "lead" }>["lead"]) => {
    const target = lead.ledgerId ? { ledgerId: lead.ledgerId } : { summary: `${lead.headline}: ${lead.cta.label}` };
    const resultRef = lead.taskId ? `task:${lead.taskId}` : lead.cta.href;
    decide.mutate({ ...target, decision: "accepted", resultRef });
  };

  const approve = async (key: string, item: PendingApproval) => {
    const ok = await confirm({ title: "Approve this action?", body: item.title, confirmLabel: "Approve", tone: "danger" });
    if (!ok) return;
    await act(
      key,
      async () => {
        await approveRequest.mutateAsync({ id: item.id });
        return { ok: true };
      },
      "Approved.",
    );
  };

  const showHidden =
    hidden.size > 0 ? (
      <button
        type="button"
        onClick={() => {
          clear();
          setLive("Hidden rows are back.");
        }}
        className={ACTION_LINK}
      >
        Show hidden ({hidden.size})
      </button>
    ) : null;

  const liveRegion = (
    <p className="sr-only" aria-live="polite" role="status">
      {live}
    </p>
  );

  const partialRead = failedSources.length > 0 && (
    <p className="mt-3 flex items-center gap-1.5 text-[12px] text-amber-300">
      <AlertCircle className="h-3 w-3" />
      Partial read: {failedSources.join(", ")} unavailable, so this brief is a floor.
    </p>
  );

  if (rows.length === 0) {
    const line =
      failedSources.length > 0
        ? `State unknown: ${failedSources.join(", ")} unavailable, not empty.`
        : hidden.size > 0
          ? "Nothing shown."
          : "Done for today.";
    return (
      <section aria-label="the brief" className="mt-10 border-t border-edge-subtle pt-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <p className={cn("text-[17px]", failedSources.length > 0 ? "text-amber-300" : "text-fg-secondary")}>{line}</p>
          {showHidden}
        </div>
        {liveRegion}
        {dialog}
      </section>
    );
  }

  return (
    <section aria-label="the brief" className="mt-10">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-edge-subtle pb-2">
        <h2 ref={headingRef} tabIndex={-1} className="vt-eyebrow text-fg-secondary outline-none focus-visible:underline focus-visible:underline-offset-4">
          The brief
        </h2>
        {showHidden}
      </div>
      {partialRead}

      <ol className="divide-y divide-edge/60">
        {rows.map((row) => {
          const busy = busyKey === row.key;
          let label = KIND_LABEL[row.kind];
          let text: string;
          let detail: string | null = null;
          let tone = "text-fg";
          let action: React.ReactNode;
          let secondary: React.ReactNode = null;
          let canHide = true;

          switch (row.kind) {
            case "lead":
              text = row.lead.headline;
              tone = LEAD_TONE[row.lead.kind];
              canHide = !row.pinned;
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
                if (item.source === "action" || item.requiresOwner) {
                  detail = item.source === "action" ? "Runs a deferred action: review its payload first." : "Owner approval: review it with its payload.";
                  action = (
                    <Link href={row.href} className={ACTION_LINK}>
                      Review
                    </Link>
                  );
                } else {
                  action = (
                    <button type="button" disabled={busy} onClick={() => void approve(row.key, item)} className={ACTION_QUIET}>
                      <Check className="h-3 w-3" /> Approve
                    </button>
                  );
                }
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
              detail = [item.domain, item.evidence].filter(Boolean).join(" · ") || "machine-proposed";
              action = (
                <button
                  type="button"
                  disabled={busy}
                  title="Accept: goes on the books as active"
                  onClick={() => void act(row.key, () => acceptCommitment.mutateAsync({ id: item.id }), "Commitment accepted.", () => signal.mutate({ kind: "verdict_accept" }))}
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
                  onClick={() => void act(row.key, () => dismissCommitment.mutateAsync({ id: item.id }), "Proposal dismissed.", () => signal.mutate({ kind: "verdict_dismiss" }))}
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
                  onClick={() =>
                    void act(
                      row.key,
                      () => convertFollowUp.mutateAsync({ id: item.id }),
                      "Follow-up added as a task.",
                      () => {
                        signal.mutate({ kind: "followup_convert" });
                        void utils.task.inboxCount.invalidate();
                      },
                    )
                  }
                  className={ACTION_QUIET}
                >
                  Add as task
                </button>
              );
              secondary = (
                <button
                  type="button"
                  disabled={busy}
                  aria-label="Dismiss follow-up"
                  title="Dismiss follow-up"
                  onClick={() => void act(row.key, () => dismissFollowUp.mutateAsync({ id: item.id }), "Follow-up dismissed.", () => signal.mutate({ kind: "followup_dismiss" }))}
                  className={ICON_ACTION}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              );
              break;
            }
            case "contradiction":
              text = `Now: ${row.item.nowExcerpt}`;
              detail = `Before: ${row.item.beforeExcerpt}${row.item.daysApart > 0 ? ` (${row.item.daysApart}d apart)` : ""}`;
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

          const note = notes[row.key];
          return (
            <li key={row.key} data-brief-row={row.kind} className={cn("py-3", busy && "opacity-50")}>
              <div className="flex items-start gap-3">
                <span className={LABEL_COL}>{label}</span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block line-clamp-2 text-[15px] leading-snug", tone)}>{text}</span>
                  {detail && <span className="mt-0.5 block break-words text-[12px] leading-snug text-fg-tertiary">{detail}</span>}
                </span>
              </div>
              <div className={cn("mt-1 flex flex-wrap items-center gap-x-2 gap-y-1", UNDER_LABEL)}>
                {action}
                {secondary}
                {canHide && (
                  <span className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      data-brief-verdict="keep"
                      aria-pressed={feedback[row.kind]?.verdict === "keep"}
                      aria-label={`Keep ${KIND_NOUN[row.kind]} in the brief`}
                      onClick={() => setVerdict(row.kind, "keep")}
                      className={VERDICT}
                    >
                      Keep
                    </button>
                    <button
                      type="button"
                      data-brief-verdict="less"
                      aria-label={`Fewer ${KIND_NOUN[row.kind]}: hide them for seven days`}
                      onClick={() => less(row.kind)}
                      className={VERDICT}
                    >
                      Less
                    </button>
                  </span>
                )}
              </div>
              {note && (
                <p role="alert" className={cn("mt-1 text-[13px] text-amber-300", UNDER_LABEL)}>
                  {note}
                </p>
              )}
            </li>
          );
        })}
        {total > rows.length && (
          <li data-brief-more>
            <button
              type="button"
              aria-expanded={false}
              onClick={() => setExpanded(true)}
              className="inline-flex min-h-[44px] w-full items-center justify-center text-[13px] font-medium text-fg-tertiary transition-colors duration-[var(--motion-state)] hover:text-fg"
            >
              {total - rows.length} more
            </button>
          </li>
        )}
        {expanded && total > BRIEF_ROW_CAP && (
          <li data-brief-more>
            <button
              type="button"
              aria-expanded
              onClick={() => setExpanded(false)}
              className="inline-flex min-h-[44px] w-full items-center justify-center text-[13px] font-medium text-fg-tertiary transition-colors duration-[var(--motion-state)] hover:text-fg"
            >
              Show fewer
            </button>
          </li>
        )}
      </ol>
      {liveRegion}
      {dialog}
    </section>
  );
}
