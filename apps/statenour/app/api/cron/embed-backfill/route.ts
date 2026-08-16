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
import { TELEMETRY_CATEGORY_LIST } from "@/lib/brain/embedding-policy";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/embed-backfill");

export const maxDuration = 60;

const BATCH_PER_TYPE = 15;

/**
 * brain_memory gets its own, larger batch. The other source types are genuinely
 * steady-state; brain_memory had a 12,791-row backlog (83.5% of the table) that
 * the shared 15 could never have drained.
 */
const BRAIN_BATCH = 100;


export const GET = cronHandler(async () => {
  const report: Record<string, { processed: number; success: number; remaining: number }> = {};
  let totalProcessed = 0;
  let totalSuccess = 0;

  // ── brain_memory ──
  {
    // 2026-08-16 · this block could not drain, and the shape of the bug is worth
    // keeping. It was:
    //
    //   embedded = vectorEmbedding.findMany({ take: 5000 })          // truncated
    //   memories = brainMemory.findMany({ orderBy: confidence desc, take: 200 })
    //   missing  = memories.filter(m => !embeddedSet.has(m.id))
    //
    // The candidate set was a FIXED WINDOW, not a queue: the same top-200 rows
    // by confidence every run. Measured on prod, the floor of that window was
    // confidence 1.0 — 9,490 active rows sit at the ceiling — so `take: 200`
    // never descended past it and 6,182 rows below the floor could never be
    // selected at ANY cadence. Result: 12,791 of 15,317 active memories (83.5%)
    // had no embedding, and recall is a vector search, so an unembedded row is
    // not a weak memory, it is an absent one.
    //
    // It also inverted value. Bulk-imported chunks are stamped confidence 1.0
    // while reasoned memories carry calibrated confidence, so the window
    // admitted 7,069 archive_document chunks and excluded `insight` (1 of 78 at
    // the ceiling), `chat_summary` (0 of 70) and `nick_advice` (69 of 502) —
    // the distilled layers, excluded precisely for being honest.
    //
    // The fix is to ask the database for rows that are ACTUALLY unembedded, as
    // an anti-join, so embedded rows drop out and the query always advances.
    // Ordering stays confidence-first (still the right priority) but with `id`
    // as a stable tiebreak, and the LIMIT now bounds work instead of defining
    // the candidate universe.
    const missing = await prisma.$queryRaw<
      { id: string; category: string; key: string; content: string }[]
    >`
      SELECT bm.id, bm.category, bm.key, bm.content
      FROM brain_memories bm
      WHERE bm.deleted_at IS NULL
        AND bm.confidence >= 0.2
        AND NOT (bm.category = ANY(${TELEMETRY_CATEGORY_LIST}))
        AND NOT EXISTS (
          SELECT 1 FROM vector_embeddings v
          WHERE v."sourceType" = 'brain_memory' AND v."sourceId" = bm.id
        )
      ORDER BY bm.confidence DESC, bm.id
      LIMIT ${BRAIN_BATCH}
    `;
    const batch = missing;
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
    // `remaining` used to be `missing.length - batch.length`, which was always 0
    // once the fixed window was exhausted — it reported "nothing left" while
    // 12,791 rows sat dark. Count the real backlog instead.
    const [{ n: remaining }] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n
      FROM brain_memories bm
      WHERE bm.deleted_at IS NULL
        AND bm.confidence >= 0.2
        AND NOT (bm.category = ANY(${TELEMETRY_CATEGORY_LIST}))
        AND NOT EXISTS (
          SELECT 1 FROM vector_embeddings v
          WHERE v."sourceType" = 'brain_memory' AND v."sourceId" = bm.id
        )
    `;
    report.brain_memory = { processed: batch.length, success, remaining: Number(remaining) };
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

  // ── situation_log (silo wave · audit 2026-07-15) ──
  // Was invisible to all semantic recall: only convergence scans wrote
  // raw vector rows. Mirrors the reflection block above.
  {
    const embedded = await prisma.vectorEmbedding
      .findMany({ where: { sourceType: "situation_log" }, select: { sourceId: true }, orderBy: { createdAt: "desc" }, take: 5000 });
    const embeddedSet = new Set(embedded.map((e) => e.sourceId));
    const situations = await prisma.situationLog.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, situation: true, context: true, outcome: true, lessonLearned: true },
      take: 200,
    });
    const missing = situations.filter((s) => !embeddedSet.has(s.id) && s.situation.length > 30);
    const batch = missing.slice(0, BATCH_PER_TYPE);
    let success = 0;
    for (const s of batch) {
      try {
        const extra = [s.outcome, s.lessonLearned].filter(Boolean).join(" · ");
        await storeGenericEmbedding(
          "situation_log",
          s.id,
          `[situation ${s.context}] ${s.situation}${extra ? `\n${extra}` : ""}`.slice(0, 2000),
        );
        success++;
      } catch (err) {
        log.warn("embed_failed", { err: err instanceof Error ? err.message : String(err) });
      }
    }
    report.situation_log = { processed: batch.length, success, remaining: missing.length - batch.length };
    totalProcessed += batch.length;
    totalSuccess += success;
  }

  // ── decision_replay (silo wave · audit 2026-07-15) ──
  {
    const embedded = await prisma.vectorEmbedding
      .findMany({ where: { sourceType: "decision_replay" }, select: { sourceId: true }, orderBy: { createdAt: "desc" }, take: 5000 });
    const embeddedSet = new Set(embedded.map((e) => e.sourceId));
    const replays = await prisma.decisionReplay.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, choiceMade: true, reasoning: true, outcome: true, lesson: true },
      take: 200,
    });
    const missing = replays.filter((d) => !embeddedSet.has(d.id) && d.title.length > 3);
    const batch = missing.slice(0, BATCH_PER_TYPE);
    let success = 0;
    for (const d of batch) {
      try {
        const parts = [
          `[decision] ${d.title} — chose: ${d.choiceMade}`,
          d.reasoning ? `why: ${d.reasoning}` : null,
          d.outcome ? `outcome: ${d.outcome}` : null,
          d.lesson ? `lesson: ${d.lesson}` : null,
        ].filter(Boolean);
        await storeGenericEmbedding("decision_replay", d.id, parts.join("\n").slice(0, 2000));
        success++;
      } catch (err) {
        log.warn("embed_failed", { err: err instanceof Error ? err.message : String(err) });
      }
    }
    report.decision_replay = { processed: batch.length, success, remaining: missing.length - batch.length };
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

  // ── greene_law (AG-31 · Wave Z corpus · actions-bearing store) ──
  // ~164 one-time embeds, then static — the matcher's vector fallback
  // reads this namespace when keyword triggers miss a paraphrase.
  {
    const embedded = await prisma.vectorEmbedding
      .findMany({ where: { sourceType: "greene_law" }, select: { sourceId: true }, orderBy: { createdAt: "desc" }, take: 5000 });
    const embeddedSet = new Set(embedded.map((e) => e.sourceId));
    const laws = await prisma.brainMemory.findMany({
      where: { category: "greene_law", deletedAt: null },
      select: { key: true, metadata: true },
      take: 500,
    });
    const missing = laws.filter((l) => !embeddedSet.has(l.key));
    const batch = missing.slice(0, BATCH_PER_TYPE);
    let success = 0;
    for (const l of batch) {
      try {
        const meta = (l.metadata ?? {}) as { title?: string; summary?: string; triggers?: string[] };
        const triggers = Array.isArray(meta.triggers) ? meta.triggers.slice(0, 12).join(", ") : "";
        await storeGenericEmbedding(
          "greene_law",
          l.key,
          `${meta.title ?? l.key}. ${meta.summary ?? ""}\nTriggers: ${triggers}`.slice(0, 2000),
        );
        success++;
      } catch (err) {
        log.warn("embed_failed", { err: err instanceof Error ? err.message : String(err) });
      }
    }
    report.greene_law = { processed: batch.length, success, remaining: missing.length - batch.length };
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
