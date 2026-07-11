"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleMinus, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { GlassCard } from "@/components/ui/glass-card";

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

function unwrap<T>(payload: unknown): T {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

export function KnowledgeActionOutcomes() {
  const [data, setData] = useState<ActionList>({ total: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/knowledge/candidates?view=actions&limit=50", {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Unable to load approved actions.");
      }
      setData(unwrap<ActionList>(payload));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load approved actions.");
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
      const response = await fetch("/api/knowledge/candidates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "outcome",
          memoryId,
          outcome,
          evidence: evidence[memoryId]?.trim() || undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Unable to record action outcome.");
      }
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

  return (
    <div className="space-y-4">
      <GlassCard className="p-5">
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
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground transition hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
        <div className="mt-4 text-xs uppercase tracking-[0.16em] text-muted-foreground">
          {loading ? "Loading" : `${data.total} awaiting outcome`}
        </div>
      </GlassCard>

      {!loading && data.items.length === 0 ? (
        <GlassCard className="p-6 text-center text-sm text-muted-foreground">
          No approved actions are waiting for an outcome.
        </GlassCard>
      ) : null}

      {data.items.map((item) => (
        <GlassCard key={item.id} className="p-5">
          <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
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
            className="mt-4 w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/40"
          />
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => void record(item.id, "disproved")}
              disabled={actingId === item.id}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
            >
              <XCircle className="h-4 w-4" /> Disproved
            </button>
            <button
              type="button"
              onClick={() => void record(item.id, "neutral")}
              disabled={actingId === item.id}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
            >
              <CircleMinus className="h-4 w-4" /> Neutral
            </button>
            <button
              type="button"
              onClick={() => void record(item.id, "confirmed")}
              disabled={actingId === item.id}
              className="inline-flex items-center gap-2 rounded-lg bg-foreground px-3 py-2 text-sm text-background hover:opacity-90 disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" /> Confirmed
            </button>
          </div>
        </GlassCard>
      ))}
    </div>
  );
}
