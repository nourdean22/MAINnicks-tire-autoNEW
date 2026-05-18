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
 * Aesthetic: editorial-minimalist · gold accent only on the live
 * action affordances · zero gradients · 44px tap targets · per
 * /goals + /scoreboard precedent.
 */

import { useMemo, useState } from "react";
import { authedFetch, useAuthedFetch } from "@/hooks/use-authed-fetch";
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
  // Phase D · audit-fix #1 (2026-05-18) · collapsed bespoke
  // state-mgmt block to the shared useAuthedFetch hook. Same
  // semantics · ~14 LOC removed · matches the pattern the
  // other mastery surfaces should converge on.
  const { data, error, loading, reload } = useAuthedFetch<{
    data: Candidate[];
  }>("/api/journal/convergence");
  const candidates = data?.data ?? [];

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
      const res = await authedFetch("/api/journal/convergence", {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        ranAt: string;
        scannedEntries: number;
        candidatesFound: number;
        candidatesAfterPrune: number;
      };
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
            className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition min-h-[32px] inline-flex items-center"
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
              className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              {scanState.busy ? "scanning..." : "scan again"}
            </button>
          }
        />
        <p className="text-xs text-[var(--text-secondary)]">
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
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-50"
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

  const confirm = async () => {
    if (!finalName || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await authedFetch("/api/journal/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clusterHash: candidate.clusterHash,
          name: finalName,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
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
      const res = await authedFetch(
        `/api/journal/convergence?hash=${encodeURIComponent(
          candidate.clusterHash,
        )}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onActioned();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-lg border border-[#FDB913]/30 bg-[#FDB913]/[0.04] p-4">
      {/* Header · size + coherence + dismiss */}
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div className="text-xs uppercase tracking-wider text-amber-200/80">
          {candidate.size} entries coalescing
          <span className="ml-2 text-white/40">
            coherence {(candidate.coherence * 100).toFixed(0)}%
          </span>
        </div>
        <button
          type="button"
          onClick={dismiss}
          disabled={busy}
          className="text-[10px] uppercase tracking-wider text-white/40 hover:text-white/70 disabled:opacity-30 min-h-[44px] px-2"
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
            className="text-sm text-white/75 flex gap-2"
          >
            <span className="text-white/30 tabular-nums shrink-0">
              {i + 1}.
            </span>
            <span className="line-clamp-2">{m.excerpt}</span>
          </li>
        ))}
        {candidate.members.length > 5 ? (
          <li className="text-[10px] text-white/30 tabular-nums uppercase tracking-wider pl-5">
            + {candidate.members.length - 5} more
          </li>
        ) : null}
      </ul>

      {/* Name picker */}
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">
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
                  ? "border-[#FDB913] bg-[#FDB913]/10 text-amber-100"
                  : "border-white/15 text-white/70 hover:bg-white/5"
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
            className="flex-1 min-h-[44px] px-3 rounded border border-white/15 bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#FDB913]/60"
          />
          <button
            type="button"
            onClick={confirm}
            disabled={busy || finalName.length === 0}
            className="text-xs uppercase tracking-wider px-4 min-h-[44px] rounded bg-[#FDB913] text-black font-medium hover:bg-[#FDB913]/90 disabled:opacity-30 disabled:cursor-not-allowed"
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
