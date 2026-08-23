/**
 * The anti-slop gate is wired, and says only what it checks.
 *
 * HANDED OVER from the nickstire sweep session, 2026-08-23. `check:anti-slop`
 * existed as a `package.json` script and was referenced by **no gate, no hook and
 * no workflow**. Meanwhile `docs/DESIGN.md:5` announced "Anti-slop verified at
 * push time … (gate [13/13])" and listed five bullets under it.
 *
 * Three separate untruths in one line:
 *
 *   1. Nothing ran it. It was a script definition, nothing more.
 *   2. "Push time" was never the mechanism — the pre-push hook runs
 *      `build:affected`.
 *   3. The script greps for exactly three patterns (Inter, Roboto/Arial, purple
 *      gradients). Two of the five bullets — corner radius and layout symmetry —
 *      were credited to a gate that has never looked for them.
 *
 * This is the **lying surface**: a doc claim asserting a mechanism nothing
 * verifies. It is worse than an unwired control, because an unwired control is
 * merely absent while a false claim actively buys trust. The sweep ran the three
 * greps and confirmed the repo passes today, so nothing had drifted behind the
 * false claim — which is the only reason this is a truth fix and not a rescue.
 *
 * The gate now runs inside `verify:hard`, the doc says what it checks, and the
 * two unverified bullets are relabelled as conventions rather than deleted:
 * they are real design rules, and the defect was the attribution, not the rule.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const pkg = () => readFileSync("package.json", "utf8");
const design = () => readFileSync("docs/DESIGN.md", "utf8");
const script = () => readFileSync("scripts/check-anti-slop.sh", "utf8");

describe("anti-slop gate · wired", () => {
  it("verify:hard actually runs it — it previously ran nowhere at all", () => {
    const verifyHard = JSON.parse(pkg()).scripts["verify:hard"] as string;
    expect(verifyHard).toContain("pnpm check:anti-slop");
  });

  it("the script it points at exists and is the one that greps", () => {
    const cmd = JSON.parse(pkg()).scripts["check:anti-slop"] as string;
    expect(cmd).toContain("scripts/check-anti-slop.sh");
    expect(script()).toContain("git grep");
  });
});

describe("anti-slop gate · claims only what it checks", () => {
  it("the false push-time claim is gone", () => {
    // Scoped to the CLAIM, not the string. An earlier version banned the literal
    // "gate [13/13]" anywhere in the file, which also forbade the correction note
    // from quoting what it corrects - a rule that makes the record unwritable.
    // Everything above the correction marker is the live claim; below it is
    // history and is allowed to quote the old wording verbatim.
    const d = design();
    const live = d.slice(0, d.indexOf("> **Corrected 2026-08-23.**"));
    expect(live.length, "the correction note must exist").toBeGreaterThan(0);
    expect(live, "the pre-push hook runs build:affected, never this").not.toContain(
      "Anti-slop verified at push time",
    );
    expect(live, "there was never a 13-check gate").not.toContain("gate [13/13]");
  });

  it("the doc names verify:hard, which is where it now runs", () => {
    expect(design()).toContain("pnpm verify:hard");
  });

  it("the two UNCHECKED rules are labelled as conventions, not as gate output", () => {
    const d = design();
    // They stay in the doc — they are real rules. What had to go was the claim
    // that something enforces them.
    expect(d).toContain("rounded corners");
    expect(d).toContain("symmetrical centered layouts");
    expect(d).toMatch(/conventions, not gate-checked/i);
    const conventionsIdx = d.search(/conventions, not gate-checked/i);
    expect(d.indexOf("rounded corners")).toBeGreaterThan(conventionsIdx);
    expect(d.indexOf("symmetrical centered layouts")).toBeGreaterThan(conventionsIdx);
  });

  it("the gate's three real patterns are each named in the doc", () => {
    const sh = script();
    for (const pattern of ["Inter", "Roboto", "purple"]) {
      expect(sh, `${pattern} must be a real check`).toContain(pattern);
      expect(design(), `${pattern} must be claimed`).toContain(pattern);
    }
  });

  it("no surface pairs the override with `git push` any more", () => {
    // The string appeared THREE times, not once: a header comment, the printed
    // failure hint, and agent-os/standards/nourcity/codified-rules.md. A canary
    // that only checked the site named in the handover would have gone green over
    // two live copies of the same false claim.
    const sh = script();
    expect(sh).not.toMatch(/ANTI_SLOP_GATE_SOFT=1 git push/);
    expect(sh).toContain("verify:hard");
    const rules = readFileSync("../../agent-os/standards/nourcity/codified-rules.md", "utf8");
    expect(rules).not.toMatch(/ANTI_SLOP_GATE_SOFT=1`?\s*(git push|at push)/);
  });

  it("DISCLOSED, not removed: the soft-fail override is still real code", () => {
    // Fixing the advertisement does not remove the mechanism. `ANTI_SLOP_GATE_SOFT=1`
    // still downgrades a hit to a warning, and now that the gate runs inside
    // verify:hard that is a live env-var bypass of a check. Removing it is a
    // behaviour change beyond this truth fix, so it is pinned and surfaced rather
    // than deleted quietly - an undisclosed bypass is how a gate becomes theatre.
    expect(script()).toMatch(/ANTI_SLOP_GATE_SOFT:-0.*=.*"1"/);
  });
});
