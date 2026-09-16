/**
 * Browser capability must be REACHABLE from plain language — asserted against
 * the REAL selector, not a mirrored copy of its regexes.
 *
 * WHY A SECOND FILE. `chat-mode-keyword-families.test.ts` mirrors the patterns
 * by hand and says so: "MIRRORS the regex patterns in lib/ai/chat-mode.ts ·
 * keep these two in sync". A mirror cannot fail when the source narrows — it
 * locks a copy. Its header blames "a require()/path-alias issue in vitest" for
 * not calling `pruneTools` directly; this file tests whether that limitation
 * still holds. If `pruneTools` imports cleanly here, the stronger assertion is
 * available and should be used.
 *
 * WHAT IT GUARDS. Measured 2026-09-16 over 467 production turns: the browser
 * was used ZERO times. Both BROWSERBASE credentials present, six tools built,
 * and the census placed browser_navigate / browser_act / browser_observe /
 * browser_extract in `neverSurfaced` — never offered to the model at all.
 * The cause was the selector: its trigger wanted "scrape" / "automate the
 * browser" / a literal "browser act", so none of the six prompts below
 * surfaced any browser tool in either mode.
 *
 * A capability you cannot ask for in plain language is unreachable, whatever
 * its tools can do. That is the regression this file freezes.
 */
import { describe, it, expect } from "vitest";
import { pruneTools } from "@/lib/ai/chat-mode";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";

const BROWSER = new Set(
  TOOL_CATALOG.filter((t) => (t as { category?: string }).category === "browser").map(
    (t) => (t as { name: string }).name,
  ),
);

/** The same name-keyed shape prepareTools hands the pruner. */
function allTools(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const t of TOOL_CATALOG) out[(t as { name: string }).name] = {};
  return out;
}

async function offeredFor(prompt: string): Promise<string[]> {
  const pruned = (await pruneTools("standard" as never, allTools(), prompt)) as Record<string, unknown>;
  return Object.keys(pruned ?? {});
}

describe("browser capability is reachable from plain language", () => {
  it("POSITIVE CONTROL: the pruner runs and returns a bounded, non-empty set", async () => {
    // Without this, a pruner that threw or returned {} would make every
    // assertion below vacuous in the failing direction — and a pruner that
    // returned EVERY tool would make them vacuous in the passing direction.
    const offered = await offeredFor("what are my tasks today");
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.length).toBeLessThan(TOOL_CATALOG.length);
  });

  it.each([
    "go to monro.com and tell me what they charge for an oil change",
    "open our competitor's website and pull their current tire prices",
    "browse to the BBB listing for Nick's Tire and check what phone number it shows",
    "log into the Google Business Profile page and tell me what the listing name is",
    "look at this site and extract the pricing table: https://example.com/pricing",
    "check a website for me",
  ])("surfaces a browser tool for: %s", async (prompt) => {
    const offered = await offeredFor(prompt);
    const browserOffered = offered.filter((n) => BROWSER.has(n));
    expect(
      browserOffered,
      `no browser tool offered for "${prompt}" — offered set was: ${offered.join(", ")}`,
    ).not.toEqual([]);
  });

  it("offers the PREFERRED one-call entry point, not only the surgical tools", async () => {
    // meta.ts:298 — "For complete tasks … PREFER browseAndDo". The old family
    // pattern was /browser_/, which cannot match `browseAndDo` at all, so even
    // when it fired it skipped the recommended tool.
    const offered = await offeredFor("go to monro.com and check their oil change price");
    expect(offered).toContain("browseAndDo");
  });

  it("does not spend budget on the surgical tools unless they are named", async () => {
    // Four extra slots on a 24-slot budget. The census measured 8.4 of 24
    // slots per turn already going to tools never once chosen; this family
    // must not add to that.
    const offered = await offeredFor("go to monro.com and check their oil change price");
    expect(offered).not.toContain("browser_navigate");
    expect(offered).not.toContain("browser_extract");
  });

  it("offers the surgical tools when the operator names them", async () => {
    const offered = await offeredFor("use browser navigate to open the dashboard");
    expect(offered).toContain("browser_navigate");
  });

  it("a plain read-the-page request stays with the cheaper static fetch", async () => {
    // Deterministic beats agentic when the task is only to read a public page.
    const offered = await offeredFor("read the page and summarize it for me");
    expect(offered.filter((n) => BROWSER.has(n))).toEqual([]);
  });
});
