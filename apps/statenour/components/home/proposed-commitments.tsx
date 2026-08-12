"use client";

import { trpc } from "@/lib/trpc/client";
import { Check, X, AlertCircle, Handshake, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils/cn";

/** Decide-lane cap (BDN-001 compact Home): rows shown before the expander. */
const COLLAPSED_LIMIT = 3;

/**
 * WP-16 · 2026-07-28 · proposed-commitment verdict card.
 *
 * Machine proposers (journal nextAction is the first) create
 * status="proposed" commitments with NO standing. This card is where the
 * operator gives the verdict: accept (→ active, on the books) or dismiss
 * (→ abandoned, remembered — sourceRef idempotency means it never
 * re-proposes). Same honest-state contract as FollowUpsList: loading
 * skeleton, failure renders as FAILURE, measured-zero renders nothing.
 */
export function ProposedCommitments() {
  const utils = trpc.useContext();
  const proposedQ = trpc.operator.commitmentsProposed.useQuery(undefined, {
    staleTime: 30_000,
  });
  const acceptMutation = trpc.operator.commitmentAccept.useMutation({
    onSuccess: () => utils.operator.commitmentsProposed.invalidate(),
  });
  const dismissMutation = trpc.operator.commitmentDismiss.useMutation({
    onSuccess: () => utils.operator.commitmentsProposed.invalidate(),
  });

  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const act = async (id: number, kind: "accept" | "dismiss") => {
    setBusyId(id);
    setActionError(null);
    try {
      const res =
        kind === "accept"
          ? await acceptMutation.mutateAsync({ id })
          : await dismissMutation.mutateAsync({ id });
      if (!res.ok) setActionError("That didn't save — the proposal is still pending.");
    } catch {
      setActionError("That didn't save — the proposal is still pending.");
    } finally {
      setBusyId(null);
    }
  };

  if (proposedQ.isLoading) {
    return (
      <section aria-label="proposed-commitments" className="rounded-xl border border-white/5 p-4">
        <div className="h-3 w-44 rounded bg-white/5 animate-pulse" />
      </section>
    );
  }
  if (proposedQ.isError) {
    return (
      <section
        aria-label="proposed-commitments"
        className="rounded-xl border border-red-500/15 bg-red-500/5 p-4"
      >
        <p className="text-[11px] text-red-400 flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5" />
          Proposed commitments couldn&apos;t load — state unknown, not empty.
        </p>
      </section>
    );
  }

  const items = proposedQ.data?.items ?? [];
  if (items.length === 0) return null; // measured zero — quiet
  // BDN-001 compact Home: bounded verdict set by default; the "awaiting
  // verdict" badge above always counts the whole queue.
  const visible = expanded ? items : items.slice(0, COLLAPSED_LIMIT);
  const hiddenCount = items.length - COLLAPSED_LIMIT;

  return (
    <section
      aria-label="proposed-commitments"
      className="rounded-xl border border-emerald-500/10 bg-emerald-500/1 p-4 flex flex-col space-y-3"
    >
      <div className="flex items-center justify-between border-b border-white/6 pb-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-400 font-semibold flex items-center gap-1.5">
          <Handshake className="h-3.5 w-3.5" /> Proposed Commitments
        </p>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">
          {items.length} awaiting verdict
        </span>
      </div>

      {actionError && <p className="text-[10px] text-amber-400">{actionError}</p>}

      <div className="space-y-2">
        {visible.map((item) => {
          const isPending = busyId === item.id;
          return (
            <div
              key={item.id}
              className={cn(
                "flex items-start justify-between p-2.5 rounded bg-white/1 border border-white/3 hover:border-emerald-500/10 transition group gap-3",
                isPending && "opacity-50",
              )}
            >
              <div className="min-w-0">
                <p className="text-xs text-white/70 leading-relaxed font-medium mt-0.5">
                  {item.description}
                </p>
                <p className="text-[9px] text-white/30 mt-0.5">
                  {item.domain ? `${item.domain} · ` : ""}from {item.sourceRef?.startsWith("journal-take:") ? "journal" : "system"}
                  {/* Evidence-tier WP (2026-08-12): WHY to trust this
                      proposal, not just where it came from. Null on
                      legacy takes — renders nothing. */}
                  {item.evidenceTier && (
                    <span className="text-white/25">
                      {" · "}
                      {item.evidenceTier.toLowerCase()}
                      {item.evidenceConfidence && ` · ${item.evidenceConfidence.toLowerCase()} confidence`}
                    </span>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => act(item.id, "accept")}
                  disabled={isPending}
                  className="p-1 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 hover:text-white transition disabled:opacity-50 inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-1"
                  title="Accept — goes on the books as active"
                >
                  <Check className="h-3 w-3" /> Accept
                </button>
                <button
                  onClick={() => act(item.id, "dismiss")}
                  disabled={isPending}
                  className="p-1 rounded bg-white/3 border border-white/5 text-white/40 hover:text-red-400 hover:border-red-500/20 transition disabled:opacity-50"
                  title="Dismiss — remembered, never re-proposed"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {hiddenCount > 0 && (
        <button
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse proposals" : `Show ${hiddenCount} more proposals`}
          className="w-full flex items-center justify-center gap-1 min-h-[44px] sm:min-h-0 text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--text-primary)] pt-1"
        >
          {expanded ? (
            <>
              collapse <ChevronUp size={10} />
            </>
          ) : (
            <>
              {hiddenCount} more · <ChevronDown size={10} />
            </>
          )}
        </button>
      )}
    </section>
  );
}
