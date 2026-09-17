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
import { pruneTools, mentionsAllTokens, toolNameTokens } from "@/lib/ai/chat-mode";
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

/**
 * The browser was ONE instance of a class, not a one-off.
 *
 * A sweep of eight capabilities against the real selector (2026-09-16) found
 * THREE with no plain-language path at all — `searchSkills`, `solveMath` and
 * `getCameraIntelligence`, none of them credential-gated in the catalog, so all
 * three are unreachable by accident rather than by design.
 *
 * This table exists so that stays VISIBLE. A tool added without a way to ask
 * for it is not a capability; it is 24-slot budget pressure with no upside, and
 * nothing else in the repo would notice. The census can only report it after a
 * month of production turns — this reports it at commit time.
 *
 * KNOWN-UNREACHABLE, deliberately not "fixed" — and as of 2026-09-17 each
 * verdict is MEASURED rather than assumed, by calling the capability:
 *   · solveMath             — the model does arithmetic natively; "redundant"
 *                             may be the right verdict. The never-chosen
 *                             rewrite queue will now draft exactly that.
 *   · searchSkills          — the store HAS content and the lane works, but
 *                             retrieval is poor: the top match for "mobile UX
 *                             audit" is `verify-receipt` at 0.36 similarity,
 *                             and "database design" returns nothing at all.
 *                             Surfacing a tool that answers confidently with
 *                             the wrong skill is worse than leaving it dark in
 *                             an app whose whole posture is anti-fabrication.
 *                             Reopen when retrieval improves, not before.
 *   · getCameraIntelligence — ⚠ the earlier note here said "pre-G3; no live
 *                             data", and that was WRONG. `vision_events` holds
 *                             24 rows and the tool returns a WELL-FORMED ZERO:
 *                             `{todayTraffic:{people:0,vehicles:0}, alerts:0,
 *                             bayUtilization:0, avgDailyTraffic:5}`. That is
 *                             the more dangerous case, not the safer one — a
 *                             model handed those zeros reports "no traffic
 *                             today" as fact, when the truth is "24 events
 *                             exist, ever". Reopen when the pipeline feeds.
 */
describe("capability reachability · a tool nobody can ask for is not a capability", () => {
  const MUST_BE_REACHABLE: Array<{ tool: string; prompt: string }> = [
    // Each verified surfacing at the time of writing. A regression here means
    // someone narrowed a keyword family and silently removed a capability.
    { tool: "runPython", prompt: "run this python and tell me the result" },
    { tool: "searchDocuments", prompt: "search my documents for the lease" },
    { tool: "generateSQL", prompt: "write me a SQL query for that table" },
    { tool: "browseAndDo", prompt: "go to monro.com and check their oil change price" },
  ];

  it.each(MUST_BE_REACHABLE)("$tool is reachable by plain language", async ({ tool, prompt }) => {
    const offered = await offeredFor(prompt);
    expect(
      offered,
      `"${prompt}" no longer surfaces ${tool} — a keyword family was narrowed and a capability went dark.`,
    ).toContain(tool);
  });
});

/**
 * THE SECOND REACHABILITY WAVE — measured on the never-surfaced roster.
 *
 * The browser above was one instance. The 2026-09-17 census gave the full list:
 * 35 catalog tools were never surfaced ONCE in 467 turns. Probing five of them
 * against the real selector, only 3 of 13 natural phrasings reached their tool.
 *
 * The worst was `sendTelegram` at 1/5. It carries the ENTIRE durable-delegation
 * contract — an `action_attempts` row claimed BEFORE the send, an
 * `onClaimUnavailable` that fails CLOSED so an idempotency outage cannot
 * produce an untracked duplicate, a 30-minute UNKNOWN fence, the provider
 * message id as external reference. All of that was built, proven and shipped
 * for a capability the model was never offered.
 *
 * Two distinct causes, and the repo's own failure taxonomy separates them:
 *
 *   NOT SURFACED — the selector could not match the phrasing. Two defects:
 *     (a) exact-mention was `text.includes("sendtelegram")`, a single
 *         concatenated token, so naming the tool's own transport did not reach
 *         it. Whitespace-blind for EVERY multi-word tool in the catalog.
 *     (b) the comms trigger demanded verb-object adjacency
 *         `send (a|the)? (message|telegram)`, so "send ME a telegram" missed on
 *         the pronoun and "ping me on telegram" missed entirely.
 *
 *   BUDGETED OUT — matched, then cut by the 24-slot cliff. Proven separately:
 *     "find that file in my drive" is dark at budget 24 and OFFERED at 60.
 *     That is the tier-4 ordering problem, not this one, and it is deliberately
 *     NOT fixed here.
 *
 * After the fix: 9 of 11 reachable, and both remaining failures are the
 * budget case above.
 */
describe("mentionsAllTokens · the exact-mention tier's discipline", () => {
  it("POSITIVE CONTROL: it matches a real multi-word name across a gap", () => {
    // The motivating case. Without this the whole rule could be inert.
    expect(mentionsAllTokens("send me a telegram when you're done", "sendTelegram")).toBe(true);
    expect(toolNameTokens("sendTelegram")).toEqual(["send", "telegram"]);
  });

  it("requires EVERY token — a partial name is not a mention", () => {
    // `searchDriveFiles` must not fire on a bare "search", which would drag
    // file tools into every search-shaped sentence.
    expect(mentionsAllTokens("search my google drive", "searchDriveFiles")).toBe(false);
    expect(mentionsAllTokens("search my google drive files", "searchDriveFiles")).toBe(true);
  });

  it("ignores single-token names — they keep the substring path", () => {
    // "summarize this" already worked; letting one generic word count as an
    // exact mention would flood the highest-priority tier.
    expect(mentionsAllTokens("summarize this", "summarize")).toBe(false);
  });

  it("requires at least one NON-GENERIC token", () => {
    // Otherwise "get the report" reaches `getTasks` via get+the, and half the
    // catalog arrives on any sentence with a common verb.
    expect(mentionsAllTokens("get the report", "getTasks")).toBe(false);
    expect(mentionsAllTokens("get my tasks", "getTasks")).toBe(true);
  });

  it("matches on a word boundary, not a substring", () => {
    // "gram" must never reach `sendTelegram`; "telegrams" plural must.
    expect(mentionsAllTokens("send a gram", "sendTelegram")).toBe(false);
    expect(mentionsAllTokens("send telegrams", "sendTelegram")).toBe(true);
  });
});

describe("never-surfaced capabilities are reachable from plain language", () => {
  const CASES: Array<{ tool: string; prompts: string[] }> = [
    {
      // 1/5 before. Naming its own transport did not reach it.
      tool: "sendTelegram",
      prompts: [
        "send me a telegram when you're done",
        "ping me on telegram with the summary",
        "text me a reminder about the vendor call",
        "notify me about this",
      ],
    },
    {
      // 0/2 before. Asking about a supplied picture is a read-only intent
      // distinct from the expensive generate lane, which stays narrow.
      tool: "analyzeImage",
      prompts: ["what's in this photo", "look at this screenshot and tell me what it says"],
    },
    {
      // 0/2 before. Naming the product must be enough.
      tool: "searchDriveFiles",
      prompts: ["search my google drive for the lease"],
    },
  ];

  for (const c of CASES) {
    it.each(c.prompts)(`${c.tool} is reachable: %s`, async (prompt) => {
      const offered = await offeredFor(prompt);
      expect(
        offered,
        `"${prompt}" no longer surfaces ${c.tool} — a reachability fix regressed. Offered: ${offered.join(", ")}`,
      ).toContain(c.tool);
    });
  }

  /**
   * These three are the token matcher's ONLY proof of value, and they exist
   * because its first mutation SURVIVED.
   *
   * Disabling the matcher at its call site left all the tests above green: the
   * broadened comms trigger already carried `sendTelegram`, so nothing
   * discriminated. A mutation that survives means either the code is dead or
   * the suite cannot see it — and measuring told us which. Across eight
   * never-surfaced multi-word tools the matcher scores 8/8 and the families
   * alone score 5/8. These are the three it alone rescues.
   *
   * Without them the matcher would look deletable, and deleting it would
   * silently re-dark three capabilities.
   */
  it.each([
    { tool: "resolveContradiction", prompt: "resolve this contradiction in my notes" },
    { tool: "surfaceAntiPatterns", prompt: "surface my anti patterns" },
    { tool: "runSimulation", prompt: "run a simulation of that" },
  ])("ONLY the token matcher reaches $tool", async ({ tool, prompt }) => {
    const offered = await offeredFor(prompt);
    expect(
      offered,
      `"${prompt}" no longer reaches ${tool} — the exact-mention token path regressed.`,
    ).toContain(tool);
  });

  it("COST CONTROL: ordinary prompts do not balloon past the budget", () => {
    // The token matcher feeds the HIGH-PRIORITY exact tier, so a sloppy rule
    // would crowd out the keyword families beneath it. A reachability win paid
    // for by truncating everything else is not a win.
    return Promise.all(
      ["what are my tasks today", "i feel scattered and behind", "what should i do next"].map(
        async (p) => {
          const offered = await offeredFor(p);
          expect(offered.length, `"${p}" offered ${offered.length}`).toBeLessThanOrEqual(24);
        },
      ),
    );
  });

  it("the image READ lane does not hijack a topic that merely mentions a photo", async () => {
    // Narrowness is the point: it needs a demonstrative or possessive, so
    // talking ABOUT photos is not the same as handing one over.
    expect(await offeredFor("i should take more photos of the shop")).not.toContain("analyzeImage");
  });
});
