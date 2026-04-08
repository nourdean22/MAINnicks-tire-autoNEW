/**
 * Chat-to-FAQ Pipeline — Weekly analysis of customer chat questions.
 *
 * Runs weekly (Sunday gate in briefings tier).
 * 1. Queries chat_sessions from the last 7 days
 * 2. Extracts user questions (messages where role="user" and content ends with "?")
 * 3. Groups by similarity (simple word overlap)
 * 4. Stores top 10 most-asked in nickMemory as type "pattern"
 * 5. Sends Telegram digest of top questions
 *
 * This feeds FAQ page improvement and reveals what customers actually care about.
 */

import { createLogger } from "../../lib/logger";

const log = createLogger("cron:chat-faq-pipeline");

/**
 * Extract questions from a messagesJson string.
 * Returns array of question strings from user messages.
 */
function extractUserQuestions(messagesJson: string): string[] {
  try {
    const messages = JSON.parse(messagesJson);
    if (!Array.isArray(messages)) return [];

    return messages
      .filter(
        (m: { role?: string; content?: string }) =>
          m.role === "user" &&
          typeof m.content === "string" &&
          m.content.trim().endsWith("?")
      )
      .map((m: { content: string }) => m.content.trim());
  } catch (e) {
    console.warn("[jobs/chatFaqPipeline] operation failed:", e);
    return [];
  }
}

/**
 * Compute simple word overlap similarity between two strings.
 * Returns 0-1 score.
 */
function wordOverlap(a: string, b: string): number {
  const stopWords = new Set([
    "i", "my", "me", "we", "our", "you", "your", "the", "a", "an",
    "is", "are", "was", "were", "be", "been", "do", "does", "did",
    "can", "could", "will", "would", "should", "have", "has", "had",
    "to", "of", "in", "for", "on", "with", "at", "by", "from",
    "it", "this", "that", "what", "how", "much", "many", "and", "or",
    "if", "but", "not", "no", "so", "up", "about", "just", "get",
  ]);

  const wordsA = new Set(
    a.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 2 && !stopWords.has(w))
  );
  const wordsB = new Set(
    b.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 2 && !stopWords.has(w))
  );

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }

  return overlap / Math.max(wordsA.size, wordsB.size);
}

interface QuestionCluster {
  representative: string;
  count: number;
  variants: string[];
}

/**
 * Cluster questions by word overlap similarity.
 * Uses a simple greedy clustering approach.
 */
function clusterQuestions(questions: string[], threshold = 0.4): QuestionCluster[] {
  const clusters: QuestionCluster[] = [];

  for (const q of questions) {
    // Skip very short questions (likely not useful)
    if (q.length < 10) continue;

    let merged = false;
    for (const cluster of clusters) {
      if (wordOverlap(q, cluster.representative) >= threshold) {
        cluster.count++;
        if (q.length > cluster.representative.length) {
          // Keep the more descriptive version as representative
          cluster.variants.push(cluster.representative);
          cluster.representative = q;
        } else {
          cluster.variants.push(q);
        }
        merged = true;
        break;
      }
    }

    if (!merged) {
      clusters.push({ representative: q, count: 1, variants: [] });
    }
  }

  // Sort by frequency, descending
  clusters.sort((a, b) => b.count - a.count);
  return clusters;
}

/**
 * Main cron handler — run weekly to analyze chat questions.
 */
export async function runChatFaqPipeline(): Promise<{
  recordsProcessed: number;
  details: string;
}> {
  try {
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0, details: "No DB" };

    // 1. Query chat sessions from the last 7 days
    const [rows] = await db.execute(sql`
      SELECT messagesJson
      FROM chat_sessions
      WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        AND messagesJson IS NOT NULL
    `);

    const sessions = rows as Array<{ messagesJson: string }>;
    if (!sessions || sessions.length === 0) {
      return { recordsProcessed: 0, details: "No chat sessions in last 7 days" };
    }

    // 2. Extract all user questions
    const allQuestions: string[] = [];
    for (const session of sessions) {
      const questions = extractUserQuestions(session.messagesJson);
      allQuestions.push(...questions);
    }

    if (allQuestions.length === 0) {
      return { recordsProcessed: sessions.length, details: `${sessions.length} sessions, no questions found` };
    }

    // 3. Cluster similar questions
    const clusters = clusterQuestions(allQuestions);
    const top10 = clusters.slice(0, 10);

    // 4. Store top questions in nickMemory as type "pattern"
    try {
      const { remember } = await import("../../services/nickMemory");
      for (const cluster of top10) {
        await remember({
          type: "pattern",
          content: `FAQ pattern (asked ${cluster.count}x this week): "${cluster.representative}"`,
          source: "chat_faq_pipeline",
          confidence: Math.min(0.5 + cluster.count * 0.1, 0.95),
        });
      }
    } catch (e) { console.warn("[jobs/chatFaqPipeline] operation failed:", e); }

    // 5. Send Telegram digest
    try {
      const { sendTelegram } = await import("../../services/telegram");
      const digest = top10
        .map((c, i) => `${i + 1}. "${c.representative}" (asked ${c.count} time${c.count > 1 ? "s" : ""})`)
        .join("\n");

      await sendTelegram(
        `📊 TOP CHAT QUESTIONS THIS WEEK\n` +
        `${sessions.length} sessions, ${allQuestions.length} questions\n\n` +
        digest +
        `\n\nUse this to improve FAQ page and train Nick AI.`
      );
    } catch (e) { console.warn("[jobs/chatFaqPipeline] operation failed:", e); }

    const details = `${sessions.length} sessions, ${allQuestions.length} questions, ${top10.length} clusters`;
    log.info(`Chat FAQ pipeline: ${details}`);
    return { recordsProcessed: allQuestions.length, details };
  } catch (err: any) {
    log.error("Chat FAQ pipeline failed:", { error: err.message });
    return { recordsProcessed: 0, details: `Failed: ${err.message}` };
  }
}
