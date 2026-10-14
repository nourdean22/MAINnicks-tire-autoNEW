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
  // .state-aura carries padding 4px and margin -4px, so its box is 8px wider
  // than the column and bleeds 4px past each edge. Clip that on the x axis
  // here, on a wrapper, not on .state-aura itself: overflow on an element
  // clips only its children, and the document still scrolls to the box.
  // overflow: clip does not create a containing block, so fixed descendants
  // (/chat's shell, the bottom tab bar) still resolve against the viewport.
  return (
    <div className="overflow-x-clip">
      <div className={cn("state-aura", `state-aura-${s.currentState}`, "min-h-screen")}>
        {children}
      </div>
    </div>
  );
}
