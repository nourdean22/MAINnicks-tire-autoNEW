"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleMinus, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { GlassCard } from "@/components/ui/glass-card";
import { apiFetch } from "@/lib/utils/api-fetch";
// ONE definition of "a failed read is not an empty queue", imported rather
// than re-typed: this panel and the review panel carried byte-identical copies
// of the defect, so a second copy of the fix would be a second thing to drift.
import { QueueBody, queueView } from "@/components/brain/knowledge-review-tab";

type Outcome = "confirmed" | "disproved" | "neutral";

interface ActionItem {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  metadata: {
    sourceType?: string;
    sourceUri?: string;
    confidence?: number;
    evidence?: Array<{ type?: string; value?: string; score?: number }>;
  };
}

interface ActionList {
  total: number;
  items: ActionItem[];
}

export function KnowledgeActionOutcomes() {
  const [data, setData] = useState<ActionList>({ total: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // `ApiError.message` carries the envelope's `error` string, which the
      // catch below already surfaces. The hand-rolled path read
      // `payload?.error?.message` — but `error` is typed `string`, so `.message`
      // was always undefined and this ALWAYS fell through to the generic
      // fallback. Routing through apiFetch makes the server's message reachable.
      setData(await apiFetch<ActionList>("/api/knowledge/candidates?view=actions&limit=50", {
        cache: "no-store",
      }));
      setLoadError(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load approved actions.";
      // State, not just a toast — see queueView's header in
      // knowledge-review-tab.tsx. Without this the panel renders its initial
      // `{ total: 0, items: [] }` as "0 awaiting outcome · No approved actions
      // are waiting for an outcome", which is an all-clear it never measured.
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const record = async (memoryId: string, outcome: Outcome) => {
    setActingId(memoryId);
    try {
      await apiFetch("/api/knowledge/candidates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "outcome",
          memoryId,
          outcome,
          evidence: evidence[memoryId]?.trim() || undefined,
        }),
      });
      toast.success(`Outcome recorded: ${outcome}.`);
      setEvidence((current) => {
        const next = { ...current };
        delete next[memoryId];
        return next;
      });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to record action outcome.");
    } finally {
      setActingId(null);
    }
  };

  const view = queueView({
    loading,
    failed: loadError !== null,
    total: data.total,
    items: data.items.length,
    noun: "awaiting outcome",
  });

  return (
    <div className="space-y-4">
      <GlassCard>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Approved actions awaiting reality</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Approval authorizes the action. Outcome tracking teaches the system whether the recommendation was useful, wrong, or inconclusive.
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
        emptyLabel="No approved actions are waiting for an outcome."
        detail={loadError}
      />

      {data.items.map((item) => (
        <GlassCard key={item.id} className="">
          <div className="text-[12px] font-mono text-fg-tertiary">
            {item.metadata.sourceType ?? "unknown source"}
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground">{item.content}</p>
          <textarea
            value={evidence[item.id] ?? ""}
            onChange={(event) => setEvidence((current) => ({
              ...current,
              [item.id]: event.target.value,
            }))}
            maxLength={4_000}
            rows={2}
            placeholder="Optional evidence: what happened, what changed, or why the result was unclear"
            className="mt-4 w-full rounded-control border border-border bg-background/60 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/40"
          />
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => void record(item.id, "disproved")}
              disabled={actingId === item.id}
              className="inline-flex items-center gap-2 rounded-control border border-border px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
            >
              <XCircle className="h-4 w-4" /> Disproved
            </button>
            <button
              type="button"
              onClick={() => void record(item.id, "neutral")}
              disabled={actingId === item.id}
              className="inline-flex items-center gap-2 rounded-control border border-border px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
            >
              <CircleMinus className="h-4 w-4" /> Neutral
            </button>
            <button
              type="button"
              onClick={() => void record(item.id, "confirmed")}
              disabled={actingId === item.id}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-control border border-edge-default px-4 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" /> Confirmed
            </button>
          </div>
        </GlassCard>
      ))}
    </div>
  );
}
