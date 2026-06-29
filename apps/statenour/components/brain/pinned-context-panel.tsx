"use client";

/**
 * PinnedContextPanel — Nour's user-controlled permanent context.
 *
 * Lists every pinned_user BrainMemory row with:
 *   • Live stats: fresh / stale / very stale counts, estimated
 *     prompt-token cost, injection cap, source breakdown
 *   • Per-pin actions: edit content, rename label, unpin, re-pin
 *     (reinforce so the 14d stale timer resets)
 *   • Visual staleness indicator: gold ring pulses softer as a pin
 *     ages past 14 and then 30 days, nudging Nour to review
 *   • Add-from-scratch shortcut: quick paste box at the top for
 *     typing new permanent context directly (not just via chat)
 *
 * Lives on /brain between NudgePanel and ContradictionResolutionPanel
 * because pins ARE high-priority overrides — they sit near the top of
 * the cognitive stack.
 *
 * Talks to /api/brain/pinned (GET withStats=1, POST, PATCH, DELETE).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/ui/glass-card";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import {
  Pin,
  PinOff,
  Pencil,
  Check,
  X,
  Loader2,
  Plus,
  Sparkles,
  AlertCircle,
  Tag,
  RotateCw,
} from "lucide-react";
import { toast } from "sonner";
// Phase B.6d (2026-05-22) · migrated off `authedFetch("/api/brain/
// pinned")` (GET withStats / POST / PATCH / DELETE) onto the existing
// `trpc.brain.{pinned,createPin,updatePin,deletePin}` procedures (added
// in Phase YY) · reactive read + 3 mutations.
import { trpc } from "@/lib/trpc/client";

interface PinRow {
  id: string;
  key: string;
  content: string;
  source: string;
  confidence: number;
  seenCount: number;
  createdAt: string;
  updatedAt: string;
  metadata: { label?: string; pinnedAt?: string } | null;
}

interface PinStats {
  freshPins: number;
  stalePins: number;
  veryStalePins: number;
  totalChars: number;
  avgChars: number;
  bySource: Record<string, number>;
  injectedCount: number;
  estimatedPromptTokens: number;
  oldestUpdatedAt: string | null;
}

const STALE_DAYS = 14;
const VERY_STALE_DAYS = 30;
const INJECTION_CAP = 5;

function daysAgo(iso: string): number {
  const then = new Date(iso).getTime();
  return Math.max(0, Math.round((Date.now() - then) / 86400_000));
}

function stalenessClass(days: number) {
  if (days >= VERY_STALE_DAYS) {
    return "border-red-500/30 bg-red-500/[0.03] ring-red-500/10";
  }
  if (days >= STALE_DAYS) {
    return "border-amber-500/30 bg-amber-500/[0.03] ring-amber-500/10";
  }
  return "border-[var(--gold)]/30 bg-[var(--gold)]/[0.03] ring-[var(--gold)]/10";
}

function stalenessLabel(days: number) {
  if (days >= VERY_STALE_DAYS) return `${days}d — very stale`;
  if (days >= STALE_DAYS) return `${days}d — review`;
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

export function PinnedContextPanel() {
  const utils = trpc.useUtils();
  const ccStateQuery = trpc.operator.commandCenterState.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const createMutation = trpc.brain.createPin.useMutation();
  const updateMutation = trpc.brain.updatePin.useMutation();
  const deleteMutation = trpc.brain.deletePin.useMutation();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  // Short-lived id marker so we can fire a one-shot reinforce pulse
  const [reinforcedId, setReinforcedId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  // `listPins` returns `{ pins, count, stats? }` as a loose record · the
  // panel's local PinRow / PinStats interfaces pin the shape it renders.
  const pins =
    (ccStateQuery.data?.brainAnchors?.pinned as PinRow[] | undefined) ??
    (ccStateQuery.isError ? [] : null);
  const brainRules = ccStateQuery.data?.brainAnchors?.rules ?? null;
  const loading = ccStateQuery.isLoading;
  const loadedAt = ccStateQuery.dataUpdatedAt || null;
  const error = ccStateQuery.isError ? ccStateQuery.error.message : null;

  const load = useCallback(() => {
    void utils.operator.commandCenterState.invalidate();
  }, [utils]);

  const stats = useMemo<PinStats | null>(() => {
    if (!pins) return null;
    let freshPins = 0;
    let stalePins = 0;
    let veryStalePins = 0;
    let totalChars = 0;
    const bySource: Record<string, number> = {};

    pins.forEach((pin) => {
      const days = daysAgo(pin.updatedAt);
      if (days >= VERY_STALE_DAYS) {
        veryStalePins++;
      } else if (days >= STALE_DAYS) {
        stalePins++;
      } else {
        freshPins++;
      }
      totalChars += pin.content.length;
      const src = pin.source || "unknown";
      bySource[src] = (bySource[src] || 0) + 1;
    });

    return {
      freshPins,
      stalePins,
      veryStalePins,
      totalChars,
      avgChars: pins.length > 0 ? Math.round(totalChars / pins.length) : 0,
      bySource,
      injectedCount: Math.min(pins.length, INJECTION_CAP),
      estimatedPromptTokens: Math.round(totalChars / 4),
      oldestUpdatedAt: pins.length > 0 ? pins[pins.length - 1].updatedAt : null,
    };
  }, [pins]);

  // If the user arrives here via Cmd+Shift+P (/brain#pinned-context)
  // or any deep link, scroll the panel into view + open the add-new
  // drawer so the hint is obvious.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash === "#pinned-context") {
      const el = document.getElementById("pinned-context");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        el.classList.add("ring-2", "ring-[var(--gold)]/50");
        setTimeout(() => {
          el.classList.remove("ring-2", "ring-[var(--gold)]/50");
        }, 1600);
      }
    }
  }, []);

  const unpin = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        await deleteMutation.mutateAsync({ id });
        toast.success("unpinned");
        await utils.operator.commandCenterState.invalidate();
      } catch (e) {
        toast.error(`unpin failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        setBusyId(null);
      }
    },
    [deleteMutation, utils]
  );

  const reinforce = useCallback(
    async (pin: PinRow) => {
      setBusyId(pin.id);
      try {
        // createPin with the same content triggers the reinforcement
        // path — re-pinning the slugified key bumps seenCount + resets
        // confidence. This is the "still relevant" confirmation button.
        await createMutation.mutateAsync({
          content: pin.content,
          source: pin.source,
          label: pin.metadata?.label,
        });
        toast.success("reinforced — staleness timer reset");
        // 10.15 — fire a one-shot green pulse on the affected pin
        setReinforcedId(pin.id);
        setTimeout(() => setReinforcedId(null), 950);
        await utils.operator.commandCenterState.invalidate();
      } catch (e) {
        toast.error(`reinforce failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        setBusyId(null);
      }
    },
    [createMutation, utils]
  );

  const startEdit = useCallback((pin: PinRow) => {
    setEditId(pin.id);
    setEditContent(pin.content);
    setEditLabel(pin.metadata?.label || "");
  }, []);

  const cancelEdit = useCallback(() => {
    setEditId(null);
    setEditContent("");
    setEditLabel("");
  }, []);

  const saveEdit = useCallback(
    async (pin: PinRow) => {
      if (!editContent.trim()) {
        toast.error("content can't be empty");
        return;
      }
      setBusyId(pin.id);
      try {
        // `label` is sent as "" (cleared) or the trimmed value · the
        // updatePin Zod input is `.optional()` not `.nullable()`, and
        // the service treats `label !== undefined` as a write — an
        // empty string clears the label, matching the legacy `|| null`.
        await updateMutation.mutateAsync({
          id: pin.id,
          content: editContent.trim(),
          label: editLabel.trim(),
        });
        toast.success("pin updated");
        cancelEdit();
        await utils.operator.commandCenterState.invalidate();
      } catch (e) {
        toast.error(`update failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        setBusyId(null);
      }
    },
    [editContent, editLabel, cancelEdit, updateMutation, utils]
  );

  const addPin = useCallback(async () => {
    const text = newContent.trim();
    if (!text) return;
    try {
      await createMutation.mutateAsync({
        content: text,
        source: "pin:manual",
        label: newLabel.trim() || undefined,
      });
      toast.success("pinned");
      setNewContent("");
      setNewLabel("");
      setAddOpen(false);
      await utils.operator.commandCenterState.invalidate();
    } catch (e) {
      toast.error(`pin failed: ${e instanceof Error ? e.message : e}`);
    }
  }, [newContent, newLabel, createMutation, utils]);

  // Show stats in a compact header strip. Lights tell Nour at a
  // glance whether his pins need maintenance.
  const statsStrip = useMemo(() => {
    if (!stats || !pins) return null;
    const overCap = pins.length > INJECTION_CAP;
    return (
      <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--gold)] shadow-[0_0_6px_var(--gold)]" />
          {pins.length} pinned
        </span>
        <span className="flex items-center gap-1">
          <Sparkles size={10} className="text-[var(--gold)]/60" />
          {stats.injectedCount}/{INJECTION_CAP} in prompt
          {overCap && (
            <span
              className="ml-1 px-1.5 py-px rounded-full bg-amber-500/15 text-amber-400 text-[8px]"
              title={`Only the newest ${INJECTION_CAP} pins ride with every request. The rest sit idle.`}
            >
              over cap
            </span>
          )}
        </span>
        <span>~{stats.estimatedPromptTokens} tokens</span>
        {stats.stalePins > 0 && (
          <span className="text-amber-400">
            {stats.stalePins} stale
          </span>
        )}
        {stats.veryStalePins > 0 && (
          <span className="text-red-400">
            {stats.veryStalePins} very stale
          </span>
        )}
        {stats.freshPins > 0 && (
          <span className="text-emerald-400/70">{stats.freshPins} fresh</span>
        )}
      </div>
    );
  }, [stats, pins]);

  return (
    <div id="pinned-context" className="scroll-mt-20 rounded-xl transition-shadow">
    <GlassCard className="p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Pin size={14} className="text-[var(--gold)]" />
          <h2 className="text-[13px] font-[var(--font-display)] font-bold uppercase tracking-wider text-[var(--text-primary)]">
            Pinned Context
          </h2>
          <span className="text-[10px] text-[var(--text-tertiary)]">
            always loaded · confidence 1.0
          </span>
          <FreshnessChip lastFetchedAt={loadedAt} source="brain" compact onReload={() => void load()} />
        </div>
        <button
          onClick={() => setAddOpen((o) => !o)}
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors",
            addOpen
              ? "bg-[var(--gold)]/25 text-[var(--gold)]"
              : "border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--gold)]/40 hover:text-[var(--gold)]"
          )}
        >
          <Plus size={11} /> Pin new
        </button>
      </div>

      {/* Stats strip */}
      {statsStrip}

      {/* Add-new drawer */}
      {addOpen && (
        <div className="rounded-lg border border-[var(--gold)]/30 bg-[var(--gold)]/[0.03] p-3 space-y-2 animate-fade-in">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-[var(--gold)]/80">
            <Plus size={10} /> new pin
          </div>
          <textarea
            autoFocus
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Nick must always know: __________"
            rows={3}
            className="w-full bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-md px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--gold)]/40 resize-none"
          />
          <div className="flex items-center gap-2">
            <Tag size={10} className="text-[var(--text-tertiary)] shrink-0" />
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="optional label (e.g. 'current goal')"
              className="flex-1 bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-md px-2 py-1 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--gold)]/40"
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-[var(--text-tertiary)]">
              {newContent.trim().length}/1200
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setAddOpen(false);
                  setNewContent("");
                  setNewLabel("");
                }}
                className="px-2 py-1 text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              >
                cancel
              </button>
              <button
                onClick={addPin}
                disabled={!newContent.trim()}
                className="px-2.5 py-1 rounded-md bg-[var(--gold)]/20 text-[var(--gold)] text-[10px] font-bold uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--gold)]/30 transition-colors"
              >
                pin
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {loading && (
        <div className="flex items-center gap-2 py-6 text-[11px] text-[var(--text-tertiary)]">
          <Loader2 size={12} className="animate-spin" /> loading pins…
        </div>
      )}

      {error && !loading && (
        <div className="flex items-center gap-2 py-4 text-[11px] text-red-400">
          <AlertCircle size={12} /> {error}
          <button
            onClick={load}
            className="ml-auto px-2 py-0.5 rounded border border-red-500/30 hover:bg-red-500/10"
          >
            retry
          </button>
        </div>
      )}

      {!loading && !error && pins && pins.length === 0 && (
        <div className="py-6 text-center space-y-1">
          <p className="text-[11px] text-[var(--text-tertiary)]">
            no pins yet
          </p>
          <p className="text-[10px] text-[var(--text-tertiary)]/70">
            tap 📌 on any assistant reply or hit <span className="text-[var(--gold)]">Pin new</span> above
          </p>
        </div>
      )}

      {!loading && pins && pins.length > 0 && (
        <ul className="space-y-2">
          {pins.map((pin, idx) => {
            const days = daysAgo(pin.updatedAt);
            const injected = idx < INJECTION_CAP;
            const editing = editId === pin.id;
            const justReinforced = reinforcedId === pin.id;
            return (
              <li
                key={pin.id}
                className={cn(
                  "rounded-lg border p-2.5 transition-all ring-1",
                  stalenessClass(days),
                  editing && "ring-2 ring-[var(--gold)]/30",
                  // 10.2 — stale pins breathe subtly, very-stale more urgently
                  !editing && days >= VERY_STALE_DAYS && "pin-very-stale-breathe",
                  !editing && days >= STALE_DAYS && days < VERY_STALE_DAYS && "pin-stale-breathe",
                  // 10.15 — single-shot green pulse right after reinforce
                  justReinforced && "pin-reinforce-pulse"
                )}
              >
                {editing ? (
                  <div className="space-y-2">
                    <textarea
                      autoFocus
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={Math.min(6, Math.max(2, editContent.split("\n").length + 1))}
                      className="w-full bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-md px-2 py-1.5 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--gold)]/40 resize-none"
                    />
                    <div className="flex items-center gap-2">
                      <Tag size={10} className="text-[var(--text-tertiary)] shrink-0" />
                      <input
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        placeholder="label (optional)"
                        className="flex-1 bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-md px-2 py-1 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--gold)]/40"
                      />
                    </div>
                    <div className="flex items-center justify-between text-[9px] text-[var(--text-tertiary)]">
                      <span>{editContent.trim().length}/1200</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={cancelEdit}
                          className="p-1 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                          title="cancel"
                        >
                          <X size={12} />
                        </button>
                        <button
                          onClick={() => saveEdit(pin)}
                          disabled={busyId === pin.id}
                          className="p-1 rounded bg-[var(--gold)]/20 text-[var(--gold)] hover:bg-[var(--gold)]/30 disabled:opacity-40 transition-colors"
                          title="save"
                        >
                          {busyId === pin.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Check size={12} />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {pin.metadata?.label && (
                          <div className="flex items-center gap-1 mb-1">
                            <Tag size={9} className="text-[var(--gold)]/60" />
                            <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--gold)]/80">
                              {pin.metadata.label}
                            </span>
                          </div>
                        )}
                        <p className="text-[12px] leading-snug text-[var(--text-primary)] whitespace-pre-wrap break-words">
                          {pin.content}
                        </p>
                        <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                          <span
                            className={cn(
                              days >= VERY_STALE_DAYS
                                ? "text-red-400"
                                : days >= STALE_DAYS
                                  ? "text-amber-400"
                                  : "text-[var(--text-tertiary)]"
                            )}
                          >
                            {stalenessLabel(days)}
                          </span>
                          <span>src: {pin.source}</span>
                          {pin.seenCount > 1 && <span>×{pin.seenCount} reinforced</span>}
                          {injected ? (
                            <span className="text-[var(--gold)]/80 flex items-center gap-0.5">
                              <Sparkles size={9} /> in prompt
                            </span>
                          ) : (
                            <span className="text-[var(--text-tertiary)]/60">idle</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          onClick={() => reinforce(pin)}
                          disabled={busyId === pin.id}
                          className="p-2 md:p-1.5 rounded text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:bg-[var(--gold)]/10 disabled:opacity-40 transition-colors touch-manipulation"
                          title="still relevant — reset staleness"
                        >
                          {busyId === pin.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <RotateCw size={12} />
                          )}
                        </button>
                        <button
                          onClick={() => startEdit(pin)}
                          className="p-2 md:p-1.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors touch-manipulation"
                          title="edit"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => unpin(pin.id)}
                          disabled={busyId === pin.id}
                          className="p-2 md:p-1.5 rounded text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40 transition-colors touch-manipulation"
                          title="unpin"
                        >
                          <PinOff size={12} />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Hot Rules sub-section */}
      {!loading && brainRules && brainRules.length > 0 && (
        <div className="pt-3 border-t border-white/5 space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--gold)]/80">
            <Sparkles size={11} />
            <span>Active Hot Rules</span>
            <span className="text-[9px] text-[var(--text-tertiary)] font-normal font-mono normal-case">
              high-confidence constraints
            </span>
          </div>
          <ul className="space-y-1.5">
            {brainRules.map((rule) => (
              <li
                key={rule.key}
                className="text-[11.5px] leading-relaxed text-[var(--text-secondary)] bg-white/[0.01] border border-white/5 rounded-md p-2 flex items-start gap-2"
              >
                <span className="inline-flex px-1.5 py-0.5 rounded border border-[var(--gold)]/20 bg-[var(--gold)]/5 text-[8px] font-mono uppercase tracking-wider text-[var(--gold)] shrink-0 mt-0.5">
                  {rule.category}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-[9px] text-[var(--text-tertiary)] uppercase tracking-wider mb-0.5">
                    {rule.key} · confidence {Math.round(rule.confidence * 100)}%
                  </p>
                  <p className="whitespace-pre-wrap break-words">{rule.content}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </GlassCard>
    </div>
  );
}
