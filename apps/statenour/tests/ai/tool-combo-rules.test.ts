/**
 * v10.0.529.12 · tool-combo-rules unit tests.
 *
 * Verifies the dangerous-tool-combo block-list shipped in E-3 Phase 2.
 * The verdict struct is the contract the future chat-route dispatcher
 * will read · these tests pin down what the dispatcher needs to handle.
 */

import { describe, it, expect } from "vitest";
import {
  assertSafeToolCombo,
  DANGEROUS_TOOL_COMBOS,
  comboVerdictToToolResult,
} from "@/lib/ai/tool-combo-rules";

describe("v10.0.529.12 · assertSafeToolCombo", () => {
  it("ok=true when prior tools list is empty", () => {
    expect(assertSafeToolCombo([], "ingestDocumentFromUrl")).toEqual({
      ok: true,
      matchedRule: null,
      requireHITL: false,
      reason: null,
    });
  });

  it("ok=true when nextTool isn't in any rule's `next` slot (fast path)", () => {
    expect(
      assertSafeToolCombo(["searchDocuments", "searchWebVerified"], "proposeCalendarEvent"),
    ).toEqual({
      ok: true,
      matchedRule: null,
      requireHITL: false,
      reason: null,
    });
  });

  it("ok=true when nextTool is risky but no prior triggers it", () => {
    expect(
      assertSafeToolCombo(["proposeCalendarEvent"], "ingestDocumentFromUrl"),
    ).toEqual({
      ok: true,
      matchedRule: null,
      requireHITL: false,
      reason: null,
    });
  });

  it("ok=false + requireHITL=true · searchDocuments → ingestDocumentFromUrl", () => {
    const verdict = assertSafeToolCombo(
      ["searchDocuments"],
      "ingestDocumentFromUrl",
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.requireHITL).toBe(true);
    expect(verdict.reason).toBeTruthy();
    expect(verdict.matchedRule?.prior).toBe("searchDocuments");
    expect(verdict.matchedRule?.next).toBe("ingestDocumentFromUrl");
  });

  it("blocks searchWebVerified → ingestDocumentFromUrl", () => {
    const verdict = assertSafeToolCombo(
      ["searchWebVerified"],
      "ingestDocumentFromUrl",
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.requireHITL).toBe(true);
  });

  it("blocks findRelatedConversations → runPython", () => {
    const verdict = assertSafeToolCombo(
      ["findRelatedConversations"],
      "runPython",
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.requireHITL).toBe(true);
  });

  it("blocks ingestDocumentFromUrl → runPython (cross-trust chain)", () => {
    const verdict = assertSafeToolCombo(
      ["ingestDocumentFromUrl"],
      "runPython",
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.requireHITL).toBe(true);
  });

  it("matches when prior is anywhere in the history, not just last", () => {
    const verdict = assertSafeToolCombo(
      ["searchDocuments", "proposeCalendarEvent", "findRelatedConversations"],
      "runPython",
    );
    expect(verdict.ok).toBe(false);
  });

  it("DANGEROUS_TOOL_COMBOS list shape is stable for downstream consumers", () => {
    expect(Array.isArray(DANGEROUS_TOOL_COMBOS)).toBe(true);
    expect(DANGEROUS_TOOL_COMBOS.length).toBeGreaterThanOrEqual(4);
    for (const rule of DANGEROUS_TOOL_COMBOS) {
      expect(typeof rule.prior).toBe("string");
      expect(typeof rule.next).toBe("string");
      expect(typeof rule.reason).toBe("string");
      expect(typeof rule.requireHITL).toBe("boolean");
    }
  });
});

describe("v10.0.529.12 · comboVerdictToToolResult", () => {
  it("renders a structured tool-result with the canonical error code", () => {
    const verdict = assertSafeToolCombo(
      ["searchDocuments"],
      "ingestDocumentFromUrl",
    );
    const result = comboVerdictToToolResult(verdict, "ingestDocumentFromUrl");
    expect(result.ok).toBe(false);
    expect(result.code).toBe("tool_combo_hitl_required");
    expect(result.error).toContain("ingestDocumentFromUrl");
    expect(result.error.toLowerCase()).toContain("confirm");
    expect(result.rule).toBe(verdict.matchedRule);
  });
});
