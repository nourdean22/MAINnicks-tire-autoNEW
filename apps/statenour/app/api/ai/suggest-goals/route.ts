/**
 * POST /api/ai/suggest-goals
 *
 * Given a time horizon (DAY/WEEK/MONTH/QUARTER/YEAR/LIFE), ask Nick
 * to suggest 3-5 sharp goals Nour should be working toward at that
 * level. Uses brain memory + active missions + past decisions as
 * context so the suggestions aren't generic.
 *
 * The returned goals match the LifeGoal shape so the client can
 * one-click adopt them via POST /api/goals.
 *
 * Body:
 *   { horizon: "DAY" | "WEEK" | "MONTH" | "QUARTER" | "YEAR" | "LIFE",
 *     domain?: string,   // optional filter
 *     context?: string   // optional Nour-written note
 *   }
 */
import { NextRequest, NextResponse } from "next/server";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
// v10.0.529.37 · Arc B F7 expansion · goal suggestions inherit
// operator-tuned voice tells in their description prose.
import { applyOperatorStyle } from "@/lib/ai/style-adapter";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { safeParseBody, aiRouteError } from "@/lib/utils/http";

import { requireSession } from "@/lib/auth-guard";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { checkAiRateLimit } from "@/lib/rate-limit";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("api/ai/suggest-goals");

export const maxDuration = 120;

const HORIZONS = ["DAY", "WEEK", "MONTH", "QUARTER", "YEAR", "LIFE"] as const;

const schema = z.object({
  horizon: z.enum(HORIZONS).default("WEEK"),
  domain: z.string().optional(),
  context: z.string().max(2000).optional(),
});

const HORIZON_FRAMING: Record<(typeof HORIZONS)[number], string> = {
  DAY: "ONE sharp goal Nour can actually complete before midnight tonight. Think: the single highest-leverage move for today.",
  WEEK: "3 goals that would define a winning week. Aggressive but doable in 5-7 days. Should stack into monthly targets.",
  MONTH: "3-4 goals for the next 30 days. Should connect to Nour's active missions + the $20K/mo revenue target + 186 lbs body target.",
  QUARTER: "3 goals for the next 90 days. These are the bets that actually move life-level metrics. Think compounding: what becomes possible 90 days from now if you nail these?",
  YEAR: "3-5 goals for the next 12 months. Goals at this level should change the shape of Nour's life — new identity, new capability, new compound advantage.",
  LIFE: "3 goals at life-level. Things Nour wants to be TRUE about himself 10 years from now. Identity-level, not achievement-level.",
};

export async function POST(req: NextRequest) {
  await requireSession(req);
  const __aiLimit = checkAiRateLimit(req);
  if (__aiLimit) return __aiLimit; // v9.1.19 · cost-bomb guard
  try {
    // v8.0.1 — safeParse so bad input lands as 400 (not 500 + alert).
    const parsed_in = await safeParseBody(schema, req, "suggest-goals");
    if (!parsed_in.ok) return parsed_in.response;
    const { horizon, domain, context } = parsed_in.data;

    // Pull context: active missions, recent brain memories, existing
    // goals at this horizon so we don't duplicate what's already there.
    const [missions, existingGoals, recentMemories, identitySnap] = await Promise.all([
      prisma.mission.findMany({
        where: { status: "ACTIVE", deletedAt: null },
        take: 10,
        select: { title: true, domain: true, successMetric: true },
      }),
      prisma.lifeGoal.findMany({
        where: { horizon, status: "active", deletedAt: null },
        take: 10,
        select: { title: true, domain: true },
      }),
      prisma.brainMemory.findMany({
        where: {
          category: { in: ["business_context", "insight", "pattern", "feedback"] },
        },
        orderBy: { confidence: "desc" },
        take: 8,
        select: { category: true, content: true },
      }),
      // Apr 19 · DailyScore retired. Brain maturity history replaces
      // the daily score/energy/discipline rollup.
      prisma.brainMemory
        .findUnique({
          where: { category_key: { category: "identity_snapshot", key: "current" } },
          select: { content: true },
        })
        .catch(() => null),
    ]);

    const missionsBlock = missions.length
      ? `ACTIVE MISSIONS:\n${missions.map((m) => `- [${m.domain}] ${m.title}${m.successMetric ? ` (target: ${m.successMetric})` : ""}`).join("\n")}`
      : "";

    const existingBlock = existingGoals.length
      ? `\nEXISTING ${horizon} GOALS (DO NOT DUPLICATE):\n${existingGoals.map((g) => `- [${g.domain}] ${g.title}`).join("\n")}`
      : "";

    const memoryBlock = recentMemories.length
      ? `\nCONTEXT FROM BRAIN:\n${recentMemories.map((m) => `- [${m.category}] ${m.content.slice(0, 200)}`).join("\n")}`
      : "";

    // Apr 19 · Brain maturity replaces daily score averages.
    let scoresBlock = "";
    if (identitySnap?.content) {
      try {
        const snap = JSON.parse(identitySnap.content) as { axes: Record<string, { value: number; manual: number | null }> };
        const axes = Object.entries(snap.axes ?? {});
        if (axes.length > 0) {
          const avg = Math.round(axes.reduce((s, [, a]) => s + (a.manual ?? a.value), 0) / axes.length);
          const weakest = [...axes].sort(([, a], [, b]) => (a.manual ?? a.value) - (b.manual ?? b.value))[0];
          scoresBlock = `\nBRAIN MATURITY: ${avg}/100 · weakest axis: ${weakest[0]} at ${weakest[1].manual ?? weakest[1].value}`;
        }
      } catch {
        // skip
      }
    }

    const prompt = `Nour is Nick's Chief of Staff planning ${horizon.toLowerCase()} goals for himself.

${HORIZON_FRAMING[horizon]}

${missionsBlock}${existingBlock}${memoryBlock}${scoresBlock}
${domain ? `\nFILTER: only suggest goals in the "${domain}" domain.` : ""}
${context ? `\nNOUR SAYS: ${context}` : ""}

Return ONLY valid JSON:
{
  "goals": [
    {
      "title": "Specific, measurable goal — not 'get healthier' but 'drop to 200 lbs'",
      "domain": "business | fitness | finance | personal | career",
      "metric": "short metric name (revenue, weight, pushups, hours_studied)",
      "targetValue": 200,
      "unit": "lbs | $ | hours | count | %",
      "why": "One sentence: the real reason this matters to Nour",
      "firstMove": "THE first physical action Nour should take in the next 24h",
      "milestones": ["checkpoint 1", "checkpoint 2", "checkpoint 3"]
    }
  ],
  "overview": "2-sentence strategic read — what these goals have in common, what they're building toward",
  "warning": "Optional: one risk or common mistake at this horizon"
}`;

    // v10.0.259 · Strategic Frameworks lens injection (7th surface).
    // Goal-suggestion is high-leverage · the lens shapes which kind
    // of goals Nick proposes. North-star-metric fires on metric-heavy
    // goals · ICP fires on customer-segment goals · OKRs fires on
    // quarterly-goal questions · Pareto on focus questions.
    let lensBlock = "";
    try {
      const { pickFrameworks, composeStrategicLensBlock } = await import(
        "@/lib/ai/strategic-frameworks"
      );
      const { recordLensFire } = await import(
        "@/lib/ai/strategic-frameworks/record-lens-fire"
      );
      const lensInput = [
        ...missions.map((m) => `${m.title} ${m.successMetric ?? ""}`),
        ...existingGoals.map((g) => g.title),
        context ?? "",
      ]
        .join(" · ")
        .slice(0, 1200);
      lensBlock = composeStrategicLensBlock(lensInput);
      if (lensBlock) {
        const matches = pickFrameworks(lensInput);
        recordLensFire({
          surface: "suggest-goals",
          matches,
          lensBlockLength: lensBlock.length,
          metadata: { horizon },
        });
      }
    } catch (err) {
      log.warn("strategic_lens_failed", {
        surface: "suggest-goals",
        error: sanitizeError(err),
      });
    }

    const result = await tracedAiChat(
      { label: "suggest-goals", source: "tool", metadata: { horizon, domain: domain ?? null } },
      [
        {
          role: "system",
          content: await applyOperatorStyle(
            "You are a world-class goal strategist. You know Nour deeply and suggest goals that actually fit his current situation, energy level, and active missions. Never generic. Return only valid JSON." +
              (lensBlock ? `\n\n${lensBlock}` : ""),
          ),
        },
        { role: "user", content: prompt },
      ],
      "deep"
    );

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(result.content.replace(/```json|```/g, "").trim());
    } catch {
      parsed = { goals: [], raw: result.content.slice(0, 500) };
    }

    return NextResponse.json({
      horizon,
      ...parsed,
      provider: result.provider,
    });
  } catch (err) {
    return aiRouteError(err, "suggest-goals", "suggest failed");
  }
}
