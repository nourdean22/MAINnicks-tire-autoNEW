"use client";

/**
 * AmbientAura — wraps the mastery layout with a live state-driven
 * background glow.
 *
 * Item #17 from the excellence marathon (sweep). Previously, the
 * `state-aura` + `state-aura-<state>` classes were only applied on
 * the chat page and the /command root. That meant /settings, /tasks,
 * /journal, /system/*, /brain, and every other mastery route had
 * zero ambient feedback — visually identical whether Nour was in
 * normal mode or on_fire.
 *
 * This client component lives inside NourStateProvider and reads the
 * current state to emit the right class pair on a wrapper div around
 * every mastery page. One place, every page benefits.
 *
 * The CSS variants (state-aura-normal / on_fire / drift / scattered
 * / low_energy) are already defined in app/globals.css — this just
 * makes sure the classes get on the DOM.
 */

import { useNourState } from "@/lib/state/nour-state";
import { cn } from "@/lib/utils";

export function AmbientAura({ children }: { children: React.ReactNode }) {
  const s = useNourState();
  return (
    <div className={cn("state-aura", `state-aura-${s.currentState}`, "min-h-screen")}>
      {children}
    </div>
  );
}
