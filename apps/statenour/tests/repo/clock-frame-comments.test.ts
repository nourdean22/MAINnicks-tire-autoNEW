/**
 * A comment must not assert the frame the line beside it stopped using.
 *
 * THE ARTEFACT. `operating-rhythm.ts:278` read:
 *
 *     const dayOfWeek = weekdayET(); // 0=Sun, 6=Sat (UTC OK · close enough at 11am ET)
 *
 * The call had been corrected to `weekdayET()`. The comment still said UTC was
 * fine. That is worse than either half alone — a wrong line is a bug someone
 * finds, but a wrong comment on a RIGHT line is a trap: the next reader trusts
 * it, concludes the frame does not matter here, and reintroduces the defect
 * somewhere the reasoning does not hold.
 *
 * It was also a true statement that generalised into a false rule. 11am ET is
 * 15:00 or 16:00 UTC — same weekday, so "close enough" happened to be true at
 * that hour. At 8pm ET it is the next UTC day and the weekday is simply wrong,
 * which is the whole reason the ET clock work happened.
 *
 * WHY A GATE RATHER THAN JUST THE FIX. This is a residue class, not a one-off:
 * every line the clock migration touched could have kept its pre-migration
 * comment, and a stale comment is invisible to typecheck, lint and every test in
 * the suite. Nothing else in this repo can see it. Measured at the time of
 * writing: exactly ONE instance across app/ lib/ components/ config/, now zero,
 * so this ships green and catches the next one.
 *
 * SCOPE, deliberately narrow. Only a UTC claim on a line that CALLS an
 * ET-anchored helper. Not every mention of UTC — plenty are correct, and a rule
 * wider than its invariant grows an exemption list, which is how a gate becomes
 * decoration.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** The ET-anchored helpers. A UTC claim beside one of these is a contradiction. */
const ET_CALL = /\b(hourET|weekdayET|todayET|toDateString|startOfDayET|startOfWeekET|startOfMonthET|startOfYearET|etCalendarParts|recentMondaysET)\s*\(/;

/** A trailing or leading line comment that claims UTC. */
const UTC_CLAIM = /\/\/.*\bUTC\b/i;

/** Returns the 1-indexed lines where a UTC claim sits on an ET-calling line. */
function contradictoryFrameComments(src: string): number[] {
  const out: number[] = [];
  src.split("\n").forEach((line, i) => {
    if (ET_CALL.test(line) && UTC_CLAIM.test(line)) out.push(i + 1);
  });
  return out;
}

function sourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "--", "app", "lib", "components", "config"], {
    encoding: "utf8",
    maxBuffer: 32e6,
  })
    .split("\n")
    .map((l) => l.trim())
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
}

describe("clock-frame comments · the comment must not contradict the call", () => {
  it("POSITIVE CONTROL: it catches the exact line that shipped", () => {
    // Synthetic, owned by this test — verbatim the artefact from
    // operating-rhythm.ts:278 before the fix.
    const artefact = "  const dayOfWeek = weekdayET(); // 0=Sun, 6=Sat (UTC OK - close enough at 11am ET)";
    expect(contradictoryFrameComments(artefact)).toEqual([1]);
    // And the same shape on the other ET helpers.
    expect(contradictoryFrameComments("const h = hourET(now); // UTC is fine here")).toEqual([1]);
  });

  it("NEGATIVE CONTROL: correct pairings and honest UTC talk are not flagged", () => {
    // An ET call with an ET comment.
    expect(contradictoryFrameComments("const d = weekdayET(); // 0=Sun, read in ET")).toEqual([]);
    // A UTC comment on a line that does NOT call an ET helper — often correct,
    // e.g. describing genuinely UTC-based arithmetic.
    expect(contradictoryFrameComments("const t = d.getUTCDay(); // UTC weekday, deliberate")).toEqual([]);
    // Prose ABOUT the trap must not trip it, or this file fails on itself.
    expect(contradictoryFrameComments("// the old comment said UTC OK beside weekdayET")).toEqual([]);
    expect(contradictoryFrameComments("const d = weekdayET();")).toEqual([]);
  });

  it("no line asserts UTC while calling an ET-anchored helper", () => {
    const files = sourceFiles();
    expect(files.length, "git ls-files returned nothing — the sweep had no subject").toBeGreaterThan(100);
    const offenders = files.flatMap((f) => {
      const lines = contradictoryFrameComments(readFileSync(f, "utf8"));
      return lines.map((n) => `${f}:${n}`);
    });
    expect(
      offenders,
      "the comment claims UTC on a line that reads ET. Fix the comment — a wrong " +
        "comment on a right line is a trap the next reader walks into:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("the ET helper list is real — otherwise the rule matches nothing", () => {
    // Without this, a typo'd helper name would make the sweep vacuous and green
    // forever, which is the failure mode of every gate that ever shipped broken.
    const datetime = readFileSync("lib/utils/datetime.ts", "utf8");
    for (const name of ["hourET", "weekdayET", "startOfWeekET"]) {
      expect(datetime, `${name} must exist for the rule to mean anything`).toContain(
        `export function ${name}`,
      );
      expect(ET_CALL.test(`${name}(now)`), `${name} must be matched by ET_CALL`).toBe(true);
    }
  });
});
