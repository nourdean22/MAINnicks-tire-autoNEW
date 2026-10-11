/**
 * Audit 07-SN-06: the multi-output log line carried `subject.slice(0, 60)`,
 * so up to 60 characters of the operator's own words reached the logs on
 * /ab /all /reformat /twopass /carousel turns, Private Lab turns included.
 * The log needs only the shape of the turn, never its text.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/ai/nick-agent", () => ({ ACTION_CATALOG: "catalog" }));
vi.mock("@/app/api/ai/chat/gsc-prefetch", () => ({ buildGscPrefetch: async () => null }));

import { augmentFinalPrompt } from "@/app/api/ai/chat/augment-final-prompt";

function capturingLogger() {
  const calls: unknown[][] = [];
  const rec = (...a: unknown[]) => void calls.push(a);
  return { calls, log: { info: rec, warn: rec, debug: rec, error: rec } };
}

const run = (userContent: string, log: unknown) =>
  augmentFinalPrompt({
    systemPrompt: "sys",
    provider: "ollama",
    greeneSummary: null,
    strategicLawCount: 0,
    userContent,
    contentMode: false,
    turnSignal: { intent: "creative" } as never,
    log: log as never,
  });

describe("augmentFinalPrompt logs no user text", () => {
  it("a multi-output turn logs its mode and subject length, not the subject", async () => {
    const { calls, log } = capturingLogger();
    await run("/ab QQZ7731 launch plan", log);
    const multi = calls.find((c) => c[0] === "multi_output_mode");
    expect(multi).toBeDefined(); // positive control: the line under test really fired
    expect(JSON.stringify(calls)).not.toContain("QQZ7731");
    expect((multi![1] as { subjectChars?: number }).subjectChars).toBeGreaterThan(0);
  });
});
