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
 * scanned and the canary would pass without testing anything. The restore is
 * proven on the files themselves (each compared to its original once the gate
 * has run), not by a second gate run, and it runs in a finally: a gate run or an
 * assertion that throws still puts every planted file back.
 */
describe("the gate FIRES on the tree it is pointed at", () => {
  const { readFileSync: rf, writeFileSync: wf } = require("node:fs") as typeof import("node:fs");
  const { execFile } = require("node:child_process") as typeof import("node:child_process");
  const { promisify } = require("node:util") as typeof import("node:util");
  const execFileAsync = promisify(execFile);

  // Async on purpose. execFileSync held the vitest worker's event loop for the
  // whole gate run (9 s alone, 25 s loaded), so under load the worker could not
  // answer the runner's RPC and the suite died with "[vitest-worker]: Timeout
  // calling onTaskUpdate" even though no test failed. A promisified execFile
  // keeps the loop free while bash runs.
  type GateRun = { code: number; out: string };
  const run = async (): Promise<GateRun> => {
    try {
      const { stdout } = await execFileAsync("bash", ["scripts/check-anti-slop.sh"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
      return { code: 0, out: stdout };
    } catch (e) {
      const err = e as { code?: number | string; stdout?: string; stderr?: string };
      return { code: typeof err.code === "number" ? err.code : 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  };

  // TIMING. One gate run is ~9 s on a busy Windows box and ~25 s while other test
  // files load the machine: the cost is git-bash process spawns (about 1.6 s of
  // the 9 s is CPU), not the grep, so a narrower tree would not help. The default
  // 20 s testTimeout fit one run on a quiet machine and failed every test here on a
  // loaded one. So the tests that run the gate carry an explicit timeout sized for
  // the loaded case, and the file runs the gate THREE times, not ten (the first
  // version ran it ten: the baseline, then each canary planted and run again to
  // prove its restore, and four runs in the waiver test). The planted offenders
  // share one run (each in its own file, each asserted under its own heading), and
  // no test re-runs the gate just to prove its restore.
  const GATE_TIMEOUT_MS = 180_000;

  /**
   * Plant each text at the end of its victim, run the gate ONCE (`runGate`, which a
   * test may swap), and always restore. The restore is exception-safe: every file
   * is written back even if the gate run, the callback or an earlier write throws,
   * and each is then checked against its original. The blast radius is five tracked
   * files, so a failure to restore is thrown, never swallowed.
   */
  const withPlanted = async <T,>(
    plants: Array<[victim: string, text: string]>,
    fn: (r: GateRun) => T | Promise<T>,
    runGate: () => Promise<GateRun> = run,
  ): Promise<T> => {
    const originals = plants.map(([victim]) => rf(victim, "utf8"));
    try {
      plants.forEach(([victim, text], i) => wf(victim, `${originals[i]}\n${text}\n`, "utf8"));
      return await fn(await runGate());
    } finally {
      const failures: string[] = [];
      plants.forEach(([victim], i) => {
        try {
          wf(victim, originals[i], "utf8");
          // The restore is checked on the file itself: stricter than a green gate, and free.
          if (rf(victim, "utf8") !== originals[i]) failures.push(`${victim} is not back to its original`);
        } catch (e) {
          failures.push(`${victim}: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
      if (failures.length > 0) throw new Error(`restore failed: ${failures.join("; ")}`);
    }
  };

  const HEADINGS = ["Inter font imports:", "Roboto/Arial AI-default fonts:", "Purple-on-white SaaS gradients:"];
  /** The part of the gate's output under one heading, up to the next heading. */
  const section = (out: string, heading: string): string => {
    const start = out.indexOf(heading);
    if (start < 0) return "";
    const ends = HEADINGS.filter((h) => h !== heading).map((h) => out.indexOf(h, start + heading.length)).filter((i) => i >= 0);
    return out.slice(start, ends.length ? Math.min(...ends) : undefined);
  };

  // The offenders, each in its own tracked file under a scanned path.
  const PURPLE_VICTIM = "components/ui/glass-card.tsx";
  const INTER_VICTIM = "components/ui/separator.tsx";
  const ROBOTO_VICTIM = "components/ui/textarea.tsx";
  const WAIVER_VICTIM = "components/ui/tooltip.tsx";
  const WAIVER_ONLY_VICTIM = "components/ui/badge.tsx";
  const waivedLine = '// anti-slop-allow 2026-09-16 canary <div className="from-purple-500 to-purple-700" />';
  const freshHit = '// canary <div className="from-purple-400 to-purple-600" />';

  // Run lazily, once, by whichever offender test asks first.
  let sharedRun: Promise<GateRun> | undefined;
  const plantedRun = () =>
    (sharedRun ??= withPlanted(
      [
        [PURPLE_VICTIM, '// canary <div className="bg-gradient-to-r from-purple-500 to-purple-700" />'],
        [INTER_VICTIM, 'import { Inter } from "next/font/google";'],
        [ROBOTO_VICTIM, 'import { Roboto } from "next/font/google";'],
        [WAIVER_VICTIM, `${waivedLine}\n${freshHit}`],
      ],
      (r) => r,
    ));

  it("passes on the current tree, with the worker's event loop free while bash runs", async () => {
    // A 50 ms ticker measures the longest stretch the loop was blocked. A synchronous
    // spawn blocks it for the whole run (that is what starved the runner's RPC);
    // an async one leaves only small gaps. The bound is relative to the run, so a
    // loaded machine that slows both does not fail it.
    let last = Date.now();
    let maxGap = 0;
    const ticker = setInterval(() => {
      const now = Date.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
    }, 50);
    const started = Date.now();
    const r = await run();
    const elapsed = Date.now() - started;
    // One more turn of the loop, so a ticker that was starved gets to record its gap
    // before it is cleared; without this a blocked loop reads as maxGap 0.
    await new Promise((resolve) => setTimeout(resolve, 100));
    clearInterval(ticker);

    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("no anti-slop UI patterns");
    expect(maxGap, `the event loop was blocked for ${maxGap} ms of a ${elapsed} ms gate run`).toBeLessThan(elapsed / 2);
  }, GATE_TIMEOUT_MS);

  it("CANARY: a purple SaaS gradient turns it red and names the file", async () => {
    const r = await plantedRun();
    expect(r.code, "the gate did not fire on a planted purple gradient").toBe(1);
    expect(section(r.out, "Purple-on-white SaaS gradients:"), "the purple victim is not named under its heading").toContain(PURPLE_VICTIM);
  }, GATE_TIMEOUT_MS);

  it("CANARY: an Inter font import turns it red and names the file", async () => {
    const r = await plantedRun();
    expect(r.code, "the gate did not fire on a planted Inter import").toBe(1);
    expect(section(r.out, "Inter font imports:"), "the Inter victim is not named under its heading").toContain(INTER_VICTIM);
  }, GATE_TIMEOUT_MS);

  it("CANARY: a Roboto import in the canonical order turns it red (same order-bug)", async () => {
    // The Roboto/Arial alternation carried the identical defect as the Inter
    // one and was fixed in the same pass. Proven here so the fix cannot silently
    // regress the way the original did.
    const r = await plantedRun();
    expect(r.code, "the gate did not fire on a planted Roboto import").toBe(1);
    expect(section(r.out, "Roboto/Arial AI-default fonts:"), "the Roboto victim is not named under its heading").toContain(ROBOTO_VICTIM);
  }, GATE_TIMEOUT_MS);

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
  // Half 1 — the marker really exempts its own line, or the "fires" half
  // below would be indistinguishable from a gate that ignores waivers. It needs a
  // run with no other offender in the tree, so it keeps its own.
  it("the waiver is BY SIGNATURE (1/2): a waived line passes", async () => {
    await withPlanted([[WAIVER_ONLY_VICTIM, waivedLine]], (r) => {
      expect(r.code, `a line carrying anti-slop-allow was reported anyway:\n${r.out}`).toBe(0);
    });
  }, GATE_TIMEOUT_MS);

  // Half 2 — and the exemption does not spread to the file. If waivers were
  // file-scoped the fresh hit planted beside the waived line would be invisible,
  // which is the exact blindness the script's comment says was avoided. It
  // shares the offenders' run: the victim holds a waived line and a fresh hit.
  it("the waiver is BY SIGNATURE (2/2): a NEW hit in that same FILE still fires", async () => {
    const r = await plantedRun();
    expect(r.code).toBe(1);
    expect(
      section(r.out, "Purple-on-white SaaS gradients:"),
      "a new purple gradient beside a waived one was not reported — the waiver is file-scoped",
    ).toContain(WAIVER_VICTIM);
  }, GATE_TIMEOUT_MS);

  // The blast radius of a failed restore is five tracked files, so the restore is
  // pinned on its own, with scratch files that are not in the repo: no gate run, and
  // nothing in the tree to leave dirty if this very helper regresses.
  describe("planted files are put back even when the run throws", () => {
    const { mkdtempSync, rmSync } = require("node:fs") as typeof import("node:fs");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const { join } = require("node:path") as typeof import("node:path");

    const scratch = (...names: string[]) => {
      const dir = mkdtempSync(join(tmpdir(), "anti-slop-restore-"));
      const files = names.map((name, i) => {
        const path = join(dir, name);
        wf(path, `original ${i}\n`, "utf8");
        return path;
      });
      return { dir, files, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
    };

    it("a gate run that throws still restores every planted file, and the error surfaces", async () => {
      const { files, cleanup } = scratch("a.tsx", "b.tsx", "c.tsx");
      const originals = files.map((f) => rf(f, "utf8"));
      const seenPlanted: boolean[] = [];
      try {
        await expect(
          withPlanted(
            files.map((f) => [f, "PLANTED"] as [string, string]),
            () => undefined,
            async () => {
              // the files really were planted when the gate would have run
              seenPlanted.push(...files.map((f) => rf(f, "utf8").includes("PLANTED")));
              throw new Error("spawn failed");
            },
          ),
        ).rejects.toThrow("spawn failed");

        expect(seenPlanted).toEqual([true, true, true]);
        expect(files.map((f) => rf(f, "utf8"))).toEqual(originals);
      } finally {
        cleanup();
      }
    });

    it("a callback that throws (a failed assertion) still restores", async () => {
      const { files, cleanup } = scratch("a.tsx", "b.tsx");
      const originals = files.map((f) => rf(f, "utf8"));
      try {
        await expect(
          withPlanted(
            files.map((f) => [f, "PLANTED"] as [string, string]),
            () => {
              throw new Error("assertion failed");
            },
            async () => ({ code: 0, out: "" }),
          ),
        ).rejects.toThrow("assertion failed");

        expect(files.map((f) => rf(f, "utf8"))).toEqual(originals);
      } finally {
        cleanup();
      }
    });

    it("one file that cannot be written back does not stop the others being restored, and the failure is thrown", async () => {
      const { files, cleanup } = scratch("a.tsx", "b.tsx", "c.tsx");
      const [first, second, third] = files;
      const originalThird = rf(third, "utf8");
      try {
        await expect(
          withPlanted(
            files.map((f) => [f, "PLANTED"] as [string, string]),
            () => undefined,
            async () => {
              // make the FIRST restore impossible: replace the file with a directory of the same name
              rmSync(first, { force: true });
              require("node:fs").mkdirSync(first);
              return { code: 0, out: "" };
            },
          ),
        ).rejects.toThrow(/restore failed/);

        expect(rf(second, "utf8")).toBe("original 1\n");
        expect(rf(third, "utf8")).toBe(originalThird);
      } finally {
        cleanup();
      }
    });

    it("CONTROL: a normal run restores too, and returns the callback's value", async () => {
      const { files, cleanup } = scratch("a.tsx");
      const original = rf(files[0], "utf8");
      try {
        const value = await withPlanted([[files[0], "PLANTED"]], (r) => `${r.code}:${r.out}`, async () => ({ code: 7, out: "x" }));
        expect(value).toBe("7:x");
        expect(rf(files[0], "utf8")).toBe(original);
      } finally {
        cleanup();
      }
    });
  });
});
