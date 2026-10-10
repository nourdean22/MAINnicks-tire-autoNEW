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
 *   · Scan set = the owner-private prefixes below + every /api entry of
 *     PUBLIC_PREFIXES / PUBLIC_EXACT (lib/security/route-policy.ts). Those
 *     bypass the session middleware, so the route's own auth is the only wall.
 *   · A signal must be CODE: an identifier (requireSession, cronHandler, ...)
 *     or an `auth: "owner" | "cron" | "sync" | "evidence"` option. A comment or
 *     string that names requireSession no longer counts.
 *   · `export { x as GET }`, `export const { GET } = x`, re-exports and
 *     `export *` are seen. A handler that cannot be resolved in-file fails closed.
 *   · A same-file declaration the handler names is followed (`GET =
 *     withTracing(handler)`, a guard helper it calls); a helper it does not
 *     name is not part of its body, and neither is a sibling PATCH.
 *   · `// public: <why>` exempts only the export statement it leads (as its own
 *     line comment, or as a ` * // public:` line in the JSDoc directly above).
 *   · GET and HEAD are both read handlers.
 * Canary: tests/repo/check-get-auth-canary.test.ts.
 *
 * Usage: `pnpm check:get-auth` scans the tracked tree; extra args scan only
 * those files (the canary's end-to-end probe).
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { PUBLIC_EXACT, PUBLIC_PREFIXES } from "../lib/security/route-policy";

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
];

/** Every scanned directory: the list above plus each /api path that BYPASSES the session gate. */
export function scanPrefixes(): string[] {
  const bypass = [...PUBLIC_PREFIXES, ...PUBLIC_EXACT]
    .filter((p) => p.startsWith("/api/"))
    .map((p) => `app${p.replace(/\/$/, "")}`);
  return [...new Set([...OWNER_PREFIXES, ...bypass])];
}

export function listRoutes(): string[] {
  const prefixes = scanPrefixes();
  return execFileSync("git", ["ls-files", "--", "app/api"], { encoding: "utf8" })
    .split("\n")
    .filter((f) => /\/route\.[jt]s$/.test(f) && prefixes.some((p) => f.startsWith(`${p}/`)));
}

const READ_METHODS = new Set(["GET", "HEAD"]);
// 2026-07-28 cron-truth audit (dim 6): `validateToken` is the chrome-extension
// bearer gate (app/api/brain/by-url). `await auth()` is deliberately NOT a
// signal: routes use requireSession so one grep-able idiom guards them all.
// cron/sync/evidenceHandler are apiHandler pre-set to that auth (lib/utils/http.ts).
// An inline Bearer/x-sync-key check counts by its constant-time COMPARE, not by
// naming the secret: app/api/version reads `Boolean(env.CRON_SECRET)` and is open.
const AUTH_IDENT =
  /^(?:requireSession|requireCronAuth|requireSyncAuth|requireEvidenceAuth|validateToken|cronHandler|syncHandler|evidenceHandler|safeEqual|timingSafeEqual)$/;
const AUTH_MODES = new Set(["owner", "cron", "sync", "evidence"]);
// Must START a comment line, so prose that quotes the marker does not exempt.
const PUBLIC_MARKER = /^\s*(?:\*\s*)?\/\/\s*public:\s*\S/m;

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/** The exported read handlers in `src` that carry no auth signal (method names, or "export *"). */
export function checkSource(src: string): string[] {
  const sf = ts.createSourceFile("route.ts", src, ts.ScriptTarget.Latest, true);

  const decls = new Map<string, ts.Node>();
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name) decls.set(s.name.text, s);
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) decls.set(d.name.text, d);
      }
    }
  }

  // Walks CODE only (forEachChild never visits comments or JSDoc). An identifier
  // naming a same-file top-level declaration is followed into it, so aliases,
  // wrappers and guard helpers the handler actually names count; `x.name` does not.
  const isAuthed = (node: ts.Node | undefined, seen = new Set<ts.Node>()): boolean => {
    if (!node || seen.has(node)) return false;
    seen.add(node);
    let hit = false;
    const visit = (n: ts.Node): void => {
      if (hit) return;
      if (ts.isIdentifier(n)) {
        const member = ts.isPropertyAccessExpression(n.parent) && n.parent.name === n;
        hit = AUTH_IDENT.test(n.text) || (!member && isAuthed(decls.get(n.text), seen));
      } else if (
        ts.isPropertyAssignment(n) &&
        ts.isIdentifier(n.name) &&
        n.name.text === "auth" &&
        ts.isStringLiteralLike(n.initializer) &&
        AUTH_MODES.has(n.initializer.text)
      ) {
        hit = true;
      } else ts.forEachChild(n, visit);
    };
    visit(node);
    return hit;
  };

  const unauthed: string[] = [];
  for (const s of sf.statements) {
    const isPublic = (ts.getLeadingCommentRanges(src, s.pos) ?? []).some((r) =>
      PUBLIC_MARKER.test(src.slice(r.pos, r.end)),
    );
    const check = (method: string, node: ts.Node | undefined): void => {
      if (READ_METHODS.has(method) && !isPublic && !isAuthed(node)) unauthed.push(method);
    };

    if (ts.isFunctionDeclaration(s) && s.name && isExported(s)) {
      check(s.name.text, s);
    } else if (ts.isVariableStatement(s) && isExported(s)) {
      for (const d of s.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) check(d.name.text, d);
        else if (ts.isObjectBindingPattern(d.name)) {
          for (const el of d.name.elements) if (ts.isIdentifier(el.name)) check(el.name.text, d);
        }
      }
    } else if (ts.isExportDeclaration(s) && !s.isTypeOnly) {
      if (!s.exportClause) {
        if (!isPublic) unauthed.push("export *");
      } else if (ts.isNamedExports(s.exportClause)) {
        for (const spec of s.exportClause.elements) {
          // A re-export from another module cannot be verified here: undefined fails closed.
          check(spec.name.text, s.moduleSpecifier ? undefined : decls.get((spec.propertyName ?? spec.name).text));
        }
      }
    }
  }
  return unauthed;
}

function main(): void {
  const args = process.argv.slice(2);
  const files = args.length > 0 ? args : listRoutes();
  if (files.length === 0) {
    console.error("✗ scanned 0 route files: run from apps/statenour (git ls-files app/api found nothing).");
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
    const methods = checkSource(src);
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
    'Fix: `apiHandler(..., { auth: "owner" })`, or `await requireSession(req)` inside the handler,',
  );
  console.error(
    "or `// public: <why>` on the line directly above the export if it is intentionally open.",
  );
  console.error("Comments and strings that name an auth helper do not count.");
  process.exit(1);
}

if (process.argv[1]?.includes("check-sensitive-get-auth")) main();
