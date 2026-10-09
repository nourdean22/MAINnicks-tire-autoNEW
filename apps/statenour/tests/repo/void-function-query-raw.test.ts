/**
 * A Postgres function that returns `void` never goes through `$queryRaw` (2026-10-09).
 *
 * WHY THIS EXISTS. `lib/services/outcome-ledger.ts` `recordShown` took its per-hash advisory lock
 * with `tx.$queryRaw\`SELECT pg_advisory_xact_lock(...)\``. `pg_advisory_xact_lock` returns void,
 * and `$queryRaw` must deserialize every column it gets back, so Prisma threw
 *
 *   Raw query failed. Code: `N/A`. Message: `Failed to deserialize column of type 'void'. ...`
 *
 * on every ledger miss. `recordShown` swallows its errors (it logs `intel.outcome-ledger` and
 * returns null), so `intelligence_outcomes` received no row from 2026-10-02 16:00:11Z (the last,
 * three minutes before #2888, which added the lock, deployed) to the fix, while the unit test
 * mocked `$queryRaw` to return undefined and passed. The other two advisory locks in the app
 * (`google-oauth.ts`, `people/record-interaction.ts`) used `$executeRaw`, which does not read
 * columns back.
 *
 * WHY A STATIC SCAN. No test executes these queries against Postgres, and the throw is swallowed
 * at the call site, so a no-throw assertion would pass against the broken version too.
 *
 * Scope: every `.ts`/`.tsx` under `lib/`, `app/`, `scripts/`; the SQL text of `$queryRaw` tagged
 * templates and of `$queryRaw(...)` / `$queryRawUnsafe(...)` calls with a literal first argument,
 * read from the TypeScript syntax tree (interpolations are dropped; the function name is literal
 * SQL). A call that reads a void function's result explicitly (`SELECT 1 FROM pg_sleep(1)`,
 * `pg_sleep(1)::text`) is fine and is not flagged.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCAN_DIRS = ["lib", "app", "scripts"];

/** Postgres functions returning void that an app might call. */
const VOID_FUNCTIONS = [
  "pg_advisory_lock",
  "pg_advisory_lock_shared",
  "pg_advisory_xact_lock",
  "pg_advisory_xact_lock_shared",
  "pg_sleep",
  "pg_sleep_for",
  "pg_sleep_until",
  "pg_notify",
];

/**
 * A SELECT whose result column IS the void function's return: `SELECT fn(...)` with nothing after
 * the call but an optional alias or the end. `SELECT 1 FROM fn(...)` and `fn(...)::text` read a
 * real type and pass.
 */
function voidSelects(sqlText: string): string[] {
  const out: string[] = [];
  const sql = sqlText.replace(/\s+/g, " ");
  for (const fn of VOID_FUNCTIONS) {
    const re = new RegExp(`\\bSELECT\\s+(?:public\\.|pg_catalog\\.)?${fn}\\s*\\(`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) {
      // Find the matching close paren of the call, then see whether a cast follows.
      let depth = 0;
      let i = m.index + m[0].length - 1;
      for (; i < sql.length; i++) {
        if (sql[i] === "(") depth++;
        else if (sql[i] === ")" && --depth === 0) break;
      }
      const rest = sql.slice(i + 1).trimStart();
      if (!rest.startsWith("::")) out.push(fn);
    }
  }
  return out;
}

/** The literal SQL of a template (interpolations dropped). */
function templateText(t: ts.TemplateLiteral): string {
  if (ts.isNoSubstitutionTemplateLiteral(t)) return t.text;
  return t.head.text + t.templateSpans.map((s) => ` $ ${s.literal.text}`).join("");
}

function calleeName(expr: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  if (ts.isIdentifier(expr)) return expr.text;
  return null;
}

/** Every `$queryRaw` / `$queryRawUnsafe` SQL text in one source, with its line. */
function queryRawSql(source: string, fileName = "x.ts"): Array<{ line: number; sql: string }> {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: Array<{ line: number; sql: string }> = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (node: ts.Node) => {
    if (ts.isTaggedTemplateExpression(node) && calleeName(node.tag) === "$queryRaw") {
      found.push({ line: lineOf(node), sql: templateText(node.template) });
    } else if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      const first = node.arguments[0];
      if ((name === "$queryRaw" || name === "$queryRawUnsafe") && first) {
        if (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) found.push({ line: lineOf(node), sql: first.text });
        else if (ts.isTemplateExpression(first)) found.push({ line: lineOf(node), sql: templateText(first) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function problemsIn(source: string, fileName = "x.ts"): string[] {
  return queryRawSql(source, fileName).flatMap(({ line, sql }) => voidSelects(sql).map((fn) => `${fileName}:${line} ${fn} through $queryRaw`));
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

describe("void-returning Postgres functions never go through $queryRaw", () => {
  const files = SCAN_DIRS.flatMap((d) => sourceFiles(join(APP_ROOT, d)));

  it("the instrument reads the app: it finds raw queries, including the ledger's lock", () => {
    const all = files.flatMap((f) => queryRawSql(readFileSync(f, "utf8"), relative(APP_ROOT, f)));
    expect(files.length).toBeGreaterThan(200);
    expect(all.length).toBeGreaterThan(20);
  });

  it("no file sends one", () => {
    const problems = files.flatMap((f) => problemsIn(readFileSync(f, "utf8"), relative(APP_ROOT, f)));
    expect(problems).toEqual([]);
  });

  it("CONTROL: the 2026-10-02 lock is caught, in a tagged template and in both call forms", () => {
    const broken = "await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`intelligence_outcome:${contentHash}`}))`;";
    expect(problemsIn(broken)).toEqual(["x.ts:1 pg_advisory_xact_lock through $queryRaw"]);
    expect(problemsIn('await prisma.$queryRawUnsafe("SELECT pg_advisory_lock($1)", 7);')).toEqual(["x.ts:1 pg_advisory_lock through $queryRaw"]);
    expect(problemsIn("await prisma.$queryRaw(`select\n  pg_sleep(1)`);")).toEqual(["x.ts:1 pg_sleep through $queryRaw"]);
  });

  it("CONTROL: $executeRaw, a cast, and a FROM-clause call are not flagged", () => {
    expect(problemsIn("await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${k}))`;")).toEqual([]);
    expect(problemsIn("await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${k}))::text AS locked`;")).toEqual([]);
    expect(problemsIn("await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${k}))`;")).toEqual([]);
    // A boolean-returning sibling is a real column.
    expect(problemsIn("await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(${k}) AS ok`;")).toEqual([]);
  });
});
