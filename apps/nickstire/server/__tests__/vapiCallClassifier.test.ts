import { describe, expect, it } from "vitest";
import {
  classifyCall,
  detectIntents,
  ClassificationInput,
} from "../services/vapiCallClassifier";

describe("vapiCallClassifier · detectIntents", () => {
  it("should match tire-related intents", () => {
    expect(detectIntents("do you have used tires in stock?")).toContain("used_tire");
    expect(detectIntents("i need brand new rubber")).toContain("new_tire");
    expect(detectIntents("what is the price for a 225/60R16 tire?")).toContain("tire_size_request");
    expect(detectIntents("my tire has a slow leak and is losing air")).toContain("tire_leak");
    expect(detectIntents("i ran over a nail and now my tire is flat")).toContain("flat_tire");
  });

  it("should match mechanical and repair intents", () => {
    expect(detectIntents("my brake pads are squeaking and grinding")).toContain("brakes");
    expect(detectIntents("do you do wheel alignments?")).toContain("alignment");
    expect(detectIntents("the engine light came on yesterday")).toContain("check_engine");
    expect(detectIntents("can you scan this noise when it shakes?")).toContain("diagnostics");
    expect(detectIntents("i need a synthetic oil change service")).toContain("oil_change");
    expect(detectIntents("my car wont start, just clicking")).toContain("starter");
    expect(detectIntents("can you test my battery and alternator?")).toContain("battery");
    expect(detectIntents("can you test my battery and alternator?")).toContain("alternator");
  });

  it("should match hours, location, and finance intents", () => {
    expect(detectIntents("are you open tomorrow? where is your shop located?")).toContain("hours_location");
    expect(detectIntents("do you accept easy pay or snap finance?")).toContain("financing");
  });

  it("should support multiple concurrent intents", () => {
    const text = "my brakes are squeaking and i also need an oil change.";
    const matches = detectIntents(text);
    expect(matches).toContain("brakes");
    expect(matches).toContain("oil_change");
  });
});

describe("vapiCallClassifier · classifyCall outcomes", () => {
  it("classifies abandoned calls correctly", () => {
    // Duration <= 5s
    const res1 = classifyCall({
      durationSeconds: 4,
      endedReason: "customer-hungup",
      aiSummary: "The user hung up.",
      transcript: "Hello?",
    });
    expect(res1.outcome).toBe("abandoned_before_connect");
    expect(res1.score).toBeNull();

    // Ended reason matches hungup/ringing
    const res2 = classifyCall({
      durationSeconds: 12,
      endedReason: "caller-hungup",
      aiSummary: "",
      transcript: "",
    });
    expect(res2.outcome).toBe("abandoned_before_connect");

    // Empty transcript, not forwarded
    const res3 = classifyCall({
      durationSeconds: 15,
      endedReason: "customer-busy",
      aiSummary: null,
      transcript: null,
    });
    expect(res3.outcome).toBe("abandoned_before_connect");

    // REGRESSION: a sub-2s hangup with NO spoken words is a misdial / robocall, not a
    // real abandon (verified against prod: 81% of "abandons" hang up in <=1s at avg 0.7s).
    // It must route to the junk bucket so abandoned_before_connect means a real lost caller.
    const misdial = classifyCall({
      durationSeconds: 1,
      endedReason: "customer-hungup",
      aiSummary: "The user hung up immediately.",
      transcript: "",
    });
    expect(misdial.outcome).toBe("spam_or_wrong_number");
  });

  it("classifies spam and wrong numbers correctly", () => {
    const res1 = classifyCall({
      durationSeconds: 30,
      endedReason: "customer-hungup",
      aiSummary: "This was a telemarketing call.",
      transcript: "Hello, we are calling about your credit card debt protection plans.",
    });
    expect(res1.outcome).toBe("spam_or_wrong_number");
    expect(res1.score).toBeNull();

    // Short greeting only
    const res2 = classifyCall({
      durationSeconds: 10,
      endedReason: "customer-hungup",
      aiSummary: "Caller said hello and hung up.",
      transcript: "hello",
    });
    expect(res2.outcome).toBe("spam_or_wrong_number");
  });

  it("classifies tech failures correctly", () => {
    const res1 = classifyCall({
      durationSeconds: 15,
      endedReason: "silence-timed-out",
      aiSummary: "",
      transcript: "",
    });
    expect(res1.outcome).toBe("tech_failure");
    expect(res1.score).toBeNull();

    const res2 = classifyCall({
      durationSeconds: 10,
      endedReason: "normal-hangup",
      aiSummary: "The connection had websocket closed error.",
      transcript: "websocket closed abnormally",
    });
    expect(res2.outcome).toBe("tech_failure");
  });

  it("classifies hard conversions correctly", () => {
    const res1 = classifyCall({
      durationSeconds: 50,
      endedReason: "normal-hangup",
      aiSummary: "Booked a service.",
      transcript: "I scheduled an alignment.",
      convertedToLead: 1,
    });
    expect(res1.outcome).toBe("hard_conversion");
    expect(res1.score).toBe(95 + 5); // 95 base + 5 productive duration = 100 max

    const res2 = classifyCall({
      durationSeconds: 40,
      endedReason: "normal-hangup",
      aiSummary: "Left a callback request.",
      transcript: "Okay see you.",
      reachedTool: true,
    });
    expect(res2.outcome).toBe("hard_conversion");
  });

  it("classifies human handoffs correctly", () => {
    const res = classifyCall({
      durationSeconds: 45,
      endedReason: "assistant-forwarded-call",
      aiSummary: "Forwarded call to the desk.",
      transcript: "Hold on transferring you now.",
    });
    expect(res.outcome).toBe("human_handoff");
    expect(res.score).toBe(80 + 5); // 80 base + 5 productive duration
  });

  it("classifies walk-in directed outcomes correctly", () => {
    const res = classifyCall({
      durationSeconds: 60,
      endedReason: "customer-hungup",
      aiSummary: "Told customer to swing by Euclid Ave.",
      transcript: "Yeah, just swing by our shop on Euclid Ave.",
    });
    expect(res.outcome).toBe("walk_in_directed");
    expect(res.score).toBe(85 + 5); // 85 base + 5 productive duration
  });

  it("classifies callbacks correctly", () => {
    const res = classifyCall({
      durationSeconds: 40,
      endedReason: "customer-hungup",
      aiSummary: "Customer requested a callback.",
      transcript: "Please call me back when someone is free.",
    });
    expect(res.outcome).toBe("callback_needed");
  });

  it("classifies tire availability and quote intents correctly", () => {
    const res1 = classifyCall({
      durationSeconds: 50,
      endedReason: "customer-hungup",
      aiSummary: "Customer asked if we have pre owned tires.",
      transcript: "Do you have pre owned tires for a Civic?",
    });
    expect(res1.outcome).toBe("tire_availability_intent");

    const res2 = classifyCall({
      durationSeconds: 50,
      endedReason: "customer-hungup",
      aiSummary: "Customer asked for brake pad replacement price.",
      transcript: "How much does it cost to get brake pads replaced?",
    });
    expect(res2.outcome).toBe("quote_or_inspection_intent");
  });

  it("classifies resolved basic info correctly", () => {
    const res = classifyCall({
      durationSeconds: 20,
      endedReason: "customer-hungup",
      aiSummary: "Customer asked for open hours.",
      transcript: "What time do you close?",
    });
    expect(res.outcome).toBe("resolved_info");
  });

  it("classifies lost opportunities correctly", () => {
    const res = classifyCall({
      durationSeconds: 40,
      endedReason: "customer-hungup",
      aiSummary: "Customer mentioned needing general auto service but hung up.",
      transcript: "I need to fix my car, but I have to go now.",
    });
    expect(res.outcome).toBe("lost_opportunity");
  });
});

describe("vapiCallClassifier · score modifiers", () => {
  it("applies positive sentiment and productive duration modifiers", () => {
    const res = classifyCall({
      durationSeconds: 40,
      endedReason: "customer-hungup",
      aiSummary: "Customer got hours and was happy.",
      transcript: "Thank you so much! Great support.",
      sentiment: "positive",
    });
    expect(res.outcome).toBe("resolved_info");
    // resolved_info base = 75
    // sentiment=positive = +5
    // duration 40s (30s-180s) = +5
    // total = 85
    expect(res.score).toBe(85);
  });

  it("applies negative sentiment and long duration modifiers", () => {
    const res = classifyCall({
      durationSeconds: 400,
      endedReason: "customer-hungup",
      aiSummary: "Customer was upset about prices.",
      transcript: "This is way too expensive, unbelievable.",
      sentiment: "negative",
    });
    expect(res.outcome).toBe("quote_or_inspection_intent"); // matched "price" / pricing_question but falling back to quote/repair intent
    // base = 60 (for quote_or_inspection_intent)
    // sentiment=negative = -10
    // duration 400s (>300s) = -5
    // total = 45
    expect(res.score).toBe(45);
  });
});
