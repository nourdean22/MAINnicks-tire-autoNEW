/**
 * Conversation Memory — AI-powered conversation analysis.
 *
 * After each conversation, uses AI to extract:
 * - Topics discussed with depth analysis
 * - Decisions made and their stakes
 * - Commitments / action items
 * - Emotional arc (not just a single mood label — how it evolved)
 * - People mentioned (feeds L11 People Intelligence)
 * - Cross-session threads (detects "this continues from X")
 * - Key insights worth remembering long-term
 *
 * This replaces the old regex-only extraction with genuine understanding.
 */

import { prisma } from "@/lib/prisma";
// v10.0.64 · AgentTrace coverage · source="chat" (post-message digest).
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
const aiChat = makeTracedAiChat("conversation-memory", "chat");
import { extractJsonObject } from "@/lib/ai/extract-structured";
import { logger as rootLogger } from "@/lib/logger";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logError } from "@/lib/utils/error-log";

const log = rootLogger.withSurface("brain/conversation-memory");

interface ConversationDigest {
  conversationId: string;
  date: string;
  messageCount: number;
  // AI-extracted fields
  topics: Array<{ topic: string; depth: "mentioned" | "discussed" | "deep_dive" }>;
  decisions: Array<{ decision: string; stakes: "low" | "medium" | "high"; resolved: boolean }>;
  commitments: Array<{ what: string; who: "nour" | "nick" | "other"; deadline: string | null }>;
  actionItems: string[];
  emotionalArc: {
    start: string;
    end: string;
    trajectory: "improving" | "declining" | "stable" | "volatile";
    triggers: string[];
  };
  peopleMentioned: MentionedPerson[];
  keyInsight: string | null;
  followUpNeeded: string | null;
  relatedConversations: string[]; // topics that connect to past conversations
}

/**
 * 2026-09-16 · a mention is not a contact. `interacted` is the model's claim
 * that Nour actually communicated with this person (met, called, texted, ate
 * with, visited) — never that he talked ABOUT them. Only an interacted mention
 * may touch the relationship ledger, and only through the seam.
 */
export type InteractionKind = "in_person" | "call" | "text" | "video" | "other";
export interface MentionedPerson {
  name: string;
  context: string;
  sentiment: "positive" | "neutral" | "negative";
  interacted: boolean;
  interactionKind: InteractionKind | null;
  /** One line, in Nour's words, saying what happened — the ledger note when interacted. */
  interactionNote: string;
}

const INTERACTION_KINDS: ReadonlySet<string> = new Set(["in_person", "call", "text", "video", "other"]);

/** Shape the model's people list; a string "yes" is not an interaction claim. */
function normalizeMentionedPeople(raw: unknown): MentionedPerson[] {
  if (!Array.isArray(raw)) return [];
  const out: MentionedPerson[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (!name) continue;
    const kind =
      typeof o.interactionKind === "string" && INTERACTION_KINDS.has(o.interactionKind)
        ? (o.interactionKind as InteractionKind)
        : null;
    out.push({
      name,
      context: typeof o.context === "string" ? o.context : "",
      sentiment: o.sentiment === "positive" || o.sentiment === "negative" ? o.sentiment : "neutral",
      interacted: o.interacted === true,
      interactionKind: kind,
      interactionNote: typeof o.interactionNote === "string" ? o.interactionNote.trim() : "",
    });
  }
  return out;
}

/**
 * AI-analyze a conversation and produce a structured digest.
 * This is the core upgrade — real understanding, not regex.
 */
export async function digestConversation(
  conversationId: string,
  messages: Array<{ role: string; content: string; createdAt: Date }>
): Promise<ConversationDigest | null> {
  if (messages.length < 3) return null;

  // Build conversation transcript (truncated for context limits)
  const transcript = messages
    .map((m) => `[${m.role.toUpperCase()}] ${m.content.slice(0, 500)}`)
    .slice(-30) // last 30 messages max
    .join("\n\n");

  // Load recent conversation summaries to detect cross-session threads
  const recentSummaries = await prisma.auditEvent.findMany({
    where: { eventType: "conversation_digest" },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { payload: true },
  }).catch((): never[] => []);

  const recentTopics = recentSummaries
    .map((s) => {
      const p = s.payload as any;
      return p?.topics?.map((t: any) => t.topic).join(", ") || "";
    })
    .filter(Boolean)
    .join(" | ");

  const result = await aiChat(
    [
      {
        role: "system",
        content: `You are the Conversation Intelligence Engine for NOUR OS. Analyze this conversation between Nour (user) and Nick (AI assistant) and extract structured intelligence.

Return ONLY JSON:
{
  "topics": [{ "topic": "hiring a second tech", "depth": "deep_dive" }],
  "decisions": [{ "decision": "will post job ad this week", "stakes": "high", "resolved": true }],
  "commitments": [{ "what": "post mechanic job listing", "who": "nour", "deadline": "this week" }],
  "actionItems": ["Post job ad on Indeed", "Ask Mo about referrals"],
  "emotionalArc": {
    "start": "frustrated about workload",
    "end": "motivated with a plan",
    "trajectory": "improving",
    "triggers": ["realized he's losing money by not hiring"]
  },
  "peopleMentioned": [{ "name": "Mo", "context": "current tech, reliable", "sentiment": "positive", "interacted": false, "interactionKind": null, "interactionNote": null }],
  "keyInsight": "The hiring bottleneck is the real revenue cap — not marketing",
  "followUpNeeded": "Check if job ad was posted by Friday",
  "relatedConversations": ["topics from past that connect: hiring, staffing, revenue scaling"]
}

Rules:
- Extract REAL content, not generic summaries
- Emotional arc tracks how the mood CHANGED during the conversation
- People: extract any person's name mentioned, with their context. "interacted" is true ONLY when Nour reports actually communicating with that person — met, called, texted, video-called, ate with, visited — during or just before this conversation; never for talking ABOUT someone, asking advice about them, or planning to reach out. When true, set "interactionKind" (in_person | call | text | video | other) and "interactionNote" (one line, in Nour's words, saying what happened); otherwise both are null
- Follow-up: what should Nick proactively bring up next time?
- Related conversations: match against these recent topics: ${recentTopics || "none yet"}
- If nothing fits a field, use null or empty array
- Max 5 items per array field`,
      },
      { role: "user", content: transcript },
    ],
    "reason"
  );

  // v10.0.229 · extractJsonObject · gets repair pass for free
   
  const extracted = extractJsonObject<any>(result.content);
  if (!extracted.ok) return null;

  try {
    const parsed = extracted.value;
    const date = messages[0]?.createdAt
      ? new Date(messages[0].createdAt).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    return {
      conversationId,
      date,
      messageCount: messages.length,
      topics: parsed.topics || [],
      decisions: parsed.decisions || [],
      commitments: parsed.commitments || [],
      actionItems: parsed.actionItems || [],
      emotionalArc: parsed.emotionalArc || {
        start: "unknown",
        end: "unknown",
        trajectory: "stable",
        triggers: [],
      },
      peopleMentioned: normalizeMentionedPeople(parsed.peopleMentioned),
      keyInsight: parsed.keyInsight || null,
      followUpNeeded: parsed.followUpNeeded || null,
      relatedConversations: parsed.relatedConversations || [],
    };
  } catch {
    return null;
  }
}

/** Truthful compile outcome — the sweep/studio counters depend on it.
 *  This function NEVER throws; the status is the only failure signal
 *  (self-audit 2026-08-20: with a void return, the sweep counted a
 *  budget-exhausted night's zero writes as "10 compiled" — the repo's
 *  named all-clear-on-failure trap). */
export type CompileStatus = "compiled" | "skipped" | "failed";

/**
 * Digest and store a conversation. Call after 4+ messages.
 * Also feeds People Intelligence (L11) with extracted names.
 */
export async function summarizeAndStoreConversation(
  conversationId: string
): Promise<CompileStatus> {
  const messages = await prisma.chatMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true, createdAt: true },
  });

  if (messages.length < 4) return "skipped";

  // Freshness guard (2026-08-19 · memory-loop wave). The old guard was
  // "any conversation_digest AuditEvent EVER names this id" — one-shot
  // forever: a 15-message conversation was compiled at message 4-6 and
  // never again, and because the audit row was written BEFORE the memory
  // row (whose failure was swallowed), one bad upsert lost a conversation
  // permanently. The guard is now the summary row itself: recompile when
  // the conversation moved after the row was written, debounced 30min so
  // the per-turn caller doesn't burn a digest per message. A soft-deleted
  // row does NOT count as fresh — recompiling revives it (pre-fix the
  // nightly merge grinder had soft-deleted 158 of 173 summaries, and
  // nothing could ever write them back).
  const conversation = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    select: { updatedAt: true },
  });
  const summaryRow = await prisma.brainMemory.findUnique({
    where: {
      category_key: {
        category: BRAIN_CATEGORIES.CONVERSATION_SUMMARY,
        key: `conv_${conversationId}`,
      },
    },
    select: { updatedAt: true, deletedAt: true },
  });
  if (summaryRow && !summaryRow.deletedAt) {
    const fresh =
      conversation != null &&
      summaryRow.updatedAt.getTime() >= conversation.updatedAt.getTime();
    const withinDebounce =
      Date.now() - summaryRow.updatedAt.getTime() < 30 * 60_000;
    if (fresh || withinDebounce) return "skipped";
  }

  let digest: Awaited<ReturnType<typeof digestConversation>> = null;
  try {
    digest = await digestConversation(conversationId, messages);
  } catch (err) {
    // BudgetExceededError / provider throws — pre-fix these propagated
    // out and were swallowed silently upstream, so a budget-exhausted
    // evening produced zero digests with no visible signal.
    log.warn("digest_failed", {
      conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
  if (!digest) return "failed";

  // Store digest in audit log (legacy consumers read from here)
  // v10.0.35 — PII fix. The full digest payload includes
  // `peopleMentioned[].name` and `peopleMentioned[].context` —
  // names + relational context about real people (customers,
  // family). AuditEvent is not row-level access controlled, so
  // any code path that reads the table without filtering by
  // actor gets all conversation intelligence including the
  // named-person context. Strip peopleMentioned here; the data
  // already lives in PersonProfile where it belongs.
  const { peopleMentioned: _peopleStripped, ...auditPayload } =
    digest as unknown as Record<string, unknown> & { peopleMentioned?: unknown };
  void _peopleStripped;
  await prisma.auditEvent.create({
    data: {
      actor: "conversation_intelligence",
      eventType: "conversation_digest",
      detail: `Conv ${conversationId}: ${digest.topics.slice(0, 2).map((t) => t.topic).join(", ") || "general"}`,
      payload: auditPayload as never,
    },
  });

  // ALSO store as BrainMemory so contextual recall + embedding pipeline
  // can surface the summary in future system prompts. Key pattern:
  // conv_<id>. Content is a compressed one-paragraph summary — the
  // full structured digest stays in auditEvent, this is the surfacable
  // version for cross-session continuity ("as we discussed yesterday...").
  const topics = digest.topics.slice(0, 3).map((t) => t.topic).join(", ") || "general";
  const insight = digest.keyInsight || "";
  const decisions = digest.decisions
    .slice(0, 2)
    .map((d) => `${d.stakes}:${d.decision}`)
    .join(" · ");
  const summaryContent = [
    `[conversation ${digest.date}] topics: ${topics}.`,
    insight ? `key: ${insight}` : "",
    decisions ? `decisions: ${decisions}` : "",
    digest.emotionalArc?.trajectory
      ? `emotional arc: ${digest.emotionalArc.trajectory}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  let summaryUpsertFailed = false;
  try {
    const mem = await prisma.brainMemory.upsert({
      where: {
        category_key: { category: BRAIN_CATEGORIES.CONVERSATION_SUMMARY, key: `conv_${conversationId}` },
      },
      create: {
        category: BRAIN_CATEGORIES.CONVERSATION_SUMMARY,
        key: `conv_${conversationId}`,
        content: summaryContent,
        confidence: 0.75,
        source: `conversation_${conversationId}`,
        seenCount: 1,
        // 2026-08-19 · queryable provenance. The source string above
        // encodes the id, but the audit's provenance probe (and any
        // future "why do you remember this?" surface) filters on
        // metadata->>'conversationId' — measured that day, only 9.8% of
        // a month's memories could answer which conversation taught
        // them. Every write in this file now can.
        metadata: { conversationId },
      },
      update: {
        content: summaryContent,
        confidence: 0.75,
        metadata: { conversationId },
        lastSeen: new Date(),
        seenCount: { increment: 1 },
        // Revive a merge-ground row — recompiling IS the undelete.
        deletedAt: null,
      },
    });

    // Generate embedding asynchronously so cross-session semantic recall
    // works. Fire-and-forget — non-critical.
    void (async () => {
      try {
        const { storeMemoryEmbedding } = await import("./embedding-utils");
        await storeMemoryEmbedding(mem.id, `[conversation_summary] ${summaryContent}`);
      } catch (err) {
        log.warn("embedding_failed", { error: err instanceof Error ? err.message : String(err) });
      }
    })();
  } catch (err) {
    log.warn("upsert_failed", { error: err instanceof Error ? err.message : String(err) });
    // The summary row IS the freshness guard — without it this
    // conversation retries next turn/sweep, so report the truth.
    summaryUpsertFailed = true;
  }

  // 2026-08-19 · fan the digest's DURABLE ITEMS out as individual,
  // provenance-carrying memories. Measured on prod that day: 282
  // conversations had produced 14 conversation_summary rows and the
  // itemized knowledge (decisions, key insights) was never persisted at
  // all — the digest extracted it and dropped it on the floor, which is
  // exactly how "she returned. how come u forgot" happens. Items become
  // recallable individually; the episode blob above stays the evidence.
  //
  // Deliberately NOT fanned out: commitments and actionItems. Those are
  // operational state, and auto-minting operational rows from AI
  // extraction is the phantom-task failure mode journal-ingest already
  // had to gate (v10.0.231). They stay in the summary + audit payload
  // until a review lane exists.
  const fanOut: Array<{ category: string; key: string; content: string }> = [];
  // Filter BEFORE capping — otherwise three low-stakes entries could
  // evict a fourth high-stakes one from the cap window.
  const durableDecisions = digest.decisions
    .filter((d) => Boolean(d.decision) && d.stakes !== "low")
    .slice(0, 3);
  for (const [i, d] of durableDecisions.entries()) {
    fanOut.push({
      category: BRAIN_CATEGORIES.DECISION_LOG,
      key: `conv_${conversationId}_decision_${i}`,
      content: `Decision (${d.stakes} stakes${d.resolved ? "" : ", unresolved"}): ${d.decision}`,
    });
  }
  if (digest.keyInsight && digest.keyInsight.length > 12) {
    fanOut.push({
      // Registry gap closed 2026-08-19 (memory-loop wave): the flagged
      // "insight has no constant" gap from the wave report — same live
      // prod category (1,108 rows, recall-whitelisted), now registered.
      category: BRAIN_CATEGORIES.INSIGHT,
      key: `conv_${conversationId}_insight`,
      content: digest.keyInsight,
    });
  }
  for (const item of fanOut) {
    try {
      // Direct upsert, not remember(): the auditEvent guard above makes
      // this a once-per-conversation write, remember()'s (category,key)
      // upsert semantics add nothing here, and its 24h new-row probation
      // would silently expire these before anything could recall them.
      // confidence 0.5 = the formula's honest "seen once" — this wave is
      // about writers NOT stamping fictional confidence.
      const row = await prisma.brainMemory.upsert({
        where: { category_key: { category: item.category, key: item.key } },
        create: {
          category: item.category,
          key: item.key,
          content: item.content,
          confidence: 0.5,
          source: `conversation_${conversationId}`,
          seenCount: 1,
          metadata: { conversationId },
        },
        update: {
          content: item.content,
          metadata: { conversationId },
          lastSeen: new Date(),
          // Revive a soft-deleted row — same revival contract as the
          // summary upsert above (review 2026-08-20 caught this half
          // missing: merge-ground decision_log/insight rows were being
          // content-updated while staying recall-invisible forever).
          deletedAt: null,
        },
      });
      void (async () => {
        try {
          const { storeMemoryEmbedding } = await import("./embedding-utils");
          await storeMemoryEmbedding(row.id, `[${item.category}] ${item.content}`);
        } catch (err) {
          log.warn("fanout_embedding_failed", {
            key: item.key,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    } catch (err) {
      log.warn("fanout_upsert_failed", {
        key: item.key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // People. 2026-09-16 · a MENTION is not a CONTACT. Until today every name
  // the digest extracted bumped lastInteraction + interactionCount on the
  // matched profile with no ledger row behind it — "should I trust Dania?"
  // counted exactly like "had dinner with Dania" (measured on Neon: the
  // counters summed to 191 against 23 ledger rows ever, none since 07-10).
  // Now a mention does nothing to the interaction fields; a REPORTED
  // interaction becomes one honest chat ledger row through the seam: dated
  // by the conversation's last message (compiling yesterday's chat is not
  // contact today), at most one per person per conversation window (a
  // recompile, or a row the operator or Nick already wrote, wins), no XP (a
  // rep the operator did not confirm earns nothing). The name resolves
  // through the fuzzy chain (exact → case-insensitive → Levenshtein ≤1 →
  // Jaro-Winkler ≥0.92, merges audited in people_intelligence_merge) and
  // NEVER creates a profile (2026-06-06: the digest auto-added tire-shop
  // callers; new people go through person.create after Nour confirms).
  const conversationStart = messages[0]?.createdAt ? new Date(messages[0].createdAt) : new Date();
  const conversationEnd = messages[messages.length - 1]?.createdAt
    ? new Date(messages[messages.length - 1].createdAt)
    : new Date();
  for (const person of digest.peopleMentioned) {
    if (!person.name || person.name.length < 2) continue;
    if (!person.interacted) continue; // a mention: no counters, no row
    try {
      const { resolvePersonByName } = await import("./person-profile-fuzzy");
      const resolution = await resolvePersonByName(person.name, {
        role: "unknown",
        relationship: person.context,
        trustScore: person.sentiment === "positive" ? 0.7 : person.sentiment === "negative" ? 0.3 : 0.5,
        metadata: { firstMentioned: digest.date, context: person.context },
        createIfMissing: false,
      });
      if (!resolution.matched || !resolution.person) continue;
      const { recordInteractionOnce } = await import("@/lib/services/people/record-interaction");
      const outcome = await recordInteractionOnce({
        personId: resolution.person.id,
        amount: 1,
        note:
          person.interactionNote ||
          person.context ||
          `interaction reported in chat (${person.interactionKind ?? "other"})`,
        source: "chat",
        at: conversationEnd,
        noRowSince: conversationStart,
        creditXp: false,
        metadata: {
          auto: true,
          via: "conversation_digest",
          conversationId,
          interactionKind: person.interactionKind ?? "other",
          sentiment: person.sentiment,
          matchTier: resolution.matchTier,
        },
      });
      log.info(outcome.skipped ? "people_interaction_skipped" : "people_interaction_recorded", {
        conversationId,
        personId: resolution.person.id,
        ...(outcome.skipped ? { reason: outcome.reason } : { ledgerId: outcome.recorded.ledgerId }),
      });
    } catch (err) {
      // Non-critical for the compile, but never silent — a bare `catch {}`
      // here is how nine weeks of ledger silence went unnoticed.
      log.warn("people_interaction_failed", {
        conversationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Apr 18 — auto-extraction of "open loops" from conversation digests
  // retired. OpenLoop concept is being sunsetted; it was generating
  // 30+ rows of noise per Nour that he never reviewed, including the
  // model's self-directives ("Consult searchColdMemory"). Real
  // commitments made to others during a conversation should be logged
  // explicitly via the /decide or /commit Telegram commands / omni-
  // capture — they then land in `Commitment` where they belong.

  return summaryUpsertFailed ? "failed" : "compiled";
}

/**
 * Detect if current message relates to a past conversation thread,
 * an open commitment, an unresolved loop, or a person Nick knows.
 *
 * This is the DEEP version — checks 5 sources:
 * 1. Past conversation digests (topics, follow-ups)
 * 2. Active commitments (things Nour promised to do)
 * 3. Open loops (unresolved questions/tasks)
 * 4. Known people (from L11 People Intelligence)
 * 5. Pending predictions (forecasts that haven't resolved)
 *
 * Returns a context block to inject into the system prompt.
 */
export async function detectCrossSessionThread(
  userMessage: string
): Promise<string | null> {
  if (!userMessage || userMessage.length < 10) return null;

  // Gather all 5 sources in parallel
  const [digests, commitments, openLoops, people, predictions] =
    await Promise.all([
      prisma.auditEvent
        .findMany({
          where: { eventType: { in: ["conversation_digest", "conversation_summary"] } },
          orderBy: { createdAt: "desc" },
          take: 15,
          select: { payload: true, createdAt: true },
        })
        .catch((): never[] => []),
      prisma.commitment
        .findMany({
          where: { status: { in: ["active", "in_progress"] } },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { description: true, deadline: true, dateMade: true },
        })
        .catch((): never[] => []),
      // Apr 18: OpenLoop retired → live Task INBOX/READY/DOING.
      prisma.task
        .findMany({
          where: { status: { in: ["INBOX", "READY", "DOING"] } },
          orderBy: [{ autoPriority: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
          take: 10,
          select: {
            title: true,
            createdAt: true,
            mission: { select: { domain: true } },
          },
        })
        .then((rows) =>
          rows.map((t) => ({
            title: t.title,
            domain: t.mission?.domain ?? "general",
            createdAt: t.createdAt,
          })),
        )
        .catch((): never[] => []),
      prisma.personProfile
        .findMany({
          // W8 · recency leads, count breaks ties: with honest counters
          // (0–4, 20 of 27 at zero) a bare count ordering picked 20 people
          // essentially at random for the conversation's people context.
          orderBy: [{ lastInteraction: { sort: "desc", nulls: "last" } }, { interactionCount: "desc" }],
          take: 20,
          select: { name: true, role: true, relationship: true },
        })
        .catch((): never[] => []),
      prisma.prediction
        .findMany({
          where: { status: "pending" },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { prediction: true, targetDate: true, category: true },
        })
        .catch((): never[] => []),
    ]);

  // Build a rich context index
  const sections: string[] = [];

  // Conversation history
  if (digests.length > 0) {
    const topicLines = digests
      .map((d) => {
        const p = d.payload as any;
        if (!p) return null;
        const date = p.date || new Date(d.createdAt).toISOString().slice(0, 10);
        const topics = p.topics?.map((t: any) => t.topic).join(", ") || "";
        const commits = p.commitments?.map((c: any) => `${c.who}: ${c.what}`).join("; ") || "";
        const followUp = p.followUpNeeded || "";
        return `${date}: ${topics}${commits ? `. Commitments: ${commits}` : ""}${followUp ? `. FOLLOW-UP: ${followUp}` : ""}`;
      })
      .filter(Boolean);
    sections.push(`PAST CONVERSATIONS:\n${topicLines.join("\n")}`);
  }

  // Active commitments
  if (commitments.length > 0) {
    sections.push(
      `ACTIVE COMMITMENTS:\n${commitments.map((c) => `"${c.description}"${c.deadline ? ` (due ${c.deadline})` : ""} — made ${c.dateMade}`).join("\n")}`
    );
  }

  // Active tasks
  if (openLoops.length > 0) {
    const loopAge = (d: Date) => Math.round((Date.now() - d.getTime()) / 86400000);
    sections.push(
      `ACTIVE TASKS:\n${openLoops.map((l) => `"${l.title}" (${l.domain}, ${loopAge(l.createdAt)}d old)`).join("\n")}`
    );
  }

  // Known people
  if (people.length > 0) {
    sections.push(
      `KNOWN PEOPLE:\n${people.map((p) => `${p.name} (${p.role}): ${p.relationship.slice(0, 60)}`).join("\n")}`
    );
  }

  // Pending predictions
  if (predictions.length > 0) {
    sections.push(
      `PENDING PREDICTIONS:\n${predictions.map((p) => `[${p.category}] "${p.prediction.slice(0, 80)}" — by ${p.targetDate}`).join("\n")}`
    );
  }

  if (sections.length === 0) return null;

  const result = await aiChat(
    [
      {
        role: "system",
        content: `You are the Cross-Session Threading Engine. Given the user's new message and ALL available context (past conversations, commitments, open loops, known people, predictions), find ANY connection.

${sections.join("\n\n")}

Return ONLY JSON:
{
  "connections": [
    {
      "type": "thread|commitment|loop|person|prediction",
      "source": "what matched (date, name, topic)",
      "context": "brief relevant context to inject — what Nick should reference naturally"
    }
  ]
}

Rules:
- Check if the message mentions a person Nick knows → include their context
- Check if the message relates to an open commitment → include the commitment
- Check if the message continues a past conversation topic → include the thread
- Check if an open loop is being addressed → note it
- Check if a prediction is being validated → flag it
- Return empty connections array if NOTHING matches. Don't force connections.
- Max 3 connections.`,
      },
      { role: "user", content: userMessage },
    ],
    "fast"
  );

   
  const extracted = extractJsonObject<any>(result.content);
  if (!extracted.ok) return null;

  try {
    const parsed = extracted.value;
    if (!Array.isArray(parsed.connections) || parsed.connections.length === 0)
      return null;

    const lines: string[] = [];
    for (const conn of parsed.connections.slice(0, 3)) {
      const prefix =
        conn.type === "commitment"
          ? "ACTIVE COMMITMENT"
          : conn.type === "loop"
            ? "OPEN LOOP"
            : conn.type === "person"
              ? "KNOWN PERSON"
              : conn.type === "prediction"
                ? "PENDING PREDICTION"
                : "PAST THREAD";
      lines.push(`[${prefix}: ${conn.source}] ${conn.context}`);
    }

    return lines.join("\n");
  } catch (e) {
    logError("brain.conversation-memory", e, { stage: "past-thread-connections" }, "warn");
  }

  return null;
}

// ─── Sweep + backfill (2026-08-19 · memory-loop wave) ─────────────────
//
// The per-turn caller compiles a conversation WHILE it is active; these
// two functions are the tail-catcher and the operator's backfill engine.
// Same eligibility everywhere: not archived (unless the operator says
// otherwise), ≥4 messages, and the summary row missing, soft-deleted
// (merge-ground — see the grinder finding), or older than the
// conversation's last activity.

export interface CompileEligibleOptions {
  limit?: number;
  /** Look-back window in days (sweep default 30; backfill can widen). */
  windowDays?: number;
  /** Backfill only — the sweep never touches archived conversations. */
  includeArchived?: boolean;
}

export async function findCompileEligibleConversations(
  opts: CompileEligibleOptions = {},
): Promise<string[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 10, 50));
  const windowDays = Math.max(1, Math.min(opts.windowDays ?? 30, 365));
  const idleCutoff = new Date(Date.now() - 30 * 60_000);

  // Message-count filter lives in SQL (review 2026-08-20): the JS
  // post-filter version let abandoned <4-message conversations — frozen
  // forever at the OLD end of the ascending sort — consume the entire
  // oversample page, starving `eligible` to 0 while a real backlog sat
  // just past the window (and disabling the studio's backfill button).
  // The denormalized counter was measured lying low on 5 rows first,
  // backfilled to truth (45 drifted rows corrected), and is bumped on
  // both turn writers going forward.
  const candidates = await prisma.chatConversation.findMany({
    where: {
      ...(opts.includeArchived ? {} : { archivedAt: null }),
      messageCount: { gte: 4 },
      updatedAt: {
        lt: idleCutoff,
        gt: new Date(Date.now() - windowDays * 86_400_000),
      },
    },
    orderBy: { updatedAt: "asc" },
    take: limit * 2, // small oversample for the freshness re-filter below
    select: { id: true, updatedAt: true },
  });

  const withEnough = candidates;
  if (withEnough.length === 0) return [];

  const existing = await prisma.brainMemory.findMany({
    where: {
      category: BRAIN_CATEGORIES.CONVERSATION_SUMMARY,
      key: { in: withEnough.map((c) => `conv_${c.id}`) },
      deletedAt: null, // soft-deleted (merge-ground) summary = recompile
    },
    select: { key: true, updatedAt: true },
  });
  const summarized = new Map(existing.map((e) => [e.key, e.updatedAt]));

  return withEnough
    .filter((c) => {
      const at = summarized.get(`conv_${c.id}`);
      if (!at) return true;
      return c.updatedAt.getTime() > at.getTime();
    })
    .slice(0, limit)
    .map((c) => c.id);
}

export interface CompileSweepResult {
  eligible: number;
  compiled: number;
  skipped: number;
  failed: number;
  conversationIds: string[];
}

/**
 * Compile up to `limit` eligible conversations, 200ms apart (the
 * session-distiller's pacing — one digest is a full "reason"-lane LLM
 * call; the batch cap keeps a nightly run inside the daily AI budget,
 * so a full backfill drains over nights, never in one shot).
 */
export async function summarizeIdleConversations(
  opts: CompileEligibleOptions = {},
): Promise<CompileSweepResult> {
  const ids = await findCompileEligibleConversations(opts);
  let compiled = 0;
  let skipped = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      // Count by the RETURNED status, not by "didn't throw" — the
      // compiler never throws (all failures are internal + logged), so
      // a try-only counter reported a budget-exhausted night's zero
      // writes as "10 compiled" (self-audit 2026-08-20).
      const status = await summarizeAndStoreConversation(id);
      if (status === "compiled") compiled += 1;
      else if (status === "skipped") skipped += 1;
      else failed += 1;
    } catch (err) {
      failed += 1;
      log.warn("sweep_compile_failed", {
        conversationId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { eligible: ids.length, compiled, skipped, failed, conversationIds: ids };
}
