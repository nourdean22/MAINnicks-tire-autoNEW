/**
 * Journal Ingestion Pipeline
 *
 * Processes raw journal text (from Telegram, chat, or manual input) into:
 * 1. BrainDump record (raw storage + AI-extracted structure)
 * 2. Task INBOX entries (action items extracted by AI → m-inbox mission)
 * 3. Brain memories (insights, patterns, emotional state)
 * 4. Commitments (promises detected in text)
 *
 * This is what makes the journal "alive" — every thought Nour captures
 * gets processed, organized, and fed back into the system.
 */

import { prisma } from "@/lib/prisma";
import { emitBrainDumpFinalized } from "@/lib/db/brain-bus-emit";
import { recordError } from "@/lib/errors/record-error";
// v10.0.529.99 · Wave 43 · brain-dump → task creation routes through
// canonical service (was raw prisma.task.create) for audit + cache
// invalidation + priority sync + sibling goalId inheritance.
import { createTask } from "@/lib/services/tasks";
import { resolveInboxMissionId } from "@/lib/services/missions";
// v10.0.64 · AgentTrace coverage · source="journal" (journal pipeline, not brain cycle).
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
const aiChat = makeTracedAiChat("journal-ingest", "journal");
import { brainMemory } from "@/lib/brain/memory-manager";
import { today } from "@/lib/utils/datetime";
import { sendTelegram } from "@/lib/services/telegram";
import { storeGenericEmbedding } from "@/lib/brain/embedding-utils";
import { creditFromSignal } from "@/lib/mastery/credit-signal";
import { getJournalSettings } from "@/lib/journal/settings";
import { enrichJournalEntry } from "@/lib/brain/journal-brain";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain/journal-ingest");
import { sanitizeForPrompt } from "@/lib/ai/prompt/sanitize";
import { extractJsonObject } from "@/lib/ai/extract-structured";
import { logError } from "@/lib/utils/error-log";

// v9.1.24 · journal-ingest sanitization. Telegram messages are HTML-
// parse-mode and can contain unescaped <, >, & + emoji + control
// characters. The raw text was previously fed straight into task
// titles and brain memory writes. Now it goes through the v9.1.13
// prompt sanitizer (which strips structural markdown tokens like
// ## headings, role-flips, and triple-backticks). Same defense as
// the prompt builder — operator-input fields shouldn't be able to
// inject structural prompt content downstream.

/**
 * Thought type classification assigned by the AI extractor. Lets the
 * /journal page filter and sort by the kind of thinking captured,
 * not just by timestamp. Stored inside extractedItems JSON so no
 * schema migration is needed for backward compatibility.
 */
export type ThoughtType =
  | "raw"         // unstructured venting / brain dump
  | "thinking"    // open exploration of an idea
  | "reasoning"   // weighing trade-offs toward a decision
  | "insight"     // something realized / pattern recognized
  | "decision"    // a choice made or intent committed
  | "reflection"  // looking back on an event / day / outcome
  | "planning"    // organizing what to do next
  | "venting";    // emotional release, low-actionability

interface JournalResult {
  brainDumpId: string;
  entryType: ThoughtType;
  tasksCreated: number;
  insightsStored: number;
  commitmentsFound: number;
  summary: string;
}

// ─── v10.0.232 · entryType-based extraction gates ──────────────────
// Each extraction kind only fires when the AI's classified entryType
// is plausible for that signal. This is defense-in-depth on top of
// the looksLikeBrainDump gate at the chat layer · together they stop
// questions/observations from polluting the operator's task list,
// commitment ledger, insight library, etc.
//
// The lists are deliberately tight. False negatives (missing an
// extraction) are recoverable; false positives (phantom data) are
// what the operator complained about.

/** Tasks · only when the entry plans or decides something. */
export const TASK_CREATING_TYPES: ThoughtType[] = ["planning", "decision"];

/** Commitments · `Commitment` table writes — same gate as tasks
 *  PLUS we let `decision` through (a decision often implies a
 *  commitment). Pre-fix this was wide open and produced 29 zombie
 *  commitments in the Apr 21 sweep. */
export const COMMITMENT_CREATING_TYPES: ThoughtType[] = ["decision", "planning"];

/** Insights · only realizations / reflections / decisions count.
 *  Skip raw / thinking / venting — those produce noisy "insights"
 *  that aren't really insights. */
export const INSIGHT_CREATING_TYPES: ThoughtType[] = [
  "insight", "reflection", "decision", "planning", "reasoning",
];

/** Wins · accomplishments belong with reflection / planning / decision.
 *  Skip raw / thinking / venting — over-extracts from passing mentions. */
export const WIN_CREATING_TYPES: ThoughtType[] = [
  "reflection", "decision", "planning",
];

/** Concerns · drift signals. Skip raw — too noisy. Allow thinking
 *  / reasoning / venting / decision / planning since these are where
 *  real concerns surface. */
export const CONCERN_CREATING_TYPES: ThoughtType[] = [
  "thinking", "reasoning", "venting", "decision", "planning", "reflection",
];

/** Mood · valid value allowlist. The AI sometimes returns weird
 *  free-form strings ("contemplative-with-a-hint-of-frustration");
 *  we only persist ones that fit the trained vocabulary so the
 *  emotional-arc tracker doesn't drift. */
export const VALID_MOODS = new Set([
  "calm", "stressed", "motivated", "frustrated", "scattered",
  "focused", "tired", "energized", "anxious", "reflective",
  "happy", "sad", "neutral", "excited", "confident", "discouraged",
]);

/** v10.0.232 · cheap deterministic hash for dedupe keys + Telegram
 *  alert fingerprinting. Not cryptographic — just stable across calls.
 *  djb2 variant; output base36 for compact memory keys. */
export function simpleHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  // Force unsigned 32-bit and base36
  return (h >>> 0).toString(36);
}

/**
 * Ingest a journal entry — the main pipeline.
 * Takes raw text, processes it through AI, and updates the entire system.
 */
export async function ingestJournal(
  rawText: string,
  source: "telegram" | "chat" | "manual" = "telegram",
  // entryTypeHint · journal-advancement item B (2026-06-10) · the capture
  // modal's mode picker passes the operator's declared entry kind. The
  // operator is ground truth about WHAT KIND of entry they wrote, so the
  // hint wins over the blind fast classification. The async enrichment
  // pass may still refine it grounded-in-goals later (acceptable — mode-
  // shaped text re-classifies consistently in practice).
  // reuseDumpId · audit 2026-07-15 · execute-actions' commit_journal
  // re-processes an EXISTING brain_dump. Pre-fix it re-ingested the raw
  // text, creating a duplicate row per run (the summary/extraction landed
  // on the new row, so the caller's summary-based idempotency guard never
  // tripped). When set, the pipeline updates the given row in place
  // instead of creating one, and skips the 90s duplicate window (an
  // explicit re-process is not a double-tap).
  opts: { creditXp?: boolean; entryTypeHint?: ThoughtType; reuseDumpId?: string } = {},
): Promise<JournalResult> {
  const dateStr = today();
  let tasksCreated = 0;
  let insightsStored = 0;
  let commitmentsFound = 0;
  let summary = "";
  let entryType: ThoughtType = opts.entryTypeHint ?? "raw";

  // v10.0.529.25 · /journal audit #4b · rawThoughts dedup window.
  // Pre-fix the rate-limit allowed 10 req/min/IP, so a laggy phone
  // could send the SAME text twice with a 6+s gap and both would
  // pass — creating two BrainDump rows + two AI extractions + two
  // sets of tasks/insights/commitments. The capture route's #4a
  // rate-limit closed double-taps inside the rate window; #4b
  // closes the gap above it. Strategy: fetch today's recent dumps
  // (last 90s, bounded by indexed date column) and compare hashes
  // in JS. If we find a hash collision we return the existing row's
  // outcome instead of duplicating the pipeline. No new column, no
  // migration · YAGNI · operator can extend the window later if
  // duplicates still leak through.
  const NINETY_SECONDS_AGO = new Date(Date.now() - 90_000);
  const currentTextHash = simpleHash(rawText);
  const recentSameDay = opts.reuseDumpId
    ? []
    : await prisma.brainDump
        .findMany({
      where: {
        date: dateStr,
        createdAt: { gte: NINETY_SECONDS_AGO },
      },
      // Only the fields needed for hash check + result reconstruction.
      // Keeps the wire size tiny when the operator hasn't been writing
      // recently (the common case · 0 rows returned).
      select: { id: true, rawThoughts: true, summary: true, actionsTaken: true, extractedItems: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    })
    .catch((): never[] => []);
  const duplicate = recentSameDay.find(
    (row) => simpleHash(row.rawThoughts) === currentTextHash && row.rawThoughts === rawText,
  );
  if (duplicate) {
    log.info("journal_ingest_dedup_hit", {
      brainDumpId: duplicate.id,
      textHash: currentTextHash,
      source,
      textLength: rawText.length,
    });
    // Reconstruct a JournalResult from the existing row · keeps the
    // caller's contract intact. extractedItems is JSON-stringified
    // by the pipeline · best-effort parse for the entryType + counts.
    let dedupEntryType: ThoughtType = "raw";
    let dedupInsightCount = 0;
    let dedupCommitmentCount = 0;
    try {
      if (duplicate.extractedItems) {
        const parsed = JSON.parse(duplicate.extractedItems) as {
          entryType?: ThoughtType;
          insights?: unknown[];
          commitments?: unknown[];
        };
        if (parsed.entryType) dedupEntryType = parsed.entryType;
        if (Array.isArray(parsed.insights)) dedupInsightCount = parsed.insights.length;
        if (Array.isArray(parsed.commitments)) dedupCommitmentCount = parsed.commitments.length;
      }
    } catch (err) {
      // Stored JSON may be corrupted on legacy rows · degrade silently
      // to defaults · operator still gets a sane "deduped, see prior"
      // outcome rather than a thrown error.
      logError("brain.journal-ingest", err, { fn: "ingestJournal.parse" });
    }
    return {
      brainDumpId: duplicate.id,
      entryType: dedupEntryType,
      tasksCreated: duplicate.actionsTaken,
      insightsStored: dedupInsightCount,
      commitmentsFound: dedupCommitmentCount,
      summary: duplicate.summary ?? "Duplicate submit deduped · prior entry returned.",
    };
  }

  // 1. Store the raw brain dump immediately (never lose raw thoughts).
  // In reuse mode, touch the existing row instead — every downstream
  // write keys off brainDump.id, so extraction/summary/tasks land on
  // the ORIGINAL row (no duplicate). update() throws if the row is
  // gone; callers already handle that as a failed commit.
  const brainDump = opts.reuseDumpId
    ? await prisma.brainDump.update({
        where: { id: opts.reuseDumpId },
        data: { rawThoughts: rawText },
        select: { id: true },
      })
    : await prisma.brainDump.create({
        data: {
          date: dateStr,
          rawThoughts: rawText,
          moodBefore: null,
          actionsTaken: 0,
        },
      });

  // 2. AI extraction — pull structure from the raw text
  try {
    const extraction = await aiChat(
      [
        {
          role: "system",
          content: `You are Nick's journal processing engine. Extract actionable intelligence from Nour's journal entry.

Return ONLY valid JSON with this structure:
{
  "entryType": "raw|thinking|reasoning|insight|decision|reflection|planning|venting",
  "summary": "2-3 sentence summary IN FIRST PERSON, in Nour's own voice ('I ...') — never third person, never 'Nour is ...'. This renders as HIS journal entry title.",
  "mood": "one word: calm|stressed|motivated|frustrated|scattered|focused|tired|energized|anxious|reflective",
  "domains": ["business|health|personal|finance|relationship|mastery"],
  "actionItems": [{"title": "specific task", "priority": "critical|high|medium|low", "domain": "business|health|personal|system|finance"}],
  "insights": ["non-obvious patterns or realizations worth remembering"],
  "commitments": ["any promises or decisions Nour made"],
  "patterns": "any recurring themes or behaviors you notice (or null)",
  "concerns": ["worries or risks mentioned"],
  "wins": ["positive things mentioned, accomplishments"],
  "linkedTopics": ["tasks, people, missions, or events this connects to"]
}

Thought-type classification rules (assign ONE):
- "raw"        — scattered venting or unstructured thought (default when unsure)
- "thinking"   — exploring an idea in the open, not yet converging
- "reasoning"  — weighing options or trade-offs toward a decision
- "insight"    — a pattern recognized, something Nour just figured out
- "decision"   — an explicit choice or commitment being made
- "reflection" — looking back on an event, day, or outcome
- "planning"   — laying out what to do next
- "venting"    — emotional release with low actionable content

Other rules:
- Action items must be SPECIFIC and actionable (not vague)
- Domain "business" = anything about Nick's Tire, Auto Labor Guide, customers, revenue
- If Nour mentions a deadline or time, include it in the task title
- Extract ALL action items, even implied ones
- "insights" are things worth remembering long-term
- "linkedTopics" = short tags/names of tasks, people, customers, or missions referenced (max 6)
- Be thorough — miss nothing actionable`,
        },
        {
          role: "user",
          content: `Journal entry (${source}, ${new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York" })}):

${rawText}`,
        },
      ],
      "fast"
    );

    // v10.0.227 · use the shared extractJsonObject helper instead of
    // a regex+JSON.parse. Pre-fix every chat / Telegram / voice
    // capture went through this code path; if the AI returned a
    // trailing comma or single-quoted key (common with deepseek +
    // qwen) the regex matched but JSON.parse threw, killing the
    // whole ingest mid-flow. The helper does a 3-pass extract +
    // repair so a wobbly response still gets parsed.
    // The AI is asked to return a structured object but historically
    // returns commitments as either string[] OR objects · keep both
    // shapes typed as unknown[] so the existing runtime guards
    // (typeof / Array.isArray) still narrow the value safely.
    const parsed = extractJsonObject<{
      summary?: string;
      entryType?: string;
      mood?: string;
      patterns?: string;
      domains?: unknown;
      linkedTopics?: unknown;
      actionItems?: Array<{ title?: string; priority?: string; deadline?: string }>;
      insights?: unknown[];
      commitments?: unknown[];
      concerns?: unknown[];
      wins?: unknown[];
    }>(extraction.content);
    if (parsed.ok) {
      const data = parsed.value;
      if (parsed.via !== "direct") {
        log.info("journal_ingest_repaired", {
          brainDumpId: brainDump.id,
          via: parsed.via,
        });
      }

      summary = data.summary || "";

      // Validate the AI's entryType classification — fall back to "raw" if
      // the model hallucinates a type outside our enum.
      const VALID_TYPES: ThoughtType[] = [
        "raw",
        "thinking",
        "reasoning",
        "insight",
        "decision",
        "reflection",
        "planning",
        "venting",
      ];
      // Operator-declared mode (entryTypeHint) outranks the blind AI
      // classification — he chose what he was writing.
      entryType =
        opts.entryTypeHint ??
        (VALID_TYPES.includes(data.entryType as ThoughtType)
          ? (data.entryType as ThoughtType)
          : "raw");

      // Update brain dump with extracted data. The entryType, domains, and
      // linkedTopics all live inside extractedItems so no schema migration
      // is needed — the /journal page reads them from the JSON blob.
      await prisma.brainDump.update({
        where: { id: brainDump.id },
        data: {
          summary: data.summary || null,
          moodBefore: data.mood || null,
          patterns: data.patterns || null,
          extractedItems: JSON.stringify({
            entryType,
            // Capture origin · audit 2026-07-15 · brain_dumps has no
            // source column and origin previously lived only in the
            // AuditEvent payload. Persisting it here (no migration
            // needed) lets the feed/cleanup tooling distinguish
            // telegram/chat/manual after the fact. Column promotion is
            // a flagged follow-up via the hand-applied migration flow.
            source,
            domains: Array.isArray(data.domains) ? data.domains : [],
            linkedTopics: Array.isArray(data.linkedTopics) ? data.linkedTopics : [],
            actionItems: data.actionItems || [],
            insights: data.insights || [],
            commitments: data.commitments || [],
            concerns: data.concerns || [],
            wins: data.wins || [],
          }),
        },
      });

      // 3. Create Task INBOX entries from action items + alert on critical.
      // Apr 18: swapped OpenLoop → Task. Each inbox task carries the
      // journal's BrainDump id in autoPriorityExplanation so the UI can
      // trace a task back to the raw thought that spawned it. Tasks
      // attach to the "m-inbox" mission (created by the migration pass)
      // so the mission FK stays valid. If that mission is missing for
      // any reason, skip creation silently rather than corrupting the
      // ingest pipeline.
      //
      // v10.0.231 · entryType gate · pre-fix this loop unconditionally
      // wrote tasks for any actionItems[] the AI returned, even when
      // the entryType was 'thinking' / 'reasoning' / 'insight' / 'raw'.
      // v10.0.232 · uses the exported TASK_CREATING_TYPES allowlist
      // shared across all extraction sites for consistency.
      const shouldCreateTasks = TASK_CREATING_TYPES.includes(entryType);
      if (!shouldCreateTasks) {
        log.info("journal_ingest_skip_tasks", {
          brainDumpId: brainDump.id,
          entryType,
          actionItemCount: Array.isArray(data.actionItems) ? data.actionItems.length : 0,
          reason: "entryType not in TASK_CREATING_TYPES",
        });
      }
      // v10.0.529.99 · Wave 43 · use canonical inbox resolver + service.
      // Pre-Wave-43 hardcoded "m-inbox" + raw prisma.task.create.
      const inboxMissionId = await resolveInboxMissionId().catch(() => null);
      const priorityFor = (p?: string): "critical" | "high" | "medium" | "low" =>
        p === "critical" ? "critical" : p === "high" ? "high" : p === "low" ? "low" : "medium";
      const criticalItems: string[] = [];
      if (shouldCreateTasks && inboxMissionId && Array.isArray(data.actionItems)) {
        for (const item of data.actionItems.slice(0, 8)) {
          if (typeof item.title === "string" && item.title.length > 3) {
            // v9.1.24 · sanitize before write. Title is operator-input
            // (or AI-extracted from operator-input); strip structural
            // tokens to defend downstream prompts that include task
            // titles + the rawText snippet in the explanation field.
            const safeTitle = sanitizeForPrompt(item.title, 150);
            const priorityLabel = priorityFor(item.priority);
            const safeExplanation = `from journal/${source} dump ${brainDump.id.slice(0, 8)} · ${dateStr} · ${sanitizeForPrompt(rawText, 90)} · ai-priority=${priorityLabel}`;
            await createTask({
              title: safeTitle,
              missionId: inboxMissionId,
              status: "INBOX",
              nextPhysicalAction: safeTitle,
              effort: "M15",
              roiScore: 50,
              frictionScore: 50,
              energyRequired: "MEDIUM",
              context: "ANYWHERE",
              finishCondition: "done when complete",
              autoPriorityExplanation: safeExplanation,
            }).catch((err) => {
              recordError("brain:journal-ingest", err, { phase: "task-create", brainDumpId: brainDump.id, entryType });
            });
            tasksCreated++;
            if (item.priority === "critical" || item.priority === "high") {
              criticalItems.push(item.title);
            }
          }
        }
      }

      // v10.0.232 · Telegram alert dedupe · pre-fix every ingest with
      // critical items spammed Telegram regardless of whether we just
      // sent the same alert 3 minutes ago. Now: hash the items and
      // check the last-sent-hash brain memory; skip if identical and
      // sent within the last hour.
      if (criticalItems.length > 0) {
        const alertHash = simpleHash(criticalItems.join("|"));
        const dedupeKey = "journal_critical_alert_last_hash";
        const lastSent = await prisma.brainMemory
          .findUnique({ where: { category_key: { category: "system_dedupe", key: dedupeKey } } })
          .catch(() => null);
        const lastHashFresh =
          lastSent &&
          lastSent.content === alertHash &&
          Date.now() - lastSent.updatedAt.getTime() < 60 * 60_000;
        if (!lastHashFresh) {
          await sendTelegram(
            `🔥 <b>Critical Action Items from Journal</b>\n\n` +
            criticalItems.map((t, i) => `${i + 1}. ${t}`).join("\n") +
            `\n\nExtracted from ${source} entry. Landed in Task INBOX.`
          ).catch((err) => {
            recordError("brain:journal-ingest", err, { phase: "telegram-alert", brainDumpId: brainDump.id, count: criticalItems.length });
          });
          await prisma.brainMemory
            .upsert({
              where: { category_key: { category: "system_dedupe", key: dedupeKey } },
              create: { category: "system_dedupe", key: dedupeKey, content: alertHash, source: "journal_pipeline", confidence: 1.0 },
              update: { content: alertHash, updatedAt: new Date() },
            })
            .catch((err) => {
              recordError("brain:journal-ingest", err, { phase: "dedupe-upsert", brainDumpId: brainDump.id });
            });
        } else {
          log.info("journal_critical_alert_deduped", { brainDumpId: brainDump.id, count: criticalItems.length });
        }
      }

      // 4. Store insights as brain memories
      // v9.1.24 · sanitize + cap length on insight content.
      // v10.0.232 · entryType gate + within-call content dedupe (set
      // of normalized seen content prevents the AI from storing the
      // same insight twice when it accidentally repeats itself).
      if (INSIGHT_CREATING_TYPES.includes(entryType) && Array.isArray(data.insights)) {
        const seenInsights = new Set<string>();
        for (const insight of data.insights.slice(0, 5)) {
          if (typeof insight !== "string" || insight.length <= 10) continue;
          const norm = insight.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
          if (seenInsights.has(norm)) continue;
          seenInsights.add(norm);
          await brainMemory.remember(
            "insight",
            `journal_insight_${dateStr}_${simpleHash(norm).slice(0, 8)}`,
            sanitizeForPrompt(insight, 800),
            "journal_pipeline"
          );
          insightsStored++;
        }
      } else if (Array.isArray(data.insights) && data.insights.length > 0) {
        log.info("journal_ingest_skip_insights", {
          brainDumpId: brainDump.id,
          entryType,
          insightCount: data.insights.length,
          reason: "entryType not in INSIGHT_CREATING_TYPES",
        });
      }

      // 5. Store commitments
      // v10.0.232 · entryType gate (CRITICAL · pre-fix produced the
      // 29 zombie commitments referenced in pipeline-controller's
      // Apr 21 sweep). Also: dedupe within-call AND require minimum
      // 15 chars (was 5 — too permissive, captured fragments).
      if (COMMITMENT_CREATING_TYPES.includes(entryType) && Array.isArray(data.commitments)) {
        const seenCommitments = new Set<string>();
        for (const c of data.commitments.slice(0, 3)) {
          // AI returns either string OR object · normalize
          const description = typeof c === "string"
            ? c
            : (typeof c === "object" && c && "description" in c && typeof (c as { description?: unknown }).description === "string"
                ? (c as { description: string }).description
                : null);
          if (!description || description.length < 15) continue;
          const norm = description.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
          if (seenCommitments.has(norm)) continue;
          seenCommitments.add(norm);
          await prisma.commitment
            .create({
              data: {
                dateMade: dateStr,
                description: description.slice(0, 200),
                toWhom: "self",
                status: "active",
              },
            })
            .catch((err) => {
              recordError("brain:journal-ingest", err, { phase: "commitment-create", brainDumpId: brainDump.id });
            });
          commitmentsFound++;
        }
      } else if (Array.isArray(data.commitments) && data.commitments.length > 0) {
        log.info("journal_ingest_skip_commitments", {
          brainDumpId: brainDump.id,
          entryType,
          commitmentCount: data.commitments.length,
          reason: "entryType not in COMMITMENT_CREATING_TYPES",
        });
      }

      // 6. Store emotional state for drift detection
      // v10.0.232 · validate against VALID_MOODS allowlist · pre-fix
      // any free-form string from the AI got persisted, polluting the
      // emotional-arc tracker with values outside its understood
      // vocabulary. Now: only persist when mood is in the allowlist.
      if (data.mood && VALID_MOODS.has(data.mood.toLowerCase())) {
        await brainMemory.remember(
          "emotional_state",
          `journal_mood_${dateStr}_${new Date().getHours()}`,
          `Journal mood at ${new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York" })}: ${data.mood.toLowerCase()}. ${data.summary || ""}`,
          "journal_pipeline"
        );
      } else if (data.mood) {
        log.info("journal_ingest_skip_mood", {
          brainDumpId: brainDump.id,
          rejectedMood: data.mood.slice(0, 60),
          reason: "mood value not in VALID_MOODS allowlist",
        });
      }

      // 7. Store concerns as potential drift signals
      // v10.0.232 · entryType gate + within-call dedupe
      if (CONCERN_CREATING_TYPES.includes(entryType) && Array.isArray(data.concerns)) {
        const seenConcerns = new Set<string>();
        for (const concern of data.concerns.slice(0, 3)) {
          if (typeof concern !== "string" || concern.length <= 10) continue;
          const norm = concern.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
          if (seenConcerns.has(norm)) continue;
          seenConcerns.add(norm);
          await brainMemory.remember(
            "concern",
            `journal_concern_${dateStr}_${simpleHash(norm).slice(0, 8)}`,
            concern,
            "journal_pipeline"
          );
        }
      }

      // 8. Store wins for pattern tracking
      // v10.0.232 · entryType gate + within-call dedupe + min length 15
      if (WIN_CREATING_TYPES.includes(entryType) && Array.isArray(data.wins)) {
        const seenWins = new Set<string>();
        for (const win of data.wins.slice(0, 3)) {
          if (typeof win !== "string" || win.length < 15) continue;
          const norm = win.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
          if (seenWins.has(norm)) continue;
          seenWins.add(norm);
          await brainMemory.remember(
            "win",
            `journal_win_${dateStr}_${simpleHash(norm).slice(0, 8)}`,
            win,
            "journal_pipeline"
          );
        }
      }

      // v10.0.232 · Dania mention detector REMOVED per operator
      // direction. Pre-fix this section ran a substring/regex match
      // against rawText to flag every mention of "dania / wife /
      // marriage / date night" and write a `relationship` brain
      // memory with sentiment. Removing entirely · the relationship
      // signal can be derived from the AI's normal extraction (mood +
      // domains) without a hardcoded keyword detector.

      // Update brain dump with action count
      await prisma.brainDump.update({
        where: { id: brainDump.id },
        data: { actionsTaken: tasksCreated },
      });
    } else {
      // v10.0.227 · explicit parse-failure branch · pre-fix this was
      // a silent fall-through to "raw" entryType. Now we log the raw
      // snippet so /system/errors surfaces patterns when the model's
      // JSON output starts wobbling consistently.
      log.warn("journal_ingest_parse_failed", {
        brainDumpId: brainDump.id,
        rawSnippet: parsed.raw,
        error: parsed.error,
      });
      summary = "Journal stored — AI structured extraction unparseable.";
    }
  } catch (err) {
    logError("brain.journal-ingest", err, { fn: "ingestJournal.aiChat" });
    log.error("ai_extraction_failed", { error: err instanceof Error ? err.message : String(err) });
    summary = "Journal stored but AI extraction failed — raw thoughts saved.";
  }

  // 9. Audit trail
  await prisma.auditEvent
    .create({
      data: {
        actor: "journal_pipeline",
        eventType: "journal_ingested",
        detail: `Journal from ${source}: ${tasksCreated} tasks, ${insightsStored} insights, ${commitmentsFound} commitments`,
        payload: {
          brainDumpId: brainDump.id,
          source,
          tasksCreated,
          insightsStored,
          commitmentsFound,
          textLength: rawText.length,
        },
      },
    })
    .catch((err) => {
      recordError("brain:journal-ingest", err, { phase: "audit-write", brainDumpId: brainDump.id });
    });

  // v8.22 · Auto-embed journal text into pgvector. Fire-and-forget so
  // we don't gate the user-facing return on the embedding round-trip;
  // storeGenericEmbedding handles dual-write (JSON + embedding_vec) and
  // dedupes via existing-row lookup. This unlocks "when did I last
  // feel this way?" / "show me past entries about <topic>" semantic
  // queries without any new schema. Skip on tiny entries — too short
  // to embed meaningfully.
  if (rawText.trim().length >= 40) {
    void storeGenericEmbedding("brain_dump", brainDump.id, rawText).catch(
      (err) => log.warn("embed_failed", { brainDumpId: brainDump.id, error: err instanceof Error ? err.message : String(err) }),
    );
  }

  // v10.0.78 · brain-bus emit on finalized brain dump. Subscribers
  // (knowledge-sync, emotional-arc, search-grounding) react instead
  // of polling. Fire-and-forget; never blocks the primary write.
  // `extracted` flag tells subscribers whether the AI extraction
  // pipeline actually completed (false = AI extraction errored, raw
  // is still saved but no actionItems/insights extracted).
  void emitBrainDumpFinalized({
    brainDumpId: brainDump.id,
    date: dateStr,
    mode: source,
    extracted: tasksCreated > 0 || insightsStored > 0 || commitmentsFound > 0,
    rawChars: rawText.length,
  });

  // Phase D · ADR-0013 · journal pattern-radar auto-join hook.
  // Score the new entry against active thread centroids · sim ≥ 0.80
  // → silent auto-join · 0.65 ≤ sim < 0.80 → suggestion persisted for
  // operator confirmation. Fire-and-forget · capture never fails
  // because the radar is down. SituationLog / Reflection / DecisionReplay
  // writers can call the same helper when they're ready · today only
  // BrainDump is wired (the most-common capture path).
  void (async () => {
    const { tryJoinActiveThreads } = await import(
      "@/lib/services/journal-threads"
    );
    await tryJoinActiveThreads("brain_dump", brainDump.id, rawText);
  })().catch((err) => {
    // Convergence-safety (audit 2026-07-15) · this IIFE was the ONLY
    // fire-and-forget in the capture path with no .catch — a rejection
    // (e.g. import failure) surfaced as an unhandled promise rejection.
    log.warn("thread_join_failed", {
      brainDumpId: brainDump.id,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
  });

  // Journal Brain (2026-06-01) · baseline mastery XP for the capture path.
  // Pre-fix only structured Reflections fed XP (journal-reflect.ts) — the
  // dominant capture path (Telegram/chat/modal -> here) earned NOTHING, so
  // ~90% of journaling by volume was unscored. Credits via the same idempotent
  // door reflections use (the AI attributor picks the stat · returns null on
  // the noise floor). Gated by the JournalSettings quality floor (anti-gaming)
  // + the creditXp flag — createReflection passes false because it already
  // credited the same text under journal:<reflectionId>, so re-crediting here
  // would double-count. Distinct sourceKey journal-base:<id> stays collision-
  // free with the reflection + backfill keys. Fire-and-forget · never blocks.
  if (opts.creditXp !== false) {
    void (async () => {
      const settings = await getJournalSettings();
      if (
        settings.baselineEnabled &&
        rawText.trim().length >= settings.qualityFloorChars
      ) {
        await creditFromSignal("journal", {
          text: rawText,
          sourceKey: `journal-base:${brainDump.id}`,
        });
      }
    })().catch((err) =>
      log.warn("journal_baseline_xp_failed", {
        brainDumpId: brainDump.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  // Journal Brain (2026-06-01 · Phase 1) · async grounding/classify/link/score.
  // Fire-and-forget — capture returns now; enrichment runs a beat later and the
  // enrichedAt-null cron resweep retries if the process dies mid-pass. Runs for
  // EVERY brain_dump (independent of the baseline-XP creditXp guard above).
  void enrichJournalEntry("brain_dump", brainDump.id, rawText, {
    notifyTelegram: source === "telegram",
  }).catch((err) => {
    logError("brain.journal-ingest", err, { fn: "ingestJournal.enrichJournalEntry" });
  });

  return {
    brainDumpId: brainDump.id,
    entryType,
    tasksCreated,
    insightsStored,
    commitmentsFound,
    summary,
  };
}

/**
 * Lightweight classifier — returns the thought type WITHOUT persisting
 * anything. Used by the classifyThought tool so Nick can suggest what
 * kind of thinking Nour is doing in real time.
 */
export async function classifyThought(text: string): Promise<ThoughtType> {
  try {
    const r = await aiChat(
      [
        {
          role: "system",
          content: `Classify the following thought into ONE of these types. Return only the single word, nothing else.
Types:
  raw        — scattered venting or unstructured thought
  thinking   — exploring an idea in the open
  reasoning  — weighing options toward a decision
  insight    — pattern recognized / something figured out
  decision   — explicit choice being made
  reflection — looking back on an event or day
  planning   — laying out what to do next
  venting    — emotional release, low actionability`,
        },
        { role: "user", content: text.slice(0, 2000) },
      ],
      "fast"
    );
    const raw = r.content.trim().toLowerCase().replace(/[^a-z]/g, "");
    const VALID: ThoughtType[] = [
      "raw", "thinking", "reasoning", "insight",
      "decision", "reflection", "planning", "venting",
    ];
    return (VALID.includes(raw as ThoughtType) ? raw : "raw") as ThoughtType;
  } catch (err) {
    logError("brain.journal-ingest", err, { fn: "classifyThought" });
    return "raw";
  }
}

/**
 * Send a confirmation back to Telegram after processing a journal entry.
 */
export async function sendJournalConfirmation(result: JournalResult): Promise<void> {
  const parts: string[] = [
    `<b>Journal captured.</b>`,
  ];

  if (result.summary) {
    parts.push(`\n${result.summary}`);
  }

  const stats: string[] = [];
  if (result.tasksCreated > 0) stats.push(`${result.tasksCreated} tasks created`);
  if (result.insightsStored > 0) stats.push(`${result.insightsStored} insights stored`);
  if (result.commitmentsFound > 0) stats.push(`${result.commitmentsFound} commitments tracked`);

  if (stats.length > 0) {
    parts.push(`\n${stats.join(" | ")}`);
  }

  await sendTelegram(parts.join(""));
}
