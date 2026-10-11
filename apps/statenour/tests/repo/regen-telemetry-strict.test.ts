/**
 * Audit 2026-10-10 · 01-F6. The verified-regen telemetry write used the
 * fail-soft `recordMetric`, whose own `.catch(() => {})` swallowed a dead
 * system_metrics writer, so the surrounding `verified_regen_telemetry_failed`
 * warn could never fire: a missing row and "no regen" looked identical.
 * The strict writer rejects into that try/catch (the chat reply is still safe).
 *
 * Read from the syntax tree (hardened 2026-10-10 after a red team found two
 * green bypasses of the old substring check): a `.catch(() => {})` re-chained
 * on the strict write swallows the rejection again, and a fail-soft writer
 * under an alias passed while a COMMENT held the expected text.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(__dirname, "../../app/api/ai/chat/alternate-paths.ts"), "utf8");

describe("alternate-paths · regen telemetry", () => {
  const METRICS = "@/lib/services/metrics";
  const WARN = "verified_regen_telemetry_failed";

  /**
   * What is wrong with the regen telemetry write, [] when nothing is. The try statement whose catch
   * warns WARN must hold, directly in its try block, `await recordMetricStrict(regenMetric.metric, ...)`:
   * the awaited expression IS the call (no `.catch` / `.then` chained), and `recordMetricStrict` is
   * bound under its own name from METRICS (not `{ recordMetric: recordMetricStrict }`).
   */
  function regenTelemetryProblems(text: string): string[] {
    const sf = ts.createSourceFile("alternate-paths.ts", text, ts.ScriptTarget.Latest, true);
    const tries: ts.TryStatement[] = [];
    const bindings: Array<{ name: string; from: string; module: string }> = [];
    (function walk(n: ts.Node): void {
      if (ts.isTryStatement(n) && n.catchClause) {
        const warns = n.catchClause.block.getText(sf).match(new RegExp(`\\blog\\.warn\\(\\s*["']${WARN}["']`));
        if (warns) tries.push(n);
      }
      // `const { a: b } = await import("m")` and `import { a as b } from "m"`.
      if (ts.isBindingElement(n) && ts.isIdentifier(n.name)) {
        const decl = n.parent.parent;
        const init = ts.isVariableDeclaration(decl) && decl.initializer && ts.isAwaitExpression(decl.initializer) ? decl.initializer.expression : undefined;
        const module = init && ts.isCallExpression(init) && init.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteralLike(init.arguments[0]) ? init.arguments[0].text : "";
        bindings.push({ name: n.name.text, from: (n.propertyName ?? n.name).getText(sf), module });
      }
      if (ts.isImportSpecifier(n)) {
        const decl = n.parent.parent.parent;
        bindings.push({ name: n.name.text, from: (n.propertyName ?? n.name).text, module: ts.isStringLiteralLike(decl.moduleSpecifier) ? decl.moduleSpecifier.text : "" });
      }
      ts.forEachChild(n, walk);
    })(sf);
    if (tries.length !== 1) return [`expected one try/catch whose catch warns "${WARN}", found ${tries.length}`];
    const problems: string[] = [];
    const awaited = tries[0].tryBlock.statements.flatMap((s) =>
      ts.isExpressionStatement(s) && ts.isAwaitExpression(s.expression) && ts.isCallExpression(s.expression.expression) ? [s.expression.expression] : [],
    );
    const strict = awaited.find(
      (c) => ts.isIdentifier(c.expression) && c.expression.text === "recordMetricStrict" && c.arguments[0]?.getText(sf) === "regenMetric.metric",
    );
    if (!strict) problems.push("no `await recordMetricStrict(regenMetric.metric, ...)` statement directly in the try block (a chained .catch/.then, `void`, or another writer re-swallows the failure)");
    const bound = bindings.filter((b) => b.name === "recordMetricStrict");
    if (bound.length === 0) problems.push(`recordMetricStrict is not bound from ${METRICS}`);
    for (const b of bound) {
      if (b.from !== "recordMetricStrict" || b.module !== METRICS) problems.push(`recordMetricStrict is bound from \`${b.from}\` of "${b.module}", not ${METRICS}'s strict writer`);
    }
    return problems;
  }

  it("writes through recordMetricStrict inside the warn-on-failure try/catch", () => {
    expect(regenTelemetryProblems(src)).toEqual([]);
  });

  it("positive control: each way to re-swallow the failure is red", () => {
    const mutate = (from: string | RegExp, to: string) => {
      const out = src.replace(from, to);
      expect(out, `mutation did not apply: ${String(from)}`).not.toBe(src);
      return regenTelemetryProblems(out);
    };
    expect(mutate(/recordMetricStrict/g, "recordMetric").join("\n")).toContain("await recordMetricStrict(regenMetric.metric");
    expect(mutate("await recordMetricStrict(regenMetric.metric", "void recordMetricStrict(regenMetric.metric")).not.toEqual([]);
    expect(mutate(/(source: regenMetric\.source,\s*\}\))(;)/, "$1.catch(() => {})$2")).not.toEqual([]);
    expect(mutate("const { recordMetricStrict } =", "const { recordMetric: recordMetricStrict } =")).not.toEqual([]);
    expect(
      mutate(
        /const \{ recordMetricStrict \} = await import\("@\/lib\/services\/metrics"\);\s*await recordMetricStrict\(/,
        'const { recordMetric: write } = await import("@/lib/services/metrics");\n// was: await recordMetricStrict(regenMetric.metric, ...)\nawait write(',
      ),
    ).not.toEqual([]);
    expect(mutate(WARN, "verified_regen_telemetry_skipped")).not.toEqual([]);
  });
});
