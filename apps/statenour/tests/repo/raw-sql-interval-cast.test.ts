/**
 * A Prisma-interpolated number reaching `make_interval` must carry `::int`
 * (2026-09-16).
 *
 * WHY THIS EXISTS. `lib/observability/tool-usage-census.ts` shipped two raw
 * queries filtering on `now() - make_interval(days => ${days})`. Prisma binds
 * a JS number as int8; `make_interval` has only an int4 overload and a
 * named-argument call gets no implicit int8 -> int4 cast. So both queries
 * threw `42883` on EVERY call, `getSurfacedStats` returned null every time,
 * and the census rendered "no surfacing data exists in the window yet" for
 * three weeks over 456 `tool.surfaced` rows that did exist.
 *
 * Measured before writing this, at both layers:
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
 * no-throw assertion would pass against the broken version too. The subject
 * is the cast itself.
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

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "app", "lib", "scripts"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
}

/** The text between a `(` at `open` and its matching `)`, or null if unbalanced. */
function parenBlockAt(src: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * End index (exclusive) of the `${…}` whose opening brace is at `open`,
 * brace-balanced so `${Math.max(1, x)}` and `${obj.a ? b : {c: 1}}` both close
 * in the right place.
 *
 * The first cut of this started the scan at `open + 1` with `depth = 0`, so
 * the opening brace was never counted, the first `}` drove depth to -1, and
 * the `=== 0` test could never fire — the whole detector returned [] for every
 * input while the tree-scan arm reported a clean tree. Caught by the
 * instrument control below, which is the only reason this file is not another
 * permanently-green gate.
 */
function interpolationEnd(src: string, open: number): number {
  let depth = 1;
  for (let i = open + 1; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Comments are not queries. Without this, the repair note in
 * tool-usage-census.ts — which quotes the broken `make_interval(days =>
 * ${days})` verbatim so the next reader understands what was fixed — would
 * itself fail the scan, and the only way to get green would be to delete the
 * documentation. Same shape, same reason, as `stripComments` in
 * tests/repo/honest-counter-consumers.test.ts.
 */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/**
 * Every `make_interval(...)` argument list containing a template
 * interpolation that is NOT immediately followed by an explicit int cast.
 * Returns the offending argument text, trimmed, for the failure message.
 */
export function uncastIntervalArgs(rawSrc: string): string[] {
  const src = stripComments(rawSrc);
  const out: string[] = [];
  const re = /make_interval\s*\(/g;
  for (const m of src.matchAll(re)) {
    const open = m.index + m[0].length - 1;
    const args = parenBlockAt(src, open);
    if (args === null) continue;
    for (let i = 0; i < args.length; i++) {
      if (args[i] !== "$" || args[i + 1] !== "{") continue;
      const end = interpolationEnd(args, i + 1);
      if (end < 0) continue;
      const after = args.slice(end);
      if (!/^\s*::\s*(int|int4|integer)\b/.test(after)) {
        out.push(args.replace(/\s+/g, " ").trim());
      }
      i = end - 1;
    }
  }
  return out;
}

describe("raw SQL · make_interval never receives an uncast Prisma number", () => {
  it("no tracked file interpolates into make_interval without ::int", () => {
    const found: string[] = [];
    for (const file of trackedFiles()) {
      const src = readFileSync(join(ROOT, file), "utf8");
      if (!src.includes("make_interval")) continue;
      for (const hit of uncastIntervalArgs(src)) found.push(`${file}: make_interval(${hit})`);
    }
    expect(
      found,
      "Prisma binds a JS number as int8 and make_interval has no int8 overload, so each of " +
        "these throws 42883 on EVERY call — add `::int` to the interpolation:\n" +
        found.join("\n"),
    ).toEqual([]);
  });

  it("the detector fires on the exact shape that shipped (instrument control)", () => {
    expect(uncastIntervalArgs("created_at > now() - make_interval(days => ${days})")).toEqual(["days => ${days}"]);
    // positional form, and a computed interpolation whose own parens must not
    // confuse the balanced scan
    expect(uncastIntervalArgs("make_interval(0, 0, 0, ${Math.floor(n)})")).toHaveLength(1);
    // two offenders in one file are both reported, not just the first
    expect(
      uncastIntervalArgs("a make_interval(days => ${d}) b make_interval(days => ${e})"),
    ).toHaveLength(2);
  });

  it("the detector accepts every spelling of the repaired shape", () => {
    expect(uncastIntervalArgs("make_interval(days => ${days}::int)")).toEqual([]);
    expect(uncastIntervalArgs("make_interval(days => ${days}::integer)")).toEqual([]);
    expect(uncastIntervalArgs("make_interval(days => ${days} :: int4)")).toEqual([]);
    // a literal needs no cast — Postgres types an untyped literal as int4
    expect(uncastIntervalArgs("make_interval(days => 30)")).toEqual([]);
  });

  it("the detector does not reach past the call it is reading", () => {
    // A `${…}` AFTER the closing paren belongs to some other expression.
    expect(uncastIntervalArgs("make_interval(days => 30) AND x > ${cutoff}")).toEqual([]);
    // …and a nested call's own parens must not truncate the argument list.
    expect(uncastIntervalArgs("make_interval(days => GREATEST(1, ${days}))")).toHaveLength(1);
  });

  it("the detector does not fire on a comment recording the old bug", () => {
    // tool-usage-census.ts quotes the broken form verbatim in its repair note.
    // A detector that flagged its own documentation would make every future
    // fix un-documentable, which is how a control gets deleted instead of
    // fixed (precedent: honest-counter-consumers.test.ts).
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
    const census = stripComments(readFileSync(join(ROOT, "lib/observability/tool-usage-census.ts"), "utf8"));
    expect(census.match(/make_interval/g) ?? [], "the two surfacing queries").toHaveLength(2);
    expect(census).toContain("make_interval(days => ${days}::int)");
    expect(uncastIntervalArgs(census)).toEqual([]);
  });
});
