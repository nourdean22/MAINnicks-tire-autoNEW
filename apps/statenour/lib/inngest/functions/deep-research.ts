/**
 * On-demand deep research · AG-34 (2026-07-09)
 *
 * "Go research X" previously worked only inside an open chat SSE
 * session — 10-15s+ of searches holding the stream, no Telegram
 * research surface, reports evaporating with the turn. This durable
 * event function decouples research from the session: queue it from
 * chat (queueDeepResearch tool) or Telegram (/research), get the cited
 * synthesis delivered to the phone ~2 minutes later. Reports persist
 * via runDeepResearch's own AG-34 persistence (BrainMemory
 * deep_research + embeddings → 7-day semantic reuse).
 */

import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";

const inngest = getInngest();

export const researchOnDemand = inngest.createFunction(
  {
    id: "research-on-demand",
    name: "Deep research · on-demand with async delivery",
    retries: 1,
    triggers: [{ event: "research/on-demand" }],
    onFailure: onInngestFailure,
  },
  async ({ event, step }) => {
    const { question, deliverTo } = event.data as {
      question: string;
      deliverTo: "push" | "telegram";
    };

    const report = await step.run("run-deep-research", async () => {
      const { runDeepResearch } = await import("@/lib/ai/deep-research");
      const r = await runDeepResearch({ question });
      return {
        synthesis: r.synthesis,
        citations: r.allCitations.slice(0, 10),
        cached: r.cached ?? false,
        synthesisStatus: r.synthesisStatus,
        roundCount: r.rounds.filter((x) => x.content).length,
      };
    });

    const delivery = await step.run("deliver", async () => {
      if (!report.synthesis) {
        // Honest empty: never deliver a fabricated report. And never call a
        // write-up failure "no sources" — the searches DID return content.
        const { sendTelegram, escapeHtml } = await import("@/lib/services/telegram");
        const q = escapeHtml(question.slice(0, 120));
        const text =
          report.synthesisStatus === "synth_failed"
            ? `🔎 Research on "${q}": ${report.roundCount} search round(s) returned content, but the write-up step failed, so there is no report.\n\n` +
              `Sources found:\n${report.citations.map((c) => `• ${escapeHtml(c)}`).join("\n") || "• (none cited)"}`
            : `🔎 Research came back empty for: "${q}" — no sources returned usable content.`;
        const sent = await sendTelegram(text);
        return { delivered: sent ? `empty-notice:${report.synthesisStatus}` : "undelivered" };
      }
      if (deliverTo === "push") {
        const { sendPush } = await import("@/lib/notifications/push");
        return sendPush({
          title: "Research ready",
          body: report.synthesis.slice(0, 200).replace(/\n+/g, " · "),
          level: "medium",
          url: "/brain",
          tag: `deep-research-${Date.now()}`,
          chatSeed: {
            prompt: `walk me through the research findings on: ${question.slice(0, 160)}`,
            suggKind: "deep-research",
            suggId: String(Date.now()),
          },
        });
      }
      const { sendTelegram } = await import("@/lib/services/telegram");
      const cachedTag = report.cached ? " (cached <7d)" : "";
      // sendTelegram returns false (never throws) on failure. Returning the
      // literal "telegram" claimed a delivery nobody observed — and the
      // /research ack already promised the operator the report would land
      // here, with nothing to re-notify them if it did not. The `push` branch
      // above returns real {sent, failed}; this is the same function.
      const sent = await sendTelegram(
        `🔎 <b>Research</b>${cachedTag}\n\n${report.synthesis.slice(0, 3400)}\n\n<i>${report.citations.length} source(s).</i>`,
      );
      return { delivered: sent ? "telegram" : "undelivered" };
    });

    return { question: question.slice(0, 120), cached: report.cached, delivery };
  },
);
