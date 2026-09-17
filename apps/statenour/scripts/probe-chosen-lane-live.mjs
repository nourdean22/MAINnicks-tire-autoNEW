/**
 * Is the `tool.chosen` lane actually writing in production?
 *
 * BUILT-TESTED-UNWIRED IS A FAILURE. The lane merged in #2390 and deployed with
 * `53d8a963f`; green tests prove the function works, not that the wire is live.
 *
 * ⚠ THE WHOLE DESIGN IS ABOUT NOT MISREADING A ZERO. "No tool.chosen rows" has
 * two completely different causes:
 *
 *   · nobody has chatted since the deploy  -> nothing to write, lane is fine
 *   · the lane is broken                   -> turns happened, rows are missing
 *
 * So this reads `tool.surfaced` over the SAME window as the control. That lane
 * has been live for weeks and fires once per turn from `prepare-tools.ts`, so
 * surfaced>0 with chosen=0 is a REAL FAILURE, while surfaced=0 is simply no
 * traffic. Reporting "0 rows" without that control would be the measured-zero
 * lie this whole workstream exists to stamp out.
 *
 * READ-ONLY. prod-db-guard: prints the host, proves the table exists.
 * Usage: railway run -s statenour-web -- node apps/statenour/scripts/probe-chosen-lane-live.mjs
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

/** The deploy that first carried the lane. Rows before this prove nothing. */
const DEPLOYED_AT = "2026-09-17T11:39:00Z";

async function main() {
  const present = await prisma.$queryRawUnsafe(
    `SELECT table_name::text AS name FROM information_schema.tables
      WHERE table_schema='public' AND table_name='system_metrics'`,
  );
  if (present.length === 0) {
    console.error("ABORT — system_metrics absent. A zero here would be a LIE.");
    process.exit(2);
  }

  const rows = await prisma.$queryRawUnsafe(
    `SELECT metric::text AS metric,
            count(*)::int AS rows,
            min(created_at) AS first_at,
            max(created_at) AS last_at
       FROM system_metrics
      WHERE metric IN ('tool.surfaced','tool.chosen')
        AND created_at >= $1::timestamptz
      GROUP BY metric ORDER BY metric`,
    DEPLOYED_AT,
  );
  const by = new Map(rows.map((r) => [r.metric, r]));
  const surfaced = by.get("tool.surfaced");
  const chosen = by.get("tool.chosen");

  console.log(`\nsince deploy (${DEPLOYED_AT}):`);
  console.log(`  tool.surfaced  ${surfaced?.rows ?? 0} rows   <- the CONTROL: proves turns happened`);
  console.log(`  tool.chosen    ${chosen?.rows ?? 0} rows`);

  if (!surfaced || surfaced.rows === 0) {
    console.log(
      `\nVERDICT: NO TRAFFIC since the deploy — the control lane is empty too, so this says\n` +
        `         NOTHING about whether tool.chosen works. Re-run after a real chat turn.`,
    );
    return;
  }
  if (!chosen || chosen.rows === 0) {
    console.log(
      `\nVERDICT: ⚠ BROKEN. ${surfaced.rows} turns were surfaced and NOT ONE chosen row was\n` +
        `         written. That is the wire, not the traffic.`,
    );
    process.exitCode = 1;
    return;
  }

  // Shape check — a row that exists but carries nothing useful is still a failure.
  const shape = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int                                                   AS total,
            count(*) FILTER (WHERE tags ? 'observed')::int                  AS has_observed,
            count(*) FILTER (WHERE tags->>'observed'='true')::int           AS measured,
            count(*) FILTER (WHERE tags->>'observed'<>'true')::int          AS blind,
            count(*) FILTER (WHERE tags ? 'traceId'
                               AND tags->>'traceId' IS NOT NULL)::int       AS has_trace,
            count(*) FILTER (WHERE jsonb_array_length(COALESCE(tags->'tools','[]'::jsonb))>0)::int AS with_tools
       FROM system_metrics
      WHERE metric='tool.chosen' AND created_at >= $1::timestamptz`,
    DEPLOYED_AT,
  );
  const s = shape[0];
  console.log(`\nshape of the ${s.total} chosen rows:`);
  console.log(`  carry observed flag   ${s.has_observed}/${s.total}`);
  console.log(`  measured (observed)   ${s.measured}`);
  console.log(`  blind                 ${s.blind}`);
  console.log(`  carry a traceId       ${s.has_trace}/${s.total}   <- required for the JOIN`);
  console.log(`  named >=1 tool        ${s.with_tools}`);

  // The join is the entire point of the lane.
  const joined = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS matched
       FROM system_metrics c
       JOIN system_metrics f
         ON f.metric='tool.surfaced'
        AND f.tags->>'traceId' = c.tags->>'traceId'
      WHERE c.metric='tool.chosen' AND c.created_at >= $1::timestamptz`,
    DEPLOYED_AT,
  );
  console.log(`\n  chosen rows that JOIN to a surfaced row by traceId: ${joined[0].matched}/${s.total}`);
  console.log(
    joined[0].matched > 0
      ? `\nVERDICT: ✅ LIVE and JOINABLE — the numerator exists and pairs with the denominator.`
      : `\nVERDICT: ⚠ rows exist but NONE join by traceId. The lane writes; the pair does not.`,
  );
  if (joined[0].matched === 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("probe failed:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
