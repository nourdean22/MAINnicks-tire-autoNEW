/**
 * 2026-10-26 · a long personal message no longer waits on multi-agent timeouts.
 *
 * Live: a long first-person "emotional" message tripped isMultiPartQuestion and
 * the auto-decompose lane spent 54 s on four guardian timeouts (sub 12 s x2,
 * synth 15 s x2: maxRetries 1 each) before falling through to the normal stream.
 * The fixture below is SYNTHETIC (not the operator's words) with the same shape:
 * long narrative, a couple of rhetorical questions, many "and"s.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const h = vi.hoisted(() => ({ runMultiAgent: vi.fn() }));
vi.mock("@/lib/ai/multi-agent-orchestrator", () => ({ runMultiAgent: h.runMultiAgent }));

import { isMultiPartQuestion, runAutoDecompose } from "@/lib/ai/chat/multi-agent-detect";

const JOURNAL = [
  "Yesterday was a strange one and I keep replaying it this morning.",
  "I woke up early and made coffee and sat on the porch for a while, just thinking about the week.",
  "Work was fine but slow, and I came across an old notebook from a few years ago and read some of it.",
  "It made me think about how much has changed and how much has not.",
  "Why do I always wait until the weekend to slow down? And why does it feel like I have to earn a quiet morning?",
  "I talked to a friend later and it helped, and I felt lighter after, but the feeling came back at night.",
  "I want to be more patient with myself and with the people around me, and I want mornings like this one more often.",
].join(" ");

afterEach(() => {
  vi.useRealTimers();
  h.runMultiAgent.mockReset();
});

describe("isMultiPartQuestion stands down on personal turns", () => {
  it("POSITIVE CONTROL · the journaling shape trips the bare detector (the shape that fired live)", () => {
    expect(isMultiPartQuestion(JOURNAL)).toBe(true);
  });

  it("an emotional or reflective turn is never fanned out", () => {
    expect(isMultiPartQuestion(JOURNAL, "emotional")).toBe(false);
    expect(isMultiPartQuestion(JOURNAL, "reflective")).toBe(false);
  });

  it("CONTROL · a real comparison ask still fans out", () => {
    const ask = "Compare the Michelin Defender vs the Goodyear Assurance vs the Bridgestone Turanza for a 2016 Civic.";
    expect(isMultiPartQuestion(ask, "analytical")).toBe(true);
  });
});

describe("runAutoDecompose is bounded on the critical path", () => {
  it("returns '' once its cap passes, even when the orchestrator never settles", async () => {
    vi.useFakeTimers();
    h.runMultiAgent.mockReturnValue(new Promise(() => {}));
    let settled: string | null = null;
    void runAutoDecompose("compare A vs B for my car please").then((s) => {
      settled = s;
    });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(settled).toBe("");
  });

  it("CONTROL · a synthesis that arrives in time is returned", async () => {
    h.runMultiAgent.mockResolvedValue({ synthesis: "synthesised answer", results: [{ failed: false }] });
    await expect(runAutoDecompose("compare A vs B for my car please")).resolves.toBe("synthesised answer");
  });
});
