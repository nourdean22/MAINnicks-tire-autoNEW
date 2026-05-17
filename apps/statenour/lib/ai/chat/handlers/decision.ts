/**
 * Chat fast-path · DECISION-LOG handler
 *
 * "log this decision: …" / "decision: …" / "my decision is …" routes
 * here instead of going through the model pipeline. Parses the body
 * for an optional "because <reason>" clause, classifies stakes from
 * keyword heuristics (low / medium / high / critical), schedules a
 * review date based on stakes (critical=7d, high=14d, medium=30d,
 * low=none), writes the row to MasteryDecision, and streams a
 * confirmation back via buildFastStream.
 */

import { prisma } from "@/lib/prisma";
import { recordError } from "@/lib/errors/record-error";
import { EARLY_DECISION } from "./patterns";
import { buildFastStream } from "./shared";

export async function handleDecision(
  convId: string,
  userContent: string,
): Promise<Response> {
  try {
    const body = userContent.trim().replace(EARLY_DECISION, "").trim();
    if (body.length < 3) {
      return Response.json(
        {
          error:
            "Decision content too short. Try: 'log this decision: <what you decided> because <reason>'",
        },
        { status: 400 },
      );
    }
    const becauseMatch = body.match(/^(.+?)\s+because\s+(.+)$/i);
    const title = (becauseMatch ? becauseMatch[1] : body).trim();
    const reasoning = becauseMatch ? becauseMatch[2].trim() : null;
    const bodyLower = body.toLowerCase();
    const stakes: "low" | "medium" | "high" | "critical" =
      /\b(critical|huge|massive|life[- ]changing|must|existential)\b/.test(bodyLower)
        ? "critical"
        : /\b(high\s+stakes?|important|big|significant)\b/.test(bodyLower)
          ? "high"
          : /\b(low\s+stakes?|minor|small|trivial)\b/.test(bodyLower)
            ? "low"
            : "medium";
    const reviewDays =
      stakes === "critical"
        ? 7
        : stakes === "high"
          ? 14
          : stakes === "medium"
            ? 30
            : 0;
    const reviewDate =
      reviewDays > 0
        ? new Date(Date.now() + reviewDays * 24 * 60 * 60 * 1000)
            .toISOString()
            .split("T")[0]
        : null;
    const d = await prisma.masteryDecision.create({
      data: {
        date: new Date().toISOString().slice(0, 10),
        title: title.slice(0, 200),
        stakes,
        chosen: title.slice(0, 500),
        reasoning: reasoning ? reasoning.slice(0, 1000) : null,
        reviewDate,
      },
    });
    console.log(
      `[ai/chat] Decision logged via fast path: ${d.id} (stakes=${stakes})`,
    );
    const confirmationText = [
      `**Decision logged.**`,
      `> ${title.slice(0, 200)}`,
      reasoning ? `*Reasoning:* ${reasoning.slice(0, 200)}` : null,
      `**Stakes:** ${stakes}${reviewDate ? ` · **Review:** ${reviewDate}` : ""}`,
      ``,
      `Surfaces on [/journal](/journal) and [/decisions](/decisions).`,
    ]
      .filter(Boolean)
      .join("\n\n");
    return await buildFastStream(convId, confirmationText, "dec", "nl-decision");
  } catch (decErr) {
    recordError("chat:decision-capture", decErr, {
      snippet: userContent.slice(0, 200),
    });
    return Response.json(
      {
        error:
          "Decision capture failed. The message was saved but the decision didn't persist.",
      },
      { status: 500 },
    );
  }
}
