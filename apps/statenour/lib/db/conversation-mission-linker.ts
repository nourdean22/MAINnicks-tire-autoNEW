import { prisma as defaultPrisma } from "@/lib/prisma";
import { padToVectorDim } from "@/lib/db/pgvector";

type PrismaLike = typeof defaultPrisma;

export interface ConversationMissionLinkOptions {
  prisma?: PrismaLike;
  dryRun?: boolean;
  autoThreshold?: number;
  reviewThreshold?: number;
  limit?: number;
}

export interface ConversationMissionLinkReport {
  conversations: number;
  missions: number;
  missionEmbeddingsCreated: number;
  alreadyLinked: number;
  autoLinked: number;
  queuedForReview: number;
  belowReviewThreshold: number;
  skippedNoEmbedding: number;
}

interface EmbeddingRow {
  sourceId: string;
  content: string;
  embedding: string;
}

interface ConversationRow {
  id: string;
  title: string | null;
  pinnedSummary: string | null;
  topicTags: unknown;
  mission_id: string | null;
}

interface MissionRow {
  id: string;
  title: string;
  domain: string;
  successMetric: string | null;
  weeklyReviewNote: string | null;
  planData: unknown;
  taskTitles: string[];
}

function parseVector(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === "number") : [];
  } catch {
    return [];
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return magA > 0 && magB > 0 ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
}

function topicTagsText(tags: unknown): string {
  if (!Array.isArray(tags)) return "";
  return tags.filter((tag) => typeof tag === "string").join(" ");
}

function planText(planData: unknown): string {
  if (!planData || typeof planData !== "object") return "";
  return JSON.stringify(planData).slice(0, 3000);
}

function missionEmbeddingText(mission: MissionRow): string {
  return [
    mission.title,
    mission.domain,
    mission.successMetric ?? "",
    mission.weeklyReviewNote ?? "",
    mission.taskTitles.join("\n"),
    planText(mission.planData),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4000);
}

function vectorLiteral(vec: number[]): string {
  return `[${vec.map((n) => Number(n).toPrecision(8)).join(",")}]`;
}

async function ensureConversationMissionColumn(prisma: PrismaLike): Promise<void> {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "chat_conversations" ADD COLUMN IF NOT EXISTS "mission_id" TEXT`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "chat_conversations_mission_id_idx" ON "chat_conversations"("mission_id")`,
  );
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chat_conversations_mission_id_fkey'
      ) THEN
        ALTER TABLE "chat_conversations"
          ADD CONSTRAINT "chat_conversations_mission_id_fkey"
          FOREIGN KEY ("mission_id") REFERENCES "Mission"("id")
          ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
    END $$;
  `);
}

async function writeVectorColumns(prisma: PrismaLike, id: string, vec: number[]): Promise<void> {
  const lit1024 = vectorLiteral(padToVectorDim(vec, 1024));
  const lit1536 = vectorLiteral(padToVectorDim(vec, 1536));
  await prisma.$executeRawUnsafe(
    `UPDATE vector_embeddings
     SET embedding_vec = '${lit1024}'::vector(1024),
         embedding_vec_1536 = '${lit1536}'::vector(1536)
     WHERE id = '${id.replace(/'/g, "''")}'`,
  );
}

async function ensureMissionEmbeddings(
  prisma: PrismaLike,
  missions: MissionRow[],
  existingMissionEmbeds: Map<string, number[]>,
  dryRun: boolean,
): Promise<number> {
  const missing = missions.filter((mission) => !existingMissionEmbeds.has(mission.id));
  if (dryRun || missing.length === 0) return 0;

  const { getEmbedding } = await import("@/lib/ai/provider");
  let created = 0;

  for (const mission of missing) {
    const text = missionEmbeddingText(mission);
    if (text.length < 10) continue;
    const vec = await getEmbedding(text).catch((): number[] => []);
    if (vec.length === 0) continue;

    const row = await prisma.vectorEmbedding.create({
      data: {
        sourceType: "mission",
        sourceId: mission.id,
        content: text.slice(0, 4000),
        embedding: JSON.stringify(vec),
        embedding_dim: vec.length,
        model: vec.length === 1024 ? "venice-bge-m3" : "text-embedding-3-small",
      },
      select: { id: true },
    });
    await writeVectorColumns(prisma, row.id, vec);
    existingMissionEmbeds.set(mission.id, vec);
    created++;
  }

  return created;
}

export async function runConversationMissionLinkBackfill(
  options: ConversationMissionLinkOptions = {},
): Promise<ConversationMissionLinkReport> {
  const prisma = options.prisma ?? defaultPrisma;
  const dryRun = options.dryRun ?? false;
  // v10.0.190 · thresholds calibrated on actual venice-bge-m3
  // distribution after the v10.0.189 run produced 0 auto-links.
  // Probe (scripts/probe-cosine-distribution.mjs) showed:
  //   p50=0.441 · p75=0.491 · p90=0.514 · max=0.658 (post-Inbox-filter)
  // Pre-fix defaults (0.75/0.55) presupposed a sentence-transformer
  // distribution; bge-m3 clusters lower for short/distilled
  // summaries. Tuning to the real numbers:
  //   autoThreshold  = 0.55  → auto-link genuine strong matches
  //   reviewThreshold = 0.45  → queue medium matches for review
  //   below 0.45 = noise floor (don't pollute review queue)
  const autoThreshold = options.autoThreshold ?? 0.55;
  const reviewThreshold = options.reviewThreshold ?? 0.45;

  await ensureConversationMissionColumn(prisma);

  const conversations = await prisma.$queryRawUnsafe<ConversationRow[]>(`
    SELECT id, title, pinned_summary AS "pinnedSummary", topic_tags AS "topicTags", mission_id
    FROM chat_conversations
    WHERE archived_at IS NULL
    ORDER BY COALESCE(last_active_at, updated_at, created_at) DESC
    ${options.limit ? `LIMIT ${Math.max(1, Math.floor(options.limit))}` : ""}
  `);

  // v10.0.190 · skip Inbox missions. Inbox is the catch-all
  // destination for unsorted tasks — its embedding is so generic it
  // pulls EVERY conversation toward it, poisoning the linker. Live
  // probe (scripts/probe-cosine-distribution.mjs) confirmed: every
  // top match in the v10.0.189 run was Inbox. Excluding here lets
  // real project missions win and makes the cosine threshold
  // meaningful again. Mirrors lib/services/mission-helpers.ts:
  // isInboxMission(title) which checks /^\s*inbox(\s*-\s*[a-z]+)?\s*$/i
  const missions = await prisma.$queryRawUnsafe<MissionRow[]>(`
    SELECT
      m.id,
      m.title,
      m.domain::text AS domain,
      m."successMetric" AS "successMetric",
      m."weeklyReviewNote" AS "weeklyReviewNote",
      m."planData" AS "planData",
      COALESCE(array_agg(t.title ORDER BY t."updatedAt" DESC) FILTER (WHERE t.id IS NOT NULL), ARRAY[]::text[]) AS "taskTitles"
    FROM "Mission" m
    LEFT JOIN "Task" t ON t."missionId" = m.id AND t.deleted_at IS NULL
    WHERE m.deleted_at IS NULL
      AND m.status = 'ACTIVE'
      AND m.title !~* '^\\s*inbox(\\s*-\\s*[a-z]+)?\\s*$'
    GROUP BY m.id
    ORDER BY m.priority DESC, m."updatedAt" DESC
  `);

  const embeddingRows = await prisma.vectorEmbedding.findMany({
    where: { sourceType: { in: ["chat_conversation", "mission"] } },
    select: { sourceType: true, sourceId: true, content: true, embedding: true },
  });

  const conversationEmbeds = new Map<string, number[]>();
  const missionEmbeds = new Map<string, number[]>();
  for (const row of embeddingRows) {
    const vec = parseVector(row.embedding);
    if (vec.length === 0) continue;
    if (row.sourceType === "chat_conversation") conversationEmbeds.set(row.sourceId, vec);
    if (row.sourceType === "mission") missionEmbeds.set(row.sourceId, vec);
  }

  const missionEmbeddingsCreated = await ensureMissionEmbeddings(
    prisma,
    missions,
    missionEmbeds,
    dryRun,
  );

  const report: ConversationMissionLinkReport = {
    conversations: conversations.length,
    missions: missions.length,
    missionEmbeddingsCreated,
    alreadyLinked: 0,
    autoLinked: 0,
    queuedForReview: 0,
    belowReviewThreshold: 0,
    skippedNoEmbedding: 0,
  };

  for (const conversation of conversations) {
    if (conversation.mission_id) {
      report.alreadyLinked++;
      continue;
    }

    const convVec = conversationEmbeds.get(conversation.id);
    if (!convVec) {
      report.skippedNoEmbedding++;
      continue;
    }

    let best: { mission: MissionRow; score: number } | null = null;
    for (const mission of missions) {
      const missionVec = missionEmbeds.get(mission.id);
      if (!missionVec) continue;
      const score = cosineSimilarity(convVec, missionVec);
      if (!best || score > best.score) best = { mission, score };
    }

    if (!best || best.score < reviewThreshold) {
      report.belowReviewThreshold++;
      continue;
    }

    if (best.score >= autoThreshold) {
      if (!dryRun) {
        await prisma.$executeRawUnsafe(
          `UPDATE chat_conversations SET mission_id = '${best.mission.id.replace(/'/g, "''")}' WHERE id = '${conversation.id.replace(/'/g, "''")}' AND mission_id IS NULL`,
        );
      }
      report.autoLinked++;
      continue;
    }

    if (!dryRun) {
      await prisma.brainMemory.upsert({
        where: {
          category_key: {
            category: "conversation_mission_link_review",
            key: `${conversation.id}:${best.mission.id}`,
          },
        },
        create: {
          category: "conversation_mission_link_review",
          key: `${conversation.id}:${best.mission.id}`,
          content: `Review chat-to-mission link: "${conversation.title ?? conversation.id}" -> "${best.mission.title}" (${best.score.toFixed(3)} cosine)`,
          confidence: best.score,
          source: "cron:conversation-mission-link",
          metadata: {
            conversationId: conversation.id,
            missionId: best.mission.id,
            similarity: best.score,
            conversationTitle: conversation.title,
            missionTitle: best.mission.title,
            pinnedSummary: conversation.pinnedSummary,
            topicTags: topicTagsText(conversation.topicTags),
          },
          createdBy: "cron:conversation-mission-link",
        },
        update: {
          confidence: best.score,
          lastSeen: new Date(),
          seenCount: { increment: 1 },
          metadata: {
            conversationId: conversation.id,
            missionId: best.mission.id,
            similarity: best.score,
            conversationTitle: conversation.title,
            missionTitle: best.mission.title,
            pinnedSummary: conversation.pinnedSummary,
            topicTags: topicTagsText(conversation.topicTags),
          },
        },
      });
    }
    report.queuedForReview++;
  }

  return report;
}
