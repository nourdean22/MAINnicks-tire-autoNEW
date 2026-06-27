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
  });
});
