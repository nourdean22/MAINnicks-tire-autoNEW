"use client";

/**
 * /reason · Phase H (2026-05-18 PM)
 *
 * The Charizard surface. Operator drops a hard question, the engine
 * runs a tier-classified multi-step loop (decompose → plan → fanout
 * → multi-agent → critique → refine → deliver), the trace unfolds in
 * the UI, the final answer lands with confidence + cost.
 *
 * Lives under (mastery) layout so it inherits NourStateProvider +
 * AmbientAura + PageTracker + KeyboardShortcuts like the rest of the
 * mastery surfaces.
 *
 * Aesthetic per docs/aesthetic-principles.md · editorial-minimalist ·
 * matches /goals + /scoreboard + /tasks header pattern.
 *
 * See: components/operator/nick-reasoner.tsx · /api/nick/reason ·
 * lib/ai/reasoning/engine.ts
 */

import { NickReasoner } from "@/components/operator/nick-reasoner";

export default function ReasonPage() {
  return (
    <main className="min-h-[100dvh] bg-[#0A0A0A] text-white">
      <NickReasoner />
    </main>
  );
}
