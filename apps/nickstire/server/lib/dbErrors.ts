/**
 * Recognise a UNIQUE-constraint rejection from mysql2 / TiDB.
 *
 * Why a shared helper: this check existed as ad-hoc copies in
 * services/proposals.ts, services/shopDriverMirror.ts (twice) and
 * services/promiseLedger.ts — each a slightly different regex, one of them
 * (/duplicate/i) loose enough to match "Duplicate column name". All four
 * import this now (2026-09-22); a fifth copy would drift like the others did.
 *
 * What the signal MEANS is the caller's business. On an idempotency index it is
 * usually "someone else already did this" — a success, not a failure — and the
 * caller should re-read rather than surface an error. On a primary key it may be
 * a genuine bug. This function only answers "was it a duplicate-key rejection".
 */
export function isDuplicateKeyError(err: unknown): boolean {
  return anyDriverError(
    err,
    (code, errno, message) =>
      code === "ER_DUP_ENTRY" || errno === 1062 || (message != null && /ER_DUP_ENTRY|Duplicate entry|\b1062\b/i.test(message)),
  );
}

/**
 * Recognise MySQL's "table doesn't exist" (1146 / ER_NO_SUCH_TABLE), and
 * nothing else: not 1054 (unknown column), not 1051 (unknown table), not a
 * connection error. It gates every "migration not applied yet" branch, which
 * degrades to an empty or migrationPending answer. A false positive would
 * render a real failure as "nothing there".
 *
 * One definition, 2026-09-23. db.ts and four services (opportunityQueue,
 * promiseLedger, smsResponseJobs, vapiCallArchive) each carried their own copy.
 * All five missed a drizzle-wrapped 1146, and two regexed the wrapper text, so a
 * failed query whose params held "1146" degraded silently.
 */
export function isMissingTableError(err: unknown): boolean {
  return anyDriverError(
    err,
    (code, errno, message) =>
      code === "ER_NO_SUCH_TABLE" || errno === 1146 || (message != null && /\bTable '[^']*' doesn't exist/i.test(message)),
  );
}

type DriverErrorShape = {
  code?: unknown;
  errno?: unknown;
  message?: unknown;
  cause?: unknown;
  query?: unknown;
  params?: unknown;
};

/**
 * Ask `test` about the thrown value and up to three `.cause` levels below it.
 *
 * drizzle-orm (0.45) wraps EVERY driver error, builder queries and
 * `db.execute(sql…)` alike, in a DrizzleQueryError. The wrapper's message is
 * only "Failed query: <sql>\nparams: <params>". The driver's code, errno and
 * text live on `.cause`. A recogniser that reads only the top level therefore
 * never sees a real driver error.
 *
 * The wrapper's own message is never text-matched. Its SQL and params are
 * caller data, so a phone number ending in 1146 must not read as "table
 * missing", nor an id of 1062 as "duplicate key".
 */
function anyDriverError(err: unknown, test: (code: unknown, errno: unknown, message: string | null) => boolean): boolean {
  let e: unknown = err;
  for (let depth = 0; depth < 4 && e != null; depth++) {
    if (typeof e === "string") return test(undefined, undefined, e);
    if (typeof e !== "object") return false;
    const x = e as DriverErrorShape;
    const isDrizzleWrapper = "query" in x && "params" in x;
    const message = !isDrizzleWrapper && typeof x.message === "string" ? x.message : null;
    if (test(x.code, x.errno, message)) return true;
    e = x.cause;
  }
  return false;
}

