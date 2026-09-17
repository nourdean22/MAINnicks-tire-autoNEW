/**
 * Per-tier impression VALUE probe — is tier 5 worth reserving budget for?
 *
 * The budget-cliff measurement (192 turns / 5,227 gate decisions) established
 * that tier 4 alone exhausts the 24-slot budget on 72.9% of turns, and that
 * tier 5 (semantic) is therefore skipped on 70.3%. The obvious fix is to
 * reserve slots for tier 5 — but that is only an improvement if a tier-5
 * impression is worth MORE than the tier-4 impression it displaces.
 *
 * WHY THIS PROBE CHECKS ITS OWN INSTRUMENT FIRST. The first pass scored "was
 * this tool ever chosen?" against `tool_telemetry`, and for EVERY tier the
 * dead count equalled the no-row count exactly — so the metric was measuring
 * one thing only: absence of a row in that table. That is a fact about the
 * table, not about the model's behaviour.
 *
 * `chat_messages.parts` was the intended second opinion: the schema documents
 * it as carrying the AI SDK `tool-call` parts. MEASURED 2026-09-17: it carries
 * NONE. Across 5,175 array-valued rows the only part types present are `text`
 * (5,171) and `file` (31). So there is no second instrument, and every number
 * below rests on `tool_telemetry` ALONE.
 *
 * That is why step 1 still runs and still prints. A zero from the parts scan
 * could mean "the two records agree" or "there is no second record", and only
 * the type histogram tells them apart. If the parts writer is ever fixed, this
 * step starts corroborating on its own and the verdict line below changes from
 * SINGLE-SOURCED to CORROBORATED without anyone having to remember why.
 *
 * KNOWN CONTAMINATION: one `tool_telemetry` row (of 50) has an entire
 * malformed tool-call payload stored as its tool_name, including a stray
 * `</arg_value>` tag. A real invocation was attributed to that garbage key, so
 * at least one tool's count is short by one.
 *
 * READ-ONLY: every statement is a SELECT. prod-db-guard step 2 — tables are
 * proven to exist before a column is named, because a missing table and an
 * empty table produce the same zero and only one of them means "no signal".
 *
 * Usage: railway run -s statenour-web -- node apps/statenour/scripts/probe-tier-value.mjs
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL absent — refusing to guess a target.");
  process.exit(2);
}
// prod-db-guard step 4: print the host, do not assume. Never print credentials.
console.log(`target host: ${new URL(url).host}`);

const adapter = new PrismaNeon({ connectionString: url });
const prisma = new PrismaClient({ adapter });

const REQUIRED = ["tool_gate_decisions", "tool_selection_turns", "tool_telemetry", "chat_messages"];

async function main() {
  // ── step 2 · prove the subject tables exist ──────────────────────────────
  const present = await prisma.$queryRawUnsafe(
    `SELECT table_name::text AS name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    REQUIRED,
  );
  const names = new Set(present.map((r) => r.name));
  const missing = REQUIRED.filter((t) => !names.has(t));
  if (missing.length) {
    console.error(`ABORT — table(s) absent: ${missing.join(", ")}. A zero here would be a LIE.`);
    process.exit(2);
  }

  // ── step 1 · INSTRUMENT CHECK · do the two call-records agree? ───────────
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
  const inTelemetry = new Set(telemetryTools.map((r) => r.name));
  const inParts = new Set(partsTools.map((r) => r.name));
  const onlyParts = [...inParts].filter((n) => !inTelemetry.has(n));
  const onlyTelemetry = [...inTelemetry].filter((n) => !inParts.has(n));
  console.log(`\nINSTRUMENT CHECK · tools with >=1 recorded call`);
  console.log(`  tool_telemetry rows:        ${inTelemetry.size}`);
  console.log(`  chat_messages.parts names:  ${inParts.size}`);
  console.log(`  in parts but NOT telemetry: ${onlyParts.length}${onlyParts.length ? " -> " + onlyParts.slice(0, 12).join(", ") : ""}`);
  console.log(`  in telemetry but NOT parts: ${onlyTelemetry.length}${onlyTelemetry.length ? " -> " + onlyTelemetry.slice(0, 12).join(", ") : ""}`);
  // The UNION is the honest denominator: a tool counts as "chosen" if EITHER
  // record saw it. Using the smaller set would inflate every dead-weight rate.
  const everChosen = new Set([...inTelemetry, ...inParts]);
  console.log(`  union used as "ever chosen": ${everChosen.size}`);
  // Say out loud which of the two situations produced that union, so a reader
  // three months from now cannot mistake "no second record" for "they agree".
  console.log(
    inParts.size === 0
      ? `  VERDICT: SINGLE-SOURCED — chat_messages.parts records no tool calls at all,\n` +
          `           so nothing below is corroborated. Treat every rate as one instrument's\n` +
          `           opinion. (See the ChatMessage.parts finding, 2026-09-17.)`
      : `  VERDICT: CORROBORATED by two independent records.`,
  );

  // ── per-tier impressions, scored against the UNION ───────────────────────
  const perTier = await prisma.$queryRawUnsafe(`
    SELECT d.tier, d.tool_name::text AS name, COUNT(*)::int AS impressions
      FROM tool_gate_decisions d
     WHERE d.verdict = 'ALLOWED' AND d.tier IS NOT NULL
     GROUP BY d.tier, d.tool_name`);
  const byTier = new Map();
  for (const r of perTier) {
    const t = byTier.get(r.tier) ?? { impressions: 0, dead: 0, tools: new Set(), deadTools: [] };
    t.impressions += r.impressions;
    t.tools.add(r.name);
    if (!everChosen.has(r.name)) {
      t.dead += r.impressions;
      t.deadTools.push([r.name, r.impressions]);
    }
    byTier.set(r.tier, t);
  }
  console.log(`\nALLOWED impressions by tier — 'dead' = never chosen in EITHER record`);
  for (const tier of [...byTier.keys()].sort((a, b) => a - b)) {
    const t = byTier.get(tier);
    const pct = ((t.dead / t.impressions) * 100).toFixed(1);
    console.log(
      `  tier ${tier}: ${String(t.impressions).padStart(5)} impressions · ` +
        `${String(t.tools.size).padStart(3)} distinct · ${pct}% dead weight`,
    );
  }

  // ── how often does tier 5 never get to run, and why ──────────────────────
  const turns = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS total,
           SUM(CASE WHEN budget_truncated THEN 1 ELSE 0 END)::int              AS truncated,
           SUM(CASE WHEN semantic_tier_attempted IS FALSE THEN 1 ELSE 0 END)::int AS semantic_skipped,
           SUM(CASE WHEN search_tools_fired THEN 1 ELSE 0 END)::int             AS pruner_miss
      FROM tool_selection_turns`);
  const t = turns[0];
  const p = (n) => (t.total ? `${((n / t.total) * 100).toFixed(1)}%` : "—");
  console.log(`\nturns: ${t.total}`);
  console.log(`  budget truncated      ${t.truncated} (${p(t.truncated)})`);
  console.log(`  semantic tier SKIPPED ${t.semantic_skipped} (${p(t.semantic_skipped)})`);
  console.log(`  searchTools fired (model reports a pruner miss) ${t.pruner_miss} (${p(t.pruner_miss)})`);

  const tier4 = await prisma.$queryRawUnsafe(`
    SELECT AVG(c)::float AS mean, MIN(c)::int AS min, MAX(c)::int AS max,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY c)::float AS median
      FROM (SELECT turn_id, COUNT(*)::int AS c
              FROM tool_gate_decisions
             WHERE verdict = 'ALLOWED' AND tier = 4
             GROUP BY turn_id) s`);
  const k = tier4[0];
  if (k?.mean != null) {
    console.log(
      `\ntier-4 ALLOWED per turn: mean ${k.mean.toFixed(2)} · median ${k.median} · range ${k.min}-${k.max}`,
    );
  }

  const t4 = byTier.get(4);
  if (t4) {
    console.log(`\ntier-4's most expensive dead weight (never chosen in either record):`);
    for (const [name, n] of t4.deadTools.sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      console.log(`  ${String(n).padStart(4)} impressions · ${name}`);
    }
  }
}

main()
  .catch((e) => {
    console.error("probe failed:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
