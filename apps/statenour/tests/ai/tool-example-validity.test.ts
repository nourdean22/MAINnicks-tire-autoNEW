/**
 * tests/ai/tool-example-validity.test.ts
 *
 * Many tool descriptions embed a worked example the model is meant to
 * copy. That example is the highest-leverage text in a tool definition,
 * because a model copies it far more literally than it reads prose. If
 * the example disagrees with the tool's own inputSchema, the description
 * actively teaches the model to produce input the tool will reject.
 *
 * WHAT THIS FOUND (2026-09-03, cross-checked against live tool_telemetry):
 *
 *   classifyThought  example said {"thought": ...}  schema declares `text`
 *                    -> the example named a field that does not exist
 *
 *   createTask       7 prod failures. effort/context are CODE enums
 *                    ("M30", "DESK") with NO .describe(). The model sent
 *                    {"effort":"30 min"} and {"context":"Newsletter
 *                    creation"} - free text, because the codes are
 *                    unguessable. Fixed in tasks.ts.
 *
 * SCOPE, AND WHY IT IS NARROW. A first version of this file also asserted
 * "no example references an undeclared field" across all tools. That check
 * produced false positives on every multi-line zod declaration
 * (`dedupeKey: z\n  .string()`) and on nested example objects, flagging
 * scheduleSelfFollowUp, updateTask and setTaskPriority as broken when they
 * are fine. Doing it correctly needs a real TypeScript parser, not regex.
 * A checker that cries wolf gets muted, so the general check was REMOVED
 * rather than shipped noisy. What remains is only what regex can assert
 * precisely, plus a pinned regression guard on the one verified bug.
 *
 * ZERO COST: parses declared text against declared schema. Invokes
 * nothing, touches no database, calls no provider.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const TOOLS_DIR = join(process.cwd(), "lib", "ai", "tools");

/**
 * Slice a brace-balanced substring. A non-greedy `\{.*?\}` truncates on
 * the first inner `}`, which mangles any nested example into unparseable
 * JSON and reports it as a defect. Extractor bugs masquerading as
 * findings are how a checker loses its credibility.
 */
function balancedBrace(src: string, start: number): string | null {
  if (start < 0 || src[start] !== "{") return null;
  let depth = 0;
  for (let i = start; i < src.length && i < start + 1200; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

interface Example {
  file: string;
  tool: string;
  raw: string;
  block: string;
}

function extractExamples(): Example[] {
  const out: Example[] = [];
  for (const f of readdirSync(TOOLS_DIR).filter((n) => n.endsWith(".ts"))) {
    const src = readFileSync(join(TOOLS_DIR, f), "utf8");
    const toolRe = /^\s{2}([A-Za-z_][\w]*):\s*tool\(\{/gm;
    for (let m = toolRe.exec(src); m; m = toolRe.exec(src)) {
      const block = src.slice(m.index, m.index + 4000);
      const exAt = block.indexOf("Example:");
      if (exAt < 0) continue;
      const raw = balancedBrace(block, block.indexOf("{", exAt));
      if (!raw) continue;
      out.push({ file: f, tool: m[1], raw, block });
    }
  }
  return out;
}

const examples = extractExamples();

describe("tool description examples", () => {
  it("CANARY: the extractor actually finds examples — a zero here proves nothing", () => {
    // This canary already earned its keep: the first version of the
    // extractor excluded `"` from its character class and matched
    // NOTHING, which made every other assertion pass vacuously on an
    // empty array. The file scored green while checking zero tools.
    expect(examples.length).toBeGreaterThan(5);
  });

  it("no example passes a numeric value above that field's schema maximum", () => {
    // Mirrors a real prod failure: the model sent limit:100 into a
    // silent .max(50). An EXAMPLE doing that would be teaching it.
    const offenders: string[] = [];
    for (const ex of examples) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(ex.raw.replace(/\\"/g, '"'));
      } catch {
        continue; // illustrative pseudo-JSON, not a claim about the schema
      }
      if (typeof parsed !== "object" || parsed === null) continue;
      for (const [key, val] of Object.entries(parsed)) {
        if (typeof val !== "number") continue;
        const mm = new RegExp(`${key}:\\s*z\\.number\\(\\)[^\\n]*?\\.max\\((\\d+)\\)`).exec(ex.block);
        if (mm && val > Number(mm[1])) {
          offenders.push(`${ex.file}:${ex.tool} example ${key}=${val} exceeds max ${mm[1]}`);
        }
      }
    }
    expect(offenders, `Examples exceeding their own schema bounds:\n  ${offenders.join("\n  ")}`).toHaveLength(0);
  });

  describe("verified regressions stay fixed", () => {
    it("classifyThought's example names the field the schema actually declares", () => {
      const src = readFileSync(join(TOOLS_DIR, "brain.ts"), "utf8");
      const at = src.indexOf("  classifyThought: tool({");
      expect(at).toBeGreaterThan(-1);
      const block = src.slice(at, at + 1200);
      // Schema declares `text`. The example said `thought` — a field that
      // does not exist — on a tool that appears FIRST in every
      // "Available tools" list in the prod error logs.
      expect(block).toContain("text: z.string()");
      expect(block).toContain('Example: {\\"text\\"');
      expect(block).not.toContain('Example: {\\"thought\\"');
    });

    it("createTask's code enums carry a legend the model can follow", async () => {
      // Prod sent {"effort":"30 min"} and {"context":"Newsletter creation"}
      // because M30/DESK are unguessable and neither field described itself.
      //
      // 2026-09-16 · this asserted the legend was INLINE IN tasks.ts SOURCE.
      // That coupled a claim about the SCHEMA to a fact about file layout, and
      // it went red when the legend moved to the shared task-field-legends.ts —
      // while the property it names was not merely intact but extended to the
      // five sibling call sites the inline version had left broken. Asserting
      // the built schema instead survives that move and is the stronger claim:
      // it is what the model is actually handed.
      const { nourTools } = await import("@/lib/ai/tools");
      const shape = (
        (nourTools as Record<string, { inputSchema: { shape: Record<string, { description?: string }> } }>)
          .createTask.inputSchema
      ).shape;

      expect(shape.effort.description, "effort has no legend").toContain("M30 (30 min)");
      expect(shape.context.description, "context has no legend").toContain("DESK");
      // The legend must decode the code, not merely mention it — "effort" that
      // says "M30" and nothing else leaves the model exactly as stuck.
      expect(shape.effort.description).toContain("H2PLUS (2+ hours)");
      expect(shape.context.description).toContain("not a topic");
    });
  });
});
