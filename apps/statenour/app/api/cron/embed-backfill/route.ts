/**
 * GET /api/cron/embed-backfill
 *
 * Rolling embedding backfill across ALL 5 vector source types.
 * Each cron tick processes up to 15 missing rows per type (75 total).
 * At two runs/day that's 150/day — new rows get indexed within hours,
 * zero-op on steady state.
 *
 * Source types covered (matches semanticSearch's defaults):
 *   • brain_memory     — narrator + engine memory rows
 *   • brain_dump       — journal captures (summary if present, else
 *                        rawThoughts)
 *   • reflection       — reflective memory insights
 *   • strategic_law    — the Greene laws (static, backfills once)
 *   • chat_message     — assistant replies ≥ 60 chars (recall surface
 *                        for cross-source recall in contextual-recall)
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { storeGenericEmbedding } from "@/lib/brain/embedding-utils";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/embed-backfill");

export const maxDuration = 60;

const BATCH_PER_TYPE = 15;

export const GET = cronHandler(async () => {
  const report: Record<string, { processed: number; success: number; remaining: number }> = {};
  let totalProcessed = 0;
  let totalSuccess = 0;

  // ── brain_memory ──
  {
    const embedded = await prisma.vectorEmbedding
      .findMany({ where: { sourceType: "brain_memory" }, select: { sourceId: true }, orderBy: { createdAt: "desc" }, take: 5000 });
    const embeddedSet = new Set(embedded.map((e) => e.sourceId));
    // BrainMemory is retention='forever' (decays by confidence, never
    // deleted) so it grows unbounded and rows carry large content
    // (e.g. base64 audio). This block picks the top ~15 by confidence,
    // so a bounded highest-confidence window is all it needs — an
    // unbounded scan materializes the whole table twice a day to keep
    // 15 rows. `take: 200` matches brain_dump/reflection below; a
    // backlog drains over the twice-daily cadence.
    const memories = await prisma.brainMemory.findMany({
      where: { confidence: { gte: 0.2 } },
      orderBy: { confidence: "desc" },
      select: { id: true, category: true, key: true, content: true },
      take: 200,
    });
    const missing = memories.filter((m) => !embeddedSet.has(m.id));
    const batch = missing.slice(0, BATCH_PER_TYPE);
    let success = 0;
    for (const m of batch) {
      try {
        await storeGenericEmbedding("brain_memory", m.id, `[${m.category}] ${m.key}: ${m.content}`);
        success++;
      } catch (err) {
        // v10.0.39 — surface persistent embedding failures instead
        // of silently ratcheting `report` to 0. Operator can spot a
        // broken vector model or quota exhaustion in /system/errors.
        log.warn("embed_failed", { err: err instanceof Error ? err.message : String(err) });
      }
    }
    report.brain_memory = { processed: batch.length, success, remaining: missing.length - batch.length };
    totalProcessed += batch.length;
    totalSuccess += success;
  }

  // ── brain_dump ──
  {
    const embedded = await prisma.vectorEmbedding
      .findMany({ where: { sourceType: "brain_dump" }, select: { sourceId: true }, orderBy: { createdAt: "desc" }, take: 5000 });
    const embeddedSet = new Set(embedded.map((e) => e.sourceId));
    const dumps = await prisma.brainDump.findMany({
      where: { deletedAt: null }, // v10.0.68
      orderBy: { createdAt: "desc" },
      select: { id: true, date: true, rawThoughts: true, summary: true, extractedItems: true },
      take: 200,
    });
    const missing = dumps.filter((d) => {
      if (embeddedSet.has(d.id)) return false;
      const text = (d.summary ?? d.extractedItems ?? d.rawThoughts ?? "").trim();
      return text.length > 40;
    });
    const batch = missing.slice(0, BATCH_PER_TYPE);
    let success = 0;
    for (const d of batch) {
      try {
        const primary = (d.summary ?? d.extractedItems ?? d.rawThoughts ?? "").trim();
        await storeGenericEmbedding("brain_dump", d.id, `[brain_dump ${d.date}] ${primary}`.slice(0, 2000));
        success++;
      } catch (err) {
        // v10.0.39 — surface persistent embedding failures instead
        // of silently ratcheting `report` to 0. Operator can spot a
        // broken vector model or quota exhaustion in /system/errors.
        log.warn("embed_failed", { err: err instanceof Error ? err.message : String(err) });
      }
    }
    report.brain_dump = { processed: batch.length, success, remaining: missing.length - batch.length };
    totalProcessed += batch.length;
    totalSuccess += success;
  }

  // ── reflection ──
  {
    const embedded = await prisma.vectorEmbedding
      .findMany({ where: { sourceType: "reflection" }, select: { sourceId: true }, orderBy: { createdAt: "desc" }, take: 5000 });
    const embeddedSet = new Set(embedded.map((e) => e.sourceId));
    const refls = await prisma.reflection.findMany({
      where: { deletedAt: null }, // v10.0.68
      orderBy: { createdAt: "desc" },
      select: { id: true, insight: true, evidence: true, category: true, date: true },
      take: 200,
    });
    const missing = refls.filter((r) => !embeddedSet.has(r.id) && r.insight && r.insight.length > 30);
    const batch = missing.slice(0, BATCH_PER_TYPE);
    let success = 0;
    for (const r of batch) {
      try {
        await storeGenericEmbedding(
          "reflection",
          r.id,
          `[reflection ${r.category} ${r.date}] ${r.insight}\nevidence: ${r.evidence}`.slice(0, 2000),
        );
        success++;
      } catch (err) {
        // v10.0.39 — surface persistent embedding failures instead
        // of silently ratcheting `report` to 0. Operator can spot a
        // broken vector model or quota exhaustion in /system/errors.
        log.warn("embed_failed", { err: err instanceof Error ? err.message : String(err) });
      }
    }
    report.reflection = { processed: batch.length, success, remaining: missing.length - batch.length };
    totalProcessed += batch.length;
    totalSuccess += success;
  }

  // ── strategic_law ──
  {
    const embedded = await prisma.vectorEmbedding
      .findMany({ where: { sourceType: "strategic_law" }, select: { sourceId: true }, orderBy: { createdAt: "desc" }, take: 5000 });
    const embeddedSet = new Set(embedded.map((e) => e.sourceId));
    const laws = await prisma.strategicLaw.findMany({
      select: { id: true, book: true, number: true, shortTitle: true, essence: true, nourApplication: true },
    });
    const missing = laws.filter((l) => !embeddedSet.has(l.id));
    const batch = missing.slice(0, BATCH_PER_TYPE);
    let success = 0;
    for (const l of batch) {
      try {
        await storeGenericEmbedding(
          "strategic_law",
          l.id,
          `[law ${l.book} #${l.number}] ${l.shortTitle}. ${l.essence}\nApply: ${l.nourApplication}`.slice(0, 2000),
        );
        success++;
      } catch (err) {
        // v10.0.39 — surface persistent embedding failures instead
        // of silently ratcheting `report` to 0. Operator can spot a
        // broken vector model or quota exhaustion in /system/errors.
        log.warn("embed_failed", { err: err instanceof Error ? err.message : String(err) });
      }
    }
    report.strategic_law = { processed: batch.length, success, remaining: missing.length - batch.length };
    totalProcessed += batch.length;
    totalSuccess += success;
  }

  // ── chat_message (assistant only, ≥60 chars, most-recent bias) ──
  {
    const embedded = await prisma.vectorEmbedding
      .findMany({ where: { sourceType: "chat_message" }, select: { sourceId: true }, orderBy: { createdAt: "desc" }, take: 5000 });
    const embeddedSet = new Set(embedded.map((e) => e.sourceId));
    const msgs = await prisma.chatMessage.findMany({
      where: { role: "assistant", content: { not: "" } },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: { id: true, content: true, createdAt: true },
    });
    const missing = msgs.filter((m) => !embeddedSet.has(m.id) && m.content.length >= 60);
    const batch = missing.slice(0, BATCH_PER_TYPE);
    let success = 0;
    for (const m of batch) {
      try {
        await storeGenericEmbedding(
          "chat_message",
          m.id,
          `[assistant ${m.createdAt.toISOString().slice(0, 10)}] ${m.content}`.slice(0, 2000),
        );
        success++;
      } catch (err) {
        // v10.0.39 — surface persistent embedding failures instead
        // of silently ratcheting `report` to 0. Operator can spot a
        // broken vector model or quota exhaustion in /system/errors.
        log.warn("embed_failed", { err: err instanceof Error ? err.message : String(err) });
      }
    }
    report.chat_message = { processed: batch.length, success, remaining: missing.length - batch.length };
    totalProcessed += batch.length;
    totalSuccess += success;
  }

  const totalRemaining = Object.values(report).reduce((s, v) => s + v.remaining, 0);
  return {
    status: totalRemaining === 0 ? "complete" : "in_progress",
    totalProcessed,
    totalSuccess,
    totalRemaining,
    report,
  };
});
