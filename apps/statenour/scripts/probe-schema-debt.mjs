/**
 * Schema-debt probe · v10.0.193
 *
 * Surfaces:
 *   · Soft-deleted row backlog per table (rows hanging around)
 *   · Hot write tables sized for partitioning
 *   · Tables that should age out via TTL
 *   · BrainMemory category overload (abuse-as-storage signal)
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  // 1. Soft-deleted row counts on tables that have deleted_at
  console.log("\n=== Soft-deleted backlog per table ===");
  const sdTables = [
    { table: "brain_memories", soft: "deleted_at" },
    { table: "tasks", soft: "deleted_at" },
    { table: '"Mission"', soft: "deleted_at" },
    { table: "chat_messages", soft: null }, // no soft-delete
    { table: "chat_conversations", soft: "archived_at" },
    { table: "mastery_decisions", soft: "deleted_at" },
    { table: "drift_alerts", soft: null },
  ];
  for (const t of sdTables) {
    try {
      const total = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM ${t.table}`);
      const soft = t.soft
        ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM ${t.table} WHERE ${t.soft} IS NOT NULL`)
        : [{ n: 0 }];
      const live = Number(total[0].n) - Number(soft[0].n);
      const pct = Number(total[0].n) > 0 ? Math.round((Number(soft[0].n) / Number(total[0].n)) * 100) : 0;
      console.log(
        `  ${t.table.padEnd(22)} total=${String(total[0].n).padStart(6)}  live=${String(live).padStart(6)}  soft-deleted=${String(soft[0].n).padStart(6)} (${pct}%)`,
      );
    } catch (e) {
      console.log(`  ${t.table} · error: ${e.message?.slice(0, 60)}`);
    }
  }

  // 2. Hot write tables sized for partitioning (>100k rows + time-indexed)
  console.log("\n=== Append-only/log tables (partitioning candidates) ===");
  const logs = ["agent_traces", "system_metrics", "audit_events", "cron_job_logs", "tool_invocations"];
  for (const t of logs) {
    try {
      const total = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${t}"`);
      const oldest = await prisma.$queryRawUnsafe(`SELECT MIN("createdAt")::text AS d FROM "${t}"`);
      const newest = await prisma.$queryRawUnsafe(`SELECT MAX("createdAt")::text AS d FROM "${t}"`);
      const sizeBytes = await prisma.$queryRawUnsafe(`SELECT pg_total_relation_size('"${t}"')::bigint AS sz`);
      const mb = Math.round(Number(sizeBytes[0].sz) / 1024 / 1024);
      console.log(
        `  ${t.padEnd(22)} rows=${String(total[0].n).padStart(8)}  size=${String(mb).padStart(5)}MB  oldest=${(oldest[0].d ?? "").slice(0, 10)}  newest=${(newest[0].d ?? "").slice(0, 10)}`,
      );
    } catch (e) {
      console.log(`  ${t.padEnd(22)} · ${e.message?.slice(0, 60)}`);
    }
  }

  // 3. BrainMemory category overload
  console.log("\n=== BrainMemory category breakdown ===");
  const cats = await prisma.$queryRawUnsafe(`
    SELECT category, COUNT(*)::int AS n
    FROM brain_memories
    WHERE deleted_at IS NULL
    GROUP BY category
    ORDER BY COUNT(*) DESC
    LIMIT 15
  `);
  for (const c of cats) {
    console.log(`  ${c.category.padEnd(30)} ${String(c.n).padStart(6)}`);
  }

  // 4. Largest tables overall
  console.log("\n=== Top 10 tables by size ===");
  const top = await prisma.$queryRawUnsafe(`
    SELECT
      relname AS table_name,
      pg_total_relation_size(c.oid) AS size_bytes,
      reltuples::bigint AS row_estimate
    FROM pg_class c
    LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname = 'public'
    ORDER BY pg_total_relation_size(c.oid) DESC
    LIMIT 10
  `);
  for (const r of top) {
    const mb = Math.round(Number(r.size_bytes) / 1024 / 1024);
    console.log(`  ${r.table_name.padEnd(28)} size=${String(mb).padStart(5)}MB  rows≈${String(r.row_estimate).padStart(8)}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
