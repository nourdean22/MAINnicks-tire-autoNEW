"use client";

/**
 * StateWord: where the state-colored aura used to be. One quiet line at the top of every mastery page
 * (mounted once, in app/(mastery)/layout.tsx) that names the current Nour state in a word.
 *
 * - A status line, not a control: role="status", no button, no tab stop. The text node only changes when
 *   the state does, so a screen reader hears a change, not every 60 s refresh.
 * - Hydration: NourStateProvider starts every render, server and client, at the same default (isLoading),
 *   so this prints nothing until the first load lands in an effect. The row's height is reserved so the
 *   page does not jump when the word arrives.
 * - Gold is a signal (docs/design/ui-v2/SYSTEM.md section 12): the notch shows only for a state worth
 *   flagging. "Steady" and "State unknown" carry none, so Home keeps its single at-rest notch.
 * - Quiet: 12px, the tertiary text token (5.5:1 on the canvas), no glow, no pulse, no gradient.
 */
import { useNourState } from "@/lib/state/nour-state";
import { stateWord } from "@/lib/state/state-word";

export function StateWord() {
  const word = stateWord(useNourState());
  return (
    <div className="feed">
      <p role="status" className="flex h-5 items-center gap-2 pt-1 text-[12px] font-medium leading-none text-fg-tertiary">
        {word?.tone === "signal" ? <span className="notch" aria-hidden /> : null}
        {word?.text}
      </p>
    </div>
  );
}
