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
