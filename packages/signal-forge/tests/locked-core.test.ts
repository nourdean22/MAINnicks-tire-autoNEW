import { describe, it, expect } from "vitest";
import {
  detectLockedBlocks,
  detectEditableBlocks,
  compareLockedBlocks,
  rewriteEditableFieldsOnly,
  validatePromptProductTemplate
} from "../src/shared/locked-core.js";

describe("Locked Core System", () => {
  it("detects locked blocks", () => {
    const prompt = "Here is {LOCKED_CORE} and {MORE_LOCKED}.";
    expect(detectLockedBlocks(prompt)).toEqual(["LOCKED_CORE", "MORE_LOCKED"]);
  });

  it("detects editable blocks", () => {
    const prompt = "Please update [INPUT_1] and [INPUT_2].";
    expect(detectEditableBlocks(prompt)).toEqual(["INPUT_1", "INPUT_2"]);
  });

  it("detects locked block mutation", () => {
    const orig = "Hello {LOCKED_CORE}";
    const mod = "Hello {HACKED_CORE}";
    const res = compareLockedBlocks(orig, mod);
    expect(res.changed).toBe(true);
  });

  it("preserves locked blocks during rewrite", () => {
    const orig = "Locked: {SAFE} Editable: [USER_INPUT]";
    const rewritten = rewriteEditableFieldsOnly(orig, { USER_INPUT: "Hello World" });
    expect(rewritten).toBe("Locked: {SAFE} Editable: Hello World");
    
    // Check that lock didn't mutate
    const res = compareLockedBlocks(orig, rewritten);
    expect(res.changed).toBe(false);
  });

  it("detects missing locked block", () => {
    const orig = "A {B} C";
    const mod = "A C";
    const res = compareLockedBlocks(orig, mod);
    expect(res.changed).toBe(true);
  });

  it("fails safely when replacements do not match", () => {
    const orig = "Test [A]";
    const rewritten = rewriteEditableFieldsOnly(orig, { B: "value" });
    expect(rewritten).toBe(orig); // Unchanged
  });

  it("detects malformed prompt template", () => {
    expect(validatePromptProductTemplate("Missing } {LOCKED_CORE")).toBe(false);
    expect(validatePromptProductTemplate("Good {LOCKED} [EDIT]")).toBe(true);
  });
});
