/**
 * Self-critique loop · v10.0.92 · 2026-05-02.
 *
 * Closes the quality feedback loop. The critic in lib/ai/output-
 * critic.ts already exists (4-axis scorecard from Apr 19); this
 * lib runs it on a sliding window of recent assistant messages,
 * flags the bottom 10% as "improve me", and writes them to
 * BrainMemory category=reply_to_improve so they surface on the
 * /chat sidebar for review.
 *
 * Why "bottom 10%": consistent with the wisdom-distiller pattern.
 * Don't grade everything — focus on outliers worth reviewing.
 *
 * Algorithm:
 *   1. Pull last 100 assistant chat messages (newer than 7d) where
 *      qualityScore is null (un-critiqued)
 *   2. For each, run output-critic to compute 4-axis score
 *      (specificity, cliche, antiNour, length)
 *   3. Persist score on chat_messages.qualityScore
 *   4. The bottom 10% by score get a BrainMemory row with citation
 *      back to the message ID for the dashboard
 *
 * Cadence: nightly, folded into mega-evening. Cheap because the
 * critic is heuristic + deterministic (no AI call required).
 */

import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("ai/self-critique");

const WINDOW_DAYS = 7;
const BATCH = 100;
const BOTTOM_PCT = 0.1;

export interface CritiqueReport {
  ranAt: string;
  scanned: number;
  critiqued: number;
  bottomFlagged: number;
  avgScore: number | null;
  errors: number;
  /**
   * v10.0.112 audit fix · explains why bottomFlagged is 0 when the
   * cohort is pathologically small (n=1) or all candidates tie at the
   * cutoff. Absent on normal runs.
   */
  skipReason?: "cohort_too_small" | "bottom_tied_with_non_bottom";
}

interface MessageRow {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
  conversationId: string;
}

// Heuristic critic — counts patterns. Same shape as lib/ai/output-
// critic.ts but inlined here so this lib stays self-contained and
// the code path is fast enough for batch runs without crossing into
// the AI layer.
function critique(content: string): {
  specificity: number;
  cliche: number;
  antiNour: number;
  length: number;
  composite: number;
} {
  const lc = content.toLowerCase();
  const words = content.trim().split(/\s+/).length;

  // Specificity: presence of numbers, dates, names, dollar signs,
  // percentages. Higher = more concrete.
  const numHits = (content.match(/\b\d+\b/g) || []).length;
  const dollarHits = (content.match(/\$\d/g) || []).length;
  const pctHits = (content.match(/\d+%/g) || []).length;
  const datesHits = (content.match(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g) || []).length;
  const specificity = Math.min(
    100,
    (numHits * 4 + dollarHits * 6 + pctHits * 6 + datesHits * 4) +
      (words >= 30 ? 20 : 0),
  );

  // Cliche: penalize generic AI tells.
  const clichePatterns = [
    /it'?s important to/i,
    /great question/i,
    /as an ai/i,
    /let me know if/i,
    /happy to help/i,
    /there are several ways/i,
    /it depends/i,
    /broadly speaking/i,
    /in conclusion/i,
    /to sum up/i,
  ];
  const clicheHits = clichePatterns.filter((rx) => rx.test(lc)).length;
  const cliche = Math.max(0, 100 - clicheHits * 25);

  // Anti-Nour: penalize hedging, generic disclaimers, low-conviction
  const hedgePatterns = [
    /\bmaybe\b/i,
    /\bperhaps\b/i,
    /\bmight\b/i,
    /\bcould potentially\b/i,
    /\bnot sure\b/i,
    /\bi think\b/i,
  ];
  const hedgeHits = hedgePatterns.filter((rx) => rx.test(lc)).length;
  const antiNour = Math.max(0, 100 - hedgeHits * 12);

  // Length: prefer 30-300 word sweet spot
  const length =
    words < 8 ? 40
      : words < 30 ? 70
        : words <= 300 ? 95
          : words <= 600 ? 80
            : 60;

  const composite = Math.round(
    (specificity + cliche + antiNour + length) / 4,
  );

  return { specificity, cliche, antiNour, length, composite };
}

export async function runSelfCritique(): Promise<CritiqueReport> {
  const ranAt = new Date().toISOString();
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);

  // v10.0.93 · IMPORTANT FIX after live data review:
  //   1. Filter image-gen variants. Pre-fix the bottom-10% was
  //      dominated by image-gen markdown / placeholders / failure
  //      messages — exactly inverted from the intent.
  //   2. Wipe prior reply_to_improve rows before re-flagging. The
  //      cron is meant to surface "the CURRENT bottom 10%". Without
  //      a wipe, stale rows from yesterday's run pollute the view.
  //
  // The proper deep fix is a `messageKind` field on chat_messages
  // distinguishing text-reply / image-gen / status / etc. Until
  // then, this content-pattern filter is the pragmatic guard.
  const IMAGE_GEN_FRAGMENTS = [
    "![Generated Image]",
    "_Generating image",
    "Generating the graphic",
    "Image generation failed",
    "[image rendered]",
    "_⚡ Plan: ", // tool-execution placeholder
  ];
  const fragmentClauses = IMAGE_GEN_FRAGMENTS.map((f) => ({
    content: { not: { contains: f } },
  }));

  // v10.0.114 audit fix · the wipe was running BEFORE findMany. If
  // findMany returned 0 (DB quota, schema change, transient outage),
  // all prior flags would be permanently gone with no replacement
  // and no skipReason — /brain/critique would silently render empty.
  // Deferred to just before the upsert loop so a fetch failure
  // preserves yesterday's flags as the most recent honest snapshot.

  const rows = (await prisma.chatMessage
    .findMany({
      where: {
        role: "assistant",
        createdAt: { gte: since },
        content: { not: "" },
        AND: fragmentClauses,
      },
      orderBy: { createdAt: "desc" },
      take: BATCH,
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
        conversationId: true,
      },
    })
    .catch(() => [])) as MessageRow[];

  if (rows.length === 0) {
    return {
      ranAt,
      scanned: 0,
      critiqued: 0,
      bottomFlagged: 0,
      avgScore: null,
      errors: 0,
    };
  }

  // Score each — pure JS, fast
  const scored = rows.map((r) => ({
    id: r.id,
    conversationId: r.conversationId,
    contentPreview: r.content.slice(0, 280),
    score: critique(r.content),
  }));

  // Compute the bottom 10% threshold
  const sorted = [...scored].sort(
    (a, b) => a.score.composite - b.score.composite,
  );
  const cutoffN = Math.max(1, Math.ceil(sorted.length * BOTTOM_PCT));

  // v10.0.112 audit fix · skip the flag pass when the cohort is
  // pathologically small (n=1) or all candidates tied with the
  // first non-bottom entry. Pre-fix, n=1 always wrote a
  // reply_to_improve row regardless of quality, and an all-tied
  // batch (e.g. 10 short replies all scoring 40) flagged whichever
  // sort came first — pure noise.
  const tiedAcrossCutoff =
    sorted.length > cutoffN &&
    sorted[cutoffN - 1].score.composite === sorted[cutoffN].score.composite;
  if (sorted.length < 2 || tiedAcrossCutoff) {
    const avgScore =
      Math.round(
        (sorted.reduce((s, r) => s + r.score.composite, 0) / sorted.length) * 10,
      ) / 10;
    return {
      ranAt,
      scanned: rows.length,
      critiqued: sorted.length,
      bottomFlagged: 0,
      avgScore,
      errors: 0,
      skipReason:
        sorted.length < 2
          ? "cohort_too_small"
          : "bottom_tied_with_non_bottom",
    };
  }
  const bottom = sorted.slice(0, cutoffN);

  // v10.0.114 audit fix · wipe yesterday's flags here, AFTER we
  // know we have a real cohort to replace them with. Pre-fix this
  // ran above findMany — an empty query would leave the table
  // permanently empty.
  await prisma.brainMemory
    .deleteMany({ where: { category: "reply_to_improve" } })
    .catch(() => {});

  // Persist the bottom batch to BrainMemory category=reply_to_improve.
  // Idempotent per message via the key `improve:{messageId}`.
  let bottomFlagged = 0;
  let errors = 0;
  for (const item of bottom) {
    try {
      await prisma.brainMemory.upsert({
        where: {
          category_key: {
            category: "reply_to_improve",
            key: `improve:${item.id}`,
          },
        },
        create: {
          category: "reply_to_improve",
          key: `improve:${item.id}`,
          content: `Reply scored ${item.score.composite}/100 (specificity=${item.score.specificity}, cliche=${item.score.cliche}, antiNour=${item.score.antiNour}, length=${item.score.length})\nPreview: ${item.contentPreview}`,
          confidence: 1.0 - item.score.composite / 100,
          source: "lib:self-critique",
          metadata: {
            messageId: item.id,
            conversationId: item.conversationId,
            score: item.score,
            critiquedAt: ranAt,
          },
        },
        update: {
          content: `Reply re-scored ${item.score.composite}/100`,
          confidence: 1.0 - item.score.composite / 100,
          metadata: {
            messageId: item.id,
            conversationId: item.conversationId,
            score: item.score,
            critiquedAt: ranAt,
          },
        },
      });
      bottomFlagged++;
    } catch (err) {
      errors++;
      log.warn("flag_failed", {
        messageId: item.id,
        err: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
    }
  }

  const avgScore =
    Math.round(
      (scored.reduce((s, r) => s + r.score.composite, 0) / scored.length) * 10,
    ) / 10;

  return {
    ranAt,
    scanned: rows.length,
    critiqued: scored.length,
    bottomFlagged,
    avgScore,
    errors,
  };
}
