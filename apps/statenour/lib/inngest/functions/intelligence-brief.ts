/**
 * Inngest functions for Intelligence OS Briefings
 * Daily and Weekly Cron workflows for raw ingestion, scoring, synthesis, and dispatch.
 */
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
 * 2026-08-23 · zero-ingest is a FAILURE, not a quiet day. Pure and exported for
 * the same reason `combineBriefText` below is: an Inngest step callback cannot be
 * driven from a test without mocking step.run and prisma, so the decision lives
 * here where it can be asserted directly.
 *
 * THE DEFECT. The ingestion step caught every per-source error, logged it, and
 * returned normally. A source that returned `{ success: false }` was not even
 * logged. So if all seven feeds failed — one expired credential is enough — the
 * step returned `sourcesIngested: 0`, the function completed, and Inngest marked
 * the run SUCCEEDED. The brief then went out built on nothing, and the only
 * signal was a log line nobody reads.
 *
 * WHY A THROW IS THE RIGHT INSTRUMENT AND NOT A NEW ALERT. `onFailure:
 * onInngestFailure` is already wired on this function and already routes to
 * Telegram after retries are exhausted (retries: 2, so three attempts). Throwing
 * reuses that path exactly; building a second alerting route would be a parallel
 * system to keep in sync.
 *
 * MEASURED BEFORE ARMING, because a gate that fires every day is worse than no
 * gate. Prod on 2026-08-23: 7 registered sources, and intelligence_claims has
 * rows on 20 of the last 21 days (20-76/day). Zero-ingest is NOT the steady
 * state here, so this pages rarely and means something when it does. The
 * contrast is `ollama-model-liveness`, which carries a 2,308-run failure streak
 * — arming an identical assert there would have paged ~97% of days and been
 * muted within a week.
 *
 * THE GUARD THAT MATTERS: `sourcesAttempted > 0`. With no sources registered,
 * ingesting nothing is CORRECT, and throwing would turn an empty configuration
 * into a permanent daily alarm.
 *
 * WHY THROWING HERE IS SAFE TO RETRY, which is not obvious. A throw inside
 * `step.run` makes Inngest re-run that step, and `runIngestion` has NO dedup —
 * it creates a `source_documents` row per successful call, with no content hash
 * and no existence check. Re-running it after a partial success would duplicate.
 * That cannot happen here: this throws ONLY when `sourcesIngested === 0`, which
 * means no document was written on that attempt, so there is nothing for a retry
 * to duplicate. The `=== 0` condition is load-bearing for idempotency as well as
 * for sensitivity — widening it to "fewer than N succeeded" would make the gate
 * catch more AND start duplicating rows on every partial day. Do not widen it
 * without adding dedup to runIngestion first.
 */
export function ingestionFailure(report: {
  sourcesAttempted: number;
  sourcesIngested: number;
  failures?: string[];
}): string | null {
  if (report.sourcesAttempted === 0) return null;
  if (report.sourcesIngested > 0) return null;
  const why = report.failures?.length
    ? ` Reasons: ${report.failures.join(" | ")}`
    : " No per-source reason was captured.";
  return (
    `Intelligence ingestion produced NOTHING: 0 of ${report.sourcesAttempted} sources ingested. ` +
    `The brief would have been built on no new input.${why}`
  );
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
      let ingestedCount = 0;
      let totalClaims = 0;

      // Reasons are COLLECTED, not just logged. IngestionResult carries a
      // `message` on failure and it was being discarded entirely, so the
      // operator-facing alert could say "0 sources" but never "the credential
      // expired" — which is the only part that tells them what to do.
      const failures: string[] = [];

      for (const source of activeSources) {
        try {
          const res = await runIngestion(source.id);
          if (res.success) {
            ingestedCount++;
            totalClaims += res.claimsCount;
          } else {
            // Previously a completely silent path: a soft failure was neither
            // counted nor logged.
            failures.push(`${source.name}: ${res.message ?? "reported failure"}`.slice(0, 160));
            log.warn("ingestion_source_soft_failure", { sourceId: source.id, name: source.name, message: res.message });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          failures.push(`${source.name}: ${msg}`.slice(0, 160));
          log.error(`Inngest step runIngestion failed for source ${source.id}`, { error: msg });
        }
      }

      const fatal = ingestionFailure({
        sourcesAttempted: activeSources.length,
        sourcesIngested: ingestedCount,
        failures,
      });
      if (fatal) {
        // Throwing marks the Inngest run FAILED, which is what routes this
        // through the already-wired onInngestFailure -> Telegram path. Returning
        // normally is what made a total ingestion outage look like a good day.
        throw new Error(fatal);
      }

      if (failures.length > 0) {
        log.warn("ingestion_partially_degraded", {
          sourcesAttempted: activeSources.length,
          sourcesIngested: ingestedCount,
          failed: failures.length,
        });
      }

      return { sourcesAttempted: activeSources.length, sourcesIngested: ingestedCount, totalClaims };
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
    await step.run("save-brief-log", async () => {
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
      const { recordShown } = await import("@/lib/services/outcome-ledger");
      await recordShown({
        kind: "daily_brief",
        sourceEngine: "intelligence-brief",
        summary: combinedText.split("\n").find((l: string) => l.trim().length > 0)?.slice(0, 500) ?? "daily brief",
        shownSurface: "push+briefing_log",
      });
    });

    // 5. Dispatch Web Push Notification — ONE push covering both briefs
    // when morning's highlight was there to combine.
    const pushReport = await step.run("dispatch-push", async () => {
      const { sendPush } = await import("@/lib/notifications/push");
      const result = await sendPush({
        title: combinedBriefTitle(morningHighlight),
        body: combinedPushBody(morningHighlight, briefContent.text),
        level: "high",
        url: "/intelligence/brief",
        tag: `daily-brief-${briefContent.date}`,
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
      const { sendTelegram } = await import("@/lib/services/telegram");
      const reason =
        pushReport.failed > 0
          ? "web push failed on every registered device"
          : "no live web-push subscription";
      const title = combinedBriefTitle(morningHighlight);
      const ok = await sendTelegram(
        `📊 ${title} (${briefContent.date}) — delivered via Telegram because ${reason}. ` +
          `Re-enable push in Settings → Notifications.\n\n${pushBodyFromBrief(combinedText)}\n\n` +
          `Full brief: https://bdnick.info/intelligence/brief`,
      ).catch(() => false);
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

    return {
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
Summarize interest rate or price trends observed from FRED and macro sources.

## ⚔️ Competitor & Market Shifts
Analyze competitor movements and SEO rankings.

## 💡 Top Strategic Opportunities (Score >= 50)
Summarize key opportunities compiled this week.`;

      const promptText = `Date: ${today}
Weekly Opportunities:
${weeklyOpps.map((o) => `- [${o.domain.toUpperCase()}] ${o.title}: ${o.description} (Score: ${o.score})`).join("\n")}`;

      const result = await generateText({
        model,
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
