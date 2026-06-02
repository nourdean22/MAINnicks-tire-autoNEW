"use client";

/**
 * MessageEditControls — "edited" badge + in-place edit + history drawer.
 *
 * v7.6 · C9 · Apr 29 · ChatMessage Batch A.
 *
 * Three states:
 *   1. Resting (no edit yet)        — silent, returns null
 *   2. Resting (edited)             — subtle "edited" badge, click to open history
 *   3. Edit-in-progress             — textarea over the message body + Save/Cancel
 *
 * UX flow:
 *   · Long-press / hover-then-click an "edit" affordance (added in
 *     parent) → calls onStartEdit with current content.
 *   · Parent renders <MessageEditControls> in edit mode → user types →
 *     Save POSTs to /api/ai/chat/edit/[messageId].
 *   · On success, parent receives onSaved callback with new content +
 *     swaps the rendered message body.
 *   · "edited" badge clicks open a drawer with editHistory[] versions.
 *
 * Design philosophy (per Nour):
 *   · Power+control: every prior version is recoverable from the drawer.
 *   · Alive: "edited" badge has a subtle glow on hover; the textarea
 *     auto-resizes; Save button pulses when ready.
 */

import { useState, useEffect, useRef } from "react";
import { Pencil, History, Check, X, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

interface EditHistoryEntry {
  at: string;
  prevContent: string;
}

interface EditableMessage {
  id: string;
  content: string;
  editedAt?: string | Date | null;
}

export interface MessageEditControlsProps {
  message: EditableMessage;
  /** Whether to show the inline editor (parent controls). */
  editing: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  /** Fired after a successful PATCH. Parent should swap message.content. */
  onSaved: (newContent: string, editedAt: string) => void;
  /** Fired when user picks a prior version from the history drawer. */
  onRevertTo?: (priorContent: string) => void;
  className?: string;
}

export function MessageEditControls({
  message,
  editing,
  onStartEdit,
  onCancel,
  onSaved,
  onRevertTo,
  className,
}: MessageEditControlsProps) {
  const isEdited = !!message.editedAt;
  const [draft, setDraft] = useState(message.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<EditHistoryEntry[] | null>(null);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Phase JJ (2026-05-18 PM) · tRPC migration · `utils.chat.editHistory.fetch()`
  // for the lazy history drawer (fires on click) + `trpc.chat.editMessage`
  // mutation for the Save button. Coexists with legacy REST endpoint.
  const utils = trpc.useUtils();
  const editMessageMutation = trpc.chat.editMessage.useMutation();

  // Reset draft when entering edit mode
  useEffect(() => {
    if (editing) {
      setDraft(message.content);
      setError(null);
      requestAnimationFrame(() => ref.current?.focus());
    }
  }, [editing, message.content]);

  // Auto-resize textarea
  useEffect(() => {
    const el = ref.current;
    if (!el || !editing) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [draft, editing]);

  const handleSave = async () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("content can't be empty");
      return;
    }
    if (trimmed === message.content.trim()) {
      onCancel();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await editMessageMutation.mutateAsync({
        messageId: message.id,
        content: trimmed,
      });
      // Server may report unchanged when the content matches what's
      // already stored (idempotent no-op). Don't fire onSaved in that
      // case — the parent's local state already matches.
      if (!result.unchanged) {
        // editedAt is serialized as string over the wire (Date round-trip
        // via superjson preserves Date · raw JSON sends string · be safe
        // either way).
        const editedAtIso =
          typeof result.editedAt === "string"
            ? result.editedAt
            : new Date(result.editedAt as unknown as string | number | Date).toISOString();
        onSaved(result.content, editedAtIso);
        // Invalidate the cached history so a re-open shows the new
        // prior-content entry without needing to refetch eagerly.
        void utils.chat.editHistory.invalidate({ messageId: message.id });
        // Drop the cached history list locally so the next drawer
        // open re-fetches via loadHistory().
        setHistory(null);
      } else {
        onCancel();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "edit failed");
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSave();
    }
  };

  const loadHistory = async () => {
    if (history) {
      setHistoryOpen(true);
      return;
    }
    try {
      // Phase JJ · imperative-fetch-via-utils pattern · fires only on
      // history-button click · `utils.chat.editHistory.fetch()` returns
      // a one-shot promise with the typed view + caches the result for
      // future renders (invalidated after each editMessage mutation).
      const view = await utils.chat.editHistory.fetch({ messageId: message.id });
      setHistory(view.editHistory);
      setHistoryOpen(true);
    } catch {
      // silent · drawer just won't open if the fetch fails
    }
  };

  if (editing) {
    return (
      <div className={cn("flex flex-col gap-1.5 mt-1", className)}>
        <textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          className="w-full resize-none rounded-md border border-[var(--gold)]/40 bg-[var(--bg-elevated)]/60 px-2 py-1.5 text-[13px] leading-[1.5] text-[var(--text-primary)] outline-none focus:border-[var(--gold)] focus:ring-1 focus:ring-[var(--gold)]/30"
          placeholder="edit message…"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !draft.trim() || draft.trim() === message.content.trim()}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[10.5px] font-mono uppercase tracking-wider",
              "border-[var(--gold)]/40 bg-[var(--gold)]/10 text-[var(--gold)]",
              "hover:bg-[var(--gold)]/20 hover:border-[var(--gold)]/60",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              !saving && draft.trim() && draft.trim() !== message.content.trim() && "msg-edit-save-pulse",
            )}
            title="Save (⌘+Enter)"
          >
            <Check size={11} />
            {saving ? "saving…" : "save"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--border-default)] text-[10.5px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)]"
            title="Cancel (Esc)"
          >
            <X size={11} />
            cancel
          </button>
          <span className="text-[9px] font-mono text-[var(--text-tertiary)] ml-auto">
            ⌘+Enter to save · Esc to cancel
          </span>
        </div>
        {error && <p className="text-[10px] text-red-400 font-mono mt-0.5">{error}</p>}
        <style jsx>{`
          .msg-edit-save-pulse {
            animation: msg-edit-save-pulse 1.4s ease-in-out infinite;
          }
          @keyframes msg-edit-save-pulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(212,175,55, 0); }
            50%      { box-shadow: 0 0 0 4px rgba(212,175,55, 0.18); }
          }
        `}</style>
      </div>
    );
  }

  // Resting state — show edit affordance + (when applicable) edited badge
  return (
    <div className={cn("inline-flex items-center gap-1.5", className)}>
      <button
        type="button"
        onClick={onStartEdit}
        className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-md border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:border-[var(--gold)]/40 transition-colors"
        title="Edit message"
        aria-label="Edit"
      >
        <Pencil size={10} />
      </button>
      {isEdited && (
        <button
          type="button"
          onClick={loadHistory}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-zinc-500/30 bg-zinc-500/[0.05] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-zinc-500/50 text-[9px] font-mono uppercase tracking-wider transition-colors"
          title="View edit history"
        >
          <History size={9} />
          edited
        </button>
      )}

      {historyOpen && history && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-[88] bg-black/40"
            onClick={() => setHistoryOpen(false)}
          />
          {/* Drawer */}
          <div className="fixed top-12 right-4 sm:right-12 bottom-12 z-[89] w-[min(420px,90vw)] rounded-xl border border-[var(--border-default)] bg-[var(--bg-void)]/95 backdrop-blur-xl shadow-2xl overflow-hidden animate-fadeSlideUp flex flex-col">
            <div className="flex items-center justify-between p-3 border-b border-[var(--border-default)]">
              <div className="flex items-center gap-2">
                <History size={13} className="text-[var(--gold)]" />
                <span className="font-mono uppercase tracking-[0.18em] text-[10px] text-[var(--gold)]">
                  edit history
                </span>
                <span className="text-[10px] text-[var(--text-tertiary)] font-mono">
                  {history.length} version{history.length === 1 ? "" : "s"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {history.length === 0 ? (
                <p className="p-4 text-center text-[10px] text-[var(--text-tertiary)] italic">
                  no prior versions
                </p>
              ) : (
                history.map((entry, i) => (
                  <div key={`${entry.at}-${i}`} className="p-3 border-b border-[var(--border-default)] hover:bg-[var(--bg-raised)]/30">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                        v{history.length - i} · {new Date(entry.at).toLocaleString()}
                      </span>
                      {onRevertTo && (
                        <button
                          type="button"
                          onClick={() => {
                            onRevertTo(entry.prevContent);
                            setHistoryOpen(false);
                          }}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--gold)] border border-[var(--border-default)] hover:border-[var(--gold)]/40"
                          title="Restore this version"
                        >
                          <RotateCcw size={9} />
                          revert
                        </button>
                      )}
                    </div>
                    <p className="text-[12px] text-[var(--text-primary)] whitespace-pre-wrap leading-[1.55] line-clamp-6">
                      {entry.prevContent}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
