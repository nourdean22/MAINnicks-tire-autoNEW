/**
 * Customer-only turn extraction — the instrument that unblocks demand measurement.
 *
 * The 2026-07-26 audit could not answer "what do callers actually want?" because
 * every signal was assistant-contaminated: `serviceMention` is binary, `aiSummary`
 * is written by a tire-first assistant, and `transcriptUrl` is set on 0 of 2,095
 * rows. The one rule that makes this module worth anything: NEVER let assistant
 * speech be counted as customer demand. Most of these tests defend that.
 */
import { describe, it, expect } from "vitest";
import {
  extractCustomerTurns,
  buildCustomerSpeechRecord,
  MAX_TURNS,
  MAX_TURN_CHARS,
  CUSTOMER_SPEECH_VERSION,
} from "./services/customerTurns";

const TRANSCRIPT = [
  "AI: Thanks for calling Nick's Tire and Auto, what can I do for you?",
  "User: yeah I need a used tire for my Malibu",
  "AI: Sure — what size is on the sidewall?",
  "User: uh",
  "User: I think it says 225 50 17",
  "AI: Got it. Are you looking for one or a pair?",
  "User: just one for now",
].join("\n");

describe("assistant speech is never counted as customer demand", () => {
  it("keeps only the customer's turns", () => {
    const r = extractCustomerTurns(TRANSCRIPT);
    expect(r.turns).toEqual([
      "yeah I need a used tire for my Malibu",
      "uh",
      "I think it says 225 50 17",
      "just one for now",
    ]);
    expect(r.turns.join(" ")).not.toMatch(/Thanks for calling|sidewall|one or a pair/);
  });

  it("returns NOTHING when speakers cannot be told apart", () => {
    // A transcript with no prefixes is unattributable. Emitting its text as
    // customer speech would reintroduce exactly the contamination this module
    // exists to remove — so refuse, and say so.
    const r = extractCustomerTurns("we have your size in stock most days, come on by");
    expect(r.turns).toEqual([]);
    expect(r.unparsed).toBe(true);
  });

  it.each(["Customer", "Human", "Caller", "user", "USER"])("recognises the %s prefix", (p) => {
    expect(extractCustomerTurns(`AI: hi\n${p}: I need a brake quote please`).turns).toEqual([
      "I need a brake quote please",
    ]);
  });
});

describe("firstSubstantive — the field demand classification reads", () => {
  it("skips filler and returns the real request", () => {
    // "yeah"/"uh"/"ok" are real conversational moves that say nothing about what
    // the caller wants; treating one as the request would mislabel the call.
    expect(extractCustomerTurns(TRANSCRIPT).firstSubstantive).toBe("yeah I need a used tire for my Malibu");
  });

  it.each(["yeah", "ok", "uh huh", "hello", "thanks", "no"])("never treats %j as the request", (filler) => {
    const r = extractCustomerTurns(`AI: hi\nUser: ${filler}\nUser: my car is making a grinding noise`);
    expect(r.firstSubstantive).toBe("my car is making a grinding noise");
  });

  it("is null when the customer only ever said filler", () => {
    expect(extractCustomerTurns("AI: hello?\nUser: yeah\nUser: ok").firstSubstantive).toBeNull();
  });
});

describe("bounded storage", () => {
  it("caps the number of stored turns but reports the true count", () => {
    const many = ["AI: hi", ...Array.from({ length: 30 }, (_, i) => `User: request number ${i}`)].join("\n");
    const r = extractCustomerTurns(many);
    expect(r.turns).toHaveLength(MAX_TURNS);
    expect(r.totalCustomerTurns).toBe(30); // truth preserved even though storage is capped
  });

  it("truncates an overlong turn", () => {
    const r = extractCustomerTurns(`AI: hi\nUser: ${"x".repeat(900)}`);
    expect(r.turns[0]!.length).toBeLessThanOrEqual(MAX_TURN_CHARS + 1); // +1 for the ellipsis
  });

  it("joins a multi-line customer turn instead of splitting it", () => {
    const r = extractCustomerTurns("AI: hi\nUser: I need a tire\nfor my 2017 Malibu\nAI: what size?");
    expect(r.turns).toEqual(["I need a tire for my 2017 Malibu"]);
  });
});

describe("buildCustomerSpeechRecord", () => {
  it("versions the record so a later parser change stays comparable", () => {
    const rec = buildCustomerSpeechRecord(TRANSCRIPT)!;
    expect(rec.v).toBe(CUSTOMER_SPEECH_VERSION);
    expect(rec.first).toBe("yeah I need a used tire for my Malibu");
    expect(rec.turnCount).toBe(4);
  });

  it("writes nothing when there is nothing usable", () => {
    // An empty key would later read as "this call had no customer speech"
    // rather than "there was no transcript" — two very different facts.
    expect(buildCustomerSpeechRecord("")).toBeNull();
    expect(buildCustomerSpeechRecord(null)).toBeNull();
    expect(buildCustomerSpeechRecord(undefined)).toBeNull();
  });

  it("DOES record an unparsed transcript, so the gap is visible", () => {
    const rec = buildCustomerSpeechRecord("no speaker prefixes here at all")!;
    expect(rec.unparsed).toBe(true);
    expect(rec.turns).toEqual([]);
  });

  it("never throws on hostile input — it runs inside a webhook", () => {
    for (const bad of [42, {}, [], true, "\n\n\n", "AI:", "User:"]) {
      expect(() => buildCustomerSpeechRecord(bad)).not.toThrow();
    }
  });
});
