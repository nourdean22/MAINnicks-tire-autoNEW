/**
 * Business-knowledge load gates · 2026-06-10 prompt-budget trim armor.
 *
 * The trim moved SMS_VOICE / EQUIPMENT_AUTHORITY / CLEVELAND_IDENTITY
 * out of the always-on business foundation. Pins:
 *   1. detectSmsIntent — the ONLY delivery path for the SMS tone card
 *      outside content mode (detectContentIntent has no sms keywords)
 *   2. an SMS-drafting ask still gets SMS VOICE on the business tier
 *   3. a plain business ask gets NONE of the three moved cards (the
 *      saving is real) but keeps the foundation (BRAND VOICE etc.)
 *   4. content mode carries all three (no capability lost)
 *
 * Pure data + regex — no mocks needed.
 */

import { afterEach, describe, it, expect, vi } from "vitest";

// No mocks — content-intent.ts is a zero-import pure module, so these
// gates run against the REAL content detector.
import { detectSmsIntent, getBusinessKnowledge } from "@/lib/ai/business-knowledge";

describe("detectSmsIntent", () => {
  it("fires on sms/text/win-back asks", () => {
    expect(detectSmsIntent("draft an sms for the winback list")).toBe(true);
    expect(detectSmsIntent("send a text to the customer about the brakes")).toBe(true);
    expect(detectSmsIntent("texting campaign for stale leads")).toBe(true);
    expect(detectSmsIntent("win-back message for old customers")).toBe(true);
  });

  it("stays quiet on ordinary asks and null", () => {
    expect(detectSmsIntent("what's revenue today")).toBe(false);
    expect(detectSmsIntent("write me an instagram post")).toBe(false);
    expect(detectSmsIntent(null)).toBe(false);
    expect(detectSmsIntent(undefined)).toBe(false);
    // "context" / "textbook" must not substring-match "text".
    expect(detectSmsIntent("give me more context on the lead")).toBe(false);
  });
});

describe("getBusinessKnowledge load gates", () => {
  it("SMS ask on business tier gets the SMS VOICE card (own gate, not content mode)", () => {
    const out = getBusinessKnowledge("business", "draft the sms blast for winback");
    expect(out).toContain("SMS VOICE");
  });

  it("plain business ask loads NONE of the three moved cards but keeps the foundation", () => {
    const out = getBusinessKnowledge("business", "how did the shop do this week");
    expect(out).not.toContain("SMS VOICE");
    expect(out).not.toContain("EQUIPMENT AUTHORITY");
    expect(out).not.toContain("CLEVELAND IDENTITY");
    // Foundation survives the trim.
    expect(out).toContain("BRAND VOICE");
    expect(out).toContain("HARD RULES");
  });

  it("content mode carries all three moved cards", () => {
    const out = getBusinessKnowledge("business", "write me an instagram post about brakes");
    expect(out).toContain("SMS VOICE");
    expect(out).toContain("EQUIPMENT AUTHORITY");
    expect(out).toContain("CLEVELAND IDENTITY");
  });

  it("core tier stays ops-card-only", () => {
    const out = getBusinessKnowledge("core", "hey");
    expect(out).toContain("OPS CARD");
    expect(out).not.toContain("BRAND VOICE");
  });
});

// ── AG-35 · V2 knowledge layer ────────────────────────────────────
// The pack was orphaned from the live prompt by the Prompt V2 cutover;
// appendBusinessKnowledgeLayer re-injects it, tier/slot-gated.
import { appendBusinessKnowledgeLayer, trimPromptToBudget } from "@/lib/ai/system-prompt";

describe("AG-35 · appendBusinessKnowledgeLayer", () => {
  it("business tier appends the ops card marker", async () => {
    const out = await appendBusinessKnowledgeLayer("BASE", "business", "default", "how should we price alignments");
    expect(out).toContain("OPS CARD");
    expect(out.startsWith("BASE")).toBe(true);
  });

  it("core tier + default slot leaves the prompt untouched", async () => {
    const out = await appendBusinessKnowledgeLayer("BASE", "core", "default", "hey");
    expect(out).toBe("BASE");
  });

  it("content slot forces the layer even on a core tier", async () => {
    const out = await appendBusinessKnowledgeLayer("BASE", "core", "content", "write a post");
    expect(out).toContain("OPS CARD");
  });
});

// ── 2026-08-08 · pack visibility + runtime-floor bound ─────────────
// The engine's block titles must be two-hash (`## `) — the ONLY header
// level trimPromptToBudget splits on. As triple-hash the whole pack was
// ONE atomic section glued to the preceding header, so the 65k runtime
// slice dropped the ENTIRE engine on non-anthropic content turns, and
// the un-budgeted append built 107k prompts (prompt:size-check red).
// These pin (a) section visibility via the trimmer's exact regex, and
// (b) the append-side bound with tail-first survival: deep blocks drop
// before essentials, the base prompt is never touched.

describe("content pack · section visibility + runtime-floor bound", () => {
  const DEEP_ASK =
    "build my monthly content plan and posting strategy across reels and carousels";

  it("deep-mode pack splits into many sections under the trimmer's own regex", () => {
    const out = getBusinessKnowledge("business", DEEP_ASK);
    const sections = out.split(/\n(?=## )/g);
    expect(sections.length).toBeGreaterThan(20);
    // No triple-hash titles left to fuse sub-blocks into one atomic section.
    expect(out).not.toMatch(/\n### /);
  });

  it("append bounds base+pack at the 65k runtime floor, deep tail dropped first", async () => {
    const base = "## BASE\n" + "x".repeat(40_000);
    const out = await appendBusinessKnowledgeLayer(base, "business", "content", DEEP_ASK);
    expect(out.length).toBeLessThanOrEqual(65_000);
    // Pack-scoped trim: the base prompt must come through byte-identical.
    expect(out.startsWith(base)).toBe(true);
    // Essentials head survives; the last deep block is the first casualty.
    expect(out).toContain("CONTENT GENERATION MODE");
    expect(out).not.toContain("IDEAS VAULT");
  });

  it("a base already at the floor gets no pack rather than a sliced one", async () => {
    const base = "## BASE\n" + "y".repeat(65_100);
    const out = await appendBusinessKnowledgeLayer(base, "business", "content", DEEP_ASK);
    expect(out).toBe(base);
  });

  it("a format ask keeps its engine under the bound (it was the FIRST casualty before)", async () => {
    // 2026-08-08 · the format engines lived at the essentials tail, so
    // tail-first trimming dropped CAROUSEL ENGINE on the very ask that
    // needed it (reproduced with the trimmer's own drop order). They now
    // ride directly behind the mandatory rules.
    const base = "## BASE\n" + "x".repeat(40_000);
    const out = await appendBusinessKnowledgeLayer(
      base,
      "business",
      "content",
      "write me an instagram carousel about winter tire safety",
    );
    expect(out.length).toBeLessThanOrEqual(65_000);
    expect(out).toContain("CAROUSEL ENGINE");
    expect(out).toContain("CONTENT GENERATION MODE");
  });
});

// ── 2026-10-01 · the asked engine survives the bound in every month ──
// The format-ask test above went red on October 1 with no code change.
// The pack carries the month's SEASONAL PLAYBOOK, and every pack card
// ranked the same for the trimmer, so whether the engine survived came
// down to the length of the cards in front of it. The winter playbook
// is ~250 chars longer than fall's, and that was more than the whole
// margin: CAROUSEL ENGINE was kept with 44 chars to spare in September
// and lost in eight months of twelve; REELS ENGINE was lost in all of
// them. The clock is pinned per month here, so a month-dependent card
// can no longer decide the outcome on the day CI happens to run.
//
// Assertions read section HEADINGS, never mentions: the pack's text
// mentions "OPS CARD" inside CUSTOMER PROFILE, so a bare substring check
// would pass with the OPS CARD block itself dropped.

describe("content pack · the asked engine survives the bound in every month", () => {
  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const CAROUSEL_ASK = "write me an instagram carousel about winter tire safety";
  const REELS_ASK = "write me a reel script about brake noise";

  afterEach(() => {
    vi.useRealTimers();
  });

  function pinMonth(monthIndex: number): void {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, monthIndex, 15, 12)));
  }

  function hasSection(out: string, title: string): boolean {
    return out.split("\n").some((line) => line.startsWith("## ") && line.includes(title));
  }

  it.each(MONTHS.map((name, index) => [name, index] as const))(
    "%s: a carousel or reels ask on a 40k base keeps its engine and the mandatory rules",
    async (month, monthIndex) => {
      pinMonth(monthIndex);
      // Positive control: the pinned clock is the one the pack is built on.
      expect(getBusinessKnowledge("business", CAROUSEL_ASK)).toContain(`(current month: ${month})`);
      const base = "## BASE\n" + "x".repeat(40_000);
      for (const [ask, engine] of [
        [CAROUSEL_ASK, "CAROUSEL ENGINE"],
        [REELS_ASK, "REELS ENGINE"],
      ] as const) {
        const out = await appendBusinessKnowledgeLayer(base, "business", "content", ask);
        expect(out.length).toBeLessThanOrEqual(65_000);
        expect(out.startsWith(base)).toBe(true);
        expect(hasSection(out, engine), `${month}: ${engine} dropped`).toBe(true);
        expect(hasSection(out, "CONTENT GENERATION MODE"), `${month}: rules dropped`).toBe(true);
      }
    },
  );

  // The pack's documented drop order, checked as the base grows and the
  // room shrinks: every other card goes before the asked engine, the
  // engine before the mandatory rules, and the OPS CARD last. So wherever
  // the engine survives the rules do, and wherever the rules survive the
  // OPS CARD does.
  it("as the room shrinks the engine goes first, then the rules, and the OPS CARD last", async () => {
    pinMonth(9); // October: the longer winter playbook
    let engineDropped = false;
    let rulesDroppedOpsKept = false;
    for (let baseLen = 30_000; baseLen <= 62_000; baseLen += 1_000) {
      const base = "## BASE\n" + "x".repeat(baseLen);
      const out = await appendBusinessKnowledgeLayer(base, "business", "content", CAROUSEL_ASK);
      const engine = hasSection(out, "CAROUSEL ENGINE");
      const rules = hasSection(out, "CONTENT GENERATION MODE");
      const ops = hasSection(out, "OPS CARD");
      if (engine) expect(rules, `base ${baseLen}: engine kept, rules dropped`).toBe(true);
      if (rules) expect(ops, `base ${baseLen}: rules kept, OPS CARD dropped`).toBe(true);
      engineDropped ||= !engine;
      rulesDroppedOpsKept ||= !rules && ops;
    }
    // Positive control: the sweep has to reach the squeeze where the
    // engine goes, and the one where the rules are gone but the OPS CARD
    // stands, or the implications above hold vacuously.
    expect(engineDropped).toBe(true);
    expect(rulesDroppedOpsKept).toBe(true);
  });

  // The ranks are pack-scoped. In the whole-prompt trim the pack, appended
  // last, still goes before the base's own unranked sections, so a base
  // section such as the live data snapshot never makes way for an OPS CARD.
  it("the whole-prompt trim still drops the pack's OPS CARD before a base section", () => {
    const base = "## LIVE DATA SNAPSHOT\n" + "d".repeat(500);
    const pack = "## NICK'S TIRE & AUTO — OPS CARD\n" + "o".repeat(500);
    const out = trimPromptToBudget(`${base}\n\n${pack}`, 700);
    expect(hasSection(out, "LIVE DATA SNAPSHOT")).toBe(true);
    expect(hasSection(out, "OPS CARD")).toBe(false);
  });
});
