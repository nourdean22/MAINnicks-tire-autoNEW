"use client";

/**
 * components/brain/wisdom-evolution-panel.tsx · v10.0.410
 *
 * Operator-confirm review surface for wisdom-evolution candidates
 * (v10.0.406 endpoint · /api/brain/wisdom/evolution).
 *
 * Three categories rendered as collapsible sections:
 *
 *   STALE      · last_seen > 60d AND confidence < 0.5
 *                Action · DEPRECATE (POST /api/brain/wisdom/[id]
 *                · action="deprecate") OR DISMISS (close panel,
 *                will resurface on next cron unless promoted)
 *
 *   REDUNDANT  · cosine ≥ 0.92 with shared topic tags
 *                Action · DEPRECATE THE MERGE-SIDE (keep higher
 *                confidence) · operator confirms each move
 *
 *   LOW_TRUST  · active recently but conf < 0.5
 *                Action · OPEN IN PLACE (operator scrolls to the
 *                wisdom card and uses existing edit/deprecate)
 *
 * Mounted only when ?evolution=1 query param present · banner
 * style · auto-removes after operator clears the query.
 */

import { useState } from "react";
// Phase B.6d (2026-05-22) · migrated off `fetch("/api/brain/wisdom/
// evolution")` (read), `authedFetch("/api/brain/wisdom/[id]")` (POST
// deprecate) and `fetch("/api/brain/telemetry")` (POST) onto
// `trpc.brain.wisdomEvolution` + the existing `trpc.brain.actOnWisdom`
// (reused · the deprecate action) + `trpc.brain.recordTelemetry`.
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";

interface StaleCandidate {
  type: "stale";
  id: string;
  key: string;
  content: string;
  confidence: number;
  daysSinceLastSeen: number;
  reason: string;
}

interface RedundantPair {
  type: "redundant";
  keepId: string;
  keepKey: string;
  keepContent: string;
  keepConfidence: number;
  mergeId: string;
  mergeKey: string;
  mergeContent: string;
  mergeConfidence: number;
  similarity: number;
  sharedTopics: string[];
  reason: string;
}

interface LowTrustCandidate {
  type: "low_trust";
  id: string;
  key: string;
  content: string;
  confidence: number;
  reason: string;
}

/** Mirrors `EvolutionFinderFailure` in lib/brain/wisdom-evolution.ts. */
interface FinderFailure {
  finder: "stale" | "redundant" | "lowTrust";
  message: string;
}

interface EvolutionResp {
  stale: StaleCandidate[];
  redundant: RedundantPair[];
  lowTrust: LowTrustCandidate[];
  totalCandidates: number;
  /** Optional so a response from a pre-2026-09-02 deploy still parses. */
  failures?: FinderFailure[];
}

const FINDER_LABEL: Record<FinderFailure["finder"], string> = {
  stale: "stale · cold",
  redundant: "redundant · merge",
  lowTrust: "low trust · review",
};

/**
 * Renders WHICH finders failed. A zero in a failed finder's section is
 * "unknown", not "none" — so this sits above the lists rather than
 * replacing them, and the empty state never claims health while a
 * finder is down.
 */
function FailureNote({ failures }: { failures: FinderFailure[] }) {
  if (failures.length === 0) return null;
  return (
    <p className="mt-2 flex items-start gap-1.5 text-[11px] text-red-400">
      <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" />
      <span>
        {failures.length === 1 ? "1 finder" : `${failures.length} finders`} failed —{" "}
        {failures.map((f) => `${FINDER_LABEL[f.finder] ?? f.finder} (${f.message})`).join(" · ")}.
        Those sections read zero because they could not run, not because they are empty.
      </span>
    </p>
  );
}

export function WisdomEvolutionPanel({ onChange }: { onChange?: () => void }) {
  const utils = trpc.useUtils();
  const evoQuery = trpc.brain.wisdomEvolution.useQuery(undefined, {
    staleTime: 0,
  });
  const actMutation = trpc.brain.actOnWisdom.useMutation();
  const telemetryMutation = trpc.brain.recordTelemetry.useMutation();

  const [busyId, setBusyId] = useState<string | null>(null);

  const data = (evoQuery.data as EvolutionResp | undefined) ?? null;
  const loading = evoQuery.isLoading;

  async function deprecateOne(id: string, label: string) {
    if (busyId) return;
    setBusyId(id);
    // v10.0.415 · telemetry · fire-and-forget so click latency is unchanged
    telemetryMutation.mutate({
      event: "evolution_deprecate",
      tags: { wisdomId: id, key: label },
    });
    try {
      await actMutation.mutateAsync({ id, action: "deprecate" });
      toast.success(`Deprecated · ${label}`);
      // Local optimistic refresh
      await utils.brain.wisdomEvolution.invalidate();
      onChange?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? `Could not deprecate · ${err.message}` : "Network error",
      );
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-surface border border-edge-subtle bg-[var(--bg-raised)] p-4">
        <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary">
          loading evolution candidates…
        </p>
      </div>
    );
  }
  // 2026-09-02 self-audit, defect #1. This branch used to be reached
  // whenever `data` was falsy — INCLUDING a rejected query — and it
  // announced "the wisdom corpus is healthy". `runWisdomEvolution` was a
  // bare `Promise.all`, so any one of three finders throwing rejected
  // the whole thing, and a DB error rendered as a clean bill of health.
  // Same shape as components/brain/judgment-quality-panel.tsx:35 —
  // state unknown, not empty.
  if (evoQuery.isError || !data) {
    return (
      <div className="rounded-surface border border-red-500/25 bg-red-500/5 p-4">
        <p className="text-[11px] font-mono text-red-400">
          evolution review
        </p>
        <p className="mt-2 flex items-start gap-1.5 text-sm text-[var(--text-secondary)]">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-red-400" />
          <span>
            Evolution candidates couldn&apos;t load — state unknown, not empty.
            {evoQuery.error?.message ? ` (${evoQuery.error.message})` : ""}
          </span>
        </p>
      </div>
    );
  }

  const failures = data.failures ?? [];

  if (data.totalCandidates === 0) {
    return (
      <div
        className={`rounded-surface border p-4 ${
          failures.length > 0
            ? "border-red-500/25 bg-red-500/5"
            : "border-edge-subtle bg-[var(--bg-raised)]"
        }`}
      >
        <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary">
          evolution review
        </p>
        {failures.length > 0 ? (
          // Every finder that ran returned nothing AND at least one did
          // not run. "Healthy" is not a claim this data supports.
          <FailureNote failures={failures} />
        ) : (
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            No candidates · the wisdom corpus is healthy. The brain-feedback-loop cron
            will refresh this list daily at 05:00 UTC.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-surface border border-edge-subtle bg-[var(--bg-raised)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-eyebrow">Self-evolution review</p>
          <h3 className="section-title text-base mt-1">
            {data.totalCandidates} wisdom candidate{data.totalCandidates === 1 ? "" : "s"}
          </h3>
          {/* Partial results are still results — but they are labelled. */}
          <FailureNote failures={failures} />
        </div>
        <span className="text-[11px] font-mono text-[var(--text-tertiary)]">
          v10.0.406
        </span>
      </div>

      {data.stale.length > 0 && (
        <section className="mb-4">
          <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary mb-2">
            stale · cold {data.stale.length}
          </p>
          <ul className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {data.stale.slice(0, 25).map((c) => (
              <li key={c.id} className="flex items-start gap-3 rounded-micro border border-[var(--border-default)] bg-[var(--bg-base)] p-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-[var(--text-primary)] leading-snug" style={{ maxWidth: "60ch" }}>
                    {c.content.slice(0, 180)}
                    {c.content.length > 180 ? "…" : ""}
                  </p>
                  <p className="mt-1 text-[11px] font-mono text-[var(--text-tertiary)]">
                    {c.daysSinceLastSeen}d cold · {(c.confidence * 100).toFixed(0)}% conf · {c.key}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyId === c.id}
                  onClick={() => void deprecateOne(c.id, c.key)}
                  className="text-[11px] font-mono px-3 py-2 sm:px-2 sm:py-1 min-h-[44px] sm:min-h-0 rounded-control border border-rose-500/40 text-rose-400 hover:bg-rose-500/10 disabled:opacity-50 shrink-0"
                >
                  {busyId === c.id ? "…" : "deprecate"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.redundant.length > 0 && (
        <section className="mb-4">
          <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary mb-2">
            redundant · merge {data.redundant.length}
          </p>
          <ul className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {data.redundant.slice(0, 25).map((c) => (
              <li key={`${c.keepId}_${c.mergeId}`} className="rounded-micro border border-[var(--border-default)] bg-[var(--bg-base)] p-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-emerald-400 mb-1">
                      keep · {c.keepKey} · {(c.keepConfidence * 100).toFixed(0)}%
                    </p>
                    <p className="text-[12px] text-[var(--text-primary)] leading-snug">
                      {c.keepContent.slice(0, 150)}
                      {c.keepContent.length > 150 ? "…" : ""}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-rose-400 mb-1">
                      merge · {c.mergeKey} · {(c.mergeConfidence * 100).toFixed(0)}%
                    </p>
                    <p className="text-[12px] text-[var(--text-secondary)] leading-snug">
                      {c.mergeContent.slice(0, 150)}
                      {c.mergeContent.length > 150 ? "…" : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[11px] font-mono text-[var(--text-tertiary)]">
                    cosine {c.similarity} · topics: {c.sharedTopics.join(", ")}
                  </span>
                  <button
                    type="button"
                    disabled={busyId === c.mergeId}
                    onClick={() => void deprecateOne(c.mergeId, c.mergeKey)}
                    className="text-[11px] font-mono px-3 py-2 sm:px-2 sm:py-1 min-h-[44px] sm:min-h-0 rounded-control border border-rose-500/40 text-rose-400 hover:bg-rose-500/10 disabled:opacity-50"
                  >
                    {busyId === c.mergeId ? "…" : "deprecate merge-side"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.lowTrust.length > 0 && (
        <section>
          <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary mb-2">
            low trust · review {data.lowTrust.length}
          </p>
          <ul className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {data.lowTrust.slice(0, 25).map((c) => (
              <li key={c.id} className="flex items-start gap-3 rounded-micro border border-[var(--border-default)] bg-[var(--bg-base)] p-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-[var(--text-primary)] leading-snug" style={{ maxWidth: "60ch" }}>
                    {c.content.slice(0, 180)}
                    {c.content.length > 180 ? "…" : ""}
                  </p>
                  <p className="mt-1 text-[11px] font-mono text-[var(--text-tertiary)]">
                    {(c.confidence * 100).toFixed(0)}% conf · {c.key}
                  </p>
                </div>
                {/* v10.0.414 · low-trust gets review-then-deprecate · operator may
                    want to EDIT the wisdom rather than nuke it. The "review" link
                    scrolls to the wisdom card on /brain?tab=wisdom&focus=<key>
                    where the existing inline edit affordance handles the rewrite. */}
                <div className="flex flex-col gap-1 shrink-0">
                  <a
                    href={`/brain?tab=wisdom&focus=${encodeURIComponent(c.key)}`}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-control border border-edge-default px-4 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg justify-center text-center"
                  >
                    Review →
                  </a>
                  <button
                    type="button"
                    disabled={busyId === c.id}
                    onClick={() => void deprecateOne(c.id, c.key)}
                    className="text-[11px] font-mono px-3 py-2 sm:px-2 sm:py-1 min-h-[44px] sm:min-h-0 rounded-control border border-rose-500/40 text-rose-400 hover:bg-rose-500/10 disabled:opacity-50"
                  >
                    {busyId === c.id ? "…" : "deprecate"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
