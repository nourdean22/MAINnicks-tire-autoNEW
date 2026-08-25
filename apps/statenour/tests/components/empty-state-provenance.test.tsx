/**
 * An empty panel must say WHY it is empty, and must not claim an all-clear it
 * did not measure.
 *
 * THE DEFECT, found live in four panels at once. `EmptyState` had no way to
 * distinguish "we measured and it's zero" from "we never looked" from "the read
 * failed". So the panels guessed in prose — their own copy confesses it:
 *
 *   discover-tab              "…has a verdict, OR the engines found nothing"
 *   contradiction-resolution  "EITHER you've been coherent OR the detector
 *                              hasn't seen friction yet"
 *
 * And where a panel did not hedge, it asserted the happy case. Three of them
 * shared one idiom — `?? (query.isError ? [] : null)` — which turns a FAILED
 * READ into an empty array. Downstream that is indistinguishable from a real
 * zero, so:
 *
 *   nudge-panel               a failed query rendered a GREEN "In rhythm ·
 *                             Silence here = all subsystems stable" across the
 *                             nine subsystems it had just failed to read.
 *   contradiction-resolution  a failed query rendered a GREEN "Clean ledger ·
 *                             Nick's stated positions are internally
 *                             consistent" — a read that failed, reported as
 *                             proof the self-model is coherent.
 *   skill-library-panel       no error branch at all: a failed fetch rendered
 *                             "No candidates yet" and two siblings like it.
 *
 * That is the lying-surface shape. Not an absent signal — a confident wrong one,
 * which is strictly worse, because an absent signal prompts a question.
 *
 * WHAT ENFORCES IT NOW. Two mechanisms, both behavioural:
 *
 *   1. TYPE. `tone: "positive"` is only representable with `provenance: "ZERO"`.
 *      An all-clear is a claim about a measurement. `components/` and `app/` are
 *      inside tsconfig, so a false all-clear does not compile.
 *   2. SWEEP. Every <EmptyState> must pass `provenance`. No exemption list —
 *      the whole point is that a surface DECLARING NOTHING fails, which was the
 *      condition of all nine call sites before this change, not merely a wrong
 *      value here and there.
 */
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  EmptyState,
  PROVENANCE_LABEL,
  type EmptyProvenance,
} from "@/components/ui/empty-state";

describe("EmptyState · the rendered surface states its provenance", () => {
  it("a measured zero and an unmeasured surface do NOT render the same", () => {
    // The entire defect in one assertion. These were byte-identical before.
    const zero = renderToString(<EmptyState title="Nothing" provenance="ZERO" />);
    const unmeasured = renderToString(<EmptyState title="Nothing" provenance="UNMEASURED" />);
    expect(zero).not.toEqual(unmeasured);
    expect(zero).toContain(PROVENANCE_LABEL.ZERO);
    expect(unmeasured).toContain(PROVENANCE_LABEL.UNMEASURED);
  });

  it("every provenance renders a DISTINCT operator-facing label", () => {
    // Positive control on the labels themselves. Four states that rendered the
    // same string would satisfy "it has a label" while restoring the defect.
    const labels = Object.values(PROVENANCE_LABEL);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("an ERROR reads as unknown, and never as zero", () => {
    const html = renderToString(<EmptyState title="Nudges unavailable" provenance="ERROR" />);
    expect(html).toMatch(/unknown/i);
    expect(html).not.toMatch(/\bmeasured · zero\b/);
  });

  it("the provenance is machine-readable too, not only prose", () => {
    // So an e2e or a screenshot diff can assert on it without string-matching
    // copy that is expected to change.
    for (const p of ["ZERO", "UNMEASURED", "ERROR", "SUPPRESSED"] as EmptyProvenance[]) {
      expect(renderToString(<EmptyState title="x" provenance={p} />)).toContain(
        `data-provenance="${p}"`,
      );
    }
  });

  it("SUPPRESSED renders SOMETHING — a hidden panel must not look like a broken one", () => {
    // The fourth state exists for exactly this. A component that returns null
    // is indistinguishable from one that threw, which is how self-critique-card
    // sat blank for weeks while returning 200s.
    const html = renderToString(<EmptyState title="Self-critique" provenance="SUPPRESSED" />);
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain(PROVENANCE_LABEL.SUPPRESSED);
  });

  it("POSITIVE CONTROL: a normal render still works and is not all chrome", () => {
    // Without this, an implementation that rendered only the provenance chip
    // would pass every assertion above while deleting the actual empty state.
    const html = renderToString(
      <EmptyState
        title="No active beliefs yet"
        provenance="ZERO"
        why="Beliefs are curated stated-positions."
        unlock="Promote a candidate above."
      />,
    );
    expect(html).toContain("No active beliefs yet");
    expect(html).toContain("Beliefs are curated stated-positions.");
    expect(html).toContain("Promote a candidate above.");
  });
});

describe("the repo rule: no surface declares nothing", () => {
  /**
   * Brace-aware, because `cta={{ label, onClick }}` contains `>`-free braces
   * that a naive scan to the first `>` would mis-terminate on.
   */
  function emptyStatesMissingProvenance(input: string): number[] {
    // Strip comments first. Both this component's own JSDoc and the tombstone
    // left in layout/ui.tsx write `<EmptyState ... />` as an EXAMPLE, and a
    // mention is not a render. Without this the sweep flags its own
    // documentation, which is the fastest way to get a gate switched off.
    const src = input.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const out: number[] = [];
    const re = /<EmptyState\b/g;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      let i = m.index + m[0].length;
      let depth = 0;
      let end = src.length;
      while (i < src.length) {
        const ch = src[i];
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        else if (depth === 0 && ch === "/" && src[i + 1] === ">") {
          end = i;
          break;
        } else if (depth === 0 && ch === ">") {
          end = i;
          break;
        }
        i++;
      }
      if (!/\bprovenance\s*=/.test(src.slice(m.index, end))) out.push(m.index);
    }
    return out;
  }

  function firstPartyFiles(): string[] {
    return execFileSync("git", ["ls-files", "--", "app", "components", "features", "hooks"], {
      encoding: "utf8",
      maxBuffer: 32e6,
    })
      .split("\n")
      .map((l) => l.trim())
      .filter((f) => f.endsWith(".tsx"));
  }

  it("POSITIVE CONTROL: it catches a surface that declares nothing", () => {
    // Synthetic, owned by this test. This is the shape ALL NINE call sites had
    // before this change — declaring nothing, not declaring wrongly.
    expect(emptyStatesMissingProvenance('<EmptyState title="x" why="y" />')).toHaveLength(1);
    // And it survives the multi-line, nested-brace form that actually appears.
    const real = [
      "<EmptyState",
      '  icon={Target}',
      '  title="No candidates yet"',
      "  cta={{ label: \"Extract now\", onClick: () => void extractNow() }}",
      '  tone="neutral"',
      "/>",
    ].join("\n");
    expect(emptyStatesMissingProvenance(real)).toHaveLength(1);
  });

  it("NEGATIVE CONTROL: a documented EXAMPLE is not a render", () => {
    // The false positive this detector shipped with. `empty-state.tsx` shows
    // usage in its own header and `layout/ui.tsx` records the removed rival in
    // a comment; flagging either would make the sweep unsatisfiable, which is
    // the fastest route to a gate being switched off.
    expect(emptyStatesMissingProvenance('/** usage: <EmptyState title="x" /> */')).toEqual([]);
    expect(
      emptyStatesMissingProvenance('// Use <EmptyState> from "@/components/ui/empty-state".'),
    ).toEqual([]);
  });

  it("NEGATIVE CONTROL: a declared surface passes, including a computed value", () => {
    expect(emptyStatesMissingProvenance('<EmptyState title="x" provenance="ZERO" />')).toEqual([]);
    expect(
      emptyStatesMissingProvenance(
        '<EmptyState title="x" provenance={q.isError ? "ERROR" : "UNMEASURED"} tone="warning" />',
      ),
    ).toEqual([]);
  });

  it("no first-party EmptyState omits provenance", () => {
    const files = firstPartyFiles();
    expect(files.length, "git ls-files returned nothing — the sweep had no subject").toBeGreaterThan(50);
    const offenders = files.flatMap((f) => {
      const src = readFileSync(f, "utf8");
      const hits = emptyStatesMissingProvenance(src);
      return hits.length ? [`${f} (${hits.length})`] : [];
    });
    expect(
      offenders,
      "these render an empty surface without saying why it is empty. Pass " +
        "provenance: ZERO (measured), UNMEASURED (never looked), ERROR (read " +
        "failed) or SUPPRESSED (hidden by design):\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("there is exactly ONE EmptyState component — a required prop needs no second door", () => {
    // components/layout/ui.tsx exported a rival taking only { title, copy }. It
    // had zero importers, but it was a live bypass: any surface could render
    // with no provenance at all just by importing the other one.
    //
    // Asserts the COUNT, not the path — moving or renaming the canonical file is
    // a legitimate change and must not fail this.
    const defs = firstPartyFiles().filter((f) =>
      /export function EmptyState\b/.test(readFileSync(f, "utf8")),
    );
    expect(defs, `more than one EmptyState definition:\n  ${defs.join("\n  ")}`).toHaveLength(1);
  });
});
