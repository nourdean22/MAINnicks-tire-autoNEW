/**
 * Which LANE handled each turn, and could it have called a tool?
 *
 * This is the reader for the `lane` tag on `tool.chosen`, shipped the same day
 * as the writer — because "writer with no reader" has already shipped twice in
 * this workstream, and a lane nothing reads is a lane nobody can act on.
 *
 * WHY IT EXISTS. `alternate-paths.ts` routes a turn to one of five
 * mutually-exclusive lanes or falls through to the tool-capable streaming path,
 * and until 2026-09-17 nothing recorded which one ran. A previous probe grouped
 * `tool.surfaced` by its `mode` tag and reported "74.4% of turns route to a
 * tool-blind deep path". That was WRONG and had to be retracted: `mode` is the
 * BUDGET mode, and `alternate-paths.ts` gates the deep branch on
 * complexity/intent without ever reading it. This groups by the lane the turn
 * ACTUALLY took.
 *
 * ⚠⚠ THE CONFOUND THIS PROBE MUST NOT REPEAT. Rows written before the tag
 * shipped have NO `lane`. Coalescing those to "streaming" would relabel every
 * historical row as the fallthrough and manufacture a finding out of the tag's
 * AGE — the same shape as reading a younger lane's absence as an older lane's
 * property. They are reported as `(pre-tag)` and excluded from every rate.
 *
 * ⚠ THE LANE IS AN IDENTITY, NOT A CAPABILITY. Whether a lane can call a tool
 * is a property of the lane, read from the source. It is printed here from a
 * hand-maintained map so the two never silently diverge — and that map is
 * stated as source-derived, not measured.
 *
 * READ-ONLY. prod-db-guard: prints the host, proves the table exists.
 * Usage: railway run -s statenour-web -- node apps/statenour/scripts/probe-chosen-by-lane.mjs
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

/**
 * Read from `alternate-paths.ts`, NOT measured. `genBase` carries `tools`, so
 * every lane that spreads it can invoke them; multi-agent and deep do not.
 */
const TOOLS_CALLABLE = {
  "multi-agent": false,
  deep: false,
  regen: true,
  "self-consistency": true,
  preflush: true,
  streaming: true,
};

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
    `SELECT count(*)::int AS total FROM system_metrics WHERE metric = 'tool.chosen'`,
  );
  if (total === 0) {
    console.error(
      "ABORT — zero tool.chosen rows exist at all. The lane has never written,\n" +
        "        so a per-lane breakdown would describe nothing.",
    );
    process.exit(2);
  }

  const rows = await prisma.$queryRawUnsafe(
    `SELECT coalesce(tags->>'lane', '(pre-tag)') AS lane,
            count(*)::int AS turns,
            count(*) FILTER (WHERE tags->>'observed' = 'true')::int AS observed,
            count(*) FILTER (
              WHERE jsonb_array_length(coalesce(tags->'tools', '[]'::jsonb)) > 0
            )::int AS named
       FROM system_metrics
      WHERE metric = 'tool.chosen'
      GROUP BY 1
      ORDER BY turns DESC`,
  );

  const preTag = rows.find((r) => r.lane === "(pre-tag)")?.turns ?? 0;
  const tagged = total - preTag;

  console.log(`\n${total} tool.chosen rows · ${tagged} carry a lane · ${preTag} predate the tag\n`);
  const pad = (v, n) => String(v).padEnd(n);
  console.log(`${pad("lane", 18)}${pad("turns", 8)}${pad("observed", 10)}${pad("named>=1", 10)}tools callable?`);
  for (const r of rows) {
    const cap =
      r.lane === "(pre-tag)"
        ? "— (tag not yet written)"
        : r.lane in TOOLS_CALLABLE
          ? TOOLS_CALLABLE[r.lane] ? "yes (source)" : "NO (source)"
          : "⚠ UNKNOWN LANE — update TOOLS_CALLABLE";
    console.log(`${pad(r.lane, 18)}${pad(r.turns, 8)}${pad(r.observed, 10)}${pad(r.named, 10)}${cap}`);
  }

  if (tagged === 0) {
    console.log(
      `\nVERDICT: NO tagged rows yet — every row predates the lane tag. This says\n` +
        `         NOTHING about lane distribution. The writer ships in #2401; re-run\n` +
        `         after it deploys and real turns land. Do not read the (pre-tag)\n` +
        `         count as a lane.`,
    );
    return;
  }

  // Only lanes that CAN call tools belong in a "was a tool chosen?" rate. A
  // lane that structurally cannot is not evidence about the catalog.
  const capable = rows.filter((r) => TOOLS_CALLABLE[r.lane] === true);
  const capTurns = capable.reduce((n, r) => n + r.turns, 0);
  const capNamed = capable.reduce((n, r) => n + r.named, 0);
  const capObserved = capable.reduce((n, r) => n + r.observed, 0);

  console.log(
    `\ntool-capable lanes: ${capTurns} turns · ${capObserved} observed · ${capNamed} named >=1 tool`,
  );
  if (capObserved === 0) {
    console.log(
      `VERDICT: no OBSERVED turn on a tool-capable lane yet. "${capNamed} named" is\n` +
        `         therefore not a rate — it is an absence of measurement. Re-run when\n` +
        `         observed > 0.`,
    );
    return;
  }
  const pct = ((capNamed / capObserved) * 100).toFixed(1);
  console.log(
    `VERDICT: on lanes that COULD call a tool, ${capNamed}/${capObserved} observed turns\n` +
      `         (${pct}%) chose at least one. THIS is the denominator the catalog\n` +
      `         question needs — turns on tool-blind lanes are excluded by source,\n` +
      `         not by a tag heuristic.`,
  );
}

main()
  .catch((e) => {
    console.error("probe failed:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
