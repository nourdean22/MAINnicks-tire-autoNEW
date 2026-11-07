/**
 * 2026-11-07 receptionist audit: 90 inbound calls in 30 days showed come-in, quote,
 * inspection or tire intent and ended with neither bookSlot nor sendConfirmationSms.
 * Pins the FLOW 4 close-on-intent line, and that it adds no callback promise (PR 3555).
 */
import { describe, expect, it } from "vitest";
import { ASSISTANT_SYSTEM_PROMPT } from "./services/vapi";
import { sliceBlock } from "./testUtils/sourceBlock";

const flow4 = () => sliceBlock(ASSISTANT_SYSTEM_PROMPT, "## FLOW 4 — END EVERY CALL", "## \"I'LL CALL BACK\"", { label: "ASSISTANT_SYSTEM_PROMPT" });

describe("FLOW 4 closes on intent", () => {
  it("names both closing tools for a caller with come-in, tire, quote or check intent", () => {
    const f = flow4();
    expect(f).toContain("CLOSE ON INTENT:");
    expect(f).toMatch(/CLOSE ON INTENT:[^\n]*agreed to come in[^\n]*tires[^\n]*quote[^\n]*check[^\n]*bookSlot[^\n]*sendConfirmationSms[^\n]*before the sign-off/);
  });

  it("promises no callback and quotes no caller-audible line", () => {
    const line = flow4().split("\n").find((l) => l.startsWith("CLOSE ON INTENT:"))!;
    expect(line).not.toMatch(/call (you )?back|callback/i);
    expect(line).not.toContain('"');
  });
});
