/**
 * A Prisma-interpolated number reaching an INTEGER `make_interval` parameter
 * must carry `::int` (2026-09-16).
 *
 * WHY THIS EXISTS. `lib/observability/tool-usage-census.ts` shipped two raw
 * queries filtering on `now() - make_interval(days => ${days})`. Prisma binds
 * a JS number as int8; `make_interval`'s day parameter is int4 and a
 * named-argument call gets no implicit int8 -> int4 cast. So both queries
 * threw `42883` on EVERY call, `getSurfacedStats` returned null every time,
 * and the census rendered "no surfacing data exists in the window yet" for
 * three weeks over 456 `tool.surfaced` rows that did exist.
 *
 * Measured before writing it, at both layers:
 *
 *   prod SQL   SELECT now() - make_interval(days => 30::bigint)
 *              -> function make_interval(days => bigint) does not exist
 *   Prisma     $queryRaw`... make_interval(days => ${days})`      -> THREW 42883
 *              $queryRaw`... make_interval(days => ${days}::int)` -> OK
 *
 * WHY A STATIC SCAN. `pnpm check:raw-sql` cannot see a signature mismatch —
 * the SQL is valid, it just resolves to no function — and no test executes
 * these queries, which is exactly why this shipped and survived. Nothing here
 * asserts "did not throw": the production code SWALLOWS the throw, so a
 * no-throw assertion would pass against the broken version too. The subject is
 * the cast itself.
 *
 * `secs` IS NOT AN INTEGER PARAMETER, and the first cut of this file got that
 * wrong (Codex P2 on #2359). The real signature is
 *
 *   make_interval(years int, months int, weeks int, days int,
 *                 hours int, mins int, secs double precision)
 *
 * so a correct `make_interval(secs => ${seconds}::double precision)` would
 * have failed this gate, and "fixing" it to `::int` truncates the interval.
 * A gate that forces an incorrect change is worse than one that merely nags.
 * `secs` needs no cast at all — int8 -> float8 is an IMPLICIT cast in
 * Postgres, so a whole-number JS value resolves too. Only the six integer
 * parameters are enforced, by name or by position.
 *
 * THE MATCHER IS INTERPOLATION-AWARE, and the first cut got that wrong too
 * (the second Codex P2, and the more serious of the pair). It counted every
 * `(` and `)` as SQL syntax, so
 *
 *   make_interval(days => ${parseInt(value.replace(")", ""))})
 *
 * ended the argument block at the quoted `)`, the brace matcher then found no
 * closing `}`, and the loop skipped the violation — the gate reported CLEAN on
 * a genuinely uncast value. That is the same fail-open shape this file exists
 * to catch, inside the file itself. `walkArgs` now treats a `${…}` expression
 * as opaque: its parens, commas and quotes are TypeScript, not SQL. The
 * evasion ships below as an instrument control.
 *
 * SCOPE IS DELIBERATELY NARROW. Only `make_interval`. Postgres has other
 * int4-only functions, but a rule wide enough to guess at them would invent
 * false positives in queries nobody has measured. Widen it when a second
 * function is caught the same way, with the same kind of receipt.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

/**
 * `make_interval`'s positional order. The first six are `int`; `secs` (index
 * 6) is `double precision` and is deliberately absent from the enforced set.
 */
const INTERVAL_PARAMS = ["years", "months", "weeks", "days", "hours", "mins", "secs"] as const;
const INT_PARAMS = new Set(INTERVAL_PARAMS.slice(0, 6));

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "app", "lib", "scripts"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
}

/**
 * Comments are not queries. Without this, the repair note in
 * tool-usage-census.ts — which quotes the broken form verbatim so the next
 * reader understands what was fixed — would itself fail the scan, and the only
 * way to green would be to delete the documentation. Same shape, same reason,
 * as `stripComments` in tests/repo/honest-counter-consumers.test.ts.
 */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

interface Segment {
  /** The argument's text, e.g. `days => ${days}::int`. */
  text: string;
  /** Spans of `${…}` inside `text`, as [startOfDollar, endExclusive). */
  interpolations: Array<[number, number]>;
}

/**
 * Split a `make_interval(...)` argument list into top-level arguments.
 *
 * A `${…}` expression is OPAQUE: parens, commas and quotes inside it are
 * TypeScript and must not be read as SQL. That is the whole repair for the
 * `${parseInt(v.replace(")", ""))}` evasion — the scanner never looks inside
 * the braces, so nothing in there can unbalance the SQL.
 */
export function walkArgs(args: string): Segment[] {
  const segments: Segment[] = [];
  let depth = 0; // SQL paren depth, e.g. GREATEST(1, x)
  let start = 0;
  let interpolations: Array<[number, number]> = [];

  for (let i = 0; i < args.length; i++) {
    const c = args[i];

    if (c === "$" && args[i + 1] === "{") {
      const from = i;
      let braces = 1;
      let quote: string | null = null;
      i += 2;
      for (; i < args.length && braces > 0; i++) {
        const d = args[i];
        if (quote) {
          if (d === "\\") i++;
          else if (d === quote) quote = null;
          continue;
        }
        if (d === "'" || d === '"' || d === "`") quote = d;
        else if (d === "{") braces++;
        else if (d === "}") braces--;
      }
      // i now sits one past the closing brace; the for-loop's i++ would skip a
      // character, so step back one.
      interpolations.push([from - start, i - start]);
      i--;
      continue;
    }

    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      segments.push({ text: args.slice(start, i), interpolations });
      interpolations = [];
      start = i + 1;
    }
  }
  segments.push({ text: args.slice(start), interpolations });
  return segments;
}

/** The argument list of the `make_interval(` whose `(` sits at `open`. */
export function intervalArgsAt(src: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "$" && src[i + 1] === "{") {
      let braces = 1;
      let quote: string | null = null;
      i += 2;
      for (; i < src.length && braces > 0; i++) {
        const d = src[i];
        if (quote) {
          if (d === "\\") i++;
          else if (d === quote) quote = null;
          continue;
        }
        if (d === "'" || d === '"' || d === "`") quote = d;
        else if (d === "{") braces++;
        else if (d === "}") braces--;
      }
      i--;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

/** Which `make_interval` parameter a segment targets, by name or by position. */
export function segmentParam(seg: Segment, index: number): string | null {
  const named = seg.text.match(/^\s*([A-Za-z_]\w*)\s*=>/);
  if (named) return named[1];
  return INTERVAL_PARAMS[index] ?? null;
}

/**
 * Every interpolation reaching an INTEGER `make_interval` parameter without an
 * explicit int cast. Returns the offending argument text, trimmed.
 */
export function uncastIntervalArgs(rawSrc: string): string[] {
  const src = stripComments(rawSrc);
  const out: string[] = [];
  for (const m of src.matchAll(/make_interval\s*\(/g)) {
    const args = intervalArgsAt(src, m.index + m[0].length - 1);
    if (args === null) continue;
    const segments = walkArgs(args);
    segments.forEach((seg, i) => {
      const param = segmentParam(seg, i);
      if (param === null || !INT_PARAMS.has(param as never)) return; // secs, or past the signature
      for (const [, end] of seg.interpolations) {
        if (!/^\s*::\s*(int|int4|integer)\b/.test(seg.text.slice(end))) {
          out.push(seg.text.replace(/\s+/g, " ").trim());
        }
      }
    });
  }
  return out;
}

describe("raw SQL · make_interval never receives an uncast Prisma number", () => {
  it("no tracked file interpolates into an integer make_interval param without ::int", () => {
    const found: string[] = [];
    for (const file of trackedFiles()) {
      const src = readFileSync(join(ROOT, file), "utf8");
      if (!src.includes("make_interval")) continue;
      for (const hit of uncastIntervalArgs(src)) found.push(`${file}: make_interval(${hit})`);
    }
    expect(
      found,
      "Prisma binds a JS number as int8 and make_interval's integer params have no int8 overload, " +
        "so each of these throws 42883 on EVERY call — add `::int` to the interpolation:\n" +
        found.join("\n"),
    ).toEqual([]);
  });

  it("the detector fires on the exact shape that shipped (instrument control)", () => {
    expect(uncastIntervalArgs("created_at > now() - make_interval(days => ${days})")).toEqual(["days => ${days}"]);
    // positional form, and a computed interpolation whose own parens must not
    // confuse the scan
    expect(uncastIntervalArgs("make_interval(0, 0, 0, ${Math.floor(n)})")).toHaveLength(1);
    // two offenders in one file are both reported, not just the first
    expect(uncastIntervalArgs("a make_interval(days => ${d}) b make_interval(days => ${e})")).toHaveLength(2);
  });

  it("the detector accepts every spelling of the repaired shape", () => {
    expect(uncastIntervalArgs("make_interval(days => ${days}::int)")).toEqual([]);
    expect(uncastIntervalArgs("make_interval(days => ${days}::integer)")).toEqual([]);
    expect(uncastIntervalArgs("make_interval(days => ${days} :: int4)")).toEqual([]);
    // a literal needs no cast — Postgres types an untyped literal as int4
    expect(uncastIntervalArgs("make_interval(days => 30)")).toEqual([]);
  });

  it("`secs` is double precision, so it is NOT required to be an int", () => {
    // Codex P2 on #2359. Demanding ::int here would truncate the interval, and
    // a gate that forces an incorrect change is worse than one that nags.
    expect(uncastIntervalArgs("make_interval(secs => ${seconds}::double precision)")).toEqual([]);
    expect(uncastIntervalArgs("make_interval(secs => ${seconds})")).toEqual([]);
    // positional: index 6 is secs, index 5 is mins and is still enforced
    expect(uncastIntervalArgs("make_interval(0, 0, 0, 0, 0, 0, ${s})")).toEqual([]);
    expect(uncastIntervalArgs("make_interval(0, 0, 0, 0, 0, ${m})")).toHaveLength(1);
    // …and a mixed call still catches the integer half
    expect(uncastIntervalArgs("make_interval(days => ${d}, secs => ${s})")).toEqual(["days => ${d}"]);
  });

  it("a quoted parenthesis inside an interpolation cannot blind the scan", () => {
    // Codex P2 on #2359, and the more serious of the pair: the first cut
    // counted the quoted `)` as SQL, truncated the argument block, found no
    // closing brace, and SKIPPED the violation — reporting clean on an uncast
    // value. Fail-open, the exact shape this file exists to catch.
    const evasion = 'make_interval(days => ${parseInt(value.replace(")", ""))})';
    expect(uncastIntervalArgs(evasion)).toHaveLength(1);
    // the same evasion with the cast present must still pass
    expect(uncastIntervalArgs('make_interval(days => ${parseInt(value.replace(")", ""))}::int)')).toEqual([]);
    // braces and commas inside the expression are TypeScript too
    expect(uncastIntervalArgs("make_interval(days => ${fn({ a: 1, b: 2 })})")).toHaveLength(1);
    expect(uncastIntervalArgs("make_interval(days => ${fn({ a: 1, b: 2 })}::int)")).toEqual([]);
  });

  it("the detector does not reach past the call it is reading", () => {
    // A `${…}` AFTER the closing paren belongs to some other expression.
    expect(uncastIntervalArgs("make_interval(days => 30) AND x > ${cutoff}")).toEqual([]);
    // …and a nested SQL call's parens must not truncate the argument list.
    expect(uncastIntervalArgs("make_interval(days => GREATEST(1, ${days}))")).toHaveLength(1);
  });

  it("the detector does not fire on a comment recording the old bug", () => {
    // tool-usage-census.ts quotes the broken form verbatim in its repair note.
    // A detector that flagged its own documentation would make every future fix
    // un-documentable, which is how a control gets deleted instead of fixed
    // (precedent: honest-counter-consumers.test.ts).
    expect(uncastIntervalArgs("// was make_interval(days => ${days})")).toEqual([]);
    expect(uncastIntervalArgs("/* make_interval(days => ${days}) threw 42883 */")).toEqual([]);
    // …but the same text in LIVE code still fires.
    expect(uncastIntervalArgs("sql`... make_interval(days => ${days})`")).toHaveLength(1);
  });

  it("the scan reaches the real file (it is not reading an empty string)", () => {
    // A blind scan and a clean tree both report zero offenders, so prove the
    // subject is actually on disk and still contains the construct. Counted
    // AFTER stripping comments: the repair note names make_interval several
    // times, and a raw count would be an assertion about prose.
    //
    // ⚠ A FLOOR, NOT AN EXACT COUNT (2026-09-17). This asserted exactly 2 and
    // went red the moment the census legitimately grew a third windowed query
    // (`tool.chosen` + its comparable-surfaced join). An exact count makes this
    // positive control fail on correct changes, which trains people to edit the
    // number rather than read the gate — and the number was never the property.
    // The property is: the construct is still present (so the scan has a real
    // subject) AND every occurrence is cast. Both are asserted below, and
    // neither cares how many queries exist.
    const census = stripComments(readFileSync(join(ROOT, "lib/observability/tool-usage-census.ts"), "utf8"));
    const occurrences = census.match(/make_interval/g) ?? [];
    expect(
      occurrences.length,
      "the census no longer contains a windowed query — this control has no subject",
    ).toBeGreaterThanOrEqual(2);
    expect(census).toContain("make_interval(days => ${days}::int)");
    // The real assertion: not one of them, however many there are, is uncast.
    expect(uncastIntervalArgs(census)).toEqual([]);
  });
});
