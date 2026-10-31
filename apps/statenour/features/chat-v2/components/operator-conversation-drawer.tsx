"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive, History, Pin, Plus, Search, Trash2, X } from "lucide-react";
import { useConfirmDialog, usePromptDialog } from "@/components/ui/confirm-dialog";
import type { Convo } from "@/hooks/use-conversations";

const MIN_SEARCH_CHARS = 3;
type SearchGroup = {
  conversationId: string;
  conversationTitle: string;
  totalMatches: number;
  snippets: Array<{ snippet: string }>;
};

export function OperatorConversationDrawer({
  convos,
  activeId,
  pinnedIds,
  hasMore,
  loadingMore,
  listState,
  onRetryList,
  onLoadMore,
  onSelect,
  onDelete,
  onRename,
  onTogglePin,
  onArchive,
  archivedConvos,
  archivedState = archivedConvos === null ? "idle" : "ok",
  onLoadArchived,
  onUnarchive,
  onSearchMessages,
  onNew,
  onShowActions,
  actionsDisabled = false,
  onClose,
}: {
  convos: Convo[];
  activeId: string | null;
  pinnedIds: Set<string>;
  hasMore: boolean;
  loadingMore: boolean;
  /** The list read (hooks/use-conversations.ts): a failed read is never shown as an empty list. */
  listState: "loading" | "error" | "ok";
  onRetryList: () => void;
  onLoadMore: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string, event?: React.MouseEvent) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onArchive: (id: string) => void;
  /** U6 · archived rows, read on demand when the Archived tab opens (null = not read, or failed). */
  archivedConvos: Convo[] | null;
  /** audit 002 #2: the archived read (hooks/use-conversations.ts); a failed read is never shown as empty. */
  archivedState?: "idle" | "loading" | "error" | "ok";
  onLoadArchived: () => void;
  onUnarchive: (id: string) => void;
  /** U6b · server full-text search over every message (chat.search); absent = titles only. */
  onSearchMessages?: (q: string) => Promise<{ results: SearchGroup[] }>;
  onNew: () => void;
  onShowActions: () => void;
  /** PR #3090: true while a conversation opens; "/receipts" would land in a thread not yet on screen. */
  actionsDisabled?: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"active" | "pinned" | "archived">("active");
  // U6b · message hits for the query, debounced 300 ms; tagged with their query so a slow
  // answer for an older query never shows under a newer one.
  const [hits, setHits] = useState<{ q: string; state: "loading" | "ok" | "error"; groups: SearchGroup[] } | null>(null);
  const searchQ = query.trim();
  useEffect(() => {
    if (searchQ.length < MIN_SEARCH_CHARS || !onSearchMessages) return;
    const timer = setTimeout(() => {
      setHits({ q: searchQ, state: "loading", groups: [] });
      onSearchMessages(searchQ).then(
        (r) => setHits((cur) => (cur?.q === searchQ ? { q: searchQ, state: "ok", groups: r.results ?? [] } : cur)),
        () => setHits((cur) => (cur?.q === searchQ ? { q: searchQ, state: "error", groups: [] } : cur)),
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQ, onSearchMessages]);
  const messageHits = hits && hits.q === searchQ && searchQ.length >= MIN_SEARCH_CHARS ? hits : null;
  // window.prompt is silently suppressed in iOS standalone PWAs — the
  // Rename tap would no-op on the phone. usePromptDialog is the app
  // standard (same pattern as todo-desk / brain-maturity-header).
  const { prompt: promptDialog, dialog: renameDialog } = usePromptDialog();
  // 2026-09-02 deep-research audit (C-4) — delete had NO confirmation of any
  // kind: one tap on the trash icon destroyed a conversation and its whole
  // message history. Not a suppressed window.confirm — there was nothing to
  // suppress. Rename, the strictly less destructive action two buttons to the
  // left, already used a dialog. Archive stays one-tap on purpose: it is
  // reversible. Same in-DOM primitive, because window.confirm is silently
  // swallowed in the installed iOS PWA the operator actually uses.
  const { confirm: confirmDialog, dialog: deleteDialog } = useConfirmDialog();
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (mode === "archived" ? archivedConvos ?? [] : convos).filter((conversation) => {
      if (mode === "pinned" && !pinnedIds.has(conversation.id)) return false;
      if (!q) return true;
      return (conversation.title || "Untitled conversation").toLowerCase().includes(q);
    });
  }, [archivedConvos, convos, mode, pinnedIds, query]);

  return (
    <aside className="flex h-full flex-col bg-void text-fg">
      <div className="flex items-center gap-2 border-b border-edge p-3">
        <button onClick={onNew} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-control border border-edge-default bg-content px-3 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg">
          <Plus size={14} /> New chat
        </button>
        <button onClick={onClose} aria-label="Close history" className="flex h-11 w-11 items-center justify-center rounded-control border border-edge-default text-fg-secondary hover:text-fg"><X size={16} /></button>
      </div>

      <div className="space-y-2 border-b border-edge p-3">
        <button type="button" onClick={onShowActions} disabled={actionsDisabled} className="disabled:opacity-50 flex min-h-11 w-full items-center gap-2 rounded-control border border-edge-default bg-content px-3 text-left text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg">
          <History size={14} /> Verified recent actions
        </button>
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-tertiary" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" className="h-11 w-full rounded-control border border-edge-default bg-raised pl-9 pr-3 text-[16px] sm:text-[13px] text-fg outline-none focus:border-accent" />
        </div>
        <div className="grid grid-cols-3 rounded-surface border border-edge-default bg-raised p-1">
          {(["active", "pinned", "archived"] as const).map((value) => (
            <button
              key={value}
              aria-pressed={mode === value}
              onClick={() => {
                setMode(value);
                if (value === "archived") onLoadArchived();
              }} className={`min-h-11 rounded-control sm:min-h-8 text-[13px] font-medium capitalize transition-colors duration-[var(--motion-state)] ${mode === value ? "bg-accent-soft text-fg" : "text-fg-tertiary hover:text-fg-secondary"}`}>
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {/* One always-mounted status region for the read (announced); Retry stays mounted while the
            re-read is in flight. A background reload (after a new conversation) keeps the rows; the
            loading line is for an empty drawer. */}
        <div role="status" aria-live="polite" className={listState === "ok" || (listState === "loading" && convos.length > 0) ? "sr-only" : "flex min-h-11 flex-wrap items-center justify-center gap-2 p-5 text-center text-[13px] text-fg-secondary"}>
          {listState === "error" && "History unavailable: the list could not be read."}
          {listState === "loading" && convos.length === 0 && "Loading history…"}
          {listState !== "ok" && (
            <button type="button" onClick={onRetryList} disabled={listState === "loading"} className="min-h-11 rounded-control px-2 font-medium text-fg underline disabled:opacity-50">Retry</button>
          )}
        </div>
        {mode === "archived" && archivedConvos === null && (
          <div role="status" aria-live="polite" className="flex min-h-11 flex-wrap items-center justify-center gap-2 p-5 text-center text-[13px] text-fg-secondary">
            {archivedState === "error" ? "Archived list could not be read." : "Loading archived conversations…"}
            {archivedState === "error" && (
              <button type="button" onClick={onLoadArchived} className="min-h-11 rounded-control px-2 font-medium text-fg underline">Retry</button>
            )}
          </div>
        )}
        {(mode === "archived" ? archivedConvos !== null : listState === "ok") && visible.length === 0 && (
          <p className="p-5 text-center text-xs text-fg-tertiary">{mode === "archived" ? "Nothing archived." : "No conversations in this view."}</p>
        )}
        {visible.map((conversation) => (
          <div key={conversation.id} className={`group mb-1 rounded-control border p-2 transition ${activeId === conversation.id ? "border-accent/40 bg-accent-soft" : "border-transparent hover:border-edge-default hover:bg-raised"}`}>
            <button onClick={() => onSelect(conversation.id)} className="w-full text-left">
              <p className="truncate text-xs font-medium text-fg">{conversation.title || "Untitled conversation"}</p>
              <p className="mt-1 text-[11px] text-fg-tertiary">{conversation._count.messages} Messages · {new Date(conversation.createdAt).toLocaleDateString()}</p>
            </button>
            {mode === "archived" ? (
              <div className="mt-2 flex items-center gap-1">
                <button onClick={() => onUnarchive(conversation.id)} aria-label={`Unarchive ${conversation.title || "Untitled conversation"}`} className="min-h-11 rounded-control px-2 text-[12px] font-medium text-fg-secondary hover:bg-elevated hover:text-fg sm:min-h-8">
                  Unarchive
                </button>
              </div>
            ) : (
            <div className="mt-2 flex items-center gap-1 opacity-70 transition group-hover:opacity-100">
              <button onClick={() => onTogglePin(conversation.id)} title={pinnedIds.has(conversation.id) ? "Unpin" : "Pin"} aria-label={pinnedIds.has(conversation.id) ? "Unpin conversation" : "Pin conversation"} className="flex h-11 w-11 items-center justify-center rounded-control text-fg-tertiary hover:bg-elevated hover:text-fg sm:h-8 sm:w-8"><Pin size={12} fill={pinnedIds.has(conversation.id) ? "currentColor" : "none"} /></button>
              <button
                onClick={async () => {
                  const next = await promptDialog({
                    title: "Rename conversation",
                    defaultValue: conversation.title || "",
                    placeholder: "Conversation title",
                    confirmLabel: "Rename",
                  });
                  if (next?.trim()) onRename(conversation.id, next.trim());
                }}
                title="Rename"
                className="min-h-11 rounded-control px-2 text-[12px] font-medium text-fg-tertiary hover:bg-elevated hover:text-fg sm:min-h-8"
              >
                Rename
              </button>
              <button onClick={() => onArchive(conversation.id)} title="Archive" aria-label="Archive conversation" className="ml-auto flex h-11 w-11 items-center justify-center rounded-control text-fg-tertiary hover:bg-elevated hover:text-fg sm:h-8 sm:w-8"><Archive size={12} /></button>
              <button
                onClick={async (event) => {
                  event.stopPropagation();
                  const messageCount = conversation._count.messages;
                  const ok = await confirmDialog({
                    title: "Delete this conversation?",
                    body: `“${conversation.title || "Untitled conversation"}” and its ${messageCount} message${messageCount === 1 ? "" : "s"} are removed. This cannot be undone. Archive instead if you only want it out of the way.`,
                    confirmLabel: "Delete",
                    cancelLabel: "Keep",
                    tone: "danger",
                  });
                  if (ok) onDelete(conversation.id);
                }}
                title="Delete"
                aria-label="Delete conversation"
                className="flex h-11 w-11 items-center justify-center rounded-control text-fg-tertiary hover:bg-red-500/10 hover:text-red-400 sm:h-8 sm:w-8"
              >
                <Trash2 size={12} />
              </button>
            </div>
            )}
          </div>
        ))}
        {messageHits && (
          <section aria-label="Messages that match" className="mt-3 border-t border-edge pt-2">
            <p role="status" className="px-2 pb-1 text-[11px] font-medium text-fg-tertiary">
              {messageHits.state === "loading"
                ? "Searching messages…"
                : messageHits.state === "error"
                  ? "Message search failed. Titles above are still filtered."
                  : messageHits.groups.length === 0
                    ? "No messages match."
                    : `In messages (${messageHits.groups.length})`}
            </p>
            {messageHits.groups.map((g) => (
              <button
                key={g.conversationId}
                onClick={() => onSelect(g.conversationId)}
                className="mb-1 block min-h-11 w-full rounded-control border border-transparent p-2 text-left hover:border-edge-default hover:bg-raised"
              >
                <p className="truncate text-xs font-medium text-fg">{g.conversationTitle || "Untitled conversation"}</p>
                {g.snippets[0] ? <p className="mt-1 line-clamp-2 text-[11px] text-fg-secondary">{g.snippets[0].snippet}</p> : null}
                <p className="mt-1 text-[11px] text-fg-tertiary">
                  {g.totalMatches} {g.totalMatches === 1 ? "match" : "matches"}
                </p>
              </button>
            ))}
          </section>
        )}
        {hasMore && mode !== "archived" && <button disabled={loadingMore} onClick={onLoadMore} className="mt-2 min-h-11 w-full rounded-control border border-edge-default text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg disabled:opacity-50">{loadingMore ? "Loading…" : "Load older"}</button>}
      </div>
      {renameDialog}
      {deleteDialog}
    </aside>
  );
}
