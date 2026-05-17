/**
 * v10.0.413 · mode-persona chip pure logic regression armor.
 *
 * Tests the prefix-application + cycle helpers independent of the
 * React component (which has trivial render). The pipeline is:
 *
 *   composer text → applyMode(text, mode) → sendOrQueue(prefixed)
 *                                            ↓
 *                                  /battle ... | /reflect ... | /execute ...
 *                                            ↓
 *                          system-prompt MODE_PERSONAS rule activates voice
 *
 * The danger zone if applyMode regresses:
 *   · operator hits send · mode is "battle" but prefix doesn't get added
 *     → server-side rule never fires · operator wonders why their voice
 *     didn't change · trust loss
 *   · operator types `/battle hello` manually + chip says "battle"
 *     → applyMode could double-prefix to `/battle /battle hello`
 *     → server-side regex breaks · message routes weirdly
 */

import { describe, expect, it } from "vitest";
import { applyMode, nextMode } from "@/components/chat/mode-persona-chip";

describe("applyMode · prefix application", () => {
  it("returns input unchanged when mode is default", () => {
    expect(applyMode("hello", "default")).toBe("hello");
    expect(applyMode("", "default")).toBe("");
  });

  it("prepends /battle when mode is battle", () => {
    expect(applyMode("ship the demo today", "battle")).toBe("/battle ship the demo today");
  });

  it("prepends /reflect when mode is reflect", () => {
    expect(applyMode("what do I keep avoiding?", "reflect")).toBe("/reflect what do I keep avoiding?");
  });

  it("prepends /execute when mode is execute", () => {
    expect(applyMode("rebuild the lead pipeline", "execute")).toBe("/execute rebuild the lead pipeline");
  });

  it("does NOT double-prefix when text already starts with /battle", () => {
    expect(applyMode("/battle hello", "battle")).toBe("/battle hello");
  });

  it("does NOT double-prefix /reflect on reflect mode", () => {
    expect(applyMode("/reflect think this through", "reflect")).toBe("/reflect think this through");
  });

  it("does NOT prefix when text starts with /execute even if mode is battle", () => {
    // Operator typed an explicit prefix · chip mode shouldn't override.
    expect(applyMode("/execute do the thing", "battle")).toBe("/execute do the thing");
  });

  it("does NOT prefix slash-commands that aren't modes (e.g. /add)", () => {
    // /add is a direct-action · would be intercepted before applyMode runs ·
    // but if it slips through with mode=battle we shouldn't double-prefix.
    // Actually applyMode SHOULD prefix here · /add isn't a mode prefix.
    expect(applyMode("/add task review contracts", "battle")).toBe("/battle /add task review contracts");
  });

  it("prefixes case-insensitively · /BATTLE is treated as already-prefixed", () => {
    expect(applyMode("/BATTLE hello", "battle")).toBe("/BATTLE hello");
  });
});

describe("nextMode · cycle order", () => {
  it("default → battle", () => {
    expect(nextMode("default")).toBe("battle");
  });
  it("battle → reflect", () => {
    expect(nextMode("battle")).toBe("reflect");
  });
  it("reflect → execute", () => {
    expect(nextMode("reflect")).toBe("execute");
  });
  it("execute → default (wraps)", () => {
    expect(nextMode("execute")).toBe("default");
  });
});
