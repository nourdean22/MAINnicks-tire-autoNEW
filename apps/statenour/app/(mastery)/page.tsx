import { Suspense } from "react";
import ChatPage from "./chat/page";
import { HomeStrip } from "@/components/home/home-strip";

/**
 * The home route · v10.0.529.83 · Wave 27 · Ultron→chat dissolution.
 *
 * Operator IA call: dissolve the Ultron apex surface, make /chat the
 * home, distill Ultron's most valuable signals into a tight HomeStrip
 * above the conversation. The rest of Ultron's body distributes
 * across the OS:
 *   · SignalZone components → /brain (where reflection-tier stuff lives)
 *   · TodayZone / MITSlot → /tasks NOW (already absorbed by NextMoveCard)
 *   · AnticipatedQuestions → chat-side suggestions
 *
 * /ultron remains accessible as a route at /cockpit (alias) for any
 * deep-link or bookmark · the full apex surface is preserved there
 * for operators who want the dashboard view. Default landing is now
 * the conversational interface · matches "the OS is a conversation".
 *
 * Wrapped automatically by `app/(mastery)/layout.tsx` which provides
 * NourStateProvider + AmbientAura + PageTracker + KeyboardShortcuts.
 *
 * Suspense boundary required because the chat experience reads
 * useSearchParams() for ?conversation= deep-links. Without the
 * Suspense wrap, Next.js 16 fails prerender at the page level.
 */
export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomeStrip />
      <ChatPage />
    </Suspense>
  );
}
