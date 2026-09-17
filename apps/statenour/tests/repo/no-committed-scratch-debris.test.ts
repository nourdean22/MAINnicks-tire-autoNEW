/**
 * Scratch artifacts may be created freely. They may not be COMMITTED.
 *
 * WHY THIS EXISTS, and it is earned rather than theoretical. The overnight run
 * that produced W12 (#2381-#2384) created roughly ten throwaway probe scripts
 * under `scripts/_tmp-*.ts` — live reads against production to answer questions
 * the repo could not: how often the pruner truncates, which instruments were
 * failing, whether a fix had fired yet. Every one of them was the right thing
 * to write, and every one was deleted by hand afterwards.
 *
 * By hand is the problem. Nothing would have caught the one I forgot. A probe
 * that survives into the tree is worse than clutter: it is an executable file
 * with production credentials in its import graph, named as if it were part of
 * the app, that no test covers and no reader can distinguish from a real script.
 *
 * WHAT THIS IS NOT. It does not police the working tree. Temporary files during
 * a session are the point — the rule is that a slice does not ship with them.
 * It scans TRACKED files only, so `git ls-files` is the subject and a local
 * `_tmp-probe.ts` sitting uncommitted is entirely fine.
 *
 * SCOPE, deliberately narrow. Only shapes that are unambiguous debris:
 * `_tmp*`, `.bak`, `.orig`, `.rej`. Measured 2026-09-17: ZERO tracked files in
 * the entire monorepo match, so this ships green with no allowlist and no
 * ratchet baseline — it is a floor, not a cleanup project.
 *
 * `apps/nickstire/scratch/` is EXCLUDED on purpose, and the reason matters:
 * ~45 tracked files live there and it is a DESIGNATED scratch directory, an
 * intentional choice by a different product. Debris is an accident; a named
 * scratch area is a decision. Flagging it would be both wrong and outside this
 * app's boundary.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

/** Unambiguous debris. Each shape is something a tool or an agent leaves behind. */
const DEBRIS = [
  { pattern: /(^|\/)_tmp/, label: "_tmp* — throwaway probe or scratch script" },
  { pattern: /\.bak$/, label: ".bak — a backup copy taken before an edit" },
  { pattern: /\.orig$/, label: ".orig — a merge/patch original" },
  { pattern: /\.rej$/, label: ".rej — a rejected patch hunk" },
];

/**
 * Designated scratch areas, which are decisions rather than accidents.
 * Every entry needs a reason; an unexplained exclusion is how a guard rots.
 */
const ALLOWED_PREFIXES: Array<{ prefix: string; reason: string }> = [
  {
    prefix: "apps/nickstire/scratch/",
    reason:
      "A designated scratch directory in a different product, ~45 tracked files, deliberate. " +
      "Not this app's boundary to police.",
  },
];

function trackedFiles(): string[] {
  // Repo root, not the app: debris in a sibling app or at the root is still
  // debris, and scoping to apps/statenour would let the worst cases through.
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function offendersIn(files: readonly string[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (ALLOWED_PREFIXES.some((a) => f.startsWith(a.prefix))) continue;
    const hit = DEBRIS.find((d) => d.pattern.test(f));
    if (hit) out.push(`${f}  — ${hit.label}`);
  }
  return out;
}

describe("no committed scratch debris", () => {
  it("POSITIVE CONTROL: the scanner sees a planted file of each debris shape", () => {
    // Without this, a broken pattern list or an empty file list would report a
    // clean repo forever — the blind-instrument shape this directory already
    // documents twice over. Every shape is proven to fire, not just one.
    const planted = [
      "apps/statenour/scripts/_tmp-probe.ts",
      "apps/statenour/lib/thing.ts.bak",
      "some/file.orig",
      "some/file.rej",
    ];
    const caught = offendersIn(planted);
    expect(caught).toHaveLength(planted.length);
    for (const shape of DEBRIS) {
      expect(
        caught.some((c) => c.endsWith(shape.label)),
        `the ${shape.label} rule never fired — that pattern is dead`,
      ).toBe(true);
    }
  });

  it("POSITIVE CONTROL: it does not fire on ordinary source files", () => {
    // A rule that flags everything is as useless as one that flags nothing, and
    // `_tmp` as a bare substring would catch innocent names.
    expect(
      offendersIn([
        "apps/statenour/lib/ai/chat-mode.ts",
        "apps/statenour/scripts/check-crons.ts",
        // These two exercise the ANCHOR specifically. The rule is `_tmp` at a
        // path boundary, not "tmp" anywhere — an unanchored substring match
        // would condemn both of these innocent names.
        "apps/statenour/lib/utils/tmpdir-helper.ts",
        "apps/statenour/lib/services/otmp-adapter.ts",
        "docs/TEMPLATE.md",
      ]),
    ).toEqual([]);
  });

  it("the scan has a real subject — git ls-files is not returning nothing", () => {
    // Guards the case where the command fails, the cwd is wrong, or the repo is
    // not a checkout: an empty list would make the assertion below vacuous.
    expect(trackedFiles().length).toBeGreaterThan(500);
  });

  it("no tracked file is scratch debris", () => {
    const offenders = offendersIn(trackedFiles());
    expect(
      offenders,
      `Committed scratch debris. Promote it into a maintained asset or delete it:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every allowlist entry carries a reason and still matches something", () => {
    // An exclusion that no longer applies is an invitation to hide a new mess
    // behind it. If nickstire's scratch dir is ever cleaned up, this fails and
    // the entry gets deleted rather than quietly widening the guard's blind spot.
    const files = trackedFiles();
    for (const a of ALLOWED_PREFIXES) {
      expect(a.reason.length, `${a.prefix} has no reason`).toBeGreaterThan(30);
      expect(
        files.some((f) => f.startsWith(a.prefix)),
        `${a.prefix} matches nothing any more — delete the entry instead of leaving a hole`,
      ).toBe(true);
    }
  });
});
