import { describe, expect, it } from "vitest";
import { classifyCall, detectIntents, extractCallSignals } from "../services/vapiCallClassifier";

describe("vapiCallClassifier intents", () => {
  it("detects concurrent service intents", () => {
    const intents = detectIntents("My brakes grind and I also need an oil change.");
    expect(intents).toContain("brakes");
    expect(intents).toContain("oil_change");
  });

  it("detects tire, diagnostic and operating-information requests", () => {
    expect(detectIntents("Do you have used tires in 225/60R16?")).toEqual(expect.arrayContaining(["used_tire", "tire_size_request"]));
    expect(detectIntents("My check engine light is on")).toContain("check_engine");
    expect(detectIntents("What time do you close?")).toContain("hours_location");
  });
});

describe("vapiCallClassifier evidence levels", () => {
  it("does not count a tool invocation without a persisted record as a hard conversion", () => {
    const result = classifyCall({
      durationSeconds: 50,
      endedReason: "customer-ended-call",
      aiSummary: "Customer asked about an alignment.",
      transcript: "Can you check my alignment price?",
      reachedTool: true,
      convertedToLead: 1,
    });
    expect(result.outcome).toBe("quote_or_inspection_intent");
  });

  it("counts a persisted lead, callback or booking as verified capture", () => {
    const base = {
      durationSeconds: 50,
      endedReason: "customer-ended-call",
      aiSummary: "Customer requested service.",
      transcript: "I need brake service.",
    };
    expect(classifyCall({ ...base, leadId: 11 }).outcome).toBe("hard_conversion");
    expect(classifyCall({ ...base, callbackId: 12 }).outcome).toBe("hard_conversion");
    expect(classifyCall({ ...base, bookingId: 13 }).outcome).toBe("hard_conversion");
  });

  it("does not turn walk-in direction into arrival or paid work", () => {
    const result = classifyCall({
      durationSeconds: 60,
      endedReason: "customer-ended-call",
      aiSummary: "Customer was told to stop by Euclid Avenue.",
      transcript: "Pull up today and we can inspect it.",
    });
    expect(result.outcome).toBe("walk_in_directed");
  });

  it("separates transfer attempt from conversion", () => {
    const result = classifyCall({
      durationSeconds: 45,
      endedReason: "assistant-forwarded-call",
      aiSummary: "Transferred to the front desk.",
      transcript: "I will transfer you now.",
    });
    expect(result.outcome).toBe("human_handoff");
  });

  it("keeps technical failures and genuine abandons explicit", () => {
    expect(classifyCall({
      durationSeconds: 15,
      endedReason: "silence-timed-out",
      aiSummary: "",
      transcript: "",
    }).outcome).toBe("tech_failure");
    expect(classifyCall({
      durationSeconds: 4,
      endedReason: "customer-ended-call",
      aiSummary: "Caller ended.",
      transcript: "Hello?",
    }).outcome).toBe("abandoned_before_connect");
  });

  it("routes sub-two-second empty calls to spam/misdial instead of abandon", () => {
    const result = classifyCall({
      durationSeconds: 1,
      endedReason: "customer-ended-call",
      aiSummary: "Ended immediately.",
      transcript: "",
    });
    expect(result.outcome).toBe("spam_or_wrong_number");
  });
});

describe("vapiCallClassifier quality independence", () => {
  it("keeps materially identical process quality when only persistence differs", () => {
    const common = {
      durationSeconds: 75,
      endedReason: "customer-ended-call",
      aiSummary: "Customer asked about brakes and received a next step.",
      transcript: "My brakes grind. Please tell me what to do next.",
      reachedTool: true,
      successEvaluation: "pass",
      sentiment: "neutral",
    };
    const toolOnly = classifyCall(common);
    const persistedLead = classifyCall({ ...common, leadId: 44 });
    expect(toolOnly.outcome).not.toBe("hard_conversion");
    expect(persistedLead.outcome).toBe("hard_conversion");
    expect(toolOnly.score).toBe(persistedLead.score);
    expect(toolOnly.qualityVersion).toBe("vapi-quality-v1");
  });
});

describe("extractCallSignals · Missed Revenue Queue enrichment", () => {
  it("extracts a price objection + high price-sensitivity", () => {
    const s = extractCallSignals({
      transcript: "That's way too expensive, I can't afford that. Can you do any better on the price?",
    });
    expect(s.objections).toContain("price");
    expect(s.priceSensitivity).toBe("high");
  });

  it("names competitors mentioned and flags the competitor objection", () => {
    const s = extractCallSignals({
      transcript: "Discount Tire quoted me less, and Monro is closer. Why should I come to you?",
    });
    expect(s.competitorMentions).toEqual(expect.arrayContaining(["Discount Tire", "Monro"]));
    expect(s.objections).toContain("competitor");
  });

  it("detects timing and availability objections", () => {
    expect(extractCallSignals({ transcript: "Not right now, maybe next month when I get paid." }).objections).toContain("timing");
    expect(extractCallSignals({ transcript: "How long is the wait? I have no time to sit around." }).objections).toContain("availability");
  });

  it("grades a plain pricing question as medium sensitivity (not high)", () => {
    const s = extractCallSignals({ transcript: "How much do you charge for an oil change?" });
    expect(s.priceSensitivity).toBe("medium");
    expect(s.objections).not.toContain("price");
  });

  it("returns empty signals + low sensitivity for a clean booking call", () => {
    const s = extractCallSignals({ transcript: "Hi, I'd like to book an alignment for Tuesday at 2pm." });
    expect(s.objections).toEqual([]);
    expect(s.competitorMentions).toEqual([]);
    expect(s.priceSensitivity).toBe("low");
  });

  it("is null-safe on an empty transcript", () => {
    expect(extractCallSignals({ transcript: null, summary: null })).toEqual({
      objections: [],
      competitorMentions: [],
      priceSensitivity: "low",
    });
  });
});