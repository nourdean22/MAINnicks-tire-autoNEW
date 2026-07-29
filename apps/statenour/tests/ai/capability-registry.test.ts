import { describe, it, expect } from "vitest";
import {
  classifyTool,
  isReadSafeTool,
  stripMutatingTools,
  MUTATING_PREFIX,
} from "@/lib/ai/capability-registry";

describe("capability registry — read-mode classification (WP-14)", () => {
  it("classifies known read tools as read-safe", () => {
    // Real catalog rows: personal_read, no sideEffecting flag, read verb.
    expect(isReadSafeTool("getMasteryScores")).toBe(true);
    expect(isReadSafeTool("getTasks")).toBe(true);
  });

  it("classifies known write tools as mutating", () => {
    const v = classifyTool("createTask");
    expect(v.readSafe).toBe(false);
    // Any tripwire is acceptable — the point is it CANNOT pass.
    expect(["side_effecting_flag", "write_category", "mutating_name"]).toContain(v.reason);
  });

  it("fails CLOSED on tools with no catalog entry — unknown is never safe", () => {
    const v = classifyTool("someToolNobodyRegistered");
    expect(v.readSafe).toBe(false);
    expect(v.reason).toBe("not_in_catalog");
  });

  it("mutating-prefix matches only at a camelCase boundary (markTaskDone yes, markdownExport no)", () => {
    expect(MUTATING_PREFIX.test("markTaskDone")).toBe(true);
    expect(MUTATING_PREFIX.test("markdownExport")).toBe(false);
    expect(MUTATING_PREFIX.test("createTask")).toBe(true);
    expect(MUTATING_PREFIX.test("creativeBrief")).toBe(false);
    expect(MUTATING_PREFIX.test("logError")).toBe(true); // log + uppercase = boundary
    expect(MUTATING_PREFIX.test("loginHistory")).toBe(false); // lowercase continuation
    expect(MUTATING_PREFIX.test("logWorkout")).toBe(true);
  });

  it("stripMutatingTools keeps read tools, strips writes + unknowns, reports the stripped list", () => {
    const fake = {
      getTasks: { a: 1 },
      createTask: { b: 2 },
      totallyUnknownTool: { c: 3 },
    };
    const { tools, stripped } = stripMutatingTools(fake);
    expect(Object.keys(tools)).toEqual(["getTasks"]);
    expect(stripped.sort()).toEqual(["createTask", "totallyUnknownTool"]);
  });
});
