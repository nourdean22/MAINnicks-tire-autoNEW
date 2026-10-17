import { describe, it, expect } from "vitest";
import { trimPromptToBudget } from "@/lib/ai/system-prompt";
import { DECISION_MODE_ASK } from "@/lib/ai/prompt/policy/decision-mode";

describe("trimPromptToBudget", () => {
  it("passes prompt through untouched if under limit", () => {
    const prompt = "## IDENTITY\nHello operator.\n## COMMAND STATE\nNo active commands.";
    expect(trimPromptToBudget(prompt, 1000)).toBe(prompt);
  });

  it("drops lowest-priority sections first if over limit", () => {
    const prompt = [
      "## IDENTITY\nAlways stay in character.",
      "## COMMAND STATE\nActive task: none.",
      "## RECENT REFLECTIONS\nNour is working hard.",
      "## CHATGPT ARCHIVE\nSome historical data here.",
    ].join("\n");

    // Total length is ~135 characters. If we cap at 100, the trimmer should drop:
    // 1. ## CHATGPT ARCHIVE (priority 23 - lowest)
    // 2. ## RECENT REFLECTIONS (priority 21)
    // and keep:
    // 3. ## IDENTITY (priority 1)
    // 4. ## COMMAND STATE (priority 3)
    const trimmed = trimPromptToBudget(prompt, 100);

    expect(trimmed).toContain("## IDENTITY");
    expect(trimmed).toContain("## COMMAND STATE");
    expect(trimmed).not.toContain("## CHATGPT ARCHIVE");
    expect(trimmed).not.toContain("## RECENT REFLECTIONS");
  });

  it("does not drop core sections under priority 10 unless desperate", () => {
    const prompt = [
      "## IDENTITY\nAlways stay in character.",
      "## COMMAND STATE\nActive task: none.",
      "## ACTIVE RISKS\nRisk alert.",
    ].join("\n");

    // If cap is 60 (which is smaller than all three combined),
    // but all have priority < 10, it should not drop any of them via the loop,
    // and instead perform hard slice truncation as a fallback.
    const trimmed = trimPromptToBudget(prompt, 60);
    expect(trimmed).toContain("[PROMPT TRUNCATED FOR BUDGET HARDENING]");
  });
});

describe("trimPromptToBudget · brain W3 decision block", () => {
  it("the ## DECISION MODE block is its own protected section, never the first one trimmed", () => {
    const prompt = [
      "## IDENTITY\nAlways stay in character.",
      "## RECENT BRAIN DUMPS\n" + "dump ".repeat(40),
      "## MISC NOTES\n" + "note ".repeat(40),
      DECISION_MODE_ASK,
    ].join("\n");
    const trimmed = trimPromptToBudget(prompt, DECISION_MODE_ASK.length + 80);
    expect(trimmed).toContain(DECISION_MODE_ASK);
    expect(trimmed).not.toContain("## MISC NOTES");
    expect(trimmed).not.toContain("## RECENT BRAIN DUMPS");
  });
});
