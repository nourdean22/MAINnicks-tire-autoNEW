/**
 * Daily Executive Brief composer · AG-40 (2026-07-09)
 *
 * ONE compose function for the classic drift pair: the inngest daily
 * cron (lib/inngest/functions/intelligence-brief.ts) and the manual
 * owner route (app/api/intelligence/briefs/generate) each hand-rolled
 * the compose step — and they had already drifted: the manual route
 * still carried the PRE-AG-02 prompt with no grounding rule and a
 * different section contract, so a manually-generated brief could
 * invent data the cron brief was forbidden to.
 *
 * This is the canonical grounded V2 composer (AG-02 rules). Heading
 * contract note: the morning push's chatSeed references the "daily
 * executive brief" — keep the H1 stable.
 */

import {
  deriveThreatLevel,
  renderOperatorQueue,
  CUSTOMER_FACING_ACTIONS,
  stripInventedSeverity,
  type OperatorQueue,
} from "./operator-queue";
import { renderCapacityBlock } from "./capacity-block";
import { renderAttentionBlock } from "./attention-block";
import { renderPagesBlock } from "./pages-block";
import { renderEnergyBlock } from "./energy-block";
import { renderWeatherBlock, parseWeatherSignal, type WeatherSignal } from "./weather-block";
import { buildEnergyProfile } from "@/lib/personal/energy-router";
import { analyzePagePatterns } from "@/lib/brain/page-intelligence";
import { analyzeAttentionPatterns } from "@/lib/brain/attention-tracker";
import { gatherTaskSignals } from "@/lib/brain/task-signals";
import { prisma } from "@/lib/prisma";
import { getModel } from "@/lib/ai/provider";
import { generateText } from "ai";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("intelligence/compose-daily-brief");

const SYSTEM_PROMPT = `You are Nour's Chief of Staff and chief intelligence officer. Compose the Daily Executive Brief V2.
Your tone is ruthlessly direct, quantitative, hyper-strategic, and action-oriented. Eliminate all passive fluff or generic warnings.

GROUNDING RULE (absolute): every number, price, name, and claim in the brief MUST appear verbatim in the input data below. If the input contains no signal for a section, write exactly "no signal today" under that heading and move on — NEVER invent competitor prices, search metrics, biomarkers, or any other data.

You must format using these exact headings:
# Daily Executive Brief V2 · [Date]

## 💼 CEO Brief (Highest ROI opportunity)
From the input opportunities/claims only: the highest-ROI opportunity. Quantify impact only when the input carries numbers.
- *Recommended Action*: Action verb with clear instructions.

DO NOT WRITE A THREAT LEVEL, SEVERITY, P-NUMBER OR INCIDENT DECLARATION anywhere in the brief. Never emit "Threat Level", "CRITICAL", "P1", "P0", "INCIDENT" or "Drift:". The threat level is COMPUTED from counted state and is prepended above your output before the operator sees it; a second one written here would contradict it. The grounding rule below forbids you inventing a number — this forbids you inventing a severity, which is the same failure in a word instead of a digit.

Do not describe the intelligence pipeline, feeds, sources or ingestion as down, dark, broken or degraded unless a claim in the input says so verbatim. On 2026-08-22 a brief opened with "Threat Level: CRITICAL / P1 INCIDENT. Your entire intelligence stack has been dark across multiple cycles (2026-08-12, 2026-08-15, 2026-08-16)". All seven sources had fetched on all three of those dates. That sentence was invented.

## ✍️ Content Brief (Auto-generated publish queue suggestions)
Detail the fresh content drafts created today in the SocialPublishQueue (from the Drafts in Queue input).
- *Action*: Approve or decline content templates for review.

## 🗺️ Local Market Brief (verified market & search signals)
Summarize competitor/market/search claims that are PRESENT in the input data.
- *Action*: One concrete move, or "no signal today".

## 🚀 Frontier Brief (AI & performance signals)
Summarize AI/engineering/performance claims that are PRESENT in the input data.
- *Action*: One concrete move, or "no signal today".`;

/**
 * Count what is waiting on the operator. Ages computed IN SQL.
 *
 * Separated from the pure logic in operator-queue.ts so the verdict can be
 * tested without a database, and so this file holds the only thing that needs
 * one: the counting.
 */
async function loadOperatorQueue(): Promise<OperatorQueue> {
  const [actions, drafts, expired] = await Promise.all([
    prisma.$queryRaw<Array<{
      pending: bigint; oldest_days: number | null;
      cf_pending: bigint; cf_oldest_days: number | null;
    }>>`
      SELECT COUNT(*) AS pending,
             MAX(EXTRACT(DAY FROM now() - "createdAt"))::int AS oldest_days,
             COUNT(*) FILTER (WHERE "actionType" = ANY(${CUSTOMER_FACING_ACTIONS as unknown as string[]})) AS cf_pending,
             MAX(EXTRACT(DAY FROM now() - "createdAt")) FILTER (WHERE "actionType" = ANY(${CUSTOMER_FACING_ACTIONS as unknown as string[]}))::int AS cf_oldest_days
        FROM autonomous_actions
       WHERE approval = 'pending'`,
    prisma.$queryRaw<Array<{ pending: bigint; oldest_days: number | null }>>`
      SELECT COUNT(*) AS pending,
             MAX(EXTRACT(DAY FROM now() - created_at))::int AS oldest_days
        FROM social_publish_queue
       WHERE status = 'pending' AND deleted_at IS NULL`,
    // "Actionable" excludes rows already terminal. An expired row that already
    // failed is history; an expired row still awaiting a decision is a closed
    // window nobody noticed, which is the condition worth paging on.
    // Counted in ONE pass, both states. Splitting these into "expired" and
    // "pending" queries is what produced the original gap: only the expired half
    // was ever asked for, so a live request was invisible until too late.
    prisma.$queryRaw<Array<{ expired: bigint; pending: bigint; soonest_min: number | null }>>`
      SELECT COUNT(*) FILTER (WHERE expires_at < now()) AS expired,
             COUNT(*) FILTER (WHERE expires_at >= now() OR expires_at IS NULL) AS pending,
             MIN(EXTRACT(EPOCH FROM (expires_at - now())) / 60)
               FILTER (WHERE expires_at >= now())::int AS soonest_min
        FROM approval_requests
       WHERE status NOT IN ('failed', 'executed', 'rejected', 'expired')`,
  ]);

  const num = (v: bigint | number | null | undefined) => Number(v ?? 0);
  return {
    pendingActions: num(actions[0]?.pending),
    oldestActionDays: num(actions[0]?.oldest_days),
    customerFacingPending: num(actions[0]?.cf_pending),
    oldestCustomerFacingDays: num(actions[0]?.cf_oldest_days),
    pendingDrafts: num(drafts[0]?.pending),
    oldestDraftDays: num(drafts[0]?.oldest_days),
    actionableExpired: num(expired[0]?.expired),
    pendingApprovals: num(expired[0]?.pending),
    soonestApprovalExpiryMinutes:
      expired[0]?.soonest_min === null || expired[0]?.soonest_min === undefined
        ? null
        : Math.round(Number(expired[0].soonest_min)),
  };
}

/** Read the newest weather SourceDocument (<=26h) and extract its demand block. */
async function loadWeatherSignal(): Promise<WeatherSignal | null> {
  try {
    const src = await prisma.registeredSource.findFirst({ where: { domain: "weather" }, select: { id: true } });
    if (!src) return null;
    const doc = await prisma.sourceDocument.findFirst({
      where: { sourceId: src.id, capturedAt: { gte: new Date(Date.now() - 26 * 60 * 60 * 1000) } },
      orderBy: { capturedAt: "desc" },
      select: { rawContent: true },
    });
    if (!doc) return null;
    return parseWeatherSignal(doc.rawContent);
  } catch (err) {
    log.warn("weather_signal_failed", { error: (err instanceof Error ? err.message : String(err)).slice(0, 200) });
    return null;
  }
}

export async function composeDailyExecutiveBrief(): Promise<{ date: string; text: string }> {
  // High-scoring pending opportunities (score >= 75)
  const opportunities = await prisma.opportunityLog.findMany({
    where: { status: "pending", score: { gte: 75 } },
    orderBy: { score: "desc" },
    take: 5,
  });

  // Recent pending content drafts
  const drafts = await prisma.socialPublishQueue.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "desc" },
    take: 3,
  });

  // High-confidence source-supported claims
  const claims = await prisma.intelligenceClaim.findMany({
    where: { confidence: { gte: 0.8 }, status: "source_supported" },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });

  const promptText = `Date: ${today}
Opportunities:
${opportunities.map((o) => `- [${o.domain.toUpperCase()}] ${o.title}: ${o.description} (Score: ${o.score})`).join("\n")}

Drafts in Queue:
${drafts.map((d) => `- [DRAFT] Kind: ${d.kind} | Platforms: ${d.platforms.join(", ")} | Preview: "${d.content.slice(0, 100)}..."`).join("\n")}

Claims:
${claims.map((c) => `- [CLAIM] ${c.text} (Confidence: ${c.confidence})`).join("\n")}`;

  // Counted BEFORE the model runs, and prepended VERBATIM after it. The block is
  // never handed to the model to summarise: it cannot round 20 to "several",
  // drop the section for space, or soften a level. The existing GROUNDING RULE
  // stops the model inventing a number; this stops it omitting one.
  const weatherBlock = renderWeatherBlock(await loadWeatherSignal());
  const queue = await loadOperatorQueue();
  const verdict = deriveThreatLevel(queue);
  const queueBlock = renderOperatorQueue(queue, verdict);

  // Same contract as the queue above: counted before the model, rendered
  // verbatim, never handed over to be summarised. `gatherTaskSignals` had ZERO
  // consumers - it computed open/late/stale/capacity correctly and threw the
  // result away. Caught defensively despite its "never throws" doc comment: a
  // doc claim is not a guarantee, and null renders as UNMEASURED rather than
  // vanishing into a section that looks like a quiet day.
  let capacityBlock: string;
  try {
    capacityBlock = renderCapacityBlock(await gatherTaskSignals());
  } catch (err) {
    log.warn("capacity_signals_failed", {
      error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    });
    capacityBlock = renderCapacityBlock(null);
  }

  // Same verbatim contract. analyzeAttentionPatterns also had zero consumers.
  // Only `neglectedDomains` is rendered: focusScore and attentionVelocity are
  // ratios over a filtered population whose denominator never reaches the
  // output, and an alarming derived score with an invisible denominator is the
  // shape that has misled here before. Counts are checkable; scores argue.
  let attentionBlock: string;
  try {
    const profile = await analyzeAttentionPatterns();
    attentionBlock = renderAttentionBlock(profile.neglectedDomains);
  } catch (err) {
    log.warn("attention_signals_failed", {
      error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    });
    attentionBlock = renderAttentionBlock(null);
  }

  // Same verbatim contract again. FACTS ONLY: analyzePagePatterns also returns
  // an `insights[]` array with lines like "may be using conversation as
  // procrastination" - a psychological read the module never measured. This
  // brief's documented failure is unearned claims, so the counts come over and
  // the inferences stay behind. A test enforces the exclusion.
  let pagesBlock: string;
  try {
    const p = await analyzePagePatterns();
    pagesBlock = renderPagesBlock({
      topPages: p.topPages,
      blindSpots: p.blindSpots,
      lateNightCount: p.lateNightCount,
      avgDailyVisits: p.avgDailyVisits,
      activeDays: p.activeDays,
    });
  } catch (err) {
    log.warn("page_signals_failed", {
      error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    });
    pagesBlock = renderPagesBlock(null);
  }

  // Completion TIMING, counted before the model and prepended verbatim, same
  // contract as the three blocks above. `energy-router` reported 0 samples for
  // its whole life because it filtered on `actualMinutes > 0` — a column
  // nothing writes — which discarded 124 real completion timestamps. The
  // filter is gone; duration stays honestly UNMEASURED, and no routing
  // recommendation is rendered (HIGH-energy is 4 of 124, one per window).
  let energyBlock: string;
  try {
    energyBlock = renderEnergyBlock(await buildEnergyProfile());
  } catch (err) {
    log.warn("energy_profile_failed", {
      error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    });
    energyBlock = renderEnergyBlock(null);
  }

  // P1 FROM REVIEW: the queue must survive a generation failure. This used to
  // let generateText reject, which sent the whole call into the caller's catch
  // in intelligence-brief.ts - and that fallback narrative has no queue counts.
  // So a provider outage dropped the deterministic section, which is precisely
  // the thing that was supposed to be undroppable. Counting it first is
  // worthless if the return path can still discard it.
  let body: string;
  try {
    const result = await generateText({
      model: getModel("reason"),
      system: SYSTEM_PROMPT,
      prompt: `${promptText}\n\nCompose the brief now.`,
    });
    body = result.text || "No briefing content compiled for today.";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("brief_generation_failed_queue_preserved", { error: msg.slice(0, 200) });
    body = [
      "## Narrative unavailable",
      "",
      `The composer failed (${msg.slice(0, 160)}). The Awaiting You section above is`,
      "computed from the database and is unaffected - it is the part that tells you",
      "what to do next.",
    ].join("\n");
  }

  // P1 FROM REVIEW: the prompt forbids the model writing a severity, but a prompt
  // is a request. Without this, a model that ignores the instruction produces a
  // brief whose computed level says NORMAL and whose body says CRITICAL - a
  // visible self-contradiction that discredits the computed number.
  const sanitized = stripInventedSeverity(body);
  if (sanitized.stripped > 0) {
    log.warn("brief_invented_severity_stripped", { count: sanitized.stripped });
  }
  body = sanitized.text;

  return {
    date: today,
    // Awaiting-You leads. It is the only section describing state the operator
    // can act on this minute, and during the 16-day ingest-reviews outage the
    // brief led with an invented threat level while 44 real items sat queued.
    text: `# Daily Executive Brief V2 · ${today}\n\n${queueBlock}\n\n${weatherBlock}\n\n${capacityBlock}\n\n${attentionBlock}\n\n${pagesBlock}\n\n${energyBlock}\n\n---\n\n${body}`,
  };
}
