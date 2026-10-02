"use client";

import { useMemo, useState } from "react";
import { Archive, History, Pin, Plus, Search, Trash2, X } from "lucide-react";
import { useConfirmDialog, usePromptDialog } from "@/components/ui/confirm-dialog";
import type { Convo } from "@/hooks/use-conversations";

export function OperatorConversationDrawer({
  convos,
  activeId,
  pinnedIds,
  hasMore,
  loadingMore,
  onLoadMore,
  onSelect,
  onDelete,
  onRename,
  onTogglePin,
  onArchive,
  onNew,
  onShowActions,
  onClose,
}: {
  convos: Convo[];
  activeId: string | null;
  pinnedIds: Set<string>;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string, event?: React.MouseEvent) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onArchive: (id: string) => void;
  onNew: () => void;
  onShowActions: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"active" | "pinned">("active");
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
    return convos.filter((conversation) => {
      if (mode === "pinned" && !pinnedIds.has(conversation.id)) return false;
      if (!q) return true;
      return (conversation.title || "Untitled conversation").toLowerCase().includes(q);
    });
  }, [convos, mode, pinnedIds, query]);

  return (
    <aside className="flex h-full flex-col bg-void text-fg">
      <div className="flex items-center gap-2 border-b border-edge p-3">
        <button onClick={onNew} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-control border border-edge-default bg-content px-3 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg">
          <Plus size={14} /> New chat
        </button>
        <button onClick={onClose} aria-label="Close history" className="flex h-11 w-11 items-center justify-center rounded-control border border-edge-default text-fg-secondary hover:text-fg"><X size={16} /></button>
      </div>

      <div className="space-y-2 border-b border-edge p-3">
        <button onClick={onShowActions} className="flex min-h-11 w-full items-center gap-2 rounded-control border border-edge-default bg-content px-3 text-left text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg">
          <History size={14} /> Verified recent actions
        </button>
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-tertiary" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" className="h-11 w-full rounded-control border border-edge-default bg-raised pl-9 pr-3 text-[16px] sm:text-[13px] text-fg outline-none focus:border-accent" />
        </div>
        <div className="grid grid-cols-2 rounded-surface border border-edge-default bg-raised p-1">
          {(["active", "pinned"] as const).map((value) => (
            <button key={value} onClick={() => setMode(value)} className={`min-h-11 rounded-control sm:min-h-8 text-[13px] font-medium capitalize transition-colors duration-[var(--motion-state)] ${mode === value ? "bg-accent-soft text-fg" : "text-fg-tertiary hover:text-fg-secondary"}`}>
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {visible.length === 0 && <p className="p-5 text-center text-xs text-fg-tertiary">No conversations in this view.</p>}
        {visible.map((conversation) => (
          <div key={conversation.id} className={`group mb-1 rounded-control border p-2 transition ${activeId === conversation.id ? "border-accent/40 bg-accent-soft" : "border-transparent hover:border-edge-default hover:bg-raised"}`}>
            <button onClick={() => onSelect(conversation.id)} className="w-full text-left">
              <p className="truncate text-xs font-medium text-fg">{conversation.title || "Untitled conversation"}</p>
              <p className="mt-1 text-[11px] text-fg-tertiary">{conversation._count.messages} messages · {new Date(conversation.createdAt).toLocaleDateString()}</p>
            </button>
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
                    body: `“${conversation.title || "Untitled conversation"}” and its ${messageCount} message${messageCount === 1 ? "" : "s"} are removed. This cannot be undone — archive instead if you only want it out of the way.`,
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
          </div>
        ))}
        {hasMore && <button disabled={loadingMore} onClick={onLoadMore} className="mt-2 min-h-11 w-full rounded-control border border-edge-default text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg disabled:opacity-50">{loadingMore ? "Loading…" : "Load older"}</button>}
      </div>
      {renameDialog}
      {deleteDialog}
    </aside>
  );
}
