/**
 * POST /api/ai/assist — SUPERCHARGED AI thinking partner
 * Asks questions when needed, pulls memories, stores insights
 */
import { NextRequest, NextResponse } from "next/server";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { safeParseBody, aiRouteError } from "@/lib/utils/http";
import { requireSession } from "@/lib/auth-guard";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { checkAiRateLimit } from "@/lib/rate-limit";
import { logger as rootLogger } from "@/lib/logger";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

const log = rootLogger.withSurface("api/ai/assist");

export const maxDuration = 120; // Pro plan

const schema = z.object({
  type: z.enum(["decision", "commitment", "routine", "project", "general"]),
  context: z.string().min(1).max(5000),
  followUp: z.string().max(3000).optional(),
});

export async function POST(req: NextRequest) {
  await requireSession(req);
  const __aiLimit = checkAiRateLimit(req);
  if (__aiLimit) return __aiLimit; // v9.1.19 · cost-bomb guard
  try {
    // v8.0.1 — safeParse so bad input lands as 400 (not 500 + alert).
    const parsed_in = await safeParseBody(schema, req, "ai/assist");
    if (!parsed_in.ok) return parsed_in.response;
    const { type, context, followUp } = parsed_in.data;

    // Deep memory pull — more context = smarter answers
    let memoryContext = "";
    try {
      const keywords = context.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 6);
      const memories = await prisma.brainMemory.findMany({
        where: {
          OR: [
            ...keywords.map(k => ({ content: { contains: k, mode: "insensitive" as const } })),
            { category: { in: ["lesson", "insight", "preference", "pattern"] } },
          ],
        },
        orderBy: { confidence: "desc" },
        take: 12,
        select: { content: true, category: true, confidence: true, source: true },
      });
      if (memories.length > 0) {
        memoryContext = "\n\nNOUR'S BRAIN (reference specific memories when relevant):\n" +
          memories.map(m => `- [${m.category} · ${(m.confidence * 100).toFixed(0)}%] ${m.content.slice(0, 250)}`).join("\n");
      }
    } catch (err) {
      void import("@/lib/utils/error-log").then(({ logError }) => logError("api.ai.assist", err, { fn: "memoryContext" }, "error"));
    }

    // Recent state for context — Apr 19 · DailyScore retired. Use
    // live signals: open tasks + commitments + brain maturity score +
    // weakest identity axis + unresolved contradictions.
    let stateContext = "";
    try {
      const [loops, commitCount, overdueCommits, openContradictions, snapRow] = await Promise.all([
        prisma.task.count({ where: { status: { in: ["INBOX", "READY", "DOING"] } } }),
        prisma.commitment.count({ where: { status: { in: ["active", "in_progress"] } } }),
        prisma.commitment.count({
          where: {
            status: "active",
            deadline: { lt: new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }) },
          },
        }),
        prisma.brainMemory.count({ where: { category: BRAIN_CATEGORIES.CONTRADICTION, createdAt: { gte: new Date(Date.now() - 14 * 86400_000) } } }),
        prisma.brainMemory.findUnique({
          where: { category_key: { category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: "current" } },
          select: { content: true },
        }).catch((err) => {
          void import("@/lib/utils/error-log").then(({ logError }) => logError("api.ai.assist", err, { fn: "identitySnapshot" }, "error"));
          return null;
        }),
      ]);

      let maturity = "?";
      let weakestAxis: string | null = null;
      if (snapRow?.content) {
        try {
          const snap = JSON.parse(snapRow.content) as { axes: Record<string, { value: number; manual: number | null }> };
          const axes = Object.entries(snap.axes);
          if (axes.length > 0) {
            const avg = Math.round(axes.reduce((s, [, a]) => s + (a.manual ?? a.value), 0) / axes.length);
            maturity = `${avg}/100`;
            const weak = axes.sort(([, a], [, b]) => (a.manual ?? a.value) - (b.manual ?? b.value))[0];
            if (weak && (weak[1].manual ?? weak[1].value) < 50) {
              weakestAxis = `${weak[0]} at ${weak[1].manual ?? weak[1].value}`;
            }
          }
        } catch (err) {
          void import("@/lib/utils/error-log").then(({ logError }) => logError("api.ai.assist", err, { fn: "parseIdentitySnapshot" }, "warn"));
        }
      }

      stateContext = `\n\nCURRENT STATE: ${loops} active tasks · ${commitCount} active commitments${
        overdueCommits > 0 ? ` (${overdueCommits} overdue)` : ""
      } · brain maturity ${maturity}${
        openContradictions > 0 ? ` · ${openContradictions} open contradiction${openContradictions > 1 ? "s" : ""}` : ""
      }${weakestAxis ? ` · weak axis: ${weakestAxis}` : ""}`;
    } catch (err) {
      void import("@/lib/utils/error-log").then(({ logError }) => logError("api.ai.assist", err, { fn: "stateContext" }, "error"));
    }

    const systemPrompts: Record<string, string> = {
      decision: `You are Nick, Nour's $500/hr strategic advisor. Help him DECIDE — not deliberate.

RULES:
1. If input is vague, ask 2-4 SHARP questions (put in "questions" array)
2. Apply SECOND-ORDER thinking: "If X, then Y happens, then Z"
3. Apply INVERSION: "What would make this decision OBVIOUSLY wrong?"
4. Reference specific brain memories that relate
5. Give ONE clear recommendation — not options. Pick one and defend it.
6. State the COST OF INACTION — what happens if he doesn't decide
7. State the REVERSIBILITY — can this be undone?
8. If this is a big decision, suggest logging it for 30-day replay

Respond with JSON:
{
  "response": "300-400 word strategic analysis. Reference memories. Apply frameworks. Be opinionated.",
  "questions": ["Sharp clarifying questions if input is vague"],
  "recommendation": "One clear sentence: DO THIS BECAUSE...",
  "inversion": "This decision would be WRONG if...",
  "costOfInaction": "If you don't decide in N days, this happens...",
  "reversible": true/false,
  "confidence": 0.0-1.0,
  "suggestReplay": true/false,
  "replayDays": 30,
  "relatedMemory": "Most relevant brain memory, if any"
}`,
      commitment: `You are Nick. Nour wants to make or evaluate a commitment.

ANALYZE WITH RIGOR:
1. Is this realistic given his current energy (${stateContext}) and open loops?
2. What's the COST of keeping it vs. the cost of breaking it?
3. Is this commitment aligned with his monthly revenue goal?
4. Should it be a ROUTINE (daily/weekly) or a one-time action?
5. What's the accountability mechanism?
6. What would make this commitment UNNECESSARY? (underlying issue)
7. Score the commitment: effort (1-10) vs. impact (1-10)

Respond with JSON:
{
  "response": "200-300 word analysis",
  "questions": ["Clarifying questions if vague"],
  "isRealistic": true/false,
  "effortScore": 5,
  "impactScore": 5,
  "suggestedDeadline": "YYYY-MM-DD or null",
  "trackingMethod": "Specific way to track this",
  "shouldBeRoutine": true/false,
  "routineSuggestion": { "trigger": "When", "action": "What", "frequency": "How often", "duration": "How long" },
  "underlyingIssue": "The real problem this commitment is trying to solve",
  "accountabilityMechanism": "How to enforce this"
}`,
      routine: `You are Nick, designing a BULLETPROOF routine for Nour.

DESIGN PRINCIPLES:
1. Start EMBARRASSINGLY small (2 minutes max to start)
2. Attach to existing habits (habit stacking)
3. Design for the WORST day, not the best day
4. Remove ALL friction: what gear, what app, what location
5. Build in a "minimum viable" version for bad days
6. Track with a simple binary: did it or didn't
7. Consider Nour's current energy pattern (${stateContext})

Respond with JSON:
{
  "response": "200-250 word routine design",
  "questions": ["Clarifying questions"],
  "routine": {
    "name": "Routine name",
    "trigger": "Exact trigger (after brushing teeth, when alarm rings, etc.)",
    "minVersion": "2-minute bare minimum version",
    "fullVersion": "Full version when energy is high",
    "duration": "Time range",
    "frequency": "Daily/weekly/etc",
    "habitStack": "Attach to: [existing habit]",
    "gear": ["What you need ready"],
    "environment": "Where to do it",
    "streakGoal": "Start with 7 days, then 21, then 66"
  },
  "scienceBehind": "Why this design works (1-2 sentences)",
  "failurePrevention": "What will make you skip this and how to prevent it"
}`,
      project: `You are Nick, a project strategist. Help Nour scope this project.

ANALYZE:
1. Is the scope bigger or smaller than Nour thinks?
2. What are the HIDDEN costs (time, money, energy, opportunity cost)?
3. What's the MVP — the minimum version that delivers 80% of the value?
4. Should Nour DIY or hire? (consider his time = $100/hr minimum)
5. What's the REAL deadline vs. self-imposed deadline?
6. What's blocking this from starting TODAY?
7. What similar project has Nour done before? What can he learn from it?

Respond with JSON:
{
  "response": "250-350 word strategic analysis",
  "questions": ["Clarifying questions"],
  "scopeCheck": "This is BIGGER/SMALLER/RIGHT-SIZED because...",
  "hiddenCosts": ["Hidden cost 1", "Hidden cost 2"],
  "mvp": "The minimum viable version that delivers 80% value",
  "diyVsHire": { "recommendation": "DIY|HIRE|HYBRID", "reasoning": "Why" },
  "firstMove": "The literal thing to do in the next 5 minutes",
  "blocker": "What's actually stopping this from starting today",
  "estimatedCost": { "low": 0, "high": 0 },
  "estimatedTime": "Realistic time estimate"
}`,
      general: `You are Nick, Nour's Chief of Staff. Be DIRECT, STRATEGIC, OPINIONATED.
Reference brain memories when relevant. Apply frameworks. Max 300 words.
If the input is vague, ask 2-3 clarifying questions.
Always end with a specific NEXT ACTION.

Respond with JSON:
{
  "response": "Strategic analysis",
  "questions": ["Follow-up questions if vague"],
  "nextAction": "Specific thing to do right now",
  "framework": "The mental model or framework you applied"
}`,
    };

    // v10.0.249 · Strategic Frameworks injection · same pattern as
     // chat route. When context has business / money / strategy intent,
     // inject a "STRATEGIC LENS" block into the system prompt so the
     // AI reasons through a specific lens (Pricing Power · Inversion ·
     // 5 Whys · Loss Aversion · etc) instead of generic advice. The
     // composer is a no-op if no business intent is detected · safe to
     // call unconditionally.
    let lensBlock = "";
    try {
      const { pickFrameworks, composeStrategicLensBlock } = await import(
        "@/lib/ai/strategic-frameworks"
      );
      const { recordLensFire } = await import(
        "@/lib/ai/strategic-frameworks/record-lens-fire"
      );
      const userInput = followUp ? `${context} ${followUp}` : context;
      lensBlock = composeStrategicLensBlock(userInput);
      if (lensBlock) {
        const matches = pickFrameworks(userInput);
        recordLensFire({
          surface: "assist",
          matches,
          lensBlockLength: lensBlock.length,
          metadata: { assistType: type },
        });
      }
    } catch (err) {
      log.warn("strategic_lens_failed", {
        surface: "assist",
        error: sanitizeError(err),
      });
    }

    // 2026-05-23 · Wave I · operator-state opt-in (3rd surface).
    // Complementary to the existing `stateContext` above (which
    // captures environmental context · open loops / contradictions /
    // weak axis). The operator-state block captures INTERNAL state:
    // mood / focus / capacity / drift / momentum / confidence. Both
    // inject together so Nick sees the full picture.
    let operatorStateBlock = "";
    try {
      const { currentOperatorState, formatOperatorStateBlock } = await import(
        "@/lib/services/operator-state"
      );
      const snap = await currentOperatorState();
      if (snap.confidence > 0) {
        operatorStateBlock = formatOperatorStateBlock(snap);
      }
    } catch (err) {
      void import("@/lib/utils/error-log").then(({ logError }) => logError("api.ai.assist", err, { fn: "operatorState" }, "warn"));
    }

    const messages: { role: "system" | "user"; content: string }[] = [
      {
        role: "system",
        content:
          systemPrompts[type] +
          memoryContext +
          stateContext +
          (lensBlock ? `\n\n${lensBlock}` : "") +
          (operatorStateBlock ? `\n\n${operatorStateBlock}` : ""),
      },
      { role: "user", content: followUp ? `ORIGINAL: ${context}\n\nFOLLOW-UP: ${followUp}` : context },
    ];

    // Use "reason" instead of "deep" — assist responses don't need max
    // reasoning, they need concise actionable output. "deep" was causing
    // 83-word responses when the target is 40-60.
    const result = await tracedAiChat(
      { label: "assist", source: "tool", metadata: { type } },
      messages,
      "reason",
    );

    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(result.content.replace(/```json|```/g, "").trim()); }
    catch (err) {
      parsed = { response: result.content };
      void import("@/lib/utils/error-log").then(({ logError }) => logError("api.ai.assist", err, { fn: "parseAssistResult" }, "warn"));
    }

    // Store insight as memory
    try {
      const rec = typeof parsed.recommendation === "string" ? parsed.recommendation
        : typeof parsed.nextAction === "string" ? parsed.nextAction
        : typeof parsed.firstMove === "string" ? parsed.firstMove
        : null;
      if (rec) {
        // v10.0.234 · deterministic key from content hash · pre-fix
        // used Date.now() so the same context+rec stored twice on
        // retry. Now: hash of (context+rec) so re-firing is a no-op
        // via the brainMemory unique (category, key) constraint.
        const { simpleHash } = await import("@/lib/brain/journal-ingest");
        const dedupeKey = simpleHash(`${context.slice(0, 80)}|${rec.slice(0, 80)}`).slice(0, 10);
        await prisma.brainMemory
          .create({
            data: {
              category: type === "decision" ? "lesson" : "insight",
              key: `assist_${type}_${dedupeKey}`,
              content: `[AI Assist/${type}] ${context.slice(0, 60)}... → ${rec}`,
              source: "ai_assist",
              confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.7,
            },
          })
          .catch((err: unknown) => {
            // Unique constraint violation = same insight already
            // stored, which is exactly what we want · log + continue.
            const code = (err as { code?: string } | null)?.code;
            if (code !== "P2002") throw err;
          });
      }
    } catch (err) {
      void import("@/lib/utils/error-log").then(({ logError }) => logError("api.ai.assist", err, { fn: "storeInsight" }, "error"));
    }

    return NextResponse.json({ ...parsed, type, provider: result.provider, model: result.model, memoriesUsed: memoryContext.length > 0 });
  } catch (err) {
    return aiRouteError(err, "ai/assist", "AI assist failed");
  }
}
