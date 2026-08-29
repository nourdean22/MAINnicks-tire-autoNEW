/**
 * Fail-closed guard for the DESTRUCTIVE demo seed (`prisma/seed.ts`).
 *
 * WHY THIS EXISTS. `prisma db seed` / `pnpm db:seed` runs seed.ts, whose main()
 * calls deleteMany() on taskEvent, task, personalDailyLog and mission before
 * recreating hardcoded demo rows ("Nick's Tire Revenue Recovery", "Call dormant
 * VIP customers"). Against prod Neon that deletes the operator's REAL tasks,
 * missions and daily logs — the same class as the 870-row deletion recorded in
 * the prod-db-guard skill.
 *
 * The exposure is not hypothetical: `scripts/worktree-setup.ps1` copies the prod
 * `DATABASE_URL` into EVERY new worktree, and there is no local database in a
 * fresh one. So the DEFAULT target of an unguarded `pnpm db:seed` is production.
 *
 * THE RULE — default-deny, and the deny is on the TARGET, not on intent:
 *   · local host (localhost / 127.0.0.1 / ::1 / host.docker.internal) → allowed;
 *     that is the seed's intended use and wiping a local dev DB is cheap.
 *   · any remote host → REFUSED unless ALLOW_DESTRUCTIVE_SEED=1 is set for that
 *     one invocation.
 *   · no DATABASE_URL, or one we cannot parse → REFUSED. If we cannot name the
 *     target we cannot claim it is safe; unknown is not local.
 *
 * Deliberately NO hardcoded prod hostname. An allow/deny list keyed on today's
 * Neon endpoint is a cache with no invalidation — the day the endpoint changes,
 * a host-matching guard silently stops matching and reports safe. Default-deny
 * on "not local" has nothing to drift and covers every future endpoint.
 *
 * Pure and exported so the canaries drive real behaviour with fixtures instead
 * of asserting on a reading of the regex (guard-red-team).
 */

/** Hosts where wiping the database is the seed's intended, cheap behaviour. */
export const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "host.docker.internal",
]);

/** The one env var that arms the destructive seed against a remote database. */
export const ALLOW_ENV = "ALLOW_DESTRUCTIVE_SEED";

/**
 * Extract the bare hostname from a Postgres connection string, without the
 * credentials. Returns null when there is nothing parseable — callers must
 * treat null as "unknown target", never as "no target".
 *
 * Hand-rolled rather than `new URL()`: a password containing `/`, `#` or `?`
 * (legal, and common in generated Neon passwords) makes the WHATWG parser
 * throw or mis-assign the host, and a guard that throws on a weird password is
 * a guard that fails open through its own catch block.
 */
export function hostFromDatabaseUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^["']|["']$/g, "");
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return null;

  const afterScheme = trimmed.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
  // lastIndexOf: a password may itself contain '@'.
  const at = afterScheme.lastIndexOf("@");
  const hostPart = at >= 0 ? afterScheme.slice(at + 1) : afterScheme;
  const host = hostPart.split(/[/?#]/)[0];
  if (!host) return null;

  // Strip a trailing :port. A bracketed IPv6 literal is full of colons, so the
  // port must be matched OUTSIDE the brackets — an early draft skipped bracketed
  // hosts entirely, which left "[::1]:5432" unmatchable against LOCAL_HOSTS and
  // refused a legitimate local IPv6 target (caught by this file's own canary).
  const withoutPort = host.startsWith("[")
    ? host.replace(/^(\[[^\]]*\]):\d+$/, "$1")
    : host.replace(/:\d+$/, "");
  return withoutPort.toLowerCase() || null;
}

/** True only for hosts where the destructive seed runs unguarded. */
export function isLocalHost(host: string | null): boolean {
  if (!host) return false;
  return LOCAL_HOSTS.has(host);
}

export interface SeedGuardInput {
  databaseUrl: string | undefined | null;
  /** Raw value of ALLOW_DESTRUCTIVE_SEED; only the exact string "1" arms it. */
  allowFlag: string | undefined | null;
}

/**
 * The judge: null when the destructive seed may proceed, otherwise the
 * operator-facing reason it must not. Mirrors the *FetchFailure() shape used
 * across the intelligence connectors — a refusal is a value, not an exception,
 * so the canary asserts the reason text rather than catching a throw.
 */
export function seedRefusalReason(input: SeedGuardInput): string | null {
  const host = hostFromDatabaseUrl(input.databaseUrl);

  if (!host) {
    return (
      "DATABASE_URL is unset or unparseable, so the target database cannot be named. " +
      "This seed DELETES all tasks, task events, personal daily logs and missions — " +
      "it will not run against an unidentified target."
    );
  }

  if (isLocalHost(host)) return null;

  if (input.allowFlag !== "1") {
    return (
      `refusing to run the DESTRUCTIVE demo seed against remote host "${host}".\n` +
      "  It DELETES every row in: task_events, tasks, personal_daily_logs, missions —\n" +
      "  then recreates hardcoded demo data. Against production that destroys real operator data.\n" +
      `  Worktrees inherit the PROD DATABASE_URL by default, so this is refused unless you opt in.\n` +
      `  If you are certain the target is disposable: ${ALLOW_ENV}=1 pnpm db:seed\n` +
      "  To seed ONLY the safe, idempotent intelligence sources (no deletes): pnpm db:seed:sources"
    );
  }

  return null;
}
