/**
 * tests/lib/ai/playbooks.test.ts · 2026-09-08 (program U7)
 *
 * Progressive tool disclosure: an intent playbook attaches a tool bundle and
 * an operating note. Pinned here: the matcher, that every bundled tool is a
 * real catalog name (a rename cannot hollow a playbook silently), that the
 * pruner admits the bundle under its own telemetry tier, and that the prompt
 * carries the note.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLAYBOOKS, matchPlaybook } from "@/lib/ai/tools/playbooks";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";
import { SELECTION_TIER } from "@/lib/ai/tool-selection-telemetry";

const ROOT = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("matchPlaybook", () => {
  it("routes the three recurring jobs and nothing else", () => {
    expect(matchPlaybook("how am I doing this week, I feel tired")?.id).toBe("reflect");
    expect(matchPlaybook("plan my day — what should I do next")?.id).toBe("execute");
    expect(matchPlaybook("write an instagram caption for the brake special")?.id).toBe("publish");
    expect(matchPlaybook("what is the capital of Ohio")).toBeNull();
    expect(matchPlaybook("")).toBeNull();
  });
});

describe("bundles are real", () => {
  const names = new Set(TOOL_CATALOG.map((t) => t.name));
  for (const p of PLAYBOOKS) {
    it(`${p.id}: every tool exists in the catalog and the bundle is small`, () => {
      for (const tool of p.tools) expect(names.has(tool), `${p.id} names unknown tool ${tool}`).toBe(true);
      expect(p.tools.length).toBeLessThanOrEqual(12);
      expect(p.guidance.length).toBeGreaterThan(40);
    });
  }
  it("publish is draft-only: no sending or posting tool rides in that bundle", () => {
    const publish = PLAYBOOKS.find((p) => p.id === "publish")!;
    const sideEffecting = new Set(TOOL_CATALOG.filter((t) => t.sideEffecting).map((t) => t.name));
    for (const tool of publish.tools) expect(sideEffecting.has(tool), `${tool} is side-effecting`).toBe(false);
  });
});

describe("wiring", () => {
  it("the pruner admits the bundle under the PLAYBOOK tier, after keyword families and before semantic", () => {
    const src = read("lib/ai/chat-mode.ts");
    expect(SELECTION_TIER.PLAYBOOK).toBe(7);
    const kw = src.indexOf("addIfSpace(name, 4);");
    const pb = src.indexOf("for (const name of playbook.tools) addIfSpace(name, 7);");
    const sem = src.indexOf("Tier 5");
    expect(kw).toBeGreaterThan(0);
    expect(pb).toBeGreaterThan(kw);
    expect(sem).toBeGreaterThan(pb);
  });
  it("the system prompt carries the playbook's operating note", () => {
    const src = read("app/api/ai/chat/augment-final-prompt.ts");
    expect(src).toMatch(/matchPlaybook\(args\.userContent\)/);
    expect(src).toMatch(/## Playbook · \$\{playbook\.id\}/);
  });
});
