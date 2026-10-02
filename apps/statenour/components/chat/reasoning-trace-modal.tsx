"use client";

/**
 * ReasoningTraceModal · v10.0.360
 *
 * Click the "show why" button on any Nick reply · this modal opens
 * and pulls /api/brain/provenance/[messageId] · displays the cognitive
 * chain (Belief → Desire → Intention → Observation) of brain memories
 * that most likely shaped that reply.
 *
 * Per /bdi-mental-states · transparency for "why did Nick say that?"
 * grounded in formal cognitive structure.
 *
 * Editorial layout per docs/aesthetic-principles.md (v10.0.352).
 */

import { X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc/client";
import { bdiLabel, bdiTone, type BdiType } from "@/lib/brain/bdi";
// 2026-08-19 · recall hits rendered confidence as "NN% conf" beside a real
// cosine match % — two unlike numbers dressed as the same kind of evidence.
// Second pass the same day: the first fix inverted confidence back into a
// sighting count, but 73% of recent seen_count=1 rows carry writer-stamped
// confidence (measured on prod), so the inversion fabricated history.
// The hit now carries brain_memories.seen_count itself — render that.
import { describeSeenCount } from "@/lib/brain/attention-label";

// Phase B.5 (2026-05-22) · migrated from `authedFetch` +
// useEffect/cancelled-flag to `trpc.chat.messageProvenance.useQuery`
// (the same procedure MessageInfoCard already uses). The local
// AnnotatedHit / JudgeRubric / ProvenanceResponse interfaces are
// gone — types now flow from the procedure's return shape, so a
// service-side change can't drift this modal silently.

// JudgeRubric is the shape of the (intentionally `unknown`-typed)
// feedback.judgment.rubric field · kept local for the readout cast.
// obedience/nonSycophancy/calibration (2026-08-18) are persona axes —
// scored by lib/ai/judge-eval.ts but excluded from `composite`, see
// that file's header for why.
interface JudgeRubric {
  accuracy?: number;
  actionability?: number;
  brevity?: number;
  tone?: number;
  evidence?: number;
  obedience?: number;
  nonSycophancy?: number;
  calibration?: number;
}

const BDI_ORDER: BdiType[] = ["belief", "desire", "intention", "observation"];

const BDI_INTRO: Record<BdiType, string> = {
  belief:
    "What Nick believes is true · stable principles, validated patterns, accepted wisdom.",
  desire:
    "What Nick wishes to bring about · active missions, open commitments, unfulfilled goals.",
  intention:
    "What Nick has committed to achieving · concrete next-actions on tasks ready to fire.",
  observation:
    "Raw perception · recent insights, conversation snippets, anomalies that haven't yet earned belief status.",
};

interface Props {
  open: boolean;
  messageId: string | null;
  onClose: () => void;
}

export function ReasoningTraceModal({ open, messageId, onClose }: Props) {
  // Phase B.5 · React Query handles the lazy fetch + cleanup ·
  // `enabled` gates the call to "modal open AND a messageId is set",
  // mirroring the pre-B.5 `if (!open || !messageId) return` guard.
  const provenanceQ = trpc.chat.messageProvenance.useQuery(
    { messageId: messageId ?? "" },
    { enabled: open && !!messageId, retry: false },
  );
  const data = provenanceQ.data ?? null;
  const loading = provenanceQ.isFetching;
  const error = provenanceQ.error ? provenanceQ.error.message : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        unstyled
        showCloseButton={false}
        overlayClassName="z-[180] bg-[var(--bg-void)]/85"
        className="fixed inset-y-8 left-1/2 z-[181] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 overflow-y-auto rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] outline-none"
      >
        {/* Header */}
        <header className="sticky top-0 bg-[var(--bg-base)] flex items-start justify-between p-5 border-b border-[var(--border-default)]">
          <div>
            <p className="text-eyebrow">Reasoning trace</p>
            <DialogTitle className="page-title mt-1 text-xl">
              Why Nick said that
            </DialogTitle>
            {data && (
              <p className="text-[11px] font-mono text-[var(--text-tertiary)] mt-2">
                {data.recall.bdiChain || "no memories matched"} · scanned {data.recall.scanned} · {data.recall.durationMs}ms
                {/* 2026-08-19 · memory-loop wave · provenance honesty:
                    receipt = what ACTUALLY fired on the turn (persisted at
                    stream time); reconstruction = pre-receipt message, recall
                    re-run at read time — an approximation. */}
                {" · "}
                {data.recall.origin === "receipt" ? (
                  <span className="text-emerald-500">receipt · what fired on this turn</span>
                ) : (
                  <span className="text-amber-500">reconstruction · re-run at read time</span>
                )}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-11 h-11 md:w-9 md:h-9 rounded-lg flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-all active:scale-90"
            aria-label="Close reasoning trace"
          >
            <X size={18} className="md:!w-4 md:!h-4" />
          </button>
        </header>

        <div className="p-5 space-y-5">
          {loading && <p className="text-[var(--text-tertiary)] text-sm">Tracing the cognitive chain…</p>}
          {error && <p className="text-rose-300/80 text-sm">{error}</p>}

          {data && (
            <>
              {/* Reply preview */}
              <section className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)]/60 p-4">
                <p className="text-eyebrow">Nick replied</p>
                <p
                  className="text-[var(--text-secondary)] text-sm mt-2 leading-relaxed"
                  style={{ maxWidth: "60ch" }}
                >
                  {data.message.contentPreview}
                  {data.message.contentPreview.length >= 280 ? "…" : ""}
                </p>
                {data.userContext && (
                  <>
                    <p className="text-eyebrow mt-4">After you said</p>
                    <p
                      className="text-[var(--text-tertiary)] text-sm mt-2 italic"
                      style={{ maxWidth: "60ch" }}
                    >
                      “{data.userContext}”
                    </p>
                  </>
                )}
              </section>

              {/* v10.0.384 · LLM-as-judge score · feedback layer */}
              {data.feedback?.judgment && (
                <section
                  className={`rounded-lg p-4 border ${
                    data.feedback.judgment.flagForReview
                      ? "border-amber-500/30 bg-amber-500/5"
                      : "border-emerald-500/20 bg-emerald-500/5"
                  }`}
                >
                  <p className="text-eyebrow flex items-center gap-2">
                    Quality score
                    {data.feedback.judgment.composite !== null && (
                      <span
                        className={`text-base font-mono ${
                          data.feedback.judgment.flagForReview
                            ? "text-amber-300"
                            : "text-emerald-300"
                        }`}
                      >
                        {data.feedback.judgment.composite.toFixed(1)} / 10
                      </span>
                    )}
                  </p>
                  {!!data.feedback.judgment.rubric && (
                    <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] font-mono">
                      {([
                        ["accuracy", "ACC"],
                        ["actionability", "ACT"],
                        ["brevity", "BRV"],
                        ["tone", "TONE"],
                        ["evidence", "EVD"],
                        ["obedience", "OBEY"],
                        ["nonSycophancy", "HNST"],
                        ["calibration", "CAL"],
                      ] as const).map(([key, label]) => {
                        const v = (data.feedback!.judgment!.rubric as JudgeRubric)[key];
                        if (v === undefined) return null;
                        const tone =
                          v >= 8
                            ? "text-emerald-300"
                            : v >= 6
                              ? "text-sky-300"
                              : v >= 4
                                ? "text-amber-300"
                                : "text-rose-300";
                        return (
                          <div key={key} className="flex flex-col items-center">
                            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                              {label}
                            </span>
                            <span className={`${tone} text-base`}>{v.toFixed(0)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {data.feedback.judgment.summary && (
                    <p
                      className="mt-3 text-[var(--text-secondary)] text-xs italic"
                      style={{ maxWidth: "60ch" }}
                    >
                      {data.feedback.judgment.summary}
                    </p>
                  )}
                </section>
              )}

              {/* v10.0.384 · adversarial counter-view · per /yann-lecun */}
              {data.feedback?.objection && (
                <section
                  className={`rounded-lg p-4 border ${
                    data.feedback.objection.severity >= 3
                      ? "border-rose-500/30 bg-rose-500/5"
                      : data.feedback.objection.severity >= 2
                        ? "border-amber-500/25 bg-amber-500/5"
                        : "border-violet-500/20 bg-violet-500/5"
                  }`}
                >
                  <p className="text-eyebrow flex items-center gap-2">
                    Counter-view
                    <span
                      className={`text-[11px] font-mono ${
                        data.feedback.objection.severity >= 3
                          ? "text-rose-300"
                          : data.feedback.objection.severity >= 2
                            ? "text-amber-300"
                            : "text-violet-300"
                      }`}
                    >
                      Sev {data.feedback.objection.severity}
                      {data.feedback.objection.foundFlaw ? " · flaw" : " · note"}
                    </span>
                  </p>
                  <p
                    className="mt-2 text-[var(--text-secondary)] text-sm leading-relaxed"
                    style={{ maxWidth: "60ch" }}
                  >
                    {data.feedback.objection.summary}
                  </p>
                </section>
              )}

              {/* BDI quadrants */}
              {BDI_ORDER.map((type) => {
                const items = data.recall.hits.filter((h) => h.bdi === type);
                if (items.length === 0) return null;
                return (
                  <section key={type} className="space-y-2">
                    <header className="border-b border-[var(--border-default)] pb-2">
                      <p className={`text-eyebrow ${bdiTone(type)}`}>
                        {bdiLabel(type)} · {items.length}
                      </p>
                      <p
                        className="section-copy text-[var(--text-tertiary)] text-xs mt-1"
                        style={{ maxWidth: "60ch" }}
                      >
                        {BDI_INTRO[type]}
                      </p>
                    </header>
                    <ol className="space-y-2">
                      {items.map((hit) => (
                        <li
                          key={hit.memoryId}
                          className="rounded border border-[var(--border-default)] bg-[var(--bg-raised)]/40 p-3"
                        >
                          <p
                            className="text-[var(--text-secondary)] text-[13px] leading-snug"
                            style={{ maxWidth: "60ch" }}
                          >
                            {hit.content.slice(0, 240)}
                            {hit.content.length > 240 ? "…" : ""}
                          </p>
                          <p className="text-[11px] font-mono text-[var(--text-tertiary)] mt-2 flex flex-wrap items-center gap-x-3">
                            <span>{hit.category}</span>
                            <span>·</span>
                            <span>{describeSeenCount(hit.seenCount)}</span>
                            <span>·</span>
                            <span>match {Math.round((1 - hit.knnDistance) * 100)}%</span>
                            {hit.ageDays >= 0 && (
                              <>
                                <span>·</span>
                                <span>{hit.ageDays}d old</span>
                              </>
                            )}
                          </p>
                        </li>
                      ))}
                    </ol>
                  </section>
                );
              })}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
