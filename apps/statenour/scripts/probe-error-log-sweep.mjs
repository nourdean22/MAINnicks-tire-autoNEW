/**
 * What is production actually reporting?
 *
 * Three questions, kept separate because they have different remedies:
 *   1. WHAT IS ERRORING — clustered, so 400 copies of one fault read as one
 *      fault and not as 400 problems.
 *   2. WHICH TELEMETRY LANES ARE DEAD — `logError` rows under an
 *      `instrument.*` surface mean a metric write FAILED. Those are special:
 *      a dead instrument produces a MISSING row, and a missing row reads as
 *      "nothing happened" everywhere downstream.
 *   3. IS THE ERROR LOG ITSELF ALIVE — an empty sweep has two causes and they
 *      are opposite. Zero rows because nothing failed, or zero rows because
 *      the writer is broken. The control below separates them.
 *
 * ⚠ SILENCE IS NOT HEALTH. If the newest row is older than the deploy, this
 * says the LOG stopped, not that the system got better.
 *
 * ⚠ `logError` persists `message` VERBATIM (lib/utils/error-log.ts) and
 * `redactSensitive` covers only the structured `extra`. Messages are truncated
 * here and printed to the operator's own terminal only.
 *
 * READ-ONLY. prod-db-guard: prints the host, proves the table exists.
 * Usage: railway run -s statenour-web -- node apps/statenour/scripts/probe-error-log-sweep.mjs
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL absent — refusing to guess a target.");
  process.exit(2);
}
console.log(`target host: ${new URL(url).host}`);
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url }) });

const DAYS = Number(process.env.DAYS ?? 7);

async function main() {
  const present = await prisma.$queryRawUnsafe(
    `SELECT table_name::text AS name FROM information_schema.tables
      WHERE table_schema='public' AND table_name='error_logs'`,
  );
  if (present.length === 0) {
    console.error("ABORT — error_logs absent. A zero here would be a LIE.");
    process.exit(2);
  }

  // ── CONTROL: is the writer alive at all, and how fresh? ─────────────
  const [span] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS total, min(created_at) AS oldest, max(created_at) AS newest
       FROM error_logs`,
  );
  if (span.total === 0) {
    console.error(
      "ABORT — error_logs is EMPTY for all time. That is far more likely to be a\n" +
        "        broken writer than a flawless system. Do not read this as healthy.",
    );
    process.exit(2);
  }
  const newest = new Date(span.newest);
  const ageH = ((Date.now() - newest.getTime()) / 3_600_000).toFixed(1);
  console.log(
    `\nwriter control: ${span.total} rows all-time · newest ${newest.toISOString()} (${ageH}h ago)`,
  );
  if (Number(ageH) > 48) {
    console.log(
      "  ⚠ newest row is >48h old — treat a quiet sweep below as POSSIBLY A DEAD LOG,\n" +
        "    not as an absence of errors.",
    );
  }

  console.log(`\n── levels, last ${DAYS}d ──`);
  const levels = await prisma.$queryRawUnsafe(
    `SELECT level::text AS level, count(*)::int AS n
       FROM error_logs WHERE created_at > now() - make_interval(days => $1::int)
      GROUP BY 1 ORDER BY n DESC`,
    DAYS,
  );
  if (levels.length === 0) console.log("  (no rows in window)");
  for (const l of levels) console.log(`  ${String(l.level).padEnd(8)} ${l.n}`);

  // ── 2 · DEAD TELEMETRY LANES ────────────────────────────────────────
  // An instrument failure is not one bad turn; it is a measurement that has
  // stopped existing, and every consumer of that lane silently reads zero.
  console.log(`\n── INSTRUMENT FAILURES (a dead lane reads as "nothing happened") ──`);
  const instr = await prisma.$queryRawUnsafe(
    // ⚠ IDENTITY COMES FROM `context.source`, NOT `surface`/`fn`.
    // `logError(source, msg, extra)` writes `context: { source, ...extra }` and
    // prefixes the message `[<source>]`. There is no `surface` key at all — the
    // first version grouped on one, so every lane collapsed into `(no surface)`
    // and a dead instrument could not be NAMED. The message prefix is the
    // fallback for rows whose context predates the convention.
    // ⚠ NO REGEX. A backslash class inside a JS template literal is consumed
    // before Postgres sees it (`\[` becomes `[`), which silently turns the
    // pattern into something that matches the wrong thing. The bracket prefix
    // is extracted with plain string functions instead, so what is written is
    // what the database receives.
    `SELECT coalesce(
              context->>'source',
              CASE WHEN message LIKE '[%' AND position(']' in message) > 2
                   THEN substring(message from 2 for position(']' in message) - 2)
              END,
              '(unattributed)'
            ) AS lane,
            count(*)::int AS n, max(created_at) AS last_at
       FROM error_logs
      WHERE created_at > now() - make_interval(days => $1::int)
        AND (context->>'source' LIKE 'instrument.%' OR message LIKE '[instrument.%')
      GROUP BY 1 ORDER BY n DESC LIMIT 20`,
    DAYS,
  );
  if (instr.length === 0) {
    console.log("  none — no metric lane reported a write failure in the window.");
  }
  for (const r of instr) {
    console.log(`  ${String(r.lane).padEnd(38)} ${String(r.n).padStart(5)}  last ${new Date(r.last_at).toISOString()}`);
  }

  // ── 1 · WHAT IS ERRORING, CLUSTERED ─────────────────────────────────
  console.log(`\n── top fault clusters, last ${DAYS}d (grouped by message prefix) ──`);
  const clusters = await prisma.$queryRawUnsafe(
    `SELECT left(message, 90) AS shape,
            level::text AS level,
            count(*)::int AS n,
            max(created_at) AS last_at,
            coalesce(
              max(context->>'source'),
              CASE WHEN max(message) LIKE '[%' AND position(']' in max(message)) > 2
                   THEN substring(max(message) from 2 for position(']' in max(message)) - 2)
              END,
              '-'
            ) AS surface
       FROM error_logs
      WHERE created_at > now() - make_interval(days => $1::int)
      GROUP BY 1, 2 ORDER BY n DESC LIMIT 20`,
    DAYS,
  );
  if (clusters.length === 0) console.log("  (no rows in window)");
  for (const c of clusters) {
    console.log(
      `  ${String(c.n).padStart(5)}x [${c.level}] ${new Date(c.last_at).toISOString().slice(5, 16)} ${c.surface}\n         ${String(c.shape).replace(/\s+/g, " ")}`,
    );
  }

  const windowTotal = levels.reduce((n, l) => n + l.n, 0);
  console.log(
    `\n${windowTotal} error_logs rows in the last ${DAYS}d.` +
      (windowTotal === 0
        ? " ⚠ ZERO — check the writer-control line above before calling this healthy."
        : ""),
  );
}

main()
  .catch((e) => {
    console.error("probe failed:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
