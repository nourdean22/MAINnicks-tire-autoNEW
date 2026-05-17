/**
 * /api/cron/ingest-fireflies — pull recent meeting transcripts.
 *
 * v6 · BATCH 6 · Apr 28. Pulls last 7 days of Fireflies transcripts,
 * extracts key moments + commitments, persists each as BrainMemory
 * under category="meeting_transcript" so chat recall can surface
 * "you said X in last Tuesday's meeting with Y".
 *
 * Vercel cron schedule: "30 8,20 * * *"   // 8:30am + 8:30pm Cleveland
 */

import { cronHandler } from "@/lib/utils/http";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { getRecentTranscripts } from "@/lib/integrations/fireflies";
import { prisma } from "@/lib/prisma";
import { classifyJournalEntry } from "@/lib/journal/classifier";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/ingest-fireflies");

export const maxDuration = 120;

const MAX_TRANSCRIPTS_PER_RUN = 5;

export const GET = cronHandler(async () => {
  let pulled = 0;
  let added = 0;
  let skipped = 0;
  let errors = 0;

  try {
    const recent = await getRecentTranscripts(MAX_TRANSCRIPTS_PER_RUN);
    if (!Array.isArray(recent)) {
      return { ok: false, error: "fireflies returned non-array" };
    }

    for (const meta of recent) {
      pulled++;
      try {
        const key = `fireflies:${meta.id}`;
        const existing = await prisma.brainMemory
          .findUnique({
            where: { category_key: { category: "meeting_transcript", key } },
            select: { id: true },
          })
          .catch(() => null);
        if (existing) {
          skipped++;
          continue;
        }

        // meta already includes summary; only fetch full transcript if needed.
        const text = meta.summary
          ?? meta.title
          ?? "(no summary)";

        const classification = classifyJournalEntry(text);

        await prisma.brainMemory.create({
          data: {
            category: "meeting_transcript",
            key,
            source: "fireflies",
            content: text.slice(0, 2000),
            confidence: 0.85,
            metadata: {
              firefliesId: meta.id,
              title: meta.title,
              date: meta.date,
              speakers: meta.speakers,
              actionItems: meta.actionItems,
              durationMin: Math.round(meta.duration / 60),
              classification: {
                primary: classification.primary,
                sentiment: classification.sentiment,
                energy: classification.energyLevel,
              },
            } as unknown as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
          },
        });
        added++;
      } catch (err) {
        errors++;
        log.warn("ingest_failed", {
          id: meta?.id ?? null,
          err: sanitizeError(err),
        });
      }
    }

    return {
      ok: errors < pulled,
      pulled,
      added,
      skipped,
      errors,
      summary: `${pulled} transcripts · ${added} new · ${skipped} duped · ${errors} errors`,
    };
  } catch (err) {
    return {
      ok: false,
      error: sanitizeError(err),
    };
  }
});

export const POST = GET;
