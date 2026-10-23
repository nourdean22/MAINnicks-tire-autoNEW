/**
 * The resolveContradiction tool's `side` description must describe a claim-vs-record row
 * (2026-10-23, lens B finding 1). The service stores current_wins as "true" (the RECORD is
 * right, his claim was wrong), and the CLAIM VS RECORD block tells Nick the same. The old
 * description said "current_wins = today's statement", so a model that followed the parameter
 * text closed a row the opposite way from Nour's answer.
 */
import { describe, expect, it } from "vitest";
import { computeToolSchemas } from "@/lib/ai/tools/schema-digest";
import { brainTools } from "@/lib/ai/tools/brain";

function findProp(node: unknown, name: string): { description?: string; enum?: string[] } | null {
  if (!node || typeof node !== "object") return null;
  const rec = node as Record<string, unknown>;
  const hit = rec[name] as { description?: unknown } | undefined;
  if (hit && typeof hit === "object" && typeof hit.description === "string") return hit as { description?: string; enum?: string[] };
  for (const v of Object.values(rec)) {
    const found = findProp(v, name);
    if (found) return found;
  }
  return null;
}

describe("resolveContradiction · side description", () => {
  const entry = computeToolSchemas().find((e) => (e as { name?: string }).name === "resolveContradiction");
  const side = findProp(entry, "side");
  const desc = side?.description ?? null;

  it("control: the tool and its side description are found", () => {
    expect(entry, "resolveContradiction missing from the tool schemas").toBeDefined();
    expect(desc).toBeTruthy();
  });

  it("current_wins means the record is right", () => {
    expect(desc).toMatch(/current_wins[^.]*record is right/i);
  });

  it("never describes the sides as today's statement / prior statement (the memory-pair meaning)", () => {
    expect(desc).not.toMatch(/today'?s statement|prior statement/i);
  });

  it("does not offer both_valid: the service refuses it for a claim-vs-record row", () => {
    expect(side?.enum).toBeDefined();
    expect(side?.enum).not.toContain("both_valid");
    expect(side?.enum).toEqual(expect.arrayContaining(["current_wins", "old_wins", "dismissed"]));
  });

  it("currentBelief and note say they are not stored for table rows (no 'future recall' promise)", () => {
    for (const name of ["currentBelief", "note"]) {
      const d = findProp(entry, name)?.description ?? "";
      expect(d, name).toMatch(/not stored/i);
      expect(d, name).not.toMatch(/future recall/i);
    }
  });

  it("a key without the tbl: prefix is not found (the BrainMemory resolver is gone)", async () => {
    const tool = brainTools.resolveContradiction as unknown as {
      execute: (a: unknown, o: unknown) => Promise<unknown>;
    };
    expect(await tool.execute({ contradictionKey: "abc123", side: "dismissed" }, { toolCallId: "t", messages: [] })).toEqual({
      ok: false,
      error: "contradiction_not_found",
      contradictionKey: "abc123",
    });
  });
});
