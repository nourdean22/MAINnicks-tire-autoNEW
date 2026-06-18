import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import { prisma } from "@/lib/prisma";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { activeOnly } from "@/lib/db/soft-delete";
import { logger } from "@/lib/logger";

const log = logger.withSurface("inngest/finance-classification");
const inngest = getInngest();

export interface TransactionCreatedData {
  transactionId: string;
  payee: string;
  amountCents: number;
  category: string;
  date: string;
}

export const financeClassification = inngest.createFunction(
  {
    id: "finance-transaction-classification",
    name: "AI financial transaction classification",
    triggers: [{ event: "finance/transaction.created" }],
    onFailure: onInngestFailure,
  },
  async ({ event, step }) => {
    const data = event.data as TransactionCreatedData;
    if (!data.transactionId) {
      return { ok: false, error: "Missing transactionId" };
    }

    // 1. Fetch active Missions and Goals for context
    const context = await step.run("fetch-budget-context", async () => {
      const missions = await prisma.mission.findMany({
        where: activeOnly(),
        select: { id: true, title: true, domain: true },
      });

      const goals = await prisma.lifeGoal.findMany({
        where: { status: "ACTIVE", deletedAt: null },
        select: { id: true, title: true, domain: true },
      });

      return { missions, goals };
    });

    // 2. Query LLM to classify transaction
    const classification = await step.run("classify-transaction", async () => {
      const amountDollars = (data.amountCents / 100).toFixed(2);
      const direction = data.amountCents < 0 ? "Expense" : "Income";

      const prompt = `TRANSACTION TO CLASSIFY:
Date: ${data.date}
Payee/Description: ${data.payee}
Amount: $${Math.abs(Number(amountDollars))} (${direction})
Initial Category: ${data.category}

ACTIVE MISSIONS:
${context.missions.map((m) => `- [${m.domain}] ${m.title} (ID: ${m.id})`).join("\n")}

ACTIVE LIFE GOALS:
${context.goals.map((g) => `- [${g.domain}] ${g.title} (ID: ${g.id})`).join("\n")}

Analyze the transaction and return ONLY valid JSON:
{
  "category": "Pick one standard category: 'Housing', 'Food', 'Transport', 'Coaching', 'Software/SaaS', 'Supplement/Biohacking', 'Investing', 'Business Expense', 'Leisure', 'Taxes', 'Income', 'Other'",
  "linkedMissionId": "ID of the most relevant mission, or null",
  "linkedGoalId": "ID of the most relevant life goal, or null",
  "explanation": "One short sentence explaining this classification (e.g. 'Software subscription for business analytics')"
}`;

      const systemPrompt =
        "You are Nick, Nour's Chief of Staff. You categorize financial transactions and map them to Nour's active missions and goals. Return ONLY a valid JSON object.";

      const result = await tracedAiChat(
        { label: "finance-classify", source: "tool", metadata: { transactionId: data.transactionId } },
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        "fast"
      );

      try {
        return JSON.parse(result.content.replace(/```json|```/g, "").trim());
      } catch (e) {
        log.error("json_parse_failed", { content: result.content });
        return {
          category: "Other",
          linkedMissionId: null,
          linkedGoalId: null,
          explanation: "AI classification parsing failed",
        };
      }
    });

    // 3. Update the transaction in database
    await step.run("update-transaction-record", async () => {
      const tx = await prisma.financialTransaction.findUnique({
        where: { id: data.transactionId },
      });

      if (!tx) return;

      // Prepare enriched notes
      let notes = classification.explanation || "";
      if (classification.linkedMissionId) {
        const mission = context.missions.find((m) => m.id === classification.linkedMissionId);
        if (mission) notes += ` | Linked Mission: ${mission.title}`;
      }
      if (classification.linkedGoalId) {
        const goal = context.goals.find((g) => g.id === classification.linkedGoalId);
        if (goal) notes += ` | Linked Goal: ${goal.title}`;
      }

      await prisma.financialTransaction.update({
        where: { id: data.transactionId },
        data: {
          category: classification.category,
          notes: tx.notes ? tx.notes + "\n" + notes : notes,
        },
      });
    });

    return {
      ok: true,
      transactionId: data.transactionId,
      category: classification.category,
    };
  }
);
