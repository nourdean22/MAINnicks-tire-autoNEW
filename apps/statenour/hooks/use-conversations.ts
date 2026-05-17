/**
 * Conversation list + CRUD for the chat page.
 *
 * Owns: the list of recent conversations, the active conversation id,
 * and load/create/delete operations. Kept intentionally thin — the
 * actual message stream is still owned by @ai-sdk/react's useChat.
 */

"use client";

import { useEffect, useState, useCallback } from "react";
import type { UIMessage } from "ai";

import { authedFetch } from "@/hooks/use-authed-fetch";
export interface Convo {
  id: string;
  title: string | null;
  createdAt: string;
  // v10.0.529.59 · audit Wave 8 follow-up · flag timestamps surface
  // per-row in ConversationDrawer (star · mute toggles relocated
  // here from the chat header overflow menu). Null = not flagged.
  // archivedAt isn't included because the list endpoint filters
  // archived convs out by default — the drawer never sees them.
  starredAt?: string | null;
  mutedAt?: string | null;
  _count: { messages: number };
}

interface LoadedConvoMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
}

/** Matches the signature of setMessages from @ai-sdk/react's useChat */
type SetMessagesFn = (
  messages: UIMessage[] | ((messages: UIMessage[]) => UIMessage[])
) => void;

interface UseConversationsOptions {
  /** Chat's setMessages from useChat — used when loading a stored convo */
  setMessages: SetMessagesFn;
  /** Called when an error should be surfaced */
  onError?: (msg: string) => void;
}

export function useConversations({ setMessages, onError }: UseConversationsOptions) {
  const [convos, setConvos] = useState<Convo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  // v10.0.187 · pagination state. The API ships hasMore + nextCursor
  // (added in v10.0.186). Pre-fix the hook only consumed the first
  // 50/75 conversations and silently dropped older ones — heavy
  // operators couldn't reach history past page 1 from the drawer.
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  /**
   * Re-fetch the conversation list from the server. Called on mount,
   * and on-demand after a new conversation is created (so the sidebar
   * reflects the new row without needing a full page reload).
   */
  const reloadConvos = useCallback(() => {
    authedFetch("/api/ai/chat")
      .then((r) => r.json())
      .then((raw) => {
        const d = raw?.data ?? raw;
        setConvos(d.conversations ?? []);
        // v10.0.187 · capture pagination flags. Defaults preserve the
        // pre-pagination behavior for older API responses that don't
        // include these fields (no UI regression on backward-compat).
        setHasMore(Boolean(d.hasMore));
        setNextCursor(typeof d.nextCursor === "string" ? d.nextCursor : null);
      })
      .catch(() => {});
  }, []);

  /**
   * Load the next page of older conversations using the cursor from
   * the previous response. Append-only — never overwrites the current
   * list, so the UI scroll position stays put.
   */
  const loadMoreConvos = useCallback(async () => {
    if (loadingMore || !hasMore || !nextCursor) return;
    setLoadingMore(true);
    try {
      const raw = await authedFetch(
        `/api/ai/chat?cursor=${encodeURIComponent(nextCursor)}`,
      ).then((r) => r.json());
      const d = raw?.data ?? raw;
      const more: Convo[] = Array.isArray(d.conversations) ? d.conversations : [];
      if (more.length > 0) {
        setConvos((prev) => {
          // De-dup by id in case server overlap or rapid double-tap.
          const seen = new Set(prev.map((c) => c.id));
          return [...prev, ...more.filter((c) => !seen.has(c.id))];
        });
      }
      setHasMore(Boolean(d.hasMore));
      setNextCursor(typeof d.nextCursor === "string" ? d.nextCursor : null);
    } catch {
      // silent — drawer keeps current page, no toast spam on a
      // background pagination call
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, nextCursor, loadingMore]);

  // Initial load — no auto-resume, user picks from history dropdown
  useEffect(() => {
    reloadConvos();
  }, [reloadConvos]);

  const loadConvo = useCallback(
    async (id: string) => {
      try {
        // Clear the in-memory messages FIRST so any lingering SDK-
        // generated ids from a concurrent stream can't collide with
        // the DB cuid ids we're about to load. Without this reset,
        // React sees duplicate keys when a convo is loaded while the
        // previous one is still streaming.
        setMessages([]);
        const raw = await authedFetch(`/api/ai/chat/${id}`).then((r) => r.json());
        const data = raw?.data ?? raw;
        if (data.conversation) {
          setActiveId(id);
          // Dedupe DB rows by id as a belt-and-suspenders safety net.
          // Shouldn't be needed but a duplicate chat_message row would
          // otherwise blow up the render. O(n) dedupe keeps freshest.
          const seen = new Map<string, LoadedConvoMessage>();
          for (const m of data.conversation.messages) seen.set(m.id, m);
          setMessages(
            Array.from(seen.values()).map((m) => {
              // v7.6 · Apr 29 · ChatMessage Batch A · C3 — read path.
              // Three-tier hydration:
              //   1. Prefer the persisted `parts` JSON tree (text +
              //      file + reasoning + tool-call + tool-result + source).
              //   2. Fall back to `content` + `attachments` for legacy
              //      rows from before Batch A landed.
              //   3. Empty string text part as a last resort so the
              //      UIMessage shape stays valid.
              const persistedParts = (m as { parts?: unknown }).parts;
              const parts: Array<Record<string, unknown>> = [];
              if (Array.isArray(persistedParts) && persistedParts.length > 0) {
                // Trust the DB tree — written by the v7.6 helpers.
                for (const p of persistedParts) {
                  if (p && typeof p === "object") {
                    parts.push(p as Record<string, unknown>);
                  }
                }
              }
              if (parts.length === 0) {
                if (m.content && m.content.trim()) {
                  parts.push({ type: "text", text: m.content });
                }
                const atts = (m as { attachments?: unknown }).attachments;
                if (Array.isArray(atts)) {
                  for (const a of atts) {
                    if (!a || typeof a !== "object") continue;
                    const ao = a as Record<string, unknown>;
                    if (ao.type === "file" && typeof ao.url === "string") {
                      parts.push({
                        type: "file",
                        url: ao.url,
                        mediaType: typeof ao.mediaType === "string" ? ao.mediaType : undefined,
                        filename: typeof ao.filename === "string" ? ao.filename : undefined,
                      });
                    }
                  }
                }
              }
              if (parts.length === 0) {
                parts.push({ type: "text", text: "" });
              }

              // v7.6 · Surface Batch A metadata so the chat UI can
              // render the per-message info dropdown (C7), streaming-
              // state badge (C6), branch sibling toggle (C8), and
              // edited indicator (C9). Spread all native fields onto
              // the UIMessage so existing code that reads (m as any)
              // .latencyMs etc still works.
              const meta = m as unknown as Record<string, unknown>;
              return {
                id: m.id,
                role: m.role,
                parts,
                streamingState: meta.streamingState ?? "complete",
                provider: meta.provider ?? null,
                routerReason: meta.routerReason ?? null,
                latencyMs: meta.latencyMs ?? null,
                firstTokenLatencyMs: meta.firstTokenLatencyMs ?? null,
                costCents: meta.costCents ?? null,
                promptTokens: meta.promptTokens ?? null,
                completionTokens: meta.completionTokens ?? null,
                feedbackScore: meta.feedbackScore ?? null,
                parentMessageId: meta.parentMessageId ?? null,
                branchId: meta.branchId ?? null,
                editedAt: meta.editedAt ?? null,
                editHistory: meta.editHistory ?? null,
                errorDetails: meta.errorDetails ?? null,
                clientMessageId: meta.clientMessageId ?? null,
                model: meta.model ?? null,
                tokenUsage: meta.tokenUsage ?? null,
              };
            }) as unknown as UIMessage[]
          );
          setShowHistory(false);
        }
      } catch {
        onError?.("Couldn't load conversation.");
      }
    },
    [setMessages, onError]
  );

  const deleteConvo = useCallback(
    async (id: string, e?: React.MouseEvent) => {
      e?.stopPropagation();
      // v9.1.24 · check res.ok before optimistic removal. Previously
      // the UI removed the conversation immediately even on a 500 or
      // 404, leaving the server row intact. On next reload the conv
      // would reappear — jarring UX, no error surfaced. Now we only
      // mutate state if the server confirmed the delete.
      try {
        const res = await authedFetch(`/api/ai/chat/${id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          onError?.("Couldn't delete conversation.");
          return;
        }
      } catch {
        onError?.("Couldn't delete conversation.");
        return;
      }
      setConvos((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
      }
    },
    [activeId, setMessages, onError]
  );

  const newChat = useCallback(() => {
    setActiveId(null);
    setMessages([]);
    setShowHistory(false);
  }, [setMessages]);

  // ── Rename a conversation title ──
  const renameConvo = useCallback(
    async (id: string, title: string) => {
      try {
        await authedFetch(`/api/ai/chat/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        });
        setConvos((prev) =>
          prev.map((c) => (c.id === id ? { ...c, title } : c))
        );
      } catch {
        onError?.("Rename failed");
      }
    },
    [onError]
  );

  // ── Pin/unpin via localStorage (no schema change needed) ──
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      return new Set(JSON.parse(localStorage.getItem("nour:pinned-convos") || "[]"));
    } catch {
      return new Set();
    }
  });

  const togglePin = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem("nour:pinned-convos", JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }, []);

  // v10.0.529.59 · audit Wave 8 follow-up · star/archive/mute per-row
  // toggles relocated from the chat header overflow menu into the
  // drawer. PATCH /api/ai/chat/conversation/[id] flips the named
  // flag; UI updates optimistically and reverts on error.
  // Archive returns the id so the parent can clear it from the active
  // conversation when the user archives the convo they're currently
  // viewing — keeps the message pane from showing a now-hidden convo.
  const patchConvoFlag = useCallback(
    async (id: string, flag: "starred" | "archived" | "muted", next: boolean) => {
      // Optimistic write — flip the timestamp on the matching row so
      // the drawer's filled-icon state updates without a refetch.
      const ts = next ? new Date().toISOString() : null;
      setConvos((prev) =>
        prev.map((c) =>
          c.id !== id
            ? c
            : flag === "starred"
              ? { ...c, starredAt: ts }
              : flag === "muted"
                ? { ...c, mutedAt: ts }
                : c, // archived rows are filtered out of the list, so
                     // no local-state change needed — reloadConvos
                     // (below) will drop them.
        ),
      );
      try {
        const r = await authedFetch(`/api/ai/chat/conversation/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [flag]: next }),
        });
        if (!r.ok) throw new Error(`${r.status}`);
        if (flag === "archived" && next) {
          // Drop the now-archived convo from the visible list.
          setConvos((prev) => prev.filter((c) => c.id !== id));
        }
      } catch {
        // Revert optimistic flip.
        setConvos((prev) =>
          prev.map((c) =>
            c.id !== id
              ? c
              : flag === "starred"
                ? { ...c, starredAt: next ? null : ts }
                : flag === "muted"
                  ? { ...c, mutedAt: next ? null : ts }
                  : c,
          ),
        );
        onError?.(`Couldn't ${next ? "set" : "clear"} ${flag}`);
      }
    },
    [onError],
  );

  return {
    convos,
    activeId,
    setActiveId,
    showHistory,
    setShowHistory,
    loadConvo,
    deleteConvo,
    newChat,
    renameConvo,
    pinnedIds,
    togglePin,
    /** Exposed so the chat page can refresh the sidebar after a new
     *  conversation is created server-side (when X-Conversation-Id
     *  comes back on the first message). Without this, Nour would
     *  have to reload the page to see his new conversation in the
     *  history list. */
    reloadConvos,
    // v10.0.187 · pagination · drawer reads these to render the
    // "Load older" footer and gate further calls when exhausted.
    hasMoreConvos: hasMore,
    loadMoreConvos,
    loadingMore,
    // v10.0.529.59 · star / archive / mute toggles consumed by
    // ConversationDrawer per-row controls (audit Wave 8 follow-up).
    patchConvoFlag,
  };
}
