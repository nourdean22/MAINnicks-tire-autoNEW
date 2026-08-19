/**
 * Knowledge Sync Engine — the automated version of the one-shot
 * backfill scripts in scripts/*.ts.
 *
 * Exports three pure functions that can run from either:
 *   • the `syncKnowledge` AI tool — Nick can call it on demand
 *   • a future event-bus handler — runs when data changes
 *
 * Each function is idempotent by design:
 *   • backfillRawBrainDumps — only touches BrainDumps with null
 *     extractedItems, and dedupes chat promotions by raw-text prefix
 *   • rebalanceTaskPriorities — retired Apr 18 (OpenLoop dead, Task
 *     contains "backfill" or "journal_", leaves user-entered alone,
 *     skips rows that are already in the correct priority
 *   • ingestNickWisdom — uses stable per-message memory keys so
 *     re-runs reinforce existing memories instead of duplicating
 *
 * NOTE: AI classification of raw BrainDumps is currently DISABLED.
 * The Venice provider that backed it has been retired and no
 * replacement is wired in, so extractFromText() returns null and
 * the classify stage no-ops (BrainDumps are promoted/stored but not
 * AI-classified). Wisdom indexing + chat promotion still run.
 */

import { prisma } from "@/lib/prisma";
import { priorityFromLabel } from "@/lib/scoring/task-priority";
import { brainMemory } from "@/lib/brain/memory-manager";
import { recordError } from "@/lib/errors/record-error";
import { logError } from "@/lib/utils/error-log";

// ─── Types ───

type ThoughtType =
  | "raw"
  | "thinking"
  | "reasoning"
  | "insight"
  | "decision"
  | "reflection"
  | "planning"
  | "venting";

interface Extraction {
  entryType: ThoughtType;
  summary: string;
  mood: string | null;
  domains: string[];
  linkedTopics: string[];
  actionItems: Array<{ title: string; priority: string; domain: string }>;
  insights: string[];
  commitments: string[];
  patterns: string | null;
  concerns: string[];
  wins: string[];
}

export interface KnowledgeSyncResult {
  backfill: {
    rawBrainDumps: number;
    classified: number;
    tasksCreated: number;
    insightsStored: number;
    commitmentsFound: number;
    chatPromoted: number;
    chatTasksCreated: number;
  };
  rebalance: {
    tasksScanned: number;
    tasksUpdated: number;
    before: Record<string, number>;
    after: Record<string, number>;
  };
  wisdom: {
    messagesScanned: number;
    memoriesStored: number;
  };
  durationMs: number;
}

// ─── AI extraction (shared between brain dumps and chat) ───

// Knowledge classification is DISABLED — the Venice provider that
// backed it was retired and no replacement is wired in (operator
// decision: no feature restore). This honestly no-ops rather than
// throwing or masquerading as a classification failure: callers
// treat null as "skip", so raw BrainDumps are left unclassified and
// no tasks/insights are fabricated from them.
async function extractFromText(
  _rawText: string,
  _source: string
): Promise<Extraction | null> {
  // No provider → no classification. Returning null tells callers to
  // skip applyExtraction(), so no tasks/insights/commitments are
  // fabricated from an unprocessed entry.
  return null;
}

async function applyExtraction(
  brainDumpId: string,
  extraction: Extraction,
  source: string,
  dateStr: string,
  rawText: string
) {
  let tasksCreated = 0;
  let insightsStored = 0;
  let commitmentsFound = 0;

  await prisma.brainDump.update({
    where: { id: brainDumpId },
    data: {
      summary: extraction.summary || null,
      moodBefore: extraction.mood,
      patterns: extraction.patterns,
      extractedItems: JSON.stringify({
        entryType: extraction.entryType,
        domains: extraction.domains,
        linkedTopics: extraction.linkedTopics,
        actionItems: extraction.actionItems,
        insights: extraction.insights,
        commitments: extraction.commitments,
        concerns: extraction.concerns,
        wins: extraction.wins,
      }),
    },
  });

  // Apr 18: OpenLoop retired → Task INBOX on m-inbox mission.
  // 2026-08-19: canonical polarity (higher = more urgent) — the old
  // inline 5/15/30/60 map was one of the two writers that made
  // autoPriority bipolar. See lib/scoring/task-priority.
  const priorityFor = (p?: string): number => priorityFromLabel(p);
  const mInboxExists = await prisma.mission
    .findUnique({ where: { id: "m-inbox" }, select: { id: true } })
    .catch((err) => {
      logError("brain.knowledge-sync", err, { fn: "applyExtraction.findMission" });
      return null;
    });
  if (mInboxExists) {
    for (const item of extraction.actionItems.slice(0, 8)) {
      if (typeof item.title === "string" && item.title.length > 3) {
        await prisma.task
          .create({
            data: {
              title: item.title.slice(0, 150),
              missionId: "m-inbox",
              status: "INBOX",
              nextPhysicalAction: item.title.slice(0, 150),
              effort: "M15",
              roiScore: 50,
              frictionScore: 50,
              energyRequired: "MEDIUM",
              context: "ANYWHERE",
              finishCondition: "done when complete",
              autoPriority: priorityFor(item.priority),
              autoPriorityExplanation: `from sync/${source} dump ${brainDumpId.slice(0, 8)} · ${dateStr} · ${rawText.slice(0, 90)}`,
              lastTouchedAt: new Date(),
            },
          })
          .catch((err) => {
            recordError("brain:knowledge-sync", err, { phase: "task-create", brainDumpId, source });
          });
        tasksCreated++;
      }
    }
  }

  for (const insight of extraction.insights.slice(0, 5)) {
    if (typeof insight === "string" && insight.length > 10) {
      await brainMemory.remember(
        "insight",
        `sync_insight_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        insight,
        "knowledge_sync_cron"
      );
      insightsStored++;
    }
  }

  for (const c of extraction.commitments.slice(0, 3)) {
    if (typeof c === "string" && c.length > 5) {
      await prisma.commitment
        .create({
          data: {
            dateMade: dateStr,
            description: c.slice(0, 200),
            toWhom: "self",
            status: "active",
          },
        })
        .catch((err) => {
          recordError("brain:knowledge-sync", err, { phase: "commitment-create", dateStr });
        });
      commitmentsFound++;
    }
  }

  for (const concern of extraction.concerns.slice(0, 3)) {
    if (typeof concern === "string" && concern.length > 10) {
      await brainMemory
        .remember(
          "concern",
          `sync_concern_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          concern,
          "knowledge_sync_cron"
        )
        .catch((err) => {
          recordError("brain:knowledge-sync", err, { phase: "remember-concern" });
        });
    }
  }

  for (const win of extraction.wins.slice(0, 3)) {
    if (typeof win === "string" && win.length > 5) {
      await brainMemory
        .remember(
          "win",
          `sync_win_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          win,
          "knowledge_sync_cron"
        )
        .catch((err) => {
          recordError("brain:knowledge-sync", err, { phase: "remember-win" });
        });
    }
  }

  if (tasksCreated > 0) {
    await prisma.brainDump.update({
      where: { id: brainDumpId },
      data: { actionsTaken: tasksCreated },
    });
  }

  return { tasksCreated, insightsStored, commitmentsFound };
}

// ─── Stage 1: Classify raw BrainDumps + promote new chat messages ───

async function backfillRawBrainDumps(): Promise<KnowledgeSyncResult["backfill"]> {
  const rawDumps = await prisma.brainDump.findMany({
    where: { extractedItems: null, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });

  let classified = 0;
  let tasksCreated = 0;
  let insightsStored = 0;
  let commitmentsFound = 0;

  for (const dump of rawDumps) {
    if ((dump.rawThoughts?.trim().length ?? 0) < 20) continue;
    const ext = await extractFromText(dump.rawThoughts, "braindump-sync");
    if (!ext) continue;
    const counts = await applyExtraction(
      dump.id,
      ext,
      "braindump-sync",
      dump.date,
      dump.rawThoughts
    );
    classified++;
    tasksCreated += counts.tasksCreated;
    insightsStored += counts.insightsStored;
    commitmentsFound += counts.commitmentsFound;
  }

  // Promote new substantial user chat messages → BrainDumps
  const userMsgs = await prisma.chatMessage.findMany({
    where: { role: "user" },
    orderBy: { createdAt: "desc" },
    select: { id: true, content: true, createdAt: true },
    take: 500,
  });

  const substantial = userMsgs.filter((m) => {
    const txt = (m.content || "").trim();
    if (txt.length < 50) return false;
    if (/^(hey|yo|hi|hello)\s/i.test(txt)) return false;
    if (/^\/[a-z]/i.test(txt)) return false;
    return true;
  });

  const existing = await prisma.brainDump.findMany({
    where: { deletedAt: null }, // v10.0.68
    select: { rawThoughts: true },
  });
  const existingPrefixes = new Set(
    existing.map((e) => (e.rawThoughts || "").trim().slice(0, 80))
  );

  const toPromote = substantial.filter((m) => {
    const prefix = (m.content || "").trim().slice(0, 80);
    return !existingPrefixes.has(prefix);
  });

  let chatPromoted = 0;
  let chatTasksCreated = 0;

  // Cap cron-mode promotion to 25 per run to keep the cron under the
  // 300s Vercel lambda timeout. The AI tool mode can raise this.
  for (const msg of toPromote.slice(0, 25)) {
    const dateStr = msg.createdAt.toISOString().slice(0, 10);
    const bd = await prisma.brainDump.create({
      data: {
        date: dateStr,
        rawThoughts: msg.content || "",
        moodBefore: null,
        actionsTaken: 0,
      },
    });
    const ext = await extractFromText(msg.content || "", "chat-sync");
    if (!ext) continue;
    const counts = await applyExtraction(
      bd.id,
      ext,
      "chat-sync",
      dateStr,
      msg.content || ""
    );
    chatPromoted++;
    chatTasksCreated += counts.tasksCreated;
    insightsStored += counts.insightsStored;
    commitmentsFound += counts.commitmentsFound;
  }

  return {
    rawBrainDumps: rawDumps.length,
    classified,
    tasksCreated,
    insightsStored,
    commitmentsFound,
    chatPromoted,
    chatTasksCreated,
  };
}

// ─── Stage 2: Rebalance task priorities ───

type Priority = "critical" | "high" | "medium" | "low";

function scorePriority(title: string, description: string | null): Priority {
  const text = `${title} ${description || ""}`.toLowerCase();
  if (/\b(someday|eventually|maybe|nice to have|long[- ]term)\b/.test(text)) return "low";
  if (/\b(today|tonight|now|asap|urgent|immediate|right now|blocking|deadline|by eod)\b/.test(text)) return "critical";
  if (/\$\d/.test(text) && /\b(lose|losing|at risk|due|owed|unpaid|refund|chargeback)\b/.test(text)) return "critical";
  if (/\btomorrow\b/.test(text)) return "critical";
  if (/\b(call|text|message|email|reply to|follow[- ]up|respond|contact)\b/.test(text)) return "high";
  if (/\b(this week|by (mon|tue|wed|thu|fri|sat|sun)|within \d+ days?)\b/.test(text)) return "high";
  if (/\b(customer|client|quote|estimate|invoice|payment|appointment|lead)\b/.test(text)) return "high";
  return "medium";
}

// Apr 18: rebalanceTaskPriorities retired. OpenLoop table no longer
// receives writes, and Task.autoPriority is set at create-time by the
// journal-ingest + sync-ingest paths (keyword → 5/15/30/60). The
// rebalance function was rescoring a backlog that no longer accumulates.
async function rebalanceTaskPriorities(): Promise<KnowledgeSyncResult["rebalance"]> {
  const empty: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  return { tasksScanned: 0, tasksUpdated: 0, before: { ...empty }, after: { ...empty } };
}

// ─── Stage 3: Ingest Nick wisdom (assistant chat messages) ───

function isWisdomWorthy(content: string): boolean {
  const txt = content.trim();
  if (txt.length < 80) return false;
  if (/^(nick unavailable|error|failed|sorry, i|i don't know|i cannot)/i.test(txt)) return false;
  if (/^(morning|hey|hi|hello|good)\s/i.test(txt) && txt.length < 150) return false;
  if (/^what\s.*\?$/i.test(txt) && txt.length < 100) return false;
  return true;
}

async function ingestNickWisdom(): Promise<KnowledgeSyncResult["wisdom"]> {
  const msgs = await prisma.chatMessage.findMany({
    where: { role: "assistant" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      content: true,
      createdAt: true,
      conversationId: true,
    },
    take: 300,
  });

  const worthy = msgs.filter((m) => isWisdomWorthy(m.content || ""));
  let stored = 0;
  let dupCount = 0;

  for (const msg of worthy) {
    const txt = (msg.content || "").trim();
    const dateStr = msg.createdAt.toISOString().slice(0, 10);
    const key = `nick_advice_${msg.id}`;
    const preview = txt.length > 1200 ? txt.slice(0, 1200) + "..." : txt;
    const summary = `Nick advice (${dateStr}): ${preview}`;
    try {
      await brainMemory.remember("nick_advice", key, summary, "wisdom_sync_cron", {
        messageId: msg.id,
        conversationId: msg.conversationId,
        date: dateStr,
      });
      stored++;
    } catch {
      // Stable key → duplicate, just skip
      dupCount++;
    }
  }
  
  if (dupCount > 0) {
    logError("brain.knowledge-sync", new Error(`${dupCount} duplicate wisdom syncs skipped`), { fn: "ingestNickWisdom" }, "warn");
  }

  return { messagesScanned: msgs.length, memoriesStored: stored };
}

// ─── Main entry ───

/**
 * Run the full knowledge sync pipeline. Safe to call from the
 * syncKnowledge AI tool or an event-bus handler. All three stages are
 * idempotent and individually resilient. AI classification is disabled
 * (no provider), so backfill returns zero classified; chat promotion,
 * rebalance, and wisdom indexing still run.
 */
export async function runKnowledgeSync(): Promise<KnowledgeSyncResult> {
  const t0 = Date.now();

  const backfill = await backfillRawBrainDumps();
  const rebalance = await rebalanceTaskPriorities();
  const wisdom = await ingestNickWisdom();

  const durationMs = Date.now() - t0;

  // Audit trail
  await prisma.auditEvent
    .create({
      data: {
        actor: "knowledge_sync",
        eventType: "knowledge_sync_ran",
        detail: `Sync: ${backfill.classified} BDs classified, ${backfill.chatPromoted} chat promoted, ${rebalance.tasksUpdated} tasks rebalanced, ${wisdom.memoriesStored} wisdom stored`,
        payload: { backfill, rebalance, wisdom, durationMs },
      },
    })
    .catch((err) => {
      recordError("brain:knowledge-sync", err, { phase: "audit-write", eventType: "knowledge_sync_ran" });
    });

  return { backfill, rebalance, wisdom, durationMs };
}
