"use client";

/**
 * ThreadSuggestions · ADR-0013 · Phase D follow-up (2026-05-18)
 *
 * Surfaces entries the capture-hook scored in the 0.65-0.80 band
 * (between auto-join and ignore). Operator confirms ("join thread X")
 * or dismisses. Silent when nothing's pending.
 *
 * Lives between ThreadRail (active threads) and ThreadRadar
 * (convergence candidates) so the radar workflow goes:
 *   1. Coalescing themes → ThreadRadar (top)
 *   2. Pinned threads → ThreadRail
 *   3. Borderline joins → ThreadSuggestions
 * All three are quiet by default. Page looks unchanged unless
 * something fires.
 */

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { MasterySectionLabel } from "@/components/mastery/mastery-section-label";
import { logger as rootLogger } from "@/lib/logger";
import { sanitizeError } from "@/lib/utils/sanitize-error";

const log = rootLogger.withSurface("journal/thread-suggestions");

interface Suggestion {
  key: string;
  threadId: string;
  threadName: string;
  entrySource: "brain_dump" | "reflection" | "situation_log" | "decision_replay";
  entryId: string;
  excerpt: string;
  similarity: number;
  createdAt: string;
}

export function ThreadSuggestions({
  refreshSignal,
  onActioned,
}: {
  refreshSignal?: number;
  onActioned?: () => void;
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  // 2026-05-24 · Wave R · per-key action error surfacing. Pre-fix
  // both accept() + dismiss() wrapped mutateAsync in bare `catch {}`
  // with a comment "today: silent re-fetch" · operator tapped a
  // suggestion, server 401/500'd, UI just looped the same state.
  // No log, no toast, no feedback · indistinguishable from the
  // mutation working slowly. Now: log surfaces in /system/errors ·
  // banner surfaces the failure inline with a retry-by-retap hint.
  const [actionError, setActionError] = useState<string | null>(null);

  // Phase TT.2 (2026-05-22) · REST→tRPC · useAuthedFetch swapped for
  // trpc.journal.suggestions.useQuery. Errors still silently no-op
  // (suggestions are advisory · radar stays quiet) — the component
  // hides itself on loading/empty exactly as before. The query owns
  // the {data} envelope so no manual unwrap is needed.
  const suggestionsQuery = trpc.journal.suggestions.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const suggestions: Suggestion[] = suggestionsQuery.data ?? [];
  const loading = suggestionsQuery.isLoading;
  // local alias · keeps existing call-sites in handlers below readable
  const load = () => suggestionsQuery.refetch();

  useEffect(() => {
    if (refreshSignal != null) suggestionsQuery.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  // Phase TT.2 · accept/dismiss are now typed mutations · the strict
  // z.object({ key }) input means the payload can't drift from what
  // the server expects (the typed-payload-mismatch guard).
  const acceptMutation = trpc.journal.acceptSuggestion.useMutation();
  const dismissMutation = trpc.journal.dismissSuggestion.useMutation();

  const accept = async (key: string) => {
    if (busyKey) return;
    setBusyKey(key);
    setActionError(null);
    try {
      await acceptMutation.mutateAsync({ key });
      await load();
      onActioned?.();
    } catch (err) {
      // 2026-05-24 · Wave R · log + surface · pre-fix this was a
      // bare catch{} with a "today: silent re-fetch" comment.
      log.error("thread_suggestion_accept_failed", {
        key,
        error: sanitizeError(err),
      });
      setActionError(
        err instanceof Error
          ? `couldn't join thread · ${err.message.slice(0, 80)}`
          : "couldn't join thread · retry?",
      );
      await load();
    } finally {
      setBusyKey(null);
    }
  };

  const dismiss = async (key: string) => {
    if (busyKey) return;
    setBusyKey(key);
    setActionError(null);
    try {
      await dismissMutation.mutateAsync({ key });
      await load();
    } catch (err) {
      log.error("thread_suggestion_dismiss_failed", {
        key,
        error: sanitizeError(err),
      });
      setActionError(
        err instanceof Error
          ? `couldn't dismiss · ${err.message.slice(0, 80)}`
          : "couldn't dismiss · retry?",
      );
      await load();
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) return null;
  if (suggestions.length === 0) return null;

  return (
    <section className="mb-8 space-y-3">
      <MasterySectionLabel
        label="Possible joins"
        count={suggestions.length}
        action={<span className="text-white/30">borderline matches</span>}
      />
      {/* 2026-05-24 · Wave R · per-action error banner · paired with
          the log lines in accept/dismiss. Pre-fix a failed accept
          looked identical to a slow accept · operator would re-tap
          the same suggestion forever. Auto-clears on next tap. */}
      {actionError && (
        <div className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[10px] text-rose-300">
          ⚠ {actionError}
        </div>
      )}
      <ul className="space-y-2">
        {suggestions.map((s) => (
          <li
            key={s.key}
            className="rounded-lg border border-white/10 bg-white/[0.02] p-3 transition hover:bg-white/[0.04]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wider text-white/40 mb-1">
                  thread · {s.threadName} · similarity{" "}
                  {(s.similarity * 100).toFixed(0)}%
                </p>
                <p className="text-sm text-white/80 line-clamp-2">
                  {s.excerpt}
                </p>
              </div>
              <div className="shrink-0 flex flex-col gap-1.5 sm:flex-row">
                <button
                  type="button"
                  onClick={() => accept(s.key)}
                  disabled={busyKey === s.key}
                  className="text-[10px] uppercase tracking-wider px-3 min-h-[44px] rounded border border-[#FDB913]/40 text-amber-200 hover:bg-[#FDB913]/10 disabled:opacity-30"
                >
                  join
                </button>
                <button
                  type="button"
                  onClick={() => dismiss(s.key)}
                  disabled={busyKey === s.key}
                  className="text-[10px] uppercase tracking-wider px-3 min-h-[44px] rounded border border-white/15 text-white/50 hover:bg-white/5 disabled:opacity-30"
                >
                  skip
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
