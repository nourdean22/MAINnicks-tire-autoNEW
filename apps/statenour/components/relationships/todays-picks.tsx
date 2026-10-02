"use client";

/**
 * TodaysPicks · Wave BC · 2026-05-28 redesign.
 *
 * Pre-BC: each pick rendered as a big card · 3 picks = 450px of vertical
 *         space · this was the first thing visible on /people · operator
 *         called it "obnoxious big".
 *
 * Post-BC · Sam-Altman compact pattern:
 *   collapsed (default) · ONE line · gold eyebrow · names the ONE pick:
 *     🎯 NICK · today · DANIA · partner silent 14d        next ▸  ▾
 *   expanded · inline editor below the eyebrow with the same actions
 *   the old card had (draft · regen · log outreach).
 *
 * The underlying pick-engine + draft-fetch + log-outreach paths are
 * unchanged · this is a pure rendering reshape.
 *
 * Lives BELOW the watchlist now (not the page header) · the watchlist
 * gives broad triage, picks give the focused single action.
 */

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Loader2, RefreshCw, Send, Target, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { rawFetch } from "@/lib/utils/api-fetch";

interface Pick {
  personId: string;
  personName: string;
  rationale: string;
  /** Optional · pre-computed draft. Falls back to client-side fetch
   *  when the pick endpoint chose not to pre-compute. */
  draft?: string;
  draftAngle?: string;
}

interface PicksResponse {
  picks: Pick[];
  generatedAt: string;
}

export interface TodaysPicksProps {
  /** Bumped by the parent when ledger changes · forces a refetch so
   *  picks reflect just-logged outreach. */
  refetchKey?: number;
  onLogged?: () => void;
}

export function TodaysPicks({ refetchKey = 0, onLogged }: TodaysPicksProps) {
  const [picks, setPicks] = useState<Pick[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [activeIdx, setActiveIdx] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const data = await rawFetch<PicksResponse>("/api/ai/relationships-pick-today", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });
        if (!cancelled) setPicks(data.picks ?? []);
      } catch {
        if (!cancelled) setPicks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refetchKey]);

  const visible = (picks ?? []).filter((p) => !dismissed.has(p.personId));
  const clampedIdx = Math.min(activeIdx, Math.max(visible.length - 1, 0));
  const active = visible[clampedIdx];

  // Reset active idx when the visible list changes (e.g. dismiss)
  useEffect(() => {
    if (activeIdx >= visible.length && visible.length > 0) setActiveIdx(0);
  }, [visible.length, activeIdx]);

  if (loading) return null; // Silent · don't reserve space while picking
  if (visible.length === 0 || !active) return null;

  return (
    <section
      aria-label="today's outreach picks"
      className="rounded-surface border border-edge-subtle bg-content"
    >
      {/* Eyebrow row · the one-liner that replaces the card stack */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left min-h-[44px] hover:bg-surface-hover transition-colors duration-[var(--motion-state)]"
        aria-expanded={expanded}
      >
        <Target
          size={11}
          className="text-fg-tertiary shrink-0"
          strokeWidth={2}
        />
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary shrink-0">
          nick · today
        </span>
        <span className="text-[var(--text-tertiary)]/40 shrink-0">·</span>
        <span className="text-[11px] font-semibold text-[var(--text-primary)] shrink-0">
          {active.personName}
        </span>
        <span className="text-[var(--text-tertiary)]/40 shrink-0">·</span>
        <span className="text-[11px] text-[var(--text-secondary)] truncate min-w-0 flex-1">
          {active.rationale}
        </span>
        {visible.length > 1 && (
          <span className="text-[11px] font-mono tabular-nums text-fg-tertiary shrink-0">
            {clampedIdx + 1}/{visible.length}
          </span>
        )}
        <ChevronDown
          size={12}
          strokeWidth={2}
          className={cn(
            "text-[var(--text-tertiary)] shrink-0 transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {/* Expanded editor */}
      {expanded && (
        <div className="border-t border-edge-subtle">
          <PickEditor
            key={active.personId}
            pick={active}
            hasNext={visible.length > 1}
            onNext={() =>
              setActiveIdx((i) => (i + 1) % Math.max(visible.length, 1))
            }
            onDismiss={() => {
              setDismissed((prev) => {
                const next = new Set(prev);
                next.add(active.personId);
                return next;
              });
              setActiveIdx(0);
            }}
            onLogged={onLogged}
          />
        </div>
      )}
    </section>
  );
}

interface PickEditorProps {
  pick: Pick;
  hasNext: boolean;
  onNext: () => void;
  onDismiss: () => void;
  onLogged?: () => void;
}

function PickEditor({
  pick,
  hasNext,
  onNext,
  onDismiss,
  onLogged,
}: PickEditorProps) {
  const [draft, setDraft] = useState(pick.draft ?? "");
  const [draftLoading, setDraftLoading] = useState(false);
  const [sending, setSending] = useState(false);

  // Lazy-fetch the draft if the pick endpoint didn't pre-compute it.
  useEffect(() => {
    if (pick.draft || draft) return;
    let cancelled = false;
    void (async () => {
      setDraftLoading(true);
      try {
        const data = await rawFetch<{ draft: string }>("/api/ai/draft-outreach", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            personId: pick.personId,
            rationale: pick.rationale,
          }),
        });
        if (!cancelled) setDraft(data.draft || "");
      } catch {
        if (!cancelled) setDraft("");
      } finally {
        if (!cancelled) setDraftLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick.personId]);

  const handleRegen = useCallback(async () => {
    setDraftLoading(true);
    try {
      const data = await rawFetch<{ draft: string }>("/api/ai/draft-outreach", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personId: pick.personId,
          rationale: pick.rationale,
          regenerate: true,
        }),
      });
      setDraft(data.draft || "");
    } catch {
      toast.error("Couldn't regenerate. Edit manually instead.");
    } finally {
      setDraftLoading(false);
    }
  }, [pick.personId, pick.rationale]);

  const handleSend = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setSending(true);
    try {
      const res = await fetch("/api/relationships/log-outreach", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personId: pick.personId,
          message: trimmed,
          rationale: pick.rationale,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(`Logged outreach to ${pick.personName}.`);
      onLogged?.();
      onDismiss();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Couldn't log: ${msg}`);
    } finally {
      setSending(false);
    }
  }, [
    pick.personId,
    pick.personName,
    pick.rationale,
    draft,
    onDismiss,
    onLogged,
  ]);

  return (
    <div className="p-3 space-y-2">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={draftLoading || sending}
        rows={3}
        placeholder={
          draftLoading
            ? "drafting…"
            : "type the outreach yourself or hit 'different angle' below"
        }
        className={cn(
          // 16px font prevents iOS zoom-on-focus
          "w-full rounded-control border border-edge-default bg-content px-2.5 py-2 text-[16px] text-fg placeholder:text-fg-tertiary resize-none",
          "focus:outline-none focus:border-accent disabled:opacity-50",
        )}
      />

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={handleSend}
          disabled={!draft.trim() || sending || draftLoading}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-control border border-edge-default bg-content px-3 py-2 text-[13px] font-medium text-fg-secondary hover:border-edge-strong hover:text-fg active:scale-95 transition-transform disabled:opacity-50"
        >
          {sending ? (
            <Loader2 size={12} className="animate-spin" strokeWidth={2} />
          ) : (
            <Send size={12} strokeWidth={2} />
          )}
          Log outreach
        </button>
        <button
          type="button"
          onClick={handleRegen}
          disabled={draftLoading || sending}
          aria-label="regenerate draft"
          className="inline-flex min-h-[44px] items-center gap-1 px-2 py-2 text-[13px] font-medium text-fg-tertiary hover:text-fg active:scale-95 transition-transform disabled:opacity-50"
        >
          <RefreshCw size={11} strokeWidth={1.75} />
          Different angle
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="skip pick"
          className="inline-flex min-h-[44px] items-center gap-1 px-2 py-2 text-[13px] font-medium text-fg-tertiary hover:text-rose-300 active:scale-95 transition-transform"
        >
          <X size={11} strokeWidth={1.75} />
          Skip
        </button>
        {hasNext && (
          <button
            type="button"
            onClick={onNext}
            className="ml-auto inline-flex min-h-[44px] items-center gap-1 px-2 py-2 text-[13px] font-medium text-fg-tertiary hover:text-fg active:scale-95 transition-transform"
          >
            Next pick →
          </button>
        )}
      </div>
      <span className="block text-[11px] font-mono text-fg-tertiary leading-tight">
        logs +1 deposit to {pick.personName.split(" ")[0]}&apos;s ledger
      </span>
    </div>
  );
}
