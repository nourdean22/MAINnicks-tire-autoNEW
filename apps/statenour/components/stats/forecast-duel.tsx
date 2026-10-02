"use client";

/**
 * Forecast Duel (2026-08-06) — "Odds on Yourself", the UI for #1393.
 *
 * Operator-vs-agent Brier over resolved predictions, the pending operator
 * slate, and a create form. The hard half (auto-resolution, Brier at resolve
 * time, nightly scoring) already runs — an operator forecast is a Prediction
 * row tagged metadata.author="operator" riding the whole pipeline. This card
 * was the missing consumer: the tRPC lane shipped with zero UI callers.
 *
 * Brier: 0 = perfect · 0.25 = coin-flip · lower wins.
 */
import { useState } from "react";
import { GlassCard } from "@/components/ui/glass-card";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

function BrierLane({ label, resolved, meanBrier, last10Brier, winning }: {
  label: string;
  resolved: number;
  meanBrier: number | null;
  last10Brier: number | null;
  winning: boolean;
}) {
  return (
    <div className={cn("flex-1 rounded-surface border p-3", winning ? "border-emerald-500/50" : "border-edge-subtle")}>
      <div className="text-[13px] font-medium text-fg-secondary">{label}{winning ? " · leading" : ""}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-fg">{meanBrier == null ? "—" : meanBrier.toFixed(3)}</div>
      <div className="font-mono text-[12px] text-fg-tertiary">{resolved} resolved · last-10 {last10Brier == null ? "—" : last10Brier.toFixed(3)}</div>
    </div>
  );
}

export function ForecastDuel() {
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.system.forecastScoreboard.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const create = trpc.system.forecastCreate.useMutation({
    onSuccess: () => utils.system.forecastScoreboard.invalidate(),
  });

  const [question, setQuestion] = useState("");
  const [criteria, setCriteria] = useState("");
  const [confidence, setConfidence] = useState(70);
  const [targetDate, setTargetDate] = useState("");

  // Self-hide on error per the page's child contract; loading renders a stub.
  if (error) return null;

  const operator = data?.operator;
  const agent = data?.agent;
  const operatorWinning =
    operator?.meanBrier != null && agent?.meanBrier != null && operator.meanBrier < agent.meanBrier;

  const canSubmit =
    question.trim().length >= 8 && criteria.trim().length >= 8 && /^\d{4}-\d{2}-\d{2}$/.test(targetDate) && !create.isPending;

  return (
    <GlassCard className="space-y-4">
      <div>
        <div className="text-[15px] font-semibold text-fg">Forecast duel · you vs Nick</div>
        <div className="text-[13px] text-fg-tertiary">
          Brier score — 0 perfect · 0.25 coin-flip · lower wins. Resolution is automatic (nightly).
        </div>
      </div>

      {isLoading ? (
        <div className="h-16 animate-pulse rounded-surface bg-surface-interactive" />
      ) : (
        <div className="flex gap-3">
          <BrierLane label="You" resolved={operator?.resolved ?? 0} meanBrier={operator?.meanBrier ?? null} last10Brier={operator?.last10Brier ?? null} winning={operatorWinning} />
          <BrierLane label="Nick" resolved={agent?.resolved ?? 0} meanBrier={agent?.meanBrier ?? null} last10Brier={agent?.last10Brier ?? null} winning={operator?.meanBrier != null && agent?.meanBrier != null && !operatorWinning} />
        </div>
      )}

      {(data?.pendingOperator?.length ?? 0) > 0 && (
        <div className="space-y-1">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">Your open forecasts</div>
          {data!.pendingOperator.map((p) => (
            <div key={p.id} className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate">{p.prediction}</span>
              <span className="shrink-0 font-mono text-[12px] text-fg-tertiary">{Math.round(p.confidence * 100)}% · by {p.targetDate}</span>
            </div>
          ))}
        </div>
      )}

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit) return;
          create.mutate(
            { question: question.trim(), criteria: criteria.trim(), confidence: confidence / 100, targetDate },
            { onSuccess: () => { setQuestion(""); setCriteria(""); setTargetDate(""); } },
          );
        }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Forecast — what will happen?"
          className="w-full min-h-12 rounded-control border border-edge-default bg-transparent px-3 text-sm"
        />
        <input
          value={criteria}
          onChange={(e) => setCriteria(e.target.value)}
          placeholder="Resolution criteria — how will we know?"
          className="w-full min-h-12 rounded-control border border-edge-default bg-transparent px-3 text-sm"
        />
        <div className="flex gap-2">
          <label className="flex min-h-12 flex-1 items-center gap-2 rounded-control border border-edge-default px-3 text-sm">
            <span className="text-[13px] text-fg-tertiary">Confidence</span>
            <input
              type="range" min={1} max={99} value={confidence}
              onChange={(e) => setConfidence(Number(e.target.value))}
              className="flex-1"
            />
            <span className="w-10 text-right tabular-nums">{confidence}%</span>
          </label>
          <input
            type="date" value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="min-h-12 rounded-control border border-edge-default bg-transparent px-3 text-sm"
          />
        </div>
        {/* In-DOM state, never window.confirm — iOS standalone PWA rule. */}
        <button
          type="submit"
          disabled={!canSubmit}
          className={cn("min-h-12 w-full rounded-control border text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)]", canSubmit ? "border-emerald-500/50 text-fg hover:border-edge-strong" : "border-edge-default opacity-50")}
        >
          {create.isPending ? "Logging…" : create.isSuccess ? "Logged — Nick is on the clock" : "Log forecast"}
        </button>
      </form>
    </GlassCard>
  );
}
