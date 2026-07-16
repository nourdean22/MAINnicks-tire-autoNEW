/**
 * Journal capture fan-out · durable-fanout wave (audit 2026-07-15).
 *
 * Every journal write triggers the same post-capture work: grounding
 * enrichment (2 "reason" calls) · recall embedding · thread auto-join.
 * Pre-wave each write site fired these as `void` promises — on
 * serverless, work started after the response returns is NOT
 * guaranteed to run (no waitUntil), so enrichment/embedding losses
 * were routine and only partially repaired by the nightly resweep.
 *
 * dispatchJournalFanout() sends one Inngest event and lets the
 * journal-fanout function run the three stages as durable, retried
 * steps. When the event send itself fails (Inngest down, local dev
 * without the dev server), it degrades to the old inline
 * fire-and-forget path so capture behavior never regresses.
 *
 * NOTE: reflection writes keep their own inline enrich (journal-reflect
 * + the legacy ultron route) because the brain-bus already handles
 * their thread-join — routing them here would double-join.
 */

import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import type { JournalSilo } from "@/lib/brain/journal-brain";

const log = rootLogger.withSurface("brain/journal-fanout");

export interface JournalFanoutOpts {
  /** Forward to enrichJournalEntry — Telegram goal-link confirm ping. */
  notifyTelegram?: boolean;
}

/** Silo-appropriate text loader — the event carries only (silo, id) so
 *  replays always see current DB state, never a stale payload. */
export async function loadEntryText(silo: JournalSilo, id: string): Promise<string | null> {
  try {
    if (silo === "brain_dump") {
      const r = await prisma.brainDump.findUnique({ where: { id }, select: { rawThoughts: true } });
      return r?.rawThoughts ?? null;
    }
    if (silo === "reflection") {
      const r = await prisma.reflection.findUnique({ where: { id }, select: { insight: true } });
      return r?.insight ?? null;
    }
    if (silo === "situation_log") {
      const r = await prisma.situationLog.findUnique({ where: { id }, select: { situation: true, context: true } });
      return r ? `[situation ${r.context}] ${r.situation}` : null;
    }
    const r = await prisma.decisionReplay.findUnique({
      where: { id },
      select: { title: true, choiceMade: true, reasoning: true },
    });
    return r
      ? [`${r.title} — chose: ${r.choiceMade}`, r.reasoning ? `why: ${r.reasoning}` : null].filter(Boolean).join("\n")
      : null;
  } catch (err) {
    log.warn("load_entry_text_failed", {
      silo,
      id,
      error: err instanceof Error ? err.message.slice(0, 160) : String(err),
    });
    return null;
  }
}

/** The three post-capture stages, awaited in order. Used by the Inngest
 *  function's steps AND by the inline fallback. Each stage is
 *  independently idempotent (enrich stamps enrichedAt + grounded credit
 *  dedupes by sourceKey; embedding skips byte-identical content;
 *  thread membership has a unique constraint). */
export async function runJournalFanout(
  silo: JournalSilo,
  id: string,
  opts: JournalFanoutOpts = {},
): Promise<{ ran: boolean }> {
  const text = await loadEntryText(silo, id);
  if (!text || text.trim().length === 0) return { ran: false };

  const { enrichJournalEntry } = await import("@/lib/brain/journal-brain");
  await enrichJournalEntry(silo, id, text, { notifyTelegram: opts.notifyTelegram });

  if (text.trim().length >= 40) {
    const { storeGenericEmbedding } = await import("@/lib/brain/embedding-utils");
    await storeGenericEmbedding(silo, id, text.slice(0, 2000)).catch((err) => {
      log.warn("fanout_embed_failed", {
        silo,
        id,
        error: err instanceof Error ? err.message.slice(0, 160) : String(err),
      });
    });
  }

  const { tryJoinActiveThreads } = await import("@/lib/services/journal-threads");
  await tryJoinActiveThreads(silo, id, text).catch((err) => {
    log.warn("fanout_thread_join_failed", {
      silo,
      id,
      error: err instanceof Error ? err.message.slice(0, 160) : String(err),
    });
  });

  return { ran: true };
}

/** Fire the durable path; degrade to inline fire-and-forget when the
 *  event can't be sent. Never throws — capture must never fail because
 *  the fan-out infrastructure is down. */
export async function dispatchJournalFanout(
  silo: JournalSilo,
  id: string,
  opts: JournalFanoutOpts = {},
): Promise<void> {
  try {
    const { getInngest } = await import("@/lib/inngest/client");
    await getInngest().send({
      name: "journal/entry.captured",
      data: { silo, entryId: id, notifyTelegram: opts.notifyTelegram === true },
    });
  } catch (err) {
    log.warn("fanout_event_send_failed_inline_fallback", {
      silo,
      id,
      error: err instanceof Error ? err.message.slice(0, 160) : String(err),
    });
    void runJournalFanout(silo, id, opts).catch((innerErr) => {
      log.warn("fanout_inline_failed", {
        silo,
        id,
        error: innerErr instanceof Error ? innerErr.message.slice(0, 160) : String(innerErr),
      });
    });
  }
}
