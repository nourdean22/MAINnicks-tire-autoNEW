/**
 * probe-unused-models.cjs — Neon table existence + row count probe
 */

const { neon } = require("@neondatabase/serverless");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

const TABLES = [
  "AgentFeedback",
  "AgentMemoryHit",
  "AgentRun",
  "CommandResolution",
  "ContentNode",
  "DailyEmpireSnapshot",
  "DailyStrategy",
  "EnvironmentalSignal",
  "FinancialTransaction",
  "InvestmentHolding",
  "OperatorCheckIn",
  "StagedRecoveryItem",
  "WorkResult",
];

async function probe() {
  console.log("Neon probe · flagged models ·", new Date().toISOString());
  console.log("-".repeat(60));

  let found = 0;
  let withData = 0;
  const dataTables = [];

  for (const name of TABLES) {
    try {
      // Check existence
      const existRows = await sql`SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ${name}
      ) AS exists`;
      const exists = existRows?.[0]?.exists;

      if (!exists) {
        console.log(name.padEnd(25) + " | NOT FOUND");
        continue;
      }

      // Count rows
      const countRows = await sql.unsafe(`SELECT COUNT(*)::int AS count FROM "${name.replace(/"/g, '""')}"`);
      const count = countRows?.[0]?.count ?? 0;

      // Size
      const sizeRows = await sql.unsafe(`SELECT pg_size_pretty(pg_total_relation_size('public."${name.replace(/"/g, '""')}"')) AS size`);
      const size = sizeRows?.[0]?.size ?? "0 bytes";

      found++;
      if (count > 0) {
        withData++;
        dataTables.push({ name, count, size });
      }

      const rowStr = (count + " rows").padEnd(12);
      console.log(name.padEnd(25) + " | EXISTS | " + rowStr + " | " + size);
    } catch (e) {
      console.log(name.padEnd(25) + " | ERROR  | " + e.message.split("\n")[0]);
    }
  }

  console.log("-".repeat(60));
  console.log("Summary: " + found + "/" + TABLES.length + " tables exist | " + withData + " have data");

  if (withData === 0) {
    console.log("✅ SAFE TO DROP — all tables are empty or do not exist");
  } else {
    console.log("⚠️  DO NOT DROP — the following have data:");
    for (const t of dataTables) {
      console.log("   · " + t.name + ": " + t.count + " rows (" + t.size + ")");
    }
  }
}

probe().catch((e) => {
  console.error("Probe failed:", e);
  process.exit(1);
});
