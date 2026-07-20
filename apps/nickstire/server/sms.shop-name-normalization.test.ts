/**
 * 2026-07-20 · Shop-name normalization in humanizeCopy().
 *
 * THE LIVE DEFECT THIS PINS. Every outbound SMS passes through humanizeCopy,
 * which standardizes the business name. The rule was:
 *
 *   clean.replace(/\bNick's Tire\b/gi, "Nick's Tire & Auto")
 *
 * `\bNick's Tire\b` also matches the PREFIX of an already-correct
 * "Nick's Tire & Auto" — the trailing \b is satisfied by the following space —
 * so a correct name gained a second suffix:
 *
 *   "Nick's Tire & Auto"  ->  "Nick's Tire & Auto & Auto"
 *
 * Confirmed in production: sms_orchestrations #3270006 carried the body
 * "Free brake check at Nick's Tire & Auto & Auto. First-come, first-served..."
 *
 * A second bug rode along: the "Nick's Tire and Auto" rule ran AFTER the bare
 * rule, which had already rewritten its input, so it could never match — dead
 * code that silently did nothing.
 *
 * The invariant: whatever spelling goes in, exactly ONE "& Auto" comes out.
 */
import { describe, expect, it } from "vitest";
import { humanizeCopy } from "./services/smsOrchestrator";

const CANON = "Nick's Tire & Auto";

/** Count occurrences of the "& Auto" / "and Auto" suffix. */
const suffixCount = (s: string) => (s.match(/(?:&|and)\s*Auto\b/gi) || []).length;

describe("humanizeCopy · shop-name normalization", () => {
  // THE regression: an already-correct name must survive unchanged.
  it("leaves an already-correct name alone (no doubled suffix)", () => {
    const out = humanizeCopy(`Free brake check at ${CANON}. Walk in today.`);
    expect(out).toContain(CANON);
    expect(out).not.toContain("& Auto & Auto");
    expect(suffixCount(out)).toBe(1);
  });

  it("is idempotent — running it twice changes nothing", () => {
    const once = humanizeCopy(`Come by ${CANON} today.`);
    expect(humanizeCopy(once)).toBe(once);
  });

  it("expands a bare 'Nick's Tire' to the full name", () => {
    const out = humanizeCopy("Come by Nick's Tire today.");
    expect(out).toContain(CANON);
    expect(suffixCount(out)).toBe(1);
  });

  // This path was previously dead code — the bare rule mangled it first into
  // "Nick's Tire & Auto and Auto".
  it("normalizes the spelled-out 'and Auto' variant", () => {
    const out = humanizeCopy("Come by Nick's Tire and Auto today.");
    expect(out).toContain(CANON);
    expect(out).not.toContain("and Auto and");
    expect(out).not.toContain("& Auto and Auto");
    expect(suffixCount(out)).toBe(1);
  });

  it("handles the missing-apostrophe spelling", () => {
    const out = humanizeCopy("Come by Nicks Tire today.");
    expect(out).toContain(CANON);
    expect(suffixCount(out)).toBe(1);
  });

  it.each([
    `${CANON}`,
    "Nick's Tire",
    "Nick's Tire and Auto",
    "nick's tire & auto",
    "NICK'S TIRE",
  ])("exactly one suffix for input %j", (input) => {
    expect(suffixCount(humanizeCopy(`Visit ${input} today.`))).toBe(1);
  });

  // Guard the real message that shipped.
  it("fixes the exact body that went out in sms_orchestrations #3270006", () => {
    const out = humanizeCopy("Free brake check at Nick's Tire & Auto. First-come, first-served.");
    expect(out).not.toContain("& Auto & Auto");
  });
});
