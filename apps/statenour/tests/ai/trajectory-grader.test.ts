/**
 * tests/ai/trajectory-grader.test.ts · GATE #4.
 *
 * The structural layer is ground truth the judge builds on — its
 * counts must be exact, so those tests are the load-bearing ones. The
 * judge layer's contract: sentinel-checked, clamped, null on garbage,
 * never a phantom grade for an empty trajectory.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyzeTrajectory,
  gradeTrajectory,
  type TrajectoryArgs,
} from "@/lib/ai/trajectory-grader";
import type { CapturedToolCall } from "@/lib/services/chat/tool-telemetry-walk";

vi.mock("@/lib/ai/provider", () => ({ aiChat: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

const call = (
  name: string,
  ok = true,
  durationMs = 100,
  args?: Record<string, unknown>,
): CapturedToolCall => ({ name, ok, durationMs, args });

describe("analyzeTrajectory · structural facts (load-bearing)", () => {
  it("counts an exact redundant call (same name + same args)", () => {
    const s = analyzeTrajectory([
      call("getTasks"),
      call("searchBrain", true, 200, { q: "revenue" }),
      call("getTasks"), // exact repeat — redundant
      call("searchBrain", true, 180, { q: "margins" }), // different args — NOT redundant
    ]);
    expect(s.toolCount).toBe(4);
    expect(s.redundantCount).toBe(1);
  });

  it("pairs a failure with a later same-tool re-fire as recovery", () => {
    const s = analyzeTrajectory([
      call("sendEmail", false, 300),
      call("getTasks"),
      call("sendEmail", true, 250),
    ]);
    expect(s.failedCount).toBe(1);
    expect(s.recoveredCount).toBe(1);
  });

  it("a failure with NO re-fire is unrecovered", () => {
    const s = analyzeTrajectory([call("sendEmail", false, 300), call("getTasks")]);
    expect(s.failedCount).toBe(1);
    expect(s.recoveredCount).toBe(0);
  });

  it("marks failures in the sequence with ✗ so the judge sees them", () => {
    const s = analyzeTrajectory([call("a"), call("b", false)]);
    expect(s.sequence).toEqual(["a", "b✗"]);
  });

  it("sums durations and survives non-finite values", () => {
    const s = analyzeTrajectory([
      call("a", true, 100),
      call("b", true, Number.NaN),
      call("c", true, 50),
    ]);
    expect(s.totalDurationMs).toBe(150);
  });

  it("empty trajectory yields all-zero structure", () => {
    const s = analyzeTrajectory([]);
    expect(s).toEqual({
      toolCount: 0,
      failedCount: 0,
      recoveredCount: 0,
      redundantCount: 0,
      totalDurationMs: 0,
      sequence: [],
    });
  });
});

describe("gradeTrajectory · the judge contract", () => {
  const args: TrajectoryArgs = {
    userQuery: "add the three Bay 5 tasks and text the customer",
    replyText: "Added 3 tasks [tool: createTask ×3]. Text failed — retried and it went through.",
    calls: [
      call("createTask", true, 120, { title: "t1" }),
      call("createTask", true, 110, { title: "t2" }),
      call("createTask", true, 130, { title: "t3" }),
      call("sendSms", false, 400),
      call("sendSms", true, 350),
    ],
  };

  it("returns a clamped 4-axis report with composite = mean", async () => {
    const { aiChat } = await import("@/lib/ai/provider");
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: '{"actionSelection":9,"efficiency":8,"grounding":9,"recovery":10,"reasoning":"clean run, honest retry"}',
      provider: "ollama",
      model: "gpt-oss:120b",
    } as never);

    const r = await gradeTrajectory(args);
    expect(r?.composite).toBe(9);
    expect(r?.rubric.recovery).toBe(10);
    expect(r?.structure.recoveredCount).toBe(1);
    expect(r?.flagForReview).toBe(false);
    expect(r?.judgedBy).toBe("ollama:gpt-oss:120b");
  });

  it("returns null for an empty trajectory — no phantom grades", async () => {
    const { aiChat } = await import("@/lib/ai/provider");
    const r = await gradeTrajectory({ ...args, calls: [] });
    expect(r).toBeNull();
    expect(vi.mocked(aiChat)).not.toHaveBeenCalled();
  });

  it("treats the provider sentinel as failure (the repo gotcha)", async () => {
    const { aiChat } = await import("@/lib/ai/provider");
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "I'm having trouble connecting to my AI providers right now.",
      provider: "emergency",
      model: "none",
    } as never);
    expect(await gradeTrajectory(args)).toBeNull();
  });

  it("returns null on non-JSON judge output", async () => {
    const { aiChat } = await import("@/lib/ai/provider");
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "the trajectory looked fine to me",
      provider: "ollama",
      model: "x",
    } as never);
    expect(await gradeTrajectory(args)).toBeNull();
  });

  it("clamps out-of-range axis values and flags low composites", async () => {
    const { aiChat } = await import("@/lib/ai/provider");
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: '{"actionSelection":15,"efficiency":-3,"grounding":4,"recovery":"bad","reasoning":"messy"}',
      provider: "ollama",
      model: "x",
    } as never);

    const r = await gradeTrajectory(args);
    // 10 + 0 + 4 + 0 = 14 / 4 = 3.5 — flagged
    expect(r?.composite).toBe(3.5);
    expect(r?.rubric.actionSelection).toBe(10);
    expect(r?.rubric.efficiency).toBe(0);
    expect(r?.flagForReview).toBe(true);
  });
});
