/**
 * UI v3 W1a, global grammar pin (docs/design/ui-v3/PLAN.md, section 9 row 1).
 *
 * The uppercase safety net. The source sweep removed the `uppercase` utility from every element
 *    outside the five eyebrow roles, but a class built at runtime or added later would still shout.
 *    base.css carries ONE unlayered rule that neutralises any `[class*="uppercase"]` outside those
 *    roles. Unlayered beats Tailwind's layered `.uppercase`, so no !important is needed, and the
 *    roles stay out of it by :not().
 *
 * Each pin was run against the tree before the change and failed there; see the PR body.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const ROLES = [".eyebrow", ".vt-eyebrow", ".section-label", ".text-eyebrow", ".vt-verdict"] as const;
const BASE = stripComments(read("app/styles/base.css"));
const EFFECTS = stripComments(read("app/styles/effects.css"));
const ALL_CSS = `${BASE}\n${EFFECTS}`;

interface Rule {
  selector: string;
  body: string;
  /** Brace depth at the rule's opening: 0 means a top-level, unlayered, un-nested rule. */
  depth: number;
}

/** Every `selector { body }` with the brace depth it sits at. At-rule preludes (@media, @layer) count as selectors. */
function rules(css: string): Rule[] {
  const out: Rule[] = [];
  const stack: number[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      stack.push(i);
      out.push({ selector: css.slice(last, i).trim(), body: "", depth });
      depth++;
      last = i + 1;
    } else if (ch === "}") {
      const open = stack.pop() as number;
      depth--;
      const rule = [...out].reverse().find((r) => r.body === "" && r.depth === depth);
      if (rule) rule.body = css.slice(open + 1, i);
      last = i + 1;
    } else if (ch === ";" && depth === 0) {
      last = i + 1;
    }
  }
  return out;
}

const netRule = () => rules(BASE).find((r) => r.selector.includes('[class*="uppercase"]'));

describe("uppercase safety net in base.css", () => {
  it("exists", () => {
    expect(netRule(), 'no rule with a [class*="uppercase"] selector in base.css').toBeDefined();
  });

  it("is a top-level, unlayered rule so it outranks Tailwind's layered .uppercase without !important", () => {
    const r = netRule()!;
    expect(r.depth).toBe(0);
    expect(r.body).not.toContain("!important");
  });

  it("sets text-transform: none", () => {
    expect(netRule()!.body.replace(/\s+/g, " ")).toMatch(/text-transform:\s*none\s*;?/);
  });

  it("leaves each of the five eyebrow roles out by :not()", () => {
    const sel = netRule()!.selector;
    for (const role of ROLES) expect(sel, `${role} is not excluded`).toContain(`:not(${role})`);
  });

  it("names no role that does not really set text-transform: uppercase", () => {
    // Excluding a role from the net only makes sense while the role itself shouts.
    const all = rules(ALL_CSS);
    for (const role of ROLES) {
      const own = all.filter((r) => r.selector.split(",").map((s) => s.trim()).includes(role));
      expect(own.length, `${role} has no rule`).toBeGreaterThan(0);
      expect(own.some((r) => /text-transform:\s*uppercase/.test(r.body)), `${role} does not set uppercase`).toBe(true);
    }
  });
});
