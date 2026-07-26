/**
 * The classifier's job is to say what the CALLER wanted. Two ways it can lie:
 * mislabelling (routing a human request to a service flow) and false
 * confidence (`unclear` quietly becoming a catch-all, which is exactly how the
 * binary `serviceMention` looked informative while measuring nothing).
 *
 * Test phrasings are drawn from patterns seen in the real backfilled corpus.
 */
import { describe, it, expect } from "vitest";
import {
  classifyVoiceDemand,
  LOW_CONFIDENCE,
  VOICE_INTENTS,
  type VoiceIntent,
} from "./services/voiceDemandClassifier";

const intentOf = (s: string): VoiceIntent => classifyVoiceDemand(s).intent;

describe("overrides beat the service topic in the same sentence", () => {
  it("routes a human request ahead of the service mentioned with it", () => {
    // The failure this ordering prevents: sending someone who asked for a
    // manager into the brake flow.
    expect(intentOf("I need to talk to a manager about my brakes")).toBe("human_requested");
  });

  it.each([
    "Manager, please.",
    "Can I speak with a manager, please?",
    "just transfer me",
    "connect me to customer service",
    "can I talk to a real person",
  ])("recognises %j as a human request", (s) => {
    expect(intentOf(s)).toBe("human_requested");
  });

  it("routes a comeback to complaint, never to the service price flow", () => {
    expect(intentOf("my brakes are still grinding after you fixed them")).toBe("complaint");
    expect(intentOf("I had work done there two months ago and it came back")).toBe("complaint");
  });

  it("routes an active job to status, not to a new-work flow", () => {
    expect(intentOf("is my car ready yet")).toBe("active_job_status");
    expect(intentOf("how much longer on the truck")).toBe("active_job_status");
  });
});

describe("tires — specific before generic", () => {
  it.each([
    ["how much for a used tire", "used_tire_price"],
    ["you got any used tires for a Malibu", "used_tire_availability"],
    ["I need new tires", "new_tire_quote"],
    ["225 50 17", "tire_size_help"],
    ["what size is my tire", "tire_size_help"],
    ["I got a nail in my tire", "flat_or_puncture"],
    ["my tire pressure light is on", "tpms"],
    ["can you rotate my tires", "tire_service"],
  ])("%j -> %s", (s, want) => {
    expect(intentOf(s)).toBe(want);
  });

  it("does not let the generic tire rule swallow a used-tire ask", () => {
    // tire_service matches "tire" too; priority ordering must keep it second.
    const r = classifyVoiceDemand("how much for a used tire");
    expect(r.intent).toBe("used_tire_price");
    expect(r.secondary).toContain("tire_service");
  });

  it("matches PLURALS — the trailing-\\b bug that bit four times today", () => {
    // /\btire\b/ cannot match "tires"; every stem uses \w* or s?.
    for (const s of ["I need tires", "how much are used tires", "do you have new tires"]) {
      expect(intentOf(s)).not.toBe("unclear");
    }
  });
});

describe("repair", () => {
  it.each([
    ["my car won't start", "no_start"],
    ["it's overheating", "overheating"],
    ["how much for brakes", "brakes"],
    ["my check engine light came on", "check_engine"],
    ["I need an e-check", "echeck"],
    ["how much is an oil change", "oil_change"],
    ["my car pulls to the right", "alignment"],
    ["my ac isn't blowing cold", "ac_heat"],
    ["my exhaust is loud", "exhaust"],
  ])("%j -> %s", (s, want) => {
    expect(intentOf(s)).toBe(want);
  });

  it("assigns safety friction to overheating", () => {
    expect(classifyVoiceDemand("my car is running hot").friction).toBe("safety");
  });

  it("assigns transportation friction to a no-start", () => {
    // The caller's blocker is getting the car TO the shop, not the price.
    expect(classifyVoiceDemand("my car won't start").friction).toBe("transportation");
  });
});

describe("operations and sales", () => {
  it.each([
    ["what time do you close", "hours_location"],
    ["where are you located", "hours_location"],
    ["how long is the wait", "wait_time"],
    ["do I need an appointment", "walk_in_same_day"],
    ["can I drop it off", "drop_off"],
    ["I need it towed", "tow_in"],
    ["do you do financing", "financing"],
    ["another shop quoted me cheaper", "price_comparison"],
    ["are my parts in yet", "parts_eta"],
    ["wrong number", "wrong_number"],
  ])("%j -> %s", (s, want) => {
    expect(intentOf(s)).toBe(want);
  });

  it("catches financing phrasings the SMS router's \\b bug missed for months", () => {
    for (const s of ["do you offer financing?", "can I finance it", "do you take payment plans?"]) {
      expect(intentOf(s)).toBe("financing");
    }
  });
});

describe("`unclear` is a real answer, not a catch-all", () => {
  it.each(["", "  ", "uh", "hello?", "mhm"])("returns unclear for %j", (s) => {
    const r = classifyVoiceDemand(s);
    expect(r.intent).toBe("unclear");
    expect(r.confidence).toBe(0);
  });

  it("returns unclear rather than guessing on genuinely off-topic speech", () => {
    // A catch-all bucket is how a useless label set comes to look informative.
    const r = classifyVoiceDemand("yeah I was calling about the thing from before");
    expect(r.intent).toBe("unclear");
    expect(r.source).toBe("none");
  });

  it("never throws on hostile input", () => {
    for (const bad of [null, undefined, 42 as unknown as string, {} as unknown as string]) {
      expect(() => classifyVoiceDemand(bad)).not.toThrow();
      expect(classifyVoiceDemand(bad).intent).toBe("unclear");
    }
  });
});

describe("confidence is honest about ambiguity", () => {
  it("shades confidence down when several rules compete", () => {
    const many = classifyVoiceDemand("my brakes grind, the check engine light is on, and it won't start");
    expect(many.secondary.length).toBeGreaterThan(1);
    expect(many.confidence).toBeLessThan(0.9);
  });

  it("keeps high confidence on an unambiguous single match", () => {
    expect(classifyVoiceDemand("Manager, please.").confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("exposes a usable low-confidence threshold", () => {
    expect(LOW_CONFIDENCE).toBeGreaterThan(0);
    expect(LOW_CONFIDENCE).toBeLessThan(1);
  });

  it("records which rule fired, so a label can be audited", () => {
    expect(classifyVoiceDemand("how much for brakes").matchedRule).toBe("brakes");
  });
});

describe("taxonomy hygiene", () => {
  it("includes unclear and has no duplicates", () => {
    expect(VOICE_INTENTS).toContain("unclear");
    expect(new Set(VOICE_INTENTS).size).toBe(VOICE_INTENTS.length);
  });

  it("has no `general` catch-all", () => {
    // Directive: do not use "general" as the default for every uncertain call.
    expect(VOICE_INTENTS).not.toContain("general" as VoiceIntent);
  });
});
