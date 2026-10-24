"use client";

/**
 * ContradictionResolutionPanel: close the loop on stated-position
 * conflicts. Each row shows new vs old excerpt side-by-side with
 * 4 resolution buttons:
 *   current wins → mark old as deprecated
 *   old wins     → mark new as deprecated
 *   both valid   → context-dependent, dismiss from ticker
 *   dismiss      → false positive
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { AlertTriangle, Check, X, Split, Loader2 } from "lucide-react";
import { toast } from "sonner";
// Phase B.6d (2026-05-22) · migrated off `authedFetch("/api/contradictions")`
// (GET `?all=1` + PATCH) onto `trpc.brain.contradictions` (reactive read ·
// `includeResolved` typed input) + `trpc.brain.resolveContradiction`
// (mutation).
import { trpc } from "@/lib/trpc/client";
import { AnimatedCounter } from "@/components/ui/animated-counter";

interface StoredContradiction {
  key: string;
  /** "table" = the thinking engine's claim-vs-record row (key `tbl:<id>`); its excerpts are claim / record. */
  source?: "table" | "memory";
  new_memory_id?: string;
  old_memory_id?: string;
  similarity?: number;
  signal: "negation" | "reversal" | "antonym" | "compound" | "near_duplicate" | "claim_gap";
  category?: string;
  severity?: string;
  recorded?: string;
  /** "ai_detected" = the thinking engine's inference from his records, not his words. */
  claim_source?: string;
  new_excerpt: string;
  old_excerpt: string;
  days_apart: number;
  surfaced_at: string;
  /** "expired" (table rows only) = closed by the 30-day auto-resolve, not by Nour. */
  status?: "unresolved" | "current_wins" | "old_wins" | "both_valid" | "dismissed" | "expired";
  resolution_note?: string | null;
  resolved_at?: string | null;
  createdAt: string;
}

type Tab = "unresolved" | "history";

type ResolveStatus = "current_wins" | "old_wins" | "both_valid" | "dismissed";

/** A table row's status in plain words: his answer, the 30-day expiry, or "closed". */
function tableStatusLabel(status: string | undefined): string {
  if (status === "expired") return "expired after 30 days";
  return TABLE_ANSWERS.find((a) => a.status === status)?.label.toLowerCase() ?? "closed";
}

/** claim_source values that are his own words; anything else (the engine's "ai_detected") is inferred. */
const OWN_WORDS_SOURCES = new Set(["chat", "brain_dump", "commitment"]);

/** The three answers to a claim-vs-record row, on the panel's existing statuses (service maps them to resolved_how). */
const TABLE_ANSWERS: ReadonlyArray<{ label: string; status: ResolveStatus; title: string }> = [
  { label: "Record is right", status: "current_wins", title: "the record is right, the claim was wrong" },
  { label: "Outdated", status: "old_wins", title: "the claim is outdated, things moved on" },
  { label: "Ignore", status: "dismissed", title: "not worth tracking" },
];

export function ContradictionResolutionPanel() {
  const [tab, setTab] = useState<Tab>("unresolved");
  const [busy, setBusy] = useState<string | null>(null);
  const [notingKey, setNotingKey] = useState<string | null>(null);
  const [pendingResolve, setPendingResolve] = useState<ResolveStatus | null>(null);

  const utils = trpc.useUtils();
  const contraQuery = trpc.brain.contradictions.useQuery({
    includeResolved: tab === "history",
  });
  const resolveMutation = trpc.brain.resolveContradiction.useMutation();

  // A FAILED READ IS NOT A ZERO: and here it was the worst version of that.
  // This ended `?? (isError ? [] : null)`, so a failed query fell straight into
  // the empty branch and rendered a GREEN "Clean ledger · Nick's stated
  // positions are internally consistent". A read that failed was reported as
  // proof the self-model is coherent.
  const rows =
    (contraQuery.data?.contradictions as StoredContradiction[] | undefined) ?? null;
  const loading = contraQuery.isLoading;
  // A capped page of the claim-vs-record table is never presented as the whole ledger.
  const tableTotals = (contraQuery.data as { table?: { total: number; shown: number } } | undefined)?.table;
  const loadedAt = contraQuery.dataUpdatedAt || null;

  const load = useCallback(() => {
    void utils.brain.contradictions.invalidate();
  }, [utils]);

  // Surface a load failure as a toast once per error (matches the
  // legacy `catch → toast.error` · React Query has no per-fetch catch).
  useEffect(() => {
    if (contraQuery.isError) {
      toast.error(`load failed: ${contraQuery.error.message}`);
    }
  }, [contraQuery.isError, contraQuery.error]);

  const resolve = useCallback(
    async (key: string, status: ResolveStatus, note?: string) => {
      setBusy(key);
      try {
        const res = await resolveMutation.mutateAsync({ key, status, note });
        // A table row someone closed first keeps THEIR answer: report what is stored, not what was tapped.
        const stored = res?.contradiction?.status ?? status;
        const storedLabel = tableStatusLabel(stored);
        toast.success(`${res?.alreadyResolved ? "already closed" : "closed"} · ${storedLabel}`);
        setNotingKey(null);
        setPendingResolve(null);
        await utils.brain.contradictions.invalidate();
      } catch (e) {
        toast.error(`resolve failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        setBusy(null);
      }
    },
    [resolveMutation, utils],
  );

  const beginResolve = useCallback((key: string, status: ResolveStatus) => {
    setNotingKey(key);
    setPendingResolve(status);
  }, []);

  const visible = useMemo(() => {
    if (!rows) return [] as StoredContradiction[];
    if (tab === "unresolved") {
      return rows.filter((r) => !r.status || r.status === "unresolved");
    }
    return rows.filter((r) => r.status && r.status !== "unresolved");
  }, [rows, tab]);

  return (
    <div className="border-t border-edge pt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <AlertTriangle size={12} className="text-red-400" />
          <p className="section-label">Contradictions</p>
          {rows && (
            <span className="rounded-full border border-red-500/30 bg-red-500/10 px-1.5 py-px text-[11px] font-mono text-red-300">
              <AnimatedCounter value={visible.length} />
            </span>
          )}
          <FreshnessChip lastFetchedAt={loadedAt} source="brain" compact onReload={() => void load()} />
          <span className="text-[11px] font-mono text-[var(--text-tertiary)]">
            · drift against stated positions
          </span>
        </div>
        <div className="flex items-center gap-1">
          {(["unresolved", "history"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "text-[11px] font-mono px-2 py-1 rounded-control border transition-colors",
                tab === t
                  ? "bg-red-500/10 text-red-400 border-red-500/30"
                  : "border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)]",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {loading && !rows && (
        <div className="flex items-center gap-2 py-6 justify-center text-[11px] text-[var(--text-tertiary)]">
          <Loader2 size={12} className="animate-spin" />
          loading…
        </div>
      )}

      {tableTotals && tableTotals.shown < tableTotals.total && (
        <p className="mb-2 text-[11px] font-mono text-[var(--text-tertiary)]">
          showing {tableTotals.shown} of {tableTotals.total} claim-vs-record rows
        </p>
      )}

      <div className="space-y-2">
        {visible.map((c) => {
          const rowBusy = busy === c.key;
          const open = !c.status || c.status === "unresolved";
          return (
            <div
              id={`contradiction-row-${c.key}`}
              key={c.key}
              className={cn(
                "p-2 rounded-micro border transition-colors",
                c.status && c.status !== "unresolved"
                  ? "bg-[var(--bg-base)] border-[var(--border-default)] opacity-70"
                  : "bg-red-500/5 border-red-500/20",
                rowBusy && "opacity-60",
              )}
            >
              <div className="flex items-center gap-2 mb-1.5 text-[11px] font-mono">
                <span className="text-red-400">claim vs record · {c.category}</span>
                <span className="text-[var(--text-tertiary)]">
                  {c.severity} · recorded {c.recorded}
                </span>
                {c.status && c.status !== "unresolved" && (
                  <span className="text-emerald-400">· {tableStatusLabel(c.status)}</span>
                )}
              </div>

              <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-start">
                <div className="min-w-0">
                  <p className="text-[11px] font-mono text-fg-tertiary">{OWN_WORDS_SOURCES.has(c.claim_source ?? "") ? "You said" : "Inferred claim"}
                  </p>
                  <p className="text-[11px] text-[var(--text-primary)] break-words">
                    "{c.new_excerpt}"
                  </p>
                </div>
                <Split size={12} className="text-[var(--text-tertiary)] mt-3" />
                <div className="min-w-0">
                  <p className="text-[11px] font-mono text-fg-tertiary">
                    Record shows
                  </p>
                  <p className="text-[11px] text-[var(--text-secondary)] break-words">
                    "{c.old_excerpt}"
                  </p>
                </div>
              </div>

              {open && notingKey !== c.key && (
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {TABLE_ANSWERS.map((a) => (
                    <button
                      key={a.status}
                      onClick={() => beginResolve(c.key, a.status)}
                      disabled={rowBusy}
                      className="inline-flex min-h-11 items-center rounded-control px-2.5 sm:min-h-6 sm:px-2 border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-edge-strong text-[11px] font-mono"
                      title={a.title}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}

              {notingKey === c.key && pendingResolve && (
                <div className="mt-2 space-y-1.5">
                  {/* The table has no note column: the confirm step is the whole second tap. */}
                  <p role="status" className="text-[11px] font-mono text-fg-tertiary">
                    Close as: {tableStatusLabel(pendingResolve)}?
                  </p>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => resolve(c.key, pendingResolve)}
                      disabled={rowBusy}
                      // The confirm button takes focus from the tapped answer.
                      autoFocus
                      className="inline-flex min-h-11 items-center rounded-control px-2.5 sm:min-h-6 sm:px-2 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 text-[11px] font-mono gap-1"
                    >
                      <Check size={9} /> confirm
                    </button>
                    <button
                      onClick={() => { setNotingKey(null); setPendingResolve(null); }}
                      className="inline-flex min-h-11 items-center rounded-control px-2.5 sm:min-h-6 sm:px-2 border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-red-400 text-[11px] font-mono gap-1"
                    >
                      <X size={9} /> Cancel
                    </button>
                  </div>
                </div>
              )}

              {c.resolution_note && (
                <p className="text-[11px] text-[var(--text-tertiary)] mt-1">
                  note: {c.resolution_note}
                </p>
              )}
            </div>
          );
        })}

        {!loading && !rows && (
          <EmptyState
            icon={Split}
            title={contraQuery.isError ? "Contradictions unavailable" : "Ledger not read"}
            provenance={contraQuery.isError ? "ERROR" : "UNMEASURED"}
            tone="warning"
            why="The contradiction ledger could not be read, so nothing is known about whether the self-model is consistent. That is NOT a clean ledger."
            unlock="Reload above. If it keeps failing, check the brain router."
          />
        )}
        {!loading && rows && visible.length === 0 && (
          tab === "unresolved" ? (
            <EmptyState
              icon={Check}
              title="Clean ledger"
              provenance="ZERO"
              why="No open claim-vs-record gap right now."
              unlock="The nightly thinking engine records a gap when what you said does not match the record. A measured zero says the LEDGER is empty: it does not say whether the engine has had enough to compare."
              tone="positive"
            />
          ) : (
            <EmptyState
              icon={Split}
              title="No resolved contradictions yet"
              provenance="ZERO"
              why="Each answer you give is kept here, whether the record was right, out of date, or not worth acting on. Rows nobody answers expire after 30 days."
              unlock="Switch to Unresolved, work through the list, then come back."
              tone="neutral"
            />
          )
        )}
      </div>

      <p className="text-[11px] text-[var(--text-tertiary)] mt-3 leading-relaxed">
        Claim-vs-record rows come from the nightly thinking engine; your answer is stored on the row,
        and rows nobody answers expire after 30 days.
      </p>
    </div>
  );
}
