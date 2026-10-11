/**
 * Shared by the two bridge contract tests (nick-bridge-query-contract, contract-pre-flight-catalogue),
 * so the registry and the catalogue are read ONE way. Both are read from their syntax trees: until
 * 2026-10-10 the registry was a regex for `"name": async`, which counted a commented-out handler or
 * a quoted async key in another object as live, and missed an unquoted live key (red team, canary-tests).
 */
import ts from "typescript";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const STATENOUR_ROOT = process.cwd(); // vitest runs from apps/statenour
export const PRE_FLIGHT = resolve(STATENOUR_ROOT, "scripts/contract-pre-flight.ts");

/**
 * The keys of nickstire's `QUERY_HANDLERS` object literal, quoted or not. Fails closed on a spread
 * (its keys cannot be read) and on a missing registry.
 */
export function queryHandlerKeys(src: string, file = "nour-os-query.ts"): Set<string> {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  let obj: ts.ObjectLiteralExpression | undefined;
  (function find(n: ts.Node): void {
    if (!obj && ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "QUERY_HANDLERS" && n.initializer) {
      let e: ts.Expression = n.initializer;
      while (ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isParenthesizedExpression(e)) e = e.expression;
      if (ts.isObjectLiteralExpression(e)) obj = e;
    }
    ts.forEachChild(n, find);
  })(sf);
  if (!obj) throw new Error(`${file}: no \`QUERY_HANDLERS = { ... }\` object literal found; if it moved, update tests/contracts/bridge-registry.ts.`);
  const keys = new Set<string>();
  for (const p of obj.properties) {
    if (ts.isSpreadAssignment(p)) throw new Error(`${file}: QUERY_HANDLERS spreads \`${p.expression.getText(sf)}\`, whose keys this guard cannot read.`);
    const n = p.name;
    if (n && (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))) keys.add(n.text);
    else if (n) throw new Error(`${file}: QUERY_HANDLERS key \`${n.getText(sf)}\` is computed; this guard cannot read it.`);
  }
  return keys;
}

export interface Entry {
  query: string;
  tier: string;
  filters: Record<string, unknown>;
}

/** scripts/contract-pre-flight.ts's ACTIONS array (literal filter values only). The script runs main() on import, so it is read as source. */
export function catalogue(src = readFileSync(PRE_FLIGHT, "utf8")): Entry[] {
  const sf = ts.createSourceFile(PRE_FLIGHT, src, ts.ScriptTarget.Latest, true);
  let list: ts.ArrayLiteralExpression | undefined;
  (function find(n: ts.Node): void {
    if (ts.isVariableDeclaration(n) && n.name.getText(sf) === "ACTIONS" && n.initializer && ts.isArrayLiteralExpression(n.initializer)) {
      list = n.initializer;
    }
    ts.forEachChild(n, find);
  })(sf);
  if (!list) throw new Error("contract-pre-flight.ts: no `const ACTIONS = [...]` found; if it moved, update this test.");
  const prop = (o: ts.ObjectLiteralExpression, k: string) =>
    o.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(sf) === k)?.initializer;
  const literal = (e: ts.Expression | undefined): unknown =>
    !e ? undefined : ts.isStringLiteral(e) ? e.text : ts.isNumericLiteral(e) ? Number(e.text) : e.getText(sf);
  return list.elements.map((el) => {
    const o = el as ts.ObjectLiteralExpression;
    const f = prop(o, "filters");
    const filters: Record<string, unknown> = {};
    if (f && ts.isObjectLiteralExpression(f)) for (const p of f.properties) if (ts.isPropertyAssignment(p)) filters[p.name.getText(sf)] = literal(p.initializer);
    return { query: String(literal(prop(o, "query"))), tier: String(literal(prop(o, "tier"))), filters };
  });
}
