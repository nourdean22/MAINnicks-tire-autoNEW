"use client";

// FRESHNESS_EXEMPT — animated visual decoration (stream of predicted
// next-actions); not a data view, no DB-backed payload to age.

/**
 * GhostNickStrip — shadow predictor surface on HQ. Apr 19.
 *
 * Small panel below the signal zone that says "Ghost thinks you'll
 * tackle these 3 things next" — each with a confidence %, a hover
 * on the signals that drove the pick, and a running accuracy pill
 * once we have enough outcomes to be honest about our calibration.
 *
 * Auto-polls every 15 min so the predictions stay fresh without the
 * user having to do anything. Force-recompute button triggers POST.
 */

import { useCallback, useState } from "react";
import { GlassCard } from "@/components/ui/glass-card";
import { DismissButton } from "@/components/ui/dismiss-button";
import { cn } from "@/lib/utils";
import { Loader2, RefreshCw, Ghost, Target } from "lucide-react";
import { useUltronFetch } from "@/lib/ultron/client-cache";

import { authedFetch } from "@/hooks/use-authed-fetch";
interface Prediction {
  task_id: string | null;
  title: string;
  confidence: number;
  signals: string[];
  matched_skills: string[];
  dismissed?: boolean;
}

interface Bundle {
  predictions: Prediction[];
  predicted_at: string;
  horizon_hours: number;
  context_signature: string;
}

interface Accuracy {
  hits: number;
  misses: number;
  surprises: number;
  evaluated_at: string;
  last_check_at: string;
}

interface Payload {
  bundle: Bundle | null;
  accuracy: Accuracy | null;
}

export function GhostNickStrip() {
  const { data, loading, refetch } = useUltronFetch<Payload>("/api/brain/ghost-predict", {
    ttlMs: 900_000, // 15 min
    pollMs: 900_000,
  });
  const [recomputing, setRecomputing] = useState(false);

  const recompute = useCallback(async () => {
    setRecomputing(true);
    try {
      await authedFetch("/api/brain/ghost-predict", { method: "POST" });
      refetch();
    } finally {
      setRecomputing(false);
    }
  }, [refetch]);

  const dismiss = useCallback(
    async (taskIdOrTitle: string) => {
      await authedFetch("/api/brain/ghost-predict", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss", taskIdOrTitle }),
      }).catch(() => {});
      refetch();
    },
    [refetch],
  );

  const bundle = data?.bundle;
  const accuracy = data?.accuracy;
  const livePredictions = bundle?.predictions.filter((p) => !p.dismissed) ?? [];

  // Hide entirely when no predictions AND we've never computed
  if (!loading && !bundle) return null;
  if (bundle && livePredictions.length === 0) return null;

  const totalCalls = accuracy ? accuracy.hits + accuracy.surprises : 0;
  const accPct = totalCalls >= 3 && accuracy ? Math.round((accuracy.hits / totalCalls) * 100) : null;
  const calibrating = totalCalls > 0 && totalCalls < 3;
  const predictedAgo = bundle
    ? Math.round((Date.now() - new Date(bundle.predicted_at).getTime()) / 60_000)
    : null;

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Ghost size={12} className="text-violet-400" />
          <p className="section-label">Ghost Nick</p>
          <span className="text-[9px] font-mono text-[var(--text-tertiary)]">
            · shadow predictor
          </span>
        </div>
        <div className="flex items-center gap-2">
          {accPct != null && (
            <span
              className={cn(
                "text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded",
                accPct >= 65
                  ? "text-emerald-400 bg-emerald-500/10"
                  : accPct >= 40
                    ? "text-[var(--gold)] bg-[var(--gold)]/10"
                    : "text-amber-400 bg-amber-500/10",
              )}
              title={`${accuracy?.hits ?? 0} hits · ${accuracy?.surprises ?? 0} surprises`}
            >
              {accPct}% acc
            </span>
          )}
          {calibrating && (
            <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded text-[var(--text-tertiary)] bg-[var(--bg-overlay)]" title="need ≥3 outcomes to show accuracy">
              calibrating {totalCalls}/3
            </span>
          )}
          {predictedAgo != null && (
            <span className="text-[9px] font-mono text-[var(--text-tertiary)]" title={new Date(bundle!.predicted_at).toLocaleString()}>
              {predictedAgo < 1 ? "just now" : predictedAgo < 60 ? `${predictedAgo}m` : `${Math.round(predictedAgo / 60)}h`}
            </span>
          )}
          <button
            onClick={() => void recompute()}
            disabled={recomputing || loading}
            className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] hover:text-violet-400 transition-colors inline-flex items-center gap-1"
          >
            {recomputing || loading ? <Loader2 size={9} className="animate-spin" /> : <RefreshCw size={9} />}
            recompute
          </button>
        </div>
      </div>

      {bundle && (
        <div className="space-y-1.5">
          {livePredictions.map((p, i) => {
            const pct = Math.round(p.confidence * 100);
            return (
              <div
                key={p.task_id ?? `${p.title}-${i}`}
                className="group flex items-center gap-2 px-2 py-1.5 rounded border border-[var(--border-default)] bg-[var(--bg-base)]"
                title={p.signals.join(" · ")}
              >
                <span className="text-[9px] font-mono text-violet-400 shrink-0">#{i + 1}</span>
                <span className="flex-1 text-[11px] text-[var(--text-primary)] truncate">{p.title}</span>
                {p.matched_skills.length > 0 && (
                  <Target size={10} className="text-[var(--gold)]" />
                )}
                <span className="text-[10px] font-mono tabular-nums text-[var(--text-tertiary)] shrink-0">
                  {pct}%
                </span>
                <DismissButton
                  onClick={() => void dismiss(p.task_id ?? p.title)}
                  label="not going to do this · drops it from rotation"
                  alwaysVisible
                  size="sm"
                  className="hover:text-red-400"
                />
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[9px] text-[var(--text-tertiary)] mt-2 leading-relaxed">
        horizon {bundle?.horizon_hours ?? 6}h · hits when you close a predicted task; surprises
        when you do something else. Accuracy climbs as Ghost learns your rhythm.
      </p>
    </GlassCard>
  );
}
