/**
 * Bridge query contract guard · 2026-05-30
 *
 * WHY THIS EXISTS — the dead-query class. statenour talks to nickstire over a
 * stringly-typed HTTP bridge: `queryNick("revenue_today")` / `fetchBridge(...)`
 * / `queryNickBatch([{ query: "..." }])`. Nothing — not the compiler, not the
 * existing tests — checks that a query string actually corresponds to a live
 * nickstire handler. So typos and renamed handlers degrade silently to "no
 * data" instead of failing loudly:
 *   · `jobs_today`              → should have been `revenue_today`
 *   · `pending_callbacks_count` → should have been `callbacks_pending`
 *   · `stale_leads_count`       → should have been `leads_urgent`
 * Each one zeroed an operator-facing number ($0 revenue, 0 callbacks, false
 * "ZERO REVENUE" alarm) for an unknown length of time.
 *
 * This test is the static guard: it reads nickstire's REAL handler registry
 * and asserts every statenour bridge callsite targets either (a) a live
 * handler, or (b) a query explicitly catalogued as `newly-required` (shipped
 * on the statenour side, awaiting a nickstire-side handler — these degrade
 * gracefully BY DESIGN, see lib/nickstire/query.ts `warnUnknownQueryOnce`).
 *
 * A new typo'd query, or a handler removed nickstire-side, now fails CI
 * instead of silently lying on a dashboard.
 *
 * Source of truth for the catalogue: scripts/contract-pre-flight.ts ACTIONS
 * + docs/NICKSTIRE-QUERY-CONTRACT.md. The runtime pre-flight PROBES the live
 * bridge; this test enforces the same contract statically, with no network.
 */
import { describe, it, expect } from "vitest";
import ts from "typescript";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const STATENOUR_ROOT = process.cwd(); // vitest runs from apps/statenour
const NICK_REGISTRY = resolve(
  STATENOUR_ROOT,
  "../nickstire/server/routes/nour-os-query.ts",
);

/**
 * Queries nickstire has NOT shipped a handler for yet, but that statenour
 * intentionally calls (they 400 "Unknown query" and degrade to empty — see
 * the `newly-required` / `primary-metric` tiers in contract-pre-flight.ts).
 * When nickstire ships one it becomes a live handler and the second test
 * below will tell you to delete it from this list.
 */
const KNOWN_PENDING = new Set<string>([
  "quotes_pending",
  "quotes_booked_week",
  "quotes_stale",
  "leads_open",
  "leads_overdue_count",
  "leads_today_count",
  "leads_week_count",
  // `revenue_top_services` and `customer_stats` sat here from 2026-10-08 (found by the first
  // multi-line run) until the same day's follow-up: `customer_stats` became a nickstire
  // handler, and getTopServices was retired, so nothing calls `revenue_top_services`.
]);

/** Parse the live handler keys out of nickstire's QUERY_HANDLERS registry. */
function liveHandlers(): Set<string> {
  if (!existsSync(NICK_REGISTRY)) {
    throw new Error(
      `nickstire registry not found at ${NICK_REGISTRY} — if the file moved, ` +
        `update NICK_REGISTRY in this test.`,
    );
  }
  const src = readFileSync(NICK_REGISTRY, "utf8");
  const out = new Set<string>();
  // handlers look like:  "revenue_today": async () => {
  for (const m of src.matchAll(/["']([a-z0-9_]+)["']\s*:\s*async/g)) {
    out.add(m[1]);
  }
  return out;
}

/** Recursively collect .ts/.tsx source files (skip tests + build output). */
function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (["node_modules", ".next", ".next-prod", "dist"].includes(entry)) continue;
      walk(p, acc);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec|d)\.tsx?$/.test(entry)) {
      acc.push(p);
    }
  }
  return acc;
}

interface Callsite {
  query: string;
  file: string;
  line: number;
}

/** A call site whose query name cannot be read from the source. */
interface Unresolved {
  file: string;
  line: number;
  /** The argument as written, e.g. `q.query`. */
  arg: string;
  why: string;
}

interface Scan {
  hits: Callsite[];
  unresolved: Unresolved[];
}

/** Bridge helpers whose FIRST argument is the query name. */
const QUERY_HELPERS = ["queryNick", "fetchBridge"] as const;
/** Takes `[{ query: "x", filters? }, ...]`. */
const BATCH_HELPER = "queryNickBatch";

/**
 * Production source the guard reads. NOT scripts/: contract-pre-flight.ts enumerates every
 * contract action on purpose. components/ features/ hooks/ hold no bridge call today; they are
 * scanned so that one added there is not invisible.
 */
const SCAN_DIRS = ["lib", "app", "src", "components", "features", "hooks"];

/**
 * Call sites that name their query at RUN time, on purpose. Each was reviewed: the name cannot
 * be known statically, and a bad one comes back from nickstire as an explicit
 * `{ error: "HTTP 400: Unknown query ..." }`, never as data. Matched on file + the argument as
 * written, and an entry excuses exactly `count` calls: a second call passing the same argument in
 * the same file un-excuses them all, so a new dynamic call cannot ride on a reviewed one. An entry
 * that stops matching fails the guard, so this list cannot outlive its call.
 */
const DYNAMIC_BY_DESIGN: ReadonlyArray<{ file: string; arg: string; count: number; why: string }> = [
  {
    file: "lib/nickstire/query.ts",
    arg: "q.query",
    count: 1,
    why: "queryNickBatch itself, forwarding each entry; every queryNickBatch call is checked entry by entry",
  },
  {
    file: "lib/ai/tools/business.ts",
    arg: "query",
    count: 1,
    why: "the queryNickstire tool: the model names the query",
  },
  {
    file: "app/api/nickstire/query/route.ts",
    arg: "q",
    count: 1,
    why: "the owner-only passthrough route: ?q= names the query",
  },
];

/** A type checker over ONE file: enough to resolve its own bindings, with no lib and no imports. */
function checkerFor(sf: ts.SourceFile): ts.TypeChecker {
  const host: ts.CompilerHost = {
    getSourceFile: (name) => (name === sf.fileName ? sf : undefined),
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => undefined,
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (name) => name === sf.fileName,
    readFile: (name) => (name === sf.fileName ? sf.text : undefined),
  };
  return ts
    .createProgram({ rootNames: [sf.fileName], options: { noLib: true, noResolve: true, types: [] }, host })
    .getTypeChecker();
}

function unwrap(e: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isSatisfiesExpression(e) ||
    ts.isNonNullExpression(e) ||
    ts.isTypeAssertionExpression(e)
  ) {
    e = e.expression;
  }
  return e;
}

type Resolution =
  | { names: Array<{ name: string; at: ts.Node }> }
  | { wrapper: ts.Symbol; index: number }
  | { why: string };

/**
 * Every bridge query name one source file sends, read from its syntax tree.
 *
 * WHY A SYNTAX TREE. Until 2026-10-09 this was a regex over the comment-stripped text, and each
 * blind spot it had was found the hard way: a type argument with a nested generic
 * (`queryNick<Record<string, unknown>>("x")`, fixed 2026-10-08: `draft_opportunity_sms` and
 * `lot_brief` were unguarded), and a call written across lines (fixed the same day: 18 calls,
 * among them send_opportunity_sms, the one customer-texting action). It still could not see a
 * name held in a variable (`const q = "x"; queryNick(q)`), nor a name passed through a local
 * wrapper: app/api/telegram/webhook's `igRead(query)` forwards to `queryNick(query)`, so its
 * three Instagram queries were never checked. The tree has no comment, string or line-break
 * blind spots, and the file's own checker resolves a name to its binding.
 *
 * A query-name argument is accepted when it is:
 *   · a string literal, or a conditional whose branches both are;
 *   · a `const` in this file bound to one of those;
 *   · a parameter of a non-exported function in this file: that function becomes a helper too,
 *     and each call to it is checked the same way (igRead, both `fetchBridge`s).
 * Anything else is UNRESOLVED and fails the guard unless DYNAMIC_BY_DESIGN names it. That covers
 * a wrapper parameter or a const batch list that is written after it is bound, and every reference
 * to a helper that is not a direct call, an import/export/destructuring name, a declaration name,
 * a property key or a type position (`.call`, `.bind`, a conditional callee, an assignment). A
 * renamed import (`queryNick as qn`) and a string element access (`m["queryNick"](...)`) are
 * read as the helper they name.
 */
function scanSource(file: string, text: string): Scan {
  const scan: Scan = { hits: [], unresolved: [] };
  // A file that never names a helper has no call site to follow (and needs no checker).
  if (![...QUERY_HELPERS, BATCH_HELPER].some((h) => text.includes(h))) return scan;

  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const checker = checkerFor(sf);
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const unresolved = (n: ts.Node, why: string) =>
    scan.unresolved.push({ file, line: lineOf(n), arg: n.getText(sf).replace(/\s+/g, " "), why });

  const calls: ts.CallExpression[] = [];
  const ids: ts.Identifier[] = [];
  const elementRefs: ts.ElementAccessExpression[] = [];
  // `import { queryNick as qn }` / `const { queryNick: qn } = ...`: the local name IS the helper.
  const aliases = new Map<string, string>();
  const HELPERS: readonly string[] = [...QUERY_HELPERS, BATCH_HELPER];
  // `export { read }` and `export default read` export a function without a modifier.
  const exportedByName = new Set<string>();
  (function collect(n: ts.Node): void {
    if (ts.isCallExpression(n)) calls.push(n);
    if (ts.isIdentifier(n)) ids.push(n);
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && HELPERS.includes(n.argumentExpression.text)) {
      elementRefs.push(n);
    }
    if ((ts.isImportSpecifier(n) || ts.isBindingElement(n)) && n.propertyName && ts.isIdentifier(n.propertyName) && ts.isIdentifier(n.name)) {
      if (HELPERS.includes(n.propertyName.text) && n.name.text !== n.propertyName.text) aliases.set(n.name.text, n.propertyName.text);
    }
    if (ts.isExportSpecifier(n)) exportedByName.add((n.propertyName ?? n.name).text);
    if (ts.isExportAssignment(n) && ts.isIdentifier(n.expression)) exportedByName.add(n.expression.text);
    ts.forEachChild(n, collect);
  })(sf);

  const declarationOf = (id: ts.Identifier, symbol = checker.getSymbolAtLocation(id)) => {
    const decls = symbol?.declarations ?? [];
    return decls.length === 1 ? decls[0] : undefined;
  };

  /** Is this binding written anywhere in the file (assigned, ++/--, or a mutating array call)? */
  const MUTATORS = new Set(["push", "unshift", "splice", "fill", "copyWithin", "reverse", "sort", "pop", "shift"]);
  function isWritten(symbol: ts.Symbol | undefined): boolean {
    if (!symbol) return false;
    return ids.some((id) => {
      if (checker.getSymbolAtLocation(id) !== symbol) return false;
      let n: ts.Node = id;
      while ((ts.isPropertyAccessExpression(n.parent) || ts.isElementAccessExpression(n.parent)) && n.parent.expression === n) {
        const acc = n.parent;
        if (ts.isPropertyAccessExpression(acc) && MUTATORS.has(acc.name.text) && ts.isCallExpression(acc.parent) && acc.parent.expression === acc) {
          return true;
        }
        n = acc;
      }
      const p = n.parent;
      if (ts.isBinaryExpression(p) && p.left === n) {
        const k = p.operatorToken.kind;
        return k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment;
      }
      return (
        (ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) &&
        (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)
      );
    });
  }

  function wrapperOf(param: ts.ParameterDeclaration): Resolution {
    const fn = param.parent;
    const holder =
      ts.isFunctionDeclaration(fn) && fn.name
        ? fn
        : (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
            ts.isVariableDeclaration(fn.parent) &&
            ts.isIdentifier(fn.parent.name)
          ? fn.parent
          : undefined;
    if (!holder || param.dotDotDotToken) {
      return { why: "a parameter of a method, an anonymous function or a rest list: its callers cannot be followed" };
    }
    const name = holder.name as ts.Identifier;
    if (ts.getCombinedModifierFlags(holder) & ts.ModifierFlags.Export || exportedByName.has(name.text)) {
      return { why: `a parameter of exported \`${name.text}\`: its callers in other files are not followed` };
    }
    const wrapper = checker.getSymbolAtLocation(name);
    if (!wrapper) return { why: `\`${name.text}\` could not be resolved to follow its callers` };
    if (isWritten(checker.getSymbolAtLocation(param.name))) {
      return { why: `a parameter of \`${name.text}\` that is reassigned before the call: its callers' names are not what is sent` };
    }
    return { wrapper, index: fn.parameters.indexOf(param) };
  }

  function resolveName(expr: ts.Expression, depth = 0, symbol?: ts.Symbol): Resolution {
    const e = unwrap(expr);
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return { names: [{ name: e.text, at: e }] };
    if (ts.isConditionalExpression(e)) {
      const a = resolveName(e.whenTrue, depth);
      const b = resolveName(e.whenFalse, depth);
      if ("names" in a && "names" in b) return { names: [...a.names, ...b.names] };
      return { why: "a conditional whose branches are not both string constants" };
    }
    if (ts.isIdentifier(e)) {
      const d = declarationOf(e, symbol);
      if (d && ts.isParameter(d) && ts.isIdentifier(d.name)) return wrapperOf(d);
      const isConst =
        d && ts.isVariableDeclaration(d) && (ts.getCombinedNodeFlags(d) & ts.NodeFlags.Const) !== 0;
      if (isConst && d.initializer && ts.isIdentifier(d.name) && depth < 8) {
        return resolveName(d.initializer, depth + 1);
      }
      return { why: `\`${e.text}\` is not a same-file const bound to a string literal` };
    }
    return { why: "the query name is computed at run time" };
  }

  // A batch entry's name must be readable at the call: `{ query: "x" }`, `{ query: Q }` or `{ query }`.
  function checkBatch(call: ts.CallExpression): void {
    const arg = call.arguments[0];
    let list = arg && unwrap(arg);
    if (list && ts.isIdentifier(list)) {
      const d = declarationOf(list);
      const isConst =
        d && ts.isVariableDeclaration(d) && (ts.getCombinedNodeFlags(d) & ts.NodeFlags.Const) !== 0;
      if (isConst && isWritten(checker.getSymbolAtLocation(list))) {
        unresolved(arg, `${BATCH_HELPER}'s list is changed after it is declared: the entries sent are not the ones written`);
        return;
      }
      list = isConst && d.initializer ? unwrap(d.initializer) : list;
    }
    if (!list || !ts.isArrayLiteralExpression(list)) {
      unresolved(arg ?? call, `${BATCH_HELPER} needs an array literal (or a same-file const one)`);
      return;
    }
    for (const el of list.elements) {
      const entry = unwrap(el as ts.Expression);
      const prop = ts.isObjectLiteralExpression(entry)
        ? entry.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === "query")
        : undefined;
      const r =
        prop && ts.isPropertyAssignment(prop)
          ? resolveName(prop.initializer)
          : prop && ts.isShorthandPropertyAssignment(prop)
            ? resolveName(prop.name, 0, checker.getShorthandAssignmentValueSymbol(prop))
            : { why: "a batch entry without a literal `query:` property" };
      if ("names" in r) for (const { name, at } of r.names) scan.hits.push({ query: name, file, line: lineOf(at) });
      else unresolved(el, "wrapper" in r ? "a batch entry named through a parameter" : r.why);
    }
  }

  // Helper -> the argument positions that carry a query name. Grows as local wrappers are found,
  // so iterate until it stops growing; `done` keeps a (call, position) from being read twice.
  const byName = new Map<string, Set<number>>(QUERY_HELPERS.map((h) => [h, new Set([0])]));
  const wrappers = new Map<ts.Symbol, Set<number>>(); // keyed by symbol, so an overloaded wrapper still matches
  const done = new Set<string>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const call of calls) {
      const callee = call.expression;
      const raw = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)
            ? callee.argumentExpression.text
            : "";
      const name = aliases.get(raw) ?? raw;
      if (name === BATCH_HELPER) {
        if (!done.has(`${call.pos}:batch`)) {
          done.add(`${call.pos}:batch`);
          checkBatch(call);
        }
        continue;
      }
      const local = ts.isIdentifier(callee) ? checker.getSymbolAtLocation(callee) : undefined;
      const positions = new Set([...(byName.get(name) ?? []), ...((local && wrappers.get(local)) ?? [])]);
      for (const index of positions) {
        if (done.has(`${call.pos}:${index}`)) continue;
        done.add(`${call.pos}:${index}`);
        const arg = call.arguments[index];
        const r: Resolution = arg ? resolveName(arg) : { why: "no query argument" };
        if ("names" in r) {
          for (const { name: query, at } of r.names) scan.hits.push({ query, file, line: lineOf(at) });
        } else if ("wrapper" in r) {
          const seen = wrappers.get(r.wrapper) ?? new Set<number>();
          if (!seen.has(r.index)) {
            wrappers.set(r.wrapper, seen.add(r.index));
            grew = true;
          }
        } else {
          unresolved(arg ?? call, r.why);
        }
      }
    }
  }

  // FAIL CLOSED on every other reference to a helper: handed over as a value (`names.map(queryNick)`,
  // `const f = read`), called indirectly (`queryNick.call(null, q)`, `(c ? queryNick : fetchBridge)(q)`)
  // or reassigned, it is called with arguments no call site in this file shows.
  const helperNames = new Set<string>([...HELPERS, ...aliases.keys(), ...[...wrappers.keys()].map((w) => w.name)]);
  const inTypePosition = (n: ts.Node): boolean => {
    for (let a: ts.Node | undefined = n.parent; a && !ts.isStatement(a) && !ts.isSourceFile(a); a = a.parent) {
      if (ts.isTypeNode(a)) return true;
    }
    return false;
  };
  const isReadUse = (ref: ts.Node): boolean => {
    const p = ref.parent;
    return ts.isCallExpression(p) && p.expression === ref;
  };
  for (const id of ids) {
    if (!helperNames.has(id.text)) continue;
    const isHelper =
      HELPERS.includes(id.text) || aliases.has(id.text) || wrappers.has(checker.getSymbolAtLocation(id) as ts.Symbol);
    if (!isHelper) continue;
    const p = id.parent;
    const isName =
      ((ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isBindingElement(p)) && (p.name === id || p.propertyName === id)) ||
      ts.isImportClause(p) ||
      ((ts.isFunctionDeclaration(p) || ts.isVariableDeclaration(p) || ts.isMethodDeclaration(p) || ts.isParameter(p)) && p.name === id) ||
      ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p)) && p.name === id) ||
      inTypePosition(id);
    if (isName) continue;
    // `x.helper(...)` and `helper(...)` are calls the loop above read; `helper.call` / `x.helper` as a value are not.
    const ref = ts.isPropertyAccessExpression(p) && p.name === id ? p : id;
    if (isReadUse(ref)) continue;
    // A wrapper's own export (`export default read`) is reported on its parameter already.
    if (ts.isExportAssignment(ref.parent)) continue;
    unresolved(ref, `\`${id.text}\` is used other than as a direct call: the names it is called with are not visible`);
  }
  for (const el of elementRefs) {
    if (!isReadUse(el)) unresolved(el, `\`${el.getText(sf)}\` is used other than as a direct call`);
  }
  return scan;
}

/** Scan the production tree; file paths come back relative to apps/statenour, `/`-separated. */
function scanCallsites(): Scan {
  const out: Scan = { hits: [], unresolved: [] };
  for (const abs of SCAN_DIRS.flatMap((d) => walk(join(STATENOUR_ROOT, d)))) {
    const file = relative(STATENOUR_ROOT, abs).split(sep).join("/");
    const { hits, unresolved } = scanSource(file, readFileSync(abs, "utf8"));
    out.hits.push(...hits);
    out.unresolved.push(...unresolved);
  }
  return out;
}

/** The unresolved calls DYNAMIC_BY_DESIGN does NOT excuse (see its header for the count rule). */
function unexcused(unresolved: Unresolved[]): Unresolved[] {
  const same = (a: { file: string; arg: string }, b: { file: string; arg: string }) => a.file === b.file && a.arg === b.arg;
  return unresolved.filter((u) => {
    const entry = DYNAMIC_BY_DESIGN.find((d) => same(d, u));
    return !entry || unresolved.filter((x) => same(x, u)).length !== entry.count;
  });
}

/**
 * The contract doc lives in BOTH apps, and each copy says it mirrors the other.
 * Until 2026-10-08 nothing checked that, and they had drifted: four §7 rows and
 * all of §8 existed only in statenour's copy, `team_performance` only in
 * nickstire's, and thirteen live handlers had no row in either.
 */
const CONTRACT_DOCS = [
  resolve(STATENOUR_ROOT, "docs/NICKSTIRE-QUERY-CONTRACT.md"),
  resolve(STATENOUR_ROOT, "../nickstire/docs/NICKSTIRE-QUERY-CONTRACT.md"),
] as const;

interface ContractRow {
  action: string;
  cells: number;
  line: number;
}

/** The action rows of §7 (between the `## 7.` and `## 8.` headings). */
function contractRows(doc: string): ContractRow[] {
  const start = doc.search(/^## 7\. /m);
  const end = doc.search(/^## 8\. /m);
  if (start < 0 || end < start) {
    throw new Error("NICKSTIRE-QUERY-CONTRACT.md: could not find the ## 7. and ## 8. headings");
  }
  const firstLine = doc.slice(0, start).split("\n").length;
  return doc
    .slice(start, end)
    .split("\n")
    .flatMap((text, i) => {
      const m = /^\| `([a-z0-9_]+)` \|/.exec(text);
      if (!m) return [];
      // A pipe inside a cell must be escaped (`\|`), even inside a code span,
      // or GitHub splits the cell: a 3-column row has exactly 4 unescaped pipes.
      const pipes = text.match(/(?<!\\)\|/g)?.length ?? 0;
      return [{ action: m[1], cells: pipes - 1, line: firstLine + i }];
    });
}

const offendersOf = (hits: Callsite[], valid: Set<string>) =>
  hits.filter((c) => !valid.has(c.query) && !KNOWN_PENDING.has(c.query));

describe("nickstire bridge query contract", () => {
  it("every bridge callsite targets a live handler or a catalogued newly-required query", () => {
    const valid = liveHandlers();
    // Sanity: confirm we actually parsed the registry (not an empty match).
    expect(valid.size).toBeGreaterThan(10);

    const { hits } = scanCallsites();
    // The instrument fired: the tree holds ~80 bridge call sites (2026-10-09). A scan that
    // finds a handful has gone blind, and an empty offender list from it would mean nothing.
    expect(hits.length).toBeGreaterThan(40);
    const offenders = offendersOf(hits, valid);
    const report = offenders.map((o) => `  ✗ "${o.query}"  @ ./${o.file}:${o.line}`).join("\n");

    expect(
      offenders,
      `Uncatalogued bridge queries found — each is a typo or a handler that no ` +
        `longer exists nickstire-side (it will silently return no data):\n${report}\n\n` +
        `Fix: point the callsite at a real handler, OR (if nickstire genuinely ` +
        `owes a new handler) add the query to KNOWN_PENDING here + contract-pre-flight.ts.`,
    ).toEqual([]);
  }, 60000);

  it("every bridge callsite names its query where this guard can read it", () => {
    const blind = unexcused(scanCallsites().unresolved);
    const report = blind.map((u) => `  ✗ ${u.arg}  @ ./${u.file}:${u.line}  (${u.why})`).join("\n");
    expect(
      blind,
      `Bridge calls whose query name this guard cannot read, so a typo in them would ` +
        `silently return no data:\n${report}\n\n` +
        `Fix: write the name as a string literal at the call, or as a \`const\` in the same ` +
        `file, or pass it through a non-exported wrapper in the same file (its callers are ` +
        `then checked). Only if the name is chosen at run time ON PURPOSE, add the call to ` +
        `DYNAMIC_BY_DESIGN in this test with the reason.`,
    ).toEqual([]);
  }, 60000);

  it("DYNAMIC_BY_DESIGN only lists call sites that still exist, each exactly as often as reviewed", () => {
    const { unresolved } = scanCallsites();
    const drift = DYNAMIC_BY_DESIGN.map((d) => ({
      d,
      n: unresolved.filter((u) => u.file === d.file && u.arg === d.arg).length,
    })).filter(({ d, n }) => n !== d.count);
    expect(
      drift.map(({ d, n }) => `${d.file}: ${d.arg} (reviewed ${d.count}, found ${n})`),
      "These DYNAMIC_BY_DESIGN entries no longer match what was reviewed: delete a dead one, or " +
        "review the new call and raise the count, so no call is excused unreviewed.",
    ).toEqual([]);
  }, 60000);

  it("the reviewed list excuses exactly its own calls (canary for the excusal itself)", () => {
    const at = "lib/ai/tools/business.ts";
    const one = scanSource(at, `export async function tool(query: string) { return queryNick(query); }`).unresolved;
    expect(one.map((u) => u.arg)).toEqual(["query"]);
    expect(unexcused(one)).toEqual([]);
    // A second run-time-named call in the same file, passing the same argument, is not excused,
    // and neither is the reviewed one beside it.
    const two = scanSource(
      at,
      `export async function tool(query: string) { return queryNick(query); }
` +
        `export async function readShop(query: string) { return fetchBridge(query); }`,
    ).unresolved;
    expect(unexcused(two)).toHaveLength(2);
    // Anything the list does not name passes straight through.
    const other = scanSource("lib/__fixture__.ts", `const q = pick(); await queryNick(q);`).unresolved;
    expect(unexcused(other)).toEqual(other);
  });

  describe("the scanner itself (planted call sites)", () => {
    const scan = (src: string) => {
      const { hits, unresolved } = scanSource("lib/__fixture__.ts", src);
      return { names: hits.map((h) => h.query), lines: hits.map((h) => h.line), blind: unresolved.map((u) => u.arg) };
    };

    it("cannot read a query name computed at run time, and says so", () => {
      expect(scan(`const q = pickQuery(); await queryNick(q);`)).toMatchObject({ names: [], blind: ["q"] });
      expect(scan(`await fetchBridge(\`revenue_\${period}\`);`).blind).toEqual(["`revenue_${period}`"]);
      expect(scan(`let q = "revenue_today"; await queryNick(q);`).blind).toEqual(["q"]);
    });

    it("reads a name held in a same-file const, and the guard then rejects a dead one", () => {
      const s = scan(`const Q = "no_such_handler";\nexport async function f() {\n  return queryNick<Record<string, unknown>>(Q);\n}`);
      expect(s).toEqual({ names: ["no_such_handler"], lines: [1], blind: [] });
      const valid = liveHandlers();
      expect(
        offendersOf(scanSource("lib/__fixture__.ts", `const Q = "no_such_handler"; queryNick(Q);`).hits, valid).map((o) => o.query),
      ).toEqual(["no_such_handler"]);
      // A shadowing inner const wins, exactly as it does at run time.
      expect(scan(`const Q = "outer"; function g() { const Q = "inner"; return queryNick(Q); }`).names).toEqual(["inner"]);
    });

    it("follows a local wrapper to its callers, and refuses to follow an exported one", () => {
      const local = scan(
        `async function igRead<T>(query: string, render: (d: T) => string) {\n` +
          `  return queryNick<T>(query, {}, 20000);\n}\n` +
          `await igRead("instagram_delivery_issues", r);\nawait igRead(dynamicName, r);`,
      );
      expect(local).toEqual({ names: ["instagram_delivery_issues"], lines: [4], blind: ["dynamicName"] });
      expect(scan(`const read = async (q: string) => queryNick(q); read("leads_urgent");`).names).toEqual(["leads_urgent"]);
      expect(scan(`export async function read(q: string) { return queryNick(q); }`).blind).toEqual(["q"]);
      expect(scan(`async function read(q: string) { return queryNick(q); }\nexport { read };`).blind).toEqual(["q"]);
      expect(scan(`async function read(q: string) { return queryNick(q); }\nexport default read;`).blind).toEqual(["q"]);
      // Matched by symbol, not by declaration, so an overloaded wrapper's callers are still read.
      const overloaded =
        `function read(q: string): Promise<unknown>;\nfunction read(q: string, n: number): Promise<unknown>;\n` +
        `function read(q: string, _n?: number) { return queryNick(q); }\nread("no_such_handler");`;
      expect(scan(overloaded).names).toEqual(["no_such_handler"]);
    });

    it("flags a helper handed over as a value: the names it is called with are not visible", () => {
      expect(scan(`await Promise.all(names.map(queryNick));`).blind).toEqual(["queryNick"]);
      expect(scan(`await Promise.all(names.map(mod.queryNick));`).blind).toEqual(["mod.queryNick"]);
      expect(scan(`async function read(q: string) { return queryNick(q); }\nfor (const n of names) await read(n);\nnames.forEach(read);`).blind).toEqual([
        "n",
        "read",
      ]);
      // Importing and destructuring it are not uses.
      expect(scan(`import { queryNick } from "@/lib/nickstire/query";\nconst { queryNickBatch } = await import("x");`).blind).toEqual([]);
    });

    it("reads a renamed helper as the helper it names, and fails closed on every indirect use", () => {
      // Renamed: read, so a typo in it is caught like any other call (review of 2026-10-09).
      expect(scan(`import { queryNick as qn } from "@/lib/nickstire/query";\nawait qn("revenue_todya");`).names).toEqual(["revenue_todya"]);
      expect(scan(`const { queryNick: qn } = await import("@/lib/nickstire/query");\nawait qn("leads_urgent");`).names).toEqual(["leads_urgent"]);
      expect(scan(`await nq["queryNick"]("shop_pulse");`).names).toEqual(["shop_pulse"]);
      // Indirect: the names it is called with are not visible, so each is reported.
      expect(scan(`await queryNick.call(null, q);`).blind).toEqual(["queryNick"]);
      expect(scan(`await queryNick.apply(null, [q]);`).blind).toEqual(["queryNick"]);
      expect(scan(`const f = queryNick.bind(null);`).blind).toEqual(["queryNick"]);
      expect(scan(`let f; f = queryNick;`).blind).toEqual(["queryNick"]);
      expect(scan(`await (cond ? queryNick : fetchBridge)(q);`).blind).toEqual(["queryNick", "fetchBridge"]);
      expect(scan(`const g = nq["queryNick"];`).blind).toEqual([`nq["queryNick"]`]);
      // Still not uses: importing, destructuring, declaring, a property key, a type position.
      expect(
        scan(
          `import { queryNick } from "@/lib/nickstire/query";\nexport { queryNick as q2 };\n` +
            `type R = Awaited<ReturnType<typeof queryNick>>;\nconst tools = { fetchBridge: 1 };\n` +
            `export async function queryNickBatch() { return 1; }`,
        ).blind,
      ).toEqual([]);
    });

    it("refuses a wrapper parameter or a const batch list that is written after it is bound", () => {
      expect(scan(`async function read(q: string) { q = q + "_v2"; return queryNick(q); }\nread("revenue_today");`)).toMatchObject({
        names: [],
        blind: ["q"],
      });
      expect(scan(`const L = [{ query: "revenue_today" }];\nL.push({ query: dyn });\nawait queryNickBatch(L);`)).toMatchObject({
        names: [],
        blind: ["L"],
      });
      // Control: the same shapes, unwritten, are read.
      expect(scan(`async function read(q: string) { return queryNick(q.trim()); }`).blind).toEqual(["q.trim()"]);
      expect(scan(`const L = [{ query: "revenue_today" }];\nconsole.info(L.length);\nawait queryNickBatch(L);`).names).toEqual(["revenue_today"]);
    });

    it("reads every batch entry, and flags one it cannot read", () => {
      expect(scan(`await queryNickBatch([{ query: "leads_urgent" }, { query: name }]);`)).toMatchObject({
        names: ["leads_urgent"],
        blind: ["{ query: name }"],
      });
      expect(scan(`const L = [{ query: "revenue_today" }]; await queryNickBatch(L);`).names).toEqual(["revenue_today"]);
      expect(scan(`const query = "callbacks_pending"; await queryNickBatch([{ query }]);`).names).toEqual(["callbacks_pending"]);
      expect(scan(`await queryNickBatch(list);`).blind).toEqual(["list"]);
    });

    it("keeps the earlier fixes: nested generics, multi-line calls, both branches of a conditional", () => {
      expect(scan(`await queryNick<Record<string, Array<{ a: number }>>>(\n  "draft_opportunity_sms",\n);`)).toEqual({
        names: ["draft_opportunity_sms"],
        lines: [2],
        blind: [],
      });
      expect(scan(`await fetchBridge(day ? "revenue_today" : "revenue_range");`).names).toEqual(["revenue_today", "revenue_range"]);
      expect(scan(`await mod.queryNick("shop_pulse");`).names).toEqual(["shop_pulse"]);
    });

    it("does not count prose: comments and strings that quote a call are not call sites", () => {
      const prose =
        `// was queryNick("stale_leads_count")\n/* queryNick(q) */\n` +
        `const label = "queryNick(revenue_today)";\nconst doc = \`fetchBridge(x)\`;`;
      expect(scan(prose)).toEqual({ names: [], lines: [], blind: [] });
    });
  });

  it("KNOWN_PENDING only lists queries nickstire has NOT shipped (promote when shipped)", () => {
    const valid = liveHandlers();
    const shipped = [...KNOWN_PENDING].filter((q) => valid.has(q));
    expect(
      shipped,
      `These KNOWN_PENDING queries are now LIVE nickstire handlers — remove them ` +
        `from KNOWN_PENDING (and the newly-required tier in contract-pre-flight.ts):\n  ${shipped.join(", ")}`,
    ).toEqual([]);
  });

  it("the two copies of NICKSTIRE-QUERY-CONTRACT.md are byte-identical", () => {
    for (const p of CONTRACT_DOCS) {
      if (!existsSync(p)) throw new Error(`contract doc not found at ${p}: if it moved, update CONTRACT_DOCS.`);
    }
    const [own, nick] = CONTRACT_DOCS.map((p) => readFileSync(p));
    if (own.equals(nick)) return;
    const a = own.toString("utf8").split("\n");
    const b = nick.toString("utf8").split("\n");
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    expect.fail(
      `The contract copies differ, first at line ${i + 1}:\n` +
        `  statenour: ${JSON.stringify(a[i] ?? "<end of file>").slice(0, 160)}\n` +
        `  nickstire: ${JSON.stringify(b[i] ?? "<end of file>").slice(0, 160)}\n` +
        `Edit one copy, then copy it over the other:\n` +
        `  apps/statenour/docs/NICKSTIRE-QUERY-CONTRACT.md\n` +
        `  apps/nickstire/docs/NICKSTIRE-QUERY-CONTRACT.md`,
    );
  });

  it("§7 has one well-formed row per live handler, in order, and no row for anything else", () => {
    const live = liveHandlers();
    expect(live.size).toBeGreaterThan(10);
    const rows = contractRows(readFileSync(CONTRACT_DOCS[0], "utf8"));
    const named = rows.map((r) => r.action);

    const missing = [...live].filter((h) => !named.includes(h)).sort();
    const extra = named.filter((a) => !live.has(a)).sort();
    const duplicated = named.filter((a, i) => named.indexOf(a) !== i);
    const malformed = rows
      .filter((r) => r.cells !== 3)
      .map((r) => `${r.action} (line ${r.line}: ${r.cells} cells; escape a pipe in a cell as \\|)`);
    // The table's heading says "alphabetical"; hold it to that.
    const outOfOrder = rows
      .filter((r, i) => i > 0 && rows[i - 1].action > r.action)
      .map((r) => `${r.action} (line ${r.line}) sorts before the row above it`);

    expect(
      { missing, extra, duplicated, malformed, outOfOrder },
      `§7 of docs/NICKSTIRE-QUERY-CONTRACT.md must list every QUERY_HANDLERS key in ` +
        `apps/nickstire/server/routes/nour-os-query.ts exactly once, alphabetically, as a 3-cell row.`,
    ).toEqual({ missing: [], extra: [], duplicated: [], malformed: [], outOfOrder: [] });
  });
});
