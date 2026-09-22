/**
 * tests/eval/run-suite-requires-tools.test.ts · the live runner's
 * `requires-tools` skip (2026-09-22).
 *
 * Hermetic: Nick (`aiChat`), the system-prompt builder, the calibration
 * layer and the judge are all mocked — under test is the runner's CONTROL
 * FLOW, not any model's answer. Two assertions carry it:
 *
 *   · a scenario tagged `requires-tools` is skipped with the stated reason,
 *     never sent to Nick or the judge, and counted in summary.skipped —
 *     while the untagged scenario in the same directory still runs (the
 *     positive control: the skip is selective, not "live mode is off");
 *   · the same directory with the tag removed runs BOTH scenarios (the
 *     mutation canary: the tag is the gate, nothing else is).
 *
 * Why this is not in run-suite.test.ts: that file is deliberately mock-free
 * (its header says so); module mocks are file-scoped, so they live here.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above every import, so the spies they close
// over must be hoisted too (a plain `const` would be in its temporal dead
// zone when run-suite.ts's static `./judge` import evaluates the factory).
const { aiChat, judgeResponse, buildSystemPromptUncached, detectTopicTier } = vi.hoisted(() => ({
  aiChat: vi.fn(),
  judgeResponse: vi.fn(),
  buildSystemPromptUncached: vi.fn(),
  detectTopicTier: vi.fn(),
}));

vi.mock("@/lib/ai/provider", () => ({ aiChat }));
vi.mock("@/lib/ai/system-prompt", () => ({ buildSystemPromptUncached, detectTopicTier }));
vi.mock("@/lib/ai/chat/calibration-enforcer", () => ({
  enforceCalibration: async (_ask: string, text: string) => ({ text }),
}));
vi.mock("./judge", () => ({ judgeResponse }));

import { REQUIRES_TOOLS_SKIP_REASON, formatSummaryLine, runLive } from "./run-suite";
import { REQUIRES_TOOLS_TAG } from "./types";

const PLAIN = {
  id: "plain-runs",
  name: "Plain scenario",
  description: "No tool action needed; replays through aiChat.",
  category: "edge",
  input: { messages: [{ role: "user", content: "hi" }] },
  judgeCriteria: [{ id: "is-short", description: "reply is short", weight: 1 }],
};
const TAGGED = {
  ...PLAIN,
  id: "tagged-skips",
  name: "Tool-dependent scenario",
  description: "Dominant criterion needs a real tool action.",
  tags: ["repair-mined", REQUIRES_TOOLS_TAG],
};

const ARGS = { live: true, filter: null, outPath: null } as const;

let dir: string | null = null;
let stdout: { mockRestore(): void } | null = null;

async function writeDir(scenarios: Array<{ id: string } & Record<string, unknown>>): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), "eval-requires-tools-"));
  for (const s of scenarios) {
    await fs.writeFile(path.join(d, `${s.id}.json`), JSON.stringify(s), "utf8");
  }
  return d;
}

beforeEach(() => {
  aiChat.mockReset().mockResolvedValue({ provider: "venice", content: "a reply" });
  buildSystemPromptUncached.mockReset().mockResolvedValue("SYSTEM PROMPT FROM BUILDER");
  detectTopicTier.mockReset().mockReturnValue("business");
  judgeResponse.mockReset().mockImplementation(async (scenario: { id: string }) => ({
    scenarioId: scenario.id,
    responsePreview: "a reply",
    criterionScores: [],
    composite: 8,
    flagForReview: false,
    judgedBy: "mock",
    durationMs: 1,
    error: null,
  }));
  // runLive narrates per scenario on stdout; keep the test output clean.
  stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(async () => {
  stdout?.mockRestore();
  if (dir) await fs.rm(dir, { recursive: true, force: true });
  dir = null;
});

describe("runLive · requires-tools skip", () => {
  it("skips the tagged scenario with the stated reason and still runs the untagged one", async () => {
    dir = await writeDir([PLAIN, TAGGED]);

    const report = await runLive({ args: ARGS, scenariosDir: dir });

    expect(report.skipped).toEqual([{ scenarioId: "tagged-skips", reason: REQUIRES_TOOLS_SKIP_REASON }]);
    expect(REQUIRES_TOOLS_SKIP_REASON).toContain("aiChat");
    expect(report.results.map((r) => r.scenarioId)).toEqual(["plain-runs"]);
    expect(report.summary).toMatchObject({
      totalScenarios: 2,
      ranScenarios: 1,
      skipped: 1,
      passing: 1,
      flagged: 0,
      errored: 0,
    });
    // The skip happened BEFORE Nick: one provider call, one judge call, both
    // for the plain scenario. No spend on an impossible criterion.
    expect(aiChat).toHaveBeenCalledTimes(1);
    expect(judgeResponse).toHaveBeenCalledTimes(1);
    expect(judgeResponse.mock.calls[0]?.[0]).toMatchObject({ id: "plain-runs" });
    expect(formatSummaryLine(report)).toContain(`1 skipped (${REQUIRES_TOOLS_TAG})`);
    expect(formatSummaryLine(report)).toContain("1/2 ran");
  });

  it("mutation canary: with the tag removed, both scenarios run and nothing is skipped", async () => {
    dir = await writeDir([PLAIN, { ...TAGGED, tags: ["repair-mined"] }]);

    const report = await runLive({ args: ARGS, scenariosDir: dir });

    expect(report.skipped).toEqual([]);
    expect(report.results.map((r) => r.scenarioId).sort()).toEqual(["plain-runs", "tagged-skips"]);
    expect(report.summary).toMatchObject({ totalScenarios: 2, ranScenarios: 2, skipped: 0, passing: 2 });
    expect(aiChat).toHaveBeenCalledTimes(2);
    expect(judgeResponse).toHaveBeenCalledTimes(2);
  });

  it("a skip is not a verdict: the exit-code inputs (flagged, errored) stay zero", async () => {
    dir = await writeDir([TAGGED]);

    const report = await runLive({ args: ARGS, scenariosDir: dir });

    expect(report.summary).toMatchObject({ totalScenarios: 1, ranScenarios: 0, skipped: 1, flagged: 0, errored: 0 });
    expect(report.summary.meanComposite).toBe(0);
    expect(aiChat).not.toHaveBeenCalled();
  });
});

describe("runLive · the replay prompt is built the way production builds it (2026-09-22)", () => {
  // The runner passed the literal "lite" as the tier from 2026-05-23 until
  // today. It is not a TopicTier, tests/ is excluded from tsc, and the
  // builder's try/catch would also have hidden a thrown error behind the
  // minimal fallback prompt — so this asserts BOTH halves: the tier comes
  // from production's classifier, and the built prompt (not the fallback)
  // is what reaches Nick.
  it("classifies the last user message with detectTopicTier and sends the built prompt to Nick", async () => {
    dir = await writeDir([PLAIN]);

    await runLive({ args: ARGS, scenariosDir: dir });

    expect(detectTopicTier).toHaveBeenCalledWith("hi");
    expect(buildSystemPromptUncached).toHaveBeenCalledWith("business", "hi");
    const [messages] = aiChat.mock.calls[0] as [Array<{ role: string; content: string }>, string];
    expect(messages[0]).toMatchObject({ role: "system" });
    expect(messages[0]?.content.startsWith("SYSTEM PROMPT FROM BUILDER")).toBe(true);
  });

  it("canary: a builder that throws still yields a reply, on the fallback voice marker — and the test can tell", async () => {
    buildSystemPromptUncached.mockRejectedValue(new Error("brain DB unreachable"));
    dir = await writeDir([PLAIN]);

    const report = await runLive({ args: ARGS, scenariosDir: dir });

    expect(report.summary.errored).toBe(0);
    const [messages] = aiChat.mock.calls[0] as [Array<{ role: string; content: string }>, string];
    expect(messages[0]?.content).toContain("You are Nick");
    expect(messages[0]?.content).not.toContain("SYSTEM PROMPT FROM BUILDER");
  });
});
