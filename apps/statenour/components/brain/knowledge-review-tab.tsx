"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import { GlassCard } from "@/components/ui/glass-card";
import { apiFetch } from "@/lib/utils/api-fetch";

interface PendingCandidate {
  id: string;
  content: string;
  createdAt: string;
  metadata: {
    sourceType?: string;
    sourceUri?: string;
    kind?: string;
    confidence?: number;
    riskLevel?: string;
    gateReasons?: string[];
    evidence?: Array<{ type?: string; value?: string; score?: number }>;
    targetCategory?: string;
  };
}

interface CandidateList {
  total: number;
  items: PendingCandidate[];
}

function formatReason(reason: string): string {
  return reason.replaceAll("_", " ");
}

export type QueueBodyKind = "loading" | "unknown" | "empty" | "items";

/**
 * What a governed-knowledge queue panel is entitled to say about itself.
 *
 * THE DEFECT THIS EXISTS TO KILL. Both panels initialised state to
 * `{ total: 0, items: [] }`, their catch fired a toast and set nothing else,
 * and the render fell straight through to "0 pending" plus "No knowledge is
 * waiting for review." A read that FAILED and a queue that is genuinely empty
 * produced byte-identical markup — under a page whose own header comment
 * (app/(mastery)/brain/page.tsx) says an empty queue and a dead queue must
 * never look the same, and beside two siblings that already get it right
 * (discover-tab's "state unknown, not empty", research-pipeline-status's
 * "unknown, not zero"). A toast is not a state: it is gone in four seconds and
 * absent entirely on a reload.
 *
 * Both panels route through this ONE function rather than re-deriving the
 * rule, because the two copies of the bug were themselves a copy-paste.
 */
export function queueView(s: {
  loading: boolean;
  /** The last read threw. Distinct from `total === 0`. */
  failed: boolean;
  total: number;
  items: number;
  /** "pending" · "awaiting outcome" — the panel's own noun. */
  noun: string;
}): { headline: string; body: QueueBodyKind } {
  if (s.loading) return { headline: "Loading", body: "loading" };
  // Never `${total} ${noun}`: `total` is the initial 0, not a measurement.
  if (s.failed) return { headline: "unknown — read failed", body: "unknown" };
  return { headline: `${s.total} ${s.noun}`, body: s.items === 0 ? "empty" : "items" };
}

/**
 * The panel's own body card. Renders NOTHING for "loading"/"items" — the item
 * list is rendered by the panel itself and survives a failed refresh as
 * last-known-good.
 *
 * Exported and pure so the canary can render the failed and empty cases and
 * assert they differ; the panels' `useEffect` never runs under
 * renderToStaticMarkup, so driving the real component would only ever reach
 * the loading branch.
 */
export function QueueBody({
  body,
  emptyLabel,
  detail,
}: {
  body: QueueBodyKind;
  emptyLabel: string;
  detail: string | null;
}) {
  if (body === "unknown") {
    return (
      <GlassCard>
        <p className="text-sm text-amber-300">
          This queue couldn&apos;t load — state unknown, not empty.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {detail ?? "The queue may hold pending items; this panel just can't read it right now."}
        </p>
      </GlassCard>
    );
  }
  if (body === "empty") {
    return (
      <GlassCard className="text-center text-sm text-muted-foreground">{emptyLabel}</GlassCard>
    );
  }
  return null;
}

export function KnowledgeReviewTab() {
  const [data, setData] = useState<CandidateList>({ total: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // See knowledge-action-outcomes: `error` is a string, so the old
      // `payload?.error?.message` was always undefined. apiFetch surfaces it.
      setData(await apiFetch<CandidateList>("/api/knowledge/candidates?limit=50", { cache: "no-store" }));
      setLoadError(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load knowledge candidates.";
      // The toast is the notification; THIS is the state. Without it the panel
      // renders its initial `{ total: 0, items: [] }` as a measured all-clear.
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (memoryId: string, decision: "accept" | "reject") => {
    setActingId(memoryId);
    try {
      await apiFetch("/api/knowledge/candidates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "review", memoryId, decision }),
      });
      toast.success(decision === "accept" ? "Knowledge approved." : "Candidate rejected.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Unable to ${decision} candidate.`);
    } finally {
      setActingId(null);
    }
  };

  const view = queueView({
    loading,
    failed: loadError !== null,
    total: data.total,
    items: data.items.length,
    noun: "pending",
  });

  return (
    <div className="space-y-4">
      <GlassCard>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ShieldAlert className="h-4 w-4" />
              Knowledge approval queue
            </div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              External, inferred, contradictory and high-risk claims remain outside recall until approved. Actions require approval but never become canonical facts.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-control border border-border bg-background/60 px-3 py-2 text-sm text-foreground transition hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
        <div className="mt-4 text-[12px] font-mono text-fg-tertiary">
          {view.headline}
        </div>
      </GlassCard>

      <QueueBody
        body={view.body}
        emptyLabel="No knowledge is waiting for review."
        detail={loadError}
      />

      {data.items.map((item) => {
        const metadata = item.metadata ?? {};
        const confidence = typeof metadata.confidence === "number"
          ? `${Math.round(metadata.confidence * 100)}%`
          : "unknown";
        return (
          <GlassCard key={item.id} className="">
            <div className="flex flex-wrap items-center gap-2 text-[12px] font-mono text-fg-tertiary">
              <span>{metadata.sourceType ?? "unknown source"}</span>
              <span>·</span>
              <span>{metadata.kind ?? "observation"}</span>
              <span>·</span>
              <span>{confidence} confidence</span>
              {metadata.riskLevel ? <><span>·</span><span>{metadata.riskLevel} risk</span></> : null}
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground">{item.content}</p>

            {metadata.gateReasons?.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {metadata.gateReasons.map((reason) => (
                  <span key={reason} className="rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground">
                    {formatReason(reason)}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              <div>Target: {metadata.targetCategory ?? "research_claim"}</div>
              <div className="truncate">Source: {metadata.sourceUri ?? "not supplied"}</div>
            </div>

            {metadata.evidence?.length ? (
              <details className="mt-4 text-xs text-muted-foreground">
                <summary className="cursor-pointer select-none">Evidence ({metadata.evidence.length})</summary>
                <div className="mt-2 space-y-2 border-l border-border pl-3">
                  {metadata.evidence.map((evidence, index) => (
                    <div key={`${evidence.type}-${index}`}>
                      <span className="font-medium text-foreground">{evidence.type ?? "evidence"}</span>
                      {typeof evidence.score === "number" ? ` · ${Math.round(evidence.score * 100)}%` : ""}
                      <div className="mt-0.5 line-clamp-3">{evidence.value}</div>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => void review(item.id, "reject")}
                disabled={actingId === item.id}
                className="inline-flex items-center gap-2 rounded-control border border-border bg-background/60 px-3 py-2 text-sm text-foreground transition hover:bg-muted disabled:opacity-50"
              >
                <X className="h-4 w-4" /> Reject
              </button>
              <button
                type="button"
                onClick={() => void review(item.id, "accept")}
                disabled={actingId === item.id}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-control border border-edge-default px-4 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg disabled:opacity-50"
              >
                <Check className="h-4 w-4" /> Approve
              </button>
            </div>
          </GlassCard>
        );
      })}
    </div>
  );
}
