"use client";

/**
 * ContradictionResolutionPanel — close the loop on stated-position
 * conflicts. Each row shows new vs old excerpt side-by-side with
 * 4 resolution buttons:
 *   current wins → mark old as deprecated
 *   old wins     → mark new as deprecated
 *   both valid   → context-dependent, dismiss from ticker
 *   dismiss      → false positive
 *
 * Accepts optional `focusKey` prop — when set, that row auto-expands
 * and scrolls into view (used by the ticker href).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/ui/glass-card";
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
  new_memory_id: string;
  old_memory_id: string;
  similarity: number;
  signal: "negation" | "reversal" | "antonym" | "compound" | "near_duplicate";
  new_excerpt: string;
  old_excerpt: string;
  days_apart: number;
  surfaced_at: string;
  status?: "unresolved" | "current_wins" | "old_wins" | "both_valid" | "dismissed";
  resolution_note?: string | null;
  resolved_at?: string | null;
  createdAt: string;
}

type Tab = "unresolved" | "history";

type ResolveStatus = "current_wins" | "old_wins" | "both_valid" | "dismissed";

export function ContradictionResolutionPanel({ focusKey }: { focusKey?: string | null }) {
  const [tab, setTab] = useState<Tab>("unresolved");
  const [busy, setBusy] = useState<string | null>(null);
  const [notingKey, setNotingKey] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [pendingResolve, setPendingResolve] = useState<ResolveStatus | null>(null);

  const utils = trpc.useUtils();
  const contraQuery = trpc.brain.contradictions.useQuery({
    includeResolved: tab === "history",
  });
  const resolveMutation = trpc.brain.resolveContradiction.useMutation();

  // A FAILED READ IS NOT A ZERO — and here it was the worst version of that.
  // This ended `?? (isError ? [] : null)`, so a failed query fell straight into
  // the empty branch and rendered a GREEN "Clean ledger · Nick's stated
  // positions are internally consistent". A read that failed was reported as
  // proof the self-model is coherent.
  const rows =
    (contraQuery.data?.contradictions as StoredContradiction[] | undefined) ?? null;
  const loading = contraQuery.isLoading;
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
        await resolveMutation.mutateAsync({ key, status, note });
        toast.success(
          status === "current_wins"
            ? "current position locked in · old deprecated"
            : status === "old_wins"
              ? "old position held · new deprecated"
              : status === "both_valid"
                ? "marked as context-dependent"
                : "dismissed as false positive",
        );
        setNotingKey(null);
        setNoteText("");
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
    setNoteText("");
    setPendingResolve(status);
  }, []);

  const visible = useMemo(() => {
    if (!rows) return [] as StoredContradiction[];
    if (tab === "unresolved") {
      return rows.filter((r) => !r.status || r.status === "unresolved");
    }
    return rows.filter((r) => r.status && r.status !== "unresolved");
  }, [rows, tab]);

  // Scroll focus row into view when panel opens via ticker href
  useEffect(() => {
    if (!focusKey || !rows) return;
    const el = document.getElementById(`contradiction-row-${focusKey}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusKey, rows]);

  return (
    <GlassCard>
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
                "text-[11px] font-mono px-2 py-1 rounded border transition-colors",
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

      <div className="space-y-2">
        {visible.map((c) => {
          const rowBusy = busy === c.key;
          const focused = focusKey === c.key;
          return (
            <div
              id={`contradiction-row-${c.key}`}
              key={c.key}
              className={cn(
                "p-2 rounded border transition-colors",
                c.status && c.status !== "unresolved"
                  ? "bg-[var(--bg-base)] border-[var(--border-default)] opacity-70"
                  : "bg-red-500/5 border-red-500/20",
                focused && "ring-1 ring-accent",
                rowBusy && "opacity-60",
              )}
            >
              <div className="flex items-center gap-2 mb-1.5 text-[11px] font-mono">
                <span className="text-red-400">{c.signal === "near_duplicate" ? "similar wording · which is current?" : c.signal}</span>
                <span className="text-[var(--text-tertiary)]">
                  {c.days_apart}d apart · sim {Math.round(c.similarity * 100)}%
                </span>
                {c.status && c.status !== "unresolved" && (
                  <span className="text-emerald-400">· {c.status.replace(/_/g, " ")}</span>
                )}
              </div>

              <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-start">
                <div className="min-w-0">
                  <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary">now</p>
                  <p className="text-[11px] text-[var(--text-primary)] break-words">
                    "{c.new_excerpt}"
                  </p>
                </div>
                <Split size={12} className="text-[var(--text-tertiary)] mt-3" />
                <div className="min-w-0">
                  <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary">
                    {c.days_apart}d ago
                  </p>
                  <p className="text-[11px] text-[var(--text-secondary)] break-words">
                    "{c.old_excerpt}"
                  </p>
                </div>
              </div>

              {(!c.status || c.status === "unresolved") && notingKey !== c.key && (
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <button
                    onClick={() => beginResolve(c.key, "current_wins")}
                    disabled={rowBusy}
                    className="h-6 px-2 rounded border border-edge-subtle text-fg-secondary hover:bg-surface-hover text-[11px] font-mono inline-flex items-center gap-1"
                    title="lock in current position, deprecate old"
                  >
                    <Check size={9} />
                    current wins
                  </button>
                  <button
                    onClick={() => beginResolve(c.key, "old_wins")}
                    disabled={rowBusy}
                    className="h-6 px-2 rounded border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-edge-strong text-[11px] font-mono inline-flex items-center gap-1"
                    title="hold old position, deprecate new"
                  >
                    old wins
                  </button>
                  <button
                    onClick={() => beginResolve(c.key, "both_valid")}
                    disabled={rowBusy}
                    className="h-6 px-2 rounded border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-emerald-400 hover:border-emerald-500/30 text-[11px] font-mono"
                    title="context-dependent, both still true"
                  >
                    both valid
                  </button>
                  <button
                    onClick={() => resolve(c.key, "dismissed")}
                    disabled={rowBusy}
                    className="h-6 w-6 rounded border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-red-400 hover:border-red-400/30 inline-flex items-center justify-center"
                    title="false positive"
                  >
                    <X size={10} />
                  </button>
                </div>
              )}

              {notingKey === c.key && pendingResolve && (
                <div className="mt-2 space-y-1.5">
                  <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary">
                    note (optional — why?) · applying: {pendingResolve.replace(/_/g, " ")}
                  </p>
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="optional: explain the reversal"
                    rows={2}
                    className="w-full px-2 py-1 bg-surface-interactive border border-[var(--border-default)] rounded text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-accent"
                  />
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => resolve(c.key, pendingResolve, noteText.trim() || undefined)}
                      disabled={rowBusy}
                      className="h-6 px-2 rounded border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 text-[11px] font-mono inline-flex items-center gap-1"
                    >
                      <Check size={9} /> confirm
                    </button>
                    <button
                      onClick={() => { setNotingKey(null); setNoteText(""); setPendingResolve(null); }}
                      className="h-6 px-2 rounded border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-red-400 text-[11px] font-mono inline-flex items-center gap-1"
                    >
                      <X size={9} /> cancel
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
              why="No new memory contradicts any old one right now. Nick's stated positions are internally consistent."
              unlock="Contradictions surface when a new memory semantically flips an older one (negation, reversal, antonym). A measured zero says the LEDGER is empty — it does not say whether the detector has seen enough traffic to have an opinion."
              tone="positive"
            />
          ) : (
            <EmptyState
              icon={Split}
              title="No resolved contradictions yet"
              provenance="ZERO"
              why="Every resolution gets logged here — current wins, old wins, both valid, or dismissed."
              unlock="Switch to Unresolved, work through the list, then come back."
              tone="neutral"
            />
          )
        )}
      </div>

      <p className="text-[11px] text-[var(--text-tertiary)] mt-3 leading-relaxed">
        "current wins" drops confidence on the old memory to 0.1 (deprecated). "old wins"
        does the same to the new one. "both valid" or "dismissed" just closes the loop without
        touching the memory rows. Threshold: sim ≥ 0.78 · age ≥ 7d · negation / reversal / antonym.
      </p>
    </GlassCard>
  );
}
