/**
 * tests/ai/vnext/escalation.test.ts — frontier escalation (2026-08-28).
 *
 * Operator decision under test: Ollama stays the base lane; a turn reaches
 * a metered frontier model ONLY when the operator explicitly asked for
 * depth. These pin behaviour, not source text: every assertion describes
 * something the operator would notice if it broke.
 */
import { describe, it, expect } from "vitest";
import {
  detectEscalationTier,
  resolveEscalation,
  type EscalationInput,
} from "@/lib/ai/vnext/escalation";

/** Enabled + funded + unspent: escalation is possible unless a rule stops it. */
const READY: Omit<EscalationInput, "userContent"> = {
  apiKeyPresent: true,
  escalationsToday: 0,
  dailyCap: 20,
  enabled: true,
};

describe("tier detection · explicit depth only", () => {
  it.each([
    ["/mega rewrite the pipeline", "mega"],
    ["spare no expense on this one", "mega"],
    ["look at it from every angle", "mega"],
    ["do a comprehensive review of the funnel", "thorough"],
    ["deep dive on the churn numbers", "thorough"],
    ["/research the supplier options", "thorough"],
    ["what's our strategy for Q4", "deep"],
    ["architect the new ingest path", "deep"],
  ])("%s -> %s", (msg, tier) => {
    expect(detectEscalationTier(msg)).toBe(tier);
  });

  it.each([
    "hey",
    "what's my revenue this month?",
    "how many tasks are overdue",
    "thanks",
  ])("ordinary turn does NOT escalate: %s", (msg) => {
    expect(detectEscalationTier(msg)).toBe("none");
  });

  it("an explicit /quick beats every depth marker — the operator gets the last word", () => {
    // Positive control: without the override this exact text IS mega.
    expect(detectEscalationTier("spare no expense")).toBe("mega");
    expect(detectEscalationTier("/quick spare no expense")).toBe("none");
  });

  it("is NOT length-gated — the measured failure of the complexity classifier", () => {
    // classifyCore returns "quick" for short unmarked text (p50 operator
    // message is 64 chars). A MARKED short message must still escalate.
    const short = "/mega go";
    expect(short.length).toBeLessThan(20);
    expect(detectEscalationTier(short)).toBe("mega");
  });
});

describe("escalation is capability-gated, and says so when blocked", () => {
  it("no API key → does not escalate, and reports the exact remedy", () => {
    const d = resolveEscalation({
      ...READY,
      apiKeyPresent: false,
      userContent: "deep dive on churn",
    });
    expect(d.escalate).toBe(false);
    expect(d.blockedBy).toBe("no-api-key");
    // The operator asked for depth and did not get it — that must be
    // legible, not silent. This is the anti-silent-degradation assertion.
    expect(d.reason).toContain("ANTHROPIC_API_KEY");
    // Tier is still reported so the UI can say what was WANTED.
    expect(d.tier).toBe("thorough");
  });

  it("daily cap reached → blocked with the count, so a loop cannot bill the operator", () => {
    const d = resolveEscalation({
      ...READY,
      escalationsToday: 20,
      dailyCap: 20,
      userContent: "/mega",
    });
    expect(d.escalate).toBe(false);
    expect(d.blockedBy).toBe("daily-cap-reached");
    expect(d.reason).toContain("20/20");
  });

  it("operator kill switch → blocked", () => {
    const d = resolveEscalation({ ...READY, enabled: false, userContent: "/mega" });
    expect(d.escalate).toBe(false);
    expect(d.blockedBy).toBe("disabled-by-operator");
  });

  it("private turns never leave the base lane", () => {
    const d = resolveEscalation({ ...READY, privateMode: true, userContent: "deep dive" });
    expect(d.escalate).toBe(false);
    expect(d.blockedBy).toBe("private-mode");
  });

  it("an ordinary turn is not 'blocked' — it simply never wanted to escalate", () => {
    const d = resolveEscalation({ ...READY, apiKeyPresent: false, userContent: "hey" });
    expect(d.escalate).toBe(false);
    expect(d.blockedBy).toBeUndefined();
  });
});

describe("model + effort selection", () => {
  it("mega is the ONLY path to max, and carries its own justification", () => {
    const d = resolveEscalation({ ...READY, userContent: "spare no expense" });
    expect(d.escalate).toBe(true);
    expect(d.model).toBe("claude-fable-5");
    expect(d.effort).toBe("max");
    expect(d.justify).toBe(true);
  });

  it("deep and thorough use the strong-cheap lane, never max", () => {
    for (const msg of ["what's our strategy here", "comprehensive review please"]) {
      const d = resolveEscalation({ ...READY, userContent: msg });
      expect(d.escalate).toBe(true);
      expect(d.model).toBe("claude-opus-5");
      expect(d.effort).toBe("high");
      expect(d.justify).toBeUndefined();
    }
  });

  it("effort is pinned to the conversation — changing it invalidates the prompt cache", () => {
    const d = resolveEscalation({
      ...READY,
      userContent: "deep dive",
      conversationEffort: "medium",
    });
    expect(d.effort).toBe("medium");
  });

  it("a pinned `max` is REFUSED — max must never become a conversation default", () => {
    const d = resolveEscalation({
      ...READY,
      userContent: "deep dive", // thorough, not mega
      conversationEffort: "max",
    });
    expect(d.escalate).toBe(true);
    // Falls back to the tier's own effort rather than honouring the pin.
    expect(d.effort).toBe("high");
    expect(d.justify).toBeUndefined();
  });
});

describe("trust boundary outranks tier", () => {
  it("untrusted input pins the classifier-ON model and cannot reach max", () => {
    // An injected "spare no expense" in scraped content must not be able
    // to spend the operator's biggest hammer.
    const d = resolveEscalation({
      ...READY,
      userContent: "spare no expense",
      untrustedInput: true,
    });
    expect(d.escalate).toBe(true);
    expect(d.model).toBe("claude-fable-5");
    expect(d.effort).toBe("high");
    expect(d.effort).not.toBe("max");
    expect(d.justify).toBeUndefined();
    expect(d.reason).toContain("classifier ON");
  });

  it("untrusted never routes to mythos", () => {
    const d = resolveEscalation({
      ...READY,
      userContent: "what's our strategy",
      untrustedInput: true,
    });
    expect(d.model).not.toBe("claude-mythos-5");
  });
});

/**
 * 2026-08-28 (review P1) · the daily cap counted NOTHING.
 *
 * The query compared `ai_generations.model` against bare ids, but the chat
 * path records that column as `${provider}/${model}` via recordInteraction
 * (lib/ai/memory.ts:55) — e.g. "anthropic/claude-opus-5". So no escalation
 * ever incremented the counter and every marked turn could spend past the
 * cap. Verified at the writer before fixing.
 */
describe("daily cap counts the rows that are actually written", () => {
  it("matches the PREFIXED form the chat path stores, and the bare form", async () => {
    const captured: Array<Record<string, unknown>> = [];
    vi.resetModules();
    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        aiGeneration: {
          count: (a: Record<string, unknown>) => {
            captured.push(a);
            return Promise.resolve(0);
          },
        },
      },
    }));
    const { countEscalationsToday } = await import("@/lib/ai/vnext/escalation");
    await countEscalationsToday();

    const where = (captured[0] as { where: { OR: Array<Record<string, unknown>> } }).where;
    const serialized = JSON.stringify(where.OR);
    // Both shapes must be reachable, or the guard is dead against real data.
    expect(serialized).toContain('"endsWith":"/claude-opus-5"');
    expect(serialized).toContain('"model":"claude-opus-5"');
    expect(serialized).toContain('"endsWith":"/claude-fable-5"');
    vi.doUnmock("@/lib/prisma");
  });

  it("fails CLOSED — an unreadable count refuses rather than allows", async () => {
    vi.resetModules();
    vi.doMock("@/lib/prisma", () => ({
      prisma: { aiGeneration: { count: () => Promise.reject(new Error("neon down")) } },
    }));
    const mod = await import("@/lib/ai/vnext/escalation");
    // Returning the cap means resolveEscalation will refuse.
    expect(await mod.countEscalationsToday()).toBe(mod.ESCALATION_DAILY_CAP);
    vi.doUnmock("@/lib/prisma");
  });
});
