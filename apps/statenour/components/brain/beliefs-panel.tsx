"use client";

/**
 * BeliefsPanel — Nour's curated belief library. Pending candidates
 * appear on top (harvested nightly), active beliefs below. Promote
 * lifts candidate → active with optional rewrite. Edit lets him
 * polish the statement. Drop nukes.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/ui/glass-card";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrowUp, Trash2, Pencil, Check, X, Loader2, Play, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { authedFetch } from "@/hooks/use-authed-fetch";

interface StoredBelief {
  dbId: string;
  key: string;
  statement: string;
  theme_tokens: string[];
  category: "preference" | "decision" | "commitment";
  evidence_count: number;
  confidence: number;
  promoted: boolean;
  overridden: string | null;
  created_at: string;
  updated_at: string;
}

export function BeliefsPanel() {
  const [active, setActive] = useState<StoredBelief[] | null>(null);
  const [candidates, setCandidates] = useState<StoredBelief[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [harvesting, setHarvesting] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch("/api/beliefs");
      if (!res.ok) throw new Error("fetch failed");
      const raw = (await res.json()) as { data?: { active: StoredBelief[]; candidates: StoredBelief[] } };
      setActive(raw.data?.active ?? []);
      setCandidates(raw.data?.candidates ?? []);
      setLoadedAt(Date.now());
    } catch (e) {
      toast.error(`load failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const harvestNow = useCallback(async () => {
    setHarvesting(true);
    try {
      const res = await authedFetch("/api/beliefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "harvest_now" }),
      });
      if (!res.ok) throw new Error("harvest failed");
      const raw = (await res.json()) as { data?: { result?: { newCandidates?: number } } };
      const n = raw.data?.result?.newCandidates ?? 0;
      toast.success(n > 0 ? `${n} new belief candidate${n > 1 ? "s" : ""}` : "no new candidates");
      await load();
    } catch (e) {
      toast.error(`harvest failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setHarvesting(false);
    }
  }, [load]);

  const act = useCallback(
    async (key: string, action: "promote" | "drop", kind?: "belief" | "belief_candidate", statement?: string) => {
      setBusy(key);
      try {
        const res = await authedFetch("/api/beliefs", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, action, kind, statement }),
        });
        if (!res.ok) throw new Error(action);
        toast.success(action === "promote" ? "belief promoted" : "belief dropped");
        await load();
      } catch (e) {
        toast.error(`${action} failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const saveEdit = useCallback(
    async (key: string, kind: "belief" | "belief_candidate") => {
      if (!editText.trim()) return;
      setBusy(key);
      try {
        const res = await authedFetch("/api/beliefs", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, action: "edit", kind, statement: editText }),
        });
        if (!res.ok) throw new Error("edit failed");
        toast.success("belief edited");
        setEditKey(null);
        setEditText("");
        await load();
      } catch (e) {
        toast.error(`edit failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        setBusy(null);
      }
    },
    [editText, load],
  );

  const renderRow = (b: StoredBelief, kind: "belief" | "belief_candidate") => {
    const rowBusy = busy === b.key;
    const editing = editKey === b.key;
    const text = b.overridden ?? b.statement;
    return (
      <div
        key={b.key}
        className={cn(
          "p-2 rounded border transition-colors",
          kind === "belief"
            ? "bg-[var(--bg-base)] border-[var(--border-default)]"
            : "bg-blue-500/5 border-blue-500/20",
          rowBusy && "opacity-60",
        )}
      >
        {editing ? (
          <div className="space-y-2">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={2}
              className="w-full px-2 py-1 bg-[var(--bg-overlay)] border border-[var(--border-default)] rounded text-[11px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]/30"
            />
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => void saveEdit(b.key, kind)}
                disabled={rowBusy}
                className="h-6 px-2 rounded border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 text-[9px] font-mono uppercase inline-flex items-center gap-1"
              >
                <Check size={9} /> save
              </button>
              <button
                onClick={() => { setEditKey(null); setEditText(""); }}
                className="h-6 px-2 rounded border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-red-400 text-[9px] font-mono uppercase inline-flex items-center gap-1"
              >
                <X size={9} /> cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-[var(--text-primary)]">"{text}"</p>
                <div className="mt-1 flex items-center gap-2 text-[9px] font-mono text-[var(--text-tertiary)]">
                  <span>{b.category}</span>
                  <span>· {b.evidence_count} evidence</span>
                  <span>· conf {Math.round(b.confidence * 100)}%</span>
                  {b.overridden && <span className="text-[var(--gold)]">· rewritten</span>}
                </div>
                {b.theme_tokens.length > 0 && (
                  <div className="mt-1 flex items-center gap-1 flex-wrap">
                    {b.theme_tokens.slice(0, 5).map((t) => (
                      <span key={t} className="text-[8px] font-mono px-1 py-0.5 rounded bg-[var(--bg-overlay)] text-[var(--text-tertiary)]">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => { setEditKey(b.key); setEditText(text); }}
                  disabled={rowBusy}
                  title="rewrite"
                  className="h-6 w-6 rounded border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:border-[var(--gold)]/30 inline-flex items-center justify-center"
                >
                  <Pencil size={10} />
                </button>
                {kind === "belief_candidate" && (
                  <button
                    onClick={() => void act(b.key, "promote")}
                    disabled={rowBusy}
                    title="promote to active belief"
                    className="h-6 px-2 rounded border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 text-[9px] font-mono uppercase inline-flex items-center gap-1"
                  >
                    <ArrowUp size={9} /> promote
                  </button>
                )}
                <button
                  onClick={() => void act(b.key, "drop", kind)}
                  disabled={rowBusy}
                  title="drop"
                  className="h-6 w-6 rounded border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-red-400 hover:border-red-400/30 inline-flex items-center justify-center"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <BookOpen size={12} className="text-[var(--gold)]" />
          <p className="section-label">Beliefs</p>
          <FreshnessChip lastFetchedAt={loadedAt} source="brain" compact onReload={() => void load()} />
          <span className="text-[9px] font-mono text-[var(--text-tertiary)]">
            · curated positions · injected into chat every turn
          </span>
        </div>
        <button
          onClick={() => void harvestNow()}
          disabled={harvesting}
          className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-[var(--gold)]/30 text-[var(--gold)] hover:bg-[var(--gold)]/10 inline-flex items-center gap-1"
        >
          {harvesting ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
          harvest now
        </button>
      </div>

      {loading && !active && !candidates && (
        <div className="flex items-center gap-2 py-6 justify-center text-[11px] text-[var(--text-tertiary)]">
          <Loader2 size={12} className="animate-spin" />
          loading…
        </div>
      )}

      {candidates && candidates.length > 0 && (
        <div className="mb-3">
          <p className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5">
            candidates ({candidates.length})
          </p>
          <div className="space-y-1.5">
            {candidates.map((c) => renderRow(c, "belief_candidate"))}
          </div>
        </div>
      )}

      <div>
        <p className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5">
          active ({active?.length ?? 0})
        </p>
        <div className="space-y-1.5">
          {active?.map((b) => renderRow(b, "belief"))}
        </div>
        {active && active.length === 0 && (
          <EmptyState
            icon={BookOpen}
            title="No active beliefs yet"
            why="Beliefs are curated stated-positions that get injected into every chat turn so Nick reasons from your actual operating truths — not generic defaults."
            unlock="Promote a candidate from the list above, or run Harvest now to surface new ones from recent brain dumps."
            tone="neutral"
          />
        )}
      </div>
    </GlassCard>
  );
}
