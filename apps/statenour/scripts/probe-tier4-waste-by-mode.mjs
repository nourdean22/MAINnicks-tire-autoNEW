/**
 * Is tier-4's "dead weight" a CATALOG problem, or just deep-mode routing?
 *
 * `probe-tier-value.mjs` measured 65.3% of tier-4 ALLOWED impressions going to
 * tools that were never chosen, and that number became the case for pruning the
 * catalog. But `probe-surfaced-by-mode.mjs` then measured that 74.4% of
 * production turns route to `mode=deep`, a path that (per alternate-paths.ts)
 * CANNOT call tools at all. A tool offered on a turn that could never call it
 * is not evidence of a bad catalog entry.
 *
 * `tool_selection_turns.mode` lets the SAME dead-weight definition be split by
 * mode, from ONE table pair of the same age — no cross-lane join, none of the
 * younger-lane-reads-as-absence hazard.
 *
 * THE QUESTION: does `standard` mode — where tools ARE callable — still show
 * high dead weight?
 *   · yes -> the catalog conclusion survives for the turns that matter.
 *   · no  -> the 65.3% was routing, and pruning would be treating the wrong cause.
 *
 * ⚠ TWO CONTROLS, because both zeros here would be lies:
 *   1. tier-4 ALLOWED decisions must exist at all.
 *   2. JOIN COVERAGE. An INNER JOIN silently DROPS gate decisions whose turn has
 *      no `tool_selection_turns` row, and the dropped rows are invisible in the
 *      output. If coverage is poor the split describes a subsample, so it is
 *      measured and printed rather than assumed.
 *
 * READ-ONLY. prod-db-guard: prints the host, proves the tables exist.
 * Usage: railway run -s statenour-web -- node apps/statenour/scripts/probe-tier4-waste-by-mode.mjs
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { assessJoinCoverage } from "./lib/mode-evidence.mjs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL absent — refusing to guess a target.");
  process.exit(2);
}
console.log(`target host: ${new URL(url).host}`);
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url }) });

const REQUIRED = ["tool_gate_decisions", "tool_selection_turns", "tool_telemetry", "chat_messages"];

async function main() {
  const present = await prisma.$queryRawUnsafe(
    `SELECT table_name::text AS name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    REQUIRED,
  );
  const have = new Set(present.map((r) => r.name));
  const missing = REQUIRED.filter((t) => !have.has(t));
  if (missing.length) {
    console.error(`ABORT — table(s) absent: ${missing.join(", ")}. A zero here would be a LIE.`);
    process.exit(2);
  }

  // "Ever chosen" — the UNION of both call records, exactly as probe-tier-value
  // defines it. Using a narrower set would inflate every dead-weight rate, and
  // the whole point is to compare against the SAME quantity it published.
  const telemetryTools = await prisma.$queryRawUnsafe(
    `SELECT tool_name::text AS name FROM tool_telemetry WHERE total_calls > 0`,
  );
  const partsTools = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT p->>'toolName' AS name
      FROM chat_messages m, LATERAL jsonb_array_elements(m.parts::jsonb) p
     WHERE m.parts IS NOT NULL
       AND jsonb_typeof(m.parts::jsonb) = 'array'
       AND p->>'type' IN ('tool-call','tool-invocation','dynamic-tool')
       AND p->>'toolName' IS NOT NULL`);
  const everChosen = new Set([
    ...telemetryTools.map((r) => r.name),
    ...partsTools.map((r) => r.name),
  ]);
  console.log(`\n"ever chosen" union: ${everChosen.size} tools`);

  // ── CONTROL 1 · do tier-4 ALLOWED decisions exist? ──────────────────────
  const [{ total }] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS total FROM tool_gate_decisions
      WHERE verdict = 'ALLOWED' AND tier = 4`,
  );
  if (total === 0) {
    console.error("ABORT — zero tier-4 ALLOWED decisions. There is no waste to split.");
    process.exit(2);
  }

  // ── CONTROL 2 · how much of that survives the join? ─────────────────────
  const [{ joined }] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS joined
       FROM tool_gate_decisions d
       JOIN tool_selection_turns s ON s.turn_id = d.turn_id
      WHERE d.verdict = 'ALLOWED' AND d.tier = 4`,
  );
  const cov = assessJoinCoverage({ total, joined });
  console.log(
    `join coverage: ${joined}/${total} tier-4 decisions have a turn row ` +
      `(${cov.pct.toFixed(1)}%) -> ${cov.usable ? "USABLE" : "TOO THIN, treat the split as indicative only"}`,
  );
  if (cov.dropped > 0) {
    console.log(`  ⚠ ${cov.dropped} decision(s) dropped by the join and invisible below.`);
  }

  const rows = await prisma.$queryRawUnsafe(`
    SELECT s.mode::text AS mode, d.tool_name::text AS name, COUNT(*)::int AS impressions
      FROM tool_gate_decisions d
      JOIN tool_selection_turns s ON s.turn_id = d.turn_id
     WHERE d.verdict = 'ALLOWED' AND d.tier = 4
     GROUP BY s.mode, d.tool_name`);

  const byMode = new Map();
  for (const r of rows) {
    const m = byMode.get(r.mode) ?? { impressions: 0, dead: 0, tools: new Set() };
    m.impressions += r.impressions;
    m.tools.add(r.name);
    if (!everChosen.has(r.name)) m.dead += r.impressions;
    byMode.set(r.mode, m);
  }

  console.log(`\ntier-4 ALLOWED impressions — 'dead' = tool never chosen in EITHER record`);
  const pad = (v, n) => String(v).padEnd(n);
  console.log(`${pad("mode", 12)}${pad("impressions", 13)}${pad("distinct", 10)}dead%`);
  const pct = {};
  for (const [mode, m] of [...byMode].sort((a, b) => b[1].impressions - a[1].impressions)) {
    pct[mode] = (m.dead / m.impressions) * 100;
    console.log(
      `${pad(mode, 12)}${pad(m.impressions, 13)}${pad(m.tools.size, 10)}${pct[mode].toFixed(1)}%`,
    );
  }

  const std = pct["standard"];
  const deep = pct["deep"];
  console.log("");
  if (std === undefined) {
    console.log(
      "VERDICT: no `standard`-mode tier-4 impressions recorded. The split cannot\n" +
        "         separate routing from catalog on this data.",
    );
  } else if (deep === undefined) {
    console.log(
      `VERDICT: no deep-mode rows here — dead weight in standard mode is ${std.toFixed(1)}%,\n` +
        `         and it cannot be explained by routing.`,
    );
  } else {
    console.log(
      `VERDICT: standard ${std.toFixed(1)}% vs deep ${deep.toFixed(1)}% dead weight.\n` +
        (std >= deep - 5
          ? `         Standard mode — where tools ARE callable — wastes slots at a\n` +
            `         comparable rate. Routing does NOT explain tier-4 dead weight away;\n` +
            `         the catalog/matcher conclusion SURVIVES for the turns that matter.`
          : `         Dead weight is concentrated in deep, where no tool could have been\n` +
            `         called anyway. Pruning the catalog would be treating the wrong cause;\n` +
            `         fix ROUTING first, then re-measure.`),
    );
  }
  if (!cov.usable) {
    console.log(`         ⚠ join coverage is only ${cov.pct.toFixed(1)}% — indicative, not settled.`);
  }
}

main()
  .catch((e) => {
    console.error("probe failed:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
