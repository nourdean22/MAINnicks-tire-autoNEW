/**
 * intelligence-brief · combine decision, pure · 2026-08-21.
 *
 * combineBriefText / combinedBriefTitle decide whether the 10:15 UTC
 * push covers just the exec brief (solo, morning-brief's hand-off
 * missing or already backstopped) or both (combined). Pulled out of
 * the dispatch-push step callback so this branch is directly testable
 * without mocking step.run/prisma/sendPush.
 */
import { describe, it, expect } from "vitest";
import {
  combineBriefText,
  combinedBriefTitle,
  combinedPushBody,
} from "@/lib/inngest/functions/intelligence-brief";

describe("combinedBriefTitle", () => {
  it("titles as combined when morning's highlight was there to fold in", () => {
    expect(combinedBriefTitle("Drift: CRITICAL · 14 open tasks")).toBe("Morning + Executive Brief");
  });

  it("falls back to the solo title when nothing was pending — morning didn't hand off", () => {
    expect(combinedBriefTitle(null)).toBe("Daily Executive Brief");
  });
});

describe("combineBriefText", () => {
  it("prepends morning's highlight above the exec brief under its own heading", () => {
    const text = combineBriefText("Drift: CRITICAL · 14 open tasks", "# Daily Executive Brief\nOpportunity A");
    expect(text.startsWith("## \u{1F305} This Morning\nDrift: CRITICAL")).toBe(true);
    expect(text).toContain("# Daily Executive Brief\nOpportunity A");
    expect(text).toContain("---");
  });

  it("returns the exec text untouched when there is nothing to combine", () => {
    const text = combineBriefText(null, "# Daily Executive Brief\nOpportunity A");
    expect(text).toBe("# Daily Executive Brief\nOpportunity A");
  });
});

describe("combinedPushBody", () => {
  it("gives each brief a fixed slice so a long morning brief can't crowd out the exec teaser", () => {
    // handOffForCombine now hands off the FULL morning text, which can
    // easily exceed the entire 200-char push budget on its own — this
    // pins that the exec brief is still represented in the preview.
    const longMorning = "M".repeat(500);
    const longExec = "E".repeat(500);
    const body = combinedPushBody(longMorning, longExec);

    expect(body).toContain("M");
    expect(body).toContain("E");
    expect(body.length).toBeLessThanOrEqual(200);
  });

  it("falls back to the solo (untruncated-split) teaser when there is nothing to combine", () => {
    const body = combinedPushBody(null, "Opportunity A scored 92");
    expect(body).toBe("Opportunity A scored 92");
  });
});
