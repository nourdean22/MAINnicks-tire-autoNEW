/**
 * A refused or failed write must not wear its success label
 * (NEW-03F1-chip-softfail, audit 2026-10-10).
 *
 * setMit returning { success: false, message: "MIT NOT saved" } rendered
 * "MIT locked" with the gold receipt glyph, because the card only knew the
 * call's transport state (output-available), not what the payload said.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

vi.mock("@/lib/trpc/client", () => ({ trpc: { task: { undo: { useMutation: () => ({ mutateAsync: vi.fn() }) } } } }));

import { ToolResultCard } from "@/components/chat/tool-result-card";

const card = (output: unknown) =>
  renderToStaticMarkup(<ToolResultCard toolName="setMit" state="output-available" output={output} />);

describe("ToolResultCard soft failure", () => {
  it("a failed save reads Not done, never MIT locked", () => {
    const html = card({ success: false, message: "MIT NOT saved" });
    expect(html).not.toContain("MIT locked");
    expect(html).toContain("Not done");
  });

  it("an approval hold reads Waiting for approval", () => {
    const html = card({ error: "approval_required", reason: "outbound action held" });
    expect(html).not.toContain("MIT locked");
    expect(html).toContain("Waiting for approval");
  });

  it("a refusal at the authority boundary (mutation_locked) reads Not done", () => {
    const html = card({ error: "mutation_locked", reason: "frozen", reflection: { tool: "setMit", guidance: "" } });
    expect(html).not.toContain("MIT locked");
    expect(html).toContain("Not done");
  });

  // R3-15 (review finding 4): most tools report a caught failure as a bare
  // { error: "<sentence>" }; the card showed "Not done" with no reason.
  it("a bare error sentence is the subtitle", () => {
    const html = card({ error: "Calendar fetch failed." });
    expect(html).toContain("Not done");
    expect(html).toContain("Calendar fetch failed.");
  });

  it("an error code with no reason is not printed as a sentence", () => {
    expect(card({ error: "mutation_locked" })).not.toContain("mutation_locked");
  });

  it("a partial read keeps its real rows and still says what failed", () => {
    const html = renderToStaticMarkup(
      <ToolResultCard
        toolName="searchReflections"
        state="output-available"
        output={{
          query: "mantra",
          error: "READ FAILED for brain dumps. The surviving source was searched and its rows are real, but this result is incomplete",
          count: 3,
          results: [{ id: "r1" }, { id: "r2" }, { id: "r3" }],
        }}
      />,
    );
    expect(html).not.toContain("Not done");
    expect(html).toContain("3 matches");
    expect(html).toContain("READ FAILED for brain dumps");
  });

  it("CONTROL: a real save still reads MIT locked", () => {
    const html = card({ success: true, text: "Call Mike" });
    expect(html).toContain("MIT locked");
    expect(html).not.toContain("Not done");
  });
});
