// CP7 · force-dynamic · Railway build cannot reach Neon during static
// prerender. Runtime semantics unchanged (cached() makes these effectively
// dynamic on Vercel too).
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { toDateString } from "@/lib/utils/datetime";
import { emitReflectionCreated } from "@/lib/db/brain-bus-emit";
import { logger as rootLogger } from "@/lib/logger";
import { safeParseBody } from "@/lib/utils/http";
import { checkAiRateLimit } from "@/lib/rate-limit";
// v10.0.529.25 · /journal audit #R · close the ReflectComposer
// routing inconsistency. When the operator opts in, the reflection
// also flows through the brain-dump ingest pipeline (AI extraction
// → task INBOX → commitments → embeddings) so action items inside a
// reflection don't silently drop on the floor.
import { ingestJournal } from "@/lib/brain/journal-ingest";
import { creditFromSignal } from "@/lib/mastery/credit-signal";
// v10.0.529.34 · Arc B F7 · apply the operator's 8-axis preference
// style to Nick's pushback counter-question · same dial as /chat ·
// "one consistent voice across surfaces."
import { applyOperatorStyle } from "@/lib/ai/style-adapter";

const log = rootLogger.withSurface("api/ultron/reflect");

import { requireSession } from "@/lib/auth-guard";
import { sanitizeError } from "@/lib/utils/sanitize-error";
/**
 * POST /api/ultron/reflect
 *
 * Creates a structured Reflection from a template submission. Optionally
 * asks Nick for ONE counter-question to push back on Nour's reasoning
 * (opens the loop instead of closing it — gets fuller thinking).
 *
 * Body:
 *   {
 *     template: "soap" | "driscoll" | "ssc" | "aar",
 *     fields:   Record<string, string>,    // template-specific fields
 *     mood?:    string,                     // emoji or word
 *     askPushback?: boolean,                // default true
 *   }
 *
 * Returns:
 *   {
 *     reflection: { id, category, insight, date, scope },
 *     pushback: string | null,
 *     nextStep: "bet" | "memory-check" | "done",
 *   }
 *
 * Stores the full content in Reflection.insight, the field breakdown in
 * metadata, and mood as a category keyword. Uses existing Reflection
 * table (scope="triggered", category="reflection").
 */

type Template = "soap" | "driscoll" | "ssc" | "aar";

// v10.0.227 · Zod input schema · catches bad clients before they
// hit prisma. Per-template required-field enforcement happens in
// the handler since each template has a different field set.
const inputSchema = z.object({
  template: z.enum(["soap", "driscoll", "ssc", "aar"]),
  fields: z.record(z.string(), z.string().max(5000)),
  mood: z.string().max(64).optional(),
  askPushback: z.boolean().optional(),
  // v10.0.529.25 · /journal audit #R · opt-in extraction. Defaults
  // OFF so existing operator flows are unchanged. When TRUE the
  // reflection's combined-fields text gets piped through ingestJournal
  // alongside the Reflection-row create · produces a BrainDump row
  // PLUS extracted task INBOX entries, commitments, insights, and
  // pgvector embedding for the reflection text.
  extractIntelligence: z.boolean().optional(),
});

const TEMPLATE_KEYS: Record<Template, string[]> = {
  soap:     ["subjective", "objective", "assessment", "plan"],
  driscoll: ["what",        "so_what",   "now_what"],
  ssc:      ["stop",        "start",     "continue"],
  aar:      ["expected",    "happened",  "lesson",   "adjust"],
};

const TEMPLATE_LABELS: Record<Template, string> = {
  soap:     "SOAP",
  driscoll: "What / So What / Now What",
  ssc:      "Stop / Start / Continue",
  aar:      "After-Action Review",
};

export async function POST(req: Request) {
  await requireSession(req);

  // v10.0.227 · rate-limit AI-adjacent routes consistently · the
  // pushback call uses tracedAiChat so the same budget should apply.
  const rateLimited = checkAiRateLimit(req);
  if (rateLimited) return rateLimited;

  // v10.0.227 · safeParseBody surfaces field-level errors with a
  // 400 + zod issues instead of swallowing into a generic "template
  // + fields required" message.
  const parsed = await safeParseBody(inputSchema, req, "api/ultron/reflect");
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  try {
    const expectedKeys = TEMPLATE_KEYS[body.template];
    const fieldLines: string[] = [];
    let nonEmpty = 0;
    for (const k of expectedKeys) {
      const v = (body.fields[k] ?? "").trim();
      if (v) {
        nonEmpty++;
        fieldLines.push(`**${k.replace(/_/g, " ").toUpperCase()}**: ${v}`);
      }
    }
    if (nonEmpty === 0) {
      return NextResponse.json({ error: "at least one field required" }, { status: 400 });
    }

    const insight = fieldLines.join("\n\n");
    const dateStr = toDateString(new Date());

    // Build evidence string so the existing Journal feed can show source
    const evidenceParts: string[] = [`template: ${TEMPLATE_LABELS[body.template]}`];
    if (body.mood) evidenceParts.push(`mood: ${body.mood}`);

    const reflection = await prisma.reflection.create({
      data: {
        date: dateStr,
        scope: "triggered",
        category: "reflection",
        insight,
        evidence: evidenceParts.join(" · "),
        confidence: 0.75,
        actionable: body.template === "ssc" || body.template === "aar",
        acknowledged: true,
        metadata: {
          template: body.template,
          fields: body.fields,
          mood: body.mood ?? null,
          createdFrom: "ultron-reflect",
        },
      },
    });

    // Ambition/Mastery · credit the character sheet for this reflection (the
    // daily-score replacement fed ZERO XP before). Idempotent by sourceKey
    // (shared with the journal-reflect service path so they can't double-count);
    // null for no-skill entries (the noise floor). Never throws.
    void creditFromSignal("journal", {
      text: insight,
      sourceKey: `journal:${reflection.id}`,
    });

    // Silo wave (audit 2026-07-15) · live grounding enrichment — this
    // legacy route duplicates journal-reflect.ts's create, so it gets
    // the same fire-and-forget enrich (resweep is the durability net).
    void (async () => {
      try {
        const { enrichJournalEntry } = await import("@/lib/brain/journal-brain");
        await enrichJournalEntry("reflection", reflection.id, insight);
      } catch { /* resweep retries */ }
    })();

    // v10.0.78 · brain-bus emit on reflection creation. Downstream
    // learning-journal + wisdom-distiller can subscribe instead of
    // polling. Fire-and-forget; never blocks the primary write.
    void emitReflectionCreated({
      reflectionId: reflection.id,
      date: dateStr,
      scope: "triggered",
      category: "reflection",
      insight: insight.slice(0, 280),
      actionable: reflection.actionable,
    });

    // v10.0.529.25 · /journal audit #R · opt-in extraction. When the
    // operator toggled "extract action items" the reflection text
    // also flows through ingestJournal · same pipeline brain-dump
    // capture uses · so action items / commitments / insights /
    // embeddings get derived from the reflection too. Fire-and-forget
    // so the pushback round-trip below isn't blocked; failures land
    // in /system/errors via the logger inside ingestJournal. The
    // BrainDump row this creates is intentional · it's the
    // extraction-side artifact, distinct from the Reflection row
    // above (which stays the template-aware structured record).
    let extractionFired = false;
    if (body.extractIntelligence) {
      extractionFired = true;
      void ingestJournal(insight, "manual").catch((err) => {
        log.warn("reflect_ingest_failed", {
          reflectionId: reflection.id,
          error: sanitizeError(err),
        });
      });
    }

    // ── Optional Nick pushback — ONE counter-question ──
    let pushback: string | null = null;
    if (body.askPushback !== false) {
      try {
        const sysBase = `You are Nick's "reflector" persona. Nour just wrote a structured reflection. Your job: offer ONE counter-question (one sentence, under 20 words) that would open up his thinking or challenge an assumption. Never more than one question. No preamble, no advice, just the question. Output ONLY the question.`;
        // v10.0.529.34 · append the operator's 8-axis style addendum ·
        // pushback inherits the same blunt/cushioned · serious/playful
        // · etc tells the operator's been training via chat thumbs.
        const sys = await applyOperatorStyle(sysBase);
        const usr = `Template: ${TEMPLATE_LABELS[body.template]}\n\n${insight}`;
        const resp = await tracedAiChat(
          { label: "ultron-reflect-pushback", source: "tool", metadata: { template: body.template } },
          [
            { role: "system", content: sys },
            { role: "user", content: usr },
          ],
          "fast",
        );
        const cleaned = resp.content
          .trim()
          .replace(/^["']|["']$/g, "")
          .split("\n")[0]
          .trim();
        if (cleaned && cleaned.length > 5 && cleaned.length < 220) {
          pushback = cleaned.endsWith("?") ? cleaned : cleaned + "?";
        }
      } catch (err) {
        // v10.0.227 · log instead of swallow · pre-fix this catch
        // hid 100% of pushback failures · operator never knew Nick
        // was failing to push back. Log + continue is the right
        // behavior · the reflection itself still saved.
        log.warn("pushback_failed", {
          reflectionId: reflection.id,
          template: body.template,
          error: sanitizeError(err),
        });
      }
    }

    // Suggest next step based on what was logged
    const nextStep: "bet" | "memory-check" | "done" =
      body.template === "aar" || body.template === "driscoll"
        ? "bet"
        : "memory-check";

    return NextResponse.json({
      data: {
        reflection: {
          id: reflection.id,
          category: reflection.category,
          insight: reflection.insight,
          date: reflection.date,
          scope: reflection.scope,
        },
        pushback,
        nextStep,
        // v10.0.529.25 · echo back whether the extract pipeline fired
        // so the composer can toast "+ extraction running" · gives the
        // operator visible confirmation the toggle did something.
        extractionFired,
      },
    });
  } catch (err) {
    // v10.0.227 · don't leak server internals to the client. Pre-fix
    // we returned String(err) which spilled stack traces / SQL
    // query text on prisma errors. Log full detail server-side,
    // return a generic message + a request-trace id the operator
    // can search for in /system/errors.
    log.error("reflect_route_failed", {
      err: sanitizeError(err),
      stack: err instanceof Error ? err.stack?.slice(0, 800) : undefined,
    });
    return NextResponse.json(
      { error: "reflection-save failed · check /system/errors for detail" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/ultron/reflect?window=7d
 *
 * Summary of recent reflection activity — used by the Ultron signal zone
 * to decide whether to surface the "reflect tonight?" nudge.
 */
export async function GET(req: Request) {
  // v10.0.529.105 · Wave 49 · was UNAUTHENTICATED · leaked reflection
  // count + dates + days-since (behavioral PII). POST was auth-gated.
  await requireSession(req);
  try {
    const url = new URL(req.url);
    const windowDays = Number(url.searchParams.get("window") ?? 7);

    const recent = await prisma.reflection
      .findMany({
        where: {
          createdAt: { gte: new Date(Date.now() - windowDays * 86400000) },
          scope: { in: ["triggered", "daily"] },
        },
        orderBy: { createdAt: "desc" },
        take: 14,
        select: { id: true, date: true, category: true, createdAt: true },
      })
      .catch(() => []);

    const todayStr = toDateString(new Date());
    const todaysCount = recent.filter((r) => r.date === todayStr).length;
    const lastReflectionDate = recent[0]?.date ?? null;
    const daysSinceReflection = lastReflectionDate
      ? Math.floor((Date.now() - new Date(lastReflectionDate + "T12:00:00").getTime()) / 86400000)
      : 999;

    return NextResponse.json({
      data: {
        todaysCount,
        totalInWindow: recent.length,
        lastReflectionDate,
        daysSinceReflection,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
