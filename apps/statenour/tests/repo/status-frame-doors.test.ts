/**
 * There is one way to render a status, and it carries a frame.
 *
 * WHY THIS EXISTS. #1870 removed `StatusBadge` from components/layout/ui.tsx —
 * a second, frameless path for putting a task's status on screen. A Codex review
 * raised a P1 against that commit and it was right: the door was removed with no
 * test, so nothing stopped the next shared badge from reopening it while the
 * suite stayed green. Removing a bypass without a canary is how the bypass comes
 * back.
 *
 * WHAT THE REMOVED DOOR ACTUALLY DID, because the rule is built on the
 * mechanism rather than on the name:
 *
 *     const tone = toneClassMap[statusToneMap[value] || "slate"] || "badge-slate";
 *     return <span className={`badge ${tone}`}>{toSentenceCase(value)}</span>;
 *
 * It took a raw status string and rendered it as a human label. `WAITING` became
 * "Waiting" with nothing saying whether that answered "where is this in its
 * lifecycle" or "was this done" — the operator finished his workout and read
 * WAITING. A null value rendered the word "Unknown", which cannot tell "no
 * status" from "status not read".
 *
 * `statusToneMap` is the tell. It is the status-keyed lookup any such badge
 * needs, and after #1870 it has ZERO importers. So the invariant is: nothing in
 * the UI may import it. The framed path is `describeCompletion`, which returns a
 * label AND the frame it is spoken in.
 *
 * COMPLEMENTARY TO, NOT A DUPLICATE OF, the sweep in completion-frame.test.ts.
 * That one catches a status LITERAL rendered as text (`<span>WAITING</span>`).
 * This one catches a status VARIABLE rendered through a lookup — which the
 * literal sweep cannot see, because `{toSentenceCase(value)}` contains no status
 * word at all. The removed badge would have passed that sweep untouched.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describeCompletion, hasDeclaredFrame } from "@/lib/services/completion-frame";

/** The status-keyed tone lookup a frameless badge needs. */
const DOOR = /from\s+["'][^"']*\/lib\/domain["']|statusToneMap/;

function uiFiles(): string[] {
  return execFileSync("git", ["ls-files", "--", "components", "app", "features"], {
    encoding: "utf8",
    maxBuffer: 32e6,
  })
    .split("\n")
    .map((l) => l.trim())
    .filter((f) => f.endsWith(".tsx"));
}

function opensTheDoor(src: string): boolean {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return /\bstatusToneMap\b/.test(code);
}

describe("no second, frameless way to render a status", () => {
  it("POSITIVE CONTROL: it catches the exact badge that was removed", () => {
    // Synthetic, owned by this test — the real body of the deleted StatusBadge.
    const bypass = [
      'import { statusToneMap } from "@/lib/domain";',
      'import { toSentenceCase } from "@/lib/utils/format";',
      "export function StatusBadge({ value }: { value: string }) {",
      '  const tone = toneClassMap[statusToneMap[value] || "slate"];',
      "  return <span className={`badge ${tone}`}>{toSentenceCase(value)}</span>;",
      "}",
    ].join("\n");
    expect(opensTheDoor(bypass), "the removed bypass must be detectable").toBe(true);
  });

  it("NEGATIVE CONTROL: the framed path and ordinary code are not flagged", () => {
    expect(
      opensTheDoor(
        [
          'import { describeCompletion } from "@/lib/services/completion-frame";',
          "const d = describeCompletion(task, new Date());",
          "return <p>{d.label}</p>;",
        ].join("\n"),
      ),
    ).toBe(false);
    // A mention in a comment is documentation, not a door — this file's own
    // tombstone in layout/ui.tsx says the word.
    expect(opensTheDoor("// statusToneMap was used by the removed StatusBadge")).toBe(false);
    expect(opensTheDoor("/* statusToneMap */")).toBe(false);
  });

  it("no UI file imports the status-tone lookup", () => {
    const files = uiFiles();
    expect(files.length, "git ls-files returned nothing — the sweep had no subject").toBeGreaterThan(50);
    const offenders = files.filter((f) => opensTheDoor(readFileSync(f, "utf8")));
    expect(
      offenders,
      "these can render a raw status as a human label with no frame — the shape " +
        "that had a completed workout reading WAITING. Use describeCompletion, " +
        "which returns a label AND the frame it is spoken in:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("FRAMED POSITIVE CONTROL: the sanctioned path still exists and still frames", () => {
    // Without this the rule is satisfiable by deleting status rendering
    // altogether. The point is not "no badges" — it is "one badge, and it says
    // which question it answers".
    const d = describeCompletion(
      { status: "WAITING", loopKind: "DAILY", lastCompletedAt: new Date().toISOString() },
      new Date(),
    );
    expect(hasDeclaredFrame(d), "the framed path must still declare a frame").toBe(true);
    expect(d.label.length).toBeGreaterThan(0);
    expect(d.label.toLowerCase(), "and must not degrade to the bare status").not.toBe("waiting");
  });

  it("and something still USES it — a framed path nobody calls is not a path", () => {
    const consumers = uiFiles().filter((f) =>
      readFileSync(f, "utf8").includes("@/lib/services/completion-frame"),
    );
    expect(
      consumers.length,
      "no surface imports completion-frame — the framed path is unwired, so this " +
        "whole rule is vacuous",
    ).toBeGreaterThan(0);
  });
});
