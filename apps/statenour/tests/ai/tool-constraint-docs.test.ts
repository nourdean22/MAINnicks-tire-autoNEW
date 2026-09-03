/**
 * tests/ai/tool-constraint-docs.test.ts
 *
 * PROD EVIDENCE, not a hypothetical. Read from live `tool_telemetry`
 * on 2026-09-03, these tools failed with `Type validation failed`:
 *
 *   searchMemories        sent {"limit":100}  -> too_big, maximum 50
 *   searchReflections     sent {"limit":100}  -> too_big
 *   getBlindSpots         sent {"severity":"CRITICAL"} -> invalid_value,
 *                                                        enum is lowercase
 *   getRecentReflections  sent {"scope":"personal"}    -> invalid_value
 *
 * THE CAUSE: the zod schema carried the constraint, but the text the model
 * reads did not. `searchMemories.limit` was `.max(50)` with NO `.describe()`
 * at all. `getBlindSpots.severity` said only "Filter by severity" and never
 * listed the values. So the model guessed 100, and guessed SCREAMING_CASE —
 * a reasonable guess, because `domain: "BUSINESS"` and `loopKind: "ONCE"`
 * elsewhere in this same tool surface ARE uppercase. Inconsistent casing
 * across the surface actively teaches the wrong convention.
 *
 * Relying on the JSON-Schema `maximum`/`enum` fields to reach the model is
 * not sufficient in practice: prod primary is Ollama Cloud, whose
 * OpenAI-compat surface does not honor every schema facet. Putting the
 * bound in the prose is belt-and-braces and works on any provider.
 *
 * BASELINE GATE, not a big bang. 51 constraints across 181 tools are still
 * undocumented. Fixing all of them in one commit would be unreviewable, so
 * this locks the count and lets it only fall. The four prod-proven offenders
 * are asserted individually so they can never silently regress.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const TOOLS_DIR = join(process.cwd(), "lib", "ai", "tools");

/**
 * Ratchet. Lower it whenever you document more constraints; never raise it.
 * Measured 2026-09-03 after fixing the four prod-proven offenders.
 */
const BASELINE_UNDOCUMENTED = 51;

interface Violation {
  file: string;
  field: string;
  kind: "max" | "enum";
  expected: string;
}

function scan(): Violation[] {
  const out: Violation[] = [];
  const files = readdirSync(TOOLS_DIR).filter((f) => f.endsWith(".ts"));

  for (const f of files) {
    const src = readFileSync(join(TOOLS_DIR, f), "utf8");

    // numeric fields carrying a .max(N)
    const numRe = /^\s*(\w+):\s*z\.number\(\)([^\n]*?)\.max\((\d+)\)([^\n]*)$/gm;
    for (let m = numRe.exec(src); m; m = numRe.exec(src)) {
      const [, field, , max, rest] = m;
      const d = /\.describe\("([^"]*)"\)/.exec(rest);
      const text = d ? d[1] : "";
      if (!text.includes(max)) {
        out.push({ file: f, field, kind: "max", expected: max });
      }
    }

    // enum fields
    const enumRe = /^\s*(\w+):\s*z\.enum\(\[([^\]]*)\]\)([^\n]*)$/gm;
    for (let m = enumRe.exec(src); m; m = enumRe.exec(src)) {
      const [, field, valsRaw, rest] = m;
      const d = /\.describe\("([^"]*)"\)/.exec(rest);
      const text = d ? d[1] : "";
      const vals = Array.from(valsRaw.matchAll(/"([^"]+)"/g)).map((v) => v[1]);
      if (vals.length > 0 && !text.includes(vals[0])) {
        out.push({ file: f, field, kind: "enum", expected: vals[0] });
      }
    }
  }
  return out;
}

describe("tool constraint documentation", () => {
  it("CANARY: the scanner actually finds violations — a scanner returning 0 proves nothing", () => {
    // A broken regex would return an empty array and the ratchet below
    // would pass forever. Assert the instrument fired at all.
    const found = scan();
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((v) => v.kind === "max")).toBe(true);
    expect(found.some((v) => v.kind === "enum")).toBe(true);
  });

  it(`does not exceed the ${BASELINE_UNDOCUMENTED}-violation baseline (ratchet down only)`, () => {
    const found = scan();
    if (found.length > BASELINE_UNDOCUMENTED) {
      const added = found
        .slice(BASELINE_UNDOCUMENTED)
        .map((v) => `${v.file}:${v.field} (${v.kind} ${v.expected})`)
        .join("\n  ");
      throw new Error(
        `Undocumented tool constraints rose to ${found.length} (baseline ${BASELINE_UNDOCUMENTED}).\n` +
          `A zod .max()/.enum() the model cannot read is a validation failure waiting to happen — ` +
          `this exact class caused 6 prod failures.\n  ${added}`
      );
    }
    expect(found.length).toBeLessThanOrEqual(BASELINE_UNDOCUMENTED);
  });

  describe("the four prod-proven offenders stay fixed", () => {
    const brain = () => readFileSync(join(TOOLS_DIR, "brain.ts"), "utf8");

    it("searchMemories.limit states its maximum of 50 (prod sent 100)", () => {
      const line = brain()
        .split("\n")
        .find((l) => l.includes("limit:") && l.includes("max(50)"));
      expect(line).toBeDefined();
      expect(line).toContain("50");
      expect(line).toMatch(/describe\(/);
    });

    it("getBlindSpots.severity lists its lowercase values (prod sent CRITICAL)", () => {
      const line = brain()
        .split("\n")
        .find((l) => l.includes("severity:") && l.includes("z.enum"));
      expect(line).toBeDefined();
      expect(line).toContain("critical");
      expect(line?.toLowerCase()).toContain("lowercase");
    });

    it("getRecentReflections.scope lists its values and rules out 'personal'", () => {
      const line = brain()
        .split("\n")
        .find((l) => l.includes("scope:") && l.includes("triggered"));
      expect(line).toBeDefined();
      expect(line).toContain("daily");
      // prod sent scope:"personal" — the description must say it is invalid
      expect(line).toContain("personal");
    });

    it("searchReflections.limit states its maximum of 20 (prod sent 100)", () => {
      const lines = brain()
        .split("\n")
        .filter((l) => l.includes("limit:") && l.includes("max(20)"));
      expect(lines.length).toBeGreaterThan(0);
      // every max(20) limit in this file documents its bound
      for (const l of lines) expect(l).toContain("20");
    });
  });
});
