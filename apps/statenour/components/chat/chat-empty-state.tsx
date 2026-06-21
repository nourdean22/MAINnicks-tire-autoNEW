"use client";

/**
 * ChatEmptyState v4 — Apr 29 minimal.
 *
 * Per Nour: "the openers are annoying — kill the cards."
 *
 * What's left: a quiet orb + time-aware greeting. Anything Nick wants
 * to surface flows through the global tickers (top + bottom) so the
 * empty state doesn't compete for attention. Just a clean canvas for
 * the user to start typing into.
 *
 * What got removed in v4:
 *   - 3-card opener list (risk appetite / skill candidates / inbox)
 *   - "Here's what I'm seeing" sub-line
 *   - "tap an opener · or just type" prompt
 *   - Severity-tinted orb glow (always gold now)
 */

import { useEffect, useState } from "react";
import { hourET } from "@/lib/utils/datetime";

export function ChatEmptyState() {
  // `greeting` stays null until client mount (avoids hydration mismatch
  // when server-rendered hour differs from local time).
  const [greeting, setGreeting] = useState<string | null>(null);

  useEffect(() => {
    const h = hourET();
    setGreeting(h < 12 ? "morning" : h < 17 ? "afternoon" : h < 22 ? "evening" : "late");
  }, []);

  return (
    // v10.0.529.96 · Wave 40 · sized-to-content empty state. Pre-Wave-40
    // had `min-h-full` which stretched the empty state to consume the
    // entire flex-1 scroll area, parking the composer pinned at the
    // bottom of the viewport. Operator feedback: "let's not have the
    // chat take up the whole page · put the composer in the middle."
    // Dropping min-h-full + tightening top padding lets the empty state
    // size to its greeting · the scroll container's flex-1 is also
    // conditionally removed in chat/page.tsx · composer rises naturally
    // into the upper-middle band right below the greeting.
    <div className="flex flex-col items-center justify-start px-4 sm:px-6 pt-4 sm:pt-6 pb-2 space-y-3 text-center">
      {/* Quiet orb — concentric rings, no severity tinting */}
      <div className="relative w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center">
        <div className="absolute inset-0 rounded-full border border-[var(--gold)]/30 nick-ring-slow" />
        <div className="absolute w-9 h-9 rounded-full border border-[var(--gold)]/30 nick-ring-fast" />
        <div
          className="relative w-2.5 h-2.5 rounded-full bg-[var(--gold)] nick-orb-streaming"
          style={{ boxShadow: "0 0 24px rgba(212,175,55,0.30)" }}
        />
      </div>

      {/* Greeting only — sub-line + cards retired */}
      <p
        className="text-[16px] sm:text-[15px] text-[var(--text-primary)] font-[var(--font-display)]"
        suppressHydrationWarning
      >
        {greeting ? `${greeting}, Nour.` : <span className="opacity-0">hello, Nour.</span>}
      </p>
    </div>
  );
}
