import { describe, it, expect } from "vitest";
import { detectChatMode } from "@/lib/ai/chat-mode-detect";
import { pruneTools } from "@/lib/ai/chat-mode";

describe("chat mode behavior and modifications · tools capabilities", () => {
  describe("detectChatMode", () => {
    it("should classify tool capability questions as deep mode", () => {
      expect(detectChatMode("what tools do you have?", 0)).toBe("deep");
      expect(detectChatMode("list your capabilities", 0)).toBe("deep");
      expect(detectChatMode("what functions can you run?", 0)).toBe("deep");
      expect(detectChatMode("what can you do?", 0)).toBe("deep");
    });

    it("should fallback to standard mode for generic casual queries", () => {
      expect(detectChatMode("hello there", 0)).toBe("standard");
      expect(detectChatMode("how is the weather?", 0)).toBe("standard");
    });
  });

  describe("pruneTools", () => {
    const mockTools = {
      getTasks: { description: "Get tasks" },
      createTask: { description: "Create task" },
      getDriftAlerts: { description: "Get drift alerts" },
      getMissions: { description: "Get missions" },
      someOtherTool: { description: "Unrelated tool" },
    };

    it("should force include explicitly mentioned tool names case-insensitively", async () => {
      const pruned = await pruneTools("standard", mockTools, "Can you run getdriftalerts please?");
      expect(pruned).toHaveProperty("getDriftAlerts");
      expect(pruned).not.toHaveProperty("someOtherTool");
    });

    it("should surface a rich set of help tools when querying capabilities", async () => {
      const pruned = await pruneTools("deep", mockTools, "what are your tools?");
      // Should include helpTools that exist in mockTools: getTasks, createTask, getMissions
      expect(pruned).toHaveProperty("getTasks");
      expect(pruned).toHaveProperty("createTask");
      expect(pruned).toHaveProperty("getMissions");
      expect(pruned).not.toHaveProperty("someOtherTool");
    });

    it("always attaches ACTION_CORE writes (createTask, completeTask) even keyword-less (2026-07-06 bug fix)", async () => {
      // Regression: a keyword-less action turn ("ok do it") with no embedding
      // fires neither the Tasks keyword family nor the semantic layer, so
      // pre-fix only read-only CORE_TOOLS survived and the operator couldn't
      // create/complete a task at all. ACTION_CORE now guarantees the two
      // most-used write tools are always reachable; unrelated writes stay pruned.
      const tools = {
        createTask: { description: "Create task" },
        completeTask: { description: "Complete task" },
        getBlindSpots: { description: "read-only" },
        someWriteTool: { description: "unrelated write" },
      };
      const pruned = await pruneTools("standard", tools, "ok do it");
      expect(pruned).toHaveProperty("createTask");
      expect(pruned).toHaveProperty("completeTask");
      expect(pruned).not.toHaveProperty("someWriteTool");
    });
  });
});
