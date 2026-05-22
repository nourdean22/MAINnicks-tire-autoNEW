"use client";

/**
 * MITSlot · v10.0.300 · daily Most Important Task slot for Ultron HQ.
 *
 * One MIT per day · the binary daily-focus anchor distinct from the
 * todo list. The operator answers "what's the ONE thing that matters
 * today?" and pins it. Big bold typography so it's the first thing
 * the eye lands on.
 *
 * Three states ·
 *   · UNSET · subtle "Set today's MIT" prompt · low-noise
 *   · SET · gold-toned bold readout · click to edit
 *   · EDITING · inline form · save / cancel
 *
 * Persistence via /api/mit (brainMemory category="daily_mit", key by
 * date). Auto-resets at midnight (next day = new key = empty MIT).
 */
import { useState } from "react";
import { Crosshair, Edit3 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";

export function MITSlot() {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  // Phase B.6a (2026-05-22) · migrated all 3 calls off `authedFetch`:
  //   · GET  /api/mit → operator.mit query
  //   · POST /api/mit (set)   → operator.setMit mutation
  //   · POST /api/mit (clear) → operator.clearMit mutation
  // React Query owns the read; the displayed MIT text is the query's
  // `data.text`. The mutations invalidate the query on success so the
  // readout refreshes without a manual setState — same end state as
  // the legacy `setText(d.text)`. `loading` mirrors the query's
  // initial fetch · `saving` is true while either mutation is in
  // flight (a failed save leaves the form open so the operator can
  // retry, exactly as before · `setMit` only throws on a real error).
  const utils = trpc.useUtils();
  const { data: mit, isLoading: loading } = trpc.operator.mit.useQuery();
  const text = mit?.text ?? null;

  const setMutation = trpc.operator.setMit.useMutation({
    onSuccess: () => {
      setEditing(false);
      setDraft("");
      void utils.operator.mit.invalidate();
    },
  });
  const clearMutation = trpc.operator.clearMit.useMutation({
    onSuccess: () => {
      setEditing(false);
      setDraft("");
      void utils.operator.mit.invalidate();
    },
  });
  const saving = setMutation.isPending || clearMutation.isPending;

  const startEdit = () => {
    setDraft(text ?? "");
    setEditing(true);
  };

  const save = () => {
    setMutation.mutate({ text: draft });
  };

  const clear = () => {
    clearMutation.mutate();
  };

  if (loading) return null;

  if (editing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) save();
        }}
        data-no-anchor
        className="rounded-lg border border-[var(--gold)]/45 bg-[var(--gold)]/[0.05] px-3 py-2.5"
      >
        <div className="flex items-center gap-1 text-[8px] font-mono uppercase tracking-wider text-[var(--gold)] mb-1">
          <Crosshair size={10} />
          <span>Today&apos;s MIT · the one outcome that matters</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="The one thing that defines today…"
            maxLength={120}
            className="flex-1 bg-transparent border-none outline-none font-[var(--font-display)] text-[14px] font-bold text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]/60"
          />
          <button
            type="submit"
            disabled={saving || !draft.trim()}
            className="text-[10px] font-mono uppercase tracking-wider text-[var(--gold)] hover:text-[var(--gold-dim)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "…" : "Save"}
          </button>
          {text && (
            <button
              type="button"
              onClick={clear}
              className="text-[10px] font-mono uppercase tracking-wider text-rose-400/70 hover:text-rose-300"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setDraft("");
            }}
            className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  if (!text) {
    return (
      <button
        type="button"
        onClick={startEdit}
        data-no-anchor
        className="group w-full text-left rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] px-3 py-2 transition-all hover:border-[var(--gold)]/30 hover:bg-[var(--gold)]/[0.02]"
      >
        <div className="flex items-center gap-2 text-[var(--text-tertiary)] group-hover:text-[var(--gold)]/80 transition-colors">
          <Crosshair size={12} />
          <span className="text-[11px] font-mono uppercase tracking-wider">
            Set today&apos;s MIT · the one outcome that matters
          </span>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      data-no-anchor
      className="group w-full text-left rounded-lg border border-[var(--gold)]/30 bg-[var(--gold)]/[0.05] px-3 py-2.5 transition-all hover:border-[var(--gold)]/55 hover:bg-[var(--gold)]/[0.08]"
    >
      <div className="flex items-center gap-2 text-[8px] font-mono uppercase tracking-wider text-[var(--gold)]/80 mb-1">
        <Crosshair size={10} />
        <span>Today&apos;s MIT</span>
        <Edit3
          size={10}
          className="ml-auto opacity-0 group-hover:opacity-60 transition-opacity"
        />
      </div>
      <div className="font-[var(--font-display)] text-[15px] font-bold text-[var(--text-primary)] leading-tight">
        {text}
      </div>
    </button>
  );
}
