/**
 * /api/cron/canary-chat · v10.0.346 · Phase 2 final · Cat 8 hardening.
 *
 * Synthetic canary that exercises the chat lane end-to-end on a
 * schedule. Uses the same model + sanitizer + critic stack as
 * /api/ai/chat so any drift surfaces here BEFORE Nour hits it.
 *
 * Auth · CRON_SECRET via Bearer header (same as other crons · no fake
 * user account needed · the canary is a server-side scheduled probe,
 * not a simulated login).
 *
 * Probes:
 *   1. Fire a deterministic prompt at the model
 *   2. Sanitize the response (matches production path)
 *   3. Run deterministic checks · word count, must-mention, must-not
 *   4. Run critic for quality score
 *   5. If anything fails → write brainMemory category=integrity_alert
 *   6. Return JSON summary
 *
 * Cost · ~$0.0003 per call (Venice text · 5k input + 200 output) ·
 * hourly cadence = ~$2/year. Effectively free.
 *
 * Schedule (registered in config/crons.ts as `canary-chat` ·
 * FOLDED into mega-morning per the manifest entry · category=alert):
 *   · daily text-canary · catches drift each morning before operator
 *   · weekly image-canary · catches gpt-image-1 drift cheaply (~$10/yr)
 *
 * Per docs/glitch-taxonomy.md · Category 8 (operational silence) ·
 * "synthetic canary user" prevention mechanism.
 */

import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/auth-guard";
import { ServiceError } from "@/lib/utils/service-error";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Canary prompt · deterministic input that exercises the brand-context
 * + recall + critic path. NOT business-impact · purely for probe value.
 */
const CANARY_PROMPT =
  "Briefly · what's one thing Nick's Tire does well? Answer in 2 sentences max.";

interface CanaryCheck {
  name: string;
  pass: boolean;
  detail?: string;
}

interface CanaryResult {
  ok: boolean;
  durationMs: number;
  responseLength: number;
  responsePreview: string;
  checks: CanaryCheck[];
  criticOverall: number | null;
  provider: string | null;
  model: string | null;
}

export async function POST(req: Request) {
  try {
    requireCronAuth(req);
  } catch (e) {
    if (e instanceof ServiceError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const result: CanaryResult = {
    ok: false,
    durationMs: 0,
    responseLength: 0,
    responsePreview: "",
    checks: [],
    criticOverall: null,
    provider: null,
    model: null,
  };

  try {
    // Run the model directly through the production provider stack.
    // Don't go through /api/ai/chat · that requires a session and
    // doubles the auth surface · we just need the model+sanitizer
    // path which is the actual quality probe.
    const { generateText } = await import("ai");
    const { getModel, getToolProviderInfo } = await import("@/lib/ai/provider");

    // TaskType "fast" matches the daily-driver chat lane (venice-uncensored)
    const model = getModel("fast");
    const providerInfo = getToolProviderInfo();
    result.provider = providerInfo.provider;
    result.model = providerInfo.modelId;

    const { text } = await generateText({
      model,
      messages: [{ role: "user", content: CANARY_PROMPT }] as never,
      maxOutputTokens: 200,
      temperature: 0.5,
      abortSignal: AbortSignal.timeout(30000),
    });

    // Sanitize · matches production path
    const { sanitizeResponse } = await import("@/lib/ai/output-sanitizer");
    const cleaned = sanitizeResponse(text).cleaned;

    result.durationMs = Date.now() - startedAt;
    result.responseLength = cleaned.length;
    result.responsePreview = cleaned.slice(0, 200);

    // ── Deterministic checks ─────────────────────────────────────
    result.checks.push({
      name: "non_empty",
      pass: cleaned.trim().length > 0,
      detail: `${cleaned.length} chars`,
    });

    const wc = cleaned.trim().split(/\s+/).filter(Boolean).length;
    result.checks.push({
      name: "word_count_in_range",
      pass: wc >= 5 && wc <= 200,
      detail: `${wc} words`,
    });

    result.checks.push({
      name: "no_xml_template_leak",
      pass: !/<request>|<instruction>|<think>/i.test(cleaned),
      detail: "no template chrome detected",
    });

    result.checks.push({
      name: "no_filler_lead",
      pass: !/^(certainly|of course|absolutely|sure thing|happy to help|as an ai)/i.test(
        cleaned,
      ),
      detail: "no generic LLM lead",
    });

    result.checks.push({
      name: "latency_under_30s",
      pass: result.durationMs < 30000,
      detail: `${result.durationMs}ms`,
    });

    // ── Critic check ─────────────────────────────────────────────
    try {
      const { critiqueOutput } = await import("@/lib/ai/output-critic");
      // OutputShape "prose" matches a 2-sentence factual reply
      const critic = critiqueOutput(cleaned, "prose");
      result.criticOverall = critic.overall ?? null;
      result.checks.push({
        name: "critic_overall_above_60",
        pass: (critic.overall ?? 0) >= 60,
        detail: `critic.overall=${critic.overall ?? "n/a"}`,
      });
    } catch (e) {
      result.checks.push({
        name: "critic_runs",
        pass: false,
        detail: `critic threw: ${(e as Error).message}`,
      });
    }

    result.ok = result.checks.every((c) => c.pass);
  } catch (e) {
    result.durationMs = Date.now() - startedAt;
    result.ok = false;
    result.checks.push({
      name: "model_call_succeeds",
      pass: false,
      detail: (e as Error).message.slice(0, 200),
    });
  }

  // ── Write integrity alert on failure ─────────────────────────────
  if (!result.ok) {
    try {
      const failedChecks = result.checks.filter((c) => !c.pass);
      await prisma.brainMemory.create({
        data: {
          category: BRAIN_CATEGORIES.GLITCH_CAPTURE,
          key: `canary-failure · ${new Date().toISOString().slice(0, 10)}`,
          content: [
            "Canary chat probe FAILED",
            ``,
            `Provider: ${result.provider ?? "unknown"} / ${result.model ?? "unknown"}`,
            `Duration: ${result.durationMs}ms`,
            `Response length: ${result.responseLength} chars`,
            `Response preview: ${result.responsePreview}`,
            ``,
            `Failed checks (${failedChecks.length}):`,
            ...failedChecks.map((c) => `  · ${c.name}: ${c.detail ?? "no detail"}`),
          ].join("\n"),
          confidence: 1,
          seenCount: 1,
          source: "cron/canary-chat",
          metadata: {
            category: "operational-silence",
            note: "automated canary failure · investigate provider + sanitizer + critic stack",
            // Cast to InputJsonObject-compatible shape · CanaryResult's
            // typed interface needs an index signature for Prisma's Json field.
            canary: JSON.parse(JSON.stringify(result)),
            capturedAt: new Date().toISOString(),
          },
        },
      });
    } catch {
      // Persist failure shouldn't break the canary response itself
    }
  }

  return NextResponse.json(result, {
    status: result.ok ? 200 : 503,
  });
}

export async function GET(req: Request) {
  // GET delegates to POST · convenience for manual testing via browser
  return POST(req);
}
