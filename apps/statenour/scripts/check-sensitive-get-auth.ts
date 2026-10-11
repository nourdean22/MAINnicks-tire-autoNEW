/**
 * Sensitive GET-route auth coverage gate · v10.0.183
 *
 * Replaces the bash-based file-level grep that was missing this
 * critical class:
 *
 *   export async function GET(...) {  ← no auth here
 *     const conv = await prisma.findUnique(...);
 *   }
 *   export async function PATCH(req, ...) {
 *     await requireSession(req);  ← only PATCH guarded
 *   }
 *
 * Pre-v10.0.183 the bash gate did `grep requireSession` against the
 * whole file. The PATCH usage matched, the gate passed, the GET was
 * left unauthed. /api/ai/chat/[id]/route.ts shipped this way.
 *
 * v10.0.183 fix · scope the auth check to each handler's BODY, not
 * the file globally.
 *
 * 2026-10-10 audit (SN-10 / F10) · the line-regex version still went green on
 * what it exists to catch, so it now reads the TypeScript syntax tree:
 *   · Scan set = the owner-private prefixes below + every route file whose URL
 *     bypasses the session middleware (isPublic, lib/security/route-policy.ts),
 *     route groups stripped, .tsx/.jsx included. There the route's own auth is
 *     the only wall.
 *   · A signal must be CODE: a CALL to a guard (requireSession, ...), a
 *     constant-time compare whose argument reaches a secret, or apiHandler's
 *     `auth: "owner" | "cron" | "sync" | "evidence" | "queue"` option (last writer
 *     wins; "queue" is the scoped /api/sync/queue key).
 *     A comment, string, type or bare reference that names requireSession no
 *     longer counts.
 *   · The auth call must run on EVERY path before the handler returns: not in
 *     a branch, a closure, a short-circuit right-hand side or a `.catch()`
 *     receiver, and not after an earlier return (2026-10-10 red team B01-B05).
 *   · `export { x as GET }`, `export * as GET`, re-exports and `export *` are
 *     seen. A handler that cannot be resolved in-file fails closed, and so do
 *     `export let`, destructured and import-equals exports.
 *   · A same-file declaration the handler CALLS is followed (`GET =
 *     withTracing(handler)`, a guard helper it calls), even when it shadows a
 *     guard's name; a helper it only names is not part of its body, and
 *     neither is a sibling PATCH.
 *   · `// public: <why>` exempts only the export statement it leads (as its own
 *     line comment, or as a ` * // public:` paragraph in the JSDoc directly above).
 *   · GET and HEAD are both read handlers.
 * Canary: tests/repo/check-get-auth-canary.test.ts. Red team:
 * tests/redteam/check-get-auth.redteam.test.ts.
 *
 * Usage: `pnpm check:get-auth` scans the tracked + untracked (not ignored) tree; extra args scan only
 * those files (the canary's end-to-end probe).
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { PUBLIC_EXACT, PUBLIC_PREFIXES, isPublic } from "../lib/security/route-policy";

/** Owner-private surfaces: the session middleware gates them; route auth is the second wall. */
const OWNER_PREFIXES = [
  "app/api/system",
  "app/api/brain",
  "app/api/financial",
  "app/api/decisions",
  "app/api/audit",
  "app/api/journal",
  "app/api/goals",
  "app/api/missions",
  "app/api/tasks",
  "app/api/commitments",
  "app/api/body",
  "app/api/habits",
  "app/api/devices",
  "app/api/mastery",
  "app/api/settings",
  "app/api/command",
  "app/api/chat",
  "app/api/actions-brain",
  "app/api/analytics",
  "app/api/integrations",
  "app/api/drift",
  "app/api/ai",
  "app/api/ultron",
  "app/api/health",
  "app/api/people",
  "app/api/relationships",
  // 07-X4 (2026-10-10): these leaned on the session middleware alone.
  "app/api/content",
  "app/api/drive",
  "app/api/tools",
  "app/api/notifications",
  // shortcut: one route, not app/api/oauth; widen once oauth/google-data/callback runs requireSession
  // (its CSRF-state compare is not auth to this gate).
  "app/api/oauth/google-data/status",
];

/** Every scanned /api directory: the list above plus each /api path that BYPASSES the session gate. */
export function scanPrefixes(): string[] {
  const bypass = [...PUBLIC_PREFIXES, ...PUBLIC_EXACT]
    .filter((p) => p.startsWith("/api/"))
    .map((p) => `app${p.replace(/\/$/, "")}`);
  return [...new Set([...OWNER_PREFIXES, ...bypass])];
}

const ROUTE_FILE = /\/route\.[jt]sx?$/;

export function listRoutes(): string[] {
  const prefixes = scanPrefixes();
  // -z: git prints a non-ASCII path raw instead of C-quoting it (red team B24).
  // --others: a route not yet `git add`ed is scanned too (verify:hard before the first commit, B26).
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "app"], { encoding: "utf8" })
    .split("\0")
    .filter((f) => {
      if (!ROUTE_FILE.test(f)) return false;
      const path = f.replace(/\/\([^/]+\)(?=\/)/g, ""); // a route group "(x)" is not in the URL (B23)
      const url = path.slice("app".length).replace(ROUTE_FILE, "") || "/";
      return prefixes.some((p) => path.startsWith(`${p}/`)) || isPublic(url); // B25: public non-/api too
    });
}

const READ_METHODS = new Set(["GET", "HEAD"]);
// 2026-07-28 cron-truth audit (dim 6): `validateToken` is the chrome-extension
// bearer gate (app/api/brain/by-url). `await auth()` is deliberately NOT a
// signal: routes use requireSession so one grep-able idiom guards them all.
// assertRunnerRequest / requireBridgeAuth are the runner and bridge guards
// (lib/internal/runner-auth.ts, lib/bridge-auth.ts; red team F04/F05).
const GUARD_IDENT =
  /^(?:requireSession|requireCronAuth|requireSyncAuth|requireEvidenceAuth|validateToken|assertRunnerRequest|requireBridgeAuth)$/;
// An inline Bearer/x-sync-key check counts by its constant-time COMPARE, and only
// when an argument reaches a secret: app/api/version reads `Boolean(env.CRON_SECRET)`
// and is open, and an ETag compare is not auth (red team B14).
const COMPARE_IDENT = /^(?:safeEqual|timingSafeEqual)$/;
const SECRET_NAME = /secret|key|token/i;
// apiHandler pre-set to that auth (lib/utils/http.ts).
const AUTH_WRAPPERS = new Set(["cronHandler", "syncHandler", "evidenceHandler"]);
const AUTH_MODES = new Set(["owner", "cron", "sync", "evidence", "queue"]);
const SHORT_CIRCUIT = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

type Fn = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;
/** A name bound in the scope being read: its const initializer or function, else undefined (param, let). */
type Scope = Map<string, ts.Node | undefined>;
/** Path state after a statement: auth has run (or the request ended), a return without auth, or neither. */
type Flow = "safe" | "leak" | "none";
const GLOBAL = Symbol("global");

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

const isFn = (n: ts.Node): n is Fn =>
  (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n)) &&
  n.body !== undefined;

const skip = (n: ts.Node): ts.Node => (ts.isExpression(n) ? ts.skipOuterExpressions(n) : n);
const some = (n: ts.Node, f: (c: ts.Node) => boolean): boolean => !!ts.forEachChild(n, (c) => f(c) || undefined);

/** Binds `name` (or every name in a destructuring pattern) into `scope`. */
function bind(scope: Scope, name: ts.BindingName, value?: ts.Node): void {
  if (ts.isIdentifier(name)) scope.set(name.text, value);
  else for (const el of name.elements) if (!ts.isOmittedExpression(el)) bind(scope, el.name);
}

function namesIn(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((el) => (ts.isOmittedExpression(el) ? [] : namesIn(el.name)));
}

/** Params, consts, lets and inner functions a function declares (not its closures' own). */
function localsOf(fn: Fn): Scope {
  const scope: Scope = new Map();
  for (const p of fn.parameters) bind(scope, p.name);
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n)) {
      const isConst = ts.isVariableDeclarationList(n.parent) && (n.parent.flags & ts.NodeFlags.Const) !== 0;
      bind(scope, n.name, isConst ? n.initializer : undefined);
    } else if (ts.isFunctionDeclaration(n) && n.name) scope.set(n.name.text, n);
    if (!ts.isFunctionLike(n)) ts.forEachChild(n, visit);
  };
  if (fn.body) visit(fn.body);
  return scope;
}

/** A `// public: <why>` line comment, or a ` * // public:` paragraph of the JSDoc, leading `s`. */
function hasPublicMarker(src: string, s: ts.Statement): boolean {
  return (ts.getLeadingCommentRanges(src, s.pos) ?? []).some((r) => {
    const text = src.slice(r.pos, r.end);
    if (r.kind === ts.SyntaxKind.SingleLineCommentTrivia) return /^\/\/\s*public:\s*\S/.test(text);
    // Must open a paragraph: prose that wraps onto a `// public:` line is not a marker (red team B21).
    const lines = text.split(/\r?\n/);
    return lines.some(
      (line, i) => i > 0 && /^\s*\*?\s*\/\/\s*public:\s*\S/.test(line) && /^\s*(?:\/\*+|\*)?\s*$/.test(lines[i - 1]),
    );
  });
}

/** The exported read handlers in `src` that carry no auth signal (method names, or "export *"). */
export function checkSource(src: string, fileName = "route.ts"): string[] {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true);

  // Top-level bindings. A `let`/`var` maps to undefined: it can be reassigned, so it is never followed.
  const decls: Scope = new Map();
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name && s.body) decls.set(s.name.text, s);
    if (ts.isVariableStatement(s)) {
      const isConst = (s.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const d of s.declarationList.declarations) bind(decls, d.name, isConst ? d.initializer : undefined);
    }
  }
  const resolve = (name: string, locals: Scope): ts.Node | undefined | typeof GLOBAL =>
    locals.has(name) ? locals.get(name) : decls.has(name) ? decls.get(name) : GLOBAL;

  /** True if `expr` reaches a secret-named identifier, following same-file consts and functions. */
  const reachesSecret = (expr: ts.Node, locals: Scope, seen: Set<ts.Node>): boolean => {
    const walk = (n: ts.Node): boolean => {
      if (!ts.isIdentifier(n)) return some(n, walk);
      if (SECRET_NAME.test(n.text)) return true;
      if (ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) return false;
      const r = resolve(n.text, locals);
      if (!r || r === GLOBAL || seen.has(r)) return false;
      seen.add(r);
      return walk(r);
    };
    return walk(expr);
  };

  /** Is this call an auth check? Guards by name, compares by secret argument, same-file helpers by their body. */
  const isAuthCall = (call: ts.CallExpression, locals: Scope): boolean => {
    const callee = ts.skipOuterExpressions(call.expression);
    const member = ts.isPropertyAccessExpression(callee);
    const name = member ? callee.name.text : ts.isIdentifier(callee) ? callee.text : undefined;
    if (!name) return false;
    if (COMPARE_IDENT.test(name)) return call.arguments.some((a) => reachesSecret(a, locals, new Set()));
    if (member) return GUARD_IDENT.test(name);
    const r = resolve(name, locals);
    // A same-file declaration is followed even when it shadows a guard's name (red team B15).
    if (r !== GLOBAL) return helperAuthed(r);
    return GUARD_IDENT.test(name);
  };

  /**
   * Does evaluating `n` run an auth call? `everyPath` (handlers) skips short-circuit
   * right-hand sides and ?: branches; helpers count a call anywhere in their code.
   * Never inside a closure (B05) or the receiver of `.catch()`, which swallows the denial (B04).
   */
  const runsAuth = (n: ts.Node, locals: Scope, everyPath: boolean): boolean => {
    const walk = (c: ts.Node): boolean => {
      if (ts.isFunctionLike(c)) return false;
      if (ts.isCallExpression(c)) {
        const callee = ts.skipOuterExpressions(c.expression);
        if (ts.isPropertyAccessExpression(callee) && callee.name.text === "catch") return false;
        if (isAuthCall(c, locals)) return true;
      }
      if (everyPath && ts.isConditionalExpression(c)) return walk(c.condition);
      if (everyPath && ts.isBinaryExpression(c) && SHORT_CIRCUIT.has(c.operatorToken.kind)) return walk(c.left);
      return some(c, walk);
    };
    return walk(n);
  };

  /**
   * A same-file guard helper the handler calls: does it run an auth call anywhere? Memoized per
   * helper (false while in progress, so recursion ends), so a second call to it still counts.
   */
  const helperMemo = new Map<ts.Node, boolean>();
  const helperAuthed = (node: ts.Node | undefined): boolean => {
    if (!node) return false;
    const known = helperMemo.get(node);
    if (known !== undefined) return known;
    helperMemo.set(node, false);
    const fn = skip(node);
    const authed = isFn(fn) && runsAuth(fn.body!, localsOf(fn), false);
    helperMemo.set(node, authed);
    return authed;
  };

  /** Does auth run on every path through `fn` before it returns? */
  const dominates = (fn: Fn): boolean => {
    const locals = localsOf(fn);
    const ran = (n: ts.Node) => runsAuth(n, locals, true);
    // When `e` evaluated to `truthy`, did an auth call run? Follows `!`, &&, || and local consts,
    // so `const ok = Boolean(secret) && safeEqual(...); if (!ok) return 401` counts (cron/mega).
    const passed = (node: ts.Expression, truthy: boolean, depth = 0): boolean => {
      const e = ts.skipOuterExpressions(node);
      if (depth > 8) return ran(e);
      if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) {
        return passed(e.operand, !truthy, depth + 1);
      }
      if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
        return truthy ? passed(e.left, true, depth + 1) || passed(e.right, true, depth + 1) : ran(e.left);
      }
      if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
        return truthy ? ran(e.left) : passed(e.left, false, depth + 1) || passed(e.right, false, depth + 1);
      }
      const init = ts.isIdentifier(e) ? locals.get(e.text) : undefined;
      if (init && ts.isExpression(init)) return passed(init, truthy, depth + 1);
      return ran(e);
    };
    const exits = (s: ts.Statement): boolean =>
      ts.isReturnStatement(s) ||
      ts.isThrowStatement(s) ||
      (ts.isBlock(s) && s.statements.some(exits)) ||
      (ts.isIfStatement(s) && !!s.elseStatement && exits(s.thenStatement) && exits(s.elseStatement));
    const containsReturn = (n: ts.Node): boolean =>
      ts.isReturnStatement(n) || (!ts.isFunctionLike(n) && some(n, containsReturn));

    const flowAll = (stmts: readonly ts.Statement[]): Flow => {
      for (const s of stmts) {
        const f = flow(s);
        if (f !== "none") return f;
      }
      return "none";
    };
    const flow = (s: ts.Statement): Flow => {
      if (ts.isBlock(s)) return flowAll(s.statements);
      if (ts.isExpressionStatement(s)) return ran(s.expression) ? "safe" : "none";
      if (ts.isVariableStatement(s)) {
        return s.declarationList.declarations.some((d) => d.initializer && ran(d.initializer)) ? "safe" : "none";
      }
      if (ts.isReturnStatement(s)) return s.expression && ran(s.expression) ? "safe" : "leak";
      if (ts.isThrowStatement(s)) return "safe"; // the request ends without data
      if (ts.isIfStatement(s)) {
        // `if (!ok) return 401` guards what follows: the path that continues saw the check run.
        const c = s.expression;
        if (exits(s.thenStatement) && passed(c, false)) return "safe";
        if (s.elseStatement && exits(s.elseStatement) && passed(c, true)) return "safe";
        const t = flow(s.thenStatement);
        const e = s.elseStatement ? flow(s.elseStatement) : "none";
        if (t === "leak" || e === "leak") return "leak";
        return t === "safe" && e === "safe" ? "safe" : "none";
      }
      if (ts.isTryStatement(s)) {
        const t = flowAll(s.tryBlock.statements);
        if (t === "leak") return "leak";
        const c = s.catchClause ? flowAll(s.catchClause.block.statements) : "safe";
        // A guard that throws inside try is honored only when the catch ends the request or runs
        // its own guard (`catch { await requireSyncAuth(req) }`, devices/command/[id]).
        if (t === "safe") return !s.catchClause || exits(s.catchClause.block) || c === "safe" ? "safe" : "none";
        return c === "leak" ? "leak" : "none";
      }
      if (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) return "none";
      // Loops, switch, labels: a return inside them comes before any auth after them.
      return containsReturn(s) ? "leak" : "none";
    };

    const body = fn.body!;
    return ts.isBlock(body) ? flowAll(body.statements) === "safe" : ran(body);
  };

  /** apiHandler options: the auth mode the LAST writer sets, null if none does, "?" if unknowable (B09/B10). */
  const authOption = (node: ts.Node | undefined, depth = 0): string | null => {
    if (!node) return null;
    const e = skip(node);
    if (depth > 8) return "?";
    if (ts.isIdentifier(e)) {
      const d = decls.get(e.text);
      return d ? authOption(d, depth + 1) : "?";
    }
    if (!ts.isObjectLiteralExpression(e)) return "?";
    const literal = (v: ts.Node, n = 0): string => {
      const x = skip(v); // `"owner" as const` (F01)
      if (ts.isStringLiteralLike(x)) return x.text;
      const d = ts.isIdentifier(x) && n < 8 ? decls.get(x.text) : undefined;
      return d ? literal(d, n + 1) : "?";
    };
    let mode: string | null = null;
    for (const p of e.properties) {
      if (ts.isSpreadAssignment(p)) {
        const m = authOption(p.expression, depth + 1);
        if (m !== null) mode = m;
      } else if (!p.name || ts.isComputedPropertyName(p.name)) {
        mode = "?"; // a computed key may be "auth"
      } else if ((ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === "auth") {
        // `"auth": "owner"` (F02), `{ auth }` shorthand (F03)
        mode = ts.isPropertyAssignment(p) ? literal(p.initializer) : ts.isShorthandPropertyAssignment(p) ? literal(p.name) : "?";
      }
    }
    return mode;
  };

  /** Is the handler expression an exported read handler with auth on every path? */
  const handlerAuthed = (node: ts.Node | undefined, seen: Set<ts.Node>): boolean => {
    if (!node || seen.has(node)) return false;
    seen.add(node);
    const e = skip(node);
    if (isFn(e)) return dominates(e);
    if (ts.isIdentifier(e)) return handlerAuthed(decls.get(e.text), seen);
    if (!ts.isCallExpression(e)) return false;
    // A same-file declaration shadowing a wrapper's name is just another wrapper (B15).
    const name = ts.isIdentifier(e.expression) && !decls.has(e.expression.text) ? e.expression.text : undefined;
    if (name && AUTH_WRAPPERS.has(name)) return true;
    // The auth option counts only as apiHandler's 2nd argument, never as data inside the handler (B08).
    if (name === "apiHandler" && AUTH_MODES.has(authOption(e.arguments[1]) ?? "")) return true;
    // Any other wrapper (withTracing, withRateLimit, apiHandler without auth): its handler argument decides.
    return e.arguments.some((a) => handlerAuthed(a, seen));
  };

  const unauthed: string[] = [];
  for (const s of sf.statements) {
    const marked = hasPublicMarker(src, s);
    const check = (method: string, node: ts.Node | undefined): void => {
      if (READ_METHODS.has(method) && !marked && !handlerAuthed(node, new Set())) unauthed.push(method);
    };

    if (ts.isFunctionDeclaration(s) && s.name && s.body && isExported(s)) {
      check(s.name.text, s);
    } else if (ts.isVariableStatement(s) && isExported(s)) {
      // `export let GET` can be reassigned after its initializer was checked (B16): fail closed.
      const isConst = (s.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const d of s.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) check(d.name.text, isConst ? d.initializer : undefined);
        // A destructured export cannot be matched to its own initializer here (B11, B17, B18): fail closed.
        else for (const name of namesIn(d.name)) check(name, undefined);
      }
    } else if (ts.isExportDeclaration(s) && !s.isTypeOnly) {
      if (!s.exportClause) {
        if (!marked) unauthed.push("export *");
      } else if (ts.isNamespaceExport(s.exportClause)) {
        check(s.exportClause.name.text, undefined); // `export * as GET from` (B20)
      } else {
        for (const spec of s.exportClause.elements) {
          // A re-export from another module cannot be verified here: undefined fails closed.
          if (!spec.isTypeOnly) check(spec.name.text, s.moduleSpecifier ? undefined : decls.get((spec.propertyName ?? spec.name).text));
        }
      }
    } else if (ts.isImportEqualsDeclaration(s) && isExported(s)) {
      check(s.name.text, undefined); // `export import GET = impl.GET` (B19)
    }
  }
  return unauthed;
}

function main(): void {
  const args = process.argv.slice(2);
  const files = args.length > 0 ? args : listRoutes();
  if (files.length === 0) {
    console.error("✗ scanned 0 route files: run from apps/statenour (git ls-files app found nothing).");
    process.exit(1);
  }
  const violations: Array<{ file: string; methods: string[] }> = [];
  for (const file of files) {
    let src: string;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      violations.push({ file, methods: ["unreadable"] });
      continue;
    }
    const methods = checkSource(src, file);
    if (methods.length > 0) violations.push({ file, methods });
  }

  if (violations.length === 0) {
    console.log(
      `✓ scanned ${files.length} route file(s): every exported GET/HEAD has auth in its body or a // public: marker`,
    );
    process.exit(0);
  }

  console.error("");
  console.error(
    `✗ ${violations.length} of ${files.length} route file(s) export a read handler with no auth IN ITS BODY:`,
  );
  console.error("");
  for (const v of violations) console.error(`  ${v.file}  [${v.methods.join(", ")}]`);
  console.error("");
  console.error(
    'Fix: `apiHandler(..., { auth: "owner" })`, or `await requireSession(req)` at the top of the handler,',
  );
  console.error(
    "or `// public: <why>` on the line directly above the export if it is intentionally open.",
  );
  console.error("Comments, strings and auth calls that a branch, closure or .catch() can skip do not count.");
  process.exit(1);
}

if (process.argv[1]?.includes("check-sensitive-get-auth")) main();
