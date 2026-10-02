"use client";

/**
 * ThreadRadar · ADR-0013 · Phase D (2026-05-18)
 *
 * Surfaces convergence candidates the nightly cron detected. Per
 * candidate, the operator sees:
 *   - up to 5 entry excerpts that converged
 *   - 3 Nick-suggested theme names
 *   - free-text "name your own" input
 *   - dismiss button
 *
 * Confirming the name spawns a JournalThread + pins it · candidate
 * dissolves into the persistent thread rail. Dismiss soft-deletes
 * the candidate so the next cron doesn't re-surface it.
 *
 * Aesthetic: editorial-minimalist · gold only on the selected
 * name pill · zero gradients · 44px tap targets · per
 * /goals + /scoreboard precedent.
 */

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { MasterySectionLabel } from "@/components/mastery/mastery-section-label";

interface CandidateMember {
  entrySource: "brain_dump" | "reflection" | "situation_log" | "decision_replay";
  entryId: string;
  excerpt: string;
  createdAt: string;
}

interface Candidate {
  clusterHash: string;
  size: number;
  coherence: number;
  nameSuggestions: string[];
  detectedAt: string;
  members: CandidateMember[];
}

export function ThreadRadar({
  onThreadCreated,
}: {
  onThreadCreated?: () => void;
}) {
  // Phase TT.2 (2026-05-22) · REST→tRPC · useAuthedFetch swapped for
  // trpc.journal.convergence.useQuery. The query owns the {data}
  // envelope · loading stays silent on initial load and error
  // collapses to the empty-radar surface, both exactly as before.
  const convergenceQuery = trpc.journal.convergence.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  const candidates: Candidate[] = convergenceQuery.data ?? [];
  const error = convergenceQuery.error;
  const loading = convergenceQuery.isLoading;
  const reload = () => convergenceQuery.refetch();

  // Phase TT.2 · manual convergence scan is now a typed mutation ·
  // delegates to the same runConvergenceScan the nightly cron uses.
  const scanMutation = trpc.journal.runConvergenceScan.useMutation();

  // Manual scan trigger · 2026-05-18 PM follow-up · operator can
  // now run the convergence pipeline on demand instead of waiting
  // for the nightly 22:00 UTC cron. Reports last-scan telemetry
  // inline so they see the system working even when no candidates
  // surface (e.g. when entries don't yet cluster ≥0.75 cohesion).
  const [scanState, setScanState] = useState<{
    busy: boolean;
    lastResult: {
      scanned: number;
      found: number;
      afterPrune: number;
      at: string;
    } | null;
    error: string | null;
  }>({ busy: false, lastResult: null, error: null });

  const triggerScan = async () => {
    if (scanState.busy) return;
    setScanState((s) => ({ ...s, busy: true, error: null }));
    try {
      // Phase TT.2 · typed mutation · the result shape (ranAt +
      // scanned/found/afterPrune counts) is the same envelope the
      // REST route returned · just no HTTP-status unwrap needed.
      const json = await scanMutation.mutateAsync();
      setScanState({
        busy: false,
        lastResult: {
          scanned: json.scannedEntries,
          found: json.candidatesFound,
          afterPrune: json.candidatesAfterPrune,
          at: json.ranAt,
        },
        error: null,
      });
      // Reload candidates · auto-show any new ones the scan just wrote.
      reload();
    } catch (err) {
      setScanState({
        busy: false,
        lastResult: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  if (loading) return null; // silent on initial load

  // Empty-radar surface: still render so the operator has a "scan
  // now" affordance + sees the last-scan telemetry when one ran.
  if (error || candidates.length === 0) {
    // Only show the empty rail when there's a reason to (operator
    // just triggered a scan, OR there's a stale result to show).
    // Hide entirely if neither — keeps page calm when nothing yet.
    if (!scanState.busy && !scanState.lastResult && !scanState.error) {
      return (
        <section className="mb-8">
          <button
            type="button"
            onClick={triggerScan}
            className="text-[13px] font-medium text-fg-secondary hover:text-fg transition-colors min-h-[32px] inline-flex items-center"
            title="run the convergence scan now · normally fires nightly at 22:00 UTC"
          >
            scan radar now →
          </button>
        </section>
      );
    }
    return (
      <section className="mb-8 space-y-3">
        <MasterySectionLabel
          label="Pattern radar"
          action={
            <button
              type="button"
              onClick={triggerScan}
              disabled={scanState.busy}
              className="text-fg-tertiary hover:text-fg disabled:opacity-50"
            >
              {scanState.busy ? "scanning..." : "scan again"}
            </button>
          }
        />
        <p className="text-xs text-fg-secondary">
          {scanState.error ? (
            <span className="text-red-300">{scanState.error}</span>
          ) : scanState.lastResult ? (
            <>
              No themes coalescing yet · scanned{" "}
              {scanState.lastResult.scanned} entries · found{" "}
              {scanState.lastResult.found} candidate
              {scanState.lastResult.found === 1 ? "" : "s"}
              {scanState.lastResult.afterPrune !==
              scanState.lastResult.found
                ? ` (${scanState.lastResult.afterPrune} new after pruning existing-thread members)`
                : ""}
              .
            </>
          ) : (
            "Scanning recent entries for emerging themes..."
          )}
        </p>
      </section>
    );
  }

  return (
    <section className="mb-8 space-y-3">
      <MasterySectionLabel
        label={`Coalescing · ${candidates.length} ${candidates.length === 1 ? "theme" : "themes"}`}
        action={
          <button
            type="button"
            onClick={triggerScan}
            disabled={scanState.busy}
            className="text-fg-tertiary hover:text-fg disabled:opacity-50"
            title="re-run the convergence scan"
          >
            {scanState.busy ? "scanning..." : "rescan"}
          </button>
        }
      />
      <ul className="space-y-3">
        {candidates.map((c) => (
          <CandidateCard
            key={c.clusterHash}
            candidate={c}
            onActioned={() => {
              reload();
              onThreadCreated?.();
            }}
          />
        ))}
      </ul>
    </section>
  );
}

function CandidateCard({
  candidate,
  onActioned,
}: {
  candidate: Candidate;
  onActioned: () => void;
}) {
  const [chosen, setChosen] = useState<string>(
    candidate.nameSuggestions[0] ?? "",
  );
  const [custom, setCustom] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const finalName = useMemo(() => {
    const c = custom.trim();
    return c.length > 0 ? c : chosen.trim();
  }, [custom, chosen]);

  // Phase TT.2 (2026-05-22) · REST→tRPC · confirm sends the candidate's
  // clusterHash through createThread (confirm-candidate mode) · dismiss
  // soft-deletes the candidate. Both typed mutations · the router maps
  // business rejections to BAD_REQUEST so the inline err surface is
  // preserved verbatim.
  const confirmMutation = trpc.journal.createThread.useMutation();
  const dismissMutation = trpc.journal.dismissCandidate.useMutation();

  const confirm = async () => {
    if (!finalName || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await confirmMutation.mutateAsync({
        clusterHash: candidate.clusterHash,
        name: finalName,
      });
      onActioned();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await dismissMutation.mutateAsync({ hash: candidate.clusterHash });
      onActioned();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-surface border border-edge-default bg-surface-raised p-4">
      {/* Header · size + coherence + dismiss */}
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div className="text-[13px] font-medium text-fg">
          {candidate.size} entries coalescing
          <span className="ml-2 font-mono text-[12px] text-fg-tertiary">
            coherence {(candidate.coherence * 100).toFixed(0)}%
          </span>
        </div>
        <button
          type="button"
          onClick={dismiss}
          disabled={busy}
          className="text-[13px] font-medium text-fg-tertiary hover:text-fg disabled:opacity-30 min-h-[44px] px-2"
          title="not a real theme · don't re-fire"
        >
          dismiss
        </button>
      </div>

      {/* Excerpts · first 5 members */}
      <ul className="space-y-1.5 mb-4">
        {candidate.members.slice(0, 5).map((m, i) => (
          <li
            key={`${m.entrySource}:${m.entryId}`}
            className="text-sm text-fg-secondary flex gap-2"
          >
            <span className="text-fg-tertiary tabular-nums shrink-0">
              {i + 1}.
            </span>
            <span className="line-clamp-2">{m.excerpt}</span>
          </li>
        ))}
        {candidate.members.length > 5 ? (
          <li className="text-[11px] font-mono text-fg-tertiary tabular-nums pl-5">
            + {candidate.members.length - 5} more
          </li>
        ) : null}
      </ul>

      {/* Name picker */}
      <div className="space-y-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
          Name this theme
        </p>
        <div className="flex flex-wrap gap-2">
          {candidate.nameSuggestions.slice(0, 3).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setChosen(s);
                setCustom("");
              }}
              className={`text-xs px-3 py-2 rounded-full border min-h-[44px] transition ${
                chosen === s && custom.trim().length === 0
                  ? "border-gold bg-accent-soft text-fg"
                  : "border-edge-default text-fg-secondary hover:bg-surface-hover"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex gap-2 items-stretch">
          <input
            type="text"
            value={custom}
            onChange={(e) => setCustom(e.target.value.slice(0, 120))}
            placeholder="or type your own"
            className="flex-1 min-h-[44px] px-3 rounded-control border border-edge-default bg-transparent text-sm text-fg placeholder:text-fg-tertiary focus:outline-none focus:border-gold/60"
          />
          <button
            type="button"
            onClick={confirm}
            disabled={busy || finalName.length === 0}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-control border border-edge-default px-4 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {busy ? "..." : "pin thread"}
          </button>
        </div>
        {err ? (
          <p className="text-[11px] text-red-300">{err}</p>
        ) : null}
      </div>
    </li>
  );
}
