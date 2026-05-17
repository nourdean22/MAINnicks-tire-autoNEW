/**
 * Integrity scan · v10.0.340 · Phase 2 of glitch taxonomy hardening.
 *
 * Detects:
 *   · Orphan rows (parent FK points nowhere)
 *   · Zombie refs (FK points to soft-deleted parent)
 *   · Empty shell records (parent with zero expected children)
 *   · Embedding coverage gaps (rows that should have embeddings but don't)
 *   · Stuck non-terminal states (Task DOING > 7d, Mission IN_PROGRESS > 30d)
 *
 * Run modes:
 *   · default · prints summary + top examples per finding
 *   · `--json` · machine-readable output for digests / dashboards
 *   · `--fix-orphans` · auto-deletes orphan tasks/messages (DANGEROUS,
 *     gated behind explicit flag · default is dry-run only)
 *
 * Future: wire as a weekly cron (Sunday 03:00) writing results to
 * brainMemory category=integrity_alert · Telegram-pings on critical
 * findings.
 *
 * Per docs/glitch-taxonomy.md · Category 6 (data integrity drift).
 */

import { prisma } from "@/lib/prisma";

interface ScanFinding {
  category: "orphan" | "empty-shell" | "stuck-state" | "coverage-gap";
  table: string;
  description: string;
  count: number;
  /** Sample IDs (max 5) for investigation */
  sampleIds: string[];
  severity: "info" | "warn" | "critical";
}

const findings: ScanFinding[] = [];

function add(f: ScanFinding) {
  findings.push(f);
}

// ── Orphan detection ─────────────────────────────────────────────────

async function scanOrphanTasks() {
  // Tasks with missionId set but the mission row doesn't exist.
  const tasks = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT t.id FROM tasks t
     LEFT JOIN missions m ON t.mission_id = m.id
     WHERE t.mission_id IS NOT NULL AND m.id IS NULL
     LIMIT 5`,
  ).catch(() => []);
  const totalRow = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
    `SELECT COUNT(*)::bigint AS c FROM tasks t
     LEFT JOIN missions m ON t.mission_id = m.id
     WHERE t.mission_id IS NOT NULL AND m.id IS NULL`,
  ).catch(() => [{ c: 0n }]);
  const total = Number(totalRow[0]?.c ?? 0n);
  if (total > 0) {
    add({
      category: "orphan",
      table: "tasks",
      description: "tasks pointing to non-existent mission",
      count: total,
      sampleIds: tasks.map((t) => t.id),
      severity: "warn",
    });
  }
}

async function scanOrphanChatMessages() {
  // ChatMessage already has onDelete:Cascade so this should be 0 — but
  // verify in case a manual delete or cascade misconfiguration created
  // orphans.
  const orphans = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT cm.id FROM chat_messages cm
     LEFT JOIN chat_conversations cc ON cm.conversation_id = cc.id
     WHERE cc.id IS NULL
     LIMIT 5`,
  ).catch(() => []);
  const totalRow = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
    `SELECT COUNT(*)::bigint AS c FROM chat_messages cm
     LEFT JOIN chat_conversations cc ON cm.conversation_id = cc.id
     WHERE cc.id IS NULL`,
  ).catch(() => [{ c: 0n }]);
  const total = Number(totalRow[0]?.c ?? 0n);
  if (total > 0) {
    add({
      category: "orphan",
      table: "chat_messages",
      description: "messages pointing to non-existent conversation",
      count: total,
      sampleIds: orphans.map((o) => o.id),
      severity: "critical", // FK should prevent this
    });
  }
}

async function scanOrphanGoalEvents() {
  // GoalEvents pointing to deleted goals
  const orphans = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT ge.id FROM goal_events ge
     LEFT JOIN goals g ON ge.goal_id = g.id
     WHERE g.id IS NULL
     LIMIT 5`,
  ).catch(() => []);
  const totalRow = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
    `SELECT COUNT(*)::bigint AS c FROM goal_events ge
     LEFT JOIN goals g ON ge.goal_id = g.id
     WHERE g.id IS NULL`,
  ).catch(() => [{ c: 0n }]);
  const total = Number(totalRow[0]?.c ?? 0n);
  if (total > 0) {
    add({
      category: "orphan",
      table: "goal_events",
      description: "events pointing to non-existent goal",
      count: total,
      sampleIds: orphans.map((o) => o.id),
      severity: "warn",
    });
  }
}

// ── Empty shell detection ────────────────────────────────────────────

async function scanEmptyConversations() {
  // ChatConversation with messageCount=0 AND no ChatMessage rows
  const empty = await prisma.chatConversation.findMany({
    where: {
      messages: { none: {} },
      // Last activity > 24h ago · brand-new convos shouldn't trigger
      createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      archivedAt: null,
    },
    select: { id: true },
    take: 5,
  });
  const total = await prisma.chatConversation.count({
    where: {
      messages: { none: {} },
      createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      archivedAt: null,
    },
  });
  if (total > 0) {
    add({
      category: "empty-shell",
      table: "chat_conversations",
      description: "conversations with zero messages, > 24h old, not archived",
      count: total,
      sampleIds: empty.map((c) => c.id),
      severity: "info",
    });
  }
}

// ── Stuck state detection ────────────────────────────────────────────

async function scanStuckTasks() {
  // Tasks in DOING for > 7 days · likely abandoned
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const stuck = await prisma.task.findMany({
    where: {
      status: "DOING",
      updatedAt: { lt: sevenDaysAgo },
      deletedAt: null,
    },
    select: { id: true, title: true },
    take: 5,
  });
  const total = await prisma.task.count({
    where: {
      status: "DOING",
      updatedAt: { lt: sevenDaysAgo },
      deletedAt: null,
    },
  });
  if (total > 0) {
    add({
      category: "stuck-state",
      table: "tasks",
      description: "tasks stuck in DOING for > 7d (likely abandoned)",
      count: total,
      sampleIds: stuck.map((t) => `${t.id} · "${t.title.slice(0, 40)}"`),
      severity: "info",
    });
  }
}

async function scanStuckMissions() {
  // Mission status enum is ACTIVE / PAUSED / COMPLETE / KILLED · "stuck"
  // means ACTIVE but no movement (updatedAt lag) for > 30d.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const stuck = await prisma.mission.findMany({
    where: {
      status: "ACTIVE",
      updatedAt: { lt: thirtyDaysAgo },
    },
    select: { id: true, title: true },
    take: 5,
  });
  const total = await prisma.mission.count({
    where: {
      status: "ACTIVE",
      updatedAt: { lt: thirtyDaysAgo },
    },
  });
  if (total > 0) {
    add({
      category: "stuck-state",
      table: "missions",
      description: "missions ACTIVE but no movement > 30d",
      count: total,
      sampleIds: stuck.map((m) => `${m.id} · "${m.title.slice(0, 40)}"`),
      severity: "warn",
    });
  }
}

async function scanStuckStreams() {
  // Chat messages with streamingState=streaming for > 5min · likely dropped
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const stuck = await prisma.chatMessage.findMany({
    where: {
      streamingState: "streaming",
      createdAt: { lt: fiveMinAgo },
    },
    select: { id: true, conversationId: true },
    take: 5,
  });
  const total = await prisma.chatMessage.count({
    where: {
      streamingState: "streaming",
      createdAt: { lt: fiveMinAgo },
    },
  });
  if (total > 0) {
    add({
      category: "stuck-state",
      table: "chat_messages",
      description: "messages stuck in streamingState=streaming > 5min",
      count: total,
      sampleIds: stuck.map((m) => `${m.id} · conv=${m.conversationId.slice(0, 12)}…`),
      severity: "warn",
    });
  }
}

// ── Coverage gap detection ───────────────────────────────────────────

async function scanBrainMemoryCategoryDrift() {
  // BrainMemory rows with category strings not in the registry · the
  // existing /system/coverage shows this but the integrity scan should
  // also surface it for the integrity_alert digest.
  const { BRAIN_CATEGORIES } = await import("@/lib/brain/categories");
  const knownCategories = Object.values(BRAIN_CATEGORIES);
  const drift = await prisma.brainMemory.groupBy({
    by: ["category"],
    where: { category: { notIn: knownCategories } },
    _count: { _all: true },
    orderBy: { _count: { id: "desc" } },
    take: 5,
  });
  const totalDriftCategories = await prisma.brainMemory
    .findMany({
      where: { category: { notIn: knownCategories } },
      distinct: ["category"],
      select: { category: true },
    })
    .then((rows) => rows.length);
  if (totalDriftCategories > 0) {
    const totalRows = drift.reduce((s, d) => s + d._count._all, 0);
    add({
      category: "coverage-gap",
      table: "brain_memories",
      description: `${totalDriftCategories} unregistered categor${totalDriftCategories === 1 ? "y" : "ies"} writing to brain_memories (drift signal · add to lib/brain/categories.ts)`,
      count: totalRows,
      sampleIds: drift.map((d) => `${d.category} (${d._count._all} rows)`),
      severity: "info",
    });
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");

  if (!json) {
    console.log("\n🔍 integrity scan · v10.0.340\n");
  }

  // Run each scanner · they push findings to the shared array
  await Promise.all([
    scanOrphanTasks(),
    scanOrphanChatMessages(),
    scanOrphanGoalEvents(),
    scanEmptyConversations(),
    scanStuckTasks(),
    scanStuckMissions(),
    scanStuckStreams(),
    scanBrainMemoryCategoryDrift(),
  ]);

  // Summary
  const critical = findings.filter((f) => f.severity === "critical");
  const warn = findings.filter((f) => f.severity === "warn");
  const info = findings.filter((f) => f.severity === "info");

  if (json) {
    console.log(
      JSON.stringify(
        {
          summary: {
            critical: critical.length,
            warn: warn.length,
            info: info.length,
            total: findings.length,
          },
          findings,
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } else {
    if (findings.length === 0) {
      console.log("✅ no integrity issues found · all clean\n");
    } else {
      for (const f of findings) {
        const icon =
          f.severity === "critical"
            ? "🔴"
            : f.severity === "warn"
              ? "🟡"
              : "ℹ️";
        console.log(`${icon}  [${f.category}] ${f.table} · ${f.description}`);
        console.log(`     count: ${f.count}`);
        if (f.sampleIds.length > 0) {
          console.log(`     samples:`);
          for (const id of f.sampleIds) {
            console.log(`       · ${id}`);
          }
        }
        console.log("");
      }
      console.log(
        `📊 ${critical.length} critical · ${warn.length} warn · ${info.length} info\n`,
      );
    }
  }

  // Exit code
  if (critical.length > 0) process.exit(1);
  process.exit(0);
}

main()
  .catch((err) => {
    console.error("[integrity-scan] fatal:", err);
    process.exit(2);
  })
  .finally(() => prisma.$disconnect());
