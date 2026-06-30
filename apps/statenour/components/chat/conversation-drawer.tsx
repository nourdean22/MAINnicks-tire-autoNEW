"use client";

/**
 * ConversationDrawer · the conversation-history sidebar of /chat.
 *
 * Extracted from app/(mastery)/chat/page.tsx (v10.0.529.19) following
 * the established /tasks panel-extraction shape · v529.14 (LoopRowItem),
 * v529.15 (ProjectsPanel), v529.16 (NowPanel).
 *
 * Pre-extraction the entire `showHistory` JSX block (~170 LOC including
 * the renderConvo helper + date-group walk) lived inline inside ChatPage.
 * The page also called useChatRename at its top level, even though the
 * `renamingConvoId` + `renameValue` state was used nowhere else. Owner
 * identity now matches consumer location.
 *
 * Design notes ·
 *   · Drawer owns: the inline-rename UI state via useChatRename
 *     (renamingConvoId · renameValue · start/commit/cancel). Server-
 *     side rename + the convo list itself stay in the parent — the
 *     drawer fires `onRename(id, name)` and trusts the parent to
 *     thread it through useConversations.renameConvo.
 *   · Parent still owns: convos list (useConversations) · activeId
 *     (deep-linkable · shared with chat surface) · pinnedConvoIds
 *     (localStorage-backed Set, owned by useConversations) · the four
 *     CRUD callbacks · the pagination flags + loadMoreConvos.
 *   · No React.memo · the drawer re-renders when convos / activeId /
 *     pinnedConvoIds change, which IS the right time. Memoizing would
 *     force shallow-equality work that always fails (Set props swap
 *     on every parent reload).
 *   · Visual + behavior contract: 100% IDENTICAL to the pre-
 *     extraction inline JSX. No className shifts. No icon swaps.
 *     Mobile backdrop + slideUpHistory animation + sm: breakpoints
 *     preserved byte-for-byte.
 */

import { Plus, Pin, Trash2, Star, Archive, BellOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useChatRename } from "@/hooks/chat/use-chat-rename";
import type { Convo } from "@/hooks/use-conversations";

export interface ConversationDrawerProps {
  // ── Data feed (parent owns · cross-surface) ──
  convos: Convo[];
  activeId: string | null;
  pinnedConvoIds: Set<string>;

  // ── Pagination (parent owns · useConversations) ──
  hasMoreConvos: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;

  // ── CRUD callbacks (parent owns the server round-trip + local cache) ──
  onSelectConvo: (id: string) => void;
  onDeleteConvo: (id: string, e: React.MouseEvent) => void;
  onRename: (id: string, name: string) => void | Promise<void>;
  onTogglePin: (id: string) => void;
  onNewChat: () => void;

  // v10.0.529.59 · audit Wave 8 follow-up · per-row flag toggles
  // relocated from the chat header overflow menu. These actions
  // belong next to the conversation row they target — operator
  // identifies a conversation by its row, not by switching to it
  // and opening the header menu.
  onToggleStar: (id: string) => void;
  onToggleArchive: (id: string) => void;
  onToggleMute: (id: string) => void;

  // ── Visibility + dismiss ──
  /** Parent's setShowHistory(false) — fired by the mobile backdrop. */
  onClose: () => void;
}

export function ConversationDrawer({
  convos,
  activeId,
  pinnedConvoIds,
  hasMoreConvos,
  loadingMore,
  onLoadMore,
  onSelectConvo,
  onDeleteConvo,
  onRename,
  onTogglePin,
  onNewChat,
  onToggleStar,
  onToggleArchive,
  onToggleMute,
  onClose,
}: ConversationDrawerProps) {
  // v8.15 BATCH A · Inline conversation rename extracted to useChatRename.
  // Lifted from ChatPage as part of v10.0.529.19 — the state was used
  // exclusively inside this drawer, so it lives here now.
  const {
    renamingConvoId,
    renameValue,
    startRename,
    setRenameValue,
    commitRename,
    cancelRename,
  } = useChatRename();

  const renderConvo = (c: Convo, isPinned: boolean) => {
    const date = new Date(c.createdAt);
    const timeLabel = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const isRenaming = renamingConvoId === c.id;
    const isStarred = !!c.starredAt;
    const isMuted = !!c.mutedAt;
    const isActive = activeId === c.id;

    return (
      <div
        key={c.id}
        onClick={() => !isRenaming && onSelectConvo(c.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (!isRenaming && (e.key === "Enter" || e.key === " ")) onSelectConvo(c.id); }}
        className={cn(
          "w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-left group transition-colors cursor-pointer",
          activeId === c.id ? "bg-[var(--gold-ghost)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
        )}
      >
        <div className="min-w-0 flex-1">
          {isRenaming ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => commitRename(onRename)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename(onRename);
                if (e.key === "Escape") cancelRename();
                e.stopPropagation();
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-full text-[12px] font-medium bg-transparent border-b border-[var(--gold)]/40 outline-none text-[var(--text-primary)]"
            />
          ) : (
            <p
              className="truncate text-[13px] font-medium"
              onDoubleClick={(e) => {
                e.stopPropagation();
                startRename(c.id, c.title || "");
              }}
              title="Double-click to rename"
            >
              {isPinned && <span className="text-[var(--gold)] mr-1">📌</span>}
              {c.title || "Untitled"}
            </p>
          )}
          <p className="text-[11px] text-[var(--text-tertiary)] font-mono">
            {timeLabel} · {c._count.messages} msgs
          </p>
        </div>
        {/* Action group — on mobile only Pin + Delete show to keep titles readable.
            Star/BellOff/Archive are desktop-only (`hidden sm:flex`).
            Active/pinned/starred/muted rows always show actions as a state cue. */}
        <div
          className={cn(
            "flex items-center gap-0.5 shrink-0 transition-opacity",
            isPinned || isStarred || isMuted || isActive
              ? "opacity-100"
              : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100",
          )}
        >
          <button
            onClick={(e) => { e.stopPropagation(); onTogglePin(c.id); }}
            className={cn(
              "h-8 w-8 flex items-center justify-center rounded hover:bg-[var(--bg-raised)]",
              isPinned
                ? "text-[var(--gold)]"
                : "text-[var(--text-tertiary)] hover:text-[var(--gold)]",
            )}
            title={isPinned ? "Unpin" : "Pin"}
            aria-label={isPinned ? "Unpin conversation" : "Pin conversation"}
          >
            <Pin size={13} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleStar(c.id); }}
            className={cn(
              "hidden sm:flex h-8 w-8 items-center justify-center rounded hover:bg-[var(--bg-raised)]",
              isStarred
                ? "text-amber-300"
                : "text-[var(--text-tertiary)] hover:text-amber-300",
            )}
            title={isStarred ? "Unstar" : "Star"}
            aria-label={isStarred ? "Unstar conversation" : "Star conversation"}
          >
            <Star size={13} className={isStarred ? "fill-amber-300" : ""} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleMute(c.id); }}
            className={cn(
              "hidden sm:flex h-8 w-8 items-center justify-center rounded hover:bg-[var(--bg-raised)]",
              isMuted
                ? "text-zinc-400"
                : "text-[var(--text-tertiary)] hover:text-zinc-300",
            )}
            title={isMuted ? "Unmute" : "Mute"}
            aria-label={isMuted ? "Unmute conversation" : "Mute conversation"}
          >
            <BellOff size={13} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleArchive(c.id); }}
            className="hidden sm:flex h-8 w-8 items-center justify-center rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
            title="Archive"
            aria-label="Archive conversation"
          >
            <Archive size={13} />
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-[var(--text-tertiary)] hover:text-rose-400 hover:bg-rose-500/10"
            onClick={(e) => onDeleteConvo(c.id, e)}
            title="Delete"
            aria-label="Delete conversation"
          >
            <Trash2 size={13} />
          </Button>
        </div>
      </div>
    );
  };

  const pinned = convos.filter((c) => pinnedConvoIds.has(c.id));
  const unpinned = convos.filter((c) => !pinnedConvoIds.has(c.id));

  return (
    <>
      {/* Backdrop — only visible on mobile (desktop keeps inline) */}
      <div
        onClick={onClose}
        className="sm:hidden fixed inset-0 z-[55] bg-black/55 backdrop-blur-[2px] animate-fade-in"
      />
      <div
        className={cn(
          // Mobile: floating sheet pinned under header with shadow
          "sm:max-h-72 overflow-y-auto bg-[var(--bg-void)]",
          "fixed sm:relative left-0 right-0 z-[60] sm:z-auto",
          "border-b border-[var(--border-default)]",
          // Mobile-only animation
          "sm:shadow-none shadow-[0_20px_60px_rgba(0,0,0,0.6)]",
        )}
        style={{
          // Mobile-only — let it fill the visual viewport minus header.
          // 2026-05-23 · Wave A · was 100vh · on iOS Safari that includes
          // the collapsed URL bar in the height calc, so the drawer
          // extended UNDER it · last history row was unreachable. 100dvh
          // tracks the dynamic visual viewport · iOS-correct.
          maxHeight: "calc(100dvh - 80px - env(safe-area-inset-bottom, 0px))",
          animation: "slideUpHistory 0.28s ease-out",
        }}
      >
        {/* Mobile header — swipe-up sheet needs a handle + title + dismiss */}
        <div className="sm:hidden flex items-center justify-between px-4 py-3 border-b border-[var(--border-default)] shrink-0">
          <span className="text-[14px] font-semibold text-[var(--text-primary)] tracking-tight">Conversations</span>
          <button
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-[var(--bg-elevated)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
            aria-label="Close conversations"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-2">
          <button
            onClick={onNewChat}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-[var(--gold)] hover:bg-[var(--gold-ghost)] transition-colors mb-1"
          >
            <Plus size={12} />
            <span className="text-[12px] font-medium">New conversation</span>
          </button>

          {convos.length === 0 ? (
            <p className="text-xs text-[var(--text-tertiary)] px-3 py-4 text-center">No conversations yet</p>
          ) : (
            <div className="space-y-0.5">
              {pinned.length > 0 && (
                <>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--gold)]/40 px-3 pt-1 pb-0.5">
                    Pinned
                  </p>
                  {pinned.map((c) => renderConvo(c, true))}
                </>
              )}
              {(() => {
                // v10.0.116 audit fix · snapshot "now" once outside the .map
                // so all rows agree on the same Today/Yesterday boundary even
                // if the render straddles midnight.
                const nowSnapshot = new Date();
                const todayStr = nowSnapshot.toDateString();
                const yesterdayStr = new Date(nowSnapshot.getTime() - 86400000).toDateString();
                let lastDateGroup = "";
                return unpinned.map((c) => {
                  const date = new Date(c.createdAt);
                  const isToday = date.toDateString() === todayStr;
                  const isYesterday = date.toDateString() === yesterdayStr;
                  const dateLabel = isToday ? "Today" : isYesterday ? "Yesterday" : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  const showDateHeader = dateLabel !== lastDateGroup;
                  lastDateGroup = dateLabel;
                  return (
                    <div key={c.id}>
                      {showDateHeader && (
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]/50 px-3 pt-2 pb-0.5">
                          {dateLabel}
                        </p>
                      )}
                      {renderConvo(c, false)}
                    </div>
                  );
                });
              })()}
            </div>
          )}
          {/* v10.0.187 · "Load older" footer · pre-fix the drawer
              silently dropped any conversation past the first page.
              The API now returns hasMore + nextCursor; the hook
              exposes loadMoreConvos. This is the consumer. */}
          {hasMoreConvos && (
            <button
              onClick={() => onLoadMore()}
              disabled={loadingMore}
              className="w-full mt-2 px-3 py-2 rounded-lg text-[12px] text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:bg-[var(--gold-ghost)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loadingMore ? "Loading…" : "Load older conversations"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
