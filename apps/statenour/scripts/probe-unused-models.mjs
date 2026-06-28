/**
 * probe-unused-models.mjs
 *
 * Connects to Neon via the project's PrismaClient raw query surface.
 * Checks which of the 13 flagged models have actual tables + rows.
 *
 * Usage: node scripts/probe-unused-models.mjs
 */

import { PrismaClient } from "@prisma/client";

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

const prisma = new PrismaClient({ log: [] });

async function probe() {
  console.log("Neon probe · flagged models ·", new Date().toISOString());
  console.log("─".repeat(60));

  const results = [];

  for (const name of TABLES) {
    try {
      // Check table existence via information_schema
      const [{ exists }] = await prisma.$queryRawUnsafe(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = '${name}'
        ) AS exists`
      );

      if (!exists) {
        results.push({ name, exists: false, rows: null, size: null });
        console.log(`${name.padEnd(25)} │ NOT FOUND`);
        continue;
      }

      // Row count (fast estimate via pg_class for large tables, fallback to COUNT)
      const [{ count }] = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS count FROM "${name}"`
      );

      // Size
      const [{ size }] = await prisma.$queryRawUnsafe(
        `SELECT pg_size_pretty(pg_total_relation_size('public."${name}"')) AS size`
      );

      results.push({ name, exists: true, rows: count, size });
      const rowStr = count === 0 ? "0 rows" : `${count} rows`;
      console.log(`${name.padEnd(25)} │ EXISTS │ ${rowStr.padEnd(12)} │ ${size}`);
    } catch (e) {
      results.push({ name, exists: false, rows: null, size: null, error: e.message });
      console.log(`${name.padEnd(25)} │ ERROR  │ ${e.message.split("\n")[0]}`);
    }
  }

  const totalRows = results.filter((r) => r.exists && (r.rows ?? 0) > 0);
  const totalSize = results.filter((r) => r.exists).length;

  console.log("─".repeat(60));
  console.log(`Summary: ${totalSize}/${TABLES.length} tables exist · ${totalRows.length} have data`);

  if (totalRows.length === 0) {
    console.log("✅ SAFE TO DROP — all tables are empty or do not exist");
  } else {
    console.log("⚠️  DO NOT DROP — the following have data:");
    for (const r of totalRows) {
      console.log(`   · ${r.name}: ${r.rows} rows (${r.size})`);
    }
  }

  await prisma.$disconnect();
}

probe().catch((e) => {
  console.error("Probe failed:", e);
  process.exit(1);
});
