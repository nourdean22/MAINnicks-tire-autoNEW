/**
 * Contract for the repair → scenario converter.
 *
 * The positive control is the suite's own schema: a draft the suite would
 * reject is not a draft. Beyond that, the tests pin the SHAPE that makes a
 * repair scenario faithful — three turns, the rejected reply in the middle,
 * the operator's own words last — and the read-only / gitignored contract the
 * harvesters already honour.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ASSISTANT_CONTEXT_CAP,
  CATEGORY_BY_CLASS,
  CRITERIA_BY_CLASS,
  TOOL_DEPENDENT_CLASSES,
  draftScenario,
} from "@/scripts/draft-repair-scenarios";
import { REPAIR_CLASSES, type RepairCandidate } from "@/scripts/harvest-repair-signals";
import {
  REQUIRES_TOOLS_TAG,
  requiresToolRunner,
  scenarioSchema,
  scenarioCategoryValues,
} from "@/tests/eval/types";

const NOW = new Date("2026-09-22T12:00:00Z");

function candidate(over: Partial<RepairCandidate> = {}): RepairCandidate {
  return {
    id: "repair-under_research-abc12345",
    failureClass: "UNDER_RESEARCH",
    tier: "medium",
    label: "go-deeper",
    conversationId: "c1",
    assistantMessageId: "m_reply",
    assistantPreview: "Here are some general tips: focus on quality, communicate clearly, and follow up.",
    assistantModel: "minimax-m3",
    repairMessageId: "cmxyzABCDEFG",
    repairText: "U aren't telling me anything I don't know already, try again",
    repairedAt: "2026-09-10T15:00:00.000Z",
    latencySeconds: 42,
    ...over,
  };
}

describe("draftScenario", () => {
  it("POSITIVE CONTROL: a draft for every failure class passes the suite's real schema", () => {
    for (const cls of REPAIR_CLASSES) {
      const d = draftScenario(candidate({ failureClass: cls }), "what should I do about slow Tuesdays at the shop", NOW);
      expect(() => scenarioSchema.parse(d), cls).not.toThrow();
      expect(scenarioCategoryValues).toContain(d.category);
    }
  });

  it("replays the repair as THREE turns: the ask, the rejected reply, the operator's words", () => {
    const d = draftScenario(candidate(), "what should I do about slow Tuesdays at the shop", NOW);
    expect(d.input.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(d.input.messages[0].content).toContain("slow Tuesdays");
    expect(d.input.messages[1].content).toContain("general tips");
    expect(d.input.messages[2].content).toBe("U aren't telling me anything I don't know already, try again");
  });

  it("the criterion that names the failure carries the dominant weight", () => {
    for (const cls of REPAIR_CLASSES) {
      const crit = CRITERIA_BY_CLASS[cls];
      expect(crit.length, cls).toBeGreaterThanOrEqual(1);
      expect(crit.length, cls).toBeLessThanOrEqual(6);
      const max = Math.max(...crit.map((c) => c.weight ?? 1));
      expect(crit[0].weight, `${cls}: first criterion must be the dominant one`).toBe(max);
      expect(max, cls).toBeGreaterThanOrEqual(4);
    }
  });

  it("caps the rejected reply so the rubric stays readable, and never truncates the repair itself", () => {
    const long = "x".repeat(ASSISTANT_CONTEXT_CAP + 500);
    const d = draftScenario(candidate({ assistantPreview: long }), "ask", NOW);
    expect(d.input.messages[1].content.length).toBeLessThanOrEqual(ASSISTANT_CONTEXT_CAP);
    expect(d.input.messages[2].content).toBe(candidate().repairText);
  });

  it("id is a lowercase slug derived from class + the repair message id, so two runs agree", () => {
    const a = draftScenario(candidate(), "ask", NOW);
    const b = draftScenario(candidate(), "ask", new Date("2026-10-01T00:00:00Z"));
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^[a-z0-9_-]+$/);
    expect(a.id).toBe("repair-under-research-abcdefg".replace("abcdefg", "zabcdefg"));
  });

  it("carries provenance in tags and description, and says CURATE BEFORE PROMOTING", () => {
    const d = draftScenario(candidate(), "ask", NOW);
    expect(d.tags).toEqual(["repair-mined", "under_research", "medium"]);
    expect(d.description).toContain("repair-under_research-abc12345");
    expect(d.description).toContain("CURATE BEFORE PROMOTING");
  });

  it("every class maps to a real suite category", () => {
    for (const cls of REPAIR_CLASSES) expect(scenarioCategoryValues).toContain(CATEGORY_BY_CLASS[cls]);
  });

  it("a tool-dependent class is born tagged requires-tools; every other class is not (2026-09-22)", () => {
    // The live runner replays through aiChat (no tools). A draft whose
    // recovery criterion IS a tool action must carry the tag from birth, or
    // curation promotes an impossible criterion into a false regression —
    // the exact defect the PR #2487 review found in eight hand-made files.
    for (const cls of TOOL_DEPENDENT_CLASSES) expect(REPAIR_CLASSES).toContain(cls);
    for (const cls of REPAIR_CLASSES) {
      const d = draftScenario(candidate({ failureClass: cls }), "ask", NOW);
      expect(requiresToolRunner(d), `${cls}: tag presence disagrees with TOOL_DEPENDENT_CLASSES`).toBe(
        TOOL_DEPENDENT_CLASSES.has(cls),
      );
    }
    // Canary on the criteria themselves: every tool-dependent class's dominant
    // criterion names the action ("performs", "re-checks", "verified", "capability").
    for (const cls of TOOL_DEPENDENT_CLASSES) {
      const dominant = [...CRITERIA_BY_CLASS[cls]].sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1))[0];
      expect(dominant.description).toMatch(/performs|re-checks|fetches|verified|capability/i);
    }
    // And the untouched shape for a plain class stays exactly as before.
    expect(draftScenario(candidate(), "ask", NOW).tags).toEqual(["repair-mined", "under_research", "medium"]);
    expect(REQUIRES_TOOLS_TAG).toBe("requires-tools");
  });
});

describe("converter source contract", () => {
  // Match CODE, not commentary — the script's header rightly says drafts are
  // promoted "into tests/eval/scenarios/ by hand", and a guard that reads
  // comments would forbid documenting the rule it enforces. Same lesson as
  // tests/services/chat/receipt-verification-join.test.ts.
  const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const src = stripComments(readFileSync(resolve(process.cwd(), "scripts/draft-repair-scenarios.ts"), "utf8"));

  it.each([
    ["create", /\.create(Many)?\s*\(/],
    ["update", /\.update(Many)?\s*\(/],
    ["delete", /\.delete(Many)?\s*\(/],
  ])("never calls prisma .%s()", (_n, pattern) => {
    expect(src).not.toMatch(pattern);
  });

  it("writes drafts only under the gitignored eval-datasets dir by default", () => {
    // Precise, not a substring ban: the script's own log line SAYS drafts are
    // curated into tests/eval/scenarios/ (a string, so comment-stripping does
    // not remove it). The guard is that no WRITE targets that path and the
    // default out dir is gitignored — not that the path is never mentioned.
    expect(src).toMatch(/\?\? "eval-datasets\/repair-scenario-drafts"/);
    expect(src, "no write may target the committed corpus").not.toMatch(/(writeFileSync|mkdirSync)\([^)]*tests\/eval\/scenarios/);
    expect(src, "the out dir must come from --out or the gitignored default, never a scenarios literal").not.toMatch(/outDir\s*=[^;]*tests\/eval\/scenarios/);
    // Review on #2480: `--out` used to be accepted verbatim, so a caller could
    // point the drafts (operator ask + repair, verbatim) at a tracked path. The
    // same boundary the harvester enforces now wraps the drafter's out dir; its
    // behaviour (refusals, defaults) is tested in harvest-repair-signals.test.ts.
    expect(src).toMatch(/const outDir = resolveOutPath\(arg\("--out"\) \?\? "eval-datasets\/repair-scenario-drafts"\)/);
  });

  it("POSITIVE CONTROL: the comment stripper left the code", () => {
    expect(src).toContain("export function draftScenario");
    expect(src).toContain("scenarioSchema.parse(draft)");
  });

  it("validates every draft against the suite schema before writing it", () => {
    expect(src).toContain("scenarioSchema.parse(draft)");
  });

  it("exits non-zero when any draft was schema-rejected, so a broken converter cannot read as a clean run", () => {
    expect(src).toMatch(/if \(rejected > 0\) process\.exit\(1\)/);
  });
});
