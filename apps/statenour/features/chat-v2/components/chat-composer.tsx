"use client";

import { FormEvent, useRef, useEffect } from "react";
import { useChatUiStore } from "../stores/chat-ui-store";

export function ChatComposer({ chat }: { chat: any }) {
  const draft = useChatUiStore((s) => s.draft);
  const setDraft = useChatUiStore((s) => s.setDraft);
  const clearConversationDraft = useChatUiStore((s) => s.clearConversationDraft);
  const enqueuePending = useChatUiStore((s) => s.enqueuePending);
  const resolvePending = useChatUiStore((s) => s.resolvePending);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [draft]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;

    const text = draft.trim();
    const tempId = crypto.randomUUID();

    // Optimistic Enqueue
    enqueuePending({
      tempId,
      conversationId: null,
      text,
      createdAt: Date.now(),
    });

    clearConversationDraft();

    try {
      await chat.append({ role: "user", content: text });
      resolvePending(tempId);
    } catch (err) {
      console.error(err);
      // Restore on failure
      setDraft(text);
      resolvePending(tempId);
    }
  };

  return (
    <form onSubmit={onSubmit} className="relative mx-auto flex w-full max-w-4xl flex-col gap-2">
      <div className="relative flex items-end gap-2 rounded-2xl border border-zinc-800 bg-zinc-900 p-2 shadow-sm focus-within:border-zinc-700 focus-within:ring-1 focus-within:ring-zinc-700">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit(e as any);
            }
          }}
          placeholder="Send a message to Statenour OS..."
          className="max-h-[200px] min-h-[44px] w-full resize-none bg-transparent px-3 py-2.5 text-sm text-zinc-200 outline-none placeholder:text-zinc-500"
          rows={1}
        />
        <button
          type="submit"
          disabled={!draft.trim() || chat.status === "streaming"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-950 transition-transform disabled:opacity-50 active:scale-95 hover:bg-white"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
             <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
          </svg>
        </button>
      </div>
    </form>
  );
}
