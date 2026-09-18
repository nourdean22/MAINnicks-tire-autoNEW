/**
 * THE SPEAKER-ATTRIBUTION INVARIANT
 *
 * Demand may only ever be inferred from what the CUSTOMER said. Assistant
 * speech may only ever REMOVE a call from the Missed Revenue Queue, never add
 * one to it.
 *
 * WHY THIS FILE EXISTS - measured on 2026-09-18, not theorised. `classifyCall`
 * scored `transcript + aiSummary`, which contains Nick's own turns. Nick's
 * greeting necessarily names the shop or the address, and BOTH were
 * load-bearing tokens in the outcome rules:
 *
 *   "17625 Euclid Ave"    -> `euclid` matched inferredWalkIn -> walk_in_directed
 *   "Nick's Tire & Auto"  -> `auto`   matched the fallback   -> lost_opportunity
 *
 * Both are queue candidates. Measured before the fix: a call where the caller
 * never spoke a single word produced a queue row, and so did a caller who only
 * asked what time the shop closes. The queue could not emit "no demand" for the
 * exact case it existed to detect - a silent instrument, and a large share of
 * the 1,118 "pending missed revenue" rows.
 *
 * These tests MUTATE the assistant's words and assert the outcome does not
 * move. A test that merely asserted today's happy path would have passed
 * against the defect.
 */
import { describe, expect, it } from "vitest";
import { classifyCall } from "../services/vapiCallClassifier";

const QUEUE_CANDIDATES = ["lost_opportunity", "callback_needed", "walk_in_directed", "tech_failure"];

const base = {
  durationSeconds: 45,
  endedReason: "customer-ended-call",
  aiSummary: "The caller did not speak.",
  leadId: null,
  callbackId: null,
  bookingId: null,
} as const;

/** Every realistic greeting Nick can open with. All name the shop or the address. */
const GREETINGS = [
  "AI: Thanks for calling Nick's Tire & Auto, this is Nick. How can I help you today?",
  "AI: Nick's Tire and Auto, this is Nick.",
  "AI: Thanks for calling. We are at 17625 Euclid Ave. What can I do for you?",
  "AI: Nick's Tire & Auto on Euclid Ave - you can pull up today, first come first served.",
  "AI: We fix cars here at Nick's Tire & Auto. Swing by and drop off the vehicle.",
];

describe("speaker attribution - the assistant's own words never manufacture demand", () => {
  for (const greeting of GREETINGS) {
    it("silent caller is NOT queue-worthy: " + greeting.slice(4, 44), () => {
      const r = classifyCall({ ...base, transcript: greeting } as any);
      expect(QUEUE_CANDIDATES).not.toContain(r.outcome);
      expect(r.outcome).toBe("abandoned_before_connect");
    });
  }

  it("MUTATION CANARY: outcome is invariant under every greeting rewrite", () => {
    const outcomes = new Set(
      GREETINGS.map((g) => classifyCall({ ...base, transcript: g } as any).outcome),
    );
    // Before the fix this set was {walk_in_directed, lost_opportunity} - the
    // assistant's wording ALONE moved the outcome. It must now be a singleton.
    expect(outcomes.size).toBe(1);
  });

  it("POSITIVE CONTROL: the same assertions DO fire when the customer really speaks", () => {
    // Proves these tests can distinguish demand from silence, rather than
    // passing merely because everything now classifies as abandoned.
    const r = classifyCall({
      ...base,
      transcript: GREETINGS[0] + "\nUser: I need two used 215/60R17 for my Honda today.",
      aiSummary: "Caller wants two used tires.",
    } as any);
    expect(r.outcome).not.toBe("abandoned_before_connect");
    expect(r.intents.length).toBeGreaterThan(0);
    expect(r.speakerAttribution).toBe("transcript");
  });

  it("KNOWN GAP: a size-only used-tire request does not register as used_tire", () => {
    // Documented, not silently accepted. INTENT_PATTERNS.used_tire requires the
    // literal word "tire"/"tires"/"rubber" adjacent to "used". But the most
    // natural way a tire customer speaks is the SIZE, not the noun:
    //   "I need two used 215/60R17 for my Honda"
    // That yields tire_size_request only. The SMS draft happens to survive this
    // (both intents share one branch), but any count of used-vs-new tire demand
    // undercounts used. Fix belongs in INTENT_PATTERNS, not here; this test
    // pins the CURRENT behaviour so the day it changes is visible.
    const r = classifyCall({
      ...base,
      transcript: GREETINGS[0] + "\nUser: I need two used 215/60R17 for my Honda today.",
      aiSummary: "Caller wants two used tires.",
    } as any);
    expect(r.intents).toContain("tire_size_request");
    expect(r.intents).not.toContain("used_tire");
  });

  it("the same request WITH the word 'tires' does register as used_tire", () => {
    const r = classifyCall({
      ...base,
      transcript: GREETINGS[0] + "\nUser: I need two used tires in 215/60R17 for my Honda.",
      aiSummary: "Caller wants two used tires.",
    } as any);
    expect(r.intents).toContain("used_tire");
  });
});

describe("speaker attribution - customer speech is what moves the outcome", () => {
  it("walk-in intent counts when the CALLER says it", () => {
    const r = classifyCall({
      ...base,
      transcript: GREETINGS[0] + "\nUser: Alright, I will swing by today after work.",
      aiSummary: "Caller will come in.",
    } as any);
    expect(r.outcome).toBe("walk_in_directed");
  });

  it("callback intent counts when the CALLER asks for it", () => {
    const r = classifyCall({
      ...base,
      transcript: GREETINGS[0] + "\nUser: Can you have someone call me back about brakes?",
      aiSummary: "Caller asked for a callback.",
    } as any);
    expect(r.outcome).toBe("callback_needed");
  });

  it("a pure hours question is informational, not missed revenue", () => {
    const r = classifyCall({
      ...base,
      transcript: GREETINGS[2] + "\nUser: What time do you close today?",
      aiSummary: "Caller asked about closing time.",
    } as any);
    expect(QUEUE_CANDIDATES).not.toContain(r.outcome);
  });
});

describe("speaker attribution - provenance is explicit, never silently assumed", () => {
  it("role-tagged messages are authoritative and reported as such", () => {
    const r = classifyCall({
      ...base,
      transcript: "unparseable blob with no speaker prefixes at all",
      messages: [
        { role: "bot", message: "Thanks for calling Nick's Tire & Auto on Euclid Ave." },
        { role: "user", message: "I need a used tire for my Malibu please." },
      ],
    } as any);
    expect(r.speakerAttribution).toBe("messages");
    expect(r.intents).toContain("used_tire");
  });

  it("prefix-parsed transcript reports 'transcript'", () => {
    const r = classifyCall({
      ...base,
      transcript: GREETINGS[0] + "\nUser: I need a used tire for my Malibu please.",
    } as any);
    expect(r.speakerAttribution).toBe("transcript");
  });

  it("UNATTRIBUTABLE is 'unavailable' and 'unknown' - never fabricated demand", () => {
    // The honest third state. Before the fix this exact input produced
    // `lost_opportunity` - a real queue obligation - purely from the word "auto".
    const r = classifyCall({
      ...base,
      transcript: "Nick's Tire & Auto we fix cars",
      aiSummary: "",
    } as any);
    expect(r.speakerAttribution).toBe("unavailable");
    expect(r.outcome).toBe("unknown");
    expect(QUEUE_CANDIDATES).not.toContain(r.outcome);
  });

  it("unattributable is NOT collapsed into 'caller said nothing'", () => {
    const unattributable = classifyCall({ ...base, transcript: "blob", aiSummary: "" } as any);
    const genuinelySilent = classifyCall({ ...base, transcript: GREETINGS[0] } as any);
    // Both are non-queue, but they are DIFFERENT states and must stay distinct:
    // one means "we could not read the call", the other "the caller said nothing".
    expect(unattributable.outcome).not.toBe(genuinelySilent.outcome);
    expect(unattributable.speakerAttribution).toBe("unavailable");
    expect(genuinelySilent.speakerAttribution).toBe("transcript");
  });
});

describe("speaker attribution - assistant text may exclude, never include", () => {
  it("an assistant-reported wrong number still excludes the call", () => {
    const r = classifyCall({
      ...base,
      transcript: GREETINGS[0] + "\nUser: oh sorry wrong number.",
      aiSummary: "This was a wrong number.",
    } as any);
    expect(QUEUE_CANDIDATES).not.toContain(r.outcome);
    expect(r.outcome).toBe("spam_or_wrong_number");
  });

  it("a silence timeout is still a technical failure", () => {
    const r = classifyCall({
      ...base,
      durationSeconds: 15,
      endedReason: "silence-timed-out",
      transcript: GREETINGS[0],
    } as any);
    expect(r.outcome).toBe("tech_failure");
  });
});
