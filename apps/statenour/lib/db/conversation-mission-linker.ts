import { createHash } from "node:crypto";

import { prisma as defaultPrisma } from "@/lib/prisma";
import { padToVectorDim } from "@/lib/db/pgvector";
import { LINKER_EMBED_PER_RUN } from "@/lib/missions/mission-chats-limits";
import { GOAL_EMBED_SOURCE_TYPE, SUGGEST_GOAL_MAX_GOALS, goalEmbedText } from "@/lib/missions/goal-embedding";

type PrismaLike = typeof defaultPrisma;

export { LINKER_EMBED_PER_RUN };
/** W8c · user messages (oldest first) that join a chat's title and summary in its embedding text. */
export const LINKER_FIRST_USER_MESSAGES = 5;
/** Characters kept from each of those messages, so one pasted wall of text cannot fill the whole embedding. */
const LINKER_MESSAGE_CHARS = 600;
/** The embedding text cap the mission side has always used. */
const EMBED_TEXT_MAX = 4000;

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
  /** W8c · active goals embedded (sourceType life_goal) for the mission goal suggestion; same text never twice. */
  goalEmbeddingsCreated: number;
  alreadyLinked: number;
  /** W8c · chats embedded this run (no vector before, or a vector of different text from another model). */
  embedded: number;
  /** W8c · chats whose embed call came back empty; nothing stored, tried again next run. */
  embedFailed: number;
  autoLinked: number;
  queuedForReview: number;
  belowReviewThreshold: number;
  /** Chats with no vector left for a later run (past LINKER_EMBED_PER_RUN, or a dry run). */
  skippedNoEmbedding: number;
  /** W8c · chats whose only vector is from a different model than the missions': never scored across models. */
  skippedOtherSpace: number;
  /** Work done, for cron_job_logs.resultCount: chats embedded + links written + review rows queued. */
  resultCount: number;
}

interface EmbeddingRow {
  id: string;
  sourceType: string;
  sourceId: string;
  embedding: string;
  model: string | null;
  contentFingerprint: string | null;
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

/** One stored vector: its row, the model (embedding space) that made it and the fingerprint of its text. */
interface Stored {
  id: string;
  vec: number[];
  model: string | null;
  fingerprint: string | null;
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

/** The text identity of an embedding (vector_embeddings.contentFingerprint): same text, same fingerprint. */
export function contentFingerprintOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** What a chat is embedded from: its title, its pinned summary when it has one, and its first user messages. */
export function conversationEmbedText(
  conversation: { title: string | null; pinnedSummary: string | null },
  userMessages: string[],
): string {
  return [conversation.title?.trim(), conversation.pinnedSummary?.trim(), ...userMessages.map((m) => m.trim().slice(0, LINKER_MESSAGE_CHARS))]
    .filter(Boolean)
    .join("\n")
    .slice(0, EMBED_TEXT_MAX);
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
    .slice(0, EMBED_TEXT_MAX);
}

function vectorLiteral(vec: number[]): string {
  // forensic-audit LOW · sanitize non-finite values (a single NaN/Infinity from
  // a malformed provider embedding otherwise produced 'NaN' in the SQL literal,
  // which Postgres rejects — aborting the whole mission-link backfill run).
  return `[${vec.map((n) => (Number.isFinite(n) ? Number(n).toPrecision(8) : "0")).join(",")}]`;
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

/**
 * Embed `text` with the provider's one embedder (getEmbeddingWithModel: the model it reports is the vector's space)
 * and store it with its fingerprint. An existing row for the source is UPDATED in place, so a source never gets a
 * second row. Returns null when the provider gave nothing; nothing is written then.
 */
async function embedAndStore(
  prisma: PrismaLike,
  sourceType: "mission" | "chat_conversation" | typeof GOAL_EMBED_SOURCE_TYPE,
  sourceId: string,
  text: string,
  existing: Stored | undefined,
): Promise<Stored | null> {
  const { getEmbeddingWithModel } = await import("@/lib/ai/provider");
  const { vec, model } = await getEmbeddingWithModel(text).catch(() => ({ vec: [] as number[], model: null }));
  if (vec.length === 0) return null;
  const fingerprint = contentFingerprintOf(text);
  const data = { content: text, embedding: JSON.stringify(vec), embedding_dim: vec.length, model, contentFingerprint: fingerprint };
  const row = existing
    ? await prisma.vectorEmbedding.update({ where: { id: existing.id }, data, select: { id: true } })
    : await prisma.vectorEmbedding.create({ data: { sourceType, sourceId, ...data }, select: { id: true } });
  await writeVectorColumns(prisma, row.id, vec);
  return { id: row.id, vec, model, fingerprint };
}

/**
 * Embed each scored mission whose stored vector is missing or was made from different text. Rows written before
 * W8c carry no fingerprint, so each is re-embedded once in the provider's current model (the 26 prod rows were
 * written by the retired venice-bge-m3 lane); after that a mission is re-embedded only when its text changes.
 */
async function ensureMissionEmbeddings(
  prisma: PrismaLike,
  missions: MissionRow[],
  stored: Map<string, Stored>,
  dryRun: boolean,
): Promise<number> {
  if (dryRun) return 0;
  let created = 0;
  for (const mission of missions) {
    const text = missionEmbeddingText(mission);
    if (text.length < 10) continue;
    const existing = stored.get(mission.id);
    if (existing && existing.fingerprint === contentFingerprintOf(text)) continue;
    const fresh = await embedAndStore(prisma, "mission", mission.id, text, existing);
    if (!fresh) continue;
    stored.set(mission.id, fresh);
    created++;
  }
  return created;
}

/** W8c · embed each active goal (title + why) whose stored vector is missing or of different text. */
async function ensureGoalEmbeddings(prisma: PrismaLike, stored: Map<string, Stored>, dryRun: boolean): Promise<number> {
  if (dryRun) return 0;
  const goals = await prisma.lifeGoal.findMany({
    where: { status: "active", deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take: SUGGEST_GOAL_MAX_GOALS,
    select: { id: true, title: true, why: true },
  });
  let created = 0;
  for (const goal of goals) {
    const text = goalEmbedText(goal);
    if (!text) continue;
    const existing = stored.get(goal.id);
    if (existing && existing.fingerprint === contentFingerprintOf(text)) continue;
    const fresh = await embedAndStore(prisma, GOAL_EMBED_SOURCE_TYPE, goal.id, text, existing);
    if (!fresh) continue;
    stored.set(goal.id, fresh);
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
  // W8c (2026-11-03) · venice is retired: vectors embedded from now on come from the provider's current model
  // (cohere first), whose distribution was never probed. These two numbers are kept, not re-tuned blind; re-run the
  // probe on the first night's same-model vectors before moving them.
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

  const embeddingRows: EmbeddingRow[] = await prisma.vectorEmbedding.findMany({
    where: { sourceType: { in: ["chat_conversation", "mission", GOAL_EMBED_SOURCE_TYPE] } },
    select: { id: true, sourceType: true, sourceId: true, embedding: true, model: true, contentFingerprint: true },
  });

  const conversationStored = new Map<string, Stored>();
  const missionStored = new Map<string, Stored>();
  const goalStored = new Map<string, Stored>();
  for (const row of embeddingRows) {
    const s: Stored = { id: row.id, vec: parseVector(row.embedding), model: row.model, fingerprint: row.contentFingerprint };
    if (row.sourceType === "chat_conversation") conversationStored.set(row.sourceId, s);
    if (row.sourceType === "mission") missionStored.set(row.sourceId, s);
    if (row.sourceType === GOAL_EMBED_SOURCE_TYPE) goalStored.set(row.sourceId, s);
  }

  const missionEmbeddingsCreated = await ensureMissionEmbeddings(prisma, missions, missionStored, dryRun);
  const goalEmbeddingsCreated = await ensureGoalEmbeddings(prisma, goalStored, dryRun);
  // A cosine across two embedding models is a plausible number, not a match: score only same-model pairs.
  const scorable = missions.flatMap((mission) => {
    const s = missionStored.get(mission.id);
    return s && s.vec.length > 0 && s.model ? [{ mission, vec: s.vec, model: s.model }] : [];
  });
  const missionSpaces = new Set(scorable.map((m) => m.model));

  const report: ConversationMissionLinkReport = {
    conversations: conversations.length,
    missions: missions.length,
    missionEmbeddingsCreated,
    goalEmbeddingsCreated,
    alreadyLinked: 0,
    embedded: 0,
    embedFailed: 0,
    autoLinked: 0,
    queuedForReview: 0,
    belowReviewThreshold: 0,
    skippedNoEmbedding: 0,
    skippedOtherSpace: 0,
    resultCount: 0,
  };

  let embedSlots = LINKER_EMBED_PER_RUN;
  for (const conversation of conversations) {
    if (conversation.mission_id) {
      report.alreadyLinked++;
      continue;
    }

    let stored = conversationStored.get(conversation.id);
    const usable = (s: Stored | undefined): s is Stored & { model: string } =>
      !!s && s.vec.length > 0 && !!s.model && missionSpaces.has(s.model);

    if (!usable(stored)) {
      if (dryRun || embedSlots <= 0) {
        report.skippedNoEmbedding++;
        continue;
      }
      embedSlots--;
      const messages = await prisma.chatMessage.findMany({
        where: { conversationId: conversation.id, role: "user" },
        orderBy: { createdAt: "asc" },
        take: LINKER_FIRST_USER_MESSAGES,
        select: { content: true },
      });
      const text = conversationEmbedText(conversation, messages.map((m) => m.content));
      if (!text) {
        report.skippedNoEmbedding++;
        continue;
      }
      // The same text was already embedded (in a model the missions are not in): never embed it twice.
      if (stored && stored.fingerprint === contentFingerprintOf(text)) {
        report.skippedOtherSpace++;
        continue;
      }
      const fresh = await embedAndStore(prisma, "chat_conversation", conversation.id, text, stored);
      if (!fresh) {
        report.embedFailed++;
        continue;
      }
      report.embedded++;
      stored = fresh;
      if (!usable(stored)) {
        report.skippedOtherSpace++;
        continue;
      }
    }

    const convVec = stored.vec;
    const space = stored.model;
    let best: { mission: MissionRow; score: number } | null = null;
    for (const candidate of scorable) {
      if (candidate.model !== space) continue;
      const score = cosineSimilarity(convVec, candidate.vec);
      if (!best || score > best.score) best = { mission: candidate.mission, score };
    }

    // A non-finite score (a NaN in a stored vector) is noise, never a review row.
    if (!best || !(best.score >= reviewThreshold)) {
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

  report.resultCount = report.embedded + report.autoLinked + report.queuedForReview;
  if (!dryRun) {
    console.info(
      `[conversation-mission-link] embedded ${report.embedded} (failed ${report.embedFailed}) · auto-linked ${report.autoLinked} · queued ${report.queuedForReview} · no vector ${report.skippedNoEmbedding} · other model ${report.skippedOtherSpace} · missions re-embedded ${report.missionEmbeddingsCreated}`,
    );
  }
  return report;
}
