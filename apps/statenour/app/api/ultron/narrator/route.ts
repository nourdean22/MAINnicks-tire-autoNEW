// CP7 · force-dynamic · Railway build cannot reach Neon during static
// prerender. Runtime semantics unchanged (cached() makes these effectively
// dynamic on Vercel too).
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cached } from "@/lib/utils/cache";
import { generateNarrations, type Narration } from "@/lib/ultron/narrator";

import { requireSession } from "@/lib/auth-guard";
/**
 * GET /api/ultron/narrator
 *
 * Returns up to 3 current narrations (watcher/coach/analyst/adviser)
 * derived from Nour's current state + recent activity. Engine is
 * rule-based, no AI, fast. Cached 90s so rapid component mounts don't
 * hammer Prisma.
 *
 * The payload also includes `emotionalBalance` — recent up/down feedback
 * streaks — so the client can tweak ordering if it wants to avoid
 * piling warnings on warnings.
 */

interface NarratorPayload {
  narrations: Narration[];
  emotionalBalance: {
    last5: Array<"up" | "down" | null>;
    streakType: "warn_heavy" | "win_heavy" | "mixed" | "empty";
  };
  generatedAt: string;
}

export const revalidate = 90;

export async function GET() {
  try {
    const payload = await cached<NarratorPayload>("ultron_narrator_v1", 90, async () => {
      const narrations = await generateNarrations();

      // Check recent feedback to gauge emotional balance — if the last 3
      // pieces Nour engaged with were all warnings, a fourth warning isn't
      // going to help. Surface a positive one higher in the list.
      const recentFeedback = await prisma.brainMemory
        .findMany({
          where: { category: "narrator_feedback" },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { content: true },
        })
        .catch(() => []);

      const last5 = recentFeedback.map((r) => {
        try {
          const parsed = JSON.parse(r.content) as { feedback?: "up" | "down" };
          return parsed.feedback === "up" || parsed.feedback === "down" ? parsed.feedback : null;
        } catch {
          return null;
        }
      });

      const downs = last5.filter((x) => x === "down").length;
      const ups = last5.filter((x) => x === "up").length;
      const streakType: NarratorPayload["emotionalBalance"]["streakType"] =
        last5.length === 0 ? "empty" :
        downs >= 3 ? "warn_heavy" :
        ups >= 3 ? "win_heavy" :
        "mixed";

      // Emotional balance rebalance — if warn-heavy streak, promote a
      // win/info narration to the top so Nour gets something non-critical.
      if (streakType === "warn_heavy") {
        const positive = narrations.findIndex((n) => n.severity === "win" || n.severity === "info");
        if (positive > 0) {
          const [item] = narrations.splice(positive, 1);
          narrations.unshift(item);
        }
      }

      return {
        narrations,
        emotionalBalance: { last5, streakType },
        generatedAt: new Date().toISOString(),
      };
    });

    return NextResponse.json({ data: payload });
  } catch (err) {
    return NextResponse.json(
      {
        data: {
          narrations: [],
          emotionalBalance: { last5: [], streakType: "empty" as const },
          generatedAt: new Date().toISOString(),
        },
        error: String(err),
      },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/ultron/narrator
 *   Body: { narrationId, feedback: "up" | "down" | null, dismissed?: boolean }
 *
 * Records feedback as a BrainMemory row so the Narrator engine can learn
 * which observation types land and which get dismissed. Content is the
 * stringified JSON so future queries can filter by narration voice/
 * triggers/outcome.
 */
export async function PATCH(req: Request) {
  await requireSession(req);
  try {
    const body = (await req.json()) as {
      narrationId?: string;
      voice?: string;
      triggers?: string[];
      feedback?: "up" | "down" | null;
      dismissed?: boolean;
    };
    if (!body.narrationId) {
      return NextResponse.json({ error: "narrationId required" }, { status: 400 });
    }

    // Store as BrainMemory — category="narrator_feedback". Not a separate
    // table because we have ~190 laws + many patterns; feedback volume
    // is moderate and memory-store is already doing similar work.
    await prisma.brainMemory.upsert({
      where: {
        category_key: {
          category: "narrator_feedback",
          key: `narr:${body.narrationId}`,
        },
      },
      create: {
        category: "narrator_feedback",
        key: `narr:${body.narrationId}`,
        content: JSON.stringify({
          narrationId: body.narrationId,
          voice: body.voice,
          triggers: body.triggers ?? [],
          feedback: body.feedback ?? null,
          dismissed: !!body.dismissed,
          at: new Date().toISOString(),
        }),
        confidence: body.feedback === "up" ? 0.9 : body.feedback === "down" ? 0.3 : 0.6,
        source: "ultron_narrator_ui",
      },
      update: {
        content: JSON.stringify({
          narrationId: body.narrationId,
          voice: body.voice,
          triggers: body.triggers ?? [],
          feedback: body.feedback ?? null,
          dismissed: !!body.dismissed,
          at: new Date().toISOString(),
        }),
        confidence: body.feedback === "up" ? 0.9 : body.feedback === "down" ? 0.3 : 0.6,
      },
    });

    return NextResponse.json({ data: { ok: true } });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
