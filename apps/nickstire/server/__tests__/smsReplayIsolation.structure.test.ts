/**
 * Structural canary: every write or send in smsOrchestrator.ts sits inside the
 * `run` thunk of an `smsEffect(...)` call.
 *
 * 2026-10-09 (autoresearch audit, SMS replay isolation). The replay used to
 * fake only `sendSms`; every other effect on the path wrote to production. The
 * fix routes each effect through smsEffect (server/services/smsReplayScope.ts).
 * This test parses the orchestrator with the TypeScript compiler and fails when
 * a new effect is added without the wrapper, so the isolation cannot silently
 * rot. It checks five things:
 *
 *   1. every `.insert(` / `.update(` / `.delete(` / `.transaction(` call, every
 *      `.execute(` / `.query(` that is not a SELECT / WITH read free of write
 *      keywords (so `WITH t AS (...) UPDATE ...` is a write), and every call to
 *      a known mutating function is inside the SECOND argument of smsEffect,
 *      and that argument is a thunk (an eager `smsEffect("x", db.insert(...))`
 *      would already have written). The DB methods match on ANY receiver (`db`,
 *      `d`, `db!`, `(await getDbTyped())!`, `conn`, `h.db`, `db["insert"]`) and
 *      bare (`insert(...)`): receiver names are not trusted. A computed call
 *      `obj[expr](...)` fails closed;
 *   2. aliases are followed: `import { sendSms as send }` and
 *      `const { markPhoneOptedIn: optIn } = await import("../sms")` make `send`
 *      and `optIn` mutating, and an effect lifted out as a VALUE outside a run
 *      thunk is a finding, because the canary cannot follow it further:
 *      `const f = sendSms`, `{ sendSms }`, `(0, sendSms)(p)`, `sendSms.call(...)`,
 *      `const ins = db.insert`, `const ins = db["update"]`, and any
 *      destructuring of a DB method or mutating function off a non-module
 *      object (`const { insert } = db`, `const { insert: ins } = db`,
 *      `({ update: up } = db)`, `const { [m]: f } = db`);
 *   3. no smsEffect wraps a pure read (a wrapped read would be SKIPPED in a
 *      replay and change the replayed decision);
 *   4. every module the orchestrator imports, statically or dynamically, is
 *      classified below as pure / read / external-read / effect, so a new
 *      module cannot slip in unreviewed;
 *   5. every binding taken from a NON-pure module is either a known mutating
 *      function (so 1 and 2 match its calls) or on that module's explicit read
 *      list. This is what catches a writer exported by a "read" module, such as
 *      updateBookingStatus from ../db or setFlag from ./featureFlags.
 *
 * Positive controls: the same matcher is run on planted snippets and MUST flag
 * each broken shape (the reviews of 2026-10-09 planted 9 shapes the first
 * version missed and 3 the second missed; each is a case below); the real file
 * must produce zero findings, a non-zero count of wrapped sites, and exactly
 * one finding when an unwrapped write is appended to it.
 *
 * Out of reach, stated so a green is not over-read: a method name built at
 * run time (`Reflect.get(db, name)`, a computed `obj[expr]` VALUE later called)
 * and a write hidden inside an interpolated `sql.raw(...)` fragment of a
 * SELECT. The behaviour test (every DB and module mock throws and counts) is
 * the backstop for those, for the events it replays.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const ORCHESTRATOR = resolve(__dirname, "../services/smsOrchestrator.ts");

/** Functions that write to a store or send to a person, wherever they come from. */
const MUTATING_CALLEES = new Set([
  "sendSms",
  "sendSmsOrThrow",
  "markPhoneFullyOptedOut",
  "markPhoneOptedOut",
  "markPhoneOptedIn",
  "markPhoneVoiceOptedOut",
  "logSmsOptOut",
  "logSmsOptIn",
  "appendConsentEvent",
  "recordExpectedArrival",
  "cancelBookingReminders",
  "trackOrchestrationOutcome",
  "trackConversionOutcome",
  "sendNotification",
  "notifyOwner",
  // A direct network call from this file is an effect too (webhook, Telegram,
  // email API). Model reads go through ./nickgpt-client and ./classifiers.
  "fetch",
]);

/** Called on ANY receiver, these write (Drizzle / mysql2). */
const DB_WRITE_METHODS = new Set(["insert", "update", "delete", "transaction"]);
/** Raw SQL: exempt only when the statement is a recognizable SELECT / WITH read with no write keyword. */
const DB_RAW_METHODS = new Set(["execute", "query"]);
/**
 * A write keyword anywhere in raw SQL text. Catches `WITH t AS (...) UPDATE ...`
 * and `WITH ... DELETE` (valid MySQL 8 writes that start like a read) and a
 * second statement after `;`. `SELECT ... FOR UPDATE` and `SELECT ... INTO`
 * also match; that fails closed, which is the intent.
 */
const SQL_WRITE_KEYWORD = /\b(INSERT|UPDATE|DELETE|REPLACE|TRUNCATE|DROP|ALTER|CREATE|RENAME|GRANT|REVOKE|LOAD|CALL|INTO)\b/i;

function isDbMethodName(name: string): boolean {
  return DB_WRITE_METHODS.has(name) || DB_RAW_METHODS.has(name);
}

type ModuleClass = "pure" | "read" | "external-read" | "effect";

interface ModuleRule {
  cls: ModuleClass;
  /** Non-pure modules only: bindings that are reads, constants or the gate itself. */
  reads?: readonly string[];
}

/**
 * Every module smsOrchestrator.ts imports. "pure": no I/O, bindings unchecked.
 * "read": DB reads only, and only the listed bindings may be taken.
 * "external-read": a model call with no stored state, needed for the replayed
 * decision; the replay script's deny-all fetch blocks it. "effect": its
 * mutating exports are in MUTATING_CALLEES and every call is wrapped.
 */
const MODULES: Record<string, ModuleRule> = {
  // The handle getters only. ../db also exports ~49 writers (createBooking,
  // updateBookingStatus, upsertUser, ...); taking any of them is a finding.
  "../db": { cls: "read", reads: ["getDbTyped", "getDb"] },
  "../../drizzle/schema": { cls: "pure" },
  "../sms": { cls: "effect", reads: ["loadSuppressionIndex"] }, // loadSuppressionIndex: DB reads into an in-process cache
  "./smsResponseParser": { cls: "pure" },
  "./smsIntentRouter": { cls: "pure" },
  "./smsReplyPlanner": { cls: "pure" },
  "./nickgpt-client": { cls: "external-read", reads: ["draftSmsReply"] },
  "./classifiers": { cls: "external-read", reads: ["classifyIntent"] },
  "./featureFlags": { cls: "read", reads: ["isEnabled"] }, // NOT setFlag / seedFlags
  "@shared/business": { cls: "pure" },
  "@shared/shopState": { cls: "pure" },
  "@shared/smsOptOutKeywords": { cls: "pure" },
  "../lib/logger": { cls: "pure" }, // stdout/stderr only
  "../lib/smsNotSentLog": { cls: "pure" }, // builds log fields
  "../lib/phone": { cls: "pure" },
  "../lib/dbErrors": { cls: "pure" },
  "drizzle-orm": { cls: "pure" },
  "./smsMessageCatalog": { cls: "pure" },
  "./nickgptPreflightGuard": { cls: "pure" },
  // The gate itself. Checked because it also exports the replay script's
  // process-level helpers (installDenyAllFetch, runInSmsReplayScope).
  "./smsReplayScope": { cls: "read", reads: ["smsEffect", "isSmsReplayActive", "REPLAY_FAKE_SEND_SID"] },
  "./complianceLog": { cls: "effect" },
  "./consentLedger": { cls: "effect", reads: ["SMS_KEYWORD_GRANT_SCOPES"] }, // a constant
  "./expectedArrivals": { cls: "effect", reads: ["detectArrivalIntent"] }, // pure regex
  "./smsLearningEngine": { cls: "effect" },
  "./sms-scheduler": { cls: "effect" },
  "../email-notify": { cls: "effect" },
  "./humanTakeover": { cls: "read", reads: ["isConversationHumanHeld"] }, // a SELECT on audit_log
};

interface Finding {
  line: number;
  text: string;
  reason: string;
}

interface Analysis {
  findings: Finding[];
  /** Mutating calls found correctly inside an smsEffect run thunk. */
  wrappedSites: number;
  smsEffectCalls: number;
}

/** Strips `( )`, `!`, `as T`, `<T>` and `satisfies T`, which change nothing at runtime. */
function strip(e: ts.Expression): ts.Expression {
  let cur = e;
  while (
    ts.isParenthesizedExpression(cur) ||
    ts.isNonNullExpression(cur) ||
    ts.isAsExpression(cur) ||
    ts.isTypeAssertionExpression(cur) ||
    ts.isSatisfiesExpression(cur)
  ) {
    cur = cur.expression;
  }
  return cur;
}

type Callee =
  | { kind: "fn"; local: string }
  | { kind: "method"; name: string }
  | { kind: "computed" }
  | { kind: "other" };

function calleeOf(call: ts.CallExpression): Callee {
  const e = strip(call.expression);
  if (ts.isIdentifier(e)) return { kind: "fn", local: e.text };
  if (ts.isPropertyAccessExpression(e)) return { kind: "method", name: e.name.text };
  if (ts.isElementAccessExpression(e)) {
    return ts.isStringLiteralLike(e.argumentExpression) ? { kind: "method", name: e.argumentExpression.text } : { kind: "computed" };
  }
  return { kind: "other" };
}

function isSmsEffectCall(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "smsEffect";
}

function sqlTextOf(arg: ts.Expression | undefined): string | null {
  if (!arg) return null;
  if (ts.isTaggedTemplateExpression(arg)) return arg.template.getText();
  if (ts.isStringLiteralLike(arg)) return arg.text;
  return null;
}

/** local binding name -> the mutating export it is bound to (only aliases that differ). */
type Aliases = ReadonlyMap<string, string>;

/** Why this call is an effect, or null when it is not one. */
function effectReason(call: ts.CallExpression, aliases: Aliases): string | null {
  const c = calleeOf(call);
  if (c.kind === "other") return null;
  if (c.kind === "computed") return "computed method call obj[expr](...) that this canary cannot classify";
  // A bare `insert(...)` is a DB method destructured off a handle (`const { insert } = db`).
  const label = c.kind === "fn" ? `${c.local}(` : `.${c.name}(`;
  const name = c.kind === "fn" ? (aliases.get(c.local) ?? c.local) : c.name;
  if (MUTATING_CALLEES.has(name)) {
    return c.kind === "fn" && name !== c.local ? `calls mutating function ${name}() via alias ${c.local}` : `calls mutating function ${name}()`;
  }
  if (DB_WRITE_METHODS.has(name)) return `${label} writes (any receiver)`;
  if (DB_RAW_METHODS.has(name)) {
    const text = sqlTextOf(call.arguments[0]);
    // Fail closed: only a recognizable pure SELECT / WITH read is exempt.
    if (text === null) return `${label} with an unclassifiable argument`;
    const head = text.replace(/^`/, "").trimStart().toUpperCase();
    if (!(head.startsWith("SELECT") || head.startsWith("WITH"))) return `${label} runs a non-SELECT statement`;
    const write = SQL_WRITE_KEYWORD.exec(text);
    if (write) return `${label} runs SQL containing the write keyword ${write[1].toUpperCase()}`;
  }
  return null;
}

/** True when `node` is inside the body of the run thunk (2nd arg) of an smsEffect call. */
function wrappedBySmsEffect(node: ts.Node): { ok: boolean; why?: string } {
  let child: ts.Node = node;
  let parent: ts.Node | undefined = node.parent;
  while (parent) {
    if (isSmsEffectCall(parent) && child !== parent.expression) {
      const run = parent.arguments[1];
      if (child !== run) return { ok: false, why: "inside smsEffect but not in its run argument (it would execute during a replay)" };
      if (!(ts.isArrowFunction(run) || ts.isFunctionExpression(run))) {
        return { ok: false, why: "smsEffect run argument is not a thunk (the effect executes before smsEffect is called)" };
      }
      return { ok: true };
    }
    child = parent;
    parent = parent.parent;
  }
  return { ok: false, why: "not inside smsEffect" };
}

/** The mutating function an identifier names (through an alias when it is a local binding), or null. */
function mutatingTargetOf(id: ts.Identifier, aliases: Aliases): string | null {
  const isPropName = !!id.parent && ts.isPropertyAccessExpression(id.parent) && id.parent.name === id;
  const target = isPropName ? id.text : (aliases.get(id.text) ?? id.text);
  return MUTATING_CALLEES.has(target) ? target : null;
}

/**
 * Why this identifier hands an effect around as a VALUE the call matcher cannot
 * follow, or null: a mutating function assigned / passed / `.call`-ed, or a DB
 * write method lifted off its handle (`const ins = db.insert`).
 */
function escapingReferenceReason(id: ts.Identifier, aliases: Aliases): string | null {
  const target = mutatingTargetOf(id, aliases);
  if (target && isEscapingValueReference(id)) {
    return `mutating function ${target} used as a value outside smsEffect (an alias this canary cannot follow)`;
  }
  const p = id.parent;
  if (p && ts.isPropertyAccessExpression(p) && p.name === id && isDbMethodName(id.text)) {
    if (!isCalleePosition(p)) return `DB method .${id.text} taken as a value outside smsEffect (the call matcher cannot follow it)`;
  }
  return null;
}

/** True when `expr`, once no-op wrappers are peeled off, is the callee of a call (the call matcher owns it). */
function isCalleePosition(expr: ts.Node): boolean {
  const outer = climbWrappers(expr);
  return !!outer.parent && ts.isCallExpression(outer.parent) && outer.parent.expression === outer;
}

/**
 * `db["update"]` / `sms["sendSms"]` taken as a VALUE (`const ins = db["update"]`):
 * the element-access twin of the `.update` case above. As a callee it is the
 * call matcher's (calleeOf reads string-literal element access). A computed
 * `obj[expr]` value is not flagged: that shape is everywhere (lookup tables),
 * and only a computed CALL fails closed.
 */
function elementAccessValueReason(e: ts.ElementAccessExpression): string | null {
  if (!ts.isStringLiteralLike(e.argumentExpression)) return null;
  const key = e.argumentExpression.text;
  if (!isDbMethodName(key) && !MUTATING_CALLEES.has(key)) return null;
  if (isCalleePosition(e)) return null;
  return isDbMethodName(key)
    ? `DB method ["${key}"] taken as a value outside smsEffect (the call matcher cannot follow it)`
    : `mutating function ["${key}"] taken as a value outside smsEffect (the call matcher cannot follow it)`;
}

const COMPUTED_KEY = Symbol("computed key");

function destructuredKeyOf(name: ts.PropertyName | ts.BindingName | undefined): string | null | typeof COMPUTED_KEY {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) return COMPUTED_KEY;
  return null; // a nested pattern: its own elements are checked when visited
}

function isDynamicImportCall(e: ts.Expression | undefined): boolean {
  if (!e) return false;
  const s = strip(e);
  return ts.isCallExpression(s) && s.expression.kind === ts.SyntaxKind.ImportKeyword;
}

/**
 * True for the binding pattern of a module (`const { a } = await import("x")`,
 * `import("x").then(({ a }) => ...)`). Those bindings are classified by MODULES
 * and turned into aliases in pass 1, so destructuring them is not an escape.
 */
function isModuleBindingPattern(pattern: ts.Node): boolean {
  const p = pattern.parent;
  if (p && ts.isVariableDeclaration(p) && p.name === pattern && p.initializer) {
    const init = strip(p.initializer);
    return ts.isAwaitExpression(init) && isDynamicImportCall(init.expression);
  }
  if (p && ts.isParameter(p) && p.name === pattern) {
    const fn = p.parent;
    const call = fn.parent;
    return (
      (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
      fn.parameters[0] === p &&
      !!call &&
      ts.isCallExpression(call) &&
      call.arguments[0] === fn &&
      ts.isPropertyAccessExpression(call.expression) &&
      call.expression.name.text === "then" &&
      isDynamicImportCall(call.expression.expression)
    );
  }
  return false;
}

/**
 * A DB method or a mutating function pulled off an object by destructuring
 * (`const { insert: ins } = db`, `const { update } = h.db`, `({ execute: run } = db)`,
 * `const { sendSms: s } = deps`): the local name no longer says what it is,
 * so the call matcher cannot follow it. Fails closed on any non-module pattern,
 * renamed or not, and on a computed key (`const { [m]: f } = db`).
 */
function destructuringReason(node: ts.Node): string | null {
  const flag = (key: string | null | typeof COMPUTED_KEY): string | null => {
    if (key === COMPUTED_KEY) return "computed destructuring { [expr]: x } that this canary cannot classify";
    if (key === null) return null;
    if (isDbMethodName(key)) return `DB method ${key} destructured off a handle (the call matcher cannot follow the binding)`;
    if (MUTATING_CALLEES.has(key)) return `mutating function ${key} destructured off a non-module object (the call matcher cannot follow the binding)`;
    return null;
  };
  if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
    if (node.dotDotDotToken || isModuleBindingPattern(node.parent)) return null;
    return flag(destructuredKeyOf(node.propertyName ?? node.name));
  }
  // Assignment destructuring: `({ insert: ins } = db)`.
  if (ts.isObjectLiteralExpression(node) && isAssignmentTarget(node)) {
    for (const prop of node.properties) {
      const key = ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop) ? destructuredKeyOf(prop.name) : null;
      const reason = flag(key);
      if (reason) return reason;
    }
  }
  return null;
}

/** True when an object literal is the target of a destructuring assignment (`({ a } = x)`, nested ones too). */
function isAssignmentTarget(node: ts.ObjectLiteralExpression): boolean {
  const outer = climbWrappers(node);
  const p = outer.parent;
  if (!p) return false;
  if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.left === outer) return true;
  if (ts.isForOfStatement(p) && p.initializer === outer) return true;
  if (ts.isPropertyAssignment(p) && p.initializer === outer && ts.isObjectLiteralExpression(p.parent)) return isAssignmentTarget(p.parent);
  return false;
}

/** Why this node lifts an effect out where the call matcher cannot follow it, or null. */
function liftedEffectReason(node: ts.Node, aliases: Aliases): string | null {
  if (ts.isIdentifier(node)) return escapingReferenceReason(node, aliases);
  if (ts.isElementAccessExpression(node)) return elementAccessValueReason(node);
  return destructuringReason(node);
}

/** True when `node` holds an effect call, or an effect handed around as a value (rebound inside the thunk). */
function containsEffect(node: ts.Node, aliases: Aliases): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if ((ts.isCallExpression(n) && effectReason(n, aliases)) || liftedEffectReason(n, aliases)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

interface ImportedBinding {
  imported: string;
  local: string;
}

function bindingsOf(pattern: ts.BindingName): ImportedBinding[] | null {
  if (!ts.isObjectBindingPattern(pattern)) return null;
  const out: ImportedBinding[] = [];
  for (const el of pattern.elements) {
    if (el.dotDotDotToken || !ts.isIdentifier(el.name)) return null; // rest or nested pattern: unreadable
    const imported = el.propertyName
      ? ts.isIdentifier(el.propertyName) || ts.isStringLiteralLike(el.propertyName)
        ? el.propertyName.text
        : null
      : el.name.text;
    if (imported === null) return null;
    out.push({ imported, local: el.name.text });
  }
  return out;
}

/** Bindings taken from a dynamic import, or null when the usage shape is not recognized. */
function dynamicImportBindings(call: ts.CallExpression): ImportedBinding[] | null {
  const p = call.parent;
  // const { a, b: c } = await import("x");
  if (p && ts.isAwaitExpression(p) && p.parent && ts.isVariableDeclaration(p.parent)) {
    return bindingsOf(p.parent.name);
  }
  // import("x").then(({ a }) => ...)
  if (p && ts.isPropertyAccessExpression(p) && p.name.text === "then" && p.parent && ts.isCallExpression(p.parent)) {
    const cb = p.parent.arguments[0];
    if (cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) && cb.parameters[0]) {
      return bindingsOf(cb.parameters[0].name);
    }
  }
  return null;
}

function staticImportBindings(node: ts.ImportDeclaration): ImportedBinding[] | null {
  const clause = node.importClause;
  if (!clause || clause.isTypeOnly) return [];
  const out: ImportedBinding[] = [];
  if (clause.name) out.push({ imported: "default", local: clause.name.text });
  const nb = clause.namedBindings;
  if (nb && ts.isNamespaceImport(nb)) return null; // `import * as m`: unreadable
  if (nb && ts.isNamedImports(nb)) {
    for (const el of nb.elements) {
      if (el.isTypeOnly) continue;
      out.push({ imported: (el.propertyName ?? el.name).text, local: el.name.text });
    }
  }
  return out;
}

/** The outermost expression a reference sits in once no-op wrappers are peeled off. */
function climbWrappers(node: ts.Node): ts.Node {
  let cur = node;
  while (
    cur.parent &&
    (ts.isParenthesizedExpression(cur.parent) ||
      ts.isNonNullExpression(cur.parent) ||
      ts.isAsExpression(cur.parent) ||
      ts.isTypeAssertionExpression(cur.parent) ||
      ts.isSatisfiesExpression(cur.parent))
  ) {
    cur = cur.parent;
  }
  return cur;
}

/**
 * True when `id` (already known to name a mutating function) is used as a
 * VALUE that escapes the call matcher: assigned, passed, returned, put in an
 * object. Declarations, call positions, object keys and types are not values.
 */
function isEscapingValueReference(id: ts.Identifier): boolean {
  const p = id.parent;
  if (!p) return false;
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isExportSpecifier(p)) return false;
  if (ts.isBindingElement(p)) return false; // `{ sendSms }` / `{ a: sendSms }` in a destructuring declaration
  if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p)) && p.name === id) return false;
  if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p)) && p.name === id) return false;
  if (ts.isTypeQueryNode(p) || ts.isTypeReferenceNode(p) || ts.isQualifiedName(p)) return false;
  let expr: ts.Node = id;
  if (ts.isPropertyAccessExpression(p)) {
    if (p.name !== id) return true; // `sendSms.call(...)` / `.apply` / `.bind`: an indirect call the matcher cannot see
    expr = p;
  }
  const outer = climbWrappers(expr);
  if (outer.parent && ts.isCallExpression(outer.parent) && outer.parent.expression === outer) return false; // the call matcher owns it
  return true;
}

function analyzeOrchestratorSource(text: string, fileName = "snippet.ts"): Analysis {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const findings: Finding[] = [];
  let wrappedSites = 0;
  let smsEffectCalls = 0;
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const snippet = (n: ts.Node) => n.getText(sf).split("\n")[0].slice(0, 120);
  const aliases = new Map<string, string>();

  const checkModule = (specifier: string, bindings: ImportedBinding[] | null, at: ts.Node) => {
    const rule = MODULES[specifier];
    if (!rule) {
      findings.push({ line: lineOf(at), text: snippet(at), reason: `unclassified module "${specifier}": classify it in MODULES in this test` });
      return;
    }
    if (bindings) {
      for (const b of bindings) {
        if (MUTATING_CALLEES.has(b.imported) && b.local !== b.imported) aliases.set(b.local, b.imported);
      }
    }
    if (rule.cls === "pure") return;
    if (bindings === null) {
      findings.push({ line: lineOf(at), text: snippet(at), reason: `non-pure module "${specifier}" used in a shape this canary cannot read; destructure its bindings` });
      return;
    }
    const reads = new Set(rule.reads ?? []);
    for (const b of bindings) {
      if (!MUTATING_CALLEES.has(b.imported) && !reads.has(b.imported)) {
        findings.push({
          line: lineOf(at),
          text: snippet(at),
          reason: `"${b.imported}" from ${rule.cls} module "${specifier}" is neither a known mutating function nor on its read list`,
        });
      }
    }
  };

  // Pass 1: modules, bindings and aliases (so a use before its import line still resolves).
  const collect = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      checkModule(node.moduleSpecifier.text, staticImportBindings(node), node);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const spec = node.arguments[0];
      if (spec && ts.isStringLiteralLike(spec)) checkModule(spec.text, dynamicImportBindings(node), node);
      else findings.push({ line: lineOf(node), text: snippet(node), reason: "dynamic import with a non-literal specifier" });
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);

  // Pass 2: effect calls, escaping references, and what each smsEffect wraps.
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (isSmsEffectCall(node)) {
        smsEffectCalls++;
        const run = node.arguments[1];
        if (run && !containsEffect(run, aliases)) {
          findings.push({ line: lineOf(node), text: snippet(node), reason: "smsEffect wraps no effect: a wrapped read is SKIPPED in a replay and changes the decision" });
        }
      }
      const reason = effectReason(node, aliases);
      if (reason) {
        const w = wrappedBySmsEffect(node);
        if (w.ok) wrappedSites++;
        else findings.push({ line: lineOf(node), text: snippet(node), reason: `${reason}, ${w.why}` });
      }
    }
    const lifted = liftedEffectReason(node, aliases);
    if (lifted && !wrappedBySmsEffect(node).ok) {
      findings.push({ line: lineOf(node), text: snippet(ts.isIdentifier(node) ? (node.parent ?? node) : node), reason: lifted });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { findings, wrappedSites, smsEffectCalls };
}

// A planted snippet gets the orchestrator's real import block so the module
// classification is exercised the same way; only the body differs.
const HEADER = `import { getDbTyped } from "../db";
import { smsOrchestrations, customers, bookings } from "../../drizzle/schema";
import { sendSms } from "../sms";
import { smsEffect } from "./smsReplayScope";
import { eq, sql } from "drizzle-orm";
`;
const plant = (body: string, extraImports = "") =>
  analyzeOrchestratorSource(`${HEADER}${extraImports}\nasync function f(db: any, h: any, p: string, b: string) {\n${body}\n}\n`);

describe("smsOrchestrator.ts: every effect is behind smsEffect", () => {
  const realText = readFileSync(ORCHESTRATOR, "utf8");
  const real = analyzeOrchestratorSource(realText, ORCHESTRATOR);

  it("has zero unwrapped writes, eager wraps, wrapped reads, escaping references or unclassified modules", () => {
    expect(real.findings).toEqual([]);
  });

  it("the matcher actually found the wrapped sites (a zero would prove nothing)", () => {
    // 28 wrapped sites on 2026-10-09. Each smsEffect wraps exactly one effect,
    // so the matcher's two independent counts must agree.
    expect(real.wrappedSites).toBeGreaterThanOrEqual(20);
    expect(real.wrappedSites).toBe(real.smsEffectCalls);
  });

  it("positive control on the REAL file: one appended unwrapped write is exactly one finding", () => {
    const planted = `${realText}\nasync function __plantedLeak(d: any) {\n  await d!.insert(smsOrchestrations).values({});\n}\n`;
    const r = analyzeOrchestratorSource(planted, ORCHESTRATOR);
    expect(r.findings.map((f) => f.reason)).toEqual([expect.stringMatching(/\.insert\( writes \(any receiver\), not inside smsEffect/)]);
  });
});

describe("positive controls: the same matcher flags each broken shape", () => {
  it("an unwrapped db.insert", () => {
    const r = plant(`const [row] = await db.insert(smsOrchestrations).values({}).$returningId();`);
    expect(r.findings.map((f) => f.reason)).toEqual([expect.stringMatching(/\.insert\( writes \(any receiver\), not inside smsEffect/)]);
  });

  it("an unwrapped db.update and db.delete", () => {
    const r = plant(`await db.update(customers).set({ smsOptOut: 1 }); await db.delete(bookings);`);
    expect(r.findings).toHaveLength(2);
  });

  it("an eager wrap (the write runs before smsEffect is called)", () => {
    const r = plant(`await smsEffect("x", db.update(customers).set({}), undefined);`);
    expect(r.findings.some((f) => /not a thunk/.test(f.reason))).toBe(true);
  });

  it("an effect placed in the onReplay fallback (it would run DURING a replay)", () => {
    const r = plant(`await smsEffect("x", () => db.insert(customers).values({}), () => sendSms(p, b));`);
    expect(r.findings.some((f) => /sendSms\(\), inside smsEffect but not in its run argument/.test(f.reason))).toBe(true);
  });

  it("an unwrapped write via db.execute, while a SELECT via db.execute is allowed", () => {
    const write = plant("await db.execute(sql`UPDATE bookings SET status = 'cancelled'`);");
    expect(write.findings.map((f) => f.reason)).toEqual([expect.stringMatching(/non-SELECT/)]);
    const read = plant("await db.execute(sql`SELECT id FROM bookings LIMIT 1`);");
    expect(read.findings).toEqual([]);
    // A WITH read stays allowed; only a write keyword makes it a write.
    const withRead = plant("await db.execute(sql`WITH t AS (SELECT id FROM bookings) SELECT id FROM t LIMIT 1`);");
    expect(withRead.findings).toEqual([]);
    const opaque = plant("const q = sql`x`; await db.execute(q);");
    expect(opaque.findings.map((f) => f.reason)).toEqual([expect.stringMatching(/unclassifiable/)]);
  });

  it("an unwrapped optional call and an unwrapped fire-and-forget .then chain", () => {
    const r = plant(`
      const { markPhoneOptedOut } = await import("../sms");
      markPhoneOptedOut?.(p);
      import("./complianceLog").then(({ logSmsOptOut }) => logSmsOptOut?.({ phone: p }));
    `);
    expect(r.findings.map((f) => f.reason)).toEqual([
      expect.stringMatching(/markPhoneOptedOut\(\), not inside smsEffect/),
      expect.stringMatching(/logSmsOptOut\(\), not inside smsEffect/),
    ]);
  });

  it("an unwrapped sendSms", () => {
    const r = plant(`const res = await sendSms(p, b, { via: "shop" });`);
    expect(r.findings).toHaveLength(1);
  });

  it("a wrapped read (it would be skipped in a replay and change the decision)", () => {
    const r = plant(`const rows = await smsEffect("x", () => db.select().from(customers), []);`);
    expect(r.findings.map((f) => f.reason)).toEqual([expect.stringMatching(/wraps no effect/)]);
  });

  it("a new, unclassified module", () => {
    const r = plant(`const { writeSomething } = await import("./someNewWriter"); await smsEffect("x", () => writeSomething(), undefined);`);
    expect(r.findings.some((f) => /unclassified module "\.\/someNewWriter"/.test(f.reason))).toBe(true);
  });

  it("a new binding from an effect module that is not a known mutating function", () => {
    const r = plant(`const { persistSomethingNew } = await import("../sms"); await persistSomethingNew(p);`);
    expect(r.findings.some((f) => /"persistSomethingNew" from effect module "\.\.\/sms"/.test(f.reason))).toBe(true);
  });

  // The 2026-10-09 review planted these against the first version of this
  // canary; every one passed as clean. Each must now be flagged.
  const REVIEW_HOLES: Array<{ label: string; body: string; imports?: string; expect: RegExp[] }> = [
    {
      label: "a writer exported by ../db (classified read)",
      imports: `import { updateBookingStatus } from "../db";\n`,
      body: `await updateBookingStatus(77, "cancelled");`,
      expect: [/"updateBookingStatus" from read module "\.\.\/db"/],
    },
    {
      label: "setFlag from ./featureFlags (classified read)",
      body: `const { setFlag } = await import("./featureFlags"); await setFlag("sms_x", true);`,
      expect: [/"setFlag" from read module "\.\/featureFlags"/],
    },
    {
      label: "an aliased dynamic import of a mutating function",
      body: `const { markPhoneOptedIn: optIn } = await import("../sms"); await optIn(p);`,
      expect: [/markPhoneOptedIn\(\) via alias optIn, not inside smsEffect/],
    },
    {
      label: "an aliased static import of sendSms",
      imports: `import { sendSms as send } from "../sms";\n`,
      body: `await send(p, b);`,
      expect: [/sendSms\(\) via alias send, not inside smsEffect/],
    },
    {
      label: "a non-null handle db!.insert",
      body: `await db!.insert(smsOrchestrations).values({});`,
      expect: [/\.insert\( writes/],
    },
    {
      label: "an inline handle (await getDbTyped())!.update",
      body: `await (await getDbTyped())!.update(customers).set({});`,
      expect: [/\.update\( writes/],
    },
    {
      label: "a renamed handle (const conn = db; and the repo's common `d`)",
      body: `const conn = db; await conn.update(bookings).set({}); const d = await getDbTyped(); if (d) await d.insert(customers).values({});`,
      expect: [/\.update\( writes/, /\.insert\( writes/],
    },
    {
      label: "a nested handle h.db.update",
      body: `await h.db.update(customers).set({});`,
      expect: [/\.update\( writes/],
    },
    {
      label: "element access db[\"insert\"]",
      body: `await db["insert"](smsOrchestrations).values({});`,
      expect: [/\.insert\( writes/],
    },
    {
      label: "a computed method name db[m]",
      body: `const m = "insert"; await db[m](smsOrchestrations).values({});`,
      expect: [/computed method call/],
    },
    {
      label: "a transaction callback",
      body: `await db.transaction(async (t: any) => { await t.update(customers).set({}); });`,
      expect: [/\.transaction\( writes/, /\.update\( writes/],
    },
    {
      label: "a mutating function rebound to a local",
      body: `const sendLater = sendSms; await sendLater(p, b);`,
      expect: [/mutating function sendSms used as a value/],
    },
    {
      label: "a mutating function smuggled through an object or a comma call",
      body: `const api = { sendSms }; await api.go(p); await (0, sendSms)(p, b);`,
      expect: [/sendSms used as a value/, /sendSms used as a value/],
    },
    {
      label: "a namespace import of a non-pure module",
      imports: `import * as smsMod from "../sms";\n`,
      body: `await smsMod.sendSms(p, b);`,
      expect: [/non-pure module "\.\.\/sms" used in a shape this canary cannot read/, /sendSms\(\), not inside smsEffect/],
    },
    {
      label: "a whole-module dynamic import of a non-pure module",
      body: `const smsMod = await import("../sms"); await smsMod.markPhoneOptedIn(p);`,
      expect: [/non-pure module "\.\.\/sms" used in a shape/, /markPhoneOptedIn\(\), not inside smsEffect/],
    },
    {
      label: "a direct network call",
      body: `await fetch("https://example.test/hook", { method: "POST" });`,
      expect: [/fetch\(\), not inside smsEffect/],
    },
    // Found by the fix's own self-review: same family, different spelling.
    {
      label: "an indirect .call / .bind on a mutating function",
      body: `await sendSms.call(null, p, b); const later = sendSms.bind(null);`,
      expect: [/sendSms used as a value/, /sendSms used as a value/],
    },
    {
      // Two findings since round 2: the binding itself (so `f(insert)` cannot
      // smuggle it on) and the bare call.
      label: "a DB method destructured off the handle",
      body: `const { insert } = db; await insert(smsOrchestrations).values({});`,
      expect: [/DB method insert destructured off a handle/, /insert\( writes/],
    },
    {
      label: "a DB method lifted off the handle as a value",
      body: `const ins = db.update; await ins(customers).set({});`,
      expect: [/DB method \.update taken as a value/],
    },
    // Round 2 of the 2026-10-09 review: these three passed as clean.
    {
      label: "a WITH ... UPDATE write via db.execute (starts like a read)",
      body: "await db.execute(sql`WITH t AS (SELECT id FROM bookings) UPDATE bookings SET status = 'x' WHERE id IN (SELECT id FROM t)`);",
      expect: [/\.execute\( runs SQL containing the write keyword UPDATE/],
    },
    {
      label: "a WITH ... DELETE write via db.query, lower case",
      body: "await db.query(`with t as (select id from bookings) delete from bookings where id in (select id from t)`);",
      expect: [/\.query\( runs SQL containing the write keyword DELETE/],
    },
    {
      label: "a SELECT followed by a second, writing statement",
      body: "await db.execute(sql`SELECT 1; INSERT INTO customers (phone) VALUES ('x')`);",
      expect: [/write keyword INSERT/],
    },
    {
      label: "a DB method destructured under a new name",
      body: `const { insert: ins } = db; await ins(smsOrchestrations).values({});`,
      expect: [/DB method insert destructured off a handle/],
    },
    {
      label: "a DB method destructured off a nested handle, string-keyed",
      body: `const { "update": up } = h.db; await up(customers).set({});`,
      expect: [/DB method update destructured off a handle/],
    },
    {
      label: "a DB method taken by assignment destructuring",
      body: `let up: any; ({ update: up } = db); await up(customers).set({});`,
      expect: [/DB method update destructured off a handle/],
    },
    {
      label: "a computed destructuring off the handle",
      body: `const m = "insert"; const { [m]: ins } = db; await ins(smsOrchestrations).values({});`,
      expect: [/computed destructuring/],
    },
    {
      label: "a mutating function destructured off a non-module object",
      body: `const deps = { a: 1 } as any; const { sendSms: s } = deps; await s(p, b);`,
      expect: [/mutating function sendSms destructured off a non-module object/],
    },
    {
      label: "a DB method lifted by element access",
      body: `const ins = db["update"]; await ins(customers).set({});`,
      expect: [/DB method \["update"\] taken as a value/],
    },
    {
      label: "a mutating function lifted by element access",
      body: `const holder = { a: 1 } as any; const s = holder["sendSms"]; await s(p, b);`,
      expect: [/mutating function \["sendSms"\] taken as a value/],
    },
  ];

  it.each(REVIEW_HOLES)("flags $label", ({ body, imports, expect: patterns }) => {
    const reasons = plant(body, imports).findings.map((f) => f.reason);
    expect(reasons).toHaveLength(patterns.length);
    patterns.forEach((re, i) => expect(reasons[i]).toMatch(re));
  });

  it("control: the correctly wrapped versions of the same shapes produce no findings", () => {
    const r = plant(
      `
      const [row] = await smsEffect("i", () => db.insert(smsOrchestrations).values({}).$returningId(), []);
      await smsEffect("u", () => db.update(customers).set({ smsOptOut: 1 }), undefined);
      const res = await smsEffect("s", () => sendSms(p, b), () => ({ success: true }));
      const { markPhoneOptedOut } = await import("../sms");
      smsEffect("m", () => markPhoneOptedOut?.(p), undefined);
      smsEffect("c", () => import("./complianceLog").then(({ logSmsOptOut }) => logSmsOptOut?.({ phone: p })), undefined);
      await smsEffect("e", () => db.execute(sql\`UPDATE bookings SET status = 'x'\`), undefined);
      const { markPhoneOptedIn: optIn } = await import("../sms");
      await smsEffect("a", () => optIn(p), undefined);
      await smsEffect("n", () => db!.insert(smsOrchestrations).values({}), []);
      await smsEffect("h", () => h.db.update(customers).set({}), undefined);
      await smsEffect("x", () => db["insert"](smsOrchestrations).values({}), []);
      await smsEffect("v", () => { const later = sendSms; return later(p, b); }, undefined);
      await smsEffect("w", () => { const ins = db.update; return ins(customers); }, undefined);
      await smsEffect("q", () => db.execute(sql\`WITH t AS (SELECT id FROM bookings) UPDATE bookings SET status = 'x'\`), undefined);
      await smsEffect("y", () => { const { insert: ins } = db; return ins(smsOrchestrations); }, []);
      await smsEffect("z", () => { const ins = db["update"]; return ins(customers); }, undefined);
    `,
      `import { sendSms as send } from "../sms";\n`,
    );
    expect(r.findings).toEqual([]);
    // 11 effect CALLS; the `later`, `ins` (x3) thunks hold an effect only as a
    // lifted value, which satisfies "wraps an effect" without counting as a call site.
    expect(r.wrappedSites).toBe(11);
  });
});
