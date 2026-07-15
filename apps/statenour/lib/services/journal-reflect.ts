/**
 * lib/services/journal-reflect.ts · Phase TT.2 (2026-05-22 ·
 * legacy-modernizer REST→tRPC journal slice).
 *
 * The structured-reflection write path, extracted verbatim from the
 * POST /api/ultron/reflect handler so the legacy REST route and the
 * new `journal.reflect` tRPC procedure call the SAME function · drift
 * structurally impossible.
 *
 * Behaviour is byte-for-byte the pre-extraction route:
 *   1. per-template required-field check (≥1 non-empty field)
 *   2. Reflection row create (scope="triggered", category="reflection")
 *   3. brain-bus emit (fire-and-forget)
 *   4. opt-in ingestJournal extraction (fire-and-forget)
 *   5. optional Nick pushback counter-question via tracedAiChat
 *   6. next-step suggestion (bet | memory-check)
 *
 * The route keeps its own auth + rate-limit + safeParseBody wrapper ·
 * this service is the pure domain logic underneath. It throws
 * ReflectFieldError when no field is filled so both transports map it
 * to a 400 / BAD_REQUEST identically.
 */

import { prisma } from "@/lib/prisma";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { toDateString } from "@/lib/utils/datetime";
import { emitReflectionCreated } from "@/lib/db/brain-bus-emit";
import { logger as rootLogger } from "@/lib/logger";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { ingestJournal } from "@/lib/brain/journal-ingest";
import { applyOperatorStyle } from "@/lib/ai/style-adapter";
import { creditFromSignal } from "@/lib/mastery/credit-signal";
import type { ReflectSubmitInput } from "@/lib/validators/journal";

const log = rootLogger.withSurface("services/journal-reflect");

type Template = ReflectSubmitInput["template"];

/** Thrown when a reflection submission has zero non-empty fields. */
export class ReflectFieldError extends Error {
  constructor(message = "at least one field required") {
    super(message);
    this.name = "ReflectFieldError";
  }
}

const TEMPLATE_KEYS: Record<Template, string[]> = {
  soap: ["subjective", "objective", "assessment", "plan"],
  driscoll: ["what", "so_what", "now_what"],
  ssc: ["stop", "start", "continue"],
  aar: ["expected", "happened", "lesson", "adjust"],
};

const TEMPLATE_LABELS: Record<Template, string> = {
  soap: "SOAP",
  driscoll: "What / So What / Now What",
  ssc: "Stop / Start / Continue",
  aar: "After-Action Review",
};

export interface ReflectResult {
  reflection: {
    id: string;
    category: string;
    insight: string;
    date: string;
    scope: string;
  };
  pushback: string | null;
  nextStep: "bet" | "memory-check" | "done";
  extractionFired: boolean;
}

/**
 * Create a structured Reflection from a template submission. Mirrors
 * the legacy POST /api/ultron/reflect handler exactly. Throws
 * ReflectFieldError when no field is filled.
 */
export async function createReflection(
  input: ReflectSubmitInput,
): Promise<ReflectResult> {
  const expectedKeys = TEMPLATE_KEYS[input.template];
  const fieldLines: string[] = [];
  let nonEmpty = 0;
  for (const k of expectedKeys) {
    const v = (input.fields[k] ?? "").trim();
    if (v) {
      nonEmpty++;
      fieldLines.push(`**${k.replace(/_/g, " ").toUpperCase()}**: ${v}`);
    }
  }
  if (nonEmpty === 0) {
    throw new ReflectFieldError();
  }

  const insight = fieldLines.join("\n\n");
  const dateStr = toDateString(new Date());

  // Build evidence string so the existing Journal feed can show source.
  const evidenceParts: string[] = [`template: ${TEMPLATE_LABELS[input.template]}`];
  if (input.mood) evidenceParts.push(`mood: ${input.mood}`);

  const reflection = await prisma.reflection.create({
    data: {
      date: dateStr,
      scope: "triggered",
      category: "reflection",
      insight,
      evidence: evidenceParts.join(" · "),
      confidence: 0.75,
      actionable: input.template === "ssc" || input.template === "aar",
      acknowledged: true,
      metadata: {
        template: input.template,
        fields: input.fields,
        mood: input.mood ?? null,
        createdFrom: "ultron-reflect",
      },
    },
  });

  // Silo wave (audit 2026-07-15) · reflections carried the grounding
  // columns but were never enriched live (brain_dump was the only silo
  // with a live enrich). Fire-and-forget; the enrichedAt-null resweep
  // is the durability net.
  void (async () => {
    try {
      const { enrichJournalEntry } = await import("@/lib/brain/journal-brain");
      await enrichJournalEntry("reflection", reflection.id, insight);
    } catch { /* resweep retries */ }
  })();

  // brain-bus emit on reflection creation · fire-and-forget; never
  // blocks the primary write.
  void emitReflectionCreated({
    reflectionId: reflection.id,
    date: dateStr,
    scope: "triggered",
    category: "reflection",
    insight: insight.slice(0, 280),
    actionable: reflection.actionable,
  });

  // Ambition/Mastery · credit the character sheet for this reflection. The
  // daily-reflection replaced the retired daily-score but fed ZERO XP by any
  // path (the backfill cron sweeps chat/captures/decisions, not reflections),
  // so showing up daily earned nothing. Idempotent by sourceKey; the AI
  // attributor returns null for no-skill entries (the noise floor). Never throws.
  void creditFromSignal("journal", {
    text: insight,
    sourceKey: `journal:${reflection.id}`,
  });

  // Opt-in extraction · when the operator toggled "extract action
  // items" the reflection text also flows through ingestJournal · same
  // pipeline brain-dump capture uses. Fire-and-forget so the pushback
  // round-trip below isn't blocked.
  let extractionFired = false;
  if (input.extractIntelligence) {
    extractionFired = true;
    // creditXp:false — the reflection already credited this text above under
    // journal:<reflectionId>; ingestJournal must NOT re-credit it (would double).
    void ingestJournal(insight, "manual", { creditXp: false }).catch((err) => {
      log.warn("reflect_ingest_failed", {
        reflectionId: reflection.id,
        error: sanitizeError(err),
      });
    });
  }

  // ── Optional Nick pushback — ONE counter-question ──
  let pushback: string | null = null;
  if (input.askPushback !== false) {
    try {
      const sysBase = `You are Nick's "reflector" persona. Nour just wrote a structured reflection. Your job: offer ONE counter-question (one sentence, under 20 words) that would open up his thinking or challenge an assumption. Never more than one question. No preamble, no advice, just the question. Output ONLY the question.`;
      // Append the operator's 8-axis style addendum · pushback inherits
      // the same blunt/cushioned · serious/playful tells the operator
      // has been training via chat thumbs.
      const sys = await applyOperatorStyle(sysBase);
      const usr = `Template: ${TEMPLATE_LABELS[input.template]}\n\n${insight}`;
      const resp = await tracedAiChat(
        {
          label: "ultron-reflect-pushback",
          source: "tool",
          metadata: { template: input.template },
        },
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
      // Log instead of swallow · the reflection itself still saved.
      log.warn("pushback_failed", {
        reflectionId: reflection.id,
        template: input.template,
        error: sanitizeError(err),
      });
    }
  }

  // Suggest next step based on what was logged.
  const nextStep: "bet" | "memory-check" | "done" =
    input.template === "aar" || input.template === "driscoll"
      ? "bet"
      : "memory-check";

  return {
    reflection: {
      id: reflection.id,
      category: reflection.category,
      insight: reflection.insight,
      date: reflection.date,
      scope: reflection.scope,
    },
    pushback,
    nextStep,
    extractionFired,
  };
}
