import { describe, it, expect, vi, beforeEach } from "vitest";

// The LLM is mocked deliberately: these tests are about what the BOUNDARY does with a
// model's output, not about the model. A fabricated citation has to be rejected whether the
// model is good or bad, and that is the property worth pinning.
vi.mock("../_core/llm", () => ({ invokeLLM: vi.fn() }));

import { invokeLLM } from "../_core/llm";
import {
  extractConversationFacts, MIN_FACT_CONFIDENCE, LOW_LEVEL_DB, type TranscriptSegment,
} from "./conversationFacts";

const SEGMENTS: TranscriptSegment[] = [
  { index: 0, start: 0, end: 4, text: "Hi, the front right tire keeps losing air." },
  { index: 1, start: 4, end: 9, text: "We can patch that, thirty five dollars." },
  { index: 2, start: 9, end: 14, text: "It's a 205/55R16, should take about thirty minutes." },
];

const replyWith = (payload: unknown) =>
  (invokeLLM as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    text: JSON.stringify(payload), model: "test-model",
  });

beforeEach(() => vi.clearAllMocks());

describe("conversation facts — provenance is mandatory", () => {
  it("keeps a fact that cites a real segment, and copies that segment's text onto it", async () => {
    replyWith({ facts: [{ kind: "QUOTE", value: "$35 patch", evidenceSegment: 1, confidence: 0.95 }] });
    const r = await extractConversationFacts(SEGMENTS);
    expect(r.ok).toBe(true);
    expect(r.facts).toHaveLength(1);
    // The evidence text is copied at validation time so a reader never has to re-join the
    // fact back to the transcript to see what it rests on.
    expect(r.facts[0].evidenceText).toBe(SEGMENTS[1].text);
  });

  it("DISCARDS a fact citing a segment that does not exist", async () => {
    // A cited index that is not in the transcript means the model invented its provenance.
    // This is the single most dangerous output shape here: a confident, well-formed,
    // completely unsourced claim.
    replyWith({ facts: [{ kind: "PROMISE", value: "out in 30 minutes", evidenceSegment: 99, confidence: 0.99 }] });
    const r = await extractConversationFacts(SEGMENTS);
    expect(r.facts).toHaveLength(0);
    expect(r.dropped).toContainEqual({ reason: "evidence segment does not exist", count: 1 });
  });

  it("does not repair a bad citation by matching a nearby segment", async () => {
    // "Close enough" matching would hide exactly the failure above.
    replyWith({ facts: [{ kind: "QUOTE", value: "$35", evidenceSegment: 1.7 as unknown as number, confidence: 0.9 }] });
    const r = await extractConversationFacts(SEGMENTS);
    expect(r.facts).toHaveLength(0);
  });
});

describe("conversation facts — a failure must not read as 'nothing was said'", () => {
  it("an LLM error returns ok:false, NOT an empty fact list", async () => {
    (invokeLLM as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("upstream 503"));
    const r = await extractConversationFacts(SEGMENTS);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("503");
    expect(r.facts).toHaveLength(0);
  });

  it("an EMPTY transcript returns ok:true with no facts — a different claim entirely", async () => {
    // "We looked and nobody said anything actionable" vs "we could not look". Both produce
    // zero facts; only one of them is a finding.
    const r = await extractConversationFacts([]);
    expect(r.ok).toBe(true);
    expect(r.error).toBeNull();
    expect(r.facts).toHaveLength(0);
    expect(invokeLLM).not.toHaveBeenCalled();
  });

  it("reports WHY facts were dropped rather than silently shrinking the list", async () => {
    replyWith({ facts: [
      { kind: "QUOTE", value: "$35", evidenceSegment: 1, confidence: 0.2 },
      { kind: "NOT_A_KIND", value: "x", evidenceSegment: 0, confidence: 0.9 },
    ] });
    const r = await extractConversationFacts(SEGMENTS);
    expect(r.facts).toHaveLength(0);
    expect(r.dropped.map((d) => d.reason).sort()).toEqual(["below threshold", "unknown kind"]);
  });
});

describe("conversation facts — a quiet capture caps confidence", () => {
  it("a low-level recording cannot produce a high-confidence quote", async () => {
    // The office camera runs AGC: it ducks for a second or two after a loud transient, so in
    // a tire shop an impact wrench eats the following words. The transcript still reads
    // fluently, which is exactly why fluency cannot be trusted as fidelity.
    replyWith({ facts: [{ kind: "QUOTE", value: "$35 patch", evidenceSegment: 1, confidence: 0.99 }] });
    const r = await extractConversationFacts(SEGMENTS, { meanVolumeDb: LOW_LEVEL_DB - 5 });
    expect(r.facts).toHaveLength(0);
    expect(r.dropped).toContainEqual({ reason: "below threshold (quiet capture)", count: 1 });
  });

  it("the SAME fact survives at a normal level — the cap is not blanket suppression", async () => {
    // Positive control. Without this the test above would pass even if the extractor simply
    // dropped everything, and a permanently-empty extractor would score green.
    replyWith({ facts: [{ kind: "QUOTE", value: "$35 patch", evidenceSegment: 1, confidence: 0.99 }] });
    const r = await extractConversationFacts(SEGMENTS, { meanVolumeDb: -25 });
    expect(r.facts).toHaveLength(1);
    expect(r.facts[0].confidence).toBeGreaterThanOrEqual(MIN_FACT_CONFIDENCE);
  });

  it("an UNKNOWN level is not treated as a quiet one", async () => {
    // A capture whose level was never measured must not be punished as though it were
    // measured and found wanting — that is the same None-is-not-zero rule the capture side
    // enforces, applied one layer up.
    replyWith({ facts: [{ kind: "QUOTE", value: "$35 patch", evidenceSegment: 1, confidence: 0.99 }] });
    const r = await extractConversationFacts(SEGMENTS, { meanVolumeDb: null });
    expect(r.facts).toHaveLength(1);
  });
});
