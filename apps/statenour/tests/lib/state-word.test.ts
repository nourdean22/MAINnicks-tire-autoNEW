/**
 * UI v3 W1a: the state word that replaces the aura. stateWord turns what NourStateProvider knows into
 * one sentence-case word, and refuses to say "Steady" about a state it never read.
 *
 * NourStateProvider starts at currentState "normal" with isLoading true, and detectState returns "normal"
 * when every feed failed (alerts 0, commitments 0, habit rate 0.5). Rendering that as a calm word would be
 * a failed read shown as good news (empty-vs-error), so loading is blank and an unread health feed is unknown.
 */
import { describe, expect, it } from "vitest";
import { stateWord, STATE_WORD } from "@/lib/state/state-word";
import type { NourState } from "@/lib/state/nour-state";

type Input = Pick<NourState, "currentState" | "isLoading" | "error" | "systemStatus">;
const loaded = (over: Partial<Input> = {}): Input => ({ currentState: "normal", isLoading: false, error: null, systemStatus: "ok", ...over });
const STATES = ["normal", "on_fire", "drift", "scattered", "low_energy"] as const;

describe("stateWord", () => {
  it("gives every state one human label, sentence case, at most two words, no underscore", () => {
    for (const st of STATES) {
      const text = STATE_WORD[st];
      expect(text, st).toMatch(/^[A-Z][a-z]+( [a-z]+)?$/);
      expect(text, st).not.toContain("_");
    }
    expect(Object.keys(STATE_WORD).sort()).toEqual([...STATES].sort());
  });

  it("labels are distinct", () => {
    expect(new Set(Object.values(STATE_WORD)).size).toBe(STATES.length);
  });

  it("reads the label for a loaded state, and marks only the non-normal ones as a signal", () => {
    expect(stateWord(loaded({ currentState: "normal" }))).toEqual({ text: STATE_WORD.normal, tone: "calm" });
    for (const st of STATES.filter((s) => s !== "normal")) {
      expect(stateWord(loaded({ currentState: st })), st).toEqual({ text: STATE_WORD[st], tone: "signal" });
    }
  });

  it("says nothing while loading, even though the default state is normal", () => {
    expect(stateWord(loaded({ isLoading: true, systemStatus: "loading" }))).toBeNull();
  });

  it("says unknown, not Steady, when the health feed was not read", () => {
    expect(stateWord(loaded({ systemStatus: "unknown" }))).toEqual({ text: "State unknown", tone: "unknown" });
  });

  it("says unknown when the load failed, even with a last good state in hand", () => {
    expect(stateWord(loaded({ currentState: "on_fire", error: "Failed to load" }))).toEqual({ text: "State unknown", tone: "unknown" });
  });

  it("an unknown state never carries a state label", () => {
    const w = stateWord(loaded({ systemStatus: "unknown", currentState: "drift" }));
    expect(Object.values(STATE_WORD)).not.toContain(w?.text);
  });
});
