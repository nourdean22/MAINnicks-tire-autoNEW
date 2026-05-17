/**
 * Probe the state of operator data archives.
 *
 * What's tagged · what's linked · what has embeddings · what's in
 * search index · age distribution. Output drives the backfill plan.
 *
 * Usage: node --env-file=.env.local scripts/probe-archive-state.mjs
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function pct(part, whole) {
  if (!whole) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

async function main() {
  // ── ChatConversation ──
  const totalConvos = await prisma.chatConversation.count({
    where: { archivedAt: null },
  });
  const convosNoTitle = await prisma.chatConversation.count({
    where: { archivedAt: null, OR: [{ title: null }, { title: "" }] },
  });
  const convosNoTopicTags = await prisma.chatConversation.count({
    where: { archivedAt: null, OR: [{ topicTags: { equals: [] } }, { topicTags: { equals: null } }] },
  });
  const convosNoSummary = await prisma.chatConversation.count({
    where: {
      archivedAt: null,
      OR: [{ pinnedSummary: null }, { pinnedSummary: "" }],
    },
  });
  const convosWithMessages = await prisma.chatConversation.count({
    where: { archivedAt: null, messageCount: { gt: 0 } },
  });
  const convosLinkedToMissionRaw = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM chat_conversations WHERE archived_at IS NULL AND mission_id IS NOT NULL`,
  );
  const convosLinkedToMission = convosLinkedToMissionRaw[0]?.n ?? 0;

  console.log("\n=== ChatConversation ===");
  console.log(`  total active: ${totalConvos}`);
  console.log(`  with messages: ${convosWithMessages}`);
  console.log(`  missing title: ${convosNoTitle} (${pct(convosNoTitle, totalConvos)})`);
  console.log(`  missing topicTags: ${convosNoTopicTags} (${pct(convosNoTopicTags, totalConvos)})`);
  console.log(`  missing pinnedSummary: ${convosNoSummary} (${pct(convosNoSummary, totalConvos)})`);
  console.log(`  linked to mission: ${convosLinkedToMission} (${pct(convosLinkedToMission, totalConvos)})`);

  // ── ChatMessage ──
  const totalMessages = await prisma.chatMessage.count();
  console.log(`\n=== ChatMessage ===`);
  console.log(`  total: ${totalMessages}`);

  // ── BrainMemory (embedding coverage) ──
  const totalMemories = await prisma.brainMemory.count({
    where: { deletedAt: null },
  });
  // pgvector embedding_vec — count rows where embedding is NULL via raw SQL
  // VectorEmbedding is the side table — links by entityId/entityType
  // back to whatever was embedded.
  const totalEmbeddings = await prisma.vectorEmbedding.count();
  const memoryEmbeddings = await prisma.vectorEmbedding.count({
    where: { sourceType: "brain_memory" },
  });
  const conversationEmbeddings = await prisma.vectorEmbedding.count({
    where: { sourceType: "chat_conversation" },
  });
  const messageEmbeddings = await prisma.vectorEmbedding.count({
    where: { sourceType: "chat_message" },
  });
  console.log(`\n=== BrainMemory ===`);
  console.log(`  total active: ${totalMemories}`);
  console.log(`  with embedding row: ${memoryEmbeddings} (${pct(memoryEmbeddings, totalMemories)})`);
  console.log(`  missing embedding: ${totalMemories - memoryEmbeddings} (${pct(totalMemories - memoryEmbeddings, totalMemories)})`);

  console.log(`\n=== VectorEmbedding (cross-entity) ===`);
  console.log(`  total: ${totalEmbeddings}`);
  console.log(`  brain_memory:        ${memoryEmbeddings}`);
  console.log(`  chat_conversation:   ${conversationEmbeddings}`);
  console.log(`  chat_message:        ${messageEmbeddings}`);
  console.log(`  conversations missing embedding: ${totalConvos - conversationEmbeddings} (${pct(totalConvos - conversationEmbeddings, totalConvos)})`);
  console.log(`  messages missing embedding: ${totalMessages - messageEmbeddings} (${pct(totalMessages - messageEmbeddings, totalMessages)})`);

  // ── Mission / Task linkage ──
  const totalMissions = await prisma.mission.count({ where: { deletedAt: null } });
  const totalTasks = await prisma.task.count({ where: { deletedAt: null } });
  const tasksUnlinkedRaw = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Task" WHERE deleted_at IS NULL AND "missionId" IS NULL`,
  );
  const tasksUnlinked = tasksUnlinkedRaw[0]?.n ?? 0;
  console.log(`\n=== Mission / Task ===`);
  console.log(`  active missions: ${totalMissions}`);
  console.log(`  active tasks: ${totalTasks}`);
  console.log(`  tasks not linked to a mission: ${tasksUnlinked} (${pct(tasksUnlinked, totalTasks)})`);

  // ── Decisions ──
  const totalDecisions = await prisma.masteryDecision.count({
    where: { deletedAt: null },
  });
  const decisionMissionColumns = await prisma.$queryRawUnsafe(
    `SELECT column_name::text AS name FROM information_schema.columns WHERE table_name = 'mastery_decisions' AND column_name = 'mission_id'`,
  );
  console.log(`\n=== MasteryDecision ===`);
  console.log(`  total: ${totalDecisions}`);
  if (decisionMissionColumns.length > 0) {
    const decisionsNoMissionRaw = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM mastery_decisions WHERE deleted_at IS NULL AND mission_id IS NULL`,
    );
    const decisionsNoMission = decisionsNoMissionRaw[0]?.n ?? 0;
    console.log(`  not linked to mission: ${decisionsNoMission} (${pct(decisionsNoMission, totalDecisions)})`);
  } else {
    console.log(`  not linked to mission: n/a (mission_id column absent)`);
  }

  // ── Pins ──
  const totalPins = await prisma.brainMemory.count({
    where: { deletedAt: null, category: "pin" },
  });
  console.log(`\n=== BrainMemory pins ===`);
  console.log(`  total pins: ${totalPins}`);

  // ── AuditEvent volume ──
  const auditTotal = await prisma.auditEvent.count();
  const audit30d = await prisma.auditEvent.count({
    where: { createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } },
  });
  console.log(`\n=== AuditEvent ===`);
  console.log(`  total: ${auditTotal}`);
  console.log(`  last 30d: ${audit30d}`);

  // ── Age distribution of conversations (the backfill target) ──
  const ageBuckets = await prisma.$queryRawUnsafe(`
    SELECT
      CASE
        WHEN created_at >= NOW() - INTERVAL '7 days'  THEN '0-7d'
        WHEN created_at >= NOW() - INTERVAL '30 days' THEN '8-30d'
        WHEN created_at >= NOW() - INTERVAL '90 days' THEN '31-90d'
        ELSE '90d+'
      END AS bucket,
      COUNT(*)::int AS n
    FROM chat_conversations
    WHERE archived_at IS NULL
    GROUP BY bucket
    ORDER BY bucket
  `);
  console.log(`\n=== Conversation age distribution ===`);
  for (const b of ageBuckets) {
    console.log(`  ${b.bucket.padEnd(8)} · ${b.n}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
