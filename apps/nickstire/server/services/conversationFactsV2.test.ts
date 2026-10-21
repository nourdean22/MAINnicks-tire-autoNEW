/**
 * ears-v2 (job 2026-10-21-shop-ears-v2): the account says what happened with guesses labelled and
 * gaps kept, and "worth knowing" flags survive ONLY when their quote is really in the segment they
 * cite. The provenance rule is enforced here, in code; the prompt only asks for it.
 *
 * invokeLLM is mocked with crafted replies (no network). Transcript lines are short synthetic text.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../_core/llm", () => ({ invokeLLM: vi.fn() }));

import { invokeLLM, type InvokeResult } from "../_core/llm";
import { extractConversationFacts, type TranscriptSegment } from "./conversationFacts";

const llm = invokeLLM as unknown as ReturnType<typeof vi.fn>;
const reply = (content: string): InvokeResult => ({
  id: "test", created: 0, model: "test-model",
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
});
const replyWith = (payload: unknown) => llm.mockResolvedValue(reply(JSON.stringify(payload)));
const NOISE_LINE = "Only shop noise, no speech.";

/** A [BLANK_AUDIO] segment, then a 5 s gap with no words, then a complaint. */
const SEGMENTS: TranscriptSegment[] = [
  { index: 0, start: 0, end: 3, text: "The brakes look fine to me." },
  { index: 1, start: 3, end: 5, text: "[BLANK_AUDIO]" },
  { index: 2, start: 10, end: 13, text: "Honestly, you charge way too much here!" },
];
const GOOD = { coveredSeconds: 12, totalSeconds: 13 };
const flag = (over: Record<string, unknown>) => ({ kind: "NEGATIVE_TALK", evidenceSegment: 2, quote: "you charge way too much", confidence: 0.9, ...over });

beforeEach(() => vi.clearAllMocks());

describe("ears-v2 flags: the quote must be in the cited segment", () => {
  it("(a) a quote that is not in the cited segment is dropped, and the reason is counted", async () => {
    replyWith({ account: "A customer said the prices are too high.", accountSegments: [2], noiseOnly: false, facts: [], flags: [flag({ evidenceSegment: 0 })] });
    const r = await extractConversationFacts(SEGMENTS, GOOD);
    expect(r.facts).toEqual([]);
    expect(r.dropped).toContainEqual({ reason: "flag quote not in cited segment", count: 1 });
  });

  it("(b) a quote carrying '(inferred' is dropped: a flag never rests on a guess", async () => {
    replyWith({ account: "x", accountSegments: [2], noiseOnly: false, facts: [], flags: [flag({ quote: "(inferred: you charge way too much)" })] });
    const r = await extractConversationFacts(SEGMENTS, GOOD);
    expect(r.facts).toEqual([]);
    expect(r.dropped).toContainEqual({ reason: "flag quote is inferred or a gap marker", count: 1 });
  });

  it("(c) a verbatim quote with case and punctuation differences is kept, stored as a fact with the segment's text", async () => {
    replyWith({ account: "x", accountSegments: [2], noiseOnly: false, facts: [], flags: [flag({ quote: "You charge WAY too much." })] });
    const r = await extractConversationFacts(SEGMENTS, GOOD);
    expect(r.facts).toEqual([{
      kind: "NEGATIVE_TALK", value: "You charge WAY too much.", evidenceSegment: 2,
      evidenceText: "Honestly, you charge way too much here!", confidence: 0.9,
    }]);
    expect(r.flagCount).toBe(1);
    // a flag is not a business fact: the evidence-backed summary ignores it
    expect(r.summary).toBeNull();
  });

  it("an unknown flag kind, a missing segment, an empty quote and a gap marker are each dropped by name", async () => {
    replyWith({
      account: "x", accountSegments: [2], noiseOnly: false, facts: [],
      flags: [flag({ kind: "GOSSIP" }), flag({ evidenceSegment: 9 }), flag({ quote: "  " }), flag({ quote: "[gap 4.0 s: no words transcribed]" })],
    });
    const r = await extractConversationFacts(SEGMENTS, GOOD);
    expect(r.facts).toEqual([]);
    expect(r.dropped).toEqual(expect.arrayContaining([
      { reason: "flag unknown kind", count: 1 },
      { reason: "flag evidence segment does not exist", count: 1 },
      { reason: "flag quote empty", count: 1 },
      { reason: "flag quote is inferred or a gap marker", count: 1 },
    ]));
  });

  it("a flag citing a noise segment is dropped: noise lines are never citable", async () => {
    replyWith({ account: "x", accountSegments: [2], noiseOnly: false, facts: [], flags: [flag({ evidenceSegment: 1, quote: "blank audio" })] });
    const r = await extractConversationFacts(SEGMENTS, GOOD);
    expect(r.facts).toEqual([]);
    expect(r.dropped).toContainEqual({ reason: "flag evidence segment does not exist", count: 1 });
  });

  it("the confidence floor is 0.7 for flags: 0.69 dropped, 0.7 kept", async () => {
    replyWith({ account: "x", accountSegments: [2], noiseOnly: false, facts: [], flags: [flag({ confidence: 0.69 }), flag({ kind: "MONEY_OR_DISCOUNT", confidence: 0.7 })] });
    const r = await extractConversationFacts(SEGMENTS, GOOD);
    expect(r.facts.map((f) => f.kind)).toEqual(["MONEY_OR_DISCOUNT"]);
    expect(r.dropped).toContainEqual({ reason: "flag below threshold", count: 1 });
  });

  it("the quiet cap applies to flags (< -55 dBFS caps at 0.6, so a flag cannot pass)", async () => {
    replyWith({ account: "x", accountSegments: [2], noiseOnly: false, facts: [], flags: [flag({})] });
    const r = await extractConversationFacts(SEGMENTS, { ...GOOD, meanVolumeDb: -60 });
    expect(r.facts).toEqual([]);
    expect(r.dropped).toContainEqual({ reason: "flag below threshold (inaudible capture)", count: 1 });
  });
});

describe("ears-v2 account", () => {
  it("(d) noiseOnly true with an account claiming speech stores exactly the noise line, and no facts or flags", async () => {
    replyWith({
      account: "A customer asked about tires.", accountSegments: [2], noiseOnly: true,
      facts: [{ kind: "REQUESTED_WORK", value: "tires", evidenceSegment: 2, confidence: 0.9 }], flags: [flag({})],
    });
    const r = await extractConversationFacts(SEGMENTS, GOOD);
    expect(r.gist).toBe(NOISE_LINE);
    expect(r.noiseOnly).toBe(true);
    expect(r.facts).toEqual([]);
    expect(r.flagCount).toBe(0);
  });

  it("(e) gappy coverage 0.4: the account is kept with its inferred text, a verbatim flag is kept, a business fact is still dropped", async () => {
    replyWith({
      account: "A customer complained about the price (inferred: of a tire quote). [inaudible: banging]",
      accountSegments: [2], noiseOnly: false,
      facts: [{ kind: "QUOTE", value: "too much", evidenceSegment: 2, confidence: 0.9 }],
      flags: [flag({})],
    });
    const r = await extractConversationFacts(SEGMENTS, { coveredSeconds: 4, totalSeconds: 10 });
    expect(r.gist).toBe("A customer complained about the price (inferred: of a tire quote). [inaudible: banging]");
    expect(r.facts.map((f) => f.kind)).toEqual(["NEGATIVE_TALK"]);
    expect(r.dropped).toContainEqual({ reason: "below threshold (transcript coverage too low)", count: 1 });
  });

  it("an account citing no existing speech segment is withheld; one over 1200 chars is cut", async () => {
    replyWith({ account: "Something happened.", accountSegments: [1, 7], noiseOnly: false, facts: [], flags: [] });
    let r = await extractConversationFacts(SEGMENTS, GOOD);
    expect(r.gist).toBeNull();
    expect(r.dropped).toContainEqual({ reason: "account withheld (no existing segment cited)", count: 1 });
    replyWith({ account: "a".repeat(1300), accountSegments: [0], noiseOnly: false, facts: [], flags: [] });
    r = await extractConversationFacts(SEGMENTS, GOOD);
    expect(r.gist).toHaveLength(1200);
  });

  it("a clip of only non-speech tokens is the noise line without a model call", async () => {
    const noise: TranscriptSegment[] = [
      { index: 0, start: 0, end: 4, text: "[BLANK_AUDIO]" },
      { index: 1, start: 4, end: 8, text: " (banging) " },
      { index: 2, start: 8, end: 9, text: "[Music]" },
    ];
    const r = await extractConversationFacts(noise, GOOD);
    expect(llm).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, gist: NOISE_LINE, noiseOnly: true, facts: [] });
  });

  it("a failed extraction is ok:false with no account, never 'only shop noise'", async () => {
    llm.mockRejectedValue(new Error("upstream timeout"));
    const r = await extractConversationFacts(SEGMENTS, GOOD);
    expect(r.ok).toBe(false);
    expect(r.gist).toBeUndefined();
    expect(r.noiseOnly).not.toBe(true);
  });
});

describe("ears-v2 prompt", () => {
  it("(f) the system prompt has no copyable sample account and no 'Small talk'", async () => {
    replyWith({ account: null, accountSegments: [], noiseOnly: false, facts: [], flags: [] });
    await extractConversationFacts(SEGMENTS, GOOD);
    const system = llm.mock.calls[0][0].messages[0].content as string;
    expect(system).not.toMatch(/small talk/i);
    // The only quoted sentence allowed is the fixed noise line the server also enforces.
    const quoted = [...system.matchAll(/"([^"]{12,})"/g)].map((m) => m[1]);
    expect(quoted.every((q) => q === NOISE_LINE)).toBe(true);
    for (const k of ["NEGATIVE_TALK", "CUSTOMER_COMPLAINT", "STAFF_CONFLICT", "SAFETY", "LEAVING_OR_COMPETITOR", "MONEY_OR_DISCOUNT"]) {
      expect(system).toContain(k);
    }
    expect(system).toContain("(inferred:");
    expect(system).toContain("[inaudible:");
  });

  it("(g) the transcript shows the gap line and the noise marker, and neither is numbered", async () => {
    replyWith({ account: null, accountSegments: [], noiseOnly: false, facts: [], flags: [] });
    await extractConversationFacts(SEGMENTS, { ...GOOD, location: "Office" });
    const user = llm.mock.calls[0][0].messages[1].content as string;
    const lines = user.split("\n");
    expect(user).toContain("Microphone: Office");
    expect(lines).toContain("[0] The brakes look fine to me.");
    expect(lines).toContain("[2] Honestly, you charge way too much here!");
    expect(lines).toContain("[gap 5.0 s: no words transcribed]");
    expect(lines).toContain("(noise: [BLANK_AUDIO])");
    expect(lines.some((l) => /^\[1\]/.test(l))).toBe(false);
    // a gap under 2 s gets no line
    expect(lines.filter((l) => l.startsWith("[gap"))).toHaveLength(1);
  });
});
