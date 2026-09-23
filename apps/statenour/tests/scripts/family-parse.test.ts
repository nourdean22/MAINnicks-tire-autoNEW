/**
 * Canaries for the tier-4 family probe's parsing.
 *
 * WHY THIS FILE EXISTS. The probe's conclusions were shipped — into a PR body,
 * into agent memory, and into a DO-NOT-FIX comment at the `addMatching` call
 * site — while the regexes behind them had no test at all. Review found the
 * first consequence within a day: the scanner read RAW source and counted an
 * `addMatching(/file/i)` that lives inside a COMMENT as a live family.
 *
 * An instrument whose output becomes a standing instruction needs the same
 * canary discipline as a gate. Each test below breaks one property.
 */
import { describe, it, expect } from "vitest";
import {
  stripCommentsKeepingLines,
  parseFamilies,
  findTrigger,
  tokenStarts,
  matchesAtTokenStart,
  classifyReachability,
} from "../../scripts/lib/family-parse.mjs";

describe("stripCommentsKeepingLines", () => {
  it("CANARY: strips a line comment on BOTH LF and CRLF", () => {
    // `.` excludes `\r` in a JS regex, so an unnormalised stripper silently
    // no-ops on a CRLF checkout — and .gitattributes gives CI LF, so CI would
    // pass while a Windows tree failed. Measured live in this repo.
    const body = "const a = 1;\n// addMatching(/ghost/i) in prose\nconst b = 2;\n";
    for (const [label, src] of [
      ["LF", body],
      ["CRLF", body.replace(/\n/g, "\r\n")],
    ] as const) {
      const out = stripCommentsKeepingLines(src);
      expect(out, `${label}: line comment survived`).not.toContain("ghost");
      expect(out, `${label}: real code destroyed`).toContain("const b = 2;");
    }
  });

  it("PRESERVES line numbers across a multi-line block comment", () => {
    // Collapsing the block would shift every later line, so the probe would
    // cite chat-mode.ts:NNN pointing at unrelated code. A wrong citation sends
    // the next reader somewhere else entirely.
    const src = "a\n/* one\n   two\n   three */\nb\n";
    const out = stripCommentsKeepingLines(src);
    expect(out.split("\n").length).toBe(src.split("\n").length);
    expect(out.split("\n")[4]).toBe("b");
  });
});

describe("parseFamilies", () => {
  const SRC = [
    "if (/\\b(alpha)\\b/.test(text)) {",
    "  addMatching(/real|first/i);",
    "}",
    "// addMatching(/ghost/i) — this one is PROSE and must never be counted",
    "/*",
    " * addMatching(/blockghost/i) also prose",
    " */",
    "if (/\\b(beta)\\b/.test(text)) {",
    "  addMatching(/second/i);",
    "}",
    "",
  ].join("\n");

  it("CANARY: a commented-out addMatching is NOT a family", () => {
    const fams = parseFamilies(SRC);
    const srcs = fams.map((f) => f.src);
    expect(srcs).toEqual(["/real|first/i", "/second/i"]);
    expect(srcs.join(",")).not.toContain("ghost");
  });

  it("POSITIVE CONTROL: the executable ones ARE found", () => {
    // Without this, a parser that found NOTHING would satisfy the canary above.
    expect(parseFamilies(SRC).length).toBe(2);
  });

  it("reports the line of the EXECUTABLE call, not a shifted one", () => {
    const fams = parseFamilies(SRC);
    expect(fams[0].line).toBe(2);
    // Line 9 in the source; a block-collapsing stripper would report it earlier.
    expect(fams[1].line).toBe(9);
  });

  it("associates each family with its enclosing trigger", () => {
    const fams = parseFamilies(SRC);
    expect(fams[0].trigger).toContain("alpha");
    expect(fams[1].trigger).toContain("beta");
    expect(fams[0].trigger).not.toBe(fams[1].trigger);
  });
});

describe("findTrigger", () => {
  it("returns null rather than guessing when no if is in range", () => {
    // Null must mean UNKNOWN. `classifyReachability` treats it as "cannot prove
    // equivalence", which is the safe reading; returning a bogus trigger would
    // let two unrelated families look interchangeable.
    expect(findTrigger(["addMatching(/x/i);"], 1)).toBeNull();
  });
});

describe("token-boundary matching", () => {
  it("tokenStarts splits camelCase, underscores and dots", () => {
    expect([...tokenStarts("getHabitRevenueCorrelation")]).toEqual([0, 3, 8, 15]);
    expect([...tokenStarts("arsenal.webSearch")]).toEqual([0, 8, 11]);
  });

  it("CANARY: the real collisions are rejected, the real matches kept", () => {
    const p = (s: string) => ({ reAll: new RegExp(s, "gi") });
    // cor-RELATION: the specimen. "relation" starts mid-token, so it must NOT match.
    expect(matchesAtTokenStart(p("relation"), "getHabitRevenueCorrelation")).toBe(false);
    // ...while the legitimate family for the same tool still does.
    expect(matchesAtTokenStart(p("revenue"), "getHabitRevenueCorrelation")).toBe(true);
    // com-MIT-ments / com-MIT-s
    expect(matchesAtTokenStart(p("mit"), "checkCommitments")).toBe(false);
    expect(matchesAtTokenStart(p("mit"), "githubRecentCommits")).toBe(false);
    expect(matchesAtTokenStart(p("commit"), "checkCommitments")).toBe(true);
    // An exact-name family begins at offset 0, which IS a token boundary.
    expect(matchesAtTokenStart(p("scoreLocation"), "scoreLocation")).toBe(true);
    // Prefix match on a plural token still works: "lead" -> "Leads".
    expect(matchesAtTokenStart(p("lead"), "arsenalFindLeads")).toBe(true);
  });
});

describe("classifyReachability · trigger-aware", () => {
  const fam = (src: string, trigger: string | null) => ({
    src,
    re: new RegExp(src, "i"),
    reAll: new RegExp(src, "gi"),
    trigger,
  });

  it("SAFE when the surviving family shares the lost one's trigger", () => {
    const pats = [fam("relation", "if (/goals/)"), fam("revenue", "if (/goals/)")];
    expect(classifyReachability(pats, "getHabitRevenueCorrelation").verdict).toBe("safe");
  });

  it("CANARY: CONDITIONALLY dark when the survivor sits behind a DIFFERENT trigger", () => {
    // This is the case the first version of the probe scored as plainly safe,
    // which turned an upper bound on safety into a stated certainty.
    // getCommitments loses /mit/ (guarded by the OKR/goal trigger) and keeps
    // /commit/ (guarded by the task trigger) — so on "what are my OKRs?" the
    // surviving family never fires and the tool IS dark for that phrasing.
    const pats = [fam("mit", "if (/okr|goal/)"), fam("commit", "if (/task|todo/)")];
    const r = classifyReachability(pats, "getCommitments");
    expect(r.verdict).toBe("conditionally");
    expect(r.lost.map((p) => p.src)).toEqual(["mit"]);
  });

  it("an UNKNOWN trigger can never prove equivalence", () => {
    const pats = [fam("mit", null), fam("commit", null)];
    expect(classifyReachability(pats, "getCommitments").verdict).toBe("conditionally");
  });

  it("DARK when nothing survives, UNCHANGED when nothing is lost", () => {
    expect(classifyReachability([fam("relation", "t")], "getHabitRevenueCorrelation").verdict).toBe("dark");
    expect(classifyReachability([fam("revenue", "t")], "getHabitRevenueCorrelation").verdict).toBe("unchanged");
  });
});
