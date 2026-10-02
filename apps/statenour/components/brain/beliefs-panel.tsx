"use client";

/**
 * BeliefsPanel — Nour's curated belief library. Pending candidates
 * appear on top (harvested nightly), active beliefs below. Promote
 * lifts candidate → active with optional rewrite. Edit lets him
 * polish the statement. Drop nukes.
 */

import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/ui/glass-card";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrowUp, Trash2, Pencil, Check, X, Loader2, Play, BookOpen } from "lucide-react";
import { toast } from "sonner";
// Phase B.6d (2026-05-22) · migrated off `authedFetch("/api/beliefs")`
// (GET + PATCH) onto `trpc.brain.beliefs` (reactive read) +
// `trpc.brain.harvestBeliefs` + `trpc.brain.actOnBelief` (mutations) ·
// the single PATCH `action` discriminator split into two procedures.
import { trpc } from "@/lib/trpc/client";

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
  const utils = trpc.useUtils();
  const beliefsQuery = trpc.brain.beliefs.useQuery(undefined);
  const harvestMutation = trpc.brain.harvestBeliefs.useMutation();
  const actMutation = trpc.brain.actOnBelief.useMutation();

  const [busy, setBusy] = useState<string | null>(null);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  // A FAILED READ IS NOT A ZERO. These previously ended `?? (isError ? [] : null)`,
  // so a failed query produced an empty array and the panel rendered a confident
  // "No active beliefs yet" — a measured claim about data it never received.
  // Null now means "no reading", and the empty state below says which.
  const active = (beliefsQuery.data?.active as StoredBelief[] | undefined) ?? null;
  const candidates =
    (beliefsQuery.data?.candidates as StoredBelief[] | undefined) ?? null;
  const loading = beliefsQuery.isLoading;
  const loadedAt = beliefsQuery.dataUpdatedAt || null;
  const harvesting = harvestMutation.isPending;

  const load = useCallback(() => {
    void utils.brain.beliefs.invalidate();
  }, [utils]);

  const harvestNow = useCallback(async () => {
    try {
      const res = await harvestMutation.mutateAsync();
      const n = res.result?.newCandidates ?? 0;
      toast.success(
        n > 0
          ? `${n} new belief candidate${n > 1 ? "s" : ""}`
          : "no new candidates",
      );
      await utils.brain.beliefs.invalidate();
    } catch (e) {
      toast.error(`harvest failed: ${e instanceof Error ? e.message : e}`);
    }
  }, [harvestMutation, utils]);

  const act = useCallback(
    async (
      key: string,
      action: "promote" | "drop",
      kind?: "belief" | "belief_candidate",
    ) => {
      setBusy(key);
      try {
        await actMutation.mutateAsync({ key, action, kind });
        toast.success(
          action === "promote" ? "belief promoted" : "belief dropped",
        );
        await utils.brain.beliefs.invalidate();
      } catch (e) {
        toast.error(`${action} failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        setBusy(null);
      }
    },
    [actMutation, utils],
  );

  const saveEdit = useCallback(
    async (key: string, kind: "belief" | "belief_candidate") => {
      if (!editText.trim()) return;
      setBusy(key);
      try {
        await actMutation.mutateAsync({
          key,
          action: "edit",
          kind,
          statement: editText,
        });
        toast.success("belief edited");
        setEditKey(null);
        setEditText("");
        await utils.brain.beliefs.invalidate();
      } catch (e) {
        toast.error(`edit failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        setBusy(null);
      }
    },
    [editText, actMutation, utils],
  );

  const renderRow = (b: StoredBelief, kind: "belief" | "belief_candidate") => {
    const rowBusy = busy === b.key;
    const editing = editKey === b.key;
    const text = b.overridden ?? b.statement;
    return (
      <div
        key={b.key}
        className={cn(
          "p-2 rounded-micro border transition-colors",
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
              className="w-full px-2 py-1 bg-surface-interactive border border-[var(--border-default)] rounded-control text-[11px] text-[var(--text-primary)] focus:outline-none focus:border-accent"
            />
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => void saveEdit(b.key, kind)}
                disabled={rowBusy}
                className="inline-flex min-h-11 items-center rounded-control px-2.5 sm:min-h-6 sm:px-2 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 text-[11px] font-mono gap-1"
              >
                <Check size={9} /> save
              </button>
              <button
                onClick={() => { setEditKey(null); setEditText(""); }}
                className="inline-flex min-h-11 items-center rounded-control px-2.5 sm:min-h-6 sm:px-2 border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-red-400 text-[11px] font-mono gap-1"
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
                <div className="mt-1 flex items-center gap-2 text-[11px] font-mono text-[var(--text-tertiary)]">
                  <span>{b.category}</span>
                  <span>· {b.evidence_count} evidence</span>
                  <span>· conf {Math.round(b.confidence * 100)}%</span>
                  {b.overridden && <span className="text-fg-secondary">· rewritten</span>}
                </div>
                {b.theme_tokens.length > 0 && (
                  <div className="mt-1 flex items-center gap-1 flex-wrap">
                    {b.theme_tokens.slice(0, 5).map((t) => (
                      <span key={t} className="text-[11px] font-mono px-1 py-0.5 rounded-micro bg-surface-interactive text-[var(--text-tertiary)]">
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
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control sm:min-h-6 sm:min-w-6 border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-fg hover:border-edge-strong justify-center"
                >
                  <Pencil size={10} />
                </button>
                {kind === "belief_candidate" && (
                  <button
                    onClick={() => void act(b.key, "promote")}
                    disabled={rowBusy}
                    title="promote to active belief"
                    className="inline-flex min-h-11 items-center rounded-control px-2.5 sm:min-h-6 sm:px-2 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 text-[11px] font-mono gap-1"
                  >
                    <ArrowUp size={9} /> promote
                  </button>
                )}
                <button
                  onClick={() => void act(b.key, "drop", kind)}
                  disabled={rowBusy}
                  title="drop"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control sm:min-h-6 sm:min-w-6 border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-red-400 hover:border-red-400/30 justify-center"
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
          <BookOpen size={12} className="text-fg-secondary" />
          <p className="section-label">Beliefs</p>
          <FreshnessChip lastFetchedAt={loadedAt} source="brain" compact onReload={() => void load()} />
          <span className="text-[11px] font-mono text-[var(--text-tertiary)]">
            · curated positions · injected into chat every turn
          </span>
        </div>
        <button
          onClick={() => void harvestNow()}
          disabled={harvesting}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-control border border-edge-default px-4 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
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
          <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary mb-1.5">
            candidates ({candidates.length})
          </p>
          <div className="space-y-1.5">
            {candidates.map((c) => renderRow(c, "belief_candidate"))}
          </div>
        </div>
      )}

      <div>
        <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary mb-1.5">
          active ({active?.length ?? 0})
        </p>
        <div className="space-y-1.5">
          {active?.map((b) => renderRow(b, "belief"))}
        </div>
        {active && active.length === 0 && (
          <EmptyState
            icon={BookOpen}
            title="No active beliefs yet"
            provenance="ZERO"
            why="Beliefs are curated stated-positions that get injected into every chat turn so Nick reasons from your actual operating truths — not generic defaults."
            unlock="Promote a candidate from the list above, or run Harvest now to surface new ones from recent brain dumps."
            tone="neutral"
          />
        )}
        {!active && !loading && (
          <EmptyState
            icon={BookOpen}
            title={beliefsQuery.isError ? "Beliefs unavailable" : "Beliefs not read"}
            provenance={beliefsQuery.isError ? "ERROR" : "UNMEASURED"}
            tone="warning"
            why="Nothing is known about your active beliefs right now — this is not the same as having none. Chat turns are still being injected with whatever the server last had."
            unlock="Reload the panel. If it keeps failing, check the brain router."
          />
        )}
      </div>
    </GlassCard>
  );
}
