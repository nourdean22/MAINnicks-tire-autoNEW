"use client";

import { useMemo, useState } from "react";
import { Archive, History, Pin, Plus, Search, Trash2, X } from "lucide-react";
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
        <button onClick={onNew} className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-gold px-3 text-xs font-bold text-black">
          <Plus size={14} /> New chat
        </button>
        <button onClick={onClose} aria-label="Close history" className="flex h-10 w-10 items-center justify-center rounded-lg border border-edge text-fg-secondary hover:text-fg"><X size={16} /></button>
      </div>

      <div className="space-y-2 border-b border-edge p-3">
        <button onClick={onShowActions} className="flex min-h-10 w-full items-center gap-2 rounded-lg border border-gold/25 bg-gold/[0.05] px-3 text-left text-xs font-semibold text-gold hover:bg-gold/10">
          <History size={14} /> Verified recent actions
        </button>
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-tertiary" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" className="h-10 w-full rounded-lg border border-edge bg-raised pl-9 pr-3 text-xs text-fg outline-none focus:border-gold/40" />
        </div>
        <div className="grid grid-cols-2 rounded-lg border border-edge bg-raised p-1">
          {(["active", "pinned"] as const).map((value) => (
            <button key={value} onClick={() => setMode(value)} className={`min-h-8 rounded-md text-[10px] font-semibold uppercase tracking-wider ${mode === value ? "bg-elevated text-fg" : "text-fg-tertiary"}`}>
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {visible.length === 0 && <p className="p-5 text-center text-xs text-fg-tertiary">No conversations in this view.</p>}
        {visible.map((conversation) => (
          <div key={conversation.id} className={`group mb-1 rounded-lg border p-2 transition ${activeId === conversation.id ? "border-gold/35 bg-gold/[0.06]" : "border-transparent hover:border-edge hover:bg-raised"}`}>
            <button onClick={() => onSelect(conversation.id)} className="w-full text-left">
              <p className="truncate text-xs font-medium text-fg">{conversation.title || "Untitled conversation"}</p>
              <p className="mt-1 text-[9px] text-fg-tertiary">{conversation._count.messages} messages · {new Date(conversation.createdAt).toLocaleDateString()}</p>
            </button>
            <div className="mt-2 flex items-center gap-1 opacity-70 transition group-hover:opacity-100">
              <button onClick={() => onTogglePin(conversation.id)} title={pinnedIds.has(conversation.id) ? "Unpin" : "Pin"} className="flex h-8 w-8 items-center justify-center rounded-md text-fg-tertiary hover:bg-elevated hover:text-gold"><Pin size={12} fill={pinnedIds.has(conversation.id) ? "currentColor" : "none"} /></button>
              <button onClick={() => { const next = window.prompt("Rename conversation", conversation.title || ""); if (next?.trim()) onRename(conversation.id, next.trim()); }} title="Rename" className="min-h-8 rounded-md px-2 text-[10px] text-fg-tertiary hover:bg-elevated hover:text-fg">Rename</button>
              <button onClick={() => onArchive(conversation.id)} title="Archive" className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-fg-tertiary hover:bg-elevated hover:text-fg"><Archive size={12} /></button>
              <button onClick={(event) => onDelete(conversation.id, event)} title="Delete" className="flex h-8 w-8 items-center justify-center rounded-md text-fg-tertiary hover:bg-red-500/10 hover:text-red-400"><Trash2 size={12} /></button>
            </div>
          </div>
        ))}
        {hasMore && <button disabled={loadingMore} onClick={onLoadMore} className="mt-2 min-h-10 w-full rounded-lg border border-edge text-xs text-fg-secondary disabled:opacity-50">{loadingMore ? "Loading…" : "Load older"}</button>}
      </div>
    </aside>
  );
}
