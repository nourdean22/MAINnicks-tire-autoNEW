"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import { GlassCard } from "@/components/ui/glass-card";

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

function unwrap<T>(payload: unknown): T {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

function formatReason(reason: string): string {
  return reason.replaceAll("_", " ");
}

export function KnowledgeReviewTab() {
  const [data, setData] = useState<CandidateList>({ total: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/knowledge/candidates?limit=50", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? "Unable to load knowledge candidates.");
      setData(unwrap<CandidateList>(payload));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load knowledge candidates.");
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
      const response = await fetch("/api/knowledge/candidates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "review", memoryId, decision }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? `Unable to ${decision} candidate.`);
      toast.success(decision === "accept" ? "Knowledge approved." : "Candidate rejected.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Unable to ${decision} candidate.`);
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <GlassCard className="p-5">
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
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground transition hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
        <div className="mt-4 text-xs uppercase tracking-[0.16em] text-muted-foreground">
          {loading ? "Loading" : `${data.total} pending`}
        </div>
      </GlassCard>

      {!loading && data.items.length === 0 ? (
        <GlassCard className="p-8 text-center text-sm text-muted-foreground">
          No knowledge is waiting for review.
        </GlassCard>
      ) : null}

      {data.items.map((item) => {
        const metadata = item.metadata ?? {};
        const confidence = typeof metadata.confidence === "number"
          ? `${Math.round(metadata.confidence * 100)}%`
          : "unknown";
        return (
          <GlassCard key={item.id} className="p-5">
            <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
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
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground transition hover:bg-muted disabled:opacity-50"
              >
                <X className="h-4 w-4" /> Reject
              </button>
              <button
                type="button"
                onClick={() => void review(item.id, "accept")}
                disabled={actingId === item.id}
                className="inline-flex items-center gap-2 rounded-lg bg-foreground px-3 py-2 text-sm text-background transition hover:opacity-90 disabled:opacity-50"
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
