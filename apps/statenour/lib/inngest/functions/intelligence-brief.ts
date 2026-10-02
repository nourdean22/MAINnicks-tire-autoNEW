/**
 * Inngest functions for Intelligence OS Briefings
 * Daily and Weekly Cron workflows for raw ingestion, scoring, synthesis, and dispatch.
 */
import { langfuseTelemetry } from "@/lib/observability/langfuse";
import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import { runIngestion } from "@/lib/intelligence/ingest";
import { processClaimsIntoOpportunities } from "@/lib/intelligence/scoring";
import { getModel } from "@/lib/ai/provider";
import { generateText } from "ai";
import { logger as rootLogger } from "@/lib/logger";
import { pushBodyFromBrief } from "./morning-brief";

const log = rootLogger.withSurface("inngest/intelligence-brief");
const inngest = getInngest();

/**
 * 2026-08-23 - zero-ingest is a FAILURE, not a quiet day.
 *
 * THE DEFECT. The ingestion loop caught every per-source error, logged it, and
 * returned normally. A source returning `{ success: false }` was not logged at
 * all. So if all seven feeds failed - one expired credential is enough - the run
 * reported `sourcesIngested: 0` and Inngest marked it SUCCEEDED.
 *
 * WHAT THE BRIEF ACTUALLY DOES ON SUCH A DAY, corrected under review: it is NOT
 * "built on nothing". `composeDailyExecutiveBrief` has no date filter on any of
 * its queries - it selects pending opportunities scoring >= 75 and the five most
 * recent claims at confidence >= 0.8, whenever they were created. So a total feed
 * outage produces a brief built on the standing BACKLOG, wearing today's date,
 * with no staleness marker. That is worse than an empty brief, because stale
 * content dated today reads as fresh.
 *
 * WHY A THROW AND NOT A NEW ALERT. `onFailure: onInngestFailure` is already wired
 * on this function and already routes to Telegram once retries are exhausted.
 * Throwing reuses that path; a second alerting route would be a parallel system.
 *
 * WHERE THE THROW LIVES, and why it moved. It is at the END of the function body,
 * after every step has run - not inside the ingestion step. Inngest's contract
 * ("How functions are executed - Memoization of steps") is that a retry
 * re-executes the function body but retrieves each completed step's result from
 * persisted state "without re-executing the step's code". Throwing inside step 1
 * meant every retry RE-RAN all seven connector fetches and re-spent the scrape
 * budget, on precisely the day things were already broken, and skipped the six
 * downstream steps - so no briefing_logs row, no push, no drift scan. Throwing at
 * the end means the brief still composes and ships once, the steps replay from
 * memoized state on each retry, and onFailure still fires after the third attempt.
 *
 * A CORRECTION WORTH KEEPING. An earlier version of this comment argued the
 * `=== 0` condition made retries idempotent, reasoning that zero ingested implied
 * nothing was written. That is FALSE. `runIngestion` commits its `sourceDocument`
 * at ingest.ts:230, then writes claims in a loop at :248, and a throw anywhere
 * after the document insert is converted to `{ success: false }` by the outer
 * catch at :300. A source can write a document and still not be counted. The
 * idempotency now comes from step memoization, which is a real guarantee, rather
 * than from an invariant nothing enforces.
 *
 * MEASURED BEFORE ARMING, because a gate that fires daily is worse than no gate.
 * Prod 2026-08-23: 7 registered sources, all with `last_fetched` today and 12-16
 * documents each over 14 days. Zero ingestion is not the steady state. The
 * counter-example is `ollama-model-liveness`, which cron-heartbeat.ts records as
 * 23 non-failed runs out of 2,333 - arming an identical assert there would page
 * on essentially every run and be muted inside a week.
 */
export interface IngestionRollup {
  sourcesAttempted: number;
  sourcesIngested: number;
  totalClaims: number;
  failures: string[];
}

/**
 * The ingestion loop, with `runIngestion` injected.
 *
 * Extracted so the gate can be tested by DRIVING it rather than by grepping the
 * source. The previous version asserted that `ingestionFailure(` and `throw` both
 * appeared in the file - assertions that stay green if the arguments are swapped
 * (`sourcesAttempted: ingestedCount`), which inverts the gate completely: it
 * would fire when all seven sources SUCCEED and stay silent when all seven fail.
 * A review mutation proved that passed 10 of 10 tests. Same shape as
 * `classifySilence` in cron-heartbeat.ts, which takes its inputs as parameters
 * for exactly this reason.
 */
export async function ingestAllSources(
  sources: ReadonlyArray<{ id: string; name: string }>,
  ingest: (id: string) => Promise<{ success: boolean; claimsCount: number; message: string }>,
  onLog?: {
    soft?: (e: { sourceId: string; name: string; message: string }) => void;
    hard?: (e: { sourceId: string; message: string }) => void;
  },
): Promise<IngestionRollup> {
  let sourcesIngested = 0;
  let totalClaims = 0;
  // Reasons are COLLECTED, not just logged. IngestionResult carries a `message`
  // on failure and it was discarded entirely, so an alert could say "0 sources"
  // but never "the credential expired" - the only part that is actionable.
  const failures: string[] = [];

  for (const source of sources) {
    try {
      const res = await ingest(source.id);
      if (res.success) {
        sourcesIngested++;
        totalClaims += res.claimsCount;
      } else {
        // Previously a completely silent path: neither counted nor logged.
        failures.push(`${source.name}: ${res.message}`.slice(0, 160));
        onLog?.soft?.({ sourceId: source.id, name: source.name, message: res.message });
      }
    } catch (err) {
      // Defensive only. runIngestion wraps its whole body and returns a result on
      // every path (ingest.ts:29-310), so in practice failures arrive through the
      // branch above. Kept because "it cannot throw" is a property of today's
      // implementation, not of the signature.
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${source.name}: ${msg}`.slice(0, 160));
      onLog?.hard?.({ sourceId: source.id, message: msg });
    }
  }

  return { sourcesAttempted: sources.length, sourcesIngested, totalClaims, failures };
}

/**
 * Is this rollup a failure? Returns an operator-facing message, or null.
 *
 * REASONS COME FIRST. `on-failure.ts:52` truncates the error to 240 characters
 * before sending, and an earlier version put a 124-character preamble ahead of
 * them - so the two least useful reasons arrived and `401 unauthorized` was cut
 * off mid-word. The alert already carries its own header ("Inngest failure -
 * intelligence-daily-brief"), so the preamble was redundant as well as harmful.
 *
 * TWO FAILURE MODES, not one:
 *   - nothing ingested: every feed is down.
 *   - everything ingested and ZERO claims: the shared extractor is broken.
 *     `extractClaimsFromText` returns [] on a JSON parse failure AND on any
 *     thrown error, so one provider change silently empties every source at once.
 *     That is a likelier single point of failure than seven independent
 *     credential expiries, and the first version of this gate missed it entirely
 *     because it counted sources rather than intelligence.
 */
export function ingestionFailure(report: {
  sourcesAttempted: number;
  sourcesIngested: number;
  totalClaims?: number;
  failures?: string[];
}): string | null {
  // No sources registered: ingesting nothing is CORRECT. Without this branch an
  // empty configuration becomes a permanent daily alarm.
  if (report.sourcesAttempted === 0) return null;

  const why = report.failures?.length
    ? report.failures.join(" | ")
    : "no per-source reason captured";

  if (report.sourcesIngested === 0) {
    return `0/${report.sourcesAttempted} sources ingested - ${why}`;
  }

  if (report.totalClaims === 0) {
    return (
      `${report.sourcesIngested}/${report.sourcesAttempted} sources ingested but ZERO claims extracted ` +
      `- the shared extractor is the suspect, not the feeds. ${why}`
    );
  }

  return null;
}

/**
 * 2026-08-21 · combine decision, pure. Pulled out of the dispatch-push
 * step callback so the title/text choice is directly testable without
 * mocking step.run/prisma/sendPush.
 */
export function combineBriefText(morningHighlight: string | null, execText: string): string {
  return morningHighlight
    ? `## 🌅 This Morning\n${morningHighlight}\n\n---\n\n${execText}`
    : execText;
}

export function combinedBriefTitle(morningHighlight: string | null): string {
  return morningHighlight ? "Morning + Executive Brief" : "Daily Executive Brief";
}

/**
 * 2026-08-21 · the push BODY is a ~200-char teaser, not the full brief
 * (that's what /intelligence/brief is for). `morningHighlight` is now
 * the FULL morning brief text (handOffForCombine hands off raw, so the
 * landing page can render it in full) — running the naive
 * `pushBodyFromBrief(morning + " · " + exec)` on that would let a long
 * morning brief eat the whole 200-char budget and the notification
 * preview would never even mention the exec brief. Give each side a
 * fixed slice BEFORE truncating so the teaser always hints at both.
 */
export function combinedPushBody(morningHighlight: string | null, execText: string): string {
  if (!morningHighlight) return pushBodyFromBrief(execText);
  const morningSlice = pushBodyFromBrief(morningHighlight).slice(0, 90);
  const execSlice = pushBodyFromBrief(execText).slice(0, 100);
  return `${morningSlice} · ${execSlice}`.slice(0, 200);
}

/**
 * Daily Ingestion & Briefing Orchestrator
 * Cron: Daily at 10:00 UTC
 */
/**
 * 2026-10-02 · the run's terminal status derives from the compose result. A brief
 * whose compose timed out used to return `completed` and settle `success` in
 * cron_job_logs: the system knew it was degraded (the saved text says so) while
 * the Owner Panel had nothing to read. `status: "partial"` + `degradedReason` is
 * what lib/inngest/cron-lifecycle.ts deriveDegradation turns into a partial row.
 */
export function briefRunOutcome(brief: { degraded?: string }): {
  status: "completed" | "partial";
  degradedReason?: string;
} {
  return brief.degraded
    ? { status: "partial", degradedReason: `brief compose degraded: ${brief.degraded}` }
    : { status: "completed" };
}

export const intelligenceDailyBrief = inngest.createFunction(
  {
    id: "intelligence-daily-brief",
    name: "Intelligence OS · Daily Briefing",
    retries: 2,
    // Staggered +15min off operator-morning-brief (0 10) — originally to
    // avoid double-firing a high-priority Web Push at the operator and
    // contending for the shared AI provider. 2026-08-21 · that double-fire
    // is now the point: this slot RECEIVES morning's hand-off (see
    // combine-morning-highlight below) and sends the ONE combined push,
    // 15min after morning's compose so its highlight is ready to fold in.
    triggers: [{ cron: "15 10 * * *" }],
    onFailure: onInngestFailure,
  },
  async ({ step }) => {
    // 1. Run Ingestion for all active sources
    const ingestionReport = await step.run("ingest-active-sources", async () => {
      const { prisma } = await import("@/lib/prisma");
      const activeSources = await prisma.registeredSource.findMany();

      // The loop lives in ingestAllSources so a test can drive it with a fake
      // ingester. It returns the rollup; the FAILURE VERDICT is computed at the
      // end of this function, not here - see the header for why throwing inside
      // this step re-ran every connector fetch on each retry.
      return ingestAllSources(activeSources, runIngestion, {
        soft: (e) => log.warn("ingestion_source_soft_failure", e),
        hard: (e) => log.error(`Inngest step runIngestion failed for source ${e.sourceId}`, { error: e.message }),
      });
    });

    // 2. Synthesize Claims into Opportunities & score them
    const opportunityReport = await step.run("synthesize-opportunities", async () => {
      const { processSearchOpportunities } = await import("@/lib/intelligence/search-opportunity");
      const { processOpportunityContentDrafts } = await import("@/lib/intelligence/content-alpha");
      
      const claimsCount = await processClaimsIntoOpportunities();
      const searchCount = await processSearchOpportunities();
      const draftsCount = await processOpportunityContentDrafts();
      
      return { opportunitiesCreated: claimsCount + searchCount, draftsCreated: draftsCount };
    });

    // 3. Compose Daily Executive Brief text
    // AG-40 · shared composer kills the drift pair: this step was
    // duplicated in /api/intelligence/briefs/generate, which had drifted
    // to a pre-AG-02 prompt with NO grounding rule.
    //
    // 2026-07-29 · bounded + degrade (first-fire postmortem). The maiden
    // post-resync run proved steps 1-2 live (claims + opportunities
    // written 10:18) then NEVER saved a brief and left NO error row —
    // the compose's AI call hung and, `maxDuration` being Vercel-only
    // semantics, Railway enforced nothing (the exact unbounded-hang
    // class the mega children were fixed for in #1166). A brief that
    // times out now degrades to an honest ingestion summary instead of
    // losing the whole run: briefing_logs ALWAYS gains its row, the
    // push still fires, and the failure is LOUD in the text itself.
    const briefContent = await step.run("compose-brief-text", async () => {
      const { composeDailyExecutiveBrief } = await import("@/lib/intelligence/compose-daily-brief");
      const COMPOSE_TIMEOUT_MS = 90_000;
      try {
        return await Promise.race([
          composeDailyExecutiveBrief(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`compose timed out after ${COMPOSE_TIMEOUT_MS / 1000}s`)), COMPOSE_TIMEOUT_MS),
          ),
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("brief_compose_failed_degrading", { error: msg });
        const date = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
        return {
          date,
          text: [
            `# Daily Executive Brief · ${date} (degraded)`,
            "",
            `Compose failed (${msg.slice(0, 160)}) — this is the honest fallback, not the full brief.`,
            "",
            `What DID run: ${ingestionReport.sourcesIngested}/${ingestionReport.sourcesAttempted} sources ingested, ${ingestionReport.totalClaims} claims extracted, ${opportunityReport.opportunitiesCreated} opportunities scored, ${opportunityReport.draftsCreated} drafts.`,
            "",
            "Raw opportunities are on /intelligence — the composed narrative returns when the provider does.",
          ].join("\n"),
          // 2026-10-02 · carried to the run's return (briefRunOutcome) so the cron
          // lifecycle settles `partial`, not `success`, and the Owner Panel sees it.
          degraded: msg.slice(0, 300),
        };
      }
    });

    // 3b. 2026-08-21 · combine hand-off receiver. operator-morning-brief
    // (10:00 UTC) hands its highlight here instead of sending its own
    // push — two separate pushes for what is conceptually ONE morning
    // briefing was a fair complaint. Reads + deletes the pending row
    // (lib/inngest/functions/morning-brief.ts's handOffForCombine) so
    // the dispatch-push step below sends ONE notification covering
    // both. Null means morning didn't run yet, already ran its own
    // 35min backstop, or simply had nothing pending — solo delivery,
    // same as before this change.
    const morningHighlight = await step.run("combine-morning-highlight", async () => {
      const { prisma } = await import("@/lib/prisma");
      const pending = await prisma.brainMemory.findUnique({
        where: {
          category_key: { category: "pending_morning_highlight", key: briefContent.date },
        },
        select: { id: true, content: true },
      });
      if (!pending) return null;
      await prisma.brainMemory.delete({ where: { id: pending.id } }).catch(() => null);
      return pending.content;
    });

    const combinedText = combineBriefText(morningHighlight, briefContent.text);

    // 4. Save Brief to BriefingLog
    const savedBrief = await step.run("save-brief-log", async () => {
      const { prisma } = await import("@/lib/prisma");
      await prisma.briefingLog.create({
        data: {
          briefType: "daily",
          content: combinedText,
        },
      });
      // S4 · outcome ledger producer #1: the brief is a recommendation
      // the operator is SHOWN — record it so acceptance/usefulness can
      // ever be measured. First line = the headline recommendation;
      // dedup + failure-safety live in the ledger service.
      //
      // 2026-10-02 · THE ID IS KEPT. It was discarded here, so the combined
      // push below carried no rating buttons and the brief was rateable only
      // on the 35-minute backstop path (morning-brief.ts sendBriefPush):
      // docs/design/outcome-ledger-coverage-2026-10-02.md, finding 6.
      // recordShown never throws (it logs and returns null), so a ledger
      // failure means "no buttons", never "no brief".
      const { recordShown } = await import("@/lib/services/outcome-ledger");
      const id = await recordShown({
        kind: "daily_brief",
        sourceEngine: "intelligence-brief",
        // Dated (bug-hunt 2026-10-02): on combined days the first line was the
        // constant "## 🌅 This Morning", so recordShown's 24h dedup could hand
        // back YESTERDAY's row and today's 👍/👎 rated yesterday.
        summary: `daily brief ${briefContent.date} · ${briefContent.text.split("\n").find((l: string) => l.trim().length > 0)?.slice(0, 480) ?? ""}`.trim(),
        shownSurface: "push+briefing_log",
      });
      return { ledgerId: id };
    });
    // A run that memoized this step BEFORE the step returned anything replays
    // `null` here (Inngest replays recorded step output); read it defensively
    // so a deploy mid-run costs the buttons, never the brief.
    const ledgerId: string | null = savedBrief?.ledgerId ?? null;

    // 5. Dispatch Web Push Notification — ONE push covering both briefs
    // when morning's highlight was there to combine.
    const pushReport = await step.run("dispatch-push", async () => {
      const { sendPush } = await import("@/lib/notifications/push");
      const { ratingPushActions } = await import("@/lib/services/outcome-rating-affordance");
      const result = await sendPush({
        title: combinedBriefTitle(morningHighlight),
        body: combinedPushBody(morningHighlight, briefContent.text),
        level: "high",
        url: "/intelligence/brief",
        tag: `daily-brief-${briefContent.date}`,
        // 👍 / 👎 land on the ledger row saved above; the service worker
        // posts the verdict to /api/outcomes/rate without opening the app.
        ...ratingPushActions(ledgerId),
        // 2026-08-21 · NO chatSeed here on purpose. chatSeed ALWAYS wins
        // over `url` in sendPush's click routing, and chat only PREFILLS
        // the composer — it never auto-sends ($0-incremental doctrine,
        // see use-chat-deep-link-prefill.ts) — so tapping this
        // notification landed the operator in an empty chat with an
        // unsent prompt and nowhere to actually READ the brief.
        // /intelligence/brief already renders the persisted content
        // (fetches BriefingLog via /api/intelligence/briefs/today) —
        // that IS the surface where the notification's content is
        // visible, so `url` needs to win here.
      });
      return result;
    });

    // 5b. Telegram fallback — intelligence-brief never had one; now that
    // its push represents BOTH briefs, a zero-device push must not
    // silently lose morning's content too. Mirrors morning-brief's
    // existing fallback (lib/inngest/functions/morning-brief.ts).
    const telegramFallback = await step.run("telegram-fallback", async () => {
      if (pushReport.sent > 0) return { status: "skipped_push_ok" as const };
      const { sendTelegram, sendTelegramWithButtons } = await import("@/lib/services/telegram");
      const { ratingTelegramButtons } = await import("@/lib/services/outcome-rating-affordance");
      const reason =
        pushReport.failed > 0
          ? "web push failed on every registered device"
          : "no live web-push subscription";
      const title = combinedBriefTitle(morningHighlight);
      const text =
        `📊 ${title} (${briefContent.date}) — delivered via Telegram because ${reason}. ` +
        `Re-enable push in Settings → Notifications.\n\n${pushBodyFromBrief(combinedText)}\n\n` +
        `Full brief: https://bdnick.info/intelligence/brief`;
      // Same rating affordance as the push path (2026-10-02): the fallback
      // surface must not be the one where the brief cannot be rated.
      const buttons = ratingTelegramButtons(ledgerId);
      const ok = buttons
        ? await sendTelegramWithButtons(text, buttons)
            .then((r) => r.ok)
            .catch(() => false)
        : await sendTelegram(text).catch(() => false);
      return { status: ok ? ("sent" as const) : ("failed" as const) };
    });

    // 6. AG-15 · persona-drift scan. The read surfaces (tRPC
    // system.personaDrift, /api/system/persona-drift, the ultron
    // situation card) were live but the PRODUCER — scanRecentReplies —
    // had no scheduled caller, so they consumed an always-empty store.
    // Best-effort: drift observability never fails the brief.
    const driftReport = await step.run("scan-persona-drift", async () => {
      try {
        const { scanRecentReplies } = await import("@/lib/brain/persona-drift-detector");
        const r = await scanRecentReplies({ windowHours: 24 });
        return { scanned: r.scanned, drifted: r.drifted };
      } catch (err) {
        log.warn("persona_drift_scan_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        return { scanned: 0, drifted: 0 };
      }
    });

    // THE GATE, deliberately last. Every step above has completed and is
    // memoized, so each retry replays them instead of re-running ingestion,
    // re-spending the scrape budget and re-sending the push. The brief has
    // already composed, saved and shipped by this point - the operator gets the
    // surface AND the alert, rather than one at the cost of the other.
    //
    // Throwing here marks the run failed, which is what routes it through the
    // already-wired onInngestFailure -> Telegram path after retries exhaust.
    const fatal = ingestionFailure(ingestionReport);
    if (fatal) {
      log.error("intelligence_ingestion_fatal", {
        sourcesAttempted: ingestionReport.sourcesAttempted,
        sourcesIngested: ingestionReport.sourcesIngested,
        totalClaims: ingestionReport.totalClaims,
      });
      throw new Error(fatal);
    }

    if (ingestionReport.failures.length > 0) {
      // Partial degradation is real but is NOT paged: a gate that fires on one
      // flaky feed gets muted, taking the total-outage signal with it.
      log.warn("ingestion_partially_degraded", {
        sourcesAttempted: ingestionReport.sourcesAttempted,
        sourcesIngested: ingestionReport.sourcesIngested,
        failed: ingestionReport.failures.length,
      });
    }

    return {
      ...briefRunOutcome(briefContent as { degraded?: string }),
      date: briefContent.date,
      ingested: ingestionReport,
      opportunities: opportunityReport,
      pushSent: pushReport.sent,
      pushFailed: pushReport.failed,
      combinedWithMorning: morningHighlight !== null,
      telegramFallback: telegramFallback.status,
      personaDrift: driftReport,
    };
  },
);

/**
 * Weekly Ingestion & Briefing Orchestrator
 * Cron: Sundays at 11:00 UTC
 */
export const intelligenceWeeklyBrief = inngest.createFunction(
  {
    id: "intelligence-weekly-brief",
    name: "Intelligence OS · Weekly Strategic Briefing",
    retries: 2,
    triggers: [{ cron: "0 11 * * 0" }],
    onFailure: onInngestFailure,
  },
  async ({ step }) => {
    const briefContent = await step.run("compose-weekly-brief", async () => {
      const { prisma } = await import("@/lib/prisma");
      
      const weeklyOpps = await prisma.opportunityLog.findMany({
        where: {
          status: "pending",
          score: { gte: 50 },
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { score: "desc" },
      });

      const today = new Date().toLocaleDateString("en-CA", {
        timeZone: "America/New_York",
      });

      const model = getModel("reason");
      const systemPrompt = `You are Nour's senior macro-investment advisor. Compose a Weekly Strategic Brief (max 1000 words) summarizing macro indicator shifts, competitor movements, and weekly opportunities.
Your writing style is highly strategic, analytical, and outcomes-oriented.

Format using these exact sections:
# Weekly Strategic Brief · [Date]

## 📈 Macro Indicator Trends
Summarize interest rate or price trends observed from the macro sources (FRED/BLS/BEA/Census — the report names which served).

## ⚔️ Competitor & Market Shifts
Analyze competitor movements and SEO rankings.

## 💡 Top Strategic Opportunities (Score >= 50)
Summarize key opportunities compiled this week.`;

      const promptText = `Date: ${today}
Weekly Opportunities:
${weeklyOpps.map((o) => `- [${o.domain.toUpperCase()}] ${o.title}: ${o.description} (Score: ${o.score})`).join("\n")}`;

      const result = await generateText({
        model,
        experimental_telemetry: langfuseTelemetry({ functionId: "intelligence-brief" }),
        system: systemPrompt,
        prompt: `${promptText}\n\nCompose the weekly strategic brief now.`,
      });

      return {
        date: today,
        text: result.text || "No strategic briefing content compiled for this week.",
      };
    });

    // Save to BriefingLog
    await step.run("save-weekly-log", async () => {
      const { prisma } = await import("@/lib/prisma");
      await prisma.briefingLog.create({
        data: {
          briefType: "weekly",
          content: briefContent.text,
        },
      });
    });

    return {
      date: briefContent.date,
      status: "completed",
    };
  },
);
