"use client";

/**
 * /brain/link-review — operator decision spread for queued
 * conversation→mission link candidates.
 *
 * v10.0.193 · editorial decision-spread redesign.
 *
 * v10.0.191 shipped a minimal list. The page works but blends
 * with every other admin surface. This redesign treats each
 * candidate as a TWO-COLUMN SPREAD — conversation on the left,
 * mission on the right, similarity drawn as a CONNECTOR BAR
 * between them. The connector is the differentiation anchor:
 * the cosine score becomes a felt thing, not a number.
 *
 * Aesthetic: editorial decision-spread + industrial precision.
 * DFII 15/15. Existing color/font tokens reused (no new deps).
 */

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/ui";
// Phase VV (2026-05-19 AM) · authedFetch replaced by trpc · 2 sites
// (list + decide) on the `brain` router.
import { trpc } from "@/lib/trpc/client";
import { notifyDataChanged, onDataChanged } from "@/lib/events/data-change";
import { Check, X, Clock } from "lucide-react";
import { toast } from "sonner";

interface Candidate {
  id: string;
  conversationId: string | null;
  missionId: string | null;
  similarity: number;
  conversationTitle: string | null;
  missionTitle: string | null;
  pinnedSummary: string | null;
  topicTags: string | null;
  seenCount: number;
  createdAt: string;
  lastSeen: string;
}

type Decision = "approve" | "reject" | "snooze";

export default function LinkReviewPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [departing, setDeparting] = useState<Map<string, Decision>>(new Map());

  // Phase VV · tRPC migration · typed result has `{candidates, count}`
  // shape (no envelope dance · no `data.candidates ?? data.data.candidates`
  // fallback). Same useCallback shape preserved for the existing
  // event-bus refresh hook below.
  const utils = trpc.useUtils();
  const decideMutation = trpc.brain.decideLinkReview.useMutation();

  // 2026-05-24 · Wave V P0-#1 · staleness banner. Pre-fix the load()
  // catch only toasted · the toast disappears in 5s · the candidates
  // array stays at last value · operator looks at stale data with no
  // visible "may be stale" signal. Now: set a banner state that
  // persists in the UI until the next successful load.
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const view = await utils.brain.linkReview.fetch();
      setCandidates(view.candidates as Candidate[]);
      setLoadError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to load: ${msg}`);
      setLoadError(msg);
    } finally {
      setLoading(false);
    }
  }, [utils]);

  useEffect(() => {
    load();
  }, [load]);

  // v10.0.529.89 · Wave 33 · refresh when a chat tool or cron writes
  // a new link candidate to BrainMemory. Pre-Wave-33 the queue was
  // mount-only · operator approved candidates one-by-one and never
  // saw new ones land mid-session.
  useEffect(() => {
    return onDataChanged(["brain"], () => void load());
  }, [load]);

  const decide = useCallback(
    async (c: Candidate, decision: Decision) => {
      if (!c.conversationId || !c.missionId) {
        toast.error("Candidate missing IDs — refresh and try again");
        return;
      }
      setPending((p) => new Set(p).add(c.id));
      setDeparting((d) => new Map(d).set(c.id, decision));
      try {
        await decideMutation.mutateAsync({
          conversationId: c.conversationId,
          missionId: c.missionId,
          decision,
        });
        const verb = decision === "approve" ? "linked" : decision === "reject" ? "rejected" : "snoozed";
        toast.success(`${verb}: ${c.conversationTitle?.slice(0, 40) ?? "(untitled)"}`);
        // v10.0.529.90 · Wave 34 · approving a link mutates Mission ·
        // /plan + /mastery list missions · they listen to "missions".
        if (decision === "approve") {
          notifyDataChanged("missions", { source: "link-review-page", detail: "link-approve", id: c.missionId });
        }
        // 2026-05-24 · Wave V P0-#2 · pre-fix the 240ms setTimeout
        // mutated `candidates` directly · if the operator navigated
        // away in that window, on remount the local cache still held
        // the row that the backend no longer surfaces · phantom row
        // until next manual refresh. Now: invalidate the tRPC cache
        // and let useEffect's `load()` pull canonical state · the
        // departure animation still gets its frame because
        // `setDeparting` is set above.
        setTimeout(() => {
          setDeparting((d) => {
            const next = new Map(d);
            next.delete(c.id);
            return next;
          });
          void utils.brain.linkReview.invalidate();
          void load();
        }, 240);
      } catch (e) {
        toast.error(`${decision} failed: ${e instanceof Error ? e.message : String(e)}`);
        setDeparting((d) => {
          const next = new Map(d);
          next.delete(c.id);
          return next;
        });
      } finally {
        setPending((p) => {
          const next = new Set(p);
          next.delete(c.id);
          return next;
        });
      }
    },
    // 2026-05-24 · Wave V P0-#3 · pre-fix the deps array was empty
    // but the closure references decideMutation + utils + load. If
    // any of those rotate (e.g. tRPC client re-creation on auth
    // refresh) the stale captured reference fires the old client ·
    // results land on a dead query cache. Now: declare the real
    // closure dependencies so React's identity reconciliation runs.
    [decideMutation, utils, load],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-3 py-4 sm:px-4 sm:py-8">
      {/* Local stylesheet — keeps the editorial moment self-contained
          so other /brain pages don't pick up the decision-spread look. */}
      <style jsx>{`
        @keyframes spreadIn {
          0% { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes spreadOutLeft {
          0% { opacity: 1; transform: translateX(0); }
          100% { opacity: 0; transform: translateX(-12%); }
        }
        @keyframes spreadOutRight {
          0% { opacity: 1; transform: translateX(0); }
          100% { opacity: 0; transform: translateX(12%); }
        }
        @keyframes spreadFade {
          0% { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-4px); }
        }
        .spread-enter { animation: spreadIn 0.42s cubic-bezier(0.2, 0.6, 0.2, 1) both; }
        .spread-out-approve { animation: spreadOutRight 0.24s ease-in both; }
        .spread-out-reject  { animation: spreadOutLeft 0.24s ease-in both; }
        .spread-out-snooze  { animation: spreadFade 0.24s ease-in both; }

        /* The connector bar — the memorable element. */
        .connector {
          position: relative;
          height: 1px;
          background: linear-gradient(
            to right,
            color-mix(in oklab, var(--gold) 50%, transparent),
            var(--gold) 50%,
            color-mix(in oklab, var(--gold) 50%, transparent)
          );
        }
        .connector::before,
        .connector::after {
          content: "";
          position: absolute;
          top: 50%;
          width: 6px;
          height: 6px;
          border-radius: 9999px;
          background: var(--gold);
          transform: translateY(-50%);
          box-shadow: 0 0 10px color-mix(in oklab, var(--gold) 60%, transparent);
        }
        .connector::before { left: -3px; }
        .connector::after  { right: -3px; }

        /* Section labels — tiny caps, the editorial signature */
        .label {
          font-family: ui-monospace, "SFMono-Regular", "JetBrains Mono", monospace;
          font-size: 9.5px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--text-tertiary);
        }
        /* Big monospace similarity score */
        .score {
          font-family: ui-monospace, "SFMono-Regular", "JetBrains Mono", monospace;
          font-variant-numeric: tabular-nums;
          font-weight: 500;
          color: var(--gold);
        }
      `}</style>

      <PageHeader parentHref="/brain" parentLabel="brain"
        eyebrow="NOUR OS · Brain"
        title="Link review"
        description={
          loading
            ? "Loading…"
            : candidates.length === 0
              ? "Queue clear. The next mega-evening pass will surface fresh medium-confidence matches."
              : `${candidates.length} conversation${candidates.length === 1 ? "" : "s"} flagged for your call. Each row is a decision spread — conversation on the left, the mission it might belong to on the right, the cosine similarity drawn between them. Approve writes the link. Reject drops the suggestion. Snooze defers.`
        }
      />

      {/* 2026-05-24 · Wave V P0-#1 · staleness banner · paired with
          the loadError state set in load(). Pre-fix a failed reload
          showed last-known candidates as if fresh · operator could
          act on already-resolved rows. Now: rose banner persists
          until next successful load · retry button explicit. */}
      {loadError && (
        <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">
          <span className="flex-1">
            ⚠ Queue may be stale · failed to refresh · {loadError.slice(0, 100)}
          </span>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded border border-rose-500/40 px-2 py-1 text-[10px] font-mono uppercase tracking-wider hover:bg-rose-500/15 disabled:opacity-50"
          >
            retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-[var(--border-soft)] px-5 py-10 text-center text-xs text-[var(--text-tertiary)]">
          Loading queued candidates…
        </div>
      ) : candidates.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border-soft)] px-5 py-12 text-center">
          <p className="label mb-2">queue · empty</p>
          <p className="text-sm text-[var(--text-tertiary)]">
            Every queued conversation has been decided.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {candidates.map((c, i) => {
            const isPending = pending.has(c.id);
            const dep = departing.get(c.id);
            const animClass = dep
              ? `spread-out-${dep}`
              : "spread-enter";
            return (
              <article
                key={c.id}
                className={animClass}
                style={{ animationDelay: dep ? "0ms" : `${Math.min(i, 8) * 40}ms` }}
              >
                <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--bg-card)] hover:border-[color-mix(in_oklab,var(--gold)_30%,var(--border-soft))] transition-colors overflow-hidden">
                  {/* The spread — 5 cols / 1 col / 5 cols on desktop, stacked on mobile */}
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 md:gap-6 px-4 sm:px-6 py-5">
                    {/* LEFT — the conversation */}
                    <div className="min-w-0">
                      <p className="label mb-2">conversation</p>
                      <h3 className="text-[15px] sm:text-base font-medium text-[var(--text-primary)] leading-snug mb-2 line-clamp-2">
                        {c.conversationTitle ?? "(untitled)"}
                      </h3>
                      {c.pinnedSummary && (
                        <p className="text-[12.5px] text-[var(--text-secondary)] leading-relaxed line-clamp-3">
                          {c.pinnedSummary}
                        </p>
                      )}
                      {c.topicTags && (
                        <p className="mt-2 text-[10.5px] text-[var(--text-tertiary)] tracking-wide">
                          {c.topicTags}
                        </p>
                      )}
                    </div>

                    {/* MIDDLE — the connector. The differentiation anchor.
                        On mobile it becomes a horizontal connector below
                        the conversation; on desktop it's a centered
                        vertical-anchored horizontal bar with the score
                        floating above. */}
                    <div className="hidden md:flex flex-col items-center justify-center w-[88px] gap-3">
                      <span className="score text-[22px] leading-none">
                        {(c.similarity * 100).toFixed(0)}%
                      </span>
                      <div className="connector w-full" />
                      <span className="label">cosine</span>
                    </div>
                    <div className="flex md:hidden items-center gap-3">
                      <div className="connector flex-1" />
                      <span className="score text-[14px]">{(c.similarity * 100).toFixed(0)}%</span>
                      <div className="connector flex-1" />
                    </div>

                    {/* RIGHT — the mission */}
                    <div className="min-w-0 md:text-right">
                      <p className="label mb-2">mission</p>
                      <h3 className="text-[15px] sm:text-base font-medium text-[var(--gold)] leading-snug mb-2">
                        {c.missionTitle ?? "(unknown)"}
                      </h3>
                      <p className="text-[12.5px] text-[var(--text-tertiary)] leading-relaxed">
                        Approve to file this conversation under{" "}
                        <span className="text-[var(--text-secondary)]">
                          {c.missionTitle ?? "this mission"}
                        </span>
                        .
                      </p>
                    </div>
                  </div>

                  {/* Decision rail — sits below the spread */}
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-4 sm:px-6 py-3 border-t border-[var(--border-soft)] bg-[color-mix(in_oklab,var(--bg-card)_92%,var(--gold)_2%)]">
                    <button
                      onClick={() => decide(c, "approve")}
                      disabled={isPending}
                      className="group flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-[12px] font-medium tracking-wide bg-[var(--gold)] text-black hover:bg-[color-mix(in_oklab,var(--gold)_88%,white)] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Check size={13} className="group-hover:scale-110 transition-transform" />
                      Approve link
                    </button>
                    <button
                      onClick={() => decide(c, "reject")}
                      disabled={isPending}
                      className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-[12px] font-medium tracking-wide border border-[var(--border-soft)] text-[var(--text-secondary)] hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <X size={13} />
                      Reject
                    </button>
                    <button
                      onClick={() => decide(c, "snooze")}
                      disabled={isPending}
                      title="Snooze — defer until next pass"
                      className="flex items-center justify-center px-3 py-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Clock size={13} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
