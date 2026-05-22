import { Suspense } from "react";
import ChatPage from "./chat/page";
import { HomeNarrator } from "@/components/home/home-narrator";
// Phase E (2026-05-18 PM) · OperatorPulse · home variant composes the
// loudest cross-surface signal (top anomaly > top open task) + week
// shape + drift. Sits BELOW HomeNarrator (greeting + nav) so the
// editorial sentence stays the entry point · pulse adds the
// "right now" intelligence layer just above the chat composer.
import { OperatorPulse } from "@/components/operator/operator-pulse";

/**
 * The home route · 2026-05-18 PM · HomeStrip → HomeNarrator
 *
 * Original Wave 27 (v10.0.529.83) made /chat the home + put a 5-chip
 * HomeStrip above it (Ultron dissolution). 2026-05-18 PM brainstorm
 * found the chip-strip felt cluttered and reactive · operator asked
 * for 'more minimalist + cleaner + better-looking + more useful' ·
 * the answer is HomeNarrator: a single editorial sentence the OS
 * speaks to the operator, with named phrases that link to their
 * destination. The sentence IS the navigation.
 *
 * Time-aware composition:
 *   · morning  · brief + coalescing themes + tasks in motion
 *   · afternoon · throughput + remaining work + radar fires
 *   · evening   · done count + active threads + reflection cue
 *
 * Self-hides on zero signal · clean morning is silent.
 *
 * /ultron + the legacy chip strip still exist · HomeStrip — the
 * pre-narrator home widget — was deleted in the 2026-05-21 dead-code
 * sweep once HomeNarrator proved out.
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
      <HomeNarrator />
      <OperatorPulse surface="home" />
      <ChatPage />
    </Suspense>
  );
}
