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

import { useEffect, useState } from "react";
import { authedFetch } from "@/hooks/use-authed-fetch";
import { toast } from "sonner";

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

interface EvolutionResp {
  stale: StaleCandidate[];
  redundant: RedundantPair[];
  lowTrust: LowTrustCandidate[];
  totalCandidates: number;
}

export function WisdomEvolutionPanel({ onChange }: { onChange?: () => void }) {
  const [data, setData] = useState<EvolutionResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/brain/wisdom/evolution", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (r.ok) {
        const json = (await r.json()) as EvolutionResp;
        setData(json);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function deprecateOne(id: string, label: string) {
    if (busyId) return;
    setBusyId(id);
    // v10.0.415 · telemetry · fire-and-forget so click latency is unchanged
    void fetch("/api/brain/telemetry", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "evolution_deprecate", tags: { wisdomId: id, key: label } }),
    }).catch(() => null);
    try {
      const r = await authedFetch(`/api/brain/wisdom/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "deprecate" }),
      });
      if (r.ok) {
        toast.success(`Deprecated · ${label}`);
        // Local optimistic refresh
        await load();
        onChange?.();
      } else {
        toast.error(`Could not deprecate · HTTP ${r.status}`);
      }
    } catch {
      toast.error("Network error");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-[var(--gold)]/30 bg-[var(--bg-raised)] p-4">
        <p className="text-[11px] font-mono uppercase tracking-wider text-[var(--gold)]">
          loading evolution candidates…
        </p>
      </div>
    );
  }
  if (!data || data.totalCandidates === 0) {
    return (
      <div className="rounded-lg border border-[var(--gold)]/30 bg-[var(--bg-raised)] p-4">
        <p className="text-[11px] font-mono uppercase tracking-wider text-[var(--gold)]">
          evolution review
        </p>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          No candidates · the wisdom corpus is healthy. The brain-feedback-loop cron
          will refresh this list daily at 05:00 UTC.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--gold)]/30 bg-[var(--bg-raised)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-eyebrow">Self-evolution review</p>
          <h3 className="section-title text-base mt-1">
            {data.totalCandidates} wisdom candidate{data.totalCandidates === 1 ? "" : "s"}
          </h3>
        </div>
        <span className="text-[9px] font-mono text-[var(--text-tertiary)] uppercase tracking-wider">
          v10.0.406
        </span>
      </div>

      {data.stale.length > 0 && (
        <section className="mb-4">
          <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-secondary)] mb-2">
            stale · cold {data.stale.length}
          </p>
          <ul className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {data.stale.slice(0, 25).map((c) => (
              <li key={c.id} className="flex items-start gap-3 rounded border border-[var(--border-default)] bg-[var(--bg-base)] p-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-[var(--text-primary)] leading-snug" style={{ maxWidth: "60ch" }}>
                    {c.content.slice(0, 180)}
                    {c.content.length > 180 ? "…" : ""}
                  </p>
                  <p className="mt-1 text-[10px] font-mono text-[var(--text-tertiary)]">
                    {c.daysSinceLastSeen}d cold · {(c.confidence * 100).toFixed(0)}% conf · {c.key}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyId === c.id}
                  onClick={() => void deprecateOne(c.id, c.key)}
                  className="text-[10px] font-mono uppercase tracking-wider px-3 py-2 sm:px-2 sm:py-1 min-h-[44px] sm:min-h-0 rounded border border-rose-500/40 text-rose-400 hover:bg-rose-500/10 disabled:opacity-50 shrink-0"
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
          <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-secondary)] mb-2">
            redundant · merge {data.redundant.length}
          </p>
          <ul className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {data.redundant.slice(0, 25).map((c) => (
              <li key={`${c.keepId}_${c.mergeId}`} className="rounded border border-[var(--border-default)] bg-[var(--bg-base)] p-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 mb-1">
                      keep · {c.keepKey} · {(c.keepConfidence * 100).toFixed(0)}%
                    </p>
                    <p className="text-[12px] text-[var(--text-primary)] leading-snug">
                      {c.keepContent.slice(0, 150)}
                      {c.keepContent.length > 150 ? "…" : ""}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-wider text-rose-400 mb-1">
                      merge · {c.mergeKey} · {(c.mergeConfidence * 100).toFixed(0)}%
                    </p>
                    <p className="text-[12px] text-[var(--text-secondary)] leading-snug">
                      {c.mergeContent.slice(0, 150)}
                      {c.mergeContent.length > 150 ? "…" : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] font-mono text-[var(--text-tertiary)]">
                    cosine {c.similarity} · topics: {c.sharedTopics.join(", ")}
                  </span>
                  <button
                    type="button"
                    disabled={busyId === c.mergeId}
                    onClick={() => void deprecateOne(c.mergeId, c.mergeKey)}
                    className="text-[10px] font-mono uppercase tracking-wider px-3 py-2 sm:px-2 sm:py-1 min-h-[44px] sm:min-h-0 rounded border border-rose-500/40 text-rose-400 hover:bg-rose-500/10 disabled:opacity-50"
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
          <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-secondary)] mb-2">
            low trust · review {data.lowTrust.length}
          </p>
          <ul className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {data.lowTrust.slice(0, 25).map((c) => (
              <li key={c.id} className="flex items-start gap-3 rounded border border-[var(--border-default)] bg-[var(--bg-base)] p-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-[var(--text-primary)] leading-snug" style={{ maxWidth: "60ch" }}>
                    {c.content.slice(0, 180)}
                    {c.content.length > 180 ? "…" : ""}
                  </p>
                  <p className="mt-1 text-[10px] font-mono text-[var(--text-tertiary)]">
                    {(c.confidence * 100).toFixed(0)}% conf · {c.key}
                  </p>
                </div>
                {/* v10.0.414 · low-trust gets review-then-deprecate · operator may
                    want to EDIT the wisdom rather than nuke it. The "review" link
                    scrolls to the wisdom card on /brain/wisdom?focus=<key> where
                    the existing inline edit affordance handles the rewrite. */}
                <div className="flex flex-col gap-1 shrink-0">
                  <a
                    href={`/brain/wisdom?focus=${encodeURIComponent(c.key)}`}
                    className="text-[10px] font-mono uppercase tracking-wider px-3 py-2 sm:px-2 sm:py-1 min-h-[44px] sm:min-h-0 flex items-center justify-center rounded border border-[var(--gold)]/40 text-[var(--gold)] hover:bg-[var(--gold)]/10 text-center"
                  >
                    review →
                  </a>
                  <button
                    type="button"
                    disabled={busyId === c.id}
                    onClick={() => void deprecateOne(c.id, c.key)}
                    className="text-[10px] font-mono uppercase tracking-wider px-3 py-2 sm:px-2 sm:py-1 min-h-[44px] sm:min-h-0 rounded border border-rose-500/40 text-rose-400 hover:bg-rose-500/10 disabled:opacity-50"
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
