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
 * Reads `trpc.brain.pinned` (→ listPins, the full top-50 roster) for the
 * list, and `trpc.operator.commandCenterState` for the Hot Rules
 * subsection only. Writes via `trpc.brain.{createPin,updatePin,deletePin}`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/ui/glass-card";
import { EmptyState } from "@/components/ui/empty-state";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { describeConfidenceAsAttention } from "@/lib/brain/attention-label";
// The prompt's own numbers, imported rather than restated. See the
// PINNED_PROMPT_CAP header for the four-way disagreement this ended.
// `renderer.ts` is a pure string module (type-only context import,
// sanitize + operator-rules are plain constants) so it is safe in a
// client bundle.
import {
  PINNED_PROMPT_CAP,
  PINNED_PROMPT_CHARS,
  renderPinnedLine,
} from "@/lib/ai/prompt/v2/renderer";
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
/** Stored per-pin limit (lib/services/pins.ts slices content to this). */
const PIN_STORAGE_CHARS = 1200;

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
  // 2026-09-02 · the pin list comes from `brain.pinned` → listPins
  // (lib/services/pins.ts:68, `take: 50`), which is the roster this panel
  // exists to render. It used to read
  // `commandCenterState.brainAnchors.pinned` — a `take: 6` slice built to
  // feed the SYSTEM PROMPT, not a list — so the header said "6 pinned"
  // whether the operator had 6 pins or 60, and fresh/stale/veryStale/
  // bySource/totalChars were all computed over those same 6 rows.
  const pinsQuery = trpc.brain.pinned.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  // Still needed, but ONLY for the Hot Rules subsection below.
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
  //
  // `pins` is null until a read SUCCEEDS. That is load-bearing: the old
  // read went through a `.catch(() => [])` inside the command-center
  // fan-out (command-center-state.ts:532), so a failed pin query resolved
  // the tRPC call, left `isError` false, and handed this panel an empty
  // array — which rendered "no pins yet · tap 📌 on any assistant reply"
  // under a header reading "always loaded · confidence 1.0". The comment
  // that used to sit here claimed the empty state was gated on `!error`;
  // `!error` cannot see a failure the service already swallowed. Same
  // shape as the four sibling panels in #1840.
  const pins = (pinsQuery.data?.pins as PinRow[] | undefined) ?? null;
  const brainRules = ccStateQuery.data?.brainAnchors?.rules ?? null;
  const loading = pinsQuery.isLoading;
  const loadedAt = pinsQuery.dataUpdatedAt || null;
  const error = pinsQuery.isError ? pinsQuery.error.message : null;

  // Every mutation below must refresh BOTH: the list lives on
  // `brain.pinned` and the prompt-side anchors live on the command-center
  // state, and a pin edit changes what the model sees on the next turn.
  const refresh = useCallback(async () => {
    await Promise.all([
      utils.brain.pinned.invalidate(),
      utils.operator.commandCenterState.invalidate(),
    ]);
  }, [utils]);

  /** Fire-and-forget flavour for the reload chip and the retry button. */
  const load = useCallback(() => {
    void refresh();
  }, [refresh]);

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

    // 2026-09-02 · the token estimate is measured against the lines that
    // actually reach the model, by calling the renderer's own
    // `renderPinnedLine`. It used to be `Math.round(totalChars / 4)` over
    // STORED content — and pins store up to 1200 chars while the prompt
    // cuts each one at PINNED_PROMPT_CHARS, so a long pin was billed at up
    // to 6x its real cost, on top of counting pins the prompt never sees.
    const injectedChars = pins
      .slice(0, PINNED_PROMPT_CAP)
      .reduce((sum, pin) => sum + renderPinnedLine(pin).length, 0);

    return {
      freshPins,
      stalePins,
      veryStalePins,
      totalChars,
      avgChars: pins.length > 0 ? Math.round(totalChars / pins.length) : 0,
      bySource,
      injectedCount: Math.min(pins.length, PINNED_PROMPT_CAP),
      estimatedPromptTokens: Math.round(injectedChars / 4),
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
        await refresh();
      } catch (e) {
        toast.error(`unpin failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        setBusyId(null);
      }
    },
    [deleteMutation, refresh]
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
        await refresh();
      } catch (e) {
        toast.error(`reinforce failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        setBusyId(null);
      }
    },
    [createMutation, refresh]
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
        await refresh();
      } catch (e) {
        toast.error(`update failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        setBusyId(null);
      }
    },
    [editContent, editLabel, cancelEdit, updateMutation, refresh]
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
      await refresh();
    } catch (e) {
      toast.error(`pin failed: ${e instanceof Error ? e.message : e}`);
    }
  }, [newContent, newLabel, createMutation, refresh]);

  // Show stats in a compact header strip. Lights tell Nour at a
  // glance whether his pins need maintenance.
  const statsStrip = useMemo(() => {
    if (!stats || !pins) return null;
    // Now visible at 7+ pins as well as at 6 — the old `> 5` test was
    // reading a cap that only this file believed in.
    const overCap = pins.length > PINNED_PROMPT_CAP;
    const truncatedPins = pins
      .slice(0, PINNED_PROMPT_CAP)
      .filter((p) => p.content.length > PINNED_PROMPT_CHARS).length;
    return (
      <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--gold)] shadow-[0_0_6px_var(--gold)]" />
          {pins.length} pinned
        </span>
        <span className="flex items-center gap-1">
          <Sparkles size={10} className="text-[var(--gold)]/60" />
          {stats.injectedCount}/{PINNED_PROMPT_CAP} in prompt
          {overCap && (
            <span
              className="ml-1 px-1.5 py-px rounded-full bg-amber-500/15 text-amber-400 text-[8px]"
              title={`Only the ${PINNED_PROMPT_CAP} most recently updated pins ride with every request. The other ${pins.length - PINNED_PROMPT_CAP} sit idle until you reinforce or edit them.`}
            >
              over cap
            </span>
          )}
        </span>
        <span title="Estimated from the exact lines the renderer emits, not from stored pin length.">
          ~{stats.estimatedPromptTokens} tokens
        </span>
        {truncatedPins > 0 && (
          <span
            className="text-amber-400"
            title={`Pins are stored in full (up to ${PIN_STORAGE_CHARS} chars) but the prompt carries only the first ${PINNED_PROMPT_CHARS} of each. Shorten these, or split the part that matters into its own pin.`}
          >
            {truncatedPins} cut at {PINNED_PROMPT_CHARS}
          </span>
        )}
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
              {newContent.trim().length}/{PIN_STORAGE_CHARS}
              {newContent.trim().length > PINNED_PROMPT_CHARS && (
                <span className="ml-1 text-amber-400">
                  · only the first {PINNED_PROMPT_CHARS} reach the prompt
                </span>
              )}
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

      {/* Same shape as judgment-quality-panel.tsx:35-43 — a failed read
          says so, and never borrows the empty state's copy. */}
      {error && !loading && (
        <div className="flex items-center gap-2 py-4 text-[11px] text-red-400">
          <AlertCircle size={12} /> Pins couldn&apos;t load — state unknown, not
          empty. {error}
          <button
            onClick={load}
            className="ml-auto px-2 py-0.5 rounded border border-red-500/30 hover:bg-red-500/10"
          >
            retry
          </button>
        </div>
      )}

      {/* Gated on isSuccess, not on `!error`. "No pins" is a claim about a
          measurement, so it may only render off a read that actually
          returned — `provenance="ZERO"` is the type-level version of the
          same rule (components/ui/empty-state.tsx). */}
      {pinsQuery.isSuccess && pins && pins.length === 0 && (
        <EmptyState
          icon={Pin}
          title="no pins yet"
          provenance="ZERO"
          why="Pins are permanent context you write yourself — nothing has been pinned."
          unlock="Tap 📌 on any assistant reply, or hit Pin new above."
        />
      )}

      {!loading && pins && pins.length > 0 && (
        <ul className="space-y-2">
          {pins.map((pin, idx) => {
            const days = daysAgo(pin.updatedAt);
            const injected = idx < PINNED_PROMPT_CAP;
            const truncated =
              injected && pin.content.length > PINNED_PROMPT_CHARS;
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
                      title="Edit pin content"
                      placeholder="Edit pin content..."
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
                      <span>
                        {editContent.trim().length}/{PIN_STORAGE_CHARS}
                        {editContent.trim().length > PINNED_PROMPT_CHARS && (
                          <span className="ml-1 text-amber-400">
                            · only the first {PINNED_PROMPT_CHARS} reach the prompt
                          </span>
                        )}
                      </span>
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
                          {/* The pin is stored whole but the prompt only
                              carries the first PINNED_PROMPT_CHARS
                              (renderer.ts). Without this the operator had no
                              way to know a long pin's tail never reached the
                              model — the panel showed the full text AND
                              billed tokens for all of it. */}
                          {truncated && (
                            <span
                              className="text-amber-400/90"
                              title={`Stored in full (${pin.content.length} chars) — the prompt carries only the first ${PINNED_PROMPT_CHARS}. Everything after that never reaches the model.`}
                            >
                              cut at {PINNED_PROMPT_CHARS} in prompt
                            </span>
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

      {/* Hot Rules sub-section · gated on the command-center query, not on
          the pin query's loading flag — they are two independent reads now.
          A failed rules read says so rather than silently removing the
          whole subsection, which is the same "declares nothing" shape the
          empty state above was fixed for. */}
      {ccStateQuery.isError && (
        <div className="pt-3 border-t border-white/5">
          <EmptyState
            title="Hot Rules couldn't load"
            provenance="ERROR"
            why="The command-center read failed — this says nothing about whether hard rules exist."
          />
        </div>
      )}

      {brainRules && brainRules.length > 0 && (
        <div className="pt-3 border-t border-white/5 space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--gold)]/80">
            <Sparkles size={11} />
            <span>Active Hot Rules</span>
            <span className="text-[9px] text-[var(--text-tertiary)] font-normal font-mono normal-case">
              most-re-sighted constraints
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
                  {/* 2026-09-02 · was `confidence {Math.round(c * 100)}%`.
                      `brain_memories.confidence` is a re-sighting counter,
                      not a probability — lib/brain/attention-label.ts was
                      written 2026-08-19 to kill this exact percentage and
                      says "One helper, so this cannot drift back". It drifted
                      back here and in the v2 renderer. The rules payload
                      carries no seenCount column, which is the helper's
                      documented last-resort case, so its output is hedged
                      ("seen ~4x") rather than stated as history. */}
                  <p className="font-mono text-[9px] text-[var(--text-tertiary)] uppercase tracking-wider mb-0.5">
                    {rule.key} · {describeConfidenceAsAttention(rule.confidence)}
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
