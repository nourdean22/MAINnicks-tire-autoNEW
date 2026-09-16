/**
 * The anti-slop gate is wired, and does not claim checks it never performs.
 *
 * WHAT THIS FILE USED TO DO, AND WHY IT WAS REWRITTEN. It asserted, against the
 * live doc:
 *
 *     expect(DESIGN.md).toContain("rounded corners");
 *     expect(DESIGN.md).toContain("symmetrical centered layouts");
 *
 * A permanent control hard-coded to a temporary datum. The day someone correctly
 * retires either convention, this test cannot pass — so it stands between a
 * correct fix and a green build, and the rational move becomes deleting it. One
 * of ours was deleted for precisely that reason today, which is the worst
 * available outcome: the control did not merely fail, it was removed, and the
 * rule it protected left with it.
 *
 * STANDING RULE, now applied here: a canary asserts against a synthetic fixture
 * it controls, never against live config or a live count. Below, `auditGateClaims`
 * is driven by docs written inside this file — including one that over-claims, so
 * the audit is proven able to SEE the defect — and the real DESIGN.md is then
 * just one more input rather than the fixture.
 *
 * THE ORIGINAL DEFECT, unchanged. `check:anti-slop` existed as a package.json
 * script referenced by no gate, hook or workflow, while DESIGN.md announced
 * "Anti-slop verified at push time … (gate [13/13])" over five bullets. Three
 * untruths: nothing ran it; push time was never the mechanism; and the script
 * greps three patterns, so two bullets were credited to a gate that has never
 * looked for them. That is the lying surface — worse than an unwired control,
 * because an unwired control is merely absent while a false claim buys trust.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { auditGateClaims } from "@/lib/utils/doc-claim-audit";

/** Everything a doc might attribute to this gate. */
const VOCAB = [
  "Inter",
  "Roboto",
  "Arial",
  "purple",
  "rounded corners",
  "symmetrical centered layouts",
  "contrast ratio",
] as const;

const HEADING = "gate-checked";

describe("auditGateClaims · driven by fixtures this file owns", () => {
  const gate = 'git grep -lE "Inter|Roboto|Arial"; git grep -nE "from-purple-"';

  it("FIRES on a doc crediting the gate with a check it does not perform", () => {
    // The positive control, and the load-bearing one. Without it every "ok"
    // below is vacuous — an audit that never fires would pass all of them while
    // catching nothing.
    const doc = ["## Style", "", "gate-checked", "- No Inter", "- No rounded corners", ""].join("\n");
    const r = auditGateClaims(doc, gate, HEADING, VOCAB);
    expect(r.ok).toBe(false);
    expect(r.unbacked).toContain("rounded corners");
    expect(r.unbacked, "Inter IS gated, so it must not be reported").not.toContain("Inter");
  });

  it("PASSES a doc claiming only what the gate greps", () => {
    const doc = ["gate-checked", "- No Inter", "- No Roboto", "- No purple gradients", ""].join("\n");
    expect(auditGateClaims(doc, gate, HEADING, VOCAB).ok).toBe(true);
  });

  it("PASSES a doc that removes a convention entirely — the case that killed the old test", () => {
    // This is the whole point. Retiring "rounded corners" is a legitimate edit.
    // The old assertion required the string to be PRESENT, so this correct change
    // would have failed it. Here it passes, because the invariant is about
    // over-claiming, not about any particular line existing.
    const doc = ["gate-checked", "- No Inter", ""].join("\n");
    expect(auditGateClaims(doc, gate, HEADING, VOCAB).ok).toBe(true);
  });

  it("PASSES a doc with no attribution block at all", () => {
    // A doc that claims nothing cannot over-claim. Deleting the section must not
    // be blocked by the thing guarding the section's honesty.
    expect(auditGateClaims("# Design\n\nSome prose.\n", gate, HEADING, VOCAB).ok).toBe(true);
  });

  it("does not read prose further down the file as a gate claim", () => {
    // Scoping matters: without the paragraph break the audit would flag any
    // mention of a convention anywhere in the document, which is how a check
    // becomes impossible to satisfy and gets removed.
    const doc = [
      "gate-checked",
      "- No Inter",
      "",
      "Elsewhere we also prefer rounded corners and symmetrical centered layouts.",
    ].join("\n");
    expect(auditGateClaims(doc, gate, HEADING, VOCAB).ok).toBe(true);
  });

  it("reports EVERY unbacked claim, not just the first", () => {
    const doc = ["gate-checked", "- No rounded corners", "- No symmetrical centered layouts", ""].join("\n");
    expect(auditGateClaims(doc, gate, HEADING, VOCAB).unbacked).toHaveLength(2);
  });
});

describe("the live gate · wiring, which is a comparison and not a hard-coded datum", () => {
  // These read live files and that is CORRECT: each compares two live things
  // against each other. "verify:hard must run the gate" fails only when someone
  // unwires it, which IS the defect — unlike "the doc must contain string X",
  // which fails when someone does something legitimate.
  const pkg = () => JSON.parse(readFileSync("package.json", "utf8"));
  const gateSource = () => readFileSync("scripts/check-anti-slop.sh", "utf8");

  it("verify:hard runs it — it previously ran nowhere at all", () => {
    expect(pkg().scripts["verify:hard"]).toContain("pnpm check:anti-slop");
  });

  it("the script it points at is the one that greps", () => {
    expect(pkg().scripts["check:anti-slop"]).toContain("scripts/check-anti-slop.sh");
    expect(gateSource()).toContain("git grep");
  });

  it("THE LIVE DOC does not over-claim", () => {
    // The real check, applied to the real doc — using the audit proven above to
    // be able to fire. If a future edit credits the gate with something it does
    // not grep, this fails and names it. If a future edit removes a convention,
    // rewords one, or deletes the block, this stays green.
    const r = auditGateClaims(readFileSync("docs/DESIGN.md", "utf8"), gateSource(), HEADING, VOCAB);
    expect(r.unbacked, `DESIGN.md credits the gate with checks it does not perform: ${r.unbacked.join(", ")}`).toEqual([]);
  });

  it("no surface pairs the soft-fail override with `git push`", () => {
    // Also a live-vs-live comparison: the override exists, and no doc may
    // describe it as a push-hook flag, because this gate has never run at push
    // time. Fails only on a false claim, never on a legitimate rewrite.
    expect(gateSource()).not.toMatch(/ANTI_SLOP_GATE_SOFT=1 git push/);
    const rules = readFileSync("../../agent-os/standards/nourcity/codified-rules.md", "utf8");
    expect(rules).not.toMatch(/ANTI_SLOP_GATE_SOFT=1`?\s*(git push|at push)/);
  });

  it("DISCLOSED, not removed: the soft-fail override is still real code", () => {
    // Fixing the advertisement did not remove the mechanism. Now that the gate
    // runs inside verify:hard, this is a live env-var bypass of a check. Pinned
    // and surfaced rather than deleted quietly — an undisclosed bypass is how a
    // gate becomes theatre.
    expect(gateSource()).toMatch(/ANTI_SLOP_GATE_SOFT:-0.*=.*"1"/);
  });
});

/**
 * 2026-08-25 · THE ARM THIS FILE WAS MISSING.
 *
 * Everything above audits what DOCS CLAIM about the gate, against fixtures this
 * file owns — correct, and deliberately fixture-driven so the canary cannot be
 * killed by a live datum changing. But nothing anywhere executed
 * `check-anti-slop.sh` against the tree, so the gate could have stopped firing
 * entirely and every arm would still have been green.
 *
 * That gap was found by comparing this file to `tests/repo/et-clock.test.ts`.
 * Both gates shipped in the same PR (#1809) and both are reported identically in
 * PR bodies ("check:anti-slop: no anti-slop UI patterns"). Only et-clock's canary
 * ran the gate over the real tree; this one read the script's SOURCE and its
 * package.json wiring. Source-and-wiring assertions prove a gate EXISTS and is
 * SPELLED correctly. They cannot tell a working grep from a broken one.
 *
 * THE GENERAL RULE, and it is the one worth carrying forward:
 * **the question is not whether a canary exists but whether the canary's subject
 * includes the thing you are protecting.** Both gates were green; only one would
 * have turned red on a regression.
 *
 * Offenders are planted in REAL TRACKED FILES because the gate runs `git grep`,
 * which sees only tracked paths — a temp file outside the index would not be
 * scanned and the canary would pass without testing anything. Same reasoning,
 * and the same restore-and-re-verify tail, as the et-clock canary.
 */
describe("the gate FIRES on the tree it is pointed at", () => {
  const { readFileSync: rf, writeFileSync: wf } = require("node:fs") as typeof import("node:fs");
  const { execFileSync: ex } = require("node:child_process") as typeof import("node:child_process");

  const run = () => {
    try {
      return { code: 0, out: ex("bash", ["scripts/check-anti-slop.sh"], { encoding: "utf8" }) };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  };

  /** Plant `text` at the end of `victim`, run the gate, always restore. */
  const withPlanted = <T,>(victim: string, text: string, fn: (r: ReturnType<typeof run>) => T): T => {
    const original = rf(victim, "utf8");
    try {
      wf(victim, `${original}\n${text}\n`, "utf8");
      return fn(run());
    } finally {
      wf(victim, original, "utf8");
    }
  };

  it("passes on the current tree", () => {
    const r = run();
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("no anti-slop UI patterns");
  });

  it("CANARY: a purple SaaS gradient turns it red and names the file", () => {
    const victim = "components/ui/glass-card.tsx";
    withPlanted(victim, '// canary <div className="bg-gradient-to-r from-purple-500 to-purple-700" />', (r) => {
      expect(r.code, "the gate did not fire on a planted purple gradient").toBe(1);
      expect(r.out).toContain(victim);
      expect(r.out).toContain("Purple-on-white SaaS gradients");
    });
    expect(run().code, "restore failed — the tree is dirty").toBe(0);
  });

  it("CANARY: an Inter font import turns it red", () => {
    const victim = "components/ui/glass-card.tsx";
    withPlanted(victim, 'import { Inter } from "next/font/google";', (r) => {
      expect(r.code, "the gate did not fire on a planted Inter import").toBe(1);
      expect(r.out).toContain("Inter font imports");
    });
    expect(run().code, "restore failed — the tree is dirty").toBe(0);
  });

  it("CANARY: a Roboto import in the canonical order turns it red (same order-bug)", () => {
    // The Roboto/Arial alternation carried the identical defect as the Inter
    // one and was fixed in the same pass. Proven here so the fix cannot silently
    // regress the way the original did.
    const victim = "components/ui/glass-card.tsx";
    withPlanted(victim, 'import { Roboto } from "next/font/google";', (r) => {
      expect(r.code, "the gate did not fire on a planted Roboto import").toBe(1);
      expect(r.out).toContain("Roboto/Arial AI-default fonts");
    });
    expect(run().code, "restore failed — the tree is dirty").toBe(0);
  });

  /**
   * The script's own comment stakes this claim and nothing tested it:
   *   "Waivers are BY SIGNATURE, not by filename ... Excluding whole files
   *    would have made this check permanently blind to the file it was
   *    waived for."
   *
   * 2026-09-16 · this arm used to read the repo's ONE live waiver
   * (app/(mastery)/stats/page.tsx carried a waived blue→indigo→purple
   * gradient) as its precondition. The Visible Transformation wave de-carded
   * that page and removed the gradient — a correct edit — and the canary went
   * red on its own precondition, with nothing wrong with the gate. That is the
   * exact failure this FILE'S OWN HEADER warns about: a permanent control
   * hard-coded to a temporary datum, where the rational move becomes deleting
   * the control. So the waiver is now PLANTED here, and the arm holds whether
   * or not any file in the tree happens to carry a marker today.
   */
  it("the waiver is BY SIGNATURE: a waived line passes, a NEW hit in that same FILE still fires", () => {
    const victim = "components/ui/glass-card.tsx";
    const waivedLine = '// anti-slop-allow 2026-09-16 canary <div className="from-purple-500 to-purple-700" />';
    const freshHit = '// canary <div className="from-purple-400 to-purple-600" />';

    // Half 1 — the marker really exempts its own line, or the "fires" half
    // below would be indistinguishable from a gate that ignores waivers.
    withPlanted(victim, waivedLine, (r) => {
      expect(r.code, `a line carrying anti-slop-allow was reported anyway:\n${r.out}`).toBe(0);
    });

    // Half 2 — and the exemption does not spread to the file. If waivers were
    // file-scoped the fresh hit below would be invisible, which is the exact
    // blindness the script's comment says was avoided.
    withPlanted(victim, `${waivedLine}\n${freshHit}`, (r) => {
      expect(r.code, "a new purple gradient beside a waived one was not reported — the waiver is file-scoped").toBe(1);
      expect(r.out).toContain(victim);
    });

    expect(run().code, "restore failed — the tree is dirty").toBe(0);
  });
});
