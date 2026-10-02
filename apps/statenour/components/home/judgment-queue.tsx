"use client";

/**
 * JudgmentQueue — section 4: the ONLY queue on Home. One human concept —
 * things only Nour can decide — replacing four sibling cards
 * (ContradictionSlot · FollowUpsList · ProposedCommitments · the header's
 * approvals badge). The server brief ranks and explains; this component
 * renders rows and executes verdicts through the SAME mutations the old
 * cards used, so every receipt path (agenda ledger, commitment lifecycle,
 * BDN-104 decision sensors) is preserved.
 *
 * Contract carried over from every old card: skeleton while loading, LOUD
 * on failure ("state unknown, not empty" — failed sources are NAMED),
 * `null` on a measured zero. A surface that is usually absent is what
 * makes it trustworthy when present.
 *
 * Verdict routing:
 *   · commitment  → accept/dismiss inline (operator.commitmentAccept/Dismiss)
 *   · followup    → convert-to-task/dismiss inline (operator.agenda*)
 *   · contradiction → link to the resolution panel at /brain (a third
 *     rebuild of that four-verdict flow is exactly what this page removes)
 *   · approvals   → ONE rolled-up row linking /system/actions (verdicts
 *     there need payload review)
 *
 * Also owns the follow-up SYNC side effect FollowUpsList used to run:
 * generated follow-up strings are upserted into the agenda_items ledger
 * once per distinct payload — deleting the card must not silently stop
 * the ledger.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight, Check, ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils/cn";
import type { BriefJudgmentSection, JudgmentItem } from "@/lib/home/operator-brief";

const KIND_LABEL: Record<JudgmentItem["kind"], string> = {
  contradiction: "Contradiction",
  commitment: "Commitment",
  followup: "Follow-up",
  approvals: "Approvals",
};

export function JudgmentQueue({
  judgment,
  loading,
}: {
  judgment: BriefJudgmentSection | null;
  loading: boolean;
}) {
  const utils = trpc.useUtils();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // BDN-104 · decision sensor (fire-and-forget) — telemetry failure must
  // never surface as a failed verdict.
  const signal = trpc.operator.recordHomeSignal.useMutation();

  const acceptCommitment = trpc.operator.commitmentAccept.useMutation();
  const dismissCommitment = trpc.operator.commitmentDismiss.useMutation();
  const convertFollowUp = trpc.operator.agendaConvertFollowUp.useMutation();
  const dismissFollowUp = trpc.operator.agendaDismissFollowUp.useMutation();

  // Follow-up ledger sync (ported verbatim from FollowUpsList): once per
  // distinct generated payload. NUL delimiter written as an ESCAPE, not a
  // raw byte — a literal 0x00 makes the file read as binary to git and
  // every text lint (tests/repo/source-files-are-text.test.ts).
  const remembersQ = trpc.operator.nickRemembersContext.useQuery(undefined, {
    staleTime: 60_000,
  });
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

  const refresh = () => void utils.operator.brief.invalidate();

  const act = async (key: string, run: () => Promise<{ ok: boolean }>, onOk?: () => void) => {
    setBusyKey(key);
    setActionError(null);
    try {
      const res = await run();
      if (!res.ok) setActionError("That didn't save — the item is still waiting.");
      else {
        onOk?.();
        refresh();
      }
    } catch {
      setActionError("That didn't save — the item is still waiting.");
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) {
    return (
      <section aria-label="needs judgment" className="mt-12" aria-busy>
        <div className="h-3 w-36 animate-pulse rounded bg-raised" />
      </section>
    );
  }
  if (!judgment) return null;

  if (judgment.items.length === 0) {
    // Measured zero renders NOTHING — unless part of the measurement
    // failed, which must render as failure, never as quiet.
    if (judgment.failedSources.length === 0) return null;
    return (
      <section
        aria-label="needs judgment"
        className="mt-12 border-l-2 border-amber-500/60 pl-5"
      >
        <p className="flex items-center gap-1.5 text-[13px] text-amber-300">
          <AlertCircle className="h-3.5 w-3.5" />
          Couldn&apos;t read: {judgment.failedSources.join(", ")} — state unknown, not empty.
        </p>
      </section>
    );
  }

  const visible = expanded ? judgment.items : judgment.items.slice(0, judgment.visibleCap);
  const hiddenCount = judgment.items.length - judgment.visibleCap;

  return (
    <section aria-label="needs judgment" className="mt-12">
      <div className="flex items-end justify-between border-b border-edge-subtle pb-3">
        <h2 className="vt-eyebrow text-fg-secondary">Needs your judgment</h2>
        <span className="font-mono text-[20px] font-semibold leading-none tabular-nums text-rose-300">
          {judgment.totalCount}
        </span>
      </div>

      {judgment.failedSources.length > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-amber-300">
          <AlertCircle className="h-3 w-3" />
          Partial read — {judgment.failedSources.join(", ")} unavailable; the count above is a floor.
        </p>
      )}
      {actionError && <p className="mt-3 text-[13px] text-amber-300">{actionError}</p>}

      <ul className="divide-y divide-edge/60">
        {visible.map((item) => (
          <JudgmentRow
            key={rowKey(item)}
            item={item}
            busy={busyKey === rowKey(item)}
            onCommitmentVerdict={(id, verdict) =>
              act(
                rowKey(item),
                () =>
                  verdict === "accept"
                    ? acceptCommitment.mutateAsync({ id })
                    : dismissCommitment.mutateAsync({ id }),
                () => signal.mutate({ kind: verdict === "accept" ? "verdict_accept" : "verdict_dismiss" }),
              )
            }
            onFollowupVerdict={(id, verdict) =>
              act(
                rowKey(item),
                () =>
                  verdict === "task"
                    ? convertFollowUp.mutateAsync({ id })
                    : dismissFollowUp.mutateAsync({ id }),
                () => {
                  signal.mutate({ kind: verdict === "task" ? "followup_convert" : "followup_dismiss" });
                  if (verdict === "task") void utils.task.inboxCount.invalidate();
                },
              )
            }
          />
        ))}
      </ul>

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-1 inline-flex min-h-[44px] w-full items-center justify-center gap-1 text-[13px] font-medium text-fg-tertiary transition-colors duration-[var(--motion-state)] hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        >
          {expanded ? (
            <>
              collapse <ChevronUp size={10} />
            </>
          ) : (
            <>
              {hiddenCount} more <ChevronDown size={10} />
            </>
          )}
        </button>
      )}
    </section>
  );
}

function rowKey(item: JudgmentItem): string {
  switch (item.kind) {
    case "contradiction":
      return `c:${item.key}`;
    case "commitment":
      return `p:${item.id}`;
    case "followup":
      return `f:${item.id}`;
    case "approvals":
      return "approvals";
  }
}

function JudgmentRow({
  item,
  busy,
  onCommitmentVerdict,
  onFollowupVerdict,
}: {
  item: JudgmentItem;
  busy: boolean;
  onCommitmentVerdict: (id: number, verdict: "accept" | "dismiss") => void;
  onFollowupVerdict: (id: string, verdict: "task" | "dismiss") => void;
}) {
  const kindChip = (
    <span className="w-24 shrink-0 pt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
      {KIND_LABEL[item.kind]}
    </span>
  );

  if (item.kind === "approvals") {
    return (
      <li>
        <Link
          href={item.href}
          className="group flex min-h-[52px] items-start gap-3 py-3 transition-colors duration-150 hover:bg-raised/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        >
          {kindChip}
          <span className="min-w-0 flex-1 text-[15px] leading-snug text-fg">
            {item.count > 0
              ? `${item.count} deferred action${item.count === 1 ? "" : "s"} await your verdict`
              : "no live approvals"}
            {item.oldestAgeMin != null && item.oldestAgeMin > 60 && (
              <span className="text-fg-tertiary"> · oldest {Math.round(item.oldestAgeMin / 60)}h</span>
            )}
            {item.expired > 0 && (
              <span className="text-fg-tertiary"> · {item.expired} expired — re-request or dismiss</span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1 pt-0.5 text-[12px] font-medium text-rose-300">
            Review <ArrowRight size={11} className="transition-transform duration-150 motion-safe:group-hover:translate-x-0.5" />
          </span>
        </Link>
      </li>
    );
  }

  if (item.kind === "contradiction") {
    return (
      <li>
        <Link
          href={item.href}
          className="group flex min-h-[52px] items-start gap-3 py-3 transition-colors duration-150 hover:bg-raised/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        >
          {kindChip}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] leading-snug text-fg">
              now · {item.nowExcerpt}
            </span>
            <span className="block truncate text-[13px] leading-snug text-fg-tertiary">
              before · {item.beforeExcerpt}
              {item.daysApart > 0 && ` · ${item.daysApart}d apart`}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 pt-0.5 text-[12px] font-medium text-fg-secondary">
            Resolve <ArrowRight size={11} className="transition-transform duration-150 motion-safe:group-hover:translate-x-0.5" />
          </span>
        </Link>
      </li>
    );
  }

  if (item.kind === "commitment") {
    return (
      // flex-wrap: on a 375px phone the verdict buttons drop to their own
      // right-aligned row instead of squeezing the proposal text to a sliver.
      <li className={cn("flex min-h-[52px] flex-wrap items-start gap-3 py-3", busy && "opacity-50")}>
        {kindChip}
        <span className="min-w-0 flex-1 basis-52">
          <span className="block text-[15px] leading-snug text-fg">{item.description}</span>
          <span className="block text-[12px] text-fg-tertiary">
            {[item.domain, item.evidence].filter(Boolean).join(" · ") || "machine-proposed"}
          </span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => onCommitmentVerdict(item.id, "accept")}
            title="Accept — goes on the books as active"
            className="inline-flex min-h-[44px] items-center gap-1 rounded-control border border-emerald-500/25 bg-emerald-500/10 px-3 text-[13px] font-medium text-emerald-300 transition-colors duration-[var(--motion-state)] hover:bg-emerald-500/20 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold"
          >
            <Check className="h-3 w-3" /> Accept
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onCommitmentVerdict(item.id, "dismiss")}
            aria-label="Dismiss proposal — remembered, never re-proposed"
            title="Dismiss — remembered, never re-proposed"
            className="inline-flex size-11 items-center justify-center rounded-md border border-edge text-fg-tertiary transition-colors duration-150 hover:text-rose-300 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      </li>
    );
  }

  // followup
  return (
    <li className={cn("flex min-h-[52px] flex-wrap items-start gap-3 py-3", busy && "opacity-50")}>
      {kindChip}
      <span className="min-w-0 flex-1 basis-52 text-[15px] leading-snug text-fg">{item.title}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => onFollowupVerdict(item.id, "task")}
          title="Convert to task"
          className="inline-flex min-h-[44px] items-center gap-1 rounded-control border border-edge-default px-3 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold"
        >
          <Plus className="h-3 w-3" /> Task
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onFollowupVerdict(item.id, "dismiss")}
          aria-label="Dismiss follow-up"
          title="Dismiss follow-up"
          className="inline-flex size-11 items-center justify-center rounded-md border border-edge text-fg-tertiary transition-colors duration-150 hover:text-fg disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      </span>
    </li>
  );
}
