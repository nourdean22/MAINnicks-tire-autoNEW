/**
 * /api/ai/scoreboard-brief · Wave AQ · 2026-05-28.
 *
 * Sam-Altman frame on /scoreboard · 2-3 sentence narrative anchor
 * naming the ONE number that matters this week + the open question.
 * Pre-this-fix /scoreboard opened onto OperatorPulse → NickHealthSection
 * → anomalies → anchors · operator had to scan to know the score.
 * Sam-layer: Nick says it out loud at the top.
 *
 *   "Revenue is $4.2k today · 18% above last Tuesday. Margins are
 *    pacing well · the ONE risk is the 5 cron failures in the last
 *    24h · audit /system/logs before noon. Best move now: ship
 *    that pricing-advisory you saw in the coach banner."
 *
 * Cached daily in BrainMemory(category=scoreboard_brief, key=YYYY-MM-DD).
 * Owner-gated. Reads the meta-scoreboard data the page already uses
 * (anchors + anomalies) so the brief + the cards never drift.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { buildMetaScoreboard } from "@/lib/services/meta-scoreboard";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("api/ai/scoreboard-brief");

const SYSTEM_PROMPT = `You write a 2-3 sentence brief on the operator's
current scoreboard state. You receive a structured signal block with
anchor numbers (revenue · tasks · commitments · alerts · top mover) and
anomalies (cron failures · stale goals · callbacks · alert surges).
Synthesize into:

  · sentence 1 · the ONE anchor number that matters today + the
                  specific delta (NOT "things are good")
  · sentence 2-3 · the biggest current risk OR opportunity + one
                    concrete next move ("audit /system/logs" /
                    "ship the pricing advisory" / etc)

SAM-ALTMAN PRINCIPLES TO CHANNEL:
  · "if you can't measure it you can't manage it" — name the number
  · honest about risk · don't varnish
  · ONE move at a time

CONSTRAINTS:
  · Max ~300 chars total
  · No headers, no lists, no markdown
  · Name numbers + anomalies specifically · no generic phrasing
  · Plain prose · no motivational fluff
  · Return ONLY the brief paragraph`;

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);

  // Cache read/write is owned by composeBrief below (AG-40).

  // Pull the same data the /scoreboard page uses · drift-free.
  let signalBlock = "";
  try {
    const snapshot = await buildMetaScoreboard();
    // The shape is a flat ScoreboardNumber[] · split by .anomalous
    // (the page does the same · keeps signal/cards aligned).
    const anchors = snapshot.numbers.filter((n) => !n.anomalous);
    const anomalies = snapshot.numbers.filter((n) => n.anomalous);
    const anchorLines = anchors.map((a) => {
      const delta =
        a.delta7d != null
          ? ` Δ ${a.delta7d > 0 ? "+" : ""}${a.delta7d}% (${a.trend})`
          : "";
      return `  ${a.label}: ${a.display}${delta}`;
    });
    const anomalyLines = anomalies.map((n) => {
      const why = n.why ? ` · ${n.why}` : "";
      return `  ${n.label}: ${n.display}${why}`;
    });
    signalBlock = [
      `ANCHORS (${anchors.length}):`,
      anchorLines.join("\n") || "  (none)",
      "",
      `ANOMALIES (${anomalies.length}):`,
      anomalyLines.join("\n") || "  (none)",
      "",
      `LAST_BRIEF_AT: ${snapshot.lastBriefAt ?? "never"}`,
      `STATE: ${snapshot.state}`,
    ].join("\n");
  } catch (err) {
    log.warn("signal_gather_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ brief: "" });
  }

  // AG-40 · compose + cache via the shared brief-composer.
  const { composeBrief } = await import("@/lib/ai/brief-composer");
  const brief = await composeBrief({
    label: "scoreboard-brief",
    cacheCategory: BRAIN_CATEGORIES.SCOREBOARD_BRIEF,
    cacheKey: today,
    systemPrompt: SYSTEM_PROMPT,
    signalBlock,
    taskType: "reason",
    maxChars: 360,
  });

  return NextResponse.json({ brief });
}
