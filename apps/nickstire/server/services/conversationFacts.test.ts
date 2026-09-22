import { describe, it, expect, vi, beforeEach } from "vitest";

// The LLM is mocked deliberately: these tests are about what the BOUNDARY does with a
// model's output, not about the model. A fabricated citation has to be rejected whether the
// model is good or bad, and that is the property worth pinning.
vi.mock("../_core/llm", () => ({ invokeLLM: vi.fn() }));

import { invokeLLM } from "../_core/llm";
import { extractConversationFacts, type TranscriptSegment } from "./conversationFacts";

// The thresholds are NOT imported. They are module-private, and a test that reads the constant
// and compares it to itself passes even when the extractor ignores it -- presence, not
// behaviour. Every threshold below is asserted through extractConversationFacts() instead, at
// the measured values that motivated it.

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

describe("conversation facts — coverage gates confidence, level barely does", () => {
  it("a GAPPY transcript cannot produce a high-confidence quote", async () => {
    // MEASURED 2026-09-22: a 90s office sample returned text for 37.4s and nothing for
    // 50.0s. The unrecovered stretches carried NORMAL conversational energy (-16.7 to
    // -31.2 dB) — the loudest 4.4s in the clip produced zero words. What came back was
    // incoherent ("they talk about a way"), which is a model guessing. Coverage is the
    // signal that catches this; level is not.
    replyWith({ facts: [{ kind: "QUOTE", value: "$35 patch", evidenceSegment: 1, confidence: 0.99 }] });
    const r = await extractConversationFacts(SEGMENTS, { coveredSeconds: 37.4, totalSeconds: 90 });
    expect(r.facts).toHaveLength(0);
    expect(r.dropped).toContainEqual({ reason: "below threshold (transcript coverage too low)", count: 1 });
  });

  it("the SAME fact survives at good coverage — the gate is not blanket suppression", async () => {
    // Positive control. Without it the test above passes even if the extractor simply drops
    // everything, and a permanently-empty extractor would score green.
    replyWith({ facts: [{ kind: "QUOTE", value: "$35 patch", evidenceSegment: 1, confidence: 0.99 }] });
    const r = await extractConversationFacts(SEGMENTS, { coveredSeconds: 85, totalSeconds: 90 });
    expect(r.facts).toHaveLength(1);
    // The confidence survives UNCAPPED. Both gates clamp to 0.6, so an intact 0.99 is proof
    // neither one fired -- a stronger claim than "it cleared the bar".
    expect(r.facts[0].confidence).toBe(0.99);
  });

  it("LOUD audio does NOT earn confidence — level is not intelligibility", async () => {
    // The refuted heuristic, pinned so it cannot come back. This recording is loud AND
    // gappy, exactly like the real sample; a level-only gate would wave it straight through.
    replyWith({ facts: [{ kind: "PROMISE", value: "out in 30 minutes", evidenceSegment: 2, confidence: 0.99 }] });
    const r = await extractConversationFacts(SEGMENTS, {
      meanVolumeDb: -20, coveredSeconds: 37.4, totalSeconds: 90,
    });
    expect(r.facts).toHaveLength(0);
  });

  it("UNMEASURED coverage leaves the gate OFF rather than assuming the worst", async () => {
    // A clip whose timings were never reported must not be punished as though it had been
    // measured and failed — the same None-is-not-zero rule the capture side enforces.
    replyWith({ facts: [{ kind: "QUOTE", value: "$35 patch", evidenceSegment: 1, confidence: 0.99 }] });
    const r = await extractConversationFacts(SEGMENTS, { coveredSeconds: null, totalSeconds: null });
    expect(r.facts).toHaveLength(1);
  });

  it("a genuinely INAUDIBLE capture still caps, at the lowered threshold", async () => {
    replyWith({ facts: [{ kind: "QUOTE", value: "$35 patch", evidenceSegment: 1, confidence: 0.99 }] });
    // -60 dBFS, five below the cap. Written as a literal because the test's job is to fix
    // WHERE the cap sits; deriving it from the constant would move the test with the code.
    const r = await extractConversationFacts(SEGMENTS, { meanVolumeDb: -60 });
    expect(r.facts).toHaveLength(0);
    expect(r.dropped).toContainEqual({ reason: "below threshold (inaudible capture)", count: 1 });
  });

  it("the threshold sits BETWEEN the measured failure and a healthy transcript", async () => {
    // The boundary walked through the real function. 37.4/90 = 0.416 is the sample that
    // produced incoherent text and must yield nothing; 81/90 = 0.90 is a healthy transcript
    // and must yield the fact. Asserting the flip happens somewhere in between pins the
    // threshold to the EVIDENCE without pinning it to a number -- retuning it on better data
    // is then a one-line change here, not a rewrite.
    const at = async (covered: number) => {
      replyWith({ facts: [{ kind: "QUOTE", value: "$35 patch", evidenceSegment: 1, confidence: 0.99 }] });
      return (await extractConversationFacts(SEGMENTS, { coveredSeconds: covered, totalSeconds: 90 })).facts.length;
    };
    expect(await at(37.4)).toBe(0);
    expect(await at(81)).toBe(1);
  });
});
