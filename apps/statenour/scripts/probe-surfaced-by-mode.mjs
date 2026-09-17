/**
 * Is "tools surfaced but never chosen" a CATALOG problem or a ROUTING problem?
 *
 * W12 measured 136/181 catalog tools (75.1%) never chosen and read it as
 * over-inclusion — i.e. prune the catalog. That reading assumes every surfaced
 * tool was CALLABLE. It may not have been.
 *
 * `app/api/ai/chat/alternate-paths.ts` (see its own comment at the `deepOn`
 * branch) states plainly that the deep-reasoning path CANNOT call tools: it
 * pre-fetches a snapshot and reasons over it. But `prepare-tools.ts` still
 * writes a full `tool.surfaced` row for those turns. So every auto-deep turn
 * inflates the denominator and can NEVER contribute to the numerator —
 * structurally, not because the catalog is bloated.
 *
 * This groups `tool.surfaced` by its `mode` tag and asks, per mode, whether a
 * matching `tool.chosen` ever NAMED a tool. If deep is a large share and never
 * names one, the 75.1% is substantially a routing artifact and pruning the
 * catalog would be treating the wrong cause.
 *
 * ⚠ POSITIVE CONTROL: aborts if there are no `tool.surfaced` rows at all. A
 * clean "0% deep" printed off an empty table is the measured-zero lie this
 * workstream exists to stamp out.
 *
 * READ-ONLY. prod-db-guard: prints the host, proves the table exists.
 * Usage: railway run -s statenour-web -- node apps/statenour/scripts/probe-surfaced-by-mode.mjs
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { classifyModeEvidence, CHOSEN_COVERAGE_FLOOR } from "./lib/mode-evidence.mjs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL absent — refusing to guess a target.");
  process.exit(2);
}
console.log(`target host: ${new URL(url).host}`);
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url }) });

async function main() {
  const present = await prisma.$queryRawUnsafe(
    `SELECT table_name::text AS name FROM information_schema.tables
      WHERE table_schema='public' AND table_name='system_metrics'`,
  );
  if (present.length === 0) {
    console.error("ABORT — system_metrics absent. A zero here would be a LIE.");
    process.exit(2);
  }

  // ── POSITIVE CONTROL ────────────────────────────────────────────────
  const [{ total }] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS total FROM system_metrics WHERE metric = 'tool.surfaced'`,
  );
  if (total === 0) {
    console.error(
      "ABORT — zero tool.surfaced rows in the WHOLE table. The lane has never\n" +
        "        written, so a per-mode breakdown would describe nothing.",
    );
    process.exit(2);
  }
  console.log(`\npositive control: ${total} tool.surfaced rows exist (all time)\n`);

  // Per mode: how many turns, and of those how many have a tool.chosen that
  // actually NAMED at least one tool. The LEFT JOIN is deliberate — a surfaced
  // turn with no chosen row at all must count as "never named", not vanish.
  const rows = await prisma.$queryRawUnsafe(
    `SELECT coalesce(s.tags->>'mode', '(none)') AS mode,
            count(*)::int                        AS turns,
            count(c.id)::int                     AS with_chosen_row,
            count(*) FILTER (WHERE c.tags->>'observed' = 'true')::int AS observed,
            count(*) FILTER (
              WHERE jsonb_array_length(coalesce(c.tags->'tools', '[]'::jsonb)) > 0
            )::int                               AS named_a_tool
       FROM system_metrics s
       LEFT JOIN system_metrics c
              ON c.metric = 'tool.chosen'
             AND c.tags->>'traceId' = s.tags->>'traceId'
      WHERE s.metric = 'tool.surfaced'
      GROUP BY 1
      ORDER BY turns DESC`,
  );

  const pad = (v, n) => String(v).padEnd(n);
  console.log(`${pad("mode", 12)}${pad("turns", 8)}${pad("chosen-row", 12)}${pad("observed", 10)}named>=1`);
  for (const r of rows) {
    console.log(
      `${pad(r.mode, 12)}${pad(r.turns, 8)}${pad(r.with_chosen_row, 12)}${pad(r.observed, 10)}${r.named_a_tool}`,
    );
  }

  // ── RECENCY SPLIT ───────────────────────────────────────────────────
  // An all-time share hides a composition change. It did here: the standard
  // turns all predate 2026-09-07, so the all-time figure UNDERSTATES how deep
  // the current traffic is. Printing the last-10-day window separately stops a
  // reader treating a historical mix as the live one.
  const recent = await prisma.$queryRawUnsafe(
    `SELECT coalesce(tags->>'mode','(none)') AS mode, count(*)::int AS turns
       FROM system_metrics
      WHERE metric = 'tool.surfaced'
        AND created_at > now() - make_interval(days => $1::int)
      GROUP BY 1 ORDER BY turns DESC`,
    10,
  );
  const recentTotal = recent.reduce((n, r) => n + r.turns, 0);
  console.log(`\nlast 10 days (${recentTotal} turns):`);
  for (const r of recent) {
    const p = recentTotal > 0 ? ((r.turns / recentTotal) * 100).toFixed(1) : "n/a";
    console.log(`  ${pad(r.mode, 12)}${pad(r.turns, 8)}${p}%`);
  }
  if (recentTotal === 0) {
    console.log("  (no recent traffic — the all-time figures below are all there is)");
  }

  // Everything that decides what these numbers are ALLOWED to mean lives in
  // scripts/lib/mode-evidence.mjs, so it can be canaried without a database.
  const ev = classifyModeEvidence({ rows, total });
  const share = ev.deepShare === null ? "n/a" : ev.deepShare.toFixed(1);
  console.log(`\ndeep share of all surfaced turns: ${ev.deepTurns}/${total} = ${share}%`);
  console.log(
    `chosen-row coverage: ${ev.chosenRows} rows across all modes ` +
      `(floor ${CHOSEN_COVERAGE_FLOOR}) -> named>=1 column is ` +
      `${ev.chosenIsInformative ? "INFORMATIVE" : "UNINFORMATIVE, ignore it"}`,
  );

  if (ev.verdict === "no-deep") {
    console.log(
      "\nVERDICT: no deep-mode turns recorded — the routing-artifact hypothesis is\n" +
        "         NOT supported by this data. Catalog over-inclusion stands.",
    );
    return;
  }

  if (ev.verdict === "partly-refuted") {
    console.log(
      `\nVERDICT: REFUTED in part — deep named a tool on some turns, so the path is\n` +
        `         NOT uniformly tool-blind. One counterexample is enough here, and\n` +
        `         it does not need the coverage floor. Re-read before acting.`,
    );
    return;
  }

  // The share alone is load-bearing: it is measured from `tool.surfaced`, which
  // has written for weeks, and it is the denominator that matters.
  console.log(
    `\nVERDICT: ${share}% of surfaced turns route to deep. Per alternate-paths.ts\n` +
      `         the deep branch pre-fetches a snapshot and CANNOT call tools, so\n` +
      `         that share of the denominator can never reach the numerator. A\n` +
      `         "tool was never chosen" rate computed over ALL surfaced turns is\n` +
      `         therefore inflated by ROUTING before any catalog effect is read.`,
  );

  if (!ev.chosenIsInformative) {
    console.log(
      `         ⚠ NOT proven here: that deep turns never name a tool. Only\n` +
        `         ${ev.chosenRows} chosen row(s) exist, so the 0 in named>=1 is the lane's\n` +
        `         age, not deep's behaviour. Re-run once coverage passes the floor.`,
    );
  }
}

main()
  .catch((e) => {
    console.error("probe failed:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
