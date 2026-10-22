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
      // the HEARD words, not the model's casing or punctuation (skeptic review of #3213)
      kind: "NEGATIVE_TALK", value: "you charge way too much", evidenceSegment: 2,
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
    // A clip the server also hears no words in: a filler and a blank. The model's fact and flag
    // do not survive (noise citation, quote not heard), so its noiseOnly is honoured.
    const fillerOnly: TranscriptSegment[] = [
      { index: 0, start: 0, end: 2, text: "Uh." },
      { index: 1, start: 2, end: 5, text: "[BLANK_AUDIO]" },
    ];
    replyWith({
      account: "A customer asked about tires.", accountSegments: [0], noiseOnly: true,
      facts: [{ kind: "REQUESTED_WORK", value: "tires", evidenceSegment: 1, confidence: 0.9 }], flags: [flag({ evidenceSegment: 0 })],
    });
    const r = await extractConversationFacts(fillerOnly, GOOD);
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

describe("Codex review of #3213", () => {
  it("P1-a: a business fact citing a hidden noise segment is dropped, never stored with noise as evidence", async () => {
    replyWith({ account: "x", accountSegments: [2], noiseOnly: false, facts: [{ kind: "REQUESTED_WORK", value: "tires", evidenceSegment: 1, confidence: 0.95 }], flags: [] });
    const r = await extractConversationFacts(SEGMENTS, GOOD);
    expect(r.facts).toEqual([]);
    expect(r.dropped).toContainEqual({ reason: "evidence segment does not exist", count: 1 });
  });

  it("P2-a: the schema requires every ears-v2 field, and a reply missing any is a FAILED extraction, never 'no flags'", async () => {
    replyWith({ facts: [] });
    const r = await extractConversationFacts(SEGMENTS, GOOD);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/missing ears-v2 fields: account, accountSegments, noiseOnly, flags/);
    expect(r.gist).toBeUndefined();
    const schema = llm.mock.calls[0][0].outputSchema.schema as { required: string[] };
    expect(schema.required).toEqual(expect.arrayContaining(["facts", "account", "accountSegments", "noiseOnly", "flags"]));

    replyWith({ facts: [], account: null, accountSegments: [], noiseOnly: false });
    const noFlags = await extractConversationFacts(SEGMENTS, GOOD);
    expect(noFlags).toMatchObject({ ok: false, error: expect.stringContaining("flags") });

    // CONTROL: every field present, account null, is a successful empty extraction
    replyWith({ facts: [], account: null, accountSegments: [], noiseOnly: false, flags: [] });
    expect((await extractConversationFacts(SEGMENTS, GOOD)).ok).toBe(true);
  });

  it("P2-b: a long account is never cut inside an open (inferred: ...) guess", async () => {
    const head = "w".repeat(1180) + " ";
    replyWith({ account: `${head}(inferred: the customer was comparing prices with another shop down the street)`, accountSegments: [2], noiseOnly: false, facts: [], flags: [] });
    const r = await extractConversationFacts(SEGMENTS, GOOD);
    expect(r.gist!.length).toBeLessThanOrEqual(1200);
    expect(r.gist!.endsWith(" (cut)")).toBe(true);
    expect(r.gist).not.toContain("(inferred:");
  });

  it("P2-b: and never inside an open [inaudible: ...] stretch; a closed marker before the cut stays", async () => {
    const head = "Someone asked about tires (inferred: winter ones). " + "w".repeat(1120) + " ";
    replyWith({ account: `${head}[inaudible: a long burst of impact wrench noise drowned the rest of it]`, accountSegments: [2], noiseOnly: false, facts: [], flags: [] });
    const r = await extractConversationFacts(SEGMENTS, GOOD);
    expect(r.gist!.length).toBeLessThanOrEqual(1200);
    expect(r.gist!.endsWith(" (cut)")).toBe(true);
    expect(r.gist).not.toContain("[inaudible:");
    expect(r.gist).toContain("(inferred: winter ones)");
  });

  it("P2-b CONTROL: an account within 1200 chars is untouched", async () => {
    replyWith({ account: "Short (inferred: fine). [inaudible: bang]", accountSegments: [2], noiseOnly: false, facts: [], flags: [] });
    expect((await extractConversationFacts(SEGMENTS, GOOD)).gist).toBe("Short (inferred: fine). [inaudible: bang]");
  });

  it("P2-c: a flag's evidenceSegment must be an integer, not null, empty, false or a numeric string", async () => {
    for (const bad of [null, "", false, "2", 2.5]) {
      replyWith({ account: null, accountSegments: [], noiseOnly: false, facts: [], flags: [flag({ evidenceSegment: bad })] });
      const r = await extractConversationFacts(SEGMENTS, GOOD);
      expect(r.facts, `evidenceSegment ${JSON.stringify(bad)}`).toEqual([]);
    }
  });

  it("P2-c: accountSegments must be integers: [null] or [\"0\"] does not cite segment 0", async () => {
    for (const bad of [[null], ["0"], [false]]) {
      replyWith({ account: "Someone talked.", accountSegments: bad, noiseOnly: false, facts: [], flags: [] });
      const r = await extractConversationFacts(SEGMENTS, GOOD);
      expect(r.gist, JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("skeptic review of #3213", () => {
  it("S2: the stored flag value is the heard slice, never the model's string", async () => {
    const segs: TranscriptSegment[] = [{ index: 0, start: 0, end: 3, text: "Yeah I can do 20 off cash, no receipt." }];
    replyWith({ account: null, accountSegments: [], noiseOnly: false, facts: [], flags: [{ kind: "MONEY_OR_DISCOUNT", evidenceSegment: 0, quote: "I can do 20% off, $cash", confidence: 0.9 }] });
    const r = await extractConversationFacts(segs, { coveredSeconds: 3, totalSeconds: 3 });
    expect(r.facts).toHaveLength(1);
    expect(r.facts[0].value).toBe("I can do 20 off cash");
    expect(r.facts[0].value).not.toMatch(/[%$]/);
  });

  it("S2: a quote cannot match inside a sound tag", async () => {
    const segs: TranscriptSegment[] = [{ index: 0, start: 0, end: 3, text: "(door slams) I'm leaving now" }];
    replyWith({ account: null, accountSegments: [], noiseOnly: false, facts: [], flags: [{ kind: "LEAVING_OR_COMPETITOR", evidenceSegment: 0, quote: "door slams I'm leaving", confidence: 0.9 }] });
    const r = await extractConversationFacts(segs, { coveredSeconds: 3, totalSeconds: 3 });
    expect(r.facts).toEqual([]);
    expect(r.dropped).toContainEqual({ reason: "flag quote not in cited segment", count: 1 });
    // CONTROL: the words outside the tag still match
    replyWith({ account: null, accountSegments: [], noiseOnly: false, facts: [], flags: [{ kind: "LEAVING_OR_COMPETITOR", evidenceSegment: 0, quote: "I'm leaving", confidence: 0.9 }] });
    expect((await extractConversationFacts(segs, { coveredSeconds: 3, totalSeconds: 3 })).facts.map((f) => f.value)).toEqual(["I'm leaving"]);
  });

  it("S3: noiseOnly from the model is ignored when the server heard words; the surviving flag and the account stand", async () => {
    replyWith({ account: "A customer said the prices are too high.", accountSegments: [2], noiseOnly: true, facts: [], flags: [flag({})] });
    const r = await extractConversationFacts(SEGMENTS, GOOD);
    expect(r.noiseOnly).toBe(false);
    expect(r.gist).toBe("A customer said the prices are too high.");
    expect(r.facts.map((f) => f.kind)).toEqual(["NEGATIVE_TALK"]);
    expect(r.dropped).toContainEqual({ reason: "noiseOnly ignored (the server kept facts or heard words)", count: 1 });
  });

  it("S3: noiseOnly is ignored even with nothing kept, when a segment holds real words", async () => {
    replyWith({ account: null, accountSegments: [], noiseOnly: true, facts: [], flags: [] });
    const r = await extractConversationFacts(SEGMENTS, GOOD);
    expect(r.noiseOnly).toBe(false);
    expect(r.gist).toBeNull();
  });

  it("S5: a bracketed speaker line is speech, so it reaches the model numbered and is citable", async () => {
    const segs: TranscriptSegment[] = [{ index: 0, start: 0, end: 3, text: "(Customer: I'm going to Firestone)" }];
    replyWith({ account: null, accountSegments: [], noiseOnly: false, facts: [], flags: [{ kind: "LEAVING_OR_COMPETITOR", evidenceSegment: 0, quote: "going to Firestone", confidence: 0.9 }] });
    const r = await extractConversationFacts(segs, { coveredSeconds: 3, totalSeconds: 3 });
    expect(llm).toHaveBeenCalledTimes(1);
    expect(r.facts.map((f) => f.value)).toEqual(["going to Firestone"]);
  });
});
describe("ears-v2 output budget: reasoning must not eat the answer", () => {
  // Live probe 2026-10-22 against deepseek-v4-pro (the prod Ollama lane): at llm.ts's default
  // max_tokens 4096 the reply came back finish_reason=length with 0 content chars, every token
  // spent on reasoning; at 16384 it finished with 2,326 content chars. A 120 s office episode
  // failed in production the same way ("LLM returned no content for fact extraction").
  const VALID = { account: "A customer asked about the brakes.", accountSegments: [0], noiseOnly: false, facts: [], flags: [] };
  const empty = (): InvokeResult => ({ ...reply(""), choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "length" }] });
  const budgetOf = (call: number) => (llm.mock.calls[call][0] as { maxTokens?: number }).maxTokens;

  beforeEach(() => llm.mockReset());

  it("the extraction call carries its own budget, well above the 4096 default", async () => {
    replyWith(VALID);
    const r = await extractConversationFacts(SEGMENTS, GOOD);
    expect(r.ok).toBe(true);
    expect(budgetOf(0)).toBeGreaterThanOrEqual(16_384);
  });

  it("an empty reply is retried once with a bigger budget, and the account is kept", async () => {
    llm.mockResolvedValueOnce(empty()).mockResolvedValueOnce(reply(JSON.stringify(VALID)));
    const r = await extractConversationFacts(SEGMENTS, GOOD);
    expect(llm).toHaveBeenCalledTimes(2);
    expect(budgetOf(1)).toBeGreaterThan(budgetOf(0) ?? 0);
    expect(r.ok).toBe(true);
    expect(r.gist).toBe(VALID.account);
  });

  it("two empty replies fail honestly after exactly one retry", async () => {
    llm.mockResolvedValueOnce(empty()).mockResolvedValueOnce(empty());
    const r = await extractConversationFacts(SEGMENTS, GOOD);
    expect(llm).toHaveBeenCalledTimes(2);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no content/);
  });

  it("both attempts share one deadline under the worker's 120 s post timeout", async () => {
    llm.mockResolvedValueOnce(empty()).mockResolvedValueOnce(reply(JSON.stringify(VALID)));
    await extractConversationFacts(SEGMENTS, GOOD);
    const timeoutOf = (call: number) => (llm.mock.calls[call][0] as { timeoutMs: number }).timeoutMs;
    // a long reasoning reply needs more than the old 60 s, but the pair must end inside 120 s
    expect(timeoutOf(0)).toBeGreaterThan(60_000);
    expect(timeoutOf(0)).toBeLessThan(120_000);
    expect(timeoutOf(1)).toBeLessThanOrEqual(timeoutOf(0));
  });

  it("no retry when too little of the deadline is left to finish one", async () => {
    llm.mockResolvedValueOnce(empty()).mockResolvedValueOnce(reply(JSON.stringify(VALID)));
    const r = await extractConversationFacts(SEGMENTS, { ...GOOD, timeoutMs: 10_000 });
    expect(llm).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(false);
  });

  it("a reply with content is never retried", async () => {
    replyWith(VALID);
    await extractConversationFacts(SEGMENTS, GOOD);
    expect(llm).toHaveBeenCalledTimes(1);
  });
});
