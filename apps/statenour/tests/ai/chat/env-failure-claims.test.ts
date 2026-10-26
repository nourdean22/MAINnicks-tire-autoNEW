/**
 * 2026-10-26 · a failed tool is not a fabricated claim unless the reply claims it.
 *
 * Live: a reply narrating the operator's own week was bannered "claimed an
 * action (invokeTool) but no matching tool call fired". The verb in the banner
 * was the TOOL NAME: post-persist-verification turned every failed environment
 * check (here a failed read through invokeTool) into a fabricated claim, whatever
 * the prose said. Synthetic prose only.
 */
import { describe, it, expect } from "vitest";
import { envFailureClaims, detectActionClaims } from "@/lib/ai/chat/action-claim-detector";

const FAILED_INVOKE = [{ toolName: "invokeTool", verified: false, reason: "Tool execution failed" }];
const FAILED_CREATE = [{ toolName: "createTask", verified: false, reason: "Task not found in database" }];
const NARRATIVE =
  "The action did go through: the neighbours moved out in the spring and the street felt quieter after. You said the week went by fast.";

describe("envFailureClaims needs the reply to claim the action", () => {
  it("POSITIVE CONTROL · the narrative carries no prose claim of its own", () => {
    expect(detectActionClaims(NARRATIVE).claims).toEqual([]);
  });

  it("narrative about the operator's life with a failed read is NOT a fabricated claim", () => {
    expect(envFailureClaims(FAILED_INVOKE, NARRATIVE)).toEqual([]);
  });

  it("a first-person claim that the failed tool ran IS still flagged", () => {
    expect(envFailureClaims(FAILED_INVOKE, "I ran invokeTool and it succeeded.")).toHaveLength(1);
    expect(envFailureClaims(FAILED_INVOKE, "I've just called `invokeTool` for your sleep data.")).toHaveLength(1);
  });

  it("CONTROL · a write claim whose read-back failed is still flagged", () => {
    expect(envFailureClaims(FAILED_CREATE, "Added the task to your list.")).toEqual([
      expect.objectContaining({ verb: "createTask", expectedTool: "createTask" }),
    ]);
  });

  it("CONTROL · a check that passed or was not run never flags", () => {
    const checks = [
      { toolName: "createTask", verified: true },
      { toolName: "invokeTool", verified: null, reason: "No specific environment verifier exists" },
    ];
    expect(envFailureClaims(checks, "I ran invokeTool and added the task.")).toEqual([]);
  });
});

/**
 * Codex P1 on PR 3296: the narrowing above stopped flagging a failed READ that
 * the reply then answers anyway with an invented result. The prose detector maps
 * domain actions (add, send), not reads, and the prompt tells the model not to
 * mention the invokeTool detour, so neither arm sees it. The read arm correlates
 * the failed read's TARGET with the reply instead. Synthetic prose only.
 */
describe("envFailureClaims · an invented result from a failed read", () => {
  const SLEEP_READ_FAILED = [{ toolName: "invokeTool", verified: false, reason: "Tool execution failed" }];
  const SLEEP_CALL = [{ name: "invokeTool", args: { name: "getSleepSummary", args: {} } }];
  const isRead = (name: string) => name === "sleep.summary";

  it("a declarative sleep result after a failed sleep read through invokeTool IS flagged", () => {
    expect(envFailureClaims(SLEEP_READ_FAILED, "Your sleep streak is five days.", { calls: SLEEP_CALL })).toEqual([
      expect.objectContaining({ verb: "invokeTool", expectedTool: "invokeTool" }),
    ]);
  });

  it("the same reply after a failed DIRECT read (sleep.summary) IS flagged", () => {
    const checks = [{ toolName: "sleep.summary", verified: false, reason: "Tool execution failed" }];
    expect(
      envFailureClaims(checks, "Your sleep streak is five days.", { calls: [{ name: "sleep.summary" }], isRead }),
    ).toHaveLength(1);
  });

  it("a reply that says the read failed stays QUIET", () => {
    expect(envFailureClaims(SLEEP_READ_FAILED, "I couldn't pull your sleep data today.", { calls: SLEEP_CALL })).toEqual([]);
    // Models often write the curly apostrophe.
    const curly = `I couldn${String.fromCharCode(0x2019)}t pull your sleep data today.`;
    expect(envFailureClaims(SLEEP_READ_FAILED, curly, { calls: SLEEP_CALL })).toEqual([]);
  });

  it("an acknowledgment in the NEIGHBOURING sentence also keeps it quiet", () => {
    const text = "The sleep tracker failed to load. Last I saw, your sleep was getting better.";
    expect(envFailureClaims(SLEEP_READ_FAILED, text, { calls: SLEEP_CALL })).toEqual([]);
  });

  it("a question about the domain is not a claim", () => {
    expect(envFailureClaims(SLEEP_READ_FAILED, "Is your sleep streak still five days?", { calls: SLEEP_CALL })).toEqual([]);
  });

  it("LIVE BANNER SHAPE · a reflective narrative after a failed read of an unrelated target stays QUIET", () => {
    const calls = [{ name: "invokeTool", args: { name: "searchEmails", args: { query: "invoice" } } }];
    expect(envFailureClaims(FAILED_INVOKE, NARRATIVE, { calls })).toEqual([]);
  });

  it("CONTROL · the read arm only covers reads: a failed write's keyword in plain prose is left to the prose detector", () => {
    const calls = [{ name: "createTask", args: { title: "sleep log" } }];
    expect(envFailureClaims(FAILED_CREATE, "Your sleep log is long this week.", { calls })).toEqual([]);
  });

  it("CONTROL · passed or unrun reads never flag", () => {
    const checks = [
      { toolName: "invokeTool", verified: true },
      { toolName: "invokeTool", verified: null, reason: "No specific environment verifier exists" },
    ];
    expect(envFailureClaims(checks, "Your sleep streak is five days.", { calls: [...SLEEP_CALL, ...SLEEP_CALL] })).toEqual([]);
  });

  it("CONTROL · a call paired to a different tool name is not used (results pair to calls by index)", () => {
    const calls = [{ name: "getTasks", args: { name: "getSleepSummary" } }];
    expect(envFailureClaims(SLEEP_READ_FAILED, "Your sleep streak is five days.", { calls })).toEqual([]);
  });
});
