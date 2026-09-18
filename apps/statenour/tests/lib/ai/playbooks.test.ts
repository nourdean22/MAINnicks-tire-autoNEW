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

/** Matches the `execute` playbook AND a spread of tier-4 keyword families. */
const EXECUTE_PROMPT = "plan my day — what should I do next on my missions and tasks";

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
  /**
   * 2026-09-18 · THIS WAS A SOURCE-TEXT GUARD AND IT COULD NOT SEE ITS SUBJECT.
   *
   * It read `chat-mode.ts` as a string and compared the byte offsets of
   * `addIfSpace(name, 4);`, the tier-7 loop, and `addIfSpace(name, 5);`. A
   * 2026-09-16 comment records it being repaired once already — it had anchored
   * on the PROSE "Tier 5" and broke when an unrelated docstring mentioned it —
   * with the conclusion "anchor on the code that actually runs".
   *
   * Anchoring on source TEXT has the same defect one level down. It would have
   * passed unchanged if someone left `addIfSpace(name, 4);` in place as dead
   * code and rerouted the real selection elsewhere; and it failed on the
   * two-stage rewrite, which deleted `addIfSpace` while breaking nothing the
   * test was written to protect. A guard that cannot distinguish those two
   * cases is measuring spelling, not behaviour.
   *
   * So it now RUNS the pruner. And the policy it pins has genuinely changed:
   * selection is two-stage, tiers 1/2/3/7 are INTENT and seated before tiers
   * 4/5/6 are ranked against each other. A playbook is a small curated bundle
   * matched on explicit intent; the ~40 tier-4 regex families are generic, and
   * 65.3% of their surfaced impressions went to tools the model never chose.
   * Under truncation the bundle wins. That is the change, asserted directly.
   */
  it("the PLAYBOOK bundle survives truncation that cuts the keyword families", async () => {
    expect(SELECTION_TIER.PLAYBOOK).toBe(7);
    const { pruneTools } = await import("@/lib/ai/chat-mode");
    const playbook = matchPlaybook(EXECUTE_PROMPT);
    expect(playbook?.id, "fixture must actually match a playbook").toBe("execute");

    const all: Record<string, unknown> = {};
    for (const t of TOOL_CATALOG) all[t.name] = {};

    // Tight enough that tier 4 alone would have consumed the remainder.
    process.env.NICK_TOOL_BUDGET = "20";
    try {
      const offered = Object.keys(
        (await pruneTools("standard" as never, all, EXECUTE_PROMPT)) as Record<string, unknown>,
      );
      for (const tool of playbook!.tools) {
        // Only assert over bundle tools that exist in the catalog — "bundles
        // are real" above owns that check, and duplicating it here would make
        // this test fail for a reason it does not name.
        if (all[tool]) expect(offered, `${tool} is an intent tool and must survive`).toContain(tool);
      }
    } finally {
      delete process.env.NICK_TOOL_BUDGET;
    }
  });

  it("tier 7 is still a real tier in the source, not just a constant", () => {
    // Narrow on purpose: the behavioural test above owns the ordering. This
    // only catches the bundle loop being deleted outright, which would make the
    // test above pass vacuously if the bundle's tools happened to be core.
    const src = read("lib/ai/chat-mode.ts");
    expect(src).toMatch(/for \(const name of playbook\.tools\) keep\(name, 7\)/);
  });
  it("the system prompt carries the playbook's operating note", () => {
    const src = read("app/api/ai/chat/augment-final-prompt.ts");
    expect(src).toMatch(/matchPlaybook\(args\.userContent\)/);
    expect(src).toMatch(/## Playbook · \$\{playbook\.id\}/);
  });
});
