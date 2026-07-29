/**
 * Mutation-receipt census · WP-12 (2026-07-29).
 *
 * The dossier asked for an inventory of every mutation entry point and
 * whether each is auth-gated and audited. A hand-written table would be
 * stale within a week — this repo has 195 tRPC mutations and 157 route
 * files with mutating verbs. So the census is EXECUTABLE: it re-derives
 * itself on every run and can fail a gate.
 *
 * Two axes are determined MECHANICALLY, and only those are claimed:
 *
 *   1. AUTH — is the mutation behind an owner/cron/sync boundary?
 *      · tRPC: the procedure builder used at the call site
 *        (`operatorProcedure` = owner-gated; `publicProcedure` = open).
 *      · Routes: an auth signal inside the HANDLER BODY — scoped per
 *        handler, never a whole-file grep. That distinction is not
 *        pedantry: check-sensitive-get-auth.ts exists because a
 *        file-level grep passed on a guarded PATCH while the GET beside
 *        it shipped unauthed.
 *
 *   2. AUDIT — does the module write a durable trail (ActionReceipt,
 *      AuditEvent, EntityAudit, TaskEvent, brain-bus publish)? File
 *      scope, stated as such: it proves the writer is WIRED in the
 *      module, not that every branch reaches it.
 *
 * NOT claimed, deliberately: idempotency, undo/compensating actions,
 * and trace propagation. Those cannot be determined by static scan
 * without lying, so the report names them as human-review axes rather
 * than inventing a verdict. (The dossier's 7-axis table assumed a
 * hand audit; this is the honest mechanical subset.)
 *
 * Run:  pnpm check:mutations           (advisory — prints the census)
 *       pnpm check:mutations --strict  (exit 1 on any ungoverned gap)
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const STRICT = process.argv.includes("--strict");

/**
 * Auth signals — derived from the ACTUAL idioms in this repo, not a
 * guessed list. The first draft of this scanner used the GET-gate's
 * narrow set and reported 31 gaps, most of which were false: Stripe
 * verifies an HMAC via timingSafeEqual, VAPI uses verifyVapiSecret,
 * the runner uses assertRunnerRequest, sync routes use a syncHandler
 * wrapper. A gate that cries wolf gets ignored — so each family below
 * was confirmed against a real file before being added.
 *
 * `apiHandler` is deliberately ABSENT: it wraps errors, not auth.
 */
const AUTH_SIGNAL = new RegExp(
  [
    // explicit guards
    "require(Session|CronAuth|SyncAuth|BridgeAuth)",
    // wrapper-style handlers that carry their own guard
    "(cron|sync|bridge)Handler",
    // assert-style guards (runner, bridge, mcp)
    "assert(Bridge|Runner|Operator)\\w*",
    // signature/secret verifiers (stripe, vapi, make, webhooks)
    "verify\\w*(Signature|Secret|Webhook)",
    "timingSafeEqual",
    // header-secret + bearer-token comparisons (apple-health, brain dump)
    "EXPECTED_SECRET|SYNC_KEY|x-(sync|bridge)-key|[Bb]earer",
    // raw next-auth session check (brain/suggestion-loop idiom)
    "await auth\\(\\)|session\\?\\.user\\?\\.email",
    // declarative markers
    'auth:\\s*"(owner|cron|sync|bridge)"',
  ].join("|"),
);

/** Durable-trail writers. Presence proves the writer is wired here. */
const AUDIT_SIGNAL =
  /(auditEvent\.create|entityAudit\.create|emitTaskEvent|emitGoalEvent|toReceipt|recordShown|publishDurable|brainBus|logAutonomousEvent)/;

/** Opt-out marker for a reviewed, intentional exception. Must carry a
 *  reason on the same line so the census records WHY. */
const EXCEPTION_MARKER = /\/\/\s*mutation-census:\s*exception\s*—?\s*(.+)/i;

/**
 * Four verdicts, because two would lie.
 *
 * A static scan cannot see auth performed inside a helper the handler
 * calls, or in module scope above it. Collapsing that into `gap` makes
 * the gate cry wolf; collapsing it into `covered` hides real holes —
 * and a real hole is EXACTLY what lived there: POST
 * /api/system/mission-surface-stats wrote to BrainMemory unauthed while
 * the GET beside it required a session, so file-scope auth was present
 * but the handler had none. `review` keeps that case loud without
 * failing the gate on the many benign ones.
 */
type Verdict = "covered" | "review" | "gap" | "exception";

interface Entry {
  kind: "trpc" | "route";
  location: string;
  name: string;
  authed: boolean;
  audited: boolean;
  verdict: Verdict;
  note?: string;
}

function git(cmd: string): string[] {
  return execSync(cmd, { encoding: "utf8" }).split("\n").filter(Boolean);
}

// ── tRPC mutations ──────────────────────────────────────────────────
// Procedure builders that carry an auth boundary. `publicProcedure` is
// deliberately absent — that's the whole point of the scan.
const GATED_PROCEDURES = /(operatorProcedure|ownerProcedure|protectedProcedure|adminProcedure)/;

export function scanTrpcSource(file: string, src: string): Entry[] {
  const lines = src.split("\n");
  const out: Entry[] = [];
  for (let i = 0; i < lines.length; i++) {
    // A procedure declaration: `name: someProcedure` … `.mutation(`
    const decl = lines[i].match(/^\s{2,}(\w+):\s*(\w+Procedure)\b/);
    if (!decl) continue;
    const [, name, builder] = decl;
    // The chain may span lines; look ahead a bounded window for .mutation(
    const window = lines.slice(i, i + 25).join("\n");
    if (!/\.mutation\(/.test(window)) continue;
    const exception = window.match(EXCEPTION_MARKER);
    const authed = GATED_PROCEDURES.test(builder);
    const audited = AUDIT_SIGNAL.test(window);
    out.push({
      kind: "trpc",
      location: `${file}:${i + 1}`,
      name,
      authed,
      audited,
      verdict: exception ? "exception" : authed ? "covered" : "gap",
      note: exception?.[1]?.trim(),
    });
  }
  return out;
}

// ── Route handlers ──────────────────────────────────────────────────
const MUTATING_VERBS = ["POST", "PUT", "PATCH", "DELETE"] as const;

/** Scope each handler's body the way the GET-auth gate does: from its
 *  declaration to the next top-level export. A whole-file grep is the
 *  documented way this class of check gives a false pass. */
export function scanRouteSource(file: string, src: string): Entry[] {
  const lines = src.split("\n");
  const out: Entry[] = [];
  for (const verb of MUTATING_VERBS) {
    const declRe = new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${verb}\\b`);
    const start = lines.findIndex((l) => declRe.test(l));
    if (start === -1) continue;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^export\s+(?:async\s+)?(?:function|const)\s+/.test(lines[i])) {
        end = i;
        break;
      }
    }
    const body = lines.slice(start, end).join("\n");
    // The exception marker conventionally sits in the comment block
    // directly ABOVE the handler, so look back a few lines too.
    const preamble = lines.slice(Math.max(0, start - 6), start).join("\n");
    const exception = body.match(EXCEPTION_MARKER) ?? preamble.match(EXCEPTION_MARKER);
    const authed = AUTH_SIGNAL.test(body);
    const fileAuthed = AUTH_SIGNAL.test(src);
    const audited = AUDIT_SIGNAL.test(src);
    out.push({
      kind: "route",
      location: `${file}:${start + 1}`,
      name: verb,
      authed,
      audited,
      verdict: exception
        ? "exception"
        : authed
          ? "covered"
          : // File authenticates somewhere but not in THIS handler's body:
            // could be a helper call (benign) or the mission-surface-stats
            // class (real). A human decides; the gate stays quiet.
            fileAuthed
            ? "review"
            : "gap",
      note: exception?.[1]?.trim() ?? (!authed && fileAuthed ? "auth present in file, not in handler body" : undefined),
    });
  }
  return out;
}

function main(): void {
  const trpcFiles = git('git ls-files "lib/trpc/routers/**/*.ts"');
  const routeFiles = git('git ls-files "app/api/**/route.ts"');

  const entries: Entry[] = [];
  for (const f of trpcFiles) entries.push(...scanTrpcSource(f, readFileSync(f, "utf8")));
  for (const f of routeFiles) entries.push(...scanRouteSource(f, readFileSync(f, "utf8")));

  const gaps = entries.filter((e) => e.verdict === "gap");
  const review = entries.filter((e) => e.verdict === "review");
  const exceptions = entries.filter((e) => e.verdict === "exception");
  const covered = entries.filter((e) => e.verdict === "covered");
  const unaudited = covered.filter((e) => !e.audited);

  console.log("\nmutation-receipt census · WP-12");
  console.log(`  mode: ${STRICT ? "STRICT (gaps fail)" : "advisory"}`);
  console.log(
    `\nscanned ${entries.length} mutation entry points ` +
      `(${entries.filter((e) => e.kind === "trpc").length} tRPC · ${entries.filter((e) => e.kind === "route").length} route handlers)`,
  );
  console.log(`  covered (auth in the handler body): ${covered.length}`);
  console.log(`  documented exceptions: ${exceptions.length}`);
  console.log(`  REVIEW (file authenticates, this handler doesn't — human call): ${review.length}`);
  console.log(`  GAPS (no auth signal anywhere in the file): ${gaps.length}`);
  console.log(
    `  informational · no audit writer detected in-module: ${unaudited.length} ` +
      "(file-scope signal; many mutations audit downstream — NOT a defect count)",
  );

  if (review.length > 0) {
    console.log("\n── review (verify the handler is actually guarded) ──");
    for (const r of review) console.log(`  ${r.kind} ${r.name} · ${r.location}`);
  }

  if (gaps.length > 0) {
    console.log("\n── gaps ──");
    for (const g of gaps.slice(0, 40)) {
      console.log(`  ${g.kind} ${g.name} · ${g.location}`);
    }
    if (gaps.length > 40) console.log(`  …and ${gaps.length - 40} more`);
    console.log(
      "\n  Fix by adding an auth boundary, or mark a reviewed exception:\n" +
        "    // mutation-census: exception — <why this needs no auth>",
    );
  }

  console.log(
    "\nNOT machine-checked (human-review axes): idempotency · undo/compensating\n" +
      "action · trace propagation. A static scan cannot judge these honestly.\n",
  );

  if (STRICT && gaps.length > 0) {
    console.error(`✖ ${gaps.length} ungoverned mutation entry point(s)`);
    process.exit(1);
  }
  console.log("✓ census complete");
  process.exit(0);
}

// Only run when invoked directly — the scanners are imported by tests.
if (process.argv[1]?.includes("audit-mutation-receipts")) main();
