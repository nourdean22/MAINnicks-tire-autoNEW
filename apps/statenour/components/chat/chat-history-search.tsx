"use client";

/**
 * CHAT HISTORY SEARCH — Cmd+F overlay in /chat.
 *
 * Before this, to find "what did Nick say about X last week" you had
 * to scroll through history or open a past conversation blindly. Now:
 * press Cmd+F (or Ctrl+F) in /chat, type a query, see snippets across
 * every past conversation, click one to load that conversation.
 *
 * Search is server-side via /api/chat/search which does a case-
 * insensitive Postgres ILIKE match across all ChatMessage content,
 * grouped by conversation and sorted by recency.
 *
 * Keyboard:
 *   Cmd+F / Ctrl+F  — open (handled by parent)
 *   Esc             — close
 *   Enter           — fire search (debounced auto on type)
 *   ↑/↓             — navigate results (TODO: polish pass)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { X, Search, MessageSquare, User, Bot, Loader2, Download, Star, Archive, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { trpc } from "@/lib/trpc/client";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

// Phase Z (2026-05-18 PM) · Snippet + SearchResultGroup types now flow
// from the chat.search procedure's return shape · the manual mirrors
// are removed below.
//
// Phase B.5 (2026-05-22) · toggleConvoFlag + deleteConvo migrated off
// `authedFetch` onto `trpc.chat.updateConversation` /
// `trpc.chat.deleteConversation` mutations · the search query was
// already on tRPC (Phase Z).

interface ChatHistorySearchProps {
  open: boolean;
  onClose: () => void;
  onJumpTo: (conversationId: string) => void;
}

export function ChatHistorySearch({ open, onClose, onJumpTo }: ChatHistorySearchProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  // Phase Z · React Query handles search. Manual debounce stays as a
  // 250ms gate that controls when the debouncedQuery key changes ·
  // React Query then deduplicates / caches / refetches per input.
  const trimmedDebounced = debouncedQuery.trim();
  const utils = trpc.useUtils();
  const searchQ = trpc.chat.search.useQuery(
    { q: trimmedDebounced, limit: 25 },
    {
      enabled: trimmedDebounced.length >= 2,
      staleTime: 5_000,
    },
  );
  const results = searchQ.data?.results ?? [];
  const totalMessages = searchQ.data?.totalMessages ?? 0;
  const loading = searchQ.isFetching;
  const refreshSearch = useCallback(() => {
    void utils.chat.search.invalidate();
  }, [utils]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery("");
      setDebouncedQuery("");
    }
  }, [open]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Debounced query · 250ms · same cadence as the pre-Z manual debounce.
  // React Query takes over from here · per-input refetch + cache.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(query);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Phase B.5 · React Query mutations replace the authedFetch PATCH /
  // DELETE. onSuccess/onError preserve the prior toast + cache-refresh
  // behavior exactly.
  const updateConvoMut = trpc.chat.updateConversation.useMutation();
  const deleteConvoMut = trpc.chat.deleteConversation.useMutation();

  const toggleConvoFlag = useCallback(
    async (conversationId: string, flag: "starred" | "archived") => {
      try {
        await updateConvoMut.mutateAsync({ id: conversationId, [flag]: true });
        toast.success(flag === "starred" ? "Starred" : "Archived");
        refreshSearch();
      } catch {
        toast.error("Failed");
      }
    },
    [updateConvoMut, refreshSearch],
  );

  const deleteConvo = useCallback(
    async (conversationId: string, title: string) => {
      const ok = await confirm({
        title: "Delete conversation?",
        body: `Delete "${title}"? This cannot be undone.`,
        confirmLabel: "Delete",
        tone: "danger",
      });
      if (!ok) return;
      try {
        await deleteConvoMut.mutateAsync({ id: conversationId });
        toast.success("deleted");
        // Phase Z · optimistic drop · setData() removes the row from
        // React Query's cache so the list updates immediately without
        // a re-fetch race. invalidate() then triggers a background
        // refetch to reconcile with the server.
        utils.chat.search.setData({ q: trimmedDebounced, limit: 25 }, (old) =>
          old
            ? {
                ...old,
                results: old.results.filter((g) => g.conversationId !== conversationId),
              }
            : old,
        );
        void utils.chat.search.invalidate();
      } catch {
        toast.error("Delete failed");
      }
    },
    [deleteConvoMut, utils, trimmedDebounced, confirm],
  );

  const handleJump = useCallback(
    (conversationId: string) => {
      onJumpTo(conversationId);
      onClose();
    },
    [onJumpTo, onClose]
  );

  if (!open) return null;

  return (
    <>
      {confirmDialog}
      <div
      className="fixed inset-0 z-[9600] flex items-start justify-center pt-[8vh] px-4 bg-[var(--bg-void)]/85 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Search chat history"
    >
      <div
        className="relative w-full max-w-2xl rounded-2xl border border-[var(--gold)]/30 bg-[var(--bg-void)] shadow-[0_20px_60px_rgba(0,0,0,0.6),0_0_40px_rgba(253,185,19,0.15)] overflow-hidden animate-fade-in-scale max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header + search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-default)]">
          <Search size={14} className="text-[var(--gold)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search across all chat history…"
            className="flex-1 bg-transparent outline-none text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
          />
          {loading && (
            <Loader2 size={13} className="text-[var(--gold)] shrink-0 animate-spin" />
          )}
          <kbd className="hidden sm:inline-flex items-center gap-1 h-5 px-1.5 rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[9px] font-mono text-[var(--text-tertiary)]">
            ⌘F
          </kbd>
          <button
            onClick={onClose}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {query.trim().length < 2 && (
            <div className="text-center py-12 px-4">
              <MessageSquare size={24} className="text-[var(--gold)]/40 mx-auto mb-3" />
              <p className="text-[13px] font-semibold text-[var(--text-secondary)]">
                Search every conversation
              </p>
              <p className="text-[11px] text-[var(--text-tertiary)] mt-2 max-w-[380px] mx-auto">
                Find anything Nick said or anything you asked — across every past chat session.
                Type at least 2 characters.
              </p>
            </div>
          )}

          {query.trim().length >= 2 && !loading && results.length === 0 && (
            <div className="text-center py-12 px-4">
              <p className="text-[13px] font-semibold text-[var(--text-secondary)]">
                No matches for &ldquo;{query}&rdquo;
              </p>
              <p className="text-[11px] text-[var(--text-tertiary)] mt-2">
                Try different keywords.
              </p>
            </div>
          )}

          {results.length > 0 && (
            <>
              <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] px-4 py-2 border-b border-zinc-800/40 sticky top-0 bg-[var(--bg-void)] z-10">
                {totalMessages} match{totalMessages === 1 ? "" : "es"} in {results.length} conversation{results.length === 1 ? "" : "s"}
              </p>
              <ul className="divide-y divide-zinc-800/40">
                {results.map((group) => (
                  <li
                    key={group.conversationId}
                    className="px-4 py-3 hover:bg-[var(--bg-elevated)] cursor-pointer transition-colors"
                    onClick={() => handleJump(group.conversationId)}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <h3 className="text-[12px] font-semibold text-[var(--text-primary)] truncate flex-1">
                        {group.conversationTitle}
                      </h3>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleConvoFlag(group.conversationId, "starred");
                        }}
                        className="p-1 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-tertiary)] hover:text-amber-300 transition-colors shrink-0"
                        title="Star this conversation"
                      >
                        <Star size={10} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleConvoFlag(group.conversationId, "archived");
                        }}
                        className="p-1 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-tertiary)] hover:text-zinc-300 transition-colors shrink-0"
                        title="Archive this conversation"
                      >
                        <Archive size={10} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(
                            `/api/chat/export/${group.conversationId}?format=md&include=all`,
                            "_blank"
                          );
                        }}
                        className="p-1 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-tertiary)] hover:text-[var(--gold)] transition-colors shrink-0"
                        title="Export as markdown"
                      >
                        <Download size={10} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteConvo(group.conversationId, group.conversationTitle);
                        }}
                        className="p-1 rounded hover:bg-rose-500/10 text-[var(--text-tertiary)] hover:text-rose-400 transition-colors shrink-0"
                        title="Delete this conversation"
                      >
                        <Trash2 size={10} />
                      </button>
                      <span className="text-[9px] font-mono text-[var(--text-tertiary)] shrink-0">
                        {group.totalMatches} match{group.totalMatches === 1 ? "" : "es"}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {group.snippets.map((s) => (
                        <div key={s.messageId} className="flex items-start gap-2">
                          {s.role === "user" ? (
                            <User size={9} className="text-[var(--gold)] mt-0.5 shrink-0" />
                          ) : (
                            <Bot size={9} className="text-emerald-400 mt-0.5 shrink-0" />
                          )}
                          <p
                            className="text-[11px] text-[var(--text-secondary)] leading-snug line-clamp-2"
                            dangerouslySetInnerHTML={{
                              __html: highlightMatch(s.snippet, query),
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
    </>
  );
}

/**
 * Wrap matched substrings in a highlight span. Simple case-insensitive
 * match — doesn't handle regex specials but is safe for plain search.
 */
function highlightMatch(text: string, query: string): string {
  if (!query || query.length < 2) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const queryRe = new RegExp(
    `(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
    "gi"
  );
  return escaped.replace(
    queryRe,
    `<mark class="bg-[var(--gold)]/30 text-[var(--gold)] rounded px-0.5">$1</mark>`
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
