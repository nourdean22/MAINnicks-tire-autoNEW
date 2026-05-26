/**
 * GET /api/cron/pricing-advisor · v10.0.526 · Arc C Feature 3
 *
 * Weekly (Sunday) pricing-strategy advisor. Folded into the
 * mega-evening Sunday-only block so it shares the existing weekly
 * fan-out budget rather than burning a vercel.json schedule slot.
 *
 * What it does:
 *   1. Reads last 30d ALG win-rate per service category from the
 *      nickstire bridge (no new pipeline).
 *   2. Detects categories ≥20pp below the fleet median.
 *   3. Pulls cached competitor-price signal via multiSourceSearch
 *      (24h BrainMemory cache · doesn't burn Tavily/Exa per run).
 *   4. Drafts 3 operator-graded price experiments per outlier via
 *      aiChat, each citing a Munger/Buffett/etc wisdom by name.
 *   5. Writes the advisory to BrainMemory(category="pricing_advisory",
 *      key="weekly_YYYY-MM-DD"). NO new table.
 *   6. Telegram-alerts the operator ONLY when outliers were found.
 *
 * Idempotency: one advisory row per ISO Sunday date · cron retries
 * within the same Sunday return `skipped:true`.
 *
 * Why weekly cadence: price experiments need time to read out · a
 * daily re-draft would noise-ping the operator's Telegram with the
 * same outliers each morning. Per the roadmap.
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { sendTelegram } from "@/lib/services/telegram";
import { composeAdvisory } from "@/lib/services/pricing-advisor";
import { recordCoachEvent } from "@/lib/services/coach-events";

export const maxDuration = 180; // ~5 outliers × (web-search + draft) fits comfortably; cap matches cost-slo-check pattern.

function etDateKey(at: Date = new Date()): string {
  return at.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export const GET = cronHandler(async () => {
  const today = etDateKey();
  const key = `weekly_${today}`;

  // Idempotency · one advisory per ET-day. Cron retry inside the
  // same Sunday window returns the existing record's date.
  const existing = await prisma.brainMemory
    .findFirst({
      where: { category: "pricing_advisory", key },
      select: { id: true, createdAt: true },
    })
    .catch(() => null);

  if (existing) {
    return {
      ok: true,
      skipped: true,
      reason: "already_run_today",
      date: today,
    };
  }

  const snapshot = await composeAdvisory();

  // Persist · the metadata carries the full structured payload so
  // /api/system/pricing-advisory + the chat tool can read it back
  // without re-running the analyzer.
  await prisma.brainMemory
    .create({
      data: {
        category: "pricing_advisory",
        key,
        content: snapshot.headline,
        confidence: snapshot.outliers.length > 0 ? 0.85 : 0.5,
        source: "cron:pricing-advisor",
        metadata: {
          snapshot,
        } as unknown as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
      },
    })
    .catch(() => undefined);

  // Telegram ONLY when there's an outlier. No-news weeks shouldn't
  // ping the operator's phone — that's how alerts get muted.
  let telegramOk = false;
  if (snapshot.outliers.length > 0) {
    const lines: string[] = [
      `<b>Pricing advisory · ${today}</b>`,
      snapshot.headline,
    ];
    const top = snapshot.outliers[0];
    lines.push(
      `Top: <b>${top.service}</b> · ${(top.winRate * 100).toFixed(0)}% win (${top.converted}/${top.given}) · median ${(top.fleetMedian * 100).toFixed(0)}%`,
    );
    const experiments = snapshot.experimentsByCategory[top.service] ?? [];
    if (experiments.length > 0) {
      lines.push(`Experiment: ${experiments[0].variant.slice(0, 140)}`);
    }
    lines.push(`Open /admin/pricing-advisory to review the 3 experiments.`);

    try {
      telegramOk = await sendTelegram(lines.join("\n"), undefined, "HTML");
    } catch {
      telegramOk = false;
    }

    // Mastery Layer Stage A · dual-write to the unified coach channel
    // (commit d0ced3e0). Surfaces the weekly pricing advisory on the
    // /scoreboard CoachEventBanner (commit e9355280). subjectId = the
    // ET date key, so dedup is one-per-week. Telegram + /admin link
    // continue to work · this just adds a new display surface.
    await recordCoachEvent({
      kind: "pricing-advisory",
      subjectId: today,
      priority: "P1", // worth attention but not bleeding · weekly cadence
      title: `Pricing advisory · ${top.service} · ${(top.winRate * 100).toFixed(0)}% win rate`,
      body: snapshot.headline.slice(0, 200),
      deepLink: "/admin/pricing-advisory",
      surfaces: ["scoreboard"],
      extra: {
        date: today,
        outlierCount: snapshot.outliers.length,
        topService: top.service,
        topWinRate: top.winRate,
        fleetMedian: top.fleetMedian,
      },
    });
  }

  return {
    ok: true,
    date: today,
    outlierCount: snapshot.outliers.length,
    categoryCount: snapshot.winRates.length,
    fleetMedianWinRate: snapshot.fleetMedianWinRate,
    pushed: telegramOk,
    empty: snapshot.empty?.reason,
  };
});
