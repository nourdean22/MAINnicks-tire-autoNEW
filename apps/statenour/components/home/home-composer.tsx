"use client";

/**
 * HomeComposer · Wave AC.c · 2026-05-28.
 *
 * Replaces the full <ChatPage /> embed on the home route. Pre-this-fix
 * the home page tried to render the home content ABOVE a full ChatPage
 * mount, but ChatPage's outer wrapper is `fixed inset-x-0 z-10` (it's
 * a viewport overlay) which silently covered everything above it. The
 * operator saw only the chat surface · the HomeIdentityHeader +
 * brief + moves + pulse were invisible behind the overlay.
 *
 * This component is a simple textarea + send button. On send · the
 * draft is stashed in sessionStorage under `chat:seed` and the user
 * is navigated to /chat which seeds the composer with the draft on
 * mount. Operator gets the muscle memory of starting a chat from
 * home without the full chat surface blowing up the home layout.
 *
 * Mobile-first · 16px font (no iOS zoom) · 44pt send-button tap
 * target · auto-grows the textarea up to 4 lines · Cmd/Ctrl+Enter
 * to send (matches /chat).
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";

const SEED_KEY = "chat:seed";

export function HomeComposer() {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow up to ~4 lines · matches /chat composer behavior.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const max = 4 * 24; // ~24px per line @ 16px font
    ta.style.height = `${Math.min(ta.scrollHeight, max)}px`;
  }, [draft]);

  const handleSend = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    try {
      sessionStorage.setItem(SEED_KEY, trimmed);
    } catch {
      // Best-effort · if sessionStorage is blocked we still navigate
      // and the operator just retypes (graceful degradation).
    }
    router.push("/chat");
  }, [draft, router]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const canSend = draft.trim().length > 0;

  return (
    <section
      aria-label="message nick"
      className="rounded-lg border border-[var(--gold)]/25 bg-[var(--bg-base)] focus-within:border-[var(--gold)]/45 transition-colors"
    >
      <div className="flex items-end gap-1 p-2">
        {/* 2026-06-03 · Wave 2 cleanup · removed the mic + paperclip buttons:
            both just router.push("/chat") — a misleading affordance (the mic
            implied inline voice it never did). The textarea + send is the real
            quick action; voice/attach live on /chat, reachable via nav. */}
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message Nick…"
          rows={1}
          className={cn(
            "flex-1 min-h-[44px] resize-none bg-transparent px-2 py-3 text-[16px] leading-snug",
            "text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]/70",
            "focus:outline-none",
          )}
          // 2026-05-28 · iOS no-zoom · 16px font here matches the
          // global Wave AH.b rule at app/globals.css.
        />

        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          aria-label="send message"
          className={cn(
            "shrink-0 inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-md transition-all active:scale-95",
            canSend
              ? "text-[var(--gold)] hover:bg-[var(--gold)]/10"
              : "text-[var(--text-tertiary)]/40",
          )}
        >
          <Send size={16} strokeWidth={1.75} />
        </button>
      </div>
    </section>
  );
}
